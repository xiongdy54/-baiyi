# 批 4 交接备忘（跨会话）；批 3 遗留一并列入

> 分支 `摘录复习改版`。**主计划** `docs/impl-spec/INLINE-ANNOTATION-PLAN.md`（20 Task / 5 批，逐 Task 步骤齐全，直接照它做）。
> **契约** `docs/impl-spec/INLINE-ANNOTATION.md`（裁定 R21–R40）。**视觉基准** `design-samples/annotation-two-modes.html`（对版用；页内自带量测，双击可开）。
> **批 4 已全部完成（Task 1–20，2026-09-28）**：HEAD = `a78b266`（分支 `摘录复习改版`）。
> 文档收口 v48.25，契约 §6.8-12，规格状态行「已落地」，决策号 D66。
> **本文件保留作历史记录**；后续批次（批 5 图片粘贴 / 批 6 Zotero 借鉴 ②③④）见 §三。

## 一、批 4 进度（20 Task）

| Task | 状态 | 说明 |
|---|---|---|
| 1 `extracts.kind` 分族 + 队列/计数过滤 | ✅ **已提交 `8df246e`** | 取证：annotation-db 29/29（新增 K 段 8 条）· extracts 137/137 · f18 46/46 · undo 29/29 |
| 2 `updateExtract` 扩 `comment`/`annotationColor`/`kind` + 快照与 ops | ✅ **已提交 `742e7d9`** | 取证：annotation-db **37/37**（新增 L 段 8 条：批注落库/撤销退回上一版/清空即删/颜色落库/非法色忽略/降级纯高亮/降级后出队/越界 kind 忽略）· extracts 137/137 · undo 29/29。另补 `restoreExtractSnapshot` 三键 undefined-跳过式复原 |
| 3 `readingWorkflow.create/update` 透传三键 | ✅ **已提交 `9b71ce4`** | 取证：tsc 零错误 · extracts 137/137。实际形态：`ExtractInput` 加 `kind?/comment?/annotationColor?`；新增 provider 方法 `updateAnnotations(id, patch)`（渲染层原先没有 typed 的 update 通道，这是新增写面） |
| 4 搬 `ManualCardEditor` → 独立文件 | ✅ **已提交 `97477a5`** | 纯移动。取证：tsc 0 · extract.gui 76/76 · reader.kernel 60/60。Reader.tsx 3006→2715 行 |
| 5 搬 `AIPanel` → 独立文件 | ✅ **已提交 `84d2061`** | 纯移动。取证：tsc 0 · extract.gui 76/76（复跑确认）· reader.kernel 60/60。Reader.tsx 2715→2240 行 |
| 6 建卡链抽 `src/lib/manualCard.ts` | ✅ **已提交 `259a360`** | 取证：tsc 0 · 差分实测 14/14（stub window 捕获真实调用序列：lint 逐条 addIssue / S1 文案逐字 / 缺省回落 / 异常冒泡）· extract.gui 76/76 |
| 7 抽 `src/lib/useSelectionActions.ts`（**风险最大**） | ✅ **已提交 `83ef4d1`** | 取证：tsc 0 · **逐函数比对**（去注释空白后逐行 diff，差异**全部**是 adapter 替换）· reader.kernel 60/60 · reader.engine 20/20 · extract.gui 76/76 · multiselect.gui 20/20 · marks.gui 56/56 · m6-2native 19/20（唯一红项是**既有过时断言**：写死 `listDue()`，改 `listAll()` 复跑即 20/20，非回归）。Reader.tsx 2229→1443 行，钩子 1071 行 |
| 8 抽 `src/lib/popoverPlace.ts` | ✅ **已提交 `47f13e9`** | 取证：tsc 0 · 差分实测 17/17（A 段 6 例与旧算法坐标**完全相等**；B 段 §3.2 四判据且上下互为对照；C 段翻转/夹紧分支非空转自检）· marks.gui 56/56。**MarkPopover 传 `prefer:"below"`**（保持其"恒优先下方"旧语义，非 auto） |
| 9 `SelectionMenu`（模式段控 + 调色排 / 动作行） | ✅ `2acd208` | tsc 0 · multiselect 20/20（×3）· extract 76/76（×2）· marks 56/56。三条坑见 §三·七 |
| 10 摘录页接选区菜单 + 高亮 + 五动作 | ✅ `0f8bbe1` | 专项 25/25 · breadcrumb 60 · extract 76 · multiselect 20。**坑：菜单/面板渲染在卡面外，点它们会被卡面 mouseup 当成「点别处」清掉快照 → 需豁免 .selection-menu/.modal-panel/.dict-panel/.ai-panel** |
| 11 `AnnotationEditor`（R37/R40） | ✅ `100ae47` | 专项 21/21 · extract 76 · breadcrumb 60。**坑：浮层受控，落库后宿主必须更新本地 color 态，否则色块 computed 停在旧色** |
| 12 四个设置键 + 设置页 + f18 | ✅ `9883a07` | f18 61/61 · 专项 19/19 · extract 76 · marks 56。**坑：写侧别用 `settingsStore.set("app", 变量, v)` 间接形式——f18 扫描器按「常量名→字面量」反查，`key` 被别处的 JSX `key="doc"` 绑成 `app.doc` 假键** |
| 13/14 AnnotationPanel + 两列接入 | ✅ `8f96a73` | 专项 28/28 · breadcrumb 60（×2）· extract 76。**坑：整卡判据按「id === 当前卡」而非「无区间」；删整卡条目只清批注、绝不删用户的卡** |
| 15 阅读器三页签 + 图谱目录 | ✅ `d1483b1` | 专项 14/14 · reader.engine 20 · marks 56 · extract 76。**坑：内核 TOC 用 `href`/`subitems` 而 buildTocTree 读 `anchor`；层级取导图 parentId 链不是 TOC 嵌套；多加一本书会打乱 extract.gui（改 `M7_TEST_WITH_MAP=1` 按需播种）** |
| 16 文中角标（PDF） | ✅ `32536dc` | 角标专项 6/6 · marks 62/62（含 56 既有） |
| 17 阅读器标记批注增删改 | ✅ `aa46b43` | 专项 10 条 · marks 56 · reader.engine 20 |
| 18 退役 `extractReader`（R29） | ✅ `198a490` | 零命中 · extract 76（动作集断言已更新）· breadcrumb 60。**契约变更：动作集去掉「打开摘录」** |
| 19 新套件 `tests/annotations.gui.mjs` | ✅ `330e297` | **42/42** 九组判据 · 另修**侧栏配色用错 Token 档**（应 `--reader-fg` 非 `--text-primary`）+ 截图须走真实主题路径 |
| 20 文档收口 v48.24 → v48.25 | ✅ `a78b266` | f11 17/17 · f18 61/61（顺带删掉 Task 15 引入的未登记键 `app.readerSidebarTab`）· 全量回归 13 套全绿 |
| 10 摘录页接选区菜单 + 高亮 + 五动作 | ⬜ | 卡面暴露选区 rect |
| 11 `AnnotationEditor`（R37/R40） | ⬜ | 无保存/取消；失焦即落库；清空＝删批注；删除标签按 kind |
| 12 四个设置键 + 设置页 + f18 往返 | ⬜ | `annotateMode/Palette/CustomEnabled/annotationFilter` |
| 13 `AnnotationPanel`（批注栏） | ⬜ | 整卡置顶 + 主题色；段锚竖线＝高亮同色；两类可辨 + 筛选 |
| 14 摘录页接批注栏 + `minWidth 1120` | ⬜ | |
| 15 阅读器三页签（目录/摘录/图谱）+ 图谱目录 | ⬜ | 图谱只消费 `buildExtractionModel`，不自行切分 |
| 16 文中角标（颜色跟随 + 首行片段 + 幂等） | ⬜ | **禁写 `.threads rect{fill}` CSS**（会盖掉 fill 属性） |
| 17 阅读器标记的批注增删改 | ⬜ | |
| 18 退役 `extractReader`（R29） | ⬜ | 含 `tests/extract.gui.mjs` 动作集断言更新 |
| 19 新套件 `tests/annotations.gui.mjs`（九组判据） | ⬜ | 真键鼠 + 截图判读 |
| 20 文档收口（**v48.24 → v48.25**） | ⬜ | f11 要求标题版本＝正文最高版本 |

