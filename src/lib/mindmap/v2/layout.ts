// 材料导图 v2 · 块组合布局框架（MINDMAP-V2-IMPL-PLAN §5.1 layout.ts；设计稿 §15.6 / §15.8）。
// 纯函数、确定性（无随机源、无 DOM、无时钟）；全部坐标为 4px 网格整数。
//
// ═══════════════════════════ 写一个新版式只需读这里 ═══════════════════════════
//
// 1. 模型：每个「组」＝一个有可见子节点的父节点。布局自底向上：先把每个子算成一个**块**
//    （矩形 + 锚点），再由该组的**版式**只把子块当作不透明矩形摆放，得到本组的块。
//
// 2. 版式签名：`PatternDef.layout(header, childBlocks, ctx) -> Block`
//    - header: Header —— 本组父卡片 { id, node, isRoot, w, h }。版式**不画**父卡片，只返回它的位置
//      `Block.anchor`；框架在 anchor 处放 card item（并带上四态徽标数据）。
//    - childBlocks: ChildBlock[] —— 已按原文顺序（S1）排好、已做 LOD 截断的子块（不透明：只有
//      id / kind / node / w / h / anchor / framed / count / cells；拿不到子块内部 items）。
//      kind 'more' 是框架追加的「另有 N 项」卡（可见子 >12 时只给前 7 个 + 它）；版式把它当普通叶卡摆，
//      但不要给它画先后线/时间刻度等语义边。
//    - ctx: PatternCtx —— 见下方接口注释：key / how / rule / parentPattern / groupId、几何常量 K、
//      g4/r4 取整、textWidth 估宽、node(id) 查节点、siblingEdges（两端都在本组已摆放子之间的关系）、
//      rel(from,to,code,implicit?) 生成关系边并登记「已被版式消化」、frame(header, body, opts) 加轻框。
//    - 返回 Block（相对坐标，原点＝块左上角）：
//        { w, h, anchor, items, places, edges }
//        places：每个子块恰好一条 { id, x, y }（子块左上角在本块内的位置）；漏摆/重摆会抛错。
//        items：版式自己的装饰（frame / lane / axis / date / tick / label），**不含任何卡片**。
//        edges：组内边——'tree' 结构线、'seq' 先后线、'rel' 组内关系（用 ctx.rel 生成）。
//
// 3. S2「块外刚性平移」由框架保证，而不是版式：版式只能返回子块的平移量（places），无法改写子块内部；
//    子块本身由框架缓存（引用不变），最终 Display 由框架一次性展平（子块 items + 偏移）。因此一次变化只会
//    重算「变化组 + 祖先链」，链外子树内部相对坐标逐字节不变。版式必须满足的只有：
//    (a) 纯函数，只依赖参数；(b) 子块按 places 平移、互不重叠（卡片之间 ≥ 4px）；
//    (c) S7 单调：某个子块变大时，只允许它后面的兄弟向右/向下移动，自身锚点只能向右/向下移动。
//
// 4. 加框：非树版式调用 `ctx.frame(header, body, { center? })`，body 为 { w, h, items, places, edges }
//    （相对 body 原点）；frame 在外面加 16px 内边距、框头卡片（左上，或 center:true 时居中）与右上角
//    「版式 · 来源」标注，返回完整 Block。**同版式嵌套并框**（论证图里理由下的证据）：版式在
//    `ctx.parentPattern === ctx.key` 时不要调用 frame，直接返回无框 Block（参考设计稿 §15.3 论证图）。
//
// 5. 吸收子组（absorb）：对照版式需要「栏内属性逐行对齐」，即同时摆放子与孙。声明
//    `PatternDef.absorb = true` 后，框架给每个子块附上 `cells`（该子的可见子块，已按本版式作为
//    parentPattern 布局、已做 LOD）；此时子块本身只是它的卡片（不含其子），places 必须同时覆盖
//    子卡片与全部 cells。被吸收的子在 Display.groups 中记 absorbedBy。
//
// 6. 注册：在 patterns/<key>.ts 导出 `export const <key>: PatternDef = { key, layout }`，然后把它加入下方
//    BUILTIN 表（一行 import + 一项）。测试或插件也可调用 registerPattern(def)（会使缓存失效）。
//    未注册的版式在布局时回落到 tree，并在 Display.groups[id].fallbackFrom 记下原选择（TODO(T6)）。
//
// 7. 缓存：createLayoutCache() 得到的对象传入 opts.cache 即启用增量重排：每组按
//    「子树 rev（graph.ts 维护）+ 版式选择 + 视图偏好 + 子块引用序列 + 注册表版本」判定是否复用；
//    不传 cache 时每次全量计算（结果逐字节相同——测试守护）。
// ═══════════════════════════════════════════════════════════════════════════

