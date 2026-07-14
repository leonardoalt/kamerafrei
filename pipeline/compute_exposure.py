#!/usr/bin/env python3
"""Annotate every graph edge with its surveillance exposure.

Visibility model (v2):
- cameras with a tagged `camera:direction` (and not dome/panning) see a
  CONE: bearing ± CONE_HALF_ANGLE°, up to --cone-radius meters
- all other cameras see a full disc of --radius meters
- both are clipped by BUILDING SHADOWS: rays stop at the first building
  wall (data/buildings.geojson from pipeline/fetch_buildings.py); without
  that file, zones are unclipped (v1 behavior, with a warning)

exposure(edge) = meters of the edge inside the union of visibility zones.
The router then minimizes cost = length + alpha * exposure.

Usage:
    python pipeline/compute_exposure.py --graph data/graph_walk.pkl.gz
"""

import argparse
import gzip
import json
import math
import pickle
import sys
from pathlib import Path

import numpy as np
from pyproj import Transformer
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree
from shapely.validation import make_valid


def line_parts(geom):
    if geom is None or geom.is_empty:
        return []
    if geom.geom_type == "LineString":
        return [geom]
    if geom.geom_type in ("MultiLineString", "GeometryCollection"):
        return [p for g in geom.geoms for p in line_parts(g)]
    return []

DEFAULT_RADIUS = 25.0
DEFAULT_CONE_RADIUS = 40.0
CONE_HALF_ANGLE = 35.0
RAY_STEP_DEG = 3.0
WALL_CLEARANCE_M = 2.0  # cameras are mounted on walls; ignore hits this close

CARDINALS = {
    "N": 0.0, "NNE": 22.5, "NE": 45.0, "ENE": 67.5, "E": 90.0, "ESE": 112.5,
    "SE": 135.0, "SSE": 157.5, "S": 180.0, "SSW": 202.5, "SW": 225.0,
    "WSW": 247.5, "W": 270.0, "WNW": 292.5, "NW": 315.0, "NNW": 337.5,
}

OMNI_TYPES = {"dome", "panning"}  # rotate/see all around: treat as disc


def parse_directions(value):
    if value is None:
        return []
    out = []
    for part in str(value).split(";"):
        part = part.strip().upper()
        if part in CARDINALS:
            out.append(CARDINALS[part])
        else:
            try:
                out.append(float(part) % 360.0)
            except ValueError:
                pass  # ranges like "45-90" fall back to a disc
    return out


def load_cameras(path: Path, crs):
    collection = json.loads(path.read_text())
    transformer = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    cams = []
    for feat in collection["features"]:
        lon, lat = feat["geometry"]["coordinates"]
        x, y = transformer.transform(lon, lat)
        props = feat["properties"]
        cams.append(
            {
                "x": x,
                "y": y,
                "id": props.get("osm_id", "?"),
                "directions": parse_directions(props.get("camera:direction")),
                "omni": props.get("camera:type") in OMNI_TYPES,
            }
        )
    return cams


def load_building_rings(path: Path, crs):
    """Projected exterior rings as numpy coord arrays + an STRtree over them."""
    collection = json.loads(path.read_text())
    transformer = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    rings, geoms = [], []
    for feat in collection["features"]:
        coords = feat["geometry"]["coordinates"][0]
        xs, ys = transformer.transform([c[0] for c in coords], [c[1] for c in coords])
        arr = np.column_stack([xs, ys])
        rings.append(arr)
        geoms.append(LineString(arr))
    return rings, (STRtree(geoms) if geoms else None)


def ray_distances(cx, cy, bearings_deg, max_r, seg_a, seg_b):
    """Distance each ray travels before hitting a wall (vectorized).

    bearings are compass degrees (0=N, clockwise); returns array of lengths.
    """
    th = np.radians(bearings_deg)
    d = np.column_stack([np.sin(th), np.cos(th)])  # (M, 2)
    if seg_a is None or len(seg_a) == 0:
        return np.full(len(bearings_deg), max_r)

    p = np.array([cx, cy])
    ap = seg_a - p  # (N, 2)
    ab = seg_b - seg_a  # (N, 2)
    cross_ap_ab = ap[:, 0] * ab[:, 1] - ap[:, 1] * ab[:, 0]  # (N,)
    # denom[m, n] = d_m x ab_n
    denom = d[:, 0, None] * ab[None, :, 1] - d[:, 1, None] * ab[None, :, 0]
    # u[m, n] = (ap_n x d_m) / denom
    cross_ap_d = ap[None, :, 0] * d[:, 1, None] - ap[None, :, 1] * d[:, 0, None]
    with np.errstate(divide="ignore", invalid="ignore"):
        t = cross_ap_ab[None, :] / denom
        u = cross_ap_d / denom
    valid = (
        (np.abs(denom) > 1e-12)
        & (u >= 0.0)
        & (u <= 1.0)
        & (t > WALL_CLEARANCE_M)
        & (t < max_r)
    )
    t = np.where(valid, t, max_r)
    return t.min(axis=1)


