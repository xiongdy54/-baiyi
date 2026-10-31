// 结构全景 · 顶部工具栏（D254 v2；docs/design/STRUCTURE-ATLAS-D254.md §7）。
// 面包屑 · 状态 · 搜索 · 生成 · 版本 · 视图 · 缩放 · 居中；图谱态时由 Reader 的 .reader-engine-controls 换入。
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as RKeyboardEvent, type ReactNode } from "react";
import type { GraphState, V2Node } from "../../../lib/mindmap/v2/types";
import { ROOT_ID } from "../../../lib/mindmap/v2/types";
import type { MaterialMapMeta } from "../../../lib/mindmap";
import type { GraphEstimate } from "../../../lib/mindmapV2";
import { isImeComposing } from "../../../lib/ime";
import { useT } from "../../../lib/i18n";
import { CAM, atlasChain, defaultExpanded } from "../../../lib/flow/atlasLayout";
import { IconChevronDown } from "../../icons";

const V2_GENERATOR = "m15v2-engine-1";

export interface AtlasRunInfo {
  runId: string;
  kind: "generate" | "expandAll";
  mapId: string | null;
  stage: string;
  done: number;
  total: number;
  label: string;
}

export interface AtlasToolbarProps {
  graph: GraphState;
  rootTitle: string;
  preview: boolean;
  isV1: boolean;
  focus: string;
  onFocus: (id: string) => void;
  expanded: ReadonlySet<string>;
  onExpandedChange: (next: ReadonlySet<string>) => void;
  relAll: boolean;
  onRelAll: (v: boolean) => void;
  zoom: number;
  onZoom: (k: number) => void;
  onCenter: () => void;
  unsupported: boolean;
  feedLine: string;
  feedDone: boolean;
  genRun: AtlasRunInfo | null;
  allRun: AtlasRunInfo | null;
  notice: string;
  onClearNotice: () => void;
  hasKey: boolean;
  estimate: GraphEstimate | null;
  force: boolean;
  onForce: (v: boolean) => void;
  mapId: string | null;
  moreCount: number;
  onGenerate: () => void;
  onCancel: () => void;
  onExpandAll: () => void;
  versions: MaterialMapMeta[];
  currentMapId: string | null;
  onPickVersion: (id: string) => void;
  onDeleteVersion: (id: string) => void;
  onExportSvg: () => void;
  canExport: boolean;
}

type MenuId = "gen" | "versions" | "view" | "crumbs";

