# P4 — Agenda diaria + alertas en móvil · Cierre de sprint

**Estado:** ✅ COMPLETO · **Rama:** `main` · **Commit de cierre funcional:** `31c0ce6`
**Alcance:** una agenda diaria accionable, alimentada por el motor de alertas, disponible en el **móvil** (offline) y consolidada en la **web**, desde una única fuente.

> Registro histórico del sprint. Cierres previos: [`p2-import-completion.md`](./p2-import-completion.md),
> [`p3-movements-completion.md`](./p3-movements-completion.md).

---

## 1. Objetivo

Cerrar la brecha del loop diario detectada en P3: el operario de **campo** (móvil) no veía “qué hay que hacer hoy” — retiros que vencen, vacunas del día, preñeces a revisar, partos próximos vivían solo en la web. P4 lleva esa agenda al móvil (offline-first) y la unifica con la web, sin duplicar reglas de negocio.

## 2. Alcance implementado

- **Endpoint `/agenda`** (fuente única): estructura los hechos accionables del hato desde el motor de alertas.
- **Móvil offline (cache-on-sync)**: el snapshot de agenda se descarga en cada sync y se cachea; usable sin señal.
- **Superficie «Hoy» en el móvil**: agenda agrupada por urgencia, con acción directa (deep-link a la ficha).
- **Consolidación web**: la Card «Atención hoy» del dashboard consume el mismo `/agenda`, con paridad de presentación.

## 3. Arquitectura final

```
  AlertsService.computeDesired()   ← FUENTE ÚNICA de reglas (retiros/vacunas/tareas/partos/preñeces)
        │
        ├─ evaluate(desired)   → tabla alerts (inbox web, ciclo ack/resolve) — sin cambios
        └─ agenda()            → GET /agenda (estructurado: due_at + acción + animal)
                                   │
                 ┌─────────────────┴───────────────────┐
                 ▼                                       ▼
   Móvil: cache-on-sync (PersistedMeta)        Web: home «Atención hoy»
   sync.agenda() offline → sección «Hoy»        (server-fetch, AgendaAttention)
        │ deep-link                                   │ Link
        ▼                                             ▼
   /animal/[id]                                  /animales/:id
```

- **`computeDesired()`** se extendió (aditivo) con `due_at`/`tag`; `evaluate()` los ignora → alertas intactas. `evaluate(precomputed?)` acepta los hechos ya calculados para un solo cómputo.
- **`agenda()`** computa `computeDesired` una vez, hace read-through de `evaluate` (mantiene el badge fresco, como `kpis`), **filtra** a categorías de campo (`health` + `reproduction`), mapea a una **acción semántica** y ordena por vencimiento + severidad.
- **`GET /agenda`** vía `AgendaController` (path limpio; la lógica queda en el módulo `alerts`).
- **Móvil**: en cada `syncNow` exitoso se hace `authFetch('/agenda')` **best-effort** y se cachea en `PersistedMeta` (`agenda`/`agendaAt`); offline nunca se pisa el cache. `sync.agenda()` lo lee. **Canal CRDT intacto** (la agenda es dato volátil server-derived).
- **Acción semántica** (`vaccinate`/`review_pregnancy`/`view_animal`/`complete_task`): cada superficie la mapea a su ruta (`/animal/[id]` móvil, `/animales/:id` web).

## 4. Decisiones arquitectónicas importantes

| Decisión | Motivo |
|---|---|
| **`/agenda` reusa `computeDesired()`** | Una sola fuente de reglas (regla permanente 1); el endpoint solo estructura los hechos, no reimplementa lógica ni toca el esquema `alerts`. |
| **Read-through con un solo cómputo** (`evaluate(desired)`) | La agenda mantiene la tabla `alerts`/badge frescos (como `kpis`) sin recomputar los hechos. |
| **Excluir ítems de sistema** (sync stale / conflictos) | La agenda es de acciones del hato; los ítems de sistema viven en la pantalla de sincronización. |
| **Móvil cache-on-sync, no CRDT** | La agenda es volátil y server-derived; meterla en el store LWW forzaría changesets por cada recomputo. Un snapshot cacheado encaja con offline-first. |
| **Best-effort en el fetch de agenda** | El sync (push/pull) ya fue exitoso; si el fetch de agenda falla, se conserva el último snapshot y no se degrada el resultado del sync. |
| **Agenda de solo-lectura + deep-link** | La acción se ejecuta yendo a la captura/ficha (ya offline); evita una cola de escritura sobre un recurso server-derivado (ack/resolve). |
| **Acción semántica, no ruta** | El endpoint devuelve la intención; cada superficie decide su navegación (móvil/web), sin acoplar el server a rutas de cliente. |
| **El inbox `/alertas` no cambia** | Es un concern distinto (lista con ciclo ack/resolve/dismiss); `/agenda` alimenta la agenda accionable de solo-lectura. |

## 5. Criterios de aceptación cumplidos

- ✅ Un endpoint devuelve la agenda estructurada (severidad, vencimiento, animal, acción), derivada de los mismos hechos que las alertas, sin duplicar reglas.
- ✅ El móvil muestra la agenda **online y offline** (tras un sync, sin señal sigue el último snapshot; “actualizado hace X”).
- ✅ Cada ítem accionable de animal **navega** a la ficha (deep-link).
- ✅ La web muestra la misma agenda (paridad), consumiendo el mismo endpoint.
- ✅ Sin reglas de dominio duplicadas (una sola fuente en `alerts`/`computeDesired`).

## 6. Métricas finales

| Gate | Resultado |
|---|---|
| Vitest (`audit:arch`) | **211 tests** en verde |
| Ciclos de dependencia (madge) | **0** |
| E2E de API | verde, incl. **`agenda-e2e`** (forma + orden + sin sistema) |
| Playwright E2E (web) | **8/8** (incl. `08-agenda`) |
| Simulación Sync (`sync-core`) | **2000/2000 (100%)** |
| Typechecks | API y móvil limpios |
| Architecture gates | invariantes intactos |

## 7. Decisiones diferidas y trabajo futuro

Diferidas de forma consciente (no son deuda oculta):

- **Ack/resolver desde el móvil**: hoy la agenda es de solo-lectura; hacerlo offline requeriría una cola de escritura sobre un recurso server-derivado.
- **Deep-link a captura preseleccionada**: tocar “vacunar” podría abrir `/captura/vacunar` con el animal ya elegido (requiere que las capturas acepten un `animal` param).
- **Agenda fechada por día/semana** y notificaciones (push/email/SMS): la agenda actual es un snapshot “hoy”; una agenda-calendario y avisos proactivos quedan fuera.
- **Tareas/calendario general**: el placeholder `modulo/tareas` sigue pendiente; la agenda cubre lo accionable derivado de reglas, no un gestor de tareas.
- **Frescura del snapshot móvil**: se refresca en cada sync; offline puede quedar viejo (se muestra la antigüedad).

## 8. Estado del roadmap

**P4 → COMPLETO.** La agenda diaria accionable está terminada, verificada y estable en `main`, con una única fuente de reglas y paridad web↔móvil (móvil offline).

**Siguiente fase: P5 (por definir).** No se inicia implementación nueva hasta acordar el alcance. La entrada a P5 seguirá el mismo método: análisis previo aprobado antes de código, olas pequeñas y revisables, verificación completa y un commit por ola.
