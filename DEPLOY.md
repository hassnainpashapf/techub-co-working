# Techub Co-Working — Production Deploy (VPS + Cloudflare)

## 1) Server
- Ubuntu 24.04 VPS, 2 GB RAM (e.g. Hetzner CX22 ~€4.5/month, ya DigitalOcean Basic $6/month)
- Server ka public IP note kar lein

## 2) Docker install (server par, root ke tor par)
```bash
curl -fsSL https://get.docker.com | sh
```

## 3) Code lao
```bash
git clone https://github.com/hassnainpashapf/techub-co-working.git
cd techub-co-working
```

## 4) Production config
```bash
cp .env.prod.example .env.prod
nano .env.prod
```
Zaroori values:
- `POSTGRES_PASSWORD` — lamba random password
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — `openssl rand -hex 32` se banao
- `PUBLIC_API_URL` — API ka public URL (Cloudflare Tunnel hostname, masalan `https://api.example.com`)

## 5) Build + start
```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
```

## 6) Cloudflare Tunnel (tajweez kardah — koi port kholne ki zaroorat nahi)
1. Cloudflare Zero Trust dashboard → Networks → Tunnels → Create a Tunnel → token copy karo
2. Public hostnames add karo:
   - `app.example.com` → `http://web:3000`
   - `api.example.com` → `http://api:4000`
3. `.env.prod` me `TUNNEL_TOKEN=` set karo
4. `docker-compose.prod.yml` me `tunnel` service uncomment karo, phir:
```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

## 7) (Optional) Demo data
Asal istemal me seed data ki zaroorat nahi. Agar demo accounts chahiye to:
```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec api node apps/api/prisma/seed.js
```

## Rozmarrah commands
```bash
# logs
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f
# update (naya code aane par)
git pull && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```
