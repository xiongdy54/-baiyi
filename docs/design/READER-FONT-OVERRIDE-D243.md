# 阅读字体统一开关（D243 / v49.72）

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
