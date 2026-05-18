# Project Rules

## Core workflow
- Use small, reviewable changes.
- Do not refactor unrelated files during bug fixes.
- Prefer TDD for bug fixes.
- Before committing, run tests and inspect git diff.

## Code size
- Try to keep files under about 300 lines.
- If a file exceeds 300 lines, explain whether it should be split.
- Test files (`**/*.test.js`) have a higher practical cap of ~800–1200 lines: a single test file commonly packs unit + integration + invariant + perf coverage with helper scaffolding, and splitting often balloons stage scope. Stage 25 (`link-click.test.js`, 1170 lines) and Stage 26 (`cm6-active-range.test.js`, ~600 lines) ship over the 300-line guideline with documented rationale; this is allowed for test files but each stage should still note the size in its stage-history row.

## Markdown editor
- Pay special attention to Markdown shortcuts, cursor behavior, undo/redo, Chinese IME input, and long documents.

## Documentation
- When user-facing behavior changes, update docs.

## AI workflow
- Claude may implement.
- Codex should audit important diffs.
- Human makes final decisions.
