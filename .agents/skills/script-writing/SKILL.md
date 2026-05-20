---
name: script-writing
description: Use when creating or editing executable script files in this project — Node.js `.mjs` scripts, shell scripts, or any file intended to be run directly from the terminal. Covers shebangs, permissions, error handling, exit codes, and output conventions.
---

# Script Writing

**Shebang**: All directly-executable scripts must start with a shebang: `#!/usr/bin/env node` for `.mjs`, `#!/usr/bin/env bash` for shell scripts. Without it, direct invocation fails with cryptic errors.

**Permissions**: After creating any script file, immediately run `chmod +x <path>`. Files created programmatically have no execute bit by default, causing exit code 126.

**Error handling**: Use `process.exit(1)` (or non-zero) on failure with a `console.error` message. Use `process.exit(0)` on success. Don't let uncaught exceptions silently fail.

**Output**: Write status/progress to `console.log`, errors to `console.error`. Keep output readable when run non-interactively (no interactive spinners that corrupt CI output).
