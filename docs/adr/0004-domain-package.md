# 0004 — Paquete de dominio puro (`packages/domain`)

- **Estado:** aceptado
- **Fecha:** Foundation Hardening Sprint, Fase 1
- **Contexto relacionado:** auditoría de arquitectura; [[reglas permanentes del proyecto]]

## Contexto

La auditoría encontró que no existe una capa de dominio: la lógica de negocio vive en
servicios NestJS mezclada con SQL, y algunas reglas (retiro sanitario, gestación) están
**duplicadas** entre `apps/api` y `apps/mobile`. Para crecer a un ERP de clase mundial
necesitamos un lugar único, puro y compartible para las reglas del negocio.

## Decisión

Crear `packages/domain`, un paquete **TypeScript puro** que contiene reglas de negocio y
tipos del dominio, consumible por `api`, `web` y `mobile`.

**Pureza garantizada por configuración**, no por disciplina: el `tsconfig` usa
`"lib": ["ES2022"]` y `"types": []`, por lo que el paquete **no compila** si intenta usar
DOM, Node, `AsyncLocalStorage`, HTTP o cualquier API de infraestructura. Prohibido depender
de NestJS, React, React Native, PGlite, PostgreSQL, Drizzle, Prisma o librerías de infra.
La dependencia siempre apunta hacia el dominio: `api`/`web`/`mobile` → `domain`, nunca al revés.

### Estructura: creación perezosa (YAGNI)

El objetivo del sprint proponía una estructura amplia (`animals/`, `health/`, `reproduction/`,
`pastures/`, `inventory/`, `value-objects/`, `entities/`, `services/`, `events/`). **Decidimos
NO crear esas carpetas vacías.** Se crean **cuando reciben código real**, en su fase:

| Carpeta | Se crea en | Motivo de diferirla |
|---|---|---|
| `shared/` | **F1 (ahora)** | Contiene el único primitivo compartido: `Brand` |
| `value-objects/` | F2 | Los VOs concretos (AnimalId, Weight, …) se diseñan en F2 |
| `services/` | F4 | Las reglas puras (retiro, gestación) se extraen en F4 |
| `events/` | F5 | Los contratos de eventos se definen al parar el Event Bus |
| `animals/` `health/` `reproduction/` | F2–F4 | Bounded contexts: se pueblan al mover sus VOs/reglas |
| `entities/` | cuando haya un agregado real | No hay agregados aún; crear la carpeta sería andamiaje vacío |
| `pastures/` `inventory/` | Fase 2 del roadmap de producto | Módulos futuros; hoy no existen |

Regla operativa: **cada archivo debe tener una razón para existir**. Preferimos pocos archivos
bien diseñados a una estructura grande llena de código vacío.

### Shared Kernel mínimo

El Shared Kernel arranca con **un solo elemento**: el tipo `Brand<T, K>` (marca nominal para
identidades tipadas), porque las identidades cruzan todos los bounded contexts. No se agregan
`Result`, `Guard`, base `Entity`/`ValueObject`, ni otras abstracciones hasta que un caso real
las necesite.

## Consecuencias

- **Positivo:** fuente única para las reglas (habilita la Regla Permanente 1); pureza forzada por
  el compilador; dirección de dependencias correcta; base estable para F2–F5 sin sobre-ingeniería.
- **Costo:** el paquete es CommonJS (como `sync-core`) para que `api` lo consuma; `web`/`mobile`
  lo importan vía sus bundlers (ya probado con `sync-core`).
- **Explícitamente fuera de alcance en F1:** agregados, repositorios, factories, casos de uso,
  event bus y cualquier abstracción todavía innecesaria.
