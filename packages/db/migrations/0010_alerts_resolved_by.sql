-- Quien cerró la alerta: la PERSONA o el sistema.
--
-- El motor silencia 14 dias las alertas cerradas hace poco, para no recrear al toque algo que el
-- productor ya despacho. Pero hasta ahora no distinguia entre "el usuario la resolvio" y "la
-- condicion dejo de darse y el motor la auto-resolvio": las dos terminaban en status='resolved' y
-- las dos quedaban silenciadas.
--
-- Para las alertas de un animal casi no se nota. Para las de CLIMA (D4) es fatal: el estres
-- calorico se termina cada noche, asi que el motor la auto-resolvia y a la ola de calor siguiente
-- no avisaba nunca mas dentro de los 14 dias.
--
-- Con esta columna la regla queda explicita: se silencia solo lo que cerro una persona
-- (`resolved_by IS NOT NULL`). Lo que cerro el sistema puede volver a dispararse en cuanto la
-- condicion vuelva.

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS resolved_by uuid;
