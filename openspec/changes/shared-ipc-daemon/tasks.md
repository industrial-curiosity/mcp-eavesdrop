## 1. Daemon Foundation

- [ ] 1.1 Create `src/daemon/` directory and `src/daemon/index.ts` entry point with Unix socket + TCP HTTP server scaffolding
- [ ] 1.2 Implement dynamic TCP port selection (7331–7360) with conflict detection and `~/.myai/daemon.json` write
- [ ] 1.3 Implement `~/.myai/ipc.sock` binding with `0600` permissions, stale socket cleanup, and Windows named pipe fallback
- [ ] 1.4 Add bootstrap lock logic in `src/extension.ts`: probe socket → acquire `~/.myai/ipc.lock` → spawn detached daemon → poll socket → release lock
- [ ] 1.5 Handle stale lock detection (age > 10s with no connectable socket → delete and retry)

## 2. Daemon Connection Registry

- [ ] 2.1 Implement `src/daemon/registry.ts`: in-memory connection registry with `register`, `deregister`, `heartbeat`, `getAll` operations
- [ ] 2.2 Implement `POST /register` endpoint — add/update connection, respond `200 { ok: true }`
- [ ] 2.3 Implement `POST /deregister` endpoint — remove connection from registry
- [ ] 2.4 Implement `POST /heartbeat` endpoint — update `lastHeartbeat`, respond `200` or `404`
- [ ] 2.5 Implement heartbeat polling loop (30s interval): evict connections with `lastHeartbeat` older than 90s, close their SSE streams
- [ ] 2.6 Implement idle self-termination: if registry is empty after a polling cycle, schedule `process.exit(0)` after 10-second grace period with cancellation on new registration

## 3. Daemon Event Pipeline

- [ ] 3.1 Implement `src/daemon/logger.ts`: append events as NDJSON to `~/.myai/logs/{ide}/{workspaceSlug}.jsonl`, creating directories as needed
- [ ] 3.2 Implement `GET /events` SSE endpoint: validate `instanceId` is registered, keep connection open, send heartbeat comment every 15s to detect dead connections
- [ ] 3.3 Implement event broadcast: on each telemetry event, write to disk then fan out to all open SSE streams
- [ ] 3.4 Implement `POST /telemetry` endpoint: validate body (`id`, `type`, `timestamp`, `ide`, `workspaceSlug`), persist, broadcast
- [ ] 3.5 Implement `GET /connections` endpoint: return `{ total, connections: [...] }`
- [ ] 3.6 Implement `POST /shutdown` endpoint: validate connection count (reject if > 1 unless `force: true`), flush, exit

## 4. Daemon HTTP MCP Proxy

- [ ] 4.1 Move HTTP proxy forwarding logic from `src/proxy/server.ts` into `src/daemon/index.ts` on the TCP server; preserve stateless `x-upstream-url` routing and loopback-only enforcement
- [ ] 4.2 Wire proxy telemetry events into the daemon's event pipeline (logger + broadcaster) rather than the old WebSocket broadcaster
- [ ] 4.3 Retain `POST /internal/clear` endpoint for `session_cleared` events; route through the new broadcaster

## 5. Wrapper Deploy — Daemon Port Injection

- [ ] 5.1 Update `src/wrapper-deploy.ts` to write `DAEMON_SOCKET_PATH` and `DAEMON_PROXY_PORT` constants into the deployed `~/.myai/stdio-wrapper.js` after daemon startup
- [ ] 5.2 Add re-inject step on forced daemon restart (new port selected → redeploy wrapper constants)
- [ ] 5.3 Update version check logic to also re-deploy when proxy port has changed since last deploy

## 6. Stdio Wrapper Updates

