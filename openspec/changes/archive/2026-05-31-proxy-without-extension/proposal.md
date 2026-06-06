## Why

Calls to HTTP-bridged MCP servers fail when the VS Code extension is inactive. The wrapper routes those calls through the daemon's TCP proxy, which only exists while the extension is running. The core problem: the wrapper cannot forward the call at all without the daemon, even though it has the real server URL and everything it needs.

Separately, a tighter architecture question emerged: the TCP proxy is an unnecessary intermediary — it forwards HTTP calls the wrapper could make directly, and it writes logs that properly belong to the wrapper (the component making the call).

## What Changes

- The daemon's TCP proxy server is removed entirely. No more port allocation, no `portMapping` in the webview, no `DAEMON_PROXY_PORT` in the wrapper.
- HTTP-bridged wrappers forward calls directly to the real upstream URL (same model as stdio wrappers spawning the real server directly).
- Both wrapper modes (stdio and HTTP) run through the same `handleJsonRpc` telemetry path.
- The wrapper writes call log entries locally to `~/.mcpEavesdrop/logs/` regardless of daemon state — the wrapper is the source of truth for history.
- The daemon's `/telemetry` endpoint broadcasts only. No disk writes.
- Daemon lifetime is controlled exclusively by extension heartbeats. When the last extension disconnects, the daemon exits.

## Non-goals

- Wrapper-initiated daemon startup — the extension is the sole daemon initializer.
- Changing the extension→daemon registration or heartbeat protocol.
- Changing the event log directory structure (same `<ide>/<workspaceSlug>/<date>/` hierarchy, ownership moves from daemon to wrapper).
- Session attribution for HTTP-bridged servers — that comes for free once this change unifies the modes, but the spec for it lives in `mcp-session-attribution`.

## Capabilities

### Modified Capabilities

- `stdio-wrapper`: Gains HTTP direct mode and local log writing; HTTP bridge mode (via TCP proxy) is eliminated.
- `ipc-daemon`: TCP proxy server and port allocation removed; `/telemetry` broadcasts only; `daemon.json` drops `proxyPort`.
- `mcp-proxy`: TCP proxy functionality removed entirely; telemetry endpoint simplified to broadcast-only.

## Impact

- `src/proxy/stdio-wrapper.ts` — remove `runHttpBridgeMode`, `forwardToTcpProxy`, `DAEMON_PROXY_PORT`; add HTTP direct mode; add local log writing; decouple log writes from daemon reachability
- `src/daemon/index.ts` — remove `createTcpServer`, port allocation, `panelSseStreams`; change `persistAndBroadcast` to broadcast-only
- `src/wrapper-deploy.ts` — remove `PORT_PLACEHOLDER` injection and port-change re-deploy logic
- `src/extension.ts` — remove `daemonProxyPort` tracking and port-change handling
- `src/panel/AgentPanel.ts` — remove `relayPort` parameter and `portMapping`
- `openspec/specs/ipc-daemon/spec.md` — delta: remove TCP port requirement; update `daemon.json` shape
- `openspec/specs/stdio-wrapper/spec.md` — delta: add HTTP direct mode; add local log writing
- `openspec/specs/mcp-proxy/spec.md` — delta: remove TCP proxy requirements; simplify telemetry to broadcast-only
