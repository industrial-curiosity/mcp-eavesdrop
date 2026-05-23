## MODIFIED Requirements

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

### Requirement: Panel handles proxy port changes without user action
The extension host SHALL handle daemon port changes transparently. The webview SHALL NOT be involved in reconnection logic.

#### Scenario: Daemon restarts while panel is open
- **WHEN** the daemon restarts and `~/.myai/daemon.json` reflects a new `proxyPort`
- **THEN** the extension host SHALL detect the port change during reconnect
- **THEN** the extension host SHALL update its internal state and re-subscribe to the daemon SSE stream
- **THEN** no user action SHALL be required
- **THEN** the webview SHALL receive only `{ type: 'status', connected: true }` — it SHALL NOT receive a port number

---

## ADDED Requirements

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
