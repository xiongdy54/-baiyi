# 结构图 · 滚动切换流畅性（v3.5，§16）

> 2026-10-30。优先级：**§16（本文）> §15 > §14 > §13 > §12 > 前文**。本文与 §15.6 / §15.7 冲突处一律以本文为准。
> 适用代码：`src/components/reader/flow/FlowLayer.tsx`、`StructureFlowHost.tsx`、`src/lib/flow/layout.ts`、`src/lib/flow/presence.ts`、`src/theme.css`（结构流段，约 L9940–10060）。
> 目标：滚动正文时，结构图从 A 组切到 B 组，**文字、节点竖条、表格/轴等图元、正文彩带四样东西同起同止**；不出现旧竖条残留、新竖条先进、两组竖条叠在一起。

---

## 16.0 实机现象 → 根因对照

用户截图（滚动中切组的某一帧）：旧组文字几乎全没了，旧组竖条仍是实心；新组竖条和灰色表格块已经进来，和旧竖条叠在同一列；正文彩带已经接到了新位置。

| # | 根因（代码位置） | 造成的现象 |
|---|---|---|
| R1 | **退场的文字瞬间消失**：`renderItem` 里 `.flow-line` / `.flow-meta` 在 `ex` 时直接写 `opacity: 0`，而 `.flow-line` 没有 transition → 文字第 0 帧就没了，外层 `.flow-item` 的 240ms 淡出只作用在一个已经透明的盒子上 | 症状 1：文字先没、竖条还在 |
| R2 | **退场图元延迟大于保留时长**：`renderPrim(..., phase === "exit" ? 200 : ...)` 给退场图元 200ms 延迟，但 `EXIT_MS = 180` → 过渡还没开始节点就被删了。旧竖条实心停留 180ms 然后**硬切**消失 | 症状 2：旧竖条残留 |
| R3 | **图元 key 带下标**：`key = \`${p.id}:${i}\``。列表组成一变，同一个下标会落到另一个图元上，React 复用 DOM，`rect` 的 `x/y/height` 有 380ms 过渡 → 旧竖条**滑**到新竖条的位置 | 症状 3：竖条/表格块"先进来"、互相叠 |
| R4 | **预览行与主体行的竖条同 id**：`layoutPeek` 产出 `bar:${id}`，与主体 `bar:${id}` 相同（§15.5 只给条目加了 `peek:` 前缀，图元没加）→ 预览变主体时竖条复用、从预览位置滑过去，而文字是交叉淡入 | 症状 3 / 4 |
| R5 | **每个图元画了两遍**：`flow-prims-under` 和 `flow-prims-over` 两个 `<g>` 都 `prims.map(...)` 全量渲染，没按 `p.layer` 过滤 → 半透明图元叠出深色，切换时两份各自过渡 | 竖条颜色不稳、重影 |
| R6 | **入场缩放的原点错误**：`rect` / `circle` 入场用 `transform: scaleY(0)` / `scale(0)`，没有 `transform-box: fill-box`，SVG 默认以画布原点 (0,0) 缩放 → 新竖条从屏幕左上角方向"飞"进来 | 症状 3：新结构先于文字乱入 |
| R7 | **四类部件四套时钟**：换组时文字 `160 + stagger(20, ≤180)`、图元 `160`、彩带 `340 + stagger`、关系线 `560`；退场时文字 0、图元 200、彩带 0；几何过渡又分 380 / 420 / 460 / 600ms；而滚动中 `data-tracking="1"` 又把彩带过渡全关（`transition: none`，**连 opacity 也关了**）→ 彩带瞬切，其它部件慢慢来 | 症状 1 / 4：整体不同步 |
| R8 | **新旧两组共用同一个列容器**：退场的旧条目和新条目都在同一个 `.flow-items` / `.flow-col` 里，`translateY(dy)` 用的是**新组**的 dy → 旧组在退场的同时被新 dy 拖着走 420ms；彩带却按新 dy 瞬间落点 | 症状 3：两组错位叠在一起 |
| R9 | **滚动中 motion 来回翻**：`TRACK_IDLE_MS = 160`，滚轮两格之间就会 `track → steady → track`；`renderItem` 的位移又依赖 motion（steady 下进出 ±8px，regroup 下 ±10px）→ 正在过渡的条目中途改目标，抖 | 滚动时细碎抖动 |
| R10 | **滚动回调里同步重渲整棵树**：`paintFrame` 遇到形状集合变化就 `flushSync(setFrameTick)`，而 `scene = {...base, shapes}` 每次都是新对象 → 整个 `FlowLayer`（四个 `usePresence`、全部条目和图元）在 scroll 事件里同步重渲；`base` 的依赖里还有 `motion / tracking / shifting`，滚动开始/停止都会重跑 `fitLayout` | 掉帧、卡顿 |
| R11 | 换组时 `bump()` 触发 `data-draw` 线条的 WAAPI 重画（480ms）——在**所有**带 draw 的线上，包括不变的 | 线条在换组时重画一遍，节奏与其它部件不一致 |

