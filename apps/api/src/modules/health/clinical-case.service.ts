import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import {
  assertNotBeforeBirth,
  HealthApplicationError,
  assertCaseOutcome,
  assertCaseSeverity,
  assertCaseStatus,
  assertCaseTransition,
  InvalidClinicalCaseError,
  OPEN_CASE_STATUSES,
} from '@cowinance/domain';
import type { ClinicalCaseStatus } from '@cowinance/domain';
import { DbService, Q } from '../../db/db.service';

/**
 * Casos clínicos (Sanidad E2). Un caso agrupa el episodio sanitario de UN animal: diagnóstico,
 * severidad, estado (máquina de estados del dominio), seguimientos, tratamientos vinculados y
 * cierre con resultado. La regla de transición es PURA (`assertCaseTransition`); acá se orquesta
 * la persistencia atómica (fila del caso + evento de timeline del caso + timeline del animal).
 *
 * El timeline del caso se COMPONE (no se duplica): `clinical_case_events` (apertura, notas,
 * cambios de estado, cierre) + los `treatments` y `health_events` que apuntan a `clinical_case_id`.
 */
@Injectable()
export class ClinicalCaseService {
  constructor(private readonly db: DbService) {}

  /** Crea un caso. Idempotente por `Idempotency-Key` (deriva el id): reintentar no duplica. */
  async create(body: any, idempotencyKey?: string) {
    if (!body?.animal_id) throw new BadRequestException({ code: 'clinical_case.missing_animal', title: 'animal_id es obligatorio' });
    let severity: string | null;
    let status: ClinicalCaseStatus;
    try {
      severity = assertCaseSeverity(body.severity);
      status = body.status ? assertCaseStatus(body.status) : 'open';
    } catch (e) {
      throw this.mapDomain(e);
    }
    const caseId = idempotencyKey ? this.deriveId(idempotencyKey, body.animal_id) : randomUUID();
    const startedAt = body.started_at ?? new Date().toISOString();

    // Un caso clínico empieza cuando se ve el problema, no antes de que pase.
    const hoy = await this.db.today();
    if ((await this.db.farmDateOf(startedAt)) > hoy)
      throw new BadRequestException({
        code: 'clinical_case.future_date',
        title: 'La fecha de inicio del caso es futura. Se registra lo que ya ocurrió.',
      });

    return this.db.tx(async (q) => {
      const existing = await q.one<any>(`SELECT id FROM clinical_cases WHERE id = $1 AND tenant_id = $2`, [caseId, this.db.tenant]);
      if (existing) return { ...(await this.header(q, caseId)), already_created: true };

      const animal = await this.requireAnimal(q, body.animal_id);
      // La otra mitad del par de la guarda de arriba: un caso clínico tampoco puede empezar antes de
      // que el animal existiera.
      try {
        assertNotBeforeBirth(await this.db.farmDateOf(startedAt), animal.birth_date, 'La fecha de inicio del caso');
      } catch (e) {
        if (e instanceof HealthApplicationError) throw new BadRequestException({ code: e.code, title: e.reason });
        throw e;
      }
      if (body.diagnosis_id) await this.requireDiagnosis(q, body.diagnosis_id);

      await q.query(
        `INSERT INTO clinical_cases (id, tenant_id, animal_id, diagnosis_id, status, severity, started_at, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
        [caseId, this.db.tenant, body.animal_id, body.diagnosis_id ?? null, status, severity, startedAt, body.notes ?? null, this.db.user],
      );
      await this.addCaseEvent(q, caseId, 'opened', status, body.notes ?? null, startedAt);
      await this.animalEvent(q, body.animal_id, 'clinical_case', { case_id: caseId, status, severity, diagnosis_id: body.diagnosis_id ?? null }, startedAt);
      return this.header(q, caseId);
    });
  }

  /** Lista de casos con filtros (estado open/all/específico, animal, lote, diagnóstico). */
  async list(params: { status?: string; animalId?: string; lotId?: string; diagnosisId?: string } = {}) {
    const args: unknown[] = [this.db.tenant];
    const where = [`cc.tenant_id = $1`, `cc.deleted_at IS NULL`];
    if (params.status === 'open') where.push(`cc.status = ANY('{${OPEN_CASE_STATUSES.join(',')}}')`);
    else if (params.status && params.status !== 'all') {
      args.push(params.status);
      where.push(`cc.status = $${args.length}`);
    }
    if (params.animalId) {
      args.push(params.animalId);
      where.push(`cc.animal_id = $${args.length}`);
    }
    if (params.lotId) {
      args.push(params.lotId);
      where.push(`a.current_lot_id = $${args.length}`);
    }
    if (params.diagnosisId) {
      args.push(params.diagnosisId);
      where.push(`cc.diagnosis_id = $${args.length}`);
    }
    return this.db.query(
      `SELECT cc.id, cc.animal_id, ai.value AS tag, cc.status, cc.severity, cc.started_at, cc.closed_at, cc.outcome,
              cc.diagnosis_id, d.name AS diagnosis, d.category AS diagnosis_category, d.is_notifiable,
              a.current_lot_id AS lot_id, l.name AS lot_name,
              (cc.status = ANY('{${OPEN_CASE_STATUSES.join(',')}}')) AS is_open,
              (SELECT count(*)::int FROM treatments t WHERE t.clinical_case_id = cc.id AND t.deleted_at IS NULL) AS treatment_count
       FROM clinical_cases cc
       JOIN animals a ON a.id = cc.animal_id
       LEFT JOIN lots l ON l.id = a.current_lot_id
       LEFT JOIN diagnoses d ON d.id = cc.diagnosis_id
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE ${where.join(' AND ')}
       ORDER BY is_open DESC, cc.started_at DESC LIMIT 300`,
      args,
    );
  }

  /** Detalle del caso: cabecera + tratamientos y eventos clínicos vinculados + timeline compuesto. */
  async get(id: string) {
    const header = await this.header(this.db, id);
    if (!header) throw new NotFoundException({ code: 'clinical_case.not_found', title: 'Caso clínico no encontrado' });
    const [treatments, healthEvents, events] = await Promise.all([
      this.db.query(
        `SELECT t.id, t.applied_at, pv.name AS product, t.dose, t.route, t.meat_withdrawal_until, t.notes
         FROM treatments t LEFT JOIN products_veterinary pv ON pv.id = t.product_id
         WHERE t.clinical_case_id = $1 AND t.tenant_id = $2 AND t.deleted_at IS NULL ORDER BY t.applied_at`,
        [id, this.db.tenant],
      ),
      this.db.query(
        `SELECT he.id, he.occurred_at, he.severity, he.outcome, he.notes, d.name AS diagnosis
         FROM health_events he LEFT JOIN diagnoses d ON d.id = he.diagnosis_id
         WHERE he.clinical_case_id = $1 AND he.tenant_id = $2 AND he.deleted_at IS NULL ORDER BY he.occurred_at`,
        [id, this.db.tenant],
      ),
      this.db.query(
        `SELECT ce.kind, ce.status, ce.note, ce.occurred_at, COALESCE(u.full_name, u.email) AS actor
         FROM clinical_case_events ce LEFT JOIN users u ON u.id = ce.created_by
         WHERE ce.case_id = $1 AND ce.tenant_id = $2 ORDER BY ce.occurred_at`,
        [id, this.db.tenant],
      ),
    ]);
    return { ...header, treatments, health_events: healthEvents, timeline: events };
  }

  /** Seguimiento: nota y, opcionalmente, cambio de estado (valida la transición del dominio). */
  async addFollowUp(id: string, body: any) {
    return this.db.tx(async (q) => {
      const cc = await this.requireCase(q, id);
      const occurredAt = body.occurred_at ?? new Date().toISOString();
      let newStatus: ClinicalCaseStatus | null = null;
      if (body.status) {
        try {
          newStatus = assertCaseStatus(body.status);
          assertCaseTransition(cc.status as ClinicalCaseStatus, newStatus);
        } catch (e) {
          throw this.mapDomain(e);
        }
        await q.query(`UPDATE clinical_cases SET status = $3, updated_at = now() WHERE id = $1 AND tenant_id = $2`, [id, this.db.tenant, newStatus]);
        await this.addCaseEvent(q, id, 'status_change', newStatus, body.note ?? null, occurredAt);
      } else {
        if (!body.note) throw new BadRequestException({ code: 'clinical_case.empty_followup', title: 'Un seguimiento requiere una nota o un cambio de estado' });
        await this.addCaseEvent(q, id, 'note', null, body.note, occurredAt);
      }
      await this.animalEvent(q, cc.animal_id, 'clinical_case_followup', { case_id: id, status: newStatus, note: body.note ?? null }, occurredAt);
      return this.header(q, id);
    });
  }

  /** Cierra el caso con un resultado (transición a 'closed'; fija closed_at + outcome). */
  async close(id: string, body: any) {
    let outcome: string | null;
    try {
      outcome = assertCaseOutcome(body?.outcome);
    } catch (e) {
      throw this.mapDomain(e);
    }
    return this.db.tx(async (q) => {
      const cc = await this.requireCase(q, id);
      if (cc.status === 'closed') return { ...(await this.header(q, id)), already_closed: true };
      try {
        assertCaseTransition(cc.status as ClinicalCaseStatus, 'closed');
      } catch (e) {
        throw this.mapDomain(e);
      }
      const closedAt = body?.closed_at ?? new Date().toISOString();
      await q.query(
        `UPDATE clinical_cases SET status = 'closed', outcome = $3, closed_at = $4, updated_at = now() WHERE id = $1 AND tenant_id = $2`,
        [id, this.db.tenant, outcome, closedAt],
      );
      await this.addCaseEvent(q, id, 'closed', 'closed', body?.note ?? null, closedAt);
      await this.animalEvent(q, cc.animal_id, 'clinical_case_closed', { case_id: id, outcome }, closedAt);
      return this.header(q, id);
    });
  }

  // --- helpers ---

  private async header(q: Q | DbService, id: string) {
    return q.one<any>(
      `SELECT cc.id, cc.animal_id, ai.value AS tag, cc.status, cc.severity, cc.started_at, cc.closed_at, cc.outcome, cc.notes,
              cc.diagnosis_id, d.name AS diagnosis, d.category AS diagnosis_category, d.is_notifiable,
              a.current_lot_id AS lot_id, l.name AS lot_name
       FROM clinical_cases cc
       JOIN animals a ON a.id = cc.animal_id
       LEFT JOIN lots l ON l.id = a.current_lot_id
       LEFT JOIN diagnoses d ON d.id = cc.diagnosis_id
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE cc.id = $1 AND cc.tenant_id = $2 AND cc.deleted_at IS NULL`,
      [id, this.db.tenant],
    );
  }

  private async addCaseEvent(q: Q, caseId: string, kind: string, status: string | null, note: string | null, occurredAt: string) {
    await q.query(
      `INSERT INTO clinical_case_events (tenant_id, case_id, kind, status, note, occurred_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [this.db.tenant, caseId, kind, status, note, occurredAt, this.db.user],
    );
  }

  private async animalEvent(q: Q, animalId: string, type: string, payload: Record<string, unknown>, occurredAt: string) {
    await q.query(
      `INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source)
       VALUES ($1,$2,$3,$4,$5,now(),'manual')`,
      [this.db.tenant, animalId, type, JSON.stringify(payload), occurredAt],
    );
  }

  private async requireCase(q: Q, id: string) {
    const cc = await q.one<{ id: string; status: string; animal_id: string }>(
      `SELECT id, status, animal_id FROM clinical_cases WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!cc) throw new NotFoundException({ code: 'clinical_case.not_found', title: 'Caso clínico no encontrado' });
    return cc;
  }

  private async requireAnimal(q: Q, animalId: string) {
    // `birth_date::text`: PGlite devuelve las `date` como objetos Date, y compararlas como texto
    // daría «Sun Jun 01» en vez de «2025-12-08».
    const a = await q.one<{ id: string; birth_date: string | null }>(
      `SELECT id, birth_date::text AS birth_date FROM animals WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [animalId, this.db.tenant],
    );
    if (!a) throw new NotFoundException({ code: 'animal.not_found', title: 'Animal no encontrado' });
    return a;
  }

  private async requireDiagnosis(q: Q, id: string) {
    const d = await q.one<{ id: string }>(
      `SELECT id FROM diagnoses WHERE id = $1 AND (tenant_id IS NULL OR tenant_id = $2) AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!d) throw new BadRequestException({ code: 'clinical_case.invalid_diagnosis', title: 'Diagnóstico inválido' });
    return d;
  }

  private deriveId(baseKey: string, animalId: string): string {
    const h = createHash('sha1').update(`case:${baseKey}:${animalId}`).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }

  private mapDomain(e: unknown): never {
    if (e instanceof InvalidClinicalCaseError) {
      if (e.code === 'clinical_case.invalid_transition') throw new ConflictException({ code: e.code, title: e.reason });
      throw new BadRequestException({ code: e.code, title: e.reason });
    }
    throw e;
  }
}
