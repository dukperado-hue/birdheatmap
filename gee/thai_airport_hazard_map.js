/**
 * Thailand Airport Bird/Wildlife Hazard Map — prototype
 *
 * Built for the CAAT wildlife-hazard team commitment made at the ICAO Asia/Pacific
 * Wildlife Hazard Management meeting, inspired by:
 *  - India's aerodrome WHMP "bow-tie" hazard zone diagram (PHZ/SHZ/THZ inside a
 *    13 km LHZ circle, based on 95% of bird strikes occurring below 2000 ft) —
 *    WHMC slide deck p.12.
 *  - Sydney Kingsford-Smith NASAG example: the same zones drawn as a real GIS
 *    overlay on roads/water/land use.
 *  - the ee-navavitgas "thai-geomorphology" Earth Engine App as a reference for
 *    how to structure a public GEE App (toggleable layers + click-to-inspect).
 *
 * DATA HONESTY NOTE: the incident layer below is built from CAAT's real bird-strike
 * log (year/month/altitude/species/flight-phase per ICAO airport), but that source
 * has NO per-event GPS coordinate. Each point plotted here is a STATISTICAL
 * ESTIMATE placed along the extended runway centerline using altitude + flight
 * phase (see data_prep/prepare_incident_data.py for the exact method). Do not
 * present this layer as verified GPS incident locations — it approximates where
 * risk concentrates, not where any specific aircraft was. Swap in real GPS/radar
 * track data when available.
 *
 * Scope of this prototype: VTBS (Suvarnabhumi) and VTBD (Don Mueang). The AIRPORTS
 * list below is intentionally structured so the remaining ~38 Thai aerodromes can
 * be added the same way (ARP coordinates + runway bearing from the eAIP AD 2.2 /
 * AD 2.12 pages) without changing any other code.
 */

// ---------------------------------------------------------------------------
// 1. CONFIG
// ---------------------------------------------------------------------------

// Set this to your uploaded EE table asset id (Assets > NEW > CSV file, using
// gee/incident_data.csv) once available, e.g. 'projects/integral-berm-469707-k5/assets/vtbs_vtbd_birdstrike'.
// Leave blank ('') to fall back to the 50-row embedded sample for a quick test.
var INCIDENT_ASSET_ID = '';

var AIRPORTS = [
  {
    icao: 'VTBS',
    name: 'สุวรรณภูมิ / Suvarnabhumi',
    lon: 100.748889,
    lat: 13.686389,
    rwyBearingDeg: 10 // RWY 01/19
  },
  {
    icao: 'VTBD',
    name: 'ดอนเมือง / Don Mueang',
    lon: 100.605692,
    lat: 13.914372,
    rwyBearingDeg: 30 // RWY 03/21
  }
];