结论：问题不是某个参数"慢了一点"，而是**同一次切换被拆给了十几个各自计时、各自复用 DOM 的零件**。修法分两层：

- **结构层（16.1）**：把"一组结构"作为一个整体（一代 generation）做进出场。旧代整体淡出、新代整体淡入，**一个时钟**，文字/竖条/图元/彩带不可能不同步。
- **零件层（16.2–16.6）**：修掉 R1–R6、R9–R11，统一参数。

---

## 16.1 一代一层（核心，必须实现）

### 16.1.1 概念

- **代（generation）**＝某一个主体组 `cut`（即 `data.groupId`）下的完整结构图：标签、图元、关系线、正文彩带、上下预览。
- `genKey = cut ?? "none"`。只要 `genKey` 不变，就是同一代——代内的变化（窗口滑动、预览出现/消失、阅读行变化、展开子项）走零件级进出场（16.3）。
- `genKey` 变了（滚动换组、换章、zoom-in/out、点击预览组）→ **旧代整体退场、新代整体入场**，两代各有自己的冻结场景、自己的 `dy`、自己的 SVG defs。
- 同一时刻最多两代：一个 live + 一个 exit。第三代到来时，最老的 exit 代立即卸载。

### 16.1.2 宿主（`StructureFlowHost.tsx`）

1. `base` 里新增两个字段（类型在 `types.ts` 的 `FlowScene` 上加）：
   ```ts
   genKey: string;              // = cut ?? "none"
   switchDir: "down" | "up";    // 取 data.switchInfo?.dir ?? "down"，仅供将来使用，本轮渲染不用
   ```
2. **逐帧数据按代存**：把 `frameRef` 换成
   ```ts
   const framesRef = useRef(new Map<string, { lay: PatternLayout; dy: number; opts: Parameters<typeof buildShapes>[3] }>());
   const liveGenRef = useRef<string>("none");
   ```
   在 `base` 的 useMemo 里原来写 `frameRef.current = {...}` 的地方改为：
   ```ts
   framesRef.current.set(genKey, { lay, dy, opts: shapeOpts });
   liveGenRef.current = genKey;
   ```
   并加一个 effect：`genKey` 变化后 `GEN.REMOVE_MS + 40` 毫秒，删除 `framesRef` 中所有 `!== liveGenRef.current` 的键。
3. **neckEls 的键加代前缀**：`registerShape(genKey, id, el)`，Map 键为 `` `${genKey}|${id}` ``。
4. `paintFrame` 改为遍历所有代（旧代退场期间彩带也要跟着正文滚，否则就是"彩带残影"）：
   ```ts
   const paintFrame = useCallback(() => {
     const base = geoRef.current;
     if (!smooth || !base || !kernel?.getFrameOffsets) return;
     const dx = (planRef.current?.shift ?? 0) - geoShiftRef.current;
     const g = geometryAt(base, shiftOffsets(base, kernel.getFrameOffsets(), dx));
     // ① 先【读】：当前代的标签实际位置（16.5），所有 getBoundingClientRect 集中在写之前
     const live = liveGenRef.current;
     const shiftOf = readLiveShift(live); // (nodeId) => number，见 16.5
     // ② 再算 + 【写】
     for (const [gk, F] of framesRef.current) {
       const shapes = buildShapes(g, F.lay, F.dy, { ...F.opts, shiftOf: gk === live ? shiftOf : undefined });
       if (gk === live) {
         const sig = shapes.map((s) => s.id).join("|");
         if (sig !== shapeSigRef.current) {
           shapeSigRef.current = sig;
           flushSync(() => setFrameTick((n) => n + 1)); // 只会重渲彩带层，见 16.6
         }
       }
       for (const s of shapes) {
         const el = neckEls.current.get(`${gk}|${s.id}`);
         if (!el || !el.isConnected) continue;
         const d = shapePath(s);
         el.style.transition = "opacity 160ms var(--flow-ease)"; // 只关几何过渡，保留淡入淡出
         el.setAttribute("d", d);
         el.style.setProperty("d", `path("${d}")`);
       }
     }
   }, [smooth, kernel]);
   ```
   空闲恢复处 `el.style.transition = ""` 保持不变。
