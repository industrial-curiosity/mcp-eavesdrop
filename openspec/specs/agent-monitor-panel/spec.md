## ADDED Requirements

### Requirement: Panel opens in secondary editor column
The extension SHALL open the AI Agent Monitor panel in the secondary editor column (beside the active editor) when the `myai.openPanel` command is invoked.

#### Scenario: Panel opens beside active editor
- **WHEN** the user runs `myai.openPanel`
- **THEN** the panel SHALL open in `ViewColumn.Beside`
- **THEN** if the panel is already open, it SHALL reveal (focus) the existing panel instead of opening a second one

---

### Requirement: Panel receives live events from extension host
The panel WebView SHALL be fully passive with respect to network connections. All live events SHALL be delivered by the extension host via `panel.webview.postMessage`. The webview SHALL NOT make any direct HTTP or WebSocket connection to the daemon or proxy. The CSP SHALL NOT include a `connect-src` directive.

#### Scenario: Panel signals readiness
- **WHEN** the WebView finishes loading
- **THEN** the panel SHALL send `{ type: 'ready' }` to the extension host via `vscode.postMessage`
- **THEN** the extension host SHALL respond with `{ type: 'status', connected: boolean }` and `{ type: 'connections', connections: [...] }`

#### Scenario: Live event arrives
- **WHEN** the extension host receives a parsed `McpToolEvent` from the daemon SSE stream
- **THEN** the extension host SHALL send `{ type: 'event', event: McpToolEvent }` to the webview
- **THEN** the panel SHALL render the event identically to a history event

#### Scenario: Daemon disconnects while panel is open
- **WHEN** the daemon SSE stream ends or errors
- **THEN** the extension host SHALL send `{ type: 'status', connected: false }` to the webview
- **THEN** the panel SHALL display "Disconnected — reconnecting…"
- **THEN** the extension host (not the webview) SHALL manage reconnection to the daemon

#### Scenario: Daemon reconnects while panel is open
- **WHEN** the extension host successfully resubscribes to the daemon SSE stream
- **THEN** the extension host SHALL send `{ type: 'status', connected: true }` to the webview
- **THEN** the panel SHALL clear the disconnect indicator

---

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

#### Scenario: Initial panel load includes latest persisted events
- **WHEN** the panel is opened
- **THEN** the extension host SHALL load history from disk including the most recent events written for today
- **THEN** events posted via daemon `/telemetry` SHALL be present in the loaded history, not only in live SSE

#### Scenario: Timestamp format includes date and time
- **WHEN** a log entry is rendered
- **THEN** the left timestamp column SHALL display local date and time (not time-only)
- **THEN** the format SHALL be compact and stable enough for side-by-side row comparison

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

### Requirement: Panel auto-scrolls to latest entry
The panel log SHALL automatically scroll to the most recent entry as new events arrive.

#### Scenario: New event while scrolled to bottom
- **WHEN** the user is scrolled to the bottom and a new event arrives
- **THEN** the panel SHALL scroll to show the new entry

