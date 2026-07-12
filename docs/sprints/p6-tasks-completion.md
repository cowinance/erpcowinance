# P6 — Tareas y Calendario (+ agenda accionable) · Cierre de sprint

**Estado:** ✅ COMPLETO · **Rama:** `main`
**Alcance:** planificación propia del ganadero — tareas de finca que se **crean y completan**
en web y móvil, convergentes entre canales, reutilizando el motor de sync existente; y la
**agenda accionable** (completar una tarea desde «Atención hoy» / «Hoy»).

> Registro histórico del sprint. Cierres previos: [`p2-import-completion.md`](./p2-import-completion.md),
> [`p3-movements-completion.md`](./p3-movements-completion.md), [`p4-agenda-completion.md`](./p4-agenda-completion.md),
> [`p5-capture-parity-completion.md`](./p5-capture-parity-completion.md).

---

## 1. Objetivo

Tras P5 (paridad de captura), el ganadero podía registrar hechos del hato pero **no
planificar y organizar el trabajo**: crear tareas ad-hoc («arreglar aguada», «revisar toro»),
verlas y completarlas. La tabla `tasks` ya existía en el esquema (con `type` general,
`priority`, `due_date`, `status`, `assigned_to`) pero **solo la usaba Sanidad**. P6 la
generaliza como **entidad de dominio propia**, y cierra el círculo P4↔P5 haciendo la agenda
**accionable** (completar tareas), sin duplicar reglas.

## 2. Alcance implementado

- **Backend** — nuevo bounded context `tasks`:
  - `TaskService` neutral: **fuente única** del CÓMO se crea / completa / cancela una tarea.
  - `TaskSyncHandler` (put + LWW): canal de sync entrante, delega en `TaskService`.
  - Bootstrap de tareas pendientes (incluye las de Sanidad → completar offline).
  - REST: `POST /tasks`, `POST /tasks/:id/complete`, `POST /tasks/:id/cancel`, `GET /tasks`.
  - Sanidad unificada: `plans.service` crea/completa vía `TaskService` (sin mover reglas clínicas).
