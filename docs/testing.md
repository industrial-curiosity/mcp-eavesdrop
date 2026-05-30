# Testing Guide

Step-by-step instructions for verifying the myai-extension MVP before shipping.

---

## Prerequisites

Install the VS Code extension packaging tool if you don't have it:

```bash
npm install -g @vscode/vsce
```

Confirm it's available:

```bash
vsce --version
```

---

## Task 8.1 — Package the extension as a `.vsix`

1. From the repo root, install dependencies (skip if already done):

   ```bash
   npm install
   ```

2. Build the extension:

   ```bash
   npm run build
   ```

3. Package it:

   ```bash
   npm run package
   ```

   Expected output: a file named `myai-extension-0.1.0.vsix` in the repo root with no errors.

4. Confirm the package contents look correct:

   ```bash
   vsce ls
   ```

   You should see `dist/extension.js`, `dist/proxy/server.js`, `dist/panel/webview/app.js`, `dist/panel/webview/index.html`, and `dist/panel/webview/styles.css` listed. You should **not** see `src/`, `node_modules/`, or `openspec/`.

---

## Task 8.2 — Activate the extension in the Extension Development Host

1. Open the repo in VS Code.

2. Confirm `.vscode/launch.json` exists in the repo root. It should already be present; if not, create it with the `extensionHost` launch configuration (see the file committed alongside this guide).

3. Press **F5** (or **Run → Start Debugging**). The debug picker may appear — select **Run Extension**. A new window labeled **[Extension Development Host]** opens as an empty window (no workspace folder).

   > **If VS Code asks "You don't have an extension for debugging Markdown"** it means the launch configuration is missing or no debug configuration was selected. Make sure `.vscode/launch.json` exists and retry.

   > **Opening a workspace in the EDH**: the launch config does not open a folder automatically. If a test step requires workspace context (MCP config paths, `File → Open Folder…` test scenarios), open a folder manually once the EDH window is open: **File → Open Folder…** → select this repo or any test folder.

   > **Cursor**: Use the same **Run Extension** launch config. If you see `NoWorkspaceUriError` in the debug console, open a folder in the EDH window (**File → Open Folder…** → this repo).

3. In the Extension Development Host window, open the **Output** panel (`View → Output`) and select **MyAI** from the channel dropdown.

4. Confirm you see a line like:

   ```
   MyAI: Proxy listening on port 12345
   ```

   The port number will vary.

5. Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and run **MyAI: Open Agent Monitor Panel**.

6. A panel titled **AI Agent Monitor** should open to the right of the active editor. The toolbar shows "AI Agent Monitor" and a "Clear" button. The log area is empty.

7. Confirm the status bar or Output panel shows no errors. If the proxy failed to start within 5 seconds, you will see an error notification — check the **MyAI** output channel for details.

---

## Task 8.3 — Smoke test: route a real MCP tool call through the proxy

### 3a. Confirm the extension is running

In the **MyAI** output channel you should see:

```
MyAI: IPC socket at /var/folders/.../myai-extension.sock
MyAI: Proxy listening on port 12345
```

The test script communicates with the extension directly via the IPC socket to discover the port — no manual copying required.

### 3b. Send a test `tools/call` request using the test script

The test script (`scripts/test-proxy.mjs`) spins up its own mock MCP server, routes a `tools/call` through the extension proxy, and asserts the response is correct. No external servers or network access required.

**Port auto-discovery (recommended):** the script connects to the extension's IPC socket to query the port, so no flag is needed:

```bash
node scripts/test-proxy.mjs
```

