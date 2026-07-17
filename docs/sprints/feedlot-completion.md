# Cierre de sprint — Engorde y feedlot (C2 · FL-1)

**Estado:** COMPLETO. Vertical 16 de Fase 2. Módulo `feedlot` propio. Completa la Suite C · Sistemas
productivos (junto a C1·Tambo). **Verificado contra el Catálogo Maestro de Módulos** — es un módulo
real [Fase 2], a diferencia de Esquila/Análisis de suelo que son sub-features de otros módulos.

## 1. Qué se construyó

- **Capa de análisis SIN tablas propias.** Un corral de engorde = un `lot` con `purpose='fattening'`.
  Compone datos ya existentes: consumo de alimento (`feed_deliveries`), peso y GDP (`v_weighings`,
  regla única de P8) y animales activos del lote (`animals.current_lot_id`).
- **API** `feedlot/lots` (KPIs por corral) y `feedlot/lots/:id` (detalle + desglose por animal).
  `?target=<kg>` habilita la proyección de días a terminación.
- **Web** `/engorde`: panel de corrales con KPIs + input de peso objetivo (re-fetch en vivo). Ítem de
  sidebar en Gestión.

## 2. Regla única (dominio)

- **`computeFeedlotMetrics`** (`packages/domain/src/production/feedlot.ts`, junto a `computeDressingPct`):
  - `conversion` = kg alimento / kg ganado (null sin ganancia).
  - `costPerKgGained` = costo alimento / kg ganado (null sin ganancia).
  - `daysToFinish` = ⌈(objetivo − peso actual) / GDP⌉ (null sin objetivo, GDP ≤ 0, o ya alcanzado).

## 3. Derivados (SQL, no se persisten)

- head (animales activos), feed_kg/feed_cost (Σ feed_deliveries), avg_weight_kg y avg_adg (última
  pesada por animal, promedio — **GDP a corral reusando `v_weighings`, no re-derivado**), kg_gained
  (Σ última − primera pesada por animal).

## 4. Decisiones importantes

- **Sin tablas nuevas ni fix RLS** — reusa `lots`/`feed_deliveries`/`weighings`/`animals`, todas ya en
  `RLS_TABLES`. Primer vertical de pura composición (a diferencia de los que activaban tablas dormidas).
- **GDP como fuente única:** el corral reusa `v_weighings` (ADR-0007), no recalcula la ganancia.
- **Módulo `feedlot` propio;** bounded context de gestión, distinto de land/herd (0 ciclos).
- **Verificación de rumbo (a pedido):** se consultó el Catálogo Maestro. Esquila = feature de
  «Producción y pesajes» (B4); Análisis de suelo = parte de «Agricultura» (D1). Ninguno es vertical
  propio; se descartaron. C2·Feedlot y C3·Cría-recría SÍ son módulos [Fase 2].

## 5. Métricas finales

| Métrica | Valor |
|---|---|
| Vitest (`audit:arch`) | **589 tests** (desde 581 → +4 dominio, +4 integración) |
| Ciclos de dependencia (madge) | **0** |
| RLS | sin cambios (reusa tablas ya protegidas) |
| Verificación web | corral «Engorde Otoño» (12 cab.): peso prom. 393,1 · GDP 1,27 · kg ganados 1.664; objetivo 480 → 69 días a terminar |

## 6. Trabajo diferido

- **Conversión/costo con datos reales:** el seed no tiene `feed_deliveries` para el corral (dan 0). La
  fórmula quedó probada en el test de integración con datos controlados (880 kg / 110 kg = conversión
  8; $440 / 110 = costo/kg 4).
- **Días a corral e ingreso de tropa:** no hay fecha de ingreso al corral en el modelo; se puede
  derivar de la primera pesada o de un movimiento; diferido.
- **Margen por tropa** (compra − venta − alimento) integrando Compras/Ventas y Faena.
- **bunk management** (lectura de comedero) y dietas por fase.

## 7. Estado del roadmap

**Engorde y feedlot → COMPLETO.** Panel de corrales con KPIs derivados y proyección, estable en
`main`, en su propio bounded context.

**Siguiente: por definir.** Para completar la Suite C queda **C3 · Cría y recría** (Fase 2: eficiencia
por vientre, destete, reemplazos — capa de análisis sobre Reproducción + Pastoreo). Mismo método.
