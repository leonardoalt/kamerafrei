"""Exposure-weighted routing over the preprocessed osmnx graph.

The pipeline stores per-edge `exposure` (meters within camera visibility).
Routes minimize  cost = length + alpha * exposure  via A*; the euclidean
heuristic stays admissible because exposure only ever adds cost.
"""

import gzip
import json
import pickle
from pathlib import Path

import networkx as nx
import numpy as np
from pyproj import Transformer
from scipy.spatial import cKDTree
from shapely.geometry import LineString, Point, mapping
from shapely.ops import substring
from shapely.ops import transform as shapely_transform
from shapely.ops import unary_union
from shapely.strtree import STRtree

MAX_SNAP_M = 500.0
SPEED_KMH = {"walk": 4.8, "bike": 15.0}


class SnapError(Exception):
    """Requested point is too far from the routing network."""


class CameraIndex:
    """Camera discs in the graph's projected CRS, for stats and display."""

    def __init__(self, cameras_path: Path, crs, radius: float):
        collection = json.loads(Path(cameras_path).read_text())
        to_proj = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
        self.ids: list[str] = []
        discs = []
        for feat in collection["features"]:
            lon, lat = feat["geometry"]["coordinates"]
            x, y = to_proj.transform(lon, lat)
            discs.append(Point(x, y).buffer(radius, quad_segs=8))
            self.ids.append(feat["properties"].get("osm_id", "?"))
        self.discs = discs
        self.tree = STRtree(discs) if discs else None
        self.n_cameras = len(discs)

    def analyze(self, line_proj: LineString):
        """Return (exposed geometry in projected CRS, exposed meters, camera ids)."""
        if self.tree is None:
            return None, 0.0, []
        hits = self.tree.query(line_proj, predicate="intersects")
        if len(hits) == 0:
            return None, 0.0, []
        zone = unary_union([self.discs[i] for i in hits])
        exposed = line_proj.intersection(zone)
        return exposed, exposed.length, sorted(self.ids[i] for i in hits)


def _line_parts(geom):
    if geom is None or geom.is_empty:
        return []
    if geom.geom_type == "LineString":
        return [geom]
    if geom.geom_type in ("MultiLineString", "GeometryCollection"):
        return [g for part in geom.geoms for g in _line_parts(part)]
    return []


class Router:
    def __init__(self, graph_path: Path, cameras_path: Path, profile: str):
        with gzip.open(graph_path, "rb") as f:
            self.graph = pickle.load(f)
        self.profile = profile
        self.crs = self.graph.graph["crs"]
        self.radius = float(self.graph.graph.get("exposure_radius_m", 25.0))
        self.to_proj = Transformer.from_crs("EPSG:4326", self.crs, always_xy=True)
        self.to_wgs84 = Transformer.from_crs(self.crs, "EPSG:4326", always_xy=True)

        self.node_ids = list(self.graph.nodes)
        coords = np.array(
            [(self.graph.nodes[n]["x"], self.graph.nodes[n]["y"]) for n in self.node_ids]
        )
        self._coords = coords
        self._kdtree = cKDTree(coords)
        self.cameras = CameraIndex(cameras_path, self.crs, self.radius)

    # -- snapping ----------------------------------------------------------

    def nearest_node(self, lat: float, lon: float):
        x, y = self.to_proj.transform(lon, lat)
        dist, idx = self._kdtree.query([x, y])
        if dist > MAX_SNAP_M:
            raise SnapError(
                f"point ({lat:.5f}, {lon:.5f}) is {dist:.0f} m from the network "
                f"(max {MAX_SNAP_M:.0f} m) — is it inside the built area?"
            )
        return self.node_ids[idx]

    # -- routing -----------------------------------------------------------

    def _weight(self, alpha: float):
        def weight(u, v, multi_edge):
            return min(
                d.get("length", 1.0) + alpha * d.get("exposure", 0.0)
                for d in multi_edge.values()
            )

        return weight

    def _heuristic(self):
        nodes = self.graph.nodes

        def h(u, v):
            nu, nv = nodes[u], nodes[v]
            return ((nu["x"] - nv["x"]) ** 2 + (nu["y"] - nv["y"]) ** 2) ** 0.5

        return h

    def _best_edge(self, u, v, alpha: float):
        candidates = self.graph[u][v]
        return min(
            candidates.values(),
            key=lambda d: d.get("length", 1.0) + alpha * d.get("exposure", 0.0),
        )

    def _edge_coords(self, u, v, data):
        geom = data.get("geometry")
        nu = self.graph.nodes[u]
        if geom is None:
            nv = self.graph.nodes[v]
            return [(nu["x"], nu["y"]), (nv["x"], nv["y"])]
        coords = list(geom.coords)
        # osmnx stores one geometry per original way; make sure it runs u -> v
        start, end = Point(coords[0]), Point(coords[-1])
        origin = Point(nu["x"], nu["y"])
        if start.distance(origin) > end.distance(origin):
            coords.reverse()
        return coords

    def route(self, origin: tuple, destination: tuple, alpha: float) -> dict:
        source = self.nearest_node(origin[0], origin[1])
        target = self.nearest_node(destination[0], destination[1])
        try:
            path = nx.astar_path(
                self.graph,
                source,
                target,
                heuristic=self._heuristic(),
                weight=self._weight(alpha),
            )
        except nx.NetworkXNoPath:
            raise SnapError("no path between these points on this network")
        return self._describe(path, alpha)

    def _describe(self, path: list, alpha: float) -> dict:
        coords: list[tuple] = []
        length = 0.0
        seen_m = 0.0  # meters inside camera visibility zones (the cost model)
        seen_pieces: list[list[tuple]] = []
        for u, v in zip(path[:-1], path[1:]):
            data = self._best_edge(u, v, alpha)
            edge_coords = self._edge_coords(u, v, data)
            if data.get("exposure", 0.0) > 0:
                seen_m += data["exposure"]
                ivals = data.get("exposure_ivals")
                if ivals:
                    # exact sub-edge pieces along the stored edge geometry
                    geom = data.get("geometry") or LineString(edge_coords)
                    for t0, t1 in ivals:
                        piece = substring(geom, t0, t1, normalized=True)
                        if piece.geom_type == "LineString" and len(piece.coords) >= 2:
                            seen_pieces.append(list(piece.coords))
                else:  # pre-interval data: whole edge (coarse)
                    seen_pieces.append(list(edge_coords))
            if coords:
                edge_coords = edge_coords[1:]
            coords.extend(edge_coords)
            length += data.get("length", 0.0)

        if len(coords) < 2:  # origin and destination snapped to the same node
            node = self.graph.nodes[path[0]]
            coords = [(node["x"], node["y"])] * 2

        line = LineString(coords)
        # n_cameras stays proximity-based ("cameras nearby"); exposed_m and
        # the red segments follow the routing model (visibility zones)
        _, _, camera_ids = self.cameras.analyze(line)

        def project_back(geom):
            return shapely_transform(self.to_wgs84.transform, geom)

        speed_m_min = SPEED_KMH[self.profile] * 1000 / 60

        return {
            "alpha": alpha,
            "profile": self.profile,
            "node_path": path,
            "distance_m": round(length, 1),
            "duration_min": round(length / speed_m_min, 1),
            "exposed_m": round(seen_m, 1),
            "n_cameras": len(camera_ids),
            "camera_ids": camera_ids,
            "geometry": mapping(project_back(line)),
            "exposed_geometry": {
                "type": "MultiLineString",
                "coordinates": [
                    list(project_back(LineString(piece)).coords)
                    for piece in seen_pieces
                ],
            },
        }
