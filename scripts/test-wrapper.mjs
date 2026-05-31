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
  if (req.method === 'POST' && req.url === '/telemetry') {
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

// Patch the wrapper to use the test socket path (new arch: socket path is embedded, not passed via env)
const stdioWrapperPath = path.join(tmp, 'stdio-wrapper-test.js');
let stdioWrapperSrc = fs.readFileSync(wrapperPath, 'utf8');
stdioWrapperSrc = stdioWrapperSrc.replace('__DAEMON_SOCKET_PATH__', socketPath);
fs.writeFileSync(stdioWrapperPath, stdioWrapperSrc, 'utf8');

const wrappedEnv = {
  MYAI_REAL_SERVER: JSON.stringify({ command: 'node', args: [mockServerPath], env: {} }),
  MYAI_EXT_DIR: extDir,
  MYAI_CONFIG_PATH: configPath,
  MYAI_SERVER_NAME: 'mock',
};

const wrapper = spawn('node', [stdioWrapperPath], {
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
assert.equal(started.conversationId, undefined, 'tool_call_started without _meta should have no conversationId');
assert.equal(started.requestId, undefined, 'tool_call_started without _meta should have no requestId');

console.log('PASS test-wrapper (stdio mode)');

// ---------------------------------------------------------------------------
// Stdio mode — _meta session attribution
// Second wrapper process; this time the request includes _meta with VS Code IDs.
// ---------------------------------------------------------------------------

const metaTelemetryEvents = [];
const metaTelemetrySocket = path.join(tmp, 'meta-proxy.sock');
const metaTelemetryServer = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/telemetry') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      metaTelemetryEvents.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    return;
  }
  res.writeHead(404);
  res.end('not found');
});
await new Promise((resolve, reject) => {
  metaTelemetryServer.listen(metaTelemetrySocket, () => resolve());
  metaTelemetryServer.on('error', reject);
});

const metaWrapperPath = path.join(tmp, 'stdio-wrapper-meta-test.js');
let metaWrapperSrc = fs.readFileSync(wrapperPath, 'utf8');
metaWrapperSrc = metaWrapperSrc.replace('__DAEMON_SOCKET_PATH__', metaTelemetrySocket);
fs.writeFileSync(metaWrapperPath, metaWrapperSrc, 'utf8');

const metaWrapper = spawn('node', [metaWrapperPath], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    MYAI_REAL_SERVER: JSON.stringify({ command: 'node', args: [mockServerPath], env: {} }),
    MYAI_EXT_DIR: extDir,
    MYAI_CONFIG_PATH: configPath,
    MYAI_SERVER_NAME: 'mock',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});
metaWrapper.stderr.on('data', (c) => process.stderr.write('[meta-wrapper] ' + c.toString('utf8')));

const metaRequest = JSON.stringify({
  jsonrpc: '2.0',
  id: 10,
  method: 'tools/call',
  params: {
    name: 'attributed_tool',
    arguments: { x: 1 },
    _meta: {
      'vscode.conversationId': 'conv-abc-123',
      'vscode.requestId': 'req-xyz-456',
    },
  },
}) + '\n';

let metaStdout = '';
metaWrapper.stdout.on('data', (c) => { metaStdout += c.toString('utf8'); });
metaWrapper.stdin.write(metaRequest);

await new Promise((resolve, reject) => {
  const deadline = Date.now() + 5000;
  const interval = setInterval(() => {
    if (metaStdout.includes('"result"')) { clearInterval(interval); resolve(); return; }
    if (Date.now() > deadline) { clearInterval(interval); reject(new Error('Timed out waiting for meta-wrapper stdout response')); }
  }, 50);
});

// Send a second request without _meta to verify absence
const noMetaRequest = JSON.stringify({
  jsonrpc: '2.0',
  id: 11,
  method: 'tools/call',
  params: {
    name: 'plain_tool',
    arguments: {},
  },
}) + '\n';
metaWrapper.stdin.write(noMetaRequest);

await new Promise((resolve, reject) => {
  const deadline = Date.now() + 5000;
  const interval = setInterval(() => {
    if (metaTelemetryEvents.filter(e => e.type === 'tool_call_started').length >= 2) { clearInterval(interval); resolve(); return; }
    if (Date.now() > deadline) { clearInterval(interval); reject(new Error('Timed out waiting for second meta-wrapper telemetry event')); }
  }, 50);
});

metaWrapper.stdin.end();
await new Promise((resolve) => metaWrapper.on('exit', () => resolve()));
metaTelemetryServer.close();

