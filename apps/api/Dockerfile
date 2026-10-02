FROM node:20-alpine
WORKDIR /srv/app

# Install workspace deps (root lockfile covers apps/api + apps/web)
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci

# API source + Prisma client
COPY apps/api ./apps/api
RUN npx prisma generate --schema=./apps/api/prisma/schema.prisma

ENV NODE_ENV=production
EXPOSE 4000

# Run pending migrations, then start the API
CMD ["sh", "-c", "npx prisma migrate deploy --schema=./apps/api/prisma/schema.prisma && node apps/api/src/server.js"]
