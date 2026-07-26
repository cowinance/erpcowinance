-- Clave de LOTE para tareas generadas juntas (Fase 1.5).
--
-- Cierra lo que quedó abierto en la 1.4: el agrupado de alertas está construido pero no colapsa las
-- tareas sanitarias reales, porque no había una clave que dijera «estas son el mismo trabajo».
--
-- **Por qué no alcanza `rule_key`**, que a primera vista parecería el campo indicado:
--
--   CREATE UNIQUE INDEX ux_tasks_rule_key_live ON tasks (tenant_id, rule_key) WHERE …
--
-- Es una clave de UNICIDAD: garantiza UNA tarea viva por clave, y existe para deduplicar tareas
-- autogeneradas. Es exactamente lo contrario de lo que hace falta acá — ponerle el mismo valor a
-- diez animales violaría el índice. Una identifica un trabajo, la otra identifica una fila.
--
-- **Por qué no alcanza el título.** El título ya trae la caravana («Desparasitación de destete —
-- caravana 301») y lo arma el código de producción, no solo el seed. Agrupar partiéndolo por el
-- guion funcionaría hasta que alguien edite esa línea, y entonces la agrupación se caería EN
-- SILENCIO: la lista volvería a tener veinte renglones y nadie sabría por qué.
--
-- `batch_key` es explícita, la llena quien materializa el plan, y NO es única: varias tareas la
-- comparten justamente porque son el mismo trabajo repartido en varios animales.
--
-- NULL = tarea suelta, que es lo correcto para todo lo que alguien crea a mano.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS batch_key varchar(255);

COMMENT ON COLUMN tasks.batch_key IS 'Agrupa tareas generadas juntas (mismo plan, mismo paso, misma fecha). NO es única, a diferencia de rule_key. NULL = tarea suelta';

-- Y el NOMBRE del trabajo, sin el animal. El título de la tarea trae la caravana
-- («Desparasitación de destete — caravana 301»), así que usarlo como encabezado del grupo daría
-- «… — caravana 301 · 10 animales», que se lee como si fuera sobre ESE animal. Guardar la etiqueta
-- aparte evita tener que recortar el título por el guion, que es la fragilidad que este diseño
-- viene esquivando.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS batch_label varchar(255);
COMMENT ON COLUMN tasks.batch_label IS 'Nombre del trabajo sin el animal, para encabezar el grupo de alertas';

CREATE INDEX IF NOT EXISTS ix_tasks_batch_key ON tasks (tenant_id, batch_key) WHERE batch_key IS NOT NULL AND deleted_at IS NULL;

-- El encabezado del grupo viaja hasta la alerta. Simétrico con `group_key` (migración 0023): el
-- motor lo calcula al evaluar, y la lista no tiene que ir a buscar la tarea para saber cómo
-- titular el grupo.
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS group_title varchar(255);
COMMENT ON COLUMN alerts.group_title IS 'Encabezado del grupo sin la entidad; NULL = usar el título individual';