const metaStarted = metaTelemetryEvents.find((e) => e.type === 'tool_call_started' && e.toolName === 'attributed_tool');
const metaCompleted = metaTelemetryEvents.find((e) => e.type === 'tool_call_completed' && e.toolName === 'attributed_tool');
const noMetaStarted = metaTelemetryEvents.find((e) => e.type === 'tool_call_started' && e.toolName === 'plain_tool');

assert.ok(metaStarted, 'expected tool_call_started for attributed_tool');
assert.equal(metaStarted.conversationId, 'conv-abc-123', 'tool_call_started should carry conversationId from _meta');
assert.equal(metaStarted.requestId, 'req-xyz-456', 'tool_call_started should carry requestId from _meta');
assert.ok(metaCompleted, 'expected tool_call_completed for attributed_tool');
assert.equal(metaCompleted.conversationId, 'conv-abc-123', 'tool_call_completed should echo conversationId');
assert.equal(metaCompleted.requestId, 'req-xyz-456', 'tool_call_completed should echo requestId');

assert.ok(noMetaStarted, 'expected tool_call_started for plain_tool');
assert.equal(noMetaStarted.conversationId, undefined, 'tool_call_started without _meta should have no conversationId');
assert.equal(noMetaStarted.requestId, undefined, 'tool_call_started without _meta should have no requestId');

console.log('PASS test-wrapper (_meta session attribution)');

// ---------------------------------------------------------------------------
// HTTP bridge mode — MYAI_REAL_URL
// When MYAI_REAL_URL is set the wrapper forwards JSON-RPC to the daemon proxy.
// ---------------------------------------------------------------------------

// Start a mock "daemon proxy" (TCP HTTP server) to receive the forwarded request
const bridgeEvents = [];
const mockDaemonProxy = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    try { bridgeEvents.push({ url: req.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')), headers: req.headers }); } catch { /* ignore */ }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'bridge result' }] } }));
  });
});
await new Promise((resolve, reject) => {
  mockDaemonProxy.listen(0, '127.0.0.1', () => resolve());
  mockDaemonProxy.on('error', reject);
});
const bridgeProxyPort = mockDaemonProxy.address().port;

