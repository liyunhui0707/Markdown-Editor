# Rendering Policy

## Purpose

This document records the canonical rendering architecture decision accepted
in Stage 20. It governs what rendering primitives the Write engine may use,
what primitives it must not use, what gates a future interactive feature
must clear before it ships, and what product questions must be answered
before any spike begins.

The policy is **neutral**: it defines the path by which a feature could be
approved, not the feature itself. No task-toggle, link-click, math, image,
or preview feature is pre-approved by this document.

Owner: the project maintainer. Substantive changes require a new stage that
explicitly amends this file.

## Canonical decision (Stage 20)

The Write engine is `hybrid-cm6` (CodeMirror 6 + a live-styling decoration
walker over the Lezer parse tree). The decision in Stage 20 was to choose
between three rendering directions:

- **Option A — visual-only baseline.** Continue using `Decoration.mark` for
  styling only. No widgets, no replacement decorations, no DOM event
  handlers wired into the walker, no HTML generation, no image/network
  loading. Raw Markdown remains the source of truth.

- **Option B — narrow gated interactivity.** Allow a small number of
  carefully-scoped interactive features (such as task-checkbox toggling or
  Cmd-click link opening) **only** by adding separate named CodeMirror
  extensions, never by widening the walker. Every Option B candidate must
  clear every gate in this document before any production work begins.

- **Option C — generated-HTML rendering or widget replacement.** Replace
  Markdown markers with widgets or generated HTML in Write mode (image
  thumbnails, math glyphs, embedded preview cards, plugin-rendered nodes,
  etc.).

The accepted direction is: **continue Option A as the baseline, allow only
narrow Option B paths under the gates below, and reject Option C.**

Option C is rejected, not deferred. Any future proposal that fits Option C
requires an explicit amendment to this document and is not unblocked simply
by passing the Option B gates.

## Allowed rendering primitives

The Write engine may use exactly these primitives:

- `Decoration.mark` — pure visual styling over a document range. It cannot
  mutate the document, cannot insert content, and cannot intercept events
  by itself. This is the only primitive used by the current walker in
  `apps/desktop/lib/cm6-hybrid-view.js`.

- A **separate named CodeMirror extension file** (e.g., a new module under
  `apps/desktop/lib/cm6-*.js`) that installs its own EditorView event
  handlers or commands. Such a file is allowed only after an approved
  design spike that clears every Option B gate below. The walker file
  itself remains visual-only; a minimal reviewed integration hook in the
  walker's extensions array is allowed only if the spike proves it
  necessary.

No other rendering primitive is allowed in the Write path without a new
stage that amends this document.

## Prohibited rendering primitives

The following primitives are prohibited in the Write path. The prohibitions
are pinned by existing automated tests so future contributors cannot
silently regress them.

- `Decoration.widget` anywhere in the Write path.
- `Decoration.replace` anywhere in the Write path.
- Direct DOM event handlers attached inside the walker (`addEventListener`
  on decoration ranges, inline `onclick` attributes, etc.).
- Generated HTML in the Write adapter's `getText()` output.
- Loading images in Write mode (local file paths or remote URLs).
- Renderer-side network fetch/loading from Write mode (no `fetch`,
  `XMLHttpRequest`, WebSocket, image/script/stylesheet auto-loading, or
  similar in-renderer network calls). This is separate from — and does
  not forbid — the user-initiated external URL opening path described in
  gate 5 below, which is mediated through preload/main IPC and never
  performed by the renderer directly.
- Math glyph rendering anywhere. Math is not rendered today; if math
  support is ever added it must live in Preview only and requires an
  explicit policy amendment.
- Direct `shell.openExternal` from renderer code.
- Heavy dependencies (KaTeX, MathJax, image-fetch policy module, HTML
  sanitizer, plugin loader) added without an explicit amendment.

### Section H token set (cm6-hybrid-view.js source-file invariants)

`apps/desktop/test/cm6-write-view/hybrid-cm6-readiness.test.js` Section H
(line 265+) asserts that `apps/desktop/lib/cm6-hybrid-view.js` contains
**none** of these substrings:

