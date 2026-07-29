-- Las razas que se usan en Venezuela, para las fincas que YA están andando.
--
-- El catálogo base de razas estaba armado con razas argentinas —Angus, Hereford, Brangus, Braford,
-- Holando— y lo carga `bootstrapCatalogs`, así que lo recibía toda finca. La app se usa en
-- Venezuela: un productor de allá importaba su planilla y el sistema le rechazaba fila por fila las
-- razas de su propio rodeo. Se descubrió auditando la importación, cuando Brahman, Nelore y Gyr
-- resultaron inexistentes.
--
-- Arreglar `bootstrapCatalogs` alcanza para las fincas NUEVAS, pero no para las que ya existen: esa
-- función se corta con un `if (n > 0) return` en cuanto encuentra catálogos cargados. Por eso esta
-- migración: es el único camino a una base que ya está en producción.
--
-- La CARORA merece su renglón: nació en Carora, estado Lara, cruzando Pardo Suizo con Criollo
-- Limonero para tener una lechera que aguante el trópico. Es una raza venezolana y de las
-- principales del país; que no estuviera era la mejor prueba de que el catálogo miraba a otro lado.
--
-- No se BORRA ninguna de las que estaban: hay fincas del Cono Sur, y sacar una raza de un catálogo
-- desplegado dejaría animales apuntando a algo que ya no existe.
--
-- `NOT EXISTS` y no `ON CONFLICT`: la restricción única es (tenant_id, species_id, code) y en las
-- filas globales `tenant_id` es NULL, que en PostgreSQL no choca contra sí mismo. Con `ON CONFLICT`
-- esto insertaría duplicados en vez de saltearlos.

INSERT INTO breeds (species_id, code, name, purpose)
SELECT s.id, v.code, v.name, v.purpose
  FROM species s
 CROSS JOIN (VALUES
   -- Desarrolladas en Venezuela.
   ('carora', 'Carora', 'dairy'),
   ('criollo_limonero', 'Criollo Limonero', 'dairy'),
   -- Cebuínas: la base del rodeo de carne en el trópico, por resistencia al calor y a la garrapata.
   ('brahman', 'Brahman', 'beef'),
   ('nelore', 'Nelore', 'beef'),
   ('gyr', 'Gyr', 'dual'),
   ('guzerat', 'Guzerat', 'dual'),
   ('indubrasil', 'Indubrasil', 'beef'),
   ('sardo_negro', 'Sardo Negro', 'beef'),
   -- Cruces de doble propósito, que es como produce la mayoría de las fincas venezolanas.
   ('girolando', 'Girolando', 'dual'),
   ('mestizo', 'Mestizo', 'dual'),
   -- Europeas de leche. «Holstein» y no «Holando Argentino»: es el nombre que se usa allá.
   ('holstein', 'Holstein', 'dairy'),
   ('pardo_suizo', 'Pardo Suizo', 'dual'),
   ('jersey', 'Jersey', 'dairy'),
   -- Carne, adaptadas al trópico.
   ('senepol', 'Senepol', 'beef'),
   ('romosinuano', 'Romosinuano', 'beef'),
   ('simmental', 'Simmental', 'dual')
 ) AS v(code, name, purpose)
 WHERE s.code = 'bovine'
   AND NOT EXISTS (
     SELECT 1 FROM breeds b
      WHERE b.species_id = s.id AND b.code = v.code AND b.tenant_id IS NULL
   );
