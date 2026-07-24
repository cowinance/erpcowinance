-- Infra de sync, credenciales y outbox de eventos.
-- Cursor global de changesets, versiones HLC por campo (LWW), login, refresh tokens con
-- rotacion, tokens de accion por email y outbox de eventos de dominio (F5, ADR-0005).
-- Los changesets de origen SERVIDOR (P2 oleada 2.2, ADR-0016) usan (tenant_id, origin_ref)
-- como clave de idempotencia: sync_device_id y seq quedan NULL (la seq NO se falsea) y el
-- CHECK prohibe estados hibridos.

CREATE SEQUENCE IF NOT EXISTS sync_changesets_server_seq;
ALTER TABLE sync_changesets ADD COLUMN IF NOT EXISTS server_seq bigint DEFAULT nextval('sync_changesets_server_seq');
CREATE INDEX IF NOT EXISTS ix_sync_changesets_server_seq ON sync_changesets (tenant_id, server_seq);
-- Changesets de origen servidor (P2 oleada 2.2, ADR-0016): habilita propagar
-- entidades creadas server-side (importación) a dispositivos ya bootstrapeados,
-- vía pull, SIN dispositivo ni secuencia sintéticos. Para source='server',
-- sync_device_id y seq son NULL (seq NO se falsea); la idempotencia la da
-- (tenant_id, origin_ref). El CHECK prohíbe estados híbridos. Orden deliberado:
-- se rellena la columna source (default 'device') ANTES del CHECK, así las
-- filas existentes (todas device) ya satisfacen la forma válida. CHECK idempotente
-- por drop+add (sin plpgsql; PGlite-safe). Esta migración NO inserta filas
-- server (eso llega con el procesador) y NO toca el pull ni los tipos remotos
-- (commit 2.3).
ALTER TABLE sync_changesets ADD COLUMN IF NOT EXISTS source varchar(16) NOT NULL DEFAULT 'device';
ALTER TABLE sync_changesets ADD COLUMN IF NOT EXISTS origin_ref varchar(128);
ALTER TABLE sync_changesets ALTER COLUMN sync_device_id DROP NOT NULL;
ALTER TABLE sync_changesets ALTER COLUMN seq DROP NOT NULL;
ALTER TABLE sync_changesets DROP CONSTRAINT IF EXISTS ck_sync_changesets_source_shape;
ALTER TABLE sync_changesets ADD CONSTRAINT ck_sync_changesets_source_shape CHECK (
  (source = 'device' AND sync_device_id IS NOT NULL AND seq IS NOT NULL AND origin_ref IS NULL)
  OR
  (source = 'server' AND sync_device_id IS NULL AND seq IS NULL AND origin_ref IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sync_changesets_server_origin
  ON sync_changesets (tenant_id, origin_ref) WHERE source = 'server';
ALTER TABLE sync_conflicts ADD COLUMN IF NOT EXISTS detail text;
CREATE TABLE IF NOT EXISTS sync_row_state (
  tenant_id uuid NOT NULL,
  table_name varchar(255) NOT NULL,
  row_id uuid NOT NULL,
  versions jsonb DEFAULT '{}' NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (tenant_id, table_name, row_id)
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash varchar(255);
-- Verificación de email (P1.1): la columna existe desde ya; el envío y la
-- exposición en el token/perfil son P1.2. auth no la lee todavía.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  jti uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  rotated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL
);
-- Tokens de acción por email (P1.2, ADR-0011): verificación de email y reset
-- de contraseña. SIN RLS a propósito (plano de identidad, como users y
-- auth_refresh_tokens): se consumen en flujos @Public sin contexto de tenant,
-- resueltos por user_id embebido en la fila. Se guarda el HASH del token, no
-- el token en claro (que viaja solo en el email). Un solo token vivo por
-- (user, purpose): issue() supersede los previos. Single-use vía consumed_at.
CREATE TABLE IF NOT EXISTS email_action_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  purpose varchar(32) NOT NULL,
  token_hash varchar(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_email_action_tokens_hash ON email_action_tokens (token_hash);
CREATE INDEX IF NOT EXISTS ix_email_action_tokens_user ON email_action_tokens (user_id, purpose);
-- Outbox de eventos de dominio (F5, ADR-0005). Sin RLS a propósito (como
-- auth_refresh_tokens): el relay es un proceso interno de confianza que
-- drena cross-tenant post-commit. tenant_id se guarda para trazabilidad.
CREATE TABLE IF NOT EXISTS event_outbox (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  type varchar(255) NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  published_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_event_outbox_unpublished ON event_outbox (created_at) WHERE published_at IS NULL;
