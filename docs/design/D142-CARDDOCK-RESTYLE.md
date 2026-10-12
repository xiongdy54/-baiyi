# D142 · 制卡台（CardDock）样式改版设计 —— 线条收敛 + 文本输入面变体 + 发送钮

> 决策号 D142（已登记：GUIDE §8.1 决策日志 D142 行，v48.99；实施记录与逐条验收见 `docs/design/D142-IMPLEMENTATION-REPORT.md`）。遵循 `docs/swiss-international-style.md` + `docs/design/MOTION-DESIGN-SPEC.md`（D120）。
> 本稿**零产品代码**：写入范围仅 `docs/design/` + `design-samples/`。实施走文末任务拆解表。
> 修订对象：`docs/design/CARD-WORKBENCH-D123.md`（修订点与保留项见 §6）。

## 0. 用户原话（逐字）

1. 「制卡台界面（包括通过快捷键 Ctrl+Alt+K 唤出的界面）是同一个界面。我对当前界面的样式很不满意，特别是其中过多的线条和线框，看起来非常杂乱。」
2. 「请参考其文本输入框的样式，来修改我制卡台中文本框的样式和动效。网址：https://uiverse.io/ahmed150up/chilly-rattlesnake-8」

已确认决策（用户已答复，勿再议）：① 发送钮 hover **只变色**，不加阴影、不位移（`--shadow-hover` 已在 v48.76/D120 废除）；② 禁用态不得出现 🚫 光标（D141 已全应用化）；③ 交付形态＝样张 + 版式矩阵 + 实测数（本稿不附「推荐」）。

**用户裁定（2026-10-12，已在样张上选定）**：文本框＝**V1 下缘一划**；发送钮 hover＝**H1 深一档**（现状档）；发送钮禁用字色＝**D2 略提亮**（`--text-placeholder`，见 §4）。实施按此落规则。

**参考稿来源**（uiverse.io 对爬虫 403；源码取自官方开源镜像 `github.com/uiverse-io/galaxy@main → Forms/ahmed150up_chilly-rattlesnake-8.html`）：

```css
.message-input { flex:1; border:none; outline:none; padding:5px; font-size:14px; }          /* 无边框、无背景、仅 placeholder */
.chat-input    { display:flex; align-items:center; padding:10px; border-top:1px solid #ccc; } /* 输入行与上方内容之间恰一条 1px 线 */
.send-button:hover { background-color:rgb(255,255,255); color:rgb(0,0,0);
                     box-shadow:0 4px 18px 0 rgba(0,0,0,.25); }                               /* 反白 + 投影 */
```

采用 / 不采用（逐条给出理由，全部可机械复核）：

| 参考稿要素 | 处置 | 依据 |
| --- | --- | --- |
| 输入框 `border:none` + 无背景 + placeholder 承担提示 | **采用**（V2 为其 token 同构；V1/V3 为同族的保守与填充两档） | 用户点名；Swiss「直角纯色平面」无冲突 |
| 输入行上缘 1px 线（`.chat-input border-top`） | **采用**（坞内追问栏上缘线转 subtle，见 §2 #15） | 参考稿自身也只有这一条线——不是「无线」，是「每条边界一条线」 |
| placeholder 输入后消失 | **采用（原生行为）** | 用户点名；无需任何代码 |
| `outline:none` 且无任何替代焦点反馈 | **不采用** | 违反 Swiss 可访问性硬规则「任何元素不得移除焦点环，除非提供等价可见替代」→ 本设计以 **accent 底线** 承担焦点可见性（§3.1），并在 §3.4 登记该等价替代关系 |
| `:hover` 反白 | **候选 H2**（发送钮，见 §4） | 用户「hover 只变色」→ 只取变色部分 |
| `:hover box-shadow 0 4px 18px` | **拒绝** | 决策 #1；`--shadow-hover` 已废除 |
| 圆角 5px / 卡片外框 | **拒绝** | Swiss 禁圆角；本任务只动制卡台 |

## 1. 现状问题（实测证据）

- 普查（`tests/tmp-d142-census.out.log`，1100×750 内窗、DPR 2.5）：制卡台内**有宽度边框元素 20 个**（详见 §2 矩阵逐条）。同屏线条形态混合：四边盒框 ×7（两字段、两个下拉、标签输入、两个 textarea）、虚线底 ×3、实心强灰线 ×4、透明描边（不可见）×4、小方框 ×1。
- 视觉噪声的三个放大源：① 手动区标题下缘线（subtle）与 AI 区上缘线（**strong**）相距不足 40px 的上下文里再叠一条标题下缘线——「双线」；② 输入面多为**四边框**，与行列留白叠加成「表格感」；③ 同一屏并存三种线色（`--border-subtle` / `--border-strong` / `--grey-2`）与两种线型（solid / dashed）。
- 口径注记（供复核）：普查脚本 `bc=` 取的是 `borderTopColor`；只设了下缘线的元素（如 `.wb-head`）该值回落 `currentColor`＝墨色，**并非可见线的颜色**（可见线实为 `--border-subtle` #e0e0e0）。0.8px = 1px 在 DPR 2.5 下吸附到 2 设备像素后回算（2 ÷ 2.5）——本稿样张实测同口径同数值。

## 2. 线条处置矩阵（对照普查 20 条，逐条）

**三条纲领**（后续新增元素一体适用）：

1. **一条边界只留一条线**：同一 y（或同一分隔意图）附近的两条平行线合并为一条；线色统一 `--border-subtle`，`--border-strong` 退回「hover 反馈 / 浮层描边」用途（不再做分区线）。
2. **输入面不用盒框**：全部文本输入（字段 ×2、自由材料、追问、更多区行字段、标签、挖空）从「四边包围」改为 0~1 条线（变体见 §3）；`textarea` 保留 1px **透明**下缘占位，保证聚焦时零布局移位。
3. **装饰性描边全部退役**：禁用态描边（`.btn-outline:disabled`）、下拉控件的框、虚线段，全部转为「填充差 / ghost 文字 / 实线 hairline」。

