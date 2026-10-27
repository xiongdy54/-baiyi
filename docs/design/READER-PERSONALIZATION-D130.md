# 阅读个性化完善 R3（D130，建议版本 v48.87）

> 任务来源：主线盘点项「R3 阅读个性化完善 | 阅读外观/排版个性化深化 | ❌ 状态表未销项」。本文档为**设计稿**，不含实现；实施按 §7 任务拆解表由总控逐项派发。
>
> 设计依据：`AI_DEVELOPMENT_GUIDE.md` §6.2 阅读器段 / §5.3 / §5.4 / §7.1 / §9.2 R3 行；`docs/HISTORY.md` L87–L92（R1–R4 批次定义）；`docs/swiss-international-style.md`；`docs/design/MOTION-DESIGN-SPEC.md`（D120）；`docs/design/READER-SIDEBAR-IA-D127.md`（不动其 IA）。排版决策引用 better-layout / better-typography 两个 skill 的条款（条款名以引号标注，均为其 SKILL.md 原文标题或表格条目）。
>
> 约束回顾：零网络、零新依赖、零 schema（只扩 `settings.app.readerSettings` JSON 字段）；不破坏 §7.1 阅读内核边界与 CFI/进度不变量（个性化只走外观与交互面，不触碰定位链）；不动 D127 侧栏信息架构。

---

## 1. R3 原始范围考据（HISTORY.md 证据行）

### 1.1 证据

`docs/HISTORY.md`：

- **L87**：`### R1–R4 —— 阅读内核系列（v20 新增主线，先于 M3；R1 已实现）`
- **L89**：`> **R1 ✅（v20 实现）**：…… + 外观（主题/字号/字体）+ ……`（R1 已交付基础外观）
- **L90**：`> **R2 待做**：高亮标注（overlayer 经 Kernel 自有方法暴露 + annotations 表 + 标注→摘录/制卡联动）。`（已由批注体系交付，§9.2 R2 行 v48.84/D128 已销项）
- **L91（R3 原始定义，全文）**：`> **R3 待做**：个性化完善（自定义主题保存、页边距/行距、翻页交互细节）。`
- **L92**：`> **R4 待做（合流 M6）**：PDF……`（与本文档无关，仅确认 R3 边界）

`AI_DEVELOPMENT_GUIDE.md` **§9.2 L1538**：`| R3 | 阅读个性化完善 | ❌ |`（未销项，与 HISTORY 定义一致）。

### 1.2 考据结论

R3 原始范围＝三件事，**逐字采信 L91**：

1. **自定义主题保存**；
2. **页边距/行距**；
3. **翻页交互细节**。

考据可还原全部三项，无考据不到的残缺项。唯一需要「合理解释」的地方：原始定义未指明「页边距」在**滚动模式**下的语义（内核的 `margin` 属性仅分页模式生效，见 §2.2），本期把滚动模式的排版余白解释为「版心宽度」（`max-inline-size`），**显式标注为新增解释**（见 §4.3）。

### 1.3 现状盘点（代码取证）

| 能力 | 内核/设置层现状 | UI 现状 | 差距 |
| --- | --- | --- | --- |
| 四主题（纸白/羊皮/暗夜/自定义背景文字色） | `ReaderAppearance.theme/bgColor/fgColor`（`src/lib/reader/kernel.ts:63-75`），归一在 `src/lib/reader/foliate/appearance.ts:25-42` | 快捷菜单「主题」下拉 + 设置页「阅读外观」段（`src/components/SettingsPanel.tsx:1556-1578`） | **自定义色只有一套、不能命名保存**（R3 第①项） |
| 字号/字体 | `appearance.fontSize/fontFamily`，iframe 注入 `injectAppearanceStyle`（`appearance.ts:59-73`） | 快捷控件无、设置页滑杆+文本框（R1 已交付） | 本期不动 |
| **行距** | `appearance.lineHeight`（1.2–2.4 默认 1.7）**字段与生效链已存在**：`appearance.ts:36,69` 注入 iframe body | **无任何 UI 暴露** | R3 第②项＝接 UI |
| **页边距** | `appearance.margin`（0–120 默认 48）**字段与生效链已存在**：`foliate/adapter.ts:545` 写 paginator `margin` 属性（分页模式生效；v37 教训：必须带 px 单位） | **无任何 UI 暴露** | R3 第②项＝接 UI + 滚动模式适用面说明 |
| 滚动模式版心 | paginator `max-inline-size`（默认 720px）**滚动模式生效**（`vendor/foliate-js/paginator.js:757-766`：scrolled 分支 `columnWidth = maxInlineSize`）；adapter 文件头白名单**已登记该属性**（`foliate/adapter.ts:9`） | 无字段无 UI | 新增解释项（§4.3） |
| 阅读模式 | `mode.flow/spread`，`setMode` | 快捷菜单「模式」下拉（滚动/分页/对开） | 已完成，不动 |
| **翻页交互** | `kernel.next/prev`（跨章）；分页点击热区 10% 宽（`theme.css:4898-4907`）；←→/PageUp/PageDown/空格（`Reader.tsx:965-981`）；分页滚轮=翻页 + 滚动章尾续读（vendor 补丁 `paginator.js:582-594`，[local-patch v20.1]）；paginator 支持 `animated` 滑动过渡（`paginator.js:937,1115`，**adapter 未使用**） | 翻页钮 ‹›（24px 高，D90 档） | R3 第③项：翻页过渡、热区提示、翻页键可自定义 |
| 摘录卡排版桥 | `useExtractFaceTypography` 恒跟随阅读器行高（`src/lib/extractCardSettings.ts:155-198`） | 已实现 | 行距 UI 落地后自动受益，列回归 |

---

## 2. 本期范围清单（做 / 不做）

### 2.1 做（4 个个性化项组，8 个可交付子项）

