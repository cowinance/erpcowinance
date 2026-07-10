# Foundation Hardening Sprint — Resumen ejecutivo (F0-F9)

**Estado:** cerrado. **Objetivo cumplido:** transformar una aplicación ganadera funcional en una
plataforma con fundamentos empresariales, **sin cambiar comportamiento** (behavior-preserving).
**Para:** documentación interna / arquitectura. **Alcance:** solo arquitectura — no se agregaron
features de usuario.

---

## 1. Situación inicial

El alcance ganadero de Fase 1 estaba construido y funcionando, pero sobre una base con problemas
estructurales que no escalarían a un ERP de clase mundial.

### Problemas arquitectónicos encontrados
- **No existía capa de dominio:** las reglas de negocio vivían mezcladas con SQL dentro de servicios
  NestJS.
- **`sync.service.ts` era un God object** (581 líneas) que escribía en **todas** las tablas vía un
  switch central — conocía las reglas de todos los bounded contexts.
- **Dashboard con SQL cross-domain incrustado en el controller** (violación de capas).
- **Una dependencia circular** (`db.service ↔ request-context`).
- **Efectos acoplados a los writes:** alertas y timeline se disparaban en el mismo lugar que la
  escritura, sin un mecanismo de eventos.

### Riesgos principales
- **Deriva de comportamiento** al refactorizar reglas críticas (retiro sanitario, gestación).
- **Transacciones de PGlite delicadas** (una sola conexión) — el refactor de sync no podía romper
  las fronteras de tx.
- **Sin CI ni remoto Git** — todo local, gates a mano (sigue vigente).

### Deuda técnica detectada
- **La misma regla de negocio escrita en 3 lugares** (retiro sanitario y fecha de parto en
  `health.service`, `repro.service` y el `SyncContext` móvil) — duplicación **semántica**, invisible
  a herramientas de clones.
- Servicios grandes (`sync` 581, `alerts` 339, `herd` 323).
- Cobertura de tests no medida; acoplamiento de lectura cross-domain.

---

## 2. Transformaciones realizadas

### Dominio
- **`packages/domain` puro** (F1): TypeScript sin ninguna infra — la pureza la fuerza el `tsconfig`
  (si un import toca framework/DB/HTTP, no compila). Verificado: 0 imports de infra.
- **Value Objects con garantía real** (F2): `TenantId`/`FarmId`/`AnimalId`/`LotId`, `TagNumber`,
  `Weight` (kg canónico + presentación lb; precisión = decisión de dominio), `Sex`. **`Breed`
  evaluado y descartado** — ya era una entidad de catálogo, no un valor. Regla establecida: un VO
  solo existe si aporta una garantía real (ADR-0006).
- **Reglas centralizadas en servicios de dominio** (F4): `computeWithdrawal`,
  `computeExpectedDueDate{FromService,FromDiagnosis}`, `newbornCategoryCode`. La **triplicación se
  eliminó** — api y móvil importan las mismas funciones. `classifyCategory` completo se descartó (no
  existía como comportamiento; habría sido feature nueva disfrazada de refactor).
- **Domain Errors + filtro HTTP** (F3) sin inventar una jerarquía: se creó solo el
  `DomainExceptionFilter` que necesitaban los VOs existentes; el catálogo especulativo se difirió.

### Sync
- **Server Authority** (F4.4, ADR-0007): el servidor dejó de confiar ciegamente en los valores
  derivados que calcula el cliente — los **recomputa** y corrige (sin tolerancia), participando del
  mismo mecanismo de HLC que los dispositivos para el campo LWW. El cliente propone; el servidor
  decide.
- **Handlers por bounded context** (F6, ADR-0008): las **9 tablas** del protocolo de sync se
  movieron a un `SyncHandler` en su módulo dueño (herd/health/repro/animal-history). `sync.service`
  pasó de **687 a 271 líneas** — orquestador puro, sin reglas de dominio.
- **Inversión de dependencias:** los handlers se auto-registran en un `SyncHandlerRegistry`
  (`@Global`) desde su propio módulo; `sync.service` **no importa ningún módulo de dominio** — recibe
  el registry ya poblado. Grafo de módulos = DAG (0 ciclos).
- **`AnimalHistoryModule`** (ADR-0009): bounded context nuevo para la línea de tiempo del animal
  (subdominio genérico transversal, no propiedad de herd/health/repro).
- **Convergencia:** verificada en 2000/2000 escenarios de simulación; `sync-e2e` 19/19.

