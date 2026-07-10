# Cowinance — Handoff de sesión

**Fecha:** 2026-07-10
**Para:** el próximo Lead Engineer que continúe el desarrollo
**Propósito:** retomar el proyecto sin pérdida de contexto. Este documento es la referencia principal.

---

## 1. Estado actual del proyecto

### Resumen ejecutivo
Cowinance es una **plataforma ERP para ganadería, agricultura y administración de fincas**, offline-first y multi-tenant, especificada en 14 documentos (`docs/*.docx`). El **alcance funcional ganadero de la Fase 1 del producto está completo y verificado** (Hato, Sanidad, Reproducción, Producción/manga, Mapa de potreros, Reportes, Alertas, Fotos, Planes sanitarios, Vademécum), sobre 3 apps (`api` NestJS, `web` Next.js, `mobile` Expo) + 2 packages (`sync-core`, `domain`). En este momento el proyecto está **pausado en features** y en curso de un **Foundation Hardening Sprint** (mejora de arquitectura sin cambiar comportamiento). Vamos por **F4 completada** — el núcleo del sprint: `computeWithdrawal`, `computeExpectedDueDate{FromService,FromDiagnosis}`, `newbornCategoryCode` extraídos a `packages/domain` y migrados en api+mobile, y **Server Authority** (T4.4, ADR-0007) para que el servidor de sync deje de confiar ciegamente en los valores calculados por el cliente. El siguiente paso es **F6 (Sync → SyncHandler registry)**.

### Estado general del repositorio
- **Working tree:** limpio (solo `.claude/settings.local.json` sin trackear/ignorar; irrelevante).
- **Remoto:** **no hay** remoto configurado. `gh` CLI **no está instalado**. Todo está en git local.
- **Monorepo:** npm workspaces — `apps/api`, `apps/web`, `apps/mobile`, `packages/db`, `packages/sync-core`, `packages/domain`.

### Rama actual
`main` (siempre se trabaja acá; los commits son pequeños y directos).

### Último commit
`feat(sync): Server Authority sobre valores derivados (T4.4, ADR-0007)` (`ceeb83d`) — ver git log para la secuencia completa de F4: `434cc59` F4.1, `e4ef4e2` F4.2, `cb6b6c2` F4.3-A, `f3def38` ADR-0007, `ceeb83d` T4.4.

### Estado de compilación
- `nest build` (api) — **limpio**.
- `next build` (web) — **limpio** (última verificación 15 páginas; no re-verificado en esta sesión, F4 no tocó web).
- `tsc` (mobile) — **limpio** (re-verificado tras cada migración de F4).
- `tsc` (packages/domain, puro) — **limpio**.

### Estado de las pruebas
- **102 tests verdes**, 13 archivos (Vitest). Incluye `sync-core` (HLC/merge/convergencia), golden de reglas de negocio (retiro + gestación Modo A/B, delegando en las funciones reales del dominio), VOs de dominio (Brand, ids, TagNumber, Weight, Sex), `DomainExceptionFilter`, y los 3 servicios de dominio de F4 (`withdrawal`, `gestation`, `newborn-category`).
- **Suite de convergencia de sync:** 2000/2000 (100%).
- **E2E HTTP:** auth 15/15, sync 19/19 — **re-verificados tras cada commit de F4**, incluyendo T4.4 con la nueva lógica de Server Authority activa. Además, verificación **dirigida** de T4.4 con pushes deliberadamente incorrectos (cliente desactualizado simulado): el servidor corrigió `meat/milk_withdrawal_until` y `expected_due_date` en los tres casos probados, y un push con valores ya correctos no generó ningún conflicto espurio (ver §3, F4).

### Estado del sprint actual
**Foundation Hardening Sprint** en curso. Completadas: **F0, F1, F2, F3, F4 (completa, incluye T4.4/ADR-0007)**. Siguiente: **F6**. Ver §5.

---

## 2. Arquitectura actual

### Arquitectura implementada
- **Monolito modular** en NestJS (`apps/api`): 11 módulos (auth, identity, herd, health, repro, land, dashboard, sync, alerts, reports, media), cada uno controller + service. Persistencia **PGlite** (Postgres embebido en dev) cargando el DDL canónico de **140 tablas** (`packages/db`). En prod el mismo DDL corre sobre PostgreSQL 17 + PostGIS + TimescaleDB.
- **Multi-tenant con RLS forzada** en 30 tablas: cada request abre una transacción con `SET LOCAL app.tenant_id`; sin contexto → cero filas. Propagación por `AsyncLocalStorage` (`request-context.ts`).
- **Auth**: emisor JWT estilo OIDC (access 15 min + refresh con rotación y detección de reuso), interceptor global, `@Public` para rutas abiertas.
- **Sync offline** (`packages/sync-core`, puro): HLC, changesets, LWW por campo, conflictos semánticos/duplicados, dedupe exactly-once. El servidor (`sync.service`) aplica los changesets sobre las tablas de dominio.
- **Web** (Next.js App Router): componentes servidor con fetch autenticado (cookies + middleware), design system "Cowinance UI".
- **Mobile** (Expo/React Native): offline-first real — la UI lee/escribe **solo** contra el store local (`sync-core` como cliente), persistencia SQLite (nativo) / AsyncStorage (web), sync automático.
- **`packages/domain`** (NUEVO, F1): dominio **TypeScript puro**, base para la migración a capas.

