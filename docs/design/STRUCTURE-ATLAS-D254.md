# 结构全景（Structure Atlas）——完整图谱改版 + 随文结构无缝衔接 + 入口调整（D254）

> 状态：设计定稿（2026-10-30）。实施者：其他 AI Agent。**本文的常量、公式、参考代码就是定稿，不要自行"优化"、换算法或改时长。**
> 本文没写到的现有代码细节：先 grep 现有实现，照抄它的写法。行号以 2026-10-30 `main`（405e83d）为准，可能有几行偏差，按上下文定位。
> 取代：`MINDMAP-SIDEBAR-TAB.md`（D84，侧栏「图谱」页签）与 `MINDMAP-V2-IMPL-PLAN.md` 里关于 `MindmapCanvasV2` 作为完整图谱画布的部分。
> 不动：AI 提示词、解析器、引擎、IPC、数据库表、设置键、`src/lib/mindmap/v2/*`（布局/路由/SVG 仍保留，只用于「导出 SVG」）。
> 相关现行规格：结构流（随文结构）`STRUCTURE-FLOW-PLAN.md` §12、`STRUCTURE-FLOW-FIX-v3.2.md` §13–§15、`STRUCTURE-FLOW-SMOOTH-v3.5.md` §16。

---

## 0. 用户要求 → 定稿

| # | 用户要求 | 定稿 |
|---|---|---|
| R1 | 完整结构图要和阅读界面里的新结构图一样丝滑优雅（样式、动效、整体排列及其它可优化处） | 完整图谱改为 **「结构全景」**：**横向分栏的 Sankey 结构图**。每一栏就是一列「随文结构」——**同一个布局函数（`layoutFor`）、同一个渲染器（`FlowLayer` 的 `UpperGen`）、同一套泳道/跨度条/字号/配色/动效 Token**。栏与栏之间用 Sankey 流带相连：焦点路径上的每一行，从行尾"流"向下一栏它的每个子节点（流带粗细 ∝ 篇幅）。旧的卡片 + 框 + 连线画布（`MindmapCanvasV2`）不再用于完整图谱。§2、§4–§6 |
| R2 | 在随文结构里选中节点 → 点「在完整图谱中打开」→ 流畅的进入动效：该节点丝滑移到界面中心，完整图谱以它为中心展开 | **共享元素过渡（FLIP）**：点击瞬间对随文结构拍「快照」（每一行、每根竖条的屏幕矩形）；结构全景的焦点栏首帧把这些行画在快照位置，随后 420ms 一起滑到新位置（选中节点到正中），再以它为中心向左（祖先）向右（子节点）逐栏展开、流带一根根"流"出来。随文结构本身零闪烁地交接（克隆层 160ms 淡出）。§10 |
| R3 | 「图谱」按钮从侧栏移出，固定在阅读界面左上角，独立按钮 | 新按钮 `.reader-atlas-toggle` 固定在「展开/收起」侧栏开关右侧（left 64px，top 56px，高 24）。§11.2 |
| R4 | 点击直接进入完整图谱，进入后按钮位置不变 | 按钮 `position: fixed`，进出图谱都不动；宽度＝两态文字中较宽者（grid 叠放），文字切换不改变宽度。§11.2、§14 |
| R5 | 再次点击返回阅读界面，按钮文字要变化以区分状态 | 阅读态「结构全景」↔ 图谱态「返回阅读」，并且图谱态为点亮样式（accent 描边 + accent-soft 底）。§1 |
| R6 | 进入完整图谱时不再展开侧栏 | 结构全景铺满正文视口（`.reader-engine-viewport`），与侧栏无关；进入时不改 `sidebarOpen`。§11 |
| R7 | 原侧栏「图谱」页签下的内容拆分到图谱页面的顶部工具栏 | 图谱态时阅读工具栏（选区动作/翻页/更多/页码）淡出，**同一条工具带**淡入结构全景工具栏：面包屑 · 状态 · 搜索 · 生成▾ · 版本▾ · 视图▾ · 缩放 · 居中。节点详情（原 `NodeDetailV2`）改为焦点行下方的**行内动作行 + 详情块**（与随文结构的动作行同款）。§8、§7 |
| R8 | 阅读界面里「完整图谱」「结构图」按钮文字改得更合适 | 左上「结构全景 / 返回阅读」；右侧工具栏「结构图」→「随文结构」；随文结构动作行「在完整图谱中打开」→「在结构全景中查看」。§1 |

---

## 1. 命名与文案（i18n：`src/i18n/locales/en.ts` 与 `ja.ts` 都要加；旧 key 保留不删）

| 位置 | zh（源 key） | en | ja |
|---|---|---|---|
| 左上按钮·阅读态 | 结构全景 | Overview | 構造全景 |
| 左上按钮·图谱态 | 返回阅读 | Back to text | 本文に戻る |
| 左上按钮 title·阅读态 | 结构全景：整本材料的结构，以正在读的位置为中心展开 | Overview: the whole structure, centered on where you are reading | 構造全景：読んでいる位置を中心に全体の構造を表示 |
| 左上按钮 title·图谱态 | 返回阅读（Esc） | Back to text (Esc) | 本文に戻る（Esc） |
| 右侧工具栏开关 | 随文结构 | Inline structure | 本文の構造 |
| 右侧开关 title·关 | 随文结构：在正文右侧显示正在读的这一段所在的结构 | Inline structure: show the structure around the passage you are reading | 本文の構造：読んでいる段落の構造を本文の右に表示 |
| 右侧开关 title·开 | 收起随文结构 | Hide inline structure | 本文の構造を閉じる |
| 随文结构动作行 | 在结构全景中查看 | View in overview | 全景で見る |
| 返回原处提示钮 | ↩ 回到刚才的位置 | ↩ Back to where I was | ↩ 元の位置へ |
| 结构全景空栏 | 这一节还可以继续展开 | This part can be expanded further | この節はさらに展開できます |
| 〃 | 深挖 → | Deepen → | 掘り下げる → |
| 〃 | 已触底：没有更深的结构 | Reached the bottom: no deeper structure | 最下層：これ以上の構造はありません |
| 〃 | 生成导图后可以继续深挖 | Generate the map to deepen further | マップを生成すると掘り下げられます |
| 根行行尾 | 全文 | Whole | 全体 |
| 行内动作 | 制卡 / 详情 / 收起详情 | Cards / Details / Hide details | カード / 詳細 / 詳細を閉じる |
| 工具栏 | 生成 / 版本 / 视图 / 居中 / 显示全部关系 / 搜索标题 / 讲解 | Generate / Versions / View / Center / Show all relations / Search titles / explanations | 生成 / バージョン / 表示 / 中央へ / すべての関係を表示 / タイトル・解説を検索 |
| 工具栏状态 | 已停止 | Stopped | 停止しました |

已有 key 直接复用（不要新建同义 key）：`生成导图`、`重新生成`、`停止`、`停止深挖`、`深挖全部（{n} 个可深挖节点）`、`忽略缓存重新分析（每段都会实际调用）`、`发送前预览：…`、`模型：…`、`预计调用 …`、`历史版本`、`删除`、`删除此版本`、`（当前）`、`导出 SVG`、`跳到原文`、`讲解`、`收起讲解`、`深挖`、`本节点 {rel} → {title}`、`{title} {rel} → 本节点`、`排列方式`、`自动`、`查看对应原文（{n} 字）`、`收起原文`、`仍要尝试深挖`、`已有 {n} 张卡`、`知识点已存在`、`正在读取原文 {i}/{n}`、`AI 未配置` 等。实现完跑 `npm run i18n:check` 必须 0 缺失。

---

## 2. 形态

```
 ┌─ 顶栏 48 ────────────────────────────────────────────────────────────────────────────────────────┐
 ├──────────────────────────────────────────────────────────────────────────────────────────────────┤
 │[展开][返回阅读]  全书 › 第二章 › 2.3 数据库消费  ● 框架 12/40 段   [🔍搜索标题…] [生成▾] [版本▾] [视图▾] [− 100% +] [居中] │ ← 同一条工具带（56–96）
 ├──────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ ░                第二章 · 论证                 2.3 数据库消费 · 大纲                                 ░ │
 │ ░  ▌ 2.1 从故事到数据库   +4    ▌ 2.3.1 叙事与数据库分离   理由   ╭══════▶ ▌ 2.3.1.a …           ░ │
 │ ░  ▌ 2.2 大叙事凋零       +3 ╭══▶ ┃▌ 2.3.2 大叙事凋零  证据   ╭═══▶  ▌ 2.3.1.b …                ░ │
 │ ░▒▒▌ 2.3 数据库消费 ▒▒▒▒▒+5══╪══▶ ┃▌ 2.3.3 ̲数̲据̲库̲消̲费̲者̲  ▒▒▒▒+2═╪════▶ ▌ 2.3.3.a 二次创作   ← 焦点在正中   ░ │
 │ ░  ▌ 2.4 动物化            +2 ╰══▶ ┃┆ 2.3.4 绫波丽被拆解  例证  ╰═══▶ ▌ 2.3.3.b 萌要素        ░ │
 │ ░                               跳到原文 · 讲解 · 深挖 · 制卡 · 详情                                ░ │
 │ ░  （左侧 48px 渐隐）                                                       （右侧 48px 渐隐）  ░ │
 └──────────────────────────────────────────────────────────────────────────────────────────────────┘
   ▒▒ 焦点路径上每一行的行底高亮（与随文结构的"高亮矩形"同语言），在行尾不断开地弯成 Sankey 流带，流向下一栏的各子节点竖条
   每一栏＝一列随文结构（泳道 + 跨度条 + 行尾类型字 / +N），栏顶是「父标题 · 版式名」
```

- **栏**：根栏（只有一行：材料标题）→ 根的子栏 → … → 焦点所在栏（焦点的兄弟们）→ 焦点的子栏（「+1 栏」）。焦点所在栏**水平居中**；所有「有路径行」的栏，其路径行**垂直中心对齐在同一水平线** `yc`（舞台高 × 0.42）上，于是焦点路径是一条横贯全屏的"脊"。
- **一次点击＝导航**：点任何一栏的任何一行 → 它成为新焦点（也是选中项），全部栏以 360ms 同一时钟滑到新位置；多出来的栏淡出、新栏从焦点一侧淡入、流带重新"流"出来。
- **单一强调色**（沿用结构流 §7.2-3）：阅读节点＝主题色底 + 白字（pill）；焦点＝主题色字 + 下划线；强关系线＝主题色。
- **长在页面上**：舞台背景＝阅读背景（`--reader-bg`），字色＝阅读前景；没有卡片、框、阴影。

---

## 3. 文件清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `src/lib/flow/atlas.ts` | **新增** | 纯模块：常量 / 类型 / 列构建 / 排布 / 流带 / 快照位移（§4，参考代码照抄） |
| `src/lib/flow/types.ts` | 改 | `FlowScene` 增两个可选字段 `openBase` / `keepIds`（§5.1） |
| `src/components/reader/flow/FlowLayer.tsx` | 改 | 导出 `UpperGen`、`SvgRoot`；`UpperGen` 支持 `openBase` / `keepIds`；动作行文案改「在结构全景中查看」（§5） |
| `src/components/reader/flow/StructureFlowHost.tsx` | 改 | 导出 `resolveColors`；新增 prop `coverMode`，`"handoff"` 时瞬时交接（§10.3） |
| `src/components/reader/atlas/handoff.ts` | **新增** | 快照 + 克隆幽灵层（§10.2） |
| `src/components/reader/atlas/AtlasStage.tsx` | **新增** | 舞台：栏 / 流带 / 行内块 / 平移缩放 / 键盘 / 动效状态机（§6） |
| `src/components/reader/atlas/AtlasInline.tsx` | **新增** | 焦点行下方的动作行 + 讲解 + 详情（§7） |
| `src/components/reader/atlas/AtlasToolbar.tsx` | **新增** | 顶部工具栏（§8） |
| `src/components/reader/atlas/useThrottled.ts` | **新增** | 节流值 hook（§6.3） |
| `src/components/reader/MindmapTab.tsx` | **重写渲染部分** | 数据逻辑保留；删掉侧栏面板与 `MindmapCanvasV2` 画布；改为 portal 渲染 Toolbar + Stage（§9） |
| `src/lib/mindmapV2.ts` | 改 | `load` 结果按文档缓存 + `peekLoad()`（§9.4） |
| `src/components/Reader.tsx` | 改 | 左上按钮、图谱状态机、工具栏宿主、舞台宿主、返回原处钮、删图谱页签接线（§11） |
| `src/components/reader/ReaderSidebar.tsx` | 改 | 删除「图谱」页签与 `mapPanel`（§12） |
| `src/theme.css` | 改 | 新增「结构全景」节；工具栏与侧栏页签行左让位改为含按钮宽（§14） |
| `src/i18n/locales/en.ts`、`ja.ts` | 改 | §1 |
| `tests/atlas.layout.test.cjs` | **新增** | 纯函数（§17.1） |
| `tests/atlas.dom.test.cjs` | **新增** | 端到端 DOM（§17.2） |
| `tests/m15v2.tab.dom.test.cjs` | 改写 | 迁到新 DOM（§17.3） |
| `tests/flow.dom.test.cjs` | 增断言 | 交接（§17.4） |
| `AI_DEVELOPMENT_GUIDE.md` | 登记 | v49.87 / D254（§19） |

**保留不删**：`MindmapCanvasV2.tsx`、`NodeDetailV2.tsx`（不再被 import；它们的单测 `m15v2.canvas-api.dom` / `m15v2.transition-dom` 照常跑）、`src/lib/mindmap/v2/*`、`theme.css` 里 `.mindmap-*` / `.mm2-*` 旧样式（本轮不清理）。

**仓库闸门（必须遵守）**：
- `scripts/consistency-check.mjs`：TS/TSX **不得新增内联 `<svg` 字面量**（用 `SvgRoot`）、**不得新增 `!important`**、新文件**不得有十六进制颜色字面量**（颜色一律来自 `FlowColors` / CSS 变量）、含 `e.key === "Enter"` 的文件必须同时 `import { isImeComposing }` 并在键盘处理首行判断。
- 新文件不要放进 `src/components/reader/mindmap/` 或 `src/lib/mindmap/`（那里是「动效时长不许写死」的作用域）。本文所有时长集中在 `ATLAS_T`（§4.1）。

---

## 4. 纯模块 `src/lib/flow/atlas.ts`（照抄）

### 4.1 常量与类型