| # | 普查行（元素·实测） | 现行规则来源 | 处置 | 依据 |
| --- | --- | --- | --- | --- |
| 1 | `header.wb-head`（手动区标题行，下缘 1px） | theme.css L2886 | **保留**（唯一保留的横向分区线；色阶已是 subtle） | 与摘录页头带同 y 的对齐锚（D123 §10）；标题下缘线同时是页签 2px accent 下划线的基座 |
| 2 | `div.wb-field`×2（正面/背面；四边 1px `--border-strong`，聚焦转 accent） | L8114-8120 | **转化**：删四边框 → 变体矩阵（§3） | 用户核心诉求；其「壳体」职能由 底线/留白/灰块 承担；聚焦由 accent 底线 + 2px 瞬时厚化承担 |
| 3 | `div.wb-more`（上缘 1px subtle） | L8172 | **保留** | 唯一标记「主字段 / 附加字段」边界的线；收起态不在场，展开态一条 hairline 是分组不是框 |
| 4 | `button.dd-btn`（选择领域；四边 `--border-strong`） | L8219 | **删除边框**（坞内 ghost 化：文字 + caret，hover 灰底） | 下拉控件本体＝文字 + caret；与顶栏制卡台按钮 / `wbw-btn` 既有 ghost 语言一致；作用域限 `.side-dock` |
| 5 | `input`（标签输入框；四边 `--border-strong`，311×26） | L4086-4091 | **删除边框**（坞内裸排：行首「标签」label + placeholder 即提示） | 同 #2 政策（输入面不用盒框）；该行已有可见 label，无辨识风险 |
| 6 | `input.wb-line`×3（前缀/助记/知识点；下缘 1px **虚线** strong） | L8176-8190 | **转化**：虚线 → 实线 `--border-subtle`（1px），聚焦 accent | 虚线在 Swiss hairline 纪律里无位置（噪点更高、语义含糊）；保留 1 条/行——更多区行式字段没有底色，底线是「可编辑」的唯一线索 |
| 7 | `input`（标注日期勾选框 13×13；四边 strong） | L8193-8205 | **保留** | 控件本体（方框＝勾选指示），13px 面积极小，不是「线框感」来源；checked 为 accent 实底 |
| 8 | `button.btn.btn-primary`「制卡」（border 透明） | L688-698 | **保留** | 透明描边不可见；禁用态由填充差表达（grey-1 底 + grey-2 字） |
| 9 | `section.wb-ai`（上缘 1px **strong**） | L8106 | **删除** | 与 #10（标题下缘线）相距 34px 构成「双线」——用户「杂乱」的典型来源；分区由留白 + 标题行承担。底部放置同理：删 `border-left`（strong），保留 `.wb-manual` 已存在的 `border-right`（subtle）作唯一分隔（Swiss「列表+详情」模式的 1px 竖线） |
| 10 | `header.wb-head.wb-ai-head`（下缘 1px subtle） | L2886 | **保留** | 两区标题语言对称；页签 accent 下划线的基座 |
| 11 | `button.dd-btn`「自动」（四边 subtle） | L4735-4748 | **删除边框**（同 #4 ghost 化） | 同 #4 |
| 12 | `textarea`（自由材料；四边 strong） | L8236-8250 | **转化**：变体矩阵（§3） | 同 #2；此面为「自由材料」大输入区，改后为纯排印 + placeholder |
| 13 | `button.btn-sm.btn-primary`「AI 解释」（border 透明） | L688-707 | **保留** | 同 #8 |
| 14 | `button.btn-sm.btn-outline`「AI 制卡」禁用态（四边 `--grey-2`） | L761 | **删除描边**（坞内作用域）：`.side-dock .btn-outline:disabled` → 与 base 禁用一致（grey-1 底 + grey-2 字） | 禁用事实已由色阶表达（D141 已删 🚫 光标，色阶是唯一表达者）；描边在纸面上反而制造「可点的框」错觉。全应用同步化不在本次范围 |
| 15 | `div.wb-composer`（上缘 1px **strong**） | L8258 | **转化**：strong → `--border-subtle`（保留 1px） | 参考稿 `.chat-input` 的正是这条线；它是坞内「输入行」的空间承诺。强灰线降为 hairline，消除「三色线」中的一色 |
| 16 | `textarea`（追问，四边 strong） | L3086-3103 | **转化**：变体矩阵（§3） | 用户点名的参考对象本体 |
| 17 | `button.btn-primary.btn-sm.wb-composer-send`「发送」（border 透明） | L688-707 | **保留**；hover/禁用走 §4 矩阵 | 决策 #1：hover 只变色 |
| 18 | `textarea`（制卡页自由材料，0×0 隐藏） | 同 #12 | **同 #12**（同一元素两种页签） | — |
| 19 | `button` AI 解释（0×0 隐藏） | 同 #13 | **同 #13** | — |
| 20 | `button` AI 制卡（0×0 隐藏） | 同 #14 | **同 #14** | — |

### 2.1 同政策延伸（普查 20 条之外、同屏会出现；普查未覆盖页签/未展开区）

