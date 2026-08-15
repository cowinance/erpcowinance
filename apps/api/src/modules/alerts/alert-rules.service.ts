import { Injectable } from '@nestjs/common';
import { computeStockRotation, nitrogenAlertMessage, seriesStatus } from '@cowinance/domain';
import { DbService } from '../../db/db.service';
import type { Desired, RuleConfig } from './alerts.types';
import { ReproStatusService } from '../repro/repro-status.service';
import { WeatherService } from '../weather/weather.service';
import { NitrogenService } from '../genetics/nitrogen.service';

/**
 * Ventana para medir el ritmo de consumo de un insumo.
 *
 * Medio año: suficiente para promediar la estacionalidad de una finca (una campaña sanitaria, un
 * invierno de suplementación) sin arrastrar un ritmo de hace dos años que ya no es el de hoy. Es el
 * mismo período por defecto que usa la pantalla de rotación, para que el mínimo sugerido que se ve
 * ahí sea el mismo con el que dispara la alerta.
 */
const STOCK_CONSUMPTION_WINDOW_DAYS = 180;

/** Nivel de estrés en el idioma del producto: la alerta la lee una persona, no un sistema. */
const NIVEL_ES: Record<string, string> = { mild: 'leve', moderate: 'moderado', severe: 'severo', emergency: 'de emergencia' };

const fmt = (d: string | Date) => new Date(d).toLocaleDateString('es-AR');
const iso = (d: string | Date | null | undefined) => (d ? new Date(d).toISOString() : null);

/**
 * El ESTADO DESEADO de las alertas: qué debería estar abierto ahora mismo según el estado del
 * dominio. Una regla por bloque, cada una saltea si el tenant la apagó y lee su umbral de `cfg`.
 *
 * SEPARADO de `AlertsService` porque son dos trabajos distintos que solo compartían archivo:
 * acá se DECIDE qué alertas corresponden; allá se administra su ciclo de vida (crear, actualizar,
 * auto-resolver, reconocer, descartar) y se sirven las pantallas. `alerts.service.ts` había
 * llegado a 1094 líneas, el servicio más grande del repo.
 *
 * El corte además saca de `AlertsService` tres dependencias que solo usaba el motor: repro, clima
 * y nitrógeno. Ahora el ciclo de vida de una alerta depende únicamente de la base.
 *
 * NO tiene estado ni cachea: el caché por tenant vive en `AlertsService`, que es quien sabe cuándo
 * invalidarlo. Acá solo se calcula.
 */
@Injectable()
export class AlertRulesService {
  constructor(
    private readonly db: DbService,
    private readonly repro: ReproStatusService,
    private readonly weather: WeatherService,
    private readonly nitrogen: NitrogenService,
  ) {}

  /** Evalúa TODAS las reglas activas y devuelve las alertas que deberían existir. */
  async compute(cfg: RuleConfig): Promise<Desired[]> {
    const t = this.db.tenant;
    const out: Desired[] = [];

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
    // preparar) — DERIVADAS de la regla única `computeReproStatus` en ReproStatusService (no se re-implementa
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
