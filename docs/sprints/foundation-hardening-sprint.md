# Foundation Hardening Sprint — Documento de diseño

**Estado:** propuesto (pendiente de aprobación)
**Tipo:** sprint de arquitectura, *behavior-preserving* (sin cambios visibles para el usuario)
**Precede a:** reanudación de features de Fase 1 (onboarding, facturación, etc.)
**Base:** auditoría de arquitectura del proyecto (11 módulos, monolito modular NestJS + Next + Expo).

---

## 1. Objetivo

Fortalecer la base técnica de Cowinance para que soporte el crecimiento hacia un ERP agropecuario de clase mundial, **sin cambiar el comportamiento funcional**. El sprint introduce la capa de dominio, value objects, errores de dominio, un event bus interno, el refactor del motor de sync a handlers, la preparación del desacople del dashboard, los ADR y una estrategia de métricas de calidad.

**Regla de oro del sprint:** cada cambio debe dejar idénticas las respuestas de la API, la convergencia de sync y la UI. Si algo cambia para el usuario, está fuera de alcance.

**Reglas permanentes del proyecto (aprobadas):**
1. **Ninguna regla de negocio puede existir en más de un lugar.** Si aparece duplicada, el sprint no está terminado.
2. **Cada fase se implementa en cambios pequeños y revisables**, nunca un mega-commit. Historial limpio, riesgo de regresión mínimo.

**Decisiones aprobadas:**
- El **servidor es siempre la fuente de verdad**: en el camino de sync recomputa con la función de dominio; si el valor del cliente difiere, lo corrige y (cuando sea posible) deja **traza de auditoría** sin afectar al usuario.
- El **Event Bus se instala sin migrar consumidores** todavía (introducción incremental de bajo riesgo).
- **Vitest** es el framework de pruebas del proyecto.

## 2. Alcance

### Dentro
- `packages/domain`: estructura base completa (aunque queden carpetas vacías) + shared kernel puro (sin frameworks).
- Value Objects estratégicos: `TenantId`, `FarmId`, `AnimalId`, `LotId`, `Sex`, `TagNumber`, `Weight`, `Breed`.
- Jerarquía de Domain Errors + filtro de excepciones que los mapea a la respuesta HTTP actual (RFC 9457).
- Servicios de dominio puros que **eliminan la triplicación** de reglas (retiros, gestación, categorización).
- Event Bus interno (EventEmitter2) detrás de un puerto de dominio + patrón Outbox mínimo. **Se instala y emite; los consumidores se migran en un sprint futuro.**
- Refactor de `sync`: `SyncHandler` por módulo (Open/Closed), registry central; se elimina el `switch` gigante.
- Dashboard: extracción a `dashboard.service` + costura de proyección (interface), sin materializar CQRS todavía.
- `docs/adr/`: ADR-001 a ADR-005 (+ los que este sprint decida).
- Estrategia de métricas de calidad: tooling + línea base registrada.

### Fuera (explícito)
- Ninguna feature nueva de usuario.
- Kafka / RabbitMQ / cualquier componente distribuido.
- CQRS completo con read models materializados.
- Migrar **todos** los primitivos a VOs (solo el set estratégico).
- Extracción a microservicios.
- Cambios de esquema de base de datos o migración de datos.
- Migrar `alerts`/`reports` a consumir eventos (queda para después; en este sprint solo se para el bus).

## 3. Lista detallada de tareas

### Fase 0 — Red de seguridad (PRIMERO, antes de tocar nada)
- **T0.1** Tests de caracterización (*golden tests*) de los comportamientos a refactorizar: cálculo de retiro, fecha probable de parto, alta de animal con caravana duplicada, convergencia push/pull. Capturan el comportamiento actual como oráculo.
- **T0.2** Línea base de métricas de calidad (ver Fase 9): instalar tooling y registrar los números de hoy.

### Fase 1 — Scaffold de `packages/domain` + shared kernel
- **T1.1** Crear la estructura pedida: `shared/`, `animals/`, `health/`, `reproduction/`, `pastures/`, `inventory/`, `value-objects/`, `entities/`, `services/`, `events/`, con barrels `index.ts`.
- **T1.2** `package.json` + `tsconfig` del paquete: **TypeScript puro, cero dependencias de framework** (NestJS/React/Expo prohibidos por lint) para forzar la dirección de dependencias de Clean Architecture. Enlazar al workspace de `api`, `web` y `mobile` (replicando el setup ya probado de `packages/sync-core`).
- **T1.3** Decidir estrategia de manejo de errores (throw vs Result) → ADR.

