### Requirement: Daemon is spawned as a detached subprocess by the first extension instance
The IPC daemon SHALL be started by the first extension instance that successfully acquires the bootstrap lock. The daemon SHALL be spawned with `detached: true` and `stdio: 'ignore'`, and the spawning process SHALL call `child.unref()` immediately so the daemon outlives the extension host.

#### Scenario: First extension activates with no daemon running
- **WHEN** an extension instance activates and no daemon is reachable at `~/.myai/ipc.sock`
- **AND** the extension acquires `~/.myai/ipc.lock` via atomic create (`O_CREAT | O_EXCL`)
- **THEN** the extension SHALL spawn `node dist/daemon/index.js` as a detached child process
- **THEN** the extension SHALL call `child.unref()` to decouple the daemon from the extension host lifecycle
- **THEN** the extension SHALL poll `~/.myai/ipc.sock` until it becomes connectable (up to 5 seconds)
- **THEN** the extension SHALL delete `~/.myai/ipc.lock` after the daemon socket is confirmed available

#### Scenario: Bootstrap lock is stale
- **WHEN** `~/.myai/ipc.lock` exists but is older than 10 seconds and `~/.myai/ipc.sock` is not connectable
- **THEN** the extension SHALL delete the stale lock and retry acquisition

---

### Requirement: Daemon writes its state to `~/.myai/daemon.json` on startup
On startup the daemon SHALL write `{ "pid": <number>, "socketPath": "<path>", "startedAt": <ms> }` to `~/.myai/daemon.json`.

#### Scenario: Daemon starts successfully
- **WHEN** the daemon process starts and binds its Unix socket
- **THEN** it SHALL write `{ "pid": <number>, "socketPath": "<path>", "startedAt": <ms> }` to `~/.myai/daemon.json`

#### Scenario: Probe for liveness
- **WHEN** an extension needs to determine if a daemon process is alive
- **THEN** the extension SHALL read `~/.myai/daemon.pid` and check whether a process with that PID is running

---

### Requirement: Daemon accepts extension instance registrations
The daemon SHALL expose `POST /register` on its Unix socket HTTP server. Registered connections are tracked in an in-memory registry keyed by `instanceId`.

#### Scenario: Successful registration
- **WHEN** an extension POSTs `{ "instanceId": "<uuid>", "ide": "<string>", "workspace": "<string>", "workspaceSlug": "<string>" }` to `/register`
- **THEN** the daemon SHALL add the connection to its registry with `connectedAt` and `lastHeartbeat` timestamps
- **THEN** the daemon SHALL respond `200 { "ok": true }`

#### Scenario: Duplicate registration
- **WHEN** an extension POSTs `/register` with an `instanceId` already in the registry
- **THEN** the daemon SHALL update the existing entry's timestamps and respond `200 { "ok": true }`

---

### Requirement: Daemon maintains connection heartbeats and evicts stale connections
The daemon SHALL track the last heartbeat time for each registered connection and evict any connection that has not sent a heartbeat within 90 seconds. Eviction SHALL close the associated SSE stream.

#### Scenario: Heartbeat received
- **WHEN** an extension POSTs `{ "instanceId": "<uuid>" }` to `/heartbeat`
- **THEN** the daemon SHALL update `lastHeartbeat` for that connection and respond `200 { "ok": true }`

#### Scenario: Connection goes stale
- **WHEN** a registered connection has not sent a heartbeat for more than 90 seconds
- **THEN** the daemon's polling cycle SHALL evict that connection from the registry
- **THEN** the daemon SHALL close the SSE response stream for that connection

#### Scenario: Heartbeat for unknown instanceId
- **WHEN** `/heartbeat` is called with an `instanceId` not in the registry
- **THEN** the daemon SHALL respond `404 { "error": "unknown instanceId" }`

---

### Requirement: Daemon exposes an SSE event stream to registered connections
The daemon SHALL expose `GET /events` on its Unix socket HTTP server. Each connection receives all telemetry events broadcast to all registered instances.

#### Scenario: Extension subscribes to events
- **WHEN** a registered extension sends `GET /events` with its `instanceId` as a query parameter
- **THEN** the daemon SHALL respond with `Content-Type: text/event-stream` and keep the connection open
- **THEN** all subsequent telemetry events SHALL be sent as SSE `data:` lines to this stream

#### Scenario: Unregistered instance subscribes
- **WHEN** `GET /events` is called with an `instanceId` not in the registry
- **THEN** the daemon SHALL respond `403`

---

### Requirement: Daemon broadcasts all telemetry events to all active SSE connections
When a telemetry event arrives via `POST /telemetry`, the daemon SHALL broadcast it to every open SSE stream. The daemon does NOT write events to disk — persistence is the wrapper's responsibility.

