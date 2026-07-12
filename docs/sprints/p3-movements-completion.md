# P3 — Movimientos de hacienda entre lotes y potreros · Cierre de sprint

**Estado:** ✅ COMPLETO · **Rama:** `main` · **Commit de cierre funcional:** `f4c4b99`
**Alcance:** mover animales entre lotes/potreros, end-to-end, en los tres canales (mapa, sync/móvil, REST/web) con una única regla de dominio, invariante de coherencia y convergencia device↔device.

> Registro histórico del sprint. La documentación funcional de sincronización vive en
> [`docs/adr/0016-server-origin-changesets.md`](../adr/0016-server-origin-changesets.md);
> el cierre de P2 en [`docs/sprints/p2-import-completion.md`](./p2-import-completion.md).

---

## 1. Objetivo

Cubrir el hueco de mayor frecuencia del **loop diario** que quedaba tras P2: mover hacienda entre lotes y potreros, tanto desde la **oficina (web)** como en el **campo (móvil, offline)**, con el estado convergiendo entre todos los dispositivos. P3 se eligió por su alto valor operativo, su seam ya existente (`animal_movements`, `moveLot`, campos sincronizables) y por ser un vertical acotado sin abrir una fase técnica transversal.

## 2. Alcance implementado

- **Regla de dominio única** para registrar un movimiento de 1..N animales, reutilizada por todos los canales.
- **Invariante lote–potrero duro**: si un animal tiene lote, su potrero es el del lote; las incoherencias se rechazan (no se “arreglan” con warnings).
- **Tres canales**: movimiento de **lote completo** desde el mapa (refactor de `moveLot`), movimiento **entrante por sync** (captura móvil offline), y **REST** individual/grupal (`POST /movements`).
- **Propagación** a dispositivos por changeset server-origin; **idempotencia** por `movementId`.
- **UI web**: mover desde la ficha (individual) y desde la lista con **selección múltiple** (grupal).
- **Móvil**: catálogo de lotes offline + captura **«Mover»** 100% offline; convergencia del campo tras sincronizar.

## 3. Arquitectura final

```
  Web (ficha / lista)          Mapa (mover lote)          Móvil (captura «Mover», offline)
        │ POST /movements             │ moveLot                    │ event op animal_movements (event-only)
        ▼                             ▼                            ▼  push
                    land/MovementService.recordMovement(q, …)  ◄── MovementSyncHandler (sync entrante)
                    (regla ÚNICA, una tx)
                       │ current_lot_id/paddock (LWW, sync_row_state)
                       │ + 1 animal_movements (hecho)
                       │ + 1 evento 'movement' (timeline)
                       └─ emitServerOrigin → 1 changeset server-origin (put de campos)
                                              │ pull (IS DISTINCT FROM device)
                                              ▼
                              todos los devices convergen current_lot_id/current_paddock_id
```

- **`MovementService.recordMovement`** (en `land`): escritura ÚNICA. Set-based, idempotente por `movementId` (+ índice único parcial `(tenant, movement_id, animal_id)`), diff-aware. `resolveDestination` (pura) es la fuente del invariante.
- **Mapa** (`land.moveLot`): refactor a delegar en `recordMovement` en **una** tx con `SELECT … FOR UPDATE` del lote; ahora **propaga** por server-origin (antes no lo hacía) y es atómico.
- **Sync entrante** (`MovementSyncHandler`, en `land`): la intención viaja como **un `event` op** de `animal_movements`; el handler la pasa a `recordMovement(origin='sync')`. Rechazo de dominio → `SyncConflict`, sin aplicar ni abortar el changeset.
- **REST** (`POST /movements`): adaptador delgado (`LandService.moveAnimals`) → `recordMovement(origin='web')`; intención por presencia de clave (asignar/limpiar/sin-cambio).
- **Móvil**: `/sync/bootstrap` transporta el catálogo de lotes; `sync.lots()` lo expone offline; `sync.captureMovement` emite el `event` op; el nombre del lote se resuelve del catálogo por `current_lot_id`.

## 4. Decisiones arquitectónicas importantes