### Arquitectura objetivo
UI → Application → **Domain** → Infrastructure, con:
- `packages/domain` como fuente única de reglas y tipos (Value Objects, Domain Errors, servicios de dominio puros, contratos de eventos).
- **Event Bus interno** (EventEmitter2) detrás de un puerto de dominio (transporte reemplazable; en prod Kafka).
- **Sync por handlers** (Open/Closed): cada módulo registra su `SyncHandler`; `sync.service` orquesta, no conoce tablas.
- **Dashboard** desacoplado de tablas vía proyecciones (dirección a CQRS, sin materializar aún).
- Preparado para extracción futura a microservicios sin reescribir contratos.

### Decisiones importantes tomadas (esta sesión)
- **Foundation Hardening Sprint** aprobado (ver `docs/sprints/foundation-hardening-sprint.md`), orden definitivo: **F0 → F1 → F2 → F3 → F4 → F6 → F5 → F7 → F8 → F9**.
- **DomainError base mínima** introducida en F2.1 (los VOs necesitan señalar invalidez sin error genérico); se mantiene **extremadamente simple** (sin Result/Either/Option/fábricas).
- **Value Objects sin migrar consumidores hasta F4** (Opción B) — para tocar cada archivo una sola vez.
- **Servidor = fuente de verdad** en sync: F4 hará que recompute con la función de dominio; si el cliente difiere, corrige y deja traza de auditoría.
- **Event Bus se instala sin migrar consumidores** (introducción incremental).
- **Vitest** es el framework de pruebas.
- **Estructura de dominio perezosa (YAGNI):** no se crean carpetas vacías; se crean cuando reciben código real (documentado en ADR-0004).
- **Precisión numérica es decisión del dominio, no de la persistencia** (F2.3): `WEIGHT_SCALE` es una constante explícita en `packages/domain`, no se infiere del `numeric(14,3)` del schema — el comportamiento del dominio debe ser idéntico si cambia el motor de base de datos.
- **Checklist obligatorio de 5 preguntas antes de implementar un VO nuevo** (F2.4, ADR-0006): invariante que protege, errores que evita vs. primitivo, comportamiento propio, módulos consumidores, por qué VO y no primitivo. Si una entidad/catálogo existente ya cubre el concepto (caso `Breed`), no se crea el VO.
- **El mismo criterio se generalizó a `DomainError`** (F3, extensión ADR-0006): no se crea un error de dominio sin una función pura de dominio (o caso de uso concreto) que lo necesite lanzar. Regla permanente ampliada: ninguna abstracción de dominio se crea sin demostrar antes qué problema real resuelve y por qué las abstracciones existentes no alcanzan.
- **`DomainExceptionFilter` mapea con status fijo 400**, sin tabla código→status (F3): todo `DomainError` existente es de validación; una tabla de mapeo para statuses que no existen todavía sería especulativa.

### ADR existentes
- `docs/adr/README.md` — índice y proceso.
- `docs/adr/0004-domain-package.md` — **aceptado**. Paquete de dominio puro + política YAGNI de carpetas.
- `docs/adr/0006-value-object-strategy.md` — **aceptado**. Checklist de 5 preguntas para admitir un VO; `Breed` descartado (ya es entidad de catálogo), `Sex` aceptado. **Extendido en F3** a `DomainError`: catálogo especulativo de T3.1 diferido íntegro a F4.
- Pendientes (F8): 0001 Monolito Modular, 0002 PGlite+PostgreSQL, 0003 Offline-First, 0005 Event Bus, 0007 Sync Handler registry.

### Principios que gobiernan el proyecto
Ver §8 (Reglas permanentes). En síntesis: dominio puro, una regla en un solo lugar, YAGNI, cambios pequeños, behavior-preserving, servidor fuente de verdad, ADR para decisiones importantes.

---

## 3. Trabajo completado