export default function AtlasToolbar(p: AtlasToolbarProps) {
  const T = useT();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [search, setSearch] = useState("");
  const [searchFocus, setSearchFocus] = useState(false);
  const [active, setActive] = useState(0);
  const [crumbMenuAt, setCrumbMenuAt] = useState<{ left: number; top: number } | null>(null);

  const runLine = (r: AtlasRunInfo) => r.label || (r.kind === "generate" ? T("框架生成中…") : T("深挖中…"));
  const status = p.unsupported
    ? T("当前材料没有可提取的文本结构（无目录且无章节），无法生成导图。")
    : p.feedLine
      ? p.feedLine
      : p.genRun
        ? runLine(p.genRun)
        : p.allRun
          ? runLine(p.allRun)
          : p.notice;
  const busy = !!(p.genRun || p.allRun);
  const isNotice = !p.unsupported && !p.feedLine && !p.genRun && !p.allRun && !!p.notice;
  const run = p.genRun ?? p.allRun;
  const progress = run && run.total > 0 ? run.done / run.total : null;

  const chain = useMemo(() => atlasChain(p.graph, p.focus), [p.graph, p.focus]);
  const crumbs = useMemo(() => {
    const list = chain.map((id) => ({ id, title: id === ROOT_ID ? p.rootTitle : p.graph.nodes[id]?.title ?? id }));
    return list;
  }, [chain, p.graph, p.rootTitle]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [] as V2Node[];
    const out: V2Node[] = [];
    for (const id of Object.keys(p.graph.nodes).sort()) {
      const n = p.graph.nodes[id];
      const ex = p.graph.explain[id] ?? n.explain ?? "";
      if ((n.title || "").toLowerCase().includes(q) || ex.toLowerCase().includes(q)) out.push(n);
      if (out.length >= 12) break;
    }
    return out.sort((a, b) => a.ord - b.ord);
  }, [search, p.graph]);
  const showSearch = !!search.trim() && searchFocus && searchResults.length > 0;

  useEffect(() => setActive(0), [search]);

  // 点外部 / Esc 收起菜单
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpenMenu(null);
    };
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);

  // 窄工具带
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const read = () => setNarrow((el.getBoundingClientRect().width || el.clientWidth || 0) < 860);
    read();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(read) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  const pickSearch = (id: string) => {
    p.onFocus(id);
    setSearch("");
    setSearchFocus(false);
    const doc = rootRef.current?.ownerDocument ?? document;
    doc.querySelector<HTMLElement>(".atlas-stage")?.focus({ preventScroll: true });
  };

  const onSearchKey = (e: RKeyboardEvent<HTMLInputElement>) => {
    if (isImeComposing(e)) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      setSearch("");
      setSearchFocus(false);
      return;
    }
    if (!showSearch) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % searchResults.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + searchResults.length) % searchResults.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = searchResults[active] ?? searchResults[0];
      if (pick) pickSearch(pick.id);
    }
  };

  const expandLevel2 = () => {
    const all = defaultExpanded(p.graph, p.focus, 100000);
    const keep = new Set(atlasChain(p.graph, p.focus));
    for (const id of all) if (atlasChain(p.graph, id).length <= 2) keep.add(id);
    p.onExpandedChange(keep);
  };
  const nearFocus = () => p.onExpandedChange(new Set(atlasChain(p.graph, p.focus)));

  const menu = (id: MenuId, label: string, className: string, children: ReactNode, style?: CSSProperties) => (
    <div className="dd" data-atlas-menu={id}>
      <button type="button" className="dd-btn" aria-expanded={openMenu === id} aria-controls={`atlas-menu-${id}`} onClick={() => setOpenMenu((v) => (v === id ? null : id))}>
        {label}
        <IconChevronDown size={12} className="dd-caret" />
      </button>
      {openMenu === id ? (
        <div className={`dd-menu ${className}`} id={`atlas-menu-${id}`} style={style}>
          {children}
        </div>
      ) : null}
    </div>
  );

  // 面包屑：>4 项 → 首项 · … · 末 2 项（… 菜单用 fixed 兄弟层，避开 .atlas-crumbs 的 overflow:hidden）
  const midCrumbs = crumbs.length > 4 ? crumbs.slice(1, crumbs.length - 2) : [];
  const crumbNodes = (() => {
    if (crumbs.length <= 4) return crumbs.map((c) => ({ kind: "crumb" as const, ...c }));
    return [
      { kind: "crumb" as const, ...crumbs[0] },
      { kind: "gap" as const },
      ...crumbs.slice(crumbs.length - 2).map((c) => ({ kind: "crumb" as const, ...c })),
    ];
  })();

  return (
    <div className="atlas-toolbar" role="toolbar" aria-label={T("结构全景")} data-narrow={narrow ? "1" : undefined} ref={rootRef}>
      <div className="atlas-crumbs">
        {crumbNodes.map((c, i) =>
          c.kind === "gap" ? (
            <Fragment key={`gap${i}`}>
              <span className="atlas-crumb-sep">·</span>
              <button
                type="button"
                className="atlas-crumb atlas-crumb-more"
                data-atlas-menu="crumbs"
                aria-expanded={openMenu === "crumbs"}
                aria-controls="atlas-menu-crumbs"
                onClick={(e) => {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setCrumbMenuAt({ left: Math.round(r.left), top: Math.round(r.bottom + 4) });
                  setOpenMenu((v) => (v === "crumbs" ? null : "crumbs"));
                }}
              >
                …
              </button>
              <span className="atlas-crumb-sep">·</span>
            </Fragment>
          ) : (
            <Fragment key={c.id}>
              {i > 0 && crumbNodes[i - 1].kind !== "gap" ? <span className="atlas-crumb-sep">›</span> : null}
              <button
                type="button"
                className="atlas-crumb"
                data-crumb={c.id}
                aria-current={c.id === p.focus ? "page" : undefined}
                disabled={c.id === p.focus}
                onClick={() => p.onFocus(c.id)}
                title={c.title}
              >
                {c.title}
                {c.id === ROOT_ID && p.preview ? <span className="atlas-chip">{T("目录预览")}</span> : null}
                {c.id === ROOT_ID && p.isV1 ? <span className="atlas-chip">{T("旧版")}</span> : null}
              </button>
            </Fragment>
          ),
        )}
      </div>
      {openMenu === "crumbs" && crumbMenuAt ? (
        <div
          className="dd-menu atlas-menu-sec atlas-crumbs-menu"
          id="atlas-menu-crumbs"
          style={{ left: crumbMenuAt.left, top: crumbMenuAt.top }}
        >
          {midCrumbs.map((it) => (
            <button key={it.id} type="button" className="dd-item" onClick={() => { setOpenMenu(null); p.onFocus(it.id); }} title={it.title}>{it.title}</button>
          ))}
        </div>
      ) : null}

      {status ? (
        <div className="atlas-status" data-atlas-status data-busy={busy ? "1" : undefined} title={status}>
          <i className="atlas-status-dot" aria-hidden="true" />
          <span className="atlas-status-text">{status}</span>
          {progress != null ? <span className="atlas-status-bar" aria-hidden="true"><i style={{ width: `${Math.round(progress * 100)}%` }} /></span> : null}
          {isNotice ? <button type="button" className="atlas-status-x" aria-label={T("关闭提示")} onClick={p.onClearNotice}>×</button> : null}
        </div>
      ) : null}

      <div className="atlas-search-wrap">
        <input
          className="atlas-search"
          data-atlas-search
          value={search}
          placeholder={T("搜索标题 / 讲解")}
          aria-activedescendant={showSearch ? `atlas-sr-${active}` : undefined}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => setSearchFocus(true)}
          onBlur={() => window.setTimeout(() => setSearchFocus(false), 120)}
          onKeyDown={onSearchKey}
        />
        {showSearch ? (
          <div className="dd-menu atlas-search-menu">
            {searchResults.map((n, i) => (
              <button key={n.id} id={`atlas-sr-${i}`} type="button" className="dd-item" data-active={i === active ? "1" : undefined} onMouseEnter={() => setActive(i)} onClick={() => pickSearch(n.id)}>
                {n.title}
                <small>{n.parentId ? p.graph.nodes[n.parentId]?.title ?? "" : p.rootTitle}</small>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {p.preview && !p.genRun ? (
        <button type="button" className="btn btn-primary btn-sm" onClick={p.onGenerate} disabled={p.unsupported || !p.feedDone}>
          {T("生成导图")}
        </button>
      ) : null}
      {busy ? (
        <button type="button" className="btn btn-outline btn-sm" onClick={p.onCancel}>
          {p.genRun ? T("停止") : T("停止深挖")}
        </button>
      ) : null}
      {menu(
        "gen",
        T("生成"),
        "atlas-menu-sec",
        !p.hasKey ? (
          <>
            <div className="atlas-menu-note">{T("AI 未配置")}</div>
            <p className="atlas-menu-note">{T("配置 AI Key 后可生成新的材料知识导图。已有导图仍可阅读、展开、跳正文与制卡。")}</p>
          </>
        ) : (
          <>
            {p.estimate && !p.genRun ? (
              <ul className="mindmap-preview-list">
                <li>{T("发送前预览：{scopes} 段 · {chars} 字（{floor} 段过短直接显示，不调用）", { scopes: p.estimate.scopes, chars: p.estimate.chars.toLocaleString(), floor: p.estimate.floorScopes })}</li>
                <li>{T("模型：{model} · 并发 {c}", { model: p.estimate.model || T("跟随全局"), c: p.estimate.concurrency })}</li>
                <li>{T("预计调用 {n} 次（已有缓存的段落不再调用）· 约 {a} 输入 / {b} 输出 token", { n: p.estimate.scopes, a: p.estimate.estPromptTokens.toLocaleString(), b: p.estimate.estCompletionTokens.toLocaleString() })}</li>
              </ul>
            ) : null}
            {!p.feedDone && !p.unsupported ? <p className="atlas-menu-note">{T("原文读取完成后显示预估；也可以现在就开始，已读到的章节会先生成。")}</p> : null}
            {!p.preview && !p.genRun ? (
              <button type="button" className="dd-item" onClick={() => { setOpenMenu(null); p.onGenerate(); }}>{T("重新生成")}</button>
            ) : null}
            <label className="mindmap-hint check-inline">
              <input type="checkbox" checked={p.force} onChange={(e) => p.onForce(e.target.checked)} />
              {T("忽略缓存重新分析（每段都会实际调用）")}
            </label>
            {!p.preview && p.mapId && p.moreCount > 0 && !p.allRun && !p.genRun ? (
              <button type="button" className="dd-item" onClick={() => { setOpenMenu(null); p.onExpandAll(); }} title={T("把图上所有带＋号的节点逐一深挖（每个约 1 次调用，受设置里的调用预算限制）。按需点节点深挖更省。")}>
                {T("深挖全部（{n} 个可深挖节点）", { n: p.moreCount })}
              </button>
            ) : null}
            {p.preview && !p.genRun ? <p className="atlas-menu-note">{T("画布上是目录预览。生成后，每一段会先长出框架，带＋号的节点可以点开继续深挖。")}</p> : null}
          </>
        ),
      )}

      {menu(
        "versions",
        T("版本"),
        "atlas-menu-sec atlas-versions",
        <>
          <div className="atlas-menu-note">{T("历史版本")}</div>
          {p.versions.length > 0 && p.preview ? <p className="atlas-menu-note">{T("当前没有已发布的版本，但历史里有 {n} 个——点下面任意一版即可激活查看（成果没有丢）。", { n: p.versions.length })}</p> : null}
          {p.versions.length === 0 ? <p className="atlas-menu-note">{T("暂无其他版本。")}</p> : null}
          <ul className="mindmap-versions">
            {p.versions.map((v) => {
              const current = v.id === p.currentMapId;
              return (
                <li key={v.id} className={current ? "is-active is-current" : ""} aria-current={current ? "true" : undefined}>
                  <button type="button" className="mindmap-version-pick" title={`${v.title || T("（未命名）")} · ${new Date(v.createdAt).toLocaleString()}`} onClick={() => { setOpenMenu(null); p.onPickVersion(v.id); }}>
                    <span className="mindmap-version-title">
                      <span className={v.generatorVersion === V2_GENERATOR ? "mm2-badge" : "mm2-badge mm2-badge-old"}>{v.generatorVersion === V2_GENERATOR ? "v2" : T("旧版")}</span>
                      {v.title || T("（未命名）")}
                      {v.isActive ? T("（当前）") : ""}
                    </span>
                    <span className="mindmap-version-time">{new Date(v.createdAt).toLocaleString()}</span>
                  </button>
                  <button
                    type="button"
                    className="mindmap-version-del"
                    title={T("删除此版本")}
                    onClick={() => {
                      if (!window.confirm(T("删除版本「{title}」？该操作不可恢复（生成缓存保留，不影响卡片）。", { title: v.title || T("未命名") }))) return;
                      p.onDeleteVersion(v.id);
                    }}
                  >
                    {T("删除")}
                  </button>
                </li>
              );
            })}
          </ul>
        </>,
        { width: 340 },
      )}

      {menu(
        "view",
        T("视图"),
        "atlas-menu-sec",
        <>
          <label className="mindmap-hint check-inline">
            <input type="checkbox" checked={p.relAll} onChange={(e) => p.onRelAll(e.target.checked)} />
            {T("显示全部关系")}
          </label>
          <button type="button" className="dd-item" onClick={() => { setOpenMenu(null); expandLevel2(); }}>{T("全部展开到第 2 层")}</button>
          <button type="button" className="dd-item" onClick={() => { setOpenMenu(null); nearFocus(); }}>{T("只看焦点附近")}</button>
          <div className="dd-sep" aria-hidden="true" />
          <button type="button" className="dd-item" disabled={!p.canExport} onClick={() => { setOpenMenu(null); p.onExportSvg(); }}>{T("导出 SVG")}</button>
        </>,
      )}

      <div className="atlas-zoom">
        <button type="button" aria-label={T("缩小")} onClick={() => p.onZoom(Math.max(CAM.ZOOM_MIN, p.zoom / CAM.ZOOM_STEP))}>−</button>
        <button type="button" title={T("缩放 100% 并居中")} onClick={() => { p.onZoom(1); p.onCenter(); }}>{Math.round(p.zoom * 100)}%</button>
        <button type="button" aria-label={T("放大")} onClick={() => p.onZoom(Math.min(CAM.ZOOM_MAX, p.zoom * CAM.ZOOM_STEP))}>+</button>
      </div>
      <button type="button" className="btn btn-outline btn-sm" data-atlas-center onClick={p.onCenter}>{T("居中")}</button>
    </div>
  );
}
