// MYAI_WRAPPER_VERSION=4
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
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

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: unknown;
    _meta?: Record<string, unknown>;
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

function writeLocalLog(event: TelemetryEvent, ide: string, workspaceSlug: string, serverName: string): void {
  try {
    const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
    const date = new Date(event.timestamp).toISOString().slice(0, 10); // YYYY-MM-DD
    const logDir = `${home}/.myai/logs/${ide}/${workspaceSlug}/${date}`;
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(`${logDir}/${serverName}.jsonl`, JSON.stringify(event) + '\n', 'utf8');
  } catch (error) {
    process.stderr.write(`myai-wrapper: log write failed: ${String(error)}\n`);
  }
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

  // HTTP direct mode: MCP entry was originally an HTTP server
  if (realUrl && !realServer) {
    await runHttpDirectMode(ide, workspaceSlug, realUrl, DAEMON_SOCKET_PATH);
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

  // Resolve daemon socket path: baked-in constant preferred, fall back to daemon.json
  const socketPath = DAEMON_SOCKET_PATH === '__DAEMON_SOCKET_PATH__'
    ? (readDaemonJson()?.socketPath ?? DAEMON_SOCKET_PATH)
    : DAEMON_SOCKET_PATH;

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
 * HTTP direct mode: forward stdin JSON-RPC → real HTTP server → stdout
 * Used when the original MCP entry was an HTTP server (MYAI_REAL_URL set, MYAI_REAL_SERVER absent).
 * Logs events locally and sends telemetry to daemon for live-stream fanout.
 */
async function runHttpDirectMode(
  ide: string,
  workspaceSlug: string,
  realUrl: string,
  socketPath: string,
): Promise<void> {
  const serverName = getEnv(MYAI_SERVER_NAME) ?? 'mcp';
  let ndjsonRemainder = '';

  return new Promise((resolve) => {
    process.stdin.on('data', (chunk: Buffer) => {
      const ndjson = parseNewlineDelimited(ndjsonRemainder + chunk.toString('utf8'));
      ndjsonRemainder = ndjson.rest;
      for (const message of ndjson.messages) {
        void handleHttpDirectMessage(message, serverName, realUrl, socketPath, ide, workspaceSlug);
      }
    });

    process.stdin.on('end', () => {
      resolve();
      process.exit(0);
    });
  });
}

async function handleHttpDirectMessage(
  message: JsonRpcMessage,
  serverName: string,
  realUrl: string,
  socketPath: string,
  ide: string,
  workspaceSlug: string,
): Promise<void> {
  const now = Date.now();
  const isToolCall = message.method === 'tools/call';
  let eventId: string | undefined;
  let startTime: number | undefined;

  if (isToolCall) {
    eventId = crypto.randomUUID();
    startTime = now;
    const startedEvent: TelemetryEvent = {
      id: eventId,
      type: 'tool_call_started',
      timestamp: now,
      toolName: message.params?.name,
      serverName,
      arguments: message.params?.arguments,
      ide,
      workspaceSlug,
    };
    writeLocalLog(startedEvent, ide, workspaceSlug, serverName);
    postTelemetry(socketPath, startedEvent);
  }

  try {
    const responseText = await forwardDirectHttp(realUrl, JSON.stringify(message));
    process.stdout.write(responseText + '\n');

    if (isToolCall && eventId !== undefined && startTime !== undefined) {
      let parsed: { result?: unknown; error?: { message?: string } } | undefined;
      try { parsed = JSON.parse(responseText) as typeof parsed; } catch { /* ignore */ }

      const finishTime = Date.now();
      const durationMs = finishTime - startTime;
      const finishedEvent: TelemetryEvent = parsed?.error ? {
        id: eventId,
        type: 'tool_call_failed',
        timestamp: finishTime,
        toolName: message.params?.name,
        serverName,
        error: String(parsed.error.message ?? 'Unknown error'),
        durationMs,
        ide,
        workspaceSlug,
      } : {
        id: eventId,
        type: 'tool_call_completed',
        timestamp: finishTime,
        toolName: message.params?.name,
        serverName,
        result: parsed?.result,
        durationMs,
        ide,
        workspaceSlug,
      };
      writeLocalLog(finishedEvent, ide, workspaceSlug, serverName);
      postTelemetry(socketPath, finishedEvent);
    }
  } catch (err) {
    process.stderr.write(`myai-wrapper: HTTP direct forward error: ${String(err)}\n`);
    const rpcError = JSON.stringify({
      jsonrpc: '2.0',
      id: message.id ?? null,
      error: { code: -32000, message: String(err) },
    });
    process.stdout.write(rpcError + '\n');

    if (isToolCall && eventId !== undefined && startTime !== undefined) {
      const failedEvent: TelemetryEvent = {
        id: eventId,
        type: 'tool_call_failed',
        timestamp: Date.now(),
        toolName: message.params?.name,
        serverName,
        error: String(err),
        durationMs: Date.now() - startTime,
        ide,
        workspaceSlug,
      };
      writeLocalLog(failedEvent, ide, workspaceSlug, serverName);
      postTelemetry(socketPath, failedEvent);
    }
  }
}

function forwardDirectHttp(url: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;
    const defaultPort = isHttps ? 443 : 80;

    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port ? Number.parseInt(parsed.port, 10) : defaultPort,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        accept: 'application/json',
      },
    };

    const req = transport.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error('HTTP direct forward timeout')));
    req.write(body);
    req.end();
  });
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
  const resolvedIde = ide ?? 'unknown';
  const resolvedWorkspaceSlug = workspaceSlug ?? 'unknown';
  const resolvedServerName = serverName ?? 'unknown';

  if (message.method === 'tools/call') {
    const requestId = message.id;
    const eventId = crypto.randomUUID();
    const startedEvent: TelemetryEvent = {
      id: eventId,
      type: 'tool_call_started',
      timestamp: now,
      toolName: message.params?.name,
      serverName,
      arguments: message.params?.arguments,
      ide,
      workspaceSlug,
    };
    writeLocalLog(startedEvent, resolvedIde, resolvedWorkspaceSlug, resolvedServerName);
    postTelemetry(socketPath, startedEvent);

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
    const failedEvent: TelemetryEvent = {
      id: tracked.eventId,
      type: 'tool_call_failed',
      timestamp: now,
      toolName: tracked.toolName,
      serverName,
      error: JSON.stringify(message.error),
      durationMs: now - tracked.startedAt,
      ide,
      workspaceSlug,
    };
    writeLocalLog(failedEvent, resolvedIde, resolvedWorkspaceSlug, resolvedServerName);
    postTelemetry(socketPath, failedEvent);
    return;
  }

  const completedEvent: TelemetryEvent = {
    id: tracked.eventId,
    type: 'tool_call_completed',
    timestamp: now,
    toolName: tracked.toolName,
    serverName,
    result: message.result,
    durationMs: now - tracked.startedAt,
    ide,
    workspaceSlug,
  };
  writeLocalLog(completedEvent, resolvedIde, resolvedWorkspaceSlug, resolvedServerName);
  postTelemetry(socketPath, completedEvent);
}

main().catch((error) => {
  process.stderr.write(`myai-wrapper: fatal error: ${String(error)}\n`);
  process.exit(1);
});
