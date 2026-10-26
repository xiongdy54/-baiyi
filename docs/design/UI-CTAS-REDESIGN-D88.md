# 三界面 buttons-ctas 动效语言改造 + 右侧制卡面板 · 设计稿（v1）

> 日期：2026-10-04 · 作者：设计 · 状态：**待实施**（D88；建议版本 **v48.48**）。
> 决策登记：`AI_DEVELOPMENT_GUIDE.md` §8.1 **D88**（条目草稿见 §14，由主控誊写）。
> 设计语言基准：`docs/design/ui-skill-previews/buttons-ctas/`（reading.html / excerpt.html / review.html；按钮 12 原则作为设计参考）。
> 前置契约：`EXCERPT-REVIEW-LAYOUT-REDESIGN.md`（v12 已放开高级动效）、`READER-RAIL-POPOVER-D85.md`（v3/D87）、`SELECTION-MENU-STAGE-TOOLBAR.md`（v4/D84）、`CARD-BROWSER-REDESIGN.md`（D80）。
> 范围：纯前端布局/视觉/动效。不动数据模型、IPC、FSRS 调度、`review_logs` 真源、主进程。

---

## 0. 用户原话（2026-10-04，逐字留痕）

「除了摘录界面的底栏和高亮内容的颜色以外，请全部参照你刚才做出来的"buttons-ctas"那一版示例对当前项目进行改造，包括排版、布局、动效。但是我看你的示例中似乎缺少了顶部工具栏和工具栏上的那些按钮，并且我不要你示例中的那个右侧的竖条，在右侧也加一个制卡面板的侧边栏。还有你示例中强调色使用了黑色，请改成主题色。此外还有一个小改动，就是摘录页面侧边栏应该贯通到底部，展开侧边栏时底栏应该相应收缩。上面提到的新内容同样使用"buttons-ctas"进行设计。」

## 1. 已确认决策 → 本稿落点

| # | 用户决策 | 本稿落点 |
|---|---|---|
| 1 | 三界面排版/布局/动效整体参照 buttons-ctas 预览 | §4 通用语言 + §5/§6/§7 三界面分稿 |
| 2 | 顶部工具栏及其按钮必须保留（预览缺失＝预览缺陷） | §5.2/§6.2/§7.2：工具栏全部保留原钩子，只做 ctas 化改样式 |
| 3 | 不要预览的右侧竖条 | `.tools` 形态不引入；翻页/更多/阅读设置留在既有工具栏 |
| 4 | 右侧新增「制卡面板」侧边栏 | §8 CardDock 专节（统一右停靠栏，手动制卡态 + AI 态） |
| 5 | 强调色一律主题色，不用预览的黑 | §2 强调色映射表（黑→accent / 中性灰两条路） |
| 6 | 摘录页侧栏贯通到底；展开时底栏相应收缩 | §6.3 几何契约（rail 改 fixed 贴窗底；底栏 margin-left 让位） |
| 7 | 新内容同样按 buttons-ctas 设计 | §8 制卡面板动效/状态全按同一套 Token |

**范围外（用户原话圈定）**：摘录页底栏的重新设计（D74/D77 定稿形态不动——本稿只改它的**宽度让位几何**，见 §6.3，这是用户本轮唯一授权的底栏改动）；高亮/批注颜色体系（`--annot-*` 色板、EPUB 下划线注入等一律不动）。

---

## 2. 设计语言基准与「黑 → 主题色」映射

### 2.1 预览语言的构成

预览 = 瑞士基线（Token 同源）+ buttons-ctas 交互层：
- **形状**：直角、hairline、8px 网格（与本项目一致，零冲突）。
- **交互反馈**：hover 预抬升（Anticipation）+ 按压缩放（Squash & Stretch）+ 主 CTA settle 回弹（Exaggeration）+ 涟漪（Secondary Action）+ 图标滞后（Follow Through）。
- **层级表达**：主 CTA 用填充色承载（Staging），推荐项放大（评分「良好」档）。

### 2.2 「黑 → 主题色」映射表（用户决策 5 的机械执行）

预览中 `--ink`（黑）承担了三种角色，逐条改判：

| 预览元素 | 预览用色 | 本项目落地 | 理由 |
|---|---|---|---|
| `.seg button.on` 选中填充 | 黑底白字 | **`--accent` 填充 + `--accent-on` 文字** | 选中态＝强调，归 accent |
| `.btn` / `.card` / `.face` 强描边 | `1px solid var(--ink)` | **`1px solid var(--border-strong)`**（中性灰） | 描边是「结界」不是「强调」；全屏绿框会毁掉单一焦点色 |
| `.xitem.on::before` 选中条 / `.tab-ind` 指示条 | 黑 / 绿 | **`--accent`** | 位置指示＝强调 |
| `.bottombar` border-top、`h1` 下缘线 | 黑 | **`--band-line` / `--border-strong`** | D71/D74 既有契约优先 |
| `.slider` 滑块拇指 | 黑 | **`--accent`**（hover 放大、active 压深） | 控件激活态＝强调 |
| 涟漪色 | `rgba(10,10,10,.12)` | **`color-mix(in srgb, var(--accent-on) 22%, transparent)`**（填充钮上）/ accent 12%（描边钮上，若启用） | 随主题反转 |
| hover 阴影 | `rgba(10,10,10,.14)` | **`--shadow-hover: 0 3px 8px rgba(10,10,10,.12)`**（新 Token，字面黑——阴影不随主题反转） | 与 `--shadow-float` 同族 |

### 2.3 与瑞士基线的两处显式豁免（须随 D88 登记，不得 silently 扩散）

1. **`--shadow-hover`**：瑞士「直角无阴影」的例外，**仅允许**出现在 ≥32px 的可点控件 hover 态与评分钮 hover 态；24px 工具栏钮、列表条目、表格行禁止使用。浮层阴影仍是唯一的 `--shadow-float`，不混用。
2. **按钮 transform**（hover 位移 / active 缩放 / settle 回弹）：v12 已放开（EXCERPT-REVIEW §6-4）；本稿是放开后的第一次体系化使用。边界重申：语义必须耦合真实交互（按下/提交成功），**禁止**庆祝动画（§4.17-7）、禁止假动画（§4.10-3——进度条必须有真实分母、计数必须有真实变化才动）。

---

## 3. 动效 Token 体系（新增 8 枚；既有 Token 一律不改值）

`:root` 新增（静态值，无派生，不需要 body 重算；深浅主题共用）：

