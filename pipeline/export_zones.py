#!/usr/bin/env python3
"""Export camera visibility zones as GeoJSON for the map display.

Same model as compute_exposure (cones/discs clipped by buildings), so what
users see is exactly what the router avoids. Fast: no graph involved.

Usage:
    python pipeline/export_zones.py            # -> data/web/zones.geojson(.gz)
"""

import argparse
import gzip
import json
import sys
from pathlib import Path

from pyproj import Transformer
from shapely.ops import transform as shapely_transform

from compute_exposure import (
    DEFAULT_CONE_RADIUS,
    DEFAULT_RADIUS,
    load_building_rings,
    load_cameras,
    visibility_zones,
)

CRS = "EPSG:32633"  # Berlin UTM; matches the graph projection
SIMPLIFY_M = 0.8


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    data_dir = Path(__file__).resolve().parents[1] / "data"
    parser.add_argument("--cameras", default=str(data_dir / "cameras.geojson"))
    parser.add_argument("--buildings", default=str(data_dir / "buildings.geojson"))
    parser.add_argument("--radius", type=float, default=DEFAULT_RADIUS)
    parser.add_argument("--cone-radius", type=float, default=DEFAULT_CONE_RADIUS)
    parser.add_argument("--out", default=str(data_dir / "web" / "zones.geojson"))
    args = parser.parse_args()

    cams = load_cameras(Path(args.cameras), CRS)
    buildings_path = Path(args.buildings)
    if buildings_path.exists():
        rings, tree = load_building_rings(buildings_path, CRS)
    else:
        rings, tree = [], None
        print(f"WARNING: {buildings_path} missing — zones not building-clipped")

    to_wgs = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)
    features = []
    for cam in cams:
        for poly in visibility_zones(cam, rings, tree, args.radius, args.cone_radius):
            poly = poly.simplify(SIMPLIFY_M)
            if poly.is_empty or poly.geom_type != "Polygon":
                continue
            wgs = shapely_transform(to_wgs.transform, poly)
            features.append(
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [
                            [[round(x, 6), round(y, 6)] for x, y in wgs.exterior.coords]
                        ],
                    },
                    "properties": {"camera": cam["id"]},
                }
            )

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps({"type": "FeatureCollection", "features": features})
    out.write_text(payload)
    with open(out.with_suffix(out.suffix + ".gz"), "wb") as f:
        with gzip.GzipFile(fileobj=f, mode="wb", compresslevel=9, mtime=0) as gz:
            gz.write(payload.encode())
    print(
        f"Wrote {len(features)} zones to {out} "
        f"({out.stat().st_size / 1e6:.1f} MB, "
        f"{out.with_suffix(out.suffix + '.gz').stat().st_size / 1e6:.1f} MB gz)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
