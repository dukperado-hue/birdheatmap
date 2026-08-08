/**
 * Thailand Airport Bird-Strike Hazard Map — offline Leaflet app.
 *
 * Zone geometry (PHZ/SHZ/THZ bow-tie inside a 13km LHZ circle, oriented along
 * the runway bearing) mirrors the Earth Engine version at gee/thai_airport_hazard_map.js
 * but is computed here in plain client-side JS -- no Google/Earth Engine account
 * needed, works by opening this folder's index.html directly (file://).
 *
 * The one thing that still needs internet is the OpenStreetMap basemap tiles.
 * Everything else (Leaflet, the zone math, the airport list, the heatmap, the
 * land-use overlay) is bundled locally in web/vendor and web/data.js.
 */

// ---------------------------------------------------------------------------
// Zone geometry helpers (same math as the Earth Engine script)
// ---------------------------------------------------------------------------

function destPoint(lat, lon, bearingDeg, distKm) {
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
  return [lat2 * 180 / Math.PI, lon2 * 180 / Math.PI]; // [lat, lon] for Leaflet
}

// One trapezoid segment of the hourglass, from distance d0->d1 along `bearing`,
// with half-widths w0/2 -> w1/2 (km) perpendicular to the runway axis.
function trapezoid(lat, lon, bearing, d0, d1, w0, w1) {
  var perp1 = bearing + 90, perp2 = bearing - 90;
  var p0 = destPoint(lat, lon, bearing, d0);
  var p1 = destPoint(lat, lon, bearing, d1);
  var c0a = destPoint(p0[0], p0[1], perp1, w0 / 2);
  var c0b = destPoint(p0[0], p0[1], perp2, w0 / 2);
  var c1a = destPoint(p1[0], p1[1], perp1, w1 / 2);
  var c1b = destPoint(p1[0], p1[1], perp2, w1 / 2);
  return [c0a, c1a, c1b, c0b];
}

function bowTieRing(lat, lon, bearing, d0, d1, w0, w1) {
  return [
    trapezoid(lat, lon, bearing, d0, d1, w0, w1),
    trapezoid(lat, lon, bearing + 180, d0, d1, w0, w1)
  ];
}

// Alternative zone model: Australia's NASF Guideline C ("Managing the Risk of
// Wildlife Strikes in the Vicinity of Airports", Nov 2023) -- concentric rings
// centered on the ARP (not runway-oriented), the model CASR Part 139 MOS
// requires airport operators to monitor and publicly declare:
//   Area A 0-3km, Area B 3-8km, Area C 8-13km. The 13km figure traces back to
// the same ICAO Airport Services Manual distance as the bow-tie's LHZ circle.
var NASF_RINGS = { a: 3000, b: 8000, c: 13000 };

// ---------------------------------------------------------------------------
// Zone visual style — distinct hues so PHZ/SHZ/THZ don't blend into each other
// or into satellite imagery. LHZ is an outline only (fill would bury everything).
// ---------------------------------------------------------------------------

var ZONE_STYLE = {
  lhz: { color: '#1f78b4', weight: 2, fill: true, fillColor: '#1f78b4', fillOpacity: 0.05, dashArray: '4 4' },
  thz: { color: '#4b0082', weight: 1, fill: true, fillColor: '#6a3d9a', fillOpacity: 0.42 },
  shz: { color: '#e65c00', weight: 1, fill: true, fillColor: '#ff7f00', fillOpacity: 0.55 },
  phz: { color: '#99000d', weight: 1, fill: true, fillColor: '#e31a1c', fillOpacity: 0.75 }
};

