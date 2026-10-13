# D144 · 制卡台 IA 重设计 —— 制卡板块（手动/AI 双页签）+ 解释板块（底部收起）+ 选区三按钮

> 决策号 **D144**（待登记：GUIDE §8.1，版本 bump v48.99 → **v48.100**，见 §11 登记任务项）。
> 遵循：`docs/swiss-international-style.md` + `docs/design/MOTION-DESIGN-SPEC.md`（D120，含 R2）；线条/输入面纪律沿用 `docs/design/D142-CARDDOCK-RESTYLE.md`（V1 下缘一划已落地，不回退）。
> 修订对象：`docs/design/CARD-WORKBENCH-D123.md`（IA 层修订，§2 结构图与 §3 DOM 契约按本稿 §10 更新；D142 的样式层结论全部保留）。
> 本稿**零产品代码**；实施走 §13 任务拆解表。
> **范围修订（2026-10-13，用户拍板）**：全局选中功能整线延后入路线图——本批仅实施**坞内部分**（§2–§4.4、§6–§9）。延后项：§4.5 阅读选单替换（决策 7）、§5 全局选单（决策 6，机制方案 `GLOBAL-SELECTION-ACTIONS-D145.md`）、§11-4 键位脚注、§11-5 设置键登记、§13 表 #6/#7/#8、验收 #5-⑥。延后原因：全局方向待定（任意处制卡 vs 材料导入软件内制卡），先做方向调整再交付。

## 0. 用户原话与已确认决策

用户原话（逐字）存于总控交接包，本稿不重复抄录。已确认决策（均来自用户原话，勿再议）：

1. 制卡台分两大板块：**制卡板块**（手动制卡 / AI 制卡 两页签）+ **解释板块**。
2. 默认展示「手动制卡」页签；两页签切换**内容无损**。
3. 跨页签草稿同步：一页签第一行文本框有内容时，切到另一页签，其文本框以**灰色未输入文本样式**带入展示并显示快捷键，按快捷键一键填入；**双向**。
4. 解释板块默认**收起在底部**：只留一个随文本增高向上展开的输入框 + 输入框上方一排**悬浮按钮**（解读方式选单选项按钮化 + 新增「自由提问」）；输入文本后点对应按钮＝按相应提示词处理；**发送后自动展开**；展开后可快速收起/再展开。
5. 解释板块内选中任意内容 → 简洁三按钮选单：**a. AI 制卡 / b. 复制（直接复制到手动制卡文本框）/ c. 引用（引用到 AI 解释输入框）**。
6. **全局选中功能**（任意软件，含本软件之外）：选中文本出现同款三按钮选单，或按设置中自定义快捷键直接使用三按钮功能；可在设置中关闭；三按钮功能可配快捷键。
7. 阅读界面选中文字后弹出选单里的「制卡」「AI制卡」「AI解释」三入口**被三按钮功能替换**。
8. 软件内右侧制卡台与全局快捷键唤出的制卡台是**同一组件**，一次修改两处生效。

## 1. 现状盘点

### 1.1 现状结构（v48.99 / D123+D142）

`CardDock.tsx` = 上「手动制卡区」（常驻、可收成标题行）+ 下「AI 区」（页签：解释｜制卡）。解释页签体＝`AIPanel`（explain 分支：`ExplainModeSwitcher` 下拉 + 引用块 + 答案 + 追问 chips + `ExplainThread`）+ 底部 `ChatComposer`；制卡页签体＝`FreeSource` 自由材料框 或 AI 制卡草稿面板。

- 复用链（两处同一实现的证据）：主窗口各页面 → `SelectionPanels` → `CardDock`；独立窗口 `workbench.html` → `src/workbench.tsx` → `FreeWorkbenchHost`（`standalone`）→ **同一个** `SelectionPanels`/`CardDock`。故本稿所有改动落在共享组件上，独立窗口**自动同步**，无需第二条实现链。
- **指针更正（登记，非 REFRAME）**：交接包列出的 `CaptureEditor.tsx` + `electron/quickCapture.js` 实为「快速记录（日记）」窗口，**不是**制卡台；全局快捷键唤出的制卡台＝`workbench` 单例窗口（`electron/workbenchWindow.js`，D123）。本稿不涉及 CaptureEditor。
- 选区浮条现状：`SelectionMenu.tsx`（D122）动作区五钮：批注 / 制卡 / AI 制卡 / AI 解释 / 查词，快捷键 Ctrl+Z/X/A/D（GUIDE §9.1 锁定键位）；`useSelectionActions.ts` 的 `actManualCard / actAICards / actAIExplain / actLookupWord` 与菜单同源。
- 解释流式实现（D118）：`runExplain`/`runAsk` 流式 + `AIStatus` 计时停止行，全部保留。

### 1.2 现状问题（本次重设计针对点）

1. 「AI 制卡」与「AI 解释」并列在同一页签条下，手动制卡却被单独置于上方——**制卡的两条路径（手动/AI）被拆到两个层级**，与用户心智「制卡是一件事的两个方式」不符。
2. 解释板块**常驻占高**：即使从未使用解释，解释页签体 + 底部输入条始终占据坞体约一半高度，挤压制卡区。
3. 解读方式是一个下拉选单（`ExplainModeSwitcher`），三步操作（点开→读→选）且与「发送」分离，动作链长。
4. 解释内容（答案/线程）没有「取一段去制卡/去引用」的出口，只有整条答案悬停「制卡」；手动制卡与 AI 制卡之间草稿互不相通。
5. 阅读选单的「制卡 / AI 制卡 / AI 解释」与解释板块、全局场景各是一套入口，**同一意图三种入口**（决策 5/6/7 将其归一为三按钮）。

