/**
 * Shared IPC Daemon
 *
 * Exposes two servers:
 *   1. Unix socket HTTP server at ~/.myai/ipc.sock — extension instance IPC
 *      (register, deregister, heartbeat, SSE events, connections, shutdown, telemetry)
 *   2. TCP HTTP server on a dynamic port (7331–7360) — MCP HTTP proxy for IDE clients
 *
 * The daemon is spawned detached by the first extension instance and outlives all hosts.
 */

import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { ConnectionRegistry } from './registry';
import { EventLogger } from './logger';
import { McpToolEvent } from '../types';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const HOME = os.homedir();
const MYAI_DIR = path.join(HOME, '.myai');
import { DAEMON_SOCKET_PATH } from './constants';

const DAEMON_JSON_PATH = path.join(MYAI_DIR, 'daemon.json');
const LOGS_DIR = path.join(MYAI_DIR, 'logs');
const PORT_START = 7331;
const PORT_END = 7360;
const MAX_PAYLOAD_BYTES = 10 * 1024;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const registry = new ConnectionRegistry();
const logger = new EventLogger(LOGS_DIR);
/** Open SSE response streams, keyed by instanceId */
const sseStreams = new Map<string, http.ServerResponse>();
/** Open SSE response streams for panel webview consumers */
const panelSseStreams = new Map<string, http.ServerResponse>();
let proxyPort = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  const json = JSON.stringify(value);
  if (json.length <= MAX_PAYLOAD_BYTES) return value;
  return { _truncated: true, _sizeBytes: json.length, _preview: json.slice(0, MAX_PAYLOAD_BYTES) };
}

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
  for (const [id, res] of panelSseStreams) {
    try {
      res.write(data);
    } catch {
      panelSseStreams.delete(id);
    }
  }
}

function persistAndBroadcast(event: McpToolEvent): void {
  if (event.ide && event.workspaceSlug) {
    logger.append(event as unknown as Record<string, unknown>, event.ide, event.workspaceSlug);
  }
  broadcast(event as unknown as Record<string, unknown>);
}

function writeDaemonJson(): void {
  fs.mkdirSync(MYAI_DIR, { recursive: true });
  fs.writeFileSync(
    DAEMON_JSON_PATH,
    JSON.stringify({ pid: process.pid, proxyPort, socketPath: DAEMON_SOCKET_PATH, startedAt: Date.now() }),
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
      persistAndBroadcast(event);
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
// TCP HTTP proxy server — MCP proxy for IDE clients
// ---------------------------------------------------------------------------

interface UpstreamResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function forwardToUpstream(upstreamUrl: string, body: string, reqHeaders: http.IncomingHttpHeaders): Promise<UpstreamResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(upstreamUrl);
    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;
    const defaultPort = isHttps ? 443 : 80;

    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : defaultPort,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'content-type': reqHeaders['content-type'] ?? 'application/json',
        'content-length': Buffer.byteLength(body),
        accept: reqHeaders.accept ?? 'application/json',
      },
    };

    const proxyReq = transport.request(options, (proxyRes) => {
      const chunks: Buffer[] = [];
      proxyRes.on('data', (c: Buffer) => chunks.push(c));
      proxyRes.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf8');
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(proxyRes.headers)) {
          if (typeof v === 'string') headers[k] = v;
          else if (Array.isArray(v)) headers[k] = v.join(', ');
        }
        resolve({ statusCode: proxyRes.statusCode ?? 200, headers, body: responseBody });
      });
    });
    proxyReq.on('error', reject);
    proxyReq.write(body);
    proxyReq.end();
  });
}

