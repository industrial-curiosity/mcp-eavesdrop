## MODIFIED Requirements

### Requirement: Panel displays real-time tool call log
The panel SHALL render a scrolling list of `McpToolEvent` entries showing timestamp, tool name, status, and duration.

#### Scenario: In-progress tool call display
- **WHEN** a `tool_call_started` event is received
- **THEN** the panel SHALL add an entry with the event timestamp shown in a leftmost timestamp column
- **THEN** the panel SHALL add the tool name and a spinner
- **THEN** no duration SHALL be shown until the call completes

#### Scenario: Timestamp source for live and history entries
- **WHEN** a live event or history event is rendered
- **THEN** the timestamp column SHALL be derived from `event.timestamp`
- **THEN** existing persisted `.jsonl` logs that already include `timestamp` SHALL render without requiring log deletion or migration

#### Scenario: Completed tool call display
- **WHEN** a `tool_call_completed` event is received for a tracked call
- **THEN** the panel SHALL update the entry to show a success indicator and `durationMs` in milliseconds

#### Scenario: Failed tool call display
- **WHEN** a `tool_call_failed` event is received for a tracked call
- **THEN** the panel SHALL update the entry to show a red error indicator with the error message
- **THEN** the panel SHALL show `durationMs` if available

---

### Requirement: Tool call entries are expandable
Each tool call entry SHALL be expandable to reveal full JSON-formatted arguments and result/error details. When `meta` is present on the event, it SHALL also be displayed in the expanded section.

#### Scenario: User expands a completed entry
- **WHEN** the user clicks on a completed tool call entry
- **THEN** the panel SHALL toggle an expanded section showing pretty-printed JSON for `arguments` and `result`

#### Scenario: Meta field displayed when present
- **WHEN** a tool call entry has a non-empty `meta` object
- **THEN** the expanded section SHALL include a "Meta" section showing the `meta` object as pretty-printed JSON
- **WHEN** `meta` is absent or empty
- **THEN** no "Meta" section SHALL be rendered

#### Scenario: XSS prevention in expanded content
- **WHEN** arguments, results, or meta values contain HTML or script characters
- **THEN** the panel SHALL render them as plain text using DOM `textContent` (never `innerHTML`)

---

## MODIFIED Requirements

### Requirement: Panel displays all connected windows in a sidebar
The panel SHALL show a list of all currently connected extension instances (across all IDEs and workspaces) as reported by the daemon's `/connections` endpoint. The sidebar SHALL render into a `#connections` element that is present in the webview HTML at load time.

#### Scenario: Connections loaded on panel open
- **WHEN** the panel opens
- **THEN** the extension host SHALL fetch `GET /connections` from the daemon and send the result to the webview
- **THEN** the panel SHALL render each connection showing `ide`, `workspace`, and `connectedAt`

#### Scenario: Connections sidebar element present in HTML
- **WHEN** the webview HTML is loaded
- **THEN** a `<div id="connections">` element SHALL exist in the DOM before any script runs
- **THEN** `document.getElementById('connections')` SHALL return a non-null element

#### Scenario: Connections updated
- **WHEN** the extension receives a `connections_changed` event on the SSE stream
- **THEN** the extension SHALL re-fetch `GET /connections` and send the updated list to the webview

---

## REMOVED Requirements

### Requirement: Panel assigns stable distinct colors to conversation IDs
**Reason**: VS Code's Copilot extension does not populate `_meta.vscode.conversationId` for third-party MCP tools. The `conversationId` field is never present on `McpToolEvent` in practice, making the color badge inert dead code.
**Migration**: Remove `colorPalette`, `occupiedSlots`, `conversationColors`, `parseHex`, `toHex`, `midColor`, `extendPalette`, `charCodeSum`, and `getConversationColor` from `app.ts`. Remove `.conv-badge` from `styles.css`. The `conversationId` field remains on the `McpToolEvent` type so the data is retained if VS Code ever populates `_meta` in future; only the rendering is removed.
