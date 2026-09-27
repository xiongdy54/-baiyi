# 批注化摘录 · 批 4：就地批注与批注栏（规格 v1）

> 状态：**待用户评审后开工**。本文件是计划，不是既成事实；`src/` 与 `electron/` 未改。
> 前置：`docs/impl-spec/ANNOTATION-MULTISELECT.md`（批 0–3 已落地：范围锚内核 / 多段选择 / 面包屑 / 文中留痕）、`AI_DEVELOPMENT_GUIDE.md` §6.8-11（D61–D65）。
> 决策来源：用户 2026-09-27 四轮裁定（逐条见 §0）。**Zotero 为 AGPL-3.0：只研究行为与官方文档，零代码搬运**（同 D64 / Anki 处置）。

---

## §0 裁定记录（用户 2026-09-27）

| # | 裁定 | 影响 |
|---|---|---|
| R21 | 摘录页**不要**「打开摘录」跳转；选中文字即出**阅读器式选区菜单**（摘录 / 制卡 / AI 制卡 / AI 解释 / 查词），选区**高亮显示**，**可批注** | §3 §4 §8 |
| R22 | 选区菜单**定位修正**：不再落在鼠标松开点（会盖住选中文字）——按选区包围盒**上方或下方居中**，取决于选区在阅读容器上半还是下半，且不得越出阅读区域 | §3.2 |
| R23 | 批注两种展示形态，**设置可切**：**旁注气泡**（发丝线连到侧栏气泡，气泡内可直接改/删）↔ **Zotero 式**（高亮右上角**同色便利贴角标**；点高亮弹编辑框） | §5 §9 |
| R24 | 两种形态**都要**，外加 **Zotero 式批注栏**（"尽量还原"）；**批注的增 / 删 / 改在两处都能做** | §5.3 |
| R25 | 层级必须区分：**建卡时写的批注**（锚在整卡）与**卡内选段新建的批注**（锚在某段）**不是同一层级，以不同方式展示** | §1.3 §5.4 |
| R26 | 批注栏**有批注才出现**；出现后**一律占位**（不做抽屉），并**限制窗口最小尺寸**防挤压 | §6 |
| R27 | 默认档＝**旁注气泡**；栏宽 **280px**、窗口 `minWidth` **1120** | §6 §9 |
| R28 | Zotero 栏的还原边界＝列表（色点 + 引文 + 批注文字 + 时间）+ 点击跳转 + 增删改 + **颜色可选** + **排序（按位置 / 按时间）**；**不还原**多标签侧栏 / 导出 / 拖拽重排 | §5.3 §12 |
| R29 | `opens in reader` 的那个专用页面（`extractReader`）**一起退役** | §8 |
| R30 | 「阅读器全套」＝ 五个动作全部搬到摘录页（制卡 / AI 制卡 / AI 解释 / 摘录 / 查词），故须把阅读器的动作栈抽成共享件 | §4 |

---

## §1 数据与语义（零 schema 变更）

### 1.1 批注＝带 `comment` 的摘录（R7 1:1，不建新表）

批注文字**只存 `extracts.comment` 一处**。由此：

- 「在父卡的气泡/列表里改批注」与「在该子摘录卡上看到的批注」是**同一行同一列**——同步是结构性的，**不得**写任何同步逻辑。
- 删除批注 ＝ 删除那条摘录（`extracts:delete`，软删）。**UI 必须二次确认**并写明"会同时删掉这条摘录"（它是 R7 的直接后果）。

### 1.2 三种锚（都在既有列里）

| 情形 | 批注所在行 | 锚 | 落地位置 |
|---|---|---|---|
| 原文侧批注 | **根摘录**（`parentType='document'`） | `contextRef.sourceAnchor`（PDF `rects[]` 百分比 / EPUB `cfi`，批 3 已落） | 阅读器（原文） |
| 卡内批注（选段） | **子摘录**（`parentType='extract'`） | `contextRef.parentRange`（**父卡坐标**字符区间，工单 ② 已落） | 父卡的卡面（摘录页） |
| 卡自身的批注 | 该子摘录自己（＝它被创建时写的那条） | **整卡**（无区间） | 它自己的卡面（摘录页） |

### 1.3 层级规则（R25）

