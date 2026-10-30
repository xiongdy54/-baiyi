# 结构全景（Structure Atlas）v2——按结构类型专门排布的二维结构画布 + 随文结构无缝衔接 + 入口调整（D254）

> 状态：设计定稿 **v2**（2026-10-31，用户第二轮意见后重写；v1「横向分栏 + 每栏一列扁平层级」作废，提交 18f42d1 里的 v1 内容一律以本文为准）。
> 实施者：其他 AI Agent。**本文的常量、公式、参考代码就是定稿，不要自行"优化"、换算法或改时长。**参考代码是 TypeScript 伪实现级别——字段名、分支、数值照抄；类型细节与现有代码冲突时以现有类型为准，但不得改变行为。
> 本文没写到的现有代码细节：先 grep 现有实现，照抄它的写法。行号以 2026-10-31 `main`（d610655）为准，可能有几行偏差。
> 取代：`MINDMAP-SIDEBAR-TAB.md`（D84 侧栏「图谱」页签）与 `MINDMAP-V2-IMPL-PLAN.md` 中 `MindmapCanvasV2` 作为完整图谱画布的部分。
> 不动：AI 提示词、解析器、引擎、IPC、数据库表、设置键；`src/lib/mindmap/v2/*` 保留（只给「导出 SVG」用）。
> 版本号：v49.88（v49.87 已被 D255 使用）。

---

## 0. 用户要求 → 定稿

| # | 用户要求 | 定稿 |
|---|---|---|
| R1 | 完整结构图要和随文结构一样丝滑优雅 | 同一套视觉语言：阅读底色、无卡片无框、8 色板 + 单一强调色、彩色竖条 + 排版层级、Sankey 流带、阅读节点主题色 pill；同一套 Token 与缓动曲线。§12、§13 |
| R2 | 侧边结构图是空间限制下的妥协；全景是无限画布，**不要一列一列地排**，要按结构类型用**专门、精致、一眼看清**的方式排布，**不千篇一律**；一列/一行若确是最佳方式也可以用 | 全景是**二维组合布局**：每个「组」（一个父节点 + 它的子节点）按它的结构类型用专门的排布，组与组**嵌套组合**成整张图（§2、§4）：<br>**大纲** → 横向 Sankey 扇形树（篇幅决定流带粗细）；<br>**并列** → 网格瓷砖；<br>**论证** → 自上而下的论证图：主张在顶，理由/证据按支撑关系分层，**一个证据同时支撑多个理由时就画多条线汇聚，不重复、不硬塞进单一父子**；反方与反驳单独在右侧「反方一侧」区；<br>**时间线** → 横向比例时间轴，事件上下交错、长断层压缩、带刻度；<br>**步骤** → 编号圆点 + 箭头，超过 5 步蛇形折返；<br>**因果** → 自左向右的分层有向图（交叉最少化），像瀑布一样从因流向果；<br>**对照** → 真正的对照表：每个对象一栏、每个维度一行。<br>组内版式没有表达到的关系（跨组印证、反驳……）用带关系码的弧线画出，悬停 / 选中时连到另一端。 |
| R3 | 在随文结构中选中节点 → 「在完整图谱中打开」→ 该节点丝滑移到中心，完整图谱以它为中心展开 | 共享元素过渡（FLIP）：点击瞬间拍下随文结构每一行的屏幕位置；全景首帧把这些节点画在原处，420ms 滑到它们在二维结构里的位置（选中节点到正中），其余节点按「离焦点的结构距离」由近及远展开。§9 |
| R4 | 「图谱」移出侧栏，固定在阅读界面左上角，独立按钮 | 新按钮 `.reader-atlas-toggle` 固定在「展开/收起」侧栏开关右侧（left 64px，top 56px，高 24）。§10.2 |
| R5 | 点击直接进入，进入后按钮位置不变 | `position: fixed`；两态文字叠放在同一格，宽度＝较宽者，换态不改位置与宽度。§10.2、§13 |
| R6 | 再次点击返回，文字变化以区分状态 | 「结构全景」↔「返回阅读」，图谱态点亮（accent 描边 + accent-soft 底）。§1 |
| R7 | 进入时不再展开侧栏 | 全景铺满正文视口，不改 `sidebarOpen`。§10 |
| R8 | 原侧栏「图谱」页签内容拆到顶部工具栏 | 图谱态时同一条工具带换成全景工具栏：面包屑 · 状态 · 搜索 · 生成▾ · 版本▾ · 视图▾ · 缩放 · 居中。节点详情改为焦点节点下方的浮动「节点卡」。§6、§7 |
| R9 | 阅读界面里「完整图谱」「结构图」按钮文字改得更合适 | 左上「结构全景 / 返回阅读」；右侧「结构图」→「随文结构」；随文结构动作行「在完整图谱中打开」→「在结构全景中查看」。§1 |

---

## 1. 命名与文案（`src/i18n/locales/en.ts`、`ja.ts` 都要加；旧 key 保留不删）

| 位置 | zh（源 key） | en | ja |
|---|---|---|---|
| 左上按钮·阅读态 | 结构全景 | Overview | 構造全景 |
| 左上按钮·图谱态 | 返回阅读 | Back to text | 本文に戻る |
| 左上 title·阅读态 | 结构全景：整本材料的结构，以正在读的位置为中心展开 | Overview: the whole structure, centered on where you are reading | 構造全景：読んでいる位置を中心に全体の構造を表示 |
| 左上 title·图谱态 | 返回阅读（Esc） | Back to text (Esc) | 本文に戻る（Esc） |
| 右侧开关 | 随文结构 | Inline structure | 本文の構造 |
| 右侧 title·关 | 随文结构：在正文右侧显示正在读的这一段所在的结构 | Inline structure: show the structure around the passage you are reading | 本文の構造：読んでいる段落の構造を本文の右に表示 |
| 右侧 title·开 | 收起随文结构 | Hide inline structure | 本文の構造を閉じる |
| 随文结构动作行 | 在结构全景中查看 | View in overview | 全景で見る |
| 返回原处 | ↩ 回到刚才的位置 | ↩ Back to where I was | ↩ 元の位置へ |
| 根节点副标题 | 全文 · {n} 节 | Whole text · {n} parts | 全体 · {n} 節 |
| 节点卡 | 制卡 / 详情 / 收起详情 / 展开结构 / 收起结构 | Cards / Details / Hide details / Show structure / Hide structure | カード / 詳細 / 詳細を閉じる / 構造を表示 / 構造を閉じる |
| 工具栏 | 生成 / 版本 / 视图 / 居中 / 显示全部关系 / 搜索标题 / 讲解 / 全部展开到第 2 层 / 只看焦点附近 | Generate / Versions / View / Center / Show all relations / Search titles / explanations / Expand to level 2 / Only near focus | 生成 / バージョン / 表示 / 中央へ / すべての関係を表示 / タイトル・解説を検索 / 第2階層まで展開 / フォーカス周辺のみ |
| 状态 | 已停止 | Stopped | 停止しました |
| 空态 | 生成导图后可以继续深挖 | Generate the map to deepen further | マップを生成すると掘り下げられます |

**直接复用的已有 key（不要新建同义 key）**：`另 {n} 项`、`反方一侧`、`其他`、`展开 {n} 个子节点`、`收起 {n} 个子节点`、`生成导图`、`重新生成`、`停止`、`停止深挖`、`深挖全部（{n} 个可深挖节点）`、`忽略缓存重新分析（每段都会实际调用）`、`发送前预览：…`、`模型：…`、`预计调用 …`、`历史版本`、`删除`、`删除此版本`、`（当前）`、`导出 SVG`、`跳到原文`、`讲解`、`收起讲解`、`深挖`、`本节点 {rel} → {title}`、`{title} {rel} → 本节点`、`排列方式`、`自动`、`查看对应原文（{n} 字）`、`收起原文`、`仍要尝试深挖`、`已有 {n} 张卡`、`知识点已存在`、`正在读取原文 {i}/{n}`、`AI 未配置`、`正在加载…`、`正在生成…`、`已触底：没有更深的结构`、`关闭提示`、各版式名（`PATTERN_LABEL` 的值）。`npm run i18n:check` 必须 0 缺失。

---

## 2. 形态

### 2.1 整体

整张材料是一棵「组」的嵌套：根组（材料 → 各章）→ 章组（章 → 各节）→ …。**每个组按自己的版式排成一个矩形「块」，块再作为一个整体被它的父组按父组的版式摆放。**于是同一张图里，书的骨架可能是一棵横向扇形树，某一章是一条时间线，时间线上的某个事件下面挂着一张小论证图，论证图里的某个理由又展开成三步推导——每一处都是那一种结构最清楚的画法。

```
                                                     ┌ 第二章 · 论证 ──────────────────────────────┐
 ▌全书标题 ═══╗                                      │            ▌ 动物化的后现代  论点            │
 全文 · 6 节   ╠══▶ ▌ 第一章 从故事到数据库  +4       │           ↗        ↑        ↖                │  ┆ 反方一侧        │
              ╠══▶ ▌ 第二章 动物化的后现代 ══════▶  │  ▌数据库消费  ▌大叙事凋零  ▌拟像增殖        │  ▒ 叙事仍然在场  │
              ╠══▶ ▌ 第三章 超平面          +3       │      ↑   ↖   ↗   ↑                           │     ⊥            │
              ╚══▶ ▌ 第四章 …              +2        │  ┆绫波丽被拆解  ┆萌要素数据库（同时支撑两条）│  ▌ 但叙事已退化  │
                                                     └──────────────────────────────────────────────┘
  ↑ 根组：大纲 → 扇形树（流带粗细 ∝ 篇幅）            ↑ 第二章：论证 → 主张在顶、按支撑关系分层；一个证据支撑两个理由＝两条线汇聚
```

时间线组：
```
           1945.8 日本投降          1950 朝鲜战争            ┆           1978 改革开放
               │                       │                   // （断层）       │
 ▌二十世纪 ┄┄┄●━━━━━━━━━━━━━━━●━━━━━━━━━━━━━━━━━━━━━━━━━━●━━━━━━━━━━━━━━━━━●━━━━━
 中国 · 时间线        │        1940      │         1960                            │
                1949 新中国成立      1958 大跃进                              1992 南方谈话
```

步骤组（>5 步蛇形折返）：
```
 ▌制备流程 · 步骤
   ①──────▶②──────▶③──────▶④──────▶⑤ ╮
   称量     溶解     过滤     蒸发     结晶 │
                                           │
   ⑨◀──────⑧◀──────⑦◀──────⑥ ◀──────────╯
   包装     检验     干燥     洗涤
```

因果组（自左向右分层有向图）：
```
 ▌危机成因 · 因果
   ▌信贷宽松 ──▶ ▌房价上涨 ─┐
                             ├──▶ ▌次贷违约 ──▶ ▌银行倒闭
   ▌监管缺位 ──▶ ▌衍生品泛滥 ┘                  ▲
                └──────────────────────────────┘
```

对照组（对照表）：
```
 ▌两种消费观 · 对照
              ▀▀▀▀▀▀▀▀▀▀▀▀      ▀▀▀▀▀▀▀▀▀▀▀▀
              故事消费   ●——●   数据库消费
   目的       追问作品背后       即时取用情感素材
   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   ← 隔行极淡底色
   路径       穿过作品抵达叙事   直接面向数据库
   姿态       读者               动物化的消费者
```

并列组（网格瓷砖）：
```
 ▌五种萌要素 · 并列
 ──
 ▔▔▔▔▔▔▔▔▔▔▔   ▔▔▔▔▔▔▔▔▔▔▔   ▔▔▔▔▔▔▔▔▔▔▔
 猫耳            呆毛            女仆装
 ▔▔▔▔▔▔▔▔▔▔▔   ▔▔▔▔▔▔▔▔▔▔▔
 双马尾          眼镜
```

### 2.2 浏览模型

- **一次只展开一部分**：默认展开「根 → 焦点」整条路径、焦点本身，再按广度优先把浅层展开到约 160 个可见节点为止（§4.10）；其余有子节点的节点显示「+N」。点「+N」展开/收起；**点节点标题＝聚焦**（相机 420ms 滑到它、同时自动展开它）。
- **相机**：可拖动平移、Ctrl/⌘ + 滚轮缩放、普通滚轮上下平移；展开/收起/聚焦时节点与相机在**同一时钟**（420ms，同一曲线）一起移动，焦点在屏幕上走一条平滑的直线到中心，不会先跳后滑。
- **关系透视**：悬停一个节点 250ms，图上与它无关的节点淡到 28%，它的父、子、所有关系的另一端保持实色，跨组关系弧线全部出现——一眼看清「谁支撑它、它支撑谁」。
- **节点卡**：焦点节点下方 8px 浮出一张小卡（跳到原文 · 讲解 · 深挖 · 制卡 · 详情；讲解与详情在卡内展开）。

---

## 3. 文件清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/lib/flow/atlasLayout.ts` | **新增** | 纯模块：常量 / 类型 / 字形 / 组合框架 / 七种版式 / 展开集 / 结构距离 / 跨组关系 / 空间导航 / 快照映射（§4，参考代码照抄） |
| `src/components/reader/atlas/AtlasStage.tsx` | **新增** | 画布：相机、渲染、进出场、裁剪、悬停透视、键盘（§5） |
| `src/components/reader/atlas/AtlasCard.tsx` | **新增** | 焦点节点卡（§6） |
| `src/components/reader/atlas/AtlasToolbar.tsx` | **新增** | 顶部工具栏（§7） |
| `src/components/reader/atlas/handoff.ts` | **新增** | 随文结构快照 + 克隆幽灵层（§9.2） |
| `src/components/reader/atlas/useThrottled.ts` | **新增** | 节流值 hook（§5.3） |
| `src/components/reader/MindmapTab.tsx` | **重写渲染部分** | 数据逻辑保留；删侧栏面板与 `MindmapCanvasV2`；portal 渲染 Toolbar + Stage（§8） |
| `src/lib/mindmapV2.ts` | 改 | `load` 结果缓存 + `peekLoad()`（§8.4） |
| `src/components/reader/flow/FlowLayer.tsx` | 改 1 处 | 动作行文案（§9.4） |
| `src/components/reader/flow/StructureFlowHost.tsx` | 改 | 导出 `resolveColors`；`coverMode="handoff"` 瞬时交接（§9.3） |
| `src/components/Reader.tsx` | 改 | 左上按钮、全景状态机、工具栏/画布宿主、返回原处钮、删图谱页签接线（§10） |
| `src/components/reader/ReaderSidebar.tsx` | 改 | 删「图谱」页签（§11） |
| `src/theme.css` | 改 | 新增「结构全景」节；两处左让位（§13） |
| `src/i18n/locales/en.ts`、`ja.ts` | 改 | §1 |
| `tests/atlas.layout.test.cjs` | **新增** | §16.1 |
| `tests/atlas.dom.test.cjs` | **新增** | §16.2 |
| `tests/m15v2.tab.dom.test.cjs` | 改写 | §16.3 |
| `tests/flow.dom.test.cjs` | 增断言 | §16.4 |
| `AI_DEVELOPMENT_GUIDE.md` | 登记 | §18 |

**保留不删**：`MindmapCanvasV2.tsx`、`NodeDetailV2.tsx`（不再被 import；其单测照常跑）、`src/lib/mindmap/v2/*`、`theme.css` 里 `.mindmap-*` / `.mm2-*` 旧样式。

**仓库闸门**（`scripts/consistency-check.mjs`，必须遵守）：TS/TSX 不新增内联 `<svg` 字面量（用 `FlowLayer.tsx` 导出的 `SvgRoot`——把那里的 `const SvgRoot` 改为 `export const SvgRoot`，这是对 FlowLayer 的第 2 处改动）；不新增 `!important`；新文件无十六进制颜色字面量（颜色一律来自 `FlowColors` 或 CSS 变量）；含 `e.key === "Enter"` 的文件必须 `import { isImeComposing }` 并在键盘处理首行判断。新文件不得放进 `src/lib/mindmap/` 或 `src/components/reader/mindmap/`（那是「时长不许写死」作用域）。全部时长集中在 `ATLAS_T`。

---

## 4. 纯模块 `src/lib/flow/atlasLayout.ts`

### 4.1 常量

```ts
// 结构全景（D254 v2）纯模块。设计 docs/design/STRUCTURE-ATLAS-D254.md §4。纯函数、确定性、无 DOM。
import type { GraphState, RelCode } from "../mindmap/v2/types";
import { ROOT_ID } from "../mindmap/v2/types";
import { ancestors, childrenOf } from "../mindmap/v2/graph";
import { REL_STYLE } from "../mindmap/v2/route";
import type { FlowColors, FlowPattern } from "./types";
import { compareTable, parseTime, patternFor, textW, tierOf, wrapLabel } from "./layout";

export const AL = {
  // 字形
  PAD_X: 12, PAD_R: 8, PAD_Y: 4, META_H: 15, TIME_H: 15, MIN_W: 64,
  // 大纲 · 扇形树
  FAN_GAP: 72, FAN_VGAP: 10, FAN_VGAP_BLOCK: 26,
  // 并列 · 网格
  GRID_TILE_W: 184, GRID_GX: 16, GRID_GY: 20, GRID_MAXCOLS: 4, HEAD_GAP: 16,
  // 论证
  ARG_GX: 28, ARG_GY: 64, ARG_COUNTER_GAP: 56, ARG_ZONE_PAD: 16, ARG_ROUNDS: 2,
  // 时间线
  TL_W_PER: 150, TL_W_MIN: 480, TL_W_MAX: 2400, TL_SLOT: 172, TL_MIN_DX: 28, TL_BREAK_K: 4, TL_BREAK_W: 72,
  TL_STEM: 30, TL_LANE_GAP: 12, TL_LANE_GAPX: 16, TL_LABEL_DX: 8, TL_DOT_R: 5, TL_HEAD_GAP: 40,
  // 步骤
  CH_R: 12, CH_ROW_MAX: 5, CH_GX: 40, CH_GY: 48, CH_LABEL_GAP: 10, CH_TURN: 40,
  // 因果
  LY_GX: 96, LY_GY: 18, LY_ROUNDS: 4,
  // 对照
  CMP_DIM_W: 96, CMP_COL_W: 200, CMP_GX: 12, CMP_ROW_PAD: 10, CMP_ROW_MIN: 32, CMP_MAX_DIMS: 6,
  // 规模
  MORE_MAX: 24, MORE_SHOW: 18, BIG_GROUP: 40, BUDGET: 160, HOP_CAP: 8,
} as const;

/** 全部时长（ms）。CSS 同名值写在 theme.css「结构全景」节，两处必须一致。 */
export const ATLAS_T = {
  MOVE: 420,                       // 一切几何移动 + 相机（同一时钟、同一曲线 --flow-ease）
  FADE_IN: 240, FADE_OUT: 160, REMOVE: 200,
  ENTER_DELAY: 180,                // 展开：新节点在既有节点开始移动后 180ms 出现
  ENTER_STEP: 18, ENTER_CAP: 200,  // 展开：同批新节点按序错开
  EDGE_DELAY: 120,                 // 边比两端节点晚出现
  BG_IN: 240, BG_OUT: 200, BG_OUT_DELAY: 120,
  HOP_BUTTON0: 60, HOP_BUTTON: 50, // 按钮进入：延迟 = 60 + hop × 50
  HOP_HANDOFF0: 300, HOP_HANDOFF: 60, // 交接进入：延迟 = 300 + hop × 60（hop ≥ 1）
  HOP_EXIT: 25, EXIT_DONE: 440,    // 退场：延迟 = (HOP_CAP − hop) × 25；440 后 onExited
  GHOST_LAYER_OUT: 160, GHOST_BLEND_OUT: 200, GHOST_REMOVE: 220,
  HANDOFF_RESET: 280,
  HOVER_DWELL: 250, HOVER_CLEAR: 200,
  CARD_DELAY_HANDOFF: 460, CARD_DELAY_BUTTON: 320,
  WHEEL_IDLE: 160, CULL_THROTTLE: 100, LAYOUT_THROTTLE: 250, LOCATE_TIMEOUT: 600,
  REDUCED: 120,
} as const;

export const CAM = { CENTER_Y: 0.45, ZOOM_MIN: 0.3, ZOOM_MAX: 1.8, ZOOM_STEP: 1.1, PAN_MARGIN: 160, CULL_PAD: 600, LOD_ZOOM: 0.5, DRAG_SLOP: 4 } as const;
```

### 4.2 类型