| Decisión | Motivo |
|---|---|
| **Regla única en `land`** | `land` ya poseía `animal_movements` y `moveLot`; reutiliza la infra de sync (`SyncVersionStore`/`ServerOriginChangesetWriter`) sin crear ciclo herd↔land. |
| **Invariante lote–potrero DURO** | Un estado “animal en lote X pero potrero B” corrompería mapas/reportes/carga; las incoherencias se rechazan con `movement.lot_paddock_mismatch`, sin persistencia parcial. Matriz de transiciones documentada en el servicio. |
| **Idempotencia por `movementId`** | Reintentos (REST, reproceso de changeset) no duplican hecho/evento/changeset; diff-aware cubre el reintento secuencial idéntico. |
| **Movimiento por sync ATÓMICO: event-only + server-origin** | El coordinador aplica todas las ops de un changeset aunque una devuelva conflicto → un `put` compañero quedaría aplicado sin hecho. Colapsar la intención a **una** op (event) y converger por server-origin lo hace atómico por construcción (reconciliación del `emitServerOrigin=false` inicial de M-1.c, justificada por ese hallazgo). |
| **Tripartición por presencia de clave** (`lot`/`paddock`: ausente/`null`/uuid) | Distingue sin-cambio / limpiar / asignar sin ambigüedad de `undefined` en JSON y en el `event` op. |
| **UI web solo-lote** (asignar + sacar del lote) | La web nunca envía la combinación incoherente lote+potrero → el invariante se honra **por construcción** en el cliente; el backend lo defiende igual. |
| **Móvil accept-lag** | Por la atomicidad (sin `put` sincronizado del cliente), el lote local del emisor converge tras el sync; la captura confirma con contador de sesión + pendientes. Sin optimismo local ni cambios en sync-core. |
| **Nombre de lote desde el catálogo** | El `put` actualiza `current_lot_id` pero no el `lot_name` denormalizado; el móvil resuelve el nombre por `sync.lots()` para no mostrar valores obsoletos. |

## 5. Criterios de aceptación cumplidos

- ✅ Mover 1..N animales a un lote y/o potrero, con el potrero **derivado** del lote.
- ✅ Incoherencia lote–potrero **rechazada** (400 / conflicto), sin escritura parcial.
- ✅ Mover un lote completo desde el mapa reutiliza la **misma** regla y ahora propaga.
- ✅ Mover offline desde el móvil; al sincronizar, servidor y dispositivos convergen, **sin conflictos**.
- ✅ Web: individual (ficha) y grupal (lista con selección múltiple).
- ✅ Idempotencia (reintento / reproceso) sin duplicar hecho, timeline ni changeset.
- ✅ Círculo canónico device↔device verificado end-to-end.

## 6. Métricas finales

| Gate | Resultado |
|---|---|
| Vitest (`audit:arch`) | **209 tests** en verde |
| Ciclos de dependencia (madge) | **0** |
| E2E de API | **9/9** (auth · animals · sync · server-origin · import · move · move-sync · move-rest · move-device) |
| Playwright E2E (web) | **7/7** (incl. `07-move-animals`) |
| Simulación Sync (`sync-core`) | **2000/2000 (100%)** |
| Typechecks | API y móvil limpios |
| Architecture gates | invariantes intactos |

## 7. Decisiones diferidas y trabajo futuro

Diferidas de forma consciente (no son deuda oculta):

- **Selección múltiple (grupal) en el móvil**: la captura móvil es un-animal-por-vez (paridad con las demás capturas); la web ya cubre el grupal.
- **Optimismo local en el móvil**: hoy es accept-lag (el lote converge al sincronizar). Un *overlay* de la cola de pendientes daría feedback inmediato sin romper la atomicidad; queda como refinamiento.
- **Asignación directa de potrero en la web**: la UI ofrece solo asignar-a-lote / sacar-del-lote (invariante por construcción); mover un animal sin lote a un potrero directo es un caso borde no expuesto.
- **Frescura del catálogo lote→potrero en el device**: el catálogo de lotes llega en el bootstrap; si un lote cambia de potrero en el servidor después, el device no re-sincroniza el catálogo salvo re-bootstrap. Aceptable hoy; a futuro, propagar cambios de lotes por sync.
- **Export/analítica de movimientos**: `reports/herd-movements` ya agrega los hechos; un reporte/histórico dedicado queda fuera de P3.

## 8. Estado del roadmap

**P3 → COMPLETO.** El movimiento de hacienda está terminado, verificado y estable en `main`, con una regla única, invariante duro, atomicidad por sync y convergencia device↔device.

**Siguiente fase: P4 (por definir).** No se inicia implementación nueva hasta acordar el alcance. Candidatos alineados con el loop diario: **agenda diaria + alertas en móvil** (“qué hay que hacer hoy”, el runner-up natural de P3), o el siguiente módulo del hato. La entrada a P4 seguirá el mismo método: análisis previo aprobado antes de código, olas pequeñas y revisables, verificación completa y un commit por ola.
