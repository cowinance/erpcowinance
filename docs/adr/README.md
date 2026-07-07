# Architecture Decision Records (ADR)

Registro de decisiones de arquitectura de Cowinance. Cada decisión importante
queda documentada con su contexto, la decisión tomada y sus consecuencias.

Formato: [MADR](https://adr.github.io/madr/) simplificado. Un archivo por decisión,
numerado `NNNN-titulo.md`. Estados: `propuesto` · `aceptado` · `reemplazado por NNNN` · `deprecado`.

## Índice

| ADR | Título | Estado |
|---|---|---|
| [0004](0004-domain-package.md) | Paquete de dominio puro (`packages/domain`) | aceptado |

Pendientes (se documentan en F8 del Foundation Hardening Sprint):
`0001` Monolito Modular · `0002` PGlite y PostgreSQL · `0003` Arquitectura Offline-First · `0005` Event Bus interno.

> Nota de numeración: `0004` se escribe primero porque F1 (paquete de dominio) es lo
> primero que se implementa en el sprint. Los ADR retrospectivos (0001-0003, 0005)
> documentan decisiones ya tomadas y se redactan en F8.
