### Requirement: Extension registers the openPanel command
The extension SHALL register a `myai.openPanel` command that opens the AI Agent Monitor WebView panel.

#### Scenario: Command invoked
- **WHEN** the user runs `myai.openPanel` from the Command Palette
- **THEN** the extension SHALL open (or reveal) the `AgentPanel` WebView
- **THEN** the extension SHALL send an `init` message to the panel with `{ proxyPort: number }`

---

### Requirement: Extension registers the clearSession command
The extension SHALL register a `myai.clearSession` command that clears the current session log.

#### Scenario: clearSession command invoked
- **WHEN** the user runs `myai.clearSession` from the Command Palette or the panel sends a `clearSession` message
- **THEN** the extension host SHALL broadcast a `session_cleared` event to all WebSocket clients via the proxy

---

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

### Requirement: Proxy self-terminates when the extension host dies
The proxy process SHALL monitor its stdin pipe and exit when stdin closes, ensuring no orphaned proxy processes remain after an extension host crash or forced kill.

#### Scenario: Extension host crashes or is force-killed
- **WHEN** the extension host process terminates for any reason (crash, SIGKILL, OS termination)
- **THEN** the OS SHALL close the stdin pipe connected to the proxy child process
- **THEN** the proxy SHALL detect the `end` event on `process.stdin` and call `process.exit(0)`

#### Scenario: Normal graceful shutdown
- **WHEN** `deactivate()` sends SIGTERM to the proxy
- **THEN** the proxy SHALL exit via SIGTERM (stdin EOF path is not required but does not interfere)

---

### Requirement: Extension detects active IDE at runtime
The extension SHALL identify whether it is running inside VS Code or Cursor using `vscode.env.appName` and use this to resolve the correct MCP config paths and root key.

#### Scenario: Running in VS Code
- **WHEN** `vscode.env.appName` equals `"Visual Studio Code"`
- **THEN** the extension SHALL use `"servers"` as the root key when reading and writing `mcp.json`
- **THEN** the extension SHALL resolve user config paths under the VS Code application support directory

#### Scenario: Running in Cursor
- **WHEN** `vscode.env.appName` equals `"Cursor"`
- **THEN** the extension SHALL use `"mcpServers"` as the root key when reading and writing `mcp.json`
- **THEN** the extension SHALL resolve user config paths under `~/.cursor/`

#### Scenario: Unknown IDE
- **WHEN** `vscode.env.appName` does not match a known IDE
- **THEN** the extension SHALL default to VS Code path conventions and log a warning

---

### Requirement: Extension resolves user-level MCP config path cross-platform
The extension SHALL determine the absolute path to the user-level `mcp.json` for the active IDE on macOS, Linux, and Windows without hardcoding platform-specific paths.

#### Scenario: VS Code on macOS
- **WHEN** IDE is VS Code and `process.platform` is `"darwin"`
- **THEN** the resolved path SHALL be `~/Library/Application Support/Code/User/mcp.json`

#### Scenario: VS Code on Linux
- **WHEN** IDE is VS Code and `process.platform` is `"linux"`
- **THEN** the resolved path SHALL be `~/.config/Code/User/mcp.json`

#### Scenario: VS Code on Windows
- **WHEN** IDE is VS Code and `process.platform` is `"win32"`
- **THEN** the resolved path SHALL be `%APPDATA%\Code\User\mcp.json`

#### Scenario: Cursor on any platform
- **WHEN** IDE is Cursor
- **THEN** the resolved path SHALL be `~/.cursor/mcp.json` (Unix) or `%USERPROFILE%\.cursor\mcp.json` (Windows)

---

### Requirement: Extension deploys the stdio wrapper to a stable path
When monitoring is first enabled, the extension SHALL copy `dist/proxy/stdio-wrapper.js` to `~/.myai/stdio-wrapper.js` (or `%USERPROFILE%\.myai\stdio-wrapper.js` on Windows), creating the directory if it does not exist. The extension SHALL overwrite the deployed wrapper if the bundled version number differs.

