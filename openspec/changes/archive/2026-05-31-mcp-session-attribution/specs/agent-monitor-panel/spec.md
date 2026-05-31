## MODIFIED Requirements

### Requirement: Panel displays real-time tool call log
The panel SHALL render a scrolling list of `McpToolEvent` entries in chronological order, showing tool name, status, duration, and a color-coded conversation badge when `conversationId` is present.

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
- **THEN** the panel SHALL display a color-coded badge showing the full `conversationId` — truncation is forbidden
- **THEN** the color assigned to that `conversationId` SHALL be consistent for the lifetime of the panel session: the same ID always renders the same color

#### Scenario: Tool call without conversation ID
- **WHEN** a `tool_call_started` event has no `conversationId`
- **THEN** the panel SHALL render the entry without a conversation badge

## ADDED Requirements

### Requirement: Panel assigns stable distinct colors to conversation IDs
The panel SHALL maintain a `Map<string, string>` (conversationId → CSS color) for the lifetime of the panel session.

**Initial palette**: 8 colors — `#3B82F6` (blue), `#8B5CF6` (violet), `#10B981` (emerald), `#EA580C` (orange), `#EF4444` (red), `#06B6D4` (cyan), `#EC4899` (pink), `#0D9488` (teal) — chosen for visibility on VS Code dark and light themes.

**Assignment**: hash the ID to an initial palette slot (`charCodeSum % palette.length`); walk forward until an unoccupied slot is found.

**Extension**: when all current palette slots are occupied, insert the per-channel integer RGB midpoint between every adjacent pair (wrapping last to first), doubling the palette. Repeat on each subsequent exhaustion — each halving produces finer intermediate hues. Once assigned, a color is stable: the same ID always renders the same color.

#### Scenario: Consistent color across events
- **WHEN** multiple events share the same `conversationId`
- **THEN** all SHALL render with the same badge color

#### Scenario: Distinct colors for different IDs
- **WHEN** two different `conversationId` values hash to the same palette slot
- **THEN** the second ID SHALL receive the next unoccupied palette color via linear probe
- **THEN** both IDs SHALL render with visually distinct colors

#### Scenario: Palette exhausted — extension
- **WHEN** all current palette slots are assigned and a new `conversationId` arrives
- **THEN** the panel SHALL extend the palette by inserting per-channel integer midpoints between each adjacent pair (wrapping)
- **THEN** the new ID SHALL be assigned one of the newly created slots

### Requirement: McpToolEvent carries optional session attribution fields
The `McpToolEvent` type SHALL include optional `conversationId` and `requestId` string fields. Both fields SHALL be absent (not present in the object) when the originating MCP call did not carry VS Code session metadata.

#### Scenario: Event with session attribution
- **WHEN** the daemon forwards a telemetry event that includes `conversationId`
- **THEN** the `McpToolEvent` received by the panel SHALL include `conversationId` and (if present) `requestId`

#### Scenario: Event without session attribution
- **WHEN** the daemon forwards a telemetry event with no `conversationId`
- **THEN** the `McpToolEvent` received by the panel SHALL not include those fields
- **THEN** the panel SHALL render the event without a conversation badge