```css
:root {
  /* buttons-ctas 交互族（D88）：按钮级交互态专用；栏/面板级过渡仍走既有 --dur/--ease */
  --ease-out-soft: cubic-bezier(0.4, 0, 0.2, 1);  /* hover 进出（skill 原则 6） */
  --spring: cubic-bezier(0.34, 1.56, 0.64, 1);    /* 指示条/弹层回弹（原则 6 变体） */
  --dur-hover: 160ms;   /* hover 过渡（skill 原则 9：150-200ms） */
  --dur-press: 60ms;    /* active 按压（skill 原则 9：50-100ms） */
  --dur-panel: 240ms;   /* 栏/停靠面板开合（摘录轨 + 底栏让位同步） */
  --dur-stage: 240ms;   /* 卡片入场（原 120ms 升档，取瑞士风 120-240 区间上限） */
  --dur-flip: 500ms;    /* 复习翻卡 */
  --shadow-hover: 0 3px 8px rgba(10, 10, 10, 0.12);  /* §2.3-1 豁免件 */
}
```

**降级纪律（硬性）**：本稿所有新动效规则（含 transition 与 animation）必须写在 `@media (prefers-reduced-motion: no-preference)` 作用域内；既有全局 reduce 块照旧生效。验收项见 §13-F。

**缓动分层声明**：既有 `--ease`（cubic-bezier(0.2,0,0.38,0.9)）继续服务栏级/面板级过渡（轨、dock、底栏让位、浮层淡入）；新 `--ease-out-soft` 只服务**按钮级**交互态（transform/background/border 的 160ms 反馈）。两族各管一层，全部在 Token 体系内，组件禁止裸写贝塞尔。

---

## 4. 通用交互语言（一次定义，三界面复用；全部挂在既有类名上，零 DOM 改动）

### 4.1 按钮态机（Pose to Pose：default / hover / active / focus / disabled 五态关键帧）

| 类档 | 几何（现状不动） | hover | active | focus-visible | disabled |
|---|---|---|---|---|---|
| 24px 工具栏档（`.btn-rail` / `.seg-rail button` / `.annot-toggle.bar-btn`） | 不变 | `translateY(-1px)` + 底 `--grey-1`（描边钮边框升 `--text-primary`，现状） | `scale(0.95)`，`--dur-press` | outline 2px accent offset 2（现状） | D84 色阶反转不变，无位移无阴影 |
| 32-40px 档（`.btn` / `.bar-btn` / `.bar-btn.ghost` / `.reader-engine-controls .btn`） | 不变 | `translateY(-2px)` + `--shadow-hover` | `scale(0.95) translateY(0)`，`--dur-press` | 同上 | 同上 |
| 填充主钮（`.bar-btn.primary` / `.btn-primary` / `.grade.recommended`） | accent 填充（v9 已定） | accent-hover + `--shadow-hover` | `scale(0.95)`，`--dur-press` | outline 2px（推荐档 outline 取 `--ink`，深浅自适） | 落灰（现状） |
| 图标钮（`.icon-btn` / `.reader-nav-btn`） | 不变 | `translateY(-1px)` + `--grey-1` 底（阅读器按 `--reader-fg` 混色） | `scale(0.92)` | 同上 | — |

CSS 落地（统一规则块，插在 theme.css 通用区；按档分选择器组）：

```css
@media (prefers-reduced-motion: no-preference) {
  .btn, .bar-btn, .btn-rail, .seg-rail button, .icon-btn, .reader-nav-btn,
  .reader-engine-controls .btn, .reader-engine-controls .dd-btn, .grade {
    transition: transform var(--dur-hover) var(--ease-out-soft),
                box-shadow var(--dur-hover) var(--ease-out-soft),
                background-color var(--dur-hover) var(--ease-out-soft),
                border-color var(--dur-hover) var(--ease-out-soft),
                color var(--dur-hover) var(--ease-out-soft);
  }
  .bar-btn:active, .btn:active, .grade:active { transform: scale(0.95); transition-duration: var(--dur-press); }
  .btn-rail:active, .seg-rail button:active { transform: scale(0.95); transition-duration: var(--dur-press); }
  .icon-btn:active, .reader-nav-btn:active { transform: scale(0.92); transition-duration: var(--dur-press); }
  .btn:hover, .bar-btn:hover:not([disabled]), .grade:hover:not([disabled]) {
    transform: translateY(-2px); box-shadow: var(--shadow-hover);
  }
  .btn-rail:hover:not([disabled]), .seg-rail button:hover { transform: translateY(-1px); }
  .icon-btn:hover, .reader-nav-btn:hover { transform: translateY(-1px); }
}
```

**Follow Through（图标滞后）**：带图标的按钮（`.btn .ic`、`.icon-btn svg`、翻页钮 svg）`transition: transform var(--dur-hover) var(--ease-out-soft) 30ms`，hover 位移 ±2px（方向语义：前进钮右移、返回钮左移、下移仅「显示答案」类）。

### 4.2 settle 回弹（Exaggeration，主 CTA 专用）

- 触发：**真实点击**主 CTA——「显示答案」「下一条」「评分四钮」「创建卡片（dock）」。
- 机制：`src/lib/press.ts` 新增 `settle(el: HTMLElement)`——移除类 → 强制 reflow → 加 `.settle`；`animationend` 自摘。
- CSS：`@keyframes ctas-settle { 0%{transform:scale(1)} 35%{transform:scale(1.05)} 100%{transform:scale(1)} }`，`.settle { animation: ctas-settle 350ms var(--ease-out-soft) }`（reduce 块内 animation 全局归零，无需单独处理）。
- 边界：这是**按压反馈**不是庆祝动画（§2.3-2）；只挂上述四类主 CTA，禁止扩散到普通工具栏钮。

### 4.3 涟漪（Secondary Action，仅填充钮）

- `src/lib/press.ts` 同文件导出 `attachRipple(el)`：pointerdown 生成 `span.ripple`（绝对定位、`border-radius:50%`、`transform:scale(0)`→`scale(2.8)`、520ms `--ease-out-soft`、动画完移除）。
- 适用面（白名单，禁止扩散）：`.bar-btn.primary`、`.btn-primary`、`.grade.recommended`、dock「创建卡片」钮。涟漪色 = §2.2 表（accent-on 22%）。
- `matchMedia('(prefers-reduced-motion: reduce)')` 命中时不挂。

### 4.4 段控选中态（黑→主题色的最大可见面）

- `.seg-rail button.on` / `.extract-toolbar .seg-rail button.on`：现状 `--grey-1` 底 → **`background: var(--accent-soft); color: var(--accent); font-weight: 500;`**（底为 8%/16% 透明 accent，深浅两档由既有 token 派生保证可读）。
- `.seg button.on`（选区菜单 `.seg-plain`）已是 accent 下划线，不动。
- `.reader-sel-actions` 内段控同规（阅读外观取色：`--accent` 在三种阅读主题下均用全局 accent，不随纸色变——accent 是全应用唯一焦点色）。

### 4.5 浮层入场（选区菜单 / 批注编辑浮层）

- 定位测量机制不变（先渲染 `-9999` 一帧）；**入场动画必须在拿到坐标后播放**：两浮层拿到 `pos` 后挂 `.is-placed` 类，动画只挂在该类上——
  `.selection-menu.is-placed, .editor.is-placed { animation: pop-in 220ms var(--spring) both }`；
  `@keyframes pop-in { from { opacity: 0; transform: scale(0.92) translateY(4px) } to { opacity: 1; transform: none } }`；
  `transform-origin: 50% 100%`（菜单在选区下方时）/ 上方翻面时 `50% 0%`（placePopover 已知 prefer 结果，挂对应修饰类）。
