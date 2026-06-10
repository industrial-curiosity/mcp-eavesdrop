# Testing Guide

Step-by-step instructions for verifying the mcpEavesdrop-extension MVP before shipping.

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

   Expected output: a file named `mcpEavesdrop-extension-0.1.0.vsix` in the repo root with no errors.

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

3. In the Extension Development Host window, open the **Output** panel (`View → Output`) and select **MCP Eavesdrop** from the channel dropdown.

4. Confirm you see a line like:

   ```
   MCP Eavesdrop: Proxy listening on port 12345
   ```

   The port number will vary.

5. Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and run **MCP Eavesdrop: Open Agent Monitor Panel**.

6. A panel titled **AI Agent Monitor** should open to the right of the active editor. The toolbar shows "AI Agent Monitor" and a "Clear" button. The log area is empty.

7. Confirm the status bar or Output panel shows no errors. If the proxy failed to start within 5 seconds, you will see an error notification — check the **MCP Eavesdrop** output channel for details.

---

## Task 8.3 — Smoke test: route a real MCP tool call through the proxy

### 3a. Confirm the extension is running

In the **MCP Eavesdrop** output channel you should see:

```
MCP Eavesdrop: IPC socket at /var/folders/.../mcpEavesdrop-extension.sock
MCP Eavesdrop: Proxy listening on port 12345
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
2. In the **MCP Eavesdrop** output channel you should see no errors. A `session_cleared` event was broadcast internally to reset clients.

### 3e. Test the proxy config helper

1. Open a workspace folder in the Extension Development Host if one is not already open (**File → Open Folder…** → this repo). Then create a `.vscode/mcp.json` in that folder:

   ```json
   {
     "servers": {
       "context7": { "type": "http", "url": "http://localhost:8080/" }
     }
   }
   ```

2. Run **MCP Eavesdrop: Show Proxy MCP Config** from the Command Palette.

3. The **MCP Eavesdrop** output channel opens and shows a JSON snippet with `context7` re-pointed to `http://127.0.0.1:<PORT>/context7`.

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

Tests `wrapEntry` and `unwrapEntry` for both stdio and HTTP MCP server entries. Verifies that wrapping injects the correct `MCPEAVESDROP_IPC_SOCKET` / `MCPEAVESDROP_REAL_SERVER` env vars for stdio entries and rewrites the URL for HTTP entries, and that unwrapping restores the originals exactly.

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

Starts a mock stdio MCP server and a mock telemetry HTTP server, then spawns the stdio wrapper process with `MCPEAVESDROP_REAL_SERVER` pointing at the mock server. Sends a `tools/call` request through stdin and asserts the wrapper forwards it and relays the response on stdout, and posts a telemetry event to the mock server.

```bash
node scripts/test-wrapper.mjs
```

Expected output: `PASS test-wrapper`

---

### `test-lifecycle.mjs` — Extension uninstall lifecycle

Creates a fake home directory pre-populated with wrapped VS Code and Cursor MCP configs and a `.mcpEavesdrop` directory, then runs `dist/lifecycle.js` against it. Asserts that both configs are fully unwrapped (original `command`/`args` restored) and that the `.mcpEavesdrop` directory is removed.

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

---

## Agent Monitor panel v2 — filter bar and layout

These are manual verification steps for the filter bar, connections sidebar, and history reload features introduced in the `agent-monitor-panel-v2` change. Run `npm run build` first, then install the extension in the Extension Development Host (see **Task 8.1** above).

### 6.1 — Sidebar filter groups render

1. Open the Agent Monitor panel (**MCP Eavesdrop: Open Agent Monitor Panel**).
2. The panel body is split into two columns: a **Connections** sidebar on the left and a **log area** on the right.
3. With the daemon running, the sidebar should show an **IDE** section with at least one value.
4. After events arrive, the sidebar should show a **Conversation ID** section including discovered IDs and `not detected` when applicable.

### 6.2 — Server select populates from live events

1. Trigger MCP tool calls through at least two different servers (e.g., using `node scripts/test-proxy.mjs` and a second server).
2. Open the filter bar's **server** select (`All servers` default).
3. Each server name that produced at least one event must appear as an option. No duplicates.

### 6.3 — Individual filters hide/show entries

Test each of the four controls independently (reset others to "All" / empty before testing each):

