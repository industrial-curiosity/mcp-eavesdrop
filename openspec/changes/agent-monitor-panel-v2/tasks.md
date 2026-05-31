## 1. Remove conversationId / color palette code

- [x] 1.1 Remove `parseHex`, `toHex`, `midColor`, `extendPalette`, `charCodeSum`, `getConversationColor` functions from `src/panel/webview/app.ts`
- [x] 1.2 Remove `colorPalette`, `occupiedSlots`, `conversationColors` globals from `src/panel/webview/app.ts`
- [x] 1.3 Remove the `conversationId` badge rendering block from `createStartedEntry()` in `src/panel/webview/app.ts`
- [x] 1.4 Remove `.conv-badge` CSS rule from `src/panel/webview/styles.css`

## 2. Fix connections sidebar HTML

- [x] 2.1 Restructure `src/panel/webview/index.html` body to a two-column flex layout: `<div class="main-layout">` containing a `<div id="connections" class="connections-sidebar">` and a `<div class="main-content">` wrapping the filter bar and log container
- [x] 2.2 Add sidebar and layout CSS to `src/panel/webview/styles.css`: `.main-layout` (flex row, height 100%, overflow hidden), `.connections-sidebar` (fixed ~180px width, overflow-y auto, border-right, flex-shrink 0), `.main-content` (flex 1, display flex, flex-direction column, overflow hidden)

## 3. Add filter bar HTML and CSS

- [x] 3.1 Add `<div id="filterBar" class="filter-bar">` inside `.main-content` in `index.html`, containing: `<input id="filterTool" type="text" placeholder="Tool name…">`, `<select id="filterServer"><option value="">All servers</option></select>`, `<select id="filterStatus">…</select>` (options: All / in-progress / completed / failed), `<select id="filterTime">…</select>` (options: All / Last hour / Today)
- [x] 3.2 Add `.filter-bar` CSS: flex row, gap 6px, padding 6px 8px, border-bottom, flex-shrink 0; style inputs and selects to match VS Code theme variables

## 4. Implement filter bar logic in app.ts

- [x] 4.1 Get references to the four filter controls (`filterTool`, `filterServer`, `filterStatus`, `filterTime`) via `document.getElementById` in `src/panel/webview/app.ts`
- [x] 4.2 Extend `isVisible(event)` to also check: tool name substring match, server name equality, status match (requires passing the entry element or a status value), and time range (compare `event.timestamp` to `Date.now()`)
- [x] 4.3 Add `addServerOption(serverName)` function: checks if option already exists in `#filterServer`, adds it if not
- [x] 4.4 Call `addServerOption(event.serverName)` in `handleEvent()` for each incoming event that has a `serverName`
- [x] 4.5 Add `change` event listeners on all four filter controls that call `reapplyFilters()`
- [x] 4.6 Update `reapplyFilters()` to re-read the current filter control values and apply all filters (tool name, server, status, time) in addition to the existing IDE/workspace filter

## 5. Display meta in expanded detail view

- [x] 5.1 In `createStartedEntry()`, after adding the Arguments section, check `if (event.meta && Object.keys(event.meta).length > 0)` and append `createDetailsSection('Meta', event.meta)`
- [x] 5.2 In `updateCompleted()`, check `if (event.meta && Object.keys(event.meta).length > 0)` and append `createDetailsSection('Meta', event.meta)` to the entry details

## 6. Testing

- [ ] 6.1 Build and install extension, open Agent Monitor panel — verify connections sidebar renders (no longer empty/invisible)
- [ ] 6.2 Trigger several MCP tool calls across different servers; verify filter bar server select populates correctly
- [ ] 6.3 Verify each filter control (tool name, server, status, time range) hides/shows entries as expected
- [ ] 6.4 Verify combined filters apply as AND logic
- [ ] 6.5 Verify no `conversationId` badge or color assignment appears in any rendered entry
- [ ] 6.6 Verify panel opens, closes, and reopens with filter bar reset to defaults

## 7. Documentation

- [x] 7.1 Update README.md and docs/ to reflect any user-facing or architectural changes introduced by this change
