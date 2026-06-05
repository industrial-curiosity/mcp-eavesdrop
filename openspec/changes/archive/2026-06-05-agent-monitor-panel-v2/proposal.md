## Why

The Agent Monitor panel currently filters only by IDE and workspace, and the session attribution feature (color-coded `conversationId` badges) was built but is inert — VS Code's Copilot extension never populates `_meta` for third-party extensions. The panel needs to surface all the fields we actually have — tool name, server name, duration, status — and let users filter and browse by them, making the panel practically useful for debugging agent behavior.

## What Changes

- **Remove** `conversationId` color badge UI — the field is never populated in practice and adds visual noise
- **Add** filter bar with controls for: tool name (text search), server name (select), call status (all / in-progress / completed / failed), and time range (today / last hour / all)
- **Add** `#connections` sidebar element to `index.html` — currently specced and coded but missing from the HTML, so the sidebar never renders
- **Modify** history loading to surface `meta` contents in expanded detail view when present

## Capabilities

### New Capabilities

- `agent-monitor-filter-bar`: Filter bar with tool name search, server name, status, and time range controls

### Modified Capabilities

- `agent-monitor-panel`: Remove `conversationId` badge, add `#connections` HTML element, expose `meta` in expanded view

## Non-Goals

- Turn clustering or synthetic grouping by agent session
- Resolving conversation IDs to human-readable titles
- Any use of VS Code proposed or private APIs
- Cursor-specific verification

## Impact

- `src/panel/webview/app.ts` — remove conversation color logic, add filter bar rendering and filter logic
- `src/panel/webview/index.html` — add `#connections` sidebar element and filter bar HTML
- `src/panel/webview/styles.css` — filter bar styles
- `openspec/specs/agent-monitor-panel/spec.md` — modify requirements for conversationId badge and connections sidebar
