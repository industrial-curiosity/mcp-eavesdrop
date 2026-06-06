## 1. Project Scaffolding

- [x] 1.1 Initialize `package.json` with VS Code extension manifest (name, publisher, engines, activationEvents, contributes.commands)
- [x] 1.2 Add npm dependencies: `@modelcontextprotocol/sdk`, `ws`, `@types/ws`
- [x] 1.3 Configure `tsconfig.json` for VS Code extension (CommonJS, ES2020, strict mode)
- [x] 1.4 Add `.vscodeignore`, `.eslintrc`, and `esbuild` (or `webpack`) build script
- [x] 1.5 Create the directory structure: `src/proxy/`, `src/panel/webview/`, `src/types/`

## 2. Shared Types

- [x] 2.1 Create `src/types/events.ts` — define `McpEventType` union and `McpToolEvent` interface as per spec
- [x] 2.2 Export types from a barrel `src/types/index.ts`

## 3. MCP Proxy Server

- [x] 3.1 Create `src/proxy/server.ts` — HTTP server that binds to `127.0.0.1:0`, reports port via stdout `{"port": N}`; add `process.stdin.resume()` + `process.stdin.on('end', () => process.exit(0))` for parent-death detection
- [x] 3.2 Implement MCP JSON-RPC forwarding: accept POST `/mcp` (or namespace route), forward to upstream URL, return response
- [x] 3.3 Add request interceptor: before forwarding, emit `tool_call_started` with UUID, toolName, serverName, arguments (truncated to 10KB)
- [x] 3.4 Add response interceptor: after receiving upstream response, emit `tool_call_completed` or `tool_call_failed` with durationMs and result (truncated to 10KB)
- [x] 3.5 Create `src/proxy/eventEmitter.ts` — WebSocket server at `/events`, broadcast `McpToolEvent` JSON to all connected clients
- [x] 3.6 Handle client connect/disconnect from WebSocket broadcast list without errors
- [x] 3.7 Handle upstream unreachable: return JSON-RPC error code `-32000` to caller and emit `tool_call_failed`

## 4. Extension Host

- [x] 4.1 Create `src/extension.ts` — `activate()` function that spawns `src/proxy/server.ts` as a child process via `child_process.spawn`
- [x] 4.2 Parse proxy stdout for `{"port": N}` JSON; set 5-second timeout and disable `mcpEavesdrop.openPanel` on failure
- [x] 4.3 Register `mcpEavesdrop.openPanel` command — opens/reveals `AgentPanel` and sends `init` message with `proxyPort`
- [x] 4.4 Register `mcpEavesdrop.clearSession` command — broadcasts `session_cleared` event via proxy WebSocket
- [x] 4.5 Implement `deactivate()` — send SIGTERM to proxy, SIGKILL after 2s if still running
- [x] 4.6 Handle unexpected proxy exit: log exit code and attempt one restart
- [x] 4.7 Open a Unix domain socket IPC server at `$TMPDIR/mcpEavesdrop-extension.sock`; respond to each connection with `{"port": N}` then close; remove stale socket on activate and clean up on deactivate
- [x] 4.8 After proxy reports its port, reopen the panel if `globalState('panelWasOpen')` is true; add `AgentPanel.notifyProxyPort()` to push new port to an already-open panel without revealing it; set `globalState('panelWasOpen')` on open/close via `AgentPanel.onDidDispose`

## 5. WebView Panel Controller

- [x] 5.1 Create `src/panel/AgentPanel.ts` — `createOrShow()` static method, open in `ViewColumn.Beside`, `retainContextWhenHidden: true`
- [x] 5.2 Set WebView HTML from `src/panel/webview/index.html` with strict CSP (no inline scripts without nonce, no external resources)
- [x] 5.3 Handle `ready` message from WebView: send `init` message with `{ proxyPort }`
- [x] 5.4 Handle `clearSession` message from WebView: trigger `mcpEavesdrop.clearSession` logic

## 6. WebView Frontend

- [x] 6.1 Create `src/panel/webview/index.html` — shell with toolbar ("AI Agent Monitor" title + "Clear" button), scrollable log container, CSP meta tag
- [x] 6.2 Create `src/panel/webview/styles.css` — layout using `--vscode-*` CSS custom properties for all colors/fonts
- [x] 6.3 Create `src/panel/webview/app.ts` — listen for `init` message, open WebSocket to `ws://127.0.0.1:<port>/events`
- [x] 6.4 Implement WebSocket reconnect logic with exponential backoff (max 10s); show "Disconnected — reconnecting…" status
- [x] 6.5 Render `tool_call_started`: append list entry with tool name + spinner; track by `id`
- [x] 6.6 Update entry on `tool_call_completed`: replace spinner with ✓ indicator and `durationMs`
- [x] 6.7 Update entry on `tool_call_failed`: show red error indicator, error message, and `durationMs` if present
- [x] 6.8 Implement expand/collapse toggle per entry — show pretty-printed JSON for `arguments` and `result`/`error` using `textContent` (never `innerHTML`)
- [x] 6.9 Auto-scroll to bottom on new events only when user is already at the bottom
- [x] 6.10 Wire "Clear" button: clear DOM list, send `clearSession` message to extension host

## 7. Proxy Config Helper

- [x] 7.1 Implement config snippet generator: read active workspace `mcp.json`, produce proxy-wrapped version with `"url": "http://127.0.0.1:<port>/<namespace>"` entries
- [x] 7.2 Show generated snippet to user via VS Code notification or output channel (do not auto-write)

## 8. Build & Package

- [x] 8.1 Confirm `vsce package` produces a `.vsix` without errors
- [x] 8.2 Verify extension activates in Extension Development Host and `mcpEavesdrop.openPanel` opens the panel
- [x] 8.3 Manual smoke test: route a test MCP tool call through the proxy and confirm it appears in the panel
