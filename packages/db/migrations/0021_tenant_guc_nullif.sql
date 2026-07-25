-- El tenant vacío rompía la RLS en PostgreSQL real (no en PGlite).
--
-- PostgreSQL **no desfija** un GUC personalizado al terminar la transacción: después de un
-- `SET LOCAL app.tenant_id = …`, al cerrar la tx el parámetro vuelve a CADENA VACÍA, no a
-- indefinido. Comprobado contra PostgreSQL 17:
--
--   antes de cualquier SET   → current_setting('app.tenant_id', true) = NULL  → NULL::uuid, OK
--   después de un SET LOCAL  → current_setting('app.tenant_id', true) = ''    → ''::uuid, ERROR
--
-- Con PGlite eso nunca se ve: hay UNA sola conexión. Con PostgreSQL real hay un POOL, así que toda
-- conexión que ya atendió una request autenticada queda devolviendo '' para siempre. Cualquier
-- consulta posterior FUERA de una request toma una de esas conexiones y muere con
-- «invalid input syntax for type uuid: ""».
--
-- El que lo destapó fue el worker de importación, que sondea cada 2 segundos:
--   UPDATE import_batches SET status='processing' … RETURNING id, tenant_id
-- Reventaba en bucle, la API no terminaba de levantar y `readyz` nunca respondía: eso tenía trabado
-- el workflow de Release, o sea el pipeline de publicación entero.
--
-- Las policies ESTÁNDAR se arreglan solas: `rlsMigration()` las regenera en cada arranque desde
-- RLS_TABLES. Las dos BESPOKE viven en migraciones YA APLICADAS (0002 y 0003) y ésas no se pueden
-- editar —el guardarraíl de checksum aborta el arranque, con razón: una migración aplicada es
-- historia—. Por eso se recrean acá, idénticas salvo el NULLIF.
--
-- `NULLIF(…, '')` devuelve NULL para la cadena vacía, y comparar contra NULL no da filas: sin
-- tenant no se ve nada, que es el fail-closed que se busca. La excepción por `app.job_scope` no
-- cambia: es la que permite al worker descubrir trabajo de cualquier tenant.

DROP POLICY IF EXISTS tenant_isolation ON import_batches;
CREATE POLICY tenant_isolation ON import_batches
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.job_scope', true) = 'import_worker')
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
              OR current_setting('app.job_scope', true) = 'import_worker');

DROP POLICY IF EXISTS tenant_isolation ON notification_deliveries;
CREATE POLICY tenant_isolation ON notification_deliveries
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         OR current_setting('app.job_scope', true) = 'push_worker')
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
              OR current_setting('app.job_scope', true) = 'push_worker');