- 出场保持瞬时（现状惯例，不引 JS 退场）。

---

## 5. 阅读界面（Reader）

### 5.1 当前问题（对照预览）

1. 工具栏与各钮只有底色 hover，无按压/抬升的物理反馈，与预览的「活」按钮差距最大。
2. 选区菜单瞬现（无入场），批注编辑浮层同样瞬现。
3. 文中标记（高亮/下划线）无入场表达，打开书后所有痕迹"同时已在"。
4. 制卡流分裂：手动制卡＝居中模态、AI 制卡＝右侧 400px dock，两种呈现两种动效（§8 统一）。
5. 右侧无驻留的制卡面板（用户决策 4）。

### 5.2 目标结构（与预览的差异修正全部落实）

```
topbar（48px，应用级，§5.2 契约不动：文字导航+标题+设置+窗控）
└─ reader-body（flex 行）
   ├─ reader-scroll
   │  └─ reader-engine-layout（一行两格，D85 现状）
   │     ├─ reader-side-rail（280↔0 全高左轨，D85 不动；内部换 §4.4 段控选中色 + §4.1 钮态）
   │     └─ reader-engine-col
   │        ├─ reader-engine-controls（顶部工具栏——【保留】，含选区动作组 + 翻页 + 更多 + 阅读设置）
   │        │  右端新增 .reader-pageinfo（meta 档 mono：「第 N 页 · 章节名」；数据来自既有
   │        │  onRelocate locator；页码不可得时只显示章节，两者皆无＝不渲染，禁造假）
   │        └─ reader-engine-viewport（正文；标记入场动效见 5.3）
   ├─ CardDock / AIPanel（§8：统一右停靠栏，400px，fixed；【不引入预览右侧竖条】）
   └─ 浮层（SelectionMenu / AnnotationEditor：§4.5 入场）
```

- **顶栏保留**：预览的「书架返回钮 + 书名 + 页码」三件套中，书名已在应用顶栏、返回经导航；页码落 `.reader-pageinfo`（上）。预览 appbar 的其余形态不重复实现。
- **右侧竖条不引入**：预览 `.tools`（上一页/下一页/书签/设置/更多竖排）的功能在本项目全部已由工具栏承载（D84/D85 定稿），本稿声明**不迁移**。

### 5.3 动效清单（本页新增）

| 动效 | 规格 | 语义耦合 |
|---|---|---|
| 文中标记入场（划笔） | 文档打开后首批 marks 挂容器类 `reader-marks-enter`（Reader 在 marks 首次装载处一次性置位、1200ms 后摘除）；其作用域内 `.reader-doc-mark` 底色层 `background-size 0%→100%`，640ms `--ease-out-soft`，无 stagger。此后增删的标记只做 160ms opacity 淡入 | 首次装载＝打开文档的真实事件；颜色仍取 `--annot-*`（用户圈定颜色不动，本条只动"出现方式"） |
| markdown 分支锚点定位 | `.reader-markdown` 定位完成后 240ms fade + 8px rise（一次性） | 跳转锚点真实发生 |
| 引擎翻页 | **不动**（foliate/pdf 内核自带翻页动效；预览的 turn-out/in 不注入，避免与内核双动画打架） | — |
| 选区菜单/批注浮层 | §4.5 | 选区真实建立 |
| 工具栏钮/段控/开关钮 | §4.1/§4.4 | 交互态 |
| dock | §8.4 | 面板开合 |

---

## 6. 摘录界面（ExtractReviewView）

### 6.1 当前问题

1. 批注轨止于底栏上缘（`height: calc(100vh - 120px)`），窗口左下角永远缺一块；轨与底栏无让位关系（用户决策 6）。
2. 卡面无"卡片感"：无边框、无分节标签，与预览的 `.card`（描边 + 分节 + meta 行）观感差距大。
3. 换卡入场仅 4px 升起（120ms），方向感弱。
4. 头带/工具栏按钮缺交互反馈（同 §5.1-1）。
5. 底栏（**形态不动**，D74/D77）与手动制卡模态、AI 面板的层级关系混乱（AI 面板在摘录页渲染在滚动流里，几何悬空——§8 一并修复）。

### 6.2 目标结构

```
extract-page（滚动根，现状不动；新增 data-dock-open）
├─ extract-page-cols
│  ├─ [extract-annot-rail]（批注轨——v1 几何改为 fixed，见 6.3；【贯通到窗底】）
│  └─ extract-main
│     ├─ extract-page-head（吸顶头带，类名/钩子全保留）
│     │  ├─ extract-toolbar（【保留】模式/形式段控 + 制卡/AI制卡/AI解释/摘录/查词）
│     │  └─ extract-page-head-inner（面包屑 + 计数，现状不动）
│     └─ ExtractCardFace（§6.4 ctas 化）
├─ stage-bar（D74/D77 控件形态不动；宽度让位见 6.3）
├─ CardDock（§8，fixed 右停靠）
└─ 浮层（SelectionMenu / AnnotationEditor：§4.5）
```

### 6.3 核心几何：侧栏贯通到底 + 底栏收缩（用户决策 6）

**机制**：轨从 `sticky` 改 **`fixed`**（与 `.annot-toggle` 同一锚定方式）——fixed 相对视口，永不因滚动到内容末端被 clamp 回缩（sticky 方案在滚到底时轨会随内容末端上提 72px，破坏"贯通"；fixed 从机制上消除该缺陷）。DOM（JSX）零改动，只改 CSS：

```css
/* v1（D88）：轨贯通到窗底 + 底栏宽度让位（取代 v5 的 height:calc(100vh - 120px) sticky 方案；
   D72「底栏不做补偿」条款由用户 2026-10-04 指令取代） */
.extract-annot-rail {
  position: fixed; left: 0; top: var(--sp-12); bottom: 0;   /* top=顶栏 48；bottom=窗底 */
  width: 280px; overflow: hidden; z-index: 3;
}
.extract-annot-rail.is-closed { width: 0; visibility: hidden; }
.extract-page[data-annot-open="1"] .extract-page-cols { padding-left: 280px; }
.extract-page[data-annot-open="1"] .stage-bar { margin-left: 280px; }   /* 底栏收缩＝左缘让到轨右缘 */
@media (prefers-reduced-motion: no-preference) {
  .extract-annot-rail { transition: width var(--dur-panel) var(--ease), visibility var(--dur-panel) linear; }
  .extract-page .extract-page-cols { transition: padding-left var(--dur-panel) var(--ease); }
  .extract-page .stage-bar { transition: margin-left var(--dur-panel) var(--ease); }
}
```

