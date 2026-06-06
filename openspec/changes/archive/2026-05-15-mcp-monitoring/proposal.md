## Why

The MCP Eavesdrop extension currently only proxies HTTP MCP servers, missing all stdio-based servers — which are how real-world MCP configurations (including the user's own) are defined. Without observing stdio traffic, the agent monitor panel is effectively blind to the vast majority of tool calls happening in the IDE.

## What Changes

- Introduce a `stdio-wrapper` process that transparently intercepts stdio MCP servers by spawning the real server as a child and tapping the JSON-RPC stream to emit telemetry events to the existing proxy
- Copy the wrapper to a stable, version-independent path (`~/.mcpEavesdrop/stdio-wrapper.js`) so that extension updates do not break existing MCP configurations
- Add IDE detection (VS Code vs Cursor) and cross-platform config path resolution to correctly locate user-level and workspace-level `mcp.json` files on macOS, Linux, and Windows
- Add `mcpEavesdrop.enableMonitoring` and `mcpEavesdrop.disableMonitoring` commands that rewrite the user's `mcp.json` to route servers through the wrapper (enable) or restore the original entries (disable)
- Add a `vscode:uninstall` lifecycle script that automatically restores all wrapped MCP entries when the extension is uninstalled
- Add a self-healing fallback in the wrapper itself: if the extension is gone, the wrapper restores the config entry and transparently exec's the real server

## Non-goals

- Managing, adding, or removing MCP server entries (only monitoring existing ones)
- Workspace-level `mcp.json` support (user-level config only, for now)
- Cloning or syncing configuration between VS Code and Cursor
- In-repo or per-package MCP config files

## Capabilities

### New Capabilities

- `mcp-monitoring-control`: Enable/disable commands, IDE detection, cross-platform config path resolution, mcp.json rewrite logic (wrap and restore), and stale wrapper detection on activate
- `stdio-wrapper`: The standalone wrapper process — spawns real server, pipes stdio, taps JSON-RPC stream, POSTs telemetry to proxy, and self-heals if extension is gone
- `uninstall-lifecycle`: The `vscode:uninstall` script that restores all wrapped MCP entries and removes `~/.mcpEavesdrop/` on extension removal

### Modified Capabilities

- `mcp-proxy`: Extend to accept telemetry POSTs from the stdio wrapper (same event format, new internal endpoint or existing `/internal/*` pattern); drop the HTTP-only restriction in `readMcpConfig`
- `extension-lifecycle`: Add stale wrapper detection on activate; add `mcpEavesdrop.enableMonitoring` and `mcpEavesdrop.disableMonitoring` command registration; deploy wrapper to `~/.mcpEavesdrop/` on first enable; improve `mcpEavesdrop.showMcpConfig` to surface all server types (HTTP and stdio) from workspace or user-level config with a fallback, replacing the previous HTTP-only behaviour that appeared as a no-op for stdio-only configurations

## Impact

- New source files: `src/proxy/stdio-wrapper.ts`, `src/lifecycle.ts`
- Modified: `src/extension.ts` (new commands, stale detection, wrapper deploy), `src/proxy/server.ts` (accept stdio-wrapper telemetry events)
- New `package.json` entries: `scripts.vscode:uninstall`, `contributes.commands` for enable/disable
- User filesystem: writes `~/.mcpEavesdrop/stdio-wrapper.js`; rewrites user-level `mcp.json` while monitoring is active
- Trust dialogs: users will see one IDE trust prompt per wrapped MCP server when enabling
