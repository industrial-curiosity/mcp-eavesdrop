## Context

The extension currently starts a per-window IPC socket at a fixed path (`/tmp/myai-extension.sock` on Unix) and a per-window HTTP proxy child process on a random port. Every window activation calls `fs.unlinkSync` on the socket path before binding, which silently evicts any other running extension instance. This means only the last-activated window receives telemetry; prior windows' stdio-wrappers lose their connection without error.

The fix is a shared daemon subprocess — a detached Node.js process that all extension instances connect to and that owns the IPC socket and HTTP proxy for its lifetime. The daemon is spawned by the first extension that can acquire a lock file, and self-terminates when all connections are gone.

## Goals / Non-Goals

**Goals:**
- Eliminate the socket-path conflict between concurrent extension instances
- Provide a single stable address for all stdio-wrappers regardless of which IDE or window started them
- Preserve per-IDE/per-workspace telemetry in separate log files that survive daemon restarts
- Let every extension instance see all MCP activity across all connected windows
- Give the monitor panel cross-window connection visibility for log filtering

**Non-Goals:**
- Networked or cross-machine IPC
- In-memory state recovery after daemon restart (log files survive; in-memory event ring does not)
- Centralising MCP server config in the daemon

## Decisions

### 1. Daemon as a detached child process

**Decision:** The daemon runs as a separate `node dist/daemon/index.js` process spawned with `detached: true` and `stdio: 'ignore'`. The spawning extension calls `child.unref()` immediately so the extension host's exit does not kill the daemon.

