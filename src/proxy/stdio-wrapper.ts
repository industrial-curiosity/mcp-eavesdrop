// MYAI_WRAPPER_VERSION=2
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import { spawn } from 'child_process';
import * as crypto from 'crypto';
import { unwrapEntry } from '../mcp-wrap';
import {
  MYAI_CONFIG_PATH,
  MYAI_EXT_DIR,
  MYAI_IDE,
  MYAI_REAL_SERVER,
  MYAI_REAL_URL,
  MYAI_SERVER_NAME,
  MYAI_WORKSPACE_SLUG,
} from '../types';

// These values are injected at deploy time by wrapper-deploy.ts
const DAEMON_SOCKET_PATH = '__DAEMON_SOCKET_PATH__';
const DAEMON_PROXY_PORT = parseInt('__DAEMON_PROXY_PORT__', 10) || 0;

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: unknown;
  };
  result?: unknown;
  error?: unknown;
}

interface TrackedCall {
  eventId: string;
  toolName?: string;
  startedAt: number;
}

interface TelemetryEvent {
  id: string;
  type: 'tool_call_started' | 'tool_call_completed' | 'tool_call_failed';
  timestamp: number;
  toolName?: string;
  serverName?: string;
  arguments?: unknown;
  result?: unknown;
  error?: string;
  durationMs?: number;
  ide?: string;
  workspaceSlug?: string;
}

function getEnv(name: string): string | undefined {
  return process.env[name];
}

function parseRealServer(): { command: string; args: string[]; env: Record<string, string> } {
  const raw = getEnv(MYAI_REAL_SERVER);
  if (!raw) {
    throw new Error(`${MYAI_REAL_SERVER} is missing`);
  }

  const parsed = JSON.parse(raw) as {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
  };

  if (!parsed.command) {
    throw new Error(`Missing real server command in ${MYAI_REAL_SERVER}`);
  }

  return {
    command: parsed.command,
    args: [...(parsed.args ?? [])],
    env: { ...(parsed.env ?? {}) },
  };
}

function toTelemetryPath(socketPath: string): http.RequestOptions {
  return {
    socketPath,
    path: '/telemetry',
    method: 'POST',
    timeout: 500,
    headers: {
      'content-type': 'application/json',
    },
  };
}

function postTelemetry(socketPath: string, event: TelemetryEvent): void {
  try {
    const payload = JSON.stringify(event);
    const options = toTelemetryPath(socketPath);
    const request = http.request(options, (response) => {
      response.resume();
    });

    request.on('error', (error) => {
      process.stderr.write(`myai-wrapper: telemetry failed: ${error.message}\n`);
    });

    request.setTimeout(500, () => {
      request.destroy(new Error('telemetry timeout'));
    });

    request.write(payload);
    request.end();
  } catch (error) {
    process.stderr.write(`myai-wrapper: telemetry threw: ${String(error)}\n`);
  }
}

function checkIpcReachable(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    const finish = (value: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(400);
    socket.on('connect', () => finish(true));
    socket.on('error', () => finish(false));
    socket.on('timeout', () => finish(false));
  });
}

