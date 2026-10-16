// MindmapTab——材料知识导图并入阅读器侧栏「图谱」页签（v48.44 / D84 / §4.19；设计稿
// `docs/design/MINDMAP-SIDEBAR-TAB.md`）。原全屏 Overlay 工作区（MindmapWorkspace）退役：
// 状态机（collect → idle/empty → preview → running → done / review_failed / failed；
// D45/D46/D47/D48/D49 的发布/深化/续跑语义）**原样保留**，呈现拆两半——
//   · 页签面板 `.mindmap-tab-panel`（宿主＝侧栏 data-panel="map"）：生成/预览/状态/节点搜索/节点详情/历史版本；
//   · 画布层：createPortal 进宿主给的 `.reader-map-layer`（.reader-engine-main 内覆盖层）——
//     图谱页签激活时导图直接盖在正文上方显示，切页签/收侧栏即回正文，内核不卸载。
// 「跳到正文」＝内核跳转 + onJumpToText()（宿主收侧栏）；就此制卡走既有 card-structure 链路（AI 面板滑出，导图在场）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import DOMPurify from "dompurify";
import { buildMapSvg } from "../../lib/mindmap/render";
import { layoutMap, type MapNodeLike } from "../../lib/mindmap/layout";
import type { MapStructure, MapNodeRecord, MapPreview, MaterialMapMeta, MapIssue } from "../../lib/mindmap";
import { mindmapApi, buildStructureCardPackage } from "../../lib/mindmap";
import { eventBus } from "../../lib/eventbus";
import { useT } from "../../lib/i18n";

const GRANULARITY_OPTIONS = [
  { value: "overview", label: "概览" },
  { value: "standard", label: "标准" },
  { value: "detailed", label: "详细" }
] as const;

type Phase =
  | "loading"
  | "collecting"
  | "unsupported"
  | "empty"
  | "preview"
  | "running"
  | "section_ready"
  | "done"
  | "failed"
  | "review_failed";

export interface MindmapTabProps {
  kernel: import("../../lib/reader/kernel").ReaderKernel;
  documentId: string;
  title: string;
  /** 画布 portal 宿主：Reader 在 .reader-engine-main 里挂的 `.reader-map-layer` 覆盖层元素 */
  canvasHost: HTMLDivElement | null;
  /** 「跳到正文」后的宿主动作：收起侧栏回正文（不再有全屏工作区的 onBack） */
  onJumpToText: () => void;
  /** 就此制卡（批C：结构制卡——section=结构语义包，走 card-structure 分支；未提供时按钮隐藏） */
  onMakeCardsFromNode?: (payload: { nodeId: string; label: string; section: string; focus: string; unitAnchors: string[] }) => void;
  /**
   * v48.13（P2）：从全局指示器打开时指定要展示的版本 id。
   * 用于「候选版本」——它按发布模型不激活（旧图仍是 published），但用户点了「打开导图」就该看到
   * 刚生成的那一版，而不是被迫先看旧图再手动切换。**只切展示，不改 active**。
   */
  initialMapId?: string | null;
  /**
   * v48.13（P3）：以同一 run 续跑——应用重启后发现该 run 被关闭打断，用户点「继续生成」进入时携带。
   * 收集完原文后自动续跑（同 runId → 已完成分片全部命中缓存，零重复计费）。
   */
  initialResumeRunId?: string | null;
}

function resolveTheme() {
  const cs = getComputedStyle(document.body);
  const v = (name: string, fallback: string) => (cs.getPropertyValue(name) || "").trim() || fallback;
  return {
    paper: v("--paper", "#fafaf8"),
    ink: v("--ink", "#0a0a0a"),
    inkSoft: v("--text-secondary", "#525252"),
    border: v("--border-subtle", "#e0e0e0"),
    accent: v("--accent", "#166a59"),
    accentOn: v("--accent-on", "#ffffff"),
    accentSoft: v("--accent-soft", "#e8eaf5"),
    fontFamily: "var(--font-sans, system-ui, sans-serif)",
    fontSize: 13
  };
}