- `Decoration.replace`
- `WidgetType`
- `HeadingWidget`
- `ParagraphWidget`
- `<a`
- `href`
- `addEventListener('click'`
- `addEventListener("click"`
- `onclick` (as a property or handler assignment, via the regex
  `/onclick\s*[:=]/`)

Any change to the walker file that introduces one of these tokens will fail
the Section H test.

### Stage 16-10 token set (getText() output invariants)

`apps/desktop/test/cm6-write-view/cross-engine-smoke.test.js` Stage 16-10
(line 318+) asserts that the `getText()` output of both `createCm6WriteView`
and `createCm6HybridView` contains **none** of these substrings when fed
the Stage-14-rich fixture:

- `<a`
- `href`
- `<img`
- `<div`
- `innerHTML`
- `document.write`
- `eval(`
- `</`

Any change that lets generated HTML escape into Write-mode `getText()` will
fail Stage 16-10.

## Option B gates

Every Option B candidate feature (task-checkbox toggle, Cmd-click link
open, any other future interactive Write-mode behavior) must clear **all
seven gates below** before any production stage begins. Each gate is a
hard requirement; none may be waived without an explicit amendment.

### 1. Source-of-truth gate

The interactive feature must change the underlying document via a real
CodeMirror transaction (`view.dispatch(...)`). It must not mutate DOM-only
state, must not desynchronize the visible text from the saved Markdown,
and must not bypass the dirty-state and save pipeline.

### 2. Test gates

A new test file must prove, at minimum:

- The interaction dispatches a real CodeMirror transaction (the document
  actually changes when expected).
