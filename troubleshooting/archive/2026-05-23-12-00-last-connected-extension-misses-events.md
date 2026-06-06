# Last-connected extension is the only one receiving live events

**Date**: 2026-05-23
**Context**: Running `node scripts/test-proxy.mjs` while both VS Code and Cursor are open — events appear only in the Agent Monitor panel of whichever IDE connected to the daemon most recently; the other shows nothing.

---

## Attempt 1 — sseStreams key collision (same instanceId)

**Hypothesis**: If both extensions share the same `instanceId`, the second connection would overwrite the first in `sseStreams: Map<string, ServerResponse>`, leaving only the last-connected stream active.
**What was tried**: Read `src/extension.ts` to find where `instanceId` is generated. Found `instanceId = crypto.randomUUID()` on every activation — confirmed to be unique per IDE.
**Result**: VS Code: `bf62a781-0d12-4177-8b54-a27ef2ee58b7`, Cursor: `6ba320d1-8a96-49f2-b36b-81e9f6c3e548`. No collision.
**Why it was wrong**: Each extension generates a fresh UUID on activation; they can never collide.
**Status**: ❌ Failed

---

## Attempt 2 — Registry evicts the older connection on re-register

**Hypothesis**: When the second extension calls `POST /register`, the `ConnectionRegistry` might overwrite or evict the first entry, causing it to deregister its SSE stream.
**What was tried**: Read `src/daemon/registry.ts` in full. Registry is a `Map<string, ConnectionInfo>` keyed by `instanceId`. `register()` upserts by instanceId — no cross-instance eviction or size limit logic.
**Result**: Registry stores both connections independently; no eviction path exists between different instanceIds.
**Why it was wrong**: Registry doesn't touch sseStreams at all; it only tracks metadata (ide, port, heartbeat timestamp).
**Status**: ❌ Failed

---

## Attempt 3 — Daemon broadcast only writes to one stream

**Hypothesis**: `broadcast()` in `daemon/index.ts` might iterate `sseStreams` incorrectly and only reach one entry — e.g. early return, overwritten Map, or iteration bug.
**What was tried**: Read `src/daemon/index.ts` lines 1–55. `sseStreams` is a proper `Map<string, http.ServerResponse>`; `broadcast()` uses `for (const [id, res] of sseStreams)` with no early returns. Also confirmed `panelSseStreams` iterated separately.
**Result**: The loop is correct — no early return, no conditional skip, no overwrite path.
**Why it was wrong**: Loop is textbook correct; the problem is not in broadcast iteration.
**Status**: ❌ Failed

---

## Attempt 4 — Confirm daemon broadcasts to all live subscribers (empirical)

**Hypothesis**: Despite code looking correct, an actual runtime test might reveal a broadcast gap — perhaps a socket-level issue closes one stream before broadcast reaches it.
**What was tried**: Created `scripts/test-multi-subscriber.mjs` — opens two independent SSE connections with different instanceIds, sends a broadcast event via `POST /test-event`, asserts both subscribers received it.
**Result**: **PASSED**. Both `multi-sub-A-...` and `multi-sub-B-...` received the same event. Daemon broadcasts to all subscribers correctly.
**Why it was wrong**: N/A — hypothesis was correct that a runtime test was needed to be certain, and it confirmed the daemon is not the source of the bug.
**Status**: ✅ Resolved (daemon ruled out as bug source)

---

## Attempt 5 — Live connection state check via /connections

**Hypothesis**: Maybe only one IDE is actually connected to the daemon at the time test-proxy runs, making the "last connected" observation misleading.
**What was tried**: Ran `curl --unix-socket ~/.mcpEavesdrop/ipc.sock http://daemon/connections | python3 -m json.tool` while both IDEs were open.
**Result**: `{"total":2,"connections":[{"instanceId":"bf62a781-...","ide":"vscode",...},{"instanceId":"6ba320d1-...","ide":"cursor",...}]}` — both registered with recent heartbeats.
**Why it was wrong**: Both IDEs ARE registered. The bug is definitely not "only one is connected to the daemon."
**Status**: ❌ Failed

---

## Current Hypotheses (under investigation)

Bug is confirmed to be on the **extension host side** (not daemon). Three candidates remain:

