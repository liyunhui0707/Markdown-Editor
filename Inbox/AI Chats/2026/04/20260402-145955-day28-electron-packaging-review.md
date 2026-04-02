# Day 28 — Electron Packaging Setup Review

**Date:** 2026-04-02
**Scope:** `apps/desktop` — local macOS artifact, no signing or notarization

---

## 1. What is correct

- **`appId` is set** — `com.markdownvault.desktop` is valid and correctly formatted
- **`electron` in `devDependencies`** — correct; electron-builder expects this
- **`marked` in `dependencies`** — correct; it gets bundled into the app
- **`main.js` entry point** — matches `"main": "main.js"` in package.json
- **Security defaults in `main.js`** — `contextIsolation: true`, `nodeIntegration: false` are the right settings
- **`pack` script** — `electron-builder --dir` is exactly right for local artifact testing (no zip, just the `.app`)
- **`entitlements.mac.plist` exists** — the two JIT entitlements are appropriate for Electron's V8 engine

---

## 2. What is risky

**No `files` array in `"build"` config**
electron-builder will auto-detect what to bundle. It works most of the time, but can silently include things you don't want (e.g. `.env`, scratch files) or miss things you do want. For a beginner setup this is the biggest silent risk.

**Team ID mismatch after every fresh build**
The downloaded Electron Framework is Apple-signed, the app is ad-hoc. You need to run `codesign --force --deep --sign -` manually after each clean build. This will happen every time you delete `dist/` and rebuild.

**`author` field is empty**
Won't break the build, but electron-builder uses it to populate the `.app` metadata. Some macOS dialogs show "Unknown developer" partly because of this.

**`entitlementsInherit` set, but `entitlements` is not**
`entitlementsInherit` applies to child processes (helpers). The main app process has no entitlements file set. With no real signing cert this doesn't matter, but it's an incomplete pair.

**`electron: ^37.0.0` is very new**
Electron 37 is recent. If you hit a bug, there's less community Q&A to reference. Not dangerous, just worth knowing.

---

## 3. Smallest fix if packaging fails

**Failure: app launches with dyld Team ID error**
```bash
codesign --force --deep --sign - dist/mac-arm64/markdown-vault-desktop.app
```

**Failure: files missing at runtime** (e.g. `preload.js not found`)
Add an explicit `files` array to the `"build"` section in `package.json`:
```json
"files": [
  "main.js",
  "preload.js",
  "index.html",
  "package.json"
]
```
`node_modules` for production deps (`marked`) is included automatically.

---

**Bottom line:** The setup is solid for local-only use. The one thing worth adding is the explicit `files` array — it prevents a whole class of silent packaging bugs.
