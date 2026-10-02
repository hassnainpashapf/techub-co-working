FROM node:20-alpine AS builder
WORKDIR /srv/app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci

COPY apps/web ./apps/web

ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN npm run build --workspace=apps/web

FROM node:20-alpine
WORKDIR /srv/app
ENV NODE_ENV=production

COPY --from=builder /srv/app/apps/web/.next/standalone ./
COPY --from=builder /srv/app/apps/web/.next/static ./.next/static
COPY --from=builder /srv/app/apps/web/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
