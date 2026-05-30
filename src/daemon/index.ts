/**
 * Shared IPC Daemon
 *
 * Exposes a Unix socket HTTP server at ~/.myai/ipc.sock — extension instance IPC
 * (register, deregister, heartbeat, SSE events, connections, shutdown, telemetry,
 *  internal/clear).
 *
 * The daemon is spawned detached by the first extension instance and outlives all hosts.
 * MCP stdio wrappers write logs directly to disk and forward telemetry events to this
 * daemon for live-stream fanout to connected extension instances.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { ConnectionRegistry } from './registry';
import { McpToolEvent } from '../types';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const HOME = os.homedir();
const MYAI_DIR = path.join(HOME, '.myai');
import { DAEMON_SOCKET_PATH } from './constants';

const DAEMON_JSON_PATH = path.join(MYAI_DIR, 'daemon.json');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const registry = new ConnectionRegistry();
/** Open SSE response streams, keyed by instanceId */
const sseStreams = new Map<string, http.ServerResponse>();
let idleTimer: ReturnType<typeof setTimeout> | undefined;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function broadcast(event: Record<string, unknown>): void {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const [id, res] of sseStreams) {
    try {
      res.write(data);
    } catch {
      sseStreams.delete(id);
    }
  }
}

function broadcastEvent(event: McpToolEvent): void {
  broadcast(event as unknown as Record<string, unknown>);
}

function writeDaemonJson(): void {
  fs.mkdirSync(MYAI_DIR, { recursive: true });
  fs.writeFileSync(
    DAEMON_JSON_PATH,
    JSON.stringify({ pid: process.pid, socketPath: DAEMON_SOCKET_PATH, startedAt: Date.now() }),
    'utf8',
  );
}

function scheduleIdleExit(): void {
  if (idleTimer) return;
  idleTimer = setTimeout(() => {
    if (registry.size() === 0) {
      process.stderr.write('myai-daemon: registry empty, exiting\n');
      process.exit(0);
    }
    idleTimer = undefined;
  }, 10_000);
}

function cancelIdleExit(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = undefined;
  }
}

// ---------------------------------------------------------------------------
// Heartbeat polling — evict stale connections every 30s
// ---------------------------------------------------------------------------

setInterval(() => {
  const evicted = registry.evictStale(90_000);
  for (const id of evicted) {
    process.stderr.write(`myai-daemon: evicted stale connection ${id}\n`);
    const stream = sseStreams.get(id);
    if (stream) {
      try { stream.end(); } catch { /* ignore */ }
      sseStreams.delete(id);
    }
  }
  if (registry.size() === 0) {
    scheduleIdleExit();
  }
}, 30_000).unref();

// ---------------------------------------------------------------------------
// Unix socket HTTP server — extension IPC
// ---------------------------------------------------------------------------

function createUnixServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://daemon');

    // POST /register
    if (req.method === 'POST' && url.pathname === '/register') {
      let data: { instanceId: string; ide: string; workspace: string; workspaceSlug: string };
      try {
        data = JSON.parse(await readBody(req)) as typeof data;
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid body' }));
        return;
      }
      cancelIdleExit();
      registry.register(data);
      broadcast({ type: 'connections_changed', timestamp: Date.now() });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // POST /deregister
    if (req.method === 'POST' && url.pathname === '/deregister') {
      let data: { instanceId: string };
      try {
        data = JSON.parse(await readBody(req)) as typeof data;
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid body' }));
        return;
      }
      registry.deregister(data.instanceId);
      const stream = sseStreams.get(data.instanceId);
      if (stream) {
        try { stream.end(); } catch { /* ignore */ }
        sseStreams.delete(data.instanceId);
      }
      broadcast({ type: 'connections_changed', timestamp: Date.now() });
      if (registry.size() === 0) scheduleIdleExit();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // POST /heartbeat
    if (req.method === 'POST' && url.pathname === '/heartbeat') {
      let data: { instanceId: string };
      try {
        data = JSON.parse(await readBody(req)) as typeof data;
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid body' }));
        return;
      }
      const ok = registry.heartbeat(data.instanceId);
      if (!ok) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unknown instanceId' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // GET /events — SSE stream
    if (req.method === 'GET' && url.pathname === '/events') {
      const instanceId = url.searchParams.get('instanceId');
      if (!instanceId || !registry.has(instanceId)) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unregistered instanceId' }));
        return;
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'access-control-allow-origin': '*',
      });
      res.flushHeaders();
      sseStreams.set(instanceId, res);

      // Send a comment heartbeat every 15s to keep the connection alive
      const heartbeatInterval = setInterval(() => {
        try {
          res.write(': heartbeat\n\n');
        } catch {
          clearInterval(heartbeatInterval);
          sseStreams.delete(instanceId);
        }
      }, 15_000);

      req.socket.on('close', () => {
        clearInterval(heartbeatInterval);
        sseStreams.delete(instanceId);
      });
      return;
    }

    // GET /connections
    if (req.method === 'GET' && url.pathname === '/connections') {
      const connections = registry.getAll();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ total: connections.length, connections }));
      return;
    }

    // GET /debug/streams — returns active SSE stream instanceIds (development aid)
    if (req.method === 'GET' && url.pathname === '/debug/streams') {
      const streamIds = [...sseStreams.keys()];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ total: streamIds.length, streamIds }));
      return;
    }

    // POST /shutdown
    if (req.method === 'POST' && url.pathname === '/shutdown') {
      let data: { force?: boolean } = {};
      try { data = JSON.parse(await readBody(req)) as typeof data; } catch { /* ignore */ }

      const total = registry.size();
      if (!data.force && total > 1) {
        res.writeHead(409, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'other connections still active', total }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      setTimeout(() => process.exit(0), 100);
      return;
    }

    // POST /telemetry — from stdio wrappers
    if (req.method === 'POST' && url.pathname === '/telemetry') {
      let event: McpToolEvent;
      try {
        event = JSON.parse(await readBody(req)) as McpToolEvent;
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Malformed JSON' }));
        return;
      }
      if (typeof event.id !== 'string' || typeof event.type !== 'string' || typeof event.timestamp !== 'number') {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required fields: id, type, timestamp' }));
        return;
      }
      broadcastEvent(event);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }

    // POST /internal/clear — session_cleared event
    if (req.method === 'POST' && url.pathname === '/internal/clear') {
      const clearEvent: McpToolEvent = { id: crypto.randomUUID(), type: 'session_cleared', timestamp: Date.now() };
      broadcast(clearEvent as unknown as Record<string, unknown>);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });
  return server;
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  fs.mkdirSync(MYAI_DIR, { recursive: true });

  // Clean up stale socket
  if (process.platform !== 'win32') {
    try { fs.unlinkSync(DAEMON_SOCKET_PATH); } catch { /* not present */ }
  }

  writeDaemonJson();

  const unixServer = createUnixServer();
  await new Promise<void>((resolve, reject) => {
    unixServer.once('error', reject);
    unixServer.listen(DAEMON_SOCKET_PATH, () => {
      // Restrict socket permissions to owner only (Unix)
      if (process.platform !== 'win32') {
        try { fs.chmodSync(DAEMON_SOCKET_PATH, 0o600); } catch { /* ignore */ }
      }
      process.stderr.write(`myai-daemon: listening on ${DAEMON_SOCKET_PATH}\n`);
      resolve();
    });
  });

  // Handle parent death (stdin closes when extension host exits)
  process.stdin.resume();
}

main().catch((err) => {
  process.stderr.write(`myai-daemon: startup failed: ${String(err)}\n`);
  process.exit(1);
});
