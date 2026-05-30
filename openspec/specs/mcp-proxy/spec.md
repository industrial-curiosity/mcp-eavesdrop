### Requirement: Proxy accepts telemetry POSTs from the stdio wrapper
The daemon SHALL accept `POST /telemetry` requests on its Unix socket HTTP server containing a `McpToolEvent` JSON body plus `ide` and `workspaceSlug` fields and broadcast the event to all registered SSE connections. The daemon SHALL NOT write the event to disk — event persistence is the wrapper's responsibility.

#### Scenario: Wrapper posts a tool_call_started event
- **WHEN** the daemon receives `POST /telemetry` with a valid `McpToolEvent` body including `ide` and `workspaceSlug`
- **THEN** the daemon SHALL broadcast the event to all open SSE streams
- **THEN** the daemon SHALL respond with `200 {}`
- **THEN** the daemon SHALL NOT write the event to disk

#### Scenario: Malformed telemetry body
- **WHEN** the body is not valid JSON or is missing required fields (`id`, `type`, `timestamp`)
- **THEN** the daemon SHALL respond with `400` and make no broadcast or disk write

#### Scenario: No SSE connections open
- **WHEN** a telemetry event arrives and no SSE streams are open
- **THEN** the daemon SHALL respond `200 {}` and make no disk write
