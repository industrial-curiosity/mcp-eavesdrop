## 1. Shared Infrastructure

- [x] 1.1 Add `MYAI_*` env var constants to `src/types/index.ts` (`MYAI_IPC_SOCKET`, `MYAI_REAL_SERVER`, `MYAI_SERVER_NAME`, `MYAI_CONFIG_PATH`, `MYAI_EXT_DIR`, `MYAI_WRAPPER_VERSION`)
- [x] 1.2 Create `src/mcp-config.ts` — IDE detection (`detectIde()`), platform-aware user config path resolution (`resolveUserMcpConfigPath()`), and root key selection (`"servers"` vs `"mcpServers"`)
- [x] 1.3 Write unit tests for `resolveUserMcpConfigPath()` covering VS Code and Cursor on macOS, Linux, and Windows (mock `process.platform` and `os.homedir()`)
- [x] 1.4 Create `src/mcp-wrap.ts` — `wrapEntry()` transforms a single server entry into its wrapped form; `unwrapEntry()` reconstructs original from `MYAI_*` env vars; `isWrapped()` detection
- [x] 1.5 Write unit tests for `wrapEntry()` and `unwrapEntry()` using a stdio entry and an HTTP entry — verify round-trip fidelity including original env var preservation

## 2. Stdio Wrapper Process

- [x] 2.1 Create `src/proxy/stdio-wrapper.ts` with version comment `// MYAI_WRAPPER_VERSION=1` on line 1
- [x] 2.2 Implement startup: read `MYAI_REAL_SERVER`, `MYAI_IPC_SOCKET`, `MYAI_EXT_DIR` from env; check extension directory existence; if missing, invoke self-heal and exec real server
- [x] 2.3 Implement self-heal: read `MYAI_CONFIG_PATH` and `MYAI_SERVER_NAME`, restore the original entry in `mcp.json`, spawn the real server with `stdio: 'inherit'`, and exit
- [x] 2.4 Implement stdio relay: spawn real server child process, pipe `process.stdin → child.stdin` and `child.stdout → process.stdout` as raw byte streams; forward `child.stderr → process.stderr`
- [x] 2.5 Implement JSON-RPC tap: buffer stdout bytes, detect complete JSON-RPC messages by parsing newline-delimited or length-prefixed frames, identify `tools/call` requests and their responses
- [x] 2.6 Implement telemetry POST: send `tool_call_started` on request detection, `tool_call_completed` / `tool_call_failed` on response; fire-and-forget with 500ms timeout; log to stderr on failure; never throw
- [x] 2.7 Implement graceful degradation: if IPC socket unreachable at startup, log warning to stderr and continue in passthrough mode with no telemetry
- [x] 2.8 Implement exit handling: on `child.exit`, exit with same code; on `process.stdin` EOF, send SIGTERM to child then exit
- [x] 2.9 Add `stdio-wrapper` entry point to `build.mjs` so it compiles to `dist/proxy/stdio-wrapper.js` as a standalone script
- [x] 2.10 Write integration test in `scripts/test-wrapper.mjs`: spawn wrapper pointing at a mock stdio MCP server, verify stdio relay works, verify telemetry POST is made for a `tools/call` message

## 3. Proxy: Telemetry Endpoint

- [x] 3.1 Add `POST /internal/telemetry` handler in `src/proxy/server.ts`: parse body as `McpToolEvent`, validate required fields (`id`, `type`, `timestamp`), broadcast via `EventBroadcaster`, respond `200 {}`
- [x] 3.2 Return `400` for malformed or missing required fields without broadcasting
- [x] 3.3 Update `scripts/test-proxy.mjs` to include a test for the new `/internal/telemetry` endpoint

## 4. Wrapper Deployment

