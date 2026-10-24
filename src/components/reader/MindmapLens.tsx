// 结构透镜 v2「纸片图谱」——阅读正文时，在独立窗口里看到「正在读的这一段」在材料结构里的位置。
//
// 演化：
//   · 第三轮：按版式选浮窗 / 正文下方；第四轮：复用完整图谱画布；第五轮：并入完整画布；
//   · 第六轮（D194）：阅读节点整卡主题色、父链截断到直接父节点、跳转后区域高亮；
//   · 第七轮（D197）：面板搬进独立窗口（窗口拖动 / 四边缩放由系统原生承担）；
//   · 第八轮（v49.29 / D203）：窗口改为**内容自适应纸片**——窗口尺寸 = 图谱 layout bounds + 固定留白
//     （左右 16 / 上 32 / 下 16），纸片就是窗口表面；渲染层量 content/anchor，经 `lens:fit` 交主进程
//     setBounds。控制轨四动作居中（选中后出现），解释卡从轨下展开且不改窗口；分级：
//     100% → sFit 缩放 → sFit < 0.62 时聚焦（N 子项 + 「另有 N 项」）→ 「展开全部」显式全图。
//     删除：节点浮条、外圈选中（选中＝整卡主题色）、casing / 角标 / 检视框 / 穿透锁定。
//   · 数据与正文强调：kernel.getReadingProbe → mindmap:graphLocate（零 AI）；图走 graphLoad + mindmap/delta；
//     段落强调锚走 mindmap:graphNodeAnchors；原文送入与图谱页签共用 mindmapFeed。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReaderLocation, ReaderStructureRegion, ReaderTocItem, RelocateInfo, SectionUnitInfo } from "../../lib/reader/kernel";
import type { GraphState, V2Edge, V2Node, PatternKey } from "../../lib/mindmap/v2/types";
import { ROOT_ID } from "../../lib/mindmap/v2/types";
import { ancestors, applyDelta, childrenOf, createGraph, setView } from "../../lib/mindmap/v2/graph";
import { groupFacts, selectPattern, HOW_NAMES, PATTERN_NAMES, type PatternHow } from "../../lib/mindmap/v2/pattern";
import { createLayoutCache, layoutGraph, type Display, type LayoutCache } from "../../lib/mindmap/v2/layout";
import { perfBegin, perfIpc, perfLayout, perfOn } from "../../lib/mindmap/v2/perf";
import { chooseFocus, computeFit, LENS_PAD_SIDE, LENS_PAD_TOP } from "../../lib/lensWindowFit";
import MindmapCanvasV2, { type MindmapCanvasHandle } from "./mindmap/MindmapCanvasV2";
import { mindmapV2Api, type GraphLocate, type MindmapDelta, type NodeAnchor } from "../../lib/mindmapV2";
import { ensureFed, resetFeed, subscribeFeed, type FeedState } from "../../lib/mindmapFeed";
import { eventBus } from "../../lib/eventbus";
import type { LensFitReply, LensFitRequest, LensFitTier } from "../../lib/lensBridge";
import { useT } from "../../lib/i18n";

export interface MindmapLensProps {
  kernel: LensKernel | null;
  documentId: string | null;
  title: string;
  /** 工具栏「结构图」开关（独立窗口＝常开，由窗口可见性控制） */
  open: boolean;
  onClose: () => void;
  /** 图谱页签正盖在正文上时隐藏（状态保留） */
  hidden: boolean;
  /** 「在完整图谱中打开」：切到图谱页签并聚焦该节点 */
  onOpenInMap: (nodeId: string | null, region?: string[]) => void;
  /** 独立窗口模式：承载面板的窗口当前是否可见（关闭＝隐藏，面板仍挂载；缺省＝就地渲染，恒可见） */
  visible?: boolean;
  /** 独立窗口模式：当前是否置顶（提供 onPin 时才渲染置顶钮；就地渲染＝不提供） */
  pinned?: boolean;
  onPin?: () => void;
  /** 内容自适应纸片窗口（D203）：渲染层量 content/anchor，主进程算尺寸并 setBounds */
  fit?: (req: LensFitRequest) => Promise<LensFitReply>;
}

/**
 * 结构图只用到内核的这几件事。阅读窗口直传真实内核（结构上是它的超集），独立窗口传 IPC 代理
 * （src/lib/lensBridge.ts）——组件因此既能在窗口里跑、也能在测试里就地渲染。
 */
export interface LensKernel {
  getTOC(): ReaderTocItem[];
  getSectionAnchors?(): SectionUnitInfo[];
  getSectionText?(startAnchor: string, endAnchor?: string): Promise<string>;
  getReadingProbe?(): { unitAnchor: string; text: string } | null;
  getCurrentLocation(): ReaderLocation | null;
  goTo(target: ReaderLocation | { href: string } | { search: string }): Promise<boolean>;
  setStructureHighlights?(regions: ReaderStructureRegion[]): void;
  on(event: "relocate", handler: (info: RelocateInfo) => void): () => void;
}

/**
 * 第五轮 · 父链截断：以 `cut`（阅读节点的直接父节点）为**顶**的剪枝图。
 * keep = cut 的整棵子树；cut 自身不进 nodes、其直接子节点改挂 ROOT_ID（cut 的标题由画布顶卡 rootTitle 呈现），
 * 其余更高层级父节点（章 / 目录 / 书根）一律不展示。边只留两端都在子树里的。
 */
function pruneToCut(state: GraphState, cut: string): GraphState {
  if (!state.meta || !state.nodes[cut]) return state;
  const keep = new Set<string>();
  const stack = [cut];
  while (stack.length) {
    const id = stack.pop()!;
    if (!state.nodes[id] || keep.has(id)) continue;
    keep.add(id);
    for (const c of state.children[id] ?? []) stack.push(c);
  }
  const nodes: V2Node[] = [];
  const edges: V2Edge[] = [];
  for (const id of keep) {
    if (id === cut) continue;
    nodes.push({ ...state.nodes[id], parentId: state.nodes[id].parentId === cut ? null : state.nodes[id].parentId });
    for (const e of state.outEdges[id] ?? []) if (e.to !== cut && keep.has(e.to)) edges.push(e);
  }
  return createGraph({ meta: state.meta, nodes, edges, view: null }, state.mapId ?? undefined);
}

