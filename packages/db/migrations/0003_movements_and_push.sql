-- Movimientos neutrales (M-1.a, P3) + entregas push por dispositivo (P7-3).
-- El indice unico PARCIAL de animal_movements (movement_id NOT NULL) garantiza un solo hecho
-- por (operacion, animal) ante reproceso de changeset o reintento REST, sin chocar con las
-- filas heredadas (movement_id NULL).
-- notification_deliveries lleva politica BESPOKE (app.job_scope=push_worker), como
-- import_batches: por eso NO esta en RLS_TABLES.

ALTER TABLE animal_movements ADD COLUMN IF NOT EXISTS origin varchar(16);
ALTER TABLE animal_movements ADD COLUMN IF NOT EXISTS movement_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS ux_animal_movements_movement
  ON animal_movements (tenant_id, movement_id, animal_id) WHERE movement_id IS NOT NULL;

-- Deduplicación de notificaciones (P7-1): una entrega por (usuario, canal, alerta). Incluye
-- channel para no colisionar entre in_app y push sobre la misma alerta en el futuro.
CREATE UNIQUE INDEX IF NOT EXISTS ux_notifications_alert_user
  ON notifications (tenant_id, user_id, channel, alert_id) WHERE alert_id IS NOT NULL AND deleted_at IS NULL;

-- Entregas push por dispositivo (P7-3): la notificación lógica push (notifications) es por
-- usuario/alerta; cada dispositivo activo con token genera una entrega independiente, con su
-- propio estado/reintentos/token_snapshot → se puede reintentar/invalidar solo el fallido y
-- evitar dobles envíos por claim. RLS estándar vía RLS_TABLES.
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  notification_id uuid NOT NULL REFERENCES notifications (id) ON DELETE CASCADE,
  sync_device_id uuid NOT NULL REFERENCES sync_devices (id) ON DELETE CASCADE,
  token_snapshot varchar(255) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  attempt_count int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  processing_at timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_notification_deliveries_device
  ON notification_deliveries (tenant_id, notification_id, sync_device_id);
CREATE INDEX IF NOT EXISTS ix_notification_deliveries_claim
  ON notification_deliveries (status, next_attempt_at);

-- Política RLS BESPOKE (P7-3.b), como import_batches: tenant normal + EXCEPCIÓN de
-- descubrimiento del worker de push (app.job_scope='push_worker'), que el
-- PushDeliveryClaimRepository fija SOLO en su tx de reclamo. Por eso NO va en RLS_TABLES.
ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON notification_deliveries;
CREATE POLICY tenant_isolation ON notification_deliveries
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid
         OR current_setting('app.job_scope', true) = 'push_worker')
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid
              OR current_setting('app.job_scope', true) = 'push_worker');
