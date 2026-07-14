/* kamerafrei — camera-avoiding route planner (frontend) */

/* ---------------- i18n: device language, en/de, en default -------------- */

const LANG = (navigator.language || "en").toLowerCase().startsWith("de") ? "de" : "en";
document.documentElement.lang = LANG;

const STR = {
  en: {
    subtitle:
      "Routes that avoid known surveillance cameras.<br />Tap the map to set start and destination.",
    walk: "🚶 walk",
    bike: "🚲 bike",
    clear: "✕ clear",
    avoid: "avoid cameras",
    levels: ["off", "a little", "a lot", "max"],
    thShort: "shortest",
    thAvoid: "low-camera",
    rowDist: "distance",
    rowTime: "time",
    rowCams: "cameras passed",
    rowExp: "exposed",
    legRoute: "route",
    legShort: "shortest (comparison)",
    legExposed: "in camera view",
    legCam: "camera",
    disclaimer:
      'Camera data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
      "contributors (<code>man_made=surveillance</code>), as visualized by " +
      '<a href="https://sunders.uber.space">Surveillance under Surveillance</a>. ' +
      "Coverage is <strong>incomplete</strong>: this avoids <em>known</em> cameras only. " +
      'Address search by <a href="https://photon.komoot.io">Photon</a>.',
    loading: "Loading cameras …",
    setStart: "Tap the map to set start.",
    camsLoaded: (n) => `${n} known cameras loaded. Tap the map to set start.`,
    setDest: "Now tap the destination.",
    routing: "Routing …",
    alreadyMinimal: "Shortest path is already camera-minimal at this setting.",
    detour: (extra, saved, total, radius) =>
      `+${extra} detour avoids ${saved} of ${total} cameras (zone radius ${radius} m).`,
    offCams: (n) => `Shortest path — passes ${n} known cameras (red parts).`,
    offNone: "Shortest path — passes no known cameras.",
    popupCamera: "camera",
    noCamData: "no camera data on the server",
    phStart: "Start address …",
    phDest: "Destination address …",
    searching: "Searching …",
    noResults: "No results in Berlin.",
    offlineProgress: (pct) => `Offline routing: downloading ${pct}%`,
    offlineReady: "Offline routing active — routes compute on this device.",
    engineLocal: (ms) => `⚡ computed on this device in ${ms} ms`,
    engineServer: (ms) => `computed on the server in ${ms} ms`,
    privacy:
      "<strong>Privacy:</strong> routes are computed on your device whenever " +
      "possible; the server fallback stores nothing and keeps no logs. " +
      "No accounts, no tracking.",
    locate: "Show my location",
    geoError: "Location unavailable — check the browser permission.",
    share: "📤 share",
    gpx: "⬇ GPX",
    linkCopied: "Route link copied to the clipboard.",
    gpxName: (profile) => `kamerafrei ${profile} route`,
  },
  de: {
    subtitle:
      "Routen, die bekannten Überwachungskameras ausweichen.<br />Tippe auf die Karte für Start und Ziel.",
    walk: "🚶 zu Fuß",
    bike: "🚲 Rad",
    clear: "✕ löschen",
    avoid: "Kameras meiden",
    levels: ["aus", "etwas", "stark", "max"],
    thShort: "kürzeste",
    thAvoid: "kameraarm",
    rowDist: "Distanz",
    rowTime: "Zeit",
    rowCams: "Kameras",
    rowExp: "exponiert",
    legRoute: "Route",
    legShort: "kürzeste (Vergleich)",
    legExposed: "im Kamerablick",
    legCam: "Kamera",
    disclaimer:
      'Kameradaten © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-' +
      "Mitwirkende (<code>man_made=surveillance</code>), visualisiert von " +
      '<a href="https://sunders.uber.space">Surveillance under Surveillance</a>. ' +
      "Die Abdeckung ist <strong>unvollständig</strong>: Es werden nur <em>bekannte</em> Kameras gemieden. " +
      'Adresssuche via <a href="https://photon.komoot.io">Photon</a>.',
    loading: "Lade Kameras …",
    setStart: "Tippe auf die Karte für den Start.",
    camsLoaded: (n) => `${n} bekannte Kameras geladen. Tippe auf die Karte für den Start.`,
    setDest: "Jetzt das Ziel antippen.",
    routing: "Berechne Route …",
    alreadyMinimal: "Der kürzeste Weg ist bei dieser Einstellung bereits kamera-minimal.",
    detour: (extra, saved, total, radius) =>
      `+${extra} Umweg vermeidet ${saved} von ${total} Kameras (Zonenradius ${radius} m).`,
    offCams: (n) => `Kürzester Weg — passiert ${n} bekannte Kameras (rote Abschnitte).`,
    offNone: "Kürzester Weg — passiert keine bekannten Kameras.",
    popupCamera: "Kamera",
    noCamData: "keine Kameradaten auf dem Server",
    phStart: "Startadresse …",
    phDest: "Zieladresse …",
    searching: "Suche …",
    noResults: "Keine Treffer in Berlin.",
    offlineProgress: (pct) => `Offline-Routing: lade ${pct} %`,
    offlineReady: "Offline-Routing aktiv — Routen werden auf diesem Gerät berechnet.",
    engineLocal: (ms) => `⚡ auf diesem Gerät berechnet (${ms} ms)`,
    engineServer: (ms) => `auf dem Server berechnet (${ms} ms)`,
    privacy:
      "<strong>Privatsphäre:</strong> Routen werden wenn möglich auf deinem " +
      "Gerät berechnet; der Server-Fallback speichert nichts und führt keine " +
      "Logs. Keine Konten, kein Tracking.",
    locate: "Meinen Standort zeigen",
    geoError: "Standort nicht verfügbar — Browser-Berechtigung prüfen.",
    share: "📤 teilen",
    gpx: "⬇ GPX",
    linkCopied: "Routen-Link in die Zwischenablage kopiert.",
    gpxName: (profile) => `kamerafrei ${profile === "walk" ? "Fußweg" : "Radweg"}`,
  },
}[LANG];

