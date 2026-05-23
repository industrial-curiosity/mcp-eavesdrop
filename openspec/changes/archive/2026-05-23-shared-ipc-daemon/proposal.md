## Why

When VS Code and Cursor are both running with the extension active — or when multiple windows of either IDE are open simultaneously — every window competes to own the same fixed IPC socket path (`/tmp/myai-extension.sock`). Each activation deletes the previous socket, severing any stdio-wrappers already connected and fragmenting telemetry across isolated per-window proxy processes. There is no shared log, no cross-window visibility, and no stable proxy address for MCP server entries in mcp.json.

## What Changes

- **BREAKING**: The per-window IPC socket server and per-window proxy child process are replaced by a single shared IPC daemon subprocess
- The daemon is spawned detached by the first extension instance and outlives all extension hosts
- All subsequent extension instances connect to the running daemon rather than starting their own
- A bootstrap lock file prevents race conditions when multiple windows activate simultaneously
- The stdio-wrapper's IPC destination changes from a per-window socket to the shared daemon socket
- The daemon's proxy port is written into the deployed `stdio-wrapper.js` file (not into mcp.json); mcp.json entries remain stable
- MCP telemetry events are broadcast to all connected extension instances; each filters as needed
- Event logs are persisted to `~/.myai/logs/{ide}/{workspace_slug}.jsonl` (one file per IDE/workspace combination) by the daemon; the extension reads these directly from disk
- The extension's reconnect logic replays the full startup sequence (lock + spawn) if the daemon is found to be dead
- The extension can query the daemon for all active connections (all IDEs, all workspaces) to enable log filtering in the monitor panel

## Capabilities

### New Capabilities
- `ipc-daemon`: The shared daemon process — bootstrap lifecycle, connection registry, heartbeat polling, HTTP MCP proxy, event broadcasting, log persistence, and shutdown protocol

### Modified Capabilities
- `mcp-proxy`: Requirements change from a per-window child process to a shared daemon; proxy address is stable (dynamic port written to wrapper file, not mcp.json)
- `extension-lifecycle`: Startup must probe for a running daemon before spawning one; shutdown must deregister and conditionally kill the daemon; reconnect loop added
- `stdio-wrapper`: Telemetry destination changes from the per-window socket to the shared daemon socket; wrapper reads embedded daemon port with a `~/.myai/daemon.json` fallback
- `agent-monitor-panel`: History loaded from disk (merged across log files); panel shows all connected windows with IDE/workspace identity for log filtering

## Non-goals

- Cross-machine or networked IPC (daemon is local only)
- Persisting connection state across daemon restarts (in-memory only; log files survive)
- Supporting IDE types beyond VS Code and Cursor
- Centralizing MCP server configuration management in the daemon

## Impact

- `src/extension.ts`: Remove `startIpcServer()` / `startProxy()`; add daemon probe, lock acquisition, spawn, register, heartbeat, reconnect loop
- `src/proxy/server.ts`: Refactored into the new daemon entry point (`src/daemon/index.ts`)
- `src/proxy/stdio-wrapper.ts`: Updated IPC target and daemon port fallback logic
- `src/wrapper-deploy.ts`: Must write daemon port into deployed wrapper file on daemon start/restart
- `src/panel/AgentPanel.ts`: Reads log files from `~/.myai/logs/`; calls `/connections` endpoint
- New: `src/daemon/index.ts`, `src/daemon/registry.ts`, `src/daemon/logger.ts`
- New: `~/.myai/` directory structure (created by daemon on first run)
