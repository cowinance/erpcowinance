-- El veredicto de una prueba de calidad se DERIVA de la motilidad, no se guarda.
--
-- `semen_quality_checks.verdict` era una copia: se calculaba al escribir con el umbral vigente en
-- ese momento y se guardaba al lado del número del que sale. Mientras el umbral fue una constante
-- las dos versiones coincidieron siempre, así que nunca dio un resultado equivocado — pero era una
-- bomba de tiempo con la mecha corta.
--
-- El día que el umbral se haga configurable —está previsto: cada laboratorio y cada raza tienen el
-- suyo, y por eso `motilityVerdict` ya lo acepta como parámetro— el historial mostraría veredictos
-- calculados con el umbral viejo mientras el estado de la partida usa el nuevo. La misma prueba
-- diciendo dos cosas distintas en dos pantallas, y ninguna de las dos creíble.
--
-- Es la misma regla que el módulo aplica en el rendimiento de faena: se deriva de la res y el peso
-- vivo en vez de leer la columna `dressing_pct`, aunque exista. Un número que se puede calcular no
-- se guarda; si se guarda, hay dos fuentes y algún día difieren.
--
-- No se pierde información: `post_thaw_motility_pct` es el dato medido, y el veredicto sale de él
-- con una función pura y probada.

ALTER TABLE "semen_quality_checks" DROP COLUMN IF EXISTS "verdict";