import type { GraphState, PatternKey, RelCode, V2Edge, V2Node } from "./types";
import { ROOT_ID } from "./types";
import { CARD, cardSize, g4, moreSize, r4, rootSize, textWidth } from "./measure";
import type { MaterialLabel, PatternHow, PatternLockEntry, PatternLocks, PatternSelection } from "./pattern";
import { HOW_NAMES, PATTERN_NAMES, groupFacts, lockPattern, materialLabel, selectPattern } from "./pattern";
import { descendantCount } from "./graph";
import { tree } from "./patterns/tree";
import { chain } from "./patterns/chain";

// ───────────────────────── 常量 ─────────────────────────

export const LAYOUT = {
  /** 框内边距 */
  PAD: 16,
  /** 框头卡片底到框体的距离 */
  HG: 24,
  /** 框右上角标注左右留白合计 */
  LABEL_PAD: 24,
  /** 可见子超过此数启用 LOD */
  LOD_MAX: 12,
  /** LOD 时显示前几项 */
  LOD_SHOW: 7,
} as const;

// ───────────────────────── 类型：版式作者面 ─────────────────────────

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** card：节点卡片；more：LOD「另有 N 项」；frame：组框；lane：对照栏；axis：时间轴；date：时间标签；tick/label：其他装饰 */
export type ItemKind = "card" | "more" | "frame" | "lane" | "axis" | "date" | "tick" | "label";

/** 卡片四态（§5.3-5）+ 根；collapsed＝有子但被折叠（徽标 +count） */
export type CardState = "root" | "more" | "open" | "collapsed" | "floor" | "stub" | "streaming";

export interface BlockItem extends Rect {
  /** 全图唯一：card＝节点 id；frame＝"F:"+组id；more＝"MORE:"+组id；其余装饰用 "<前缀>:"+nid 自拟（须唯一） */
  id: string;
  kind: ItemKind;
  /** 所属节点：card＝自身；frame/axis＝组节点；more＝组节点；lane/date＝对应子节点 */
  nid: string;
  /** date 文本、frame 标注文本等 */
  text?: string;
  /** frame：渲染出的版式与来源 */
  pattern?: PatternKey;
  how?: PatternHow;
  /** card：四态 */
  state?: CardState;
  /** card(collapsed)：被折叠的后代数；more：被省略的子数 */
  count?: number;
}

export type EdgeKind = "tree" | "seq" | "rel";

export interface BlockEdge {
  /** tree＝父子结构线（直角）；seq＝链/时间线先后线；rel＝组内关系曲线 */
  kind: EdgeKind;
  /** 画法方向：箭头指向 to（「据」已被 ctx.rel 反转为 目标→本节点） */
  from: string;
  to: string;
  code?: RelCode;
  /** 隐含关系（类型蕴含，不在数据里，例：论证图的向上支持线） */
  implicit?: boolean;
  /** 终点在目标卡片上的水平分位（0..1），多条线汇入同一卡片时错开 */
  tf?: number;
}

export interface Place {
  id: string;
  x: number;
  y: number;
}

/** 版式返回值（相对坐标） */
export interface Block {
  w: number;
  h: number;
  /** 父卡片在本块内的矩形 */
  anchor: Rect;
  items: BlockItem[];
  places: Place[];
  edges: BlockEdge[];
  /** 是否带框（ctx.frame 自动置 true） */
  framed?: boolean;
}

/** ctx.frame 的 body 参数 */
export interface FrameBody {
  w: number;
  h: number;
  items: BlockItem[];
  places: Place[];
  edges: BlockEdge[];
}

/** 版式看到的子块（不透明） */
export interface ChildBlock {
  readonly id: string;
  readonly kind: "node" | "more";
  /** kind 'more' 时为 null */
  readonly node: V2Node | null;
  readonly w: number;
  readonly h: number;
  /** 子块自己的父卡片在子块内的矩形（结构线、对齐都以它为准） */
  readonly anchor: Readonly<Rect>;
  readonly framed: boolean;
  readonly state: CardState;
  /** kind 'more'：省略的子数 */
  readonly count?: number;
  /** 仅 absorb 版式：该子的可见子块（此时本子块只含它的卡片） */
  readonly cells?: readonly ChildBlock[];
}

