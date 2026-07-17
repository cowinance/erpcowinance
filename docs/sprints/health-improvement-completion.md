# Mejora integral de Sanidad — cierre por etapas

Convertir Sanidad de un módulo de **captura rápida** a un **centro operativo** (registrar,
prevenir, controlar y analizar) sin romper los flujos actuales ni duplicar lógica. El estándar
de robustez es `MortalityService` (regla única neutral, idempotente, atómica, con timeline y
sincronización), y el objetivo es llevar tratamientos, vacunaciones y diagnósticos a ese nivel.

## Plan por etapas (prioridades del usuario)

1. **Núcleo robusto de tratamientos + vacunaciones** — servicios neutrales idempotentes. ✅
2. Casos clínicos + diagnósticos estructurados.
3. UI de control (no solo captura).
4. Aplicación masiva (lote/categoría/selección/hato).
5. Inventario de medicamentos + costos.
6. Hospital / cuarentena integrados con lotes.
7. Reportes + alertas sanitarias.

---

## Etapa 1 — Núcleo robusto de tratamientos y vacunaciones ✅

**Punto de partida (deuda):** `treat()`/`vaccinate()` eran inline en `health.service.ts`, **sin
idempotencia**, **sin validar que el animal esté activo** (`requireAnimal` devolvía muertos/
vendidos), sin setear `diagnosis_id` (la columna existía). El `TreatmentSyncHandler` **duplicaba**
`computeWithdrawal` y **ninguno de los dos handlers de sync escribía timeline** — los tratamientos/
vacunas capturados offline no aparecían en la línea de tiempo del animal.

**Qué se construyó (patrón `MortalityService`):**

- **Regla pura de dominio** (`packages/domain/src/health/application.ts`): `assertTreatable(status)`
  + `HealthApplicationError` — no se aplica un producto veterinario a un animal que no esté ACTIVO
  (muerto/vendido/inactivo → error de negocio). Reutilizada por REST y sync.
- **`TreatmentService` neutral** (`recordTreatment(q, input)`): idempotente por `treatmentId`
  (= id de la fila; `op.rowId` en sync), en UNA tx escribe (1) la fila `treatments` con el retiro
  **derivado por dominio** (Server Authority, ADR-0007), (2) un evento `treatment` de timeline en
  `animal_events`, (3) el evento de dominio `TreatmentApplied` en `event_outbox` (con `q` explícito,
  mismo criterio que los writers de sync — no depende del enrutado por ALS del puerto). Setea
  `diagnosis_id`. Expone `withdrawalMismatch` (cliente vs servidor) para que el canal lo registre.
- **`VaccinationService` neutral** (`recordVaccination(q, input)`): idempotente por `vaccinationId`,
  valida animal activo + producto de tipo vacuna, en UNA tx escribe la fila `vaccinations` (próximo
  refuerzo, lote del frasco, plan opcional) **y el timeline** (antes el sync no lo escribía).
- **REST** (`health.service.ts`): `treat()`/`vaccinate()` pasan a ser adaptadores delgados sobre los
  núcleos, envueltos en `db.tx`, con **`Idempotency-Key`** (header). La vacunación de lote deriva un
  id determinista por (key, animal) → reintentar la request no duplica ninguna fila. Errores de
  dominio/lookup mapeados a HTTP (409 no-activo, 404 no-encontrado, 400 tipo-incorrecto).
- **Sync** (`treatment-sync.handler`, `vaccination-sync.handler`): dejan de reimplementar la regla;
  mapean la intención `event` a los núcleos (origin='sync'). El desajuste de retiro → conflicto
  semántico auto-resuelto; los rechazos de dominio → conflicto sin persistencia parcial. Ambos ahora
  escriben timeline por el mismo núcleo.

**Criterios técnicos respetados:** una sola regla por canal; transacción en toda escritura múltiple;
timeline en `animal_events`; retiro recalculado en el servidor como fuente de verdad; idempotencia en
acciones críticas; validación de tenant/animal-activo/producto. Sin tablas nuevas ni fix RLS.

