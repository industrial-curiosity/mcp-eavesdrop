---
name: codify-correction
description: Use this skill when a user corrects an agent behavior and wants to prevent it from recurring. Activate when the user says things like "don't do that again", "remember this", "make a skill for that", "add that to your instructions", or "next time do X instead". Also activate proactively — after completing a corrected task, offer to codify the fix if the mistake looks like a reproducible pattern and not a one-off misunderstanding. Do NOT activate for corrections to factual errors, ambiguous requests, or context-specific one-offs that won't recur.
---

# Codify Correction

When a user corrects a behavior, create or update a focused skill to prevent it from recurring. The key principle: generated skills must have narrow, precise triggering conditions — they should only load when genuinely relevant, not bleed into unrelated tasks.

## Deciding whether to offer (proactive case)

When you finish correcting a task and the user didn't explicitly ask to codify it, offer only if the mistake meets all three criteria:

1. **Reproducible** — Would this naturally happen again in a similar context?
2. **Domain-specific** — Is there a clear category it belongs to (testing, file I/O, API usage, code style, etc.)?
3. **Definable** — Can the correct behavior be stated clearly and generally?

If yes to all three, after completing the fix say something like: *"That looks like a pattern worth capturing — want me to create a skill to prevent it in the future?"*

If the user declines, drop it. Don't offer again for the same pattern in the same conversation.

## Understanding the correction

Before drafting anything, extract from context:

- **What was wrong**: the specific behavior that was incorrect
- **What's correct**: the desired behavior
- **When it applies**: the exact conditions under which this guidance is relevant

If any of these are unclear, ask before proceeding. Be specific — not *"what did you mean?"* but *"Does this apply only when writing tests, or any time assertions appear?"*

## Check existing skills first

Scan `.agents/skills/` for skills that already cover the same domain. Read the `name` and frontmatter `description` of candidates. If a relevant skill exists:

- Propose updating it rather than creating a new one
- Show the user exactly what would change

## Drafting the skill

### Name

Derive from the domain, not the mistake. Use a noun phrase describing the subject area:

- `test-assertions` not `fix-assertion-order`
- `file-naming` not `dont-use-camelcase`
- `api-error-handling` not `always-check-status-codes`

### Description — the most important part

The description determines whether the skill loads at all. It must be:

- **Narrow**: only trigger in the specific context where this guidance applies
- **Concrete**: reference the exact activity, language, framework, or pattern if relevant
- **Non-overlapping**: adjacent-but-different tasks should not trigger it

**Bad**: *"Use when writing code that makes assertions."*

**Good**: *"Use when writing unit tests in TypeScript with Vitest or Jest. Covers assertion parameter order (expected vs actual), async test patterns, and mock setup conventions."*

The description should answer: *"If I'm doing X, should this skill load?"* — and the answer should be no for anything outside the domain.

### Body

Keep it short. Structure:

**When this applies**: one sentence restating the exact context (reinforces the description for clarity mid-task).

**Guidance**: what to do, with a brief example if the behavior is easy to get wrong. Explain *why* it matters — not just a rule, but the reasoning behind it. This helps generalize correctly rather than follow the rule robotically.

**What to avoid**: the specific mistake being corrected, with a counter-example if useful.

## Review before writing

Always show the full draft to the user and ask for confirmation before writing to disk. If they want changes, revise and show again.

Once confirmed, write to `.agents/skills/<name>/SKILL.md`.
