# Electron save/reopen smoke test

This is one opt-in regression test, not a full native acceptance suite. It runs
the current desktop source and existing renderer bundles in Electron, using
Playwright Test. It does not test the packaged release artifact.

## Run

Use the project's pinned Node version (`mise install` if needed), installed npm
dependencies, and the matching Electron runtime. A graphical desktop session is
required. From `apps/desktop`:

```bash
mise exec -- npm run test:e2e
mise exec -- npm run test:e2e -- --repeat-each=3
```

No Playwright browser download, Computer Use plugin, or paid service is needed.
Playwright uses Electron's own Chromium. If dependencies were installed with
lifecycle scripts disabled, Electron's executable may be absent. The test fails
with a setup error rather than downloading it automatically. Either provision
the locked Electron runtime through the project's normal setup, or point to an
existing executable of the same version:

```bash
E2E_ELECTRON_EXECUTABLE=/absolute/path/to/Electron.app/Contents/MacOS/Electron mise exec -- npm run test:e2e
```

The test verifies the running Electron version against the installed package.
Rebuild the appropriate renderer bundle before testing changes to its source;
otherwise the test exercises the existing bundle. This command is separate from
`test:ci`; it has not been added to the hosted CI workflow. The initial verified
platform is macOS arm64; other platforms are not yet validated.

## What passes mean

The test selects a synthetic vault, opens a note in Tiptap Write mode, types a
unique ASCII marker through renderer key events, and verifies dirty state and
unchanged disk contents before saving. It clicks **Save Note**, checks the Saved
status, and compares the entire saved file with the expected Markdown. It also
checks that another synthetic note was untouched.

It then closes Electron, launches a new process with a fresh profile, selects
the same synthetic vault again, and verifies the persisted text and clean state.
The second launch cannot rely on the first launch's draft/profile storage.

Only the operating-system folder picker is stubbed to return the test vault.
The renderer, preload, load/save IPC, and filesystem writes are real. The engine
is selected using the existing localStorage setting. No production test hooks
are added.

## Isolation and evidence

Each run creates a `markdown-vault-e2e-*` directory under the OS temporary
directory, containing two synthetic notes and separate `profile-edit` and
`profile-reopen` directories. User/session/crash paths are isolated before the
real main module loads. The child receives only an allowlist of OS environment
variables, and renderer HTTP(S) requests are blocked. No real vault is selected
and no running user editor is attached to or closed.

Traces, a failure screenshot when available, and bounded diagnostic logs are
written under `apps/desktop/test-results/electron-e2e/`. The test output includes
the temporary workspace path. Results are git-ignored, and both `e2e/` and
`test-results/` are excluded from release packaging. Results for a given output
directory are replaced on subsequent runs; synthetic workspaces are retained
for diagnosis and are not automatically deleted.

On failure, teardown terminates only the test-owned Electron process so an
unsaved-note dialog cannot keep it running.

## Coverage limits

This test does not certify Chinese IME composition, native menu/shortcut routing,
the real folder picker, cross-note undo isolation, or release packaging. Keep
the existing native acceptance checklist for those behaviors. In particular,
typing or pasting Chinese characters through automation is not evidence of real
IME composition. Expand this suite only for a concrete regression risk, not to
replace every manual check at once.