- `onChange` fires (so the renderer's dirty/save plumbing sees the change).
- The dirty-state badge updates correctly.
- Undo and redo work on the change.
- The save payload after the change is character-identical to the visible
  document (no synthesized HTML, no normalization side effects).
- A non-target interaction (e.g., clicking inside a paragraph, not on the
  feature target) is a no-op: no document change, no dirty-state flip, no
  selection surprise.
- Caret and selection behavior around the targeted range is acceptable.
- The interaction is suppressed during IME composition (see the
  IME / caret / selection safeguards section below).
- A keyboard-parity path exists, or a documented reason explains its
  absence (see gate 6).

### 3. Extension-wiring gate

The interactive logic must live in a **separate named extension file**
(e.g., `apps/desktop/lib/cm6-task-toggle.js`,
`apps/desktop/lib/cm6-link-click.js`). The walker file `cm6-hybrid-view.js`
keeps its visual-only role. A minimal reviewed integration hook (typically
one or two lines that append the new extension to the walker's extensions
array) is allowed only if the spike proves it is necessary.

### 4. Section H exception gate

If the new extension legitimately needs a token that Section H currently
forbids — for example, a click-handler registration on a non-walker file —
the test contract must be amended with a **named, narrow exception** that
still excludes the walker file and still rejects unnamed click handlers.
The exception must be reviewable; a bare relaxation of Section H is not
acceptable.

### 5. Security gates

For features that produce an external side effect (opening a URL, opening
a file, etc.):

- The side effect must be mediated through the existing preload/main IPC
  bridge. The renderer code must never call `shell.openExternal` (or any
  equivalent privileged API) directly.
- URL parsing and validation must live outside renderer DOM event code so
  the renderer cannot be tricked by markup-driven input. The validation
  rules are:
  - Case-insensitive scheme matching.
  - Reject inputs containing whitespace or control characters.
  - Reject percent-encoded dangerous schemes (e.g., a literal
    `%6Aavascript:` must not normalize to `javascript:`).
  - Reject relative URLs.
  - The allowed scheme set must be chosen explicitly during the spike
    (see Q3 below). A "default to https + mailto" choice must be made
    consciously, not by omission.

### 6. Accessibility gate

Any click-based interaction must have a keyboard-parity path (a command
palette entry, a keyboard shortcut, or the equivalent) — OR the
implementation must document why a keyboard path is genuinely not
appropriate for this feature. Screen-reader compatibility with the
existing CodeMirror surface must be preserved.

### 7. Product gate

The corresponding open product question (Q1, Q2, or Q3 below) must be
answered by the user before the spike begins. The spike must align with
the answered question; if the question is later revised, the spike must
be re-evaluated.

## Open product questions

These three questions are **unresolved**. The user must decide each one
before the corresponding Option B spike begins. Each question's recorded
answer becomes binding policy until amended.

### Q1 — Task-checkbox interaction style

When the user clicks a `[ ]` or `[x]` task marker in Write mode, what
should happen?

Candidate answers (non-exhaustive):

- Plain click toggles the checkbox.
- Modifier-click toggles (e.g., Cmd-click only).
- Keyboard-only toggle (no click affordance at all).
- Hybrid: keyboard always; click toggles only when the caret is already
  on that line.

**Status: unresolved.** No task-toggle spike may begin until this is
answered.

### Q2 — External link interaction style

When the user activates an inline link such as `[label](https://example)`
in Write mode, what should happen?

Candidate answers (non-exhaustive):

- Direct open: Cmd-click opens via IPC to `shell.openExternal`.
- Confirm first: a small confirmation prompt appears before opening.
- Command-palette only: no click affordance; opening is keyboard-driven.

**Status: unresolved.** No link-click spike may begin until this is
answered.

### Q3 — URL allowlist scope

Which URL schemes are permitted in an Option B link feature?

Candidate answers (non-exhaustive):

- `https:` and `mailto:` only.
- `https:`, `http:`, and `mailto:`.
- Above plus a narrowly-defined custom scheme.
- A configurable allowlist managed via a settings UI.

The strictness of scheme matching (case-insensitive, percent-encoding
defense, relative-URL rejection) is governed by gate 5 regardless of
which answer is chosen.

**Status: unresolved.** Any link spike must propose a concrete allowlist
before the spike concludes.

## Accessibility requirements

Beyond gate 6, the policy requires:

- Keyboard navigation parity for any feature that has a click affordance.
- Screen-reader compatibility with the existing single-textarea editor
  surface — interactive ranges must not become invisible to assistive
  technology.
- Focus management: no focus traps, no unexpected caret jumps as a side
  effect of an interaction.
- High-contrast styling must remain readable; new decoration classes must
  not encode information by color alone.

## IME / caret / selection safeguards

The Write surface must remain safe for Chinese / Japanese / Korean IME
composition and for ordinary cursor work:

- Interactive triggers must be suppressed while
  `view.composing === true`. An accidental toggle during IME composition
  is a regression.
- A click-to-toggle interaction must not move the caret as a side effect.
  The caret position before and after a successful toggle must be
  unchanged unless the feature explicitly documents and tests a caret
  change.
- Selection state must not change as a side effect. An active selection
  on unrelated content must survive a toggle.
- Long documents must not become slower as a result of a new extension;
  the existing performance budget (`hybrid-cm6-perf.test.js`) remains in
  force.

## Spike-approval rule

No interactive-feature production stage may begin without an approved
design spike. The spike is throwaway work on a branch that does not merge
into `main`, and it must demonstrate **before** any production stage:

- That the required CodeMirror APIs are exported from the production
  bundle (`apps/desktop/lib/cm6-bundle.js`), not only from the dev-time
  `@codemirror/*` entry points.
- That event-target mapping works — clicks resolve to the intended
  decoration range and to the intended Lezer syntax node, not to a
  neighboring node.
- The exact shape of the Section H exception required (gate 4).
- The exact IPC contract used for any external side effect (gate 5).
- The exact accessibility / keyboard-parity path (gate 6).
- The exact caret / selection / IME-composition handling (this section).
- Alignment with the answered product question (gate 7).

Only after the spike review accepts these answers may the production
stage proceed. The production stage implements only what the spike
validated; expanding scope inside the production stage is not allowed.

## Revisiting this policy

This document reflects the Stage 20 decision. Any substantive change —
relaxing a gate, accepting an Option C primitive, adding a new allowed
primitive, changing an answered product question — requires a new stage
that explicitly amends this file. The Section H test in
`hybrid-cm6-readiness.test.js` and the Stage 16-10 test in
`cross-engine-smoke.test.js` are the **authoritative** source for their
respective prohibited-token lists; this document mirrors them. If the
token lists in this document ever diverge from what those tests assert,
the tests win and this document must be updated to match.
