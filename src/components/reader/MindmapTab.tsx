// MindmapTab——材料知识导图（阅读器侧栏「图谱」页签；§4.19 / D84 宿主契约不变）。
// v49.19（D192）起改为 v2「快速渐进 + 结构画布」：MINDMAP-V2-IMPL-PLAN §5.3。
//   1. 挂载先 graphLoad({documentId})：有图立即画（零调用）；无图用 kernel.getTOC() 本地画骨架预览。
//   2. 后台按文档顺序逐单元 getSectionText → graphFeed（「正在读取原文 i/n」，不阻塞画布）。
//   3. 生成：先显示 graphEstimate 预估（发送前预览：段数 / 字数 / 模型 / 预计调用数），点击后 graphGenerate。
//   4. 流式合入：EventBus `mindmap/delta`（installMindmapBridge 桥接）只认当前 mapId，applyDelta 合入；
//      布局节流与 S3 锚点在 MindmapCanvasV2 内完成。
//   5. 四态：more「＋」→ graphExpand(click)；open 可折叠；floor「•」；生成中虚线 + 呼吸点；stub 可深挖。
//   6. 选中 → NodeDetailV2；app.mindmapExplainAuto 为真时自动讲解。
//   7. 就此制卡：buildStructureCardPackageV2（mindmapNodeId = "v2:" + mapId + ":" + nodeId）。
//   8. 跳正文：区间首块所在单元锚 + 区间原文前 20 字 goTo({search})。
//   9. 版本区沿用 v1 通道，加「v2 / 旧版」小标；旧版图只读（仅 more 末端可深挖，产物写 v2 节点表）。
// 画布层：createPortal 进宿主给的 `.reader-map-layer`（图谱页签激活时盖在正文上方，切页签/收侧栏即回正文）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MaterialMapMeta } from "../../lib/mindmap";
import { mindmapApi } from "../../lib/mindmap";
import {
  buildStructureCardPackageV2,
  findRootId,
  liftDelta,
  liftLoad,
  mindmapV2Api,
  tocPreviewNodes,
  type GraphEstimate,
  type GraphNodeText,
  type MindmapDelta,
} from "../../lib/mindmapV2";
import type { GraphState, PatternKey, V2Meta, V2Node } from "../../lib/mindmap/v2/types";
import { ROOT_ID } from "../../lib/mindmap/v2/types";
import { applyDelta, ancestors, createGraph, emptyGraph, setCollapsed, setManualPattern, setView } from "../../lib/mindmap/v2/graph";
import MindmapCanvasV2, { type MindmapCanvasHandle } from "./mindmap/MindmapCanvasV2";
import NodeDetailV2 from "./mindmap/NodeDetailV2";
import { eventBus } from "../../lib/eventbus";
import { settingsStore } from "../../lib/settings";
import { useT } from "../../lib/i18n";
import { ensureFed, flattenToc, resetFeed, subscribeFeed, type TocItem } from "../../lib/mindmapFeed";

export interface MindmapTabProps {
  kernel: import("../../lib/reader/kernel").ReaderKernel;
  documentId: string;
  title: string;
  /** 画布 portal 宿主：Reader 在 .reader-engine-main 里挂的 `.reader-map-layer` 覆盖层元素 */
  canvasHost: HTMLDivElement | null;
  /** 「跳到正文」后的宿主动作：收起侧栏回正文 */
  onJumpToText: () => void;
  /** 就此制卡（section＝有界结构语义包，走 card-structure 分支；未提供时按钮隐藏） */
  onMakeCardsFromNode?: (payload: { nodeId: string; label: string; section: string; focus: string; unitAnchors: string[] }) => void;
  /** 从全局指示器打开时指定要展示的版本 id（只切展示，不改 active） */
  initialMapId?: string | null;
  /** 应用重启后「继续生成」：原文送完后 graphResume(runId)，重排尚未 outline 的作用域 */
  initialResumeRunId?: string | null;
  /** 阅读透镜「在图谱中打开」：要选中并居中的节点（seq 变化即重新聚焦）；flash＝透镜展示过的节点，
   *  到位后短暂框一个高亮区，便于在整图里认出刚才那一片结构 */
  focusRequest?: { nodeId: string; seq: number; flash?: string[] } | null;
  /** focusRequest 用完即通知宿主清掉（页签切走会卸载本组件，留着会在下次进来时重复聚焦 / 重复高亮） */
  onFocusConsumed?: () => void;
}

const V2_GENERATOR = "m15v2-engine-1";
const BUFFER_MAX = 600;
const FINAL_STAGES = new Set(["completed", "partial", "cancelled", "failed"]);

interface RunInfo {
  runId: string;
  kind: "generate" | "expandAll";
  mapId: string | null;
  stage: string;
  done: number;
  total: number;
  label: string;
}


