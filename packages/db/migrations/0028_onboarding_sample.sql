-- Datos de ejemplo del onboarding (O-3): el REGISTRO de lo que se creó.
--
-- Un hato de muestra sirve para que el productor vea la app funcionando antes de cargar lo suyo,
-- pero solo si se puede sacar después sin dejar rastro. Un animal inventado que sobrevive al
-- borrado no es un detalle estético: entra en el conteo del hato, en los KPIs, en los reportes y en
-- la contabilidad de la finca — y se descubre tarde, cuando ya nadie recuerda de dónde salió.
--
-- Por eso el borrado NO adivina qué era de ejemplo (por el nombre, por la fecha, por la caravana):
-- se anota lo que se crea y se borra exactamente eso. La garantía es estructural, no heurística.
--
-- Se anotan las FILAS RAÍZ (animales y lotes). Lo que cuelga de un animal de ejemplo —sus pesajes,
-- su sanidad, su historial— es de ejemplo por definición y se resuelve por `animal_id` al borrar.

CREATE TABLE IF NOT EXISTS "onboarding_sample_rows" (
  "id" uuid DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  -- Qué clase de fila es. Cerrado a propósito: el borrado interpola el nombre de tabla en el SQL,
  -- así que el conjunto de valores posibles tiene que estar acotado acá y no depender de que el
  -- código de turno se acuerde de validarlo.
  "kind" varchar(32) NOT NULL CHECK ("kind" IN ('animal', 'lot')),
  "row_id" uuid NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("tenant_id", "kind", "row_id")
);

CREATE INDEX IF NOT EXISTS "ix_onboarding_sample_rows_tenant_id" ON "onboarding_sample_rows" ("tenant_id");