```ts
export type GlyphKind = "root" | "claim" | "plate" | "tile" | "event" | "step" | "colhead" | "cell" | "more";
export interface Box { x: number; y: number; w: number; h: number }

/** 一个节点的文字标签（HTML 渲染）。x/y/w/h 是标签盒（块局部 → 展平后为世界坐标） */
export interface AGlyph extends Box {
  id: string;               // `g:${nodeId}`；「另 N 项」为 `more:${parentId}`
  nodeId: string | null;    // more 为 null
  parentId: string | null;
  kind: GlyphKind;
  lines: string[]; fs: number; lh: number; weight: number; tone: number;
  align: "left" | "center";
  color: string;
  meta: string;             // 类型字（「其他」/ 无类型时为 ""）；root 为「全文 · n 节」
  time: string | null;      // event：标题上方的时间
  num: number | null;       // step：序号（圆内数字由 deco 画，这里供读屏）
  kids: number;             // 子节点总数（>0 显示折叠钮）
  expanded: boolean;        // 子节点是否已展开显示
  head: boolean;            // 是展开中的组头（字重 +100、字号 +1，CSS 实现）
  counter: boolean;         // 反方观点 / 反驳 / 让步（斜纹竖条）
  example: boolean;         // 例证 / 案例（点状竖条）
  moreCount?: number;       // more：隐藏的项数
}

/** 边：path＝[x0,y0, c1x,c1y,c2x,c2y,x,y, …]（每段一个三次贝塞尔）；ribbon＝Sankey 流带（字段同 FlowShape） */
export type AGeom = { t: "path"; p: number[] } | { t: "ribbon"; L: number; xs: number; s0: number; s1: number; x1: number; t0: number; t1: number };
export interface AEdge {
  id: string;
  kind: "fan" | "rel" | "seq" | "axis";
  from: string | null;      // nodeId
  to: string | null;
  code: RelCode | null;
  geom: AGeom;
  color: string;
  colorB: string;           // 渐变终点色（与 color 相同即实色）
  w: number;                // 描边宽（ribbon 为 0）
  dash: string;             // "" 实线
  end: "arrow" | "bar" | "open" | "dot" | null;
  start: "dot" | null;
  opacity: number;          // 基础不透明度（隐含关系 0.55，轴 0.22，其余 1）
}

export type ADeco =
  | { k: "rect"; id: string; x: number; y: number; w: number; h: number; rx: number; fill: string; opacity: number }
  | { k: "circle"; id: string; cx: number; cy: number; r: number; fill: string; stroke: string; strokeW: number; opacity: number }
  | { k: "text"; id: string; x: number; y: number; text: string; fs: number; weight: number; fill: string; opacity: number; anchor: "start" | "middle" | "end"; mono: boolean };

/** 组的领地（悬停 / 焦点组淡色底） */
export interface AZone extends Box { id: string; pattern: FlowPattern; color: string }

export interface ABlock {
  w: number; h: number;
  anchor: Box;              // 组头标签盒（块局部）
  headId: string;           // 组头字形 id
  glyphs: AGlyph[]; edges: AEdge[]; decos: ADeco[]; zones: AZone[];
  /** 已被版式表达的图边（`${from}>${to}>${code}`），不再画成跨组关系 */
  consumed: string[];
}

export interface AtlasOpts {
  colors: FlowColors;
  rootTitle: string;
  expanded: ReadonlySet<string>;   // 展开显示子节点的节点（ROOT_ID 恒视为展开）
  showAll: ReadonlySet<string>;    // 子节点 > MORE_MAX 但用户点过「另 N 项」的组
  readingId: string | null;
  patternLabel: (p: FlowPattern) => string;    // p => T(PATTERN_LABEL[p])
  rootMeta: (n: number) => string;             // n => T("全文 · {n} 节", { n })
  moreLabel: (n: number) => string;            // n => T("另 {n} 项", { n })
  counterLabel: string;                         // T("反方一侧")
  otherLabel: string;                           // T("其他")
}

export interface AtlasScene {
  w: number; h: number;
  glyphs: AGlyph[]; edges: AEdge[]; decos: ADeco[]; zones: AZone[];
  byId: Map<string, AGlyph>;        // glyph id → glyph
  byNode: Map<string, AGlyph>;      // nodeId → glyph
  consumed: Set<string>;
  patternOf: Map<string, FlowPattern>;  // 展开组 → 版式
}
```

### 4.3 字形

```ts
interface KindStyle { fs: number; lh: number; weight: number; tone: number; maxW: number; lines: number; align: "left" | "center"; bar: boolean }
export const KIND_STYLE: Record<GlyphKind, KindStyle> = {
  root:    { fs: 20,   lh: 26, weight: 650, tone: 96, maxW: 360, lines: 2, align: "left",   bar: true },
  claim:   { fs: 15,   lh: 21, weight: 640, tone: 96, maxW: 260, lines: 3, align: "center", bar: false },
  plate:   { fs: 13,   lh: 18, weight: 500, tone: 90, maxW: 216, lines: 3, align: "left",   bar: true },
  tile:    { fs: 13,   lh: 18, weight: 500, tone: 90, maxW: 184, lines: 3, align: "left",   bar: false },
  event:   { fs: 13,   lh: 18, weight: 500, tone: 90, maxW: 176, lines: 3, align: "left",   bar: false },
  step:    { fs: 13,   lh: 18, weight: 500, tone: 90, maxW: 168, lines: 3, align: "center", bar: false },
  colhead: { fs: 14,   lh: 19, weight: 620, tone: 96, maxW: 200, lines: 2, align: "left",   bar: false },
  cell:    { fs: 12.5, lh: 18, weight: 420, tone: 84, maxW: 200, lines: 5, align: "left",   bar: false },
  more:    { fs: 12,   lh: 18, weight: 400, tone: 52, maxW: 160, lines: 1, align: "left",   bar: true },
};
const TYPE_HIDDEN = new Set(["", "其他"]);

export function makeGlyph(
  g: GraphState, o: AtlasOpts, nodeId: string, parentId: string | null, kind: GlyphKind, color: string,
  extra: { text?: string; num?: number; head?: boolean } = {},
): AGlyph {
  const st = KIND_STYLE[kind];
  const n = nodeId === ROOT_ID ? null : g.nodes[nodeId];
  const text = extra.text ?? (nodeId === ROOT_ID ? o.rootTitle : String(n?.title ?? ""));
  const lines = wrapLabel(text, st.fs, st.maxW, st.lines);
  const padL = st.bar ? AL.PAD_X : 0, padR = st.bar ? AL.PAD_R : 0;
  const textWmax = Math.max(0, ...lines.map((l) => textW(l, st.fs)));
  const w = kind === "tile" ? AL.GRID_TILE_W : Math.max(AL.MIN_W, Math.min(st.maxW, Math.ceil(textWmax)) + padL + padR);
  const kidsAll = childrenOf(g, nodeId).filter((k) => !!g.nodes[k]);
  const type = String(n?.type ?? "");
  const t = tierOf(type);
  const meta = nodeId === ROOT_ID ? o.rootMeta(kidsAll.length) : TYPE_HIDDEN.has(type) ? "" : type;
  const time = kind === "event" ? (n?.timeText ? String(n.timeText) : null) : null;
  const hasMetaRow = kind !== "cell" && kind !== "more" && (meta !== "" || kidsAll.length > 0);
  const h = lines.length * st.lh + AL.PAD_Y * 2 + (hasMetaRow ? AL.META_H : 0) + (time ? AL.TIME_H : 0);
  return {
    id: `g:${nodeId}`, nodeId, parentId, kind, x: 0, y: 0, w, h,
    lines, fs: st.fs, lh: st.lh, weight: st.weight, tone: st.tone, align: st.align, color,
    meta, time, num: extra.num ?? null, kids: kind === "cell" && kidsAll.length === 0 ? 0 : kidsAll.length,
    expanded: false, head: !!extra.head, counter: t === "counter", example: t === 2,
  };
}

function moreGlyph(o: AtlasOpts, parentId: string, hidden: number, color: string): AGlyph {
  const st = KIND_STYLE.more, text = o.moreLabel(hidden);
  const w = Math.max(AL.MIN_W, Math.ceil(textW(text, st.fs)) + AL.PAD_X + AL.PAD_R);
  return {
    id: `more:${parentId}`, nodeId: null, parentId, kind: "more", x: 0, y: 0, w, h: st.lh + AL.PAD_Y * 2,
    lines: [text], fs: st.fs, lh: st.lh, weight: st.weight, tone: st.tone, align: "left", color,
    meta: "", time: null, num: null, kids: 0, expanded: false, head: false, counter: false, example: false, moreCount: hidden,
  };
}
```

### 4.4 块工具

```ts
const blank = (): ABlock => ({ w: 0, h: 0, anchor: { x: 0, y: 0, w: 0, h: 0 }, headId: "", glyphs: [], edges: [], decos: [], zones: [], consumed: [] });
const leaf = (gl: AGlyph): ABlock => ({ ...blank(), w: gl.w, h: gl.h, anchor: { x: 0, y: 0, w: gl.w, h: gl.h }, headId: gl.id, glyphs: [gl] });
const r1 = (v: number) => Math.round(v * 2) / 2;
const isBig = (b: ABlock) => b.glyphs.length > 1;

function moveGeom(ge: AGeom, dx: number, dy: number): AGeom {
  if (ge.t === "path") return { t: "path", p: ge.p.map((v, i) => (i % 2 ? v + dy : v + dx)) };
  return { t: "ribbon", L: ge.L + dx, xs: ge.xs + dx, x1: ge.x1 + dx, s0: ge.s0 + dy, s1: ge.s1 + dy, t0: ge.t0 + dy, t1: ge.t1 + dy };
}
function moveDeco(d: ADeco, dx: number, dy: number): ADeco {
  return d.k === "circle" ? { ...d, cx: d.cx + dx, cy: d.cy + dy } : { ...d, x: d.x + dx, y: d.y + dy };
}
/** 把子块 b 平移 (dx,dy) 后并入 out */
function put(out: ABlock, b: ABlock, dx: number, dy: number) {
  for (const gl of b.glyphs) out.glyphs.push({ ...gl, x: gl.x + dx, y: gl.y + dy });
  for (const e of b.edges) out.edges.push({ ...e, geom: moveGeom(e.geom, dx, dy) });
  for (const d of b.decos) out.decos.push(moveDeco(d, dx, dy));
  for (const z of b.zones) out.zones.push({ ...z, x: z.x + dx, y: z.y + dy });
  out.consumed.push(...b.consumed);
}
/** 块内所有元素整体平移（用于归一化左上角到 0,0） */
function shiftAll(out: ABlock, dx: number, dy: number) {
  if (!dx && !dy) return;
  const tmp = { ...blank(), glyphs: out.glyphs, edges: out.edges, decos: out.decos, zones: out.zones };
  out.glyphs = []; out.edges = []; out.decos = []; out.zones = [];
  const consumed = out.consumed; out.consumed = [];
  put(out, tmp, dx, dy);
  out.consumed = consumed;
  out.anchor = { ...out.anchor, x: out.anchor.x + dx, y: out.anchor.y + dy };
}
/** 世界坐标下块的锚点（子块被 put(dx,dy) 后） */
const anchorAt = (b: ABlock, dx: number, dy: number): Box => ({ x: b.anchor.x + dx, y: b.anchor.y + dy, w: b.anchor.w, h: b.anchor.h });
const relEdge = (id: string, from: string, to: string, code: RelCode, p: number[], color: string, colorB: string, opacity = 1): AEdge => {
  const st = REL_STYLE[code];
  return { id, kind: "rel", from, to, code, geom: { t: "path", p }, color, colorB, w: st.width + 0.25, dash: st.dash, end: st.end as AEdge["end"], start: st.start as AEdge["start"], opacity };
};
const valueOf = (g: GraphState, id: string) => {
  const n = g.nodes[id];
  return n && n.blockStart != null && n.blockEnd != null ? Math.max(1, n.blockEnd - n.blockStart + 1) : 1;
};
const ekey = (from: string, to: string, code: string) => `${from}>${to}>${code}`;
```

### 4.5 组合（自顶向下定角色、自底向上排块）

```ts
interface GroupIn {
  id: string; pattern: FlowPattern; head: AGlyph;
  kids: string[];          // 显示的子节点（已截断）
  blocks: ABlock[];        // 与 kids 一一对应
  more: ABlock | null;     // 「另 N 项」
  g: GraphState; o: AtlasOpts;
}
/** 版式 → 子节点字形 */
const ROLE: Record<FlowPattern, GlyphKind> = { tree: "plate", grid: "tile", argument: "plate", timeline: "event", chain: "step", layered: "plate", compare: "colhead" };

export function groupPattern(g: GraphState, id: string, kids: string[]): FlowPattern {
  if (kids.length < 2) return "tree";
  const p = patternFor(g, id, kids);
  if (kids.length > AL.BIG_GROUP && p !== "tree" && p !== "grid") return "grid";
  return p;
}

function buildBlock(g: GraphState, o: AtlasOpts, id: string, parentId: string | null, role: GlyphKind, color: string, num: number | null, patternOut: Map<string, FlowPattern>, text?: string): ABlock {
  const all = childrenOf(g, id).filter((k) => !!g.nodes[k]);
  const open = all.length > 0 && (id === ROOT_ID || o.expanded.has(id));
  const pattern = open ? groupPattern(g, id, all) : "tree";
  // 组头字形：论证组且自身是普通标签 → 升级为「主张」
  const kind: GlyphKind = open && pattern === "argument" && (role === "plate" || role === "tile") ? "claim" : role;
  const head = makeGlyph(g, o, id, parentId, kind, color, { num: num ?? undefined, head: open, text });
  head.expanded = open;
  if (!open) return leaf(head);
  patternOut.set(id, pattern);
  let kids = all, more: ABlock | null = null;
  if (all.length > AL.MORE_MAX && !o.showAll.has(id) && pattern !== "compare") {
    kids = all.slice(0, AL.MORE_SHOW);
    more = leaf(moreGlyph(o, id, all.length - AL.MORE_SHOW, o.colors.hairline));
  }
  if (pattern === "compare") return layoutCompare(g, o, id, head, all, patternOut);
  const childRole = ROLE[pattern];
  const blocks = kids.map((k, i) => buildBlock(g, o, k, id, childRole, o.colors.palette[i % 8], pattern === "chain" ? i + 1 : null, patternOut));
  const gi: GroupIn = { id, pattern, head, kids, blocks, more, g, o };
  switch (pattern) {
    case "grid": return layoutGrid(gi);
    case "argument": return layoutArgument(gi);
    case "timeline": return layoutTimeline(gi);
    case "chain": return layoutChain(gi);
    case "layered": return layoutLayered(gi);
    default: return layoutFan(gi);
  }
}

export function buildAtlas(g: GraphState, o: AtlasOpts): AtlasScene {
  const patternOf = new Map<string, FlowPattern>();
  const b = buildBlock(g, o, ROOT_ID, null, "root", o.colors.fg, null, patternOf);
  const byId = new Map<string, AGlyph>(), byNode = new Map<string, AGlyph>();
  for (const gl of b.glyphs) { byId.set(gl.id, gl); if (gl.nodeId) byNode.set(gl.nodeId, gl); }
  return { w: b.w, h: b.h, glyphs: b.glyphs, edges: b.edges, decos: b.decos, zones: b.zones, byId, byNode, consumed: new Set(b.consumed), patternOf };
}

/** 每个版式结尾都调用：登记领地、写 w/h/anchor/headId */
function finish(out: ABlock, gi: GroupIn, H: AGlyph) {
  // 归一化：最小 x/y 到 0
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const gl of out.glyphs) { minX = Math.min(minX, gl.x); minY = Math.min(minY, gl.y); maxX = Math.max(maxX, gl.x + gl.w); maxY = Math.max(maxY, gl.y + gl.h); }
  for (const d of out.decos) {
    const bx = d.k === "circle" ? [d.cx - d.r, d.cy - d.r, d.cx + d.r, d.cy + d.r] : d.k === "rect" ? [d.x, d.y, d.x + d.w, d.y + d.h] : [d.x - 24, d.y - d.fs, d.x + 24, d.y + 4];
    minX = Math.min(minX, bx[0]); minY = Math.min(minY, bx[1]); maxX = Math.max(maxX, bx[2]); maxY = Math.max(maxY, bx[3]);
  }
  out.anchor = { x: H.x, y: H.y, w: H.w, h: H.h };
  shiftAll(out, -minX, -minY);
  out.w = Math.ceil(maxX - minX); out.h = Math.ceil(maxY - minY);
  out.headId = H.id;
  out.zones.push({ id: gi.id, pattern: gi.pattern, color: H.color, x: 0, y: 0, w: out.w, h: out.h });
}
```

> 注意：`out.glyphs` 里组头 `H` 必须**先** push（渲染顺序 / 查找都依赖它是该块第一个字形）。每个版式里「H 的坐标」用变量记录，`finish` 之前不要再改。

### 4.6 七种版式

#### 4.6.1 大纲 · 扇形树（`tree`）

意图：组头在左，子块在右侧竖向排开；从组头右缘发出 Sankey 流带，按篇幅切片流向每个子块的标签竖条。子块再展开时继续向右生长——经典大纲的最佳画法。

```ts
function layoutFan(gi: GroupIn): ABlock {
  const out = blank();
  const list = gi.more ? [...gi.blocks, gi.more] : gi.blocks;
  const tops: number[] = [];
  let y = 0;
  list.forEach((b, i) => {
    if (i) y += isBig(b) || isBig(list[i - 1]) ? AL.FAN_VGAP_BLOCK : AL.FAN_VGAP;
    tops.push(y);
    y += b.h;
  });
  const ax = gi.head.w + AL.FAN_GAP;
  const mid = (i: number) => tops[i] + list[i].anchor.y + list[i].anchor.h / 2;
  let hy = Math.round((mid(0) + mid(list.length - 1)) / 2 - gi.head.h / 2);
  let ky = 0;
  if (hy < 0) { ky = -hy; hy = 0; }
  const H = { ...gi.head, x: 0, y: hy };
  out.glyphs.push(H);
  list.forEach((b, i) => put(out, b, ax, tops[i] + ky));
  const vals = list.map((_, i) => (i < gi.blocks.length ? valueOf(gi.g, gi.kids[i]) : 1));
  const total = vals.reduce((s, v) => s + v, 0);
  let acc = 0;
  list.forEach((b, i) => {
    const s0 = hy + 2 + ((H.h - 4) * acc) / total;
    acc += vals[i];
    const s1 = hy + 2 + ((H.h - 4) * acc) / total;
    const A = anchorAt(b, ax, tops[i] + ky);
    const toNode = i < gi.blocks.length ? gi.kids[i] : null;
    const color = i < gi.blocks.length ? b.glyphs[0].color : gi.o.colors.hairline;
    out.edges.push({
      id: `fan:${gi.id}>${toNode ?? "more"}`, kind: "fan", from: gi.id, to: toNode, code: null,
      geom: { t: "ribbon", L: H.w, xs: H.w + 2, s0: r1(s0), s1: r1(Math.max(s0 + 0.5, s1)), x1: A.x, t0: A.y + 1, t1: A.y + A.h - 1 },
      color, colorB: color, w: 0, dash: "", end: null, start: null, opacity: 1,
    });
  });
  finish(out, gi, H);
  return out;
}
```

#### 4.6.2 并列 · 网格（`grid`）

意图：并列项没有先后与主次，用等宽瓷砖排成网格；瓷砖顶部一条 3px 色带。组头在上，下面一根 24px 细线。

```ts
function layoutGrid(gi: GroupIn): ABlock {
  const out = blank();
  const list = gi.more ? [...gi.blocks, gi.more] : gi.blocks;
  const n = list.length;
  const cols = n <= 3 ? n : Math.min(AL.GRID_MAXCOLS, Math.max(2, Math.round(Math.sqrt(n * 1.4))));
  const colW = Array.from({ length: cols }, (_, c) => Math.max(AL.GRID_TILE_W, ...list.filter((_, i) => i % cols === c).map((b) => b.w)));
  const colX: number[] = [];
  colW.reduce((x, w, c) => ((colX[c] = x), x + w + AL.GRID_GX), 0);
  const H = { ...gi.head, x: 0, y: 0 };
  out.glyphs.push(H);
  out.decos.push({ k: "rect", id: `rule:${gi.id}`, x: 0, y: H.h + 5, w: 24, h: 1, rx: 0, fill: gi.o.colors.fg, opacity: 0.3 });
  let y = H.h + AL.HEAD_GAP;
  for (let r = 0; r * cols < n; r++) {
    const row = list.slice(r * cols, r * cols + cols);
    row.forEach((b, c) => put(out, b, colX[c], y));
    y += Math.max(...row.map((b) => b.h)) + AL.GRID_GY;
  }
  finish(out, gi, H);
  return out;
}
```

#### 4.6.3 论证（`argument`）

意图：主张（组头）在顶部正中；每个成员找到它在组内支撑 / 例示 / 反驳 / 回答 / 推出的「上级」（可以有**多个**）；按「到主张的最长路径」分层，层内按上级位置的重心排序以减少交叉；每条支撑关系画一条从下而上的线——**一个证据同时支撑两个理由就是两条线，结构不失真**。反方观点及其下的反驳单独放在右侧「反方一侧」区，带淡淡的反方色底。

