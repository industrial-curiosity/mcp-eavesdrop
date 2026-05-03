# Working with openspec

## Initialization

See [openspec concepts](https://github.com/Fission-AI/OpenSpec/blob/main/docs/concepts.md)

```sh
❯ openspec schema init research-first
Note: Schema commands are experimental and may change.
✔ Schema description: research -> propose -> tasks
✔ Select artifacts to include: proposal, specs, design, tasks
✔ Set as project default schema? Yes
✔ Created schema 'research-first'

Schema created at: /Users/adamfisher/dev/myai-extension/openspec/schemas/research-first

Artifacts: proposal, specs, design, tasks

Set as project default schema.

Next steps:
  1. Edit /Users/adamfisher/dev/myai-extension/openspec/schemas/research-first/schema.yaml to customize artifacts
  2. Modify templates in the schema directory
  3. Use with: openspec new --schema research-first
```

## Updating Tasks

how do i update the openspec tasks to reflect the current state of the project? you shouldn't be updating anything. if something was missed, your spec artifacts need to be updated and then you can regenerate the tasks. the tasks are generated from the spec artifacts, so if the spec is accurate, the tasks will be accurate. if you find something missing in the tasks, you need to update the spec artifacts and then regenerate the tasks.

but what if there are nuanced outputs from the tasks that require manual editing?

according to gemini, /openspec-archive-change might synch with the current state of the project, but it doesn't. it's a static snapshot of the change at the time it was created. if you need to update the tasks, you need to update the spec artifacts and then regenerate the tasks. if there are nuanced outputs that require manual editing, you can edit the tasks after they are generated, but you should also update the spec artifacts to reflect those nuances so that future generations of tasks will include them.
