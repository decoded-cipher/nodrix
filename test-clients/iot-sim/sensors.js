// Sensor side — HTTP telemetry for the Greenhouse "Tunnel A" dashboard.
//
// Simulates one greenhouse tunnel posting air temp, humidity, battery, and
// uptime every INTERVAL_MS using the project token. Each key auto-creates a
// variable on first POST. These feed the iot-value, iot-gauge, and iot-chart
// widgets on the Tunnel A dashboard.

import axios from 'axios';

const HOST = required('NODRIX_HOST');
const TOKEN = required('NODRIX_TOKEN');
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 5000);
const ENDPOINT = `https://${HOST}/v1/telemetry`;

const STARTED_AT = Date.now();

const tunnel = {
  air_temp: 23.4,
  humidity: 61,
  battery: 78,
};

function required(name) {
  const v = process.env[name];
  if (!v) { console.error(`[sensors] missing env var: ${name}`); process.exit(1); }
  return v;
}

// Small random walk inside [min,max] — realistic drift, not spiky noise.
function drift(prev, min, max, step = 0.5) {
  const v = prev + (Math.random() - 0.5) * step * 2;
  return parseFloat(Math.max(min, Math.min(max, v)).toFixed(1));
}

async function post() {
  tunnel.air_temp = drift(tunnel.air_temp, 18, 30, 0.4);
  tunnel.humidity = drift(tunnel.humidity, 45, 80, 1.2);
  // Battery slowly drains; clamps so it doesn't hit 0 during a long run.
  tunnel.battery  = drift(tunnel.battery, 20, 100, 0.15);

  const uptime_hours = parseFloat(((Date.now() - STARTED_AT) / 3_600_000).toFixed(2));

  const metrics = {
    air_temp: tunnel.air_temp,
    humidity: tunnel.humidity,
    battery: tunnel.battery,
    uptime_hours,
  };
  try {
    await axios.post(
      ENDPOINT,
      { metrics },
      { headers: { Authorization: `Bearer ${TOKEN}` }, timeout: 10_000 }
    );
    console.log(`[tunnel-a] temp=${tunnel.air_temp}°C  hum=${tunnel.humidity}%  bat=${tunnel.battery}%  uptime=${uptime_hours}h`);
  } catch (e) {
    const err = e.response ? `${e.response.status} ${JSON.stringify(e.response.data)}` : e.message;
    console.error(`[tunnel-a] ✗ ${err}`);
  }
}

console.log(`▶ telemetry → ${ENDPOINT}  every ${INTERVAL_MS}ms  (tunnel-a)`);
post();
const tick = setInterval(post, INTERVAL_MS);

process.on('SIGINT', () => { clearInterval(tick); console.log('\nstopped.'); process.exit(0); });