### Fase 2 — Value Objects (set estratégico)
- **T2.1** VOs de identidad: `TenantId`, `FarmId`, `AnimalId`, `LotId` (UUID *branded* con validación en el factory).
- **T2.2** VOs de dominio: `TagNumber` (normalización + validez), `Weight` (valor + unidad SI), `Sex` ('F'|'M').
- **Criterio de admisión (F2.4, ADR-0006):** cada VO candidato responde antes de implementarse a 5 preguntas (invariante que protege, errores que evita vs. primitivo, comportamiento propio, módulos que lo reusarán, por qué VO y no primitivo). `Breed` fue evaluado y **descartado**: ya es una entidad de catálogo (`breeds` + `animal_breeds`) con identidad y ciclo de vida propios; no hay primitivo inseguro que envolver. Ver [ADR-0006](../adr/0006-value-object-strategy.md).
- **Estrategia:** adoptarlos en las fronteras de mayor valor (alta de animal, captura de pesaje); no reescribir todas las firmas este sprint. Adopción gradual vía factories `parse()`/`of()`.

### Fase 3 — Domain Errors
- **T3.1 — reducido.** El catálogo originalmente propuesto (`DuplicateTag`, `InvalidPregnancy`, `AnimalAlreadyExists`, `TreatmentExpired`, `InvalidMovement`) **queda diferido, sin implementar en F3**. Inventario de los ~65 códigos de error actuales de `apps/api` (F3) mostró que ninguno de esos candidatos tiene hoy una función pura de dominio que lo necesite: todos requieren I/O (existencia previa del animal, diagnóstico reproductivo actual, catálogos) que no puede vivir dentro de `packages/domain`. Se diseñan en **F4**, solo si al escribir el servicio de dominio puro correspondiente resulta que necesita señalar esa violación — aplicando el mismo criterio de admisión de abstracciones (ver ADR-0006, extensión F3). `DomainError` base y sus 4 instancias ya existentes (`InvalidIdentifier`, `InvalidTagNumber`, `InvalidWeight`, `InvalidSex`, de F2) son suficientes para F3.
- **T3.2** `DomainExceptionFilter` en NestJS — **implementado**. Mapea cualquier `DomainError` a la misma forma HTTP verificada empíricamente hoy: `{code, title}`, status 400 (todo `DomainError` actual es de validación). Registrado globalmente en `main.ts`. Confirmado behavior-preserving: respuestas de `BadRequestException`/`NotFoundException`/`UnauthorizedException` existentes, byte a byte idénticas antes/después; `auth-e2e` y `sync-e2e` verdes.

### Fase 4 — Servicios de dominio (matar la triplicación)
- **T4.1 — hecho.** `computeWithdrawal(appliedAt, meatDays, milkHours)` en `packages/domain/health`. Función pura, sin VO, sin clase, sin estado.
- **T4.2 — hecho** (junto con T4.1/T4.3, un candidato a la vez). `health.service.ts` y `repro.service.ts` reescritos para usar las funciones de dominio.
- **T4.3 — hecho.** `SyncContext.tsx` (mobile) reescrito para importar las mismas funciones (`@cowinance/domain` linkeado al workspace mobile, mismo patrón `file:` que `sync-core`).
  - `computeExpectedDueDateFromService`/`computeExpectedDueDateFromDiagnosis` en `packages/domain/reproduction` (F4.2) — dos funciones explícitas, no una con rama oculta. Golden test del Modo B (diagnóstico sin servicio) agregado antes de extraer (gap encontrado, ver commit `56d6a38`).
  - `newbornCategoryCode(sex)` en `packages/domain/reproduction` (F4.3-A) — regla acotada (solo nacimiento, solo bovino); comportamiento permisivo actual preservado tal cual, sin validar con el VO `Sex` (evita cambiar comportamiento). `classifyCategory` completo (especie+sexo+edad, catálogo configurable) **descartado**: no existe como comportamiento hoy, sería feature nueva — ver ADR-0006 extensión F4.3.
  - Los tres candidatos verificados end-to-end (llamadas reales a la api con la api corriendo) además de gates automatizados.
