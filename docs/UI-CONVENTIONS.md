# UI 约定（UI-CONVENTIONS）

> 与 `docs/EDIT-CONTRACT.md` 并列的交互/视觉约定登记处（EDIT-CONTRACT 管「编辑用户内容」的行为契约，
> 本文件管其余 UI 交互约定）。机器强制点在每节标明；改约定先改这里再动代码。

## 悬停显形（reveal-on-hover）· C-36

**问题**：只在鼠标悬停时出现的操作，在触屏上找不到——手指轻点会先触发整行自身的点击动作，
同时才"顺带"产生悬停状态（审计报告 C-36 / U-23）。

**约定**：凡是「非悬停态隐藏（opacity: 0 或 pointer-events: none）、悬停/聚焦才出现」的可操作控件，
显形一律走 `src/theme.css` 的「悬停显形工具类」节，**不得**再手写 `opacity: 0` + `:hover { opacity: 1 }`：

1. **TSX**：给该控件元素挂 `reveal-on-hover` 类（可与其他类并存）。
2. **CSS**：不写任何自己的 opacity/显形规则；隐藏态（`opacity:0; pointer-events:none`）、
   显形链、触屏常显、motion-full 过渡全部由工具类提供：
   - 鼠标设备：`:is(:hover, :focus-within) > .reveal-on-hover`（父级）／`> * > .reveal-on-hover`（祖父级）
     或 `.reveal-on-hover:focus-visible`（自身键盘聚焦）时显示；
   - 触屏设备：`@media (hover: none), (pointer: coarse)` 下常显（＝触控替代）；
   - 过渡：仅 `prefers-reduced-motion: no-preference` + `body.motion-full`（C-32 三态纪律）。
3. **写法二选一（全仓统一）**：控件离"行"元素 ≤ 两层（父/祖父）→ 直接用工具类显形链（默认写法）；
   超过两层 → 在行元素上加 `reveal-scope` 类，走 `.reveal-scope:is(:hover, :focus-within) .reveal-on-hover`
   变体。同一组件内不得混用两种写法；能用默认写法就不用 scope 变体。
4. **强制显示态**：如确认删除态这类必须常显的变体，用独立的 `-show` 类在工具类之后覆盖
   `{ opacity: 1; pointer-events: auto; }`（参照 `.reader-theme-manage-actions-show`）。

**机器强制**：`npm run lint:consistency`（scripts/consistency-check.mjs）规则 7——`:hover` 里把
`opacity` 设为 1 的规则，目标类必须是 `.reveal-on-hover`；基线 `hoverOpacityCount` 硬 0
（C-36 起收紧，只许保持）。脚本顶部 `REVEAL_ALLOW` 三条存量豁免（`.annot-acts` / `.reader-tap-hint` /
`.chart-dot`）各附证据，**扩豁免须先在本文件登记理由**。

**命中区**：`@media (pointer: coarse)` 下 `.zdots`、`.icon-btn` 最小 44×44 px（只扩大命中区，不改图标大小）。
新增触屏可达的小控件按 Apple HIG 44pt / Material 48dp 校核。

**存量豁免证据（REVEAL_ALLOW，2026-10-25 C-36 逐条核查）**：

| 选择器 | 非悬停基础态 | 豁免理由 |
|---|---|---|
| `.annot-side .zitem:hover .annot-acts` | `opacity: 0`（theme.css `.annot-acts`） | 报告 C-36 证据段原文判定「没有问题」：删除确认态有 `.zitem.confirming .annot-acts { opacity: 1 }` 常显兜底；控件改造属 U-23 触屏走查范围外 |
| `.reader-tap-zone:hover .reader-tap-hint` | `opacity: 0; pointer-events: none` | 非操作控件——装饰性翻页 chevron 提示（本体不可点），操作本体＝翻页热区常在常可点；报告证据清单只列可操作控件 |
| `.chart-svg:hover .chart-dot` | `opacity: 0`（仅在 `@media (hover: hover)` 内） | 已有触控替代——基础态与显形规则整体包在 `(hover: hover)` 内，无 hover 能力时数据点常显（theme.css 该块注释自证）；图表 hover-dim 强调效果，非可操作控件 |