export default function MindmapTab({ kernel, documentId, title, canvasHost, onJumpToText, onMakeCardsFromNode, initialMapId, initialResumeRunId }: MindmapTabProps) {
  const T = useT();
  const [phase, setPhase] = useState<Phase>("loading");
  const [collect, setCollect] = useState<{ tocItems: { anchor: string; label: string; children?: unknown[] }[]; unitAnchors: string[]; textByUnit: Record<string, string> } | null>(null);
  const [collectMsg, setCollectMsg] = useState("");
  // v48.6（用户拍板）：章节识别尚不精确，生成范围选择暂撤——恒为整份材料；待统一章节识别后再恢复
  const scopeAnchor = "book";
  // v48.5（用户拍板）：覆盖粒度选项移除，系统内部恒用 detailed——详细程度是内部质量标准而非用户选项
  const granularity: "overview" | "standard" | "detailed" = "detailed";
  const [preview, setPreview] = useState<MapPreview | null>(null);
  const [activeMap, setActiveMap] = useState<MaterialMapMeta | null>(null);
  const [versions, setVersions] = useState<MaterialMapMeta[]>([]);
  const [issues, setIssues] = useState<MapIssue[]>([]);
  const [failText, setFailText] = useState("");
  /** v48.13 P4（D46）：深化的进行/结果提示——与整图生成状态分离（深化只影响一支，不推翻整图） */
  const [deepenBusy, setDeepenBusy] = useState(false);
  const [deepenNote, setDeepenNote] = useState("");
  /** v48.13：首层就绪后的说明（不再自动深挖整树，改为按需 + 显式「自动深挖全部」） */
  const [sectionNote, setSectionNote] = useState("");
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; label?: string } | null>(null);
  // v48.11：run 级预算与账本口径（计划/缓存命中/需发送/实际尝试），以及首波深挖计划与部分完成提示
  const [budgetInfo, setBudgetInfo] = useState<{ calls: number; budget: number } | null>(null);
  const [expandPlan, setExpandPlan] = useState<import("../../lib/mindmap").MapExpandPlan | null>(null);
  const [partialNote, setPartialNote] = useState("");
  const [coverageNote, setCoverageNote] = useState("");
  const [forceRebuild, setForceRebuild] = useState(false); // v48.12：强制重算（忽略缓存，供前后对比/benchmark）
  const [mapReady, setMapReady] = useState(false);
  const [runStartedAt, setRunStartedAt] = useState(0);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());
  const [hasKey, setHasKey] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [view, setView] = useState({ zoom: 1, tx: 0, ty: 0 });
  const [search, setSearch] = useState("");
  const [learnStatus, setLearnStatus] = useState<{ cardCount: number; kpExists: boolean } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<Phase>("loading");
  phaseRef.current = phase;

  const structure: MapStructure | null = activeMap?.structure ?? null;
  const nodeById = useMemo(() => new Map((structure?.nodes || []).map((n) => [n.id, n])), [structure]);

  const refreshVersions = useCallback(async () => {
    const list = (await mindmapApi.list(documentId)) || [];
    setVersions(list);
  }, [documentId]);

  const loadMap = useCallback(async (meta: MaterialMapMeta | null) => {
    if (meta?.structure?.nodes?.length) {
      const full = (await mindmapApi.get(meta.id)) || meta;
      setActiveMap(full);
      const rootId = full.structure!.rootNodeId || "root";
      // v48.5（用户拍板）：默认展开三层 = expanded(Level ≤ 2)——L0 材料根 / L1 一级 / L2 二级可见，L3 起折叠
      const byId = new Map(full.structure!.nodes.map((n) => [n.id, n]));
      const expanded = new Set<string>();
      const walkL = (id: string, depth: number) => {
        expanded.add(id);
        if (depth >= 1) return; // 展开集 = L0/L1 → L2 可见、L3 折叠（验收树形：材料→一级→二级可见）
        for (const c of byId.get(id)?.childIds || []) walkL(c, depth + 1);
      };
      walkL(rootId, 0);
      setExpandedIds(expanded);
      setSelectedId(null);
      setPhase("done");
    } else {
      setActiveMap(null);
      setPhase("empty");
    }
  }, []);

  const buildParams = useCallback(() => {
    if (!collect) return null;
    return {
      documentId,
      title,
      tocItems: collect.tocItems,
      unitAnchors: collect.unitAnchors,
      textByUnit: collect.textByUnit,
      scopeAnchor,
      granularity,
      force: forceRebuild || undefined
    };
  }, [collect, documentId, title, scopeAnchor, granularity, forceRebuild]);

  // 挂载：收集 TOC + 逐单元取文（内核实测，无截断）→ 载入 active 图
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cfg = await window.aiAPI?.getConfig();
        if (alive) setHasKey(Boolean(cfg?.hasKey) || cfg?.preset === "local");
      } catch {
        if (alive) setHasKey(false);
      }
      const anchors = kernel.getSectionAnchors?.() || [];
      if (!anchors.length || !kernel.getSectionText) {
        if (alive) setPhase("unsupported");
        return;
      }
      if (alive) setPhase("collecting");
      const textByUnit: Record<string, string> = {};
      for (let i = 0; i < anchors.length; i++) {
        if (!alive) return;
        textByUnit[anchors[i].anchor] = await kernel.getSectionText(anchors[i].anchor);
        if (alive) setCollectMsg(T("正在提取原文 {i}/{n}", { i: i + 1, n: anchors.length }));
      }
      const tocItems = flattenToc(kernel.getTOC());
      if (!alive) return;
      setCollect({ tocItems, unitAnchors: anchors.map((a) => a.anchor), textByUnit });
      await refreshVersions();
      // v48.13（P2）：指定版本优先（候选版本场景）——取不到就退回已发布版本
      const wanted = initialMapId ? await mindmapApi.get(initialMapId) : null;
      if (!alive) return;
      const active = wanted && wanted.structure ? wanted : await mindmapApi.getActive(documentId, "book");
      if (!alive) return;
      await loadMap(active);
      // v48.13 P3：应用重启后「继续生成」——原文已收集完毕，直接以同一 run 续跑
      if (initialResumeRunId) {
        setPhase("running");
        setCancelRequested(false);
        setExpandPlan(null);
        setPartialNote("");
        const next = await runDeepen(initialResumeRunId);
        if (alive && next) await applyResult(next, { resume: true });
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kernel, documentId, loadMap, refreshVersions, initialMapId]);

  // 进度广播（生成中）
  useEffect(() => {
    return eventBus.on("mindmap/changed", (p) => {
      const payload = p as {
        runId?: string;
        stage?: string;
        done?: number;
        total?: number;
        label?: string;
        calls?: number;
        budget?: number;
        transitionChars?: number;
        structuralChars?: number;
        tasks?: number;
        gapChars?: number;
      };
      // v48.12 P1：覆盖审计阶段用「可计算的量」呈现（结构性残余字数 / 补漏处数 / 未处置缺口），禁虚假百分比
      if (payload.stage === "coverage_audit") {
        const t = Number(payload.transitionChars) || 0;
        const st = Number(payload.structuralChars) || 0;
        const tasks = Number(payload.tasks) || 0;
        const gap = Number(payload.gapChars) || 0;
        setCoverageNote(
          tasks > 0
            ? `覆盖审计：过渡文本 ${t} 字已忽略 · 结构性残余 ${st} 字 → 发起 ${tasks} 处补漏`
            : st > 0
              ? `覆盖审计：结构性残余 ${st} 字（已按策略处置）${gap ? ` · 未处置缺口 ${gap} 字` : ""}`
              : `覆盖审计：全部原文已进入结构（过渡文本 ${t} 字除外）`
        );
      }
      // v48.10：运行中实时捕获 runId（此前只在生成完成后回填 → 运行中点「取消」为 no-op）
      if (payload.runId) setLastRunId(payload.runId);
      if (typeof payload.calls === "number" && typeof payload.budget === "number") {
        setBudgetInfo((prev) => ({ calls: Math.max(prev?.calls ?? 0, payload.calls as number), budget: payload.budget as number }));
      }
      if (phaseRef.current !== "running" && phaseRef.current !== "preview" && phaseRef.current !== "section_ready") return;
      // v48.9：广播可能只带 label（waiting_model）——数字缺省时保留既有进度，不回退为 0/0
      setProgress((prev) => ({
        done: typeof payload.done === "number" ? payload.done : prev?.done ?? 0,
        total: typeof payload.total === "number" && payload.total > 0 ? payload.total : prev?.total ?? 0,
        label: payload.label
      }));
    });
  }, []);

  useEffect(() => {
    if (phase !== "running") return;
    const t = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [phase]);

  const handlePreview = async () => {
    const params = buildParams();
    if (!params) return;
    const pv = await mindmapApi.preview(params);
    if (!pv || pv.error) {
      setFailText(pv?.error || T("预览失败"));
      setPhase("failed");
      return;
    }
    setPreview(pv);
    setPhase("preview");
  };

  /** 结果落界面（v48.11：section_ready / partial 都是一等状态，禁止把部分完成伪装成失败） */
  const applyResult = async (result: import("../../lib/mindmap").MindmapGenerateResult | null | undefined, opts?: { resume?: boolean }) => {
    if (!result) return;
    if (result.runId) setLastRunId(result.runId);
    if (result.status === "completed") {
      const active = await mindmapApi.getActive(documentId, "book");
      await refreshVersions();
      await loadMap(active);
      setMapReady(true);
      setPartialNote("");
      setSectionNote("");
      setExpandPlan(null);
      setPhase("done");
    } else if (result.status === "partial") {
      // 部分完成：新版本已落库但未激活（不伪装完整）；把它显示出来并明确说明缺口
      await refreshVersions();
      if (result.mapId) await loadMap(await mindmapApi.get(result.mapId));
      setMapReady(true);
      setPartialNote(T("导图已生成，部分细节未展开（预算触顶 / 个别分支调用失败 / 仍有未处置的结构性缺口）；可重新生成续跑（已完成部分走缓存）。"));
      setPhase("done");
    } else if (result.status === "section_ready") {
      // 首层就绪：立即显示首层结构，随后自动续跑深挖（详细生成是产品承诺；状态全程为「深挖中」而非「完成」）
      const active = await mindmapApi.getActive(documentId, "book");
      await refreshVersions();
      await loadMap(active);
      setMapReady(true);
      setExpandPlan(result.expandPlan || null);
      setPhase("done");
      // v48.13：**不再自动续跑整树深挖**。
      // 真实现场（2026-09-20 20:55–21:03）：首层 73 秒就绪，随后自动深挖 22 次调用又跑了 393 秒，
      // 用户看到图已经出来了，却还要等近 7 分钟，并且不知道为什么。用户拍板的口径是
      // 「初始只需足够深入，最靠下的分支按需求展开」——所以深挖改为**按需**：
      // 画布上带＋号的节点点开深化；想一次跑完的人用下方「自动深挖全部」（显式选择，不是默认）。
      setSectionNote(
        result.expandPlan && result.expandPlan.firstWaveNodes
          ? T("首层结构已就绪，现在就可以看。更深的枝条按需展开：点画布上带＋号的节点，用「深化此节点」。")
          : T("首层结构已就绪，现在就可以看。")
      );
    } else if (result.status === "review_failed") {
      setIssues(result.issues || []);
      setPhase("review_failed");
    } else if (result.status === "cancelled") {
      const active = await mindmapApi.getActive(documentId, "book");
      await loadMap(active); // 旧图继续可读
      setPhase(active ? "done" : "empty");
    } else {
      setFailText(result.error || T("生成失败（{code}）", { code: result.code || "unknown" }));
      setPhase("failed");
    }
  };

  /** 续跑深挖（同 runId → section 全部命中缓存，零重复计费） */
  const runDeepen = async (runId: string) => {
    const params = buildParams();
    if (!params) return null;
    setPhase("running");
    setCancelRequested(false);
    try {
      return await mindmapApi.generate({ ...params, resumeRunId: runId });
    } catch (err) {
      setFailText(T("深挖续跑异常：{msg}", { msg: err instanceof Error ? err.message : String(err) }));
      setPhase("failed");
      return null;
    }
  };

  /**
   * v48.13 P4（D46）**深化**——「展开」与「深化」严格分开：
   *   · 展开/收起：节点已有 children，纯 UI，**零 AI 请求**（下面的按钮只在无子结构时出现）；
   *   · 深化：节点尚无更深结构、且有原文作用域 → 创建后台任务，只对这一支做「深挖 + 增量评审」。
   * 深化不阻塞界面：离开页签/回正文任务照常跑（进度走全局广播与右下角指示器）。
   */
  const deepenNode = async (node: MapNodeRecord) => {
    const params = buildParams();
    if (!params || !activeMap || deepenBusy) return;
    if ((node.childIds || []).length) return; // 已有子结构 = 展开，不是深化
    setDeepenBusy(true);
    setDeepenNote(T("正在深化「{title}」…（可以离开这里，任务会在后台继续）", { title: node.title }));
    try {
      const r = await mindmapApi.deepen({
        ...params,
        mapId: activeMap.id,
        nodeId: node.id,
        deepenLabel: T("深化 · {title}", { title: node.title })
      });
      if (r.status === "review_failed") {
        setDeepenNote(T("「{title}」的语义评审提出 {n} 处问题，该分支未发布（其余分支不受影响）", { title: node.title, n: r.issues?.length ?? 0 }));
      } else if (r.status === "invalid" || r.status === "failed") {
        setDeepenNote(r.error || T("深化未完成"));
      } else if (r.status === "cancelled") {
        setDeepenNote(T("深化已取消（已完成的阶段保留在缓存）"));
      } else {
        setDeepenNote(T("已深化「{title}」", { title: node.title }));
      }
      const fresh = await mindmapApi.get(activeMap.id);
      if (fresh) await loadMap(fresh);
      await refreshVersions();
    } catch (err) {
      setDeepenNote(T("深化异常：{msg}", { msg: err instanceof Error ? err.message : String(err) }));
    } finally {
      setDeepenBusy(false);
    }
  };

  /**
   * v48.13：显式的「自动深挖全部」——把原先**默认发生**的整树深挖改成用户主动选择的一次操作。
   * 走同 runId 续跑（section 全部命中缓存），因此与「按需深化」共用同一条已缓存管线。
   */
  const handleDeepenAll = async () => {
    const params = buildParams();
    if (!params || deepenBusy) return;
    setDeepenBusy(true);
    setSectionNote("");
    setRunStartedAt(Date.now());
    setCancelRequested(false);
    try {
      // 本轮已有 run → 续跑（section 命中缓存，最省）；
      // 打开的是旧图（本轮没有 run）→ 走完整管线（section 同样命中缓存），一样能用。
      const next = lastRunId ? await runDeepen(lastRunId) : await mindmapApi.generate(params);
      if (next) await applyResult(next, { resume: true });
    } catch (err) {
      setFailText(T("深挖全部异常：{msg}", { msg: err instanceof Error ? err.message : String(err) }));
      setPhase("failed");
    } finally {
      setDeepenBusy(false);
    }
  };

  const handleGenerate = async () => {
    const params = buildParams();
    if (!params) return;
    setPhase("running");
    setRunStartedAt(Date.now());
    setCancelRequested(false);
    setProgress({ done: 0, total: (preview?.newCalls || 0) + (preview?.fixedCalls || 0) });
    setExpandPlan(null);
    setPartialNote("");
    setMapReady(false);
    let result;
    try {
      // v48.11（§3.10）：先只跑首层（立即可看），随后自动续跑深挖
      result = await mindmapApi.generate({ ...params, stopAfterSection: true });
    } catch (err) {
      setFailText(T("生成调用异常：{msg}", { msg: err instanceof Error ? err.message : String(err) }));
      setPhase("failed");
      return;
    }
    await applyResult(result);
  };

  const handleCancel = async () => {
    setCancelRequested(true);
    let rid = lastRunId;
    if (!rid) {
      // 兜底：按文档查最近运行中的 run（广播未达/初始窗口的保险）
      try {
        const runs = await mindmapApi.runs(documentId);
        rid = (runs || []).find((r) => ["running", "pending", "estimating", "waiting_user"].includes(r.status))?.id || null;
      } catch {
        /* 查询失败继续下方提示 */
      }
    }
    if (rid) {
      setLastRunId(rid);
      await mindmapApi.cancel(rid);
      setProgress((prev) => ({ done: prev?.done ?? 0, total: prev?.total ?? 0, label: T("已请求取消，等待当前调用中断…") }));
    } else {
      setProgress((prev) => ({ done: prev?.done ?? 0, total: prev?.total ?? 0, label: T("未找到运行中的任务（可能已结束），请稍候") }));
    }
  };

  const handleRepair = async () => {
    if (!lastRunId) return;
    setPhase("running");
    setRunStartedAt(Date.now());
    setProgress({ done: 0, total: 1 });
    let result;
    try {
      result = await mindmapApi.repairConfirm(lastRunId);
    } catch (err) {
      setFailText(T("修复调用异常：{msg}", { msg: err instanceof Error ? err.message : String(err) }));
      setPhase("failed");
      return;
    }
    if (!result) return;
    if (result.status === "completed") {
      const active = await mindmapApi.getActive(documentId, "book");
      await refreshVersions();
      await loadMap(active);
    } else if (result.status === "failed_final") {
      setFailText(T("语义评审修复后仍未通过（一次 repair 上限），可重新生成"));
      setPhase("failed");
    } else {
      setFailText(result.error || T("修复失败"));
      setPhase("failed");
    }
  };

  // ---------- 画布交互 ----------
  const layout = useMemo(() => {
    if (!structure) return null;
    return layoutMap(structure.nodes as unknown as MapNodeLike[], structure.rootNodeId || "root", { expandedIds });
  }, [structure, expandedIds]);

  const svg = useMemo(() => {
    if (!layout) return "";
    return buildMapSvg(layout, resolveTheme(), { selectedId });
  }, [layout, selectedId]);

  const sanitizedSvg = useMemo(() => DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } }), [svg]);

  const fitView = useCallback(() => {
    if (!layout || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scale = Math.min(1, Math.min(rect.width / Math.max(layout.bounds.w, 1), rect.height / Math.max(layout.bounds.h, 1)));
    setView({ zoom: Math.max(0.15, scale), tx: 0, ty: 0 });
  }, [layout]);

  // v48.44（D84）：画布经 portal 挂进宿主覆盖层——宿主元素就位（或画布宽度随侧栏变化）后重新 fit
  useEffect(() => {
    if (phase === "done" && layout) fitView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase === "done", layout?.bounds.w, canvasHost]);

  // 拖拽 vs 点击判定（批3 修复：pointerdown 一律 setPointerCapture 会把 click 的 target 吞到画布层，
  // 导致 data-node-id 永远找不到、节点完全不可点——改为「位移超阈值才算拖拽，拖拽时才捕获」）
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number; dragging: boolean } | null>(null);
  const clickSuppressRef = useRef(false);

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (clickSuppressRef.current) {
      clickSuppressRef.current = false;
      return;
    }
    const el = (e.target as Element).closest?.("[data-node-id]") as Element | null;
    const id = el?.getAttribute("data-node-id") || null;
    if (!id) {
      setSelectedId(null);
      return;
    }
    if (selectedId === id) {
      // 单击已选中的节点 = 展开/收起（画板直觉交互；双击同样有效）
      toggleExpand(id);
    } else {
      setSelectedId(id);
    }
  };
  const handleCanvasDoubleClick = (e: React.MouseEvent) => {
    if (clickSuppressRef.current) return;
    const el = (e.target as Element).closest?.("[data-node-id]") as Element | null;
    if (!el) return;
    toggleExpand(el.getAttribute("data-node-id"));
  };
  const toggleExpand = (id: string | null) => {
    if (!id) return;
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 搜索：命中 → 展开祖先 + focus + 选中
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !structure) return [];
    return structure.nodes
      .filter((n) => (n.title || "").toLowerCase().includes(q) || (n.summary || "").toLowerCase().includes(q) || (n.progression || "").toLowerCase().includes(q))
      .slice(0, 12);
  }, [search, structure]);

  const focusNode = (id: string) => {
    const next = new Set(expandedIds);
    let cur: MapNodeRecord | undefined = nodeById.get(id);
    while (cur?.parentId) {
      next.add(cur.parentId);
      cur = nodeById.get(cur.parentId);
    }
    setExpandedIds(next);
    setSelectedId(id);
    const node = layout?.nodes.find((n) => n.id === id);
    if (node && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      setView({
        zoom: view.zoom,
        tx: rect.width / 2 - (node.x + node.w / 2) * view.zoom,
        ty: rect.height / 2 - (node.y + node.h / 2) * view.zoom
      });
    }
  };

  const selectedNode = selectedId ? nodeById.get(selectedId) : null;

  // 学习状态只读映射（§4.19-10）：已有 N 卡 / 知识点已存在——只显示真实学习数据，永不改图
  useEffect(() => {
    if (!selectedId || phase !== "done") {
      setLearnStatus(null);
      return;
    }
    let alive = true;
    mindmapApi
      .learningStatus(documentId, [selectedId])
      .then((r: Record<string, { cardCount: number; kpExists: boolean }>) => {
        if (alive) setLearnStatus(r[selectedId] || { cardCount: 0, kpExists: false });
      })
      .catch(() => alive && setLearnStatus(null));
    return () => {
      alive = false;
    };
  }, [selectedId, phase, documentId]);

  // 键盘可达（§4.19-9）：Tab 进入画布 → 方向键在可见层级移动 / Enter 选中 / Space 展开折叠
  const visibleSiblingIds = useMemo(() => {
    if (!structure || !selectedId) return [] as string[];
    const self = nodeById.get(selectedId);
    const parentId = self?.parentId ?? null;
    const parent = parentId ? nodeById.get(parentId) : null;
    const rootId = structure.rootNodeId || "root";
    const siblingIds = parent ? parent.childIds : parentId === null ? [rootId] : [];
    const openSet = new Set(expandedIds);
    const isVisible = (id: string): boolean => {
      const n = nodeById.get(id);
      if (!n) return false;
      if (n.parentId === null || n.parentId === rootId) return true;
      return openSet.has(n.parentId) && isVisible(n.parentId);
    };
    return siblingIds.filter(isVisible);
  }, [structure, selectedId, nodeById, expandedIds]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (phase !== "done" || !structure) return;
      const rootId = structure.rootNodeId || "root";
      if (e.key === "Enter" && visibleSiblingIds.length) {
        if (!selectedId && visibleSiblingIds.length) setSelectedId(visibleSiblingIds[0]);
        return;
      }
      if (!selectedId) return;
      if (e.key === " ") {
        e.preventDefault();
        toggleExpand(selectedId);
        return;
      }
      const idx = visibleSiblingIds.indexOf(selectedId);
      const self = nodeById.get(selectedId);
      if (e.key === "ArrowUp" && idx > 0) {
        e.preventDefault();
        setSelectedId(visibleSiblingIds[idx - 1]);
      } else if (e.key === "ArrowDown" && idx >= 0 && idx < visibleSiblingIds.length - 1) {
        e.preventDefault();
        setSelectedId(visibleSiblingIds[idx + 1]);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const firstChild = self?.childIds?.[0];
        if (firstChild) {
          setExpandedIds((prev) => new Set(prev).add(selectedId));
          setSelectedId(firstChild);
        }
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (self?.parentId && self.parentId !== rootId) {
          if (expandedIds.has(selectedId)) toggleExpand(selectedId);
          else setSelectedId(self.parentId);
        }
      }
    },
    [phase, structure, selectedId, visibleSiblingIds, nodeById, expandedIds]
  );

  // 跳正文：goTo(单元锚) + quote 检索 best-effort（高亮失败≠导航失败，§4.19-9）；跳完收侧栏回正文
  const jumpToText = async (node: MapNodeRecord) => {
    const anchor = node.unitAnchors?.[0];
    if (anchor) await kernel.goTo({ href: anchor });
    const quote = node.evidence?.[0]?.quote;
    if (quote) {
      const probe = quote.replace(/\s+/g, " ").slice(0, 20);
      if (probe.length >= 6) {
        try {
          await kernel.goTo({ search: probe });
        } catch {
          /* best-effort */
        }
      }
    }
    onJumpToText();
  };

  const makeCards = (node: MapNodeRecord) => {
    // v48.12 修复「就此制卡发全文」：此前 section = collect.textByUnit 拼接的 ≤2400 字章节原文，
    // 与 card-structure 提示词「你拿不到原文全文，只考作者组织方式」直接矛盾——改发**有界结构语义包**。
    if (!onMakeCardsFromNode || !structure) return;
    const section = buildStructureCardPackage(node, structure, 1200);
    const focus = T("结构卡：{title}", { title: node.title });
    onMakeCardsFromNode({ nodeId: node.id, label: node.title, section, focus, unitAnchors: node.unitAnchors || [] });
  };

  const exportSvg = () => {
    if (!layout) return;
    const svgStr = buildMapSvg(layout, resolveTheme(), { static: true });
    const blob = new Blob([svgStr], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${title || T("材料知识导图")}.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ---------- 页签面板区块 ----------
  /** v48.13：有一轮任务在跑（生成/续跑）——深化与自动深挖都要让路（引擎侧也有 busy 守卫兜底） */
  const runInFlight = phase === "running" || phase === "section_ready";
  /**
   * v48.13：当前图里**还可深化**的节点数（无子结构且有原文作用域）。
   * 「自动深挖全部」按它决定是否出现——此前只看「刚跑完首层留下的 expandPlan」，
   * 于是关掉工作区再进来（或打开一张旧图）时按钮永远不出现（用户实测反馈：找不到这个按钮）。
   */
  const deepenableCount = structure ? structure.nodes.filter((n) => !(n.childIds || []).length && (n.sourceSpans || []).length > 0).length : 0;

  const statusLine = (() => {
    if (phase === "collecting") return collectMsg || T("正在提取原文…");
    if (phase === "loading") return T("正在加载…");
    if (phase === "running" || phase === "section_ready") {
      const elapsed = runStartedAt ? Math.max(0, Math.round((nowTick - runStartedAt) / 1000)) : 0;
      const mm = elapsed >= 60 ? T("{m} 分 {s} 秒", { m: Math.floor(elapsed / 60), s: elapsed % 60 }) : T("{n} 秒", { n: elapsed });
      // v48.11：只报**可计算**的口径（已完成 N 个结构单元 + 预算用量），禁虚假百分比
      const done = progress?.done ?? 0;
      const budgetPart = budgetInfo ? ` · ${T("本次预算 {a}/{b}", { a: budgetInfo.calls, b: budgetInfo.budget })}` : "";
      const labelPart = progress?.label ? ` · ${T("当前：{label}", { label: progress.label })}` : "";
      const head =
        phase === "section_ready"
          ? T("首层结构已就绪（{n} 个结构单元），正在继续详细展开…", { n: done })
          : done > 0
            ? T("已完成 {n} 个结构单元，仍有分支在展开", { n: done })
            : T("正在等待模型响应…");
      return `${head}${labelPart}${budgetPart} · ${T("已等待 {mm}（单次调用超 8 分钟将自动中止；失败会重试，不会静默中断）", { mm })}`;
    }
    return "";
  })();

  // ---------- 画布（portal 进宿主覆盖层；宿主未就位的首帧只落页签面板） ----------
  const canvasView = canvasHost ? (
    createPortal(
      <div className="reader-map-stage" role="region" aria-label={T("材料知识导图")} tabIndex={0} onKeyDown={handleKeyDown}>
        <div className="reader-map-top">
          <span className="mindmap-top-title">{T("材料知识导图 · {title}", { title })}</span>
          <div className="mindmap-top-actions">
            <button className="btn btn-outline btn-sm" onClick={fitView}>
              {T("适应窗口")}
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => setView((v) => ({ ...v, zoom: Math.min(2.5, v.zoom + 0.15) }))}>
              +
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => setView((v) => ({ ...v, zoom: Math.max(0.15, v.zoom - 0.15) }))}>
              −
            </button>
            <button className="btn btn-outline btn-sm" onClick={exportSvg}>
              {T("导出 SVG")}
            </button>
          </div>
        </div>
        <div
          className="mindmap-canvas"
          ref={canvasRef}
          onClick={handleCanvasClick}
          onDoubleClick={handleCanvasDoubleClick}
          onWheel={(e) => {
            e.preventDefault();
            setView((v) => ({ ...v, zoom: Math.min(2.5, Math.max(0.15, v.zoom * (e.deltaY > 0 ? 0.92 : 1.08))) }));
          }}
          onPointerDown={(e) => {
            // 只记录起点；位移超阈值（真正的拖拽）才捕获指针——保住 SVG 节点的 click 目标
            dragRef.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, dragging: false };
          }}
          onPointerMove={(e) => {
            const d = dragRef.current;
            if (!d || !e.buttons) return;
            const dx = e.clientX - d.x;
            const dy = e.clientY - d.y;
            if (!d.dragging && Math.hypot(dx, dy) > 4) {
              d.dragging = true;
              try {
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              } catch {
                /* 已释放则忽略 */
              }
            }
            if (d.dragging) {
              e.preventDefault();
              setView((v) => ({ ...v, tx: d.tx + dx, ty: d.ty + dy }));
            }
          }}
          onPointerUp={(e) => {
            const d = dragRef.current;
            dragRef.current = null;
            if (d?.dragging) {
              // 刚结束拖拽：吞掉紧随其后的合成 click，避免松手误选节点
              clickSuppressRef.current = true;
              window.setTimeout(() => {
                clickSuppressRef.current = false;
              }, 120);
              try {
                (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
              } catch {
                /* ignore */
              }
            }
          }}
        >
          {(phase === "done" || mapReady) && layout ? (
            <>
              <div
                className="mindmap-canvas-inner"
                style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.zoom})` }}
                dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
              />
              {!selectedId && phase === "done" && (
                <div className="mindmap-canvas-tip">{T("单击节点选中 · 再击展开/收起（纯界面）· 带＋号的节点可「深化」（按需生成更深结构）· 选中后在左侧页签制卡或跳正文")}</div>
              )}
            </>
          ) : (phase === "done" || mapReady) ? (
            <div className="mindmap-canvas-hint">{T("此范围暂无可显示的导图。")}</div>
          ) : phase === "empty" ? (
            <div className="mindmap-empty">
              <div className="mindmap-empty-mark" aria-hidden="true" />
              <p className="mindmap-empty-title">{T("尚未生成")}</p>
              <p className="mindmap-empty-desc">{T("导图会根据这份材料本身的组织方式建立结构。")}</p>
            </div>
          ) : phase === "unsupported" ? (
            <div className="mindmap-canvas-hint">{T("当前材料没有可提取的文本结构（无目录且无章节），无法生成导图。")}</div>
          ) : phase === "failed" ? (
            <div className="mindmap-canvas-hint mindmap-fail">{failText || T("生成失败")}</div>
          ) : phase === "loading" || phase === "collecting" ? (
            <div className="mindmap-skeleton" aria-label={statusLine}>
              <div className="mindmap-skeleton-row" style={{ width: "30%" }} />
              <div className="mindmap-skeleton-row" style={{ width: "52%" }} />
              <div className="mindmap-skeleton-row" style={{ width: "44%" }} />
              <div className="mindmap-skeleton-row" style={{ width: "58%" }} />
              <p className="mindmap-status">{statusLine}</p>
            </div>
          ) : (
            <div className="mindmap-canvas-hint" aria-label={statusLine}>
              {statusLine || T("准备中…")}
            </div>
          )}
        </div>
      </div>,
      canvasHost
    )
  ) : null;

  return (
    <>
      {canvasView}
      <div className="mindmap-tab-panel">
        <aside className="mindmap-sidebar">
          {(phase === "loading" || phase === "collecting") && (
            <div className="mindmap-skeleton-side" aria-hidden="true">
              <div className="mindmap-skeleton-row" style={{ width: "70%" }} />
              <div className="mindmap-skeleton-row" style={{ width: "50%" }} />
              <div className="mindmap-skeleton-row" style={{ width: "60%" }} />
            </div>
          )}
          {hasKey ? (
            <>
              {(phase === "empty" || phase === "preview" || phase === "done") && (
                <section className="mindmap-side-sec">
                  <h3>{T("生成范围与覆盖")}</h3>
                  <p className="mindmap-hint">{T("范围：整份材料（{title}）。章节识别能力完善后将恢复范围选择。", { title })}</p>
                  <p className="mindmap-hint">
                    {T("生成先落地**一层可用结构**（首层），更深的枝条按需深化——不为你看不到的细节预先付费；每次深挖都只读该节点对应的原文范围，永不截断。")}
                  </p>
                  <button className="btn btn-primary btn-sm mindmap-wide" onClick={handlePreview} disabled={!collect}>
                    {phase === "done" ? T("重新生成（先预览）") : T("发送前预览")}
                  </button>
                  {/* v48.13：整树深挖从「自动发生」改为「显式选择」——默认只到首层，够用且快 */}
                  {phase === "done" && deepenableCount > 0 && (
                    <button
                      className="btn btn-outline btn-sm mindmap-wide"
                      onClick={() => void handleDeepenAll()}
                      // v48.13：**不要**把「本次会话有没有 run」当成禁用条件——
                      // lastRunId 只在本次会话生成/续跑过才有值，重新打开页签看已有图时它必然是 null，
                      // 于是按钮常驻灰色（用户实测：生成完初步导图后按钮变灰、悬停出禁止符号、点不动）。
                      // handleDeepenAll 已经能在没有 run 时回退到完整管线，所以这里只拦「正在跑」与「正在深挖」。
                      disabled={deepenBusy || runInFlight}
                      title={
                        runInFlight
                          ? T("正在生成/深挖中——等它结束再点（也可以先「停止深挖」）")
                          : T("把图上所有可深化节点一次跑完：每个节点约 1 次调用，另加终编辑与评审各 1 次（章节分析走缓存）。不需要的话就别点——按需点节点深化更省。")
                      }
                    >
                      {deepenBusy ? T("深挖中…") : runInFlight ? T("自动深挖全部（等待当前任务）") : T("自动深挖全部（{n} 个可深化节点）", { n: deepenableCount })}
                    </button>
                  )}
                  {sectionNote && <p className="mindmap-hint">{sectionNote}</p>}
                  {deepenNote && <p className="mindmap-hint">{deepenNote}</p>}
                </section>
              )}
              {phase === "preview" && preview && (
                <section className="mindmap-side-sec mindmap-preview">
                  <h3>{T("发送前预览")}</h3>
                  <ul className="mindmap-preview-list">
                    <li>{T("材料：{title}", { title })}</li>
                    <li>{T("范围：整份材料")}</li>
                    <li>
                      {T("首次生成（首层）：{n} 次结构分析调用——终编辑与评审要等后续完整生成／「自动深挖全部」时才跑（{fixed} 次）", { n: preview.newCalls || 0, fixed: preview.fixedCalls || 2 })}
                    </li>
                    <li>{T("缓存命中：{n}", { n: preview.cacheHits || 0 })}</li>
                    <li>{T("需发送：{n}（首层）", { n: preview.newCalls || 0 })}</li>
                    <li>
                      {T("深挖：首层完成后按需进行（点节点深化，或页签「自动深挖全部」）；单轮总调用上限＝本次预算 {budget}（全局预算，含 section/深挖/补漏/归并/评审）", { budget: preview.budget || 300 })}
                    </li>
                    <li>
                      {T("当前策略：批量深挖 {batch} 个/次 · 递归深度 {depth} · 原子启发式 {atomic} · 单片上限 {chars} 字 · 补漏轮次 {rounds}", {
                        batch: preview.strategy?.expandBatch ?? 1,
                        depth: preview.strategy?.expandDepth ?? 1,
                        atomic: preview.strategy?.atomicHeuristic ? T("开") : T("关"),
                        chars: (preview.strategy?.maxPayloadChars ?? 6000).toLocaleString(),
                        rounds: preview.strategy?.gapFillMaxRounds ?? 2
                      })}
                    </li>
                    <li className="mindmap-hint">{T("首层完成即先落一版可看的图（状态「深挖中」），深挖按预算继续并可随时中断/续跑。")}</li>
                    <li>
                      <label className="mindmap-hint check-inline">
                        <input type="checkbox" checked={forceRebuild} onChange={(e) => setForceRebuild(e.target.checked)} />
                        {T("强制重算（忽略缓存与分片复用；用于前后对比/benchmark，所有调用都实发）")}
                      </label>
                    </li>
                    <li>{T("待发送原文字数：{chars}（精确）", { chars: preview.charsExact?.toLocaleString() ?? "" })}</li>
                    <li>
                      {T("预计 Token：{input} 输入 / {output} 输出（估算）", {
                        input: preview.estInputTokens?.toLocaleString() ?? "",
                        output: preview.estOutputTokens?.toLocaleString() ?? ""
                      })}
                    </li>
                    <li>
                      {T("预计费用：")}
                      {preview.hasPricing
                        ? T("¥ {cost}（基于估算）", { cost: (preview.estCost as number).toFixed(2) })
                        : T("单价未配置，仅显示 Token（可在设置中填写模型单价）")}
                    </li>
                  </ul>
                  <button className="btn btn-primary btn-sm mindmap-wide" onClick={handleGenerate}>
                    {T("确认生成")}
                  </button>
                  <button className="btn btn-outline btn-sm mindmap-wide" onClick={() => setPhase(structure ? "done" : "empty")}>
                    {T("取消")}
                  </button>
                </section>
              )}
              {(phase === "running" || phase === "section_ready") && (
                <section className="mindmap-side-sec">
                  <h3>{phase === "section_ready" ? T("首层已就绪") : T("生成中")}</h3>
                  <p className="mindmap-status">{statusLine}</p>
                  {coverageNote && <p className="mindmap-hint">{coverageNote}</p>}
                  {expandPlan && (
                    <>
                      <p className="mindmap-hint">
                        {T("首波深挖：{n} 个结构单元 · 计划调用 {calls} 次 · 作用域合计 {chars} 字（上限 {max} 字/次）", {
                          n: expandPlan.firstWaveNodes,
                          calls: expandPlan.plannedCalls,
                          chars: expandPlan.spanChars.toLocaleString(),
                          max: expandPlan.maxPayloadChars || 6000
                        })}
                      </p>
                      <p className="mindmap-hint">
                        {T("第 2 层以后按模型判定动态追加；预算 {budget} 触顶会停为「部分完成」。当前已完成 {done} 个结构单元。", {
                          budget: budgetInfo?.budget ?? preview?.budget ?? 300,
                          done: progress?.done ?? 0
                        })}
                      </p>
                    </>
                  )}
                  <button className="btn btn-outline btn-sm mindmap-wide" onClick={handleCancel} disabled={cancelRequested}>
                    {cancelRequested ? T("取消中…") : T("停止深挖")}
                  </button>
                </section>
              )}
              {phase === "review_failed" && (
                <section className="mindmap-side-sec mindmap-fail-sec">
                  <h3>{T("语义评审未通过")}</h3>
                  <ul className="mindmap-issue-list">
                    {issues.map((it, i) => (
                      <li key={i}>
                        <span className="mindmap-issue-sev">{it.severity}</span> {it.note || it.type}
                        <span className="mindmap-issue-scope">{T("（{scope}）", { scope: it.repairScope })}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mindmap-hint">{T("确认后将仅重跑对应归并阶段并复审一次（费用按预估另行计算）。旧有效导图不受影响。")}</p>
                  <button className="btn btn-primary btn-sm mindmap-wide" onClick={handleRepair}>
                    {T("确认修复")}
                  </button>
                  <button className="btn btn-outline btn-sm mindmap-wide" onClick={() => setPhase(structure ? "done" : "empty")}>
                    {T("暂不处理")}
                  </button>
                </section>
              )}
              {phase === "done" && structure && (
                <>
                  {partialNote && (
                    <section className="mindmap-side-sec">
                      <h3>{T("部分完成")}</h3>
                      <p className="mindmap-hint">{partialNote}</p>
                    </section>
                  )}
                  <section className="mindmap-side-sec">
                    <h3>{T("节点搜索")}</h3>
                    <input
                      className="mindmap-search"
                      value={search}
                      placeholder={T("搜索标题 / 摘要")}
                      onChange={(e) => setSearch(e.target.value)}
                    />
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
                  {selectedNode && (
                    <section className="mindmap-side-sec mindmap-node-detail">
                      <h3>{T("节点详情")}</h3>
                      <p className="mindmap-node-title">{selectedNode.title}</p>
                      {selectedNode.authorialRole && (
                        <p className="mindmap-meta">
                          {T("作者组织作用：{role}", {
                            role: ROLE_LABEL[selectedNode.authorialRole] ? T(ROLE_LABEL[selectedNode.authorialRole]) : selectedNode.authorialRole
                          })}
                        </p>
                      )}
                      {selectedNode.progression && <p className="mindmap-meta">{T("作者如何展开：{text}", { text: selectedNode.progression })}</p>}
                      {selectedNode.groupingBasis?.explanation && <p className="mindmap-meta">{T("归并依据：{text}", { text: selectedNode.groupingBasis.explanation })}</p>}
                      {(selectedNode.evidence || []).slice(0, 3).map((ev, i) => (
                        <blockquote key={i} className="mindmap-quote">
                          {T("“{quote}”", { quote: ev.quote })}
                          {ev.positionAmbiguous ? <span className="mindmap-meta">{T("（位置多处命中）")}</span> : null}
                        </blockquote>
                      ))}
                      {learnStatus && (
                        <p className="mindmap-meta">
                          {T("已有 {n} 张卡", { n: learnStatus.cardCount })}
                          {learnStatus.kpExists ? ` · ${T("知识点已存在")}` : ""}
                        </p>
                      )}
                      <div className="mindmap-node-actions">
                        <button className="btn btn-outline btn-sm" onClick={() => void jumpToText(selectedNode)} disabled={!selectedNode.unitAnchors?.length && !(selectedNode.evidence || []).length}>
                          {T("跳到正文")}
                        </button>
                        {onMakeCardsFromNode && (
                          <button className="btn btn-primary btn-sm" onClick={() => makeCards(selectedNode)}>
                            {T("就此制卡")}
                          </button>
                        )}
                        {selectedNode.childIds?.length > 0 && (
                          <button className="btn btn-outline btn-sm" onClick={() => toggleExpand(selectedNode.id)}>
                            {expandedIds.has(selectedNode.id) ? T("收起子树") : T("展开子树")}
                          </button>
                        )}
                        {/* v48.13 P4：无子结构但有作用域 → 可深化。与「展开」是两件事：
                            展开＝已有子结构只是折叠（纯 UI，零请求）；深化＝尚无更深结构，需要生成。 */}
                        {!(selectedNode.childIds || []).length && (selectedNode.sourceSpans || []).length > 0 && (
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => void deepenNode(selectedNode)}
                            disabled={deepenBusy || runInFlight}
                            title={T("这个节点还没有更细的结构。深化会只针对它对应的原文继续分析（不影响其他分支），可以在后台运行。")}
                          >
                            {deepenBusy ? T("深化中…") : T("深化此节点")}
                          </button>
                        )}
                      </div>
                      {/* 「没画出来」≠「没有更深的内容」——把两者的区别写在用户看得见的地方 */}
                      {!(selectedNode.childIds || []).length && (selectedNode.sourceSpans || []).length > 0 && (
                        <p className="mindmap-meta">{T("此节点尚无更细结构（图上画＋号标记）——按需深化即可，不必等整图跑完。")}</p>
                      )}
                      {!(selectedNode.childIds || []).length && !(selectedNode.sourceSpans || []).length && (
                        <p className="mindmap-meta">{T("此节点已是终态（原子结构/纯过渡文字），没有可继续深化的原文范围。")}</p>
                      )}
                      {deepenNote && <p className="mindmap-meta">{deepenNote}</p>}
                    </section>
                  )}
                </>
              )}
              {phase === "empty" && <p className="mindmap-hint">{T("生成 = 用户主动触发 + 发送前预览；无截断，全文实测发送。")}</p>}
            </>
          ) : (
            <section className="mindmap-side-sec">
              <h3>{T("AI 未配置")}</h3>
              <p className="mindmap-hint">{T("配置 AI Key 后可生成新的材料知识导图。已有导图仍可阅读、展开、跳正文与制卡。")}</p>
            </section>
          )}
          {/* v48.13：历史版本 = **只读**操作，必须任何状态都可见。
              此前它被关在 `hasKey ? … : …` 与 `phase === "done" && structure` 两重条件里，
              于是「无 Key」或「没有已发布版本」时用户看不到任何版本入口——
              真实现场：一次失败的收尾把已发布版本置为未激活，用户重开页签只看到「尚未生成」，
              以为 73 节点的成果丢了，而版本其实就在库里、点一下就能激活。 */}
          <section className="mindmap-side-sec">
            <h3>{T("历史版本")}</h3>
            {/* v48.13：空态但有版本时必须说清楚——否则「尚未生成」会让用户以为成果丢了。
            现场：一次失败的收尾把已发布版本置为未激活，用户重开页签看到的就是「尚未生成」。 */}
            {versions.length > 0 && !mapReady && !structure && (
              <p className="mindmap-hint">
                {T("当前没有已发布的版本，但历史里有 {n} 个——点下面任意一版即可激活查看（成果没有丢）。", { n: versions.length })}
              </p>
            )}
            {versions.length === 0 && <p className="mindmap-hint">{T("暂无其他版本。")}</p>}
            <ul className="mindmap-versions">
              {versions.map((v) => (
            <li key={v.id} className={v.id === activeMap?.id ? "is-active" : ""}>
              <button
                className="mindmap-version-pick"
                title={`${v.title || T("（未命名）")} · ${new Date(v.createdAt).toLocaleString()}`}
                onClick={async () => {
                  const meta = await mindmapApi.setActive(v.id);
                  if (meta) await loadMap({ ...meta, structure: (await mindmapApi.get(v.id))?.structure ?? null });
                }}
              >
                <span className="mindmap-version-title">
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
                  if (v.id === activeMap?.id) {
                    const active = await mindmapApi.getActive(documentId, "book");
                    await refreshVersions();
                    await loadMap(active);
                  } else {
                    await refreshVersions();
                  }
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

const ROLE_LABEL: Record<string, string> = {
  introduce: "定义/引入",
  distinguish: "区分概念",
  decompose: "拆解问题",
  sequence: "建立顺序",
  cause_effect: "解释因果",
  problem_solution: "问题与解决",
  claim_evidence: "观点与证据",
  question_answer: "提问与回答",
  general_specific: "从一般到具体",
  contrast: "对比",
  example: "举例",
  application: "应用",
  critique: "限制与批评",
  synthesis: "综合",
  extension: "扩展",
  parallel: "并列展开",
  summary: "总结"
};

interface TocItem {
  anchor: string;
  label: string;
  children?: TocItem[];
}
function flattenToc(items: { label: string; href: string; subitems?: { label: string; href: string; subitems?: unknown[] }[] }[]): TocItem[] {
  const walk = (list: { label: string; href: string; subitems?: unknown[] }[]): TocItem[] =>
    (list || [])
      .filter((t) => t.href)
      .map((t) => ({
        anchor: t.href,
        label: String(t.label || "").replace(/\s*·第 \d+ 页$/, ""),
        children: t.subitems ? walk(t.subitems as { label: string; href: string; subitems?: unknown[] }[]) : undefined
      }));
  return walk(items || []);
}
