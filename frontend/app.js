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
  const m = location.hash.match(/^#map=(\d+)\/(-?[\d.]+)\/(-?[\d.]+)$/);
  return m ? { zoom: +m[1], center: [+m[2], +m[3]] } : null;
}

const initialView = viewFromHash() || { zoom: 14, center: [52.503, 13.424] };
const map = L.map("map", { zoomControl: false }).setView(initialView.center, initialView.zoom);
L.control.zoom({ position: "bottomright" }).addTo(map);

map.on("moveend", () => {
  const c = map.getCenter();
  history.replaceState(null, "", `#map=${map.getZoom()}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}`);
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

function coneLatLngs(latlng, bearing, radiusM = 35, halfAngle = 30) {
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
  document.getElementById("search-a").value = "";
  document.getElementById("search-b").value = "";
  setStatus(STR.setStart);
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

  fetch(`/api/route?${params}`)
    .then(async (r) => {
      if (!r.ok) throw new Error((await r.json()).detail || `error ${r.status}`);
      return r.json();
    })
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

function render(data) {
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
