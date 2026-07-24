#!/usr/bin/env bash
#
# Backup lógico de la base. Formato `custom` de pg_dump (comprimido, restaurable en paralelo y
# selectivo por objeto), que es el que conviene para una base de este tamaño.
#
#   DATABASE_ADMIN_URL=postgres://postgres:clave@host:5432/cowinance ./backup.sh
#
# Variables:
#   DATABASE_ADMIN_URL  (o DATABASE_URL) conexión a respaldar. El rol necesita leer TODO: con el
#                       rol de servicio, que es NOSUPERUSER y tiene la RLS aplicada, el dump
#                       saldría con las filas que ese rol puede ver — o sea, ninguna, porque no
#                       hay `app.tenant_id` fijado. Un backup silenciosamente vacío es peor que
#                       ningún backup: por eso acá se exige el rol administrativo.
#   BACKUP_DIR          destino (default ./backups). Tiene que estar en almacenamiento DURABLE y
#                       fuera del disco de la base: un backup en el mismo disco no sobrevive a lo
#                       que se supone que cubre.
#   RETENTION_DAYS      borra los dumps más viejos que esto (default 14; 0 = no borrar).
#
# Requiere `pg_dump` en el PATH, de la MISMA versión mayor que el servidor (17). Si no lo tenés
# instalado, corrélo dentro del contenedor de PostgreSQL, donde ya está:
#   docker exec -e DATABASE_ADMIN_URL=... -i cowinance-pg bash -s < deploy/backup/backup.sh
set -euo pipefail

URL="${DATABASE_ADMIN_URL:-${DATABASE_URL:-}}"
if [ -z "$URL" ]; then
  echo "backup: falta DATABASE_ADMIN_URL (o DATABASE_URL)." >&2
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_DIR/cowinance-$STAMP.dump"
# Se escribe con extensión temporal y se renombra al final: así un backup interrumpido nunca
# queda en el directorio con nombre de backup válido, listo para que alguien confíe en él.
TMP="$DEST.parcial"

echo "backup: volcando a $DEST"
pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$TMP" "$URL"
mv "$TMP" "$DEST"

BYTES=$(wc -c < "$DEST" | tr -d ' ')
if [ "$BYTES" -lt 1024 ]; then
  echo "backup: el dump pesa $BYTES bytes — demasiado chico para ser real. Se aborta." >&2
  exit 1
fi
echo "backup: OK · $DEST ($BYTES bytes)"

if [ "$RETENTION_DAYS" -gt 0 ]; then
  BORRADOS=$(find "$BACKUP_DIR" -name 'cowinance-*.dump' -type f -mtime "+$RETENTION_DAYS" -print -delete | wc -l | tr -d ' ')
  echo "backup: retención ${RETENTION_DAYS}d · $BORRADOS dump(s) viejos eliminados"
fi

echo "$DEST"
