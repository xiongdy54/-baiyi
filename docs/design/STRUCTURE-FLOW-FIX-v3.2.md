# 结构流 v3.2 修复补充（STRUCTURE-FLOW-PLAN §13）

> 2026-10-30。本文是 `STRUCTURE-FLOW-PLAN.md` 的第 13 节，针对实机使用中的 4 个问题。
> **优先级：§13（本文）> §12 > 前文。** 本文没提到的地方保持现状，不要顺手重构。
> 每个问题先说根因（已对照现有代码确认），再给改法。代码块里的写法请照抄；行号是写作时的位置，仅供定位。

---

## 13.0 根因总表

| # | 现象 | 根因 | 位置 |
|---|---|---|---|
| 1 | 从目录页往下翻时一直只有「目录-第1章-第2章…」这一层；从书中间打开时层级才正常 | `decideAttention` 的 `under(s, G)` 把「G 的**任意**子孙」都算成 G 的得分。`G = ROOT_ID` 时所有样本都在它下面，得分恒为 1.0，`curScore ≤ LEAVE` 和 `bs > curScore` 永远不成立，所以**一旦进入顶层组就再也出不来**；任何上层组同理，都不会往下钻。另外，代码里「新组是旧组子孙时不切」这一条把下钻也挡住了。从书中间打开时走的是「首次」分支（直接取最深的组），所以显示正常 | `src/lib/flow/layout.ts` `decideAttention`；`§12.4.2` 要点第 2 条 |
| 1′ | （加重 1）滚动中不会重新判定，停下后也常常不切 | ① `scheduleSample(250)` 每次 relocate 都把计时器清掉重来，实际效果是**防抖**而不是节流；② 驻留（DWELL 600ms）需要再取一次样，但滚动停下后没有人再触发取样，候选组只能一直等 | `useStructureFlow.ts` L212–288 |
| 2 | 滚动时结构图整列上下跑 | 列的纵向位置 `dy = alignY − readingY`，`alignY` 是阅读段落**可见部分**的中线（段落盒已被裁到视口），所以每次停下都会变，于是整列跟着做 420ms 的位移；阅读节点一变 `readingY` 也变；上方预览出现或消失时，主体整体下移或上移（`aboveH`），而且 `mainAvail` 跟着变，`fitLayout` 的折叠结果也会变；`fitLayout` 的窗口始终以阅读节点为中心，阅读节点每走一步窗口就滑一格 | `StructureFlowHost.tsx` L246–253、L507–511、L619–651；`layout.ts` `fitLayout` |
| 3 | 彩带比文字慢很多、甚至错位 | foliate 的 `relocate` 是在**滚动停止 250ms 之后**才发出的（`vendor/foliate-js/paginator.js` L763 的 `debounce(…, 250)`）。宿主的跟踪循环只靠 `relocate` 启动，结果是：滚动过程中几何一次都不重采，彩带钉在屏幕上不动，文字从它下面滑过去（这就是错位）；停下 250ms 以后才开始重采，然后带着 `d` 的 420ms 过渡追过去（这就是慢）。另外，每帧 `setGeo` 都会触发整场 `useMemo`（重新 `fitLayout` 和关系线计算），本身也很重 | `StructureFlowHost.tsx` L438–482 |
| 4 | 彩带只有绿色和黑色两种，大片黑色 | 宿主用 `getComputedStyle` 解析出的颜色是 `rgb(r, g, b)`，而 `mixHex` 只认 `#rrggbb`，所以总是返回 null，`kidColor` 只能退回 `color-mix(...)` 字符串，这个字符串被写进 SVG 的 `<stop stop-color>`。表现上它被当成无效值，落到 `stop-color` 的初始值**黑色**，再经过 multiply 混合，就成了大片黑。阅读节点是主题绿（accent），它展开后的子节点又全部由 accent 派生，所以屏幕上能看到的几乎只有「绿（阅读节点）+ 黑（它的子节点）」两种。问题 1 让「阅读节点＝某一章、被自动展开」成了常态，黑色因此更多 | `layout.ts` L259–270 `mixHex` / `kidColor` |

> 第 4 条的核实办法（改之前 30 秒就能确认）：DevTools 选中一条黑色彩带 → 找到它 `fill` 指向的 `linearGradient` → 查看 `<stop>` 的 `stop-color`。如果是 `color-mix(...)`，根因就确认了。

---

## 13.1 层级：按「最深的组」显示，并允许下钻（取代 §12.4.2 的 `decideAttention`）

**规则**：
- 样本的**显示组** D(s) 是它最深节点的父节点，**上层组** P(s) 是 D 的父节点。
- 样本只在两种情况下归组 G：D(s) = G（最深节点就是 G 的成员），或 P(s) = G（最深节点是 G 某个成员的子节点，此时在 G 里展开这个成员就能看到）。**G 的更深子孙不再算给 G。**
- §12.4.2 要点第 2 条（「样本落在更深处仍算当前组、不换组」）作废，改为：只深一层时留在本组并展开该成员；视口几乎完全落在某个成员内部并驻留之后，「放大」进这个成员。

### 13.1.1 `layout.ts`：替换 `ATTN`、`AttnResult`、`groupOfChain`、`under`、`memberIn`、`decideAttention`（照抄）

