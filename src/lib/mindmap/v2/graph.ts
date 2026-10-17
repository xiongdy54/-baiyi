// 材料导图 v2 · 图状态纯 reducer（MINDMAP-V2-IMPL-PLAN §5.1 graph.ts）。
// 纯函数、不可变、结构共享：未变化的节点 / 子列表 / 边列表保持引用不变；每次结构变化把
// 「变化节点 + 全部祖先（直至 ROOT_ID）」的 rev 打成新 clock——layout.ts 只重算这些脏组（S2）。
// 同节点后到覆盖（id 相同即整行替换）；同 (from,to,code) 关系去重；子列表按 (ord, id) 升序（S1）。

import type { Delta, GraphLoad, GraphState, V2Edge, V2Node, V2NodeState, V2View, PatternKey } from "./types";
import { ROOT_ID } from "./types";

const EMPTY_VIEW: V2View = { patterns: {}, collapsed: [] };
const EMPTY: readonly string[] = [];
const EMPTY_EDGES: readonly V2Edge[] = [];

export function emptyGraph(mapId: string | null = null): GraphState {
  return {
    mapId,
    meta: null,
    nodes: {},
    children: {},
    outEdges: {},
    inEdges: {},
    edgeCount: 0,
    view: EMPTY_VIEW,
    collapsed: new Set(),
    explain: {},
    jobs: {},
    metrics: null,
    rev: { [ROOT_ID]: 0 },
    clock: 0,
  };
}

/** 由 `mindmap:graphLoad` 结果建图。 */
export function createGraph(load: GraphLoad, mapId?: string): GraphState {
  const id = mapId ?? load.meta.mapId ?? null;
  let s = emptyGraph(id);
  s = { ...s, meta: load.meta };
  s = applyDelta(s, { mapId: id ?? "", kind: "load", nodes: load.nodes, edges: load.edges }, true);
  if (load.view) s = setView(s, load.view);
  const explain: Record<string, string> = {};
  for (const n of load.nodes) if (n.explain) explain[n.id] = n.explain;
  return { ...s, explain };
}

const parentKey = (p: string | null): string => (p == null ? ROOT_ID : p);

function cmpChild(nodes: Readonly<Record<string, V2Node>>, a: string, b: string): number {
  const na = nodes[a], nb = nodes[b];
  const oa = na ? na.ord : 0, ob = nb ? nb.ord : 0;
  if (oa !== ob) return oa - ob;
  return a < b ? -1 : a > b ? 1 : 0;
}

function edgeKey(e: V2Edge): string {
  return e.from + "|" + e.to + "|" + e.code;
}

/** 写时复制工具：同一次 reducer 内对同一个 record 只复制一次。 */
class Cow<T> {
  private copy: Record<string, T> | null = null;
  constructor(private base: Readonly<Record<string, T>>) {}
  get(k: string): T | undefined {
    return (this.copy ?? this.base)[k];
  }
  set(k: string, v: T): void {
    if (!this.copy) this.copy = { ...this.base };
    this.copy[k] = v;
  }
  delete(k: string): void {
    if (!Object.prototype.hasOwnProperty.call(this.copy ?? this.base, k)) return;
    if (!this.copy) this.copy = { ...this.base };
    delete this.copy[k];
  }
  result(): Readonly<Record<string, T>> {
    return this.copy ?? this.base;
  }
}

/**
 * 纯 reducer：合入一批 delta。mapId 不匹配（且 state 已绑定 mapId）时原样返回。
 * `trusted` 仅供 createGraph 内部使用（跳过 mapId 校验）。
 */
