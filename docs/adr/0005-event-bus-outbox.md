# 0005 — Event Bus interno + Outbox para eventos de dominio

- **Estado:** aceptado
- **Fecha:** Foundation Hardening Sprint, Fase 5 (F5)
- **Contexto relacionado:** [[0004-domain-package]] (dominio puro); [[0007-server-authority-derived-values]] (el servidor es la fuente de verdad); [[0008-sync-handler-ownership]] (infra compartida vía módulo `@Global`); `docs/sprints/foundation-hardening-sprint.md` §F5

## Contexto

Hoy los efectos secundarios de un cambio de dominio (alertas, línea de tiempo del animal) están
**acoplados a los writes**: quien escribe un tratamiento también dispara, en el mismo lugar, la
inserción del evento de timeline y (en otro flujo) la evaluación de alertas. Para crecer hacia un
ERP con reproducción avanzada, genética, IoT e IA, necesitamos que "algo pasó en el dominio" se
**publique** una vez y que los interesados reaccionen **desacoplados** del write que lo originó —
sin que cada nuevo consumidor obligue a editar el código que escribe.

Cowinance es offline-first y el servidor es la fuente de verdad (ADR-0007): un evento de dominio
solo es válido si el cambio que lo originó **realmente se persistió**. Emitir "a mano" después de
escribir (publish-then-maybe-rollback) produciría **eventos fantasma** (se emite y la transacción
se revierte) o **eventos perdidos** (se escribe y el proceso muere antes de emitir). Eso es
inaceptable para un ERP.

## Decisión

Instalar la **fundación** de un Event Bus interno con patrón **Transactional Outbox**. F5 es
fundación, no migración: se cablea el mecanismo y se emite **un** evento real (`TreatmentApplied`)
con un suscriptor trivial de logging; los consumidores reales (alertas, timeline) se migran en un
sprint posterior.

### Objetivo del Event Bus interno

Desacoplar la **publicación** de un hecho de dominio de sus **reacciones**. Quien escribe declara
"pasó esto" una sola vez; los suscriptores reaccionan sin que el emisor los conozca. El transporte
(hoy EventEmitter2 in-process) queda detrás de un puerto, reemplazable por Kafka en el futuro sin
tocar dominio ni aplicación.

### Por qué Outbox Pattern

Es la única forma de garantizar **atomicidad entre el write de dominio y la emisión del evento**
sin un coordinador distribuido (2PC), que sería desproporcionado. La fila de outbox se escribe
**en la misma transacción** que el write; un relay la publica **después del commit**. Así:
- si la transacción se revierte, la fila de outbox también → **no hay evento fantasma**;
- si la transacción commitea, la fila existe y el relay la publicará (reintentando) → **no hay
  evento perdido**.

### Frontera transaccional

- El adaptador que implementa el puerto (`OutboxEventPublisher`) inserta la fila de outbox usando
  **el mismo handle transaccional** `q` del `requestContext` que ya usan `SyncConflictWriter` y
  `SyncVersionStore` — es decir, la transacción de la request (abierta por `AuthInterceptor`,
  reutilizada por `db.tx()`). El evento y el cambio de dominio son **una sola unidad atómica**.
- El **relay** corre **fuera** de esa transacción, después del commit: lee filas de outbox no
  publicadas (ya comprometidas), publica a EventEmitter2, y marca la fila como publicada. Nunca
  lee filas no comprometidas.

### Garantía de no emitir eventos fantasma

Un evento se publica **si y solo si** su write commiteó. Corolario directo del outbox transaccional
(arriba): el relay solo ve filas ya comprometidas; una transacción revertida no deja fila; por lo
tanto no existe ninguna ruta por la que un evento se publique sin que su cambio de dominio haya
persistido.

### Estrategia at-least-once

El relay marca una fila como publicada **después** de un emit exitoso. Si el proceso cae entre el
emit y la marca, la fila se re-emite al reiniciar → **at-least-once** (posibles duplicados, nunca
pérdida). **Los consumidores deben diseñarse idempotentes** (deduplicar por id de evento). Para F5
el único consumidor es el suscriptor de logging (trivialmente idempotente); la regla de idempotencia
queda documentada como requisito de diseño para todos los consumidores reales futuros. No se busca
exactly-once ni ordenamiento global en F5.

### Garantías del mecanismo (resumen explícito)

1. **Garantía principal — atomicidad operación de negocio ↔ registro del evento:** vía Outbox, la
   fila del evento se escribe en la misma transacción que el cambio de dominio. Se registran juntos
   o no se registra ninguno. Esta es la propiedad que el mecanismo protege por encima de todo.
2. **Entrega at-least-once:** una vez registrado (comprometido) el evento, el relay lo entrega al
   menos una vez; nunca lo pierde, puede duplicarlo.
