# 右侧「学习坞」：页签化（AI 解释｜AI 制卡）+ 收起展开 + 全局手动制卡 · 设计稿（v1）

> 预留决策号 **D92**（实现期 bump `AI_DEVELOPMENT_GUIDE.md` 并在 §8.1 登记）。承接 D88 建立的右侧 CardDock，与其上游设计稿 `docs/design/STE-PLAIN-DECODE-D91.md`（v5）接口对齐。
> 本文只做设计，不含代码改动。施工按 §6 清单执行，验收以 §7 机械判据为准，不得自创。

---

## 0. 用户原话（2026-10-04，逐字留痕）

> 好，我采纳你的本地路由方案，并且你的"事后建议"的设计也很好，请加入正式功能。另外，切换器有"自动（默认）｜通用｜简明"三态了，就不需要设置里的"解释前确认方式"开关了。请让AI解释侧边栏（右侧边栏）可以展开和收起，有这个按钮，可以让用户随时展开调整切换器，这个切换器上还要和左侧边栏一样有两个页签，一个是AI解释，一个是AI制卡，另外有一个全局最重要的"制卡"按钮（也就是手动制卡按钮）这个手动制卡是用户随时可以唤出的精致制卡面板，唤出后要巧妙而精致地融入整体界面，不遮挡其他板块信息，方便用户根据各版块的内容随心所欲地进行制卡。

（本稿承接其中：右侧栏可展开收起、双页签、全局手动制卡三件事；本地路由采纳/事后建议转正/删除确认开关三件事由 D91 v5 承载。）

---

## 1. 结论速览

| 议题 | 结论 |
| --- | --- |
| 定位 | 右侧 CardDock 从"一次性面板容器"升级为**常驻「学习坞」**：双页签（AI 解释｜AI 制卡）+ 收起/展开 + 全局手动制卡入口。与左栏（目录/摘录/图谱三页签、恒可点、空态内嵌）形成左右对称的空间心智。 |
| 双页签 | 页签恒可点（D84 惯例）；无内容时页签体内显示空态指引——**坞可以先开、方式可以先调、内容后到**（回应"随时展开调整切换器"）。 |
| 收起 ≠ 关闭 | **收起**：坞体滑出视口、右缘留常驻细把手，全部状态保留（流式继续/表单草稿保留/计时继续）；**关闭**（既有 data-dock-close）：卸载 + AI 批次 reject，语义零改动。 |
| 全局制卡 | 工具栏「制卡」去除选区依赖（免选区＝空表单自由制卡；有选区＝自动预填引用），坞头加「＋制卡」主按钮——"全局最重要的按钮"用**主色 + 专属位**承载。 |
| 手动暂态 | 手动制卡**不是第三个页签**（用户明确两页签）：打开时占坞体、页签条保留可见；切页签时表单**隐藏保活**（不卸载、草稿不丢），「＋制卡」呈 active 态指示草稿在场。 |
| 不遮挡 | 展开时正文让位（既有 `reader-body-shifted` 机制延续）；收起时仅右缘把手（~40px，不进正文版心）。手动表单/AI 面板全部在坞内，任何时刻不覆盖左侧栏与正文。 |
| 与 D91 接口 | 解读方式切换器仍落 AI 解释页签体首行（D91 §5.2）；坞头不再承载方式标题（D91 v5 已同步废止该断言）。 |

---

## 2. 代码现状（2026-10-04 实测锚点）

### 2.1 右侧 CardDock（D88 建立）

- `src\components\CardDock.tsx`（69 行纯容器）：`mode: "manual" | "ai"`、头行（标题 + meta《材料名》+ `data-dock-close` 关闭钮）、Esc 仅手动态、手动态挂载自动聚焦。
- 几何（`src\theme.css:2429-2447`）：`.side-dock` fixed 右缘、`top: var(--sp-12)`（顶栏下）、`width: 400px; max-width: 45vw`、左缘 hairline + 浮层阴影、`side-dock-in` 滑入动画（reduced-motion 关闭）。
- 编排（`src\components\SelectionPanels.tsx`）：手动态 `manualOpen && !manualImage` → CardDock mode="manual" 包 `ManualCardForm`（53-61）；AI 态 `aiPanel` → CardDock mode="ai" 包 `AIPanel`（90-149，标题随 kind 三态：AI 解释/AI 制卡/图片挖空）；**同刻只开一个**（manualOpen/aiPanel 状态互斥）；AI 关闭链含批次 reject（95-104）。
- 宿主让位：`Reader.tsx:1389` `.reader-body-shifted`（`aiPanel || (manualOpen && !manualImage)` 时正文 flex-basis 让位 400px）；摘录页 `ExtractReviewView.tsx:972-975` 挂同一 `SelectionPanels`（其让位机制施工时核实对齐，见 §9-4）。