```ts
export const ATTN = {
  FRACS: [0.12, 0.38, 0.62, 0.88], W: [0.10, 0.50, 0.28, 0.12],
  SWITCH: 0.6, LEAVE: 0.25, HOLD: 0.5,
  ZOOM: 0.9,        // 视口 ≥90% 权重落在当前组某个成员的子节点里 → 驻留后放大进该成员
  DWELL_MS: 600, NODE_DWELL_MS: 250, PEEK_MIN: 0.1,
};
export interface AttnSample { frac: number; nodeId: string | null; chain: string[] }
export interface AttnState { groupId: string | null; readingId: string | null; candGroup: string | null; candSince: number; candNode: string | null; nodeSince: number }
export interface AttnResult extends AttnState {
  peek: { groupId: string; side: "above" | "below" } | null;
  switched: "" | "down" | "up";
  /** 注意力样本落在某个成员的子节点里 → 返回该成员（宿主据此自动展开） */
  deepMember: string | null;
  /** 有候选组在等驻留：宿主应在这么多 ms 后（滚动已停时）再取一次样；null 表示不需要 */
  recheckMs: number | null;
}
/** 显示组：最深节点的父（顶层节点的父＝ROOT_ID） */
const groupOfChain = (chain: string[]) => (chain.length >= 2 ? chain[chain.length - 2] : ROOT_ID);
/** 上层组：显示组的父；chain 只有 1 个节点时为 null */
const upperOfChain = (chain: string[]) => (chain.length >= 3 ? chain[chain.length - 3] : chain.length === 2 ? ROOT_ID : null);
/** 样本是否归 G 显示：最深节点是 G 的成员，或是 G 某成员的子节点。G 的更深子孙不算——这正是旧版卡在顶层的根因 */
const belongs = (s: AttnSample, G: string) => !!s.nodeId && (groupOfChain(s.chain) === G || upperOfChain(s.chain) === G);
/** 样本在 G 下对应的成员 */
const memberIn = (s: AttnSample, G: string): string | null => {
  if (!s.nodeId) return null;
  if (groupOfChain(s.chain) === G) return s.chain[s.chain.length - 1];
  if (upperOfChain(s.chain) === G) return s.chain[s.chain.length - 2];
  return null;
};

export function decideAttention(samples: AttnSample[], prev: AttnState, now: number, o: { paged: boolean; idle: boolean }): AttnResult {
  const W = (f: number) => ATTN.W[ATTN.FRACS.indexOf(f)] ?? 0;
  const hit = samples.filter((s) => s.nodeId);
  const score = (G: string) => hit.reduce((a, s) => a + (belongs(s, G) ? W(s.frac) : 0), 0);
  const exact = (G: string) => hit.reduce((a, s) => a + (groupOfChain(s.chain) === G ? W(s.frac) : 0), 0);
  const upperOf = new Map<string, string | null>();          // 显示组 → 它的上层组（从样本 chain 推得）
  for (const s of hit) upperOf.set(groupOfChain(s.chain), upperOfChain(s.chain));
  const cands = [...upperOf.keys()].map((g) => [g, exact(g)] as const).sort((a, b) => b[1] - a[1]);
  const best = cands[0]?.[0] ?? null;
  const st: AttnState = { ...prev };
  const cur = prev.groupId;
  const curScore = cur ? score(cur) : 0;
  let recheckMs: number | null = null;
  /** 驻留：同一候选持续 need ms 且滚动已停才算数；翻页模式不等 */
  const dwell = (g: string, need: number): boolean => {
    if (o.paged) return true;
    if (prev.candGroup !== g) { st.candGroup = g; st.candSince = now; recheckMs = need; return false; }
    const left = need - (now - prev.candSince);
    if (left <= 0 && o.idle) return true;
    recheckMs = Math.max(0, left);
    return false;
  };
  if (!best) { /* 全部落空：保持现状 */ }
  else if (!cur || curScore === 0) { st.groupId = best; st.candGroup = null; }   // 首次，或旧组已完全不在视口
  else if (best === cur) st.candGroup = null;
  else {
    const bs = exact(best);
    const zoomIn = upperOf.get(best) === cur;                                       // best 是 cur 的某个成员 → 放大
    if (zoomIn) {
      if (bs >= (cur === ROOT_ID ? ATTN.SWITCH : ATTN.ZOOM)) { if (dwell(best, ATTN.DWELL_MS)) st.groupId = best; }
      else st.candGroup = null;
    } else if (bs >= ATTN.SWITCH && curScore <= ATTN.LEAVE) st.groupId = best;
    else if (bs >= ATTN.HOLD && bs > curScore) { if (dwell(best, ATTN.DWELL_MS)) st.groupId = best; }
    else st.candGroup = null;
  }
  let switched: AttnResult["switched"] = "";
  if (st.groupId !== cur && cur && st.groupId) {
    const meanF = (G: string) => { const l = hit.filter((s) => belongs(s, G)); return l.length ? l.reduce((a, s) => a + s.frac, 0) / l.length : 0.5; };
    switched = meanF(st.groupId) >= meanF(cur) ? "down" : "up";
    st.candGroup = null;
    recheckMs = null;
  }
  // 阅读节点：本组内离 38% 最近的样本对应的成员；节点变化需驻留（切组 / 翻页 / 首次不需要）
  const G = st.groupId;
  let node: string | null = null, deepMember: string | null = null;
  if (G) {
    const inG = hit.filter((s) => belongs(s, G)).sort((a, b) => Math.abs(a.frac - 0.38) - Math.abs(b.frac - 0.38));
    if (inG.length) { node = memberIn(inG[0], G); if (groupOfChain(inG[0].chain) !== G) deepMember = node; }
  }
  if (switched || !prev.readingId || o.paged) { st.readingId = node; st.candNode = null; }
  else if (node && node !== prev.readingId) {
    if (prev.candNode !== node) { st.candNode = node; st.nodeSince = now; }
    else if (now - prev.nodeSince >= ATTN.NODE_DWELL_MS) { st.readingId = node; st.candNode = null; }
  } else st.candNode = null;
  // 邻组预览：当前组之外、且不是当前组成员展开（上层组≠G）的组里得分最高、≥ PEEK_MIN 的那个
  let peek: AttnResult["peek"] = null;
  if (G) {
    const other = cands.find(([g, v]) => g !== G && upperOf.get(g) !== G && v >= ATTN.PEEK_MIN);
    if (other) {
      const mean = (l: AttnSample[]) => l.reduce((a, s) => a + s.frac, 0) / Math.max(1, l.length);
      const fO = mean(hit.filter((s) => groupOfChain(s.chain) === other[0]));
      const fG = mean(hit.filter((s) => belongs(s, G)));
      peek = { groupId: other[0], side: fO >= fG ? "below" : "above" };
    }
  }
  return { ...st, peek, switched, deepMember, recheckMs };
}
```

### 13.1.2 `useStructureFlow.ts`

1. **取样节流（替换 L212–222、L263–288 的 relocate 逻辑）**：
   - 加 `lastScrollAt`、`lastSampleAt`、`recheckTimer` 三个 ref，以及 `sampleSeq` 计数（每次 `sampleNow` 先 `const my = ++sampleSeq.current`，`await` 之后如果 `my !== sampleSeq.current` 就直接 return，丢掉过期的结果）。
   - `onScrollTick()`：`lastScrollAt = now`。如果距 `lastSampleAt` ≥ 250ms，立即 `sampleNow(false)` 并更新 `lastSampleAt`；否则，若当前没有挂起的计时器，就挂一个 `250 − 距离` 的计时器（**不要清掉已挂的计时器**，否则又退化成防抖）。然后重置 `idleTimer`：160ms 后执行 `sampleNow(true)`。
   - 滚动模式下，如果 `kernel.onContentScroll` 存在（§13.3.1），用它驱动 `onScrollTick`；`relocate` 只做 `scheduleSample(0)`（章节载入、跳转）。不存在时（PDF）沿用现在的 relocate 逻辑。翻页模式不变。
   - `sampleNow` 拿到 `next.recheckMs != null` 时：清掉旧的 `recheckTimer`，再挂一个 `Math.max(next.recheckMs, 160) + 20` ms 的计时器，到时执行 `sampleNow(performance.now() - lastScrollAt.current >= 160)`。
   - `sampleNow(idle)` 内部的 `idle` 改为 `idle || performance.now() - lastScrollAt.current >= 160`。
