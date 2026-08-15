import { Injectable } from '@nestjs/common';
import { computeReproStatus, DEFAULT_REPRO_CONFIG } from '@cowinance/domain';
import type { ReproConfig, ReproFacts } from '@cowinance/domain';
import { DbService } from '../../db/db.service';

/**
 * El ESTADO REPRODUCTIVO derivado: en qué situación está cada vientre según los eventos reales.
 *
 * SEPARADO de `ReproService` porque son dos cosas distintas que solo compartían archivo: allá se
 * REGISTRA lo que pasó (celo, servicio, diagnóstico, parto, destete); acá se DERIVA en qué estado
 * quedó el rodeo. `repro.service.ts` era el servicio más grande del repo (978 líneas).
 *
 * La regla en sí no vive acá: es `computeReproStatus`, función pura del dominio. Este servicio
 * arma los HECHOS que esa regla necesita (`reproFactsSql` es el único lugar que los consulta) y
 * proyecta el resultado a cada superficie: rodeo, ficha del animal, próximas a preparar y las
 * alertas reproductivas. Por eso el estado no se re-implementa en SQL en ningún lado.
 *
 * Depende ÚNICAMENTE de la base. Eso es lo que permite que el motor de alertas lo consuma sin
 * arrastrar las nueve dependencias de `ReproService` solo para pedirle `statusAlerts()`.
 */
@Injectable()
export class ReproStatusService {
  constructor(private readonly db: DbService) {}

  /**
   * Configuración reproductiva del rodeo: días voluntarios de espera y umbrales, leídos de las reglas
   * de alerta configurables (overrides por tenant) con fallback a `DEFAULT_REPRO_CONFIG` del dominio.
   */
  async reproConfig(): Promise<ReproConfig> {
    const rows = await this.db.query<{ code: string; days: number | null; is_active: boolean }>(
      `SELECT condition->>'code' AS code, (condition->>'days')::int AS days, is_active FROM alert_rules WHERE tenant_id=$1 AND deleted_at IS NULL`,
      [this.db.tenant],
    );
    const by = new Map(rows.map((r) => [r.code, r]));
    const n = (code: string, fallback: number) => by.get(code)?.days ?? fallback;
    return {
      ...DEFAULT_REPRO_CONFIG,
      vwpDays: n('vwp_ready', DEFAULT_REPRO_CONFIG.vwpDays),
      diagnosisDueDays: n('diagnosis_due', DEFAULT_REPRO_CONFIG.diagnosisDueDays),
      openTooLongDays: n('open_too_long', DEFAULT_REPRO_CONFIG.openTooLongDays),
      repeatBreederServices: n('repeat_breeder', DEFAULT_REPRO_CONFIG.repeatBreederServices),
      calvingSoonDays: n('calving_soon', DEFAULT_REPRO_CONFIG.calvingSoonDays),
    };
  }

  /**
   * SQL de HECHOS reproductivos por vientre activo (vaca/vaquillona): preñez abierta, último parto,
   * último servicio, último diagnóstico negativo, último aborto, servicios desde el último parto y si
   * el lote está en un protocolo activo. Único lugar que arma los hechos que consume la regla pura
   * `computeReproStatus`. `extraFilter` acota (p. ej. por lote).
   */
  private reproFactsSql(extraFilter = ''): string {
    return `
      SELECT a.id AS animal_id, ai.value AS tag, a.name, a.current_lot_id AS lot_id, l.name AS lot,
             (c.code = 'vaquillona') AS is_heifer,
             p.expected_due_date::text AS expected_due_date,
             cal.last_calving::text AS last_calving, s.last_service::text AS last_service,
             neg.last_neg::text AS last_neg, ab.last_abortion::text AS last_abortion,
             COALESCE(scv.n, 0)::int AS services_since_calving,
             (prot.id IS NOT NULL) AS in_protocol
      FROM animals a
      JOIN animal_categories c ON c.id = a.category_id AND c.code IN ('vaca','vaquillona')
      LEFT JOIN lots l ON l.id = a.current_lot_id
      LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
      LEFT JOIN LATERAL (SELECT expected_due_date FROM pregnancies WHERE animal_id = a.id AND status='open' AND deleted_at IS NULL ORDER BY diagnosis_date DESC LIMIT 1) p ON true
      LEFT JOIN LATERAL (SELECT max(calving_date) AS last_calving FROM calvings WHERE dam_id = a.id AND deleted_at IS NULL) cal ON true
      LEFT JOIN LATERAL (SELECT max(occurred_at::date) AS last_service FROM breeding_events WHERE animal_id = a.id AND type IN ('service_natural','service_ai','embryo_transfer') AND deleted_at IS NULL) s ON true
      LEFT JOIN LATERAL (SELECT max(occurred_at::date) AS last_neg FROM animal_events WHERE animal_id = a.id AND event_type = 'pregnancy_negative' AND deleted_at IS NULL) neg ON true
      LEFT JOIN LATERAL (SELECT max(closed_at) AS last_abortion FROM pregnancies WHERE animal_id = a.id AND status IN ('aborted','lost') AND deleted_at IS NULL) ab ON true
      LEFT JOIN LATERAL (SELECT count(*) AS n FROM breeding_events be WHERE be.animal_id = a.id AND be.type IN ('service_natural','service_ai','embryo_transfer') AND be.deleted_at IS NULL
                          AND be.occurred_at::date > COALESCE((SELECT max(calving_date) FROM calvings WHERE dam_id = a.id AND deleted_at IS NULL), '1900-01-01'::date)) scv ON true
      LEFT JOIN LATERAL (SELECT pa.id FROM repro_protocol_assignments pa WHERE pa.lot_id = a.current_lot_id AND pa.tenant_id = a.tenant_id AND pa.status = 'active' AND pa.deleted_at IS NULL LIMIT 1) prot ON true
      WHERE a.tenant_id = $1 AND a.status = 'active' AND a.deleted_at IS NULL${extraFilter}`;
  }

