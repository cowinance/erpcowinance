# Cierre de sprint — Lotes (mejora completa · B1)

**Estado:** COMPLETO. Mejora integral del módulo **Lotes / rodeos** (parte de B1 · Hato). Pasó de un
CRUD parcial (solo listar + crear, web de solo lectura) a un gestor completo con detalle y composición.

## 1. Punto de partida

- **API:** `GET /lots` (lista) + `POST /lots` (crear). Sin detalle, edición ni baja.
- **Web:** `/lotes` era una grilla de solo lectura (cards con link a animales).

## 2. Qué se construyó

- **API (herd):**
  - `GET /lots/:id` — **detalle con composición**: cabezas, peso promedio y GDP (última pesada por
    animal vía `v_weighings`), composición **por categoría** y **por sexo**, potrero y estado.
  - `PUT /lots/:id` — editar nombre, propósito, potrero asignado y estado (activo/archivado). Valida
    que el potrero pertenezca al tenant.
  - `DELETE /lots/:id` — archivar; **bloqueado si el lote tiene animales activos** (409, reasignar
    primero).
  - `GET /lots` ahora incluye `is_active` y ordena activos primero. `POST /lots` reusa la regla única.
- **Web `/lotes`:** reescrito como **gestor** (`LotsManager`): grilla de lotes (propósito, potrero,
  cabezas, estado archivado), **panel de detalle** con KPIs + composición por categoría (barras) y por
  sexo, formularios de **crear** y **editar**, y **archivar**.

## 3. Regla única (dominio)

- **`validateLotInput` / `assertLotPurpose`** (`packages/domain/src/herd/lot.ts`): nombre obligatorio
  (≤255), propósito opcional en el enum (breeding/fattening/dairy/weaning/quarantine/hospital).
  `InvalidLotError` → 400. Reusada por crear y editar.

## 4. Decisiones importantes

- **Sin tablas nuevas ni fix RLS:** reusa `lots` (ya en RLS_TABLES). La lógica vive en `herd.service`.
- **Composición y agregados derivados** en SQL (reusa `v_weighings` de P8 para peso/GDP).
- **Baja segura:** archivar exige lote vacío (mismo patrón que el editor de potreros).

## 5. Métricas finales

| Métrica | Valor |
|---|---|
| Vitest (`audit:arch`) | **653 tests** (desde 645 → +4 dominio, +4 integración) |
| Ciclos de dependencia (madge) | **0** |
| RLS | sin cambios |
| Verificación web | Rodeo Cría 1: 20 cab · 509 kg · GDP 1,77 · Vaca 18 / Toro 2 · Hembras 18 / Machos 2; edición pre-cargada |

## 5-bis. Mover / agregar / quitar animales (2ª entrega)

- **Descubrimiento:** el backend YA soportaba mover animales — `POST /movements` (`land.moveAnimals`)
  toma `{ animal_ids, lot_id, reason }` y usa la **regla única `recordMovement`** (P3: timeline +
  versiones + sync server-origin). No hicieron falta endpoints nuevos, solo la UI y su reuso.
- **UI en el detalle del lote (`LotsManager`):**
  - **Lista de animales del lote** con checkboxes (`GET /animals?lot=X&status=active`).
  - **Mover a otro lote**: seleccionar animales + lote destino → `POST /movements { lot_id: destino }`.
  - **Quitar del lote**: seleccionar → `POST /movements { lot_id: null }`.
  - **Agregar existentes**: buscador (`GET /animals?q=`) que excluye los ya del lote → seleccionar →
    mover al lote. Refresca detalle + composición + cards en el acto.
- **Test de integración** (`lots-move`): mover entre lotes se refleja en `getLot` de ambos y **crea filas
  en `animal_movements`** (prueba que reusa la regla única, no un UPDATE directo de `current_lot_id`).
- Verificado en web: moví 2 animales (Rodeo Cría 2 10→8, Rodeo Cría 1 20→22) y agregué 1 de vuelta (8→9).

## 5-ter. Consistencia de movimientos + trazabilidad (3ª entrega — rediseño a fondo, Etapa 1)

Sobre el pedido de convertir Lotes en una herramienta de gestión diaria. Etapa 1 = prioridad del
usuario (consistencia de movimientos + trazabilidad):

- **Rotación de potrero (regla #4):** `updateLot` **dejó de tocar `current_paddock_id`**. Cambiar el
  potrero de un lote es una ROTACIÓN del lote completo: `POST /lots/:id/rotate` **reusa `land.moveLot`**
  (el lote cambia de potrero y sus animales lo siguen vía `recordMovement`, con lock e historial). En la
  web, el select de potrero del form de edición dispara la rotación, no una edición de campo.
- **Guarda de negocio (regla #6):** no se mueven animales a un **lote archivado** (409 en `moveAnimals`).
  Los animales muertos/vendidos/inactivos ya los filtra `recordMovement` (`status='active'`).
- **Historial / timeline (prioridad #2):** `GET /lots/:id/history` arma el historial desde
  `animal_movements` REALES, agrupado por `movement_id`: ingresos, salidas y rotaciones con fecha,
  origen, destino, motivo, cantidad y **usuario**. UI: sección «Historial» plegable con timeline por tipo.
- **Idempotencia (prioridad #4):** la UI manda `Idempotency-Key` en todo movimiento/rotación (el
  endpoint la usa como `movement_id`; el índice único deduplica doble-clic/reintentos).
- **Tests** (`lots-rotation-history`): rotación (lote y animales cambian de potrero + fila en
  `animal_movements`), mover-a-archivado bloqueado (409), historial refleja la rotación (from/to, cantidad).

Verificado en web: cambié Rodeo Cría 1 de Potrero Norte → Potrero Este (rotación, 20 animales lo
siguieron) y el historial mostró «Rotación de potrero · 20 animales · Potrero Norte → Potrero Este ·
Jose Montilla», además de ingresos/salidas previos.

**Criterio clave respetado:** nunca se actualiza `current_lot_id`/`current_paddock_id` desde la UI ni
por edición de campo; todo pasa por `recordMovement` (regla única, con transacción y trazabilidad).

## 6. Trabajo diferido (etapas siguientes del rediseño)

- **Etapa 2:** filtros (caravana/nombre/categoría/sexo/peso/edad/estado) + paginación de la lista de
  animales del lote.
- **Etapa 3:** acciones **dividir** lote, **fusionar** lotes y **mover TODO** el lote.
- **Etapa 4:** **métricas por propósito** (engorde: conversión/costo/kg/terminación; cría: vientres/toros/
  preñadas/vacías/crías; recría: peso inicial/actual/GDP/edad; hospital: motivo/días/tratamientos;
  cuarentena: ingreso/liberación; tambo: producción/estado reproductivo).
- **Etapa 5:** **alertas operativas** (sin potrero, sin pesaje reciente, sin identificación, mezcla
  inusual de categorías, vacío) y estado del lote (activo/vacío/archivado/con alertas).
- **Etapa 6:** UX — tabla compacta, orden por cabezas/propósito/potrero/peso/estado, export/print.

## 7. Estado del roadmap

**Lotes → mejora completa COMPLETA.** El módulo pasó a gestor con detalle y composición.

**Siguiente: por definir.** Candidatos: geocercas/GPS (D3), G2·Costos y rentabilidad, F3·CRM,
G4·Facturación electrónica.
