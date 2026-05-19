// Controller side — WebSocket commands + state echo.
//
// Connects to the worker's device WS and prints (i.e. "applies") whatever
// commands come in from dashboard widgets. After applying, POSTs the new
// state back as telemetry under the SAME name as the command — that's how
// toggles and sliders subscribe for state, so retention works on refresh.
//
// Demonstrates the three control widget types:
//
//   power      — iot-toggle  ("on" / "off")
//   push       — iot-push    (one-shot, no value — no echo)
//   brightness — iot-slider  (numeric)
//
// The keys in `handlers` below must match the "Command name" field of the
// corresponding widget in your dashboard — rename freely. Replace the body
// of each handler with a GPIO write / serial / MQTT publish for a real
// device. Acks each command so the worker stops retrying.

import WebSocket from 'ws';
import axios from 'axios';

const HOST = required('NODRIX_HOST');
const TOKEN = required('CONTROLLER_TOKEN');
const URL = `wss://${HOST}/v1/devices/ws?token=${encodeURIComponent(TOKEN)}`;
const TELEMETRY = `https://${HOST}/v1/telemetry`;

function required(name) {
  const v = process.env[name];
  if (!v) { console.error(`[controllers] missing env var: ${name}`); process.exit(1); }
  return v;
}

// Local mirror of "device" state. Echoed back as telemetry after each
// command so the dashboard's State Metric stays in sync.
const device = {
  power: 'off',
  brightness: 0,
};

async function echo(metrics) {
  try {
    await axios.post(TELEMETRY, { metrics }, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      timeout: 10_000,
    });
  } catch (e) {
    const err = e.response ? `${e.response.status} ${JSON.stringify(e.response.data)}` : e.message;
    console.error(`  ✗ echo telemetry failed: ${err}`);
  }
}

const handlers = {
  power(value) {
    device.power = String(value);
    console.log(`  → power = ${device.power}`);
    echo({ power: device.power });
  },
  push() {
    // One-shot — no state to echo.
    console.log(`  → push! (e.g. trigger a scene, reset a counter, kick a script)`);
  },
  brightness(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    device.brightness = Math.round(n);
    console.log(`  → brightness = ${device.brightness}`);
    echo({ brightness: device.brightness });
  },
};

function apply(name, value) {
  const fn = handlers[name];
  if (fn) fn(value);
  else console.log(`  → (no handler for "${name}" — add one if your widget uses this command name)`);
}

let stopped = false;
let backoffMs = 500;

function connect() {
  if (stopped) return;
  const ws = new WebSocket(URL);

  ws.on('open', () => {
    backoffMs = 500;
    console.log(`[ws] connected as controller — waiting for commands…`);
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type !== 'command') return;
    console.log(`[ws] command "${msg.name}" = ${JSON.stringify(msg.value)}`);
    apply(msg.name, msg.value);
    try { ws.send(JSON.stringify({ type: 'ack', ids: [msg.id] })); } catch {}
  });

  ws.on('close', (code, reason) => {
    if (stopped) return;
    const delay = backoffMs;
    backoffMs = Math.min(15_000, backoffMs * 2);
    console.error(`[ws] closed (${code} ${reason?.toString() ?? ''}); reconnecting in ${delay}ms`);
    setTimeout(connect, delay);
  });

  ws.on('error', (err) => console.error(`[ws] error: ${err.message}`));
}

console.log(`▶ commands ← ${URL.replace(/token=[^&]+/, 'token=…')}`);
connect();

process.on('SIGINT', () => { stopped = true; console.log('\nstopped.'); process.exit(0); });
