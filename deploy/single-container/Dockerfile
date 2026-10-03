# Techub backend — SINGLE container: PostgreSQL 16 + Node.js API
FROM node:20-bookworm

# PostgreSQL 16 from the official PGDG repo
RUN apt-get update && apt-get install -y --no-install-recommends \
      wget ca-certificates gnupg lsb-release \
    && wget -qO- https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgres.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/postgres.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends postgresql-16 \
    && (pg_dropcluster 16 main 2>/dev/null || true) \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/app

# Node deps (npm workspaces: root lockfile covers apps/api + apps/web)
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci

# API source + Prisma client
COPY apps/api ./apps/api
RUN npx prisma generate --schema=./apps/api/prisma/schema.prisma

# Startup script: inits + starts postgres, migrates, starts API
COPY deploy/single-container/start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

ENV NODE_ENV=production PORT=4000
EXPOSE 4000
VOLUME /var/lib/postgresql/data
CMD ["/usr/local/bin/start.sh"]
