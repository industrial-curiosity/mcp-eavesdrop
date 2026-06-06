## Context

VS Code extensions run in a sandboxed extension host process. MCP servers run as separate processes managed by the VS Code MCP runtime or the agent (e.g., Copilot). Currently, tool calls flow directly from agent → MCP server with no observation point available to third-party extensions.

This design introduces a transparent proxy layer that sits between the agent and its MCP servers, emitting structured events that a WebView panel can consume.

## Goals / Non-Goals

**Goals:**
- Transparently proxy MCP JSON-RPC traffic without breaking existing tool behavior
- Stream structured tool call events to a WebView panel in real time
- Keep the proxy isolated from the extension host (child process) for stability
- Work with any MCP client (VS Code, Cursor) using the standard HTTP transport

**Non-Goals:**
- Intercepting stdio-transport MCP servers (HTTP only in v1)
- Modifying tool call arguments or results
- Persisting events beyond the current session
- Supporting non-localhost upstream servers

## Decisions

### 1. Proxy runs as a child process (not in-process)

**Decision:** Spawn the proxy as a `node` child process via `child_process.spawn`.

**Rationale:** The extension host has a restricted event loop; running an HTTP server in-process risks blocking it. A child process isolates crashes — if the proxy dies, the extension continues. Port is reported back to the parent via stdout JSON (`{"port": N}`).

**Alternative considered:** In-process `http.createServer` — rejected because Node's built-in HTTP server is synchronous in the extension host context and long-lived connections would degrade editor performance.

---

### 2. WebSocket for event streaming (not SSE)

**Decision:** Use WebSocket at `/events` for pushing events from proxy to the WebView.

**Rationale:** The WebView can open a native WebSocket connection directly. SSE requires HTTP/1.1 keep-alive semantics that are awkward through VS Code's content security policy restrictions. WebSocket is simpler and bidirectional if needed later.

**Alternative considered:** VS Code `postMessage` relay (extension host proxies events to WebView) — more complex, adds latency and coupling.

---

### 3. MCP SDK for protocol handling

**Decision:** Use `@modelcontextprotocol/sdk` to implement the proxy as an MCP server and as the client that forwards requests upstream.

**Rationale:** Implementing JSON-RPC 2.0 + MCP framing manually is error-prone. The SDK handles request/response correlation, error codes, and protocol versioning. We wrap it with thin interceptor middleware.

---

### 4. Vanilla TypeScript WebView (no React)

**Decision:** The WebView frontend is vanilla TypeScript with DOM manipulation.

**Rationale:** Avoids bundler complexity and CSP issues with React's runtime. The UI is simple (a scrolling list + JSON expand). No framework dependency means faster load and easier security auditing.

---

### 5. Proxy config: user-assisted, not automatic

**Decision:** The extension generates the proxy `mcp.json` snippet and shows it to the user; it does NOT automatically patch the active `mcp.json`.

**Rationale:** Automatically writing config files is surprising and potentially destructive. Showing the snippet with a "copy" action keeps the user in control while still being helpful.

---

### 7. IPC Unix domain socket for proxy port discovery

**Decision:** The extension exposes the proxy port via a Unix domain socket at `$TMPDIR/mcpEavesdrop-extension.sock`. Any client that connects receives `{"port": N}` as a single newline-terminated JSON line, then the server closes the connection.

**Rationale:** The proxy binds to a random OS-assigned port each activation. External tools (test scripts, other processes) need a reliable way to discover the current port without manual lookup. A Unix socket is ephemeral (no file persists between sessions), avoids race conditions inherent in reading a port file, and is connection-based so there is no ambiguity about whether the value is stale.

**Alternative considered:** Writing the port to a temp file (`$TMPDIR/mcpEavesdrop-proxy.port`) — rejected because a file can be read before it is written (race), may persist across crashes leaving a stale value, and requires explicit cleanup.

---

### 6. Proxy self-terminates on parent death via stdin EOF

**Decision:** The proxy watches `process.stdin` for an `end` event and calls `process.exit(0)` when it fires.

**Rationale:** When the extension host process dies for any reason — crash, SIGKILL, OS termination — the OS automatically closes all file descriptors connected to the child's stdin pipe. This gives the proxy a guaranteed, zero-latency signal that the parent is gone, with no polling required and no false positives. It covers the gap left by `deactivate()`, which only runs on graceful shutdown.

The extension spawns the proxy with `stdio: ['pipe', 'pipe', 'pipe']` (default) so stdin is always a pipe, not inherited from the terminal.

**Alternative considered:** Periodic heartbeat (parent sends a ping on a timer; child exits if no ping within N seconds) — rejected because it adds a latency window before the child exits, requires a custom protocol, and risks false positives if the extension host is temporarily busy.

## Risks / Trade-offs

- **Child process orphaning** → Covered by two layers: `deactivate()` sends SIGTERM (SIGKILL after 2s) for graceful shutdown; stdin EOF handles crashes and unexpected kills
- **Port collision** → Proxy binds to port 0 (OS-assigned) and reports the actual port; no hardcoded ports
- **Upstream server unreachable** → Proxy returns a JSON-RPC error to the agent with the upstream error message; the panel shows `tool_call_failed`
- **Large payloads** → Arguments and results are truncated at 10KB before being emitted to the event stream to prevent WebView memory pressure
- **WebView CSP** → All dynamic content uses DOM APIs (`textContent`, `createElement`); no `innerHTML`; nonces are used for inline scripts if needed
- **Proxy restart → panel disconnect** → When the proxy restarts it binds to a new random port. The extension pushes a fresh `init` message to any open panel so it reconnects to the new port rather than retrying the dead one indefinitely
- **Panel lost on debug restart** → Extension Development Host reloads destroy all WebView panels. The extension persists the panel's open/closed state in `globalState` and automatically reopens the panel when the proxy reports its port after reactivation

## Open Questions

- Should the proxy config snippet be shown in a notification, a new tab, or inline in the panel?
- If the user has multiple workspace `mcp.json` files, which one is used for upstream discovery?
