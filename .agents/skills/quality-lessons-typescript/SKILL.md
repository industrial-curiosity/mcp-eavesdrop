---
name: quality-lessons-typescript
description: TypeScript and MJS code quality rules for this project. Activate for any file matching src/**/*.ts, scripts/**/*.mjs, or build.mjs — even if the user doesn't say "check quality" or "fix linting". Do NOT activate for .js files outside those paths unless explicitly requested.
allowed-tools: get_errors read_file replace_string_in_file multi_replace_string_in_file sonarqube_analyze_file sonarqube_list_potential_security_issues
---

# Code Quality Lessons — TypeScript

When editing or creating any file matching `src/**/*.ts`, `scripts/**/*.mjs`, or `build.mjs`, apply these rules before and after writing. Run `get_errors` on every modified file to catch compiler and linter issues. Do NOT apply to `.js` files outside those paths.

**Toolchain**: TypeScript compiler (`tsc`), ESLint (if configured), SonarQube (if connected).

---

## Known Issues and Fixes

> No issues have been recorded yet. This file will grow as `code-quality-fix` is run on TypeScript/MJS files in this project.

When the first issue is fixed, append it here following this format:

### {source}:{rule-id} — {short description}

**Source**: `tsc` | `eslint` | `sonarqube`
**Severity**: Error | Warning | Major | Minor
**Trigger**: {what code pattern causes this issue}
**Fix**: {concise description of the fix}

```typescript
// Before
// ...

// After
// ...
```

---

## Project-Specific Conventions

Enforce these patterns in all code written for this project:

### Async / Await
- All IPC and HTTP calls use `async`/`await`. Never use `.then()` chains in new code.
- Propagate `async` up the call chain rather than mixing sync and async callers.

### Error Handling
- In daemon/proxy code, use `logger.error()` from `src/daemon/logger.ts`. Never use bare `console.error()`.
- In extension command handlers, catch errors and surface them via `vscode.window.showErrorMessage`.
- For code that could run in both contexts (shared utilities in `src/types/`, `src/mcp-config.ts`, etc.), use `logger.error()` and let the extension layer re-surface via `showErrorMessage`. Never use `console.error()` anywhere in `src/`.

### Types
- Add explicit return types on all exported functions.
- Do not use `any` — use `unknown` and narrow, or import the specific type from `src/types/`.

### Scripts (.mjs)
- Scripts must start with `#!/usr/bin/env node`, use `process.exit(0)` for success and `process.exit(1)` for failure, and never throw unhandled exceptions at the top level. Full details in `.agents/skills/script-writing/SKILL.md`.
- Use top-level `await` (ES modules) — do not wrap in a `main()` IIFE.