document.querySelectorAll("[data-i18n]").forEach((el) => {
  el.textContent = STR[el.dataset.i18n];
});
document.querySelectorAll("[data-i18n-html]").forEach((el) => {
  el.innerHTML = STR[el.dataset.i18nHtml];
});
document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
  el.placeholder = STR[el.dataset.i18nPh];
});

/* ---------------- map ---------------------------------------------------- */

// shareable view: #map=zoom/lat/lon, like openstreetmap.org
function viewFromHash() {
  const m = location.hash.match(/(?:^#|&)map=(\d+)\/(-?[\d.]+)\/(-?[\d.]+)/);
  return m ? { zoom: +m[1], center: [+m[2], +m[3]] } : null;
}

const initialView = viewFromHash() || { zoom: 14, center: [52.503, 13.424] };
const map = L.map("map", { zoomControl: false }).setView(initialView.center, initialView.zoom);
L.control.zoom({ position: "bottomright" }).addTo(map);

map.on("moveend", () => {
  const c = map.getCenter();
  history.replaceState(null, "", `#map=${map.getZoom()}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}`);
});

/* ---------------- live position ("follow me" while walking) -------------- */

let geoWatchId = null;
let followMe = false;
let posMarker = null;
let accCircle = null;
let locateBtn = null;

function updateLocateBtn() {
  locateBtn.classList.toggle("following", followMe);
  locateBtn.classList.toggle("watching", geoWatchId !== null && !followMe);
}

function onPosition(pos) {
  const latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);
  if (!posMarker) {
    accCircle = L.circle(latlng, {
      radius: pos.coords.accuracy,
      color: "#2563eb",
      weight: 1,
      opacity: 0.4,
      fillColor: "#2563eb",
      fillOpacity: 0.1,
      interactive: false,
    }).addTo(map);
    posMarker = L.circleMarker(latlng, {
      radius: 7,
      color: "#fff",
      weight: 3,
      fillColor: "#2563eb",
      fillOpacity: 1,
      interactive: false,
    }).addTo(map);
  } else {
    posMarker.setLatLng(latlng);
    accCircle.setLatLng(latlng).setRadius(pos.coords.accuracy);
  }
  if (followMe) map.setView(latlng, Math.max(map.getZoom(), 16));
}

function stopLocate() {
  if (geoWatchId !== null) navigator.geolocation.clearWatch(geoWatchId);
  geoWatchId = null;
  followMe = false;
  if (posMarker) map.removeLayer(posMarker);
  if (accCircle) map.removeLayer(accCircle);
  posMarker = accCircle = null;
  updateLocateBtn();
}

function toggleLocate() {
  if (!("geolocation" in navigator)) return setStatus(STR.geoError, true);
  if (geoWatchId === null) {
    followMe = true;
    geoWatchId = navigator.geolocation.watchPosition(onPosition, (err) => {
      console.warn("geolocation:", err.message);
      setStatus(STR.geoError, true);
      stopLocate();
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  } else if (!followMe) {
    followMe = true; // re-center and resume following
    if (posMarker) map.setView(posMarker.getLatLng(), Math.max(map.getZoom(), 16));
  } else {
    stopLocate();
    return;
  }
  updateLocateBtn();
}

const LocateControl = L.Control.extend({
  options: { position: "bottomright" },
  onAdd() {
    const div = L.DomUtil.create("div", "leaflet-bar");
    locateBtn = L.DomUtil.create("a", "locate-btn", div);
    locateBtn.href = "#";
    locateBtn.title = STR.locate;
    locateBtn.setAttribute("aria-label", STR.locate);
    locateBtn.textContent = "⌖";
    L.DomEvent.on(locateBtn, "click", (e) => {
      L.DomEvent.stop(e);
      toggleLocate();
    });
    return div;
  },
});
map.addControl(new LocateControl());

// panning by hand pauses following (dot stays); tap the button to re-center
map.on("dragstart", () => {
  if (followMe) {
    followMe = false;
    updateLocateBtn();
  }
});

// params live in a collapsible panel; phones start collapsed so the map wins
const panel = document.getElementById("panel");
const panelToggle = document.getElementById("panel-toggle");
if (window.matchMedia("(max-width: 640px)").matches) {
  panel.classList.add("collapsed");
  panelToggle.setAttribute("aria-expanded", "false");
}
// the whole header row (title included) toggles, not just the chevron
document.getElementById("panel-header").addEventListener("click", () => {
  const collapsed = panel.classList.toggle("collapsed");
  panelToggle.setAttribute("aria-expanded", String(!collapsed));
});

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const canvas = L.canvas({ padding: 0.3 });
const cameraLayer = L.layerGroup().addTo(map);
const routeLayer = L.featureGroup().addTo(map);

const statusEl = document.getElementById("status");
const statsEl = document.getElementById("stats");
const alphaEl = document.getElementById("alpha");
const alphaValueEl = document.getElementById("alpha-value");

// slider stops: how far out of your way to go to stay out of camera view
const AVOIDANCE = [
  { alpha: 0, label: STR.levels[0], color: "#6b7280" },
  { alpha: 5, label: STR.levels[1], color: "#65a30d" },
  { alpha: 15, label: STR.levels[2], color: "#16a34a" },
  { alpha: 60, label: STR.levels[3], color: "#166534" },
];

function currentAvoidance() {
  return AVOIDANCE[Number(alphaEl.value)];
}

function updateAlphaLabel() {
  const level = currentAvoidance();
  alphaValueEl.textContent = level.label;
  alphaValueEl.style.color = level.color;
  alphaEl.style.accentColor = level.color;
}
updateAlphaLabel();

let markerA = null;
let markerB = null;
let requestSeq = 0;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

/* ---------------- cameras ---------------- */

function cameraPopup(props) {
  const skip = new Set(["osm_id"]);
  const rows = Object.entries(props)
    .filter(([k]) => !skip.has(k))
    .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
    .join("");
  const [type, id] = (props.osm_id || "/").split("/");
  return `<b>${STR.popupCamera}</b> <a href="https://www.openstreetmap.org/${type}/${id}" target="_blank">${props.osm_id}</a>
          <table class="cam-tags">${rows}</table>`;
}

// camera:direction is degrees clockwise from north, or a cardinal like "SW";
// multiple directions are separated by ";"
const CARDINALS = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

function parseDirections(value) {
  if (value == null) return [];
  return String(value)
    .split(/[;,]/)
    .map((s) => {
      s = s.trim().toUpperCase();
      if (s in CARDINALS) return CARDINALS[s];
      const n = parseFloat(s);
      return Number.isNaN(n) ? null : ((n % 360) + 360) % 360;
    })
    .filter((d) => d !== null);
}

// matches the routing model in pipeline/compute_exposure.py (cone 40 m ±35°)
function coneLatLngs(latlng, bearing, radiusM = 40, halfAngle = 35) {
  const points = [latlng];
  const latScale = 111320;
  const lngScale = 111320 * Math.cos((latlng.lat * Math.PI) / 180);
  for (let a = bearing - halfAngle; a <= bearing + halfAngle + 0.01; a += 7.5) {
    const rad = (a * Math.PI) / 180;
    points.push([
      latlng.lat + (Math.cos(rad) * radiusM) / latScale,
      latlng.lng + (Math.sin(rad) * radiusM) / lngScale,
    ]);
  }
  return points;
}

fetch("/api/cameras")
  .then((r) => {
    if (!r.ok) throw new Error(STR.noCamData);
    return r.json();
  })
  .then((geojson) => {
    L.geoJSON(geojson, {
      pointToLayer: (feat, latlng) =>
        L.circleMarker(latlng, {
          renderer: canvas,
          radius: 3.5,
          color: "#7f1d1d",
          weight: 1,
          fillColor: "#dc2626",
          fillOpacity: 0.6,
        }).bindPopup(cameraPopup(feat.properties)),
    }).addTo(cameraLayer);

    // view cones for cameras with a tagged direction (domes see 360°, skip)
    for (const feat of geojson.features) {
      const props = feat.properties;
      if (props["camera:type"] === "dome") continue;
      const [lng, lat] = feat.geometry.coordinates;
      for (const bearing of parseDirections(props["camera:direction"])) {
        L.polygon(coneLatLngs(L.latLng(lat, lng), bearing), {
          renderer: canvas,
          stroke: false,
          fillColor: "#dc2626",
          fillOpacity: 0.13,
          interactive: false,
        }).addTo(cameraLayer);
      }
    }

    setStatus(STR.camsLoaded(geojson.features.length));
  })
  .catch((err) => setStatus(err.message, true));

/* ---------------- markers ---------------- */

function pinIcon(label, cls) {
  return L.divIcon({
    className: "",
    html: `<div class="marker-pin ${cls}"><span>${label}</span></div>`,
    iconSize: [26, 26],
    iconAnchor: [4, 24],
  });
}

function setPoint(which, latlng) {
  if (which === "a") {
    if (markerA) markerA.setLatLng(latlng);
    else {
      markerA = L.marker(latlng, { draggable: true, icon: pinIcon("A", "marker-a") }).addTo(map);
      markerA.on("dragend", requestRoute);
    }
  } else if (markerB) {
    markerB.setLatLng(latlng);
  } else {
    markerB = L.marker(latlng, { draggable: true, icon: pinIcon("B", "marker-b") }).addTo(map);
    markerB.on("dragend", requestRoute);
  }
  if (markerA && markerB) requestRoute();
  else setStatus(markerA ? STR.setDest : STR.setStart);
}

map.on("click", (e) => setPoint(!markerA ? "a" : "b", e.latlng));

document.getElementById("clear").addEventListener("click", () => {
  if (markerA) map.removeLayer(markerA);
  if (markerB) map.removeLayer(markerB);
  markerA = markerB = null;
  routeLayer.clearLayers();
  statsEl.hidden = true;
  lastRendered = null;
  document.getElementById("route-actions").hidden = true;
  document.getElementById("engine-note").hidden = true;
  document.getElementById("search-a").value = "";
  document.getElementById("search-b").value = "";
  setStatus(STR.setStart);
});

/* ---------------- share & GPX export ------------------------------------- */

function routeUrl() {
  const a = markerA.getLatLng();
  const b = markerB.getLatLng();
  const profile = document.querySelector('input[name="profile"]:checked').value;
  const hash =
    `#r=${a.lat.toFixed(6)},${a.lng.toFixed(6)},${b.lat.toFixed(6)},${b.lng.toFixed(6)}` +
    `&p=${profile}&a=${alphaEl.value}`;
  return `${location.origin}/${hash}`;
}

document.getElementById("share-btn").addEventListener("click", async () => {
  if (!markerA || !markerB) return;
  const url = routeUrl();
  if (navigator.share) {
    try {
      await navigator.share({ title: "kamerafrei", url });
      return;
    } catch {
      /* user dismissed the sheet — fall through to clipboard */
    }
  }
  await navigator.clipboard.writeText(url);
  setStatus(STR.linkCopied);
});

document.getElementById("gpx-btn").addEventListener("click", () => {
  if (!lastRendered) return;
  const route = lastRendered.routes[lastRendered.routes.length - 1];
  const name = STR.gpxName(route.profile);
  const pts = route.geometry.coordinates
    .map(([lon, lat]) => `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"/>`)
    .join("\n");
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="kamerafrei.com" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${name} — ${(route.distance_m / 1000).toFixed(1)} km, ${route.n_cameras} cameras</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
  const blob = new Blob([gpx], { type: "application/gpx+xml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "kamerafrei-route.gpx";
  a.click();
  URL.revokeObjectURL(a.href);
});

/* ---------------- address autocomplete (Photon by komoot) ---------------- */
/* Photon is built for search-as-you-type; Nominatim's policy forbids it. */

const BERLIN_BBOX = "13.088,52.338,13.761,52.675"; // minLon,minLat,maxLon,maxLat

function photonLabel(p) {
  const main = p.name || [p.street, p.housenumber].filter(Boolean).join(" ");
  const street =
    p.name && p.street ? [p.street, p.housenumber].filter(Boolean).join(" ") : null;
  const place = [p.postcode, p.district || p.city].filter(Boolean).join(" ");
  return [main, street, place].filter(Boolean).join(", ");
}

function setupSearch(which) {
  const input = document.getElementById(`search-${which}`);
  const box = document.getElementById(`search-${which}-results`);
  let timer = null;
  let seq = 0;
  let first = null; // top hit, picked on Enter

  const hint = (text) => {
    box.innerHTML = `<li class="hint">${text}</li>`;
    box.hidden = false;
  };

  const pick = (hit) => {
    box.hidden = true;
    input.value = photonLabel(hit.properties);
    input.blur();
    const [lng, lat] = hit.geometry.coordinates;
    const latlng = L.latLng(lat, lng);
    map.setView(latlng, Math.max(map.getZoom(), 15));
    setPoint(which, latlng);
  };

  const search = async () => {
    const q = input.value.trim();
    if (q.length < 3) {
      box.hidden = true;
      first = null;
      return;
    }
    const mySeq = ++seq;
    try {
      const params = new URLSearchParams({
        q,
        limit: "5",
        lang: LANG,
        bbox: BERLIN_BBOX,
      });
      const r = await fetch(`https://photon.komoot.io/api/?${params}`);
      const hits = (await r.json()).features || [];
      if (mySeq !== seq) return; // superseded by newer keystrokes
      first = hits[0] || null;
      if (!hits.length) return hint(STR.noResults);
      box.innerHTML = "";
      for (const h of hits) {
        const li = document.createElement("li");
        li.textContent = photonLabel(h.properties);
        li.addEventListener("click", () => pick(h));
        box.appendChild(li);
      }
      box.hidden = false;
    } catch {
      if (mySeq === seq) hint(STR.noResults);
    }
  };

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(search, 300);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      clearTimeout(timer);
      if (first) pick(first);
      else search();
    } else if (e.key === "Escape") {
      box.hidden = true;
    }
  });

  input.addEventListener("blur", () => setTimeout(() => (box.hidden = true), 250));
}

setupSearch("a");
setupSearch("b");

/* ---------------- controls ---------------- */

alphaEl.addEventListener("input", () => {
  updateAlphaLabel();
  debounceRoute();
});

document.querySelectorAll('input[name="profile"]').forEach((el) =>
  el.addEventListener("change", requestRoute)
);

let debounceTimer = null;
function debounceRoute() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(requestRoute, 250);
}

/* ---------------- client-side routing (enable with ?client=1) ------------ */

// client-side routing is the default; ?client=0 forces the server (debugging),
// and data-saver connections skip the eager graph download
const CLIENT_MODE =
  typeof Worker !== "undefined" &&
  new URLSearchParams(location.search).get("client") !== "0" &&
  !(navigator.connection && navigator.connection.saveData);
const localReady = { walk: false, bike: false };
const pendingLocal = new Map(); // id -> {resolve, reject}
let worker = null;
let localMsgId = 0;

function statusIsIdle() {
  return !(markerA && markerB);
}

function initClientRouting(profile) {
  if (!CLIENT_MODE || localReady[profile]) return;
  if (!worker) {
    worker = new Worker("worker.js?v=13", { type: "module" });
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === "progress" && m.total && statusIsIdle()) {
        setStatus(STR.offlineProgress(Math.round((100 * m.loaded) / m.total)));
      } else if (m.type === "ready") {
        localReady[m.profile] = true;
        if (statusIsIdle()) setStatus(STR.offlineReady);
        else requestRoute(); // upgrade the visible route to the local engine
      } else if (m.type === "result") {
        pendingLocal.get(m.id)?.resolve(m.data);
        pendingLocal.delete(m.id);
      } else if (m.type === "routeError") {
        pendingLocal.get(m.id)?.reject(new Error(m.message));
        pendingLocal.delete(m.id);
      } else if (m.type === "error") {
        console.warn("routing worker:", m.message);
      }
    };
    worker.onerror = (e) => console.warn("routing worker failed:", e.message);
  }
  // versioned: a browser-cached error response must never pin the graph URL
  worker.postMessage({
    type: "init",
    profile,
    graphUrl: `/web-data/graph_${profile}.bin?v=13`,
    camerasUrl: "/api/cameras",
  });
}

