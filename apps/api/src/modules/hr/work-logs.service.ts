import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { validateWorkLogHours, InvalidWorkLogError } from '@cowinance/domain';
import { DbService } from '../../db/db.service';

/**
 * RRHH — partes de trabajo (WL-1): `work_logs` registra las horas de un empleado en un día, con
 * imputación opcional a una tarea (P6) y a una finca. Cierra la captura de mano de obra que quedó
 * diferida en Maquinaria y Agricultura (las horas del empleado son de RRHH, no del recurso).
 *
 * Regla única: las horas se validan con `validateWorkLogHours` (dominio, ADR-0006). El `summary` es
 * DERIVADO — agrega horas y días trabajados por empleado en un período, no se persiste.
 */
@Injectable()
export class WorkLogsService {
  constructor(private readonly db: DbService) {}

  async list(filters: { employee_id?: string; from?: string; to?: string; task_id?: string; farm_id?: string }) {
    const params: unknown[] = [this.db.tenant];
    let where = '';
    const add = (val: unknown, clause: (p: number) => string) => {
      params.push(val);
      where += ` AND ${clause(params.length)}`;
    };
    if (filters.employee_id) add(filters.employee_id, (p) => `w.employee_id = $${p}`);
    if (filters.task_id) add(filters.task_id, (p) => `w.task_id = $${p}`);
    if (filters.farm_id) add(filters.farm_id, (p) => `w.farm_id = $${p}`);
    if (filters.from) add(filters.from, (p) => `w.work_date >= $${p}`);
    if (filters.to) add(filters.to, (p) => `w.work_date <= $${p}`);
    return this.db.query(
      `SELECT w.id, w.employee_id, e.full_name AS employee_name, w.work_date::text AS work_date,
              w.hours::float AS hours, w.task_id, t.title AS task_title, w.farm_id, f.name AS farm_name, w.cost_center_id, w.notes
       FROM work_logs w
       JOIN employees e ON e.id = w.employee_id
       LEFT JOIN tasks t ON t.id = w.task_id
       LEFT JOIN farms f ON f.id = w.farm_id
       WHERE w.tenant_id=$1 AND w.deleted_at IS NULL${where}
       ORDER BY w.work_date DESC, w.created_at DESC LIMIT 500`,
      params,
    );
  }