```ts
// 结构全景（D254）纯模块：栏构建 / 排布 / 栏间流带 / 交接快照位移。设计 docs/design/STRUCTURE-ATLAS-D254.md §4。
import type { GraphState } from "../mindmap/v2/types";
import { ROOT_ID } from "../mindmap/v2/types";
import { ancestors, childrenOf } from "../mindmap/v2/graph";
import type { FlowColors, FlowItem, FlowPattern, FlowPlan, FlowPrim, FlowStrand, PatternLayout } from "./types";
import { FLOW, buildStrands, layoutFor, layoutTree, patternFor, shapePath, wrapLabel, type LayoutCtx } from "./layout";

export const ATLAS = {
  LABEL_W: 248,              // ＝ FLOW.LABEL_W
  COL_W: 294,                // ＝ BAR_MAX 10 + LABEL_GAP 16 + 248 + PAD_R 20
  GAP: 96,                   // ＝ FLOW.BRAID_PREF：栏间流带区
  MARGIN_Y: 32,
  CENTER_Y: 0.42,            // 路径脊线 yc ＝ 舞台高 × 0.42
  BIG_COLUMN: 120,           // 成员 > 120 的栏强制「并列」紧凑版式
  LINK_PAD: 6,               // ＝ FLOW.HL_PAD_X：行底高亮左右外扩
  STRAND_TEXT_RIGHT: -64,    // 栏内关系线最大外凸 ≈ 44px（buildStrands 的 textRight 取栏左 −64）
  INLINE_MIN_H: 26,          // ＝ FLOW.ACTIONS_H
  INLINE_MAX_H: 320,
  ROOT_FS: 15, ROOT_LH: 20, ROOT_WEIGHT: 650,
  ZOOM_MIN: 0.6, ZOOM_MAX: 1.6, ZOOM_STEP: 1.1,
  PAN_MARGIN: 120,           // 平移软边界：内容至少留 120px 在视口内
  DRAG_SLOP: 4,
  HOVER_CLEAR_MS: 200,
  LAYOUT_THROTTLE_MS: 250,   // 流式生成时布局最多 4 次/秒
} as const;

/** 全部动效时长（ms）。CSS 里的同名值写在 theme.css「结构全景」节，两处必须一致。 */
export const ATLAS_T = {
  BG_IN: 240, BG_OUT: 200, BG_OUT_DELAY: 120,
  MOVE: 360,                 // 导航：栏 / 行 / 流带 / 世界平移，统一时钟（＝CSS --flow-t-geo 在 .atlas-stage 下的值）
  HANDOFF_MOVE: 420,         // 交接：快照行滑到新位置
  HANDOFF_UNFOLD: 300,       // 交接：其余栏开始展开
  BUTTON_UNFOLD: 80,         // 按钮进入：焦点栏开始出现
  NAV_UNFOLD: 120,           // 导航：新栏开始出现
  COL_STEP_ENTER: 90,        // 进入时每远一栏多等
  COL_STEP_NAV: 60,          // 导航时每远一栏多等
  COL_IN: 240, COL_OUT: 120, COL_REMOVE: 160,
  LINK_IN: 360, LINK_DELAY: 60, LINK_OUT: 120,
  EXIT_STEP: 40, EXIT_STEP_CAP: 160, EXIT_DONE: 340,
  GHOST_LAYER_OUT: 160, GHOST_BLEND_OUT: 200, GHOST_REMOVE: 220,
  HANDOFF_RESET: 280,        // 随文结构交接后，正文平移/预留在图谱背景不透明后再归位
  INLINE_DELAY_HANDOFF: 420, INLINE_DELAY_BUTTON: 320,
  LOCATE_TIMEOUT: 600,
  REDUCED: 120,              // 减弱动效：只保留 120ms 透明度
} as const;

/** 每一栏的排布方案（局部坐标：竖条在 x=0，标签在 x=26，宽 248） */
export const ATLAS_PLAN: FlowPlan = { mode: "inside", shift: 0, reserve: 0, barX: 0, labelX: 26, labelW: 248, right: 294 };

export type AtlasEmpty = "more" | "streaming" | "floor" | "preview";

export interface AtlasColumn {
  /** "col:^"＝根栏；其余 `col:${parentId}`（parentId 为 ROOT_ID 时就是 "col:@root"） */
  key: string;
  /** 根栏 null；其余＝本栏成员的父节点 */
  parentId: string | null;
  members: string[];
  /** 本栏中位于焦点路径上的成员（焦点所在栏＝焦点本身；+1 栏 / 空栏＝null） */
  activeId: string | null;
  pattern: FlowPattern;
  patternName: string;
  layout: PatternLayout;
  width: number;
  /** 仅「焦点没有子节点」时追加的空栏 */
  empty: AtlasEmpty | null;
}

export interface AtlasPos { x: number; y: number }

export interface AtlasLink {
  id: string;            // `lk:${from}>${to}`
  from: string;
  to: string;
  color: string;
  tone: 0 | 1 | 2;       // 0 普通 / 1 路径或焦点 / 2 悬停
  L: number; xs: number; s0: number; s1: number; x1: number; t0: number; t1: number; // 世界坐标；字段语义同 FlowShape
}

export interface DOMRectLike { left: number; top: number; width: number; height: number }

/** 随文结构快照（§10.2 采集；id 已按 normalizeSnapshot 归一） */
export interface FlowSnapshot {
  /** 随文结构当前代的主体组（genKey；"none"→null） */
  cut: string | null;
  readingId: string | null;
  /** FlowItem.id → 屏幕矩形（只含当前代、非预览、非退场的条目） */
  items: Map<string, DOMRectLike>;
  /** nodeId → 竖条屏幕矩形（prim id `bar:${nodeId}`） */
  bars: Map<string, DOMRectLike>;
}

export interface AtlasBuildOpts {
  focus: string;
  rootTitle: string;
  colors: FlowColors;
  readingId: string | null;
  /** 焦点行下方行内块的实测高度（≥ ATLAS.INLINE_MIN_H；ROOT 为焦点时传 0） */
  inlineH: number;
  stageH: number;
  cmpPage: Readonly<Record<string, number>>;
  /** 已 i18n 的版式名：p => T(PATTERN_LABEL[p]) */
  patternLabel: (p: FlowPattern) => string;
  /** 已 i18n：T("全文") */
  rootMeta: string;
  /** 目录预览图（无已生成导图） */
  preview: boolean;
}
```

### 4.2 焦点链与列构建

```ts
/** 根 → 焦点（含两端）。焦点未知 / 祖先链断（父节点尚未到达的孤儿）→ 退回 [ROOT_ID] */
export function atlasChain(g: GraphState, focus: string): string[] {
  if (focus === ROOT_ID || !g.nodes[focus]) return [ROOT_ID];
  const anc = ancestors(g, focus);
  const top = anc.length ? anc[0] : focus;
  if (g.nodes[top]?.parentId != null) return [ROOT_ID];
  return [ROOT_ID, ...anc, focus];
}

const valueOf = (g: GraphState, id: string) => {
  const n = g.nodes[id];
  return n && n.blockStart != null && n.blockEnd != null ? Math.max(1, n.blockEnd - n.blockStart + 1) : 1;
};

function rootColumn(o: AtlasBuildOpts, active: boolean): AtlasColumn {
  const lines = wrapLabel(o.rootTitle || "", ATLAS.ROOT_FS, ATLAS_PLAN.labelW - FLOW.META_W, 2);
  const h = lines.length * ATLAS.ROOT_LH + FLOW.ROW_PAD_Y * 2;
  const it: FlowItem = {
    id: `n:${ROOT_ID}`, nodeId: ROOT_ID, kind: "node", x: ATLAS_PLAN.labelX, y: 0, w: ATLAS_PLAN.labelW, h, lines,
    fs: ATLAS.ROOT_FS, lh: ATLAS.ROOT_LH, weight: ATLAS.ROOT_WEIGHT, tone: 96, chip: null, meta: o.rootMeta, time: null, num: null,
    reading: false, selected: o.focus === ROOT_ID, hasKids: true, expanded: false, lane: 0,
  };
  const bar: FlowPrim = { k: "rect", id: `bar:${ROOT_ID}`, x: 0, y: 1, w: 5, h: h - 2, rx: 1.5, fill: o.colors.fg, opacity: 0.7, layer: "over" };
  const layout: PatternLayout = { items: [it], ports: [{ nodeId: ROOT_ID, x: 0, y0: 1, y1: h - 1, color: o.colors.fg }], prims: [bar], expressed: [], leafIds: [ROOT_ID], height: h, readingY: null };
  return { key: "col:^", parentId: null, members: [ROOT_ID], activeId: active ? ROOT_ID : null, pattern: "tree", patternName: "", layout, width: ATLAS.COL_W, empty: null };
}

function emptyKind(g: GraphState, focus: string, preview: boolean): AtlasEmpty {
  if (preview) return "preview";
  const s = g.nodes[focus]?.state;
  if (s === "streaming") return "streaming";
  if (s === "more" || s === "stub") return "more";
  return "floor";
}

export function buildAtlasColumns(g: GraphState, o: AtlasBuildOpts): AtlasColumn[] {
  const chain = atlasChain(g, o.focus);
  const focus = chain[chain.length - 1];
  const cols: AtlasColumn[] = [rootColumn(o, true)];
  for (let j = 0; j < chain.length; j++) {
    const parent = chain[j];
    const members = childrenOf(g, parent).filter((id) => !!g.nodes[id]);
    const activeId = chain[j + 1] ?? null;
    if (!members.length) {
      if (j === chain.length - 1 && parent !== ROOT_ID) {
        cols.push({ key: `col:${parent}`, parentId: parent, members: [], activeId: null, pattern: "tree", patternName: "",
          layout: { items: [], ports: [], prims: [], expressed: [], leafIds: [], height: 40, readingY: null }, width: ATLAS.COL_W, empty: emptyKind(g, focus, o.preview) });
      }
      continue;
    }
    const pattern: FlowPattern = members.length > ATLAS.BIG_COLUMN ? "grid" : members.length >= 2 ? patternFor(g, parent, members) : "tree";
    const ctx: LayoutCtx = {
      g, plan: ATLAS_PLAN, colors: o.colors, pattern, cut: parent,
      header: parent === ROOT_ID ? o.rootTitle : String(g.nodes[parent]?.title ?? ""),
      patternName: o.patternLabel(pattern), members,
      colorOf: new Map(members.map((id, i) => [id, id === o.readingId ? o.colors.accent : o.colors.palette[i % 8]] as const)),
      paletteOf: new Map(members.map((id, i) => [id, o.colors.palette[i % 8]] as const)),
      moreAbove: 0, moreBelow: 0, readingId: o.readingId, readingBlock: null,
      selectedId: focus, expandedId: null,
      inlineH: members.includes(focus) && focus !== ROOT_ID ? Math.max(ATLAS.INLINE_MIN_H, o.inlineH) : 0,
      maxLines0: 2, canBack: false,
      availH: Math.max(360, o.stageH - 96), maxW: FLOW.CMP_MAX_W, cmpPage: o.cmpPage[`col:${parent}`] ?? 0,
    };
    // 论证图在全景里不重复画「根论点」：父节点就在左一栏、流带已经连着它
    const layout = pattern === "argument" ? layoutTree(ctx, { compact: false, claimRoot: false, layered: false, spans: true }) : layoutFor(ctx);
    const width = Math.max(ATLAS.COL_W, ...layout.items.map((it) => it.x + it.w + FLOW.PAD_R));
    cols.push({ key: `col:${parent}`, parentId: parent, members, activeId, pattern, patternName: ctx.patternName, layout, width, empty: null });
  }
  return cols;
}
```

注意：
- 根栏 `activeId` 恒为 `ROOT_ID`（根行要么是焦点，要么在路径上）。焦点＝ROOT 时，焦点所在栏就是根栏。
- 颜色规则与随文结构完全一致：`palette[成员下标 % 8]`、阅读节点＝accent（`StructureFlowHost` L736）。所以同一节点在两处颜色相同，交接时不会变色。
- `LayoutCtx` 的字段以 `layout.ts` L227 起的定义为准；如有本文未列的必填字段，照 `StructureFlowHost` L748–768 的 `fitBase` 补。

### 4.3 排布

```ts
const activeItem = (c: AtlasColumn) =>
  c.activeId ? c.layout.items.find((it) => it.nodeId === c.activeId && (it.kind === "node" || it.kind === "kid") && !it.peek) ?? null : null;

/** 焦点所在栏水平居中；有路径行的栏把路径行中心放在 yc；+1 栏 / 空栏居中于 yc 并夹在上下边距内（太高则顶对齐） */
export function placeColumns(cols: AtlasColumn[], focus: string, stage: { w: number; h: number }): { pos: AtlasPos[]; fi: number; yc: number } {
  const yc = Math.round(stage.h * ATLAS.CENTER_Y);
  let fi = cols.findIndex((c) => c.activeId === focus && c.members.includes(focus));
  if (fi < 0) fi = 0;
  const pos: AtlasPos[] = cols.map(() => ({ x: 0, y: 0 }));
  pos[fi].x = Math.round(stage.w / 2 - cols[fi].width / 2);
  for (let j = fi + 1; j < cols.length; j++) pos[j].x = pos[j - 1].x + cols[j - 1].width + ATLAS.GAP;
  for (let j = fi - 1; j >= 0; j--) pos[j].x = pos[j + 1].x - ATLAS.GAP - cols[j].width;
  cols.forEach((c, j) => {
    const a = activeItem(c);
    if (a) {
      pos[j].y = Math.round(yc - (a.y + a.h / 2));
      return;
    }
    const h = c.layout.height;
    const room = stage.h - 2 * ATLAS.MARGIN_Y;
    pos[j].y = h <= room ? Math.round(Math.min(Math.max(yc - h / 2, ATLAS.MARGIN_Y), stage.h - ATLAS.MARGIN_Y - h)) : ATLAS.MARGIN_Y;
  });
  return { pos, fi, yc };
}

/** 平移到「焦点居中」时的 pan（缩放以世界原点 0,0 为基准）：k=1 时为 (0,0) */
export const centerPan = (k: number, stage: { w: number; h: number }, yc: number) => ({ x: Math.round((1 - k) * (stage.w / 2)), y: Math.round((1 - k) * yc) });

/** 平移软边界：所有栏的包围盒至少留 PAN_MARGIN 在视口内 */
export function clampPan(p: { x: number; y: number }, k: number, cols: AtlasColumn[], pos: AtlasPos[], stage: { w: number; h: number }) {
  if (!cols.length) return p;
  const minX = Math.min(...pos.map((q) => q.x)), maxX = Math.max(...pos.map((q, j) => q.x + cols[j].width));
  const minY = Math.min(...pos.map((q) => q.y)), maxY = Math.max(...pos.map((q, j) => q.y + cols[j].layout.height));
  const m = ATLAS.PAN_MARGIN;
  return {
    x: Math.min(stage.w - m - minX * k, Math.max(m - maxX * k, p.x)),
    y: Math.min(stage.h - m - minY * k, Math.max(m - maxY * k, p.y)),
  };
}
```

### 4.4 栏间流带