### Eventos
- **Event Bus interno + Outbox** (F5, ADR-0005): fundación instalada con separación de capas —
  contratos de evento en el dominio puro (`TreatmentApplied`), puerto `EventPublisher` en la capa de
  aplicación, adaptador + relay en infra (`@Global`).
- **Outbox Pattern:** la fila del evento se escribe en la **misma transacción** que el cambio de
  negocio; un relay la publica **después del commit**.
- **Garantías:** (1) **atomicidad** negocio↔evento — no hay eventos fantasma; (2) entrega
  **at-least-once**; (3) consumidores **idempotentes por diseño**.
- **Límites actuales (a propósito):** un solo evento real, un solo emisor (REST
  `health.service.treat`), sin dual-write con sync, sin migrar consumidores (alertas/timeline siguen
  acoplados a los writes), transporte in-process (EventEmitter2) detrás del puerto — reemplazable por
  Kafka sin tocar dominio ni aplicación.

### Read-side
- **`DashboardService`** (F7): las 8 queries cross-domain salieron del controller a un servicio; el
  controller quedó delgado. Respuesta de `/dashboard/kpis` verificada **idéntica byte a byte**.
- **Separación de lectura:** el método `kpis()` es la costura de proyección — no se creó una interfaz
  `DashboardProjection` (sería abstracción prematura con una sola implementación).
- **Camino futuro hacia read models:** el día que `kpis()` pase de live-query a leer un read model
  alimentado por eventos (CQRS-lite), el consumidor no cambia. F5 (eventos) + F7 (costura) dejan la
  dirección lista; **no** está construido.

### Calidad
- **`npm run audit:arch`** (F9): verificación reproducible, estática y rápida, en dos categorías
  explícitas:
  - **Architecture Gates** (bloquean, exit ≠ 0): typecheck, tests (106), cero ciclos.
  - **Quality Indicators** (informan, nunca bloquean): cobertura acotada a lo unit-testeable
    (72.54% domain+sync-core), duplicación jscpd (4.17%, clones sintácticos), tamaño de archivos.
- **`quality-baseline.md`** refrescado a números post-sprint; cada indicador con su estrategia de
  evolución. Sin ESLint (dependencia pesada, señal marginal). E2E/sim quedan como gates de runtime
  separados.

---

## 3. Arquitectura actual (alto nivel)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  packages/  (TypeScript puro, cero infra — dirección de dependencia: todo → )  │
│                                                                                │
│   domain/            sync-core/            db/                                  │
│   ├─ value-objects   ├─ HLC                └─ DDL canónico (140 tablas, PG)     │
│   ├─ services (reglas)├─ merge (LWW)                                            │
│   ├─ events (contratos)└─ convergencia                                          │
│   └─ shared (Brand, DomainError)                                               │
└───────────────────────────────▲────────────────────────────────────────────────┘
                                 │  (api / web / mobile → domain; nunca al revés)
┌───────────────────────────────┴────────────────────────────────────────────────┐
│  apps/api  (monolito modular NestJS — capa de aplicación)                        │
│                                                                                  │
│   application/ports/          ← EventPublisher (puerto de salida)                │
│                                                                                  │
│   modules/ (12 bounded contexts, 1:1)                                            │
│     herd  health  repro  land  media  alerts  reports                           │
│     animal-history   auth  identity   dashboard   sync                          │
│       │                                    │           │                         │
│       │  cada módulo posee su SyncHandler  │           │ orquestador puro        │
│       └───────────────┐                    │           │ (271 líneas, sin dominio)│
│                       ▼                    ▼           ▼                         │
│   infra/ (@Global)                registry/ (@Global)                            │
│     event-bus/                      SyncHandlerRegistry                          │
│       ├─ OutboxEventPublisher       SyncConflictWriter                           │
│       ├─ OutboxRelay (poller)       SyncVersionStore                             │
│       └─ LoggingSubscriber                                                       │
│                                                                                  │
│   db/ (@Global)  ← DbService (PGlite dev / PostgreSQL prod), RLS por tenant      │
└───────────────────────────────┬──────────────────────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
             event_outbox              tablas de dominio + sync_row_state
          (misma tx; relay             (réplica canónica; versiones HLC por campo)
           publica post-commit)
