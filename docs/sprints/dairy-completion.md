# Tambo/Leche (TB-1 → TB-3) · Cierre de sprint

**Estado:** ✅ COMPLETO · **Rama:** `main` · **Vertical 13 de Fase 2.**
**Alcance:** tanques, producción diaria por vaca, entregas al comprador y calidad de leche, con la web
del módulo.

> Registro histórico del sprint. Cierres previos en `docs/sprints/`.

---

## 1. Objetivo

Gestionar el tambo (operación lechera): registrar la **producción diaria** individual de cada vaca, las
**entregas** de leche a un comprador y los **tests de calidad**, con el análisis de producción del
tambo.

## 2. Alcance implementado (una ola por commit)

- **TB-1 — Producción:** `milk_tanks` (maestro) + `milk_production_daily` (litros por vaca/día, hecho
  único con upsert).
- **TB-2 — Entregas + calidad:** `milk_deliveries` (comprador = cliente, importe derivado) +
  `milk_quality_tests` (grasa/proteína/RCS, polimórfico animal/tanque).
- **TB-3 — Web + análisis:** `/tambo` (3 pestañas: producción/entregas/calidad) +
  `GET /dairy/production/by-day` (total del tambo por día).

## 3. Arquitectura y reglas únicas

```
   milk_tanks (maestro)
   milk_production_daily(animal, production_date, total_liters)  [UNIQUE animal+fecha → UPSERT (corrige)]
        └─► GET /dairy/production/by-day = Σ litros, n° vacas, promedio por vaca (por día)
   milk_deliveries(tank?, buyer=CLIENTE, liters, price_per_liter)  → amount DERIVADO = liters × precio
   milk_quality_tests(animal XOR tank, fat/protein/scc)            → exactamente una referencia
```

- **Producción como hecho único (upsert):** `milk_production_daily` es UNIQUE(animal, fecha); re-cargar
  el mismo día ACTUALIZA (ON CONFLICT), no da 409 — natural para una carga diaria que se corrige.
- **Comprador = cliente:** `milk_deliveries.buyer_id` → FK a `customers` (mismo patrón que el
  frigorífico en Faena). El **importe es derivado** (`liters × price_per_liter`), no persistido.
- **Calidad polimórfica con exactamente una referencia:** un test refiere a un animal O un tanque
  (ninguno o ambos → 400).
- **Análisis derivado:** el total del tambo por día se agrega de `milk_production_daily` en la lectura.

## 4. Decisiones importantes

- **`buyer_id` es un `customers.id`** (satélite), no `business_partners.id`: para el nombre se une
  `customers → business_partners` vía `partner_id`.
- **Diferidos:** enganche de la entrega a una venta (`sale_id`) sin generarla; `lab_sample_id` en
  calidad (el módulo de laboratorio no está activo); sin máquina de estados (son hechos).
- **Fix RLS de 4 tablas** (patrón recurrente): `milk_tanks` + `milk_production_daily` (TB-1) +
  `milk_deliveries` + `milk_quality_tests` (TB-2).
- **Módulo `dairy` propio;** valida animal/tanque/comprador por lectura directa, sin acoplar (0 ciclos).

## 5. Métricas finales

| Métrica | Valor |
|---|---|
| Vitest (`audit:arch`) | **565 tests** (TB-1 producción + TB-2 entregas/calidad) |
| Ciclos de dependencia (madge) | **0** |
| Guardias RLS `.mjs` (no-super) | milk_tanks · milk_production_daily · milk_deliveries · milk_quality_tests |
| Playwright E2E (web) | `37-tambo` (cargar producción → total del día) |

## 6. Trabajo diferido

- **Entrega → venta/factura** (generar el documento comercial y el ingreso).
- **Litros del tanque en tiempo real** (device_id/IoT) y balance producción vs entregas.
- **Alertas de calidad** (RCS por encima del umbral, grasa/proteína fuera de rango).
- **Curva de lactancia** por vaca (producción a lo largo del tiempo) y ranking de vacas.
- **Costo del litro** (integrar con Nutrición/Finanzas).

## 7. Estado del roadmap

**Tambo/Leche → COMPLETO.** Tanques, producción diaria, entregas y calidad, más la web con análisis,
estables en `main`, en su propio bounded context.

**Siguiente: por definir.** Queda **Partes de trabajo** (`work_logs`, completa RRHH) como último
candidato operativo; el resto de tablas dormidas son extensiones/infra más nicho (labs, marketplace,
sensores/IoT, cursos, contratos). Mismo método.
