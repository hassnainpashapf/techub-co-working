#!/bin/bash
# Single-container startup: PostgreSQL + API
set -e

PGDATA=/var/lib/postgresql/data
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD env is required (hex string)}"
: "${POSTGRES_USER:=coworking}"
: "${POSTGRES_DB:=coworking}"

# Init data dir on first run (volume is empty)
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "initializing postgres data directory..."
  mkdir -p "$PGDATA"
  chown -R postgres:postgres "$PGDATA"
  su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $PGDATA -E UTF8"
  echo "listen_addresses='localhost'" >> "$PGDATA/postgresql.conf"
  echo "host all all 127.0.0.1/32 md5" >> "$PGDATA/pg_hba.conf"
fi

echo "starting postgres..."
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $PGDATA -l /tmp/postgres.log start"
for i in $(seq 1 30); do
  su postgres -c "pg_isready -h localhost" >/dev/null 2>&1 && break
  sleep 2
done

# Idempotent role + database
su postgres -c "psql -h localhost -tc \"SELECT 1 FROM pg_roles WHERE rolname='$POSTGRES_USER'\"" | grep -q 1 || \
  su postgres -c "psql -h localhost -c \"CREATE USER $POSTGRES_USER WITH PASSWORD '$POSTGRES_PASSWORD'\""
su postgres -c "psql -h localhost -tc \"SELECT 1 FROM pg_database WHERE datname='$POSTGRES_DB'\"" | grep -q 1 || \
  su postgres -c "psql -h localhost -c \"CREATE DATABASE $POSTGRES_DB OWNER $POSTGRES_USER\""

export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}"

echo "running prisma migrations..."
npx prisma migrate deploy --schema=/srv/app/apps/api/prisma/schema.prisma

echo "starting API on port ${PORT:-4000}..."
exec node /srv/app/apps/api/src/server.js
