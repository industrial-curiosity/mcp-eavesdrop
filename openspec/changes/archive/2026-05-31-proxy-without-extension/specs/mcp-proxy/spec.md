## REMOVED Requirements

### Requirement: Proxy forwards MCP JSON-RPC requests to upstream servers
Removed. The daemon no longer runs a TCP proxy server. HTTP-bridged MCP servers are contacted directly by the wrapper.

### Requirement: Proxy emits structured events for tool calls
Removed. The daemon TCP proxy no longer exists. All event emission is handled by the wrapper via `POST /telemetry`.

## MODIFIED Requirements

### Requirement: Proxy accepts telemetry POSTs from the stdio wrapper
The daemon SHALL accept `POST /telemetry` requests on its Unix socket and broadcast the event to all registered SSE connections. The daemon SHALL NOT write the event to disk — event persistence is the wrapper's responsibility (see `stdio-wrapper` spec).

#### Scenario: Wrapper posts a tool_call_started event
- **WHEN** the daemon receives `POST /telemetry` with a valid `McpToolEvent` body including `ide` and `workspaceSlug`
- **THEN** the daemon SHALL broadcast the event to all open SSE streams
- **THEN** the daemon SHALL respond with `200 {}`
- **THEN** the daemon SHALL NOT write the event to disk

#### Scenario: No SSE connections open
- **WHEN** a telemetry event arrives and no SSE streams are open
- **THEN** the daemon SHALL respond `200 {}` and make no disk write
