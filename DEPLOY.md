# Techub Co-Working — Production Deploy

Architecture: **Frontend → Cloudflare Pages** (free, global CDN),
**Backend (API + PostgreSQL) → VPS**, connected via Cloudflare Tunnel.

---

## PART A — Backend on VPS (API + Database)

### 1) Server
- Ubuntu 24.04 VPS, 2 GB RAM (e.g. Hetzner CX22 ~€4.5/month)

### 2) Docker install (server par, root)
```bash
curl -fsSL https://get.docker.com | sh
```

### 3) Code lao
```bash
git clone https://github.com/hassnainpashapf/techub-co-working.git
cd techub-co-working
```

### 4) Config
```bash
cp .env.prod.example .env.prod
nano .env.prod
```
- `POSTGRES_PASSWORD` — lamba random password
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — `openssl rand -hex 32` se banao

### 5) Start
```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
```

### 6) Cloudflare Tunnel — API ko public karo
1. Cloudflare Zero Trust dashboard → Networks → Tunnels → **Create a Tunnel** → token copy karo
2. Public hostname add karo: `api.example.com` → `http://api:4000`
3. `.env.prod` me `TUNNEL_TOKEN=` set karo
4. `docker-compose.prod.yml` me `tunnel` service uncomment karo, phir:
```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```
API ab public hai: `https://api.example.com`

---

## PART B — Frontend on Cloudflare Pages

1. Cloudflare dashboard → **Workers & Pages** → Create → **Pages** → Connect to Git
2. Repo select karo: `hassnainpashapf/techub-co-working`
3. Build settings:
   - Build command: `CF_PAGES=1 npm run build --workspace=apps/web`
   - Build output directory: `apps/web/out`
4. Environment variables (Production):
   - `NEXT_PUBLIC_API_URL` = `https://api.example.com` (Part A ka public API URL)
   - `CF_PAGES` = `1`
5. **Save and Deploy** — frontend live: `https://techub-co-working.pages.dev`

Har `git push` par Pages khud dobara deploy kar dega.

---

## Rozmarrah (VPS)
```bash
# backend logs
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f
# backend update (naya code aane par)
git pull && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```
