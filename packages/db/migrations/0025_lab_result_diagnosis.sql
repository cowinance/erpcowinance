-- El resultado de laboratorio ya no queda huérfano del caso clínico (Fase 3.1).
--
-- `lab_results` guardaba `test_code` (texto libre), `result_value` e `is_abnormal`. Con eso se sabe
-- que ALGO está fuera de rango, y no se sabe QUÉ ES. Son dos hechos distintos y hasta ahora el
-- sistema solo podía representar el primero:
--
--   test_code='BRUC-RB'  result_value='positivo'  is_abnormal=true
--
-- Un humano lee eso y entiende «brucelosis». El sistema no, y por eso el lazo hacia Sanidad
-- terminaba dependiendo de que alguien se acordara de abrir el caso a mano.
--
-- Se podría haber inferido el diagnóstico machacando `test_code` contra `diagnoses.code`. No: es
-- texto libre que carga cada laboratorio a su manera, y una inferencia que acierta a veces es peor
-- que ninguna en salud animal — el día que no matchea, nadie se entera de que no se abrió el caso.

-- El laboratorio informó QUÉ encontró. Opcional a propósito: la mayoría de los análisis son
-- valores de referencia sin diagnóstico asociado (perfil mineral, hemograma), y ésos siguen
-- necesitando criterio veterinario. Que sea NULL es información, no un dato faltante.
ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS diagnosis_id uuid REFERENCES diagnoses(id) ON DELETE SET NULL;

-- El caso que este resultado abrió (o al que se sumó). Cierra el círculo en las dos direcciones:
-- desde el caso se llega a la evidencia que lo motivó, y desde el resultado se ve que ya se actuó.
-- Sin esto, un segundo análisis del mismo animal volvería a abrir un caso por el mismo motivo.
ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS clinical_case_id uuid REFERENCES clinical_cases(id) ON DELETE SET NULL;

-- La pregunta que se hace en cada carga de resultado: «¿este animal ya tiene un caso por esto?».
CREATE INDEX IF NOT EXISTS ix_lab_results_case ON lab_results (tenant_id, clinical_case_id) WHERE deleted_at IS NULL;
