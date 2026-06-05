# myai-extension — Technical Specification

## 1. Project Structure

```text
myai-extension/
├── package.json               # VS Code extension manifest
├── src/
│   ├── extension.ts           # Extension entry point (activate/deactivate)
│   ├── lifecycle.ts           # Uninstall restore script entry point
│   ├── mcp-config.ts          # IDE detection and config path helpers
│   ├── mcp-wrap.ts            # Wrap/unwrap MCP entry helpers
│   ├── monitoring-commands.ts # Enable/disable monitoring commands
│   ├── proxy/
│   │   ├── server.ts          # MCP proxy server (spawned as child process)
│   │   ├── stdio-wrapper.ts   # Stdio MCP wrapper process
│   │   └── eventEmitter.ts    # WebSocket/SSE event broadcaster
│   ├── panel/
│   │   ├── AgentPanel.ts      # WebView panel controller
│   │   └── webview/
│   │       ├── index.html     # WebView shell
│   │       ├── app.ts         # WebView frontend (vanilla TS or React)
│   │       └── styles.css
│   ├── stale-check.ts         # Activation stale-wrapper detection
│   ├── wrapper-deploy.ts      # Stable wrapper deployment to ~/.myai/
│   └── types/
│       └── events.ts          # Shared event type definitions
├── docs/
│   ├── overview.md
│   └── spec.md
└── README.md
```

---

## 2. Components

### 2.1 Extension Host (`src/extension.ts`)

**Responsibilities:**

- Register the `myai.openPanel` command
- On activation, spawn the proxy server as a managed child process
- Pass the proxy's port/address to the WebView panel
- On deactivation, kill the proxy process cleanly

**Activation events:**

```json
"activationEvents": ["onStartupFinished"]
```

**Commands registered:**

| Command | Title |
| --- | --- |
| `myai.openPanel` | AI Agent Monitor: Open Panel |
| `myai.clearSession` | AI Agent Monitor: Clear Session |

---

### 2.2 MCP Proxy Server (`src/proxy/server.ts`)

The proxy is a local HTTP server implementing the MCP JSON-RPC protocol. It runs as a child process spawned by the extension host.

**Protocol:** MCP over HTTP (JSON-RPC 2.0), same as standard MCP servers.

**Startup:**

- Binds to `127.0.0.1` on a random available port (avoids conflicts)
- Reports the bound port to the parent process via stdout (`{"port": 54321}`)
- Opens a WebSocket server on the same port at path `/events` for the extension panel to subscribe to

**Request handling flow:**

```text
Agent → [POST /mcp] → Proxy
                         │
                         ├── emit event: tool_call_started
                         ├── forward request to real MCP server
                         ├── receive response
                         ├── emit event: tool_call_completed | tool_call_failed
                         └── return response to agent
```

**Target server configuration:**

- Proxy reads a config object passed at startup (or from VS Code settings) mapping tool namespaces to their real upstream MCP server URLs
- Fallback: proxy discovers upstream URLs from the active `mcp.json` in the workspace

---

### 2.3 Event Types (`src/types/events.ts`)

```typescript
type McpEventType =
  | "tool_call_started"
  | "tool_call_completed"
  | "tool_call_failed"
  | "session_cleared";

interface McpToolEvent {
  id: string;              // UUID for correlating start/complete pairs
  type: McpEventType;
  timestamp: number;       // Unix ms
  toolName: string;        // e.g. "file_search", "run_in_terminal"
  serverName: string;      // which MCP server owns this tool
  arguments?: unknown;     // present on started
  result?: unknown;        // present on completed
  error?: string;          // present on failed
  durationMs?: number;     // present on completed/failed
  ide?: string;            // IDE identifier (vscode, cursor) — added by daemon
  workspaceSlug?: string;  // workspace slug — added by daemon
  conversationId?: string; // VS Code chat session ID — present when call originated from a chat session
  requestId?: string;      // VS Code chat request ID — future-proofed, captured but not displayed
  meta?: Record<string, unknown>; // full _meta object from JSON-RPC request — preserved for observability
}
```

---

### 2.4 WebView Panel (`src/panel/AgentPanel.ts`)

**Panel behavior:**

- Opens in the secondary editor column (beside the active editor)
- Persists across editor restarts via `retainContextWhenHidden: true`
- Fully passive: does **not** make any direct network connections (no EventSource, no WebSocket, no HTTP fetch)
- All events are pushed from the extension host via `panel.webview.postMessage`

**Architecture constraint:** VS Code webviews run in a sandboxed Electron renderer. Outbound `EventSource` and `WebSocket` connections to localhost are unreliable even with correct CSP and `portMapping`. The standard VS Code pattern is for the extension host (Node.js) to own all network I/O and push data to the webview.