  private factsOf(r: any): ReproFacts {
    return {
      isHeifer: !!r.is_heifer,
      culledReproductively: false,
      expectedDueDate: r.expected_due_date ? String(r.expected_due_date).slice(0, 10) : null,
      lastCalvingDate: r.last_calving ? String(r.last_calving).slice(0, 10) : null,
      lastServiceDate: r.last_service ? String(r.last_service).slice(0, 10) : null,
      lastPositiveDiagnosisDate: null,
      lastNegativeDiagnosisDate: r.last_neg ? String(r.last_neg).slice(0, 10) : null,
      lastAbortionDate: r.last_abortion ? String(r.last_abortion).slice(0, 10) : null,
      servicesSinceCalving: Number(r.services_since_calving ?? 0),
      inActiveProtocol: !!r.in_protocol,
    };
  }

  /**
   * Estado reproductivo del rodeo: cada vientre ACTIVO con su estado DERIVADO por la regla única
   * `computeReproStatus` desde eventos reales, más días postparto / abiertos / desde servicio. Snapshot.
   */
  async herdStatus(lotId?: string) {
    const params: unknown[] = [this.db.tenant];
    let lotFilter = '';
    if (lotId) {
      params.push(lotId);
      lotFilter = ` AND a.current_lot_id = $${params.length}`;
    }
    const rows = await this.db.query<any>(`${this.reproFactsSql(lotFilter)} ORDER BY ai.value NULLS LAST`, params);
    const config = await this.reproConfig();
    const today = await this.db.today();

    const counts: Record<string, number> = { total: rows.length };
    const out = rows.map((r) => {
      const state = computeReproStatus(this.factsOf(r), config, today);
      counts[state.status] = (counts[state.status] ?? 0) + 1;
      return {
        animal_id: r.animal_id, tag: r.tag ?? null, name: r.name ?? null, lot: r.lot ?? null, lot_id: r.lot_id ?? null,
        status: state.status,
        days_postpartum: state.daysPostpartum, days_open: state.daysOpen, days_since_service: state.daysSinceService,
        expected_due_date: state.expectedDueDate, days_until: state.daysUntilDue,
        eligible_for_service: state.eligibleForService,
      };
    });
    return { lot_id: lotId ?? null, config, counts, rows: out };
  }

  /**
   * Estado reproductivo de UN vientre (para la ficha 360 del animal, A360 E3). Reusa la MISMA
   * regla única `computeReproStatus` y los mismos hechos (reproFactsSql) que herdStatus — sin
   * duplicar el estado. Devuelve null si el animal no es un vientre activo (macho / no vaca-vaquillona).
   */
  async animalStatus(animalId: string) {
    const rows = await this.db.query<any>(`${this.reproFactsSql(' AND a.id = $2')}`, [this.db.tenant, animalId]);
    if (!rows.length) return null;
    const config = await this.reproConfig();
    const today = await this.db.today();
    const r = rows[0];
    const state = computeReproStatus(this.factsOf(r), config, today);
    return {
      animal_id: r.animal_id,
      tag: r.tag ?? null,
      status: state.status,
      days_postpartum: state.daysPostpartum,
      days_open: state.daysOpen,
      days_since_service: state.daysSinceService,
      expected_due_date: state.expectedDueDate,
      days_until: state.daysUntilDue,
      eligible_for_service: state.eligibleForService,
      last_calving: r.last_calving ? String(r.last_calving).slice(0, 10) : null,
      last_service: r.last_service ? String(r.last_service).slice(0, 10) : null,
    };
  }

