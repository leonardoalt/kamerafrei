/* kamerafrei — camera-avoiding route planner (frontend) */

const map = L.map("map", { zoomControl: false }).setView([52.503, 13.424], 14);
L.control.zoom({ position: "bottomright" }).addTo(map);

// params live in a collapsible panel; phones start collapsed so the map wins
const panel = document.getElementById("panel");
const panelToggle = document.getElementById("panel-toggle");
if (window.matchMedia("(max-width: 640px)").matches) {
  panel.classList.add("collapsed");
  panelToggle.setAttribute("aria-expanded", "false");
}
panelToggle.addEventListener("click", () => {
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
  { alpha: 0, label: "off", color: "#6b7280" },
  { alpha: 5, label: "a little", color: "#65a30d" },
  { alpha: 15, label: "a lot", color: "#16a34a" },
  { alpha: 60, label: "max", color: "#166534" },
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
  return `<b>camera</b> <a href="https://www.openstreetmap.org/${type}/${id}" target="_blank">${props.osm_id}</a>
          <table class="cam-tags">${rows}</table>`;
}

fetch("/api/cameras")
  .then((r) => {
    if (!r.ok) throw new Error("no camera data on server");
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
    setStatus(`${geojson.features.length} known cameras loaded. Click to set start.`);
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

map.on("click", (e) => {
  if (!markerA) {
    markerA = L.marker(e.latlng, { draggable: true, icon: pinIcon("A", "marker-a") }).addTo(map);
    markerA.on("dragend", requestRoute);
    setStatus("Now click the destination.");
  } else if (!markerB) {
    markerB = L.marker(e.latlng, { draggable: true, icon: pinIcon("B", "marker-b") }).addTo(map);
    markerB.on("dragend", requestRoute);
    requestRoute();
  } else {
    markerB.setLatLng(e.latlng);
    requestRoute();
  }
});

document.getElementById("clear").addEventListener("click", () => {
  if (markerA) map.removeLayer(markerA);
  if (markerB) map.removeLayer(markerB);
  markerA = markerB = null;
  routeLayer.clearLayers();
  statsEl.hidden = true;
  setStatus("Click the map to set start.");
});

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
  setStatus("Routing …");

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
    setStatus(
      baseline.n_cameras
        ? `Shortest path — passes ${baseline.n_cameras} known cameras (red parts).`
        : "Shortest path — passes no known cameras."
    );
  } else if (avoiding.same_as_baseline) {
    setStatus("Shortest path is already camera-minimal at this setting.");
  } else {
    const extra = avoiding.distance_m - baseline.distance_m;
    const saved = baseline.n_cameras - avoiding.n_cameras;
    setStatus(
      `+${fmtDist(extra)} detour avoids ${saved} of ${baseline.n_cameras} cameras ` +
      `(zone radius ${data.exposure_radius_m} m).`
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
