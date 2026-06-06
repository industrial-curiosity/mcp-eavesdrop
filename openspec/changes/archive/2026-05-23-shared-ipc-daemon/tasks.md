## 1. Daemon Foundation

- [x] 1.1 Create `src/daemon/` directory and `src/daemon/index.ts` entry point with Unix socket + TCP HTTP server scaffolding
- [x] 1.2 Implement dynamic TCP port selection (7331–7360) with conflict detection and `~/.mcpEavesdrop/daemon.json` write
- [x] 1.3 Implement `~/.mcpEavesdrop/ipc.sock` binding with `0600` permissions, stale socket cleanup, and Windows named pipe fallback
- [x] 1.4 Add bootstrap lock logic in `src/extension.ts`: probe socket → acquire `~/.mcpEavesdrop/ipc.lock` → spawn detached daemon → poll socket → release lock
- [x] 1.5 Handle stale lock detection (age > 10s with no connectable socket → delete and retry)
- [x] 1.6 Create `src/daemon/constants.ts` as a side-effect-free module exporting only `DAEMON_SOCKET_PATH`; update `extension.ts`, `wrapper-deploy.ts`, and `daemon/index.ts` to import from this module instead of `daemon/index.ts`

## 2. Daemon Connection Registry

- [x] 2.1 Implement `src/daemon/registry.ts`: in-memory connection registry with `register`, `deregister`, `heartbeat`, `getAll` operations
- [x] 2.2 Implement `POST /register` endpoint — add/update connection, respond `200 { ok: true }`
- [x] 2.3 Implement `POST /deregister` endpoint — remove connection from registry
- [x] 2.4 Implement `POST /heartbeat` endpoint — update `lastHeartbeat`, respond `200` or `404`
- [x] 2.5 Implement heartbeat polling loop (30s interval): evict connections with `lastHeartbeat` older than 90s, close their SSE streams
- [x] 2.6 Implement idle self-termination: if registry is empty after a polling cycle, schedule `process.exit(0)` after 10-second grace period with cancellation on new registration

## 3. Daemon Event Pipeline

- [x] 3.1 Implement `src/daemon/logger.ts`: append events as NDJSON to `~/.mcpEavesdrop/logs/{ide}/{workspaceSlug}.jsonl`, creating directories as needed
- [x] 3.2 Implement `GET /events` SSE endpoint: validate `instanceId` is registered, keep connection open, send heartbeat comment every 15s to detect dead connections
- [x] 3.3 Implement event broadcast: on each telemetry event, write to disk then fan out to all open SSE streams
- [x] 3.4 Implement `POST /telemetry` endpoint: validate body (`id`, `type`, `timestamp`, `ide`, `workspaceSlug`), persist, broadcast
- [x] 3.5 Implement `GET /connections` endpoint: return `{ total, connections: [...] }`
- [x] 3.6 Implement `POST /shutdown` endpoint: validate connection count (reject if > 1 unless `force: true`), flush, exit
- [x] 3.7 Implement `GET /debug/streams` endpoint: return `{ total, streamIds }` reflecting currently open SSE streams

## 4. Daemon HTTP MCP Proxy

- [x] 4.1 Move HTTP proxy forwarding logic from `src/proxy/server.ts` into `src/daemon/index.ts` on the TCP server; preserve stateless `x-upstream-url` routing and loopback-only enforcement
- [x] 4.2 Wire proxy telemetry events into the daemon's event pipeline (logger + broadcaster) rather than the old WebSocket broadcaster
- [x] 4.3 Retain `POST /internal/clear` endpoint for `session_cleared` events; route through the new broadcaster

## 5. Wrapper Deploy — Daemon Port Injection

- [x] 5.1 Update `src/wrapper-deploy.ts` to write `DAEMON_SOCKET_PATH` and `DAEMON_PROXY_PORT` constants into the deployed `~/.mcpEavesdrop/stdio-wrapper.js` after daemon startup
- [x] 5.2 Add re-inject step on forced daemon restart (new port selected → redeploy wrapper constants)
- [x] 5.3 Update version check logic to also re-deploy when proxy port has changed since last deploy

## 6. Stdio Wrapper Updates

- [x] 6.1 Update `src/proxy/stdio-wrapper.ts`: replace `MCPEAVESDROP_IPC_SOCKET`-as-HTTP target with daemon Unix socket path constant; use `POST /telemetry` with `ide` and `workspaceSlug` fields
- [x] 6.2 Implement daemon.json fallback: on socket connection failure, read `~/.mcpEavesdrop/daemon.json` and retry with the socket path found there
- [x] 6.3 Implement HTTP bridge mode: when `MCPEAVESDROP_REAL_URL` is set and `MCPEAVESDROP_REAL_SERVER` is absent, forward stdin JSON-RPC to `http://127.0.0.1:{DAEMON_PROXY_PORT}/{MCPEAVESDROP_SERVER_NAME}` with `x-upstream-url` header and write response to stdout
- [x] 6.4 Inject `MCPEAVESDROP_IDE` and `MCPEAVESDROP_WORKSPACE_SLUG` env vars in `src/mcp-wrap.ts` at wrap time alongside existing `MCPEAVESDROP_*` vars