5. **组切换 effect**（约 L630–660）：删掉 `bump()`；`setMotion(m)` 可保留（FlowLayer 不再据此做编排，见 16.3）。`settleMotion(1200)` 改 `settleMotion(400)`。
6. 换章（§15.3）不需要额外处理：`groupId` 变化即换代，旧章结构 120ms 淡出、新章 200ms 淡入。

### 16.1.3 渲染器（`FlowLayer.tsx`）结构改造

把现在的单体组件拆成三块：

```
FlowLayer                       ← 只负责：代的进出场、动作行/空态（仅 live 代）
 ├─ <svg.flow-blend>            ← 仍是唯一的混合层根，mix-blend-mode 不动
 │    └─ BlendGen × (1~2)        ← <g class="flow-gen">，本代的高亮彩带 + 本代的 defs
 └─ <div.flow-layer>
      ├─ UpperGen × (1~2)        ← <div class="flow-gen">，内含本代自己的 <svg.flow-svg> 与 <div.flow-items>
      └─ 动作行 / 讲解 / 状态 / 空态（只按 live 代的 scene 渲染，与现在相同）
```

代列表：

```ts
const GEN = { OUT_MS: 120, IN_MS: 200, IN_DELAY: 100, REVIVE_MS: 160, REMOVE_MS: 140 } as const;
const GEN_EASE_OUT = "cubic-bezier(0.4, 0, 1, 1)";   // 退场：ease-in（加速离开）
const GEN_EASE_IN  = "cubic-bezier(0, 0, 0.2, 1)";   // 入场：ease-out（减速到位）

const genItems = useMemo(() => [{ id: scene.genKey, scene }], [scene]);
const gensAll = usePresence(genItems, GEN.REMOVE_MS);
// 最多两代：live + 最新的一个 exit；减弱动效时 exit 代直接不画（否则会实心停 140ms）
const exits = motionOff ? [] : gensAll.filter((g) => g.phase === "exit").slice(-1);
const gens = [...exits, ...gensAll.filter((g) => g.phase !== "exit")]; // exit 在下，live 在上
const fadeIn = gens.length > 1; // 只有"换代"才淡入；首次打开走原来的 open 编排
```

渲染：

```tsx
<SvgRoot className="flow-blend" ...原属性不变...>
  {gens.map(({ item, phase }) => (
    <BlendGen key={item.id} scene={item.scene} phase={phase} fadeIn={fadeIn} registerShape={registerShape} />
  ))}
</SvgRoot>
<div ref={rootRef} className="flow-layer" ...>
  {gens.map(({ item, phase }) => (
    <UpperGen key={item.id} base={item.scene} phase={phase} fadeIn={fadeIn} onEvent={onEvent} />
  ))}
  {/* 动作行 / 讲解 / 状态 / 空态：原代码原样，使用 live 的 scene */}
</div>
```

- `UpperGen` 用 `React.memo`，比较函数：`prev.phase === next.phase && prev.fadeIn === next.fadeIn && sameBase(prev.base, next.base)`，其中 `sameBase` 逐个比较 `layout, strands, dy, plan, colors, hoverId, motion, armed, mode, inline.forId`（引用相等即可），**不比较 `shapes`** —— 这样逐帧补渲染只重渲彩带层。
- `.flow-gen`（HTML 那一份）样式：`position: absolute; inset: 0; pointer-events: none;`；其内 `.flow-item` 照旧 `pointer-events: auto`。**exit 代整体 `pointer-events: none !important`**（`.flow-gen[data-phase="exit"] * { pointer-events: none !important; }`），避免点到正在消失的旧条目。
- 原来的 `<svg.flow-svg>` 搬进 `UpperGen`，每代一份。原来的 `prims / strandsP / itemsP` 三个 `usePresence` 搬进 `UpperGen`；`shapesP` 搬进 `BlendGen`。
- 混合层注释"自身及祖先不得有 transform / opacity / filter"指的是 `svg.flow-blend` 根及其**祖先**；在根**内部**的 `<g>` 上做 opacity 动画不影响混合，可以放心用。

### 16.1.4 代的淡入淡出：用 WAAPI，两层同一时钟

