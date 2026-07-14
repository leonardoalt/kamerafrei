#!/usr/bin/env python3
"""Generate raster brand assets from SVG sources.

Renders frontend/favicon.svg -> apple-touch-icon.png (180x180) and draws the
social-share card -> og.png (1200x630). Rerun after changing the design and
commit the PNGs (the Docker image doesn't run this).

    .venv/bin/python scripts/make_assets.py
"""

from pathlib import Path

import cairosvg

FRONTEND = Path(__file__).resolve().parents[1] / "frontend"

# --- social card ------------------------------------------------------------

W, H = 1200, 630
GRID = "#1a2b20"
ROUTE = "#22c55e"
SHORT = "#5b6672"
CAM = "#ef4444"
CAM_ZONE = "rgba(239,68,68,0.14)"

# faint street grid over the whole card
grid_lines = []
for x in range(80, W, 108):
    grid_lines.append(
        f'<line x1="{x}" y1="0" x2="{x}" y2="{H}" stroke="{GRID}" stroke-width="2"/>'
    )
for y in range(55, H, 96):
    grid_lines.append(
        f'<line x1="0" y1="{y}" x2="{W}" y2="{y}" stroke="{GRID}" stroke-width="2"/>'
    )
grid_lines.append(
    f'<line x1="380" y1="{H}" x2="1100" y2="0" stroke="{GRID}" stroke-width="3"/>'
)

# cameras with their 25 m zones, along the "shortest" corridor
cameras = [(665, 355), (800, 300), (915, 215), (1060, 260), (975, 430), (760, 480)]
cam_svg = "".join(
    f'<circle cx="{x}" cy="{y}" r="54" fill="{CAM_ZONE}"/>'
    f'<circle cx="{x}" cy="{y}" r="8" fill="{CAM}"/>'
    for x, y in cameras
)

OG_SVG = f"""\
<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#0c130f"/>
      <stop offset="0.45" stop-color="#0c130f" stop-opacity="0.92"/>
      <stop offset="0.75" stop-color="#0c130f" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="{W}" height="{H}" fill="#0c130f"/>
  {''.join(grid_lines)}
  <rect width="{W}" height="{H}" fill="url(#fade)"/>

  {cam_svg}

  <!-- shortest path: straight through the camera zones -->
  <polyline points="560,540 700,430 850,320 1000,215 1150,105"
            fill="none" stroke="{SHORT}" stroke-width="6"
            stroke-dasharray="16 18" opacity="0.85"/>

  <!-- kamerafrei route: bends around every zone -->
  <path d="M 560 540
           C 640 545 680 500 700 455
           C 725 400 700 380 730 345
           C 768 302 850 385 905 345
           C 950 312 950 275 985 240
           C 1020 205 1080 165 1150 105"
        fill="none" stroke="{ROUTE}" stroke-width="11"
        stroke-linecap="round" stroke-linejoin="round"/>

  <circle cx="560" cy="540" r="13" fill="#16a34a" stroke="#f8fafc" stroke-width="4"/>
  <circle cx="1150" cy="105" r="13" fill="#dc2626" stroke="#f8fafc" stroke-width="4"/>

  <!-- crossed-camera mark -->
  <g transform="translate(64,64) scale(1.6)">
    <rect width="64" height="64" rx="14" fill="#14532d"/>
    <g transform="rotate(8 30 27)" fill="#f8fafc">
      <rect x="11" y="19" width="27" height="14" rx="3"/>
      <rect x="38" y="22.5" width="7" height="7" rx="1.5"/>
      <rect x="22" y="33" width="5" height="9" rx="1.5"/>
      <rect x="15" y="42" width="19" height="5" rx="2.5"/>
    </g>
    <line x1="13" y1="51" x2="51" y2="13" stroke="#ef4444" stroke-width="7"
          stroke-linecap="round"/>
  </g>

  <text x="62" y="365" font-family="Liberation Sans" font-weight="bold"
        font-size="104" fill="#f8fafc">kamerafrei</text>
  <text x="66" y="425" font-family="Liberation Sans"
        font-size="35" fill="#94a3b8">camera-free walking &amp; biking routes</text>
  <text x="66" y="472" font-family="Liberation Sans"
        font-size="35" fill="#94a3b8">for Berlin</text>
  <text x="66" y="556" font-family="Liberation Sans" font-weight="bold"
        font-size="30" fill="#4ade80">kamerafrei.com</text>
</svg>
"""


# maskable: platforms crop up to a circle; keep the glyph in the safe zone
MASKABLE_SVG = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#14532d"/>
  <g transform="translate(18,18) scale(1.0)">
    <g transform="rotate(8 30 27)" fill="#f8fafc">
      <rect x="11" y="19" width="27" height="14" rx="3"/>
      <rect x="38" y="22.5" width="7" height="7" rx="1.5"/>
      <rect x="22" y="33" width="5" height="9" rx="1.5"/>
      <rect x="15" y="42" width="19" height="5" rx="2.5"/>
    </g>
    <line x1="13" y1="51" x2="51" y2="13" stroke="#ef4444" stroke-width="7"
          stroke-linecap="round"/>
  </g>
</svg>
"""


def main():
    favicon = str(FRONTEND / "favicon.svg")
    outputs = [
        ("apple-touch-icon.png", dict(url=favicon, output_width=180, output_height=180)),
        ("icon-192.png", dict(url=favicon, output_width=192, output_height=192)),
        ("icon-512.png", dict(url=favicon, output_width=512, output_height=512)),
        (
            "icon-maskable-512.png",
            dict(bytestring=MASKABLE_SVG.encode(), output_width=512, output_height=512),
        ),
        ("og.png", dict(bytestring=OG_SVG.encode(), output_width=W, output_height=H)),
    ]
    for name, kwargs in outputs:
        cairosvg.svg2png(write_to=str(FRONTEND / name), **kwargs)
        print(f"wrote frontend/{name} ({(FRONTEND / name).stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
