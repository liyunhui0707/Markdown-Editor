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
