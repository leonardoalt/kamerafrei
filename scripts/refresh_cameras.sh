#!/usr/bin/env sh
# Weekly camera refresh on the server (cron this — see DEPLOY.md).
#
# Re-fetches cameras from Overpass and recomputes per-edge exposure on the
# existing graphs (no street-network re-download). The app is stopped while
# exposure computes: loading a graph takes ~2 GB and a 4 GB box can't hold
# that twice. Expect ~2-3 minutes of downtime.
set -eu
cd "$(dirname "$0")/.."

docker compose run --rm pipeline python pipeline/fetch_cameras.py

docker compose stop kamerafrei
docker compose run --rm pipeline sh -c "
  python pipeline/compute_exposure.py --graph data/graph_walk.pkl.gz &&
  python pipeline/compute_exposure.py --graph data/graph_bike.pkl.gz &&
  python pipeline/export_web.py --graph data/graph_walk.pkl.gz --out data/web/graph_walk.bin &&
  python pipeline/export_web.py --graph data/graph_bike.pkl.gz --out data/web/graph_bike.bin
"
docker compose --profile prod up -d

echo "refresh done: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
