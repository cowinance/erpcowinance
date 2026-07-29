-- Una importación que falla tiene que terminar diciendo qué pasó.
--
-- El procesador ya contemplaba `failed` como estado, pero nunca lo usaba: su propio comentario lo
-- decía —«NO se transiciona a failed (no hay política de máximo de intentos todavía)»— así que un
-- error SQL revertía el chunk, el lote quedaba en `processing` y el heartbeat vencido lo reclamaba
-- otra vez. Para siempre.
--
-- Medido contra la app con una planilla real: una sola celda con `14/03/2022` dejaba el lote
-- reintentando cada dos minutos —720 veces por día— con los contadores en cero, el estado en
-- «procesando» y el motivo únicamente en los logs del servidor. El productor veía «procesando…» y
-- nada más, sin forma de saber que su importación estaba muerta ni por qué.
--
-- Estas dos columnas son lo que faltaba para que el reintento sea una política y no un bucle:
-- cuántas veces se probó, y qué dijo la última vez que falló.

ALTER TABLE "import_batches" ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 0;
ALTER TABLE "import_batches" ADD COLUMN IF NOT EXISTS "last_error" text;

COMMENT ON COLUMN "import_batches"."attempts" IS
  'Cuántas veces se reclamó este lote para procesar. Al pasar el máximo, el lote va a «failed» en vez de reintentarse.';
COMMENT ON COLUMN "import_batches"."last_error" IS
  'Qué dijo el último fallo. Es lo que la pantalla le muestra al productor: sin esto el motivo vivía solo en los logs.';
