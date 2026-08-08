"""
Turns the raw Overpass API result (landfill/wetland/nature_reserve features
within 15km of each of the 43 airports) into web/data/landuse.json, and picks
out a small "known attractor" POI subset: named features within 15km of the
airports with the most recorded bird-strike incidents (per airport_stats.json).

Overpass query used (see session notes) — landuse=landfill, natural=wetland,
natural=water[water=lagoon], leisure=nature_reserve, `around:15000` each of
the 43 airports in web/data/airports.json. Result saved at
%TEMP%\\overpass_result.json before running this script.

Geometry: Overpass was queried with `out center tags` — a centroid point per
feature, not full polygon outlines (full geometry for ~1100 wetland fragments
nationwide would bloat the offline bundle for little visual gain). Rendered
as fixed-radius circles in app.js, sized per kind.
"""
import json
import math
import os

AIRPORTS_JSON = r"C:\Users\Anusorn.s\OneDrive - CAAT\Documents\2026\Project\ThaiBirdStrikeGIS\web\data\airports.json"
STATS_JSON = r"C:\Users\Anusorn.s\OneDrive - CAAT\Documents\2026\Project\ThaiBirdStrikeGIS\web\data\airport_stats.json"
OVERPASS_RESULT = os.path.join(os.environ.get("TEMP", r"C:\Users\Anusorn.s\AppData\Local\Temp"), "overpass_result.json")
OUT_LANDUSE = r"C:\Users\Anusorn.s\OneDrive - CAAT\Documents\2026\Project\ThaiBirdStrikeGIS\web\data\landuse.json"
OUT_ATTRACTORS = r"C:\Users\Anusorn.s\OneDrive - CAAT\Documents\2026\Project\ThaiBirdStrikeGIS\web\data\attractors.json"

TOP_N_AIRPORTS = 6


def haversine(lat1, lon1, lat2, lon2):
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def main():
    with open(AIRPORTS_JSON, encoding="utf-8") as f:
        airports = json.load(f)
    with open(STATS_JSON, encoding="utf-8") as f:
        stats = json.load(f)
    with open(OVERPASS_RESULT, encoding="utf-8") as f:
        overpass = json.load(f)

    top_airports = sorted(stats.items(), key=lambda kv: -kv[1]["total"])[:TOP_N_AIRPORTS]
    top_icaos = {icao for icao, _ in top_airports}
    print("Top", TOP_N_AIRPORTS, "airports by incident count:", [(i, s["total"]) for i, s in top_airports])

    landuse = []
    for el in overpass["elements"]:
        tags = el.get("tags", {})
        kind = tags.get("landuse") or tags.get("natural") or tags.get("leisure")
        if kind not in ("landfill", "wetland", "water", "nature_reserve"):
            continue
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lon = el.get("lon") or (el.get("center") or {}).get("lon")
        if lat is None:
            continue
        name = tags.get("name") or tags.get("name:en")
        nearest = min(airports, key=lambda a: haversine(lat, lon, a["lat"], a["lon"]))
        dist = round(haversine(lat, lon, nearest["lat"], nearest["lon"]), 1)
        landuse.append({
            "lat": round(lat, 5), "lon": round(lon, 5), "kind": "wetland" if kind == "water" else kind,
            "name": name, "icaoNear": nearest["icao"], "distKm": dist,
        })

    with open(OUT_LANDUSE, "w", encoding="utf-8") as f:
        json.dump(landuse, f, ensure_ascii=False, separators=(",", ":"))
    print("Wrote", OUT_LANDUSE, f"({len(landuse)} features)")

    attractors = [
        row for row in landuse
        if row["name"] and row["icaoNear"] in top_icaos
    ]
    with open(OUT_ATTRACTORS, "w", encoding="utf-8") as f:
        json.dump(attractors, f, ensure_ascii=False, separators=(",", ":"))
    print("Wrote", OUT_ATTRACTORS, f"({len(attractors)} named features near top-{TOP_N_AIRPORTS} airports)")
    for a in attractors:
        print(" -", a["name"], "|", a["kind"], "| near", a["icaoNear"], f"({a['distKm']}km)")


if __name__ == "__main__":
    main()
