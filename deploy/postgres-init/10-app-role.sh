#!/bin/bash
# Rol de SERVICIO de la aplicación. Lo corre la imagen de PostgreSQL una sola vez, al inicializar
# el volumen de datos (docker-entrypoint-initdb.d).
#
# POR QUÉ EXISTE: si la API conectara con el superusuario, PostgreSQL le SALTEARÍA la RLS y el
# aislamiento por tenant que sostiene todo el SaaS quedaría reducido al `WHERE tenant_id` que
# escriba cada query — o sea, a que nadie se olvide nunca. Con un rol NOSUPERUSER NOBYPASSRLS la
# política se enforcea de verdad, y un olvido devuelve cero filas en vez de las de otra finca.
#
# Es el mismo esquema que verifican `npm run verify:rls` y `npm run verify:pg`: DDL con el rol
# administrativo (DATABASE_ADMIN_URL), servicio con el mínimo (DATABASE_URL).
set -euo pipefail

: "${APP_DB_USER:=cowinance_app}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD es obligatoria}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	DO \$\$ BEGIN
	  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_DB_USER}') THEN
	    CREATE ROLE ${APP_DB_USER} LOGIN PASSWORD '${APP_DB_PASSWORD}' NOSUPERUSER NOBYPASSRLS;
	  END IF;
	END \$\$;

	GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO ${APP_DB_USER};
	GRANT USAGE ON SCHEMA public TO ${APP_DB_USER};

	-- Las tablas todavía no existen: las crea el arranque de la API con el rol administrativo.
	-- Por eso se conceden privilegios POR DEFECTO, que aplican a todo lo que ese rol cree después.
	-- Sin esto, cada tabla nueva nacería inaccesible para la app.
	ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
	  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_DB_USER};
	ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
	  GRANT USAGE, SELECT ON SEQUENCES TO ${APP_DB_USER};

	-- Y para lo que ya exista (extensiones, tablas de sistema del esquema public).
	GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_DB_USER};
	GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_DB_USER};
EOSQL

echo "Rol de servicio ${APP_DB_USER} creado (NOSUPERUSER NOBYPASSRLS): la RLS le aplica."
