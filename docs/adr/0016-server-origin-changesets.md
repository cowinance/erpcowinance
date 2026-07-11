# 0016 — Changesets de origen servidor (propagación server-side sin dispositivo sintético)

- **Estado:** aceptado
- **Fecha:** P2 · Sprint 1 (importación de animales), oleada 2
- **Contexto relacionado:** [[0003-offline-first]] (changeset/HLC/pull), [[0007-server-authority-derived-values]] (actor HLC `server` legítimo), [[0008-sync-handler-ownership]] (el dominio posee la semántica de su tabla)

## Contexto

El pull entrega a cada dispositivo las filas de `sync_changesets` con `server_seq > cursor` y
`sync_device_id != $device`. Toda fila asume hoy un **dispositivo emisor**: `sync_device_id` y `seq`
son `NOT NULL`, con `UNIQUE (sync_device_id, seq)` (dedupe exactly-once por dispositivo) y FK a
`sync_devices`.

La migración de datos (P2) crea entidades **del lado del servidor**, sin dispositivo. Esas
creaciones deben **propagarse incrementalmente** a los dispositivos ya bootstrapeados —no se acepta
rehacer bootstrap— reutilizando el read model de pull tal cual, y **sin** sintetizar dispositivos,
**secuencias** ni requests del cliente, y sin fabricar conflictos HLC. El caso inmediato es el
importador de animales, pero el mecanismo aplica a cualquier productor server-side futuro
(correcciones masivas, integraciones).

## Decisión

Se introduce el **changeset de origen servidor** como concepto de primera clase del protocolo de
sincronización.

### Forma de la fila

`sync_changesets` gana dos columnas: `source ('device'|'server')` y `origin_ref`. Las dos formas
válidas quedan garantizadas por un `CHECK`, que además prohíbe estados híbridos:

- **`source='device'`** — `sync_device_id` y `seq` `NOT NULL`; `origin_ref` `NULL`. Sin cambios de
  comportamiento; `UNIQUE (sync_device_id, seq)` sigue rigiendo la dedupe por dispositivo.
- **`source='server'`** — `sync_device_id` y `seq` son **`NULL`**. No se inventa una secuencia de
  dispositivo: `seq` **no** representa un contador local, así que se deja explícitamente en `NULL` en
  vez de asignarle un valor ficticio (p. ej. un índice de chunk). La idempotencia depende
  **exclusivamente** de `origin_ref`, mediante un índice único **`(tenant_id, origin_ref)
  WHERE source='server'`** — con tenant, para que la unicidad sea por organización.

`UNIQUE (sync_device_id, seq)` no colisiona para filas server: en un índice único multicolumna,
cualquier columna `NULL` hace que la fila no compita, de modo que múltiples filas server
`(NULL, NULL)` coexisten y su unicidad la aporta `origin_ref`.

### Entrega por pull

El pull pasa de `sync_device_id != $device` a **`sync_device_id IS DISTINCT FROM $device`**: las
filas server (device `NULL`) se entregan a **todos** los dispositivos exactamente una vez (por el
avance del cursor `server_seq`). Para filas `device`, `!=` e `IS DISTINCT FROM` son equivalentes, así
que el cambio es aditivo y no altera el comportamiento existente.

**Contrato de pull:** para `source='server'`, `device_id` y `seq` viajan **nullable**. Los tipos del
borde de pull se ajustan (backend: DTO de pull con `device_id`/`seq` nullable; móvil: un tipo
`RemoteChangeset` con esos dos campos opcionales, distinto del `Changeset` autoría-dispositivo del
push). El merge del cliente no usa esos campos —opera sobre `ops` + `hlc` + `id`—, por lo que no se
toca la lógica de convergencia.

### HLC y ausencia de conflictos fabricados

Los valores de campo se versionan con ticks **genuinos** de `HlcClock('server')` (el mismo actor
legítimo de ADR-0007) en `sync_row_state`. Al tratarse de una **creación** sin escritura concurrente,
**no** se escribe ninguna fila en `sync_conflicts`. Una edición futura del operario con un HLC mayor
gana correctamente (LWW), que es el comportamiento deseado para una corrección en campo.

### Aplicación

