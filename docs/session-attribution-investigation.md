# Session Attribution Investigation

> Continuation document for the `mcp-session-attribution` change and the
> follow-on VS Code source investigation.
> Created: 2026-05-31
> Status at creation: **all tasks complete; investigation pivoted to alternative
> architectures**

---

## What was built

The `mcp-session-attribution` change is fully implemented and deployed:

| Layer | What changed |
| :--- | :--- |
| `src/types/events.ts` | Added `conversationId?`, `requestId?`, `meta?: Record<string,unknown>` to `McpToolEvent` |
| `src/proxy/stdio-wrapper.ts` | v6 — extracts `vscode.conversationId`, `vscode.requestId`, and full `_meta` from every `tools/call` JSON-RPC message |
| `src/panel/webview/app.ts` | Mirrors the `meta?` field |
| `scripts/test-wrapper.mjs` | `deepEqual` assertions for `meta` present/absent |
| `docs/spec.md` | Interface block updated |
| `~/.mcpEavesdrop/stdio-wrapper.js` | v6 deployed |

All 21 tasks in `openspec/changes/mcp-session-attribution/tasks.md` are `[x]`.

---

## Why session attribution doesn't work yet

### The call chain

```
Copilot marketplace extension
  └─ vscode.lm.invokeTool(name, options, token)
       └─ extHostLanguageModelTools.ts  ← builds IToolInvocation
            └─ languageModelToolsService.invokeTool()
                 └─ mcpLanguageModelToolContribution.invoke()
                      └─ mcpServer._callWithProgress(params, progress, context)
                           └─ _meta = { progressToken, ... }
                                ← vscode.conversationId injected HERE
                                ← only if context.chatSessionResource truthy
```

### Why `_meta` arrives empty

`chatSessionResource` is only populated when the caller passes a
`toolInvocationToken` that is bound to an active chat session. The marketplace
Copilot extension (private repo) does **not** pass `toolInvocationToken` when it
calls `invokeTool` for MCP tools. As a result:

- `context.chatSessionResource = undefined`
- `progressToken = undefined` (no progress handler in this path)
- `_meta` serialises to `{}` → omitted by MCP server
- Our wrapper sees no `_meta` → `meta=<absent>`, `conversationId=<absent>`

This is a limitation of the current Copilot implementation, **not a bug in our
wrapper**. Our wrapper correctly forwards whatever arrives on the wire.

### Where the wiring _would_ work

- **Agent mode** (`agentHostSessionHandler.ts`, line ~1783):
  `IToolInvocation.context = { sessionResource: opts.sessionResource }` — so
  agent-mode sessions _should_ produce `vscode.conversationId`. Untested.

- **Bundled Copilot extension** (the version shipped inside VS Code, not the
  marketplace extension): has `chatParticipantPrivate` in `enabledApiProposals`
  and is the code that actually powers the Debug Panel. It passes session context
  correctly.

---

## VS Code proposed APIs relevant to monitoring

### 1. `chatDebug` — **the right approach**

`src/vscode-dts/vscode.proposed.chatDebug.d.ts` (version 4)

This is exactly what the Agent Monitor Panel needs. Key surface:

```typescript
// Passive: receive all events that core emits (skill loading, prompt discovery,
// tool calls, subagent invocations, model turns, etc.)
chat.onDidReceiveChatDebugEvent: Event<ChatDebugEvent>

// Active: register as the debug log provider for the debug panel
chat.registerChatDebugLogProvider(provider: ChatDebugLogProvider): Disposable
```

Event types:

| Event class | Carries | What it tells us |
| :--- | :--- | :--- |
| `ChatDebugToolCallEvent` | `toolName`, `input`, `output`, `result`, `durationInMillis`, `sessionResource` | Every tool call with full I/O |
| `ChatDebugModelTurnEvent` | `model`, `inputTokens`, `outputTokens`, `requestId`, `requestName`, `sessionResource` | Each LLM round-trip |
| `ChatDebugSubagentInvocationEvent` | `agentName`, `description`, `status`, `toolCallCount`, `modelTurnCount`, `sessionResource` | Subagent calls |
| `ChatDebugGenericEvent` | `name`, `details`, `level`, `category` | **Skill activation** ("Resolved skills (start)"), prompt discovery |
| `ChatDebugUserMessageEvent` | `message`, `sections` (full prompt structure) | The user prompt + context |
| `ChatDebugAgentResponseEvent` | `message`, `sections` | Agent response + reasoning |

All events carry `sessionResource: Uri` for session attribution.

**Requires**: `"chatDebug"` in `enabledApiProposals` in `package.json`.
**Used by**: the bundled VS Code `copilot` extension.
**Availability**: proposed API — works in development with `--enable-proposed-api`,
requires VS Code team whitelist for marketplace publishing.

