import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvalidCatalogEntryError, assertThresholdDays } from '@cowinance/domain';
import { DbService } from '../../db/db.service';
import type { AgendaItemDto, Desired } from './alerts.types';
import { DesiredCache } from './desired-cache';
import { toAgenda } from './agenda-projection';
import { isReadOnlySession } from '../../common/request-context';
import { ReproService } from '../repro/repro.service';
import { WeatherService } from '../weather/weather.service';
import { computeStockRotation, nitrogenAlertMessage, seriesStatus } from '@cowinance/domain';
import { NitrogenService } from '../genetics/nitrogen.service';

/**
 * Motor de alertas (doc Catálogo A5). Reglas declarativas condición→severidad
 * evaluadas contra el estado del dominio. La evaluación es idempotente: cada
 * alerta se identifica por (regla, entidad); reevaluar actualiza las vigentes,
 * crea las nuevas y auto-resuelve las que ya no aplican — nunca duplica.
 *
 * En dev la evaluación es read-through (se dispara al leer los KPIs). En
 * producción es event-driven (Kafka) + cron (BullMQ), con la misma lógica.
 */

/**
 * Categorías de alerta. Es la MISMA lista que el CHECK de `alert_rules.category` (migración 0022):
 * si divergen, la regla se crea en TypeScript y la rechaza la base al insertarla.
 */
type AlertCategory = 'health' | 'reproduction' | 'task' | 'iot' | 'inventory' | 'finance' | 'machinery' | 'compliance';

/**
 * Ventana para medir el ritmo de consumo de un insumo.
 *
 * Medio año: suficiente para promediar la estacionalidad de una finca (una campaña sanitaria, un
 * invierno de suplementación) sin arrastrar un ritmo de hace dos años que ya no es el de hoy. Es el
 * mismo período por defecto que usa la pantalla de rotación, para que el mínimo sugerido que se ve
 * ahí sea el mismo con el que dispara la alerta.
 */
const STOCK_CONSUMPTION_WINDOW_DAYS = 180;

interface RuleDef {
  code: string;
  name: string;
  category: AlertCategory;
  severity: 'info' | 'warning' | 'critical';
  /** Umbral configurable en días (ventana de anticipación / antigüedad). Ausente = regla sin parámetro. */
  defaultDays?: number;
  paramLabel?: string;
}

const RULES: RuleDef[] = [
  { code: 'withdrawal_active', name: 'Retiro activo', category: 'health', severity: 'warning' },
  { code: 'vaccination_due', name: 'Vacunación programada', category: 'health', severity: 'info', defaultDays: 30, paramLabel: 'Días de anticipación' },
  { code: 'health_task_due', name: 'Tarea sanitaria programada', category: 'health', severity: 'info', defaultDays: 15, paramLabel: 'Días de anticipación' },
  { code: 'calving_soon', name: 'Parto próximo', category: 'reproduction', severity: 'info', defaultDays: 15, paramLabel: 'Días de anticipación' },
  { code: 'pregnancy_overdue', name: 'Preñez vencida', category: 'reproduction', severity: 'warning' },
  { code: 'vwp_ready', name: 'Lista para servicio (VWP)', category: 'reproduction', severity: 'info', defaultDays: 60, paramLabel: 'Días voluntarios de espera' },
  { code: 'service_prep_due', name: 'Próxima a preparar para servicio', category: 'reproduction', severity: 'info', defaultDays: 7, paramLabel: 'Días de anticipación' },
  { code: 'diagnosis_due', name: 'Diagnóstico pendiente', category: 'reproduction', severity: 'warning', defaultDays: 45, paramLabel: 'Días tras el servicio' },
  { code: 'open_too_long', name: 'Vaca abierta demasiado tiempo', category: 'reproduction', severity: 'warning', defaultDays: 90, paramLabel: 'Días abiertos' },
  { code: 'repeat_breeder', name: 'Repetidora', category: 'reproduction', severity: 'warning', defaultDays: 3, paramLabel: 'Servicios sin preñez' },
  { code: 'sync_device_stale', name: 'Dispositivo sin sincronizar', category: 'task', severity: 'info', defaultDays: 7, paramLabel: 'Días sin sincronizar' },
  { code: 'sync_conflicts', name: 'Conflictos de sincronización', category: 'task', severity: 'warning' },
  { code: 'task_overdue', name: 'Tarea vencida', category: 'task', severity: 'warning' },
  { code: 'task_due_today', name: 'Tarea para hoy', category: 'task', severity: 'info' },
  { code: 'task_urgent', name: 'Tarea urgente', category: 'task', severity: 'warning' },
  // Clima (D4). Van en la categoría `iot` porque su fuente es la estación meteorológica, que en
  // el modelo canónico es un dispositivo. SIN parámetro numérico a propósito: el umbral no es una
  // preferencia del productor sino una escala agronómica documentada (THI de Armstrong para
  // lechería y LWSI para carne, 0 °C para helada). Lo que sí varía por finca —lechería o carne—
  // se DERIVA de si hay tambo cargado, no se configura.
  { code: 'heat_stress', name: 'Estrés calórico', category: 'iot', severity: 'warning' },
  { code: 'frost', name: 'Helada', category: 'iot', severity: 'warning' },
  // Nitrógeno (GT-4). El parámetro es el PLAZO DEL PROVEEDOR, no un nivel: lo que decide si esto es
  // un aviso o una urgencia no es cuánto queda en el termo sino si todavía se llega a pedir. El
  // valor por termo manda sobre este default, porque el proveedor puede ser distinto por finca.
  { code: 'nitrogen_low', name: 'Nitrógeno por agotarse', category: 'iot', severity: 'critical', defaultDays: 14, paramLabel: 'Días que tarda el proveedor' },

  // ── Fase 1.1: lo que cuesta plata y nadie vigilaba ──────────────────────────────────────────
  //
  // Criterio de severidad, para que la lista no se llene de rojos y deje de leerse:
  //   `critical` → bloquea una operación HOY, o hay pérdida/riesgo sanitario inminente.
  //   `warning`  → va a bloquear o a costar si nadie actúa en los próximos días.
  //   `info`     → previsible y programado; no hay nada roto.
  //
  // Y la regla que las gobierna a todas: **si una alerta no cambia lo que alguien va a hacer hoy,
  // no es una alerta — es un dato de reporte.**

  // El umbral por artículo vive en `inventory_items.reorder_point` y sigue mandando cuando está
  // cargado: es una decisión explícita del productor. El parámetro de acá NO es un mínimo global
  // —pedirle el mismo a una vacuna y al gasoil sería mentira—: son los DÍAS QUE TARDA LA
  // REPOSICIÓN, y sirven para derivar el mínimo del consumo real en los artículos donde nadie
  // cargó ninguno. Sin eso, esos artículos no avisaban nunca.
  { code: 'stock_below_reorder', name: 'Insumo bajo el punto de reposición', category: 'inventory', severity: 'warning', defaultDays: 30, paramLabel: 'Días que tarda la reposición' },

  // Días de GRACIA, no de anticipación: avisar antes del vencimiento sería ruido (la factura no
  // está vencida todavía). Cero = avisa apenas se pasa la fecha.
  { code: 'invoice_overdue', name: 'Factura vencida sin cobrar', category: 'finance', severity: 'warning', defaultDays: 0, paramLabel: 'Días de gracia tras el vencimiento' },

  // El parámetro son COMPROBANTES restantes, no días: lo que decide si esto urge no es el tiempo
  // sino cuántas formas quedan en el talonario. Mismo criterio que `repeat_breeder`, que usa el
  // campo para contar servicios.
  { code: 'fiscal_series_low', name: 'Lote de comprobantes por agotarse', category: 'compliance', severity: 'warning', defaultDays: 50, paramLabel: 'Comprobantes restantes para avisar' },

  // ── Fase 1.2: los silos sanitarios ──────────────────────────────────────────────────────────

  // El parámetro NO es el umbral de anormalidad —eso lo decide el laboratorio con su rango de
  // referencia, y discutírselo desde acá sería inventar medicina—. Es cuántos días el resultado
  // sigue reclamando atención antes de pasar a ser historia clínica.
  { code: 'lab_result_abnormal', name: 'Resultado de laboratorio fuera de rango', category: 'health', severity: 'warning', defaultDays: 30, paramLabel: 'Días que el resultado sigue pendiente' },

  // La UNIDAD del recuento celular no está documentada en el modelo ni la fija el seed: la carga
  // quien usa el sistema. Por eso el umbral es configurable y la etiqueta dice la unidad — asumir
  // en silencio que son células/mL haría que una finca que carga miles no reciba NINGÚN aviso, que
  // es la peor forma de fallar: callada.
  { code: 'milk_scc_high', name: 'Recuento celular alto (mastitis subclínica)', category: 'health', severity: 'warning', defaultDays: 200000, paramLabel: 'Recuento que dispara el aviso (células/mL)' },

  // ── Fase 1.3: activos y cumplimiento ────────────────────────────────────────────────────────

  // Por FECHA (`maintenance_records.next_due_date`), no por horas. El modelo NO tiene intervalo de
  // servicio —hay horas actuales y horas al momento del último service, pero nadie declara «cada
  // 250 h»—, así que avisar por horas exigiría un umbral global, y un tractor no se sirve cada las
  // mismas horas que una desmalezadora. Sería la misma mentira que un stock mínimo único. El
  // intervalo por máquina queda anotado para la mejora de Maquinaria (Fase 4).
  { code: 'maintenance_due', name: 'Mantenimiento programado', category: 'machinery', severity: 'warning', defaultDays: 15, paramLabel: 'Días de anticipación' },

  // La vigencia es DERIVADA de `valid_until`, igual que el `is_expired` del módulo: no hay un estado
  // que un cron tenga que ir actualizando. Se avisa antes de que venza porque renovar una
  // certificación lleva tiempo, y vencida ya frena la venta.
  { code: 'certification_expiring', name: 'Certificación por vencer', category: 'compliance', severity: 'warning', defaultDays: 30, paramLabel: 'Días de anticipación' },
];