| 元素 | 处置 | 依据 |
| --- | --- | --- |
| `.wb-cloze-btn`×3（填空工具行，1px `--border-strong` 盒框） | **删除边框**：转文字钮（accent 字，hover 灰底，disabled＝placeholder 字无框） | 同 #4 政策；工具行按钮不需要框 |
| `.wb-cloze-input`（填空输入） | **已是无框**（既有实现）→ 仅补：focus 底线机制与变体一致 | 与 §3 机制对齐 |
| `.ai-kp` 行分隔 hairline、`.ai-kps-head` ink 下缘线（制卡页有数据时） | **保留** | Swiss hairline 列表语言；ink 线是「节标题」既定语法，未在用户吐槽的「杂」范围内 |
| `.udc-chip` / `.tag-chip`（accent 软底 + accent 描边） | **保留** | 选中态资产（已选领域/标签的可见表达），不是输入面框线 |
| `.dock-badge`（图片挖空徽标，下缘 hairline） | **保留** | — |
| `.ai-error`（error 描边盒） | **保留** | 语义色描边＝校验/错误的标准表达（Swiss 状态设计） |
| `.dd-menu` 浮层（paper + hairline + `--shadow-float`）；`.wb-pick` | **保留** | 浮层是全应用唯一允许阴影处；wb-pick 为无框文字钮 |

### 2.2 线条审计（样张机械实测，可见线口径＝border style≠none ∧ width>0 ∧ 颜色非全透明）

| 口径 | 现状 v0 | V1 | V2 | V3 |
| --- | --- | --- | --- | --- |
| 可见线元素 | 10 | 7 | 4（含聚焦字段 1；失焦后 3） | 4（同 V2） |
| 可见线段 | 28 | 7 | 4（失焦后 3） | 4（失焦后 3） |
| 四边盒框 | 6 | 0 | 0 | 0 |

V2/V3 的 4 段＝2 条标题下缘线 + 追问栏上缘线 + 当前聚焦字段的 accent 底线（截图态）；失焦后仅剩 3 条结构线。V1 的 7 段＝上述 3 + 2 字段底线 + 自由材料/追问两条输入面底线。

## 3. 文本框变体矩阵（≥3 变体；实施时用户从矩阵中挑选）

### 3.1 机制（三变体共用；为什么这样实现）

- **一个机制盖住四类输入面**：`<textarea>` 不支持伪元素，故「聚焦线」不用 `::after + transform`，统一用 **`border-bottom` 颜色过渡 + 聚焦时 1px `box-shadow` 瞬时厚化**：
  - 静止：下缘 1px（V1＝`--border-subtle`；V2/V3＝透明）。**透明 1px 是刻意保留的布局占位**——聚焦时线出现零位移。
  - 悬停：V1 线色 → `--border-strong`；V2 底色 → `--grey-1`（Swiss hover 语言）；V3 不变。
  - 聚焦：线色 → `--accent`（**进** `--dur-view` 200ms `--ease-enter`）；**同一瞬间**加 `box-shadow: 0 1px 0 0 var(--accent)` ⇒ 视觉 2px accent 焦点线。厚化**不过渡**——对齐 MOTION-DESIGN-SPEC §4「focus-visible 描边出现不过渡（避免焦点环爬行感）」。
  - 失焦：线色回落 rest（**出** `--dur-exit` 100ms `--ease-exit`）。
- **零 DOM 变更、零布局属性动画**：全部改动落在 `src/theme.css`；不动 TSX（`CardDock.tsx` / `ManualCardEditor.tsx` / `AIPanel.tsx` / `SelectionPanels.tsx` 一行不改）。
- **可访问性的等价替代（登记）**：移除参考稿式的「无焦点反馈」，以 **2px accent 底线**（6.2:1）作为焦点可见指示；同时保留 `aria-label`（字段级可访问名）与 `caret-color: var(--accent)`。键盘与指针共用同一指示（文本输入在浏览器里 :focus-visible 恒真，不做双轨，避免双指示叠显）。
- **输入动效**：① 聚焦/失焦线色迁移（上表）；② placeholder 为原生行为（首字符输入即消失，不添加打字级动画——MOTION 禁闪烁/打字机类）；③ 字段高度随内容增长沿用既有 `--dur-panel` 过渡（D123 保留项）；④ 光标 accent 化。

### 3.2 参数矩阵（每变体 × 关键属性 × 实测数）

实测口径：DPR 2.5 隔离 Electron 渲染样张 `design-samples/D142-carddock-restyle.html`，`getComputedStyle` 机械复读（页尾 `#metrics-out` / `window.__D142` 同源）。色值均已折算为 sRGB 数字。

| 属性 | 现状 v0 | **V1 下缘一划** | **V2 无痕浮线**（参考稿本体） | **V3 灰纸块** |
| --- | --- | --- | --- | --- |
| 边框 | 四边 1px `--border-strong`（聚焦四边 accent） | 下缘 1px `--border-subtle` | 无（下缘 1px 透明占位） | 无（同 V2） |
| 背景 | `--paper` | 透明 | 透明 | `--grey-1` 填充块 |
| 悬停 | 无变化（仅显「带入…」小字） | 线色 `rgb(163,163,163)` | 底色 `rgb(240,240,238)` | 无变化 |
| 聚焦（底线 + 厚化） | 边框色 `rgb(22,106,89)`（1px 四边） | 线色 `rgb(22,106,89)` + `box-shadow rgb(22,106,89) 0px 1px 0px 0px`（合成 2px） | 同 V1（但 rest 无线） | 同 V1（块底不变） |
| 失焦后（已输入） | 四边框 strong | 线色回落 `rgb(224,224,224)` | 无线 | 无（块底） |
| 单行字段高 | **31px**（普查 h=31） | 30px（20.8 行高 + 4/4 内距 + 1px 线） | 30px（同左，含 1px 透明占位） | 30px（同左） |
| placeholder | `--text-placeholder` #8a8a8a（ProseMirror 伪元素） | #8a8a8a（实测 `rgb(138,138,138)`） | 同 V1 | 同 V1；对灰底 3.03:1 |
| placeholder 行为 | 输入即消失（原生） | 同左 | 同左 | 同左 |
| 光标色 | 墨色（未声明） | `--accent`（实测 `caretColor: rgb(22,106,89)`） | 同 V1 | 同 V1 |
| 动效 | border-color 120ms（现规则） | 进 200ms `--ease-enter` / 出 100ms `--ease-exit` / hover 160ms `--ease-out-soft` | 同 V1 + 底色 160ms | 同 V1 |
| 盒框/底线条数·每输入面 | 4 边 | 1（下缘） | 0（聚焦时 1） | 0（聚焦时 1） |
| 静态观感风险 | —（问题源） | 最接近现状心智，风险最低 | 静止无参照物，字段依赖 placeholder 定位（§9 风险 1） | 字段＝灰块，密度感稍高 |

