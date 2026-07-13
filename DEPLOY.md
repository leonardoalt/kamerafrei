# Deploying kamerafrei.com

Target setup: a small VPS running the app via Docker, published through a
Cloudflare Tunnel (domain is on Cloudflare Registrar). No open inbound ports,
no TLS certificates to manage, origin IP stays hidden.

Cost: ~€4/month VPS + the domain.

## 1. Provision the server

- Hetzner Cloud **CAX11** (ARM64, 4 GB RAM) or CX22 (x86), Ubuntu 24.04,
  Falkenstein or Nuremberg. Any 4 GB VPS elsewhere works the same.
- Add your SSH key when creating it.

```sh
ssh root@<server-ip>
apt update && apt install -y docker.io docker-compose-v2 git rsync
```

## 2. Install the app

```sh
git clone https://github.com/leonardoalt/kamerafrei /opt/kamerafrei
cd /opt/kamerafrei
```

## 3. Upload the data

Build the graphs on your own machine (`make venv berlin` — do NOT build on
the server, the build peaks above 4 GB), then from your machine:

```sh
rsync -av --exclude cache ~/devel/invisible/data/ root@<server-ip>:/opt/kamerafrei/data/
```

~85 MB: two graph pickles + cameras.geojson.

## 4. Create the Cloudflare Tunnel

In the Cloudflare dashboard ([one.dash.cloudflare.com](https://one.dash.cloudflare.com)):

1. **Networks → Tunnels → Create a tunnel** → type *Cloudflared* → name it
   `kamerafrei`.
2. Copy the token from the install command it shows (the long string after
   `--token`).
3. **Public hostname** tab — add:
   - `kamerafrei.com` → service `http://kamerafrei:8000`
   - `www.kamerafrei.com` → service `http://kamerafrei:8000`
   (`kamerafrei` is the compose service name; cloudflared resolves it on the
   Docker network. The DNS records are created automatically.)

On the server:

```sh
cd /opt/kamerafrei
cp .env.example .env        # then paste the token into .env
docker compose --profile prod up -d --build
```

Check: `curl -s https://kamerafrei.com/api/health` →
`{"profiles":["bike","walk"],"cameras":true}`.

## 5. Cloudflare tuning (dashboard, once)

- **SSL/TLS**: mode *Full*; enable *Always Use HTTPS*.
- **Cache rule** (Caching → Cache Rules): hostname `kamerafrei.com` AND URI
  path is not `/api/route` → *Eligible for cache*, edge TTL 1 hour. Static
  assets and `/api/cameras` then serve from the edge; routes stay dynamic.
- **Rate limiting rule** (Security → WAF → Rate limiting, 1 free rule): URI
  path equals `/api/route`, more than 20 requests per 10 seconds per IP →
  block. Each route costs ~130 ms of CPU on a single worker — this keeps one
  abuser from queueing everyone else.

## 6. Weekly camera refresh

New cameras appear in OSM continuously; refresh without re-downloading the
street network:

```sh
crontab -e
# Mondays 04:00 UTC, ~2-3 min downtime while exposure recomputes
0 4 * * 1 /opt/kamerafrei/scripts/refresh_cameras.sh >> /var/log/kamerafrei-refresh.log 2>&1
```

## 7. Updating the app

```sh
cd /opt/kamerafrei && git pull && docker compose --profile prod up -d --build
```

## Notes

- The app container binds only to 127.0.0.1 on the host; the tunnel is the
  sole public path. No firewall rules needed beyond the default.
- Single uvicorn worker by design — each worker would duplicate the 2.5 GB
  graph. If traffic ever outgrows this, the roadmap's client-side routing
  removes the server entirely.
- Optional: point an uptime monitor (e.g. UptimeRobot) at
  `https://kamerafrei.com/api/health`.
