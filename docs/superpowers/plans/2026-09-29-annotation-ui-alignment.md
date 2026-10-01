# 批注样张对齐与阅读器工具栏重排 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现已批准 HTML 样张所要求的摘录排版、阅读器右侧开合批注/目录/图谱栏和精简工具栏，同时维持 PDF/EPUB 定位与进度语义。

**Architecture:** 阅读器继续以 `Reader` 作为壳层编排，`ReaderSidebar` 复用 `AnnotationPanel` 呈现注解；新增的 `goToMark(id)` 经 `ReaderKernel` 由 PDF/EPUB adapter 各自定位，不让 React 业务组件触碰阅读器 DOM。侧栏占位通过文件阅读器区域的 flex 布局完成，开合前后的定位恢复与进度抑制按引擎分别处理；图谱只改 React/CSS 表示，不改主进程数据流。

**Tech Stack:** React 18 + TypeScript、CSS token (`src/theme.css`)、Electron GUI/CDP、PDF.js 6.3、项目随附 `@likecoin/epub-ts` 的 EpubCFI comparator。

**Spec:** `docs/impl-spec/ANNOTATION-UI-ALIGNMENT-REDESIGN.md`

## Global Constraints

- 代码基线为分支 `摘录复习改版` 的 `a6d4f53ef49ceac8feee83660c311088881406d9`；不要重写/提交基线提交，不提交当前未跟踪图、临时脚本、样张或 `tests/flows/fixtures/f40/`。
- 在任何应用代码改动前，按分支隔离约定从当前分支切一个新工作分支；不要在 `main` 改动。
- UI-only except the specifically approved `ReaderKernel`/adapter navigation capability; do not change DB schema, main-process graph IPC/data, FSRS, annotation write semantics, or settings keys.
- `electron/main.js`、`electron/mindmapCore.js`、`mindmap:mapTree`、`MapTreeItem.start/end/depth` 保持不变；图谱占比条仅在 renderer 中删除。
- 阅读器文件侧栏宽度 280px；`BrowserWindow` 最小尺寸保持 1120×640；样张摘录正文 26px/1.5；ReviewView 中复用的 `ExtractCardFace` 字号必须保持基线。
- PDF `page-width`/`page-fit` 随侧栏开合重新适配宽度；数值缩放只保持当前页与页面内容坐标锚点；本批不引入 PDF 页内 XY 持久字段。
- EPUB resize 按 CFI 保存/恢复；只抑制这一次由 reflow 引发的被动进度写入，用户随后翻页/滚动必须照常写入。
- GUI 测试必须先 `npm run build`，使用隔离 userdata；不得按镜像名 taskkill 运行中的用户 Electron。修改 Reader/内核相关行为时串行运行 GUI suites。
- 不新增依赖、数据库列、IPC payload 字段或持久化设置键；保留 EPUB 无角标的已接受差异。
- 主规范与规格按 §1.6 在实现前收口，实施完成后更新为已落地状态；不擅自更改/提交任何无关未跟踪文件。

---

## File Structure / Boundaries