**聚焦态的几何对照（实测）**：accent 底线 2px（1px border + 1px shadow），对比 paper 6.2:1 ≥ 3:1（非文本 UI 门槛）；相较现状「四边 1px accent」，焦点强调面积更小但方向明确（线下＝书写面），且**全屏线色由 4 种降为 2 种**（subtle / accent）。

### 3.3 四类输入面几何实测（高度契约逐条核对）

| 输入面 | 现状 v0 | V1 | V2 | V3 |
| --- | --- | --- | --- | --- |
| 手动字段（单行） | 31px，内距 4px 8px，文字左缘 = 25px | 30px，内距 4px 0，文字左缘 = 16px | 30px（同 V1） | 30px（同 V1） |
| 自由材料 textarea | 30px（border-box），4 边 strong | **30px**（=现状），下缘 1px subtle，内距 4px 0 5px | 30px，下缘透明 | 30px，`--grey-1` 块 |
| 追问 textarea | 32px（border-box），4 边 strong | **32px**（=现状），下缘 1px subtle，内距 5px 0 6px | 32px，下缘透明 | 32px，`--grey-1` 块 |
| 「更多」行字段（前缀等） | 28px，虚底 strong | 28px，实底 subtle（聚焦 accent） | 同 V1 | 同 V1 |
| 标签输入 | 26px，四边 strong | 26px，无框（行 label + placeholder） | 同 V1 | 同 V1 |

- **D123 §1.9 契约（composer 与发送钮同高对齐）机械核对**：追问 textarea 32px ＝ 发送钮 32px（v0 与 V1 均实测 `32=32`）；`growTextarea` 上限 120px 不变。
- **textarea 行裁切检查**（防 border-box 高度差导致 1px 裁字）：`scrollHeight ≤ clientHeight` 全部 ok（`29≤29` / `31≤31`）。
- **左缘对齐**：字段文字与标题行、面板 padding 同为 16px（原是 25px——1px 边框 + 8px 内缩的叠加错位；Swiss「对齐法则：子元素不再叠加水平 padding」）。

### 3.4 placeholder 与可访问性（实测）

| 项 | 数值 | 判定 |
| --- | --- | --- |
| `--text-placeholder` #8a8a8a vs `--paper` #fafaf8 | **3.30:1** | ≥3 ✓（占位符档；登记为受控例外：占位符是可见提示、可访问名由 `aria-label` 承担，见下） |
| `--text-placeholder` vs `--grey-1` #f0f0ee（V3） | **3.03:1** | ≥3 ✓（贴线通过，V3 的参数之一） |
| `--accent` 底线 vs `--paper` | **6.20:1** | ≥3 ✓（焦点指示） |
| 白字 on `--accent` | **6.48:1** | ≥4.5 ✓（发送钮常态） |
| `--border-subtle` vs `--paper` | 1.26:1 | 仅作发丝分区线，非信息载体，不适用文本门槛 |
| 现状自由材料/追问 textarea 的 placeholder | **未声明 token**（UA 默认，未走设计体系） | 本次一并 token 化（`::placeholder { color: var(--text-placeholder) }`），顺带消除「同一屏两种占位灰」 |

受控例外登记（Swiss 可访问性节：「若某字段的 placeholder 是唯一**可见**标签，它就必须升级成正式 label」）：本次输入面＝**placeholder 视觉提示（用户点名参考模式）+ 真实可访问名（`aria-label`／关联 label 保持既有）**，且对比 ≥3:1。此为「可见标签豁免」的等价物：标签可访问性实质由 aria 层承担，可见层按用户点名的参考模式呈现。若审阅不认此等价，回退档＝在各输入面上方补 label（会整体回退参考模式，不建议）。

### 3.5 变体选择对其它行的联动

- `.wb-pick`「带入选区/带入 AI 回答」：三变体均保留（悬停/聚焦才现，D123 修订 5 条件不变）；**V3 需把 chip 底色从 `--paper` 改为 `--grey-1`**（否则灰块上出现纸色补丁）。
- 内容（ProseMirror / textarea 值）与字段高度过渡、`max-height` 逻辑零改动。

## 4. 发送钮（`.wb-composer-send`）

约束（决策 #1/#2）：hover **只变色**；**无阴影、无位移、无缩放**；禁用 **无 🚫**（`cursor: default`）。实测样张五态如下（`box-shadow: none` 全部成立）：

| 态 | 填充 | 文字 | 实测 | 备注 |
| --- | --- | --- | --- | --- |
| 静止 | `--accent` `rgb(22,106,89)` | `--accent-on` 白 | 6.48:1，h=32 | 与现状一致 |
| **H1 悬停·深一档**（现状档） | `--accent-hover` = `color(srgb 0.0759 0.3658 0.3071)` ≈ `#135D4E` | 白 | **7.73:1** | hover 后对比反而略升 |
| **H2 悬停·反白幽灵**（参考稿同构） | `--paper` `rgb(250,250,248)` | `--ink` `rgb(10,10,10)` | 18.94:1 | 取参考稿 hover 的「变色」部分；纸面近白 ⇒ 块面隐去、文字反相。参考稿的 `box-shadow` 依决策 #1 砍掉 |
| **D1 禁用**（现状档） | `--grey-1` `rgb(240,240,238)` | `--grey-2` `rgb(212,212,210)` | `cursor: default` | D141 已无 🚫 |
| **D2 禁用候选** | `--grey-1` | `--text-placeholder` `rgb(138,138,138)` | `cursor: default` | 禁用字可读性略优（D1 的 grey-2 视觉上偏「隐没」） |