```ts
/** 每对相邻栏：左栏路径行（或焦点行）→ 右栏每个成员的竖条。源区间＝该行标签高度按子节点篇幅切片（Sankey） */
export function buildAtlasLinks(g: GraphState, cols: AtlasColumn[], pos: AtlasPos[], o: { focus: string; hoverId: string | null; pathIds: ReadonlySet<string> }): AtlasLink[] {
  const out: AtlasLink[] = [];
  for (let j = 0; j + 1 < cols.length; j++) {
    const A = cols[j], B = cols[j + 1];
    if (!A.activeId || B.empty || B.parentId !== A.activeId) continue;
    const a = activeItem(A);
    if (!a) continue;
    const ports = B.layout.ports.filter((p) => B.members.includes(p.nodeId)).slice().sort((p, q) => p.y0 - q.y0);
    if (!ports.length) continue;
    const L = pos[j].x + a.x - ATLAS.LINK_PAD;
    const xs = pos[j].x + a.x + a.w + ATLAS.LINK_PAD;
    const top = pos[j].y + a.y + 1, bot = pos[j].y + a.y + a.h - 1;
    const total = ports.reduce((s, p) => s + valueOf(g, p.nodeId), 0);
    const half = (v: number) => Math.round(v * 2) / 2;
    let acc = 0;
    for (const p of ports) {
      const s0 = half(top + ((bot - top) * acc) / total);
      acc += valueOf(g, p.nodeId);
      const s1 = Math.max(s0 + 0.5, half(top + ((bot - top) * acc) / total));
      const tone: 0 | 1 | 2 = p.nodeId === o.hoverId ? 2 : p.nodeId === o.focus || o.pathIds.has(p.nodeId) ? 1 : 0;
      out.push({ id: `lk:${A.activeId}>${p.nodeId}`, from: A.activeId, to: p.nodeId, color: p.color, tone,
        L, xs, s0, s1, x1: pos[j + 1].x + p.x, t0: pos[j + 1].y + p.y0, t1: pos[j + 1].y + p.y1 });
    }
  }
  return out.sort((x, y) => x.tone - y.tone);
}

/** 路径（与 shapePath 同一命令序列 → CSS d 可插值） */
export const atlasLinkPath = (l: AtlasLink) => shapePath(l);
/** 进场起点：收在源行右缘（宽为 0 的颈） */
export const collapseLink = (l: AtlasLink): AtlasLink => ({ ...l, x1: l.xs, t0: l.s0, t1: l.s1 });

/** 渐变（gradientUnits="objectBoundingBox"，x1=0 → x2=1；包围盒横向恰为 L..x1，几何动画时渐变跟着走） */
export function atlasLinkStops(l: AtlasLink, colors: FlowColors): { offset: number; opacity: number }[] {
  const D = Math.max(1, l.x1 - l.L);
  const r = Math.min(1, Math.max(0, (l.xs - l.L) / D));
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const a = colors.aHL[l.tone], e = colors.aEnd[l.tone];
  return [
    { offset: 0, opacity: 0 },
    { offset: r3(r * 0.45), opacity: a * 0.5 },
    { offset: r3(r), opacity: a },
    { offset: 1, opacity: e },
  ];
}

/** 栏内关系线（沿用 buildStrands；默认只留碰到焦点/悬停的强关系，「显示全部关系」时全留） */
export function columnStrands(g: GraphState, c: AtlasColumn, o: { focusId: string | null; all: boolean }): FlowStrand[] {
  if (c.empty || c.key === "col:^") return [];
  const list = buildStrands(g, c.layout, 0, { textRight: ATLAS.STRAND_TEXT_RIGHT, focusId: o.focusId, all: o.all });
  return o.all ? list : list.filter((s) => s.strong);
}
```

### 4.5 交接位移（FLIP 起点）

```ts
/** 把随文结构快照里的行与竖条「搬」到快照屏幕位置（栏局部坐标），返回首帧用的布局与 keep 集合。
 *  matchAll：本栏是随文结构的同一组（key === `col:${snap.cut}`）→ 连栏头 "head" 一起匹配；否则只匹配 `n:` 行。 */
export function displaceLayout(lay: PatternLayout, colPos: AtlasPos, origin: { left: number; top: number }, snap: FlowSnapshot, matchAll: boolean): { layout: PatternLayout; keep: Set<string> } {
  const keep = new Set<string>();
  const ox = origin.left + colPos.x, oy = origin.top + colPos.y;
  const items = lay.items.map((it) => {
    if (!matchAll && !it.id.startsWith("n:")) return it;
    const r = snap.items.get(it.id);
    if (!r) return it;
    keep.add(it.id);
    return { ...it, x: Math.round(r.left - ox), y: Math.round(r.top - oy) };
  });
  const prims = lay.prims.map((p) => {
    if (p.k !== "rect" || !p.id.startsWith("bar:")) return p;
    const r = snap.bars.get(p.id.slice(4));
    if (!r) return p;
    keep.add(p.id);
    return { ...p, x: Math.round(r.left - ox), y: Math.round(r.top - oy), h: Math.max(2, Math.round(r.height)) };
  });
  return { layout: { ...lay, items, prims }, keep };
}

/** 快照里的材料根真实 id → ROOT_ID（随文结构的图没有「抬升」材料根，结构全景抬升了，见 mindmapV2.liftLoad） */
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
```

> 说明：`FlowPrim` 的 rect 分支字段名以 `types.ts` 为准（本文按 `x/y/w/h/rx/fill/opacity/layer` 写，与 `layoutTree` 推 prim 的写法一致）。

---

## 5. 渲染器改动（`FlowLayer.tsx` / `types.ts`）

### 5.1 `FlowScene` 增两个可选字段（`src/lib/flow/types.ts`）

```ts
  /** D254：open 编排的起始延迟（ms；缺省 360＝随文结构 §8.1 原值）。结构全景按「离焦点几栏」错开 */
  openBase?: number;
  /** D254：交接保留集（FlowItem.id 或 prim id）。命中的元素首次挂载不走 enter 透明、延迟恒 0（它们是从随文结构"接过来"的） */
  keepIds?: ReadonlySet<string>;
```

### 5.2 `UpperGenImpl` 改动（逐处）

1. 文件顶部 `const SvgRoot = …` 改为 `export const SvgRoot = …`；文件底部 `const UpperGen = memo(…)` 改为 `export const UpperGen = memo(…)`。
2. 延迟函数（现 L307–313）改为：
   ```ts
   const ob = base.openBase ?? 360;
   const keep = base.keepIds;
   const delayFor = (i: number, ph: Phase) => {
     if (motion === "open") return ph === "exit" ? 0 : ob + stagger(i, 22, 200);
     if (motion === "close") return stagger(i, 12, 96);
     return 0;
   };
   const strandDelay = (i: number) => (motion === "open" ? ob + 400 + stagger(i, 40, 240) : 0);
   const primDelay = () => (motion === "open" ? ob + 120 : motion === "close" ? 60 : 0);
   ```
   （缺省 `ob=360` 时与现值 360 / 480 / 760 完全相同——随文结构行为不变。）
3. `renderPrim` 内 `const ent = ph === "enter";` 改为 `const ent = ph === "enter" && !keep?.has(p.id);`
4. `renderItem` 内 `const ent = ph === "enter";` 改为 `const ent = ph === "enter" && !keep?.has(it.id);`
5. 两处 prims 渲染调用里的延迟：`ph === "exit" ? 0 : primDelay()` 改为 `ph === "exit" || keep?.has(p.id) ? 0 : primDelay()`；标签列 `renderItem(item, ph, delayFor(i, ph))` 改为 `renderItem(item, ph, keep?.has(item.id) ? 0 : delayFor(i, ph))`。
6. `sameBase` 末尾追加：`&& a.openBase === b.openBase && a.keepIds === b.keepIds && a.genKey === b.genKey`。
7. `FlowLayer` 动作行（现 L132）文案：`T("在完整图谱中打开")` → `T("在结构全景中查看")`。

---

## 6. 舞台 `src/components/reader/atlas/AtlasStage.tsx`

### 6.1 Props

```ts
export interface AtlasStageProps {
  graph: GraphState;              // 已节流（§6.3）
  rootTitle: string;
  preview: boolean;
  loading: boolean;               // 首次读图中且无缓存
  unsupported: boolean;
  focus: string;
  onFocus: (id: string) => void;  // 导航（点击 / 键盘 / 面包屑 / 搜索 / 关系）
  readingId: string | null;
  phase: "entering" | "open" | "exiting";
  entry: AtlasEntry | null;
  snapshot: FlowSnapshot | null;  // 已 normalize；只在 entry.seq 首次渲染时用
  relAll: boolean;
  zoom: number;
  onZoom: (k: number) => void;
  centerSeq: number;              // 变化＝回到焦点居中（动画）
  inline: React.ReactNode;        // <AtlasInline …/>，焦点＝ROOT 时为 null
  inlineH: number;
  onJump: (id: string) => void;   // 双击行
  onDeepen: (id: string) => void; // 空栏「深挖 →」
  onExit: () => void;             // Esc
  onExited: () => void;           // 退场动画结束
  onGenerate?: () => void;        // 空图「生成导图」
}
export interface AtlasEntry { seq: number; origin: "button" | "flow" | "indicator"; nodeId: string | null; snapshot: FlowSnapshot | null }
```

### 6.2 DOM 结构

```tsx
<div className="atlas-stage" ref={stageRef} tabIndex={0} role="region" aria-label={T("结构全景")}
     data-phase={phase} data-entry={entryKind /* "handoff" | "button" | undefined */} data-panning={panning ? "1" : undefined}
     data-motion={motionOff ? "off" : undefined}
     onPointerDown/Move/Up/Leave={…§6.6} onKeyDown={…§6.7}>
  <div className="atlas-bg" ref={bgRef} />
  <div className="atlas-viewport">
    <div className="atlas-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
      <SvgRoot className="atlas-links" aria-hidden="true">
        <defs>{links.map(l => <linearGradient key id={`alg-${rawId(l.id)}`} gradientUnits="objectBoundingBox" x1="0" y1="0" x2="1" y2="0">
                 {atlasLinkStops(l, colors).map((s, i) => <stop key={i} offset={s.offset} stopColor={l.color} stopOpacity={s.opacity} />)}
               </linearGradient>)}</defs>
        {linksP.map(({ item: l, phase: ph }) => {
          const d = atlasLinkPath(ph === "enter" ? collapseLink(l) : l);
          return <path key={l.id} className="atlas-link" d={d} fill={`url(#alg-${rawId(l.id)})`}
                   style={{ d: `path("${d}")`, opacity: ph === "exit" ? 0 : 1, transitionDelay: linkDelay(l.id) }} data-link-id={l.id} />;
        })}
      </SvgRoot>
      {colsP.map(({ item: c, phase: ph }) => (
        <div key={c.key} className="atlas-col" data-col={c.key} data-phase={ph === "exit" ? "exit" : undefined}
             data-enter={enteredThisMotion.has(c.key) ? "1" : undefined}
             style={{ transform: `translate(${posOf(c.key).x}px, ${posOf(c.key).y}px)`, width: c.width, height: c.layout.height,
                      "--atlas-col-delay": `${colDelay(c.key)}ms`, "--atlas-col-dx": `${colDx(c.key)}px`,
                      "--atlas-out-delay": `${outDelay(c.key)}ms` } as CSSProperties}>
          {c.empty ? <EmptyColumn kind={c.empty} … /> : <UpperGen base={sceneOf(c)} phase="live" fadeIn={false} onEvent={onFlowEvent} />}
          {c.members.includes(focus) && inline ? <div className="atlas-inline-slot" style={{ transform: `translate(${inlineAt(c).x}px, ${inlineAt(c).y}px)`, width: inlineAt(c).w }}>{inline}</div> : null}
        </div>
      ))}
    </div>
  </div>
  {stageEmpty /* 加载中 / 无结构 / 不支持 */}
</div>
```

- `linksP = usePresence(links, ATLAS_T.COL_REMOVE)`、`colsP = usePresence(cols.map(c => ({ id: c.key, ...c })), ATLAS_T.COL_REMOVE)`（`usePresence` 来自 `src/lib/flow/presence.ts`，要求元素有 `id` 字段——把 `key` 复制成 `id`）。
- `inlineAt(c)`：`c.layout.inlineAt ?? { x: F.x, y: F.y + F.h, w: F.w }`，F＝该栏焦点行 item（与 `FlowLayer` L82 同一口径）。
- `rawId` 与 `FlowLayer` 同：`String(raw).replace(/[^a-zA-Z0-9_-]/g, "_")`。
- `<svg>` 一律用从 `FlowLayer` 导出的 `SvgRoot`（棘轮）。

### 6.3 数据流（每次渲染）

```ts
const colors = useMemo(() => resolveColors(stageRef.current), [stageEl, colorTick]); // 主题变化监听照抄 StructureFlowHost L211–221
const [stage, setStage] = useState({ w: 0, h: 0 });   // ResizeObserver 量 .atlas-stage 的 clientWidth/clientHeight
const cols = useMemo(() => stage.h ? buildAtlasColumns(graph, { focus, rootTitle, colors, readingId, inlineH: focus === ROOT_ID ? 0 : inlineH, stageH: stage.h, cmpPage,
  patternLabel: (p) => T(PATTERN_LABEL[p]), rootMeta: T("全文"), preview }) : [], [graph, focus, rootTitle, colors, readingId, inlineH, stage.h, cmpPage, preview, T]);
