#!/bin/sh
set -eu
database=1Panel-postgresql-Qg3j
docker network inspect dawnkb-private >/dev/null 2>&1 || docker network create dawnkb-private
attached=$(docker inspect --format '{{if index .NetworkSettings.Networks "dawnkb-private"}}yes{{end}}' "$database")
if [ "$attached" != yes ]; then
  docker network connect --alias dawnkb-db dawnkb-private "$database"
fi
docker compose -f /srv/dawnkb/deploy/compose.yaml run --rm --no-deps web npx prisma migrate deploy
docker compose -f /srv/dawnkb/deploy/compose.yaml up -d
