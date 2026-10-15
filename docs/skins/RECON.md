# 皮肤引擎 v2 · P0 侦察结论（RECON）

> 侦察基线：main @ 422dea1（GUIDE v48.123），分支 `skin-engine-v2`。
> 本文是 P0–P7 各阶段的**事实来源**；实施方案与真实代码不一致时以本文记录的差异裁决为准。

## 1. 环境与工具

| 项 | 事实 | 方案核对 |
| --- | --- | --- |
| Electron | `^31.0.0` → **Chromium 126** | ≥113（linear()）✅ ≥111（View Transitions）✅ ≥99（@layer）✅，无停止条件 |
| React | 18.3.1（flushSync 可用） | ✅ |
| 构建 | Vite 6 + @vitejs/plugin-react，三入口（index/capture/workbench.html） | `?inline` 原生支持 ✅ |
| TS | 5.5.3；lib.dom **无** startViewTransition 类型（App.tsx 已有局部特性检测先例） | — |
| 截图能力 | **已有**：CDP（`Page.captureScreenshot`）+ `M7_TEST_USERDATA` 隔离自启 Electron（accent.gui.mjs / tmp-d168-shot.mjs 先例）；`node:zlib` 可写零依赖 PNG 解码对比。**无需 Playwright** | P0-10 通过，无停止条件 |

## 2. 现有皮肤体系（将被 v2 替换）

- 注册表：`src/skins/index.ts`——旧接口 `SkinDef { id, name, component, props, bodyClass? }`，仅 `none` 一支。
- 使用点（P2-4 改造面）：
  - `src/App.tsx` L29 import、L125 `skinId` state、L181 读取（`app.skinId`）、**L258-268 body 类 effect（整段删）**、L285-292 `handleSkinChange`（D132 互斥：`id !== "none"` 时 `pluginsAPI.setActive("")`，保留）、L537 `getSkin`、L687 `<div className="skin-layer">`、L777 传 `SettingsPanel`。
  - `src/components/SettingsPanel.tsx` L2/L64/L2809/L2944-2955（皮肤列表按钮）、L2959-2963 强调色行（**L2961 默认显示值硬编码 `#166a59`**）。
  - `src/theme.css` L595-603：`.skin-layer`（保留）+ `body.has-skin` 透明规则 ×2（改 `skin-chrome-transparent`）。
- 兼容键：`app.skinId`（持久化，值 `"none"`＝默认）不变。
- **独立窗口**（capture.tsx / workbench.tsx）不挂 SkinHost：只 import theme.css + `applyCaptureAppearance()`（读 `app.accentColor` 重放 accent）。v1 皮肤仅主窗口生效；`--user-accent` 内联在独立窗口同样生效（accentVar 对两窗口等价）。已接受，登记 AUTHORING。

## 3. 强调色链路（P2-3 改造面）

- `src/lib/accentVar.ts`：`applyAccent(color)` 写 **body + documentElement** 的 `--accent / --interactive-accent / --accent-on`；`accentOnColor()` 按亮度选黑/白（LIGHT_ON=#0a0a0a / DARK_ON=#ffffff）。**--interactive-accent 在 theme.css 零声明**（Grep 无匹配），只被内联写入——语义存疑的遗留，v2 改写 `--user-accent` 三件套时同步移除该死键。
- theme.css accent 声明位置：`:root` L37-38（#166a59/#ffffff）、`body.theme-dark` L202-203（#3fa08a/#0a0a0a）；派生档（--accent-soft/-hover/-pressed、--hl-multi、--text-primary/--text-helper）已在 body/body.theme-dark 重声明（求值层纪律 §5.1 落实到位）。
- 存储：默认皮肤沿用 **`app.accentColor`**；其他皮肤新键 **`app.accentBySkin`**（`Record<skinId,string>`）。
- 调用点：App.tsx L270-273（effect）、CaptureEditor.tsx L25-27（独立窗口）、SettingsPanel L2961。
- **测试契约**：`tests/accent.gui.mjs` 断言 `getComputedStyle(body).getPropertyValue("--accent")` ＝自定义色——读 computed value，`var(--user-accent, …)` 链展开后**断言不变**，预期零修改通过。

## 4. CSS 现状（P2-1 改造面）

