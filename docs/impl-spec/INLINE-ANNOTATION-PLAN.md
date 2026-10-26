# 批 4（就地批注与批注栏）实施计划

> **执行方式：** 按 Task 顺序逐项实现；每项完成后运行对应验收命令并记录实测结果。
> 本项目为**中文提交**：每个 Task 收尾一个 commit，消息里写实测取证。分支固定 `摘录复习改版`，**不碰 main**；`git add` 一律显式路径。

**Goal:** 摘录页与阅读器支持"选中文字 → 点色 → 就地高亮/摘录（可附批注）"，批注以 Zotero 式批注栏（阅读器侧栏含 目录/摘录/图谱 三页签）呈现，并退役 `extractReader` 专用页。

**Architecture:** 数据面在同表加 `kind` 分族（highlight | extract）+ `comment`/`annotation_color` 可写；展示面统一为 Zotero 式（文中角标 + 侧栏列表）；交互面把阅读器的选区动作栈抽成共享件（`ManualCardEditor` / `AIPanel` / `useSelectionActions`），两处宿主共用一份实现。

**Tech Stack:** Electron 31 + React 18 + TS + sql.js（主进程裁决）；CSS Custom Highlight API（绘制层）；CDP 真键鼠 GUI 套件。

**Spec:** `docs/impl-spec/INLINE-ANNOTATION.md`（契约与裁定 R21–R40）；样张 `design-samples/annotation-two-modes.html`（版式与判据的**视觉基准**，实现照它对版）。

## Global Constraints（每个 Task 都适用）

- **Token 纪律**：色/字号/间距一律走 `src/theme.css`；新增 Token 必须在 `:root` / `body` / `body.theme-dark` **各声明一次**；不得新增圆角/阴影/第二焦点色；**不得用 `outline`** 承载皮肤框。
- **样本照抄**：批注栏/菜单/浮层的类名、尺寸、状态色一律照 `design-samples/annotation-two-modes.html`（12px 色块、8×8 角标含缺角、整卡置顶用 `--accent-soft` + 左缘 2px `--accent`）。
- **不碰文档 DOM**：高亮/角标只画在绘制层（Custom Highlights / 宿主覆盖层 SVG）；`EditableText` 的"React 不接管子节点"契约不动。
- **不放解释性小字**；**没写批注就不显示批注行**。
- **测试运行时**：纯逻辑 `node tests/x.test.cjs`；涉 db/preload 用 `npx electron tests/x.test.cjs`；GUI 用 `node tests/x.gui.mjs`（**跑前 `npm run build`**）。文件头 1200 字符内必须出现 `node tests/` 或 `npx electron tests/`（f11 判据②）。
- **回归不许红**（每批收尾必跑）：`tsc --noEmit` 0 · `annotation-range` 42 · `annotation-db` 21+新增 · `marks.gui` 56 · `multiselect.gui` 20 · `breadcrumb.gui` 60 · `extract.gui` 76 · `extracts.test` 137 · `f11` 17 · `f18`。
- **文档同步**：新增设置键→§7.4 + `f18` 往返；新增测试文件→§7.3；改契约→§6.8-11；**版本号 v48.24 → v48.25**（标题与正文最高版本同步，f11 L3）。

---

## 批 1 · 数据面（验收：`annotation-db` 新增用例全绿 + 存量 21 不退）

### Task 1: `extracts.kind` 分族 + 队列/计数过滤

**Files:**
- Modify: `electron/db.js`（`CREATE/ALTER` 段、`createExtract`、`listDueExtracts`、四类计数派生处、`listAllExtracts`）
- Test: `tests/annotation-db.test.cjs`（新增 K 段用例）

**Interfaces:**
- Produces: `createExtract({..., kind})`；`listDueExtracts()` 只回 `kind='extract'`；`listAllExtracts()` 回全部并带 `kind`；计数派生 `usage` 只数 `kind='extract'` 的摘录。
- Produces: 列语义 `kind TEXT DEFAULT 'extract'`（存量 `NULL` ⇒ 一律当摘录）。

- [ ] **Step 1: 写失败用例**（`tests/annotation-db.test.cjs` 末尾，K 段）

