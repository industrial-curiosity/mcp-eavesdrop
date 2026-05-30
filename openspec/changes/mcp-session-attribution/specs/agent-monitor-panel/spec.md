## MODIFIED Requirements

### Requirement: Panel displays real-time tool call log
The panel SHALL render a scrolling list of `McpToolEvent` entries showing tool name, status, duration, and a short conversation label when `conversationId` is present. Entries from different conversations SHALL be separated by a subtle visual divider showing the conversation label.

#### Scenario: In-progress tool call display
- **WHEN** a `tool_call_started` event is received
- **THEN** the panel SHALL add an entry with the tool name and a spinner
- **THEN** no duration SHALL be shown until the call completes

#### Scenario: Completed tool call display
- **WHEN** a `tool_call_completed` event is received for a tracked call
- **THEN** the panel SHALL update the entry to show a success indicator and `durationMs` in milliseconds

#### Scenario: Failed tool call display
- **WHEN** a `tool_call_failed` event is received for a tracked call
- **THEN** the panel SHALL update the entry to show a red error indicator with the error message
- **THEN** the panel SHALL show `durationMs` if available

#### Scenario: Tool call with conversation ID
- **WHEN** a `tool_call_started` event includes a `conversationId`
- **THEN** the panel SHALL display a badge showing the full `conversationId` — truncation is forbidden
- **WHEN** the previous event in the log had a different `conversationId`
- **THEN** the panel SHALL render a divider line between the two entries labelled with the full `conversationId`

#### Scenario: Tool call without conversation ID
- **WHEN** a `tool_call_started` event has no `conversationId`
- **THEN** the panel SHALL render the entry without a conversation badge and without inserting a session divider

## ADDED Requirements

### Requirement: McpToolEvent carries optional session attribution fields
The `McpToolEvent` type SHALL include optional `conversationId` and `requestId` string fields. Both fields SHALL be absent (not present in the object) when the originating MCP call did not carry VS Code session metadata.

#### Scenario: Event with session attribution
- **WHEN** the daemon forwards a telemetry event that includes `conversationId`
- **THEN** the `McpToolEvent` received by the panel SHALL include `conversationId` and (if present) `requestId`

#### Scenario: Event without session attribution
- **WHEN** the daemon forwards a telemetry event with no `conversationId`
- **THEN** the `McpToolEvent` received by the panel SHALL not include those fields
- **THEN** the panel SHALL render the event without a conversation badge
