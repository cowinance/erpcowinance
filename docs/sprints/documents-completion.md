# Cierre de sprint — Documentos, archivos y media (A6)

**Estado:** COMPLETO. Módulo **A6 · Documentos, archivos y media [Fase 1]** — el DMS del ERP. Módulo
`documents` propio. **Completa la Suite A · Núcleo y Administración.**

## 1. Qué se construyó

- **Centro de documentos formales** (tabla `documents`): un documento envuelve un archivo (PDF/imagen)
  y agrega tipo, emisor, vigencia y **vencimiento**, con enlace polimórfico opcional a cualquier
  entidad. Antes sólo existía subida de fotos de animales (módulo `media`); la parte formal del DMS no
  estaba.
- **API** `POST /documents` (archivo data-URL + metadatos), `GET /documents` (filtros: type, expiring,
  entity), `GET /documents/summary` (indicador «documentos por vencer»), `GET /documents/:id`,
  `DELETE /documents/:id`. Descarga por la ruta firmada existente `/files/:id/content?t=`.
- **Web** `/documentos`: alta con selector de archivo (PDF/PNG/JPG/WebP), KPIs (total · por vencer ·
  vencidos), lista ordenada por vencimiento con badges (Vencido / Vence en N d / Vigente) y descarga.
  Ítem de sidebar.

## 2. Regla única (dominio)

- **`validateDocumentInput`** (`packages/domain/src/documents/document.ts`): tipo en enum
  (certificate/contract/invoice/health_guide/report/permit/other), título obligatorio, fechas AAAA-MM-DD,
  vencimiento ≥ emisión, y enlace a entidad todo-o-nada (type+id juntos). `InvalidDocumentError` → 400.

## 3. Derivados y reuso

- **Vencido / días a vencer** derivados en SQL con `CURRENT_DATE` (is_expired, days_to_expiry).
- **Almacén de archivos reutilizado del módulo media:** disco `.data/uploads/<tenant>/<fileId>`, dedup
  por checksum (dos documentos con el mismo archivo comparten `file_id`), servido por token firmado
  (`signFileToken` + `/files/:id/content`). No se duplicó infraestructura de archivos.

## 4. Decisiones importantes

- **No duplica `certifications` (T-2):** aquélla es especializada y *linkea* a un `documents`; A6 es el
  DMS general. `documents` es el ancla que ya referencian facturas, guías, informes de lab, certificaciones.
- **Sin tablas nuevas ni fix RLS:** `files`/`attachments`/`documents` ya estaban en RLS_TABLES.
- **Módulo `documents` propio;** comparte el almacén de archivos con `media` (0 ciclos).

## 5. Métricas finales

| Métrica | Valor |
|---|---|
| Vitest (`audit:arch`) | **634 tests** (desde 623 → +6 dominio, +5 integración) |
| Ciclos de dependencia (madge) | **0** |
| RLS | sin cambios |
| Verificación web | 3 docs de muestra: Permiso «Vencido», Certificado «Vence en 12 d», Contrato «Vigente»; KPIs 3/1/1 |

## 6. Trabajo diferido

- **Alertas de caducidad en el motor de reglas:** hoy el «por vencer» es un indicador propio del DMS;
  se puede sumar una regla `document_expiring` al motor configurable (A3) para que dispare alertas.
- **Adjuntos genéricos:** el módulo `attachments` polimórfico existe (fotos de animal); extender la UI
  de adjuntos a otras entidades (contratos a socios, informes a lotes).
- **EXIF/miniaturas/subida offline diferida** (móvil) del alcance completo de la ficha.

## 7. Estado del roadmap

**Documentos (A6) → COMPLETO. Suite A · Núcleo y Administración CERRADA.**

**Siguiente: por definir.** Candidatos de Fase 2/2-3 pendientes: D3·Mapas y GPS, G2·Costos y
rentabilidad, F3·CRM, G4·Facturación electrónica. Verificar fase en el catálogo antes de elegir.
