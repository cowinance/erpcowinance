# P5 — Paridad de captura móvil (mortalidad · destete · nota) · Cierre de sprint

**Estado:** ✅ COMPLETO · **Rama:** `main`
**Alcance:** cerrar el último hueco «el operario de campo no puede hacer X» del núcleo de
captura: **mortalidad**, **destete** y **nota** existían en la API y en la web pero **no** en
el móvil. P5 los lleva al móvil (offline-first), con la regla de dominio en un solo lugar.

> Registro histórico del sprint. Cierres previos: [`p2-import-completion.md`](./p2-import-completion.md),
> [`p3-movements-completion.md`](./p3-movements-completion.md), [`p4-agenda-completion.md`](./p4-agenda-completion.md).

---

## 1. Objetivo

Tras P4 (agenda), el operario de **campo** todavía no podía registrar desde el móvil tres
eventos rutinarios del ciclo diario: la **baja por muerte** (crítica — obligaba a volver a la
oficina), el **destete** y una **nota/observación** libre. Los tres ya existían en la API
(`POST /mortalities`, `POST /weanings`, `POST /animals/:id/events`) y en la web. P5 cierra la
**paridad de captura** sin duplicar reglas de negocio.

## 2. Alcance implementado

- **Backend — operaciones neutrales + canales de sync entrantes:**
  - `MortalityService.recordMortality` (núcleo neutral, patrón P3 `MovementService`) reusado
    por REST (`POST /mortalities`, adaptador delgado) y por `MortalitySyncHandler` (event-only).
  - `WeaningService.recordWeaning` (núcleo neutral, fact-only + pesaje atómico) reusado por
    REST (`POST /weanings`) y por `WeaningSyncHandler` (event-only).
  - La **nota** reutiliza el `AnimalEventSyncHandler` existente — sin backend nuevo.
- **Móvil — emit offline:** `captureMortality` / `captureWeaning` / `captureNote` en
  `SyncContext`, cada uno apoyado en un **builder puro** específico (`capture-builders.ts`)
  reusado por la closure real y cubierto por unit tests.
- **Móvil — pantallas:** «Destete» y «Nota» como ramas del formulario genérico `[tipo].tsx`;
  «Baja» como **pantalla dedicada** (`captura/mortalidad.tsx`) con confirmación destructiva.
  Tres entradas nuevas en el menú de captura.

## 3. Arquitectura final

```
  Captura de campo (móvil, offline)        REST/web (server-authored)
        │  event op (Patrón B)                    │
        ▼                                          ▼
  ┌───────────────────────────  REGLA ÚNICA POR DOMINIO  ───────────────────────────┐
  │  MortalityService.recordMortality(q, …)     WeaningService.recordWeaning(q, …)   │
  │  · fila mortalities (id = intención)         · fila weanings (id = intención)     │
  │  · status='dead' + status_changed_at         · pesaje asociado (id determinista)  │
  │  · versión LWW de status                     · evento weaning de timeline         │
  │  · evento death de timeline                  · (fact-only: sin campo autoritativo)│
  │  · changeset SERVER-ORIGIN {status:'dead'}   · (sin server-origin)                │
  └────────────────────────────────────────────────────────────────────────────────┘
        │ pull                                     │ pull
        ▼                                          ▼
  Mortalidad → converge status='dead' en          Destete → hecho + pesaje materializados
  A (emisor) y B por server-origin (accept-lag)   server-side; sin convergencia de campo

  Nota → animal_events event_type='note': converge por el CANAL CRDT NORMAL
         (el event op viaja en el changeset de device y el pull de B lo entrega).
```

**Patrón B (event-only)** — mortalidad y destete: el móvil emite SOLO el event op de
dominio; el servidor autora hecho + timeline (+ server-origin en mortalidad). Nunca un `put`
de campo suelto → la intención es indivisible: si se rechaza, no queda estado sin hecho.

## 4. Decisiones arquitectónicas importantes