/** Nivel de estrés en el idioma del producto: la alerta la lee una persona, no un sistema. */
const NIVEL_ES: Record<string, string> = { mild: 'leve', moderate: 'moderado', severe: 'severo', emergency: 'de emergencia' };

export type { AgendaItemDto, Desired } from './alerts.types';

const fmt = (d: string | Date) => new Date(d).toLocaleDateString('es-AR');
const iso = (d: string | Date | null | undefined) => (d ? new Date(d).toISOString() : null);
@Injectable()
export class AlertsService {
  constructor(
    private readonly db: DbService,
    private readonly repro: ReproService,
    private readonly weather: WeatherService,
    private readonly nitrogen: NitrogenService,
  ) {}

  /** Reevalúa todas las reglas: crea/actualiza/auto-resuelve. Idempotente.
   *  `precomputed` evita recomputar cuando el caller ya tiene los hechos (agenda, P4-1). */
  async evaluate(precomputed?: Desired[]) {
    return this.db.suppressInvalidation(() => this.evaluateInner(precomputed));
  }

  /**
   * Bajo `suppressInvalidation`: las alertas que guarda son la SALIDA de `computeDesired()`, no una
   * entrada suya —el cálculo no lee la tabla `alerts`—, y si contaran como cambio el motor tiraría
   * con lo que él mismo escribe la caché que acaba de llenar.
   */
  private async evaluateInner(precomputed?: Desired[]) {
    /**
     * MODO ESPEJO: no se persiste nada.
     *
     * Este método es un read-through — lo dispara un `GET` (`/alerts/kpis`, y de rebote
     * `/dashboard/home`) y escribe alertas como efecto. En una sesión de solo lectura eso muere en
     * la transacción READ ONLY y se lleva puesta la pantalla de inicio entera: soporte entraba a
     * ver la finca del cliente y encontraba «La API no está disponible», que además es mentira.
     *
     * Al salir temprano, la agenda y los KPIs se arman con las alertas YA guardadas: exactamente
     * las que el cliente está viendo en ese momento, que es lo que soporte necesita reproducir. Lo
     * único que se pierde es la reevaluación fresca, y eso vuelve a correr en la próxima visita del
     * propio cliente.
     *
     * El fail-closed sigue siendo del motor: si esta guarda no estuviera, la escritura fallaría
     * igual. Esto es para que la pantalla sirva, no para proteger nada.
     */
    if (isReadOnlySession()) return { created: 0, updated: 0, resolved: 0, skipped: 'sesion_de_solo_lectura' as const };

    const t = this.db.tenant;
    const ruleIds = await this.ensureRules();
    const desired = precomputed ?? (await this.computeDesired());

    // Activas (para actualizar/auto-resolver) + resueltas/descartadas recientes
    // (para respetar la acción del usuario y no recrear la misma alerta al toque).
    const existing = await this.db.query<any>(
      `SELECT id, rule_id, related_id, status, resolved_by FROM alerts
       WHERE tenant_id = $1 AND rule_id IS NOT NULL AND deleted_at IS NULL
         AND (status IN ('open','acknowledged')
              OR (status IN ('resolved','dismissed') AND updated_at > now() - interval '14 days'))`,
      [t],
    );
    const ourRuleIds = new Set(Object.values(ruleIds));
    const key = (ruleId: string, relId: string | null) => `${ruleId}::${relId ?? 'null'}`;
    const active = new Map<string, any>();
    const muted = new Set<string>();
    for (const e of existing) {
      if (!ourRuleIds.has(e.rule_id)) continue;
      const k = key(e.rule_id, e.related_id);
      if (e.status === 'open' || e.status === 'acknowledged') active.set(k, e);
      // Solo silencia lo que cerró una PERSONA. Lo que auto-resolvió el motor —porque la condición
      // dejó de darse— tiene que poder volver a dispararse: el estrés calórico se termina cada
      // noche, y con el silencio de 14 días la finca no recibiría un aviso más en toda la ola de
      // calor.
      else if (e.resolved_by) muted.add(k);
    }

    const seen = new Set<string>();
    let created = 0;
    let updated = 0;
    for (const d of desired) {
      const k = key(ruleIds[d.code], d.related_id);
      seen.add(k);
      const ex = active.get(k);
      if (ex) {
        // `group_key` también se refresca acá, y no es un detalle: si solo se fijara al INSERTAR,
        // las alertas que ya estaban abiertas al desplegar se quedarían sin agrupar PARA SIEMPRE —
        // hasta que la condición desapareciera y volviera a dispararse. Se vería como que el
        // agrupado «no funciona», justo en la instalación que más alertas acumuladas tiene.
        //
        // Y el `IS DISTINCT FROM` no es adorno: sin él este UPDATE corría sobre TODA alerta abierta
        // en CADA evaluación, cambiara algo o no —65 escrituras por carga en el demo— para dejar las
        // filas como estaban. Va `IS DISTINCT FROM` y no `<>` porque `message` y los `group_*` son
        // nulables: con `<>` la comparación contra NULL da NULL, la fila no entra en el WHERE, y un
        // cambio de verdad —de sin mensaje a con mensaje— se perdía en silencio.
        const [tocada] = await this.db.query<{ id: string }>(
          `UPDATE alerts SET severity = $2, title = $3, message = $4, category = $5, group_key = $6, group_title = $7, updated_at = now()
            WHERE id = $1
              AND (severity IS DISTINCT FROM $2 OR title IS DISTINCT FROM $3 OR message IS DISTINCT FROM $4
                   OR category IS DISTINCT FROM $5 OR group_key IS DISTINCT FROM $6 OR group_title IS DISTINCT FROM $7)
          RETURNING id`,
          [ex.id, d.severity, d.title, d.message, d.category, d.group_key ?? null, d.group_title ?? null],
        );
        if (tocada) updated++;
      } else if (muted.has(k)) {
        // la PERSONA ya la resolvió/descartó hace poco: no la recreamos
      } else {
        await this.db.query(
          `INSERT INTO alerts (tenant_id, rule_id, category, severity, title, message, related_type, related_id, status, triggered_at, created_by, group_key, group_title)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',now(),$9,$10,$11)`,
          [t, ruleIds[d.code], d.category, d.severity, d.title, d.message, d.related_type, d.related_id, this.db.user, d.group_key ?? null, d.group_title ?? null],
        );
        created++;
      }
    }

    // Auto-resolución: lo que estaba abierto/reconocido y ya no aplica
    let resolved = 0;
    for (const [k, e] of active) {
      if (!seen.has(k)) {
        await this.db.query(`UPDATE alerts SET status = 'resolved', resolved_at = now(), updated_at = now() WHERE id = $1`, [e.id]);
        resolved++;
      }
    }
    return { created, updated, resolved };
  }

