import axios from 'axios';

const ENDPOINT = required('NODRIX_ENDPOINT');
const INTERVAL_MS = Number(required('INTERVAL_MS'));

const devices = [
  { id: 'device_001', token: required('DEVICE_001_TOKEN') },
  { id: 'device_002', token: required('DEVICE_002_TOKEN') },
];

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var: ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return v;
}

function randomFloat(min, max, decimals = 1) {
  const v = Math.random() * (max - min) + min;
  return parseFloat(v.toFixed(decimals));
}

async function sendTelemetry(device) {
  const metrics = {
    temperature: randomFloat(18, 32),
    humidity: randomFloat(30, 80),
  };
  const ts = new Date().toISOString();
  try {
    await axios.post(
      ENDPOINT,
      { metrics },
      {
        headers: { Authorization: `Bearer ${device.token}` },
        timeout: 10_000,
      }
    );
    console.log(`[${ts}] ${device.id} ✓ temp=${metrics.temperature}°C hum=${metrics.humidity}%`);
  } catch (err) {
    const msg = err.response
      ? `${err.response.status} ${JSON.stringify(err.response.data)}`
      : err.message;
    console.error(`[${ts}] ${device.id} ✗ ${msg}`);
  }
}

console.log(`Simulating ${devices.length} devices → ${ENDPOINT}`);
console.log(`Interval: ${INTERVAL_MS}ms. Ctrl+C to stop.\n`);

devices.forEach((d) => sendTelemetry(d));
const interval = setInterval(() => devices.forEach((d) => sendTelemetry(d)), INTERVAL_MS);

process.on('SIGINT', () => {
  clearInterval(interval);
  console.log('\nStopped.');
  process.exit(0);
});