- **T4.4 — hecho.** Server Authority (ADR-0007): `sync.service.ts` recalcula `meat_withdrawal_until`/`milk_withdrawal_until` (evento inmutable) y `expected_due_date` (put LWW, corrección vía `HlcClock` propio del servidor) en vez de confiar en el valor del cliente; discrepancias → `sync_conflicts` auto-resuelto (`conflict_type='semantic'`, `resolution='server_wins'`). Verificado end-to-end contra la api real (cliente incorrecto → servidor corrige; cliente correcto → cero ruido). `category_code` queda fuera (candidato futuro).

**Fase 4 completa.** Siguiente: F6 (Sync → SyncHandler registry, usa los servicios de dominio recién creados).

### Fase 5 — Event Bus + Outbox (fundación, cableado mínimo) — **COMPLETA** (ADR-0005)
- **T5.1 — hecho.** Contratos versionados en `packages/domain/src/events/` (`DomainEvent` base + `TreatmentApplied` = `treatment.applied.v1`). Solo `TreatmentApplied` en F5; los demás se agregan cuando tengan consumidor real.
- **T5.2 — hecho, con ajuste de ubicación (ADR-0005, Opción B).** El puerto `EventPublisher` **no** va en el dominio puro sino en la **capa de aplicación** (`apps/api/src/application/ports/`) — las funciones puras del dominio no publican; quien decide cuándo publicar es la aplicación. Adaptador EventEmitter2 en `apps/api/src/infra/event-bus/` (`@Global`), transporte reemplazable detrás del puerto.
- **T5.3 — hecho, con dos aclaraciones.** Tabla `event_outbox` (migración idempotente en `db.service`, sin RLS) + relay poller que publica **post-commit**. La emisión va por el **puerto** (`OutboxEventPublisher` escribe la fila en la misma tx que el write) — no un dual-write manual. **Emisor único en F5: el camino REST `health.service.treat()`**; el dual-write con `TreatmentSyncHandler` queda para después (decisión de alcance). `insertAnimalEvent` (timeline) se mantiene intacto. Suscriptor de logging + test del relay (4 casos, incl. at-least-once) prueban el cableado. Verificado end-to-end contra la api real.

**Fase 5 completa.** Siguiente (orden aprobado): **F7** (Dashboard → service + costura de proyección).

### Fase 6 — Refactor de sync a `SyncHandler` registry
- **T6.1 — hecho.** Interface `SyncHandler` (`sync/contracts/sync-handler.interface.ts`: `table`, `apply(q, op, changesetDbId)`), recibiendo el handle transaccional `Q` (mismas fronteras de tx que hoy — ver análisis F6 §3: la transacción real vive alrededor de la request HTTP completa, abierta por `AuthInterceptor`, no por changeset).
- **T6.2 — COMPLETO (9 de 9 tablas migradas).** Cada tabla del protocolo de sync tiene su `SyncHandler` en el módulo dueño:
  - F6.1: `TreatmentSyncHandler` (health) — primero migró **dentro de `sync/`** (desviación); corregido en el mismo ciclo (**ADR-0008**) a co-ubicado en `health/sync/`.
  - F6.3: `AnimalEventSyncHandler` → **`AnimalHistoryModule`**, bounded context permanente nuevo (**ADR-0009**) — subdominio genérico transversal.
  - F6.3-B: `VaccinationSyncHandler` (health), `WeighingSyncHandler` (herd), `BreedingEventSyncHandler`/`CalvingSyncHandler`/`CalvingOffspringSyncHandler` (repro) — eventos sin lógica de negocio; `applyEvent()`/`EVENT_TABLES` eliminados.
  - F6 fase final: `AnimalSyncHandler` (herd) y `PregnancySyncHandler` (repro) — los dos `put` con LWW + conflictos + (pregnancies) Server Authority. Se extrajo `SyncVersionStore` (infra en `registry/`, dos consumidores reales). `serverClock` vive en `PregnancySyncHandler` (único consumidor de Server Authority; extracción futura evaluada si aparece un segundo). `applyAnimalPut`/`applyPregnancyPut`/`ANIMAL_FIELDS`/`PREGNANCY_FIELDS`/`serverClock` eliminados.
  - **Resultado: `sync.service.ts` pasó de 687 a 271 líneas, sin ninguna regla de dominio** — orquestador puro del protocolo (registro de dispositivos, push/pull, bootstrap, panel de flota, conflictos). El dispatch es `registry.get(op.table) → handler`, o `unsupported_op`.