### 2.2 左栏页签先例（用户点名"和左侧边栏一样"）

- `src\components\reader\ReaderSidebar.tsx:59-64`：三页签 `[toc 目录 | extracts 摘录 | map 图谱]`，**恒可点、空数据＝页签内空态文案**（D84 惯例，注释原文"三枚恒在且都可进"）；着陆页签会话记忆（宿主持有 `sidebarTab/setSidebarTab`）。
- 视觉：`.tabs[role=tablist] > button[role=tab]`，active=`.on`（`theme.css:3787-3812`）。
- 收展先例：`Reader.tsx:1408-1417` 左上角 `annot-toggle`（`data-reader-sidebar-toggle`，aria-expanded/controls，"展开/收起"文案互换）；左轨 280↔0 滑动（D85）。

### 2.3 手动制卡现状

- `src\lib\useSelectionActions.ts:995-1002` `actManualCard`：**依赖选区**（无文本直接 return），`manualQuote` 记锚 → `manualOpen=true`。
- 表单 `src\components\ManualCardEditor.tsx`：`ManualCardForm`（34 起）——quote 块引用 + front 预填（47、64-66 随 quote 同步）+ seg-tabs 四模式（qa/reverse/cloze/imageOcclusion）+ 字段域（priority/contextPrefix/domain/mnemonic/dateStamp…，Payload 17-30）；保存链 `handleManualCard` → 落库 → `closeManual`（SelectionPanels.tsx:34-40）。
- 工具栏按钮：阅读器 `Reader.tsx:1343-1360` 与摘录页 `ExtractReviewView.tsx:880-894` 各一枚「制卡」（现状 `disabled={!selection}`）。

---

## 3. 交互设计

### 3.1 坞头行（新结构）

```
┌──────────────────────────────────────────────────────────┐
│ [AI 解释] [AI 制卡]   《材料名》…      [＋制卡] [⌄] [×] │ ← 头行 48px
├──────────────────────────────────────────────────────────┤
│  页签体（两页签内容 / 手动暂态 / 空态）                  │
└──────────────────────────────────────────────────────────┘
```

- **页签条**：两枚文字页签，复用左栏页签语法（`role=tablist/tab`、active=`.on`），右栏变体类 `.dock-tabs`（同一 token 体系，不新造视觉语言）。
- **「＋制卡」主按钮**：全局手动制卡入口，主色（accent）填充——坞头按钮组里视觉最重的一枚，承载"全局最重要"。
- **收起钮（⌄）**：坞体滑出/滑回；**关闭钮（×）**：既有 `data-dock-close` 语义原样（AI 态含批次 reject）。
- meta（材料名）优先级最低：flex 收缩 + 省略号，空间不足时允许被压缩（"有则显"规则延续）。

### 3.2 双页签行为

| 规则 | 内容 |
| --- | --- |
| 恒可点（D84 惯例） | 两页签任何时刻可点；无内容时页签体内显示**空态指引**：解释页签＝"选中文字后点工具栏「AI 解释」开始；也可先在此选好解读方式"，制卡页签＝"选中文字后点「AI 制卡」开始"。→ 支撑"先开坞、先调解读方式、内容后到"。 |
| 活动页签派生 | **显式点击 > 内容派生**：新 AI 内容到达时（`aiPanel.kind` 变化）自动切到对应页签（explain→AI 解释；cards/occlusion→AI 制卡）；用户显式点击后，只要不产生新内容就停留在所点页签。 |
| 空态测试钩子 | 空态容器 `data-dock-empty`（值为页签名）。 |
| occlusion 归属 | `aiPanel.kind === "occlusion"`（AI 图片挖空）归入「AI 制卡」页签，页签体顶部保留现标题徽章"图片挖空"（AIPanel 零改动；图片挖空的 manual 态仍走 modal，现状不变）。 |

### 3.3 收起 / 展开

