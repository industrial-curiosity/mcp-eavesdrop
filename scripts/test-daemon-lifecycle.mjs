#!/usr/bin/env node
/**
 * scripts/test-daemon-lifecycle.mjs
 *
 * Multi-instance lifecycle scenario:
 * 1. Start daemon
 * 2. Register instance A and instance B
 * 3. Deregister A — daemon should stay alive (B still connected)
 * 4. Deregister B — daemon should self-terminate after idle grace
 *
 * Prerequisites:
 *   npm run build
 *   node scripts/test-daemon-lifecycle.mjs
 */

import http from 'http';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

const HOME = os.homedir();
const SOCKET = path.join(HOME, '.mcpEavesdrop', 'ipc.sock');
const log = (...args) => console.log('[lifecycle]', ...args);
const fail = (msg) => { console.error('[lifecycle] FAIL:', msg); process.exit(1); };

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

function get(s, p) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: s, path: p, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    });
    req.on('error', reject);
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

function waitForSocketGone(socketPath, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    function attempt() {
      const sock = net.createConnection(socketPath);
      sock.setTimeout(300);
      sock.on('connect', () => { sock.destroy(); if (Date.now() > deadline) resolve(false); else setTimeout(attempt, 200); });
      sock.on('error', () => { sock.destroy(); resolve(true); });
      sock.on('timeout', () => { sock.destroy(); resolve(true); });
    }
    attempt();
  });
}

const daemonPath = new URL('../dist/daemon/index.js', import.meta.url).pathname;

// Kill any existing daemon so this test starts with a clean slate
const existingDaemon = await waitForSocket(SOCKET, 500);
if (existingDaemon) {
  log('Found existing daemon — shutting it down before test…');
  try { await post(SOCKET, '/shutdown', { force: true }); } catch { /* ignore */ }
  try {
    const daemonJson = JSON.parse(fs.readFileSync(path.join(HOME, '.mcpEavesdrop', 'daemon.json'), 'utf8'));
    if (daemonJson.pid) { try { process.kill(daemonJson.pid, 'SIGTERM'); } catch { /* already gone */ } }
  } catch { /* daemon.json may not exist */ }
  const gone = await waitForSocketGone(SOCKET, 5000);
  if (!gone) fail('Existing daemon did not stop within 5s');
  log('Existing daemon stopped ✓');
}

const daemon = spawn('node', [daemonPath], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
daemon.stderr.on('data', d => process.stderr.write('[daemon] ' + d.toString()));
daemon.stdout.on('data', d => process.stdout.write('[daemon] ' + d.toString()));

log('Waiting for daemon…');
if (!await waitForSocket(SOCKET)) fail('Daemon did not start');
log('Daemon up ✓');

await post(SOCKET, '/register', { instanceId: 'A', ide: 'vscode', workspace: 'ws-a', workspaceSlug: 'ws-a' });
await post(SOCKET, '/register', { instanceId: 'B', ide: 'vscode', workspace: 'ws-b', workspaceSlug: 'ws-b' });

let conns = await get(SOCKET, '/connections');
if (conns.total !== 2) fail(`expected 2 connections, got ${conns.total}`);
log('2 connections ✓');

await post(SOCKET, '/deregister', { instanceId: 'A' });
conns = await get(SOCKET, '/connections');
if (conns.total !== 1) fail(`expected 1 connection after A deregister, got ${conns.total}`);
log('1 connection after A deregisters ✓');

// Daemon should NOT exit yet
await new Promise(r => setTimeout(r, 2000));
const stillAlive = await waitForSocket(SOCKET, 500);
if (!stillAlive) fail('Daemon exited too early while B is still connected');
log('Daemon alive while B connected ✓');

await post(SOCKET, '/deregister', { instanceId: 'B' });
log('B deregistered — waiting for self-termination (max 15s)…');

const exited = await new Promise(resolve => {
  const t = setTimeout(() => resolve(false), 15_000);
  daemon.on('exit', () => { clearTimeout(t); resolve(true); });
});
if (!exited) { daemon.kill(); fail('Daemon did not self-terminate'); }
log('Daemon self-terminated ✓');
log('All lifecycle tests passed ✓');
