# 结构流（Structure Flow）v3——融进阅读界面的 Sankey 式结构图

> 状态：设计定稿 v3（2026-10-29，用户第三轮意见后重写）。v1（纸片卡 + 覆盖窗口）、v2（骑边 + 延伸层）全部作废。
> 实施者：DeepSeek V4.1 Flash。**严格按 §10 的阶段顺序做；本文的常量、公式、参考代码就是定稿，不要自行"优化"或换算法。**
> 本文没写到的现有代码细节：先 grep 现有实现，照抄它的写法。
> 取代：`MINDMAP-V2-IMPL-PLAN.md` §14（独立结构图窗口）与 D203 / D204（内容自适应纸片窗口）。
> 灵感：pele Sankey（https://pele.run/examples/sankey）——交错缠绕的半透明流带，呼应品牌 Nutation（章动）。
>
> **⚠ v3.1 修订（2026-10-29 第四轮，见文末 §12）覆盖前文的下列内容，冲突处一律以 §12 为准**：
> 节点层级的呈现（§5.5.1 第 4–6 步的缩进 / 脊线 / 类型方框，§7.4 的 `.flow-chip`，§7.5 论证图条目）→ §12.2「泳道 + 跨度条」；
> 对照版式（§5.5.4 整节、§7.5 对照条目）→ §12.3「对照表」；结构随阅读位置切换的判定（§6.1 的 `readingId` 求法、§6.2-7 的 cut）→ §12.4「注意力判定 + 邻组预览」；
> 打开 / 关闭与侧栏的联动、最小宽度 → §12.1。§10 的阶段内容按 §12.6 增补。

---

## 0. 本轮要求 → 定稿

| 用户要求 | 定稿 |
|---|---|
| ① 流带左端不要实色竖线，继续向左延伸成矩形，作为高亮铺在对应文字下面，与流带融为一体 | 删除「源条」与 iframe 内的 CSS Custom Highlight 染底。**每段对应文字的高亮矩形与它的流带是同一个 SVG 路径**：从段落左缘起的圆角矩形，在段落右缘处不断开、直接弯成 Sankey 流带流向节点。这一层用 `mix-blend-mode`（浅色阅读主题 `multiply`、深色 `screen`）叠在正文上，效果与荧光笔高亮相同（字色不变、只染底），而且矩形与流带之间没有任何接缝（§4、§5.6、§7.3）。 |
| ② 取消骑边，不出现新窗口；展示结构图时正文向左让出右侧空间 | 删除延伸层 / 覆盖窗口 / 一切新窗口。优先把正文整体**平移**（`transform`，不重排、不跳动）；左侧空白不够平移时，**预留右侧槽位**（正文重排到较窄宽度，用淡出 → 重排 → 淡入遮住，不硬切）；窗口实在太窄才退成极简态（§2）。 |
| ③ 节点层级看不清，例如论点应高于论据、例证 | 引入**角色层级**（§5.4）：论点 / 结论 / 命题等为一级，理由 / 证据 / 前提等为二级，例证 / 案例为三级，反方观点 / 反驳 / 让步为「反方」。层级同时用**缩进、节点条粗细、字号字重、类型标签**四种方式表达，并按关系边把下级挂到它所支撑的上级下面，用一根细「脊线」串起来（反方用断线 + 截止符号，例证用点线）。论证图里，所属整体（通常就是论点本身）成为顶端的根论点。 |
| ④ 多种图谱形式，各用最合适的表示方式 | 每组的版式沿用现有选择器 `selectPattern`（手动 > 模型提示 > 规则表；已有：大纲树 / 论证图 / 时间线 / 链 / 分层图 / 对照 / 网格），结构流为每种版式设计专门的竖向表现（§5.5）：**时间线**＝按真实年代比例排布的竖向时间轴（流带汇聚成光点、阅读位置有游标沿时间轴移动）；**链**＝编号步骤 + 箭头；**分层图**＝因果瀑布；**对照**＝并排的对照栏 + 「总线」引线；**论证图**＝根论点 + 脊线；**大纲树 / 网格**＝基础 Sankey 列。所有版式共用同一套流带、动效与交互。 |

**AI 输出不需要调整**：版式提示 `{版式}`（`patternHint`）、时间元信息 `〈时间〉`（`timeText`）、节点类型、八类关系码、块范围都已在现有输出里；提示词、解析器、`OUTLINE_VERSION`、缓存键、`material_map_*` 表一律不动。时间的比例排布由界面解析 `timeText`（§5.5.3），解析不出就均匀排布，不要求模型改格式。

**不用 Three.js / 3D**（理由同前：透视影响标题可读性、WebGL 体积与掉帧风险）。立体感靠层次：高亮流带在最下层（与正文混合），脊线 / 时间轴 / 节点条在上层，焦点流带更浓。

---

## 1. 形态

```
┌──────┬─────────────────────────────────────────────────────────────────┐
│ 侧栏 │   正文（整体左移，或重排到较窄宽度）           节点列（页边内）    │
│      │                                                                 │
│      │  ╭──────────────────────────────╮╲                第二章 · 论证图 │
│      │  │ 段落A（玫色高亮，字在其上）  │ ╲════════╗   ▌█ 动物化的后现代 [论点]│
│      │  ╰──────────────────────────────╯     ╲    ║   ├─▌ 数据库消费 [理由]   │
│      │  ╭──────────────────────────────╮═══════╲══╬═══┼─▌ 大叙事凋零 [证据]   │
│      │  │ 段落B（主题色高亮）          │════════╲═╝   ┊ ▏ 御宅族的例子 [例证] │
│      │  ╰──────────────────────────────╯  (驳)  ╲    ╞⊣▌ 但有人认为… [反方]  │
│      │                                                 下方另 2 项          │
└──────┴─────────────────────────────────────────────────────────────────┘
  ╭─╮ 高亮矩形：与右侧流带是同一个形状，矩形右缘不断开地弯成流带
  ▌ 节点条（粗细随层级）  ├ ┊ ╞⊣ 脊线：实线＝支撑，点线＝例证，断线 + 截止符号＝反方
```

时间线示意（同一位置、同一套流带）：
```
  ╭──────────────╮╲                     ┆ 1945 年 8 月
  │ 段落（金色） │ ╲════════════════► ● 日本投降
  ╰──────────────╯                    │
  ╭──────────────╮════════════════► ▸● 1949 年  新中国成立      ← ▸ 阅读游标沿轴移动
  ╰──────────────╯                    ┆ //（年代断层）
                                       ● 1978 年  改革开放
```

---

## 2. 排布决策（纯函数 `planColumn`）

| 序 | 方案 | 条件 | 正文 |
|---|---|---|---|
| 1 | `inside` | `viewport.right − textRight ≥ R(LABEL_W)` | 不动 |
| 2 | `shift` | 所需平移 `need ≤ maxShift` | `transform: translateX(−shift)`（420ms 过渡） |
| 3 | `reserve` | `viewportWidth − R(LABEL_W) ≥ TEXT_MIN` | 正文区右侧预留槽位 `R`，正文重排（淡出 → 重排 → 淡入） |
| 4 | `compact` | 同 2 / 3 但标签宽 `LABEL_W_COMPACT` | 同上 |
| 5 | `whisper` | 以上都不行 | 不动；只画高亮 + 节点条，悬停才显示标签 |

`R(lw) = BRAID_PREF + block(lw)`，`block(lw) = BAR_MAX + LABEL_GAP + lw + PAD_R`。
`maxShift = max(0, min(MAX_SHIFT, textLeft − viewport.left − KEEP_LEFT))`。
平移优先于预留（平移不重排，最丝滑）。左侧侧栏开合、窗口缩放都会重新决策；从 `shift` 变到 `reserve`（或反之）走 §8.8 的淡出重排编排。

---

## 3. 文件清单

**新增**
| 文件 | 内容 |
|---|---|
| `src/lib/flow/types.ts` | 场景类型 |
| `src/lib/flow/layout.ts` | 常量、`planColumn`、折行、颜色、层级与挂接、各版式布局、流带、关系线 |
| `src/lib/flow/presence.ts` | `usePresence` 进出场保留 hook |
| `src/components/reader/flow/useStructureFlow.ts` | 数据 hook（自 `MindmapLens.tsx` 移植） |
| `src/components/reader/flow/FlowLayer.tsx` | 渲染器：混合层 SVG（高亮流带）+ 上层 SVG（脊线 / 轴 / 节点条 / 关系线）+ HTML（标签 / 动作行 / 讲解） |
| `src/components/reader/flow/StructureFlowHost.tsx` | 宿主：取几何、排布、动效编排、平移 / 预留、交互 |
| `tests/flow.layout.test.cjs`、`tests/flow.patterns.test.cjs`、`tests/flow.dom.test.cjs` | 测试 |

**修改**：`src/lib/reader/kernel.ts`、`src/lib/reader/foliate/adapter.ts`、`src/components/Reader.tsx`、`src/theme.css`、en/ja 词典、`docs/AI_DEVELOPMENT_GUIDE.md`、`MINDMAP-V2-IMPL-PLAN.md`（追加 §15 指向本文）。

**退役（阶段 5）**：`electron/lensWindow.js`、`lens.html`、`src/lens.tsx`、`src/lib/lensBridge.ts`、`src/lib/lensWindowFit.ts`（及 `electron/lensWindowFit.bundle.cjs` 与其构建脚本项）、`src/components/reader/MindmapLens.tsx`、相关测试、`theme.css` 里 `.lens-root` / `.mm2-focus*` 样式、preload 的 `lensAPI`、IPC `win:lens` / `lens:*`、`vite.config.ts` 的 `lens` 入口、`main.js` 里 `lensWindow` 的 require / init / prepareQuit。删前 `grep -rn` 确认无其它引用。**不新增任何 BrowserWindow、preload 桥或 IPC。**

---

## 4. 内核能力（只改 foliate；PDF 不实现＝静默降级）

### 4.1 `kernel.ts`（追加；可选能力）

```ts
/** 结构流：段落定位（只找 Range、不画任何东西） */
export interface ReaderStructureTarget { key: string; nodeId: string; unitAnchor: string; head: string; tail: string }
/** 宿主 client 坐标（与 getSelectionGeometry 同一坐标系），已裁到正文视口 */
export interface ReaderParagraphBox {
  key: string; nodeId: string; block: number;
  top: number; bottom: number; left: number; right: number;
  column: number; clipTop: boolean; clipBottom: boolean;
}
export interface ReaderStructureGeometry {
  seq: number;
  viewport: { left: number; top: number; right: number; bottom: number };
  columns: { left: number; right: number }[];          // 按 left 升序
  boxes: ReaderParagraphBox[];
  text: { left: number; right: number } | null;         // 可见文本版心
}
// ReaderKernel 内追加：
setStructureTargets?(targets: ReaderStructureTarget[]): void;
getStructureGeometry?(): ReaderStructureGeometry | null;
```
现有 `setStructureHighlights` 保持不动（结构流不用它）。

### 4.2 foliate `adapter.ts`

1. **`setStructureTargets(targets)`**：保存到 `structTargets`，对每个已加载文档调 `locateStructForDoc(index)`。在 `paintStructForDoc(index)` 现有的两处调用旁（约 L446 的 `paintAllStruct` 循环、L593 章节加载后）**各加一行** `locateStructForDoc(index)`，保证章节重载后重新定位。
2. **`locateStructForDoc(index)`**（照 `paintStructForDoc` 的找回写法，只存不画）：
   ```ts
   const structRanges = new Map<Document, { key: string; nodeId: string; range: Range }[]>();
   let blockCache = new WeakMap<Range, Element[]>();
   const locateStructForDoc = (index: number) => {
     const doc = docs.get(index); if (!doc) return;
     const list: { key: string; nodeId: string; range: Range }[] = [];
     const mine = structTargets.filter((t) => resolveSectionIndex(t.unitAnchor) === index);
     if (mine.length) {
       const root = (doc.body || doc.documentElement) as Node | null;
       if (root) {
         const idx = buildTextIndex(root);
         for (const t of mine) {
           const span = findFlatSpan(idx, t.head, t.tail);
           const range = span ? spanToRange(doc, idx, span) : null;
           if (range) list.push({ key: t.key, nodeId: t.nodeId, range });
         }
       }
     }
     structRanges.set(doc, list);
     blockCache = new WeakMap();
   };
   ```
3. **`getStructureGeometry()`**：

```ts
const BLOCK_SEL = "p,li,h1,h2,h3,h4,h5,h6,blockquote,dd,dt,td,th,figcaption,pre";
let geoSeq = 0;
const blockIds = new WeakMap<Element, number>(); let blockNext = 1;
function leafBlocks(range: Range): Element[] {
  const hit = blockCache.get(range); if (hit) return hit;
  const c = range.commonAncestorContainer;
  const el = (c.nodeType === 1 ? c : c.parentElement) as Element | null;
  const own = el?.closest?.(BLOCK_SEL);
  const list = own ? [own] : Array.from(el?.querySelectorAll?.(BLOCK_SEL) ?? [])
    .filter((b) => range.intersectsNode(b) && !b.querySelector(BLOCK_SEL));
  blockCache.set(range, list); return list;
}
getStructureGeometry() {
  const vr = hostEl.getBoundingClientRect();  // hostEl＝foliate-view 元素；坐标换算以 getSelectionGeometryFromContents 现有写法为准
  const vp = { left: vr.left, top: vr.top, right: vr.right, bottom: vr.bottom };
  const raw: Omit<ReaderParagraphBox, "column">[] = [];
  let tl = Infinity, tr = -Infinity;
  for (const [, doc] of docs) {
    const fr = doc.defaultView?.frameElement?.getBoundingClientRect(); if (!fr) continue;
    let n = 0;
    for (const b of Array.from(doc.querySelectorAll(BLOCK_SEL))) {
      if (n >= 40) break;
      const r = b.getBoundingClientRect();
      const L = r.left + fr.left, R = r.right + fr.left, cy = (r.top + r.bottom) / 2 + fr.top;
      if ((L + R) / 2 < vp.left || (L + R) / 2 > vp.right || cy < vp.top || cy > vp.bottom || r.width < 40) continue;
      tl = Math.min(tl, L); tr = Math.max(tr, R); n++;
    }
    for (const { key, nodeId, range } of structRanges.get(doc) ?? []) {
      const blocks = leafBlocks(range);
      const rects = blocks.length ? blocks.map((b) => [b, b.getBoundingClientRect()] as const)
                                  : [[null, range.getBoundingClientRect()] as const];
      for (const [b, r] of rects) {
        const L = r.left + fr.left, R = r.right + fr.left, T0 = r.top + fr.top, B0 = r.bottom + fr.top;
        const cx = (L + R) / 2; if (cx < vp.left || cx > vp.right) continue;   // 翻页模式下别的页
        const top = Math.max(T0, vp.top), bottom = Math.min(B0, vp.bottom);
        if (bottom - top < 6) continue;
        let id = 0; if (b) { id = blockIds.get(b) ?? 0; if (!id) { id = blockNext++; blockIds.set(b, id); } }
        raw.push({ key, nodeId, block: id, top, bottom, left: L, right: R, clipTop: T0 < vp.top, clipBottom: B0 > vp.bottom });
      }
    }
  }
  const sorted = raw.slice().sort((a, b) => (a.left + a.right) - (b.left + b.right));
  const cols: { left: number; right: number; cx: number; n: number }[] = [];
  const boxes: ReaderParagraphBox[] = [];
  const thr = (vp.right - vp.left) * 0.2;
  for (const bx of sorted) {
    const cx = (bx.left + bx.right) / 2; let ci = cols.length - 1;
    if (ci < 0 || cx - cols[ci].cx > thr) { cols.push({ left: bx.left, right: bx.right, cx, n: 1 }); ci = cols.length - 1; }
    else { const c = cols[ci]; c.left = Math.min(c.left, bx.left); c.right = Math.max(c.right, bx.right); c.cx = (c.cx * c.n + cx) / (c.n + 1); c.n++; }
    boxes.push({ ...bx, column: ci });
  }
  return { seq: ++geoSeq, viewport: vp, columns: cols.map(({ left, right }) => ({ left, right })), boxes,
           text: Number.isFinite(tl) ? { left: tl, right: tr } : null };
}
```

---

## 5. 纯模块 `src/lib/flow/`

### 5.1 常量（`layout.ts` 顶部导出）

```ts
export const FLOW = {
  LABEL_W: 248, LABEL_W_COMPACT: 176,
  BAR_MAX: 10, LABEL_GAP: 16, PAD_R: 20, INDENT: 0,   // v3.1：标签不再缩进（INDENT 恒 0）；LABEL_GAP 16 给 4 条泳道留位（§12.2）
  BRAID_MIN: 64, BRAID_PREF: 96, BRAID_MAX: 160,
  MAX_SHIFT: 200, KEEP_LEFT: 40, SHIFT_STEP: 8, SHIFT_HYST: 16, TEXT_MIN: 480,
  HL_PAD_X: 6, HL_PAD_Y: 2, HL_R: 3, HL_MERGE_GAP: 28,
  HEADER_FS: 11, HEADER_LH: 16, HEADER_GAP: 10, BACK_H: 22,
  ROW_PAD_Y: 4, ROW_GAP: 6, MORE_H: 20, META_W: 44,
  MAX_MEMBERS: 9, MIN_MEMBERS: 3, MAX_KIDS: 7,
  ACTIONS_H: 26, EXPLAIN_MAX_H: 168,
  STRETCH_MAX: 1.8, MIN_SLICE: 2, MAX_STRANDS: 12, STUB_ROWS: 4,
  COL_MARGIN_Y: 16,
  TL_DOT_R: 5, TL_DOT_R_READING: 6.5, TL_TIME_FS: 11, TL_TIME_LH: 15, TL_BREAK_K: 4,
  CH_R: 9,
  CMP_MAX: 3, CMP_GAP: 10, CMP_KIDS: 5,
  TURN_RESAMPLE_MS: 220, POLL_PAGED_MS: 200, TRACK_IDLE_MS: 160, RESIZE_IDLE_MS: 200, RELAYOUT_WAIT_MS: 280,
} as const;
```

### 5.2 类型（`types.ts`）

```ts
export type FlowMode = "off" | "inside" | "shift" | "reserve" | "compact" | "whisper";
export type FlowPattern = "tree" | "grid" | "argument" | "timeline" | "chain" | "layered" | "compare";
export type FlowMotion = "open" | "close" | "steady" | "turn" | "track" | "regroup-down" | "regroup-up" | "split" | "merge";
export interface FlowEnv {
  on: boolean;
  viewport: { left: number; top: number; right: number; bottom: number };   // .reader-engine-viewport（含已预留的槽位）
  textLeft: number; textRight: number;                                     // 未平移、未预留时的文本版心
}
export interface FlowPlan {
  mode: FlowMode; shift: number; reserve: number;
  barX: number; labelX: number; labelW: number; right: number;
}
export interface FlowColors {
  dark: boolean; bg: string; fg: string; accent: string; accentOn: string; hairline: string; counter: string;
  palette: string[];                                   // 8 个实色
  aHL: [number, number, number]; aEnd: [number, number, number];   // 档位 base / focus / hover
  aDim: number; strandA: number;
}
/** HTML 标签项 */
export interface FlowItem {
  id: string; nodeId: string | null;
  kind: "head" | "node" | "more" | "kid";
  x: number; y: number; w: number; h: number;
  lines: string[]; fs: number; lh: number; weight: number; tone: number;   // tone＝前景不透明度 %
  chip: { text: string; style: "solid" | "outline" | "counter" } | null;
  meta: string;                                           // 行尾淡色信息（类型名 / +N / 关系计数）
  time: string | null;                                    // 时间线：标题上方的时间
  num: number | null;                                     // 链：步骤号（圆内数字由 prim 画，这里只给读屏）
  reading: boolean; selected: boolean; hasKids: boolean; expanded: boolean;
  moreKind?: "above" | "below" | "kids"; moreCount?: number;
}
/** 流带落点（朝左的竖线段） */
export interface FlowPort { nodeId: string; x: number; y0: number; y1: number; color: string }
/** 上层 SVG 图元（全部由版式布局产出，渲染器只管画） */
export type FlowPrim =
  | { k: "path"; id: string; d: string; stroke: string; strokeW: number; dash?: string; opacity?: number;
      grad?: { from: string; to: string; x1: number; y1: number; x2: number; y2: number }; draw?: boolean;
      endMark?: "arrow" | "bar" | "open" | "dot"; startMark?: "dot"; layer: "under" | "over" }
  | { k: "rect"; id: string; x: number; y: number; w: number; h: number; rx?: number; fill: string; opacity?: number; hatch?: boolean; layer: "under" | "over" }
  | { k: "circle"; id: string; cx: number; cy: number; r: number; fill: string; stroke?: string; strokeW?: number; opacity?: number; layer: "under" | "over" }
  | { k: "text"; id: string; x: number; y: number; text: string; fs: number; fill: string; weight?: number; anchor?: "start" | "middle" | "end"; layer: "under" | "over" };
/** 高亮流带：左段＝文字高亮矩形，右段＝Sankey 流带，同一个路径 */
export interface FlowShape {
  id: string; nodeId: string; color: string;
  L: number; xs: number; s0: number; s1: number; x1: number; t0: number; t1: number;
  tone: 0 | 1 | 2; stub: "" | "above" | "below"; ribbon: boolean; order: number;
}
export interface FlowStrand { id: string; from: string; to: string; code: string; xa: number; ya: number; xb: number; yb: number; bulge: number; colorA: string; colorB: string; strong: boolean; reverse: boolean; order: number }
export interface PatternLayout {
  items: FlowItem[]; ports: FlowPort[]; prims: FlowPrim[];
  expressed: string[];      // 已被版式本身表达的关系（"from>to>code"），不再画关系线
  leafIds: string[];        // 要高亮 / 出流带的节点
  height: number;           // 局部坐标总高（自 0 起）
  readingY: number | null;  // 阅读节点中心的局部 y（对齐用）
  noStrands?: boolean;
}
export interface FlowScene {
  seq: number; mode: FlowMode; motion: FlowMotion; tracking: boolean;
  plan: FlowPlan; viewport: FlowEnv["viewport"]; colors: FlowColors;
  pattern: FlowPattern; patternName: string; dy: number;        // dy＝局部 → client 的竖向偏移
  layout: PatternLayout; shapes: FlowShape[]; strands: FlowStrand[];
  hlX0: number; hlX1: number;                                   // 渐变横向基准（§7.3）
  inline: { forId: string | null; explainOpen: boolean; explainText: string; explainBusy: boolean; status: string };
  hoverId: string | null; focusId: string | null; canBack: boolean;
  panel: { kind: "ok" | "empty" | "feeding" | "nokey" | "busy"; feedDone: number; feedTotal: number };
}
```