hover 与禁用均为纯 `background-color` / `color` 迁移（`--dur` 120ms `--ease` 既有过渡，不动 token），**明确不做**：`translateY`、`scale>1`、新增/加深阴影（D120 §4 禁抬升）。H2 的「块面隐去」在深色模式下反向成立（`--paper` 深色 = #101010，ink #f5f5f2），无需特判。

## 5. 样张与截图（交付物索引）

| 交付物 | 路径 | 说明 |
| --- | --- | --- |
| 样张 HTML | `design-samples/D142-carddock-restyle.html` | 双击即开（零依赖、零网络）。第一段＝四列同屏（现状复刻 / V1 / V2 / V3，每列 400px＝`--wb-w`、列高 702px＝内窗 750−顶栏 48）；第二段＝「更多」展开区 现状 vs 新版；第三段＝字段 4 态（静止/悬停/聚焦/已输入）× 4 列；第四段＝发送钮 5 态；页尾 `#metrics-out`＝getComputedStyle 实测数（`window.__D142`） |
| 对照截图 | `design-samples/D142-carddock-restyle-docks.png`（2200×4733，DPR 2.5） | 四列 2×2 同屏（本机内窗宽上限下 4 列并排不可行，切分两行保持同屏）+ 更多区对照 |
| 状态截图 | `design-samples/D142-carddock-restyle-states.png`（3688×1650，DPR 2.5） | 字段 4 态 × 4 列 + 发送钮 5 态 |
| 现状对照 | `tests/tmp-d142-dock-manual.png` / `-解释.png` / `-制卡.png` | 同内窗尺寸、同 DPR 2.5；样本第一列为其逐参数复刻。**覆盖更正注记（2026-10-12）：三图已被 census-after 复跑（17:29）覆盖为改后态——「现状对照」只读语义已失效；改前基线见 `tests/tmp-d142-crop-before-*.png` 与样张第一列** |
| 再生成命令 | `npx electron design-samples/D142-carddock-restyle-shot.cjs` | 用项目已装 electron 渲染本样张（不启动应用本体）；控制台 `===METRICS===` 段＝矩阵数据来源 |

样张与产品的同源参数：字体栈（`--font-sans/--font-mono`）、灰阶 / accent / 边框 / 文字 token、字号阶梯（14/13/12）、间距（4/8/12/16）、控件高（34+1 标题行、32 composer、28 页脚钮、26/30 输入面）、动效 token（`--dur-view/--ease-enter/--dur-exit/--ease-exit/--dur-hover/--ease-out-soft`）全部与 `src/theme.css` 一致；被改动属性即 §2–§4 所列。

## 6. 对 D123 的修订点 + 保留不变清单

### 6.1 修订点（`docs/design/CARD-WORKBENCH-D123.md`）

| # | D123 条款 | 修订 |
| --- | --- | --- |
| R1 | §7.3「两区同为 paper 底，仅以一条细线分界」 | **分界线取消**：`.wb-ai` 上缘线（strong）删除；两区由标题行下缘 hairline + 留白分界（底部放置删 `border-left`，保留 `.wb-manual` 的 subtle `border-right` 为唯一竖线） |
| R2 | 修订 2「字段：…框线在外壳，聚焦只变 accent；`.wb-field` 四边 `--border-strong`」 | `wb-field` 去边框 → §3 变体矩阵（底线/无线/灰块三选一）；聚焦＝accent 底线 + 瞬时 2px |
| R3 | 修订 2 `.wb-field-inner { padding: 4px 8px }` | 改 `4px 0`（左缘与标题/面板对齐 16px） |
| R4 | 修订 2 `.wb-line` 下缘虚线（strong） | 改实线 `--border-subtle`；聚焦 accent |
| R5 | 修订 2 `.wb-more .dd-btn { border-color: var(--border-strong) }`、修订 3 解读方式下拉 | 坞内 dd-btn 去框（ghost 化，hover 灰底），作用域 `.side-dock` |
| R6 | `.wb-free textarea` / `.wb-composer textarea` 四边 `--border-strong` | 去四边 → 变体机制；两处高度 30/32 不变（border-box） |
| R7 | `.wb-composer { border-top-color: var(--border-strong) }` | 转 `--border-subtle` |
| R8 | 侧栏 `.btn-outline:disabled`（禁用描边） | 坞内退役：`.side-dock .btn-outline:disabled` 与 base 禁用一致（grey-1 底 + grey-2 字） |
| R9 | placeholder 未 token 化（free/composer textarea 走 UA 默认） | 统一 `--text-placeholder` |
| R10 | 发送钮 hover | 保持「只变色」；H1（深一档，现状）与 H2（反白幽灵）作为候选矩阵，终选后落一条规则 |
| R11 | §2 #5 标签输入「删除边框（坞内裸排）」（本稿条款；连带 §3.3 表「标签输入」行的「无框」描述） | **修订**（依据：`docs/design/D142-CODE-REVIEW.md` §三【必须修复 1】——坞内「标签」输入聚焦无任何可见焦点指示，违反 GUIDE §5.3 键盘焦点环 + swiss 禁止清单「❌ 移除焦点环且无替代」+ D50 登记裁定「框线装饰＝一律禁止；焦点指示＝键盘必须可见」）：四边框仍删（§2 #5 政策不回归），但**下缘保留 1px `--border-subtle` 底线；聚焦（`:focus`）与建议面板挂载期（`.expanded`，含 closing）底线转 `--accent`**——与 §2 #6 行式字段同款机制（同依据：「更多区行式字段没有底色，底线是『可编辑』的唯一线索」）。聚焦＝纯色迁、恒 1px（**厚化不适用、零位移由构造保证**，口径见 §6.3）；同时闭合审查所述 D106 建议面板「与输入框共享边线」断线（**同源症状**：`.expanded`/`:focus` 的 `border-color` 取色因 `border: 0` 一并实效） |