## 2. 信息架构

### 2.1 新 IA（右侧放置，上→下）

```
┌─ 制卡   [手动制卡｜AI 制卡]                    [收起▾] ┐  ← 板块头行 34px+1px hairline（D142 不变）
│  页签体（两体常驻挂载，display:none 切换保活）           │
│   · 手动制卡体＝既有 ManualCardForm（dock variant）     │
│   · AI 制卡体＝FreeSource 或 AI 草稿面板（既有）          │
├──────────────────────────────────────────────────┤
│  [▴ 展开 / ▾ 收起]（仅有内容或已展开时在场，20px）       │  ← 解释板块开合把手
│  （展开态）解释内容滚动区：引用块 / 答案 / 追问线程        │
│  [自动] [通用解读] [简明解读] [自由提问]                  │  ← 悬浮按钮行（解读方式按钮化 + 自由提问）
│  [输入框……………………………………………………] [发送] │  ← ChatComposer，单行 32px 起步随输入向上增
└──────────────────────────────────────────────────┘
```

- **制卡板块**：头行＝板块题「制卡」+ 页签（手动制卡｜AI 制卡，默认手动）+ 右端收起箭头（整个板块可收成头行，沿用既有 `manualCollapsed` 机制语义，更名「制卡板块收起」）。页签语法不变：选中＝墨字 + 2px accent 下划线（D123 §7.3 / D142 保留项）。
- **解释板块**：恒在坞底。两态——
  - **收起态（默认）**：仅 悬浮按钮行 + 输入条。无任何既有内容时**把手不在场**（真正「只留输入框和悬浮按钮」）。
  - **展开态**：把手 + 内容滚动区（上限高度，见 §3）+ 悬浮按钮行 + 输入条。发送首条问题/解释后**自动展开**；把手一键收起/再展开，状态会话内记忆（不持久化，每次应用启动回到收起）。
- 内容派生规则（沿用 D92「显式点击 > 内容派生」）：AI 制卡内容到达 → 制卡板块自动切到「AI 制卡」页签；解释内容到达（发送/重跑/追问）→ 解释板块自动展开；「复制」动作到达 → 切到「手动制卡」页签。显式点击页签/把手后，同一会话内不再被派生规则打扰（无新内容到达时）。

### 2.2 与现状的差异映射

| 现状（D123） | 新 IA | 处置 |
| --- | --- | --- |
| 手动制卡区（独立板块） | 制卡板块·「手动制卡」页签体 | 平移，表单零改动 |
| AI 区·「制卡」页签 | 制卡板块·「AI 制卡」页签体 | 平移，面板零改动 |
| AI 区·「解释」页签（页签条 + 常驻体） | 解释板块（底部，默认收起） | 结构重做（内容组件全部复用） |
| `ExplainModeSwitcher` 下拉 | 悬浮按钮行「自动/通用解读/简明解读」 | 下拉退役，按钮化（含「自由提问」） |
| 阅读选单「制卡/AI制卡/AI解释」 | 三按钮「AI 制卡 / 复制 / 引用」 | 替换（决策 7），见 §4.5 |
| —（无） | 跨页签幽灵草稿同步 | 新增，见 §4.2 |
| —（无） | 解释板块内选区三按钮选单 + 全局选单 | 新增，见 §4.5 / §5 |

## 3. 布局与样式规格

### 3.1 几何（右侧放置；token 全部既有）

| 部位 | 规格 |
| --- | --- |
| 坞宽 | `var(--wb-w)`（现状 400px，不变） |
| 制卡板块头行 | 34px + 1px 下缘 `--border-subtle`（D142 #1/#10 不变）；题「制卡」与页签同起点（标题列等宽 5.2em 纪律沿用） |
| 制卡板块体 | `flex:1; min-height:0`；收成头行机制＝既有 `.collapse-clip wb-manual-clip`（240ms/200ms，保留） |
| 解释板块把手 | 高 20px，全宽；居中 `IconChevronDown` 14px（展开态 `is-flip`）；hover 底色 `--grey-1`（MOTION §4）；仅有内容或已展开时渲染 |
| 解释内容区 | 展开态 `flex:0 1 auto; max-height:55%`（相对坞高），`overflow-y:auto`（滚动条隐藏纪律不变）；收合走 `.collapse-clip` |
| 悬浮按钮行 | 高 28px；`padding: 0 16px`（与输入条文字左缘 16px 对齐，D142 左缘纪律）；`display:flex; gap: var(--sp-2)`；按钮＝ghost 文字钮：13px `--fs-secondary`、`--text-secondary`，hover 底 `--grey-1`（160ms `--ease-enter` 进 / 200ms `--ease-out-soft` 出），**当前方式**＝accent 字 + 2px accent 下划线（页签同族语法）；行贴输入条上缘（`margin-bottom: 4px`） |
| 输入条（ChatComposer） | 既有契约不变：单行 32px 与「发送」钮同高对齐（32=32）、`growTextarea` ≤120px、上缘 1px `--border-subtle`（D142 #15）、V1 下缘一划输入面、placeholder `--text-placeholder` |
| 解释板块上缘 | **不新增分区线**：内容区与制卡板块之间仅 1 条 hairline（把手行上缘或 composer 上缘线承担，一处一线，D142 纲领 1） |

