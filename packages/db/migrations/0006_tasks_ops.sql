-- Tareas como centro operativo: historial/trazabilidad + recurrencia.
-- task_events es server-authored (no sincroniza a devices). El indice unico PARCIAL sobre
-- rule_key deduplica las tareas AUTOGENERADAS: una viva por (regla, entidad).

CREATE TABLE IF NOT EXISTS task_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind varchar(24) NOT NULL CHECK (kind IN ('created','status_change','rescheduled','assigned','priority_change','comment')),
  from_value text,
  to_value text,
  note text,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_task_events_task ON task_events (task_id, occurred_at);
-- Recurrencia (E5): plantilla + intervalo; genera la próxima tarea al completar.
CREATE TABLE IF NOT EXISTS task_recurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  farm_id uuid REFERENCES farms(id) ON DELETE SET NULL,
  title varchar(255) NOT NULL,
  description text,
  type varchar(255) NOT NULL DEFAULT 'general',
  priority varchar(255) NOT NULL DEFAULT 'normal',
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  related_type varchar(255),
  related_id uuid,
  interval_days int NOT NULL CHECK (interval_days > 0),
  anchor varchar(16) NOT NULL DEFAULT 'due_date' CHECK (anchor IN ('due_date','completed_at')),
  next_due date NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_task_recurrences_tenant ON task_recurrences (tenant_id, active);
-- Clave de dedup para tareas AUTOGENERADAS (E4): una tarea viva por (regla, entidad).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS rule_key varchar(255);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS ux_tasks_rule_key_live
  ON tasks (tenant_id, rule_key) WHERE rule_key IS NOT NULL AND deleted_at IS NULL AND status IN ('pending','in_progress');
