# P2 — Importación masiva de animales · Cierre de sprint

**Estado:** ✅ COMPLETO · **Rama:** `main` · **Commit de cierre:** `545101e`
**Alcance:** importación de animales por CSV, end-to-end (backend + procesador + propagación por sync + UI web).

> Registro histórico del sprint. Para la documentación funcional del módulo (endpoints,
> flujo, comportamiento) ver [`docs/import.md`](../import.md). Para el contrato de propagación
> server-origin ver [`docs/adr/0016-server-origin-changesets.md`](../adr/0016-server-origin-changesets.md).

---

## 1. Objetivo

Permitir que un productor cargue su hato existente desde un archivo CSV, sin altas manuales una por una: subir el archivo, mapear sus columnas a los campos del animal, previsualizar qué se creará/omitirá/rechazará, confirmar, y obtener un reporte por fila del resultado — con los animales creados propagándose a los dispositivos móviles por el mecanismo de sincronización existente.

Restricción rectora: construir un **vertical animals-only** con costuras limpias, sin introducir un framework de importación multi-entidad prematuro (ADR-0004/0006 · YAGNI · “una regla de negocio en un solo lugar”).

## 2. Alcance implementado

- Carga multipart de CSV (`POST /imports`) con límites de defensa (5 MB, 5000 filas, un archivo), parseo por parser (no por MIME) y detección de filas irregulares sin pérdida silenciosa.
- Mapeo editable de columnas → campos del descriptor, con sugerencia automática por sinónimos.
- Previsualización sin efectos: conteos exactos (válidas/inválidas/duplicadas) + muestra por fila, reutilizando la validación de dominio.
- Confirmación (`POST /imports/:id/commit`) que encola el batch; **procesamiento asíncrono** fuera del request.
- Creación real de animales por la **persistencia neutral** compartida con el alta REST, con `create/skip-duplicates` como modo de reconciliación.
- **Genealogía básica**: vínculo de madre/padre por caravana (intra-import y contra la base), con detección de ciclos.
- **Propagación**: cada animal creado emite un changeset de origen servidor que los dispositivos reciben por pull, sin conflictos.
- **UI web** (`/animales/importar`): asistente de 5 pasos sobre los endpoints existentes, con reporte por fila y descarga CSV.

## 3. Arquitectura final

Flujo de datos (una sola dirección, con el `batchId` como eje de estado):

```
Upload → Mapping → Preview → Commit → [cola] → Processor (async) → server-origin changeset → Pull a dispositivos
  UI  →   UI    →   UI     →  UI    →         →   create-pass + link-pass                  →  (sync-core)
```

- **Upload.** `POST /imports` parsea el CSV en memoria (el buffer se descarta), aplica el mapping sugerido y persiste `import_batches` + `import_rows` en una transacción. Estado inicial `uploaded`.
- **Mapping.** `PUT /imports/:id/mapping` valida forma y obligatorios (`tag/sex/category_code`) → `mapped`. La UI obtiene el catálogo de campos del descriptor por un endpoint aditivo de solo lectura.
- **Preview.** `POST /imports/:id/preview` valida por fila con contexto batch (2 queries, sin N+1) y reporta conteos + muestra → `previewed`. Es una estimación; el commit revalida.
- **Commit.** `POST /imports/:id/commit` (guard `previewed`, transición atómica) encola el batch (`queued`) y responde de inmediato.
- **Processor.** Poller fuera del request. Reclama el batch en una transacción privilegiada aislada (RLS + `app.job_scope`), procesa en chunks: **create-pass** (valida antes de persistir; crea vía la persistencia neutral) y luego **link-pass** de genealogía. Contadores actualizados por **delta** de filas `pending → terminal` en la misma transacción. Sin estado `failed`: un error inesperado revierte el chunk y el batch se re-reclama por heartbeat vencido.
- **Server-origin.** La creación emite `sync_changesets` con `source='server'` (device/seq NULL, idempotencia por `(tenant_id, origin_ref)`), proyectando un HLC de servidor sobre `sync_row_state`. El pull usa `IS DISTINCT FROM` y los dispositivos aplican sin fabricar identidad (ADR-0016).
- **Genealogía.** `loadGenealogyContext` resuelve caravanas → id/sexo en una query; `detectCycles` recorre ancestros con una CTE recursiva por chunk (profundidad defensiva 32, sin repetir nodos); `applyGenealogyLink` es diff-aware (solo escribe/propaga lo que cambia).
- **UI.** Asistente cliente (`ImportWizard`) con estado local por paso; cada paso es un componente (`UploadStep`, `MappingStep`, `PreviewStep`, `ConfirmStep`, `ResultStep`). Progreso por polling de contadores; reporte por-fila paginado por cursor; descarga CSV client-side.