- `AI_DEVELOPMENT_GUIDE.md` — bump 主指南版本、同步阅读器侧栏/工具栏与图谱 UI 契约并登记 D67；实现开始前完成。
- `src/lib/reader/kernel.ts` — 只增加 `goToMark(id: string): Promise<boolean>` 的内核接口。
- `src/lib/reader/testing/fakeKernel.ts` — L0 fake 实现/标记 fixtures，验证定位成功与失败语义。
- `src/lib/reader/pdf/adapter.ts` — PDF 按标记 id 找对应 `ReaderDocMark` 矩形、跳到其 `pageIndex`，并提供可复核的定位结果；不声称页内精确垂直滚动。
- `src/lib/reader/foliate/adapter.ts` — 用已解析 `markRanges` 找标记 CFI，调用 rendition `view.goTo(cfi)`；用依赖提供的 EpubCFI comparator 判断目标到位。只为排序比较当前 document’s visible/resolvable Ranges；无法解析的跨章节/旧锚记录按稳定 fallback 顺序放后，不新造索引/IPC。
- `src/components/reader/ReaderEngine.tsx` — 不直接增加状态；内核引用仍由 Reader 持有，除非类型接线确实要求最小 props 变更。
- `src/components/reader/ReaderExtractsPanel.tsx` — 改成 Reader 当前文档注解 view-model/hook builder：有效 `listAll()` 行、同 document、根摘录、有引文/批注/createdAt/颜色/类型和 PDF/EPUB 定位字段；PDF 在其媒介上按 pageIndex/矩形排位置；EPUB 仅当 mark CFI 可 resolve 到已加载章节 Range 时用 foliate adapter 内的 EpubCFI comparator 比较，其他项维持稳定回退顺序；业务组件不直接字符串比较 CFI 或触碰 iframe DOM。不要把 `createdAt` 加到绘制用 `ReaderDocMark`。
- `src/components/reader/AnnotationPanel.tsx` — 保持摘录页全套筛选/排序/改色/编辑/删除能力；仅补阅读器按 item id 导航/不可定位状态所需的可访问 props，不另写注解卡。
- `src/components/reader/ReaderSidebar.tsx` — 数据可用 tab（TOC/annotations/map 独立出现）；注解 VM 接到共享 `AnnotationPanel`；去除 map bar，将已返回 `[start,end)` 与 depth 显示成文字；保留 map payload 不变。
- `src/components/Reader.tsx` — 侧栏开合与入口可用条件、右侧 dock、工具栏两折叠组、对注解读取和 `goToMark` 的接线、PDF/EPUB resize 事务标记和进度抑制；Markdown 路由完全不变。
- `src/components/ExtractCardFace.tsx` + `src/theme.css` — 只 scope `.extract-page` 正文字号；Reader toolbar/dock/sidebar 样式及注解位置；复习视图不变。
- `src/components/icons.tsx` — 仅缺图标时提供侧栏/更多/阅读设置图标，遵循既有 16/20/24px、1.5 stroke token 规则。
- `tests/reader.fake-marks.test.cjs` — focused Node TDD contract for FakeKernel, compiled from TypeScript with esbuild into a temporary OS directory (no tracked bundle artifact).
- `tests/reader.kernel.cjs` + `tests/reader.driver.js` — existing EPUB adapter L1 contract; add foliate `goToMark` checks in Task 3 only.
- `tests/pdf.kernel.cjs` + `tests/pdf.driver.js` — PDF mark navigation contract、数值/fit zoom 下侧栏 resize 断言。
- `tests/annotations.gui.mjs` — 有图/无图、三 tab 可用性、侧栏开合几何、注解列表/定位与双入口工具栏 UI。
- `tests/visual-audit10.mjs`, `tests/visual-audit11.mjs` — 保留为 dock 几何/内容探针，但更新触发按钮和点命中位置至右侧；不能继续断言左侧浮层。
- `tests/extract.gui.mjs`, `tests/reader.engine.mjs`, `tests/marks.gui.mjs`, `tests/breadcrumb.gui.mjs`, `tests/multiselect.gui.mjs` — 既有回归，只在真实选择器变化时同步更新，不放宽旧行为断言。

---

## Task 1: Update the Product Contract Before UI Changes

**Files:**
- Modify: `AI_DEVELOPMENT_GUIDE.md` sections `§5.3`, `§6.8-12`, `§7.3`, version/changelog and `§8.1` decision log.
- Reference: `docs/impl-spec/ANNOTATION-UI-ALIGNMENT-REDESIGN.md`.

**Interfaces:**
- Produces: D67 contract with 280px right dock, conditional tabs, complete Reader annotation panel, B toolbar grouping, `goToMark(id)`, unchanged graph payload, PDF/EPUB location boundaries, accepted no-EPUB-badge difference.

- [ ] **Step 1: Record the new version and D67 contract**

  Update the guide version title/changelog and D67. State that a side entry is available if TOC, current-document annotations, or published graph is available; tabs render independently. Record `nodeRange` coverage display with no proportional bar and note the sample’s `ownedRanges` prose mismatch without changing graph data. Record that sidebar navigation is independent of mark hover/click.

