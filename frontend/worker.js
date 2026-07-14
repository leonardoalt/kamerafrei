/* Web Worker: loads binary graphs and answers route requests entirely
 * client-side. Response shape mirrors /api/route so the UI can't tell
 * whether the server or this worker answered. */

import { parseGraph, nearestNode, route, routeCoords } from "./router.js?v=14";

const SPEED_KMH = { walk: 4.8, bike: 15.0 };

const graphs = {}; // profile -> parsed graph
const loading = {}; // profile -> in-flight load promise (dedupes double init)
let cameras = null; // { lat: Float64Array, lon: Float64Array, grid, cell }

/* ---------------- camera exposure (display stats) ------------------------- */

const M_LAT = 111320;

function buildCameras(geojson, cosLat) {
  const feats = geojson.features;
  const lat = new Float64Array(feats.length);
  const lon = new Float64Array(feats.length);
  feats.forEach((f, i) => {
    lon[i] = f.geometry.coordinates[0];
    lat[i] = f.geometry.coordinates[1];
  });
  const cell = 0.002; // ~220 m in degrees latitude
  const grid = new Map();
  for (let i = 0; i < feats.length; i++) {
    const key = `${Math.floor(lat[i] / cell)},${Math.floor(lon[i] / cell)}`;
    let arr = grid.get(key);
    if (!arr) grid.set(key, (arr = []));
    arr.push(i);
  }
  return { lat, lon, grid, cell, cosLat, n: feats.length };
}

function nearbyCameras(latA, lonA, latB, lonB, radiusDegLat) {
  const { grid, cell } = cameras;
  const pad = radiusDegLat * 2;
  const y0 = Math.floor((Math.min(latA, latB) - pad) / cell);
  const y1 = Math.floor((Math.max(latA, latB) + pad) / cell);
  const x0 = Math.floor((Math.min(lonA, lonB) - pad) / cell);
  const x1 = Math.floor((Math.max(lonA, lonB) + pad) / cell);
  const out = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const arr = grid.get(`${y},${x}`);
      if (arr) out.push(...arr);
    }
  return out;
}

/* Exact segment ∩ camera-disc intervals, matching the backend's shapely
 * intersection semantics (union of discs) via per-segment interval merge. */
function analyzeExposure(coords, radiusM) {
  const mLon = M_LAT * cameras.cosLat;
  const radiusDegLat = radiusM / M_LAT;
  const hit = new Set();
  const pieces = [];
  let exposedM = 0;

  for (let s = 0; s + 1 < coords.length; s++) {
    const [latA, lonA] = coords[s];
    const [latB, lonB] = coords[s + 1];
    const ax = 0;
    const ay = 0;
    const bx = (lonB - lonA) * mLon;
    const by = (latB - latA) * M_LAT;
    const segLen = Math.hypot(bx, by);
    if (segLen === 0) continue;

    const intervals = [];
    for (const c of nearbyCameras(latA, lonA, latB, lonB, radiusDegLat)) {
      const cx = (cameras.lon[c] - lonA) * mLon;
      const cy = (cameras.lat[c] - latA) * M_LAT;
      // |A + t(B-A) - C|^2 = r^2, t in [0,1]
      const dx = bx - ax;
      const dy = by - ay;
      const fx = ax - cx;
      const fy = ay - cy;
      const a = dx * dx + dy * dy;
      const b = 2 * (fx * dx + fy * dy);
      const cc = fx * fx + fy * fy - radiusM * radiusM;
      const disc = b * b - 4 * a * cc;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      const t0 = Math.max(0, (-b - sq) / (2 * a));
      const t1 = Math.min(1, (-b + sq) / (2 * a));
      if (t0 < t1) {
        intervals.push([t0, t1]);
        hit.add(c);
      }
    }
    if (!intervals.length) continue;

    intervals.sort((p, q) => p[0] - q[0]);
    let [curA, curB] = intervals[0];
    const merged = [];
    for (let i = 1; i < intervals.length; i++) {
      const [t0, t1] = intervals[i];
      if (t0 <= curB) curB = Math.max(curB, t1);
      else {
        merged.push([curA, curB]);
        [curA, curB] = [t0, t1];
      }
    }
    merged.push([curA, curB]);

    for (const [t0, t1] of merged) {
      exposedM += (t1 - t0) * segLen;
      const p0 = [lonA + ((lonB - lonA) * t0), latA + ((latB - latA) * t0)];
      const p1 = [lonA + ((lonB - lonA) * t1), latA + ((latB - latA) * t1)];
      // extend the previous piece when contiguous across the segment joint
      const prev = pieces[pieces.length - 1];
      if (prev && t0 === 0) {
        const last = prev[prev.length - 1];
        if (last[0] === p0[0] && last[1] === p0[1]) {
          prev.push(p1);
          continue;
        }
      }
      pieces.push([p0, p1]);
    }
  }

  return { exposed_m: exposedM, n_cameras: hit.size, pieces };
}