export interface Header {
  readonly id: string;
  /** 合成根为 null */
  readonly node: V2Node | null;
  readonly isRoot: boolean;
  readonly w: number;
  readonly h: number;
}

export interface PatternCtx {
  /** 本组实际渲染的版式 */
  readonly key: PatternKey;
  readonly how: PatternHow;
  readonly rule: number | null;
  /** 父组渲染的版式（根为 null）；等于 key 时表示同版式嵌套（可并框） */
  readonly parentPattern: PatternKey | null;
  readonly groupId: string;
  readonly K: typeof LAYOUT;
  readonly CARD: typeof CARD;
  g4(v: number): number;
  r4(v: number): number;
  textWidth(text: string, size: number): number;
  node(id: string): V2Node | null;
  /** 两端都在本组已摆放（非 more）子之间的关系，确定性顺序 */
  readonly siblingEdges: readonly V2Edge[];
  /** 生成关系边；implicit=false 时登记为「已被版式消化」（路由层不再当跨组关系画） */
  rel(from: string, to: string, code: RelCode, implicit?: boolean): BlockEdge;
  frame(header: Header, body: FrameBody, opts?: { center?: boolean }): Block;
}

export interface PatternDef {
  key: PatternKey;
  /** 见头注释第 5 条 */
  absorb?: boolean;
  layout(header: Header, kids: readonly ChildBlock[], ctx: PatternCtx): Block;
}

// ───────────────────────── 类型：输出面（给 route / svg / animate / 组件） ─────────────────────────

export interface DisplayItem extends BlockItem {
  /** 最近一层包住它的组框所属节点（frame 自身取外层）；不在任何框内为 null */
  group: string | null;
  /** 块嵌套层级（根组 0） */
  level: number;
}

export interface DisplayEdge extends BlockEdge {
  /** 产生此边的组 */
  group: string;
}

export interface GroupInfo {
  id: string;
  /** 实际渲染版式 */
  pattern: PatternKey;
  /** 选择器选出的版式（未实现时 pattern 回落 tree，fallbackFrom = selected） */
  selected: PatternKey;
  how: PatternHow;
  rule: number | null;
  fallbackFrom: PatternKey | null;
  framed: boolean;
  frameId: string | null;
  /** 已摆放的子（原文顺序；含 "MORE:" 项） */
  kids: string[];
  /** LOD 省略的子数 */
  hidden: number;
  /** 被父组版式吸收（absorb）时为父组 id */
  absorbedBy: string | null;
}

export interface LayoutStats {
  /** 本次访问的块数（可见节点 + more 卡） */
  visited: number;
  /** 本次重算的块数（缓存未命中） */
  recomputed: number;
  reused: number;
}

export interface Display {
  rootId: string;
  /** 展平后的全部元素（绝对坐标），确定性 DFS 顺序：每块先本块 items（框、装饰、父卡），再各子块 */
  items: DisplayItem[];
  byId: Record<string, DisplayItem>;
  /** 全部组内边（结构线 / 先后线 / 组内关系） */
  edges: DisplayEdge[];
  /** 已被版式消化的数据关系键 `${from}|${to}|${code}`（数据方向），升序；其余关系由路由层当跨组关系处理 */
  consumed: string[];
  groups: Record<string, GroupInfo>;
  bounds: { w: number; h: number };
  material: MaterialLabel;
  /** 仅当 opts.locks 传入时返回：更新后的 S5 锁表（下次布局传回） */
  locks?: PatternLocks;
  stats: LayoutStats;
}

export interface LayoutOptions {
  /** 启用增量重排 */
  cache?: LayoutCache;
  /** S5 锁表；不传＝不锁（纯选择） */
  locks?: PatternLocks;
  /** 已展开 LOD 的组 id（显示全部子） */
  lodExpanded?: ReadonlySet<string> | readonly string[];
  /** 框标注文本（i18n）；默认「论证图 · 模型提示」口径。须为确定性纯函数，且跨调用保持同一引用以命中缓存 */
  frameLabel?: (pattern: PatternKey, how: PatternHow) => string;
  /** 根卡标题；默认 state.meta.title */
  rootTitle?: string;
}

// ───────────────────────── 注册表 ─────────────────────────