```js
// K1 纯高亮不进队列、不进计数，但进 listAll
const hl = db.createExtract({ parentType: "document", parentId: docId, documentId: docId, contentMarkdown: "纯高亮样本", kind: "highlight" });
const row = db.getExtract(hl.id);
check("K1 kind 落库为 highlight", row.kind, "highlight", row.kind);
const due = db.listDueExtracts(Date.now() + 10 * 86400000).map((x) => x.id);
check("K2 纯高亮不进 due 队列", due.includes(hl.id), false, due.includes(hl.id));
const all = db.listAllExtracts().find((x) => x.id === hl.id);
check("K3 纯高亮进 listAll（浏览器/搜索可见）", !!all, true, !!all);
check("K4 存量/未传 kind ⇒ extract", db.getExtract(ex.id).kind, "extract", db.getExtract(ex.id).kind);
```

- [ ] **Step 2: 跑用例确认红**：`npx electron tests/annotation-db.test.cjs`（重定向到文件再 tail）→ K1/K2 失败。
- [ ] **Step 3: 实现**
  - `ALTER TABLE extracts ADD COLUMN kind TEXT`（try/catch，随既有迁移段）；`initDb` 后 `UPDATE extracts SET kind='extract' WHERE kind IS NULL`（一次性回填）。
  - `createExtract` 增参数 `kind`，写入时 `String(kind) === "highlight" ? "highlight" : "extract"`。
  - `listDueExtracts` WHERE 增 `AND COALESCE(e.kind,'extract') = 'extract'`。
  - 四类计数派生（`usage` / `limits` 相关聚合）同样加该过滤。
  - `listAllExtracts` / `getExtract` SELECT 增 `e.kind`。
- [ ] **Step 4: 跑**：`npx electron tests/annotation-db.test.cjs` → 全部通过（含存量 21）；再跑 `npx electron tests/extracts.test.cjs`（137）与 `npx electron tests/flows/f18-settings-matrix.cjs`。
- [ ] **Step 5: 卡片浏览器与全库搜索接纳纯高亮（R35 的落点，自查补）**
  - `src/components/CardBrowser.tsx`：数据源已在用 `listAllExtracts`（Task 1 后带 `kind`）→ 增「类型」列（摘录 / 高亮），并把该列纳入既有筛选/排序机制（**不新增查询语法**）。
  - 全库搜索：确认既有搜 `comment`/正文的路径不过滤 `kind`（本批不新增检索面，只保证不被误过滤）。
  - 跑 `node tests/extract.gui.mjs`（浏览器页签相关断言）+ 手测：造一条纯高亮 → 浏览器可见、可搜到、不带调度字段。
- [ ] **Step 6: Commit**：`git add electron/db.js src/components/CardBrowser.tsx tests/annotation-db.test.cjs` + 中文消息（写实测数字）。

### Task 2: `updateExtract` 扩 `comment` / `annotationColor` / `kind`

**Files:** Modify `electron/db.js`（`extractSnapshot`、`updateExtract`）；Test `tests/annotation-db.test.cjs`（L 段）

**Interfaces:**
- Produces: `updateExtract(id, { comment?, annotationColor?, kind? })`；快照含 `comment`/`annotationColor`/`kind`（撤销可回退）；`extract_ops` 记 `edit`。

- [ ] **Step 1: 写失败用例**

```js
// L1 改批注文字可撤销
db.updateExtract(ex.id, { comment: "第一版批注" });
check("L1 批注文字落库", db.getExtract(ex.id).comment, "第一版批注", db.getExtract(ex.id).comment);
db.updateExtract(ex.id, { comment: "第二版批注" });
db.undoLastOp();
check("L2 撤销退回上一版批注", db.getExtract(ex.id).comment, "第一版批注", db.getExtract(ex.id).comment);
// L3 清空即删批注
db.updateExtract(ex.id, { comment: "" });
check("L3 清空 ⇒ comment 为 null（条目仍在）", db.getExtract(ex.id).comment, null, db.getExtract(ex.id).comment);
// L4 颜色与 kind 可改
db.updateExtract(ex.id, { annotationColor: "teal", kind: "highlight" });
check("L4 颜色落库", db.getExtract(ex.id).annotationColor, "teal", db.getExtract(ex.id).annotationColor);
check("L5 降级为纯高亮（队列里不再有它）", db.listDueExtracts(Date.now() + 1e9).some((x) => x.id === ex.id), false, true);
```