- [ ] **Step 2: Add test obligations to the guide**

  Name the existing suites and new assertions: graph tab absent with no graph; annotation-only PDF can still open sidebar; right-dock width and body geometry; Reader annotation sort/navigation; PDF numeric/fit zoom behavior; EPUB reflow CFI restoration; regression of `ReviewView` typography and Markdown Reader.

- [ ] **Step 3: Check contract/document alignment**

  Run: `git diff --check`

  Expected: no whitespace errors; D67 wording does not claim page-XY PDF restore or EPUB corner badge support.

## Task 2: Add `goToMark` to the Kernel Contract and Fake Kernel

**Files:**
- Modify: `src/lib/reader/kernel.ts`
- Modify: `src/lib/reader/testing/fakeKernel.ts`
- Create: `tests/reader.fake-marks.test.cjs` — focused Node contract test; bundle to unique `tests/.tmp-reader-fake-marks-${process.pid}.cjs` and remove it in `finally`.
- No tracked `tests/reader.bundle.js` edits in Task 2.

**Interfaces:**
- Consumes: `ReaderDocMark[]` installed by existing `setDocumentMarks`.
- Produces: `goToMark(id: string): Promise<boolean>`; returns false if no matching resolvable mark; success means adapter navigated according to its engine contract.

- [ ] **Step 1: Add failing fake-kernel tests**

  Add a Node CJS test that uses esbuild JS API to bundle `tests/reader.fake-marks.entry.ts` into `tests/.tmp-reader-fake-marks-${process.pid}.cjs`, requires it, then removes only that uniquely named file in `finally`. Use real FakeKernel with chapter fixture and mark records `{ id, cfi?, pageIndex?, rects? }`. Assert known CFI id changes `getCurrentLocation().cfi` and returns true; unknown id and matching id without a CFI return false without changing location; `setDocumentMarks` replacement makes removed ID unresolvable. Keep this focused helper separate from the existing BrowserWindow L0/L1 driver so it cannot rewrite the unrelated tracked `tests/reader.bundle.js`.

- [ ] **Step 2: Run the focused driver to see expected failures**

  Run: `node tests/reader.fake-marks.test.cjs`

  Expected: assertions fail because FakeKernel/ReaderKernel lacks `goToMark` and `setDocumentMarks` installation behavior; `finally` removes the temporary bundle and tracked `tests/reader.bundle.js` remains byte-identical.

- [ ] **Step 3: Add the minimal kernel and fake implementations**

  Define `goToMark(id: string): Promise<boolean>` as required kernel capability beside optional `setDocumentMarks`. FakeKernel keeps a private copy of installed marks, exact-id lookup only, calls fake `goTo({cfi})` if a CFI is present, and returns false for missing/non-CFI entries; clear marks on destroy.

- [ ] **Step 4: Verify the Task 2 kernel contract**

  Run: `node tests/reader.fake-marks.test.cjs`

  Expected: all fake mark navigation checks pass; the `finally` block removes the test bundle and tracked `tests/reader.bundle.js` is unchanged. Real adapter L1 tests are added and run in Task 3.

## Task 3: Implement PDF and EPUB Mark Navigation

**Files:**
- Modify: `src/lib/reader/pdf/adapter.ts`
- Modify: `src/lib/reader/foliate/adapter.ts`
- Modify: `tests/pdf.driver.js`
- Modify: `tests/reader.driver.js`

**Interfaces:**
- Consumes: exact mark id installed by `setDocumentMarks`.
- Produces: `goToMark(id)` semantics: PDF navigates to source anchor page and verifies its mark entry/geometry is on that page; EPUB navigates via stored CFI and verifies resolved range/text. No `anchorText` search fallback.

