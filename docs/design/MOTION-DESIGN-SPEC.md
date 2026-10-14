# MOTION-DESIGN-SPEC —— 全局动效设计规范（决策号：D120，v48.76 已登记 GUIDE §8.1/§5.1）

> 本文是后续所有样式与动效开发的**唯一动效依据**。视觉基调仍归 `docs/swiss-international-style.md`（本文不推翻、不重复其色彩/版式/Token 纪律，只补齐「动」这一层）。两份文件冲突时，以瑞士风文档的硬规则（禁抬升以外的表面装饰、浮层进 150ms 出 100ms、视图切换 ≤ 200ms、reduced-motion 降级）为准，本文的取值全部已对齐这些硬规则。
>
> 风格基调（elegance-sophistication 写入规范）：**动效被感知到的是质感，不是存在**。全应用只有一族缓动、一套时长档位；动效永远服务「反馈与空间认知」，不服务娱乐；禁止新增任何带明显回弹/弹性（overshoot）的动效——`--spring` 仅限存量两处（浮层 pop-in、复习计数 qi-num）继续使用，不再扩散。
>
> **R2 修订（2026-10-09，用户实测反馈）**：D120 落地后用户实测五项问题（书架生硬 / 摘录页两态动效不一 / 摘录文本框偏左 / 缺方向性页签切换 / 图表样式与动效均不可感知）。本轮修订：①新增 §5.1 方向性页面切换、§5.2 入场闸门、§5.3 首屏入场；②**推翻 §6 旧裁决「样式不重做」**，§6 全节重写为图表视觉+动效 v2；③§10 书架「首屏不播入场」旧裁决撤销，改为书架入场规格；④新增 §18 摘录页专项（两态统一 + 文本框对齐修复）；⑤§16/§17 追加 R2 验收项与任务拆解表。五项诊断证据逐条见对应章节。

---

## 0. 用户目标与当前问题

**用户目标**：页面切换不生硬、全软件动效统一；图表有样式也有动效；悬停、展开、弹窗、列表、面板各有一套可预期的运动语言；减少依赖、保证性能；破坏性操作有反馈与退路。

