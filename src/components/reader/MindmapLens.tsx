// 结构透镜 v2「聚焦图谱」——阅读正文时，在正文右侧看到「正在读的这一段」在材料结构里的位置（用户 2026-10-18 第二轮）。
// 第一版（右缘细轨 + 文字列表面板）被否：像阅读进度条、点轨任意处都弹同一菜单、看不出列表项对应哪几段、
// 点「第一章」跳去目录页且回不来。
// 演化：
//   · 第三轮（同日）：右侧栏太窄、装不下时间轴等宽结构 → 按整体这一组的「版式」选排法与摆放：
//     AI 生成图谱时就给每组附带了 `{版式}` 提示（无则规则推断），窄高的（树 / 网格 / 论证图）放浮窗，
//     宽矮的（链 / 时间线 / 分层 / 对照）放正文下方；用户可手动切换（记住偏好），浮窗可拖动、缩放；
//   · 第四轮：复用整套阅读透镜交互（题材 Token 对齐、reveal 定位、去冗余、跳到原文、讲解可收起）；
//   · 第五轮（2026-10-18，本轮）：**并入完整图谱画布**（用户实测：裁图版式与完整图谱的左右排布对不上）。
//     面板里不再是「裁出来的小图」，而是与图谱页签**同一套 MindmapCanvasV2** 画**完整结构图**：
//       · 以「当前阅读段落所处节点」为中心（canvas.reveal）；
//       · 子节点分叉默认收起（除阅读节点祖先链外全部折叠，避免整图过大），单击节点＝展开 / 收起其分叉；
//       · 展开沿用画布的生长动画（planTransition 进入帧 + 「刚到达」描边），与完整图谱生成时同一套。
//   · 图 ↔ 正文：焦点节点对应的段落在正文里底色强调，指针停在图里任何节点上，它对应的段落也亮起来
//     （canvas.onHoverNode → kernel.setStructureHighlights）；
//   · 单击图中节点＝选中（并展开 / 收起它的分叉）；双击或「跳到原文」才跳，跳之前记下阅读位置，
//     面板顶部出现「回到刚才读的位置」；浏览别处时随时「回到正在读的段落」。
// 数据：kernel.getReadingProbe → mindmap:graphLocate（零 AI）；图走 graphLoad + EventBus mindmap/delta；
//      段落强调锚走 mindmap:graphNodeAnchors（零 AI）；原文送入与图谱页签共用 mindmapFeed 单例。
//   · 第七轮（2026-10-19，D197）：面板搬进**独立窗口**（`electron/lensWindow.js` + `src/lens.tsx`）。
//     本组件因此不再自己决定「浮窗 / 正文下方」摆放，也不再自绘拖动与右下角缩放——窗口的四边 / 边角缩放
//     由系统原生承担，标题行是窗口拖动区（CSS `-webkit-app-region: drag`）。面板需要的「内核子集」
//     由宿主注入（阅读窗口直传真实内核；独立窗口传经 preload 桥代理的 LensKernel，见 src/lib/lensBridge.ts）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReaderLocation, ReaderStructureRegion, ReaderTocItem, RelocateInfo, SectionUnitInfo } from "../../lib/reader/kernel";
import type { GraphState, V2Edge, V2Node, PatternKey } from "../../lib/mindmap/v2/types";
import { ROOT_ID } from "../../lib/mindmap/v2/types";
import { ancestors, applyDelta, childrenOf, createGraph, setView } from "../../lib/mindmap/v2/graph";
import { groupFacts, selectPattern, HOW_NAMES, PATTERN_NAMES } from "../../lib/mindmap/v2/pattern";
import MindmapCanvasV2, { type MindmapCanvasHandle } from "./mindmap/MindmapCanvasV2";
import { mindmapV2Api, type GraphLocate, type MindmapDelta, type NodeAnchor } from "../../lib/mindmapV2";
import { ensureFed, resetFeed, subscribeFeed, type FeedState } from "../../lib/mindmapFeed";
import { eventBus } from "../../lib/eventbus";
import { useT } from "../../lib/i18n";
import { IconChevronDown } from "../icons";

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

