# 皮肤作者指南（AUTHORING）

> 皮肤引擎 v2（v49.0 / D169–D174）的作者正本。写新皮肤或改皮肤 API 前先通读本文。
> 应用级不变量的契约登记在 `AI_DEVELOPMENT_GUIDE.md` §5.5 / §8.1（D169 起）；本文是操作层指南。

## 1. 应用级不变量（A1–A9，违反任何一条即不合格）

| # | 不变量 | 机器可查方式 |
| --- | --- | --- |
| A1 | **只改表现层**：不得改业务逻辑、数据、持久化格式（皮肤自己的设置项除外） | 代码评审 + 皮肤目录外无业务改动 |
| A2 | **纯本地**：CSS/JS 不得引用网络资源；资源随构建打包 | `skin-audit` 扫 `url(http`、`@import`、`fetch(` |
| A3 | **可读性**：正文三阶文字、accent 当文字、accent 底上的文字 ≥ 4.5:1；键盘焦点指示 ≥ 3:1 | `skin-audit` 计算对比度 |
| A4 | **明暗两档完整**：浅色里覆盖过的每个颜色 Token，深色里也必须覆盖 | `skin-audit` 比对两档 Token 集合 |
| A5 | **引用有效**：`var(--x)` 引用 − `--x:` 声明 = 空（IACVT） | F09 E1（扫全 src 含 `src/skins/**`）+ `skin-audit` |
| A6 | **动效可关闭**：系统 reduce 或应用内「关闭动画」（`body.motion-off`）时无任何非必要动画；无每秒闪烁 > 3 次 | `skin-audit` 检查动效规则都在 `body.motion-full` 作用域下 |
| A7 | **性能预算**：见 §7 | 性能录制 + `skin-audit` |
| A8 | **可完全卸载**：切回默认皮肤后无任何残留 | 切回后截图与基线逐像素一致 |
| A9 | **先规范后代码**：新增皮肤或扩展皮肤 API（`SKIN_API_VERSION` +1）先在 GUIDE 登记 D 号 + bump 版本 | 治理流程 |

## 2. CSS 层叠层纪律

全应用层序：`@layer vendor, base, skin`（`src/styles/layers.css` 预注册，必须最先加载）。

- `theme.css` 整体包裹在 `@layer base { … }` 中；第三方 CSS（katex / pdfjs）**保持无层 import 原样**（无层样式恒高于任何层；它们在 bundle 中位于 theme.css 之后，现状即依赖此序，改动有视觉漂移风险——RECON §4 裁决）。
- 皮肤 CSS 由 SkinHost 自动包裹 `@layer skin { … }`——**skin 层里的声明恒压过 base 层，与选择器权重无关**。皮肤**不需要**写 `body.skin-x .a .b .c` 来抢权重。
- 反之，**skin 层浅色块会压过 base 层深色值**：`body.skin-x { --paper: … }` 在深色模式下依然生效。因此皮肤覆盖的每个 Token **必须同时写** `body.skin-x.theme-dark { … }`（= A4）。
- 主题插件 `<style data-plugin-css>` 不在任何层里（优先级高于所有层）；它与皮肤互斥（D132 双槽），行为不变。

## 3. 求值层纪律（§5.1 同源）

1. `var()` 在**声明它的元素上**求值，然后把结果继承下去。**派生 Token 必须与它依赖的 Token 声明在同一元素上**——组件级 Token 一律写在 `body` 规则里（不是 `:root`）。
2. 引用未定义变量 → **整条声明作废**（IACVT）。皮肤自有 Token 必须在皮肤 CSS 里声明。
3. `body` 上重声明的派生档（`--accent-soft/-hover/-pressed`、`--text-primary`、`--text-helper`、`--hl-multi`、`--band-line` 等）会**自动跟随**皮肤改的 `--accent` / `--ink`——皮肤**不要**重复声明它们。

## 4. 引擎接口

### 4.1 目录与文件

```
src/skins/
  types.ts              # SkinManifest / SkinModule / SkinRuntimeContext / SKIN_API_VERSION
  index.ts              # SKINS 注册表 + loadSkin（带模块缓存）
  SkinHost.tsx          # 皮肤宿主唯一实现（样式注入/移除、body 类、背景/前景层、生命周期；主窗口 App 直挂，独立窗口经 WindowSkin——D210）
  WindowSkin.tsx        # 独立窗口外观挂载点（readAppearance 刷新 + settings:changed 跟随）
  runtime/motionLevel.ts
  runtime/readAppearance.ts # 窗口外观唯一读取面（主窗口与独立窗口共用；loadSkin 失败回落默认皮肤）
  runtime/spring.ts     # springEasing(stiffness, damping, mass) → linear() 缓动 + 时长
  <id>/
    manifest.ts         # SkinManifest
    index.ts            # export default { css }（?inline 导入）
    <id>.css            # 两档 Token + 结构规则 + 动效规则
    DESIGN.md           # 这支皮肤允许/不允许什么
```

### 4.2 SkinManifest 字段