- 摘录页的批注栏**只列当前显示卡的直接条目**：`(a)` 它的"自身批注"（锚在整卡，＝它被创建时写的 comment）＋ `(b)` 卡内选段新建的子摘录（锚在段；`margin-note` 模式只列其中带 `comment` 的，`badge` 模式连纯摘录一起列——见 §5.3）。
- `(a)` 与 `(b)` 用**不同样式**：`(a)` 无发丝线、气泡/列表项带"本条批注"标签、锚点图标为整卡；`(b)` 有发丝线（或角标）、按区间锚定。
- 更深层（孙）**不在当前卡上显示**，只在那张子卡自己的页面上出现——这是"不是同一层级要区别开"的机械实现。

---

## §2 写面（唯一实现面＝`electron/db.js`）

| 动作 | 通道 | 改动 |
|---|---|---|
| 新建批注 | `extracts:create`（既有） | 透传 `comment`（`db.createExtract` **已有该参数**，无需改）；渲染层新增两个调用点（§3.4） |
| 改批注文字 / 颜色 | `extracts:update`（既有通道，**扩 patch 字段**） | `db.updateExtract` 现只认 `contentMarkdown`/`quoteRange` → 扩 `comment` 与 `annotationColor`（`annotation_color`，8 色板值域见 §5.3）；两者都进 `extractSnapshot`（**必须补 `comment`/`annotationColor` 两键**，否则撤销退不回去）与 `extract_ops`（`opType='edit'`） |
| 删批注 | `extracts:delete`（既有） | 无改动；UI 二次确认 |

**色板（8 色，与 Zotero 数量对齐；本项目自定值域，不抄其色值）**：`red|orange|yellow|green|teal|blue|purple|magenta`，渲染取 `--annot-<name>` Token（§9.2）。**颜色不承载调度语义**（§6 借鉴 1 既有裁定）。

---

## §3 选区链路（摘录页与阅读器共用）

### 3.1 共用件

- `src/components/SelectionMenu.tsx`（新）：菜单本体 + 定位（§3.2）＋ 菜单项由宿主传入。
- `src/lib/popoverPlace.ts`（新，纯函数）：`placePopover({ anchor, container, size, prefer })` → `{left, top, placement}`。MarkPopover（批 3）与 SelectionMenu、AnnotationEditor 三处共用**同一份**放置实现（先渲染在视口外一帧 → `useLayoutEffect` 实测 → 夹紧）。
  - `prefer`：`"above" | "below" | "auto"`；`auto` 判据＝`anchor.centerY < container.top + container.height/2` → **below**（选区在上半，菜单在下），否则 **above**。
  - 越界：prefer 侧放不下 → 翻到另一侧；两侧都放不下 → 夹进容器（左右同理，8px 边距）。

### 3.2 菜单定位判据（R22，可测）

1. 菜单矩形**不得与选区包围盒相交**（菜单不得盖住选中文字）；
2. 菜单整体在阅读容器内（含 8px 边距）；
3. 选区在容器上半 → 菜单在选区**下方**；下半 → **上方**；
4. 锚点用**选区包围盒**，不再用 pointerup 坐标。

### 3.3 菜单项与高亮

- 阅读器：`制卡 / AI 制卡 / AI 解释 / 摘录 / 查词 / 图片挖空`（既有六项）+ **`批注`**。
- 摘录页：`制卡 / AI 制卡 / AI 解释 / 摘录 / 查词` + **`批注`**（无图片挖空：卡面正文的图片能力属批 5）。
- 选区高亮＝CSS Custom Highlights（`::highlight(multi-select)`；宿主文档吃 `src/theme.css`，iframe 由 adapter 注入字面值）——**两处都不得往 DOM 插 `<mark>`**（`EditableText` 是"React 不接管子节点"的裸壳）。

### 3.4 「批注」动作

| 宿主 | 落库 |
|---|---|
| 阅读器 | `workflowAPI.create({ parentType:'document', documentId, contentMarkdown: 所选文字, comment: 输入文字, spans?, contextRef: {…, sourceAnchor} })`（sourceAnchor 采集沿用批 3） |
| 摘录页 | `workflowAPI.create({ parentType:'extract', parentId: 当前卡 id, documentId, contentMarkdown: 所选文字, comment: 输入文字, contextRef: {…, parentRange: 所选区间} })`（parentRange 采集沿用 `selectionOffsetsInBody`） |