- **T6.3 — hecho.** `SyncHandlerRegistry` (`sync/registry/`) resuelve el handler por tabla; `sync.service` queda como orquestación pura, sin importar módulos de dominio. **Open/Closed a nivel de módulo** (no solo de tabla, ADR-0008): un handler nuevo se auto-registra vía `OnModuleInit` desde su propio módulo — cero ediciones a `sync.service` **y** cero ediciones a `sync.module.ts`. Mecanismo: `SyncRegistryModule` (`@Global()`, mismo patrón que `DbModule`) expone el registry + `SyncConflictWriter` + `SyncVersionStore` a cualquier módulo sin imports cruzados.

**Fase 6 completa.** Siguiente: **F5** (Event Bus + Outbox).

### Fase 7 — Costura de desacople del dashboard
- **T7.1** Crear `dashboard.service`; mover las 22 consultas SQL fuera del controlador.
- **T7.2** Interface `DashboardProjection` con una impl `LiveQueryProjection` (hoy el mismo SQL; mañana proyecciones). Dirección fijada, comportamiento idéntico. **Sin CQRS materializado aún.**

### Fase 8 — Architecture Decision Records
- **T8.1** `docs/adr/` + plantilla + ADR-001 Monolito Modular, ADR-002 PGlite y PostgreSQL, ADR-003 Offline-First, ADR-004 Domain Package, ADR-005 Event Bus. ADR-006 (estrategia de Value Objects, F2.4), ADR-007 (Server Authority sobre valores derivados, F4.4) y **ADR-008 (ownership de SyncHandlers, F6.1)** ya se escribieron al surgir la decisión — quedan pendientes solo los ADR retrospectivos (0001-0003, 0005).

### Fase 9 — Estrategia de métricas de calidad
- **T9.1** Tooling: `vitest` (cobertura), regla de complejidad ciclomática (`eslint`/`ts-complex`), `dpdm`/`madge` (dependencias circulares + grafo de acoplamiento), `jscpd` (duplicación), log de tiempo de compilación.
- **T9.2** `docs/quality-baseline.md` con los números iniciales y umbrales objetivo.
- **T9.3** Script único `npm run audit:arch`. No bloquea CI todavía (no hay CI), pero queda documentado.

## 4. Orden definitivo de implementación (aprobado)

**F0 → F1 → F2 → F3 → F4 → F6 → F5 → F7 → F8 → F9** — construir el dominio primero, la infraestructura después.

```
F0  Red de seguridad (golden tests + baseline métricas)
F1  Scaffold packages/domain + shared kernel
F2  Value Objects estratégicos
F3  Domain Errors + filtro
F4  Servicios de dominio  ← el mayor valor (elimina la triplicación)
F6  Sync → handlers        (usa los servicios de dominio)
F5  Event Bus + Outbox     (fundación)
F7  Dashboard → service + costura
F8  ADRs                   (se escriben en continuo)
F9  Métricas de calidad    (cierre: comparar contra baseline)
```

**Núcleo imprescindible:** F0–F4 y F6. Las fases F5, F7 y F9 pueden entregarse "delgadas" (fundación) si el tiempo aprieta.

## 5. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Deriva de comportamiento en el refactor (esp. recompute de retiro en sync) | Alto | Golden tests capturados en Fase 0; función determinista; diff de respuestas antes/después |
| Scope creep de VOs (migrar todo) | Medio | Frontera dura: solo el set estratégico; adopción gradual en boundaries |
| Enlace del workspace en 3 consumidores (api CommonJS, web ESM, **Metro/Expo**) | Medio | Replicar el setup probado de `sync-core`; verificar build de cada consumidor tras Fase 1 |
| Event bus que emite sin consumidores → código muerto/confusión | Bajo | ADR-005 declara que es fundación; suscriptor de logging + test que prueba el cableado |
| Transacciones/RLS de PGlite son delicadas; el refactor de sync debe respetar las fronteras de tx | Alto | Los handlers reciben el mismo `Q` transaccional; sin cambiar el flujo de tx |
| Sprint largo (9 fases) | Medio | Fases 5/7/9 delgadas; priorizar núcleo 0-4,6 |

## 6. Estrategia de migración

- **Parallel change / strangler fig:** introducir las funciones de dominio en paralelo, cambiar los call sites uno por uno, y **borrar los duplicados al final**.
- **Verificación dual:** para las funciones puras, correr viejo vs nuevo sobre una batería de inputs (property tests) antes de eliminar el viejo.
- **VOs graduales:** adoptar en las fronteras vía factory; los internos siguen primitivos hasta que se toquen.
- **Sync:** extraer handlers detrás del dispatch existente; dejar el `switch` delegando temporalmente en los handlers y **recién después** removerlo.
- **Sin migración de datos, sin cambio de contrato de API.**