| 字段 | 说明 |
| --- | --- |
| `id` | 小写字母/数字/短横线；默认皮肤固定 `"none"`（兼容持久化值与 D132 互斥） |
| `modes` | 内置皮肤必须 `["light","dark"]` |
| `chrome` | `solid` = body/顶栏保持实底；`transparent` = 清底色让背景层透出（控制 `body.skin-chrome-transparent`） |
| `accentPolicy` | `free` = 用户可自定义强调色（按皮肤记忆，D172）；`locked` = 隐藏设置页强调色行 |
| `defaultAccent` | `{light,dark}`，设置页「恢复默认」显示用；真正生效值写在皮肤 CSS |
| `preview` | `{light[],dark[]}` 3–5 个设置页预览色块 |
| `features.viewTransitions` | 声明用（body 类 `skin-vt`）；VT 动画由皮肤 CSS 覆盖 `::view-transition-*` 实现（D120 的 changeView 已在场，勿再包 startViewTransition） |
| `features.motion` | `"none" \| "subtle" \| "rich"`，设置页标签（皮肤未声明 `tagline` 时仍显示） |
| `tagline` | 可选；设置页皮肤卡名称后的气质短标（v49.15 / D188，SKIN_API_VERSION 2→3）；缺省回落动效标签 |
| `requiresChrome` | 最低 Chromium 版本，不满足时设置页置灰 |

### 4.3 SkinModule 与生命周期

- `css`：`import css from "./<id>.css?inline"`；宿主自动包裹 `@layer skin`。
- `Background` / `Overlay`：`ComponentType<{mode, motion}>`；宿主分别挂在 z-index:-1（`skin-layer`）与 `pointer-events:none` 顶层（`skin-overlay`）。装饰层必须 `aria-hidden`、不挡点击、`document.hidden` 或动效非 full 时停 rAF。
- `activate(ctx)`：JS 动效与订阅入口。`ctx.signal`（停用时 abort）——**所有监听必须传它**；`ctx.onUiEvent(type, handler)` 订阅 `ui/*` 事件（自动随停用取消）；`ctx.getMode()/getMotion()` 读当前明暗与动效等级。返回值（若为函数）作为 cleanup 调用。
- 皮肤模块异常（activate 抛错 / 层渲染抛错）→ ErrorBoundary + `onFail` 回落默认皮肤。

### 4.4 `ui/*` 事件（皮肤 API，D174；SKIN_API_VERSION 2）

| 事件 | 载荷 | 发出位置 |
| --- | --- | --- |
| `ui/view-change` | `{ from, to }` | 主视图切换（App.changeView） |
| `ui/overlay-open` / `ui/overlay-close` | `{ kind: "dialog" }` | useDialogA11y 挂载/卸载（全部模态） |
| `ui/review-flip` | `{}` | 复习卡片翻面（showBack 翻真） |
| `ui/review-grade` | `{ grade }` | 复习评分成功边界后 |
| `ui/session-complete` | `{ kind: "review" }` | 复习会话收口（sessionDone）；`"reading"` 发出点待批次 |
| `ui/card-created` | `{}` | cardsApi.create 成功（全建卡路径汇点） |

事件名常量在 `src/skins/runtime/uiEvents.ts`；eventBus 白名单（`src/lib/eventbus.ts` `ALLOWED_EVENTS`）同步登记。**新增事件必须 bump `SKIN_API_VERSION` 并登记 GUIDE D 号**。

### 4.5 `data-ui` 部件属性（公开选择器接口，D174；SKIN_API_VERSION 2）

皮肤结构规则**优先用 `[data-ui="…"]`**，不依赖 theme.css 内部类名（类名重构不破坏皮肤）。

**已挂载（P5 批次，20 处）**：`topbar`（App 顶栏）/ `view`（app-main）/ `sidebar`（设置导航）/ `shelf-item`（书卡容器）/ `card`（shelf-face 卡面）/ `card-interactive`（右下活动卡）/ `dialog`（modal-panel ×3）/ `menu`（dd-menu）/ `seg-tabs`（主题模式分段）/ `button-icon`（顶栏 4 钮）/ `button-primary`（添加材料）/ `review-card`（复习卡容器）/ `reader-surface`（阅读正文容器）/ `stage-bar`（摘录/卡片舞台栏）

**待后续批次**（claude.css 等皮肤暂以类名选择器消费）：`button-secondary` / `button-outline` / `input` / `popover` / `toast` / `tooltip` / `menu-item` / `card`（泛化到全部卡类）

新增部件属性 = 扩展皮肤 API → bump `SKIN_API_VERSION` + GUIDE 登记。

## 5. Token 体系与组件级 Token

三级：**原始色板 → 语义 Token（`--paper`/`--accent`…）→ 组件级 Token（`--surface-*`/`--radius-*`/`--shadow-*`…）**。

组件级 Token 声明于 `body` 规则（base 层），默认值全部指向现有语义 Token＝默认皮肤零变化：

