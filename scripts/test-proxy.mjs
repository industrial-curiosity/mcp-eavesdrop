#!/usr/bin/env node
/**
 * scripts/test-proxy.mjs
 *
 * End-to-end smoke test for the myai-extension proxy.
 *
 * 1. Connects to the extension's IPC socket to discover the proxy port.
 * 2. Subscribes to the proxy's WebSocket event stream at /events.
 * 3. Starts a self-contained mock MCP server on a random port.
 * 4. Routes a tools/call through the extension proxy.
 * 5. Asserts the HTTP response is correct AND that tool_call_started /
 *    tool_call_completed events were received on the WebSocket.
 *
 * Usage:
 *   node scripts/test-proxy.mjs              # auto-discovers port via IPC socket
 *   node scripts/test-proxy.mjs -p <PORT>    # override port manually
 *
 * Prerequisites:
 *   - The extension must be running (press F5 in VS Code).
 *   - npm install must have been run (uses the ws package from node_modules).
 */

import http from 'http';
import net from 'net';
import os from 'os';
import path from 'path';
import { WebSocket } from 'ws';

/** Must match IPC_SOCKET_PATH in src/extension.ts */
const IPC_SOCKET_PATH = path.join(os.tmpdir(), 'myai-extension.sock');

// ---------------------------------------------------------------------------
// Resolve proxy port — CLI flag takes precedence, otherwise query the socket
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let proxyPort = null;

for (let i = 0; i < args.length; i++) {
  if ((args[i] === '-p' || args[i] === '--port') && args[i + 1]) {
    proxyPort = parseInt(args[i + 1], 10);
    i++;
  }
}

if (!proxyPort) {
  proxyPort = await queryExtensionPort();
  if (proxyPort) {
    console.log(`Discovered proxy port ${proxyPort} via IPC socket`);
  }
}

if (!proxyPort || isNaN(proxyPort)) {
  console.error('Could not determine proxy port.');
  console.error('Either pass it explicitly:  node scripts/test-proxy.mjs -p <PORT>');
  console.error('Or make sure the extension is running (F5 in VS Code).');
  process.exit(1);
}

/**
 * Connect to the extension IPC socket and read {"port": N}.
 * Returns null if the socket is not present or the extension isn't running.
 */
function queryExtensionPort() {
  return new Promise((resolve) => {
    const socket = net.createConnection(IPC_SOCKET_PATH);
    let buf = '';

    socket.setTimeout(3000);
    socket.on('data', (d) => { buf += d.toString(); });
    socket.on('end', () => {
      try {
        const parsed = JSON.parse(buf.trim());
        resolve(typeof parsed.port === 'number' ? parsed.port : null);
      } catch {
        resolve(null);
      }
    });
    socket.on('error', () => resolve(null));
    socket.on('timeout', () => { socket.destroy(); resolve(null); });
  });
}

// ---------------------------------------------------------------------------
// WebSocket event stream subscriber
// ---------------------------------------------------------------------------

/**
 * Opens a WebSocket connection to the proxy's /events endpoint.
 * Returns { ws, events } where events is a live array of received McpToolEvents.
 */
function connectEventStream(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/events`);
    const events = [];

    ws.on('open', () => resolve({ ws, events }));
    ws.on('message', (data) => {
      try { events.push(JSON.parse(data.toString())); } catch { /* ignore */ }
    });
    ws.on('error', reject);

    setTimeout(() => reject(new Error('WebSocket connection to /events timed out after 5s')), 5000);
  });
}

/**
 * Wait until predicate(events) is true, or reject after timeoutMs.
 */
function waitForEvent(events, predicate, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      const match = events.find(predicate);
      if (match) return resolve(match);
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for expected WebSocket event'));
      setTimeout(check, 50);
    };
    check();
  });
}

// ---------------------------------------------------------------------------
// Mock MCP upstream server
// ---------------------------------------------------------------------------

function startMockServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }));
          return;
        }

        const response = {
          jsonrpc: '2.0',
          id: body.id ?? 1,
          result: {
            content: [{ type: 'text', text: `Mock result for tool "${body?.params?.name ?? 'unknown'}"` }],
            echoed_arguments: body?.params?.arguments ?? {},
          },
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      });
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      console.log(`Mock MCP server  listening on 127.0.0.1:${port}`);
      resolve({ server, port });
    });
  });
}

// ---------------------------------------------------------------------------
// Send a tools/call through the extension proxy
// ---------------------------------------------------------------------------

function callThroughProxy(proxyPort, upstreamPort, toolName, toolArgs) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: toolName, arguments: toolArgs },
    });

    const req = http.request({
      hostname: '127.0.0.1',
      port: proxyPort,
      path: '/mock',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-upstream-url': `http://127.0.0.1:${upstreamPort}/`,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { resolve({ raw: Buffer.concat(chunks).toString('utf8') }); }
      });
    });

    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('Proxy request timed out after 10s')));
    req.write(body);
    req.end();
  });
}

