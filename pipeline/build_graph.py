#!/usr/bin/env python3
"""Build routable walk/bike graphs from OpenStreetMap via osmnx.

Downloads the network from Overpass, simplifies it, projects it to a
metric CRS (UTM), and pickles it for the exposure step and the backend.

Usage:
    python pipeline/build_graph.py                          # Berlin, walk+bike
    python pipeline/build_graph.py --profile walk
    python pipeline/build_graph.py --point 52.499,13.42 --dist 1500   # small test area
"""

import argparse
import gzip
import pickle
import sys
from pathlib import Path

import osmnx as ox

PROFILES = {"walk": "walk", "bike": "bike"}


def build(profile: str, place: str, point, dist: int):
    network_type = PROFILES[profile]
    if point:
        print(f"Building {profile} graph around {point} (dist={dist} m) ...")
        graph = ox.graph_from_point(point, dist=dist, network_type=network_type)
    else:
        print(f"Building {profile} graph for {place!r} (this can take a while) ...")
        graph = ox.graph_from_place(place, network_type=network_type)
    graph = ox.project_graph(graph)
    print(
        f"  {profile}: {graph.number_of_nodes()} nodes, "
        f"{graph.number_of_edges()} edges, crs={graph.graph['crs']}"
    )
    return graph


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", choices=[*PROFILES, "both"], default="both")
    parser.add_argument("--place", default="Berlin, Germany")
    parser.add_argument("--point", help="lat,lon — build a small test area instead of --place")
    parser.add_argument("--dist", type=int, default=1500, help="radius in meters for --point")
    parser.add_argument(
        "--out-dir",
        default=str(Path(__file__).resolve().parents[1] / "data"),
    )
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    ox.settings.cache_folder = str(out_dir / "cache")
    ox.settings.use_cache = True

    point = None
    if args.point:
        lat, lon = (float(x) for x in args.point.split(","))
        point = (lat, lon)

    profiles = list(PROFILES) if args.profile == "both" else [args.profile]
    for profile in profiles:
        graph = build(profile, args.place, point, args.dist)
        out = out_dir / f"graph_{profile}.pkl.gz"
        with gzip.open(out, "wb") as f:
            pickle.dump(graph, f, protocol=pickle.HIGHEST_PROTOCOL)
        print(f"  saved {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
