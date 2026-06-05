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
- Add a left-side timestamp column in each log row (alongside duration) for better event traceability
- Render timestamp as local date + time in the row column (not time-only)
- Ensure synthetic/mock telemetry sources are filterable in the sidebar and normalized to `test:mock`
- Add a toolbar refresh button that re-runs initial data loading without reopening the panel
- Ensure initial panel load and refresh both include latest persisted events for today
- Add a `myai.restartDaemon` command to force-restart the shared daemon from VS Code
- Display `meta` field in expanded detail view when non-empty

**Non-Goals:**

- Turn clustering or synthetic agent-session grouping
- Persistent filter bar state (IDE/workspace filter persistence stays; filter bar state is in-memory only)
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
- `<button id="sortToggle">` — toggles between newest-first (↓) and oldest-first (↑); default newest-first

**Rationale**: Client-side filtering requires no daemon changes. All fields are already on `McpToolEvent`. Filter state is transient — the log itself is the source of truth; re-applying filters on change is cheap since entries are in a `Map`.

**Filter application**: On any filter control change, call `reapplyFilters()`. The existing `isVisible()` function already checks IDE/workspace filter; extend it to also check the four new filter controls. History events are also re-filtered since all history entries are in the `entries` Map.

**History reload on any filter change**: Whenever any filter control changes, the webview posts `{ type: 'requestHistory' }` to the extension host unconditionally — no check on whether `entries` is empty. The host handles this message identically to `ready`: calls `_loadHistory()` and posts `{ type: 'history', events }`. To prevent duplicate rows when the log already has entries, the `history` message handler skips `tool_call_started` events whose `id` is already present in the `entries` Map — but `tool_call_completed` and `tool_call_failed` events with the same `id` always pass through, so existing entries get their final status applied. Active filters are applied via `isVisible()` as each history event is processed. The `filterTool` text input debounces the `requestHistory` post (300 ms) to avoid flooding on every keystroke; `reapplyFilters()` still runs immediately on each `input` event.

**Sort order**: A `sortOrder` variable (`'desc'` default) controls entry insertion order. The log container uses DOM order for display — entries are inserted using `prepend` (newest-first) or `append` (oldest-first). When the user toggles sort, all entries are removed from the DOM and re-inserted in the new order without re-creating them. Incoming live events and history events are both inserted according to the current `sortOrder`. The sort toggle button label reflects the current order (e.g., "↓ Newest first" / "↑ Oldest first").

**Server select population**: On each `handleEvent()`, check if `event.serverName` is already in the select options; if not, add it. This keeps the list current as events arrive.

**Column alignment**: The filter bar controls SHALL be visually aligned with the corresponding entry columns beneath them. Entry content starts at `3px (border-left) + 8px (entry padding) + 1.2em (status icon) + 6px (gap)` from the left edge of the log container. The `.filter-bar` achieves alignment by using `padding-left: calc(3px + 8px + 1.2em + 6px)` to offset its content by the same amount, so the tool name input left-aligns with `.entry-name`. The server select is given a fixed `min-width` matching the typical server column and is pinned to the right via `margin-left: auto`.

### 4. Show `meta` in expanded detail view

**Decision**: In `createStartedEntry()`, after the Arguments section, check `if (event.meta)` and append a "Meta" `createDetailsSection`. Also append on `updateCompleted()` / `updateFailed()` if the completed event carries `meta`.

**Rationale**: `meta` is already on the event type. Currently not rendered anywhere. When populated (rare, but possible with non-Copilot callers), it would otherwise be invisible.

### 5. Show per-call timestamp in the log row

**Decision**: Add a dedicated timestamp field at the left side of each entry row, ahead of the status icon and tool name, sourced from `event.timestamp` for both live and history events.

**Rationale**: Duration shows call cost but not wall-clock ordering context. A visible timestamp lets users correlate calls with external events and compare cross-workspace activity.

**Compatibility**: This is a presentation-only change. The event and log schema already includes `timestamp`, so existing `.jsonl` logs remain valid and do not require deletion or migration.

### 6. Normalize synthetic/unknown event sources to test:mock

**Decision**: Treat `unknown:unknown` (and missing source identity from synthetic test telemetry) as a normalized source identity `test:mock` for display and filtering.

**Rationale**: Mock telemetry should be clearly identifiable and filterable in the same way as real IDE/workspace sources.

**Implication**: Sidebar filter rows are not limited to daemon `/connections`; event sources observed in history/live stream must also be represented.

### 7. Add toolbar refresh action

**Decision**: Add a toolbar refresh button to the left of Clear. Refresh triggers the same initialization data load flow (`status`, `connections`, `history`) that runs when the panel first becomes ready.

**Rationale**: Users need an explicit one-click way to resync panel state after external log/connection changes without closing and reopening the panel.

### 8. Initial load parity with refresh for latest logs

**Decision**: Initial panel open and toolbar refresh both rely on history loaded from disk, and that history must include the latest events written through daemon `/telemetry`.

**Rationale**: Users expect today's most recent events to appear both on initial open and after refresh. Live-only visibility is insufficient when history is the authoritative reload source.

### 9. Add restart daemon command

**Decision**: Introduce `myai.restartDaemon` as an explicit command to force-restart the shared daemon and rehydrate extension connectivity.

**Rationale**: When daemon state drifts or sockets are stale, users need a deterministic recovery action that does not require manual process management.

## Risks / Trade-offs

- **Server select grows unboundedly**: If many servers are seen in a long session, the select list grows. Acceptable — server count is bounded by MCP config, not by call volume.
- **Filter bar takes vertical space**: Adds ~36px. Log area shrinks slightly. Acceptable trade-off for the filtering utility.
- **Connections sidebar width**: Fixed at ~180px may be too narrow for long workspace slugs. Mitigated by `text-overflow: ellipsis` on labels.
- **Sort re-render cost**: Re-inserting all DOM entries on toggle is O(n) but acceptable — entry count is bounded by session length and entries are not re-created, only moved.
- **Timestamp column width pressure**: Adding a left timestamp column reduces horizontal space for tool name. Mitigate with compact time formatting and truncation on long tool names.
- **Date+time width pressure**: Showing full date + time increases column width pressure versus time-only. Mitigate with a compact format and narrow, tabular timestamp styling.
- **Restart command blast radius**: Force-restarting the shared daemon temporarily impacts all connected IDE windows. Mitigate by surfacing clear status transitions and reconnect behavior.