### Fase de producto (previa al sprint)
**Objetivo:** entregar el MVP ganadero de Fase 1 de punta a punta.
**Qué se implementó / commits / validación:**
- `d0d752f` Fundaciones + Hato + motor de sync + móvil.
- `95663da` Repaso general (fix de transacciones PGlite en sync).
- `e6f7a06` Identidad real: OIDC + RLS forzada por tenant. Validado con `auth-e2e` (15/15, aislamiento entre 2 tenants).
- `349a341` Mapa 2D de potreros (ocupación, mover lotes). Verificado en navegador.
- `5585a3c` Reportes esenciales (inventario a fecha reconstruido por eventos). Verificado.
- `85e2a14` Notificaciones y alertas (motor de reglas + centro de alertas + badge). Verificado (16 alertas, idempotencia, aislamiento).
- `a71f275` Fotos del animal (módulo media A6: subida, URL firmada, galería, foto principal). Verificado (subida→sirve 200, token inválido 400).
- `0aa3624` Planes sanitarios reutilizables (B3).
- `fdd40ea` Alta de medicamentos (vademécum + alta inline en captura).
**Resultado:** alcance funcional ganadero de Fase 1 completo. Falta de Fase 1 (features): onboarding, facturación SaaS, documentos formales con vencimiento, config UI, importadores, hardware (báscula/RFID/voz). Ver §4.

### F0 — Red de seguridad (Foundation Hardening)
**Objetivo:** garantizar el comportamiento antes de refactorizar.
**Qué:** Vitest instalado; tests unitarios de `sync-core` (HLC/merge/convergencia como gate); **golden characterization** de las reglas de negocio (`docs/golden/business-rules.md` + tests); baseline de métricas (`docs/quality-baseline.md`).
**Commits:** `debba18`, `179198e`, `1dc3b31`, `f7ea130` (+ `f90ef00` plan aprobado).
**Resultado:** 34 tests verdes de arranque; oráculo de comportamiento capturado; hallazgos clave (1 dependencia circular; duplicación **semántica** de reglas invisible a jscpd).
**Validación:** suite verde; baseline documentado.

### F1 — `packages/domain` + Shared Kernel
**Objetivo:** estructura estable del dominio (sin construir un framework).
**Qué:** paquete TS **puro** (pureza forzada por `tsconfig`: `lib ES2022` + `types []` → no compila si toca DOM/Node/infra). Shared Kernel mínimo: `Brand<T,K>` (marca nominal). **Rota la dependencia circular** extrayendo `Q` a `apps/api/src/db/query.ts`. ADR-0004.
**Commits:** `0da6fe6` (scaffold + Brand + ADR), `6e8dd35` (romper ciclo).
**Resultado:** madge **0 ciclos** (era 1); paquete linkeado al workspace; YAGNI (sin carpetas vacías).
**Validación:** build puro, tests verdes, `nest build` limpio, madge 0.

### F2.1 — Value Objects de identidad
**Objetivo:** `TenantId`, `FarmId`, `AnimalId`, `LotId` con garantías reales.
**Qué:** VOs branded-UUID (validación de UUID definida **una sola vez** en `makeIdentifier`) + `InvalidIdentifier` sobre `DomainError` base (mínima). Patrón companion (tipo + factory con `.of()`/`.isValid()`).
**Commit:** `aa1c7e6`.
**Resultado:** identidades que no se confunden entre sí (nominal) y siempre válidas. **Sin migrar consumidores** (Opción B).
**Validación:** tests de dominio (aceptación/rechazo/instanceof DomainError/code estable).

### F2.2 — Value Object `TagNumber`
**Objetivo:** la caravana visual como VO.
**Qué:** validación (no vacía, ≤255) + normalización (trim, centraliza regla dispersa) + type-safety + `InvalidTagNumber`. Acotado a identificación **visual** (RFID/oficial/interno serán VOs hermanos).
**Commit:** `12897d0`.
**Resultado:** 60 tests totales verdes. Sin migrar consumidores.
**Validación:** build puro, suite completa verde, madge 0.

### F2.3 — Value Object `Weight`
**Objetivo:** el peso como VO, kg canónico + presentación lb.
**Qué:** unidad canónica **kilogramos (SI)**; `Weight.kg()`/`Weight.lb()` (conversión centralizada, factor exacto `0.45359237`); `WEIGHT_SCALE = 3` como constante **del dominio** (no derivada del esquema SQL) — decisión explícita para que el comportamiento no dependa del motor de persistencia; igualdad **exacta** (sin epsilon); `compare`/`min`/`max`; `InvalidWeight`.
**Resultado:** 70 tests totales verdes. Sin migrar consumidores.
**Validación:** build puro, suite completa verde, madge 0.

### F2.4 — Value Object `Sex`; `Breed` evaluado y descartado
**Objetivo:** aplicar por primera vez el checklist de 5 preguntas (invariante, errores evitados, comportamiento propio, módulos consumidores, por qué VO) antes de construir cualquier VO nuevo.
**Qué:**
- `Sex`: conjunto cerrado `{F, M}`; `Sex.of()`/`isValid()`/`equals()`/`isFemale()`/`isMale()`; `InvalidSex`. Alcance mínimo deliberado — sin lógica reproductiva (eso es de servicios de dominio, F4).
- `Breed`: **descartado** como VO. El schema ya lo modela como entidad de catálogo (`breeds` + `animal_breeds` con `fraction`), con identidad, ciclo de vida y alcance global/tenant propios. El único invariante real (suma de fracciones raciales = 1) es **agregado**, no de un valor individual, y no tiene consumidor hoy — candidato futuro de servicio de dominio, no de VO.
- Decisión documentada en **ADR-0006** (`docs/adr/0006-value-object-strategy.md`), que deja el checklist como criterio obligatorio para el resto del sprint.
**Resultado:** 76 tests totales verdes. Sin migrar consumidores.
**Validación:** build puro, suite completa verde, madge 0.