### 5.3 基础函数（照抄；`childrenOf` 来自 `../mindmap/v2/graph`，`ROOT_ID` / `GraphState` 来自 `../mindmap/v2/types`，`ReaderStructureGeometry` / `ReaderParagraphBox` 来自 `../reader/kernel`）

```ts
// ---------- 排布决策 ----------
const ceilTo = (v: number, step: number) => Math.ceil(v / step) * step;
export const blockW = (lw: number) => FLOW.BAR_MAX + FLOW.LABEL_GAP + lw + FLOW.PAD_R;
export const reserveW = (lw: number) => FLOW.BRAID_PREF + blockW(lw);
export function planColumn(env: FlowEnv, prev: FlowPlan | null): FlowPlan {
  const off: FlowPlan = { mode: "off", shift: 0, reserve: 0, barX: 0, labelX: 0, labelW: 0, right: 0 };
  if (!env.on) return off;
  const vp = env.viewport, vw = vp.right - vp.left;
  const maxShift = Math.max(0, Math.min(FLOW.MAX_SHIFT, env.textLeft - vp.left - FLOW.KEEP_LEFT));
  const make = (mode: FlowMode, shift: number, reserve: number, lw: number): FlowPlan => {
    const right = vp.right;                                             // 槽位在视口内：列右缘始终＝视口右缘
    const barX = Math.round(Math.min(env.textRight - shift + FLOW.BRAID_PREF, right - blockW(lw)));
    const labelX = barX + FLOW.BAR_MAX + FLOW.LABEL_GAP;
    return { mode, shift, reserve, barX, labelX, labelW: lw, right: labelX + lw + FLOW.PAD_R };
  };
  const tryLw = (lw: number, tag: FlowMode): FlowPlan | null => {
    const room = vp.right - env.textRight;
    const need = FLOW.BRAID_MIN + blockW(lw) - room;
    if (need <= 0) return make(tag === "compact" ? "compact" : "inside", 0, 0, lw);
    let s = ceilTo(need, FLOW.SHIFT_STEP);
    if (prev && prev.reserve === 0 && prev.shift >= s && prev.shift - s < FLOW.SHIFT_HYST) s = prev.shift;
    if (s <= maxShift) return make(tag === "compact" ? "compact" : "shift", s, 0, lw);
    if (vw - reserveW(lw) >= FLOW.TEXT_MIN) {
      const p = make(tag === "compact" ? "compact" : "reserve", 0, reserveW(lw), lw);
      // 预留后正文在剩余宽度内重排居中：宿主重排完成后会以新的 textRight 再算一次（此时 room 足够 → inside/compact 且 reserve 保持）
      return p;
    }
    return null;
  };
  const p = tryLw(FLOW.LABEL_W, "inside") ?? tryLw(FLOW.LABEL_W_COMPACT, "compact");
  if (p) return p;
  const barX = Math.round(Math.min(env.textRight + 16, vp.right - 24));
  return { mode: "whisper", shift: 0, reserve: 0, barX, labelX: barX + FLOW.BAR_MAX + 6, labelW: 0, right: barX + FLOW.BAR_MAX };
}
```
**预留的保持规则（宿主执行）**：一旦进入 `reserve`，重排后 `env.viewport` 不变、`textRight` 变小，`planColumn` 会返回 `inside`（reserve=0）——宿主必须在「当前已预留」时把 `reserve` 维持为当前值，直到 `planColumn` 在**假设不预留**（用预留前记下的 `textLeft/textRight`）的环境下返回 `inside` 或 `shift`，才撤销预留。实现：宿主保存 `baseText = {left,right}`（未预留时的版心），每次决策都用 `baseText` 调 `planColumn`；结果若为 `reserve`，列的 `barX` 再用**重排后的实际 textRight** 修正：`barX = min(actualTextRight + BRAID_PREF, viewport.right − blockW(lw))`。

```ts
// ---------- 文字折行（CJK＝1em，空格＝0.3em，其余＝0.56em） ----------
const WIDE_RANGES: [number, number][] = [[0x2e80, 0x9fff], [0x3000, 0x303f], [0xac00, 0xd7af], [0xf900, 0xfaff], [0xff00, 0xffef]];
const isWide = (c: string) => { const p = c.codePointAt(0) ?? 0; return WIDE_RANGES.some(([a, b]) => p >= a && p <= b); };
export const charW = (c: string, fs: number) => (isWide(c) ? fs : c === " " ? fs * 0.3 : fs * 0.56);
const widthOf = (cs: string[], fs: number) => cs.reduce((a, c) => a + charW(c, fs), 0);
export function wrapLabel(text: string, fs: number, maxW: number, maxLines: number): string[] {
  const chars = Array.from(String(text || "").replace(/\s+/g, " ").trim());
  const lines: string[] = [];
  let i = 0;
  while (i < chars.length && lines.length < maxLines) {
    let w = 0, j = i, lastSpace = -1;
    while (j < chars.length && w + charW(chars[j], fs) <= maxW) { if (chars[j] === " ") lastSpace = j; w += charW(chars[j], fs); j++; }
    if (j < chars.length && lastSpace > i && chars[j] !== " " && !isWide(chars[j]) && !isWide(chars[j - 1])) j = lastSpace;
    if (j === i) j = i + 1;
    lines.push(chars.slice(i, j).join("").trim());
    i = j; while (chars[i] === " ") i++;
  }
  if (i < chars.length && lines.length) {
    const last = Array.from(lines[lines.length - 1]);
    while (last.length && widthOf(last, fs) + fs > maxW) last.pop();
    lines[lines.length - 1] = last.join("") + "…";
  }
  return lines.length ? lines : [""];
}
export const textW = (s: string, fs: number) => widthOf(Array.from(s), fs);
```

### 5.4 角色层级与挂接

```ts
export type Tier = 0 | 1 | 2 | "counter";
const TIER: Record<string, Tier> = {
  论点: 0, 结论: 0, 命题: 0, 问题: 0, 方案: 0, 总结: 0,
  理由: 1, 证据: 1, 前提: 1, 定义: 1, 引理: 1, 推导: 1, 因果: 1, 背景: 1, 引言: 1, 分类: 1, 对比: 1, 步骤: 1, 分情形: 1, 叙事: 1, 其他: 1,
  例证: 2, 案例: 2,
  反方观点: "counter", 反驳: "counter", 让步: "counter",
};
export const tierOf = (type: string): Tier => TIER[type] ?? 1;
const rank = (t: Tier) => (t === "counter" ? 1 : t);
export interface TierStyle { bar: number; fs: number; lh: number; weight: number; tone: number }
export const TIER_STYLE: Record<"0" | "1" | "2" | "counter" | "compact", TierStyle> = {
  "0":       { bar: 10, fs: 14, lh: 19, weight: 600, tone: 96 },
  "1":       { bar: 6,  fs: 13, lh: 18, weight: 450, tone: 86 },
  "2":       { bar: 4,  fs: 12, lh: 17, weight: 400, tone: 72 },
  counter:   { bar: 6,  fs: 13, lh: 18, weight: 450, tone: 86 },
  compact:   { bar: 4,  fs: 12, lh: 17, weight: 420, tone: 84 },
};
export const styleOf = (type: string): TierStyle => TIER_STYLE[String(tierOf(type)) as "0" | "1" | "2" | "counter"];

/** 把下级挂到它支撑的上级下面（只在本组成员之间）；返回 parent 与 depth（≤2） */
const NEST_OUT = new Set(["支", "例", "因", "答", "驳"]);   // 本节点 —码→ 目标：本节点是目标的下级
export function semanticNest(g: GraphState, members: string[]): Map<string, { parent: string | null; depth: number; rel: "support" | "example" | "counter" | null }> {
  const set = new Set(members), pos = new Map(members.map((id, i) => [id, i] as const));
  const t = (id: string) => tierOf(String(g.nodes[id]?.type ?? ""));
  const parent = new Map<string, string | null>();
  for (const id of members) {
    const ti = t(id);
    if (ti === 0) { parent.set(id, null); continue; }
    const cands: string[] = [];
    for (const e of g.outEdges[id] ?? []) if (NEST_OUT.has(e.code) && set.has(e.to) && rank(t(e.to)) < rank(ti)) cands.push(e.to);
    for (const e of g.inEdges[id] ?? []) if (e.code === "据" && set.has(e.from) && rank(t(e.from)) < rank(ti)) cands.push(e.from); // 上级 —据→ 本节点
    let p: string | null = null;
    if (cands.length) p = cands.sort((a, b) => Math.abs(pos.get(a)! - pos.get(id)!) - Math.abs(pos.get(b)! - pos.get(id)!))[0];
    else for (let i = pos.get(id)! - 1; i >= 0; i--) if (rank(t(members[i])) < rank(ti)) { p = members[i]; break; }
    parent.set(id, p);
  }
  // 环保护 + 深度
  const out = new Map<string, { parent: string | null; depth: number; rel: "support" | "example" | "counter" | null }>();
  for (const id of members) {
    let d = 0, cur = parent.get(id) ?? null; const seen = new Set([id]);
    while (cur && !seen.has(cur) && d < 3) { seen.add(cur); d++; cur = parent.get(cur) ?? null; }
    const ti = t(id);
    const p = d > 2 || (cur && seen.has(cur)) ? null : parent.get(id) ?? null;
    out.set(id, { parent: p, depth: p ? Math.min(2, d) : 0, rel: !p ? null : ti === "counter" ? "counter" : ti === 2 ? "example" : "support" });
  }
  return out;
}
/** 深度优先、兄弟保持原文顺序 */
export function nestOrder(members: string[], nest: ReturnType<typeof semanticNest>): string[] {
  const kids = new Map<string | null, string[]>();
  for (const id of members) { const p = nest.get(id)?.parent ?? null; const l = kids.get(p) ?? []; l.push(id); kids.set(p, l); }
  const out: string[] = [];
  const walk = (p: string | null) => { for (const id of kids.get(p) ?? []) { out.push(id); walk(id); } };
  walk(null);
  for (const id of members) if (!out.includes(id)) out.push(id);
  return out;
}
```

### 5.5 版式布局

#### 5.5.0 公共

```ts
export interface LayoutCtx {
  g: GraphState; plan: FlowPlan; colors: FlowColors; pattern: FlowPattern;
  cut: string; header: string; patternName: string;
  members: string[]; colorOf: Map<string, string>;   // 成员色（按完整成员表下标取色板，窗口滑动时颜色不变；阅读节点＝accent）
  moreAbove: number; moreBelow: number;
  readingId: string | null; readingBlock: number | null;
  selectedId: string | null; expandedId: string | null;
  inlineH: number;                                   // 选中项下方动作行高度（选中项在本版式中时插入；子项 / 对照单元格被选也一样要让位）
  maxLines0: 1 | 2; canBack: boolean;
  availH: number;                                    // 列可用高度（时间线比例排布要用）
}
const newLayout = (): PatternLayout => ({ items: [], ports: [], prims: [], expressed: [], leafIds: [], height: 0, readingY: null });
const nodeOf = (c: LayoutCtx, id: string) => c.g.nodes[id];
const kidsOf = (c: LayoutCtx, id: string) => childrenOf(c.g, id).filter((k) => c.g.nodes[k]);
const edgeKey = (from: string, to: string, code: string) => `${from}>${to}>${code}`;
export const kidColor = (parent: string, bg: string, j: number) => `color-mix(in oklab, ${parent}, ${bg} ${[0, 22, 40][j % 3]}%)`;  // 宿主解析成实色

/** 头部：返回下一行 y */
function pushHeader(c: LayoutCtx, out: PatternLayout, y: number): number {
  if (c.canBack) { out.items.push(item({ id: "back", nodeId: null, kind: "head", x: c.plan.labelX, y, w: c.plan.labelW, h: FLOW.BACK_H, lines: ["↩"], fs: 11, lh: 22, weight: 400, tone: 72 })); y += FLOW.BACK_H; }
  const lines = wrapLabel(c.header, FLOW.HEADER_FS, c.plan.labelW - FLOW.META_W, 2);
  out.items.push(item({ id: "head", nodeId: null, kind: "head", x: c.plan.labelX, y, w: c.plan.labelW, h: lines.length * FLOW.HEADER_LH,
    lines, fs: FLOW.HEADER_FS, lh: FLOW.HEADER_LH, weight: 500, tone: 52, meta: c.patternName }));
  return y + lines.length * FLOW.HEADER_LH + FLOW.HEADER_GAP;
}
function pushMore(c: LayoutCtx, out: PatternLayout, y: number, kind: "above" | "below"): number {
  const n = kind === "above" ? c.moreAbove : c.moreBelow; if (!n) return y;
  out.items.push(item({ id: `more:${kind}`, nodeId: null, kind: "more", x: c.plan.labelX, y, w: c.plan.labelW, h: FLOW.MORE_H,
    lines: [""], fs: 11, lh: FLOW.MORE_H, weight: 400, tone: 48, moreKind: kind, moreCount: n }));
  out.prims.push({ k: "rect", id: `morebar:${kind}`, x: c.plan.barX + 4, y: y + 4, w: 2, h: FLOW.MORE_H - 8, fill: c.colors.hairline, layer: "over" });
  return y + FLOW.MORE_H + FLOW.ROW_GAP;
}
/** 补齐 FlowItem 默认字段 */
function item(p: Partial<FlowItem> & Pick<FlowItem, "id" | "nodeId" | "kind" | "x" | "y" | "w" | "h" | "lines" | "fs" | "lh" | "weight" | "tone">): FlowItem {
  return { chip: null, meta: "", time: null, num: null, reading: false, selected: false, hasKids: false, expanded: false, ...p };
}
/** 行尾 meta：有子未展开→「+N」；否则通往图外的关系「支·2 驳·1」；都没有→类型名 */
function metaOf(c: LayoutCtx, id: string, shown: Set<string>, showType: boolean): string {
  const k = kidsOf(c, id).length;
  if (k && id !== c.expandedId) return `+${k}`;
  const cnt = new Map<string, number>();
  for (const e of c.g.outEdges[id] ?? []) if (!shown.has(e.to)) cnt.set(e.code, (cnt.get(e.code) ?? 0) + 1);
  for (const e of c.g.inEdges[id] ?? []) if (!shown.has(e.from)) cnt.set(e.code, (cnt.get(e.code) ?? 0) + 1);
  const rel = Array.from(cnt).slice(0, 2).map(([code, n]) => `${code}·${n}`).join(" ");
  return rel || (showType ? String(nodeOf(c, id)?.type ?? "") : "");
}
const chipOf = (type: string): FlowItem["chip"] => {
  const t = tierOf(type);
  return { text: type, style: t === "counter" ? "counter" : t === 0 ? "solid" : "outline" };
};
```

#### 5.5.1 大纲树 / 网格 / 论证图 / 分层图（同一个函数 `layoutTree`）

```ts
export function layoutTree(c: LayoutCtx, opt: { compact: boolean; claimRoot: boolean; chips: boolean; spines: boolean; layered: boolean }): PatternLayout {
  const out = newLayout();
  const shown = new Set(c.members);
  // ---- 1. 层级 ----
  let nest = opt.compact ? new Map(c.members.map((id) => [id, { parent: null, depth: 0, rel: null }] as const))
                         : semanticNest(c.g, c.members);
  let order = opt.compact ? c.members.slice() : nestOrder(c.members, nest);
  if (opt.layered) { const L = causalLayers(c.g, c.members); nest = L.nest; order = L.order; }
  const rootClaim = opt.claimRoot && c.cut !== ROOT_ID && !!c.g.nodes[c.cut];
  const base = rootClaim ? 1 : 0;
  // ---- 2. 预排（自然高度） ----
  type Pre = { id: string; kind: "node" | "kid"; depth: number; st: TierStyle; lines: string[]; natural: number; value: number; color: string; parentRow: string | null };
  const pre: Pre[] = [];
  const add = (id: string, kind: "node" | "kid", depth: number, color: string, parentRow: string | null) => {
    const n = nodeOf(c, id);
    const st = opt.compact ? TIER_STYLE.compact : styleOf(String(n.type ?? ""));
    const lw = c.plan.labelW - depth * FLOW.INDENT - FLOW.META_W - (opt.chips ? 0 : 0);
    const maxL = opt.compact || kind === "kid" ? 1 : c.maxLines0;
    const lines = wrapLabel(n.title, st.fs, lw, maxL);
    const chipH = opt.chips ? 16 : 0;
    const v = n.blockStart != null && n.blockEnd != null ? Math.max(1, n.blockEnd - n.blockStart + 1) : 1;
    pre.push({ id, kind, depth, st, lines, natural: chipH + lines.length * st.lh + FLOW.ROW_PAD_Y * 2 + (id === c.selectedId ? c.inlineH : 0), value: v, color, parentRow });
  };
  for (const id of order) {
    const d = base + (nest.get(id)?.depth ?? 0);
    add(id, "node", d, c.colorOf.get(id)!, null);
    if (id === c.expandedId) kidsOf(c, id).slice(0, FLOW.MAX_KIDS).forEach((k, j) => add(k, "kid", d + 1, kidColor(c.colorOf.get(id)!, c.colors.bg, j), id));
  }
  // ---- 3. Sankey 拉伸（只给大纲树 / 网格；论证图与分层图按层级等高） ----
  let k = 0;
  if (!opt.claimRoot && !opt.layered) {
    const base0 = pre.reduce((a, p) => a + p.natural, 0), sumV = pre.reduce((a, p) => a + p.value, 0);
    const target = base0 * FLOW.STRETCH_MAX;
    const total = (kk: number) => pre.reduce((a, p) => a + Math.max(p.natural, p.value * kk), 0);
    let lo = 0, hi = target / Math.max(1, sumV);
    for (let it = 0; it < 24; it++) { const mid = (lo + hi) / 2; if (total(mid) <= target) lo = mid; else hi = mid; }
    k = lo;
  }
  // ---- 4. 落位 ----
  let y = 0;
  const bars = new Map<string, { x: number; y: number; w: number; h: number; color: string }>();
  if (rootClaim) {
    const n = c.g.nodes[c.cut], st = TIER_STYLE["0"];
    const lines = wrapLabel(n.title, st.fs, c.plan.labelW - FLOW.META_W, 2);
    const h = 16 + lines.length * st.lh + FLOW.ROW_PAD_Y * 2;
    if (c.canBack) { out.items.push(item({ id: "back", nodeId: null, kind: "head", x: c.plan.labelX, y, w: c.plan.labelW, h: FLOW.BACK_H, lines: ["↩"], fs: 11, lh: 22, weight: 400, tone: 72 })); y += FLOW.BACK_H; }
    out.items.push(item({ id: `node:${c.cut}`, nodeId: c.cut, kind: "node", x: c.plan.labelX, y, w: c.plan.labelW, h, lines, fs: st.fs, lh: st.lh,
      weight: st.weight, tone: st.tone, chip: chipOf(String(n.type ?? "论点")), meta: c.patternName, selected: c.cut === c.selectedId }));
    out.prims.push({ k: "rect", id: `bar:${c.cut}`, x: c.plan.barX, y: y + 1, w: st.bar, h: h - 2, rx: 1.5, fill: c.colors.accent, layer: "over" });
    bars.set(c.cut, { x: c.plan.barX, y: y + 1, w: st.bar, h: h - 2, color: c.colors.accent });
    y += h + FLOW.ROW_GAP;
  } else y = pushHeader(c, out, y);
  y = pushMore(c, out, y, "above");
  for (const p of pre) {
    const n = nodeOf(c, p.id);
    const h = Math.round(Math.max(p.natural, p.value * k));
    const ix = p.depth * FLOW.INDENT;
    const labelH = h - (p.id === c.selectedId ? c.inlineH : 0);
    const reading = p.id === c.readingId;
    out.items.push(item({ id: `${p.kind}:${p.id}`, nodeId: p.id, kind: p.kind, x: c.plan.labelX + ix, y, w: c.plan.labelW - ix, h: labelH,
      lines: p.lines, fs: p.st.fs, lh: p.st.lh, weight: p.st.weight, tone: p.st.tone,
      chip: opt.chips ? chipOf(String(n.type ?? "")) : null,
      meta: metaOf(c, p.id, shown, !opt.chips), reading, selected: p.id === c.selectedId,
      hasKids: kidsOf(c, p.id).length > 0, expanded: p.id === c.expandedId }));
    const bw = reading ? Math.max(p.st.bar, 8) : p.st.bar;
    const bx = c.plan.barX + ix, by = y + 1, bh = Math.max(2, labelH - 2);
    const counter = tierOf(String(n.type ?? "")) === "counter";
    const expanded = p.id === c.expandedId && kidsOf(c, p.id).length > 0;
    out.prims.push({ k: "rect", id: `bar:${p.id}`, x: bx, y: by, w: expanded ? 3 : bw, h: bh, rx: 1.5, fill: p.color, hatch: counter && !reading, layer: "over" });
    bars.set(p.id, { x: bx, y: by, w: bw, h: bh, color: p.color });
    if (!expanded) { out.ports.push({ nodeId: p.id, x: bx, y0: by, y1: by + bh, color: p.color }); out.leafIds.push(p.id); }
    if (reading) out.readingY = y + labelH / 2;
    y += h + FLOW.ROW_GAP;
  }
  y = pushMore(c, out, y, "below");
  out.height = y - FLOW.ROW_GAP;
  // ---- 5. 展开括弧（结构子节点） ----
  for (const p of pre) if (p.kind === "kid" && p.parentRow && !out.prims.some((x) => x.id === `brk:${p.parentRow}`)) {
    const ks = pre.filter((q) => q.parentRow === p.parentRow).map((q) => bars.get(q.id)!);
    const par = bars.get(p.parentRow)!;
    out.prims.push({ k: "rect", id: `brk:${p.parentRow}`, x: par.x + 4, y: par.y + par.h + 2, w: 2,
      h: ks[ks.length - 1].y + ks[ks.length - 1].h - (par.y + par.h + 2), fill: par.color, opacity: 0.55, layer: "under" });
  }
  // ---- 6. 脊线（论证图 / 大纲树的语义挂接） ----
  if (opt.spines) {
    const parentOf = (id: string) => (nest.get(id)?.parent ?? (rootClaim ? c.cut : null));
    const groups = new Map<string, string[]>();
    for (const id of order) { const pa = parentOf(id); if (pa && bars.has(pa)) { const l = groups.get(pa) ?? []; l.push(id); groups.set(pa, l); } }
    for (const [pa, kids] of groups) {
      const P = bars.get(pa)!;
      const px = P.x + Math.min(P.w, 10) / 2;
      const lastMid = Math.max(...kids.map((id) => bars.get(id)!.y + bars.get(id)!.h / 2));
      const top = pa === c.cut ? (out.items.find((i) => i.id === `node:${c.cut}`)!.y + out.items.find((i) => i.id === `node:${c.cut}`)!.h) : P.y + P.h;
      out.prims.push({ k: "path", id: `sp:${pa}`, d: `M${px},${top} V${lastMid}`, stroke: P.color, strokeW: 1.25, opacity: 0.55, draw: true, layer: "under" });
      for (const id of kids) {
        const B = bars.get(id)!, cy = B.y + B.h / 2;
        const rel = nest.get(id)?.rel ?? "support";
        out.prims.push({ k: "path", id: `tk:${id}`, d: `M${px},${cy} H${B.x - 2}`, stroke: P.color, strokeW: 1.25, opacity: 0.7,
          dash: rel === "counter" ? "3 2" : rel === "example" ? "1.5 2.5" : undefined, draw: rel === "support", layer: "under" });
        if (rel === "counter") out.prims.push({ k: "rect", id: `tkx:${id}`, x: B.x - 4, y: cy - 4, w: 1.5, h: 8, fill: c.colors.counter, layer: "over" });
        for (const e of c.g.outEdges[id] ?? []) if (e.to === pa) out.expressed.push(edgeKey(id, pa, e.code));
        for (const e of c.g.inEdges[id] ?? []) if (e.from === pa) out.expressed.push(edgeKey(pa, id, e.code));
      }
    }
  }
  return out;
}

/** 分层图：沿「推 / 因（from→to）」「据（to→from）」求最长路径层号（≤3），按（层, 原文序）排 */
export function causalLayers(g: GraphState, members: string[]) {
  const set = new Set(members), pos = new Map(members.map((id, i) => [id, i] as const));
  const succ = new Map<string, string[]>(members.map((id) => [id, []]));
  for (const id of members) for (const e of g.outEdges[id] ?? []) {
    if (!set.has(e.to) || e.to === id) continue;
    if (e.code === "推" || e.code === "因") succ.get(id)!.push(e.to);
    else if (e.code === "据") succ.get(e.to)!.push(id);
  }
  const depth = new Map<string, number>(members.map((id) => [id, 0]));
  for (let pass = 0; pass < members.length; pass++) {        // Bellman 式松弛，环自然被 ≤3 截住
    let changed = false;
    for (const a of members) for (const b of succ.get(a)!) {
      const d = Math.min(3, depth.get(a)! + 1);
      if (d > depth.get(b)!) { depth.set(b, d); changed = true; }
    }
    if (!changed) break;
  }
  const order = members.slice().sort((a, b) => depth.get(a)! - depth.get(b)! || pos.get(a)! - pos.get(b)!);
  const nest = new Map(members.map((id) => [id, { parent: null as string | null, depth: depth.get(id)!, rel: null as null }]));
  return { order, nest };
}
```
**调用方式**（`layoutFor`，§5.5.5）：
- `tree` → `layoutTree(c, { compact: false, claimRoot: false, chips: false, spines: true, layered: false })`
- `grid` → `{ compact: true, claimRoot: false, chips: false, spines: false, layered: false }`
- `argument` → `{ compact: false, claimRoot: true, chips: true, spines: true, layered: false }`
- `layered` → `{ compact: false, claimRoot: false, chips: false, spines: false, layered: true }`（因果关系全部交给关系线画，§5.7 关系线在分层图里带箭头且不限于碰焦点者）