要点逐条（验收口径见 §13-C）：
- 轨高 = `top:48 → bottom:0`，**任何滚动位置、任何内容长度下轨底缘都贴窗底**（fixed 无 clamp）。
- 底栏收缩：`margin-left 0 ↔ 280px`，与轨宽、主列 padding 三者**同 `--dur-panel` 同 `--ease` 同步**过渡——动画期间底栏左缘始终贴着轨右缘，不被遮挡、不露出缝。
- 底栏**控件与内距零改动**（`height:72; padding:0 var(--sp-4)` 保持 D77）：按钮距底 16 不变，左距从「距窗缘 16」变为「距轨缘 16」——这就是"相应收缩"的语义。
- 轨 z-index 3 < 底栏 z 4：过渡瞬间的亚像素重叠由底栏 paper 底盖住（底栏在右，几何上不相交，此条只是保险）。
- `data-annot-open` 已是既有状态钩子（ExtractReviewView L809），直接复用为 CSS 条件，不新增状态。
- 空态/加载态（无轨无栏）不受影响；查看态轨常驻（D75）照旧。
- 复习页/合并复习分支**不做**此几何（无轨，底栏仍满宽）。

### 6.4 卡面 ctas 化（结构与排版的预览采纳 + 项目契约修正）

| 预览元素 | 采纳 | 项目化修正 |
|---|---|---|
| `.card`（1px 描边 + 分节） | 采纳：`.extract-face` 加 `border: 1px solid var(--border-strong); background: var(--paper)`，分节 `.sec + .sec` 用 hairline `--border-subtle` | 描边用中性 strong 灰（§2.2），不是预览的黑 |
| `.sec-label`（11px 600 字距 .14em helper） | 采纳：原文摘录 / 我的批注两节各加节标签 | 字号取 `--fs-meta`、色 `--text-helper` |
| `.quote` 左缘 3px 批注色条 | 采纳：引文区块 `border-left: 3px solid`，色 = 该摘录 `annotationColor`（`annotColorCss()` 既有函数）；无色 = `--accent` | **颜色体系不动**：取 `--annot-*` 实色，不引入预览演示色 |
| `.cardmeta`（时间 · 页码 · chips · 右侧动作） | 采纳：meta 行 = 添加时间（mono）· 来源层级 · 已制卡 N 张（mono，只读文字）；右端「跳转原文」（若锚在场，跳底栏既有动作同语义）或留空 | **不采纳**预览的「生成卡片」钮——本项目无"整卡一键制卡"既有动作，制卡入口仍是工具栏「制卡」（需选区）；不发明新动作。**不采纳** kbd 角标（D77：快捷键一律 hover title） |
| 卡片切换 cardIn/cardOut | **单向采纳**：换卡重挂载播放 `stage-card-in` 升级为「`opacity 0→1 + translateX(24px→0)`，`--dur-stage`(240ms) `--ease-out-soft`」——入场方向=队列前进方向 | **不做两段式 out→in**：out 段需要 JS 定时器编排，给连续处理每次推进白加 ~200ms 延迟，违背"宁快勿拖"（EXCERPT-REVIEW §6 基线纪律）；重挂载单段入场已由 `key={current.id}` 机制保证逐卡触发 |
| `.xitem` 批注条目 hover 位移 | 采纳 `translateX(2px)` + `--grey-1` 底（160ms） | 竖线右移（D74）等摘录页作用域规则全部保留 |

**排版锁定项（不得被预览字号覆盖）**：`.extract-page .extract-face-body` 仍为 **26px/1.5**（D1 双域，extract.gui 有对照断言）；预览 quote 的 17px/1.9 只用于"节标签 + meta"层，不碰正文。

### 6.5 头带/工具栏

- `extract-toolbar` 全体钮换 §4.1/§4.4 语言（24px 档）；禁用态保持 D84 反转（placeholder 字 + grey-2 描边）。
- 头带（sticky / 满宽 / paper 底 / band-line 下缘 / 内列同盒对齐）**几何与类名零改动**——面包屑测试的三条敏感断言依赖它。
- 「N 条待处理」计数升级为预览 `.pending` 形态：`8px accent 方点 + 数字 mono 600`（结构：外层 `.review-count` 类保留，内部允许加 `<i class="count-dot">` 装饰元素——纯装饰不加 data 钩子）。

---

## 7. 复习界面（ReviewView）

### 7.1 当前问题

1. 顶栏计数是一行 helper 灰字（`未学习 0 学习中 13 待复习 36`），无层级、无色彩语义。
2. 无会话进度感（预览有 3px 进度轨）。
3. 翻面瞬时切换，正/背面无连续性（预览 3D 翻卡）。
4. 评分四钮语义色只在左缘 4px 条上（暗色弱、主次不明——预览的「推荐档放大填充」缺位）。

### 7.2 顶栏：队列统计块 + 进度轨

- `[data-review-counts]` 容器类与三个字符串（`未学习 / 学习中 / 待复习`）**保留**（m4/m12 断言），内部升级为预览 `.qi` 三块：
  ```
  ┌ review-head（吸顶，现状）
  │  └ review-head-inner（右对齐改左?——保持 flex-end 现状，计数块整体靠右）
  │     └ [data-review-counts]（改 display:flex; gap: var(--sp-6)）
  │        └ ×3：.qi { .lab（11px helper + 8px 色点）+ .num（20px/300 tabular） }
  │           色点：未学习=--grey-3 · 学习中=--warning · 待复习=--accent
  ```
  字重修正：预览 20px/700 与瑞士「越大越细」冲突 → **20px / 300**（`--fs-title-l` 的一半档；若需新 token：`--fs-stat: 20px`，随 D88 登记）。
- 计数变化 bump：`.num { transition: transform 200ms var(--spring) }` + `.bump { transform: scale(1.18) }`——由真实 counts 变化驱动（React 比较前后值加类、200ms 后摘）。
- **进度轨**：`.review-head` 下缘新增 `.review-progress`（高 3px？—— hairline 纪律只允许 1px/2px；取 `calc(var(--sp-1) / 2)`=2px，槽 `--grey-1`、填 `--accent`，`transition: width 500ms var(--ease)`）。宽度 = `doneCount / (doneCount + counts.new + counts.learning + counts.review)`；分母为 0（无卡）→ **整个元素不渲染**（禁假动画）。

### 7.3 翻卡（3D flip，grid 等高栈——免测量实现）

CardFace 改为**双面常挂**（正/背面同时渲染），外层包 `.review-flip`：

```css
@media (prefers-reduced-motion: no-preference) {
  .review-flip { display: grid; transform-style: preserve-3d;
                 transition: transform var(--dur-flip) var(--ease-out-soft); }
  .review-flip > * { grid-area: 1 / 1; backface-visibility: hidden; -webkit-backface-visibility: hidden; }
  .review-flip .review-back { transform: rotateY(180deg); }
  .review-flip.flipped { transform: rotateY(180deg); }
  .review-session { perspective: 1600px; }
}
@media (prefers-reduced-motion: reduce) {
  /* 降级＝不做 transform：showBack 切换时两面对调 inert（视觉=瞬时切换，同现状） */
}
```

