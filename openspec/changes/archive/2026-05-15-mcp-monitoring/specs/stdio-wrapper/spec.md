## ADDED Requirements

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
The wrapper SHALL parse the stdio byte stream for complete MCP JSON-RPC messages and POST `tool_call_started`, `tool_call_completed`, and `tool_call_failed` events to the proxy HTTP server at the address in `MCPEAVESDROP_IPC_SOCKET`. Telemetry SHALL be fire-and-forget — failures MUST NOT interrupt the stdio relay.

#### Scenario: Tool call intercepted
- **WHEN** a complete `{"method": "tools/call", ...}` JSON-RPC message is detected in the stream
- **THEN** the wrapper SHALL POST a `tool_call_started` event to the proxy before forwarding the message
- **WHEN** the corresponding response is detected
- **THEN** the wrapper SHALL POST a `tool_call_completed` or `tool_call_failed` event with matching `id` and `durationMs`

#### Scenario: Proxy unreachable
- **WHEN** the POST to `MCPEAVESDROP_IPC_SOCKET` fails or times out
- **THEN** the wrapper SHALL log to stderr and continue relaying stdio without interruption
- **THEN** the real MCP server SHALL remain fully functional

#### Scenario: Non-tool-call messages
- **WHEN** a JSON-RPC message is not a `tools/call` request or response
- **THEN** the wrapper SHALL relay it without generating any telemetry event

---

### Requirement: Wrapper falls back gracefully if proxy is not running at startup
If the proxy IPC socket is not reachable when the wrapper starts, the wrapper SHALL continue operating in passthrough mode — relaying all stdio without telemetry — rather than failing.

#### Scenario: Proxy not running at wrapper startup
- **WHEN** `MCPEAVESDROP_IPC_SOCKET` is not connectable at wrapper startup
- **THEN** the wrapper SHALL log a warning to stderr
- **THEN** the wrapper SHALL continue to spawn the real server and relay stdio

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
