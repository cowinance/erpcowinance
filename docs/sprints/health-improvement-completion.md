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

---

## Etapa 3 — UI de control (panel sanitario) ✅

De "solo captura" a centro de control. Sin tablas nuevas: son vistas derivadas sobre lo existente.

**Backend (`health.service`):**
- `kpis()` ampliado: agrega `clinical_cases_open` (casos en open/in_treatment/observation) y
  `vaccinations_overdue`. **Regla única de "vacuna vencida"** (`OVERDUE_VACC_WHERE`): `next_due_date`
  en el pasado SIN una dosis posterior del mismo producto (una dosis repetida ya la renovó) — reusada
  por KPI, animales críticos y sanidad por lote.
- `GET /health/critical-animals`: un renglón por animal activo con al menos un motivo (caso abierto /
  retiro activo / vacuna vencida), con flags, severidad/diagnóstico del caso y un **puntaje** para
  ordenar por urgencia (severe 5 / moderate 3 / mild 2 + retiro 2 + vacuna vencida 1).
- `GET /health/by-lot`: agrega por lote casos abiertos, en tratamiento (30 d), retiros activos, vacunas
  vencidas y muertes (90 d), con `problem_score` para rankear los lotes más comprometidos.

**Web (`/sanidad`):**
- **6 KPIs**: cobertura, casos abiertos, en tratamiento, retiros, vacunas vencidas (+ próximas 45 d),
  mortalidad.
- **`ControlPanel`** (client): accesos rápidos (Vacunar / Tratar / Diagnosticar / Registrar muerte /
  Aplicar plan / Ver retiros) que enfocan la captura en la pestaña correcta (evento desacoplado
  `sanidad:capture` que escucha `SanidadCapture`) o hacen scroll a la sección; **Animales críticos**
  con búsqueda (caravana/lote/diagnóstico) y badges de motivo; **Sanidad por lote** rankeada.

**Tests (4 nuevos):** `health-control.integration` — KPIs ampliados, animales críticos (motivos +
puntaje + orden), vacuna renovada que NO cuenta como vencida, y agregado por lote rankeado. **699
tests** (695 → +4), 0 ciclos. Verificado en web: 6 KPIs; críticos 8 → filtro «Engorde» deja 4; sanidad
por lote rankea 3 lotes; acceso rápido «Tratar» cambia la captura a la pestaña Tratamiento.

---

## Etapa 4 — Aplicación masiva + cobertura ✅

Vacunar/tratar por objetivo, reusando los núcleos neutrales de la Etapa 1. Sin tablas nuevas.

**Backend (`health.service`):**
- `resolveTargetAnimals(body)`: traduce el objetivo (`all` / `lot` / `category` / `selection`) al conjunto
  de animales ACTIVOS (selección = ids dados, se validan por animal).
- `vaccinateMass` / `treatMass`: aplican la regla única por animal, idempotentes por
  (`Idempotency-Key`, animal). **Robustas**: un animal no apto (muerto/vendido) se **saltea con motivo**
  sin abortar el resto — el rechazo del dominio es un throw JS PREVIO a cualquier SQL, así la tx no se
  corrompe (los errores SQL inesperados sí abortan: `skipReason` los re-lanza). Producto validado
  fail-fast a nivel request (404/400). Resultado: `{resolved, applied, already, skipped, skipped_detail}`.
- `coverage(by, productId)`: cobertura de vacunación por lote o categoría (cabezas activas vs vacunados
  en 12 meses, opcionalmente de un producto), con porcentaje.
- Endpoints: `POST /vaccinations/bulk`, `POST /treatments/bulk`, `GET /health/coverage`.

**Web (`MassHealthPanel`):** toggle Vacunar/Tratar, objetivo (Todo el hato / Lote / Categoría) con
estimación de cabezas, producto y parámetros, **confirmación** («vas a vacunar ~N animales de …, los no
aptos se saltean») y resultado (aplicadas / ya estaban / salteadas). Tarjeta **Cobertura de vacunación**
(por lote/categoría, filtro por producto, barras coloreadas por umbral).

**Tests (6 nuevos):** `health-mass.integration` — masiva por lote e idempotencia por key; selección con
un muerto → salteado con motivo, resto aplicado; objetivo categoría; producto de tipo incorrecto →
400 fail-fast; selección vacía → 400; cobertura por lote. **705 tests** (699 → +6), 0 ciclos. Verificado
en web: masiva a «Engorde Otoño» 9/9 aplicadas, replay idempotente (0 nuevas / 9 ya), cobertura 100 %.

---

## Etapa 5 — Inventario de medicamentos + costos ✅

Conecta el vademécum con el inventario y calcula el costo real de cada aplicación.

**Esquema:** `cost numeric(16,2)` agregado a `vaccinations` (treatments ya lo tenía). Sin tablas nuevas.