### 3.2 三放置适配

| 放置 | 行为 |
| --- | --- |
| right（默认） | 上=制卡板块 / 下=解释板块（§2.1 图） |
| bottom | 左=制卡板块 / 右=解释板块（`border-right` subtle 竖线为唯一分隔，D142 #9 口径）；解释板块在其列内同样「按钮行 + 输入条贴底、内容向上展开」；解释内容区 `max-height` 改为相对列高 55% |
| window（独立窗口） | 与 right 同构、占满 `wbw-body`；置顶/关闭头行（`wbw-bar`）不变 |

### 3.3 新元素视觉

| 元素 | 样式 |
| --- | --- |
| 幽灵草稿（§4.2） | 覆盖在目标输入面上的定位层（field 容器 `position:relative` 内 absolute 铺满，padding 与输入面一致）：文本＝来源内容（最多显 3 行，超出 `…` 截断），13px，色 `--text-placeholder`；尾部同行 chip「Alt+Enter 填入」（mono，`--fs-meta`＝12px——**偏差登记 2026-10-13：原稿 11px 无 token 档，按 swiss 字体 token 纪律取 Meta 档**，`--text-placeholder`，1px `--border-subtle` 下缘线）；整层 **可点**（点击＝填入）；输入面其余区域点击仍聚焦编辑 |
| 选区三按钮选单（解释板块内） | 复用 `.menu selection-menu` 浮条语法（paper + hairline + `--shadow-float`，D122）：一行三文字钮「AI 制卡｜复制｜引用」，`sel-btn` 同款，高 28px |
| 全局选单（软件外） | 同款视觉：paper 底 + 1px hairline + `--shadow-float`、三文字钮（13px），高 28px，圆角 0（Swiss 直角）；机制由核心方案补充（§5） |

## 4. 交互流

### 4.1 页签切换（手动制卡 ⇄ AI 制卡）

- 默认「手动制卡」。点击页签切换；**两体常驻挂载、`display:none` 切换**（沿用现 `dock-tabbody` 保活手法）——已输入内容、AI 草稿面板、流式状态全部无损（决策 2）。
- 切换无内容动画（页签下划线瞬时，与现 dock-tabs 一致）；切换瞬间若目标页签首框为空且另一页签首框有内容 → 幽灵出现（§4.2）。

### 4.2 跨页签草稿幽灵同步（决策 3）

- **源**：手动侧＝当前题型的第一文本框内容（问答/翻转/图片挖空＝正面 `front`；填空＝挖空文本）；AI 侧＝`FreeSource` 材料框文本（其 state 自本稿上提到 `SelectionPanels` 受控，见 §6）。
- **显示条件（全部满足）**：目标页签成为当前页签 ∧ 目标首框**为空** ∧ 源文本非空 ∧（AI 侧）制卡草稿面板不在场（FreeSource 可见）。
- **呈现**：§3.3 幽灵层；内容随源实时更新（源改了幽灵跟着改）。
- **接受**：按 **Alt+Enter**（目标输入面聚焦时）→ 把**源全文**写入目标首框（不是截断的 3 行），幽灵消失，光标落文末。`Alt+Enter` 为本稿新增**坞内固定键**（不经 CommandRegistry；与 Ctrl+K 同例，D123 §1-11 先例）；冲突核查：坞内现无 Alt+Enter 绑定（Ctrl+Enter＝制卡/发送、Ctrl+Shift+C/Ctrl+Alt+Shift+C＝挖空、Enter/Shift+Enter＝composer），中文 IME 不占用（Ctrl+Space 已避开）。
  **修订（v48.101 / D146，用户 2026-10-13 实测反馈）**：点击幽灵层接受**退役**——幽灵层改 `pointer-events:none` 纯指示（点击穿透到输入面，聚焦/光标定位照常），接受唯一路径＝Alt+Enter；用户实测「一点就自动填入」违背预期。
- **消失（除接受外）**：用户在目标框任何真实输入 / 源被清空 / 切离页签。**修订（v48.101 / D146）**：用户在目标框主动输入过内容（非空）后，该源内容**出列不再提供**（拒绝闩——源内容快照比对，源变化后重新提供；Alt+Enter 接受不算主动输入），用户清空目标框幽灵也不复现。源内容**永不因幽灵机制被改写**（无损红线）。
- **呈现修订（v48.101 / D146）**：幽灵在场时目标输入面占位说明文字隐藏（CSS `:has()`——两层文字同位叠加发虚，用户实测）。
- 同一时刻至多一处幽灵在场。

### 4.3 解释板块：收起 / 展开 / 发送（决策 4）

- **悬浮按钮行语义矩阵**（按钮＝动作 + 当前方式双职）：

| 点击时输入框 | 无解释语境（无 panel/线程） | 有解释语境 |
| --- | --- | --- |
| 空 | 仅置为「当前方式」（accent 下划线迁移），不发送 | 置为当前方式并按该方式**重跑当前材料**（＝既有 `changeExplainMode` 切换即重跑，D91 §5.3） |
| 有文字 | 以该方式**发送输入文字**：自动/通用/简明 → `runExplain(文字, null, 对应方式)`；自由提问 → `runAsk(文字)`；发送后清空输入框并**自动展开**板块 | 同左（新语境盖旧语境，既有 `runExplain` 会清线程，保留该语义） |