两棵树（混合层 `<g>` 与上层 `<div>`）必须**同一帧开始、同一曲线**。CSS transition 依赖 `usePresence` 的 2 帧翻转，起点不可控；改用 WAAPI，在同一次 commit 的 layout effect 里同时启动，浏览器会给它们同一个 start time。

`src/lib/flow/presence.ts` 追加：

```ts
export function useGenFade(ref: { current: Element | null }, phase: Phase, fadeIn: boolean, off: boolean) {
  const anim = useRef<Animation | null>(null);
  const mounted = useRef(false);
  const prevPhase = useRef<Phase>(phase);
  useLayoutEffect(() => {
    const el = ref.current as (Element & { animate?: Element["animate"] }) | null;
    if (!el || off || typeof el.animate !== "function") return;
    const now = () => Number(getComputedStyle(el).opacity || 1);
    if (!mounted.current) {
      mounted.current = true;
      if (fadeIn) anim.current = el.animate([{ opacity: 0 }, { opacity: 1 }],
        { duration: 200, delay: 100, easing: "cubic-bezier(0, 0, 0.2, 1)", fill: "backwards" });
    } else if (phase === "exit" && prevPhase.current !== "exit") {
      const from = now();                       // 先读当前值（可能还在淡入途中）
      anim.current?.cancel();
      anim.current = el.animate([{ opacity: from }, { opacity: 0 }],
        { duration: Math.max(40, 120 * from), easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" });
    } else if (phase !== "exit" && prevPhase.current === "exit") {
      const from = now();                       // 来回滚：退场途中被"救回"
      anim.current?.cancel();
      anim.current = el.animate([{ opacity: from }, { opacity: 1 }],
        { duration: 160, easing: "cubic-bezier(0, 0, 0.2, 1)", fill: "none" });
    }
    prevPhase.current = phase;
  }, [phase, fadeIn, off]);
  useEffect(() => () => anim.current?.cancel(), []);
}
```

`BlendGen` 和 `UpperGen` 各自 `const ref = useRef(null); useGenFade(ref, phase, fadeIn, motionOff);`，挂到各自的 `.flow-gen` 根上。**两边参数必须完全相同**（就用上面这一个 hook，不要复制改写）。

时间线（换代那一刻为 0）：

| 时间 | 旧代（文字+竖条+图元+彩带，整体） | 新代（整体） |
|---|---|---|
| 0 ms | 开始淡出，ease-in | 已挂载，opacity 0 |
| 100 ms | ≈ 0.25 | 开始淡入，ease-out |
| 120 ms | 0 | ≈ 0.25 |
| 140 ms | 卸载 | ≈ 0.45 |
| 300 ms | — | 1 |

两代同时可见的窗口只有 100–120ms，且此时旧代 ≤ 0.25、新代 ≤ 0.25，肉眼看不到"两套竖条叠在一起"。**不做任何位移**（不加 translateY）：位移只要加在一层上就会让文字和竖条/彩带错开，这正是用户投诉的点。

### 16.1.5 defs 的 id 必须按代加前缀

两代同时在文档里时，`url(#g-bar:x)` 这类引用会解析到**文档里第一个**同名元素——旧代的渐变（坐标是旧代的 userSpaceOnUse）会被新代拿去用，颜色和位置都错。所有 id 一律加代前缀：

```ts
const ns = scene.genKey.replace(/[^a-zA-Z0-9_-]/g, "_");
// 图元渐变   g-${ns}-${p.id}        关系线渐变  gs-${ns}-${s.order}
// 斜纹       h-${ns}-${i}           marker      marker(`${ns}-${p.id}`, ...) / marker(`${ns}-${s.id}`, ...)
// 彩带渐变   fg-${ns}-${slug(s.id)}  stub 渐变   fst-${ns}-${slug(s.id)}
```

引用处（`fill=url(#…)`、`stroke=url(#…)`、`markerEnd=url(#mk-…)`）同步改。写一个 `const gid = (kind: string, raw: string) => \`${kind}-${ns}-${raw.replace(/[^a-zA-Z0-9_-]/g, "_")}\`` 统一生成，不要手拼。

---

## 16.2 零件 bug（与 16.1 一起改）

