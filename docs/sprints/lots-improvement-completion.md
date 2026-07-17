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

## 6. Trabajo diferido

- **Asignar/quitar animales al lote** desde el detalle (hoy se hace desde Animales o moviendo lotes
  entre potreros en el mapa).
- **Historial del lote** (movimientos, cambios de composición en el tiempo).
- **Filtros** en la grilla (por propósito, por potrero, activos/todos).

## 7. Estado del roadmap

**Lotes → mejora completa COMPLETA.** El módulo pasó a gestor con detalle y composición.

**Siguiente: por definir.** Candidatos: geocercas/GPS (D3), G2·Costos y rentabilidad, F3·CRM,
G4·Facturación electrónica.