const { pos, fi, yc } = useMemo(() => placeColumns(cols, focusInGraph, stage), [cols, focusInGraph, stage]);
const pathIds = useMemo(() => new Set(atlasChain(graph, focusInGraph)), [graph, focusInGraph]);
const links = useMemo(() => buildAtlasLinks(graph, cols, pos, { focus: focusInGraph, hoverId, pathIds }), [graph, cols, pos, focusInGraph, hoverId, pathIds]);
```
- `focusInGraph = graph.nodes[focus] || focus === ROOT_ID ? focus : ROOT_ID`（焦点节点被删除 / 换版本后不存在 → 退回根）。
- `graph` 由 MindmapTab 传入前先节流：`useThrottled(graph, ATLAS.LAYOUT_THROTTLE_MS)`——首值立即生效，之后至多每 250ms 更新一次，并保证最后一个值在 250ms 内落地（trailing）。实现照下：
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
- 每栏的 `FlowScene`（`sceneOf(c)`，用 `useMemo` 按栏缓存，**引用稳定**否则 `UpperGen` 的 memo 失效）：
  ```ts
  {
    seq: sceneSeq, mode: "inside", motion: colMotion(c.key) /* "open" | "steady" */, tracking: false,
    genKey: c.key, switchDir: "down", shifting: false, plan: ATLAS_PLAN,
    viewport: { left: 0, top: 0, right: stage.w, bottom: stage.h }, colors, pattern: c.pattern, patternName: c.patternName,
    dy: 0, layout: firstFrameLayout(c) ?? c.layout, shapes: [], strands: columnStrands(graph, c, { focusId: hoverId ?? focusInGraph, all: relAll }),
    inline: { forId: null, explainOpen: false, explainText: "", explainBusy: false, status: "" },
    hoverId, focusId: focusInGraph, canBack: false, panel: { kind: "ok", feedDone: 0, feedTotal: 0 },
    armed: true, smooth: false, openBase: colMotion(c.key) === "open" ? colDelay(c.key) : undefined, keepIds: keepOf(c.key),
  }
  ```

### 6.4 动效状态机（核心）

用一个 ref 记录当前编排：

```ts
type MotionKind = "enter-handoff" | "enter" | "nav" | "exit" | "steady";
const mo = useRef<{ kind: MotionKind; seq: number; fi: number; entered: Set<string>; exited: Set<string>; colDelay: Map<string, number>; linkDelay: Map<string, number>; dx: Map<string, number> }>(…);
```

**(a) 进入 · 交接（`entry.snapshot` 非空，且 `motionPreference() !== "off"`）**——只在该 `entry.seq` 的第一次「cols 非空」渲染时触发：
1. 计算 `pos`（真实终点）。对每一栏：`matchAll = c.key === \`col:${snapshot.cut}\``，`displaceLayout(c.layout, pos[j], stageRect, snapshot, matchAll)` → `firstFrame.set(c.key, layout)`、`keep.set(c.key, keepSet)`。`stageRect = stageRef.current.getBoundingClientRect()`；首帧强制 `pan = {0,0}`、`zoom = 1`（进入时 `onZoom(1)`）。
2. 设 `data-entry="handoff"`（CSS 把 `--flow-t-geo` 设为 420ms）。
3. 首帧渲染 `firstFrame` 布局（命中 keep 的行/竖条不透明、在快照位置；其余 enter 透明）。
4. **两次 `requestAnimationFrame` 之后**清掉 `firstFrame`（换回真实布局，keep 不清）→ CSS 过渡把命中的行与竖条在 420ms 内滑到真实位置。焦点行恰好落在舞台正中。
5. 栏延迟：`d = |j − fi|`；`colDelay = d === 0 ? HANDOFF_UNFOLD : HANDOFF_UNFOLD + (d − 1) × COL_STEP_ENTER`；`entered` 包含**除焦点栏外**所有栏（它们带 `data-enter="1"` 播 `atlas-col-in`），焦点栏的未命中行由 UpperGen 的 open 编排在 `openBase = HANDOFF_UNFOLD` 起淡入；所有栏 `motion = "open"`。
6. `dx`：栏在焦点右侧 → `−12`（从焦点方向滑来），左侧 → `+12`，焦点栏 → `0`。
7. 流带：全部是新的；`linkDelay(id) = max(colDelay(左栏), colDelay(右栏)) + LINK_DELAY`，CSS 写在内联 `transitionDelay`，过渡曲线见 §14（进场 `d` 用 `LINK_IN` 360ms ease-out）。
8. 行内块在 `INLINE_DELAY_HANDOFF`（420ms）后淡入（行内块根节点用 `.flow-inline` 自带的 `flow-inline-in` 动画，`style={{ "--flow-delay": "420ms" }}`）。
9. `ATLAS_T.HANDOFF_UNFOLD + maxD × COL_STEP_ENTER + LINK_IN + 120`（封顶 1200）ms 后：`mo.kind = "steady"`，清 `colDelay/linkDelay/entered/keep`，去掉 `data-entry`（`--flow-t-geo` 回 360）。

**(b) 进入 · 按钮 / 指示器（无快照）**：
- `colDelay = BUTTON_UNFOLD + d × COL_STEP_ENTER`（焦点栏 80ms，向外每栏 +90）；`entered` 含所有栏；焦点栏 `dx = 0`；其余同 (a)-6/7；行内块延迟 `INLINE_DELAY_BUTTON`；`data-entry="button"`。
- 若图尚未就绪（`cols` 为空），先只显示背景与 §6.8 的骨架；就绪后的第一次渲染再执行本编排。

**(c) 导航（`focus` 变化，且不在进入编排中）**：
- 新旧 `cols` 按 `key` 对比：
  - 两边都有 → 只改位置（CSS `transform` 360ms），栏内行的变化（焦点下划线、行内块插入导致的下移）由 UpperGen 的 CSS 过渡完成（同 360ms，因为 `.atlas-stage` 下 `--flow-t-geo: 360ms`）。
  - 只在旧的 → presence exit：`data-phase="exit"`，`--atlas-col-dx` ＝（旧位置在新焦点栏右侧 ? +12 : −12），120ms 淡出、160ms 卸载。
  - 只在新的 → `entered`：`colDelay = NAV_UNFOLD + (d − 1) × COL_STEP_NAV`（d≥1），`dx` 规则同 (a)-6，`motion = "open"`，`openBase = colDelay`。
- 流带：同 id 的移动（`d` 过渡 360ms），新的 `linkDelay = colDelay(右栏) + LINK_DELAY` 收起→展开，消失的 120ms 淡出。
- 世界平移：`pan = centerPan(zoom, stage, yc)`，带过渡（不设 `data-panning`）。
- `NAV_UNFOLD + maxNewD × COL_STEP_NAV + LINK_IN + 60` ms 后回 `steady`。
- 导航途中又导航：直接以当前状态为起点重算（CSS 过渡天然从当前值转向，不排队）。

**(d) 退场（`phase` 变为 `"exiting"`）**：
- `outDelay(c) = min(EXIT_STEP_CAP, (maxD − d) × EXIT_STEP)`（最外的栏先走，焦点栏最后）；CSS `.atlas-stage[data-phase="exiting"] .atlas-col` 淡出 160ms。
- 流带层 120ms 淡出；背景 `bgRef.animate([{opacity:1},{opacity:0}], { duration: BG_OUT, delay: BG_OUT_DELAY + min(EXIT_STEP_CAP, maxD × EXIT_STEP) / 2, easing: "cubic-bezier(0.4,0,1,1)", fill: "forwards" })`。
- `EXIT_DONE + min(EXIT_STEP_CAP, maxD × EXIT_STEP)` ms 后调用 `onExited()`。

**(e) 背景淡入**：舞台挂载时 `bgRef.animate([{opacity:0},{opacity:1}], { duration: BG_IN, easing: "cubic-bezier(0,0,0.2,1)", fill: "backwards" })`。无 WAAPI（jsdom）时直接不动画。

**(f) 减弱动效**（`motionPreference() === "off"` 或系统 reduce）：`data-motion="off"`；不做 FLIP（不算 firstFrame、keep 为空）、`colDelay/linkDelay` 全 0、`dx` 全 0；背景与栏只保留 `REDUCED` 120ms 透明度；退场 `onExited` 在 140ms 后调用。

**(g) 换版本（`graph.mapId` 变化）**：按 (b) 重新播一次进入编排（焦点保持，不存在则回根）。

### 6.5 事件（`onFlowEvent`，来自 UpperGen 的 `FlowEvent`）

| 事件 | 处理 |
|---|---|
| `hover` | 有 nodeId → 立即 `setHoverId`；null → `HOVER_CLEAR_MS` 后清（照抄 `StructureFlowHost` L944–947） |
| `click` | `nodeId === focus` → `centerSeq` 式回中（平移到 `centerPan`）；否则 `onFocus(nodeId)` |
| `dblclick` | `onJump(nodeId)`（ROOT 忽略） |
| `more` | 全景不产生 more（无窗口）；忽略 |
| `action: cmpPrev / cmpNext` | 该栏 `cmpPage[col.key]` ±1（钳到 `layout.cmpPages − 1`） |
| `action: back` | 不会出现（`canBack:false`） |

### 6.6 平移 / 缩放

- **滚轮**（原生监听，`passive: false`，`preventDefault`）：`ctrlKey || metaKey` → 以指针为中心缩放：`k' = clamp(k × (deltaY > 0 ? 1/ZOOM_STEP : ZOOM_STEP))`，`pan' = c − (c − pan) × k'/k`（c＝指针在舞台内坐标）；否则 `pan.y −= deltaY`、`pan.x −= (shiftKey ? deltaY : deltaX)`。每次滚轮设 `data-panning="1"`，最后一次滚轮 160ms 后撤掉（撤掉前不要有过渡，否则跟手性差）。
- **拖动**：在舞台空白处（`target.closest(".flow-item, .flow-inline, .atlas-inline, .atlas-empty, button, input, select, a")` 为空）按下；位移 > `DRAG_SLOP` 才 `setPointerCapture` 并开始平移（照抄 `MindmapCanvasV2` L640–676 的「超阈值才捕获」写法与 120ms 吞点击）。
- 所有 pan 写入前过 `clampPan`。
- `centerSeq` 变化 / 导航 → `pan = centerPan(zoom, stage, yc)`（有过渡）。
- 缩放只作用于 `.atlas-world` 的 `transform`；HTML 文字随之缩放（不重排）。

### 6.7 键盘（舞台挂载后 `stageRef.current.focus({ preventScroll: true })`）

首行：`if (isImeComposing(e)) return;`

| 键 | 动作 |
|---|---|
| ↑ / ↓ | 焦点所在栏的上一个 / 下一个成员（按 `members` 顺序）；到头不动 |
| ← | 焦点的父节点（顶层节点 → ROOT；ROOT 不动） |
| → | 焦点的第一个子节点（无子不动） |
| Enter | 焦点 `state` 为 `more` / `stub` → `onDeepen(focus)`；否则有子 → 同 → |
| Esc | `onExit()`（另见 §8.7 菜单优先） |
| `/` 或 Ctrl/⌘+F | 聚焦工具栏搜索框（`document.querySelector<HTMLInputElement>("[data-atlas-search]")?.focus()`），`preventDefault` |
| `+` / `=` / `-` / `0` | 放大 / 缩小 / 回到 100% 并居中 |

另：window 级 `keydown` 监听 Esc（冒泡阶段）：目标不在 input/textarea/select/contentEditable、且工具栏没有展开的菜单（`document.querySelector('.atlas-toolbar [aria-expanded="true"]')` 为空）时 `onExit()`——保证焦点不在舞台上时 Esc 也能返回。

### 6.8 空态（舞台级，居中于 `(stage.w/2, yc)`，`.atlas-empty-stage`）

| 条件 | 呈现 |
|---|---|
| `loading` 且图为空 | 三条骨架线（宽 74 / 128 / 108px，高 8px，间距 10px，`color-mix(fg 8%)`，`atlas-shimmer` 1.4s 往复）+「正在加载…」12px fg 52% |
| `unsupported` | 「当前材料没有可提取的文本结构（无目录且无章节），无法生成导图。」（已有 key）12px fg 60% |
| 非 loading、非 preview、`childrenOf(graph, ROOT_ID)` 为空 | 「本节还没有结构」+ 文字按钮「生成导图」（accent，调 `onGenerate`） |

### 6.9 空栏（`c.empty`，`.atlas-empty` 放在该栏内，局部 `translate(26px, 0)`，宽 248）

| kind | 呈现 |
|---|---|
| `more` | 「这一节还可以继续展开」12px fg 60%，下一行文字按钮「深挖 →」12px accent（`onDeepen(focus)`） |
| `streaming` | 「正在生成…」+ `.flow-progress.flow-progress-busy`（照抄结构流空态 CSS） |
| `floor` | 「已触底：没有更深的结构」12px fg 48% |
| `preview` | 「生成导图后可以继续深挖」12px fg 48% |

---

## 7. 行内块 `src/components/reader/atlas/AtlasInline.tsx`

外观与随文结构的动作行完全同款（复用 `.flow-inline` / `.flow-actions` / `.flow-explain` / `.flow-dots` / `.flow-status` 样式），额外加 `atlas-inline` 类。

```tsx
<div className="flow-inline atlas-inline" ref={rootRef} style={{ "--flow-delay": `${delayMs}ms` } as CSSProperties} data-atlas-inline={node.id}>
  <div className="flow-actions">
    {canJump && <><button data-atlas-act="jump" onClick={onJump}>{T("跳到原文")}</button><span aria-hidden="true">·</span></>}
    {canExplain && <><button data-atlas-act="explain" onClick={explainOpen ? onCloseExplain : onExplain}>{explainOpen ? T("收起讲解") : T("讲解")}</button><span aria-hidden="true">·</span></>}
    {canDeepen && <><button data-atlas-act="deepen" onClick={() => onDeepen(false)}>{T("深挖")}</button><span aria-hidden="true">·</span></>}
    {canCards && <><button data-atlas-act="cards" onClick={onCards}>{T("制卡")}</button><span aria-hidden="true">·</span></>}
    <button data-atlas-act="detail" onClick={toggleDetail}>{detailOpen ? T("收起详情") : T("详情")}</button>
  </div>
  <div className="atlas-inline-extra">
    {explainOpen && <div className="flow-explain" style={{ maxHeight: FLOW.EXPLAIN_MAX_H }}>…（与 FlowLayer L135–139 相同的三态：生成中圆点 / 文字 / 「还没有讲解」）</div>}
    {detailOpen && <AtlasDetail … />}
    {status && <div className="flow-status">{status}</div>}
  </div>
</div>
```

- 条件：`canJump = node.blockStart != null`；`canExplain = node.blockStart != null && node.state !== "streaming"`；`canDeepen = node.state === "more" || node.state === "stub"`；`canCards = !!onMakeCards && node.state !== "streaming"`。最后一个可见按钮后面不要留「·」（按上面写法，把 `<span>·</span>` 放在**下一个**按钮之前即可；实现时用数组 `filter(Boolean)` 后 `join` 分隔符）。
- 「讲解」：`explainOpen` 由 MindmapTab 持有（`explainFor === node.id`）；点开即 `requestExplain(node.id)`（已有缓存直接显示）；文字来自 `graph.explain[id] ?? node.explain`；`explainBusy[node.id]` 时显示 `.flow-dots`。
- **高度上报**：`ResizeObserver` 观察 `rootRef`，`h = Math.min(ATLAS.INLINE_MAX_H, Math.ceil(el.getBoundingClientRect().height))`，与上次差 ≥1 才 `onHeight(h)`。MindmapTab 把它作为 `inlineH` 传回布局（焦点行下方腾出这段高度，下面的行 360ms 平移让位）。焦点切换时先重置为 `ATLAS.INLINE_MIN_H`。
- `.atlas-inline-extra` 自身 `max-height: 280px; overflow-y: auto`（细滚动条同 `.flow-explain`）。

**`AtlasDetail`（同文件内的子组件）**：把 `NodeDetailV2.tsx` 的数据逻辑原样搬过来（`mindmapV2Api.nodeText` 取原文、`edgesOf` 关系、`graph.view.patterns` 手动版式、`STATE_LABEL`），改成紧凑标记：

```tsx
<div className="atlas-detail">
  <p className="atlas-detail-meta">{T(type)}{timeText ? ` · ${timeText}` : ""} · {T(STATE_LABEL[state] ?? state)}{v1ext ? ` · ${T("旧版")}` : ""}</p>
  {learnStatus && <p className="atlas-detail-meta">{T("已有 {n} 张卡", { n })}{kpExists ? ` · ${T("知识点已存在")}` : ""}</p>}
  {rels.length > 0 && <ul className="atlas-rel-list">{rels.map(e => <li key=…><button onClick={() => onFocusNode(other)}>{out ? T("本节点 {rel} → {title}", …) : T("{title} {rel} → 本节点", …)}</button></li>)}</ul>}
  {kids.length > 1 && <label className="atlas-detail-row"><span>{T("排列方式")}</span>
     <select className="atlas-select" value={manual ?? ""} onChange={e => onSetPattern(gid, (e.target.value || null) as PatternKey | null)}>
       <option value="">{T("自动")}</option>{PATTERN_KEYS.map(k => <option key={k} value={k}>{T(PATTERN_NAMES[k])}</option>)}
     </select></label>}
  {text?.text && <button className="atlas-link-btn" onClick={() => setShowText(v => !v)}>{showText ? T("收起原文") : T("查看对应原文（{n} 字）", { n: text.text.length })}</button>}
  {showText && <blockquote className="atlas-source">{text.text.length > 4000 ? text.text.slice(0, 4000) + "…" : text.text}</blockquote>}
  {state === "floor" && blockStart != null && <button className="atlas-link-btn" onClick={() => onDeepen(true)}>{T("仍要尝试深挖")}</button>}
</div>
```
`onFocusNode(other)` ＝ MindmapTab 的导航（会自动展开路径）。改「排列方式」会改 +1 栏的版式：该栏 key 不变，行/条按新版式 360ms 过渡。

