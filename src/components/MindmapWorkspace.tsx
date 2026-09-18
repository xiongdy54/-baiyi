// MindmapWorkspace——材料知识导图全屏工作区（v48 批3/4/5，M15，D41/D42 / §4.19）。
// 交互形态（v47.2 拍板保留）：占满窗口的全屏 Overlay（挂 Reader 外层、内核不销毁、正文返回原位）
// + 右侧边栏收纳全部操作；画布保持空旷（单 accent / 直角 / 无阴影渐变 / 1px hairline）。
// 状态机（§4.19-11）：collect → idle/empty → preview → running → done / review_failed / failed；
// 评审 FAIL 停在确认（用户确认后 repair 一次）；失败永不触碰旧图；无 Key 只读降级（不弹窗）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { buildMapSvg } from "../lib/mindmap/render";
import { layoutMap, type MapNodeLike } from "../lib/mindmap/layout";
import type { MapStructure, MapNodeRecord, MapPreview, MaterialMapMeta, MapIssue } from "../lib/mindmap";
import { mindmapApi } from "../lib/mindmap";
import { eventBus } from "../lib/eventbus";

const GRANULARITY_OPTIONS = [
  { value: "overview", label: "概览" },
  { value: "standard", label: "标准" },
  { value: "detailed", label: "详细" }
] as const;

type Phase = "loading" | "collecting" | "unsupported" | "empty" | "preview" | "running" | "done" | "failed" | "review_failed";

interface MindmapWorkspaceProps {
  kernel: import("../lib/reader/kernel").ReaderKernel;
  documentId: string;
  title: string;
  onBack: () => void;
  /** 就此制卡（批5 接 Reader 既有管线；未提供时按钮隐藏） */
  onMakeCardsFromNode?: (payload: { nodeId: string; label: string; section: string; focus: string; unitAnchors: string[] }) => void;
}

function resolveTheme() {
  const cs = getComputedStyle(document.body);
  const v = (name: string, fallback: string) => (cs.getPropertyValue(name) || "").trim() || fallback;
  return {
    paper: v("--paper", "#fafaf8"),
    ink: v("--ink", "#0a0a0a"),
    inkSoft: v("--text-secondary", "#525252"),
    border: v("--border-subtle", "#e0e0e0"),
    accent: v("--accent", "#002fa7"),
    accentOn: v("--accent-on", "#ffffff"),
    accentSoft: v("--accent-soft", "#e8eaf5"),
    fontFamily: "var(--font-sans, system-ui, sans-serif)",
    fontSize: 13
  };
}

