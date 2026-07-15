# Pastoreo (PG-1 → PG-2) · Cierre de sprint

**Estado:** ✅ COMPLETO · **Rama:** `main` · **Vertical 12 de Fase 2.**
**Alcance:** rotación de lotes por potrero (entrada/salida) con forraje pre/post y análisis de
ocupación/descanso, con la web del módulo.

> Registro histórico del sprint. Cierres previos en `docs/sprints/`.

---

## 1. Objetivo

Gestionar el **recurso forrajero** —el insumo #1 de una cría—: registrar cuándo un lote **entra** y
**sale** de un potrero, medir el forraje disponible antes y después, y ver la **ocupación actual** y el
**descanso** de cada potrero (clave para la recuperación de la pastura).

## 2. Alcance implementado (una ola por commit)

- **PG-1 — Registro:** `grazing_records` — entrada/salida con reglas de rotación y métricas derivadas
  (días, forraje consumido, abierto).
- **PG-2 — Web + análisis:** `/pastoreo` (ingresar/salir + listado) + `GET /grazing/occupancy`
  (ocupado/libre, días de pastoreo/descanso por potrero).

## 3. Arquitectura y reglas únicas

```
   grazing_record(paddock, lot, entry_date, exit_date?, pre/post kg MS/ha)
        │  ROTACIÓN: un potrero ocupado (pastoreo abierto) rechaza otra entrada (409);
        │            un lote no pastorea dos potreros a la vez (409).
        │  computeGrazingMetrics (@cowinance/domain): grazing_days, forage_consumed, is_open (DERIVADOS)
        ▼
   GET /grazing/occupancy → por potrero: ocupado (lote + días) | libre (días de descanso desde última salida)
```

- **Reglas de rotación (regla de negocio):** un potrero con un pastoreo abierto no admite otra entrada;
  un lote no puede pastorear dos potreros a la vez. Ambas → 409. Es la esencia del pastoreo rotativo.
- **Métricas derivadas (regla única):** `computeGrazingMetrics` en `@cowinance/domain` — días (salida −
  entrada, null mientras abierto), forraje consumido (pre − post), `is_open`. No se persisten.
- **Ocupación/descanso:** calculados con `CURRENT_DATE` en SQL (días de pastoreo de los abiertos; días
  de descanso desde la última salida de los libres).
- **Ciclo de vida validado:** salida ≥ entrada (400); cerrar dos veces → 409; cerrar libera el potrero.

## 4. Decisiones importantes

- **Módulo `grazing` propio** (gestión del pastoreo), distinto de `land` (los potreros físicos). Lee
  potreros/lotes por lectura directa (tenant), sin acoplar módulos (0 ciclos).
- **Fechas casteadas a texto** (`entry_date::text`) en los SELECT: PGlite devuelve `Date`, y
  `String(Date)` rompía la comparación `exit < entry` (bug detectado por el test de integración).
- **Fix RLS de `grazing_records`** (patrón recurrente); guardia `.mjs` no-super 3/3.

## 5. Métricas finales

| Métrica | Valor |
|---|---|
| Vitest (`audit:arch`) | **557 tests** (PG-1 integración + dominio de métricas) |
| Ciclos de dependencia (madge) | **0** |
| Guardia RLS `.mjs` (no-super) | grazing_records (3/3) |
| Playwright E2E (web) | `36-pastoreo` (ingresar → ocupado → salir → libre) |

## 6. Trabajo diferido

- **Carga animal / consumo por cabeza** (relacionar cabezas del lote × días con el forraje consumido).
- **Días de descanso objetivo** por potrero con alerta (recuperación insuficiente antes de re-pastorear).
- **Superficie y disponibilidad total** (kg MS/ha × ha del potrero) y balance forrajero.
- **Editar** un pastoreo (hoy alta + salida + baja lógica).
- **Registros de pastoreo** (`grazing_records`) alimentando GDP / eficiencia de conversión.

## 7. Estado del roadmap

**Pastoreo → COMPLETO.** Rotación con reglas de negocio, métricas derivadas y la web con
ocupación/descanso, estables en `main`, en su propio bounded context sin acoplar a `land`.

**Siguiente: por definir** (Tambo/Leche — dominio completo, solo si es lechero; o partes de
trabajo/RRHH — work_logs). Mismo método.