// Land-use risk layer style (NASF Guideline C Attachment 1: putrescible-waste
// landfill and wetland/waterway are "High risk" land uses near airports).
var LANDUSE_STYLE = {
  landfill: { color: '#6b4423', fillColor: '#8b5a2b', fillOpacity: 0.55, radius: 350 },
  wetland: { color: '#1b7a6b', fillColor: '#2a9d8f', fillOpacity: 0.4, radius: 280 },
  nature_reserve: { color: '#2e7d32', fillColor: '#2e7d32', fillOpacity: 0.12, radius: 450 },
  zoo: { color: '#b8860b', fillColor: '#daa520', fillOpacity: 0.5, radius: 250 },
  theme_park: { color: '#8a5fb0', fillColor: '#a67bc4', fillOpacity: 0.35, radius: 250 }
};
var LANDUSE_LABEL = {
  landfill: 'บ่อขยะ/สถานที่ทิ้งขยะ (High risk ตาม NASF Guideline C)',
  wetland: 'พื้นที่ชุ่มน้ำ/แหล่งน้ำ (High risk ตาม NASF Guideline C)',
  nature_reserve: 'พื้นที่อนุรักษ์ธรรมชาติ/สัตว์ป่า',
  zoo: 'สวนสัตว์/ฟาร์มสัตว์ (แหล่งอาหาร/สัตว์เปิดโล่งที่อาจดึงดูดนก)',
  theme_park: 'สวนสนุก/สถานที่ท่องเที่ยว'
};

var MONTH_TH = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

// ---------------------------------------------------------------------------
// Map + state
// ---------------------------------------------------------------------------

var map = L.map('map', { zoomControl: true }).setView([13.8, 100.9], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 18
}).addTo(map);

var zoneLayerGroup = L.layerGroup().addTo(map);
var arpMarkerGroup = L.layerGroup().addTo(map);
var landuseLayerGroup = L.layerGroup();
var attractorLayerGroup = L.layerGroup();
var heatLayer = null;

var layerVisibility = { phz: true, shz: true, thz: true, lhz: true, heat: true };
var zoneModel = 'bowtie'; // 'bowtie' (India, runway-oriented) | 'rings' (Australia NASF, ARP-centered)
var weightedHeat = false; // false = raw incident count, true = weighted (damage x8)
var timeMode = 'all';     // 'all' | 'month' | 'seasonal'

var MONTHS = Object.keys(HEATMAP_BY_MONTH).sort(); // "2021-01".."2025-12", 60 entries

function drawAirportZones(ap) {
  zoneLayerGroup.clearLayers();
  arpMarkerGroup.clearLayers();

  var lat = ap.lat, lon = ap.lon, brg = ap.rwyBearingDeg;

  if (zoneModel === 'rings') {
    // Draw largest-first so each smaller, differently-colored circle on top
    // reads as a distinct band (donut trick via z-order, no clipping needed).
    if (layerVisibility.thz) L.circle([lat, lon], { radius: NASF_RINGS.c, ...ZONE_STYLE.thz }).addTo(zoneLayerGroup);
    if (layerVisibility.shz) L.circle([lat, lon], { radius: NASF_RINGS.b, ...ZONE_STYLE.shz }).addTo(zoneLayerGroup);
    if (layerVisibility.phz) L.circle([lat, lon], { radius: NASF_RINGS.a, ...ZONE_STYLE.phz }).addTo(zoneLayerGroup);
    if (layerVisibility.lhz) L.circle([lat, lon], { radius: NASF_RINGS.c, ...ZONE_STYLE.lhz }).addTo(zoneLayerGroup);
  } else {
    if (layerVisibility.lhz) {
      L.circle([lat, lon], { radius: 13000, ...ZONE_STYLE.lhz }).addTo(zoneLayerGroup);
    }
    if (layerVisibility.thz) {
      bowTieRing(lat, lon, brg, 3.6, 13, 2.5, 5).forEach(function (poly) {
        L.polygon(poly, ZONE_STYLE.thz).addTo(zoneLayerGroup);
      });
    }
    if (layerVisibility.shz) {
      bowTieRing(lat, lon, brg, 1.5, 3.6, 1.2, 2.5).forEach(function (poly) {
        L.polygon(poly, ZONE_STYLE.shz).addTo(zoneLayerGroup);
      });
    }
    if (layerVisibility.phz) {
      bowTieRing(lat, lon, brg, 0, 1.5, 0.8, 1.2).forEach(function (poly) {
        L.polygon(poly, ZONE_STYLE.phz).addTo(zoneLayerGroup);
      });
    }
  }

  L.circleMarker([lat, lon], { radius: 4, color: '#ffffff', weight: 2, fillColor: '#000000', fillOpacity: 1 })
    .bindTooltip(ap.icao + ' — ' + ap.nameTh, { permanent: false })
    .addTo(arpMarkerGroup);

  if (!ap.bearingVerified && zoneModel === 'bowtie') {
    L.circleMarker([lat, lon], { radius: 14, color: '#ffcc00', weight: 2, fill: false })
      .bindTooltip('⚠️ แนวรันเวย์ของสนามบินนี้ยังไม่ยืนยันจาก eAIP (ใช้ค่า placeholder)', { permanent: false })
      .addTo(arpMarkerGroup);
  }
}