const bridgeTelemetrySocket = path.join(tmp, 'bridge-proxy.sock');
const bridgeTelemetryEvents = [];
const bridgeTelemetryServer = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/telemetry') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      bridgeTelemetryEvents.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      res.writeHead(200); res.end('{}');
    });
  } else {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise((resolve, reject) => {
  bridgeTelemetryServer.listen(bridgeTelemetrySocket, () => resolve());
  bridgeTelemetryServer.on('error', reject);
});

const bridgeEnv = {
  MYAI_REAL_URL: `http://127.0.0.1:99999/ignored`, // upstream URL (will not be called directly in bridge mode)
  MYAI_SERVER_NAME: 'bridge-server',
  MYAI_EXT_DIR: extDir,
  MYAI_CONFIG_PATH: configPath,
};

// Override the daemon socket path and proxy port via the placeholder constants
const bridgeWrapperPath = path.join(tmp, 'bridge-wrapper.js');
let wrapperSrc = fs.readFileSync(path.join(process.cwd(), 'dist', 'proxy', 'stdio-wrapper.js'), 'utf8');
wrapperSrc = wrapperSrc.replace('__DAEMON_SOCKET_PATH__', bridgeTelemetrySocket);
wrapperSrc = wrapperSrc.replace(`parseInt('__DAEMON_PROXY_PORT__', 10)`, `parseInt('${bridgeProxyPort}', 10)`);
fs.writeFileSync(bridgeWrapperPath, wrapperSrc, 'utf8');

const bridgeWrapper = spawn('node', [bridgeWrapperPath], {
  cwd: process.cwd(),
  env: { ...process.env, ...bridgeEnv },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let bridgeStdout = '';
bridgeWrapper.stdout.on('data', c => { bridgeStdout += c.toString('utf8'); });
bridgeWrapper.stderr.on('data', c => process.stderr.write('[bridge-wrapper] ' + c.toString('utf8')));

const bridgeRequest = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bridged_tool', arguments: { test: 1 } } }) + '\n';
bridgeWrapper.stdin.write(bridgeRequest);

await new Promise((resolve, reject) => {
  const deadline = Date.now() + 5000;
  const interval = setInterval(() => {
    if (bridgeStdout.includes('"result"')) { clearInterval(interval); resolve(); return; }
    if (Date.now() > deadline) { clearInterval(interval); reject(new Error('Timed out waiting for bridge-wrapper stdout')); }
  }, 50);
});

bridgeWrapper.stdin.end();
await new Promise(resolve => bridgeWrapper.on('exit', () => resolve()));
mockDaemonProxy.close();
bridgeTelemetryServer.close();

assert.ok(bridgeEvents.length > 0, 'expected daemon proxy to receive forwarded request');
assert.equal(bridgeEvents[0].body?.params?.name, 'bridged_tool', 'forwarded request should have correct tool name');
assert.ok(bridgeStdout.includes('bridge result'), 'bridge result should appear in stdout');

const bridgeStarted = bridgeTelemetryEvents.find(e => e.type === 'tool_call_started');
const bridgeCompleted = bridgeTelemetryEvents.find(e => e.type === 'tool_call_completed');
assert.ok(bridgeStarted, 'expected tool_call_started telemetry in bridge mode');
assert.ok(bridgeCompleted, 'expected tool_call_completed telemetry in bridge mode');

console.log('PASS test-wrapper (HTTP bridge mode)');

// ---------------------------------------------------------------------------
// daemon.json fallback — DAEMON_SOCKET_PATH constant is unset; wrapper reads
// ~/.myai/daemon.json (we override HOME to a temp dir).
// ---------------------------------------------------------------------------

const fakeHome = path.join(tmp, 'fakehome');
const fakeDaemonDir = path.join(fakeHome, '.myai');
fs.mkdirSync(fakeDaemonDir, { recursive: true });

// Reuse the original socketPath mock server for telemetry (already started above)
// Write a fake daemon.json pointing to it
fs.writeFileSync(
  path.join(fakeDaemonDir, 'daemon.json'),
  JSON.stringify({ pid: process.pid, proxyPort: 7331, socketPath, startedAt: Date.now() }),
  'utf8',
);

// Use the original wrapper WITHOUT patching (constant stays as '__DAEMON_SOCKET_PATH__')
// The reachability check on the placeholder will fail, triggering the daemon.json fallback.
const fallbackTelemetryEvents = [];
const fallbackTelemetryServer = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/telemetry') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      fallbackTelemetryEvents.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      res.writeHead(200); res.end('{}');
    });
  } else {
    res.writeHead(404); res.end();
  }
});
const fallbackSocket = path.join(tmp, 'fallback.sock');
await new Promise((resolve, reject) => {
  fallbackTelemetryServer.listen(fallbackSocket, () => resolve());
  fallbackTelemetryServer.on('error', reject);
});

fs.writeFileSync(
  path.join(fakeDaemonDir, 'daemon.json'),
  JSON.stringify({ pid: process.pid, proxyPort: 7331, socketPath: fallbackSocket, startedAt: Date.now() }),
  'utf8',
);

const fallbackWrapper = spawn('node', [wrapperPath], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    HOME: fakeHome,
    MYAI_REAL_SERVER: JSON.stringify({ command: 'node', args: [mockServerPath], env: {} }),
    MYAI_EXT_DIR: extDir,
    MYAI_CONFIG_PATH: configPath,
    MYAI_SERVER_NAME: 'fallback-server',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});
fallbackWrapper.stderr.on('data', c => process.stderr.write('[fallback-wrapper] ' + c.toString('utf8')));

let fallbackStdout = '';
fallbackWrapper.stdout.on('data', c => { fallbackStdout += c.toString('utf8'); });
fallbackWrapper.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fallback_tool', arguments: {} } }) + '\n');

await new Promise((resolve, reject) => {
  const deadline = Date.now() + 5000;
  const interval = setInterval(() => {
    if (fallbackStdout.includes('"result"')) { clearInterval(interval); resolve(); return; }
    if (Date.now() > deadline) { clearInterval(interval); reject(new Error('Timed out waiting for fallback-wrapper stdout')); }
  }, 50);
});

fallbackWrapper.stdin.end();
await new Promise(resolve => fallbackWrapper.on('exit', () => resolve()));
fallbackTelemetryServer.close();

const fbStarted = fallbackTelemetryEvents.find(e => e.type === 'tool_call_started');
const fbCompleted = fallbackTelemetryEvents.find(e => e.type === 'tool_call_completed');
assert.ok(fbStarted, 'expected tool_call_started telemetry via daemon.json fallback');
assert.ok(fbCompleted, 'expected tool_call_completed telemetry via daemon.json fallback');

console.log('PASS test-wrapper (daemon.json fallback mode)');