2. **自动展开（替换 L335–356 的手风琴 effect 与 `toggleExpand`）**：
   ```ts
   const deepRef = useRef<string | null>(null);          // sampleNow 里：deepRef.current = next.deepMember（变化时 setAttnTick）
   const manualExpRef = useRef(false);
   useEffect(() => { manualExpRef.current = false; }, [groupId, readingId]);   // 必须写在下面这个 effect 之前
   useEffect(() => {
     if (!graph || !groupId) { if (expandedId != null) setExpandedId(null); return; }
     if (manualExpRef.current) return;
     const want = deepRef.current && graph.nodes[deepRef.current] ? deepRef.current : null;
     if (want !== expandedId) setExpandedId(want);
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [graph, groupId, readingId, deepRef.current]);
   const toggleExpand = useCallback((id: string) => {
     manualExpRef.current = true;
     setExpandedId((cur) => (cur === id ? null : id));
     setSel(id);
     setExplainFor(null);
   }, []);
   ```
   `focusGroup` 也要设 `manualExpRef.current = false`。
3. `attnRef` 的写回保持现状（`AttnState` 的 6 个字段）；`deepMember` / `recheckMs` 不进 `attnRef`。

### 13.1.3 宿主的动效判定（`StructureFlowHost.tsx` L550–557）

不用改。`zoom-in` / `zoom-out` 的判定本来就依据「新组是否属于旧成员」，现在终于会被触发了。

---

## 13.2 列位置稳定（取代 §8.4 / §12.5 的「停下后对齐阅读段」）

**规则**：结构列的**主体顶边固定在视口里的同一高度**，滚动、阅读节点移动、预览出现或消失，都不会让主体移动。主体只在切组时随 §12.4.5 的编排变化（元素各自位移），列本身不平移。

### 13.2.1 常量（追加到 `layout.ts`）

```ts
export const COLUMN = { ABOVE_ROWS: 2, ABOVE_SLOT: 20 + 2 * 22 + 8 };   // 上方预览的固定槽：标题 20 + 2 行 × 22 + 间距 8 = 72
```

### 13.2.2 `layoutPeek` 增参数 `maxRows: number`

`const show = kids.slice(0, Math.max(0, maxRows));`（替代 `PEEK.MAX_ROWS`），其余不变。

### 13.2.3 `fitLayout` 窗口粘滞

`base` 增加可选字段 `winStart?: number`。`win` 改成下面这样：
```ts
const win = (max: number) => {
  const k = base.winStart;
  if (k != null && k >= 0 && k + max <= all.length) {
    const lo = k + (k > 0 ? 1 : 0), hi = k + max - 1 - (k + max < all.length ? 1 : 0);
    if (ri >= lo && ri <= hi) return { members: all.slice(k, k + max), moreAbove: k, moreBelow: all.length - k - max };
  }
  const start = Math.max(0, Math.min(ri - Math.floor((max - 1) / 2), all.length - max));
  const end = Math.min(all.length, start + max);
  return { members: all.slice(start, end), moreAbove: start, moreBelow: all.length - end };
};
```
（意思是：阅读节点还在窗口内、且不在会被「另 N 项」遮住的边缘行时，窗口不动。）

### 13.2.4 宿主 `scene`（替换 L618–651 的预览拼接与 dy 计算）

```ts
const top = vp.top + FLOW.COL_MARGIN_Y, bottom = vp.bottom - FLOW.COL_MARGIN_Y;
const mainTop = top + COLUMN.ABOVE_SLOT;
const mainAvail = Math.max(160, bottom - mainTop);                       // 与预览有无无关 → 折叠结果稳定
const main = fitLayout({ ...fitBase, availH: mainAvail, winStart: winRef.current.get(cut!) }, all, mainAvail);
winRef.current.set(cut!, Math.max(0, all.indexOf(main.members[0])));    // winRef = useRef(new Map<string, number>())；文档切换时清空
let above: PatternLayout | null = null, below: PatternLayout | null = null;
if (data.peek?.side === "above") above = layoutPeek(ctx, data.peek.groupId, "above", COLUMN.ABOVE_ROWS);
if (data.peek?.side === "below") {
  const room = bottom - (mainTop + main.height) - PEEK.GAP;
  const rows = Math.min(PEEK.MAX_ROWS, Math.floor((room - 20 - 16) / PEEK.ROW_H));
  if (rows >= 1) below = layoutPeek(ctx, data.peek.groupId, "below", rows);
}
// 列局部坐标：0 = top；主体恒在 ABOVE_SLOT；上方预览底对齐到主体上方 8px；下方预览紧跟主体
lay = mergeLayouts(main, above, below, {
  mainOff: COLUMN.ABOVE_SLOT,
  aboveOff: above ? COLUMN.ABOVE_SLOT - 8 - above.height : 0,
  belowOff: COLUMN.ABOVE_SLOT + main.height + PEEK.GAP,
});
let dy = top;
// 极端情况（fitLayout 最后的兜底仍然超高）：只允许吃掉上方槽，不随阅读位置变
if (main.height > mainAvail) { dy = top - Math.min(COLUMN.ABOVE_SLOT, main.height - mainAvail); }
```
- `mergeLayouts` 的第 4 个参数改成 `{ mainOff, aboveOff, belowOff }` 三个固定偏移，内部不再自行累加；`height = belowOff + below.height`（有下方预览时），否则 `mainOff + main.height`。
- `availH` 为 `avail` 的 `layoutPeek` 调用也换成上面的 `ctx`（即 `{ ...fitBase, members: all, moreAbove: 0, moreBelow: 0, maxLines0: 2, availH: mainAvail }`）。

### 13.2.5 删除

- `alignY` 状态、`updateAlign`、L507–511 的「稳定后对齐」effect，以及 `openSeq` / `beginTurn` / `finishTrack` 里对 `updateAlign` 的调用。
- `PatternLayout.readingY` 字段保留（测试可能用到），宿主不再读它。

---

## 13.3 彩带与文字同步（滚动模式）

**做法**：滚动模式下把彩带拆成两段。
- **段落上的高亮矩形**由内核画进**正文 iframe 的文档里**（绝对定位的 div + multiply）。它和文字在同一个滚动层，所以随正文原生滚动，与文字高亮的效果完全一样，宿主不需要逐帧处理。
- **从段落右缘弯到节点条的「颈部」**仍画在宿主的混合层里，但不再走 React：在正文 `scroll` 事件里同步算好路径，直接写 DOM。只有当某段落跨进或跨出视口、颈部集合变化时，才交给 React 渲染一次。

翻页模式和 PDF 不变（翻页本来就是离散的，沿用现有的「翻页后重采」流程）。

### 13.3.1 内核接口（`src/lib/reader/kernel.ts`，全部可选）

