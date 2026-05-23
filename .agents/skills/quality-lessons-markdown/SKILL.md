---
name: quality-lessons-markdown
description: Markdown-specific code quality lessons for this project. Load this skill when writing or reviewing any Markdown (.md) file to avoid known lint violations. Activate whenever creating new Markdown documents, editing specs, proposals, design docs, or any .md file — even if the user doesn't say "check quality" or "fix linting".
allowed-tools: get_errors read_file replace_string_in_file multi_replace_string_in_file
---

# Code Quality Lessons — Markdown

Accumulated lessons from `code-quality-fix` runs. Consult this before writing or editing any `.md` file to avoid introducing known issues.

The linter in use is **markdownlint**. Rules are enforced across all `.md` files including specs, design docs, proposals, and skill files.

---

## Known Issues and Fixes

### MD041 — First line must be a top-level heading

**Source**: markdownlint
**Severity**: Error
**Trigger**: A Markdown file that starts with a level-2 or lower heading (`##`), or any non-heading content.
**Fix**: The very first line of every `.md` file must be a level-1 heading (`# Title`).

```markdown
<!-- Wrong -->
## Context

<!-- Correct -->
# My Document

## Context
```

---

### MD032 — Lists must be surrounded by blank lines

**Source**: markdownlint
**Severity**: Error
**Trigger**: A list (bullet `-` or ordered `1.`) that is not preceded and/or followed by a blank line.
**Fix**: Add a blank line before the first list item and after the last list item whenever the list is adjacent to non-list content.

```markdown
<!-- Wrong -->
Some text:
- Item one
- Item two
Next paragraph.

<!-- Correct -->
Some text:

- Item one
- Item two

Next paragraph.
```

---

### MD031 — Fenced code blocks must be surrounded by blank lines

**Source**: markdownlint
**Severity**: Error
**Trigger**: A fenced code block (` ``` `) that is not preceded and/or followed by a blank line.
**Fix**: Add a blank line before the opening fence and after the closing fence.

```markdown
<!-- Wrong -->
Some text:
```json
{ "key": "value" }
```
Next paragraph.

<!-- Correct -->
Some text:

```json
{ "key": "value" }
```

Next paragraph.
```

---

### MD040 — Fenced code blocks must specify a language

**Source**: markdownlint
**Severity**: Error
**Trigger**: A fenced code block opened with ` ``` ` (bare, no language tag).
**Fix**: Always add a language identifier immediately after the opening fence. Use `text` or `plaintext` for unformatted content.

```markdown
<!-- Wrong -->
```
some content
```

<!-- Correct -->
```text
some content
```
```

Common language tags: `typescript`, `javascript`, `json`, `yaml`, `bash`, `text`, `plaintext`, `http`.

---

### MD056 — Table column count must be consistent

**Source**: markdownlint
**Severity**: Error
**Trigger**: A table row that has more or fewer cells than the header row defines.
**Fix**: Ensure every row (including the separator row) has exactly the same number of `|`-delimited cells as the header.

```markdown
<!-- Wrong: header has 2 cols, separator has 3 -->
| Risk | Mitigation |
|---|---|---|

<!-- Correct -->
| Risk | Mitigation |
| --- | --- |
| ... | ... |
```

> **Note**: Pipe characters inside backtick spans (e.g., `` `O_CREAT|O_EXCL` ``) are counted as extra column separators by some parsers. Escape or reword to avoid ambiguity.

---

### MD060 — Table column style: spaces around pipe separators

**Source**: markdownlint
**Severity**: Error
**Trigger**: A table separator row using `|---|` without spaces on either side of the dashes. The linter enforces the "compact" style which still requires at least one space between `|` and `-` on both sides.
**Fix**: Use `| --- |` (space-dash-space) style in separator rows, and ensure all data cells have a space after the opening `|` and before the closing `|`.

```markdown
<!-- Wrong -->
|---|---|

<!-- Correct -->
| --- | --- |
```

Full table example:

```markdown
| Column A | Column B |
| --- | --- |
| value | value |
```