- [ ] **Step 2: 确认红** → **Step 3: 实现**（在 `updateExtract` 的 `p` 白名单里加三键；`hasContent||hasRange` 的早退条件扩为「三键之一存在」；颜色值域校验 `^[a-z]+$` 或 `#hex`）。
- [ ] **Step 4: 跑** `annotation-db` + `extracts.test` + `undo.test.cjs`（29）。
- [ ] **Step 5: Commit**。

### Task 3: 渲染层写面接线（`readingWorkflow.create/update` 透传 kind/comment/color）

**Files:** Modify `src/lib/readingWorkflow.ts`（`ExtractInput` 加 `kind?`/`comment?`）；`src/lib/readingWorkflow.ts` 的 `update`（patch 透传）；Test `tests/annotation-db.test.cjs` 已覆盖 db 侧，本任务只跑既有回归 + 手测 IPC。

- [ ] **Step 1–2**: 在 `ExtractInput` 加字段并在 `create()` 里透传；`update()` 的类型扩三键。
- [ ] **Step 3: 跑** `npx tsc -p tsconfig.json --noEmit`（0）+ `npx electron tests/extracts.test.cjs`（137）。
- [ ] **Step 4: Commit**。

---

## 批 2 · 动作栈抽公共件（纯移动；验收：reader L1/L2 + extract.gui 不退）

### Task 4: 搬 `ManualCardEditor` → `src/components/ManualCardEditor.tsx`

**Files:** Create `src/components/ManualCardEditor.tsx`；Modify `src/components/Reader.tsx`（删除定义、改 import）
**Interfaces:** Produces `default export ManualCardEditor({quote, imageRegion?, onCancel, onSave})` + `export interface ManualCardPayload`（形状照 Reader 现状，一字不改）。

- [ ] Step 1: 原样剪切到新文件（含 `toCloze` 私有助手），Reader 只需 `import ManualCardEditor from "./ManualCardEditor"` 与类型导入。
- [ ] Step 2: `npx tsc -p tsconfig.json --noEmit` → 0。
- [ ] Step 3: 跑 `node tests/extract.gui.mjs`（76）与 `npx electron tests/reader.kernel.cjs`。
- [ ] Step 4: Commit。

### Task 5: 搬 `AIPanel` → `src/components/AIPanel.tsx`

**Files:** Create `src/components/AIPanel.tsx`；Modify `src/components/Reader.tsx`（删定义、改 import）
**Interfaces:** Produces `default export AIPanel(props)`——**逐字照搬** Reader.tsx 现有 `AIPanel`（~350 行，已是纯 props 驱动：`panel/onClose/onAccept/onAcceptOcclusion/onEdit/onSplitReverse/onRejectAll/onExplain/onMakeCards/onModeChange/mode/onSearchBackground/onFollowUpCards/onExploration/elapsedTick`）与其 `panel` 内联类型；不改任何 props 名。

- [ ] **Step 1: 原样剪切到 `src/components/AIPanel.tsx`**（连同 `panel` 形参的内联类型、`AIPanelProps` 若已在 Reader 内则一并搬），`Reader.tsx` 换 `import AIPanel from "./AIPanel"`。
- [ ] **Step 2: `npx tsc -p tsconfig.json --noEmit` → 0 错误。**
- [ ] **Step 3: 跑 `node tests/m6-2native.gui.mjs`（20）** 确认 AI 面板链路无回归（该套件走真实制卡/AI 面板交互路径）。
- [ ] **Step 4: Commit**（消息注明：纯移动，零行为改动 + 实测数字）。

### Task 6: 建卡链抽 `src/lib/manualCard.ts`

**Files:** Create `src/lib/manualCard.ts`；Modify `src/components/Reader.tsx`（`createSingleCard` 改为调用它）
**Interfaces:** Produces `createManualCard(input: { card: CardUpsert; lint: CardLintInput; similarity?: {threshold?: number} })`：内部＝`cardsApi.create` → `lintCard` 逐条 `addIssue` → `similaritySearch.findSimilar(...,2)` 记 S1。

