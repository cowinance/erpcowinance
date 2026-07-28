import { Injectable } from '@nestjs/common';
import { addFarmDays } from '@cowinance/domain';
import { DbService } from '../../db/db.service';
import { ReproService } from './repro.service';
import { computeSyncResponse } from '@cowinance/domain';

/**
 * Reportes reproductivos (Reproducción E5). KPIs de período (concepción, servicios/concepción,
 * intervalos), desempeño por toro/semen, y listas accionables (abiertas, repetidoras, diagnósticos
 * pendientes, abortos). Las listas derivadas del ESTADO reusan la regla única `computeReproStatus`
 * vía `ReproService.herdStatus` (no re-implementan el estado en SQL). Complementa el reporte de índices
 * de P9 (`reports.service.reproduction`) sin duplicarlo.
 */
@Injectable()
export class ReproReportsService {
  constructor(
    private readonly db: DbService,
    private readonly repro: ReproService,
  ) {}

  /** Rango por defecto contado desde HOY EN LA FINCA, sobre el calendario (sin husos ni verano). */
  private async range(from?: string, to?: string): Promise<[string, string]> {
    const toD = to ? String(to).slice(0, 10) : await this.db.today();
    const fromD = from ? String(from).slice(0, 10) : addFarmDays(toD, -365);
    return [fromD, toD];
  }

  /**
   * Cuántas de las receptoras preparadas respondieron a la sincronización.
   *
   * Es lo que dice cuántas hay que sincronizar la próxima vez para colocar los embriones que se
   * tienen. Sin este número el productor prepara vacas a ciegas: si responde la mitad y sincroniza
   * veinte para veinte embriones, diez se quedan un año más en el termo.
   *
   * El denominador son TODAS las revisadas —no solo las que fallaron—, porque una transferencia se
   * anota sola como respuesta afirmativa: no se puede transferir sin cuerpo lúteo.
   */
  async synchronization(fromRaw?: string, toRaw?: string) {
    const [from, to] = await this.range(fromRaw, toRaw);
    const fila = await this.db.one<{ checked: number; responded: number }>(
      `SELECT count(*)::int AS checked,
              count(*) FILTER (WHERE (payload->>'responded')::boolean)::int AS responded
         FROM animal_events
        WHERE tenant_id = $1 AND deleted_at IS NULL AND event_type = 'synchronization_check'
          AND occurred_at::date BETWEEN $2::date AND $3::date`,
      [this.db.tenant, from, to],
    );

    // Las que no respondieron, con nombre: el productor quiere saber CUÁLES para mirarlas —condición
    // corporal, si estaban en anestro, si conviene volver a sincronizarlas—.
    const sinRespuesta = await this.db.query<any>(
      `SELECT e.animal_id, ai.value AS tag, a.name, e.occurred_at::date::text AS fecha
         FROM animal_events e
         JOIN animals a ON a.id = e.animal_id AND a.deleted_at IS NULL
         LEFT JOIN LATERAL (
           SELECT value FROM animal_identifiers x
            WHERE x.animal_id = e.animal_id AND x.type='visual' AND x.deleted_at IS NULL AND x.retired_at IS NULL
            ORDER BY x.created_at DESC LIMIT 1) ai ON true
        WHERE e.tenant_id = $1 AND e.deleted_at IS NULL AND e.event_type = 'synchronization_check'
          AND (e.payload->>'responded')::boolean IS NOT TRUE
          AND e.occurred_at::date BETWEEN $2::date AND $3::date
        ORDER BY e.occurred_at DESC`,
      [this.db.tenant, from, to],
    );

    return {
      from,
      to,
      ...computeSyncResponse({ checked: fila?.checked ?? 0, responded: fila?.responded ?? 0 }),
      not_responded: sinRespuesta,
    };
  }

