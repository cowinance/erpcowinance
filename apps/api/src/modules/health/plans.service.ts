import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { TaskService } from '../tasks/task.service';

/**
 * Planes/calendarios sanitarios reutilizables (Módulo B3 · Sanidad).
 * Un plan es un template de pasos (producto + a qué categorías + día relativo);
 * al aplicarlo a un lote/categoría genera TAREAS programadas por animal, que el
 * motor de alertas convierte en recordatorios automáticos.
 */

interface PlanStep {
  product_id?: string | null;
  product_name: string;
  applies_to: string[]; // códigos de categoría; [] = todas
  offset_days: number; // días desde la fecha de aplicación (ancla)
  label: string;
}

@Injectable()
export class PlansService {
  constructor(
    private readonly db: DbService,
    private readonly taskService: TaskService,
  ) {}

  async list() {
    return this.db.query(
      `SELECT hp.id, hp.name, hp.is_active, s.name AS species, jsonb_array_length(hp.schedule) AS steps, hp.schedule
       FROM health_plans hp JOIN species s ON s.id = hp.species_id
       WHERE hp.tenant_id = $1 AND hp.deleted_at IS NULL ORDER BY hp.name`,
      [this.db.tenant],
    );
  }

  async create(body: { name?: string; species_code?: string; steps?: PlanStep[] }) {
    if (!body?.name || !Array.isArray(body.steps) || body.steps.length === 0)
      throw new BadRequestException({ code: 'plan.missing_fields', title: 'name y al menos un paso son obligatorios' });
    const species = await this.db.one<any>(`SELECT id FROM species WHERE code = $1`, [body.species_code ?? 'bovine']);
    if (!species) throw new BadRequestException({ code: 'plan.invalid_species', title: 'Especie inválida' });
    const steps = body.steps.map((s) => ({
      product_id: s.product_id ?? null,
      product_name: s.product_name,
      applies_to: Array.isArray(s.applies_to) ? s.applies_to : [],
      offset_days: Number(s.offset_days) || 0,
      label: s.label ?? s.product_name,
    }));
    return this.db.one(
      `INSERT INTO health_plans (tenant_id, name, species_id, schedule, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, name`,
      [this.db.tenant, body.name, species.id, JSON.stringify(steps), this.db.user],
    );
  }

  /**
   * Aplica el plan: por cada paso, a cada animal activo del objetivo cuya
   * categoría matchee, crea una tarea sanitaria con due_date = ancla + offset.
   * Idempotente por (animal, título, fecha): reaplicar no duplica.
   */
  async apply(planId: string, body: { category_code?: string; lot_id?: string; anchor_date?: string }) {
    const t = this.db.tenant;
    const plan = await this.db.one<any>(
      `SELECT id, name, schedule FROM health_plans WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [planId, t],
    );
    if (!plan) throw new NotFoundException({ code: 'plan.not_found', title: 'Plan no encontrado' });
    const steps: PlanStep[] = plan.schedule ?? [];
    const anchor = new Date(body?.anchor_date ?? new Date().toISOString());
    if (isNaN(anchor.getTime())) throw new BadRequestException({ code: 'plan.invalid_date', title: 'Fecha de aplicación inválida' });
    const farm = await this.db.defaultFarm();

    // Universo objetivo
    const where: string[] = [`a.tenant_id = $1`, `a.status = 'active'`, `a.deleted_at IS NULL`];
    const args: unknown[] = [t];
    if (body?.lot_id) {
      args.push(body.lot_id);
      where.push(`a.current_lot_id = $${args.length}`);
    }
    if (body?.category_code) {
      args.push(body.category_code);
      where.push(`c.code = $${args.length}`);
    }
    const animals = await this.db.query<any>(
      `SELECT a.id, c.code AS category_code, ai.value AS tag
       FROM animals a
       LEFT JOIN animal_categories c ON c.id = a.category_id
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE ${where.join(' AND ')}`,
      args,
    );

    let created = 0;
    let skipped = 0;
    for (const animal of animals) {
      for (const step of steps) {
        if (step.applies_to?.length && !step.applies_to.includes(animal.category_code)) continue;
        const due = new Date(anchor.getTime() + (step.offset_days || 0) * 86400000);
        const title = `${step.label} — caravana ${animal.tag ?? '—'}`;
        const dup = await this.db.one(
          `SELECT id FROM tasks WHERE tenant_id = $1 AND related_type = 'animal' AND related_id = $2
             AND title = $3 AND due_date::date = $4::date AND status = 'pending' AND deleted_at IS NULL`,
          [t, animal.id, title, due.toISOString()],
        );
        if (dup) {
          skipped++;
          continue;
        }
        // Sanidad decide QUÉ tarea clínica debe existir (aquí); el CÓMO persistirla —fila,
        // versiones LWW, server-origin— es responsabilidad única de TaskService (P6-1).
        await this.taskService.createTask(
          this.db,
          {
            title,
            type: 'health',
            dueDate: due.toISOString(),
            priority: 'normal',
            relatedType: 'animal',
            relatedId: animal.id,
            farmId: farm,
            // Mismo plan + mismo paso + misma fecha = el MISMO trabajo, repartido en varios
            // animales. Es lo que permite que la lista de alertas muestre «Desparasitación · 10
            // animales» en vez de diez renglones iguales. No lleva el animal a propósito: si lo
            // llevara sería única por animal y no agruparía nada.
            batchKey: `plan:${plan.id}:${step.label}:${due.toISOString().slice(0, 10)}`,
            batchLabel: step.label,
          },
          { origin: 'health', emitServerOrigin: true, actorUserId: this.db.user },
        );
        created++;
      }
    }
    return { plan: plan.name, animals: animals.length, tasks_created: created, tasks_skipped: skipped };
  }

  /** Tareas sanitarias programadas (recordatorios) por estado. */
  async tasks(status = 'pending', days?: number) {
    const args: unknown[] = [this.db.tenant];
    const where = [`t.tenant_id = $1`, `t.type = 'health'`, `t.deleted_at IS NULL`];
    if (status !== 'all') {
      args.push(status);
      where.push(`t.status = $${args.length}`);
    }
    if (days != null) {
      args.push(days);
      where.push(`t.due_date <= now() + ($${args.length} || ' days')::interval`);
    }
    return this.db.query(
      `SELECT t.id, t.title, t.due_date, t.status, t.related_id AS animal_id, ai.value AS tag,
              (t.due_date::date < CURRENT_DATE) AS overdue
       FROM tasks t
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = t.related_id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE ${where.join(' AND ')}
       ORDER BY t.due_date ASC LIMIT 300`,
      args,
    );
  }

  /** Completar tarea sanitaria — delega en la regla única de TaskService (server-authored). */
  async completeTask(id: string) {
    const res = await this.taskService.completeTask(this.db, { taskId: id }, { origin: 'health', emitServerOrigin: true, actorUserId: this.db.user });
    return { id, status: res.status };
  }
}