```ts
const UP_OUT = new Set<RelCode>(["支", "例", "驳", "答", "推"]); // 本节点 —码→ 目标：目标是上级
type Up = { up: string; code: RelCode; implicit: boolean };

function layoutArgument(gi: GroupIn): ABlock {
  const { g, kids, blocks, o } = gi;
  const out = blank();
  const n = kids.length;
  const idx = new Map(kids.map((k, i) => [k, i] as const));
  const rk = (id: string) => { const t = tierOf(String(g.nodes[id]?.type ?? "")); return t === "counter" ? 1 : t; };
  // ① 上级（去重，保持出现顺序）
  const ups: Up[][] = kids.map((k) => {
    const list: Up[] = [];
    const add = (up: string, code: RelCode) => { if (up !== k && idx.has(up) && rk(up) <= rk(k) && !list.some((u) => u.up === up)) list.push({ up, code, implicit: false }); };
    for (const e of g.outEdges[k] ?? []) if (UP_OUT.has(e.code)) add(e.to, e.code);
    for (const e of g.inEdges[k] ?? []) if (e.code === "据") add(e.from, "据");
    return list;
  });
  // ② 分层：主张＝0；成员＝1 + max(上级层)；DFS 按原文顺序，遇环丢弃该条上级（它会作为跨组关系画出）
  const layer = new Array<number>(n).fill(0);
  const state = new Uint8Array(n);
  const visit = (i: number): number => {
    if (state[i] === 2) return layer[i];
    if (state[i] === 1) return -1;
    state[i] = 1;
    let L = 1;
    ups[i] = ups[i].filter((u) => { const lj = visit(idx.get(u.up)!); if (lj < 0) return false; L = Math.max(L, lj + 1); return true; });
    state[i] = 2;
    layer[i] = L;
    return L;
  };
  for (let i = 0; i < n; i++) visit(i);
  for (let i = 0; i < n; i++) if (!ups[i].length) ups[i].push({ up: gi.id, code: tierOf(String(g.nodes[kids[i]]?.type ?? "")) === "counter" ? "驳" : "支", implicit: true });
  // ③ 反方区：类型为反方且只挂主张；或全部上级都在反方区
  const counter = new Array<boolean>(n).fill(false);
  const byLayer = [...kids.keys()].sort((a, b) => layer[a] - layer[b] || a - b);
  for (const i of byLayer) {
    const explicit = ups[i].filter((u) => !u.implicit);
    counter[i] = (tierOf(String(g.nodes[kids[i]]?.type ?? "")) === "counter" && explicit.every((u) => counter[idx.get(u.up)!])) ||
      (explicit.length > 0 && explicit.every((u) => counter[idx.get(u.up)!]));
  }
  // ④ 层内顺序 + 横向落位（重心法；主区与反方区分开排，反方区整体在主区右侧）
  const maxL = Math.max(1, ...layer);
  const order: number[][][] = [[], []]; // [zone][layer] → 成员下标
  for (let z = 0; z < 2; z++) for (let L = 0; L <= maxL; L++) order[z][L] = [];
  for (let i = 0; i < n; i++) order[counter[i] ? 1 : 0][layer[i]].push(i);
  const lowers: number[][] = kids.map(() => []);
  for (let i = 0; i < n; i++) for (const u of ups[i]) if (!u.implicit) lowers[idx.get(u.up)!].push(i);
  const cx = new Array<number>(n).fill(0), px = new Array<number>(n).fill(0);
  const ac = (i: number) => blocks[i].anchor.x + blocks[i].anchor.w / 2;
  const place = () => {
    let zoneStart = 0;
    for (let z = 0; z < 2; z++) {
      let zoneRight = zoneStart;
      for (let L = 1; L <= maxL; L++) {
        let cur = zoneStart;
        for (const i of order[z][L]) {
          const us = ups[i].filter((u) => !u.implicit).map((u) => cx[idx.get(u.up)!]);
          const want = us.length ? us.reduce((a, b) => a + b, 0) / us.length - ac(i) : cur;
          px[i] = Math.round(Math.max(cur, want));
          cx[i] = px[i] + ac(i);
          cur = px[i] + blocks[i].w + AL.ARG_GX;
          zoneRight = Math.max(zoneRight, px[i] + blocks[i].w);
        }
      }
      zoneStart = zoneRight + AL.ARG_COUNTER_GAP;
    }
  };
  const bary = (list: number[], pick: (i: number) => number[]) =>
    list.map((i, k) => { const v = pick(i); return { i, k, b: v.length ? v.reduce((a, c) => a + c, 0) / v.length : Infinity }; })
      .sort((a, b) => (a.b === b.b ? a.k - b.k : a.b - b.b)).map((x) => x.i);
  place();
  for (let r = 0; r < AL.ARG_ROUNDS; r++) {
    for (let z = 0; z < 2; z++) for (let L = 2; L <= maxL; L++) order[z][L] = bary(order[z][L], (i) => ups[i].filter((u) => !u.implicit).map((u) => cx[idx.get(u.up)!]));
    place();
    for (let z = 0; z < 2; z++) for (let L = maxL - 1; L >= 1; L--) order[z][L] = bary(order[z][L], (i) => lowers[i].map((j) => cx[j]));
    place();
  }
  // ⑤ 纵向：层顶 = 上一层顶 + 上一层最高块 + ARG_GY
  const H0 = gi.head;
  const top: number[] = [0, H0.h + AL.ARG_GY];
  for (let L = 1; L < maxL; L++) {
    const hs = [...order[0][L], ...order[1][L]].map((i) => blocks[i].h);
    top[L + 1] = top[L] + (hs.length ? Math.max(...hs) : 0) + AL.ARG_GY;
  }
  // 主张水平居中于第 1 层主区（主区无第 1 层则居中于全部第 1 层）
  const L1 = order[0][1].length ? order[0][1] : order[1][1];
  const l1min = Math.min(...L1.map((i) => px[i])), l1max = Math.max(...L1.map((i) => px[i] + blocks[i].w));
  const H = { ...H0, x: Math.round((l1min + l1max) / 2 - H0.w / 2), y: 0 };
  out.glyphs.push(H);
  for (let i = 0; i < n; i++) put(out, blocks[i], px[i], top[layer[i]]);
  // ⑥ 边：自下（成员锚点上缘）而上（上级锚点下缘）；两端各自按对侧横坐标均分端口
  const A = (i: number) => anchorAt(blocks[i], px[i], top[layer[i]]);
  const upBox = (u: Up) => (u.up === gi.id ? { x: H.x, y: H.y, w: H.w, h: H.h } : A(idx.get(u.up)!));
  const inc = new Map<string, { i: number; u: Up }[]>();
  for (let i = 0; i < n; i++) for (const u of ups[i]) { const l = inc.get(u.up) ?? []; l.push({ i, u }); inc.set(u.up, l); }
  for (const [upId, list] of inc) {
    const B = upBox(list[0].u);
    list.sort((a, b) => A(a.i).x - A(b.i).x);
    list.forEach(({ i, u }, k) => {
      const S = A(i);
      const outs = ups[i];
      const ko = outs.indexOf(u);
      const x0 = S.x + S.w / 2 + (outs.length > 1 ? ((ko + 1) / (outs.length + 1) - 0.5) * S.w * 0.6 : 0);
      const x1 = B.x + B.w / 2 + (list.length > 1 ? ((k + 1) / (list.length + 1) - 0.5) * B.w * 0.6 : 0);
      const y0 = S.y - 2, y1 = B.y + B.h + 3, dy = y0 - y1;
      const color = blocks[i].glyphs[0].color, colorB = upId === gi.id ? H.color : blocks[idx.get(upId)!].glyphs[0].color;
      const ed = relEdge(`arg:${kids[i]}>${upId}`, kids[i], upId, u.code, [x0, y0, x0, y0 - dy * 0.45, x1, y1 + dy * 0.45, x1, y1], color, colorB, u.implicit ? 0.55 : 1);
      if (u.code === "驳") { ed.color = o.colors.counter; ed.colorB = o.colors.counter; }
      out.edges.push(ed);
      if (!u.implicit) out.consumed.push(u.code === "据" ? ekey(upId, kids[i], "据") : ekey(kids[i], upId, u.code));
    });
  }
  // ⑦ 反方区底色 + 区名
  const ci = kids.map((_, i) => i).filter((i) => counter[i]);
  if (ci.length) {
    const bx = ci.map((i) => [px[i], top[layer[i]], px[i] + blocks[i].w, top[layer[i]] + blocks[i].h]);
    const x0 = Math.min(...bx.map((b) => b[0])) - AL.ARG_ZONE_PAD, y0 = Math.min(...bx.map((b) => b[1])) - AL.ARG_ZONE_PAD - 14;
    const x1 = Math.max(...bx.map((b) => b[2])) + AL.ARG_ZONE_PAD, y1 = Math.max(...bx.map((b) => b[3])) + AL.ARG_ZONE_PAD;
    out.decos.push({ k: "rect", id: `cz:${gi.id}`, x: x0, y: y0, w: x1 - x0, h: y1 - y0, rx: 12, fill: o.colors.counter, opacity: 0.05 });
    out.decos.push({ k: "text", id: `czt:${gi.id}`, x: x0 + 12, y: y0 + 16, text: o.counterLabel, fs: 10, weight: 500, fill: o.colors.counter, opacity: 0.8, anchor: "start", mono: false });
  }
  finish(out, gi, H);
  return out;
}
```

#### 4.6.4 时间线（`timeline`）

意图：横向时间轴；能解析出时间的事件按真实年代比例排布（长断层压缩成 72px 并画「//」），否则等距；事件标签上下交错，同侧放不下时外推一条「泳道」；每个事件有光点、细茎、时间（等宽数字）与标题；比例模式下轴下方有年份刻度。组头在轴的左端，用一段虚线引入。

```ts
const NICE = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

function layoutTimeline(gi: GroupIn): ABlock {
  const { g, kids, blocks, o } = gi;
  const out = blank();
  const n = kids.length;
  const raw = kids.map((k) => parseTime(g.nodes[k]?.timeText ? String(g.nodes[k].timeText) : null));
  const known = raw.filter((t): t is number => t != null);
  const prop = known.length >= Math.ceil((n * 2) / 3) && new Set(known).size >= 2;
  // 缺失时间：先前向填充再后向填充
  const tf = raw.slice();
  for (let i = 1; i < n; i++) if (tf[i] == null) tf[i] = tf[i - 1];
  for (let i = n - 2; i >= 0; i--) if (tf[i] == null) tf[i] = tf[i + 1];
  const order = kids.map((_, i) => i);
  if (prop) order.sort((a, b) => (tf[a] as number) - (tf[b] as number) || a - b);
  // 光点横坐标
  const xs: number[] = [0];
  const breaks = new Set<number>(); // 断层在 order[j] 与 order[j+1] 之间
  if (prop) {
    const gaps = order.slice(1).map((oi, j) => (tf[oi] as number) - (tf[order[j]] as number));
    const pos = gaps.filter((v) => v > 0).sort((a, b) => a - b);
    const med = pos.length ? pos[Math.floor(pos.length / 2)] : 0;
    gaps.forEach((v, j) => { if (med > 0 && v > AL.TL_BREAK_K * med) breaks.add(j); });
    const W = Math.min(AL.TL_W_MAX, Math.max(AL.TL_W_MIN, n * AL.TL_W_PER));
    const span = gaps.reduce((s, v, j) => s + (breaks.has(j) ? 0 : v), 0);
    const k = span > 0 ? Math.max(0, W - breaks.size * AL.TL_BREAK_W) / span : 0;
    gaps.forEach((v, j) => xs.push(xs[j] + Math.max(AL.TL_MIN_DX, breaks.has(j) ? AL.TL_BREAK_W : v * k)));
  } else for (let j = 1; j < n; j++) xs.push(j * AL.TL_SLOT);
  // 泳道：偶数序上方、奇数序下方；同侧按「左缘 ≥ 上一个右缘 + 16」找最近一条
  type Lane = { right: number; h: number };
  const lanes: Record<"above" | "below", Lane[]> = { above: [], below: [] };
  const slot: { side: "above" | "below"; lane: number; left: number }[] = [];
  order.forEach((oi, j) => {
    const b = blocks[oi];
    const side = j % 2 === 0 ? "above" : "below";
    const left = xs[j] - AL.TL_LABEL_DX - b.anchor.x;
    const L = lanes[side];
    let li = L.findIndex((l) => l.right + AL.TL_LANE_GAPX <= left);
    if (li < 0) { li = L.length; L.push({ right: -Infinity, h: 0 }); }
    L[li].right = left + b.w;
    L[li].h = Math.max(L[li].h, b.h);
    slot[j] = { side, lane: li, left };
  });
  const sum = (L: Lane[], upto: number) => L.slice(0, upto).reduce((s, l) => s + l.h + AL.TL_LANE_GAP, 0);
  const axisY = AL.TL_STEM + sum(lanes.above, lanes.above.length);
  // 组头（轴左端）
  const H = { ...gi.head, x: -(gi.head.w + AL.TL_HEAD_GAP), y: Math.round(axisY - gi.head.h / 2) };
  out.glyphs.push(H);
  out.edges.push({ id: `ax:${gi.id}:lead`, kind: "axis", from: null, to: null, code: null, geom: { t: "path", p: [H.x + H.w + 8, axisY, H.x + H.w + 16, axisY, -20, axisY, -12, axisY] },
    color: o.colors.fg, colorB: o.colors.fg, w: 1, dash: "2 4", end: null, start: null, opacity: 0.18 });
  // 事件块 + 茎 + 光点
  order.forEach((oi, j) => {
    const b = blocks[oi], s = slot[j];
    // 上方：同一泳道的块底对齐（贴近轴）；下方：块顶对齐
    const y = s.side === "above" ? axisY - AL.TL_STEM - sum(lanes.above, s.lane) - b.h : axisY + AL.TL_STEM + sum(lanes.below, s.lane);
    put(out, b, s.left, y);
    const A = anchorAt(b, s.left, y);
    const color = b.glyphs[0].color;
    const yA = s.side === "above" ? A.y + A.h + 2 : A.y - 2;
    const yD = s.side === "above" ? axisY - AL.TL_DOT_R - 2 : axisY + AL.TL_DOT_R + 2;
    out.edges.push({ id: `stem:${kids[oi]}`, kind: "axis", from: kids[oi], to: null, code: null, geom: { t: "path", p: [xs[j], yD, xs[j], yD, xs[j], yA, xs[j], yA] },
      color: o.colors.fg, colorB: o.colors.fg, w: 1, dash: "", end: null, start: null, opacity: 0.25 });
    out.decos.push({ k: "circle", id: `dot:${kids[oi]}`, cx: xs[j], cy: axisY, r: kids[oi] === o.readingId ? 6.5 : AL.TL_DOT_R, fill: kids[oi] === o.readingId ? o.colors.accent : color, stroke: o.colors.bg, strokeW: 2, opacity: 1 });
  });
  // 轴：相邻光点之间一段；断层段虚线 + 「//」
  for (let j = 0; j + 1 < n; j++) {
    const br = breaks.has(j);
    const ca = blocks[order[j]].glyphs[0].color, cb = blocks[order[j + 1]].glyphs[0].color;
    out.edges.push({ id: `ax:${gi.id}:${j}`, kind: "axis", from: null, to: null, code: null,
      geom: { t: "path", p: [xs[j] + 7, axisY, xs[j] + 7, axisY, xs[j + 1] - 7, axisY, xs[j + 1] - 7, axisY] },
      color: ca, colorB: cb, w: 2, dash: br ? "2 5" : "", end: null, start: null, opacity: br ? 0.35 : 0.5 });
    if (br) out.decos.push({ k: "text", id: `brk:${gi.id}:${j}`, x: (xs[j] + xs[j + 1]) / 2, y: axisY + 4, text: "//", fs: 11, weight: 500, fill: o.colors.fg, opacity: 0.45, anchor: "middle", mono: true });
  }
  // 刻度（仅比例模式）：画在轴下 14px；离任一光点 < 22px 的刻度不写字
  if (prop) {
    const t0 = tf[order[0]] as number, t1 = tf[order[n - 1]] as number, range = Math.max(1e-6, t1 - t0);
    const step = NICE.find((s) => range / s <= 10) ?? 1000;
    for (let v = Math.ceil(t0 / step) * step; v <= t1; v += step) {
      for (let j = 0; j + 1 < n; j++) {
        const a = tf[order[j]] as number, b = tf[order[j + 1]] as number;
        if (breaks.has(j) || v < a || v > b || b <= a) continue;
        const x = Math.round(xs[j] + ((v - a) / (b - a)) * (xs[j + 1] - xs[j]));
        out.decos.push({ k: "rect", id: `tk:${gi.id}:${v}`, x, y: axisY + 3, w: 1, h: 4, rx: 0, fill: o.colors.fg, opacity: 0.3 });
        if (!xs.some((d) => Math.abs(d - x) < 22)) out.decos.push({ k: "text", id: `tkt:${gi.id}:${v}`, x, y: axisY + 18, text: String(v < 0 ? `前${-v}` : v), fs: 10, weight: 400, fill: o.colors.fg, opacity: 0.38, anchor: "middle", mono: true });
        break;
      }
    }
  }
  finish(out, gi, H);
  return out;
}
```
> 测试 §16.1-9 检查：上方块底到轴的距离恒为 `TL_STEM + sum(above, lane)`，下方块顶到轴的距离恒为 `TL_STEM + sum(below, lane)`。

#### 4.6.5 步骤（`chain`）

意图：编号圆点沿一行排开、箭头相连，标签在圆点正下方居中；超过 5 步折返到下一行反向走（蛇形），行尾用一个 U 形弯连接，读起来像一条连续的路径。

```ts
function layoutChain(gi: GroupIn): ABlock {
  const { blocks, kids, o } = gi;
  const out = blank();
  const R = AL.CH_R;
  const list = gi.more ? [...blocks, gi.more] : blocks;
  const sw = (b: ABlock) => Math.max(b.w, 2 * R);
  const rows: number[][] = [];
  for (let i = 0; i < list.length; i += AL.CH_ROW_MAX) rows.push(list.slice(i, i + AL.CH_ROW_MAX).map((_, k) => i + k));
  const rowW = rows.map((r) => r.reduce((s, i) => s + sw(list[i]), 0) + (r.length - 1) * AL.CH_GX);
  const maxW = Math.max(...rowW);
  const H = { ...gi.head, x: 0, y: 0 };
  out.glyphs.push(H);
  let y = H.h + AL.HEAD_GAP + 4;
  const disc: { cx: number; cy: number; row: number }[] = [];
  rows.forEach((r, ri) => {
    const dir = ri % 2 === 0 ? 1 : -1;
    let x = dir > 0 ? 0 : maxW;
    const cy = y + R, labelTop = y + 2 * R + AL.CH_LABEL_GAP;
    for (const i of r) {
      const b = list[i], w = sw(b);
      const c = dir > 0 ? x + w / 2 : x - w / 2;
      put(out, b, Math.round(c - (b.anchor.x + b.anchor.w / 2)), labelTop - b.anchor.y);
      disc[i] = { cx: Math.round(c), cy, row: ri };
      x += dir * (w + AL.CH_GX);
    }
    y = labelTop + Math.max(...r.map((i) => list[i].h)) + AL.CH_GY;
  });
  const steps = blocks.length; // 「另 N 项」没有圆点与箭头
  for (let i = 0; i < steps; i++) {
    const c = blocks[i].glyphs[0].color, d = disc[i];
    out.decos.push({ k: "circle", id: `disc:${kids[i]}`, cx: d.cx, cy: d.cy, r: R, fill: kids[i] === o.readingId ? o.colors.accent : c, stroke: o.colors.bg, strokeW: 2, opacity: 1 });
    out.decos.push({ k: "text", id: `dn:${kids[i]}`, x: d.cx, y: d.cy + 4, text: String(i + 1), fs: 11, weight: 650, fill: o.colors.bg, opacity: 1, anchor: "middle", mono: true });
    if (i + 1 >= steps) continue;
    const e = disc[i + 1], cb = blocks[i + 1].glyphs[0].color;
    let p: number[];
    if (e.row === d.row) {
      const s = e.cx > d.cx ? 1 : -1;
      const x0 = d.cx + s * (R + 3), x1 = e.cx - s * (R + 5);
      p = [x0, d.cy, x0 + (x1 - x0) / 3, d.cy, x1 - (x1 - x0) / 3, e.cy, x1, e.cy];
    } else {
      const s = d.row % 2 === 0 ? 1 : -1; // 偶数行在右端折返，奇数行在左端
      const xo = s > 0 ? Math.max(d.cx, e.cx) + R + AL.CH_TURN : Math.min(d.cx, e.cx) - R - AL.CH_TURN;
      p = [d.cx + s * (R + 3), d.cy, xo, d.cy, xo, e.cy, e.cx + s * (R + 5), e.cy];
    }
    out.edges.push({ id: `seq:${kids[i]}>${kids[i + 1]}`, kind: "seq", from: kids[i], to: kids[i + 1], code: null, geom: { t: "path", p },
      color: c, colorB: cb, w: 1.5, dash: "", end: "arrow", start: null, opacity: 1 });
  }
  finish(out, gi, H);
  return out;
}
```

#### 4.6.6 因果（`layered`）

意图：自左向右的分层有向图——原因在左、结果在右；层号＝最长路径；层内用重心法前后各扫两轮减少交叉；纵向尽量对齐前驱的中线；边是水平出、水平入的 S 形曲线，带箭头，颜色从因渐变到果。

