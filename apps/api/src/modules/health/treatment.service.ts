import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { assertTreatable, computeWithdrawal, TREATMENT_APPLIED } from '@cowinance/domain';
import type { TreatmentApplied } from '@cowinance/domain';
import { DbService, Q } from '../../db/db.service';

/**
 * Núcleo NEUTRAL de tratamientos (Sanidad E1). Regla y escritura ÚNICAS de la
 * aplicación de un tratamiento veterinario, reutilizadas por REST/web y por el sync
 * entrante — mismo patrón que `MortalityService`. Cada canal aporta CONTEXTO
 * (`origin`, `treatmentId`, valores propuestos por el cliente); el cuerpo no ramifica
 * por canal ni reimplementa el retiro.
 *
 * El tratamiento es una INTENCIÓN ATÓMICA: en una sola tx produce (1) UNA fila
 * `treatments` con los retiros DERIVADOS por dominio (Server Authority, ADR-0007), (2)
 * UN evento `treatment` de timeline en `animal_events`, y (3) UN evento de dominio
 * `TreatmentApplied` en el outbox (misma tx). Idempotente por `treatmentId`
 * (= id de la fila; `op.rowId` en sync): reprocesar no crea otra fila, otro timeline
 * ni otro evento.
 *
 * Validaciones (regla pura del dominio, `assertTreatable`): el animal debe existir en el
 * tenant y estar ACTIVO — no se trata un animal muerto/vendido/inactivo. El producto debe
 * pertenecer al tenant. Ambos rechazos son SIN persistencia parcial (el handler de sync los
 * mapea a conflicto semántico; REST los devuelve como 404/409).
 *
 * Server Authority sobre el retiro: `meat/milk_withdrawal_until` se recalculan siempre desde
 * el producto; si el cliente propuso otros valores (sync), el resultado expone el desajuste
 * en `withdrawalMismatch` para que el canal lo registre como conflicto auto-resuelto.
 */

export type TreatmentOrigin = 'rest' | 'sync';

export interface RecordTreatmentInput {
  animalId: string;
  productId: string;
  appliedAt?: string;
  dose?: number | null;
  doseUnit?: string | null;
  route?: string | null;
  diagnosisId?: string | null;
  clinicalCaseId?: string | null;
  nextReviewDate?: string | null;
  cost?: number | null;
  notes?: string | null;
  actorUserId: string;
  origin: TreatmentOrigin;
  /** Clave de idempotencia = id de la fila `treatments` (uuid en REST, op id en sync). */
  treatmentId: string;
  /** Valores de retiro propuestos por el cliente (sync); se contrastan con el cálculo del servidor. */
  clientMeatWithdrawalUntil?: string | null;
  clientMilkWithdrawalUntil?: string | null;
}

export interface WithdrawalMismatch {
  field: 'meat_withdrawal_until' | 'milk_withdrawal_until';
  client: string | null;
  server: string | null;
}

export interface RecordTreatmentResult {
  recorded: boolean;
  /** true si `treatmentId` ya estaba registrado → no-op idempotente. */
  alreadyRecorded: boolean;
  treatmentId: string;
  appliedAt: string;
  meatWithdrawalUntil: string | null;
  milkWithdrawalUntil: string | null;
  tag: string | null;
  product: string | null;
  /** Desajustes cliente vs servidor sobre el retiro (Server Authority). Vacío en REST. */
  withdrawalMismatch: WithdrawalMismatch[];
}

@Injectable()
export class TreatmentService {
  constructor(private readonly db: DbService) {}