| # | 改法 |
|---|---|
| R1 | `renderItem` 中 `.flow-line`、`.flow-back-line`、`more` 行、`.flow-meta` 的 `opacity` **一律** `it.tone / 100`，删掉 `ex ? 0 :`。退场只由外层 `.flow-item` 的 opacity 负责 |
| R2 | 退场图元延迟改 `0`：`renderPrim(p, phase === "exit" ? exitPrim(p) : p, i, phase === "exit" ? 0 : primDelay(p), ...)`（under / over 两处） |
| R2' | `exitPrim` 只改透明度，不收几何：`return { ...p, opacity: 0 };`（四种 k 统一）。收几何+淡出在 120ms 里看不出收缩，只会和彩带错位 |
| R3 | `renderPrim` 的 key 改为 `p.id`（删 `:${i}`）。若出现重复 key 警告，说明 layout 产出了重复 id，去 `mergeLayouts` 修去重，不要在渲染器加下标 |
| R4 | `layoutPeek`（layout.ts 约 L1300–1330）里预览产出的**所有图元** id 加 `peek:` 前缀：`peek:bar:${id}`、`peek:line:${groupId}`（原 `peekline:`）。whisper 模式的过滤改为 `/^(peek:)?bar:/.test(p.id)` |
| R5 | 两个图元层按 layer 过滤：`flow-prims-under` 只画 `item.layer === "under"`，`flow-prims-over` 只画 `"over"` |
| R6 | 入场缩放只在 `motion === "open"` 时用；并在 CSS 给 rect/circle 加 `transform-box: fill-box;`，rect `transform-origin: 50% 0`，circle `transform-origin: 50% 50%` |
| — | 关系线（strands）入场：`phase === "enter"` 时 `opacity={0}`，live 时 `colors.strandA`；退场只设 `opacity 0`，不再 `collapseStrand` |
| — | 彩带（BlendGen 内）入场：`phase === "enter"` 时 `opacity: 0`，live 时 1（目前 enter 直接是 1，等于瞬现）。滚动模式下退场 **不再** `collapseAtEdge`，几何保持原样只淡出 |
| — | shape id 不得含逐帧变化的量：`buildShapes` 中非最右栏的 id `${s.nodeId}@${s.column}:${Math.round(s.top)}` 改为 `${s.nodeId}@${s.column}#${k}`（k＝该节点在该栏内的序号）。否则多栏版式滚动时每帧都换 id → 每帧 flushSync + 每帧进出场 |

---

## 16.3 编排只留给"打开 / 关闭 / 翻页"

代内的零件进出场（窗口滑动、预览出现、子项展开、阅读行变化）**一律无延迟、无位移、只淡入淡出**。stagger / scale / 位移只在 `open`、`close`、`turn` 三种 motion 下生效。

```ts
const choreo = motion === "open" || motion === "close" || motion === "turn";

const delayFor = (i: number, phase: Phase) => {
  if (motion === "open")  return phase === "exit" ? 0 : 360 + stagger(i, 22, 200);
  if (motion === "close") return stagger(i, 12, 96);
  return 0;
};
const shapeDelay = (i: number) =>
  motion === "open" ? stagger(i, 30, 240) : motion === "close" ? 100 + stagger(i, 14, 110) : motion === "turn" ? 220 + stagger(i, 18, 120) : 0;
const strandDelay = (i: number) => (motion === "open" ? 760 + stagger(i, 40, 240) : 0);
function primDelay() { return motion === "open" ? 480 : motion === "close" ? 60 : 0; }
```

`renderItem` 的位移：

```ts
const dx = motion === "open" && ent ? -6 : 0;
const dy = 0;          // 删除 regroup ±10 / steady ±8 —— 换组已由 16.1 整代淡入淡出负责
```

draw 线（WAAPI dashoffset）effect：只在 `motion === "open"` 时执行，依赖改为 `[scene.seq, armed, motion]` 不变但首行改 `if (motion !== "open" || !armed) return;`。

这样 R9（滚动中 motion 来回翻）自然失效：`track` / `steady` / `regroup-*` / `conveyor-*` 下所有零件的样式完全相同，翻转不会改任何目标值。

---

## 16.4 统一时长（CSS，替换 theme.css 结构流段对应规则）

在 `.flow-probe` 的 Token 里新增：

```css
--flow-t-geo: 240ms;      /* 原 420ms：代内所有几何移动（条目/竖条/列/彩带端点）统一这一个值 */
--flow-t-in: 160ms;       /* 零件淡入 */
--flow-t-out: 120ms;      /* 零件淡出 */
```

替换规则（只列需要改的；open / close 的分档规则保留）：

