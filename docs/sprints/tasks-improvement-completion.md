# Tareas → centro operativo diario (COMPLETO 6/6)

De una lista simple (crear/completar/cancelar) a la **agenda inteligente de la finca**: qué hacer
hoy, qué está vencido, qué viene, quién es responsable, con qué animal/lote/protocolo, y actuar
rápido desde web y modo manga. Reusa `TaskService` como fuente única; no rompe endpoints ni el
contrato de sync/offline. `apps/api/src/modules/tasks`, web `/tareas`, integración `/manga`.

## Etapas

### E1 — Máquina de estados + campos operativos + historial + sync (`25ceec7`)
`startTask` (pending→in_progress), complete/cancel desde in_progress, `rescheduleTask`
(due_date+motivo; timestamptz→comparar por epoch), `assignTask` (assigned_to → TASK_SYNC_FIELDS,
converge en devices). Historial `task_events` (server-authored, no sincroniza). Sync handler
soporta iniciar/cancelar/reprogramar offline. Esquema: task_events, task_recurrences, tasks.
rule_key/recurrence_id + índice único parcial de dedup. Endpoints /tasks/:id/start|reschedule|assign.

### E2 — Tablero operativo + KPIs (`c3b6d54`)
`board(filters)` (buckets SQL, joins de nombres, días de atraso, filtros estado/prioridad/
responsable/módulo/bucket/relacionado/búsqueda), `kpis()` (vencidas/críticas/cumplimiento/atraso/
carga/tendencia), `assignees()`. Rewrite web a tablero: KPIs + tabs por bucket + filtros +
tarjetas con acciones rápidas. La primera pantalla es la agenda.

### E3 — Detalle + comentarios + acciones masivas (`12d1460`)
`setPriority`, `addComment` (task_events kind=comment), `detail(id)` (completo+relacionado+
historial con actor), `bulk` (varias en 1 tx, saltea rechazos de dominio sin abortar). Web:
drawer de detalle (historial timeline + comentarios) + selección múltiple + barra masiva.

### E4 — Reglas ganaderas automáticas con dedup (`64b1560`)
Dedup por `rule_key` en `createTask` (una viva por regla+entidad; {already}). `TaskRulesService.
materialize`: weigh_due/vaccine_due/withdrawal_end/lot_review (escanea el hato, idempotente).
Por evento: repro.diagnose genera Control-de-preñez / Preparar-servicio con dedup. Web botón
«Generar automáticas». NO reemplaza alertas.

### E5 — Tareas recurrentes (`35ebcfe`)
`task_recurrences` (plantilla + interval_days + anchor + next_due). Generación en materialize
(una viva a la vez, dedup recurrence_id); `completeTask` avanza next_due al completar según
anclaje. CRUD create/list/deactivate. Web: drawer «Recurrentes».

### E6 — Integración Manga + notificaciones (`395a472`)
Manga: al escanear, tira de tareas pendientes del animal + «✓ Hecho» (1 toque). Notificaciones:
reglas task_overdue/task_due_today/task_urgent en el motor de alertas → notificaciones P7 (dedup
por alerta); NOTIFIABLE_CATEGORIES += 'task' (excluye sync_* por código). Configurable desde /configuracion.

## Criterios técnicos cumplidos
- `TaskService` = fuente única del CÓMO; todos los canales (REST/sync/repro/sanidad/recurrencia/
  reglas) delegan en él.
- Sync server-origin/offline preservado; assigned_to sincroniza; historial/trazabilidad en task_events.
- Idempotencia: transiciones idempotentes, dedup por rule_key/recurrence_id, Idempotency-Key en web.
- Multi-tenant (RLS en task_events/task_recurrences); no rompe endpoints existentes (GET /tasks legacy).

## Estado
- **Tasks 42 tests** (+ alerts/notifications 68 = 110 en las suites tocadas). tsc limpio.
- Esquema nuevo: task_events, task_recurrences, tasks.rule_key/recurrence_id (migración idempotente).

## Diferido / follow-up
- **UI móvil** (`apps/mobile/src/app/tareas.tsx`): botones de iniciar/reprogramar/asignar y el
  tablero rico. El SOPORTE offline del sync handler (iniciar/cancelar/reprogramar) ya está en E1.
- **Materialización/notificaciones programadas**: hoy se disparan manualmente (botón/endpoint) o
  al abrir el feed; un cron las volvería automáticas (infra de scheduled-tasks disponible).
- GOTCHA de dev: Next deja errores de compile STALE en consola para TasksBoard (el `<div/>`
  auto-cerrado hace ver 37/36 divs); tsc/esbuild/bundle OK, el board funciona.
