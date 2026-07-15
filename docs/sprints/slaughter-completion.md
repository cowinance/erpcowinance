# Faena (FA-1 → FA-2) · Cierre de sprint

**Estado:** ✅ COMPLETO · **Rama:** `main` · **Vertical 11 de Fase 2.**
**Alcance:** registro de res por animal con rendimiento derivado del peso vivo, y la web con análisis
por lote/padre.

> Registro histórico del sprint. Cierres previos en `docs/sprints/` (inventory, commerce, finance,
> nutrition, hr, agriculture, machinery, genetics, traceability, budgets).

---

## 1. Objetivo

Cerrar el ciclo del negocio de carne: registrar la **faena** (res por animal) con su **rendimiento**,
y medirlo por lote y por padre. Es el resultado final medible de todo lo construido: genética →
nutrición → producción/GDP → venta → **faena**.

## 2. Alcance implementado (una ola por commit)

- **FA-1 — Registro:** `carcass_records` (una res por animal) con **rendimiento DERIVADO** del último
  peso vivo; integridad opcional con la venta de hacienda y el frigorífico.
- **FA-2 — Web + análisis:** página `/faena` (registrar + listado) + `GET /slaughter/analytics?by=sire|lot`
  (rendimiento promedio por padre/lote).

## 3. Arquitectura y reglas únicas

```
   carcass_record(animal, hot_carcass_weight_kg)   [animal_id UNIQUE → una res por animal]
        │  computeDressingPct (@cowinance/domain)
        │  = peso de res ÷ ÚLTIMO PESO VIVO × 100     ← última pesada ≤ slaughter_date (v_weighings/GDP)
        ▼
   dressing_pct (persistido) + live_weight_kg (expuesto, auditable)
        │
   GET /slaughter/analytics?by=sire|lot → AVG(dressing_pct) por padre / lote   ← cierra el loop con Genética
```

- **Rendimiento derivado (regla única):** `computeDressingPct` en `@cowinance/domain`, testeable. Nunca
  se acepta del cliente: el servidor lo calcula cruzando la faena con la última pesada del animal (≤
  `slaughter_date`). Sin pesadas → `null` (no se inventa un número); el `live_weight_kg` usado se
  expone para que el dato sea auditable.
- **Invariante física:** una res no puede pesar más que el animal vivo (rendimiento > 100% = 400).
- **Una res por animal:** `animal_id` es UNIQUE en el esquema → segunda faena del mismo animal se
  rechaza con 409 (validado antes, no un 500 por constraint).
- **No hay segunda fuente de verdad del estado:** faenar NO toca `animals.status` (el animal ya quedó
  `sold` al entregarse la venta, vía `AnimalStatusService`).
- **Análisis:** el `AVG` de SQL ignora los rendimientos `null` sin ensuciar el promedio; la res igual
  cuenta en `count` y en el peso promedio.

## 4. Decisiones importantes

- **El frigorífico es un CLIENTE:** `carcass_records.slaughterhouse_id` → FK a `customers`, y el enum de
  segmentos ya incluía `slaughterhouse`. La venta declarada (opcional) debe ser de hacienda Y contener
  al animal en sus líneas.
- **Integridad opcional pero coherente:** se puede faenar sin venta (consumo propio), pero si se
  declara venta/frigorífico, tienen que ser válidos.
- **Fix RLS de `carcass_records`** (patrón recurrente); guardia `.mjs` no-super 3/3.
- **Módulo `slaughter` propio;** lee pesadas (Herd) y valida venta/frigorífico (Comercial) por lectura
  directa, sin acoplar módulos (0 ciclos).

## 5. Métricas finales

| Métrica | Valor |
|---|---|
| Vitest (`audit:arch`) | **548 tests** (FA-1 integración + dominio del rendimiento) |
| Ciclos de dependencia (madge) | **0** |
| Guardia RLS `.mjs` (no-super) | carcass_records (3/3) |
| Playwright E2E (web) | `35-faena` (animal 500 kg → res 270 kg → 54% + análisis) |

## 6. Trabajo diferido

- **Ingreso por venta ligado a la res** (kg de res × precio) y conciliación con la venta de hacienda.
- **Comparar rendimiento vs GDP / costo de engorde** (eficiencia real: kg de res por kg de alimento).
- **Grados de tipificación** normalizados (hoy `fat_grade`/`conformation`/`marbling` son texto libre).
- **Editar/anular** una faena (hoy solo alta + baja lógica).
- **Retroalimentar `genetic_evaluations`** con el rendimiento de la progenie (automatizar el loop).

## 7. Estado del roadmap

**Faena → COMPLETO.** Registro con rendimiento derivado y la web con análisis por lote/padre, estables
en `main`, reusando las pesadas de Producción/GDP y sin segunda fuente de verdad del estado del animal.

**Siguiente: próximo vertical, por definir** (Pastoreo — el recurso forrajero — es el candidato
operativo más fuerte para una cría; también Tambo, o partes de trabajo/RRHH). Mismo método.