export default function MindmapTab({ kernel, documentId, title, canvasHost, onJumpToText, onMakeCardsFromNode, initialMapId, initialResumeRunId, focusRequest, onFocusConsumed }: MindmapTabProps) {
  const T = useT();
  const [graph, setGraphState] = useState<GraphState>(() => emptyGraph(null));
  const graphRef = useRef(graph);
  const setGraph = useCallback((next: GraphState | ((g: GraphState) => GraphState)) => {
    const v = typeof next === "function" ? (next as (g: GraphState) => GraphState)(graphRef.current) : next;
    graphRef.current = v;
    setGraphState(v);
  }, []);
  const [meta, setMeta] = useState<(V2Meta & { isActive?: boolean; schemaVersion?: number }) | null>(null);
  const mapIdRef = useRef<string | null>(null);
  const rootRef = useRef<{ id: string | null; node: V2Node | null }>({ id: null, node: null });
  const bufferRef = useRef<Map<string, MindmapDelta[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(false); // 无图：目录骨架预览
  const [unsupported, setUnsupported] = useState(false);
  const [feed, setFeed] = useState<{ done: number; total: number; error?: string }>({ done: 0, total: 0 });
  const feedDone = feed.total > 0 && feed.done >= feed.total;
  const [estimate, setEstimate] = useState<GraphEstimate | null>(null);
  const [force, setForce] = useState(false);
  const [runs, setRuns] = useState<Record<string, RunInfo>>({});
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const [notice, setNotice] = useState("");
  const [hasKey, setHasKey] = useState(true);
  const [explainAuto, setExplainAuto] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [relAll, setRelAll] = useState(false);
  const [focus, setFocus] = useState(false);
  const [search, setSearch] = useState("");
  const [versions, setVersions] = useState<MaterialMapMeta[]>([]);
  const [learnStatus, setLearnStatus] = useState<{ cardCount: number; kpExists: boolean } | null>(null);
  const [explainBusy, setExplainBusy] = useState<Record<string, string>>({}); // nodeId → jobId
  const explainWaiters = useRef<Map<string, (ok: boolean) => void>>(new Map()); // jobId → resolve
  const canvasRef = useRef<MindmapCanvasHandle>(null);
  const [flash, setFlash] = useState<{ ids: string[]; seq: number } | null>(null);
  const flashTimer = useRef<number | null>(null);
  const flashNow = useCallback((ids: string[], seq: number) => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    setFlash({ ids: [...ids], seq });
    flashTimer.current = window.setTimeout(() => setFlash(null), 4200);
  }, []);
  useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current); }, []);
  const tocRef = useRef<TocItem[]>([]);
  const feedOffRef = useRef<(() => void) | null>(null);

  const mapId = preview ? null : graph.mapId;
  const isV1 = !!meta && meta.schemaVersion !== 2;
  const genRun = Object.values(runs).find((r) => r.kind === "generate" && !FINAL_STAGES.has(r.stage)) || null;
  const allRun = Object.values(runs).find((r) => r.kind === "expandAll" && !FINAL_STAGES.has(r.stage)) || null;

  const refreshVersions = useCallback(async () => {
    try {
      setVersions((await mindmapApi.list(documentId)) || []);
    } catch {
      /* 版本区读失败不影响画布 */
    }
  }, [documentId]);

  // ---------- 读图 ----------
  const showPreview = useCallback(() => {
    mapIdRef.current = null;
    rootRef.current = { id: null, node: null };
    setMeta(null);
    setPreview(true);
    const g = createGraph({ meta: { title, mapId: undefined }, nodes: tocPreviewNodes(tocRef.current), edges: [], view: null }, undefined);
    setGraph({ ...g, mapId: null });
  }, [setGraph, title]);

  const flushBuffer = useCallback(
    (id: string) => {
      const list = bufferRef.current.get(id);
      if (!list || !list.length) return;
      bufferRef.current.delete(id);
      for (const d of list) applyIncomingRef.current(d);
    },
    [],
  );

  const loadMap = useCallback(
    async (arg: string | { documentId: string }) => {
      const r = await mindmapV2Api.load(arg);
      const lifted = liftLoad(r);
      if (!lifted) {
        showPreview();
        return null;
      }
      const id = String(lifted.load.meta.mapId);
      mapIdRef.current = id;
      rootRef.current = { id: lifted.rootId, node: lifted.rootNode };
      setPreview(false);
      setMeta(r.meta as V2Meta & { isActive?: boolean; schemaVersion?: number });
      // 大图（>200 节点）且用户从未存过视图：默认收起第 2 层以下的 AI 分支（只是初始显示，不写库）
      let g0 = createGraph(lifted.load, id);
      if (!lifted.load.view && lifted.load.nodes.length > 200) g0 = setView(g0, { patterns: {}, collapsed: defaultCollapsed(lifted.load.nodes) });
      setGraph(g0);
      setSelectedId(null);
      flushBuffer(id);
      mindmapV2Api.metrics(id)
        .then((m) => {
          if (m && mapIdRef.current === id) setGraph((g) => (g.mapId === id && !g.metrics ? { ...g, metrics: m } : g));
        })
        .catch(() => {});
      return id;
    },
    [flushBuffer, setGraph, showPreview],
  );

  // ---------- 增量合入 ----------
  const applyIncoming = (d: MindmapDelta) => {
    if (!d || !d.mapId) return;
    if (d.mapId !== mapIdRef.current) {
      if (d.documentId && String(d.documentId) !== String(documentId)) return;
      const list = bufferRef.current.get(d.mapId) || [];
      list.push(d);
      if (list.length > BUFFER_MAX) list.shift();
      bufferRef.current.set(d.mapId, list);
      return;
    }
    if (d.kind === "skeleton" && d.nodes && d.nodes.length) {
      const rid = findRootId(d.nodes);
      if (rid) {
        const rn = d.nodes.find((n) => n.id === rid) || null;
        rootRef.current = { id: rid, node: rn };
      }
    }
    if (d.kind === "explain" && d.jobDone && d.jobId) {
      const jid = d.jobId;
      setExplainBusy((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(next)) if (v === jid) delete next[k];
        return next;
      });
      const w = explainWaiters.current.get(jid);
      if (w) {
        explainWaiters.current.delete(jid);
        w(!!d.jobDone.ok);
      }
    }
    if (d.kind === "run" && d.runDone) {
      if (d.runDone.deleted) {
        setNotice(T("这次生成没有产出可用结构，新版本已撤销；原有导图不受影响。"));
        void loadMap({ documentId });
      }
      void refreshVersions();
    }
    if (d.jobDone && !d.jobDone.ok && !d.jobDone.aborted && d.kind !== "run" && d.jobDone.error) {
      setNotice(T("有一个任务未完成：{msg}", { msg: d.jobDone.error }));
    }
    setGraph((g) => (g.mapId === d.mapId ? applyDelta(g, liftDelta(d, rootRef.current.id) as Parameters<typeof applyDelta>[1]) : g));
  };
  const applyIncomingRef = useRef(applyIncoming);
  applyIncomingRef.current = applyIncoming;

  useEffect(() => eventBus.on("mindmap/delta", (p) => applyIncomingRef.current(p as MindmapDelta)), []);

  // 指示器口径（仅整图生成 / 深挖全部两类 run）
  useEffect(
    () =>
      eventBus.on("mindmap/changed", (raw) => {
        const p = raw as { runId?: string; documentId?: string; stage?: string; done?: number; total?: number; label?: string; mapId?: string | null; code?: string };
        if (!p || !p.runId) return;
        if (p.documentId != null && String(p.documentId) !== String(documentId)) return;
        const known = runsRef.current[p.runId];
        const kind: RunInfo["kind"] = known ? known.kind : /^深挖/.test(p.label || "") ? "expandAll" : "generate";
        const info: RunInfo = {
          runId: p.runId,
          kind,
          mapId: p.mapId ?? known?.mapId ?? null,
          stage: p.stage || "running",
          done: typeof p.done === "number" ? p.done : known?.done ?? 0,
          total: typeof p.total === "number" ? p.total : known?.total ?? 0,
          label: p.label || known?.label || "",
        };
        setRuns((prev) => ({ ...prev, [info.runId]: info }));
        // 续跑 / 指示器打开：run 属于别的版本 → 切过去看它生长
        if (info.mapId && kind === "generate" && !FINAL_STAGES.has(info.stage) && info.mapId !== mapIdRef.current && !known) void loadMap(info.mapId);
        if (FINAL_STAGES.has(info.stage)) {
          void refreshVersions();
          if (info.stage === "failed" && kind === "generate") setNotice(T("生成未完成（{code}）。已生成的部分保留，可再次生成续上（已完成部分走缓存）。", { code: p.code || "failed" }));
          else if (info.stage === "partial") setNotice(T("部分段落未完成，可再次生成或对单个节点深挖补上。"));
          else if (info.stage === "completed" && kind === "generate") setNotice("");
          if (info.mapId && info.mapId === mapIdRef.current) {
            mindmapV2Api.load(info.mapId).then((r) => r.meta && setMeta(r.meta as V2Meta)).catch(() => {});
          }
        }
      }),
    [documentId, loadMap, refreshVersions, T],
  );

  // ---------- 挂载：读图 → 后台送原文 ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const cfg = await window.aiAPI?.getConfig();
        if (alive) setHasKey(Boolean(cfg?.hasKey) || cfg?.preset === "local");
      } catch {
        if (alive) setHasKey(false);
      }
      settingsStore.get<unknown>("app", "mindmapExplainAuto", false).then((v) => alive && setExplainAuto(v === true));
      tocRef.current = flattenToc(kernel.getTOC());
      await refreshVersions();
      if (!alive) return;
      const got = initialMapId ? await loadMap(initialMapId) : null;
      if (!alive) return;
      if (!got) await loadMap({ documentId });
      if (!alive) return;
      setLoading(false);

      // 原文送入走进程内单例（与阅读透镜共用；已送完的文档再开页签不重送）
      const offFeed = subscribeFeed(kernel, documentId, (st) => {
        if (!alive) return;
        if (st.unsupported) setUnsupported(true);
        setFeed({ done: st.done, total: st.total, error: st.error });
      });
      feedOffRef.current = offFeed;
      let st = await ensureFed(kernel, documentId, title);
      if (!alive) return;
      if (st.unsupported || st.error) return;
      try {
        let est = await mindmapV2Api.estimate(documentId);
        if (!est.textReady) {
          // 主进程会话已被 LRU 挤出（同时开过 3 份以上文档）：重送一遍
          resetFeed(kernel, documentId);
          st = await ensureFed(kernel, documentId, title);
          if (!alive || !st.complete) return;
          est = await mindmapV2Api.estimate(documentId);
        }
        if (alive) setEstimate(est);
      } catch {
        /* 预估失败不阻塞 */
      }
      if (initialResumeRunId) {
        try {
          await mindmapV2Api.resume(initialResumeRunId);
          setRuns((prev) => ({
            ...prev,
            [initialResumeRunId]: prev[initialResumeRunId] || { runId: initialResumeRunId, kind: "generate", mapId: null, stage: "running", done: 0, total: 0, label: "" },
          }));
        } catch (err) {
          setNotice(T("继续生成失败：{msg}", { msg: err instanceof Error ? err.message : String(err) }));
        }
      }
    })();
    return () => {
      alive = false;
      feedOffRef.current?.();
      feedOffRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kernel, documentId, initialMapId]);

  // ---------- 操作 ----------
  const realId = (id: string | null): string | null => (id === ROOT_ID ? rootRef.current.id : id);

  const handleGenerate = async () => {
    setNotice("");
    try {
      const r = await mindmapV2Api.generate({ documentId, title, force: force || undefined });
      setRuns((prev) => ({ ...prev, [r.runId]: prev[r.runId] || { runId: r.runId, kind: "generate", mapId: r.mapId, stage: "running", done: 0, total: 0, label: "" } }));
      if (r.mapId !== mapIdRef.current) {
        mapIdRef.current = r.mapId;
        rootRef.current = { id: null, node: null };
        setPreview(false);
        setMeta({ title, mapId: r.mapId, schemaVersion: 2, isActive: false });
        setGraph({ ...emptyGraph(r.mapId), meta: { title, mapId: r.mapId } });
        setSelectedId(null);
        setAnchorId(ROOT_ID);
        flushBuffer(r.mapId);
      }
    } catch (err) {
      setNotice(T("生成调用失败：{msg}", { msg: err instanceof Error ? err.message : String(err) }));
    }
  };

  const SKIP_NOTE: Record<string, string> = {
    floor: "这个节点已触底，没有更深的结构（可在详情里「仍要尝试深挖」）。",
    cached: "这个节点已经展开过了。",
    busy: "这个节点正在深挖中。",
    quota: "今天的悬停预取次数已用完。",
    disabled: "预取未开启。",
    no_text: "原文还在读取，稍后再试。",
  };
  const handleDeepen = async (canvasId: string, forceIt = false) => {
    const id = realId(canvasId);
    if (!id || !mapId) return;
    setAnchorId(canvasId);
    try {
      const r = await mindmapV2Api.expand({ mapId, nodeId: id, trigger: "click", force: forceIt || undefined });
      if (r.skipped) setNotice(T(SKIP_NOTE[r.skipped] || r.skipped));
      else if (r.waiting) setNotice(T("正在等待这一段原文读取完成，读完会自动开始深挖。"));
      else setNotice("");
    } catch (err) {
      setNotice(T("深挖失败：{msg}", { msg: err instanceof Error ? err.message : String(err) }));
    }
  };
  const handlePrefetch = (canvasId: string) => {
    const id = realId(canvasId);
    if (!id || !mapId || preview) return;
    void mindmapV2Api.expand({ mapId, nodeId: id, trigger: "prefetch" }).catch(() => {});
  };
  const handleExpandAll = async () => {
    if (!mapId) return;
    try {
      const r = await mindmapV2Api.expandAll(mapId);
      setRuns((prev) => ({ ...prev, [r.runId]: prev[r.runId] || { runId: r.runId, kind: "expandAll", mapId, stage: "running", done: 0, total: r.queued, label: "" } }));
      if (!r.queued) setNotice(T("图上没有可深挖的节点了。"));
    } catch (err) {
      setNotice(T("深挖全部失败：{msg}", { msg: err instanceof Error ? err.message : String(err) }));
    }
  };
  const handleCancel = async () => {
    for (const r of Object.values(runsRef.current)) if (!FINAL_STAGES.has(r.stage)) await mindmapV2Api.cancel({ runId: r.runId });
    setNotice(T("已请求停止；已完成的部分会保留。"));
  };

  const requestExplain = useCallback(
    async (nodeId: string): Promise<boolean> => {
      const id = mapIdRef.current;
      if (!id) return false;
      try {
        const r = await mindmapV2Api.explain(id, nodeId);
        if (r.cached) return true;
        if (!r.jobId) return false;
        const jid = r.jobId;
        setExplainBusy((prev) => ({ ...prev, [nodeId]: jid }));
        return await new Promise<boolean>((resolve) => {
          explainWaiters.current.set(jid, resolve);
          window.setTimeout(() => {
            if (explainWaiters.current.get(jid) === resolve) {
              explainWaiters.current.delete(jid);
              resolve(false);
            }
          }, 90_000);
        });
      } catch (err) {
        setNotice(T("讲解失败：{msg}", { msg: err instanceof Error ? err.message : String(err) }));
        return false;
      }
    },
    [T],
  );

  const persistView = (g: GraphState) => {
    if (!preview && g.mapId) void mindmapV2Api.setView(g.mapId, g.view).catch(() => {});
  };
  const toggleCollapse = (canvasId: string) => {
    if (canvasId === ROOT_ID) return;
    setAnchorId(canvasId);
    const g = setCollapsed(graphRef.current, canvasId, !graphRef.current.collapsed.has(canvasId));
    setGraph(g);
    persistView(g);
  };
  const setPattern = (gid: string, key: PatternKey | null) => {
    setAnchorId(gid);
    const g = setManualPattern(graphRef.current, gid, key);
    setGraph(g);
    persistView(g);
  };

  /** 定位到节点并**保证可见**（第四轮 B）：画布/宿主（浮窗 portal）可能还没就位 → 有限重试直到 reveal 命中 */
  const revealNode = (id: string, tries = 8) => {
    let left = tries;
    const tick = () => {
      if (canvasRef.current && canvasRef.current.reveal(id)) return;
      if (left-- <= 0) return;
      window.setTimeout(tick, 120);
    };
    tick();
  };

  const focusNode = (id: string) => {
    const g0 = graphRef.current;
    let g = g0;
    for (const a of ancestors(g0, id)) if (g.collapsed.has(a)) g = setCollapsed(g, a, false);
    if (g !== g0) {
      setGraph(g);
      persistView(g);
    }
    setSelectedId(id);
    revealNode(id);
  };

  // 阅读透镜「在图谱中打开」：图载入后选中并居中（材料根映射为合成根卡）
  const focusSeqRef = useRef(-1);
  const nodeCount = Object.keys(graph.nodes).length;
  useEffect(() => {
    if (!focusRequest || focusRequest.seq === focusSeqRef.current || loading || preview) return;
    const id = focusRequest.nodeId === rootRef.current.id ? ROOT_ID : focusRequest.nodeId;
    if (id !== ROOT_ID && !graphRef.current.nodes[id]) return; // 等图载入 / 增量到达
    focusSeqRef.current = focusRequest.seq;
    if (id === ROOT_ID) setSelectedId(ROOT_ID);
    else focusNode(id);
    if (focusRequest.flash?.length) flashNow(focusRequest.flash, focusRequest.seq);
    onFocusConsumed?.(); // 用掉就回执（宿主清掉 focusRequest，免得重新进入页签时再来一遍）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest, loading, preview, nodeCount]);

  // 选中节点（画布 id → 真实节点）
  const selected: { node: V2Node; isRoot: boolean } | null = useMemo(() => {
    if (!selectedId) return null;
    if (selectedId === ROOT_ID) return rootRef.current.node ? { node: rootRef.current.node, isRoot: true } : null;
    const n = graph.nodes[selectedId];
    return n ? { node: n, isRoot: false } : null;
  }, [selectedId, graph]);
  const selectedRealId = selected ? selected.node.id : null;
  const explainText = selected ? graph.explain[selected.node.id] ?? selected.node.explain ?? null : null;

  // 学习状态（只读映射：已有 N 卡 / 知识点已存在）
  useEffect(() => {
    if (!selectedRealId || !mapId) {
      setLearnStatus(null);
      return;
    }
    let alive = true;
    const key = `v2:${mapId}:${selectedRealId}`;
    mindmapApi
      .learningStatus(documentId, [key])
      .then((r: Record<string, { cardCount: number; kpExists: boolean }>) => alive && setLearnStatus(r[key] || { cardCount: 0, kpExists: false }))
      .catch(() => alive && setLearnStatus(null));
    return () => {
      alive = false;
    };
  }, [selectedRealId, mapId, documentId]);

  // 自动讲解
  useEffect(() => {
    if (!explainAuto || !selected || !mapId || preview || explainText || explainBusy[selected.node.id]) return;
    if (selected.node.blockStart == null || selected.node.state === "streaming") return;
    void requestExplain(selected.node.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explainAuto, selectedRealId, mapId]);

  const jumpToText = async (_node: V2Node, text: GraphNodeText | null) => {
    if (text?.unitAnchor) await kernel.goTo({ href: text.unitAnchor });
    const probe = (text?.text || "").replace(/\s+/g, " ").trim().slice(0, 20);
    if (probe.length >= 6) {
      try {
        await kernel.goTo({ search: probe });
      } catch {
        /* best-effort：高亮失败≠导航失败 */
      }
    }
    onJumpToText();
  };

  const makeCards = async (node: V2Node, text: GraphNodeText | null) => {
    if (!onMakeCardsFromNode || !mapId) return;
    // 「作者动作」来自 explain：缺则先讲解（约 1 次调用），失败也照常制卡
    if (!(graphRef.current.explain[node.id] || node.explain) && node.blockStart != null) await requestExplain(node.id);
    const g = graphRef.current;
    const n = g.nodes[node.id] || node;
    const pkg = buildStructureCardPackageV2(n, g, { mapId, nodeText: text?.text ?? null, unitAnchors: text?.unitAnchor ? [text.unitAnchor] : [] });
    onMakeCardsFromNode({ nodeId: pkg.mindmapNodeId, label: n.title, section: pkg.text, focus: T("结构卡：{title}", { title: n.title }), unitAnchors: pkg.unitAnchors });
  };

  const exportSvg = () => {
    const svg = canvasRef.current?.exportSvg();
    if (!svg) return;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${title || T("材料知识导图")}.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // 搜索：标题 + 讲解文本
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [] as V2Node[];
    const out: V2Node[] = [];
    for (const id of Object.keys(graph.nodes).sort()) {
      const n = graph.nodes[id];
      const ex = graph.explain[id] ?? n.explain ?? "";
      if ((n.title || "").toLowerCase().includes(q) || ex.toLowerCase().includes(q)) out.push(n);
      if (out.length >= 12) break;
    }
    return out.sort((a, b) => a.ord - b.ord);
  }, [search, graph]);

  // 键盘可达：方向键在可见层级移动 / Enter 深挖 / Space 折叠 / Esc 取消选中
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const g = graphRef.current;
    const cur = selectedId;
    const parentKey = (id: string) => (id === ROOT_ID ? null : g.nodes[id]?.parentId ?? ROOT_ID);
    if (e.key === "Escape") {
      setSelectedId(null);
      return;
    }
    if (!cur) {
      if (e.key === "Enter" || e.key.startsWith("Arrow")) {
        e.preventDefault();
        setSelectedId(ROOT_ID);
      }
      return;
    }
    const pk = parentKey(cur);
    const sibs = pk == null ? [ROOT_ID] : g.children[pk] ?? [];
    const idx = sibs.indexOf(cur);
    let next: string | null = null;
    if (e.key === "ArrowUp" && idx > 0) next = sibs[idx - 1];
    else if (e.key === "ArrowDown" && idx >= 0 && idx < sibs.length - 1) next = sibs[idx + 1];
    else if (e.key === "ArrowRight") {
      if (g.collapsed.has(cur)) toggleCollapse(cur);
      next = (g.children[cur] ?? [])[0] ?? null;
    } else if (e.key === "ArrowLeft") next = pk;
    else if (e.key === " ") {
      e.preventDefault();
      toggleCollapse(cur);
      return;
    } else if (e.key === "Enter") {
      const n = cur === ROOT_ID ? rootRef.current.node : g.nodes[cur];
      if (n && (n.state === "more" || n.state === "stub")) {
        e.preventDefault();
        void handleDeepen(cur);
      }
      return;
    }
    if (next) {
      e.preventDefault();
      setSelectedId(next);
      canvasRef.current?.center(next);
    }
  };

  // ---------- 状态文案 ----------
  const feedLine = feed.error
    ? T("读取原文出错：{msg}", { msg: feed.error })
    : feed.total && !feedDone
      ? T("正在读取原文 {i}/{n}", { i: feed.done, n: feed.total })
      : "";
  const runLine = (r: RunInfo) => r.label || (r.kind === "generate" ? T("框架生成中…") : T("深挖中…"));
  const moreCount = useMemo(() => Object.values(graph.nodes).filter((n) => n.state === "more" || n.state === "stub").length, [graph]);
  const rootTitle = meta?.title || title;
  const canvasEmpty = !loading && Object.keys(graph.nodes).length === 0;

  // ---------- 画布（portal） ----------
  const canvasView = canvasHost
    ? createPortal(
        <div className="reader-map-stage" role="region" aria-label={T("材料知识导图")} tabIndex={0} onKeyDown={handleKeyDown}>
          <div className="reader-map-top">
            <span className="mindmap-top-title">
              {T("材料知识导图 · {title}", { title })}
              {preview ? ` · ${T("目录预览")}` : isV1 ? ` · ${T("旧版")}` : ""}
            </span>
            <div className="mindmap-top-actions">
              <label className="mm2-toggle">
                <input type="checkbox" checked={relAll} onChange={(e) => setRelAll(e.target.checked)} />
                {T("全部关系")}
              </label>
              <label className="mm2-toggle">
                <input type="checkbox" checked={focus} onChange={(e) => setFocus(e.target.checked)} disabled={!selectedId} />
                {T("关系透视")}
              </label>
              <button className="btn btn-outline btn-sm" onClick={() => canvasRef.current?.fit()}>
                {T("适应窗口")}
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => canvasRef.current?.zoomBy(1.15)} aria-label={T("放大")}>
                +
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => canvasRef.current?.zoomBy(1 / 1.15)} aria-label={T("缩小")}>
                −
              </button>
              <button className="btn btn-outline btn-sm" onClick={exportSvg} disabled={canvasEmpty}>
                {T("导出 SVG")}
              </button>
            </div>
          </div>
          {loading ? (
            <div className="mindmap-canvas">
              <div className="mindmap-skeleton">
                <div className="mindmap-skeleton-row" style={{ width: "30%" }} />
                <div className="mindmap-skeleton-row" style={{ width: "52%" }} />
                <div className="mindmap-skeleton-row" style={{ width: "44%" }} />
                <p className="mindmap-status">{T("正在加载…")}</p>
              </div>
            </div>
          ) : (
            <MindmapCanvasV2
              ref={canvasRef}
              graph={graph}
              rootTitle={rootTitle}
              selectedId={selectedId}
              anchorId={genRun ? selectedId ?? ROOT_ID : anchorId}
              relAll={relAll}
              focus={focus}
              onSelect={(id) => {
                setSelectedId(id);
                if (id) setAnchorId(id);
              }}
              onDeepen={(id) => (preview ? setNotice(T("先生成导图，再深挖单个节点。")) : void handleDeepen(id))}
              onToggleCollapse={toggleCollapse}
              onPrefetch={preview ? undefined : handlePrefetch}
              flashIds={flash?.ids ?? null}
            />
          )}
        </div>,
        canvasHost,
      )
    : null;

  // ---------- 页签面板 ----------
  return (
    <>
      {canvasView}
      <div className="mindmap-tab-panel">
        <aside className="mindmap-sidebar">
          {(feedLine || unsupported) && (
            <section className="mindmap-side-sec">
              <p className="mindmap-status">{unsupported ? T("当前材料没有可提取的文本结构（无目录且无章节），无法生成导图。") : feedLine}</p>
            </section>
          )}

          {hasKey ? (
            <section className="mindmap-side-sec">
              <h3>{T("生成")}</h3>
              {estimate && !genRun && (
                <ul className="mindmap-preview-list">
                  <li>{T("发送前预览：{scopes} 段 · {chars} 字（{floor} 段过短直接显示，不调用）", { scopes: estimate.scopes, chars: estimate.chars.toLocaleString(), floor: estimate.floorScopes })}</li>
                  <li>{T("模型：{model} · 并发 {c}", { model: estimate.model || T("跟随全局"), c: estimate.concurrency })}</li>
                  <li>
                    {T("预计调用 {n} 次（已有缓存的段落不再调用）· 约 {a} 输入 / {b} 输出 token", {
                      n: estimate.scopes,
                      a: estimate.estPromptTokens.toLocaleString(),
                      b: estimate.estCompletionTokens.toLocaleString(),
                    })}
                  </li>
                </ul>
              )}
              {!feedDone && !unsupported && <p className="mindmap-hint">{T("原文读取完成后显示预估；也可以现在就开始，已读到的章节会先生成。")}</p>}
              {genRun ? (
                <>
                  <p className="mindmap-status">{runLine(genRun)}</p>
                  <button className="btn btn-outline btn-sm mindmap-wide" onClick={() => void handleCancel()}>
                    {T("停止")}
                  </button>
                </>
              ) : (
                <>
                  <button className="btn btn-primary btn-sm mindmap-wide" onClick={() => void handleGenerate()} disabled={unsupported || feed.done === 0}>
                    {preview ? T("生成导图") : T("重新生成")}
                  </button>
                  <label className="mindmap-hint check-inline">
                    <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                    {T("忽略缓存重新分析（每段都会实际调用）")}
                  </label>
                </>
              )}
              {!preview && mapId && (
                <>
                  {allRun ? (
                    <>
                      <p className="mindmap-status">{runLine(allRun)}</p>
                      {!genRun && (
                        <button className="btn btn-outline btn-sm mindmap-wide" onClick={() => void handleCancel()}>
                          {T("停止深挖")}
                        </button>
                      )}
                    </>
                  ) : (
                    moreCount > 0 && (
                      <button
                        className="btn btn-outline btn-sm mindmap-wide"
                        onClick={() => void handleExpandAll()}
                        disabled={!!genRun}
                        title={T("把图上所有带＋号的节点逐一深挖（每个约 1 次调用，受设置里的调用预算限制）。按需点节点深挖更省。")}
                      >
                        {T("深挖全部（{n} 个可深挖节点）", { n: moreCount })}
                      </button>
                    )
                  )}
                </>
              )}
              {notice && <p className="mindmap-hint">{notice}</p>}
              {preview && !genRun && <p className="mindmap-hint">{T("画布上是目录预览。生成后，每一段会先长出框架，带＋号的节点可以点开继续深挖。")}</p>}
            </section>
          ) : (
            <section className="mindmap-side-sec">
              <h3>{T("AI 未配置")}</h3>
              <p className="mindmap-hint">{T("配置 AI Key 后可生成新的材料知识导图。已有导图仍可阅读、展开、跳正文与制卡。")}</p>
            </section>
          )}

          {!preview && Object.keys(graph.nodes).length > 0 && (
            <section className="mindmap-side-sec">
              <h3>{T("节点搜索")}</h3>
              <input className="mindmap-search" value={search} placeholder={T("搜索标题 / 讲解")} onChange={(e) => setSearch(e.target.value)} />
              {searchResults.length > 0 && (
                <ul className="mindmap-search-results">
                  {searchResults.map((n) => (
                    <li key={n.id}>
                      <button onClick={() => focusNode(n.id)}>{n.title}</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {!preview && mapId && selected && (
            <NodeDetailV2
              graph={graph}
              mapId={mapId}
              node={selected.node}
              isRoot={selected.isRoot}
              explainText={explainText}
              explainBusy={!!explainBusy[selected.node.id]}
              learnStatus={learnStatus}
              canMakeCards={!!onMakeCardsFromNode}
              onFocusNode={focusNode}
              onDeepen={(id, f) => void handleDeepen(id, f)}
              onExplain={(id) => void requestExplain(id)}
              onSetPattern={setPattern}
              onToggleCollapse={toggleCollapse}
              onJump={(n, t) => void jumpToText(n, t)}
              onMakeCards={(n, t) => void makeCards(n, t)}
            />
          )}

          {/* 历史版本 = 只读操作，任何状态都可见（v48.13 教训：成果「看不见」≠丢了） */}
          <section className="mindmap-side-sec">
            <h3>{T("历史版本")}</h3>
            {versions.length > 0 && preview && (
              <p className="mindmap-hint">{T("当前没有已发布的版本，但历史里有 {n} 个——点下面任意一版即可激活查看（成果没有丢）。", { n: versions.length })}</p>
            )}
            {versions.length === 0 && <p className="mindmap-hint">{T("暂无其他版本。")}</p>}
            <ul className="mindmap-versions">
              {versions.map((v) => (
                <li key={v.id} className={v.id === mapId ? "is-active" : ""}>
                  <button
                    className="mindmap-version-pick"
                    title={`${v.title || T("（未命名）")} · ${new Date(v.createdAt).toLocaleString()}`}
                    onClick={async () => {
                      await mindmapApi.setActive(v.id);
                      await loadMap(v.id);
                      await refreshVersions();
                    }}
                  >
                    <span className="mindmap-version-title">
                      <span className={v.generatorVersion === V2_GENERATOR ? "mm2-badge" : "mm2-badge mm2-badge-old"}>{v.generatorVersion === V2_GENERATOR ? "v2" : T("旧版")}</span>
                      {v.title || T("（未命名）")}
                      {v.isActive ? T("（当前）") : ""}
                    </span>
                    <span className="mindmap-version-time">{new Date(v.createdAt).toLocaleString()}</span>
                  </button>
                  <button
                    className="mindmap-version-del"
                    title={T("删除此版本")}
                    onClick={async () => {
                      if (!window.confirm(T("删除版本「{title}」？该操作不可恢复（生成缓存保留，不影响卡片）。", { title: v.title || T("未命名") }))) return;
                      await mindmapApi.remove(v.id);
                      await refreshVersions();
                      if (v.id === mapIdRef.current) await loadMap({ documentId });
                    }}
                  >
                    {T("删除")}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </>
  );
}

/** 大图初始收起：有 AI 父节点（AI 第 2 层及以下）且自身有子节点的 AI 节点 */
function defaultCollapsed(nodes: readonly V2Node[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const hasKids = new Set(nodes.map((n) => n.parentId).filter((x): x is string => !!x));
  return nodes
    .filter((n) => n.source === "ai" && hasKids.has(n.id) && n.parentId != null && byId.get(n.parentId)?.source === "ai")
    .map((n) => n.id)
    .sort();
}