var ZONE_LABELS = {
  bowtie: {
    phz: 'PHZ — เขตอันตรายหลัก', shz: 'SHZ — เขตอันตรายรอง',
    thz: 'THZ — เขตอันตรายลำดับสาม', lhz: 'LHZ — วง 13 กม.',
    note: 'โซนความเสี่ยง (PHZ/SHZ/THZ/LHZ) คำนวณจากพิกัดสนามบิน + แนวรันเวย์ ตามแนวคิดสไลด์ ICAO WHMC หน้า 12 ' +
      '(ตัวอย่างอินเดีย) — ใช้ได้ทั้ง 43 สนามบิน แนวรันเวย์บางแห่งยังไม่ยืนยันจาก eAIP (ดูเครื่องหมาย ⚠️)'
  },
  rings: {
    phz: 'Area A — 0-3 กม. (ห้ามพัฒนาแหล่งดึงดูดนก)', shz: 'Area B — 3-8 กม. (ต้องบรรเทาผลกระทบก่อนอนุมัติ)',
    thz: 'Area C — 8-13 กม. (เฝ้าระวัง)', lhz: 'ขอบเขตประกาศสาธารณะ 13 กม.',
    note: 'โมเดลวงแหวนศูนย์กลางจาก ARP ตาม Australia NASF Guideline C ("Managing the Risk of Wildlife Strikes ' +
      'in the Vicinity of Airports", Nov 2023) อ้างอิง ICAO Airport Services Manual + CASR Part 139 MOS — ' +
      'Area A/B ปรับขอบเขตได้ถ้ามีผู้เชี่ยวชาญ wildlife รับรอง (Area C ปรับไม่ได้ ผูกกับกฎหมาย) ' +
      'ผู้ดำเนินการสนามบินต้องประกาศ 3 โซนนี้เป็นสาธารณะ — โมเดลนี้เสนอเป็นแม่แบบสำหรับร่าง พ.ร.ก. เขตปลอดภัยการเดินอากาศ'
  }
};

function applyZoneLabels() {
  var L2 = ZONE_LABELS[zoneModel];
  ['phz', 'shz', 'thz', 'lhz'].forEach(function (key) {
    document.getElementById('label-' + key).textContent = L2[key];
  });
  document.getElementById('zone-model-note').textContent = L2.note;
}

// ---------------------------------------------------------------------------
// Heatmap — time-sliced (all-time / specific month / seasonal-summed) and
// optionally weighted by DamageStatus instead of raw incident count.
// ---------------------------------------------------------------------------

function seasonalGrid(mm) {
  var acc = {};
  MONTHS.forEach(function (mk) {
    if (mk.slice(5, 7) !== mm) return;
    HEATMAP_BY_MONTH[mk].forEach(function (r) {
      var key = r[0] + ',' + r[1];
      if (!acc[key]) acc[key] = [r[0], r[1], 0, 0];
      acc[key][2] += r[2];
      acc[key][3] += r[3];
    });
  });
  return Object.keys(acc).map(function (k) { return acc[k]; });
}

function currentGrid() {
  var slider = document.getElementById('time-slider');
  if (timeMode === 'all') return HEATMAP_DENSITY;
  if (timeMode === 'month') {
    var mk = MONTHS[parseInt(slider.value, 10)];
    return HEATMAP_BY_MONTH[mk] || [];
  }
  var mm = ('0' + parseInt(slider.value, 10)).slice(-2);
  return seasonalGrid(mm);
}

function computeMax(grid, idx) {
  var m = 0;
  for (var i = 0; i < grid.length; i++) if (grid[i][idx] > m) m = grid[i][idx];
  return m;
}

function updateHeatmap() {
  if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
  if (!layerVisibility.heat) return;
  var grid = currentGrid();
  var idx = weightedHeat ? 3 : 2;
  var points = grid.map(function (r) { return [r[0], r[1], r[idx]]; });
  var maxVal = Math.max(2, computeMax(grid, idx) * 0.22);
  heatLayer = L.heatLayer(points, { radius: 18, blur: 22, maxZoom: 14, max: maxVal }).addTo(map);
}