- **Tool name** (`filterTool`): Type a substring matching some entries — only matching entries should remain visible. Clear the input — all entries reappear.
- **Server** (`filterServer`): Select a specific server — only that server's entries appear.
- **Status** (`filterStatus`): Select "in-progress" — only spinning entries appear. Select "completed" — only green ✓ entries appear. Select "failed" — only red ✗ entries appear.
- **Time range** (`filterTime`): Select "Last hour" — entries older than 1 hour disappear. Select "Today" — entries from previous days disappear. Select "All" — all entries reappear.

### 6.8 — Timestamp column is visible and ordered

1. Trigger at least two tool calls a few seconds apart.
2. Verify each row shows a left-side timestamp column.
3. Verify the timestamp shows both local date and time (not time-only).
4. Confirm the visible timestamp order matches the selected sort order (newest-first or oldest-first).
5. Reload history (change any filter) and verify timestamps are still present on reloaded rows.

### 6.9 — Conversation bucket fallback is filterable

1. Trigger at least one call with no `conversationId` metadata.
2. Verify the row conversation column shows `not detected` exactly.
3. Verify the sidebar includes a `not detected` checkbox under **Conversation ID**.
4. Toggle `not detected` and confirm matching entries hide/show correctly.

### 6.10 — Toolbar Refresh reloads initial data

1. With the panel open, click **Refresh** (left of **Clear**).
2. Verify the panel reloads current status, connections, and history without reopening the panel.
3. Confirm no duplicate `tool_call_started` rows are introduced by refresh.
4. Confirm existing completed/failed entries remain correctly updated after refresh.

### 6.11 — Initial open includes latest telemetry logs

1. Trigger a telemetry event (for example with `node scripts/test-proxy.mjs`).
2. Close the Agent Monitor panel if open.
3. Re-open the panel via **MCP Eavesdrop: Open Agent Monitor Panel**.
4. Verify the newest event from the current day appears immediately on initial load (without clicking Refresh).

### 6.12 — Restart daemon command restores panel connectivity

1. Open the panel and confirm it is receiving events.
2. Run **MCP Eavesdrop: Restart Daemon** from the Command Palette.
3. Verify a success notification appears and panel status returns to connected.
4. Verify connections repopulate and new events continue streaming without reloading the window.

### 6.4 — Combined filters apply as AND logic

1. Set **Server** to a specific server and **Status** to "completed".
2. Only entries that match both conditions (that server AND completed) should be visible.
3. Changing one filter to "All" while the other remains set should broaden the visible set accordingly.

### 6.5 — Conversation column is visible

1. Trigger several tool calls, including multiple calls in the same conversation and at least one without conversation metadata.
2. Expand individual entries.
3. Each entry should include a dedicated conversation value in the header area.
4. Missing conversation metadata should render as `not detected`.

### 6.6 — Panel open/close/reopen resets filter bar

1. Set one or more filters to non-default values.
2. Close the panel (click the × on the tab).
3. Re-open the panel via **MCP Eavesdrop: Open Agent Monitor Panel**.
4. All filter controls should be reset to their defaults ("All", empty text input). The history is reloaded from disk.

### 6.7 — Filter changes trigger history reload

1. Clear the log with the **Clear** button.
2. Change the **Server** filter (or any filter) to a non-default value.
3. The panel should reload history from disk — persisted events matching all active filters should reappear.
4. For the **Tool name** text input: type a few characters; the reload is debounced (300 ms), so the history request fires after typing pauses rather than on every keystroke. `reapplyFilters()` still runs immediately on each keystroke.
5. Change any filter back to "All" / clear the text input — all persisted events should be visible again.

---

## Common issues

| Symptom | Likely cause | Fix |
|---|---|---|
| "Proxy failed to start" notification | `dist/proxy/server.js` missing | Run `npm run build` and restart the Extension Development Host |
| Panel opens but shows "Disconnected — reconnecting…" | Extension host not connected to daemon SSE, or daemon not running | Check the **MCP Eavesdrop** output channel; verify daemon is running (`cat ~/.mcpEavesdrop/daemon.json`); reload window |
| `vsce package` fails with "Missing publisher" | `publisher` field in package.json | Set it to your VS Code Marketplace publisher ID or any placeholder for local testing |
| `tsc --noEmit` reports errors | Type mismatch | Run `npm run build` first; esbuild is lenient but tsc is strict |