- **Enter / 「发送」钮**＝按「当前方式」发送（默认「自动」；当前方式会话内记忆，即既有 `explainMode` state）；当前方式为「自由提问」时 Enter 走 `runAsk`。Shift+Enter 换行、IME 组合态不发送（现状保留）。
- **输入框增高**：随文本行数向上长（≤120px），悬浮按钮行随之上移——「悬浮在文本框上方」恒成立；动效＝既有 `--dur-panel` 高度过渡（D123 修订 2）。
- **自动展开**：任何发送（按钮/Enter）或解释内容到达时板块自动展开；**把手**随时一键收起/再展开；收起不打断在途流式（流继续，状态保留，再展开即见）。
- 展开态内容区＝既有解释页签内容平移：引用块（`ai-quote`）、`AIStatus` 计时/停止行、答案 Markdown（D118 流式、剥离 ste 标记）、事后建议行（`ai-suggest`）、快捷追问 chips（通俗解释/严格定义/举个例子/为什么）、「就此制卡」钮、`ExplainThread` 追问线程。**`ExplainModeSwitcher` 下拉自此全部退役**（AIPanel explain 分支首行不再渲染切换器——方式表达唯一归口＝悬浮按钮行）。

### 4.4 解释板块内选区三按钮选单（决策 5）

- **触发**：在解释板块内容区（引用块、答案、追问线程的问答文本）选中 ≥1 字符，mouseup 后出现于选区上方（放不下翻到下方）——定位复用 `src/lib/popoverPlace.ts`（与 D122 同一函数，锚＝选区包围盒）。
- **选单**：一行三钮「AI 制卡｜复制｜引用」（§3.3）。点击不夺走正文选区（`onMouseDown preventDefault`，SelectionMenu 既有手法）。
- **关闭**：执行任一动作 / Esc / 点击选单外 / 选区坍塌。
- **三按钮动作规格（全局统一，三处场景同一映射）**：

| 钮 | 动作 | 落点 |
| --- | --- | --- |
| a. AI 制卡 | `runAICards(选中文本)`（既有管线零改动） | 坞展开；制卡板块切「AI 制卡」页签；流式草稿面板出现 |
| b. 复制 | 写入**手动制卡当前题型第一文本框**：空→直写；非空→末尾补两个换行后追加（**永不覆盖既有输入**）；随后聚焦该框文末 | 坞展开；制卡板块切「手动制卡」页签；若手动侧有幽灵在场则幽灵先退场（真实内容到达） |
| c. 引用 | 向解释输入框**头部**插入 `> 选中文本` + 空行（既有草稿保留在其后，永不覆盖）；板块**保持收起**，聚焦输入框文末 | 解释板块（不自动展开——用户尚未发送） |

### 4.5 阅读选单替换（决策 7）

- `SelectionMenu` 动作区由「批注 / ~~制卡~~ / ~~AI 制卡~~ / ~~AI 解释~~ / 查词」改为「批注 / **AI 制卡 / 复制 / 引用** / 查词」——三钮与 §4.4 同一组件、同一动作映射（落点＝本窗口坞）；色点、标注选项不动。
- 呈现仍随 `app.selectionBarStyle`（icon/text）；图标槽：AI 制卡＝既有 `IconSelAiCards`；复制/引用新增两枚 16px 图标（§6）。
- **锁定键位语义改映射（键位不变）**：`Ctrl+Z`＝复制（原「制卡」）、`Ctrl+X`＝AI 制卡（不变）、`Ctrl+A`＝引用（原「AI 解释」）、`Ctrl+D`＝查词（不变）。Command id 不变（`reader.makeCard` 等），仅动作体改为 §4.4 映射——GUIDE §9.1 键位表加脚注登记（§11）。

### 4.6 既有行为保留清单（不回归）

坞开合（顶栏按钮 / Ctrl+K / Esc）、三放置与推让/外延（workbenchLayout 零改动）、独立窗口单例与置顶、手动制卡全部功能（四题型、更多区、带入选区/带入 AI 回答、自动填写、Ctrl+Enter 制卡）、AI 制卡全部功能（材料类型路由/重跑/知识点与后续可补/图片挖空截图链）、D118 流式与停止、D91 切换即重跑（改为按钮行承载）、D141 禁用无 🚫、D142 全部线条与输入面结论。

## 5. 全局选单交互规格（决策 6；机制由核心方案补充）

> 本节只定义交互契约。跨进程文字捕获、全局快捷键注册、覆盖窗口与 IPC **由 core-engineer 平行技术方案实现**；下列标注「〔核心〕」处为机制留白。