- [ ] **Step 1: Add failing PDF driver checks**

  Extend the generated PDF fixture setup with two `ReaderDocMark`s on different pages, install them with `kernel.setDocumentMarks`, then call `kernel.goToMark(id)`. Assert exact id returns true and `getCurrentLocation().pageIndex` equals the mark page. After the render condition settles, in test-only diagnostics use `window.__pdfViewerDebug.getPageView(i).div` and adapter mark-entry geometry to prove the target rectangle belongs to that page. Unknown id returns false and leaves page unchanged. Production adapter must not expose viewer internals through new APIs.

- [ ] **Step 2: Run the PDF L1 suite before implementation**

  Run: `npx electron tests/pdf.kernel.cjs`

  Expected: new `goToMark` checks fail.

- [ ] **Step 3: Implement PDF page navigation**

  Use `docMarks.find(m => m.id === id)`, require finite `pageIndex >= 0` and at least one normalized rect, call existing `goTo({pageIndex})`, and wait for the corresponding page/mark layout cycle using the adapter’s page-render event/condition. Return success only when the target mark entry exists and is associated with that page; do not claim its vertical position is restored and do not search text.

- [ ] **Step 4: Add failing EPUB driver checks**

  In the EPUB `tests/reader.driver.js` L1 fixture, install `ReaderDocMark`s in separate fixture chapters with CFI values captured from real selections (no hand-written CFI literals). Call only the kernel adapter API `goToMark(id)` (the L1 driver does not mount Reader/React). Assert exact id returns true and the relocation lands in the mark’s chapter; unknown id, a mark without CFI, and an appended-garbage CFI return false; `setDocumentMarks` replacement makes the removed id fail. The CFI/text/geometry “same position” oracle runs at L2 (`tests/annotations.gui.mjs`) where the iframe DOM is observable — L1 proves the adapter contract only. Keep hover/click handler regression checks in `tests/annotations.gui.mjs` because they are Reader event wiring, not adapter behavior.

- [ ] **Step 5: Run EPUB L1 before implementation**

  Run: `npx electron tests/reader.kernel.cjs`

  Expected: new EPUB-specific goToMark checks fail.

- [ ] **Step 6: Implement EPUB CFI navigation**

  Resolve the exact `docMarks` id, require a CFI, then invoke `view.goTo(cfi)` through the existing `goTo` path (bad CFI never escapes as an exception). After relocation, verify the target mark resolves to a connected `Range` in the loaded contents; return false if it cannot. Do not add substring search fallback.

- [ ] **Step 7: Verify PDF and EPUB L1 suites**

  Run: `npx electron tests/pdf.kernel.cjs` and `npx electron tests/reader.kernel.cjs` serially.

  Expected: both suites pass; existing selection, navigation, range drawing and destroy cleanup remain green.

## Task 4: Build a Reader Annotation View Model and Wire the Shared Panel

**Files:**
- Modify: `src/components/reader/ReaderExtractsPanel.tsx`
- Modify: `src/components/reader/AnnotationPanel.tsx` only if a minimal prop is needed.
- Modify: `src/components/Reader.tsx`

**Interfaces:**
- Consumes: `workflowAPI.listAll()`, current `documentId`, existing `ReaderDocMark[]`, selected reader engine, existing `useSelectionActions` callbacks.
- Produces: panel items `{id, kind, quote, comment, color, time, anchorWhole:false}`, deterministic position sort; `goToMark(id)` callback plus an explicit unavailable state for old/unanchored rows.

- [ ] **Step 1: Add failing pure ordering/data tests**

  Add deterministic data-mapping tests at the nearest existing test harness: same-document root extracts only; exclude child `parentExtractId`; include both `highlight` and `extract`; preserve nullable comments; PDF sort by `pageIndex` and stored first-rect geometry; unlocatable records stable after located records; never order by due/priority for “position”. For EPUB, test exact target CFI resolution/navigation in the foliate adapter; position-order only records whose ranges are currently resolvable in loaded contents with its `EpubCFI.compare()`, then stable-fallback for unresolved records. Do not create a general sort API or compare CFI strings.

