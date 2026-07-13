#!/usr/bin/env python3
"""Annotate every graph edge with its surveillance exposure.

For each edge, exposure is the number of meters of the edge geometry that
lie within `radius` meters of any known camera (MVP visibility model:
a disc per camera; view cones come later). The router then minimizes

    cost(edge) = length + alpha * exposure

Writes the enriched graph back in place and prints coverage stats.

Usage:
    python pipeline/compute_exposure.py --graph data/graph_walk.pkl.gz
"""

import argparse
import gzip
import json
import pickle
import sys
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import LineString, Point
from shapely.ops import unary_union
from shapely.strtree import STRtree

DEFAULT_RADIUS = 25.0


def load_cameras(path: Path, crs) -> tuple[list[Point], list[str]]:
    collection = json.loads(path.read_text())
    transformer = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    points, ids = [], []
    for feat in collection["features"]:
        lon, lat = feat["geometry"]["coordinates"]
        x, y = transformer.transform(lon, lat)
        points.append(Point(x, y))
        ids.append(feat["properties"].get("osm_id", "?"))
    return points, ids


def edge_geometry(graph, u, v, data) -> LineString:
    geom = data.get("geometry")
    if geom is not None:
        return geom
    nu, nv = graph.nodes[u], graph.nodes[v]
    return LineString([(nu["x"], nu["y"]), (nv["x"], nv["y"])])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    data_dir = Path(__file__).resolve().parents[1] / "data"
    parser.add_argument("--graph", default=str(data_dir / "graph_walk.pkl.gz"))
    parser.add_argument("--cameras", default=str(data_dir / "cameras.geojson"))
    parser.add_argument("--radius", type=float, default=DEFAULT_RADIUS)
    args = parser.parse_args()

    graph_path = Path(args.graph)
    print(f"Loading graph {graph_path} ...")
    with gzip.open(graph_path, "rb") as f:
        graph = pickle.load(f)
    crs = graph.graph["crs"]

    points, ids = load_cameras(Path(args.cameras), crs)
    print(f"Loaded {len(points)} cameras; buffering discs of {args.radius} m")
    discs = [p.buffer(args.radius, quad_segs=8) for p in points]
    tree = STRtree(discs)

    total_len = 0.0
    total_exposed = 0.0
    exposed_edges = 0
    seen_cameras = set()

    for u, v, k, data in graph.edges(keys=True, data=True):
        geom = edge_geometry(graph, u, v, data)
        total_len += data.get("length", geom.length)
        hits = tree.query(geom, predicate="intersects")
        if len(hits) == 0:
            data["exposure"] = 0.0
            continue
        exposure = geom.intersection(unary_union([discs[i] for i in hits])).length
        data["exposure"] = float(exposure)
        data["cameras"] = [ids[i] for i in hits]
        seen_cameras.update(data["cameras"])
        total_exposed += exposure
        exposed_edges += 1

    graph.graph["exposure_radius_m"] = args.radius
    with gzip.open(graph_path, "wb") as f:
        pickle.dump(graph, f, protocol=pickle.HIGHEST_PROTOCOL)

    pct = 100 * total_exposed / total_len if total_len else 0
    print(
        f"Done: {exposed_edges}/{graph.number_of_edges()} edges exposed, "
        f"{total_exposed / 1000:.1f} of {total_len / 1000:.1f} km covered ({pct:.1f}%), "
        f"{len(seen_cameras)} cameras touch the network"
    )
    print(f"Saved enriched graph to {graph_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
