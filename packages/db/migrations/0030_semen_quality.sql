-- Vencimiento y control de calidad de las partidas de semen.
--
-- Dos cosas DISTINTAS, y separarlas es el punto:
--
--  · `expiry_date` es un vencimiento ADMINISTRATIVO — certificado sanitario, permiso de
--    importación, habilitación del centro. Vencido eso la pajuela sigue siendo buena, lo que caducó
--    es un papel. El semen bien conservado a −196 °C dura décadas; un sistema que avise «vencido»
--    por el calendario inventa un problema y enseña a ignorar los avisos.
--
--  · `semen_quality_checks` es la calidad REAL: se descongela una pajuela, se mira al microscopio y
--    se cuenta qué porcentaje se mueve. Es lo único que detecta el problema que de verdad arruina
--    una partida — que el termo se haya quedado sin nitrógeno y las pajuelas se hayan descongelado.

ALTER TABLE "semen_batches" ADD COLUMN IF NOT EXISTS "expiry_date" date;

COMMENT ON COLUMN "semen_batches"."expiry_date" IS
  'Vencimiento ADMINISTRATIVO (certificado/permiso) declarado por el proveedor. No es una propiedad biológica: el semen en nitrógeno no caduca.';

CREATE TABLE IF NOT EXISTS "semen_quality_checks" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "semen_batch_id" uuid NOT NULL,
  "checked_at" date NOT NULL,
  -- Motilidad post-descongelado, 0 a 100. El umbral de referencia para IA es 30%.
  "post_thaw_motility_pct" numeric(5,2) NOT NULL CHECK ("post_thaw_motility_pct" >= 0 AND "post_thaw_motility_pct" <= 100),
  "verdict" varchar(16) NOT NULL CHECK ("verdict" IN ('apta','dudosa','descartar')),
  -- Probar cuesta pajuelas: para mirarla hay que descongelarla, y esa ya no se usa.
  "straws_used" integer DEFAULT 1 NOT NULL CHECK ("straws_used" >= 0),
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" uuid,
  "deleted_at" timestamptz,
  PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ix_semen_quality_checks_tenant_id" ON "semen_quality_checks" ("tenant_id");
-- La consulta que importa es «la última prueba de esta partida», y se hace en cada listado de semen.
CREATE INDEX IF NOT EXISTS "ix_semen_quality_checks_batch_at"
  ON "semen_quality_checks" ("tenant_id", "semen_batch_id", "checked_at" DESC)
  WHERE "deleted_at" IS NULL;