### 6.2 保留不变清单（结构性契约逐条）

1. **DOM 契约零改动**：`[data-card-dock]`、`[data-testid="workbench-entry"]`、`workbench-dock`、`wb-manual` / `wb-manual-toggle` / `wb-manual-body`、`dock-tabs` / `dock-tab-explain` / `dock-tab-cards`、`[data-dock-tabbody]`、`wb-free-source`、`wb-composer` 全部原样；**无 TSX 变更**（本设计纯 theme.css）。
2. 页签切换与保活（`display:none` 不卸载、流式与草稿不丢）、手动制卡常驻、`.collapse-clip` 折叠（手动区 + 「更多」）、Esc 收起、Ctrl+K / Ctrl+Alt+K / 托盘入口、独立窗口与右侧/底部两种放置共用同一样式。
3. **composer 契约（D123 §1.9）**：单行起步、`growTextarea` 随输入增高（≤120px）、与发送钮同高 32px 对齐（实测 32=32）、`flex-end` 对齐。
4. 标题行 34px + 1px 下缘线（与摘录页头带同 y 的细线对齐，D123 §10）、页签「选中＝墨字 + 2px accent 下划线」语法、等宽标题列 5.2em。
5. 「带入…」小字（有文字不渲染；悬停/聚焦才现；无选区提示）、字段内容增长过渡（`--dur-panel`）、`wb-pick` 位置（右 4 / 上 4）。
6. 行为纪律：hover 无抬升无阴影（D120 §4）、禁用无 🚫（D141）、无呼吸/脉冲动画（D123 §1.7）、滚动条隐藏（D123 修订 5）、聚焦延后 300ms 与 `preventScroll`（D123 修订 9）。
7. 浮层（`dd-menu` 等）保持 paper + hairline + `--shadow-float`（唯一允许阴影处）。
8. 深色模式：零新增颜色，全部走 token（`body.theme-dark` 自动跟随，实测见附录）。

### 6.3 R11 口径说明（标签输入焦点可见性 · D106 共享边线 · 落点与机械验收）

> 触发：`docs/design/D142-CODE-REVIEW.md` §三【必须修复 1】（审查结论：不合格，唯一必修项）。本条**修订 §2 #5 与 §3.3 表标签输入行的原口径**（「无框」→「仅删四边框、下缘底线在」）；本稿其余部分不动。

**1. 口径（最终）**

| 状态 | 标签输入（`.wb-more .tag-input-box input`） |
| --- | --- |
| 静止 | 四边框仍删（`border: 0`——§2 #5「输入面不用盒框」政策不回归）；**下缘 1px `var(--border-subtle)` 实线常驻**（与同区 3 条 `.wb-line` 静止基线一致；行式字段「可编辑」的唯一线索，同 §2 #6 依据） |
| 聚焦 `:focus` | `border-bottom-color: var(--accent)`（6.2:1 ≥3:1）；**恒 1px，不加 box-shadow** |
| 建议面板挂载期 `.tag-input-box.expanded`（含 `closing` 200ms 窗口） | 同聚焦档（accent 底线）——D106「聚焦态 border accent＝Anticipation 预告步」与面板共享边线均取此线 |
| hover | 不新增档（同 `.wb-line`：行式字段族无 hover 线档） |
| 盒高 | 26px（border-box）不变——底线 rest 即占位 |

- **聚焦厚化（`box-shadow: 0 1px 0 0 accent` 合成 2px）不适用**。依据：① 与 `.wb-line` 同款——§2 #6 落地方案（`src/theme.css` L8195/L8203 仅线色迁移）已经被审查 R4 行 ✅ 接受；同一 `.wb-more` 分区内行式字段只应存在一种聚焦语法，混入第二机制即口径分裂；② 厚化在 §3.1 的角色是服务「静止态线可能不在（V2/V3 透明占位）」的输入面，行式字段底线 rest 即常驻可见，无需补齐；③ 可见性实质达标：accent 底线 vs paper 6.2:1，即 §3.4 登记的「等价可见替代」同族，且审查通过条件 ② 原文口径＝「computed `border-bottom-color = rgb(22,106,89)` 且宽 >0」。
- **零位移适用**，且由构造保证：底线恒定占 1px、聚焦只改色（不触宽/padding/盒高，盒高 26px 不变——§3.3 行契约不变）；§3.1 的「透明 1px 占位」是 V2/V3「静止无线」变体的专属前提，本行不需要。
- `outline: none`（base L4096）**保留**：合法性来自「等价可见替代在场」（swiss 焦点环规则「任何元素不得移除焦点环，除非提供等价可见替代」+ D50 边界「焦点指示＝键盘必须可见」）；**不得**改双轨 `:focus-visible`（§3.4 已登记：文本输入 `:focus-visible` 恒真，双轨＝双指示叠显）。
- 未采纳「仅聚焦出现下划线」（审查列为可接受等效）：静止无线将与该行同区 3 条 `.wb-line`（rest 有线）基线不一致，违背 §2 #6「底线是唯一线索」的静止面。
- 作用域仅 `.wb-more`（坞内手动表单标签行）；其余四处 TagInput 宿主（复习页快捷打标 / 浏览器批量打标 / 卡详情 / 筛选构建器）保持 base 四边框口径不变。深色模式由 token 跟随（附录 A 口径），零新增颜色。

**2. D106 判定（同源症状，随本条一并闭合）**

