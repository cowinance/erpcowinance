# P8 — Producción / GDP · Cierre de sprint

**Estado:** ✅ COMPLETO · **Rama:** `main`
**Alcance:** convertir los pesajes ya capturados en el indicador productivo estrella — la
**ganancia diaria de peso (GDP)** — como **regla única derivada**, correcta en todos los canales
(incluida la manga offline), y darle a Producción una **superficie web propia** (curva de peso,
GDP por lote, condición corporal).

> Registro histórico del sprint. Cierres previos: [`p6-tasks-completion.md`](./p6-tasks-completion.md),
> [`p7-notifications-completion.md`](./p7-notifications-completion.md),
> [`p7-fase2-push-device-completion.md`](./p7-fase2-push-device-completion.md).

---

## 1. Objetivo

El GDP (`adg_since_last`) ya existía, pero como **regla duplicada** (calculada en el path REST y en
el seed) y **ausente en el canal de sync**: los pesajes capturados **en la manga offline** —el
flujo central del MVP— llegaban con `adg_since_last = null`, quedando fuera de la ficha del animal,
del KPI del dashboard y del reporte por lote. P8 unifica el GDP como **una sola regla, derivada del
orden real de pesajes**, y expone Producción como módulo con su propia página.

## 2. Alcance implementado

- **P8-1 — GDP como regla única derivada** (backend): vista `v_weighings` que calcula el GDP con
  una ventana (`LAG`) sobre los pesajes ordenados; los tres lectores (ficha, dashboard, reporte de
  producción) migran a la vista; REST y seed dejan de calcular/almacenar `adg_since_last`.
- **P8-2.a — Endpoints de Producción** (backend): `production-weight-series` (curva de peso por
  mes, filtrable por lote) y `condition-distribution` (distribución de condición corporal por
  rangos), sobre `v_weighings`.
- **P8-2.b — Página web `/produccion`**: curva de peso, GDP por lote y condición corporal, con
  filtros de período y lote; ruta real en el sidebar.

## 3. Arquitectura final

```
   REST /animals/:id/events        Sync móvil (manga offline)
   (inserta peso, sin adg)         WeighingSyncHandler (inserta peso, sin adg)
              └───────────────┬───────────────┘
                        weighings (tabla)
                              │
                      VIEW v_weighings   ← GDP derivado: LAG(weight) por
                      (regla ÚNICA)        (tenant, animal) ORDER BY weighed_at
                              │
        ┌─────────────────────┼─────────────────────────┐
   Ficha del animal      Dashboard (avg_adg)       reports.*
   (curva + adg)         KPI GDP                   production / weight-series /
                                                   condition-distribution
                              │
                        Web /produccion (curva · GDP por lote · CC)
```

Invariantes clave:
- **Una sola definición de GDP** (la vista), correcta **sin importar el orden de llegada** del
  sync (un pesaje retro-fechado recalcula el posterior automáticamente).
- **Todos los canales convergen**: el pesaje capturado offline produce el mismo GDP que el REST.
- **Fuente única de lectura**: ficha, dashboard y reportes leen de `v_weighings`; nadie recalcula.

## 4. Decisiones arquitectónicas importantes

- **Derivar en lectura, no almacenar** (enfoque A): elimina la clase de bug de "adg desactualizado
  por desorden" y respeta la regla permanente #1 (una regla de negocio en un solo lugar). La
  columna `adg_since_last` queda vestigial (no se escribe ni se lee); su `DROP` se difiere.
- **Orden estable**: la ventana ordena por `(weighed_at, created_at, id)` para un desempate
  determinista; primer pesaje → `null`; `GREATEST(1, Δdías)` y redondeo a 3, idénticos a la fórmula
  previa (los números REST no se mueven).
- **CC en rangos accionables**: «Flaca» `< 2.5` · «Óptima» `2.5–3.5` · «Gorda» `> 3.5`; se toma la
  **última CC por animal activo** a la fecha (reutiliza el predicado de "presente a fecha" del
  inventario); animales sin CC se excluyen.
- **Web sin dependencias de gráficos**: se reutiliza `WeightChart` (SVG inline) para la curva y
  barras CSS para GDP/CC; la página `/produccion` convive con el tab de Reportes (comparten
  endpoint), sin duplicar lógica.

## 5. Criterios de aceptación cumplidos

- Un pesaje capturado **por sync móvil** produce GDP correcto en ficha, dashboard y reportes (antes
  daba `null`).
- La **llegada desordenada** (retro-fechado) recalcula el GDP del pesaje posterior.
- Los números de los pesajes REST **no cambian** (misma fórmula).
- `/produccion` muestra curva de peso, GDP por lote y distribución de CC, con filtros de período y
  lote; el tab de Reportes sigue funcionando.

## 6. Métricas finales

| Métrica | Valor |
|---|---|
| Vitest (`audit:arch`) | **374 tests** en verde (incl. `weighing-adg.integration`) |
| Ciclos de dependencia (madge) | **0** |
| E2E de API | `weighing-adg-e2e` (GDP derivado, desorden, regresión REST) + `production-reports-e2e` (serie + CC, 10 checks) |
| Playwright E2E (web) | `12-produccion` (3 secciones con datos, filtro, regresión `/reportes`) |
| Typechecks | API, web, móvil, sync-core, domain, design-tokens limpios |
| Architecture gates | invariantes intactos |

## 7. Decisiones diferidas y trabajo futuro

Diferidas de forma consciente:

- **`DROP COLUMN weighings.adg_since_last`**: hoy vestigial (no se escribe ni lee); limpieza en una
  migración posterior no destructiva.
- **Curva de peso por animal individual** en `/produccion` (hoy es promedio del lote/hato).
- **Serie histórica por lote** con lote **al momento del pesaje** (hoy filtra por lote actual del
  animal, criterio consistente con el reporte de producción).
- **Export CSV** desde `/produccion` (hoy vive en el tab de Reportes).
- Indicadores de producción avanzados (GDP objetivo por categoría, alertas de bajo GDP).

## 8. Estado del roadmap

**P8 → COMPLETO.** El GDP es una regla única derivada, correcta en todos los canales (incluida la
manga offline), y Producción tiene su página propia — terminado, verificado y estable en `main`.

**Siguiente fase: próximo vertical del roadmap, por definir.** Mismo método: análisis previo
aprobado antes de código, olas pequeñas y revisables, verificación completa y un commit por ola.
