# Genética (G-1 → G-3) · Cierre de sprint

**Estado:** ✅ COMPLETO · **Rama:** `main` · **Octavo vertical de Fase 2.**
**Alcance:** partidas de semen y embriones (inventario con saldo), consumo en inseminación/transferencia
y evaluaciones genéticas, con la web del módulo. Profundiza el módulo Repro/IATF.

> Registro histórico del sprint. Cierres previos: `inventory`, `commerce`, `finance`, `nutrition`,
> `hr`, `agriculture`, `machinery` (ver `docs/sprints/`).

---

## 1. Objetivo

Gestionar el material genético y cerrar el ciclo reproductivo: **pajuelas** (semen) y **embriones**
como inventario con saldo, que una **inseminación artificial** / **transferencia embrionaria** consume
(reusando el módulo Repro ya construido), más las **evaluaciones genéticas** por animal.

## 2. Alcance implementado (una ola por commit)

- **G-1 — Semen:** `semen_batches` (pajuelas por toro/lote) con `straws_available` materializado y su
  regla única de ajuste.
- **G-2a — Consumo en inseminación:** `repro.service()` con `semen_batch_id` descuenta 1 pajuela al
  registrar una AI.
- **G-2b — Embriones + evaluaciones:** `embryos` (inventario con saldo, simétrico al semen) +
  `genetic_evaluations` (traits jsonb) + consumo de embrión en `embryo_transfer`.
- **G-3 — Web:** semen + embriones (ajuste de saldo con +/−) + evaluaciones (editor de traits).

## 3. Arquitectura y reglas únicas

```
   semen_batches.straws_available   embryos.straws_available
        │  adjustStraws / applyStrawsDelta (REGLA ÚNICA del saldo, sin negativo → 403)
        ▼
   repro.service(method='ai', semen_batch_id)          ──► applyStrawsDelta(-1)  (antes del insert)
   repro.service(method='embryo_transfer', embryo_id)  ──► applyStrawsDelta(-1)
        └─► breeding_events (semen_batch_id / embryo_id)   [si el saldo no alcanza: 403 y SIN evento]
```

- **Saldo como regla única:** `straws_available` (pajuelas y embriones) se muta SOLO por
  `adjustStraws`/`applyStrawsDelta` (lock de fila + no-negativo). No hay tabla de kardex: el saldo es
  materializado.
- **Consumo antes del insert:** en `service()`, se descuenta la pajuela/embrión ANTES de insertar el
  `breeding_event`; si el saldo no alcanza (403), no queda ni el servicio ni el consumo (en una request
  comparten la misma tx).
- **Dependencia unidireccional Repro→Genetics:** `GeneticsModule` exporta `SemenService` + `EmbryosService`;
  `ReproModule` los importa. DAG sin ciclos.

## 4. Decisiones importantes

- **Semen y embriones simétricos:** ambos son inventario con `straws_available` + el mismo patrón de
  ajuste. AI consume pajuela, transferencia consume embrión.
- **Paridad móvil diferida:** el semen/embrión es capability web/REST; el `breeding-event-sync.handler`
  (móvil) aún no envía `semen_batch_id`/`embryo_id` → no consume. Consistente (sin inconsistencia).
- **Referencias validadas por existencia** (sire/donante → animals, breed → breeds, supplier → suppliers,
  tank → storage_tanks); `sire_id` sin company (solo tenant).
- **Fix RLS de 3 tablas** (patrón recurrente): `semen_batches` (G-1) + `embryos` + `genetic_evaluations`
  (G-2b).
- **Bug de contrato corregido en G-3:** `/animals` devuelve `{ data, next_cursor }` (paginado), no un
  array; las páginas leen `.data` (corregido en genética y en la de ventas, bug latente).

## 5. Métricas finales

| Métrica | Valor |
|---|---|
| Vitest (`audit:arch`) | **515 tests** (G-1 semen, G-2a consumo, G-2b embriones/evaluaciones) |
| Ciclos de dependencia (madge) | **0** |
| Guardias RLS `.mjs` (no-super) | semen_batches · embryos · genetic_evaluations (3/3) |
| Playwright E2E (web) | `32-genetica` (partida de semen + ajuste de saldo) |

## 6. Trabajo diferido

- **Selector de partida/embrión al inseminar en la web de repro** (ReproCapture/animales) y **paridad
  móvil** del consumo.
- **Kardex de pajuelas/embriones** (historial de movimientos; hoy solo saldo materializado).
- **Valuación/costeo** del material genético (unit_cost existe; no se propaga a Finanzas).
- **Vínculo de evaluaciones con labs** (`lab_sample_id`) — el módulo de laboratorio no está activo.
- **Termos/tanques** (`storage_tanks`) como maestro propio (hoy `tank_id` se valida pero no se crea).

## 7. Estado del roadmap

**Genética → COMPLETO.** Semen, embriones, evaluaciones y consumo en inseminación/transferencia, más la
web, estables en `main`, con el saldo como regla única y el enganche a Repro sin romper su pipeline.

**Siguiente: próximo vertical de Fase 2, por definir** (Trazabilidad/Guías, Tambo/Leche, partes de
trabajo/RRHH…). Mismo método: análisis previo aprobado, olas pequeñas, verificación completa, un commit
por ola.
