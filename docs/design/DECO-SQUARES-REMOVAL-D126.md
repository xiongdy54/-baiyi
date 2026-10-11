# 装饰小方块退役与批注右缘色条（D126）

> 用户 2026-10-11 书面指令（逐字要点）：去掉软件中的小方块元素——空书架三个小方块、空摘录三个小方块、摘录页左上角「0 条待处理」左侧小方块、卡片页空状态三个小方块、书架无封面书左上角小方块、摘录侧边栏条目左侧小方块；去掉后若留不协调空白，相应调整文字位置；侧边栏条目小方块的改色功能改由**条目右侧的色条**承担，方式与样式按项目视觉设计（swiss-international-style）与动效规范（MOTION-DESIGN-SPEC）设计实现。

## 1. 范围盘点（以类名为准，全库 grep 核对）

| 元素 | 类名 | 出现处 | 处置 |
| --- | --- | --- | --- |
| 空态三方块装饰 | `.empty-deco` / `.empty-sq` / `.empty-sq-accent` | 书架、卡片浏览、摘录页、**复习页、仪表盘**（同族，一并退役保持一致） | JSX 与 CSS 全部移除；空态保留「一句话 + （既有按钮）」，块内仍是垂直居中列，无空白洞 |
| 摘录页计数方点 | `.count-dot` | ExtractReviewView 两处「N 条待处理」 | `<i>` 移除；`.extract-page .review-count` 的 `gap: --sp-2` 保留（数字与「条待处理」间距与改前一致），CSS 基类与摘录页规则退役 |
| 无封面书脊方块 | `.book-card-spine` | Bookshelf 四处（CoverImg 兜底 / wall bookFace / 文件夹卡内书目 / 目录表缩略图） | JSX 与 CSS 移除；无封面回落形态＝灰底 + 左下标题（标题位置不动——方块仅 8×8，移除不留空洞） |
| 批注条目方点 | `.mark-kind`（`data-annot-color`） | AnnotationPanel（摘录页批注轨 + 阅读器摘录侧栏共用） | 移除；改色入口改**右缘色条**（§2）；类型区分（R39 实心=摘录/空心=高亮）由 meta 行既有 `kind-tag`（「摘录」/「高亮」标签）独自承担 |
| 遗留死规则 | `.dot` / `.zitem.whole .dot` | theme.css（TSX 零消费） | 一并清除 |

不在本期范围（功能性状态点，非装饰）：`topbar-wb-dot`（制卡台开关状态）、`ai-status-dot`、`bg-activity-dot`、`occl-dot`（遮挡编辑把手）。

## 2. 右缘色条与条目选单 —— R4.1 定案（用户裁定：模仿 Zotero + 五点实测修正，2026-10-11）

> 状态：R1（8px 常驻条+下方色板）、R2（2px 细条+hover 变宽+色条簇）、五版竞稿（V-A~V-E）均被用户看实机否决；R4（Zotero 式首版）经实机截图反馈修正为 **R4.1**（唯一有效版本）。排版依据 better-layout / better-typography 两 Skill（组间 2× 组内节奏、控制件与内容区分、共享对齐缘、行高与截断规范）。

**结构**（`.zitem` 内，`position: relative` 仅作选单定位锚）：
- **引用式色线 `.zbar`**（R4.1 修正：不再通高、不再贴条目右缘）：挂在引文行 `.zbody-quote` 左侧——`display: flex` 行内 `[色线 2px][引文 .zq]`，色线 `align-self: stretch` 即**与引文块等高**（段锚＝原文两行、整卡＝一行），距条目左缘一个内距（引用的标准形态）；纯指示不可点（`aria-hidden`），`data-annot-color` 钩子保留作观测点；摘录/高亮类型仍由 `kind-tag` 承担（R39 口径不变）；条目不再画任何边线色条（基线 `border-left` 与摘录轨内规则一并退役，阅读器侧栏/摘录轨两处形态归一）；
- **⋯ 钮 `.zdots` 移入 meta 行右端**（R4.1 修正：不再绝对定位悬浮在引文上——实测遮字、且易与正文省略号混淆）：`margin-left: auto` 推到行尾、20×20 命中 + 14px `IconEllipsis`、**常显**（可发现性优先；hover 灰底表 control 与内容区分），`aria-haspopup="menu"` + `aria-expanded` 随开合；
- **弹出选单 `.zmenu.dd-menu`**：条件挂载，复用 dd-menu 族样式（paper + hairline + `--shadow-float` + `--z-dropdown`；行 = `.dd-item` fs-meta、hover `--grey-1`）与 §8.4 动效（pop-in 220ms `--spring` 存量豁免，origin 随 `dd-menu-up/down` 翻边）；**R4.2：`position: fixed` 视口定位**（top/right 由 ⋯ 钮下缘 +4px / 条目右缘 -8px 实测坐标内联注入，挂载后量选单实高翻边：下方放不下且上方放得下 → 向上开）——absolute 选单会被阅读器侧栏的轨 `overflow: hidden`（开合动画）与列表滚动容器 `overflow: auto` 裁切/盖住（条目靠可视区底部时实测，摘录页轨因测试条目居顶未暴露）；**选单开着时滚动/缩放即收单**（fixed 不随列表滚动，§8.4 popover 惯例）；R4.1 修正两处排版：**宽度随内容**（`width: max-content` + `min-width: 128px` + `max-width: min(280px, calc(100vw - 16px))` 防溢出——基线 `min-width: 100%` 曾拉满整栏、首版修正的 180px 下仍显宽）；**每行 14px ✓ 槽位对齐**——色行＝`[✓][12px 色块][中文名]`、动作行＝`[空槽][文字]`，动作文字与色块同缘对齐（Zotero 同构）；选单贴 ⋯ 钮右缘（`right: 8px`）；
  - **换色组**（仅段锚条目显示；整卡批注色恒为 `--accent`）：`role="menuitemradio"` + `aria-checked`，点行 `onColor` 落库收单；
  - **操作组**：`添加批注 / 编辑批注`（复用行内编辑）、`删除批注/高亮/摘录`（收单后行内「确认删除 / 取消」二次确认——§8.2 退路，确认态行内常显）；