- **编辑判定**：若实时选区与某条既有批注的锚（`parentRange` / `sourceAnchor.rects` 对应的字符区间）**完全一致** → 该菜单项显示为「编辑批注」，点开直接编辑那一条（不新建）。
- 输入 UI＝`src/components/AnnotationEditor.tsx`（新，小浮层：`textarea` + 保存 / 取消 / 删除；焦点陷阱 + `Esc` 取消；保存走 §2 通道）。

---

## §4 动作栈抽公共件（R30；纯移动，行为零改动）

| 现在 | 之后 |
|---|---|
| `ManualCardEditor`（`Reader.tsx` 内 ~215 行） | `src/components/ManualCardEditor.tsx`（＋`ManualCardPayload` 类型） |
| `AIPanel`（`Reader.tsx` 内 ~350 行） | `src/components/AIPanel.tsx`（已是纯 props 驱动，无 Reader 闭包） |
| `createSingleCard`（建卡：lint + 相似检索 + siblingKey + contextRef） | `src/lib/manualCard.ts`（`createManualCard(input)`；两处共用） |
| 选区五动作的**编排**（AI 流式、drafts 接受/拒绝、解释、查词与单词卡、制卡面板状态） | `src/lib/useSelectionActions.ts`（新钩子） |

**钩子的宿主 adapter（注入面，最小集）**：
`{ contextRef(): Record<string,unknown> | null, sourceTitle?: string, sourceText?: string, selectionPayload(): {text, spans?} , enableImageOcclusion?: boolean, extras?: { onFollowUpCards?, onExploration?, mindmapNodeId? } }`。
阅读器把「图片挖空 / 追问 / 探索 / 导图节点聚焦」作为可选 extras 注入；摘录页不传（这些入口在摘录页不存在）。

**纪律**：抽完后 `Reader.tsx` **不得**保留任何动作实现的副本（防两份漂移）；`useSelectionActions` 是选区五动作的**唯一编排面**。

---

## §5 批注的展示（两形态 + 批注栏）

### 5.1 形态 A：`margin-note`（默认，R23/R27）

- 右侧栏（280px）按**锚点纵坐标**顺序排**气泡**；每个气泡＝批注文字（可就地编辑）+ 所引原文（截断 1 行）+ 删除。
- **发丝线**：从**文中高亮的右缘中点**连到**气泡左缘中点**；线宽 1px（`--border-strong`），两端各一枚 2px 方点（`--accent`）。用宿主侧 `<svg class="annot-lines">`（`pointer-events:none`）绘制。
- 重算时机：滚动 / 缩放 / 换卡 / 换章 / 气泡高度变化（`ResizeObserver`）/ 窗口 resize。
- 判据（测试）：`line.x1/y1` 与"高亮右缘中点"实测差 ≤ 2px；`line.x2/y2` 与"气泡左缘中点"实测差 ≤ 2px。

### 5.2 形态 B：`badge`（Zotero 式，R23）

- 文中高亮的**右上角**加一枚**与高亮同色**的小便利贴角标（直角方块 + 缺角，形状而非字符；尺寸 `var(--sp-2)`）。
- **点高亮**（不点角标也生效）→ 弹出 `AnnotationEditor`（改 / 删）。
- 右侧栏＝**Zotero 式批注列表**（§5.3）。

### 5.3 批注栏（Zotero 式列表，R24/R28）

- 列表项：**色点 + 所引原文（截断）+ 批注文字 + 时间（mono, tabular-nums）**；锚在整卡的条目带「本条批注」标签（§1.3）。
- **点击条目 → 文中滚动到锚点并短暂强调**（高亮闪一下，1.6s，同既有落点做法）。
- **栏内可增 / 删 / 改**：条目内联编辑批注文字（失焦保存）；删除带就地二次确认（焦点默认「取消」）。
- **颜色**：条目上的色点可点 → 8 色板下拉（复用 `.dd`）；写入 `annotation_color`，角标/高亮/色点跟随。
- **排序**：按位置（默认）/ 按时间，二档切换（`app.annotationSort`? **不新增键**——排序是会话内视图偏好，存组件内 state；理由：与内容无关、不需要跨重启）。
- **栏内列出什么**：`badge` 模式＝**本文档/本卡的全部注解**（含没写文字的纯高亮/纯摘录，与 Zotero 一致）；`margin-note` 模式＝**只有批注**（气泡本来就只为批注而存在）。

