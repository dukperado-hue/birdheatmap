"""
Builds every data file the offline Leaflet viewer (web/) needs, for all 43
Thai airports (not just VTBS/VTBD like prepare_incident_data.py's older
GEE-asset export). Reads the same raw CAAT bird-strike workbook, estimates a
lat/lon per incident the same way (distance-vs-altitude curve digitized from
the ICAO WHMC slide, runway-oriented), but keys everything off web/data/airports.json
so it works for any airport that has a runway bearing on file.

Outputs (all under web/data/):
  - heatmap_density.json   [[lat, lon, count, damageWeight], ...]  (all-time, all 43 airports)
  - heatmap_by_month.json  {"YYYY-MM": [[lat, lon, count, damageWeight], ...], ...}  (2021-01..2025-12)
  - airport_stats.json     {icao: {total, topPhase, topPhaseCount, peakMonth, peakMonthCount,
                                    damageCount, damageRate}}

Damage weight: 1 per incident normally, 8 if DamageStatus == "With damage" —
lets the map be re-rendered with a "weighted by damage" toggle without a
second full dataset (the raw count is always recoverable, it's column 3).

Grid cell size matches the original heatmap_density.json this replaces: 0.003
degrees (~300m), counts/weights only — no per-event species/damage/date, same
privacy stance as the original (see CLAUDE_CODE_BRIEF.md / project memory).
"""
import json
import math
import random
from collections import Counter, defaultdict

import openpyxl

SRC = r"C:\Users\Anusorn.s\OneDrive - CAAT\Documents\2026\WHMC\raw data 01jul26\fixed data\สถิติ_อากาศยานชนนก_AGA-SMO_fixed_v2.xlsx"
AIRPORTS_JSON = r"C:\Users\Anusorn.s\OneDrive - CAAT\Documents\2026\Project\ThaiBirdStrikeGIS\web\data\airports.json"
OUT_DENSITY = r"C:\Users\Anusorn.s\OneDrive - CAAT\Documents\2026\Project\ThaiBirdStrikeGIS\web\data\heatmap_density.json"
OUT_BY_MONTH = r"C:\Users\Anusorn.s\OneDrive - CAAT\Documents\2026\Project\ThaiBirdStrikeGIS\web\data\heatmap_by_month.json"
OUT_STATS = r"C:\Users\Anusorn.s\OneDrive - CAAT\Documents\2026\Project\ThaiBirdStrikeGIS\web\data\airport_stats.json"

random.seed(42)

GRID_CELL = 0.003  # degrees, ~300m — same resolution as the original density grid
DAMAGE_WEIGHT = 8  # visual weight multiplier for "With damage" incidents

# (distance_km, altitude_ft) control points digitized from the WHMC slide p.12 curve
DIST_ALT_CURVE = [(0, 0), (1, 150), (2, 300), (3.6, 550), (6, 1300), (10, 2500), (13, 3300), (16, 3800)]

GROUND_PHASES = {"Taxi", "Standing", "Manoeuvring"}
DEPARTURE_PHASES = {"Take-off"}
ARRIVAL_PHASES = {"Landing", "Approach"}

