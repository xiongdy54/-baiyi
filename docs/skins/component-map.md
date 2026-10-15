# 组件级 Token 分类表（component-map）

> v49.0 / D171。**类别 → theme.css 选择器**的唯一查询表，皮肤结构规则的选择器从这里复制。
> P3 迁移完成态（31 条规则）；默认值全部指向语义 Token＝默认皮肤逐像素不变（截图 10/10 实证）。

## 迁移统计（P3 实际落地）

| 类别 | Token（新） | 基线值 | 已迁移消费点数 | 代表选择器 |
| --- | --- | --- | --- | --- |
| 圆角-输入 | `--radius-input` | `var(--radius)` | 9 | `input, textarea` / `input[type="color"]` / `input[type="date"]` / `select` / `.form-field input, .form-field textarea` / `.accent-row input[type="color"]` / `.cb-search` / `.markdown-editor-compact` / `.cap-input` |
| 圆角-卡片 | `--radius-card` | `var(--radius)` | 5 | `.card-fill, .card-outlined, .card-accent, .card-ink` / `.card-marked` / `.card-marked-error` / `.skeleton` / `.bg-activity-card` |
| 圆角-控件 | `--radius-control` | `var(--radius)` | 10 | `.icon-btn` / `.btn` / `.shelf-seg`（含 `button`）/ `.act` / `.shelf-table .t-open` / `.dd-btn` / `.bg-activity-row` / `.bg-activity-btn` / `.topbar-wb` |
| 圆角-chip | `--radius-xs` | `var(--radius)` | 1 | `.dict-lang-chip` |
| 圆角-对话框 | `--radius-dialog` | `var(--radius-panel)` | 1 | `.modal-panel` |
| 圆角-弹层 | `--radius-popover` | `var(--radius-panel)` | 0（皮肤用） | theme.css 零消费 |
| 阴影-浮层 | `--shadow-popover` | `var(--shadow-float)` | 15 | `.settings-info-tip` / `.menu, .selection-menu` / `.annot-editor` / `.colorpop` / `.reader-toast` / `.image-focus-toolbar` / `.occlusion-editor-toolbar / -rail / -confirm` / `.model-dropdown` / `.dd-menu` / `.bg-activity.is-expanded .bg-activity-card` / `.extract-face-toolbar.is-float-pop` / `.md-tb-menu` / `.growth-toast` |
| 阴影-对话框 | `--shadow-dialog` | `var(--shadow-panel)` | 4 | `.modal-panel` / `.image-focus-imgbox` / `.occlusion-editor-imgbox` / `.source-peek` |
| 阴影-卡片 | `--shadow-card` | `none` | 0（皮肤用） | theme.css 零消费（默认皮肤零阴影） |
| 表面-弹层 | `--surface-overlay` | `var(--paper)` | 15 | 上列 13 条弹层阴影规则 + `.modal-panel` + `select option` |
| 表面-输入 | `--surface-input` | `var(--paper)` | 9 | 圆角-输入同清单 |
| 表面-顶栏 | `--surface-chrome` | `var(--paper)` | 1 | `.topbar` |
| 表面-卡片 | `--surface-card` | `var(--paper)` | 2 | `.card-outlined` / `.bg-activity-card` |
| 表面-填充卡 | `--surface-card-fill` | `var(--grey-1)` | 2 | `.card-fill` / `.skeleton` |
| 表面-页面底 | `--surface-canvas` | `var(--paper)` | 0（声明占位） | 语义 Token `--paper` 消费点未迁移（跟 `--paper` 走） |
| 焦点 | `--focus-outline-width / -color / -offset` | `2px / var(--accent) / 2px` | 1 | 全局 `:focus-visible` |
| 动效钩子 | `--press-scale` | `1` | 0（皮肤用） | D173 按压缩放 |

## 未迁移类别（皮肤经语义 Token 或结构规则处理）

- **描边（155+69 处）**：`--border-subtle`/`--border-strong` 是语义 Token，皮肤整组覆盖一枚即全应用生效（边界③）；`--border-card`/`--border-input` 组件 Token 已声明（基线同值），供皮肤结构规则直接引用，theme.css 消费点不迁移（收益/风险比不划算，D171 登记）。
- **页面底 `--surface-canvas`**：`--paper` 的其余 90+ 处 background 消费（书架、阅读器、面板等）不迁移——皮肤改 `--paper` 即整组生效；Claude 皮肤（D173）的页面底 = 奶油纸正走这条路径。
- **防御性 `border-radius: 0`**：圆角白名单纪律（D161/D167）不变——书卡直角等「永久直角」处零迁移，皮肤若要圆角须用自己的结构规则逐类处理。
- **不动的特殊形态**：`50%` 圆形、制卡坞 AI 胶囊 `999px`、书架文件夹 `--f-r` 族（D161 资产）。

## 需皮肤结构规则处理

- 阅读器内部（PDF/EPUB 内容面）、图表 canvas、`.book-card` 直角书封——组件 Token 不覆盖，皮肤需要时写结构规则（选择器以 `data-ui` 部件为准，D174 后）。