// 50-row fallback sample so the script is runnable before the CSV asset upload.
// AUTO-GENERATED sample (first 50 rows) — see incident_data.csv / data_prep script for the full set.
// Columns: [lon, lat, icao, year, month, phase, alt_ft(-1=unknown), damage, species]
var BIRDSTRIKE_SAMPLE = [[100.559878, 13.782156, "VTBD", 2021, 1, "Approach", 3700, "Without damage", "UNKNOWN"], [100.781516, 13.691218, "VTBS", 2021, 1, "Unknown", -1, "Without damage", "UNKNOWN"], [100.669517, 13.647553, "VTBS", 2021, 1, "Unknown", -1, "Without damage", "UNKNOWN"], [100.748857, 13.665025, "VTBS", 2021, 1, "Landing", 300, "Without damage", "UNKNOWN"], [100.748221, 13.714762, "VTBS", 2021, 1, "Take-off", 500, "Without damage", "UNKNOWN"], [100.746, 13.67012, "VTBS", 2021, 1, "Landing", 300, "Without damage", "UNKNOWN"], [100.751918, 13.686814, "VTBS", 2021, 1, "Unknown", -1, "Without damage", "UNKNOWN"], [100.752734, 13.750792, "VTBS", 2021, 1, "Take-off", -1, "Unknown", "UNKNOWN"], [100.750962, 13.623258, "VTBS", 2021, 1, "Landing", -1, "Without damage", "UNKNOWN"], [100.745169, 13.67211, "VTBS", 2021, 1, "Landing", 200, "Without damage", "UNKNOWN"], [100.733991, 13.648066, "VTBS", 2021, 1, "Landing", -1, "Without damage", "UNKNOWN"], [100.748893, 13.686733, "VTBS", 2021, 1, "Take-off", 30, "Without damage", "UNKNOWN"], [100.744004, 13.671515, "VTBS", 2021, 1, "Landing", 300, "Without damage", "UNKNOWN"], [100.761279, 13.724311, "VTBS", 2021, 1, "Take-off", 800, "Without damage", "UNKNOWN"], [100.722381, 13.619941, "VTBS", 2021, 1, "Landing", -1, "Without damage", "UNKNOWN"], [100.731015, 13.598485, "VTBS", 2021, 1, "Approach", 2500, "Without damage", "UNKNOWN"], [100.744232, 13.665986, "VTBS", 2021, 1, "Approach", 300, "Without damage", "UNKNOWN"], [100.745803, 13.671551, "VTBS", 2021, 1, "Landing", 200, "Without damage", "UNKNOWN"], [100.752964, 13.751123, "VTBS", 2021, 1, "Take-off", -1, "Without damage", "UNKNOWN"], [100.746546, 13.649515, "VTBS", 2021, 1, "Landing", 0, "Without damage", "UNKNOWN"], [100.746657, 13.659295, "VTBS", 2021, 1, "Approach", 500, "Without damage", "UNKNOWN"], [100.7452, 13.655571, "VTBS", 2021, 1, "Approach", 500, "Without damage", "UNKNOWN"], [100.792, 13.696722, "VTBS", 2021, 1, "En route", 800, "Without damage", "UNKNOWN"], [100.717119, 13.603154, "VTBS", 2021, 1, "Approach", 2500, "Without damage", "UNKNOWN"], [100.580343, 13.853784, "VTBD", 2021, 1, "Approach", -1, "Without damage", "UNKNOWN"], [100.823968, 13.729949, "VTBS", 2021, 1, "Unknown", -1, "Without damage", "UNKNOWN"], [100.581119, 13.887643, "VTBD", 2021, 2, "Approach", 700, "Without damage", "UNKNOWN"], [100.732365, 13.623425, "VTBS", 2021, 2, "Landing", 0, "Without damage", "UNKNOWN"], [100.74427, 13.686573, "VTBS", 2021, 2, "Taxi", -1, "Unknown", "UNKNOWN"], [100.745704, 13.654105, "VTBS", 2021, 2, "Landing", 0, "Without damage", "UNKNOWN"], [100.735895, 13.652293, "VTBS", 2021, 2, "Landing", -1, "Without damage", "UNKNOWN"], [100.729424, 13.608406, "VTBS", 2021, 2, "Landing", 0, "Without damage", "UNKNOWN"], [100.698653, 13.551277, "VTBS", 2021, 2, "Approach", 4000, "Without damage", "UNKNOWN"], [100.748443, 13.68015, "VTBS", 2021, 2, "Approach", 100, "Without damage", "UNKNOWN"], [100.590046, 13.880742, "VTBD", 2021, 2, "Approach", -1, "Without damage", "UNKNOWN"], [100.740344, 13.623477, "VTBS", 2021, 2, "Landing", 0, "Without damage", "UNKNOWN"], [100.602954, 13.911415, "VTBD", 2021, 2, "Approach", 100, "Without damage", "UNKNOWN"], [100.749696, 13.634138, "VTBS", 2021, 2, "Landing", -1, "Without damage", "UNKNOWN"], [100.742103, 13.664281, "VTBS", 2021, 2, "Approach", -1, "Without damage", "UNKNOWN"], [100.768635, 13.731308, "VTBS", 2021, 2, "Unknown", 0, "Without damage", "UNKNOWN"], [100.718145, 13.611527, "VTBS", 2021, 2, "Approach", 2200, "Without damage", "UNKNOWN"], [100.744327, 13.674467, "VTBS", 2021, 2, "Approach", 200, "Without damage", "UNKNOWN"], [100.753423, 13.539413, "VTBS", 2021, 2, "Approach", 4000, "Without damage", "UNKNOWN"], [100.557719, 13.846242, "VTBD", 2021, 2, "Landing", 2200, "With damage", "HERON, STORK, IBIS, FLAMINGO"], [100.76198, 13.739283, "VTBS", 2021, 3, "Take-off", -1, "Without damage", "UNKNOWN"], [100.745483, 13.664675, "VTBS", 2021, 3, "Landing", -1, "Without damage", "UNKNOWN"], [100.579778, 13.883327, "VTBD", 2021, 3, "Landing", 700, "Without damage", "UNKNOWN"], [100.532456, 13.791239, "VTBD", 2021, 3, "Approach", 4000, "Without damage", "UNKNOWN"], [100.737519, 13.653549, "VTBS", 2021, 3, "Landing", -1, "Without damage", "UNKNOWN"], [100.739666, 13.645786, "VTBS", 2021, 3, "Approach", -1, "Without damage", "UNKNOWN"]];

// ---------------------------------------------------------------------------
// 2. GEOMETRY HELPERS — build the "bow-tie" PHZ/SHZ/THZ zones inside a 13km LHZ
//    circle around each airport's ARP, oriented along the runway bearing.
// ---------------------------------------------------------------------------

