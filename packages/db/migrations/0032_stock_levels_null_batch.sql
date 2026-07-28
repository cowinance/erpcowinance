-- El saldo de un ítem SIN lote podía partirse en dos filas.
--
-- `stock_levels` tiene UNIQUE (item_id, warehouse_id, batch_id), y en PostgreSQL los NULL son
-- distintos entre sí: dos filas con el mismo ítem, el mismo depósito y `batch_id` NULL NO violan esa
-- restricción. La mayoría de los ítems no llevan lote, así que el hueco cubre el caso normal.
--
-- Para que ocurra hace falta concurrencia: `applyToLevel` busca la fila con FOR UPDATE y la inserta
-- si no está, pero FOR UPDATE no bloquea una fila que todavía no existe. Dos movimientos simultáneos
-- del mismo ítem —dos personas en la manga, o el móvil sincronizando mientras alguien carga en la
-- web— encuentran las dos que no hay nada y las dos insertan.
--
-- El resultado no es un error: es un saldo partido en dos filas que nadie suma. El galpón tiene 150
-- y el sistema dice 100 en una fila y 50 en otra, y todo lo que cuelga del saldo queda mal.
--
-- No se puede reproducir en desarrollo porque PGlite tiene una sola conexión; se cierra por lo que
-- dice el motor, no por lo que se pudo observar.
--
-- Con este índice el segundo INSERT falla de forma RUIDOSA y la operación se reintenta, en vez de
-- corromper el saldo en silencio. Un error que se ve es mejor que un número que miente.
CREATE UNIQUE INDEX IF NOT EXISTS "ux_stock_levels_sin_lote"
  ON "stock_levels" ("item_id", "warehouse_id")
  WHERE "batch_id" IS NULL;
