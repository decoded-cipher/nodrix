// Sensor side — HTTP telemetry.
//
// Two devices POST temperature + humidity every INTERVAL_MS. This feeds the
// iot-value, iot-gauge, and iot-chart widgets in the dashboard.
//
// The labels below ("home", "office") are local console tags only — device
// identity comes from the token.

import axios from 'axios';

const HOST = required('NODRIX_HOST');
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 5000);
const ENDPOINT = `https://${HOST}/v1/telemetry`;

const sensors = [
  { id: 'home',   token: required('HOME_TOKEN'),   state: { temperature: 24, humidity: 55 } },
  { id: 'office', token: required('OFFICE_TOKEN'), state: { temperature: 22, humidity: 50 } },
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

async function post(sensor) {
  sensor.state.temperature = drift(sensor.state.temperature, 18, 32);
  sensor.state.humidity    = drift(sensor.state.humidity, 30, 80);
  try {
    await axios.post(
      ENDPOINT,
      { metrics: sensor.state },
      { headers: { Authorization: `Bearer ${sensor.token}` }, timeout: 10_000 }
    );
    console.log(`[sensor:${sensor.id}] temp=${sensor.state.temperature}°C  hum=${sensor.state.humidity}%`);
  } catch (e) {
    const err = e.response ? `${e.response.status} ${JSON.stringify(e.response.data)}` : e.message;
    console.error(`[sensor:${sensor.id}] ✗ ${err}`);
  }
}

console.log(`▶ telemetry → ${ENDPOINT}  every ${INTERVAL_MS}ms  (${sensors.map(s => s.id).join(', ')})`);
sensors.forEach(post);
const tick = setInterval(() => sensors.forEach(post), INTERVAL_MS);

process.on('SIGINT', () => { clearInterval(tick); console.log('\nstopped.'); process.exit(0); });