#### Scenario: First-time deploy
- **WHEN** the user enables monitoring and `~/.myai/stdio-wrapper.js` does not exist
- **THEN** the extension SHALL create `~/.myai/` and copy the bundled wrapper into it

#### Scenario: Wrapper version mismatch
- **WHEN** `~/.myai/stdio-wrapper.js` exists and its embedded `MYAI_WRAPPER_VERSION` comment differs from the bundled wrapper
- **THEN** the extension SHALL overwrite the deployed wrapper with the bundled version

#### Scenario: Wrapper up to date
- **WHEN** `~/.myai/stdio-wrapper.js` exists and its version matches the bundled wrapper
- **THEN** the extension SHALL skip the copy

---

### Requirement: `myai.enableMonitoring` command wraps all MCP servers
The extension SHALL register a `myai.enableMonitoring` command that reads the user-level `mcp.json`, displays the file path and a trust-prompt warning to the user, and on confirmation rewrites each server entry to route through the stdio wrapper.

#### Scenario: Command invoked — user confirms
- **WHEN** the user runs `myai.enableMonitoring`
- **THEN** the extension SHALL show an information message stating the config file path and that each MCP server will require a new trust confirmation
- **WHEN** the user selects "Enable"
- **THEN** the extension SHALL deploy the wrapper, rewrite all unwrapped server entries, and show a confirmation message

#### Scenario: Command invoked — user cancels
- **WHEN** the user selects "Cancel"
- **THEN** the extension SHALL make no changes to `mcp.json`

#### Scenario: Config file not found
- **WHEN** no `mcp.json` exists at the resolved path
- **THEN** the extension SHALL show an error message stating the expected path and that no configuration was found

#### Scenario: All servers already wrapped
- **WHEN** every entry in `mcp.json` already contains `MYAI_IPC_SOCKET` in its `env`
- **THEN** the extension SHALL inform the user that monitoring is already enabled and take no action

---

### Requirement: Wrapped stdio entries embed original config and metadata as env vars
Each wrapped stdio server entry in `mcp.json` SHALL embed the original server config plus monitoring metadata including IDE identity and workspace slug for telemetry attribution.

#### Scenario: Wrapped entry structure
- **WHEN** a stdio entry is wrapped
- **THEN** `command` SHALL be `"node"`
- **THEN** `args` SHALL be `["<absolute-path-to-~/.myai/stdio-wrapper.js>", "<server-name>"]`
- **THEN** `env` SHALL contain all original env vars plus: `MYAI_IPC_SOCKET` (path to `~/.myai/ipc.sock`), `MYAI_REAL_SERVER`, `MYAI_SERVER_NAME`, `MYAI_CONFIG_PATH`, `MYAI_EXT_DIR`, `MYAI_WRAPPER_VERSION`, `MYAI_IDE`, `MYAI_WORKSPACE_SLUG`

#### Scenario: Wrapped HTTP entry structure
- **WHEN** an HTTP/SSE server entry is wrapped
- **THEN** the entry SHALL be converted to a stdio entry pointing to `stdio-wrapper.js`
- **THEN** `env` SHALL contain `MYAI_REAL_URL` (original URL), `MYAI_SERVER_NAME`, `MYAI_CONFIG_PATH`, `MYAI_WRAPPER_VERSION`, `MYAI_IDE`, `MYAI_WORKSPACE_SLUG`
- **THEN** no port number SHALL appear in `mcp.json`; the wrapper reads the proxy port from its embedded constant

---

### Requirement: `myai.disableMonitoring` command restores all MCP servers
The extension SHALL register a `myai.disableMonitoring` command that reads `mcp.json`, detects all wrapped entries, reconstructs the originals from their embedded metadata, and writes the restored config.

#### Scenario: Disable with wrapped entries present
- **WHEN** the user runs `myai.disableMonitoring`
- **THEN** the extension SHALL restore every entry that contains `MYAI_IPC_SOCKET` in its `env` to its original `command`, `args`, and `env` (stripping all `MYAI_*` keys)
- **THEN** the extension SHALL show a confirmation message