def visibility_zones(cam, rings, tree, radius, cone_radius):
    """One or more shapely polygons this camera can see."""
    directed = cam["directions"] and not cam["omni"]
    max_r = cone_radius if directed else radius

    seg_a = seg_b = None
    if tree is not None:
        probe = Point(cam["x"], cam["y"]).buffer(max_r)
        idxs = tree.query(probe)
        if len(idxs):
            parts_a, parts_b = [], []
            for i in idxs:
                arr = rings[i]
                parts_a.append(arr[:-1])
                parts_b.append(arr[1:])
            seg_a = np.vstack(parts_a)
            seg_b = np.vstack(parts_b)

    zones = []
    if directed:
        for bearing in cam["directions"]:
            angles = np.arange(
                bearing - CONE_HALF_ANGLE, bearing + CONE_HALF_ANGLE + 0.01, 2.5
            )
            dist = ray_distances(cam["x"], cam["y"], angles, cone_radius, seg_a, seg_b)
            th = np.radians(angles)
            pts = np.column_stack(
                [cam["x"] + dist * np.sin(th), cam["y"] + dist * np.cos(th)]
            )
            poly = Polygon([(cam["x"], cam["y"]), *map(tuple, pts)])
            if not poly.is_valid:
                poly = make_valid(poly)
            if not poly.is_empty:
                zones.append(poly)
    else:
        angles = np.arange(0.0, 360.0, RAY_STEP_DEG)
        dist = ray_distances(cam["x"], cam["y"], angles, radius, seg_a, seg_b)
        th = np.radians(angles)
        pts = np.column_stack(
            [cam["x"] + dist * np.sin(th), cam["y"] + dist * np.cos(th)]
        )
        poly = Polygon(map(tuple, pts))
        if not poly.is_valid:
            poly = make_valid(poly)
        if not poly.is_empty:
            zones.append(poly)
    return zones


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
    parser.add_argument("--buildings", default=str(data_dir / "buildings.geojson"))
    parser.add_argument("--radius", type=float, default=DEFAULT_RADIUS)
    parser.add_argument("--cone-radius", type=float, default=DEFAULT_CONE_RADIUS)
    args = parser.parse_args()

    graph_path = Path(args.graph)
    print(f"Loading graph {graph_path} ...")
    with gzip.open(graph_path, "rb") as f:
        graph = pickle.load(f)
    crs = graph.graph["crs"]

    cams = load_cameras(Path(args.cameras), crs)
    buildings_path = Path(args.buildings)
    if buildings_path.exists():
        rings, tree = load_building_rings(buildings_path, crs)
        print(f"Loaded {len(cams)} cameras, {len(rings)} building rings (shadowing ON)")
    else:
        rings, tree = [], None
        print(
            f"Loaded {len(cams)} cameras — {buildings_path} missing, "
            f"zones are NOT building-clipped (run pipeline/fetch_buildings.py)"
        )

    print("Computing visibility zones ...")
    zones, zone_cam = [], []
    n_cones = 0
    for cam in cams:
        polys = visibility_zones(cam, rings, tree, args.radius, args.cone_radius)
        if cam["directions"] and not cam["omni"]:
            n_cones += len(polys)
        for poly in polys:
            zones.append(poly)
            zone_cam.append(cam["id"])
    zone_tree = STRtree(zones)
    print(f"  {len(zones)} zones ({n_cones} view cones, rest discs)")

    total_len = 0.0
    total_exposed = 0.0
    exposed_edges = 0
    seen_cameras = set()

    for u, v, k, data in graph.edges(keys=True, data=True):
        geom = edge_geometry(graph, u, v, data)
        total_len += data.get("length", geom.length)
        hits = zone_tree.query(geom, predicate="intersects")
        if len(hits) == 0:
            data["exposure"] = 0.0
            data.pop("cameras", None)
            data.pop("exposure_ivals", None)
            continue
        inter = geom.intersection(unary_union([zones[i] for i in hits]))
        data["exposure"] = float(inter.length)
        # normalized [t0, t1] intervals along the edge geometry: lets the UI
        # paint exactly the seen meters instead of whole edges
        ivals = []
        for part in line_parts(inter):
            t0 = geom.project(Point(part.coords[0])) / geom.length
            t1 = geom.project(Point(part.coords[-1])) / geom.length
            if t1 < t0:
                t0, t1 = t1, t0
            if t1 - t0 > 1e-6:
                ivals.append((round(t0, 5), round(t1, 5)))
        data["exposure_ivals"] = sorted(ivals)
        data["cameras"] = sorted({zone_cam[i] for i in hits})
        seen_cameras.update(data["cameras"])
        total_exposed += data["exposure"]
        exposed_edges += 1

    graph.graph["exposure_radius_m"] = args.radius
    graph.graph["exposure_model"] = "cones+shadows" if tree is not None else "cones"
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