### F3 — `DomainExceptionFilter`; catálogo de errores nuevo diferido
**Objetivo:** que los `DomainError` existentes puedan atravesar la capa HTTP sin romper el contrato, aplicando el mismo criterio de admisión de abstracciones (ahora también a errores) antes de construir una jerarquía nueva.
**Qué:**
- **Inventario previo** de los ~65 códigos de error de `apps/api` (grep exhaustivo), clasificados en 6 grupos (auth, campos faltantes, not-found, reglas reales, protocolo de sync, media/infra). Ninguno de los 5 candidatos originales de T3.1 (`DuplicateTag`, `InvalidPregnancy`, `AnimalAlreadyExists`, `TreatmentExpired`, `InvalidMovement`) tiene hoy una función pura de dominio que lo necesite — todos requieren I/O. **Se difieren a F4**, y solo si el servicio de dominio puro correspondiente termina necesitándolos.
- **Verificación empírica del contrato HTTP** (api corriendo + `curl`, con token real): confirmado que `BadRequestException`/`NotFoundException`/`UnauthorizedException` con `{code,title}` serializan **exactamente** `{"code":"...","title":"..."}`, sin `statusCode`/`message`/`error` — y que rutas que no pasan por esta convención (404 de Nest genuino) usan un shape totalmente distinto, que el filtro no debe tocar.
- **`DomainExceptionFilter`** (`apps/api/src/common/domain-exception.filter.ts`): `@Catch(DomainError)`, produce `{code, title}` con status 400 fijo (todo `DomainError` de hoy es de validación; sin mapa código→status especulativo). Registrado globalmente en `main.ts`.
- **`@cowinance/domain` agregado como dependencia real de `apps/api`** (faltaba — solo `sync-core` estaba declarado).
- Decisión documentada como **extensión de ADR-0006**: el criterio "invariante real antes que patrón" generalizado a toda abstracción de dominio, con un checklist adaptado a errores (regla que representa, decisión que habilita, por qué no alcanza un error genérico, capa que debe conocerlo, estabilidad como contrato).
**Resultado:** 78 tests totales verdes (incluye prueba de cableado del filtro). Regresión HTTP verificada byte a byte idéntica; `auth-e2e` 15/15 y `sync-e2e` 19/19 re-verificados con el filtro activo.
**Validación:** build puro, `nest build`, suite completa verde, madge 0, E2E verdes, curl manual antes/después.

### F4 — Servicios de dominio + Server Authority (núcleo del sprint)
**Objetivo:** eliminar la triplicación real de reglas (no construir servicios "por catálogo"). Antes de tocar código, análisis de estado actual por candidato (dónde vive la duplicación, cuántos sitios, qué consumidores, qué tests protegen) — cambió el alcance original: `classifyCategory` completo no existe como comportamiento hoy (se hubiera sido feature nueva, prohibida durante el sprint).

- **F4.1 `computeWithdrawal`** (`packages/domain/health/withdrawal.ts`): función pura, sin VO/clase/estado. Elimina la duplicación `health.service.ts` ↔ `SyncContext.tsx`. Migrados ambos consumidores. Commit `434cc59`.
- **F4.2 `computeExpectedDueDateFromService`/`computeExpectedDueDateFromDiagnosis`** (`packages/domain/reproduction/gestation.ts`): dos modos duplicados, **dos funciones explícitas** (no una con rama oculta — un parámetro opcional escondería una decisión de negocio). Gap encontrado: el oráculo golden de F0 solo pineaba el Modo A (desde servicio); se agregó el golden test del Modo B (diagnóstico sin servicio, heurística −45 días) **antes** de extraer (commit `56d6a38`), luego la extracción (commit `e4ef4e2`). Verificado end-to-end: `POST /pregnancy-diagnoses` sin servicio previo produce `expected_due_date` idéntico al golden.
- **F4.3 — `classifyCategory` completo (especie+sexo+edad, catálogo configurable) descartado**: no existe como comportamiento en el sistema hoy (categoría es elegida manualmente por el usuario en un `<select>`; las columnas `min_age_months`/`max_age_months` no las lee ningún código de runtime). Construirlo sería una feature nueva, no una extracción — queda en backlog de producto.
  - **F4.3-A `newbornCategoryCode`** (`packages/domain/reproduction/newborn-category.ts`): regla real y menor sí encontrada — categoría de una cría al nacer según sexo (`ternero`/`ternera`), duplicada en `repro.service.ts` y `SyncContext.tsx`. Comportamiento permisivo actual preservado tal cual (no valida con el VO `Sex`, evita cambiar comportamiento). Commit `cb6b6c2`.
