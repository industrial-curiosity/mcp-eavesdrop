## MODIFIED Requirements

### Requirement: Wrapper taps JSON-RPC stream and sends telemetry to proxy
The wrapper SHALL parse the stdio byte stream for complete MCP JSON-RPC messages and POST `tool_call_started`, `tool_call_completed`, and `tool_call_failed` events to the daemon's Unix socket at `POST /telemetry`. Each event SHALL include `ide` and `workspaceSlug` fields sourced from `MCPEAVESDROP_IDE` and `MCPEAVESDROP_WORKSPACE_SLUG` environment variables. Telemetry SHALL be fire-and-forget — failures MUST NOT interrupt the stdio relay.

#### Scenario: Tool call intercepted
- **WHEN** a complete `{"method": "tools/call", ...}` JSON-RPC message is detected in the stream
- **THEN** the wrapper SHALL POST a `tool_call_started` event to `/telemetry` on the daemon Unix socket including `ide` and `workspaceSlug`
- **WHEN** the corresponding response is detected
- **THEN** the wrapper SHALL POST a `tool_call_completed` or `tool_call_failed` event with matching `id`, `durationMs`, `ide`, and `workspaceSlug`

#### Scenario: Daemon unreachable
- **WHEN** the POST to the daemon Unix socket fails or times out
- **THEN** the wrapper SHALL log to stderr and continue relaying stdio without interruption
- **THEN** the real MCP server SHALL remain fully functional

#### Scenario: Non-tool-call messages
- **WHEN** a JSON-RPC message is not a `tools/call` request or response
- **THEN** the wrapper SHALL relay it without generating any telemetry event

---

### Requirement: Wrapper falls back gracefully if proxy is not running at startup
If the daemon Unix socket is not reachable when the wrapper starts, the wrapper SHALL continue operating in passthrough mode. The wrapper SHALL also attempt to read the daemon's current address from `~/.mcpEavesdrop/daemon.json` as a fallback before giving up.

#### Scenario: Daemon socket not reachable at startup
- **WHEN** the path in the wrapper's embedded `DAEMON_SOCKET_PATH` is not connectable
- **THEN** the wrapper SHALL attempt to read `~/.mcpEavesdrop/daemon.json` and connect to the socket path found there
- **WHEN** that also fails
- **THEN** the wrapper SHALL log a warning to stderr and continue in passthrough mode

---

## ADDED Requirements

### Requirement: Wrapper reads embedded daemon connection constants with daemon.json fallback
The deployed `stdio-wrapper.js` SHALL contain embedded constants `DAEMON_SOCKET_PATH` and `DAEMON_PROXY_PORT` written by the wrapper deploy step. If the embedded `DAEMON_PROXY_PORT` is unreachable, the wrapper SHALL read `~/.mcpEavesdrop/daemon.json` to obtain the current proxy port and update its internal state for the lifetime of the process.

#### Scenario: Embedded constants are current
- **WHEN** the wrapper starts and the embedded `DAEMON_SOCKET_PATH` is connectable
- **THEN** the wrapper SHALL use the embedded constants without reading any file

#### Scenario: Embedded proxy port is stale (daemon restarted on new port)
- **WHEN** the wrapper's embedded proxy port fails to connect
- **THEN** the wrapper SHALL read `~/.mcpEavesdrop/daemon.json`
- **THEN** the wrapper SHALL use the port found in `daemon.json` for the lifetime of the process
- **THEN** no write to `stdio-wrapper.js` SHALL occur (the wrapper never updates its own file)

---

### Requirement: Wrapper operates in HTTP bridge mode for HTTP-origin MCP servers
When `MCPEAVESDROP_REAL_URL` is set and `MCPEAVESDROP_REAL_SERVER` is absent, the wrapper SHALL act as a stdio-to-HTTP bridge: receiving JSON-RPC from stdin, forwarding each request to the daemon's HTTP proxy at `http://127.0.0.1:{DAEMON_PROXY_PORT}/{MCPEAVESDROP_SERVER_NAME}` with an `x-upstream-url: {MCPEAVESDROP_REAL_URL}` header, and writing the response to stdout.

#### Scenario: HTTP bridge mode activated
- **WHEN** `MCPEAVESDROP_REAL_URL` is set and `MCPEAVESDROP_REAL_SERVER` is unset
- **THEN** the wrapper SHALL not spawn any child process
- **THEN** the wrapper SHALL forward each JSON-RPC message from stdin as an HTTP POST to the daemon proxy
- **THEN** the wrapper SHALL write the HTTP response body to stdout

#### Scenario: Daemon proxy unreachable in bridge mode
- **WHEN** the HTTP POST to the daemon proxy fails
- **THEN** the wrapper SHALL write a JSON-RPC error response to stdout with code `-32000`
- **THEN** the wrapper SHALL continue accepting subsequent messages