#### Scenario: No wrapped entries found
- **WHEN** no entries contain `MYAI_IPC_SOCKET`
- **THEN** the extension SHALL inform the user that monitoring is not currently enabled

---

### Requirement: Extension detects stale wrapper on activate and notifies user
On every activation, the extension SHALL check whether any wrapped entries in the user-level `mcp.json` point to a wrapper path that no longer exists on disk, and if so show a notification prompting re-enable.

#### Scenario: Stale wrapper detected
- **WHEN** a wrapped entry's `args[0]` path does not exist on disk
- **THEN** the extension SHALL show a warning: "MyAI monitoring needs to be re-enabled. Run 'MyAI: Enable MCP Monitoring' to restore it."

#### Scenario: No stale wrappers
- **WHEN** all wrapped entries point to existing wrapper paths (or no entries are wrapped)
- **THEN** the extension SHALL activate silently with no notification

---

### Requirement: `myai.showMcpConfig` surfaces all configured MCP servers with type-appropriate guidance
The `myai.showMcpConfig` command SHALL display all configured MCP servers found in the IDE's user-level `mcp.json` only. Output SHALL cover both HTTP URL and stdio server types, with actionable guidance for each. Workspace-level `mcp.json` is not supported in this phase.

#### Scenario: IDE user config has HTTP servers
- **WHEN** the IDE user-level `mcp.json` contains one or more HTTP URL server entries
- **THEN** the command SHALL open the MyAI output channel and show a proxy snippet re-pointing each HTTP server to `http://127.0.0.1:<proxy-port>/<name>`
- **THEN** the command SHALL show a success notification directing the user to Output → MyAI

#### Scenario: IDE user config has stdio servers only
- **WHEN** the IDE user-level `mcp.json` contains only stdio entries (no HTTP URL servers)
- **THEN** the command SHALL open the MyAI output channel and list the stdio servers with their command and args
- **THEN** the output SHALL include a note directing the user to run "MyAI: Enable MCP Monitoring" for stdio servers

#### Scenario: Mixed HTTP and stdio servers in the same config
- **WHEN** the IDE user-level `mcp.json` contains both HTTP URL entries and stdio entries
- **THEN** the output SHALL include the proxy snippet for HTTP entries AND the stdio listing for stdio entries in the same MyAI output channel view

#### Scenario: Both `servers` and `mcpServers` roots are scanned
- **WHEN** the IDE user-level `mcp.json` uses either `"servers"` or `"mcpServers"` as the root key
- **THEN** the command SHALL enumerate entries from whichever root key is present, checking both

#### Scenario: No servers found in IDE user config
- **WHEN** the IDE user-level `mcp.json` does not exist or contains no configured servers
- **THEN** the command SHALL show an information message: "No MCP servers found in IDE user mcp.json."

---

### Requirement: Extension probes for daemon and bootstraps if absent
On activation, the extension SHALL attempt to connect to `~/.myai/ipc.sock`. If the connection fails, it SHALL acquire a bootstrap lock and spawn the daemon. If lock acquisition fails (another instance is bootstrapping), it SHALL retry the connection after 200ms.

#### Scenario: Daemon already running
- **WHEN** the extension activates and `~/.myai/ipc.sock` is connectable
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
- **THEN** the `myai.openPanel` command SHALL be disabled

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
- **WHEN** a reconnect attempt fails and the daemon's PID (from `~/.myai/daemon.pid`) is not a running process
- **THEN** the extension SHALL replay the full startup sequence (lock → spawn → connect)

#### Scenario: Three consecutive reconnect failures
- **WHEN** three consecutive reconnect attempts fail within the retry loop
- **THEN** the extension SHALL show a VS Code warning: "MyAI: Lost connection to daemon" with buttons "Keep Trying" and "Restart Daemon"
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