  /**
   * Agenda diaria del hato (P4-1): los hechos ACCIONABLES estructurados. Reutiliza la
   * fuente única de reglas (`computeDesired`) — un solo cómputo — y hace read-through de
   * `evaluate()` (mantiene alertas/badge frescos, como `kpis`). Solo categorías de campo
   * (`health` + `reproduction`); los ítems de sistema (sync) viven en la pantalla de
   * sincronización. Ordena por vencimiento (vencidos/próximos primero) y severidad.
   */
  async agenda(): Promise<AgendaItemDto[]> {
    const desired = await this.computeDesired();
    await this.evaluate(desired); // read-through, sin recomputar
    return toAgenda(desired);
  }

  /**
   * Agenda + KPIs en UNA sola pasada (auditoría Fase 3, perf). `computeDesired()` es lo caro del
   * módulo (corre `statusAlerts` → herdStatus, O(vientres)); llamar `agenda()` y `kpis()` por
   * separado lo ejecutaba DOS veces. El Inicio agregado necesita ambos, así que se comparte el
   * cómputo. Mismos resultados que llamarlos por separado, la mitad de trabajo.
   */
  async agendaAndKpis(): Promise<{ agenda: AgendaItemDto[]; kpis: Awaited<ReturnType<AlertsService['kpiCounts']>> }> {
    const desired = await this.computeDesired();
    await this.evaluate(desired);
    return { agenda: toAgenda(desired), kpis: await this.kpiCounts() };
  }

  async list(status = 'active') {
    const t = this.db.tenant;
    const filter =
      status === 'all'
        ? ''
        : status === 'active'
          ? `AND al.status IN ('open','acknowledged')`
          : `AND al.status = $2`;
    const params: unknown[] = [t];
    if (status !== 'all' && status !== 'active') params.push(status);

    const filas = await this.db.query<any>(
      `SELECT al.id, al.category, al.severity, al.title, al.message, al.related_type, al.related_id,
              al.status, al.triggered_at, al.group_key, al.group_title, ai.value AS tag
       FROM alerts al
       LEFT JOIN LATERAL (
         SELECT value FROM animal_identifiers x
         WHERE al.related_type = 'animal' AND x.animal_id = al.related_id AND x.type = 'visual' AND x.deleted_at IS NULL
         ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE al.tenant_id = $1 AND al.deleted_at IS NULL ${filter}
       ORDER BY CASE al.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, al.triggered_at DESC
       LIMIT 300`,
      params,
    );

    /**
     * Agrupación de LECTURA: las alertas que son un solo trabajo se colapsan en una línea.
     *
     * Se hace acá y no en el motor a propósito. En la base siguen existiendo una por entidad, y eso
     * es lo correcto: la agenda diaria marca animal por animal y la manga necesita saber de cuál se
     * trata. Lo que sobra no son las alertas, es la LISTA que las repite veinte veces.
     *
     * El detalle no se pierde: `items` lleva las agrupadas para poder desplegarlas.
     */
    const grupos = new Map<string, any>();
    const salida: any[] = [];
    for (const f of filas) {
      if (!f.group_key) {
        salida.push({ ...f, count: 1, items: null });
        continue;
      }
      const g = grupos.get(f.group_key);
      if (!g) {
        // La primera manda el encabezado; las siguientes solo suman. Como vienen ordenadas por
        // severidad, la que encabeza es la más grave del grupo — que es la que hay que mirar.
        const nuevo = { ...f, count: 1, items: [f] };
        grupos.set(f.group_key, nuevo);
        salida.push(nuevo);
        continue;
      }
      g.count++;
      g.items.push(f);
    }
    // El título del grupo dice cuántos son: «Desparasitación de destete · 10 animales» es una
    // decisión; diez líneas iguales son ruido.
    // El encabezado usa `group_title` —el nombre del trabajo sin el animal—; sin él caería al
    // título individual, que lleva la caravana de la primera y se leería como si el grupo fuera
    // sobre ESE animal.
    for (const g of grupos.values()) if (g.count > 1) g.title = `${g.group_title ?? g.title} · ${g.count} animales`;
    return salida;
  }

  /** KPIs con evaluación read-through (mantiene alertas y badge frescos). */
  async kpis() {
    await this.evaluate();
    return this.kpiCounts();
  }

  /** Solo los conteos (sin evaluar): lo comparte `agendaAndKpis`, que ya evaluó una vez. */
  private async kpiCounts() {
    const row = await this.db.one<any>(
      `SELECT
         count(*) FILTER (WHERE status = 'open')::int AS open,
         count(*) FILTER (WHERE status = 'open' AND severity = 'critical')::int AS critical,
         count(*) FILTER (WHERE status = 'open' AND severity = 'warning')::int AS warning,
         count(*) FILTER (WHERE status = 'open' AND severity = 'info')::int AS info,
         count(*) FILTER (WHERE status = 'acknowledged')::int AS acknowledged
       FROM alerts WHERE tenant_id = $1 AND deleted_at IS NULL AND status IN ('open','acknowledged')`,
      [this.db.tenant],
    );
    return {
      open: row?.open ?? 0,
      critical: row?.critical ?? 0,
      warning: row?.warning ?? 0,
      info: row?.info ?? 0,
      acknowledged: row?.acknowledged ?? 0,
    };
  }