- **触发**：〔核心〕在任意前台应用（含本软件之外）完成一段文字选择（鼠标抬起或键盘选区稳定 ~300ms）→ 选单出现于**选区上方**（放不下翻到下方），同一行三钮「AI 制卡｜复制｜引用」（§3.3 视觉）。
- **抑制**：前台窗口为本软件时全局选单**不出**（本软件内由 §4.4/§4.5 的坞内/阅读器选单承担，同三钮）〔核心：前台窗口归属判定〕。
- **快捷键**：三钮各自可在设置中配置独立快捷键；按快捷键＝不出选单直接对当前选区执行对应动作。**默认全部未分配**（零冲突起步；用户自行录入）。选单本身不依赖快捷键即可用。
- **动作落点**：全局三钮 → **独立制卡台窗口**（`workbench` 单例；呼出即显示并置顶，既有 `win:workbench("show")` 链）：AI 制卡＝窗口内 `runAICards(文本)`；复制＝窗口内写手动首框并切页签；引用＝窗口内解释输入框头部插引用块并聚焦（板块保持收起）。动作语义与 §4.4 表逐字一致。
- **关闭**：执行动作 / Esc / 点击选单外任意处 / 选区坍塌 / 前台窗口切换。
- **设置项（交互面）**：设置页「数据与效率」组新增「全局选中选单」子块——①总开关（默认开）；②三行快捷键录入框（AI 制卡/复制/引用；支持冲突检测，沿用 M4 设置页既有冲突检测与恢复默认模式）；③一行说明「在任意软件中选中文字后显示三按钮选单」。设置键：`app.globalSelection.enabled`（boolean，默认 true）、`app.globalSelection.shortcuts`（`{aiCards:string|null, copy:string|null, quote:string|null}`，默认全 null）。〔核心：键的写侧归一与注册时序〕
- **总开关关闭**：选单不出现、快捷键不注册；本软件内选单（§4.4/§4.5）**不受影响**。

## 6. 组件拆分

| 组件/文件 | 职责与改动要点 |
| --- | --- |
| `src/components/CardDock.tsx` | 容器重构：`wb-manual` 区 → **制卡板块**（头行：题「制卡」+ 两页签 + 收起箭头；页签体×2 常驻）；新增**解释板块**（把手 + `.collapse-clip` 内容槽 + 悬浮按钮行槽 + composer 槽）。props 以页签（`manual|aicards`）、解释板块开态、把手显隐为输入。三放置布局样式适配 |
| `src/components/SelectionPanels.tsx` | 编排中枢：新页签 state（默认 manual）、解释板块开态 state、**FreeSource 文本与手动首框文本受控上提**（幽灵同步的数据源）、幽灵派生逻辑、三按钮动作（`trioAICards/trioCopy/trioQuote`）、解释板块内选区监听与选单渲染 |
| `src/components/AIPanel.tsx` | `ExplainModeSwitcher` 退役（导出删除）；新增导出 `ExplainModeBar`（四 ghost 钮：自动/通用解读/简明解读/自由提问，props＝当前方式 + 输入是否有字 + 是否有语境 + 回调）；`ChatComposer` 增加受控值/引用块插入/caret 末尾 API（引用动作落点）；explain 分支首行切换器移除；其余零改动 |
| `src/components/ManualCardEditor.tsx` | 仅第一文本框值受控上提（或等效 ref API），供幽灵同步与「复制」动作读写；表单其余内部状态、载荷、题型页签零改动 |
| `src/components/DockTrioMenu.tsx`（新建） | 三按钮选单（AI 制卡/复制/引用）：坞内解释板块实例 + 导出视觉规格供全局覆盖窗口复用〔核心侧是否直接 import 由核心方案定〕 |
| `src/components/SelectionMenu.tsx` | 动作区三旧钮换三新钮（§4.5）；其余（色点/批注/标注选项/定位）零改动 |
| `src/components/selectionIcons.tsx` | 新增 `IconSelCopy`（矩形+入卡箭头）、`IconSelQuote`（引号）两枚 16px 线性图标，风格对齐既有 `IconSel*` |
| `src/lib/useSelectionActions.ts` | 新增 `actTrioCopy` / `actTrioQuote`（`actTrioAICards`＝现 `actAICards` 直接复用）；`actManualCard`/`actAIExplain` 的阅读器入口语义按 §4.5 改映射；解释板块开态与 FreeSource/手动首框文本通道 |
| `src/workbench.tsx` / `FreeWorkbenchHost.tsx` | 零结构改动（共享链自动生效）；验收时作为「两处同步」的核对面 |
| `src/theme.css` | 新样式全部落此：制卡板块页签（复用 dock-tabs 语法）、解释板块（把手/按钮行/内容区/折叠）、幽灵层、三按钮选单；退役 `.ai-explain-mode` 下拉样式与旧 `wb-ai` 页签头（无引用后清理） |

## 7. 状态矩阵

| 元素 | 默认 | Hover | Focus | Loading | Empty | Error | Success | Disabled |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 制卡板块页签 | 手动签选中（accent 下划线） | 底 `--grey-1` | focus-visible 2px accent 外描边（瞬时） | — | — | — | — | — |
| 手动/AI 页签体 | 常驻挂载 | — | — | AIStatus 行（制卡面板内，既有） | 手动＝空表单（placeholder 引导）；AI＝FreeSource + 提示 | `.ai-error`（既有） | 草稿/卡片列表（既有） | — |
| 悬浮按钮 | secondary 字 ghost | 底 `--grey-1`（160/200ms） | 2px accent 外描边瞬时 | 发送后 AIStatus 出现在内容区 | 输入空且无语境→Disabled（色阶表达，cursor default，D141） | 发送失败＝内容区 `.ai-error` | 答案流入内容区（流式） | grey-2 字无底 |
| 当前方式（选中钮） | accent 字 + 2px 下划线 | 同 Hover | 同 Focus | — | — | — | — | — |
| 输入框（composer） | V1 下缘一划（D142） | 线色 strong | accent 底线 + 1px 厚化瞬时（D142 §3.1） | 发送中发送钮 Disabled | placeholder「追问，或自由提问…」 | — | — | — |
| 发送钮 | accent 实底白字 | 深一档（D142 H1） | 同既有 | — | 输入空→Disabled（grey-1 底 + placeholder 字，D142 D2） | — | — | 同 Empty 档 |
| 幽灵草稿 | 源有内容且目标空→淡入 150ms | 整层可点（底色 `--grey-1` 40%？**否**——无线无底的纯文字层，hover 仅 chip 文字转 `--ink`） | 目标框聚焦后 Alt+Enter 可接受 | — | 不满足显示条件即不在场 | — | 接受后写入真实文本 | — |
| 解释板块把手 | 仅图标居中 | 全行底 `--grey-1` | 2px accent 外描边 | — | 无内容且收起→把手不在场 | — | — | — |
| 三按钮选单 | pop-in 220ms（§8.4 存量豁免） | 钮底 `--grey-1` | 2px accent 外描边 | AI 制卡点出后选单即关、坞内 AIStatus 承担 | 选区为空不出现 | 动作失败＝既有 toast/`.ai-error` 链 | 复制/引用成功＝目标框内容就位（无额外 toast，视线落点即反馈，MOTION §9-2） | — |

