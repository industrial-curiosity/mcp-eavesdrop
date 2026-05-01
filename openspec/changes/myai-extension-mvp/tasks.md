## 1. Project Scaffolding

- [ ] 1.1 Initialize `package.json` with VS Code extension manifest (name, publisher, engines, activationEvents, contributes.commands)
- [ ] 1.2 Add npm dependencies: `@modelcontextprotocol/sdk`, `ws`, `@types/ws`
- [ ] 1.3 Configure `tsconfig.json` for VS Code extension (CommonJS, ES2020, strict mode)
- [ ] 1.4 Add `.vscodeignore`, `.eslintrc`, and `esbuild` (or `webpack`) build script
- [ ] 1.5 Create the directory structure: `src/proxy/`, `src/panel/webview/`, `src/types/`

## 2. Shared Types

- [ ] 2.1 Create `src/types/events.ts` — define `McpEventType` union and `McpToolEvent` interface as per spec
- [ ] 2.2 Export types from a barrel `src/types/index.ts`

## 3. MCP Proxy Server

- [ ] 3.1 Create `src/proxy/server.ts` — HTTP server that binds to `127.0.0.1:0`, reports port via stdout `{"port": N}`; add `process.stdin.resume()` + `process.stdin.on('end', () => process.exit(0))` for parent-death detection
- [ ] 3.2 Implement MCP JSON-RPC forwarding: accept POST `/mcp` (or namespace route), forward to upstream URL, return response
- [ ] 3.3 Add request interceptor: before forwarding, emit `tool_call_started` with UUID, toolName, serverName, arguments (truncated to 10KB)
- [ ] 3.4 Add response interceptor: after receiving upstream response, emit `tool_call_completed` or `tool_call_failed` with durationMs and result (truncated to 10KB)
- [ ] 3.5 Create `src/proxy/eventEmitter.ts` — WebSocket server at `/events`, broadcast `McpToolEvent` JSON to all connected clients
- [ ] 3.6 Handle client connect/disconnect from WebSocket broadcast list without errors
- [ ] 3.7 Handle upstream unreachable: return JSON-RPC error code `-32000` to caller and emit `tool_call_failed`

## 4. Extension Host

- [ ] 4.1 Create `src/extension.ts` — `activate()` function that spawns `src/proxy/server.ts` as a child process via `child_process.spawn`
- [ ] 4.2 Parse proxy stdout for `{"port": N}` JSON; set 5-second timeout and disable `myai.openPanel` on failure
- [ ] 4.3 Register `myai.openPanel` command — opens/reveals `AgentPanel` and sends `init` message with `proxyPort`
- [ ] 4.4 Register `myai.clearSession` command — broadcasts `session_cleared` event via proxy WebSocket
- [ ] 4.5 Implement `deactivate()` — send SIGTERM to proxy, SIGKILL after 2s if still running
- [ ] 4.6 Handle unexpected proxy exit: log exit code and attempt one restart

## 5. WebView Panel Controller

- [ ] 5.1 Create `src/panel/AgentPanel.ts` — `createOrShow()` static method, open in `ViewColumn.Beside`, `retainContextWhenHidden: true`
- [ ] 5.2 Set WebView HTML from `src/panel/webview/index.html` with strict CSP (no inline scripts without nonce, no external resources)
- [ ] 5.3 Handle `ready` message from WebView: send `init` message with `{ proxyPort }`
- [ ] 5.4 Handle `clearSession` message from WebView: trigger `myai.clearSession` logic

## 6. WebView Frontend

- [ ] 6.1 Create `src/panel/webview/index.html` — shell with toolbar ("AI Agent Monitor" title + "Clear" button), scrollable log container, CSP meta tag
- [ ] 6.2 Create `src/panel/webview/styles.css` — layout using `--vscode-*` CSS custom properties for all colors/fonts
- [ ] 6.3 Create `src/panel/webview/app.ts` — listen for `init` message, open WebSocket to `ws://127.0.0.1:<port>/events`
- [ ] 6.4 Implement WebSocket reconnect logic with exponential backoff (max 10s); show "Disconnected — reconnecting…" status
- [ ] 6.5 Render `tool_call_started`: append list entry with tool name + spinner; track by `id`
- [ ] 6.6 Update entry on `tool_call_completed`: replace spinner with ✓ indicator and `durationMs`
- [ ] 6.7 Update entry on `tool_call_failed`: show red error indicator, error message, and `durationMs` if present
- [ ] 6.8 Implement expand/collapse toggle per entry — show pretty-printed JSON for `arguments` and `result`/`error` using `textContent` (never `innerHTML`)
- [ ] 6.9 Auto-scroll to bottom on new events only when user is already at the bottom
- [ ] 6.10 Wire "Clear" button: clear DOM list, send `clearSession` message to extension host

## 7. Proxy Config Helper

- [ ] 7.1 Implement config snippet generator: read active workspace `mcp.json`, produce proxy-wrapped version with `"url": "http://127.0.0.1:<port>/<namespace>"` entries
- [ ] 7.2 Show generated snippet to user via VS Code notification or output channel (do not auto-write)

## 8. Build & Package

- [ ] 8.1 Confirm `vsce package` produces a `.vsix` without errors
- [ ] 8.2 Verify extension activates in Extension Development Host and `myai.openPanel` opens the panel
- [ ] 8.3 Manual smoke test: route a test MCP tool call through the proxy and confirm it appears in the panel
