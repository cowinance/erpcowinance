# P9 — Reportes esenciales (completar) · Cierre de sprint

**Estado:** ✅ COMPLETO · **Rama:** `main`
**Alcance:** cerrar la familia de reportes convirtiendo los datos ya capturados en **indicadores
accionables** — índices reproductivos del período, reporte sanitario del período — y endurecer el
**export CSV**, respetando la separación snapshot-operativo (dashboard/alerts) vs análisis
histórico (reports).

> Registro histórico del sprint. Cierres previos: [`p6-tasks-completion.md`](./p6-tasks-completion.md),
> [`p7-notifications-completion.md`](./p7-notifications-completion.md),
> [`p8-produccion-gdp-completion.md`](./p8-produccion-gdp-completion.md).

---

## 1. Objetivo

El módulo `reports` ya tenía inventario a fecha, altas/bajas, producción (GDP, de P8) y una
reproducción de **conteos crudos**. P9 lo completa con **índices** (tasas, no solo conteos), un
**reporte sanitario** inexistente, y un **export CSV robusto**, sin duplicar las métricas snapshot
que ya viven en el dashboard y en alerts.

## 2. Alcance implementado

- **P9-1 — Índices reproductivos** (`reports.reproduction` enriquecido): `prenez_pct`, `iep_dias`,
  `servicios_por_prenez` — todos **acotados al período**.
- **P9-2 — Reporte sanitario** (`reports.health` + `GET /reports/health`, tab «Sanidad»):
  vacunaciones y tratamientos aplicados (con desgloses) y mortalidad del período.
- **P9-3 — Export CSV robusto** (`lib/csv.ts`): serialización endurecida (anti-inyección de
  fórmulas + escape + BOM) y desgloses incluidos.

## 3. Decisión arquitectónica transversal: snapshot vs período

El hallazgo que ordenó P9: los indicadores **a-fecha** ya tienen dueño y NO se duplican en los
reportes.

| Métrica a-fecha (snapshot) | Dueño |
|---|---|
| `pregnancy_rate_pct`, `open_pregnancies`, `breeding_females` | `repro.kpis()` |
| `active_withdrawals`, `vaccinations_due_30d` | `dashboard` |
| `withdrawal_active`, `vaccination_due`, `health_task_due` (por animal) | `alerts` |

Los reportes de `reports` quedan **exclusivamente período-scoped** `[from, to]`. Esto evita
duplicar la regla, no mezcla snapshot con histórico y **no agrega dependencias** `reports→repro`
ni `reports→health` (0 ciclos).

## 4. Definiciones (fórmulas y semántica de `null`)

`null` = no calculable por falta de denominador/muestra, **nunca `0`**.

- **`prenez_pct`** = positivos / (positivos + negativos) × 100. Positivos = filas en `pregnancies`
  del período; negativos = `animal_events` `pregnancy_negative` del período. `null` si no hubo
  diagnósticos.
- **`iep_dias`** = promedio de días entre partos consecutivos del mismo vientre (`LAG` por
  `dam_id`), solo intervalos cuyo parto posterior cae en el período. `null` si no hay ≥1 intervalo.
- **`servicios_por_prenez`** = servicios del período / positivos. `null` si no hubo preñeces (sin
  división por cero).
- **`mortalidad.tasa_pct`** = muertes del período / animales activos a `to` × 100 (aprox). `null`
  si no hay base.
- Todas las consultas excluyen `deleted_at` y acotan por fecha (eliminados / fuera de rango /
  importados sin historial → fuera).

## 5. Export CSV robusto (P9-3)

`lib/csv.ts` es el único lugar que serializa/descarga CSV. Endurecido contra:
- **Inyección de fórmulas** (Excel/Sheets): celdas que empiezan con `= + - @ \t \r` se prefijan con
  apóstrofo → no se ejecutan. Mitiga texto del usuario (nombres de producto, lote, caravana).
- Comillas/comas/saltos: entrecomillado con duplicación de comillas.
- BOM UTF-8 para acentos.
Se corrigió además el export de Reproducción (P9-1 cambió `diagnosticos` a objeto) y se agregaron
los desgloses de Sanidad.

## 6. Criterios de aceptación cumplidos

- Los reportes muestran **índices**, no solo conteos; correctos ante datos parciales (`null` bien
  definido), eliminados y fechas fuera de rango.
- El reporte sanitario existe y es período-scoped; los snapshots a-fecha siguen en dashboard/alerts.
- El CSV exportado es **seguro** (sin inyección) y consistente entre reportes, con desgloses.
- Sin duplicar reglas ni acoplar módulos (0 ciclos).

## 7. Métricas finales

| Métrica | Valor |
|---|---|
| Vitest (`audit:arch`) | **382 tests** (incl. `reproduction-indices` y `health-report` integration) |
| Ciclos de dependencia (madge) | **0** (sin `reports→repro`/`reports→health`) |
| Playwright E2E (web) | `13-reportes-reproduccion`, `14-reportes-sanidad`, `15-export-csv` (descarga real) |
| Typechecks | API, web, móvil, sync-core, domain, design-tokens limpios |
| Architecture gates | invariantes intactos |

## 8. Decisiones diferidas y trabajo futuro

- **Índices reproductivos por cohorte** (tasa de destete / % parición siguiendo servicio→parto→
  destete), en vez de ratios de período aproximados.
- **Cobertura de vacunación como reporte** (hoy snapshot en dashboard/alerts).
- **Export por-fila detallado** (padrón de animales por evento), hoy el export es de resumen +
  desgloses.
- **`apps/web` en el gate de Vitest** para unit-testear helpers puros como `lib/csv.ts` (hoy se
  verifican por Playwright).

## 9. Estado del roadmap

**P9 → COMPLETO.** Los reportes esenciales muestran indicadores accionables, con separación limpia
snapshot/histórico, sin duplicar reglas, y con export CSV seguro — terminado, verificado y estable
en `main`.

**Siguiente fase: próximo vertical del roadmap, por definir** (candidatos: Reproducción —
gestión/índices; Facturación SaaS). Mismo método: análisis previo aprobado antes de código, olas
pequeñas y revisables, verificación completa y un commit por ola.
