### Requirement: Wrapper transparently relays stdio between IDE and real server
The stdio wrapper SHALL spawn the real MCP server as a child process using the command and args from `MCPEAVESDROP_REAL_SERVER`, and relay all bytes between its own stdin/stdout and the child's stdin/stdout without modification.

#### Scenario: Normal stdio relay
- **WHEN** the IDE sends bytes to the wrapper's stdin
- **THEN** the wrapper SHALL forward those bytes unchanged to the real server's stdin
- **WHEN** the real server writes to its stdout
- **THEN** the wrapper SHALL forward those bytes unchanged to its own stdout

#### Scenario: Real server process exits
- **WHEN** the real server child process exits
- **THEN** the wrapper SHALL exit with the same exit code

#### Scenario: Wrapper's stdin closes (IDE disconnects)
- **WHEN** the wrapper's stdin reaches EOF
- **THEN** the wrapper SHALL send SIGTERM to the real server and exit

---

### Requirement: Wrapper taps JSON-RPC stream and sends telemetry to proxy
`handleJsonRpc` is called unconditionally — it is not gated on daemon reachability. Local log writes are always attempted first. The `postTelemetry` call to the daemon Unix socket remains fire-and-forget and fails silently when unreachable. Each `tool_call_started`, `tool_call_completed`, and `tool_call_failed` event SHALL include `ide`, `workspaceSlug`, and — when present in `_meta` — `conversationId` and `requestId`.

`conversationId` and `requestId` are extracted from `params._meta['vscode.conversationId']` and `params._meta['vscode.requestId']` on the `tools/call` message. All four fields are optional — absence SHALL NOT block telemetry.

The `_meta` field on `JsonRpcMessage.params` SHALL be typed as `Record<string, unknown>` — it MUST NOT be narrowed to only the currently known keys.

The wrapper SHALL also forward the entire `_meta` object as a `meta` field on `TelemetryEvent` and `McpToolEvent` whenever `_meta` is present and non-empty on a `tools/call` message. This ensures any fields VS Code adds in future (e.g. `traceparent`, new correlation IDs) are visible in the panel and JSONL logs without a wrapper code change.

This requirement covers the stdio relay path only. The HTTP direct mode path (`handleHttpDirectMessage`, active when `MCPEAVESDROP_REAL_URL` is set and `MCPEAVESDROP_REAL_SERVER` is absent) is excluded from session metadata extraction.

#### Scenario: Tool call intercepted with session metadata
- **WHEN** a complete `{"method": "tools/call", ...}` JSON-RPC message is detected in the stream and `_meta['vscode.conversationId']` is present
- **THEN** the wrapper SHALL POST a `tool_call_started` event including `conversationId` and `requestId` alongside `ide` and `workspaceSlug`
- **THEN** the event SHALL also include a `meta` field containing the entire `_meta` object as-is

#### Scenario: Tool call intercepted without session metadata
- **WHEN** a complete `tools/call` message is detected and `_meta` does not contain `vscode.conversationId`
- **THEN** the wrapper SHALL POST a `tool_call_started` event with `conversationId` and `requestId` omitted (fields absent, not null)
- **THEN** the `meta` field SHALL be included if `_meta` is present and non-empty, and omitted if `_meta` is absent or empty

#### Scenario: Completed call echoes session metadata
- **WHEN** a `tools/call` response is matched to a tracked request that carried `conversationId`
- **THEN** the wrapper SHALL include the same `conversationId`, `requestId`, and `meta` on the `tool_call_completed` or `tool_call_failed` event

#### Scenario: Daemon unreachable
- **WHEN** the POST to the daemon Unix socket fails or times out
- **THEN** the wrapper SHALL log to stderr and continue relaying stdio without interruption
- **THEN** the real MCP server SHALL remain fully functional

#### Scenario: Non-tool-call messages
- **WHEN** a JSON-RPC message is not a `tools/call` request or response
- **THEN** the wrapper SHALL relay it without generating any telemetry event