- **T4.4 — Server Authority** (`ADR-0007`, commit `f3def38` para el ADR + `ceeb83d` para la implementación): el servidor de sync dejaba de confiar ciegamente en los valores que el cliente calculaba. Ahora recalcula con las funciones de F4.1/F4.2 y, si difieren, corrige — sin tolerancia (son campos derivados de reglas, no preferencias). Mecanismo distinto según el tipo de operación de sync: `treatments` (evento inmutable, insert-once) es un recompute puntual sin interacción con LWW; `pregnancies.expected_due_date` (campo `put`, LWW por HLC) requirió que la corrección del servidor **participe del mismo mecanismo de HLC** que los dispositivos (`HlcClock` propio, `node='server'`) — un `UPDATE` directo por fuera de ese mecanismo habría dejado la corrección vulnerable a que un push posterior la pisara. Auditoría reutilizando `sync_conflicts` existente (`conflict_type='semantic'`, `resolution='server_wins'`, auto-resuelto — no ensucia el panel de flota), sin ampliar su `CHECK` (mismo criterio de ADR-0006: no crear una categoría de conflicto nueva con un solo consumidor). `category_code` queda fuera de esta ronda.

**Resultado:** 102 tests totales verdes. Cada candidato verificado end-to-end contra la api real corriendo (no solo tests automatizados): llamadas HTTP directas con valores deliberadamente incorrectos confirmando que el servidor corrige y persiste el valor correcto, y que un cliente ya correcto no genera ruido.
**Validación:** build puro, `nest build`, `tsc` mobile, suite completa verde, madge 0, sim de sync-core 2000/2000, `auth-e2e` 15/15, `sync-e2e` 19/19 (re-verificados tras cada commit), verificación dirigida por HTTP de T4.4.

---

## 4. Trabajo pendiente (por prioridad)

### Sprint actual (Foundation Hardening) — lo inmediato
1. **F6** Sync → SyncHandler registry (elimina el switch de `sync.service`) ← siguiente paso (ver §9). Usa los servicios de dominio de F4; cuidado extra al tocar `applyEvent`/`applyPregnancyPut` (T4.4 les agregó lógica de Server Authority — los handlers nuevos deben conservarla, no perderla al partir el switch).
2. **F5** Event Bus + Outbox.
3. **F7** Dashboard → service + costura de proyección.
4. **F8** ADRs restantes: 0001-0003, 0005, 0008 (Sync Handler registry — renumerado, ver `docs/adr/README.md`).
5. **F9** Métricas de calidad (formalizar tooling + `npm run audit:arch`).

### Próximo sprint (tras el hardening): reanudar features de Fase 1
- **Onboarding de 5 minutos** (cierra el criterio "tiempo-a-primer-registro < 5 min").
- **Documentos formales con vencimiento** (completa A6; reusa el motor de alertas).
- **Facturación SaaS** (planes + medición de uso; el cobro real requiere pasarela).

### Backlog inmediato
- **Config / customizing UI** (A3): editar catálogos (razas, categorías, diagnósticos).
- **Importadores** (Excel / foto de planilla con OCR).
- **GitHub**: crear remoto y subir (requiere instalar `gh` o dar URL de repo).

### Backlog futuro (Fase 2+ del producto)
Inventario, Compras/Ventas/CRM, Finanzas/Contabilidad, Agricultura, Pasturas, Lechería, Feedlot, IoT, Drones, IA, Blockchain, Marketplace, Multiempresa. Hardware de Fase 1 (báscula Bluetooth, RFID, captura por voz) requiere dispositivos reales.

---

## 5. Foundation Hardening Sprint — estado exacto

| Fase | Descripción | Estado |
|---|---|---|
| **F0** | Red de seguridad (golden tests + baseline de calidad) | ✅ Completado |
| **F1** | `packages/domain` puro + Shared Kernel + romper ciclo | ✅ Completado |
| **F2.1** | VOs de identidad (TenantId, FarmId, AnimalId, LotId) | ✅ Completado |
| **F2.2** | VO `TagNumber` (caravana visual) | ✅ Completado |
| **F2.3** | VO `Weight` (kg canónico + presentación lb) | ✅ Completado |
| **F2.4** | VO `Sex`; `Breed` evaluado y descartado (ADR-0006) | ✅ Completado |
| **F3** | `DomainExceptionFilter` (T3.1 catálogo de errores reducido — ver ADR-0006 extensión) | ✅ Completado |
| **F4** | `computeWithdrawal`, `computeExpectedDueDate{FromService,FromDiagnosis}`, `newbornCategoryCode` + migración de consumidores + Server Authority en sync (T4.4, ADR-0007) | ✅ Completado ← **siguiente: F6** |
| **F5** | Event Bus (EventEmitter2) + Outbox (instalar, no migrar consumidores) | ⏳ Pendiente |
| **F6** | Sync → `SyncHandler` registry (elimina el switch de `sync.service`) | ⏳ Pendiente |
| **F7** | Dashboard → `dashboard.service` + costura de proyección | ⏳ Pendiente |
| **F8** | ADRs 0001-0003, 0005, 0008 (Sync Handler registry) | ⏳ Pendiente (0004, 0006, 0007 ya escritos) |
| **F9** | Métricas de calidad (tooling + `npm run audit:arch`) | ⏳ Pendiente (baseline ya registrado en F0) |

