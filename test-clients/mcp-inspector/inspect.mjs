// No args → Inspector UI. With args → --cli mode (e.g. --method tools/list).

import { spawn } from 'node:child_process';

const { MCP_URL, MCP_BEARER } = process.env;
if (!MCP_URL || !MCP_BEARER) {
  console.error('Missing MCP_URL or MCP_BEARER. Copy .env.example → .env and fill in.');
  process.exit(1);
}

const header = `Authorization: Bearer ${MCP_BEARER}`;
const passthrough = process.argv.slice(2);
const baseArgs = ['@modelcontextprotocol/inspector'];
const transportArgs = ['--transport', 'http', MCP_URL, '--header', header];

const args =
  passthrough.length === 0
    ? [...baseArgs, ...transportArgs]
    : [...baseArgs, '--cli', MCP_URL, '--transport', 'http', '--header', header, ...passthrough];

spawn('bunx', args, { stdio: 'inherit', shell: false }).on('exit', (c) => process.exit(c ?? 0));