  /** KPIs reproductivos del período: servicios, concepción, partos (vivos/muertos), abortos, destetes, intervalos. */
  async summary(fromRaw?: string, toRaw?: string) {
    const [from, to] = await this.range(fromRaw, toRaw);
    const t = this.db.tenant;
    const [svc, diag, calv, abort, wean, iep, openAvg] = await Promise.all([
      this.db.one<any>(
        `SELECT count(*) FILTER (WHERE type='service_ai')::int AS ai,
                count(*) FILTER (WHERE type='service_natural')::int AS natural,
                count(*) FILTER (WHERE type='embryo_transfer')::int AS embryo
         FROM breeding_events WHERE tenant_id=$1 AND deleted_at IS NULL AND occurred_at::date BETWEEN $2 AND $3`,
        [t, from, to],
      ),
      this.db.one<any>(
        `SELECT (SELECT count(*)::int FROM pregnancies WHERE tenant_id=$1 AND deleted_at IS NULL AND diagnosis_date BETWEEN $2 AND $3) AS pregnant,
                (SELECT count(*)::int FROM animal_events WHERE tenant_id=$1 AND deleted_at IS NULL AND event_type='pregnancy_negative' AND occurred_at::date BETWEEN $2 AND $3) AS empty`,
        [t, from, to],
      ),
      this.db.one<any>(
        `SELECT count(DISTINCT c.id)::int AS n,
                count(*) FILTER (WHERE o.vitality='live')::int AS live,
                count(*) FILTER (WHERE o.vitality IN ('stillborn','died_soon'))::int AS dead
         -- o.deleted_at IS NULL va en el JOIN y no en el WHERE: en el WHERE convertiría el LEFT en
         -- INNER y perdería los partos sin crías cargadas. Sin él, una cría borrada seguía contando
         -- como viva o muerta.
         FROM calvings c LEFT JOIN calving_offspring o ON o.calving_id = c.id AND o.deleted_at IS NULL
         WHERE c.tenant_id=$1 AND c.deleted_at IS NULL AND c.calving_date BETWEEN $2 AND $3`,
        [t, from, to],
      ),
      this.db.one<any>(
        `SELECT count(*)::int AS n FROM pregnancies WHERE tenant_id=$1 AND deleted_at IS NULL AND status IN ('aborted','lost') AND closed_at BETWEEN $2 AND $3`,
        [t, from, to],
      ),
      this.db.one<any>(
        `SELECT count(*)::int AS n, round(avg(weaning_weight_kg))::int AS avg_kg FROM weanings WHERE tenant_id=$1 AND deleted_at IS NULL AND weaning_date BETWEEN $2 AND $3`,
        [t, from, to],
      ),
      this.db.one<any>(
        `SELECT round(avg(gap))::int AS dias FROM (
           SELECT (calving_date - LAG(calving_date) OVER (PARTITION BY dam_id ORDER BY calving_date, id)) AS gap, calving_date
           FROM calvings WHERE tenant_id=$1 AND deleted_at IS NULL
         ) g WHERE g.gap IS NOT NULL AND g.calving_date BETWEEN $2 AND $3`,
        [t, from, to],
      ),
      // Días abiertos promedio: snapshot de vacas abiertas (con parto, sin preñez) a hoy.
      this.db.one<any>(
        `SELECT round(avg(CURRENT_DATE - cal.last_calving))::int AS dias
         FROM animals a JOIN animal_categories c ON c.id=a.category_id AND c.code IN ('vaca','vaquillona')
         LEFT JOIN LATERAL (SELECT max(calving_date) AS last_calving FROM calvings WHERE dam_id=a.id AND deleted_at IS NULL) cal ON true
         WHERE a.tenant_id=$1 AND a.status='active' AND a.deleted_at IS NULL AND cal.last_calving IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM pregnancies p WHERE p.animal_id=a.id AND p.status='open' AND p.deleted_at IS NULL)`,
        [t],
      ),
    ]);
    const services = (svc?.ai ?? 0) + (svc?.natural ?? 0) + (svc?.embryo ?? 0);
    const pregnant = diag?.pregnant ?? 0;
    const empty = diag?.empty ?? 0;
    const diagnosed = pregnant + empty;
    return {
      from, to,
      services: { ai: svc?.ai ?? 0, natural: svc?.natural ?? 0, embryo: svc?.embryo ?? 0, total: services },
      diagnoses: { pregnant, empty, conception_rate_pct: diagnosed > 0 ? +((pregnant / diagnosed) * 100).toFixed(1) : null },
      services_per_conception: pregnant > 0 ? +(services / pregnant).toFixed(2) : null,
      calvings: { n: calv?.n ?? 0, live: calv?.live ?? 0, dead: calv?.dead ?? 0 },
      abortions: abort?.n ?? 0,
      weanings: { n: wean?.n ?? 0, avg_weight_kg: wean?.avg_kg ?? null, rate_pct: (calv?.n ?? 0) > 0 ? +(((wean?.n ?? 0) / calv.n) * 100).toFixed(1) : null },
      avg_calving_interval_days: iep?.dias ?? null,
      avg_days_open: openAvg?.dias ?? null,
    };
  }