## 二、批 3 遗留（本轮工单已交付，下列为当时**明确写进报告的未做项**）

1. **「打开该摘录卡」**：批 3 的 hover 浮层里没接"打开该摘录卡"（跨视图到摘录页查看态）。**批 4 的 Task 18 退役 `extractReader` 时一并不需要**——若仍想要此入口，走摘录页的查看态（`readingWorkflow.getTopic`）。
2. **批注编辑 UI**：批 3 只读展示 `comment`；编辑能力由**批 4 Task 11/17** 交付。批 3 的 `tests/marks.gui.mjs` 里"带批注标记"用例是**用 IPC 造数据**的，批 4 完成后可改为走真实编辑入口。
3. **EPUB 角标**：批 3 未做（Highlight API 无盒子装饰）。若批 4 要做，需另画宿主覆盖层 SVG 按 range 首行片段定位（样张已给画法）。
4. **批 3 未覆盖的验证面**（批 4 实装时顺手补测）：PDF 分页/对开模式下的标记层、多页跨页选区的 rects（当前只收起始页）、一条摘录多矩形的命中、EPUB 分页模式、无 `sourceAnchor` 老数据的 cfi 回退绘制。

## 三、批 5 / 批 6（原 ANNOTATION-MULTISELECT 规格的后续批次，仍未做）

