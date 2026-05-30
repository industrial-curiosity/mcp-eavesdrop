## Why

Every MCP `tools/call` message VS Code (and Cursor) sends already contains `_meta.vscode.conversationId` and `_meta.vscode.requestId` identifying the originating chat session and request. The wrapper discards this data today. Capturing it would let the monitoring panel group and label tool calls by conversation — making it possible to see exactly which chat session invoked which tools.

## What Changes

- The stdio wrapper reads `_meta['vscode.conversationId']` and `_meta['vscode.requestId']` from intercepted `tools/call` messages and includes them in telemetry events.
- `McpToolEvent` gains optional `conversationId` and `requestId` fields.
- The panel labels each tool call entry with the full `conversationId` and groups consecutive calls from the same session visually — identifiers are never truncated.

## Non-goals

- Mapping `conversationId` to a human-readable session name or title — the IDE does not expose this.
- Supporting any mechanism other than the `_meta` fields already present on the wire (no proposed APIs, no IPC hooks).
- Cursor-specific verification — assumed identical until credits allow testing; the implementation is identical either way.

## Capabilities

### New Capabilities

- `mcp-session-attribution`: Capture and surface per-call conversation and request identifiers from MCP `_meta` through the telemetry pipeline to the monitoring panel.

### Modified Capabilities

- `stdio-wrapper`: New requirement to extract and forward `_meta` session fields from `tools/call` messages.
- `agent-monitor-panel`: New display requirement to show and group entries by `conversationId`.

## Impact

- `src/proxy/stdio-wrapper.ts` — `JsonRpcMessage` type and `handleJsonRpc`
- `src/types/events.ts` — `McpToolEvent`
- `src/panel/AgentPanel.ts` and webview — rendering only (no protocol changes)
- `openspec/specs/stdio-wrapper/spec.md` — delta spec required
- `openspec/specs/agent-monitor-panel/spec.md` — delta spec required