- [ ] **Step 2: Run the new helper test to prove it fails**

  Run: the exact new Node test command added to the project test inventory.

  Expected: missing helper/incorrect order failures. (Use an existing Node test file pattern; do not invent an npm script.)

- [ ] **Step 3: Build the Reader panel VM separately from draw marks**

  Map `listAll` rows into annotation card VM and preserve `createdAt`. Do not add `createdAt`, UI state, or sorting metadata to `ReaderDocMark`. Share only `annotSolid`/`annotSoft` color semantics and IDs.

- [ ] **Step 4: Render `AnnotationPanel` in the extracts tab**

  Pass the existing settings-backed filter/palette; reuse `saveAnnotationComment`, `saveAnnotationColor`, `removeAnnotation`; for navigation call `kernelRef.current?.goToMark(item.id)`. Report unavailable with neutral inline state if no CFI/page+rects or navigation returns false. For successful PDF page navigation, apply a transient per-item emphasis only while that mark is visibly rendered; never persist it.

- [ ] **Step 5: Add GUI checks for the Reader annotation panel**

  In `tests/annotations.gui.mjs`, seed a root PDF annotation and an EPUB annotation; click each row and verify the adapter’s goToMark event/page/CFI oracle; exercise filter, position/time sort, inline edit/clear, color, and two-step delete. Verify body-mark hover still opens `MarkPopover` and a real click still opens `AnnotationEditor`.

- [ ] **Step 6: Run the focused GUI suite**

  Run: `npm run build` then `node tests/annotations.gui.mjs`.

  Expected: Reader annotation panel tests pass in isolated userdata; close only the Electron PID created by the test if cleanup needs intervention.

## Task 5: Dock the Sidebar on the Right and Condense Reader Toolbar

**Files:**
- Modify: `src/components/Reader.tsx`
- Modify: `src/components/reader/ReaderSidebar.tsx`
- Modify: `src/theme.css`
- Modify: `src/components/icons.tsx` only if needed.

**Interfaces:**
- Consumes: sidebar tab availability, Reader VM, existing `ReaderSettings`, existing engine mode/appearance handlers.
- Produces: `sidebarOpen`-controlled right dock; tab set independently filtered by data; toolbar groups `moreOpen` and `settingsOpen`, mutually exclusive, transient.

- [ ] **Step 1: Add failing DOM/geometry GUI checks**

  Update `tests/annotations.gui.mjs` to use the new “侧栏” control. Add cases for (a) map-enabled three tabs; (b) no-map but TOC+annotation only two tabs; (c) no-TOC PDF with annotation still opens side panel and shows 摘录 tab; (d) no TOC/no annotation/no map hides/disables entry. Record widths/rects before and after open/close; assert 280±1px width delta and no body/sidebar intersection.

- [ ] **Step 2: Run focused GUI tests to confirm expected failures**

  Run: `npm run build` then `node tests/annotations.gui.mjs`.

  Expected: old left floating sidebar/button DOM causes the new right-dock availability/geometry checks to fail.

- [ ] **Step 3: Change Reader state and tab availability**

  Rename the local `tocOpen` semantic to sidebar open state; keep `sidebarTab` session state. Make the single sidebar button available if any of TOC, annotations, or graph exists; do not require TOC for a PDF annotation-only document. Render each tab only when its own data is present. Always provide an accessible close button when the sidebar is open.

- [ ] **Step 4: Implement a right-side dock layout**

  In file-reader viewport, create a flex row where the engine host occupies the remaining width and the sidebar is a 280px nonshrinking sibling. Remove left-dock CSS and `.reader-body-toc-open` host padding logic for this component. Keep PDF tap zones scoped to the engine content viewport, not over the side panel. Keep non-engine Markdown Reader subtree and sizing unchanged.

- [ ] **Step 5: Add B toolbar grouping**

  Keep sidebar + previous/next always present. Place mindmap/review-extracts/review-cards under “更多”; place mode/theme/zoom under “阅读设置”. Keep current change handlers and persistence. Close one popover when the other opens; close on outside pointer/Esc; use `aria-expanded`/`aria-controls` and keyboard-visible focus. Use existing Dropdown for individual settings; do not add settings keys.

