import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { assertNotBeforeBirth, HealthApplicationError, InvalidAdmissionError, resolveAdmissionKind } from '@cowinance/domain';
import { DbService, Q } from '../../db/db.service';
import { MovementService } from '../land/movement.service';

/**
 * Internaciones sanitarias (Sanidad E6): enviar un animal a un lote hospital/cuarentena (opcionalmente
 * desde un caso clínico) y darle el alta devolviéndolo a su lote anterior o a uno destino. El MOVIMIENTO
 * lo hace SIEMPRE la regla única `MovementService.recordMovement` (nunca un update directo de
 * current_lot_id); esta capa guarda el contexto clínico (motivo, fechas, estado) y el lote de origen
 * para poder devolver el animal en el alta. Todo en UNA transacción.
 */
@Injectable()
export class HospitalizationService {
  constructor(
    private readonly db: DbService,
    private readonly movement: MovementService,
  ) {}

  /** Ingreso a hospital/cuarentena. Idempotente por `Idempotency-Key`. Un animal no puede tener dos internaciones abiertas. */
  async admit(body: any, idempotencyKey?: string) {
    if (!body?.animal_id || !body?.lot_id)
      throw new BadRequestException({ code: 'admission.missing_fields', title: 'animal_id y lot_id son obligatorios' });
    const admissionId = idempotencyKey ? this.deriveId(idempotencyKey, body.animal_id) : randomUUID();

    try {
      return await this.db.tx(async (q) => {
        const existing = await q.one<any>(`SELECT id FROM health_admissions WHERE id = $1 AND tenant_id = $2`, [admissionId, this.db.tenant]);
        if (existing) return { ...(await this.detail(q, admissionId)), already_admitted: true };

        const animal = await q.one<{ id: string; status: string; current_lot_id: string | null; birth_date: string | null }>(
          // `birth_date::text`: PGlite devuelve las `date` como Date, y compararlas como texto daría «Sun Jun 01».
          `SELECT id, status, current_lot_id, birth_date::text AS birth_date FROM animals WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
          [body.animal_id, this.db.tenant],
        );
        if (!animal) throw new NotFoundException({ code: 'animal.not_found', title: 'Animal no encontrado' });
        if (animal.status !== 'active') throw new ConflictException({ code: 'admission.animal_inactive', title: 'El animal no está activo' });
        // Misma regla que en tratamientos y vacunas: un hecho del animal no puede ser anterior a su
        // nacimiento. Acá además arrastra: de la fecha de ingreso salen los días de internación.
        assertNotBeforeBirth(body?.admitted_at ?? new Date().toISOString(), animal.birth_date, 'La fecha de ingreso');

        const lot = await q.one<{ id: string; purpose: string | null }>(
          `SELECT id, purpose FROM lots WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL AND is_active`,
          [body.lot_id, this.db.tenant],
        );
        if (!lot) throw new BadRequestException({ code: 'admission.lot_not_found', title: 'Lote de destino no encontrado o archivado' });
        const kind = resolveAdmissionKind(lot.purpose, body.kind);

        const open = await q.one<{ id: string }>(
          `SELECT id FROM health_admissions WHERE animal_id = $1 AND tenant_id = $2 AND status = 'admitted' AND deleted_at IS NULL`,
          [body.animal_id, this.db.tenant],
        );
        if (open) throw new ConflictException({ code: 'admission.already_open', title: 'El animal ya tiene una internación abierta' });

        if (body.case_id) {
          const c = await q.one<{ id: string }>(`SELECT id FROM clinical_cases WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [body.case_id, this.db.tenant]);
          if (!c) throw new BadRequestException({ code: 'admission.case_not_found', title: 'Caso clínico no encontrado' });
        }

        const admittedAt = body.admitted_at ?? new Date().toISOString();
        const fromLotId = animal.current_lot_id; // para devolverlo en el alta

        await q.query(
          `INSERT INTO health_admissions (id, tenant_id, animal_id, case_id, kind, from_lot_id, lot_id, reason, admitted_at, expected_discharge_at, health_status, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [admissionId, this.db.tenant, body.animal_id, body.case_id ?? null, kind, fromLotId, body.lot_id, body.reason ?? null, admittedAt, body.expected_discharge_at ?? null, body.health_status ?? null, this.db.user],
        );

        // MOVIMIENTO por la regla única (no update directo de current_lot_id).
        await this.movement.recordMovement(q, {
          animalIds: [body.animal_id], to: { lot: body.lot_id },
          reason: body.reason ? `Ingreso a ${kind}: ${body.reason}` : `Ingreso a ${kind}`,
          actorUserId: this.db.user, origin: 'web', movementId: admissionId, emitServerOrigin: true,
        });

        await this.animalEvent(q, body.animal_id, 'admission', { admission_id: admissionId, kind, lot_id: body.lot_id, reason: body.reason ?? null }, admittedAt);
        if (body.case_id) await this.caseEvent(q, body.case_id, `Ingreso a ${kind === 'hospital' ? 'hospital' : 'cuarentena'}${body.reason ? `: ${body.reason}` : ''}`, admittedAt);

        return this.detail(q, admissionId);
      });
    } catch (e) {
      if (e instanceof InvalidAdmissionError) {
        if (e.code === 'admission.lot_not_admissible' || e.code === 'admission.kind_mismatch') throw new ConflictException({ code: e.code, title: e.reason });
        throw new BadRequestException({ code: e.code, title: e.reason });
      }
      // La regla de «no antes de nacer» es del dominio sanitario y viaja con su propio error: es un
      // dato mal cargado, así que 400.
      if (e instanceof HealthApplicationError) throw new BadRequestException({ code: e.code, title: e.reason });
      throw e;
    }
  }

  /**
   * Alta sanitaria: mueve el animal al lote destino (`discharge_lot_id`) o, por defecto, de vuelta a su
   * lote anterior (`from_lot_id`). Idempotente: si ya está dada de alta, no-op.
   */
  async discharge(admissionId: string, body: any) {
    return this.db.tx(async (q) => {
      const adm = await q.one<{ id: string; animal_id: string; kind: string; from_lot_id: string | null; status: string; case_id: string | null; admitted_at: string }>(
        `SELECT id, animal_id, kind, from_lot_id, status, case_id, admitted_at::text AS admitted_at FROM health_admissions WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [admissionId, this.db.tenant],
      );
      if (!adm) throw new NotFoundException({ code: 'admission.not_found', title: 'Internación no encontrada' });
      if (adm.status === 'discharged') return { ...(await this.detail(q, admissionId)), already_discharged: true };

      const destLot = body?.discharge_lot_id ?? adm.from_lot_id ?? null;
      if (!destLot) throw new BadRequestException({ code: 'admission.no_destination', title: 'Indicá un lote destino para el alta (no hay lote anterior registrado)' });
      const lot = await q.one<{ id: string }>(`SELECT id FROM lots WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL AND is_active`, [destLot, this.db.tenant]);
      if (!lot) throw new BadRequestException({ code: 'admission.dest_not_found', title: 'Lote destino no encontrado o archivado' });

      const dischargedAt = body?.discharged_at ?? new Date().toISOString();
      /*
       * El alta no puede ser anterior al ingreso.
       *
       * Se aceptaba: un animal internado el 20/7 dado de alta el 2020-01-01 quedaba con MENOS 2.392
       * días de internación, y ese número entra en el promedio de días en el hospital. El módulo de
       * pastoreo ya tiene esta misma guarda para la salida de un potrero —«exit_date no puede ser
       * anterior a entry_date»—; acá faltaba.
       *
       * Se comparan los primeros diez caracteres, que son la fecha calendario: las dos son días, y
       * en `YYYY-MM-DD` el orden alfabético es el cronológico. Convertirlas a `Date` las volvería
       * medianoche UTC y las correría un día en América.
       */
      if (String(dischargedAt).slice(0, 10) < String(adm.admitted_at).slice(0, 10))
        throw new BadRequestException({
          code: 'admission.invalid_discharge',
          title: `El alta (${String(dischargedAt).slice(0, 10)}) no puede ser anterior al ingreso (${String(adm.admitted_at).slice(0, 10)}).`,
        });

      await this.movement.recordMovement(q, {
        animalIds: [adm.animal_id], to: { lot: destLot },
        reason: 'Alta sanitaria', actorUserId: this.db.user, origin: 'web', movementId: randomUUID(), emitServerOrigin: true,
      });
      await q.query(
        `UPDATE health_admissions SET status = 'discharged', discharged_at = $3, discharge_lot_id = $4, health_status = COALESCE($5, health_status), updated_at = now()
         WHERE id = $1 AND tenant_id = $2`,
        [admissionId, this.db.tenant, dischargedAt, destLot, body?.health_status ?? null],
      );
      await this.animalEvent(q, adm.animal_id, 'discharge', { admission_id: admissionId, kind: adm.kind, discharge_lot_id: destLot }, dischargedAt);
      if (adm.case_id) await this.caseEvent(q, adm.case_id, 'Alta sanitaria', dischargedAt);

      return this.detail(q, admissionId);
    });
  }

