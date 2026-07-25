-- Contador de intentos compartido entre instancias (rate limit de credenciales).
--
-- El limitador contaba EN MEMORIA del proceso: con dos instancias detrás de un balanceador, el
-- limite efectivo se duplicaba, y con N se multiplicaba por N. Esta tabla lo vuelve un contador
-- unico, sin sumar Redis a la infraestructura: la base ya esta ahi.
--
-- SIN tenant_id y SIN RLS a proposito, misma decision que `auth_refresh_tokens` y `event_outbox`:
-- el guard corre ANTES de autenticar, asi que no hay tenant que filtrar. Las claves son
-- `<ruta>|ip:<ip>` y `<ruta>|email:<email>`; no guardan nada mas que eso.
--
-- `at` es el instante del intento. Las filas viejas se borran en cada consulta (la ventana es de
-- minutos), asi que la tabla se mantiene chica sin necesidad de un job de limpieza.

CREATE TABLE IF NOT EXISTS rate_limit_hits (
  id bigserial PRIMARY KEY,
  key varchar(255) NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_rate_limit_hits_key_at ON rate_limit_hits (key, at);
