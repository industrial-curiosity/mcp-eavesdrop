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
- Display the full `conversationId` (no truncation) per tool call entry in the panel as a color-coded badge; assign each ID a stable distinct color.
- Preserve the entire `_meta` object in the `JsonRpcMessage` type — prefer capturing too much over too little. New fields VS Code adds in future should be available without a type change.

**Non-Goals:**

- Resolving conversation IDs to human-readable session titles.
- Any use of proposed/private VS Code APIs.
- Cursor-specific verification — VS Code is the implementation target; Cursor support is deferred.
- HTTP-bridged server session attribution is out of scope for this change. The `proxy-without-extension` change introduced a separate `handleHttpDirectMessage` path; it does not call `handleJsonRpc`. Extending session attribution to HTTP direct mode requires explicit work that is deferred to a future change.

## Decisions

### 1. Read from `_meta` in the wrapper, not from a VS Code API

The `_meta` fields are already on the wire. Reading them requires no API changes, no proposed APIs, and works in both VS Code and Cursor. The alternative — hooking `LanguageModelToolInvocationOptions.chatSessionResource` via `chatParticipantPrivate` — requires an unstable proposed API and only works inside the extension host, not in the wrapper process.

### 2. Add `conversationId` and `requestId` to `McpToolEvent` as optional fields

Fields are optional because `_meta` is not always injected: non-VS Code callers (e.g. direct CLI MCP clients) and VS Code calls made outside a chat context do not carry session metadata. Absence must not block telemetry.

### 3. Only capture on `tool_call_started`; carry forward on `completed`/`failed` via `TrackedCall`

`conversationId` and `requestId` are present on the request (`tools/call`), not the response. `TrackedCall` already stores `eventId` and `toolName` keyed by request ID — add `conversationId` and `requestId` there so `completed`/`failed` events can echo them back without re-parsing the response.

### 4. Panel assigns stable distinct colors to `conversationId` values

Each distinct `conversationId` receives a color from an ordered palette. The mapping is stored in a `Map<string, string>` (ID → CSS color) so the same ID always renders the same color within a panel session.

**Initial palette** — 8 colors chosen for visibility on both VS Code dark and light themes:

| # | Hex | Name |
|---|-----|------|
| 0 | `#3B82F6` | blue |
| 1 | `#8B5CF6` | violet |
| 2 | `#10B981` | emerald |
| 3 | `#EA580C` | orange |
| 4 | `#EF4444` | red |
| 5 | `#06B6D4` | cyan |
| 6 | `#EC4899` | pink |
| 7 | `#0D9488` | teal |

**Collision resolution** — hash the ID to an initial slot index (`charCodeSum % palette.length`); walk forward through the ordered palette array until an unoccupied slot is found (linear probe).

**Palette extension** — when all current slots are occupied and a new ID arrives, extend the palette by inserting the per-channel integer midpoint between every adjacent pair of colors (wrapping the last to the first), doubling the palette size. Repeat as needed: each subsequent exhaustion halves the gap again, producing increasingly fine-grained intermediate hues.

Example: `[C0, C1]` → `[C0, mid(C0,C1), C1, mid(C1,C0)]` (4 colors). `mid(#3B82F6, #8B5CF6)` = `#636EF6`.

The full `conversationId` is displayed as a colored badge on each entry (no truncation — IDs are `chat-XXXXXXXXX` format, at most ~14 chars). No dividers between conversations; events are displayed in chronological order. No human-readable session name — not available without proposed API.

## Risks / Trade-offs

- **`_meta` fields absent for non-VS Code callers** (e.g. direct CLI MCP clients) → fields are optional; no regression.
- **`conversationId` format could change** in a future VS Code release → it is already a derived string (`chatSessionResourceToId`), not a raw URI; low risk. If it changes, worst case is an opaque different-format string, not a crash.
