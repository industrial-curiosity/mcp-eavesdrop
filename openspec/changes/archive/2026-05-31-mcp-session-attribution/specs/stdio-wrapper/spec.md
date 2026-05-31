## MODIFIED Requirements

### Requirement: Wrapper taps JSON-RPC stream and sends telemetry to proxy
`handleJsonRpc` is called unconditionally — it is not gated on daemon reachability. Local log writes are always attempted first. The `postTelemetry` call to the daemon Unix socket remains fire-and-forget and fails silently when unreachable. Each `tool_call_started`, `tool_call_completed`, and `tool_call_failed` event SHALL include `ide`, `workspaceSlug`, and — when present in `_meta` — `conversationId` and `requestId`.

`conversationId` and `requestId` are extracted from `params._meta['vscode.conversationId']` and `params._meta['vscode.requestId']` on the `tools/call` message. All four fields are optional — absence SHALL NOT block telemetry.

The `_meta` field on `JsonRpcMessage.params` SHALL be typed as `Record<string, unknown>` — it MUST NOT be narrowed to only the currently known keys.

The wrapper SHALL also forward the entire `_meta` object as a `meta` field on `TelemetryEvent` and `McpToolEvent` whenever `_meta` is present and non-empty on a `tools/call` message. This ensures any fields VS Code adds in future (e.g. `traceparent`, new correlation IDs) are visible in the panel and JSONL logs without a wrapper code change.

This requirement covers the stdio relay path only. The HTTP direct mode path (`handleHttpDirectMessage`, active when `MYAI_REAL_URL` is set and `MYAI_REAL_SERVER` is absent) is excluded from this change.

#### Scenario: Tool call intercepted with session metadata
- **WHEN** a complete `{"method": "tools/call", ...}` JSON-RPC message is detected in the stream and `_meta['vscode.conversationId']` is present
- **THEN** the wrapper SHALL POST a `tool_call_started` event including `conversationId` and `requestId` alongside `ide` and `workspaceSlug`
- **THEN** the event SHALL also include a `meta` field containing the entire `_meta` object as-is

#### Scenario: Tool call intercepted without session metadata
- **WHEN** a complete `tools/call` message is detected and `_meta` does not contain `vscode.conversationId`
- **THEN** the wrapper SHALL POST a `tool_call_started` event with `conversationId` and `requestId` omitted (fields absent, not null)
- **THEN** the `meta` field SHALL be included if `_meta` is present and non-empty, and omitted if `_meta` is absent or empty

#### Scenario: Completed call echoes session metadata
- **WHEN** a `tools/call` response is matched to a tracked request that carried `conversationId`
- **THEN** the wrapper SHALL include the same `conversationId`, `requestId`, and `meta` on the `tool_call_completed` or `tool_call_failed` event

#### Scenario: Daemon unreachable
- **WHEN** the POST to the daemon Unix socket fails or times out
- **THEN** the wrapper SHALL log to stderr and continue relaying stdio without interruption
- **THEN** the real MCP server SHALL remain fully functional

#### Scenario: Non-tool-call messages
- **WHEN** a JSON-RPC message is not a `tools/call` request or response
- **THEN** the wrapper SHALL relay it without generating any telemetry event
