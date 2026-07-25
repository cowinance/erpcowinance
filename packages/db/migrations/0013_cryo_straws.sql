-- Pajuelas con identidad propia (GT-2).
--
-- Hasta acá el stock era un CONTADOR: `semen_batches.straws_available = 20`. Eso alcanza para saber
-- cuánto queda y no alcanza para nada más.
--
-- Con EMBRIONES el contador además PIERDE información, y ya la venía perdiendo. Una fila decía
-- «tengo 4 embriones de esta donante con este toro», pero esos 4 no son intercambiables: cada uno
-- tiene su estadio y su grado. Al transferir se restaba 1 de 4 y desaparecía para siempre cuál de
-- los cuatro entró en esa receptora. Nadie lo había notado porque el campo nunca se usó en serio.
--
-- Con SEMEN la genética ya estaba cubierta por la partida (todas las pajuelas de un lote son el
-- mismo toro, de la misma colecta). Lo que la identidad agrega es otra cosa: VERIFICAR LA EJECUCIÓN
-- — qué pajuela entró de verdad, no cuál decía el plan. Es lo único que atrapa la confusión de
-- canastilla, que es el error que de verdad ocurre en el campo.

CREATE TABLE IF NOT EXISTS cryo_straws (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,

  kind varchar(16) NOT NULL CHECK (kind IN ('semen','embryo')),
  semen_batch_id uuid REFERENCES semen_batches(id) ON DELETE RESTRICT,
  embryo_id uuid REFERENCES embryos(id) ON DELETE RESTRICT,
  -- Una pajuela es UNA cosa: o semen o embrión, nunca las dos ni ninguna. La restricción va en la
  -- base y no solo en el servicio porque una fila sin origen sería stock fantasma imposible de
  -- rastrear hasta su compra.
  CONSTRAINT ck_cryo_straws_origen CHECK (
    (kind = 'semen'  AND semen_batch_id IS NOT NULL AND embryo_id IS NULL) OR
    (kind = 'embryo' AND embryo_id      IS NOT NULL AND semen_batch_id IS NULL)
  ),

  -- NULL = «sin ubicar»: existe, pero todavía nadie abrió el termo a inventariarla. Es el estado en
  -- que quedan todas las que había antes de esta migración, y refleja la verdad.
  goblet_id uuid REFERENCES cryo_goblets(id) ON DELETE SET NULL,

  -- El código impreso en la pajuela. Opcional a propósito: al comprar se cargan «20 pajuelas del
  -- toro X» sin transcribir 20 códigos; el código se anota recién al usarla, que es cuando alguien
  -- la tiene en la mano y puede leerlo.
  code varchar(64),

  status varchar(16) NOT NULL DEFAULT 'stored'
    CHECK (status IN ('stored','used','lost','discarded','sold')),
  status_reason varchar(64),

  -- Trazabilidad exacta del consumo: qué servicio la usó. Es lo que responde «¿qué le pusimos a la
  -- 001?» con la pajuela concreta y no solo con la partida.
  breeding_event_id uuid REFERENCES breeding_events(id) ON DELETE SET NULL,
  used_at timestamptz,

  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- El saldo pasa a ser DERIVADO: contar filas disponibles. Este índice es el que hace que contarlas
-- salga barato, porque la cuenta se hace en cada listado de partidas.
CREATE INDEX IF NOT EXISTS ix_cryo_straws_semen ON cryo_straws (tenant_id, semen_batch_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_cryo_straws_embryo ON cryo_straws (tenant_id, embryo_id, status) WHERE deleted_at IS NULL;
-- Y éste responde la otra pregunta: «¿qué hay en este gobelete?».
CREATE INDEX IF NOT EXISTS ix_cryo_straws_goblet ON cryo_straws (tenant_id, goblet_id) WHERE deleted_at IS NULL;

ALTER TABLE cryo_straws ENABLE ROW LEVEL SECURITY;
ALTER TABLE cryo_straws FORCE ROW LEVEL SECURITY;

-- ── Migración del stock existente ────────────────────────────────────────────
--
-- Cada unidad del contador se convierte en una fila SIN UBICAR. No se inventa una posición: el
-- sistema no sabe dónde están, y decir «están en el termo 1» sería peor que decir «no sé», porque
-- alguien lo creería. Quedan visibles como pendientes de ubicar hasta que se abra el termo.
INSERT INTO cryo_straws (tenant_id, kind, semen_batch_id, status, notes)
SELECT b.tenant_id, 'semen', b.id, 'stored', 'Migrada del saldo anterior; falta ubicarla en el termo.'
FROM semen_batches b, generate_series(1, b.straws_available)
WHERE b.deleted_at IS NULL AND b.straws_available > 0;

INSERT INTO cryo_straws (tenant_id, kind, embryo_id, status, notes)
SELECT e.tenant_id, 'embryo', e.id, 'stored', 'Migrada del saldo anterior; falta ubicarla en el termo.'
FROM embryos e, generate_series(1, e.straws_available)
WHERE e.deleted_at IS NULL AND e.straws_available > 0;

-- Los contadores se van. Dejarlos sería tener DOS fuentes para el mismo número —exactamente el bug
-- que nos costó caro en presupuestos con LEDGER_COUNTS— y un día no coinciden.
ALTER TABLE semen_batches DROP COLUMN IF EXISTS straws_available;
ALTER TABLE embryos DROP COLUMN IF EXISTS straws_available;

-- `semen_batches.canister` era la ubicación vieja en texto libre. NO se borra: es justamente la
-- pista que necesita quien va a hacer el inventario físico para saber en qué termo buscar. Se
-- expone como dato heredado, de solo lectura, hasta que las pajuelas tengan posición real.
COMMENT ON COLUMN semen_batches.canister IS 'Ubicación heredada en texto libre (pre GT-2). Solo lectura: la ubicación real vive en cryo_straws.goblet_id.';
