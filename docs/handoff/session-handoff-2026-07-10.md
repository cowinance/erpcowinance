# Cowinance — Handoff de sesión

**Fecha:** 2026-07-10
**Para:** el próximo Lead Engineer que continúe el desarrollo
**Propósito:** retomar el proyecto sin pérdida de contexto. Este documento es la referencia principal.

---

## 1. Estado actual del proyecto

### Resumen ejecutivo
Cowinance es una **plataforma ERP para ganadería, agricultura y administración de fincas**, offline-first y multi-tenant, especificada en 14 documentos (`docs/*.docx`). El **alcance funcional ganadero de la Fase 1 del producto está completo y verificado** (Hato, Sanidad, Reproducción, Producción/manga, Mapa de potreros, Reportes, Alertas, Fotos, Planes sanitarios, Vademécum), sobre 3 apps (`api` NestJS, `web` Next.js, `mobile` Expo) + 2 packages (`sync-core`, `domain`). En este momento el proyecto está **pausado en features** y en curso de un **Foundation Hardening Sprint** (mejora de arquitectura sin cambiar comportamiento). Vamos por **F2.4 completada** (VO `Sex`; `Breed` evaluado y descartado, ADR-0006); el siguiente paso es **F3 (Domain Errors + `DomainExceptionFilter`)**.

### Estado general del repositorio
- **Working tree:** limpio (solo `.claude/settings.local.json` sin trackear/ignorar; irrelevante).
- **Remoto:** **no hay** remoto configurado. `gh` CLI **no está instalado**. Todo está en git local.
- **Monorepo:** npm workspaces — `apps/api`, `apps/web`, `apps/mobile`, `packages/db`, `packages/sync-core`, `packages/domain`.

### Rama actual
`main` (siempre se trabaja acá; los commits son pequeños y directos).

### Último commit
`feat(domain): Value Object Sex — sexo del animal (F2.4)` (ver git log; commits F2.3 `Weight` y F2.4 `Sex` posteriores a `12897d0`)

### Estado de compilación
- `nest build` (api) — **limpio**.
- `next build` (web) — **limpio** (última verificación 15 páginas).
- `tsc` (mobile) — **limpio**.
- `tsc` (packages/domain, puro) — **limpio**.

### Estado de las pruebas
- **76 tests verdes**, 9 archivos (Vitest). Incluye `sync-core` (HLC/merge/convergencia), golden de reglas de negocio, y VOs de dominio (Brand, ids, TagNumber, Weight, Sex).
- **Suite de convergencia de sync:** 2000/2000 (100%).
- **E2E HTTP:** auth 15/15, sync 19/19 (requieren la api corriendo).

### Estado del sprint actual
**Foundation Hardening Sprint** en curso. Completadas: **F0, F1, F2.1, F2.2, F2.3, F2.4**. Siguiente: **F3**. Ver §5.

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

### ADR existentes
- `docs/adr/README.md` — índice y proceso.
- `docs/adr/0004-domain-package.md` — **aceptado**. Paquete de dominio puro + política YAGNI de carpetas.
- `docs/adr/0006-value-object-strategy.md` — **aceptado**. Checklist de 5 preguntas para admitir un VO; `Breed` descartado (ya es entidad de catálogo), `Sex` aceptado.
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

---

## 4. Trabajo pendiente (por prioridad)

### Sprint actual (Foundation Hardening) — lo inmediato
1. **F3** Domain Errors + `DomainExceptionFilter` ← siguiente paso (ver §9).
2. **F4** Servicios de dominio (elimina la duplicación de reglas) + adopción de VOs en consumidores.
3. **F6** Sync → SyncHandler registry.
4. **F5** Event Bus + Outbox.
7. **F7** Dashboard → service + costura de proyección.
8. **F8** ADRs restantes.
9. **F9** Métricas de calidad (formalizar tooling + `npm run audit:arch`).

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
| **F2.4** | VO `Sex`; `Breed` evaluado y descartado (ADR-0006) | ✅ Completado ← **siguiente: F3** |
| **F3** | Domain Errors + `DomainExceptionFilter` (mapea a HTTP actual) | ⏳ Pendiente |
| **F4** | Servicios de dominio (retiro/gestación/categoría) + adopción de VOs + recompute en sync | ⏳ Pendiente |
| **F5** | Event Bus (EventEmitter2) + Outbox (instalar, no migrar consumidores) | ⏳ Pendiente |
| **F6** | Sync → `SyncHandler` registry (elimina el switch de `sync.service`) | ⏳ Pendiente |
| **F7** | Dashboard → `dashboard.service` + costura de proyección | ⏳ Pendiente |
| **F8** | ADRs 0001-0003, 0005 (+ 0006, 0007) | ⏳ Pendiente (0004 ya escrito) |
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

