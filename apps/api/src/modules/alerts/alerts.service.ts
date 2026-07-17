import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvalidCatalogEntryError, assertThresholdDays } from '@cowinance/domain';
import { DbService } from '../../db/db.service';
import { ReproService } from '../repro/repro.service';

/**
 * Motor de alertas (doc Catálogo A5). Reglas declarativas condición→severidad
 * evaluadas contra el estado del dominio. La evaluación es idempotente: cada
 * alerta se identifica por (regla, entidad); reevaluar actualiza las vigentes,
 * crea las nuevas y auto-resuelve las que ya no aplican — nunca duplica.
 *
 * En dev la evaluación es read-through (se dispara al leer los KPIs). En
 * producción es event-driven (Kafka) + cron (BullMQ), con la misma lógica.
 */

interface RuleDef {
  code: string;
  name: string;
  category: 'health' | 'reproduction' | 'task';
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
];

interface Desired {
  code: string;
  category: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  related_type: string | null;
  related_id: string | null;
  /** Datos estructurados que la agenda (P4) reutiliza; `evaluate()` los ignora. */
  due_at?: string | null;
  tag?: string | null;
}

/** Ítem de la agenda diaria (P4-1): hecho accionable estructurado del hato. */
export interface AgendaItemDto {
  code: string;
  category: string;
  severity: 'info' | 'warning' | 'critical';
  due_at: string | null;
  title: string;
  message: string;
  related_type: string | null;
  related_id: string | null;
  tag: string | null;
  /** Acción SEMÁNTICA; cada superficie la mapea a su ruta (móvil/web). */
  action: 'vaccinate' | 'review_pregnancy' | 'view_animal' | 'complete_task';
}

const fmt = (d: string | Date) => new Date(d).toLocaleDateString('es-AR');
const iso = (d: string | Date | null | undefined) => (d ? new Date(d).toISOString() : null);
const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };
const AGENDA_ACTION: Record<string, AgendaItemDto['action']> = {
  vaccination_due: 'vaccinate',
  pregnancy_overdue: 'review_pregnancy',
  calving_soon: 'view_animal',
  withdrawal_active: 'view_animal',
  health_task_due: 'complete_task',
};

@Injectable()
export class AlertsService {
  constructor(
    private readonly db: DbService,
    private readonly repro: ReproService,
  ) {}

  /** Reevalúa todas las reglas: crea/actualiza/auto-resuelve. Idempotente.
   *  `precomputed` evita recomputar cuando el caller ya tiene los hechos (agenda, P4-1). */
  async evaluate(precomputed?: Desired[]) {
    const t = this.db.tenant;
    const ruleIds = await this.ensureRules();
    const desired = precomputed ?? (await this.computeDesired());

    // Activas (para actualizar/auto-resolver) + resueltas/descartadas recientes
    // (para respetar la acción del usuario y no recrear la misma alerta al toque).
    const existing = await this.db.query<any>(
      `SELECT id, rule_id, related_id, status FROM alerts
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
      else muted.add(k);
    }

    const seen = new Set<string>();
    let created = 0;
    let updated = 0;
    for (const d of desired) {
      const k = key(ruleIds[d.code], d.related_id);
      seen.add(k);
      const ex = active.get(k);
      if (ex) {
        await this.db.query(
          `UPDATE alerts SET severity = $2, title = $3, message = $4, category = $5, updated_at = now() WHERE id = $1`,
          [ex.id, d.severity, d.title, d.message, d.category],
        );
        updated++;
      } else if (muted.has(k)) {
        // el usuario ya la resolvió/descartó hace poco: no la recreamos
      } else {
        await this.db.query(
          `INSERT INTO alerts (tenant_id, rule_id, category, severity, title, message, related_type, related_id, status, triggered_at, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',now(),$9)`,
          [t, ruleIds[d.code], d.category, d.severity, d.title, d.message, d.related_type, d.related_id, this.db.user],
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
    return desired
      .filter((d) => d.category === 'health' || d.category === 'reproduction')
      .map((d) => ({
        code: d.code,
        category: d.category,
        severity: d.severity,
        due_at: iso(d.due_at),
        title: d.title,
        message: d.message,
        related_type: d.related_type,
        related_id: d.related_id,
        tag: d.tag ?? null,
        action: AGENDA_ACTION[d.code] ?? 'view_animal',
      }))
      .sort((a, b) => {
        const ad = a.due_at ?? '9999-12-31';
        const bd = b.due_at ?? '9999-12-31';
        if (ad !== bd) return ad < bd ? -1 : 1;
        return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      });
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

    return this.db.query(
      `SELECT al.id, al.category, al.severity, al.title, al.message, al.related_type, al.related_id,
              al.status, al.triggered_at, ai.value AS tag
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
  }

  /** KPIs con evaluación read-through (mantiene alertas y badge frescos). */
  async kpis() {
    await this.evaluate();
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
    const row = await this.db.one(
      `UPDATE alerts SET status = $2${resolvedAt}, updated_at = now()
       WHERE id = $1 AND tenant_id = $3 AND deleted_at IS NULL RETURNING id, status`,
      [id, status, this.db.tenant],
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

  private async computeDesired(): Promise<Desired[]> {
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
    const todayStr = new Date().toISOString().slice(0, 10);
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

    // Tareas sanitarias programadas (de planes) por vencer o vencidas
    if (cfg.get('health_task_due')!.active) {
    const tasks = await this.db.query<any>(
      `SELECT tk.id AS rid, tk.title, tk.due_date, (tk.due_date::date < CURRENT_DATE) AS overdue
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

    return out;
  }
}