export default function MindmapLens({ kernel, documentId, title, open, onClose, hidden, onOpenInMap, visible, pinned, onPin }: MindmapLensProps) {
  const T = useT();
  const [feed, setFeed] = useState<FeedState>({ done: 0, total: 0, complete: false, unsupported: false });
  const [loc, setLoc] = useState<GraphLocate | null>(null);
  const [graph, setGraph] = useState<GraphState | null>(null);
  const graphRef = useRef<GraphState | null>(null);
  graphRef.current = graph;
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [note, setNote] = useState("");
  const [hasKey, setHasKey] = useState(true);
  /** 浏览别处：选中＝用户点选的节点；null＝跟随阅读 */
  const [sel, setSel] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  /** 折叠覆盖：用户手动展开 / 收起过的节点（记真值，不随阅读位置自动重置） */
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  /** 「跳到原文」前的阅读位置 */
  const [backLoc, setBackLoc] = useState<ReaderLocation | null>(null);
  const [explainLocal, setExplainLocal] = useState<Record<string, string>>({});
  const [explainBusy, setExplainBusy] = useState<string | null>(null);
  /** 「它在说什么」输出开合（第四轮 D3：复用制卡台 AI 解释板块同一套收起——.wb-explain-toggle + .collapse-clip） */
  const [explainOpen, setExplainOpen] = useState(true);
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

  const supported = !!kernel && !!documentId && typeof kernel.getReadingProbe === "function" && typeof kernel.getSectionAnchors === "function";
  const active = open && !hidden && supported;
  /**
   * 「面板在场」（D199）：独立窗口下关闭＝隐藏，面板仍挂载——窗口不可见时对用户而言面板已不在场，
   * 正文强调（结构图独占的绘制层）必须收回；窗口再被呼出时随之重新贴上。
   * 就地渲染（测试 / 直传内核）无 visible 语义 → 恒在场。
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

  // 文档切换：清状态
  useEffect(() => {
    setLoc(null);
    setGraph(null);
    setBusy(null);
    setNote("");
    setSel(null);
    setHoverId(null);
    setOverrides(new Map());
    setBackLoc(null);
    setExplainLocal({});
    setExplainOpen(true);
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
          if (!d.jobDone.ok && !(d.jobDone as { aborted?: boolean }).aborted) setNote(T("没能生成：{msg}", { msg: d.jobDone.error || "" }));
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

  // ---------- 派生：父链截断后的子图 + 透镜折叠（默认分叉收起） ----------
  const readingId = loc?.nodeId && graph && graph.mapId === loc.mapId && graph.nodes[loc.nodeId] ? loc.nodeId : null;
  const focusId = sel && sel !== ROOT_ID && graph?.nodes[sel] ? sel : readingId;
  /** 截断点＝阅读节点的直接父节点（第六轮：它成为图的顶；更高层级父节点不展示） */
  const cutId = readingId && graph ? graph.nodes[readingId]?.parentId ?? null : null;
  const cutNode = cutId && graph?.nodes[cutId] ? graph.nodes[cutId] : null;
  /**
   * 第五轮 / 第六轮：透镜画的是**完整结构图**（同一份 GraphState、同一画布），只改两处口径——
   * ① 父链截断：以阅读节点的直接父节点为顶（更上层父节点不展示，想看更多父节点就跳完整图谱）；
   * ② 折叠：除顶节点（必展开）外，所有有子节点的默认收起，避免整图过大；用户手动开合过的节点用
   *    overrides 记住真值，不随阅读位置被重置。
   */
  const lensGraph = useMemo(() => {
    if (!graph) return null;
    const collapsed = new Set<string>();
    if (cutId && graph.nodes[cutId]) {
      const pruned = pruneToCut(graph, cutId);
      for (const id of Object.keys(pruned.nodes)) {
        if ((pruned.children[id]?.length ?? 0) === 0) continue;
        if (overrides.get(id) ?? true) collapsed.add(id);
      }
      const patterns: Record<string, PatternKey> = { ...(graph.view.patterns as Record<string, PatternKey>) };
      delete patterns[cutId];
      patterns[ROOT_ID] = graph.view.patterns[cutId] ?? selectPattern(groupFacts(graph, cutId, childrenOf(graph, cutId)));
      return setView(pruned, { patterns, collapsed: [...collapsed] });
    }
    const chain = readingId ? new Set(ancestors(graph, readingId)) : new Set<string>();
    for (const id of Object.keys(graph.nodes)) {
      if ((graph.children[id]?.length ?? 0) === 0) continue;
      const o = overrides.get(id);
      if (o !== undefined ? o : !chain.has(id)) collapsed.add(id);
    }
    return setView(graph, { patterns: graph.view.patterns, collapsed: [...collapsed] });
  }, [graph, readingId, cutId, overrides]);
  const collapsedRef = useRef<ReadonlySet<string>>(new Set());
  collapsedRef.current = lensGraph?.collapsed ?? new Set();

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

  /** 画布内可达的选中 / 焦点（sel 可能指向被截断掉的祖先层级，回落为 null，避免画布选不中虚 id） */
  const lensFocusId = lensGraph && focusId && lensGraph.nodes[focusId] ? focusId : null;

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
  /** 定位到节点并**保证可见**（画布 / 宿主可能还没就位 → 有限重试直到 reveal 命中） */
  const revealNode = useCallback((id: string, tries = 8) => {
    let left = tries;
    const tick = () => {
      if (canvasRef.current?.reveal(id)) return;
      if (left-- <= 0) return;
      window.setTimeout(tick, 120);
    };
    tick();
  }, []);

  // 跟随阅读：阅读位置换了（或刚回到跟随）→ 把阅读节点移到视野中心（浏览别处时不打扰）
  useEffect(() => {
    if (sel || !readingId) return;
    revealNode(readingId);
  }, [readingId, sel, graph?.mapId, revealNode]);

  const toggleCollapse = useCallback((id: string) => {
    if (id === ROOT_ID) return;
    // 目标值在更新器**外**算好：更新器必须纯（React StrictMode 会重放它，ref 在两次重放之间会变）
    const next = !collapsedRef.current.has(id);
    setSel(id);
    setOverrides((m) => new Map(m).set(id, next));
  }, []);

  const onSelect = useCallback(
    (id: string | null) => {
      setNote("");
      if (!id || id === ROOT_ID) {
        setSel(null);
        return;
      }
      setSel(id);
      // 第五轮：单击＝展开 / 收起它的分叉（子节点分叉默认收起，点一下才长出来）
      if ((graphRef.current?.children[id]?.length ?? 0) > 0) {
        const next = !collapsedRef.current.has(id);
        setOverrides((m) => new Map(m).set(id, next));
      }
    },
    [],
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
        setNote(T("原文还在读取，稍后再试。"));
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
    } catch {
      /* 跳转是尽力而为 */
    }
  };
  const goBack = async () => {
    if (!kernel || !backLoc) return;
    const target = backLoc;
    setBackLoc(null);
    setSel(null);
    try {
      await kernel.goTo(target);
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
        setNote(T("原文还在读取，稍后再试。"));
        return;
      }
      const { mapId, created } = await mindmapV2Api.ensureMap(documentId, title);
      if (created || mapId !== graphRef.current?.mapId) await loadGraph();
      const r = await mindmapV2Api.expand({ mapId, nodeId: loc.scopeNodeId, trigger: "click" });
      if (r.skipped) {
        setBusy(null);
        setNote(T(SKIP[r.skipped] || r.skipped));
      } else setBusy(r.jobId || null);
    } catch (err) {
      setBusy(null);
      setNote(T("没能生成：{msg}", { msg: err instanceof Error ? err.message : String(err) }));
    }
  };
  const deepen = async (id: string) => {
    const g = graphRef.current;
    if (!g?.mapId) return;
    setNote("");
    try {
      const r = await mindmapV2Api.expand({ mapId: g.mapId, nodeId: id, trigger: "click" });
      if (r.skipped) setNote(T(SKIP[r.skipped] || r.skipped));
      else setBusy(r.jobId || null);
    } catch (err) {
      setNote(T("没能生成：{msg}", { msg: err instanceof Error ? err.message : String(err) }));
    }
  };
  const explain = async (id: string) => {
    const g = graphRef.current;
    if (!g?.mapId) return;
    setNote("");
    setExplainOpen(true); // 与制卡台一致：内容到达即展开（用户随时可用上方的开合把手收起）
    try {
      const r = await mindmapV2Api.explain(g.mapId, id);
      if (r.cached) {
        if (r.explain) setExplainLocal((m) => ({ ...m, [id]: r.explain as string }));
        return;
      }
      if (r.jobId) {
        explainJobRef.current = r.jobId;
        setExplainBusy(id);
      }
    } catch (err) {
      setNote(T("没能生成：{msg}", { msg: err instanceof Error ? err.message : String(err) }));
    }
  };

  // ---------- 窗口承载（第七轮 D197）：拖动与四边 / 边角缩放交给独立窗口的原生能力 ----------
  // 标题行是窗口拖动区（CSS `-webkit-app-region: drag`），面板填满窗口；不再有浮窗几何 / 正文下方拖高。

  if (!supported || !open || hidden || feed.unsupported) return null;

  const pct = feed.total ? Math.round((feed.done / feed.total) * 100) : 0;
  const reading = !feed.complete && !feed.error;
  const focusNode = focusId && graph ? graph.nodes[focusId] ?? null : null;
  const explainText = focusId ? graph?.explain[focusId] || focusNode?.explain || explainLocal[focusId] || "" : "";
  /** 顶卡标题：截断点（阅读节点的直接父节点）存在时用它，否则回落到书 / 材料标题 */
  const rootTitle = cutNode?.title || graph?.meta?.title || title;
  const patternName = patternSel ? T(PATTERN_NAMES[patternSel.pattern]) : "";
  const patternHow = patternSel ? T(HOW_NAMES[patternSel.how]) : "";

  const panel = (
    <aside className="mm2-focus" role="complementary" aria-label={T("结构图")} data-mm2-focus>
      <header className="mm2-focus-head">
        <div className="mm2-focus-head-row">
          <span className="mm2-focus-title">{T("结构图")}</span>
          {/* 第四轮：跟随阅读是默认态，不再用文字说明；仅浏览他人节点时给出模式提示 */}
          {sel && <span className="mm2-focus-mode is-browsing">{T("浏览中")}</span>}
          {patternName && (
            <span className="mm2-focus-pattern" title={T("这一组的结构类型（{how}）", { how: patternHow })} data-mm2-pattern={patternSel?.pattern}>
              {patternName}
            </span>
          )}
          <span className="mm2-focus-spacer" />
          {sel && readingId && (
            <button type="button" className="mm2-focus-chip" onClick={() => setSel(null)} data-mm2-follow>
              {T("回到正在读的段落")}
            </button>
          )}
          {onPin && (
            <button
              type="button"
              className={`mm2-focus-x mm2-focus-pin${pinned ? " is-on" : ""}`}
              data-mm2-pin
              aria-pressed={!!pinned}
              onClick={onPin}
              title={T("窗口置顶")}
              aria-label={T("窗口置顶")}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3">
                <path d="M9.2 1.6 12.4 4.8 10.6 6.6 10.9 9.6 4.4 3.1 7.4 3.4z" />
                <path d="M6.6 7.4 2.8 11.2" />
              </svg>
            </button>
          )}
          <button type="button" className="mm2-focus-x" data-mm2-close onClick={onClose} aria-label={T("关闭结构图")} title={T("关闭结构图")}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </button>
        </div>
        {backLoc && (
          <button type="button" className="mm2-focus-back" onClick={() => void goBack()} data-mm2-back>
            <span aria-hidden="true">←</span> {T("回到刚才读的位置")}
          </button>
        )}
        {reading && (
          <div className="mm2-focus-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={T("正在读取原文")}>
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
      </header>

      {(needsGenerate || scopeStreaming || busy === "pending") && (
        <div className="mm2-focus-empty">
          {scopeStreaming || busy === "pending" ? (
            <p className="mm2-focus-note mm2-focus-live">{T("正在生成这一节的图谱…")}</p>
          ) : hasKey ? (
            <>
              <p className="mm2-focus-empty-text">{T("这一节还没有细分的图谱，下面只有目录层级。")}</p>
              <button type="button" className="btn btn-primary btn-sm mm2-focus-generate" onClick={() => void generateHere()} disabled={!feed.complete}>
                {T("生成这一节的图谱")}
              </button>
              <p className="mm2-focus-note">{T("只分析这一节，约 1 次调用。")}</p>
            </>
          ) : (
            <p className="mm2-focus-note">{T("配置 AI Key 后可以为这一节生成图谱。")}</p>
          )}
        </div>
      )}

      <div className="mm2-focus-body">
        <div className="mm2-focus-canvas">
          {reading && !loc && <p className="mm2-focus-note">{T("正在读取原文 {i}/{n}", { i: feed.done, n: feed.total })}</p>}
          {feed.error && <p className="mm2-focus-note">{T("读取原文出错：{msg}", { msg: feed.error })}</p>}
          {loc?.ready && !graph && <p className="mm2-focus-note">{T("这本书还没有图谱。")}</p>}
          {loc?.ready && loc.scopeFloor && !focusNode && <p className="mm2-focus-note">{T("这一节篇幅很短，不需要单独的图谱。")}</p>}
          {lensGraph && (
            <MindmapCanvasV2
              ref={canvasRef}
              graph={lensGraph}
              rootTitle={rootTitle}
              selectedId={lensFocusId}
              anchorId={lensFocusId}
              readingId={readingId}
              relAll={false}
              focus={false}
              onSelect={onSelect}
              onDeepen={(id) => void deepen(id)}
              onToggleCollapse={toggleCollapse}
              onHoverNode={onHover}
              onNodeDoubleClick={(id) => void jumpTo(id)}
            />
          )}
        </div>

        {focusNode && (
          <section className="mm2-focus-detail" aria-label={T("节点详情")}>
            {explainText ? (
              /* 收起复用制卡台 AI 解释板块同一套（.wb-explain-toggle + .collapse-clip.wb-explain-clip + .collapse-inner）；
                 第五轮：把手在**内容上方**（用户要求）→ 箭头随几何：展开＝朝上（收起）／收起＝朝下（展开）；换肤一处改、两处同步。 */
              <div className="mm2-focus-explain-wrap">
                <button
                  type="button"
                  className="wb-explain-toggle"
                  aria-expanded={explainOpen}
                  title={explainOpen ? T("收起解释") : T("展开解释")}
                  onClick={() => setExplainOpen((v) => !v)}
                >
                  <IconChevronDown size={14} className={explainOpen ? "is-flip" : undefined} />
                </button>
                <div className={`collapse-clip wb-explain-clip${explainOpen ? " is-open" : ""}`} aria-hidden={!explainOpen}>
                  <div className="collapse-inner">
                    <p className="mm2-focus-explain">{explainText}</p>
                  </div>
                </div>
              </div>
            ) : explainBusy === focusId ? (
              <p className="mm2-focus-note mm2-focus-live">{T("正在说明…")}</p>
            ) : null}
            <div className="mm2-focus-actions">
              <button type="button" className="mm2-focus-btn" onClick={() => void jumpTo(focusNode.id)} data-mm2-jump>
                {T("跳到原文")}
              </button>
              {!explainText && explainBusy !== focusId && hasKey && focusNode.source !== "toc" && (
                <button type="button" className="mm2-focus-btn" onClick={() => void explain(focusNode.id)} title={T("用一两句话说明这一部分在论证 / 说明什么（约 1 次调用）")}>
                  {T("它在说什么")}
                </button>
              )}
              {(focusNode.state === "more" || focusNode.state === "stub") && hasKey && (
                <button type="button" className="mm2-focus-btn" onClick={() => void deepen(focusNode.id)} disabled={!!busy} title={T("把这一点再分出一层")}>
                  {T("深挖")}
                </button>
              )}
              <span className="mm2-focus-spacer" />
              <button type="button" className="mm2-focus-link" onClick={() => onOpenInMap(focusNode.id, lensRegionIds)}>
                {T("在完整图谱中打开")}
              </button>
            </div>
          </section>
        )}
      </div>
      {note && <p className="mm2-focus-note mm2-focus-note-foot">{note}</p>}
    </aside>
  );
  return panel;
}
