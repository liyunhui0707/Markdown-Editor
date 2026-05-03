# CM6 Spike — Stage 3 (throwaway)

Isolated CodeMirror 6 prototype. **Does not modify or replace** the production
Write mode, Preview, or save/load. Lives entirely in:

- `apps/desktop/spike/codemirror6/spike.html`         — spike UI page
- `apps/desktop/spike/codemirror6/spike-main.js`      — isolated Electron entry
- `apps/desktop/spike/codemirror6/README.md`          — this file
- `apps/desktop/lib/spike-cm6-entry.js`               — esbuild entry
- `apps/desktop/lib/spike-cm6-bundle.js`              — built IIFE bundle (generated)
- `apps/desktop/test/spike-cm6/round-trip.test.js`    — Node test
- `docs/stage3-spike-codemirror6.md`                  — measurement record

## Run

```bash
cd apps/desktop
npm install                # picks up the new @codemirror/* deps
npm run build:spike-cm6    # produces lib/spike-cm6-bundle.js
npm run spike:cm6          # boots an isolated Electron window on spike.html
```

The spike opens its own window. Quitting it does not affect the main app.

## What to measure

Follow `docs/stage3-spike-codemirror6.md`. The spike UI has buttons for
the automated checks (round-trip, stress, keystroke latency) and an editor
surface for the manual checks (cross-block selection, undo across blocks,
IME composition, `Cmd+A` flow).

## Throwaway

Branch: `stage3-spike-codemirror6`. If we abandon CM6, delete the branch and
the spike vanishes — `main` is untouched.