```ts
const FLOWC = new Set<RelCode>(["推", "因", "据"]);

function layoutLayered(gi: GroupIn): ABlock {
  const { g, kids, blocks } = gi;
  const out = blank();
  const n = kids.length;
  const idx = new Map(kids.map((k, i) => [k, i] as const));
  // 信息流向的边：A 推/因 B ＝ A→B；A 据 B ＝ B→A
  const fe: { a: number; b: number; code: RelCode; key: string }[] = [];
  for (const k of kids) for (const e of g.outEdges[k] ?? []) {
    if (!FLOWC.has(e.code) || !idx.has(e.to) || e.to === k) continue;
    const [a, b] = e.code === "据" ? [idx.get(e.to)!, idx.get(k)!] : [idx.get(k)!, idx.get(e.to)!];
    if (!fe.some((x) => x.a === a && x.b === b)) fe.push({ a, b, code: e.code, key: ekey(k, e.to, e.code) });
  }
  const preds: number[][] = kids.map(() => []), succs: number[][] = kids.map(() => []);
  // 最长路分层，DFS 按原文顺序断环（被断的边不参与分层、也不算已表达）
  const layer = new Array<number>(n).fill(0), st = new Uint8Array(n);
  const keep = new Set<number>();
  const inEdges = kids.map((_, b) => fe.map((e, ei) => ({ e, ei })).filter(({ e }) => e.b === b));
  const visit = (i: number): number => {
    if (st[i] === 2) return layer[i];
    if (st[i] === 1) return -1;
    st[i] = 1;
    let L = 0;
    for (const { e, ei } of inEdges[i]) { const la = visit(e.a); if (la < 0) continue; keep.add(ei); L = Math.max(L, la + 1); }
    st[i] = 2; layer[i] = L; return L;
  };
  for (let i = 0; i < n; i++) visit(i);
  fe.forEach((e, ei) => { if (keep.has(ei)) { preds[e.b].push(e.a); succs[e.a].push(e.b); } });
  const maxL = Math.max(0, ...layer);
  const cols: number[][] = Array.from({ length: maxL + 1 }, () => []);
  for (let i = 0; i < n; i++) cols[layer[i]].push(i);
  const pos = new Array<number>(n).fill(0);
  const reindex = () => cols.forEach((c) => c.forEach((i, k) => (pos[i] = k)));
  reindex();
  const sortBy = (c: number[], nb: (i: number) => number[]) =>
    c.map((i, k) => { const v = nb(i); return { i, k, b: v.length ? v.reduce((s, j) => s + pos[j], 0) / v.length : Infinity }; })
      .sort((a, b) => (a.b === b.b ? a.k - b.k : a.b - b.b)).map((x) => x.i);
  for (let r = 0; r < AL.LY_ROUNDS; r++) {
    if (r % 2 === 0) for (let L = 1; L <= maxL; L++) cols[L] = sortBy(cols[L], (i) => preds[i]);
    else for (let L = maxL - 1; L >= 0; L--) cols[L] = sortBy(cols[L], (i) => succs[i]);
    reindex();
  }
  const H = { ...gi.head, x: 0, y: 0 };
  out.glyphs.push(H);
  const y0 = H.h + AL.HEAD_GAP;
  const colX: number[] = [];
  cols.reduce((x, c, L) => ((colX[L] = x), x + Math.max(0, ...c.map((i) => blocks[i].w)) + AL.LY_GX), 0);
  const px = new Array<number>(n).fill(0), py = new Array<number>(n).fill(0);
  const mid = (i: number) => py[i] + blocks[i].anchor.y + blocks[i].anchor.h / 2;
  cols.forEach((c, L) => {
    let cur = y0;
    for (const i of c) {
      const ps = preds[i];
      const want = L > 0 && ps.length ? ps.reduce((s, j) => s + mid(j), 0) / ps.length - (blocks[i].anchor.y + blocks[i].anchor.h / 2) : cur;
      px[i] = colX[L];
      py[i] = Math.round(Math.max(cur, want));
      cur = py[i] + blocks[i].h + AL.LY_GY;
    }
  });
  for (let i = 0; i < n; i++) put(out, blocks[i], px[i], py[i]);
  const A = (i: number) => anchorAt(blocks[i], px[i], py[i]);
  // 端口：出边在源锚点右缘、入边在目标锚点左缘，按对侧纵坐标均分
  const outs = kids.map((_, i) => fe.filter((e, ei) => keep.has(ei) && e.a === i).sort((x, y) => A(x.b).y - A(y.b).y));
  const ins = kids.map((_, i) => fe.filter((e, ei) => keep.has(ei) && e.b === i).sort((x, y) => A(x.a).y - A(y.a).y));
  const at = (B: Box, k: number, m: number) => B.y + B.h / 2 + (m > 1 ? ((k + 1) / (m + 1) - 0.5) * B.h * 0.6 : 0);
  fe.forEach((e, ei) => {
    if (!keep.has(ei)) return;
    const S = A(e.a), T = A(e.b);
    const x0 = S.x + S.w + 3, x1 = T.x - 5;
    const y0 = at(S, outs[e.a].indexOf(e), outs[e.a].length), y1 = at(T, ins[e.b].indexOf(e), ins[e.b].length);
    const dx = Math.max(40, x1 - x0);
    out.edges.push(relEdge(`ly:${kids[e.a]}>${kids[e.b]}`, kids[e.a], kids[e.b], e.code, [x0, y0, x0 + dx * 0.5, y0, x1 - dx * 0.5, y1, x1, y1],
      blocks[e.a].glyphs[0].color, blocks[e.b].glyphs[0].color));
    out.consumed.push(e.key);
  });
  finish(out, gi, H);
  return out;
}
```
> 关系码 `据` 的边方向已在上面反转为信息流向，所以箭头总是指向右侧（结果）。

#### 4.6.7 对照（`compare`，成员 2–4）

意图：真正的表格——每个被对照的对象一栏（栏顶 4px 色带 + 栏名），每个维度一行（左侧维度名），单元格是该对象在该维度上的内容；隔行极淡底色、行间细线；栏名之间若有「比」关系，用两端圆点的短线连起。没对上维度的子节点放进最后一行「其他」。维度提取复用随文结构的 `compareTable`（三种口径：命名维度 / 「比」配对 / 序号）。

```ts
function layoutCompare(g: GraphState, o: AtlasOpts, id: string, head0: AGlyph, members: string[], patternOut: Map<string, FlowPattern>): ABlock {
  const gi0: GroupIn = { id, pattern: "compare", head: head0, kids: members, blocks: [], more: null, g, o };
  const tb = compareTable(g, members, AL.CMP_MAX_DIMS);
  const out = blank();
  const colorOf = (j: number) => o.colors.palette[j % 8];
  // 栏头（成员）：字形只画名字；成员的子节点作为单元格，所以 kids 记 0、expanded 记 true
  const heads = members.map((m, j) => { const gl = makeGlyph(g, o, m, id, "colhead", colorOf(j)); gl.expanded = true; return leaf(gl); });
  if (!tb.dims.length) {
    // 没有可对齐的维度：退为并列网格，但成员各自照常展开
    const blocks = members.map((m, j) => buildBlock(g, o, m, id, "tile", colorOf(j), null, patternOut));
    return layoutGrid({ ...gi0, pattern: "grid", blocks });
  }
  const used = new Set<string>();
  const cell = (c: { id: string; text: string } | null, j: number) => {
    if (!c) return null;
    used.add(c.id);
    return buildBlock(g, o, c.id, members[j], "cell", colorOf(j), null, patternOut, tb.how === "named" ? c.text : undefined);
  };
  const grid: (ABlock | null)[][] = tb.dims.map((_, d) => members.map((_, j) => cell(tb.rows[j].cells[d], j)));
  // 「其他」行：每栏里未进表的子节点竖向叠放
  const rest = members.map((m, j) => childrenOf(g, m).filter((k) => g.nodes[k] && !used.has(k)).map((k) => buildBlock(g, o, k, m, "cell", colorOf(j), null, patternOut)));
  const hasRest = rest.some((l) => l.length);
  const colW = members.map((_, j) => Math.max(AL.CMP_COL_W, heads[j].w, ...grid.map((r) => r[j]?.w ?? 0), ...rest[j].map((b) => b.w)));
  const colX: number[] = [];
  colW.reduce((x, w, j) => ((colX[j] = x), x + w + AL.CMP_GX), AL.CMP_DIM_W);
  const tableW = colX[members.length - 1] + colW[members.length - 1];
  const H = { ...head0, x: 0, y: 0 };
  out.glyphs.push(H);
  let y = H.h + AL.HEAD_GAP;
  // 栏头行
  members.forEach((m, j) => {
    out.decos.push({ k: "rect", id: `band:${m}`, x: colX[j], y, w: colW[j], h: 4, rx: 1, fill: colorOf(j), opacity: 1 });
    put(out, heads[j], colX[j], y + 10);
  });
  const headH = Math.max(...heads.map((b) => b.h)) + 16;
  // 栏名之间的「比」
  for (let j = 0; j + 1 < members.length; j++) {
    const a = members[j], b = members[j + 1];
    const hit = (g.outEdges[a] ?? []).some((e) => e.to === b && e.code === "比") || (g.outEdges[b] ?? []).some((e) => e.to === a && e.code === "比");
    if (!hit) continue;
    const cy = y + 10 + heads[j].h / 2, xa = colX[j] + heads[j].w + 8, xb = colX[j + 1] - 6;
    if (xb - xa < 12) continue;
    out.edges.push(relEdge(`cmp:${a}>${b}`, a, b, "比", [xa, cy, xa + (xb - xa) / 3, cy, xb - (xb - xa) / 3, cy, xb, cy], colorOf(j), colorOf(j + 1)));
    out.consumed.push(ekey(a, b, "比"), ekey(b, a, "比"));
  }
  y += headH;
  // 维度行
  const rowsAll: { label: string; cells: (ABlock | ABlock[] | null)[] }[] = tb.dims.map((d, di) => ({ label: d.label, cells: grid[di] }));
  if (hasRest) rowsAll.push({ label: o.otherLabel, cells: rest });
  rowsAll.forEach((row, di) => {
    const hOf = (c: ABlock | ABlock[] | null) => (!c ? 0 : Array.isArray(c) ? c.reduce((s, b) => s + b.h + 6, -6) : c.h);
    const rh = Math.max(AL.CMP_ROW_MIN, ...row.cells.map(hOf)) + AL.CMP_ROW_PAD * 2;
    if (di % 2 === 1) out.decos.push({ k: "rect", id: `zebra:${id}:${di}`, x: 0, y, w: tableW, h: rh, rx: 4, fill: o.colors.fg, opacity: 0.03 });
    out.decos.push({ k: "text", id: `dim:${id}:${di}`, x: 4, y: y + AL.CMP_ROW_PAD + 13, text: row.label, fs: 11, weight: 500, fill: o.colors.fg, opacity: 0.52, anchor: "start", mono: false });
    row.cells.forEach((c, j) => {
      if (!c) return;
      if (Array.isArray(c)) { let cy = y + AL.CMP_ROW_PAD; for (const b of c) { put(out, b, colX[j], cy); cy += b.h + 6; } }
      else put(out, c, colX[j], y + AL.CMP_ROW_PAD);
    });
    y += rh;
    out.decos.push({ k: "rect", id: `hr:${id}:${di}`, x: 0, y: y - 1, w: tableW, h: 1, rx: 0, fill: o.colors.fg, opacity: 0.08 });
  });
  // 「比」配对口径：同一行的单元格之间的「比」已由表格表达
  if (tb.how === "paired") for (const r of tb.dims.keys()) {
    const ids = tb.rows.map((row) => row.cells[r]?.id).filter((x): x is string => !!x);
    for (const a of ids) for (const b of ids) if (a !== b) out.consumed.push(ekey(a, b, "比"));
  }
  patternOut.set(id, "compare");
  finish(out, gi0, H);
  return out;
}
```

### 4.7 展开集（默认）

```ts
/** 根 → 焦点（含两端）；焦点未知 / 祖先链断 → [ROOT_ID] */
export function atlasChain(g: GraphState, focus: string): string[] {
  if (focus === ROOT_ID || !g.nodes[focus]) return [ROOT_ID];
  const anc = ancestors(g, focus);
  const top = anc.length ? anc[0] : focus;
  if (g.nodes[top]?.parentId != null) return [ROOT_ID];
  return [ROOT_ID, ...anc, focus];
}
const kidCount = (g: GraphState, id: string) => childrenOf(g, id).filter((k) => !!g.nodes[k]).length;

/** 默认展开：根→焦点路径 + 焦点；再广度优先展开浅层，直到可见节点数将超过 budget */
export function defaultExpanded(g: GraphState, focus: string, budget: number = AL.BUDGET): Set<string> {
  const s = new Set<string>(atlasChain(g, focus));
  let count = 1;
  for (const id of s) count += Math.min(kidCount(g, id), AL.MORE_MAX);
  const queue = childrenOf(g, ROOT_ID).filter((k) => !!g.nodes[k]);
  while (queue.length) {
    const id = queue.shift()!;
    const k = kidCount(g, id);
    if (!k) continue;
    if (!s.has(id)) {
      if (count + Math.min(k, AL.MORE_MAX) > budget) break;
      s.add(id);
      count += Math.min(k, AL.MORE_MAX);
    }
    for (const c of childrenOf(g, id)) if (g.nodes[c]) queue.push(c);
  }
  return s;
}
/** 聚焦某节点时：确保路径与它本身展开（返回新集合；未变化则返回原引用） */
export function expandFor(g: GraphState, prev: ReadonlySet<string>, focus: string): ReadonlySet<string> {
  const need = atlasChain(g, focus).filter((id) => kidCount(g, id) > 0 && !prev.has(id));
  if (!need.length) return prev;
  const s = new Set(prev);
  for (const id of need) s.add(id);
  return s;
}
```

### 4.8 结构距离（动效错开用）

```ts
/** 树上两节点的跳数（经最近公共祖先）；封顶 HOP_CAP */
export function hopFrom(g: GraphState, focus: string): (nodeId: string | null) => number {
  const chainF = atlasChain(g, focus);
  const depthF = new Map(chainF.map((id, i) => [id, i] as const));
  return (id) => {
    if (!id) return AL.HOP_CAP;
    const ch = atlasChain(g, id);
    let k = 0;
    while (k < ch.length && k < chainF.length && ch[k] === chainF[k]) k++;
    return Math.min(AL.HOP_CAP, ch.length - k + (chainF.length - k));
  };
}
```

### 4.9 跨组关系（版式没表达的边）

```ts
export interface AStrand { id: string; from: string; to: string; code: RelCode; p: number[]; color: string; colorB: string; w: number; dash: string; end: AEdge["end"]; start: AEdge["start"]; strong: boolean; viaRep: boolean; mid: { x: number; y: number } }

/** 只为「碰到 hot 集合」或 all=true 的边生成几何；端点不可见时连到最近的可见祖先（viaRep，画虚线） */
export function crossStrands(g: GraphState, sc: AtlasScene, o: { hot: ReadonlySet<string>; all: boolean; colors: FlowColors }): AStrand[] {
  const rep = (id: string): AGlyph | null => {
    if (sc.byNode.has(id)) return sc.byNode.get(id)!;
    for (const a of ancestors(g, id).reverse()) if (sc.byNode.has(a)) return sc.byNode.get(a)!;
    return sc.byNode.get(ROOT_ID) ?? null;
  };
  const out: AStrand[] = [];
  const seen = new Set<string>();
  for (const from of Object.keys(g.outEdges)) for (const e of g.outEdges[from] ?? []) {
    const key = ekey(e.from, e.to, e.code);
    if (seen.has(key) || sc.consumed.has(key) || e.from === e.to) continue;
    const strong = o.hot.has(e.from) || o.hot.has(e.to);
    if (!strong && !o.all) continue;
    const A = rep(e.from), B = rep(e.to);
    if (!A || !B || A === B) continue;
    seen.add(key);
    const ax = A.x + A.w / 2, ay = A.y + A.h / 2, bx = B.x + B.w / 2, by = B.y + B.h / 2;
    const horiz = Math.abs(bx - ax) >= Math.abs(by - ay);
    const sx = Math.sign(bx - ax) || 1, sy = Math.sign(by - ay) || 1;
    const p0 = horiz ? [sx > 0 ? A.x + A.w + 3 : A.x - 3, ay] : [ax, sy > 0 ? A.y + A.h + 3 : A.y - 3];
    const p3 = horiz ? [sx > 0 ? B.x - 5 : B.x + B.w + 5, by] : [bx, sy > 0 ? B.y - 5 : B.y + B.h + 5];
    const dist = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
    const k = Math.min(220, Math.max(40, dist * 0.4));
    const c1 = horiz ? [p0[0] + sx * k, p0[1]] : [p0[0], p0[1] + sy * k];
    const c2 = horiz ? [p3[0] - sx * k, p3[1]] : [p3[0], p3[1] - sy * k];
    const st = REL_STYLE[e.code];
    const viaRep = A.nodeId !== e.from || B.nodeId !== e.to;
    const mid = { x: 0.125 * p0[0] + 0.375 * c1[0] + 0.375 * c2[0] + 0.125 * p3[0], y: 0.125 * p0[1] + 0.375 * c1[1] + 0.375 * c2[1] + 0.125 * p3[1] };
    out.push({ id: `x:${key}`, from: e.from, to: e.to, code: e.code, p: [...p0, ...c1, ...c2, ...p3],
      color: strong ? o.colors.accent : A.color, colorB: strong ? o.colors.accent : B.color,
      w: st.width + 0.25, dash: viaRep ? "3 4" : st.dash, end: st.end as AEdge["end"], start: st.start as AEdge["start"], strong, viaRep, mid });
  }
  return out.slice(0, o.all ? 400 : 60);
}
```

### 4.10 空间导航（方向键）

```ts
/** 从 from 字形出发，在 dir 方向 ±60° 扇区内找「距离 + 2×横向偏离」最小的字形（跳过 more） */
export function spatialNext(sc: AtlasScene, fromId: string, dir: "up" | "down" | "left" | "right"): AGlyph | null {
  const A = sc.byNode.get(fromId);
  if (!A) return null;
  const ax = A.x + A.w / 2, ay = A.y + A.h / 2;
  const [ux, uy] = dir === "up" ? [0, -1] : dir === "down" ? [0, 1] : dir === "left" ? [-1, 0] : [1, 0];
  let best: AGlyph | null = null, bestS = Infinity;
  for (const B of sc.glyphs) {
    if (B === A || !B.nodeId) continue;
    const dx = B.x + B.w / 2 - ax, dy = B.y + B.h / 2 - ay;
    const along = dx * ux + dy * uy;
    if (along <= 4) continue;
    const across = Math.abs(dx * uy - dy * ux);
    if (across > along * Math.tan(Math.PI / 3)) continue;
    const s = along + 2 * across;
    if (s < bestS) { bestS = s; best = B; }
  }
  return best;
}
```

### 4.11 快照映射（交接用）

```ts
export interface DOMRectLike { left: number; top: number; width: number; height: number }
export interface FlowSnapshot { cut: string | null; readingId: string | null; items: Map<string, DOMRectLike>; bars: Map<string, DOMRectLike> }

/** 随文结构的图没有抬升材料根，全景抬升了：真实根 id → ROOT_ID */
export function normalizeSnapshot(s: FlowSnapshot, rootRealId: string | null): FlowSnapshot {
  if (!rootRealId) return s;
  const fix = (id: string) => (id === `n:${rootRealId}` ? `n:${ROOT_ID}` : id);
  return {
    cut: s.cut === rootRealId ? ROOT_ID : s.cut,
    readingId: s.readingId === rootRealId ? ROOT_ID : s.readingId,
    items: new Map([...s.items].map(([k, v]) => [fix(k), v] as const)),
    bars: new Map([...s.bars].map(([k, v]) => [k === rootRealId ? ROOT_ID : k, v] as const)),
  };
}
/** 快照里的行 → 全景字形 id 的映射（只认 `n:` 行） */
export const snapGlyphId = (itemId: string) => (itemId.startsWith("n:") ? `g:${itemId.slice(2)}` : null);
```

---

## 5. 画布 `src/components/reader/atlas/AtlasStage.tsx`

### 5.1 Props

```ts
export interface AtlasEntry { seq: number; origin: "button" | "flow" | "indicator"; nodeId: string | null; snapshot: FlowSnapshot | null }
export interface AtlasStageProps {
  graph: GraphState;                 // 已节流（§5.3）
  rootTitle: string;
  preview: boolean; loading: boolean; unsupported: boolean;
  focus: string;                     // 画布 id（材料根为 ROOT_ID）
  expanded: ReadonlySet<string>;
  showAll: ReadonlySet<string>;
  onFocus: (id: string) => void;     // 聚焦（宿主负责 expandFor）
  onToggle: (id: string) => void;    // 折叠钮
  onShowAll: (parentId: string) => void;
  readingId: string | null;
  phase: "entering" | "open" | "exiting";
  entry: AtlasEntry | null;
  snapshot: FlowSnapshot | null;     // 已 normalize
  relAll: boolean;
  zoom: number; onZoom: (k: number) => void;
  centerSeq: number;
  card: React.ReactNode;             // <AtlasCard/>；焦点为 ROOT 时 null
  onJump: (id: string) => void;      // 双击
  onExit: () => void;
  onExited: () => void;
  onGenerate?: () => void;
}
```

### 5.2 DOM

