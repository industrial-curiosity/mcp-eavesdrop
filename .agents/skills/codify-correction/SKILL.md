---
name: codify-correction
description: Use this skill when a user corrects an agent behavior and wants to prevent it from recurring. Activate when the user says things like "don't do that again", "remember this", "make a skill for that", "add that to your instructions", or "next time do X instead". Also activate for quality-standard statements that establish a general rule — e.g. "tests should always be robust", "scripts should always log X", "errors should always include Y". Also activate proactively — after completing a corrected task, offer to codify the fix if the mistake looks like a reproducible pattern and not a one-off misunderstanding. Do NOT activate for corrections to factual errors, ambiguous requests, or context-specific one-offs that won't recur.
---

# Codify Correction

When a user corrects a behavior, create or update a skill to prevent it from recurring.

## When to activate (proactive case)

Offer to codify a correction only if the mistake is **reproducible** in similar contexts, belongs to a **clear domain**, and the correct behavior can be **stated generally**. If the user declines, drop it.

## Before drafting

Extract three things: what was wrong, what's correct, and when it applies. If any are unclear, ask first. Then check `.agents/skills/` for an existing skill covering the same domain — prefer updating over creating.

## Drafting

Name the skill after the **domain**, not the mistake (e.g. `test-assertions`, not `fix-assertion-order`). The description is the most important part — it determines when the skill loads. Make it specific enough that it only triggers in the relevant context, but general enough to cover the full domain. The body should state what to do, briefly explain why, and note what to avoid.

## Audit related skills

After drafting, scan all existing skills in `.agents/skills/` to check for overlap:

- If an existing skill covers part of the same domain, move the overlapping content into the new skill and replace it with a cross-reference (e.g., "See `test-writing` for assertion and environment conventions").
- If the new skill's domain is a sub-domain of an existing skill, update the existing skill's description to exclude the sub-domain so both skills trigger correctly.
- If no overlap exists, state that explicitly.

Include a summary of any related-skill changes in the review draft.

## Review before writing

Always show the full draft (new skill + any related-skill changes) and get confirmation before writing anything. Revise if needed.

Before presenting the draft, self-check for the four common skill quality pitfalls (defined in `skill-creator` under "Common Skill Quality Pitfalls"):

1. **Inconsistent file scope** — does the description's activation scope exactly match the body's file-scope statement? If not, align them and make out-of-scope exclusions explicit.
2. **Persona conflict** — does the description say "activate automatically" while the body says "consult this reference"? Pick one mode (active or passive) and apply it consistently throughout.
3. **External references without inline fallback** — if the draft points to another skill or file for critical rules, does it also summarize those rules inline? Add a one-line inline summary for any critical rule sourced from an external file.
4. **Overlapping rules with no tiebreaker** — if two rules in the draft could apply to the same code (e.g., different routing logic for shared vs. context-specific code), add an explicit tiebreaker rule.
