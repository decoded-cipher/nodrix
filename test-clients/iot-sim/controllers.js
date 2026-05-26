// Controller side — WebSocket control + state echo.
//
// Connects to the worker's control WS and prints (i.e. "applies") whatever
// variable writes come in from dashboard widgets. After applying, POSTs the new
// value back as telemetry under the SAME variable key — that's how toggles and
// sliders subscribe for state, so retention works on refresh.
//
// Demonstrates the three control widget types:
//
//   power      — iot-toggle  ("on" / "off")
//   restart    — iot-push    (one-shot, no echo)
//   brightness — iot-slider  (numeric)
//
// The keys in `handlers` below must match the "Variable" field of the
// corresponding widget in your dashboard — rename freely. Replace the body
// of each handler with a GPIO write / serial / MQTT publish for real hardware.
// Acks each write so the worker stops retrying.

import WebSocket from 'ws';
import axios from 'axios';

const HOST = required('NODRIX_HOST');
const TOKEN = required('NODRIX_TOKEN');
const URL = `wss://${HOST}/v1/control/ws?token=${encodeURIComponent(TOKEN)}`;
const TELEMETRY = `https://${HOST}/v1/telemetry`;

function required(name) {
  const v = process.env[name];
  if (!v) { console.error(`[controllers] missing env var: ${name}`); process.exit(1); }
  return v;
}

// Local mirror of state. Echoed back as telemetry after each write so the
// dashboard widget stays in sync.
const state = {
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
    state.power = String(value);
    console.log(`  → power = ${state.power}`);
    echo({ power: state.power });
  },
  restart() {
    // One-shot — no state to echo.
    console.log(`  → restart! (e.g. trigger a scene, reset a counter, kick a script)`);
  },
  brightness(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    state.brightness = Math.round(n);
    console.log(`  → brightness = ${state.brightness}`);
    echo({ brightness: state.brightness });
  },
};

function apply(variable, value) {
  const fn = handlers[variable];
  if (fn) fn(value);
  else console.log(`  → (no handler for "${variable}" — add one if your widget uses this variable)`);
}

let stopped = false;
let backoffMs = 500;

function connect() {
  if (stopped) return;
  const ws = new WebSocket(URL);

  ws.on('open', () => {
    backoffMs = 500;
    console.log(`[ws] connected as controller — waiting for control writes…`);
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type !== 'control') return;
    console.log(`[ws] control "${msg.variable}" = ${JSON.stringify(msg.value)}`);
    apply(msg.variable, msg.value);
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

console.log(`▶ control ← ${URL.replace(/token=[^&]+/, 'token=…')}`);
connect();

process.on('SIGINT', () => { stopped = true; console.log('\nstopped.'); process.exit(0); });
