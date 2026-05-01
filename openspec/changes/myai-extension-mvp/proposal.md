## Why

AI agents running in VS Code invoke MCP tools, but there's no visibility into what they're doing — which tools fired, what arguments were passed, and whether they succeeded. Developers debugging agent behavior or auditing tool usage have no real-time window into this activity.

## What Changes

- Introduce a local MCP proxy server that transparently intercepts tool calls between agents and upstream MCP servers
- Introduce a WebView panel that displays a real-time log of tool calls (in-progress, completed, failed) with expandable arguments and results
- Add extension host wiring to spawn/manage the proxy and open the panel

## Capabilities

### New Capabilities
- `mcp-proxy`: Local HTTP proxy that implements the MCP JSON-RPC protocol, forwards requests to upstream MCP servers, and emits structured events over WebSocket
- `agent-monitor-panel`: VS Code WebView panel that connects to the proxy's event stream and renders a live, expandable log of tool calls with VS Code theme compatibility
- `extension-lifecycle`: Extension entry point that activates the proxy process, registers commands, and coordinates the panel with proxy port discovery

### Modified Capabilities
<!-- none -->

## Impact

- Adds new VS Code commands: `myai.openPanel`, `myai.clearSession`
- New runtime dependency on a locally-spawned child process (the proxy server)
- Users must point their MCP client config to the proxy URL — the extension will assist with this
- New npm dependencies: `@modelcontextprotocol/sdk`, `ws`
- No changes to existing MCP server behavior; proxy is fully transparent

## Non-goals

- Intercepting non-MCP built-in tools (e.g., Copilot's native file read or LLM reasoning steps)
- Persisting session logs to disk or syncing to external services
- Supporting remote (non-localhost) MCP server proxying
- A sidebar tree view in the Activity Bar (panel-only in v1)