> Orden de ejecución aprobado: F0 → F1 → F2 → F3 → F4 → **F6** → **F5** → F7 → F8 → F9.
> Regla de revisión: **hacer pausa de revisión al terminar cada sub-fase** antes de continuar.

---

## 6. Riesgos técnicos abiertos

| # | Riesgo | Impacto | Probabilidad | Mitigación |
|---|---|---|---|---|
| R1 | **Deriva de comportamiento** al matar la duplicación en F4 (esp. recompute de retiro en sync) | Alto | Media | Golden tests (F0) como oráculo; función determinista; diff de respuestas antes/después; el recompute debe igualar el valor correcto previo |
| R2 | **Transacciones/RLS de PGlite delicadas**: el refactor de sync (F6) debe respetar las mismas fronteras de tx | Alto | Media | Handlers reciben el mismo handle `Q`; correr `sync-e2e` (19/19) + sim (2000/2000) tras cada cambio |
| R3 | **Enlace del workspace en Metro/Expo** al consumir `@cowinance/domain` desde mobile (ya nos pasó con `sync-core`) | Medio | Media | Replicar el setup probado de `sync-core`; limpiar caché de Metro; verificar build de cada consumidor |
| R4 | **`nest build`/`next build` corriendo junto al watch** corrompe artefactos (ya ocurrió 2 veces) | Medio | Alta si se descuida | **Nunca** buildear mientras corre el watch; parar el server, buildear, reiniciar. Documentado |
| R5 | **Event Bus emitiendo sin consumidores** (F5) puede leerse como código muerto | Bajo | Baja | ADR-0005 declara que es fundación; suscriptor de logging + test que prueba el cableado |
| R6 | **Duplicación semántica de reglas** vigente hasta F4 (retiro/gestación en 3 lugares) | Alto (correctitud) | Alta (existe hoy) | Es exactamente lo que F4 elimina; hasta entonces, cualquier cambio a esas reglas debe tocarse en los 3 lugares |
| R7 | **Sin CI**: los gates se corren a mano | Medio | Media | Documentado en §11; F9 deja `npm run audit:arch`; instalar CI es backlog |
| R8 | **Sin remoto Git**: todo el trabajo vive local | Alto (pérdida) | Baja | Crear remoto GitHub cuanto antes (backlog inmediato) |

---

## 7. Deuda técnica (vigente y por qué no se resolvió aún)

1. **Regla de negocio duplicada** (retiro carne/leche y fecha probable de parto en `health.service`, `repro.service` y `apps/mobile/SyncContext`). *Por qué sigue:* se resuelve en **F4** (servicios de dominio); F2 crea los VOs que F4 usará, evitando tocar los archivos dos veces.
2. **`sync.service` es un God object (581 líneas)** que escribe en todas las tablas vía un switch central. *Por qué:* se parte en handlers en **F6**.
3. **`dashboard.controller` con 22 SQL cross-domain**. *Por qué:* se extrae a service + proyección en **F7**.
4. **Sin Event Bus**: los efectos (alertas, timeline) están acoplados a los writes. *Por qué:* se para el bus en **F5**; migrar consumidores es post-sprint.
5. **Cobertura de tests no medida formalmente** (solo dominio + sync-core + golden). *Por qué:* F9 activa `--coverage`.
6. **`Idempotency-Key` REST es no-op** (solo el canal de sync deduplica de verdad). *Deuda de producto, documentada en README.*
7. **Fechas en UTC** (cálculos de retiro/parto); presentación por zona horaria del establecimiento pendiente.
8. **RBAC superficial**: el rol viaja en el token pero no restringe endpoints (ABAC/Cedar es futuro).
9. **Bootstrap de sync baja el tenant completo** (sin suscripciones parciales por finca).

---

## 8. Reglas permanentes del proyecto