| # | 项 | 对应 R3 原始定义 |
| --- | --- | --- |
| P1 | 自定义主题保存：当前自定义色「另存为命名主题」→ 主题下拉出现已存主题条目；管理（重命名/删除）在设置页 | 自定义主题保存 |
| P2 | 行距设置：快捷菜单预设档 + 设置页连续滑杆（内核字段已有，仅接 UI） | 页边距/行距 |
| P3 | 页边距（分页/对开）+ 版心宽度（滚动模式，新增解释）：快捷菜单预设档 + 设置页滑杆 | 页边距/行距 |
| P4a | 翻页滑动过渡开关（内核 `animated` 能力接出，默认关） | 翻页交互细节 |
| P4b | 分页点击热区 hover 提示（chevron 显隐，零布局变化） | 翻页交互细节 |
| P4c | 翻页键入 CommandRegistry（`reader.turnPrev/reader.turnNext`，可改键，对齐 M4 快捷键体系） | 翻页交互细节 |
| T1 | node 单测（外观归一纯函数） | — |
| T2 | GUI 套件 `tests/reader.personalization.gui.mjs` + 存量回归闸门 | — |

### 2.2 不做（Non-Goals）

- **不做主题社区 / M11**（界面自定义与主题社区是独立批次，皮肤体系 §5.5 不动；本期只做「阅读正文外观」的保存，不触碰应用皮肤）。
- **不做按书覆盖设置**（个性化是全局设置；按书记忆属新维度，留 §9.4 池）。
- **不做 PDF 文字层字体/行距**（PDF 是固定版式渲染，文字重排不属于个性化范畴，见 §4 各项适用面）。
- **不改 D127 侧栏信息架构**（页签行/筛选行/开关钮几何一律不动）。
- **不改阅读内核防腐层结构**（adapter 内改动仅限外观属性写入与白名单登记一行；不新增 foliate API 面）。
- **不做夜间模式联动改造**（「暗夜=软件夜间模式」的既有联动语义保持，`Reader.tsx:572-574`）。
- **不动字号/字体的既有 UI**（R1 已交付项，本期仅在新分组下原位保留）。

---

## 3. 设置键与生效机制总览

全部落在 `settings.app.readerSettings` 现有 JSON 键内（§6.2 既有层），**零 schema 变更**。新增字段一律可缺省（存量 settings.json 无新字段时解析为零行为变化）：

```
readerSettings
  ├ mode.flow / mode.spread            （既有，不动）
  ├ appearance.theme                   （既有）
  ├ appearance.bgColor / fgColor       （既有）
  ├ appearance.fontSize / fontFamily   （既有，UI 不动）
  ├ appearance.lineHeight              （既有字段，本期接 UI）
  ├ appearance.margin                  （既有字段，本期接 UI）
  ├ appearance.maxInlineSize           ★新增 number，默认 720，钳制 480–1200
  ├ appearance.turnAnimated            ★新增 boolean，默认 false
  └ customThemes                       ★新增 {id,name,bgColor,fgColor,createdAt}[]，默认 []，上限 12
```

**归一口**：新增 `normalizeReaderSettings(s)`（`src/lib/reader/foliate/appearance.ts`），合并现有「DEFAULT 兜底 + 逐字段展开」逻辑与新增字段归一，`Reader.tsx` 与 `SettingsPanel.tsx` 两处读侧同用（与 `annotationSettings` 读侧同一份归一的项目先例一致）。归一规则：

- `maxInlineSize`：非数值或越界（<480 / >1200）→ 720。
- `turnAnimated`：仅严格 `true` 为开，其余（缺失/非法）→ false（写侧宽松、读侧归一，同 `growthFeedback` 双侧归一先例 §7.4）。
- `customThemes`：非数组 → `[]`；逐条清洗（id 非空串、name 截 24 字符、bgColor/fgColor 为 `#rrggbb` 合法色、createdAt 数值），非法条目丢弃；超 12 条**保新弃旧**（按 createdAt 降序取前 12）；id 重复保留首条。

**写侧**：`electron/main.js` 的 `settings:set` 对 `readerSettings` **不做结构校验**（现状），读侧归一即安全边界；与 `annotationSettings`（主进程写侧再归一）不同，本期不加主进程归一——理由：新增字段全部可缺省且读侧钳制已封闭非法值域，不引入主进程改动。

---

## 4. 个性化项规格

> 每项给出：设置键、默认值、生效机制、foliate 与 pdf.js 两内核适用差异、GUI 探针（data-* 钩子）。

### 4.1 P1 自定义主题保存

- **设置键**：`readerSettings.customThemes`（结构见 §3）；应用某套主题时写既有 `appearance.theme="custom"` + `appearance.bgColor/fgColor`。
- **默认值**：`[]`（空列表＝现状，零行为变化）。
- **交互**（信息架构见 §5.2）：
  - **保存**：主题选「自定义」且调整了背景/文字色后，快捷菜单自定义行尾出「保存主题」文字按钮（`data-reader-theme-save`）→ 就地行内输入框命名（默认名「我的主题 N」，N=当前数量+1）→ 确认写入 `customThemes`（id=`ct-`+时间戳）。
  - **应用**：主题下拉在四个内置档之后追加「── 我的主题 ──」分组标签 + 已存主题条目（`data-reader-theme-option="{id}"`，条目左侧 12×12 色块预览＝该套 bgColor）；选中＝写 `theme:"custom"` + 该套 bgColor/fgColor。**选中已存主题不回写该条目本身**（重复「保存」才新增条目，避免别名漂移）。
  - **管理**（重命名/删除）只在设置页 `sec-reader`（progressive disclosure：弹层放高频动作，低频管理进设置页；better-layout「Hint at hidden content」——弹层下拉末尾一条「管理主题…」跳设置页对应锚点）。
  - **删除当前正在使用的主题**：条目删除后若 `appearance` 仍指向该配色，外观保持不变（theme=custom + 色值仍在 appearance 上，主题列表只是速记本）——**不联动清色**，行为可预期。
