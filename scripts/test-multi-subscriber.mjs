#!/usr/bin/env node
/**
 * scripts/test-multi-subscriber.mjs
 *
 * Regression test: verifies the daemon broadcasts SSE events to ALL registered
 * subscribers, not just the most-recently connected one.
 *
 * Registers two separate instanceIds, subscribes both to /events, broadcasts
 * one telemetry event, and asserts both subscribers receive it within 3s.
 */

import http from 'http';
import net from 'net';
import os from 'os';
import path from 'path';

const HOME = os.homedir();
const SOCKET = path.join(HOME, '.myai', 'ipc.sock');
const log = (...args) => console.log('[multi-sub]', ...args);
const fail = (msg) => { console.error('[multi-sub] FAIL:', msg); process.exit(1); };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function post(urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      { socketPath: SOCKET, path: urlPath, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode }));
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function subscribeEvents(instanceId) {
  const events = [];
  const req = http.request(
    { socketPath: SOCKET, path: `/events?instanceId=${encodeURIComponent(instanceId)}`, method: 'GET' },
    (res) => {
      if (res.statusCode !== 200) {
        fail(`SSE subscribe for ${instanceId} returned HTTP ${res.statusCode}`);
        return;
      }
      let buf = '';
      res.on('data', chunk => {
        buf += chunk.toString();
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          if (!part.trim() || part.startsWith(':')) continue;
          const line = part.split('\n').find(l => l.startsWith('data: '));
          if (line) {
            try { events.push(JSON.parse(line.slice(6))); } catch { /* ignore */ }
          }
        }
      });
    },
  );
  req.on('error', (err) => fail(`SSE request error for ${instanceId}: ${err.message}`));
  req.end();
  return { events, req };
}

function waitForEvent(events, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function check() {
      const match = events.find(predicate);
      if (match) return resolve(match);
      if (Date.now() > deadline) return reject(new Error(`Timed out (${timeoutMs}ms) waiting for event`));
      setTimeout(check, 50);
    }
    check();
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const ID_A = 'multi-sub-A-' + Date.now();
const ID_B = 'multi-sub-B-' + Date.now();

log(`Subscriber A: ${ID_A}`);
log(`Subscriber B: ${ID_B}`);

// Register both
const regA = await post('/register', { instanceId: ID_A, ide: 'test-a', workspace: 'multi-sub', workspaceSlug: 'multi-sub' });
if (regA.status !== 200) fail(`/register A returned ${regA.status}`);

const regB = await post('/register', { instanceId: ID_B, ide: 'test-b', workspace: 'multi-sub', workspaceSlug: 'multi-sub' });
if (regB.status !== 200) fail(`/register B returned ${regB.status}`);

log('Both registered ✓');

// Subscribe both to SSE
const subA = subscribeEvents(ID_A);
const subB = subscribeEvents(ID_B);

// Brief pause to let HTTP connections establish
await new Promise(r => setTimeout(r, 200));

// Broadcast one telemetry event
const eventId = 'multi-sub-evt-' + Date.now();
const tel = await post('/telemetry', {
  id: eventId,
  type: 'tool_call_started',
  timestamp: Date.now(),
  toolName: 'test_tool',
  ide: 'test-a',
  workspaceSlug: 'multi-sub',
});
if (tel.status !== 200) fail(`/telemetry returned ${tel.status}`);

log(`Telemetry sent (id=${eventId})`);

// Both subscribers should receive it
let evtA, evtB;
try {
  [evtA, evtB] = await Promise.all([
    waitForEvent(subA.events, e => e.id === eventId),
    waitForEvent(subB.events, e => e.id === eventId),
  ]);
} catch (err) {
  const aGot = subA.events.some(e => e.id === eventId);
  const bGot = subB.events.some(e => e.id === eventId);
  log(`Subscriber A received event: ${aGot}`);
  log(`Subscriber B received event: ${bGot}`);
  fail(`Not all subscribers received the broadcast — ${err.message}`);
}

log(`Subscriber A received event ✓ (type=${evtA.type})`);
log(`Subscriber B received event ✓ (type=${evtB.type})`);

// Cleanup
subA.req.destroy();
subB.req.destroy();
await post('/deregister', { instanceId: ID_A }).catch(() => {});
await post('/deregister', { instanceId: ID_B }).catch(() => {});

log('All assertions passed — daemon broadcasts to all subscribers ✓');