```tsx
<div className="atlas-stage" ref={stageRef} tabIndex={0} role="region" aria-label={T("结构全景")}
     data-phase={phase} data-panning={panning ? "1" : undefined} data-motion={motionOff ? "off" : undefined}
     data-frame0={frame0 ? "1" : undefined} onPointerDown/Move/Up/Leave onKeyDown onDoubleClick>
  <div className="atlas-bg" ref={bgRef} />
  <div className="atlas-world" data-lod={zoom < CAM.LOD_ZOOM ? "1" : undefined}
       style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
    <SvgRoot className="atlas-svg" aria-hidden="true">
      <defs>{/* 每条 ribbon 一个渐变 alg-*；每条 rel/seq/axis/strand 若 color≠colorB 一个描边渐变 als-*；marker 每种（end×颜色）一个，id 按颜色下标 */}</defs>
      <g className="atlas-zones">{/* 焦点组领地：1 个 rect */}</g>
      <g className="atlas-decos-under">{/* 反方区底色、斑马条（rect 且 opacity < 0.1 的 deco） */}</g>
      <g className="atlas-ribbons">{ribbons}</g>
      <g className="atlas-edges">{rel / seq / axis}</g>
      <g className="atlas-strands">{跨组关系 + 码章}</g>
      <g className="atlas-decos">{其余 deco：光点、圆点、刻度、文字、色带}</g>
    </SvgRoot>
    <div className="atlas-glyphs">{glyphs}</div>
  </div>
  <div className="atlas-overlay">{card 定位层（屏幕坐标）}</div>
  {stageEmpty}
</div>
```

- `<svg>` 用 `SvgRoot`；`atlas-svg` 样式 `position:absolute; left:0; top:0; width:1px; height:1px; overflow:visible`。
- 字形（HTML）：
  ```tsx
  <div key={gl.id} className="ag" data-ag={gl.id} data-node={gl.nodeId ?? undefined} data-kind={gl.kind}
       data-head={gl.head ? "1" : undefined} data-focus={gl.nodeId === focus ? "1" : undefined}
       data-reading={gl.nodeId === readingId ? "1" : undefined} data-dim={dimmed(gl) ? "1" : undefined}
       data-counter={gl.counter ? "1" : undefined} data-example={gl.example ? "1" : undefined} data-align={gl.align}
       style={{ transform: `translate(${x}px, ${y}px)`, width: gl.w, height: gl.h, opacity, transitionDelay, "--c": gl.color } as CSSProperties}
       title={gl.lines.join("")}>
    {gl.time ? <span className="ag-time">{gl.time}</span> : null}
    <span className="ag-text" style={{ fontSize: gl.fs, lineHeight: `${gl.lh}px`, fontWeight: gl.weight }}>
      {gl.lines.map((l, i) => <span key={i} className="ag-line">{gl.nodeId === readingId ? <mark className="flow-pill">{l}</mark> : l}</span>)}
    </span>
    {(gl.meta || gl.kids > 0) && gl.kind !== "cell" && gl.kind !== "more" ? (
      <span className="ag-meta">
        <span className="ag-type">{gl.meta}</span>
        {gl.kids > 0 && gl.kind !== "colhead" ? <button type="button" className="ag-fold" data-atlas-act="fold"
            aria-label={gl.expanded ? T("收起 {n} 个子节点", { n: gl.kids }) : T("展开 {n} 个子节点", { n: gl.kids })}>{gl.expanded ? "−" : `+${gl.kids}`}</button> : null}
      </span>
    ) : null}
    {gl.kind === "cell" && gl.kids > 0 ? <button type="button" className="ag-fold ag-fold-cell" data-atlas-act="fold">{gl.expanded ? "−" : `+${gl.kids}`}</button> : null}
  </div>
  ```
- 边（SVG）：ribbon → `<path className="atlas-ribbon" d fill="url(#alg-…)" style={{ d: \`path("…")\` }}/>`，渐变 `gradientUnits="objectBoundingBox" x1=0 y1=0 x2=1 y2=0`，stops：`[0: color @ aHL[tone]]、[1: colorB @ aEnd[tone]]`（tone：to 是焦点或在焦点路径上→1；悬停→2；否则 0）。path 边 → `<path className="atlas-edge" d fill="none" stroke strokeWidth strokeDasharray markerEnd markerStart opacity style={{ d: … }}/>`；`color≠colorB` 时 `stroke="url(#als-…)"`（objectBoundingBox，方向：`|dx|≥|dy|` 横向 x1=0→x2=1，否则纵向 y1=0→y2=1；若终点在起点左/上方则交换 stop 顺序）。
- 跨组关系：同 path 边；另在 `mid` 画码章（`circle r=8 fill=bg stroke=color 1px` + 10px 码字），`strong` 时 `stroke=accent`。
- path 的 `d`：`M p0,p1 C p2,p3 p4,p5 p6,p7 [C …]`，数字保留 1 位小数。**attribute 与 style 同时写 `d`**（与 `FlowLayer` 同做法：attribute 给测试，style 才能 CSS 过渡）。
- deco：rect / circle 的几何写在 style（`x/y/width/height/cx/cy/r` 可 CSS 过渡）；text 写 attribute x/y。

### 5.3 数据流

```ts
const g = props.graph; // MindmapTab 已用 useThrottled(graph, ATLAS_T.LAYOUT_THROTTLE) 节流
const colors = useMemo(() => resolveColors(stageEl), [stageEl, colorTick]); // 主题变化监听照抄 StructureFlowHost L209–221
const scene = useMemo(() => buildAtlas(g, { colors, rootTitle, expanded, showAll, readingId, patternLabel: (p) => T(PATTERN_LABEL[p]),
  rootMeta: (n) => T("全文 · {n} 节", { n }), moreLabel: (n) => T("另 {n} 项", { n }), counterLabel: T("反方一侧"), otherLabel: T("其他") }),
  [g, colors, rootTitle, expanded, showAll, readingId, T]);
const focusIn = scene.byNode.has(focus) ? focus : ROOT_ID;
const hop = useMemo(() => hopFrom(g, focusIn), [g, focusIn]);
const hot = useMemo(() => new Set([focusIn, ...(hoverId ? [hoverId] : [])]), [focusIn, hoverId]);
const strands = useMemo(() => crossStrands(g, scene, { hot, all: relAll, colors }), [g, scene, hot, relAll, colors]);
```
`useThrottled`：
```ts
export function useThrottled<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  const last = useRef(0), timer = useRef<number | null>(null), latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    const now = performance.now(), wait = last.current + ms - now;
    if (wait <= 0) { last.current = now; setV(value); return; }
    if (timer.current == null) timer.current = window.setTimeout(() => { timer.current = null; last.current = performance.now(); setV(latest.current); }, wait);
  }, [value, ms]);
  useEffect(() => () => { if (timer.current != null) window.clearTimeout(timer.current); }, []);
  return v;
}
```

### 5.4 相机

- 状态：`pan {x,y}`（屏幕 px）、`zoom`（由 props 控制）。世界 → 屏幕：`sx = pan.x + k·wx`，`sy = pan.y + k·wy`。
- **居中到节点**：`centerOn(gl)`：`pan = { x: round(W/2 − k·(gl.x + gl.w/2)), y: round(H·CAM.CENTER_Y − k·(gl.y + gl.h/2)) }`（W/H＝舞台 clientWidth/clientHeight，ResizeObserver 维护）。
- **何时居中（带过渡）**：`focusIn` 变化、`centerSeq` 变化、`scene` 变化且焦点字形位置变了、舞台尺寸变化。全部走 CSS 过渡（`.atlas-world { transition: transform var(--atlas-move) var(--flow-ease) }`），与字形的 `transform` 过渡同时长同曲线——焦点在屏幕上沿直线滑到中心。
- **用户平移**：拖动空白处（`target.closest(".ag, .atlas-card, button, input, select, a")` 为空），位移 > `CAM.DRAG_SLOP` 才 `setPointerCapture`（照抄 `MindmapCanvasV2` L640–676 的写法与 120ms 吞点击）；滚轮：`ctrlKey||metaKey` 绕指针缩放 `k' = clamp(k × (deltaY>0 ? 1/ZOOM_STEP : ZOOM_STEP), ZOOM_MIN, ZOOM_MAX)`、`pan' = c − (c − pan)·k'/k`；否则 `pan.y −= deltaY`、`pan.x −= shiftKey ? deltaY : deltaX`。平移/滚轮期间 `data-panning="1"`（关闭世界过渡），最后一次事件 `WHEEL_IDLE` 后撤掉。用户手动平移后，**直到下一次聚焦/居中之前**不再自动居中（`userMovedRef`）。
- **软边界**：`pan` 写入前夹到「场景包围盒至少 `PAN_MARGIN` 留在视口内」：`x ∈ [m − k·scene.w, W − m]`，`y ∈ [m − k·scene.h, H − m]`。
- 缩放按钮（工具栏）：以舞台中心为基准同上公式。

### 5.5 裁剪（性能）

- 可见窗口（世界坐标）：`[(−pan.x)/k − CULL_PAD, (W − pan.x)/k + CULL_PAD] × [(−pan.y)/k − CULL_PAD, (H − pan.y)/k + CULL_PAD]`。
- 只渲染与窗口相交的字形 / deco / 领地；边与跨组关系按端点包围盒相交判定。
- 窗口在平移结束、`WHEEL_IDLE` 后、`scene` 变化、相机居中过渡开始时重算（节流 `CULL_THROTTLE`）。相机过渡时把**起止两个窗口的并集**作为窗口，避免滑动途中边缘空白。
- 进出场状态用 `usePresence`（`src/lib/flow/presence.ts`）对**全量**列表计算，渲染时再按窗口过滤——被裁掉的元素回到视野时是 live 状态，不会重播进场。

### 5.6 进出场与动效状态机

`usePresence(scene.glyphs, ATLAS_T.REMOVE)`、`usePresence(edgesAll, ATLAS_T.REMOVE)`、`usePresence(scene.decos, ATLAS_T.REMOVE)`（`edgesAll`＝`scene.edges` + strands 转成 AEdge 形状）。每个元素的 `phase`：`enter`（首帧）→ `live`；`exit` 保留 200ms。

**(a) 展开 / 收起 / 增量到达（steady 下的场景变化）**
- 既有元素：位置变化走 CSS 过渡（`--atlas-move` 420ms）。
- 新字形：首帧（enter）画在**它父字形在新场景中的位置**（`scene.byNode.get(parentId)`，没有则自身位置），`opacity: 0`；转 live 后滑到自身位置、淡入 240ms，`transitionDelay = ENTER_DELAY + min(序号 × ENTER_STEP, ENTER_CAP)`（序号＝本批新字形按 x+y 升序）。
- 新 ribbon：enter 时几何取 `x1 = xs, t0 = s0, t1 = s1`（收在源头），live 后展开；延迟＝该边 to 字形延迟 + `EDGE_DELAY`。新 path 边：enter `opacity 0` → live 基础不透明度，延迟同上。
- 退场字形：滑向父字形当前位置 + 淡出 160ms，200ms 卸载；退场 ribbon 收回源头；退场 path 边淡出 120ms。
- 新 deco：同新字形（光点从父位置滑出）。

**(b) 进入·交接（有快照，且 `motionPreference() !== "off"`）**——该 `entry.seq` 第一次 `scene` 非空时执行一次：
1. 先算终点相机：`pan* = centerOn(焦点字形)`，`zoom = 1`（`onZoom(1)`）。
2. 设 `frame0 = true`（`data-frame0="1"`：CSS 关闭所有过渡）。对每个快照条目 `n:<id>` → 字形 `g:<id>`（`snapGlyphId`），把首帧位置设成快照矩形换算的世界坐标：`wx = (r.left − stageRect.left − pan*.x)/1`，`wy = (r.top − stageRect.top − pan*.y)/1`，宽度用 `r.width`；这些字形 `opacity 1`（keep 集）。其余字形 / 边 / deco `opacity 0`。相机直接落在 `pan*`。
3. 两次 `requestAnimationFrame` 后：`frame0 = false`，keep 字形换回真实坐标与宽度 → 420ms 滑到二维结构中的位置（焦点到正中）。
4. 其余字形：`transitionDelay = HOP_HANDOFF0 + (hop − 1) × HOP_HANDOFF`（hop≥1；hop=0 即焦点本身，必在 keep 内），淡入 240ms，起点＝自身位置（不从父位置滑出，避免与 keep 的滑动混在一起）。
5. 边：延迟＝两端字形延迟较大者 + `EDGE_DELAY`；ribbon 从源头展开，path 边淡入。deco：跟随所属字形（deco id 里的 nodeId 用 `id.split(":")[1]` 取；取不到按组头）。
6. 节点卡：延迟 `CARD_DELAY_HANDOFF` 出现。
7. 背景：挂载即 `bgRef.animate([{opacity:0},{opacity:1}], { duration: BG_IN, easing: "cubic-bezier(0,0,0.2,1)", fill: "backwards" })`。
8. `HOP_HANDOFF0 + HOP_CAP × HOP_HANDOFF + FADE_IN + 120`（≈1140）ms 后回到 steady（清掉 keep 与延迟）。

**(c) 进入·按钮 / 指示器（无快照）**：相机直接落在 `pan*`；所有元素 `opacity 0` → 1，延迟 `HOP_BUTTON0 + hop × HOP_BUTTON`；边 + `EDGE_DELAY`；节点卡 `CARD_DELAY_BUTTON`。图未就绪时先只显示背景与 §5.9 的加载骨架，就绪后的第一次渲染再执行。

**(d) 聚焦（点击 / 键盘 / 面包屑 / 搜索 / 关系）**：宿主 `expandFor` 可能改变展开集 → 场景变化按 (a)；同时相机居中按 §5.4——两者同一帧开始、同一 420ms，焦点滑到中心。

**(e) 退场（`phase` → `"exiting"`）**：字形 / deco / 边 `opacity → 0`，`transitionDelay = (HOP_CAP − hop) × HOP_EXIT`（远处先走），时长 160；背景 `animate([{opacity:1},{opacity:0}], { duration: BG_OUT, delay: BG_OUT_DELAY, easing: "cubic-bezier(0.4,0,1,1)", fill: "forwards" })`；`EXIT_DONE` 后 `onExited()`。

**(f) 换版本（`graph.mapId` 变化）**：重新播 (c)。

**(g) 减弱动效**（`motionPreference() === "off"` 或系统 reduce）：`data-motion="off"`；无 FLIP、无错开、无从父位置滑出、相机直接跳；只保留 `REDUCED` 120ms 透明度；退场 `onExited` 在 140ms 后。

### 5.7 事件

| 交互 | 处理 |
|---|---|
| 单击字形 `.ag` | 点到 `[data-atlas-act="fold"]` → `onToggle(nodeId)`；`kind="more"` → `onShowAll(parentId)`；其余 → `nodeId === focus ? centerSeq 式回中 : onFocus(nodeId)` |
| 双击字形 | `onJump(nodeId)`（ROOT / more 忽略） |
| 单击空白 | 无动作（不取消焦点） |
| 悬停字形 | 进入后 `HOVER_DWELL` 设 `hoverId`；离开 `HOVER_CLEAR` 后清（照抄 `StructureFlowHost` L944–947 的清除计时写法） |
| 悬停透视 | `hoverId` 非空时，`keepSet = {hover, 其父, 其可见子, 所有关系另一端（in/out 边，取 rep）}`；不在集合内的字形 `data-dim="1"`（opacity 0.28，160ms）；不碰 keepSet 的边 / ribbon 同样降到 0.28；碰到的边提到 tone 2 |

### 5.8 键盘（舞台挂载后 `stageRef.current.focus({ preventScroll: true })`；首行 `if (isImeComposing(e)) return;`）

| 键 | 动作 |
|---|---|
| ↑ ↓ ← → | `spatialNext(scene, focus, dir)` → `onFocus` |
| Alt + ↑ | 父节点（顶层 → ROOT） |
| Alt + ↓ | 第一个子节点（无子不动） |
| Enter | 焦点有子 → `onToggle(focus)`；无子且 `state` 为 `more/stub` → 深挖（经 props 回调） |
| Esc | `onExit()` |
| `/`、Ctrl/⌘+F | 聚焦 `[data-atlas-search]`，`preventDefault` |
| `+` `=` / `-` / `0` | 放大 / 缩小 / 100% 并居中 |

另：window 级 Esc（冒泡阶段）——目标不在 input/textarea/select/contentEditable、且工具栏无展开菜单（`document.querySelector('.atlas-toolbar [aria-expanded="true"]')` 为空）时 `onExit()`。

### 5.9 空态（舞台中心）

| 条件 | 呈现 |
|---|---|
| `loading` 且图为空 | 三条骨架线（宽 74/128/108，高 8，间距 10，`color-mix(fg 8%)`，`atlas-shimmer`）+「正在加载…」 |
| `unsupported` | 「当前材料没有可提取的文本结构（无目录且无章节），无法生成导图。」 |
| 非 loading、非 preview、根下无子节点 | 「本节还没有结构」+ 文字按钮「生成导图」（accent，`onGenerate`） |
| `preview` | 正常画目录骨架；焦点节点卡里「深挖」改为提示「生成导图后可以继续深挖」 |

---

## 6. 节点卡 `src/components/reader/atlas/AtlasCard.tsx`

**形态**：浮在焦点字形正下方 8px 的小卡（屏幕坐标，不随缩放变大小）；宽 `clamp(焦点字形屏幕宽, 280, 360)`；与字形左对齐（居中对齐字形 `align="center"` 时水平居中）；卡底超出舞台则翻到字形上方。外观：`background: var(--reader-bg)`、1px hairline、圆角 8、`box-shadow: 0 14px 36px -20px rgba(0,0,0,.35)`、内边距 8px 12px。

**定位**：`AtlasStage` 在 `.atlas-overlay` 内放 `<div className="atlas-card-slot" style={{ transform: translate(sx, sy) }}>{card}</div>`；`(sx, sy)` 由焦点字形世界坐标 × 相机实时换算。相机或字形在过渡中（420ms 内）时用 rAF 每帧重算（读焦点 `.ag` 元素的 `getBoundingClientRect()` 减舞台矩形，过渡结束停止），保证卡紧贴字形移动。

**内容**（复用随文结构的 `.flow-actions` / `.flow-explain` / `.flow-dots` / `.flow-status` 样式）：
```tsx
<div className="atlas-card" data-atlas-card={node.id} style={{ "--flow-delay": `${delay}ms` } as CSSProperties}>
  <div className="flow-actions">{按顺序过滤后用「·」分隔：跳到原文 / 讲解|收起讲解 / 深挖 / 制卡 / 展开结构|收起结构 / 详情|收起详情}</div>
  {explainOpen && <div className="flow-explain" style={{ maxHeight: FLOW.EXPLAIN_MAX_H }}>…与 FlowLayer 讲解块相同的三态…</div>}
  {detailOpen && <AtlasDetail …/>}
  {status && <div className="flow-status">{status}</div>}
</div>
```
- 条件：`跳到原文`＝`blockStart != null`；`讲解`＝`blockStart != null && state !== "streaming"`；`深挖`＝`state` 为 `more` / `stub`（preview 时替换为提示文字）；`制卡`＝有回调且非 streaming；`展开结构/收起结构`＝有子节点（等价折叠钮）；`详情` 恒有。按钮属性 `data-atlas-act="jump|explain|deepen|cards|fold|detail"`。
- 进场：`.atlas-card` 用 `flow-inline-in` 动画（`animation-delay: var(--flow-delay)`）；焦点切换时卡片 key 换成新节点 id（旧卡直接卸载，新卡 220ms 展开）。
- `.atlas-card` 内容区 `max-height: 340px; overflow-y: auto`（细滚动条同 `.flow-explain`）。
- **`AtlasDetail`**：`NodeDetailV2.tsx` 的数据逻辑原样搬入（`mindmapV2Api.nodeText`、`edgesOf`、手动版式、`STATE_LABEL`、学习状态、`仍要尝试深挖`），紧凑标记：
  ```tsx
  <div className="atlas-detail">
    <p className="atlas-detail-meta">{T(type)}{timeText ? ` · ${timeText}` : ""} · {T(STATE_LABEL[state] ?? state)}{v1ext ? ` · ${T("旧版")}` : ""}</p>
    {learnStatus && <p className="atlas-detail-meta">{T("已有 {n} 张卡", { n })}{kpExists ? ` · ${T("知识点已存在")}` : ""}</p>}
    {rels.length > 0 && <ul className="atlas-rel-list">{rels.map((e) => <li key={…}><button onClick={() => onFocusNode(other)}>{out ? T("本节点 {rel} → {title}", …) : T("{title} {rel} → 本节点", …)}</button></li>)}</ul>}
    {kids.length > 1 && <label className="atlas-detail-row"><span>{T("排列方式")}</span><select className="atlas-select" …>{自动 + PATTERN_KEYS}</select></label>}
    {text?.text && <button className="atlas-link-btn" onClick={toggleText}>{showText ? T("收起原文") : T("查看对应原文（{n} 字）", { n })}</button>}
    {showText && <blockquote className="atlas-source">{前 4000 字}</blockquote>}
    {state === "floor" && blockStart != null && <button className="atlas-link-btn" onClick={() => onDeepen(true)}>{T("仍要尝试深挖")}</button>}
  </div>
  ```
  改「排列方式」＝该组换版式 → 场景变化按 §5.6(a) 过渡（同 id 字形滑到新版式里的位置——这本身就是一段漂亮的「重新编排」动画）。

---

## 7. 工具栏 `src/components/reader/atlas/AtlasToolbar.tsx`

