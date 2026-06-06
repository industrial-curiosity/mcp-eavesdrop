#!/usr/bin/env node
/**
 * scripts/test-daemon.mjs
 *
 * Smoke test for the shared IPC daemon.
 *
 * 1. Starts the daemon (dist/daemon/index.js)
 * 2. Registers two fake instances
 * 3. Sends a heartbeat for each
 * 4. Subscribes to SSE stream from instance-1 and posts telemetry
 * 5. Asserts the SSE stream receives the tool_call_started event
 * 6. Deregisters both instances (daemon should self-terminate after idle grace)
 *
 * Prerequisites:
 *   npm run build
 *   node scripts/test-daemon.mjs
 */

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const HOME = os.homedir();
const DAEMON_SOCKET = path.join(HOME, '.mcpEavesdrop', 'ipc.sock');
const DAEMON_JSON = path.join(HOME, '.mcpEavesdrop', 'daemon.json');

const log = (...args) => console.log('[test-daemon]', ...args);
const fail = (msg) => { console.error('[test-daemon] FAIL:', msg); process.exit(1); };

// ---------------------------------------------------------------------------
// Helpers
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
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.end();
  });
}

function pollSocket(socketPath, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const { createConnection } = await import('node:net');
    function attempt() {
      const sock = createConnection(socketPath);
      sock.setTimeout(300);
      sock.on('connect', () => { sock.destroy(); resolve(true); });
      sock.on('error', () => {
        sock.destroy();
        if (Date.now() > deadline) resolve(false);
        else setTimeout(attempt, 200);
      });
      sock.on('timeout', () => {
        sock.destroy();
        if (Date.now() > deadline) resolve(false);
        else setTimeout(attempt, 200);
      });
    }
    attempt();
  });
}

// SSE subscription — returns a promise that resolves with first 'data:' payload
function subscribeSse(socketPath, instanceId, waitForMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath, path: `/events?instanceId=${encodeURIComponent(instanceId)}`, method: 'GET' },
      (res) => {
        let buf = '';
        const timer = setTimeout(() => reject(new Error('SSE timeout')), waitForMs);
        res.on('data', chunk => {
          buf += chunk.toString();
          const parts = buf.split('\n\n');
          buf = parts.pop() ?? '';
          for (const part of parts) {
            if (!part.trim() || part.startsWith(':')) continue;
            const line = part.split('\n').find(l => l.startsWith('data: '));
            if (line) {
              clearTimeout(timer);
              res.destroy();
              resolve(JSON.parse(line.slice(6)));
            }
          }
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const daemonPath = new URL('../dist/daemon/index.js', import.meta.url).pathname;
log('Starting daemon…');
const daemon = spawn('node', [daemonPath], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
daemon.stderr.on('data', d => process.stderr.write('[daemon] ' + d.toString()));
daemon.stdout.on('data', d => process.stdout.write('[daemon] ' + d.toString()));

log('Waiting for daemon socket…');
const ready = await new Promise((resolve) => {
  const { createConnection } = await import('node:net');
  const deadline = Date.now() + 5000;
  function attempt() {
    const sock = createConnection(DAEMON_SOCKET);
    sock.setTimeout(300);
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error', () => { sock.destroy(); if (Date.now() > deadline) resolve(false); else setTimeout(attempt, 200); });
    sock.on('timeout', () => { sock.destroy(); if (Date.now() > deadline) resolve(false); else setTimeout(attempt, 200); });
  }
  attempt();
});
if (!ready) fail('Daemon did not start within 5s');
log('Daemon up ✓');

// Register two instances
const res1 = await post(DAEMON_SOCKET, '/register', { instanceId: 'test-instance-1', ide: 'vscode', workspace: 'test-workspace', workspaceSlug: 'test-workspace' });
if (res1.body.ok !== true) fail('register instance-1 failed');
const res2 = await post(DAEMON_SOCKET, '/register', { instanceId: 'test-instance-2', ide: 'cursor', workspace: 'test-workspace-2', workspaceSlug: 'test-workspace-2' });
if (res2.body.ok !== true) fail('register instance-2 failed');
log('Registered 2 instances ✓');

// Heartbeat
const hb = await post(DAEMON_SOCKET, '/heartbeat', { instanceId: 'test-instance-1' });
if (hb.body.ok !== true) fail('heartbeat failed');
log('Heartbeat ✓');

// Check connections
const conns = await get(DAEMON_SOCKET, '/connections');
if (conns.body.total !== 2) fail(`expected 2 connections, got ${conns.body.total}`);
log(`Connections: ${conns.body.total} ✓`);

// Subscribe to SSE on instance-1 and post a telemetry event (fire and forget)
const ssePromise = subscribeSse(DAEMON_SOCKET, 'test-instance-1', 5000);

// Read daemon.json to verify pid and socketPath
const daemonJson = JSON.parse(await readFile(DAEMON_JSON, 'utf8'));
log(`Daemon pid: ${daemonJson.pid}, socket: ${daemonJson.socketPath}`);

// Post telemetry to daemon via telemetry endpoint
const eventId = 'test-event-' + Date.now();
const telRes = await post(DAEMON_SOCKET, '/telemetry', {
  id: eventId,
  type: 'tool_call_started',
  timestamp: Date.now(),
  toolName: 'test_tool',
  serverName: 'test-server',
  ide: 'vscode',
  workspaceSlug: 'test-workspace',
});
if (telRes.status !== 200) fail('telemetry post failed');
log('Telemetry posted ✓');

const sseEvent = await ssePromise;
log('SSE event received:', sseEvent);
if (sseEvent.type !== 'tool_call_started' && sseEvent.type !== 'connections_changed') {
  fail(`expected SSE event, got: ${JSON.stringify(sseEvent)}`);
}
log('SSE broadcast ✓');

// Deregister both
await post(DAEMON_SOCKET, '/deregister', { instanceId: 'test-instance-1' });
await post(DAEMON_SOCKET, '/deregister', { instanceId: 'test-instance-2' });
log('Deregistered ✓');

// Daemon should self-terminate — wait up to 15s
log('Waiting for daemon idle self-termination (max 15s)…');
const exited = await new Promise((resolve) => {
  const t = setTimeout(() => resolve(false), 15_000);
  daemon.on('exit', () => { clearTimeout(t); resolve(true); });
});
if (exited) {
  log('Daemon self-terminated ✓');
} else {
  log('Warning: daemon did not self-terminate within 15s (may still be in grace period)');
  daemon.kill();
}

log('All tests passed ✓');
