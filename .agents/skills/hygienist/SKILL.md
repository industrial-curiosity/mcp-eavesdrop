---
name: hygienist
description: Use this skill to check and fix test and documentation hygiene after code changes. Activate when implementation changes an interface, constant, file path, protocol, or data structure that tests or docs might reference. Also activate when adding or modifying test scripts, when user-facing or architectural behavior changes, or when a spec requirement is modified or removed. Can be invoked ad-hoc or called from within other skills (opsx-apply, opsx-update).
license: MIT
metadata:
  author: openspec
  version: "1.0"
---

Audit and repair test and documentation hygiene after code or spec changes.

**Input**: Describe what changed (e.g., "renamed IPC socket path", "removed `proxyPort` field", "added new test script"). If called from another skill, that skill will supply the context.

---

## Check 1 — Test script staleness

Run this check whenever implementation changes any interface, constant, file path, socket path, protocol, or data structure.

1. Identify the changed values — old name/path/field and new name/path/field.
2. Search `scripts/` for references to the old values:
   ```bash
   grep -r "<old-value>" scripts/
   ```
3. For each hit, update the script to use the new value.
4. Also update any top-of-file comment blocks in those scripts (e.g., `Usage:`, `Prerequisites:`) if the change affects how the script is run or what it depends on.
5. This check applies to **all** test scripts in `scripts/` — not just ones added or modified by the current task.

---

## Check 2 — Testing documentation

Run this check whenever a test script is added, modified, or found stale in Check 1.

1. Locate the project's primary testing documentation (`docs/testing.md`). If none exists, create it.
2. For each affected script, ensure an entry exists (or is updated) covering:
   - Script path (e.g., `node scripts/test-foo.mjs`)
   - Prerequisites (build step, daemon running, extension host, etc.)
   - CLI flags or environment variables
   - Expected output / pass criteria
   - Ordering dependencies relative to other scripts
3. If a script was removed, remove its entry from `docs/testing.md`.

---

## Check 3 — Project documentation

Run this check whenever user-facing or architectural behavior changes.

1. **`README.md`** — update if any of the following changed: features, commands, configuration options, compatibility, usage instructions, or the high-level description of how the system works.
2. **`docs/spec.md`** (architecture doc) — update if any of the following changed: project structure (files added/removed/moved), component responsibilities, activation events, registered commands, data flow, or inter-component interfaces.
3. **Inline file headers** — if any source file or script has a top-of-file comment documenting its purpose, prerequisites, or usage, and the change affects those details, update the comment in place.

If none of these need updating, state why (e.g., "change was internal-only with no user-visible or architectural impact").

---

## Check 4 — Spec-to-test traceability (spec changes only)

Run this check when a spec requirement is MODIFIED or REMOVED.

1. Search `scripts/` for test scripts that exercise behavior described in the affected requirements.
2. For each script found, flag it:
   > ⚠ `scripts/test-foo.mjs` covers "<requirement title>" — review for staleness
3. If no scripts are found, state: "No test scripts found referencing affected requirements."
4. Do not silently skip this step.

---

## Output

After running all applicable checks, report:

```
## Hygiene Report

### Test staleness
- Updated: <list of scripts changed, or "none">
- Clean: <list of scripts checked and found current, or "none checked">

### Testing docs
- Updated: <docs/testing.md entries changed, or "none needed">

### Project docs
- README.md: <updated | no change — reason>
- docs/spec.md: <updated | no change — reason>
- Inline headers: <list of files updated, or "none">

### Spec-to-test traceability  *(only if spec changed)*
- Flagged: <list of scripts to review, or "none found">
```