---

## 8. 工具栏 `src/components/reader/atlas/AtlasToolbar.tsx`

### 8.1 放置

Reader 在 `.reader-engine-controls` 里**最后**加一个 `<div className="atlas-toolbar-host" data-atlas-toolbar-host ref={setAtlasToolbarHost} />`；MindmapTab 用 `createPortal(<AtlasToolbar …/>, toolbarHost)` 渲染。工具栏根：`<div className="atlas-toolbar" role="toolbar" aria-label={T("结构全景")}>`。

从左到右（`gap: var(--sp-2)`，全部 24px 高，复用 `.btn .btn-outline .btn-sm` 与 `.dd/.dd-btn/.dd-menu/.dd-item`）：

| 区块 | 选择器 | 内容 |
|---|---|---|
| 面包屑 | `.atlas-crumbs`（`flex: 1 1 auto; min-width: 0`） | §8.2 |
| 状态 | `.atlas-status`（`flex: 0 1 auto; max-width: 260px`） | §8.3；无内容时不渲染 |
| 搜索 | `.atlas-search-wrap` | §8.4 |
| 生成 | `.atlas-gen` | §8.5 |
| 版本 | `AtlasMenu id="versions" label={T("版本")}` | §8.6 |
| 视图 | `AtlasMenu id="view" label={T("视图")}` | `dd-item` 复选「显示全部关系」（`relAll`）；分隔线；`dd-item`「导出 SVG」（图空时 disabled） |
| 缩放 | `.atlas-zoom`（段控：`−` / `{Math.round(k×100)}%` / `+`） | `−`/`+` 以舞台中心缩放 `ZOOM_STEP`；点百分比＝回 100% 并居中 |
| 居中 | `button.btn.btn-outline.btn-sm[data-atlas-center]` `{T("居中")}` | `centerSeq++` |

窄窗（工具栏宽 < 860px，用 ResizeObserver 量 `.atlas-toolbar`）时：`.atlas-toolbar[data-narrow="1"]`——状态只留圆点（文字进 `title`），搜索框默认 140px。

### 8.2 面包屑

- `chain = atlasChain(graph, focus)`；每项文字：ROOT → `rootTitle`（后面若 `preview` 加 `.atlas-chip`「目录预览」，若旧版图加「旧版」），其它 → `node.title`。
- 项：`<button className="atlas-crumb" data-crumb={id}>`，12px，`color-mix(fg 62%)`，hover 100%；最后一项（焦点）`fg 90% / 600`、不可点（`aria-current="page"`）。分隔 `<span className="atlas-crumb-sep" aria-hidden="true">›</span>` fg 30%，左右各 4px。
- 超过 4 项：显示 第 1 项 · `…`（`AtlasMenu`，列出被省略的中间项）· 最后 2 项。
- 每项 `max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`；最后一项 `max-width: 260px`。
- 点击 → `onFocus(id)`。

### 8.3 状态

取第一个非空：`unsupported` 文案 → `feedLine`（「正在读取原文 i/n」/「读取原文出错：…」）→ `genRun`（`runLine(genRun)`，进度 `done/total`）→ `allRun` → `notice`。
```tsx
<div className="atlas-status" data-atlas-status data-busy={busy ? "1" : undefined} title={text}>
  <i className="atlas-status-dot" aria-hidden="true" /><span className="atlas-status-text">{text}</span>
  {progress != null && <span className="atlas-status-bar" aria-hidden="true"><i style={{ width: `${Math.round(progress * 100)}%` }} /></span>}
  {isNotice && <button className="atlas-status-x" aria-label={T("关闭提示")} onClick={clearNotice}>×</button>}
</div>
```
`progress`：feed 时 `done/total`；run 时 `total ? done/total : null`。

### 8.4 搜索

- `<input className="atlas-search" data-atlas-search placeholder={T("搜索标题 / 讲解")} value onChange />`，默认宽 200px，聚焦 280px（`transition: width 160ms var(--flow-ease)`）。
- 结果＝原 `searchResults` 逻辑（标题 + 讲解，≤12 条，按 `ord`）；有结果且输入框聚焦时在下方弹 `.dd-menu.atlas-search-menu`（`position:absolute; top: 28px; left: 0; min-width: 280px; max-height: 360px; overflow-y: auto`）。
- 每条 `.dd-item`：标题 13px + 第二行父标题 11px fg 48%（父为顶层 → 材料名）。
- ↑↓ 移动高亮（`aria-activedescendant`），Enter 选中（首行 `isImeComposing` 判断），Esc 清空并收起（`stopPropagation`，不触发退出全景）。选中 → `onFocus(id)`，清空输入并 blur 回舞台。

### 8.5 生成（原侧栏「生成」区整体搬来）

```
[生成导图](主按钮, 仅 preview && !genRun)  [停止](仅 genRun || allRun)  [生成 ▾](菜单)
```
- 主按钮：`button.btn.btn-primary.btn-sm[data-atlas-gen-main]`，`disabled={unsupported || feed.done === 0}`，`onClick={handleGenerate}`。
- 停止：`button.btn.btn-outline.btn-sm[data-atlas-stop]`，`onClick={handleCancel}`；文字：genRun → `停止`；仅 allRun → `停止深挖`。
- 菜单 `AtlasMenu id="gen" label={T("生成")}` 内容（`.atlas-menu-sec`，宽 320px，内边距 12px，13px）：
  - `!hasKey`：标题「AI 未配置」+ 原说明文案；其余项不显示；
  - `estimate && !genRun`：三行发送前预览（原文案，`.atlas-menu-note` 12px fg 62%）；
  - `!feedDone && !unsupported`：原提示「原文读取完成后显示预估；…」；
  - `!preview && !genRun`：`.dd-item`「重新生成」（`handleGenerate`）；
  - 复选「忽略缓存重新分析（每段都会实际调用）」（`force`）；
  - `!preview && mapId && moreCount > 0 && !allRun && !genRun`：`.dd-item`「深挖全部（{n} 个可深挖节点）」（原 title 提示保留）；
  - `preview && !genRun`：原提示「画布上是目录预览。…」改用新 key？——**不改文案**，直接沿用原 key。

### 8.6 版本

`AtlasMenu id="versions"`，菜单宽 340px，内容＝原「历史版本」区：preview 且有版本时的提示、无版本「暂无其他版本。」、列表每行 `[v2/旧版 徽标] 标题（当前）` + 第二行时间（11px fg 48%）+ 行右「删除」文字钮（hover 才变红：`color: var(--flow-counter)`；**不要**用悬停显形，按钮常显）。点行＝`setActive + loadMap + refreshVersions`（原逻辑）；删除＝原 `confirm` + `remove` 逻辑。当前版本行 `aria-current="true"`，左侧 2px accent 竖线。

### 8.7 `AtlasMenu`（同文件内）

照抄 `Reader.tsx` 的 `ReaderToolMenu` 结构（`.dd` / `.dd-btn` + `IconChevronDown` / `.dd-menu`），增加：同刻只开一个（工具栏持有 `openMenu` 状态）；点外部（`mousedown` capture）与 Esc（`stopPropagation`）收起；菜单 `data-atlas-menu={id}`，按钮 `aria-expanded`。

---

## 9. `MindmapTab.tsx` 改写

### 9.1 新 Props（替换原 `MindmapTabProps`）

```ts
export interface MindmapTabProps {
  kernel: import("../../lib/reader/kernel").ReaderKernel;
  documentId: string;
  title: string;
  stageHost: HTMLDivElement | null;     // Reader 的 .reader-atlas-layer
  toolbarHost: HTMLDivElement | null;   // Reader 的 .atlas-toolbar-host
  open: boolean;                        // false → 播退场，结束后 onExited
  entry: AtlasEntry | null;
  onExit: () => void;                   // Esc
  onExited: () => void;
  /** 跳到原文后：宿主退出全景并显示「回到刚才的位置」（back＝跳转前的位置） */
  onJumpToText: (back: import("../../lib/reader/kernel").ReaderLocation | null) => void;
  onMakeCardsFromNode?: MindmapTabProps_old["onMakeCardsFromNode"]; // 原签名不变
  initialMapId?: string | null;
  initialResumeRunId?: string | null;
}
```
删除：`canvasHost`、`focusRequest`、`onFocusConsumed`、`flash` 相关、`anchorId`、`focus`（关系透视）、`canvasRef`、`revealNode`、`handleKeyDown`、`toggleCollapse`、`handlePrefetch`、整个 `canvasView` 与 `<div className="mindmap-tab-panel">…</div>` 返回体、`NodeDetailV2` / `MindmapCanvasV2` 的 import。

**保留不动**（逐字）：读图 / 增量合入 / 缓冲 / run 跟踪 / 挂载送原文 / 预估 / 续跑 / `handleGenerate` / `handleDeepen` / `handleExpandAll` / `handleCancel` / `requestExplain` / `persistView` / `setPattern` / `makeCards` / 版本 / `searchResults` / 学习状态 / 自动讲解 / `mindmap.viewed` 埋点。

### 9.2 新增状态

```ts
const [focusId, setFocusId] = useState<string>(ROOT_ID);
const [readingId, setReadingId] = useState<string | null>(null);
const [inlineH, setInlineH] = useState<number>(ATLAS.INLINE_MIN_H);
const [explainFor, setExplainFor] = useState<string | null>(null);
const [detailOpen, setDetailOpen] = useState(false);
const [zoom, setZoom] = useState(1);
const [centerSeq, setCenterSeq] = useState(0);
const [phase, setPhase] = useState<"entering" | "open" | "exiting">("entering");
const userNavRef = useRef(false);            // 进入后用户是否已经自己导航过
const throttledGraph = useThrottled(graph, ATLAS.LAYOUT_THROTTLE_MS);
```
- `navigate(id)`：`userNavRef.current = true; setFocusId(id); setInlineH(ATLAS.INLINE_MIN_H); setDetailOpen(false); setExplainFor(explainFor === id ? id : null);`——`selectedId` 统一用 `focusId`（学习状态 / 自动讲解 / 制卡都以它为准；ROOT 映射到 `rootRef.current.node` 的逻辑保留）。
- `open` 变化：`true` → `setPhase("entering")`，编排结束由舞台回调置 `"open"`（可简化为 1200ms 后置 open）；`false` → `setPhase("exiting")`，舞台 `onExited` → 调用 props.`onExited()`。

### 9.3 进入时的焦点（`entry.seq` 变化时执行一次）

```ts
const snap = entry?.snapshot ? normalizeSnapshot(entry.snapshot, rootRef.current.id) : null;
const want = entry?.nodeId ? toAtlasId(entry.nodeId) : snap?.readingId ?? null;
// toAtlasId(id) = id === rootRef.current.id ? ROOT_ID : id
if (snap?.readingId) setReadingId(snap.readingId);
if (want && (want === ROOT_ID || graphRef.current.nodes[want])) setFocusId(want);
else {
  setFocusId(ROOT_ID);
  // 没有快照：现场定位阅读节点（与随文结构同一 IPC），LOCATE_TIMEOUT 内拿到且用户未导航 → 导航过去
  const probe = kernel.getReadingProbe?.();
  if (probe) void Promise.race([mindmapV2Api.locate({ documentId, unitAnchor: probe.unitAnchor, text: probe.text }), sleep(ATLAS_T.LOCATE_TIMEOUT).then(() => null)])
    .then((r) => { const id = r && r.nodeId ? toAtlasId(r.nodeId) : null; if (!id) return; setReadingId(id); if (!userNavRef.current && graphRef.current.nodes[id]) setFocusId(id); });
}
```
（`entry.nodeId` 为空时用快照的阅读节点；`entry.origin === "flow"` 且 nodeId 为空＝随文结构里没有选中项，也用阅读节点。）

### 9.4 首帧必须有图：`mindmapV2Api.load` 加缓存（`src/lib/mindmapV2.ts`）

交接动画要求结构全景**第一帧**就能排出布局。随文结构开着时它已经读过同一张图，所以给 `load` 加一个按文档的内存缓存：

```ts
const loadCache = new Map<string, GraphLoadResult>(); // key: documentId（只缓存 {documentId} 形式的调用）与 `map:${mapId}`
// 在 mindmapV2Api.load 的返回 promise 上 .then(r => { if (r?.meta?.mapId) { loadCache.set(`map:${r.meta.mapId}`, r); if (typeof arg !== "string" && "documentId" in arg) loadCache.set(String(arg.documentId), r); } return r; })
export function peekLoad(arg: string | { documentId: string }): GraphLoadResult | null {
  return loadCache.get(typeof arg === "string" ? `map:${arg}` : String(arg.documentId)) ?? null;
}
```
MindmapTab 初始化：`useState(() => { const c = peekLoad(initialMapId ?? { documentId }); const l = c ? liftLoad(c) : null; return l ? createGraph(l.load, String(l.load.meta.mapId)) : emptyGraph(null); })`，同时设置 `rootRef`、`mapIdRef`、`setLoading(false)`（缓存命中）。挂载流程照旧再 `loadMap` 一次（结果替换，同 mapId → 只是增量差异）。`GraphLoadResult` 即 `mindmapV2.ts` L11 的现有类型；`load` 的参数还可能是 `{ mapId }`，此时只写 `map:` 键。

### 9.5 跳到原文

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
（原文跳转在全景背景之下完成，全景淡出后用户直接看到新位置。）

### 9.6 渲染

```tsx
return (
  <>
    {toolbarHost && createPortal(<AtlasToolbar …/>, toolbarHost)}
    {stageHost && createPortal(
      <AtlasStage graph={throttledGraph} rootTitle={rootTitle} preview={preview} loading={loading} unsupported={unsupported}
        focus={focusId} onFocus={navigate} readingId={readingId} phase={phase} entry={entry} snapshot={snap}
        relAll={relAll} zoom={zoom} onZoom={setZoom} centerSeq={centerSeq} inlineH={inlineH}
        inline={focusId === ROOT_ID || !selected ? null : <AtlasInline … onHeight={setInlineH} />}
        onJump={(id) => { const n = graphRef.current.nodes[id]; if (n) void jumpToText(n); }}
        onDeepen={(id) => void handleDeepen(id)} onExit={onExit} onExited={onExited} onGenerate={() => void handleGenerate()} />,
      stageHost)}
  </>
);
```
**导出 SVG**（视图菜单）：不再有画布句柄，改为纯函数调用（把 `MindmapCanvasV2` 里 `frameLabel` / `labels` / `relName` 三个 `useMemo` 原样复制到 MindmapTab）：
```ts
const d = layoutGraph(graph, { cache: createLayoutCache(), locks: {}, lodExpanded: new Set(), frameLabel, rootTitle, noLod: true });
const routed = routeRelations(graph, d, { relAll: true, geometry: "all", relName });
const raw = buildCanvasSvg(d, routed, {}, { static: true, graph, rootTitle, labels, idPrefix: "mm2x-" });
const svg = DOMPurify.sanitize(raw, { USE_PROFILES: { svg: true, svgFilters: true } });
// 之后下载逻辑照原 exportSvg
```

