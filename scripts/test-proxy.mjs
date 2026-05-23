#!/usr/bin/env node
/**
 * scripts/test-proxy.mjs
 *
 * End-to-end smoke test for the shared IPC daemon and HTTP proxy.
 *
 * Scenarios:
 *   1. Start daemon, wait for socket to be ready.
 *   2. Register an instance and verify it appears in GET /connections.
 *   3. Subscribe to SSE /events; POST /telemetry and confirm event is broadcast.
 *   4. POST /heartbeat and verify 200 response.
 *   5. Start a mock HTTP upstream; route a tools/call through the TCP proxy;
 *      verify HTTP response and that tool_call_started / tool_call_completed
 *      events arrive on the SSE stream.
 *   6. Deregister and clean up.
 *
 * Usage:
 *   node scripts/test-proxy.mjs
 *
 * Prerequisites:
 *   npm run build
 */

import http from 'http';
import net from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

const HOME = os.homedir();
const SOCKET = path.join(HOME, '.myai', 'ipc.sock');
const INSTANCE_ID = 'proxy-test-' + Date.now();
const log = (...args) => console.log('[test-proxy]', ...args);
const fail = (msg) => { console.error('[test-proxy] FAIL:', msg); process.exit(1); };

// ---------------------------------------------------------------------------
// IPC helpers (communicate with daemon over Unix socket)
// ---------------------------------------------------------------------------

function post(socketPath, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      { socketPath, path: urlPath, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function get(socketPath, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: urlPath, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    });
    req.on('error', reject);
    req.end();
  });
}

function waitForSocket(socketPath, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    function attempt() {
      const sock = net.createConnection(socketPath);
      sock.setTimeout(300);
      sock.on('connect', () => { sock.destroy(); resolve(true); });
      sock.on('error', () => { sock.destroy(); if (Date.now() > deadline) resolve(false); else setTimeout(attempt, 200); });
      sock.on('timeout', () => { sock.destroy(); if (Date.now() > deadline) resolve(false); else setTimeout(attempt, 200); });
    }
    attempt();
  });
}

// ---------------------------------------------------------------------------
// SSE subscriber — returns an event array that is filled as events arrive
// ---------------------------------------------------------------------------

function subscribeEvents(socketPath, instanceId) {
  const events = [];
  const req = http.request(
    { socketPath, path: `/events?instanceId=${encodeURIComponent(instanceId)}`, method: 'GET' },
    (res) => {
      let buf = '';
      res.on('data', chunk => {
        buf += chunk.toString();
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          if (!part.trim() || part.startsWith(':')) continue;
          const line = part.split('\n').find(l => l.startsWith('data: '));
          if (line) {
            try { events.push(JSON.parse(line.slice(6))); } catch { /* ignore malformed */ }
          }
        }
      });
    },
  );
  req.on('error', () => { /* reconnect handled by test */ });
  req.end();
  return { events, req };
}

function waitForEvent(events, predicate, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function check() {
      const match = events.find(predicate);
      if (match) return resolve(match);
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for SSE event'));
      setTimeout(check, 50);
    }
    check();
  });
}

// ---------------------------------------------------------------------------
// Mock HTTP upstream (for proxy routing test)
// ---------------------------------------------------------------------------

function startMockServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = {}; }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id ?? 1,
          result: { content: [{ type: 'text', text: 'mock-ok' }], echoed: body?.params?.arguments ?? {} },
        }));
      });
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      log(`Mock upstream on 127.0.0.1:${port}`);
      resolve({ server, port });
    });
  });
}

// ---------------------------------------------------------------------------
// TCP proxy helper
// ---------------------------------------------------------------------------