- **条目排版节奏**（better-layout 2× 分组 + better-typography）：引文组内距 4px（`.zq` 下边距）、引文组→meta 组 8px（`.zmeta` margin-top `--sp-2`＝组内 2×）、**meta 行 `margin-bottom: 0`**（`<p>` 的 UA 默认 1em 曾在 meta 行下留 12px 成片空白——探针实测）；条目左右内距 12px（用户裁定左右留白稍大、与上下分布均匀），meta 行贴条目底部，上下对称；
- **退役**：R2 hover 改色/色条簇/行内色板、R4 首版的通高右缘色线与悬浮 ⋯ 全部移除；
- **动效**：选单开 220ms pop-in（§8.4 存量豁免）/ 收为条件卸载；行 hover 160ms；reduce 直切；`data-annot-color`/`data-annot-pick`/`data-annot-del*`/`data-zdots`/`data-zmenu` 钩子沿用于观测与测试。

> 本节即唯一实现依据（契约式：上列结构/动效参数与实现一一对应，实现后以几何探针 + 截图对版验收）。历史迭代（R1/R2/五版竞稿样张 `design-samples/annot-recolor-entry-d126-r3.html`、图集 `design-samples/recolor-gallery/`）仅作存档，不再生效。

## 3. 文字位置调整核对（用户指令第 2 条）

- 五处空态：`.empty-state` 本就是垂直居中列，装饰行移除后文案自然上移补位，无残留空洞——不需另调；
- 「N 条待处理」：方点移除后 `b` 与文本间距沿用既有 `gap: --sp-2`，视觉节距不变；
- 无封面书卡：标题本就左下对齐，方块移除不留洞；
- 批注条目：引文/批注文字随方点移除自然左移一格（8px + gap），行首对齐左竖线，无空洞。

## 4. 文档与测试同步

- `docs/swiss-international-style.md`「状态设计 · empty」行与「空状态」布局行：几何装饰退役，空态公式改为「一句话说明 +（主行动按 v48.15/D51 例外处理）」；
- `tests/flows/f09-presentation-contract.cjs` E7 空态判据同步（empty-text 在场、empty-deco 不在场 + 无封面骨架无 spine 源码判据）；
- `tests/annotations.gui.mjs`：改色观测点由条目竖线改为色条 computed background（左竖线在阅读器侧栏仍在、摘录页轨内已退役，统一切到色条口径）；色带开合断言按 R2 结构（is-open + 色带可见）；
- 新增 `tests/d126-deco-squares.gui.mjs`：空态无装饰、计数无方点、批注无方点有色条、粘贴导入无封面书无 spine；
- 摘录批注样张 `design-samples/annotation-two-modes.html` 为历史对版样张，条目结构以本稿为准（不回改样张）。

## 5. 验收标准（可机械检查）

1. `npm run build` 通过、`tsc --noEmit` 无错（本批已验证）；
2. 全库 grep：`empty-deco|empty-sq|count-dot|book-card-spine|mark-kind` 在 `src/` 零命中（theme.css 注释中的历史提法随块删除）；
3. `node tests/flows/f09-presentation-contract.cjs`、`node tests/d126-deco-squares.gui.mjs` 全绿（13/13）；`node tests/annotations.gui.mjs` 与 main 基线**逐项对照零新增失败**（本批 81/18 ＝ main 基线 81/18；既有失败集中在 EPUB 注解面板与 PDF 工具栏的旧断言/环境抖动，与本批无关——与本批相关的改色链路断言全绿）；
4. 不变量核对：零网络、零 schema、零 IPC、零设置键变更；不触碰调度真源。
