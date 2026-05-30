## 1. Daemon — remove TCP proxy

- [ ] 1.1 Delete `createTcpServer()` function and all TCP server startup code in `src/daemon/index.ts`
- [ ] 1.2 Delete `panelSseStreams` map and all references to it
- [ ] 1.3 Delete port allocation loop (7331–7360) and the `proxyPort` variable
- [ ] 1.4 Remove `proxyPort` from `writeDaemonJson()` output and the `DaemonJson` interface
- [ ] 1.5 Rename `persistAndBroadcast()` to `broadcastEvent()` and remove the `logger.append()` call inside it

## 2. Daemon — telemetry endpoint broadcasts only

- [ ] 2.1 Update `POST /telemetry` handler: remove disk write, keep broadcast + `200 {}` response
- [ ] 2.2 Remove `EventLogger` import and usage from `src/daemon/index.ts` (logger.ts file remains; daemon no longer calls it)

## 3. Wrapper — local log writing

- [ ] 3.1 Add `writeLocalLog(event, ide, workspaceSlug, serverName)` to `src/proxy/stdio-wrapper.ts`: appends `JSON.stringify(event) + '\n'` to `~/.myai/logs/<ide>/<workspaceSlug>/<YYYY-MM-DD>/<serverName>.jsonl`, creating the directory if missing
- [ ] 3.2 Call `writeLocalLog()` from `handleJsonRpc` for `tool_call_started`, `tool_call_completed`, and `tool_call_failed` events (unconditional — not gated on daemon reachability)
- [ ] 3.3 Remove the `telemetryEnabled` gate from the `process.stdin` and `child.stdout` data handlers — `handleJsonRpc` is now always called; it handles daemon degradation internally

## 4. Wrapper — HTTP direct mode

- [ ] 4.1 Delete `runHttpBridgeMode()` and `forwardToTcpProxy()` functions
- [ ] 4.2 Delete the `DAEMON_PROXY_PORT` constant and its `parseInt('__DAEMON_PROXY_PORT__', 10)` initializer
- [ ] 4.3 Add `forwardDirectHttp(url, body)` function: POSTs `body` to `url` over http/https, returns response string; mirrors the daemon's existing `forwardToUpstream` logic
- [ ] 4.4 Add `runHttpDirectMode(ide, workspaceSlug, realUrl, socketPath)`: reads newline-delimited JSON from stdin, calls `handleJsonRpc` on each request, calls `forwardDirectHttp`, writes response to stdout, calls `handleJsonRpc` on the response; handles upstream errors with a JSON-RPC error response
- [ ] 4.5 In `main()`, replace the `runHttpBridgeMode()` call with `runHttpDirectMode()` where `MYAI_REAL_URL` is set and `MYAI_REAL_SERVER` is absent
- [ ] 4.6 Bump `MYAI_WRAPPER_VERSION`

## 5. Wrapper deploy — remove port injection

- [ ] 5.1 Remove `PORT_PLACEHOLDER` constant, `readWrapperProxyPort()`, and the port-change re-deploy check from `src/wrapper-deploy.ts`
- [ ] 5.2 Remove the `daemonProxyPort` parameter from `deployWrapper()` signature; update the function body accordingly

## 6. Extension — remove proxy port tracking

- [ ] 6.1 Remove the `daemonProxyPort` module-level variable and all read/write references from `src/extension.ts`
- [ ] 6.2 Remove the port-change re-deploy block from the reconnect/restart handler in `startDaemonMonitor()`
- [ ] 6.3 Update `deployWrapper()` call sites — no longer pass `daemonProxyPort`

## 7. AgentPanel — remove relay port

- [ ] 7.1 Remove `relayPort` parameter from `AgentPanel.createOrShow()` signature and the constructor
- [ ] 7.2 Remove `portMapping` from `vscode.window.createWebviewPanel()` options
- [ ] 7.3 Update all `createOrShow()` call sites in `src/extension.ts`

## 8. Extension — read history from disk

- [ ] 8.1 Add a `readEventLogs(logsDir)` helper in the extension that reads JSONL files from `~/.myai/logs/` and returns events sorted by timestamp
- [ ] 8.2 On panel open (when `AgentPanel.onPanelReady` fires), read JSONL logs and send a `history` message to the webview

## 9. Tests and docs

- [ ] 9.1 Update `scripts/test-proxy.mjs`: remove `proxyPort` references; replace TCP proxy call with direct wrapper invocation test
- [ ] 9.2 Update `scripts/test-daemon.mjs`: remove `proxyPort` assertions from daemon.json checks
- [ ] 9.3 Update `README.md`: remove proxy port from `daemon.json` shape, remove port 7331–7360 mention, update architecture description
- [ ] 9.4 Update `docs/testing.md`: remove TCP proxy troubleshooting entries
- [ ] 9.5 Verify `checkForStaleWrappers` in `src/stale-check.ts` correctly detects old wrapper version and forces re-deploy
