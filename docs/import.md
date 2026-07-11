# Importación / migración de datos (P2)

Infraestructura **transversal de migración de datos** del ERP (roadmap P2). No es un
"importador de Excel" puntual: es la base para importar, en distintos momentos, animales,
movimientos, inventarios, históricos y cualquier módulo futuro. Se construye como un
**vertical de animales con costuras limpias**, sin framework multi-entidad anticipado — el
registry/DSL genérico se extraerá cuando aparezca el segundo caso real (Interpretación B;
coherente con ADR-0004/0006 y la regla permanente 1).

Estado: **en curso**. Delivered hasta la ola **P-b**; el procesador (commit real) y la
genealogía (P-c/P-d) están pendientes — ver §"Fases".

## Arquitectura y fronteras

- **`ImportModule`** (`apps/api/src/modules/import/`) — bounded context coordinador. Parseo,
  mapping, persistencia de `import_batches`/`import_rows`, ciclo de vida, preview. **No**
  reimplementa reglas de dominio del animal.
- **`HerdModule`** — dueño de la regla del animal. `AnimalWriteService` expone la
  **persistencia estructural única** (`persistNewAnimal`) + la validación (`normalizeAndValidate`
  pura, `checkAgainstDb`), reutilizada por REST **y** por import (D1, fuente única — regla
  permanente 1). `ImportModule` importa `HerdModule` (arista unidireccional, sin ciclo).
- **Sync (`ADR-0016`)** — propagación incremental por pull a dispositivos ya bootstrapeados
  vía **changesets de origen servidor** (§Propagación).

## Modelo de datos

- **`import_batches`** — cabecera del job: `entity_type`, `source_filename`, `mapping` (jsonb),
  `reconcile_mode`, `status`, `phase`, contadores, `heartbeat_at`, timestamps. RLS forzada +
  **excepción de descubrimiento** `current_setting('app.job_scope',true)='import_worker'` (para
  el futuro procesador; ningún request fija ese GUC).
- **`import_rows`** — una fila por registro del archivo: `row_number`, `raw` (jsonb), `normalized`,
  `status` (`pending|created|skipped|invalid|error`), `skip_reason`, `errors`, `warnings`,
  `resulting_entity_id`, `processed_at`. RLS estándar por `app.tenant_id`.
- **FK compuesta multi-tenant** `import_rows(tenant_id, batch_id) → import_batches(tenant_id, id)`
  (+ `UNIQUE(tenant_id,id)`), **sin cascade**: impide estructuralmente asociar una fila a un batch
  de otro tenant, aun ante un bug de código (defensa que se enforce siempre, también en dev donde
  RLS no aplica — ver §Constraints).

## Ciclo de vida del batch

```
uploaded ──(PUT mapping)──▶ mapped ──(POST preview)──▶ previewed ──(commit, P-c)──▶ queued ──▶ processing ──▶ completed | completed_with_errors | failed
   ▲                                                       │
   └──────────────── re-map (PUT mapping) ◀────────────────┘
```
Hasta P-b el vertical llega a **`previewed`** (preparar + previsualizar). `commit`/`queued` y el
procesamiento en background son P-c.