```css
.flow-shape {
  transition: d var(--flow-t-geo) var(--flow-ease), opacity var(--flow-t-in) var(--flow-ease);
  transition-delay: var(--flow-delay, 0ms);
}
/* 滚动中：只关几何过渡，保留淡入淡出（原来连 opacity 也关了 → 彩带瞬现瞬灭） */
.flow-blend[data-tracking="1"] .flow-shape,
.flow-blend[data-smooth="1"] .flow-shape { transition: opacity var(--flow-t-in) var(--flow-ease); }
/* 删除：.flow-blend[data-flow-motion="regroup-down"/"regroup-up"] .flow-shape 两条 */
.flow-blend[data-flow-motion="open"] .flow-shape  { transition: d 640ms var(--flow-ease-out), opacity 160ms var(--flow-ease); }  /* 保留 */
.flow-blend[data-flow-motion="close"] .flow-shape { transition: d 360ms var(--flow-ease-in),  opacity 160ms var(--flow-ease); }  /* 保留 */

.flow-col,
.flow-items { transition: transform var(--flow-t-geo) var(--flow-ease); }

.flow-svg rect,
.flow-svg circle {
  transition: x var(--flow-t-geo) var(--flow-ease), y var(--flow-t-geo) var(--flow-ease),
    width var(--flow-t-geo) var(--flow-ease), height var(--flow-t-geo) var(--flow-ease),
    cx var(--flow-t-geo) var(--flow-ease), cy var(--flow-t-geo) var(--flow-ease), r var(--flow-t-geo) var(--flow-ease),
    fill 200ms var(--flow-ease), opacity var(--flow-t-in) var(--flow-ease), transform 280ms var(--flow-ease-out);
  transition-delay: var(--flow-delay, 0ms);
  transform-box: fill-box;
}
.flow-svg rect   { transform-origin: 50% 0; }
.flow-svg circle { transform-origin: 50% 50%; }
.flow-svg path {
  transition: d var(--flow-t-geo) var(--flow-ease), stroke-dashoffset var(--flow-t-draw, 480ms) var(--flow-ease-out), opacity var(--flow-t-in) var(--flow-ease);
  transition-delay: var(--flow-delay, 0ms);
}
.flow-strands path { transition: d var(--flow-t-geo) var(--flow-ease), opacity var(--flow-t-in) var(--flow-ease); }

.flow-item,
.flow-inline {
  transition: transform var(--flow-t-geo) var(--flow-ease), opacity var(--flow-t-in) var(--flow-ease), height var(--flow-t-geo) var(--flow-ease);
  transition-delay: var(--flow-delay, 0ms);
}
/* 退场比入场快：同一元素 is-exit 时把 opacity 时长换成 out */
.flow-item.is-exit { transition: transform var(--flow-t-geo) var(--flow-ease), opacity var(--flow-t-out) cubic-bezier(0.4, 0, 1, 1); transition-delay: 0ms; }

.flow-gen { position: absolute; inset: 0; pointer-events: none; }
.flow-gen[data-phase="exit"] * { pointer-events: none !important; }
```

FlowLayer 常量：零件级 `EXIT_MS = 160`（≥ `--flow-t-out` 120 + 一帧余量）；代级 `GEN.REMOVE_MS = 140`。

宿主常量：`FLOW.TRACK_IDLE_MS: 160 → 240`（滚轮两格间隔常在 150–220ms，160 会让 tracking 在一次连续滚动中反复开关）。

**总表（交付时对照）**

| 场景 | 部件 | 时长 | 曲线 | 延迟 |
|---|---|---|---|---|
| 换代（滚动换组 / 换章 / 点预览） | 旧代整体 opacity→0 | 120ms（中途被打断按剩余比例） | `cubic-bezier(.4,0,1,1)` | 0 |
| | 新代整体 opacity 0→1 | 200ms | `cubic-bezier(0,0,.2,1)` | 100ms |
| | 退场代卸载 | 140ms | — | — |
| | 退场途中被救回 | 160ms 从当前值到 1 | `cubic-bezier(0,0,.2,1)` | 0 |
| 代内零件进场 | 条目 / 图元 / 关系线 / 彩带 | 160ms opacity | `--flow-ease` | 0 |
| 代内零件退场 | 同上 | 120ms opacity；160ms 卸载 | `cubic-bezier(.4,0,1,1)` | 0 |
| 代内几何移动 | 条目 transform、竖条 x/y/h、列 dy、关系线 d、非滚动模式彩带 d | 240ms | `--flow-ease` | 0 |
| 滚动模式彩带几何 | 逐帧 JS 写 d | 无过渡 | — | — |
| 打开 / 关闭 / 翻页 | 维持 §15.6 / §15.7 原编排 | — | — | — |
| `prefers-reduced-motion` / 动效关 | 一切 | 0，退场代不画 | — | — |