### 5.4 层级样式（R25，机械判据）

| 类型 | 判据 | 形态 A | 形态 B |
|---|---|---|---|
| 锚在整卡 | 无区间（自身批注） | 无发丝线；气泡左侧 2px `--accent` 竖条 + 「本条批注」标签 | 列表项带标签；文中无角标（整卡不画角标） |
| 锚在某段 | 有区间（卡内选段） | 发丝线 + 端点方点 | 高亮右上角贴纸角标 |

---

## §6 布局与窗口（R26/R27）

- 栏**出现条件**：当前显示对象至少有一条批注（形态 A）/ 至少一条注解（形态 B）。
- 出现即**占位**：**两个宿主都占**——摘录页＝正文列左移 280px（版心 720 在剩余区域内居中）；阅读器＝引擎视口右缩 280px（原文排版宽度随之变化，滚动位置不变）。
- `electron/main.js` 的 `BrowserWindow` 加 **`minWidth: 1120`**（720 版心 + 280 栏 + 两侧内边距 + 滚动条实测能容），另加 `minHeight: 640`。
- 窄窗不再退让（因为窗口不能小于 1120）。

---

## §7 阅读器（原文侧）

- **内核新增可选能力** `getDocumentMarkRects(): { id: string; rect: ReaderRect }[]`：PDF＝覆盖层元素的实时矩形；EPUB＝Range 的 `getClientRects()` 转宿主坐标（沿用 `pointerToHost`）。外壳用它画发丝线、把栏与文中位置对上。
- 栏的出现条件、形态、颜色、排序与摘录页同规；`margin-note` 模式下气泡锚在**标记矩形右缘**。
- 阅读器侧**批注的增 / 删 / 改**：新建＝选区菜单「批注」（§3.4）；改/删＝气泡内联（形态 A）或 `AnnotationEditor`（形态 B）。
- **指针语义（两形态有别，写死防漂）**：hover 浮层**两形态都保留**（原文 + 批注 + 已制卡数 + 「就此制卡」——它与批注编辑是两件事）；**点击**：形态 A＝钉住该浮层（批 3 行为不变），形态 B＝直接打开 `AnnotationEditor`。
- **不做**：阅读器侧不显示孙层批注（同 §1.3）；原文侧的"锚在整卡"类型不存在（原文侧注解都锚在文档上）。

---

## §8 退役 `extractReader`（R29）

删除清单（一处不留）：

1. `src/components/ExtractCardFace.tsx`：`onOpenExtract` 处理器与按钮。
2. `src/components/ExtractReviewView.tsx`：`onOpen` prop 与 `onOpenExtract` 传参。
3. `src/App.tsx`：`openExtract`、`view.name === "extractReader"` 渲染分支、`View` 联合里的该成员、导航 `match` 里的 `"extractReader"`。
4. **测试契约变更**（必须同步，不许静默）：`tests/extract.gui.mjs` 的「动作齐全」断言改为新版动作集（去掉「打开摘录」）。

保留：动作行的**「摘录」按钮**（无选区＝整条；有选区＝那段）——它是快捷方式，与菜单里的「摘录」共用同一 handler；保留可让 `tests/breadcrumb.gui.mjs` 的既有真鼠标链路继续有效。

---

## §9 设置与 Token

### 9.1 设置键（新增 1 个）

`app.annotationStyle`：`"margin-note"`（默认）| `"badge"`。读侧枚举净化（非法值回落默认），设置页「阅读」区下拉。

**登记义务**（§7.4）：指南 §7.4 新键清单 + `tests/flows/f18-settings-matrix.cjs` 的 `DOC_KEYS` 与往返用例——**新增键不补测会让 Y2 红**。

### 9.2 Token（新增 1 组 8 枚，色板）

`--annot-red|orange|yellow|green|teal|blue|purple|magenta`：**必须在 `body` 与 `body.theme-dark` 各声明一次**（§5.1 求值层纪律；否则深色档拿到浅色值）。8 枚是"同一枚焦点的语义变体"，不构成第二个焦点色（与本项目 4 类语义色同规）；**不得**新增圆角 / 阴影 / 第二焦点色；**不得**用 `outline` 承载角标或气泡框。

