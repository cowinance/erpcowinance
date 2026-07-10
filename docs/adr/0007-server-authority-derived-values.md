# 0007 — Server Authority sobre valores derivados de reglas de dominio

- **Estado:** aceptado
- **Fecha:** Foundation Hardening Sprint, Fase 4 (T4.4)
- **Contexto relacionado:** [[0006-value-object-strategy]]; Regla Permanente 8 (*"el servidor es la fuente de verdad"*); `docs/sprints/foundation-hardening-sprint.md` §T4.4

## Contexto

Cowinance es offline-first: el cliente móvil calcula localmente valores derivados de reglas de
dominio (`meat_withdrawal_until`, `milk_withdrawal_until` en `treatments`; `expected_due_date` en
`pregnancies`) porque el operario necesita esa información en el campo, sin señal. Hasta F4.1/F4.2,
el servidor de sincronización (`sync.service.ts`) **confiaba ciegamente** en esos valores al aplicar
el changeset — los persistía tal como llegaban, sin verificarlos.

Esto es un riesgo real, no teórico: versión móvil desactualizada con una fórmula vieja, reloj del
dispositivo incorrecto, un bug de cliente, o datos corruptos en tránsito pueden producir un
`meat_withdrawal_until` incorrecto — un campo de **inocuidad alimentaria**, no una preferencia
estética. La Regla Permanente 8 ya establecía la dirección ("el servidor es la fuente de verdad; en
el camino de sync recomputa con la función de dominio"), pero faltaba decidir el mecanismo concreto.

Se investigó el motor de sync (`packages/sync-core`) antes de diseñar: las operaciones de tipo
`event` (`treatments`, entre otras) son **inserts únicos e inmutables** (`ON CONFLICT (id) DO
NOTHING`) — sin merge, sin competencia de versiones. Las de tipo `put` (`pregnancies`) usan **LWW
por campo vía HLC** (`sync_row_state.versions`, comparado en `applyPut` de `sync-core`) — un campo
mutable, corregible más adelante por cualquier nodo con un HLC mayor.

## Decisión

**El servidor es la única autoridad sobre el valor final de un campo derivado por una regla de
dominio.** El cliente puede **proponer** ese valor (lo necesita para mostrarlo offline), pero el
servidor siempre lo recalcula con la función pura de `packages/domain` al aplicar el changeset. Si
difiere de lo propuesto por el cliente, el servidor **corrige y deja traza — sin tolerancia** (no
hay "diferencia aceptable" en una regla de dominio; a diferencia de VOs o inputs de usuario, estos
valores no representan una preferencia sino un cómputo).

### Mecanismo, según el tipo de operación

- **`event` (inmutable, ej. `treatments`):** el servidor ignora el valor entrante y siempre escribe
  el recalculado. No hay interacción con LWW — se calcula una vez, en el momento del insert.
- **`put` (mutable con LWW, ej. `pregnancies.expected_due_date`):** el servidor **participa del
  mismo mecanismo de HLC que los dispositivos**, no hace un `UPDATE` directo por fuera de él. Un
  `UPDATE` que no avance `sync_row_state.versions` dejaría la corrección vulnerable: un push
  posterior de cualquier dispositivo con un HLC más alto que el que originó el valor incorrecto la
  pisaría sin que nadie se entere, porque `applyPut` solo compara HLCs, no valores. El servidor
  obtiene su propio nodo HLC (`HlcClock('server', ...)`, la misma clase que ya usan los
  dispositivos) y, al corregir, escribe el valor **y** un tick HLC nuevo bajo el actor `server` —
  un participante más del sistema distribuido, no un caso especial por fuera de él. Esto hace que
  la corrección gane sobre el valor incorrecto que la originó, y **correctamente** pueda perder
  ante una escritura futura genuina del cliente (si el operario corrige el diagnóstico más
  adelante, esa escritura debe ganar — es el comportamiento LWW correcto, no una regresión).

### Auditoría

Se reutiliza `sync_conflicts` sin ampliar su `conflict_type` (`concurrent_update|duplicate|semantic`
hoy). La discrepancia se registra como **`conflict_type = 'semantic'`** (conceptualmente correcto:
el valor recibido no representa un estado válido según las reglas del dominio) con
**`resolution = 'server_wins'`** y `resolved_at` en el mismo insert — **no** es un conflicto que
espere revisión humana en el panel de flota, se resuelve solo. `detail` es texto libre con el valor
del cliente y el recalculado; no se agregan columnas estructuradas nuevas (`changeset_id` ya
vincula el changeset completo, `sync_devices.app_version` ya rastrea la versión del cliente).

**No se crea `recompute_mismatch` como categoría propia todavía** — mismo criterio que ADR-0006: no
se amplía un catálogo (VOs, errores, y ahora tipos de conflicto) hasta demostrar múltiples
consumidores reales. Hoy solo hay un caso (recompute de reglas de dominio). Si en el futuro
aparecen casos análogos (cálculos genéticos, índices productivos, predicciones IA, validaciones
automáticas — todos casos donde el servidor pasa a ser autoridad sobre un valor propuesto por un
cliente), recién ahí se evalúa una categoría de conflicto propia.

### Fuera de alcance de esta decisión

- **`category_code`** (de `newbornCategoryCode`, F4.3-A) tiene el mismo patrón de confianza ciega
  hoy, pero queda **fuera** de esta ronda. Prioridad de impacto: retiro sanitario (inocuidad
  alimentaria) > gestación (planificación reproductiva) > categoría (clasificación/productividad).
  Candidato para una futura iteración del mismo patrón, no se resuelve junto con esta decisión.
- **Migración histórica / recálculo retroactivo:** los `treatments`/`pregnancies` ya persistidos no
  se tocan. La autoridad del servidor aplica hacia adelante desde este cambio.
- **Nuevos tipos de conflicto**, Event Bus (F5), o cualquier mecanismo de alertas sobre
  discrepancias sistemáticas: no se construyen todavía sin evidencia de necesidad.

## Consecuencias

- **Positivo:** cierra el gap real entre la Regla Permanente 8 (declarada) y el comportamiento
  efectivo (el servidor confiaba ciegamente hasta ahora). Retrocompatible: mismo contrato de
  payload, un móvil desactualizado sigue funcionando — el servidor simplemente deja de confiar
  ciegamente en su cálculo. Sin migración de datos ni cambio de esquema.
- **Precedente para el futuro:** establece el patrón general — *"los clientes pueden proponer datos
  derivados, pero el servidor mantiene la autoridad sobre los valores calculados por reglas de
  dominio"* — reutilizable para cálculos genéticos, índices productivos o predicciones de IA, sin
  rediseñar el mecanismo de sync cada vez.
- **Costo:** `applyEvent` y `applyPregnancyPut` ganan una consulta adicional (producto veterinario;
  último servicio reproductivo) y, en `pregnancies`, un `HlcClock` propio del proceso servidor.
  Complejidad concentrada en dos funciones ya existentes, no en una capa nueva.
- **Explícitamente diferido:** `category_code`, cualquier campo derivado fuera de retiro/gestación,
  y la categoría de conflicto `recompute_mismatch` — se evalúan cuando (y si) aparece evidencia de
  necesidad real, mismo criterio que el resto del sprint.