（`layoutTree` 里 `bars.set(c.cut, …)` 那一行写法较绕：实现时可直接在推根论点的 rect 时把 `{x, y: y+1, w: 10, h: h-2}` 存入 `bars`，语义相同。）

#### 5.5.2 链（`chain`）

```ts
export function layoutChain(c: LayoutCtx): PatternLayout {
  const out = newLayout(); const shown = new Set(c.members);
  let y = pushHeader(c, out, 0);
  y = pushMore(c, out, y, "above");
  const cx = c.plan.barX + FLOW.CH_R - 2;
  const marks: { id: string; cy: number; color: string }[] = [];
  const start = c.moreAbove;           // 步骤号接续窗口外的序号
  c.members.forEach((id, i) => {
    const n = nodeOf(c, id), st = TIER_STYLE["1"];
    const lines = wrapLabel(n.title, st.fs, c.plan.labelW - FLOW.META_W, c.maxLines0);
    const labelH = Math.max(FLOW.CH_R * 2 + 4, lines.length * st.lh + FLOW.ROW_PAD_Y * 2);
    const h = labelH + (id === c.selectedId ? c.inlineH : 0);
    const color = c.colorOf.get(id)!, reading = id === c.readingId;
    out.items.push(item({ id: `node:${id}`, nodeId: id, kind: "node", x: c.plan.labelX + 4, y, w: c.plan.labelW - 4, h: labelH,
      lines, fs: st.fs, lh: st.lh, weight: reading ? 600 : st.weight, tone: st.tone, num: start + i + 1,
      meta: metaOf(c, id, shown, true), reading, selected: id === c.selectedId, hasKids: kidsOf(c, id).length > 0, expanded: id === c.expandedId }));
    const cy = y + FLOW.ROW_PAD_Y + st.lh / 2;
    out.prims.push({ k: "circle", id: `step:${id}`, cx, cy, r: reading ? FLOW.CH_R + 1 : FLOW.CH_R, fill: color, stroke: c.colors.bg, strokeW: 2, layer: "over" });
    out.prims.push({ k: "text", id: `stepn:${id}`, x: cx, y: cy + 3.8, text: String(start + i + 1), fs: 11, weight: 600, fill: c.colors.bg, anchor: "middle", layer: "over" });
    out.ports.push({ nodeId: id, x: cx - FLOW.CH_R - 1, y0: cy - 7, y1: cy + 7, color });
    out.leafIds.push(id);
    marks.push({ id, cy, color });
    if (reading) out.readingY = cy;
    y += h + FLOW.ROW_GAP;
  });
  for (let i = 0; i + 1 < marks.length; i++) {
    const a = marks[i], b = marks[i + 1];
    out.prims.push({ k: "path", id: `link:${a.id}`, d: `M${cx},${a.cy + FLOW.CH_R + 2} V${b.cy - FLOW.CH_R - 3}`, stroke: a.color, strokeW: 1.5,
      grad: { from: a.color, to: b.color, x1: cx, y1: a.cy, x2: cx, y2: b.cy }, endMark: "arrow", draw: true, layer: "under" });
    for (const e of c.g.outEdges[a.id] ?? []) if (e.to === b.id) out.expressed.push(edgeKey(a.id, b.id, e.code));
  }
  y = pushMore(c, out, y, "below");
  out.height = y - FLOW.ROW_GAP;
  return out;
}
```
展开的步骤：在该步骤标签下方插入子项（复用 `layoutTree` 的 kid 写法：12px 单行，左侧 3px 圆点 `circle r=2.5` 颜色＝`kidColor`，x＝`labelX+4`，各自是 port + leaf；被展开的步骤自己不再是 leaf）。实现时把这段写成小函数 `pushKidList(c, out, parentId, x, y)` 供链 / 时间线共用。**动作行让位（v49.87 / D255）**：父步骤被选 → 动作行排在子项块之后，条目盒高须含子项块（渲染器锚点＝条目底边）；某个子项被选 → 在 `pushKidList` 里给该子项之后加 `inlineH`，父行 `kidsH` 同步加高，否则按钮行会压在下一个子项上。

#### 5.5.3 时间线（`timeline`）

```ts
/** 解析时间文本为「年」（小数年）；失败 null */
export function parseTime(raw: string | null): number | null {
  if (!raw) return null;
  const s = raw.replace(/\s+/g, "");
  const bc = /公元前|前|BC|B\.C\./i.test(s);
  let m = s.match(/(\d{1,2})世纪/);
  if (m) { const v = (Number(m[1]) - 1) * 100 + 50; return bc ? -v : v; }
  m = s.match(/(\d{1,4})年(?:(\d{1,2})月)?/) || s.match(/(\d{3,4})(?:[-./](\d{1,2}))?/);
  if (m) { const v = Number(m[1]) + (m[2] ? (Number(m[2]) - 0.5) / 12 : 0); return bc ? -v : v; }
  return null;
}
const NICE = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
export function layoutTimeline(c: LayoutCtx): PatternLayout {
  const out = newLayout(); const shown = new Set(c.members);
  let y = pushHeader(c, out, 0);
  y = pushMore(c, out, y, "above");
  const ax = c.plan.barX + FLOW.TL_DOT_R;                  // 轴 x
  const st = TIER_STYLE["1"];
  const pre = c.members.map((id) => {
    const n = nodeOf(c, id);
    const lines = wrapLabel(n.title, st.fs, c.plan.labelW - FLOW.META_W, c.maxLines0);
    const hasT = !!(n.timeText && n.timeText.trim());
    const kidsH = id === c.expandedId ? Math.min(FLOW.MAX_KIDS, kidsOf(c, id).length) * 19 : 0;
    const h = (hasT ? FLOW.TL_TIME_LH : 0) + lines.length * st.lh + FLOW.ROW_PAD_Y * 2 + kidsH + (id === c.selectedId || kids.includes(c.selectedId) ? c.inlineH : 0);
    return { id, n, lines, hasT, h, t: parseTime(n.timeText) };
  });
  const parsed = pre.filter((p) => p.t != null);
  const monotone = parsed.every((p, i) => i === 0 || p.t! >= parsed[i - 1].t!);
  const proportional = parsed.length >= Math.max(2, Math.ceil(pre.length * 2 / 3)) && monotone;
  // 比例位置：缺时间的项取前后插值；大断层压缩为 2× 中位间隔并记断层
  const ts = pre.map((p) => p.t);
  for (let i = 0; i < ts.length; i++) if (ts[i] == null) {
    const a = ts.slice(0, i).reverse().find((v) => v != null), b = ts.slice(i + 1).find((v) => v != null);
    ts[i] = a != null && b != null ? (a + b) / 2 : a ?? b ?? 0;
  }
  const gaps = ts.slice(1).map((v, i) => Math.max(0, v! - ts[i]!));
  const med = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)] || 1;
  const breaks = new Set<number>();
  const eff = gaps.map((g, i) => { if (proportional && g > FLOW.TL_BREAK_K * med) { breaks.add(i); return 2 * med; } return g; });
  const span = eff.reduce((a, b) => a + b, 0) || 1;
  // 竖向落位（单调、不重叠、总高 ≤ availH）：y_i = y0 + Σ_{j<i}(h_j + ROW_GAP) + round(frac_i × H_use)
  const sumH = pre.reduce((a, p) => a + p.h, 0);
  const tail = c.moreBelow ? FLOW.MORE_H + FLOW.ROW_GAP : 0;
  const H_free = Math.max(0, c.availH - y - sumH - FLOW.ROW_GAP * Math.max(0, pre.length - 1) - tail);
  const H_use = proportional ? Math.min(H_free, sumH * 1.2) : 0;
  const y0 = y;
  let stack = 0, acc = 0;
  const dots: { id: string; cy: number; color: string }[] = [];
  pre.forEach((p, i) => {
    const yi = y0 + stack + Math.round((acc / span) * H_use);
    stack += p.h + FLOW.ROW_GAP;
    if (i < eff.length) acc += eff[i];
    const color = c.colorOf.get(p.id)!, reading = p.id === c.readingId;
    const cy = yi + FLOW.ROW_PAD_Y + (p.hasT ? FLOW.TL_TIME_LH / 2 : st.lh / 2);
    out.items.push(item({ id: `node:${p.id}`, nodeId: p.id, kind: "node", x: c.plan.labelX, y: yi, w: c.plan.labelW, h: p.h - (p.id === c.selectedId ? c.inlineH : 0),
      lines: p.lines, fs: st.fs, lh: st.lh, weight: reading ? 600 : st.weight, tone: st.tone, time: p.hasT ? p.n.timeText!.trim() : null,
      meta: metaOf(c, p.id, shown, false), reading, selected: p.id === c.selectedId, hasKids: kidsOf(c, p.id).length > 0, expanded: p.id === c.expandedId }));
    const r = reading ? FLOW.TL_DOT_R_READING : FLOW.TL_DOT_R;
    out.prims.push({ k: "circle", id: `dot:${p.id}`, cx: ax, cy, r, fill: color, stroke: c.colors.bg, strokeW: 2, layer: "over" });
    if (reading) out.prims.push({ k: "circle", id: `ring:${p.id}`, cx: ax, cy, r: 10, fill: "none", stroke: c.colors.accent, strokeW: 1.5, opacity: 0.5, layer: "over" });
    out.ports.push({ nodeId: p.id, x: ax - FLOW.TL_DOT_R - 1, y0: cy - 4, y1: cy + 4, color });
    out.leafIds.push(p.id);
    dots.push({ id: p.id, cy, color });
    if (reading) out.readingY = cy;
    y = yi + p.h + FLOW.ROW_GAP;                           // 最后一项之后的 y（给「下方另 N 项」）
  });
  // 轴段（相邻光点之间，颜色渐变；断层段画虚线 + 「//」）
  for (let i = 0; i + 1 < dots.length; i++) {
    const a = dots[i], b = dots[i + 1];
    const brk = breaks.has(i);
    out.prims.push({ k: "path", id: `axis:${a.id}`, d: `M${ax},${a.cy + FLOW.TL_DOT_R + 2} V${b.cy - FLOW.TL_DOT_R - 2}`, stroke: a.color, strokeW: 2, opacity: 0.7,
      grad: { from: a.color, to: b.color, x1: ax, y1: a.cy, x2: ax, y2: b.cy }, dash: brk ? "4 3" : undefined, draw: !brk, layer: "under" });
    if (brk) { const my = (a.cy + b.cy) / 2; out.prims.push({ k: "path", id: `brk:${a.id}`, d: `M${ax - 5},${my + 2} L${ax + 1},${my - 4} M${ax - 1},${my + 4} L${ax + 5},${my - 2}`, stroke: c.colors.fg, strokeW: 1, opacity: 0.45, layer: "over" }); }
  }
  // 刻度（比例模式）：取 NICE 步长使刻度 3–8 个；画在轴左侧 4px 短线
  if (proportional && dots.length >= 2) {
    const t0 = ts[0]!, t1 = ts[ts.length - 1]!, range = Math.max(1e-6, t1 - t0);
    const step = NICE.find((s) => range / s <= 8) ?? 1000;
    for (let v = Math.ceil(t0 / step) * step; v <= t1; v += step) {
      // 找 v 落在哪一段，线性插值 y（跳过断层段）
      for (let i = 0; i + 1 < dots.length; i++) if (!breaks.has(i) && v >= ts[i]! && v <= ts[i + 1]!) {
        const yy = dots[i].cy + ((v - ts[i]!) / Math.max(1e-6, ts[i + 1]! - ts[i]!)) * (dots[i + 1].cy - dots[i].cy);
        out.prims.push({ k: "path", id: `tick:${v}`, d: `M${ax - 9},${Math.round(yy)} H${ax - 5}`, stroke: c.colors.fg, strokeW: 1, opacity: 0.3, layer: "under" });
        break;
      }
    }
  }
  // 阅读游标：阅读块在阅读节点块范围内的比例 → 本光点与下一光点之间
  const ri = dots.findIndex((d) => d.id === c.readingId);
  if (ri >= 0 && c.readingBlock != null) {
    const n = nodeOf(c, dots[ri].id);
    const p = n.blockStart != null && n.blockEnd != null ? Math.max(0, Math.min(1, (c.readingBlock - n.blockStart) / Math.max(1, n.blockEnd - n.blockStart + 1))) : 0;
    const ny = ri + 1 < dots.length ? dots[ri + 1].cy : dots[ri].cy + 24;
    const cy = dots[ri].cy + p * (ny - dots[ri].cy);
    out.prims.push({ k: "path", id: "now", d: `M${ax - 13},${cy - 4} L${ax - 8},${cy} L${ax - 13},${cy + 4} Z`, stroke: c.colors.accent, strokeW: 1, layer: "over" });
  }
  y = pushMore(c, out, y, "below");
  out.height = y - FLOW.ROW_GAP;
  return out;
}
```
时间线展开某一项时，子项用 `pushKidList`（§5.5.2）画在该项标题下方（项高 `h` 已预留 `kidsH`），子项圆点挂在轴右侧 12px 的细分支线上。

#### 5.5.4 对照（`compare`，成员 2–3 个；>3 个退为 `tree`）

```ts
export function layoutCompare(c: LayoutCtx): PatternLayout {
  const out = newLayout();
  let y = pushHeader(c, out, 0);
  const k = c.members.length, gap = FLOW.CMP_GAP;
  const laneW = Math.floor((c.plan.labelW - gap * (k - 1)) / k);
  const top = y;
  const lanes = c.members.map((id, j) => {
    const n = nodeOf(c, id), x = c.plan.labelX + j * (laneW + gap);
    const lines = wrapLabel(n.title, 13, laneW, 3);
    const kids = kidsOf(c, id).slice(0, FLOW.CMP_KIDS).map((kid) => ({ id: kid, lines: wrapLabel(nodeOf(c, kid).title, 12, laneW - 8, 2) }));
    return { id, x, lines, kids, more: Math.max(0, kidsOf(c, id).length - FLOW.CMP_KIDS), color: c.colorOf.get(id)! };
  });
  const capY = top, titleY = capY + 8;
  const titleH = Math.max(...lanes.map((l) => l.lines.length)) * 18;
  // 属性行按序号对齐：第 r 行高度＝各栏第 r 个子项的最大高度
  const rows = Math.max(0, ...lanes.map((l) => l.kids.length));
  const rowH = Array.from({ length: rows }, (_, r) => Math.max(...lanes.map((l) => (l.kids[r]?.lines.length ?? 0) * 17)) + 6);
  let ry = titleY + titleH + 8;
  const rowY = rowH.map((h) => { const v = ry; ry += h; return v; });
  const bottom = ry + (lanes.some((l) => l.more) ? 18 : 0);
  lanes.forEach((l, j) => {
    const reading = l.id === c.readingId;
    out.prims.push({ k: "rect", id: `cap:${l.id}`, x: l.x, y: capY, w: laneW, h: reading ? 5 : 4, rx: 1, fill: l.color, layer: "over" });
    out.items.push(item({ id: `node:${l.id}`, nodeId: l.id, kind: "node", x: l.x, y: titleY, w: laneW, h: titleH, lines: l.lines, fs: 13, lh: 18,
      weight: 600, tone: 92, reading, selected: l.id === c.selectedId }));
    l.kids.forEach((kd, r) => {
      out.items.push(item({ id: `kid:${kd.id}`, nodeId: kd.id, kind: "kid", x: l.x + 8, y: rowY[r], w: laneW - 8, h: rowH[r], lines: kd.lines, fs: 12, lh: 17, weight: 400, tone: 76, selected: kd.id === c.selectedId }));
      out.prims.push({ k: "circle", id: `kd:${kd.id}`, cx: l.x + 2.5, cy: rowY[r] + 9, r: 2, fill: l.color, layer: "over" });
    });
    if (l.more) out.items.push(item({ id: `more:kids:${l.id}`, nodeId: l.id, kind: "more", x: l.x + 8, y: ry, w: laneW - 8, h: 18, lines: [""], fs: 11, lh: 18, weight: 400, tone: 48, moreKind: "kids", moreCount: l.more }));
    if (reading) out.readingY = titleY + titleH / 2;
  });
  // 栏间横向参考线（无框表格感）
  rowY.forEach((yy, r) => { if (r > 0) out.prims.push({ k: "path", id: `guide:${r}`, d: `M${c.plan.labelX},${yy - 3} H${c.plan.labelX + c.plan.labelW}`, stroke: c.colors.fg, strokeW: 1, opacity: 0.08, layer: "under" }); });
  // 「比」关系：相邻两栏标题之间画两端圆点的短线
  for (let j = 0; j + 1 < lanes.length; j++) {
    const a = lanes[j], b = lanes[j + 1];
    const has = (c.g.outEdges[a.id] ?? []).some((e) => e.to === b.id && e.code === "比") || (c.g.outEdges[b.id] ?? []).some((e) => e.to === a.id && e.code === "比");
    if (has) { out.prims.push({ k: "path", id: `cmp:${a.id}`, d: `M${a.x + laneW - 2},${capY + 2} H${b.x + 2}`, stroke: c.colors.fg, strokeW: 1, opacity: 0.5, startMark: "dot", endMark: "dot", layer: "over" });
      out.expressed.push(edgeKey(a.id, b.id, "比"), edgeKey(b.id, a.id, "比")); }
  }
  // 总线：左侧竖向分成 k 段，每段一根节点条 + 一根引线连到该栏色带左端
  const segH = (bottom - top) / k;
  lanes.forEach((l, j) => {
    const y0 = top + j * segH + 2, y1 = top + (j + 1) * segH - 2, ym = (y0 + y1) / 2;
    out.prims.push({ k: "rect", id: `bus:${l.id}`, x: c.plan.barX, y: y0, w: 6, h: y1 - y0, rx: 1.5, fill: l.color, layer: "over" });
    out.prims.push({ k: "path", id: `lead:${l.id}`, d: `M${c.plan.barX + 6},${ym} C${c.plan.barX + 26},${ym} ${l.x - 20},${capY + 2} ${l.x},${capY + 2}`, stroke: l.color, strokeW: 2, opacity: 0.7, draw: true, layer: "under" });
    out.ports.push({ nodeId: l.id, x: c.plan.barX, y0, y1, color: l.color });
    out.leafIds.push(l.id);
  });
  out.height = bottom;
  out.noStrands = true;
  return out;
}
```
对照里**成员**是高亮 / 流带单位（子项只显示文字，不单独出流带）；选中某成员时动作行插在整个对照块下方（宿主处理：`inlineH` 加到 `out.height`，动作行 y＝`bottom`）。**选中单元格（v49.87 / D255）**：单元格也是可操作条目，`inlineH` 加在所在行带上并写 `out.inlineAt = { x: x0, y: 行内容底边, w: W }`，下一行随之下移，动作行不压下一行。