| 类别 | Token | 基线值 |
| --- | --- | --- |
| 表面 | `--surface-canvas / -chrome / -card / -card-fill / -overlay / -input` | `var(--paper)` / `var(--paper)` / `var(--paper)` / `var(--grey-1)` / `var(--paper)` / `var(--paper)` |
| 圆角 | `--radius-xs / -control / -input / -card / -popover / -dialog` | `var(--radius)` ×4、`var(--radius-panel)` ×2 |
| 阴影 | `--shadow-card / -popover / -dialog` | `none` / `var(--shadow-float)` / `var(--shadow-panel)` |
| 描边 | `--border-card / -input` | `var(--border-subtle)` / `var(--border-strong)` |
| 焦点 | `--focus-outline-width / -color / -offset` | `2px` / `var(--accent)` / `2px` |
| 动效钩子 | `--press-scale` | `1`（基线零消费） |

皮肤覆盖组件级 Token 而非散改消费点；「哪个类别覆盖哪些选择器」查 `docs/skins/component-map.md`。**需皮肤结构规则处理**（该位置已有状态 box-shadow / 特殊结构）的例外也登记在那张表里。

质量规则（应用级）：换纸色必须**整组换灰阶**（`--grey-1/2/3`、`--border-*`、`--text-*`、`--text-placeholder`）；自带色注册 `--skin-*` 并两档各声明一次；改 `--accent` 必配 `--accent-on` 且对比度达标。

## 6. 动效

- **动效等级**：`app.motionLevel`（`"system"` \| `"off"`）→ body 三态类 `motion-full` / `motion-reduced` / `motion-off`（SkinHost/App/WindowSkin 管理——D210）。`body.motion-off *` 总开关（base 层 `!important`）压过一切。
- **皮肤纪律（A6）**：所有非必要动效（hover 位移/阴影、按压缩放、弹簧入场、视图切换、装饰动画）的选择器**必须挂在 `body.motion-full` 下**。`::view-transition-*` 规则例外（JS 侧已做等级判断 + motion-off 总开关兜底），但 reduce 降级请写在 `@media (prefers-reduced-motion: reduce)` 内对齐基线做法。
- **弹簧曲线**：`springEasing(stiffness, damping, mass)` 把弹簧物理采样成 CSS `linear()`（Chromium 113+）。四预设（scripts/gen-spring.mjs 预计算）：
  - SNAPPY 320/28 → 500ms（弹层、下拉、对话框、折叠展开）
  - BOUNCY 600/30 → 460ms（按钮/开关/图标按压回弹）
  - GENTLE 380/18 → 800ms（愉悦反馈）
  - HEAVY_SNAP 1200/80/0.1 → 460ms（拖拽吸附、抽屉、分栏）
  弹簧缓动**只用于 transform / opacity**，不要用于颜色。
- **JS 动效**：浏览器原生 `element.animate()`（WAAPI）+ `springEasing()` 结果；**不引入动画库**。
- `@keyframes` 名必须以 `skin-<id>-` 开头。

## 7. 性能预算（A7）

| 项 | 预算 |
| --- | --- |
| 持续动画 | 只动 `transform` / `opacity` / canvas；不得持续动画 box-shadow、filter、backdrop-filter、布局属性 |
| `backdrop-filter` | 同屏 ≤ 3 个元素；不得用在阅读正文滚动容器上 |
| 装饰层 canvas | DPR 上限 1.5；`document.hidden` 或动效非 full 时停止 rAF |
| 阅读视图滚动 | 皮肤激活后无 > 16ms 长帧可归因于皮肤（Performance 录 10 秒） |
| 皮肤体积 | 单皮肤 CSS ≤ 60KB；JS chunk ≤ 150KB（gzip 前）；懒加载不进主包 |
| 视图过渡 | 总时长 ≤ 300ms |

## 8. 新皮肤检查清单（附录 B）

1. 在 GUIDE 登记 D 号并 bump 版本（A9）。
2. 新建 `src/skins/<id>/`：`manifest.ts`、`index.ts`、`<id>.css`、`DESIGN.md`。
3. Token：浅色块 + 深色块（A4）；换纸色整组换灰阶；自带色注册 `--skin-*`；改 accent 必配 accent-on（A3）。
4. 结构规则优先 `[data-ui="…"]`；颜色只引用 Token（自有值先注册）。
5. 动效全在 `body.motion-full` 下；`@keyframes` 以 `skin-<id>-` 开头；只持续动画 transform/opacity（A6/A7）。
6. 需要 JS：`activate(ctx)` + 全部监听传 `ctx.signal`；背景/前景层 `aria-hidden`、不挡点击、隐藏时停 rAF。
7. `node scripts/skin-audit.mjs` 通过；`node tests/skin-baseline-shot.mjs tests/__skin-<id>__` 截 8 页 × 浅/深；`node tests/lib/png-pixel-diff.mjs tests/__skin-baseline__ tests/__skin-<id>__ --skip=next,settings,stats` 核对（皮肤轮应全差异=预期，人工看图）；切回默认确认无残留（diff 应 10/10 相同）；跑全量测试。
8. 验收线：F09 与 main 同红集合不新增；accent.gui.mjs 全绿；`tsc --noEmit` / `npm run build` 0。