export function applyDelta(state: GraphState, delta: Delta, trusted = false): GraphState {
  if (!trusted && state.mapId != null && delta.mapId !== state.mapId) return state;
  const nodes = new Cow<V2Node>(state.nodes);
  const children = new Cow<readonly string[]>(state.children);
  const outE = new Cow<readonly V2Edge[]>(state.outEdges);
  const inE = new Cow<readonly V2Edge[]>(state.inEdges);
  const dirty = new Set<string>();
  let edgeCount = state.edgeCount;

  const touch = (id: string | null) => {
    if (id != null) dirty.add(id);
  };

  // 子列表增删：先收集，最后每个受影响父组排序一次（批量 O(k log k)）
  const addTo = new Map<string, Set<string>>();
  const removeFrom = new Map<string, Set<string>>();
  const reorder = new Set<string>();
  const addMember = (m: Map<string, Set<string>>, p: string, id: string) => {
    let set = m.get(p);
    if (!set) m.set(p, (set = new Set()));
    set.add(id);
  };

  // 删除（delta.removed）：先删后合入——同批既删又发的 id 以合入为准（重新出现）
  const revived = new Set((delta.nodes ?? []).map((n) => n.id));
  for (const id of delta.removed ?? []) {
    if (revived.has(id)) continue;
    const prev = nodes.get(id);
    if (!prev) continue;
    nodes.delete(id);
    addMember(removeFrom, parentKey(prev.parentId), id);
    touch(prev.parentId);
    if (children.get(id)) children.delete(id);
    for (const e of outE.get(id) ?? EMPTY_EDGES) {
      const li = inE.get(e.to);
      if (li) inE.set(e.to, li.filter((x) => x.from !== id));
      edgeCount--;
      const ta = nodes.get(e.to);
      touch(ta ? ta.parentId : null);
    }
    for (const e of inE.get(id) ?? EMPTY_EDGES) {
      const lo = outE.get(e.from);
      if (lo) {
        const next = lo.filter((x) => x.to !== id);
        if (next.length !== lo.length) edgeCount -= lo.length - next.length;
        outE.set(e.from, next);
      }
      const fa = nodes.get(e.from);
      touch(fa ? fa.parentId : null);
    }
    if (outE.get(id)) outE.delete(id);
    if (inE.get(id)) inE.delete(id);
    dirty.add(ROOT_ID);
  }

  for (const n of delta.nodes ?? []) {
    const prev = nodes.get(n.id);
    nodes.set(n.id, n);
    touch(n.id);
    const pk = parentKey(n.parentId);
    if (!prev) addMember(addTo, pk, n.id);
    else {
      const ppk = parentKey(prev.parentId);
      if (ppk !== pk) {
        addMember(removeFrom, ppk, n.id);
        addMember(addTo, pk, n.id);
        touch(prev.parentId);
      } else if (prev.ord !== n.ord) reorder.add(pk);
    }
  }
  for (const st of delta.states ?? []) {
    const prev = nodes.get(st.id);
    if (!prev || prev.state === st.state) continue;
    nodes.set(st.id, { ...prev, state: st.state as V2NodeState });
    touch(st.id);
  }
  const nodesOut = nodes.result();

  const groups = new Set<string>([...addTo.keys(), ...removeFrom.keys(), ...reorder]);
  for (const pk of [...groups].sort()) {
    const rm = removeFrom.get(pk);
    const add = addTo.get(pk);
    let list = (children.get(pk) ?? EMPTY).filter((id) => !rm || !rm.has(id));
    if (add) {
      const have = new Set(list);
      for (const id of add) if (!have.has(id)) list.push(id);
    }
    list = list.slice().sort((a, b) => cmpChild(nodesOut, a, b));
    children.set(pk, list);
    touch(pk === ROOT_ID ? null : pk);
  }

  for (const e of delta.edges ?? []) {
    if (!e || e.from === e.to) continue;
    const list = outE.get(e.from) ?? EMPTY_EDGES;
    const k = edgeKey(e);
    if (list.some((x) => edgeKey(x) === k)) continue;
    outE.set(e.from, [...list, e].sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0)));
    const li = inE.get(e.to) ?? EMPTY_EDGES;
    inE.set(e.to, [...li, e].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0)));
    edgeCount++;
    // 关系影响「两端点所在组」的版式选择与组内排布 → 两端父链置脏
    const fa = nodesOut[e.from], ta = nodesOut[e.to];
    if (fa) touch(fa.parentId ?? null);
    if (ta) touch(ta.parentId ?? null);
    if (!fa || !fa.parentId || !ta || !ta.parentId) dirty.add(ROOT_ID);
  }

  let explain = state.explain;
  if (delta.explainDelta && delta.explainDelta.nodeId) {
    const { nodeId, text } = delta.explainDelta;
    explain = { ...explain, [nodeId]: (explain[nodeId] ?? "") + (text ?? "") };
  }
  let jobs = state.jobs;
  if (delta.jobDone && delta.jobId) jobs = { ...jobs, [delta.jobId]: delta.jobDone };
  const metrics = delta.metrics ?? state.metrics;

  if (!dirty.size && explain === state.explain && jobs === state.jobs && metrics === state.metrics) return state;

  let rev = state.rev;
  let clock = state.clock;
  if (dirty.size) {
    clock++;
    const r: Record<string, number> = { ...state.rev };
    for (const id of dirty) bumpChain(r, nodesOut, id, clock);
    r[ROOT_ID] = clock;
    rev = r;
  }
  return {
    ...state,
    nodes: nodesOut,
    children: children.result(),
    outEdges: outE.result(),
    inEdges: inE.result(),
    edgeCount,
    explain,
    jobs,
    metrics,
    rev,
    clock,
  };
}

function bumpChain(r: Record<string, number>, nodes: Readonly<Record<string, V2Node>>, id: string, clock: number) {
  let cur: string | null = id;
  let guard = 0;
  while (cur != null && cur !== ROOT_ID && guard++ < 4096) {
    if (r[cur] === clock) return; // 已沿此链打过
    r[cur] = clock;
    const n: V2Node | undefined = nodes[cur];
    cur = n ? n.parentId : null;
  }
}