**Manual override** (if the extension isn't running or you want to target a specific port):

```bash
node scripts/test-proxy.mjs -p <PORT>
```

Expected output:

```
Mock MCP server  listening on 127.0.0.1:XXXXX

Sending tools/call "echo-test" through proxy on port <PORT>...

Response from proxy:
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [ { "type": "text", "text": "Mock result for tool \"echo-test\"" } ],
    "echoed_arguments": { "message": "hello from smoke test", "timestamp": ... }
  }
}

PASS — response is correct.
Check the AI Agent Monitor panel: you should see an "echo-test" entry with a green ✓ and a duration.
```

The script also sends a synthetic internal telemetry pair (`tool_call_started` then `tool_call_completed`) to verify `/internal/telemetry` broadcasting without leaving an in-progress spinner in the panel.

### 3c. Verify the panel updates

After the script completes, look at the **AI Agent Monitor** panel in the Extension Development Host window:

1. An entry for `echo-test` appears with a green `✓` and the duration in milliseconds.
2. Click the entry to expand it — the **Arguments** section shows pretty-printed JSON for `{ "message": "hello from smoke test", "timestamp": ... }`.
3. If the proxy was unreachable, the script exits with a non-zero code and the entry shows a red `✗`.

### 3d. Test the Clear button

1. Click the **Clear** button in the panel toolbar. All entries disappear.
2. In the **MyAI** output channel you should see no errors. A `session_cleared` event was broadcast internally to reset clients.

### 3e. Test the proxy config helper

1. Open a workspace folder in the Extension Development Host if one is not already open (**File → Open Folder…** → this repo). Then create a `.vscode/mcp.json` in that folder:

   ```json
   {
     "servers": {
       "context7": { "type": "http", "url": "http://localhost:8080/" }
     }
   }
   ```

2. Run **MyAI: Show Proxy MCP Config** from the Command Palette.

3. The **MyAI** output channel opens and shows a JSON snippet with `context7` re-pointed to `http://127.0.0.1:<PORT>/context7`.

---

---

## Unit / integration test scripts

These scripts are standalone Node.js programs that can be run without the Extension Development Host. All require `npm run build` first.

---

### `test-mcp-config.mjs` — MCP config path resolution

Verifies that `resolveUserMcpConfigPath` returns the correct platform-specific path for VS Code and Cursor on macOS, Linux, and Windows, and that `detectIde` returns the right root key.

```bash
node scripts/test-mcp-config.mjs
```

Expected output: `PASS test-mcp-config`

---

### `test-mcp-wrap.mjs` — Entry wrapping / unwrapping

Tests `wrapEntry` and `unwrapEntry` for both stdio and HTTP MCP server entries. Verifies that wrapping injects the correct `MYAI_IPC_SOCKET` / `MYAI_REAL_SERVER` env vars for stdio entries and rewrites the URL for HTTP entries, and that unwrapping restores the originals exactly.

```bash
node scripts/test-mcp-wrap.mjs
```

Expected output: `PASS test-mcp-wrap`

---

### `test-stale-check.mjs` — Stale wrapper detection

Creates a temporary MCP config with one healthy server (wrapper file exists) and one stale server (wrapper file missing), then asserts that `checkForStaleWrappers` returns only the stale entry.

```bash
node scripts/test-stale-check.mjs
```

Expected output: `PASS test-stale-check`

---

### `test-wrapper-deploy.mjs` — Wrapper deployment and versioning

Creates a temporary directory structure and calls `deployWrapper` three times: first deploy (should copy), second deploy at same version (should skip), third deploy after a version bump (should redeploy). Asserts the correct `deployed` flag and version on each call.

```bash
node scripts/test-wrapper-deploy.mjs
```

Expected output: `PASS test-wrapper-deploy`

---

### `test-wrapper.mjs` — stdio wrapper end-to-end

Starts a mock stdio MCP server and a mock telemetry HTTP server, then spawns the stdio wrapper process with `MYAI_REAL_SERVER` pointing at the mock server. Sends a `tools/call` request through stdin and asserts the wrapper forwards it and relays the response on stdout, and posts a telemetry event to the mock server.

```bash
node scripts/test-wrapper.mjs
```

Expected output: `PASS test-wrapper`

---

### `test-lifecycle.mjs` — Extension uninstall lifecycle

Creates a fake home directory pre-populated with wrapped VS Code and Cursor MCP configs and a `.myai` directory, then runs `dist/lifecycle.js` against it. Asserts that both configs are fully unwrapped (original `command`/`args` restored) and that the `.myai` directory is removed.

```bash
node scripts/test-lifecycle.mjs
```

Expected output: `PASS test-lifecycle`

---

### `test-daemon.mjs` — Daemon core smoke test

Starts `dist/daemon/index.js`, registers two fake extension instances, sends heartbeats, subscribes to the SSE stream for one instance, posts a `tool_call_started` telemetry event, and asserts the event arrives over SSE. Then deregisters both instances and waits for the daemon to self-terminate after the idle grace period.

```bash
node scripts/test-daemon.mjs
```

Expected output ends with `PASS test-daemon`

---

### `test-daemon-lifecycle.mjs` — Multi-instance daemon lifecycle

Verifies the daemon's self-termination logic. Kills any existing daemon first (for test isolation), then registers two instances (A and B), deregisters A and confirms the daemon stays alive while B is connected, then deregisters B and asserts the daemon exits within 15 seconds.

**Note:** This test shuts down any running daemon before starting. If VS Code is running the extension, it will automatically respawn the daemon after this test completes.

```bash
node scripts/test-daemon-lifecycle.mjs
```

Expected output ends with `All lifecycle tests passed ✓` and the daemon process exits cleanly.

---

### `test-proxy.mjs` — Daemon IPC and session clear

Starts the daemon, registers an instance, subscribes to its SSE stream, posts a telemetry event, verifies SSE broadcast, tests heartbeat, and verifies that `POST /internal/clear` broadcasts a `session_cleared` event.

```bash
node scripts/test-proxy.mjs
```

Expected output ends with `All tests passed ✓`

---

### `test-reconnect.mjs` — Daemon SSE reconnect

Tests reconnect resilience: starts the daemon, registers an instance, kills the daemon with `SIGKILL`, restarts it, and verifies that a new SSE subscription can be established successfully after the restart.

```bash
node scripts/test-reconnect.mjs
```

Expected output ends with `PASS reconnect`

---

## Common issues

| Symptom | Likely cause | Fix |
|---|---|---|
| "Proxy failed to start" notification | `dist/proxy/server.js` missing | Run `npm run build` and restart the Extension Development Host |
| Panel opens but shows "Disconnected — reconnecting…" | Extension host not connected to daemon SSE, or daemon not running | Check the **MyAI** output channel; verify daemon is running (`cat ~/.myai/daemon.json`); reload window |
| `vsce package` fails with "Missing publisher" | `publisher` field in package.json | Set it to your VS Code Marketplace publisher ID or any placeholder for local testing |
| `tsc --noEmit` reports errors | Type mismatch | Run `npm run build` first; esbuild is lenient but tsc is strict |