**Message protocol (extension host ↔ WebView):**

| Direction | Message type | Payload |
| --- | --- | --- |
| Host → WebView | `status` | `{ connected: boolean }` |
| Host → WebView | `event` | `{ event: McpToolEvent }` |
| Host → WebView | `connections` | `{ connections: Connection[] }` |
| Host → WebView | `history` | `{ events: McpToolEvent[] }` |
| WebView → Host | `clearSession` | `{}` |
| WebView → Host | `ready` | `{}` |
| WebView → Host | `requestHistory` | `{}` |

---

### 2.5 WebView UI (`src/panel/webview/`)

**Layout:**

```text
┌──────────────────────────────────────────────────────────────┐
│  AI Agent Monitor                              [Clear]        │
├────────────────────┬─────────────────────────────────────────┤
│  Connections       │  [tool name…] [All servers▾] [All▾] [All▾] │
│  sidebar           ├─────────────────────────────────────────┤
│  ☑ vscode:ws1      │  ● file_search           12ms  ✓        │
│  ☐ cursor:ws2      │  ● run_in_terminal       ...   ⟳        │
│                    │  ● grep_search           8ms   ✓        │
│                    │    ▼ Arguments                           │
│                    │      { "query": "activation" }           │
│                    │    ▼ Result                              │
│                    │      [ "src/extension.ts" ]              │
└────────────────────┴─────────────────────────────────────────┘
```

**UI requirements:**

- Panel body is a two-column flex layout: `.connections-sidebar` (180px fixed) and `.main-content` (remaining space)
- The connections sidebar renders all active daemon connections, each with a checkbox to include/exclude that connection's events; checkbox state is persisted in `localStorage`
- Filter bar sits above the log; contains five controls: sort toggle (newest first / oldest first), tool name text input, server select, status select (All / In-progress / Completed / Failed), time range select (All / Last hour / Today)
- All four filter controls apply simultaneously (AND logic) via `reapplyFilters()`
- Filter bar state is in-memory only and resets when the panel is reopened
- Each log entry shows a left-side timestamp column sourced from `event.timestamp`
- In-progress tools display a spinner and no duration until completed
- Failed tools display in red with the error message
- Each entry is expandable to show full arguments, result, and `meta` when present (JSON, pretty-printed)
- Session log scrolls to latest entry automatically
- "Clear" button emits `clearSession` to host and resets local state
- Uses VS Code's CSS custom properties (`--vscode-*`) for full theme compatibility

---

## 3. MCP Proxy Configuration

Users configure their MCP clients (VS Code, Cursor) to route tool calls through the proxy.

**Before (direct connection):**

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
    }
  }
}
```

**After (via proxy):**
The extension auto-generates a proxy config and either:

- Writes it to a temporary `mcp.json` and prompts the user to use it, or
- Provides a command to patch the active `mcp.json` in place (with user confirmation)

The proxy config wraps each server entry:

```json
{
  "mcpServers": {
    "filesystem": {
      "url": "http://127.0.0.1:{proxy_port}/filesystem"
    }
  }
}
```

---

## 4. Security Considerations

- Proxy binds only to `127.0.0.1` (loopback) — not accessible from the network
- No credentials or tokens are logged by default; response bodies are truncated at 10KB in the event stream to prevent sensitive data leakage in the UI
- The WebView uses a strict Content Security Policy; no inline scripts
- Tool arguments and results are sanitized before rendering (XSS prevention via DOM API, not innerHTML)

---

## 5. Non-Goals

- Observing Copilot's or Cursor's proprietary internal agent steps or LLM reasoning
- Intercepting non-MCP built-in tools (e.g., Copilot's native file read)
- Recording or replaying agent sessions to external services
- Supporting remote (non-localhost) MCP server proxying in v1

---

## 6. Dependencies

| Package | Purpose |
| --- | --- |
| `@modelcontextprotocol/sdk` | MCP server/client implementation |
| `ws` | WebSocket server for event streaming |
| `vscode` (peer) | VS Code extension API |

No UI framework dependency in v1 — the WebView frontend is vanilla TypeScript to keep the bundle small and avoid CSP complexity.

---

## 7. Open Questions

- Should the proxy config patching be automatic (with confirmation) or fully manual with instructions?
- Should completed sessions be persisted to disk for later review, or in-memory only?
- Is there value in a tree view in the Activity Bar (sidebar) in addition to or instead of the WebView panel?
- Should the extension support multiple simultaneous proxy targets (e.g., one per MCP server type)?
