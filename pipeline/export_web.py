#!/usr/bin/env python3
"""Export a pickled routing graph to the compact binary format the browser
router consumes (see docs/CLIENT_ROUTING.md).

Layout: 8-byte magic, uint32 header length, JSON header, then little-endian
typed-array sections (4-byte aligned):

    lat, lon            int32[n_nodes]      degrees * 1e7
    csr_offsets         uint32[n_nodes+1]
    edge_target         uint32[n_edges]
    edge_length_cm      uint32[n_edges]
    edge_exposure_dm    uint16[n_edges]
    geom_index          uint32[n_edges]     0 = straight, else byte offset+1
    geom_pool           bytes               varint-encoded intermediate points

Geometry is stored only where a straight node-to-node line would visibly
lie (long or strongly curved edges). Pareto-dominated parallel edges are
dropped so the client never needs multi-edge logic.

Usage:
    python pipeline/export_web.py --graph data/graph_walk.pkl.gz \
        --out data/web/graph_walk.bin
"""

import argparse
import gzip
import json
import math
import pickle
import struct
import sys
from pathlib import Path

import numpy as np
from pyproj import Transformer
from shapely.geometry import LineString

MAGIC = b"KFREI1\x00\x00"
COORD_SCALE = 10_000_000  # int32 degrees*1e7
GEOM_SCALE = 1_000_000  # varint deltas in degrees*1e6 (~0.11 m)
GEOM_MIN_LEN_M = 75.0
GEOM_MIN_DEV_M = 5.0


def append_varint(buf: bytearray, value: int):
    v = (value << 1) ^ (value >> 63) if value < 0 else value << 1  # zigzag
    while True:
        byte = v & 0x7F
        v >>= 7
        buf.append(byte | (0x80 if v else 0))
        if not v:
            return


def wants_geometry(geom, length_m: float) -> bool:
    if geom is None or len(geom.coords) <= 2:
        return False
    if length_m > GEOM_MIN_LEN_M:
        return True
    straight = LineString([geom.coords[0], geom.coords[-1]])
    return geom.hausdorff_distance(straight) > GEOM_MIN_DEV_M


