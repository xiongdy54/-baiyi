# Task 8 report — GUI evidence, regression, documentation close-out

Per the plan this task leaves its changes **uncommitted** (Step 6).

## Step 1 — old geometry probes moved to the right dock

- `tests/visual-audit10.mjs`: the E-1 left-overlay contract is replaced. It now measures
  `.reader-engine-main` vs `.reader-sidebar`, derives the hit-test point **from the sidebar's own
  rect** (tab row, no more hard-coded left-dock coordinates), and asserts: sidebar present, width
  280±1, `main.right ≤ side.left + 1`, closed state has no sidebar, the closed/open width delta is
  280±1 px, `reader-body-toc-open` is gone, host `padding-left` is 0, and the point hits inside the
  sidebar (`elementFromPoint` — the clipping-respecting oracle). Run: **8/8 green**, readings
  `closed main 1100` / `open main 820 + side 820→1100 w280, gap 0, hit (960,113) → BUTTON.on`.
- `tests/visual-audit11.mjs`: diagnostics now report the dock's children, tabs, panels and whether
  the dock sits inside the viewport; it also waits for the entry to become available (availability is
  data-driven now) instead of clicking blindly. Readings: `sideRect 820→1100 w280 h653`, children 2
  (`tabs` + `reader-toc-list`, content "第 1 章 / 第二讲 结构"), tabs `["toc"]`, main right edge 820.

## Step 2 — focused suites, serially (all on the built dist)

| suite | result | note |
|---|---|---|
| annotations.gui | **84/84** | 54 pre-existing + 30 (Task 4 §⑩, Task 5 §⑪, Task 6 graph) |
| marks.gui | **56/56** | reader chrome selectors updated for the flyouts |
| extract.gui | **78/78** | +2 typography checks (26px/1.5 and the merged-review baseline control) |
| breadcrumb.gui | **60/60** | |
| multiselect.gui | **20/20** | |
| reader.engine.mjs | **24/24** | +3 dock-reflow progress checks |
| pdf.kernel.cjs (PDF L1) | **29/29** | +P16a/P16b reflow checks |
| reader.kernel.cjs (EPUB L1) | **75/75** | +S18 order, +S19a–c reflow |
| m6-1 / m6-3 / m15r | 23/23 / 14/14 / 46/46 | after the toolbar/`侧栏` selector updates |
| **m6-2** / **m6-2native** | 8/15 / 19/20 | **pre-existing**: reproduced identically on a detached checkout of the pre-Task-5 commit `846a414` (same failing checks, same readings) |
| reader.annot-vm.test.cjs / reader.fake-marks.test.cjs | 9/9 / 8/8 | pure node |

## Step 3 — typecheck and the other-machine boundary

`npx tsc --noEmit` → 0 errors. **No clean-machine validation is claimed**: this project has no
installer/packaging channel, all GUI suites run against an isolated `M7_TEST_USERDATA` on this
machine, and the previously documented foreign-machine items (paths, permissions, GPU/offline
variants) are out of scope here and remain untested.

## Step 4 — screenshots inspected personally (+ the numbers that go with them)

Captured to `tests/tmp-ev8/` (light/dark × annotation dock, both flyouts, graph tab, extract page);
the audit scripts also write `tests/tmp-visual10/`, `tests/tmp-visual11/`.

- Light annotation dock: dock `820→1100` (w 280), panel 279, 3 rows (摘录/高亮/不可定位), meta lines
  single-line. **Defect found by eye and fixed**: the meta row (`时间 + 类型标签 + 段锚/不可定位`)
  pushed the 摘录 tag into a two-line vertical squeeze in the 280px dock → `.zmeta` wraps as a row and
  `.kind-tag` is `nowrap`.
- Graph tab: rows read `第一章 单元 0–1 … L0` / `1.1 小节 单元 1–2 … L1` / `第二章 单元 2–3 … L0`, **no
  bars**. **Defect found by eye and fixed**: range+level were wrapped in a non-flex span, so
  `margin-left:auto` never applied and the level printed right after the range (`单元 2–3L0`) →
  `.map-item-meta` is now a flex container.
- Dark dock: **defect found by measurement after the eye flagged it** — the comment line was
  `rgb(26,26,26)` on a `rgb(16,16,16)` panel (≈1.1:1, unreadable) because `.zn` inherited the *reader*
  ink token while the panel paints the *app* theme background. `.zitem .zn` now declares
  `color: var(--text-primary)`; re-measured `rgb(245,245,242)` on `rgb(16,16,16)` (≈15:1). Light stays
  `rgb(10,10,10)`, same as its sibling tags.
- Extract page: `.extract-page .extract-face-body` = **26px / 39px** measured in the app; the merged
  review page keeps the baseline (`--fs-body` / 1.8, probed at runtime as the control).
- Toolbar: single row `侧栏 | ‹ ›` … `更多 ⌄ 阅读设置 ⌄`; flyouts mutually exclusive, Esc closes,
  `aria-expanded` follows.
- Positive controls that prove the assertions bite: P16a measured a real 4.8 px anchor drift before the
  restore returned `scrollTop` to 300 exactly; the reflow guard's earlier revision leaked one progress
  write (`ratio 0.16076 → 0.16575`) until it was made to hold through the settle, after which a 400 ms
  poll over the whole window reports no change (`firstChangeMs: -1`) while a user page turn still
  writes.

## Step 5 — guide closed out

`AI_DEVELOPMENT_GUIDE.md`: header and decision-log D67 moved from "契约先行/待实现" to **v48.27 已实现**
with the per-suite counts, the two accepted constraints (EPUB Highlight API has no angle badge; PDF
annotation navigation promises page arrival, not page-internal Y) and the two measured facts
(pdf.js only re-fits on window resize; numeric zoom restores the page point through the new optional
kernel capability). §7.3 test obligations updated to the real counts and marked as executed, with the
two pre-existing failures recorded as such.

## Step 6 — final diff (left uncommitted, as the plan requires)

Modified: `AI_DEVELOPMENT_GUIDE.md`, `src/theme.css` (the three visual fixes above),
`tests/visual-audit10.mjs`, `tests/visual-audit11.mjs`. `tests/pdf.bundle.js` and
`tests/reader.bundle.js` are dirty regenerated artifacts and are **not** part of the change. Untracked
scratch from earlier phases (`design-samples/.tmp-*`, the design-sample HTML files and my screenshot
dirs) is unrelated and unstaged. `git diff --check` clean; `git status --short --branch` shows only
the four files above plus the two generated bundles.
