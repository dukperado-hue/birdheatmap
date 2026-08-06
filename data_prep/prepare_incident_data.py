"""
Reads the raw CAAT bird-strike statistics workbook and produces an estimated
lat/lon point for each strike record at VTBS (Suvarnabhumi) and VTBD (Don Mueang),
formatted as a JS array literal ready to paste into the Earth Engine script.

IMPORTANT — these are NOT real GPS coordinates. The source workbook only records
ICAO airport code + FlightPhase + Altitude_ft per event, not a GPS fix. Each point
here is estimated by placing it along the extended runway centerline (departure
end for Take-off, arrival end for Landing/Approach, small random spread laterally
and along-track) using a distance-vs-altitude curve digitized from the ICAO WHMC
reference slide (NWHMC 1_69.pptx.pdf, p.12: ~95% of strikes occur below 2000 ft
within 13 km of the aerodrome). Ground-phase events (Taxi/Standing/Manoeuvring)
are placed near the ARP. Events with unknown/missing phase or altitude are placed
randomly within the 13 km circle. Treat this as a statistical approximation for
prototyping the visualization only, not a record of where each aircraft actually
was — real GPS/radar track data should replace this once available.
"""
import csv
import json
import math
import random

import openpyxl

SRC = r"C:\Users\Anusorn.s\OneDrive - CAAT\Documents\2026\WHMC\raw data 01jul26\fixed data\สถิติ_อากาศยานชนนก_AGA-SMO_fixed_v2.xlsx"
OUT_JS = r"C:\Users\Anusorn.s\OneDrive - CAAT\Documents\2026\Project\ThaiBirdStrikeGIS\gee\incident_data.js"
OUT_CSV = r"C:\Users\Anusorn.s\OneDrive - CAAT\Documents\2026\Project\ThaiBirdStrikeGIS\gee\incident_data.csv"

random.seed(42)

AIRPORTS = {
    "VTBS": {
        "name": "Suvarnabhumi",
        "lat": 13 + 41 / 60 + 9 / 3600,
        "lon": 100 + 44 / 60 + 56 / 3600,
        "rwy_bearing_deg": 10,  # RWY 01/19, approx true/mag heading
    },
    "VTBD": {
        "name": "Don Mueang",
        "lat": 13 + 54 / 60 + 51.74 / 3600,
        "lon": 100 + 36 / 60 + 20.49 / 3600,
        "rwy_bearing_deg": 30,  # RWY 03/21, approx true/mag heading
    },
}

# (distance_km, altitude_ft) control points digitized from the WHMC slide p.12 curve
DIST_ALT_CURVE = [(0, 0), (1, 150), (2, 300), (3.6, 550), (6, 1300), (10, 2500), (13, 3300), (16, 3800)]

GROUND_PHASES = {"Taxi", "Standing", "Manoeuvring"}
DEPARTURE_PHASES = {"Take-off"}
ARRIVAL_PHASES = {"Landing", "Approach"}


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


def estimate_point(icao, phase, alt_ft):
    ap = AIRPORTS[icao]
    lat, lon, brg = ap["lat"], ap["lon"], ap["rwy_bearing_deg"]

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


def main():
    wb = openpyxl.load_workbook(SRC, data_only=True, read_only=True)
    ws = wb["Raw_Data"]

    records = []
    for row in ws.iter_rows(min_row=5, values_only=True):
        if row[0] is None:
            continue
        year, month, category, damage, alt_ft, species, icao, phase, headline = row
        if icao not in AIRPORTS:
            continue
        lat, lon = estimate_point(icao, phase, alt_ft)
        records.append(
            {
                "icao": icao,
                "year": year,
                "month": month,
                "damage": damage or "Unknown",
                "alt_ft": alt_ft,
                "species": species or "UNKNOWN",
                "phase": phase or "Unknown",
                "lat": round(lat, 6),
                "lon": round(lon, 6),
            }
        )

    print(f"Prepared {len(records)} estimated points ({sum(1 for r in records if r['icao']=='VTBS')} VTBS, "
          f"{sum(1 for r in records if r['icao']=='VTBD')} VTBD)")

    # CSV for upload as an Earth Engine table asset (Assets > NEW > CSV file / Shapefile).
    fieldnames = ["lon", "lat", "icao", "year", "month", "phase", "alt_ft", "damage", "species"]
    with open(OUT_CSV, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in records:
            w.writerow(
                {
                    "lon": r["lon"],
                    "lat": r["lat"],
                    "icao": r["icao"],
                    "year": r["year"],
                    "month": r["month"],
                    "phase": r["phase"],
                    "alt_ft": r["alt_ft"] if r["alt_ft"] is not None else -1,
                    "damage": r["damage"],
                    "species": r["species"],
                }
            )
    print("Wrote", OUT_CSV)

    # Small JS fallback (first 50 rows only) so the script is runnable/previewable
    # even before the CSV asset is uploaded to Earth Engine.
    sample = records[:50]
    rows_js = [
        [r["lon"], r["lat"], r["icao"], r["year"], r["month"], r["phase"],
         r["alt_ft"] if r["alt_ft"] is not None else -1, r["damage"], r["species"]]
        for r in sample
    ]
    with open(OUT_JS, "w", encoding="utf-8") as f:
        f.write("// AUTO-GENERATED sample (first 50 rows) — see incident_data.csv for the full set.\n")
        f.write("// Columns: [lon, lat, icao, year, month, phase, alt_ft(-1=unknown), damage, species]\n")
        f.write("// Coordinates are ESTIMATED from FlightPhase+Altitude, not real GPS fixes. See docstring above.\n")
        f.write("var BIRDSTRIKE_SAMPLE = ")
        f.write(json.dumps(rows_js, ensure_ascii=False))
        f.write(";\n")
    print("Wrote", OUT_JS)


if __name__ == "__main__":
    main()
