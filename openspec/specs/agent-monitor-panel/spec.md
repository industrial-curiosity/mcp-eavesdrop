## ADDED Requirements

### Requirement: Panel opens in secondary editor column
The extension SHALL open the AI Agent Monitor panel in the secondary editor column (beside the active editor) when the `myai.openPanel` command is invoked.

#### Scenario: Panel opens beside active editor
- **WHEN** the user runs `myai.openPanel`
- **THEN** the panel SHALL open in `ViewColumn.Beside`
- **THEN** if the panel is already open, it SHALL reveal (focus) the existing panel instead of opening a second one

---

### Requirement: Panel connects to proxy event stream on load
The panel WebView SHALL connect to the proxy's WebSocket endpoint using the port received in the `init` message from the extension host.

#### Scenario: Panel initializes successfully
- **WHEN** the WebView receives an `init` message with `{ proxyPort: number }`
- **THEN** the panel SHALL open a WebSocket connection to `ws://127.0.0.1:<proxyPort>/events`
- **THEN** the panel SHALL send a `ready` message to the extension host

#### Scenario: WebSocket connection lost
- **WHEN** the WebSocket connection drops unexpectedly
- **THEN** the panel SHALL display a "Disconnected — reconnecting…" status indicator
- **THEN** the panel SHALL attempt to reconnect with exponential backoff (max 10s interval)

---

### Requirement: Panel displays real-time tool call log
The panel SHALL render a scrolling list of `McpToolEvent` entries showing tool name, status, and duration.

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

---

### Requirement: Tool call entries are expandable
Each tool call entry SHALL be expandable to reveal full JSON-formatted arguments and result/error details.

#### Scenario: User expands a completed entry
- **WHEN** the user clicks on a completed tool call entry
- **THEN** the panel SHALL toggle an expanded section showing pretty-printed JSON for `arguments` and `result`

#### Scenario: XSS prevention in expanded content
- **WHEN** arguments or results contain HTML or script characters
- **THEN** the panel SHALL render them as plain text using DOM `textContent` (never `innerHTML`)

---

### Requirement: Panel auto-scrolls to latest entry
The panel log SHALL automatically scroll to the most recent entry as new events arrive.

#### Scenario: New event while scrolled to bottom
- **WHEN** the user is scrolled to the bottom and a new event arrives
- **THEN** the panel SHALL scroll to show the new entry

#### Scenario: New event while user has scrolled up
- **WHEN** the user has scrolled up to review earlier entries and a new event arrives
- **THEN** the panel SHALL NOT force-scroll (preserving the user's scroll position)

---

### Requirement: Panel handles proxy port changes without user action
The panel SHALL reconnect to the proxy WebSocket automatically when the extension host sends a new `init` message with a changed port (e.g. after a proxy restart).

#### Scenario: Proxy restarts while panel is open
- **WHEN** the extension sends a new `init` message with a different `proxyPort`
- **THEN** the panel SHALL close the existing WebSocket connection
- **THEN** the panel SHALL open a new WebSocket connection to the updated port
- **THEN** no user action SHALL be required

---

### Requirement: Clear button resets the session log
The panel SHALL provide a "Clear" button that removes all displayed entries and notifies the extension host.

#### Scenario: User clicks Clear
- **WHEN** the user clicks the "Clear" button
- **THEN** the panel SHALL remove all entries from the local log
- **THEN** the panel SHALL send a `clearSession` message to the extension host

---

### Requirement: Panel uses VS Code theme variables
The panel UI SHALL use VS Code CSS custom properties (`--vscode-*`) exclusively for all colors, fonts, and backgrounds.

#### Scenario: Theme changes while panel is open
- **WHEN** the user switches VS Code theme (light/dark/high-contrast)
- **THEN** the panel colors SHALL update automatically without requiring a reload