/** 聚焦档：把阅读节点在顶层的分支排到最前（其余保持原文顺序）；不改变任何节点真值，只改派生视图顺序。 */
function reorderRoot(state: GraphState, first: string | null): GraphState {
  if (!first || !state.nodes[first] || state.nodes[first].parentId != null) return state;
  const kids = childrenOf(state, ROOT_ID);
  if (!kids.length || kids[0] === first) return state;
  const order = [first, ...kids.filter((id) => id !== first)];
  const minOrd = Math.min(...order.map((id) => state.nodes[id]?.ord ?? 0));
  const nodes: Record<string, V2Node> = { ...state.nodes };
  order.forEach((id, i) => {
    const n = nodes[id];
    if (n) nodes[id] = { ...n, ord: minOrd - (order.length - i) * 10 };
  });
  const clock = state.clock + 1;
  return {
    ...state,
    nodes,
    children: { ...state.children, [ROOT_ID]: order },
    rev: { ...state.rev, [ROOT_ID]: clock },
    clock,
  };
}

const rectOf = (it: Pick<Display["items"][number], "x" | "y" | "w" | "h">) => ({ x: it.x, y: it.y, w: it.w, h: it.h });
const TOP_HOVER = 48;

export default function MindmapLens({
  kernel,
  documentId,
  title,
  open,
  onClose,
  hidden,
  onOpenInMap,
  visible,
  pinned,
  onPin,
  fit,
}: MindmapLensProps) {
  const T = useT();
  const [feed, setFeed] = useState<FeedState>({ done: 0, total: 0, complete: false, unsupported: false });
  const [loc, setLoc] = useState<GraphLocate | null>(null);
  const [graph, setGraph] = useState<GraphState | null>(null);
  const graphRef = useRef<GraphState | null>(null);
  graphRef.current = graph;
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [hasKey, setHasKey] = useState(true);
  /** 显式选中的节点（null＝跟随阅读）。选中≠阅读位置：阅读节点由 readingId 标出。 */
  const [sel, setSel] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  /** 折叠覆盖：用户手动展开 / 收起过的节点（记真值，不随阅读位置自动重置） */
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  /** 「跳到原文」前的阅读位置 */
  const [backLoc, setBackLoc] = useState<ReaderLocation | null>(null);
  const [explainLocal, setExplainLocal] = useState<Record<string, string>>({});
  const [explainBusy, setExplainBusy] = useState<string | null>(null);
  /** 解释卡当前对应的节点（null＝收起） */
  const [explainFor, setExplainFor] = useState<string | null>(null);
  const docRef = useRef(documentId);
  docRef.current = documentId;
  /** 正文强调锚缓存：`${mapId}|${nodeId}` → 锚（null＝无区间 / 原文未到） */
  const anchorCache = useRef<Map<string, NodeAnchor[] | null>>(new Map());
  /**
   * 锚缓存失效计数（D199）：缓存一旦被清（增量来了 / 图谱重载 / 窗口重新呼出），必须**重取一次**才谈得上
   * 重建强调。旧实现只在 `focusId` 变化时才重取，于是「窗口收起再呼出」或「纯增量清缓存」时强调会一直缺口。
   */
  const [anchorEpoch, setAnchorEpoch] = useState(0);
  const explainJobRef = useRef<string | null>(null);
  const canvasRef = useRef<MindmapCanvasHandle>(null);
  /** D204：图谱宿主（窗口缓动时做反向位移，让内容/被点节点在屏幕上不动） */
  const hostRef = useRef<HTMLDivElement>(null);
  const growRaf = useRef<number | null>(null);
  const growToken = useRef(0);
  /** D204：下一次 fit 用哪颗节点的旧屏幕位置钉住（展开/收起/深挖） */
  const pendingExpandRef = useRef<{ anchorScreen: { x: number; y: number }; nodeId: string } | null>(null);
  const pendingExpandTimer = useRef<number | null>(null);

  // ---------- 纸片窗口（D203） ----------
  const [showAll, setShowAll] = useState(false);
  /** 聚焦档的 N（null＝完整内容放得下）；由 fit 探测决定 */
  const [focusN, setFocusN] = useState<number | null>(null);
  const [fitState, setFitState] = useState<{
    scale: number;
    tier: LensFitTier;
    content: { w: number; h: number };
    bounds: { x: number; y: number; width: number; height: number };
  } | null>(null);
  const [fitted, setFitted] = useState(false);
  const [railOn, setRailOn] = useState(false);
  const [note, setNote] = useState("");
  const fitSeqRef = useRef(0);
  const fitBusyRef = useRef(false);
  const lastFitRef = useRef("");
  const railTimer = useRef<number | null>(null);
  const nearTopRef = useRef(false);
  const railHoldRef = useRef(false);
  const statusTimer = useRef<number | null>(null);

  const supported = !!kernel && !!documentId && typeof kernel.getReadingProbe === "function" && typeof kernel.getSectionAnchors === "function";
  const active = open && !hidden && supported;
  /**
   * 「面板在场」（D199）：独立窗口下关闭＝隐藏，面板仍挂载——窗口不可见时对用户而言面板已不在场，
   * 正文强调（结构图独占的绘制层）必须收回；窗口再被呼出时随之重新贴上。
   */
  const onStage = active && (visible ?? true);

  // ---------- 图 ----------
  const loadGraph = useCallback(async () => {
    if (!documentId) return;
    try {
      const r = await mindmapV2Api.load({ documentId });
      if (docRef.current !== documentId) return;
      if (!r.meta || !r.meta.mapId) {
        setGraph(null);
        return;
      }
      setGraph(createGraph({ meta: r.meta, nodes: r.nodes, edges: r.edges, view: null }, String(r.meta.mapId)));
    } catch {
      /* 读图失败：保持空态 */
    }
  }, [documentId]);

  // ---------- 定位 ----------
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const locTimer = useRef<number | null>(null);
  const retriedRef = useRef(false);
  const scheduleRef = useRef<(ms?: number) => void>(() => {});
  const doLocate = useCallback(async () => {
    if (!kernel || !documentId || !kernel.getReadingProbe) return;
    const probe = kernel.getReadingProbe();
    if (!probe) return;
    let r: GraphLocate;
    try {
      r = await mindmapV2Api.locate({ documentId, unitAnchor: probe.unitAnchor, text: probe.text });
    } catch {
      return;
    }
    if (docRef.current !== documentId) return;
    if (!r.ready) {
      // 原文已送完却定位不到：主进程会话被挤出 → 重送一次
      if (feedRef.current.complete && !retriedRef.current) {
        retriedRef.current = true;
        resetFeed(kernel, documentId);
        void ensureFed(kernel, documentId, title).then(() => scheduleRef.current(0));
      }
      return;
    }
    setLoc(r);
    if ((r.mapId || null) !== (graphRef.current?.mapId || null)) void loadGraph();
  }, [kernel, documentId, title, loadGraph]);
  const scheduleLocate = useCallback(
    (ms = 160) => {
      if (locTimer.current != null) window.clearTimeout(locTimer.current);
      locTimer.current = window.setTimeout(() => {
        locTimer.current = null;
        void doLocate();
      }, ms);
    },
    [doLocate],
  );
  scheduleRef.current = scheduleLocate;

  // 文档切换：清状态（窗口本身由主进程保留；渲染回到种子卡）
  useEffect(() => {
    setLoc(null);
    setGraph(null);
    setBusy(null);
    setNote("");
    if (statusTimer.current != null) {
      window.clearTimeout(statusTimer.current);
      statusTimer.current = null;
    }
    setSel(null);
    setHoverId(null);
    setOverrides(new Map());
    setBackLoc(null);
    setExplainLocal({});
    setExplainFor(null);
    setFocusN(null);
    setShowAll(false);
    setFitState(null);
    setFitted(false);
    lastFitRef.current = "";
    anchorCache.current.clear();
    retriedRef.current = false;
  }, [documentId, kernel]);

  // 送原文（打开过结构图才送：送原文要逐章取文，不为不用的人白跑）
  useEffect(() => {
    if (!active || !kernel || !documentId) return;
    const off = subscribeFeed(kernel, documentId, (st) => {
      setFeed(st);
      if (st.complete) scheduleLocate(0);
    });
    void ensureFed(kernel, documentId, title);
    void loadGraph();
    window.aiAPI
      ?.getConfig()
      .then((cfg) => setHasKey(Boolean(cfg?.hasKey) || cfg?.preset === "local"))
      .catch(() => setHasKey(false));
    return off;
  }, [active, kernel, documentId, title, loadGraph, scheduleLocate]);

  // 阅读位置变化 → 重新定位
  useEffect(() => {
    if (!active || !kernel) return;
    const off = kernel.on("relocate", () => scheduleLocate());
    scheduleLocate(0);
    return () => {
      off();
      if (locTimer.current != null) window.clearTimeout(locTimer.current);
    };
  }, [active, kernel, scheduleLocate]);

  // 增量
  useEffect(() => {
    if (!active) return;
    return eventBus.on("mindmap/delta", (raw) => {
      const d = raw as MindmapDelta;
      if (!d || !d.mapId) return;
      const g = graphRef.current;
      if (!g || d.mapId !== g.mapId) {
        if (d.documentId != null && String(d.documentId) === String(docRef.current) && d.kind === "skeleton") void loadGraph();
        return;
      }
      setGraph((cur) => (cur && cur.mapId === d.mapId ? applyDelta(cur, d as Parameters<typeof applyDelta>[1]) : cur));
      if (d.nodes && d.nodes.length) {
        anchorCache.current.clear();
        setAnchorEpoch((n) => n + 1); // D199：清缓存即安排重取，否则强调重建不出来
        scheduleLocate(300);
      }
      if (d.jobDone && d.jobId) {
        if (d.jobId === busyRef.current) {
          setBusy(null);
          if (!d.jobDone.ok && !(d.jobDone as { aborted?: boolean }).aborted) {
            pendingExpandRef.current = null;
            showStatus(T("没能生成：{msg}", { msg: d.jobDone.error || "" }), 6000);
          }
          scheduleLocate(0);
        }
        if (d.jobId === explainJobRef.current) {
          explainJobRef.current = null;
          setExplainBusy(null);
        }
      }
    });
  }, [active, loadGraph, scheduleLocate, T]);

  // 其它地方（图谱页签）生成了新版本 / 切换了版本 → 重载
  useEffect(() => {
    if (!active) return;
    return eventBus.on("mindmap/changed", (raw) => {
      const p = raw as { documentId?: string; stage?: string };
      if (p && p.documentId != null && String(p.documentId) === String(docRef.current) && p.stage && p.stage !== "running") {
        anchorCache.current.clear();
        setAnchorEpoch((n) => n + 1); // D199：图谱重载后同样要重取锚（否则强调留缺口）
        void loadGraph();
        scheduleLocate(200);
      }
    });
  }, [active, loadGraph, scheduleLocate]);

  // ---------- 派生：父链截断 + 透镜折叠 + 聚焦 N + 显式全图 ----------
  const readingId = loc?.nodeId && graph && graph.mapId === loc.mapId && graph.nodes[loc.nodeId] ? loc.nodeId : null;
  const focusId = sel && sel !== ROOT_ID && graph?.nodes[sel] ? sel : readingId;
  /** 截断点＝阅读节点的直接父节点（第六轮：它成为图的顶；更高层级父节点不展示） */
  const cutId = readingId && graph ? graph.nodes[readingId]?.parentId ?? null : null;
  const cutNode = cutId && graph?.nodes[cutId] ? graph.nodes[cutId] : null;
  const cutGraph = useMemo(() => {
    if (!graph) return null;
    if (cutId && graph.nodes[cutId]) {
      const pruned = pruneToCut(graph, cutId);
      const patterns: Record<string, PatternKey> = { ...(graph.view.patterns as Record<string, PatternKey>) };
      delete patterns[cutId];
      patterns[ROOT_ID] = graph.view.patterns[cutId] ?? selectPattern(groupFacts(graph, cutId, childrenOf(graph, cutId)));
      return { graph: pruned, patterns };
    }
    return { graph, patterns: graph.view.patterns as Record<string, PatternKey> };
  }, [graph, cutId]);

  /**
   * 透镜的静息派生：父链截断到直接父节点 + 除阅读节点祖先链外全部分叉默认收起。
   * 聚焦是**再派生**的一层（layout 的 maxChildren），不改这里的折叠真值、不写用户 overrides。
   */
  const lensGraph = useMemo(() => {
    if (!graph || !cutGraph) return null;
    const collapsed = new Set<string>();
    if (cutId && graph.nodes[cutId]) {
      for (const id of Object.keys(cutGraph.graph.nodes)) {
        if ((cutGraph.graph.children[id]?.length ?? 0) === 0) continue;
        if (overrides.get(id) ?? true) collapsed.add(id);
      }
      return setView(cutGraph.graph, { patterns: cutGraph.patterns, collapsed: [...collapsed] });
    }
    const chain = readingId ? new Set(ancestors(graph, readingId)) : new Set<string>();
    for (const id of Object.keys(graph.nodes)) {
      if ((graph.children[id]?.length ?? 0) === 0) continue;
      const o = overrides.get(id);
      if (o !== undefined ? o : !chain.has(id)) collapsed.add(id);
    }
    return setView(graph, { patterns: cutGraph.patterns, collapsed: [...collapsed] });
  }, [graph, cutGraph, cutId, readingId, overrides]);
  const collapsedRef = useRef<ReadonlySet<string>>(new Set());
  collapsedRef.current = lensGraph?.collapsed ?? new Set();

  /** 显式全图：截断子树全部分叉展开（不是整本材料的完整图谱——那个走「在完整图谱中打开」）。 */
  const allGraph = useMemo(() => {
    if (!graph || !cutGraph) return null;
    return setView(cutGraph.graph, { patterns: cutGraph.patterns, collapsed: [] });
  }, [graph, cutGraph]);

  /** 聚焦档的派生视图：阅读节点在顶层排最前，其余保持原文顺序（选中不触发重排，避免选中改 bounds）。 */
  const focusGraph = useMemo(() => {
    if (!lensGraph) return null;
    return reorderRoot(lensGraph, readingId);
  }, [lensGraph, readingId]);

  const rootKids = lensGraph ? childrenOf(lensGraph, ROOT_ID) : [];
  const displayGraph = showAll ? allGraph : focusN != null ? focusGraph : lensGraph;
  const displayMax = useMemo(
    () => (!showAll && focusN != null ? ({ [ROOT_ID]: focusN } as Readonly<Record<string, number>>) : undefined),
    [showAll, focusN],
  );

  /** 「在完整图谱中打开」后短暂强调的区域＝透镜当前**展示出来的**节点（顶节点 + 未收起的后代） */
  const lensRegionIds = useMemo(() => {
    if (!graph || !cutId || !graph.nodes[cutId]) return readingId ? [readingId] : [];
    const out: string[] = [cutId];
    const collapsed = lensGraph?.collapsed;
    const walk = (id: string) => {
      for (const c of graph.children[id] ?? []) {
        out.push(c);
        if (!collapsed?.has(c)) walk(c);
      }
    };
    walk(cutId);
    return out;
  }, [graph, cutId, readingId, lensGraph]);

  /** 画布内可达的选中 / 焦点（sel 可能指向被截断掉的祖先层级，回落为 null） */
  const lensSelId = sel && lensGraph?.nodes[sel] ? sel : null;
  const lensFocusId = lensSelId && lensGraph?.nodes[lensSelId] ? lensSelId : readingId && lensGraph?.nodes[readingId] ? readingId : null;

  /** 版式标签（保留「图谱类型」，如图中的「论证图」）：按焦点所在组的规则 / 提示 / 手动求 */
  const patternSel = useMemo(() => {
    if (!graph) return null;
    const gid = focusId ? graph.nodes[focusId]?.parentId ?? ROOT_ID : ROOT_ID;
    if (gid !== ROOT_ID && !graph.nodes[gid]) return null;
    return selectPattern(groupFacts(graph, gid, childrenOf(graph, gid)));
  }, [graph, focusId]);

  const scopeNode = loc?.scopeNodeId && graph ? graph.nodes[loc.scopeNodeId] ?? null : null;
  const scopeStreaming = scopeNode?.state === "streaming";
  const needsGenerate = !!loc?.ready && !loc.scopeOutlined && !loc.scopeFloor && !!loc.scopeNodeId && !scopeStreaming && !sel;
  const feedUnsupported = !!feed.unsupported;

  // ---------- 量内容 / fit ----------
  const frameLabel = useMemo(
    () => (p: PatternKey, how: PatternHow) => `${T(PATTERN_NAMES[p])} · ${T(HOW_NAMES[how])}`,
    [T],
  );
  const rootTitle = cutNode?.title || graph?.meta?.title || title;
  const rootType = cutNode?.type ? String(cutNode.type) : "";
  const measureGraph = useCallback(
    (g: GraphState, maxChildren?: Readonly<Record<string, number>>, noLod?: boolean, cache?: LayoutCache) => {
      const timed = perfOn(); // C-32 A1：布局计时（perf 开启时计入当前测量窗）
      const t0 = timed ? performance.now() : 0;
      // C-32 A2：cache 由调用方传入（requestFit 内所有 measureGraph 共用一个）；缺省＝每次新缓存（原行为）
      const d = layoutGraph(g, { cache: cache ?? createLayoutCache(), locks: {}, frameLabel, rootTitle, maxChildren, noLod });
      if (timed) perfLayout(performance.now() - t0);
      return { d, content: { w: d.bounds.w, h: d.bounds.h } };
    },
    [frameLabel, rootTitle],
  );

  /** 就地渲染 / 测试无 IPC 时的本地兜底（真实窗口由 lens.tsx 注入 window.lensAPI.fit） */
  const fallbackFit = useCallback(
    async (req: LensFitRequest): Promise<LensFitReply> => {
      const w = Math.max(360, typeof window !== "undefined" ? window.innerWidth : 1228);
      const h = Math.max(160, typeof window !== "undefined" ? window.innerHeight : 811);
      const workArea = { x: 0, y: 0, width: w, height: h };
      const r = computeFit({
        content: req.content,
        workArea,
        mode: req.mode,
        anchor: req.anchor,
        current: req.current,
        bounds: { x: 0, y: 0, width: w, height: h },
      });
      return { scale: r.scale, bounds: r.bounds, workArea: r.workArea, clamped: r.clamped, tier: r.tier };
    },
    [],
  );
  const callFit = fit ?? fallbackFit;

  /** D204：被点节点卡片中心在屏幕 DIP 的当前位置（改 overrides 之前调用）。 */
  const captureNodeScreen = useCallback((id: string) => {
    try {
      const el = document.querySelector(`.mm2-focus-canvas svg g[data-node-id="${String(id)}"]`);
      const r = el?.getBoundingClientRect();
      if (!r || r.width <= 0 || r.height <= 0) return null;
      return { x: Math.round(window.screenX + r.left + r.width / 2), y: Math.round(window.screenY + r.top + r.height / 2) };
    } catch {
      return null;
    }
  }, []);

  const markExpanding = useCallback((id: string) => {
    const anchorScreen = captureNodeScreen(id);
    if (!anchorScreen) {
      pendingExpandRef.current = null;
      return;
    }
    pendingExpandRef.current = { anchorScreen, nodeId: id };
    if (pendingExpandTimer.current != null) window.clearTimeout(pendingExpandTimer.current);
    pendingExpandTimer.current = window.setTimeout(() => {
      pendingExpandRef.current = null;
      pendingExpandTimer.current = null;
    }, 30000);
  }, [captureNodeScreen]);

  /**
   * D204：窗口 bounds 正在缓动时，宿主按「目标原点 − 当前窗口原点」反向平移，
   * 使内容（尤其被点节点）在整个缓动期间停在目标屏幕位置；窗口/纸片绕它生长。
   */
  const startHostFix = useCallback((target: { x: number; y: number }) => {
    if (growRaf.current != null) cancelAnimationFrame(growRaf.current);
    const token = ++growToken.current;
    const t0 = performance.now();
    const tick = () => {
      if (token !== growToken.current) return;
      const el = hostRef.current;
      if (el) {
        const dx = target.x - window.screenX;
        const dy = target.y - window.screenY;
        el.style.transform = Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 ? "" : `translate(${dx}px, ${dy}px)`;
      }
      if (performance.now() - t0 < 280) growRaf.current = requestAnimationFrame(tick);
      else {
        growRaf.current = null;
        if (hostRef.current) hostRef.current.style.transform = "";
      }
    };
    growRaf.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => () => {
    if (growRaf.current != null) cancelAnimationFrame(growRaf.current);
    if (pendingExpandTimer.current != null) window.clearTimeout(pendingExpandTimer.current);
  }, []);

  const requestFit = useCallback(async () => {
    if (!active || !graph || !lensGraph) return;
    const token = ++fitSeqRef.current;
    fitBusyRef.current = true;
    // D204：展开/收起/深挖带旧的被点节点屏幕点；本次请求结束即消费
    const pending = pendingExpandRef.current;
    pendingExpandRef.current = null;
    if (pendingExpandTimer.current != null) {
      window.clearTimeout(pendingExpandTimer.current);
      pendingExpandTimer.current = null;
    }
    const expandReq = pending ? { anchorScreen: pending.anchorScreen, animate: true as const } : {};
    const pinId = pending?.nodeId ?? null;
    // C-32 A2：本次 fit 请求内所有 measureGraph 调用共用一个布局缓存（子树复用；等价性闸门见
    // tests/m15v2.lensfit-cache.test.cjs——共享与新缓存的布局结果逐字节全等）
    const fitCache = createLayoutCache();
    // C-32 A1：fit IPC 前后计时（perf 开启时计入当前测量窗；本地兜底同样计入）
    const fitTimed = async (req: LensFitRequest) => {
      const t0 = perfOn() ? performance.now() : 0;
      try {
        return await callFit(req);
      } finally {
        if (t0) perfIpc(performance.now() - t0);
      }
    };
    try {
      const view = canvasRef.current?.getView();
      const current = view
        ? { scale: view.scale, offsetX: LENS_PAD_SIDE + view.tx, offsetY: LENS_PAD_TOP + view.ty }
        : { scale: 1, offsetX: LENS_PAD_SIDE, offsetY: LENS_PAD_TOP };
      const anchorOf = (d: Display) => {
        const id = pinId && d.byId[pinId] ? pinId : sel && d.byId[sel] ? sel : readingId && d.byId[readingId] ? readingId : ROOT_ID;
        const it = d.byId[id];
        return it ? { id, ...rectOf(it) } : null;
      };

      if (showAll) {
        const m = measureGraph(allGraph ?? lensGraph, undefined, true, fitCache);
        const key = `all|${m.content.w}x${m.content.h}`;
        if (fitted && lastFitRef.current === key) return;
        const r = await fitTimed({ content: m.content, anchor: anchorOf(m.d), current, mode: "all", ...expandReq });
        if (token !== fitSeqRef.current) return;
        setFitState({ scale: r.scale, tier: r.tier, content: m.content, bounds: r.bounds });
        setFocusN(null);
        setFitted(true);
        lastFitRef.current = key;
        if (pending) startHostFix({ x: r.bounds.x, y: r.bounds.y });
        return;
      }

      const base = measureGraph(lensGraph, undefined, true, fitCache);
      const baseKey = `auto|${base.content.w}x${base.content.h}`;
      if (fitted && lastFitRef.current === baseKey) return;
      const probe = await fitTimed({ content: base.content, anchor: anchorOf(base.d), current, mode: "fit", ...expandReq });
      if (token !== fitSeqRef.current) return;
      const total = rootKids.length;
      if (!readingId || probe.tier !== "focus" || total <= 1) {
        // 完整内容放得下（或没有可裁剪的子项）：按探测结果落窗；total<=1 时强制聚焦口径
        const r = probe.tier === "focus"
          ? await fitTimed({ content: base.content, anchor: anchorOf(base.d), current, mode: "focus", ...expandReq })
          : probe;
        if (token !== fitSeqRef.current) return;
        setFitState({ scale: r.scale, tier: r.tier, content: base.content, bounds: r.bounds });
        setFocusN(null);
        setFitted(true);
        lastFitRef.current = baseKey;
        if (pending) startHostFix({ x: r.bounds.x, y: r.bounds.y });
        return;
      }

      const fg = focusGraph ?? lensGraph;
      const choice = chooseFocus({
        total,
        measure: (n) => measureGraph(fg, { [ROOT_ID]: n }, undefined, fitCache).content,
        workArea: probe.workArea,
      });
      const fkey = `focus|${choice.n}|${choice.content.w}x${choice.content.h}`;
      if (fitted && lastFitRef.current === fkey) {
        setFocusN(choice.n);
        return;
      }
      const fm = measureGraph(fg, { [ROOT_ID]: choice.n }, undefined, fitCache);
      const r = await fitTimed({ content: fm.content, anchor: anchorOf(fm.d), current, mode: "focus", ...expandReq });
      if (token !== fitSeqRef.current) return;
      setFitState({ scale: r.scale, tier: r.tier, content: fm.content, bounds: r.bounds });
      setFocusN(choice.n);
      setFitted(true);
      lastFitRef.current = fkey;
      if (pending) startHostFix({ x: r.bounds.x, y: r.bounds.y });
      // 选中节点若落在被裁掉的尾部：清掉选中，避免「选中了看不见的节点」
      if (sel) {
        const top = lensGraph.nodes[sel]?.parentId == null ? sel : ancestors(lensGraph, sel)[0];
        const order = childrenOf(fg, ROOT_ID);
        if (top && order.indexOf(top) >= choice.n) {
          setSel(null);
          setExplainFor(null);
        }
      }
    } catch (err) {
      if (token === fitSeqRef.current) showStatus(T("结构图尺寸计算失败：{msg}", { msg: err instanceof Error ? err.message : String(err) }), 6000);
    } finally {
      fitBusyRef.current = false;
    }
  }, [active, graph, lensGraph, allGraph, focusGraph, rootKids.length, sel, readingId, showAll, fitted, measureGraph, callFit, startHostFix, T]);

  const requestFitRef = useRef(requestFit);
  requestFitRef.current = requestFit;
  // 内容变化 debounce 80ms；展开/收起（pending）立即 fit，不等防抖，让窗口缓动与图生长同步。
  // 只由「图的结构 / 折叠 / 预设 / 文档 / 阅读位置」触发；选中不触发窗口 resize。
  useEffect(() => {
    if (!active || !lensGraph) return;
    const pending = pendingExpandRef.current;
    const t = window.setTimeout(() => void requestFitRef.current(), pending ? 0 : 80);
    return () => window.clearTimeout(t);
  }, [active, lensGraph, showAll, documentId, readingId, rootTitle]);

  // 比例由宿主决定：只有「图 / 比例 / 聚焦档 / 全图」变化才重设画布比例（tx/ty 归零）。
  // D204：同比例的内容变化（展开/收起）不再 setViewScale，避免清掉 planTransition 生长动画。
  const scaleKey = `${displayGraph?.mapId ?? ""}|${fitState?.scale ?? ""}|${showAll ? "all" : focusN ?? "auto"}`;
  useEffect(() => {
    if (fitted && fitState) canvasRef.current?.setViewScale(fitState.scale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scaleKey]);

  // ---------- 控制轨 / 状态 ----------
  const hideRailIfIdle = useCallback(() => {
    if (!nearTopRef.current && !railHoldRef.current) setRailOn(false);
  }, []);
  const showRailTemporarily = useCallback(
    (ms = 2500) => {
      setRailOn(true);
      if (railTimer.current != null) window.clearTimeout(railTimer.current);
      railTimer.current = window.setTimeout(() => {
        railTimer.current = null;
        hideRailIfIdle();
      }, ms);
    },
    [hideRailIfIdle],
  );
  useEffect(() => () => {
    if (railTimer.current != null) window.clearTimeout(railTimer.current);
    if (statusTimer.current != null) window.clearTimeout(statusTimer.current);
  }, []);

  function showStatusSoon(text: string, ms = 4000) {
    setNote(text);
    if (statusTimer.current != null) window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => {
      statusTimer.current = null;
      setNote("");
    }, ms);
  }
  const showStatus = useCallback((text: string, ms = 4000) => showStatusSoon(text, ms), []);

  // 每次（重新）呼出：控制轨自动亮 1.6s，并回到默认分级（D203 §8.4）
  useEffect(() => {
    if (!active) return;
    showRailTemporarily(1600);
    if (visible !== false) setShowAll(false);
  }, [active, visible, showRailTemporarily]);

  // ---------- 正文强调 ----------
  const [anchorTick, setAnchorTick] = useState(0);
  const wantAnchors = useMemo(() => [focusId, hoverId].filter((x): x is string => !!x), [focusId, hoverId]);
  useEffect(() => {
    if (!active) return;
    const g = graphRef.current;
    if (!g?.mapId) return;
    const missing = wantAnchors.filter((id) => !anchorCache.current.has(`${g.mapId}|${id}`));
    if (!missing.length) return;
    let alive = true;
    const mapId = g.mapId;
    mindmapV2Api
      .nodeAnchors(mapId, missing)
      .then((r) => {
        if (!alive) return;
        for (const id of missing) anchorCache.current.set(`${mapId}|${id}`, r.anchors?.[id] ?? null);
        setAnchorTick((n) => n + 1);
      })
      .catch(() => {
        /* 强调是锦上添花 */
      });
    return () => {
      alive = false;
    };
  }, [active, wantAnchors, graph?.mapId, anchorEpoch]);
  // 窗口收起 / 重新呼出（D199）：收起＝面板不在场，锚缓存随之作废；呼出时安排重取，强调才能随面板回到正文。
  useEffect(() => {
    if (visible === false) {
      anchorCache.current.clear();
      return;
    }
    setAnchorEpoch((n) => n + 1);
  }, [visible]);
  useEffect(() => {
    if (!kernel?.setStructureHighlights) return;
    if (!onStage) {
      kernel.setStructureHighlights([]);
      return;
    }
    const mapId = graphRef.current?.mapId;
    const regions: ReaderStructureRegion[] = [];
    const add = (id: string | null, tone: "focus" | "hover") => {
      if (!id || !mapId) return;
      const list = anchorCache.current.get(`${mapId}|${id}`);
      if (!list) return;
      list.forEach((a, i) => regions.push({ key: `${tone}:${id}:${i}`, unitAnchor: a.unitAnchor, head: a.head, tail: a.tail, tone }));
    };
    add(focusId, "focus");
    if (hoverId && hoverId !== focusId) add(hoverId, "hover");
    kernel.setStructureHighlights(regions);
  }, [kernel, onStage, focusId, hoverId, anchorTick, graph?.mapId]);
  useEffect(() => () => kernel?.setStructureHighlights?.([]), [kernel]);

  // ---------- 画布交互 ----------
  const toggleCollapse = useCallback(
    (id: string) => {
      if (id === ROOT_ID) return;
      const next = !collapsedRef.current.has(id);
      perfBegin(next ? "expand" : "collapse"); // C-32 A1：用户点击展开/收起＝测量窗起点（过渡结束 perfEnd 落行）
      markExpanding(id); // 在改 overrides / 布局之前捕获被点节点的旧屏幕位置
      setSel(id);
      setExplainFor(null);
      setOverrides((m) => new Map(m).set(id, next));
      showRailTemporarily(2500);
    },
    [showRailTemporarily, markExpanding],
  );

  const onSelect = useCallback(
    (id: string | null) => {
      setExplainFor(null);
      if (!id || id === ROOT_ID) {
        setSel(null);
        return;
      }
      setSel(id);
      showRailTemporarily(2500);
    },
    [showRailTemporarily],
  );

  const onHover = useCallback((id: string | null) => setHoverId(id && id !== ROOT_ID ? id : null), []);

  // ---------- 动作 ----------
  const jumpTo = async (id: string) => {
    const g = graphRef.current;
    if (!kernel || !g?.mapId) return;
    const here = kernel.getCurrentLocation();
    try {
      const t = await mindmapV2Api.nodeText(g.mapId, id);
      if (!t.unitAnchor) {
        showStatus(T("原文还在读取，稍后再试。"));
        return;
      }
      // 记下最初的阅读位置（连跳几次也只回到最初那里）
      if (here) setBackLoc((prev) => prev ?? here);
      const ok = await kernel.goTo({ href: t.unitAnchor });
      // 第四轮 D1：整书搜索是「命中即止」，命中落在目录页时会把读者甩到目录（§9.2 旧结构轨同因）。
      // 只在 href 跳转失败（该书没有这个单元锚）时才用「前 20 字」兜底。
      if (!ok) {
        const probe = (t.text || "").replace(/\s+/g, " ").trim().slice(0, 20);
        if (probe.length >= 6) await kernel.goTo({ search: probe }).catch(() => false);
      }
      setSel(null); // 跳过去就是在读它了：回到跟随
      setExplainFor(null);
      showStatus(T("已跳到原文。"), 2600);
    } catch {
      /* 跳转是尽力而为 */
    }
  };
  const goBack = async () => {
    if (!kernel || !backLoc) return;
    const target = backLoc;
    setBackLoc(null);
    setSel(null);
    setExplainFor(null);
    try {
      await kernel.goTo(target);
      showStatus(T("已回到刚才读的位置。"), 2600);
    } catch {
      /* 忽略 */
    }
  };

  const SKIP: Record<string, string> = {
    floor: "这一处已经是最细的结构了。",
    cached: "这一处已经展开过了。",
    busy: "正在生成中。",
    no_text: "原文还在读取，稍后再试。",
  };
  const generateHere = async () => {
    if (!kernel || !documentId || !loc?.scopeNodeId) return;
    setNote("");
    setBusy("pending");
    try {
      const st = await ensureFed(kernel, documentId, title);
      if (!st.complete) {
        setBusy(null);
        showStatus(T("原文还在读取，稍后再试。"));
        return;
      }
      const { mapId, created } = await mindmapV2Api.ensureMap(documentId, title);
      if (created || mapId !== graphRef.current?.mapId) await loadGraph();
      const r = await mindmapV2Api.expand({ mapId, nodeId: loc.scopeNodeId, trigger: "click" });
      if (r.skipped) {
        setBusy(null);
        showStatus(T(SKIP[r.skipped] || r.skipped));
      } else setBusy(r.jobId || null);
    } catch (err) {
      setBusy(null);
      showStatus(T("没能生成：{msg}", { msg: err instanceof Error ? err.message : String(err) }), 6000);
    }
  };
  const deepen = async (id: string) => {
    const g = graphRef.current;
    if (!g?.mapId) return;
    // D204：深挖的新子节点到达后，窗口也要绕这颗节点生长（AI 可能延迟数秒，锚点先记下）
    markExpanding(id);
    try {
      const r = await mindmapV2Api.expand({ mapId: g.mapId, nodeId: id, trigger: "click" });
      if (r.skipped) {
        pendingExpandRef.current = null;
        showStatus(T(SKIP[r.skipped] || r.skipped));
      } else {
        setBusy(r.jobId || null);
        showStatus(T("正在把这一点再分出一层…"), 2600);
      }
    } catch (err) {
      pendingExpandRef.current = null;
      showStatus(T("没能生成：{msg}", { msg: err instanceof Error ? err.message : String(err) }), 6000);
    }
  };
  const explain = async (id: string) => {
    setExplainFor(id);
    const g = graphRef.current;
    if (!g?.mapId) return;
    const cached = graphRef.current?.explain[id] || graphRef.current?.nodes[id]?.explain || explainLocal[id];
    if (cached) return;
    setExplainBusy(id);
    try {
      const r = await mindmapV2Api.explain(g.mapId, id);
      if (r.cached) {
        if (r.explain) setExplainLocal((m) => ({ ...m, [id]: r.explain as string }));
        setExplainBusy(null);
        return;
      }
      if (r.jobId) {
        explainJobRef.current = r.jobId;
        setExplainBusy(id);
      } else setExplainBusy(null);
    } catch (err) {
      setExplainBusy(null);
      showStatus(T("没能生成：{msg}", { msg: err instanceof Error ? err.message : String(err) }), 6000);
    }
  };

  if (!supported || !open || hidden) return null;

  const pct = feed.total ? Math.round((feed.done / feed.total) * 100) : 0;
  const reading = !feed.complete && !feed.error;
  const focusNode = focusId && graph ? graph.nodes[focusId] ?? null : null;
  const explainNode = explainFor && graph ? graph.nodes[explainFor] ?? null : null;
  const explainText = explainFor ? graph?.explain[explainFor] || explainNode?.explain || explainLocal[explainFor] || "" : "";
  const patternName = patternSel ? T(PATTERN_NAMES[patternSel.pattern]) : "";
  const patternHow = patternSel ? T(HOW_NAMES[patternSel.how]) : "";
  const narrow = (fitState?.bounds.width ?? (typeof window !== "undefined" ? window.innerWidth : 1228)) < 520;
  const showSeed = !fitted || !graph || !loc?.ready || reading || !!feed.error || feedUnsupported || needsGenerate || scopeStreaming || busy === "pending";
  const scale = fitState?.scale ?? 1;
  const content = fitState?.content ?? { w: 0, h: 0 };
  const hostW = Math.max(1, Math.floor(content.w * scale));
  const hostH = Math.max(1, Math.floor(content.h * scale));

  const seedText = feedUnsupported
    ? T("这份材料暂不支持结构图。")
    : feed.error
      ? T("读取原文出错：{msg}", { msg: feed.error })
      : reading
        ? T("正在读取原文 {i}/{n}", { i: feed.done, n: feed.total })
        : !loc?.ready
          ? T("正在定位这一节在结构里的位置…")
          : needsGenerate
            ? T("这一节还没有细分的图谱，下面只有目录层级。")
            : busy === "pending" || scopeStreaming
              ? T("正在生成这一节的图谱…")
              : loc.scopeFloor && !focusNode
                ? T("这一节篇幅很短，不需要单独的图谱。")
                : !graph
                  ? T("这本书还没有图谱。")
                  : "";

  const rail = (
    <div className={`lens-rail${narrow ? " is-narrow" : ""}`} data-lens-rail>
      <div className="lens-rail-title" title={T("拖动窗口")}>
        <span className="lens-rail-grip" aria-hidden="true" />
        <b>{T("结构图")}</b>
      </div>
      <div className="lens-rail-center">
        {sel && focusNode ? (
          <div className="lens-rail-actions" data-rail-actions>
            <button type="button" className="lens-rail-action is-primary" data-act="jump" title={T("跳到原文")} aria-label={T("跳到原文")} onClick={() => void jumpTo(sel)}>
              {narrow ? T("原文") : T("跳到原文")}
            </button>
            <button type="button" className="lens-rail-action" data-act="explain" title={T("它在说什么")} aria-label={T("它在说什么")} onClick={() => void explain(sel)}>
              {narrow ? T("解释") : T("它在说什么")}
            </button>
            <button type="button" className="lens-rail-action" data-act="deepen" title={T("深挖")} aria-label={T("深挖")} disabled={!!busy} onClick={() => void deepen(sel)}>
              {busy ? T("深挖中…") : T("深挖")}
            </button>
            <button type="button" className="lens-rail-action" data-act="map" title={T("在完整图谱中打开")} aria-label={T("在完整图谱中打开")} onClick={() => onOpenInMap(sel, lensRegionIds)}>
              {narrow ? T("全图") : T("在完整图谱中打开")}
            </button>
          </div>
        ) : patternName ? (
          <span className="lens-rail-pattern" data-mm2-pattern={patternSel?.pattern} title={T("这一组的结构类型（{how}）", { how: patternHow })}>
            {patternName}
          </span>
        ) : null}
      </div>
      {onPin && (
        <button type="button" className={`lens-rail-btn${pinned ? " is-on" : ""}`} data-mm2-pin aria-pressed={!!pinned} onClick={onPin} title={T("窗口置顶")}>
          {T("置顶")}
        </button>
      )}
      <button type="button" className="lens-rail-btn lens-rail-close" data-mm2-close onClick={onClose} title={T("关闭结构图")} aria-label={T("关闭结构图")}>
        ×
      </button>
    </div>
  );

  return (
    <div
      className={`mm2-focus lens-window${railOn ? " is-rail-on" : ""}`}
      data-mm2-focus
      role="complementary"
      aria-label={T("结构图")}
      onPointerMove={(e) => {
        const near = e.clientY <= TOP_HOVER;
        nearTopRef.current = near;
        setRailOn(near);
      }}
      onPointerLeave={() => {
        nearTopRef.current = false;
        hideRailIfIdle();
      }}
      onFocusCapture={() => {
        railHoldRef.current = true;
        setRailOn(true);
      }}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          railHoldRef.current = false;
          hideRailIfIdle();
        }
      }}
    >
      <div className="lens-canvas">
        {rail}
        {showSeed ? (
          <div className="lens-seed" data-lens-seed>
            <div className="lens-seed-title">{T("结构图")}</div>
            {seedText ? <p className="lens-seed-note">{seedText}</p> : null}
            {needsGenerate && hasKey && (
              <button type="button" className="btn btn-primary btn-sm lens-seed-generate mm2-focus-generate" data-lens-generate onClick={() => void generateHere()} disabled={!feed.complete}>
                {T("生成这一节的图谱")}
              </button>
            )}
            {needsGenerate && !hasKey && <p className="lens-seed-note">{T("配置 AI Key 后可以为这一节生成图谱。")}</p>}
            {needsGenerate && hasKey && <p className="lens-seed-note">{T("只分析这一节，约 1 次调用。")}</p>}
            {(reading || busy === "pending" || scopeStreaming) && (
              <div className="lens-seed-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={T("正在读取原文")}>
                <span style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
        ) : displayGraph ? (
          <div ref={hostRef} className="mm2-focus-canvas lens-graph" style={{ left: LENS_PAD_SIDE, top: LENS_PAD_TOP, width: hostW, height: hostH }}>
            <MindmapCanvasV2
              ref={canvasRef}
              graph={displayGraph}
              rootTitle={rootTitle}
              rootType={rootType}
              selectedId={lensSelId}
              anchorId={lensFocusId}
              readingId={readingId}
              relAll={false}
              focus={false}
              autoFit={false}
              lensStyle
              viewAnchor={false}
              maxChildren={displayMax}
              noLod={showAll || focusN == null}
              onExpandAll={() => setShowAll(true)}
              onSelect={onSelect}
              onDeepen={(id) => void deepen(id)}
              onToggleCollapse={toggleCollapse}
              onHoverNode={onHover}
              onNodeDoubleClick={(id) => void jumpTo(id)}
            />
          </div>
        ) : null}

        {(backLoc || (sel && readingId && sel !== readingId)) && (
          <div className="lens-chips">
            {sel && readingId && sel !== readingId && (
              <button type="button" className="lens-chip" data-mm2-follow onClick={() => { setSel(null); setExplainFor(null); }}>
                {T("回到正在读的段落")}
              </button>
            )}
            {backLoc && (
              <button type="button" className="lens-chip" data-mm2-back onClick={() => void goBack()}>
                {T("回到刚才读的位置")}
              </button>
            )}
          </div>
        )}

        {explainFor && explainNode && (
          <div className="lens-explain is-on" data-lens-explain>
            <div className="lens-explain-head">
              <b>{T("它在说什么")}</b>
              <span title={explainNode.title}>{explainNode.title}</span>
              <button type="button" data-act="closeExplain" onClick={() => setExplainFor(null)}>
                {T("收起")}
              </button>
            </div>
            {explainText ? (
              <p>{explainText}</p>
            ) : explainBusy === explainFor ? (
              <p className="lens-explain-note">{T("正在说明…")}</p>
            ) : (
              <p className="lens-explain-note">{hasKey ? T("等待说明…") : T("配置 AI Key 后可以生成解释。")}</p>
            )}
          </div>
        )}

        {showAll && (
          <div className="lens-mode-chip is-on" data-lens-mode-chip>
            <span>{T("全图 · {s}×", { s: scale.toFixed(2) })}</span>
            <button type="button" data-lens-back-focus onClick={() => setShowAll(false)}>
              {T("回到聚焦")}
            </button>
          </div>
        )}

        {note && <div className="lens-status is-on" data-lens-status>{note}</div>}
      </div>
    </div>
  );
}