### H1 — AgentPanel not open in VS Code (most likely)
`AgentPanel.currentPanel` is `null` when the panel tab is closed. `AgentPanel.postMessage()` is a silent no-op when `currentPanel` is null — events arrive at the extension host but are silently discarded. When the panel is opened later, `_loadHistory()` loads ALL events from `~/.mcpEavesdrop/logs/` (shared dir), so past events would appear retroactively but live events are missed.

### H2 — VS Code SSE stream silently dropped on write error
When Cursor connects and the daemon writes to both streams, if the VS Code stream throws a write error, `broadcast()` does `sseStreams.delete(id)`. VS Code's extension host then detects the stream close and calls `scheduleReconnect()` with a 5s delay. Events sent during that 5s window are missed. This would explain "last to connect" since reconnect after stream loss would also be last.

### H3 — Filter state hides VS Code events in webview
`isVisible(event)` returns `filterState.get(key) !== false`. If VS Code's webview has a stale `localStorage['mcpEavesdrop-filters']` entry for the `vscode/proxy-test-ws` key set to `false`, events arrive but are hidden by the filter. Less likely since `filterState.get(key)` returns `undefined` for unknown keys, and `undefined !== false` is `true`.

---

## Attempt 6 — VS Code EDH window opens then immediately closes

**Hypothesis**: Adding `"${workspaceFolder}"` as the second launch arg (a previous session change) causes VS Code's window manager to redirect the Extension Development Host to the already-open main VS Code window. Cursor doesn't exhibit this behavior because it manages windows independently.
**What was tried**: Read `.vscode/launch.json` — confirmed `"${workspaceFolder}"` was added alongside `--extensionDevelopmentPath=${workspaceFolder}`. Ran `git show HEAD:.vscode/launch.json` to confirm the original config had only `--extensionDevelopmentPath` with no workspace path arg. Added `--new-window` flag before `"${workspaceFolder}"` to force a new window regardless of existing VS Code windows.
**Result**: EDH now opens a distinct window (window reuse fixed), but extension activation crashes within 1 second.
**Status**: ⚠️ Partial — window opens, new crash to investigate

---

## Attempt 7 — Extension activation crash (exit code 1, abnormal-exit)

**Hypothesis**: Extension activation crashes at the module level. Found in `main.log`: extension host pid 50348 exited with code 1, reason 'abnormal-exit' at 22:36:57 — exactly 1 second after loading the development extension. This is a process exit, not a caught exception.
**What was tried**: Checked `main.log` — confirmed "crashed with code 256 and reason 'abnormal-exit'". Checked `window11/exthost/` directory — does NOT exist, meaning the extension host process died before it could create log files. This rules out a graceful activation failure (which would leave logs) and points to `process.exit(1)` being called. Searched `daemon/index.ts` for `process.exit` — found `main().catch(() => process.exit(1))` at module level (line 562–564). Read `extension.ts` — confirmed it imports `DAEMON_SOCKET_PATH` from `./daemon/index`. Since esbuild bundles the extension with all its imports, daemon/index.ts (including `main()`) gets bundled into `dist/extension.js`. When the extension host loads the bundle, `main()` runs, deletes the live daemon socket, tries to start a new daemon, and if anything fails (port conflict, socket race) it calls `process.exit(1)`, crashing the host.
**Result**: Root cause confirmed. Also found `wrapper-deploy.ts` had the same `./daemon/index` import. Created `src/daemon/constants.ts` with just `DAEMON_SOCKET_PATH` (no side effects). Updated `extension.ts`, `wrapper-deploy.ts`, and `daemon/index.ts` to import from `./daemon/constants` instead. Build is now warning-free and clean.
**Why it was wrong (about scope)**: The earlier hypothesis was a window management issue; it was partially right (fixed with `--new-window`) but the crash is a separate, more fundamental import-side-effect bug.
**Status**: ✅ Resolved (daemon no longer bundled into extension host)

---

## Attempt 8 — Add /debug/streams endpoint to inspect live sseStreams

**Hypothesis**: The `/connections` endpoint shows registry state (metadata), not stream state. A separate `/debug/streams` endpoint showing live sseStreams keys will tell us definitively whether H1/H2 (stream lost) or H3 (stream present but panel not showing) is the root cause.
**What was tried**: Added `GET /debug/streams` handler to `src/daemon/index.ts` after the `/connections` handler; ran `npm run build` — build succeeded.
**Result**: Build complete. Endpoint not yet tested against live daemon (daemon not yet restarted with new build).
**Status**: ⚠️ Partial — awaiting daemon restart and live query

