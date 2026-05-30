#!/usr/bin/env node
/**
 * scripts/test-proxy.mjs
 *
 * End-to-end smoke test for the shared IPC daemon.
 *
 * Scenarios:
 *   1. Start daemon, wait for socket to be ready.
 *   2. Register an instance and verify it appears in GET /connections.
 *   3. Subscribe to SSE /events; POST tool_call_started + tool_call_completed telemetry and confirm both are broadcast.
 *   4. POST /heartbeat and verify 200 response.
 *   5. Deregister and clean up.
 *
 * Usage:
 *   node scripts/test-proxy.mjs
 *
 * Prerequisites:
 *   npm run build
 */

import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

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

const eventId = 'proxy-test-tel-' + Date.now();
const telemetryEvent = {
  id: eventId,
  type: 'tool_call_started',
  timestamp: Date.now(),
  toolName: 'test_tool',
  serverName: 'test-server',
  ide: 'vscode',
  workspaceSlug: 'proxy-test-ws',
};
const telRes = await post(SOCKET, '/telemetry', telemetryEvent);
if (telRes.status !== 200) fail(`/telemetry returned ${telRes.status}`);

const broadcastEvt = await waitForEvent(events, e => e.id === eventId && e.type === 'tool_call_started');
if (broadcastEvt.type !== 'tool_call_started') fail('SSE event type mismatch');
log('Telemetry broadcast via SSE ✓');

const completedEvent = {
  id: eventId,
  type: 'tool_call_completed',
  timestamp: Date.now(),
  toolName: 'test_tool',
  serverName: 'test-server',
  ide: 'vscode',
  workspaceSlug: 'proxy-test-ws',
  durationMs: 42,
  result: { content: [{ type: 'text', text: 'ok' }] },
};
const telRes2 = await post(SOCKET, '/telemetry', completedEvent);
if (telRes2.status !== 200) fail(`/telemetry (completed) returned ${telRes2.status}`);
await waitForEvent(events, e => e.id === eventId && e.type === 'tool_call_completed');
log('Telemetry completed event broadcast via SSE ✓');

// --- 4. Heartbeat ---
const hbRes = await post(SOCKET, '/heartbeat', { instanceId: INSTANCE_ID });
if (hbRes.status !== 200) fail(`/heartbeat returned ${hbRes.status}`);
log('Heartbeat ✓');

// --- Cleanup ---
sseReq.destroy();
await post(SOCKET, '/deregister', { instanceId: INSTANCE_ID }).catch(() => {});
if (ownsDaemon && daemon) daemon.kill();

log('All tests passed ✓');
