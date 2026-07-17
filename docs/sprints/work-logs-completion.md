# Cierre de sprint — Partes de trabajo (WL-1)

**Estado:** COMPLETO. Vertical 14 de Fase 2. Cierra la captura de mano de obra que quedó diferida en
Maquinaria y Agricultura (las horas del empleado son de RRHH, no del recurso).

## 1. Qué se construyó

- **`work_logs`**: horas de un empleado en un día, con imputación OPCIONAL a una tarea (P6) y a una
  finca. Vive DENTRO del módulo RRHH (extiende H-1/H-2), no en un módulo propio.
- **API** `hr/work-logs`: list (filtros por empleado/tarea/finca/rango de fechas), get, create,
  update, delete (baja lógica), y `summary` (resumen por empleado en un período).
- **Web** `/rrhh/partes` (tercera pestaña de RRHH): registrar horas + resumen por empleado + lista de
  partes con borrado.

## 2. Regla única (dominio)

- **`validateWorkLogHours`** (`packages/domain/src/hr/work-log.ts`): la invariante real y única es la
  de las HORAS — finitas, > 0, ≤ 24 (un día natural), redondeadas a 3 decimales. Un solo lugar,
  compartido por los tres canales (ADR-0006). Lanza `InvalidWorkLogError` → el servicio la mapea a 400.

## 3. Derivados (no se persisten)

- **`summary`**: horas totales y días trabajados por empleado en un período. Los **días son fechas
  DISTINTAS con parte** (dos partes el mismo día cuentan un día) — `COUNT(DISTINCT work_date)`.

## 4. Decisiones importantes

- **Costo de mano de obra DIFERIDO:** el maestro `employees` NO tiene tarifa horaria (el importe vive
  en la liquidación, H-2). Derivar costo = horas × tarifa requeriría una tarifa por empleado —
  diferido, a integrar con Finanzas cuando exista el segundo caso que lo demuestre (sin
  sobreingeniería anticipada).
- **RLS ya presente:** a diferencia de otros verticales, `work_logs` ya trae `tenant_isolation` en el
  DDL canónico — no hubo fix de tabla dormida. Igual se dejó la guardia `.mjs` no-super.
- **Ubicación:** partes = RRHH (no maquinaria/agricultura). `task_id`→tasks (P6) y `farm_id`→farms
  permiten imputar el parte. Sin máquina de estados (son hechos).

## 5. Métricas finales

| Métrica | Valor |
|---|---|
| Vitest (`audit:arch`) | **575 tests** (desde 565 en el cierre de Tambo → +4 dominio, +6 integración) |
| Ciclos de dependencia (madge) | **0** |
| Guardia RLS `.mjs` (no-super) | work_logs |
| Verificación web | login → crear empleado → registrar parte (8 h, tarea + finca) → resumen `8 h · 1 d`; horas 30 → 400 «no puede superar 24» |

## 6. Trabajo diferido

- **Costeo de mano de obra** (horas × tarifa horaria del empleado) e integración con Finanzas.
- **Imputación a `crop_operations`/`machinery`** (hoy solo tarea/finca; el DDL base no lo modela).
- **Aprobación/bloqueo** de partes (hoy son hechos editables).

## 7. Estado del roadmap

**Partes de trabajo → COMPLETO.** Captura de horas, resumen derivado y web, estables en `main`,
dentro del bounded context de RRHH.

**Siguiente: por definir.** Candidatos operativos restantes (tablas dormidas): Laboratorio
(`labs`/`lab_samples`/`lab_results`, desbloquea `lab_sample_id` de calidad de leche), Esquila
(`shearing_records`), Análisis de suelo (`soil_analyses`, cierra Agricultura). Mismo método.
