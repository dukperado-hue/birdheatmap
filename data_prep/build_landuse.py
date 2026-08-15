"""
Turns the raw Overpass API result (landfill/wetland/lagoon/nature_reserve/zoo/
theme_park features within 15km of each of the 43 airports) into
web/data/landuse.json, and picks out a small "known attractor" POI subset:
named features within 15km of the airports with the most recorded
bird-strike incidents (per airport_stats.json).

Overpass query used (saved at data_prep/overpass_geom_query.txt, regenerate
with build_overpass_query.py if the airport list changes) — landuse=landfill,
natural=wetland, natural=water[water=lagoon], leisure=nature_reserve,
tourism=zoo, tourism=theme_park, `around:15000` each of the 43 airports in
web/data/airports.json, `out geom;` (full way/relation outlines, not just a
centroid). Result saved at %TEMP%\\overpass_geom_result.json before running
this script.

Geometry: real polygon outlines now (previously just a centroid + fixed-radius
circle). Each way's outline is simplified with Ramer-Douglas-Peucker (~30m
tolerance) to keep the payload reasonable — 1,131 wetland fragments nationwide
would otherwise bloat the offline bundle. Multipolygon relations (a few large
wetlands are mapped as relations with multiple outer rings, e.g. islands/
lakes with holes) keep every "outer" member ring; "inner" rings (holes) are
dropped for simplicity since they don't matter for a hazard-proximity map.
Point-only zoo POIs (mapped as OSM nodes, no way geometry) keep the old
centroid+circle rendering as a fallback.
"""
import json
import math
import os

AIRPORTS_JSON = r"C:\Users\Anusorn.s\OneDrive - CAAT\Documents\2026\Project\ThaiBirdStrikeGIS\web\data\airports.json"
STATS_JSON = r"C:\Users\Anusorn.s\OneDrive - CAAT\Documents\2026\Project\ThaiBirdStrikeGIS\web\data\airport_stats.json"
OVERPASS_RESULT = os.path.join(os.environ.get("TEMP", r"C:\Users\Anusorn.s\AppData\Local\Temp"), "overpass_geom_result.json")
OUT_LANDUSE = r"C:\Users\Anusorn.s\OneDrive - CAAT\Documents\2026\Project\ThaiBirdStrikeGIS\web\data\landuse.json"
OUT_ATTRACTORS = r"C:\Users\Anusorn.s\OneDrive - CAAT\Documents\2026\Project\ThaiBirdStrikeGIS\web\data\attractors.json"

TOP_N_AIRPORTS = 6
RDP_TOLERANCE_DEG = 0.0003  # ~30m at Thailand's latitude


def haversine(lat1, lon1, lat2, lon2):
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def rdp(points, tolerance):
    """Ramer-Douglas-Peucker polyline simplification. points: [(lat,lon), ...]."""
    if len(points) < 3:
        return points

    def perp_dist(pt, a, b):
        if a == b:
            return math.hypot(pt[0] - a[0], pt[1] - a[1])
        num = abs((b[0] - a[0]) * (a[1] - pt[1]) - (a[0] - pt[0]) * (b[1] - a[1]))
        den = math.hypot(b[0] - a[0], b[1] - a[1])
        return num / den

    dmax, idx = 0.0, 0
    for i in range(1, len(points) - 1):
        d = perp_dist(points[i], points[0], points[-1])
        if d > dmax:
            dmax, idx = d, i
    if dmax > tolerance:
        left = rdp(points[: idx + 1], tolerance)
        right = rdp(points[idx:], tolerance)
        return left[:-1] + right
    return [points[0], points[-1]]


def ring_centroid(ring):
    lat = sum(p[0] for p in ring) / len(ring)
    lon = sum(p[1] for p in ring) / len(ring)
    return lat, lon


def extract_rings(el):
    """Returns a list of simplified [[lat,lon],...] outer rings for a way/relation."""
    if el["type"] == "way":
        geom = el.get("geometry")
        if not geom:
            return []
        ring = [(pt["lat"], pt["lon"]) for pt in geom]
        return [rdp(ring, RDP_TOLERANCE_DEG)]
    if el["type"] == "relation":
        rings = []
        for m in el.get("members", []):
            if m.get("role") != "outer" or not m.get("geometry"):
                continue
            ring = [(pt["lat"], pt["lon"]) for pt in m["geometry"]]
            rings.append(rdp(ring, RDP_TOLERANCE_DEG))
        return rings
    return []


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
    seen = set()
    raw_pts, simplified_pts = 0, 0
    for el in overpass["elements"]:
        tags = el.get("tags", {})
        kind = tags.get("landuse") or tags.get("natural") or tags.get("leisure") or tags.get("tourism")
        if kind not in ("landfill", "wetland", "water", "nature_reserve", "zoo", "theme_park"):
            continue
        kind = "wetland" if kind == "water" else kind
        name = tags.get("name") or tags.get("name:en")

        if el["type"] == "node":
            lat, lon, rings = el["lat"], el["lon"], []
        else:
            rings = extract_rings(el)
            if not rings:
                continue
            lat, lon = ring_centroid(rings[0])
            raw_pts += sum(len(m.get("geometry", [])) for m in el.get("members", [])) if el["type"] == "relation" else len(el.get("geometry", []))
            simplified_pts += sum(len(r) for r in rings)

        dedupe_key = (name, round(lat, 3), round(lon, 3))
        if name and dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        nearest = min(airports, key=lambda a: haversine(lat, lon, a["lat"], a["lon"]))
        dist = round(haversine(lat, lon, nearest["lat"], nearest["lon"]), 1)
        row = {
            "lat": round(lat, 5), "lon": round(lon, 5), "kind": kind,
            "name": name, "icaoNear": nearest["icao"], "distKm": dist,
        }
        if rings:
            row["poly"] = [[[round(p[0], 5), round(p[1], 5)] for p in ring] for ring in rings]
        landuse.append(row)

    with open(OUT_LANDUSE, "w", encoding="utf-8") as f:
        json.dump(landuse, f, ensure_ascii=False, separators=(",", ":"))
    print("Wrote", OUT_LANDUSE, f"({len(landuse)} features)")
    if raw_pts:
        print(f"Polygon points: {raw_pts} raw -> {simplified_pts} after RDP simplify "
              f"({100 * simplified_pts / raw_pts:.0f}%)")

    # Attractors (always-on POI layer) stick to kinds with a real wildlife-hazard
    # rationale per NASF Guideline C (landfill/wetland/nature_reserve = food/water
    # sources; zoo = open animal enclosures/feed). Generic theme/water parks
    # (Dream World, Chocolate Ville, water slides, etc.) are dropped here — they
    # show up plenty in the OSM "tourism=theme_park" tag but aren't a wildlife
    # attractor in the sense this layer is meant to flag. They're still in
    # landuse.json (the full off-by-default layer) for anyone who wants them.
    attractors = [
        row for row in landuse
        if row["name"] and row["icaoNear"] in top_icaos and row["kind"] != "theme_park"
    ]
    with open(OUT_ATTRACTORS, "w", encoding="utf-8") as f:
        json.dump(attractors, f, ensure_ascii=False, separators=(",", ":"))
    print("Wrote", OUT_ATTRACTORS, f"({len(attractors)} named features near top-{TOP_N_AIRPORTS} airports)")
    for a in attractors:
        print(" -", a["name"], "|", a["kind"], "| near", a["icaoNear"], f"({a['distKm']}km)")


if __name__ == "__main__":
    main()
