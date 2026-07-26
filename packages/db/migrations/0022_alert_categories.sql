-- Categorías de alerta: la lista completa, de una sola vez (Fase 1.0).
--
-- El motor de alertas hoy vigila reproducción, sanidad, tareas, sync y clima. La Fase 1 le conecta
-- las fuentes que ignora —stock, cobranzas, laboratorio, calidad de leche, mantenimiento,
-- certificaciones, series fiscales—, y varias no entran en ninguna categoría existente.
--
-- **Se migra UNA vez con la lista entera y no de a una.** Ensanchar un CHECK cinco veces son cinco
-- migraciones, cinco despliegues y cinco oportunidades de que una categoría quede escrita distinto
-- en el código y en la base.
--
-- `alerts.category` NO tiene CHECK (es varchar libre): la restricción vive solo acá, en el catálogo
-- de reglas, que es donde importa.
--
-- Las dos nuevas y por qué:
--
--   · `machinery` — mantenimiento por horas/km. No es `task` (no lo agenda una persona, lo dispara
--     el uso de la máquina) ni `inventory` (no es un insumo que se consume).
--
--   · `compliance` — certificaciones por vencer Y series fiscales por agotarse. Parecen cosas
--     distintas y son la misma familia: **papel que se vence o se acaba y que BLOQUEA una
--     operación**. Sin certificación no se vende; sin formas libres no se factura. Separarlas en
--     `traceability` y `fiscal` daría dos categorías de una alerta cada una, que fragmenta el
--     filtro de la UI sin darle nada al usuario.
--
-- Lo de laboratorio y calidad de leche va a `health` a propósito: un recuento celular alto es
-- mastitis subclínica, o sea un problema sanitario, no «un dato del tambo».

ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS alert_rules_category_check;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_category_check
  CHECK (category IN ('health','inventory','reproduction','iot','finance','task','machinery','compliance'));
