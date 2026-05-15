#!/usr/bin/env node
import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'myai-wrapper-test-'));
const socketPath = path.join(tmp, 'proxy.sock');
const extDir = path.join(tmp, 'ext');
fs.mkdirSync(extDir, { recursive: true });

const telemetryEvents = [];
const telemetryServer = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/internal/telemetry') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      telemetryEvents.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

await new Promise((resolve, reject) => {
  telemetryServer.listen(socketPath, () => resolve());
  telemetryServer.on('error', reject);
});

const mockServerPath = path.join(tmp, 'mock-stdio-server.mjs');
fs.writeFileSync(
  mockServerPath,
  [
    "process.stdin.setEncoding('utf8');",
    "let buf = '';",
    "process.stdin.on('data', (chunk) => {",
    "  buf += chunk;",
    "  let idx;",
    "  while ((idx = buf.indexOf('\\n')) !== -1) {",
    "    const line = buf.slice(0, idx).trim();",
    "    buf = buf.slice(idx + 1);",
    "    if (!line) continue;",
    "    const msg = JSON.parse(line);",
    "    const response = { jsonrpc: '2.0', id: msg.id, result: { ok: true } };",
    "    process.stdout.write(JSON.stringify(response) + '\\n');",
    "  }",
    "});",
  ].join('\n'),
  'utf8',
);

const configPath = path.join(tmp, 'mcp.json');
const wrapperPath = path.join(process.cwd(), 'dist', 'proxy', 'stdio-wrapper.js');

const wrappedEnv = {
  MYAI_REAL_SERVER: JSON.stringify({ command: 'node', args: [mockServerPath], env: {} }),
  MYAI_IPC_SOCKET: socketPath,
  MYAI_EXT_DIR: extDir,
  MYAI_CONFIG_PATH: configPath,
  MYAI_SERVER_NAME: 'mock',
};

const wrapper = spawn('node', [wrapperPath], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ...wrappedEnv,
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

const request = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: {
    name: 'echo',
    arguments: { hello: 'world' },
  },
}) + '\n';

let stdout = '';
wrapper.stdout.on('data', (chunk) => {
  stdout += chunk.toString('utf8');
});

wrapper.stdin.write(request);

await new Promise((resolve, reject) => {
  const deadline = Date.now() + 5000;
  const interval = setInterval(() => {
    if (stdout.includes('"result"')) {
      clearInterval(interval);
      resolve();
      return;
    }
    if (Date.now() > deadline) {
      clearInterval(interval);
      reject(new Error('Timed out waiting for wrapper stdout response'));
    }
  }, 50);
});

wrapper.stdin.end();
await new Promise((resolve) => wrapper.on('exit', () => resolve()));
telemetryServer.close();

const started = telemetryEvents.find((event) => event.type === 'tool_call_started');
const completed = telemetryEvents.find((event) => event.type === 'tool_call_completed');

assert.ok(started, 'expected tool_call_started telemetry');
assert.ok(completed, 'expected tool_call_completed telemetry');

console.log('PASS test-wrapper');
