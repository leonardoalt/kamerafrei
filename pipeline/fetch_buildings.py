#!/usr/bin/env python3
"""Fetch building footprints near surveillance cameras (for view shadowing).

Cameras can't see through walls: compute_exposure clips each camera's
visibility zone against these footprints. Only buildings within `AROUND` m
of a camera matter, which keeps the download small (the full Berlin
building set would be ~100x larger). Multipolygon relation buildings are
ignored — a rare, acceptable loss.

Usage:
    python pipeline/fetch_buildings.py                 # Berlin
    python pipeline/fetch_buildings.py --bbox S,W,N,E  # small area (testing)
"""

import argparse
import json
import sys
from pathlib import Path

from fetch_cameras import OVERPASS_URLS, fetch  # noqa: F401  (shared retry logic)

AROUND = 60  # meters around a camera that a building can shadow

BERLIN_QUERY = f"""
[out:json][timeout:600];
area["ISO3166-2"="DE-BE"][admin_level=4]->.a;
node["man_made"="surveillance"](area.a)->.cams;
way["man_made"="surveillance"](area.a)->.camways;
(
  way["building"](around.cams:{AROUND});
  way["building"](around.camways:{AROUND});
);
out geom;
"""

BBOX_QUERY = f"""
[out:json][timeout:600][bbox:{{bbox}}];
node["man_made"="surveillance"]->.cams;
way["man_made"="surveillance"]->.camways;
(
  way["building"](around.cams:{AROUND});
  way["building"](around.camways:{AROUND});
);
out geom;
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bbox", help="south,west,north,east instead of all of Berlin")
    parser.add_argument(
        "--out",
        default=str(Path(__file__).resolve().parents[1] / "data" / "buildings.geojson"),
    )
    args = parser.parse_args()

    query = BBOX_QUERY.format(bbox=args.bbox) if args.bbox else BERLIN_QUERY
    print("Fetching building footprints near cameras ...")
    data = fetch(query)

    features = []
    for el in data.get("elements", []):
        geom = el.get("geometry")
        if el["type"] != "way" or not geom or len(geom) < 4:
            continue
        ring = [[p["lon"], p["lat"]] for p in geom]
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [ring]},
                "properties": {"osm_id": f"way/{el['id']}"},
            }
        )

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    print(f"Wrote {len(features)} buildings to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
