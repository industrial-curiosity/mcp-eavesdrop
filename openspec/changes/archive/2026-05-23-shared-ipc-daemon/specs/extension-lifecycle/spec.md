## REMOVED Requirements

### Requirement: Extension activates on startup and spawns proxy
**Reason**: The per-window proxy child process is replaced by the shared IPC daemon. The extension now probes for a running daemon and bootstraps one if absent.
**Migration**: See ADDED "Extension probes for daemon and bootstraps if absent".

### Requirement: IPC socket exposes proxy port to external clients
**Reason**: The daemon owns the Unix socket. The extension no longer binds its own socket; it connects as a client.
**Migration**: External clients that previously read the proxy port from the socket should read `~/.mcpEavesdrop/daemon.json` instead.

### Requirement: Extension cleans up proxy on deactivation
**Reason**: The extension no longer owns a proxy child process. On deactivation it deregisters from the daemon and conditionally shuts it down.
**Migration**: See ADDED "Extension deregisters from daemon on deactivation".

---

## MODIFIED Requirements

### Requirement: Panel reopens automatically after proxy restart
The extension SHALL restore the AI Agent Monitor panel when the daemon reconnects after a disconnect, without requiring the user to reopen it manually.

#### Scenario: Daemon reconnected and panel was previously open
- **WHEN** the extension successfully reconnects to the daemon and resubscribes to the SSE stream
- **AND** `globalState('panelWasOpen')` is `true`
- **THEN** the extension SHALL call `AgentPanel.createOrShow()` to reopen or reveal the panel

#### Scenario: Daemon reconnected and panel is already open
- **WHEN** the extension reconnects to the daemon
- **AND** a panel is already open
- **THEN** the extension host SHALL send `{ type: 'status', connected: true }` to the panel
- **THEN** the extension host SHALL re-fetch `GET /connections` and send `{ type: 'connections', connections }` to the panel

#### Scenario: User closes the panel
- **WHEN** the user closes the AI Agent Monitor panel
- **THEN** `globalState('panelWasOpen')` SHALL be set to `false`
- **THEN** the panel SHALL NOT reopen automatically on reconnect

---

### Requirement: Wrapped stdio entries embed original config and metadata as env vars
Each wrapped stdio server entry in `mcp.json` SHALL embed the original server config plus monitoring metadata including IDE identity and workspace slug for telemetry attribution.

#### Scenario: Wrapped entry structure
- **WHEN** a stdio entry is wrapped
- **THEN** `command` SHALL be `"node"`
- **THEN** `args` SHALL be `["<absolute-path-to-~/.mcpEavesdrop/stdio-wrapper.js>", "<server-name>"]`
- **THEN** `env` SHALL contain all original env vars plus: `MCPEAVESDROP_IPC_SOCKET` (path to `~/.mcpEavesdrop/ipc.sock`), `MCPEAVESDROP_REAL_SERVER`, `MCPEAVESDROP_SERVER_NAME`, `MCPEAVESDROP_CONFIG_PATH`, `MCPEAVESDROP_EXT_DIR`, `MCPEAVESDROP_WRAPPER_VERSION`, `MCPEAVESDROP_IDE`, `MCPEAVESDROP_WORKSPACE_SLUG`

#### Scenario: Wrapped HTTP entry structure
- **WHEN** an HTTP/SSE server entry is wrapped
- **THEN** the entry SHALL be converted to a stdio entry pointing to `stdio-wrapper.js`
- **THEN** `env` SHALL contain `MCPEAVESDROP_REAL_URL` (original URL), `MCPEAVESDROP_SERVER_NAME`, `MCPEAVESDROP_CONFIG_PATH`, `MCPEAVESDROP_WRAPPER_VERSION`, `MCPEAVESDROP_IDE`, `MCPEAVESDROP_WORKSPACE_SLUG`
- **THEN** no port number SHALL appear in `mcp.json`; the wrapper reads the proxy port from its embedded constant

---

## ADDED Requirements

### Requirement: Extension probes for daemon and bootstraps if absent
On activation, the extension SHALL attempt to connect to `~/.mcpEavesdrop/ipc.sock`. If the connection fails, it SHALL acquire a bootstrap lock and spawn the daemon. If lock acquisition fails (another instance is bootstrapping), it SHALL retry the connection after 200ms.

#### Scenario: Daemon already running
- **WHEN** the extension activates and `~/.mcpEavesdrop/ipc.sock` is connectable
- **THEN** the extension SHALL skip spawning and proceed directly to registration

#### Scenario: Daemon not running, lock acquired
- **WHEN** the extension activates, the socket is not connectable, and the lock file is created successfully
- **THEN** the extension SHALL spawn the daemon subprocess (detached, unreffed)
- **THEN** the extension SHALL poll the socket until connectable (up to 5 seconds)
- **THEN** the extension SHALL delete the lock file

#### Scenario: Daemon not running, lock contention
- **WHEN** the extension activates, the socket is not connectable, and the lock file already exists
- **THEN** the extension SHALL wait 200ms and retry connecting to the socket
- **THEN** this retry SHALL loop until the socket is connectable

