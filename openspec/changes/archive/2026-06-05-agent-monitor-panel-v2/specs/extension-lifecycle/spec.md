## ADDED Requirements

### Requirement: Extension registers a restart daemon command
The extension SHALL register a `myai.restartDaemon` command that force-restarts the shared daemon process and rehydrates panel state.

#### Scenario: Command invocation restarts daemon
- **WHEN** the user runs `myai.restartDaemon`
- **THEN** the extension SHALL request daemon shutdown using the daemon control endpoint with force semantics
- **THEN** the extension SHALL run the same daemon bootstrap flow used on activation to ensure a new daemon is running
- **THEN** the extension SHALL re-register the current extension instance and resume heartbeat/SSE monitoring

#### Scenario: Panel state after daemon restart
- **WHEN** `myai.restartDaemon` completes successfully
- **THEN** the extension host SHALL push updated `status` and `connections` messages to the panel
- **THEN** the panel SHALL be able to reload history and display live events without requiring window reload

#### Scenario: Restart failure surfaces actionable error
- **WHEN** daemon shutdown or restart fails
- **THEN** the extension SHALL show an error notification with guidance to retry or reload the window
- **THEN** existing reconnect logic SHALL continue attempting to restore connectivity