  async setStatus(id: string, action: 'acknowledge' | 'resolve' | 'dismiss') {
    const map = { acknowledge: 'acknowledged', resolve: 'resolved', dismiss: 'dismissed' } as const;
    const status = map[action];
    if (!status) throw new BadRequestException({ code: 'alert.invalid_action', title: 'Acción inválida' });
    const resolvedAt = status === 'resolved' ? ', resolved_at = now()' : '';
    // Queda registrado QUIÉN la cerró: es lo que distingue el cierre de una persona (se silencia
    // 14 días) del auto-cierre del motor (puede volver a dispararse).
    const resolvedBy = status === 'resolved' || status === 'dismissed' ? ', resolved_by = $4' : '';
    const params = [id, status, this.db.tenant];
    if (resolvedBy) params.push(this.db.user);
    const row = await this.db.one(
      `UPDATE alerts SET status = $2${resolvedAt}${resolvedBy}, updated_at = now()
       WHERE id = $1 AND tenant_id = $3 AND deleted_at IS NULL RETURNING id, status`,
      params,
    );
    if (!row) throw new NotFoundException({ code: 'alert.not_found', title: 'Alerta no encontrada' });
    return row;
  }

  // ── Reglas ────────────────────────────────────────────────────────────

  private async ensureRules(): Promise<Record<string, string>> {
    const t = this.db.tenant;
    const map: Record<string, string> = {};
    for (const r of RULES) {
      let row = await this.db.one<any>(
        `SELECT id FROM alert_rules WHERE tenant_id = $1 AND condition->>'code' = $2 AND deleted_at IS NULL`,
        [t, r.code],
      );
      if (!row)
        row = await this.db.one<any>(
          `INSERT INTO alert_rules (tenant_id, name, category, condition, severity, created_by)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [t, r.name, r.category, JSON.stringify({ code: r.code }), r.severity, this.db.user],
        );
      map[r.code] = row!.id;
    }
    return map;
  }

  /**
   * Config declarativa de reglas por tenant: estado (activa/inactiva) y umbral en días, con fallback al
   * default del registro cuando no hay override guardado. `computeDesired` la consulta para saltear
   * reglas apagadas y usar el umbral configurado — el motor deja de ser hardcodeado.
   */
  private async ruleConfig(): Promise<Map<string, { active: boolean; days: number }>> {
    const rows = await this.db.query<any>(
      `SELECT condition->>'code' AS code, is_active, (condition->>'days')::int AS days FROM alert_rules WHERE tenant_id=$1 AND deleted_at IS NULL`,
      [this.db.tenant],
    );
    const byCode = new Map(rows.map((r) => [r.code, r]));
    const cfg = new Map<string, { active: boolean; days: number }>();
    for (const r of RULES) {
      const stored = byCode.get(r.code);
      cfg.set(r.code, { active: stored ? stored.is_active : true, days: stored?.days ?? r.defaultDays ?? 0 });
    }
    return cfg;
  }

  /** Reglas con su metadato + config actual del tenant (para la pantalla de Configuración). */
  async listRules() {
    await this.ensureRules();
    const cfg = await this.ruleConfig();
    return RULES.map((r) => ({
      code: r.code,
      name: r.name,
      category: r.category,
      severity: r.severity,
      is_active: cfg.get(r.code)!.active,
      days: r.defaultDays != null ? cfg.get(r.code)!.days : null,
      param_label: r.paramLabel ?? null,
      default_days: r.defaultDays ?? null,
    }));
  }

  /** Cambia el estado y/o el umbral de una regla conocida (upsert en alert_rules por code). */
  async updateRule(code: string, body: { is_active?: unknown; days?: unknown }) {
    const rule = RULES.find((r) => r.code === code);
    if (!rule) throw new NotFoundException({ code: 'alert.rule_not_found', title: `Regla desconocida: ${code}` });
    const isActive = body?.is_active == null ? true : Boolean(body.is_active);
    let days: number | undefined;
    if (rule.defaultDays != null) {
      try {
        days = assertThresholdDays(body?.days ?? rule.defaultDays);
      } catch (e) {
        if (e instanceof InvalidCatalogEntryError) throw new BadRequestException({ code: 'alert.invalid_threshold', title: e.reason });
        throw e;
      }
    }
    const condition = JSON.stringify(days != null ? { code, days } : { code });
    // No hay unique sobre (tenant, code): match explícito por code y update, o insert si falta.
    const existing = await this.db.one<{ id: string }>(
      `SELECT id FROM alert_rules WHERE tenant_id=$1 AND condition->>'code'=$2 AND deleted_at IS NULL`,
      [this.db.tenant, code],
    );
    if (existing) {
      await this.db.query(`UPDATE alert_rules SET is_active=$2, condition=$3, updated_at=now() WHERE id=$1`, [existing.id, isActive, condition]);
    } else {
      await this.db.query(
        `INSERT INTO alert_rules (tenant_id, name, category, condition, severity, is_active, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [this.db.tenant, rule.name, rule.category, condition, rule.severity, isActive, this.db.user],
      );
    }
    return this.listRules();
  }

  private readonly cacheDesired = new DesiredCache<Desired[]>();

  /**
   * El estado deseado: qué alertas DEBERÍAN existir ahora. Lo caro del módulo — se cachea por tenant
   * y se invalida por ESCRITURA, no por tiempo. El razonamiento vive en `desired-cache.ts`.
   */
  private computeDesired(): Promise<Desired[]> {
    return this.cacheDesired.through(this.db, () => this.computeDesiredFresh());
  }

  private async computeDesiredFresh(): Promise<Desired[]> {
    const t = this.db.tenant;
    const out: Desired[] = [];
    const cfg = await this.ruleConfig();

    // Retiros activos
    if (cfg.get('withdrawal_active')!.active) {
    const withdrawals = await this.db.query<any>(
      `SELECT a.id AS rid, ai.value AS tag, max(tr.meat_withdrawal_until) AS meat_until
       FROM treatments tr
       JOIN animals a ON a.id = tr.animal_id AND a.status = 'active' AND a.deleted_at IS NULL
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE tr.tenant_id = $1 AND tr.deleted_at IS NULL
         AND (tr.meat_withdrawal_until >= CURRENT_DATE OR tr.milk_withdrawal_until >= now())
       GROUP BY a.id, ai.value`,
      [t],
    );
    for (const w of withdrawals)
      out.push({
        code: 'withdrawal_active',
        category: 'health',
        severity: 'warning',
        title: `Retiro activo — caravana ${w.tag ?? '—'}`,
        message: w.meat_until ? `No apto para faena hasta el ${fmt(w.meat_until)}` : 'Retiro de leche activo',
        related_type: 'animal',
        related_id: w.rid,
        due_at: iso(w.meat_until),
        tag: w.tag ?? null,
      });
    }

    // Vacunaciones próximas o vencidas
    if (cfg.get('vaccination_due')!.active) {
    const vaccinations = await this.db.query<any>(
      `SELECT DISTINCT ON (v.animal_id) v.animal_id AS rid, ai.value AS tag, pv.name AS product, v.next_due_date AS due
       FROM vaccinations v
       JOIN animals a ON a.id = v.animal_id AND a.status = 'active' AND a.deleted_at IS NULL
       LEFT JOIN products_veterinary pv ON pv.id = v.product_id
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE v.tenant_id = $1 AND v.deleted_at IS NULL AND v.next_due_date IS NOT NULL AND v.next_due_date <= CURRENT_DATE + $2::int
       ORDER BY v.animal_id, v.next_due_date ASC`,
      [t, cfg.get('vaccination_due')!.days],
    );
    const todayStr = await this.db.today();
    for (const v of vaccinations) {
      const overdue = v.due < todayStr;
      out.push({
        code: 'vaccination_due',
        category: 'health',
        severity: overdue ? 'warning' : 'info',
        title: `Vacunación ${overdue ? 'vencida' : 'programada'} — caravana ${v.tag ?? '—'}`,
        message: `${v.product ?? 'Refuerzo'} ${overdue ? 'venció el' : 'vence el'} ${fmt(v.due)}`,
        related_type: 'animal',
        related_id: v.rid,
        due_at: iso(v.due),
        tag: v.tag ?? null,
      });
    }
    }

    // Tareas vencidas / para hoy / urgentes (Tareas E6). Dedup por (regla, task id): una alerta por
    // tarea y regla; mutuamente excluyentes por fecha para no notificar la misma tarea dos veces.
    if (cfg.get('task_overdue')!.active) {
      const rows = await this.db.query<any>(
        `SELECT id AS rid, title, due_date::text AS due, priority FROM tasks
         WHERE tenant_id = $1 AND deleted_at IS NULL AND status IN ('pending','in_progress') AND due_date::date < CURRENT_DATE LIMIT 500`,
        [t],
      );
      for (const r of rows)
        out.push({ code: 'task_overdue', category: 'task', severity: 'warning', title: `Tarea vencida: ${r.title}`, message: `Venció el ${fmt(r.due)}`, related_type: 'task', related_id: r.rid, due_at: iso(r.due), tag: null });
    }
    if (cfg.get('task_due_today')!.active) {
      const rows = await this.db.query<any>(
        `SELECT id AS rid, title, priority FROM tasks
         WHERE tenant_id = $1 AND deleted_at IS NULL AND status IN ('pending','in_progress') AND due_date::date = CURRENT_DATE LIMIT 500`,
        [t],
      );
      for (const r of rows)
        out.push({ code: 'task_due_today', category: 'task', severity: 'info', title: `Tarea para hoy: ${r.title}`, message: 'Vence hoy', related_type: 'task', related_id: r.rid, due_at: null, tag: null });
    }
    if (cfg.get('task_urgent')!.active) {
      const rows = await this.db.query<any>(
        `SELECT id AS rid, title, due_date::text AS due FROM tasks
         WHERE tenant_id = $1 AND deleted_at IS NULL AND status IN ('pending','in_progress') AND priority = 'urgent'
           AND (due_date IS NULL OR due_date::date > CURRENT_DATE) LIMIT 500`,
        [t],
      );
      for (const r of rows)
        out.push({ code: 'task_urgent', category: 'task', severity: 'warning', title: `Tarea urgente: ${r.title}`, message: r.due ? `Vence el ${fmt(r.due)}` : 'Sin fecha', related_type: 'task', related_id: r.rid, due_at: iso(r.due), tag: null });
    }

    // Tareas sanitarias programadas (de planes) por vencer o vencidas
    if (cfg.get('health_task_due')!.active) {
    const tasks = await this.db.query<any>(
      `SELECT tk.id AS rid, tk.title, tk.due_date, tk.batch_key, tk.batch_label, (tk.due_date::date < CURRENT_DATE) AS overdue
       FROM tasks tk
       WHERE tk.tenant_id = $1 AND tk.type = 'health' AND tk.status = 'pending' AND tk.deleted_at IS NULL
         AND tk.due_date <= now() + ($2::int * interval '1 day')`,
      [t, cfg.get('health_task_due')!.days],
    );
    for (const tk of tasks)
      out.push({
        code: 'health_task_due',
        category: 'health',
        severity: tk.overdue ? 'warning' : 'info',
        title: tk.title,
        message: `${tk.overdue ? 'Tarea vencida' : 'Tarea programada'} para el ${fmt(tk.due_date)}`,
        related_type: 'task',
        related_id: tk.rid,
        due_at: iso(tk.due_date),
        tag: null,
        // Diez terneros desparasitados el mismo día son UN trabajo, no diez decisiones. La clave
        // la trae la TAREA (`batch_key`, 1.5): agruparlas por título no servía porque el título ya
        // incluye la caravana, y partirlo por el guion se rompería en silencio al editar ese texto.
        // Sin `batch_key` —una tarea suelta creada a mano— no agrupa, que es lo correcto.
        group_key: tk.batch_key ? `health_task_due|${tk.batch_key}` : null,
        group_title: tk.batch_label ?? null,
      });
    }

    // Partos próximos
    if (cfg.get('calving_soon')!.active) {
    const calvings = await this.db.query<any>(
      `SELECT p.animal_id AS rid, ai.value AS tag, p.expected_due_date AS due
       FROM pregnancies p
       JOIN animals a ON a.id = p.animal_id AND a.status = 'active' AND a.deleted_at IS NULL
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE p.tenant_id = $1 AND p.status = 'open' AND p.deleted_at IS NULL
         AND p.expected_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + $2::int`,
      [t, cfg.get('calving_soon')!.days],
    );
    for (const c of calvings)
      out.push({
        code: 'calving_soon',
        category: 'reproduction',
        severity: 'info',
        title: `Parto próximo — caravana ${c.tag ?? '—'}`,
        message: `Parto probable el ${fmt(c.due)}`,
        related_type: 'animal',
        related_id: c.rid,
        due_at: iso(c.due),
        tag: c.tag ?? null,
      });
    }

    // Preñeces vencidas (parto probable pasó, sin parto registrado)
    if (cfg.get('pregnancy_overdue')!.active) {
    const overdue = await this.db.query<any>(
      `SELECT p.animal_id AS rid, ai.value AS tag, p.expected_due_date AS due
       FROM pregnancies p
       JOIN animals a ON a.id = p.animal_id AND a.status = 'active' AND a.deleted_at IS NULL
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE p.tenant_id = $1 AND p.status = 'open' AND p.deleted_at IS NULL AND p.expected_due_date < CURRENT_DATE`,
      [t],
    );
    for (const o of overdue)
      out.push({
        code: 'pregnancy_overdue',
        category: 'reproduction',
        severity: 'warning',
        title: `Preñez vencida — caravana ${o.tag ?? '—'}`,
        message: `Parto probable era el ${fmt(o.due)} — sin parto registrado`,
        related_type: 'animal',
        related_id: o.rid,
        due_at: iso(o.due),
        tag: o.tag ?? null,
      });
    }

    // Alertas de estado reproductivo (VWP, diagnóstico pendiente, abierta, repetidora, próximas a
    // preparar) — DERIVADAS de la regla única `computeReproStatus` en ReproService (no se re-implementa
    // el estado en SQL acá). El motor filtra por regla activa/umbral configurable.
    const reproAlerts = await this.repro.statusAlerts();
    for (const a of reproAlerts) if (cfg.get(a.code)?.active) out.push(a);

    // Dispositivos sin sincronizar
    if (cfg.get('sync_device_stale')!.active) {
    const staleDays = cfg.get('sync_device_stale')!.days;
    const devices = await this.db.query<any>(
      `SELECT id AS rid, device_name FROM sync_devices
       WHERE tenant_id = $1 AND status = 'active' AND deleted_at IS NULL
         AND (last_sync_at IS NULL OR last_sync_at < now() - ($2::int * interval '1 day'))`,
      [t, staleDays],
    );
    for (const d of devices)
      out.push({
        code: 'sync_device_stale',
        category: 'task',
        severity: 'info',
        title: 'Dispositivo sin sincronizar',
        message: `${d.device_name ?? 'Un dispositivo'} no sincroniza hace más de ${staleDays} días`,
        related_type: 'sync_device',
        related_id: d.rid,
      });
    }

    // Conflictos de sync sin resolver (agregada, una por tenant)
    if (cfg.get('sync_conflicts')!.active) {
    const conflicts = await this.db.one<any>(
      `SELECT count(*)::int AS n FROM sync_conflicts WHERE tenant_id = $1 AND resolved_at IS NULL AND deleted_at IS NULL`,
      [t],
    );
    if ((conflicts?.n ?? 0) > 0)
      out.push({
        code: 'sync_conflicts',
        category: 'task',
        severity: 'warning',
        title: 'Conflictos de sincronización',
        message: `${conflicts.n} conflicto${conflicts.n === 1 ? '' : 's'} de sincronización sin resolver`,
        related_type: null,
        related_id: null,
      });
    }

    // Clima (D4). La condición la evalúa `WeatherService`: los umbrales agronómicos viven en el
    // dominio y acá solo se traduce a alerta. Si la finca no tiene estación —o no cargó nada— no
    // hay nada que decir y no se inventa una alerta "sin datos".
    if (cfg.get('heat_stress')!.active || cfg.get('frost')!.active) {
      const clima = await this.weather.currentConditions();
      if (clima) {
        const escala = clima.system === 'dairy' ? 'lechería' : 'carne';
        // `moderate` en adelante: en `mild` el animal se acomoda solo (sombra, agua) y avisar
        // todos los días de verano entrenaría al productor a ignorar la alerta.
        if (cfg.get('heat_stress')!.active && (clima.heatStress === 'moderate' || clima.heatStress === 'severe' || clima.heatStress === 'emergency')) {
          const critico = clima.heatStress === 'severe' || clima.heatStress === 'emergency';
          out.push({
            code: 'heat_stress',
            category: 'iot',
            severity: critico ? 'critical' : 'warning',
            title: `Estrés calórico ${NIVEL_ES[clima.heatStress]} (THI ${clima.thi})`,
            message: `Escala de ${escala}. Asegurar sombra y agua; evitar encierros y traslados en las horas de calor.`,
            related_type: null,
            related_id: null,
            due_at: clima.date,
          });
        }
        if (cfg.get('frost')!.active && clima.frost) {
          out.push({
            code: 'frost',
            category: 'iot',
            severity: 'warning',
            title: `Helada — mínima de ${clima.tempMinC} °C`,
            message: 'Revisar aguadas congeladas, terneros recién nacidos y pasturas sensibles.',
            related_type: null,
            related_id: null,
            due_at: clima.date,
          });
        }
      }
    }

    /**
     * Nitrógeno (GT-4). Es la alerta de mayor consecuencia económica de todo el producto: un termo
     * que se seca destruye años de genética, en silencio.
     *
     * Se avisa sobre los DÍAS QUE QUEDAN y no sobre el nivel, y `critical` es literalmente «pedir
     * hoy ya está al límite». Un termo sin mediciones NO genera alerta: no se sabe nada de él, y
     * una alerta «sin datos» todos los días entrenaría a ignorar justo la que no hay que ignorar.
     * Eso queda visible en la pantalla del termo, que es donde se puede hacer algo al respecto.
     */
    if (cfg.get('nitrogen_low')!.active) {
      const leadPorDefecto = cfg.get('nitrogen_low')!.days;
      for (const termo of await this.nitrogen.statusAll()) {
        if (termo.state.status !== 'warning' && termo.state.status !== 'critical') continue;
        out.push({
          code: 'nitrogen_low',
          category: 'iot',
          severity: termo.state.status === 'critical' ? 'critical' : 'warning',
          title: `Termo ${termo.tank_code ?? '—'}: quedan ${termo.state.days_remaining} días de nitrógeno`,
          message: termo.message ?? nitrogenAlertMessage(termo.state, termo.tank_code ?? '—', termo.lead_days ?? leadPorDefecto),
          related_type: 'storage_tank',
          related_id: termo.tank_id,
          due_at: termo.state.projected_empty_date,
        });
      }
    }

    // ── Fase 1.1 ────────────────────────────────────────────────────────────────────────────
    // Tres fuentes que el motor ignoraba y que cuestan plata: quedarse sin insumo, no cobrar, y
    // quedarse sin comprobantes. Las tres se descubrían igual — cuando ya era tarde.

    /**
     * Insumo bajo el punto de reposición.
     *
     * El mínimo vive POR ARTÍCULO (`reorder_point`) y lo carga una persona. Durante mucho tiempo la
     * regla miró SOLO ese campo, y eso la dejaba fallando en las dos direcciones a la vez:
     *
     * - **Falso negativo**, el caro: el artículo al que nadie le cargó mínimo NUNCA avisaba. En el
     *   demo, el antiparasitario tenía 28 días de cobertura contra 30 de reposición —o sea, se
     *   terminaba antes de que llegara lo que se pidiera ese día— y la alerta estaba muda.
     * - **Falso positivo**: el artículo con un mínimo viejo y muy alto avisaba siempre. La sal
     *   tenía 108 días de cobertura y sonaba igual, por un mínimo de 4000 cuando alcanzaba con 776.
     *
     * Ahora, cuando NO hay mínimo cargado, se usa el DERIVADO del consumo real: lo que se gasta
     * mientras llega la reposición (misma regla que la pantalla de rotación, `computeStockRotation`,
     * para que las dos digan lo mismo). Un artículo sin consumo en la ventana no dispara nada — sin
     * ritmo no hay nada que proyectar, y avisar por lo que no se usa sería ruido sobre el catálogo.
     *
     * El mínimo CARGADO sigue mandando cuando existe: es una decisión explícita del productor y el
     * sistema no la pisa en silencio. Que esté desactualizado se avisa en la pantalla de rotación,
     * que es donde se puede corregir.
     *
     * Se suma el stock de TODOS los depósitos: tener el mínimo repartido en dos galpones no es
     * faltante, y alertar por depósito llenaría la lista de avisos falsos.
     */
    if (cfg.get('stock_below_reorder')!.active) {
      const lead = cfg.get('stock_below_reorder')!.days;
      const bajos = await this.db.query<any>(
        // Una sola consulta para las dos vías: `computeDesired` es el camino caro del sistema y
        // sumar un round-trip por regla es lo que lo vuelve lento sin que se note de a poco.
        `SELECT i.id AS rid, i.name, i.reorder_point::float AS minimo,
                COALESCE(s.hay, 0)::float AS hay,
                COALESCE(c.consumido, 0)::float AS consumido,
                u.code AS unidad
           FROM inventory_items i
           LEFT JOIN units u ON u.code = i.unit
           LEFT JOIN LATERAL (
             SELECT SUM(sl.quantity) AS hay FROM stock_levels sl
              WHERE sl.item_id = i.id AND sl.tenant_id = $1 AND sl.deleted_at IS NULL) s ON true
           LEFT JOIN LATERAL (
             -- Solo lo que SALIÓ: una compra no es consumo y una transferencia entre galpones no
             -- gastó nada. Contarlas inflaría el ritmo y el mínimo derivado saldría de más.
             SELECT SUM(abs(m.quantity)) AS consumido FROM stock_movements m
              WHERE m.item_id = i.id AND m.tenant_id = $1 AND m.deleted_at IS NULL
                AND m.movement_type IN ('out','consumption')
                AND m.occurred_at >= now() - ($2::int * interval '1 day')) c ON true
          WHERE i.tenant_id = $1 AND i.deleted_at IS NULL AND i.is_active`,
        [t, STOCK_CONSUMPTION_WINDOW_DAYS],
      );

      for (const b of bajos) {
        const derivado = computeStockRotation(
          { stock: b.hay, consumed: b.consumido, periodDays: STOCK_CONSUMPTION_WINDOW_DAYS, reorderPoint: b.minimo },
          { leadTimeDays: lead },
        );
        // El cargado manda; si no hay, el derivado del consumo. Sin ninguno de los dos no hay con
        // qué comparar y el artículo no dispara nada.
        const minimo: number | null = b.minimo ?? derivado.suggestedReorderPoint;
        if (minimo == null || b.hay > minimo) continue;
        const origen = b.minimo != null ? `el mínimo es ${b.minimo}` : `al ritmo de uso alcanzan ${derivado.coverageDays} días y la reposición tarda ${lead}`;
        out.push({
          code: 'stock_below_reorder',
          category: 'inventory',
          // Quedarse EN CERO ya frenó el trabajo; estar bajo el mínimo todavía se puede reponer.
          severity: b.hay <= 0 ? 'critical' : 'warning',
          title: b.hay <= 0 ? `Sin stock: ${b.name}` : `Stock bajo: ${b.name}`,
          message: `Quedan ${b.hay} ${b.unidad ?? ''}, ${origen}`.replace(/\s+/g, ' ').trim(),
          related_type: 'inventory_item',
          related_id: b.rid,
        });
      }
    }

    /**
     * Factura emitida y vencida sin cobrar.
     *
     * El saldo es DERIVADO (total − imputaciones), igual que en `invoices.service` y en el aging:
     * una columna de «pendiente» sería una segunda fuente del mismo número. Solo `issued`: una
     * factura recibida vencida es una deuda propia y merece otra alerta, con otro texto y otra
     * urgencia — no se mezclan.
     */
    if (cfg.get('invoice_overdue')!.active) {
      const vencidas = await this.db.query<any>(
        `SELECT i.id AS rid, i.invoice_number, i.due_date, p.name AS socio,
                (i.total - COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa
                                      WHERE pa.invoice_id = i.id AND pa.deleted_at IS NULL), 0))::float AS saldo,
                (CURRENT_DATE - i.due_date)::int AS atraso
           FROM invoices i JOIN business_partners p ON p.id = i.partner_id
          WHERE i.tenant_id = $1 AND i.deleted_at IS NULL AND i.direction = 'issued'
            AND i.status <> 'void' AND i.voided_at IS NULL
            AND i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE - $2::int
          ORDER BY i.due_date`,
        [t, cfg.get('invoice_overdue')!.days],
      );
      for (const v of vencidas) {
        if (!(v.saldo > 0)) continue; // ya cobrada: el saldo derivado es la única verdad
        out.push({
          code: 'invoice_overdue',
          category: 'finance',
          severity: 'warning',
          title: `Factura ${v.invoice_number} vencida hace ${v.atraso} días`,
          message: `${v.socio} adeuda ${v.saldo}`,
          related_type: 'invoice',
          related_id: v.rid,
          due_at: iso(v.due_date),
        });
      }
    }

    /**
     * Lote de comprobantes por agotarse.
     *
     * `seriesStatus` (dominio, G4-2) ya sabe cuántos quedan y cuándo eso es poco; acá solo se lo
     * consulta. Se avisa ANTES porque quedarse sin formas libres no es un trámite: es no poder
     * facturar hasta que la imprenta entregue el lote nuevo, y eso tarda.
     *
     * Las series SIN tope (el correlativo propio del emisor) no se agotan nunca: `remaining` es
     * null y quedan fuera, que es distinto de cero.
     */
    if (cfg.get('fiscal_series_low')!.active) {
      const umbral = cfg.get('fiscal_series_low')!.days;
      const series = await this.db.query<any>(
        `SELECT id, purpose, document_type, prefix, padding, next_number, range_to
           FROM fiscal_series
          WHERE tenant_id = $1 AND is_active AND deleted_at IS NULL AND range_to IS NOT NULL`,
        [t],
      );
      for (const s of series) {
        const st = seriesStatus(Number(s.next_number), Number(s.range_to), s.prefix, s.padding, umbral);
        if (st.health === 'ok' || st.remaining === null) continue;
        const que = s.purpose === 'control' ? 'números de control' : `comprobantes de ${s.document_type}`;
        out.push({
          code: 'fiscal_series_low',
          category: 'compliance',
          // Agotada = no se puede emitir AHORA. Es la definición de crítico.
          severity: st.health === 'exhausted' ? 'critical' : 'warning',
          title: st.health === 'exhausted' ? `Sin ${que}: no se puede facturar` : `Quedan ${st.remaining} ${que}`,
          message:
            st.health === 'exhausted'
              ? 'El lote autorizado se agotó. Pedí el lote nuevo a la imprenta y cargá la serie.'
              : `Pedí el lote nuevo a la imprenta antes de que se termine.`,
          related_type: 'fiscal_series',
          related_id: s.id,
        });
      }
    }

    // ── Fase 1.2: los silos sanitarios ──────────────────────────────────────────────────────
    // Laboratorio y calidad de leche son los dos datos que hoy mueren donde se cargan, siendo que
    // son señales de salud animal. Van a `health` a propósito: un recuento celular alto es mastitis
    // subclínica, no «un dato del tambo».

    /**
     * Resultado de laboratorio fuera de rango.
     *
     * **Lo anormal lo decide el laboratorio**, no nosotros: se usa `is_abnormal`, que el propio
     * laboratorio marcó contra su rango de referencia. Discutirle el umbral desde acá sería inventar
     * medicina con datos que no tenemos.
     *
     * La parte difícil de un reconciliador acá: un resultado anormal es un HECHO y no deja de serlo
     * nunca — si la alerta dependiera solo de eso, no se apagaría jamás. Se apaga cuando alguien
     * **hizo algo**: abrió un caso clínico para ese animal después del resultado. Y caduca sola
     * pasada la ventana configurada, porque a esa altura ya es historia clínica y no una tarea
     * pendiente.
     *
     * Solo resultados con animal: una muestra de agua o de suelo anormal importa, pero no es una
     * alerta sanitaria del hato y merece su propio tratamiento.
     */
    if (cfg.get('lab_result_abnormal')!.active) {
      const anormales = await this.db.query<any>(
        `SELECT r.id AS rid, r.test_code, r.result_value, r.reference_range, r.reported_at,
                s.animal_id, ai.value AS tag
           FROM lab_results r
           JOIN lab_samples s ON s.id = r.sample_id AND s.deleted_at IS NULL
           JOIN animals a ON a.id = s.animal_id AND a.status = 'active' AND a.deleted_at IS NULL
           LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
          WHERE r.tenant_id = $1 AND r.deleted_at IS NULL AND r.is_abnormal
            AND r.reported_at IS NOT NULL
            AND r.reported_at >= now() - ($2::int * interval '1 day')
            -- Se apaga cuando alguien actuó: un caso clínico abierto DESPUÉS del resultado.
            AND NOT EXISTS (
              SELECT 1 FROM clinical_cases cc
               WHERE cc.animal_id = s.animal_id AND cc.tenant_id = r.tenant_id
                 AND cc.deleted_at IS NULL AND cc.started_at >= r.reported_at
            )
          ORDER BY r.reported_at DESC`,
        [t, cfg.get('lab_result_abnormal')!.days],
      );
      for (const r of anormales)
        out.push({
          code: 'lab_result_abnormal',
          category: 'health',
          severity: 'warning',
          title: `${r.test_code ?? 'Análisis'} fuera de rango — caravana ${r.tag ?? '—'}`,
          message: `Resultado ${r.result_value ?? '—'}${r.reference_range ? ` (referencia ${r.reference_range})` : ''}. Abrí un caso clínico si corresponde.`,
          related_type: 'animal',
          related_id: r.animal_id,
          due_at: iso(r.reported_at),
          tag: r.tag ?? null,
        });
    }

    /**
     * Recuento celular alto — mastitis subclínica.
     *
     * Solo el ÚLTIMO análisis de cada vaca y de cada tanque: un recuento alto de hace tres meses,
     * ya normalizado, no es un problema de hoy. Tomando el último, un análisis nuevo y bueno apaga
     * la alerta solo — que es exactamente lo que se quiere de un reconciliador.
     *
     * El tanque es CRÍTICO y la vaca es warning, y no es una gradación arbitraria: un recuento alto
     * en el tanque compromete la ENTREGA ENTERA —el precio de toda la leche del día, y en muchos
     * casos su aceptación—, mientras que una vaca sola todavía se puede apartar del ordeñe.
     */
    if (cfg.get('milk_scc_high')!.active) {
      const umbral = cfg.get('milk_scc_high')!.days;
      const altos = await this.db.query<any>(
        `SELECT DISTINCT ON (COALESCE(q.animal_id::text, q.tank_id::text))
                q.id, q.scc, q.sample_date, q.animal_id, q.tank_id,
                ai.value AS tag, mt.name AS tank_name
           FROM milk_quality_tests q
           LEFT JOIN animals a ON a.id = q.animal_id AND a.deleted_at IS NULL
           LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = q.animal_id AND x.type='visual' AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
           LEFT JOIN milk_tanks mt ON mt.id = q.tank_id
          WHERE q.tenant_id = $1 AND q.deleted_at IS NULL AND q.scc IS NOT NULL
            AND (q.animal_id IS NOT NULL OR q.tank_id IS NOT NULL)
          ORDER BY COALESCE(q.animal_id::text, q.tank_id::text), q.sample_date DESC, q.created_at DESC`,
        [t],
      );
      for (const m of altos) {
        if (!(Number(m.scc) > umbral)) continue;
        const esTanque = !m.animal_id && m.tank_id;
        out.push({
          code: 'milk_scc_high',
          category: 'health',
          severity: esTanque ? 'critical' : 'warning',
          title: esTanque
            ? `Recuento celular alto en el tanque ${m.tank_name ?? '—'}`
            : `Recuento celular alto — caravana ${m.tag ?? '—'}`,
          message: esTanque
            ? `${m.scc} en el último análisis: compromete la entrega completa.`
            : `${m.scc} en el último análisis (umbral ${umbral}). Revisá mastitis subclínica.`,
          related_type: esTanque ? 'milk_tank' : 'animal',
          related_id: esTanque ? m.tank_id : m.animal_id,
          due_at: iso(m.sample_date),
          tag: m.tag ?? null,
        });
      }
    }

    // ── Fase 1.3: activos y cumplimiento ────────────────────────────────────────────────────
    // Las dos son «algo que vence»: una máquina que pide service y un papel que pierde vigencia.
    // Se avisan ANTES porque las dos tienen plazo de gestión — conseguir el taller, renovar el
    // certificado— y llegar tarde cuesta la cosecha o la venta.

    /**
     * Mantenimiento programado.
     *
     * Solo el ÚLTIMO registro de cada máquina: `next_due_date` viene del service anterior, así que
     * hacer el mantenimiento nuevo —con su próxima fecha— apaga la alerta sola. Mirar todos los
     * registros repetiría el aviso una vez por cada service histórico de la máquina.
     */
    if (cfg.get('maintenance_due')!.active) {
      const vencen = await this.db.query<any>(
        `SELECT DISTINCT ON (m.id) m.id AS rid, m.name, m.type, r.next_due_date, r.type AS ultimo_tipo,
                (r.next_due_date - CURRENT_DATE)::int AS faltan
           FROM machinery m
           JOIN maintenance_records r ON r.machinery_id = m.id AND r.deleted_at IS NULL AND r.next_due_date IS NOT NULL
          WHERE m.tenant_id = $1 AND m.deleted_at IS NULL
          ORDER BY m.id, r.performed_at DESC, r.created_at DESC`,
        [t],
      );
      for (const v of vencen) {
        if (v.faltan > cfg.get('maintenance_due')!.days) continue;
        const vencido = v.faltan < 0;
        out.push({
          code: 'maintenance_due',
          category: 'machinery',
          // Vencido = la máquina está trabajando sin el service hecho. Eso ya es riesgo de rotura.
          severity: vencido ? 'critical' : 'warning',
          title: vencido
            ? `${v.name}: mantenimiento vencido hace ${Math.abs(v.faltan)} días`
            : `${v.name}: mantenimiento en ${v.faltan} días`,
          message: `Último service: ${v.ultimo_tipo ?? '—'}. Programado para el ${fmt(v.next_due_date)}.`,
          related_type: 'machinery',
          related_id: v.rid,
          due_at: iso(v.next_due_date),
        });
      }
    }

    /**
     * Certificación por vencer.
     *
     * La vigencia se DERIVA de `valid_until`, igual que el `is_expired` del módulo: no hay estado
     * que un cron tenga que actualizar. Las suspendidas y revocadas quedan fuera — ésas no vencen,
     * ya están fuera de juego por otra razón y avisarlas como «por vencer» confundiría el motivo.
     */
    if (cfg.get('certification_expiring')!.active) {
      const porVencer = await this.db.query<any>(
        `SELECT c.id AS rid, c.scheme, c.issuer, c.entity_type, c.valid_until,
                (c.valid_until - CURRENT_DATE)::int AS faltan
           FROM certifications c
          WHERE c.tenant_id = $1 AND c.deleted_at IS NULL AND c.status = 'active'
            AND c.valid_until IS NOT NULL
            AND c.valid_until <= CURRENT_DATE + $2::int
          ORDER BY c.valid_until`,
        [t, cfg.get('certification_expiring')!.days],
      );
      for (const c of porVencer) {
        const vencida = c.faltan < 0;
        out.push({
          code: 'certification_expiring',
          category: 'compliance',
          // Vencida ya bloquea: sin certificación vigente no se vende.
          severity: vencida ? 'critical' : 'warning',
          title: vencida ? `${c.scheme}: certificación VENCIDA` : `${c.scheme}: vence en ${c.faltan} días`,
          message: vencida
            ? `Venció el ${fmt(c.valid_until)}. Sin ella no se puede comercializar lo certificado.`
            : `Vence el ${fmt(c.valid_until)}${c.issuer ? ` (${c.issuer})` : ''}. Iniciá la renovación.`,
          related_type: 'certification',
          related_id: c.rid,
          due_at: iso(c.valid_until),
        });
      }
    }

    return out;
  }
}