```ts
export interface ReaderParagraphBox {
  /* …现有字段不变… */
  /** §13.3：所在章节下标，以及章节文档坐标（＝iframe 视口坐标 + 文档自身滚动；不裁剪，滚动时不变） */
  doc?: number; cTop?: number; cBottom?: number; cLeft?: number; cRight?: number;
}
export interface ReaderStructurePaintRect { key: string; doc: number; left: number; top: number; width: number; height: number; color: string; alpha: number }
// ReaderKernel 增：
/** 正文滚动的逐帧通知（同步回调；foliate＝renderer 的 scroll 事件） */
onContentScroll?(cb: () => void): () => void;
/** 各已加载章节文档原点此刻的屏幕坐标（＝iframe 的 client rect − 文档自身滚动）；每帧调用，只做读取 */
getFrameOffsets?(): Record<number, { left: number; top: number }>;
/** 在正文文档内绘制段落高亮矩形（随正文原生滚动）；传 [] 表示淡出并清除 */
setStructurePaint?(rects: ReaderStructurePaintRect[], o: { blend: "multiply" | "screen"; fadeMs: number }): void;
/** 现有方法增参：all=true 时返回已加载文档里全部目标段落（不按视口纵向过滤；横向仍过滤，供翻页模式使用） */
getStructureGeometry?(opts?: { all?: boolean }): ReaderStructureGeometry | null;
```

### 13.3.2 foliate 适配器（`src/lib/reader/foliate/adapter.ts`）

1. **滚动通知**：`trackScrollActivity`（L248–253）里的 scroll 监听改成：
   ```ts
   renderer.addEventListener("scroll", () => {
     lastScrollAt = performance.now();
     for (const h of scrollHandlers) { try { h(); } catch { /* 宿主错误不影响阅读 */ } }
   }, { passive: true });
   ```
   在外层声明 `const scrollHandlers = new Set<() => void>();`。实现 `onContentScroll(cb) { scrollHandlers.add(cb); trackScrollActivity(); return () => { scrollHandlers.delete(cb); }; }`。（paginator L635 会把容器的 scroll 转发成自身的 `scroll` 事件，每帧一次，不带防抖。）
2. **`getFrameOffsets`**：
   ```ts
   getFrameOffsets() {
     const out: Record<number, { left: number; top: number }> = {};
     for (const [i, doc] of docs) {
       const fr = doc.defaultView?.frameElement?.getBoundingClientRect();
       if (!fr) continue;
       const se = doc.scrollingElement;
       out[i] = { left: fr.left - (se?.scrollLeft ?? 0), top: fr.top - (se?.scrollTop ?? 0) };
     }
     return out;
   },
   ```
3. **`getStructureGeometry(opts)`**：循环改为 `for (const [index, doc] of docs)`；在 `const se = doc.scrollingElement, sx = se?.scrollLeft ?? 0, sy = se?.scrollTop ?? 0;` 之后，`raw.push` 时带上 `doc: index, cTop: r.top + sy, cBottom: r.bottom + sy, cLeft: r.left + sx, cRight: r.right + sx`。`if (bottom - top < 6) continue;` 改成 `if (!opts?.all && bottom - top < 6) continue;`。导出处从 `getStructureGeometry,` 改为 `getStructureGeometry: (opts?: { all?: boolean }) => getStructureGeometry(opts),`。
4. **`setStructurePaint`**：
   ```ts
   const paintRoots = new WeakMap<Document, { root: HTMLDivElement; els: Map<string, HTMLDivElement> }>();
   let paintSpec: { rects: ReaderStructurePaintRect[]; blend: string; fadeMs: number } = { rects: [], blend: "multiply", fadeMs: 160 };
   const paintForDoc = (index: number) => {
     const doc = docs.get(index);
     if (!doc?.body) return;
     const mine = paintSpec.rects.filter((r) => r.doc === index);
     let P = paintRoots.get(doc);
     if (!P || !P.root.isConnected) {
       if (!mine.length) return;
       const root = doc.createElement("div");
       root.setAttribute("data-flow-paint", "1");
       root.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:2147483646;";
       doc.body.appendChild(root);
       P = { root, els: new Map() };
       paintRoots.set(doc, P);
     }
     P.root.style.mixBlendMode = paintSpec.blend;
     const base = P.root.getBoundingClientRect();
     const se = doc.scrollingElement, ox = base.left + (se?.scrollLeft ?? 0), oy = base.top + (se?.scrollTop ?? 0);
     const seen = new Set<string>();
     for (const r of mine) {
       seen.add(r.key);
       let el = P.els.get(r.key);
       const fresh = !el;
       if (!el) {
         el = doc.createElement("div");
         el.style.cssText = `position:absolute;border-radius:3px 0 0 3px;pointer-events:none;opacity:0;transition:opacity ${paintSpec.fadeMs}ms ease,background-color 240ms ease;`;
         P.root.appendChild(el);
         P.els.set(r.key, el);
       }
       el.style.left = `${r.left - ox}px`; el.style.top = `${r.top - oy}px`;
       el.style.width = `${r.width}px`; el.style.height = `${r.height}px`;
       el.style.backgroundColor = r.color;
       const target = String(r.alpha);
       if (fresh) { const e = el; requestAnimationFrame(() => { e.style.opacity = target; }); } else el.style.opacity = target;
     }
     for (const [k, el] of P.els) if (!seen.has(k)) {
       el.style.opacity = "0";
       P.els.delete(k);
       window.setTimeout(() => el.remove(), paintSpec.fadeMs + 40);
     }
   };
   // 导出：
   setStructurePaint(rects, o) {
     paintSpec = { rects: Array.isArray(rects) ? rects : [], blend: o?.blend ?? "multiply", fadeMs: o?.fadeMs ?? 160 };
     for (const i of docs.keys()) paintForDoc(i);
   },
   ```
   - 章节文档载入完成的地方（L653 `docs.set` 之后、与 L732 `locateStructForDoc(index)` 同一处）补一句 `paintForDoc(index)`。
   - `data-flow-paint` 的节点里没有文字，不影响 `buildTextIndex`。它带 `pointer-events:none`，所以不影响 `elementFromPoint` 探针、划选和标记命中。
   - 坐标说明：`r.left/top` 是 §13.3.2-3 里的文档坐标；`ox/oy` 是 root 在同一坐标系里的原点，正文的 `body` 即使带 `position`/`margin` 也不会错位。

### 13.3.3 纯函数（`layout.ts`）