## 7. Archivos afectados

**Nuevos:**
- `packages/domain/**` (estructura + shared kernel + VOs + errors + services + events)
- `apps/api/src/common/domain-exception.filter.ts`
- `apps/api/src/infra/event-bus/**` (puerto + adaptador EventEmitter2 + outbox)
- `apps/api/src/modules/*/sync-handler.ts` (uno por módulo con captura offline)
- `apps/api/src/modules/dashboard/dashboard.service.ts` + `dashboard.projection.ts`
- `docs/adr/**`, `docs/quality-baseline.md`, `scripts/audit-arch.*`

**Modificados:**
- `apps/api/src/modules/health/health.service.ts` (usa fns de dominio)
- `apps/api/src/modules/repro/repro.service.ts` (idem)
- `apps/api/src/modules/sync/sync.service.ts` (→ orquestación + registry)
- `apps/api/src/modules/dashboard/dashboard.controller.ts` (SQL → service)
- `apps/api/src/main.ts` (registrar filtro de excepciones + módulo de eventos)
- `apps/mobile/src/sync/SyncContext.tsx` (importa fns de dominio compartidas)
- `package.json` (workspaces), `tsconfig` (referencias de proyecto)

**Intocables:** esquema de BD, páginas web (comportamiento), auth/RLS, todos los contratos cubiertos por E2E.

## 8. Cómo verificar que NO cambia el comportamiento funcional

Gates existentes que deben quedar **verdes** (sin cambios):
- `sync-core` suite de convergencia: **2000/2000 (100%)**.
- `apps/api/scripts/auth-e2e.mjs`: **15/15** (identidad + RLS + aislamiento).
- `apps/api/scripts/sync-e2e.mjs`: **19/19** (push/pull/conflictos/flota).
- `nest build`, `next build`, `tsc` móvil: limpios.

Verificación nueva:
- **Golden tests** (Fase 0) de retiro/gestación/categoría: mismos inputs → mismos outputs antes y después.
- **Snapshots de respuesta** de `dashboard/kpis`, lista y ficha de animales, KPIs de sanidad/repro: idénticos byte a byte (excepto el recompute intencional de retiro, que se prueba igual al valor correcto previo).
- **Smoke manual** en navegador de 3 flujos (ficha, captura de sanidad, manga) + modo offline móvil.

## 9. Criterios de aceptación

1. Todos los gates existentes verdes; todos los tests nuevos verdes.
2. **Cero cambio visible** para el usuario (diffs de screenshots/respuestas vacíos).
3. `packages/domain` existe con la estructura pedida y es importado por **api + móvil** (prueba que el shared kernel funciona cross-platform).
4. La lógica de **retiro y gestación existe en UN solo lugar** (verificado por `jscpd`/grep: sin duplicación).
5. `sync.service` ya **no contiene un `switch` por tabla**; agregar un módulo hipotético no requiere editarlo (demostrado con un handler dummy y su test).
6. El event bus **emite ≥1 evento de dominio real** con un test de suscriptor en verde; ADR-005 lo documenta.
7. `dashboard.controller` **sin SQL**; lógica en `dashboard.service` detrás de la costura de proyección.
8. `docs/adr/` con ADR-001..005 (+ nuevos); `docs/quality-baseline.md` con números registrados y `npm run audit:arch` corriendo.

---

## Apéndice — Estructura objetivo de `packages/domain`

```
packages/domain/
  shared/          # kernel: Result, Guard, base Entity/ValueObject/DomainEvent, base DomainError
  value-objects/   # TenantId, FarmId, AnimalId, LotId, Sex, TagNumber, Weight, Breed
  entities/        # (se poblará al extraer agregados; vacío inicial con barrel)
  services/        # funciones puras: withdrawal, gestation, categorización
  events/          # contratos de eventos de dominio versionados
  animals/         # bounded context (reexporta VOs/entities/eventos del hato)
  health/          # reglas de sanidad (retiros, planes)
  reproduction/    # reglas reproductivas (gestación, ciclo)
  pastures/        # (vacío inicial — Fase 2 del roadmap)
  inventory/       # (vacío inicial — Fase 2 del roadmap)
```

Dependencia permitida: `api`/`web`/`mobile` → `domain`. **Nunca** al revés. `domain` no importa frameworks.
