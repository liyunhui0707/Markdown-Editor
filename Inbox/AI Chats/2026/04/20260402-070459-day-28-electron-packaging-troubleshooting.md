---
source: "codex"
created_at: "2026-04-02T07:04:59.359Z"
model: "gpt-5"
tags: ["chat", "imported", "packaging", "electron", "day28"]
---

# Day 28 Electron Packaging Troubleshooting

Goal:
- `npm run pack`
- `npm run dist:mac`
- local macOS artifact only
- no signing, no notarization

Findings:
1. No blocking missing files. The desktop package references `build/entitlements.mac.plist`, and that file exists.
2. No blocking missing dependencies. `apps/desktop` has `electron`, `electron-builder`, and `marked` installed, and electron-builder completed both local build paths.
3. The only bad build setting for this goal was signing behavior. Before the fix, electron-builder fell back to ad-hoc mac signing. For local-only artifacts with no signing and no notarization, that was too loose.
4. The initial `pack` failure was not a real Day 28 config break. It happened because `pack` and `dist:mac` were run in parallel and both wrote into the same `apps/desktop/dist/mac-arm64` output.

Smallest safe fix:
- Set `CSC_IDENTITY_AUTO_DISCOVERY=false` on `pack` and `dist:mac`.
- Set `build.mac.identity` to `null` in `apps/desktop/package.json`.

Verification:
- `npm run pack`: passed
- `npm run dist:mac`: passed
- Electron-builder output now says `skipped macOS code signing` and does not notarize.

Artifacts:
- `.app`: `apps/desktop/dist/mac-arm64/markdown-vault-desktop.app`
- `.zip`: `apps/desktop/dist/markdown-vault-desktop-0.1.0-arm64-mac.zip`

Residual risk:
- No custom mac icon is configured, so electron-builder uses the default Electron icon. This is cosmetic only and not a Day 28 packaging blocker.
