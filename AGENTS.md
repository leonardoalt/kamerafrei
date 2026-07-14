# AGENTS.md — kamerafrei

Context for anyone (human or agent) working on this repo. Keep this updated
when decisions change.

## What this is

*kamerafrei* (German: "camera-free", like *barrierefrei*) is a walk/bike
route planner for Berlin that minimizes exposure to known surveillance
cameras, using OSM `man_made=surveillance` data — the same data
[Surveillance under Surveillance](https://sunders.uber.space) visualizes.
Project was originally called "invisible"; renamed 2026-07 (GitHub redirects).
Repo: https://github.com/leonardoalt/kamerafrei
Domain: kamerafrei.com (Cloudflare Registrar; served via Cloudflare Tunnel,
see DEPLOY.md)

## Core model

Every graph edge carries a precomputed `exposure` attribute: meters of the
edge within **25 m** of a known camera (`exposure_radius_m` stored on the
graph). Routing minimizes

    cost(edge) = length + α · exposure

- α is the UI's "avoid cameras" control; the worded stops off / a little /
  a lot / max map to α = 0 / 5 / 15 / 60 (`AVOIDANCE` in `frontend/app.js`).
- **Penalty, not hard no-go zones** — deliberate: near stations/plazas every
  path is covered and hard avoidance would make destinations unreachable.
  A penalty always returns a route and reports residual exposure honestly.
- A* with euclidean heuristic stays admissible because exposure only ever
  *adds* cost (edge cost ≥ length ≥ straight-line distance).

## Architecture

```
pipeline/ (offline, Python)      backend/ (FastAPI)          frontend/ (static)
fetch_cameras.py  Overpass →     app.py    /api/route,       Leaflet 1.9 + OSM
                  cameras.geojson           /api/cameras,     raster tiles,
build_graph.py    osmnx → UTM-              /api/health,      vanilla JS/CSS,
                  projected walk/           serves frontend/  no build step
                  bike MultiDiGraph
compute_exposure.py per-edge     routing.py Router (A*,
                  exposure, in-             KD-tree snap),
                  place enrich              CameraIndex
```

- Data lives in `data/` (gitignored): `graph_walk.pkl.gz` (~53 MB),
  `graph_bike.pkl.gz` (~30 MB), `cameras.geojson`, plus `data/cache/`
  (~1 GB raw Overpass responses; makes pipeline re-runs cheap).
- Graphs are osmnx/NetworkX MultiDiGraphs, projected to EPSG:32633 (UTM 33N),
  pickled gzip. Built ONCE by the pipeline; the server only unpickles
  (~30 s startup) and answers A* queries (~130 ms cross-city).
- Full-Berlin scale (2026-07): 3,860 cameras; walk 411k nodes / 1.05M edges
  (0.9% of 39,568 km within 25 m of a camera); bike 195k / 441k (0.8%).
  Server RSS ~2.5 GB with both profiles loaded.
- Per-edge `exposure` drives the *cost*; displayed stats and red "exposed"
  segments are recomputed exactly per request by `CameraIndex`
  (camera-disc STRtree ∩ route geometry), so display ≠ approximation.

## Key decisions and why

- **Overpass via osmnx, not Geofabrik PBF**: less code for MVP. Trade-off:
  full-Berlin download takes 10–30 min through the rate-limited public API.
  If rebuilds become routine, switch to `berlin-latest.osm.pbf` + pyrosm
  (one 75 MB download, local parse).
- **Own exposure precompute, not GraphHopper/Valhalla/BRouter**: their
  custom-cost mechanisms key off way tags, not proximity to thousands of
  arbitrary points. (BRouter no-go areas become relevant for a far-future
  OsmAnd integration.)
- **Server-side routing, not in-browser**: the citywide graph is 30–60 MB
  even packed; a small always-on server is MVP-simple. Phase-2 goal:
  compact CSR/typed-array graph + client-side A* → fully static hosting.
- **Camera filter** (`pipeline/fetch_cameras.py`): keep
  `man_made=surveillance` with `surveillance:type` ∈ {camera, ALPR, webcam}
  or untyped; drop `surveillance=indoor`.
- **MVP visibility model = 25 m disc** per camera. v2: view cones from
  `camera:direction`/`camera:angle`, building shadowing via footprints.

## Gotchas

- NetworkX multigraph weight callables receive the **dict of parallel edges**
  keyed by edge key — take `min()` over `.values()` (see `Router._weight`).
- osmnx edge geometry may run v→u; `Router._edge_coords` reverses when the
  geometry start is farther from node u than its end.
- Leaflet: `L.featureGroup` has `getBounds()`, `L.layerGroup` does NOT.
- Public Overpass instances flake (504s, dispatcher errors) —
  `fetch_cameras.py` retries across 3 mirrors with a User-Agent; keep that.
- Straight (unsimplified) edges have no `geometry` attr — always fall back
  to node coords.
- Moving a Python venv breaks it (absolute paths); rebuild with `make venv`.

## Workflows

- `make venv` — create `.venv` and install deps (osmnx 2.x, shapely 2,
  networkx, scipy, pyproj, FastAPI, uvicorn).
- `make test-area` — quick end-to-end build for a 1.5 km Kreuzberg radius
  (good for development; full Berlin not needed to test changes).
- `make berlin` — full city build (10–30 min, few GB RAM at peak).
- `make cameras exposure` + server restart — refresh camera data WITHOUT
  re-downloading the street network.
- `make serve` — uvicorn on 127.0.0.1:8000 (serves API + frontend together;
  no CORS needed).
- `make export-web` — binary CSR graphs for the in-browser router
  (docs/CLIENT_ROUTING.md; served at /web-data/). `make verify-client`
  runs the parity harness: JS router costs must match the Python oracle.
  Client routing is the DEFAULT (skipped on data-saver connections;
  `?client=0` forces the server for debugging); local failures fall back
  to the server automatically. Static asset URLs carry `?v=N` — bump on
  every frontend change in index.html AND sw.js (VERSION const) AND the
  worker.js router import, or browsers and the edge serve stale code
  (a cached 404 on an unversioned URL cost us an afternoon). Graph .bin
  URLs version separately (bump only when data format/content changes).
  PWA: sw.js precaches the shell; cache-first graphs/tiles,
  stale-while-revalidate cameras, network-only /api/route.
  uvicorn runs with --no-access-log: the UI promises route coordinates
  are never logged; keep that true.
- Deploy (see DEPLOY.md): 4 GB VPS + `docker compose --profile prod up -d`
  (app + cloudflared tunnel; token in `.env`). Build data locally and rsync —
  the graph build peaks above 4 GB. `scripts/refresh_cameras.sh` is the
  weekly cron. Compose profiles: default = app only, `prod` adds the tunnel,
  `tools` = one-off pipeline runs with rw data mount. Map tiles come from
  openstreetmap.org (fair-use; switch provider if traffic grows).

## Roadmap (not built yet)

1. Client-side routing + PWA — DONE and default (installable, offline
   after first visit); remaining: optional static hosting. Consider
   pre-compressed graph serving (.bin is 21 MB raw, 9 MB gzipped;
   Cloudflare doesn't compress octet-stream).
2. View-cone exposure model + building shadowing (display cones exist;
   routing exposure still uses 25 m discs).
3. Other cities (pipeline is city-agnostic — only place/bbox changes).
4. OsmAnd/BRouter integration (no-go files from camera data).
5. Weekly camera-refresh cron on the deployment.

Done: address autocomplete (Photon by komoot — Nominatim forbids
search-as-you-type; Berlin-bounded, device language), direction cones on
the map from camera:direction, shareable #map=zoom/lat/lon URLs.

## Known limitations (communicate honestly in UI/docs)

- OSM camera coverage is incomplete → routes avoid *known* cameras only.
- Disc model ignores camera direction and occlusion.
- No license file chosen yet.