function updateTimeLabel() {
  var slider = document.getElementById('time-slider');
  var label = document.getElementById('time-slider-label');
  if (timeMode === 'all') { label.textContent = 'ทั้งหมด (2021-2025)'; return; }
  if (timeMode === 'month') {
    var mk = MONTHS[parseInt(slider.value, 10)];
    var y = mk.slice(0, 4), m = parseInt(mk.slice(5, 7), 10);
    label.textContent = MONTH_TH[m] + ' ' + y;
    return;
  }
  var m2 = parseInt(slider.value, 10);
  label.textContent = MONTH_TH[m2] + ' (รวมทุกปี 2021-2025 — ดูฤดูกาลพีค)';
}

function wireTimeControls() {
  var slider = document.getElementById('time-slider');
  document.querySelectorAll('input[name="time-mode"]').forEach(function (radio) {
    radio.addEventListener('change', function (e) {
      if (!e.target.checked) return;
      timeMode = e.target.value;
      if (timeMode === 'all') {
        slider.style.display = 'none';
      } else if (timeMode === 'month') {
        slider.style.display = '';
        slider.min = 0; slider.max = MONTHS.length - 1; slider.value = MONTHS.length - 1;
      } else {
        slider.style.display = '';
        slider.min = 1; slider.max = 12; slider.value = 3; // default March — one of the known peak months
      }
      updateTimeLabel();
      updateHeatmap();
    });
  });
  slider.addEventListener('input', function () { updateTimeLabel(); updateHeatmap(); });
}

// ---------------------------------------------------------------------------
// Land-use risk layer + known-attractor POIs (OSM Overpass, ODbL)
// ---------------------------------------------------------------------------

function buildLanduseLayer() {
  LANDUSE.forEach(function (row) {
    var st = LANDUSE_STYLE[row.kind];
    if (!st) return;
    L.circle([row.lat, row.lon], {
      radius: st.radius, color: st.color, weight: 1, fillColor: st.fillColor, fillOpacity: st.fillOpacity
    }).bindPopup(
      '<b>' + (row.name || '(ไม่ระบุชื่อ)') + '</b><br>' + LANDUSE_LABEL[row.kind] +
      '<br>ใกล้ ' + row.icaoNear + ' (~' + row.distKm + ' กม.)' +
      '<br><span style="font-size:11px;color:#888">ที่มา: OpenStreetMap — จุดศูนย์กลางโดยประมาณ ไม่ใช่ขอบเขตจริง</span>'
    ).addTo(landuseLayerGroup);
  });
}

function buildAttractorLayer() {
  ATTRACTORS.forEach(function (row) {
    var st = LANDUSE_STYLE[row.kind] || LANDUSE_STYLE.wetland;
    L.circleMarker([row.lat, row.lon], {
      radius: 9, color: '#ffd166', weight: 2, fillColor: st.fillColor, fillOpacity: 0.9
    }).bindTooltip('⚠️ ' + row.name, { permanent: false })
      .bindPopup(
        '<b>⚠️ ' + row.name + '</b><br>' + LANDUSE_LABEL[row.kind] +
        '<br>ใกล้สนามบิน ' + row.icaoNear + ' (~' + row.distKm + ' กม.) ซึ่งมีสถิตินกชนสูงในชุดข้อมูลนี้' +
        '<br><span style="font-size:11px;color:#888">แหล่งดึงดูดสัตว์ป่าที่อาจเกี่ยวข้อง — ข้อมูล OpenStreetMap, ยังไม่ได้ตรวจสอบภาคสนาม</span>'
      ).addTo(attractorLayerGroup);
  });
}

// ---------------------------------------------------------------------------
// Sidebar UI
// ---------------------------------------------------------------------------

var currentAirport = null;

