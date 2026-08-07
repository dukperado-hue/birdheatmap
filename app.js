/**
 * Thailand Airport Bird-Strike Hazard Map — offline Leaflet app.
 *
 * Zone geometry (PHZ/SHZ/THZ bow-tie inside a 13km LHZ circle, oriented along
 * the runway bearing) mirrors the Earth Engine version at gee/thai_airport_hazard_map.js
 * but is computed here in plain client-side JS -- no Google/Earth Engine account
 * needed, works by opening this folder's index.html directly (file://).
 *
 * The one thing that still needs internet is the OpenStreetMap basemap tiles.
 * Everything else (Leaflet, the zone math, the airport list, the heatmap) is
 * bundled locally in web/vendor and web/data.js.
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
var heatLayer = null;

var layerVisibility = { phz: true, shz: true, thz: true, lhz: true, heat: true };
var zoneModel = 'bowtie'; // 'bowtie' (India, runway-oriented) | 'rings' (Australia NASF, ARP-centered)

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

function updateHeatmap() {
  if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
  if (!layerVisibility.heat) return;
  var points = HEATMAP_DENSITY.map(function (r) { return [r[0], r[1], r[2]]; });
  heatLayer = L.heatLayer(points, { radius: 18, blur: 22, maxZoom: 14, max: 20 }).addTo(map);
}

// ---------------------------------------------------------------------------
// Sidebar UI
// ---------------------------------------------------------------------------

var currentAirport = null;

function selectAirport(ap) {
  currentAirport = ap;
  drawAirportZones(ap);
  map.setView([ap.lat, ap.lon], 11);
  document.querySelectorAll('.airport-item').forEach(function (el) {
    el.classList.toggle('active', el.dataset.icao === ap.icao);
  });
  document.getElementById('current-airport-label').textContent = ap.icao + ' — ' + ap.nameTh + ' / ' + ap.nameEn;
}

function buildAirportList() {
  var list = document.getElementById('airport-list');
  var sorted = AIRPORTS.slice().sort(function (a, b) { return a.icao.localeCompare(b.icao); });
  sorted.forEach(function (ap) {
    var el = document.createElement('div');
    el.className = 'airport-item';
    el.dataset.icao = ap.icao;
    el.innerHTML = '<span class="icao">' + ap.icao + '</span><span class="name">' + ap.nameTh + '</span>' +
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
wireSearch();
applyZoneLabels();
updateHeatmap();
selectAirport(AIRPORTS.find(function (a) { return a.icao === 'VTBS'; }) || AIRPORTS[0]);