1. **抽出合并逻辑**：把 `buildShapes` 的第 1–2 步抽成 `export function mergeSpans(boxes: ReaderParagraphBox[], keep: Set<string>)`，返回 `{ nodeId, doc, column, left, right, top, bottom }[]`；合并条件增加 `last.doc === b.doc`。`buildShapes` 改为调用它，行为不变。
2. **屏幕几何**：
   ```ts
   /** 文档坐标的几何 + 此刻的章节偏移 → 屏幕几何（裁到视口；与适配器原先的裁剪规则一致） */
   export function geometryAt(geo: ReaderStructureGeometry, offs: Record<number, { left: number; top: number }>): ReaderStructureGeometry {
     const vp = geo.viewport;
     const boxes: ReaderParagraphBox[] = [];
     for (const b of geo.boxes) {
       const o = b.doc != null ? offs[b.doc] : undefined;
       if (!o || b.cTop == null || b.cBottom == null || b.cLeft == null || b.cRight == null) { boxes.push(b); continue; }
       const T0 = b.cTop + o.top, B0 = b.cBottom + o.top;
       const top = Math.max(T0, vp.top), bottom = Math.min(B0, vp.bottom);
       if (bottom - top < 6) continue;
       boxes.push({ ...b, left: b.cLeft + o.left, right: b.cRight + o.left, top, bottom, clipTop: T0 < vp.top, clipBottom: B0 > vp.bottom });
     }
     return { ...geo, boxes };
   }
   ```
3. **颈部路径与收拢**：
   ```ts
   /** 只画「段落右缘 → 节点 port」那一段（矩形部分在正文里） */
   export function neckPath(s: Pick<FlowShape, "xs" | "s0" | "s1" | "x1" | "t0" | "t1">): string {
     const f = (n: number) => Math.round(n * 10) / 10;
     const xm = (s.xs + s.x1) / 2;
     return `M${f(s.xs)},${f(s.s0)}C${f(xm)},${f(s.s0)} ${f(xm)},${f(s.t0)} ${f(s.x1)},${f(s.t0)}` +
       `L${f(s.x1)},${f(s.t1)}C${f(xm)},${f(s.t1)} ${f(xm)},${f(s.s1)} ${f(s.xs)},${f(s.s1)}Z`;
   }
   /** 收在段落右缘（滚动模式开场的起点 / 关闭的终点） */
   export const collapseAtEdge = (s: FlowShape): FlowShape => ({ ...s, x1: s.xs, t0: s.s0, t1: s.s1 });
   ```
4. **正文矩形**：
   ```ts
   export function buildPaintRects(geo: ReaderStructureGeometry, lay: PatternLayout, o: {
     hoverId: string | null; focusId: string | null; hoverSet?: Set<string>; colorOf: (id: string) => string;
     extra?: { nodeId: string; color: string }[]; colors: FlowColors;
   }): ReaderStructurePaintRect[] {
     const keep = new Set([...lay.ports.map((p) => p.nodeId), ...(o.extra ?? []).map((e) => e.nodeId)]);
     const extraColor = new Map((o.extra ?? []).map((e) => [e.nodeId, e.color] as const));
     const content = geo.boxes
       .filter((b) => b.doc != null && b.cTop != null)
       .map((b) => ({ ...b, top: b.cTop!, bottom: b.cBottom!, left: b.cLeft!, right: b.cRight! }));
     const tone = (id: string): 0 | 1 | 2 => (id === o.hoverId ? 2 : o.hoverSet?.has(id) || id === o.focusId ? 1 : 0);
     return mergeSpans(content, keep).map((s) => {
       const t = tone(s.nodeId);
       const dim = !!o.hoverId && s.nodeId !== o.hoverId && t === 0;          // 与 FlowLayer 的 is-dim 同一规则
       return { key: `${s.nodeId}@${s.doc}:${Math.round(s.top)}`, doc: s.doc!, left: s.left, top: s.top, width: s.right - s.left, height: s.bottom - s.top,
         color: extraColor.get(s.nodeId) ?? o.colorOf(s.nodeId), alpha: o.colors.aHL[t] * (dim ? o.colors.aDim : 1) };
     });
   }
   ```
   矩形的右缘等于颈部的 `xs`，上下边等于颈部的 `s0/s1`（未裁剪时），透明度等于颈部渐变起点的 `aHL[tone]`，所以接缝处颜色连续。

### 13.3.4 宿主（`StructureFlowHost.tsx`）

```ts
const smooth = scrolled && !!kernel?.onContentScroll && !!kernel?.getFrameOffsets && !!kernel?.setStructurePaint;
```
1. **几何采样**：`sampleGeometry` 调用 `kernel.getStructureGeometry(smooth ? { all: true } : undefined)`；签名串里补上 `b.doc`、`b.cTop | 0`。
2. **拆 `useMemo`**（性能前提）：现在的 `scene` 拆成两层。
   - `base = useMemo(...)`：plan、版式、`fitLayout`、预览、`mergeLayouts`、`dy`、`hoverSet`、`extra`、`colorOf`、`buildStrands`。依赖里**去掉** `geo`（`buildStrands` 只用 `geo.text.right`，单独把 `textRight` 作为一个依赖）。
   - `scene = useMemo(...)`：在 `base` 之上算 `shapes`。依赖 `base`、`geo` 和 `frameTick`。smooth 时 `const g = geometryAt(geoRef.current, kernel.getFrameOffsets())`，否则用 `geoRef.current`；算完以后 `shapeSigRef.current = shapes.filter((s) => s.ribbon).map((s) => s.id).join("|")`。
   - 同时把 `{ lay, dy, opts }` 写进 `frameRef.current`，供逐帧函数使用。
3. **逐帧函数**（不调 `setState`，除非颈部集合变了）：
   ```ts
   const neckEls = useRef(new Map<string, SVGPathElement>());
   const [frameTick, setFrameTick] = useState(0);
   const paintFrame = useCallback(() => {
     const base = geoRef.current, F = frameRef.current;
     if (!smooth || !base || !F || !kernel?.getFrameOffsets) return;
     const g = geometryAt(base, kernel.getFrameOffsets());
     const shapes = buildShapes(g, F.lay, F.dy, F.opts).filter((s) => s.ribbon);
     const sig = shapes.map((s) => s.id).join("|");
     if (sig !== shapeSigRef.current) { flushSync(() => setFrameTick((n) => n + 1)); return; }   // 有段落跨过视口边缘：渲染一次
     for (const s of shapes) {
       const el = neckEls.current.get(s.id);
       if (!el) continue;
       const d = s.stub ? shapePath(s) : neckPath(s);
       el.style.transition = "none";
       el.setAttribute("d", d);
       el.style.setProperty("d", `path("${d}")`);
     }
   }, [smooth, kernel]);
   ```
   （`flushSync` 从 `react-dom` 引入，保证进入视口的那一帧就有颈部。）
4. **滚动跟踪**（smooth 时替代 L438–482 的 relocate 驱动）：
   ```ts
   useEffect(() => {
     if (!smooth || !kernel || stage === "closed" || stage === "closing") return;
     let idle: number | null = null;
     const off = kernel.onContentScroll!(() => {
       if (!trackingRef.current) { trackingRef.current = true; setTracking(true); setMotion("track"); }
       paintFrame();
       if (idle != null) window.clearTimeout(idle);
       idle = window.setTimeout(() => {
         idle = null;
         trackingRef.current = false;
         for (const el of neckEls.current.values()) el.style.transition = "";
         sampleGeometry(true);        // 停下后刷新文档坐标（可能有新段落载入）；不 bump、不做对齐
         setTracking(false);
         setMotion("steady");
       }, FLOW.TRACK_IDLE_MS);
     });
     return () => { off(); if (idle != null) window.clearTimeout(idle); };
   }, [smooth, kernel, stage, paintFrame, sampleGeometry]);
   ```
   smooth 时，L465–482 的 relocate 监听只做 `sampleGeometry(true); syncPlan();`，**不调** `beginTrack`。
