## MODIFIED Requirements

### Requirement: Proxy accepts telemetry POSTs from the stdio wrapper
The daemon SHALL accept `POST /telemetry` requests on its Unix socket HTTP server containing a `McpToolEvent` JSON body with `ide` and optional `conversationId` fields and broadcast the event to all registered SSE connections. The daemon SHALL NOT write the event to disk — event persistence is the wrapper's responsibility.

#### Scenario: Wrapper posts a tool_call_started event
- **WHEN** the daemon receives `POST /telemetry` with a valid `McpToolEvent` body including `ide`
- **THEN** the daemon SHALL broadcast the event to all open SSE streams
- **THEN** the daemon SHALL respond with `200 {}`
- **THEN** the daemon SHALL NOT write the event to disk

#### Scenario: Missing conversation metadata is preserved as absent
- **WHEN** wrapper telemetry originates from a request without conversation metadata
- **THEN** the event body SHALL omit `conversationId`
- **THEN** the daemon SHALL broadcast and persist the event unchanged

#### Scenario: Wrapper ignores legacy workspace env metadata
- **WHEN** wrapper runtime environment contains a legacy `MCPEAVESDROP_WORKSPACE_SLUG` key
- **THEN** the wrapper SHALL NOT derive event attribution from that key
- **THEN** emitted telemetry SHALL continue to include IDE attribution and source conversation metadata only when present

#### Scenario: Malformed telemetry body
- **WHEN** the body is not valid JSON or is missing required fields (`id`, `type`, `timestamp`)
- **THEN** the daemon SHALL respond with `400` and make no broadcast or disk write

#### Scenario: No SSE connections open
- **WHEN** a telemetry event arrives and no SSE streams are open
- **THEN** the daemon SHALL respond `200 {}` and make no disk write
