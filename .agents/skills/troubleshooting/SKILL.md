---
name: troubleshooting
description: Use this skill when debugging, diagnosing errors, investigating test failures, or any multi-step investigation where attempts might loop. Activate when the user mentions a bug, error, unexpected behavior, or asks "why is X happening" or "help me debug this." Also activate proactively when you catch yourself about to retry something you've already tried — check the troubleshooting log first. The goal is to prevent wasted cycles by keeping a structured, append-only record of what has been attempted, what the hypothesis was, and why each approach succeeded or failed.
---

# Troubleshooting

This skill maintains a structured troubleshooting log so that no attempt is repeated and the reasoning trail stays visible to both the agent and the user.

## Core Principle

Before trying anything, read the log. After trying anything, write to the log. A repeated attempt is a bug in your process.

## Log Location

Each troubleshooting session gets its own file inside a `troubleshooting/` folder at the root of the workspace (or nearest relevant directory if the issue is scoped to a subfolder).

**File naming**: `YYYY-MM-DD-HH-MM-<short-slug>.md` where the slug is a 2–4 word kebab-case description of the issue.

Examples:
- `2026-05-21-14-32-daemon-socket-econnrefused.md`
- `2026-05-21-09-15-build-fails-missing-type.md`

Create the `troubleshooting/` directory if it doesn't exist.

## Workflow

### 1. Open or Create the Session File

At the start of a new investigation, create a new session file with the naming convention above. If you're resuming an existing investigation (the user says "keep going" or references a prior session), find the most recent matching file and append to it instead.

Read any existing session files that seem related before starting — a past session on the same component may contain useful context.

**New session file header:**
```markdown
# [Short description of the issue]

**Date**: YYYY-MM-DD
**Context**: [One sentence: what was being done when the issue appeared]

---
```

### 2. Before Each Attempt

Scan the current session file's existing entries:
- If the approach you're about to try is already listed with a ❌ outcome, **do not retry it**. Build on the failure reason instead — what does it tell you about what to try next?
- If the issue appears **resolved** (✅), confirm with the user before closing the investigation.

### 3. Log Each Attempt

Append a new entry immediately after completing (or abandoning) each attempt, using this exact template:

```markdown
## Attempt [N] — [short label]

**Hypothesis**: [What you believed was causing the issue, and why]
**What was tried**: [Specific actions taken — commands run, files changed, configs modified]
**Result**: [What actually happened — output, error messages, behavior observed]
**Why it was wrong** *(if failed)*: [What the result reveals about the real cause — what assumption was incorrect]
**Status**: [❌ Failed | ✅ Resolved | ⚠️ Partial — [explain]]

---
```

Keep each field concise but specific. Vague entries like "tried restarting" are useless — include the exact command, flag, or change made.

### 4. Forming the Next Hypothesis

After a failed attempt, explicitly state the next hypothesis before taking action. The "Why it was wrong" field from the previous attempt should inform what you try next — don't just move to the next idea on the list. Make the connection visible.

If you're stuck after 3+ failed attempts with no new leads, stop and summarize what is known vs. unknown, and ask the user for more context rather than continuing to guess.

### 5. Resolution

When the issue is resolved, append a final summary entry:

```markdown
## Resolution

**Root cause**: [The actual cause, in one or two sentences]
**Fix applied**: [What change resolved the issue]
**Key insight**: [What made the difference — what earlier attempts were missing]

---
```

## Anti-patterns to Avoid

- **Looping**: Trying the same thing twice because you forgot you already tried it
- **Undocumented pivots**: Changing direction without logging why the previous attempt failed
- **Hypothesis-free attempts**: Trying things without stating what you expect to learn
- **Partial entries**: Logging "tried X" without recording what happened when you tried X

## Example Entry

```markdown
## Attempt 2 — Increase daemon startup timeout

**Hypothesis**: The test was failing because the daemon process wasn't fully ready when the client connected — a race condition, not a logic error.
**What was tried**: Increased the startup wait in `test-daemon.mjs` from 500ms to 2000ms (line 34), re-ran `node scripts/test-daemon.mjs`.
**Result**: Still failed with `ECONNREFUSED`. Daemon never bound to the socket regardless of wait time.
**Why it was wrong**: The timeout assumption was wrong — the daemon wasn't slow, it wasn't starting at all. The `ECONNREFUSED` persisted even at 5s, pointing to a startup crash rather than a race.
**Status**: ❌ Failed

---
```