- 入口：theme.css 被 `App.tsx` / `capture.tsx` / `workbench.tsx` 各 import 一次（三窗口共用）。
- theme.css：**无 `@import`、无 `@charset`**（首行是注释）；Token 声明在 `:root`（浅色全量）+ `body.theme-dark`（深色档）+ `body`（派生档重算 L279-320）；`!important` 共 **6 处**。
- 第三方 CSS：`katex/dist/katex.min.css`（Reader.tsx）、`pdfjs-dist/web/pdf_viewer.css`（reader/pdf/adapter.ts）——**TS 内按需 import，在 bundle 中位于 theme.css 之后**。
- **差异裁决（偏离方案 §2.10）**：第三方 CSS **不迁 vendor 层，保持无层 import 原样**。理由：① 无层样式恒高于任何 @layer，现状它们（后序）本就压过 theme.css 同特异性规则，保持原样 = 零视觉变化；迁 vendor 层反而让 base 层整体升到第三方之上（如 pdf_viewer 的元素级规则被 theme.css 反超），有真实视觉漂移风险。② theme.css 对 .katex/.pdfViewer 的覆盖规则均为高特异性（`.extract-face-body .katex` 等），方向本就成立。③ 皮肤 v1 无覆盖第三方组件的需求（skin 层低于无层第三方，可接受）。`src/styles/layers.css` 仍预注册 `@layer vendor, base, skin`（vendor 空置占位，供将来）。
- theme.css 内含 `@media` 嵌套块——`@layer base { … }` 包裹合法；d139 C4 的正则块解析不受影响（待 P2 实测确认）。

## 5. 事件总线

- `src/lib/eventbus.ts`（注意小写 b）：**白名单 + throw**（`ALLOWED_EVENTS` as const，17 个事件）。`on(event, fn) → () => void`、`emit(event, payload?)`。
- **P5 影响**：`ui/*` 事件必须先加入 `ALLOWED_EVENTS`（或扩 AppEvent 类型），否则 on/emit 直接 throw。这是纯表现层事件名登记，不涉业务事实。

## 6. 视图切换（差异裁决，偏离方案 §2.9.4）

- **App.tsx 已有完整 VT 基础设施（D120/D120-R2）**：`changeView`（L340-368）无条件调 `document.startViewTransition`（API 在场时），带 `data-vt`/`data-vt-dir`（fwd/bwd）闸门、`viewRef` 镜像、世代号防抖、flushSync、`finished.finally` 清理；theme.css L8049-8109 定义揭幕式动画（topbar/bg-activity Staging 排除、`prefers-reduced-motion` 双轨、降级瞬时）。
- **裁决：不新建 `withViewTransition`、不再包裹 changeView（双层 startViewTransition 会嵌套报错/丢闸门）**。P4-4「视图切换淡入上浮」由 **Claude CSS 直接覆盖 `::view-transition-old/new(root)` 动画**实现（`html[data-skin="claude"]` 前缀 + 写在 `prefers-reduced-motion: no-preference` 内 + motion-off 总开关兜底）。`viewTransitions` 清单字段仅作设置页标签与 `skin-vt` body 类开关。方案中的 `withViewTransition` 工具不再产出（RECON 登记）。
- 主视图切换点：App.tsx `changeView`（唯一跨视图入口，D120 立约）；ui/view-change 事件（P5）在 changeView 内发。

## 7. 动效 Token 与焦点规则

- 实存动效 Token（theme.css L143-176）：`--ease`(cubic-bezier(0.2,0,0.38,0.9))、`--dur`(120ms)、`--ease-out-soft`、`--spring`(cubic-bezier(0.34,1.56,0.64,1))、`--dur-hover/press/panel/stage/flip/tip-in/tip-out/exit/enter/view/chart/chart-in`、`--ease-enter/--ease-exit`、`--shift-xs/sm/md`。**无 `--dur-*` 之外的 spring 预设**——`--ease-spring-*` 四组与 `--dur-spring-*` 由皮肤自建（方案 §2.9.2）。
- Claude 需覆盖的动效 Token 全部实存：`--ease-out-soft`、`--dur-hover`、`--ease-enter/--dur-enter`、`--ease-exit/--dur-exit`、`--dur-view`、`--spring`。方案 §3.3 动效表与现状一致。
- 焦点：全局 `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`（L495-498）＝方案基线；另有 14 处局部 outline 覆盖（1px 档、offset 0/-2 等）。组件级 Token `--focus-outline-*` 迁移**只迁全局规则**，局部 1px 档保留（分类见 component-map）。
- 新增设置：`app.motionLevel`（"system" | "off"，默认 system）；body 三态类 `motion-full/reduced/off`。

## 8. 机器闸门影响（P0-9）