面板 `.tag-suggest-v4` 是 `top: calc(100% - 1px)` 的无顶边（`border-top: none`）U 形描边，其顶边闭合线按 D106 设计由输入框底边承担（`TAG-SUGGESTION-PREVIEW.md` v2 裁定③「与输入框共享边线（margin-top:-1px）」；`.tag-input-box.expanded input { border-color: accent }` 即该边的取色源）。D142 把坞内该输入 `border` 删成 0 后，该边没有可着色目标 → 展开态 U 形开口断线。R11 恢复 1px 底边 + 坞内取色后：面板顶边与输入底边重新共线（`panel.top = input.bottom − 1`，恢复 D142 前几何）且该边为 accent——审查通过条件 ④ 成立。**残余（登记，不阻塞）**：D142 前该输入为四边框，展开态「连续描边」含输入左右两边；本条按「输入面不用盒框」政策只恢复底边，不恢复四边（恢复四边即违反 §2 纲领与验收 #2）。判定＝**同一根因**（同一行、同一 `border: 0` 变更的连带效应），无独立遗留项。审查建议项 3（坞内占位灰 token，LOW）**不并入**本条，留收尾口径。

**3. 落点（frontend-builder · 仅 `src/theme.css`）**

```css
/* L8238 就地修订：同选择器、同 .wb-more 作用域，加一条声明（其余声明不动） */
.wb-more .tag-input-box input { padding: 0; background: none; border: 0; border-bottom: 1px solid var(--border-subtle); }
/* 紧随其后新增（必需）：坞内 base (0,2,1) 与 base :focus/.expanded (0,2,1) 同特异度且源序更后
   （L8238 > L4096/L4097），会反向压掉 base 的 accent 取色——必须以坞内 (0,3,1) 显式覆盖 */
.wb-more .tag-input-box input:focus,
.wb-more .tag-input-box.expanded input { border-bottom-color: var(--accent); }
```

不加 `transition`（同 `.wb-line` 瞬时色迁；reduce 双轨天然满足，不进 `no-preference` 块）；不加 `!important`。

**4. 机械验收（与 D50 先例同型：computed style 判据，不靠截图目检）**

| # | 判据 |
| --- | --- |
| ① | `grep -n "tag-input-box" src/theme.css`：坞内作用域下 `border-bottom: 1px solid var(--border-subtle)` 与 `border-bottom-color: var(--accent)` 两组规则在场 |
| ② | 坞「更多 → 标签」聚焦：`getComputedStyle(input).borderBottomWidth === "1px"`、`borderBottomColor === "rgb(22,106,89)"`、`borderTopWidth === "0px"`（无四边盒框回归，审查条件 ③） |
| ③ | 失焦且面板关闭：`borderBottomColor === "rgb(224,224,224)"`（静止底线在场） |
| ④ | 输入 ≥1 字面板展开：`Math.abs(panel.getBoundingClientRect().top − (input.getBoundingClientRect().bottom − 1)) ≤ 0.5`（共线无断口；DPR 2.5 吸附容差）且此刻 `borderBottomColor === "rgb(22,106,89)"`（审查条件 ④） |
| ⑤ | `input.getBoundingClientRect().height` 与 26 之差 ≤ 0.5（行契约不变，§3.3） |
| ⑥ | `npm run build` 过；`git diff --stat` 仅 `src/theme.css` |

## 7. 可机械检查的验收标准清单（供总控）

1. `grep -n "wb-ai" src/theme.css`：`.wb-ai` 无可见 `border-top`（删除或 `border-top: 0`）；`border-left`（bottom 放置）同步删除；样张 V1 列 `ai区上缘线.borderTopWidth === "0px"` 复现。
2. `.wb-field` 规则中 `border: 0` 且 `border-bottom: 1px solid`（值 ∈ {transparent, var(--border-subtle), var(--accent)}）；无任何 4 边 `--border-strong` 残留（`grep -n "wb-field" -A3 src/theme.css` 人工核对一条）。
3. `grep -n "dashed" src/theme.css` 在 `.wb-line` 上下文命中 **0**。
4. `.side-dock .btn-outline:disabled` 存在且 `border-color: transparent`（或等价填充式禁用）。
5. `grep -n "wb-free textarea::placeholder\|wb-composer textarea::placeholder" src/theme.css` ≥2（token 化占位灰）。
6. 高度契约：composer textarea `height: 32px` 与 `.wb-composer-send` 32px 均在场；GUI 打开解释页签，单行态两者底对齐、输入增高后 `align-items: flex-end` 对齐不变。
7. 样张复核：打开 `design-samples/D142-carddock-restyle.html`，`#metrics-out` 的「线条审计」「字段」「发送钮」三块数值与本稿 §2.2 / §3.2 / §4 逐项一致（实施后把样张 V* 列的 CSS 复制回 theme.css 时不得改数）。
8. `npm run build` 通过；GUI 冒烟（见任务拆解表 #6）无肉眼可见的布局跳动（尤其聚焦/失焦瞬间零位移——透明占位 1px 生效）。
9. `git diff --stat` 仅含 `src/theme.css`（若有 TSX 变更即为超范围）。
10. reduced-motion：新增过渡全部在 `@media (prefers-reduced-motion: no-preference)`（或既有同类块）内；reduce 下聚焦线瞬时出现（无过渡）仍可见。

## 8. 任务拆解表（供总控逐项派发）

> 依赖列「用户裁定」＝需用户在样张上选定 V1/V2/V3 与 H1/H2、D1/D2 后再派发；其余项可先行。

