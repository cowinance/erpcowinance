import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { DashboardService } from './dashboard.service';
import { TaskService } from '../tasks/task.service';
import { AlertsService } from '../alerts/alerts.service';
import { HealthService } from '../health/health.service';
import { ReproService } from '../repro/repro.service';
import { farmSetupProgress } from '@cowinance/domain';

/**
 * Inicio como CENTRO DE CONTROL DIARIO (mejora Home). Endpoint agregado `/dashboard/home`:
 * COMPONE los servicios existentes (dashboard/tasks/alerts/health/repro) en UNA respuesta —
 * NO duplica reglas de negocio. Cada número viene de su dueño:
 *  - dashboard.kpis  → hato/GDP/preñez/peso/actividad reciente
 *  - tasks.kpis      → tareas vencidas/hoy/cumplimiento
 *  - alerts.kpis     → alertas críticas/abiertas
 *  - alerts.agenda   → agenda accionable (health/repro; ya corre computeReproStatus una vez →
 *                      de acá salen listas-para-servicio/diagnóstico-pendiente/parto-próximo)
 *  - health.kpis     → en tratamiento/casos/vacunas
 *  - repro.kpis      → preñez/partos (barato)
 * Todo en paralelo (wall-clock = la más lenta). Arma: prioridad, KPIs, estado general, agenda
 * combinada, actividad reciente y conteos por módulo.
 */
@Injectable()
export class DashboardHomeService {
  constructor(
    private readonly db: DbService,
    private readonly dashboard: DashboardService,
    private readonly tasks: TaskService,
    private readonly alerts: AlertsService,
    private readonly health: HealthService,
    private readonly repro: ReproService,
  ) {}

  async home() {
    // `alerts.agendaAndKpis()` comparte el computeDesired (lo caro: herdStatus O(vientres)) entre
    // la agenda y los KPIs. Antes se llamaba agenda() + kpis() por separado → se computaba DOS veces.
    const [base, taskK, alertsBundle, healthK, reproK, openTasks, noWeigh, recent, setup]: any[] = await Promise.all([
      this.dashboard.kpis(),
      this.tasks.kpis(),
      this.alerts.agendaAndKpis(),
      this.health.kpis(),
      this.repro.kpis(),
      this.tasks.board({ status: 'open' }),
      this.noRecentWeighing(),
      this.recentActivity(),
      this.farmSetup(),
    ]);
    const { agenda, kpis: alertK } = alertsBundle as { agenda: any[]; kpis: any };

    // Señales repro-derivadas contadas desde la agenda (evita recomputar herdStatus).
    const agendaBy = (code: string) => agenda.filter((a: any) => a.code === code).length;
    const readyForService = agendaBy('vwp_ready') + agendaBy('service_prep_due');
    const diagnosisPending = agendaBy('diagnosis_due');
    const calvingsSoon = reproK.calvings_due_30d ?? agendaBy('calving_soon');
    const withdrawals = (base.alerts?.active_withdrawals ?? []).length;

    const kpis = {
      active_animals: base.active_animals,
      total_animals: base.total_animals,
      new_this_month: base.new_this_month,
      avg_adg_kg_day: base.avg_adg_kg_day,
      pregnancy_rate_pct: base.pregnancy?.rate ?? null,
      open_pregnancies: base.pregnancy?.open ?? 0,
      breeding_females: base.pregnancy?.breeding_females ?? 0,
      overdue_tasks: taskK.overdue,
      urgent_tasks: taskK.critical_overdue,
      done_today: taskK.done_today,
      compliance_pct: taskK.compliance_pct,
      open_tasks: taskK.open,
      critical_alerts: alertK.critical,
      open_alerts: alertK.open,
      active_withdrawals: withdrawals,
      vaccines_overdue: healthK.vaccinations_overdue,
      vaccines_due_45d: healthK.vaccinations_due_45d,
      in_treatment: healthK.animals_in_treatment_30d,
      clinical_cases_open: healthK.clinical_cases_open,
      ready_for_service: readyForService,
      diagnosis_pending: diagnosisPending,
      calvings_soon: calvingsSoon,
      no_recent_weighing: noWeigh,
    };

    // ── Atención prioritaria: solo lo que tiene volumen, ordenado por severidad y cantidad ──
    const P = [
      { code: 'tasks_overdue', label: 'Tareas vencidas', count: taskK.overdue, severity: 'critical', href: '/tareas?bucket=overdue' },
      { code: 'critical_alerts', label: 'Alertas críticas', count: alertK.critical, severity: 'critical', href: '/alertas' },
      { code: 'tasks_urgent', label: 'Tareas urgentes', count: taskK.critical_overdue, severity: 'warning', href: '/tareas' },
      { code: 'active_withdrawals', label: 'Retiros activos', count: withdrawals, severity: 'warning', href: '/sanidad' },
      { code: 'vaccines_overdue', label: 'Vacunas vencidas', count: healthK.vaccinations_overdue, severity: 'warning', href: '/sanidad' },
      { code: 'clinical_cases', label: 'Casos clínicos abiertos', count: healthK.clinical_cases_open, severity: 'warning', href: '/sanidad' },
      { code: 'in_treatment', label: 'Animales en tratamiento', count: healthK.animals_in_treatment_30d, severity: 'info', href: '/sanidad' },
      { code: 'diagnosis_pending', label: 'Diagnósticos pendientes', count: diagnosisPending, severity: 'warning', href: '/reproduccion' },
      { code: 'ready_for_service', label: 'Listas para servicio', count: readyForService, severity: 'info', href: '/reproduccion' },
      { code: 'calvings_soon', label: 'Partos próximos (30 d)', count: calvingsSoon, severity: 'info', href: '/reproduccion' },
      { code: 'vaccines_due', label: 'Vacunas próximas (45 d)', count: healthK.vaccinations_due_45d, severity: 'info', href: '/sanidad' },
      { code: 'no_recent_weighing', label: 'Sin pesaje reciente', count: noWeigh, severity: 'info', href: '/animales?no_recent_weighing=90' },
    ];
    const SEV_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    const priority = P.filter((p) => p.count > 0).sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.count - a.count);

