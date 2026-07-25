-- Series de numeración fiscal (G4-2).
--
-- El productor emite por FORMA LIBRE de imprenta autorizada, no por máquina fiscal. Con máquina el
-- número lo asigna el aparato y el sistema solo lo registra después; acá el correlativo es NUESTRO
-- y respondemos por él. De ahí que esto sea una tabla y no un campo de texto.
--
-- Son DOS series por empresa, no una con dos columnas, porque tienen alcances distintos:
--   · `document` — correlativo del emisor, UNO POR TIPO. Factura y nota de crédito no se pisan.
--   · `control`  — número de control del lote de la imprenta. ÚNICO SOBRE TODOS LOS TIPOS, porque
--                  identifica el PAPEL y no el documento: dos comprobantes distintos impresos en la
--                  misma forma serían el mismo control.
--
-- Por qué no una `sequence` de PostgreSQL, que sería lo natural: las secuencias NO vuelven atrás a
-- propósito (para no serializar). Si la emisión falla después de pedir el número, la secuencia deja
-- el hueco igual, y un correlativo fiscal con huecos hay que justificarlo ante el SENIAT. Acá el
-- número se toma con `SELECT … FOR UPDATE` DENTRO de la transacción del comprobante: si el
-- comprobante no se guarda, el número vuelve solo. Eso serializa la emisión, que es exactamente lo
-- que se quiere y a ritmo de finca no cuesta nada.

CREATE TABLE IF NOT EXISTS fiscal_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,

  purpose varchar(16) NOT NULL CHECK (purpose IN ('document','control')),
  -- NULL solo para `control`, que es una sola serie para todos los tipos. La unicidad de más abajo
  -- se apoya en esa diferencia.
  document_type varchar(32) CHECK (document_type IN ('invoice','credit_note','debit_note','delivery_note')),

  prefix varchar(4),
  padding smallint NOT NULL DEFAULT 8 CHECK (padding BETWEEN 1 AND 12),

  -- El próximo a entregar (no el último entregado): así una serie recién creada arranca en su
  -- primer número sin restarle uno a nada, y «agotada» es simplemente next > range_to.
  next_number bigint NOT NULL CHECK (next_number >= 1),
  -- Lote autorizado por la imprenta. NULL en la serie de documento, que no tiene tope.
  range_from bigint,
  range_to bigint,
  CHECK (range_to IS NULL OR range_from IS NULL OR range_to >= range_from),

  -- Trazabilidad del lote: cuando el SENIAT pregunta de dónde salió una forma, la respuesta es esto.
  printer_name varchar(255),
  printer_tax_id varchar(16),
  authorization_code varchar(64),
  authorized_at date,

  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS ix_fiscal_series_tenant_id ON fiscal_series (tenant_id);

-- Una sola serie ACTIVA por destino. Es el guardarraíl central del módulo: dos series activas para
-- el mismo destino significan dos correlativos avanzando en paralelo, o sea números repetidos, que
-- es el peor error posible acá — se descubre cuando el cliente presenta dos facturas iguales.
-- El `coalesce` mete a `control` (document_type NULL) en el mismo índice sin un índice aparte.
CREATE UNIQUE INDEX IF NOT EXISTS ux_fiscal_series_active
  ON fiscal_series (tenant_id, company_id, purpose, coalesce(document_type, '*'))
  WHERE is_active AND deleted_at IS NULL;

COMMENT ON TABLE fiscal_series IS 'Serie de numeración fiscal: correlativo del emisor o lote de formas libres de la imprenta';
COMMENT ON COLUMN fiscal_series.purpose IS 'document = correlativo por tipo; control = número de control del lote (único sobre todos los tipos)';
COMMENT ON COLUMN fiscal_series.next_number IS 'Próximo número A ENTREGAR (no el último entregado)';
COMMENT ON COLUMN fiscal_series.range_to IS 'Fin del lote autorizado; NULL = sin tope';
