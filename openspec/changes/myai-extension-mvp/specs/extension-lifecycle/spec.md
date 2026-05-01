## ADDED Requirements

### Requirement: Extension activates on startup and spawns proxy
The extension SHALL activate on `onStartupFinished` and spawn the MCP proxy server as a managed child process.

#### Scenario: Successful activation
- **WHEN** VS Code starts and the extension activates
- **THEN** the extension SHALL spawn the proxy child process
- **THEN** the extension SHALL wait for a `{"port": <number>}` message on the child's stdout
- **THEN** the extension SHALL store the proxy port for use by the panel

#### Scenario: Proxy fails to start within timeout
- **WHEN** the proxy child process does not emit a port within 5 seconds
- **THEN** the extension SHALL log an error and disable the `myai.openPanel` command

---

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

### Requirement: Extension cleans up proxy on deactivation
The extension SHALL terminate the proxy child process cleanly when VS Code deactivates or the extension is deactivated.

#### Scenario: Normal deactivation
- **WHEN** the extension deactivates
- **THEN** the extension SHALL send SIGTERM to the proxy child process
- **THEN** if the process has not exited after 2 seconds, the extension SHALL send SIGKILL

#### Scenario: Proxy exits unexpectedly
- **WHEN** the proxy child process exits with a non-zero code while the extension is still active
- **THEN** the extension SHALL log the exit code and attempt to restart the proxy once

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
