// Controller side — WebSocket commands.
//
// Connects to the worker's device WS and prints (i.e. "applies") whatever
// commands come in from dashboard widgets. Handles three command names:
//
//   power      — from iot-toggle widget        ("on" / "off")
//   push       — from iot-push widget          (one-shot)
//   brightness — from iot-slider widget        (0–100)
//
// Replace the apply* functions with GPIO writes / serial / MQTT publishes
// for a real device. Acks each command so the worker stops retrying.

import WebSocket from 'ws';

const HOST = required('NODRIX_HOST');
const TOKEN = required('CONTROLLER_TOKEN');
const URL = `wss://${HOST}/v1/devices/ws?token=${encodeURIComponent(TOKEN)}`;

function required(name) {
  const v = process.env[name];
  if (!v) { console.error(`[controllers] missing env var: ${name}`); process.exit(1); }
  return v;
}

// Local mirror of "device" state. Just enough so we can show the effect of
// each command in the log.
const device = {
  power: 'off',
  brightness: 0,
};

const handlers = {
  power(value) {
    device.power = String(value);
    console.log(`  → power = ${device.power}`);
  },
  push() {
    // One-shot — no payload meaning. Treat as "the user pressed the button".
    console.log(`  → push! (e.g. trigger a scene, reset a counter, kick a script)`);
  },
  brightness(value) {
    const n = Number(value);
    if (Number.isFinite(n)) {
      device.brightness = Math.round(n);
      console.log(`  → brightness = ${device.brightness}`);
    }
  },
};

function apply(name, value) {
  const fn = handlers[name];
  if (fn) fn(value);
  else console.log(`  → (unknown command "${name}", value=${JSON.stringify(value)})`);
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
