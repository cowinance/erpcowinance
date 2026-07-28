-- Transferencia de embrión: la madre GENÉTICA y el VIENTRE son dos vacas distintas.
--
-- Hasta acá el ternero heredaba como madre a la que lo parió. En una transferencia eso es falso: la
-- receptora gesta y amamanta, pero no aporta un solo gen — el embrión ya estaba formado con los
-- genes de la donante y del toro. Con `dam_id` apuntando a la receptora, la genealogía miente y
-- todo lo que se derive de ella hereda la mentira: el parentesco, la consanguinidad de sus futuras
-- crías, y la evaluación genética.
--
-- Ahora `animals.dam_id` significa SIEMPRE lo mismo que `sire_id`: de quién heredó. La receptora
-- pasa a tener su casilla propia. Es la asimetría que había que sacar — un campo que significa
-- «madre genética» para casi todos los animales y «vientre alquilado» para algunos es un campo que
-- miente justo donde más importa, y obliga a cada persona que lea ese SQL a acordarse de cuál de
-- los dos progenitores es el que engaña.

ALTER TABLE "animals" ADD COLUMN IF NOT EXISTS "recipient_dam_id" uuid;

COMMENT ON COLUMN "animals"."dam_id" IS 'Madre GENÉTICA. En transferencia de embrión es la donante, no la que parió.';
COMMENT ON COLUMN "animals"."recipient_dam_id" IS 'Receptora: gestó y amamantó, sin aportar genética. Solo en transferencia de embrión.';

CREATE INDEX IF NOT EXISTS "ix_animals_recipient_dam_id" ON "animals" ("recipient_dam_id") WHERE "recipient_dam_id" IS NOT NULL;

-- Corrección de lo ya nacido por transferencia.
--
-- No hay que adivinar nada: la cadena existe entera y nadie la recorría —
--   animal → calving → pregnancy → breeding_event (embryo_transfer) → embryo.donor_dam_id
--
-- Se mueve la que parió a `recipient_dam_id` y se pone la donante en `dam_id`. Solo toca crías cuyo
-- embrión tenga donante cargada: sin ese dato, cambiar la madre sería reemplazar un dato equivocado
-- por ninguno, y de las dos la primera al menos permite rastrear a mano quién parió.
UPDATE animals a
   SET recipient_dam_id = a.dam_id,
       dam_id = e.donor_dam_id,
       breeding_method_origin = 'et'
  FROM calving_offspring co
  JOIN calvings c ON c.id = co.calving_id AND c.deleted_at IS NULL
  JOIN pregnancies p ON p.id = c.pregnancy_id AND p.deleted_at IS NULL
  JOIN breeding_events be ON be.id = p.breeding_event_id AND be.deleted_at IS NULL
  JOIN embryos e ON e.id = be.embryo_id AND e.deleted_at IS NULL
 WHERE co.animal_id = a.id
   AND co.deleted_at IS NULL
   AND be.type = 'embryo_transfer'
   AND e.donor_dam_id IS NOT NULL
   AND a.recipient_dam_id IS NULL
   AND a.deleted_at IS NULL;
