# 0003 — Arquitectura Offline-First

- **Estado:** aceptado (retrospectivo — documenta una decisión de inicio del proyecto, ya construida y verificada)
- **Fecha:** decisión de fundación; ADR redactado en el Foundation Hardening Sprint, Fase 8
- **Contexto relacionado:** [[0001-modular-monolith]], [[0002-pglite-postgresql]], [[0007-server-authority-derived-values]], [[0008-sync-handler-ownership]]

## Contexto

El uso real de Cowinance es en el campo: mangas, corrales y potreros con conectividad pobre o nula.
El operario **debe poder trabajar sin señal** (registrar pesajes, tratamientos, diagnósticos,
partos) y que sus capturas converjan de forma consistente cuando haya red, incluso con **varios
dispositivos** editando en paralelo y relojes no perfectamente sincronizados.

## Decisión

**Offline-first con el servidor como fuente de verdad.** El **cliente es el espacio de trabajo
local**: la UI lee y escribe **solo** contra un store local (`@cowinance/sync-core` como cliente;
SQLite en nativo, AsyncStorage en web). La sincronización es por **changesets** con **HLC (Hybrid
Logical Clock)** para ordenar eventos entre dispositivos sin depender de la hora del sistema, y
**LWW (last-writer-wins) por campo**. El servidor **aplica** los changesets, detecta conflictos y
**recomputa los valores derivados por reglas de dominio** (Server Authority, ADR-0007) — el cliente
propone, el servidor decide.

### Estado actual (implementado y verificado)
- **`packages/sync-core`** (puro): HLC, changesets, merge LWW por campo, detección de conflictos.
- **Cliente móvil** offline real: la UI opera solo contra el store local; sync automático (al
  arrancar, tras cada captura con debounce, y periódico).
- **Servidor de sync**: aplica changesets vía `SyncHandler` por bounded context (ADR-0008); versiones
  HLC por campo en `sync_row_state`; dedupe exactly-once por `(device, seq)`.
- **Resolución de conflictos**: LWW determinista por HLC; conflictos **semánticos** (dos estados
  terminales concurrentes, preñez concurrente) y **duplicados** (misma caravana en dos animales) se
  registran en `sync_conflicts` — nunca se descartan datos en silencio; algunos se auto-resuelven
  (`server_wins`, recompute de Server Authority) y otros quedan para revisión en el panel de flota.
- **Convergencia verificada**: simulación de 2000/2000 escenarios (100%); `sync-e2e` 19/19 (push,
  pull, conflictos, flota); `auth-e2e` 15/15 (identidad + RLS + aislamiento).

### Evolución futura (roadmap, NO construido)
- **Suscripciones parciales por finca:** hoy el `bootstrap()` baja el tenant completo (deuda
  registrada); un snapshot por finca/alcance es futuro.
- **Read models alimentados por eventos** (CQRS-lite) para el lado de lectura — la fundación existe
  (event bus F5), el cableado no.

## Alternativas consideradas

- **Online-only (sin offline).** Descartada: la conectividad del campo lo hace inviable; el operario
  no puede depender de señal para registrar en la manga.
- **LWW por reloj de pared (wall clock).** Descartada: el desfasaje de relojes entre dispositivos
  produciría un orden incorrecto de escrituras. **HLC** resuelve esto con un orden total
  determinista (ms lógico → contador → nodo) sin depender de la hora real.
- **CRDTs completos.** Descartada por ahora: sobredimensionado para este dominio, cuyas necesidades
  se cubren con LWW por campo + una cola de conflictos semánticos para los casos que requieren
  criterio humano. Se podría reconsiderar si aparecen estructuras colaborativas más ricas.
- **El cliente como caché de solo lectura (escritura siempre al servidor).** Descartada: no es
  offline real — sin red no se podría capturar.

## Consecuencias positivas

- **Funciona sin señal:** el operario captura offline y sincroniza cuando hay red.
- **Convergencia determinista y verificada:** mismo conjunto de changesets → mismo estado, sin
  coordinación (2000/2000 en simulación).
- **El servidor protege la integridad:** Server Authority recomputa los valores derivados, así un
  cliente con bug o desactualizado no corrompe datos de negocio (retiros, gestación).
- **Conflictos auditables:** nada se descarta en silencio; los conflictos quedan trazados y, cuando
  requieren criterio, en cola de revisión.

## Consecuencias negativas

- **Consistencia eventual, no inmediata:** dos dispositivos pueden divergir temporalmente hasta
  sincronizar.
- **LWW puede perder una escritura concurrente de campo** (gana el HLC mayor); mitigado para los
  casos con significado de negocio por la detección de conflictos semánticos, no para todo campo.
- **`bootstrap()` baja el tenant completo** (sin suscripción parcial) — no escala a tenants muy
  grandes; deuda registrada.
- **HLC depende de relojes razonablemente monótonos:** un reloj de dispositivo muy desviado puede
  ganar un LWW indebidamente (tradeoff inherente del enfoque; Server Authority acota el daño en los
  campos derivados).
- **Complejidad del motor de sync:** HLC, merge por campo, dedupe y conflictos son código delicado
  que exige gates estrictos (sim + e2e) ante cualquier cambio.
