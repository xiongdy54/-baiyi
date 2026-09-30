# Task 5 report — right dock + condensed toolbar

Commit: `d5bdddb` (plus the m6-3 test fix in the follow-up commit).

## What landed

- **Right dock (D2).** `.reader-engine-viewport` is now a flex row: `.reader-engine-main` (engine +
  page-turn tap zones) takes the remaining width, `.reader-sidebar` is a non-shrinking 280px sibling.
  The old left floating panel (`.reader-toc` absolute rule), its "let the text yield by padding-left"
  compensation (`.reader-body-toc-open`) and the dead `TocSidebar.tsx` are gone. The annotation panel
  fills the dock (`width="100%"`, prop widened to `number | string`); `.reader-side-panel` keeps the
  280px content box intact (280 border-box minus the 1px left hairline).
- **Availability (D2).** The entry is enabled when TOC, current-document annotations, or a published
  graph exists — an outline-less PDF with annotations can finally open the sidebar. Each tab renders
  only with its own data, and the session tab falls back to the first present tab. Annotation count
  comes from the same `buildAnnotationItems` view model as the panel; the dock auto-closes if nothing
  is available anymore.
- **Toolbar (D5-B).** One always-present row: sidebar toggle + previous/next. Mindmap and the two
  review entries moved under `更多`; mode/theme/zoom under `阅读设置` (still the existing `Dropdown`,
  no new settings keys). The two flyouts are mutually exclusive, close on outside pointer or Esc, and
  carry `aria-expanded`/`aria-controls`; actions close the flyout on click.
- **CSS.** Scoped dock and flyout rules using existing tokens only; no new radius/shadow/accent.

## Rulings / corrections

1. **⑤ tab assertion updated.** Tabs are data-driven now, so the map book (no annotations yet at that
   point) shows 目录+图谱. The "three tabs at once" shape is asserted in `⑪i`, after `⑩` created
   annotations — stronger than the old unconditional three-tab check.
2. **Regression triage by baseline diff.** `m6-2` (8/15) and `m6-2native` (19/20) were reproduced
   identically on a detached checkout of the pre-Task-5 commit `846a414` after rebuilding `dist`
   (same failing checks, same readings) ⇒ **pre-existing**, not caused by this change. `m6-3` was
   14/14 at baseline and 13/14 on the branch ⇒ traced to a **missed test update** (a spacing variant of
   the old `目录` button lookup the batch replace did not match), fixed → 14/14.
3. **`tests/visual-audit*.mjs` deliberately not patched.** Those historical audit scripts assert the
   retired left-floating contract (`.reader-toc`, `reader-body-toc-open`, the `目录` button). The plan
   retires that contract, so they are superseded rather than maintained; they must not be used as a
   live oracle for the dock.
4. **`⑩i` flake made deterministic.** One run failed because the textarea was not focused, so the
   programmatic `blur()` never fired the commit; the step now focuses explicitly before blurring, the
   assertion is unchanged (it still checks the DB value), and the failure detail carries
   `{ta, focused, value}`.

## Verification (all this session; `npm run build` before every GUI run)

- `node tests/annotations.gui.mjs` → 82/82 (18 from Task 4 + 10 new dock/toolbar checks)
- `node tests/reader.engine.mjs` → 21/21 (selectors updated to the dock; new settings-flyout check)
- `node tests/marks.gui.mjs` → 56/56, `node tests/extract.gui.mjs` → 76/76
- `node tests/m6-1.gui.mjs` → 23/23, `node tests/m6-3.gui.mjs` → 14/14, `node tests/m15r.gui.mjs` → 46/46
- Baseline (detached `846a414`, rebuilt): m6-2 8/15, m6-2native 19/20 — identical failures
- `node tests/reader.annot-vm.test.cjs` 9/9, `node tests/reader.fake-marks.test.cjs` 8/8,
  `npx electron tests/reader.kernel.cjs` 71/71, `npx electron tests/pdf.kernel.cjs` 26/26,
  `npx tsc --noEmit` clean