function postInternalTelemetry(proxyPort, event) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(event);

    const req = http.request({
      hostname: '127.0.0.1',
      port: proxyPort,
      path: '/internal/telemetry',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        statusCode: res.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });

    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('internal telemetry request timed out after 10s')));
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Connect to event stream BEFORE sending the tool call so we don't miss events
  console.log(`Connecting to event stream at ws://127.0.0.1:${proxyPort}/events...`);
  const { ws, events } = await connectEventStream(proxyPort);
  console.log('Event stream connected\n');

  const { server: mockServer, port: mockPort } = await startMockServer();
  assert(mockPort !== proxyPort, `mock server port (${mockPort}) must not equal proxy port (${proxyPort})`);

  const toolName = 'echo-test';
  const toolArgs = { message: 'hello from smoke test', timestamp: Date.now() };

  console.log(`\nSending tools/call "${toolName}" through proxy on port ${proxyPort}...\n`);

  let result;
  try {
    result = await callThroughProxy(proxyPort, mockPort, toolName, toolArgs);

    // Wait for both events to arrive on the WebSocket
    const startedEvent = await waitForEvent(
      events,
      (e) => e.type === 'tool_call_started' && e.toolName === toolName,
    );
    const completedEvent = await waitForEvent(
      events,
      (e) => e.type === 'tool_call_completed' && e.id === startedEvent.id,
    );

    console.log('HTTP response from proxy:');
    console.log(JSON.stringify(result, null, 2));
    assert(events.length >= 2, `expected at least 2 WebSocket events but got ${events.length}`);
    console.log('\nWebSocket events received:');
    console.log(JSON.stringify(startedEvent, null, 2));
    console.log(JSON.stringify(completedEvent, null, 2));

    // Assert HTTP response
    assert(!result.error, `proxy returned an error: ${result.error?.message}`);
    assert(result.result?.echoed_arguments?.message === toolArgs.message,
      'echoed arguments should match what was sent');

    // Assert events
    assert(startedEvent.serverName === 'mock', 'started event should have serverName "mock"');
    assert(typeof completedEvent.durationMs === 'number', 'completed event should have durationMs');

    // Assert /internal/telemetry endpoint also broadcasts and resolves the event
    const internalId = `manual-${Date.now()}`;

    const internalStarted = {
      id: internalId,
      type: 'tool_call_started',
      timestamp: Date.now(),
      toolName: 'manual-telemetry',
      serverName: 'internal-test',
    };
    const startedResult = await postInternalTelemetry(proxyPort, internalStarted);
    assert(startedResult.statusCode === 200, '/internal/telemetry started should return 200');

    const startedBroadcast = await waitForEvent(
      events,
      (e) => e.id === internalId && e.type === 'tool_call_started',
    );
    assert(startedBroadcast.serverName === 'internal-test', 'internal started should be broadcast');

    const internalCompleted = {
      id: internalId,
      type: 'tool_call_completed',
      timestamp: Date.now(),
      toolName: 'manual-telemetry',
      serverName: 'internal-test',
      durationMs: 1,
      result: { ok: true },
    };
    const completedResult = await postInternalTelemetry(proxyPort, internalCompleted);
    assert(completedResult.statusCode === 200, '/internal/telemetry completed should return 200');

    const completedBroadcast = await waitForEvent(
      events,
      (e) => e.id === internalId && e.type === 'tool_call_completed',
    );
    assert(completedBroadcast.result?.ok === true, 'internal completed should be broadcast');

  } finally {
    ws.close();
    mockServer.close();
  }

  console.log('\nPASS — HTTP response and WebSocket events are both correct.');
  console.log('The AI Agent Monitor panel will show the "echo-test" entry if it is open.');
}

main().catch((err) => {
  console.error('\nFAIL:', err.message);
  process.exit(1);
});