- [ ] **Step 6: Add scoped CSS for side dock and toolbar menus**

  Use existing `--sp-*`, `--fs-*`, `--reader-bg`, `--reader-fg`, border/accent tokens. Give flyouts stacking/overflow geometry that is tested against the right sidebar’s tabs. Do not add new radius, shadow, or accent values.

- [ ] **Step 7: Verify panel, toolbar, and window-boundary checks**

  Run: `npm run build` then `node tests/annotations.gui.mjs`.

  Expected: tab visibility, active underline, open/close, focus, fit behavior and geometry pass at 1120×640 and a wider viewport.

## Task 6: Remove Graph Proportional Bars and Scope Extract Typography

**Files:**
- Modify: `src/components/reader/ReaderSidebar.tsx`
- Modify: `src/theme.css`
- Modify: `src/components/ExtractCardFace.tsx` only if a scoped class hook is required.
- Modify: `tests/annotations.gui.mjs`, `tests/extract.gui.mjs`.

**Interfaces:**
- Consumes: unchanged `MapTreeItem {id,label,start,end,depth}` from `mapTree`.
- Produces: graph row title + existing `[start,end)` coverage range + depth; no bar/percentage display; `.extract-page` body at 26px/1.5 only.

- [ ] **Step 1: Add failing view assertions**

  Assert all rendered graph items show their existing range/depth text and `.map-bar`/`[data-map-bar]` count is zero. Record serialized mapTree item count/start/end/depth before UI toggle, then compare after sidebar open/tab switch to ensure no data mutation. Add computed font assertions for extract page and ReviewView merged-extract host baseline.

- [ ] **Step 2: Implement graph row representation only**

  Remove the bar DOM and `mapUnitCount` rendering dependency; render the already supplied `start`, `end`, and `depth` in text. Keep node click and indentation unchanged. Do not edit `electron/main.js`, `electron/mindmapCore.js`, preload IPC, or the graph data test.

- [ ] **Step 3: Scope extract typography**

  Add `.extract-page .extract-face-body` typography at `var(--fs-title-l)` and `line-height:1.5`; ensure editable text and all descendants inherit. Do not change shared `.review-front` or base `.extract-face-body` defaults used by `ReviewView`.

- [ ] **Step 4: Run extract and annotation GUI tests**

  Run: `npm run build` then `node tests/extract.gui.mjs`, then `node tests/annotations.gui.mjs` serially.

  Expected: queue/card flow stays functional; extract font/line-height match spec; graph payload remains byte/field equivalent while bars are absent.

## Task 7: Preserve Reader Location During Sidebar Reflow

**Files:**
- Modify: `src/components/Reader.tsx`
- Modify: `src/lib/reader/pdf/adapter.ts` only for necessary read-only viewport snapshot/restore methods if existing `getCurrentLocation` and PDF.js public viewer methods cannot satisfy the contract.
- Modify: `src/lib/reader/foliate/adapter.ts` only for stable post-reflow current-CFI query/restore behavior.
- Modify: `tests/pdf.driver.js`, `tests/reader.driver.js`, `tests/reader.engine.mjs`.

**Interfaces:**
- Reader owns a transient `layoutReflowGeneration`/pending-layout token, not durable settings.
- PDF snapshot is `{pageIndex, pdfUserPoint:{x,y}, zoomMode}` derived from the actual `PDFPageView` viewport transform/current view-area; numerical zoom restores with the current rotation-aware viewport conversion, fit modes retain preset and only require page continuity.
- EPUB snapshot is `ReaderLocation.cfi` plus its target Range; use packaged EpubCFI comparator/resolve APIs, not string equality.

