## ADDED Requirements

### Requirement: Conversation identity display SHALL normalize missing values
The monitoring presentation layer SHALL map missing event conversation identity to the literal label `"not detected"` for display and filtering.

#### Scenario: Conversation metadata present
- **WHEN** a `tools/call` request includes `_meta['vscode.conversationId']` as a non-empty string
- **THEN** the panel SHALL display that exact conversation ID value

#### Scenario: Conversation metadata absent
- **WHEN** an event has no `conversationId` field
- **THEN** the panel SHALL display `"not detected"`

### Requirement: Conversation identity SHALL be filterable and visible in monitoring output
The monitor presentation layer SHALL expose conversation identity as a first-class display and filter dimension independent of workspace attribution.

#### Scenario: Filtering by detected conversation
- **WHEN** a user selects a specific conversation ID filter value
- **THEN** only events whose `conversationId` equals that value SHALL be visible

#### Scenario: Filtering unknown conversation bucket
- **WHEN** a user selects `"not detected"` in conversation filters
- **THEN** only events with `conversationId` equal to `"not detected"` SHALL be visible