  /** Internaciones (abiertas por defecto) con días internado y bandera de alta vencida. */
  async list(status = 'admitted') {
    const args: unknown[] = [this.db.tenant];
    const where = [`ha.tenant_id = $1`, `ha.deleted_at IS NULL`];
    if (status !== 'all') {
      args.push(status);
      where.push(`ha.status = $${args.length}`);
    }
    return this.db.query(
      `SELECT ha.id, ha.animal_id, ai.value AS tag, ha.kind, ha.status, ha.reason, ha.health_status,
              ha.admitted_at, ha.expected_discharge_at, ha.discharged_at,
              ha.lot_id, l.name AS lot_name, ha.from_lot_id, fl.name AS from_lot_name,
              (CURRENT_DATE - ha.admitted_at::date)::int AS days_admitted,
              (ha.status = 'admitted' AND ha.expected_discharge_at IS NOT NULL AND ha.expected_discharge_at < CURRENT_DATE) AS overdue
       FROM health_admissions ha
       JOIN animals a ON a.id = ha.animal_id
       LEFT JOIN lots l ON l.id = ha.lot_id
       LEFT JOIN lots fl ON fl.id = ha.from_lot_id
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE ${where.join(' AND ')}
       ORDER BY (ha.status='admitted') DESC, ha.admitted_at DESC LIMIT 200`,
      args,
    );
  }