Acordadas y **obligatorias**:
1. **No agregar funcionalidades nuevas antes de terminar el Foundation Hardening Sprint.**
2. **Una regla de negocio solo puede existir en un único lugar.** Si aparece duplicada, la fase no está terminada.
3. **`packages/domain` completamente puro**: sin NestJS, React, React Native, PGlite, PostgreSQL, Drizzle/Prisma, HTTP, `AsyncLocalStorage` ni ninguna infra. Corre solo con TypeScript (forzado por `tsconfig`).
4. **YAGNI**: no crear estructura, abstracciones (Result/Either/Option/fábricas), carpetas ni código vacío hasta que haya necesidad real. Si algo se difiere, documentarlo en un ADR.
5. **Un Value Object solo existe si aporta al menos una garantía**: validación, seguridad de tipos, comportamiento propio, inmutabilidad, o eliminación de duplicación. Si no, sigue primitivo.
6. **Cambios pequeños y revisables** (nunca un mega-commit). Historial limpio.
7. **Behavior-preserving durante el sprint**: cada cambio deja idénticas las respuestas de API, la convergencia de sync y la UI.
8. **El servidor es la fuente de verdad** (recompute en sync; corrige y deja traza sin afectar al usuario).
9. **`DomainError` se mantiene extremadamente simple**; cada nuevo error solo si aporta valor al dominio.
10. **VOs: no migrar consumidores hasta F4** (tocar cada archivo una sola vez).
11. **ADR para toda decisión de arquitectura importante.**
12. **Revisión al terminar cada sub-fase** antes de continuar.

---

## 9. Próximos pasos

> **Único siguiente paso recomendado:**

**Implementar F6 — Sync → `SyncHandler` registry.** `sync.service.ts` es hoy un God object (switch gigante por tabla en `applyEvent`/dispatch de ops) — partirlo en handlers co-ubicados con su módulo (herd → animal/weighing; health → treatment/vaccination; repro → breeding/pregnancy/calving), con un registry central que resuelve por tabla. Open/Closed: un módulo nuevo debe ser un handler nuevo, cero ediciones a `sync.service`.

**Punto de cuidado real (no presente antes de esta sesión):** T4.4 (F4) le agregó a `applyEvent` (rama `treatments`) y a `applyPregnancyPut` lógica de **Server Authority** — recompute con las funciones de dominio, comparación, y auditoría en `sync_conflicts` con `HlcClock` propio del servidor para el campo LWW. Al partir el switch en handlers, **esa lógica tiene que migrar completa a los handlers `treatments` y `pregnancies`** — no es solo mover el INSERT/UPDATE, es mover el recompute + el HLC del servidor + el registro de conflictos. Usar los tests E2E dirigidos que se corrieron para T4.4 (§3, F4) como referencia de qué comportamiento no debe cambiar al partir el switch.

Después de F6 → pausa de revisión → F5 (Event Bus + Outbox, fundación sin migrar consumidores).

---

## 10. Archivos importantes para leer primero (en orden)

1. **`README.md`** — cómo correr (api/web/mobile), endpoints, credenciales demo, limitaciones.
2. **`docs/domain-language.md`** — lenguaje ubicuo; la definición canónica de cada término del negocio.
3. **`docs/sprints/foundation-hardening-sprint.md`** — el plan del sprint en curso (objetivo, tareas, orden, riesgos, criterios de aceptación).
4. **Este handoff** (`docs/handoff/session-handoff-2026-07-10.md`).
5. **`docs/quality-baseline.md`** — números de partida y estrategia de métricas.
6. **`docs/golden/business-rules.md`** — comportamiento congelado de las reglas (retiro, gestación, dup-tag, convergencia). **Oráculo para no romper nada.**
7. **`docs/adr/`** — `README.md` + `0004-domain-package.md` + `0006-value-object-strategy.md` (checklist de 5 preguntas para admitir un VO/`DomainError` nuevo) + `0007-server-authority-derived-values.md` (Server Authority sobre valores derivados — **leer antes de tocar `sync.service.ts`**).
8. **`packages/domain/src/`** — `shared/brand.ts`, `shared/domain-error.ts`, `value-objects/*`, `health/withdrawal.ts`, `reproduction/gestation.ts`, `reproduction/newborn-category.ts` (el patrón companion + servicios de dominio a seguir en F5+).
9. **`packages/sync-core/src/`** — motor de sync (HLC, changesets, merge, sim, `HlcClock`). Setup de package puro a replicar.
10. **`apps/api/src/modules/sync/sync.service.ts`** — God object a partir en **F6**; contiene ahora la lógica de Server Authority (T4.4) que hay que preservar al partirlo en handlers. `apps/api/src/db/db.service.ts`, `db/query.ts`, `common/request-context.ts` (RLS + tx), `modules/dashboard/dashboard.controller.ts` (SQL a extraer en F7).
11. **Especificación del producto** (`.docx` en `docs/`): `Cowinance_Arquitectura`, `Cowinance_Roadmap`, `Cowinance_Catalogo_Modulos`, `Cowinance_Modelo_Datos`, `Cowinance_Design_System`, `Cowinance_APIs`, y los módulos.
12. **`packages/db/cowinance_schema.sql`** — DDL canónico de 140 tablas (fuente de verdad del modelo).

---

## 11. Estado de calidad

