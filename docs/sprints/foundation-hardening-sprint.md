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
- **T2.2** VOs de dominio: `Sex` ('F'|'M'), `TagNumber` (normalización + validez), `Weight` (valor + unidad SI), `Breed`.
- **Estrategia:** adoptarlos en las fronteras de mayor valor (alta de animal, captura de pesaje); no reescribir todas las firmas este sprint. Adopción gradual vía factories `parse()`/`of()`.

### Fase 3 — Domain Errors
- **T3.1** `DomainError` base + específicos: `DuplicateTag`, `InvalidWeight`, `InvalidPregnancy`, `AnimalAlreadyExists`, `TreatmentExpired`, `InvalidMovement` (y los que surjan). Cada uno con `code` de dominio estable.
- **T3.2** `DomainExceptionFilter` en NestJS que mapea `DomainError` → la misma forma HTTP actual (código, título, status). **Preserva las respuestas de error existentes.**

### Fase 4 — Servicios de dominio (matar la triplicación)
- **T4.1** Funciones puras en `packages/domain/health` y `/reproduction`: `computeWithdrawal(product, appliedAt)`, `computeExpectedDueDate(serviceDate)`, `classifyCategory(...)`.
- **T4.2** Reescribir `health.service` y `repro.service` para usarlas (camino REST).
- **T4.3** Reescribir el cliente móvil (`SyncContext`) para importar **las mismas** funciones (fuente única).
- **T4.4** Hacer que el servidor de sync **recompute** con la misma función en lugar de confiar en el valor del cliente (**servidor = fuente de verdad**). Determinista: para un cliente correcto el resultado es idéntico; para uno con bug, el servidor corrige y deja **traza de auditoría** (p. ej. el valor entrante vs el recalculado en el payload del evento/outbox) sin afectar al usuario.

### Fase 5 — Event Bus + Outbox (fundación, cableado mínimo)
- **T5.1** Contratos de eventos versionados en `packages/domain/events`: `AnimalRegistered`, `WeighingRecorded`, `TreatmentApplied`, `PregnancyDiagnosed`, etc.
- **T5.2** Puerto `EventPublisher` en el dominio; adaptador con **EventEmitter2** en `api` (transporte reemplazable sin tocar el dominio).
- **T5.3** Tabla `outbox` + publicación *después del commit*. Los writes actuales **emiten** el evento (dual-write: se mantiene `insertAnimalEvent` para el timeline y se **agrega** la emisión). Un suscriptor trivial de logging + su test prueban el cableado. **Sin cambiar comportamiento de consumidores.**

### Fase 6 — Refactor de sync a `SyncHandler` registry
- **T6.1** Interface `SyncHandler` (`table`, `apply(ctx, op)`), recibiendo el handle transaccional `Q` (mismas fronteras de tx que hoy).
- **T6.2** Extraer la lógica por tabla del `switch` a handlers **co-ubicados con su módulo** (herd → animal/weighing; health → vaccination/treatment; repro → breeding/pregnancy/calving).
- **T6.3** Registry que resuelve el handler por tabla; `sync.service` queda como orquestación. **Open/Closed:** módulo nuevo = handler nuevo, cero ediciones a `sync.service`.

### Fase 7 — Costura de desacople del dashboard
- **T7.1** Crear `dashboard.service`; mover las 22 consultas SQL fuera del controlador.
- **T7.2** Interface `DashboardProjection` con una impl `LiveQueryProjection` (hoy el mismo SQL; mañana proyecciones). Dirección fijada, comportamiento idéntico. **Sin CQRS materializado aún.**

### Fase 8 — Architecture Decision Records
- **T8.1** `docs/adr/` + plantilla + ADR-001 Monolito Modular, ADR-002 PGlite y PostgreSQL, ADR-003 Offline-First, ADR-004 Domain Package, ADR-005 Event Bus. Agregar ADR-006 (estrategia de Value Objects) y ADR-007 (Sync Handler registry) que este sprint decide.

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