const BUILTIN: Partial<Record<PatternKey, PatternDef>> = {
  tree,
  chain,
  // TODO(T6): timeline, layered, argument, compare, grid —— import 后加到这里
};

const REGISTRY = new Map<PatternKey, PatternDef>(Object.entries(BUILTIN) as [PatternKey, PatternDef][]);
let registryVersion = 0;

export function registerPattern(def: PatternDef): void {
  REGISTRY.set(def.key, def);
  registryVersion++;
}

/** 测试用：撤销注册（内置项恢复为内置实现） */
export function unregisterPattern(key: PatternKey): void {
  const b = BUILTIN[key];
  if (b) REGISTRY.set(key, b);
  else REGISTRY.delete(key);
  registryVersion++;
}

export function implementedPatterns(): PatternKey[] {
  return [...REGISTRY.keys()].sort();
}

const defaultFrameLabel = (p: PatternKey, how: PatternHow): string => `${PATTERN_NAMES[p]} · ${HOW_NAMES[how]}`;

// ───────────────────────── 缓存 ─────────────────────────

interface Sealed {
  w: number;
  h: number;
  anchor: Rect;
  framed: boolean;
  state: CardState;
  /** 本块自身 items（含父卡片），相对坐标 */
  items: BlockItem[];
  edges: BlockEdge[];
  consumed: string[];
  children: { b: Sealed; x: number; y: number }[];
  /** 本块代表的组（叶卡为 null） */
  group: GroupInfo | null;
  /** 吸收子组的组信息 */
  absorbed: GroupInfo[];
  /** 本块的 ChildBlock 视图（供父组版式使用） */
  view: ChildBlock;
}

interface Entry {
  deps: unknown[];
  sealed: Sealed;
  gen: number;
  proposedRev?: number;
  proposedManual?: PatternKey | null;
  proposed?: PatternSelection;
}

export interface LayoutCache {
  readonly __layoutCache: true;
}

interface CacheImpl extends LayoutCache {
  entries: Map<string, Entry>;
  gen: number;
}

export function createLayoutCache(): LayoutCache {
  const c: CacheImpl = { __layoutCache: true, entries: new Map(), gen: 0 };
  return c;
}

