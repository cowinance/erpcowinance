# Golden — reglas de negocio (oráculo de refactor)

Comportamiento **actual** de las reglas que la Fase 4 del Foundation Hardening Sprint
extraerá a `packages/domain`. Hoy están **duplicadas** en:
`apps/api/src/modules/health/health.service.ts`, `.../repro/repro.service.ts` y
`apps/mobile/src/sync/SyncContext.tsx`.

El test ejecutable que las pinea: `apps/api/test/business-rules.golden.test.ts`.
Tras la extracción, **esta misma tabla debe seguir pasando** (prueba de no-cambio).

## Regla 1 — Retiro de carne
`meat_withdrawal_until = fecha_aplicación + withdrawal_meat_days` (solo fecha).
`0` o `null` días → **sin retiro** (`null`).

| Aplicado | Días | Retiro hasta |
|---|---|---|
| 2026-07-01 | 35 | 2026-08-05 |
| 2026-07-01 | 28 | 2026-07-29 |
| 2026-02-15 | 35 | 2026-03-22 |
| cualquiera | 0 / null | (sin retiro) |

## Regla 2 — Retiro de leche
`milk_withdrawal_until = fecha_aplicación + withdrawal_milk_hours` (timestamp completo, conserva la hora).
`0` o `null` horas → **sin retiro**.

| Aplicado | Horas | Retiro hasta |
|---|---|---|
| 2026-07-01T10:00:00Z | 96 | 2026-07-05T10:00:00Z |

## Regla 3 — Fecha probable de parto (gestación)
`expected_due_date = fecha_de_servicio + 283 días` (solo fecha). Bovino.

| Servicio | Parto probable |
|---|---|
| 2026-06-02 | 2027-03-12 *(confirmado en la app, vaca 126)* |
| 2026-01-01 | 2026-10-11 |

> Nota: 283 es un valor fijo bovino en `repro.service`. Al mover a `packages/domain`
> se parametrizará por especie (`species.gestation_days`), preservando 283 para bovino.