- [ ] Step 1: 抽函数（把 Reader 内 `createSingleCard` 的 lint/相似/写库三步原样搬进去）。
- [ ] Step 2: `tsc` 0；`node tests/m1.gui.mjs`（若有）或 `node tests/extract.gui.mjs` 手测制卡一次。
- [ ] Step 3: Commit。

### Task 7: 抽 `src/lib/useSelectionActions.ts`（阅读器接入，行为不变）

**Files:** Create `src/lib/useSelectionActions.ts`；Modify `src/components/Reader.tsx`
**Interfaces:** Produces `useSelectionActions(adapter)` → `{ menu, aiPanel, dictPanel, manualEditor, actions: {manual, aiCards, explain, extract, lookup, annotate} }`；adapter＝`{contextRef(), sourceTitle?, sourceTextRef?, getSpans(), extras?: {imageOcclusion?, followUp?, exploration?}}`。

- [ ] Step 1: 以**最小搬运**为限：把 `runAICards/acceptDraft/rejectAllDrafts/runExplain/runLookup/acceptVocabCards/handleManualCard` 与 `aiPanel/dictPanel/manualOpen` 状态迁进钩子；Reader 只保留 UI 与 kernel 相关的部分（图片聚焦、导图、跳转）。
- [ ] Step 2: `tsc` 0。
- [ ] Step 3: 跑 `npx electron tests/reader.kernel.cjs` + `node tests/reader.engine.mjs`（L2）+ `node tests/dict` 相关 + `node tests/extract.gui.mjs`；**未跑的在 commit 消息里点名**。
- [ ] Step 4: Commit。

---

## 批 3 · 选区菜单与定位修正 + 摘录页接入

### Task 8: 抽 `src/lib/popoverPlace.ts`（上/下居中 + 夹紧，一处实现）

**Files:** Create `src/lib/popoverPlace.ts`；Modify `src/components/reader/MarkPopover.tsx`（改用它）
**Interfaces:** Produces `placePopover({anchor, container, size, prefer}): {left, top, placement}`（判据＝规格 §3.2 四条）。
Test: `node tests/marks.gui.mjs`（56 不退；该套件已有浮层在视口内的断言）。

- [ ] Step 1: 抽成纯函数（MarkPopover 里的 useLayoutEffect 逻辑 + 菜单算法合一）。
- [ ] Step 2: `tsc` 0；`node tests/marks.gui.mjs` 56/0。
- [ ] Step 3: Commit。

### Task 9: `SelectionMenu`（两行：模式段控 + 调色排 / 动作行）

**Files:** Create `src/components/SelectionMenu.tsx`；Modify `src/components/Reader.tsx`（替换 `.selection-menu`）
**Interfaces:** Produces `<SelectionMenu anchor={{x,y,w,h}} container={DOMRect} mode onModeChange palette onPick onAction />`；类名与尺寸照样张（`.menu/.mrow/.seg/.swatches/.swatch/.macts`）。
- 定位改用 `placePopover`（Task 8）——**这就是 R22 的修正**（不再取 pointerup 点）。

- [ ] Step 1: 实现组件（结构照样张 DOM）。
- [ ] Step 2: `theme.css` 加 `.menu/.seg/.swatches/.swatch` 等（照样张 CSS，走 Token）。
- [ ] Step 3: Reader 接入（把原 6 个按钮拆成「模式行 + 动作行」，图片挖空留在动作行）。
- [ ] Step 4: 跑 `node tests/multiselect.gui.mjs`（20，含菜单在场与动作完成清理）+ `node tests/extract.gui.mjs`。
- [ ] Step 5: Commit。

### Task 10: 摘录页接入选区菜单 + 高亮 + 五动作

**Files:** Modify `src/components/ExtractCardFace.tsx`（暴露选区快照与 rect，接 `selectionMenu` slot）、`src/components/ExtractReviewView.tsx`（挂菜单 + 调 `useSelectionActions`）、`src/lib/reader/multiHighlight.ts`（宿主文档实例）
**Interfaces:** `ExtractCardFace` 新增 `onSelection?(payload: {rect, ranges, text} | null)`；菜单项＝制卡/AI 制卡/AI 解释/摘录/查词（无图片挖空）。