function updateStatCard(icao) {
  var el = document.getElementById('airport-stat-card');
  var s = AIRPORT_STATS[icao];
  if (!s) {
    el.innerHTML = '<div class="stat-empty">ไม่มีเหตุการณ์บันทึกในชุดข้อมูลนี้ (2021-2025)</div>';
    return;
  }
  el.innerHTML =
    '<div class="stat-row"><span class="stat-label">รวมเหตุการณ์</span><span class="stat-value">' + s.total + '</span></div>' +
    '<div class="stat-row"><span class="stat-label">ช่วงบินที่พบบ่อยสุด</span><span class="stat-value">' + s.topPhase + ' (' + s.topPhaseCount + ')</span></div>' +
    '<div class="stat-row"><span class="stat-label">เดือนพีค</span><span class="stat-value">' + s.peakMonth + ' (' + s.peakMonthCount + ')</span></div>' +
    '<div class="stat-row"><span class="stat-label">มีความเสียหาย</span><span class="stat-value">' + s.damageCount + ' (' + s.damageRate + '%)</span></div>';
}

function selectAirport(ap) {
  currentAirport = ap;
  drawAirportZones(ap);
  map.setView([ap.lat, ap.lon], 11);
  document.querySelectorAll('.airport-item').forEach(function (el) {
    el.classList.toggle('active', el.dataset.icao === ap.icao);
  });
  document.getElementById('current-airport-label').textContent = ap.icao + ' — ' + ap.nameTh + ' / ' + ap.nameEn;
  updateStatCard(ap.icao);
}

function buildAirportList() {
  var list = document.getElementById('airport-list');
  var sorted = AIRPORTS.slice().sort(function (a, b) { return a.icao.localeCompare(b.icao); });
  sorted.forEach(function (ap) {
    var el = document.createElement('div');
    el.className = 'airport-item';
    el.dataset.icao = ap.icao;
    var n = AIRPORT_STATS[ap.icao] ? AIRPORT_STATS[ap.icao].total : 0;
    el.innerHTML = '<span class="icao">' + ap.icao + '</span><span class="name">' + ap.nameTh + '</span>' +
      (n ? '<span class="incident-count">' + n + '</span>' : '') +
      (ap.bearingVerified ? '' : ' <span class="unverified" title="แนวรันเวย์ยังไม่ยืนยัน">⚠️</span>');
    el.addEventListener('click', function () { selectAirport(ap); });
    list.appendChild(el);
  });
}

function wireLayerToggles() {
  ['phz', 'shz', 'thz', 'lhz'].forEach(function (key) {
    document.getElementById('toggle-' + key).addEventListener('change', function (e) {
      layerVisibility[key] = e.target.checked;
      if (currentAirport) drawAirportZones(currentAirport);
    });
  });
  document.getElementById('toggle-heat').addEventListener('change', function (e) {
    layerVisibility.heat = e.target.checked;
    updateHeatmap();
  });
  document.getElementById('toggle-weighted').addEventListener('change', function (e) {
    weightedHeat = e.target.checked;
    updateHeatmap();
  });
  document.getElementById('toggle-landuse').addEventListener('change', function (e) {
    if (e.target.checked) landuseLayerGroup.addTo(map); else map.removeLayer(landuseLayerGroup);
  });
  document.getElementById('toggle-attractors').addEventListener('change', function (e) {
    if (e.target.checked) attractorLayerGroup.addTo(map); else map.removeLayer(attractorLayerGroup);
  });
}

function wireZoneModelSwitch() {
  document.querySelectorAll('input[name="zone-model"]').forEach(function (radio) {
    radio.addEventListener('change', function (e) {
      if (!e.target.checked) return;
      zoneModel = e.target.value;
      applyZoneLabels();
      if (currentAirport) drawAirportZones(currentAirport);
    });
  });
}

function wireSearch() {
  document.getElementById('airport-search').addEventListener('input', function (e) {
    var q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('.airport-item').forEach(function (el) {
      var text = el.textContent.toLowerCase();
      el.style.display = text.indexOf(q) === -1 ? 'none' : '';
    });
  });
}

buildAirportList();
wireLayerToggles();
wireZoneModelSwitch();
wireTimeControls();
wireSearch();
buildLanduseLayer();
buildAttractorLayer();
attractorLayerGroup.addTo(map); // on by default (only 6 markers); landuse layer stays off until toggled
applyZoneLabels();
updateHeatmap();
selectAirport(AIRPORTS.find(function (a) { return a.icao === 'VTBS'; }) || AIRPORTS[0]);
