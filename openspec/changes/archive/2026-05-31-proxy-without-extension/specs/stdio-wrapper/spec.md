## ADDED Requirements

### Requirement: Wrapper writes call log entries to local disk
The wrapper SHALL append each `tool_call_started`, `tool_call_completed`, and `tool_call_failed` event to a JSON-Lines file at `~/.myai/logs/<ide>/<workspaceSlug>/<YYYY-MM-DD>/<serverName>.jsonl`. This write is synchronous and occurs before any telemetry delivery to the daemon. A missing log directory SHALL be created automatically.

#### Scenario: Successful log write
- **WHEN** the wrapper generates a telemetry event
- **THEN** the wrapper SHALL append `JSON.stringify(event) + '\n'` to the log file
- **THEN** this write SHALL complete before the wrapper attempts to POST the event to the daemon

#### Scenario: Log directory missing
- **WHEN** the target log directory does not exist
- **THEN** the wrapper SHALL create it with `mkdirSync({ recursive: true })` before writing

#### Scenario: Daemon unreachable — log write still occurs
- **WHEN** the daemon Unix socket is not connectable
- **THEN** the wrapper SHALL still write the event to the local log file
- **THEN** the wrapper SHALL continue the relay without interruption

---

### Requirement: Wrapper handles HTTP-bridged servers in direct mode
When `MYAI_REAL_URL` is set and `MYAI_REAL_SERVER` is absent, the wrapper SHALL forward each JSON-RPC request directly to `MYAI_REAL_URL` over HTTP/HTTPS, write the upstream response to stdout, and invoke the same `handleJsonRpc` telemetry path used by the stdio relay.

#### Scenario: HTTP direct forward
- **WHEN** `MYAI_REAL_URL` is set and `MYAI_REAL_SERVER` is absent
- **AND** a JSON-RPC message arrives on stdin
- **THEN** the wrapper SHALL POST the message body directly to `MYAI_REAL_URL`
- **THEN** the wrapper SHALL write the upstream response to stdout
- **THEN** the wrapper SHALL invoke `handleJsonRpc` on both the outgoing request and the incoming response

#### Scenario: Upstream unreachable in HTTP direct mode
- **WHEN** the upstream server at `MYAI_REAL_URL` is not reachable
- **THEN** the wrapper SHALL write a JSON-RPC error response (`{ "jsonrpc": "2.0", "id": <id>, "error": { "code": -32000, "message": "<reason>" } }`) to stdout
- **THEN** the wrapper SHALL continue waiting for the next request without exiting

## MODIFIED Requirements

### Requirement: Wrapper taps JSON-RPC stream and sends telemetry to proxy
`handleJsonRpc` is now called unconditionally — it is not gated on daemon reachability. Local log writes are always attempted. The `postTelemetry` call to the daemon Unix socket remains fire-and-forget and fails silently when unreachable. This requirement applies to both the stdio relay path and the HTTP direct mode path.
