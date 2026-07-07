# Baseline de métricas de calidad — Foundation Hardening Sprint (F0)

Punto de partida registrado **antes** del refactor, para medir la evolución.
Fecha: inicio del sprint. Herramientas efímeras vía `npx` (se formalizan en F9).

## Pruebas
- **Runner:** Vitest 3 (`npm test`).
- **Suite:** 34 tests verdes en ~0.2 s (24 en `sync-core`: HLC/merge/convergencia; 10 golden de reglas de negocio).
- **Cobertura:** aún no medida formalmente (F9 activa `--coverage`). Base ≈ solo `sync-core` + reglas puras.

## Duplicación (jscpd)
- **0.89%** — 9 clones exactos, 64 líneas duplicadas en 70 archivos (api + mobile + sync-core).
- ⚠️ **Subestima el problema real**: la duplicación de *reglas de negocio* (retiro/gestación en `health.service`, `repro.service` y `SyncContext`) es **semántica**, no línea-a-línea, así que jscpd casi no la ve. La Regla Permanente 1 (regla única) apunta a esto; F4 la elimina.

## Dependencias circulares (madge)
- **1 ciclo:** `db/db.service.ts → common/request-context.ts` (request-context importa el tipo `Q` de db.service; db.service importa el valor `requestContext`). Funciona en runtime (un lado es type-only) pero conviene romperlo moviendo `Q`/tipos a un archivo propio. **Objetivo: 0 ciclos.**

## Acoplamiento entre módulos
- **Por imports:** bajo (único cruce real: `media → auth` para `@Public`).
- **Por datos (SQL cross-domain):** alto — `dashboard`, `reports`, `alerts` y `sync` leen/escriben tablas de otros dominios. `sync.service` escribe en TODAS. (Ver auditoría.) F5/F7 y el registry de sync (F6) atacan esto.

## Tamaño de servicios (watch de God-object)
| Archivo | Líneas |
|---|---|
| sync/sync.service.ts | **581** ← God service (F6 lo parte en handlers) |
| alerts/alerts.service.ts | 339 |
| herd/herd.service.ts | 323 |
| repro/repro.service.ts | 248 |
| health/health.service.ts | 213 |
| dashboard/dashboard.controller.ts | 87 (con 22 SQL — F7) |

## Tiempo de compilación (aprox., referencia)
- `nest build` (api) ≈ 3–5 s · `next build` (web) ≈ 3 s · `tsc` móvil ≈ pocos s. (F9 lo instrumenta.)

## Estrategia de medición (a formalizar en F9)
| Métrica | Herramienta | Umbral objetivo |
|---|---|---|
| Cobertura | Vitest v8 | subir progresivamente; dominio ≥ 90% |
| Complejidad ciclomática | eslint `complexity` / `ts-complex` | alerta > 10 por función |
| Dependencias circulares | `madge --circular` | **0** |
| Duplicación | `jscpd` | ≤ 1% y **0 reglas de negocio duplicadas** |
| Acoplamiento | `madge` (grafo) | sin nuevos cruces por imports |
| Tiempo de build | log en CI | no-regresión |

Cierre: `npm run audit:arch` (F9) correrá jscpd + madge + coverage y comparará contra este baseline.
