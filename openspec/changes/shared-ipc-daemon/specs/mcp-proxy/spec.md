## REMOVED Requirements

### Requirement: Proxy binds to loopback on a random port
**Reason**: Replaced by the shared IPC daemon, which owns the HTTP MCP proxy on a dynamic but stable TCP port. No per-window proxy process exists.
**Migration**: The daemon's proxy port is read from `~/.myai/daemon.json`. The extension no longer spawns a proxy child process.

### Requirement: Proxy WebSocket endpoint accepts multiple simultaneous clients
**Reason**: Event fan-out is now handled by the daemon's SSE broadcast over the Unix socket. The per-window relay server exposes the SSE stream to the webview.
**Migration**: The webview connects to the per-window relay's SSE endpoint instead of a WebSocket on a proxy TCP port.

---

## MODIFIED Requirements

### Requirement: Proxy forwards MCP JSON-RPC requests to upstream servers
The daemon's HTTP MCP proxy SHALL accept MCP HTTP POST requests and transparently forward them to the upstream MCP server URL specified in the `x-upstream-url` request header, returning the upstream response to the caller.

#### Scenario: Successful tool call forwarding
- **WHEN** an agent sends a JSON-RPC `tools/call` request to the proxy with an `x-upstream-url` header
- **THEN** the proxy SHALL forward the request to the upstream MCP server
- **THEN** the proxy SHALL return the upstream response unchanged to the agent
- **THEN** the total added latency SHALL be less than 50ms for requests under 10KB

#### Scenario: Upstream server unreachable
- **WHEN** the upstream MCP server cannot be reached
- **THEN** the proxy SHALL return a JSON-RPC error response with code `-32000` and a message describing the connectivity failure

---

### Requirement: Proxy emits structured events for tool calls
The daemon SHALL emit `McpToolEvent` objects enriched with `ide` and `workspaceSlug` fields for every intercepted tool call, persisting them to disk and broadcasting them to all registered SSE connections.

#### Scenario: Tool call started event
- **WHEN** the proxy receives a `tools/call` request
- **THEN** the daemon SHALL emit a `tool_call_started` event with `id`, `toolName`, `serverName`, `timestamp`, `arguments`, `ide`, and `workspaceSlug`
- **THEN** `arguments` SHALL be truncated to 10KB if larger

#### Scenario: Tool call completed event
- **WHEN** the upstream server returns a successful response
- **THEN** the daemon SHALL emit a `tool_call_completed` event with the matching `id`, `result`, `durationMs`, `ide`, and `workspaceSlug`
- **THEN** `result` SHALL be truncated to 10KB if larger

#### Scenario: Tool call failed event
- **WHEN** the upstream server returns an error or is unreachable
- **THEN** the daemon SHALL emit a `tool_call_failed` event with the matching `id`, `error` message, `durationMs`, `ide`, and `workspaceSlug`

---

### Requirement: Proxy accepts telemetry POSTs from the stdio wrapper
The daemon SHALL accept `POST /telemetry` requests on its Unix socket HTTP server containing a `McpToolEvent` JSON body plus `ide` and `workspaceSlug` fields, persist the event, and broadcast it to all registered SSE connections.

#### Scenario: Wrapper posts a tool_call_started event
- **WHEN** the daemon receives `POST /telemetry` with a valid `McpToolEvent` body including `ide` and `workspaceSlug`
- **THEN** the daemon SHALL append the event to `~/.myai/logs/{ide}/{workspaceSlug}.jsonl`
- **THEN** the daemon SHALL broadcast the event to all open SSE streams
- **THEN** the daemon SHALL respond with `200 {}`

#### Scenario: Malformed telemetry body
- **WHEN** the body is not valid JSON or is missing required fields (`id`, `type`, `timestamp`)
- **THEN** the daemon SHALL respond with `400` and make no broadcast or disk write

#### Scenario: No SSE connections open
- **WHEN** a telemetry event arrives and no SSE streams are open
- **THEN** the daemon SHALL still persist the event to disk and respond `200 {}`
