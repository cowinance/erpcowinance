-- Agrupar las alertas que son UN SOLO TRABAJO (Fase 1.4).
--
-- El motor genera una alerta por animal, y está bien que así sea: la agenda diaria necesita marcar
-- animal por animal, y la manga necesita saber de CUÁL se trata. El problema es la LISTA que lee
-- una persona.
--
-- Medido sobre el tenant demo: de 43 alertas abiertas, 24 eran `health/info` y se repartían así:
--   10× «Desparasitación de destete»
--   10× «Primovacunación Aftosa»
--    4× «Vacunación programada»
--
-- Veinte líneas para dos trabajos. El operario va a la manga UNA vez y desparasita a los diez
-- terneros en la misma sesión: son diez animales, no diez decisiones. Y una lista que repite lo
-- mismo veinte veces es exactamente la fatiga que el plan quería evitar — se deja de leer, y con
-- ella se pierden las alertas que sí importaban.
--
-- `group_key` es la clave EXPLÍCITA de agrupación, que la calcula quien genera la alerta. La
-- alternativa era parsear el título por el guion («Desparasitación de destete — caravana 301»), y
-- eso se rompe el día que alguien cambia un texto: la agrupación se caería en silencio y nadie se
-- enteraría hasta que la lista volviera a tener veinte líneas.
--
-- NULL = no agrupa, que es lo correcto para todo lo que ya es único por entidad (un termo, una
-- factura, una máquina). Solo se llena donde varias alertas son el mismo trabajo.
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS group_key varchar(255);

COMMENT ON COLUMN alerts.group_key IS 'Clave de agrupación para alertas que son un solo trabajo (misma tarea sanitaria, misma fecha). NULL = no agrupa';

-- Índice parcial: solo las que agrupan. La lista filtra por tenant y estado, y agrupa por esta
-- clave; sin índice, cada lectura del panel ordenaría 300 filas a mano.
CREATE INDEX IF NOT EXISTS ix_alerts_group_key ON alerts (tenant_id, group_key) WHERE group_key IS NOT NULL;