/* ---------------- request handling ---------------------------------------- */

function describe(g, profile, result, alpha) {
  const coords = routeCoords(g, result);
  const { exposed_m, n_cameras, pieces } = analyzeExposure(
    coords,
    g.meta.exposure_radius_m
  );
  const speedMMin = (SPEED_KMH[profile] * 1000) / 60;
  return {
    alpha,
    profile,
    distance_m: Math.round(result.distance_m * 10) / 10,
    duration_min: Math.round((result.distance_m / speedMMin) * 10) / 10,
    exposed_m: Math.round(exposed_m * 10) / 10,
    n_cameras,
    geometry: {
      type: "LineString",
      coordinates: coords.map(([lat, lon]) => [lon, lat]),
    },
    exposed_geometry: { type: "MultiLineString", coordinates: pieces },
    _nodes: result.nodes,
  };
}

async function loadGraph(profile, url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`graph fetch failed: ${resp.status}`);
  // X-Raw-Size = decompressed size (body arrives gzip-encoded; the reader
  // below sees decompressed bytes, so Content-Length would overshoot 100%)
  const total =
    +resp.headers.get("X-Raw-Size") || +resp.headers.get("Content-Length") || 0;
  const reader = resp.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    postMessage({ type: "progress", profile, loaded, total });
  }
  const buf = new Uint8Array(loaded);
  let pos = 0;
  for (const c of chunks) {
    buf.set(c, pos);
    pos += c.length;
  }
  graphs[profile] = parseGraph(buf.buffer);
  postMessage({ type: "ready", profile });
}

onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === "init") {
      if (!cameras && msg.camerasUrl) {
        const geojson = await (await fetch(msg.camerasUrl)).json();
        cameras = buildCameras(geojson, Math.cos((52.52 * Math.PI) / 180));
      }
      if (graphs[msg.profile]) {
        postMessage({ type: "ready", profile: msg.profile });
      } else {
        if (!loading[msg.profile])
          loading[msg.profile] = loadGraph(msg.profile, msg.graphUrl).catch((err) => {
            delete loading[msg.profile]; // allow a retry on the next init
            throw err;
          });
        await loading[msg.profile];
      }
    } else if (msg.type === "route") {
      const g = graphs[msg.profile];
      if (!g) throw new Error(`graph ${msg.profile} not loaded`);
      const t0 = performance.now();
      const src = nearestNode(g, msg.from[0], msg.from[1]);
      const dst = nearestNode(g, msg.to[0], msg.to[1]);
      if (src < 0 || dst < 0) throw new Error("snap");
      const baseRes = route(g, src, dst, 0);
      if (!baseRes) throw new Error("no path");
      const routes = [describe(g, msg.profile, baseRes, 0)];
      if (msg.alpha > 0) {
        const avoidRes = route(g, src, dst, msg.alpha);
        const avoiding = describe(g, msg.profile, avoidRes, msg.alpha);
        avoiding.same_as_baseline =
          avoidRes.nodes.length === baseRes.nodes.length &&
          avoidRes.nodes.every((n, i) => n === baseRes.nodes[i]);
        routes.push(avoiding);
      }
      routes.forEach((r) => delete r._nodes);
      postMessage({
        type: "result",
        id: msg.id,
        data: {
          routes,
          exposure_radius_m: g.meta.exposure_radius_m,
          took_ms: Math.round((performance.now() - t0) * 10) / 10,
          engine: "client",
        },
      });
    }
  } catch (err) {
    postMessage({
      type: msg.type === "route" ? "routeError" : "error",
      id: msg.id,
      profile: msg.profile,
      message: String(err.message || err),
    });
  }
};