---

## 16.5 彩带端点跟随"条目实际位置"

代内几何移动 240ms 期间（例如滚动中窗口滑动、上方预览出现使 dy 改变），标签和竖条在 CSS 过渡里慢慢走，而滚动模式下彩带由 `paintFrame` 按**目标**位置逐帧写 → 彩带尖端先到、竖条后到，又是一次不同步。解决：逐帧读条目的**实际**位置，把差值加到彩带端点上。

1. `buildShapes` 的 `o` 参数加可选 `shiftOf?: (nodeId: string) => number`；`ports` 那一行改为：
   ```ts
   const ports = new Map(lay.ports.map((p) => {
     const k = o.shiftOf?.(p.nodeId) ?? 0;
     return [p.nodeId, { ...p, y0: p.y0 + dy + k, y1: p.y1 + dy + k }] as const;
   }));
   ```
2. 宿主 `readLiveShift(genKey)`：
   ```ts
   const itemElCache = useRef<{ key: string; map: Map<string, { el: HTMLElement; mid: number }> } | null>(null);
   function readLiveShift(gk: string) {
     const F = framesRef.current.get(gk);
     const root = document.querySelector(`.flow-layer .flow-gen[data-gen="${CSS.escape(gk)}"]`);
     if (!F || !root) return undefined;
     // 缓存：同一 layout 只查一次 DOM
     const cacheKey = gk + "|" + F.lay.items.length + "|" + F.dy;
     if (itemElCache.current?.key !== cacheKey) {
       const map = new Map<string, { el: HTMLElement; mid: number }>();
       for (const it of F.lay.items) {
         if (!it.nodeId || (it.kind !== "node" && it.kind !== "kid")) continue;
         if (map.has(it.nodeId) && it.peek) continue;      // 主体优先于预览
         const el = root.querySelector(`[data-flow-item="${CSS.escape(it.id)}"]`) as HTMLElement | null;
         if (el) map.set(it.nodeId, { el, mid: it.y + F.dy + it.h / 2 });
       }
       itemElCache.current = { key: cacheKey, map };
     }
     const delta = new Map<string, number>();
     for (const [id, v] of itemElCache.current.map) {
       const r = v.el.getBoundingClientRect();           // .flow-layer 是 fixed inset:0，所以 client 坐标即层坐标
       const d = r.top + r.height / 2 - v.mid;           // 用中线：预览行有 scale(.86) 以 50% 为原点，中线不受影响
       if (Math.abs(d) > 0.5) delta.set(id, d);
     }
     return (id: string) => delta.get(id) ?? 0;
   }
   ```
   `UpperGen` 根节点加 `data-gen={base.genKey}`。
3. **停止滚动后也要跑完**：代内布局变化发生在滚动的最后一帧时，tracking 结束（240ms）之前过渡可能还没走完。加一个"收尾循环"：
   ```ts
   const settleUntil = useRef(0);
   useEffect(() => {
     if (!smooth) return;
     settleUntil.current = performance.now() + 240 + 40;   // --flow-t-geo + 余量
     let raf = 0;
     const loop = () => { paintFrame(); if (performance.now() < settleUntil.current) raf = requestAnimationFrame(loop); };
     raf = requestAnimationFrame(loop);
     return () => cancelAnimationFrame(raf);
   }, [base, smooth, paintFrame]);
   ```
   `paintFrame` 写 d 时已把几何过渡关掉，收尾循环期间彩带每帧对齐条目实际位置；循环结束不需要恢复 transition（下一次非滚动的 CSS d 过渡由 `.flow-blend[data-smooth="1"]` 规则决定：滚动模式下彩带**永远**由 JS 写几何，CSS 只管 opacity）。
4. 非滚动模式（分页 / PDF）不走 paintFrame：彩带 `d` 与条目 `transform` 都是 240ms + 同一条 `--flow-ease`，同一次 commit 启动，天然同步。

---

## 16.6 性能（R10）

1. **base 与 motion 解耦**：把 `base` useMemo 拆成两个：
   - `layoutMemo`：只依赖布局输入（plan, viewportEl, geo, data.*, colors, title, T, cmpPage, readViewport）——产出 `lay / dy / strands / shapeOpts / panel / inline / genKey`；
   - `base`：`useMemo(() => ({ ...layoutMemo, motion, tracking, shifting, armed, seq: animKey, smooth }), [layoutMemo, motion, tracking, shifting, armed, animKey, smooth])`。
   滚动开始/停止只改 `tracking`，不再重跑 `fitLayout` / `mergeLayouts`，`lay` 引用不变 → `UpperGen` 里的 `usePresence` 不触发。