- **生效机制**：零新机制——完全复用既有链 `resolveAppearance → kernel.applyAppearance → host CSS 变量（--reader-bg/--reader-fg）+ iframe 注入字面值`。
- **两内核差异**：foliate＝全部生效（背景/文字色贯穿视口与章节内容）。pdf.js＝`bgColor` 生效于页面容器底色（页面之外的留白区，`pdf/adapter.ts:389-391` 已有）；`fgColor` **不生效**（PDF 文字由矢量渲染，不做文字色重绘；暗夜仍走既有 `invert(0.92) hue-rotate(180deg)` 滤镜路径）。保存入口在 PDF 引擎下可用（保存的是通用配色，EPUB 下生效完整）。
- **GUI 探针**：`data-reader-theme-save`（按钮）、`data-reader-theme-option="{id}"`（下拉条目）、`data-reader-theme-name-input`（命名输入框）、设置页 `data-reader-theme-manage-list`（管理列表）。
- **上限**：12 套；已满时「保存主题」按钮禁用 + title 说明（「最多保存 12 套，请先在设置页删除」）。

### 4.2 P2 行距

- **设置键**：`readerSettings.appearance.lineHeight`（**既有字段**，1.2–2.4，默认 1.7）。
- **UI**：
  - 快捷菜单「行距」下拉（`data-reader-row="lineHeight"`）：紧凑 1.5 / 标准 1.7 / 宽松 2.0 三预设档；档位值即 lineHeight 数值（非独立枚举——下拉只是快捷面，设置页滑杆可取连续值，两者读写同一字段；下拉高亮当前档＝四舍五入到 0.1 最接近档）。
  - 设置页滑杆：1.2–2.4 步进 0.1，数值以 mono + `font-variant-numeric: tabular-nums` 实时显示（better-typography「Tabular numbers on changing values」——滑杆拖动时数字宽度不得跳动）。
- **生效机制**：既有 `injectAppearanceStyle` 向章节 iframe 注入 `body { line-height: … !important }`（`appearance.ts:69`）+ `resolveAppearance` 钳制（1.2–2.4）。无需任何内核改动。
- **两内核差异**：foliate＝生效（重排流式内容）。pdf.js＝**不适用**（固定版式）→ 两处控件在 PDF 引擎下渲染为禁用态 + `title="PDF 为固定版式，不适用行距"`（禁用态遵守 swiss「disabled＝文字与边框 grey-2、不响应 hover」）。
- **联动回归**：`useExtractFaceTypography` 行高恒跟随（`extractCardSettings.ts:177`）——行距改动会同步摘录卡面行高，属**预期行为**（§F.2 契约），列入测试计划观察项。
- **GUI 探针**：`data-reader-row="lineHeight"`（快捷菜单行）、设置页 `data-reader-setting="lineHeight"`；断言经 `window.__readerKernel` 取当前章节 iframe `getComputedStyle(doc.body).lineHeight`。

### 4.3 P3 页边距（分页）+ 版心宽度（滚动）【页边距的滚动语义＝新增解释】

- **P3a 页边距**：
  - **设置键**：`readerSettings.appearance.margin`（**既有字段**，0–120px，默认 48）。
  - **生效机制**：既有 `applyRendererSettings` 写 paginator `margin` 属性（**必须带 px 单位**——v37 教训，`reader.paging.gui.mjs` 2a 断言守护：`minmax(48px,1fr)` 三行网格，无单位即整条 grid-template-rows 失效、页高塌缩）。语义＝分页/对开模式的**上下边带高度**（paginator `--_margin` 上下各一档，README L183：「The height of the header and footer」）。
  - **UI**：快捷菜单「边距」下拉：窄 24 / 标准 48 / 宽 80 三档；设置页滑杆 0–120 步进 4（8px 基线半档）。**仅 flow=paged/spread 时可用**；滚动模式下渲染禁用态 + `title="页边距在分页/对开模式下生效"`（「看着能调、调了没反应」＝硬缺陷，禁止）。
  - **两内核差异**：foliate 分页＝生效；foliate 滚动＝不生效（paginator scrolled 分支 `#top.style.padding='0'`，边距让位给版心宽度，`paginator.js:762`）；pdf.js＝不适用（页面自带版式，视觉大小由缩放控制）→ 控件对 PDF 引擎隐藏（与缩放控件对 foliate 隐藏互为镜像，复用 `engineKind === "pdf"` 条件渲染模式）。
- **P3b 版心宽度（滚动模式排版余白，新增解释）**：
  - **设置键**：`readerSettings.appearance.maxInlineSize`（★新增，默认 720，钳制 480–1200）。
  - **解释声明**：R3 原文「页边距/行距」未提滚动模式；内核 `margin` 仅分页生效，滚动模式的横向余白由 paginator `max-inline-size`（正文列最大宽，vendor 默认 720px）承载。本期将其解释为「页边距」在滚动模式的对应物＝**版心宽度**。这与 better-typography「Cap the measure」（长文行宽 60–75 字符）同源：720px @ 17px ≈ 42 个全角字/行，处于中文长文舒适区（35–45 字）；720 默认值＝vendor 默认＝存量零变化。
  - **生效机制**：`applyRendererSettings` 增写 `r.setAttribute("max-inline-size", `${a.maxInlineSize}px`)`（带 px 单位，同 margin 教训）；adapter 文件头白名单**已含** `max-inline-size`（`foliate/adapter.ts:9`），无白名单变更。
  - **UI**：快捷菜单「版心」下拉：窄 600 / 标准 720 / 宽 860 / 全宽 1200；设置页滑杆 480–1200 步进 20。滚动模式可用；分页模式**也可用**（paginator 分页列宽同受此值上限约束，README L185）——但本期 UI 仅滚动模式启用控件，分页模式禁用态（理由：分页列宽实际由「容器宽 ÷ 列数」决定，`max-inline-size` 只是上限，分页下调它收益晦涩，不暴露）。竖排（vertical-rl）书表现未验证，列入风险 R3（§9）。
  - **两内核差异**：foliate＝两模式底层都消费该值（本期只在滚动模式暴露）；pdf.js＝不适用 → 控件隐藏（同 P3a）。
