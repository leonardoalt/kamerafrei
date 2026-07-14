/* kamerafrei client-side router: A* over the binary CSR graph produced by
 * pipeline/export_web.py (format: docs/CLIENT_ROUTING.md).
 *
 * ES module, dependency-free; runs in a Web Worker and in node (parity CLI).
 * All costs are integer centimeters: cost = length_cm + alpha * exposure_cm.
 */

const MAGIC = "KFREI1";

export function parseGraph(buffer) {
  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(...bytes.slice(0, 6));
  if (magic !== MAGIC) throw new Error(`bad graph file (magic ${magic})`);
  const headerLen = new DataView(buffer).getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.slice(12, 12 + headerLen)));

  const view = (name, Ctor) => {
    const s = header.sections[name];
    return new Ctor(buffer, s.offset, s.count);
  };

  const g = {
    meta: header,
    n: header.n_nodes,
    lat: view("lat", Int32Array),
    lon: view("lon", Int32Array),
    off: view("csr_offsets", Uint32Array),
    tgt: view("edge_target", Uint32Array),
    len: view("edge_length_cm", Uint32Array),
    exp: view("edge_exposure_dm", Uint16Array),
    geomIdx: view("geom_index", Uint32Array),
    geomPool: view("geom_pool", Uint8Array),
    expIdx: header.sections.exp_ival_idx ? view("exp_ival_idx", Uint32Array) : null,
    expPool: header.sections.exp_ival_pool ? view("exp_ival_pool", Uint16Array) : null,
  };

  // meters per int32 coordinate unit (degrees * 1e7), for heuristics/snapping
  g.mLat = 111320 / header.coord_scale;
  g.mLon = (111320 * header.cos_lat) / header.coord_scale;

  // scratch buffers reused across queries; stamps avoid O(n) resets
  g.dist = new Float64Array(g.n);
  g.stamp = new Int32Array(g.n);
  g.parent = new Int32Array(g.n);
  g.parentEdge = new Int32Array(g.n);
  g.generation = 0;

  buildGrid(g);
  return g;
}

/* ---------------- snapping: uniform grid over nodes ---------------------- */

const GRID_CELL_M = 250;

function buildGrid(g) {
  const cellLat = Math.round(GRID_CELL_M / g.mLat);
  const cellLon = Math.round(GRID_CELL_M / g.mLon);
  const cells = new Map();
  for (let i = 0; i < g.n; i++) {
    const key = `${Math.floor(g.lat[i] / cellLat)},${Math.floor(g.lon[i] / cellLon)}`;
    let arr = cells.get(key);
    if (!arr) cells.set(key, (arr = []));
    arr.push(i);
  }
  g.grid = { cells, cellLat, cellLon };
}

export function nearestNode(g, latDeg, lonDeg, maxDistM = 500) {
  const lat = Math.round(latDeg * g.meta.coord_scale);
  const lon = Math.round(lonDeg * g.meta.coord_scale);
  const { cells, cellLat, cellLon } = g.grid;
  const cy = Math.floor(lat / cellLat);
  const cx = Math.floor(lon / cellLon);
  let best = -1;
  let bestD2 = Infinity;
  const rings = Math.ceil(maxDistM / GRID_CELL_M) + 1;
  for (let dy = -rings; dy <= rings; dy++) {
    for (let dx = -rings; dx <= rings; dx++) {
      const arr = cells.get(`${cy + dy},${cx + dx}`);
      if (!arr) continue;
      for (const i of arr) {
        const dLat = (g.lat[i] - lat) * g.mLat;
        const dLon = (g.lon[i] - lon) * g.mLon;
        const d2 = dLat * dLat + dLon * dLon;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = i;
        }
      }
    }
  }
  if (best < 0 || Math.sqrt(bestD2) > maxDistM) return -1;
  return best;
}

/* ---------------- binary min-heap keyed by f ------------------------------ */

class Heap {
  constructor() {
    this.node = new Int32Array(1024);
    this.f = new Float64Array(1024);
    this.size = 0;
  }
  push(n, f) {
    if (this.size === this.node.length) {
      const nn = new Int32Array(this.size * 2);
      nn.set(this.node);
      this.node = nn;
      const nf = new Float64Array(this.size * 2);
      nf.set(this.f);
      this.f = nf;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.f[p] <= f) break;
      this.node[i] = this.node[p];
      this.f[i] = this.f[p];
      i = p;
    }
    this.node[i] = n;
    this.f[i] = f;
  }
  pop() {
    const top = this.node[0];
    const size = --this.size;
    const n = this.node[size];
    const f = this.f[size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= size) break;
      if (c + 1 < size && this.f[c + 1] < this.f[c]) c++;
      if (this.f[c] >= f) break;
      this.node[i] = this.node[c];
      this.f[i] = this.f[c];
      i = c;
    }
    this.node[i] = n;
    this.f[i] = f;
    return top;
  }
}

/* ---------------- A* ------------------------------------------------------ */

const H_SAFETY = 0.999; // keep the heuristic admissible despite projection error