2. `UpperGen` 的 memo 比较里 `layout` 用引用比较；`tracking` 不参与比较（上层不再依赖它，`data-tracking` 只挂在混合层根上）。
3. `flushSync(setFrameTick)` 保留，但由于 16.1.3 的拆分，它只会重渲 `FlowLayer` 外壳 + `BlendGen`；外壳里不得再放任何 `usePresence` 以外的重计算。
4. `registerShape` 用 `useCallback` 稳定下来，`BlendGen` 里 path 的 ref 用 `useCallback` 工厂缓存（`refFor(id)` 存 Map），避免每次渲染 `null → el` 往返改 Map。
5. 交付前用 DevTools Performance 录一次连续滚动 5 秒：scroll 事件里的任务不得超过 8ms；不得出现 "Forced reflow" 警告来自 `paintFrame` 的写之后读（16.5 已把所有读放在写之前）。

---

## 16.7 测试

`tests/flow.dom.test.cjs`（jsdom 无 WAAPI，`useGenFade` 已做 `typeof el.animate` 守卫）：

1. 每个图元在文档里只出现一次：`querySelectorAll('[data-prim-id="bar:X"]').length === 1`（R5）。
2. 预览行图元 id 全部以 `peek:` 开头（R4）。
3. 退场条目的 `.flow-line` 的 inline opacity 等于 `tone/100`，不为 0（R1）。
4. 切换 `genKey` 后：`.flow-layer > .flow-gen` 与 `svg.flow-blend > g.flow-gen` 各 2 个，exit 代带 `data-phase="exit"`；推进 150ms 后各剩 1 个。
5. 两代同时存在时，文档内所有 `[id]` 唯一（16.1.5）。
6. 非 open/close/turn 的 motion 下，所有 `.flow-item` 的 `--flow-delay` 为 `0ms`，transform 不含额外 `translate(…px, …px)` 尾项。
7. `paintFrame` 在两代并存时对两代的 path 都写了 `d`（mock `getFrameOffsets` 改变后，两代的 path `d` 都变化）。
8. 多栏几何下连续 10 次 `paintFrame`，`setFrameTick` 调用次数为 0（shape id 不随 top 变化）。

`tests/flow.layout.test.cjs`：`buildShapes(..., { shiftOf: () => 10 })` 时所有 ribbon 的 `t0/t1` 比不传时大 10。

---

## 16.8 用户实机验收

1. DevTools → More tools → Animations，速度调到 10%，滚动跨过一个组边界：
   - 旧组的文字、竖条、表格块、彩带**一起**变淡、一起消失；
   - 新组的文字、竖条、表格块、彩带**一起**出现；
   - 任何一帧都看不到两套竖条同时以明显浓度出现在同一列。
2. 正常速度来回快速滚动跨越边界 10 次：无闪烁、无残条、无"条在字没了"。
3. 慢速滚动、组内窗口滑动（"上方另 N 项"变化）时：标签与竖条一起平移 240ms，彩带尖端始终贴着竖条。
4. 打开 / 关闭结构图、翻页的动效与现在一致（本轮不改）。
5. 系统开启"减少动态效果"：换组瞬切，无残留。

## 16.9 易错点

- **不要**给新代或旧代加 translateY / scale：只要有一层位移，文字和彩带就会错开。
- **不要**把代的淡入淡出写成 CSS transition 配合 `usePresence` 的 enter→live 翻转——起点差 1–2 帧，两层就不同步。必须用 16.1.4 的 WAAPI hook，并且两层调用同一个 hook。
- 退场代的 `scene` 是 `usePresence` 冻结的最后一份，**不要**从 props 的最新 scene 里取它的 layout / dy。
- defs id 漏掉任何一个前缀，症状是"切换瞬间某条彩带/竖条颜色跳一下"——按 16.7-5 的测试兜底。
- `paintFrame` 里所有 `getBoundingClientRect` 必须在任何 `setAttribute` 之前完成（先读后写），否则每帧强制回流。
- §15.5 的"预览↔主体交叉淡入"在 16.1 之后由换代负责，`peek:` 前缀仍须保留（代内预览出现/消失时仍需要角色隔离）。