// ───────────────────────── 视图（不改结构、不打 rev；布局缓存按视图字段自行比对） ─────────────────────────

export function setView(state: GraphState, view: V2View): GraphState {
  const v: V2View = { patterns: { ...(view.patterns ?? {}) }, collapsed: [...new Set(view.collapsed ?? [])].sort() };
  return { ...state, view: v, collapsed: new Set(v.collapsed) };
}

export function setCollapsed(state: GraphState, id: string, collapsed: boolean): GraphState {
  if (state.collapsed.has(id) === collapsed) return state;
  const list = collapsed ? [...state.view.collapsed, id] : state.view.collapsed.filter((x) => x !== id);
  return setView(state, { ...state.view, collapsed: list });
}

/** 手动「排列方式」；key 为 null 表示恢复自动 */
export function setManualPattern(state: GraphState, id: string, key: PatternKey | null): GraphState {
  const patterns = { ...state.view.patterns };
  if (key) patterns[id] = key;
  else delete patterns[id];
  return setView(state, { ...state.view, patterns });
}

// ───────────────────────── 查询 ─────────────────────────

/** 子 id（全部已到达，按原文顺序）；parentId 传 ROOT_ID 得顶层 */
export function childrenOf(state: GraphState, parentId: string): readonly string[] {
  const list = state.children[parentId] ?? EMPTY;
  // 父未到达的孤儿：其 parentId 指向不存在节点 → 不在可达树中，由调用方自然忽略
  return list;
}

/** 可见子（未折叠时＝已到达的子；折叠时为空） */
export function visibleChildren(state: GraphState, id: string): readonly string[] {
  if (id !== ROOT_ID && state.collapsed.has(id)) return EMPTY;
  return childrenOf(state, id);
}

/** 祖先链（顶层 → 父），不含自身、不含 ROOT_ID；未知节点返回 [] */
export function ancestors(state: GraphState, id: string): string[] {
  const out: string[] = [];
  let n = state.nodes[id];
  let guard = 0;
  while (n && n.parentId != null && guard++ < 4096) {
    out.push(n.parentId);
    n = state.nodes[n.parentId];
  }
  return out.reverse();
}

/** 自根可达（祖先链完整到顶层） */
export function isReachable(state: GraphState, id: string): boolean {
  let n = state.nodes[id];
  let guard = 0;
  while (n && guard++ < 4096) {
    if (n.parentId == null) return true;
    n = state.nodes[n.parentId];
  }
  return false;
}

/** 可见：可达且没有折叠的祖先 */
export function isVisible(state: GraphState, id: string): boolean {
  if (id === ROOT_ID) return true;
  if (!isReachable(state, id)) return false;
  return !ancestors(state, id).some((a) => state.collapsed.has(a));
}

/** 端点提升：返回 id 自身（若可见）或最近的可见祖先（被折叠的那一层）；不可达返回 null */
export function visibleRep(state: GraphState, id: string): string | null {
  if (!state.nodes[id] || !isReachable(state, id)) return null;
  for (const a of ancestors(state, id)) if (state.collapsed.has(a)) return a;
  return id;
}

/** 可见集合（含 ROOT_ID），按 DFS 原文顺序 */
export function visibleIds(state: GraphState): string[] {
  const out: string[] = [];
  const walk = (id: string) => {
    out.push(id);
    for (const c of visibleChildren(state, id)) walk(c);
  };
  walk(ROOT_ID);
  return out;
}

/** 后代数（含不可见），折叠徽标「+N」用 */
export function descendantCount(state: GraphState, id: string): number {
  let n = 0;
  const stack = [...childrenOf(state, id)];
  while (stack.length) {
    const c = stack.pop() as string;
    n++;
    const k = state.children[c];
    if (k) for (const x of k) stack.push(x);
  }
  return n;
}

/** 与 id 相连的全部关系（出 + 入，确定性顺序） */
export function edgesOf(state: GraphState, id: string): V2Edge[] {
  return [...(state.outEdges[id] ?? EMPTY_EDGES), ...(state.inEdges[id] ?? EMPTY_EDGES)];
}

/** 关系透视（§15.7）：自身 + 关系对端 + 祖先链 */
export function related(state: GraphState, id: string): Set<string> {
  const s = new Set<string>([id]);
  for (const e of edgesOf(state, id)) {
    s.add(e.from);
    s.add(e.to);
  }
  for (const a of ancestors(state, id)) s.add(a);
  return s;
}

/** 全部关系（确定性顺序：按 from 再按 to/code） */
export function allEdges(state: GraphState): V2Edge[] {
  const out: V2Edge[] = [];
  for (const k of Object.keys(state.outEdges).sort()) out.push(...(state.outEdges[k] ?? EMPTY_EDGES));
  return out;
}