- **GUI 探针**：`data-reader-row="margin"` / `data-reader-row="measure"`（快捷菜单行）、设置页 `data-reader-setting="margin"` / `data-reader-setting="measure"`；断言：分页模式下 paginator `#top` computed `--_margin` 数值等于设定值；滚动模式下 iframe 宿主侧 `foliate-paginator` 的 `max-inline-size` attribute 与设定值一致。

### 4.4 P4 翻页交互细节

#### P4a 翻页滑动过渡

> **D241 / v49.70 覆盖注记**：以下为 D130 历史设计。当前存储字段改为 `appearance.turnEffect: "glide" | "none"`，默认 glide；旧 turnAnimated 存储值忽略并剥离，仅作生效输出。foliate 三种模式均支持：分页/对开滑行与触控板吸附，滚动整屏缓动，跨章淡入；PDF 不适用。系统减少动效及应用关闭/减少动效强制关闭，UI 保留用户意愿。默认开及 vendor 补丁取代此节原默认关/零补丁决策，详见 GUIDE D241。

- **设置键**：`readerSettings.appearance.turnAnimated`（★新增 boolean，**默认 false**）。
- **默认取 false 的理由**：① 存量行为零变更是本仓一贯纪律（v48.22「存量行不动」、D58 等先例）；② `animated` 与 paginator 翻页时序耦合（`paginator.js:1115`：有该属性时 `#turnPage` 走动画等待路径），默认关闭把回归风险封顶在显式开启的用户群；③ 个性化语义＝用户选择，不强加给所有用户。备选方案（默认开）被否，理由如上，登记于此。
- **生效机制**：adapter `applyRendererSettings` 按值 toggle renderer 的 `animated` 布尔属性。**注意**：`animated` 不在 paginator `observedAttributes`（`paginator.js:442-446`），但两处消费点都是 `hasAttribute` 即时读取（`paginator.js:937,1115`），`setAttribute/removeAttribute` 即刻影响下一次翻页——**零 vendor 补丁、零 observedAttributes 改动**。adapter 文件头白名单补记该属性（一行注释变更，§7.1.9 纪律：adapter 文件头维护白名单）。
- **两内核差异**：foliate 分页/对开＝生效（章内滑动过渡）；foliate 滚动＝无翻页语义（滚动连续），属性挂但不产生可见差异；pdf.js＝不适用（连续滚动容器）→ 开关控件仅 foliate 引擎且 flow=paged/spread 时启用，其余禁用态。
- **GUI 探针**：`data-reader-row="turnAnimated"`；断言：开关切开后 `window.__readerKernel` 宿主侧 `foliate-paginator` 元素 `hasAttribute("animated")===true`，关闭为 false；两态下连续 16 次跨章翻页限时 settle（复用 `reader.paging.gui.mjs` 第 3 节手法）。
- **reduce-motion**：`matchMedia("(prefers-reduced-motion: reduce)")` 为 reduce 时，无论设置值如何**不挂** `animated`（壳层在计算生效值时强制 false；设置项 UI 仍可改，存储保留意愿）。

#### P4b 分页点击热区 hover 提示

- **设置键**：无（纯呈现层，零状态）。
- **交互**：现有 `.reader-tap-zone`（10% 宽、透明、z-index 4）内 hover 时浮现一枚 24×24 chevron（Lucide ChevronLeft/Right，16px、stroke 1.5），垂直居中贴热区内缘 12px；颜色 `color-mix(in srgb, var(--reader-fg) 62%, transparent)`（与 `.reader-pageinfo` 同一手法）；`opacity 0→1` 过渡。失焦/移出即隐，**不持久显示、零布局变化**（热区几何不动，翻页行为不变）。
- **设计依据**：better-layout「Hint at hidden content」——「Content hidden with zero cue may as well not exist」：左右 10% 热区目前零可见线索，hover 提示以最低成本补 affordance；同时守住 swiss 克制（不画常驻箭头、不加底色块）。
- **两内核差异**：热区在 `mode.flow==="paged"` 时渲染（与引擎无关，现状如此）——PDF 分页视感下同样出现，行为一致，不做区分。
- **GUI 探针**：`data-reader-tap-hint="left|right"`；断言：rest 态 computed opacity < 0.05，CDP 真鼠标 hover 后 > 0.9（160ms 过渡终值）。

#### P4c 翻页键入 CommandRegistry（可改键）

- **设置键**：复用 M4 快捷键设置存储（`commands.ts` 既有键位存储，无新键）。
- **命令**：新增两条 scene=「阅读」命令：`reader.turnPrev`（默认 `←`）/ `reader.turnNext`（默认 `→`），动作即 `turnPage(-1/1)`。
- **迁移契约**：`Reader.tsx:965-981` 硬编码 window keydown 中**仅移除 ArrowLeft/ArrowRight 两分支**（交命令条接管）；PageUp/PageDown/空格/Shift+空格**保留在壳层硬编码**（不进命令表——避免与滚动场景的空格语义冲突，且这四键不在「可自定义」诉求内）。输入框/可编辑焦点守卫（现有 `tagName==="INPUT"…` 分支）在命令执行面同样生效（实施时核对 `useCommands` 的场景过滤与焦点守卫路径，与既有 `reader.extract` 等命令同一条链，行为对齐）。
- **收益**：翻页键进入 M4 设置页冲突检测与恢复默认体系（「翻页交互细节」的可自定义面）。
- **两内核差异**：无（壳层动作，内核 `next/prev` 引擎无关）。
- **GUI 探针**：无新 data-*（走 M4 快捷键套件既有断言面）；本项断言＝按 ← 前后 `getCurrentLocation().cfi` 变化（foliate）。
- **风险定级**：本项为 P4 中风险最高者（命令条接管键盘路径），独立成任务（T6）可单独回退。

