# Cursor `_meta` Investigation

Determine whether Cursor passes `vscode.conversationId` and `vscode.requestId`
through `_meta` on `tools/call` requests. This controls whether Cursor tool
calls can be attributed to a chat session or must fall into the no-session
bucket in the event log.

## Background

VS Code injects a `_meta` object on every `tools/call` JSON-RPC request sent to
an MCP server:

```json
"_meta": {
  "progressToken": "...",
  "vscode.conversationId": "abc123",
  "vscode.requestId": "req-456"
}
```

Cursor is a VS Code fork. It may pass these fields unchanged, strip them, or
omit `_meta` entirely. We need to observe what actually arrives in the stdio
wrapper.

---

## Step 1 — Add a debug emit to the wrapper

**File:** `src/proxy/stdio-wrapper.ts`

Update the `JsonRpcMessage` interface to expose `_meta`:

```typescript
interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: unknown;
    _meta?: Record<string, unknown>;
  };
  result?: unknown;
  error?: unknown;
}
```

Inside `handleJsonRpc`, in the `message.method === 'tools/call'` branch,
add this line **before** the `postTelemetry` call:

```typescript
process.stderr.write(
  `mcpEavesdrop-debug: _meta=${JSON.stringify(message.params?._meta ?? null)}\n`
);
```

---

## Step 2 — Build

```bash
npm run build
```

Confirm `dist/proxy/stdio-wrapper.js` is updated (check its mtime).

---

## Step 3 — Deploy the wrapper

The wrapper at `~/.mcpEavesdrop/stdio-wrapper.js` is what Cursor actually runs.
It is deployed by the extension on activation, but only when the version
string changes. To force re-deploy, either:

- Increment `MCPEAVESDROP_WRAPPER_VERSION` in `src/proxy/stdio-wrapper.ts` (line 2)
  and rebuild, then reopen VS Code/Cursor so the extension activates, or
- Copy manually:
  ```bash
  cp dist/proxy/stdio-wrapper.js ~/.mcpEavesdrop/stdio-wrapper.js
  ```

Confirm the deployed file contains the `mcpEavesdrop-debug:` line:

```bash
grep 'mcpEavesdrop-debug' ~/.mcpEavesdrop/stdio-wrapper.js
```

---

## Step 4 — Confirm a wrapped MCP server exists in Cursor

```bash
cat ~/.cursor/mcp.json
```

Look for any entry whose `command` is `node` and whose `args` contains
`~/.mcpEavesdrop/stdio-wrapper.js` (the path may be absolute). Report which server
names are wrapped.

If no servers are wrapped, stop here. Apply the proxy config first using
`mcpEavesdrop.showMcpConfig` in VS Code/Cursor and paste the output into
`~/.cursor/mcp.json`, then restart Cursor.

---

## Step 5 — Locate Cursor's MCP stderr log

Cursor writes each MCP server's stderr to a log file. Common locations on macOS:

```
~/Library/Logs/Cursor/
~/Library/Application Support/Cursor/logs/
```

Look for files referencing the wrapped server name or containing `stdio`:

```bash
find ~/Library/Logs/Cursor ~/Library/Application\ Support/Cursor/logs \
  -name '*.log' -newer ~/.mcpEavesdrop/stdio-wrapper.js 2>/dev/null | head -20
```

Note the path(s) and their last-modified times. If nothing is found, check
Cursor's **Output** panel (View → Output → select the MCP server dropdown).

---

## Step 6 — Trigger a tool call in Cursor

> **This step requires a human.**

Open Cursor. In a chat session, send a message that will cause the wrapped
MCP server to run a tool call — for example, ask a question that uses a tool
from that server. One tool call is sufficient.

Once done, confirm and proceed to Step 7.

---

## Step 7 — Read the log

```bash
# Replace with the actual log path found in Step 5
grep 'mcpEavesdrop-debug' <path-to-cursor-mcp-log>
```

If the log path is unknown, search broadly:

```bash
grep -r 'mcpEavesdrop-debug' ~/Library/Logs/Cursor \
  ~/Library/Application\ Support/Cursor/logs 2>/dev/null | head -20
```

---

## Step 8 — Report findings

Return all of the following:

| Question | Answer |
|---|---|
| Was `vscode.conversationId` present in `_meta`? | yes / no |
| Was `vscode.requestId` present in `_meta`? | yes / no |
| Full `_meta` shape (sanitize actual ID values to `<uuid>`) | |
| Any unexpected extra fields? | |

If no `mcpEavesdrop-debug` lines were found, include:
- The last 20 lines of the log file
- The output of `grep 'mcpEavesdrop' ~/.cursor/mcp.json` to confirm the wrapper is configured

---

## Expected outcomes

**Outcome A — Cursor passes `_meta` unchanged:**
```
mcpEavesdrop-debug: _meta={"progressToken":"...","vscode.conversationId":"<uuid>","vscode.requestId":"<uuid>"}
```
→ Cursor sessions get full session attribution in the event log.

**Outcome B — Cursor sends `_meta` but strips VS Code fields:**
```
mcpEavesdrop-debug: _meta={"progressToken":"..."}
```
→ Cursor tool calls go into the no-session bucket. Session grouping is
unavailable for Cursor until Cursor exposes its own session identifier.

**Outcome C — No `_meta` at all:**
```
mcpEavesdrop-debug: _meta=null
```
→ Same as Outcome B.