### 7.1 放置

Reader 在 `.reader-engine-controls` **最后**加 `<div className="atlas-toolbar-host" data-atlas-toolbar-host ref={setAtlasToolbarHost} />`；MindmapTab `createPortal(<AtlasToolbar/>, toolbarHost)`。根：`<div className="atlas-toolbar" role="toolbar" aria-label={T("结构全景")}>`。从左到右（`gap: var(--sp-2)`，全部 24px 高，复用 `.btn .btn-outline .btn-sm` 与 `.dd/.dd-btn/.dd-menu/.dd-item`）：

| 区块 | 内容 |
|---|---|
| 面包屑 `.atlas-crumbs`（`flex: 1 1 auto; min-width: 0`） | §7.2 |
| 状态 `.atlas-status` | §7.3；无内容不渲染 |
| 搜索 `.atlas-search-wrap` | §7.4 |
| 生成 | §7.5 |
| 版本 `AtlasMenu id="versions"` | §7.6 |
| 视图 `AtlasMenu id="view"` | 复选「显示全部关系」(`relAll`)；`dd-item`「全部展开到第 2 层」（展开集 ← `defaultExpanded(g, focus, 100000)` 但只保留深度 ≤ 2 的节点 ∪ 路径）；`dd-item`「只看焦点附近」（展开集 ← `atlasChain(focus)` ∪ {focus}）；分隔线；`dd-item`「导出 SVG」（图空时 disabled） |
| 缩放 `.atlas-zoom` | `−` / `{round(k×100)}%` / `+`；点百分比＝100% 并居中 |
| 居中 `[data-atlas-center]` | `centerSeq++` |

工具栏宽 < 860px（ResizeObserver）→ `data-narrow="1"`：状态只留圆点（文字进 title），搜索框默认 140px。

### 7.2 面包屑
- `chain = atlasChain(graph, focus)`；ROOT 显示 `rootTitle`（preview 加 `.atlas-chip`「目录预览」，旧版图加「旧版」）。
- 项 `<button className="atlas-crumb" data-crumb={id}>` 12px fg 62%（hover 100%）；末项 fg 90% / 600、`aria-current="page"` 不可点；分隔 `›` fg 30% 左右 4px。
- 超过 4 项：第 1 项 · `…`（`AtlasMenu` 列出中间项）· 最后 2 项。每项 `max-width:180px` 省略号；末项 260px。点击 → `onFocus(id)`。

### 7.3 状态
取第一个非空：`unsupported` 文案 → `feedLine` → `genRun`（`runLine(genRun)`）→ `allRun` → `notice`。
```tsx
<div className="atlas-status" data-atlas-status data-busy={busy ? "1" : undefined} title={text}>
  <i className="atlas-status-dot" aria-hidden="true" /><span className="atlas-status-text">{text}</span>
  {progress != null && <span className="atlas-status-bar" aria-hidden="true"><i style={{ width: `${Math.round(progress * 100)}%` }} /></span>}
  {isNotice && <button className="atlas-status-x" aria-label={T("关闭提示")} onClick={clearNotice}>×</button>}
</div>
```

### 7.4 搜索
- `<input className="atlas-search" data-atlas-search placeholder={T("搜索标题 / 讲解")}>`，默认 200px，聚焦 280px（`transition: width 160ms`）。
- 结果＝原 `searchResults` 逻辑（≤12 条）；输入框聚焦且有结果时弹 `.dd-menu.atlas-search-menu`；每条：标题 13px + `<small>` 父标题 11px。
- ↑↓ 高亮（`aria-activedescendant`）、Enter 选中（首行 `isImeComposing`）、Esc 清空收起（`stopPropagation`）。选中 → `onFocus(id)`（宿主 `expandFor` 会展开其祖先），清空并把焦点还给舞台。

### 7.5 生成（原侧栏「生成」区）
`[生成导图]`（主按钮，仅 `preview && !genRun`，`disabled={unsupported || feed.done === 0}`）`[停止]`（`genRun || allRun`；仅 allRun 时文字「停止深挖」）`[生成 ▾]` 菜单（`.atlas-menu-sec` 宽 320，内边距 12）：`!hasKey` → 「AI 未配置」+ 原说明，其余不显示；否则依次：发送前预览三行（`estimate && !genRun`）、原文读取提示（`!feedDone && !unsupported`）、`dd-item`「重新生成」（`!preview && !genRun`）、复选「忽略缓存重新分析…」、`dd-item`「深挖全部（{n}…）」（`!preview && mapId && moreCount > 0 && !allRun && !genRun`）、preview 提示（原 key）。全部回调沿用 MindmapTab 原函数。

### 7.6 版本
`AtlasMenu id="versions"` 宽 340：原「历史版本」区全部内容；每行 `[v2/旧版 徽标] 标题（当前）`、第二行时间 11px、行右「删除」文字钮（常显；hover 变 `var(--flow-counter)`）；当前版本 `aria-current="true"` + 左侧 2px accent 竖线。点行＝`setActive + loadMap + refreshVersions`，删除＝原 confirm + remove。

### 7.7 `AtlasMenu`
照抄 `Reader.tsx` 的 `ReaderToolMenu`（`.dd` / `.dd-btn` + `IconChevronDown` / `.dd-menu`）；工具栏持有 `openMenu`，同刻只开一个；`mousedown`（capture）点外部与 Esc（`stopPropagation`）收起；`data-atlas-menu={id}`。

---

## 8. `MindmapTab.tsx` 改写

### 8.1 Props（替换）

```ts
export interface MindmapTabProps {
  kernel: import("../../lib/reader/kernel").ReaderKernel;
  documentId: string;
  title: string;
  stageHost: HTMLDivElement | null;     // Reader 的 .reader-atlas-layer
  toolbarHost: HTMLDivElement | null;   // Reader 的 .atlas-toolbar-host
  open: boolean;
  entry: AtlasEntry | null;
  onExit: () => void;
  onExited: () => void;
  onJumpToText: (back: import("../../lib/reader/kernel").ReaderLocation | null) => void;
  onMakeCardsFromNode?: (payload: { nodeId: string; label: string; section: string; focus: string; unitAnchors: string[] }) => void;
  initialMapId?: string | null;
  initialResumeRunId?: string | null;
}
```
删除：`canvasHost`、`focusRequest`、`onFocusConsumed`、flash 相关、`anchorId`、`focus`（关系透视开关）、`canvasRef`、`revealNode`、`handleKeyDown`、`handlePrefetch`、`canvasView`、`<div className="mindmap-tab-panel">…</div>`、`MindmapCanvasV2` / `NodeDetailV2` import。
**逐字保留**：读图 / 增量合入 / 缓冲 / run 跟踪 / 挂载送原文 / 预估 / 续跑 / `handleGenerate` / `handleDeepen` / `handleExpandAll` / `handleCancel` / `requestExplain` / `persistView` / `setPattern` / `makeCards` / 版本 / `searchResults` / 学习状态 / 自动讲解 / `mindmap.viewed` 埋点。`toggleCollapse` 删除（折叠改由全景展开集负责，不写 `view.collapsed`）。

### 8.2 新状态

```ts
const [focusId, setFocusId] = useState<string>(ROOT_ID);
const [readingId, setReadingId] = useState<string | null>(null);
const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([ROOT_ID]));
const [showAll, setShowAll] = useState<ReadonlySet<string>>(() => new Set());
const [explainFor, setExplainFor] = useState<string | null>(null);
const [detailOpen, setDetailOpen] = useState(false);
const [relAll, setRelAll] = useState(false);
const [zoom, setZoom] = useState(1);
const [centerSeq, setCenterSeq] = useState(0);
const [phase, setPhase] = useState<"entering" | "open" | "exiting">("entering");
const userNavRef = useRef(false);
const throttledGraph = useThrottled(graph, ATLAS_T.LAYOUT_THROTTLE);

const navigate = useCallback((id: string) => {
  userNavRef.current = true;
  setExpanded((prev) => expandFor(graphRef.current, prev, id));
  setFocusId(id);
  setDetailOpen(false);
  setExplainFor((cur) => (cur === id ? cur : null));
}, []);
const toggle = useCallback((id: string) => {
  setExpanded((prev) => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); s.add(ROOT_ID); return s; });
}, []);
```
- `selectedId` 统一用 `focusId`（学习状态 / 自动讲解 / 制卡 / 讲解都以它为准；ROOT 映射到 `rootRef.current.node` 的逻辑保留）。
- 收起的节点若是焦点的祖先：焦点改为被收起的那个节点（`toggle` 后检查 `atlasChain(g, focusId)` 是否包含该 id，包含且 ≠ focus 则 `setFocusId(id)`）。
- 展开集**会话级记忆**：模块级 `const memo = new Map<string /*mapId*/, { expanded: Set<string>; focus: string }>()`；退出全景时写入，下次进入同一 mapId 若入口无指定节点则沿用。
- `open` 变化：`true` → `setPhase("entering")`，1200ms 后 `"open"`；`false` → `"exiting"`，Stage 的 `onExited` 转调 props。

### 8.3 进入时的焦点与展开（`entry.seq` 变化时执行一次）

```ts
const snap = entry?.snapshot ? normalizeSnapshot(entry.snapshot, rootRef.current.id) : null;
const toAtlasId = (id: string) => (id === rootRef.current.id ? ROOT_ID : id);
const want = entry?.nodeId ? toAtlasId(entry.nodeId) : snap?.readingId ?? null;
const g = graphRef.current;
const apply = (id: string) => { setFocusId(id); setExpanded(defaultExpanded(g, id)); };
if (snap?.readingId) setReadingId(snap.readingId);
if (want && (want === ROOT_ID || g.nodes[want])) apply(want);
else {
  const m = g.mapId ? memo.get(g.mapId) : null;
  if (m && (m.focus === ROOT_ID || g.nodes[m.focus])) { setFocusId(m.focus); setExpanded(m.expanded); }
  else apply(ROOT_ID);
  // 无快照：现场定位阅读节点；LOCATE_TIMEOUT 内拿到且用户未导航 → 导航过去
  const probe = kernel.getReadingProbe?.();
  if (probe) void Promise.race([mindmapV2Api.locate({ documentId, unitAnchor: probe.unitAnchor, text: probe.text }), sleep(ATLAS_T.LOCATE_TIMEOUT).then(() => null)])
    .then((r) => { const id = r && r.nodeId ? toAtlasId(r.nodeId) : null; if (!id) return; setReadingId(id); if (!userNavRef.current && graphRef.current.nodes[id]) navigate(id); userNavRef.current = false; });
}
```
（有快照时 `snap.readingId` 即阅读节点；`entry.origin === "flow"` 且 nodeId 为空＝随文结构没有选中项，用阅读节点。）

### 8.4 首帧必须有图：`mindmapV2Api.load` 加缓存（`src/lib/mindmapV2.ts`）

```ts
const loadCache = new Map<string, GraphLoadResult>(); // 键：documentId / `map:${mapId}`
// 在 mindmapV2Api.load 的返回 promise 上追加：
//   .then((r) => { if (r?.meta?.mapId) { loadCache.set(`map:${r.meta.mapId}`, r); if (typeof p !== "string" && "documentId" in p) loadCache.set(String(p.documentId), r); } return r; })
export function peekLoad(arg: string | { documentId: string }): GraphLoadResult | null {
  return loadCache.get(typeof arg === "string" ? `map:${arg}` : String(arg.documentId)) ?? null;
}
```
MindmapTab 初始 `graph`：`useState(() => { const c = peekLoad(initialMapId ?? { documentId }); const l = c ? liftLoad(c) : null; return l ? createGraph(l.load, String(l.load.meta.mapId)) : emptyGraph(null); })`；命中时同步设好 `rootRef` / `mapIdRef` / `loading=false`。挂载流程照旧 `loadMap` 一次（同 mapId 结果替换）。

### 8.5 跳到原文

```ts
const jumpToText = async (node: V2Node) => {
  const back = kernel.getCurrentLocation();
  const text = await mindmapV2Api.nodeText(mapIdRef.current!, node.id).catch(() => null);
  if (text?.unitAnchor) await kernel.goTo({ href: text.unitAnchor });
  const probe = (text?.text || "").replace(/\s+/g, " ").trim().slice(0, 20);
  if (probe.length >= 6) { try { await kernel.goTo({ search: probe }); } catch { /* best-effort */ } }
  props.onJumpToText(back);
};
```

### 8.6 渲染

```tsx
return (
  <>
    {toolbarHost && createPortal(<AtlasToolbar …/>, toolbarHost)}
    {stageHost && createPortal(
      <AtlasStage graph={throttledGraph} rootTitle={rootTitle} preview={preview} loading={loading} unsupported={unsupported}
        focus={focusId} expanded={expanded} showAll={showAll} onFocus={navigate} onToggle={toggle}
        onShowAll={(pid) => setShowAll((s) => new Set(s).add(pid))}
        readingId={readingId} phase={phase} entry={entry} snapshot={snap}
        relAll={relAll} zoom={zoom} onZoom={setZoom} centerSeq={centerSeq}
        card={focusId === ROOT_ID || !selected ? null : <AtlasCard key={focusId} … />}
        onJump={(id) => { const n = graphRef.current.nodes[id]; if (n) void jumpToText(n); }}
        onExit={onExit} onExited={onExited} onGenerate={() => void handleGenerate()} />,
      stageHost)}
  </>
);
```
**导出 SVG**（视图菜单）：不再有画布句柄，改为纯函数（把 `MindmapCanvasV2` 里 `frameLabel` / `labels` / `relName` 三个 `useMemo` 原样复制过来）：
```ts
const d = layoutGraph(graph, { cache: createLayoutCache(), locks: {}, lodExpanded: new Set(), frameLabel, rootTitle, noLod: true });
const routed = routeRelations(graph, d, { relAll: true, geometry: "all", relName });
const raw = buildCanvasSvg(d, routed, {}, { static: true, graph, rootTitle, labels, idPrefix: "mm2x-" });
const svg = DOMPurify.sanitize(raw, { USE_PROFILES: { svg: true, svgFilters: true } });
// 下载逻辑照原 exportSvg
```
（导出仍是旧版卡片样式的整图，本轮不改。）

---

## 9. 随文结构 → 结构全景的交接

### 9.1 时间线（0＝点击「在结构全景中查看」）

| 时刻 | 元素 | 变化 | 时长 / 曲线 |
|---|---|---|---|
| 0（同步） | 随文结构 | 拍快照 + 克隆两层挂到 body；宿主立即卸载渲染层（无关闭编排） | — |
| 0 | 克隆上层 | 已匹配的行 / 竖条隐藏；其余淡出 | 160 / `(.4,0,1,1)` |
| 0 | 克隆混合层（正文高亮彩带） | 淡出 | 200 |
| 0 | 全景背景 | 0 → 1 | 240 / `(0,0,.2,1)` |
| 0 | 匹配到的节点（焦点 + 同组兄弟） | 画在原屏幕位置（与随文结构的行完全重合） | — |
| ≈32（2 帧） | 同上 | 滑到二维结构中的位置；焦点停在舞台中心（宽 50%、高 45%） | **420** / `--flow-ease` |
| 220 | 克隆 | 移除 | — |
| 280 | 正文 | 随文结构的平移 / 预留在背景下归位 | 原 420 |
| 300 + (hop−1)×60 | 其余节点（按结构距离由近及远） | 淡入 | 240 |
| 节点延迟 + 120 | 流带 / 边 | 流带从源头流出、边淡入 | 420 / 240 |
| 460 | 节点卡 | 展开 | 220 |
| ≈1140 | — | 回到 steady | — |

### 9.2 `src/components/reader/atlas/handoff.ts`

```ts
import type { DOMRectLike, FlowSnapshot } from "../../../lib/flow/atlasLayout";
import { ATLAS_T } from "../../../lib/flow/atlasLayout";
import { motionPreference } from "../../../lib/mindmap/v2/animate";

const rectOf = (el: Element): DOMRectLike => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };

/** 同步采集随文结构当前代（必须在任何 setState 之前调用）。随文结构未打开 → null */
export function captureFlowSnapshot(doc: Document): FlowSnapshot | null {
  const layer = doc.querySelector<HTMLElement>(".flow-layer");
  if (!layer) return null;
  const gens = Array.from(layer.querySelectorAll<HTMLElement>('.flow-gen:not([data-phase="exit"])'));
  const gen = gens[gens.length - 1];
  if (!gen) return null;
  const gk = gen.getAttribute("data-gen");
  const snap: FlowSnapshot = { cut: gk && gk !== "none" ? gk : null, readingId: null, items: new Map(), bars: new Map() };
  for (const el of Array.from(gen.querySelectorAll<HTMLElement>(".flow-item[data-flow-item]"))) {
    if (el.classList.contains("is-peek") || el.classList.contains("is-exit")) continue;
    const id = el.getAttribute("data-flow-item")!;
    snap.items.set(id, rectOf(el));
    if (el.getAttribute("data-reading") === "1" && id.startsWith("n:")) snap.readingId = id.slice(2);
  }
  for (const el of Array.from(gen.querySelectorAll('[data-prim-id^="bar:"]'))) snap.bars.set(el.getAttribute("data-prim-id")!.slice(4), rectOf(el));
  return snap;
}

/** 克隆两层并淡出（各自直接挂 body——不要包容器，否则混合层的 mix-blend-mode 被隔离） */
export function playFlowGhost(doc: Document, snap: FlowSnapshot): void {
  const off = motionPreference() === "off";
  const ghost = (src: Element | null, ms: number, hideMatched: boolean) => {
    if (!src) return;
    const c = src.cloneNode(true) as HTMLElement;
    c.setAttribute("data-atlas-ghost", "1");
    c.style.pointerEvents = "none";
    c.style.zIndex = "25";
    if (hideMatched) {
      for (const el of Array.from(c.querySelectorAll<HTMLElement>(".flow-item[data-flow-item]"))) {
        const id = el.getAttribute("data-flow-item")!;
        if (id.startsWith("n:") && snap.items.has(id)) el.style.visibility = "hidden";
      }
    }
    doc.body.appendChild(c);
    const dur = off ? ATLAS_T.REDUCED : ms;
    if (typeof c.animate === "function") c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" });
    else c.style.opacity = "0";
    window.setTimeout(() => c.remove(), Math.max(dur, ATLAS_T.GHOST_REMOVE));
  };
  ghost(doc.querySelector(".flow-blend"), ATLAS_T.GHOST_BLEND_OUT, false);
  ghost(doc.querySelector(".flow-layer"), ATLAS_T.GHOST_LAYER_OUT, true);
}
```
- 随文结构的竖条不交接（全景的竖条是字形自身的 CSS 竖条，跟着字形走），克隆里的竖条随克隆淡出即可。
- 快照里有、但全景当前展开集里没有对应字形的行（例如随文结构展开的子项而全景还没展开）：不会匹配，随克隆淡出；§8.3 的 `defaultExpanded(g, focus)` 会展开焦点本身，所以焦点的子项会在全景里按 hop=1 很快出现。

### 9.3 `StructureFlowHost` 改动

1. `function resolveColors` → `export function resolveColors`。
2. Props 增 `coverMode?: "fade" | "handoff"`（缺省 `"fade"`）。
3. 新增：
   ```ts
   const handoffClose = useCallback(async () => {
     const ticket = ++ticketRef.current;
     setStage("closed");
     setMotion("steady");
     setArmed(false);
     await sleep(ATLAS_T.HANDOFF_RESET);
     if (ticket !== ticketRef.current) return;
     applyShift(0);
     applyGutter(0);
     if (shiftEl) shiftEl.style.opacity = "";
     setTracking(false);
     trackingRef.current = false;
     setGeo(null);
     geoRef.current = null;
     sigRef.current = "";
   }, [applyShift, applyGutter, shiftEl]);
   ```
4. 开合 effect（约 L484–492）：
   ```ts
   } else if (stageRef.current === "opening" || stageRef.current === "open") {
     if (covered && props.coverMode === "handoff") void handoffClose();
     else void closeSeq();
   }
   ```
   依赖加 `handoffClose`、`props.coverMode`。
5. 全景退出后 `covered` 回落 → 宿主照常 `openSeq()`。

### 9.4 `FlowLayer.tsx`

- 动作行（约 L132）：`T("在完整图谱中打开")` → `T("在结构全景中查看")`。
- `const SvgRoot` → `export const SvgRoot`。
- 其余**不改**（v1 文档里对 `UpperGen` 的 `openBase` / `keepIds` 改动全部作废）。

---

## 10. `Reader.tsx`

### 10.1 状态