- [ ] **Step 1: Add failing resize-progress tests**

  PDF driver: open the side dock to change the engine container width; test current page and a page-content point under numeric zoom; separately test `page-width` and `page-fit` preset retention and current page. EPUB driver: save a middle-of-chapter CFI, open the side dock to resize the rendition, wait on real `relocated` settlement (condition, no fixed sleep as sole oracle), then assert the same target Range/text returns into the viewport. For both engines, assert this sidebar width change does not write progress and a subsequent true user page/scroll action does. Opening toolbar popovers alone is not a reflow case.

- [ ] **Step 2: Run PDF and EPUB L1 tests to confirm the gap**

  Run: `npx electron tests/pdf.kernel.cjs`, then `npx electron tests/reader.kernel.cjs`.

  Expected: new geometry/progress checks expose current resize behavior before compensation.

- [ ] **Step 3: Implement the smallest reflow transaction**

  Before toggling dock width, capture engine location and mark the transition as layout-only. After PDF render settles, restore page and numeric-zoom page point through adapter’s narrow API; for fit presets, allow adaptive scale and validate current page only. After EPUB ResizeObserver/reflow `relocated` settles, restore the saved CFI once. Consume only the layout-generated relocate(s) for progress suppression; clear the guard deterministically before user interactions. Do not add timers as the only completion signal.

- [ ] **Step 4: Verify anchor and progress positive controls**

  Run the two L1 suites again. Expected: numeric-zoom PDF content point stable within ≤2px under rotation-aware transforms; fit zoom retains `currentScaleValue` and current page while adapting scale; EPUB CFI resolves to same Range text and becomes visible after reflow; layout transition writes zero new progress; a real user navigation writes progress exactly as before.

## Task 8: Update GUI Evidence, Run Regression, and Close Documentation

**Files:**
- Modify: `tests/annotations.gui.mjs`
- Modify: `tests/visual-audit10.mjs`, `tests/visual-audit11.mjs`
- Modify: `tests/reader.engine.mjs`, `tests/marks.gui.mjs` only where stable selectors/coverage need direct additions.
- Modify: `AI_DEVELOPMENT_GUIDE.md`.

- [ ] **Step 1: Update old geometry probes rather than preserving stale left-dock assumptions**

  Move the visual-audit10 hit coordinates to a geometry-derived point inside the new right sidebar; assert the reader content viewport ends before the sidebar begins. Update visual-audit11 diagnostics to report the right-dock children and tab panels. Capture before/after screenshots and keep all dynamic regions unmasked unless genuinely irrelevant.

- [ ] **Step 2: Rebuild and run focused GUI suites serially**

  Run: `npm run build`; `node tests/annotations.gui.mjs`; `node tests/marks.gui.mjs`; `node tests/extract.gui.mjs`; `node tests/breadcrumb.gui.mjs`; `node tests/multiselect.gui.mjs`; `node tests/reader.engine.mjs`; `npx electron tests/pdf.kernel.cjs`; `npx electron tests/reader.kernel.cjs` (only suites relevant to this change; do not run suites concurrently).

  Expected: every named suite passes; record exact counts and any pre-existing unrelated failures rather than masking them.

- [ ] **Step 3: Run typecheck and the project’s other-machine checks**

  Run: `npx tsc --noEmit`. Then run available offline/no-GPU/foreign-path test variants without claiming clean-machine installer validation (no installer channel exists).

- [ ] **Step 4: Visually inspect screenshots and numeric evidence**

  Inspect all saved 2×2 theme × engine screenshots personally; report sidebar/body rectangles, width delta, text typography, toolbar expanded/collapsed, location/CFI evidence and one positive-control induced failure. State the untested real-clean-machine distribution boundary.

- [ ] **Step 5: Update the guide’s D67 state and test counts**

  Change “proposed” to implemented only for behavior actually evidenced; record the EPUB angle-badge limitation and PDF page-only annotation navigation limit as accepted constraints. Keep graph IPC/data description intact. Confirm no unrelated untracked files are staged or described as implementation output.

- [ ] **Step 6: Review final diff and leave changes uncommitted**

  Run: `git diff --check`, `git status --short --branch`, `git diff --stat`.

  Expected: only spec-approved implementation files are modified; no code commit is created unless the user explicitly asks.
