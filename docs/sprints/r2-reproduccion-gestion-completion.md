# Reproducción — gestión / índices (R-1 + R-2) · Cierre de sprint

**Estado:** ✅ COMPLETO · **Rama:** `main`
**Alcance:** completar el dominio reproductivo más allá de la captura — **estado del rodeo** por
vientre, y **protocolos IATF** (plantillas, asignación a un lote y calendario previsto que genera
tareas), respetando la separación snapshot (repro) vs período (reports) fijada en P9.

> Registro histórico del sprint. Cierres previos: [`p8-produccion-gdp-completion.md`](./p8-produccion-gdp-completion.md),
> [`p9-reportes-completion.md`](./p9-reportes-completion.md).

---

## 1. Objetivo

Tras P5 (captura de reproducción) y P9-1 (índices reproductivos del período en Reportes), faltaba
la **gestión**: ver el estado reproductivo de cada vientre de un vistazo, y trabajar con
**protocolos de sincronización (IATF)** — cuya tabla `repro_protocols` existía pero estaba
**dormida** (sin endpoints ni UI). Este vertical activa esa gestión.

## 2. Alcance implementado

- **R-1 — Estado del rodeo:** `GET /reproduction/herd-status` + sección web en `/reproduccion`.
  Cada vientre activo con su estado: **preñada / servida / vacía / sin actividad**.
- **R-2.a — Plantillas de protocolo (CRUD):** `repro_protocols` activada — crear/editar/archivar
  plantillas con pasos temporizados; página `/reproduccion/protocolos`. Incluye un **fix de RLS**.
- **R-2.b.1 — Asignación + tareas (backend):** `repro_protocol_assignments` + asignar a un lote →
  genera una tarea por paso (vía `TaskService`, P6) → sincronizan y aparecen en la agenda; cancelar.
- **R-2.b.2 — Web de asignación + calendario previsto:** formulario de asignación, asignaciones
  activas con cancelación, y calendario previsto client-side. Desbloqueo: `POST /lots`.

## 3. Decisiones arquitectónicas importantes

- **Snapshot vs período (continuidad de P9):** el estado del rodeo es **snapshot a-fecha** → vive
  en `repro`, no en `reports`. El `% vientres preñados` sigue siendo propiedad de `repro.kpis`.
- **Taxonomía de estado (R-1), orden estricto:** preñada (preñez `open`) > servida (último
  servicio posterior al último diagnóstico negativo) > vacía (último negativo) > sin actividad. Una
  preñez perdida escribe `pregnancy_negative` → vacía; re-servicio → servida.
- **Pasos como regla de dominio (R-2.a):** `validateProtocolSteps` en `@cowinance/domain` (gate
  Vitest); los pasos viven como `jsonb` en la plantilla.
- **Fix de RLS (R-2.a):** `repro_protocols` tenía RLS habilitada con una policy dispersa sobre
  `app.current_tenant` (que la app nunca setea → denegaría en prod) y no estaba en `RLS_TABLES`. Se
  agregó a `RLS_TABLES` (policy estándar `app.tenant_id`) y se dropeó la dispersa. Guardias `.mjs`
  bajo rol no-super confirman el aislamiento (protocolos y asignaciones).
- **Asignación → tareas vía P6 (R-2.b.1):** una tarea **por paso a nivel grupo** (no por
  animal×paso), `type='breeding'`, `related_type='protocol_assignment'`, `due_date = start + day`,
  generadas atómicamente en `db.tx` por `TaskService` (server-authored). `repro→tasks` acíclico.
- **Calendario previsto, no historial (R-2.b.2):** la asignación guarda solo `protocol_id` (no
  snapshotea pasos) → el calendario proyecta la **plantilla actual**. Se etiqueta «Calendario
  previsto» y se documenta; el snapshot/versionado de protocolos es trabajo futuro, no se abrió acá.
- **Fechas sin drift de timezone:** helper puro con aritmética/format en UTC.

## 4. Criterios de aceptación cumplidos

- El roster resuelve los 4 estados correctamente (incl. preñez perdida → vacía → re-servicio) y
  excluye no-vientres; filtrable por lote.
- Las plantillas se crean/editan/archivan con validación de dominio; RLS aislada bajo rol no-super.
- Asignar genera una tarea por paso con `due_date` correcto y `animal_count` snapshot; cancelar
  cancela la asignación y sus tareas pendientes.
- La web asigna, muestra asignaciones activas y un calendario previsto correcto (fechas/orden), y
  cancela; estados vacíos y accesibilidad cubiertos.

## 5. Métricas finales

| Métrica | Valor |
|---|---|
| Vitest (`audit:arch`) | **402 tests** (dominio de pasos, herd-status, protocolos CRUD, asignaciones, calendario puro) |
| Ciclos de dependencia (madge) | **0** (`repro→tasks` acíclico) |
| Guardias RLS `.mjs` (rol no-super) | `repro-protocols` 5/5 · `repro-assignments` 5/5 |
| Playwright E2E (web) | `16-reproduccion-rodeo`, `17-protocolos`, `18-protocol-assignments` |
| Gate de Vitest | ahora incluye helpers puros `.ts` de `apps/web` |

## 6. Decisiones diferidas y trabajo futuro

- **Snapshot/versionado de protocolos**: para que el calendario sea historial inmutable aunque se
  edite la plantilla (hoy es «previsto» sobre la plantilla actual).
- **Asignación por animal** (seguimiento individual) en vez de por grupo.
- **Editar/reasignar** asignaciones; calendario mensual; drag-and-drop.
- **Estado por-animal en la ficha** más rico (hoy la ficha muestra la preñez abierta).
- **Lot CRUD completo** (hoy solo `POST /lots` mínimo + `GET`).

## 7. Estado del roadmap

**Reproducción (gestión/índices + protocolos) → COMPLETO.** El estado del rodeo y los protocolos
IATF (plantillas → asignación → tareas → calendario) están terminados, verificados y estables en
`main`, sin duplicar reglas ni acoplar módulos de más.

**Siguiente fase: próximo vertical, por definir** (candidato pendiente de Fase 1: Facturación SaaS).
Mismo método: análisis previo aprobado antes de código, olas pequeñas y revisables, verificación
completa y un commit por ola.