---

## 5. 排版设计（弹层信息架构 + 设置页 + 视觉）

### 5.1 快捷菜单「阅读设置」改版（`.reader-tool-menu`）

现状（`Reader.tsx:1587-1644`）：平铺 2–3 行（模式 / 主题 / 缩放-PDF）。本期扩到 6–7 行，必须分组，否则成为无层级的长清单。

```
┌────────────────────────────────────┐
│ 排版                                │  ← 组标签：Meta 档 12px / 500 / 62% 透明
│ 模式        [滚动 ▾]                │
│ 行距        [标准 1.7 ▾]            │
│ 边距        [标准 48px ▾]           │  (分页/对开可用；滚动禁用态)
│ 版心        [标准 720px ▾]          │  (滚动可用；分页/PDF 禁用态或隐藏)
│ ───────────────────────────────── │  ← hairline 视觉断点（组间 8px）
│ 外观                                │
│ 主题        [纸白 ▾]                │
│ [■][■] 自定义色      [保存主题]     │  (theme=custom 时；满 12 套禁用)
│   └ 已存主题条目（下拉内分组）        │
│ ───────────────────────────────── │
│ 翻页                                │
│ 动画过渡    [关 ▾]                  │  (foliate+分页可用；PDF 禁用态)
│ 缩放        [适应宽度 ▾]            │  (仅 PDF，原位保留)
└────────────────────────────────────┘
```

排版规则（逐条引用来源）：

1. **「Group with space, not lines」**：组内行距维持 `.reader-tool-menu-row` 既有 `padding: var(--sp-1) var(--sp-3)`（4px 纵向节奏）；组间 `margin-block: var(--sp-2)`（8px）＝组间 ≥ 2× 组内，空间先行；hairline 仅作视觉断点（次手段，与 `.reader-engine-divider` 注释「主分组靠空间，1px 线仅作视觉断点」同一立场）。
2. **「Align to shared edges」**：左缘＝组标签与所有行标签共享对齐缘（现 `reader-tool-menu-label` 已左对齐）；右缘＝所有下拉控件右缘对齐（现有 `justify-content: space-between` 已如此）；新增行不得破坏这两条缘。下拉统一 `min-width: 148px`（既有 `.reader-tool-menu-row .dd-menu` 值，不加新宽度）。
3. **「Order by importance」**：分组顺序＝排版（最高频）→ 外观 → 翻页/缩放（低频）；弹层自身顺序即使用频率序，不按实现层级排。
4. **「Keep controls distinct from content」**：行标签（Meta 62% 透明）与控件（有边框 `dd-btn` 族）视觉分层已由既有样式承载；新增「保存主题」为**文字按钮**（Meta 档 accent 色 hover 下划线，同「跳转原文」语言 §5.4），不放大按钮不进 accent 填充——弹层内不出现第二焦点色块。
5. **「Plan for growth and clipping」**：主题命名输入框 `max-width: 160px` + 归一截 24 字符（§3）；主题条目名 `line-clamp: 1` + `title` 全名（better-typography「Truncate without losing content」——截断时全名经 tooltip 可达）；标签一律 `white-space: nowrap`，弹层整体宽度由内容决定（既有 `.reader-tool-menu` 无定宽，不引入）。
6. **字号与数值**：组标签与行标签 Meta 12px/500（swiss 字号阶梯 Meta 档，不低于 12px 下限）；下拉中数值档位显示（1.7 / 48px / 720px）用 mono + tabular-nums（better-typography「Tabular numbers on changing values」）。弹层内不出现 <12px 文字。
7. **逻辑属性**：新增样式的方向性间距一律 `margin-inline-start/end` / `padding-inline-start`（better-layout「Use logical properties」——阅读器存在 RTL 书，宿主 UI 面向中文但规则不破例）。
8. **语言**：行距/边距/版心的「窄/标准/宽」档名自然语言存储，展示层不加 transform（better-typography「Write copy naturally, style with CSS」）。

### 5.2 设置页 `sec-reader`「阅读外观」区块扩展

现有结构（`SettingsPanel.tsx:1556-1596`）保留（主题预设段控 / 自定义色 / 字号 / 字体），追加：

```
阅读外观
  主题预设        [纸白|羊皮|暗夜|自定义]        （既有）
  自定义色        [背景色] [文字色]              （既有，custom 时）
  字号（17px）    ────●──────                   （既有）
  正文字体        [________________]             （既有）
  行距（1.7）     ────●──────                   ★新增滑杆 1.2–2.4 / 0.1
  页边距（48px）  ────●──────                   ★新增滑杆 0–120 / 4
  版心宽度（720px）────●──────                   ★新增滑杆 480–1200 / 20
  ── 我的主题 ──────────────────────            ★新增（customThemes 非空时渲染）
  [色块] 我的主题 1  2026-10-12   [重命名] [删除]
  [色块] ……                                     （行 hover 出操作，Meta 档文字按钮）
  （空态：一句话「在阅读器里把自定义色保存为主题后，会出现在这里」——swiss 空态规则：
   一句话说明，不放主行动按钮；保存动作在阅读器弹层，此处文案指向它）
```

