-- Ubicación criogénica: termo → canasta → gobelete (GT-1).
--
-- `storage_tanks` ya existía en el esquema canónico, con RLS forzada y con claves foráneas desde
-- semen_batches.tank_id y embryos.tank_id. Los servicios de genética YA validaban ese tank_id...
-- contra una tabla que ningún endpoint podía llenar. O sea: el campo existía, se validaba, y nunca
-- podía tener un valor. Una tabla dormida.
--
-- Esta migración la despierta y le agrega la profundidad que tiene la cosa física. Hasta ahora la
-- ubicación de una partida era `semen_batches.canister varchar(255)`: una nota suelta, imposible
-- de usar para buscar. Y buscar es lo único que se hace frente a un termo — con guante, en vapor a
-- −196 °C, cada apertura evaporando nitrógeno.

-- El código es cómo la finca nombra el termo hablando: «el 207», «el 003». Es distinto del nombre,
-- que es opcional, porque nadie dice «el termo de la sala de inseminación».
ALTER TABLE storage_tanks ADD COLUMN IF NOT EXISTS code varchar(32);
ALTER TABLE storage_tanks ADD COLUMN IF NOT EXISTS serial_number varchar(32);
ALTER TABLE storage_tanks ADD COLUMN IF NOT EXISTS notes text;

-- `capacity` venía del esquema canónico sin semántica definida y sin un solo uso. Se la deja quieta
-- y se agrega una columna que dice qué mide, en vez de reinterpretar una columna ambigua: un termo
-- se mide en CANASTAS, no en pajuelas, y confundir las dos unidades haría que el control de
-- capacidad rechace cargas válidas.
ALTER TABLE storage_tanks ADD COLUMN IF NOT EXISTS canister_capacity integer;

-- El nombre deja de ser obligatorio: el identificador real pasa a ser el código.
ALTER TABLE storage_tanks ALTER COLUMN name DROP NOT NULL;

-- Dos termos con el mismo código en la misma finca serían indistinguibles al hablar, que es
-- justamente para lo que sirve el código. El índice es parcial: un termo dado de baja libera su
-- código para el que lo reemplace.
CREATE UNIQUE INDEX IF NOT EXISTS ux_storage_tanks_code
  ON storage_tanks (tenant_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;

CREATE TABLE IF NOT EXISTS cryo_canisters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  tank_id uuid NOT NULL REFERENCES storage_tanks(id) ON DELETE RESTRICT,
  code varchar(32) NOT NULL,
  -- El color es el criterio REAL de búsqueda («la azul 2»), no un adorno. Por eso es columna propia
  -- y no parte del nombre: sobre una columna se puede filtrar y ordenar.
  color varchar(32),
  goblet_capacity integer,
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cryo_canisters_code
  ON cryo_canisters (tank_id, code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_cryo_canisters_tenant ON cryo_canisters (tenant_id, tank_id);

CREATE TABLE IF NOT EXISTS cryo_goblets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  canister_id uuid NOT NULL REFERENCES cryo_canisters(id) ON DELETE RESTRICT,
  code varchar(32) NOT NULL,
  color varchar(32),
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cryo_goblets_code
  ON cryo_goblets (canister_id, code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_cryo_goblets_tenant ON cryo_goblets (tenant_id, canister_id);

-- RLS: mismo patrón convergente que el resto (la política se agrega desde rlsMigration al arrancar,
-- acá solo se habilita para que una tabla nueva no quede jamás sin aislamiento entre fincas).
ALTER TABLE cryo_canisters ENABLE ROW LEVEL SECURITY;
ALTER TABLE cryo_canisters FORCE ROW LEVEL SECURITY;
ALTER TABLE cryo_goblets ENABLE ROW LEVEL SECURITY;
ALTER TABLE cryo_goblets FORCE ROW LEVEL SECURITY;