- `tests/flows/` 共 100+ 闸门；与样式相关的关键项：
  - **F09 表现层契约**（node 直跑）：扫描**全 src/ 的 .css/.ts/.tsx**。main 基线 **23/28，既有红 5 条**（与皮肤无关）：E1 IACVT（`--wb-main-w`/`--bg-1`/`--sans`/`--hairline`/`--mono` 5 个未定义）、E2 hardcodedHexFiles 超基线 6、E3 `!important` 超基线 3、E5 rawSvg 超基线 19、E6 `#002fa7` 断言（theme.css 已改深绿，GUIDE §5.1 文本未同步的陈旧断言）。**验收口径改为：与 main 同红集合 + 不新增**。F09 的 E1 扫描自动覆盖 src/skins/**（walk 全 src）✅。
  - F09 **L146 会破**：断言 accentVar.ts 含 `setProperty("--accent"` → P2-3 改 `--user-accent` 后同步闸门文本（合法范围 §1.3）。
  - F09 **E3 棘轮**：`motion-off` 总开关 +4 处 `!important` → 基线 JSON（tests/flows/fixtures/f09-presentation-baseline.json importantCount 3→7）受控更新。
  - F09 **E4 玻璃拟态禁令**扫全 src → P6 `_lab`（backdrop-filter）需豁免 `src/skins/_lab/`（扫描范围收窄 + D 号登记）。
  - F27 红线闸门：`cursor: not-allowed` 扫全 src（皮肤 CSS 自动纳管，好事）；`prefers-reduced-motion ≥2 处`（theme.css，不破坏）。
  - d139 C4 读 theme.css 源码做块解析断言过渡门控——@layer 包裹待 P2 实测（正则不嵌套配对，预期不破）。
  - plugins.gui.mjs [D]：D132 互斥测试（不改）。
  - accent.gui.mjs：预期零修改通过（见 §3）。
  - **皮肤 CSS 纪律**：不得出现 `cursor: not-allowed`；`!important` 只在无必要时不写；IACVT 差集为空（F09 E1 自动盯）。

## 9. GUIDE 治理面（P1）

- 版本头 L1：`# 一站式渐进阅读学习软件（**v48.123**）`→ 本次 bump **v49.0**（契约层级变更）。
- §8.1 决策日志末条 = **D168**（L1533）；新决策 **D169–D174** 顺延。四列表头：决策 | 内容（粗体标题段） | 来源 | 版本。
- §5.5 皮肤体系（L625-633）：「机制在场、皮肤为零」两句按方案 P1-3 改写；`--field-line`/`--band-line` 两段保留。
- §4.15 L404 皮肤条款：门禁改「评审 + skin-audit 机器审计」。
- §5.1 L570 仍写「全局主 accent 锁定 IKB 蓝 #002FA7」——陈旧文本（theme.css 已 #166a59 深绿），P1 顺带修正（E6 断言同步改）。
- swiss 文档：`docs/swiss-international-style.md` L320-339「皮肤层」一节（五条边界）→ 替换为作用域声明 + 指向 AUTHORING.md；L257/L260 禁止清单两处「皮肤层」括注同步。

## 10. 目录与命名预检

- `src/skins/` 下无 `skin-` 开头的 body 类消费者（theme.css 仅 `.skin-layer` 元素类，不冲突）。
- `docs/skins/` 当前不存在，新建。
- P0-11 基线截图：`tests/skin-baseline-shot.mjs`（CDP，1440×900 dpr1，8 视图 × 2 主题 → `tests/__skin-baseline__/`；__skin-* 被 gitignore、留磁盘，丢失重跑再生成）+ 种子 `tests/skin-baseline.seed.cjs`；对比器 `tests/lib/png-pixel-diff.mjs`（node:zlib 零依赖 PNG 解码逐像素，`--tol` 抗锯齿容忍 / `--skip` 人工核对面 / `--max-bad`）。
- **验收口径（P2/P3/P4 沿用）**：两轮独立运行实测——机器逐像素面 10 张（shelf/queue/review/browse/reader × 浅/深，tol=4 零硬差异）✅ 确定性通过；人工核对面 6 张（next/settings/stats × 浅/深——头部时间敏感文本 + stats canvas 重绘微差，每轮出对照图人工看）。

## 11. 风险预判（进入 P2 前确认）

1. `@layer base` 包裹后 d139 C4 / f09 文本解析类断言需实测（P2-8 全量回归覆盖）。
2. accent computed-value 链（body 内联 `--user-accent` → `:root`/`body.theme-dark` 的 `var(--user-accent, X)`）：computed 展开正确，但 **`getPropertyValue` 读 body 的 computed `--accent`**——body 自身无 `--accent` 声明（浅色）→ 继承自 :root（求值于 :root，读不到 body 内联的 --user-accent！）→ **陷阱**：内联必须同时写 :root 或把浅色 accent 声明移到 body。**裁决：theme.css 的 accent 声明从 :root 移到 body 规则（浅色档）/ body.theme-dark（深色档），:root 保留兜底字面值**——与方案 §2.8 示例一致（body 层声明），且 accentVar 内联写 body + documentElement 两处（现状已如此，documentElement 内联兜住 :root 继承路径）。P2-3 时 accent.gui.mjs 实测把关。
3. `has-skin` 透明规则改造后，旧值 `body.has-skin` 从 theme.css 删除——检查 tests 内 `has-skin` 断言（rg 结果：仅 App.tsx/theme.css，无测试引用）✅。
4. Claude 皮肤 `requiresChrome: 113` 对 Electron 31（Chromium 126）恒满足。
