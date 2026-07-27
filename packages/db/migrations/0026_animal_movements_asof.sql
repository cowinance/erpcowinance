-- Índice para la resolución AS-OF del lote de un animal.
--
-- La pregunta «¿en qué lote estaba este animal el día que se lo pesó?» se contesta buscando su
-- último movimiento anterior a esa fecha:
--
--   SELECT to_lot_id FROM animal_movements
--    WHERE animal_id = … AND moved_at <= … AND to_lot_id IS NOT NULL
--    ORDER BY moved_at DESC LIMIT 1
--
-- La tabla tenía índice por `animal_id` SOLO, sin `moved_at`. Con eso cada consulta traía todos los
-- movimientos del animal y los ordenaba; y como esa subconsulta corre POR CADA PESAJE de cada
-- ventana de pastoreo, el costo se multiplica.
--
-- Medido sobre 3.000 animales, 18.576 pesajes y 3.000 movimientos:
--
--   rendimiento de potrero    1.521 ms  →  61 ms   (25×)
--   /reports/farm-summary     1.640 ms  → ~180 ms  (era el 93% del reporte)
--
-- No se veía con los 66 animales del demo, donde `animal_movements` estaba casi vacía. Apareció al
-- sembrar volumen CON HISTORIA: el mismo hato pero sin movimientos daba 104 ms.
--
-- El índice es PARCIAL y en el orden en que se pregunta:
--   · `deleted_at IS NULL` y `to_lot_id IS NOT NULL` son las condiciones fijas de la consulta —
--     dejarlas fuera del índice obligaría a leer filas que se van a descartar;
--   · `moved_at DESC` para que el `ORDER BY … LIMIT 1` sea un salto al primer registro, sin ordenar.
CREATE INDEX IF NOT EXISTS ix_animal_movements_asof
  ON animal_movements (tenant_id, animal_id, moved_at DESC)
  WHERE deleted_at IS NULL AND to_lot_id IS NOT NULL;
