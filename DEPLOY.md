# Techub Co-Working — Production Deploy

Architecture: **Frontend → Cloudflare Pages** (free, global CDN),
**Backend (API + PostgreSQL) → VPS**, connected via Cloudflare Tunnel.

---

## PART A — Backend on VPS (ONE container: API + PostgreSQL)

### 1) Server
- Ubuntu 24.04 VPS, 2 GB RAM
- Docker: `curl -fsSL https://get.docker.com | sh`

### 2) Code + build (single image)
```bash
git clone https://github.com/hassnainpashapf/techub-co-working.git
cd techub-co-working
sudo docker build -f deploy/single-container/Dockerfile -t techub-backend .
```

### 3) Run (sirf 1 container)
```bash
# secrets banao (hex only)
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_ACCESS_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)

sudo docker run -d --name techub-backend --restart unless-stopped \
  -p 127.0.0.1:4000:4000 \
  -v techub-pgdata:/var/lib/postgresql/data \
  -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  -e JWT_ACCESS_SECRET="$JWT_ACCESS_SECRET" \
  -e JWT_REFRESH_SECRET="$JWT_REFRESH_SECRET" \
  techub-backend

# API check (pehli dafa migrations me 1-2 min lag sakta hai)
curl -s http://localhost:4000/api/health
```
Database container ke andar hi hai; data `techub-pgdata` volume me mehfooz rehta hai.

### 4) Cloudflare Tunnel — API ko public karo
1. Cloudflare Zero Trust dashboard → Networks → Tunnels → **Create a Tunnel** → token copy karo
2. Public hostname add karo: `api.example.com` → `http://localhost:4000`
3. Server par cloudflared install + chalao:
```bash
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared jammy main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared
sudo cloudflared service install <TUNNEL_TOKEN>
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
sudo docker logs -f techub-backend
# backend update (naya code aane par)
cd ~/techub-co-working && git pull && sudo docker build -f deploy/single-container/Dockerfile -t techub-backend . && sudo docker rm -f techub-backend
# (phir upar wala "Run" command dobara chalao — data volume me mehfooz hai)
```