  private async detail(q: Q, id: string) {
    return q.one<any>(
      `SELECT ha.id, ha.animal_id, ai.value AS tag, ha.case_id, ha.kind, ha.status, ha.reason, ha.health_status,
              ha.admitted_at, ha.expected_discharge_at, ha.discharged_at,
              ha.lot_id, l.name AS lot_name, ha.from_lot_id, fl.name AS from_lot_name, ha.discharge_lot_id
       FROM health_admissions ha
       LEFT JOIN lots l ON l.id = ha.lot_id
       LEFT JOIN lots fl ON fl.id = ha.from_lot_id
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = ha.animal_id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE ha.id = $1 AND ha.tenant_id = $2`,
      [id, this.db.tenant],
    );
  }

  private async animalEvent(q: Q, animalId: string, type: string, payload: Record<string, unknown>, occurredAt: string) {
    await q.query(
      `INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source)
       VALUES ($1,$2,$3,$4,$5,now(),'manual')`,
      [this.db.tenant, animalId, type, JSON.stringify(payload), occurredAt],
    );
  }

  private async caseEvent(q: Q, caseId: string, note: string, occurredAt: string) {
    await q.query(
      `INSERT INTO clinical_case_events (tenant_id, case_id, kind, note, occurred_at, created_by)
       VALUES ($1,$2,'note',$3,$4,$5)`,
      [this.db.tenant, caseId, note, occurredAt, this.db.user],
    );
  }

  private deriveId(baseKey: string, animalId: string): string {
    const h = createHash('sha1').update(`admission:${baseKey}:${animalId}`).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }
}
