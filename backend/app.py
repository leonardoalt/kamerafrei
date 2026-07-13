"""FastAPI backend: exposure-weighted routes + camera data + static frontend.

Run:  .venv/bin/uvicorn backend.app:app --port 8000
Data: expects data/graph_{walk,bike}.pkl.gz (from the pipeline) and
      data/cameras.geojson. Profiles whose graph is missing return 503.
"""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.routing import Router, SnapError

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
FRONTEND_DIR = ROOT / "frontend"
CAMERAS_PATH = DATA_DIR / "cameras.geojson"

routers: dict[str, Router] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    for profile in ("walk", "bike"):
        graph_path = DATA_DIR / f"graph_{profile}.pkl.gz"
        if graph_path.exists() and CAMERAS_PATH.exists():
            print(f"Loading {profile} graph ...")
            routers[profile] = Router(graph_path, CAMERAS_PATH, profile)
            print(
                f"  {profile}: {routers[profile].graph.number_of_edges()} edges, "
                f"{routers[profile].cameras.n_cameras} cameras"
            )
    if not routers:
        print("WARNING: no graphs found in data/ — run the pipeline first (see README)")
    yield


app = FastAPI(title="kamerafrei", lifespan=lifespan)


@app.get("/api/health")
def health():
    return {"profiles": sorted(routers), "cameras": CAMERAS_PATH.exists()}


@app.get("/api/cameras")
def cameras():
    if not CAMERAS_PATH.exists():
        raise HTTPException(404, "no camera data — run pipeline/fetch_cameras.py")
    return FileResponse(CAMERAS_PATH, media_type="application/geo+json")


@app.get("/api/route")
def route(
    from_lat: float = Query(..., ge=-90, le=90),
    from_lon: float = Query(..., ge=-180, le=180),
    to_lat: float = Query(..., ge=-90, le=90),
    to_lon: float = Query(..., ge=-180, le=180),
    profile: str = Query("walk"),
    alpha: float = Query(15.0, ge=0, le=1000),
):
    router = routers.get(profile)
    if router is None:
        raise HTTPException(
            503, f"profile {profile!r} not available — build data/graph_{profile}.pkl.gz"
        )
    origin, destination = (from_lat, from_lon), (to_lat, to_lon)
    try:
        baseline = router.route(origin, destination, alpha=0.0)
        results = [baseline]
        if alpha > 0:
            avoiding = router.route(origin, destination, alpha=alpha)
            avoiding["same_as_baseline"] = avoiding["node_path"] == baseline["node_path"]
            results.append(avoiding)
    except SnapError as exc:
        raise HTTPException(400, str(exc))
    for r in results:
        r.pop("node_path", None)
    return {"routes": results, "exposure_radius_m": router.radius}


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