    // ── Estado general de la finca ──
    const farm_status = {
      operation: alertK.critical > 0 ? 'critical' : taskK.overdue > 0 ? 'late' : 'ok',
      health: withdrawals > 0 || healthK.clinical_cases_open > 0 || healthK.vaccinations_overdue > 0 ? 'attention' : 'stable',
      reproduction: diagnosisPending > 0 || readyForService > 0 ? 'action' : 'stable',
      tasks: taskK.overdue > 0 ? 'overdue' : 'ok',
    };

    // ── Agenda combinada: health/repro (alerts.agenda, ya ordenada) + tareas vencidas/hoy ──
    // Ítems de tarea en el contrato de la agenda web (AgendaAttention): related_type='task' +
    // action='complete_task' → renderiza el botón «✓» y usa related_id como taskId.
    //
    // DEDUP: el motor de alertas ya expone las tareas SANITARIAS por su cuenta (regla
    // `health_task_due`, con related_type='task' y el mismo id). Sin este filtro, una tarea de
    // sanidad vencida aparecía DOS VECES en «Atención hoy». Se conserva la del motor (trae el
    // mensaje sanitario) y solo se agregan las tareas que no estén ya representadas.
    const alreadyInAgenda = new Set(
      (agenda as any[]).filter((a) => a.related_type === 'task' && a.related_id).map((a) => a.related_id),
    );
    const taskAgenda = (openTasks as any[])
      .filter((t) => (t.bucket === 'overdue' || t.bucket === 'today') && !alreadyInAgenda.has(t.id))
      .map((t) => ({
        code: 'task',
        category: 'task',
        severity: t.bucket === 'overdue' ? (t.priority === 'urgent' ? 'critical' : 'warning') : 'info',
        due_at: t.due_date ? new Date(t.due_date).toISOString() : null,
        title: t.title,
        message: (t.days_overdue != null ? `${t.days_overdue} d vencida` : 'Vence hoy') + (t.related_name ? ` · ${t.related_name}` : ''),
        related_type: 'task',
        related_id: t.id,
        tag: t.related_name ?? null,
        action: 'complete_task',
      }));
    const SEV_A: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    const combinedAgenda = [...(agenda as any[]), ...taskAgenda].sort((a, b) => {
      const ad = a.due_at ?? '9999-12-31';
      const bd = b.due_at ?? '9999-12-31';
      if (ad !== bd) return ad < bd ? -1 : 1;
      return (SEV_A[a.severity] ?? 2) - (SEV_A[b.severity] ?? 2);
    });

