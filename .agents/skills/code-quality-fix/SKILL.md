---
name: code-quality-fix
description: Use this skill after writing or editing any source code file to check for code quality problems and fix them. Activate automatically after every code write or edit — including new file creation, edits to existing source files, and refactors. Also activate when the user says "fix quality issues", "check for problems", "clean up the code", "fix linting errors", "fix sonar issues", or "why are there warnings". Sources include compiler errors, linter warnings, type checker diagnostics, and static analysis tools like SonarQube. After fixing, record lessons learned in a language-specific skill so the same issues don't recur.
allowed-tools: sonarqube_analyze_file sonarqube_list_potential_security_issues get_errors read_file replace_string_in_file multi_replace_string_in_file create_file grep_search file_search memory
---

# Code Quality Fix

Analyze recently written or edited source files for quality problems from all available sources, fix them, and record lessons learned in a per-language skill.

**Input**: The file(s) just written or modified. If called from another skill, that skill supplies the file list.

---

## Step 1 — Detect issues

For each modified file, gather issues from all available sources:

1. **Primary — editor diagnostics**: Call `get_errors` on the modified file(s). This surfaces compiler errors, type errors, and linter warnings from whatever tools are configured in the project (TypeScript compiler, ESLint, Pylint, etc.).
2. **Static analysis**: Call `sonarqube_list_potential_security_issues` to get SonarQube-flagged issues. Call `sonarqube_analyze_file` for a deeper pass if needed.
3. Resolve compiler/type errors before tackling linter or static analysis issues — broken code masks everything else.

Collect all issues into a unified triage list: source (e.g., "tsc", "eslint", "sonarqube"), rule ID or error code, severity, message, line number, and affected file.

---

## Step 2 — Triage

Order issues by severity before fixing:

1. **Error / Blocker** — must fix; compiler errors, type errors, clear bugs, security vulnerabilities
2. **Warning / Critical** — fix unless there's a documented reason not to
3. **Major** — fix if the change is localized and low-risk
4. **Minor / Info / Hint** — fix only if trivial; skip if they require refactoring unrelated code

For each Error or Warning, check the language-specific lessons skill (`.agents/skills/quality-lessons-{language}/SKILL.md`) for a known pattern and fix. If the pattern is already documented, apply that fix directly without re-investigating.

---

## Step 3 — Fix issues

Fix issues in triage order. For each fix:

- Read the surrounding context before editing — understand what the code is doing.
- Apply the minimal change that satisfies the rule. Do not refactor unrelated code.
- Do not add speculative defensive checks for scenarios that can't happen.

**Common patterns by language**:

### TypeScript / JavaScript
- Unused variables → remove, or prefix with `_` if a parameter position must be kept
- Missing `await` on async calls → add `await`; propagate `async` up the call chain as needed
- `any` type → replace with a specific type or `unknown`
- Exception swallowing (`catch {}`) → rethrow or log the error
- Hardcoded credentials → **stop immediately**, alert the user, and extract to env vars; never commit secrets

### Python
- Bare `except:` → catch specific exception types
- Mutable default arguments → use `None` with a guard inside the function body
- Missing `with` for resource management → wrap in `with` block

### General
- Dead code / unreachable branches → remove
- Empty blocks → either add a comment explaining the intent or remove the block
- Magic numbers → extract to a named constant if the meaning isn't obvious from context

When a fix requires judgment (e.g., the correct exception type is unclear, or removing code could break callers), note it in the Step 5 summary and skip rather than guess.

---

## Step 4 — Update the language-specific lessons skill

After fixing, record what was learned. The lessons skill path is:

```
.agents/skills/quality-lessons-{language}/SKILL.md
```

**Language name mapping** (use lowercase):

| File extension | Language key |
|---|---|
| `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs` | `typescript` |
| `.py` | `python` |
| `.go` | `go` |
| `.java` | `java` |
| `.cs` | `csharp` |
| `.rb` | `ruby` |
| Other | use the lowercase language name |

### If the lessons skill does not exist — create it:

```markdown
---
name: quality-lessons-{language}
description: Language-specific code quality lessons for {Language}. Load this skill when writing or reviewing {Language} code to apply accumulated fixes and avoid patterns that have caused errors, warnings, or static analysis issues in this codebase. Activate whenever writing new {Language} code or reviewing existing {Language} code for quality.
---

# Code Quality Lessons — {Language}

Accumulated lessons from `code-quality-fix` runs. Consult this before writing new code to avoid introducing known issues.

## Known Issues and Fixes
```

### If the lessons skill already exists — append to it:

1. Read the file.
2. Check if the rule ID is already documented. If it is, skip (or enrich the existing entry with new context if the fix was different this time).
3. If it's new, append under `## Known Issues and Fixes`:

```markdown
### {source}:{rule-id} — {short description}

**Source**: {tsc | eslint | sonarqube | pylint | etc.}
**Severity**: {Error | Warning | Major | Minor | Info}
**Trigger**: {what code pattern causes this issue}
**Fix**: {concise description of the fix}

```{language}
// Bad
{bad example}

// Good
{good example}
```
```

Keep examples short (3–5 lines each). If no concise example fits, omit the code block and describe the fix in prose.

---

## Step 5 — Summary

After all fixes are applied, report:

- **Files analyzed**: list
- **Issues found**: count by severity (e.g., "2 Critical, 1 Major")
- **Issues fixed**: list rule IDs with one-line descriptions
- **Issues skipped**: list with reason (e.g., "S2201 — requires architectural change, flagged for human review")
- **Lessons skill**: created or updated at `.agents/skills/quality-lessons-{language}/SKILL.md`

If any Blockers were skipped, call that out prominently so the user knows.
