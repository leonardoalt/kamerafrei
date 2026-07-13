#!/usr/bin/env python3
"""Fetch surveillance cameras from OpenStreetMap via the Overpass API.

Queries man_made=surveillance nodes and ways (same data that
"Surveillance under Surveillance" visualizes), filters out indoor and
non-camera devices, and writes a GeoJSON FeatureCollection.

Usage:
    python pipeline/fetch_cameras.py                      # all of Berlin
    python pipeline/fetch_cameras.py --bbox S,W,N,E       # small area (testing)
    python pipeline/fetch_cameras.py --out data/cameras.geojson
"""

import argparse
import json
import sys
import time
from pathlib import Path

import requests

# Tried in order, with retries — public Overpass instances flake regularly.
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
USER_AGENT = "invisible/0.1 (camera-avoiding route planner)"

BERLIN_QUERY = """
[out:json][timeout:300];
area["ISO3166-2"="DE-BE"][admin_level=4]->.searchArea;
(
  node["man_made"="surveillance"](area.searchArea);
  way["man_made"="surveillance"](area.searchArea);
);
out center;
"""

BBOX_QUERY = """
[out:json][timeout:300][bbox:{bbox}];
(
  node["man_made"="surveillance"];
  way["man_made"="surveillance"];
);
out center;
"""

# surveillance:type values that are actual cameras. Missing tag is kept:
# the vast majority of untyped man_made=surveillance objects are cameras.
CAMERA_TYPES = {"camera", "ALPR", "webcam"}


def is_camera(tags: dict) -> bool:
    if tags.get("surveillance") == "indoor":
        return False
    stype = tags.get("surveillance:type")
    if stype is None:
        return True
    return any(t.strip() in CAMERA_TYPES for t in stype.split(";"))


def element_coords(el: dict):
    if el["type"] == "node":
        return el.get("lon"), el.get("lat")
    center = el.get("center")
    if center:
        return center.get("lon"), center.get("lat")
    return None, None


def fetch(query: str, attempts: int = 3) -> dict:
    last_error: Exception = RuntimeError("no Overpass endpoint configured")
    for attempt in range(attempts):
        for url in OVERPASS_URLS:
            try:
                resp = requests.post(
                    url,
                    data={"data": query},
                    timeout=360,
                    headers={"User-Agent": USER_AGENT},
                )
                resp.raise_for_status()
                return resp.json()
            except (requests.RequestException, ValueError) as exc:
                print(f"  {url}: {exc}", file=sys.stderr)
                last_error = exc
        if attempt < attempts - 1:
            wait = 10 * (attempt + 1)
            print(f"  all endpoints failed, retrying in {wait}s ...", file=sys.stderr)
            time.sleep(wait)
    raise last_error


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--bbox",
        help="south,west,north,east — query this bbox instead of all of Berlin",
    )
    parser.add_argument(
        "--out",
        default=str(Path(__file__).resolve().parents[1] / "data" / "cameras.geojson"),
    )
    args = parser.parse_args()

    if args.bbox:
        query = BBOX_QUERY.format(bbox=args.bbox)
        print(f"Fetching cameras in bbox {args.bbox} ...")
    else:
        query = BERLIN_QUERY
        print("Fetching cameras in Berlin ...")

    data = fetch(query)
    features = []
    skipped = 0
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        if not is_camera(tags):
            skipped += 1
            continue
        lon, lat = element_coords(el)
        if lon is None or lat is None:
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {"osm_id": f"{el['type']}/{el['id']}", **tags},
            }
        )

    collection = {"type": "FeatureCollection", "features": features}
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(collection))
    print(f"Wrote {len(features)} cameras to {out} (skipped {skipped} non-camera/indoor)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