| Decisión | Motivo |
|---|---|
| **Mortalidad = intención atómica event-only** | El coordinador de sync sigue aplicando ops tras un conflicto; un `put status='dead'` compañero podría aplicarse aunque el evento se rechace. Event-only + operación autoritativa lo hace indivisible (patrón P3). |
| **Operación neutral única por dominio** (`MortalityService`/`WeaningService`) | Regla de negocio en un solo lugar (regla permanente 1); REST y Sync son adaptadores, sin ramificar por canal. |
| **REST también emite server-origin (mortalidad)** | Cierra una brecha latente: una baja creada en la web ahora converge `status='dead'` al móvil (simetría con P3). |
| **Peso del destete pertenece al destete** | El pesaje opcional se materializa en la MISMA tx, con identidad determinista derivada del `weaningId` (`ON CONFLICT DO NOTHING`) → reproceso no duplica destete/pesaje/timeline. No se separa en una captura genérica. |
| **Destete fact-only (sin server-origin)** | No modifica ningún campo autoritativo del animal → no se agregan `put`s innecesarios. |
| **Nota reusa `AnimalEventSyncHandler`** | La nota ES un `animal_events`; no hay tabla de dominio ni ruta nueva. Converge por CRDT normal (es el timeline), no por server-origin. |
| **Idempotencia por `rowId` de la intención** | `mortalities.id`/`weanings.id`/`animal_events.id` = op id del device; `mortalities.animal_id` UNIQUE refuerza «una muerte por animal». Exactly-once ante reproceso. |
| **Builders puros del emit (móvil)** | Único seam unit-testeable del emit real del móvil; fija el invariante Patrón B (cero `animal_events` compañero en mortalidad/destete; nota = un único `animal_events`). |
| **Baja: pantalla dedicada + confirmación destructiva** | Acción terminal (`status='dead`); `Alert.alert` con la caravana evita bajas por error y no infla la complejidad del formulario genérico. |
| **Anti-duplicado de sesión (móvil, solo UX)** | El animal sigue activo local hasta el server-origin; un `Set` de sesión evita re-baja accidental. No es un put optimista — el servidor mantiene idempotencia/conflicto como autoridad. |
| **`vitest.config` incluye lógica PURA del móvil** | Los builders (sin React/Expo) se testean en el runner node; los componentes RN siguen fuera. |

## 5. Criterios de aceptación cumplidos

- ✅ Desde el móvil **offline**, registrar una **baja por muerte** → al sincronizar el animal
  queda `status='dead'`, con su registro de mortalidad y evento de timeline, sin conflictos;
  converge a todos los dispositivos (incl. el emisor) por server-origin.
- ✅ Desde el móvil offline, registrar un **destete** (con peso opcional) → propaga el hecho +
  pesaje determinista + timeline, atómico e idempotente.
- ✅ Desde el móvil, agregar una **nota** → aparece en el timeline local de inmediato y
  converge a los demás dispositivos por CRDT.
- ✅ Paridad con API/web: los tres eventos coinciden con lo que la web ya producía (una sola
  fuente de reglas por dominio).
- ✅ Reprocesar cualquier captura es **exactly-once** (sin duplicar hecho, pesaje, timeline ni
  changeset).

## 6. Métricas finales

| Gate | Resultado |
|---|---|
| Vitest (`audit:arch`) | **235 tests** en verde (incl. `MortalityService`, `MortalitySyncHandler`, `WeaningService`, `WeaningSyncHandler`, `capture-builders`) |
| Ciclos de dependencia (madge) | **0** |
| E2E de API (device↔device) | `mortality-device-e2e`, `weaning-device-e2e`, `note-device-e2e` verdes; regresión `move-device-e2e` verde |
| Typechecks | API, móvil, sync-core, domain, design-tokens limpios |
| Architecture gates | invariantes intactos |

## 7. Decisiones diferidas y trabajo futuro

Diferidas de forma consciente (no son deuda oculta):

- **Datos administrativos de mortalidad en móvil** (`necropsy`, `estimated_loss`,
  `cause_diagnosis`): quedan en la web (oficina); el móvil captura lo esencial de campo.
- **Timeline local inmediato de mortalidad/destete**: por Patrón B el `death`/`weaning` los
  autora el servidor y no está local hasta re-bootstrap; el estado (`status='dead'`) sí
  converge. Se comunica por accept-lag. Una proyección local es trabajo futuro.
- **Deep-link a captura preseleccionada** (desde la agenda): sigue diferido de P4.
- **Notificaciones push** y **tareas/calendario general**: candidatos de un sprint posterior.

## 8. Estado del roadmap

**P5 → COMPLETO.** La paridad de captura de campo (mortalidad, destete y nota) está
terminada, verificada y estable en `main`, con la regla de dominio en un solo lugar por
canal y convergencia offline-first (event-only + server-origin donde corresponde).

**Siguiente fase: por definir.** Se seguirá el mismo método: análisis previo aprobado antes
de código, olas pequeñas y revisables, verificación completa y un commit por ola.
