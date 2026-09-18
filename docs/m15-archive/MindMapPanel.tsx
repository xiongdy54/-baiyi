// 材料知识导图面板（v47，M15，D40 / §4.19）——阅读器「导图」按钮入口。
// 四阶段管线编排（渲染层，同洞察/制卡惯例：主进程不拼提示词）：
//   ① 本地结构解析 = 内核 TOC 树（mindmapCore.buildTocTree，零调用）
//   ② 章节级抽取 = material-difficulty ×N（分片缓存 documentId+锚+提示词版本；重复生成只补缺失）
//   ③ 整书聚合 = diagram-generation kind=aggregate 一次调用 → 结构 JSON
//   ④ 图先于图示 = 本地校验（validateMindmapStructure）→ kind=render 出自包含 SVG → DOMPurify 消毒 → 入库
// 范围（整书/章）+ 覆盖粒度（预估调用量先行，§4.19-2）；节点「就此制卡」走既有管线（§4.19-6）。
import { useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { aiGateway } from "../lib/ai";
import Dropdown from "./Dropdown";
import type { ReaderKernel, ReaderTocItem } from "../lib/reader/kernel";
import { mindmapApi, type MindmapRecord } from "../lib/mindmap";
import {
  buildTocTree,
  selectChapters,
  estimatePlan,
  selectDiagramTypes,
  validateMindmapStructure,
  deriveStructureSummary,
  type MindmapTocNode,
  type MindmapChapter,
  type MindmapGranularity,
  type MindmapStructure
} from "../lib/mindmapCore";
import { detectMaterialType } from "../lib/cards";

interface Props {
  kernel: ReaderKernel | null;
  engine: "foliate" | "pdf" | null;
  itemId: string;
  documentId: string;
  title: string;
  onClose: () => void;
  /** 节点「就此制卡」（§4.19-6）：交回 Reader 走既有制卡管线（确认面板 + CardLint + KP 归一） */
  onMakeCardsFromNode: (payload: { label: string; evidence: string | null; section: string; focus: string }) => void;
}

type Step = "scope" | "preview" | "running" | "done";
const GRANULARITIES: { value: MindmapGranularity; label: string }[] = [
  { value: "standard", label: "标准（仅一级章节）" },
  { value: "fine", label: "较细（含二级）" },
  { value: "deep", label: "深入（全层级）" }
];
// v47.1（质量优先，用户拍板）：**取消单章字数上限**——章节原文全文发送，不截断；
// 预览步先本地实测全文章节字数（零 AI 调用），按实测给出精确 Token 预估。

// 括号平衡容错解析（同 insight/kpExtract 思路）：取首个顶层平衡 JSON 对象
function parseJsonLoose(raw: string): unknown {
  const t = String(raw || "").replace(/```(?:json)?/gi, "");
  const start = t.indexOf("{");
  if (start < 0) throw new Error("输出中没有 JSON 对象");
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(t.slice(start, i + 1));
    }
  }
  throw new Error("JSON 括号不平衡");
}

function anchorOf(item: ReaderTocItem, engine: string): string {
  return String(item.href || (engine === "pdf" ? `pdfpage:0` : ""));
}
function pageIndexOf(anchor: string): number | null {
  const m = /^pdfpage:(\d+)$/.exec(anchor);
  return m ? Number(m[1]) : null;
}

export default function MindMapPanel({ kernel, engine, itemId, documentId, title, onClose, onMakeCardsFromNode }: Props) {
  const [step, setStep] = useState<Step>("scope");
  const [tree, setTree] = useState<MindmapTocNode | null>(null);
  const [scope, setScope] = useState<{ kind: "book" | "chapter"; anchor?: string; label: string }>({ kind: "book", label: "整书" });
  const [granularity, setGranularity] = useState<MindmapGranularity>("standard");
  const [noKey, setNoKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<MindmapRecord | null>(null); // 当前查看的导图（done/回看共用）
  const [history, setHistory] = useState<MindmapRecord[]>([]);
  const [learning, setLearning] = useState<Record<string, { cardCount: number; kpExists: boolean }>>({});
  const [showArtifact, setShowArtifact] = useState(true);

  useEffect(() => {
    aiGateway
      .getConfig()
      .then((c) => setNoKey(!c?.hasKey))
      .catch(() => setNoKey(true));
  }, []);

  // ① 本地结构解析：内核 TOC 树 + 已保存导图列表（零调用）
  useEffect(() => {
    const toc = kernel?.getTOC() || [];
    const mapped = toc.map((t) => ({ anchor: anchorOf(t, engine || "foliate"), label: t.label, children: t.subitems || [] }));
    setTree(buildTocTree(mapped, title));
    if (documentId) mindmapApi.list(documentId).then(setHistory).catch(() => setHistory([]));
  }, [kernel, engine, title, documentId]);

  const chapters: MindmapChapter[] = useMemo(() => (tree ? selectChapters(tree, scope, granularity) : []), [tree, scope, granularity]);
  // v47.1：实测章节文本（预览步本地提取，零 AI 调用）；范围/粒度变化即失效重测
  const [texts, setTexts] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    setTexts(null);
  }, [scope.anchor, scope.kind, granularity]);
  const textChapters = useMemo(
    () => (texts ? chapters.filter((c) => (texts[c.anchor] || "").length > 0) : chapters),
    [chapters, texts]
  );
  const measuredChars = useMemo(() => (texts ? textChapters.reduce((a, c) => a + (texts[c.anchor] || "").length, 0) : 0), [texts, textChapters]);
  const plan = useMemo(() => estimatePlan(textChapters, granularity, measuredChars), [textChapters, granularity, measuredChars]);

  // 引擎取章文本（[start, end) 区间；pdf 用页码锚，foliate 用 href 锚）
  async function sectionText(anchor: string, nextAnchor: string | null): Promise<string> {
    if (!kernel?.getSectionText) return "";
    if (engine === "pdf") {
      const from = pageIndexOf(anchor);
      const to = nextAnchor ? pageIndexOf(nextAnchor) : null;
      if (from == null) return "";
      return await kernel.getSectionText({ pageIndex: from }, to != null ? { pageIndex: to } : undefined);
    }
    return await kernel.getSectionText({ href: anchor }, nextAnchor ? { href: nextAnchor } : undefined);
  }

  async function refreshHistory() {
    if (documentId) setHistory(await mindmapApi.list(documentId).catch(() => []));
  }

  // 预览步：本地实测全文章节文本（零 AI 调用）——估算与实际发送内容一致（v47.1 质量优先）
  async function goPreview() {
    if (!tree || !kernel?.getSectionText) {
      setError("该阅读器引擎不支持章节文本抽取，暂无法生成导图。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const flat = [...chapters];
      const out: Record<string, string> = {};
      for (let i = 0; i < flat.length; i++) {
        setProgress(`读取章节 ${i + 1}/${flat.length}：${flat[i].label}（本地，零 AI 调用）`);
        out[flat[i].anchor] = await sectionText(flat[i].anchor, flat[i + 1]?.anchor ?? null);
      }
      setTexts(out);
      if (!flat.some((c) => (out[c.anchor] || "").length > 0)) {
        setError("所选范围内没有可读取的章节文本。");
        return;
      }
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  // 生成流（发送前预览已在 preview 步；M8-B 纪律：用户确认后才发；文本已在预览步实测，v47.1 全文发送）
  async function runGenerate() {
    if (!texts || !kernel?.getSectionText) {
      setError("章节文本尚未实测，请返回重新预览。");
      return;
    }
    setBusy(true);
    setError(null);
    setStep("running");
    try {
      const tpl = await window.promptsAPI?.get("diagram-generation");
      if (!tpl?.content) throw new Error("diagram-generation 模板缺失（请重启应用完成播种）");
      const diffTpl = await window.promptsAPI?.get("material-difficulty");
      if (!diffTpl?.content) throw new Error("material-difficulty 模板缺失");
      // ② 章节级抽取（分片缓存：documentId + 锚 + 提示词版本；缓存只省 AI 调用，章节原文恒在本地已实测）
      const chapterTexts: Record<string, string> = { ...texts };
      const shardContents: unknown[] = [];
      const flat = [...textChapters];
      for (let i = 0; i < flat.length; i++) {
        const ch = flat[i];
        setProgress(`章节抽取 ${i + 1}/${flat.length}：${ch.label}`);
        const hit = await mindmapApi.shardGet({ documentId, anchor: ch.anchor, promptScope: "material-difficulty", promptVersion: Number(diffTpl.version ?? 1) }).catch(() => null);
        if (hit?.content) {
          shardContents.push(hit.content);
          continue;
        }
        const text = texts[ch.anchor] || "";
        if (!text) throw new Error(`章节「${ch.label}」无可抽取文本`);
        const raw = await aiGateway.chat(
          [
            { role: "system", content: diffTpl.content },
            // v47.1（质量优先）：章节原文**全文发送**，无字数截断
            { role: "user", content: `【材料标题】${title}\n【章节】${ch.label}\n【文本】\n${text}` }
          ],
          undefined,
          0.3
        );
        const parsed = parseJsonLoose(raw) as { overallGrade?: unknown; kpCandidates?: unknown };
        const content = {
          chapterAnchor: ch.anchor,
          chapterLabel: ch.label,
          overallGrade: parsed.overallGrade ?? null,
          // v47.1（质量优先）：候选**取全量**，不再截 12 条（材料覆盖多少就带给聚合多少）
          kpCandidates: Array.isArray(parsed.kpCandidates) ? parsed.kpCandidates : []
        };
        await mindmapApi.shardSave({ documentId, anchor: ch.anchor, promptScope: "material-difficulty", promptVersion: Number(diffTpl.version ?? 1), content });
        shardContents.push(content);
      }
      // ③ 整书聚合（一次调用）
      setProgress("整书聚合…");
      const scopeLabel = scope.kind === "book" ? title : scope.label;
      const aggRaw = await aiGateway.chat(
        [
          { role: "system", content: tpl.content },
          { role: "user", content: `【运行类型】aggregate\n【材料标题】${title}\n【范围】${scopeLabel}\n【章节产物】\n${JSON.stringify(shardContents)}` }
        ],
        undefined,
        0.3
      );
      const aggParsed = parseJsonLoose(aggRaw) as Parameters<typeof validateMindmapStructure>[0];
      // ④ 图先于图示：本地校验（编造节点拒绝 / 孤儿标出 / evidence span 抽查）
      const validated = validateMindmapStructure(aggParsed, chapterTexts);
      if (!validated.ok || !validated.structure) throw new Error("聚合结果校验失败：无可保留节点");
      const structure: MindmapStructure = validated.structure;
      // 图示渲染（选型白名单由确定性本地函数给出，AI 只在白名单内执行）
      setProgress("图示渲染…");
      const firstText = Object.values(chapterTexts).join("\n").slice(0, 2000);
      const domains = [
        ...new Set(
          shardContents.flatMap((s) => {
            const c = s as { kpCandidates?: { domain?: string[] }[] };
            return (c.kpCandidates || []).flatMap((k) => (Array.isArray(k.domain) ? k.domain : []));
          })
        )
      ].map(String);
      const route = detectMaterialType(firstText || "概念论述");
      const chars = Object.values(chapterTexts).join("\n").length;
      const selection = selectDiagramTypes({ materialType: route.materialType, domains, chars, granularity });
      const accent = (getComputedStyle(document.documentElement).getPropertyValue("--accent") || "#002fa7").trim() || "#002fa7";
      const renderRaw = await aiGateway.chat(
        [
          { role: "system", content: tpl.content },
          {
            role: "user",
            content: `【运行类型】render\n【结构 JSON】\n${JSON.stringify(structure)}\n【图表类型白名单】${selection.whitelist.join("、")}；数量上限：${selection.maxCount}\n【材料元信息】标题：${scopeLabel}；强调色：${accent}；题材：${route.label}`
          }
        ],
        undefined,
        0.3
      );
      const renderParsed = parseJsonLoose(renderRaw) as { diagrams?: { type?: string; title?: string; svg?: string }[] };
      const diagrams = (Array.isArray(renderParsed.diagrams) ? renderParsed.diagrams : []).slice(0, selection.maxCount);
      const sanitized = diagrams
        .filter((d) => typeof d.svg === "string" && d.svg.includes("<svg"))
        .map((d) => ({ type: String(d.type || "mindmap"), title: String(d.title || scopeLabel), svg: DOMPurify.sanitize(d.svg as string, { USE_PROFILES: { svg: true, svgFilters: true } }) }));
      const record = await mindmapApi.save({
        documentId,
        itemId,
        scopeAnchor: scope.kind === "book" ? "book" : scope.anchor || "book",
        scopeKind: scope.kind,
        granularity,
        structure,
        diagramArtifact: sanitized.map((d) => d.svg).join("\n") || null,
        artifactKind: "svg",
        diagramTypes: sanitized.map((d) => d.type),
        warnings: [...validated.warnings, ...validated.dropped.map((x) => `已丢弃节点：${x.reason}`)],
        promptScope: "diagram-generation",
        promptVersion: Number(tpl.version ?? 1)
      });
      if (record) {
        setSaved(record);
        const labels = structure.nodes.map((n) => n.label);
        setLearning(await mindmapApi.learningStatus(documentId, labels).catch(() => ({})));
      }
      await refreshHistory();
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("preview");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  async function openSaved(id: string) {
    const rec = await mindmapApi.get(id).catch(() => null);
    if (!rec) return;
    setSaved(rec);
    setShowArtifact(true);
    setStep("done");
    if (rec.structure) {
      const labels = rec.structure.nodes.map((n) => n.label);
      setLearning(await mindmapApi.learningStatus(rec.documentId, labels).catch(() => ({})));
    }
  }

  const renderTree = (nodes: MindmapTocNode[], depth: number) =>
    nodes.map((n) => (
      <div key={n.anchor || n.label} style={{ paddingLeft: depth * 14 }}>
        <button
          className={`btn btn-sm ${scope.anchor === n.anchor && scope.kind === "chapter" ? "btn-primary" : "btn-outline"}`}
          style={{ margin: "2px 0" }}
          title={scope.kind === "chapter" && scope.anchor === n.anchor ? "当前范围" : "以该章为范围生成"}
          onClick={() => setScope({ kind: "chapter", anchor: n.anchor, label: n.label })}
        >
          {n.label}
        </button>
        {n.children.length > 0 && depth < 2 ? renderTree(n.children, depth + 1) : null}
      </div>
    ));

  const flatLabels: Record<string, string> = useMemo(() => {
    const map: Record<string, string> = {};
    const walk = (n: MindmapTocNode) => {
      if (n.anchor) map[n.anchor] = n.label;
      n.children.forEach(walk);
    };
    if (tree) walk(tree);
    return map;
  }, [tree]);

  const structureTree = (s: MindmapStructure) => {
    const byParent = new Map<string | null, typeof s.nodes>();
    for (const n of s.nodes) {
      const key = n.parentId && s.nodes.some((x) => x.id === n.parentId) ? n.parentId : null;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(n);
    }
    const emit = (parentId: string | null, depth: number): React.ReactNode[] =>
      (byParent.get(parentId) || []).map((n) => {
        const st = learning[n.label];
        return (
          <div key={n.id} style={{ paddingLeft: depth * 16 }}>
            <div className="ai-draft-front" style={{ padding: "4px 0" }}>
              <span className="ai-draft-type mono">{depth === 0 ? "主干" : "节点"}</span>
              {st && (st.cardCount > 0 || st.kpExists) && (
                <span className="ai-draft-supplement mono">
                  {st.kpExists ? "KP 已存在" : ""}
                  {st.cardCount > 0 ? ` · 已有 ${st.cardCount} 卡` : ""}
                </span>
              )}
              {n.flags && n.flags.length > 0 && <span className="lint lint-warn">{n.flags.join("；")}</span>}
              <div className="ai-draft-text">{n.label}</div>
              {n.evidence && <div className="ai-draft-notes mono" title={n.evidence}>依据：{n.evidence.slice(0, 60)}…</div>}
              <div className="ai-actions">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() =>
                    onMakeCardsFromNode({
                      label: n.label,
                      evidence: n.evidence,
                      section: (n.chapterAnchors || []).map((a) => flatLabels[a]).filter(Boolean).join("、"),
                      focus: deriveStructureSummary(s, flatLabels, 1200)
                    })
                  }
                >
                  就此制卡
                </button>
              </div>
            </div>
            {emit(n.id, depth + 1)}
          </div>
        );
      });
    return emit(null, 0);
  };

  return (
    <div className="mindmap-workspace">
      <div className="mindmap-top">
        <button className="btn btn-outline btn-sm" onClick={onClose} title="返回材料正文">正文</button>
        <span className="mindmap-top-title">{title} · 材料知识导图</span>
        <span className="mono mindmap-top-meta">
          {step === "running"
            ? progress || "生成中…"
            : saved
              ? `当前查看：${saved.scopeKind === "book" ? "整书" : "章节"} · ${saved.granularity}`
              : "未生成"}
        </span>
      </div>
      <div className="mindmap-body">
        <div className="mindmap-canvas">
          {saved && showArtifact && saved.diagramArtifact ? (
            saved.diagramArtifact.split("\n").map((svg, i) => (
              <div key={i} className="mindmap-artifact-item" dangerouslySetInnerHTML={{ __html: svg }} />
            ))
          ) : saved ? (
            <p className="form-hint">该导图没有图示（结构层独立可用），层级树见右侧。</p>
          ) : step === "running" ? (
            <p className="mindmap-canvas-hint mono">{progress || "准备中…"}（GLM 推理模型首字前可能有约 40 秒静默）</p>
          ) : (
            <p className="mindmap-canvas-hint">
              导图＝材料作者视角的知识组织（独立产物，随时回看）。在右侧选择范围与粒度开始生成：
              章节抽取 ×N → 整书聚合 → 本地校验 → 图示渲染；从节点可一键「就此制卡」。
              导图永不写入知识图谱或复习调度。
            </p>
          )}
        </div>
        <aside className="mindmap-sidebar">
          {noKey && step === "scope" && (
            <p className="kmg-msg kmg-msg-error">未配置 AI Key：请先在 设置 → AI 服务 配置并保存 Key，再生成导图。</p>
          )}

          {step !== "done" && (
            <>
              <div className="settings-row">
                <span>范围</span>
                <button
                  className={`btn btn-sm ${scope.kind === "book" ? "btn-primary" : "btn-outline"}`}
                  onClick={() => setScope({ kind: "book", label: "整书" })}
                >
                  整书
                </button>
                <span className="form-hint">或在下方目录树中选某一章为范围</span>
              </div>
              <div className="settings-row">
                <span>覆盖粒度</span>
                <Dropdown
                  align="left"
                  title="覆盖粒度（越高分析越细、调用越多）"
                  value={granularity}
                  options={GRANULARITIES.map((g) => ({ value: g.value, label: g.label }))}
                  onChange={(v) => setGranularity(v as MindmapGranularity)}
                />
              </div>
              <div style={{ maxHeight: 220, overflow: "auto", border: "1px solid var(--grey-2)", padding: "var(--sp-2)", margin: "var(--sp-2) 0" }}>
                {tree ? renderTree(tree.children, 0) : <p className="form-hint">本书无目录结构。</p>}
              </div>
              <div className="settings-row">
                <span>预估</span>
                <span className="mono" style={{ fontSize: 12 }}>
                  章节 {plan.chapterCount} · AI 调用 ≈ {plan.aiCalls} 次（{plan.chapterCount} 章抽取 + 聚合 + 图示）
                  {texts ? ` · 实测 ≈ ${plan.estTokens} token（全文发送，无字数截断）` : " · Token 于预览步实测后给出"}
                </span>
              </div>
              {history.length > 0 && (
                <div className="settings-row">
                  <span>已生成</span>
                  <div>
                    {history.map((h) => (
                      <button key={h.id} className="btn btn-outline btn-sm" style={{ margin: 2 }} onClick={() => void openSaved(h.id)}>
                        {h.scopeKind === "book" ? "整书" : "章节"} · {h.granularity} · {new Date(h.updatedAt).toLocaleString()}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {error && <p className="ai-test-fail">{error}</p>}
              <div className="settings-row">
                <button className="btn btn-primary btn-sm" disabled={busy || noKey || !kernel?.getSectionText || chapters.length === 0} onClick={() => void goPreview()}>
                  {texts ? "下一步（发送前预览）" : "下一步（读取章节并预览，本地零调用）"}
                </button>
              </div>
            </>
          )}

          {step === "preview" && texts && (
            <div className="restore-confirm">
              <p className="restore-confirm-title">发送前预览</p>
              <p className="form-hint">
                将把 {textChapters.length} 个章节的「全文」发送给你配置的模型（质量优先：无字数截断；
                空章节自动跳过），实测合计 {measuredChars} 字 ≈ {plan.estTokens} token：先逐章抽取（复用材料难度画像），
                再整书聚合出主干结构，最后渲染为自包含 SVG。结构经本地校验（编造节点拒绝、依据逐字抽查）后才入库。
              </p>
              <div style={{ maxHeight: 160, overflow: "auto", border: "1px solid var(--grey-2)", padding: "var(--sp-2)", marginBottom: "var(--sp-2)" }}>
                {textChapters.map((c) => (
                  <div key={c.anchor} className="mono" style={{ fontSize: 12 }}>
                    {c.label} · {(texts[c.anchor] || "").length} 字
                  </div>
                ))}
              </div>
              <div className="settings-row">
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void runGenerate()}>开始生成</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setStep("scope")}>返回</button>
              </div>
            </div>
          )}

          {step === "done" && saved && (
            <>
              <div className="settings-row">
                <span>已生成</span>
                <span className="form-hint">
                  {saved.scopeKind === "book" ? "整书" : "章节"} · {saved.granularity} · {new Date(saved.updatedAt).toLocaleString()}
                  {saved.model ? ` · ${saved.model}` : ""}
                </span>
              </div>
              {saved.warnings.length > 0 && <p className="ai-draft-warnings">⚠ {saved.warnings.join("；")}</p>}
              <div className="settings-row">
                <button className="btn btn-outline btn-sm" onClick={() => setShowArtifact((v) => !v)}>{showArtifact ? "隐藏图示" : "显示图示"}</button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setScope({ kind: saved.scopeKind === "book" ? "book" : "chapter", anchor: saved.scopeAnchor === "book" ? undefined : saved.scopeAnchor, label: "重生成" });
                    setStep("scope");
                  }}
                >
                  重新生成
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => {
                    void mindmapApi.remove(saved.id).then(refreshHistory);
                    setSaved(null);
                    setStep("scope");
                  }}
                >
                  删除
                </button>
              </div>
              <h3 style={{ margin: "var(--sp-3) 0 var(--sp-2)" }}>结构层级树</h3>
              <div style={{ maxHeight: 480, overflow: "auto" }}>{saved.structure ? structureTree(saved.structure) : <p className="form-hint">无结构数据。</p>}</div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
