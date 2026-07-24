#!/usr/bin/env bash
#
# Restaura un dump de `backup.sh`. DESTRUCTIVO: reemplaza el contenido de la base destino.
#
#   DATABASE_ADMIN_URL=postgres://postgres:clave@host:5432/cowinance \
#   RESTORE_CONFIRM=si ./restore.sh backups/cowinance-20260724T220000Z.dump
#
# Variables:
#   DATABASE_ADMIN_URL  (o DATABASE_URL) base destino. Rol administrativo: recrear objetos pide
#                       privilegios que el rol de servicio no tiene ni debería tener.
#   RESTORE_CONFIRM=si  obligatoria. Sin ella no corre: el error más caro de un procedimiento de
#                       restore es ejecutarlo apuntando por accidente a producción.
#
# Requiere `pg_restore` en el PATH, de la misma versión mayor que el servidor (17).
set -euo pipefail

DUMP="${1:-}"
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "restore: falta el archivo de dump (uso: restore.sh <archivo.dump>)." >&2
  exit 1
fi

URL="${DATABASE_ADMIN_URL:-${DATABASE_URL:-}}"
if [ -z "$URL" ]; then
  echo "restore: falta DATABASE_ADMIN_URL (o DATABASE_URL)." >&2
  exit 1
fi

if [ "${RESTORE_CONFIRM:-}" != "si" ]; then
  echo "restore: esto REEMPLAZA el contenido de la base destino." >&2
  echo "         Revisá a dónde apunta DATABASE_ADMIN_URL y volvé a correr con RESTORE_CONFIRM=si." >&2
  exit 1
fi

echo "restore: restaurando $DUMP"
# `--clean --if-exists` borra cada objeto antes de recrearlo, así el restore funciona tanto sobre
# una base vacía como sobre una con datos.
#
# `--exit-on-error` NO se usa a propósito: pg_restore emite errores esperables al limpiar objetos
# que no existen o que pertenecen a roles ausentes, y cortar ahí abortaría restores válidos. La
# verificación de que el restore sirvió es la de abajo —y, de verdad, `npm run verify:backup`,
# que compara los datos y arranca la app contra la base restaurada.
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$URL" "$DUMP" || true

TABLAS=$(psql --tuples-only --no-align --dbname="$URL" \
  --command="SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
MIGRACIONES=$(psql --tuples-only --no-align --dbname="$URL" \
  --command="SELECT count(*) FROM schema_migrations" 2>/dev/null || echo 0)

if [ "$TABLAS" -lt 100 ] || [ "$MIGRACIONES" -lt 1 ]; then
  echo "restore: la base quedó con $TABLAS tablas y $MIGRACIONES migraciones — el restore NO sirvió." >&2
  exit 1
fi

echo "restore: OK · $TABLAS tablas · $MIGRACIONES migraciones registradas"
