-- Asignaciones de protocolo reproductivo a un lote (R-2.b): materializan un protocolo IATF
-- en tareas (P6). Tablas nuevas; RLS estandar via RLS_TABLES.

CREATE TABLE IF NOT EXISTS repro_protocol_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  protocol_id uuid NOT NULL REFERENCES repro_protocols(id) ON DELETE RESTRICT,
  lot_id uuid REFERENCES lots(id) ON DELETE SET NULL,
  start_date date NOT NULL,
  animal_count int NOT NULL DEFAULT 0,
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','canceled')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_repro_assignments_tenant ON repro_protocol_assignments (tenant_id, status);
-- Reproducción E4: objetivo (lote/categoría/selección/hato), snapshot de animales y pasos completados.
ALTER TABLE repro_protocol_assignments ADD COLUMN IF NOT EXISTS target_type varchar(16) NOT NULL DEFAULT 'lot';
ALTER TABLE repro_protocol_assignments ADD COLUMN IF NOT EXISTS category_code varchar(255);
ALTER TABLE repro_protocol_assignments ADD COLUMN IF NOT EXISTS completed_steps jsonb NOT NULL DEFAULT '[]';
CREATE TABLE IF NOT EXISTS repro_protocol_assignment_animals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  assignment_id uuid NOT NULL REFERENCES repro_protocol_assignments(id) ON DELETE CASCADE,
  animal_id uuid NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, animal_id)
);
CREATE INDEX IF NOT EXISTS ix_repro_assignment_animals ON repro_protocol_assignment_animals (tenant_id, assignment_id);