function sameDeps(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ───────────────────────── 布局 ─────────────────────────

const EMPTY_IDS: readonly string[] = [];

export function layoutGraph(state: GraphState, opts: LayoutOptions = {}): Display {
  const cache = (opts.cache as CacheImpl | undefined) ?? (createLayoutCache() as CacheImpl);
  const gen = ++cache.gen;
  const stats: LayoutStats = { visited: 0, recomputed: 0, reused: 0 };
  const lod: ReadonlySet<string> =
    opts.lodExpanded instanceof Set ? opts.lodExpanded : new Set((opts.lodExpanded as readonly string[] | undefined) ?? []);
  const frameLabel = opts.frameLabel ?? defaultFrameLabel;
  const rootTitle = opts.rootTitle ?? state.meta?.title ?? "";
  const locksIn = opts.locks;
  let locksOut: Record<string, PatternLockEntry> | null = null;

  const nodeOf = (id: string): V2Node | null => (id === ROOT_ID ? null : state.nodes[id] ?? null);
  const kidsOf = (id: string): readonly string[] => {
    if (id !== ROOT_ID && state.collapsed.has(id)) return EMPTY_IDS;
    const list = state.children[id];
    return list ?? EMPTY_IDS;
  };
  const hasAnyKids = (id: string) => (state.children[id]?.length ?? 0) > 0;
  const revOf = (id: string) => state.rev[id] ?? -1;

  const headerOf = (id: string): Header => {
    const node = nodeOf(id);
    const sz = id === ROOT_ID ? rootSize(rootTitle) : cardSize(node as V2Node);
    return { id, node, isRoot: id === ROOT_ID, w: sz.w, h: sz.h };
  };

  const cardState = (id: string, open: boolean): CardState => {
    if (id === ROOT_ID) return "root";
    const n = state.nodes[id];
    if (n.state === "streaming") return "streaming";
    if (open) return "open";
    if (hasAnyKids(id) && state.collapsed.has(id)) return "collapsed";
    if (n.state === "more" || n.state === "stub") return n.state;
    return "floor";
  };

  const cardItem = (h: Header, r: Rect, st: CardState): BlockItem => {
    const it: BlockItem = { id: h.id, kind: "card", x: r.x, y: r.y, w: r.w, h: r.h, nid: h.id, state: st };
    if (st === "collapsed") it.count = descendantCount(state, h.id);
    return it;
  };

  const viewOf = (s: Omit<Sealed, "view">, id: string, kind: "node" | "more", cells?: readonly ChildBlock[], count?: number): ChildBlock => {
    const v: { -readonly [K in keyof ChildBlock]: ChildBlock[K] } = {
      id,
      kind,
      node: kind === "node" ? nodeOf(id) : null,
      w: s.w,
      h: s.h,
      anchor: s.anchor,
      framed: s.framed,
      state: s.state,
    };
    if (count != null) v.count = count;
    if (cells) v.cells = cells;
    return v;
  };

  /** 叶卡（或 absorb 版式下子的「仅卡片」块） */
  const leaf = (id: string, headerOnly: boolean): Sealed => {
    const key = headerOnly ? id + "#h" : id;
    const collapsed = id !== ROOT_ID && state.collapsed.has(id);
    const deps: unknown[] = ["leaf", revOf(id), collapsed, headerOnly, id === ROOT_ID ? rootTitle : null];
    const hit = cache.entries.get(key);
    stats.visited++;
    if (hit && sameDeps(hit.deps, deps)) {
      hit.gen = gen;
      stats.reused++;
      return hit.sealed;
    }
    stats.recomputed++;
    const h = headerOf(id);
    const st = cardState(id, headerOnly && kidsOf(id).length > 0);
    const r: Rect = { x: 0, y: 0, w: h.w, h: h.h };
    const base = { w: h.w, h: h.h, anchor: r, framed: false, state: st, items: [cardItem(h, r, st)], edges: [], consumed: [], children: [], group: null, absorbed: [] };
    const sealed: Sealed = { ...base, view: viewOf(base, id, "node") };
    cache.entries.set(key, { deps, sealed, gen });
    return sealed;
  };

  const more = (groupId: string, count: number): Sealed => {
    const key = "MORE:" + groupId;
    const deps: unknown[] = ["more", count];
    const hit = cache.entries.get(key);
    stats.visited++;
    if (hit && sameDeps(hit.deps, deps)) {
      hit.gen = gen;
      stats.reused++;
      return hit.sealed;
    }
    stats.recomputed++;
    const sz = moreSize();
    const r: Rect = { x: 0, y: 0, w: sz.w, h: sz.h };
    const base = {
      w: sz.w, h: sz.h, anchor: r, framed: false, state: "floor" as CardState,
      items: [{ id: key, kind: "more" as ItemKind, x: 0, y: 0, w: sz.w, h: sz.h, nid: groupId, count }],
      edges: [], consumed: [], children: [], group: null, absorbed: [],
    };
    const sealed: Sealed = { ...base, view: viewOf(base, key, "more", undefined, count) };
    cache.entries.set(key, { deps, sealed, gen });
    return sealed;
  };

  /** 选择本组版式（提议按 rev 缓存；S5 锁每次评估，开销 O(1)） */
  const choose = (id: string, kids: readonly string[], entry: Entry | undefined): { sel: PatternSelection; proposed: PatternSelection } => {
    const manual = state.view.patterns[id] ?? null;
    const rev = revOf(id);
    let proposed: PatternSelection;
    if (entry && entry.proposed && entry.proposedRev === rev && entry.proposedManual === manual) proposed = entry.proposed;
    else proposed = selectPattern(groupFacts(state, id, kids));
    let sel = proposed;
    if (locksIn) {
      const n = nodeOf(id);
      const prev = locksIn[id];
      const r = lockPattern(prev, proposed, { streaming: !!n && n.state === "streaming", jobId: n ? n.jobId : null });
      sel = r.selection;
      if (r.entry !== prev) {
        if (!locksOut) locksOut = { ...locksIn };
        locksOut[id] = r.entry;
      }
    }
    return { sel, proposed };
  };

  const build = (id: string, parentPattern: PatternKey | null): Sealed => {
    const kids = kidsOf(id);
    if (!kids.length) return leaf(id, false);
    const entry = cache.entries.get(id);
    const { sel, proposed } = choose(id, kids, entry);
    const def = REGISTRY.get(sel.pattern) ?? (REGISTRY.get("tree") as PatternDef);
    const key = def.key;
    const lodOpen = lod.has(id);
    const shown = kids.length > LAYOUT.LOD_MAX && !lodOpen ? kids.slice(0, LAYOUT.LOD_SHOW) : kids;
    const hidden = kids.length - shown.length;

    // 子块（先算，供依赖比较）
    const kidSealed: Sealed[] = [];
    const cellSealed: Sealed[][] = [];
    const cellHidden: number[] = [];
    for (const k of shown) {
      if (def.absorb && kidsOf(k).length) {
        kidSealed.push(leaf(k, true));
        const gk = kidsOf(k);
        const gShown = gk.length > LAYOUT.LOD_MAX && !lod.has(k) ? gk.slice(0, LAYOUT.LOD_SHOW) : gk;
        const cs = gShown.map((g) => build(g, key));
        if (gk.length > gShown.length) cs.push(more(k, gk.length - gShown.length));
        cellSealed.push(cs);
        cellHidden.push(gk.length - gShown.length);
      } else {
        kidSealed.push(build(k, key));
        cellSealed.push([]);
        cellHidden.push(0);
      }
    }
    const moreS = hidden > 0 ? more(id, hidden) : null;

    const deps: unknown[] = [
      "group", revOf(id), parentPattern, sel.pattern, sel.how, sel.rule, key, lodOpen, registryVersion, frameLabel,
      id === ROOT_ID ? rootTitle : null, moreS,
    ];
    for (let i = 0; i < kidSealed.length; i++) {
      deps.push(kidSealed[i]);
      for (const c of cellSealed[i]) deps.push(c);
      deps.push(null);
    }
    stats.visited++;
    if (entry && sameDeps(entry.deps, deps)) {
      entry.gen = gen;
      stats.reused++;
      return entry.sealed;
    }
    stats.recomputed++;

    // 组装 ChildBlock
    const byId = new Map<string, Sealed>();
    const views: ChildBlock[] = [];
    for (let i = 0; i < kidSealed.length; i++) {
      const ks = kidSealed[i];
      const k = shown[i];
      byId.set(k, ks);
      const cells = cellSealed[i];
      if (def.absorb && cells.length) {
        for (const c of cells) byId.set(c.view.id, c);
        views.push(viewOf(ks, k, "node", cells.map((c) => c.view)));
      } else views.push(ks.view);
    }
    if (moreS) {
      byId.set(moreS.view.id, moreS);
      views.push(moreS.view);
    }

    const header = headerOf(id);
    const placedIds = new Set(shown);
    const consumed: string[] = [];
    const siblingEdges: V2Edge[] = [];
    for (const k of shown) for (const e of state.outEdges[k] ?? []) if (placedIds.has(e.to)) siblingEdges.push(e);

    const ctx: PatternCtx = {
      key,
      how: sel.how,
      rule: sel.rule,
      parentPattern,
      groupId: id,
      K: LAYOUT,
      CARD,
      g4,
      r4,
      textWidth,
      node: nodeOf,
      siblingEdges,
      rel(from, to, code, implicit = false) {
        if (!implicit) consumed.push(from + "|" + to + "|" + code);
        const e: BlockEdge = code === "据" ? { kind: "rel", from: to, to: from, code } : { kind: "rel", from, to, code };
        if (implicit) e.implicit = true;
        return e;
      },
      frame(h, body, fo) {
        return frameBlock(id, h, body, key, sel.how, frameLabel(key, sel.how), !!(fo && fo.center));
      },
    };
    const out = def.layout(header, views, ctx);

    // 封装：校验 places、取整、放父卡片
    const children: Sealed["children"] = [];
    const seen = new Set<string>();
    for (const p of out.places) {
      const s = byId.get(p.id);
      if (!s) throw new Error(`layout(${key}): place for unknown child ${p.id} in group ${id}`);
      if (seen.has(p.id)) throw new Error(`layout(${key}): child ${p.id} placed twice in group ${id}`);
      seen.add(p.id);
      children.push({ b: s, x: g4(p.x), y: g4(p.y) });
    }
    if (seen.size !== byId.size) {
      const miss = [...byId.keys()].filter((k) => !seen.has(k));
      throw new Error(`layout(${key}): children not placed in group ${id}: ${miss.join(",")}`);
    }
    const anchor: Rect = { x: g4(out.anchor.x), y: g4(out.anchor.y), w: header.w, h: header.h };
    const st = cardState(id, true);
    const items: BlockItem[] = out.items.map((it) => ({ ...it, x: g4(it.x), y: g4(it.y), w: r4(it.w), h: r4(it.h) }));
    items.push(cardItem(header, anchor, st));
    const framed = !!out.framed;
    const frameId = framed ? "F:" + id : null;
    const group: GroupInfo = {
      id,
      pattern: key,
      selected: sel.pattern,
      how: sel.how,
      rule: sel.rule,
      fallbackFrom: key !== sel.pattern ? sel.pattern : null,
      framed,
      frameId,
      kids: views.map((v) => v.id),
      hidden,
      absorbedBy: null,
    };
    const absorbed: GroupInfo[] = [];
    if (def.absorb) {
      shown.forEach((k, i) => {
        if (!cellSealed[i].length) return;
        absorbed.push({
          id: k, pattern: key, selected: key, how: sel.how, rule: sel.rule, fallbackFrom: null, framed: false, frameId: null,
          kids: cellSealed[i].map((c) => c.view.id), hidden: cellHidden[i],
          absorbedBy: id,
        });
      });
    }
    const base = {
      w: r4(out.w), h: r4(out.h), anchor, framed, state: st, items, edges: out.edges.slice(), consumed: [...new Set(consumed)].sort(),
      children, group, absorbed,
    };
    const sealed: Sealed = { ...base, view: viewOf(base, id, "node") };
    cache.entries.set(id, { deps, sealed, gen, proposed, proposedRev: revOf(id), proposedManual: state.view.patterns[id] ?? null });
    return sealed;
  };

  const root = build(ROOT_ID, null);

  // 展平（O(可见元素)）
  const items: DisplayItem[] = [];
  const byId: Record<string, DisplayItem> = {};
  const edges: DisplayEdge[] = [];
  const consumedSet = new Set<string>();
  const groups: Record<string, GroupInfo> = {};
  const walk = (s: Sealed, ox: number, oy: number, owner: string | null, level: number) => {
    const inner = s.framed && s.group ? s.group.id : owner;
    for (const it of s.items) {
      const d: DisplayItem = { ...it, x: it.x + ox, y: it.y + oy, group: it.kind === "frame" ? owner : inner, level };
      items.push(d);
      byId[d.id] = d;
    }
    if (s.group) {
      groups[s.group.id] = s.group;
      for (const e of s.edges) edges.push({ ...e, group: s.group.id });
    }
    for (const g of s.absorbed) groups[g.id] = g;
    for (const k of s.consumed) consumedSet.add(k);
    for (const c of s.children) walk(c.b, ox + c.x, oy + c.y, inner, level + 1);
  };
  walk(root, 0, 0, null, 0);

  // 清理本次未访问的缓存项
  for (const [k, e] of cache.entries) if (e.gen !== gen) cache.entries.delete(k);

  const display: Display = {
    rootId: ROOT_ID,
    items,
    byId,
    edges,
    consumed: [...consumedSet].sort(),
    groups,
    bounds: { w: root.w, h: root.h },
    material: materialLabel(Object.values(state.nodes)),
    stats,
  };
  if (locksIn) display.locks = locksOut ?? locksIn;
  return display;
}

/** ctx.frame 实现（§15.3 轻框：16px 内边距、框头卡片、右上角「版式 · 来源」） */
function frameBlock(groupId: string, h: Header, body: FrameBody, key: PatternKey, how: PatternHow, label: string, center: boolean): Block {
  const { PAD, HG, LABEL_PAD } = LAYOUT;
  const lw = r4(textWidth(label, CARD.labelSize)) + LABEL_PAD;
  const fw = r4(Math.max(center ? h.w + 2 * lw : h.w + lw, body.w) + 2 * PAD);
  const hx = center ? g4((fw - h.w) / 2) : PAD;
  const by = PAD + h.h + HG;
  const bx = PAD + (center ? g4((fw - 2 * PAD - body.w) / 2) : 0);
  const fh = r4(by + body.h + PAD);
  const items: BlockItem[] = [{ id: "F:" + groupId, kind: "frame", x: 0, y: 0, w: fw, h: fh, nid: groupId, text: label, pattern: key, how }];
  for (const it of body.items) items.push({ ...it, x: it.x + bx, y: it.y + by });
  return {
    w: fw,
    h: fh,
    anchor: { x: hx, y: PAD, w: h.w, h: h.h },
    items,
    places: body.places.map((p) => ({ id: p.id, x: p.x + bx, y: p.y + by })),
    edges: body.edges,
    framed: true,
  };
}