- **批 5 图片粘贴（D65）**：三处编辑器统一 paste → `ensureImageAsset`；**连带 `EditableText` 落库从 `innerText` 改结构化序列化**（否则图片静默丢失，`src/components/EditableText.tsx:5,21,24` 就是现状）；聚焦制卡入口改"点任意图片都进聚焦层"。**已确认零命中**（`clipboardData`/paste 在三处编辑器都没有）。
- **批 6 Zotero 借鉴 ①–⑤**：① 8 色板（批 4 已含色板与 `annotation_color` 写入，**已覆盖大半**）；② 批注标签 + 侧栏列表 + 搜索命中 `comment`（侧栏在批 4；**标签与搜索仍缺**）；③ 模板变量 `{{highlight}}/{{comment}}/{{citation}}/{{color}}/{{tags}}`（**零命中**）；④ 导出含锚点 Markdown（**零命中**）；⑤ 只借标签（无需改动）。
- **合并复习页（`ReviewView` 的摘录卡面）**：其「跳转原文」仍**只跳源文档**，未按 `parentExtractId` 分流（`grep parentExtractId src/components/ReviewView.tsx` ＝ **0 命中**）。批 4 未纳入范围，如需要请单开一条。
- **批 4 §12 已明确不做**：Zotero 多标签侧栏 / 导出 / 拖拽重排；复习页接选区菜单与批注栏；批注写回源文件；模糊重锚定。

## 三·五、跨会话派活的有效手法（本会话实测）

用 `create_chat_session` 派新会话时，**指路式工单会失败**（本会话连派两次、次次停在"探索/验证前提"就耗尽轮次，一行代码未改）；
**把改法确定化（含要插入的代码原文、行号参考、"以文本为准"）+ 明写"不要探索/不要读规格与记忆"** 才跑得动（两次都一次过）。
派完必须**独立复核**：`git show --stat <sha>` 看 diff 是否照做、自己重跑测试取数字（不看它的自述）。

## 三·六、本会话新查明的两条事实（省你重查）

1. **m6-2native.gui.mjs 的「摘录成功（contextRef 含 pageIndex）」现在必然红**（19/20）：该用例建完摘录立刻用
   `workflowAPI.listDue()` 找它，而按 D58「次日进队」，新摘录的 `topicNextAt` 落在**下一个学习日切点**
   （探针实测 3 小时后）→ 真实 `now` 下本就不在 due 列表里。**是测试断言过时，不是回归**；要修就改成查
   `listAll()` 或注入 now。extract.gui 里也有同类断言（同因）。
