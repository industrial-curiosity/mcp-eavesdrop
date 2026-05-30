---
name: opsx-apply
description: Use this skill when implementing tasks from an OpenSpec change. Activate when the user wants to start coding, continue implementation, work through tasks, or resume progress on a change.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.3.1"
---

Implement tasks from an OpenSpec change.

**Input**: Optionally specify a change name. If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

**Steps**

1. **Select the change**

   If a name is provided, use it. Otherwise:
   - Infer from conversation context if the user mentioned a change
   - Auto-select if only one active change exists
   - If ambiguous, run `openspec list --json` to get available changes and use the **AskUserQuestion tool** to let the user select

   Always announce: "Using change: <name>" and how to override (e.g., `/opsx:apply <other>`).

2. **Check status to understand the schema**
   ```bash
   openspec status --change "<name>" --json
   ```
   Parse the JSON to understand:
   - `schemaName`: The workflow being used (e.g., "spec-driven")
   - Which artifact contains the tasks (typically "tasks" for spec-driven, check status for others)

3. **Get apply instructions**

   ```bash
   openspec instructions apply --change "<name>" --json
   ```

   This returns:
   - `contextFiles`: artifact ID -> array of concrete file paths (varies by schema - could be proposal/specs/design/tasks or spec/tests/implementation/docs)
   - Progress (total, complete, remaining)
   - Task list with status
   - Dynamic instruction based on current state

   **Handle states:**
   - If `state: "blocked"` (missing artifacts): show message, suggest using openspec-continue-change
   - If `state: "all_done"`: congratulate, suggest archive
   - Otherwise: proceed to implementation

4. **Read context files**

   Read every file path listed under `contextFiles` from the apply instructions output.
   The files depend on the schema being used:
   - **spec-driven**: proposal, specs, design, tasks
   - Other schemas: follow the contextFiles from CLI output

5. **Reconcile tasks.md with the codebase**

   Before reporting progress, audit any tasks marked `- [ ]` against the actual source files.

   For each unchecked task:
   - Read the relevant source file(s) to determine whether the implementation already exists.
   - **Already implemented, matches description**: mark `[x]` immediately.
   - **Already implemented, but via a different approach**: update the task description to accurately reflect what was actually built, then mark `[x]`. Do not reset — the code is correct; the description was stale.
   - **Partially implemented or unclear**: leave `- [ ]` but note what still needs doing.

   Write a session-memory checkpoint after this pass (e.g., "Sections 1–9 verified complete; N tasks remain") so that if the session is resumed, the reconciliation is not repeated from scratch.

6. **Show current progress**

   Display:
   - Schema being used
   - Progress: "N/M tasks complete"
   - Remaining tasks overview
   - Dynamic instruction from CLI

7. **Clear tasks invalidated by spec or design changes**

   Before implementing, check whether any previously-completed tasks need to be re-done:
   - Review the current specs and design against tasks marked `[x]`
   - **Clearing criterion (code-centric):** A `[x]` task is cleared only if the *code it produced* must be changed or deleted because a requirement was added, modified, or removed in a way that makes the existing code incorrect. A task is **not** cleared just because its description wording no longer matches the spec verbatim, or because the approach taken differed from what the spec described.
   - If the task description is stale but the code is still correct: update the description to match the code and leave it `[x]`.
   - Announce which tasks were cleared and the reason before proceeding.

   Only clear tasks when there is a concrete, traceable reason (e.g., a requirement was added, modified, or removed that directly affects the correctness of the completed work). Do not speculatively clear tasks.

8. **Implement tasks (loop until done or blocked)**

   For each pending task:
   - Show which task is being worked on
   - Make the code changes required
   - Keep changes minimal and focused
   - If the implementation approach diverges from the task's literal description but still satisfies the intent, update the task description to match before marking it done
   - **Write the checkbox to `tasks.md` immediately** using a file edit tool: `- [ ]` → `- [x]`. The `manage_todo_list` conversation tool is supplemental session tracking only — it does not replace the persistent record in `tasks.md`. Do not batch or defer checkbox writes to end-of-session.
   - Continue to next task

   **Pause if:**
   - Task is unclear → ask for clarification
   - Implementation reveals a design issue → suggest updating artifacts
   - Error or blocker encountered → report and wait for guidance
   - User interrupts

9. **Hygiene (enforced on every task)**

   Before marking a task `[x]`, run the `hygienist` skill with the context of what this task changed:
   - What interfaces, constants, paths, or protocols were modified (for staleness checks)
   - Whether any test scripts were added or changed (for testing docs)
   - Whether user-facing or architectural behavior changed (for project docs)

   The hygienist will run all applicable checks and report what was updated. Do not mark the task complete until the hygiene report is clean.

10. **On completion or pause, show status**

   Display:
   - Tasks completed this session
   - Overall progress: "N/M tasks complete"
   - If all done: suggest archive
   - If paused: explain why and wait for guidance

**Output During Implementation**

```
## Implementing: <change-name> (schema: <schema-name>)

Working on task 3/7: <task description>
[...implementation happening...]
✓ Task complete

Working on task 4/7: <task description>
[...implementation happening...]
✓ Task complete
```

**Output On Completion**

```
## Implementation Complete

**Change:** <change-name>
**Schema:** <schema-name>
**Progress:** 7/7 tasks complete ✓

### Completed This Session
- [x] Task 1
- [x] Task 2
...

All tasks complete! Ready to archive this change.
```

**Output On Pause (Issue Encountered)**

```
## Implementation Paused

**Change:** <change-name>
**Schema:** <schema-name>
**Progress:** 4/7 tasks complete

### Issue Encountered
<description of the issue>

**Options:**
1. <option 1>
2. <option 2>
3. Other approach

What would you like to do?
```

**Guardrails**
- Keep going through tasks until done or blocked
- Always read context files before starting (from the apply instructions output)
- If task is ambiguous, pause and ask before implementing
- If implementation reveals issues, pause and suggest artifact updates
- Keep code changes minimal and scoped to each task
- Update task checkbox immediately after completing each task
- Test tasks are not complete until testing instructions in the project docs are added or updated
- README and architecture docs (`docs/spec.md`) must be updated before the final task is marked complete if any user-facing or architectural change was made
- Pause on errors, blockers, or unclear requirements - don't guess
- Use contextFiles from CLI output, don't assume specific file names

**Fluid Workflow Integration**

This skill supports the "actions on a change" model:

- **Can be invoked anytime**: Before all artifacts are done (if tasks exist), after partial implementation, interleaved with other actions
- **Allows artifact updates**: If implementation reveals design issues, suggest updating artifacts - not phase-locked, work fluidly
