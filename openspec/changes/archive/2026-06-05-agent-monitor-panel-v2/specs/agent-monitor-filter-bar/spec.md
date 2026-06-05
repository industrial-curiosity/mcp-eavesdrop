## ADDED Requirements

### Requirement: Filter bar columns align with log entry columns
The filter bar controls SHALL be horizontally aligned with the corresponding columns in the log entries below them: the tool name input SHALL align with the `.entry-name` text, and the server select SHALL align with the `.entry-server` text.

#### Scenario: Tool name input aligns with entry tool name column
- **WHEN** the filter bar and a log entry are both visible
- **THEN** the left edge of the tool name input text SHALL be horizontally aligned with the left edge of `.entry-name` text in log entries
- **THEN** this alignment SHALL account for the entry's `border-left`, left padding, date+time timestamp column width, status icon width, and gap

#### Scenario: Server select aligns with entry server column
- **WHEN** the filter bar and a log entry are both visible
- **THEN** the right edge of the server select SHALL be horizontally aligned with the right edge of `.entry-server` text in log entries

#### Scenario: Alignment holds across VS Code themes
- **WHEN** the user switches VS Code theme or font size
- **THEN** the column alignment SHALL remain consistent because it uses the same CSS layout properties as the entry columns (not hardcoded pixel values where font-relative units apply)

---

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

---

### Requirement: Any filter change always requests history reload
Whenever any filter control value changes, the panel SHALL re-request history from the extension host so that persisted events matching the new filter state are always available, regardless of the current log state.

#### Scenario: User changes any filter control
- **WHEN** the user changes any filter control (tool name input, server select, status select, or time range select)
- **THEN** the panel SHALL post `{ type: 'requestHistory' }` to the extension host
- **THEN** the extension host SHALL respond by pushing a `history` message with all persisted events
- **THEN** only events passing all currently active filters SHALL be displayed

#### Scenario: Log already contains entries when filter changes
- **GIVEN** the log contains one or more entries
- **WHEN** the user changes any filter control
- **THEN** the panel SHALL still post `requestHistory` to ensure no persisted events are missed
- **THEN** duplicate `tool_call_started` entries (same `id`) SHALL NOT be added to the log — only `tool_call_started` events whose `id` is already in the `entries` Map SHALL be skipped; `tool_call_completed` and `tool_call_failed` events with the same `id` SHALL still be processed to update existing entries

#### Scenario: Text input filter debounces history reload
- **WHEN** the user types into the tool name text input
- **THEN** `reapplyFilters()` SHALL run immediately on each keystroke
- **THEN** the `requestHistory` post SHALL be debounced (e.g., 300 ms) so that a burst of keystrokes produces at most one reload request

#### Scenario: Reverting all filters to defaults shows all loaded events
- **WHEN** the user resets all filter controls to their default values
- **THEN** all events loaded from history SHALL become visible (subject to the IDE/workspace filter)

---

### Requirement: Log entries can be sorted chronologically
The panel SHALL provide a sort-order toggle in the filter bar that controls whether log entries are displayed in ascending (oldest first) or descending (newest first) chronological order by `timestamp`.

#### Scenario: Default sort order is newest first
- **WHEN** the panel opens for the first time
- **THEN** entries SHALL be displayed newest-first (descending by `timestamp`)

#### Scenario: User toggles sort to oldest first
- **GIVEN** the log is displaying entries newest-first
- **WHEN** the user activates the sort toggle
- **THEN** all visible entries SHALL be re-ordered to oldest-first (ascending by `timestamp`)
- **THEN** new incoming events SHALL be inserted in the correct position relative to the current sort order

#### Scenario: User toggles sort back to newest first
- **GIVEN** the log is displaying entries oldest-first
- **WHEN** the user activates the sort toggle
- **THEN** all visible entries SHALL be re-ordered to newest-first (descending by `timestamp`)

#### Scenario: Sort order applies after history reload
- **WHEN** a `history` message arrives (from `requestHistory` or initial `ready`)
- **THEN** all entries added from history SHALL be inserted respecting the current sort order

#### Scenario: Sort order is in-memory only
- **WHEN** the user closes and reopens the panel
- **THEN** sort order SHALL reset to the default (newest first)
