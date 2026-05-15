## MODIFIED Requirements

### Requirement: Panel connects to proxy event stream on load
The panel WebView SHALL connect to the per-window relay server's SSE endpoint using the port received in the `init` message from the extension host. The relay server subscribes to the shared daemon's SSE stream and forwards all events to the webview.

#### Scenario: Panel initializes successfully
- **WHEN** the WebView receives an `init` message with `{ relayPort: number }`
- **THEN** the panel SHALL open an EventSource connection to `http://127.0.0.1:<relayPort>/events`
- **THEN** the panel SHALL send a `ready` message to the extension host

#### Scenario: Relay connection lost
- **WHEN** the EventSource connection to the relay drops
- **THEN** the panel SHALL display a "Disconnected — reconnecting…" status indicator
- **THEN** the panel SHALL attempt to reconnect with exponential backoff (max 10s interval)

---

### Requirement: Panel handles proxy port changes without user action
The panel SHALL reconnect to the relay server automatically when the extension host sends a new `init` message with a changed port (e.g. after a daemon restart and relay restart).

#### Scenario: Daemon restarts while panel is open
- **WHEN** the extension sends a new `init` message with a different `relayPort`
- **THEN** the panel SHALL close the existing EventSource connection
- **THEN** the panel SHALL open a new EventSource connection to the updated relay port
- **THEN** no user action SHALL be required

---

## ADDED Requirements

### Requirement: Panel displays all connected windows in a sidebar
The panel SHALL show a list of all currently connected extension instances (across all IDEs and workspaces) as reported by the daemon's `/connections` endpoint.

#### Scenario: Connections loaded on panel open
- **WHEN** the panel opens
- **THEN** the extension host SHALL fetch `GET /connections` from the daemon and send the result to the webview
- **THEN** the panel SHALL render each connection showing `ide`, `workspace`, and `connectedAt`

#### Scenario: Connections updated
- **WHEN** the extension receives a `connections_changed` event on the SSE stream
- **THEN** the extension SHALL re-fetch `GET /connections` and send the updated list to the webview

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