  async recordTreatment(q: Q, input: RecordTreatmentInput): Promise<RecordTreatmentResult> {
    const t = this.db.tenant;

    // Idempotencia: la misma operación (mismo id) ya registrada → no-op total.
    const existing = await q.one<{ id: string; applied_at: string; meat_withdrawal_until: string | null; milk_withdrawal_until: string | null }>(
      `SELECT id, applied_at, meat_withdrawal_until, milk_withdrawal_until FROM treatments WHERE id = $1 AND tenant_id = $2`,
      [input.treatmentId, t],
    );
    if (existing) {
      return {
        recorded: false, alreadyRecorded: true, treatmentId: input.treatmentId,
        appliedAt: existing.applied_at, meatWithdrawalUntil: existing.meat_withdrawal_until,
        milkWithdrawalUntil: existing.milk_withdrawal_until, tag: null, product: null, withdrawalMismatch: [],
      };
    }

    const animal = await this.requireAnimal(q, input.animalId);
    assertTreatable(animal.status, animal.tag);
    const product = await this.requireProduct(q, input.productId);

    const appliedAt = new Date(input.appliedAt ?? Date.now());

    // La dosis tiene que ser una dosis. Una negativa entraba y ensuciaba el consumo y el costo del
    // período; peor, si el producto está enlazado al inventario, descontar una cantidad negativa
    // SUMA stock — el sistema termina diciendo que hay más frascos de los que hay.
    if (input.dose != null && !(Number(input.dose) > 0))
      throw new BadRequestException({
        code: 'treatment.invalid_dose',
        title: 'La dosis tiene que ser mayor que cero. Si no la anotaste, dejá el campo vacío.',
      });

    // Un tratamiento es un HECHO: no puede estar en el futuro. Y acá el tipeo se paga doble, porque
    // la fecha de aplicación es la que arranca el retiro: un 2030 deja al animal retirado cuatro
    // años.
    const hoy = await this.db.today(q);
    if (appliedAt.toISOString().slice(0, 10) > hoy)
      throw new BadRequestException({
        code: 'treatment.future_date',
        title: `La fecha de aplicación es futura. Un tratamiento se registra cuando se aplicó.`,
      });
    // Server Authority: el retiro es SIEMPRE el derivado por el dominio desde el producto.
    // La zona de la FINCA: el retiro de carne se cuenta en días de calendario, y el calendario es
    // el de donde está el animal. Calcularlo en UTC lo corría un día — tarde de este lado del
    // meridiano y ANTES del otro, que es carne con residuos habilitada para vender.
    const { meatWithdrawalUntil, milkWithdrawalUntil } = computeWithdrawal(
      // Se pasa lo que llegó, sin convertir a Date primero: una fecha pelada («2026-06-01», lo que
      // manda el formulario) es un día calendario y no un instante, y `new Date()` la volvería
      // medianoche UTC — que en América es el día anterior.
      input.appliedAt ?? appliedAt, product.withdrawal_meat_days, product.withdrawal_milk_hours, await this.db.timeZone(q),
    );
    const withdrawalMismatch = this.detectMismatch(input, meatWithdrawalUntil, milkWithdrawalUntil);

    // (1) hecho: fila treatments con id determinista = treatmentId. Puede vincularse a un caso clínico.
    await q.query(
      `INSERT INTO treatments (id, tenant_id, animal_id, diagnosis_id, clinical_case_id, product_id, applied_at, dose, dose_unit, route,
                               meat_withdrawal_until, milk_withdrawal_until, applied_by, cost, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (id) DO NOTHING`,
      [
        input.treatmentId, t, input.animalId, input.diagnosisId ?? null, input.clinicalCaseId ?? null, input.productId, appliedAt.toISOString(),
        input.dose ?? null, input.doseUnit ?? null, input.route ?? null, meatWithdrawalUntil, milkWithdrawalUntil,
        input.actorUserId, input.cost ?? null, input.notes ?? null, input.actorUserId,
      ],
    );

    // (2) timeline: un evento treatment (llega por ambos canales — sync ya no queda sin línea de tiempo).
    await q.query(
      `INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source)
       VALUES ($1,$2,'treatment',$3,$4,now(),'manual')`,
      [t, input.animalId, JSON.stringify({
        product: product.name, dose: input.dose ?? null, route: input.route ?? null,
        withdrawal_meat_until: meatWithdrawalUntil, withdrawal_milk_until: milkWithdrawalUntil,
        diagnosis_id: input.diagnosisId ?? null, origin: input.origin,
      }), appliedAt.toISOString()],
    );

    // (3) evento de dominio (F5, ADR-0005): fila de outbox en la MISMA tx que el hecho, con el
    // `q` EXPLÍCITO (mismo criterio que los writers de sync de mortalidad: un núcleo neutral no
    // depende del enrutado por ALS del puerto EventPublisher, que además no recibe `q`). El
    // `OutboxRelay` lo publica post-commit; misma tabla/mismo contrato que `OutboxEventPublisher`.
    const event: TreatmentApplied = {
      eventId: randomUUID(), type: TREATMENT_APPLIED, occurredAt: appliedAt.toISOString(),
      treatmentId: input.treatmentId, animalId: input.animalId, productId: input.productId,
      appliedAt: appliedAt.toISOString(), meatWithdrawalUntil, milkWithdrawalUntil,
    };
    await q.query(
      `INSERT INTO event_outbox (id, tenant_id, type, payload, occurred_at)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
      [event.eventId, t, event.type, JSON.stringify(event), event.occurredAt],
    );

    return {
      recorded: true, alreadyRecorded: false, treatmentId: input.treatmentId, appliedAt: appliedAt.toISOString(),
      meatWithdrawalUntil, milkWithdrawalUntil, tag: animal.tag, product: product.name, withdrawalMismatch,
    };
  }

  private detectMismatch(input: RecordTreatmentInput, meat: string | null, milk: string | null): WithdrawalMismatch[] {
    const out: WithdrawalMismatch[] = [];
    if (input.clientMeatWithdrawalUntil !== undefined && (input.clientMeatWithdrawalUntil ?? null) !== meat)
      out.push({ field: 'meat_withdrawal_until', client: input.clientMeatWithdrawalUntil ?? null, server: meat });
    if (input.clientMilkWithdrawalUntil !== undefined && (input.clientMilkWithdrawalUntil ?? null) !== milk)
      out.push({ field: 'milk_withdrawal_until', client: input.clientMilkWithdrawalUntil ?? null, server: milk });
    return out;
  }

  private async requireAnimal(q: Q, animalId: string) {
    const row = await q.one<{ id: string; status: string; tag: string | null }>(
      `SELECT a.id, a.status, ai.value AS tag
       FROM animals a
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE a.id = $1 AND a.tenant_id = $2 AND a.deleted_at IS NULL`,
      [animalId, this.db.tenant],
    );
    if (!row) throw new HealthApplicationLookupError('animal.not_found', 'Animal no encontrado');
    return row;
  }

  private async requireProduct(q: Q, id: string) {
    const p = await q.one<{ id: string; name: string; withdrawal_meat_days: number | null; withdrawal_milk_hours: number | null }>(
      `SELECT id, name, withdrawal_meat_days, withdrawal_milk_hours FROM products_veterinary
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!p) throw new HealthApplicationLookupError('product.not_found', 'Producto veterinario no encontrado');
    return p;
  }
}

/** Error de lookup (animal/producto no encontrado) sin acoplar el núcleo neutral a Nest. */
export class HealthApplicationLookupError extends Error {
  constructor(
    public readonly code: string,
    public readonly reason: string,
  ) {
    super(reason);
    this.name = 'HealthApplicationLookupError';
  }
}
