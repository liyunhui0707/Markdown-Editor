# Local development environment

## Project recovery audit

Read the [2026-10-22 recovery audit](docs/audits/2026-10-22-project-recovery-audit.md)
for the historical Vault baseline. It records that implementation,
confirmed file-safety issues, verification evidence, and the reason for the subsequent document-first
direction. The current default is the Document app; see README and AGENTS.md. Technical implementation remains subject to approval; September pilot
acceptance records are historical evidence, not current release sign-off.

## Node and verification

The repository pins Node 24.20.0 for development with mise. From the root:

```sh
mise trust ./mise.toml
mise install
cd apps/desktop
mise exec -- node --version
mise exec -- npm run test:ci
```

Use `mise exec --` before other approved npm commands. The root pin is inherited
from `apps/desktop`; shell activation and a global Node default are not required.
Electron retains its own bundled runtime; this pin does not change it.

Existing dependencies, lockfiles, product versions, generated bundles and local
feature changes were preserved. For a fresh checkout use `mise exec -- npm ci`
from `apps/desktop` after reviewing the lockfile. It replaces `node_modules`;
do not use it as a routine test command in an active working copy.

Environment verification runs the synthetic test suite, not private vault data.
It does not rebuild editor bundles, package the application, or replace manual
editor/IME QA. Review AGENTS.md and command side effects before build or release
work, especially commands that remove and regenerate output directories.

## Synthetic Home fixtures

Persistent-copy tests exercise the real Home destination boundary inside one fresh
Home container per test process; nested cases stay inside that container. The successful cases in
`test/document-persistent-copy.test.js` and `e2e/document-p1-regressions.spec.cjs`
use `test/helpers/home-fixture.cjs` to reclaim only fixtures created by that test.
Cleanup runs after all assertions and writer/reader processes have completed;
Electron cases also require confirmed application exit. It verifies the recorded
file identities, expected bytes/SHA-256, permissions and exact directory entries,
then moves the fixture into a private temporary quarantine before removing only
the recorded regular files and empty directories. Cleanup outcomes are logged.

Failed, partial, uncertain and deliberate race/rejection cases retain their
fixtures even when an expected rejection makes the test pass. Changed files,
symlinks, hardlinks or unexpected entries prevent cleanup; a cleanup failure
reports the retained location (which may be the quarantine). There is no Home
sweep, recursive deletion, or adoption of archived/manual fixtures. This helper
assumes legitimate test processes are finished; it is not protection against a
hostile same-user process. Unit regressions keep their synthetic failure evidence
under the test run's temporary directory, not Home.

For cleanup-only regressions, run from `apps/desktop`:

```sh
mise exec -- node --test test/home-fixture-cleanup.test.js
```

Use a private `TMPDIR` and output directory when running focused tests. A passing
suite is not permission to delete negative output or historical evidence.
`test/helpers/save-folder-fixture.cjs` wraps the existing ownership helper for
nested saves. After all writer processes close, it moves its own fresh container
intact to the run evidence folder, records identities, content hashes, symlink
text and restore mapping, and verifies the move. Success-only reclamation still
uses `home-fixture.cjs`; failures, partial writes and race pairs are preserved.
Set `MARKDOWN_TEST_EVIDENCE_ROOT` to the run's existing private `.local/verification/`
folder for Node tests; the new Electron test uses its Playwright output folder.
Without an override the evidence goes to a unique OS temporary directory.

Prefer this container for new save tests. Keep only explicit Home-boundary tests
at the top level; do not add a Home sweep or adopt older/manual fixtures. If a
process has not exited, identity differs, archive storage is on another device,
or a move/check fails, retain the location and report it. Before handing back a
batch, account for each fixture created by that batch: reclaimed, archived, or
explicitly blocked. Abrupt process/machine termination can still leave a container;
do not infer it is safe to delete from its name alone.

## Local Document application

`npm run dev` starts `document-app-main.js`; `npm run dev:legacy` explicitly starts
the historical Vault app. `npm run pack` / `pack:document` use the dedicated
`electron-builder.document.cjs` config, never the legacy package build manifest.
The artifact is an unsigned, unnotarized local WIP named `Markdown.app`.
Production dependencies are still shared with historical source; pruning them is
separate work. The Vault/CM6/spike runtime and private/test/tool trees are excluded.

For an offline build using the already installed Electron, from `apps/desktop`:

```sh
mise exec -- node node_modules/electron-builder/out/cli/cli.js \
  --config electron-builder.document.cjs --mac dir --arm64 \
  --config.electronDist="$PWD/node_modules/electron/dist" \
  --config.directories.output=/private/tmp/markdown-document-build-UNIQUE
```

Choose a fresh output path. Validate ASAR membership and source hashes before
installing to `~/Applications/Markdown.app`; never overwrite an unknown app.
Normal launch uses a stable `Markdown Vault Document` profile and single-instance
lock. Existing backups remain at `Markdown Vault Document Drafts`. At startup,
main creates a private temporary safe-create directory and establishes cwd once,
before Service/window/IPC creation, preserving the existing cwd-bound grant.
No renderer target paths or packaged test overrides are accepted. Per-run scratch
and failed evidence remain in OS temporary storage; there is no Home-wide cleanup.

The packaged regression requires an explicit built executable:

```sh
DOCUMENT_APP_EXECUTABLE=/absolute/path/Markdown.app/Contents/MacOS/Markdown \
  mise exec -- node node_modules/@playwright/test/cli.js test \
  --config=e2e/playwright.config.cjs document-app.spec.cjs
```

It uses only a synthetic original/export/draft; native dialog choices are stubbed.
It archives only its new synthetic draft via the app, then reclaims its verified
successful Home fixture. It does not prove native IME or native Finder UI behavior.
The icon is reproducible from `tools/build-document-icon.swift` (AppKit), resized
to macOS iconset sizes with `sips`, then assembled with `iconutil`; `build/document.icns`
is tracked. No signing credentials or system security changes are required.