- **收起**：坞体 `translateX` 滑出视口右缘，右缘留**常驻细把手**（~40px 竖条，hairline 左缘；含 chevron 图标 + 状态点：AI 流式中＝呼吸点、手动草稿在场＝墨点）。点把手（或收起钮）展开。
- **状态保留（本设计的核心承诺）**：收起不卸载——流式继续接收、ManualCardForm 本地 state 保留、计时继续；把手状态点让用户知道"里面还有活"。**关闭**（×）才是卸载 + 批次 reject，两者严格区分。
- **让位联动**：展开＝正文 shift（既有机制）；收起＝取消 shift（把手 ~40px 悬于右缘，不进正文版心）。
- **记忆**：收/展状态会话内记忆（宿主 useState，同左栏 `sidebarOpen` 先例）。任何唤坞动作（工具栏 AI 解释/AI 制卡/制卡、追问、就此制卡）自动置为展开。
- 无障碍：收起钮/把手 `aria-expanded` + `aria-controls`，对齐 `data-reader-sidebar-toggle` 先例。

### 3.4 全局制卡按钮与手动暂态

- **按钮常驻两处 + 坞头一枚**：阅读器/摘录页工具栏「制卡」**去除 `disabled={!selection}`**（免选区＝空表单自由制卡；有选区＝quote 预填，`actManualCard` 现语义保留选区分支）；坞头「＋制卡」同链路。快捷键 P0 不加（§8 P1 登记）。
- **手动暂态占坞**：打开时表单占坞体，页签条**保留可见**、两页签皆非激活；「＋制卡」呈 active 态（指示草稿在场）。
- **草稿保活（精致的关键）**：切页签时表单**隐藏保活**（容器 display:none，组件不卸载、输入不丢）；点「＋制卡」随时回到表单。仅关闭坞（×）走既有 `closeManual` 丢草稿。
- **精致＝一致性而非新皮肤**：表单体（seg-tabs/form-field/ta-short 自带节奏）、dock 几何（400px/hairline/滑入动画）、头行高度全部沿用既有 token；不新造组件风格。
- **不遮挡**：表单永远在坞体内，正文让位机制保证左侧栏/正文全程可见可用——"根据各版块内容随心所欲制卡"＝边看边写不被打断。

---

## 4. 状态模型

| 状态 | 归属 | 语义 |
| --- | --- | --- |
| `dockOpen: boolean`（新增） | 宿主/useSelectionActions 会话态 | 坞展开/收起；`false` 时坞仍挂载（渲染把手）。 |
| `dockTab: "explain" \| "cards"`（新增） | 同上 | 显式页签选择；内容派生规则见 §3.2（派生仅在"新内容到达"时覆盖显式选择）。 |
| `aiPanel` / `manualOpen` / `manualImage` / `dictPanel` | 既有 | 语义零改动；`manualImage`（图片挖空 modal）不入坞，现状保留。 |
| SelectionPanels | 重构 | 从"按状态分别渲染 CardDock"改为**单坞常驻编排**：一个 CardDock（dockEverOpened 后挂载）+ 页签条 + 三类体内容（AI 页签体 / 手动暂态 / 空态）。 |

关闭链不变：AI 态 × ＝ 批次 reject + `setAiPanel(null)`；手动态 × ＝ `closeManual`；Esc 仅手动态（既有）。

---

## 5. 与 D91 的接口

- D91 的三态"解读方式"切换器落位不变：AI 解释页签体首行（AIPanel explain 分支）；其 `data-testid="explain-mode"` 验收继续有效。
- D91 v5 已废止"CardDock 标题随方式切换"（其 §7.7/§8.6）——方式展示完全由切换器自身承载，坞头页签条恒为"AI 解释｜AI 制卡"两枚。
- 实施顺序：D91 P0 可在现坞头（单标题）下先行交付；D92 页签化重构独立成批（两稿验收各自独立、互不阻塞）。

---

## 6. 施工清单（第二阶段派工用）