export function MindmapWorkspace({ kernel, documentId, title, onBack, onMakeCardsFromNode }: MindmapWorkspaceProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [collect, setCollect] = useState<{ tocItems: { anchor: string; label: string; children?: unknown[] }[]; unitAnchors: string[]; textByUnit: Record<string, string> } | null>(null);
  const [collectMsg, setCollectMsg] = useState("");
  const [scopeAnchor, setScopeAnchor] = useState("book");
  const [granularity, setGranularity] = useState<"overview" | "standard" | "detailed">("standard");
  const [preview, setPreview] = useState<MapPreview | null>(null);
  const [activeMap, setActiveMap] = useState<MaterialMapMeta | null>(null);
  const [versions, setVersions] = useState<MaterialMapMeta[]>([]);
  const [issues, setIssues] = useState<MapIssue[]>([]);
  const [failText, setFailText] = useState("");
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; label?: string } | null>(null);
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
      const root = full.structure!.nodes.find((n) => n.id === rootId);
      setExpandedIds(new Set([rootId, ...(root?.childIds || [])]));
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
      granularity
    };
  }, [collect, documentId, title, scopeAnchor, granularity]);

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
        if (alive) setCollectMsg(`正在提取原文 ${i + 1}/${anchors.length}`);
      }
      const tocItems = flattenToc(kernel.getTOC());
      if (!alive) return;
      setCollect({ tocItems, unitAnchors: anchors.map((a) => a.anchor), textByUnit });
      const active = await mindmapApi.getActive(documentId, "book");
      if (!alive) return;
      await refreshVersions();
      await loadMap(active);
    })();
    return () => {
      alive = false;
    };
  }, [kernel, documentId, loadMap, refreshVersions]);

  // 进度广播（生成中）
  useEffect(() => {
    return eventBus.on("mindmap/changed", (p) => {
      const payload = p as { stage?: string; done?: number; total?: number; label?: string };
      if (phaseRef.current !== "running" && phaseRef.current !== "preview") return;
      setProgress({ done: payload.done || 0, total: payload.total || 0, label: payload.label });
    });
  }, []);

  const handlePreview = async () => {
    const params = buildParams();
    if (!params) return;
    const pv = await mindmapApi.preview(params);
    if (!pv || pv.error) {
      setFailText(pv?.error || "预览失败");
      setPhase("failed");
      return;
    }
    setPreview(pv);
    setPhase("preview");
  };

  const handleGenerate = async () => {
    const params = buildParams();
    if (!params) return;
    setPhase("running");
    setProgress({ done: 0, total: (preview?.newCalls || 0) + (preview?.fixedCalls || 0) });
    const result = await mindmapApi.generate(params);
    if (!result) return;
    if (result.runId) setLastRunId(result.runId);
    if (result.status === "completed") {
      const active = await mindmapApi.getActive(documentId, "book");
      await refreshVersions();
      await loadMap(active);
    } else if (result.status === "review_failed") {
      setIssues(result.issues || []);
      setPhase("review_failed");
    } else if (result.status === "cancelled") {
      const active = await mindmapApi.getActive(documentId, "book");
      await loadMap(active); // 旧图继续可读
    } else {
      setFailText(result.error || `生成失败（${result.code || "unknown"}）`);
      setPhase("failed");
    }
  };

  const handleCancel = async () => {
    if (lastRunId) await mindmapApi.cancel(lastRunId);
  };

  const handleRepair = async () => {
    if (!lastRunId) return;
    setPhase("running");
    setProgress({ done: 0, total: 1 });
    const result = await mindmapApi.repairConfirm(lastRunId);
    if (!result) return;
    if (result.status === "completed") {
      const active = await mindmapApi.getActive(documentId, "book");
      await refreshVersions();
      await loadMap(active);
    } else if (result.status === "failed_final") {
      setFailText(`语义评审修复后仍未通过（一次 repair 上限），可重新生成`);
      setPhase("failed");
    } else {
      setFailText(result.error || "修复失败");
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

  useEffect(() => {
    if (phase === "done" && layout) fitView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase === "done", layout?.bounds.w]);

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

  // 跳正文：goTo(单元锚) + quote 检索 best-effort（高亮失败≠导航失败，§4.19-9）
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
    onBack();
  };

  const makeCards = (node: MapNodeRecord) => {
    if (!onMakeCardsFromNode || !collect || !structure) return;
    const section = (node.unitAnchors || [])
      .map((a) => collect.textByUnit[a] || "")
      .filter(Boolean)
      .join("\n")
      .slice(0, 2400);
    const focus = structure.summaryText || structure.title;
    onMakeCardsFromNode({ nodeId: node.id, label: node.title, section, focus, unitAnchors: node.unitAnchors || [] });
  };

  const exportSvg = () => {
    if (!layout) return;
    const svgStr = buildMapSvg(layout, resolveTheme(), { static: true });
    const blob = new Blob([svgStr], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${title || "材料知识导图"}.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ---------- 侧栏区块 ----------
  const scopeOptions = useMemo(() => {
    const items = [{ value: "book", label: `整份材料（${title}）` }];
    const walk = (nodes: { anchor: string; label: string; children?: { anchor: string; label: string; children?: unknown }[] }[], depth: number) => {
      for (const t of nodes || []) {
        items.push({ value: t.anchor, label: `${"　".repeat(depth)}${t.label}` });
        if (t.children) walk(t.children as { anchor: string; label: string; children?: { anchor: string; label: string; children?: unknown }[] }[], depth + 1);
      }
    };
    walk((collect?.tocItems || []) as { anchor: string; label: string; children?: { anchor: string; label: string; children?: unknown }[] }[], 1);
    return items;
  }, [collect, title]);

  const statusLine = (() => {
    if (phase === "collecting") return collectMsg || "正在提取原文…";
    if (phase === "loading") return "正在加载…";
    if (phase === "running")
      return progress?.total
        ? `正在生成 ${progress.done}/${progress.total}${progress.label ? ` · ${progress.label}` : ""}（等待模型首字约 40 秒属正常）`
        : "正在等待模型响应…";
    return "";
  })();

  return (
    <div className="mindmap-workspace" role="dialog" aria-label="材料知识导图" tabIndex={0} onKeyDown={handleKeyDown}>
      <div className="mindmap-top">
        <button className="btn btn-outline btn-sm" onClick={onBack}>
          正文
        </button>
        <span className="mindmap-top-title">材料知识导图 · {title}</span>
        <div className="mindmap-top-actions">
          <button className="btn btn-outline btn-sm" onClick={fitView} disabled={phase !== "done"}>
            适应窗口
          </button>
          <button className="btn btn-outline btn-sm" onClick={() => setView((v) => ({ ...v, zoom: Math.min(2.5, v.zoom + 0.15) }))}>
            +
          </button>
          <button className="btn btn-outline btn-sm" onClick={() => setView((v) => ({ ...v, zoom: Math.max(0.15, v.zoom - 0.15) }))}>
            −
          </button>
          <button className="btn btn-outline btn-sm" onClick={exportSvg} disabled={phase !== "done"}>
            导出 SVG
          </button>
        </div>
      </div>
      <div className="mindmap-body">
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
          {phase === "done" && layout ? (
            <div
              className="mindmap-canvas-inner"
              style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.zoom})` }}
              dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
            />
          ) : phase === "done" ? (
            <div className="mindmap-canvas-hint">此范围暂无可显示的导图。</div>
          ) : phase === "empty" ? (
            <div className="mindmap-empty">
              <div className="mindmap-empty-mark" aria-hidden="true" />
              <p className="mindmap-empty-title">尚未生成</p>
              <p className="mindmap-empty-desc">导图会根据这份材料本身的组织方式建立结构。</p>
            </div>
          ) : phase === "unsupported" ? (
            <div className="mindmap-canvas-hint">当前材料没有可提取的文本结构（无目录且无章节），无法生成导图。</div>
          ) : phase === "failed" ? (
            <div className="mindmap-canvas-hint mindmap-fail">{failText || "生成失败"}</div>
          ) : (
            <div className="mindmap-skeleton" aria-label={statusLine}>
              <div className="mindmap-skeleton-row" style={{ width: "30%" }} />
              <div className="mindmap-skeleton-row" style={{ width: "52%" }} />
              <div className="mindmap-skeleton-row" style={{ width: "44%" }} />
              <div className="mindmap-skeleton-row" style={{ width: "58%" }} />
              <p className="mindmap-status">{statusLine}</p>
            </div>
          )}
        </div>
        <aside className="mindmap-sidebar">
          {phase !== "done" && phase !== "empty" && phase !== "failed" && phase !== "review_failed" && (
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
                  <h3>生成范围与覆盖</h3>
                  <label className="mindmap-field">
                    <span>范围</span>
                    <select value={scopeAnchor} onChange={(e) => setScopeAnchor(e.target.value)}>
                      {scopeOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="mindmap-field">
                    <span>覆盖粒度</span>
                    <div className="mindmap-chips">
                      {GRANULARITY_OPTIONS.map((g) => (
                        <button key={g.value} className={`mindmap-chip${granularity === g.value ? " is-active" : ""}`} onClick={() => setGranularity(g.value)}>
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="mindmap-hint">粒度控制语义分析的详细程度，永不截断所选范围内的原文。</p>
                  <button className="btn btn-primary btn-sm mindmap-wide" onClick={handlePreview} disabled={!collect}>
                    {phase === "done" ? "重新生成（先预览）" : "发送前预览"}
                  </button>
                </section>
              )}
              {phase === "preview" && preview && (
                <section className="mindmap-side-sec mindmap-preview">
                  <h3>发送前预览</h3>
                  <ul className="mindmap-preview-list">
                    <li>材料：{title}</li>
                    <li>范围：{scopeOptions.find((o) => o.value === scopeAnchor)?.label || scopeAnchor}</li>
                    <li>覆盖：{GRANULARITY_OPTIONS.find((g) => g.value === granularity)?.label}</li>
                    <li>
                      缓存命中：{preview.cacheHits || 0} / {preview.callsTotal || 0}（另含终编辑与评审 {preview.fixedCalls || 2} 次，随缓存变动）
                    </li>
                    <li>预计新调用：{preview.newCalls || 0} + {preview.fixedCalls || 2}</li>
                    <li>待发送原文字数：{preview.charsExact?.toLocaleString()}（精确）</li>
                    <li>
                      预计 Token：{preview.estInputTokens?.toLocaleString()} 输入 / {preview.estOutputTokens?.toLocaleString()} 输出（估算）
                    </li>
                    <li>
                      预计费用：
                      {preview.hasPricing
                        ? `¥ ${(preview.estCost as number).toFixed(2)}（基于估算）`
                        : "单价未配置，仅显示 Token（可在设置中填写模型单价）"}
                    </li>
                  </ul>
                  <button className="btn btn-primary btn-sm mindmap-wide" onClick={handleGenerate}>
                    确认生成
                  </button>
                  <button className="btn btn-outline btn-sm mindmap-wide" onClick={() => setPhase(structure ? "done" : "empty")}>
                    取消
                  </button>
                </section>
              )}
              {phase === "running" && (
                <section className="mindmap-side-sec">
                  <h3>生成中</h3>
                  <p className="mindmap-status">{statusLine}</p>
                  <button className="btn btn-outline btn-sm mindmap-wide" onClick={handleCancel}>
                    取消生成
                  </button>
                </section>
              )}
              {phase === "review_failed" && (
                <section className="mindmap-side-sec mindmap-fail-sec">
                  <h3>语义评审未通过</h3>
                  <ul className="mindmap-issue-list">
                    {issues.map((it, i) => (
                      <li key={i}>
                        <span className="mindmap-issue-sev">{it.severity}</span> {it.note || it.type}
                        <span className="mindmap-issue-scope">（{it.repairScope}）</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mindmap-hint">确认后将仅重跑对应归并阶段并复审一次（费用按预估另行计算）。旧有效导图不受影响。</p>
                  <button className="btn btn-primary btn-sm mindmap-wide" onClick={handleRepair}>
                    确认修复
                  </button>
                  <button className="btn btn-outline btn-sm mindmap-wide" onClick={() => setPhase(structure ? "done" : "empty")}>
                    暂不处理
                  </button>
                </section>
              )}
              {phase === "done" && structure && (
                <>
                  <section className="mindmap-side-sec">
                    <h3>节点搜索</h3>
                    <input
                      className="mindmap-search"
                      value={search}
                      placeholder="搜索标题 / 摘要"
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
                      <h3>节点详情</h3>
                      <p className="mindmap-node-title">{selectedNode.title}</p>
                      {selectedNode.authorialRole && <p className="mindmap-meta">作者组织作用：{ROLE_LABEL[selectedNode.authorialRole] || selectedNode.authorialRole}</p>}
                      {selectedNode.progression && <p className="mindmap-meta">作者如何展开：{selectedNode.progression}</p>}
                      {selectedNode.groupingBasis?.explanation && <p className="mindmap-meta">归并依据：{selectedNode.groupingBasis.explanation}</p>}
                      {(selectedNode.evidence || []).slice(0, 3).map((ev, i) => (
                        <blockquote key={i} className="mindmap-quote">
                          “{ev.quote}”
                          {ev.positionAmbiguous ? <span className="mindmap-meta">（位置多处命中）</span> : null}
                        </blockquote>
                      ))}
                      {learnStatus && (
                        <p className="mindmap-meta">
                          {learnStatus.cardCount > 0 ? `已有 ${learnStatus.cardCount} 张卡` : "已有 0 张卡"}
                          {learnStatus.kpExists ? " · 知识点已存在" : ""}
                        </p>
                      )}
                      <div className="mindmap-node-actions">
                        <button className="btn btn-outline btn-sm" onClick={() => void jumpToText(selectedNode)} disabled={!selectedNode.unitAnchors?.length && !(selectedNode.evidence || []).length}>
                          跳到正文
                        </button>
                        {onMakeCardsFromNode && (
                          <button className="btn btn-primary btn-sm" onClick={() => makeCards(selectedNode)}>
                            就此制卡
                          </button>
                        )}
                        {selectedNode.childIds?.length > 0 && (
                          <button className="btn btn-outline btn-sm" onClick={() => toggleExpand(selectedNode.id)}>
                            {expandedIds.has(selectedNode.id) ? "收起子树" : "展开子树"}
                          </button>
                        )}
                      </div>
                    </section>
                  )}
                  <section className="mindmap-side-sec">
                    <h3>历史版本</h3>
                    {versions.length === 0 && <p className="mindmap-hint">暂无其他版本。</p>}
                    <ul className="mindmap-versions">
                      {versions.map((v) => (
                        <li key={v.id} className={v.id === activeMap?.id ? "is-active" : ""}>
                          <button
                            onClick={async () => {
                              const meta = await mindmapApi.setActive(v.id);
                              if (meta) await loadMap({ ...meta, structure: (await mindmapApi.get(v.id))?.structure ?? null });
                            }}
                          >
                            {v.title || "（未命名）"} · {v.granularity} · {new Date(v.createdAt).toLocaleString()}
                            {v.isActive ? "（当前）" : ""}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                </>
              )}
              {phase === "empty" && <p className="mindmap-hint">生成 = 用户主动触发 + 发送前预览；无截断，全文实测发送。</p>}
            </>
          ) : (
            <section className="mindmap-side-sec">
              <h3>AI 未配置</h3>
              <p className="mindmap-hint">配置 AI Key 后可生成新的材料知识导图。已有导图仍可阅读、展开、跳正文与制卡。</p>
            </section>
          )}
        </aside>
      </div>
    </div>
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
