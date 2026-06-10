# Changelog

## [Unreleased]

### ide-and-conversation-attribution

**Date:** 2026-06-10

**Summary:** Removed unreliable workspace attribution from MCP wrapper environment variables while keeping stable IDE attribution. Updated panel to filter by IDE + conversation ID instead of IDE + workspace.

**Key Changes:**

- Wrapper metadata: Removed `MCPEAVESDROP_WORKSPACE_SLUG` from wrap contract. Workspace slug no longer written at wrap time, stripped on unwrap, and ignored at runtime.
- Telemetry: Made event shaping source-faithful — `conversationId` included only when request metadata provides it; absent conversationId remains valid event data.
- Panel filtering: Re-keyed from "ide/workspaceSlug" buckets to separate "ide:{ide}" and "conversation:{conversationId}" sections with dedicated column for conversation ID.
- Panel display: Replaced IDE/workspace source label with IDE-only source plus dedicated conversation column; missing conversationId rendered as "not detected".
- Logging: Updated log path layout from `{ide}/{workspaceSlug}/{date}/` to `{ide}/{date}/`.
- Quality: Refactored `handleJsonRpc()` in stdio-wrapper for reduced complexity; extracted Cursor workspace config logic in monitoring-commands.

**Files Modified:**
- `src/mcp-wrap.ts`
- `src/monitoring-commands.ts`
- `src/extension.ts`
- `src/proxy/stdio-wrapper.ts`
- `src/panel/webview/app.ts`
- `src/panel/webview/styles.css`
- `src/panel/AgentPanel.ts`
- `src/types/events.ts`
- `scripts/test-mcp-wrap.mjs`
- `scripts/test-proxy.mjs`
- `README.md`
- `docs/spec.md`
- `docs/testing.md`

**Specs:**
- `openspec/specs/agent-monitor-panel/spec.md` (modified)
- `openspec/specs/mcp-monitoring-control/spec.md` (modified)
- `openspec/specs/mcp-proxy/spec.md` (modified)
- `openspec/specs/conversation-attribution-display/spec.md` (new)

**Tests:**
- ✅ test-mcp-wrap: Workspace key not written; legacy key stripped on unwrap
- ✅ test-proxy: All 6 scenarios passed (register, connections, telemetry broadcast, heartbeat, deregister)
- ✅ Integration: Panel filter groups render correctly; IDE and conversation filtering apply with AND logic
