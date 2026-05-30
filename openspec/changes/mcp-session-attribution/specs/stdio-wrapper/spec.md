## MODIFIED Requirements

### Requirement: Wrapper taps JSON-RPC stream and sends telemetry to proxy
The wrapper SHALL parse the stdio byte stream for complete MCP JSON-RPC messages and POST `tool_call_started`, `tool_call_completed`, and `tool_call_failed` events to the daemon's Unix socket at `POST /telemetry`. Each event SHALL include `ide`, `workspaceSlug`, `conversationId`, and `requestId` fields. `ide` and `workspaceSlug` are sourced from environment variables. `conversationId` and `requestId` are extracted from `params._meta['vscode.conversationId']` and `params._meta['vscode.requestId']` on the `tools/call` message. All four fields are optional — absence SHALL NOT block telemetry. Telemetry SHALL be fire-and-forget — failures MUST NOT interrupt the stdio relay.

The `_meta` field on `JsonRpcMessage.params` SHALL be typed as `Record<string, unknown>` — it MUST NOT be narrowed to only the currently known keys. This ensures future `_meta` fields added by VS Code are preserved and available without requiring a type change. `conversationId` and `requestId` are read by key access; all other fields are forwarded as-is.

#### Scenario: Tool call intercepted with session metadata
- **WHEN** a complete `{"method": "tools/call", ...}` JSON-RPC message is detected in the stream and `_meta['vscode.conversationId']` is present
- **THEN** the wrapper SHALL POST a `tool_call_started` event including `conversationId` and `requestId` alongside `ide` and `workspaceSlug`

#### Scenario: Tool call intercepted without session metadata
- **WHEN** a complete `tools/call` message is detected and `_meta` does not contain `vscode.conversationId`
- **THEN** the wrapper SHALL POST a `tool_call_started` event with `conversationId` and `requestId` omitted (fields absent, not null)

#### Scenario: Completed call echoes session metadata
- **WHEN** a `tools/call` response is matched to a tracked request that carried `conversationId`
- **THEN** the wrapper SHALL include the same `conversationId` and `requestId` on the `tool_call_completed` or `tool_call_failed` event

#### Scenario: Daemon unreachable
- **WHEN** the POST to the daemon Unix socket fails or times out
- **THEN** the wrapper SHALL log to stderr and continue relaying stdio without interruption
- **THEN** the real MCP server SHALL remain fully functional

#### Scenario: Non-tool-call messages
- **WHEN** a JSON-RPC message is not a `tools/call` request or response
- **THEN** the wrapper SHALL relay it without generating any telemetry event
