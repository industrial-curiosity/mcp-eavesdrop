## Context

VS Code (and Cursor) injects three fields into `_meta` on every `tools/call` JSON-RPC request it sends to an MCP server:

- `vscode.conversationId` — string ID derived from the `chatSessionResource` URI
- `vscode.requestId` — string ID for the individual chat request within that session
- `traceparent` — W3C trace context for distributed tracing (MCP SEP-414)

Source: [`mcpServer.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/mcp/common/mcpServer.ts) in `microsoft/vscode` (verified May 2026).

The stdio wrapper currently discards `params._meta` entirely. The telemetry pipeline (`TelemetryEvent` in the wrapper → daemon `/telemetry` → daemon SSE → `McpToolEvent` → panel) carries `ide` and `workspaceSlug` but not session identity.

## Goals / Non-Goals

**Goals:**

- Capture `vscode.conversationId` and `vscode.requestId` at the wrapper layer with zero risk to the relay.
- Thread both fields through the full telemetry pipeline to the panel.
- Display the full `conversationId` (no truncation) per tool call entry in the panel; visually separate runs from different sessions.
- Preserve the entire `_meta` object in the `JsonRpcMessage` type — prefer capturing too much over too little. New fields VS Code adds in future should be available without a type change.

**Non-Goals:**

- Resolving conversation IDs to human-readable session titles.
- Any use of proposed/private VS Code APIs.
- Cursor-specific verification — VS Code is the implementation target; Cursor support is deferred.
- Capturing `_meta` fields from the HTTP bridge code path (`runHttpBridgeMode` / `forwardToTcpProxy`) — that path forwards the raw JSON-RPC body to the daemon TCP proxy and does not run `handleJsonRpc`. Session attribution for HTTP-bridged servers is out of scope for this change.

## Decisions

### 1. Read from `_meta` in the wrapper, not from a VS Code API

The `_meta` fields are already on the wire. Reading them requires no API changes, no proposed APIs, and works in both VS Code and Cursor. The alternative — hooking `LanguageModelToolInvocationOptions.chatSessionResource` via `chatParticipantPrivate` — requires an unstable proposed API and only works inside the extension host, not in the wrapper process.

### 2. Add `conversationId` and `requestId` to `McpToolEvent` as optional fields

Optional fields preserve backward compatibility: existing daemon/panel code continues to work if the fields are absent (e.g. from older wrapper deployments or non-VS Code clients).

### 3. Only capture on `tool_call_started`; carry forward on `completed`/`failed` via `TrackedCall`

`conversationId` and `requestId` are present on the request (`tools/call`), not the response. `TrackedCall` already stores `eventId` and `toolName` keyed by request ID — add `conversationId` and `requestId` there so `completed`/`failed` events can echo them back without re-parsing the response.

### 4. Panel groups by `conversationId` with a full-ID display label

Show the full `conversationId` as a colour-coded badge. IDs are at most ~14 chars (`chat-XXXXXXXXX` format) so truncation is unnecessary. Consecutive entries from the same conversation are visually grouped (subtle divider line on session change). No human-readable session name — not available without proposed API.

## Risks / Trade-offs

- **`_meta` fields absent for non-VS Code callers** (e.g. direct CLI MCP clients) → fields are optional; no regression.
- **`conversationId` format could change** in a future VS Code release → it is already a derived string (`chatSessionResourceToId`), not a raw URI; low risk. If it changes, worst case is an opaque different-format string, not a crash.
- **Wrapper version bump required** → existing deployed wrappers won't emit the new fields until re-wrapped. Panel must handle absence gracefully (already covered by making fields optional).