#### Scenario: Daemon fails to start within timeout
- **WHEN** the socket is not connectable after 5 seconds
- **THEN** the extension SHALL log an error and show a VS Code error message
- **THEN** the `mcpEavesdrop.openPanel` command SHALL be disabled

---

### Requirement: Extension registers with the daemon after connecting
After successfully connecting to the daemon's Unix socket, the extension SHALL POST to `/register` with its instance identity and begin sending heartbeats.

#### Scenario: Successful registration
- **WHEN** the extension connects to the daemon socket
- **THEN** the extension SHALL POST `{ "instanceId": "<uuid>", "ide": "<string>", "workspace": "<string>", "workspaceSlug": "<string>" }` to `/register`
- **THEN** the extension SHALL start a 30-second heartbeat interval

#### Scenario: Registration rejected
- **WHEN** the daemon responds with a non-200 status to `/register`
- **THEN** the extension SHALL log the error and retry after 5 seconds

---

### Requirement: Extension maintains a heartbeat with the daemon
The extension SHALL POST `{ "instanceId": "<uuid>" }` to the daemon's `/heartbeat` endpoint every 30 seconds while connected.

#### Scenario: Heartbeat sent successfully
- **WHEN** 30 seconds elapse since the last heartbeat
- **THEN** the extension SHALL POST to `/heartbeat`
- **THEN** on a `200` response, the interval SHALL reset

#### Scenario: Heartbeat fails
- **WHEN** the `/heartbeat` POST fails (network error or non-200 response)
- **THEN** the extension SHALL treat this as a disconnection and enter the reconnect loop

---

### Requirement: Extension reconnects automatically after daemon disconnection
If the extension's connection to the daemon is lost for any reason, it SHALL attempt to reconnect every 5 seconds. After every third consecutive failure it SHALL alert the user with options to keep retrying or force-restart the daemon.

#### Scenario: Connection lost, reconnect succeeds
- **WHEN** the SSE stream or socket connection is closed unexpectedly
- **THEN** the extension SHALL close the SSE subscription
- **THEN** the extension SHALL attempt to reconnect every 5 seconds
- **WHEN** a reconnection attempt succeeds
- **THEN** the extension SHALL re-register and resubscribe to the SSE stream

#### Scenario: Daemon found dead during reconnect
- **WHEN** a reconnect attempt fails and the daemon's PID (from `~/.mcpEavesdrop/daemon.pid`) is not a running process
- **THEN** the extension SHALL replay the full startup sequence (lock → spawn → connect)

#### Scenario: Three consecutive reconnect failures
- **WHEN** three consecutive reconnect attempts fail within the retry loop
- **THEN** the extension SHALL show a VS Code warning: "MCP Eavesdrop: Lost connection to daemon" with buttons "Keep Trying" and "Restart Daemon"
- **WHEN** the user selects "Restart Daemon"
- **THEN** the extension SHALL POST `{ "force": true }` to `/shutdown` (if daemon responds), then replay startup

---

### Requirement: Extension deregisters from daemon on deactivation
On `deactivate()`, the extension SHALL POST to `/deregister`, query the active connection count, and send a shutdown request if it is the last connection.

#### Scenario: Last connection deactivates
- **WHEN** `deactivate()` is called
- **THEN** the extension SHALL POST to `/deregister { "instanceId": "<uuid>" }`
- **THEN** the extension SHALL call `GET /connections`
- **WHEN** `total` is 0 (after deregistration)
- **THEN** the extension SHALL POST to `/shutdown`

#### Scenario: Other connections remain
- **WHEN** `deactivate()` is called and `GET /connections` returns `total > 0`
- **THEN** the extension SHALL NOT send a shutdown request
- **THEN** the daemon SHALL continue running

#### Scenario: Daemon unreachable at deactivation
- **WHEN** the daemon socket is not reachable during `deactivate()`
- **THEN** the extension SHALL log the condition and exit without error

---

### Requirement: Extension imports daemon constants from a dedicated side-effect-free module
The extension (and all modules bundled into `dist/extension.js`) SHALL import `DAEMON_SOCKET_PATH` and any other daemon-shared constants exclusively from `src/daemon/constants.ts`. No extension-side module SHALL import from `src/daemon/index.ts`.

#### Scenario: Extension build contains no daemon startup code
- **WHEN** `dist/extension.js` is built from `src/extension.ts`
- **THEN** the bundle SHALL NOT contain module-level daemon startup code (e.g. `main()` invocation, socket binding, `process.exit`)
- **THEN** importing `dist/extension.js` SHALL have no side effects beyond variable and function declarations

#### Scenario: Extension Development Host remains stable on load
- **WHEN** VS Code loads `dist/extension.js` in the Extension Development Host
- **THEN** no `process.exit()` call SHALL execute before `activate()` is invoked
- **THEN** the extension host process SHALL remain alive until VS Code terminates it
