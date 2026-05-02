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

3. Press **F5** (or **Run → Start Debugging**). The debug picker may appear — select **Run Extension**. A new VS Code window labeled **[Extension Development Host]** opens.

   > **If VS Code asks "You don't have an extension for debugging Markdown"** it means the launch configuration is missing or no debug configuration was selected. Make sure `.vscode/launch.json` exists and retry.

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

### 3c. Verify the panel updates

After the script completes, look at the **AI Agent Monitor** panel in the Extension Development Host window:

1. An entry for `echo-test` appears with a green `✓` and the duration in milliseconds.
2. Click the entry to expand it — the **Arguments** section shows pretty-printed JSON for `{ "message": "hello from smoke test", "timestamp": ... }`.
3. If the proxy was unreachable, the script exits with a non-zero code and the entry shows a red `✗`.

### 3d. Test the Clear button

1. Click the **Clear** button in the panel toolbar. All entries disappear.
2. In the **MyAI** output channel you should see no errors. A `session_cleared` event was broadcast internally to reset clients.

### 3e. Test the proxy config helper

1. Create a `.vscode/mcp.json` in any workspace folder open in the Extension Development Host:

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

## Common issues

| Symptom | Likely cause | Fix |
|---|---|---|
| "Proxy failed to start" notification | `dist/proxy/server.js` missing | Run `npm run build` and restart the Extension Development Host |
| Panel opens but spinner never resolves | WebSocket blocked or wrong port | Check the **MyAI** output channel for the port; confirm no firewall rules block loopback |
| `vsce package` fails with "Missing publisher" | `publisher` field in package.json | Set it to your VS Code Marketplace publisher ID or any placeholder for local testing |
| `tsc --noEmit` reports errors | Type mismatch | Run `npm run build` first; esbuild is lenient but tsc is strict |
