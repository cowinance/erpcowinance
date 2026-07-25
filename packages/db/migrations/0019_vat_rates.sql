-- Alícuotas de IVA configurables (G4-3).
--
-- Van en `companies` y no en `organizations` porque son de la ENTIDAD FISCAL, igual que
-- `taxpayer_condition` y el RIF: quien declara el IVA es la empresa.
--
-- Y van en CONFIGURACIÓN y no en el código porque en Venezuela las alícuotas cambian por
-- providencia. Escritas en el código, cada cambio de tasa sería un deploy — y entre el cambio
-- oficial y el deploy la finca estaría facturando con la alícuota vieja.
--
-- jsonb y no tres columnas: el conjunto de alícuotas es una unidad que se lee y se guarda entera, y
-- si mañana aparece una cuarta no hay que migrar la tabla. Se guardan como FRACCIÓN (0.16 = 16%),
-- igual que `tax_rate` en las líneas de compras y ventas — dos convenciones distintas para el mismo
-- concepto es un error de conversión esperando el momento.
--
-- Sin DEFAULT con las tasas de hoy a propósito: escribir 0.16 acá sería afirmar cuál es la alícuota
-- vigente en el momento en que alguien corra la migración, y esa afirmación envejece sola. NULL
-- significa «sin configurar», y el desglose trata la alícuota ausente como cero — que es visible en
-- el comprobante (IVA en 0) en vez de silencioso.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS vat_rates jsonb;

COMMENT ON COLUMN companies.vat_rates IS 'Alícuotas de IVA vigentes como fracción ({"general":0.16}); NULL = sin configurar';
