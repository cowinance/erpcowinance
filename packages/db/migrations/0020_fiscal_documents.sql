-- Comprobantes fiscales (G4-4): emitir el papel con todo lo que la ley pide.
--
-- Se construye SOBRE `invoices` (F-3a) y no en una tabla nueva. La factura fiscal ES la factura: dos
-- tablas serían dos verdades del mismo documento, y el saldo que los pagos cancelan ya cuelga de
-- ésta. Una `invoices` recibida o de un tenant no venezolano simplemente deja los campos fiscales
-- en NULL.

-- ── Tratamiento de IVA por línea ───────────────────────────────────────────────────────────────
-- `tax_rate` sola NO alcanza para armar el comprobante: con 0 no se puede saber si la línea es
-- EXENTA o NO SUJETA, que es exactamente la distinción que el libro de ventas necesita en columnas
-- separadas. Y deducir el tratamiento comparando la tasa contra las alícuotas configuradas se rompe
-- solo: dos tratamientos pueden compartir tasa, y la tasa cambia por providencia mientras las
-- líneas viejas se quedan con la de su momento.
ALTER TABLE sale_lines ADD COLUMN IF NOT EXISTS vat_treatment varchar(16)
  CHECK (vat_treatment IN ('general','reduced','additional','exempt','not_subject'));
ALTER TABLE purchase_lines ADD COLUMN IF NOT EXISTS vat_treatment varchar(16)
  CHECK (vat_treatment IN ('general','reduced','additional','exempt','not_subject'));

COMMENT ON COLUMN sale_lines.vat_treatment IS 'Tratamiento ante el IVA; NULL = sin declarar (se asume general al emitir)';
COMMENT ON COLUMN purchase_lines.vat_treatment IS 'Tratamiento ante el IVA; NULL = sin declarar';

-- ── Razón social de quien emite ────────────────────────────────────────────────────────────────
-- `business_partners` la ganó en 0017 y la empresa quedó sin ella: en el comprobante va la razón
-- social del registro mercantil, que no tiene por qué ser el nombre con el que uno llama a su
-- propia empresa («La Esperanza» vs «AGROPECUARIA LA ESPERANZA, C.A.»). Falta en la punta emisora
-- es peor que en la receptora: sale mal en TODOS los comprobantes.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS legal_name varchar(255);
COMMENT ON COLUMN companies.legal_name IS 'Razón social del registro mercantil, para el comprobante. NULL = usar name';

-- ── Lo fiscal del comprobante ──────────────────────────────────────────────────────────────────
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS document_type varchar(32)
  CHECK (document_type IN ('invoice','credit_note','debit_note','delivery_note'));
-- El número de control es del PAPEL y va aparte del número de documento (`invoice_number`).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS control_number varchar(32);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS document_series_id uuid REFERENCES fiscal_series(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS control_series_id uuid REFERENCES fiscal_series(id) ON DELETE SET NULL;

-- CONGELADO al emitir, y es la decisión más importante de esta migración. Las alícuotas cambian por
-- providencia; si el desglose se recalculara al leer, una factura de hace seis meses cambiaría de
-- monto sola cuando cambie la tasa. Un comprobante emitido es un hecho, no una consulta.
-- Guarda también los datos fiscales de las dos puntas (RIF, razón social, condición) por lo mismo:
-- si el cliente corrige su RIF mañana, el comprobante ya impreso no puede reescribirse.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fiscal_snapshot jsonb;

-- Anulación. No es baja lógica: un comprobante anulado SIGUE EXISTIENDO y sigue ocupando su número
-- —por eso `deleted_at` no sirve acá—. El correlativo tiene que poder recorrerse entero, y un
-- número que desaparece es justamente el hueco que hay que justificar ante el SENIAT.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS voided_at timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS void_reason text;

-- Una nota de crédito o de débito NO se sostiene sola: modifica un comprobante anterior y tiene que
-- decir cuál.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS references_invoice_id uuid REFERENCES invoices(id) ON DELETE RESTRICT;

COMMENT ON COLUMN invoices.control_number IS 'Número de control del lote de formas libres (identifica el papel)';
COMMENT ON COLUMN invoices.fiscal_snapshot IS 'Desglose de IVA y datos fiscales CONGELADOS al emitir; un comprobante es un hecho, no una consulta';
COMMENT ON COLUMN invoices.voided_at IS 'Anulación; el comprobante sigue existiendo y sigue ocupando su número';
COMMENT ON COLUMN invoices.references_invoice_id IS 'Comprobante que esta nota de crédito/débito modifica';

-- El número de control identifica el papel: no puede repetirse dentro del tenant, ni siquiera entre
-- tipos distintos de comprobante. Parcial sobre los que lo tienen, así que las facturas recibidas y
-- las de tenants no venezolanos (control_number NULL) no molestan.
CREATE UNIQUE INDEX IF NOT EXISTS ux_invoices_control_number
  ON invoices (tenant_id, control_number)
  WHERE control_number IS NOT NULL AND deleted_at IS NULL;

-- Y el número de documento es único POR TIPO: la factura 000123 y la nota de crédito 000123 conviven.
CREATE UNIQUE INDEX IF NOT EXISTS ux_invoices_document_number
  ON invoices (tenant_id, document_type, invoice_number)
  WHERE document_type IS NOT NULL AND deleted_at IS NULL;
