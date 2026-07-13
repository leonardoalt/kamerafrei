# Plan: client-side routing

Goal: the A* runs in the visitor's browser over a compact binary graph.
The 2.5 GB Python server becomes optional; the site can be hosted
statically, works offline once cached, and the avoidance slider responds
instantly. The current backend stays as dev oracle and fallback.

## 1. Binary graph format (per profile)

One `graph_<profile>.bin` file, little-endian typed arrays back to back,
described by a small JSON header at the start (offsets, counts, scales):

| section        | type            | walk size | notes |
|----------------|-----------------|-----------|-------|
| node coords    | int32 ×2        | 3.3 MB    | lat/lon ×1e7 (no UTM in the client) |
| CSR offsets    | uint32          | 1.6 MB    | node → first out-edge |
| edge target    | uint32          | 4.2 MB    | |
| edge length    | uint32 (cm)     | 4.2 MB    | |
| edge exposure  | uint16 (dm)     | 2.1 MB    | exporter asserts it fits |
| geometry index | uint32          | 4.2 MB    | 0 = straight edge |
| geometry pool  | zigzag varints  | ~5 MB     | deltas ×1e6 deg, shared by reciprocal edges |

≈ 25 MB raw, ~12–16 MB over the wire (brotli). Bike ≈ 40 % of that.

Decisions folded into the format:

- **Coordinates are lat/lon, not UTM** — the client never needs pyproj.
  The A* heuristic uses equirectangular distance with the Berlin scale
  factors (111320, 111320·cos 52.52°) × 0.999 to stay admissible.
- **Geometry tiering**: mean edge is 37 m, so node-to-node straight lines
  are visually correct for most edges; the exporter stores real polylines
  only for edges > ~75 m or with high curvature. Cuts the pool a lot.
- **Parallel edges**: exporter drops pareto-dominated parallels (both
  longer *and* more exposed for any α ≥ 0); survivors stay as separate
  CSR entries. The client A* then never needs multi-edge logic.
- **Cameras**: `cameras.bin` (int32 coord pairs + radius, ~30 KB) so the
  client can compute exact exposed segments / cameras-passed, same disc
  math as `CameraIndex`.

## 2. New pipeline step

`pipeline/export_web.py` — reads the existing pickles, writes
`data/web/graph_walk.bin`, `graph_bike.bin`, `cameras.bin`, `meta.json`.
Pure numpy, no new deps. Wire into `make berlin` / `make test-area` and
`scripts/refresh_cameras.sh` (exposure refresh ⇒ re-export).

## 3. Client router

`frontend/router.js`, run inside a **Web Worker** (map stays responsive):

- fetch → ArrayBuffer → typed-array views (no parsing).
- A* with a binary heap over CSR arrays; cost = `length + α·exposure`
  in integer cm; Int32Array parent + Float64Array dist, reset via a
  generation-stamp array (no reallocation per query).
- Snap = uniform 100 m grid hash over nodes, built once at load.
- Route → coords from node coords + geometry pool; stats (distance,
  exposed_m) from the arrays; cameras passed + red segments via
  segment-circle intersection against the camera grid.
- Same response shape as `/api/route`, so the UI doesn't care who answered.

Expected performance: well under 200 ms for cross-city queries (the
Python A* does ~40–50 ms per search here; typed-array JS is usually
within 2–3× of that). If it disappoints on old phones: bidirectional A*.

## 4. UI integration — progressive, no flag day

`routing.js` exposes one interface with two implementations:

1. Page loads → **remote** routing works immediately (as today).
2. Worker starts downloading the graph in the background, status line
   shows progress ("offline routing: 40 %").
3. Download done → switch to **local**; slider changes re-route with no
   network round-trip. Remote stays as error fallback.
4. **Service worker** caches graph + app shell (Cache API) → revisits
   load instantly and the app works offline; add a PWA manifest so it
   can be installed to the home screen (first step toward the
   "phone app" ambition without writing one).

Only walk downloads eagerly; bike fetches on first use.

## 5. Verification

The server is the oracle: a harness routes N random O/D pairs × each α
on both implementations and asserts equal cost (paths may tie) and
matching stats within quantization tolerance. Run via node in CI-ish
fashion (`make verify-client`).

## 6. Deployment consequences

- Phase A: nothing changes operationally — same tunnel, server also
  serves the `.bin` files (long-cache headers, versioned names).
- Phase B (optional): move the static bundle to GitHub Pages/CDN; the
  laptop then only matters as fallback API; eventually retire it.
- Weekly refresh: exporter runs after exposure recompute; graph file
  name carries a version/date so caches roll over cleanly.

## 7. Order of work

1. **Exporter + node CLI parity test** — format frozen once parity holds
   (the biggest chunk, ~1–2 days).
2. **Worker + loader + UI switch** behind `?client=1` (~1 day).
3. **Exact stats + geometry tiering polish** (~1 day).
4. **Service worker, PWA manifest, progress UX, flip default** (~1 day).
5. (Optional) static-host migration.

## Risks

- **Mobile data**: 12–16 MB first download — mitigated by progress UI,
  persistent cache, walk-only eager load. Not auto-downloading on
  metered connections isn't reliably detectable; accept it.
- **iOS Safari memory**: ~35 MB of arrays is safely under limits.
- **Drift**: client and server cost functions must stay identical;
  the parity harness is the guard.
- **Quantization**: cm/dm rounding changes costs by <0.1 % — tolerance
  in the harness, invisible to users.
