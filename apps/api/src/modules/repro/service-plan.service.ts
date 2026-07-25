import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  InvalidServicePlanError,
  buildPickingList,
  conceptionBySire,
  cryoLocationLabel,
  shouldReleaseReservation,
  summarizeCampaign,
  summarizeCampaignOutcome,
  validatePlanEntry,
  type DiagnosisResult,
  type Eligibility,
} from '@cowinance/domain';
import { DbService } from '../../db/db.service';
import { StrawsService } from '../genetics/straws.service';

/**
 * Plan de servicio por animal (GT-3).
 *
 * El recorrido que modela: sincronizo un lote → reviso cuáles hicieron cuerpo lúteo → decido DESDE
 * ANTES qué se le pone a cada vientre y de qué pajuela sale → la jornada ejecuta el plan.
 *
 * Lo que este servicio reemplaza es el servicio grupal con un solo toro para las 30. Y lo que hace
 * posible que la ejecución sea rápida es justamente el plan: en la manga no hay que elegir nada, se
 * confirma. La pregunta «¿de qué posición sale esta pajuela?» —que es el costo de tener identidad
 * por unidad— ya quedó contestada en la oficina.
 */
@Injectable()
export class ServicePlanService {
  constructor(
    private readonly db: DbService,
    private readonly straws: StrawsService,
  ) {}

