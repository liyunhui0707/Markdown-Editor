# Long-writing resource evidence calibration — 2026-11-14

Baseline main `e28a714c63b48beccf8f1fd057ac398240e54aca`, Document 0.70.1.
This group changes verification and documentation only. Product runtime, layout,
file authority, dependencies and installed App remain unchanged; no version bump.

## Finding and bounded reproduction

The earlier no-image long-writing observation grew mainly in Electron's renderer
working set/embedder heap, while collected JS heap and closed DOM stayed much
smaller. Its test called BrowserWindow.hide() before continuous synthetic input.
A hidden native window can still report document.visibilityState='visible'.
That renderer-side value alone did not establish normal display conditions.

With current 0.70.1 and the same synthetic long article, six hidden-window cycles
retained 2,857 native PerformanceEventTiming and 3,577 blink::TextRecord objects.
The event retainer path leads through the live Performance object and its native
event vector. Product code does not observe those performance entries.

A bounded same-process comparison preserved text/history/recovery assertions:

| Collected native objects | One cycle, native window hidden | Same window shown inactive, frame callbacks completed |
| --- | ---: | ---: |
| PerformanceEventTiming | 477 | 154 |
| blink::TextRecord | 614 | 3 |

BrowserWindow.isVisible changed from false to true; the renderer reported visible
in both cases. Waiting while still hidden and collecting again did not drain the
queues. Showing the window and allowing frames did. A separate two-cycle
diagnostic likewise reduced text records from 1,205 to four. These are controlled
observations, not a claim that every historical RSS byte has been attributed.

## Verification correction

- Resource-bearing image, fixed-draft and sustained-writing workflows use a
  visible inactive native window. No product background-throttling or GC setting
  is changed, and no user window is operated.
- One test helper checks the native visible/not-minimized state, renderer
  visibility and two animation-frame timestamps before accepting a sample.
  Frame callbacks are recorded evidence; they do not certify every compositor
  presentation or performance characteristic of every desktop environment.
- Samples identify renderer byte units separately from Electron main/process
  kilobytes, retain process types/PIDs and preserve natural observations separately
  from explicitly requested test-only collection. Working set, JS heap and macOS
  vmmap physical footprint are different measures. vmmap could not inspect the
  target PartitionAlloc malloc zone; its partial summary cannot prove allocator
  ownership or quantify a leak.
- Four Node cases protect false-visible native windows, invalid renderer/frame
  states, unit labels and explicit collection. Existing exact content/history,
  file bytes, backup count, closed session and image DOM-budget assertions remain.

Local full Node baseline: 3,388 passes, two existing skips, no failures. The three
corrected visible Electron workflows pass. In the six-cycle short writing run,
collected renderer embedder usage stayed between 2,409,192 and 2,757,712 bytes;
working set fluctuated rather than providing a stand-alone leak conclusion.

The opt-in 20-minute run uses these same visibility fences and records exact
restart/continued-writing plus natural/collected resource observations. Its
completion is recorded in the private verification record and PR evidence,
separately from the short CI workload. Automation remains synthetic input; it
does not replace genuine longer human writing, physical IME/clipboard or spoken
heading/table VoiceOver acceptance. Those scoped deferrals remain unchanged.

## Conclusion and continuation

A reproducible contributor to the old hidden-window observations is confirmed.
Preserve those historical results as functional evidence with invalid visibility
conditions for resource inference; do not rewrite them as successes under the new
protocol. Do not apply product GC, purge timers, cache-cap changes or framework
rewrites to compensate for this test condition. The prior 0.70.1 duplicate-image
and detached-parent fixes retain their separate before/after evidence.

Long-term memory stability and genuine human acceptance remain open release
gates. Investigate new growth only when reproduced with valid presentation and
retaining/allocation evidence. Continue the approved local-editor roadmap; broader
external-volume writes still need native per-volume staging/recovery, and paid
public distribution remains deferred.

Private evidence: recovery checkout `.local/verification/long-writing-resources-20261114/`
retains hidden profiles, same-process visibility comparisons, corrected short
runs and the separately recorded opt-in soak. One private single-cycle diagnostic
initially used the wrong continuation fixture; the preserved middle-paragraph
rerun passed. No historical failure was relabeled as a success.
