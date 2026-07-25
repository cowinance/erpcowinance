-- Identidad fiscal venezolana (G4-1): RIF validado y condición del contribuyente.
--
-- Va en las DOS puntas de la operación, y no por simetría: cada una decide algo distinto.
--   · La EMPRESA que emite: su condición decide si la venta lleva IVA.
--   · El SOCIO de negocio: su condición decide si me retiene el IVA al pagarme (solo el especial
--     retiene) y qué crédito fiscal puede descontar con mi factura.
-- Sin la condición de la contraparte guardada, una retención del 75% aparece después como un
-- faltante de cobranza que nadie sabe explicar.
--
-- `tax_id` ya existía en las dos tablas como texto libre. NO se lo reemplaza ni se lo migra a
-- ciegas: se lo deja donde está y se agrega la condición al lado. Normalizar RIFs preexistentes
-- —que pueden ser de otro país, estar a medio cargar o ser un CUIT— rompería datos reales para
-- ganar prolijidad. La validación se aplica de acá en adelante, en el servicio.

-- ── Condición ante el IVA ──────────────────────────────────────────────────────────────────────
-- Sin DEFAULT a propósito: NULL significa «todavía no se declaró», que es la verdad para todo lo
-- ya cargado. Un DEFAULT 'ordinario' afirmaría de cada cliente existente algo que nadie verificó,
-- y esa mentira se arrastraría al primer libro de ventas.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS taxpayer_condition varchar(32)
  CHECK (taxpayer_condition IN ('ordinario','especial','formal','no_contribuyente'));
ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS taxpayer_condition varchar(32)
  CHECK (taxpayer_condition IN ('ordinario','especial','formal','no_contribuyente'));

COMMENT ON COLUMN companies.taxpayer_condition IS 'Condición ante el IVA; decide si la venta lleva impuesto. NULL = sin declarar';
COMMENT ON COLUMN business_partners.taxpayer_condition IS 'Condición ante el IVA del tercero; el especial retiene IVA al pagar. NULL = sin declarar';

-- ── Datos que la factura exige y que hoy no tienen dónde vivir ─────────────────────────────────
-- La razón social es la del registro mercantil y NO tiene por qué coincidir con el nombre con el
-- que uno llama al cliente («Frigorífico del Centro» vs «INVERSIONES FRIGOCENTRO, C.A.»). En el
-- comprobante va la del registro; en la pantalla, la de uso diario. Guardar una sola obliga a
-- elegir cuál sacrificar.
ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS legal_name varchar(255);
COMMENT ON COLUMN business_partners.legal_name IS 'Razón social del registro mercantil, para el comprobante. NULL = usar name';

-- Domicilio fiscal: es el declarado ante el SENIAT y va impreso. No es la dirección de entrega
-- —el ganado se despacha a un matadero que no es el domicilio de la empresa que compra—, así que
-- `address` (logística) no sirve para esto.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS fiscal_address jsonb;
ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS fiscal_address jsonb;
COMMENT ON COLUMN companies.fiscal_address IS 'Domicilio fiscal declarado ante el SENIAT, impreso en el comprobante';
COMMENT ON COLUMN business_partners.fiscal_address IS 'Domicilio fiscal del tercero, impreso en el comprobante';

-- ── El RIF identifica: no puede haber dos socios con el mismo ──────────────────────────────────
-- La unicidad NO puede ir sobre `tax_id` tal como está, por dos razones que se suman:
--
--   1. Es texto libre sin normalizar. `J-00123072-6` y `J001230726` son EL MISMO RIF y el índice
--      los dejaría pasar como distintos: daría sensación de guardarraíl sin serlo.
--   2. Una finca que ya tenga un duplicado cargado haría FALLAR la migración, y con ella el
--      arranque de la API. Un problema de datos viejos no puede dejar la app abajo.
--
-- Por eso la unicidad va sobre una columna NUEVA con el RIF normalizado (`J001230726`), que nace
-- NULL en todo lo existente: el índice no puede chocar contra nada al crearse, y a la vez es
-- imposible cargar dos veces el mismo RIF de acá en adelante. `tax_id` queda como el valor que se
-- muestra; lo viejo se normaliza cuando alguien edita ese socio, no por un UPDATE masivo a ciegas
-- sobre datos que pueden ser de otro país o estar a medio cargar.
--
-- La unicidad tiene que ser de BASE y no del servicio: dos altas simultáneas del mismo cliente
-- pasarían las dos por un chequeo previo en código y quedarían igual duplicadas.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS tax_id_normalized varchar(16);
ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS tax_id_normalized varchar(16);
COMMENT ON COLUMN companies.tax_id_normalized IS 'RIF sin guiones ni espacios (J001230726); clave de identidad fiscal';
COMMENT ON COLUMN business_partners.tax_id_normalized IS 'RIF sin guiones ni espacios (J001230726); clave de identidad fiscal';

CREATE UNIQUE INDEX IF NOT EXISTS ux_business_partners_tenant_tax_id_norm
  ON business_partners (tenant_id, tax_id_normalized)
  WHERE tax_id_normalized IS NOT NULL AND deleted_at IS NULL;
