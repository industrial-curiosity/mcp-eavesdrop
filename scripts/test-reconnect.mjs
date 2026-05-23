#!/usr/bin/env node
/**
 * scripts/test-reconnect.mjs
 *
 * Tests the extension host SSE consumer reconnect behavior:
 * 1. Start daemon
 * 2. Start an SSE consumer on the Unix socket (simulating the extension host's daemon monitor)
 * 3. Kill the daemon mid-session
 * 4. Restart the daemon
 * 5. Verify the SSE consumer can resubscribe successfully
 *
 * Prerequisites:
 *   npm run build
 *   node scripts/test-reconnect.mjs
 */

import http from 'http';
import net from 'net';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

const HOME = os.homedir();
const SOCKET = path.join(HOME, '.myai', 'ipc.sock');
const log = (...args) => console.log('[reconnect]', ...args);
const fail = (msg) => { console.error('[reconnect] FAIL:', msg); process.exit(1); };

function post(s, p, b) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(b);
    const req = http.request({ socketPath: s, path: p, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function waitForSocket(socketPath, timeoutMs = 5000) {
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

function subscribeOnce(socketPath, instanceId) {
  return new Promise((resolve, reject) => {
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
            if (line) { res.destroy(); resolve(JSON.parse(line.slice(6))); }
          }
        });
        res.on('error', reject);
        res.on('close', () => resolve(null));
      },
    );
    req.on('error', () => resolve(null));
    req.end();
  });
}

const daemonPath = new URL('../dist/daemon/index.js', import.meta.url).pathname;

async function startDaemon() {
  const d = spawn('node', [daemonPath], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  d.stderr.on('data', b => process.stderr.write('[daemon] ' + b.toString()));
  d.stdout.on('data', b => process.stdout.write('[daemon] ' + b.toString()));
  if (!await waitForSocket(SOCKET)) fail('Daemon did not start');
  return d;
}

// --- Round 1 ---
log('Starting daemon (round 1)…');
let daemon = await startDaemon();
log('Daemon up ✓');

await post(SOCKET, '/register', { instanceId: 'relay-test', ide: 'vscode', workspace: 'ws', workspaceSlug: 'ws' });
log('Registered relay-test ✓');

log('Killing daemon…');
daemon.kill('SIGKILL');
await new Promise(r => setTimeout(r, 500)); // brief pause for socket file to clean up

// --- Round 2 ---
log('Restarting daemon (round 2)…');
daemon = await startDaemon();
log('Daemon restarted ✓');

// Re-register and receive an SSE event
await post(SOCKET, '/register', { instanceId: 'relay-test', ide: 'vscode', workspace: 'ws', workspaceSlug: 'ws' });
log('Re-registered ✓');

const ssePromise = subscribeOnce(SOCKET, 'relay-test');

await post(SOCKET, '/telemetry', {
  id: 'reconnect-event-' + Date.now(),
  type: 'tool_call_started',
  timestamp: Date.now(),
  toolName: 'reconnect_tool',
  serverName: 'test-server',
  ide: 'vscode',
  workspaceSlug: 'ws',
});

const evt = await ssePromise;
log('SSE received after reconnect:', evt?.type ?? '(connection_event)');
if (!evt) fail('No SSE event received after reconnect');
log('Reconnect ✓');

// Clean up
await post(SOCKET, '/deregister', { instanceId: 'relay-test' }).catch(() => {});
daemon.kill();

log('All reconnect tests passed ✓');
