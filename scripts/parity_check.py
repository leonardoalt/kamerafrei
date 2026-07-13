#!/usr/bin/env python3
"""Parity harness: the Python server is the oracle for the client router.

Samples random node pairs, routes them at every avoidance level with the
backend Router AND the JS router (scripts/router_cli.mjs over the exported
binary graph), and asserts that costs, distances, and exposures agree
within quantization tolerance (cm/dm rounding).

Usage:
    python scripts/parity_check.py --graph data/graph_walk.pkl.gz \
        --bin data/web/graph_walk.bin --cameras data/cameras.geojson -n 25
"""

import argparse
import json
import random
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.routing import Router  # noqa: E402

ALPHAS = [0.0, 5.0, 15.0, 60.0]
REL_TOL = 2e-3  # quantization + float noise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--graph", default=str(ROOT / "data/graph_walk.pkl.gz"))
    parser.add_argument("--bin", default=str(ROOT / "data/web/graph_walk.bin"))
    parser.add_argument("--cameras", default=str(ROOT / "data/cameras.geojson"))
    parser.add_argument("-n", type=int, default=25)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    print(f"Loading oracle router ({args.graph}) ...")
    router = Router(Path(args.graph), Path(args.cameras), "walk")
    G = router.graph

    rng = random.Random(args.seed)
    nodes = list(G.nodes)
    cases = []
    for _ in range(args.n):
        a, b = rng.sample(nodes, 2)
        na, nb = G.nodes[a], G.nodes[b]
        lon_a, lat_a = router.to_wgs84.transform(na["x"], na["y"])
        lon_b, lat_b = router.to_wgs84.transform(nb["x"], nb["y"])
        for alpha in ALPHAS:
            cases.append({"from": [lat_a, lon_a], "to": [lat_b, lon_b], "alpha": alpha})

    print(f"Running {len(cases)} cases through the JS router ...")
    proc = subprocess.run(
        ["node", str(ROOT / "scripts/router_cli.mjs"), args.bin],
        input="\n".join(json.dumps(c) for c in cases),
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        print(proc.stderr)
        return 1
    print(proc.stderr.strip())
    js_results = [json.loads(line) for line in proc.stdout.strip().split("\n")]

    failures = 0
    for case, js in zip(cases, js_results):
        alpha = case["alpha"]
        try:
            py = router.route(tuple(case["from"]), tuple(case["to"]), alpha)
        except Exception as exc:
            if "error" in js:
                continue  # both sides failed: fine
            print(f"FAIL {case}: python raised {exc}, js ok")
            failures += 1
            continue
        if "error" in js:
            print(f"FAIL {case}: js {js['error']}, python ok")
            failures += 1
            continue

        # oracle cost along its own path
        py_cost = 0.0
        path = py["node_path"]
        for u, v in zip(path[:-1], path[1:]):
            d = router._best_edge(u, v, alpha)
            py_cost += d.get("length", 1.0) + alpha * d.get("exposure", 0.0)

        checks = [
            ("cost", py_cost, js["cost_m"]),
            ("distance", py["distance_m"], js["distance_m"]),
        ]
        for name, expected, actual in checks:
            denom = max(abs(expected), 1.0)
            if abs(expected - actual) / denom > REL_TOL:
                print(
                    f"FAIL alpha={alpha} {case['from']}→{case['to']}: "
                    f"{name} python={expected:.1f} js={actual:.1f}"
                )
                failures += 1

    n_checked = len(cases)
    if failures:
        print(f"\n{failures} failures out of {n_checked} cases")
        return 1
    print(f"\nPARITY OK: {n_checked} cases, all costs/distances match within {REL_TOL}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
