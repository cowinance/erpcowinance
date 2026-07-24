-- Importacion de datos del ERP (P2 oleada 2.4).
-- import_batches lleva RLS forzada + excepcion de DESCUBRIMIENTO (app.job_scope=import_worker)
-- para que el procesador reclame trabajo cross-tenant; ningun path de request fija ese GUC.
-- import_rows recibe la politica estandar via RLS_TABLES.
-- La FK COMPUESTA (tenant_id, batch_id) -> (tenant_id, id) impide ESTRUCTURALMENTE asociar
-- una fila al batch de otro tenant, aun ante un bug de codigo.

CREATE TABLE IF NOT EXISTS import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_type varchar(64) NOT NULL DEFAULT 'animal',
  source_filename varchar(255),
  file_ref varchar(255),
  mapping jsonb,
  reconcile_mode varchar(32) NOT NULL DEFAULT 'create_skip_duplicates',
  status varchar(32) NOT NULL DEFAULT 'uploaded',
  phase varchar(16),
  total_rows int NOT NULL DEFAULT 0,
  created_count int NOT NULL DEFAULT 0,
  skipped_count int NOT NULL DEFAULT 0,
  invalid_count int NOT NULL DEFAULT 0,
  error_count int NOT NULL DEFAULT 0,
  heartbeat_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS ck_import_batches_status;
ALTER TABLE import_batches ADD CONSTRAINT ck_import_batches_status CHECK (
  status IN ('uploaded','mapped','previewed','queued','processing','completed','completed_with_errors','failed'));
CREATE INDEX IF NOT EXISTS ix_import_batches_discovery ON import_batches (status, created_at);

CREATE TABLE IF NOT EXISTS import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  row_number int NOT NULL,
  raw jsonb NOT NULL,
  normalized jsonb,
  status varchar(16) NOT NULL DEFAULT 'pending',
  skip_reason varchar(64),
  errors jsonb,
  warnings jsonb,
  resulting_entity_id uuid,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, row_number)
);
ALTER TABLE import_rows DROP CONSTRAINT IF EXISTS ck_import_rows_status;
ALTER TABLE import_rows ADD CONSTRAINT ck_import_rows_status CHECK (
  status IN ('pending','created','skipped','invalid','error'));
CREATE INDEX IF NOT EXISTS ix_import_rows_batch ON import_rows (batch_id, row_number);

-- FK compuesta y su UNIQUE de respaldo (orden de dependencia: FK primero al dropear).
ALTER TABLE import_rows DROP CONSTRAINT IF EXISTS fk_import_rows_batch;
ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS uq_import_batches_tenant_id_id;
ALTER TABLE import_batches ADD CONSTRAINT uq_import_batches_tenant_id_id UNIQUE (tenant_id, id);
ALTER TABLE import_rows ADD CONSTRAINT fk_import_rows_batch
  FOREIGN KEY (tenant_id, batch_id) REFERENCES import_batches (tenant_id, id);

-- RLS de import_batches: tenant + excepción de descubrimiento del worker.
-- import_rows recibe la política estándar vía rlsMigration (RLS_TABLES).
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON import_batches;
CREATE POLICY tenant_isolation ON import_batches
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid
         OR current_setting('app.job_scope', true) = 'import_worker')
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid
              OR current_setting('app.job_scope', true) = 'import_worker');