| Métrica | Baseline (F0) | Actual (2026-07-10) | Objetivo |
|---|---|---|---|
| **Tests** | 34 verdes | **102 verdes** (13 archivos) | crecer con cada fase |
| **Cobertura** | no medida | no medida formalmente (dominio bien cubierto) | dominio ≥ 90% (F9) |
| **Dependencias circulares** (madge) | **1** | **0** ✅ | 0 |
| **Duplicación semántica de reglas** | presente (retiro, gestación, categoría de cría en 2-3 lugares) | **eliminada** ✅ (F4: fuente única en `packages/domain`, servidor recomputa en sync) | 0 reglas duplicadas |
| **Build** | api/web/mobile/domain limpios | limpios ✅ (api, mobile, domain re-verificados en F4; web no tocado) | no-regresión |
| **Simulación de sync** | 2000/2000 (100%) | **2000/2000** ✅ | ≥99% |
| **E2E** | auth 15/15 · sync 19/19 | **15/15 · 19/19** ✅ (re-verificados tras T4.4, incluye verificación dirigida de Server Authority) | verde |

Comandos: `npm test` (Vitest) · `npm run build -w @cowinance/domain` · `cd apps/api && npx nest build` · `npx madge --extensions ts --circular apps/api/src` · `npm run sim -w @cowinance/sync-core` · `node apps/api/scripts/{auth,sync}-e2e.mjs` (requieren api corriendo).

---

## 12. Resumen final — "¿Qué necesita saber un arquitecto para no cometer errores?"

Cowinance es un ERP ganadero real, offline-first y multi-tenant, con el **alcance funcional de Fase 1 ya construido y funcionando**. **Hoy NO se agregan features**: estamos en un **Foundation Hardening Sprint** que mejora la arquitectura **sin cambiar comportamiento** (F0-F4 hechas, incluye Server Authority; sigue F6). La regla número uno: **behavior-preserving** — antes y después de cada cambio, la API, la convergencia de sync y la UI deben ser idénticas; el oráculo es `docs/golden/business-rules.md` + los gates (`sync-core` sim 2000/2000, `auth-e2e` 15/15, `sync-e2e` 19/19, builds limpios, madge 0 ciclos). Corré esos gates después de **cada** cambio.

El corazón de la deuda **ya se eliminó en F4**: retiro sanitario, gestación (dos modos) y categoría de cría al nacer vivían triplicados en `health.service`/`repro.service`/`SyncContext` móvil — ahora son funciones puras en `packages/domain` (`health/withdrawal.ts`, `reproduction/gestation.ts`, `reproduction/newborn-category.ts`), consumidas por los tres lugares. Y desde **T4.4/ADR-0007**, el servidor de sync **ya no confía ciegamente** en lo que calcula el cliente: recomputa y corrige (sin tolerancia) para los campos derivados de reglas — con un mecanismo distinto según si el dato es un evento inmutable o un campo LWW (para este último, la corrección del servidor participa del mismo `HlcClock` que los dispositivos, no es un `UPDATE` por fuera del mecanismo de sync). `classifyCategory` completo (edad+sexo+especie, catálogo configurable) **no se construyó**: no existía como comportamiento real, hubiera sido una feature nueva disfrazada de refactor — quedó en backlog de producto.

`packages/domain` es **sagrado: 100% puro**, sin ninguna dependencia de infraestructura (el `tsconfig` lo fuerza; si un import no compila, es a propósito). Aplicá **YAGNI** con rigor: nada de Result/Either, fábricas de errores, carpetas vacías ni abstracciones "por si acaso"; si diferís algo, escribí un ADR. **Ninguna abstracción de dominio (VO, `DomainError`, servicio, categoría de conflicto de sync) se crea sin demostrar antes qué problema real resuelve y por qué lo existente no alcanza** — regla confirmada tres veces en este sprint (`Breed` como VO en F2.4, el catálogo de errores en F3, `recompute_mismatch` como tipo de conflicto en T4.4) y ya generalizada más allá de los VOs. Antes de proponer cualquier abstracción nueva, investigá el estado real del código (no asumas duplicación ni necesidad — verificala).

Trampas operativas que ya nos costaron tiempo: **nunca** corras `nest build`/`next build` mientras el server en watch está vivo (corrompe `.next`/`dist` — pará, buildeá, reiniciá); PGlite tiene **una sola conexión** y transacciones delicadas, así que el refactor de sync (F6) debe conservar las fronteras de tx pasando el mismo handle `Q` **y preservar la lógica de Server Authority que T4.4 agregó a `applyEvent`/`applyPregnancyPut`** al partirlos en handlers; y Metro/Expo es quisquilloso al linkear packages del workspace (replicá el setup de `sync-core`, ya usado también para `domain` desde F4.1). No hay CI ni remoto Git — **creá el remoto pronto** (todo vive local) y corré los gates a mano. Commits **chicos y revisables**, y **pausá para revisión al terminar cada sub-fase**. Si respetás esto, el proyecto avanza sin regresiones hacia el ERP de clase mundial que es el objetivo.

**Siguiente acción concreta:** implementar **F6 — Sync → SyncHandler registry** (§9).
