# Architecture Decision Records (ADR)

Registro de decisiones de arquitectura de Cowinance. Cada decisión importante
queda documentada con su contexto, la decisión tomada y sus consecuencias.

Formato: [MADR](https://adr.github.io/madr/) simplificado. Un archivo por decisión,
numerado `NNNN-titulo.md`. Estados: `propuesto` · `aceptado` · `reemplazado por NNNN` · `deprecado`.

## Índice

| ADR | Título | Estado |
|---|---|---|
| [0004](0004-domain-package.md) | Paquete de dominio puro (`packages/domain`) | aceptado |
| [0006](0006-value-object-strategy.md) | Estrategia de Value Objects: invariante real antes que patrón DDD | aceptado |
| [0007](0007-server-authority-derived-values.md) | Server Authority sobre valores derivados de reglas de dominio | aceptado |
| [0008](0008-sync-handler-ownership.md) | Ownership de SyncHandlers: el dominio los posee, sync coordina | aceptado |
| [0009](0009-animal-history-bounded-context.md) | `AnimalHistoryModule`: bounded context permanente para la línea de tiempo del animal | aceptado |

Pendientes (se documentan en F8 del Foundation Hardening Sprint):
`0001` Monolito Modular · `0002` PGlite y PostgreSQL · `0003` Arquitectura Offline-First · `0005` Event Bus interno.

> Nota de numeración: los ADR se numeran en el orden en que la decisión realmente se
> toma, no en el orden planeado originalmente — `0004` se escribió primero porque F1
> (paquete de dominio) fue lo primero que se implementó; `0006` y `0007` surgieron de
> decisiones tomadas en F2.4/F4 antes de lo previsto. Los ADR retrospectivos puros
> (0001-0003, 0005) documentan decisiones ya tomadas y se redactan en F8.
