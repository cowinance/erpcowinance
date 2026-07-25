-- Venezuela como país soportado (base de G4 · facturación electrónica).
--
-- La fuente canónica del registro es `modules/identity/country-defaults.ts`, y los catálogos base
-- los siembra `bootstrapCatalogs`. Pero ese seed arranca con `if (n > 0) return` —solo corre sobre
-- una base vacía—, así que una instalación YA EXISTENTE nunca vería el país nuevo: el registro lo
-- aceptaría y después reventaría la FK `organizations.default_currency → currencies`.
--
-- OJO CON EL ORDEN, que es la trampa de esta migración: las migraciones corren ANTES de
-- `bootstrapCatalogs`. Si insertáramos el país sin condición, sobre una base vacía dejaríamos
-- `countries` con una fila, y el centinela `n > 0` haría que el seed se saltee TODO lo demás
-- —monedas, unidades, especies, razas y el rol `owner`—, dejando la base inservible.
--
-- Por eso las dos sentencias van condicionadas a que el catálogo ya esté poblado: sobre una base
-- nueva no hacen nada (lo pone `bootstrapCatalogs`, que ya incluye VE/VES) y sobre una existente
-- rellenan lo que falta. Idempotentes en ambos casos.

-- INSAI (Instituto Nacional de Salud Agrícola Integral) es la autoridad de la guía de movilización
-- animal, el equivalente venezolano de SENASA/ICA.
INSERT INTO countries (code, name, name_en, traceability_authority)
SELECT 'VE', 'Venezuela', 'Venezuela', 'INSAI'
WHERE EXISTS (SELECT 1 FROM countries)
ON CONFLICT (code) DO NOTHING;

-- VES es el código ISO-4217 vigente del bolívar (se mantiene tras la redenominación de 2021).
INSERT INTO currencies (code, name, symbol)
SELECT 'VES', 'Bolívar', 'Bs.'
WHERE EXISTS (SELECT 1 FROM currencies)
ON CONFLICT (code) DO NOTHING;