#### 5.5.5 版式分派

```ts
export const PATTERN_LABEL: Record<FlowPattern, string> = { tree: "大纲", grid: "并列", argument: "论证", timeline: "时间线", chain: "步骤", layered: "因果", compare: "对照" };
export function patternFor(g: GraphState, cut: string, members: string[]): FlowPattern {
  const p = selectPattern(groupFacts(g, cut, members)).pattern;       // 现有选择器：手动 > 模型提示 > 规则表
  if (p === "compare" && (members.length < 2 || members.length > FLOW.CMP_MAX)) return "tree";
  return p as FlowPattern;
}
export function layoutFor(c: LayoutCtx): PatternLayout {
  switch (c.pattern) {
    case "argument": return layoutTree(c, { compact: false, claimRoot: true, chips: true, spines: true, layered: false });
    case "grid": return layoutTree(c, { compact: true, claimRoot: false, chips: false, spines: false, layered: false });
    case "layered": return layoutTree(c, { compact: false, claimRoot: false, chips: false, spines: false, layered: true });
    case "timeline": return layoutTimeline(c);
    case "chain": return layoutChain(c);
    case "compare": return layoutCompare(c);
    default: return layoutTree(c, { compact: false, claimRoot: false, chips: false, spines: true, layered: false });
  }
}
/** 成员窗口 + 逐步收缩直到装下：maxMembers 从 9 降到 3，再降行数 */
export function fitLayout(base: Omit<LayoutCtx, "members" | "moreAbove" | "moreBelow" | "maxLines0">, all: string[], availH: number): PatternLayout & { members: string[] } {
  const ri = Math.max(0, all.indexOf(base.readingId ?? ""));
  const win = (max: number) => {
    const start = Math.max(0, Math.min(ri - Math.floor((max - 1) / 2), all.length - max));
    const end = Math.min(all.length, start + max);
    return { members: all.slice(start, end), moreAbove: start, moreBelow: all.length - end };
  };
  let last: (PatternLayout & { members: string[] }) | null = null;
  for (const lines of [2, 1] as const) for (let max = Math.min(FLOW.MAX_MEMBERS, all.length); max >= Math.min(FLOW.MIN_MEMBERS, all.length); max--) {
    const w = win(max);
    const lay = layoutFor({ ...base, ...w, maxLines0: lines, availH } as LayoutCtx);
    last = { ...lay, members: w.members };
    if (lay.height <= availH) return last;
  }
  return last!;
}
```
（`selectPattern` / `groupFacts` 从 `../mindmap/v2/pattern` 引入。对照版式下 `fitLayout` 不窗口化：成员 ≤3。）

### 5.6 高亮流带（照抄）

