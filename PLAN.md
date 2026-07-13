# kamerafrei — MVP plan

A browser-based route planner for Berlin (walking/biking) that minimizes exposure to known surveillance cameras, using the same OSM data that [Surveillance under Surveillance](https://sunders.uber.space) visualizes.

## Answers to the questions in init.md

**Do we need to download Berlin maps first?**
Yes, but only for *routing*, and only once (plus periodic refreshes):

- **Street network**: download the Berlin extract from Geofabrik (`berlin-latest.osm.pbf`, ~75 MB). We preprocess it offline into a routing graph — we never route against raw OSM at request time.
- **Cameras**: fetch via the Overpass API (`man_made=surveillance` nodes/ways in the Berlin bounding box). This is a small dataset (thousands of points, a few MB of GeoJSON) and is what sunders itself uses. Refresh weekly with a script.
- **Map display**: no download needed — the browser map uses standard OSM tile servers.

**Can we build a simple website that shows paths with minimal cameras, Google-Maps style?**
Yes. The MVP is exactly that: click a start and end point, get 2–3 route alternatives (shortest vs. camera-minimizing at different avoidance strengths), with stats per route — distance, number of cameras within sight/25 m, total "exposed" meters. No turn-by-turn navigation.

**Can it be an overlay over OSM itself?**
Effectively yes. The site is a Leaflet/MapLibre map using OSM raster tiles as the base layer, with two vector overlays we control: camera points (with direction cones where `camera:direction` is tagged, like sunders) and the computed routes. That *is* "OSM + overlay" — we don't need to touch OSM infrastructure. (Contributing an actual layer to openstreetmap.org is not realistic; a standalone site with OSM tiles is the standard way.)

## Core idea: exposure-weighted routing

Standard routers minimize distance/time. We minimize a blended cost per edge:

```
cost(edge) = length(edge) + α · exposure(edge)
```

- `exposure(edge)` = meters of the edge that fall within the "visibility zone" of any camera.
  - **MVP**: visibility zone = a fixed-radius disc (e.g. 25 m) around each outdoor camera. Simple, robust, no tag quality needed.
  - **v2**: where `camera:direction` / `camera:angle` / `camera:mount` / `surveillance:zone` are tagged, use a view cone instead of a disc; weight dome cameras and ALPR differently; account for `surveillance=indoor` (exclude) vs `outdoor`/`public`.
- `α` is the user-facing "avoidance" slider: `α = 0` gives the shortest path; large `α` treats every camera-covered meter as very expensive. We show routes for a few α values simultaneously so the trade-off (extra distance vs. cameras avoided) is visible.

This penalty approach beats hard "no-go zones": in dense areas (Alexanderplatz, train stations) hard avoidance makes destinations unreachable; a penalty always returns a route and reports the residual exposure honestly.

## Architecture (MVP)

Three pieces, all simple:

```
[offline pipeline: Python]          [backend: FastAPI]        [frontend: static site]
pbf + Overpass                      loads graph.pkl            Leaflet/MapLibre + OSM tiles
  → walk/bike graph (osmnx)         GET /route?from&to&        camera overlay (GeoJSON)
  → per-edge exposure precomputed        profile&alpha          route overlay + stats panel
  → graph.pkl + cameras.geojson     A* over weighted graph
```

**Why a small backend instead of routing fully in the browser?** Berlin's walk network is ~1 M edges; shipping the whole graph to the browser is 30–60 MB even in a compact binary format. Doable, but not MVP-simple. A ~100-line FastAPI service with the graph in memory answers A* queries in well under a second. Fully-static client-side routing (typed-array graph + A* in JS/WASM, hostable on GitHub Pages) is a clean **phase 2** goal — the preprocessing pipeline stays identical.

**Why not GraphHopper/Valhalla/BRouter with custom profiles?** Their custom-cost mechanisms key off *way tags*, not proximity to arbitrary points; injecting thousands of camera zones means either abusing avoid-polygon lists (doesn't scale) or forking their preprocessing. Precomputing exposure onto edges ourselves in Python is less code and fully under our control. (BRouter no-go areas become relevant again in the far-future OsmAnd phase — see below.)

## Milestones

### M1 — Data pipeline (Python)
1. `fetch_cameras.py`: Overpass query for Berlin — `node/way[man_made=surveillance]` plus tags (`surveillance`, `surveillance:type`, `camera:direction`, `camera:angle`, `camera:mount`, `operator`). Filter to `surveillance:type=camera` (and untyped), drop `surveillance=indoor`. Output `cameras.geojson`.
2. `build_graph.py`: load `berlin-latest.osm.pbf` with osmnx/pyrosm, build **walk** and **bike** graphs, project to UTM 33N (meters).
3. `compute_exposure.py`: spatial index (STRtree) over camera discs; for each edge, intersect geometry with the union of discs → `exposure_m` and `camera_ids` per edge. Persist graphs (pickle/graphml) + a summary report (what % of Berlin's network is camera-covered — good sanity check and good blog material).

### M2 — Routing backend (FastAPI)
- `GET /route?from=lat,lon&to=lat,lon&profile=walk|bike&alpha=…` → snaps endpoints to the graph, runs A* with `length + α·exposure`, returns GeoJSON LineString + stats: `distance_m`, `exposed_m`, `n_cameras` (distinct cameras within radius of the path), and the same for the α=0 shortest path as baseline.
- `GET /cameras` → serves `cameras.geojson` (or bbox-filtered).
- Dockerfile so the whole thing is `docker compose up`.

### M3 — Frontend (static HTML/JS, MapLibre or Leaflet)
- OSM base tiles; camera layer (dots, direction cones when tagged, popup with camera tags — sunders-style).
- Click to set start/end (plus address search via Nominatim later).
- Avoidance slider; render shortest path (grey) and low-camera path (green) together; stats panel: "+640 m (+9 min), 14 → 2 cameras, 310 m → 40 m exposed".
- Highlight route segments that are still inside camera zones in red, so residual exposure is visible on the map.

### M4 — Polish & deploy
- Deploy backend + static frontend on a small VPS (or Uberspace, fittingly).
- Weekly cron: re-fetch cameras, rebuild exposure, hot-reload graph.
- README, attribution (ODbL / OSM contributors), disclaimer that OSM camera coverage is **incomplete** — this is "known cameras", not "all cameras".

## Later (explicitly not MVP)
- **Client-side routing** for fully static hosting (compact binary graph + A* in the browser/WASM).
- **View-cone exposure model** using camera direction/angle; building shadowing (a camera can't see through a building — use building footprints for a cheap viewshed).
- **Other cities**: pipeline is city-agnostic; only the extract + bbox change.
- **OsmAnd**: the realistic path is BRouter (which OsmAnd can use as routing backend) — generate no-go/penalty area files from the camera data, or a custom profile over pre-tagged data. Far later; the graph pipeline output feeds it.

## Risks / open points
- **Data completeness**: routing quality is capped by OSM camera mapping. Berlin is among the best-mapped cities (thanks to the sunders community), still nowhere near complete. The UI must communicate this.
- **Graph size/memory**: Berlin walk graph in NetworkX may take a few GB of RAM naively; if so, switch to igraph or a plain CSR adjacency structure (also the stepping stone to client-side routing).
- **Dense areas**: near stations, all paths are covered; the multi-α display handles this gracefully rather than failing.
- **Tile usage policy**: openstreetmap.org tiles have a fair-use policy; fine for MVP, switch to a tile provider key if traffic grows.

## Suggested stack summary
| Piece | Choice |
|---|---|
| Preprocessing | Python: osmnx/pyrosm, shapely, geopandas |
| Camera data | Overpass API → GeoJSON |
| Routing | NetworkX/igraph A*, custom weight, FastAPI |
| Frontend | MapLibre GL JS (or Leaflet), vanilla JS, OSM tiles |
| Deploy | Docker on a small VPS; static frontend anywhere |
