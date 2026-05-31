## Context

The Agent Monitor panel (`src/panel/webview/`) was built with three requirements that are now incorrect or broken:

1. **`conversationId` badge**: Built and spec'd as the primary grouping mechanism. The underlying VS Code API (`_meta.vscode.conversationId`) is never populated by the Copilot marketplace extension for third-party tools. The badge never renders; the associated palette/color logic is dead weight.

2. **Missing `#connections` element**: `app.ts` calls `document.getElementById('connections')` and assigns it to `connectionsEl`. The element does not exist in `index.html`. Every call to `renderConnections()` silently no-ops. The sidebar is fully coded but never renders.

3. **No filter bar**: The current `filterState` only supports IDE/workspace checkbox filtering via the connections sidebar. There is no way to filter by tool name, server name, call status, or time.

All the actual data we capture — `toolName`, `serverName`, `durationMs`, `timestamp`, `error`, `ide`, `workspaceSlug`, `meta` — is either not filterable or not displayed.

## Goals / Non-Goals

**Goals:**

- Remove dead `conversationId`/color-palette code
- Fix the connections sidebar by adding `#connections` to `index.html`
- Add a filter bar: tool name text search, server name select, status select, time range select
- Display `meta` field in expanded detail view when non-empty

**Non-Goals:**

- Turn clustering or synthetic agent-session grouping
- Persistent filter bar state (IDE/workspace filter persistence stays; filter bar state is in-memory only)
- Backend or daemon changes — all changes are webview-only
- Cursor-specific behavior

## Decisions

### 1. Remove all `conversationId` / color palette code

**Decision**: Delete `colorPalette`, `occupiedSlots`, `conversationColors`, `parseHex()`, `toHex()`, `midColor()`, `extendPalette()`, `getConversationColor()`, and the badge rendering block in `createStartedEntry()`. Remove `.conv-badge` CSS.

**Rationale**: Dead code confirmed by investigation — `_meta` fields are never populated by VS Code's Copilot extension for third-party MCP tools. Keeping it adds ~80 lines of complexity with zero user-visible effect.

**Alternative considered**: Keep it dormant in case VS Code changes. Rejected — a dormant feature in a shipped extension isn't useful, and the fields remain on `McpToolEvent` type so it can be re-added trivially if the situation changes.

### 2. Fix `#connections` by adding it to `index.html`

**Decision**: Add `<div id="connections" class="connections-sidebar"></div>` to `index.html`. Restructure `<body>` to a two-column layout: sidebar on the left, main content (filter bar + log) on the right.

**Rationale**: The sidebar code in `app.ts` is correct. The element is just missing from HTML. No JS changes needed.

**Layout**: Use CSS `display: flex; flex-direction: row` on a wrapper. Sidebar is fixed width (~180px), main content takes remaining space. Sidebar scrolls independently.

### 3. Filter bar: in-memory, client-side, no persistence

**Decision**: Add a `<div id="filterBar">` between toolbar and log. Four controls:
- `<input id="filterTool" type="text">` — substring match on `event.toolName` (case-insensitive)
- `<select id="filterServer">` — populated from all server names seen in current log; "All" default
- `<select id="filterStatus">` — options: All / in-progress / completed / failed
- `<select id="filterTime">` — options: All / Last hour / Today

**Rationale**: Client-side filtering requires no daemon changes. All fields are already on `McpToolEvent`. Filter state is transient — the log itself is the source of truth; re-applying filters on change is cheap since entries are in a `Map`.

**Filter application**: On any filter control change, call `reapplyFilters()`. The existing `isVisible()` function already checks IDE/workspace filter; extend it to also check the four new filter controls. History events are also re-filtered since all history entries are in the `entries` Map.

**Server select population**: On each `handleEvent()`, check if `event.serverName` is already in the select options; if not, add it. This keeps the list current as events arrive.

### 4. Show `meta` in expanded detail view

**Decision**: In `createStartedEntry()`, after the Arguments section, check `if (event.meta)` and append a "Meta" `createDetailsSection`. Also append on `updateCompleted()` / `updateFailed()` if the completed event carries `meta`.

**Rationale**: `meta` is already on the event type. Currently not rendered anywhere. When populated (rare, but possible with non-Copilot callers), it would otherwise be invisible.

## Risks / Trade-offs

- **Server select grows unboundedly**: If many servers are seen in a long session, the select list grows. Acceptable — server count is bounded by MCP config, not by call volume.
- **Filter bar takes vertical space**: Adds ~36px. Log area shrinks slightly. Acceptable trade-off for the filtering utility.
- **Connections sidebar width**: Fixed at ~180px may be too narrow for long workspace slugs. Mitigated by `text-overflow: ellipsis` on labels.