---

## 10. 随文结构 → 结构全景的交接（R2 核心）

### 10.1 时间线（交接进入，单位 ms，0＝点击「在结构全景中查看」）

| 时刻 | 元素 | 变化 | 时长 / 曲线 |
|---|---|---|---|
| 0（同步） | 随文结构 | 拍快照 + 克隆两层（混合层、上层）挂到 body；随文结构宿主**立即卸载**渲染层（无关闭编排） | — |
| 0 | 克隆上层 | 已匹配的行 / 竖条在克隆里 `visibility:hidden`；其余（栏头外的预览、「另 N 项」、关系线、跨度条…）淡出 | 160 / `cubic-bezier(.4,0,1,1)` |
| 0 | 克隆混合层（正文上的高亮彩带） | 淡出 | 200 / 同上 |
| 0 | 全景背景 | 0 → 1（盖住正文） | 240 / `cubic-bezier(0,0,.2,1)` |
| 0 | 全景焦点栏 | 首帧把匹配的行、竖条画在快照位置（完全重合 → 视觉零变化） | — |
| ≈32（2 帧） | 同上 | 滑向真实位置：选中节点到舞台正中、兄弟行同步移动、行宽字号不变 | **420** / `--flow-ease` |
| 220 | 克隆 | 移除 | — |
| 280 | 正文 | 随文结构的平移 / 预留在不透明背景下归位（用户看不见） | 原 420 |
| 300 | 焦点栏未匹配的行 | open 编排：淡入（stagger 22，封顶 200）、竖条 scaleY 长出（+120）、跨度条/线描出 | 160 / 280 / 480 |
| 300 + (d−1)×90 | 第 d 远的栏（左：祖先；右：子） | 栏整体 `opacity 0→1` + `translate ±12px→0`（从焦点方向来）；栏内 open 编排同上 | 240 / `--flow-ease-out` |
| max(两端栏延迟)+60 | 栏间流带 | 从源行右缘「流」出：收起 → 展开 | 360 / `--flow-ease-out` |
| 420 | 焦点行内动作行 | `flow-inline-in` 展开 | 220 |
| ≈900–1200 | — | 回到 steady；`--flow-t-geo` 420 → 360 | — |

### 10.2 `src/components/reader/atlas/handoff.ts`

```ts
import type { DOMRectLike, FlowSnapshot } from "../../../lib/flow/atlas";
import { ATLAS_T } from "../../../lib/flow/atlas";
import { motionPreference } from "../../../lib/mindmap/v2/animate";

const rectOf = (el: Element): DOMRectLike => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };

/** 同步采集随文结构当前代（必须在任何 setState 之前调用）。随文结构未打开 → null */
export function captureFlowSnapshot(doc: Document): FlowSnapshot | null {
  const layer = doc.querySelector<HTMLElement>(".flow-layer");
  if (!layer) return null;
  const gens = Array.from(layer.querySelectorAll<HTMLElement>('.flow-gen:not([data-phase="exit"])'));
  const gen = gens[gens.length - 1];
  if (!gen) return null;
  const g = gen.getAttribute("data-gen");
  const snap: FlowSnapshot = { cut: g && g !== "none" ? g : null, readingId: null, items: new Map(), bars: new Map() };
  for (const el of Array.from(gen.querySelectorAll<HTMLElement>(".flow-item[data-flow-item]"))) {
    if (el.classList.contains("is-peek") || el.classList.contains("is-exit")) continue;
    const id = el.getAttribute("data-flow-item")!;
    snap.items.set(id, rectOf(el));
    if (el.getAttribute("data-reading") === "1" && id.startsWith("n:")) snap.readingId = id.slice(2);
  }
  for (const el of Array.from(gen.querySelectorAll('[data-prim-id^="bar:"]'))) snap.bars.set(el.getAttribute("data-prim-id")!.slice(4), rectOf(el));
  return snap;
}

/** 克隆随文结构两层并淡出（克隆直接挂 body、各自做动画——不要包一层容器，否则混合层的 mix-blend-mode 会被隔离） */
export function playFlowGhost(doc: Document, snap: FlowSnapshot): void {
  const off = motionPreference() === "off";
  const ghost = (src: Element | null, ms: number, hideMatched: boolean) => {
    if (!src) return;
    const c = src.cloneNode(true) as HTMLElement | SVGElement;
    c.setAttribute("data-atlas-ghost", "1");
    (c as HTMLElement).style.pointerEvents = "none";
    (c as HTMLElement).style.zIndex = "25";
    if (hideMatched) {
      for (const el of Array.from(c.querySelectorAll<HTMLElement>(".flow-item[data-flow-item]"))) {
        const id = el.getAttribute("data-flow-item")!;
        if ((id.startsWith("n:") || id === "head") && snap.items.has(id)) el.style.visibility = "hidden";
      }
      for (const el of Array.from(c.querySelectorAll<SVGElement>('[data-prim-id^="bar:"]'))) el.style.visibility = "hidden";
    }
    doc.body.appendChild(c);
    const dur = off ? ATLAS_T.REDUCED : ms;
    if (typeof (c as HTMLElement).animate === "function") (c as HTMLElement).animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" });
    else (c as HTMLElement).style.opacity = "0";
    window.setTimeout(() => c.remove(), Math.max(dur, ATLAS_T.GHOST_REMOVE));
  };
  ghost(doc.querySelector(".flow-blend"), ATLAS_T.GHOST_BLEND_OUT, false);
  ghost(doc.querySelector(".flow-layer"), ATLAS_T.GHOST_LAYER_OUT, true);
}
```

- 克隆上层里的退场代（`.flow-gen[data-phase="exit"]`）照样一起淡出，无需特殊处理。
- 已知小瑕疵（接受）：随文结构里展开的子项若在全景焦点栏中不存在，会在克隆里被隐藏而全景里也没有它——瞬间消失。实际只在"选中节点是别的成员的展开子项"时发生，且全景随即在 +1 栏长出它们。

### 10.3 `StructureFlowHost` 改动

1. `resolveColors` 改为 `export function resolveColors`（结构全景复用）。
2. Props 增：`coverMode?: "fade" | "handoff"`（缺省 `"fade"`）。
3. 新增：
   ```ts
   const handoffClose = useCallback(async () => {
     const ticket = ++ticketRef.current;
     setStage("closed");          // 渲染层立即卸载（克隆在 body 上负责淡出）
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
4. 开合 effect（现 L484–492）改为：
   ```ts
   } else if (stageRef.current === "opening" || stageRef.current === "open") {
     if (covered && props.coverMode === "handoff") void handoffClose();
     else void closeSeq();
   }
   ```
   依赖数组加 `handoffClose`、`props.coverMode`。
5. 全景退出后 `covered` 变回 false → 宿主照常 `openSeq()`（随文结构从正文"重新流出来"）。

---

## 11. `Reader.tsx` 改动

### 11.1 状态

```ts
/** 结构全景（D254）：open＝用户意图（按钮态）；mounted＝舞台在场（含退场动画） */
const [atlasOpen, setAtlasOpen] = useState(false);
const [atlasMounted, setAtlasMounted] = useState(false);
const [atlasEntry, setAtlasEntry] = useState<AtlasEntry | null>(null);
const [atlasLayerHost, setAtlasLayerHost] = useState<HTMLDivElement | null>(null);
const [atlasToolbarHost, setAtlasToolbarHost] = useState<HTMLDivElement | null>(null);
const [backChip, setBackChip] = useState<ReaderLocation | null>(null);
const backChipTimer = useRef<number | null>(null);
const wrapRef = useRef<HTMLDivElement | null>(null);     // 挂到 .reader-wrap
const atlasBtnRef = useRef<HTMLButtonElement | null>(null);

const openAtlas = useCallback((origin: AtlasEntry["origin"], nodeId: string | null) => {
  const snapshot = origin === "indicator" ? null : captureFlowSnapshot(document);   // 必须在 setState 之前
  if (snapshot) playFlowGhost(document, snapshot);
  setToolMenu(null);
  setAtlasEntry({ seq: Date.now(), origin, nodeId, snapshot });
  setAtlasMounted(true);
  setAtlasOpen(true);
}, []);
const closeAtlas = useCallback(() => setAtlasOpen(false), []);
```

删除：`mapFocus`、`mapLayerHost`、`lensOpenInMapRef` 的旧实现、`sidebarTab === "map"` 相关一切。

`lensOpenInMapRef.current = (nodeId) => openAtlas("flow", nodeId);`（`region` 参数忽略）。

`openMindmapInitially` 的 effect（现 L474–479）改为：`openAtlas("indicator", null); onMindmapOpened?.();`（不再 `setSidebarOpen(true)`）。

### 11.2 左上按钮（放在「展开/收起」开关之后，同一 `engineSource` 分支内）

```tsx
{lensKernel && contextRef?.documentId ? (
  <button
    ref={atlasBtnRef}
    type="button"
    className="bar-btn reader-atlas-toggle"
    data-reader-atlas-toggle
    aria-pressed={atlasOpen}
    title={atlasOpen ? T("返回阅读（Esc）") : T("结构全景：整本材料的结构，以正在读的位置为中心展开")}
    onClick={() => (atlasOpen ? closeAtlas() : openAtlas("button", null))}
  >
    <span key={atlasOpen ? "on" : "off"} className="reader-atlas-toggle-label">{atlasOpen ? T("返回阅读") : T("结构全景")}</span>
    <span aria-hidden="true">{atlasOpen ? T("结构全景") : T("返回阅读")}</span>
  </button>
) : null}
```
按钮宽度写入 CSS 变量（供工具栏与侧栏页签行让位）：
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

### 11.3 工具栏与舞台宿主

- `.reader-engine-controls` 加 `data-atlas={atlasOpen ? "1" : undefined}`，并在其**最后**加 `<div className="atlas-toolbar-host" data-atlas-toolbar-host ref={setAtlasToolbarHost} />`。
- `.reader-engine-viewport` 内、`reader-flow-gutter` 之后加 `<div className="reader-atlas-layer" data-reader-atlas-layer ref={setAtlasLayerHost} />`。
- 删除 `.reader-engine-main` 里的 `<div className="reader-map-layer" …/>`。
- 渲染 MindmapTab（放在 `StructureFlowHost` 之前）：
  ```tsx
  {atlasMounted && contextRef?.documentId && lensKernel ? (
    <MindmapTab
      kernel={kernelRef.current!}
      documentId={contextRef.documentId}
      title={title || sourceTitle || T("未命名材料")}
      stageHost={atlasLayerHost}
      toolbarHost={atlasToolbarHost}
      open={atlasOpen}
      entry={atlasEntry}
      onExit={closeAtlas}
      onExited={() => { setAtlasMounted(false); setAtlasEntry(null); }}
      onJumpToText={(back) => {
        track("reader.jumped", { libraryItemId: itemId, origin: "mindmap", props: { method: "mindmap" } });
        closeAtlas();
        if (back) showBackChip(back);
      }}
      initialMapId={openMindmapMapId || null}
      initialResumeRunId={resumeOnce}
      onMakeCardsFromNode={(payload) => { void runAICards(payload.section, undefined, "card-structure", { focus: payload.focus, mindmapNodeId: payload.nodeId }); }}
    />
  ) : null}
  ```
- `StructureFlowHost`：`covered={atlasMounted}`、`coverMode={atlasEntry?.snapshot ? "handoff" : "fade"}`；`onOpenInMap={(id) => lensOpenInMapRef.current(id)}`。

### 11.4 返回原处提示钮

```ts
const showBackChip = (loc: ReaderLocation) => {
  setBackChip(loc);
  if (backChipTimer.current) window.clearTimeout(backChipTimer.current);
  backChipTimer.current = window.setTimeout(() => setBackChip(null), 20000);
};
```
放在 `.reader-engine-controls-group` 里「随文结构」按钮之前：
```tsx
{backChip ? (
  <button type="button" className="btn btn-outline btn-sm reader-back-chip" data-reader-back-chip
    onClick={() => { const l = backChip; setBackChip(null); if (l) void kernelRef.current?.goTo(l); }}>
    {T("↩ 回到刚才的位置")}
  </button>
) : null}
```

### 11.5 「随文结构」按钮（原「结构图」）

文字 `T("随文结构")`；title：开 → `T("收起随文结构")`，关 → `T("随文结构：在正文右侧显示正在读的这一段所在的结构")`。其余不变。

### 11.6 与侧栏 / 目录的规则

| 场景 | 行为 |
|---|---|
| 进入全景 | **不改** `sidebarOpen`（侧栏开着就开着，全景在剩余宽度内居中） |
| 全景中点「展开」侧栏 | 允许；全景随舞台宽度变化 360ms 重新居中；按 §12.1 旧规则，随文结构 `lensOpen` 会被关掉（不变） |
| 全景中在侧栏目录点条目 | 先 `closeAtlas()`，再跳转（原逻辑） |
| 全景中按 Esc | `closeAtlas()` |
| 退出全景 | 阅读工具栏淡回；全景退场结束（`onExited`）后 `covered=false` → 随文结构若原本开着，按原开场编排重新出现 |
| markdown（粘贴书）分支 | 无内核，不显示左上「结构全景」按钮 |

---

## 12. `ReaderSidebar.tsx`

- `export type ReaderTab = "toc" | "extracts";`
- `tabs` 只剩 `["toc","目录"]`、`["extracts","摘录"]`。
- 删除 `mapPanel` prop 与 `shown === "map"` 分支。
- 着陆：`const shown = tab === "toc" && flat.length === 0 && extractsPanel ? "extracts" : tab;`
- 文件头注释第 3–6 行更新为：「三页签→两页签（目录 / 摘录）；图谱移出侧栏，改为左上「结构全景」独立入口（D254）」。
- Reader 里 `mapPanel={…}` 整段删除；`ReaderTab` 的 `"map"` 用法全部删除（grep `"map"` 于 `Reader.tsx`）。

---

## 13. 视觉细节（与随文结构逐项对齐）

| 部件 | 规格 |
|---|---|
| 栏 | 宽 294（对照表按内容可到 ~560）；栏间 96；栏头＝`父标题 · 版式名`（随文结构 `pushHeader` 原样：11px fg 52%，版式名右对齐） |
| 行 | 泳道 0–3：条宽 5/4/4/3、字号 14/13/13/12、字重 600/500/450/400、色调 96/90/84/72（`LANE_STYLE` 原样）；行尾 meta：有子＝`+N`，否则类型字（`metaOf` 原样） |
| 根行 | 15px / 20 / 650，条宽 5、色＝前景 70%，行尾「全文」 |
| 焦点 | 主题色字 + 1px 下划线（`[data-selected="1"]` 原样） |
| 阅读节点 | 主题色底 + 白字 pill（原样），在全景任何一栏出现都这样显示 |
| 栏间流带 | 源：路径行标签区（左 −6、右 +6）按子节点篇幅竖向切片；终：子节点竖条（port）；渐变 0 → 0.5·aHL（行宽 45% 处）→ aHL（行尾）→ aEnd（竖条）；aHL/aEnd 取 `--flow-ahl-*` / `--flow-aend-*` 的 tone 档：普通 0、路径/焦点 1、悬停 2 |
| 栏内关系线 | `buildStrands` 原样；默认只画碰到焦点/悬停的（主题色），「显示全部关系」画全部 |
| 左右渐隐 | `.atlas-viewport` 左右各 48px 透明度遮罩 |
| 背景 | `--reader-bg`；夜间阅读主题下自动深色（`resolveColors` 按阅读背景判深浅，与随文结构一致） |

---

## 14. CSS（`src/theme.css` 末尾新增一节；另改两处现有规则）

**改现有规则 1**（`.reader-engine-controls`，约 L5563）：`padding: var(--sp-2) var(--sp-4) var(--sp-2) var(--sp-16);` 改为
`padding: var(--sp-2) var(--sp-4) var(--sp-2) calc(var(--sp-16) + var(--reader-atlas-btn-w, 0px));`
（侧栏展开时的 `padding-left: var(--sp-4)` 规则保持不变。）

**改现有规则 2**（`.reader-sidebar .tabs`，约 L5907）：`padding: var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-16);` 改为
`padding: var(--sp-2) var(--sp-2) var(--sp-2) calc(var(--sp-16) + var(--reader-atlas-btn-w, 0px));`

**新增**（全部不写 `!important`；颜色只用变量）：

```css
/* ===================== 结构全景（D254，docs/design/STRUCTURE-ATLAS-D254.md） ===================== */
/* 左上入口：固定在侧栏开关右侧（16 + 40 + 8），两态同宽（两段文字叠在同一格，较宽者定宽） */
.reader-atlas-toggle.bar-btn {
  position: fixed;
  left: calc(var(--sp-4) + 40px + var(--sp-2));
  top: calc(48px + var(--sp-2));
  z-index: calc(var(--z-sticky) + 1);
  height: 24px;
  padding: 0 var(--sp-3);
  display: inline-grid;
  place-items: center;
  font-size: var(--fs-meta);
  border-color: var(--border-subtle);
  color: var(--text-helper);
  transition: color 160ms var(--flow-ease), border-color 160ms var(--flow-ease), background-color 160ms var(--flow-ease);
}
.reader-atlas-toggle.bar-btn > span { grid-area: 1 / 1; }
.reader-atlas-toggle.bar-btn > span[aria-hidden="true"] { visibility: hidden; }
.reader-atlas-toggle.bar-btn:hover { border-color: var(--text-primary); color: var(--text-primary); }
.reader-atlas-toggle.bar-btn[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.reader-atlas-toggle-label { animation: atlas-label-in 160ms var(--flow-ease) both; }
@keyframes atlas-label-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }

