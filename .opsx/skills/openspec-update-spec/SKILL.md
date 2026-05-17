---
name: openspec-update-spec
description: Update a spec's artifacts in accordance with OpenSpec principles. Use when the user wants to add, modify, or remove requirements and scenarios in an existing spec.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.3.1"
---

Update a spec's artifacts (requirements and scenarios) following OpenSpec principles.

**Input**: Optionally specify a spec name (e.g., `agent-monitor-panel`) and a description of the changes to make. If omitted, check if they can be inferred from conversation context.

**Steps**

1. **Identify the target spec**

   If a spec name is provided, use it. Otherwise:
   - Infer from conversation context (e.g., user is discussing a specific capability)
   - List available specs from `openspec/specs/` to present options

   Use the **AskUserQuestion tool** if ambiguous.

   Always announce: "Updating spec: <spec-name>"

2. **Understand what changes are needed**

   If the user has described the changes, proceed. Otherwise use the **AskUserQuestion tool** to ask:
   > "What changes do you want to make to this spec? Describe new requirements, modifications, or removals."

   Clarify:
   - Are these new requirements (ADDED), changes to existing ones (MODIFIED), or removals (REMOVED)?
   - Is there an active change this is associated with?

3. **Determine where to write changes**

   Check for an active change context:
   ```bash
   openspec list --json
   ```

   - **If an active change exists** that relates to this spec: offer to write the update as a delta spec at `openspec/changes/<name>/specs/<spec-name>/spec.md`
   - **If updating the main spec directly**: write to `openspec/specs/<spec-name>/spec.md`

   Use the **AskUserQuestion tool** to confirm the target if multiple active changes exist or if the intent is ambiguous.

4. **Read the current spec**

   Read the target spec file to understand existing requirements before making changes.

   Also read the delta spec (if it exists at `openspec/changes/<name>/specs/<spec-name>/spec.md`) to understand what has already been specified for the active change.

5. **Apply changes following OpenSpec principles**

   **Spec format rules:**

   - Group changes under section headers: `## ADDED Requirements`, `## MODIFIED Requirements`, `## REMOVED Requirements`
   - Each requirement follows the pattern:
     ```
     ### Requirement: <title>
     The <subject> SHALL <behavior>.

     #### Scenario: <scenario title>
     - **GIVEN** <precondition> *(optional)*
     - **WHEN** <trigger>
     - **THEN** the <subject> SHALL <outcome>
     ```
   - Use **SHALL** (not "should", "must", or "will") for normative statements
   - Use **BDD-style GIVEN/WHEN/THEN** for all scenarios
   - Keep requirements atomic — one observable behavior per requirement
   - Scenarios must be concrete and testable — avoid vague language like "works correctly"
   - For security-sensitive requirements, add a dedicated scenario covering the attack vector

   **Change type rules:**
   - **ADDED**: New requirements that did not previously exist
   - **MODIFIED**: Changes to wording, scope, or scenarios of an existing requirement — include the full updated requirement text
   - **REMOVED**: Requirements that are being dropped — include just the heading and a brief rationale

   **Delta spec rules (when writing to a change):**
   - Only include the delta — do not duplicate requirements from the main spec that are unchanged
   - Preserve the change section headers (`## ADDED`, `## MODIFIED`, `## REMOVED`) to make diffs clear
   - If the delta spec already exists, merge new changes into the existing sections rather than replacing them

   **Main spec rules (when updating directly):**
   - Remove section headers (`## ADDED`, etc.) — main specs contain the full canonical set of requirements
   - Integrate additions, apply modifications in place, and remove deleted requirements
   - Maintain alphabetical or logical ordering of requirements

6. **Write the updated spec**

   Write the updated content to the target file. Show a brief summary of what changed:
   ```
   ## Spec Updated: <spec-name>

   - ADDED: <N> requirement(s) — <brief titles>
   - MODIFIED: <N> requirement(s) — <brief titles>
   - REMOVED: <N> requirement(s) — <brief titles>
   ```

6a. **Update README and architecture docs**

   After writing the spec, review whether the changes have any impact on the project's high-level documentation:

   - **`README.md`**: Update if the spec change affects user-visible behavior, features, commands, configuration, or the extension's described purpose.
   - **`docs/spec.md`** (architecture doc): Update if the spec change affects component responsibilities, project structure, data flow, or inter-component interfaces.

   If neither file needs updating (e.g., the spec change is purely internal or refinement of existing behavior), briefly state why no update was needed.

7. **Update all affected change artifacts**

   If the spec is associated with an active change, **always** perform the following without waiting to be asked:

   **tasks.md (required):**
   - Read the change's tasks file at `openspec/changes/<name>/tasks.md`
   - **Clear invalidated tasks:** identify completed tasks (`- [x]`) whose implementation is directly invalidated by the spec changes (e.g., a requirement was modified or removed that affects previously completed work); uncheck those tasks (`- [x]` → `- [ ]`) and note why
   - **Add gap tasks:** identify any new or modified requirements that have no corresponding task; append concise `- [ ]` task entries under the appropriate section (or a new section if needed) so the change stays implementable
   - Announce all tasks cleared and all tasks added

   **design.md (required):**
   - Read `openspec/changes/<name>/design.md`
   - Identify any decisions or context that contradict or are invalidated by the spec changes
   - Announce any gaps or conflicts found; if none, state that design.md remains consistent

**Output On Success**

```
## Spec Updated: <spec-name>
**Target:** openspec/[changes/<change-name>/]specs/<spec-name>/spec.md

- ADDED N requirement(s): <titles>
- MODIFIED N requirement(s): <titles>
- REMOVED N requirement(s): <titles>

[If delta]: Ready to sync to main spec when the change is archived.
[If main]: Main spec updated directly.
```

**OpenSpec Principles Reference**

| Principle | Rule |
|-----------|------|
| Normative language | Use SHALL for requirements, not should/must/will |
| Testability | Every scenario must be concrete and independently verifiable |
| Atomicity | One observable behavior per requirement |
| BDD format | GIVEN (optional) / WHEN / THEN for all scenarios |
| Security | Explicit scenarios for any security-sensitive behavior |
| Delta clarity | Changes-in-progress live in delta specs; main spec is always canonical |
