#!/usr/bin/env bash
# Encrypted, rotated backups of the Supabase Postgres database.
#
# Requirements on the backup host: postgresql-client (pg_dump matching the server
# major version) and age (https://age-encryption.org).
#
# Environment (put in /etc/ssi-backup.env, chmod 600, owned by the backup user):
#   DATABASE_URL     Supabase → Project Settings → Database → connection string
#                    (use a dedicated read-only role if possible; keep sslmode=require)
#   AGE_RECIPIENT    age public key; keep the matching PRIVATE key offline, NOT on this server
#   BACKUP_DIR       e.g. /var/backups/ssi-crm
#   RETENTION_DAYS   e.g. 30
#
# Cron (daily 02:30):  30 2 * * * set -a; . /etc/ssi-backup.env; /opt/ssi/backup.sh >>/var/log/ssi-backup.log 2>&1
# Restore:             age -d -i key.txt FILE.sql.gz.age | gunzip | psql "$RESTORE_DATABASE_URL"
#                      Test a restore into a scratch project at least quarterly.
set -euo pipefail
umask 077

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${AGE_RECIPIENT:?AGE_RECIPIENT is required}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/ssi-crm}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

case "$DATABASE_URL" in
  *sslmode=require*|*sslmode=verify-full*) ;;
  *) echo "Refusing to connect without sslmode=require in DATABASE_URL" >&2; exit 1 ;;
esac

mkdir -p "$BACKUP_DIR"
file="$BACKUP_DIR/ssi-crm-$(date -u +%Y%m%dT%H%M%SZ).sql.gz.age"

# Plain-text SQL never touches the disk unencrypted.
pg_dump "$DATABASE_URL" --schema=public --schema=storage --no-owner --no-privileges \
  | gzip -9 \
  | age -r "$AGE_RECIPIENT" -o "$file"

find "$BACKUP_DIR" -name 'ssi-crm-*.sql.gz.age' -type f -mtime +"$RETENTION_DAYS" -delete
echo "$(date -u +%FT%TZ) backup ok: $(basename "$file") ($(du -h "$file" | cut -f1))"
# Note: storage *files* (documents) are not in pg_dump. Back them up with the Supabase
# Storage API or rclone (S3-compatible endpoint), encrypted the same way.