- **Web** — `/tareas`: crear/completar/**cancelar** online por REST, lista agrupada por
  urgencia; «Atención hoy» completa tareas de Sanidad.
- **Móvil** — `sync.tasks()` (store local) + emit offline (`captureTaskCreate`/`captureTaskComplete`,
  put optimista); pantalla `/tareas` (lista + crear + completar) + card en el home; «Hoy»
  completa tareas y **auto-oculta** las ya cerradas por cross-ref al store local.

## 3. Arquitectura final

```
   Web/REST/Sanidad (server-authored)        Móvil (device, offline)
        │  createTask/completeTask/cancelTask       │  setFields('tasks', …)  (put, optimismo local)
        ▼                                            ▼
   ┌───────────────  TaskService (REGLA ÚNICA por dominio)  ───────────────┐
   │  crear → pending · completar → done (+completed_at) · cancelar → canceled │
   │  contrato de estados RESTRINGIDO (pending→done/canceled; done/cancel no-op)│
   │  versiones LWW · idempotencia por id                                     │
   └──────────────────────────────────────────────────────────────────────┘
        │ emitServerOrigin=true (SOLO server-authored)      │ TaskSyncHandler (emitServerOrigin=false)
        ▼                                                    ▼
   changeset SERVER-ORIGIN  ──pull──►  todos los devices     el changeset del device ──pull──► otros devices
                                                             (sin eco server-origin: D2)
```

- **Entidad mutable → put + LWW** (patrón `pregnancies`), no event-only: completar/cancelar
  son cambios de estado, no hechos inmutables. En el móvil el put se aplica **local al
  instante** (optimismo correcto: no hay hecho compañero ni atomicidad en juego).
- **Server-origin selectivo (D2):** solo las mutaciones **server-authored** (REST/web/Sanidad)
  emiten changeset server-origin; las del dispositivo **no** (su propio changeset propaga por
  pull). Nunca hay eco redundante de una mutación aceptada del device.
- **`TaskSyncHandler`** discrimina crear/mutar por fila existente; **sanea** la creación del
  device (fuerza `general`/`pending`, ignora campos reservados) y rechaza como conflicto lo
  que sale del contrato P6 (`in_progress`, edición de campos, cancelar desde el device).

## 4. Decisiones arquitectónicas importantes

| Decisión | Motivo |
|---|---|
| **`TaskService` neutral, fuente única del «cómo»** | Regla en un solo lugar (regla permanente 1); REST, Sanidad y el sync son adaptadores. |
| **Unificar con Sanidad sin mover reglas clínicas (D3)** | Sanidad decide QUÉ tarea clínica debe existir; `TaskService` decide CÓMO se persiste/cambia. `plans.service` reusa `createTask`/`completeTask`. |
| **Server-origin solo server-authored, sin eco del device (D2)** | El changeset del device ya propaga por pull; un eco sería redundante. Contexto explícito `emitServerOrigin`. |
| **Contrato de estados restringido en P6** | `pending→done/canceled` únicamente; `in_progress` y transiciones no definidas se rechazan → no se publica funcionalidad sin consumidor ni reglas. |
| **Web online, móvil offline (corrección de alcance)** | El offline-first es del móvil (sync CRDT); la web muta por REST directo, sin service worker ni cola web. |
| **Cancelar difierido a su primer consumidor (web)** | Se agregó en P6-2 con la lista web; el móvil **recibe** cancelaciones (server-origin) pero no las inicia (el handler no acepta `canceled` del device). |
| **Asignación diferida (D1)** | Se conserva la columna `assigned_to` pero sin selección de usuarios/roles: requiere primero un vertical de miembros y permisos. Tareas = compartidas de la finca. |
| **Agenda móvil auto-corrige por cross-ref (D4)** | El snapshot de agenda es cacheado y no se refresca offline; se ocultan los ítems de tarea ya `done`/`canceled` en el store local. |
| **`completed_at` del device (D2)** | El instante efectivo de la acción offline lo pone el dispositivo; el servidor no lo deriva → sin eco. |

## 5. Criterios de aceptación cumplidos

- ✅ Crear una tarea general en web (REST) y en móvil (offline) → converge en el otro canal.
- ✅ Completar una tarea (web/móvil) → converge `done` en todos los dispositivos, con el
  `completed_at` del origen.
- ✅ Completar una tarea de **Sanidad** usa la **misma** regla (una sola fuente), y funciona
  offline en el móvil.
- ✅ Cancelar en web → el móvil la recibe por server-origin.
- ✅ Desde la agenda (web «Atención hoy» / móvil «Hoy») se completa una tarea de Sanidad.
- ✅ Idempotencia / exactly-once en todos los caminos; sin reglas de dominio duplicadas.

## 6. Métricas finales

| Gate | Resultado |
|---|---|
| Vitest (`audit:arch`) | **256 tests** en verde (TaskService 13, TaskSyncHandler 8, + resto) |
| Ciclos de dependencia (madge) | **0** (arista `health→tasks` limpia) |
| E2E de API | `task-device-e2e` (device↔device) + `task-crosschannel-e2e` (web↔móvil); regresión P5 verde |
| Playwright E2E (web) | `09-tareas` (crear/completar/cancelar) + `10-agenda-tarea` (completar desde la agenda) |
| Typechecks | API, móvil, web, sync-core, domain, design-tokens limpios |
| Architecture gates | invariantes intactos |

## 7. Decisiones diferidas y trabajo futuro

Diferidas de forma consciente (no son deuda oculta):

- **Asignación multiusuario / roles operativos** (`assigned_to`, invitaciones, «mis tareas»):
  requiere un vertical propio de miembros y permisos.
- **Cancelar / editar desde el móvil**: hoy el handler no acepta `canceled` ni edición de
  campos del device; sería una extensión chica del handler con su consumidor.
- **`in_progress`**, recurrencia, subtareas y dependencias entre tareas.
- **Deep-link agenda → captura preseleccionada**: la agenda navega/completa; abrir la captura
  del animal ya elegido queda para una ola posterior.
- **Tareas generales dentro de `/agenda`**: hoy la agenda solo emite tareas de Sanidad.
- **Calendario avanzado** (mensual, drag-and-drop) y **notificaciones push**.

## 8. Estado del roadmap

**P6 → COMPLETO.** Las tareas de finca (crear/completar/cancelar) y la agenda accionable
están terminadas, verificadas y estables en `main`, con una única fuente de reglas por
dominio, convergencia web↔móvil y offline-first en el móvil.

**Siguiente fase: por definir.** Mismo método: análisis previo aprobado antes de código, olas
pequeñas y revisables, verificación completa y un commit por ola.