#### Scenario: New event while user has scrolled up
- **WHEN** the user has scrolled up to review earlier entries and a new event arrives
- **THEN** the panel SHALL NOT force-scroll (preserving the user's scroll position)

---

### Requirement: Panel handles daemon restarts without user action
The extension host SHALL handle daemon restarts transparently by reconnecting to the Unix socket. The webview SHALL NOT be involved in reconnection logic.

#### Scenario: Daemon restarts while panel is open
- **WHEN** the daemon restarts and `~/.myai/daemon.json` is updated with a new `socketPath` or `startedAt`
- **THEN** the extension host SHALL detect the socket failure during the next reconnect attempt
- **THEN** the extension host SHALL re-read `~/.myai/daemon.json`, connect to the socket path found there, and re-subscribe to the daemon SSE stream
- **THEN** no user action SHALL be required
- **THEN** the webview SHALL receive only `{ type: 'status', connected: true }` — it SHALL NOT receive daemon connection details

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

---

### Requirement: Extension host subscribes to daemon SSE and forwards events to webview
The extension host SHALL subscribe to the daemon's SSE stream via `GET /events` on the Unix socket. It SHALL parse raw SSE data lines, extract `McpToolEvent` objects, and forward each to the active webview panel via `postMessage`. The extension host SHALL also send `status` and `connections` messages on lifecycle transitions.

#### Scenario: Subscription established on activation
- **WHEN** the extension activates and the daemon is running
- **THEN** the extension host SHALL open an HTTP request to `GET /events?instanceId=<id>` on `~/.myai/ipc.sock`
- **THEN** on connection, the extension host SHALL set `daemonConnected = true` and send `{ type: 'status', connected: true }` to the panel

#### Scenario: SSE event forwarding
- **WHEN** the daemon emits a `data:` SSE line on the stream
- **THEN** the extension host SHALL parse the JSON payload
- **THEN** the extension host SHALL call `AgentPanel.postMessage({ type: 'event', event })`
- **THEN** if `event.type === 'connections_changed'`, the extension host SHALL re-fetch `GET /connections` and send `{ type: 'connections', connections }` to the panel

#### Scenario: Panel ready callback
- **WHEN** the panel sends `{ type: 'ready' }` to the extension host
- **THEN** `AgentPanel.onPanelReady` SHALL be called
- **THEN** the extension host SHALL send the current `status` and re-fetch `connections` to initialize the panel

#### Scenario: VS Code webview sandbox compatibility
- **WHEN** the webview is running in VS Code's sandboxed Electron renderer
- **THEN** all event delivery SHALL use `panel.webview.postMessage` (extension host → webview only)
- **THEN** the webview CSP SHALL NOT include `connect-src` (no outbound network access from webview)

---

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

#### Scenario: Non-connection event sources appear in sidebar filters
- **WHEN** history or live events contain an `ide/workspaceSlug` source that is not present in the daemon `/connections` payload
- **THEN** the sidebar SHALL still include a filter row for that source so those events can be shown/hidden from the left filter panel

#### Scenario: Unknown test source normalized to test:mock
- **WHEN** an event source resolves to `unknown:unknown` (or missing source fields from synthetic/mock telemetry)
- **THEN** the panel SHALL normalize and display that source as `test:mock` in both the sidebar filters and per-entry source label

---

### Requirement: Toolbar provides refresh action
The panel toolbar SHALL provide a refresh button positioned immediately left of the Clear button. Activating refresh SHALL re-run the same initial data load behavior used when the panel first becomes ready.

#### Scenario: Refresh replays initial panel load
- **WHEN** the user clicks the toolbar refresh button
- **THEN** the webview SHALL request history and current connections from the extension host
- **THEN** the extension host SHALL respond using the same message shapes used on panel initialization (`history`, `connections`, and `status`)
- **THEN** the panel SHALL re-render its state from the refreshed data without requiring panel reopen
- **THEN** the refreshed history SHALL include the latest persisted events for today

---

### Requirement: Panel filters the event log by IDE and workspace
The panel SHALL allow the user to select which connections' events are visible by toggling entries in the connections sidebar.

#### Scenario: Filter applied
- **WHEN** the user deselects a connection in the connections sidebar
- **THEN** events with matching `ide` and `workspaceSlug` SHALL be hidden from the log
- **THEN** the filter SHALL apply to both new incoming events and previously rendered entries

#### Scenario: All connections selected (default)
- **WHEN** the panel opens
- **THEN** all connections SHALL be selected and all events SHALL be visible

#### Scenario: Filtered connection reconnects
- **WHEN** a previously deselected connection deregisters and re-registers with the same `ide`/`workspaceSlug`
- **THEN** the panel SHALL preserve the filter state for that identity

---

### Requirement: Panel loads log history from disk on open
When the panel opens, the extension host SHALL read all `.jsonl` log files from `~/.myai/logs/`, merge their records sorted by timestamp, and send the merged history to the webview as an initial batch of events.

#### Scenario: History loaded successfully
- **WHEN** the panel opens
- **THEN** the extension SHALL read all `.jsonl` files under `~/.myai/logs/`
- **THEN** the extension SHALL merge and sort events by `timestamp` ascending
- **THEN** the extension SHALL send the merged history to the webview before the live SSE stream begins

#### Scenario: No log files exist
- **WHEN** no `.jsonl` files are found in `~/.myai/logs/`
- **THEN** the panel SHALL display an empty log with no error

#### Scenario: History respects active filters
- **WHEN** the user has filters active from a previous session
- **THEN** the loaded history SHALL be filtered identically to live events