---

### Requirement: Wrapper writes call log entries to local disk
The wrapper SHALL append each `tool_call_started`, `tool_call_completed`, and `tool_call_failed` event to a JSON-Lines file at `~/.mcpEavesdrop/logs/<ide>/<workspaceSlug>/<YYYY-MM-DD>/<serverName>.jsonl`. This write is synchronous and occurs before any telemetry delivery to the daemon. A missing log directory SHALL be created automatically.

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
When `MCPEAVESDROP_REAL_URL` is set and `MCPEAVESDROP_REAL_SERVER` is absent, the wrapper SHALL forward each JSON-RPC request directly to `MCPEAVESDROP_REAL_URL` over HTTP/HTTPS, write the upstream response to stdout, and invoke the same `handleJsonRpc` telemetry path used by the stdio relay.

#### Scenario: HTTP direct forward
- **WHEN** `MCPEAVESDROP_REAL_URL` is set and `MCPEAVESDROP_REAL_SERVER` is absent
- **AND** a JSON-RPC message arrives on stdin
- **THEN** the wrapper SHALL POST the message body directly to `MCPEAVESDROP_REAL_URL`
- **THEN** the wrapper SHALL write the upstream response to stdout
- **THEN** the wrapper SHALL invoke `handleJsonRpc` on both the outgoing request and the incoming response

#### Scenario: Upstream unreachable in HTTP direct mode
- **WHEN** the upstream server at `MCPEAVESDROP_REAL_URL` is not reachable
- **THEN** the wrapper SHALL write a JSON-RPC error response (`{ "jsonrpc": "2.0", "id": <id>, "error": { "code": -32000, "message": "<reason>" } }`) to stdout
- **THEN** the wrapper SHALL continue waiting for the next request without exiting

---

### Requirement: Wrapper falls back gracefully if daemon is not running at startup
If the daemon Unix socket is not reachable when the wrapper starts, the wrapper SHALL continue operating in passthrough mode. The wrapper SHALL also attempt to read the daemon's current address from `~/.mcpEavesdrop/daemon.json` as a fallback before giving up.

#### Scenario: Daemon socket not reachable at startup
- **WHEN** the path in the wrapper's embedded `DAEMON_SOCKET_PATH` is not connectable
- **THEN** the wrapper SHALL attempt to read `~/.mcpEavesdrop/daemon.json` and connect to the socket path found there
- **WHEN** that also fails
- **THEN** the wrapper SHALL log a warning to stderr and continue in passthrough mode

---

### Requirement: Wrapper self-heals if extension is uninstalled
On startup, the wrapper SHALL check whether the extension directory (`MCPEAVESDROP_EXT_DIR`) still exists. If not, it SHALL restore its own `mcp.json` entry to the original server config and then exec the real server, replacing itself.

#### Scenario: Extension directory missing
- **WHEN** the path in `MCPEAVESDROP_EXT_DIR` does not exist on disk
- **THEN** the wrapper SHALL read `MCPEAVESDROP_CONFIG_PATH` to locate `mcp.json`
- **THEN** the wrapper SHALL locate the entry keyed by `MCPEAVESDROP_SERVER_NAME` and restore it to the original command/args/env (stripping all `MCPEAVESDROP_*` keys)
- **THEN** the wrapper SHALL spawn the real server with `stdio: 'inherit'` and exit, handing control to the real process

#### Scenario: Extension directory present
- **WHEN** `MCPEAVESDROP_EXT_DIR` exists on disk
- **THEN** the wrapper SHALL proceed normally without modifying `mcp.json`

---

### Requirement: Wrapper embeds a version identifier
The wrapper source SHALL contain a comment `// MCPEAVESDROP_WRAPPER_VERSION=<n>` on its first line. The extension uses this to detect stale deployments.

#### Scenario: Version comment present
- **WHEN** the extension reads `~/.mcpEavesdrop/stdio-wrapper.js`
- **THEN** it SHALL be able to extract the version number from the first line comment