## 4. Decisiones arquitectónicas importantes

| Decisión | Motivo |
|---|---|
| **D1 — persistencia neutral** (`AnimalWriteService.persistNewAnimal`) reusada por REST e import | Una sola implementación de la regla de alta; el importador no duplica lógica de dominio. |
| **Procesador fuera del request** | El commit responde inmediato; la creación masiva no bloquea HTTP ni arriesga timeouts. |
| **Transacción por chunk + contadores por delta** | Aislar fallos a un chunk (reintentable) y evitar doble conteo en recuperación; validar antes de persistir evita `throw` por filas inválidas. |
| **Server-origin changesets (ADR-0016)** | Propagar altas hechas por el servidor sin fabricar identidad de dispositivo ni debilitar el contrato de push. |
| **`create/skip-duplicates`** | Semántica de importación segura por defecto: nunca sobreescribe animales activos existentes. |
| **Link-pass separada de la create-pass** | La genealogía necesita que todas las filas del import existan antes de vincular (referencias intra-import); resolución y ciclos en lote, no por vínculo. |
| **Endpoint aditivo `GET /imports/:entityType/fields`** | El catálogo de campos (label/obligatorio) vive solo en el descriptor; la UI lo consume en vez de duplicarlo. Read-only, no toca el procesador/Sync/genealogía. |
| **UI animals-only, sin hub multi-entidad** | Entrada desde el hato; no se promete una superficie multi-entidad inexistente. Componentes específicos locales a la ruta (sin promover `Table`/`Stepper` al design system con un solo consumidor). |

## 5. Criterios de aceptación cumplidos

- ✅ Importar un archivo de ~500 filas.
- ✅ Filas inválidas reportadas por fila con su motivo (sexo, categoría, obligatorios).
- ✅ Duplicados detectados (caravana activa existente y duplicado intra-archivo) y omitidos.
- ✅ Genealogía básica vinculada (madre/padre por caravana) con detección de ciclos.
- ✅ Animales creados propagados a dispositivos por pull, sin conflictos.
- ✅ UI completa: subir → mapear → previsualizar → confirmar → progreso → reporte por fila → descarga CSV → enlace al animal creado.

## 6. Métricas finales

| Gate | Resultado |
|---|---|
| Vitest (`audit:arch`) | **175 tests** en verde |
| Ciclos de dependencia (madge) | **0** |
| Playwright E2E (web) | **6/6** (incl. `06-import-animals`) |
| Simulación Sync (`sync-core`) | **2000/2000 (100%)** |
| E2E de API | auth · animals · sync · server-origin · import — todos OK |
| Architecture gates | invariantes intactos |

## 7. Decisiones diferidas y trabajo futuro

Diferidas de forma consciente (no son deuda oculta):

- **`phase` no expuesto** en `GET /imports/:id`: el progreso muestra “Procesando…” genérico. Mejora aditiva opcional (exponer `phase` en el DTO de lectura) para distinguir create-pass de link-pass.
- **Sin estado terminal `failed`** para import: ante error inesperado el batch queda `processing` y se re-reclama por heartbeat. La UI lo trata con paciencia; falta un camino de “fallo definitivo” con `attempt_count`.
- **Export del reporte client-side**: para volúmenes muy grandes convendría un export server-side (streaming), fuera de alcance de P2.
- **Multi-entidad, edición de filas en la UI y plantillas de mapeo guardadas**: no incluidas.
- **RLS solo se enforce en producción** (en dev, PGlite conecta como superusuario); la FK compuesta multi-tenant protege siempre. Las políticas se probaron bajo un rol no-superusuario.
- **Artefacto de desarrollo**: el cookie de acceso web caduca con `expires_in`; una sesión vieja hace rebotar el middleware a `/` a mitad de flujo. No afecta producción.

## 8. Estado del roadmap

**P2 → COMPLETO.** El importador de animales está terminado, verificado y estable en `main`.

**Siguiente fase: P3 (por definir).** No se inicia ninguna implementación nueva hasta acordar el alcance. Candidatos naturales: retomar el backlog del *Foundation Hardening Sprint* (domain package, value objects, domain errors, event bus, ADRs, métricas) o el siguiente módulo del hato. La entrada a P3 seguirá el mismo método: análisis previo aprobado antes de código, olas pequeñas y revisables, verificación completa y un commit por ola.