function readJsonFile<T>(filePath: string): T | undefined {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

interface DaemonJson {
  pid: number;
  proxyPort: number;
  socketPath: string;
  startedAt: number;
}

function readDaemonJson(): DaemonJson | undefined {
  const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
  return readJsonFile<DaemonJson>(home + '/.myai/daemon.json');
}

function selfHealConfig(): void {
  const configPath = getEnv(MYAI_CONFIG_PATH);
  const serverName = getEnv(MYAI_SERVER_NAME);

  if (!configPath || !serverName) {
    return;
  }

  const config = readJsonFile<Record<string, unknown>>(configPath);
  if (!config) {
    return;
  }

  const possibleRoots: Array<'servers' | 'mcpServers'> = ['servers', 'mcpServers'];
  for (const rootKey of possibleRoots) {
    const root = config[rootKey] as Record<string, unknown> | undefined;
    if (!root || typeof root !== 'object') {
      continue;
    }

    const entry = root[serverName] as Record<string, unknown> | undefined;
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    root[serverName] = unwrapEntry(entry as { [key: string]: unknown }) as unknown;
    try {
      fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    } catch (error) {
      process.stderr.write(`myai-wrapper: self-heal write failed: ${String(error)}\n`);
    }
    return;
  }
}

function spawnRealWithInheritedStdio(): void {
  let real;
  try {
    real = parseRealServer();
  } catch (error) {
    process.stderr.write(`myai-wrapper: ${String(error)}\n`);
    process.exit(1);
    return;
  }

  const child = spawn(real.command, real.args, {
    env: {
      ...process.env,
      ...real.env,
    },
    stdio: 'inherit',
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  child.on('error', (error) => {
    process.stderr.write(`myai-wrapper: failed to spawn real server: ${error.message}\n`);
    process.exit(1);
  });
}

function parseLengthPrefixedFrames(buffer: Buffer): { messages: JsonRpcMessage[]; rest: Buffer } {
  const messages: JsonRpcMessage[] = [];
  let cursor = 0;

  while (cursor < buffer.length) {
    const separator = buffer.indexOf('\r\n\r\n', cursor, 'utf8');
    if (separator === -1) {
      break;
    }

    const header = buffer.slice(cursor, separator).toString('utf8');
    const match = /content-length:\s*(\d+)/i.exec(header);
    if (!match) {
      break;
    }

    const contentLength = Number.parseInt(match[1], 10);
    const bodyStart = separator + 4;
    const bodyEnd = bodyStart + contentLength;
    if (buffer.length < bodyEnd) {
      break;
    }

    const body = buffer.slice(bodyStart, bodyEnd).toString('utf8');
    try {
      messages.push(JSON.parse(body) as JsonRpcMessage);
    } catch {
      // Ignore malformed payloads.
    }

    cursor = bodyEnd;
  }

  return {
    messages,
    rest: buffer.slice(cursor),
  };
}

function parseNewlineDelimited(buffer: string): { messages: JsonRpcMessage[]; rest: string } {
  const messages: JsonRpcMessage[] = [];
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      messages.push(JSON.parse(trimmed) as JsonRpcMessage);
    } catch {
      // Ignore non-JSON lines.
    }
  }

  return { messages, rest };
}

async function main(): Promise<void> {
  const extensionDir = getEnv(MYAI_EXT_DIR);
  if (extensionDir && !fs.existsSync(extensionDir)) {
    selfHealConfig();
    spawnRealWithInheritedStdio();
    return;
  }

  const ide = getEnv(MYAI_IDE) ?? 'unknown';
  const workspaceSlug = getEnv(MYAI_WORKSPACE_SLUG) ?? 'unknown';
  const realUrl = getEnv(MYAI_REAL_URL);
  const realServer = getEnv(MYAI_REAL_SERVER);

  // HTTP bridge mode: MCP entry was originally an HTTP server, now routed through daemon TCP proxy
  if (realUrl && !realServer) {
    await runHttpBridgeMode(ide, workspaceSlug, realUrl);
    return;
  }

  let real;
  try {
    real = parseRealServer();
  } catch (error) {
    process.stderr.write(`myai-wrapper: ${String(error)}\n`);
    process.exit(1);
    return;
  }

  // Resolve daemon socket path: try baked-in constant first, fall back to daemon.json
  let socketPath = DAEMON_SOCKET_PATH;
  let telemetryEnabled = false;

  if (socketPath && socketPath !== '__DAEMON_SOCKET_PATH__') {
    telemetryEnabled = await checkIpcReachable(socketPath);
  }

  if (!telemetryEnabled) {
    const daemonJson = readDaemonJson();
    if (daemonJson?.socketPath) {
      socketPath = daemonJson.socketPath;
      telemetryEnabled = await checkIpcReachable(socketPath);
    }
  }

  if (!telemetryEnabled) {
    process.stderr.write('myai-wrapper: daemon IPC unavailable, running passthrough mode\n');
  }

  const child = spawn(real.command, real.args, {
    env: {
      ...process.env,
      ...real.env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);

  const trackedCalls = new Map<string, TrackedCall>();
  const serverName = getEnv(MYAI_SERVER_NAME);

  let framedRemainder = Buffer.alloc(0);
  let ndjsonRemainder = '';
  let requestFramedRemainder = Buffer.alloc(0);
  let requestNdjsonRemainder = '';

  process.stdin.on('data', (chunk: Buffer) => {
    child.stdin.write(chunk);

    if (!telemetryEnabled || !socketPath) {
      return;
    }

    const framedRequest = parseLengthPrefixedFrames(Buffer.concat([requestFramedRemainder, chunk]));
    requestFramedRemainder = framedRequest.rest;
    for (const message of framedRequest.messages) {
      handleJsonRpc(message, trackedCalls, socketPath, serverName, ide, workspaceSlug);
    }

    const ndjsonRequest = parseNewlineDelimited(requestNdjsonRemainder + chunk.toString('utf8'));
    requestNdjsonRemainder = ndjsonRequest.rest;
    for (const message of ndjsonRequest.messages) {
      handleJsonRpc(message, trackedCalls, socketPath, serverName, ide, workspaceSlug);
    }
  });

  child.stdout.on('data', (chunk: Buffer) => {
    if (!telemetryEnabled || !socketPath) {
      return;
    }

    // Try framed parsing first because MCP commonly uses content-length framing.
    const framedBuffer = Buffer.concat([framedRemainder, chunk]);
    const framed = parseLengthPrefixedFrames(framedBuffer);
    framedRemainder = framed.rest;

    for (const message of framed.messages) {
      handleJsonRpc(message, trackedCalls, socketPath, serverName, ide, workspaceSlug);
    }

    // Also support newline-delimited JSON streams.
    const ndjson = parseNewlineDelimited(ndjsonRemainder + chunk.toString('utf8'));
    ndjsonRemainder = ndjson.rest;
    for (const message of ndjson.messages) {
      handleJsonRpc(message, trackedCalls, socketPath, serverName, ide, workspaceSlug);
    }
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  process.stdin.on('end', () => {
    child.stdin.end();
    child.kill('SIGTERM');
    process.exit(0);
  });

  child.on('error', (error) => {
    process.stderr.write(`myai-wrapper: child process error: ${error.message}\n`);
    process.exit(1);
  });
}

/**
 * HTTP bridge mode: forward stdin JSON-RPC → daemon TCP proxy → stdout
 * Used when the original MCP entry was an HTTP server (MYAI_REAL_URL set, MYAI_REAL_SERVER absent)
 */
function runHttpBridgeMode(ide: string, workspaceSlug: string, realUrl: string): Promise<void> {
  return new Promise((resolve) => {
    const serverName = getEnv(MYAI_SERVER_NAME) ?? 'mcp';
    const proxyPort = DAEMON_PROXY_PORT || (readDaemonJson()?.proxyPort ?? 0);

    if (!proxyPort) {
      process.stderr.write('myai-wrapper: HTTP bridge: no proxy port, running passthrough (stdin echo off)\n');
      process.exit(1);
      return;
    }

    let ndjsonRemainder = '';

    process.stdin.on('data', (chunk: Buffer) => {
      const ndjson = parseNewlineDelimited(ndjsonRemainder + chunk.toString('utf8'));
      ndjsonRemainder = ndjson.rest;
      for (const message of ndjson.messages) {
        forwardToTcpProxy(message, serverName, realUrl, proxyPort, ide, workspaceSlug);
      }
    });

    process.stdin.on('end', () => {
      resolve();
      process.exit(0);
    });
  });
}

function forwardToTcpProxy(
  message: JsonRpcMessage,
  serverName: string,
  realUrl: string,
  proxyPort: number,
  ide: string,
  workspaceSlug: string,
): void {
  const body = JSON.stringify(message);
  const options: http.RequestOptions = {
    hostname: '127.0.0.1',
    port: proxyPort,
    path: `/${serverName}`,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      'x-upstream-url': realUrl,
      'x-myai-ide': ide,
      'x-myai-workspace-slug': workspaceSlug,
    },
    timeout: 30_000,
  };

  const req = http.request(options, (res) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => {
      const responseText = Buffer.concat(chunks).toString('utf8');
      process.stdout.write(responseText + '\n');
    });
  });

  req.on('error', (err) => {
    process.stderr.write(`myai-wrapper: bridge forward error: ${err.message}\n`);
    // Write JSON-RPC error back to stdout so the caller gets a response
    const rpcError = JSON.stringify({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32000, message: String(err) } });
    process.stdout.write(rpcError + '\n');
  });

  req.write(body);
  req.end();
}

function handleJsonRpc(
  message: JsonRpcMessage,
  trackedCalls: Map<string, TrackedCall>,
  socketPath: string,
  serverName?: string,
  ide?: string,
  workspaceSlug?: string,
): void {
  const now = Date.now();

  if (message.method === 'tools/call') {
    const requestId = message.id;
    const eventId = crypto.randomUUID();
    postTelemetry(socketPath, {
      id: eventId,
      type: 'tool_call_started',
      timestamp: now,
      toolName: message.params?.name,
      serverName,
      arguments: message.params?.arguments,
      ide,
      workspaceSlug,
    });

    if (requestId !== undefined && requestId !== null) {
      trackedCalls.set(String(requestId), {
        eventId,
        toolName: message.params?.name,
        startedAt: now,
      });
    }

    return;
  }

  if (message.id === undefined || message.id === null) {
    return;
  }

  const tracked = trackedCalls.get(String(message.id));
  if (!tracked) {
    return;
  }

  trackedCalls.delete(String(message.id));

  if (message.error !== undefined) {
    postTelemetry(socketPath, {
      id: tracked.eventId,
      type: 'tool_call_failed',
      timestamp: now,
      toolName: tracked.toolName,
      serverName,
      error: JSON.stringify(message.error),
      durationMs: now - tracked.startedAt,
      ide,
      workspaceSlug,
    });
    return;
  }

  postTelemetry(socketPath, {
    id: tracked.eventId,
    type: 'tool_call_completed',
    timestamp: now,
    toolName: tracked.toolName,
    serverName,
    result: message.result,
    durationMs: now - tracked.startedAt,
    ide,
    workspaceSlug,
  });
}

main().catch((error) => {
  process.stderr.write(`myai-wrapper: fatal error: ${String(error)}\n`);
  process.exit(1);
});