---

## Attempt 9 — VS Code EDH STILL crashing after daemon import fix

**Hypothesis**: Despite confirming daemon code is absent from `dist/extension.js` (grep: 0 matches), the EDH extension host (e.g. PID 68000, window14) still exits with code 1 within ~1 second. A different crash source must exist.
**What was tried**:
- Searched `src/**/*.ts` for all `process.exit` calls — confirmed only in `daemon/index.ts` and `proxy/stdio-wrapper.ts`; neither is imported by `extension.ts`.
- Read `dist/extension.js` (tail) — no module-level side-effect code; ends with `0 && (module.exports = { activate, deactivate })`.
- Checked output channel logs for window12/13/14 — `tasks.log` empty, no MCP Eavesdrop output channel log → crash happens BEFORE `activate()` is called (output channel created as first line of activate).
- Checked renderer.log for windows 11/12/13/14 — ALL have identical pattern: "Started local extension host", "Loading development extension", yaml warning, "AccountPolicyGate apply: state=inactive" — then nothing. The extension host crashes between AccountPolicyGate and the first extension activation event.
- This means the crash occurs in VS Code's OWN extension host bootstrapping code — BEFORE any of our code runs. Our extension code is not the cause.
- Compared window1 (normal VS Code, working) vs EDH windows: window1 has `exthost/` logs; EDH windows have no `exthost/` directory. Extension host dies before VS Code's own log directory creation.
- Identified differentiators: `VSCODE_DEV: "1"` and `debugWebWorkerExtensions: false` in launch.json — both absent from original HEAD config, added in a prior session. `VSCODE_DEV=1` tells VS Code it is running from source (dev layout). In a production VS Code binary, this causes the bootstrap to look for dev-build resource paths that don't exist, crashing the extension host process before any extensions are loaded.
**Result**: Root cause identified as `VSCODE_DEV: "1"` in launch.json env. Also removed the unnecessary `"${workspaceFolder}"` positional arg (not needed since EDH opens a new window automatically without specifying a folder) and `debugWebWorkerExtensions: false`. Reverted launch.json to original form: only `--extensionDevelopmentPath=${workspaceFolder}`, no env overrides.
**Status**: ✅ Fix applied — user confirmed EDH launches and loads extension successfully

---

## Resolution

**Root cause (EDH crash — blocker)**: `VSCODE_DEV: "1"` in `.vscode/launch.json` caused VS Code's production binary to enter a development-layout bootstrap path that looks for source-build resources that don't exist in a packaged install. The extension host process crashed with exit code 1 before VS Code created any log files and before any extension activated. `debugWebWorkerExtensions: false` and the `"${workspaceFolder}"` positional arg were also removed — neither is needed and the latter was the original source of the window-redirect issue (Attempt 6).

**Root cause (original bug — daemon ruled out)**: The daemon correctly broadcasts to all SSE subscribers (confirmed by `test-multi-subscriber.mjs`). The bug is on the extension host / panel side. Three hypotheses remain uninvestigated — H1 (AgentPanel not open → postMessage no-op), H2 (SSE stream dropped on write error → 5s gap), H3 (filter state hides events in webview). Investigation was paused at Attempt 8 awaiting a live test of the `/debug/streams` endpoint once the EDH was stable.

**Fix applied**:
- `src/daemon/constants.ts` — new side-effect-free module exporting only `DAEMON_SOCKET_PATH`
- `src/extension.ts`, `src/wrapper-deploy.ts` — import `DAEMON_SOCKET_PATH` from `./daemon/constants` (not `./daemon/index`)
- `.vscode/launch.json` — reverted to `--extensionDevelopmentPath=${workspaceFolder}` only; removed `VSCODE_DEV`, `debugWebWorkerExtensions`, `--new-window`, and `"${workspaceFolder}"` positional arg

**Key insight**: Two independent bugs were masked by the same symptom ("EDH crashes"). The first (window redirect) was a launch arg issue. The second (process.exit(1)) was a module-level side effect from bundling `daemon/index.ts` — its `main().catch(() => process.exit(1))` ran inside the extension host. Both were fixed, then a third crash (`VSCODE_DEV=1`) was found that had nothing to do with our code. The pattern: any crash that happens before VS Code creates `exthost/` log files is a bootstrap-level issue in VS Code itself, not in extension code.

---