MONTH_TH = ["", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
            "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]


def alt_to_dist_km(alt_ft):
    pts = DIST_ALT_CURVE
    if alt_ft <= pts[0][1]:
        return pts[0][0]
    for (d0, a0), (d1, a1) in zip(pts, pts[1:]):
        if a0 <= alt_ft <= a1:
            frac = (alt_ft - a0) / (a1 - a0) if a1 != a0 else 0
            return d0 + frac * (d1 - d0)
    return pts[-1][0]


def dest_point(lat, lon, bearing_deg, dist_km):
    R = 6371.0
    brg = math.radians(bearing_deg)
    lat1 = math.radians(lat)
    lon1 = math.radians(lon)
    ang = dist_km / R
    lat2 = math.asin(math.sin(lat1) * math.cos(ang) + math.cos(lat1) * math.sin(ang) * math.cos(brg))
    lon2 = lon1 + math.atan2(
        math.sin(brg) * math.sin(ang) * math.cos(lat1),
        math.cos(ang) - math.sin(lat1) * math.sin(lat2),
    )
    return math.degrees(lat2), math.degrees(lon2)


def estimate_point(ap, phase, alt_ft):
    lat, lon, brg = ap["lat"], ap["lon"], ap["rwyBearingDeg"]

    if phase in GROUND_PHASES:
        d = random.uniform(0, 0.6)
        b = random.uniform(0, 360)
        return dest_point(lat, lon, b, d)

    if phase in DEPARTURE_PHASES or phase in ARRIVAL_PHASES:
        base_brg = brg if phase in DEPARTURE_PHASES else (brg + 180) % 360
        alt = alt_ft if alt_ft else random.uniform(100, 2500)
        d = alt_to_dist_km(alt)
        d = max(0.1, d + random.uniform(-0.4, 0.4))
        b = (base_brg + random.uniform(-12, 12)) % 360
        return dest_point(lat, lon, b, d)

    # Unknown / En route / Post-impact / missing phase -> scatter within LHZ circle
    d = random.uniform(0, 13)
    b = random.uniform(0, 360)
    return dest_point(lat, lon, b, d)


def grid_key(lat, lon):
    return (round(lat / GRID_CELL) * GRID_CELL, round(lon / GRID_CELL) * GRID_CELL)


def main():
    with open(AIRPORTS_JSON, encoding="utf-8") as f:
        airports = json.load(f)
    by_icao = {a["icao"]: a for a in airports}

    wb = openpyxl.load_workbook(SRC, data_only=True, read_only=True)
    ws = wb["Raw_Data"]

    overall = defaultdict(lambda: [0, 0])
    by_month = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    per_airport = defaultdict(lambda: {
        "total": 0, "phase": Counter(), "month": Counter(), "damage": 0,
    })

    matched, skipped = 0, 0
    for row in ws.iter_rows(min_row=5, values_only=True):
        if row[0] is None:
            continue
        year, month, category, damage, alt_ft, species, icao, phase, headline = row
        ap = by_icao.get(icao)
        if ap is None:
            skipped += 1
            continue
        matched += 1

        lat, lon = estimate_point(ap, phase or "Unknown", alt_ft)
        key = grid_key(lat, lon)
        w = DAMAGE_WEIGHT if damage == "With damage" else 1

        overall[key][0] += 1
        overall[key][1] += w

        mk = f"{int(year):04d}-{int(month):02d}"
        by_month[mk][key][0] += 1
        by_month[mk][key][1] += w

        pa = per_airport[icao]
        pa["total"] += 1
        pa["phase"][phase or "Unknown"] += 1
        pa["month"][int(month)] += 1
        if damage == "With damage":
            pa["damage"] += 1

    print(f"Matched {matched} rows to a known airport, skipped {skipped} (foreign/unlisted ICAO)")
    print(f"Airports with >=1 incident: {len(per_airport)} / {len(airports)}")

    density_rows = [[round(lat, 4), round(lon, 4), c, w] for (lat, lon), (c, w) in overall.items()]
    with open(OUT_DENSITY, "w", encoding="utf-8") as f:
        json.dump(density_rows, f, ensure_ascii=False, separators=(",", ":"))
    print("Wrote", OUT_DENSITY, f"({len(density_rows)} cells)")

    by_month_out = {}
    for mk, grid in by_month.items():
        by_month_out[mk] = [[round(lat, 4), round(lon, 4), c, w] for (lat, lon), (c, w) in grid.items()]
    with open(OUT_BY_MONTH, "w", encoding="utf-8") as f:
        json.dump(by_month_out, f, ensure_ascii=False, separators=(",", ":"))
    print("Wrote", OUT_BY_MONTH, f"({len(by_month_out)} months)")

    stats_out = {}
    for icao, pa in per_airport.items():
        top_phase, top_phase_n = pa["phase"].most_common(1)[0]
        peak_month, peak_month_n = pa["month"].most_common(1)[0]
        stats_out[icao] = {
            "total": pa["total"],
            "topPhase": top_phase,
            "topPhaseCount": top_phase_n,
            "peakMonth": MONTH_TH[peak_month],
            "peakMonthCount": peak_month_n,
            "damageCount": pa["damage"],
            "damageRate": round(pa["damage"] / pa["total"] * 100, 1) if pa["total"] else 0,
        }
    with open(OUT_STATS, "w", encoding="utf-8") as f:
        json.dump(stats_out, f, ensure_ascii=False, separators=(",", ":"))
    print("Wrote", OUT_STATS, f"({len(stats_out)} airports)")


if __name__ == "__main__":
    main()
