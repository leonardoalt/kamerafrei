# invisible

A walk/bike route planner for Berlin that minimizes exposure to known
surveillance cameras, using OpenStreetMap `man_made=surveillance` data —
the same data [Surveillance under Surveillance](https://sunders.uber.space)
visualizes. See [PLAN.md](PLAN.md) for the full design.

**How it works:** an offline pipeline builds Berlin's walk/bike network with
osmnx and annotates every edge with `exposure` — the meters of that edge
within 25 m of a known camera. The router then minimizes
`length + α · exposure` with A*, where α is the "camera avoidance" slider.
The web UI shows the shortest path and the low-camera path side by side,
with the residual in-camera-zone segments highlighted in red.

> **Honest disclaimer:** OSM camera coverage is incomplete. This avoids
> *known* cameras, not all cameras.

## Quickstart

```sh
make venv

# Option A — quick test on a small Kreuzberg area (~2 min, all via Overpass):
make test-area

# Option B — full Berlin (downloads the whole network via Overpass; takes a
# while and a few GB of RAM):
make berlin

make serve        # then open http://127.0.0.1:8000
```

Click the map to set start (A) and destination (B), pick walk/bike, and move
the *camera avoidance* slider: `α×` means one camera-covered meter costs as
much as `1+α` open meters. The stats panel compares distance, time, cameras
passed, and exposed meters against the shortest path.

## Layout

```
pipeline/fetch_cameras.py     Overpass → data/cameras.geojson
pipeline/build_graph.py       osmnx → data/graph_{walk,bike}.pkl.gz (projected)
pipeline/compute_exposure.py  per-edge exposure via camera-disc intersection
backend/app.py                FastAPI: /api/route, /api/cameras + static frontend
backend/routing.py            A* with cost = length + α·exposure
frontend/                     Leaflet + OSM tiles, camera & route overlays
```

## API

```
GET /api/route?from_lat=..&from_lon=..&to_lat=..&to_lon=..&profile=walk|bike&alpha=15
GET /api/cameras
GET /api/health
```

`/api/route` returns the α=0 baseline and the avoiding route as GeoJSON, each
with `distance_m`, `duration_min`, `n_cameras`, `exposed_m`, and
`exposed_geometry` (the parts of the route inside camera zones).

## Refreshing data

Cameras change as mappers add them — re-run `make cameras exposure`
(no need to rebuild the graphs) and restart the server.

## Attribution

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright)
contributors, ODbL. Inspired by
[Surveillance under Surveillance](https://sunders.uber.space).
