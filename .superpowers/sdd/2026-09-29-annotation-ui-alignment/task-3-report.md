# Task 3 report — PDF and EPUB mark navigation (`goToMark`)

Commit: `0534739` (base `a6d4f53`; branch `批注样张对齐`).
Files: `src/lib/reader/pdf/adapter.ts`, `src/lib/reader/foliate/adapter.ts`, `tests/pdf.driver.js`, `tests/reader.driver.js`.

## What landed

- PDF `goToMark(id)`: exact `docMarks` id → require finite `pageIndex >= 0` + at least one
  normalized rect → existing `goTo({ pageIndex })` → success only when the target mark entry has
  been laid out **on its own page** (`layoutMarks` sets `display:block` only when that page exists
  and its content box has width). No page-internal Y claim, no text-search fallback.
- EPUB `goToMark(id)`: exact id → stored CFI through the existing `goTo` path (bad CFI returns
  false, never throws) → success when the id resolves to a connected `Range` in a loaded section.
- L1 assertions: PDF `P13pre`/`P13a–d` (page arrival, geometry frame, unknown id, anchor-less mark);
  EPUB `S17pre`/`S17a–e` (real-selection CFIs captured per chapter, exact-id relocation, unknown id,
  unparseable CFI, list replacement).

## Correction recorded (important)

The first PDF implementation verified the **painted** mark rect against the page rect. That check
cannot run at L1: `.pdf-mark-layer` / `.reader-doc-mark` positioning lives in `src/theme.css`, and
the L1 PDF fixture only loads `pdf_viewer.css`, so marks degrade to static blocks (measured: layer
rect 1268×84.5, target rect `x=0,y=42.24` while inline `left/top` were correct). Painted geometry is
an L2 concern — `tests/marks.gui.mjs` measures real `.pdf-mark-layer` rects in the built app.

`P13b` therefore asserts the adapter-computed inline geometry (container-viewport frame, same
definition as the adapter's `pageContentRect`) inside the page content frame, with the other-page
mark as a live control: frames differ (`top 0.2` vs `top −2133`), and target `left 282.88 = 217.6 +
8% × 816` — the numbers prove the geometry is real, not a constant.

## Verification (all run this session, serially)

- `npx electron tests/pdf.kernel.cjs` → 26/26
- `npx electron tests/reader.kernel.cjs` → 69/69 at Task 3 close (71/71 after Task 4 added S18)
- `node tests/reader.fake-marks.test.cjs` → 5/5 (Task 2 suite)
- `npx tsc --noEmit` → clean

Generated bundles `tests/*.bundle.js` are rebuilt by these runs and were deliberately **not**
committed (pre-existing tracked build artifacts).
