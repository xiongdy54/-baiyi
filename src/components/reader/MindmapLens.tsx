// 结构透镜（阅读透镜）——阅读正文时就地查看「正在读的这段」在材料结构里的位置，或为所在章节就地生成图谱，
// 不必切到图谱页签（用户 2026-10-18）。设计：
//   · 收起态＝正文右缘一根 3px 的结构轨：按章节篇幅分段（已生成的段实、未生成的段虚），一颗强调色珠子标出当前位置；
//   · 展开态＝轨旁的玻璃面板：上方是祖先阶梯，中间是一根细线串起「同一层的要点」，珠子停在正在读的那一点上并随阅读滑动；
//     当前点的下一层挂在它下面；关系一两行；「在图谱中打开」。
//   · 唯一的动效：珠子滑动 + 新生成的要点落到线上（尊重 prefers-reduced-motion）。
// 数据：kernel.getReadingProbe（单元锚 + 段落开头片段）→ mindmap:graphLocate（块号 → 最深节点）；
//      图走 graphLoad + EventBus mindmap/delta 增量；原文送入与图谱页签共用 mindmapFeed 单例。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReaderKernel } from "../../lib/reader/kernel";
import type { GraphState, V2Node } from "../../lib/mindmap/v2/types";
import { applyDelta, createGraph, edgesOf } from "../../lib/mindmap/v2/graph";
import { REL_STYLE } from "../../lib/mindmap/v2/route";
import { mindmapV2Api, type GraphLocate, type MindmapDelta } from "../../lib/mindmapV2";
import { ensureFed, resetFeed, subscribeFeed, type FeedState } from "../../lib/mindmapFeed";
import { eventBus } from "../../lib/eventbus";
import { useT } from "../../lib/i18n";

export interface MindmapLensProps {
  kernel: ReaderKernel | null;
  documentId: string | null;
  title: string;
  /** 图谱页签正盖在正文上时隐藏（状态保留） */
  hidden: boolean;
  /** 「在图谱中打开」：切到图谱页签并聚焦该节点 */
  onOpenInMap: (nodeId: string | null) => void;
}

const OPEN_KEY = "mm2.lens.open";
const KIDS_MAX = 6;
const PATH_MAX = 3;

