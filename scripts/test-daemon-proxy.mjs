#!/usr/bin/env node
/**
 * scripts/test-daemon-proxy.mjs
 *
 * Smoke test for the daemon's TCP MCP proxy (port 7331-7360).
 *
 * 1. Start the daemon
 * 2. Register an instance and subscribe to SSE events
 * 3. Start a mock MCP upstream server
 * 4. Route a tools/call through the daemon TCP proxy using x-upstream-url
 * 5. Assert the HTTP response and that a telemetry event was broadcast over SSE
 *
 * Prerequisites:
 *   npm run build
 *   node scripts/test-daemon-proxy.mjs
 */

import http from 'http';
import net from 'net';
import os from 'os';
import path from 'path';
import { readFile } from 'fs/promises';
import { spawn } from 'child_process';

const HOME = os.homedir();
const SOCKET = path.join(HOME, '.myai', 'ipc.sock');
const DAEMON_JSON = path.join(HOME, '.myai', 'daemon.json');
const log = (...args) => console.log('[test-daemon-proxy]', ...args);
const fail = (msg) => { console.error('[test-daemon-proxy] FAIL:', msg); process.exit(1); };

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

function startMockMcpServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
          res.writeHead(400); res.end('{}'); return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0', id: body.id ?? 1,
          result: { content: [{ type: 'text', text: `mock result for ${body?.params?.name ?? 'unknown'}` }] },
        }));
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function callThroughDaemonProxy(proxyPort, upstreamPort, serverName, toolName, toolArgs) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: toolName, arguments: toolArgs } });
    const req = http.request({
      hostname: '127.0.0.1', port: proxyPort, path: `/${serverName}`, method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
        'x-upstream-url': `http://127.0.0.1:${upstreamPort}/`,
        'x-myai-ide': 'test', 'x-myai-workspace-slug': 'test-ws',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function subscribeSse(socketPath, instanceId, waitForType, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath, path: `/events?instanceId=${encodeURIComponent(instanceId)}`, method: 'GET' },
      (res) => {
        let buf = '';
        const timer = setTimeout(() => reject(new Error(`SSE timeout waiting for ${waitForType}`)), timeoutMs);
        res.on('data', chunk => {
          buf += chunk.toString();
          const parts = buf.split('\n\n');
          buf = parts.pop() ?? '';
          for (const part of parts) {
            if (!part.trim() || part.startsWith(':')) continue;
            const line = part.split('\n').find(l => l.startsWith('data: '));
            if (!line) continue;
            const evt = JSON.parse(line.slice(6));
            if (!waitForType || evt.type === waitForType) {
              clearTimeout(timer); res.destroy(); resolve(evt);
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
if (!await waitForSocket(SOCKET)) fail('Daemon did not start');
log('Daemon up ✓');

const regRes = await post(SOCKET, '/register', { instanceId: 'proxy-test', ide: 'test', workspace: 'test-ws', workspaceSlug: 'test-ws' });
if (!regRes.body.ok) fail('Registration failed');
log('Registered ✓');

const daemonJson = JSON.parse(await readFile(DAEMON_JSON, 'utf8'));
const proxyPort = daemonJson.proxyPort;
log(`Proxy port: ${proxyPort}`);
if (!proxyPort) fail('No proxyPort in daemon.json');

const ssePromise = subscribeSse(SOCKET, 'proxy-test', 'tool_call_started', 8000);

const { server: mockServer, port: mockPort } = await startMockMcpServer();
log(`Mock MCP upstream on port ${mockPort} ✓`);

log(`Calling tools/call through daemon proxy port ${proxyPort}…`);
const result = await callThroughDaemonProxy(proxyPort, mockPort, 'test-server', 'greet', { name: 'world' });
log('Proxy response:', JSON.stringify(result.body));
if (result.status !== 200) fail(`Expected 200 from proxy, got ${result.status}`);
if (!result.body.result?.content) fail('Missing result.content in proxy response');

const sseEvent = await ssePromise;
log('SSE event received:', sseEvent.type, sseEvent.toolName);
if (sseEvent.toolName !== 'greet') fail(`Expected toolName "greet", got "${sseEvent.toolName}"`);

mockServer.close();
await post(SOCKET, '/deregister', { instanceId: 'proxy-test' });
daemon.kill();

log('All proxy tests passed ✓');