| # | 文件 | 改动 |
| --- | --- | --- |
| 1 | `src/components/CardDock.tsx` | 头行重构：页签条（role=tablist）+「＋制卡」主按钮 + 收起钮 + 既有关闭钮；收起几何（把手渲染、`translateX` 联动 `dockOpen`）；props 扩展（tab/onTabChange/onManual/onCollapse/dockOpen/collapsed 派生显示） |
| 2 | `src/components/SelectionPanels.tsx` | 单坞编排：AI 页签体（AIPanel 原样嵌入）/ 手动暂态（保活容器）/ 空态（`data-dock-empty`）；活动页签派生逻辑；关闭链原样迁移 |
| 3 | `src/lib/useSelectionActions.ts` | 新增 `dockOpen`/`dockTab` 会话态；`actAIExplain`/`actAICards`/`actManualCard` 唤坞（置 dockOpen=true + dockTab 派生）；`actManualCard` 去选区依赖（保留有选区预填） |
| 4 | `src/components/Reader.tsx` / `ExtractReviewView.tsx` | 工具栏「制卡」去 `disabled`；`reader-body-shifted` 联动改挂 `dockOpen`（摘录页让位机制对齐，§9-4） |
| 5 | `src/theme.css` | `.dock-tabs`（右栏页签变体，复用左栏 token）、收起把手（40px/状态点/呼吸动画 reduced-motion 适配）、手动暂态 active 指示 |
| 6 | `src/components/AIPanel.tsx` | **零改动**（occlusion 徽章复用现有 kind 文案） |
| 7 | 测试 | GUI 套件断言 §7 全部（`@runtime electron`，跑前 `npm run build`） |

不动的：ManualCardForm 表单体与保存链、AIPanel 全部业务逻辑、dictPanel（独立弹窗）、manualImage modal、AI 批次 reject 语义、快捷键表。

---

## 7. 验收清单（机械判据）

1. **页签条**：`data-testid="dock-tabs"` 存在，两页签 `data-testid="dock-tab-explain" / "dock-tab-cards"`，`role=tab` + `aria-selected` 语法正确。
2. **空态常驻**：无 `aiPanel` 且无 `manualOpen` 时两页签可点，空态容器 `data-dock-empty`（值为页签名）与指引文案在场。
3. **收起/展开**：收起钮 `data-testid="dock-collapse"` 点击后坞体出视口、把手 `data-testid="dock-handle"` 在场；再点展开。**收起不丢状态**：AI 流式中收起→等待 2s→展开，答案增量仍在继续（无重启）。
4. **关闭回归**：`data-dock-close` 既有语义不变——AI 态关闭仍触发批次 reject（既有测试全绿），手动态 Esc 关闭保留。
5. **内容派生**：点工具栏「AI 解释」→ 自动切到解释页签；点「AI 制卡」→ 自动切到制卡页签；显式切页签后无新内容时不回跳。
6. **全局制卡**：无选区点工具栏「制卡」→ 坞展开 + 空表单（front 可输入）；有选区 → quote 预填（回归既有断言）。
7. **草稿保活**：表单输入文字 → 切到 AI 页签 → 点「＋制卡」回表单 → 输入仍在（GUI 断言）。
8. **不遮挡**：展开时 `reader-body-shifted` 生效（正文宽 = 100% − 400px）；收起时 shift 取消。
9. **occlusion**：AI 图片挖空（kind=occlusion）渲染于制卡页签、徽章"图片挖空"在场；manualImage modal 路径不受影响（既有测试全绿）。
10. **文档**：实现 PR 内 bump GUIDE 版本并在 §8.1 登记 D92（引用本稿路径）。

---

## 8. 分期

- **P0（本稿全部）**：页签条 + 空态常驻 + 收起/展开（把手 + 状态保留）+ 全局制卡（免选区 + 坞头主按钮）+ 手动暂态保活 + occlusion 归属。
- **P1**：把手徽章（AI 完成/错误计数提醒）；坞宽拖拽调宽（400px 默认不变）；"引用到制卡"（AI 解释答案/探索区一键送入手动表单 quote）；全局制卡快捷键；摘录页让位机制如与阅读器不一致则统一。

---

## 9. 开放问题（需拍板后进 P0）

1. **命名**：右侧坞中文名"学习坞"是否采用（备选：制卡坞/右栏；aria-label 同步）？
2. 手动草稿在场时点关闭（×）是否需要二次确认（现设计：不加——表单字段轻量、重填成本低）？
3. AI 图片挖空归入「AI 制卡」页签 + 体内徽章的归属方式是否 OK？
4. 摘录页展开让位机制的现状核实（施工期确认；如现状为覆盖式，则本稿 P0 对齐为 shift 式）。

---

## 修订记录

### v1（2026-10-04）
首版：完成现状实测（CardDock 纯容器/SelectionPanels 单态编排/左栏 D84 页签惯例/ManualCardForm 预填机制/工具栏选区依赖）与全量设计（坞头新结构、双页签恒可点+内容派生、收起≠关闭的状态保留契约、全局制卡免选区、手动暂态保活、状态模型、施工清单、机械验收、分期与开放问题）。预留 D92，接口对齐 D91 v5。