**当前问题（来自代码勘察，清单见 §12）**：
1. 页面切换**完全没有过渡**——`App.tsx` 视图是条件挂载直换（[App.tsx:L354-L472](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/App.tsx#L354-L472)），这是「生硬」的根因。
2. 既有动效是**分批叠加**的（D88 按钮族、D92 学习坞、选区浮层、复习舞台卡），时长/缓动/手法各自为政，且有硬编码 ms 散落多处。
3. hover 存在**抬升 + 阴影**（[theme.css:L729-L738](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L729-L738)，D88），用户已明确不要抬升——需移除。
4. 模态只有遮罩淡入（150ms），**面板本体无入场、无任何出场**——闪现感来源之一。
5. 图表（`charts/swiss.tsx`）零动效，Dashboard 显式 `transition: none`。
6. `.ai-panel` 入场动画 `width: 0→400px`（[theme.css:L2550-L2553](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L2550-L2553)）动画的是布局属性，违反复合属性纪律。

**R2 修订（2026-10-09，用户实测反馈）——五项新问题的诊断结论（证据行级，详见 §5.1/§5.3/§6.1/§10/§18）**：
1. **书架生硬**：crossfade 已实施且生效，但快照拍到的是**空书架**——Bookshelf `items` 初值 `[]`、IPC 异步回填（[Bookshelf.tsx:L108](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/components/Bookshelf.tsx#L108)、[L157-L181](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/components/Bookshelf.tsx#L157-L181)），封面在过渡结束后**瞬时涌入、无任何动画**（§10 旧裁决「首屏不播」直接造成）；首屏路径（`app-loading` 直换 `app-shell`，[App.tsx:L359-L368](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/App.tsx#L359-L368)）则**连 crossfade 都没有**。封面 `<img>` 走 `bookasset://` 逐张解码，解码即硬显，加重「生硬」。
2. **摘录页两态动效不一**：两态的「动效」都不是设计意义上的入场——`!loaded` 早退壳（[ExtractReviewView.tsx:L731-L737](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/components/ExtractReviewView.tsx#L731-L737)）是无 `data-annot-open` 的裸页根，数据到达后整副布局（轨/主列/底栏）**一波硬切插入**（初始样式不触发 transition，[theme.css:L6397-L6404](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L6397-L6404)）。展开态硬切空间差＝280px 轨＋版心右移 140px ⇒ 用户感知「大幅度从左往右展开」；收起态只差卡面 ⇒「小幅度」。两态差异是**布局差**，不是动效参数差。唯一真实动效 `stage-card-in`（24px 从右往左）两态同参数，且与页面 crossfade 叠加成双动效（违 §9 单主角）。
3. **摘录文本框偏左（确证 bug）**：[theme.css:L6503](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L6503) `.extract-main > .extract-face { margin: var(--sp-4) 0 }`（特异性 0-2-0）覆盖基线 `.extract-face { margin: 0 auto }`（0-1-0），`margin-inline: auto` 被清零 ⇒ 卡面在主列内容盒内**靠左**（>720 余量全堆右侧）；头带内列与底栏内容列仍 720 居中 ⇒ 三列不对齐。展开态被轨让位掩盖，收起态暴露——与用户实测完全一致。修复＝单行改 `margin: var(--sp-4) auto`（§18.3）。
4. **缺方向性切换**：现行 crossfade 无方向语义（§5 旧设计选型时否决了 slide，理由是「顶栏无稳定空间模型」——用户的页序心智模型推翻了该前提），新增 §5.1 页序表+方向判定。
5. **图表样式与动效均不可感知**：样式未动是 §6 旧裁决（本轮推翻）；动效不可感知的四条证据见 §6.1（挂载时机被视图过渡快照吞前段、挂点覆盖仅 15/25 图型、更新过渡在用户路径上从不触发、容器淡入与页面过渡叠合不可分辨）。

---

## 1. 全局 Motion Token（写入 `theme.css :root`，与现有 token 同风格命名）

现有 token（保留不动）：`--ease` / `--dur` / `--ease-out-soft` / `--spring` / `--dur-hover` / `--dur-press` / `--dur-panel` / `--dur-stage` / `--dur-flip` / `--dur-tip-in` / `--dur-tip-out`。

新增（只增不改）：

```css
:root {
  /* —— 时长档位（全部 ms，禁止组件内裸写 ms） —— */
  --dur-exit: 100ms;    /* 浮层/元素出场（瑞士风硬规则：浮层出 100ms） */
  --dur-enter: 150ms;   /* 浮层/菜单/模态入场（瑞士风硬规则：浮层进 150ms） */
  --dur-view: 200ms;    /* 页面级切换（瑞士风硬规则：视图切换 ≤200ms） */
  --dur-chart: 300ms;   /* 图表数据更新过渡 */
  --dur-chart-in: 400ms;/* 图表首次入场（含 stagger 总预算 ≤600ms） */

  /* —— 缓动（全应用一族，elegance-sophistication：无回弹） —— */
  --ease-enter: cubic-bezier(0, 0, 0.2, 1);   /* 入场专用：快起步缓着陆（ease-out 族） */
  --ease-exit: cubic-bezier(0.4, 0, 1, 1);    /* 出场专用：缓起步快离场（ease-in 族） */
  /* 双向变换（展开/收起、hover 进出、面板开合）仍用既有 --ease-out-soft */
  /* 标准短过渡仍用既有 --ease；--spring 冻结（仅存量两处，禁止新引用） */

  /* —— 位移/缩放档位（token 化，禁止裸写 px 位移） —— */
  --shift-xs: 2px;   /* 图标随动、focus 微移 */
  --shift-sm: 4px;   /* 入场起始偏移（浮层、页面、面板） */
  --shift-md: 8px;   /* 面板/卡片入场偏移上限 */
  --scale-press: 0.95;  /* 按压缩放（沿用现状） */
  --scale-in: 0.98;     /* 入场起始缩放（克制，不用 0.9 以下的弹入） */
}
```

**命名纪律**：时长一律 `--dur-*`、缓动一律 `--ease-*`、位移/缩放档位如上新设。审查方式：`grep -nE "transition:.*[0-9]+ms|animation:.*[0-9]+ms" src/theme.css`，命中的 ms 值必须全部来自上表或既有 token 的内联注释说明（存量豁免清单见 §12）。

**R2 修订（2026-10-09）**：本轮**不新增任何 token**——方向性位移用既有 `--shift-md`(8px)、书架入场用 `--dur-view`/`--shift-sm`、图表 v2 沿用 `--dur-chart*`。新增动效需要的只是选择器与 keyframes，不是新档位。

---

## 2. Skill → 场景映射总表（18 个）

| # | Skill | 性质 | 本软件应用场景 | 规范落点 |
|---|-------|------|----------------|----------|
| 1 | page-transitions | 视觉规范 | 顶栏六视图切换（R2：含方向语义）、进/出阅读器、复习/摘录会话进出 | §5 |
| 2 | data-visualization | 视觉规范 | Dashboard 统计图表、复习进度条、书架进度轨、材料导图/知识图谱的**数据**呈现 | §6（R2 重写） |
| 3 | attention-direction | 原则层（非组件） | 有真实场景，见 §13 裁决② | §9 |
| 4 | frontend-developer | 工作方式指导 | 不作为视觉规范；作开发约定附录 | 附录 B |
| 5 | entrance-animations | 备用库 | 本期不实施；其时长/缓动已被 §1 token 吸收，将来直接引用 token 即可 | §14 |
| 6 | exit-animations | 备用库 | 同上；`--dur-exit` / `--ease-exit` 已为其预留 | §14 |
| 7 | state-changes | 视觉规范 | **一切就地可逆状态变换**：展开/折叠、toggle、checkbox、Tab、段控 | §7（已与 accordions-dropdowns 合并，裁决见 §13①） |
| 8 | hover-interactions | 视觉规范 | 全部 hover 反馈（**禁抬升**，原则修正见 §4） | §4 |
| 9 | elegance-sophistication | 风格基调 | 全应用运动气质：克制、单族缓动、无回弹 | §0 引言 + §1 |
| 10 | modals-dialogs | 视觉规范 | 确认框、AddBookModal、SettingsPanel、RegenCardsModal、AnswerJudgeModal、ContrastCardModal、ImageLightbox、卡片/摘录详情等一切 `.modal-backdrop` 场景 | §8 |
| 11 | accordions-dropdowns | 视觉规范 | 与 state-changes 合并（证据 §13①）；其中「浮层菜单」部分改归 §8.4 | §7 / §8.4 |
| 12 | lists-grids | 视觉规范 | 书架封面墙/目录表（R2：含入场）、卡片浏览器列表、日记时间线、导图版本列表 | §10 |
| 13 | loaders-spinners | 视觉规范 | 骨架屏 / 按钮内 spinner / 进度条 三档按需 | §11 |
| 14 | saas-productivity | 视觉规范 | 弹出面板族：快捷日记（capture 窗口）、**未来全局快捷键制卡面板**（仅预留动效，不设计功能） | §8.5 |
| 15 | css-native | 实现约束 | 全部动效的实现路径（零依赖） | 附录 A |
| 16 | performance-optimization | 实现约束 | 复合属性纪律、stagger 预算、will-change 纪律 | 附录 A |
| 17 | implementation-debugging | 实现约束 | 动效缺陷排查清单 | 附录 A |
| 18 | ux-friction | 原则层 | 破坏性操作的反馈与退路；动效不得阻塞输入 | §8.2 / §15 |

---

## 3. 通用硬规则（任何动效先过这六条）

1. **只动画可复合属性**：`transform` / `opacity`。`filter` 仅限 backdrop 场景。禁止动画 `width/height/top/left/margin/padding`（唯一例外：§7 的 `grid-template-rows` 0fr↔1fr 折叠模式，浏览器已优化且内容高度未知时无替代）。现存违规 `.ai-panel` 入场（width 0→400px）列入 §12 整改。
2. **reduced-motion 双轨制**（沿用本仓既有惯例，不得新造第三套）：
   - 新增装饰性/位移性动效：一律写在 `@media (prefers-reduced-motion: no-preference)` 作用域内——reduce 时规则不在场，元素直接落终态。
   - 功能性过渡（坞开合、面板让位）：在 `@media (prefers-reduced-motion: reduce)` 块内显式 `transition: none`。
   - 可机械检查：每个 `@keyframes` 的消费点必须能被 `prefers-reduced-motion` 的 grep 命中（同文件内存在对应 media 块）。
3. **不阻塞输入**（ux-friction）：任何时长 < 400ms 的过渡期间元素保持可点；模态打开动画期间 Esc 立即可关。用户重复点击不得叠加动画状态。
4. **方向语义一致**（page-transitions · Solid Drawing）：右来=前进/深入，左来=返回；上长=就地展开，下收=就地折叠。全应用只允许这一组空间语义。**R2 修订（2026-10-09）：§5.1 方向性页面切换的位移方向必须与本条语义一致（前进=新页自右入，返回=新页自左入）。**
5. **窗口尺寸变化不触发动效**：resize 引起的重排一律瞬时（图表重渲染 debounce 由现状逻辑承担，不加过渡）；只有**用户主动作引起的状态切换**才动。
6. **stagger 预算**：同屏 stagger ≤ 8 项、单项延迟 ≤ 40ms、总序列 ≤ 400ms（lists-grids 给 30-75ms/项，本软件取下限；elegance-sophistication 要求不拖长）。**R2 补充：书架入场 stagger 同样受本条预算约束（30ms/张 × ≤8 张）。**

---

## 4. Hover 规范（hover-interactions，经用户裁决修正：禁抬升）

skill 原文的 lift/scale 手法（`translateY(-4px) scale(1.02)` + 阴影扩张）**与本规范不兼容**，采纳其「时序与手法」、否决其「位移与阴影」：

| 状态 | 规则 | 参数 |
|------|------|------|
| rest→hover | 底色变 `--grey-1`（瑞士风既有）；可叠加：图标随动 `translateX(var(--shift-xs))`（仅方向性图标，如前进/返回箭头）、文字色 `--grey-3`→`--ink` | `--dur-hover`(160ms) `--ease-enter` |
| hover→rest | 同属性回退 | 200ms `--ease-out-soft`（退出可略慢，hover-interactions 原则） |
| **禁止** | `translateY` 负值上浮；`scale > 1`；hover 新增/加深 box-shadow | — |
| active（按压） | `scale(var(--scale-press))`，`--dur-press`(60ms)——按压是触觉反馈，不属于 hover 抬升，**保留**（沿用 D88 `:active` 族，含 `:not([disabled])` 守卫） | 现状保留 |
| focus-visible | 2px accent 外描边（瑞士风既有），描边出现不过渡（瞬时，避免焦点环爬行感） | — |
| 触屏/无 hover | 全部 hover 规则包在 `@media (hover: hover)` 内（新增纪律） | — |

**存量整改**：删除 [theme.css:L729-L738](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L729-L738) 的 hover `translateY(-2px)/(-1px)` + `--shadow-hover` 规则（`.btn/.bar-btn/.grade/.btn-rail/.seg-rail/.icon-btn/.reader-nav-btn` 的 hover 位移与阴影全部移除），`:active` 缩放与 30ms 图标滞后保留。这些元素 hover 底色反馈已存在（`--grey-1` 族），删位移后不会出现「hover 无反馈」。

---

## 5. 页面切换统一方案（page-transitions）

**手法选型：Crossfade（基础层，R2 起叠加方向位移，见 §5.1）**——本软件六视图是平级功能切换（非层级深入），slide 的左右方向语义在顶栏导航里没有稳定的空间模型（书架→阅读器是「深入」，但摘录→复习是平级），强行 slide 会制造错误暗示。Crossfade 是所有切换对的诚实基底。**R2 修订（2026-10-09）：用户实测提出顶栏页签存在从左至右的明确顺序心智（书架→摘录→复习…），原「无稳定空间模型」前提被推翻——crossfade 保留为基底，叠加 §5.1 的轻微方向位移；方向语义遵守 §3.4（右来=前进，左来=返回）。**复习卡/摘录卡的**卡内**推进（stage-card-in 右滑）保持不变——那是内容流不是页面切换。**

**R2 闪白修复（2026-10-09，帧级+数值取证）**：非对称 crossfade（旧 100ms 先尽 / 新 200ms 未到 1）交叉期合成覆盖率实测最低 **82.7%**，透底（画布纸色 #fafaf8）使深色内容整体 washed——即用户报告的「切换闪白」；快照层之下无任何绘制（红兜底注入实证），补背景色无法根除。机制改为**揭幕式同步**：新快照恒不透明垫底（只位移不淡入），旧快照置顶层 100ms 淡出——合成覆盖率恒 ≡1，任何路径零透底（皮肤模式透窗白同样根除）。「crossfade」作为交互语义名保留，实现机制以下方代码为准。

**实现路径（零依赖）**：`document.startViewTransition()`（Chromium 原生，Electron 可用）+ `::view-transition-old/new` 定制：

```css
/* 页面切换（揭幕式同步，R2 闪白修复）：新视图快照恒不透明垫底（方向位移 200ms），
   旧视图快照置顶层 100ms 淡出——合成覆盖率恒 ≡1，交叉期零透底；总感知 ≤200ms */
::view-transition-old(root) { z-index: 2; animation: view-out var(--dur-exit) var(--ease-exit) both; }
::view-transition-new(root) { animation: none; }
/* 方向位移（fwd/bwd）：选择器直挂（见 §5.1 选择器纪律）；keyframes 只含 transform，不含 opacity */
:root[data-vt-dir="fwd"]::view-transition-new(root) { animation: view-in-fwd var(--dur-view) var(--ease-enter) both; }
:root[data-vt-dir="bwd"]::view-transition-new(root) { animation: view-in-bwd var(--dur-view) var(--ease-enter) both; }
@keyframes view-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes view-in-fwd { from { transform: translateX(var(--shift-md)); } to { transform: none; } }
@keyframes view-in-bwd { from { transform: translateX(calc(-1 * var(--shift-md))); } to { transform: none; } }
@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(root), ::view-transition-new(root) { animation: none; }
}
```

- 调用点集中在 `App.tsx` 的 `setView` 包装函数（所有视图切换只走这一个口子，含 `openBook` / `backToShelf` / `handleJumpToDoc` / 顶栏导航）。
- **降级**：`document.startViewTransition` 不存在时直接 `setView`（瞬时），不垫 fallback 动画。
- 顶栏 `.topbar` 与右下角 `BackgroundActivity` 指示器**不参与**过渡：给 `.topbar` / `.bg-activity` 设 `view-transition-name: none` 等价处理（默认 root 快照含全屏，需把顶栏排除：`.topbar { view-transition-name: topbar; }` 并给其 old/new 设 `animation: none`），保证导航稳定（page-transitions · Staging：公共元素保持不动）。
- 阅读器进出：书架↔阅读器同样走 crossfade。**禁止**给封面做 shared-element 放大（与「克制」基调冲突，且 foliate/PDF 内核挂载耗时不可控，动画会等内核）。

**现有不一致动效处理**：`stage-card-in`（复习/摘录卡入场 240ms 右滑）、`ctas-rise`（空态装饰）是**视图内**动效，与页面切换不冲突，保留并归入 §1 token 体系；不新增第二套页面级过渡。**R2 例外：`stage-card-in` 在「页面进入后的首张卡」上抑制（§18.2 R2-A），避免与页面过渡叠双动效。**

### 5.1 方向性页面切换（R2 修订，2026-10-09，用户实测反馈新增交互）

**页序表**（顶栏视觉序，从左至右；[App.tsx:L511-L517](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/App.tsx#L511-L517) 现有 nav 数组即此序，不得另造）：

| 视图 | 页序 | 说明 |
|------|------|------|
| shelf（书架） | 0 | |
| queue / extractSession（摘录） | 1 | 两视图同席（nav match 现状即同钮高亮），互切 dir=0 |
| review（复习） | 2 | |
| next（推荐） | 3 | v48.81 / D125：仅在学习者模型开启时在场；关闭后其余五签页序不变 |
| browse（卡片） | 4 | |
| stats（数据） | 5 | v48.114 / D159：journal（日记，原 5）随功能暂时移除退出页序表（代码保留，重实装时回插）；stats 6→5 |
| reader（阅读器） | +∞（深度视图，不列席） | 进入 reader 恒为「前进」；离开 reader 恒为「返回」 |

**方向判定**（changeView 内计算，唯一判定点）：
- `dir = sign(idx(next) − idx(current))`；`dir=+1`＝目标在右＝**新页自右往左入**（起始 `translateX(+var(--shift-md))`→0）；`dir=−1`＝目标在左＝**新页自左往右入**（起始 `translateX(calc(-1 * var(--shift-md)))`→0）；`dir=0`（同席互切、reader↔reader 跳转）＝新页原位垫底不位移。
- reader 特则：`idx(reader)=+∞` ⇒ 任何视图→reader 为 fwd（深入，§3.4）；reader→任何视图强制 bwd（返回，§3.4），**不按数值比较**（否则 reader→stats 会被算成 fwd，语义错误）。
- 位移档：`--shift-md`(8px)。整页尺度下 `--shift-sm`(4px) 感知太弱、更大值违反「轻微」与瑞士克制；8px 是「可辨方向但不滑动」的实测下限档。
- 时长不变：新页位移 `--dur-view`(200ms) `--ease-enter`，旧页 `--dur-exit`(100ms) `--ease-exit` 纯淡出不位移（旧页若反向位移会与顶栏高亮即时切换叠成双重运动，Staging 原则：公共元素与离场元素保持安静）。瑞士硬规则「视图切换 ≤200ms」不破。
- **新页恒不透明（不淡入，R2 闪白修复）**：非对称淡入淡出的交叉期合成覆盖率实测最低 82.7%（透底＝闪白根因，取证见 §5）；揭幕式同步（新快照恒 opacity 1 垫底、旧快照置顶淡出）后覆盖率恒 ≡1。方向 keyframes 因此**只含 transform**；位移在揭幕前半程被旧页快照部分遮挡，读感为「轻微落位」而非明显滑动（与 §3.4 方向语义不冲突，`--shift-md` 档位不变）。

**实现规格**：
- `changeView` 内在调 `startViewTransition` **之前**同步写 `document.documentElement.dataset.vt = "1"` 与 `dataset.vtDir = "fwd" | "bwd"`（dir=0 时写空串或不写）；在 `transition.finished` 结算后（`.finally` 兜底，含跳过/失败路径）删除两属性。当前视图经 ref 或函数式读取获得（changeView 需拿到 current——允许给 useCallback 加 `view` 依赖或挂 viewRef，实施细节交执行层，验收看行为）。
- CSS（在既有 no-preference 块内，替换 §5 基础组的新页规则）：
  ```css
  :root[data-vt-dir="fwd"]::view-transition-new(root) { animation: view-in-fwd var(--dur-view) var(--ease-enter) both; }
  :root[data-vt-dir="bwd"]::view-transition-new(root) { animation: view-in-bwd var(--dur-view) var(--ease-enter) both; }
  @keyframes view-in-fwd { from { transform: translateX(var(--shift-md)); } to { transform: none; } }
  @keyframes view-in-bwd { from { transform: translateX(calc(-1 * var(--shift-md))); } to { transform: none; } }
  ```
  （**选择器纪律（R2 闪白修复同批纠正）**：过渡伪元素树的 originating element 就是 html——选择器必须**直挂**（伪元素紧贴 `:root[data-vt-dir=…]`，**不得带后代空格**）；带空格的后代形式永不命中，R2 初版即因此方向位移从未渲染（探针实证 animationName 恒 view-in、transform 恒 none）。dir 规则写**完整 animation 简写**：base 新页规则是 `animation: none`，无时长可继承。`view-in` 淡入 keyframes 退役。）
- 降级：无 `startViewTransition` ⇒ 不写 dataset、瞬时切换（现状），方向动效自然不在场。
- reduce：既有 reduce 块已把 root 对动画关净 ⇒ 方向位移同步不在场，不新增分支。
- 非顶栏路径全部自动获得方向：`openBook`（fwd）、`backToShelf`（bwd）、`handleJumpToDoc`（fwd）、阅读器「复习摘录/复习闪卡」（bwd）、卡片浏览器「开始复习」（按页序公式）。

### 5.2 入场闸门（R2 修订，2026-10-09：视图过渡期间 live DOM 不可见，挂载即播的入场会被吞）

**事实**：View Transition 期间（≈200ms，取新旧动画最长者）活文档不绘制，只绘制快照伪元素树；期间挂载元素上的 CSS 入场动画照常计时 ⇒ 揭幕时只剩尾段（§6.1-E1 的实证）。数据到达时机（本地 IPC ≈ 10-50ms）几乎必落在遮罩期内。

**机制（唯一闸门，全应用共用）**：`document.documentElement.dataset.vt="1"` 即「过渡遮罩在场」（与 §5.1 同生命周期）。一切「视图进入时播一次」的入场规则——图表 `.chart-enter` 系（§6.3）、书架 `.shelf-enter` 系（§10-R2）、摘录页 `.content-enter`（§18.2 R2-B）——选择器一律挂 `:root:not([data-vt])`：
- 过渡在场时：动画规则不挂 ⇒ 元素落终态，但被快照遮住，不可见（无闪穿——`backwards` 填充不生效的影响为零）。
- 过渡结束（删 `data-vt`）：规则挂上，动画**从头完整播放**（stagger delay 自此刻起算）。
- 非过渡路径（设置里加挂组件、Dashboard 页内改图型、页内换卡）：无 `data-vt` ⇒ 立即播，不添延迟。

**纪律**：新增任何「挂载即播」的视图级入场，必须先过闸门选择器；审查 grep：`@keyframes` 的入场类选择器在 theme.css 中必须能同时命中 `:not([data-vt])`。

### 5.3 首屏入场（R2 修订，2026-10-09：首屏挂载 ≠ 页面切换，分开定义）

**定义**：首屏入场＝应用启动后 `.app-shell` 首次挂载（`loaded` 翻真，[App.tsx:L359-L368](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/App.tsx#L359-L368) 的 `app-loading` 直换点）。它**不是** §5 的页面切换（不走 View Transitions、不参与页序表、不写 `data-vt`/`data-vt-dir`），独立规格如下：

- `.app-shell` 挂载入场（CSS 动画挂在 `.app-shell` 上，应用生命周期只挂载一次 ⇒ 天然只播一次，无需 JS 标记）：
  ```css
  @media (prefers-reduced-motion: no-preference) {
    .app-shell { animation: app-shell-in var(--dur-view) var(--ease-enter) both; }
    @keyframes app-shell-in { from { opacity: 0; transform: translateY(var(--shift-sm)); } to { opacity: 1; transform: none; } }
  }
  ```
  垂直微沉 4px＝中性「落位」，不带方向语义（首屏无「从哪来」的空间前提）。`app-loading` 直换保留（shell 入场即覆盖该跳变，不再给 loading 页加出场——它寿命不可控，动画等它是反模式）。
- 书架封面的到达入场走 §10-R2（数据异步，通常晚于 shell 入场；同帧到达时 stagger delay 天然错开，不叠双主角）。
- 顶栏随 `.app-shell` 一体入场（首屏无 Staging 问题——没有「上一屏」可对比）。

---

## 6. 图表样式与动效统一方案（data-visualization）【R2 全节重写，2026-10-09】

> **R2 修订（2026-10-09，用户实测反馈）**：旧裁决「样式已合规不重做，只补动效层」**作废**——用户实测「既没有看到动效，也没有看到图表样式的重新设计」。本节重写为视觉+动效 v2。旧句「Dashboard 显式 transition:none」整改已完成不回退；旧动效层（chart-bar/seg/line/dot class 体系）保留为 v2 的挂点基础并补全覆盖。

### 6.1 上轮动效不可感知的诊断（四条，证据行级）

- **E1 入场被视图过渡快照吞掉前段**：`chart-enter` 只在首挂载渲染输出（[swiss.tsx:L977-L979](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/components/charts/swiss.tsx#L977-L979)）；数据经 IPC 异步到达（[Dashboard.tsx:L44-L46](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/components/dashboard/Dashboard.tsx#L44-L46)），图表挂载几乎必落在 View Transition 遮罩期（≈300ms）内，而遮罩期活文档不绘制 ⇒ 400ms 入场只剩尾段。→ 解法：§5.2 入场闸门。
- **E2 挂点覆盖不全**：`barA(`/`segA(` 全文件仅 **15 处调用**（`grep -c "barA(\|segA(" swiss.tsx`＝15），对 25 个图型；折线仅有 `chart-line` 4 处；单位方块/树图/点行/账本/热格等**零挂点** ⇒ 多数图「本来就没有任何入场」。→ 解法：§6.4 逐图型挂点覆盖表。
- **E3 更新过渡在用户路径上从不触发**：几何 transition（300ms）只在「同挂载周期内数据变化」时播；Dashboard 打开即数据到齐，事件总线刷新发生在用户操作他页时 ⇒ 用户看不到。属正常——更新过渡服务「挂着页面时数据变了」，不背入场感知。不重设计，只保留。
- **E4 容器淡入与页面过渡叠合**：`.chart-enter.chart-svg` 的 200ms 容器淡入与页面 200ms 淡入同时发生 ⇒ 不可分辨，白白消耗同屏动效预算。→ v2 收窄其语义（§6.3：容器淡入只服务折线**更新**重绘，入场改由族动画承担）。

### 6.2 视觉基线 v2（所有图型共享；瑞士纪律内：直角、发丝线、mono 数字、明度阶梯）

渲染器内新增/调整的几何常量必须带注释「MOTION-DESIGN-SPEC §6.2」；颜色仍全部走 `palette()` 取 token（深浅自适应现状不动）。

| 项 | v2 规格 |
|----|---------|
| 基线/轴 | 主轴 1px `--border-strong`；网格线 ≤3 条（0/50/100% 三档），0.7px `--border-subtle`；**无左右框线、无箭头、轴不外延** |
| 刻度标签 | 11px `--fs-meta` `--grey-3` mono+tnum（[theme.css:L4943](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L4943) 既有规则保留）；轴题 12px/600 `--text-secondary` |
| 明度阶梯纪律 | 单图焦点 ≤1 处 `--accent`（hero＝最新/最大/当前序列）；序列色阶 INK→GREY2→GREY1；对照/历史序列统一 GREY2，禁止逐序列多彩 |
| 条形族几何 | band:gap＝2:1（条宽占槽位 2/3）；直角；>0 值最小可见高 2px；零值不画条、只留刻度位；横向条（区间浮条/账本）同比例转置 |
| 折线族几何 | hero 线 1.8px `--accent`；对照线 1px `--grey-2`；数据点＝6px **方块**（直角纪律，不用圆点），默认隐、hover 现；hero 末端点常显 8px＋直接标注数值（11px/700 accent） |
| 分段/占比条 | 条高 28px；段间 1px `--paper` 分隔缝；段内标签 ≥11px、反白/反黑按 `textOn()` 既有对比函数 |
| 单位方块族（方块垒/漏斗/树图/点簇/热格/密度带） | 方块间隙 1px；直角；明度阶梯同上行；hero 块 ≤1 处 `--accent`；点簇 6px 方点 |
| KPI 族 | 数值 40px/700 mono `--ink`；标签 12px `--grey-3`；辅注 11px `--grey-3`；数字变化瞬时换值（tnum 不跳位，现状保留） |
| 图例/注记 | **直接标注优先**（线末端、段内、柱顶）；仅当序列 >3 才用独立图例行（11px `--grey-3`，右上角，单行不折行） |
| 空态 | 居中 12px `--text-helper`＋一行引导文案（例：「完成第一天复习后这里有曲线」）；**不画假轴、假网格、假数据**；`empty()` 辅助函数签名不变、文案由各渲染器给 |
| 容器 | `.dash-widget` chrome（头/题/控件）不动，本期只重画图内 |

### 6.3 动效规格 v2（全部经 §5.2 闸门；no-preference 作用域；reduce 直接终态）

| 族 | 入场（数据首到） | 数据更新 | hover（`hover:hover` 内） |
|----|------------------|----------|---------------------------|
| 条形（`chart-bar`） | `scaleY(0→1)`，`transform-box:fill-box; origin:bottom`；stagger 30ms/根 ×≤8（`--i` clamp 既有）；密植图（>30 根，如日柱/密度带）按 8 档分组生长 | x/y/width/height CSS transition `--dur-chart`(300ms) `--ease-out-soft`（既有，保留） | 其余条 opacity→0.35，当前条不变（100ms；既有手法扩展到全族） |
| 分段（`chart-seg` 系） | `scaleX(0→1)`，origin 按 ltr/rtl/mid（既有三类保留）；stagger 40ms/段 ×≤8 | 同条形族 | 同条形族 dim |
| 折线（`chart-line`/`chart-dot`） | `stroke-dashoffset` 描线（`pathLength=1` 既有），`--dur-chart-in`(400ms) `--ease-enter`；多序列 stagger 60ms/条 ×≤4 | `d` 不插值：直接重绘＋容器 200ms 淡入（**仅此场景用 chart-fade-in**，E4 收窄） | 数据点 6px 方块 opacity 0→1（150ms；既有）；hero 末端点常显不参互 |
| 单位方块（`chart-unit`，**新增 class**） | `opacity 0→1 + translateY(var(--shift-xs))→0`；stagger 20ms/块 ×≤8（块数多，延迟取紧档）；树图/漏斗按阅读序（先大后小）编 `--i` | 几何 transition 300ms 同条形族 | 其余块 opacity→0.35，当前块不变 |
| KPI | 数字瞬时（现状）；卡片容器不单独入场（随 §5.2 后的页面揭示） | 瞬时换值 | — |

- 统一时长：入场 `--dur-chart-in`(400ms) 为族动画单项时长；含 stagger 总预算 ≤640ms（§3.6）。
- 首播一次性：`ChartSvg` 的 ref 已播标记保留（主题切换/数据刷新不重播）；`paletteTick` 重绘**颜色瞬时换**（不加 color transition——15 图同时染色闪烁比无色过渡更糟）。
- `.dash-widget` 容器不再有任何入场/过渡（E4：与页面过渡叠合无意义）。

### 6.4 逐图型挂点覆盖表（25 图型；归属以渲染器实际元素为准，实施时逐一核对并在代码注释登记族名）

| widget（id） | 图型（id） | 族 | 挂点动作 |
|---|---|---|---|
| review | columns 日柱 / strips 见 reading | 条形（密植） | 柱挂 `chart-bar`（既有则留） |
| review | weekday 星期剖面 | 条形或折线（按现状元素） | 对应族 class |
| review | cumulative 累计阶梯 | 折线 | `chart-line`（既有）＋末端点常显 |
| review | months 月面板 | 分段或单位方块（按现状元素） | 对应族 class |
| kpi | queuebar 队列构成 | 分段 | `chart-seg`（既有则留） |
| kpi | streak 连续里程碑 | KPI | 无入场（瞬时） |
| kpi | minutes 今日时长对照 | 条形（对照双条：今 INK / 均 GREY2） | `chart-bar` |
| heatmap | 热格 | 单位方块 | 格挂 `chart-unit` |
| today | units 方块垒 | 单位方块 | `chart-unit` |
| today | divergence 双向发散 | 分段（rtl 既有 `chart-seg-rev`） | 既有保留 |
| domains（×2 dataKey） | dots 点行对齐 | 单位方块 | `chart-unit` |
| domains（×2 dataKey） | treemap 矩形树图 | 单位方块 | `chart-unit` |
| ratings | ratingcol 百分比单柱 | 分段（mid/ltr 按现状） | 既有保留 |
| duration | ranges 区间浮条 | 条形（横向） | `chart-bar`（横向＝scaleX 入场，origin:left） |
| duration | freqpoly 频率多边形 | 折线 | `chart-line`＋`chart-dot`（既有） |
| funnel | unitfunnel 方块漏斗 | 单位方块 | `chart-unit` |
| sources | sourcetree 归属树 | 单位方块 | `chart-unit` |
| rhythm | curves 星期曲线谱 | 折线（多序列 ≤4 档 stagger） | `chart-line`（既有） |
| rhythm | clusters 时刻点簇 | 单位方块（点 6px） | `chart-unit` |
| domainrank | slope 斜率排名 | 折线 | `chart-line`＋`chart-dot`（既有） |
| queueflow | ledger 进出账本 | 条形（双向，进 INK / 出 GREY2） | `chart-bar` |
| reading | strips 周条密度带 | 单位方块（密植） | `chart-unit` |
| reading | rhist 字数分布 | 条形 | `chart-bar`（既有则留） |

**覆盖验收**：`grep -c 'className: "chart-' src/components/charts/swiss.tsx` ≥ 25（每图型 ≥1 处挂点；text 节点不算）。

---

## 7. 展开/折叠与就地状态切换（state-changes，已合并 accordions-dropdowns）

> 合并裁决与证据见 §13①。本节是唯一条目。

**唯一折叠模式（沿用 skill 的 grid 技法，本仓已有先例 [theme.css:L3638](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L3638)）**：

```css
.collapse-clip { display: grid; grid-template-rows: 0fr; transition: grid-template-rows var(--dur-panel) var(--ease-out-soft); }
.collapse-clip.is-open { grid-template-rows: 1fr; }
.collapse-inner { overflow: hidden; min-height: 0; }
```

| 场景 | 参数 | 附加 |
|------|------|------|
| 展开（enter 语义） | `--dur-panel`(240ms) `--ease-out-soft`；展开内容 opacity 延迟 50ms 淡入（Follow Through） | chevron/箭头 `rotate(180deg)`，240ms 同缓动，transform-origin 中心 |
| 折叠（exit 语义） | 200ms `--ease-out-soft`（略快于展开） | 内容 opacity 先走（不延迟），容器后收 |
| toggle / checkbox / radio / 段控滑块 | `--dur-hover`~200ms `--ease-out-soft`（沿用现状，如 occl-seg 指示条） | 可逆原则：A→B 与 B→A 必须互为镜像 |
| Tab 切换 | 指示条 200ms `--ease-out-soft`（沿用现状 `stage-pop-in` 族） | — |

**存量整改**：TagInput 的 `tag-panel-grow/shrink`（200ms/140ms 裸值 + ease-in-out 裸曲线）改为复用本节模式与 token（展开 240ms / 折叠 200ms `--ease-out-soft`），删两个 keyframes。

**边界（合并后的分工）**：
- 本节管：**就地、可逆、不占浮层**的展开/折叠与状态切换（折叠面板、TagInput 建议区、BackgroundActivity 展开区、toggle、Tab、段控）。
- §8.4 管：**浮层**菜单（`.dd-menu`、选区菜单、批注浮层）——它们不是折叠，是 popover 入场。

---

## 8. 模态 / 确认框 / 浮层菜单 / 弹出面板（modals-dialogs + ux-friction + saas-productivity）

### 8.1 模态入场/出场

现状：遮罩淡入 150ms，面板无动画、无出场。统一为：

```css
.modal-backdrop { animation: modal-in var(--dur-enter) var(--ease-enter); } /* 现状 150ms 保留，缓动换 --ease-enter */
.modal-panel { animation: panel-in var(--dur-enter) var(--ease-enter) both; }
@keyframes panel-in {
  from { opacity: 0; transform: translateY(var(--shift-sm)) scale(var(--scale-in)); }
  to   { opacity: 1; transform: none; }
}
/* 出场：通用 data-show="out" 模式（沿用 SettingsInfo 既有 data-show 先例） */
.modal-backdrop[data-show="out"] { animation: modal-out var(--dur-exit) var(--ease-exit) forwards; }
.modal-panel[data-show="out"] { animation: panel-out var(--dur-exit) var(--ease-exit) forwards; }
@keyframes panel-out { to { opacity: 0; transform: translateY(var(--shift-xs)) scale(var(--scale-in)); } }
```

- 面板入场**位移 ≤4px、缩放 ≥0.98**（elegance-sophistication：禁止 0.9 弹入）；modals-dialogs 的 overshoot/bounce 手法全部否决。
- 出场实现：各模态 `onClose` 改走「置 `data-show="out"` → 100ms 后卸载」两步。用一个共享 hook（建议 `src/lib/useDismiss.ts`：返回 `show` 状态与 `requestClose()`，内部 setTimeout 100ms 后调真 onClose）避免逐模态手写。**Esc 与遮罩点击都走同一 requestClose**。**实施修订（第 2 轮复审采纳）**：`prefers-reduced-motion: reduce` 命中时该延迟短路为 0ms（reduce 下出场瞬时，等价 JS 侧 no-op）；另模态自身数据流完成的成功关闭（如 AddBookModal 保存成功）也必须走 requestClose，禁止父级直卸载绕过出场。
- 全部包在 no-preference 作用域；reduce 时瞬时。

### 8.2 破坏性操作：反馈与退路（ux-friction）

沿用并推广书架 confirmBox 既有模式（[Bookshelf.tsx:L546-L559](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/components/Bookshelf.tsx#L546-L559)）：

1. **首选就地两步确认**（行内/卡内 confirmBox），不用模态——模态只用于「后果需要阅读一段文字才能理解」的破坏（如清空全部数据）。
2. 确认态默认焦点永远在**取消**上（D50 既有纪律）。
3. 破坏性按钮：error 填充（瑞士风既有），点击后有**完成反馈**——条目移除走 §10 列表退场，随后 `notice-bar`（既有）报告结果；失败时 notice-bar 保持错误文案且条目**复位**（退路）。
4. 任何破坏操作的动效不得延缓「可撤销/可取消」的可达性：确认框出现 ≤150ms，Esc 立即可关。

### 8.3 摘录审查视图等「审查类」模态

`RegenCardsModal` / `AnswerJudgeModal` / `ContrastCardModal` / 卡片详情 / 摘录详情 / `ImageLightbox`：全部走 §8.1 同一 panel-in/out。`ImageLightbox` 的 `image-focus-fade`(160ms) 保留、token 化为 `--dur-enter`（160→150ms 的差值无感知，统一优先）。

### 8.4 浮层菜单（popover 族）

`.dd-menu`（Dropdown、书架 CardMenu、阅读器工具菜单）现状瞬时。统一挂既有 `pop-in`（220ms `--spring` 是**存量豁免**，不再改它；见 §0）——但 transform-origin 须随翻边：`dd-menu-up` → `50% 100%`，`dd-menu-down` → `50% 0%`（Bookshelf CardMenu 已有 `down` 判定，Dropdown 有 `align`，各补一个 origin 规则即可，零 JS 改动）。选区菜单/批注浮层的 pop-in 维持现状。

### 8.5 弹出面板（saas-productivity：快捷日记 / 未来制卡面板）

saas-productivity 核心原则 = **高效、专业、不挡路**：动效 150-300ms、无弹性、服务于「我知道它从哪来、到哪去」。

- **快捷日记（capture 窗口，`src/capture.tsx`）**：面板内容入场 = `opacity 0→1 + translateY(calc(-1 * var(--shift-sm)))→0`，`--dur-enter` `--ease-enter`；关闭 = 100ms `--ease-exit` 反向。不弹、不滑远距。窗口本身（BrowserWindow 显隐）由主进程瞬时控制，动效只做在窗口内容根节点上。**实施修订（第 3 轮审查登记）**：capture 的 webContents 常驻（hide→show 不重挂载），故入场动画由 `CaptureEditor` 既有 `onShown` 回调重触发（restartEnter：内联 animation none→强制 reflow→清空），保证**每次呼出都重播入场**；出场反向动效需主进程 before-hide 时机，本期不做（窗口级 hide 瞬时，感知可接受）。
- **未来全局快捷键制卡面板（仅预留规范，不设计功能）**：届时面板 = 与快捷日记**同一组件族**：居中偏上浮层、`modal-backdrop` 遮罩（40% overlay-ink，现状 token）、入场/出场参数与 §8.5 上条逐字相同、Esc 关闭、打开期间 `commandRegistry.pushSuppress`（沿用 settings-modal 先例）。**禁止**做成右侧 dock（CardDock 已被阅读器内制卡占用，全局唤出面板若也走 dock 会与其语义打架）。
- AI 面板 / CardDock 等**侧滑 dock** 不属于弹出面板族，沿用 `side-dock-in`（translateX 100%→0，`--dur-panel` `--ease`）现状——已是正确手法。

---

## 9. 注意力引导（attention-direction）——原则层落地

结论：**有应用场景**（裁决证据 §13②）。本软件不把它做成「新组件」，而是作为三条强制原则 + 四处既有实例的规范化：

1. **同屏同一时刻只有一个动效主角**：新入场元素播放期间，禁止同屏另一处非响应式动效并发（stagger 序列算一个主角）。违规实例预防：书架 `is-fresh` 高亮播放时不播列表 stagger。**R2 应用：书架入场（§10-R2）与 `is-fresh` 同帧时，`is-fresh` 延迟到入场序列结束后起播；页面过渡与视图内入场的先后关系由 §5.2 闸门天然保证。**
2. **视线落点 = 用户上一动作的因果点**：新内容出现在触发它的位置附近，并给 1 次性强调；不在 peripheral 区域动（ux-friction 同旨）。
3. **强调只用「既有视觉资产 + 一次性动效」**，不新增颜色/徽标：可复用的强调手法白名单 = `is-fresh` 高亮框（书架新入库，1.2s）、`mark-sweep`（阅读器标记揭示，640ms）、`notice-bar`（错误/结果条）、Backdrop 遮罩（模态聚焦）。新增强调手法必须先扩充本白名单。

未来若引入教学/引导/选择题类功能，本层扩展为「序列引导」（单步高亮 + 其余 dim），届时另立方案。

---

## 10. 列表 / 网格（lists-grids）

| 场景 | 规则 | 参数 |
|------|------|------|
| ~~书架/卡片浏览器/日记**首屏**不播入场~~ | **R2 修订（2026-10-09，用户实测反馈撤销该裁决）**：书架入场见下方「§10-R2」；卡片浏览器/日记维持不播（用户未反馈，克制优先） | — |
| 列表**增删** | 新增项：fade + `translateY(var(--shift-sm))→0`，`--dur-enter` `--ease-enter`；删除项：opacity→0 100ms 后 `grid-template-rows` 收高 150ms（exit-animations 折叠模式的 token 化版本），动画完再从 DOM 移除 | 见左 |
| 重排（拖拽/Alt+方向键） | 其余条目让位过渡 200ms `--ease-out-soft`（FLIP 由执行层按需，非本期强制）；被拖项 `is-dragging` 现状保留 | — |
| 书架 `is-fresh` | 现状 1.2s 高亮保留，作为 §9 白名单手法；**R2：与入场同帧时延迟到入场序列结束后起播**（§9-1） | 现状 |

**明确不做**：网格 filter/sort 的 shuffle 动画（lists-grids 的戏剧化手法与克制基调冲突；排序切换瞬时即可，内容与位置关系已由工具条状态表达）。

### §10-R2 书架入场规格（2026-10-09 新增）

**触发（两种路径同一机制）**：Bookshelf 挂载后 `items` 由空→非空的**首个渲染周期**——覆盖「首屏数据到达」与「他页切回书架」两种用户路径（两者都是新挂载周期）。**不触发**：文件夹进出、排序/密度/视图切换、运行中 `refresh` 回灌（容器无 `shelf-enter`，新元素自然无动画规则）。

**形态**：
- 封面墙卡片与目录表行：`opacity 0→1 + translateY(var(--shift-sm))→0`，`--dur-view`(200ms) `--ease-enter`；stagger 30ms/张 ×≤8（`--i` clamp 到第 8 档，§3.6 预算），按视觉阅读序（先行后列）编 `--i`。
- 挂点：网格/表容器在首个非空渲染周期带 `shelf-enter` class（实现建议：`enterArmed` ref＋首个非空渲染置 `shelfEnter` state，`setTimeout(700ms)` 后清除——700＝200＋8×30＋余量，防无关重渲染里新建节点误播）；每张卡/行 `style={{ "--i": String(Math.min(i, 7)) }}`。
- CSS 选择器挂 `:root:not([data-vt])`（§5.2 闸门）——往返路径上入场不被快照吞前段。
- 封面图解码：`<img>` 解码完成是第二波「硬显」来源。`CoverImg` 的 `onLoad` 置 `is-loaded` class：
  ```css
  @media (prefers-reduced-motion: no-preference) {
    .cover-img { opacity: 0; transition: opacity var(--dur-enter) var(--ease-enter); }
    .cover-img.is-loaded { opacity: 1; }
  }
  ```
  （no-preference 外无 `opacity:0`——reduce/无动画环境图片直接显。重试链 `?r=N` 现状不动，每次重试新 img 节点重新走同一规则。）
- `is-fresh` 并发纪律：同帧命中时其 keyframes 加 `animation-delay: 440ms`（入场预算 200＋8×30，token 化写法 `calc(var(--dur-view) + 8 * 30ms)` 并在注释登记依据），仅当同容器带 `shelf-enter` 时该延迟在场。

---

## 11. 加载指示（loaders-spinners，按需使用）

三档分工（**不新增第四形态**，不强行全量铺开）：

| 档 | 用于 | 形态 | 现状/动作 |
|----|------|------|-----------|
| 骨架屏（首选） | 内容区加载（Dashboard、导图、设置页分区、复习页首载） | `.skeleton` + `skeleton-pulse` 1.2s（现状） | 保留；pulse 的 `var(--ease)` 改 `--ease-out-soft`（呼吸感），时长不变 |
| 按钮内 spinner | 按钮触发的短等待（AI 生成、遮挡确认等） | 既有 `occl-rotate`（360° 旋转） | 保留；**禁止**扩散到全屏 |
| 进度条 | 可定量任务（下载/索引/导图生成） | `bg-activity-bar` width 过渡（现状） | 保留 |
| 文案态 | 日记「正在读取…」等单句等待 | 纯文案（现状） | 保留，**不补 spinner**（文案已够，补了是装饰冲动） |

- spinner 旋转：`linear infinite`，周期 800-1200ms（skill 档），reduce 时停转、保留静态圆环。
- `dock-breathe`（1.6s 呼吸点）保留——它是「进行中有后台活动」的状态指示，归本族。

---

## 12. 现有代码不一致动效盘点清单（文件级，勘察实测）

| # | 位置 | 现状 | 问题 | 处理 |
|---|------|------|------|------|
| 1 | [App.tsx:L354-L472](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/App.tsx#L354-L472) | 视图条件直换 | 无页面过渡 | §5 接入 View Transitions（已完成，R2 起叠加 §5.1 方向位移） |
| 2 | [theme.css:L729-L738](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L729-L738) | hover `translateY(-2px/-1px)` + `--shadow-hover` | 违反「禁抬升」 | §4 删除位移/阴影，保留底色 hover 与 :active |
| 3 | [theme.css:L1502-L1507](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L1502-L1507) | 仅遮罩 150ms 淡入；面板无入场；全部模态无出场 | 闪现/瞬灭 | §8.1 panel-in/out + useDismiss |
| 4 | [theme.css:L2550-L2553](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L2550-L2553) | `ai-panel-in` 动画 `width: 0→400px` | 动画布局属性 | 改 `translateX(100%)→0`（与 side-dock-in 同手法；嵌入 dock 时本已禁用） |
| 5 | [theme.css:L3638-L3658](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L3638-L3658) | tag-panel-grow/shrink 裸 200ms/140ms + ease-in-out | 裸值、与 §7 模式重复 | 并入 §7 统一折叠模式，删 keyframes |
| 6 | [theme.css:L3794](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L3794) / [L3824](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L3824) / [L3441](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L3441) | 裸 `200ms cubic-bezier(0.4,0,0.2,1)` / `240ms` | 裸值 | token 化（`--dur-hover/--dur-panel` + `--ease-out-soft`） |
| 7 | [theme.css:L3028](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L3028) / [L3038](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L3038) | qi-num 200ms spring / review-progress 500ms 裸值 | 裸值 | qi-num 保留（spring 存量豁免）但注释登记；进度条 token 化 |
| 8 | [theme.css:L4273](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L4273) `.dd-menu` 族 | 菜单瞬时弹出 | 无入场 | §8.4 挂 pop-in + 翻边 origin |
| 9 | [charts/swiss.tsx](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/components/charts/swiss.tsx) 全部渲染器 + [theme.css:L4886](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L4886) `dash-widget{transition:none}` | 图表零动效 | 用户不满意点 | §6 图表动效层（**R2：§6 全节重写为 v2**） |
| 10 | [src/capture.tsx](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/capture.tsx) | 快捷日记窗口内容无入场 | 弹出面板族缺规范 | §8.5 |
| 11 | theme.css 各处 reduce/no-preference 块 | 大体健全，但 `pop-in`（L784）、`mark-sweep`（L2044）等依赖逐块手写 | 无统一审计口径 | §3.2 写为可 grep 纪律，附录 A 验收命令 |
| 12 | `stage-card-in`（240ms translateX 24px）、`review-flip`（500ms 3D）、`ctas-rise`（400ms）、`occl-pop`/`occl-badge-pop`（spring）、`pop-in`（spring 220ms）、`side-dock-in`、`mark-sweep`（640ms clip-path）、`dock-breathe`、`skeleton-pulse` | 存量合理动效 | 与新规不冲突 | **保留**，归入 token 体系注释登记；spring 三处（pop-in/occl-pop/qi-num）为冻结豁免。**R2 附注：`stage-card-in` 在页面进入后的首张卡上抑制（§18.2 R2-A），换卡路径不变。** |
| 13 | **R2 新增**：[theme.css:L6503](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L6503) `.extract-main > .extract-face { margin: var(--sp-4) 0 }` | 特异性覆盖清零 `margin-inline:auto`，卡面靠左 | 用户实测 bug（§0-R2-3） | §18.3：改 `margin: var(--sp-4) auto` |
| 14 | **R2 新增**：[App.tsx:L359-L368](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/App.tsx#L359-L368) `app-loading` 直换 `app-shell`；[Bookshelf.tsx:L108/L157-L181](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/components/Bookshelf.tsx#L108) 数据异步回填 | 首屏无入场；封面瞬时涌入 | 用户实测「生硬」 | §5.3 首屏入场＋§10-R2 书架入场 |

---

## 13. 三项裁决（总控要求的决策点）

### ① accordions-dropdowns vs state-changes —— 结论：**合并为单一条目（§7），但把「dropdown 浮层菜单」划出归 §8.4**

逐条比对证据：

| 维度 | state-changes | accordions-dropdowns | 是否实质差异 |
|------|---------------|----------------------|--------------|
| 折叠技法 | `grid-template-rows 0fr↔1fr`（Accordion Pattern 段） | 同一技法（CSS Implementation 段逐字相同） | 无差异 |
| 时长 | Accordion 250ms ease-in-out | 展开 250-350ms / 内容淡入 150-200ms / stagger 30-50ms | 只是粒度更细，无冲突 |
| 缓动 | `cubic-bezier(0.4,0,0.2,1)`（双向） | 展开 ease-out / 折叠 ease-in（不对称） | **唯一实质差异**，且 accordion 版更优（开合语义不同） |
| 核心规则 | 「可逆：A→B 是 B→A 的镜像」 | chevron 旋转 + Follow Through | 互补不冲突 |
| 场景覆盖面 | toggle/checkbox/radio/tab/accordion 全部就地变换 | 仅展开/折叠 | 包含关系 |

合并方式：规范落点为 §7 一节，技法、可逆原则取 state-changes，开合缓动语义差异（进 ease 族/出略快）取 accordions-dropdowns 并与本仓既有 `--ease-out-soft` 双向曲线对齐（本仓既有 tag-panel、BackgroundActivity 均用双向同曲线，且 `--ease-out-soft` 本身偏 out，实测差异无感知）。「dropdown」一词在两个 skill 里有歧义：accordions-dropdowns 的 dropdown 实为「展开内容区」；本仓的 `.dd-menu` 是**浮层菜单**（不占文档流、有遮罩语义、有翻边定位），其动效本质是 popover 入场（pop-in），不是高度展开——故归 §8.4。证据：[theme.css:L4273](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L4273) `.dd-menu` 是 `position:absolute` 浮层；[Bookshelf.tsx:L53-L88](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/components/Bookshelf.tsx#L53-L88) CardMenu 有翻边测量——浮层语义确凿。

### ② attention-direction —— 结论：**有真实应用场景，按原则层落地（§9），不做组件**

证据（既有界面已在做注意力引导，只是没有统一口径）：
1. 书架新入库条目 `is-fresh` 1.2s 高亮（[Bookshelf.tsx:L154-L167](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/components/Bookshelf.tsx#L154-L167)）——典型「导入完找不到」的注意力引导。
2. 阅读器标记揭示 `mark-sweep`（[theme.css:L2044-L2045](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L2044-L2045)）——引导视线到批注位置。
3. `notice-bar` 错误条（书架删除失败等）——错误聚焦。
4. 模态 backdrop 遮罩——Staging（焦点隔离）。
5. 复习页单卡舞台（一屏一卡 + stage-card-in）——本身就是注意力设计。

§9 将其固化为三原则 + 强调手法白名单。未来若加新手引导/教学功能，可扩展为序列引导。

### ③ frontend-developer —— 结论：**作为附录 B「开发约定」引用，不进入视觉规范正文**

理由：该 skill 内容是实现纪律（pose-to-pose、batch、prefers-reduced-motion、DevTools profiling），与本规范 §3/附录 A 重叠度约 70%，且无视觉裁决。放正文会与 §1 token 表争「规范」地位；放附录 B 作为执行层自检清单引用。

---

## 14. 入场/退场动画库（entrance-animations / exit-animations）——本期 standby

用户拍板：本期只安装备用、不实施。规范层面的吸收已经完成：两个 skill 的时长/缓动/手法已全部映射进 §1 token（`--dur-enter/--dur-exit/--ease-enter/--ease-exit/--shift-sm/--scale-in`）与 §5/§8/§10 的具体方案。将来任何「元素出现/消失」需求（如 toast、新功能面板）直接引用 token 与既有 keyframes 模式（panel-in/out、pop-in、view-in/out）即可，不需要回头重读 skill。

---

## 15. 与现有组件的复用关系汇总

| 新需求 | 复用（禁止新造） |
|--------|------------------|
| 模态出场 | SettingsInfo 的 `data-show="in/out"` 模式 → 抽象为 `src/lib/useDismiss.ts` |
| 浮层菜单入场 | 既有 `pop-in` keyframes + `.dd-menu-up/down` 类补 origin |
| 折叠 | 既有 tag-panel 的 grid 技法 → 泛化为 `.collapse-clip` |
| 列表删项 | exit 折叠模式（§10 参数版） |
| 页面切换 | 原生 View Transitions API，零依赖（R2：§5.1 方向位移、§5.2 闸门均在此之上） |
| 图表动效 | `swiss.tsx` `El.attrs` 挂 class + `--i`，纯 CSS 驱动（R2：补全 25 图型挂点，§6.4） |
| 破坏性确认 | 书架 confirmBox 模式 |
| 按压反馈 | D88 `:active` 族（含 settle/ripple 白名单，不动） |
| **R2 方向切换** | 既有 `view-in` 基底＋`--shift-md` token，不新增时长/缓动档 |
| **R2 书架入场** | 与图表同一套 stagger/`--i`/闸门机制（§5.2），封面淡入复用 `--dur-enter` |
| **R2 摘录页就绪 fade** | 复用 `chart-fade-in` keyframes（改通用名 `fade-in` 或直接引用，实施时统一命名并注释） |

**建议插入点**（供总控在契约变更流程中处理，本方案不改这两个文件正文）：
- `docs/swiss-international-style.md` 「### 动效」节末尾加一行：`> 软件实现的完整动效规范（token、页面切换、图表、模态、列表）见 docs/design/MOTION-DESIGN-SPEC.md（D120）。`（已完成登记，v48.76）
- `AI_DEVELOPMENT_GUIDE.md` §5 动效相关小节加同指向引用一行。
- **R2 待总控确认**：GUIDE §8.1 决策日志为 D120 追加 R2 修订记录（含版本号 bump）——本轮推翻了 §6「样式不重做」与 §10「书架首屏不播」两条旧裁决、新增方向性切换交互，属契约级变更登记范畴；本文正文不改 GUIDE。

---

## 16. 可机械检查的验收标准清单（总控核对用）

1. `grep -n "translateY(-" src/theme.css` 在 hover 规则上下文（L720-L751 原 D88 块）命中为 0。
2. `grep -nE "(transition|animation):[^;]*[0-9]+ms" src/theme.css` 命中的裸 ms 值 ≤ §12 表第 7/12 行登记的存量豁免数（其余全部 token 化）。
3. `grep -c "prefers-reduced-motion" src/theme.css` ≥ 现状值，且新增每个 `@keyframes`（view-in/view-out/panel-in/panel-out）均有对应 media 处理。
4. `grep -n "startViewTransition" src/App.tsx` ≥ 1，且全部 `setView` 页面切换经统一包装函数。
5. `grep -n "view-transition-name" src/theme.css` 命中 `.topbar` 与 `.bg-activity` 排除规则。
6. `grep -rn "data-show" src/components/AddBookModal.tsx src/components/SettingsPanel.tsx` ≥ 各 1（出场两步走）；`grep -n "useDismiss" src/lib/` 命中共享 hook。
7. `grep -n "pop-in" src/theme.css` 的引用选择器清单包含 `.dd-menu`；`grep -n "transform-origin" src/theme.css` 命中 `dd-menu-up/down` 两条。
8. `grep -n "grid-template-rows" src/theme.css` 存在 `.collapse-clip` 通用规则，且 `tag-panel-grow/tag-panel-shrink` keyframes 已删除。
9. `grep -n "chart-bar\|chart-line\|chart-seg" src/components/charts/swiss.tsx` ≥ 1（渲染器挂动画 class）；`grep -n "transition: none" src/theme.css` 中 `.dash-widget` 一条已移除或收窄注释说明。
10. `grep -n "width: 0" src/theme.css` 在 `ai-panel-in` keyframes 中命中为 0（改 transform）。
11. `npm run build` 通过；`npm run lint`（若配置）无新增错误；GUI 冒烟：六视图往返切换、开/关 AddBookModal、书架删除确认、Dashboard 首载，无肉眼可见闪烁/跳变。
12. 零新增依赖：`git diff package.json` 为空。

**R2 追加验收项（2026-10-09）**：

- R2-1. 方向切换：`grep -n "view-in-fwd\|view-in-bwd" src/theme.css` 各 ≥1；`grep -n "vtDir\|data-vt-dir" src/App.tsx src/theme.css` 各 ≥1；GUI：摘录(1)→复习(2) 新页自右入微移淡入，复习(2)→书架(0) 自左入，queue↔extractSession 同席无位移；reader 进出＝自右入/自左入。
- R2-2. 入场闸门：`grep -n ':root:not(\[data-vt\])' src/theme.css` ≥ 3（图表系/书架系/摘录就绪系）；`grep -n "dataset.vt" src/App.tsx` ≥ 1 且清除在 `finished` 结算路径上。
- R2-3. 首屏入场：`grep -n "app-shell-in" src/theme.css` ≥ 1（no-preference 内）；GUI：冷启动 shell 淡入微沉可见且不拖过 200ms。
- R2-4. 书架入场：`grep -n "shelf-enter" src/components/Bookshelf.tsx src/theme.css` 各 ≥1；`grep -n "is-loaded" src/components/Bookshelf.tsx src/theme.css` 各 ≥1；GUI：首屏与他页切回书架，封面/行按 stagger 入场、封面图解码淡入；排序/文件夹进出/refresh 不播。
- R2-5. 摘录对齐：`grep -n "margin: var(--sp-4) auto" src/theme.css` = 1（原 `margin: var(--sp-4) 0` 命中 0）；GUI：收起批注轨时卡面左缘＝头带内列左缘＝底栏内容列左缘，展开态同。
- R2-6. 摘录两态统一：`grep -n "content-enter\|data-first-card" src/components/ExtractReviewView.tsx` ≥ 各 1；GUI：批注轨开/收两态下从顶栏进入摘录页，感知＝同一页面方向过渡＋同一就绪 fade，无结构硬切、首卡无 stage-card-in 右滑；页内换卡 stage-card-in 照常。
- R2-7. 图表挂点覆盖：`grep -c 'className: "chart-' src/components/charts/swiss.tsx` ≥ 25。
- R2-8. 图表样式 v2：swiss.tsx 渲染器内新增几何常量注释含 `§6.2`；GUI：数据页首载可见 stagger 入场完整播放（不被过渡吞）、网格线 ≤3 条、单图焦点色 ≤1 处。
- R2-9. 全部 R2 新增 keyframes（view-in-fwd/bwd、app-shell-in、shelf-enter 系、chart-unit 系）落在 no-preference 作用域；`npm run build` 通过。
- R2-10. `git diff package.json` 为空（零新依赖）。

---

## 17. 任务拆解表（供总控逐项派发）

> D120 首轮 11 项已全部实施并过审（2026-10-08 前），保留存档；本轮派发用 **§17-R2**。

| # | 任务 | 建议执行者 | 涉及文件 | 可机械检查的验收标准 | 依赖 |
|---|------|-----------|----------|----------------------|------|
| 1 | 新增 motion token（§1 整块）写入 :root，零视觉变化 | frontend-builder | src/theme.css | `grep -c -- "--dur-exit\|--dur-enter\|--dur-view\|--dur-chart\|--ease-enter\|--ease-exit\|--shift-sm\|--scale-in" src/theme.css` ≥ 8；build 通过 | 无 |
| 2 | 移除 hover 抬升：删 D88 块 hover 的 translateY 与 --shadow-hover（保留 :active 与图标滞后）；hover 规则补 `@media (hover:hover)` 包裹 | frontend-builder | src/theme.css（L720-L751 区） | 验收清单 #1 通过；`:active` 的 scale 规则仍在；build 通过 | 1 |
| 3 | 页面切换：App.tsx 加 setView 包装（startViewTransition + 降级）；theme.css 加 view-in/out 与顶栏/活动指示器排除 | frontend-builder | src/App.tsx、src/theme.css | 验收清单 #4、#5 通过；六视图往返无顶栏闪烁 | 1 |
| 4 | 模态统一：新增 useDismiss hook；AddBookModal/SettingsPanel 接入 data-show 出场；theme.css 加 panel-in/out | frontend-builder | src/lib/useDismiss.ts（新建）、AddBookModal.tsx、SettingsPanel.tsx、src/theme.css | 验收清单 #6 通过；开关模态无瞬灭；Esc/遮罩点击同路径 | 1 |
| 5 | 浮层菜单：.dd-menu 挂 pop-in + up/down transform-origin | frontend-builder | src/theme.css | 验收清单 #7 通过 | 1 |
| 6 | 折叠统一：.collapse-clip 通用规则落地；TagInput 迁移并删 tag-panel-grow/shrink | frontend-builder | src/theme.css、src/components/TagInput.tsx | 验收清单 #8 通过；标签建议区开合观感不退化 | 1 |
| 7 | 裸值 token 化批次：§12 表 #6/#7 各行（occl 段控 200ms、image-focus 240ms、qi-num 注释登记、review-progress 500ms→token） | frontend-builder | src/theme.css | 验收清单 #2 通过 | 1 |
| 8 | ai-panel 入场改 transform（translateX），与 side-dock-in 同手法 | frontend-builder | src/theme.css（L2550-L2553） | 验收清单 #10 通过；阅读器内开 AI 面板无布局抖动 | 1 |
| 9 | 图表动效层：swiss.tsx 渲染器挂 class/--i；theme.css 加 chart 入场/更新/hover-dim 规则；dash-widget 移除 transition:none | frontend-builder | src/components/charts/swiss.tsx、src/components/dashboard/Dashboard.tsx、src/theme.css | 验收清单 #9 通过；主题切换重绘不播入场（组件内 ref 标记） | 1 |
| 10 | 快捷日记面板动效：capture 窗口内容根节点入场/出场（§8.5 参数） | frontend-builder | src/capture.tsx、其样式落点（theme.css 或 capture 样式） | 窗口打开有 150ms 落位感；reduce 时瞬时；build 通过 | 1 |
| 11 | reduced-motion 总审计：新增 keyframes 全部进 no-preference/reduce 双轨；附录 A grep 口径跑通 | frontend-builder | src/theme.css | 验收清单 #3 通过 | 3、4、5、9、10 |

**派发顺序建议**：1 → 2 →（3、4、5、6、7、8 可按序逐项）→ 9 → 10 → 11 收尾审计。每项一轮 code-reviewer。

### §17-R2 任务拆解表（2026-10-09 本轮派发；一项一个最小单元）

| # | 任务 | 建议执行者 | 涉及文件 | 可机械检查的验收标准 | 依赖 |
|---|------|-----------|----------|----------------------|------|
| R2-1 | 摘录文本框对齐修复：[theme.css:L6503](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L6503) `margin: var(--sp-4) 0` → `margin: var(--sp-4) auto`（上下间距意图保留，水平居中恢复） | bug-fixer | src/theme.css（单行） | 验收 R2-5；build 通过 | 无（可最先派） |
| R2-2 | 方向性切换＋入场闸门：App.tsx changeView 加页序表/dir 计算/`data-vt`/`data-vt-dir` 生命周期（`finished` 结算清除，finally 兜底）；theme.css 加 view-in-fwd/bwd 与方向选择器（§5.1 代码块） | frontend-builder | src/App.tsx、src/theme.css | 验收 R2-1、R2-2（grep 部分）；六页签往返方向正确、同席无位移、reader 进出方向正确 | 无 |
| R2-3 | 首屏入场：theme.css 加 `.app-shell` 的 `app-shell-in`（§5.3 代码块，no-preference 内） | frontend-builder | src/theme.css | 验收 R2-3 | 无 |
| R2-4 | 书架入场：Bookshelf 首个非空渲染周期挂 `shelf-enter`＋每卡 `--i`（700ms 后清除）；CoverImg `onLoad` 置 `is-loaded`；theme.css 加两组规则（§10-R2 代码块，挂 `:root:not([data-vt])`）；`is-fresh` 同帧延迟条款落地 | frontend-builder | src/components/Bookshelf.tsx、src/theme.css | 验收 R2-4；文件夹进出/排序/refresh 不播 | R2-2（闸门选择器依赖 data-vt） |
| R2-5 | 摘录页两态统一：ExtractReviewView 首个非空卡渲染挂首卡抑制标记＋`.extract-page-cols`/`.stage-bar` 挂 `content-enter`（loaded 首转真一个周期）；theme.css 加 `.content-enter` 就绪 fade（复用 fade-in keyframes，挂闸门）与首卡抑制规则（§18.2） | frontend-builder | src/components/ExtractReviewView.tsx、src/theme.css | 验收 R2-6；页内换卡 stage-card-in 照常、页内开合轨动效不退化 | R2-2 |
| R2-6 | 图表视觉重设计：按 §6.2 基线逐渲染器调几何/轴/标签/图例/空态（25 图型，常量注释 `§6.2`；颜色仍走 palette() token） | frontend-builder | src/components/charts/swiss.tsx | 验收 R2-8（GUI 部分）；build 通过 | 无（与 R2-7 同文件，串行派） |
| R2-7 | 图表动效 v2：补全 25 图型挂点（含新增 `chart-unit` 族）＋theme.css 图表动效层挂 `:root:not([data-vt])`＋chart-fade-in 语义收窄为折线更新专用＋hover-dim 扩展到全族 | frontend-builder | src/components/charts/swiss.tsx、src/theme.css | 验收 R2-2（grep）、R2-7；主题切换/数据刷新不重播入场 | R2-2、R2-6 |
| R2-8 | R2 收尾审计：R2-9/R2-10 全项；GUI 冒烟六场景（冷启动首屏、六页签往返方向、书架往返 stagger、摘录两态入场一致＋对齐、数据页首载入场完整、reduce 全瞬时） | frontend-builder | 全部 R2 涉及文件 | 验收 R2-9、R2-10；六场景肉眼无闪烁/跳变/双动效 | R2-1～R2-7 |

**派发顺序建议**：R2-1（独立小修）与 R2-2（机制底座）先行 → R2-3 可并行 → R2-4、R2-5（依赖闸门）→ R2-6 → R2-7 → R2-8 收尾。每项一轮 code-reviewer。

---

## 18. 摘录页专项（R2 新增，2026-10-09：两态统一入场 + 文本框对齐）

### 18.1 诊断（证据行级）

- **E1 两波硬切**：`!loaded` 早退壳＝裸 `.extract-page`（无 `data-annot-open`、无 cols/轨/底栏，[ExtractReviewView.tsx:L731-L737](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/components/ExtractReviewView.tsx#L731-L737)）；数据到达后同一页根下整副布局一次性插入——轨宽 280、主列 `padding-left`、底栏 `margin-left` 全部**首帧即终态**（transition 不对初始样式触发，[theme.css:L6397-L6404](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L6397-L6404)）。
- **E2 两态感知差的来源是布局差不是动效差**：展开态硬切空间差＝280px 轨＋版心右移 140px ⇒「大幅度从左往右展开出现」；收起态只差卡面 ⇒「小幅度」。唯一真实动效 `stage-card-in`（24px 从右往左，[theme.css:L3027-L3033](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L3027-L3033)）两态同参数——与用户「收起时小幅度从右往左」的描述逐字吻合。
- **E3 双动效**：页面 crossfade 与首卡 stage-card-in 叠加（违 §9 单主角）。
- **E4 对齐 bug**：见 §0-R2-3（[theme.css:L6503](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L6503) 覆盖链）。

### 18.2 两态统一入场规格

- **R2-A 首卡抑制**：页面进入（顶栏/阅读器入口）后的**首张卡**不播 `stage-card-in`——入场完全由 §5.1 方向性页面过渡承担。实现钩子：ExtractReviewView 记挂载 ref，首个非空卡渲染给卡面挂 `data-first-card="1"`（换卡 key 变化后不再带）；CSS：`.extract-page .extract-face[data-first-card] { animation: none; }`（写在 stage-card-in 规则之后或提高特异性）。同视图内换卡（推进/撤销/查看）`stage-card-in` 照常。
- **R2-B 内容就绪 fade**：加载壳→正式布局的结构波软化为一次性整体淡入——`loaded` 首转真后的首个渲染周期，`.extract-page-cols` 与 `.stage-bar` 挂 `content-enter` class：`animation: fade-in var(--dur-view) var(--ease-enter)`（复用/改名自 `chart-fade-in`，keyframes 仅 opacity；**两态同一份规则**——这是「两态统一」的落点：开/收轨只是终态布局不同，入场手法、时长、缓动逐字相同）。选择器挂 `:root:not([data-vt])`（§5.2：数据早到时 fade 推迟到揭幕后，晚到时闸门常开立即播）。
- **R2-C 页内开合不动**：toggle 批注轨的 240ms 三量同步过渡（[theme.css:L6399-L6405](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L6399-L6405)）已合规，不回退。
- **R2-D 空态不播**：`!current` 空态无 cols/bar，`content-enter` 自然不在场；`ctas-rise` 空态装饰保留（§5 既有裁决）。
- **状态矩阵（本页）**：Loading＝加载壳（现状文案态，§11 第四档）＋R2-B 就绪 fade；Empty＝空态（不播）；Error＝`notice-bar` 族（不变）；Success（换卡推进）＝`stage-card-in`（不变）；Hover/Focus/Disabled＝§4/既有（不变）。
- **范围外登记（R2 终审）**：复习页（review）首卡与 review-flip 的同类双动效叠加——现状维持（代码注释 theme.css stage-card-in 块附近），本规范仅登记线索不做处理；若未来用户报告复习页入场观感问题，按 R2-A 同款「首卡抑制」模式处理。

### 18.3 文本框对齐修复与对齐基准

- **修复**：[theme.css:L6503](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L6503) `.extract-main > .extract-face { margin: var(--sp-4) 0 }` → `margin: var(--sp-4) auto`。单行；v1.4 的上下对称间距意图（`--sp-4`）保留，仅恢复水平 auto。
- **对齐基准（登记为不变量）**：摘录页水平对齐锚＝**≤720 居中列**，三处同一公式（`max-width: 720px; margin-inline: auto`）：头带内列 `.extract-page-head-inner`、卡面 `.extract-face`、底栏内容列 `.extract-page .stage-bar-inner`；两态（轨 0↔280、dock 0↔416）皆成立（容器让位由 [theme.css:L6397-L6398](file:///c:/Users/xiongdy/Documents/OpenCode/Incremental%20reading%20Dev/src/theme.css#L6397-L6398) 等保证三盒同宽）。后续任何改动不得让三者之一偏离该公式；审查 grep：`.extract-face` 的水平 margin 必须为 auto。
- **窗口尺寸变化行为**：三盒同宽居中由构造保证，resize 瞬时重排、无过渡（§3.5）；窄窗（<720+128）三盒同收窄，左缘恒齐。

---

## 附录 A. 实现约束（css-native / performance-optimization / implementation-debugging）

- **零依赖**：禁止 framer-motion / gsap / lottie 等一切动画库；实现路径 = CSS transition/animation + 原生 View Transitions API。
- **复合属性纪律**：只动 `transform/opacity`（例外：§7 的 grid-template-rows 折叠；既有 review-flip 的 3D transform——3D transform 仍是 transform；§6 图表更新过渡的 SVG 几何属性 x/y/width/height transition——不参与文档布局，第 3 轮审查登记为可接受转译）。
- **will-change**：只在「确定即将动画」的元素上临时使用（如拖拽中的列表项），动画结束移除；禁止常驻 `will-change` 铺满列表。
- **同屏并发动效 ≤ 3**（stagger 序列计 1）；超出即砍次要动效。
- **调试口径**：动效异常先查——(a) 媒体查询作用域是否吞了规则；(b) 是否引用了未定义 token（IACVT，瑞士风「引用有效性」同纪律）；(c) 是否动画了布局属性；(d) React 条件卸载是否吃掉了出场（→ 用 useDismiss 模式）。**R2 增补：(e) 入场动画「播了但看不到」先查是否落在 View Transition 遮罩期（→ 挂 §5.2 闸门）；(f) 「该播没播」先查挂点覆盖（元素是否真带着入场 class——§6.1-E2 类漏挂）；(g) 「两态不一致」先查是否初始样式不触发 transition 造成的结构硬切（§18.1-E1 类）。**
- **审查 grep 口径**（新增动效必过）：`grep -nE "animation|transition" <改动文件>` 每条命中须能指出它属于本规范哪一节（§4-§11、§5.1-5.3、§10-R2、§18 之一），指不出的即为规范外动效，退回。

## 附录 B. 开发约定引用（frontend-developer skill）

该 skill 已安装于全局技能目录（`~/.trae-cn/skills/frontend-developer/SKILL.md`），作为执行层实现动效时的自检清单使用（pose-to-pose 定义清晰起止态、transform-origin 一致性、DevTools Performance 验证 60fps、prefers-reduced-motion 必测）。其内容不构成本规范的视觉裁决；与本规范冲突时以本规范为准（例：skill 建议的 hover lift 已被 §4 否决）。

## 附录 C. 新皮肤/主题开发指引（呼应用户「后续维护与新皮肤」诉求）

皮肤层（swiss 文档「Token 落地 → 皮肤层」）**不覆盖任何 motion token**：动效是行为不是配色，换肤不得改变运动语言（否则同一软件两种手感）。新皮肤只需保证：在 motion token 不变的前提下，其 Token 覆盖不与 `prefers-reduced-motion` 双轨块冲突（皮肤不改 media 查询结构）。将来若某皮肤确需差异化动效（如全静止皮肤），只能通过**追加** reduce 等价规则实现，禁止覆盖 `--dur-*`/`--ease-*` 取值。