```ts
/** 统一形状：左段圆角矩形（文字高亮）→ 右缘不断开地弯成 Sankey 流带 → 节点 port。命令序列固定，CSS d 才能插值。 */
export function shapePath(s: Pick<FlowShape, "L" | "xs" | "s0" | "s1" | "x1" | "t0" | "t1">): string {
  const f = (n: number) => Math.round(n * 10) / 10;
  const r = Math.max(0, Math.min(FLOW.HL_R, (s.s1 - s.s0) / 2, (s.xs - s.L) / 2));
  const xm = (s.xs + s.x1) / 2;
  return `M${f(s.L + r)},${f(s.s0)}H${f(s.xs)}C${f(xm)},${f(s.s0)} ${f(xm)},${f(s.t0)} ${f(s.x1)},${f(s.t0)}` +
         `L${f(s.x1)},${f(s.t1)}C${f(xm)},${f(s.t1)} ${f(xm)},${f(s.s1)} ${f(s.xs)},${f(s.s1)}` +
         `H${f(s.L + r)}Q${f(s.L)},${f(s.s1)} ${f(s.L)},${f(s.s1 - r)}V${f(s.s0 + r)}Q${f(s.L)},${f(s.s0)} ${f(s.L + r)},${f(s.s0)}Z`;
}
/** 收在段落左端（开场的起点 / 关闭的终点）：零宽 */
export const collapseAtLeft = (s: FlowShape): FlowShape => ({ ...s, xs: s.L, x1: s.L, t0: s.s0, t1: s.s1 });
/** 收进节点 port（翻页 / 换组的离场终点、进场起点） */
export const collapseAtNode = (s: FlowShape): FlowShape => ({ ...s, L: s.x1, xs: s.x1, s0: s.t0, s1: s.t1 });

export function buildShapes(geo: ReaderStructureGeometry, lay: PatternLayout, dy: number, o: {
  focusId: string | null; hoverId: string | null; readingId: string | null; colorOf: (id: string) => string;
}): FlowShape[] {
  const ports = new Map(lay.ports.map((p) => [p.nodeId, { ...p, y0: p.y0 + dy, y1: p.y1 + dy }] as const));
  const rightCol = geo.columns.length - 1;
  const tone = (id: string): 0 | 1 | 2 => (id === o.hoverId ? 2 : id === o.focusId ? 1 : 0);
  // 1) 同节点、同栏、相邻（间距 ≤ HL_MERGE_GAP）的段落合并成一块
  type Span = { nodeId: string; column: number; left: number; right: number; top: number; bottom: number };
  const spans: Span[] = [];
  const sorted = geo.boxes.filter((b) => ports.has(b.nodeId)).sort((a, b) => a.column - b.column || a.top - b.top);
  for (const b of sorted) {
    const last = spans[spans.length - 1];
    if (last && last.nodeId === b.nodeId && last.column === b.column && b.top - last.bottom <= FLOW.HL_MERGE_GAP) {
      last.bottom = Math.max(last.bottom, b.bottom); last.left = Math.min(last.left, b.left); last.right = Math.max(last.right, b.right);
    } else spans.push({ nodeId: b.nodeId, column: b.column, left: b.left, right: b.right, top: b.top, bottom: b.bottom });
  }
  // 2) 外扩（不与上下相邻块重叠）
  spans.forEach((s, i) => {
    const prev = spans[i - 1], next = spans[i + 1];
    s.top = Math.max(s.top - FLOW.HL_PAD_Y, prev && prev.column === s.column ? prev.bottom + 1 : -Infinity);
    s.bottom = Math.min(s.bottom + FLOW.HL_PAD_Y, next && next.column === s.column ? next.top - 1 : Infinity);
    s.left -= FLOW.HL_PAD_X; s.right += FLOW.HL_PAD_X;
  });
  // 3) 最右栏的块按 port 比例分配落点；其它栏只有高亮矩形（流带段退化）
  const out: FlowShape[] = []; let order = 0;
  const byNode = new Map<string, Span[]>();
  for (const s of spans) if (s.column === rightCol) { const l = byNode.get(s.nodeId) ?? []; l.push(s); byNode.set(s.nodeId, l); }
  for (const s of spans) if (s.column !== rightCol)
    out.push({ id: `${s.nodeId}@${s.column}:${Math.round(s.top)}`, nodeId: s.nodeId, color: o.colorOf(s.nodeId), L: s.left, xs: s.right, s0: s.top, s1: s.bottom,
      x1: s.right, t0: s.top, t1: s.bottom, tone: tone(s.nodeId), stub: "", ribbon: false, order: order++ });
  for (const p of lay.ports) {
    const list = byNode.get(p.nodeId); if (!list) continue;
    const port = ports.get(p.nodeId)!;
    const H = port.y1 - port.y0;
    const S = list.reduce((a, s) => a + (s.bottom - s.top), 0) || 1;
    const raw = list.map((s) => Math.max(FLOW.MIN_SLICE, H * ((s.bottom - s.top) / S)));
    const k = H / raw.reduce((a, v) => a + v, 0);
    let t = port.y0;
    list.forEach((s, i) => {
      const h = raw[i] * k;
      out.push({ id: `${p.nodeId}#${i}`, nodeId: p.nodeId, color: port.color, L: s.left, xs: s.right, s0: s.top, s1: s.bottom,
        x1: port.x, t0: t, t1: t + h, tone: tone(p.nodeId), stub: "", ribbon: true, order: order++ });
      t += h;
    });
  }
  // 4) 看不见的近邻成员：从视口上 / 下缘伸出的楔形淡流（矩形段为零宽）
  const ri = lay.ports.findIndex((p) => p.nodeId === o.readingId);
  lay.ports.forEach((p, i) => {
    if (byNode.has(p.nodeId) || spans.some((s) => s.nodeId === p.nodeId)) return;
    if (ri >= 0 && Math.abs(i - ri) > FLOW.STUB_ROWS) return;
    const side = (lay as PatternLayout & { sideOf?: Record<string, "above" | "below" | "here"> }).sideOf?.[p.nodeId] ?? "here";
    if (side === "here") return;
    const port = ports.get(p.nodeId)!, yy = side === "above" ? geo.viewport.top : geo.viewport.bottom;
    const x0 = (geo.text?.right ?? geo.viewport.right) + FLOW.HL_PAD_X;
    const mid = (port.y0 + port.y1) / 2, hh = Math.max(2, (port.y1 - port.y0) * 0.4);
    out.push({ id: `stub:${p.nodeId}`, nodeId: p.nodeId, color: port.color, L: x0, xs: x0, s0: yy, s1: yy, x1: port.x, t0: mid - hh / 2, t1: mid + hh / 2,
      tone: 0, stub: side, ribbon: true, order: order++ });
  });
  return out;
}
```
`sideOf`：宿主在调 `buildShapes` 前算好挂在 layout 上——`sideOf[id] = blockEnd < readingBlock ? "above" : blockStart > readingBlock ? "below" : "here"`（任一缺失→"here"）。

### 5.7 关系线（照抄）

```ts
export function strandPath(s: Pick<FlowStrand, "xa" | "ya" | "xb" | "yb" | "bulge">): string {
  return `M${s.xa},${s.ya}C${s.xa - s.bulge},${s.ya} ${s.xb - s.bulge},${s.yb} ${s.xb},${s.yb}`;
}
export const collapseStrand = (s: FlowStrand): FlowStrand => ({ ...s, xb: s.xa, yb: s.ya, bulge: 0 });
export function buildStrands(g: GraphState, lay: PatternLayout, dy: number, o: { textRight: number; focusId: string | null; all: boolean }): FlowStrand[] {
  if (lay.noStrands) return [];
  const ports = new Map(lay.ports.map((p) => [p.nodeId, p] as const));
  const expressed = new Set(lay.expressed);
  const seen = new Set<string>();
  const list: { e: { from: string; to: string; code: string }; dy: number; hot: boolean }[] = [];
  const mid = (p: FlowPort) => (p.y0 + p.y1) / 2 + dy;
  for (const id of ports.keys()) for (const e of g.outEdges[id] ?? []) {
    const key = `${e.from}>${e.to}>${e.code}`;
    if (e.from === e.to || !ports.has(e.to) || expressed.has(key) || seen.has(key)) continue;
    seen.add(key);
    list.push({ e, dy: Math.abs(mid(ports.get(e.from)!) - mid(ports.get(e.to)!)), hot: e.from === o.focusId || e.to === o.focusId });
  }
  list.sort((a, b) => Number(b.hot) - Number(a.hot) || a.dy - b.dy);
  return list.slice(0, o.all ? 16 : FLOW.MAX_STRANDS).map(({ e, dy: d, hot }, order) => {
    const reverse = e.code === "据";                          // 「据」＝目标 → 本节点
    const A = ports.get(reverse ? e.to : e.from)!, B = ports.get(reverse ? e.from : e.to)!;
    const xa = A.x - 1, xb = B.x - 1;
    const room = Math.max(18, Math.min(xa, xb) - o.textRight - 16);
    return { id: `${e.from}>${e.to}>${e.code}`, from: e.from, to: e.to, code: e.code, xa, ya: mid(A), xb, yb: mid(B),
      bulge: Math.max(18, Math.min(18 + 0.28 * d, room)), colorA: A.color, colorB: B.color, strong: hot, reverse, order };
  });
}
```
分层图调用时 `all: true`。

### 5.8 `presence.ts`（进出场保留；照抄）

```ts
import { useEffect, useLayoutEffect, useRef, useState } from "react";
export type Phase = "enter" | "live" | "exit";
export function usePresence<T extends { id: string }>(items: readonly T[], exitMs: number): { item: T; phase: Phase }[] {
  const [, force] = useState(0);
  const store = useRef(new Map<string, { item: T; phase: Phase; t?: number }>());
  const order = useRef<string[]>([]);
  useLayoutEffect(() => {
    const m = store.current; const seen = new Set<string>(); let changed = false;
    for (const it of items) {
      seen.add(it.id);
      const e = m.get(it.id);
      if (!e) { m.set(it.id, { item: it, phase: "enter" }); changed = true; continue; }
      if (e.t != null) { window.clearTimeout(e.t); e.t = undefined; }
      if (e.item !== it) { e.item = it; changed = true; }
      if (e.phase === "exit") { e.phase = "live"; changed = true; }
    }
    for (const [id, e] of m) if (!seen.has(id) && e.phase !== "exit") {
      e.phase = "exit"; changed = true;
      e.t = window.setTimeout(() => { m.delete(id); order.current = order.current.filter((x) => x !== id); force((n) => n + 1); }, exitMs);
    }
    const next = items.map((i) => i.id);
    order.current.forEach((id, i) => { if (!seen.has(id) && m.has(id)) next.splice(Math.min(i, next.length), 0, id); });
    order.current = next;
    if (changed) force((n) => n + 1);
    if (![...m.values()].some((e) => e.phase === "enter")) return;
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => {
      for (const e of m.values()) if (e.phase === "enter") e.phase = "live";
      force((n) => n + 1);
    }); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [items, exitMs]);
  useEffect(() => () => { for (const e of store.current.values()) if (e.t != null) window.clearTimeout(e.t); }, []);
  return order.current.map((id) => store.current.get(id)).filter((e): e is { item: T; phase: Phase } => !!e).map((e) => ({ item: e.item, phase: e.phase }));
}
```

---

## 6. 宿主

### 6.1 `useStructureFlow(kernel, documentId, title, active)`——从 `MindmapLens.tsx` 移植

逐段照抄（行号为写本文时位置），删掉 fit / 窗口 / 纸片 / perf / 控制轨 / focusN / showAll / markExpanding / showRailTemporarily：

| 能力 | 源位置 | 备注 |
|---|---|---|
| `loadGraph` | L224–237 | 原样 |
| `doLocate` / `scheduleLocate` | L240–278 | 原样（含「已送完却定位不到→重送一次」） |
| 文档切换清状态 | L281–307 | 只留 loc / graph / busy / sel / hover / backLoc / explain / anchorCache / retried |
| 送原文 + hasKey | L310–323 | 原样 |
| relocate → 重新定位 | L326–334 | 原样 |
| `mindmap/delta` | L337–368 | 原样（删 `pendingExpandRef`） |
| `mindmap/changed` | L371–382 | 原样 |
| `readingId` | L385 | 原样 |
| 取锚 `nodeAnchors` | L954–977 | 要取的 id ＝ `layout.leafIds` |
| `jumpTo` / `goBack` / `generateHere` / `deepen` / `explain` | L1040–1149 | 原样 |

新增 `expandedId`（手风琴；文档切换或所属整体 `cut` 变化时复位；阅读节点本身有子节点时初值＝阅读节点）。

**段落定位**：每次 `leafIds` 或锚变化，组装 `targets`：对每个 leaf 节点、它的每个锚 `a`（下标 i）→ `{ key: \`n:${id}:${i}\`, nodeId: id, unitAnchor: a.unitAnchor, head: a.head, tail: a.tail }`；签名（key 拼串）不变就不调；`kernel.setStructureTargets?.(targets)`。关闭 / 卸载 / `covered` 时 `setStructureTargets([])`。

### 6.2 `StructureFlowHost.tsx`

Props：`{ kernel, documentId, title, open, covered, scrolled, viewportEl, shiftEl, gutterEl, onClose, onOpenInMap }`。

1. **阶段** `stage: "closed" | "opening" | "open" | "closing"`：`open && !covered` → `opening`（编排 §8.1，结束 → `open`）；否则 → `closing`（§8.2，结束 → `closed`：不渲染、清定位、平移 / 预留归零）。
2. **颜色** `resolveColors()`：隐藏探针 `<span class="flow-probe" style="position:absolute;visibility:hidden">` 挂在 `viewportEl` 内，依次设 `color` 为 `var(--reader-bg, var(--paper))`、`var(--reader-fg, var(--ink))`、`var(--accent)`、`var(--accent-on, #fff)`、`color-mix(in srgb, var(--reader-fg, var(--ink)) 14%, var(--reader-bg, var(--paper)))`、`var(--flow-counter)`、`var(--flow-c1)`…`var(--flow-c8)`，读 `getComputedStyle(probe).color`。`dark` = 背景相对亮度 < 0.4；判定后给探针加 `data-dark="1"` 再读一次色板与 `--flow-counter`（深色值写在 `.flow-probe[data-dark="1"]`，§7.1）。透明度 Token 用 `parseFloat(getComputedStyle(probe).getPropertyValue("--flow-ahl-0"))` 等读出。`kidColor` 产生的 `color-mix(...)` 也用探针解析成实色。阅读主题 / 皮肤变化（body `style` 的 MutationObserver + `settings:changed`）时重算。
3. **环境**：`viewport = viewportEl.getBoundingClientRect()`（预留槽位在视口内，见 §6.4，因此视口矩形不随预留变化）；`baseText`＝最近一次**未预留**时 `geo.text`（还原掉当前平移：`left + shift`、`right + shift`）；无 `geo.text` 用 `viewport.left + 0.2·w / viewport.right − 0.2·w`。`ResizeObserver(viewportEl)` + `window resize` → `resizingUntil = now + RESIZE_IDLE_MS`，缩放期间不改 `mode`（只按现 plan 跟随），停手后重决策。
4. **排布**：`plan = planColumn({ on, viewport, textLeft: baseText.left, textRight: baseText.right }, prevPlan)`；`reserve > 0` 时按 §5.3 的保持规则修正 `barX`。
5. **平移 / 预留执行**：
   - `shift` 变化：`shiftEl.style.transform = shift ? \`translateX(${-shift}px)\` : ""`（`shiftEl` 带 `.flow-shift-target` 过渡类）。
   - `reserve` 变化（0 → R、R → 0、或数值变化）：走 §8.8 的「淡出 → 改槽宽 → 等重排 → 淡入」。
6. **几何采样**：
   - 翻页模式：`kernel.on("relocate")` → `motion = "turn"`，先以当前 layout 发 `shapes` 的离场（收进节点），`TURN_RESAMPLE_MS` 后采样并发新场景（从节点伸出）；`POLL_PAGED_MS` 轮询兜底（字体加载等引起的重排）。
   - 滚动模式：`relocate` 后进入「跟踪」：每帧 rAF 采样，直到 `TRACK_IDLE_MS` 内无新 relocate；跟踪期间 `tracking = true`（渲染器关掉高亮流带的过渡，矩形逐帧贴着文字走）。
   - `setStructureTargets` 之后下一帧补采；`document.visibilityState !== "visible"` 不采。
   - 签名：`JSON.stringify(geo.boxes.map(b => [b.nodeId, b.block, b.top|0, b.bottom|0, b.left|0]))` + `geo.text`；没变不 setState。
7. **场景**（`useMemo`）：
   ```
   top/bottom = viewport.top + COL_MARGIN_Y / viewport.bottom − COL_MARGIN_Y；availH = bottom − top
   cut        = graph.nodes[readingId].parentId ?? ROOT_ID
   all        = childrenOf(graph, cut) 过滤存在者
   pattern    = patternFor(graph, cut, all)
   colorOf    = all 的第 i 个 → readingId ? accent : palette[i % 8]
   inlineH    = 选中项存在 ? ACTIONS_H + (讲解展开 ? min(EXPLAIN_MAX_H, ceil(字数×12/labelW)×18 + 12) : 0) : 0
   lay        = fitLayout({...}, all, availH)；lay.sideOf = …（§5.6）
   dy         = 对齐：lay.readingY != null && alignY != null ? alignY − lay.readingY : (availH − lay.height)/2；
                再钳制到 [top, bottom − lay.height]（dy 是局部 y=0 对应的 client y）
   shapes     = geo ? buildShapes(geo, lay, dy, …) : []；strands = buildStrands(graph, lay, dy, {textRight: 当前实际 textRight, focusId, all: pattern==="layered"})
   hlX0/hlX1  = (geo.text.left − HL_PAD_X) / plan.barX
   ```
   `alignY`＝阅读节点在视口内 boxes 的 `(min top + max bottom)/2`；**只在稳定时更新**（翻页采样后 / 跟踪结束后）。`readingId` 为空时 layout 只有头部，`panel.kind` 显示空态（§7.6）。`whisper` 模式：只用 layout 的 ports / bars，不渲染标签与脊线等 prims（只保留 `bar:*`）。
8. **渲染**：`createPortal(<FlowLayer scene={scene} onEvent={handle} />, document.body)`。
9. **Esc**：`open` 且焦点不在输入框 → `onClose()`。

### 6.3 事件 `handle(ev)`

| ev.kind | 行为 |
|---|---|
| `hover {nodeId\|null}` | `setHoverId`（离开延迟 200ms 才清，防扫过闪烁） |
| `click {nodeId}` | `nodeId===readingId` → `setSel(null)`；否则 `setSel(nodeId)`；该节点有子节点且版式不是对照 → `toggleExpand(nodeId)`（motion `split` / `merge`） |
| `dblclick {nodeId}` | `jumpTo(nodeId)` |
| `more {kind, nodeId?}` | `above` / `below`：`setSel(窗口外最近的成员)`；`kids`：`onOpenInMap(nodeId, …)` |
| `action {name}` | `back` / `jump` / `explain` / `closeExplain` / `deepen` / `generate` / `openInMap`（作用于 `focusId`；`openInMap` 带当前 leafIds 作 region） |

### 6.4 `Reader.tsx` 改动

1. 删除结构图独立窗口宿主段中与 `lensAPI` 有关的全部 effect（约 L681–797）；保留 `lensOpen` / `setLensOpen` / `lensSupported` / `lensOpenInMapRef` / `mapFocus`。
2. `.reader-engine-viewport` 加 `ref={viewportRef}`；在 `.reader-engine-main` **之后**加兄弟节点 `<div ref={flowGutterRef} className="reader-flow-gutter" aria-hidden="true" />`（预留槽位；视口是 flex 行，主区收窄后 foliate 自行重排）。
3. **平移目标 `shiftEl`**：`.reader-engine-main`（加 `ref={engineMainRef}` 与类 `flow-shift-target`）。**先 grep 确认它的子孙里没有 `position: fixed` 元素**（transform 会改变其参照）；若有（例如翻页热区 hint），改平移 `ReaderEngine` 的根元素。
4. 渲染：
   ```tsx
   <StructureFlowHost kernel={lensKernel} documentId={lensDocId} title={lensTitle}
     open={lensOpen && lensSupported}
     covered={/* 图谱页签画布正盖着正文：sidebarOpen && sidebarTab==="map" && !!mapLayerHost */}
     scrolled={readerSettings.mode.flow !== "paged"}
     viewportEl={viewportRef.current} shiftEl={engineMainRef.current} gutterEl={flowGutterRef.current}
     onClose={() => setLensOpen(false)} onOpenInMap={(id, region) => lensOpenInMapRef.current(id, region)} />
   ```
5. 工具栏「结构图」按钮样式不改。

---

## 7. 视觉规格

### 7.1 Token（`src/theme.css` 新节「结构流」）

| Token | 浅色（`:root` 下） | 深色（写在 `.flow-probe[data-dark="1"]`） | 用途 |
|---|---|---|---|
| `--flow-c1`…`--flow-c8` | `#6E7F2E #A9821C #A84A80 #3E8A82 #3F68A8 #6F5FB0 #A44836 #B2662A` | `#9AAA55 #D2AE45 #CF74A6 #6DB5AC #6E95D2 #9A8BD6 #CF6E5C #DA8F4E` | 8 色板（橄榄 金 玫 青 钢蓝 薰衣草 赭红 琥珀） |
| `--flow-counter` | `#B5483B` | `#E07A6A` | 反方标识 |
| `--flow-ahl-0/1/2` | `.16 / .26 / .38` | `.20 / .30 / .42` | 高亮矩形不透明度（基础 / 焦点 / 悬停） |
| `--flow-aend-0/1/2` | `.34 / .52 / .60` | `.44 / .62 / .70` | 流带落点不透明度 |
| `--flow-adim` | `.30` | `.32` | 悬停别的节点时其余高亮流带 |
| `--flow-strand-a` | `.62` | `.72` | 关系线 |
| `--flow-ease` | `cubic-bezier(.2,.7,.2,1)` | 同 | 通用（＝ `--mm-ease`） |
| `--flow-ease-out` | `cubic-bezier(.16,1,.3,1)` | 同 | 伸展 / 揭示 |
| `--flow-ease-in` | `cubic-bezier(.55,0,.75,.2)` | 同 | 收回 / 退场 |

深浅以**阅读背景**判定（应用浅色 + 阅读夜间时按深色）。皮肤可覆盖全部 Token。

### 7.2 设计原则
1. **长在页面上**：没有卡片、边框盒子、面板背景；字色 / 线色全部取自阅读主题（`scene.colors`）。
2. **高亮与流带是一体**：同一路径、同一渐变；矩形部分是匀色荧光笔，过了段落右缘才开始向节点逐渐变浓。
3. **一种强调色**：主题色只给阅读节点、焦点流带、碰到焦点的关系线、根论点。
4. **层级一眼可辨**：缩进 + 节点条粗细 + 字号字重 + 类型标签四重编码，脊线把从属关系连出来。
5. **安静**：静止时没有任何东西在动（时间线的阅读游标只在阅读位置变化时滑动）。

### 7.3 `FlowLayer.tsx` 结构与图元

```tsx
<>
  {/* ① 混合层：只放高亮流带。直接挂在 body 下；自身及祖先都不能有 transform / opacity / filter / will-change（否则混合被隔离） */}
  <svg className="flow-blend" data-dark={colors.dark ? "1" : undefined} data-tracking={tracking ? "1" : undefined}
       style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", pointerEvents: "none", zIndex: 23,
                mixBlendMode: colors.dark ? "screen" : "multiply", overflow: "visible" }}>
    <defs>
      {/* 每个（颜色 × 档位）一个渐变；userSpaceOnUse，横向基准 hlX0 → hlX1（整场稳定，不随单个形状动画变化） */}
      <linearGradient id={`fg-${ci}-${tone}`} gradientUnits="userSpaceOnUse" x1={hlX0} y1="0" x2={hlX1} y2="0">
        <stop offset="0" stopColor={color} stopOpacity={aHL[tone]} />
        <stop offset={p} stopColor={color} stopOpacity={aHL[tone]} />      {/* p＝(textRight + HL_PAD_X − hlX0)/(hlX1 − hlX0)，钳到 [0,1] */}
        <stop offset="1" stopColor={color} stopOpacity={aEnd[tone]} />
      </linearGradient>
      {/* stub 用 objectBoundingBox：0 → 0、1 → 0.16 */}
    </defs>
    <g className="flow-shapes">{shapes.map(s => <path key={s.id} className={cls(s)} d={shapePath(g)} style={{ d: `path("${shapePath(g)}")`, ...delayVars }} fill={`url(#fg-${ci}-${s.tone})`} />)}</g>
  </svg>
  {/* ② 上层：普通合成 */}
  <div className="flow-layer" data-tracking={…} data-motion={…}>
    <svg className="flow-svg" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}>
      <defs>{/* prim 渐变 g-${id}；反方斜纹 pattern h-${ci}；端头 marker */}</defs>
      <g className="flow-col" style={{ transform: `translateY(${dy}px)` }}>
        <g className="flow-prims-under">…</g>
      </g>
      <g className="flow-strands">…（已含 dy 的绝对坐标）</g>
      <g className="flow-col" style={{ transform: `translateY(${dy}px)` }}>
        <g className="flow-prims-over">…</g>
      </g>
    </svg>
    <div className="flow-items" style={{ transform: `translateY(${dy}px)` }}>…HTML 标签 / 动作行…</div>
  </div>
</>
```
- 形状 class：`flow-shape`；`hoverId` 存在且不是本节点 → `is-dim`；`stub` → 用 stub 渐变。
- **`d` 同时写 attribute 与 style**（attribute 给 jsdom 测试与兜底；style 才能 CSS 过渡）；`rect` / `circle` 的几何用 style 写（`y`、`height`、`cx`、`cy`、`r` 均可 CSS 过渡）。
- prim 渲染：`path`→`<path fill="none" stroke strokeWidth strokeDasharray strokeLinecap="round" opacity>`，有 `grad` 用 `stroke="url(#g-id)"`（userSpaceOnUse，按 prim 给的坐标）；`draw` 为真时加 `pathLength="1"`，进场 `stroke-dasharray: 1; stroke-dashoffset: 1 → 0`（§8）；`endMark/startMark`：arrow＝实心 5px 三角，bar＝2px 竖杠，open＝空心三角，dot＝r=2 圆，颜色取 stroke 或渐变终点色。`rect`→ `hatch` 为真时 `fill="url(#h-ci)"`（`<pattern width=4 height=4 patternUnits=userSpaceOnUse patternTransform="rotate(45)"><rect width=2 height=4 fill=color/></pattern>`）。`circle` / `text` 直出。
- 关系线：`stroke="url(#gs-…)"`（上端色 → 下端色，userSpaceOnUse 按 `ya/yb`），strong 时 `stroke=accent`；`strokeWidth = REL_STYLE[code].width + 0.25`、`strokeDasharray = REL_STYLE[code].dash`（`REL_STYLE` 来自 `../mindmap/v2/route`），`opacity = strandA`；端头按 `REL_STYLE[code].end`（reverse 时画在起点；「比」两端 dot）；`|ya−yb| ≥ 28` 时在弧顶 `(min(xa,xb) − 0.75·bulge, (ya+yb)/2)` 画码章：`circle r=8 fill=bg stroke=线色 1px` + 10px 码字。分层图里关系线一律加箭头（即使 REL_STYLE 无端头）。
- 所有 SVG `pointer-events: none`；命中只走 HTML。

### 7.4 HTML 标签

```
.flow-item                 position absolute；transform translate(x, y)；width w；height h；pointer-events auto（kind!=="head" 时）；cursor pointer
                           data-flow-item={id} data-reading data-selected data-expanded；font-family＝应用 UI 字体变量（grep .mm2-focus 现用的）
  .flow-chip               （chip）display inline-block；font 10px/14px；padding 0 5px；margin-bottom 2px；letter-spacing .04em
     solid                 background color-mix(fg 10%, transparent)；color fg 80%
     outline               border 1px solid color-mix(fg 22%, transparent)；color fg 62%
     counter               border 1px solid var(--flow-counter 实色)；color 同；前缀「⟂ 」
  .flow-time               （time）font 11px/15px tabular-nums，等宽数字字体变量；color fg 58%；letter-spacing .02em
  .flow-line               每行一个 span，nowrap；font fs/lh；font-weight weight；color fg tone%
  .flow-meta               与最后一行同行、绝对定位 right 0：11px，fg 42%，tabular-nums
  hover                    .flow-line color fg 100%；对应节点条宽 +1（宿主 hover 时把该 bar 的 w+1）
  [data-selected=1]        .flow-line color accent；首行 text-decoration underline 1px，text-underline-offset 3px
  [data-reading=1]         .flow-line 包 <mark class="flow-pill">：background accent；color accentOn；padding 1px 6px；margin-left −6px；
                           box-decoration-break clone（沿用第六轮用户定的「阅读节点＝主题色底 + 白字」）；chip / time 不包
  kind="head"              标题 11px fg 52%；meta（版式名，如「时间线」）10px fg 40%、letter-spacing .08em、右对齐；
                           标题下 24px 宽 1px 线（hairline），距标题 4px；「↩ 回到刚才读的位置」11px fg 72%（id="back"，可点）
  kind="more"              11px fg 48%：「上方另 {n} 项」「下方另 {n} 项」「另 {n} 项」；hover fg 80%
.flow-inline               left=选中项 x，top=选中项 y + 选中项 h，width=选中项 w；pointer-events auto；overflow hidden
  .flow-actions            26px 一行：跳到原文 · 讲解 · 深挖 · 在完整图谱中打开（12px fg 62%，hover fg 100% + 1px accent 下划线；「·」fg 30%）
  .flow-explain            12.5px/18px fg 82%；max-height EXPLAIN_MAX_H；内部滚动（细滚动条 thumb fg 18%）；底部 16px 渐隐遮罩；
                           生成中首行 3 个 4px accent 圆点依次呼吸（1.2s 循环）
  .flow-status             11px fg 52%，2.6s 后淡出
.flow-whisper-tag          （whisper 悬停节点条）节点条左侧 8px 浮出：background bg，1px hairline，padding 3px 8px，12px fg 90%，
                           box-shadow 0 6px 18px −10px rgba(0,0,0,.35)，max-width 220，单行省略
```

### 7.5 各版式视觉要点（与 §5.5 数值一致，这里是意图说明，便于自查）
- **大纲树**：Sankey 基础列；条高 ∝ 篇幅；语义挂接用脊线；行尾显示类型名。
- **论证图**：根论点（所属整体）在顶：10px 主题色条 + 14px 粗体 + 实心「论点」标签；下级缩进 14px，条 6px；例证再缩进、条 4px、字 12px、点线脊；反方条为斜纹、标签描边为反方色、脊线断线 + 截止短杠「⊣」。
- **时间线**：竖轴 2px、相邻光点间颜色渐变；光点 r=5（阅读 r=6.5 + 外环 r=10）、2px 背景色描边把轴切断；时间文字在标题上方；比例模式下轴左侧有淡色刻度，长断层画虚线 + 「//」；流带收束成 8px 高落到光点（"光汇聚成点"）；阅读游标（主题色小三角）在轴左侧随阅读进度在光点之间滑动。
- **链**：编号圆 r=9（数字背景色、圆为节点色），相邻步骤之间带箭头的竖向渐变连线；流带落在圆的左侧 14px 高。
- **分层图**：按因果层号缩进（0–3 级），关系线全部画出且都带箭头——像瀑布一样从因流向果。
- **对照**：2–3 栏并排，每栏顶一根 4px 色带、栏名 13px 粗体、下面属性行按序号横向对齐并有极淡横线；相邻栏若有「比」关系，栏顶色带之间有两端圆点的短线；左侧总线分 k 段，每段一根节点条 + 一根弯曲引线接到该栏色带（流带 → 总线 → 引线 → 栏，颜色一路连贯）。
- **网格**：紧凑列：单行标签、4px 条、无层级。

### 7.6 空态（就地、在节点列位置、竖向居中）
| panel.kind | 呈现 |
|---|---|
| `feeding` | 「原文读取中 {done}/{total}」12px fg 60% + 1px accent 细线（长度 = labelW × done/total，宽度过渡 300ms） |
| `empty` | 「本节还没有结构」12px fg 60% + 文字按钮「为本节生成 →」12px accent |
| `nokey` | 「需要先在设置里配置 AI」12px fg 60% |
| `busy` | 「正在生成…」+ 不定进度细线（40% 长度段以 1.4s 往复） |

### 7.7 CSS（`theme.css`「结构流」节，补充）

```css
.flow-layer { position: fixed; inset: 0; pointer-events: none; z-index: 24; }
/* z-index 必须低于阅读界面所有菜单 / 弹层 / 对话框：grep `.reader-tool-menu`、选区菜单与 modal 的 z-index；若 ≤24，把 23/24 调到它们之下 */
.flow-item, .flow-inline { pointer-events: auto; }
.flow-item[data-kind="head"]:not([data-flow-item="back"]) { pointer-events: none; }
.flow-shape { transition: d var(--flow-t-geo, 420ms) var(--flow-ease), opacity 160ms var(--flow-ease); transition-delay: var(--flow-delay, 0ms); }
.flow-shape.is-dim { opacity: var(--flow-adim); }
.flow-blend[data-tracking="1"] .flow-shape { transition: none !important; }
.flow-col { transition: transform 420ms var(--flow-ease); }
.flow-items { transition: transform 420ms var(--flow-ease); }
.flow-svg rect, .flow-svg circle { transition: x 380ms var(--flow-ease), y 380ms var(--flow-ease), width 160ms var(--flow-ease), height 380ms var(--flow-ease),
  cx 380ms var(--flow-ease), cy 380ms var(--flow-ease), r 200ms var(--flow-ease), fill 240ms var(--flow-ease), opacity 220ms var(--flow-ease), transform 280ms var(--flow-ease-out);
  transform-box: fill-box; transform-origin: 50% 50%; transition-delay: var(--flow-delay, 0ms); }
.flow-svg path { transition: d 420ms var(--flow-ease), stroke-dashoffset var(--flow-t-draw, 480ms) var(--flow-ease-out), opacity 220ms var(--flow-ease); transition-delay: var(--flow-delay, 0ms); }
.flow-strands path { transition: d 600ms var(--flow-ease-out), opacity 200ms var(--flow-ease); }
.flow-item, .flow-inline { transition: transform 380ms var(--flow-ease), opacity 240ms var(--flow-ease), height 240ms var(--flow-ease); transition-delay: var(--flow-delay, 0ms); }
.flow-pill { transition: background-color 200ms var(--flow-ease), color 200ms var(--flow-ease); }
.flow-shift-target { transition: transform 420ms var(--flow-ease), opacity 160ms var(--flow-ease); }
.reader-flow-gutter { flex: 0 0 auto; flex-basis: 0; }
.flow-layer[data-motion="off"] *, .flow-blend[data-motion="off"] * { transition-duration: 0ms !important; transition-delay: 0ms !important; animation-duration: 0ms !important; }
@media (prefers-reduced-motion: reduce) {
  .flow-layer *, .flow-blend *, .flow-shift-target { transition-duration: 0ms !important; transition-delay: 0ms !important; animation-duration: 0ms !important; }
}
```
行 / 头 / 动作行一律用 `transform` 定位并过渡（不用 `top`）；`.reader-flow-gutter` **不加** flex-basis 过渡（槽宽一步到位，由 §8.8 的淡出遮住）。应用内动效设置为关时（照 `MindmapCanvasV2` 读 `motionPreference()` 的方式）给两层加 `data-motion="off"`。

---

## 8. 动效编排（ms；`stagger(i, step, cap) = min(i×step, cap)`，i＝本组内自上而下序号）

渲染器用 `scene.motion` + 元素 `phase`（§5.8）决定起点几何、终点几何与 `--flow-delay`。每个 motion 结束后宿主置回 `steady`（定时器＝总时长）。

### 8.1 打开（`open`）——荧光笔划过文字，流向结构

| 起始 | 元素 | 起点 → 终点 | 时长 / 曲线 |
|---|---|---|---|
| 0 | 正文平移（`shift`）或预留（`reserve`，§8.8） | — | 平移 420；预留见 8.8。**其余全部顺延到正文落定并重新采样之后**（平移 +360；预留 +重排完成） |
| 0 + stagger(i,30,240) | 高亮流带 | `collapseAtLeft` → 实形：从段落左端划向右端，过右缘后继续弯向节点 | 640 / ease-out |
| 160 | 头部 / 版式名 | opacity 0 → 1 | 240 |
| 300 + stagger(i,22,200) | 节点条 / 光点 / 编号圆 / 对照色带 | `scale(0)` → 1（条沿竖向、圆整体） | 280 / ease-out |
| 360 + stagger(i,22,200) | 标签 | `opacity 0, translateX(−6px)` → `1, 0` | 260 / ease |
| 480 | 脊线 / 时间轴 / 步骤连线 / 总线引线（`draw`） | `stroke-dashoffset 1 → 0`（线被"画"出来） | 480 / ease-out，stagger(i,40,200) |
| 600 | 刻度 / 断层符 / 阅读游标 / 外环 | opacity 0 → 1 | 240 |
| 760 + stagger(i,40,240) | 关系线 | `collapseStrand` → 实形 | 600 / ease-out |
| 总时长 | | **≈ 1600**（另加正文平移 / 重排时间）；开场期间可立即交互 | |

### 8.2 关闭（`close`）——结构收回文字

| 起始 | 元素 | 终点 | 时长 / 曲线 |
|---|---|---|---|
| 0 | 关系线 | `collapseStrand` + opacity 0 | 180 / ease-in |
| 0 + stagger(i,12,96) | 标签 / 头 / 动作行 | opacity 0、translateX(−4px) | 160 / ease-in |
| 60 | 脊线 / 轴等 `draw` 线 | dashoffset 0 → 1 | 220 / ease-in |
| 100 + stagger(i,14,110) | 高亮流带 | `collapseAtLeft`（流回并从右向左擦掉高亮） | 360 / ease-in |
| 160 | 节点条 / 光点 / 圆 | `scale(0)` | 200 / ease-in |
| 480 | 正文平移归位 / 撤销预留（§8.8） | — | 420 |
| 总时长 | | **≈ 480**（+ 正文归位） | |

### 8.3 翻页（`turn`，翻页模式）
| 起始 | 元素 | 变化 | 时长 |
|---|---|---|---|
| 0 | 旧页高亮流带 | → `collapseAtNode`（高亮被"吸"进节点） | 180 / ease-in |
| 220 | 新页高亮流带 | `collapseAtNode` → 实形（从节点伸出、落到新页段落、再向左铺开成高亮）；同 id 的形状若还在退场途中，直接从当前位置转向新目标 | 420 / ease-out，stagger(i,18,120) |
| 220 | 节点列（若阅读节点变了） | 见 8.5 | |
| 总时长 | | **≈ 760** | |

### 8.4 滚动（`track`，滚动模式）
高亮流带逐帧贴着段落走（无过渡）；节点列不动；跟踪结束 160ms 后若 `alignY` 变化，整列 `translateY` 过渡 420 对齐新阅读段落；新进入视口的段落 `collapseAtNode` → 实形 320，离开的 → `collapseAtNode` 220。

### 8.5 阅读节点在同组内移动（`steady`）
- 主题色 pill 旧行淡出 160、新行淡入 200；节点条 `fill` 过渡 240；时间线阅读游标沿轴滑动（`d` 过渡 420），外环从旧光点淡出、新光点淡入；
- 成员窗口滑动：行 `transform` 380；移出的行 opacity 0 + 上 / 下 8px（200），移入的从反方向 8px 进（260，延迟 80）；
- 整列对齐：`translateY` 420。

### 8.6 换组（`regroup-down` / `regroup-up`）——含版式切换
- 旧标签：stagger(i,14,120) 起 opacity 0 + `translateY(∓10px)`，180 / ease-in；旧高亮流带 → `collapseAtNode` 180；旧 prims（条 / 光点 / 脊线 / 轴 / 总线）：线 dashoffset → 1（200），块 `scale → 0`（180）；
- 头部（含版式名）：交叉淡化 240；
- 新标签：160 + stagger(i,20,180) 起从 `±10px` 与 opacity 0 进场，280 / ease；新 prims 按 8.1 的顺序与时长（起点 160）；新高亮流带 340 起 `collapseAtNode` → 实形 460；新关系线 560 起 600。
- 同一节点在新旧版式里都在（极少见）：标签与条直接 `transform` 过渡到新位置，不离场。
- 总时长 ≈ 1160。

### 8.7 展开 / 收起（`split` / `merge`）——一股分成几股
- **展开**：子项 opacity 0 → 1（240，stagger(j,30,150)）；其下所有项 `transform` 下移（380）；子项节点条的**起点几何**＝把父条的 `[y, y+h]` 按子节点篇幅切成几段（看起来父条裂开）→ 各自位置（380 / ease-out）；父条宽 6→3 变括弧（240）；**子节点高亮流带的起点几何取父节点流带当前几何**（渲染器保留上一帧 `Map<nodeId, FlowShape[]>`，子形状 `#k` 取父的 `#min(k, 父段数−1)`），于是一股流带分成几股（`d` 过渡 420 / ease-out）。
- **收起**：反向——子流带终点＝父节点条区间（汇成一股，320 / ease-in），子项淡出（200），父流带从汇合处展开（`collapseAtNode` → 实形 380）。
- 总时长 ≈ 700。

### 8.8 正文让位（`shift` ↔ `reserve` ↔ 无）
- **只有平移变化**：`transform` 过渡 420 / ease；期间高亮流带隐藏（opacity 0，120），落定后重新采样再以 `collapseAtNode → 实形`（320）伸回——避免流带拖在移动的文字后面。
- **预留变化**（打开时需要预留 / 窗口缩放跨越阈值 / 关闭时撤销预留）：
  1. 高亮流带 → `collapseAtNode`（180）；
  2. 正文 `opacity 1 → 0`（160 / ease-in）；
  3. 改槽宽 `gutterEl.style.flexBasis = reserve + "px"`（一步到位）；
  4. 等重排：等到 `kernel.on("relocate")` 一次或 `RELAYOUT_WAIT_MS`（先到为准），再等 1 帧；
  5. 采样几何、更新 `baseText` 之外的实际 `textRight`、重算 layout；
  6. 正文 `opacity 0 → 1`（240 / ease）；同时高亮流带按 8.1 的「划过」进场（640）。
  - 总时长 ≈ 1200。打开时预留与 8.1 合并：节点列在第 2 步同时淡入，所以用户先看到结构出现、文字随即在左侧重新出现并被高亮划过——没有硬切。

### 8.9 悬停 / 选中 / 讲解 / AI 新节点
- 悬停：该节点形状换到 hover 档（渐变 id 切换，瞬时）+ 其余形状 `is-dim`（160）；节点条宽 +1（160）。
- 动作行：`height 0 → 26` + opacity（220），下方项 `transform` 下移；切换选中时旧行收起、新行展开同时进行。**锚点（v49.87 / D255）**：动作行恒锚「选中条目底边」——成员行＝标签底（展开时＝子项块底），子项＝该子项底，对照单元格＝所在行内容底；版式必须先在锚点下方留出 `inlineH`，否则按钮行会与下一条重叠。
- 讲解：高度到 `min(内容, 168)`（280 / ease-out）；流式追加的新文字 span 淡入 180。**高度口径（v49.87 / D255）**：宿主预留与渲染器框高共用 `explainBoxH(text, labelW, busy)`；渲染器 `min-height = max-height = explainBoxH`（超出的文字在框内滚动）——按字数估算会少算一行（12.5px 字号），框一旦长出去就又压住下一条。
- AI 新节点到达：按 8.7 子项进场方式长出；新形状 `collapseAtNode` → 实形 460；多个 stagger 40。

### 8.10 降级
reduced-motion / 应用动效关：几何直接到位，只保留 120ms 的 opacity 淡入淡出（打开 / 关闭 / 换组 / 预留仍不硬切）。`animUntil` 之前到达的新场景照常应用（CSS 过渡从当前值平滑转向新值，不排队）。

---

## 9. 层级与版式的验收样例（实施者用来自测，用户用来对照）

| 输入（成员类型 / 关系） | 期望 |
|---|---|
| 组：论点 A、理由 B（B 支 A）、例证 C（C 例 A）、反方观点 D（D 驳 A） | 版式＝论证图（规则 2）；若所属整体是论点 P：P 为根（10px 主题色条）→ A、B、C、D 都在 P 下；B 挂 A 下实线脊、C 挂 A 下点线脊、D 挂 A 下断线 + 「⊣」、条为斜纹；A 的「支 / 例 / 驳」关系不再画关系线 |
| 组：4 个子节点都有 `〈1945年8月〉`、`〈1949年〉`、`〈1950年〉`、`〈1978年〉` | 版式＝时间线；1945→1949→1950 比例间隔；1950→1978 间隔 28 > 4×中位数 → 断层虚线 + 「//」；刻度步长 10 |
| 组：步骤 ×4 | 版式＝链；①②③④ + 箭头连线 |
| 组（类型均为「因果」）：A 因 B、B 因 C、A 推 D | 版式＝分层图（规则 4：子 4 个、因/推边 3 条 ≥ n−1）；层号 A=0、B=1、D=1、C=2；顺序 A、B、D、C；按层缩进 14px；三条关系线都带箭头 |
| 父为「对比」、子 2 个（X、Y，X 比 Y） | 版式＝对照；两栏；色带间有两端圆点短线；总线两段 |

---

## 10. 实施阶段与验收

### 阶段 1：纯模块
- `src/lib/flow/{types,layout,presence}.ts`（§5 照抄）。
- `tests/flow.layout.test.cjs`（TS 转译加载方式照 `tests/m15v2.cardpkg.test.cjs` 头部）：
  1. `planColumn`（默认 `viewport={left:280,right:1200,top:60,bottom:900}`、`textLeft=420`、`textRight=1000`）：
     room=200，`blockW(248)=294` → need=64+294−200=158→160 > maxShift(min(200,420−280−40)=100) → `reserve` 判定：vw=920−reserveW(248)=920−390=530 ≥ 480 → `reserve`, reserve=390；
     `textLeft=560`（maxShift=200）→ `shift`, shift=160；
     `textRight=840` → room 360 ≥ 358 → `inside`；
     `viewport.right=1000, textRight=900, textLeft=420` → need 258>100、vw=720−390=330<480 → compact：blockW(176)=222，need=186>100 → 720−318=402<480 → `whisper`；
     滞回（`textLeft=560`）：prev={shift:168, reserve:0}、need 算出 160 → 保持 168；`on=false` → `off`。
  2. `wrapLabel`：中文 13px 宽 100 → 每行 ≤7 字；英文不在单词中间断；超行末尾「…」。
  3. `semanticNest` / `nestOrder`：§9 第一行样例 → A.depth=0、B/C/D 的 parent=A、rel 分别 support/example/counter；`nestOrder` = [A,B,C,D]；无边时例证挂到前面最近的论点 / 理由。
  4. `shapePath` 与 `collapseAtLeft/collapseAtNode` 的路径**去掉数字后字符串完全相同**（CSS d 插值前提）；`strandPath` 与 `collapseStrand` 同理。
  5. `buildShapes`：同节点相邻两段（间距 20）合并为一块；间距 40 不合并；最右栏三块 → 三个 ribbon 形状、`t0` 依次相接、末块 `t1 ≈ port.y1`（±1）；非最右栏只出 `ribbon:false` 形状；不可见近邻成员出 stub。
  6. `buildStrands`：`expressed` 里的关系不出；「据」reverse；> 12 截断且碰焦点者优先；`noStrands` → 空。
- `tests/flow.patterns.test.cjs`（构造 GraphState：用 `createGraph`，照 `tests/m15v2.*` 里造图的写法）：§9 五个样例逐一断言版式、items 顺序 / 缩进（`x` 差 = INDENT 的倍数）、prims 存在性（`sp:` / `tk:` / `dot:` / `axis:` / `brk:` / `tick:` / `step:` / `link:` / `cap:` / `bus:` / `lead:`）、ports 数量；时间线 `y` 单调不重叠且 `height ≤ availH`；`parseTime`：「公元前221年」→ −221、「1945年8月」→ 1945.625、「19世纪」→ 1850、「2003-04」→ 2003.29、「春天」→ null。
- 验收：两套测试全绿；`node node_modules/typescript/bin/tsc --noEmit -p .` 为 0。

### 阶段 2：内核
- §4。验收：tsc 0；`node tests/m15v2.textrange.test.cjs`、`node tests/m15v2.lens.dom.test.cjs` 仍绿。

### 阶段 3：宿主 + 渲染器（先大纲树 / 论证图）
- §6、§7、§8 + i18n（en/ja；`node scripts/i18n-check.mjs`）。此阶段 `layoutFor` 里时间线 / 链 / 分层 / 对照可先走 `layoutTree`。
- `tests/flow.dom.test.cjs`（照 `tests/m15v2.lens.dom.test.cjs`：jsdom + StrictMode + 假内核 + 内存引擎 + 假模型；假内核实现 `setStructureTargets`（记录）与 `getStructureGeometry`（返回固定 boxes 与 `text`）；`viewportEl.getBoundingClientRect` stub；动效设为关）：
  1. 打开 → `[data-reading="1"] .flow-pill` 存在；`.flow-blend` 存在且 `style.mixBlendMode === "multiply"`（假阅读背景白）；
  2. `.flow-shapes path` 数 = 合并后的块数 + stub 数；每条有 `d` attribute，且 `d` 以 `M` 开头、含 `Q`（左侧圆角＝矩形段存在）；
  3. 假内核收到的 targets 覆盖全部 leafIds；关闭后收到 `[]`；
  4. 悬停某行 → 该节点形状 `fill` 指向 `-2` 档渐变，其它形状有 `is-dim`；
  5. 点有子节点的成员 → 出现 `kind="kid"` 项与 `.flow-actions`；再点 → 收起；
  6. 双击 → `goTo` 被调；出现「↩」；点它 → 回跳；
  7. `textLeft=560` → `shiftEl.style.transform === "translateX(-160px)"`；关闭后为空；
  8. `textLeft=420` → `gutterEl.style.flexBasis === "390px"`；关闭后 `"0px"`；
  9. 论证图样例 → 根论点项存在且其条 `fill` 为 accent 实色；`tk:` 路径的 `stroke-dasharray` 分别为空 / `1.5 2.5` / `3 2`；
  10. 页面里不存在 `.flow-slip`、`.mm2-focus`、任何 `position: fixed` 的卡片容器。
- 用户实机验收（Windows `npm run dev`，打开已有图谱的 EPUB）：点「结构图」→ 正文左移（或淡出重排）让出右侧；荧光笔式高亮从段落左端划过、在右缘不断开地流向节点；论证组能一眼看出论点 > 理由 / 证据 > 例证、反方被标出；翻页时高亮被吸进节点再从新页伸出铺开；关闭时结构收回、正文归位。

### 阶段 4：其余版式
- `layoutTimeline` / `layoutChain` / `layoutCompare` / 分层图接入 `layoutFor`；动效按 §8 覆盖新 prims（`draw` 线、光点、编号圆、色带、总线）。
- 测试：`tests/flow.patterns.test.cjs` 全绿；`tests/flow.dom.test.cjs` 增「时间线样例出现 `dot:`、`axis:`、`now`」「对照样例出现 2 个 `cap:` 与 2 个 `bus:`」。
- 用户实机验收：找一段以年代为主的章节 → 竖向时间轴、比例间隔、断层符号、阅读游标随翻页移动；一段操作步骤 → 编号与箭头；一段对比 → 并排栏与总线。

### 阶段 5：退役与文档
- §3 退役清单逐项删除（先 grep）；`AI_DEVELOPMENT_GUIDE.md` §8.1 登记新 D 号（下一个空闲号）、§9.5 更新、§4.2-17 删除 `win:lens` / `lens:*`；`MINDMAP-V2-IMPL-PLAN.md` 追加 `## 15. 结构流（取代 §14）` 一段指向本文。F21 进程间桥对账测试（grep `F21`）须仍通过（删通道要同步删文档点名）。
- 验收：`node tests/m15v2.*.test.cjs`（已删者除外）与 `node tests/flow.*.test.cjs` 全绿；tsc 0；`npm run build` ✓；F21 ✓。

---

## 11. 易错点（逐条核对）

1. **混合层隔离**：`.flow-blend` 直接挂 body；它和它的祖先都不能有 `transform` / `opacity` / `filter` / `will-change` / `isolation`，否则 `mix-blend-mode` 只在自己组内混合、文字会被盖住变色。动画只做在它**内部**的 path 上。
2. **高亮与流带必须是同一条路径**：不要拆成"矩形 + 流带"两个形状（相邻半透明形状接缝处会出现亮线或暗线）。
3. **渐变横向基准整场稳定**：`hlX0/hlX1` 只在版心或列位置真的变化时才变；不要按单个形状算。
4. **CSS `d` 插值要求命令序列一致**：所有形状都用 `shapePath`（含折叠态）、所有关系线用 `strandPath`；圆角半径变 0 不改变命令。
5. **attribute 与 style 的 `d` 都写**；`rect` / `circle` 几何用 style 写才能过渡；行用 `transform` 定位。
6. **不连续重排正文**：平移只用 `transform`；预留槽宽一步到位并用淡出遮住；不要给槽宽加过渡（每帧重排会卡）。
7. **预留保持**：决策用 `baseText`（未预留时的版心），否则预留后判定为"放得下"又撤销预留，来回抖。
8. **轮询签名**：没变就不 setState；跟踪滚动时只更新几何，不重建 layout。
9. **StrictMode**：effect 返回退订；`setState` 更新器必须纯（IMPL-PLAN §12-6 的坑）；`usePresence` 照抄判断「仍有 enter 项」。
10. **翻页模式的别页段落**：几何里中心 x 不在视口内的 box 必须丢弃。
11. **PDF**：无 `getStructureGeometry` / `setStructureTargets` → 不画高亮流带与关系线，节点列照常（竖向居中）；不报错。
12. **图谱页签覆盖正文**（`covered`）：走关闭编排；离开后走打开编排。
13. **颜色**：场景里的颜色都用探针解析成实色（`color-mix` / `var()` 不能直接进 SVG 渐变 stop 的 `stopColor` 以外的计算）；深浅按阅读背景判定。
14. **不要改**：AI 提示词、解析器、`material_map_*` 表、`selectPattern` 的规则表、`graphLocate` / `graphNodeAnchors` / `graphExpand` / `graphExplain` 的主进程实现。**不新增任何窗口 / preload 桥 / IPC。**
    （v3.1 例外：§12.3.4 对「对照」提示词做一处补充并升提示词版本，这是唯一允许的 AI 侧改动。）

---

## 12. v3.1 修订（2026-10-29 第四轮用户意见；与前文冲突处以本节为准）

用户意见：① 打开结构图自动收起左侧栏，展开左侧栏自动关闭结构图，并保证窗口最小宽度下结构图完整可见；② 缩进式层级不好看，换一种呈现；③ 对照版式应延续上下排列，做成「上一行一种观点、下一行另一种观点，右侧按维度（目的 / 路径 / 时间 / 姿态…）分列」的表格；④ 结构随滚动变化时要自然流畅，且不能过早切到下一部分。

### 12.1 侧栏联动与宽度保证

**Reader.tsx**（`lensOpen` / `sidebarOpen` / `setSidebarOpen` / `setRailAnimate` 均为现有状态，`setRailAnimate` 在 L663 附近）：
```ts
const sidebarBeforeLensRef = useRef<boolean | null>(null);
const lensClosedBySidebarRef = useRef(false);
// 打开结构图 → 记下侧栏原状态并收起（带滑动过渡）
useEffect(() => {
  if (!lensOpen) return;
  sidebarBeforeLensRef.current = sidebarOpen;
  lensClosedBySidebarRef.current = false;
  if (sidebarOpen) { setRailAnimate(true); setSidebarOpen(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [lensOpen]);
// 结构图开着时侧栏被展开（用户点「展开」、或「在完整图谱中打开」等任何途径）→ 关闭结构图
useEffect(() => {
  if (sidebarOpen && lensOpen) { lensClosedBySidebarRef.current = true; setLensOpen(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [sidebarOpen]);
// 结构图被用户关闭（按钮 / Esc）→ 侧栏原本开着就恢复
useEffect(() => {
  if (lensOpen || sidebarBeforeLensRef.current == null) return;
  const restore = sidebarBeforeLensRef.current && !lensClosedBySidebarRef.current;
  sidebarBeforeLensRef.current = null;
  if (restore) { setRailAnimate(true); setSidebarOpen(true); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [lensOpen]);
```
注意第三个 effect 恢复侧栏时会触发第二个 effect，但此时 `lensOpen` 已为 false，不会循环。

**宿主（StructureFlowHost）**：开场编排（§8.1）开始前先等侧栏收起完成：监听 `.reader-side-rail` 的 `transitionend`（`propertyName === "width"`），或 `max(var(--dur-panel), 0) + 60ms` 超时（读 `getComputedStyle(rail).transitionDuration`），先到为准；然后才量视口、决策 `planColumn`、执行平移 / 预留、播开场动画。侧栏本来就收着时不等。

**宽度保证**：
- 主窗口 `minWidth` 现为 1120（`electron/main.js` 约 L2200），**保持不变**；侧栏收起时视口宽 ≈ 窗宽，1120 下 `reserve` 方案正文仍有 `1120 − 390 ≥ 480`，结构图必然完整可见（用户在 980 宽下看到的截断来自不受此限的示例页面）。
- `planColumn` 增加**硬约束**：返回的方案必须满足 `plan.right ≤ viewport.right − 4`，否则继续往下一个方案退（最后是 `whisper`，它的 `barX ≤ viewport.right − 24`）。在 `tryLw` 里 `make(...)` 之后加：`if (p.right > vp.right - 4) return null`。
- 测试（加到 `tests/flow.layout.test.cjs`）：`viewport.left` 取 40（侧栏收起后只剩开关钮）、`viewport.right` 从 640 到 1920 每 40 取一档、`textLeft/right` 按版心 680 居中；每档断言 `plan.mode === "whisper" || plan.right <= viewport.right - 4`；且 `viewport.right = 1120` 时 `plan.mode !== "whisper"`。

### 12.2 层级的新呈现：「泳道 + 跨度条」（取代缩进 / 脊线 / 类型方框）

**意图**：标签**全部左对齐**，不缩进；层级改由「节点条所在的泳道」「跨度条」「字重字号」「行尾类型字」四件事表达。像 Sankey 里节点按列排开一样，每低一级，节点条向右挪一条泳道（6px）；上级节点的条在自己那一行是实心条，**再往下延伸成一根细而淡的跨度条**，一直覆盖到它最后一个下级的底部——一眼就能看出「这一段归它管」。流带落在各自泳道的条上，于是论点的流带落得最靠左、例证最靠右，层次也体现在流带的落点上。

```
 ▌ 从故事到数据库                         论点     ← 泳道 0，14px 600
 ┃  ▌ 消费者面向数据库                    命题     ← 泳道 1，13px 500
 ┃  ┃  ▌ 叙事与数据库分离                 理由     ← 泳道 2，13px 450
 ┃  ┃  ▌ 大叙事凋零                       证据
 ┃  ┃  ┆   绫波丽被拆解                   例证     ← 泳道 3，点状条，12px 400
 ┃  ┃  ▒ 叙事仍然在场                  ⟂ 反方     ← 斜纹条 + 跨度条上一个反方色缺口
 ↑  ↑ 跨度条（2px，35% 不透明）
```

**常量**（追加到 `FLOW`）：
```ts
LANE_DX: 6, LANES: 4, GROUP_GAP: 10, SPAN_W: 2, SPAN_A: 0.35, NOTCH_W: 7, NOTCH_H: 2,
```
`labelX = barX + BAR_MAX + LABEL_GAP`（＝barX+26），4 条泳道（0..3）的条都在 `[barX, barX+18+4]` 之内。

**泳道与字样**（取代 `TIER_STYLE` 的使用方式，`TIER_STYLE` 本身保留但不再用 `bar` 字段）：
```ts
export interface LaneStyle { barW: number; fs: number; lh: number; weight: number; tone: number }
export const LANE_STYLE: LaneStyle[] = [
  { barW: 5, fs: 14, lh: 19, weight: 600, tone: 96 },   // 泳道 0：论点 / 结论 / 命题 / 根论点
  { barW: 4, fs: 13, lh: 18, weight: 500, tone: 90 },   // 泳道 1
  { barW: 4, fs: 13, lh: 18, weight: 450, tone: 84 },   // 泳道 2
  { barW: 3, fs: 12, lh: 17, weight: 400, tone: 72 },   // 泳道 3
];
/** 泳道＝语义深度（semanticNest 的 depth；论证图有根论点时 +1），封顶 3。
 *  类型为例证 / 案例的节点至少落在泳道 2（即使没找到上级），保证「例证低于论点」在任何情况下都成立。 */
export function laneOf(depth: number, type: string, hasRoot: boolean): number {
  let lane = depth + (hasRoot ? 1 : 0);
  if (tierOf(type) === 2) lane = Math.max(lane, hasRoot ? 3 : 2);
  return Math.min(FLOW.LANES - 1, lane);
}
```
（`semanticNest` 的 depth 上限改为 3：把其中 `Math.min(2, d)` 改成 `Math.min(3, d)`、`d > 2` 改成 `d > 3`。）

**`layoutTree` 第 4–6 步替换为下面的写法**（第 1–3 步不变；`opt.chips`、`opt.spines` 两个参数删除，调用处一并删）：
```ts
  // ---- 4. 落位（标签恒在 labelX；节点条按泳道右移） ----
  let y = 0;
  const bars = new Map<string, { x: number; y: number; w: number; h: number; color: string; lane: number }>();
  const hasRoot = rootClaim;
  if (hasRoot) {
    const n = c.g.nodes[c.cut], st = LANE_STYLE[0];
    if (c.canBack) { out.items.push(item({ id: "back", nodeId: null, kind: "head", x: c.plan.labelX, y, w: c.plan.labelW, h: FLOW.BACK_H, lines: ["↩"], fs: 11, lh: 22, weight: 400, tone: 72 })); y += FLOW.BACK_H; }
    const lines = wrapLabel(n.title, st.fs, c.plan.labelW - FLOW.META_W, 2);
    const h = lines.length * st.lh + FLOW.ROW_PAD_Y * 2;
    out.items.push(item({ id: `n:${c.cut}`, nodeId: c.cut, kind: "node", x: c.plan.labelX, y, w: c.plan.labelW, h, lines,
      fs: st.fs, lh: st.lh, weight: st.weight, tone: st.tone, meta: String(n.type ?? "论点"), selected: c.cut === c.selectedId }));
    bars.set(c.cut, { x: c.plan.barX, y: y + 1, w: st.barW, h: h - 2, color: c.colors.accent, lane: 0 });
    y += h + FLOW.ROW_GAP;
  } else y = pushHeader(c, out, y);
  y = pushMore(c, out, y, "above");
  let prevLane = -1;
  for (const p of pre) {
    const n = nodeOf(c, p.id);
    const depth = p.kind === "kid" ? (bars.get(p.parentRow!)?.lane ?? 0) + 1 - (hasRoot ? 1 : 0) : (nest.get(p.id)?.depth ?? 0);
    const lane = laneOf(depth, String(n.type ?? ""), hasRoot);
    const st = LANE_STYLE[lane];
    if (prevLane >= 0 && lane === (hasRoot ? 1 : 0) && p.kind === "node") y += FLOW.GROUP_GAP;   // 顶层组之间多留一点
    prevLane = lane;
    const lines = wrapLabel(n.title, st.fs, c.plan.labelW - FLOW.META_W, p.kind === "kid" || opt.compact ? 1 : c.maxLines0);
    const labelH = lines.length * st.lh + FLOW.ROW_PAD_Y * 2;
    const h = Math.round(Math.max(labelH + (p.id === c.selectedId ? c.inlineH : 0), p.value * k));
    const reading = p.id === c.readingId;
    const t = tierOf(String(n.type ?? ""));
    out.items.push(item({ id: `n:${p.id}`, nodeId: p.id, kind: p.kind, x: c.plan.labelX, y, w: c.plan.labelW, h: labelH,
      lines, fs: st.fs, lh: st.lh, weight: st.weight, tone: st.tone,
      meta: metaOf(c, p.id, shown, true), reading, selected: p.id === c.selectedId,
      hasKids: kidsOf(c, p.id).length > 0, expanded: p.id === c.expandedId,
      chip: t === "counter" ? { text: "⟂", style: "counter" } : null }));
    const bx = c.plan.barX + lane * FLOW.LANE_DX, by = y + 1, bh = Math.max(2, labelH - 2);
    const bw = reading ? st.barW + 1 : st.barW;
    const expanded = p.id === c.expandedId && kidsOf(c, p.id).length > 0;
    if (t === 2 && !reading) {
      // 例证：点状条（圆头短线串）
      out.prims.push({ k: "path", id: `bar:${p.id}`, d: `M${bx + bw / 2},${by + 1.5} V${by + bh - 1.5}`, stroke: p.color, strokeW: bw, dash: "0 4.5", layer: "over" });
    } else {
      out.prims.push({ k: "rect", id: `bar:${p.id}`, x: bx, y: by, w: bw, h: bh, rx: 1.5, fill: reading ? c.colors.accent : p.color, hatch: t === "counter" && !reading, layer: "over" });
    }
    bars.set(p.id, { x: bx, y: by, w: bw, h: bh, color: p.color, lane });
    if (!expanded) { out.ports.push({ nodeId: p.id, x: bx, y0: by, y1: by + bh, color: p.color }); out.leafIds.push(p.id); }
    if (reading) out.readingY = y + labelH / 2;
    y += h + FLOW.ROW_GAP;
  }
  y = pushMore(c, out, y, "below");
  out.height = y - FLOW.ROW_GAP;
  // ---- 5. 跨度条：每个有下级（语义下级或展开的结构子节点）的节点，从自己条底延伸到最后一个下级条底 ----
  const under = new Map<string, string[]>();      // 上级 → 直接下级（按 pre 顺序）
  for (const p of pre) {
    const up = p.kind === "kid" ? p.parentRow : (nest.get(p.id)?.parent ?? (hasRoot ? c.cut : null));
    if (up && bars.has(up)) { const l = under.get(up) ?? []; l.push(p.id); under.set(up, l); }
  }
  const lastDesc = (id: string): string => { const l = under.get(id); return l && l.length ? lastDesc(l[l.length - 1]) : id; };
  for (const [up, list] of under) {
    const U = bars.get(up)!, L = bars.get(lastDesc(list[list.length - 1]))!;
    const sx = U.x + (U.w - FLOW.SPAN_W) / 2;
    out.prims.push({ k: "rect", id: `span:${up}`, x: sx, y: U.y + U.h + 2, w: FLOW.SPAN_W, h: Math.max(0, L.y + L.h - (U.y + U.h + 2)),
      rx: 1, fill: U.color, opacity: FLOW.SPAN_A, layer: "under" });
    // 反方缺口：直接下级里的反方，在上级跨度条上画一道反方色横缺口，对准该反方条的中线
    for (const id of list) if (tierOf(String(nodeOf(c, id)?.type ?? "")) === "counter") {
      const B = bars.get(id)!;
      out.prims.push({ k: "rect", id: `notch:${id}`, x: sx - (FLOW.NOTCH_W - FLOW.SPAN_W) / 2, y: B.y + B.h / 2 - FLOW.NOTCH_H / 2,
        w: FLOW.NOTCH_W, h: FLOW.NOTCH_H, fill: c.colors.counter, layer: "over" });
    }
    // 版式本身已表达的从属关系：不再画关系线
    for (const id of list) {
      for (const e of c.g.outEdges[id] ?? []) if (e.to === up) out.expressed.push(edgeKey(id, up, e.code));
      for (const e of c.g.inEdges[id] ?? []) if (e.from === up) out.expressed.push(edgeKey(up, id, e.code));
    }
  }
  return out;
```
说明：
- `layoutTree` 第 2 步 `add(...)` 里 `lw` 一律用 `c.plan.labelW - FLOW.META_W`（去掉 `depth * FLOW.INDENT`）；`chipH` 一律 0。
- 删除旧的「展开括弧」（`brk:`）与「脊线」（`sp:` / `tk:` / `tkx:`）；展开的结构子节点由跨度条表达。
- 分层图（`layered`）同样走这套：泳道＝因果层号（`causalLayers` 的 depth，封顶 3），不画跨度条（因果靠带箭头的关系线），即调用时跳过第 5 步——给 `layoutTree` 的 `opt` 增 `spans: boolean`，`layered` 传 false，其余传 true。
- **行尾类型字**（`meta`）：泳道 0 的类型字用 `fg 60% / 500`，其余 `fg 42% / 400`；反方节点的类型字用反方色，并在前面加 `⟂`（`chip.style === "counter"` 时，`.flow-meta` 前置该符号、改色；不再渲染任何方框标签）。
- **悬停上级**：悬停有跨度条的节点时，它所有下级的高亮也提到 focus 档（`tone 1`），自己到 hover 档；跨度条不透明度 0.35 → 0.7（160ms）。实现：宿主算 `hoverSet = {hoverId} ∪ 其全部下级`，`buildShapes` 的 `tone()` 改为：`id === hoverId ? 2 : hoverSet.has(id) || id === focusId ? 1 : 0`；`is-dim` 只加在 `hoverSet` 之外的形状上。

**§7.4 修改**：删除 `.flow-chip` 整条；`.flow-meta` 增「`[data-lane="0"] .flow-meta { color: fg 60%; font-weight: 500 }`」「`[data-counter="1"] .flow-meta { color: counter }`」；`.flow-item` 增 `data-lane` / `data-counter` 两个属性（渲染器从 item 上取：给 `FlowItem` 增可选字段 `lane?: number`，`layoutTree` 推 item 时写入 `lane`；`counter` 由 `chip?.style === "counter"` 推出）。

**动效补充**：泳道变化（例如展开后同一节点的条换泳道）走 `x` 过渡 240ms；跨度条进场＝`scaleY 0 → 1`，`transform-origin: 50% 0`（自上而下长出），在所属上级的条长出后 80ms 开始，时长 320 / ease-out；退场反向 180 / ease-in。

### 12.3 对照版式 → 「对照表」（取代 §5.5.4）

**意图**：延续正文 → 结构的上下排列：**每个被对照的对象占一行**（上一行观点 A，下一行观点 B），流带照常落在每行最左的节点条上；行的右边按「维度」分列（目的 / 路径 / 时间 / 姿态…），表头一行给维度名，单元格是该对象在这个维度上的具体内容。表格不画边框，只靠对齐、极淡的行分隔线和隔列底色。

```
 对照 · 两种消费观                目的        路径        姿态
 ──────────────────────────────────────────────────────────
 ▌ 故事消费          追问作品    穿过作品    读者
                     背后意义    抵达叙事    
 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 ▌ 数据库消费        即时取用    直接面向    动物化的
                     情感素材    数据库      消费者
```

#### 12.3.1 维度提取（纯函数，照抄）

```ts
export interface CompareTable {
  dims: { key: string; label: string }[];
  rows: { id: string; cells: ({ id: string; text: string } | null)[] }[];
  how: "named" | "paired" | "ordinal";
}
const DIM_RE = /^\s*([^：:，,。\s]{1,8})\s*[：:]\s*(.+)$/;
export function compareTable(g: GraphState, members: string[], maxDims = 6): CompareTable {
  const kids = members.map((m) => childrenOf(g, m).filter((k) => g.nodes[k]));
  const all = kids.flat();
  // ① 命名维度：「维度：内容」，且至少一半子节点符合
  const parsed = new Map<string, { dim: string; text: string }>();
  for (const k of all) { const m = String(g.nodes[k].title).match(DIM_RE); if (m) parsed.set(k, { dim: m[1].trim(), text: m[2].trim() }); }
  if (all.length && parsed.size >= all.length / 2) {
    const dims: string[] = [];
    for (const k of all) { const d = parsed.get(k)?.dim; if (d && !dims.includes(d)) dims.push(d); }
    const use = dims.slice(0, maxDims);
    return { how: "named", dims: use.map((d) => ({ key: d, label: d })),
      rows: members.map((m, i) => ({ id: m, cells: use.map((d) => {
        const k = kids[i].find((x) => parsed.get(x)?.dim === d);
        return k ? { id: k, text: parsed.get(k)!.text } : null;
      }) })) };
  }
  // ② 配对：子节点之间的「比」关系把它们放进同一列；第一个对象的子节点定列序
  const slotOf = new Map<string, number>(); let slots = 0;
  kids.forEach((list, i) => list.forEach((k) => {
    if (slotOf.has(k)) return;
    let s = -1;
    for (const e of g.outEdges[k] ?? []) if (e.code === "比" && slotOf.has(e.to)) { s = slotOf.get(e.to)!; break; }
    if (s < 0) for (const e of g.inEdges[k] ?? []) if (e.code === "比" && slotOf.has(e.from)) { s = slotOf.get(e.from)!; break; }
    if (s < 0 || kids[i].some((o) => o !== k && slotOf.get(o) === s)) s = slots++;
    slotOf.set(k, s);
  }));
  const paired = all.some((k) => (g.outEdges[k] ?? []).some((e) => e.code === "比"));
  const n = Math.min(maxDims, paired ? slots : Math.max(0, ...kids.map((l) => l.length)));
  const colKids = (j: number) => kids.map((list) => paired ? list.find((k) => slotOf.get(k) === j) : list[j]);
  const dims = Array.from({ length: n }, (_, j) => {
    const types = colKids(j).filter(Boolean).map((k) => String(g.nodes[k!].type ?? ""));
    const same = types.length > 0 && types.every((t) => t === types[0]) && types[0] !== "其他";
    return { key: `d${j}`, label: same ? types[0] : String(j + 1) };
  });
  return { how: paired ? "paired" : "ordinal", dims,
    rows: members.map((m, i) => ({ id: m, cells: dims.map((_, j) => { const k = colKids(j)[i]; return k ? { id: k, text: String(g.nodes[k].title) } : null; }) })) };
}
```

#### 12.3.2 布局（取代 `layoutCompare`；成员 2–4 个用对照表，>4 个退回 `tree`——`patternFor` 里 `FLOW.CMP_MAX` 改为 4）

常量（追加到 `FLOW`）：`CMP_NAME_W: 76, CMP_CELL_MIN: 84, CMP_CELL_MAX: 132, CMP_CELL_LINES: 4, CMP_HEAD_H: 22, CMP_ROW_PAD: 6, CMP_MAX_W: 540`。

```ts
export function layoutCompareTable(c: LayoutCtx & { maxW: number; cmpPage: number }): PatternLayout & { cmpPages: number } {
  const out = newLayout();
  const T = compareTable(c.g, c.members);
  let y = pushHeader(c, out, 0);
  const x0 = c.plan.labelX;
  const W = Math.max(c.plan.labelW, Math.min(FLOW.CMP_MAX_W, c.maxW));          // 表可以比普通标签区宽，但不越出视口
  const room = W - FLOW.CMP_NAME_W;
  const perPage = Math.max(1, Math.floor(room / FLOW.CMP_CELL_MIN));
  const stacked = perPage < 2 && T.dims.length >= 2;                              // 只放得下 1 列：改「行内维度」式
  const pages = stacked ? 1 : Math.max(1, Math.ceil(T.dims.length / perPage));
  const page = Math.min(Math.max(0, c.cmpPage), pages - 1);
  const vis = stacked ? T.dims.map((_, j) => j) : T.dims.map((_, j) => j).slice(page * perPage, page * perPage + perPage);
  const cellW = stacked ? room : Math.min(FLOW.CMP_CELL_MAX, Math.floor(room / Math.max(1, vis.length)));
  // 表头
  if (!stacked) {
    vis.forEach((j, v) => out.items.push(item({ id: `dim:${T.dims[j].key}`, nodeId: null, kind: "head", x: x0 + FLOW.CMP_NAME_W + v * cellW, y,
      w: cellW - 8, h: FLOW.CMP_HEAD_H, lines: wrapLabel(T.dims[j].label, 11, cellW - 8, 1), fs: 11, lh: FLOW.CMP_HEAD_H, weight: 500, tone: 56 })));
    if (pages > 1) out.items.push(item({ id: "cmp:pager", nodeId: null, kind: "more", x: x0 + W - 64, y: y - FLOW.HEADER_GAP - 16, w: 64, h: 16,
      lines: [`${page + 1} / ${pages}`], fs: 11, lh: 16, weight: 400, tone: 56, meta: "pager" }));
    y += FLOW.CMP_HEAD_H;
    out.prims.push({ k: "path", id: "cmp:headline", d: `M${x0},${y} H${x0 + W}`, stroke: c.colors.fg, strokeW: 1, opacity: 0.18, layer: "under" });
    y += 4;
    // 隔列底色
    vis.forEach((j, v) => { if (v % 2 === 1) out.prims.push({ k: "rect", id: `band:${j}`, x: x0 + FLOW.CMP_NAME_W + v * cellW - 4, y: y - 4, w: cellW, h: 0, fill: c.colors.fg, opacity: 0.035, layer: "under" }); });
  }
  const bandIds = out.prims.filter((p) => p.id.startsWith("band:")).map((p) => p.id);
  const yTop = y;
  T.rows.forEach((r, i) => {
    const n = nodeOf(c, r.id), color = c.colorOf.get(r.id)!, reading = r.id === c.readingId;
    const nameLines = wrapLabel(n.title, 13, FLOW.CMP_NAME_W - 8, 3);
    const cellLines = vis.map((j) => {
      const cell = r.cells[j];
      if (stacked) return cell ? wrapLabel(cell.text, 12, room - 8 - 40, 2) : ["—"];
      return cell ? wrapLabel(cell.text, 12, cellW - 10, FLOW.CMP_CELL_LINES) : ["—"];
    });
    const nameH = nameLines.length * 18;
    const cellsH = stacked ? cellLines.reduce((a, l) => a + l.length * 17 + 4, 0) : Math.max(...cellLines.map((l) => l.length * 17));
    const h = Math.max(nameH, stacked ? nameH + 4 + cellsH : cellsH) + FLOW.CMP_ROW_PAD * 2;
    out.items.push(item({ id: `n:${r.id}`, nodeId: r.id, kind: "node", x: x0, y: y + FLOW.CMP_ROW_PAD, w: stacked ? W : FLOW.CMP_NAME_W - 4, h: nameH,
      lines: nameLines, fs: 13, lh: 18, weight: 600, tone: 92, reading, selected: r.id === c.selectedId, lane: 0 }));
    let sy = y + FLOW.CMP_ROW_PAD + nameH + 4;
    vis.forEach((j, v) => {
      const cell = r.cells[j];
      if (stacked) {
        out.items.push(item({ id: cell ? `n:${cell.id}` : `cell:${r.id}:${j}`, nodeId: cell?.id ?? null, kind: "kid", x: x0 + 40, y: sy, w: room - 48, h: cellLines[v].length * 17,
          lines: cellLines[v], fs: 12, lh: 17, weight: 400, tone: cell ? 80 : 30, time: null, meta: "" }));
        out.items.push(item({ id: `dl:${r.id}:${j}`, nodeId: null, kind: "head", x: x0, y: sy, w: 36, h: 17, lines: [T.dims[j].label], fs: 11, lh: 17, weight: 500, tone: 50 }));
        sy += cellLines[v].length * 17 + 4;
      } else {
        out.items.push(item({ id: cell ? `n:${cell.id}` : `cell:${r.id}:${j}`, nodeId: cell?.id ?? null, kind: "kid", x: x0 + FLOW.CMP_NAME_W + v * cellW, y: y + FLOW.CMP_ROW_PAD,
          w: cellW - 10, h: cellLines[v].length * 17, lines: cellLines[v], fs: 12, lh: 17, weight: 400, tone: cell ? 80 : 30 }));
      }
    });
    const by = y + 2, bh = h - 4;
    out.prims.push({ k: "rect", id: `bar:${r.id}`, x: c.plan.barX, y: by, w: reading ? 6 : 5, h: bh, rx: 1.5, fill: reading ? c.colors.accent : color, layer: "over" });
    out.ports.push({ nodeId: r.id, x: c.plan.barX, y0: by, y1: by + bh, color });
    out.leafIds.push(r.id);
    if (reading) out.readingY = y + h / 2;
    y += h;
    if (i + 1 < T.rows.length) out.prims.push({ k: "path", id: `rowline:${r.id}`, d: `M${x0},${y} H${x0 + W}`, stroke: c.colors.fg, strokeW: 1, dash: "2 3", opacity: 0.12, layer: "under" });
  });
  // 隔列底色高度补齐到表底
  for (const id of bandIds) { const p = out.prims.find((q) => q.id === id) as Extract<FlowPrim, { k: "rect" }>; p.h = y - yTop + 4; }
  // 「比」关系已由「同列」表达
  for (const r of T.rows) for (const cell of r.cells) if (cell) for (const e of c.g.outEdges[cell.id] ?? []) if (e.code === "比") out.expressed.push(edgeKey(cell.id, e.to, "比"));
  for (const a of c.members) for (const b of c.members) out.expressed.push(edgeKey(a, b, "比"));
  if (c.selectedId && T.rows.some((r) => r.id === c.selectedId)) y += c.inlineH;   // 动作行放在表底
  out.height = y;
  out.noStrands = true;
  return { ...out, cmpPages: pages };
}
```
- `LayoutCtx` 增 `maxW: number`（＝`viewport.right − FLOW.PAD_R − plan.labelX`，宿主传入）与 `cmpPage: number`（宿主状态，换组时归 0）。`FlowItem` 增 `lane?: number`（§12.2）。
- `layoutFor` 的 `case "compare"` 改为 `return layoutCompareTable(c)`。
- **单元格 ↔ 正文**：单元格项带 `nodeId`（子节点 id）。悬停单元格 → `hoverId = 单元格节点`：宿主为它取锚（`nodeAnchors`），`buildShapes` 里不在 ports 中的悬停节点只出**矩形段**（`ribbon:false`、hover 档），也就是正文里那一小段被荧光笔加深——不额外出流带（流带属于所在行）。实现：`buildShapes` 增参数 `extra: { nodeId: string; color: string }[]`，对这些节点的 boxes 只推 `ribbon:false` 形状；`setStructureTargets` 的 targets 同时包含悬停单元格的锚。
- **翻页器**：`cmp:pager` 项点击左半 = 上一页、右半 = 下一页（`onEvent({kind:"action", name:"cmpPrev"|"cmpNext"})`）；换页时可见列的单元格做 `translateX(∓16px) + opacity` 交叉（离场 160 / ease-in，进场 220 / ease，延迟 60）。

#### 12.3.3 对照表视觉（追加到 §7.4）
| 元素 | 规格 |
|---|---|
| 表头维度名 | 11px / 500 / fg 56%，`letter-spacing .06em`，与单元格左对齐 |
| 表头下线 | 1px，fg 18% |
| 对象名（行首） | 13px / 600 / fg 92%，≤3 行；阅读行套 `.flow-pill` |
| 单元格 | 12px / 17px / fg 80%，≤4 行，超出「…」；空格子「—」fg 30% |
| 行分隔 | 1px 点线 `2 3`，fg 12% |
| 隔列底色 | 偶数可见列 fg 3.5% 底 |
| 悬停单元格 | 文字 fg 100%；对应正文段高亮升到 hover 档 |
| 行尾节点条 | 5px（阅读 6px、主题色），高度＝整行 |

动效：开场时表头先出（opacity 200），行按 `stagger(i,60,180)` 自上而下展开（`clip-path: inset(0 0 100% 0) → inset(0)`，320 / ease-out），单元格在本行展开后按列 `stagger(j,30,120)` 淡入（200）。

#### 12.3.4 AI 侧补充（唯一的提示词改动）

对照表最好用「命名维度」。现有行协议对此没有要求，模型常把对照子节点命名为「容量约七个组块」这样的句子——界面只能退回「配对 / 序号」两种推断（仍然能排成表，只是表头是类型名或序号）。为让表头稳定地是「目的 / 路径 / 时间 / 姿态」这类维度名，做一处提示词补充：

1. `electron/prompts.js` 的 `MM_V2_LINE_SPEC`，在 `- {版式}：…` 这一行**之后**追加一行：
   ```
   - {对照} 组的约定：被对照的每个对象各自的子节点，标题一律写成「维度：内容」（维度 2–4 字，如 目的：追问作品意义），各对象用同一组维度名、同样顺序；对应子节点之间标 &比。
   ```
2. 同文件 `MATERIAL_MAP_OUTLINE_PROMPT` 的「示例三 对照」改为（块号不变）：
   ```
   1 [对比] 短时记忆与长时记忆 @1-8 + {对照}
   1.1 [分类] 短时记忆 @1-4 +
   1.1.1 [定义] 容量：约七个组块 @2 .
   1.1.2 [因果] 遗忘：不复述则数秒内消退 @3-4 .
   1.2 [分类] 长时记忆 @5-8 +
   1.2.1 [定义] 容量：几乎没有上限 @6 . &比1.1.1
   1.2.2 [因果] 遗忘：多源于提取失败 @7-8 . &比1.1.2
   ```
3. **升版本**：`electron/db.js` 约 L3089 的 `MM2_TARGETS` 中 `material-map-outline` 与 `material-map-expand` 由 1 改为 2，对应播种名「导图框架 v1」「导图深挖 v1」改为「导图框架 v2」「导图深挖 v2」（`MAX(version) < 目标` 即补播新行，读取取最高版——与 L3062 起 v48 段的写法一致）。`electron/mindmapV2Prompts.js` 的 `PROMPT_VERSION` 保持 1（它只是缺省回退值）。
4. 影响面：缓存键已含 system 文本（`mindmapEngineV2.js` L514–518），新提示词只影响之后的新调用；已生成的图不变，界面靠 12.3.1 的②③兜底。解析器不用改（标题里的全角冒号是普通字符，`mindmapOutline.js` L70 只剥 `@` 区间）。用户若在设置里改写过这两个模板，以用户版本为准（现有机制）。
5. 必须同步改的测试：`tests/m15v2.dbstatic.test.cjs` L60 与 `tests/m15v2.db.test.cjs` L58 里的模板名 / 版本断言；`tests/m15v2.prompts.test.cjs`（few-shot 喂解析器须 100% 接受）跑一遍确认示例三仍被接受。

### 12.4 滚动时的结构切换：「注意力判定 + 邻组预览」（取代 §6.1 的 `readingId` 求法与 §6.2-7 的 `cut`）

**问题根因**：现有定位只取一个探针——视口**最上方**可见段落（`getReadingProbe`）。用户的目光通常在视口中上部偏下，往下滚时最上面那一行一跨进下一部分，结构就整组换掉，而用户还在读本部分靠下的段落。

**新做法**：
1. **多点取样**：在视口内按阅读顺序取 4 个点，位置与权重固定为 `12% : 0.10`、`38% : 0.50`、`62% : 0.28`、`88% : 0.12`——38% 处是「注意力线」（大多数人阅读时目光所在的高度）。双栏翻页时把两栏看成先左后右的一条长带，4 个点按这条长带的比例分布。
2. **主导 + 驻留才切组**：当前这一组只要还占着注意力线附近，就不换；新的一组必须真正成为主导、并稳定一会儿才换。
3. **邻组预览**：视口里同时出现两部分时，主体仍是当前组，下一部分（或上一部分）以「预览」形式缩小挂在列的下方（或上方），它的段落照样有高亮和流带——不让任何可见段落"无处可去"。切换发生时，预览**原地长大**成主体，旧主体**原地缩小**成另一侧的预览：同一个节点在前后两种状态里是同一个元素，只做位移和缩放过渡，看起来像结构在顺着滚动方向滑动，而不是整页替换。

#### 12.4.1 内核：多点探针（foliate 实现；PDF 不实现时退回单探针）

`kernel.ts` 追加：
```ts
/** 结构流：按阅读顺序在视口内取样（frac∈[0,1]，双栏时先左栏后右栏） */
getReadingProbes?(fracs: number[]): { frac: number; unitAnchor: string; text: string }[];
```
`adapter.ts`：
```ts
getReadingProbes(fracs) {
  const vr = hostEl.getBoundingClientRect();
  const geo = lastGeometryText;   // 最近一次 getStructureGeometry 的 columns；没有则视为单栏 [vr.left+0.2w, vr.right-0.2w]
  const cols = geo && geo.length ? geo : [{ left: vr.left + vr.width * 0.2, right: vr.right - vr.width * 0.2 }];
  return fracs.map((f) => {
    const v = Math.min(0.999, Math.max(0, f)) * cols.length;
    const col = cols[Math.floor(v)], fy = v - Math.floor(v);
    const x = (col.left + col.right) / 2, y = vr.top + fy * vr.height;
    for (const [index, doc] of docs) {
      const fr = doc.defaultView?.frameElement?.getBoundingClientRect(); if (!fr) continue;
      if (x < fr.left || x > fr.right || y < fr.top || y > fr.bottom) continue;
      const el = doc.elementFromPoint(x - fr.left, y - fr.top);
      const block = (el?.closest?.(BLOCK_SEL) ?? null) as Element | null;
      if (!block) continue;
      const sections = (view.book?.sections ?? []) as { id?: string; href?: string }[];
      const unitAnchor = String(sections[index]?.id ?? sections[index]?.href ?? "");
      const text = String(block.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
      if (unitAnchor && text) return { frac: f, unitAnchor, text };
    }
    return { frac: f, unitAnchor: "", text: "" };
  });
},
```
（`lastGeometryText`：在 `getStructureGeometry` 末尾把 `columns` 存一份；坐标换算若与 `getSelectionGeometryFromContents` 不同，以后者为准。翻页模式下若 `elementFromPoint` 取到的不是当前页内容——例如 foliate 用滚动容器偏移 iframe——全部点都会落空，此时宿主退回单探针，见 12.4.3。）

#### 12.4.2 纯函数 `decideAttention`（`layout.ts`，照抄）

```ts
export const ATTN = {
  FRACS: [0.12, 0.38, 0.62, 0.88], W: [0.10, 0.50, 0.28, 0.12],
  SWITCH: 0.6,      // 新组得分 ≥ 0.6（注意力线 + 至少一个邻点）且旧组 ≤ LEAVE → 立刻切
  LEAVE: 0.25,
  HOLD: 0.5,        // 或：新组得分 ≥ 0.5 且持续 DWELL_MS、滚动已停 → 切
  DWELL_MS: 600, NODE_DWELL_MS: 250, PEEK_MIN: 0.1,
};
export interface AttnSample { frac: number; nodeId: string | null; chain: string[] }   // chain：根 → 节点（graphLocate 的 chain）
export interface AttnState { groupId: string | null; readingId: string | null; candGroup: string | null; candSince: number; candNode: string | null; nodeSince: number }
export interface AttnResult extends AttnState { peek: { groupId: string; side: "above" | "below" } | null; switched: "" | "down" | "up" }
const groupOfChain = (chain: string[]) => (chain.length >= 2 ? chain[chain.length - 2] : ROOT_ID);
/** 样本是否落在 G 管辖之下：G 是 ROOT_ID 或在其 chain 里（且不是节点本身） */
const under = (s: AttnSample, G: string) => !!s.nodeId && (G === ROOT_ID || s.chain.slice(0, -1).includes(G));
/** 样本在 G 下的「成员」：chain 里紧跟 G 的那个 */
const memberIn = (s: AttnSample, G: string) => { if (!s.nodeId) return null; const i = G === ROOT_ID ? -1 : s.chain.indexOf(G); return s.chain[i + 1] ?? null; };
export function decideAttention(samples: AttnSample[], prev: AttnState, now: number, o: { paged: boolean; idle: boolean }): AttnResult {
  const W = (f: number) => ATTN.W[ATTN.FRACS.indexOf(f)] ?? 0;
  const score = (G: string) => samples.reduce((a, s) => a + (under(s, G) ? W(s.frac) : 0), 0);
  // 候选组：各样本自己的最深组，按得分取最高
  const cands = new Map<string, number>();
  for (const s of samples) if (s.nodeId) { const G = groupOfChain(s.chain); cands.set(G, (cands.get(G) ?? 0) + W(s.frac)); }
  const best = [...cands.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  let st: AttnState = { ...prev };
  let switched: AttnResult["switched"] = "";
  const cur = prev.groupId;
  const curScore = cur ? score(cur) : 0;
  if (!cur || (curScore === 0 && best)) { st.groupId = best; }                       // 首次 / 旧组已完全离开视口
  else if (best && best !== cur && !(best !== ROOT_ID && cur !== ROOT_ID && samples.some((s) => s.chain.includes(cur) && s.chain.includes(best)) && score(best) <= curScore)) {
    const bs = score(best);
    if (bs >= ATTN.SWITCH && curScore <= ATTN.LEAVE) st.groupId = best;
    else if (bs >= ATTN.HOLD && bs > curScore) {
      if (prev.candGroup !== best) { st.candGroup = best; st.candSince = now; }
      else if ((o.paged || o.idle) && now - prev.candSince >= (o.paged ? 0 : ATTN.DWELL_MS)) st.groupId = best;
    } else { st.candGroup = null; }
  } else st.candGroup = null;
  if (st.groupId !== cur && cur && st.groupId) {
    const meanF = (G: string) => { const l = samples.filter((s) => under(s, G)); return l.length ? l.reduce((a, s) => a + s.frac, 0) / l.length : 0.5; };
    switched = meanF(st.groupId) >= meanF(cur) ? "down" : "up";
    st.candGroup = null;
  }
  // 阅读节点：注意力线样本优先，否则离 38% 最近的、在本组下的样本；节点变化需驻留（翻页模式不需要）
  const G = st.groupId;
  let node: string | null = null;
  if (G) {
    const inG = samples.filter((s) => under(s, G)).sort((a, b) => Math.abs(a.frac - 0.38) - Math.abs(b.frac - 0.38));
    node = inG.length ? memberIn(inG[0], G) : null;
  }
  if (switched || !prev.readingId || o.paged) { st.readingId = node; st.candNode = null; }
  else if (node && node !== prev.readingId) {
    if (prev.candNode !== node) { st.candNode = node; st.nodeSince = now; }
    else if (now - prev.nodeSince >= ATTN.NODE_DWELL_MS) { st.readingId = node; st.candNode = null; }
  } else st.candNode = null;
  // 邻组预览：当前组之外得分最高、且 ≥ PEEK_MIN 的组
  let peek: AttnResult["peek"] = null;
  if (G) {
    const other = [...cands.entries()].filter(([g]) => g !== G && !samples.some((s) => s.chain.includes(G) && s.chain.includes(g) && under(s, G)))
      .sort((a, b) => b[1] - a[1])[0];
    if (other && other[1] >= ATTN.PEEK_MIN) {
      const fOf = (g: string) => { const l = samples.filter((s) => s.nodeId && groupOfChain(s.chain) === g); return l.reduce((a, s) => a + s.frac, 0) / Math.max(1, l.length); };
      const fG = samples.filter((s) => under(s, G)).reduce((a, s, _, arr) => a + s.frac / arr.length, 0);
      peek = { groupId: other[0], side: fOf(other[0]) >= fG ? "below" : "above" };
    }
  }
  return { ...st, peek, switched };
}
```
要点（便于自查）：
- **先核对 `chain` 的格式**：本函数假定 `graphLocate` 返回的 `chain` 从**顶层节点**开始、以该节点结束、**不含** `ROOT_ID`（顶层节点的组＝`ROOT_ID`）。实现前到 `electron/mindmapEngineV2.js` 的 `graphLocate` 核对；若它包含书根或 `ROOT_ID`，在宿主里先把这些去掉再传入。
- 样本落在当前组的**更深处**（当前组某成员的子孙）仍算当前组——不因为读到了更细的一层就换组；此时阅读节点＝当前组里包含它的那个成员（必要时宿主把该成员设为 `expandedId`，让细一层在列里展开，而不是整组替换）。
- 「旧组完全离开视口」（得分 0）时立即切，避免卡在一个已看不见的组上。
- 翻页模式不做时间驻留（翻页本身是离散的），但仍要求主导阈值——一页上半是上一部分的结尾、下半是下一部分的开头时，以注意力线所在的那部分为主，另一部分做预览。

#### 12.4.3 宿主接线（改 `useStructureFlow`）

- **取样节奏**：`relocate` 触发后，滚动中每 `250ms` 至多取样一次（尾随节流），停下 `TRACK_IDLE_MS` 后再取一次（`idle=true`）；翻页模式在 `TURN_RESAMPLE_MS` 后取一次。
- **定位**：`probes = kernel.getReadingProbes?.(ATTN.FRACS)`；对每个有 `text` 的探针调 `mindmapV2Api.locate({ documentId, unitAnchor, text })`（`Promise.all`，同 `unitAnchor+text` 去重；零 AI、主进程本地计算），得 `{ nodeId, chain }`。若 `getReadingProbes` 不存在或全部落空：退回现有单探针 `getReadingProbe` 的结果，当作 `frac=0.38` 的唯一样本（行为与 v3 相同，只是不再有邻组预览）。
- **状态**：`attnRef`（`AttnState`）由 `decideAttention` 推进；`readingId = attn.readingId`；`cut = attn.groupId`（替代 `graph.nodes[readingId].parentId`）；`peek = attn.peek`；`switched` 非空时本次场景的 `motion` 设为 `conveyor-down` / `conveyor-up`。
- **原有「重定位」逻辑**（`doLocate` 里「已送完却定位不到→重送一次」）保持：只要有任一探针 `ready:false` 就按原逻辑处理。

#### 12.4.4 邻组预览的布局

```ts
export const PEEK = { MAX_ROWS: 4, SCALE: 0.86, TONE: 55, GAP: 18, ROW_H: 22 };
export function layoutPeek(c: LayoutCtx, groupId: string, side: "above" | "below"): PatternLayout {
  const out = newLayout();
  const title = groupId === ROOT_ID ? c.header : String(c.g.nodes[groupId]?.title ?? "");
  const kids = childrenOf(c.g, groupId).filter((k) => c.g.nodes[k]);
  const show = kids.slice(0, PEEK.MAX_ROWS);
  let y = 0;
  // 分隔：一条 24px 发丝线 + 下一部分标题（11px fg 45%）
  out.prims.push({ k: "path", id: `peekline:${groupId}`, d: `M${c.plan.labelX},${y + 6} H${c.plan.labelX + 24}`, stroke: c.colors.fg, strokeW: 1, opacity: 0.25, layer: "under" });
  out.items.push(item({ id: `n:${groupId}`, nodeId: groupId, kind: "head", x: c.plan.labelX + 30, y, w: c.plan.labelW - 30, h: 14,
    lines: wrapLabel(title, 11, c.plan.labelW - 30, 1), fs: 11, lh: 14, weight: 500, tone: 45, meta: side === "below" ? "下一部分" : "上一部分" }));
  y += 20;
  show.forEach((id, i) => {
    const n = nodeOf(c, id), color = c.colorOf.get(id) ?? c.colors.palette[i % 8];
    const t = tierOf(String(n.type ?? "")), lane = t === 0 ? 0 : t === 2 ? 2 : 1;
    const st = LANE_STYLE[lane];
    out.items.push(item({ id: `n:${id}`, nodeId: id, kind: "node", x: c.plan.labelX, y, w: c.plan.labelW, h: st.lh,
      lines: wrapLabel(n.title, st.fs, c.plan.labelW - FLOW.META_W, 1), fs: st.fs, lh: st.lh, weight: st.weight, tone: PEEK.TONE, lane, peek: true }));
    const bx = c.plan.barX + lane * FLOW.LANE_DX;
    out.prims.push({ k: "rect", id: `bar:${id}`, x: bx, y: y + 2, w: 3, h: st.lh - 4, rx: 1.5, fill: color, opacity: 0.7, layer: "over" });
    out.ports.push({ nodeId: id, x: bx, y0: y + 2, y1: y + st.lh - 2, color });
    out.leafIds.push(id);
    y += PEEK.ROW_H;
  });
  if (kids.length > show.length) { out.items.push(item({ id: `more:peek:${groupId}`, nodeId: groupId, kind: "more", x: c.plan.labelX, y, w: c.plan.labelW, h: 16, lines: [""], fs: 11, lh: 16, weight: 400, tone: 40, moreKind: "kids", moreCount: kids.length - show.length })); y += 16; }
  out.height = y;
  return out;
}
```
- `FlowItem` 增可选 `peek?: boolean`；渲染器对 `peek` 项加 `transform: translate(x,y) scale(0.86)`（`transform-origin: 0 50%`），文字 `opacity` 用 `tone`。**同一节点在预览与主体里用同一个 key（`n:${id}`）**，这样切换时 React 复用同一个元素，靠 `transform` / `opacity` 过渡完成"长大 / 缩小"。
- 整列＝`[上方预览] + 主体 + [下方预览]`：宿主先算预览高度 `peekH`，主体的 `availH` 减去 `peekH + PEEK.GAP`；预览放在主体上方（`side:"above"`）或下方，局部 y 依次拼接。**合并时 key 不能重复**：若某节点同时出现在主体与预览中（不应发生，防御），保留主体那份。
- 预览成员的段落同样进 `setStructureTargets`，高亮用基础档（tone 0），流带落在预览的细条上；`buildShapes` 不需改（预览的 ports 并入 `lay.ports` 即可）。
- 交互：点预览标题或预览成员 → 立即把它设为当前组（相当于用户主动"翻到下一部分的结构"），`sel` 设为被点成员；这是唯一不需要驻留的切组途径。

#### 12.4.5 切换动效（追加到 §8；名称 `conveyor-down` / `conveyor-up` / `zoom-in` / `zoom-out`）

| 情形 | 编排 |
|---|---|
| **顺着滚动方向换组**（`conveyor-down`：新组原是下方预览） | 0ms：旧主体里**不在新布局中**的项 `translateY(−12px) + opacity 0`（stagger(i,14,120)，180 / ease-in），它们的条 `scaleY → 0`；旧主体若成为新的上方预览，其成员直接位移 + `scale 1 → 0.86` + 降到预览色调（460 / ease）。同时：预览里的成员位移到主体位置 + `scale 0.86 → 1` + 恢复色调（460 / ease，stagger(i,24,96)）；预览细条长到主体条宽与高（`width/height/x/y` 过渡 460）；预览标题位移成主体头部（460）。160ms 起：新主体里预览没有的项（第 5 项以后、展开的子项）自下方 `+10px` 淡入（280，stagger 20）；新版式特有的图元（时间轴、编号圆、跨度条、表头…）按 §8.1 的顺序画出（起点 220）。流带：`d` 直接从旧几何过渡到新几何（460），落点随条一起移动——**没有任何一条流带消失再出现**。总时长 ≈ 900。 |
| `conveyor-up` | 镜像：方向相反。 |
| **向深一层**（`zoom-in`：新组是旧组某成员的子组，例如读进了"理由"内部的细分） | 被读成员的标签位移到头部位置（变成新组的标题，`font-size` 不动画，用 `scale` 从 1 → 头部字号比例）；其它旧成员朝上下两侧推开并淡出（向上的上移、向下的下移 16px，200 / ease-in）；新成员从该成员原来的位置"展开"：起点 `y`＝该成员旧 `y`、`scaleY(0)`，终点各自位置（380 / ease-out，stagger 24）。 |
| **向浅一层**（`zoom-out`） | 镜像：头部缩回成新组里的一个成员行，其余新成员从上下两侧滑入。 |
| **同组内阅读节点移动** | 不变（§8.5）：主题色底在行之间淡出淡入，整列平滑对齐。 |

宿主判定：`switched` 非空且新组 ∈ 旧主体成员集合 → `zoom-in`；旧组 ∈ 新主体成员集合 → `zoom-out`；新组 == 旧预览组 → `conveyor-*`；否则 → 原 `regroup-down/up`（§8.6）。
渲染器实现：所有动效都依赖「同 key 元素的 `transform` 过渡」+「进出场项用 `usePresence` 的 enter/exit 相位」，不需要逐帧脚本。`--flow-delay` 按上表写在各元素的 style 上。

### 12.5 其它小改

- **对齐不跟手**：滚动跟踪期间整列不动；停下后若阅读节点或组变了，整列 `translateY` 420 / ease 对齐（§8.4 原规则不变），切组时先完成 12.4.5 的编排，再对齐。
- **版式名**：头部右侧的版式名（`patternName`）切换时交叉淡化 240。
- **i18n**：新增文案「下一部分」「上一部分」「{a} / {b}」（翻页器）进 en/ja 词典。

### 12.6 阶段增补

- **阶段 1** 增：`laneOf`、`compareTable`（三种 `how` 各一例：命名维度样例 = §12.3.4 新示例三的数据，期望 `dims = [容量, 遗忘]`；配对样例 = 旧示例三（无冒号、有 &比），期望两列、表头为「定义」「因果」；序号样例 = 无冒号无比，期望表头「1」「2」）、`decideAttention`（下列 6 例）、§12.1 的宽度遍历测试。
  `decideAttention` 用例（组 A、B 为兄弟，chain＝[root, A, a1] 之类；`o={paged:false, idle:false}` 除注明外）：
  1. 首次：4 个样本都在 A → `groupId=A`，`readingId`＝38% 样本的成员；
  2. 12%、38% 在 A，62%、88% 在 B → 不切，`peek={B,"below"}`；
  3. 12% 在 A，38%、62%、88% 在 B（B 得分 0.90 ≥ 0.6，A 0.10 ≤ 0.25）→ 立刻切到 B，`switched="down"`；
  4. 38%、62% 在 B、12% 与 88% 在 A（B 0.78，A 0.22）→ 立刻切；
  5. 38% 在 B、其余在 A（B 0.50，A 0.50）→ 不切；
  6. 样本在 A 的成员 a2 的子节点 a2.1 → 仍是 A，`readingId=a2`；
  7. B 得分 0.6、A 0.4：非 idle 不切；600ms 后 `idle=true` 再调 → 切。
- **阶段 3** 增：§12.1 侧栏联动（DOM 测试：打开结构图后 `.reader-side-rail` 带 `is-closed`；再点「展开」→ 结构图关闭；侧栏原本展开时，关闭结构图后侧栏恢复展开）、§12.2 泳道（DOM 测试：论证样例中，例证项的条 `x` − 论点条 `x` = `2 × LANE_DX`（无根）或 `3 × LANE_DX`（有根）；所有 `.flow-item[data-kind="node"]` 的 `transform` 的 x 相同（标签不缩进）；存在 `span:` 与 `notch:` 图元；页面里没有 `.flow-chip`）。
- **阶段 4** 增：§12.3 对照表（DOM 测试：两行、表头维度数正确、`noStrands`、悬停单元格 → targets 含该单元格锚）、§12.3.4 提示词与版本（`node tests/m15v2.prompts.test.cjs`、`node tests/m15v2.dbstatic.test.cjs` 绿）、§12.4 注意力判定与邻组预览（DOM 测试：假内核 `getReadingProbes` 返回用例 2 的分布 → 出现「下一部分」预览且预览成员有流带；改为用例 3 的分布 → 原预览成员的元素仍是同一个 DOM 节点（用 `===` 比较前后引用），只是 `transform` 变了）。
- 用户实机验收增：在一段两部分交界处慢慢往下滚——下一部分先以预览出现在列的下方，直到它占据视口中上部才成为主体，且是"滑上来长大"而不是整页替换；读进某个论点内部的细分时，结构是"放大进去"；遇到对照段落，看到两行（每行一个对象）+ 维度表头的表格。