- **等高免测量**：grid 两面同格 → 容器高 = max(正, 背)，矮的一面拉伸补齐（内容顶对齐）。无 JS 测量、无固定高度，图片卡/长卡自适应。
- **可达性/编辑安全（硬性）**：非当前面挂 `inert` + `aria-hidden`；`showBack` 切换时对调（EditableText 只在背面可编辑的现状契约不变——非当前面的编辑器不可聚焦）；reduce 降级路径同样只对调 inert。`.review-front` / `.review-back` 类名**保留**（m4 断言在用）。
- 换卡：`<CardFace key={current.id}>` 既有 remount 机制不变，入场动画升级为 `--dur-stage`（同摘录页，两页同一配方）。
- 风险预案（写入实施注记，不算验收项）：KaTeX/图片双面渲染成本可接受（单卡）；若实施中发现某卡型双面渲染崩坏，该卡型回退"仅当前面挂载 + 240ms rise 揭示"，并在 PR 中登记——不得静默扩散成全局回退。

### 7.4 评分 CTA（预览 `.grade` 的项目化）

现状 §5.3 合同（灰底 + 左缘 4px 色条 + 均等）升级为预览卡式评分钮——**这是 GUIDE §5.3/§5.4 文字的合同变更**，随 D88 修订（§14.2）：

- 结构：`<button class="grade grade-good">` 内部改两行——第一行 `8px 语义色点 + 档名（15px/500）`，第二行 `.grade-due`（mono，间隔预览文本，既有数据）。
- 语义色唯一承载 = 色点：`--dc` 取 `--error / --warning / --accent / --success`（与 §3.3 同表，从左缘条改为色点；`::before` 色条规则随零消费者删除）。
- **推荐档（Good）**：`--accent` 填充 + `--accent-on` 文字、`min-height 72px`（其余 64px）、色点白色——Staging 主视觉（预览原样，已是主题色）。
- hover：`translateY(-3px)` + `--shadow-hover` + 色点 `scale(1.35)`（spring 160ms，滞后 20ms——Follow Through）；active `scale(0.95)` 60ms；点击 settle（§4.2）。
- 四钮入场（翻到背面）：`rise 320ms` 依次 60/130/200/270ms stagger（预览原样，`.grades.live` 作用域）。
- **kbd 角标不采纳**（D77：快捷键走 title 气泡——`title` 内容 = `重来（快捷键：1）· 间隔 10分` 式组装）；`1-4` 键位矩阵零改动。
- disabled（saveError/previewError）：现状落灰，无位移。

### 7.5 底栏其余

- 「显示答案」＝ `.bar-btn.primary.grow` 现状填充钮 + §4.1/4.2（hover 抬升 + settle）。
- `.bar-more`/`.bar-pop` 弹层：入场淡入 150ms（既有 stage-pop-in 保留），弹出钮 §4.1 32-40px 档。
- 跳转原文/查看原图 ghost 钮同 §4.1。

---

## 8. 制卡面板（CardDock）——右侧新侧边栏

### 8.1 定位与复用边界（不发明新后端）

- 面板 = **统一右停靠栏**：400px（`max-width: 45vw`，沿 `.ai-panel` 既有几何），fixed 右缘、`top: var(--sp-12)`（顶栏下）、`bottom: 0`、`z-index: var(--z-drawer)`、paper 底 + 左缘 hairline + `--shadow-float`。
- **两个内容态，同刻只开一个**（互斥，由既有 `manualOpen` / `aiPanel` 两个互斥状态天然保证）：
  - **手动态**：`ManualCardEditor` 的表单体（问题/答案/翻转/填空/图片挖空 + UDC 领域 + 上下文前缀 + 助记 + 知识点 + 日期标记 + 优先级滑块 + 创建/取消），字段、落库链（`handleManualCard → createSingleCard`）、contextRef 装配**一字不改**。
  - **AI 态**：既有 `AIPanel` 原组件嵌入（流式草稿/接受/拆分/追问/检索重试，全部钩子不动）；其 `.ai-panel-head` 标题行并入 dock 头（`.ai-panel-title` 类保留，迁移进 dock-head 内）。
- 复用同一套数据流的实现路径：`SelectionPanels.tsx`（Reader 与摘录页**共用**的三个面板渲染器）只换渲染容器——`manualOpen` 改渲染 `<CardDock mode="manual">`、`aiPanel` 改渲染 `<CardDock mode="ai">`；`useSelectionActions` 的状态机、Esc/失焦/保存后关闭（`closeManual`）、AI 批次 reject 逻辑零改动。
- `DictPanel`（查词）**不在本轮范围**，维持现状；但 dock 几何类（`.side-dock`）为其预留（后续批次可挂）。

### 8.2 结构与类名/钩子（新）

```tsx
<aside class="side-dock card-dock" data-card-dock role="complementary" aria-label="制卡面板">
  <div class="side-dock-head">                          {/* 48px，hairline 下缘 */}
    <span class="side-dock-title">手动制卡 | AI 制卡 | AI 解释 | 图片挖空</span>  {/* 随态换文案 */}
    <span class="side-dock-meta mono">《材料名》· 来源锚</span>   {/* 有则显，无则省 */}
    <button class="icon-btn side-dock-close" data-dock-close aria-label="关闭面板">×</button>
  </div>
  <div class="side-dock-body">                          {/* 自滚 */}
    （手动态）ManualCardForm：seg-tabs / form-field / ta-short / form-actions 类名原样
    （AI 态）  AIPanel：ai-panel-body / 草稿卡等类名原样
  </div>
</aside>
```

- `ManualCardEditor.tsx` 拆分：表单体抽为命名导出 `ManualCardForm`（props 与现组件一致，去掉 modal 包装）；默认导出 `ManualCardEditor` 保留为「modal 包装 + ManualCardForm」——**图片挖空**（imageOcclusion，来自图片聚焦工具条）继续走 modal（大图预览需要幅面），其余三模式走 dock。这样 m6 系列图片挖空断言零迁移。
- dock 关闭：`data-dock-close` 钮 / Esc / 保存成功后（现状 `closeManual()` 语义：保存后关面板 + toast）；AI 态关闭＝现状 AIPanel 关闭逻辑（含批次 reject）。

### 8.3 触发链（全部为既有入口换呈现，不新增动作）

| 入口 | 现状 | 之后 |
|---|---|---|
| 工具栏「制卡」（Reader / 摘录页 `data-sel-act="manual"`） | 居中模态 | dock 手动态（quote=选区） |
| 标记浮层「就此制卡」（`data-make-card`） | 居中模态 | dock 手动态（quote=标记文本，contextRef 链不变） |
| 工具栏「AI 制卡」（`data-sel-act="aiCards"`） | 右 dock（ai-panel） | dock AI 态（视觉统一，逻辑同前） |
| 工具栏「AI 解释」（`data-sel-act="explain"`） | 右 dock | dock AI 态（标题「AI 解释」） |
| 图片挖空（选图后） | 模态 | **维持模态**（§8.2） |