## 8. 动效规格（全部既有 token，零新增）

| 场景 | 规格 | 依据 |
| --- | --- | --- |
| 解释板块展开 | `.collapse-clip` grid 0fr→1fr，`--dur-panel`(240ms) `--ease-out-soft`；内容 opacity 延迟 50ms 淡入；把手 chevron `rotate(180deg)` 240ms | MOTION §7 |
| 解释板块收起 | 200ms `--ease-out-soft`；内容 opacity 先走 | MOTION §7（exit 略快） |
| 制卡板块收成头行 | 既有 `.wb-manual-clip` 机制原样 | D123 §7.4 / MOTION §7 |
| 输入框随输入增高 | 既有 `growTextarea` + `--dur-panel` 高度过渡 | D123 修订 2 |
| 悬浮按钮行随输入框上移 | 布局流内自然位移，**不做位移动画**（§3-5：非用户主动作引起的状态切换才动——输入即主动作但高度过渡已覆盖视觉连续性，不再叠加第二动效，§9-1 单主角） | MOTION §3/§9 |
| 幽灵出现/消失 | opacity 0→1 `--dur-enter`(150ms) `--ease-enter`；消失瞬时（输入即隐不等动画，ux-friction） | MOTION §1 |
| 三按钮选单 | 挂既有 `pop-in`（220ms `--spring`，存量豁免不再改）；origin 随翻边（上锚 `50% 100%`/下锚 `50% 0%`） | MOTION §8.4 |
| 全局覆盖窗口选单 | 视觉同上；窗口显隐本身瞬时〔核心〕 | MOTION §8.5（弹出面板族语义） |
| 页签切换 | 无内容动画；下划线瞬时 | 现 dock-tabs 语法 |
| reduced-motion | 以上凡装饰/位移性规则一律写 `@media (prefers-reduced-motion: no-preference)` 内；`.collapse-clip` 功能性过渡在 `reduce` 块显式 `transition: none`（沿用本仓既有双轨） | MOTION §3-2 |

**红线自查**：hover 零抬升零阴影；零动画库；只动 transform/opacity（折叠走 §7 特许的 grid-template-rows）；无裸写 ms/缓动；`--spring` 不扩散。

## 9. 窗口尺寸变化行为

- resize 引起的一切重排**瞬时**（MOTION §3-5）；坞宽恒定 `--wb-w`，不随窗宽变。
- 右放置坞高随窗高：制卡板块体 `flex:1` 伸缩；解释内容区 `max-height:55%` 随坞高同比缩放；窗高 < 560px 时制卡板块体 `min-height` 让位于解释板块收起态（把手+按钮行+输入条恒完整可见，不被裁切）。
- 底部放置：两板块左右列；列宽随窗宽等比，悬浮按钮行在窄列下保持单行（四钮文案 2–4 字，按 `flex:0 1 auto` 收缩间距，不换行不省略）。
- 独立窗口可缩放：布局同 right；最小宽高沿现状。

## 10. DOM / 测试契约

| 类别 | 项 |
| --- | --- |
| 保留 | `[data-card-dock][data-placement]`、`data-testid="workbench-dock"`、`workbench-entry`（顶栏钮）、`wb-composer`、`wb-free-source`、`wb-manual-toggle`（语义改为「制卡板块收起」）、`ai-status`、`wb-thread` |
| 变更 | `wb-manual` → `wb-cards`（制卡板块 section）；`dock-tabs` → `wb-cards-tabs`；`dock-tab-explain`/`dock-tab-cards` → `wb-tab-manual`/`wb-tab-aicards`；`data-dock-tabbody` → `data-wb-tabbody="manual\|aicards"` |
| 新增 | `wb-explain`（解释板块 section）、`wb-explain-toggle`（把手，`aria-expanded`）、`wb-explain-body`（内容区）、`wb-mode-bar` + 每钮 `data-mode="auto\|general\|ste\|ask"`、`wb-ghost`（幽灵层，`data-accept-key="Alt+Enter"`）、`dock-trio` + 每钮 `data-trio-act="aiCards\|copy\|quote"` |
| 退役 | `ExplainModeSwitcher` 的 `data-testid="explain-mode"` 及 `.ai-explain-mode` 样式；解释空态里的 FreeSource(prefer="explain") 实例（解释入口唯一归口＝底部输入条） |
| 测试义务 | 引用旧 testid 的 GUI/flows 断言按上表更新（grep `dock-tab-explain\|dock-tab-cards\|wb-manual\|explain-mode` 全仓清零或改写）；d91-d92.gui / m1.gui / m4.gui / annotations.gui 相关选择器同步；f11/f18/f20/f21/f24/f27 文档闸门涉及的 § 编号不动 |

