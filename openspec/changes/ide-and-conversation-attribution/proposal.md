## Why

MCP monitoring currently injects workspace identity into wrapper env vars at enable time, which causes incorrect attribution when user-level MCP entries are shared across windows or workspaces. This creates misleading logs and filters, especially in concurrent usage.

## What Changes

- Remove workspace attribution from MCP wrapper env vars when monitoring is enabled and disabled.
- Preserve IDE attribution in wrapper env vars because MCP config is IDE-specific.
- Keep recorded conversation attribution unchanged: persist conversation metadata when present and omit it when absent.
- Normalize missing conversation identity only in panel display/filtering as `"not detected"`.
- Update panel display and filtering model to replace the combined IDE/workspace source with IDE-only source plus a dedicated conversation ID column.
- Ensure wrapper metadata cleanup covers extension updates by treating legacy workspace env keys as removable during wrap/unwrap and self-heal paths.

## Capabilities

### New Capabilities
- `conversation-attribution-display`: consistently surfaces conversation identity in logs and filtering, including a UI-level fallback label when unavailable.

### Modified Capabilities
- `mcp-monitoring-control`: monitoring enable/disable must stop writing workspace identity into wrapper env while retaining IDE identity.
- `mcp-proxy`: wrapper and daemon telemetry flow must preserve conversation metadata as received and ignore legacy workspace env attribution.
- `agent-monitor-panel`: source display/filtering must pivot from IDE/workspace to IDE plus conversation ID.

## Non-goals

- Solving perfect per-window attribution in environments that do not expose caller workspace metadata.
- Introducing proposed/private IDE APIs for session discovery.
- Reworking daemon transport or replacing the current wrapper architecture.

## Impact

- Affected code: `src/mcp-wrap.ts`, `src/monitoring-commands.ts`, `src/proxy/stdio-wrapper.ts`, `src/types/events.ts`, `src/panel/webview/app.ts`, and related tests in `scripts/`.
- Behavior impact: workspace dimension is removed from source attribution; conversation ID becomes first-class in the UI and filters.
- Compatibility: existing wrapped entries with workspace env vars are ignored by wrapper runtime and stripped during enable/disable rewrites.