- [ ] 6.1 Update `src/proxy/stdio-wrapper.ts`: replace `MYAI_IPC_SOCKET`-as-HTTP target with daemon Unix socket path constant; use `POST /telemetry` with `ide` and `workspaceSlug` fields
- [ ] 6.2 Implement daemon.json fallback: on socket connection failure, read `~/.myai/daemon.json` and retry with the socket path found there
- [ ] 6.3 Implement HTTP bridge mode: when `MYAI_REAL_URL` is set and `MYAI_REAL_SERVER` is absent, forward stdin JSON-RPC to `http://127.0.0.1:{DAEMON_PROXY_PORT}/{MYAI_SERVER_NAME}` with `x-upstream-url` header and write response to stdout
- [ ] 6.4 Inject `MYAI_IDE` and `MYAI_WORKSPACE_SLUG` env vars in `src/mcp-wrap.ts` at wrap time alongside existing `MYAI_*` vars

## 7. MCP Config Wrapping Updates

- [ ] 7.1 Update `wrapEntry()` in `src/mcp-wrap.ts` for HTTP entries: convert to stdio format pointing to `stdio-wrapper.js` (no port number in mcp.json); set `MYAI_REAL_URL` in env
- [ ] 7.2 Update `MYAI_IPC_SOCKET` injection to use the stable daemon socket path (`~/.myai/ipc.sock`) instead of the old per-window tmpdir path
- [ ] 7.3 Verify `unwrapEntry()` in `src/mcp-wrap.ts` correctly restores both old stdio-wrapped and new HTTP-to-stdio-wrapped entries

## 8. Extension Lifecycle Refactor

- [ ] 8.1 Remove `startIpcServer()` and `startProxy()` from `src/extension.ts`; replace with `connectToDaemon()` function encapsulating probe → bootstrap → register → subscribe
- [ ] 8.2 Implement per-window relay server in `src/extension.ts` (HTTP, random port): subscribe to daemon SSE stream, relay all events to webview via local SSE endpoint
- [ ] 8.3 Implement 30-second heartbeat interval using `setInterval`; clear on deactivation
- [ ] 8.4 Implement reconnect loop: 5-second retry, probe daemon liveness via `daemon.pid`, replay startup if daemon dead, show alert every 3 failures
- [ ] 8.5 Implement `deactivate()`: deregister → query connections → conditionally POST `/shutdown`
- [ ] 8.6 Update `AgentPanel.createOrShow()` call to pass `relayPort` in the `init` message instead of `proxyPort`

## 9. Agent Monitor Panel Updates

- [ ] 9.1 Update webview `app.ts`: connect to `http://127.0.0.1:<relayPort>/events` via `EventSource` instead of WebSocket
- [ ] 9.2 Add connections sidebar component: render list of `{ ide, workspace, connectedAt }` from `init` and `connections_changed` messages
- [ ] 9.3 Implement per-connection filter toggles: hide/show events by `ide`/`workspaceSlug`; persist filter state in webview local storage
- [ ] 9.4 Implement history loading: extension reads all `~/.myai/logs/**/*.jsonl`, merges by timestamp, sends as `history` message to webview before live stream begins
- [ ] 9.5 Update panel to render history batch before live events, applying active filters

## 10. Testing

- [ ] 10.1 Update `scripts/test-proxy.mjs` to test daemon startup, registration, heartbeat, and SSE broadcast
- [ ] 10.2 Add `scripts/test-daemon-lifecycle.mjs`: multi-instance scenario (spawn two clients, verify both receive events, verify daemon exits when last client deregisters)
- [ ] 10.3 Add `scripts/test-reconnect.mjs`: kill daemon mid-session, verify extension reconnect loop replays startup and panel reconnects
- [ ] 10.4 Update `scripts/test-wrapper.mjs` to test HTTP bridge mode and `daemon.json` fallback path
- [ ] 10.5 Manually verify end-to-end with VS Code + Cursor open simultaneously: both panels show events from both windows

## 11. Cleanup and Documentation

- [ ] 11.1 Delete or archive `src/proxy/server.ts` standalone entry point (logic moved to daemon)
- [ ] 11.2 Update `tsconfig.json` build entries: add `src/daemon/index.ts`, remove or repurpose old proxy server entry
- [ ] 11.3 Update `build.mjs` to output `dist/daemon/index.js`
- [ ] 11.4 Update `README.md`: document `~/.myai/` directory structure, multi-IDE support, and manual daemon restart procedure
- [ ] 11.5 Add `~/.myai/` to `.gitignore` if not already present