function createTcpServer(): http.Server {
  return http.createServer(async (req, res) => {
    // Enforce loopback-only
    const remoteAddr = req.socket.remoteAddress;
    if (remoteAddr !== '127.0.0.1' && remoteAddr !== '::1' && remoteAddr !== '::ffff:127.0.0.1') {
      res.writeHead(403); res.end('Forbidden'); return;
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, accept, x-upstream-url');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1');

    // POST /internal/clear — session_cleared event
    if (reqUrl.pathname === '/internal/clear' && req.method === 'POST') {
      const event: McpToolEvent = { id: crypto.randomUUID(), type: 'session_cleared', timestamp: Date.now() };
      broadcast(event as unknown as Record<string, unknown>);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); return;
    }

    // GET /events — SSE stream for panel webview consumers
    if (reqUrl.pathname === '/events' && req.method === 'GET') {
      const streamId = crypto.randomUUID();
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.flushHeaders();
      panelSseStreams.set(streamId, res);
      const heartbeat = setInterval(() => {
        try {
          res.write(': heartbeat\n\n');
        } catch {
          clearInterval(heartbeat);
          panelSseStreams.delete(streamId);
        }
      }, 15_000);
      req.socket.on('close', () => {
        clearInterval(heartbeat);
        panelSseStreams.delete(streamId);
      });
      return;
    }

    if (req.method !== 'POST') { res.writeHead(405); res.end('Method Not Allowed'); return; }

    const namespace = reqUrl.pathname.replace(/^\//, '') || 'mcp';
    const upstreamUrl = req.headers['x-upstream-url'] as string | undefined;
    if (!upstreamUrl) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: `No upstream URL for namespace: ${namespace}` }, id: null }));
      return;
    }

    let body: string;
    try { body = await readBody(req); } catch { res.writeHead(400); res.end('Failed to read body'); return; }

    interface JsonRpcRequest { method?: string; params?: { name?: string; arguments?: unknown }; id?: unknown; }
    let parsedBody: JsonRpcRequest | undefined;
    try { parsedBody = JSON.parse(body) as JsonRpcRequest; } catch { /* forward as-is */ }

    const isToolCall = parsedBody?.method === 'tools/call';
    let eventId: string | undefined;
    let startTime: number | undefined;
    const ide = (req.headers['x-myai-ide'] as string | undefined) ?? 'unknown';
    const workspaceSlug = (req.headers['x-myai-workspace-slug'] as string | undefined) ?? 'unknown';

    if (isToolCall) {
      eventId = crypto.randomUUID();
      startTime = Date.now();
      persistAndBroadcast({
        id: eventId,
        type: 'tool_call_started',
        toolName: parsedBody?.params?.name,
        serverName: namespace,
        timestamp: startTime,
        arguments: truncate(parsedBody?.params?.arguments),
        ide,
        workspaceSlug,
      });
    }

    try {
      const upstream = await forwardToUpstream(upstreamUrl, body, req.headers);

      if (isToolCall && eventId && startTime) {
        let parsedResp: { result?: unknown; error?: { message?: string } } | undefined;
        try { parsedResp = JSON.parse(upstream.body) as typeof parsedResp; } catch { /* ignore */ }

        if (parsedResp?.error) {
          persistAndBroadcast({
            id: eventId,
            type: 'tool_call_failed',
            timestamp: Date.now(),
            error: String(parsedResp.error.message ?? 'Unknown error'),
            durationMs: Date.now() - startTime,
            ide,
            workspaceSlug,
          });
        } else {
          persistAndBroadcast({
            id: eventId,
            type: 'tool_call_completed',
            timestamp: Date.now(),
            result: truncate(parsedResp?.result),
            durationMs: Date.now() - startTime,
            ide,
            workspaceSlug,
          });
        }
      }

      for (const [k, v] of Object.entries(upstream.headers)) {
        if (v) res.setHeader(k, v);
      }
      res.writeHead(upstream.statusCode);
      res.end(upstream.body);
    } catch (err) {
      if (isToolCall && eventId && startTime) {
        persistAndBroadcast({
          id: eventId,
          type: 'tool_call_failed',
          timestamp: Date.now(),
          error: String(err),
          durationMs: Date.now() - startTime,
          ide,
          workspaceSlug,
        });
      }
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: String(err) }, id: null }));
    }
  });
}

// ---------------------------------------------------------------------------
// Port selection
// ---------------------------------------------------------------------------

function tryBindPort(port: number): Promise<net.Server | null> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(null));
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => resolve(probe));
    });
  });
}

async function findFreePort(): Promise<number> {
  for (let port = PORT_START; port <= PORT_END; port++) {
    const probe = await tryBindPort(port);
    if (probe) return port;
  }
  throw new Error(`No free port found in range ${PORT_START}–${PORT_END}`);
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

  // Find proxy port
  proxyPort = await findFreePort();
  process.stderr.write(`myai-daemon: proxy port ${proxyPort}\n`);

  // Write daemon.json before starting servers
  writeDaemonJson();

  // Start Unix socket server
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

  // Start TCP proxy server
  const tcpServer = createTcpServer();
  await new Promise<void>((resolve, reject) => {
    tcpServer.once('error', reject);
    tcpServer.listen(proxyPort, '127.0.0.1', () => {
      process.stderr.write(`myai-daemon: HTTP proxy on 127.0.0.1:${proxyPort}\n`);
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
