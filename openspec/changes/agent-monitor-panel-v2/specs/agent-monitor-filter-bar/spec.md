## ADDED Requirements

### Requirement: Filter bar provides tool name text search
The panel SHALL provide a text input that filters the log to show only entries whose `toolName` contains the entered string (case-insensitive substring match).

#### Scenario: User types a tool name filter
- **WHEN** the user types text into the tool name filter input
- **THEN** the panel SHALL immediately hide all entries whose `toolName` does not contain the entered text (case-insensitive)
- **THEN** entries matching the filter SHALL remain visible

#### Scenario: Filter input is cleared
- **WHEN** the user clears the tool name filter input
- **THEN** all entries that pass the other active filters SHALL become visible again

---

### Requirement: Filter bar provides server name selection
The panel SHALL provide a select control that filters the log to show only entries from a specific server. The select SHALL be populated dynamically from the server names seen in the current log.

#### Scenario: Server name options populated from log
- **WHEN** an event with a new `serverName` is rendered into the log
- **THEN** that `serverName` SHALL be added as an option in the server select control if not already present

#### Scenario: User selects a server name
- **WHEN** the user selects a specific server from the server select
- **THEN** the panel SHALL hide all entries whose `serverName` does not match the selected value

#### Scenario: All servers selected (default)
- **WHEN** the panel opens or the user selects "All" in the server select
- **THEN** no filtering by server name SHALL be applied

---

### Requirement: Filter bar provides call status selection
The panel SHALL provide a select control that filters the log by call status: All, In-progress, Completed, or Failed.

#### Scenario: User filters by status
- **WHEN** the user selects "Completed" from the status filter
- **THEN** only entries with `entry.className` containing `completed` SHALL be visible

#### Scenario: User filters by failed
- **WHEN** the user selects "Failed" from the status filter
- **THEN** only entries with `entry.className` containing `failed` SHALL be visible

#### Scenario: All statuses selected (default)
- **WHEN** the panel opens or the user selects "All" in the status filter
- **THEN** no filtering by status SHALL be applied

---

### Requirement: Filter bar provides time range selection
The panel SHALL provide a select control that filters the log to entries within a relative time window: All, Last Hour, or Today.

#### Scenario: User selects Last Hour
- **WHEN** the user selects "Last Hour" from the time range filter
- **THEN** only entries whose `timestamp` is within the last 60 minutes SHALL be visible
- **THEN** entries with no timestamp SHALL be hidden

#### Scenario: User selects Today
- **WHEN** the user selects "Today" from the time range filter
- **THEN** only entries whose `timestamp` falls on the current calendar day (local time) SHALL be visible

#### Scenario: All time selected (default)
- **WHEN** the panel opens or the user selects "All" in the time range filter
- **THEN** no filtering by time range SHALL be applied

---

### Requirement: Filter bar controls apply in combination
All active filter bar controls SHALL apply simultaneously (AND logic). An entry is visible only if it passes every active filter.

#### Scenario: Multiple filters active
- **WHEN** a tool name filter and a status filter are both active
- **THEN** only entries matching BOTH the tool name AND the status SHALL be visible

#### Scenario: Filter changes while entries are in the log
- **WHEN** the user changes any filter control
- **THEN** `reapplyFilters()` SHALL run immediately and update the `display` style of all existing entries
- **THEN** the log scroll position SHALL be preserved

---

### Requirement: Filter bar state is in-memory only
Filter bar control values (tool name, server, status, time range) SHALL NOT be persisted to `localStorage`. They reset each time the panel is opened.

#### Scenario: Panel is closed and reopened
- **WHEN** the user closes and reopens the Agent Monitor panel
- **THEN** all filter bar controls SHALL revert to their default ("All" / empty) values
- **THEN** the IDE/workspace connection filter (stored in `localStorage`) SHALL be restored separately from the filter bar state
