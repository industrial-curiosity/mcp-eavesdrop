## 1. Types

- [ ] 1.1 Add optional `conversationId?: string` and `requestId?: string` fields to `McpToolEvent` in `src/types/events.ts`
- [x] 1.2 Confirm `_meta` on `JsonRpcMessage.params` is typed `Record<string, unknown>` — already present in code as `_meta?: Record<string, unknown>`; no change needed
- [ ] 1.3 Add `conversationId` and `requestId` to the `TrackedCall` interface in `src/proxy/stdio-wrapper.ts`
- [ ] 1.4 Add `conversationId` and `requestId` to the `TelemetryEvent` interface in `src/proxy/stdio-wrapper.ts`

## 2. Wrapper — capture and forward

- [ ] 2.1 In `handleJsonRpc`, read `message.params._meta?.['vscode.conversationId']` and `message.params._meta?.['vscode.requestId']` when handling a `tools/call` message
- [ ] 2.2 Include both fields in the `tool_call_started` telemetry event (omit when absent)
- [ ] 2.3 Store both fields on the `TrackedCall` entry keyed by request ID
- [ ] 2.4 Echo `conversationId` and `requestId` from `TrackedCall` onto `tool_call_completed` and `tool_call_failed` events
- [ ] 2.5 Bump `MYAI_WRAPPER_VERSION` on the first line of `stdio-wrapper.ts`

## 3. Panel — display

- [ ] 3.1 Update the webview event type to include `conversationId?: string` and `requestId?: string`
- [ ] 3.2 Render a color-coded badge showing the full `conversationId` on each tool call entry when the field is present — do NOT truncate; use the stable color from the conversation color map
- [ ] 3.3 Ensure entries without `conversationId` render without a badge (no regression)
- [ ] 3.4 Implement conversation color assignment: initial 8-color palette (`#3B82F6`, `#8B5CF6`, `#10B981`, `#EA580C`, `#EF4444`, `#06B6D4`, `#EC4899`, `#0D9488`); hash ID to slot (`charCodeSum % length`), linear probe for occupied slots; when all slots are taken extend palette by inserting per-channel integer RGB midpoints between each adjacent pair (wrapping last to first), doubling size; repeat on each exhaustion

## 4. Tests and docs

- [ ] 4.1 Update `scripts/test-wrapper.mjs` (or add a focused test) to assert that `tool_call_started` events include `conversationId` when `_meta` carries it, and omit it when `_meta` is absent
- [ ] 4.2 Update `docs/vscode-mcp-session-identification.md` with the final field names and a note about the wrapper version bump requirement
- [ ] 4.3 Update README.md and `docs/spec.md` to reflect the new session attribution fields in `McpToolEvent`