5. **正文矩形下发**：
   ```ts
   useEffect(() => {
     if (!smooth || !kernel?.setStructurePaint) return;
     const o = { blend: colors.dark ? "screen" as const : "multiply" as const, fadeMs: stage === "opening" ? 360 : 180 };
     const F = frameRef.current;
     if (!scene || !F || stage === "closed" || stage === "closing" || !geoRef.current || (scene.mode === "whisper" && !scene.hoverId)) { kernel.setStructurePaint([], o); return; }
     kernel.setStructurePaint(buildPaintRects(geoRef.current, scene.layout, { ...F.opts, colors }), o);
   }, [smooth, kernel, scene?.layout, geo, data.hoverId, data.sel, data.readingId, colors, stage]);
   useEffect(() => () => kernel?.setStructurePaint?.([], { blend: "multiply", fadeMs: 0 }), [kernel]);
   ```
   whisper 模式原来只在悬停时出流带，这里沿用同一规则。
6. **FlowLayer 传参**：`scene.smooth = smooth`；`FlowLayer` 增 prop `registerShape?: (id: string, el: SVGPathElement | null) => void`，宿主传入 `(id, el) => el ? neckEls.current.set(id, el) : neckEls.current.delete(id)`。

### 13.3.5 渲染器（`FlowLayer.tsx` 的 `flow-shapes` 段，L155–171）

