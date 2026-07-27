-- PLANO DE PLATAFORMA — administración del SISTEMA Cowinance, no de una finca.
--
-- Dos tablas nuevas, deliberadamente FUERA del plano de tenant:
--
--   platform_admins      quien es dueno/soporte/facturacion/auditor de Cowinance.
--   platform_audit_logs  bitacora GLOBAL de lo que hace ese panel.
--
-- POR QUE NO SE REUSA `roles` + `user_role_assignments`: esa dupla es RBAC DENTRO de una
-- organizacion (`user_role_assignments.tenant_id` es NOT NULL). El rol `owner` de ahi significa
-- "dueno de esta finca", no "dueno de Cowinance". Mezclarlos haria que agregar un rol de
-- plataforma fuera indistinguible de agregar un rol de finca, que es exactamente el error que
-- convierte a un cliente en administrador global.
--
-- POR QUE NO SE REUSA `audit_logs`: tiene `tenant_id NOT NULL` y policy de aislamiento por
-- tenant. Una accion global no tiene tenant al cual pertenecer, y si se le inventara uno la
-- bitacora quedaria visible desde el ERP de esa finca. Aca `target_tenant_id` es NULLABLE y es
-- el OBJETO de la accion, no su dueno.
--
-- NINGUNA de las dos tiene columna `tenant_id`: no son datos de finca. El guardarrail de
-- cobertura de RLS (rls-coverage.guardrail) solo exige `tenant_isolation` a las tablas que la
-- tienen, asi que no las reclama. Su proteccion es otra y vive en `platformMigration()`
-- (apps/api/src/db/rls.ts): RLS FORCE con una policy que exige el GUC `app.platform_read`, que
-- SOLO fija el modulo platform. Desde una sesion de tenant devuelven cero filas.

CREATE TABLE IF NOT EXISTS platform_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  role varchar(32) NOT NULL CHECK (role IN ('superadmin','support','billing','auditor')),
  -- Preparado para MFA, no dormido: `PLATFORM_MFA_ENFORCED=on` hace que el login RECHACE a un
  -- admin con mfa_required y sin `users.mfa_enabled`. Arranca en false porque todavia no hay
  -- flujo TOTP; el dia que lo haya, se prende la variable y el modelo ya esta.
  mfa_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  created_by uuid
);

CREATE INDEX IF NOT EXISTS idx_platform_admins_active ON platform_admins (user_id) WHERE disabled_at IS NULL;

CREATE TABLE IF NOT EXISTS platform_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  actor_email varchar(255),
  actor_role varchar(32),
  action varchar(160) NOT NULL,
  outcome varchar(16) NOT NULL DEFAULT 'ok' CHECK (outcome IN ('ok','denied','error')),
  target_type varchar(64),
  -- TEXTO y no uuid: el objeto de la accion no siempre es una fila (puede ser un email tecleado
  -- en el buscador, o un filtro). Un uuid obligaria a tirar justo el dato que se audita.
  target_id varchar(128),
  target_tenant_id uuid,
  detail jsonb NOT NULL DEFAULT '{}',
  ip_address varchar(64),
  user_agent varchar(255),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_occurred ON platform_audit_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_actor ON platform_audit_logs (actor_user_id, occurred_at DESC);