### 8.4 动效（用户决策 7：新内容同样按 buttons-ctas）

- 开合：`transform: translateX(100%) ↔ 0`，`--dur-panel` `--ease`（fixed 面板用 transform，不触发布局）；reduce → 瞬时。Reader 让位（`.reader-body-shifted` 的 flex-basis 让位机制保留）与摘录页主列让位（见 8.5）同步同参数。
- 表单内主钮「创建卡片」＝ `.btn-primary`（§4.1）+ settle（§4.2）+ 涟漪（§4.3）。
- AI 草稿卡入场：`rise 240ms`（草稿到达/接受后列表重排，120ms 位移淡入）。
- 成功反馈：保存成功 → dock 关闭 + 宿主既有 toast（不造新成功页）；AI 接受单张 → 该草稿卡 200ms 压暗飞出（`scale(0.97)+opacity`）后从列表移除。

### 8.5 让位几何（Reader / 摘录页两宿主）

- **Reader**：保持既有 `.reader-body.reader-body-shifted .reader-scroll { flex: 1 1 calc(100% - 400px) }` 机制（ai-panel 时代已验证）；dock fixed 化后该让位语义不变。
- **摘录页**：`.extract-page[data-dock-open="1"]`（新钩子，随 manualOpen/aiPanel 任一在场置位）：
  ```css
  @media (min-width: 1520px) {  /* 让位仅在宽窗启用；窄窗＝覆盖层 */
    .extract-page[data-dock-open="1"] .extract-main { padding-right: 416px; }
    .extract-page[data-dock-open="1"] .stage-bar { margin-right: 416px; }
  }
  ```
  （416 = 400 + 16 间距；threshold 1520 = 1120 最小窗 + 400 dock；轨与 dock 同开时左右 margin 并存，版心取剩余宽。）**窄窗（<1520）dock 为覆盖层**：不压缩内容，浮于其上（`--z-drawer` + 左缘 hairline + `--shadow-float`），Esc/关闭钮退出——保护 1120 最小窗下卡面/底栏可用性。
- Reader 同阈值不引入（保持现状恒让位——现网行为，用户未报问题，不借本轮扩改）。

### 8.6 各状态（dock 专属）

| 状态 | 表现 |
|---|---|
| 关闭 | 不挂载（与 manualOpen/aiPanel 现状一致，无常驻空轨） |
| Empty（无选区打开，仅理论可达——工具栏钮无选区时 disabled） | 不存在（入口已 disabled，D84 语言） |
| Loading（AI 流式） | AIPanel 既有流式态（计时 mono + 骨架卡） |
| 手动编辑态 | 表单原样；quote 区块 = 引文（`card-quote` 类保留）+ dock meta 行来源 |
| Success | 保存成功 → toast + 关面板（现状链）；AI 接受 → 草稿飞出（8.4） |
| Error | AI 错误 `.ai-error` 原样（红字 + 重试/检索钮）；手动校验 `canSave` 禁用创建钮（现状） |
| Disabled | 「创建卡片」`saving || !canSave`（现状）；disabled 落灰无涟漪 |

---

## 9. 三界面统一状态总表（默认/Hover/Focus/Loading/Empty/Error/Success/Disabled）

| 状态 | 规则（除上文体已述者） |
|---|---|
| 默认 | 各界面骨架如 §5.2/§6.2/§7.2；预览的纸色/墨色直接用既有 `--paper/--ink` |
| Hover | §4.1 分档；列表条目 `--grey-1` + `translateX(2px)`；不可点元素（纯文本/表格行）无 hover 位移 |
| Focus（键盘） | 全站 `:focus-visible` 2px `--accent` outline offset 2px；填充钮上 outline 取 `--ink`（推荐评分档）——既有全局规则确认覆盖新钮 |
| Loading | 复习页/摘录页加载文案现状保留；AI 流式见 §8.6；标记装载动效仅首次（§5.3） |
| Empty | 三页空态（empty-state 方块装饰 + 文案 + 撤销钮）**结构不动**，装饰方块入场加 `rise 400ms`（reduce 降级）；摘录空态无轨无栏（现状） |
| Error | `save-error` 横幅现状；persist 失败封锁动作逻辑不动；AI 错误见 §8.6 |
| Success | flash//toast 现状（1800ms 自消）；新增的可见成功动效仅 §8.4/§7.2 bump |
| Disabled | D84 色阶反转全站适用（可用深/禁用浅）；填充钮 disabled 落灰 + 无阴影无涟漪 |

## 10. 动画原则落点速查（12 原则 → 本项目）

| 原则 | 落点 | Token |
|---|---|---|
| 1 Squash & Stretch | 全钮 `:active scale(.95)` / 图标钮 .92 | `--dur-press` |
| 2 Anticipation | hover 抬升 -1/-2/-3px | `--dur-hover` |
| 3 Staging | 主 CTA 填充放大（显示答案/下一条/良好档/创建卡片）；工具栏钮不加戏 | — |
| 4 Pose to Pose | 按钮五态关键帧（§4.1）；翻卡 front/back 两姿态 | — |
| 5 Follow Through | 图标/色点/间隔标签滞后 20-30ms | `--dur-hover` + delay |
| 6 Ease In/Out | 按钮 `--ease-out-soft`；栏/dock `--ease`；指示条 `--spring` | §3 |
| 7 Arcs | 无 FAB，不适用（声明不用） | — |
| 8 Secondary Action | 涟漪（§4.3）+ 图标随动；不压主体 | 520ms |
| 9 Timing | hover 160 / press 60 / focus 150 / 浮层 220 / 翻卡 500 | §3 |
| 10 Exaggeration | 主 CTA settle 1.05（§4.2）；仅主 CTA | 350ms |
| 11 Solid Drawing | 全态直角 0、描边一种灰（`--border-strong`/`--border-subtle`）、阴影单一光源（y 正向） | — |
| 12 Appeal | 直角＝专业（瑞士魂）；按压反馈可信 | — |

## 11. 窗口尺寸变化行为

- 支持域：min 1120×640（`electron/main.js` 现状）。
- 摘录页轨开合：fixed 轨 + cols padding-left + 底栏 margin-left 三量在**任意窗宽**下同步（无断点）；1120 宽轨开时底栏宽 840 ≥ 控件最坏 ~700px（既有 §7 结论沿用）。
- dock 让位阈值：`<1520` 覆盖层（内容不动）；`≥1520` 让位（§8.5）。Reader 维持恒让位。
- 评分行：1120 宽下四钮各 ≈180px ≥ 可读下限；`min-height 64/72px` 在 640 高窗口：头带 48 + 进度 2 + 卡区 + 底栏 72，卡区 flex 收缩，长卡滚动（`.review-session` 现状 overflow 行为保留）。
- 头带快捷键提示 `<1150` 隐藏（现状阶梯）；`.reader-pageinfo` 窄窗（<1150）最先隐藏（新增退让第一级，单调）。

