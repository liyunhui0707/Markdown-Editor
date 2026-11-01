# Local development environment

## Project recovery audit

Read the [2026-10-22 recovery audit](docs/audits/2026-10-22-project-recovery-audit.md)
before resuming product work. It records the current Vault-based implementation,
confirmed file-safety issues, verification evidence, and a proposed document-first
direction. Technical implementation remains subject to approval; September pilot
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

Persistent-copy tests still create fresh directories directly under Home to exercise
that real destination-policy boundary. The successful cases in
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

Use a private `TMPDIR` and output directory when running focused tests. Negative
Home-fixture tests still require deliberate evidence retention; a passing suite
is not permission to delete their output or historical evidence.