/* 工具带：阅读工具与全景工具同带交叉淡化 */
.reader-engine-controls > .atlas-toolbar-host {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  padding: inherit;
  opacity: 0;
  pointer-events: none;
  transition: opacity 160ms var(--flow-ease);
}
.reader-engine-controls > .atlas-toolbar-host:empty { display: none; }
.reader-engine-controls[data-atlas="1"] > .atlas-toolbar-host { opacity: 1; pointer-events: auto; transition-delay: 60ms; }
.reader-engine-controls > :not(.atlas-toolbar-host) { transition: opacity 120ms cubic-bezier(0.4, 0, 1, 1); }
.reader-engine-controls[data-atlas="1"] > :not(.atlas-toolbar-host) { opacity: 0; pointer-events: none; }
.reader-back-chip { color: var(--accent); }

.atlas-toolbar { display: flex; align-items: center; gap: var(--sp-2); width: 100%; min-width: 0; }
.atlas-crumbs { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; overflow: hidden; font-size: 12px; }
.atlas-crumb {
  max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  background: none; border: none; padding: 0; font: inherit; cursor: pointer;
  color: color-mix(in srgb, var(--reader-fg, var(--ink)) 62%, transparent);
}
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
.atlas-search {
  width: 200px; height: 24px; padding: 0 var(--sp-2); font-size: 12px;
  border: var(--bw-hairline) solid var(--reader-border, var(--border-subtle)); background: transparent; color: inherit;
  transition: width 160ms var(--flow-ease);
}
.atlas-search:focus { width: 280px; outline: none; border-color: var(--accent); }
.atlas-toolbar[data-narrow="1"] .atlas-search { width: 140px; }
.atlas-search-menu { position: absolute; top: 28px; left: 0; min-width: 280px; max-height: 360px; overflow-y: auto; }
.atlas-search-menu .dd-item small { display: block; font-size: 11px; color: var(--text-helper); }
.atlas-menu-sec { width: 320px; padding: var(--sp-3); font-size: 13px; }
.atlas-menu-note { font-size: 12px; color: var(--text-helper); margin: 0 0 var(--sp-2); }
.atlas-zoom { display: inline-flex; align-items: center; border: var(--bw-hairline) solid var(--reader-border, var(--border-subtle)); height: 24px; }
.atlas-zoom button { background: none; border: none; height: 22px; min-width: 24px; padding: 0 6px; font: inherit; font-size: 12px; color: inherit; cursor: pointer; font-variant-numeric: tabular-nums; }

/* 舞台 */
.reader-atlas-layer { position: absolute; inset: 0; z-index: 7; }
.reader-atlas-layer:empty { display: none; }
.atlas-stage {
  position: absolute; inset: 0; overflow: hidden; outline: none;
  color: var(--reader-fg, var(--ink)); font-family: var(--font-sans);
  user-select: none; -webkit-user-select: none; touch-action: none;
  --flow-t-geo: 360ms;
}
.atlas-stage[data-entry="handoff"] { --flow-t-geo: 420ms; }
.atlas-stage[data-panning="1"] { cursor: grabbing; }
.atlas-stage:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); }
.atlas-bg { position: absolute; inset: 0; background: var(--reader-bg, var(--paper)); }
.atlas-viewport {
  position: absolute; inset: 0;
  -webkit-mask-image: linear-gradient(to right, transparent 0, var(--ink) 48px, var(--ink) calc(100% - 48px), transparent 100%);
  mask-image: linear-gradient(to right, transparent 0, var(--ink) 48px, var(--ink) calc(100% - 48px), transparent 100%);
}
.atlas-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; transition: transform var(--flow-t-geo) var(--flow-ease); }
.atlas-stage[data-panning="1"] .atlas-world { transition: none; }
.atlas-links { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; }
.atlas-link { transition: d var(--flow-t-geo) var(--flow-ease), opacity 160ms var(--flow-ease); }
.atlas-link[data-new="1"] { transition: d 360ms var(--flow-ease-out), opacity 160ms var(--flow-ease); }
.atlas-stage[data-phase="exiting"] .atlas-links { opacity: 0; transition: opacity 120ms cubic-bezier(0.4, 0, 1, 1); }
.atlas-col { position: absolute; left: 0; top: 0; transition: transform var(--flow-t-geo) var(--flow-ease), opacity 160ms cubic-bezier(0.4, 0, 1, 1); }
.atlas-col[data-enter="1"] { animation: atlas-col-in 240ms var(--flow-ease-out) var(--atlas-col-delay, 0ms) both; }
.atlas-col[data-phase="exit"] {
  opacity: 0; translate: var(--atlas-col-dx, 0px) 0; pointer-events: none;
  transition: transform var(--flow-t-geo) var(--flow-ease), opacity 120ms cubic-bezier(0.4, 0, 1, 1), translate 160ms cubic-bezier(0.4, 0, 1, 1);
}
.atlas-stage[data-phase="exiting"] .atlas-col { opacity: 0; transition-delay: var(--atlas-out-delay, 0ms); pointer-events: none; }
@keyframes atlas-col-in { from { opacity: 0; translate: var(--atlas-col-dx, 0px) 0; } to { opacity: 1; translate: 0 0; } }
.atlas-inline-slot { position: absolute; left: 0; top: 0; transition: transform var(--flow-t-geo) var(--flow-ease); }
.atlas-inline.flow-inline { position: relative; overflow: visible; }
.atlas-inline .flow-actions { flex-wrap: wrap; height: auto; min-height: 26px; }
.atlas-inline-extra { max-height: 280px; overflow-y: auto; }
.atlas-inline-extra::-webkit-scrollbar { width: 6px; }
.atlas-inline-extra::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--reader-fg, var(--ink)) 18%, transparent); }
.atlas-detail { padding: 4px 0 8px; font-size: 12px; line-height: 18px; color: color-mix(in srgb, var(--reader-fg, var(--ink)) 78%, transparent); }
.atlas-detail-meta { margin: 0 0 4px; color: color-mix(in srgb, var(--reader-fg, var(--ink)) 52%, transparent); }
.atlas-rel-list { list-style: none; margin: 4px 0; padding: 0; }
.atlas-rel-list button, .atlas-link-btn { background: none; border: none; padding: 2px 0; font: inherit; text-align: left; cursor: pointer; color: color-mix(in srgb, var(--reader-fg, var(--ink)) 72%, transparent); }
.atlas-rel-list button:hover, .atlas-link-btn:hover { color: var(--reader-fg, var(--ink)); text-decoration: underline var(--accent) 1px; text-underline-offset: 3px; }
.atlas-detail-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
.atlas-select { height: 22px; font: inherit; font-size: 12px; background: transparent; color: inherit; border: var(--bw-hairline) solid color-mix(in srgb, var(--reader-fg, var(--ink)) 22%, transparent); }
.atlas-source { margin: 6px 0 0; padding-left: 8px; border-left: 2px solid color-mix(in srgb, var(--reader-fg, var(--ink)) 14%, transparent); max-height: 200px; overflow-y: auto; white-space: pre-wrap; }
.atlas-empty { position: absolute; left: 26px; top: 0; width: 248px; font-size: 12px; line-height: 20px; color: color-mix(in srgb, var(--reader-fg, var(--ink)) 60%, transparent); }
.atlas-empty[data-kind="floor"], .atlas-empty[data-kind="preview"] { color: color-mix(in srgb, var(--reader-fg, var(--ink)) 48%, transparent); }
.atlas-empty-stage { position: absolute; transform: translate(-50%, -50%); text-align: center; font-size: 12px; color: color-mix(in srgb, var(--reader-fg, var(--ink)) 60%, transparent); }
.atlas-skel { display: block; height: 8px; margin: 0 auto 10px; background: color-mix(in srgb, var(--reader-fg, var(--ink)) 8%, transparent); animation: atlas-shimmer 1400ms var(--flow-ease) infinite alternate; }
@keyframes atlas-shimmer { from { opacity: 0.5; } to { opacity: 1; } }