## Endpoints y DTOs (`/v1`)

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/imports` | **multipart/form-data** — parte `file` (CSV, campo fijo) + `entity_type=animal`. `memoryStorage`, límites explícitos (5 MB, 1 archivo, `fieldNestingDepth`…), validación por `csv-parse` (no MIME), máx 5.000 filas. Crea batch+filas en **una tx**, estado `uploaded`, mapping sugerido. → `ImportBatchDto` |
| `GET` | `/imports/:id` | batch del tenant (404 si ajeno) |
| `GET` | `/imports/:id/rows?cursor=&limit=` | filas paginadas por cursor (`row_number`) |
| `PUT` | `/imports/:id/mapping` | reemplaza el mapping (campo canónico → encabezado); valida forma + obligatorios (`tag`/`sex`/`category_code`) → `mapped` |
| `POST` | `/imports/:id/preview` | validación por fila **sin escribir**; counts (total/valid/invalid/duplicate) + sample; `previewed` |

Errores con código de dominio (`import.file_required`, `import.empty_file`, `import.invalid_entity_type`,
`import.csv_parse_error`, `import.duplicate_headers`, `import.irregular_row`, `import.too_many_rows`,
`import.file_too_large` (413), `import.mapping_missing_required`, `import.invalid_mapping`, `import.batch_not_found`…).

## Mapping y validación

- **Descriptor de dominio** (`herd/animal-import-descriptor.ts`): campos canónicos + sinónimos de
  encabezado normalizados + obligatorios. Un único descriptor (animal); registry multi-entidad diferido.
- **Mapping sugerido** (`import/mapping.ts`, puro): `Partial<Record<AnimalImportField,string>>` — solo
  campos con coincidencia (no inventa); rechaza encabezados duplicados tras normalizar.
- **Filas irregulares** (`import/csv.ts`): más columnas que el encabezado → `import.irregular_row` (con
  nº de fila); menos → fila conservada con faltantes ausentes. Ningún valor se pierde en silencio.
- **Preview batch-context (sin N+1)**: por fila `normalizeAndValidate` (pura) → recolecta categorías/
  caravanas únicas → **`loadAnimalImportValidationContext`** de Herd (2 queries) → veredicto (incluye
  duplicado intra-archivo). La regla autoritativa sigue en `checkAgainstDb`; el commit revalida.

## Propagación server-origin (ADR-0016)

Una entidad creada **server-side** debe llegar por **pull** a dispositivos ya bootstrapeados, sin
dispositivo/secuencia sintéticos ni conflictos fabricados:

- `sync_changesets` admite `source='server'` con `sync_device_id`/`seq` **NULL**, dedup por
  `(tenant_id, origin_ref)`; el pull usa `IS DISTINCT FROM` (se entrega a todos).
- **`RemoteChangeset`** (sync-core, derivado de `Changeset` con identidad nullable) es el contrato de
  pull; el **móvil aplica** un server-origin por `ops`/`hlc`/`cursor` sin fabricar identidad (P-a).
- **`persistNewAnimal(sync='server_origin')`** versiona los campos con `HlcClock('server')` (actor de
  ADR-0007) en `sync_row_state` y devuelve el `syncOp`; **`ServerOriginChangesetWriter.emit`** escribe
  la fila `source='server'`. Sin `sync_conflicts` (es creación).
- **`REST createAnimal`** emite server-origin (`origin_ref='rest:animal:<id>'`): las **altas web** ahora
  se propagan por pull a devices (brecha cerrada). El procesador de import (P-c) reutilizará el mismo
  mecanismo por lote.

## Fases (olas) y estado

| Ola | Contenido | Estado |
|---|---|---|
| 1 | `AnimalWriteService` neutral (D1): REST como adaptador; `normalizeAndValidate`/`checkAgainstDb`/`persistNewAnimal` | ✅ |
| 2.1–2.4 | ADR-0016; DDL `sync_changesets` server-origin; contrato de pull nullable; tablas+RLS de import | ✅ |
| 3.1–3.5 | csv-parse; descriptor; mapping sugerido; upload multipart; GET batch/rows; PUT mapping; preview | ✅ |
| P-a | Apply server-origin en el cliente (`RemoteChangeset` + móvil) | ✅ |
| P-b | Emisión server-origin (proyección HLC + writer) + REST createAnimal la dispara | ✅ |
| **P-c** | `commit` → **procesador** en background (chunks, creación real, contadores, recuperación) | ⏳ pendiente |
| **P-d** | Genealogía (2ª pasada: dam/sire por caravana, sexo/ciclo/autoref) | ⏳ pendiente |

## Constraints y decisiones registradas

- **RLS en dev**: PGlite conecta como superusuario → **RLS no se enforce en dev** (es garantía de
  producción). El aislamiento en dev proviene de los `WHERE tenant_id` explícitos + la **FK compuesta**
  (que sí se enforce siempre). La lógica de las políticas se prueba bajo rol no-super.
- **Semántica de tx por chunk (P-c)**: un error SQL aborta el chunk entero; validar antes de persistir
  (→ `invalid`/`skipped` sin lanzar SQL); un fallo inesperado **revierte el chunk** (reintentable). Sin
  savepoints por defecto.
- **Reconciliación**: solo **crear-y-saltar duplicados** (upsert fuera de alcance).
- **Seguridad de carga**: `memoryStorage` (sin temporales ni persistir bytes), límites de Multer,
  contenido validado por `csv-parse`; Multer 2.2.0 (fix de advisories de DoS).
- **Sin Event Bus** (ADR-0005: no se emite un evento de dominio sin consumidor).

## Verificación (E2E, `apps/api/scripts/`)

- `import-e2e.mjs` — upload multipart, errores por código, GET batch/rows paginadas, PUT mapping,
  preview con counts, multi-tenant (404 cross-tenant).
- `server-origin-e2e.mjs` — alta web → device pull recibe el animal (device_id/seq null), cero conflictos.
- `sync-e2e.mjs`, `auth-e2e.mjs`, `animals-e2e.mjs`, sim de convergencia 2000/2000 — sin regresión.