3. **Consumidores idempotentes por diseño:** consecuencia directa de (2) — todo consumidor debe
   tolerar recibir el mismo evento más de una vez (deduplicar por id de evento).

### Evolución del relay

El relay de F5 es un **poller simple** (drena la outbox en intervalo). Se prioriza **simplicidad,
observabilidad, facilidad de prueba y bajo acoplamiento** por sobre la latencia — un pequeño retraso
de procesamiento es aceptable en esta fase. El relay **puede evolucionar** más adelante a mecanismos
más avanzados si la escala lo requiere (hook post-commit, `LISTEN/NOTIFY` de PostgreSQL, o un relay
dedicado con backpressure), **sin cambiar el puerto `EventPublisher` ni los emisores** — el contrato
de "publicá este evento" y la garantía de atomicidad no dependen de cómo drena el relay.

### Responsabilidades por capa

| Capa | Ubicación | Responsabilidad |
|---|---|---|
| **Dominio** | `packages/domain/src/events/` | **Contratos de evento** versionados (datos del hecho, p. ej. `TreatmentApplied`). Puros, sin comportamiento. Son vocabulario del lenguaje ubicuo. |
| **Aplicación** | `apps/api/src/application/ports/` | **Puerto `EventPublisher`** (interfaz de salida: `publish(event)`). Los servicios de aplicación dependen SOLO de este puerto. |
| **Infra** | `apps/api/src/infra/event-bus/` (`@Global`) | `OutboxEventPublisher` (adaptador: escribe la fila de outbox en la tx actual), tabla `outbox`, `OutboxRelay` (drena post-commit → EventEmitter2, marca publicado), módulo del bus, suscriptor de logging. |

**Por qué el puerto va en aplicación (api), no en el dominio puro** (decisión analizada antes de
este ADR): las funciones puras del dominio nunca publican eventos — son cálculos. Quien publica es
la capa de aplicación. Meter un puerto de orquestación de aplicación dentro de `packages/domain`
(que es dominio puro por ADR-0004) conflaría capas. No se crea un `packages/application` (sería
andamiaje pesado por una interfaz); la capa de aplicación de este monolito **es** `apps/api`, así
que el puerto vive en `apps/api/src/application/ports/`, una costura que nace con contenido real
(no vacía) y crecerá con futuros puertos (reloj, notificaciones).

**Cómo se evita acoplar los handlers/servicios al bus:** dependen del **puerto `EventPublisher`**,
nunca de EventEmitter2, del outbox ni del relay. El adaptador outbox-backed hace que `publish()`
sea, por debajo, un enqueue transaccional; el relay es el único que toca el transporte. Mismo
principio que mantuvo a los `SyncHandler` desacoplados de la persistencia de conflictos vía
`SyncConflictWriter`.

### Primer evento y punto de emisión (alcance mínimo)

`TreatmentApplied`, emitido desde **un solo** punto: el camino **REST** `health.service.treat()`.
Se elige REST por ser el más simple (sin strangler) y porque el tratamiento ya pasó por Server
Authority. **No** se hace dual-write desde `TreatmentSyncHandler` en F5 — se valida el patrón con
un emisor y luego se extiende sin mezclar responsabilidades.

## Consecuencias

- **Positivo:** desacople real de efectos; base para migrar alertas/timeline a consumidores post-F5
  sin tocar los writes; transporte reemplazable (Kafka) detrás del puerto; atomicidad write↔evento
  garantizada por el outbox.
- **Costo:** una tabla `outbox` (migración idempotente estilo `db.service.SYNC_MIGRATION`), un relay
  corriendo (poller simple en F5), y la disciplina de idempotencia en consumidores futuros.
- **Nueva costura `apps/api/src/application/ports/`:** primer puerto de aplicación explícito del
  codebase — establece la capa de aplicación como lugar de los puertos de salida.

## Qué queda fuera de F5 (explícito)

- **Migrar consumidores reales** (alertas, reportes, timeline) a escuchar eventos — siguen acoplados
  a los writes; se migran en un sprint posterior.
- **Dual-write** desde `TreatmentSyncHandler` u otros handlers de sync — solo el camino REST emite
  en F5.
- **Más de un evento** — solo `TreatmentApplied`. Los demás (`WeighingRecorded`,
  `PregnancyDiagnosed`, `AnimalRegistered`) se agregan cuando tengan consumidor real.
- **Kafka / cualquier transporte externo** — EventEmitter2 in-process detrás del puerto.
- **Exactly-once, ordenamiento global, event sourcing / replay** — F5 es at-least-once, sin garantías
  de orden.
- **Optimización del relay** (hook post-commit en vez de poller) — el poller alcanza para F5.
