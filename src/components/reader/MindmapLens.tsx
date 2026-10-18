// 结构透镜 v2「聚焦图谱」——阅读正文时，在正文右侧看到「正在读的这一段」在材料结构里的位置（用户 2026-10-18 第二轮）。
// 第一版（右缘细轨 + 文字列表面板）被否：像阅读进度条、点轨任意处都弹同一菜单、看不出列表项对应哪几段、
// 点「第一章」跳去目录页且回不来。本版：
//   · 入口＝工具栏「结构图」开关（Reader 控制 open）；
//   · 第三轮（同日）：右侧栏太窄、装不下时间轴等宽结构 → 按整体这一组的「版式」选排法与摆放：
//     AI 生成图谱时就给每组附带了 `{版式}` 提示（无则规则推断），窄高的（树 / 网格 / 论证图）放浮窗，
//     宽矮的（链 / 时间线 / 分层 / 对照）放正文下方；用户可手动切换（记住偏好），浮窗可拖动、缩放；
//   · 内容＝真正的节点-连线图，从完整图谱裁出（src/lib/mindmap/v2/focus.ts）：上方是它所属的整体，
//     左侧树干串起同一整体下的各部分（当前这点加粗、它的下一层挂在下面），右侧是与它相关的别处内容，
//     关系线标出「支持 / 反驳 / 依据 / 推出 …」；
//   · 图 ↔ 正文：焦点节点对应的段落在正文里底色强调，指针停在图里任何节点上，它对应的段落也亮起来
//     （kernel.setStructureHighlights）；
//   · 单击图中节点＝在图里换焦点查看（不跳转正文）；双击或「跳到原文」才跳，跳之前记下阅读位置，
//     面板顶部出现「回到刚才读的位置」；浏览别处时随时「回到正在读的段落」。
// 数据：kernel.getReadingProbe → mindmap:graphLocate（零 AI）；图走 graphLoad + EventBus mindmap/delta；
//      段落强调锚走 mindmap:graphNodeAnchors（零 AI）；原文送入与图谱页签共用 mindmapFeed 单例。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReaderKernel, ReaderLocation, ReaderStructureRegion } from "../../lib/reader/kernel";
import type { GraphState, RelCode, V2Node } from "../../lib/mindmap/v2/types";
import { applyDelta, createGraph } from "../../lib/mindmap/v2/graph";
import { REL_STYLE } from "../../lib/mindmap/v2/route";
import { buildFocus, layoutFocus, type FocusBox, type FocusHost, type FocusLayout, type FocusModel } from "../../lib/mindmap/v2/focus";
import { HOW_NAMES, PATTERN_NAMES } from "../../lib/mindmap/v2/pattern";
import { mindmapV2Api, type GraphLocate, type MindmapDelta, type NodeAnchor } from "../../lib/mindmapV2";
import { ensureFed, resetFeed, subscribeFeed, type FeedState } from "../../lib/mindmapFeed";
import { eventBus } from "../../lib/eventbus";
import { useT } from "../../lib/i18n";

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
  onOpenInMap: (nodeId: string | null) => void;
  /** 浮窗宿主（正文视口内的覆盖层）；缺省＝就地渲染（测试） */
  floatHost?: HTMLElement | null;
  /** 正文下方宿主；缺省＝就地渲染（测试） */
  dockHost?: HTMLElement | null;
}

type HostPref = "auto" | FocusHost;
interface FloatGeom { x: number; y: number; w: number; h: number; user: boolean }
const K_HOST = "mm2.lens.host";
const K_FLOAT = "mm2.lens.float";
const K_DOCK = "mm2.lens.dockH";
const DOCK_MIN = 180;
const DOCK_DEFAULT = 300;

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