// Plain client-side JS (not server-side ee.Number ops) — used to build static
// polygon geometry, which is perfectly adequate since airport/runway parameters
// are constants known at script-build time.
function destPointClient(lon, lat, bearingDeg, distKm) {
  var R = 6371.0;
  var brg = bearingDeg * Math.PI / 180;
  var lat1 = lat * Math.PI / 180;
  var lon1 = lon * Math.PI / 180;
  var ang = distKm / R;
  var lat2 = Math.asin(Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(brg));
  var lon2 = lon1 + Math.atan2(
    Math.sin(brg) * Math.sin(ang) * Math.cos(lat1),
    Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2)
  );
  return [lon2 * 180 / Math.PI, lat2 * 180 / Math.PI];
}

// One trapezoid segment of the hourglass, from distance d0->d1 along `bearing`,
// with half-widths w0/2 -> w1/2 (km) perpendicular to the runway axis.
function trapezoid(lon, lat, bearing, d0, d1, w0, w1) {
  var perp1 = bearing + 90;
  var perp2 = bearing - 90;
  var p0a = destPointClient(lon, lat, bearing, d0);
  var p1a = destPointClient(lon, lat, bearing, d1);
  var c0a = destPointClient(p0a[0], p0a[1], perp1, w0 / 2);
  var c0b = destPointClient(p0a[0], p0a[1], perp2, w0 / 2);
  var c1a = destPointClient(p1a[0], p1a[1], perp1, w1 / 2);
  var c1b = destPointClient(p1a[0], p1a[1], perp2, w1 / 2);
  return ee.Geometry.Polygon([[c0a, c1a, c1b, c0b, c0a]]);
}

// Build the full hourglass/bow-tie zone (both runway ends) for one ring, i.e.
// the union of two trapezoids pointing in opposite directions from the ARP.
function bowTieRing(ap, d0, d1, w0, w1) {
  var seg1 = trapezoid(ap.lon, ap.lat, ap.rwyBearingDeg, d0, d1, w0, w1);
  var seg2 = trapezoid(ap.lon, ap.lat, ap.rwyBearingDeg + 180, d0, d1, w0, w1);
  return ee.FeatureCollection([ee.Feature(seg1), ee.Feature(seg2)]).union(1).geometry();
}

function airportZones(ap) {
  var center = ee.Geometry.Point([ap.lon, ap.lat]);
  return {
    icao: ap.icao,
    name: ap.name,
    center: center,
    lhz: center.buffer(13000), // Low Hazard Zone, 13 km radius circle
    phz: bowTieRing(ap, 0, 1.5, 0.8, 1.2),      // Primary Hazard Zone, narrow, closest to ARP
    shz: bowTieRing(ap, 1.5, 3.6, 1.2, 2.5),    // Secondary Hazard Zone
    thz: bowTieRing(ap, 3.6, 13, 2.5, 5)        // Tertiary Hazard Zone, widest, furthest
  };
}

var ZONES = AIRPORTS.map(airportZones);

// ---------------------------------------------------------------------------
// 3. INCIDENT LAYER — real CAAT bird-strike log, estimated positions (see note above)
// ---------------------------------------------------------------------------

function sampleToFeatureCollection(rows) {
  var feats = rows.map(function (r) {
    return ee.Feature(ee.Geometry.Point([r[0], r[1]]), {
      icao: r[2], year: r[3], month: r[4], phase: r[5], alt_ft: r[6], damage: r[7], species: r[8]
    });
  });
  return ee.FeatureCollection(feats);
}

var incidents = INCIDENT_ASSET_ID ?
  ee.FeatureCollection(INCIDENT_ASSET_ID) :
  sampleToFeatureCollection(BIRDSTRIKE_SAMPLE);

// Kernel-density heatmap from the incident points — this is the
// "Spatiotemporal Risk / Hotspot" map the Thai team specifically asked for.
var incidentImg = ee.Image().float().paint(incidents, 1).unmask(0);
var heatmap = incidentImg.convolve(ee.Kernel.gaussian(1200, 400, 'meters')).rename('density');
var heatmapVis = {
  min: 0, max: 0.05,
  palette: ['00000000', 'ffffb2', 'fecc5c', 'fd8d3c', 'f03b20', 'bd0026']
};

// ---------------------------------------------------------------------------
// 4. ECOLOGICAL ATTRACTOR LAYERS (public GEE datasets) — off-airport land use
//    that draws wildlife, per the off-airport zoning concern raised by CAAT.
// ---------------------------------------------------------------------------

var worldCover = ee.ImageCollection('ESA/WorldCover/v200').first();
var landUseVis = { bands: ['Map'] }; // ESA WorldCover ships its own class palette

var surfaceWater = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('occurrence');
var waterVis = { min: 0, max: 100, palette: ['ffffff', '0000ff'] };