**Tests (10 nuevos):** `treatment.service.integration` (fila+retiro+timeline+outbox; idempotencia;
animal muerto; producto inexistente; Server Authority del retiro) y `vaccination.service.integration`
(fila+timeline; idempotencia; producto que no es vacuna; animal muerto; **REST masivo idempotente por
Idempotency-Key**). Los tests de mortalidad siguen verdes (no se tocó su regla).

**Métricas:** **686 tests** (676 → +10), 0 ciclos de dependencia (madge). Verificado en web: POST
`/vaccinations` y POST `/treatments` → 201; la página de Sanidad (KPIs, retiros) sigue operativa.

---

## Etapa 2 — Casos clínicos + diagnósticos estructurados ✅

**Esquema (tablas/columnas nuevas + RLS):**
- `clinical_cases` (animal, diagnóstico, estado, severidad, inicio, cierre, resultado, notas) y
  `clinical_case_events` (timeline del caso: apertura, notas, cambios de estado, cierre). Ambas en
  `RLS_TABLES`.
- `clinical_case_id` agregado a `treatments` y `health_events` (vinculan al caso sin duplicar el caso
  en cada fila).

**Máquina de estados (regla pura, `packages/domain/src/health/clinical-case.ts`):** estados
`open / in_treatment / observation / recovered / referred / died / closed`; `closed` terminal,
`died` sólo cierra; `assertCaseTransition` valida las transiciones; `assertCaseStatus/Severity/Outcome`
validan contra el catálogo. `OPEN_CASE_STATUSES` define «caso abierto» para KPIs.

**`ClinicalCaseService`:**
- `create` (idempotente por `Idempotency-Key`) → fila + evento `opened` + timeline del animal.
- `list` con filtros (estado open/all/específico, animal, lote, diagnóstico); expone diagnóstico +
  categoría + `is_notifiable` + lote + conteo de tratamientos.
- `get` → cabecera + **timeline COMPUESTO** (eventos del caso + `treatments` y `health_events` que
  apuntan al caso, sin duplicar).
- `addFollowUp` (nota y/o cambio de estado, valida la transición → 409 si es inválida).
- `close` (transición a `closed` + `outcome` + `closed_at`).

**Diagnósticos estructurados en los flujos existentes:**
- `treat()` vincula `clinical_case_id`; `TreatmentService` persiste la FK.
- `healthEvent()` ahora setea `diagnosis_id` (antes lo ignoraba) y `clinical_case_id`.
- `mortality()` + `MortalityService` setean `cause_diagnosis_id` (antes lo ignoraban).
- Todos validan que el diagnóstico pertenezca al catálogo (global o del tenant).
- **Seed de catálogo base** (`bootstrapCatalogs`): 12 diagnósticos globales (`tenant_id NULL`), 4
  marcados notificables (Brucelosis, Carbunclo, Tuberculosis, Fiebre aftosa — denuncia SENASA).

**Web:** selector de diagnóstico (con categoría + «⚠ notificable») en las capturas de Tratamiento /
Diagnóstico / Mortalidad; panel **Casos clínicos** (`ClinicalCasesPanel`) con filtro (abiertos/todos/
cerrados), alta de caso, lista con badge de estado, y detalle con timeline compuesto + seguimientos +
cambio de estado + cierre. (La UI de control completa es la Etapa 3.)

**Tests (9 nuevos):** dominio de la máquina de estados (4) + `ClinicalCaseService.integration` (ciclo
de vida, transición inválida → 409, idempotencia, diagnóstico en mortalidad). **695 tests** (686 → +9),
0 ciclos. Verificado en web: catálogo de 12 diagnósticos en el selector; caso creado → seguimiento →
transición `in_treatment` → timeline `[opened, status_change]` end-to-end.

### Siguiente
**Etapa 3 — UI de control**: panel sanitario con KPIs ampliados, animales críticos, vista por lote,
accesos rápidos, y vistas con búsqueda/filtros (no solo captura).