2. **`tests/reader.bundle.js` 会被测试跑脏**（副产物）：提交时**别带它**（用显式路径 add），脏了就
   `git checkout -- tests/reader.bundle.js`。

## 三·七、Task 9 新查明（后续 Task 会再踩，务必先读）

1. **两行菜单会盖住下一行的拖选线**：菜单高 79px，按 R22 落在选区下方时，multiselect.gui 实测
   菜单 y 195–274 正好盖住第二段 y=267 → Ctrl 加选落空、该套件 6 条判据全红。
   现解法＝**按住多段修饰键期间菜单让路**（`.menu.selection-menu.menu-locked` 关指针事件）。
   凡后续往菜单里加内容（Task 11 批注项、Task 12 更多色板）都要重跑 `multiselect.gui`。
2. **让路状态只能从指针事件取，不能靠宿主 keydown/keyup**：foliate 章节在 iframe 里，
   其 keyup 不转发到宿主（adapter 已注明）→ 宿主跟踪会卡在按住态，菜单永久不接指针、
   点不动「摘录」。用 `pointerdown/move/up` 捕获（iframe 内的由 adapter 中继）。
3. **给菜单加全局类名规则必须限定作用域**：`.menu-locked *` 这种通配规则会波及无关组件——
   实测让 extract.gui「正文编辑落库」稳定变红（带规则 75/76 ×2；去掉 76/76 ×2，确定性 A/B）。
   一律写全 `.menu.selection-menu.xxx`。
4. **两个 GUI 套件绝不能并行跑**：本次并行时 marks.gui 假性 38/56（串行复跑 56/56）。
   套件会 `taskkill` 全局 electron。

## 四、跨会话必须知道的坑（都在样张实测里踩过）

1. **角标颜色**：不得给绘制层写 `rect{fill:…}` CSS —— CSS 盖掉元素的 `fill` **属性**，角标会恒为 IKB 蓝；颜色一律内联 `style.fill`。
2. **角标位置**：不得挂 `inline` 高亮元素内部（inline 包含块把 absolute 子元素放到**联合包围盒**右上，跨行实测偏 **259px**）；必须按 `getClientRects()[0]`（首行片段）。
3. **菜单定位**：`position:fixed` + viewport 坐标（按容器偏移会越界 2439px）；判据＝与选区交集 0、不越界、上半→下方/下半→上方。
4. **绘制层幂等**：重画一律"清空 + 全量重建"，禁增量打补丁（曾出现"形态残留"）。
5. **不得并行渲染两套侧栏**（曾把占位算成 378px）。
6. **PDF 百分比参考系＝页内容框**（`.page` 的 `--page-border` 实测 8.8px，用边框盒会系统性偏 8.4px）。
7. **测试运行时**：`*.gui.mjs` 用 `node` 跑且**跑前必须 `npm run build`**；electron 套件 stdout 全缓冲（重定向到文件再 tail）；GUI 套件会 `taskkill` 全局 electron（并行会话时改跑纯 node/flow 层）。
8. **f11 两条判据**：标题版本＝正文最高版本（本轮 bump 到 v48.25 时两处都要改）；测试文件头 1200 字符内须出现 `node tests/` 或 `npx electron tests/`。

## 五、本会话已交付物（勿重做）

- 批 3 全链：`src/lib/reader/marks.ts` · `src/components/reader/MarkPopover.tsx` · `tests/marks.gui.mjs`（56）· PDF 矩形覆盖层 + EPUB `::highlight(extract-mark)` + `sourceAnchor` 写入侧（提交 `2c8b810`/`ca83b58`/`cde07b0`/`364bb76`/`d4bf889`）。
- 批 4 规格与计划：`docs/impl-spec/INLINE-ANNOTATION.md` · `INLINE-ANNOTATION-PLAN.md`。
- 批 4 批 0 样张（三轮修订）：`design-samples/annotation-two-modes.html`（54/54 × 四档）+ 近景截图 `.tmp-ann-zoom-*.png`。
- 批 4 Task 1：`8df246e`。
