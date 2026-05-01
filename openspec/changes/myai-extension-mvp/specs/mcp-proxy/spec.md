## ADDED Requirements

### Requirement: Proxy binds to loopback on a random port
The proxy server SHALL bind exclusively to `127.0.0.1` on an OS-assigned port (port 0) and report the bound port to the parent process via stdout as JSON: `{"port": <number>}`.

#### Scenario: Proxy starts successfully
- **WHEN** the extension host spawns the proxy child process
- **THEN** the proxy SHALL emit `{"port": <number>}` on stdout within 5 seconds
- **THEN** the bound port SHALL be between 1024 and 65535

#### Scenario: Port is not accessible from outside loopback
- **WHEN** the proxy is running
- **THEN** connections from addresses other than `127.0.0.1` SHALL be rejected

---

### Requirement: Proxy forwards MCP JSON-RPC requests to upstream servers
The proxy SHALL accept MCP HTTP POST requests and transparently forward them to the configured upstream MCP server URL, returning the upstream response to the caller.

#### Scenario: Successful tool call forwarding
- **WHEN** an agent sends a JSON-RPC `tools/call` request to the proxy
- **THEN** the proxy SHALL forward the request to the upstream MCP server
- **THEN** the proxy SHALL return the upstream response unchanged to the agent
- **THEN** the total added latency SHALL be less than 50ms for requests under 10KB

#### Scenario: Upstream server unreachable
- **WHEN** the upstream MCP server cannot be reached
- **THEN** the proxy SHALL return a JSON-RPC error response with code `-32000` and a message describing the connectivity failure

---

### Requirement: Proxy emits structured events for tool calls
The proxy SHALL emit `McpToolEvent` objects over a WebSocket endpoint at path `/events` for every intercepted tool call.

#### Scenario: Tool call started event
- **WHEN** the proxy receives a `tools/call` request
- **THEN** the proxy SHALL emit a `tool_call_started` event with a unique `id`, `toolName`, `serverName`, `timestamp`, and `arguments`
- **THEN** `arguments` SHALL be truncated to 10KB if larger

#### Scenario: Tool call completed event
- **WHEN** the upstream server returns a successful response
- **THEN** the proxy SHALL emit a `tool_call_completed` event with the matching `id`, `result`, and `durationMs`
- **THEN** `result` SHALL be truncated to 10KB if larger

#### Scenario: Tool call failed event
- **WHEN** the upstream server returns an error or is unreachable
- **THEN** the proxy SHALL emit a `tool_call_failed` event with the matching `id`, `error` message, and `durationMs`

---

### Requirement: Proxy WebSocket endpoint accepts multiple simultaneous clients
The proxy SHALL support multiple WebSocket connections to `/events` simultaneously and broadcast all events to all connected clients.

#### Scenario: Multiple panel clients connected
- **WHEN** two or more clients are connected to `/events`
- **THEN** each emitted event SHALL be delivered to all connected clients

#### Scenario: Client disconnects
- **WHEN** a WebSocket client disconnects
- **THEN** the proxy SHALL remove the client from the broadcast list without error
