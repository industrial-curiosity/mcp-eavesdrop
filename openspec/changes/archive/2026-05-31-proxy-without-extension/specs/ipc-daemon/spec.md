## MODIFIED Requirements

### Requirement: Daemon writes its state to `~/.mcpEavesdrop/daemon.json` on startup
On startup the daemon SHALL write `{ "pid": <number>, "socketPath": "<path>", "startedAt": <ms> }` to `~/.mcpEavesdrop/daemon.json`. The `proxyPort` field is removed — the daemon no longer binds a TCP proxy server.

#### Scenario: Daemon starts successfully
- **WHEN** the daemon process starts and binds its Unix socket
- **THEN** it SHALL write `{ "pid": <number>, "socketPath": "<path>", "startedAt": <ms> }` to `~/.mcpEavesdrop/daemon.json`

## REMOVED Requirements

### Requirement: Daemon selects a dynamic proxy TCP port
Removed. The daemon no longer binds a TCP proxy server. Port allocation in the range 7331–7360 is eliminated entirely.