**Implementar F3 — Domain Errors + `DomainExceptionFilter`**, en `packages/domain/src/shared/` (jerarquía de errores) y `apps/api/src/common/domain-exception.filter.ts` (mapeo a la respuesta HTTP RFC 9457 **actual**, sin cambiarla).

Alcance (T3.1/T3.2 del sprint):
- `DomainError` base ya existe (F2.1, mínima). Agregar los errores específicos que F4 va a necesitar: `DuplicateTag`, `InvalidPregnancy`, `AnimalAlreadyExists`, `TreatmentExpired`, `InvalidMovement` (y los que surjan al escribir los servicios de dominio de F4) — **cada uno solo si F4 lo va a usar de inmediato** (YAGNI; no adelantar errores sin consumidor, mismo criterio que ADR-0006 aplicado a errores).
- `DomainExceptionFilter`: filtro NestJS que atrapa `DomainError` y lo mapea a la misma forma HTTP que hoy producen los `BadRequestException`/similares — **behavior-preserving**, se verifica con diff de respuesta antes/después.
- Sin migrar todavía los `throw new BadRequestException(...)` existentes a `DomainError` (eso ocurre en F4, junto con la extracción de los servicios de dominio que los usan).

Antes de escribir cualquier error nuevo, releer la Regla Permanente 9 (`DomainError` extremadamente simple) y confirmar con Jose si algún error propuesto necesita ese mismo criterio explícito que se aplicó a los VOs en F2.4.

Después de F3 → pausa de revisión → F4 (el núcleo del sprint: elimina la triplicación de reglas).

---

## 10. Archivos importantes para leer primero (en orden)

1. **`README.md`** — cómo correr (api/web/mobile), endpoints, credenciales demo, limitaciones.
2. **`docs/domain-language.md`** — lenguaje ubicuo; la definición canónica de cada término del negocio.
3. **`docs/sprints/foundation-hardening-sprint.md`** — el plan del sprint en curso (objetivo, tareas, orden, riesgos, criterios de aceptación).
4. **Este handoff** (`docs/handoff/session-handoff-2026-07-10.md`).
5. **`docs/quality-baseline.md`** — números de partida y estrategia de métricas.
6. **`docs/golden/business-rules.md`** — comportamiento congelado de las reglas (retiro, gestación, dup-tag, convergencia). **Oráculo para no romper nada.**
7. **`docs/adr/`** — `README.md` + `0004-domain-package.md` + `0006-value-object-strategy.md` (checklist de 5 preguntas para admitir un VO nuevo — **leer antes de proponer cualquier VO**).
8. **`packages/domain/src/`** — `shared/brand.ts`, `shared/domain-error.ts`, `value-objects/identifier.ts`, `value-objects/ids.ts`, `value-objects/tag-number.ts`, `value-objects/weight.ts`, `value-objects/sex.ts` (el patrón companion a seguir en F3+).
9. **`packages/sync-core/src/`** — motor de sync (HLC, changesets, merge, sim). Setup de package puro a replicar.
10. **`apps/api/src/`** — `db/db.service.ts`, `db/query.ts`, `common/request-context.ts` (RLS + tx), `modules/sync/sync.service.ts` (God object a partir en F6), `modules/dashboard/dashboard.controller.ts` (SQL a extraer en F7).
11. **Especificación del producto** (`.docx` en `docs/`): `Cowinance_Arquitectura`, `Cowinance_Roadmap`, `Cowinance_Catalogo_Modulos`, `Cowinance_Modelo_Datos`, `Cowinance_Design_System`, `Cowinance_APIs`, y los módulos.
12. **`packages/db/cowinance_schema.sql`** — DDL canónico de 140 tablas (fuente de verdad del modelo).

