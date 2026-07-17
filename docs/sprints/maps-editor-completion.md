# Cierre de sprint — Mapas y GPS · Editor de potreros (D3, 1ª entrega)

**Estado:** COMPLETO. Primera entrega del módulo **D3 · Mapas y GPS [Fase 2]** — el editor cartográfico
de potreros. Hasta ahora `/mapa` era un visor esquemático de solo lectura (Fase 1).

## 1. Qué se construyó

- **Editor de mapas completo** sobre el canvas SVG esquemático (offline, sin tiles): ver, **dibujar**
  un potrero nuevo (click para agregar vértices), **editar su forma** (arrastrar vértices, insertar en
  el borde, borrar con doble-click), editar propiedades y borrar, con **medición de superficie en vivo**.
- **API** (extiende `land`): `POST /paddocks` ahora acepta `boundary` (GeoJSON) y DERIVA el área;
  `PUT /paddocks/:id` (nombre, tipo de pastura y/o forma — re-deriva el área al cambiar la forma);
  `DELETE /paddocks/:id` (baja, bloqueada si el potrero tiene animales → 409).
- **Web** `/mapa`: reescrito como editor con modos ver/dibujar/editar, panel contextual y toolbar.

## 2. Regla única (dominio)

- **`polygonAreaHa` / `normalizePolygonRing` / `toPolygonGeoJSON`** (`packages/domain/src/geo/polygon.ts`):
  valida el polígono (≥3 vértices distintos, GeoJSON o anillo) y mide la superficie por la fórmula del
  cordón (shoelace). El canvas 1000×700 representa ~3 km × 2,1 km (`METERS_PER_UNIT = 3`), así el área
  cae en un rango realista de hectáreas. `InvalidPolygonError` → 400.

## 3. Contexto técnico importante

- **PGlite no tiene PostGIS:** el loader del esquema degrada `geography(Polygon)` a **jsonb** (guarda
  GeoJSON en unidades de canvas). En **producción** el mismo `boundary` es PostGIS geography sobre tiles
  reales; el editor y el contrato (GeoJSON) son los mismos. La medición offline usa shoelace; en prod
  sería `ST_Area`.
- El seed decopla forma y `area_ha` (shapes esquemáticos, áreas realistas independientes). El editor,
  en cambio, **deriva el área del polígono** — coherente para todo lo que se dibuje/edite.

## 4. Decisiones importantes

- **Sin tablas nuevas ni fix RLS:** reusa `paddocks` (ya en RLS_TABLES). Extiende el módulo `land`.
- **El área es derivada, fuente única en dominio;** el cliente muestra un estimado en vivo con la misma
  fórmula (espejo de `polygonAreaHa`), el servidor la re-calcula al persistir (autoridad).
- **Baja segura:** un potrero con animales activos no se borra (409) — moverlos primero.

## 5. Métricas finales

| Métrica | Valor |
|---|---|
| Vitest (`audit:arch`) | **645 tests** (desde 634 → +7 dominio, +4 integración) |
| Ciclos de dependencia (madge) | **0** |
| RLS | sin cambios |
| Verificación web | Dibujé «Potrero Este» (4 vértices, medición en vivo ≈ 51,07 ha) → creado y persistido (6→7 potreros, 533→584,07 ha); editor de forma con vértices arrastrables + inserción/borrado |

## 6. Trabajo diferido (alcance completo de la ficha D3)

- **Cartografía real sobre tiles vectoriales** (claro/oscuro) + satélite conmutable — requiere PostGIS
  en prod y un motor de tiles; el editor ya produce el `boundary` correcto.
- **Snapping** al dibujar (a vértices/aristas vecinas).
- **GPS de animales/maquinaria** (`gps_positions`, collares) con clusters y timeline.
- **Geocercas** (`geofences`, virtual fencing) con alertas de entrada/salida.
- Capas (agua, cercas, sensores, drones).

## 7. Estado del roadmap

**Mapas y GPS · editor de potreros → 1ª entrega COMPLETA.** `/mapa` dejó de ser solo lectura.

**Siguiente: por definir.** Del alcance D3 quedan GPS/geocercas/tiles (piezas más pesadas, varias de
Fase 2-3). Otros módulos: G2·Costos y rentabilidad, F3·CRM, G4·Facturación electrónica.