/* 降级（不写 !important：用更高特异性压过各元素自身过渡；内联 transitionDelay 在 JS 里按 motionOff 不写） */
.atlas-stage[data-motion="off"] .atlas-world,
.atlas-stage[data-motion="off"] .atlas-col,
.atlas-stage[data-motion="off"] .atlas-link,
.atlas-stage[data-motion="off"] .atlas-inline-slot,
.atlas-stage[data-motion="off"] .flow-item,
.atlas-stage[data-motion="off"] .flow-inline,
.atlas-stage[data-motion="off"] .flow-svg rect,
.atlas-stage[data-motion="off"] .flow-svg circle,
.atlas-stage[data-motion="off"] .flow-svg path,
.atlas-stage[data-motion="off"] .flow-strands path {
  transition-duration: 0ms;
  transition-delay: 0ms;
  animation-duration: 0ms;
  animation-delay: 0ms;
}
.atlas-stage[data-motion="off"] .atlas-col[data-phase="exit"],
.atlas-stage[data-motion="off"][data-phase="exiting"] .atlas-col { transition: opacity 120ms linear; }
@media (prefers-reduced-motion: reduce) {
  .atlas-world, .atlas-col, .atlas-link, .atlas-inline-slot,
  .atlas-stage .flow-item, .atlas-stage .flow-inline, .atlas-stage .flow-svg rect, .atlas-stage .flow-svg circle, .atlas-stage .flow-svg path,
  .reader-atlas-toggle-label, .reader-engine-controls > * {
    transition-duration: 0ms;
    transition-delay: 0ms;
    animation-duration: 0ms;
    animation-delay: 0ms;
  }
}
```

> 说明：`.atlas-col` 的位置用 `transform`，入/退场的位移用独立的 `translate` 属性（两者叠加不冲突）。`.flow-gen` / `.flow-item` / `.flow-svg` 等随文结构样式在 `.atlas-col` 里原样生效（它们不依赖 `.flow-layer` 祖先；若发现某条规则写成了 `.flow-layer .xxx`，在本节补一条 `.atlas-stage .xxx` 的等价规则，不要改原规则）。

---

## 15. 动效总表（交付时逐条对照）

| 场景 | 部件 | 时长 | 曲线 | 延迟 |
|---|---|---|---|---|
| 交接进入 | 克隆上层 / 混合层 | 160 / 200 淡出，220 移除 | `(.4,0,1,1)` | 0 |
| | 背景 | 240 淡入 | `(0,0,.2,1)` | 0 |
| | 匹配的行 + 竖条（FLIP） | 420 | `--flow-ease` | 2 帧 |
| | 焦点栏其余行 | open 编排（淡入 160，stagger 22/200；竖条 280；线 480） | 原值 | 300 |
| | 第 d 远的栏 | 240（opacity + translate ±12） | `--flow-ease-out` | 300+(d−1)×90 |
| | 栏间流带 | 360 收起→展开 | `--flow-ease-out` | 两端栏延迟较大者 +60 |
| | 行内动作行 | 220 | `--flow-ease` | 420 |
| 按钮进入 | 背景 | 240 | `(0,0,.2,1)` | 0 |
| | 第 d 远的栏（含焦点栏 d=0） | 240 | `--flow-ease-out` | 80+d×90 |
| | 流带 | 360 | `--flow-ease-out` | 栏延迟 +60 |
| | 行内动作行 | 220 | — | 320 |
| 导航 | 常驻栏 / 行 / 流带 / 世界平移 | 360 | `--flow-ease` | 0 |
| | 离开的栏 | 120 淡出 + 160 位移 ±12，160 卸载 | `(.4,0,1,1)` | 0 |
| | 新栏 | 240 | `--flow-ease-out` | 120+(d−1)×60 |
| | 新流带 / 消失流带 | 360 展开 / 120 淡出 | `--flow-ease-out` / `(.4,0,1,1)` | 新栏延迟+60 / 0 |
| 退场 | 栏 | 160 淡出 | `(.4,0,1,1)` | (maxD−d)×40，封顶 160 |
| | 流带 | 120 淡出 | 同上 | 0 |
| | 背景 | 200 淡出 | 同上 | 120 + 栏错开的一半 |
| | `onExited` | — | — | 340 + 栏错开 |
| 工具带 | 阅读工具淡出 / 全景工具淡入 | 120 / 160 | — | 0 / 60 |
| 左上按钮 | 文字换态 | 160（opacity + 3px） | `--flow-ease` | 0 |
| 减弱动效 | 一切 | 仅 120 透明度；无 FLIP、无错开、无位移 | linear | 0 |

---

## 16. 性能约束

- 全景只渲染「路径各栏 + 焦点子栏」，通常 ≤ 6 栏、≤ 300 行；成员 > 120 的栏强制「并列」紧凑版式。
- `UpperGen` 已 `memo`；每栏 `FlowScene` 必须引用稳定（`useMemo` 依赖只放该栏的 layout / strands / hoverId / motion / openBase / keepIds）。
- 悬停只改 `hoverId` → 只重算流带 tone 与该栏 strands；不要因悬停重算 `buildAtlasColumns`。
- 流式生成：布局输入节流 250ms（§6.3）。
- 不监听正文滚动、不碰内核几何（全景期间正文被盖住）。

---

## 17. 测试

### 17.1 `tests/atlas.layout.test.cjs`（纯函数；写法照 `tests/flow.layout.test.cjs`：`require("./lib/tsload.cjs")` 后直接 require TS）

夹具：用 `createGraph` 造一张图——顶层 4 个节点（`a b c d`），`b` 下 5 个（`b1..b5`，其中 `b3` 类型「论点」、`b4` 类型「例证」并有 `例` 边指向 `b3`），`b3` 下 3 个（`b3x b3y b3z`，`b3y` 的 `blockStart/End` 跨度是其它的 3 倍），`d` 无子、`state: "more"`；另造 130 个子节点的 `c`。颜色用 `StructureFlowHost` 的 `FALLBACK_COLORS` 同值的字面量对象（测试文件不受颜色规则约束）。

断言（每条一个 `check`）：
1. `atlasChain(g, ROOT_ID)` = `[ROOT_ID]`；`atlasChain(g, "b3y")` = `[ROOT_ID, "b", "b3", "b3y"]`；孤儿节点 → `[ROOT_ID]`。
2. 焦点 `b3`：栏 key 依次 `col:^`、`col:@root`、`col:b`、`col:b3`；`activeId` 依次 `@root`、`b`、`b3`、`null`。
3. 焦点 `d`（无子、more）：末栏 `empty === "more"`、`members.length === 0`。
4. 焦点 `c1`（c 有 130 子）：`col:c` 的 `pattern === "grid"`。
5. `col:b` 若版式为 argument：其 `layout.items` 中不存在 `id === "n:b"`（不重复根论点）。
6. `placeColumns`（stage 1200×700）：焦点栏 `|x + w/2 − 600| ≤ 1`；每个有 activeId 的栏，其活动行中心 `|y + a.y + a.h/2 − yc| ≤ 1`；相邻栏 `x[j+1] − x[j] === width[j] + 96`；+1 栏若 `height ≤ 636` 则 `y ≥ 32 且 y + height ≤ 668`。
7. `buildAtlasLinks`：每对相邻栏的链接数＝右栏 ports 数；同一源的切片首尾相接（`s1[i] === s0[i+1]`）且全部落在源行 `[top, bot]` 内；`b3y` 的切片厚度 ≈ 其它的 3 倍（±0.6）；`t0/t1` 等于对应 port + 栏 y；id 唯一；按 tone 升序。
8. `atlasLinkPath(l)` 与 `atlasLinkPath(collapseLink(l))` 去掉数字后的命令字母序列完全相同（CSS `d` 可插值）。
9. `atlasLinkStops`：4 个 stop，offset 单调不减，最后一个 opacity === `colors.aEnd[tone]`。
10. `displaceLayout`：快照中 `n:b3` 的矩形 → 返回布局里该 item 的 x/y ＝ 快照 − origin − 栏位置；`keep` 含 `n:b3` 与 `bar:b3`；未命中的 item 原样（引用相等）；`matchAll=false` 时快照里的 `head` 不被匹配。
11. `normalizeSnapshot`：`n:<rootReal>` → `n:@root`，`cut` / `readingId` 同步映射。
12. `clampPan`：极大的 pan 被夹回，内容至少 120px 留在视口内。

### 17.2 `tests/atlas.dom.test.cjs`（jsdom；脚手架照抄 `tests/m15v2.tab.dom.test.cjs` 的 1–150 行：真实引擎 + 内存 store + 假流式模型 + 假内核）

宿主：两个 div（`#toolbar`、`#stage`，stage 的 `getBoundingClientRect` 返回 1100×640），挂 `<MindmapTab open entry={{seq:1, origin:"button", nodeId:null, snapshot:null}} stageHost toolbarHost …/>`。

断言：
1. 工具栏宿主里有 `.atlas-crumbs`、`[data-atlas-search]`、`[data-atlas-menu="gen"]` 的按钮、版本 / 视图菜单按钮、`.atlas-zoom`、`[data-atlas-center]`；页面里**不存在** `.mindmap-sidebar`、`.mm2-canvas`。
2. 目录预览：舞台出现 ≥ 2 个 `.atlas-col`；`col:^` 里有材料名；面包屑首项为材料名并带「目录预览」chip。
3. 「生成导图」主按钮可点 → 生成中状态区出现「框架 n/m 段」、出现「停止」；首个 AI 节点在第一次流结束前出现在某个 `.atlas-col .flow-item`。
4. 完成后菜单里出现「重新生成」。
5. 点 `col:@root` 里第 2 个 `.flow-item[data-kind="node"]` → 面包屑末项变为其标题、该行 `data-selected="1"`、出现新栏 `col:<该id>`（若有子）、`.atlas-link` 数量 > 0。
6. 焦点行下方 `[data-atlas-inline]` 存在，含「跳到原文」「讲解」「详情」；点「讲解」→ 讲解文字流式出现；点「详情」→ `.atlas-detail` 出现。
7. 搜索：输入某个标题前缀 → `.atlas-search-menu .dd-item` ≥ 1 → 点第一条 → 焦点切过去。
8. 键盘：舞台聚焦后按 ↓ → 焦点变成下一个兄弟；按 ← → 焦点变为父。
9. Esc（焦点在舞台）→ `onExit` 被调用 1 次；搜索框内 Esc 不调用 `onExit`。
10. 重新渲染 `open={false}` → 600ms 内 `onExited` 被调用。
11. 交接：重新挂载，`entry.snapshot` 给一个手造快照（`items` 含 `n:<某顶层节点>` 的矩形 `{left: 900, top: 300, …}`，`cut: "@root"`）、`nodeId` 为该节点 → 首次渲染后立即读该行 `.flow-item` 的 `style.transform`，其 translate 值＝ `900 − stageLeft − colX`, `300 − stageTop − colY`；等 3 帧后 transform 等于真实布局坐标。
12. 「就此制卡」：点行内「制卡」→ 回调收到 `nodeId` 以 `v2:` 开头、`section` 含「【结构语义包】」。
13. 全程 `console.error` 0 条。

### 17.3 `tests/m15v2.tab.dom.test.cjs`

该文件断言的是旧侧栏面板与 SVG 画布，改版后整体失效。处理：**改写为 17.2 的 3–4、6、12 条**（生成 / 流式 / 讲解 / 制卡）＋ 原「点＋深挖」改为「焦点 `state:"more"` 节点 → 行内『深挖』→ 子节点出现在 +1 栏」；原「跳过来后选中被指定的节点 / flashRect / focusRequest 回执」三条删除（功能已由交接取代，见 17.2-11）；原「拖动平移内容层不重建」改为「拖动舞台空白处 → `.atlas-world` 的 transform 改变、`.atlas-col` 元素引用不变」。

### 17.4 `tests/flow.dom.test.cjs` 追加

1. 动作行文案为「在结构全景中查看」。
2. 打开随文结构 → `captureFlowSnapshot(document)` 非空，`items` 含当前组每个成员的 `n:` 行。
3. 重新渲染宿主 `covered coverMode="handoff"` → 下一帧 `.flow-layer` 已不在 DOM（无 480ms 关闭编排）；280ms 后平移目标 `style.transform` 归零。
4. `coverMode` 缺省时行为不变（原有断言全部仍通过）。

### 17.5 必跑

`npm run typecheck` 0 错；`npm run i18n:check` ✓；`node scripts/consistency-check.mjs` ✓（棘轮不回退）；`node scripts/run-tests.mjs atlas` / `flow` / `m15v2` 全绿；`npm run build` ✓。GUI 测试（`*.gui.mjs`，如 `d139-sidebar-band.gui.mjs` 测侧栏页签行几何）沙箱跑不了——若其中写死了「三个页签」或 `padding-left: 64px`，按本文更新期望值并在报告里注明「未实跑」。

---

## 18. 实施阶段（严格按顺序，每阶段结束跑对应测试）

1. **纯模块**：`atlas.ts` + `types.ts` 两字段 → `tests/atlas.layout.test.cjs` 全绿。
2. **渲染器**：`FlowLayer.tsx` §5.2 七处改动 → `flow.dom` / `flow.patterns` 原有断言全绿（行为不变）。
3. **舞台 + 行内块 + 工具栏 + MindmapTab 改写** → `tests/atlas.dom.test.cjs` 1–10、12、13 绿。
4. **交接**：`handoff.ts` + `StructureFlowHost` §10.3 + 舞台交接编排 → 17.2-11、17.4 绿。
5. **Reader / 侧栏 / CSS / i18n** → typecheck、i18n、consistency、build 绿。
6. **m15v2.tab.dom 改写**、文档登记（§19）。

---

## 19. 文档登记（`AI_DEVELOPMENT_GUIDE.md`）

- 版本条目（照 L214 v49.85 条目格式）：**v49.87 / D254 结构全景**：完整图谱由侧栏「图谱」页签 + 卡片画布改为「结构全景」——横向分栏 Sankey（每栏复用随文结构 `layoutFor` / `UpperGen`，栏间流带由焦点路径行流向子节点）、焦点居中 + 路径脊线、导航 360ms 统一时钟；随文结构「在结构全景中查看」以快照 + 克隆层做共享元素交接（FLIP 420ms）；入口移到阅读界面左上「结构全景 / 返回阅读」独立按钮，图谱页签移出侧栏，原面板拆进工具带（面包屑 / 状态 / 搜索 / 生成 / 版本 / 视图 / 缩放 / 居中），节点详情改为焦点行内块；右侧「结构图」改名「随文结构」。契约见 `docs/design/STRUCTURE-ATLAS-D254.md`。无 schema / IPC / 设置键 / 埋点事件变更（复用 `mindmap.viewed`、`reader.jumped`）。
- 决策表（L1790 附近）加 `| D254 | … | ✅ v49.87 实现（测试读数…） |` 行。
- §4.19（材料导图）里「图谱页签＝侧栏」的描述改为指向本文；`MINDMAP-SIDEBAR-TAB.md` 文件头加一行「已被 D254 取代」。

---

## 20. 易错点（逐条核对）

1. **快照必须在任何 `setState` 之前同步拍**（`openAtlas` 第一行）；拍完再 `playFlowGhost`；否则随文结构已卸载，什么也拍不到。
2. 克隆层**直接挂 body、各自做动画**，不要包容器（会隔离混合层的 `mix-blend-mode`，正文高亮瞬间变色）。
3. FLIP 的「换回真实布局」必须等**两次** `requestAnimationFrame`（一次不够：首帧样式还没提交，CSS 过渡不会触发）。
4. `keepIds` 里的元素首帧**不能**走 enter 透明——否则会在随文结构消失的同一帧闪一下。
5. 全景首帧要有图：靠 §9.4 的 `peekLoad` 缓存；缓存未命中（随文结构没开过）时不会有快照，走按钮编排即可。
6. 材料根 id：随文结构的图**未抬升**（材料根是真实节点），全景**抬升**（`ROOT_ID="@root"`）。快照、`entry.nodeId`、定位结果都要经 `normalizeSnapshot` / `toAtlasId` 映射。
7. 流带渐变必须用 `objectBoundingBox`（几何动画时渐变跟着走）；随文结构那套 `userSpaceOnUse` 在这里会在 360ms 移动期间错位。
8. 所有几何过渡共用 `--flow-t-geo`（全景下 360，交接 420）——栏位置、行位置、竖条、流带 `d`、行内块、世界平移必须同一时长同一曲线，否则流带端点会脱离竖条。
9. 每栏 `FlowScene` 引用要稳定，否则 `UpperGen` 每次悬停都整栏重渲、`usePresence` 反复进出场。
10. 栏的 key 是 `col:${parentId}`；导航时同 key 的栏是"移动"不是"重建"——不要在 key 里拼焦点或版式。
11. 不新增 `!important`、不写内联 `<svg>`、新文件无十六进制颜色、含 Enter 键处理的文件必须 `isImeComposing`。
12. Esc 优先级：输入法组字 > 搜索框 / 菜单（自己收起并 `stopPropagation`）> 全景退出。随文结构宿主的 Esc 监听只在它自己打开时存在，全景期间它已关闭，不会抢。
13. 进入全景**不要**动 `sidebarOpen`；退出全景**不要**手动重开随文结构——`covered` 回落后宿主自己会按 `lensOpen` 重新开场。
14. 左上按钮宽度变量 `--reader-atlas-btn-w` 写在 `.reader-wrap` 上，工具栏与侧栏页签行的左让位都读它；按钮不存在时要移除变量（回落 0）。
15. 「跳到原文」先 `goTo` 再退出全景（跳转发生在背景之下）；同时显示「↩ 回到刚才的位置」——任何从结构界面发起的跳转都必须有回去的路。

---

## 21. 用户实机验收（Windows 应用）

1. 打开一本已生成导图的书，左上出现「展开」「结构全景」两个按钮；点「结构全景」：侧栏不展开，正文被阅读底色盖住，结构全景从正在读的那一节为中心逐栏展开；按钮原地变成「返回阅读」并点亮。
2. 工具带上出现面包屑（全书 › … › 当前节）、搜索、生成、版本、视图、缩放、居中；原阅读工具（翻页、更多等）暂时隐去。
3. 点右侧一栏的任一行：所有栏平滑左移，被点的行到正中，新的子栏从左边淡入、流带"流"出来；点左侧祖先：反向。
4. 关掉全景，打开「随文结构」，单击一个节点 → 动作行「在结构全景中查看」→ 该节点和它的兄弟行**直接从右侧滑到屏幕中央**（中途无闪烁、无重影），随后左右栏展开。
5. 在全景中双击一行 → 回到正文对应位置，工具栏出现「↩ 回到刚才的位置」，点它回原处；随文结构（若之前开着）自动重新出现。
6. 夜间阅读主题下全景为深色、流带颜色与随文结构一致；系统「减少动态效果」打开时只剩淡入淡出。
7. 窗口最窄（1120）与展开侧栏时，焦点栏仍居中、两侧栏渐隐、可拖动平移；Ctrl+滚轮缩放。