规则：滑杆行沿用既有 `.settings-row` 网格（label 上、控件下对齐法则，swiss「对齐法则」）；「我的主题」列表行 hairline 分隔、行 hover `--grey-1`（swiss 表格行语言）；删除走就地二次确认（R36/R37/R40 既有先例：先变「确认删除」再点一次生效，焦点默认落「取消」）；重命名＝就地行内输入（失焦落库，同批注编辑器 400ms 防抖语义可简化为失焦即存）。设置页滑杆与快捷菜单档位**读写同一字段**，双向即时一致（`settings/changed` 事件既有广播链）。

### 5.3 视觉 Token 清单

**新增 Token：0 枚。** 全部复用既有变量：

- 间距：`--sp-1/2/3/4`（弹层行距/组间距/hairline 外距）；设置页滑杆行沿用 `.settings-row` 既有网格。
- 字号字重：`--fs-meta`（组标签/行标签/文字按钮）、`--fs-secondary`（控件值）、`--font-mono` + tabular-nums（数值）。
- 色彩：`--reader-fg` 混色族（`color-mix` 62%/28%/8% 三档，与 `.reader-pageinfo`/`.reader-engine-controls .dd-btn`/hover 底同源，保证自定义主题与暗夜下弹层随阅读外观换色）；强调仅「保存主题」文字与已存主题选中态下划线用 `--accent`；`--border-subtle`（hairline）；`--grey-1/2`（hover/禁用）。
- 动效：见 §6，全部既有档位。

理由：弹层与设置页都在既有阅读器控件语言（24px 钮族、dd 下拉、Meta 标签）内扩展，任何新 Token 都会制造第二套密度/灰阶；「确需新增」条件未触发。

---

## 6. 动效清单（全部引用 MOTION-DESIGN-SPEC D120 既有档位，零新 Token）

| # | 动效 | 档位 | 出处 | reduce-motion |
| --- | --- | --- | --- | --- |
| M1 | 阅读设置弹层入场/出场 | `--dur-enter` 150ms `--ease-enter` / `--dur-exit` 100ms `--ease-exit`（浮层硬规则） | MOTION §1；既有 `.dd-menu` 行为 | 瞬时显隐 |
| M2 | 弹层分组展开（自定义色行、已存主题分组随主题档出现） | `--dur-panel` 240ms `--ease-out-soft`（展开 enter 语义，内容 opacity 延迟 50ms 淡入） | MOTION §7 展开/折叠 | 瞬时终态 |
| M3 | 滑杆/下拉值变化时数值显示 | 无动画（数字即时更新，tabular-nums 防跳动） | better-typography | — |
| M4 | 正文主题色切换 | **不做过渡**：宿主 `--reader-bg/--reader-fg` 与 iframe 注入字面值瞬时切换（大面积颜色渐变违反瑞士「克制」；iframe 注入是字面值，动画需双面插值，成本与收益不匹配） | swiss 设计哲学「克制」 | — |
| M5 | 翻页滑动过渡（P4a） | vendor `animated` 内建滑动（时长由 vendor 决定，非 Token 面；约 300ms 级），属性由设置控制 | foliate README L181 | reduce ⇒ 永不挂属性（§4.4a） |
| M6 | 热区 chevron hover 显隐 | opacity 过渡 `--dur-hover` 160ms `--ease-out-soft`（hover 揭示） | MOTION §4 hover 规范 | 瞬时 |
| M7 | 「我的主题」列表条目删除退场 | 不做退场动画（列表行直接移除；设置页列表非浮层，克制优先） | — | — |

硬性：M2/M6 的规则必须写在 `@media (prefers-reduced-motion: no-preference)` 作用域内（§5.1 D120 动效 Token 分层条款）；M5 由壳层 matchMedia 强制降级（§4.4a）。审查配方：`grep -nE "transition:.*[0-9]+ms|animation:.*[0-9]+ms" src/theme.css` 命中值必须全部来自既有 Token。

---

## 7. 任务拆解表（主控逐项派发；执行者按角色分工路由，核心域改动完成后经独立审查角色复核）

| 任务 | 内容 | 涉及文件 | 验收标准（可机械检查） | 依赖 |
| --- | --- | --- | --- | --- |
| T1 | 外观层扩展：`normalizeReaderSettings` + `resolveAppearance` 增 maxInlineSize/turnAnimated 钳制 + customThemes 归一 | `src/lib/reader/foliate/appearance.ts`、`src/lib/reader/service.ts`（re-export） | `tsc --noEmit` 0；新增 node 单测（T2）全绿；存量字段解析快照不变（向后兼容用例） | — |
| T2 | node 单测套件 | `tests/reader.appearance.test.cjs`（新建，`@runtime node` 头） | `node tests/reader.appearance.test.cjs` 全绿：新字段钳制/默认/非法值回落；customThemes 上限 12 保新弃旧/非法条目丢弃；存量 settings（无新字段）解析结果与旧实现逐字段相等 | T1 |
| T3 | foliate adapter：`applyRendererSettings` 增写 `max-inline-size` 与 `animated` toggle；文件头白名单行补 `animated` | `src/lib/reader/foliate/adapter.ts`（仅外观写入面 + 头注释） | `tsc` 0；L1 `node tests/reader.kernel.cjs` 全绿；L2 `npx electron tests/reader.engine.mjs` 全绿；adapter diff 不触碰 CFI/进度路径 | T1 |
| T4 | 快捷菜单改版：分组 IA + 行距/边距/版心/动画控件 + 保存主题流 + 全部 data-* 探针 | `src/components/Reader.tsx`（toolMenu 段） | `tsc` 0；GUI 套件 T7 对应断言全绿；探针齐全（§4 各项 data-*）；D127 侧栏 DOM/几何零 diff（对照 `annotations.gui` ⑪ 系列仍绿） | T1,T3 |
| T5 | 设置页扩展：三个滑杆 + 「我的主题」管理列表 + 空态；theme.css 弹层分组样式 + 热区 chevron（no-preference 作用域） | `src/components/SettingsPanel.tsx`、`src/theme.css` | `tsc` 0 + `npm run build` 成功；滑杆与快捷菜单读写同键双向一致（settings/changed）；`grep` 审查：新增 transition/animation 值全部来自既有 Token；新增样式零新 Token | T1 |
| T6 | 翻页键入命令条：`reader.turnPrev/turnNext` + Reader.tsx 键盘分支迁移 | `src/lib/commands.ts`、`src/components/Reader.tsx`（keydown effect） | `tsc` 0；M4 快捷键套件全绿；GUI：按 ←/→ 翻页 cfi 推进；PageUp/PageDown/空格行为与迁移前一致（对比断言）；快捷键设置页可见两条新命令且可改可恢复默认 | T4 |
| T7 | GUI 套件 | `tests/reader.personalization.gui.mjs`（新建，参照 `reader.paging.gui.mjs` 骨架：自启自关、M7_TEST_USERDATA 隔离、fixture EPUB） | 全绿（断言清单见 §8.2） | T3–T6 |
| T8 | GUIDE 登记块落地（§9 附录文本逐字入档：版本号 v48.87 + §8.1 D130 行 + §9.2 R3 行 + §6.2 增补句） | `AI_DEVELOPMENT_GUIDE.md` | f11/f18/f20/f21/f24/f27 闸门全绿（文档↔代码漂移核对；新增设置键入 §7.4 登记口径则 f18 DOC_KEYS round-trip 同步） | T7 全绿后 |