## 12. 分阶段实施顺序（每阶段独立可验收、可合入）

| 阶段 | 内容 | 文件白名单 | 回归闸门 |
|---|---|---|---|
| **P0 地基**（纯 CSS+2 个新 util，零 DOM） | §3 Token、§4 通用钮态/段控/浮层入场、§2.2 色映射涉及的既有规则改写 | `src/theme.css`、新增 `src/lib/press.ts` | 全套 GUI 应**零改动全绿**（无钩子/几何变化）；`npx tsc --noEmit` |
| **P1 摘录页** | §6.3 轨 fixed+底栏让位、§6.4 卡面、§6.5 头带计数 | `src/theme.css`、`src/components/ExtractReviewView.tsx`（计数点/首批 marks 类位）、`src/components/ExtractCardFace.tsx`（仅类名/节标签） | extract / breadcrumb / annotations（摘录段） |
| **P2 阅读页** | §5.2 pageinfo、§5.3 标记入场、dock 前置：ai-panel fixed 化 | `src/theme.css`、`src/components/Reader.tsx`、`src/components/AIPanel.tsx` | annotations / marks / m15r / reader.engine |
| **P3 制卡面板** | §8 全部（ManualCardForm 抽取、CardDock、SelectionPanels 换容器、让位阈值） | `src/components/ManualCardEditor.tsx`、新增 `src/components/CardDock.tsx`、`src/components/SelectionPanels.tsx`、`Reader.tsx`/`ExtractReviewView.tsx`（触发位）、`theme.css`、**测试迁移**（§13-D 清单） | cards / m1 / m6-1 / m6-2 / m6-2native / k1 / reader.engine / marks（选择器迁移后全绿） |
| **P4 复习页** | §7 全部（统计块/进度/翻卡/评分钮） | `src/theme.css`、`src/components/ReviewView.tsx`、`src/components/CardBrowser.tsx`（仅 CardFace 双面化） | m4 / m12 / breadcrumb（合并段） |

## 13. 可机械检查的验收标准清单

**A. 构建与静态**
1. `npm run build` 退出码 0；`npx tsc --noEmit` 0 错误。
2. diff 白名单 = §12 表列文件 + `tests/`（仅 P3 迁移清单涉及者）+ `AI_DEVELOPMENT_GUIDE.md`（§8.1 D88 行 + §5 两处条款，由主控誊写）；`electron/`、`src/lib/`（除新增 `press.ts`）零改动。
3. IACVT 审查：新增 CSS 中每个 `var(--x)` 在 theme.css 有 `--x:` 声明（§5.1 配方）；新 Token 全在 `:root` 静态声明。

**B. 既有闸门零回归（测试文件零改动，P3 清单内的除外）**
4. `node tests/extract.gui.mjs`、`node tests/breadcrumb.gui.mjs`、`node tests/m4.gui.mjs`、`node tests/m1.gui.mjs`、`node tests/m12.gui.mjs`、`node tests/annotations.gui.mjs`（99 断言）、`node tests/marks.gui.mjs`、`node tests/cards.gui.mjs`、`node tests/m15r.gui.mjs`、`node tests/accent.gui.mjs` 全绿；`node tests/flows/f11-*.cjs` / `f18` / `f20` / `f21` / `f24` / `f27` 全绿（D88 誊写后）。
5. breadcrumb 三条敏感断言机制保持：`.extract-page` 仍真滚动、`.extract-page-head` 仍 sticky+不透明底+首 token 命中、`scrollIntoView` 居中不变（§6.3 改动不触碰这三者的几何前提）。

**C. 几何断言（CDP/DevTools，±1px）**
6. 摘录页轨展开：`.extract-annot-rail` rect `top===48 && bottom===window.innerHeight && left===0 && width===280`（贯通到底）；`.extract-face-actions` rect `left===280`；`position==='fixed'`。
7. 轨收起：rail `width===0`（visibility hidden）；`.extract-face-actions` rect `left===0`。
8. 底栏其余分量：`height===72 && bottom===window.innerHeight`；轨开合前后 `top/height/right/bottom` 不变、仅 `left` 在 0↔280 之间（收缩语义）。
9. 复习页背面：四钮 `rect.bottom <= window.innerHeight && rect.height>=64`；`.grade-good` computed `backgroundColor` === `--accent` 解析值，其余三钮 === `--grey-1`；`.review-flip.flipped` computed `transform` 含 `matrix3d`（翻面生效）；非当前面 `inert` 属性在场。
10. dock：打开时 `.side-dock` rect `top===48 && right===window.innerWidth`；1120×640 窗口下 `.extract-main` padding-right===0（覆盖层阈值生效）；≥1520 时 ===416。
11. 头带对齐/评分色/排版不变量（EXCERPT-REVIEW §9 的 C/D/E 组断言原样复跑通过——尤其 `.extract-face-body` 26px 与 `::before` 色条断言若因 §7.4 改点而失效，**该断言随 §14.2 合同修订同步改写**，不得静默删除）。

**D. 类名与 data 钩子清单（保留 = 测试断言在用，禁改；改名 = P3 迁移）**
- **保留（抽样全量见各测试文件）**：`extract-page(-head/-head-inner/-cols)`、`data-showing-extract-id`、`data-viewing`、`data-annot-open`、`data-annot-cols`、`with-annot`、`data-annot-toggle`、`#extract-annot-panel`、`annot-toggle bar-btn`、`extract-annot-rail(.is-closed)`、`annot-side(-head)`、`data-annot-count/-filter/-sort/-zitem/-edit/-del/-palette/-pick/-zn`、`extract-toolbar`、`data-extract-toolbar`、`seg-rail`、`btn-rail`、`data-annot-mode/-form`、`data-sel-act`、`data-sel-actions`、`extract-crumbs`、`data-extract-crumbs`、`crumb-root/-item/-here/-sep/-more/-exit`、`data-crumb-more/-hidden`、`data-crumb-exit`、`extract-page-header/-hint`、`data-page-hint`、`extract-flash`、`extract-exit`、`review-count`、`extract-face(-body/-text/-actions)`、`data-extract-bar`、`extract-quote-hl`、`review-editable`、`stage-bar`、`bar-btn(.primary/.ghost/.grow)`、`bar-cluster/-side/-more/-pop`、`data-menu`、`data-pop`、`grade(-row/-grid/-again/-hard/-good/-easy)`、`grade-due`、`data-review-bar`、`data-reveal`、`data-review-counts`、`review-wrap/-head/-head-inner/-session/-face/-front/-back/-meta/-mnemonic/-deferred/-count(s)`、`deferred-list`、`save-error`、`reader-wrap/-body(-shifted)/-scroll/-side-rail/-sidebar/-engine-controls(-group)/-divider/-nav-btn/-engine-main/-engine-viewport/-map-layer/-markdown/-title/-toast/-marks-layer`、`data-reader-side-rail`、`data-reader-sidebar-toggle`、`data-sidebar-tab`、`data-reader-annot-head`、`data-tool-menu-panel`、`dd/dd-menu/dd-item`、`mindmap-tab-panel`、`selection-menu`、`mrow`、`menu-comment`、`swatches`、`swatch[data-color]`、`editor`、`data-editor-for/-kind`、`ebar`、`colorbtn`、`data-colorbtn/-savestate/-cardcount/-open-cards/-make-card/-del/-del-confirmed/-del-cancel/-colorpop/-colorrow/-customcolor`、`make-card`、`cardcount`、`ai-panel(-head/-title/-body)`、`ai-error`、`topbar(-nav/-title)`、`nav-item`、`icon-btn`、`win-controls`、`modal-panel`（**非制卡模态**：AddBook/对比卡/摘录详情/设置）、`pdf-mark-layer`、`reader-doc-mark`、`data-mark-id`、`occlusion-shape`、`empty-state` 系。
- **新增**：`side-dock card-dock`、`data-card-dock`、`side-dock-head/-title/-meta/-body`、`data-dock-close`、`data-dock-open`（摘录页根）、`reader-pageinfo`、`reader-marks-enter`、`review-flip(.flipped)`、`review-progress`、`qi/qi-num/count-dot`、`settle`、`ripple`、`is-placed`。
- **改名/退役（P3，逐条测试迁移）**：制卡场景 `.modal-panel` → `[data-card-dock]`（迁移前先跑 `grep -n "modal-panel" tests/*.mjs` 全量枚举；仅「手动制卡」语境迁移——m1 翻转问答、marks 就此制卡、reader.engine 制卡链、k1 生词卡；m4 的 modal-panel＝对比卡、m8＝建册，**不迁移**）。`MarkPopover` 已于 D85 退役，本轮无新增退役件；预览右侧竖条 `.tools` 声明不引入。

