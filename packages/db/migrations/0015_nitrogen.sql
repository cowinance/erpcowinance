-- Nitrógeno del termo (GT-4).
--
-- Es la etapa que más plata protege de todo el vertical: un termo que se queda sin nitrógeno
-- destruye todo lo que tiene adentro, en silencio, y te enterás cuando abrís. Puede haber años de
-- genética ahí.
--
-- `storage_tanks.nitrogen_level` venía del esquema canónico como `varchar` —una etiqueta suelta,
-- «alto»/«bajo»— y nunca se usó. No se puede proyectar nada con eso. Se lo deja quieto y se agrega
-- lo que sí es medible: mediciones fechadas y recargas.

-- Cuánto tarda el proveedor en traer el nitrógeno. Es lo que decide si una alerta es un aviso o una
-- urgencia: el umbral no es el nivel del termo sino si todavía se llega a pedir.
ALTER TABLE storage_tanks ADD COLUMN IF NOT EXISTS refill_lead_days smallint;

CREATE TABLE IF NOT EXISTS cryo_nitrogen_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  tank_id uuid NOT NULL REFERENCES storage_tanks(id) ON DELETE CASCADE,
  reading_date date NOT NULL,
  -- Centímetros de líquido, que es como se mide en el campo: con una regla. Numeric y no entero
  -- porque las reglas marcan medios centímetros y redondear introduciría error en el consumo, que
  -- es una diferencia de pocos centímetros por semana.
  level_cm numeric(8,2) NOT NULL CHECK (level_cm >= 0),
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
-- Dos mediciones del mismo termo el mismo día se pisan: la segunda corrige a la primera. Sin esto,
-- una carga repetida metería una caída de cero días en el cálculo del consumo.
CREATE UNIQUE INDEX IF NOT EXISTS ux_nitrogen_readings_dia
  ON cryo_nitrogen_readings (tank_id, reading_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_nitrogen_readings_tenant ON cryo_nitrogen_readings (tenant_id, tank_id, reading_date DESC);

CREATE TABLE IF NOT EXISTS cryo_nitrogen_refills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  tank_id uuid NOT NULL REFERENCES storage_tanks(id) ON DELETE CASCADE,
  refill_date date NOT NULL,
  liters numeric(10,2) NOT NULL CHECK (liters > 0),
  -- Nivel al que quedó el termo después de cargar. Opcional: si se mide, arranca el ciclo nuevo sin
  -- esperar a la próxima visita.
  level_after_cm numeric(8,2) CHECK (level_after_cm >= 0),
  -- El nitrógeno líquido es un insumo como cualquier otro: se compra, se guarda y se consume. Por
  -- eso el movimiento va al kardex de inventario y no a un contador propio — mismo criterio que nos
  -- llevó a NO poner las pajuelas ahí: cada cosa con su dueño, una sola fuente por número.
  item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  stock_movement_id uuid REFERENCES stock_movements(id) ON DELETE SET NULL,
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_nitrogen_refills_tenant ON cryo_nitrogen_refills (tenant_id, tank_id, refill_date DESC);

ALTER TABLE cryo_nitrogen_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cryo_nitrogen_readings FORCE ROW LEVEL SECURITY;
ALTER TABLE cryo_nitrogen_refills ENABLE ROW LEVEL SECURITY;
ALTER TABLE cryo_nitrogen_refills FORCE ROW LEVEL SECURITY;