派发顺序：T1 → (T2 ∥ T3) → (T4 ∥ T5) → T6 → T7 → T8。T3/T4/T6 属阅读内核与壳层核心域，实施后必须经 `code-reviewer` 审查。

---

## 8. 测试计划

### 8.1 node（`@runtime node` 直跑）

`tests/reader.appearance.test.cjs`（新建；`resolveAppearance`/`normalizeReaderSettings` 为纯函数，node 直跑）：

1. `maxInlineSize`：缺省→720；非法（负数/字符串/越界）→720；边界 480/1200 保留。
2. `turnAnimated`：缺省→false；严格 true→true；`"true"`/1→false（宽松写侧、严格读侧）。
3. `customThemes`：缺省→[]；非数组→[]；13 条保新弃旧 12；非法色值/空 id 条目丢弃；重复 id 保首条；name 超 24 字符截断。
4. **向后兼容**：`{mode:{flow:"paged"},appearance:{theme:"paper"}}` 与 `{}` 两种存量输入的解析结果与 D130 之前 `resolveAppearance` 输出逐字段相等（防静默默认漂移——IACVT 的数据面类比）。
5. `lineHeight/margin` 既有钳制回归（1.2–2.4 / 0–120）不因重构漂移。

### 8.2 GUI（`tests/reader.personalization.gui.mjs`，CDP 自启自关；夹具与隔离同 `reader.paging.gui.mjs`）

| 组 | 断言要点 |
| --- | --- |
| A 行距 | 设置 lineHeight=2.0 → 当前章节 iframe `computed body line-height` ≈ 2.0×fontSize；重启应用后保持（**重启不丢数据** §7.1.4） |
| B 边距 | 分页模式设 margin=80 → paginator `--_margin` computed=80px；`#top` 三行网格上下带=80（复用 paging 套件 2a 几何口径）；滚动模式下控件为禁用态（`disabled`/aria-disabled 探针） |
| C 版心 | 滚动模式设 maxInlineSize=600 → `foliate-paginator` 的 `max-inline-size` attribute="600px"；正文容器 computed max-width ≈ 600 |
| D 主题保存 | custom 色 →「保存主题」→ 命名 → 下拉出现 `data-reader-theme-option`；重启后仍在；删除后下拉消失；第 13 套保存被拒（按钮禁用） |
| E 两内核适用面 | PDF 书：行距/边距/版心行不渲染或禁用态、缩放行在场；EPUB：反之；PDF 下自定义主题仅改容器底色（fgColor 探针跳过并注明「Not verified」口径不适用——断言只测 bgColor） |
| F 翻页 | turnAnimated 开→`hasAttribute("animated")` true、关→false；**两态各跑连续 16 次跨章翻页限时 settle 不锁死**（复用 paging 第 3 节）；reduce-motion 模拟（CDP `Emulation.setEmulatedMedia`）→ reduce 下永不挂属性 |
| G 热区提示 | 真鼠标 hover 左热区 → `data-reader-tap-hint="left"` opacity>0.9；移出→<0.05；点击翻页行为不变（cfi 推进） |
| H 翻页键 | 按 ←/→ cfi 推进；在 INPUT 聚焦下按键不翻页（焦点守卫）；快捷键设置页改键后新键生效 |
| I 回归口径 | 全程控制台零错误（同 paging 第 6 节过滤）；D127 几何零漂移（页签行 top/高、开关钮 **40×24** 断言抽检——D139 把顶部按钮带降到 24 档，抽检值随之同步） |

### 8.3 存量回归闸门（全绿方可销项）

- `tests/reader.paging.gui.mjs`（margin 几何 2a/2b + 导航健壮性 3/4/5——P3/P4 直接踩它的口径）
- `tests/reader.kernel.cjs`（L1，含 CJK ruby/竖排夹具——版心宽度对竖排的回归口径）
- `npx electron tests/reader.engine.mjs`（L2）
- `tests/annotations.gui.mjs`（批注色随主题重算链 `refreshMarkStyles`——主题系统改动必跑）
- `tests/extract.gui.mjs`（行高桥：摘录卡面行高跟随）
- `tsc --noEmit` 0 + `npm run build` 成功

---

## 9. 风险清单

