# Deploying kamerafrei.com

Primary setup: a **home server** running the app via Docker, published
through a **Cloudflare Tunnel** (domain is on Cloudflare Registrar).
`cloudflared` dials *out* to Cloudflare, so this needs **no port
forwarding, no static IP, no open inbound ports**, and works behind CGNAT.
Your home IP is never exposed. A rented VPS works identically — see the
variant at the end.

Requirements: ~3 GB free RAM, ~100 MB disk for data, Linux with Docker.

## 1. Install Docker (once)

```sh
# Debian/Ubuntu:
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git rsync
# Arch:
sudo pacman -S --needed docker docker-compose git rsync

sudo systemctl enable --now docker
sudo usermod -aG docker $USER   # then re-login (or prefix docker cmds with sudo)
```

## 2. Get the app

```sh
git clone https://github.com/leonardoalt/kamerafrei ~/kamerafrei
cd ~/kamerafrei
```

## 3. Get the data

Prebuilt graphs + cameras are published as a GitHub release (~85 MB total):

```sh
mkdir -p ~/kamerafrei/data && cd ~/kamerafrei/data
base=https://github.com/leonardoalt/kamerafrei/releases/latest/download
curl -LO $base/graph_walk.pkl.gz
curl -LO $base/graph_bike.pkl.gz
curl -LO $base/cameras.geojson
cd ~/kamerafrei
```

(To rebuild from scratch instead: `make venv berlin` on a machine with
~6 GB free RAM, then copy `data/` over. To publish a fresh release from the
dev machine: `gh release create data-YYYY-MM-DD data/graph_*.pkl.gz
data/cameras.geojson --title "Berlin data YYYY-MM-DD"`.)

## 4. Create the Cloudflare Tunnel (dashboard, once)

At [one.dash.cloudflare.com](https://one.dash.cloudflare.com):

1. **Networks → Tunnels → Create a tunnel** → connector type *Cloudflared*
   → name it `kamerafrei` → **copy the token** (the long string after
   `--token` in the install command it displays — you need only the token,
   not the command; the compose file runs the connector for you).
2. On the tunnel page, in **Routes** → **Add route** → **Published
   application**, add two routes:
   - subdomain *(empty)*, domain `kamerafrei.com`, service `HTTP`,
     URL `kamerafrei:8000`
   - subdomain `www`, domain `kamerafrei.com`, service `HTTP`,
     URL `kamerafrei:8000`

   (`kamerafrei` is the Docker service name; cloudflared resolves it on the
   compose network. DNS records are created automatically.)
3. The tunnel shows **Down** and "Install cloudflared connector" until the
   compose stack connects in the next step — that's expected. Replicas stay
   at 1; you never need to add more.

## 5. Run it

```sh
cd ~/kamerafrei
cp .env.example .env
"${EDITOR:-nano}" .env          # paste the tunnel token
docker compose --profile prod up -d --build
```

Verify:

```sh
curl -s http://127.0.0.1:8000/api/health   # local
curl -s https://kamerafrei.com/api/health  # through the tunnel
# expect: {"profiles":["bike","walk"],"cameras":true}
```

If the second one fails, `docker compose logs cloudflared` — a bad token is
the usual cause.

Both containers have `restart: unless-stopped`, so everything comes back by
itself after a reboot (Docker itself is enabled via systemd in step 1).

## 6. Cloudflare tuning (dashboard, once)

- **SSL/TLS**: enable *Always Use HTTPS*.
- **Caching → Cache Rules**: hostname `kamerafrei.com` AND URI path is not
  `/api/route` → *Eligible for cache*, edge TTL 1 hour. Static assets and
  `/api/cameras` then serve from Cloudflare's edge, not your uplink.
- **Security → WAF → Rate limiting** (1 rule is free): URI path equals
  `/api/route`, more than 20 requests per 10 s per IP → block. Each route
  costs ~130 ms CPU on a single worker; this keeps one abuser from queueing
  everyone else.

## 7. Weekly camera refresh (cron)

New cameras appear in OSM continuously. This re-fetches them and recomputes
exposure on the existing graphs (no street-network re-download, ~2–3 min of
downtime):

```sh
crontab -e
# Mondays 04:00
0 4 * * 1 ~/kamerafrei/scripts/refresh_cameras.sh >> ~/kamerafrei/refresh.log 2>&1
```

## 8. Updating the app

```sh
cd ~/kamerafrei && git pull && docker compose --profile prod up -d --build
```

## Notes

- The app binds to `127.0.0.1:8000` on the host — reachable from the LAN
  box itself and through the tunnel, nothing else. No firewall changes.
- Bandwidth is a non-issue: route responses are a few KB and map tiles go
  from openstreetmap.org to the visitor directly, never through your line.
- Home hosting trade-off: the site's uptime is the machine's uptime. An
  uptime monitor (e.g. UptimeRobot on `https://kamerafrei.com/api/health`)
  tells you when it matters.
- Single uvicorn worker by design — each worker would duplicate ~2.5 GB of
  graphs. If traffic outgrows this, the roadmap's client-side routing
  removes the server entirely.

## Variant: rented VPS instead of home server

Identical setup; only the machine differs:

1. Provision a ≥4 GB RAM VPS (e.g. Hetzner CAX11, ~€4/mo), Ubuntu 24.04.
2. Follow steps 1–8 above on it. **Don't build graphs on a 4 GB box** — the
   build peaks above that; copy `data/` from a bigger machine (step 3).
3. Migration home↔VPS later is trivial: same compose file, same tunnel —
   move `data/` and the `.env` token, `docker compose --profile prod up -d`.
