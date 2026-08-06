# Thailand Airport Bird-Strike Hazard Map

Prototype for the commitment made to the Thai wildlife-hazard team at the ICAO
Asia/Pacific WHMC meeting: a public GIS map of bird-strike risk around Thai
airports, built on Google Earth Engine.

## What's here

- `gee/thai_airport_hazard_map.js` — the Earth Engine Code Editor script.
  Saved in the GEE account as `users/dukperado/earthscripts/ThaiAirportBirdStrikeHazardMap`.
  Draws, per airport: a 13 km LHZ circle, a bow-tie-shaped PHZ/SHZ/THZ hazard
  zone along the runway bearing (modeled on the WHMC slide deck p.12 India
  example), a bird-strike hotspot heatmap from real CAAT incident data, and
  optional land-cover / surface-water overlays (ecological attractors).
- `data_prep/prepare_incident_data.py` — reads the raw CAAT bird-strike
  workbook and estimates a point per incident (see the docstring — the source
  data has no GPS coordinate, only ICAO + flight phase + altitude, so
  positions are modeled, not measured). Outputs `gee/incident_data.csv`
  (full dataset, for upload as an EE table asset) and `gee/incident_data.js`
  (50-row sample embedded in the script for a quick test run).

## Current scope

VTBS (Suvarnabhumi) and VTBD (Don Mueang) only. `AIRPORTS` in the script is
structured so the remaining ~38 Thai aerodromes can be added the same way —
ARP coordinates + runway bearing from the CAAT eAIP (AD 2.2 / AD 2.12 pages).

## Not yet done

- Upload `gee/incident_data.csv` (3,804 rows) as an Earth Engine table asset
  and set `INCIDENT_ASSET_ID` in the script — right now it only uses the
  50-row sample baked into the script.
- Decide public-App publishing (Apps > Publish in the Code Editor) vs.
  exporting to a static GitHub Pages map.
- `gee/incident_data.csv` contains real CAAT incident records (species,
  damage, dates) and is gitignored — do not publish it to a public repo.