```

**Flujo de una escritura (ej. tratamiento por REST):** controller → `health.service.treat()` →
[computa retiro con la función de dominio + INSERT treatment + INSERT outbox] **en una sola tx** →
commit → `OutboxRelay` (post-commit) → EventEmitter2 → `LoggingSubscriber`.

**Flujo de sync offline:** dispositivo escribe local → push de changesets → `sync.service` despacha
cada op al `SyncHandler` de su tabla → el handler aplica (LWW por HLC, Server Authority en los
derivados, conflictos a `sync_conflicts`) → convergencia determinista.

---

## 4. Deuda técnica registrada

### Deuda aceptada (consciente, no urgente)
- **`bootstrap()` de sync todavía proyecta a mano** la forma de `animals`/`pregnancies`/`products`
  (read-side cross-domain). Fuera del alcance de F6 (que fue el camino de escritura). Behavior-
  preserving lo mantiene correcto.
- **`common/events.ts`** (`insertAnimalEvent`) como shared kernel plano, usado por 3 módulos —
  consolidarlo en `AnimalHistoryModule` es migración futura (ADR-0009).
- **Kernel de sync bajo `modules/sync/`** — cosmético; funcionalmente correcto (0 ciclos).
- **Cobertura de `sync-core` ~72%** (`device.ts` sub-cubierto) — indicador, no gate.

### Trabajo futuro (dirección fijada, no construido)
- **Read models alimentados por eventos / CQRS-lite:** la fundación existe (Event Bus F5 + costura
  F7); falta cablear eventos → proyectores → read models para dashboard/reportes/timeline.
- **Migrar consumidores a eventos:** `alerts` (motor de reglas) es el candidato más claro a
  convertirse en consumidor del Event Bus.
- **Dual-write de eventos** desde los `SyncHandler` (hoy solo emite el camino REST).
- **Suscripciones parciales de sync por finca** (hoy `bootstrap` baja el tenant completo).
- **Extracción a microservicios** si un contexto lo requiere (los límites 1:1 lo permiten).

### Riesgos reales
- **Sin CI ni remoto Git:** todo el trabajo vive local; los gates se corren a mano. **Crear el
  remoto es prioritario** (riesgo de pérdida). `audit:arch` ya es CI-ready.
- **Compatibilidad PostgreSQL diseñada, no probada end-to-end:** dev corre PGlite con degradaciones
  (`geography→jsonb`, sin PostGIS/TimescaleDB); no hay despliegue real sobre PostgreSQL todavía
  (ADR-0002).
- **HLC depende de relojes razonablemente monótonos** — Server Authority acota el daño en los campos
  derivados, no en todos.

---

## 5. Recomendación de siguiente fase

**El próximo salto ya no es arquitectónico, sino de producto.** La Fundación Arquitectónica está
cerrada, verificada y documentada (9 ADRs, `audit:arch`, gates verdes). Seguir endureciendo
arquitectura ahora tendría rendimientos decrecientes; el valor está en features sobre la base nueva.

### Transición Foundation Hardening → Fase Producto
1. **Antes de features (higiene, 1 paso):** crear el remoto Git y subir el sprint — hoy todo vive
   local (único riesgo operativo real pendiente).
2. **Reanudar features de Fase 1**, priorizadas para cerrar el criterio de MVP:
   - **Onboarding SaaS de 5 minutos** — cierra "tiempo a primer registro < 5 min".
   - **Documentos formales con vencimiento** — reusa el motor de alertas existente.
   - **Facturación SaaS** (planes + medición de uso; el cobro real requiere pasarela).
   - **Módulos ganaderos prioritarios** del backlog (config/customizing de catálogos, importadores).
3. **Aprovechar la fundación a medida que se agregan features** — sin abrir un frente de refactor
   nuevo: cada feature que produzca un hecho de dominio emite su evento (patrón F5 ya probado); cada
   tabla nueva de sync es un `SyncHandler` en su módulo (patrón F6); las lecturas complejas nuevas
   pueden empezar a consumir read models cuando el volumen lo justifique (dirección F7).

### Registro explícito
El **siguiente salto es de producto, no de arquitectura**. La arquitectura evolucionará de forma
**incremental y dirigida por necesidad real** (read models cuando el volumen lo pida, microservicios
si un contexto lo exige, migración de consumidores a eventos cuando se priorice) — no como un nuevo
sprint de hardening. La disciplina que gobernó F0-F9 (abstracción solo con consumidor real, una
regla en un lugar, ADR para toda decisión estructural, deuda registrada conscientemente) se mantiene
como forma de trabajo permanente.
