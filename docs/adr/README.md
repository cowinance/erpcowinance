# Architecture Decision Records (ADR)

Registro de decisiones de arquitectura de Cowinance. Cada decisión importante
queda documentada con su contexto, la decisión tomada y sus consecuencias.

Formato: [MADR](https://adr.github.io/madr/) simplificado. Un archivo por decisión,
numerado `NNNN-titulo.md`. Estados: `propuesto` · `aceptado` · `reemplazado por NNNN` · `deprecado`.

## Índice

| ADR | Título | Estado |
|---|---|---|
| [0001](0001-modular-monolith.md) | Monolito Modular (NestJS) | aceptado (retrospectivo) |
| [0002](0002-pglite-postgresql.md) | PGlite en desarrollo, PostgreSQL como modelo canónico | aceptado (retrospectivo) |
| [0003](0003-offline-first.md) | Arquitectura Offline-First | aceptado (retrospectivo) |
| [0004](0004-domain-package.md) | Paquete de dominio puro (`packages/domain`) | aceptado |
| [0005](0005-event-bus-outbox.md) | Event Bus interno + Outbox para eventos de dominio | aceptado |
| [0006](0006-value-object-strategy.md) | Estrategia de Value Objects: invariante real antes que patrón DDD | aceptado |
| [0007](0007-server-authority-derived-values.md) | Server Authority sobre valores derivados de reglas de dominio | aceptado |
| [0008](0008-sync-handler-ownership.md) | Ownership de SyncHandlers: el dominio los posee, sync coordina | aceptado |
| [0009](0009-animal-history-bounded-context.md) | `AnimalHistoryModule`: bounded context permanente para la línea de tiempo del animal | aceptado |
| [0010](0010-tenant-self-service-provisioning.md) | Provisioning self-service de tenant (registro SaaS) | aceptado |
| [0011](0011-email-transactional-credential-lifecycle.md) | Email transaccional y ciclo de vida de credenciales (verificación + reset) | aceptado |
| [0012](0012-onboarding-initial-experience.md) | Arquitectura de onboarding y experiencia inicial (web/móvil, aislamiento local, E2E) | aceptado |

ADR 0001-0009: Foundation Hardening Sprint. ADR 0010+: Fase Producto.

> Nota de numeración: los ADR se numeran en el orden en que la decisión realmente se
> toma, no en el orden planeado originalmente — `0004` se escribió primero porque F1
> (paquete de dominio) fue lo primero que se implementó; `0006` y `0007` surgieron de
> decisiones tomadas en F2.4/F4 antes de lo previsto. Los retrospectivos (0001-0003)
> documentan decisiones de fundación ya construidas y verificadas, redactados en F8.