```tsx
{shapesP.map(({ item: s, phase }, i) => {
  if (scene.smooth && !s.ribbon) return null;                       // 矩形已经画在正文里了
  const g = scene.smooth
    ? (phase === "exit" || (!armed && motion === "open") || motion === "close" ? collapseAtEdge(s) : s)
    : shapeGeom(s, phase);
  const d = scene.smooth && !s.stub ? neckPath(g) : shapePath(g);
  const dim = !!hoverId && s.nodeId !== hoverId && s.tone === 0;
  return (
    <path key={s.id} ref={(el) => registerShape?.(s.id, el)} className={`flow-shape${dim ? " is-dim" : ""}`} d={d}
      fill={s.stub ? `url(#fst-${s.id.replace(/[^a-zA-Z0-9_-]/g, "_")})` : `url(#fg-${ci(s.color)}-${s.tone})`}
      style={{ d: `path("${d}")`, ...vars(shapeDelay(i)) }} data-node-id={s.nodeId} data-tone={s.tone} />
  );
})}
```
CSS 追加一条：`.flow-blend[data-smooth="1"][data-tracking="1"] .flow-shape { transition: none !important; }`，并在 `SvgRoot className="flow-blend"` 上加 `data-smooth={scene.smooth ? "1" : undefined}`。

---

## 13.4 黑色彩带（颜色永不产出 `color-mix()`）

### 13.4.1 `layout.ts` 替换 `mixHex` / `kidColor`（L259–270）

```ts
/** #rgb / #rrggbb / rgb() / rgba()（逗号或空格分隔）→ [r,g,b]；其它返回 null */
export function parseRgb(c: string): [number, number, number] | null {
  const s = String(c || "").trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)) as [number, number, number];
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (m) return [m[1], m[2], m[3]].map((v) => Math.round(Math.min(255, Math.max(0, Number(v))))) as [number, number, number];
  return null;
}
const mixHex = (a: string, b: string, pct: number): string | null => {
  const A = parseRgb(a), B = parseRgb(b);
  if (!A || !B) return null;
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${A.map((v, i) => hex(v * (1 - pct / 100) + B[i] * (pct / 100))).join("")}`;
};
/** 永远返回实色：解析不了就用父色本身 */
export const kidColor = (parent: string, bg: string, j: number) => mixHex(parent, bg, [0, 22, 40][j % 3]) ?? parent;
```

### 13.4.2 子节点颜色不再由主题绿派生

阅读节点的颜色是 accent（绿），这只该体现在它自己的条、胶囊和流带上。它展开后的子节点应该从该成员的**调色板色**派生，否则阅读段落里会一片绿。
- `LayoutCtx` 增 `paletteOf: Map<string, string>`，宿主构造为 `new Map(all.map((id, i) => [id, colors.palette[i % 8]]))`，即忽略 accent。
- `layoutTree` L358 和 `pushKidList` L512 里，`kidColor` 的第一个参数改为 `c.paletteOf.get(id) ?? c.colorOf.get(id)!`（`pushKidList` 里对应的是 `parentId`）。

### 13.4.3 渲染兜底（`FlowLayer.tsx`）

在 `colorIndexer` 之前加：`const safe = (c: string) => (parseRgb(c) ? c : colors.palette[0]);`。`linearGradient` 的 `stopColor`、正文矩形的 `color`（`buildPaintRects` 里同样包一层 `safe`）一律经过 `safe()`。这样以后哪里再传进不可解析的颜色，最多显示成调色板第一色，不会变黑。

---

## 13.5 测试与验收

### 13.5.1 `tests/flow.layout.test.cjs`

- `decideAttention`：现有 7 例保持通过（第 6 例另断言 `r1.deepMember === "a2"`）。新增以下用例，其中 `S2 = (frac, chain) => ({ frac, nodeId: chain[chain.length-1], chain })`：
  8. **顶层不再卡住**：`prev.groupId = ROOT_ID`，4 个样本的 chain 都是 `["c1","s11","p3"]` → 立即 `groupId === "s11"`，`switched !== ""`。
  9. **顶层下钻要驻留**：`prev.groupId = ROOT_ID`，chain 都是 `["c1","s11"]` → 第一次调用（t=0，非 idle）`groupId === ROOT_ID`、`deepMember === "c1"`、`recheckMs === 600`；t=650 且 `idle:true` 再调用 → `groupId === "c1"`。
  10. **深一层留在本组**：`prev = st({ groupId: "s11", readingId: null })`，12% 在 `["c1","s11","p2"]`，其余在 `["c1","s11","p3","p3a"]` → `groupId === "s11"`、`readingId === "p3"`、`deepMember === "p3"`，且（因为 exact(p3)=0.9 ≥ ZOOM）`candGroup === "p3"`。
  11. **放大**：接 10，4 个样本全在 `p3a`，t=700、`idle:true` → `groupId === "p3"`。
  12. **缩回**：`prev.groupId = "p3"`，4 个样本都在 `["c1","s11","p4"]` → 立即 `groupId === "s11"`（旧组得分为 0）。
  13. **预览不把成员展开当邻组**：`prev.groupId = "s11"`，12%/38% 在 `["c1","s11","p2"]`，62%/88% 在 `["c1","s11","p3","p3a"]` → `peek === null`。
- `kidColor("rgb(22, 106, 89)", "rgb(250, 250, 248)", 1)` 返回 `/^#[0-9a-f]{6}$/`；`kidColor("rgb(22 106 89)", "#fafaf8", 2)` 同上；任何输入都不包含 `color-mix`。
- `fitLayout` 粘滞：20 个成员、`MAX_MEMBERS` 个窗口，阅读节点从 i 走到 i+1（仍在窗口内部）时，`members[0]` 不变。
- `geometryAt`：一个 `cTop=100,cBottom=160` 的盒，偏移 `top=-50` → `top=50,bottom=110`；偏移 `top=-200` → 被裁掉。
- `buildPaintRects` 与 `buildShapes` 对齐：同一几何（未裁剪）下，每个矩形的 `left+width === 对应 ribbon 形状的 xs`，`top === s0`，`top+height === s1`。

### 13.5.2 `tests/flow.dom.test.cjs`

- 假内核补上 `onContentScroll`（保存回调）、`getFrameOffsets`（返回可变的 `{0:{left:0,top:offY}}`）、`setStructurePaint`（记录最后一次参数），以及 `getStructureGeometry(opts)`（带 `doc/cTop…`）。
- **同步滚动**：打开结构图并稳定后，记下某个 `.flow-shape` 元素的引用和 React 渲染计数；把 `offY` 改成 −30 并调用滚动回调 → **同一调用栈里**该元素的 `d` 已经变了（第 2 个坐标减少 30），元素引用 `===` 不变，渲染计数不变。
- **矩形在正文**：`setStructurePaint` 收到的矩形数等于可见流带数；滚动回调**不会**再触发 `setStructurePaint`。
- **列稳定**：改变假探针分布，让阅读节点在同组内移动、预览出现又消失 → `.flow-items` 的 `transform` 字符串前后完全相同。
- **无黑色**：所有 `linearGradient stop` 的 `stop-color` 都能被 `parseRgb` 解析。

### 13.5.3 用户实机验收

1. 从目录页一路往下滚：进入第 1 章正文后，结构图应显示到最细的一层（小节，或小节下的论点），而不是一直停在「目录-第1章-第2章」。在某个论点内部读一会儿，结构会放大进去；读回下一个论点时会缩回。
2. 滚动时结构列的主体纹丝不动，只有阅读高亮在行之间移动；下一部分的预览出现或消失时，主体也不动。
3. 慢滚、快滚、触控板惯性滚动时，段落上的高亮和文字之间没有任何相对位移；颈部跟着段落弯动，没有可见的滞后。
4. 彩带是多种颜色（橄榄、琥珀、玫红、青、蓝……），阅读节点是主题绿，阅读节点的子节点是它调色板色的深浅变化。任何情况下都不再出现黑色块。

---

## 13.6 易错点

- `belongs` 只看「深 0 层或深 1 层」。**不要**为了「保险」把 `chain.includes(G)` 加回去，那样问题 1 会原样复发。
- `onScrollTick` 是**节流**，不是防抖：已经挂着的计时器不能清掉。
- 写 `d` 时必须同时写 `style.d`。`.flow-shape` 的 CSS `d` 属性优先级高于 `d` attribute，只写 attribute 屏幕上不会有变化。
- 逐帧函数里只能做「读几何（一次 `getFrameOffsets`）→ 纯计算 → 写 DOM」，**不能**在写 DOM 之后再读任何布局属性，否则会强制同步布局。
- 正文矩形的 `key` 用文档坐标的 `top` 取整，不能用序号，否则滚动中一有段落进出，所有矩形都会重建并闪烁。
- 翻页模式（`smooth === false`）一行都不要动它的现有流程。PDF 没有这三个新方法，自动走旧路。
- `ROOT_ID` 在 hook 里已经从 chain 中过滤掉了（L171），`decideAttention` 不要再处理书根。

---

## 14. 第二轮实机反馈（v3.3，D251）

> 2026-10-30。本文第 14 节，针对实机又一批 5 个问题。**优先级：§14 > §13 > §12 > 前文。**
> 每条按「根因 → 定稿做法 → 数值」写死；用户已就 8 个口径拍板（见 14.0）。

### 14.0 已拍板口径

| 编号 | 问题 | 定稿 |
|---|---|---|
| D-裁决 1 | 已读/未读语义 | **做**：位置型（阅读块之前＝已读），同身份色降档 + 条左缺口；不加色相、不落库、不加过渡 |
| D-裁决 2 | 手动展开/收起的有效期 | **同组内永久手动优先**：只有 `groupId` 变化才清手动标记；`readingId` 变化不清 |
| D-裁决 3 | 彩带最小宽度 | **保留 64–96 弹性**（判定阈值仍 `BRAID_MIN`）；拉伸必须丝滑由 14.5 负责 |
| D-裁决 4 | 宽屏让位形态 | **正文 + 彩带 + 节点列三者为一体、整体居中**（不是正文居中、列贴右） |
| D-裁决 5 | 重复组去重 | C + A：`focusGroup` 清预览；`peek.groupId === cut` 不画预览；`mergeLayouts` 主项优先兜底 |
| D-裁决 6 | 顶部留白 | Q2：`COL_MARGIN_Y 16→20`、`ABOVE_SLOT 72→88` |
| D-裁决 7 | 色条与动作行 | 条高仍＝标签高；动作行永远在条外，视觉做轻 |
| D-裁决 8 | 修复节奏 | 五个独立提交：P0 → 问题 4 → 问题 1 → 问题 2 → 问题 5 |

### 14.1 P0：结构流 Token 被一条残缺注释吞掉（先修，否则其余四项无法归因）

**根因**：`theme.css` 第 9939 行起是注释正文，但上一段注释已在 9926 行闭合，这里**漏写了 `/*`**。结尾的 `*/` 成了非法记号，紧随的 `:root { --flow-c1 … }` 被并进同一个非法选择器 → **整条规则被 CSS 解析器丢弃**。

**后果**：① `--flow-c1…c8` / `--flow-counter` 全部未定义 → `readColor("var(--flow-c1)", fallback)` 在真浏览器里拿到的是「继承出来的正文色」，是合法颜色，兜底拦不住 → 8 色 palette 与反方色全变近黑（问题 3 的全部现象）；② `--flow-ease` / `--flow-t-geo` 未定义 → `.flow-shape` / `.flow-items` / `.flow-item` 等**所有** `transition` 声明失效（`var()` 无 fallback）→ 全部位移动画消失（「生硬 / 跳变」的主因之一）。

**做法**：补 `/*`。另加一条**源码级闸门** `tests/flow.css-tokens.test.cjs`：剥离注释后必须能找到 `--flow-c1` 与 `--flow-ease` 的定义，且 `--flow-c1` 的出现位置不在注释内。**不要**给这些 Token 加 CSS fallback（数值真源仍只在 `:root` 一处）。

### 14.2 问题 4：展开/收起的状态与身份

四条规则（照抄）：

1. **预览与主体同 id 不许互相吞**：`mergeLayouts` 的 `seen` 先用主体建，再 push 预览（重复 id 丢弃）。同时宿主在 `peek.groupId === cut` 时**直接不画预览**；`focusGroup` 必须 `peekRef.current = null` 后再 bump。
2. **动作行只锚主体行**：`selected` 的查找必须带 `!i.peek`；找不到就整块不渲染（不回落到预览行）。
3. **收起即离开**：`toggleExpand` 在「当前已展开、本次点击是收起」时 `setSel(null)` + `setExplainFor(null)`。
4. **手动优先（同组）**：`manualExpRef` 只在 `groupId` 变化时清；`readingId` 变化不清。自动展开 effect 在不处于手动态时才跟随 `deepMember`。

### 14.3 问题 1：顶部槽位够高、列不越顶

```ts
COLUMN.ABOVE_SLOT = 20 + 2 * 22 + 16 + 8;   // 88：标题 20 + 2 行 × 22 + 「另 N 项」16 + 间距 8
FLOW.COL_MARGIN_Y = 20;                      // 16 → 20
aboveOff = Math.max(0, COLUMN.ABOVE_SLOT - 8 - above.height);
// dy：只允许吃掉上方槽的【剩余】部分，永不越过视口顶
const eat = Math.min(Math.max(0, COLUMN.ABOVE_SLOT - (above?.height ?? 0) - 8), Math.max(0, main.height - mainAvail));
let dy = top - eat;
```
验收：当预览为「2 行 + 另 N 项」时，预览顶 = `vp.top + 20`（不再贴 0）；主体顶 = `vp.top + 108`。

### 14.4 问题 2：矩形右缘渐隐 + 接缝连续

**用户新口径**：正文下的高亮块视觉上做成透明，只在最右端保留一小段向左变淡的颜色，与彩带向左变淡衔接，形成「渐渐消失」。

1. **矩形改渐变**（画在正文 iframe 里）：元素自身 `opacity = aHL[tone]`（× dim 因子），背景改为
   `linear-gradient(90deg, transparent 0, transparent calc(100% − HL_FADE_W), currentColor 100%)`，`color = 该节点的 port 色`。
   `FLOW.HL_FADE_W = 140`。矩形宽度 < 140 时整块都在渐变里，不会出硬边。
   **颜色必须与彩带同源**：新增 `portColorOf`（由 `lay.ports` 建 Map）传给 `buildPaintRects`，子节点不再回落 `palette[0]`。
2. **颈部改 per-shape 渐变**：`<linearGradient gradientUnits="userSpaceOnUse" x1={s.xs} x2={s.x1}>`，`stop 0 = aHL[tone]`、`stop 1 = aEnd[tone]`。
   这样**任何 braid 宽度下**接缝处透明度都恰好等于矩形右端的 `aHL`（§13.3.3 的原文意图），不再依赖 `BRAID_PREF=96` 的平台段定标。
3. **消除抗锯齿缝**：矩形宽 +1px，压住 iframe div 与 SVG path 各自抗锯齿产生的 1px 亮线。
4. 混合模式不变（浅色 `multiply` / 深色 `screen`）。

### 14.5 问题 5：宽度分配改成「三件一体、整体居中」

**目标**：`[正文 | 彩带 | 节点列]` 视为一个整体，在视口内居中；窗口怎么拉都成立。

1. **`planColumn` 增加居中目标**（`lw = LABEL_W`）：
```ts
const total = textW + FLOW.BRAID_PREF + blockW(lw);      // textW = textRight − textLeft
const idealLeft = vp.left + (vw - total) / 2;
let s = Math.max(0, ceilTo(textLeft - idealLeft, FLOW.SHIFT_STEP));  // 居中所需位移（常量 = (96+blockW)/2）
if (s > maxShift) s = ceilTo(FLOW.BRAID_MIN + blockW(lw) - room, FLOW.SHIFT_STEP);  // 退化为「够放就行」
if (s > maxShift) → reserve / compact / whisper（原逻辑不变）
barX = Math.round(Math.min(textRight - s + FLOW.BRAID_PREF, right - 4 - blockW(lw)));
```
   居中位移只与块宽有关（248 标签时为 **195**），与窗口宽无关；窗口变宽不会把列挤走。
2. **版心不再「只在 shift=0 时采样」**：改成 `baseW`（未预留时量到的正文宽），每次决策用 `base = 居中(vw, baseW)` 现算：
```ts
const w = Math.min(baseWRef.current, vw - 8);
base = { left: vp.left + (vw - w) / 2, right: vp.left + (vw + w) / 2 };
```
   这样 resize、shift、reserve 都不再互相污染（foliate 滚动模式是 `max-width + margin:auto`，居中假设成立）。
3. **缩放逐帧跟手**：ResizeObserver 回调里只做上面这条纯计算 + `setPlan`（rAF 合并），**不调** `getStructureGeometry`；拖动期间给 `body` 加 `data-flow-resizing`，CSS `body[data-flow-resizing="1"] .flow-shift-target { transition: none }`，停手 `FLOW.RESIZE_IDLE_MS`（200ms）后恢复（这时才允许 420ms 滑行）。
4. **模式滞回**：`inside`/`shift`/`reserve` 之间沿用 16px 滞回；reserve 的增删只在「停手 200ms 后」评估（会重排），拖拽过程中不切。

### 14.6 已读/未读（问题 3 的语义层）

- 判定：节点块完全早于阅读块（复用宿主 `sideOf === "above"`）。
- 表现：条 tone 96→84、条宽 −1px、条左留 2px 缺口（`bar` 的 x +1、w −1）；**不加过渡**（避免滚动时边界闪烁）。
- 不改色相、不落库、不动 `syncTables`。

### 14.7 测试与验收

- `tests/flow.css-tokens.test.cjs`（新）：注释剥离后 `--flow-c1` / `--flow-ease` 存在于非注释区。
- `tests/flow.layout.test.cjs`：`ABOVE_SLOT === 88`、`COL_MARGIN_Y === 20`；`planColumn` 居中用例（宽窗 1400 + 720 版心 → shift 195）；`buildPaintRects` 的 `fade === HL_FADE_W` 且颜色取自 port。
- `tests/flow.dom.test.cjs`：收起后无 `.flow-actions`；点预览后「组不重复、每个 `bar:*` 都有对应 `n:*`」；渐变首 stop 的 opacity === 矩形 alpha。
- 实机：顶部预览不贴顶；窗口 900→1800 连续拖动，列与正文的相对位置恒定（三件整体居中），彩带宽度不塌；展开/收起无残影、无浮空条。