| # | 任务 | 建议执行者 | 涉及文件 | 可机械检查的验收标准 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| 1 | 线条收敛批次：删 `.wb-ai` 上缘线（含 bottom 放置 border-left）；composer 上缘 strong→subtle；坞内 dd-btn ghost 化（`.wb-more .dd-btn` + `.ai-explain-mode .dd-btn`，含 hover 灰底）；`.side-dock .btn-outline:disabled` 退役；`.wb-line` 虚→实 subtle | frontend-builder | `src/theme.css` | 验收 #1、#3、#4 通过；`npm run build` 通过 | 无 |
| 2 | 输入面机制落地（按选定变体）：`.wb-field` 去框 + 变体参数 + 聚焦底线/厚化 + `caret-color`；`.wb-field-inner` padding 改 4px 0；`.wb-free textarea` / `.wb-composer textarea` 去框 + 变体参数 + 高度不变（30/32）；`wb-pick` 底色随 V3 调整 | frontend-builder | `src/theme.css` | 验收 #2、#6、#7、#10；样张矩阵数值复现 | 用户裁定（V1/V2/V3）+ #1 |
| 3 | placeholder token 化：`.wb-free textarea::placeholder` / `.wb-composer textarea::placeholder` → `--text-placeholder` | frontend-builder | `src/theme.css` | 验收 #5 | #2（可与 #2 同批） |
| 4 | 发送钮终选落地：H1 或 H2 一条 hover 规则 + D1 或 D2 禁用文字色；确认无 `box-shadow` 变更 | frontend-builder | `src/theme.css` | 验收 #8 的 hover/禁用肉眼项；样张「发送钮」块五态复现 | 用户裁定（H1/H2、D1/D2） |
| 5 | 独立窗口（Ctrl+Alt+K）同源确认：`workbench.html` 宿主下同组件渲染，GUI 打开独立窗口核对与侧栏一致 | frontend-builder | 无代码（可能零改动） | 两处截图逐参数一致（同一 CSS 作用域） | #2、#4 |
| 6 | GUI 冒烟：开/关制卡台（右侧 + 底部 + 独立窗口三处）、三页签切换、两字段与自由材料/追问输入（含中文输入法）、聚焦/失焦零位移、发送钮禁用→启用→hover、Esc、reduce 模式下聚焦线瞬时可见 | frontend-builder | 无代码 | 全场景无跳变/无 1px 裁字；对照 `tests/tmp-d142-dock-*.png` 视角复拍 | #1–#4 |
| 7 | 终审：对照本稿 §2/§3/§4/§7 逐项核数（含 `code-reviewer` 语义审查） | code-reviewer | 只读 | 合格/不合格结论 + 必须修复项 | #1–#6 |

## 9. 范围外 / 风险与回归重点

**范围外**：不改 `src/` 任何 TSX、不改 electron 主进程、不改 DOM 结构（含加 wrapper）、不动信息架构/交互流程、不重设计页签与更多区的功能、不做全应用 `.btn-outline:disabled` 同步化、不纳入启动卡顿任务。

**风险与回归重点**：
1. **V2/V3 静止态无参照物**：字段边界不可见，靠 placeholder 定位。手工验收：在空手动表单上，非中文用户也能识别「正面/背面」两个输入位（placeholder 3.30:1 可读）。若用户判定风险不可接受 → 选 V1（底线保留）。
2. **V3 灰块密度**：两块灰底字段 + 自由材料灰块，屏上灰面增多；若嫌重 → 选 V1/V2。
3. **聚焦零位移**：依赖「下缘 1px 透明占位」不被误删；验收 #8 专门覆盖。若实施时误把 `border-bottom: 1px solid transparent` 写成 `border: 0`，聚焦线出现会造成 1px 内容位移——样张与 theme.css 均须保留占位。
4. **`.wb-field` 旧规则残留**：`:focus-within { border-color / background }` 两条必须随边框一并清理，防止与变体规则叠加出「幽灵边框」。
5. **底部放置**：删 `.wb-ai` border-left 后必须确认 `.wb-manual` 的 border-right（subtle）仍在，否则两区之间无分隔。
6. **独立窗口与侧栏共用同一 CSS**：任何「只改侧栏」的后续 patch 都会波及独立窗口，审查时把两处当作同一验收面。

## 附录 A · 深色模式实测（token 自动跟随，零额外规则）

| 对 | 浅色 | 深色（`body.theme-dark`） |
| --- | --- | --- |
| `--accent` vs `--paper` | 6.20:1 | 5.99:1（accent #3fa08a / paper #101010） |
| `--text-placeholder` vs `--paper` | 3.30:1 | 4.42:1（#7a7a76 / #101010） |
| `--text-placeholder` vs `--grey-1` | 3.03:1 | 3.96:1（/ #1c1c1a） |
| `--border-subtle` vs `--paper` | 1.26:1 | 1.32:1（#2a2a27 / #101010） |
| accent 底线 vs paper（焦点指示） | 6.20:1 | 5.99:1 |
| `--accent-on` on `--accent` | 白字 6.48:1 | 黑字 6.23:1（accent-on #0a0a0a） |

深色下 hairline 更弱（跟肤纪律：层次改以描边/底色区分）——本设计的「底线」在深色下同样可辨（1.32:1 为发丝线档，focus accent 5.99 承担指示职责）。

## 附录 B · 与普查日志的口径换算（复核用）

| 项 | 普查日志 `tests/tmp-d142-census.out.log` | 本稿样张 `#metrics-out` | 换算 |
| --- | --- | --- | --- |
| 边框宽度 | `0.8px` | `0.8px` | 同为 1px 在 DPR 2.5 下吸附 2 设备像素的回算值（2÷2.5） |
| 边框颜色 | `bc=` 取 `borderTopColor`（只设下缘线的元素回落 currentColor＝墨色） | 取**可见侧**（`borderBottomColor`）与 `borderColor` | 例：#1 普查 `rgb(10,10,10)` ↔ 样张 `rgb(224,224,224)`（同一元素同一线，口径差） |
| 清单边界 | 20 条＝「有宽度边框元素」（含透明描边与 0×0 隐藏节点） | 「可见线」（style≠none ∧ width>0 ∧ 颜色非全透明），排除透明描边/隐藏节点 | 逐条对应见 §2 矩阵；`wb-field` 实测 2 个在普查因去重键（class+bw+宽）合并为 1 行 |
| 标题行高 | `h=35` | `h=35` | 34 内容 + 1px 下缘线（content-box） |
| composer | `h=49`，textarea `h=32` | `h=48.8`（8+32+8+0.8），textarea `h=32` | 同值（0.8 吸附口径差） |