```ts
const [atlasOpen, setAtlasOpen] = useState(false);
const [atlasMounted, setAtlasMounted] = useState(false);
const [atlasEntry, setAtlasEntry] = useState<AtlasEntry | null>(null);
const [atlasLayerHost, setAtlasLayerHost] = useState<HTMLDivElement | null>(null);
const [atlasToolbarHost, setAtlasToolbarHost] = useState<HTMLDivElement | null>(null);
const [backChip, setBackChip] = useState<ReaderLocation | null>(null);
const backChipTimer = useRef<number | null>(null);
const wrapRef = useRef<HTMLDivElement | null>(null);       // 挂到 .reader-wrap
const atlasBtnRef = useRef<HTMLButtonElement | null>(null);

const openAtlas = useCallback((origin: AtlasEntry["origin"], nodeId: string | null) => {
  const snapshot = origin === "indicator" ? null : captureFlowSnapshot(document); // 必须在任何 setState 之前
  if (snapshot) playFlowGhost(document, snapshot);
  setToolMenu(null);
  setAtlasEntry({ seq: Date.now(), origin, nodeId, snapshot });
  setAtlasMounted(true);
  setAtlasOpen(true);
}, []);
const closeAtlas = useCallback(() => setAtlasOpen(false), []);
```
删除：`mapFocus`、`mapLayerHost`、`sidebarTab === "map"` 相关一切；`lensOpenInMapRef.current = (nodeId) => openAtlas("flow", nodeId);`；`openMindmapInitially` effect 改为 `openAtlas("indicator", null); onMindmapOpened?.();`（不再展开侧栏）。

### 10.2 左上按钮（「展开/收起」开关之后）

```tsx
{lensKernel && contextRef?.documentId ? (
  <button ref={atlasBtnRef} type="button" className="bar-btn reader-atlas-toggle" data-reader-atlas-toggle aria-pressed={atlasOpen}
    title={atlasOpen ? T("返回阅读（Esc）") : T("结构全景：整本材料的结构，以正在读的位置为中心展开")}
    onClick={() => (atlasOpen ? closeAtlas() : openAtlas("button", null))}>
    <span key={atlasOpen ? "on" : "off"} className="reader-atlas-toggle-label">{atlasOpen ? T("返回阅读") : T("结构全景")}</span>
    <span aria-hidden="true">{atlasOpen ? T("结构全景") : T("返回阅读")}</span>
  </button>
) : null}
```
宽度变量：
```ts
useLayoutEffect(() => {
  const btn = atlasBtnRef.current, wrap = wrapRef.current;
  if (!wrap) return;
  if (!btn) { wrap.style.removeProperty("--reader-atlas-btn-w"); return; }
  const set = () => wrap.style.setProperty("--reader-atlas-btn-w", `${Math.ceil(btn.getBoundingClientRect().width) + 8}px`);
  set();
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(set) : null;
  ro?.observe(btn);
  return () => ro?.disconnect();
}, [lensKernel, contextRef?.documentId]);
```

### 10.3 宿主

- `.reader-engine-controls` 加 `data-atlas={atlasOpen ? "1" : undefined}`，**最后**加 `<div className="atlas-toolbar-host" data-atlas-toolbar-host ref={setAtlasToolbarHost} />`。
- `.reader-engine-viewport` 内、`reader-flow-gutter` 之后加 `<div className="reader-atlas-layer" data-reader-atlas-layer ref={setAtlasLayerHost} />`；删除 `.reader-engine-main` 里的 `.reader-map-layer`。
- MindmapTab（放在 `StructureFlowHost` 之前）：
  ```tsx
  {atlasMounted && contextRef?.documentId && lensKernel ? (
    <MindmapTab kernel={kernelRef.current!} documentId={contextRef.documentId} title={title || sourceTitle || T("未命名材料")}
      stageHost={atlasLayerHost} toolbarHost={atlasToolbarHost} open={atlasOpen} entry={atlasEntry}
      onExit={closeAtlas} onExited={() => { setAtlasMounted(false); setAtlasEntry(null); }}
      onJumpToText={(back) => { track("reader.jumped", { libraryItemId: itemId, origin: "mindmap", props: { method: "mindmap" } }); closeAtlas(); if (back) showBackChip(back); }}
      initialMapId={openMindmapMapId || null} initialResumeRunId={resumeOnce}
      onMakeCardsFromNode={(payload) => { void runAICards(payload.section, undefined, "card-structure", { focus: payload.focus, mindmapNodeId: payload.nodeId }); }} />
  ) : null}
  ```
- `StructureFlowHost`：`covered={atlasMounted}`、`coverMode={atlasEntry?.snapshot ? "handoff" : "fade"}`、`onOpenInMap={(id) => lensOpenInMapRef.current(id)}`。

### 10.4 返回原处

```ts
const showBackChip = (loc: ReaderLocation) => {
  setBackChip(loc);
  if (backChipTimer.current) window.clearTimeout(backChipTimer.current);
  backChipTimer.current = window.setTimeout(() => setBackChip(null), 20000);
};
```
`.reader-engine-controls-group` 里「随文结构」按钮之前：
```tsx
{backChip ? <button type="button" className="btn btn-outline btn-sm reader-back-chip" data-reader-back-chip
  onClick={() => { const l = backChip; setBackChip(null); if (l) void kernelRef.current?.goTo(l); }}>{T("↩ 回到刚才的位置")}</button> : null}
```

### 10.5 「随文结构」按钮

文字 `T("随文结构")`；title 开 → `T("收起随文结构")`，关 → `T("随文结构：在正文右侧显示正在读的这一段所在的结构")`。

### 10.6 规则

| 场景 | 行为 |
|---|---|
| 进入全景 | 不改 `sidebarOpen` |
| 全景中展开侧栏 | 允许；舞台变窄 → 相机重新居中（420ms）；随文结构的 §12.1 旧规则不变 |
| 全景中点侧栏目录条目 | 先 `closeAtlas()` 再跳转 |
| Esc | `closeAtlas()` |
| 退出全景 | 工具带淡回；`onExited` 后 `covered=false` → 随文结构若原本开着按原编排重新出现 |
| markdown（粘贴书） | 无内核，不显示左上按钮 |

---

## 11. `ReaderSidebar.tsx`

- `export type ReaderTab = "toc" | "extracts";`；`tabs` 只剩目录 / 摘录；删 `mapPanel` prop 与 `shown === "map"` 分支。
- 着陆：`const shown = tab === "toc" && flat.length === 0 && extractsPanel ? "extracts" : tab;`
- 文件头注释改为：「两页签（目录 / 摘录）；图谱移出侧栏，改为左上「结构全景」独立入口（D254）」。
- Reader 删 `mapPanel={…}` 整段与所有 `"map"` 页签用法。

---

## 12. 视觉规格（自查表）

| 部件 | 规格 |
|---|---|
| 舞台 | 背景 `--reader-bg`；字色 `--reader-fg`；夜间阅读主题自动深色（`resolveColors` 按阅读背景判深浅） |
| 颜色 | 组内第 i 个子节点 `palette[i % 8]`（与随文结构同一规则 → 交接不变色）；阅读节点主题色 pill；焦点主题色字 + 1px 下划线；强关系线主题色；反方 `--flow-counter` |
| 普通标签（plate） | 13/18，500，左侧 4px 圆角竖条（节点色）；文字左内边距 12；类型字行 10.5px fg 46%；折叠钮 `+N` / `−` 10.5px，hover fg 90% |
| 组头（`data-head`） | 字号 +1、字重 600 |
| 主张（claim） | 15/21，640，居中；底部居中 28×2 节点色短线 |
| 例证 | 3px 点状竖条，文字 tone 72 |
| 反方 | 斜纹竖条（`repeating-linear-gradient(45deg, var(--c) 0 2px, transparent 2px 4px)`）；类型字反方色前缀「⟂ 」 |
| 瓷砖（tile） | 宽 184；顶部 3px 节点色带；文字上内边距 8 |
| 事件（event） | 上方一行时间 11px 等宽 fg 58%；光点 r5（阅读 r6.5 主题色）2px 背景色描边；细茎 1px fg 25% |
| 步骤（step） | 圆点 r12 节点色、白色等宽序号 11px 650；标签居中于圆点下 10px |
| 对照表 | 栏顶 4px 色带；栏名 14/19 620；单元格 12.5/18；维度名 11px fg 52%；隔行 fg 3%；行线 fg 8% |
| 根 | 20/26 650，6px 前景色竖条，副标题「全文 · n 节」 |
| 扇形流带 | 渐变节点色 `aHL[tone] → aEnd[tone]`；tone：焦点路径 1、悬停 2、其余 0 |
| 关系线 | `REL_STYLE` 线宽 + 0.25、虚线、端头；隐含关系不透明度 0.55；跨组关系码章 r8 |
| 焦点组领地 | 焦点节点自身的组（若已展开），否则焦点父组：圆角 16 的矩形，外扩 18px，填 `组头色` 5% |
| 悬停透视 | 无关元素 0.28 |
| 低缩放（< 0.5） | 隐藏类型字行、时间行，标签只留首行 |

---

## 13. CSS（`src/theme.css`）

**改现有规则 1**（`.reader-engine-controls`，约 L5563）：`padding: var(--sp-2) var(--sp-4) var(--sp-2) var(--sp-16);` →
`padding: var(--sp-2) var(--sp-4) var(--sp-2) calc(var(--sp-16) + var(--reader-atlas-btn-w, 0px));`

**改现有规则 2**（`.reader-sidebar .tabs`，约 L5907）：`padding: var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-16);` →
`padding: var(--sp-2) var(--sp-2) var(--sp-2) calc(var(--sp-16) + var(--reader-atlas-btn-w, 0px));`

**新增节**（不写 `!important`；颜色只用变量）：

```css
/* ===================== 结构全景（D254 v2，docs/design/STRUCTURE-ATLAS-D254.md） ===================== */
:root { --atlas-move: 420ms; }

/* 左上入口 */
.reader-atlas-toggle.bar-btn {
  position: fixed; left: calc(var(--sp-4) + 40px + var(--sp-2)); top: calc(48px + var(--sp-2));
  z-index: calc(var(--z-sticky) + 1); height: 24px; padding: 0 var(--sp-3);
  display: inline-grid; place-items: center; font-size: var(--fs-meta);
  border-color: var(--border-subtle); color: var(--text-helper);
  transition: color 160ms var(--flow-ease), border-color 160ms var(--flow-ease), background-color 160ms var(--flow-ease);
}
.reader-atlas-toggle.bar-btn > span { grid-area: 1 / 1; }
.reader-atlas-toggle.bar-btn > span[aria-hidden="true"] { visibility: hidden; }
.reader-atlas-toggle.bar-btn:hover { border-color: var(--text-primary); color: var(--text-primary); }
.reader-atlas-toggle.bar-btn[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.reader-atlas-toggle-label { animation: atlas-label-in 160ms var(--flow-ease) both; }
@keyframes atlas-label-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }

/* 工具带交叉淡化 */
.reader-engine-controls > .atlas-toolbar-host { position: absolute; inset: 0; display: flex; align-items: center; padding: inherit; opacity: 0; pointer-events: none; transition: opacity 160ms var(--flow-ease); }
.reader-engine-controls > .atlas-toolbar-host:empty { display: none; }
.reader-engine-controls[data-atlas="1"] > .atlas-toolbar-host { opacity: 1; pointer-events: auto; transition-delay: 60ms; }
.reader-engine-controls > :not(.atlas-toolbar-host) { transition: opacity 120ms cubic-bezier(0.4, 0, 1, 1); }
.reader-engine-controls[data-atlas="1"] > :not(.atlas-toolbar-host) { opacity: 0; pointer-events: none; }
.reader-back-chip { color: var(--accent); }

/* 工具栏 */
.atlas-toolbar { display: flex; align-items: center; gap: var(--sp-2); width: 100%; min-width: 0; }
.atlas-crumbs { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; overflow: hidden; font-size: 12px; }
.atlas-crumb { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: none; border: none; padding: 0; font: inherit; cursor: pointer; color: color-mix(in srgb, var(--reader-fg, var(--ink)) 62%, transparent); }
.atlas-crumb:hover { color: var(--reader-fg, var(--ink)); }
.atlas-crumb[aria-current="page"] { max-width: 260px; cursor: default; font-weight: 600; color: color-mix(in srgb, var(--reader-fg, var(--ink)) 90%, transparent); }
.atlas-crumb-sep { margin: 0 4px; color: color-mix(in srgb, var(--reader-fg, var(--ink)) 30%, transparent); }
.atlas-chip { margin-left: 6px; padding: 0 5px; font-size: 10px; line-height: 14px; border: 1px solid color-mix(in srgb, var(--reader-fg, var(--ink)) 22%, transparent); color: color-mix(in srgb, var(--reader-fg, var(--ink)) 62%, transparent); }
.atlas-status { position: relative; display: inline-flex; align-items: center; gap: 6px; max-width: 260px; font-size: 12px; color: color-mix(in srgb, var(--reader-fg, var(--ink)) 62%, transparent); }
.atlas-status-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.atlas-status-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: color-mix(in srgb, var(--reader-fg, var(--ink)) 40%, transparent); }
.atlas-status[data-busy="1"] .atlas-status-dot { background: var(--accent); animation: flow-dot 1200ms var(--flow-ease) infinite ease-in-out; }
.atlas-status-bar { position: absolute; left: 12px; right: 0; bottom: -3px; height: 1px; background: color-mix(in srgb, var(--reader-fg, var(--ink)) 10%, transparent); }
.atlas-status-bar i { display: block; height: 100%; background: var(--accent); transition: width 300ms var(--flow-ease); }
.atlas-status-x { background: none; border: none; padding: 0 2px; font: inherit; cursor: pointer; color: inherit; }
.atlas-toolbar[data-narrow="1"] .atlas-status-text { display: none; }
.atlas-search-wrap { position: relative; }
.atlas-search { width: 200px; height: 24px; padding: 0 var(--sp-2); font-size: 12px; border: var(--bw-hairline) solid var(--reader-border, var(--border-subtle)); background: transparent; color: inherit; transition: width 160ms var(--flow-ease); }
.atlas-search:focus { width: 280px; outline: none; border-color: var(--accent); }
.atlas-toolbar[data-narrow="1"] .atlas-search { width: 140px; }
.atlas-search-menu { position: absolute; top: 28px; left: 0; min-width: 280px; max-height: 360px; overflow-y: auto; }
.atlas-search-menu .dd-item small { display: block; font-size: 11px; color: var(--text-helper); }
.atlas-menu-sec { width: 320px; padding: var(--sp-3); font-size: 13px; }
.atlas-menu-note { font-size: 12px; color: var(--text-helper); margin: 0 0 var(--sp-2); }
.atlas-zoom { display: inline-flex; align-items: center; height: 24px; border: var(--bw-hairline) solid var(--reader-border, var(--border-subtle)); }
.atlas-zoom button { background: none; border: none; height: 22px; min-width: 24px; padding: 0 6px; font: inherit; font-size: 12px; color: inherit; cursor: pointer; font-variant-numeric: tabular-nums; }

/* 舞台 */
.reader-atlas-layer { position: absolute; inset: 0; z-index: 7; }
.reader-atlas-layer:empty { display: none; }
.atlas-stage { position: absolute; inset: 0; overflow: hidden; outline: none; color: var(--reader-fg, var(--ink)); font-family: var(--font-sans); user-select: none; -webkit-user-select: none; touch-action: none; }
.atlas-stage[data-panning="1"] { cursor: grabbing; }
.atlas-stage:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); }
.atlas-bg { position: absolute; inset: 0; background: var(--reader-bg, var(--paper)); }
.atlas-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; transition: transform var(--atlas-move) var(--flow-ease); }
.atlas-stage[data-panning="1"] .atlas-world { transition: none; }
.atlas-svg { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; }
.atlas-svg path { transition: d var(--atlas-move) var(--flow-ease), opacity 240ms var(--flow-ease); }
.atlas-svg rect, .atlas-svg circle {
  transition: x var(--atlas-move) var(--flow-ease), y var(--atlas-move) var(--flow-ease), width var(--atlas-move) var(--flow-ease), height var(--atlas-move) var(--flow-ease),
    cx var(--atlas-move) var(--flow-ease), cy var(--atlas-move) var(--flow-ease), r 200ms var(--flow-ease), fill 200ms var(--flow-ease), opacity 240ms var(--flow-ease);
}
.atlas-svg text { transition: opacity 240ms var(--flow-ease); }

/* 字形 */
.ag {
  position: absolute; left: 0; top: 0; box-sizing: border-box; padding: 4px 8px 4px 12px; cursor: pointer;
  transition: transform var(--atlas-move) var(--flow-ease), width var(--atlas-move) var(--flow-ease), height var(--atlas-move) var(--flow-ease), opacity 240ms var(--flow-ease);
}
.ag[data-kind="tile"], .ag[data-kind="event"], .ag[data-kind="step"], .ag[data-kind="colhead"], .ag[data-kind="cell"], .ag[data-kind="claim"] { padding: 4px 4px; }
.ag[data-kind="tile"] { padding-top: 8px; }
.ag[data-align="center"] { text-align: center; }
.ag::before { content: ""; position: absolute; left: 0; top: 3px; bottom: 3px; width: 4px; border-radius: 2px; background: var(--c); }
.ag[data-kind="tile"]::before, .ag[data-kind="colhead"]::before, .ag[data-kind="event"]::before, .ag[data-kind="step"]::before, .ag[data-kind="cell"]::before { display: none; }
.ag[data-kind="tile"]::before { display: block; left: 0; right: 0; top: 0; bottom: auto; width: auto; height: 3px; }
.ag[data-kind="root"]::before { width: 6px; background: color-mix(in srgb, var(--reader-fg, var(--ink)) 70%, transparent); }
.ag[data-kind="more"]::before { background: color-mix(in srgb, var(--reader-fg, var(--ink)) 18%, transparent); }
.ag[data-kind="claim"]::before { display: block; left: 50%; right: auto; top: auto; bottom: 0; width: 28px; height: 2px; transform: translateX(-50%); }
.ag[data-example="1"]::before { width: 3px; background: radial-gradient(circle, var(--c) 1.2px, transparent 1.5px) 0 0 / 3px 5px repeat-y; }
.ag[data-counter="1"]::before { background: repeating-linear-gradient(45deg, var(--c) 0 2px, transparent 2px 4px); }
.ag[data-head="1"] .ag-text { font-weight: 600; }
.ag-text { display: block; color: color-mix(in srgb, var(--reader-fg, var(--ink)) 90%, transparent); }
.ag-line { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ag[data-kind="cell"] .ag-text { color: color-mix(in srgb, var(--reader-fg, var(--ink)) 84%, transparent); }
.ag[data-kind="more"] .ag-text { color: color-mix(in srgb, var(--reader-fg, var(--ink)) 52%, transparent); }
.ag-time { display: block; font-family: var(--font-mono, inherit); font-variant-numeric: tabular-nums; font-size: 11px; line-height: 15px; color: color-mix(in srgb, var(--reader-fg, var(--ink)) 58%, transparent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ag-meta { display: flex; align-items: center; gap: 6px; height: 15px; font-size: 10.5px; color: color-mix(in srgb, var(--reader-fg, var(--ink)) 46%, transparent); }
.ag[data-align="center"] .ag-meta { justify-content: center; }
.ag[data-counter="1"] .ag-type { color: var(--flow-counter); }
.ag[data-counter="1"] .ag-type::before { content: "⟂ "; }
.ag-fold { background: none; border: none; padding: 0 2px; font: inherit; font-variant-numeric: tabular-nums; color: inherit; cursor: pointer; }
.ag-fold:hover { color: color-mix(in srgb, var(--reader-fg, var(--ink)) 90%, transparent); }
.ag-fold-cell { position: absolute; right: 4px; bottom: 2px; font-size: 10.5px; }
.ag:hover .ag-text { color: var(--reader-fg, var(--ink)); }
.ag[data-focus="1"] .ag-text { color: var(--accent); text-decoration: underline 1px; text-underline-offset: 3px; }
.ag[data-dim="1"] { opacity: 0.28; transition-duration: var(--atlas-move), var(--atlas-move), var(--atlas-move), 160ms; }
.atlas-world[data-lod="1"] .ag-meta, .atlas-world[data-lod="1"] .ag-time, .atlas-world[data-lod="1"] .ag-line + .ag-line { display: none; }

/* 节点卡 */
.atlas-overlay { position: absolute; inset: 0; pointer-events: none; }
.atlas-card-slot { position: absolute; left: 0; top: 0; pointer-events: auto; }
.atlas-card {
  box-sizing: border-box; padding: 6px 12px 8px; max-height: 340px; overflow-y: auto;
  background: var(--reader-bg, var(--paper)); border: 1px solid color-mix(in srgb, var(--reader-fg, var(--ink)) 12%, transparent);
  border-radius: 8px; box-shadow: 0 14px 36px -20px rgba(0, 0, 0, 0.35);
  animation: flow-inline-in 220ms var(--flow-ease) both; animation-delay: var(--flow-delay, 0ms);
}
.atlas-card .flow-actions { flex-wrap: wrap; height: auto; min-height: 26px; }
.atlas-detail { padding: 4px 0 2px; font-size: 12px; line-height: 18px; color: color-mix(in srgb, var(--reader-fg, var(--ink)) 78%, transparent); }
.atlas-detail-meta { margin: 0 0 4px; color: color-mix(in srgb, var(--reader-fg, var(--ink)) 52%, transparent); }
.atlas-rel-list { list-style: none; margin: 4px 0; padding: 0; }
.atlas-rel-list button, .atlas-link-btn { background: none; border: none; padding: 2px 0; font: inherit; text-align: left; cursor: pointer; color: color-mix(in srgb, var(--reader-fg, var(--ink)) 72%, transparent); }
.atlas-rel-list button:hover, .atlas-link-btn:hover { color: var(--reader-fg, var(--ink)); text-decoration: underline var(--accent) 1px; text-underline-offset: 3px; }
.atlas-detail-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
.atlas-select { height: 22px; font: inherit; font-size: 12px; background: transparent; color: inherit; border: var(--bw-hairline) solid color-mix(in srgb, var(--reader-fg, var(--ink)) 22%, transparent); }
.atlas-source { margin: 6px 0 0; padding-left: 8px; border-left: 2px solid color-mix(in srgb, var(--reader-fg, var(--ink)) 14%, transparent); max-height: 200px; overflow-y: auto; white-space: pre-wrap; }

/* 空态 */
.atlas-empty-stage { position: absolute; left: 50%; top: 45%; transform: translate(-50%, -50%); text-align: center; font-size: 12px; color: color-mix(in srgb, var(--reader-fg, var(--ink)) 60%, transparent); }
.atlas-empty-stage button { background: none; border: none; padding: 0; font: inherit; color: var(--accent); cursor: pointer; margin-top: 6px; }
.atlas-skel { display: block; height: 8px; margin: 0 auto 10px; background: color-mix(in srgb, var(--reader-fg, var(--ink)) 8%, transparent); animation: atlas-shimmer 1400ms var(--flow-ease) infinite alternate; }
@keyframes atlas-shimmer { from { opacity: 0.5; } to { opacity: 1; } }

/* 首帧（交接）与降级：不写 !important，用更高特异性 */
.atlas-stage[data-frame0="1"] .atlas-world,
.atlas-stage[data-frame0="1"] .ag,
.atlas-stage[data-frame0="1"] .atlas-svg path,
.atlas-stage[data-frame0="1"] .atlas-svg rect,
.atlas-stage[data-frame0="1"] .atlas-svg circle,
.atlas-stage[data-motion="off"] .atlas-world,
.atlas-stage[data-motion="off"] .ag,
.atlas-stage[data-motion="off"] .atlas-svg path,
.atlas-stage[data-motion="off"] .atlas-svg rect,
.atlas-stage[data-motion="off"] .atlas-svg circle,
.atlas-stage[data-motion="off"] .atlas-card { transition-duration: 0ms; transition-delay: 0ms; animation-duration: 0ms; animation-delay: 0ms; }
.atlas-stage[data-motion="off"] .ag { transition: opacity 120ms linear; }
@media (prefers-reduced-motion: reduce) {
  .atlas-world, .atlas-stage .ag, .atlas-stage .atlas-svg path, .atlas-stage .atlas-svg rect, .atlas-stage .atlas-svg circle, .atlas-card,
  .reader-atlas-toggle-label, .reader-engine-controls > * { transition-duration: 0ms; transition-delay: 0ms; animation-duration: 0ms; animation-delay: 0ms; }
}
```
> `.flow-actions` / `.flow-explain` / `.flow-dots` / `.flow-status` / `.flow-pill` 是随文结构的现有规则，节点卡直接复用；若其中某条写成 `.flow-layer .xxx` 形式，在本节补一条 `.atlas-card .xxx` 等价规则，不改原规则。

