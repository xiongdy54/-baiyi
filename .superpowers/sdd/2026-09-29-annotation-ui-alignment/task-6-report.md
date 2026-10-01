# Task 6 report — graph rows without the bar, scoped extract typography

## What landed

- **Graph rows (D4).** `ReaderSidebar` renders each node as title + `单元 s–e` + `L{depth}` (mono,
  helper colour, mirroring the sample's `.mm-item .rng/.lvl`) and the proportional bar is gone. The
  `mapUnitCount` render dependency and its `Reader` state were removed; the main-process graph data,
  IPC and `MapTreeItem` payload are untouched (intervals are consumed as given).
- **Extract typography (D1).** `.extract-page .extract-face-body { font-size: var(--fs-title-l);
  line-height: 1.5; }` — a descendant selector, so the shared base rule (`--fs-body/1.8`) and the
  ReviewView merged-extract host keep their baseline. The editable text (`.review-editable`) and the
  read-only text carry no font-size of their own and inherit.

## Assertions added / changed

- `tests/annotations.gui.mjs`: the old "节点带占比条" check became three checks — no bar elements
  (`[data-map-bar], .map-bar` count 0), range/level text equals `单元 s–e` / `L{depth}` matching the
  node's `data-map-start/-end/-depth`, and the serialized `mapTree` payload (id/label/start/end/depth)
  is field-identical before and after open + tab switches (view-only change).
- `tests/extract.gui.mjs`: extract-page body computed 26px / 39px with the child text inheriting, plus
  a differential control on the merged review page (body still equals the probed `--fs-body` and is
  not `--fs-title-l`, line-height equals the probed 1.8 baseline).

## Verification

- `npm run build` then `node tests/annotations.gui.mjs` → **84/84** (82 before this task)
- `node tests/extract.gui.mjs` → **78/78** (76 before)
- `npx tsc --noEmit` → clean

No data-face or IPC change was needed, so the graph contract tests (`mindmapAPI.mapTree` consumers)
are untouched.