  /** Desempeño por toro/semen: servicios, concepciones (preñeces del servicio) y tasa de concepción. */
  async byBull(fromRaw?: string, toRaw?: string) {
    const [from, to] = await this.range(fromRaw, toRaw);
    return this.db.query(
      `SELECT be.sire_id, ai.value AS tag, s.name AS sire_name,
              -- DISTINCT en los tres: nada impide en el esquema que un mismo servicio termine con
              -- más de una preñez ligada (no hay UNIQUE sobre pregnancies.breeding_event_id), y sin
              -- DISTINCT ese servicio contaría dos veces como servicio Y como concepción, empujando
              -- la fertilidad del toro hacia el 100%.
              --
              -- Pasa cuando el toro anda suelto con el rodeo y los servicios no se anotan uno por
              -- uno: la vaca se diagnostica preñada otra vez y el sistema la ata al último servicio
              -- registrado, que es el mismo de antes.
              --
              -- El reporte de costo de Genética usa esta misma definición a propósito. Si acá se
              -- contara distinto, dos pantallas mostrarían fertilidades diferentes del mismo toro y
              -- ninguna de las dos sería creíble.
              count(DISTINCT be.id)::int AS services,
              count(DISTINCT p.id)::int AS conceptions,
              round(count(DISTINCT p.id)::numeric / NULLIF(count(DISTINCT be.id),0) * 100, 1)::float AS conception_rate_pct
       FROM breeding_events be
       LEFT JOIN animals s ON s.id = be.sire_id
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = be.sire_id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
       LEFT JOIN pregnancies p ON p.breeding_event_id = be.id AND p.status IN ('open','calved') AND p.deleted_at IS NULL
       WHERE be.tenant_id = $1 AND be.deleted_at IS NULL AND be.sire_id IS NOT NULL
         AND be.type IN ('service_natural','service_ai') AND be.occurred_at::date BETWEEN $2 AND $3
       GROUP BY be.sire_id, ai.value, s.name
       ORDER BY services DESC`,
      [this.db.tenant, from, to],
    );
  }

  /** Abortos y pérdidas del período con causa y edad gestacional. */
  async abortions(fromRaw?: string, toRaw?: string) {
    const [from, to] = await this.range(fromRaw, toRaw);
    return this.db.query(
      `SELECT p.animal_id, ai.value AS tag, l.name AS lot, p.closed_at, p.status, p.loss_cause, p.loss_gestational_days
       FROM pregnancies p
       JOIN animals a ON a.id = p.animal_id
       LEFT JOIN lots l ON l.id = a.current_lot_id
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE p.tenant_id = $1 AND p.deleted_at IS NULL AND p.status IN ('aborted','lost') AND p.closed_at BETWEEN $2 AND $3
       ORDER BY p.closed_at DESC`,
      [this.db.tenant, from, to],
    );
  }

  /** Listas derivadas del estado (regla única): abiertas, repetidoras, diagnósticos pendientes. */
  private async byStatus(...statuses: string[]) {
    const herd = await this.repro.herdStatus();
    return herd.rows.filter((r: any) => statuses.includes(r.status));
  }
  openCows() { return this.byStatus('open'); }
  repeatBreeders() { return this.byStatus('repeat_breeder'); }
  diagnosisPending() { return this.byStatus('diagnosis_pending'); }
}