def pareto_prune(edges):
    """Keep only (length, exposure)-non-dominated parallel edges."""
    edges = sorted(edges, key=lambda e: (e[0], e[1]))
    kept, best_exp = [], math.inf
    for e in edges:
        if e[1] < best_exp or not kept:
            kept.append(e)
            best_exp = e[1]
    return kept


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    data_dir = Path(__file__).resolve().parents[1] / "data"
    parser.add_argument("--graph", default=str(data_dir / "graph_walk.pkl.gz"))
    parser.add_argument("--out", default=None)
    args = parser.parse_args()

    graph_path = Path(args.graph)
    out_path = (
        Path(args.out)
        if args.out
        else graph_path.parent / "web" / (graph_path.name.split(".")[0] + ".bin")
    )
    profile = graph_path.stem.replace(".pkl", "").split("_")[-1]

    print(f"Loading {graph_path} ...")
    with gzip.open(graph_path, "rb") as f:
        G = pickle.load(f)

    to_wgs = Transformer.from_crs(G.graph["crs"], "EPSG:4326", always_xy=True)

    node_ids = list(G.nodes)
    index = {n: i for i, n in enumerate(node_ids)}
    xs = np.array([G.nodes[n]["x"] for n in node_ids])
    ys = np.array([G.nodes[n]["y"] for n in node_ids])
    lons, lats = to_wgs.transform(xs, ys)
    lat_i = np.round(np.asarray(lats) * COORD_SCALE).astype(np.int32)
    lon_i = np.round(np.asarray(lons) * COORD_SCALE).astype(np.int32)

    n = len(node_ids)
    offsets = np.zeros(n + 1, dtype=np.uint32)
    targets, lengths_cm, exposures_dm, geom_idx = [], [], [], []
    geom_pool = bytearray()
    pruned = 0
    with_geom = 0

    for i, u in enumerate(node_ids):
        offsets[i] = len(targets)
        for v, keyed in sorted(G.adj[u].items(), key=lambda kv: index[kv[0]]):
            cands = [
                (d.get("length", 1.0), d.get("exposure", 0.0), d) for d in keyed.values()
            ]
            kept = pareto_prune(cands)
            pruned += len(cands) - len(kept)
            for length, exposure, d in kept:
                length_cm = round(length * 100)
                exposure_dm = round(exposure * 10)
                assert length_cm < 2**32 and exposure_dm < 2**16, (u, v, length, exposure)
                targets.append(index[v])
                lengths_cm.append(length_cm)
                exposures_dm.append(exposure_dm)

                geom = d.get("geometry")
                if wants_geometry(geom, length):
                    with_geom += 1
                    geom_idx.append(len(geom_pool) + 1)
                    pts = list(geom.coords)[1:-1]
                    g_lons, g_lats = to_wgs.transform(
                        [p[0] for p in pts], [p[1] for p in pts]
                    )
                    append_varint(geom_pool, len(pts))
                    prev_lat = round(lat_i[i] / 10)
                    prev_lon = round(lon_i[i] / 10)
                    for plat, plon in zip(g_lats, g_lons):
                        cur_lat = round(plat * GEOM_SCALE)
                        cur_lon = round(plon * GEOM_SCALE)
                        append_varint(geom_pool, cur_lat - prev_lat)
                        append_varint(geom_pool, cur_lon - prev_lon)
                        prev_lat, prev_lon = cur_lat, cur_lon
                else:
                    geom_idx.append(0)
    offsets[n] = len(targets)

    sections = [
        ("lat", lat_i),
        ("lon", lon_i),
        ("csr_offsets", offsets),
        ("edge_target", np.array(targets, dtype=np.uint32)),
        ("edge_length_cm", np.array(lengths_cm, dtype=np.uint32)),
        ("edge_exposure_dm", np.array(exposures_dm, dtype=np.uint16)),
        ("geom_index", np.array(geom_idx, dtype=np.uint32)),
        ("geom_pool", np.frombuffer(bytes(geom_pool), dtype=np.uint8)),
    ]

    header = {
        "profile": profile,
        "n_nodes": n,
        "n_edges": len(targets),
        "coord_scale": COORD_SCALE,
        "geom_scale": GEOM_SCALE,
        "exposure_radius_m": float(G.graph.get("exposure_radius_m", 25.0)),
        "cos_lat": math.cos(math.radians(float(np.mean(lats)))),
        "sections": {},
    }

    # header size depends on the offsets and vice versa: iterate to fixpoint
    # so the JSON written to the file holds exactly the layout that follows it
    for _ in range(10):
        header_bytes = json.dumps(header).encode()
        pos = len(MAGIC) + 4 + len(header_bytes)
        pos += (-pos) % 4
        calc = {}
        for name, arr in sections:
            calc[name] = {"offset": pos, "count": int(arr.size), "dtype": str(arr.dtype)}
            pos += arr.nbytes
            pos += (-pos) % 4
        if calc == header["sections"]:
            break
        header["sections"] = calc
    else:
        raise RuntimeError("header layout did not converge")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(MAGIC)
        f.write(struct.pack("<I", len(header_bytes)))
        f.write(header_bytes)
        f.write(b"\x00" * ((-f.tell()) % 4))
        for name, arr in sections:
            assert f.tell() == header["sections"][name]["offset"], name
            f.write(arr.tobytes())
            f.write(b"\x00" * ((-f.tell()) % 4))
        size = f.tell()

    print(
        f"Wrote {out_path}: {size / 1e6:.1f} MB — {n} nodes, {len(targets)} edges "
        f"({pruned} dominated parallels dropped, {with_geom} with geometry, "
        f"pool {len(geom_pool) / 1e6:.1f} MB)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
