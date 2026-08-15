import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvalidCatalogEntryError, assertThresholdDays } from '@cowinance/domain';
import { DbService } from '../../db/db.service';
import type { AgendaItemDto, Desired, RuleConfig } from './alerts.types';
import { DesiredCache } from './desired-cache';
import { toAgenda } from './agenda-projection';
import { isReadOnlySession } from '../../common/request-context';
import { AlertRulesService } from './alert-rules.service';

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

export type { AgendaItemDto, Desired } from './alerts.types';

@Injectable()
export class AlertsService {
  constructor(
    private readonly db: DbService,
    private readonly rules: AlertRulesService,
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
  private async ruleConfig(): Promise<RuleConfig> {
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
   *
   * El cálculo en sí lo hace `AlertRulesService`; acá queda el caché, porque el que sabe cuándo hay
   * que invalidarlo es el ciclo de vida de la alerta, no la evaluación de las reglas.
   */
  private computeDesired(): Promise<Desired[]> {
    return this.cacheDesired.through(this.db, async () => this.rules.compute(await this.ruleConfig()));
  }
}