---

## §10 测试与验收

### 10.1 新套件 `tests/annotations.gui.mjs`（真键鼠 CDP，自启自关）

必须含（每条都是可测判据）：

1. **菜单定位**：选区落在阅读容器上半 → 菜单在选区**下方**且**与选区矩形不相交**；下半 → **上方**；菜单矩形在容器内（8px 边距）——三条都报实测数。
2. **摘录页五动作**：真鼠标拖选 → 菜单五项在场 → 「摘录」落库（`parentRange` 覆盖所选）→ 「制卡」落库（走 `ManualCardEditor`，卡挂 `extractId`）→ 「批注」落库（`comment` 写入、`parentRange` 写入）。
3. **批注增 / 删 / 改**（两处都测）：气泡内联改文字 → 库中 `comment` 变化且**该子摘录卡上显示同步**；删除 → 该行软删且二次确认在场；颜色改 → `annotation_color` 落库、色点 computed 色变化。
4. **两形态切换**：`app.annotationStyle` 往返；形态 A 在场（气泡 + 发丝线）、无角标；形态 B 在场（角标 + 列表栏）、无发丝线；重启后档位不丢。
5. **发丝线几何**：`line` 两端点与"高亮右缘中点 / 气泡左缘中点"实测差 ≤ 2px（把 SVG 的 `x1/y1/x2/y2` 读出来与 DOM 实测对照）。
6. **栏出现条件**：无批注 → 栏不在场；建一条批注 → 栏出现（含占位宽度实测）。
7. **阅读器侧**：原文里的标记/高亮 → 栏在场；点击条目 → 文中滚动（`scrollTop` 变化自证）且高亮在场。
8. **退役**：全应用内无「打开摘录」按钮（含摘录页/复习页/浏览器）。
9. **截图判读**（项目硬要求）：形态 A / 形态 B / 深浅两档各一张，人工目视 + 几何量并举。

### 10.2 回归（本轮不许红）

`tsc --noEmit` 0 · `annotation-range` 42 · `annotation-db` 21 · `marks.gui` 56 · `multiselect.gui` 20 · `breadcrumb.gui` 60 · `extract.gui` 76（含契约更新）· `extracts.test` 137 · `f11` 17 · `f18`（新键往返）· **阅读器主链**：`reader.kernel.cjs`（L1）/ `reader.engine.mjs`（L2）——动作栈搬迁的最大风险面，**未跑必在报告里点名**。

---

## §11 交付批次（每批一个可验收 commit）

| 批 | 内容 | 验收 |
|---|---|---|
| 1 | 数据面：`updateExtract` 扩 `comment`/`annotationColor` + 快照/ops；`workflowAPI.create` 透传 comment | `annotation-db` 增用例（增删改 + 撤销回退）；存量 21 不退 |
| 2 | 动作栈抽公共件（§4 纯移动） | `tsc` 0 + extract.gui 76 + reader L2 全绿（行为零改动） |
| 3 | 选区菜单与定位修正（§3）+ 摘录页接入 + 批注动作 | `annotations.gui` 前 3 组断言 + multiselect/breadcrumb 不退 |
| 4 | 批注展示两形态 + 批注栏 + 设置键 + minWidth（§5/§6/§9） | `annotations.gui` 4–7 组 + f18 |
| 5 | 阅读器侧（§7）+ 退役（§8）+ 文档收口（§7.3/§7.4/§6.8-11/版本块） | 全量回归 + f11 + 截图判读 |

---

## §12 非目标与未做（明确）

1. **不还原** Zotero 多标签侧栏（信息/标签/大纲）、导出、拖拽重排（R28 边界）。
2. 复习页（`ReviewView` 的摘录卡面）**本轮不接**选区菜单与批注栏——只做摘录页与阅读器。
3. 卡面正文里的**图片**（批 5 的 `EditableText` 序列化改造）未做，故摘录页菜单无「图片挖空」。
4. 批注**跨设备同步 / 冲突模型**（D64 不采纳项）不涉及。
5. 批注不得写回源文件（Zotero 官方已退回"存文件"路线，D64 依据）——只存库。
6. 不做模糊重锚定（D61/R1）：正文改了、`parentRange` 按既有的范围锚规则重映射；**不作**文本匹配兜底。
