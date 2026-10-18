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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReaderKernel, ReaderLocation, ReaderStructureRegion } from "../../lib/reader/kernel";
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
  kernel: ReaderKernel | null;
  documentId: string | null;
  title: string;
  /** 工具栏「结构图」开关 */
  open: boolean;
  onClose: () => void;
  /** 图谱页签正盖在正文上时隐藏（状态保留） */
  hidden: boolean;
  /** 「在完整图谱中打开」：切到图谱页签并聚焦该节点 */
  onOpenInMap: (nodeId: string | null, region?: string[]) => void;
  /** 浮窗宿主（正文视口内的覆盖层）；缺省＝就地渲染（测试） */
  floatHost?: HTMLElement | null;
  /** 正文下方宿主；缺省＝就地渲染（测试） */
  dockHost?: HTMLElement | null;
}

type HostPref = "auto" | "float" | "dock";
interface FloatGeom { x: number; y: number; w: number; h: number; user: boolean }
const K_HOST = "mm2.lens.host";
const K_FLOAT = "mm2.lens.float";
const K_DOCK = "mm2.lens.dockH";
const DOCK_MIN = 180;
const DOCK_DEFAULT = 300;
/** 浮窗默认尺寸（完整图谱要地方；用户拖过 / 缩放过之后记住） */
const FLOAT_MIN_W = 420;
const FLOAT_MAX_W = 640;
const FLOAT_MIN_H = 340;
const FLOAT_MAX_H = 580;

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(key: string, v: unknown) {
  try {
    window.localStorage?.setItem(key, JSON.stringify(v));
  } catch {
    /* 忽略 */
  }
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

export default function MindmapLens({ kernel, documentId, title, open, onClose, hidden, onOpenInMap, floatHost, dockHost }: MindmapLensProps) {
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
  const [hostPref, setHostPrefState] = useState<HostPref>(() => {
    const v = readJSON<string>(K_HOST, "auto");
    return v === "float" || v === "dock" ? v : "auto";
  });
  const setHostPref = (v: HostPref) => {
    setHostPrefState(v);
    writeJSON(K_HOST, v);
  };
  const [fl, setFl] = useState<FloatGeom | null>(() => {
    const g = readJSON<FloatGeom | null>(K_FLOAT, null);
    return g && [g.x, g.y, g.w, g.h].every(Number.isFinite) ? g : null;
  });
  const [dockH, setDockH] = useState<number>(() => {
    const v = Number(readJSON<number>(K_DOCK, DOCK_DEFAULT));
    return Number.isFinite(v) && v >= DOCK_MIN ? v : DOCK_DEFAULT;
  });
  const docRef = useRef(documentId);
  docRef.current = documentId;
  /** 正文强调锚缓存：`${mapId}|${nodeId}` → 锚（null＝无区间 / 原文未到） */
  const anchorCache = useRef<Map<string, NodeAnchor[] | null>>(new Map());
  const explainJobRef = useRef<string | null>(null);
  const canvasRef = useRef<MindmapCanvasHandle>(null);

  const supported = !!kernel && !!documentId && typeof kernel.getReadingProbe === "function" && typeof kernel.getSectionAnchors === "function";
  const active = open && !hidden && supported;

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

  const host: "float" | "dock" = hostPref === "auto" ? "float" : hostPref;

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
  }, [active, wantAnchors, graph?.mapId]);
  useEffect(() => {
    if (!kernel?.setStructureHighlights) return;
    if (!active) {
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
  }, [kernel, active, focusId, hoverId, anchorTick, graph?.mapId]);
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

  // ---------- 浮窗：拖动 / 缩放；下方区：拖高 ----------
  const hostEl = host === "float" ? floatHost : dockHost;
  const bounds = () => {
    const el = floatHost;
    return { w: el?.clientWidth || window.innerWidth || 1200, h: el?.clientHeight || window.innerHeight || 800 };
  };
  // 浮窗初始几何：完整图谱默认给一块够大的窗口，右下角；用户拖过 / 缩放过之后就记住
  useEffect(() => {
    if (host !== "float" || fl?.user) return;
    const B = bounds();
    const w = Math.round(Math.min(Math.max(FLOAT_MIN_W, B.w * 0.52), FLOAT_MAX_W));
    const h = Math.round(Math.min(Math.max(FLOAT_MIN_H, B.h * 0.62), FLOAT_MAX_H));
    const g = { x: Math.max(8, B.w - w - 16), y: Math.max(8, B.h - h - 16), w, h, user: false };
    if (!fl || Math.abs(fl.w - g.w) > 24 || Math.abs(fl.h - g.h) > 24) setFl(g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, fl?.user]);
  const dragRef = useRef<{ kind: "move" | "size" | "dock"; x: number; y: number; g: FloatGeom | null; h: number } | null>(null);
  const startDrag = (kind: "move" | "size" | "dock") => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (kind === "move" && (e.target as HTMLElement).closest("button")) return;
    dragRef.current = { kind, x: e.clientX, y: e.clientY, g: fl, h: dockH };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const onDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (d.kind === "dock") {
      setDockH(Math.max(DOCK_MIN, Math.min((window.innerHeight || 900) * 0.7, d.h - dy)));
      return;
    }
    if (!d.g) return;
    const B = bounds();
    if (d.kind === "move") setFl({ ...d.g, x: Math.max(0, Math.min(B.w - 80, d.g.x + dx)), y: Math.max(0, Math.min(B.h - 40, d.g.y + dy)), user: true });
    else setFl({ ...d.g, w: Math.max(320, Math.min(B.w - d.g.x, d.g.w + dx)), h: Math.max(240, Math.min(B.h - d.g.y, d.g.h + dy)), user: true });
  };
  const endDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.kind === "dock") writeJSON(K_DOCK, dockH);
    else if (fl) writeJSON(K_FLOAT, fl);
  };

  if (!supported || !open || hidden || feed.unsupported) return null;

  const pct = feed.total ? Math.round((feed.done / feed.total) * 100) : 0;
  const reading = !feed.complete && !feed.error;
  const focusNode = focusId && graph ? graph.nodes[focusId] ?? null : null;
  const explainText = focusId ? graph?.explain[focusId] || focusNode?.explain || explainLocal[focusId] || "" : "";
  /** 顶卡标题：截断点（阅读节点的直接父节点）存在时用它，否则回落到书 / 材料标题 */
  const rootTitle = cutNode?.title || graph?.meta?.title || title;
  const patternName = patternSel ? T(PATTERN_NAMES[patternSel.pattern]) : "";
  const patternHow = patternSel ? T(HOW_NAMES[patternSel.how]) : "";

  const dragProps = { onPointerMove: onDrag, onPointerUp: endDrag, onPointerCancel: endDrag };
  const style: React.CSSProperties =
    host === "float" ? (fl ? { left: fl.x, top: fl.y, width: fl.w, height: fl.h } : { right: 16, bottom: 16, width: 520, height: 480 }) : { height: dockH };

  const panel = (
    <aside
      className={`mm2-focus is-${host}`}
      role="complementary"
      aria-label={T("结构图")}
      style={style}
      data-mm2-focus
      data-host={host}
    >
      {host === "dock" && (
        <div className="mm2-focus-dock-resize" role="separator" aria-orientation="horizontal" aria-label={T("拖动调整高度")} onPointerDown={startDrag("dock")} {...dragProps} />
      )}
      <header className="mm2-focus-head" onPointerDown={host === "float" ? startDrag("move") : undefined} {...(host === "float" ? dragProps : {})}>
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
          <button
            type="button"
            className="mm2-focus-x mm2-focus-host"
            data-mm2-host-toggle
            onClick={() => setHostPref(host === "float" ? "dock" : "float")}
            title={host === "float" ? T("放到正文下方") : T("改成浮窗")}
            aria-label={host === "float" ? T("放到正文下方") : T("改成浮窗")}
          >
            {host === "float" ? (
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3">
                <rect x="1.5" y="1.5" width="11" height="11" />
                <path d="M1.5 8.5H12.5" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3">
                <rect x="1.5" y="1.5" width="11" height="11" />
                <rect x="6" y="6" width="5" height="4.5" />
              </svg>
            )}
          </button>
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
      {host === "float" && <div className="mm2-focus-size" aria-hidden="true" onPointerDown={startDrag("size")} {...dragProps} />}
    </aside>
  );
  return hostEl ? createPortal(panel, hostEl) : panel;
}