**Backend (`health.service`, inyecta `InventoryService`):**
- Producto ↔ inventario: `createProduct`/`updateProduct` aceptan `inventory_item_id`; `products()`
  (vademécum) devuelve stock total, avg_cost, punto de reorden, vencimiento más próximo y banderas
  `is_low`/`is_expired`.
- **Descuento de stock al aplicar** (helper `chargeAndSetCost`): si el producto está enlazado, consume
  del ítem vía la regla única `InventoryService.recordMovementInTx` (`consumption`) en la MISMA tx, y
  fija el **costo real** = dosis × avg_cost del stock consumido, sobre la fila (salvo costo manual).
  Cableado en `treat`, `vaccinate`, `vaccinateMass`, `treatMass`. Solo por aplicación NUEVA (idempotente:
  la reaplicación no vuelve a consumir). **Stock insuficiente aborta la aplicación entera** (atómico,
  409 `inventory.insufficient_stock`). Depósito: el indicado, o el de más stock, o el primero.
- Reportes: `GET /health/costs?by=period|animal|lot` (tratamientos + vacunaciones), `GET
  /health/consumption` (consumo por producto desde los movimientos de sanidad), `GET
  /health/stock-alerts` (stock ≤ reorden o lote vencido/por vencer). `PUT /products-veterinary/:id`.

**Web:** vademécum con columna **Stock** + badges (bajo/vencido) y enlace a ítem en el alta;
`HealthCostsPanel` (costo sanitario por mes/lote/animal, consumo por producto, alertas de stock).
GOTCHA: los ítems de inventario se sirven en `/inventory/items` (controller `@Controller('inventory')`),
no en `/items`.

**Tests (7 nuevos):** `health-inventory.integration` — descuento + costo real, masiva descuenta por
aplicación, stock insuficiente aborta (atómico), consumo, costo por lote, alertas de reorden, vademécum
con stock. **712 tests** (705 → +7), 0 ciclos. Verificado en web: tratamiento dosis 4 → costo US$ 32
(4 × $8), stock 50 → 46, consumo «Oxitetra E5 4 un · US$ 32», costo por mes formateado.

---

## Etapa 6 — Hospital / cuarentena ✅

Integra sanidad con los lotes de propósito hospital/cuarentena, reusando la regla única de movimientos.

**Esquema:** tabla nueva `health_admissions` (animal, caso, tipo, lote origen, lote hospital, motivo,
fecha ingreso, alta estimada, estado sanitario, estado, alta, lote de alta) + RLS. El MOVIMIENTO en sí
vive en `animal_movements` (regla única); la tabla guarda el contexto clínico y el **lote de origen para
devolver** al animal en el alta.

**Dominio (`admission.ts`):** `resolveAdmissionKind(lotPurpose, kind?)` — el tipo debe coincidir con el
propósito del lote (hospital↔hospital, cuarentena↔cuarentena); si no viene, se infiere del propósito.

**`HospitalizationService`** (inyecta `MovementService` de LandModule):
- `admit`: valida animal activo + lote admisible; captura `from_lot_id` = lote actual; **mueve el animal
  al lote hospital/cuarentena con `MovementService.recordMovement`** (NUNCA update directo); guarda la
  internación; timeline `admission`; si viene `case_id`, agrega un evento al caso. Idempotente por
  `Idempotency-Key`. Un animal no puede tener dos internaciones abiertas (409).
- `discharge`: mueve al `discharge_lot_id` o, por defecto, de vuelta al `from_lot_id`; marca la
  internación como dada de alta; timeline `discharge` + evento al caso. Idempotente (alta repetida = no-op).
- `list`: internaciones abiertas con días internado y bandera de alta vencida.
- Endpoints: `GET/POST /health/admissions`, `POST /health/admissions/:id/discharge`.

**Web:** `HospitalPanel` (internados con tipo/lote/días/alta estimada + ingreso con lote hospital/
cuarentena, motivo, alta estimada, estado + alta sanitaria «volver al lote anterior» o a otro lote); en
el detalle del caso clínico, acción **«Enviar a hospital / cuarentena»** que interna al animal del caso.
Seed: lotes **Hospital** y **Cuarentena** (vacíos) para que la función sea usable.

**Tests (12 nuevos):** dominio (4: tipo vs propósito) + `hospitalization.integration` (8: ingreso mueve
al hospital + fila en animal_movements, guarda origen, una internación abierta, lote no admisible, tipo
que no coincide, alta devuelve al origen, alta a lote destino, idempotencia, ingreso desde caso).
**724 tests** (712 → +12), 0 ciclos. Verificado en web: ingreso movió el animal al Hospital y el alta lo
devolvió a su lote de origen.

### Siguiente
**Etapa 7 — Reportes + alertas sanitarias**: incidencia por diagnóstico, mortalidad por causa/lote/
período, animales reincidentes, productos más usados, efectividad (recuperados vs abiertos/muertos),
export CSV, y alerta de mortalidad anormal por lote/período.
