-- Plan de servicio por animal (GT-3).
--
-- Hasta acá, servir un lote aplicaba UN toro a todo el grupo: `completeStep` con un solo
-- `semen_batch_id` para los 30 vientres. El plan lo reemplaza — la 001 va con el embrión del termo
-- 207, la 002 con semen de otro toro — y cada una con su pajuela concreta reservada desde antes.

-- ── Reserva ──────────────────────────────────────────────────────────────────
--
-- Una pajuela reservada sigue físicamente en el termo, pero ya tiene dueña. Sin este estado se
-- pueden planificar 30 servicios sobre 20 pajuelas y el problema aparece recién en el corral, con
-- los animales ya sincronizados y sin vuelta atrás.
ALTER TABLE cryo_straws DROP CONSTRAINT IF EXISTS cryo_straws_status_check;
ALTER TABLE cryo_straws ADD CONSTRAINT cryo_straws_status_check
  CHECK (status IN ('stored','reserved','used','lost','discarded','sold'));

ALTER TABLE cryo_straws ADD COLUMN IF NOT EXISTS reserved_for_animal_id uuid REFERENCES animals(id) ON DELETE SET NULL;

-- Una pajuela reservada para DOS vientres sería una reserva que no reserva nada. El índice lo hace
-- imposible incluso si dos usuarios planifican a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS ux_cryo_straws_reserva
  ON cryo_straws (id) WHERE status = 'reserved' AND deleted_at IS NULL;

-- ── Apta / no apta ───────────────────────────────────────────────────────────
--
-- La revisión (ecografía: ¿hizo cuerpo lúteo?) es un paso del protocolo, y su resultado es por
-- ANIMAL. Vive junto al vientre dentro de la campaña y no en una tabla aparte porque no tiene vida
-- propia: fuera de su campaña, «apta» no quiere decir nada.
ALTER TABLE repro_protocol_assignment_animals
  ADD COLUMN IF NOT EXISTS eligibility varchar(16) NOT NULL DEFAULT 'pending'
  CHECK (eligibility IN ('pending','eligible','not_eligible'));
ALTER TABLE repro_protocol_assignment_animals ADD COLUMN IF NOT EXISTS eligibility_at timestamptz;
ALTER TABLE repro_protocol_assignment_animals ADD COLUMN IF NOT EXISTS eligibility_notes text;

-- ── El plan ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS repro_service_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  assignment_id uuid NOT NULL REFERENCES repro_protocol_assignments(id) ON DELETE CASCADE,
  animal_id uuid NOT NULL REFERENCES animals(id) ON DELETE CASCADE,

  method varchar(24) NOT NULL CHECK (method IN ('ai','embryo_transfer')),
  semen_batch_id uuid REFERENCES semen_batches(id) ON DELETE RESTRICT,
  embryo_id uuid REFERENCES embryos(id) ON DELETE RESTRICT,
  -- El método y el origen tienen que concordar: un plan cruzado no se puede ejecutar, y eso se
  -- descubriría con la vaca en la manga.
  CONSTRAINT ck_service_plan_origen CHECK (
    (method = 'ai'              AND semen_batch_id IS NOT NULL AND embryo_id IS NULL) OR
    (method = 'embryo_transfer' AND embryo_id      IS NOT NULL AND semen_batch_id IS NULL)
  ),

  -- La pajuela reservada. Puede faltar: se planifica el toro primero y se elige la unidad después.
  straw_id uuid REFERENCES cryo_straws(id) ON DELETE SET NULL,

  status varchar(16) NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','served','released')),
  -- Qué servicio ejecutó el plan. Con esto se puede comparar lo planificado con lo que pasó: si el
  -- técnico usó otra pajuela, el desvío queda a la vista en vez de perderse.
  breeding_event_id uuid REFERENCES breeding_events(id) ON DELETE SET NULL,
  served_at timestamptz,
  notes text,

  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- Un vientre, un plan por campaña. Replanificar reemplaza el que había; dos planes vivos para la
-- misma vaca serían dos pajuelas reservadas para un solo servicio.
CREATE UNIQUE INDEX IF NOT EXISTS ux_service_plan_animal
  ON repro_service_plans (assignment_id, animal_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_service_plan_tenant ON repro_service_plans (tenant_id, assignment_id, status);

ALTER TABLE repro_service_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE repro_service_plans FORCE ROW LEVEL SECURITY;