**Alternatives considered:**
- *In-process in the first extension:* simpler, but the daemon dies when that window closes, requiring ownership handoff — complex and fragile.
- *System service / launchd:* persistent but requires installation privileges and is IDE-agnostic in a bad way (can't be started on demand by the extension).

**Rationale:** A detached subprocess is the lightest option that fully decouples daemon lifetime from any single extension window.

---

### 2. Bootstrap lock with atomic file creation

**Decision:** Before spawning the daemon the extension attempts to create `~/.myai/ipc.lock` with `O_CREAT | O_EXCL` (via `fs.openSync` with the `'wx'` flag). If creation succeeds it owns the lock, spawns the daemon, then deletes the lock. If creation fails another instance is already bootstrapping; the extension waits 200 ms and retries connecting to `~/.myai/ipc.sock` instead.

```
activate():
  loop:
    try connect ipc.sock → if OK: register, done
    try open ipc.lock (wx) → if OK: spawn daemon, wait for sock, done
    sleep 200ms, retry
```

**Rationale:** `O_CREAT | O_EXCL` is atomic on POSIX and on Windows (NTFS). No separate mutex primitive needed.

---

### 3. Daemon socket protocol — HTTP over Unix domain socket

**Decision:** The daemon exposes an HTTP/1.1 server bound to `~/.myai/ipc.sock` (Unix) or `\\.\pipe\myai-extension` (Windows). Extension instances communicate via standard HTTP requests. SSE (`text/event-stream`) is used for the push event channel.

**Endpoints:**

| Method | Path | Description |
|---|---|---|
| `POST` | `/register` | Register a connection `{ ide, workspace, workspaceSlug, instanceId }` |
| `POST` | `/deregister` | Deregister `{ instanceId }` |
| `POST` | `/heartbeat` | Keep-alive `{ instanceId }` |
| `GET` | `/events` | SSE stream — all events broadcast to all connections |
| `GET` | `/connections` | Returns all registered connection details |
| `POST` | `/shutdown` | Validated kill (daemon confirms it is the last connection) |
| `POST` | `/telemetry` | Inbound from stdio-wrappers `{ ide, workspace, instanceId?, event }` |

**Rationale:** Reuses the HTTP-over-Unix-socket pattern already in the codebase. No new IPC library required.

---

### 4. HTTP MCP proxy in the daemon

**Decision:** The daemon's HTTP server also acts as the MCP HTTP proxy on a separate **TCP** port (needed because IDE MCP clients cannot connect to a Unix socket). The port is selected dynamically (starting at 7331, incrementing on conflict) and written to:
1. `~/.myai/daemon.json` — machine-readable state file
2. The deployed `stdio-wrapper.js` file — so the wrapper knows the proxy address without a runtime file read

When the daemon starts or force-restarts on a new port, `wrapper-deploy` rewrites the embedded `DAEMON_PROXY_PORT` constant in the wrapper file.

Routing is stateless: the daemon uses the `x-upstream-url` request header (injected by the mcp.json wrapper at wrap time) to forward each request. No server registry needed in the daemon.

---

### 5. Stdio-wrapper connects to daemon socket

**Decision:** The stdio-wrapper reads its IPC target from its embedded `DAEMON_SOCKET_PATH` constant (written at deploy time). On connection failure it falls back to reading `~/.myai/daemon.json`. This handles the case where the daemon restarts on a different port after the wrapper process was already launched.

The wrapper's `ide` and `workspace` values are injected as env vars (`MYAI_IDE`, `MYAI_WORKSPACE_SLUG`) by the extension at mcp.json wrap time, alongside the existing `MYAI_IPC_SOCKET`, `MYAI_REAL_SERVER`, and `MYAI_REAL_URL` env vars.

---

### 6. Event broadcast — fan-out to all SSE connections

**Decision:** All telemetry events are broadcast to every open SSE connection. Extension instances filter by `ide`/`workspaceSlug` in the event payload as desired. The daemon does not implement per-connection filtering.

**Rationale:** Simplest daemon implementation. Loopback SSE traffic is negligible. Gives every window full visibility, which is a feature not a cost.

---

### 7. Log persistence

**Decision:** The daemon appends each telemetry event as a newline-delimited JSON record to `~/.myai/logs/{ide}/{workspace_slug}.jsonl`. The extension reads log files directly from disk (no daemon query); the daemon only writes.

File naming: `{ide}` is the lowercase IDE identifier (`vscode`, `cursor`); `{workspace_slug}` is the workspace name lowercased with non-alphanumeric characters replaced by underscores.

The daemon creates `~/.myai/logs/{ide}/` directories on first write. No rotation strategy in this change.

---

### 8. Heartbeat and stale connection eviction

**Decision:**
- Extensions send `POST /heartbeat { instanceId }` every **30 seconds**
- Daemon polls its registry every **30 seconds**; any connection with `lastHeartbeat` older than **90 seconds** (3× interval) is evicted and its SSE stream closed
- Eviction is "hard" (registration removed); the extension's reconnect loop handles re-registration

**Rationale:** 90-second window gives headroom for backgrounded IDE processes that may pause timers.

---

### 9. Extension reconnect loop

**Decision:**
```
on SSE close or socket error:
  close SSE subscription
  attempt = 0
  loop:
    wait 5s
    try connect ipc.sock
    if success → re-register → resubscribe SSE → done
    attempt++
    if attempt % 3 == 0:
      show alert: "MyAI: Lost connection to daemon. [Keep Trying] [Restart Daemon]"
      [Restart Daemon] → POST /shutdown (if daemon alive), then replay startup
    probe daemon liveness: check daemon.pid or attempt connect
    if daemon dead → replay full startup sequence (lock → spawn → connect)
```

---

### 10. Shutdown protocol

**Decision (Approach 3):**
On `deactivate()`:
1. Extension calls `GET /connections`; if `total == 1` (itself), sends `POST /shutdown`
2. The daemon validates at shutdown time that connection count is ≤ 1 before exiting
3. The daemon also has an idle-poll fallback: if no connections survive a full heartbeat polling cycle, it exits after a 10-second grace period

The forced restart path (`[Restart Daemon]`) calls `POST /shutdown { force: true }` which bypasses the last-connection check.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Lock file left behind after crash | Bootstrap logic: if lock is stale (age > 10s with no daemon running), delete and retry |
| Daemon starts on a different port after force restart; existing wrappers have stale port | Wrapper falls back to reading `daemon.json`; extension re-instruments mcp.json if port changed |
| Daemon socket permissions (multi-user machine) | Socket created with mode `0600`; only the owning user can connect |
| Windows named pipe path collision across users | Include username in pipe name: `\\.\pipe\myai-extension-{username}` |
| SSE broadcast to N connections adds latency under high event volume | Loopback only; benchmarked acceptable for expected event rates |
| `O_CREAT|O_EXCL` lock race on network filesystems (if `~/.myai` is on NFS) | Not supported; `~/.myai` must be on local filesystem (document this) |

## Migration Plan

1. On extension activation: if old socket (`/tmp/myai-extension.sock`) exists and old-style proxy is running, stop them gracefully before starting daemon bootstrap
2. The `uninstall-lifecycle` path (`lifecycle.ts`) is unchanged — it still restores mcp.json entries regardless of daemon state
3. No database migration; logs start fresh in `~/.myai/logs/`. Existing in-memory session history is not migrated.
4. Rollback: revert the extension package; the wrapper entries in mcp.json are restored by lifecycle.ts on uninstall/reinstall

---

### 11. Side-effect-free constants module

**Decision:** All constants shared between the daemon process and the extension host (currently: `DAEMON_SOCKET_PATH`) SHALL be defined in `src/daemon/constants.ts`. This module exports only computed values; it has no module-level server startup, no `process.exit`, and no global state.

**Rationale:** esbuild bundles all transitively imported modules into a single output file. If `extension.ts` imported `DAEMON_SOCKET_PATH` from `daemon/index.ts`, the bundler would include `daemon/index.ts` in its entirety — including the `main().catch(() => process.exit(1))` invocation at module level. This causes the extension host to call `process.exit(1)` during module evaluation, crashing the process before `activate()` is called.

**Rule:** Any future constant or utility shared between the daemon and the extension MUST be placed in `src/daemon/constants.ts` or a dedicated side-effect-free module — never in `daemon/index.ts`.

## Open Questions

- Should `~/.myai/logs/` files be capped (e.g. 10 MB per file) or rotated? Deferred to a follow-up change.
- ~~Should the daemon expose a health/version endpoint for diagnostics?~~ Addressed: `GET /debug/streams` added for SSE stream introspection; `/connections` already returns full registry state.
