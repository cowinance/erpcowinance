# Animales — mejora integral a «vista 360 del animal» (COMPLETO 6/6)

De un CRUD/listado con ficha básica a la **vista 360**: el registro maestro desde el que se
entiende y gestiona toda la vida del animal (productiva, sanitaria, reproductiva, genética,
comercial). Backend en el módulo `herd` (junto a Lotes). Reutiliza servicios existentes
(movimientos, estado, sanidad, reproducción, media, sync) sin duplicar lógica. **NUNCA** update
directo de `current_lot_id`/`current_paddock_id` (eso viaja por el servicio de movimientos).

## Etapas

### E1 — Listado avanzado + filtros + orden + paginación (`48e0022`)
`listAnimals` ampliado con filtros de sanidad/repro/calidad (potrero, raza, origen, con/sin
lote·foto·ID oficial, retiro activo, caso clínico abierto, preñadas, sin pesaje reciente),
**búsqueda por cualquier identificador** (RFID/oficial/tatuaje…) o nombre, y **orden
configurable** (caravana/alta/edad/peso/GDP/lote/categoría/estado) con **keyset genérico**:
`ANIMAL_SORTS` + COALESCE-sentinel según dirección → NULLs siempre al final, cursor `(sortval,id)`
para cualquier orden. Web `AnimalsBrowser` (cliente): panel de filtros, orden, «N cargados · hay
más», cargar-más por cursor, vista tabla/tarjetas.

### E2 — Edición completa (`5f86cb3`)
`updateAnimal` — regla y escritura únicas, diff-aware, en una tx: valida caravana duplicada,
categoría (mismo species), sexo↔categoría (`animal_categories.sex ∈ {F,M,any}`), sexo que no
rompa vínculos F/M vigentes, genealogía madre-hembra/padre-macho sin autorreferencia ni ciclo
(reusa `detectCycles`). Proyecta al sync (`projectAnimalUpdate`, LWW actor server, `hlc` como
discriminador de originRef) y deja evento `edit` con el resumen de cambios. **getAnimal FUERA de
la tx** (this.db dentro de db.tx cuelga la conexión única de PGlite). `PUT /animals/:id`. Web
`EditAnimalDialog` (madre/padre con AnimalPicker).

### E3 — Ficha 360 con secciones (`408d9f2`)
Pestañas que COMPONEN fuentes existentes: Resumen (timeline filtrable + curva + pesaje + fotos),
Sanidad, Reproducción, Movimientos, Genealogía. `herd.animalOverview` compone
treatments/vaccinations/clinical_cases + movimientos por animal (+ días en lote actual) +
producción (partos/leche) — lecturas directas, sin reimplementar reglas. `repro.animalStatus`
sirve el estado reproductivo de un vientre reusando la MISMA regla única `computeReproStatus`.

### E4 — Identificación avanzada + alta mejorada + razas (`bd2bbe0`)
Identificadores de todo tipo (visual/RFID/tatuaje/bolo/marca/biométrico/oficial): `addIdentifier`
(dedup activo por tipo = namespace, oficial único), `retireIdentifier` (retired_at → historial,
libera el valor), `makeOfficialIdentifier`. Las lecturas de visual activo filtran `retired_at IS
NULL`. Alta mejorada: `createAnimal` acepta origen (→ evento birth/purchase/transfer),
RFID/oficial/madre/padre/razas/color/notas/adquisición. Razas: `setBreeds`. **GOTCHA: importar el
tipo `Q` en herd.service** — vitest (esbuild) lo borra sin chequear pero `tsc`/nest-build falla.

### E5 — Ciclo de vida + acciones masivas (`2744123`)
`AnimalStatusService.changeStatus`/`bulkChangeStatus` extienden la regla única `transition`
(descarte/pérdida/transferencia; **sold→Ventas y dead→Mortalidad se bloquean** — tienen su fila de
hecho). El bloqueo a no-activos YA existía (movement filtra `status='active'`, sanidad valida
activo). `herd.bulkChangeCategory` (valida species+sexo, idempotente). Web: barra de acciones
masivas (Mover·Categoría·Descartar·CSV·Imprimir) + `LifecycleAction` por animal en la ficha.

### E6 — Calidad de datos + genealogía (árbol) + export (`a343b9c`)
`herd.qualityReport` (GET /animals/quality): banderas de completitud/coherencia por animal activo
agregadas por tipo (sin lote/caravana/ID oficial/foto/pesaje/raza, genealogía incompleta,
sexo↔categoría, edad↔categoría) — NO duplica alertas repro/sanidad. `herd.animalGenealogy`:
ancestros hasta N generaciones (CTE recursiva con término base y recursivo únicos vía VALUES
lateral) + descendencia. Web `/animales/calidad` (tarjetas con drill-down + CSV) y árbol
genealógico en la pestaña Genealogía. **Ruta estática `animals/quality` antes de `animals/:id`.**

## Estado
- **herd 90 tests verdes** (17 archivos, incluye lots); repro con `animalStatus`.
- Sin regresión en import/commerce/land/sync.

## Diferido (follow-up)
Importación mejorada: el import ya mapea madre/padre/origen/nacimiento (P2). Extenderlo a
raza/RFID/oficial/lote/notas requiere tocar el pipeline transaccional del módulo `import` (semántica
de tx por chunk); se deja como tarea enfocada aparte para no arriesgar el import.
