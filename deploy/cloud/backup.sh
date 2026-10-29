#!/bin/sh
set -eu
umask 077
root=/srv/dawnkb
stamp=$(date +%Y%m%d-%H%M%S)
mkdir -p "$root/backups"
target="$root/backups/$stamp"
mkdir "$target"
docker exec 1Panel-postgresql-Qg3j sh -c 'pg_dump -U "$POSTGRES_USER" -Fc dawnkb' > "$target/database.dump"
tar -czf "$target/vault.tar.gz" -C "$root" vault versions
cp "$root/app.env" "$target/app.env"
touch "$target/COMPLETE"
find "$root/backups" -mindepth 1 -maxdepth 1 -type d -mtime +6 -exec rm -rf {} +