// ---------------------------------------------------------------------------
// 5. MAP + UI — mirrors the reference thai-geomorphology App: a left panel with
//    layer checkboxes, Thai labels, click-to-inspect.
// ---------------------------------------------------------------------------

Map.setOptions('SATELLITE');
Map.centerObject(ee.FeatureCollection(ZONES.map(function (z) { return ee.Feature(z.center); })), 10);

var zoneLayers = {}; // icao -> {phz, shz, thz, lhz} Map layers, for per-airport toggling

ZONES.forEach(function (z) {
  var lhzLayer = Map.addLayer(z.lhz, { color: 'ffff0055' }, z.icao + ' — LHZ (13km)', true, 0.35);
  var thzLayer = Map.addLayer(z.thz, { color: '8B4513' }, z.icao + ' — THZ', true, 0.45);
  var shzLayer = Map.addLayer(z.shz, { color: 'ff8c00' }, z.icao + ' — SHZ', true, 0.55);
  var phzLayer = Map.addLayer(z.phz, { color: 'ff0000' }, z.icao + ' — PHZ', true, 0.7);
  Map.addLayer(z.center, { color: 'ffffff' }, z.icao + ' — ARP', true);
});

var heatmapLayer = Map.addLayer(heatmap.updateMask(heatmap.gt(0.001)), heatmapVis,
  'จุดเสี่ยงนกชน (Bird-strike hotspot heatmap)', true, 0.85);
var landUseLayer = Map.addLayer(worldCover, landUseVis, 'การใช้ที่ดิน / Land cover (ESA WorldCover)', false, 0.6);
var waterLayer = Map.addLayer(surfaceWater, waterVis, 'แหล่งน้ำ / Surface water (JRC)', false, 0.7);

// --- Left control panel ------------------------------------------------

var panel = ui.Panel({ style: { width: '320px', padding: '8px' } });
panel.add(ui.Label('แผนที่ความเสี่ยงนกชนเครื่องบิน', { fontWeight: 'bold', fontSize: '18px' }));
panel.add(ui.Label('Thailand Airport Wildlife-Hazard Map (prototype: VTBS / VTBD)',
  { fontSize: '12px', color: '666666' }));

panel.add(ui.Label('ตั้งค่าชั้นข้อมูลแผนที่ (Layer Controls):', { fontWeight: 'bold', margin: '10px 0 4px 0' }));

function toggleCheckbox(label, layer, defaultValue) {
  return ui.Checkbox({
    label: label,
    value: defaultValue === undefined ? true : defaultValue,
    onChange: function (checked) { layer.setShown(checked); }
  });
}

panel.add(toggleCheckbox('จุดเสี่ยงนกชน (Heatmap) — จากสถิติจริง ตำแหน่งเป็นการประมาณ', heatmapLayer));
panel.add(toggleCheckbox('การใช้ที่ดิน / Land cover', landUseLayer, false));
panel.add(toggleCheckbox('แหล่งน้ำ / Surface water', waterLayer, false));

panel.add(ui.Label('เขตความเสี่ยง (Hazard zones), ตามสไลด์ WHMC หน้า 12:', { fontWeight: 'bold', margin: '10px 0 4px 0' }));
panel.add(ui.Label('🔴 PHZ (Primary)  🟠 SHZ (Secondary)  🟤 THZ (Tertiary)  🟡 LHZ 13km', { fontSize: '11px' }));

panel.add(ui.Label('⚠️ ตำแหน่งจุดในชั้น Heatmap เป็นการประมาณจาก Altitude/FlightPhase ' +
  'ของรายงานจริง ไม่ใช่พิกัด GPS ที่บันทึกจริง (ข้อมูลต้นทางไม่มีพิกัด) — ' +
  'ใช้เพื่อดูแนวโน้มเชิงพื้นที่เบื้องต้นเท่านั้น',
  { fontSize: '10px', color: 'cc3333', margin: '10px 0 4px 0' }));

panel.add(ui.Label('คลิกบนแผนที่เพื่อดูข้อมูลเชิงลึก...', { fontStyle: 'italic', margin: '10px 0 4px 0' }));
var infoLabel = ui.Label('รอการเลือกพื้นที่...');
panel.add(infoLabel);

Map.onClick(function (coords) {
  var pt = ee.Geometry.Point([coords.lon, coords.lat]);
  var nearby = incidents.filterBounds(pt.buffer(1500));
  nearby.size().evaluate(function (n) {
    infoLabel.setValue('จุดที่คลิก: ' + coords.lat.toFixed(4) + ', ' + coords.lon.toFixed(4) +
      ' — เหตุการณ์นกชน (โดยประมาณ) ในรัศมี 1.5km: ' + n + ' ครั้ง');
  });
});

ui.root.insert(0, panel);
