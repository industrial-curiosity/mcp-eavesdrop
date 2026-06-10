## MODIFIED Requirements

### Requirement: Panel filters the event log by IDE and workspace
The panel SHALL allow the user to select which events are visible by filtering on IDE and conversation ID. Workspace slug SHALL NOT be used as a filtering key for new events.

#### Scenario: Filter applied
- **WHEN** the user deselects an IDE value or a conversation ID value in the filter controls
- **THEN** events with matching `ide` and `conversationId` SHALL be hidden from the log
- **THEN** the filter SHALL apply to both new incoming events and previously rendered entries

#### Scenario: All filter values selected (default)
- **WHEN** the panel opens
- **THEN** all IDE values and all discovered conversation IDs SHALL be selected and all events SHALL be visible

#### Scenario: Unknown conversation bucket
- **WHEN** an event has no `conversationId` field
- **THEN** the panel SHALL include `"not detected"` as an explicit filter option

## ADDED Requirements

### Requirement: Panel displays dedicated IDE and conversation ID columns
The panel log table SHALL display IDE in its source column and SHALL include a dedicated conversation ID column for each event row.

#### Scenario: Event row rendering
- **WHEN** a tool call entry is rendered
- **THEN** the source column SHALL display `ide`
- **THEN** the conversation column SHALL display `conversationId`
- **THEN** the panel SHALL NOT render workspace slug in the source label for new events

#### Scenario: Missing conversation metadata already normalized
- **WHEN** the event has no `conversationId` field
- **THEN** the conversation column SHALL render `"not detected"` exactly and support filtering on that value