### 2. `chatHooks` — not useful for our purpose

`src/vscode-dts/vscode.proposed.chatHooks.d.ts` (version 6)

Hook types: `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`,
`PostToolUse`, `PreCompact`, `SubagentStart`, `SubagentStop`, `Stop`,
`ErrorOccurred`.

These are **shell script commands** executed by the agent at lifecycle points,
not extension API callbacks. Useful for blocking/modifying agent behaviour, not
for passive observation by an extension.

### 3. `chatParticipantPrivate` — partial access

Already documented in `docs/vscode-mcp-session-identification.md`. Provides:

- `chat.onDidDisposeChatSession: Event<string>` — fires when a session is
  disposed (session ID string)
- `window.onDidChangeActiveChatPanelSessionResource: Event<Uri | undefined>` —
  fires when the active panel session changes
- `LanguageModelToolInvocationOptions.chatSessionResource?` — the session URI
  passed to tool `invoke()` if the caller supplied it (Copilot doesn't)
- `ChatContext.sessionResource?: Uri` — session URI available in steering
  context

**Requires**: `"chatParticipantPrivate"` in `enabledApiProposals`.
**Problem**: Copilot doesn't pass `chatSessionResource` to MCP tool invocations
today, so even with this API our wrapper wouldn't receive it.

### 4. `chatSessionsProvider` — session list UI only

Provides `ChatSessionItemController` / `ChatSessionItemProvider` for the "chat
sessions" sidebar list. Does not give access to the content of sessions or tool
calls. Not useful for monitoring.

---

## Architecture decision needed

### Option A — continue with stdio interception (current)

Keep v6 wrapper, accept that `conversationId` is absent for now. Grouping of
tool calls by session is deferred until Copilot passes session context.

**Pro**: already built and working for timing/payload/error capture.
**Con**: no session attribution, no skill visibility, no subagent visibility.

### Option B — pivot to `chatDebug` proposed API

Subscribe to `chat.onDidReceiveChatDebugEvent` to receive core-originated events
(skills, tool calls, subagent invocations) with full session attribution.
Optionally register a `ChatDebugLogProvider` to merge our MCP wire-level events
(timing, full `_meta`, error details) with core events.

**Pro**: correct session attribution, skill activation events, subagent tracking,
model turn token counts — everything the panel was designed to show.
**Con**: requires `chatDebug` proposed API access; proposed APIs cannot be used
in marketplace extensions without VS Code team approval. Could be gated behind a
development-only flag.

### Option C — hybrid

Use `chatDebug` for session/skill/subagent context (gated, dev-only), and keep
the stdio wrapper for MCP wire-level timing/payload detail. The two streams are
correlated by `sessionResource` on `ChatDebugToolCallEvent` matching our
wrapper's per-connection session token.

---

## Recommended next steps

1. **Test Option B locally**: add `"chatDebug"` to `enabledApiProposals` in
   `package.json`, subscribe to `onDidReceiveChatDebugEvent`, log what fires to
   confirm skill events (`ChatDebugGenericEvent`) and tool call events
   (`ChatDebugToolCallEvent`) are actually received.

2. **Verify agent mode**: switch Copilot from Ask → Agent mode and rerun MCP
   calls. The `agentHostSessionHandler.ts` path does set `sessionResource`, so
   `conversationId` may appear in wrapper logs in agent mode.

3. **If Option B/C is chosen**: propose a new OpenSpec change
   (`agent-debug-integration` or similar) to replace the stdio-wrapper-based
   monitoring core with `chatDebug` event subscription, keeping the wrapper only
   for supplemental MCP timing/payload data.

---

## Key source files in `microsoft/vscode`

| File | Relevance |
| :--- | :--- |
| `src/vscode-dts/vscode.proposed.chatDebug.d.ts` | Full proposed API spec |
| `src/vs/workbench/api/common/extHostChatDebug.ts` | Implementation — how events reach extensions |
| `src/vs/workbench/contrib/mcp/common/mcpServer.ts` | Where `_meta` is built; `_callWithProgress()` |
| `src/vs/workbench/contrib/mcp/common/mcpTypes.ts` | `IMcpToolCallContext` interface |
| `src/vs/workbench/contrib/mcp/browser/mcpLanguageModelToolContribution.ts` | Bridge: `IToolInvocation` → `callWithProgress` |
| `src/vs/workbench/contrib/chat/electron-browser/agentHostSessionHandler.ts` | Agent-mode path that sets `sessionResource` |
| `src/vs/workbench/contrib/chat/common/model/chatUri.ts` | `chatSessionResourceToId()` — how URI → string ID |
| `extensions/copilot/package.json` | Lists `chatDebug` in `enabledApiProposals` |
