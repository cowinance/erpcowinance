# Trazabilidad (T-1 → T-3) · Cierre de sprint

**Estado:** ✅ COMPLETO · **Rama:** `main` · **Noveno vertical de Fase 2.**
**Alcance:** guías de traslado de hacienda y certificaciones, con la web del módulo.

> Registro histórico del sprint. Cierres previos en `docs/sprints/` (inventory, commerce, finance,
> nutrition, hr, agriculture, machinery, genetics).

---

## 1. Objetivo

Registrar la documentación de trazabilidad de una operación ganadera: **guías de traslado** de hacienda
(origen finca → destino socio, con estados) y **certificaciones** (SENASA, orgánico, etc.) sobre una
entidad (finca/animal/lote). Documentos operativos/regulatorios.

## 2. Alcance implementado (una ola por commit)

- **T-1 — Guías de traslado:** `movement_guides` — CRUD + máquina de estados
  (issued→in_transit→completed, canceled). Registro por cantidad (`animal_count`).
- **T-2 — Certificaciones:** `certifications` polimórfica (farm/animal/lot) con esquema/emisor/vigencia;
  vencimiento derivado; estados active/suspended/revoked.
- **T-3 — Web:** guías (emitir + transiciones) + certificaciones (por animal/lote + estados + flag
  Vencida).

## 3. Arquitectura y reglas únicas

```
   movement_guides(from_farm, to_partner, animal_count)  [issued→in_transit→completed / canceled]
   certifications(entity_type, entity_id, scheme, valid_until)  [active↔suspended / revoked]
        └─ is_expired = (valid_until < CURRENT_DATE)   ← DERIVADO en la lectura, no un estado por cron
```

- **Máquinas de estado con transiciones validadas** (409 si inválida); estados terminales
  (completed/canceled en guías; revoked en certificaciones).
- **Vencimiento derivado:** `is_expired` de una certificación se calcula de `valid_until` en la
  consulta (flag), no se persiste ni se actualiza por proceso.
- **Validación polimórfica:** la entidad de una certificación se valida contra la tabla que
  corresponde a su `entity_type` (farms/animals/lots), todas del tenant.
- **Referencias del tenant:** guías validan finca (origen) y socio (destino) del tenant; `company_id`
  resuelto por el servidor.

## 4. Decisiones importantes

- **Registro por cantidad, sin detalle por animal:** el esquema de `movement_guides` solo tiene
  `animal_count` (no una tabla de líneas). Es un registro de guías, no trazabilidad per-animal.
- **`entity_type='product'` diferido:** no hay un maestro de producto claro → se rechaza (400) hasta
  activarlo.
- **`expired` derivado, no estado manual:** el enum del schema lo incluye, pero se maneja como flag
  `is_expired`; el estado persistido es active/suspended/revoked.
- **Generación de guía desde una venta de hacienda: diferida** (sin `sale_id` en el schema).
- **Farm fuera de la UI** (T-3): no hay endpoint de listado de fincas; la API soporta certificaciones
  de finca igual.
- **Fix RLS de 2 tablas** (patrón recurrente): `movement_guides` (T-1) + `certifications` (T-2).

## 5. Métricas finales

| Métrica | Valor |
|---|---|
| Vitest (`audit:arch`) | **522 tests** (T-1 guías, T-2 certificaciones) |
| Ciclos de dependencia (madge) | **0** |
| Guardias RLS `.mjs` (no-super) | movement_guides · certifications (3/3 c/u) |
| Playwright E2E (web) | `33-trazabilidad` (guía: emitir → en tránsito → completada) |

## 6. Trabajo diferido

- **Detalle por animal** en la guía (requiere schema de líneas) y **generación desde una venta de
  hacienda**.
- **Trazabilidad completa** (`trace_events`, `blockchain_anchors`, `verifiable_credentials`) — capa de
  eventos/anclaje, posiblemente con integración externa.
- **`entity_type='product'`** en certificaciones (cuando exista el maestro de producto).
- **Documentos adjuntos** (`document_id`) y **estado ante autoridad** (SENASA/DTe) con integración.
- **Alertas de vencimiento** de certificaciones (por `valid_until`).

## 7. Estado del roadmap

**Trazabilidad → COMPLETO.** Guías y certificaciones con sus máquinas de estado y la web, estables en
`main`, con el vencimiento derivado y la validación polimórfica de entidades.

**Siguiente: próximo vertical de Fase 2, por definir** (Presupuestos, Partes de trabajo/RRHH, Tambo…).
Mismo método: análisis previo aprobado, olas pequeñas, verificación completa, un commit por ola.
