// Sensor side — HTTP telemetry.
//
// Two cluster nodes POST temperature + humidity every INTERVAL_MS using one
// shared PROJECT token. With no per-device identity, each node namespaces its
// readings into distinct variable keys (home_*, office_*). This feeds the
// iot-value, iot-gauge, and iot-chart widgets in the dashboard.

import axios from 'axios';

const HOST = required('NODRIX_HOST');
const TOKEN = required('NODRIX_TOKEN');
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 5000);
const ENDPOINT = `https://${HOST}/v1/telemetry`;

// Each node writes namespaced variable keys; the project auto-creates them on
// first POST. Rename freely — whatever keys you send become variables.
const nodes = [
  { id: 'home',   temperature: 24, humidity: 55 },
  { id: 'office', temperature: 22, humidity: 50 },
];

function required(name) {
  const v = process.env[name];
  if (!v) { console.error(`[sensors] missing env var: ${name}`); process.exit(1); }
  return v;
}

// Small random walk inside [min,max] — looks like realistic drift on the chart,
// not the spiky noise you get with pure Math.random().
function drift(prev, min, max, step = 0.5) {
  const v = prev + (Math.random() - 0.5) * step * 2;
  return parseFloat(Math.max(min, Math.min(max, v)).toFixed(1));
}

async function post(node) {
  node.temperature = drift(node.temperature, 18, 32);
  node.humidity    = drift(node.humidity, 30, 80);
  const metrics = {
    [`${node.id}_temperature`]: node.temperature,
    [`${node.id}_humidity`]: node.humidity,
  };
  try {
    await axios.post(
      ENDPOINT,
      { metrics },
      { headers: { Authorization: `Bearer ${TOKEN}` }, timeout: 10_000 }
    );
    console.log(`[node:${node.id}] temp=${node.temperature}°C  hum=${node.humidity}%`);
  } catch (e) {
    const err = e.response ? `${e.response.status} ${JSON.stringify(e.response.data)}` : e.message;
    console.error(`[node:${node.id}] ✗ ${err}`);
  }
}

console.log(`▶ telemetry → ${ENDPOINT}  every ${INTERVAL_MS}ms  (${nodes.map(n => n.id).join(', ')})`);
nodes.forEach(post);
const tick = setInterval(() => nodes.forEach(post), INTERVAL_MS);

process.on('SIGINT', () => { clearInterval(tick); console.log('\nstopped.'); process.exit(0); });