function callThroughProxy(proxyPort, upstreamPort, toolName, args) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: toolName, arguments: args } });
    const req = http.request({
      hostname: '127.0.0.1',
      port: proxyPort,
      path: '/mock',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'x-upstream-url': `http://127.0.0.1:${upstreamPort}/`,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch { resolve({ status: res.statusCode, raw: Buffer.concat(chunks).toString('utf8') }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('proxy request timed out')));
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Daemon — reuse if already running, otherwise spawn as initializer
// ---------------------------------------------------------------------------

const daemonPath = new URL('../dist/daemon/index.js', import.meta.url).pathname;

log(`Probing for existing daemon at ${SOCKET}…`);
let daemon = null;
let ownsDaemon = false;

const alreadyUp = await waitForSocket(SOCKET, 500);
if (alreadyUp) {
  log('Existing daemon found — running as consumer (no daemon will be spawned or killed by this test)');
} else {
  log('No daemon detected — spawning a new one as initializer…');
  daemon = spawn('node', [daemonPath], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  daemon.stderr.on('data', d => process.stderr.write('[daemon] ' + d.toString()));
  ownsDaemon = true;
  if (!await waitForSocket(SOCKET)) fail('Daemon did not start within 8s');
  log('Daemon up ✓ (spawned by this test — will be killed on cleanup)');
}

// --- 1. Register ---
const regRes = await post(SOCKET, '/register', { instanceId: INSTANCE_ID, ide: 'vscode', workspace: 'proxy-test-ws', workspaceSlug: 'proxy-test-ws' });
if (regRes.status !== 200) fail(`/register returned ${regRes.status}`);
log('Registered ✓');

// --- 2. Verify GET /connections ---
const conns = await get(SOCKET, '/connections');
if (!conns.connections.some(c => c.instanceId === INSTANCE_ID)) fail(`INSTANCE_ID not found in connections (total=${conns.total})`);
log(`GET /connections ✓ (${conns.total} total, test instance present)`);

// --- 3. Subscribe SSE and test /telemetry broadcast ---
const { events, req: sseReq } = subscribeEvents(SOCKET, INSTANCE_ID);

const telemetryEvent = {
  id: 'proxy-test-tel-' + Date.now(),
  type: 'tool_call_started',
  timestamp: Date.now(),
  toolName: 'test_tool',
  serverName: 'test-server',
  ide: 'vscode',
  workspaceSlug: 'proxy-test-ws',
};
const telRes = await post(SOCKET, '/telemetry', telemetryEvent);
if (telRes.status !== 200) fail(`/telemetry returned ${telRes.status}`);

const broadcastEvt = await waitForEvent(events, e => e.id === telemetryEvent.id);
if (broadcastEvt.type !== 'tool_call_started') fail('SSE event type mismatch');
log('Telemetry broadcast via SSE ✓');

// --- 4. Heartbeat ---
const hbRes = await post(SOCKET, '/heartbeat', { instanceId: INSTANCE_ID });
if (hbRes.status !== 200) fail(`/heartbeat returned ${hbRes.status}`);
log('Heartbeat ✓');

// --- 5. HTTP proxy (tools/call routing with SSE telemetry) ---

// Read proxyPort from daemon.json
const daemonJson = JSON.parse(fs.readFileSync(path.join(HOME, '.myai', 'daemon.json'), 'utf8'));
const proxyPort = daemonJson.proxyPort;
log(`Proxy port: ${proxyPort}`);

const { server: mockServer, port: mockPort } = await startMockServer();
const toolName = 'proxy-echo';
const toolArgs = { msg: 'hello-from-test', ts: Date.now() };

const proxyResult = await callThroughProxy(proxyPort, mockPort, toolName, toolArgs);
if (proxyResult.status !== 200) fail(`proxy returned HTTP ${proxyResult.status}`);
if (!proxyResult.body?.result) fail('proxy response missing .result');
log('Proxy tools/call HTTP response ✓');

// Verify SSE received tool_call_started and tool_call_completed from proxy
const startedEvt = await waitForEvent(events, e => e.type === 'tool_call_started' && e.toolName === toolName);
const completedEvt = await waitForEvent(events, e => e.type === 'tool_call_completed' && e.id === startedEvt.id);
if (typeof completedEvt.durationMs !== 'number') fail('completed event missing durationMs');
log('Proxy emits tool_call_started + tool_call_completed via SSE ✓');

// --- Cleanup ---
sseReq.destroy();
mockServer.close();
await post(SOCKET, '/deregister', { instanceId: INSTANCE_ID }).catch(() => {});
if (ownsDaemon && daemon) daemon.kill();

log('All tests passed ✓');