- [ ] Step 1: 卡面在 `mouseup/keyup` 采集选区 rect（`getBoundingClientRect`）与 `selectionOffsetsInBody`，回调给外层。
- [ ] Step 2: 外层渲染 `SelectionMenu` + `createMultiHighlight({currentDoc: () => document})` 画选区高亮。
- [ ] Step 3: 五动作接 `useSelectionActions`（extract 分支复用现有 `onExtract`）。
- [ ] Step 4: 跑 `node tests/breadcrumb.gui.mjs`（60 不退）+ 手测五动作。
- [ ] Step 5: Commit。

### Task 11: `AnnotationEditor`（R37/R40）

**Files:** Create `src/components/AnnotationEditor.tsx`
**Interfaces:** `{extractId, kind, comment, color, quote, anchor:{x,y,w,h}, onSaved(comment,color), onDeleted()}`；**无保存/取消**：输入 400ms 防抖 + 失焦落库；清空 ⇒ comment=null；颜色方块 → 调色浮层（用户色板 + `<input type=color>`）；删除按钮标签按 kind＝「删除高亮」/「删除摘录」（各带就地二次确认）。

- [ ] Step 1: 组件 + CSS（照样张 `.editor/.colorbtn/.colorpop`）。
- [ ] Step 2: 接 `workflowAPI.update` / `remove`；跑 `node tests/extract.gui.mjs` 确认无回归。
- [ ] Step 3: Commit。

### Task 12: 四个设置键（`annotateMode` / `annotatePalette` / `annotateCustomEnabled` / `annotationFilter`）+ 设置页 + f18

**Files:** Modify `electron/db.js`（读侧归一）、`src/components/SettingsPanel.tsx`（「阅读」区）、`tests/flows/f18-settings-matrix.cjs`（DOC_KEYS + 往返）、`AI_DEVELOPMENT_GUIDE.md` §7.4

- [ ] Step 1: 归一函数（枚举/数组净化/上限 8）+ 读侧默认值。
- [ ] Step 2: 设置页 UI（模式下拉、色板多选排序、自定义开关、筛选默认值）。
- [ ] Step 3: f18 补四键往返；跑 `npx electron tests/flows/f18-settings-matrix.cjs`（PASS）。
- [ ] Step 4: Commit。

---

## 批 4 · 批注栏 + 三页签 + 图谱目录

### Task 13: `AnnotationPanel`（批注栏组件）

**Files:** Create `src/components/reader/AnnotationPanel.tsx`
**Interfaces:** `{items: AnnotItem[], kind, currentId, onJump, onEdit, onColor, onDelete, filter, onFilter, sort, onSort}`；`AnnotItem = {id, kind, quote, comment, color, time, anchorWhole}`。
- 样式照样张：`.zitem`（左竖线=批注色实色；整卡=`--accent-soft` + 左缘 2px accent + 恒置顶）、`.mark-kind`（实心=摘录/空心=高亮）、`.kind-tag`、`.filter`。

- [ ] Step 1: 实现（含筛选段控、排序段控、色点改色、内联编辑、删除二次确认）。
- [ ] Step 2: `tsc` 0。
- [ ] Step 3: Commit。

### Task 14: 摘录页接批注栏（出现条件 + 占位）

**Files:** Modify `src/components/ExtractReviewView.tsx`（右栏 + 卡面/栏两列布局）、`src/theme.css`
- 出现条件＝当前卡 ≥1 条注解；出现即占位 280px；`electron/main.js` 加 `minWidth: 1120, minHeight: 640`。

- [ ] Step 1–2: 实现 + `tsc`。
- [ ] Step 3: 跑 `node tests/breadcrumb.gui.mjs`（60；含落点几何，注意版心位移后的对照）。
- [ ] Step 4: Commit。

### Task 15: 阅读器侧栏三页签（目录/摘录/图谱）+ 图谱目录

**Files:** Modify `src/components/reader/TocSidebar.tsx`（升为 `ReaderSidebar`）、`src/components/Reader.tsx`；Create `src/lib/reader/mapTree.ts`（消费 `buildExtractionModel`）
**Interfaces:** `mapTree(documentId) → Promise<{title, items: {id,label,start,end,depth}[]}>`（**只消费不切分**）；无图谱 ⇒ 不渲染「图谱」页签。