## 11. GUIDE 登记任务项（先改文档再编码，硬不变量 3）

1. 版本号：`AI_DEVELOPMENT_GUIDE.md` 标题行 v48.99 → **v48.100**。
2. §8.1 决策日志新增 **D144** 行：制卡台 IA 重设计（两板块 + 解释板块底部收起 + 解读方式按钮化/自由提问 + 跨页签幽灵同步 + 选区三按钮归一 + 全局选单），设计稿路径 `docs/design/D144-CARDDOCK-IA-REDESIGN.md`，关联 D123（IA 修订）/D142（样式层保留）/D122（选单动作区替换）/D91（切换即重跑改由按钮行承载）/D118（流式保留）。
3. §9.2 主线状态表新增 D144 行（状态随实施进度更新）。
4. ~~§9.1 键位表加脚注~~：**延后（范围修订，随 §4.5 一并交付）**。
5. ~~设置键登记（D52 登记处，grep「设置键登记」定位）：新增 `app.globalSelection.enabled`、`app.globalSelection.shortcuts`~~：**延后（范围修订，随全局线一并交付）**。
6. §6 产品规格：grep 定位 D123（制卡台）/D122（选区浮条）规格小节，IA 描述按本稿 §2/§4 修订（改动锚点只修订描述，不动既有 § 编号与 D 编号）。
7. MOTION-DESIGN-SPEC 与 swiss 文档：本次零修订（§8 自查全部落在既有规范内）。

## 12. 可机械检查的验收标准清单（供总控）

1. `grep -n "wb-cards\|wb-explain\|wb-mode-bar\|wb-ghost\|dock-trio" src/` ≥ 每词 1 处；`grep -rn "dock-tab-explain\|dock-tab-cards\|explain-mode" src/ tests/ | wc -l` = 0。
2. `grep -nE "(transition|animation):[^;]*[0-9]+ms" src/theme.css` 新增命中为 0（全部走 token）；新增 `@keyframes` 为 0（全部复用既有）。
3. `grep -c "prefers-reduced-motion" src/theme.css` ≥ 现状；解释板块折叠规则与既有 `.collapse-clip` 同族（grep 命中 `.collapse-clip` 新增选择器）。
4. GUIDE：标题行含 `v48.100`；`grep -n "D144" AI_DEVELOPMENT_GUIDE.md` ≥ 2（§8.1 + §9.2）；`grep -n "globalSelection" AI_DEVELOPMENT_GUIDE.md` ≥ 1。
5. 行为（GUI 冒烟）：①默认进坞＝手动制卡页签、解释板块仅按钮行+输入条；②两页签互切内容不丢（各输入后往返比对值）；③手动首框输入 → 切 AI 制卡出现幽灵（灰字 + 「Alt+Enter 填入」），按 Alt+Enter 全文写入 FreeSource；反向同理；④输入框键入 → 点「简明解读」→ 板块自动展开且答案流式出现；把手收起/再展开状态保留；⑤解释答案内选中文字 → 三钮选单出现；点「复制」→ 手动首框尾部追加且页签切至手动；点「引用」→ 输入框头部出现 `> ` 引用块且板块保持收起；点「AI 制卡」→ AI 制卡页签出现流式草稿；⑥阅读器选中文本 → 选单动作区为「批注/AI 制卡/复制/引用/查词」；Ctrl+Z/Ctrl+A 分别为复制/引用语义。
6. 独立窗口（Ctrl+Alt+K）与右侧坞同屏对照：两板块、页签、按钮行、幽灵、三钮选单逐参数一致（共享组件天然一致——验收截图存档）。
7. `npm run build` 通过；`tsc --noEmit` 0 错；`git diff package.json` 为空（零新依赖）。
8. reduce 模式：板块开合、幽灵出现、选单弹出全部瞬时且终态正确。
9. 禁用纪律：按钮行空输入禁用态 `cursor: default`（D141）；hover 全程无位移无阴影（D120 §4）。

## 13. 任务拆解表（供总控逐项派发）

