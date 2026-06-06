# VS Code SonarLint startFailed and extension host warnings

**Date**: 2026-05-23
**Context**: Reviewing VS Code extension host debug output to eliminate recurring warnings/errors seen during development.

---

## Attempt 1 — Verify Java/runtime as SonarLint blocker

**Hypothesis**: SonarLint fails with `startFailed` because no system Java runtime is available.
**What was tried**: Ran `command -v java && java -version`; searched latest VS Code logs for SonarLint startup traces and failures.
**Result**: System Java is missing (`Unable to locate a Java Runtime`), but SonarLint logs show successful startup and analysis using bundled JRE (`.../sonarlint-vscode-5.2.3-darwin-arm64/jre/.../bin/java`, embedded server started, analyses completed).
**Why it was wrong**: Missing system Java is not sufficient to explain this failure because SonarLint does not require it in this environment.
**Status**: ❌ Failed

---

## Attempt 2 — Scope correction from user feedback

**Hypothesis**: SonarLint/SonarQube warnings in pasted debug output were in-scope for this investigation.
**What was tried**: Began Sonar-related triage using extension host logs and extension folders.
**Result**: User clarified Sonar findings are a separate issue and not relevant to this investigation.
**Why it was wrong**: Scope assumption was incorrect; this session must focus on MCP Eavesdrop extension behavior only.
**Status**: ❌ Failed

---

## Attempt 3 — Fix repeated SSE reconnect loop in MCP Eavesdrop

**Hypothesis**: `MCP Eavesdrop: daemon SSE stream ended, scheduling reconnect` repeats because reconnect path re-subscribes to `/events` when socket exists but instance registration is missing; daemon rejects stream and closes immediately, causing an infinite loop.
**What was tried**: Updated `src/extension.ts` monitor logic to: (1) treat non-200 `/events` responses as failed subscribe (without marking connected), (2) log rejection status/body, and (3) re-register instance before re-subscribing when socket probe succeeds during reconnect.
**Result**: `npm run build` passes after changes. User confirmed connection errors resolved and test script passes.
**Status**: ✅ Resolved

---

## Attempt 4 — Blanket --disable-extensions in launch.json

**Hypothesis**: All non-MCP Eavesdrop extensions including SonarLint can be silenced by adding `--disable-extensions` to the extensionHost launch args.
**What was tried**: Added `--disable-extensions` to `args` in `.vscode/launch.json`.
**Result**: User ran debug session and SonarLint errors persisted unchanged. `Chat Customizations Evaluations extension activated` also still appeared, confirming the flag was not honoured for the Extension Development Host.
**Why it was wrong**: VS Code's `extensionHost` launch type does not honour `--disable-extensions` (plural) in `args` in this version — at minimum the Chat Customizations extension (possibly a VS Code built-in) always loads, and SonarLint also continued loading.
**Status**: ❌ Failed

---

## Attempt 5 — Targeted --disable-extension for SonarLint

**Hypothesis**: The singular `--disable-extension <id>` flag is more targeted and may work where the blanket flag does not.
**What was tried**: Replaced `--disable-extensions` with `--disable-extension` + `sonarsource.sonarlint-vscode` in `.vscode/launch.json`.
**Result**: Awaiting runtime verification.
**Status**: ⚠️ Partial — awaiting verify

---

## Finding — punycode and SQLite warnings are from VS Code runtime

**Investigation**: Searched all `src/` and `dist/` for any use of `sqlite`, `SQLite`, or `punycode`. No matches.
**Conclusion**: `(node:XXXXX) [DEP0040] DeprecationWarning: The 'punycode' module is deprecated` and `ExperimentalWarning: SQLite is an experimental feature` both originate from VS Code's own extension host runtime (used by GitHub Copilot and VS Code internals). These warnings cannot be suppressed by any change to this extension.

---
