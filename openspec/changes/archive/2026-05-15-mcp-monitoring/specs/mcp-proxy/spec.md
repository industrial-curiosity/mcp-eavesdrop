## ADDED Requirements

### Requirement: Proxy accepts telemetry POSTs from the stdio wrapper
The proxy SHALL accept `POST /internal/telemetry` requests containing a pre-formed `McpToolEvent` JSON body and broadcast the event to all connected WebSocket clients.

#### Scenario: Wrapper posts a tool_call_started event
- **WHEN** the proxy receives `POST /internal/telemetry` with a valid `McpToolEvent` body
- **THEN** the proxy SHALL broadcast the event to all `/events` WebSocket clients without modification
- **THEN** the proxy SHALL respond with `200 {}` to the wrapper

#### Scenario: Malformed telemetry body
- **WHEN** the body is not valid JSON or is missing required `McpToolEvent` fields
- **THEN** the proxy SHALL respond with `400` and make no broadcast

#### Scenario: No WebSocket clients connected
- **WHEN** a telemetry event arrives and no clients are connected to `/events`
- **THEN** the proxy SHALL accept and discard the event without error
