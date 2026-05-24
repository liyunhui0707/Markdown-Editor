# Session import (Stage S1a)

Ports the Claude and Codex CLI session importers from
`Local-Web-Server/tools/import-{claude,codex}.js` into the desktop app as
zero-dependency ESM modules.

## Files

- `import-claude.mjs` — CLI entry + `runClaudeImport()`.
- `import-codex.mjs` — CLI entry + `runCodexImport()`.
- `lib/` — small focused modules: `output-root`, `safe-read`, `atomic-write`,
  `render-utils`, `render-claude`, `render-codex`, `codex-tree`.

## Divergence from upstream

The ports add exactly one line to the YAML frontmatter:

```yaml
agent: "claude-code"     # upstream
source: claude           # added by this port (immediately after agent:)
```

`source: codex` is added for the Codex importer. Everything else (titles,
session ids, paths, mtime, bytes, transcript body) is byte-identical to
upstream output.

## Test seams

`lib/safe-read.mjs` exposes `__testHooks`:

- `getONOFOLLOW()` — return `undefined` to simulate platforms without
  `fs.constants.O_NOFOLLOW`.
- `beforeOpen(path)` — fires immediately before `fs.open(..., O_NOFOLLOW)`.
  The caller's per-session loop has already done its own `lstat` for the
  size pre-check; that lstat is independent of this seam. Used to
  exercise `O_NOFOLLOW` symlink rejection (swap the regular file for a
  symlink in this hook).
- `betweenOpenAndStat(path)` — fires after `fs.open` succeeds but before
  the post-open `realpath` / `stat` pair. Used to exercise the dev/ino
  identity check (swap the regular file for a different regular file in
  this hook).

These seams exist solely for tests and must not be relied on by production
code.

## Maintenance rule

`Local-Web-Server/` is **not** modified by this stage; the upstream is the
source of truth for renderer and security behavior. When upstream changes,
re-port mechanically and regenerate fixtures using the procedure in
`apps/desktop/test/session-import/fixtures/README.md`.
