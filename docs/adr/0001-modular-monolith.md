# 0001 — Monolito Modular (NestJS)

- **Estado:** aceptado (retrospectivo — documenta una decisión de inicio del proyecto, ya construida y verificada)
- **Fecha:** decisión de fundación; ADR redactado en el Foundation Hardening Sprint, Fase 8
- **Contexto relacionado:** [[0002-pglite-postgresql]], [[0003-offline-first]], [[0008-sync-handler-ownership]]

## Contexto

Cowinance es un ERP agropecuario con muchos bounded contexts (hato, sanidad, reproducción,
potreros, inventarios, finanzas, agricultura, lechería, feedlot, IoT, …). En la etapa actual el
producto está construyendo el alcance ganadero de Fase 1 con un equipo chico, y la sincronización
offline exige que un cambio y sus efectos derivados se apliquen de forma **atómica** en el
servidor. Había que decidir la topología de despliegue: un solo servicio o varios.

## Decisión

**Monolito modular** en NestJS: un único proceso desplegable, internamente dividido en **módulos
que se alinean 1:1 con bounded contexts**. Hoy son 12 (`herd`, `health`, `repro`, `land`, `media`,
`alerts`, `reports`, `animal-history`, `auth`, `identity`, `dashboard`, `sync`).

Las fronteras internas se mantienen por diseño, no solo por disciplina: la comunicación entre
módulos no se hace con imports cruzados directos sino a través de **infraestructura compartida
`@Global`** (registro de sync, event bus, DB) — un módulo de dominio nunca importa otro módulo de
dominio (ADR-0008). El grafo de dependencias es un DAG verificado (`madge`: 0 ciclos).

### Estado actual (implementado y verificado)
- 12 módulos, cada uno controller + service (+ sync handlers propios).
- Frontera transaccional: una transacción por request HTTP (abierta por el interceptor de auth,
  reutilizada por `db.tx()`), con RLS forzada por tenant.
- Sync handlers y event bus registrados vía módulos `@Global`, sin acoplar `sync` a los dominios.
- 0 dependencias circulares.

### Evolución futura (roadmap, NO construido)
- **Extracción a microservicios** si un bounded context concreto lo requiere (escala independiente,
  equipo dedicado). El diseño lo prepara — límites 1:1 con contextos, comunicación por contratos
  (event bus) — pero **no hay ninguna extracción hecha ni planificada a corto plazo**.

## Alternativas consideradas

- **Microservicios desde el día uno.** Descartada: distribución prematura para la etapa y el equipo;
  la consistencia transaccional entre contextos (p. ej. un parto que crea una cría y cierra una
  preñez) requeriría sagas/2PC desde el principio; sobrecarga operativa (despliegue, observabilidad,
  red) sin beneficio de escala todavía.
- **Aplicación única sin estructura de módulos.** Descartada: sin fronteras internas, el código
  converge a un big ball of mud; imposible razonar sobre ownership o extraer contextos después.

## Consecuencias positivas

- **Consistencia transaccional** trivial: un solo Postgres, una transacción por request; los cambios
  cross-contexto de una operación son atómicos sin coordinador distribuido.
- **Velocidad de evolución:** un solo repo, un solo build, un solo despliegue; refactors
  cross-contexto (como todo el Foundation Hardening Sprint) son directos.
- **Límites internos claros:** módulos 1:1 con bounded contexts, fronteras impuestas por el patrón
  de infra `@Global` y verificadas por `madge`.
- **Camino de extracción abierto:** si un contexto necesita separarse, sus contratos ya existen.

## Consecuencias negativas

- **La base de datos compartida es un punto de acoplamiento:** hoy módulos de lectura
  (`dashboard`/`reports`/`alerts`) consultan tablas de otros contextos en vivo — aislado detrás de
  servicios, pero es acoplamiento de lectura (se resolverá con read models, futuro).
- **Escalado grueso:** se escala el proceso entero, no un contexto caliente.
- **Aislamiento de fallos limitado:** un módulo que degrada el proceso afecta a todos.
- **Requiere disciplina** para no romper las fronteras (mitigado por `madge` en los gates y por el
  patrón de auto-registro que evita imports cruzados).
