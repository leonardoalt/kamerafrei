#!/usr/bin/env node
/* Batch CLI for the client router — used by scripts/parity_check.py.
 *
 * Usage: node scripts/router_cli.mjs <graph.bin> < cases.jsonl > results.jsonl
 * Each input line: {"from": [lat, lon], "to": [lat, lon], "alpha": 15}
 * Each output line: {"cost_m", "distance_m", "exposure_m", "n_points"} or {"error"}
 */

import { readFileSync } from "node:fs";
import { parseGraph, nearestNode, route, routeCoords } from "../frontend/router.js";

const graphPath = process.argv[2];
if (!graphPath) {
  console.error("usage: router_cli.mjs <graph.bin> < cases.jsonl");
  process.exit(2);
}

const t0 = performance.now();
const buf = readFileSync(graphPath);
const g = parseGraph(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
console.error(
  `loaded ${g.n} nodes / ${g.meta.n_edges} edges in ${(performance.now() - t0).toFixed(0)}ms`
);

const lines = readFileSync(0, "utf8").trim().split("\n");
let total = 0;
for (const line of lines) {
  const c = JSON.parse(line);
  const t = performance.now();
  const src = nearestNode(g, c.from[0], c.from[1]);
  const dst = nearestNode(g, c.to[0], c.to[1]);
  if (src < 0 || dst < 0) {
    console.log(JSON.stringify({ error: "snap failed" }));
    continue;
  }
  const r = route(g, src, dst, c.alpha);
  total += performance.now() - t;
  if (!r) {
    console.log(JSON.stringify({ error: "no path" }));
    continue;
  }
  const coords = routeCoords(g, r);
  console.log(
    JSON.stringify({
      cost_m: r.cost_cm / 100,
      distance_m: r.distance_m,
      exposure_m: r.exposure_m,
      n_points: coords.length,
    })
  );
}
console.error(`routed ${lines.length} cases, avg ${(total / lines.length).toFixed(1)}ms`);