  private dominio<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof InvalidServicePlanError)
        throw new BadRequestException({ code: 'plan.invalid_entry', title: e.message });
      throw e;
    }
  }

  private async requireAssignment(id: string) {
    const a = await this.db.one<any>(
      `SELECT id, status FROM repro_protocol_assignments WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [id, this.db.tenant],
    );
    if (!a) throw new NotFoundException({ code: 'assignment.not_found', title: 'Campaña no encontrada' });
    return a;
  }

  /**
   * La campaña completa: un renglón por vientre, con su revisión, su plan y su ubicación.
   *
   * Es una sola consulta porque es la pantalla que se mira mientras se planifica: 30 vientres con
   * un `n+1` por cada uno serían 30 viajes para armar una tabla.
   */
  async campaign(assignmentId: string) {
    await this.requireAssignment(assignmentId);
    const rows = await this.db.query<any>(
      `SELECT aa.animal_id, aa.eligibility, aa.eligibility_notes,
              tag.value AS animal_tag,
              p.id AS plan_id, p.method, p.semen_batch_id, p.embryo_id, p.straw_id, p.status, p.breeding_event_id,
              b.batch_code, b.sire_name_external, sire.value AS sire_tag,
              e.stage AS embryo_stage, e.grade AS embryo_grade,
              s.code AS straw_code,
              g.code AS goblet_code, c.code AS canister_code, c.color AS canister_color, t.code AS tank_code
       FROM repro_protocol_assignment_animals aa
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = aa.animal_id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) tag ON true
       LEFT JOIN repro_service_plans p ON p.assignment_id = aa.assignment_id AND p.animal_id = aa.animal_id AND p.deleted_at IS NULL
       LEFT JOIN semen_batches b ON b.id = p.semen_batch_id AND b.deleted_at IS NULL
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = b.sire_id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) sire ON true
       LEFT JOIN embryos e ON e.id = p.embryo_id AND e.deleted_at IS NULL
       LEFT JOIN cryo_straws s ON s.id = p.straw_id AND s.deleted_at IS NULL
       LEFT JOIN cryo_goblets g ON g.id = s.goblet_id AND g.deleted_at IS NULL
       LEFT JOIN cryo_canisters c ON c.id = g.canister_id AND c.deleted_at IS NULL
       LEFT JOIN storage_tanks t ON t.id = c.tank_id AND t.deleted_at IS NULL
       WHERE aa.assignment_id = $1 AND aa.tenant_id = $2
       ORDER BY tag.value NULLS LAST, aa.animal_id`,
      [assignmentId, this.db.tenant],
    );

    return {
      assignment_id: assignmentId,
      summary: summarizeCampaign(rows.map((r) => ({ eligibility: r.eligibility, status: r.status, straw_id: r.straw_id }))),
      animals: rows.map((r) => ({
        ...r,
        origin_label: this.origenLegible(r),
        location_label: cryoLocationLabel({
          tank_code: r.tank_code,
          canister_code: r.canister_code,
          canister_color: r.canister_color,
          goblet_code: r.goblet_code,
        }),
      })),
    };
  }

  private origenLegible(r: any): string | null {
    if (r.method === 'ai') return r.sire_tag ?? r.sire_name_external ?? r.batch_code ?? 'semen';
    if (r.method === 'embryo_transfer') return [r.embryo_stage, r.embryo_grade].filter(Boolean).join(' ') || 'embrión';
    return null;
  }

  /**
   * Resultado de la revisión (el paso `review` del protocolo: ¿hizo cuerpo lúteo?).
   *
   * Marcar «no apta» SUELTA la pajuela en el mismo movimiento. Si la liberación no fuera automática,
   * cada campaña dejaría reservas de vientres que nunca se sirvieron, y en tres campañas el «libre»
   * del termo no significaría nada.
   */
  async setEligibility(assignmentId: string, animalId: string, eligibility: Eligibility, notes?: string) {
    await this.requireAssignment(assignmentId);
    if (!['pending', 'eligible', 'not_eligible'].includes(eligibility))
      throw new BadRequestException({ code: 'plan.invalid_eligibility', title: "eligibility debe ser 'pending', 'eligible' o 'not_eligible'" });

    const fila = await this.db.one<any>(
      `UPDATE repro_protocol_assignment_animals
       SET eligibility=$3::text, eligibility_at=now(), eligibility_notes=$4
       WHERE assignment_id=$1 AND animal_id=$2 AND tenant_id=$5
       RETURNING animal_id, eligibility`,
      [assignmentId, animalId, eligibility, notes ?? null, this.db.tenant],
    );
    if (!fila) throw new NotFoundException({ code: 'plan.animal_not_in_campaign', title: 'El animal no está en esta campaña' });

    const plan = await this.db.one<any>(
      `SELECT id, straw_id, status FROM repro_service_plans
       WHERE assignment_id=$1 AND animal_id=$2 AND tenant_id=$3 AND deleted_at IS NULL`,
      [assignmentId, animalId, this.db.tenant],
    );

    let released = false;
    if (plan && shouldReleaseReservation(eligibility, plan.status)) {
      if (plan.straw_id) await this.straws.release(this.db, plan.straw_id);
      await this.db.query(
        `UPDATE repro_service_plans SET status='released', updated_at=now() WHERE id=$1 AND tenant_id=$2`,
        [plan.id, this.db.tenant],
      );
      released = true;
    }
    return { ...fila, reservation_released: released };
  }

  /**
   * Asigna qué se le pone a un vientre y reserva su pajuela.
   *
   * Replanificar reemplaza lo anterior y suelta la pajuela vieja: dos reservas vivas para el mismo
   * vientre serían dos pajuelas apartadas para un solo servicio.
   */
  async plan(assignmentId: string, body: any) {
    await this.requireAssignment(assignmentId);
    const entry = this.dominio(() => validatePlanEntry(body));

    const enCampaña = await this.db.one<{ animal_id: string; eligibility: Eligibility }>(
      `SELECT animal_id, eligibility FROM repro_protocol_assignment_animals
       WHERE assignment_id=$1 AND animal_id=$2 AND tenant_id=$3`,
      [assignmentId, entry.animal_id, this.db.tenant],
    );
    if (!enCampaña) throw new NotFoundException({ code: 'plan.animal_not_in_campaign', title: 'El animal no está en esta campaña' });
    // Planificar un vientre que la revisión ya descartó es trabajo que se va a tirar, y encima
    // apartaría una pajuela que otra vaca podría usar.
    if (enCampaña.eligibility === 'not_eligible')
      throw new ConflictException({ code: 'plan.animal_not_eligible', title: 'Ese vientre quedó fuera de la jornada en la revisión.' });

    return this.db.tx(async (q) => {
      const previo = await q.one<any>(
        `SELECT id, straw_id, status FROM repro_service_plans
         WHERE assignment_id=$1 AND animal_id=$2 AND tenant_id=$3 AND deleted_at IS NULL FOR UPDATE`,
        [assignmentId, entry.animal_id, this.db.tenant],
      );
      if (previo?.status === 'served')
        throw new ConflictException({ code: 'plan.already_served', title: 'Ese vientre ya fue servido: no se puede replanificar.' });

      if (previo?.straw_id && previo.straw_id !== entry.straw_id) await this.straws.release(q, previo.straw_id);
      if (entry.straw_id) await this.straws.reserve(q, entry.straw_id, entry.animal_id);

      if (previo) {
        const r = await q.query<any>(
          `UPDATE repro_service_plans
           SET method=$3, semen_batch_id=$4, embryo_id=$5, straw_id=$6, status='planned', notes=$7, updated_at=now()
           WHERE id=$1 AND tenant_id=$2
           RETURNING id, animal_id, method, semen_batch_id, embryo_id, straw_id, status`,
          [previo.id, this.db.tenant, entry.method, entry.semen_batch_id, entry.embryo_id, entry.straw_id, body?.notes ?? null],
        );
        return r[0];
      }
      const r = await q.query<any>(
        `INSERT INTO repro_service_plans (tenant_id, assignment_id, animal_id, method, semen_batch_id, embryo_id, straw_id, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, animal_id, method, semen_batch_id, embryo_id, straw_id, status`,
        [this.db.tenant, assignmentId, entry.animal_id, entry.method, entry.semen_batch_id, entry.embryo_id, entry.straw_id, body?.notes ?? null, this.db.user],
      );
      return r[0];
    });
  }

  /** Saca a un vientre del plan y devuelve su pajuela al stock. */
  async unplan(assignmentId: string, animalId: string) {
    return this.db.tx(async (q) => {
      const plan = await q.one<any>(
        `SELECT id, straw_id, status FROM repro_service_plans
         WHERE assignment_id=$1 AND animal_id=$2 AND tenant_id=$3 AND deleted_at IS NULL FOR UPDATE`,
        [assignmentId, animalId, this.db.tenant],
      );
      if (!plan) throw new NotFoundException({ code: 'plan.not_found', title: 'Ese vientre no tiene plan' });
      if (plan.status === 'served')
        throw new ConflictException({ code: 'plan.already_served', title: 'Ese vientre ya fue servido: corregí el servicio.' });

      if (plan.straw_id) await this.straws.release(q, plan.straw_id);
      await q.query(`UPDATE repro_service_plans SET deleted_at=now(), updated_at=now() WHERE id=$1 AND tenant_id=$2`, [plan.id, this.db.tenant]);
      return { ok: true };
    });
  }

  /**
   * Lista de retiro: qué sacar del termo, agrupado por posición.
   *
   * Solo entra lo que se va a servir de verdad — planificado y con el vientre apto. Incluir un
   * descartado haría abrir el termo por una pajuela que vuelve sin usarse, y cada apertura evapora
   * nitrógeno.
   */
  async pickingList(assignmentId: string) {
    await this.requireAssignment(assignmentId);
    const rows = await this.db.query<any>(
      `SELECT p.straw_id, tag.value AS animal_tag,
              COALESCE(sire.value, b.sire_name_external, b.batch_code, e.stage, 'embrión') AS origin_label,
              t.code AS tank_code, c.code AS canister_code, c.color AS canister_color, g.code AS goblet_code
       FROM repro_service_plans p
       JOIN repro_protocol_assignment_animals aa ON aa.assignment_id = p.assignment_id AND aa.animal_id = p.animal_id
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = p.animal_id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) tag ON true
       LEFT JOIN semen_batches b ON b.id = p.semen_batch_id AND b.deleted_at IS NULL
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = b.sire_id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) sire ON true
       LEFT JOIN embryos e ON e.id = p.embryo_id AND e.deleted_at IS NULL
       LEFT JOIN cryo_straws s ON s.id = p.straw_id AND s.deleted_at IS NULL
       LEFT JOIN cryo_goblets g ON g.id = s.goblet_id AND g.deleted_at IS NULL
       LEFT JOIN cryo_canisters c ON c.id = g.canister_id AND c.deleted_at IS NULL
       LEFT JOIN storage_tanks t ON t.id = c.tank_id AND t.deleted_at IS NULL
       WHERE p.assignment_id = $1 AND p.tenant_id = $2 AND p.deleted_at IS NULL
         AND p.status = 'planned' AND p.straw_id IS NOT NULL
         AND aa.eligibility <> 'not_eligible'`,
      [assignmentId, this.db.tenant],
    );
    return { assignment_id: assignmentId, lines: buildPickingList(rows) };
  }

  /**
   * Marca el plan como ejecutado. La llama reproducción DESPUÉS de registrar el servicio, con la
   * pajuela que entró de verdad — que puede no ser la planificada: el técnico que está con la vaca
   * adelante sabe más que el plan de ayer, y el desvío queda registrado en vez de perderse.
   */
  async markServed(assignmentId: string, animalId: string, breedingEventId: string, strawId: string | null) {
    const r = await this.db.query<any>(
      `UPDATE repro_service_plans
       SET status='served', breeding_event_id=$4, straw_id=COALESCE($5, straw_id), served_at=now(), updated_at=now()
       WHERE assignment_id=$1 AND animal_id=$2 AND tenant_id=$3 AND deleted_at IS NULL AND status='planned'
       RETURNING id, straw_id`,
      [assignmentId, animalId, this.db.tenant, breedingEventId, strawId],
    );
    return r[0] ?? null;
  }

  // ───────────────────── Cierre de la campaña (GT-3b) ─────────────────────

  /**
   * El diagnóstico de cada vientre servido, DERIVADO. No hay columna que lo guarde, y es
   * deliberado: el diagnóstico ya vive en `pregnancies` y en el timeline del animal, que es donde
   * lo escriben todos los canales. Copiarlo acá daría dos fuentes del mismo hecho.
   *
   * - Preñada: existe una preñez atada al MISMO servicio que ejecutó el plan. Atarla al servicio y
   *   no al animal es lo que impide contarle a esta campaña una preñez de un servicio posterior.
   * - Vacía / dudosa: el diagnóstico más reciente del animal POSTERIOR al servicio.
   */
  private diagnosisSubquery() {
    return `
      LEFT JOIN LATERAL (
        SELECT 'pregnant'::text AS result
        FROM pregnancies pg
        WHERE pg.breeding_event_id = p.breeding_event_id AND pg.tenant_id = p.tenant_id AND pg.deleted_at IS NULL
        LIMIT 1
      ) preg ON true
      LEFT JOIN LATERAL (
        SELECT CASE WHEN ev.event_type = 'pregnancy_negative' THEN 'empty' ELSE 'doubtful' END AS result
        FROM animal_events ev
        WHERE ev.animal_id = p.animal_id AND ev.tenant_id = p.tenant_id
          AND ev.event_type IN ('pregnancy_negative','pregnancy_doubtful')
          -- Se compara por DÍA y no por instante: el diagnóstico se registra con fecha (queda a
          -- medianoche), así que contra la hora exacta del servicio uno del mismo día caería antes
          -- y no se contaría. La jornada y la ecografía nunca son el mismo día en la práctica, pero
          -- en una prueba —o en una carga retroactiva— sí, y ahí el resultado se perdía.
          AND ev.occurred_at::date >= p.served_at::date
        ORDER BY ev.occurred_at DESC LIMIT 1
      ) neg ON true`;
  }

  /**
   * Resultado de la campaña: la IATF no termina al inseminar sino a los ~28 días, cuando se sabe
   * quiénes quedaron preñadas. Sin este cierre nunca se averigua si la campaña funcionó — ni, sobre
   * todo, QUÉ TORO funcionó, que es el número que decide qué semen se vuelve a comprar.
   */
  async outcome(assignmentId: string) {
    await this.requireAssignment(assignmentId);
    const rows = await this.db.query<any>(
      `SELECT p.animal_id, p.status, p.breeding_event_id, p.served_at,
              tag.value AS animal_tag,
              COALESCE(preg.result, neg.result) AS diagnosis,
              COALESCE(sire.value, b.sire_name_external, b.batch_code) AS sire_label,
              COALESCE(b.sire_id::text, p.semen_batch_id::text, p.embryo_id::text) AS sire_key
       FROM repro_service_plans p
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = p.animal_id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) tag ON true
       LEFT JOIN semen_batches b ON b.id = p.semen_batch_id AND b.deleted_at IS NULL
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = b.sire_id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) sire ON true
       ${this.diagnosisSubquery()}
       WHERE p.assignment_id = $1 AND p.tenant_id = $2 AND p.deleted_at IS NULL
       ORDER BY tag.value NULLS LAST`,
      [assignmentId, this.db.tenant],
    );

    const servidos = rows.map((r) => ({ served: r.status === 'served', diagnosis: (r.diagnosis ?? null) as DiagnosisResult | null }));
    return {
      assignment_id: assignmentId,
      outcome: summarizeCampaignOutcome(servidos),
      by_sire: conceptionBySire(
        rows
          .filter((r) => r.status === 'served')
          .map((r) => ({ sire_key: r.sire_key ?? 'sin-toro', sire_label: r.sire_label ?? 'sin identificar', diagnosis: r.diagnosis ?? null })),
      ),
      animals: rows.map((r) => ({
        animal_id: r.animal_id,
        animal_tag: r.animal_tag,
        served: r.status === 'served',
        sire_label: r.sire_label,
        diagnosis: r.diagnosis ?? null,
      })),
    };
  }

  /**
   * Tasa de concepción por toro sobre TODAS las campañas.
   *
   * Acá se cierra el lazo que abrió el termo: pajuela → vaca → preñez → tasa por toro → qué semen
   * se vuelve a comprar. Es lo único que convierte al termo de depósito en instrumento de medición.
   */
  async conceptionBySire() {
    const rows = await this.db.query<any>(
      `SELECT COALESCE(preg.result, neg.result) AS diagnosis,
              COALESCE(sire.value, b.sire_name_external, b.batch_code) AS sire_label,
              COALESCE(b.sire_id::text, p.semen_batch_id::text) AS sire_key
       FROM repro_service_plans p
       JOIN semen_batches b ON b.id = p.semen_batch_id AND b.deleted_at IS NULL
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = b.sire_id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) sire ON true
       ${this.diagnosisSubquery()}
       WHERE p.tenant_id = $1 AND p.deleted_at IS NULL AND p.status = 'served'`,
      [this.db.tenant],
    );
    return conceptionBySire(
      rows.map((r) => ({ sire_key: r.sire_key ?? 'sin-toro', sire_label: r.sire_label ?? 'sin identificar', diagnosis: r.diagnosis ?? null })),
    );
  }

  /** El plan vigente de un vientre: lo que la jornada tiene que ejecutar. */
  async planFor(assignmentId: string, animalId: string) {
    return this.db.one<any>(
      `SELECT id, method, semen_batch_id, embryo_id, straw_id, status
       FROM repro_service_plans
       WHERE assignment_id=$1 AND animal_id=$2 AND tenant_id=$3 AND deleted_at IS NULL AND status='planned'`,
      [assignmentId, animalId, this.db.tenant],
    );
  }
}
