# UI design notes

Living document: what the UI contains, how it's organized, and the design
direction. Committed so redesigns argue against a written inventory.

## Product in one line

Plan walking/biking routes through Berlin that stay out of surveillance
cameras' view; follow them on your phone; everything private and offline-
capable.

## Current element inventory (2026-07, v19)

One floating card (top-right) + map controls. Everything below lives in
that single card unless noted:

1. Title "kamerafrei" (+ collapse chevron; whole header toggles)
2. Status line — HEAVILY overloaded: instructions ("tap the map…"),
   offline download progress, route summaries ("+120 m detour…"),
   errors. Sits at the top, far from what it describes.
3. Subtitle ("Routes that avoid known surveillance cameras…")
4. Instruction text (part of subtitle: "Tap the map to set start…")
5. Address inputs ×2 with autocomplete dropdowns (Photon)
6. Profile toggle (walk/bike) + clear button
7. "avoid cameras" slider (off / a little / a lot / max, colored label)
8. "camera heatmap" checkbox
9. Legend (route / shortest / in camera view / camera dot)
10. Privacy statement (paragraph)
11. OSM/sunders attribution (paragraph)
12. Incompleteness disclaimer (same paragraph as 11)
13. Transient notes: "link copied" (under share), offline progress/ready
    (in status line)
14. Route results: stats table (distance, time, cameras nearby, in camera
    view × shortest/low-camera), engine note ("⚡ computed on this
    device"), share + GPX buttons

On the map itself:
15. Camera dots (canvas, 3,860) + view cones + tag popups
16. Heat layer (toggle)
17. Route lines: green route, gray dashed shortest, red in-view segments
18. A/B markers (draggable)
19. Locate button ⌖ (follow-me states) + zoom control (bottom right)
20. Blue position dot + accuracy circle
21. OSM/Leaflet attribution (Leaflet default, bottom right)

Invisible-but-relevant:
22. Deep links: #map=z/lat/lon (view), #r=…&p=…&a=… (route)
23. PWA: installable, offline; SW caching
24. i18n: every string EN/DE via STR dict
25. Empty/error states: snap-too-far, no path, geolocation denied

## Categories (agreed structure)

A. **Identity / explainers** — title; why-text; privacy; OSM attribution;
   incompleteness; Photon credit. Rarely needed after first visit.
B. **Route query** — addresses, map taps, walk/bike, clear.
C. **Route results** — stats, avoidance slider (query-ish but acts as a
   live re-query on results), summary line, share/GPX, engine note,
   legend (only meaningful with a route).
D. **Map/other tools** — heatmap toggle, locate, zoom.
E. **Transient feedback** — copied, offline progress, errors, hints.

## Known UX debts

- Everything shares one card: 14 elements visible at once on desktop.
- The status line (2) mixes five kinds of message in the title area;
  route summaries appear far from route stats.
- On mobile the whole card collapses — including results, so after
  routing you must expand to see stats.
- The legend and explainer paragraphs consume permanent space for
  once-per-lifetime information.
- Heatmap checkbox looks like a form field but is a map-layer toggle.
- Avoidance slider is a query param but lives visually among results.

## Constraints for any redesign

- Vanilla JS + CSS, no build step, Leaflet; single-page.
- All strings through the STR i18n dict (EN/DE).
- Keep IDs/behavior of: search inputs, profile radios, alpha slider,
  heat toggle, share/gpx buttons, stats cells, status semantics —
  or update app.js everywhere consciously.
- Offline/PWA: no new CDN dependencies; assets versioned ?v=N.
- Phone-first walking use case: map area is the product; controls must
  never bury it. Desktop: plenty of room, don't waste it.
- Secure-context quirks documented in AGENTS.md still apply.

## Design direction (post-critique, see git history for the proposal)

To be filled by the implemented redesign.