function localRoute(profile, a, b, alpha) {
  return new Promise((resolve, reject) => {
    const id = ++localMsgId;
    pendingLocal.set(id, { resolve, reject });
    worker.postMessage({
      type: "route",
      id,
      profile,
      from: [a.lat, a.lng],
      to: [b.lat, b.lng],
      alpha,
    });
  });
}

initClientRouting("walk");

/* ---------------- routing ---------------- */

function fmtDist(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

function fmtTime(min) {
  return min >= 60 ? `${Math.floor(min / 60)} h ${Math.round(min % 60)} min` : `${Math.round(min)} min`;
}

function requestRoute() {
  if (!markerA || !markerB) return;
  const a = markerA.getLatLng();
  const b = markerB.getLatLng();
  const profile = document.querySelector('input[name="profile"]:checked').value;
  const params = new URLSearchParams({
    from_lat: a.lat.toFixed(6),
    from_lon: a.lng.toFixed(6),
    to_lat: b.lat.toFixed(6),
    to_lon: b.lng.toFixed(6),
    profile,
    alpha: currentAvoidance().alpha,
  });

  const seq = ++requestSeq;
  setStatus(STR.routing);

  const remote = () =>
    fetch(`/api/route?${params}`).then(async (r) => {
      if (!r.ok) throw new Error((await r.json()).detail || `error ${r.status}`);
      return r.json();
    });

  initClientRouting(profile); // lazy-load the other profile's graph
  const alpha = currentAvoidance().alpha;
  const source =
    CLIENT_MODE && localReady[profile]
      ? localRoute(profile, a, b, alpha).catch(remote) // any local failure -> server
      : remote();

  source
    .then((data) => {
      if (seq !== requestSeq) return; // a newer request superseded this one
      render(data);
    })
    .catch((err) => {
      if (seq !== requestSeq) return;
      setStatus(err.message, true);
      routeLayer.clearLayers();
      statsEl.hidden = true;
    });
}

let lastRendered = null; // for share/GPX

function render(data) {
  lastRendered = data;
  document.getElementById("route-actions").hidden = false;
  document.body.dataset.engine = data.engine || "server";
  const engineNote = document.getElementById("engine-note");
  if (data.took_ms != null) {
    engineNote.textContent =
      data.engine === "client"
        ? STR.engineLocal(data.took_ms)
        : STR.engineServer(data.took_ms);
    engineNote.hidden = false;
  }
  routeLayer.clearLayers();
  const [baseline, avoiding] = data.routes;
  const shown = avoiding || baseline;

  // gray comparison line only when there is something to compare against
  if (avoiding) {
    L.geoJSON(baseline.geometry, {
      style: { color: "#6b7280", weight: 4, opacity: 0.7, dashArray: "6 8" },
    }).addTo(routeLayer);
  }

  L.geoJSON(shown.geometry, {
    style: { color: "#16a34a", weight: 5, opacity: 0.9 },
  }).addTo(routeLayer);

  // parts of the displayed route inside camera view
  if (shown.exposed_geometry && shown.exposed_geometry.coordinates.length) {
    L.geoJSON(shown.exposed_geometry, {
      style: { color: "#dc2626", weight: 6, opacity: 0.9 },
    }).addTo(routeLayer);
  }

  fillStats(baseline, shown);
  statsEl.classList.toggle("single", !avoiding);
  statsEl.hidden = false;

  if (!avoiding) {
    setStatus(baseline.n_cameras ? STR.offCams(baseline.n_cameras) : STR.offNone);
  } else if (avoiding.same_as_baseline) {
    setStatus(STR.alreadyMinimal);
  } else {
    const extra = avoiding.distance_m - baseline.distance_m;
    const saved = baseline.n_cameras - avoiding.n_cameras;
    setStatus(
      STR.detour(fmtDist(extra), saved, baseline.n_cameras, data.exposure_radius_m)
    );
  }

  map.fitBounds(routeLayer.getBounds().pad(0.15));
}

function fillStats(s, a) {
  document.getElementById("s-dist").textContent = fmtDist(s.distance_m);
  document.getElementById("a-dist").textContent = fmtDist(a.distance_m);
  document.getElementById("s-time").textContent = fmtTime(s.duration_min);
  document.getElementById("a-time").textContent = fmtTime(a.duration_min);
  document.getElementById("s-cams").textContent = s.n_cameras;
  document.getElementById("a-cams").textContent = a.n_cameras;
  document.getElementById("s-exp").textContent = fmtDist(s.exposed_m);
  document.getElementById("a-exp").textContent = fmtDist(a.exposed_m);
}

/* ---------------- deep link ----------------------------------------------- */
/* #r=latA,lonA,latB,lonB sets both markers and routes immediately.
   Must run last: requestRoute reads consts declared above. */

const routeHash = location.hash.match(
  /(?:^#|&)r=(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)/
);
if (routeHash) {
  const profileHash = location.hash.match(/(?:^#|&)p=(walk|bike)/);
  if (profileHash) {
    document.querySelector(`input[name="profile"][value="${profileHash[1]}"]`).checked = true;
  }
  const alphaHash = location.hash.match(/(?:^#|&)a=([0-3])/);
  if (alphaHash) {
    alphaEl.value = alphaHash[1];
    updateAlphaLabel();
  }
  setPoint("a", L.latLng(+routeHash[1], +routeHash[2]));
  setPoint("b", L.latLng(+routeHash[3], +routeHash[4]));
}

/* ---------------- PWA ------------------------------------------------------ */

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/sw.js")
    .then(() => console.log("sw registered"))
    .catch((err) => console.warn("sw registration failed:", err));
}