function readOpen(): boolean {
  try {
    return window.localStorage?.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}
function writeOpen(v: boolean) {
  try {
    window.localStorage?.setItem(OPEN_KEY, v ? "1" : "0");
  } catch {
    /* 隐私模式等：忽略 */
  }
}

export default function MindmapLens({ kernel, documentId, title, hidden, onOpenInMap }: MindmapLensProps) {
  const T = useT();
  const [open, setOpenState] = useState(readOpen);
  const setOpen = useCallback((v: boolean) => {
    setOpenState(v);
    writeOpen(v);
  }, []);
  const [feed, setFeed] = useState<FeedState>({ done: 0, total: 0, complete: false, unsupported: false });
  const [loc, setLoc] = useState<GraphLocate | null>(null);
  const [graph, setGraph] = useState<GraphState | null>(null);
  const graphRef = useRef<GraphState | null>(null);
  graphRef.current = graph;
  const [busy, setBusy] = useState<string | null>(null); // 进行中的生成 / 深挖 jobId
  const [note, setNote] = useState("");
  const [hasKey, setHasKey] = useState(true);
  const seenRef = useRef<Set<string>>(new Set()); // 已显示过的节点（新到达的才播落线动画）
  const docRef = useRef(documentId);
  docRef.current = documentId;

  const supported = !!kernel && !!documentId && typeof kernel.getReadingProbe === "function" && typeof kernel.getSectionAnchors === "function";

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
      const g = createGraph({ meta: r.meta, nodes: r.nodes, edges: r.edges, view: null }, String(r.meta.mapId));
      seenRef.current = new Set(Object.keys(g.nodes));
      setGraph(g);
    } catch {
      /* 读图失败：透镜保持空态 */
    }
  }, [documentId]);

  // ---------- 定位 ----------
  const locTimer = useRef<number | null>(null);
  const retriedRef = useRef(false);
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
      const st = feedRef.current;
      if (st.complete && !retriedRef.current) {
        retriedRef.current = true;
        resetFeed(kernel, documentId);
        void ensureFed(kernel, documentId, title).then(() => scheduleLocate(0));
      }
      return;
    }
    setLoc(r);
    if ((r.mapId || null) !== (graphRef.current?.mapId || null)) void loadGraph();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const feedRef = useRef(feed);
  feedRef.current = feed;

  // 文档切换：清状态
  useEffect(() => {
    setLoc(null);
    setGraph(null);
    setBusy(null);
    setNote("");
    retriedRef.current = false;
  }, [documentId, kernel]);

  // 送原文（展开过透镜才送：送原文要逐章取文，不为不用透镜的人白跑）
  useEffect(() => {
    if (!supported || !open || !kernel || !documentId) return;
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
  }, [supported, open, kernel, documentId, title, loadGraph, scheduleLocate]);

  // 阅读位置变化 → 重新定位
  useEffect(() => {
    if (!supported || !open || !kernel) return;
    const off = kernel.on("relocate", () => scheduleLocate());
    scheduleLocate(0);
    return () => {
      off();
      if (locTimer.current != null) window.clearTimeout(locTimer.current);
    };
  }, [supported, open, kernel, scheduleLocate]);

  // 增量：只认当前图；任务结束后重新定位（新长出的更深节点成为「正在读的这一点」）
  useEffect(() => {
    if (!open) return;
    return eventBus.on("mindmap/delta", (raw) => {
      const d = raw as MindmapDelta;
      if (!d || !d.mapId) return;
      const g = graphRef.current;
      if (!g || d.mapId !== g.mapId) {
        if (d.documentId != null && String(d.documentId) === String(docRef.current) && d.kind === "skeleton") void loadGraph();
        return;
      }
      setGraph((cur) => (cur && cur.mapId === d.mapId ? applyDelta(cur, d as Parameters<typeof applyDelta>[1]) : cur));
      if (d.nodes && d.nodes.length) scheduleLocate(300);
      if (d.jobDone && d.jobId && d.jobId === busyRef.current) {
        setBusy(null);
        if (!d.jobDone.ok && !d.jobDone.aborted) setNote(T("没能生成：{msg}", { msg: d.jobDone.error || "" }));
        scheduleLocate(0);
      }
    });
  }, [open, loadGraph, scheduleLocate, T]);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  // 其它地方（图谱页签）生成了新版本 / 切换了版本 → 重载
  useEffect(() => {
    if (!open) return;
    return eventBus.on("mindmap/changed", (raw) => {
      const p = raw as { documentId?: string; stage?: string };
      if (p && p.documentId != null && String(p.documentId) === String(docRef.current) && p.stage && p.stage !== "running") {
        void loadGraph();
        scheduleLocate(200);
      }
    });
  }, [open, loadGraph, scheduleLocate]);

  // Esc 收起
  useEffect(() => {
    if (!open || hidden) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hidden, setOpen]);

  // ---------- 派生 ----------
  const view = useMemo(() => {
    const g = graph;
    const nodeId = loc?.nodeId && g && g.mapId === loc.mapId ? loc.nodeId : null;
    const focus = nodeId && g ? g.nodes[nodeId] ?? null : null;
    const chain = (loc?.chain ?? []).filter((id) => g && g.nodes[id]);
    // 祖先：去掉材料根与当前点本身
    const ancestors = chain.slice(1, -1).map((id) => (g as GraphState).nodes[id]);
    const siblings: V2Node[] = focus && g ? (g.children[focus.parentId ?? "@root"] ?? []).map((id) => g.nodes[id]).filter(Boolean) : [];
    const kids: V2Node[] = focus && g ? (g.children[focus.id] ?? []).map((id) => g.nodes[id]).filter(Boolean) : [];
    const rels = focus && g ? edgesOf(g, focus.id).slice(0, 3) : [];
    return { focus, ancestors, siblings, kids, rels };
  }, [graph, loc]);

  const scopeNode = loc?.scopeNodeId && graph ? graph.nodes[loc.scopeNodeId] ?? null : null;
  const scopeStreaming = scopeNode?.state === "streaming";
  const needsGenerate = !!loc?.ready && !loc.scopeOutlined && !loc.scopeFloor && !!loc.scopeNodeId && !scopeStreaming;

  // ---------- 动作 ----------
  const jumpTo = async (n: V2Node) => {
    const g = graphRef.current;
    if (!kernel || !g?.mapId) return;
    try {
      const t = await mindmapV2Api.nodeText(g.mapId, n.id);
      if (t.unitAnchor) await kernel.goTo({ href: t.unitAnchor });
      const probe = (t.text || "").replace(/\s+/g, " ").trim().slice(0, 20);
      if (probe.length >= 6) await kernel.goTo({ search: probe }).catch(() => false);
    } catch {
      /* 跳转是尽力而为 */
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
  const deepen = async (n: V2Node) => {
    const g = graphRef.current;
    if (!g?.mapId) return;
    setNote("");
    try {
      const r = await mindmapV2Api.expand({ mapId: g.mapId, nodeId: n.id, trigger: "click" });
      if (r.skipped) setNote(T(SKIP[r.skipped] || r.skipped));
      else setBusy(r.jobId || null);
    } catch (err) {
      setNote(T("没能生成：{msg}", { msg: err instanceof Error ? err.message : String(err) }));
    }
  };

  // ---------- 珠子：停在当前项上，随阅读滑动 ----------
  const threadRef = useRef<HTMLOListElement>(null);
  const [beadY, setBeadY] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = threadRef.current?.querySelector<HTMLElement>("[data-current='1']");
    if (!el || !threadRef.current) {
      setBeadY(null);
      return;
    }
    setBeadY(el.offsetTop + Math.min(el.offsetHeight, 40) / 2);
    // 让当前点保持在面板可见区
    el.scrollIntoView?.({ block: "nearest" });
  }, [view, open]);

  // 新到达的要点（播一次落线动画）
  const freshIds = useMemo(() => {
    const s = new Set<string>();
    if (!graph) return s;
    for (const n of [...view.siblings, ...view.kids]) if (!seenRef.current.has(n.id)) s.add(n.id);
    return s;
  }, [graph, view]);
  useEffect(() => {
    for (const id of freshIds) seenRef.current.add(id);
  }, [freshIds]);

  // ---------- 轨 ----------
  const rail = useMemo(() => {
    const total = loc?.totalBlocks || 0;
    const segs: { id: string; top: number; h: number; done: boolean }[] = [];
    if (graph && total) {
      const rootId = Object.values(graph.nodes).find((n) => n.parentId == null)?.id;
      const tops = (graph.children[rootId ?? "@root"] ?? []).map((id) => graph.nodes[id]).filter((n) => n && n.blockStart != null && n.blockEnd != null);
      for (const n of tops) {
        const done = (graph.children[n.id] ?? []).length > 0 && n.state !== "more";
        segs.push({ id: n.id, top: ((n.blockStart as number) - 1) / total, h: ((n.blockEnd as number) - (n.blockStart as number) + 1) / total, done });
      }
    }
    const pos = loc?.block && total ? (loc.block - 0.5) / total : null;
    return { segs, pos };
  }, [graph, loc]);

  if (!supported || hidden || feed.unsupported) return null;

  const pct = feed.total ? Math.round((feed.done / feed.total) * 100) : 0;
  const reading = open && !feed.complete && !feed.error;
  const relName = (c: string) => T(REL_STYLE[c as keyof typeof REL_STYLE]?.name ?? c);
  const focus = view.focus;
  const titleOf = (id: string) => graph?.nodes[id]?.title ?? "";
  const typeOf = (n: V2Node) => (n.source !== "toc" && n.type && n.type !== "其他" ? T(String(n.type)) : "");

  return (
    <>
      <button
        type="button"
        className={`mm2-lens-rail${open ? " is-open" : ""}`}
        aria-pressed={open}
        aria-label={open ? T("收起结构透镜") : T("展开结构透镜：查看正在读的这一段在全书结构中的位置")}
        title={open ? T("收起结构透镜") : T("结构透镜")}
        onClick={() => setOpen(!open)}
      >
        <span className="mm2-lens-rail-track" aria-hidden="true">
          {rail.segs.map((s) => (
            <span key={s.id} className={`mm2-lens-rail-seg${s.done ? " is-done" : ""}`} style={{ top: `${s.top * 100}%`, height: `${Math.max(0.6, s.h * 100)}%` }} />
          ))}
          {rail.pos != null && <span className="mm2-lens-rail-bead" style={{ top: `${rail.pos * 100}%` }} />}
        </span>
      </button>

      {open && (
        <aside className="mm2-lens" role="complementary" aria-label={T("结构透镜")}>
          {reading && (
            <div className="mm2-lens-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={T("正在读取原文")}>
              <span style={{ width: `${pct}%` }} />
            </div>
          )}
          <div className="mm2-lens-body">
            {/* 祖先阶梯 */}
            {(focus && !needsGenerate ? view.ancestors.length > 0 : (loc?.scopeTitles?.length ?? 0) > 0) && (
              <nav className="mm2-lens-path" aria-label={T("所在位置")}>
                {focus && !needsGenerate
                  ? view.ancestors.slice(-PATH_MAX).map((a, i) => (
                      <button key={a.id} type="button" className="mm2-lens-path-item" style={{ paddingLeft: `${i * 10}px` }} onClick={() => void jumpTo(a)}>
                        {a.title}
                      </button>
                    ))
                  : (loc?.scopeTitles ?? []).slice(-PATH_MAX).map((t, i) => (
                      <span key={i} className="mm2-lens-path-item" style={{ paddingLeft: `${i * 10}px` }}>
                        {t}
                      </span>
                    ))}
              </nav>
            )}

            {reading && !loc && <p className="mm2-lens-note">{T("正在读取原文 {i}/{n}", { i: feed.done, n: feed.total })}</p>}
            {feed.error && <p className="mm2-lens-note">{T("读取原文出错：{msg}", { msg: feed.error })}</p>}

            {/* 要点之线 */}
            {focus && view.siblings.length > 0 && !needsGenerate && (
              <ol className="mm2-lens-thread" ref={threadRef}>
                {beadY != null && <span className="mm2-lens-bead" aria-hidden="true" style={{ transform: `translateY(${beadY}px)` }} />}
                {view.siblings.map((n) => {
                  const cur = n.id === focus.id;
                  const stub = n.source === "local";
                  return (
                    <li
                      key={n.id}
                      data-current={cur ? "1" : undefined}
                      className={`mm2-lens-item${cur ? " is-current" : ""}${stub ? " is-stub" : ""}${freshIds.has(n.id) ? " is-fresh" : ""}${n.state === "streaming" ? " is-streaming" : ""}`}
                    >
                      <div className="mm2-lens-item-row">
                        <button type="button" className="mm2-lens-item-btn" onClick={() => void jumpTo(n)} aria-current={cur ? "location" : undefined}>
                          <span className="mm2-lens-item-title">{n.title}</span>
                          {cur && typeOf(n) && <span className="mm2-lens-item-type">{typeOf(n)}</span>}
                        </button>
                        {cur && (n.state === "more" || n.state === "stub") && hasKey && (
                          <button type="button" className="mm2-lens-deepen" onClick={() => void deepen(n)} disabled={!!busy} title={T("把这一点再分出一层")}>
                            {T("深挖")}
                          </button>
                        )}
                      </div>
                      {cur && view.kids.length > 0 && (
                        <ul className="mm2-lens-kids">
                          {view.kids.slice(0, KIDS_MAX).map((k) => (
                            <li key={k.id} className={`mm2-lens-kid${freshIds.has(k.id) ? " is-fresh" : ""}`}>
                              <button type="button" onClick={() => void jumpTo(k)}>
                                {k.title}
                              </button>
                            </li>
                          ))}
                          {view.kids.length > KIDS_MAX && <li className="mm2-lens-kid is-more">{T("还有 {n} 项", { n: view.kids.length - KIDS_MAX })}</li>}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}

            {/* 关系 */}
            {focus && view.rels.length > 0 && !needsGenerate && (
              <ul className="mm2-lens-rels" aria-label={T("关系")}>
                {view.rels.map((e) => {
                  const out = e.from === focus.id;
                  const other = out ? e.to : e.from;
                  const n = graph?.nodes[other];
                  return (
                    <li key={`${e.from}|${e.to}|${e.code}`}>
                      <button type="button" onClick={() => n && void jumpTo(n)}>
                        {out ? T("本节点 {rel} → {title}", { rel: relName(e.code), title: titleOf(other) }) : T("{title} {rel} → 本节点", { rel: relName(e.code), title: titleOf(other) })}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* 本节还没有图谱 */}
            {loc?.ready && loc.scopeFloor && !focus && <p className="mm2-lens-note">{T("这一节篇幅很短，不需要单独的图谱。")}</p>}
            {(needsGenerate || scopeStreaming || busy === "pending") && (
              <div className="mm2-lens-empty">
                {scopeStreaming || busy === "pending" ? (
                  <p className="mm2-lens-note mm2-lens-live">{T("正在生成这一节的图谱…")}</p>
                ) : hasKey ? (
                  <>
                    <p className="mm2-lens-empty-text">{T("这一节还没有图谱。")}</p>
                    <button type="button" className="btn btn-primary btn-sm mm2-lens-generate" onClick={() => void generateHere()} disabled={!feed.complete}>
                      {T("生成这一节的图谱")}
                    </button>
                    <p className="mm2-lens-note">{T("只分析这一节，约 1 次调用。")}</p>
                  </>
                ) : (
                  <p className="mm2-lens-note">{T("配置 AI Key 后可以为这一节生成图谱。")}</p>
                )}
              </div>
            )}
            {note && <p className="mm2-lens-note">{note}</p>}
          </div>
          <footer className="mm2-lens-foot">
            <button type="button" className="mm2-lens-link" onClick={() => onOpenInMap(focus ? focus.id : null)}>
              {T("在图谱中打开")}
            </button>
            <button type="button" className="mm2-lens-close" onClick={() => setOpen(false)} aria-label={T("收起结构透镜")}>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            </button>
          </footer>
        </aside>
      )}
    </>
  );
}