- [x] 4.1 Create `src/wrapper-deploy.ts` — `deployWrapper(context)`: resolves stable path (`~/.myai/stdio-wrapper.js`), reads version from deployed file if present, compares with bundled, copies if missing or stale
- [x] 4.2 Handle Windows path (`%USERPROFILE%\.myai\`) and directory creation with `fs.mkdirSync({ recursive: true })`
- [x] 4.3 Write test: mock filesystem, verify deploy creates directory and file on first run; verify overwrite on version mismatch; verify skip on version match

## 5. Enable / Disable Commands

- [x] 5.1 Create `src/monitoring-commands.ts` — `registerMonitoringCommands(context)` wires up `myai.enableMonitoring` and `myai.disableMonitoring`
- [x] 5.2 Implement `enableMonitoring`: detect IDE, resolve config path, show info message with path and trust-prompt warning, offer "Enable" / "Cancel"; on confirm: deploy wrapper, read `mcp.json`, wrap all unwrapped entries, write file
- [x] 5.3 Handle edge cases in enable: config file not found (show error with expected path); all entries already wrapped (show info, no action)
- [x] 5.4 Implement `disableMonitoring`: read `mcp.json`, unwrap all `MYAI_IPC_SOCKET` entries via `unwrapEntry()`, write file, show confirmation; handle no wrapped entries gracefully
- [x] 5.5 Add `myai.enableMonitoring` and `myai.disableMonitoring` to `contributes.commands` in `package.json` with display titles "MyAI: Enable MCP Monitoring" and "MyAI: Disable MCP Monitoring"
- [x] 5.6 Register commands in `src/extension.ts` by calling `registerMonitoringCommands(context)` from `activate()`

## 6. Stale Wrapper Detection on Activate

- [x] 6.1 Create `src/stale-check.ts` — `checkForStaleWrappers(configPath, rootKey)`: reads `mcp.json`, finds wrapped entries where `args[0]` path does not exist on disk, returns list
- [x] 6.2 Call `checkForStaleWrappers()` from `activate()` after proxy starts; if any stale entries found, show warning notification with the re-enable command
- [x] 6.3 Write unit test: mock filesystem and `mcp.json` with a wrapped entry pointing to a non-existent path; verify warning is returned

## 7. Uninstall Lifecycle Script

- [x] 7.1 Create `src/lifecycle.ts` — standalone Node.js script (no `vscode` imports); implement `resolveAllMcpConfigPaths()` returning all possible `mcp.json` paths for VS Code and Cursor on the current platform
- [x] 7.2 Implement main logic: for each path, read and parse `mcp.json` if it exists; restore all wrapped entries; write back; log each restored entry and any skipped files to stdout
- [x] 7.3 Implement `~/.myai/` deletion with `fs.rmSync({ recursive: true, force: true })`
- [x] 7.4 Add `lifecycle` entry point to `build.mjs` compiling to `dist/lifecycle.js`
- [x] 7.5 Add `"vscode:uninstall": "node ./dist/lifecycle.js"` to `scripts` in `package.json`
- [x] 7.6 Write unit test for `lifecycle.ts`: mock filesystem with two `mcp.json` files (VS Code and Cursor paths), both containing wrapped entries; verify both are fully restored and `~/.myai/` is removed

## 8. Documentation

- [x] 8.1 Update `README.md`: add "MCP Monitoring" section describing enable/disable commands, the trust prompt expectation, and how to restore config if the extension is uninstalled without using the disable command
- [x] 8.2 Update `docs/spec.md` or equivalent to reflect the new `stdio-wrapper.ts` and `lifecycle.ts` in the project structure diagram

## 9. Show Config Command Improvements

- [x] 9.1 Refactor `readMcpConfig()` to enumerate entries from both `"servers"` and `"mcpServers"` root keys in any `mcp.json` file
- [x] 9.2 Remove workspace-to-user-config fallback: revert the `.vscode/mcp.json` lookup in `readMcpConfig()` so `myai.showMcpConfig` reads only the IDE user-level `mcp.json`; workspace config support is deferred to a future phase
- [x] 9.3 Extend `showProxyConfigSnippet()` to display all server types — HTTP servers get a proxy snippet; stdio servers are listed with command/args and a note directing the user to "MyAI: Enable MCP Monitoring"
- [x] 9.4 Annotate output with the source config file path so the user knows which file was read
- [x] 9.5 Show a success notification toast after generating the snippet ("MCP config summary generated from <source>. See Output → MyAI.")

## 10. Smoke Test Reliability Fix

- [x] 10.1 Fix `scripts/test-proxy.mjs` internal telemetry test: post both `tool_call_started` and `tool_call_completed` events with the same `id`, and assert both broadcasts arrive — prevents a ghost in-progress spinner in the AI Agent Monitor panel during the test