  async get(id: string) {
    const r = await this.db.one(
      `SELECT w.id, w.employee_id, e.full_name AS employee_name, w.work_date::text AS work_date,
              w.hours::float AS hours, w.task_id, t.title AS task_title, w.farm_id, f.name AS farm_name, w.cost_center_id, w.notes
       FROM work_logs w
       JOIN employees e ON e.id = w.employee_id
       LEFT JOIN tasks t ON t.id = w.task_id
       LEFT JOIN farms f ON f.id = w.farm_id
       WHERE w.id=$1 AND w.tenant_id=$2 AND w.deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!r) throw new NotFoundException({ code: 'hr.work_log_not_found', title: 'Parte de trabajo no encontrado' });
    return r;
  }

  async create(body: any) {
    const hours = this.parseHours(body?.hours);
    await this.requireEmployee(body?.employee_id);
    await this.requireTask(body?.task_id);
    await this.requireFarm(body?.farm_id);
    await this.requireCostCenter(body?.cost_center_id);
    const workDate = body?.work_date ?? await this.db.today();
    const row = await this.db.one<{ id: string }>(
      `INSERT INTO work_logs (tenant_id, employee_id, work_date, hours, task_id, farm_id, cost_center_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [this.db.tenant, body.employee_id, workDate, hours, body?.task_id ?? null, body?.farm_id ?? null, body?.cost_center_id ?? null, body?.notes ?? null, this.db.user],
    );
    return this.get((row as { id: string }).id);
  }

  async update(id: string, body: any) {
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (body?.hours !== undefined) set('hours', this.parseHours(body.hours));
    if (body?.work_date !== undefined) set('work_date', body.work_date);
    if (body?.employee_id !== undefined) {
      await this.requireEmployee(body.employee_id);
      set('employee_id', body.employee_id);
    }
    if (body?.task_id !== undefined) {
      await this.requireTask(body.task_id);
      set('task_id', body.task_id ?? null);
    }
    if (body?.farm_id !== undefined) {
      await this.requireFarm(body.farm_id);
      set('farm_id', body.farm_id ?? null);
    }
    if (body?.cost_center_id !== undefined) {
      await this.requireCostCenter(body.cost_center_id);
      set('cost_center_id', body.cost_center_id ?? null);
    }
    if (body?.notes !== undefined) set('notes', body.notes ?? null);
    if (!sets.length) throw new BadRequestException({ code: 'hr.no_changes', title: 'Nada para actualizar' });
    params.push(id, this.db.tenant);
    const row = await this.db.one<{ id: string }>(
      `UPDATE work_logs SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.length - 1} AND tenant_id=$${params.length} AND deleted_at IS NULL RETURNING id`,
      params,
    );
    if (!row) throw new NotFoundException({ code: 'hr.work_log_not_found', title: 'Parte de trabajo no encontrado' });
    return this.get(id);
  }

  async remove(id: string) {
    const row = await this.db.one<{ id: string }>(`UPDATE work_logs SET deleted_at=now(), updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING id`, [id, this.db.tenant]);
    if (!row) throw new NotFoundException({ code: 'hr.work_log_not_found', title: 'Parte de trabajo no encontrado' });
    return { id, deleted: true };
  }

  /**
   * Resumen DERIVADO: horas totales y días trabajados por empleado en un período. Los días son
   * fechas DISTINTAS con parte (un empleado con dos partes el mismo día cuenta un día).
   */
  async summary(from?: string, to?: string) {
    const params: unknown[] = [this.db.tenant];
    let where = '';
    if (from) {
      params.push(from);
      where += ` AND w.work_date >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      where += ` AND w.work_date <= $${params.length}`;
    }
    return this.db.query(
      `SELECT e.id AS employee_id, e.full_name AS employee_name,
              COALESCE(SUM(w.hours),0)::float AS total_hours,
              COUNT(DISTINCT w.work_date)::int AS days_worked,
              COUNT(w.id)::int AS entries
       FROM work_logs w JOIN employees e ON e.id = w.employee_id
       WHERE w.tenant_id=$1 AND w.deleted_at IS NULL${where}
       GROUP BY e.id, e.full_name
       ORDER BY total_hours DESC, e.full_name`,
      params,
    );
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  private parseHours(raw: unknown): number {
    try {
      return validateWorkLogHours(raw);
    } catch (e) {
      if (e instanceof InvalidWorkLogError) throw new BadRequestException({ code: 'hr.invalid_hours', title: e.reason });
      throw e;
    }
  }

  private async requireEmployee(id: string | undefined) {
    if (!id) throw new BadRequestException({ code: 'hr.missing_employee', title: 'employee_id es obligatorio' });
    const e = await this.db.one<{ id: string }>(`SELECT id FROM employees WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!e) throw new NotFoundException({ code: 'hr.employee_not_found', title: 'Empleado no encontrado' });
  }

  private async requireTask(id: string | null | undefined) {
    if (!id) return;
    const t = await this.db.one<{ id: string }>(`SELECT id FROM tasks WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!t) throw new NotFoundException({ code: 'hr.task_not_found', title: 'Tarea no encontrada' });
  }

  private async requireFarm(id: string | null | undefined) {
    if (!id) return;
    const f = await this.db.one<{ id: string }>(`SELECT id FROM farms WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!f) throw new NotFoundException({ code: 'hr.farm_not_found', title: 'Finca no encontrada' });
  }

  /**
   * Centro de costo al que se imputa la jornada (G2 · E6). Opcional: sin él, el costeo deriva la
   * imputación de la tarea vinculada, y si tampoco hay tarea la jornada queda sin atribuir (visible
   * en `unattributed_labor`, nunca descartada).
   */
  private async requireCostCenter(id: string | null | undefined) {
    if (!id) return;
    const cc = await this.db.one<{ id: string }>(`SELECT id FROM cost_centers WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, this.db.tenant]);
    if (!cc) throw new NotFoundException({ code: 'hr.cost_center_not_found', title: 'Centro de costo no encontrado' });
  }
}
