"""
Regenerates data_prep/overpass_geom_query.txt from web/data/airports.json.

Run this whenever the airport list changes, then POST the resulting query to
https://overpass-api.de/api/interpreter and save the response JSON to
%TEMP%\\overpass_geom_result.json before running build_landuse.py.

  curl -s -X POST "https://overpass-api.de/api/interpreter" \
       --data-urlencode "data@data_prep/overpass_geom_query.txt" \
       -o "$TEMP/overpass_geom_result.json"

Tags mirror the ones NASF Guideline C Attachment 1 flags as high wildlife-
hazard land uses (see project_thai_bird_strike_gis_map memory): landfill,
wetland, lagoon-type water bodies, nature reserves, plus zoo/theme_park (open
animal enclosures / crowds+food waste) added later. `out geom;` returns full
way/relation outlines (not just a centroid) so build_landuse.py can draw real
polygons instead of fixed-radius circles.
"""
import json

AIRPORTS_JSON = r"C:\Users\Anusorn.s\OneDrive - CAAT\Documents\2026\Project\ThaiBirdStrikeGIS\web\data\airports.json"
OUT_QUERY = r"C:\Users\Anusorn.s\OneDrive - CAAT\Documents\2026\Project\ThaiBirdStrikeGIS\data_prep\overpass_geom_query.txt"
RADIUS_M = 15000

TAG_FILTERS = [
    "landuse=landfill",
    "natural=wetland",
    "natural=water][water=lagoon",
    "leisure=nature_reserve",
    "tourism=zoo",
    "tourism=theme_park",
]


def main():
    with open(AIRPORTS_JSON, encoding="utf-8") as f:
        airports = json.load(f)

    lines = ["[out:json][timeout:180];", "("]
    for a in airports:
        lat, lon = a["lat"], a["lon"]
        for tf in TAG_FILTERS:
            lines.append(f"  way[{tf}](around:{RADIUS_M},{lat},{lon});")
            lines.append(f"  relation[{tf}](around:{RADIUS_M},{lat},{lon});")
        lines.append(f"  node[tourism=zoo](around:{RADIUS_M},{lat},{lon});")
    lines.append(");")
    lines.append("out geom;")

    query = "\n".join(lines)
    with open(OUT_QUERY, "w", encoding="utf-8") as f:
        f.write(query)
    print(f"Wrote {OUT_QUERY} ({len(query)} chars, {len(airports)} airports x {len(TAG_FILTERS)} tags)")


if __name__ == "__main__":
    main()