#### Scenario: Event from stdio-wrapper
- **WHEN** the daemon receives `POST /telemetry` with a valid `McpToolEvent` body plus `ide` and `workspaceSlug` fields
- **THEN** the daemon SHALL broadcast the event to all open SSE streams
- **THEN** the daemon SHALL respond `200 {}`

#### Scenario: No SSE connections open
- **WHEN** a telemetry event arrives and no SSE streams are open
- **THEN** the daemon SHALL respond `200 {}` and make no disk write

---

### Requirement: Daemon exposes a connections list endpoint
The daemon SHALL expose `GET /connections` on its Unix socket HTTP server, returning all currently registered connections.

#### Scenario: Query all connections
- **WHEN** any registered extension calls `GET /connections`
- **THEN** the daemon SHALL respond with `{ "total": <n>, "connections": [ { "instanceId", "ide", "workspace", "workspaceSlug", "connectedAt", "lastHeartbeat" }, ... ] }`

---

### Requirement: Daemon shuts down via POST /shutdown
The daemon SHALL expose `POST /shutdown` on its Unix socket HTTP server. On receiving this request the daemon SHALL validate that at most one connection remains, flush pending log writes, and exit.

#### Scenario: Graceful last-connection shutdown
- **WHEN** `POST /shutdown` is received and the registry contains ≤ 1 connection
- **THEN** the daemon SHALL respond `200 { "ok": true }`, flush all pending writes, and call `process.exit(0)`

#### Scenario: Forced shutdown
- **WHEN** `POST /shutdown { "force": true }` is received
- **THEN** the daemon SHALL respond `200 { "ok": true }` and exit regardless of remaining connection count

#### Scenario: Shutdown rejected — multiple connections remain
- **WHEN** `POST /shutdown` (without `force`) is received and more than 1 connection is in the registry
- **THEN** the daemon SHALL respond `409 { "error": "other connections still active", "total": <n> }`

---

### Requirement: Daemon self-terminates when idle
If the daemon's heartbeat polling cycle completes and the connection registry is empty, the daemon SHALL schedule termination after a 10-second grace period and exit if no new connections arrive.

#### Scenario: All connections evicted, no new registrations
- **WHEN** the registry is empty after a polling cycle
- **AND** no new `/register` call arrives within 10 seconds
- **THEN** the daemon SHALL call `process.exit(0)`

#### Scenario: New connection arrives during grace period
- **WHEN** a `/register` call arrives within the 10-second grace period
- **THEN** the daemon SHALL cancel the shutdown and continue running

---

### Requirement: Daemon exposes a debug streams endpoint
The daemon SHALL expose `GET /debug/streams` on its Unix socket HTTP server, returning the identifiers of all currently open SSE streams.

#### Scenario: Query active streams
- **WHEN** `GET /debug/streams` is called
- **THEN** the daemon SHALL respond `200 { "total": <n>, "streamIds": [ "<instanceId>", ... ] }`
- **THEN** the response SHALL reflect only streams that are currently open (not evicted or disconnected)

---

### Requirement: Daemon constants are isolated in a side-effect-free module
The `DAEMON_SOCKET_PATH` constant and any other value shared between the daemon process and the extension host SHALL be defined in `src/daemon/constants.ts`. This module SHALL contain no module-level side effects — no server startup, no `process.exit` calls, no global state initialization.

#### Scenario: Extension imports daemon socket path
- **WHEN** any extension-side module needs `DAEMON_SOCKET_PATH`
- **THEN** it SHALL import from `./daemon/constants`, not from `./daemon/index`
- **THEN** `dist/extension.js` SHALL NOT contain any daemon startup code when built

#### Scenario: Daemon entry point imports its own constants
- **WHEN** `src/daemon/index.ts` imports from `./constants`
- **THEN** the constants module SHALL remain free of side effects in both build contexts

---

### Requirement: Daemon Unix socket is accessible only to the owning user
The daemon SHALL create `~/.myai/ipc.sock` with permissions `0600`. On Windows the named pipe SHALL be scoped to the current user's session.

#### Scenario: Socket created with restricted permissions
- **WHEN** the daemon starts and creates the Unix socket
- **THEN** the socket file's mode SHALL be `0600`
- **THEN** connection attempts from a different OS user SHALL be rejected by the OS

#### Scenario: Stale socket cleanup
- **WHEN** the daemon starts and `~/.myai/ipc.sock` already exists (e.g. from a previous crash)
- **THEN** the daemon SHALL unlink the stale socket before binding