    return {
      role: this.db.role ?? null,
      // Qué le falta a la finca para estar en marcha. Va SIEMPRE, no solo con el hato vacío: el
      // panel viejo se iba al cargar el primer animal, justo cuando empezaba a hacer falta.
      setup,
      kpis,
      priority,
      farm_status,
      agenda: combinedAgenda,
      recent_activity: recent,
      by_category: base.by_category,
      weight_series: base.weight_series,
      counts: {
        tasks_by_module: taskK.by_module,
        tasks_by_assignee: taskK.by_assignee,
        alerts: { open: alertK.open, critical: alertK.critical, warning: alertK.warning },
      },
    };
  }

  /**
   * Qué le falta a la finca para estar en marcha (O-2), con los textos y los enlaces.
   *
   * La REGLA —cuáles son los pasos, en qué orden y cuándo está dado cada uno— vive en el dominio
   * (`farmSetupProgress`). Acá solo se averiguan los hechos y se les pone nombre, igual que hace la
   * atención prioritaria: el backend devuelve el texto en español y el `href`, y la pantalla dibuja.
   *
   * Se pregunta con `EXISTS` y no con `count(*)`: la pregunta es «¿hay al menos uno?», y `EXISTS`
   * corta en la primera fila. Con `count(*)` una finca de miles de animales pagaría el recorrido
   * entero de cuatro tablas en CADA carga del Inicio, que es la pantalla que más se abre — la misma
   * lección que dejaron los dos cuadráticos del barrido de volumen.
   */
  private async farmSetup() {
    const f = (await this.db.one<{
      animales: boolean;
      lotes: boolean;
      pesajes: boolean;
      sanidad: boolean;
    }>(
      `SELECT
         EXISTS (SELECT 1 FROM animals   WHERE tenant_id=$1 AND deleted_at IS NULL) AS animales,
         EXISTS (SELECT 1 FROM lots      WHERE tenant_id=$1 AND deleted_at IS NULL) AS lotes,
         EXISTS (SELECT 1 FROM weighings WHERE tenant_id=$1 AND deleted_at IS NULL) AS pesajes,
         EXISTS (
           SELECT 1 FROM treatments   WHERE tenant_id=$1 AND deleted_at IS NULL
           UNION ALL
           SELECT 1 FROM vaccinations WHERE tenant_id=$1 AND deleted_at IS NULL
         ) AS sanidad`,
      [this.db.tenant],
    ))!;

    const progreso = farmSetupProgress({
      hasAnimals: f.animales,
      hasLots: f.lotes,
      hasWeighings: f.pesajes,
      hasHealthRecords: f.sanidad,
    });

    // Cada paso dice QUÉ desbloquea, no solo qué hacer: «cargá tus animales» sin el porqué es una
    // tarea; «sin esto el sistema no puede decirte nada» es una razón.
    const COPY: Record<string, { title: string; body: string; href: string; action: string; altHref?: string; altAction?: string }> = {
      herd: {
        title: 'Cargá tu hato',
        body: 'Todo lo demás cuelga de acá. Si ya lo tenés en una planilla, importalo de una vez en lugar de cargarlo animal por animal.',
        href: '/animales/nuevo',
        action: 'Cargar un animal',
        altHref: '/animales/importar',
        altAction: 'Importar planilla',
      },
      lots: {
        title: 'Agrupá en lotes',
        body: 'El trabajo de campo se organiza por grupo: mover, pesar, vacunar y sacar cuentas se hace por lote, no animal por animal.',
        href: '/lotes',
        action: 'Crear un lote',
      },
      weighing: {
        title: 'Registrá un pesaje',
        body: 'Con dos pesajes la app calcula sola la ganancia diaria de peso, que es el número que dice si el rodeo está andando.',
        href: '/manga',
        action: 'Abrir modo manga',
      },
      health: {
        title: 'Anotá una sanidad',
        body: 'Un tratamiento o una vacuna encienden los retiros y los avisos sanitarios: la app pasa a avisarte antes de que se te pase algo.',
        href: '/sanidad',
        action: 'Registrar sanidad',
      },
    };

    return {
      ...progreso,
      steps: progreso.steps.map((s) => ({ code: s.code, done: s.done, ...COPY[s.code] })),
    };
  }

  /** Actividad reciente ENRIQUECIDA (Home E3): tipo + caravana + lote + responsable + fecha. */
  private async recentActivity(): Promise<any[]> {
    return this.db.query<any>(
      `SELECT e.event_type, e.payload, e.occurred_at, e.source, e.animal_id,
              ai.value AS tag,
              COALESCE(u.full_name, u.email) AS actor_name,
              l.name AS lot_name
       FROM animal_events e
       LEFT JOIN animals a ON a.id = e.animal_id
       LEFT JOIN lots l ON l.id = a.current_lot_id
       LEFT JOIN users u ON u.id = e.created_by
       LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = e.animal_id AND x.type='visual' AND x.deleted_at IS NULL AND x.retired_at IS NULL ORDER BY x.created_at DESC LIMIT 1) ai ON true
       WHERE e.tenant_id = $1 AND e.deleted_at IS NULL
       ORDER BY e.occurred_at DESC LIMIT 12`,
      [this.db.tenant],
    );
  }

  /**
   * Conteo de animales activos sin pesaje en 90 días (umbral, no regla de negocio).
   *
   * Va contra `weighings`, la tabla, y NO contra `v_weighings`, la vista.
   *
   * La vista existe para derivar la GDP con un `LAG` sobre los pesajes de cada animal. Preguntarle
   * «¿este animal se pesó?» desde un `NOT EXISTS` correlacionado hacía que por CADA animal se
   * pagara el cálculo de esa ventana: O(animales × pesajes). Medido, con el hato inflado:
   *
   *     65 animales →    49 ms
   *   1.065        →   990 ms
   *   3.065        → 7.156 ms      ← el triple de datos, siete veces el tiempo
   *
   * Era el 99% del tiempo de `/dashboard/home`, la pantalla que más se abre, y no se veía con los
   * 66 animales del demo. Acá no hace falta la GDP: solo si hay una fila, y eso está en la tabla
   * base, que además tiene el índice `(tenant_id, animal_id, weighed_at)`.
   */
  private async noRecentWeighing(): Promise<number> {
    const row = await this.db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM animals a
       WHERE a.tenant_id = $1 AND a.status = 'active' AND a.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM weighings w
            WHERE w.animal_id = a.id AND w.tenant_id = a.tenant_id AND w.deleted_at IS NULL
              AND w.weighed_at >= now() - interval '90 days')`,
      [this.db.tenant],
    );
    return row?.n ?? 0;
  }
}