const MARKERS = ["arrow", "bar", "open", "dot"] as const;

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
  /** 浏览别处：图的焦点＝用户点选的节点；null＝跟随阅读 */
  const [picked, setPicked] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  /** 「跳到原文」前的阅读位置 */
  const [backLoc, setBackLoc] = useState<ReaderLocation | null>(null);
  const [explainLocal, setExplainLocal] = useState<Record<string, string>>({});
  const [explainBusy, setExplainBusy] = useState<string | null>(null);
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
    setPicked(null);
    setHoverId(null);
    setBackLoc(null);
    setExplainLocal({});
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

  // ---------- 派生：聚焦小图 ----------
  const readingId = loc?.nodeId && graph && graph.mapId === loc.mapId && graph.nodes[loc.nodeId] ? loc.nodeId : null;
  const focusId = picked && graph?.nodes[picked] ? picked : readingId;
  const model: FocusModel | null = useMemo(() => (graph && focusId ? buildFocus(graph, focusId) : null), [graph, focusId]);
  const typeLabel = useCallback((n: V2Node) => (n.source !== "toc" && n.type && n.type !== "其他" ? T(String(n.type)) : ""), [T]);
  const layout: FocusLayout | null = useMemo(
    () => (model ? layoutFocus(model, Math.max(300, (fl?.w ?? 440) - 2), { type: typeLabel, more: (k) => T("另 {n} 项", { n: k }) }) : null),
    [model, fl?.w, typeLabel, T],
  );
  const host: FocusHost = hostPref === "auto" ? layout?.host ?? "float" : hostPref;

  const scopeNode = loc?.scopeNodeId && graph ? graph.nodes[loc.scopeNodeId] ?? null : null;
  const scopeStreaming = scopeNode?.state === "streaming";
  const needsGenerate = !!loc?.ready && !loc.scopeOutlined && !loc.scopeFloor && !!loc.scopeNodeId && !scopeStreaming && !picked;

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
      await kernel.goTo({ href: t.unitAnchor });
      const probe = (t.text || "").replace(/\s+/g, " ").trim().slice(0, 20);
      if (probe.length >= 6) await kernel.goTo({ search: probe }).catch(() => false);
      setPicked(null); // 跳过去就是在读它了：回到跟随
    } catch {
      /* 跳转是尽力而为 */
    }
  };
  const goBack = async () => {
    if (!kernel || !backLoc) return;
    const target = backLoc;
    setBackLoc(null);
    setPicked(null);
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
  // 浮窗初始几何：按图的自然尺寸给（时间轴宽而矮、树窄而高），右下角；用户拖过 / 缩放过之后就记住
  useEffect(() => {
    if (host !== "float" || !layout || fl?.user) return;
    const B = bounds();
    const w = Math.round(Math.max(380, Math.min(B.w * 0.62, layout.width + 4)));
    const h = Math.round(Math.max(320, Math.min(B.h - 32, layout.height + 210)));
    const g = { x: Math.max(8, B.w - w - 16), y: Math.max(8, B.h - h - 16), w, h, user: false };
    if (!fl || Math.abs(fl.w - g.w) > 24 || Math.abs(fl.h - g.h) > 24) setFl(g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, layout?.width, layout?.height, fl?.user]);
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

  // 焦点换了：画布滚到焦点卡
  const canvasRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = canvasRef.current;
    const b = layout?.boxes.find((x) => x.role === "focus");
    if (!el || !b) return;
    const top = b.y - 24, bottom = b.y + b.h + 24;
    if (top < el.scrollTop || bottom > el.scrollTop + el.clientHeight) el.scrollTo?.({ top: Math.max(0, top - el.clientHeight / 3), behavior: "smooth" });
  }, [layout, focusId]);

  if (!supported || !open || hidden || feed.unsupported) return null;

  const pct = feed.total ? Math.round((feed.done / feed.total) * 100) : 0;
  const reading = !feed.complete && !feed.error;
  const focusNode = focusId && graph ? graph.nodes[focusId] ?? null : null;
  const explainText = focusId ? graph?.explain[focusId] || focusNode?.explain || explainLocal[focusId] || "" : "";
  const relName = (c: string) => T(REL_STYLE[c as RelCode]?.name ?? c);
  const codes = layout ? [...new Set(layout.paths.filter((p) => p.kind === "rel").map((p) => p.code as RelCode))] : [];
  const nodeTitle = (id: string) => graph?.nodes[id]?.title ?? "";
  const crumbs = model?.crumbs ?? (loc?.scopeTitles ?? []);

  const dragProps = { onPointerMove: onDrag, onPointerUp: endDrag, onPointerCancel: endDrag };
  const style: React.CSSProperties =
    host === "float" ? (fl ? { left: fl.x, top: fl.y, width: fl.w, height: fl.h } : { right: 16, bottom: 16, width: 440, height: 480 }) : { height: dockH };
  const patternName = model ? T(PATTERN_NAMES[model.pattern]) : "";
  const patternHow = model ? T(HOW_NAMES[model.patternHow]) : "";
  const decorText = (t?: string) => (t === "@con" ? T("反方一侧") : t === "@others" ? T("相关的别处") : t ?? "");

  const panel = (
    <aside
      className={`mm2-focus is-${host}`}
      role="complementary"
      aria-label={T("结构图")}
      style={style}
      data-mm2-focus
      data-host={host}
      data-family={layout?.family ?? ""}
    >
      {host === "dock" && (
        <div className="mm2-focus-dock-resize" role="separator" aria-orientation="horizontal" aria-label={T("拖动调整高度")} onPointerDown={startDrag("dock")} {...dragProps} />
      )}
      <header className="mm2-focus-head" onPointerDown={host === "float" ? startDrag("move") : undefined} {...(host === "float" ? dragProps : {})}>
        <div className="mm2-focus-head-row">
          <span className="mm2-focus-title">{T("结构图")}</span>
          <span className={`mm2-focus-mode${picked ? " is-browsing" : ""}`}>{picked ? T("浏览中") : T("跟随阅读")}</span>
          {patternName && (
            <span className="mm2-focus-pattern" title={T("这一组的结构类型（{how}）——决定图的排法与摆放位置", { how: patternHow })} data-mm2-pattern={model?.pattern}>
              {patternName}
            </span>
          )}
          <span className="mm2-focus-spacer" />
          {picked && readingId && (
            <button type="button" className="mm2-focus-chip" onClick={() => setPicked(null)} data-mm2-follow>
              {T("回到正在读的段落")}
            </button>
          )}
          <button
            type="button"
            className="mm2-focus-x mm2-focus-host"
            data-mm2-host-toggle
            onClick={() => {
              const next: FocusHost = host === "float" ? "dock" : "float";
              setHostPref(layout && next === layout.host ? "auto" : next);
            }}
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
        {crumbs.length > 0 && (
          <div className="mm2-focus-crumbs" aria-label={T("所在位置")}>
            {crumbs.map((c, i) => (
              <span key={i} className="mm2-focus-crumb">
                {c}
              </span>
            ))}
          </div>
        )}
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
      <div className="mm2-focus-canvas" ref={canvasRef}>
        {reading && !loc && <p className="mm2-focus-note">{T("正在读取原文 {i}/{n}", { i: feed.done, n: feed.total })}</p>}
        {feed.error && <p className="mm2-focus-note">{T("读取原文出错：{msg}", { msg: feed.error })}</p>}
        {loc?.ready && !graph && !needsGenerate && <p className="mm2-focus-note">{T("这本书还没有图谱。")}</p>}
        {loc?.ready && loc.scopeFloor && !focusNode && <p className="mm2-focus-note">{T("这一节篇幅很短，不需要单独的图谱。")}</p>}
        {layout && model && (
          <svg
            key={focusId ?? ""}
            className="mm2-focus-svg"
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            role="img"
            aria-label={T("「{t}」所在的结构", { t: focusNode?.title ?? "" })}
            onMouseLeave={() => setHoverId(null)}
          >
            <defs>
              {(["n", "a"] as const).flatMap((tone) =>
                MARKERS.map((k) => (
                  <marker key={`${tone}-${k}`} id={`mm2f-${tone}-${k}`} viewBox="0 0 10 10" refX={k === "dot" ? 5 : 9} refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    {k === "arrow" && <path d="M1,1 L9,5 L1,9 Z" className={`mm2f-mk mm2f-mk-${tone}`} />}
                    {k === "open" && <path d="M1,1 L9,5 L1,9" fill="none" className={`mm2f-mk-line mm2f-mk-${tone}`} />}
                    {k === "bar" && <path d="M8,0 L8,10" className={`mm2f-mk-line mm2f-mk-${tone}`} />}
                    {k === "dot" && <circle cx="5" cy="5" r="3" className={`mm2f-mk mm2f-mk-${tone}`} />}
                  </marker>
                )),
              )}
            </defs>
            {layout.decor.map((d, i) =>
              d.kind === "frame" ? (
                <rect key={`d${i}`} className="mm2f-frame" x={d.x} y={d.y} width={d.w} height={d.h} />
              ) : d.kind === "axis" ? (
                <path key={`d${i}`} className="mm2f-axis" d={`M${d.x},${d.y} H${d.x + (d.w ?? 0)}`} />
              ) : d.kind === "tick" ? (
                <circle key={`d${i}`} className={`mm2f-tick${d.text ? " is-focus" : ""}`} cx={d.x} cy={d.y} r={d.text ? 5 : 3.5} />
              ) : (
                <text key={`d${i}`} className="mm2f-label" x={d.x} y={d.y}>
                  {decorText(d.text)}
                </text>
              ),
            )}
            <g className="mm2f-seq">
              {layout.paths
                .filter((p) => p.kind === "seq")
                .map((p) => (
                  <path key={p.key} d={p.d} markerEnd="url(#mm2f-n-arrow)" />
                ))}
            </g>
            <g className="mm2f-tree">
              {layout.paths
                .filter((p) => p.kind === "tree")
                .map((p) => (
                  <path key={p.key} d={p.d} className={`mm2f-tree-line${p.strong ? " is-strong" : ""}`} />
                ))}
            </g>
            {layout.gaps.map((gp) => (
              <g key={gp.key} className="mm2f-gap">
                <rect x={gp.x} y={gp.y} width={gp.w} height={gp.h} rx="3" />
                <text x={gp.x + 10} y={gp.y + gp.h / 2 + 4}>
                  {T("另 {n} 项", { n: gp.count })}
                </text>
              </g>
            ))}
            {layout.boxes.map((b) => (
              <NodeCard
                key={b.id}
                b={b}
                reading={b.id === readingId}
                hover={b.id === hoverId}
                hint={T("单击：在图中查看；双击：跳到原文")}
                readingLabel={T("正在读")}
                onEnter={() => setHoverId(b.id)}
                onClick={() => {
                  setNote("");
                  setPicked(b.id === readingId ? null : b.id);
                }}
                onDouble={() => void jumpTo(b.id)}
              />
            ))}
            <g className="mm2f-rels">
              {layout.paths
                .filter((p) => p.kind === "rel")
                .map((p) => {
                  const st = REL_STYLE[p.code as RelCode];
                  const tone = p.touchesFocus ? "a" : "n";
                  const lit = hoverId != null && (p.from === hoverId || p.to === hoverId);
                  return (
                    <g key={p.key} className={`mm2f-rel${p.touchesFocus ? " is-focus" : ""}${lit ? " is-lit" : ""}`}>
                      <title>{`${nodeTitle(p.from as string)} ${relName(p.code as string)} → ${nodeTitle(p.to as string)}`}</title>
                      {p.d && <path
                        d={p.d}
                        strokeDasharray={st?.dash || undefined}
                        strokeWidth={st?.width ?? 1.25}
                        markerEnd={st ? `url(#mm2f-${tone}-${st.end})` : undefined}
                        markerStart={st?.start ? `url(#mm2f-${tone}-${st.start})` : undefined}
                      />}
                      <g className="mm2f-rel-badge" transform={`translate(${p.lx},${p.ly})`}>
                        <circle r="8" />
                        <text y="3.5">{p.code}</text>
                      </g>
                    </g>
                  );
                })}
            </g>
          </svg>
        )}
      </div>

      {focusNode && (
        <section className="mm2-focus-detail" aria-label={T("节点详情")}>
          <div className="mm2-focus-detail-meta">
            {typeLabel(focusNode) && <span className="mm2-focus-type">{typeLabel(focusNode)}</span>}
            {focusId === readingId && <span className="mm2-focus-reading">{T("正在读")}</span>}
          </div>
          <p className="mm2-focus-detail-title">{focusNode.title}</p>
          {explainText ? (
            <p className="mm2-focus-explain">{explainText}</p>
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
            <button type="button" className="mm2-focus-link" onClick={() => onOpenInMap(focusNode.id)}>
              {T("在完整图谱中打开")}
            </button>
          </div>
          {codes.length > 0 && (
            <div className="mm2-focus-legend" aria-label={T("关系图例")}>
              {codes.map((c) => (
                <span key={c} className="mm2-focus-legend-item">
                  <b>{c}</b>
                  {relName(c)}
                </span>
              ))}
            </div>
          )}
        </section>
      )}
      </div>
      {note && <p className="mm2-focus-note mm2-focus-note-foot">{note}</p>}
      {host === "float" && <div className="mm2-focus-size" aria-hidden="true" onPointerDown={startDrag("size")} {...dragProps} />}
    </aside>
  );
  return hostEl ? createPortal(panel, hostEl) : panel;
}

function NodeCard({
  b,
  reading,
  hover,
  hint,
  readingLabel,
  onEnter,
  onClick,
  onDouble,
}: {
  b: FocusBox;
  reading: boolean;
  hover: boolean;
  hint: string;
  readingLabel: string;
  onEnter: () => void;
  onClick: () => void;
  onDouble: () => void;
}) {
  const metaY = 7 + 11;
  const titleTop = 7 + (b.meta ? 15 : 0);
  return (
    <g
      className={`mm2f-node is-${b.role}${b.linked ? " is-linked" : ""}${reading ? " is-reading" : ""}${hover ? " is-hover" : ""}`}
      transform={`translate(${b.x},${b.y})`}
      data-node-id={b.id}
      tabIndex={0}
      role="button"
      aria-label={b.lines.join("")}
      onMouseEnter={onEnter}
      onFocus={onEnter}
      onClick={onClick}
      onDoubleClick={onDouble}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDouble();
        else if (e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <title>{hint}</title>
      <rect className="mm2f-card" width={b.w} height={b.h} rx={b.role === "whole" ? 4 : 3} />
      {reading && <rect className="mm2f-reading-bar" x="0" y="0" width="3" height={b.h} />}
      {b.meta && (
        <text className="mm2f-meta" x="10" y={metaY}>
          {b.meta}
        </text>
      )}
      {reading && b.role !== "focus" && (
        <text className="mm2f-reading-tag" x={b.w - 8} y={metaY} textAnchor="end">
          {readingLabel}
        </text>
      )}
      {b.lines.map((ln, i) => (
        <text key={i} className="mm2f-title" x="10" y={titleTop + (i + 1) * b.line - (b.line - b.font) / 2 - 2} style={{ fontSize: b.font }}>
          {ln}
        </text>
      ))}
    </g>
  );
}
