# 阅读字体统一开关（D243 / v49.72）

> 注：D245（v49.74）已把默认字体栈改为无衬线（Noto Sans SC 居首），并删除 D244 的强制专用栈。本文件 D243 / D244 两节保留当时记录，现行契约以 D245 修订节为准。

## 范围

修复两类“粗体衬线”来源，并给用户一个默认关闭的显式开关：

1. 默认字体栈首位命中 `Source Han Serif SC Heavy`：部分 Windows 只安装了思源的 Heavy 字面，没有常规字重；D242 移除系统宋体后，这个问题仍会让无书内字体的正文变粗。
2. EPUB 自带 publisher CSS 指定楷体、仿宋、宋体或 `font-weight: bold`：应用当前以零特异度 `:where()` 提供默认排版，出版方样式优先，D241/D242 的默认字体不会覆盖这些书。

不改变数据库、IPC、依赖、PDF 固定版式与显式自选字体的含义。

## 契约

### 默认字体栈

`DEFAULT_READER_FONT_STACK` 把 `Noto Serif SC` / `Noto Serif CJK SC` 放到 `Source Han Serif SC` / `Source Han Serif` 之前；日文、繁体中文、韩文的地区覆盖同样先 Noto 后思源。这样常规 400 会命中 Noto 的可变常规字重，而不是可能只有 Heavy 的思源字面。

### 新设置

`readerSettings.appearance.ignorePublisherFont`：boolean，默认 `false`。

- `false`：保持现状，出版方 CSS 的字族/字重优先。
- `true`：仅阅读 iframe 内对正文作用域强制应用字体与常规字重：
  - `body`：应用字体 + `font-weight: 400 !important`。
  - `p / div / span / a / li / dd / blockquote / figcaption / section / article / td / th / h1–h6 / strong / b / em / i / sup / sub`：`font-family: inherit !important`、`font-weight: inherit !important`。
  - `h1–h6 / th`：`font-weight: 600 !important`。
  - `strong / b`：`font-weight: 700 !important`。
  - `code / pre / kbd / samp`：等宽栈 + `font-weight: 400 !important`。
- 覆盖作用域同时挂 `html` 与 `body` 的 `data-d243-font-override` 属性，避免出版方 class 规则因特异度抢回字族/字重。
- PDF 引擎不消费该设置；控件在 PDF 下禁用并说明。
- 该开关覆盖的是“应用当前字体”（默认栈或用户显式字体）；不新增字体选择逻辑，也不改变字号、行距、段距、颜色与出版方布局。

## UI

- 阅读器“阅读设置 → 排版”：新增“忽略出版方字体”开关（PDF 禁用）。
- 设置页“阅读 → 阅读外观”：新增同名字段，与阅读器快捷菜单读写同一 `readerSettings.appearance.ignorePublisherFont`。
- 四语文案：简中为源键，繁中由既有 opencc 覆盖链生成，英/日补齐。

## 测试与验收

- `tests/reader.appearance.test.cjs`：默认栈顺序、`ignorePublisherFont` 严格归一（缺省 false，字符串 true 不生效）、resolve 输出；未开启时不生成强制字体 CSS，开启时生成完整覆盖规则。
- 既有 `d241-reader-motion`、`d242-reader-inertia`、`reader.personalization.gui`、`reader.paging.gui`、`reader.kernel.cjs` 回归。
- `npm run typecheck`、`npm run build`、`node scripts/i18n-check.mjs`、`npm run lint:consistency`。
- 真实书库不参与自动测试；手检以《连结》（书内 `.kfont` 楷体）与一本自带仿宋/楷体的书为准。

## D244 修订（v49.73）

用户 2026-10-27 指令：开启「忽略出版方字体」时，默认中文字体换成 Noto Sans SC 400 黑体。

- 新增 `DEFAULT_READER_FORCED_FONT_STACK`＝`"Noto Sans SC", "Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif`。Noto Sans SC 自带拉丁字形，中西文同族；其后依次是各平台黑体回退（未安装 Noto 时仍有稳定常规字重）。
- `injectAppearanceStyle`：仅当 `ignorePublisherFont === true` **且** `fontFamily` 仍为默认栈（`isDefaultStack`）时，`forcedPublisherFontCss` 的字体族改用该黑体栈；用户显式填写的字体不被替换。
- 400 字重仍由既有 `font-weight: 400 !important` 保证；标题 600、strong/b 700、code/pre 等宽规则不变。
- 开关关闭时的正文默认栈（衬线）与语言地区覆盖不变；作用域、PDF 不适用、存储与 UI 均不变。
- 验收：`tests/reader.appearance.test.cjs` 增 7 项——强制段落含 Noto Sans SC 黑体栈且不含宋体族、显式字体原样保留、关闭时仍为衬线默认栈、黑体栈首/末项与无宋体族。

## D245 修订（v49.74，取代 D244 的强制专用栈）

用户 2026-10-27 澄清：衬线看着累，默认中文字体应改无衬线；只要书内没有出版方指定的字体，就使用无衬线。

- `DEFAULT_READER_FONT_STACK` 整体改为黑体栈：`"Noto Sans SC", "Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif`（Noto Sans SC 有常规 400 可变档，且自带拉丁字形，中西文同族）。
- `LANG_FONT_OVERRIDES` 同步改黑体地区字形：日文 Noto Sans CJK JP / Noto Sans JP / 思源黑体 JP / 冬青黑体，繁体 Noto Sans CJK TC/HK / 思源黑体 TC / 苹方 TC / 微软正黑，韩文 Noto Sans CJK KR / 思源黑体 K / Apple SD Gothic Neo / Malgun Gothic。
- 生效语义不变：默认栈只兜底书没有表态的地方（出版方 `font-family` 仍优先）；`ignorePublisherFont` 才强制覆盖出版方字体并保持 400；显式自选字体、PDF、字号 / 行距 / 颜色全部不变。
- D244 引入的 `DEFAULT_READER_FORCED_FONT_STACK` 与 `injectAppearanceStyle` 里的替换分支删除——强制模式直接使用默认（已是黑体）栈。
- 设置页字体输入占位文案由「留空使用默认多语言衬线栈」改为「留空使用默认无衬线字体栈」，en / ja 同步。
- 验收：`tests/reader.appearance.test.cjs` 全过（默认栈快照改为黑体栈、首项 Noto Sans SC、纯黑体无宋体族、开关关闭与开启均无衬线、显式字体保留、D243 归一与 CSS 覆盖规则回归）。
- 既有 `d241-reader-motion`、`d242-reader-inertia`、`reader.personalization.gui`、`reader.paging.gui`、`reader.kernel.cjs` 回归。
- `npm run typecheck`、`npm run build`、`node scripts/i18n-check.mjs`、`npm run lint:consistency`。
- 真实书库不参与自动测试；手检以《连结》（书内 `.kfont` 楷体）与一本自带仿宋/楷体的书为准。