---

## 11. Estado de calidad

| Métrica | Baseline (F0) | Actual (2026-07-10) | Objetivo |
|---|---|---|---|
| **Tests** | 34 verdes | **76 verdes** (9 archivos) | crecer con cada fase |
| **Cobertura** | no medida | no medida formalmente (dominio bien cubierto) | dominio ≥ 90% (F9) |
| **Dependencias circulares** (madge) | **1** | **0** ✅ | 0 |
| **Duplicación** (jscpd) | 0.89% sintáctica | ~igual; duplicación **semántica** de reglas **aún presente** | ≤1% y **0 reglas duplicadas** (F4) |
| **Build** | api/web/mobile/domain limpios | limpios ✅ | no-regresión |
| **Simulación de sync** | 2000/2000 (100%) | **2000/2000** ✅ | ≥99% |
| **E2E** | auth 15/15 · sync 19/19 | **15/15 · 19/19** ✅ | verde |

Comandos: `npm test` (Vitest) · `npm run build -w @cowinance/domain` · `cd apps/api && npx nest build` · `npx madge --extensions ts --circular apps/api/src` · `npm run sim -w @cowinance/sync-core` · `node apps/api/scripts/{auth,sync}-e2e.mjs` (requieren api corriendo).

---

## 12. Resumen final — "¿Qué necesita saber un arquitecto para no cometer errores?"

Cowinance es un ERP ganadero real, offline-first y multi-tenant, con el **alcance funcional de Fase 1 ya construido y funcionando**. **Hoy NO se agregan features**: estamos en un **Foundation Hardening Sprint** que mejora la arquitectura **sin cambiar comportamiento** (F0-F2.4 hechas; sigue F3 Domain Errors). La regla número uno: **behavior-preserving** — antes y después de cada cambio, la API, la convergencia de sync y la UI deben ser idénticas; el oráculo es `docs/golden/business-rules.md` + los gates (`sync-core` sim 2000/2000, `auth-e2e` 15/15, `sync-e2e` 19/19, builds limpios, madge 0 ciclos). Corré esos gates después de **cada** cambio.

El corazón de la deuda es **una misma regla de negocio escrita en 3 lugares** (retiro sanitario y fecha de parto, en `health.service`, `repro.service` y el `SyncContext` móvil). No la "arregles" ad-hoc: **se elimina en F4** creando servicios de dominio puros en `packages/domain`, y por eso **no migramos consumidores todavía** (Opción B) — así cada archivo se toca una sola vez. `packages/domain` es **sagrado: 100% puro**, sin ninguna dependencia de infraestructura (el `tsconfig` lo fuerza; si un import no compila, es a propósito). Aplicá **YAGNI** con rigor: nada de Result/Either, fábricas de errores, carpetas vacías ni abstracciones "por si acaso"; si diferís algo, escribí un ADR. Un **Value Object** solo existe si aporta validación, type-safety, comportamiento, inmutabilidad o elimina duplicación — y desde F2.4 (**ADR-0006**) esto se verifica con un checklist explícito de 5 preguntas **antes** de escribir código; no asumas que un concepto del lenguaje ubicuo necesita VO solo porque está en la lista (`Breed` es el caso de estudio: ya era una entidad de catálogo, no un VO).

Trampas operativas que ya nos costaron tiempo: **nunca** corras `nest build`/`next build` mientras el server en watch está vivo (corrompe `.next`/`dist` — pará, buildeá, reiniciá); PGlite tiene **una sola conexión** y transacciones delicadas, así que el refactor de sync (F6) debe conservar las fronteras de tx pasando el mismo handle `Q`; y Metro/Expo es quisquilloso al linkear packages del workspace (replicá el setup de `sync-core`). No hay CI ni remoto Git — **creá el remoto pronto** (todo vive local) y corré los gates a mano. El servidor es la fuente de verdad en sync. Commits **chicos y revisables**, y **pausá para revisión al terminar cada sub-fase**. Si respetás esto, el proyecto avanza sin regresiones hacia el ERP de clase mundial que es el objetivo.

**Siguiente acción concreta:** implementar **F3 — Domain Errors + `DomainExceptionFilter`** (§9).