| # | 风险 | 处置 |
| --- | --- | --- |
| R1 | `animated` 属性与 paginator 翻页时序耦合（`#turnPage` 走动画等待路径，`paginator.js:1115`），极端内容下可能放大卡顿 | 默认 false；F 组两态各 16 次跨章翻页限时 settle 作为闸门；异常即保持默认并登记 §8.2 偏差 |
| R2 | `max-inline-size` 对竖排（vertical-rl）书的版心映射未验证（vendor scrolled 分支自带 FIXME：「vertical-rl only, not -lr」） | L1 CJK 竖排夹具回归为准；异常时该值仅影响列宽计算不破坏排版（vendor 内建 clamp），最坏情形＝竖排书版心不随设置变化，登记为已接受差异 |
| R3 | 边距/版心「调了没反应」体验缺陷（margin 滚动模式不生效、PDF 全不适用） | 控件适用面按 §4 显式禁用/隐藏 + title 说明；禁止渲染无效控件（「看着能调、调了没反应」＝硬缺陷，D51 同一立场） |
| R4 | 行距改动联动摘录卡面（`useExtractFaceTypography` 恒跟随）超出用户预期 | 属 §F.2 既有契约（行高恒跟随），不在本期改语义；extract.gui 回归守护；若用户实测反馈异议，另立决策 |
| R5 | customThemes 膨胀与命名冲突 | 上限 12 保新弃旧；重名允许（id 唯一即可），下拉以色块预览辅助区分；膨胀被上限封顶 |
| R6 | 翻页键入命令条（T6）改变键盘路径，可能与命令条场景过滤或焦点守卫产生回归 | 独立任务可单独回退；PageUp/PageDown/空格不入命令表缩小爆炸半径；H 组断言守护 INPUT 焦点守卫 |
| R7 | 弹层行数增加后小窗口溢出 | 弹层为 dd-menu 浮层（可翻边，D56 机制既有），内容纵向增长不触横向溢出；主题条目 line-clamp+截断；「Plan for growth」条款已覆盖（无定宽容器） |

---

## 附录 A：GUIDE 登记块（建议文本，实施批 T8 逐字落地）

### A.1 版本号

**v48.87**（v48.85 已被 M13 D129 占用；v48.86 预留给 electron-builder 打包批）。

### A.2 §8.1 决策日志新增行（D130）

```markdown
| D130 | **v48.87 R3 阅读个性化完善（设计 `docs/design/READER-PERSONALIZATION-D130.md`；原始范围＝HISTORY L91「自定义主题保存、页边距/行距、翻页交互细节」）**：① **自定义主题保存**——`readerSettings.customThemes`（{id,name,bgColor,fgColor,createdAt}[]，上限 12 保新弃旧），保存/应用走既有 custom 档生效链，管理（重命名/删除）在设置页 sec-reader；② **行距/页边距/版心接 UI**——`appearance.lineHeight`（1.2–2.4 默认 1.7）与 `appearance.margin`（0–120 默认 48，分页/对开生效）为既有字段补 UI，`appearance.maxInlineSize`（480–1200 默认 720）为**新增字段＋新增解释**（滚动模式页边距的对应物＝版心宽度，paginator 既有属性、白名单已登记）；③ **翻页交互细节**——`appearance.turnAnimated`（默认 false，vendor `animated` 属性，reduce-motion 强制不挂）、分页热区 hover chevron 提示（零布局变化）、翻页键入 CommandRegistry（`reader.turnPrev/turnNext`，PageUp/PageDown/空格留壳层）。归一口＝appearance.ts `normalizeReaderSettings` 读侧统一钳制，主进程写侧不加归一。零 schema 变更、零新依赖、零新 Token、零 vendor 补丁。 | 主线盘点 R3 销项指令（用户 2026-10-12「我引用的对话内容的任务，请全部帮我实现和处理」）+ HISTORY L91 考据 | v48.87 |
```

### A.3 §9.2 R3 状态行更新文本

```markdown
| R3 | 阅读个性化完善 | ✅ v48.87 实现（自定义主题保存 `customThemes`、行距/页边距/版心设置（lineHeight/margin 既有字段接 UI + maxInlineSize 新增）、翻页滑动过渡/热区提示/翻页键可自定义；设计 `docs/design/READER-PERSONALIZATION-D130.md`，D130） |
```

### A.4 §6.2 阅读器段「外观」子句增补（替换该句）

现句（L646 内）：`**外观**（纸白/羊皮/暗夜/自定义背景文字色、字号、字体；快捷控件与设置页「阅读」区块同读写 settings.app.readerSettings）`

替换为：

```markdown
**外观**（纸白/羊皮/暗夜/自定义背景文字色、字号、字体、**行距（1.2–2.4）**、**页边距（0–120px，分页/对开生效）**、**版心宽度（480–1200px，滚动模式生效）**、**自定义主题保存**（`customThemes` 命名主题 ≤12 套，保存/应用走 custom 档，管理在设置页）；快捷控件与设置页「阅读」区块同读写 `settings.app.readerSettings`；PDF 引擎仅适用主题底色与缩放（固定版式，字号/字体/行距/边距/版心不适用，控件禁用或隐藏并说明）；**翻页交互**（既有四键与热区之上增：滑动过渡开关 `appearance.turnAnimated` 默认关且 reduce-motion 强制关、分页热区 hover chevron 提示、翻页键 `reader.turnPrev/turnNext` 入 CommandRegistry 可自定义）
```

### A.5 f18 设置键登记（若按 §7.4 消费者扫描口径需要）

新增键名（均在 `readerSettings` 对象内部，不新增顶层键）：`appearance.maxInlineSize`、`appearance.turnAnimated`、`customThemes`——`readerSettings` 顶层键已登记，内部字段扩充不触发新键登记；实施时以 f18 DOC_KEYS round-trip 实测为准。
