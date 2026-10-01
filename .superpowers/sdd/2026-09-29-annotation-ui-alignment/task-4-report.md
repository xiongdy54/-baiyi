# Task 4 report — Reader annotation view model + shared panel wiring

## What landed

- `src/lib/reader/marks.ts`: `buildAnnotationItems(rows, documentId, engine, markOrder)` — the panel
  view model, kept separate from `buildDocMarks` (all root extracts of the document, including rows
  without a locator; `locatable` flag; `time` from `createdAt`; `anchorWhole:false`).
  Position order: PDF = `pageIndex` → first-rect `y` → `x`; EPUB = the kernel's resolved document
  order; anything unlocatable/unresolved is stable-appended after the located rows. Priority/due are
  never used as position.
- `src/lib/reader/kernel.ts`: new optional capability `getMarkOrder?(): string[]` (engine-side
  document order). EPUB implements it via section order + `Range.compareBoundaryPoints`;
  FakeKernel models it as install order; PDF intentionally does not implement it (data-face geometry
  already gives PDF order — no dead code).
- `src/components/reader/ReaderExtractsPanel.tsx`: the sidebar "摘录" tab now renders the shared
  `AnnotationPanel` (filters, sort, inline edit, colour, two-step delete) fed by the VM.
- `src/components/Reader.tsx`: `jumpToMark(id)` → `kernel.goToMark(id)` only (never text search);
  success = transient in-panel emphasis (2.5 s, not persisted), bounded failure = neutral
  `不可定位` state. `marksOrderKey` bumps when marks are (re)installed so the panel re-reads order.
- `src/components/reader/AnnotationPanel.tsx` + `src/theme.css`: minimal prop `locatable` and a
  neutral dashed `不可定位` tag — no accent, no fake success.
- Tests: `tests/reader.annot-vm.test.cjs` + entry (9 pure checks), `tests/reader.fake-marks.entry.ts`
  (+3 order/cleanup checks), `tests/reader.driver.js` S18a–b (EPUB document order at L1),
  `tests/annotations.gui.mjs` ⑩pre–⑩m (18 end-to-end checks).

## Rulings / deviations from the plan text

1. **`getMarkOrder()` added** (not in the plan's file list). CFI strings cannot be compared at the
   data face, so EPUB position order can only come from the adapter; the capability returns the ids
   of currently resolvable marks in document order — it is not a generic sort API and never compares
   CFI strings. PDF reuses the data-face geometry instead.
2. **PDF-side panel GUI assertions moved to Task 5.** The PDF fixture has no outline, and today the
   toolbar entry is gated on TOC presence, so an annotation-only PDF cannot open the sidebar yet —
   which is exactly the availability matrix Task 5 owns (spec D2). Task 4 keeps the PDF side at the
   pure-VM level (geometry order, unlocatable-after-located) plus L1 contract (P13a–d). The GUI
   section's PDF part is now a regression on body-mark hover (`.reader-mark-pop`) and a real click
   (`[data-editor-for]`).
3. GUI harness facts confirmed by a throwaway probe (deleted afterwards): the paste book prepends a
   title chapter, so "第二章正文" is section index 2; the sidebar toggle is a switch (clicking 目录
   while open closes it); foliate iframes are reachable through `__getContents()` and
   `doc.defaultView.frameElement`.

## Verification (all run this session, serially, on the built dist)

- `node tests/reader.annot-vm.test.cjs` → 9/9
- `node tests/reader.fake-marks.test.cjs` → 8/8
- `npx electron tests/reader.kernel.cjs` → 71/71
- `npx electron tests/pdf.kernel.cjs` → 26/26
- `npm run build` then `node tests/annotations.gui.mjs` → **72/72** (54 pre-existing + 18 new)
- `node tests/marks.gui.mjs` → 56/56, `node tests/extract.gui.mjs` → 76/76 (regressions for the
  changed Reader/AnnotationPanel/theme.css)
- `npx tsc --noEmit` → clean

Known non-blocking: the GUI suites kill every `electron.exe` on the machine (pre-existing harness
behaviour); `tests/pdf.bundle.js` and `tests/reader.bundle.js` are dirty regenerated artifacts and
were not committed.
