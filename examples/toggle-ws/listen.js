// Minimal device-side WebSocket listener for nodrix command pushes.
//
// Opens a single WS to the worker authenticated by Bearer token. Whenever a
// dashboard widget (e.g. Toggle) issues a command for this device, the worker
// pushes `{ type: 'command', id, name, value }` over the socket and we
// console.log it. We ack the id so the worker marks it delivered.

import WebSocket from 'ws';

const HOST = required('NODRIX_HOST');         // e.g. nodrix.acct.workers.dev
const TOKEN = required('DEVICE_TOKEN');
const URL = `wss://${HOST}/v1/devices/ws?token=${encodeURIComponent(TOKEN)}`;

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var: ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return v;
}

const ts = () => new Date().toISOString();

let stopped = false;
let backoffMs = 500;

function connect() {
  if (stopped) return;
  const ws = new WebSocket(URL);

  ws.on('open', () => {
    backoffMs = 500;
    console.log(`[${ts()}] connected — waiting for commands…`);
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type !== 'command') return;

    // ↓ This is the print-on-toggle moment. Replace with GPIO write, MQTT
    //   publish, serial command, etc. for a real device.
    console.log(`[${ts()}] command "${msg.name}" = ${JSON.stringify(msg.value)}`);

    try {
      ws.send(JSON.stringify({ type: 'ack', ids: [msg.id] }));
    } catch { /* socket may be closing; will reconnect */ }
  });

  ws.on('close', (code, reason) => {
    console.error(`[${ts()}] closed (${code} ${reason?.toString() ?? ''})`);
    if (stopped) return;
    const delay = Math.min(15_000, backoffMs);
    backoffMs = Math.min(15_000, backoffMs * 2);
    setTimeout(connect, delay);
  });

  ws.on('error', (err) => {
    console.error(`[${ts()}] error: ${err.message}`);
    // 'close' fires after this; reconnection handled there.
  });
}

console.log(`Listening for commands on wss://${HOST}/v1/devices/ws`);
console.log(`Ctrl+C to stop.\n`);
connect();

process.on('SIGINT', () => {
  stopped = true;
  console.log('\nStopped.');
  process.exit(0);
});
