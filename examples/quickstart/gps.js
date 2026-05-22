// GPS side — HTTP telemetry for the iot-map widget.
//
// Simulates moving assets. Each asset POSTs lat/lng (+ speed) every INTERVAL_MS
// using the shared PROJECT token, namespacing its readings into distinct
// variable keys (truck1_*, truck2_*). The keys auto-create on first POST.
//
// Wire it up on the dashboard: add a Map widget, then for each asset add a
// marker with
//   Source = Lat/Lng variables,  lat = truck1_lat,  lng = truck1_lng,
//   value variable = truck1_speed.
// With "Auto-fit to markers" on, the map frames both trucks and follows them.

import axios from 'axios';

const HOST = required('NODRIX_HOST');
const TOKEN = required('NODRIX_TOKEN');
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 3000);
const ENDPOINT = `https://${HOST}/v1/telemetry`;

// Each asset walks from its start point. Heading in radians; speed in km/h.
// Starting around Kochi, Kerala, India.
const assets = [
  { id: 'truck1', lat: 9.9312, lng: 76.2673, heading: rad(45), speed: 35, color: 'orange' },
  { id: 'truck2', lat: 9.9658, lng: 76.2999, heading: rad(200), speed: 28, color: 'blue' },
];

// Keep the assets roughly within ~5km of Kochi, Kerala so they don't wander off.
const CENTER = { lat: 9.9312, lng: 76.2673 };
const MAX_KM = 5;

function required(name) {
  const v = process.env[name];
  if (!v) { console.error(`[gps] missing env var: ${name}`); process.exit(1); }
  return v;
}

function rad(deg) { return (deg * Math.PI) / 180; }

// Small bounded random walk — realistic drift, not spiky noise.
function drift(prev, min, max, step) {
  const v = prev + (Math.random() - 0.5) * step * 2;
  return Math.max(min, Math.min(max, v));
}

// Distance in km between two {lat,lng} (flat-earth approximation; fine at city scale).
function kmBetween(p, q) {
  const dLat = (p.lat - q.lat) * 111.32;
  const dLng = (p.lng - q.lng) * 111.32 * Math.cos(rad((p.lat + q.lat) / 2));
  return Math.hypot(dLat, dLng);
}

// Advance one asset along its heading at its current speed for one tick.
// Bearing convention: 0 = north (+lat), 90° = east (+lng).
function step(a) {
  a.speed = drift(a.speed, 10, 60, 4);          // km/h
  a.heading += (Math.random() - 0.5) * rad(40); // gentle turns

  const dtHours = INTERVAL_MS / 3_600_000;
  const distKm = a.speed * dtHours;
  a.lat += (distKm / 111.32) * Math.cos(a.heading);
  a.lng += (distKm / (111.32 * Math.cos(rad(a.lat)))) * Math.sin(a.heading);

  // Drifted too far? Steer back toward the center.
  if (kmBetween(a, CENTER) > MAX_KM) {
    a.heading = Math.atan2(CENTER.lng - a.lng, CENTER.lat - a.lat);
  }
}

async function post(a) {
  step(a);
  const metrics = {
    [`${a.id}_lat`]: parseFloat(a.lat.toFixed(6)),
    [`${a.id}_lng`]: parseFloat(a.lng.toFixed(6)),
    [`${a.id}_speed`]: parseFloat(a.speed.toFixed(1)),
  };
  try {
    await axios.post(
      ENDPOINT,
      { metrics },
      { headers: { Authorization: `Bearer ${TOKEN}` }, timeout: 10_000 }
    );
    console.log(`[${a.id}] ${metrics[`${a.id}_lat`]}, ${metrics[`${a.id}_lng`]}  ${a.speed.toFixed(0)} km/h`);
  } catch (e) {
    const err = e.response ? `${e.response.status} ${JSON.stringify(e.response.data)}` : e.message;
    console.error(`[${a.id}] ✗ ${err}`);
  }
}

console.log(`▶ gps → ${ENDPOINT}  every ${INTERVAL_MS}ms  (${assets.map((a) => a.id).join(', ')})`);
assets.forEach(post);
const tick = setInterval(() => assets.forEach(post), INTERVAL_MS);

process.on('SIGINT', () => { clearInterval(tick); console.log('\nstopped.'); process.exit(0); });
