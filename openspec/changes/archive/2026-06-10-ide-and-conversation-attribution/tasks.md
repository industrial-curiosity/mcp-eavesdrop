## 1. Wrapper Metadata Contract

- [x] 1.1 Remove workspace slug from wrap options and metadata injection in `src/mcp-wrap.ts` while retaining IDE metadata
- [x] 1.2 Ensure unwrap/strip logic removes legacy `MCPEAVESDROP_WORKSPACE_SLUG` during restore paths
- [x] 1.3 Update monitoring command integration in `src/monitoring-commands.ts` and `src/extension.ts` to stop passing workspace slug into wrapping

## 2. Telemetry Shaping

- [x] 2.1 Keep wrapper event shaping in `src/proxy/stdio-wrapper.ts` source-faithful: include `conversationId` only when request metadata provides it
- [x] 2.2 Update shared event typings in `src/types/events.ts` (and any wrapper-local interfaces) so absent `conversationId` remains valid event data
- [x] 2.3 Verify daemon telemetry handling in `src/daemon/index.ts` and logger paths remain compatible when workspace slug is absent and `conversationId` may be absent

## 3. Panel Display And Filtering

- [x] 3.1 Replace IDE/workspace source label rendering in `src/panel/webview/app.ts` with IDE-only source plus dedicated conversation ID column
- [x] 3.2 Re-key filter state and filtering logic to use IDE + conversation ID buckets instead of IDE + workspace slug
- [x] 3.3 Update panel history rendering and row datasets so missing `conversationId` values are displayed and filtered as `"not detected"`

## 4. Tests

- [x] 4.1 Update wrap/unwrap tests (for example `scripts/test-mcp-wrap.mjs`) to assert workspace env key is not written and is removed when encountered
- [x] 4.2 Update wrapper telemetry tests (`scripts/test-wrapper.mjs`) to assert `conversationId` remains absent when `_meta` is missing
- [x] 4.3 Update panel/daemon integration tests to reflect IDE + conversation filtering and column expectations

## 5. Documentation

- [x] 5.1 Update change-facing docs under `docs/` that describe attribution fields and panel filters to match IDE + conversation behavior
- [x] Update README.md and docs/spec.md to reflect any user-facing or architectural changes introduced by this change