El changeset de origen servidor nace con `status='applied'` y **solo lo lee el pull**; nunca entra al
camino de `push()`/handlers (la entidad ya la persistió el módulo dueño del dominio). Contiene
únicamente campos de la whitelist syncable de ese dominio.

## Migración del esquema existente

DDL idempotente en el bloque de migración: se agrega `source NOT NULL DEFAULT 'device'` (que
**rellena** las filas existentes) **antes** del `CHECK`, de modo que todas las filas actuales —todas
`device`— satisfacen la forma válida; el `CHECK` se instala con `DROP CONSTRAINT IF EXISTS` + `ADD`
(sin `DO`/plpgsql, compatible con PGlite); el índice parcial con `IF NOT EXISTS`.

**Frontera de reversibilidad:** el rollback es **limpio mientras no exista ninguna fila
`source='server'`** (todo lo previo a la implementación del productor server-side). Una vez que
existan filas server (con `sync_device_id`/`seq` en `NULL`), revertir el `NOT NULL` de esas columnas
exige **purgar primero las filas server**. Se documenta esta frontera para no re-imponer el `NOT NULL`
sobre datos ya migrados.

## Alternativas consideradas

- **Dispositivo-servidor sintético** (fila en `sync_devices` + `seq` propio): rechazada — sintetiza
  un dispositivo y una secuencia, ensucia el panel de flota y falsea `seq`.
- **`seq` determinista de chunk para filas server**: rechazada — sigue siendo una secuencia de
  dispositivo ficticia; `seq=NULL` es la representación honesta.
- **Solo bootstrap**: rechazada — no propaga incrementalmente a dispositivos ya activos.

## Alcance y no-alcance

- **Primer productor:** el importador de animales (P2). El mecanismo queda disponible para cualquier
  productor server-side futuro, sin rediseñar el protocolo.
- **Fuera de alcance:** modelar el origen servidor en la simulación de convergencia de `sync-core`
  (que modela convergencia dispositivo↔dispositivo); retención/limpieza de changesets; productores
  distintos de import.

## Consecuencias

- **Positivo:** propagación incremental reutilizando el pull tal cual (cero código de merge nuevo en
  el cliente); se preservan orden del servidor (`server_seq`), aislamiento por tenant, idempotencia
  (`(tenant_id, origin_ref)`) y la ausencia de conflictos HLC fabricados; `seq` no se falsea (`NULL`
  explícito), evitando una secuencia de dispositivo inventada.
- **Costo / known-issues:** `device_id`/`seq` pueden ser `NULL` en la response de pull (documentado en
  los tipos remotos); `sync-core`/la simulación no modelan el origen servidor; el `CHECK` acopla las
  tres columnas nuevas (`source`, `sync_device_id`/`seq`, `origin_ref`) por forma.

## Nota de implementación (P-a / P-b)

Entregado en dos olas (ver `docs/import.md` §Propagación):
- **P-a** — apply de cliente: `sync-core` expone `RemoteChangeset` (derivado de `Changeset`, identidad
  nullable) y `PullResult` lo usa; el móvil aplica un `source='server'` por `ops`/`hlc`/`cursor` sin
  fabricar identidad. `Changeset` de push permanece estricto; sim 2000/2000 intacta.
- **P-b** — emisión: `persistNewAnimal(sync='server_origin')` versiona con `HlcClock('server')` en
  `sync_row_state` y devuelve el `syncOp`; `ServerOriginChangesetWriter.emit` escribe la fila
  `source='server'` (dedup por `(tenant_id, origin_ref)`). **`REST createAnimal` es el primer emisor**
  (`origin_ref='rest:animal:<id>'`), cerrando además la brecha de que las altas web no se propagaban
  incrementalmente. Verificado end-to-end por `server-origin-e2e.mjs`. El procesador de import (P-c)
  reutilizará el mismo mecanismo por lote.

> Efecto secundario correcto: como el alta server-side ahora siembra `status='active'` con HLC de
> servidor, una transición de estado de un dispositivo debe tener un HLC posterior a la creación para
> ganar por LWW (un dispositivo no edita un animal antes de que exista) — reflejado en `sync-e2e`.