export function route(g, src, dst, alpha) {
  const gen = ++g.generation;
  const { dist, stamp, parent, parentEdge, off, tgt, len, exp } = g;
  const expScale = alpha * 10; // exposure is dm; cost in cm

  const hLat = g.mLat * 100 * H_SAFETY;
  const hLon = g.mLon * 100 * H_SAFETY;
  const dstLat = g.lat[dst];
  const dstLon = g.lon[dst];
  const h = (n) => {
    const a = (g.lat[n] - dstLat) * hLat;
    const b = (g.lon[n] - dstLon) * hLon;
    return Math.sqrt(a * a + b * b);
  };

  const heap = new Heap();
  dist[src] = 0;
  stamp[src] = gen;
  parent[src] = -1;
  heap.push(src, h(src));

  while (heap.size > 0) {
    const u = heap.pop();
    if (u === dst) break;
    const du = dist[u];
    const end = off[u + 1];
    for (let e = off[u]; e < end; e++) {
      const v = tgt[e];
      const nd = du + len[e] + expScale * exp[e];
      if (stamp[v] !== gen || nd < dist[v]) {
        dist[v] = nd;
        stamp[v] = gen;
        parent[v] = u;
        parentEdge[v] = e;
        heap.push(v, nd + h(v));
      }
    }
  }

  if (stamp[dst] !== gen) return null;

  const nodes = [];
  const edges = [];
  for (let v = dst; v !== -1; v = parent[v]) {
    nodes.push(v);
    if (parent[v] !== -1) edges.push(parentEdge[v]);
    if (nodes.length > g.n) throw new Error("cycle in parent chain");
  }
  nodes.reverse();
  edges.reverse();

  let lengthCm = 0;
  let exposureDm = 0;
  for (const e of edges) {
    lengthCm += len[e];
    exposureDm += exp[e];
  }

  return {
    nodes,
    edges,
    cost_cm: dist[dst],
    distance_m: lengthCm / 100,
    exposure_m: exposureDm / 10,
  };
}

/* ---------------- geometry ------------------------------------------------ */

function readVarint(pool, pos) {
  let shift = 0;
  let value = 0;
  for (;;) {
    const b = pool[pos.i++];
    value |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return (value >>> 1) ^ -(value & 1); // un-zigzag
}

export function edgeCoords(g, u, e) {
  const scale = g.meta.geom_scale;
  const cs = g.meta.coord_scale;
  const v = g.tgt[e];
  const coords = [[g.lat[u] / cs, g.lon[u] / cs]];
  const gi = g.geomIdx[e];
  if (gi !== 0) {
    const pos = { i: gi - 1 };
    const count = readVarint(g.geomPool, pos) >>> 0;
    if (count > 100000) throw new Error(`corrupt geometry (count ${count})`);
    let lat = Math.round(g.lat[u] / (cs / scale));
    let lon = Math.round(g.lon[u] / (cs / scale));
    for (let p = 0; p < count; p++) {
      lat += readVarint(g.geomPool, pos);
      lon += readVarint(g.geomPool, pos);
      coords.push([lat / scale, lon / scale]);
    }
  }
  coords.push([g.lat[v] / cs, g.lon[v] / cs]);
  return coords;
}

/* exact red segments: interpolate the [t0,t1] exposure intervals (fractions
 * of edge length) along each exposed edge's polyline */
export function exposedPieces(g, result) {
  const pieces = [];
  for (let k = 0; k < result.edges.length; k++) {
    const e = result.edges[k];
    if (g.exp[e] === 0) continue;
    const coords = edgeCoords(g, result.nodes[k], e);
    if (!g.expIdx || g.expIdx[e] === 0) {
      pieces.push(coords); // no interval data: whole edge (coarse fallback)
      continue;
    }
    // cumulative planar lengths along the edge polyline
    const cum = [0];
    for (let i = 1; i < coords.length; i++) {
      const dLat = (coords[i][0] - coords[i - 1][0]) * 111320;
      const dLon = (coords[i][1] - coords[i - 1][1]) * 111320 * g.meta.cos_lat;
      cum.push(cum[i - 1] + Math.hypot(dLat, dLon));
    }
    const total = cum[cum.length - 1] || 1;
    const at = (t) => {
      const target = t * total;
      let i = 1;
      while (i < cum.length - 1 && cum[i] < target) i++;
      const seg = cum[i] - cum[i - 1] || 1;
      const f = (target - cum[i - 1]) / seg;
      return [
        coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * f,
        coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * f,
      ];
    };
    let p = g.expIdx[e] - 1;
    const count = g.expPool[p++];
    for (let c = 0; c < count; c++) {
      const t0 = g.expPool[p++] / 65535;
      const t1 = g.expPool[p++] / 65535;
      const piece = [at(t0)];
      for (let i = 0; i < coords.length; i++) {
        const t = cum[i] / total;
        if (t > t0 && t < t1) piece.push(coords[i]);
      }
      piece.push(at(t1));
      pieces.push(piece);
    }
  }
  return pieces;
}

export function routeCoords(g, result) {
  const coords = [];
  for (let k = 0; k < result.edges.length; k++) {
    const ec = edgeCoords(g, result.nodes[k], result.edges[k]);
    coords.push(...(coords.length ? ec.slice(1) : ec));
  }
  if (!coords.length) {
    const cs = g.meta.coord_scale;
    const n = result.nodes[0];
    coords.push([g.lat[n] / cs, g.lon[n] / cs], [g.lat[n] / cs, g.lon[n] / cs]);
  }
  return coords;
}