- [ ] Step 1: 侧栏结构（页签行 `.tabs`，同刻只显示一个面板）。
- [ ] Step 2: 图谱页签接 `mapTree`（节点点击 → 跳该节点自有区间起点，复用既有导图跳转）。
- [ ] Step 3: 跑 `node tests/reader.paging.gui.mjs` 或 L2（确认层叠/定位无回归）。
- [ ] Step 4: Commit。

### Task 16: 文中角标（颜色跟随 + 首行片段 + 幂等）

**Files:** Modify `src/lib/reader/pdf/adapter.ts`、`src/lib/reader/foliate/adapter.ts`、`src/components/Reader.tsx`、`src/components/ExtractCardFace.tsx`（卡面宿主 SVG 层）
- 硬约束（规格 §5.2）：**颜色内联 `style.fill`，禁写 `.threads rect{fill:…}` CSS**；按 `getClientRects()[0]`；纯高亮与整卡不画；重画幂等。

- [ ] Step 1: 三处宿主层实现 `drawBadges`（共用 `src/lib/reader/badges.ts`）。
- [ ] Step 2: 跑 `node tests/marks.gui.mjs`（56 不退）。
- [ ] Step 3: Commit。

---

## 批 5 · 阅读器侧批注 + 退役 + 文档收口

### Task 17: 阅读器标记的批注增删改

**Files:** Modify `src/components/Reader.tsx`、`src/components/reader/MarkPopover.tsx`
- 点标记 → `AnnotationEditor`（形态唯一）；hover 浮层保留（原文+批注+已制卡数+就此制卡）。

- [ ] Step 1–2: 实现 + `tsc`。
- [ ] Step 3: 手测 + `node tests/marks.gui.mjs`。
- [ ] Step 4: Commit。

### Task 18: 退役 `extractReader`

**Files:** Modify `src/components/ExtractCardFace.tsx`（删 `onOpenExtract` 与按钮）、`src/components/ExtractReviewView.tsx`（删 `onOpen`）、`src/App.tsx`（删 `openExtract`/视图分支/`View` 成员/导航 match）、`tests/extract.gui.mjs`（动作集断言改新版）

- [ ] Step 1: 逐处删除；`grep -rn "extractReader\|openExtract" src tests` 必须零命中。
- [ ] Step 2: 跑 `node tests/extract.gui.mjs`（76，含断言更新后）+ `node tests/breadcrumb.gui.mjs`（60）+ `tsc` 0。
- [ ] Step 3: Commit（消息里写明"契约变更：动作集去掉「打开摘录」"）。

### Task 19: 新套件 `tests/annotations.gui.mjs`

**Files:** Create `tests/annotations.gui.mjs`（文件头含 `@runtime: node` 与「运行：」行；`M7_TEST_USERDATA` 隔离；自启自关）
- 判据（规格 §10.1 九组）：① 菜单上/下半落位与不相交 ② 摘录页五动作落库 ③ 批注增删改（两处）④ 层级与颜色（整卡置顶/主题色/竖线同 token + C2 对照）⑤ 三页签与图谱目录（嵌套/不重叠/缩进）⑥ 角标跟色与不画规则 ⑦ 栏出现条件与占位 ⑧ 退役检查 ⑨ 截图判读（浅/深）。

- [ ] Step 1: 写套件骨架（CDP 连接 + 夹具 + check）。
- [ ] Step 2: `npm run build` → `node tests/annotations.gui.mjs`，**逐条修到全绿**（每条报实测数）。
- [ ] Step 3: 亲眼看截图（4 张：浅/深 × 摘录页/阅读器）。
- [ ] Step 4: Commit。

### Task 20: 文档收口

**Files:** Modify `AI_DEVELOPMENT_GUIDE.md`（版本块 v48.25、§6.8-11、§7.3 测试义务、§7.4 四键、§9.1 M16 进度）、`docs/impl-spec/INLINE-ANNOTATION.md`（状态行改"已落地"）

- [ ] Step 1: 写文档（**标题版本＝正文最高版本 v48.25**；f11 判据①）。
- [ ] Step 2: 跑 `node tests/flows/f11-doc-code-drift.cjs`（17/17）。
- [ ] Step 3: 全量回归一遍（Global Constraints 列表）+ 记录原始输出。
- [ ] Step 4: Commit + 交付报告（改动清单 / 原始结果 / 未做到 / 偏离）。