## 7. MCP Config Wrapping Updates

- [x] 7.1 Update `wrapEntry()` in `src/mcp-wrap.ts` for HTTP entries: convert to stdio format pointing to `stdio-wrapper.js` (no port number in mcp.json); set `MCPEAVESDROP_REAL_URL` in env
- [x] 7.2 Remove per-instance `MCPEAVESDROP_IPC_SOCKET` env var injection; socket path is now embedded as a constant in the deployed `stdio-wrapper.js` at deploy time (see task 5.1)
- [x] 7.3 Verify `unwrapEntry()` in `src/mcp-wrap.ts` correctly restores both old stdio-wrapped and new HTTP-to-stdio-wrapped entries

## 8. Extension Lifecycle Refactor

- [x] 8.1 Remove `startIpcServer()` and `startProxy()` from `src/extension.ts`; replace with `connectToDaemon()` function encapsulating probe → bootstrap → register → subscribe
- [x] 8.2 In `src/extension.ts`, subscribe to daemon SSE stream via Unix socket (`GET /events?instanceId=...`); parse `data:` lines and forward each `McpToolEvent` to the panel via `AgentPanel.postMessage({ type: 'event', event })`; send `{ type: 'status', connected: bool }` on stream open/close; re-fetch `/connections` on `connections_changed` events. Note: relay server approach was abandoned — VS Code webviews cannot make reliable EventSource HTTP connections to localhost in Electron's sandboxed renderer; `panel.webview.postMessage` is the correct pattern.
- [x] 8.3 Implement 30-second heartbeat interval using `setInterval`; clear on deactivation
- [x] 8.4 Implement reconnect loop: 5-second retry, probe daemon liveness via `daemon.pid`, replay startup if daemon dead, show alert every 3 failures
- [x] 8.5 Implement `deactivate()`: deregister → query connections → conditionally POST `/shutdown`
- [x] 8.6 Add `AgentPanel.postMessage(msg)` static helper and `AgentPanel.onPanelReady` callback; fire `onPanelReady` from the `'ready'` message handler; in `activate()` set `AgentPanel.onPanelReady` to send current `status` and fetch `connections`

## 9. Agent Monitor Panel Updates

- [x] 9.1 Update webview `app.ts`: remove `EventSource` and `connect()` entirely; handle `{ type: 'event' }`, `{ type: 'status' }`, and `{ type: 'connections' }` postMessages from extension host; remove `connect-src` from CSP
- [x] 9.2 Add connections sidebar component: render list of `{ ide, workspace, connectedAt }` from `init` and `connections_changed` messages
- [x] 9.3 Implement per-connection filter toggles: hide/show events by `ide`/`workspaceSlug`; persist filter state in webview local storage
- [x] 9.4 Implement history loading: extension reads all `~/.mcpEavesdrop/logs/**/*.jsonl`, merges by timestamp, sends as `history` message to webview before live stream begins
- [x] 9.5 Update panel to render history batch before live events, applying active filters

## 10. Testing

- [x] 10.1 Update `scripts/test-proxy.mjs` to test daemon startup, registration, heartbeat, and SSE broadcast
- [x] 10.2 Add `scripts/test-daemon-lifecycle.mjs`: multi-instance scenario (spawn two clients, verify both receive events, verify daemon exits when last client deregisters)
- [x] 10.3 Add `scripts/test-reconnect.mjs`: kill daemon mid-session, verify extension reconnect loop replays startup and panel reconnects
- [x] 10.4 Update `scripts/test-wrapper.mjs` to test HTTP bridge mode and `daemon.json` fallback path
- [x] 10.5 Update `scripts/test-mcp-wrap.mjs`: remove stale `ipcSocket`/`proxyPort` fixture fields (no longer in `WrapOptions`); add `ide` and `workspaceSlug`; remove `MCPEAVESDROP_IPC_SOCKET` env assertion (socket path is now embedded in wrapper, not set as env var)
- [x] 10.6 Manually verify end-to-end with VS Code + Cursor open simultaneously: both panels show events from both windows

## 11. Cleanup and Documentation

- [x] 11.1 Delete or archive `src/proxy/server.ts` standalone entry point (logic moved to daemon)
- [x] 11.2 Update `tsconfig.json` build entries: add `src/daemon/index.ts`, remove or repurpose old proxy server entry
- [x] 11.3 Update `build.mjs` to output `dist/daemon/index.js`
- [x] 11.4 Update `README.md`: document `~/.mcpEavesdrop/` directory structure, multi-IDE support, and manual daemon restart procedure
- [x] 11.5 Add `~/.mcpEavesdrop/` to `.gitignore` if not already present
- [x] 11.6 Verify `dist/extension.js` contains no daemon startup code (`grep main.catch dist/extension.js` returns 0 matches)