  /**
   * Próximas vacas a preparar para servicio: vientres en postparto cuyos días postparto alcanzarán el
   * VWP dentro de `withinDays` (aún no lo cumplen). Fuente única de hechos + regla pura.
   */
  async toPrepare(withinDays = 7) {
    const rows = await this.db.query<any>(this.reproFactsSql(), [this.db.tenant]);
    const config = await this.reproConfig();
    const today = await this.db.today();
    const out = rows
      .map((r) => ({ r, state: computeReproStatus(this.factsOf(r), config, today) }))
      .filter(({ state }) => state.daysPostpartum != null && state.expectedDueDate == null
        && state.daysPostpartum < config.vwpDays && config.vwpDays - state.daysPostpartum <= withinDays)
      .map(({ r, state }) => ({
        animal_id: r.animal_id, tag: r.tag ?? null, lot: r.lot ?? null,
        days_postpartum: state.daysPostpartum, days_to_vwp: config.vwpDays - (state.daysPostpartum ?? 0), status: state.status,
      }))
      .sort((a, b) => a.days_to_vwp - b.days_to_vwp);
    return { within_days: withinDays, vwp_days: config.vwpDays, count: out.length, rows: out };
  }

  private async ruleDays(code: string, fallback: number): Promise<number> {
    const r = await this.db.one<{ days: number | null }>(
      `SELECT (condition->>'days')::int AS days FROM alert_rules WHERE tenant_id=$1 AND condition->>'code'=$2 AND deleted_at IS NULL`,
      [this.db.tenant, code],
    );
    return r?.days ?? fallback;
  }

  /**
   * Alertas reproductivas DERIVADAS de la misma regla `computeReproStatus` (no re-implementa el estado
   * en SQL): diagnóstico pendiente / abierta demasiado tiempo / repetidora (por vientre) y agregadas de
   * «listas para servicio» (VWP cumplido) y «próximas a preparar». El motor de alertas filtra por regla
   * activa. Devuelve objetos con la forma `Desired` del módulo de alertas.
   */
  async statusAlerts(): Promise<any[]> {
    const rows = await this.db.query<any>(this.reproFactsSql(), [this.db.tenant]);
    const config = await this.reproConfig();
    const prepDays = await this.ruleDays('service_prep_due', 7);
    const today = await this.db.today();
    const out: any[] = [];
    let vwpReady = 0;
    let prepDue = 0;
    for (const r of rows) {
      const facts = this.factsOf(r);
      const st = computeReproStatus(facts, config, today);
      const tag = r.tag ?? '—';
      if (st.status === 'diagnosis_pending')
        out.push({ code: 'diagnosis_due', category: 'reproduction', severity: 'warning', title: `Diagnóstico pendiente — caravana ${tag}`, message: `Servicio sin diagnóstico hace ${st.daysSinceService} días`, related_type: 'animal', related_id: r.animal_id, due_at: null, tag: r.tag ?? null });
      else if (st.status === 'open')
        out.push({ code: 'open_too_long', category: 'reproduction', severity: 'warning', title: `Vaca abierta — caravana ${tag}`, message: `Abierta hace ${st.daysOpen} días (sin preñez)`, related_type: 'animal', related_id: r.animal_id, due_at: null, tag: r.tag ?? null });
      else if (st.status === 'repeat_breeder')
        out.push({ code: 'repeat_breeder', category: 'reproduction', severity: 'warning', title: `Repetidora — caravana ${tag}`, message: `${facts.servicesSinceCalving} servicios sin preñez`, related_type: 'animal', related_id: r.animal_id, due_at: null, tag: r.tag ?? null });
      if (st.status === 'ready_for_service' && facts.lastCalvingDate) vwpReady++;
      if (st.daysPostpartum != null && st.expectedDueDate == null && st.daysPostpartum < config.vwpDays && config.vwpDays - st.daysPostpartum <= prepDays) prepDue++;
    }
    if (vwpReady > 0)
      out.push({ code: 'vwp_ready', category: 'reproduction', severity: 'info', title: `${vwpReady} vaca${vwpReady === 1 ? '' : 's'} lista${vwpReady === 1 ? '' : 's'} para servicio`, message: `Cumplieron el descanso postparto (${config.vwpDays} días)`, related_type: null, related_id: null, due_at: null, tag: null });
    if (prepDue > 0)
      out.push({ code: 'service_prep_due', category: 'reproduction', severity: 'info', title: `${prepDue} vaca${prepDue === 1 ? '' : 's'} estará${prepDue === 1 ? '' : 'n'} lista${prepDue === 1 ? '' : 's'} para servicio pronto`, message: `Se preparan para servicio en los próximos ${prepDays} días`, related_type: null, related_id: null, due_at: null, tag: null });
    return out;
  }
}
