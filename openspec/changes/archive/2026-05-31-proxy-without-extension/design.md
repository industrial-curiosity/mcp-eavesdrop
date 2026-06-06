## Context

The current wrapper has two modes:

- **Stdio mode**: spawns the real server as a child process, intercepts stdin/stdout, POSTs telemetry to the daemon Unix socket `/telemetry`. Gracefully degrades if daemon is unreachable.
- **HTTP bridge mode**: forwards calls to the daemon's TCP proxy (`http://127.0.0.1:<proxyPort>/<namespace>`), which then forwards to the real upstream URL. Fails with `process.exit(1)` if `proxyPort` is 0.

The TCP proxy path creates two problems: (1) calls fail completely when the extension is inactive, and (2) the daemon owns log persistence even though the wrapper is making the call and has all the data.

The daemon currently handles: extension IPC (Unix socket), TCP proxy forwarding, telemetry persistence, and SSE live-stream. Only the Unix socket IPC and SSE live-stream need to survive.

## Goals

- All MCP calls succeed regardless of whether the extension is running.
- Both wrapper modes use the same code path for telemetry and log writing.
- The wrapper is the authoritative source of call history. Daemon delivery is best-effort.
- Daemon is simpler: extension IPC and SSE fanout only.

## Decisions

### 1. Wrapper owns log persistence; daemon owns live-stream

The wrapper appends each telemetry event to `~/.mcpEavesdrop/logs/<ide>/<workspaceSlug>/<YYYY-MM-DD>/<serverName>.jsonl` synchronously, before attempting daemon delivery. The daemon's `/telemetry` handler drops the disk write and broadcasts only. This cleanly separates: "did this call happen?" (always answerable from disk) from "can I see it live?" (only when extension is connected).

Each wrapper process writes to its own per-server file, so no cross-process locking is needed. POSIX `O_APPEND` atomicity covers the record sizes involved.

### 2. HTTP direct mode replaces HTTP bridge mode

The wrapper's HTTP mode calls upstream directly using the same `http`/`https` forwarding logic the daemon currently uses in `forwardToUpstream`. Request arrives on stdin, gets forwarded to `MCPEAVESDROP_REAL_URL`, response written to stdout. `handleJsonRpc` is called on both the outgoing request and incoming response, identical to how stdio mode intercepts its byte stream.

### 3. `handleJsonRpc` is decoupled from daemon reachability

Currently `handleJsonRpc` is called only when `telemetryEnabled` is true (daemon socket reachable). Under the new model it is always called — the local log write is unconditional. The `postTelemetry` call inside it remains fire-and-forget and fails silently when the daemon is down. The `telemetryEnabled` gate is removed; the function handles its own degradation internally.

### 4. TCP server and everything it touches are fully removed

`createTcpServer()`, port allocation (7331–7360), `panelSseStreams`, `DAEMON_PROXY_PORT`, `daemonProxyPort`, `relayPort`, `portMapping` — all deleted. `daemon.json` drops `proxyPort`. The `readWrapperProxyPort()` helper and port-change re-deploy logic in `wrapper-deploy.ts` are removed.

### 5. Daemon lifetime: extension heartbeats only, no change to protocol

The daemon's idle-exit logic already triggers when `registry.size() === 0`. With the TCP proxy gone, the daemon has no reason to stay alive without an extension connection. No changes to the heartbeat protocol or idle timeout — the current 10s idle window after last deregister is fine.

## Risks / Trade-offs

- **Stale wrappers**: Deployed wrappers with `DAEMON_PROXY_PORT` baked in will try the old TCP path and fail on HTTP-bridged servers. Wrapper version bump + `checkForStaleWrappers` forces re-deploy on next extension activation.
- **`panelSseStreams` removal**: This was dead code (no consumer ever opened `GET /events` on the TCP port); removal has no behavioral impact.
- **Concurrent wrapper processes appending to the same log file**: One file per server name, so each wrapper process has exclusive ownership in normal operation. Edge case of two simultaneous wrapper processes for the same server name is covered by POSIX append atomicity.
- **Extension reads logs from disk on panel open**: The extension currently receives history via the daemon's in-memory event list. After this change, panel history comes from reading JSONL files. That read path will need to be wired up in the extension — tracked as a task.