| # | 任务 | 建议执行者 | 涉及文件 | 可机械检查的验收标准 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| 1 | GUIDE 先行：版本 bump v48.100 + §8.1 D144 行 + §9.2 行 + §9.1 脚注 + 设置键登记 + §6 相关小节修订（§11 全七项） | frontend-builder | `AI_DEVELOPMENT_GUIDE.md` | 验收 #4 全过；既有 §/D 编号零改动（`git diff` 人工核对只增不改） | 无（最先派） |
| 2 | CardDock 容器重构：制卡板块（两页签+收起）+ 解释板块骨架（把手/按钮行槽/composer 槽/折叠槽）；三放置样式；旧 `wb-ai` 页签头退役 | frontend-builder | `src/components/CardDock.tsx`、`src/components/SelectionPanels.tsx`、`src/theme.css` | 验收 #1、#3；行为 ⑤ 的把手/板块开收；build 过 | #1 |
| 3 | 解释板块功能：ExplainModeBar 四钮（语义矩阵 §4.3）+ ChatComposer 受控/引用插入 + ExplainModeSwitcher 退役 + 内容平移与自动展开 | frontend-builder | `src/components/AIPanel.tsx`、`src/components/SelectionPanels.tsx`、`src/lib/useSelectionActions.ts`、`src/theme.css` | 行为 ④；`grep -n "ExplainModeSwitcher" src/` 仅剩删除痕迹；流式/重跑/停止不回归 | #2 |
| 4 | 跨页签幽灵同步：FreeSource/手动首框文本受控上提 + 幽灵层（§4.2 显示/接受/消失全规则）+ Alt+Enter 坞内键 | frontend-builder | `src/components/SelectionPanels.tsx`、`src/components/ManualCardEditor.tsx`、`src/components/AIPanel.tsx`（FreeSource 宿主）、`src/theme.css` | 行为 ③ 双向；`grep -n "wb-ghost" src/` ≥ 2；无损红线（源值不被改写）人工核对 | #2、#3 |
| 5 | 坞内三按钮选单：`DockTrioMenu` 新建 + 解释板块选区监听 + 三动作（§4.4 表）+ 两枚新图标 | frontend-builder | `src/components/DockTrioMenu.tsx`（新）、`src/components/SelectionPanels.tsx`、`src/components/selectionIcons.tsx`、`src/lib/useSelectionActions.ts`、`src/theme.css` | 行为 ⑤；`grep -n "data-trio-act" src/` ≥ 3 | #3 |
| 6 | **延后（范围修订，随全局线一并交付）** 阅读选单替换 + 键位语义改映射（§4.5） | frontend-builder | `src/components/SelectionMenu.tsx`、`src/lib/useSelectionActions.ts`、宿主（Reader/ExtractReviewView 调用点） | 行为 ⑥；旧三动作在选单 UI 层不再出现（`grep -n "selAct.manual\|selAct.explain" src/components/SelectionMenu.tsx` = 0） | #5 |
| 7 | **延后（范围修订，随全局线一并交付）** 设置页「全局选中选单」子块 UI（总开关 + 三快捷键录入 + 说明行；读侧归一 hook） | frontend-builder | `src/components/SettingsPanel.tsx`、`src/lib/`（新 settings hook） | 设置页出现子块；`app.globalSelection.*` 读写往返正确；冲突检测复用既有模式 | #1（设置键已登记）；机制接入口待 #8 |
| 8 | **延后（范围修订，入路线图，方向待定后另派）** 全局选单机制对接：**由 core-engineer 平行方案实施**（跨进程捕获/覆盖窗口/全局快捷键注册/IPC）；本行仅登记对接面——渲染层交付物＝`DockTrioMenu` 视觉规格与三动作 IPC 入参契约（文本 + 动作 id） | core-engineer（实施模式，核心域限定：electron/* 与新增覆盖窗口） | `electron/`（机制）、`DockTrioMenu` 复用 | 核心方案自身的验收标准；UI 侧核对：覆盖窗口三钮视觉与 §3.3 一致、动作落点行为与 §5 表一致 | core 方案 + #5 |
| 9 | 测试与契约更新：旧 testid 断言清零（§10）、d91-d92/m1/m4/annotations 相关套件选择器更新、f 系列闸门复跑、GUI 冒烟（验收 #5 六项 + #6 两处同步 + #8 reduce） | frontend-builder | `tests/`（选择器与断言） | 验收 #1、#5、#6、#8；更新后套件前后差分无新红 | #2–#6 |
| 10 | 终审：对照本稿 §2–§9 与验收 #1–#9 逐项核 | code-reviewer | 只读 | 合格/不合格 + 必须修复项 | #1–#9 |

**派发顺序建议**：#1 → #2 → #3 → #4 → #5 → #6（→ #7 可与 #6 后并行）→ #8（core 平行线，不阻塞 #9 的坞内部分）→ #9 → #10。每项一轮 code-reviewer。

## 14. 范围外 / 风险

**范围外**：全局捕获与覆盖窗口机制（core 方案）；AI 提示词与制卡管线改动（零改动）；卡片数据模型/调度；`CaptureEditor` 快速记录窗口（与本稿无关，§1.1 指针更正）；解读方式新增第四种提示词（「自由提问」走既有 `runAsk` 通道，非新提示词）；全局选单在本软件内重复出现的问题（§5 抑制规则已约定，由核心落实）。

**风险与回归重点**：
1. **三放置回归**：CardDock 结构大改，bottom/window 放置与推让/外延链（修订 5–9 的时序修复）必须在 #9 重点复验（开合不同步、顶栏跳动、聚焦屏外元素三例历史 bug）。
2. **保活回归**：两页签体 + 解释内容区全部 `display:none` 保活，流式/计时/草稿在切换与收合后不丢（D92 既有契约，行为 ④⑤ 覆盖）。
3. **幽灵误填**：接受动作只写目标框、绝不回写源框；目标框非空时幽灵不得出现（防覆盖）。
4. **键位语义改映射**（Ctrl+Z/Ctrl+A）属用户拍板的替换，但须在设置页快捷键表与 GUIDE §9.1 脚注同步文案，避免「同一事实两套解释」。
5. **`ExplainModeSwitcher` 退役**：其「切换即重跑」语义由按钮行完整承接（§4.3 矩阵），验收时对照 D91 §5.3 逐条过。
