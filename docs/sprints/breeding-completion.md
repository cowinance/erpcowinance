# Cierre de sprint — Cría y recría (C3)

**Estado:** COMPLETO. Vertical 17 de Fase 2. Módulo `breeding` propio. **Cierra la Suite C · Sistemas
productivos** (C1·Tambo + C2·Feedlot + C3·Cría-recría; C4·Marketplace es Fase 4).

## 1. Qué se construyó

- **Capa de análisis SIN tablas propias** (segundo vertical de pura composición, tras Feedlot). Compone
  reproducción (`breeding_events`, `pregnancies`), destete (`weanings`), estructura del rodeo
  (`animals` + `animal_categories`) y superficie (`paddocks.area_ha`).
- **API** `GET /breeding/summary?from&to` — índices de eficiencia del rodeo de cría en el período
  (por defecto, últimos 12 meses).
- **Web** `/cria`: panel de KPIs + selector de período (re-fetch en vivo). Ítem de sidebar en Gestión,
  junto a Tambo/Engorde/Faena.

## 2. Regla única (dominio)

- **`computeBreedingKpis`** (`packages/domain/src/reproduction/breeding-kpis.ts`):
  - `pregnancyRate` = preñeces / entoradas (%).
  - `weaningRate` = ternero destetado / vaca entorada (el índice productivo por excelencia; puede
    superar 1).
  - `replacementRate` = vaquillonas / vacas (%) — estructura del rodeo, no de período.
  - `kgWeanedPerHa` = Σ peso al destete / superficie.
  - Todas → null cuando el denominador es 0 (no se inventa cociente).

## 3. Composición (SQL)

- **Servicio/entore** = `breeding_events.type IN ('service_natural','service_ai','embryo_transfer')`
  (excluye celo y sincronización). «Entorada» = hembra distinta con un servicio en el período.
- Categorías por `animal_categories.code` (`vaca`, `vaquillona`) — catálogo global estable.
- Edad al primer servicio (meses) = avg((primer servicio − birth_date)/30.44) sobre hembras con fecha.

## 4. Decisiones importantes

- **No duplica P9.** El reporte reproductivo de P9 (`reports.service.reproduction`) *cuenta* el flujo del
  período (servicios/preñeces/partos/destetes/IEP). C3 *deriva las tasas* de eficiencia del rodeo de
  cría y agrega kg/ha, % reposición y edad al primer servicio. Los conteos siguen la misma definición
  que P9 para consistencia.
- **Sin tablas nuevas ni fix RLS** — reusa breeding_events/pregnancies/weanings/animals/
  animal_categories/paddocks (ya en RLS_TABLES o catálogo global).
- **Módulo `breeding` propio;** bounded context de gestión, distinto de reproduction/herd/land (0 ciclos).

## 5. Métricas finales

| Métrica | Valor |
|---|---|
| Vitest (`audit:arch`) | **594 tests** (desde 589 → +3 dominio, +2 integración) |
| Ciclos de dependencia (madge) | **0** |
| RLS | sin cambios (reusa tablas ya protegidas) |
| Verificación web | período 12m: destete/entore 0,118 · kg/ha 0,7 · preñez 141,2% · reposición 17,8% (8/45) · edad 1er servicio 71,5 m |

El test de integración cruza cada agregado del servicio con una consulta independiente a la misma base
(prueba la composición SQL real, sin números mágicos), y verifica que un período vacío deja en null las
tasas de período pero mantiene la reposición (estructural).

## 6. Notas de datos (no son bugs)

- **Preñez > 100%** en el demo: las preñeces diagnosticadas en el período y las hembras entoradas en el
  período son cohortes distintas; con la definición de conteo (igual a P9) el cociente puede pasar de
  100%. Honesto, es artefacto del seed.
- **weaningRate bajo** (0,118): el demo tiene solo 2 destetes. La fórmula quedó probada en dominio con
  datos controlados (82/100 = 0,82; 12/10 = 1,2).

## 7. Trabajo diferido

- **Selección/descarte asistido** de vientres por edad/fertilidad/producción (recomendación).
- **Peso objetivo de servicio** de vaquillonas (desarrollo de reemplazos) y curva de recría.
- **Carga animal** (stocking rate) y planificación por potrero, integrando Pastoreo.
- Índices por rodeo/potrero (hoy es a nivel finca).

## 8. Estado del roadmap

**Cría y recría → COMPLETO. Suite C · Sistemas productivos CERRADA** (Tambo + Feedlot + Cría-recría).

**Siguiente: por definir.** Candidatos de Fase 2 pendientes según el Catálogo Maestro: Suite G (Costos y
rentabilidad, Tesorería, Facturación electrónica), Suite F (CRM, Contratos), Suite A (Documentos,
multiempresa). Verificar fase exacta antes de elegir.