**E. 动效降级**
12. 系统开启"减少动效"后：`.review-flip` computed `transition` 为 none 且翻面即时对调 inert；`.settle`/`.ripple`/标记入场动画 `animation-name === 'none'`；轨/底栏/ dock 的 `transition-duration` 归 0（或规则不在场）。关闭后抽查 `--dur-hover===160ms` 等解析值。

## 14. GUIDE §8.1 D88 条目草稿（v48.48；主控誊写）

### 14.1 决策行

| # | 决策 | 理由 | 版本 |
|---|---|---|---|
| D88 | **v48.48 三界面 buttons-ctas 动效语言改造 + 右侧制卡面板（设计文档 `docs/design/UI-CTAS-REDESIGN-D88.md` v1）**：①新增动效 Token（`--ease-out-soft/--spring/--dur-hover/--dur-press/--dur-panel/--dur-stage/--dur-flip/--shadow-hover`）与按钮五态通用语言（hover 抬升/active 缩放/图标滞后/主 CTA settle/填充钮涟漪），三界面统一；②预览黑强调全部改判主题色（选中态 accent 填充、强描边中性灰）；③阅读页：工具栏保留+pageinfo、标记划笔入场、选区菜单/批注浮层 spring 入场、不引入右侧竖条；④摘录页：批注轨改 fixed 贯通到窗底、底栏 margin-left 0↔280 让位收缩（取代 D72「底栏不做补偿」）、卡面描边分节+换卡 240ms 方向性入场；⑤复习页：顶栏三档统计块（色点+20px/300）+2px 进度轨（真实分母，禁假动画）、CardFace 双面 grid 等高 3D 翻卡（inert 达可达性）、评分钮改色点+推荐档 accent 填充放大（§5.3 色条条款随之修订）；⑥右侧制卡面板 CardDock（400px fixed 右停靠，手动态=ManualCardForm 抽取、AI 态=AIPanel 嵌入，SelectionPanels 换容器，数据流零改动；图片挖空维持模态；窄窗 <1520 覆盖层、宽窗让位）；⑦纪律：全部新动效包 no-preference 降级、`--shadow-hover` 与按钮 transform 为瑞士基线的显式豁免件（范围锁定） | 用户 2026-10-04 逐字指令（存设计稿 §0）；v12 已放开高级动效 | v48.48 |

### 14.2 随 D88 需同步修订的既有条款（主控逐条誊写，缺一不可）

1. **§5.1**：补"动效 Token 分层"一段（§3 内容：`--ease` 管栏级、`--ease-out-soft` 管按钮级、`--spring` 管指示/回弹；时长五档）。
2. **§5.3 评分模块**：「4 等分 grid，灰底+左缘 4px 语义色条（Again红/Hard黄/Good蓝/Easy绿）」→「4 等分 grid；语义色以 8px 色点承载（Again=--error/Hard=--warning/Good=--accent/Easy=--success）；推荐档 Good＝accent 填充+accent-on+加高（Staging）；hover 抬升+色点放大；间隔预览 mono 第二行」。同条中「Good 蓝」表述一并更正为 accent（v48.35 起 accent=绿，原文色名未随之更新，借本轮勘误）。
3. **§5.4**：新增三条组件条款——「制卡面板 dock」（§8 摘要）、「复习翻卡」（双面常挂+inert+reduce 瞬时）、「settle/涟漪豁免与白名单」（§4.2/4.3 + `--shadow-hover` 范围）。
4. **§6（EXCERPT-REVIEW 引注处）**：v12 条款补一句「时长/缓动走动效 Token 体系（--dur/--ease + D88 增补族）」；v5「底栏不做补偿」注记 D88 取代。
5. **§7.3 测试义务表**：P3 迁移涉及的套件名后补注（制卡模态断言改 dock 口径）。

### 14.3 范围外（再申明）

FSRS/调度/IPC/表结构零触碰；`--annot-*` 色板与其注入链零触碰；摘录页底栏控件形态（D74/D77）零触碰；DictPanel/查词流程零触碰；书架/卡片浏览器/日记/设置页**不在本轮三界面范围**（CardBrowser 仅因 CardFace 双面化被牵动，其列表页不动）。

## 15. 风险与备注

- 翻卡双面渲染是本稿最大单点风险：CardFace 双面常挂改变「单面条件渲染」前提（图片卡、词卡音频、KaTeX）。§7.3 已给 inert/降级/卡型回退三级预案；实施时 m4/m12 全绿是硬闸门。
- 摘录轨 fixed 化后，`.extract-annot-rail` 不再随滚动 clamp——annotation.gui 的「轨贴左缘/280 占位」判据不受影响；若个别断言读取 computed `position`，随迁移更新（属 P1 唯一可能的测试触点，先跑再改）。
- ManualCardForm 抽取是纯移动（搬 JSX 零逻辑改动，先例＝批 4 Task 4 从 Reader 搬出）；dock 模式下 textarea 自动聚焦行为需在 CardDock 挂载后显式调用（保持「点开即可打字」体验）。
- 涟漪/settle 均为 onClick/pointerdown 真事件驱动，无定时器驻留；press.ts 单文件无依赖。
- 全稿未发明任何新数据、新 IPC、新设置键；dock 状态完全复用 `manualOpen`/`aiPanel`。
