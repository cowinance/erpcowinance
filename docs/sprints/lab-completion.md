# Cierre de sprint — Laboratorio (LAB-1 + LAB-2)

**Estado:** COMPLETO. Vertical 15 de Fase 2. Módulo `lab` propio. Desbloquea el `lab_sample_id` que
quedó diferido en calidad de leche (TB-2), mortalidad, evaluaciones genéticas y análisis de suelo.

## 1. Qué se construyó

- **`labs`** (LAB-1): maestro de laboratorios por tenant (type genetics/pathology/milk/soil/serology/
  other, contact jsonb). CRUD + baja lógica.
- **`lab_samples`** (LAB-1): muestras con **máquina de estados** collected→sent→in_progress→
  completed/rejected. Tipo validado (blood/tissue/milk/soil/hair/semen/feces/other), animal y potrero
  OPCIONALES (referencia contextual), lab opcional, barcode.
- **`lab_results`** (LAB-2): resultados por muestra (test_code, result_value, result_data jsonb,
  reference_range, is_abnormal). Solo se cargan sobre una muestra ya enviada.
- **API** `lab/labs`, `lab/samples` (+ `:id/status`), `lab/samples/:id/results` (un prefijo `lab`).
- **Web** `/laboratorio` (Muestras: alta + estados + panel de resultados) y `/laboratorio/laboratorios`
  (maestro). Nuevo ítem de sidebar en Gestión.

## 2. Reglas (servicio, convención de máquinas de estado)

- **`TRANSITIONS`** de la muestra (regla única): idempotente en el mismo estado, **409** en transición
  inválida (no se puede saltar de `sent` a nada que no esté permitido; `completed`/`rejected` son
  terminales). Igual patrón que guías (T-1) y certificaciones (T-2).
- **Resultados solo sobre muestra enviada** (`sent`/`in_progress`/`completed`) → **409** si está
  `collected` o `rejected`. Al pasar a `sent` se sella `sent_at`.

## 3. Derivados (no se persisten)

- `is_open` (status ∉ {completed, rejected}), `result_count`, `abnormal_count` por muestra —
  subconsultas en la lectura.

## 4. Decisiones importantes

- **RLS — fix de 3 tablas dormidas + 1 retroactiva.** `labs`/`lab_samples`/`lab_results` traían la
  policy dispersa sobre `app.current_tenant` (que la app nunca fija → denegaría en prod no-super); se
  agregan a `RLS_TABLES` (reciben la estándar `tenant_isolation` sobre `app.tenant_id`) y se dropea la
  dispersa. **Se detectó y corrigió el mismo bug latente en `work_logs`** (vertical 14): también
  quedó fuera de `RLS_TABLES`. RLS forzada pasó de 86 → **90 tablas**.
- **Módulo `lab` propio;** valida animal/potrero/lab por lectura directa, sin acoplar (0 ciclos).
- **Cross-link diferido:** el vínculo real desde calidad de leche/mortalidad/genética/suelo hacia una
  muestra (`lab_sample_id`) queda para cuando cada módulo lo necesite; este vertical construye la
  infraestructura de muestras que lo habilita.

## 5. Métricas finales

| Métrica | Valor |
|---|---|
| Vitest (`audit:arch`) | **581 tests** (desde 575 → +6 integración de lab) |
| Ciclos de dependencia (madge) | **0** |
| Guardia RLS `.mjs` (no-super) | labs · lab_samples · lab_results |
| RLS forzada | 86 → **90 tablas** (labs×3 + work_logs retroactivo) |
| Verificación web | crear lab → muestra (sangre, animal, lab) → Enviar → resultado GLU + HB anormal → «Resultados (2, 1⚠)» + badge Anormal |

## 6. Trabajo diferido

- **Cross-link efectivo** de `lab_sample_id` desde calidad de leche, mortalidad, evaluaciones
  genéticas y análisis de suelo.
- **`document_id`** en el resultado (adjuntar el PDF del informe) cuando el módulo de documentos se
  active.
- **Alertas por resultado anormal** (integrar con el motor de alertas existente).

## 7. Estado del roadmap

**Laboratorio → COMPLETO.** Maestro, muestras con máquina de estados y resultados, más la web,
estables en `main`, en su propio bounded context.

**Siguiente: por definir.** Candidatos operativos restantes: Esquila (`shearing_records`), Análisis de
suelo (`soil_analyses`, ahora puede referir muestras de lab). Mismo método.