---

## 14. 动效总表

| 场景 | 部件 | 时长 | 曲线 | 延迟 |
|---|---|---|---|---|
| 聚焦 / 展开 / 收起 / 改版式 | 既有字形、deco、边、相机 | 420 | `--flow-ease` | 0 |
| | 新字形（从父位置滑出 + 淡入） | 420 位移 / 240 透明 | 同上 | 180 + min(序 × 18, 200) |
| | 新流带（从源头流出）/ 新边（淡入） | 420 / 240 | 同上 | 新字形延迟 + 120 |
| | 退场字形（滑回父位置 + 淡出） | 420 / 160，200 卸载 | — | 0 |
| 交接进入 | 克隆上层 / 混合层 | 160 / 200，220 移除 | `(.4,0,1,1)` | 0 |
| | 背景 | 240 | `(0,0,.2,1)` | 0 |
| | 匹配节点（FLIP） | 420 | `--flow-ease` | 2 帧 |
| | 其余节点 | 240 淡入 | — | 300 + (hop−1) × 60 |
| | 边 | 420 / 240 | — | 节点延迟较大者 + 120 |
| | 节点卡 | 220 | — | 460 |
| 按钮 / 指示器进入 | 节点 | 240 | — | 60 + hop × 50 |
| | 边 / 节点卡 | 240 / 220 | — | 节点延迟 + 120 / 320 |
| 退场 | 节点 / 边 / deco | 160 | — | (8 − hop) × 25 |
| | 背景 | 200 | `(.4,0,1,1)` | 120 |
| | `onExited` | — | — | 440 |
| 悬停透视 | 淡化 | 160 | — | 250 驻留 |
| 工具带 | 阅读工具出 / 全景工具入 | 120 / 160 | — | 0 / 60 |
| 左上按钮 | 文字换态 | 160 | `--flow-ease` | 0 |
| 减弱动效 | 一切 | 120 透明度 | linear | 0 |

---

## 15. 性能

- 布局 O(可见节点数)，默认 ≤ 160 节点；`buildAtlas` 只在 `graph`（节流 250ms）/ 展开集 / 版式 / 颜色 / 阅读节点变化时重算；悬停只重算 `crossStrands` 与 dim 标记。
- 裁剪：屏外 600px 以外不渲染（§5.5）。
- 字形组件 `memo`（比较 glyph 引用 + phase + dim/focus/reading 三个布尔）；`buildAtlas` 输出的未变字形尽量保持引用——实现方式：`buildAtlas` 后与上一场景按 id 比较 8 个几何/文字字段，相同则沿用旧对象。
- 平移只改 `.atlas-world` 的 transform（不重渲 React 子树）：pan 存 ref，直接写 `style.transform`；只有裁剪窗口变化时才 setState。

---

## 16. 测试

### 16.1 `tests/atlas.layout.test.cjs`（纯函数；写法照 `tests/flow.layout.test.cjs`）

夹具（用 `createGraph` 造）：根下 5 个顶层节点 `A..E`：
- `A`（大纲）：3 个子，篇幅 1 / 3 / 1；
- `B`（论证，`patternHint: "argument"`）：子 `b1`（理由）、`b2`（理由）、`b3`（证据，边 `b3 支 b1`、`b3 支 b2`）、`b4`（例证，`b4 例 b1`）、`b5`（反方观点）、`b6`（反驳，`b6 驳 b5`）；
- `C`（时间线，`patternHint: "timeline"`）：6 个子，timeText 分别「1945年」「1949年」「1950年」「1958年」「1978年」「1992年」；
- `D`（步骤，`patternHint: "chain"`）：8 个子；
- `E`（因果，`patternHint: "layered"`）：子 `e1..e5`，边 `e1 因 e3`、`e2 因 e3`、`e3 因 e4`、`e4 因 e5`、`e2 因 e5`；
- 另造对照组 `F`（`patternHint: "compare"`）：2 个成员，各 3 个子，标题「目的：…」「路径：…」「姿态：…」；并列组 `G`（`patternHint: "grid"`）：7 个子；大组 `H`：50 个子。
颜色用 `StructureFlowHost` `FALLBACK_COLORS` 同值的字面量对象（测试文件不受颜色规则约束）。全部展开（`expanded` 含所有有子节点的节点）。

断言：
1. 确定性：同输入 `buildAtlas` 两次，`JSON.stringify` 完全相同。
2. 不重叠：任意两个字形盒（排除父子包含关系——字形之间本无包含）交集面积为 0（允许 1px 容差）。
3. 每个可见节点恰好一个字形；`more:H` 存在且 `moreCount === 50 − 18 = 32`（`H` 先因 `BIG_GROUP` 退为 grid）。
4. `patternOf`：A→tree、B→argument、C→timeline、D→chain、E→layered、F→compare、G→grid、H→grid。
5. 扇形：A 的 3 条 `fan` 流带源区间首尾相接、都在 A 字形纵向范围内，第 2 条厚度 ≈ 其余 3 倍（±0.6）；每条 `x1` 等于目标字形 x。
6. 论证：`b3` 有两条 `arg:` 边（到 b1、到 b2）；B 的字形 `kind === "claim"`，x 中心 ≈ 第 1 层主区中心（±1）；`b3` 字形 y > `b1`、`b2` 的 y；`b5`、`b6` 的 x 都大于主区所有字形右缘 + `ARG_COUNTER_GAP − 1`；存在 `cz:B` 反方区 deco；`consumed` 含 `b3>b1>支`、`b6>b5>驳`。
7. 无环保护：给 B 另加 `b1 支 b2`、`b2 支 b1` 后 `buildAtlas` 不抛错、不死循环，且被断开的那条不在 `consumed`。
8. 时间线：C 的 6 个光点 `cx` 严格递增；1958→1978 这段（20 年）的间距 > 1945→1949（4 年）的间距；上方事件（序 0,2,4）字形底 < 轴 y，下方（序 1,3,5）字形顶 > 轴 y。
9. 时间线泳道公式：同侧同泳道的块底（上方）/顶（下方）到轴的距离都等于 `TL_STEM + Σ(前序泳道高 + 12)`。
10. 时间线断层：timeText 改为「1900」「1901」「1902」「1903」「2000」「2001」→ 存在 `brk:C:3` deco，第 4→5 段间距 = 72。
11. 步骤：D 有 8 个 `disc:` deco、7 条 `seq:` 边；第 1 行 5 个圆点 cx 递增、第 2 行 3 个 cx 递减；`seq:d5>d6` 的路径是 U 形（中间两个控制点 x 相同且 > 第 1 行最大 cx）。
12. 因果：E 的列号 e1=e2=0、e3=1、e4=2、e5=3（按字形 x 分组判断）；所有 `ly:` 边起点 x < 终点 x；`consumed` 含全部 5 条。
13. 对照：F 存在 2 个 `band:` deco、3 个 `dim:` deco（文字为「目的」「路径」「姿态」）；单元格字形文字不含「目的：」前缀。
14. 网格：G 的 7 个瓷砖宽都是 184；列数 3（`round(sqrt(9.8)) = 3`）。
15. `defaultExpanded`：budget 20 时只展开根与少量浅层，可见字形数 ≤ 20 + `MORE_MAX`；焦点 `b3` 时结果含 `B`。
16. `hopFrom(g, "b3")`：b3→0、b1→2、B→1、A→3、ROOT→2、`c1`→4。
17. `crossStrands`：给 `a1 支 e3`（跨组）一条边，`hot={a1}` 时返回 1 条且 `strong`；`hot` 空、`all=false` 时 0 条；收起 E 后该边连到 E 的字形（`viaRep`）。
18. `spatialNext`：从 b1 向右得到 b2；从 B 向下得到第 1 层中最近者。
19. `normalizeSnapshot` / `snapGlyphId`：真实根映射为 `@root`；`n:b3` → `g:b3`，`head` → null。

### 16.2 `tests/atlas.dom.test.cjs`（jsdom；脚手架照抄 `tests/m15v2.tab.dom.test.cjs` 1–150 行）

宿主：`#toolbar`、`#stage`（stage `getBoundingClientRect` 返回 1100×640），挂 `<MindmapTab open entry={{seq:1, origin:"button", nodeId:null, snapshot:null}} …/>`。
1. 工具栏有 `.atlas-crumbs`、`[data-atlas-search]`、`[data-atlas-menu="gen"]`、版本 / 视图菜单、`.atlas-zoom`、`[data-atlas-center]`；页面无 `.mindmap-sidebar`、`.mm2-canvas`。
2. 目录预览：`.ag` ≥ 3；根字形 `data-kind="root"`；面包屑首项为材料名带「目录预览」chip。
3. 点「生成导图」→ 状态区出现「框架 n/m 段」与「停止」；首个 AI 节点在第一次流结束前出现为 `.ag`。
4. 完成后生成菜单出现「重新生成」。
5. 点一个顶层 `.ag` → 该元素 `data-focus="1"`、面包屑末项为其标题、它的子节点出现为 `.ag`（自动展开）、`.atlas-world` 的 transform 改变。
6. 节点卡 `[data-atlas-card]` 出现，含「跳到原文」「讲解」「详情」；「讲解」→ 文字流式出现；「详情」→ `.atlas-detail`。
7. 折叠钮：点某个 `[data-atlas-act="fold"]`（`+N`）→ 子节点出现；再点（`−`）→ 子节点在 400ms 内消失。
8. 搜索：输入标题前缀 → `.atlas-search-menu .dd-item` ≥ 1 → 点第一条 → 该节点 `data-focus="1"`。
9. 键盘：舞台聚焦后 → 方向键使焦点改变；Alt+↑ 回到父节点。
10. Esc（焦点在舞台）→ `onExit` 1 次；搜索框内 Esc 不调用。
11. `open={false}` → 600ms 内 `onExited`。
12. 交接：重新挂载，`entry.snapshot` 手造（`items` 含 `n:<某顶层节点>` 矩形 `{left: 900, top: 300, width: 200, height: 26}`），`nodeId` 为该节点 → 首次渲染后立即读该 `.ag` 的 `style.transform` 等于 `translate(900 − stageLeft − panX, 300 − stageTop − panY)`、`data-frame0="1"`；3 帧后 `data-frame0` 消失、transform 等于布局坐标，且该节点字形中心的屏幕位置 = (550, 288)（±1）。
13. 制卡：节点卡「制卡」→ 回调 `nodeId` 以 `v2:` 开头、`section` 含「【结构语义包】」。
14. 全程 `console.error` 0 条。

### 16.3 `tests/m15v2.tab.dom.test.cjs`

改写为 16.2 的 3–4、6、13 条 + 「焦点 `state:"more"` 节点 → 卡内『深挖』→ 子节点出现为 `.ag`」；删「focusRequest / flashRect / 回执」三条；「拖动平移内容层不重建」改为「拖动舞台空白 → `.atlas-world` transform 改变、`.ag` 元素引用不变」。

### 16.4 `tests/flow.dom.test.cjs` 追加

1. 动作行文案为「在结构全景中查看」。
2. 打开随文结构 → `captureFlowSnapshot(document)` 非空且 `items` 含当前组每个成员的 `n:` 行。
3. 宿主 `covered coverMode="handoff"` → 下一帧 `.flow-layer` 不在 DOM；280ms 后平移目标 transform 归零。
4. `coverMode` 缺省时原有断言全部通过。

### 16.5 必跑

`npm run typecheck` 0 错；`npm run i18n:check` ✓；`node scripts/consistency-check.mjs` ✓；`node scripts/run-tests.mjs atlas` / `flow` / `m15v2` 全绿；`npm run build` ✓。GUI 测试（`*.gui.mjs`，如 `d139-sidebar-band.gui.mjs`）沙箱跑不了——若写死了三页签或 64px 左让位，按本文更新期望值并在报告注明「未实跑」。

---

## 17. 实施阶段（严格按顺序，每阶段跑对应测试）

1. **布局引擎**：`atlasLayout.ts` 全部（§4）→ `atlas.layout` 全绿。先写 4.1–4.5 + 扇形 + 网格，跑 1–5、14；再逐个版式：论证（6–7）→ 时间线（8–10）→ 步骤（11）→ 因果（12）→ 对照（13）；最后 4.7–4.11（15–19）。
2. **画布**：`AtlasStage` 静态渲染 + 相机 + 事件（暂不做进出场动效）→ 16.2 的 1、2、5、7、9。
3. **动效**：presence、§5.6 (a)(c)(d)(e)(g) → 16.2 的 7、11。
4. **节点卡 + 工具栏 + MindmapTab 改写** → 16.2 的 3、4、6、8、10、13、14。
5. **交接**：`handoff.ts` + `StructureFlowHost` §9.3 + §5.6(b) → 16.2-12、16.4。
6. **Reader / 侧栏 / CSS / i18n** → typecheck、i18n、consistency、build。
7. **m15v2.tab.dom 改写**、文档登记。

---

## 18. 文档登记（`AI_DEVELOPMENT_GUIDE.md`）

- 版本条目（照现有 v49.85 条目格式）：**v49.88 / D254 结构全景**：完整图谱由侧栏「图谱」页签 + 卡片画布改为「结构全景」——二维组合布局，每个组按结构类型专门排布（大纲＝Sankey 扇形树、并列＝网格瓷砖、论证＝主张置顶的分层论证图（多重支撑如实画多条线，反方独立成区）、时间线＝比例时间轴上下交错、步骤＝编号圆点蛇形、因果＝自左向右分层有向图、对照＝对照表），组再按父组版式嵌套；聚焦 / 展开 / 改版式时节点与相机同一 420ms 时钟；悬停关系透视；随文结构「在结构全景中查看」以快照 + 克隆层做共享元素交接（FLIP 420ms，按结构距离由近及远展开）；入口移到阅读界面左上「结构全景 / 返回阅读」，图谱页签移出侧栏，面板拆进工具带，节点详情改为焦点节点卡；右侧「结构图」改名「随文结构」。契约见 `docs/design/STRUCTURE-ATLAS-D254.md`。无 schema / IPC / 设置键 / 埋点事件变更。
- 决策表加 `| D254 | … | ✅ v49.88 实现（测试读数…） |`。
- §4.19「图谱页签＝侧栏」的描述改为指向本文；`MINDMAP-SIDEBAR-TAB.md` 文件头加「已被 D254 取代」。

---

## 19. 易错点（逐条核对）

1. 快照必须在任何 `setState` 之前同步拍（`openAtlas` 第一行），再 `playFlowGhost`。
2. 克隆层直接挂 body、各自做动画，不包容器（否则混合层的 `mix-blend-mode` 被隔离，正文高亮瞬间变色）。
3. FLIP 换回真实坐标必须等**两次** `requestAnimationFrame`；首帧期间 `data-frame0="1"` 关闭过渡。
4. 字形与相机必须同一时长同一曲线（`--atlas-move` 420ms + `--flow-ease`），否则焦点滑向中心时会走弧线、先冲过头再回来。**不要**在场景变化时做「瞬时补偿相机 + 过渡字形」这种组合（会先跳后滑）。
5. 材料根 id：随文结构的图未抬升（材料根是真实节点），全景抬升为 `ROOT_ID="@root"`；快照、`entry.nodeId`、定位结果都要经 `normalizeSnapshot` / `toAtlasId` 映射。
6. `finish()` 之前组头字形必须是 `out.glyphs` 的第一个；`finish()` 会把块归一化到 (0,0)——版式里不要依赖「组头在 (0,0)」。
7. 时间线：上方泳道块底对齐、下方块顶对齐（§4.6.4），不要居中对齐泳道。
8. 论证 / 因果的 DFS 断环：被断的那条关系不能进 `consumed`（它要作为跨组关系画出来，否则信息丢失）。
9. 关系码方向：`据` 是「上级 —据→ 本节点」（论证）/「信息从 to 流向 from」（因果）；其余码都是「本节点 —码→ 目标」。
10. 颜色规则与随文结构一致（`palette[i % 8]`），交接时同一节点不变色。
11. 渐变一律 `objectBoundingBox`（几何动画期间渐变跟着走）。
12. `usePresence` 对全量列表算阶段、渲染时再裁剪；不要对裁剪后的列表用 presence（否则一平移就满屏进出场）。
13. 不新增 `!important`、不写内联 `<svg>`（用 `SvgRoot`）、新文件无十六进制颜色、含 Enter 的文件必须 `isImeComposing`。
14. Esc 优先级：输入法组字 > 搜索框 / 菜单（自己收起并 `stopPropagation`）> 退出全景。
15. 进入全景不动 `sidebarOpen`；退出全景不手动重开随文结构（`covered` 回落后宿主自己按 `lensOpen` 开场）。
16. 「跳到原文」先 `goTo` 再退出全景，并显示「↩ 回到刚才的位置」——任何从结构界面发起的跳转都要有回去的路。
17. 折叠状态只存在全景展开集（会话级 memo），**不写** `graph.view.collapsed`（那是旧画布的持久视图，随文结构也不读它）。

---

## 20. 用户实机验收（Windows 应用）

1. 打开一本已生成导图的书，左上出现「展开」「结构全景」；点「结构全景」：侧栏不展开，结构全景以正在读的那一节为中心由近及远浮现；按钮原地变成「返回阅读」并点亮；工具带换成面包屑 / 搜索 / 生成 / 版本 / 视图 / 缩放 / 居中。
2. 找一处论证型章节：主张在上，理由在下，证据再下；一条证据同时支撑两个理由时能看到两条线汇聚；反方观点与反驳在右侧淡红区域里。
3. 找一处时间线：事件在横轴上按年代疏密排开，上下交错，长空档有「//」；找一处步骤：编号圆点连成一条路径，超过 5 步折返；找一处因果：从左往右流；找一处对照：是一张表。
4. 点任一节点：它和相机一起平滑滑到正中，它的下级结构从它身上"长"出来；点「+N」展开、「−」收起，周围的结构平滑让位。
5. 悬停一个节点约四分之一秒：无关部分淡去，跨章节的印证 / 反驳线出现。
6. 关掉全景，打开「随文结构」，单击一个节点 → 「在结构全景中查看」→ 该节点和它的兄弟从右侧原位直接滑进二维结构里，焦点停在中央，周围结构随后展开；全程无闪烁、无重影。
7. 双击一个节点 → 回到正文对应位置，工具栏出现「↩ 回到刚才的位置」。
8. 夜间阅读主题下全景为深色；系统「减少动态效果」打开时只剩淡入淡出；窗口最窄（1120）与展开侧栏时仍可平移缩放浏览。
