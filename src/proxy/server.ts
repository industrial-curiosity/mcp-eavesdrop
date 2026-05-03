import * as http from 'http';
import * as https from 'https';
import * as crypto from 'crypto';
import { EventBroadcaster } from './eventEmitter';
import { McpToolEvent } from '../types';

// ---------------------------------------------------------------------------
// Config — passed as JSON in argv[2]: { "servers": { "<namespace>": "<url>" } }
// ---------------------------------------------------------------------------

interface ProxyConfig {
  servers: Record<string, string>;
}

let config: ProxyConfig = { servers: {} };
if (process.argv[2]) {
  try {
    config = JSON.parse(process.argv[2]) as ProxyConfig;
  } catch {
    process.stderr.write('myai-proxy: failed to parse config from argv[2]\n');
  }
}

// ---------------------------------------------------------------------------
// Parent-death detection — exit when the extension host closes stdin
// ---------------------------------------------------------------------------

process.stdin.resume();
process.stdin.on('end', () => {
  process.exit(0);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_PAYLOAD_BYTES = 10 * 1024; // 10 KB

function truncate(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  const json = JSON.stringify(value);
  if (json.length <= MAX_PAYLOAD_BYTES) return value;
  return {
    _truncated: true,
    _sizeBytes: json.length,
    _preview: json.slice(0, MAX_PAYLOAD_BYTES),
  };
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

interface UpstreamResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function forwardToUpstream(
  upstreamUrl: string,
  body: string,
  reqHeaders: http.IncomingHttpHeaders,
): Promise<UpstreamResponse> {
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
      proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
      proxyRes.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf8');
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(proxyRes.headers)) {
          if (typeof v === 'string') {
            headers[k] = v;
          } else if (Array.isArray(v)) {
            headers[k] = v.join(', ');
          }
        }
        resolve({ statusCode: proxyRes.statusCode ?? 200, headers, body: responseBody });
      });
    });

    proxyReq.on('error', reject);
    proxyReq.write(body);
    proxyReq.end();
  });
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = http.createServer();
const broadcaster = new EventBroadcaster(server);

server.on('request', async (req: http.IncomingMessage, res: http.ServerResponse) => {
  // Enforce loopback-only access
  const remoteAddr = req.socket.remoteAddress;
  if (remoteAddr !== '127.0.0.1' && remoteAddr !== '::1' && remoteAddr !== '::ffff:127.0.0.1') {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // CORS pre-flight (webview may need this)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, accept, x-upstream-url');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1');

  // Internal endpoint: broadcast session_cleared
  if (reqUrl.pathname === '/internal/clear' && req.method === 'POST') {
    const event: McpToolEvent = {
      id: crypto.randomUUID(),
      type: 'session_cleared',
      timestamp: Date.now(),
    };
    broadcaster.broadcast(event);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }

  // Derive namespace from path, e.g. /context7 → 'context7'
  const namespace = reqUrl.pathname.replace(/^\//, '') || 'mcp';
  const upstreamUrl =
    config.servers[namespace] ??
    (req.headers['x-upstream-url'] as string | undefined);

  if (!upstreamUrl) {
    const errorBody = JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32601,
        message: `No upstream configured for namespace: ${namespace}`,
      },
      id: null,
    });
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(errorBody);
    return;
  }

  // Read request body
  let body: string;
  try {
    body = await readBody(req);
  } catch (err) {
    res.writeHead(400);
    res.end('Failed to read request body');
    return;
  }

  // Parse JSON-RPC body to detect tool calls
  interface JsonRpcRequest {
    method?: string;
    params?: { name?: string; arguments?: unknown };
    id?: unknown;
  }
  let parsedBody: JsonRpcRequest | undefined;
  try {
    parsedBody = JSON.parse(body) as JsonRpcRequest;
  } catch {
    // Non-JSON or malformed — forward as-is without interception
  }

  const isToolCall = parsedBody?.method === 'tools/call';
  let eventId: string | undefined;
  let startTime: number | undefined;

  if (isToolCall) {
    eventId = crypto.randomUUID();
    startTime = Date.now();
    broadcaster.broadcast({
      id: eventId,
      type: 'tool_call_started',
      toolName: parsedBody?.params?.name,
      serverName: namespace,
      timestamp: startTime,
      arguments: truncate(parsedBody?.params?.arguments),
    });
  }

  // Forward to upstream
  let upstream: UpstreamResponse;
  try {
    upstream = await forwardToUpstream(upstreamUrl, body, req.headers);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    if (isToolCall && eventId !== undefined && startTime !== undefined) {
      broadcaster.broadcast({
        id: eventId,
        type: 'tool_call_failed',
        toolName: parsedBody?.params?.name,
        serverName: namespace,
        timestamp: Date.now(),
        error: errorMessage,
        durationMs: Date.now() - startTime,
      });
    }

    const errorBody = JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: `Upstream unreachable: ${errorMessage}` },
      id: parsedBody?.id ?? null,
    });
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(errorBody);
    return;
  }

  // Return upstream response to the caller
  for (const [k, v] of Object.entries(upstream.headers)) {
    res.setHeader(k, v);
  }
  res.writeHead(upstream.statusCode);
  res.end(upstream.body);

  // Emit completed/failed event based on upstream JSON-RPC response
  if (isToolCall && eventId !== undefined && startTime !== undefined) {
    const durationMs = Date.now() - startTime;
    try {
      interface JsonRpcResponse {
        result?: unknown;
        error?: unknown;
      }
      const parsedResponse = JSON.parse(upstream.body) as JsonRpcResponse;
      if (parsedResponse.error !== undefined) {
        broadcaster.broadcast({
          id: eventId,
          type: 'tool_call_failed',
          toolName: parsedBody?.params?.name,
          serverName: namespace,
          timestamp: Date.now(),
          error: JSON.stringify(parsedResponse.error),
          durationMs,
        });
      } else {
        broadcaster.broadcast({
          id: eventId,
          type: 'tool_call_completed',
          toolName: parsedBody?.params?.name,
          serverName: namespace,
          timestamp: Date.now(),
          result: truncate(parsedResponse.result),
          durationMs,
        });
      }
    } catch {
      // Response wasn't valid JSON-RPC — still emit completed
      broadcaster.broadcast({
        id: eventId,
        type: 'tool_call_completed',
        toolName: parsedBody?.params?.name,
        serverName: namespace,
        timestamp: Date.now(),
        durationMs,
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Bind and report port
// ---------------------------------------------------------------------------

server.listen(0, '127.0.0.1', () => {
  const address = server.address() as { port: number };
  process.stdout.write(JSON.stringify({ port: address.port }) + '\n');
});
