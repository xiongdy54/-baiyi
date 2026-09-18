// 材料知识导图核心（v47，M15，D40 / §4.19）——纯函数、零依赖（渲染层与测试 bundle 共用）。
// 四阶段管线的本地部分：① 结构解析（内核 TOC 树）② 粒度选择与预估 ④ 结构 JSON 本地校验
// （编造节点拒绝 / 孤儿节点标出 / 环与断裂防护 / evidence span 抽查）+ 选型确定性本地函数 +
// 制卡结构摘要有界派生。图先于图示：结构层出错只重跑结构层，图示回看零调用。

export interface MindmapTocNode {
  anchor: string; // 章节锚（foliate href / pdfpage:N / sec:<i>）
  label: string;
  level: number; // 1 = 一级章节
  children: MindmapTocNode[];
}

export interface MindmapChapter {
  anchor: string;
  label: string;
  level: number;
}

export interface MindmapScope {
  kind: "book" | "chapter";
  /** kind=chapter 时为目标章节锚 */
  anchor?: string;
}

export type MindmapGranularity = "standard" | "fine" | "deep";

/** 渲染层把内核 TOC（subitems 层级）规整为导图结构树（无 TOC 时调用方给单章兜底） */
export function buildTocTree(items: { anchor: string; label: string; children?: unknown }[], rootLabel: string): MindmapTocNode {
  const mapNode = (it: { anchor: string; label: string; children?: unknown }, level: number): MindmapTocNode => ({
    anchor: String(it.anchor ?? ""),
    label: String(it.label ?? "").trim() || "（未命名）",
    level,
    children: Array.isArray(it.children) ? (it.children as typeof items).map((c) => mapNode(c, level + 1)) : []
  });
  const roots = (items || []).map((it) => mapNode(it, 1));
  return { anchor: "book", label: String(rootLabel || "").trim() || "整书", level: 0, children: roots };
}

// ①→② 范围内章节清单：scope=book 取全部（按粒度截层级）；scope=chapter 取该章及其子树
export function selectChapters(tree: MindmapTocNode, scope: MindmapScope, granularity: MindmapGranularity): MindmapChapter[] {
  const maxLevel = granularity === "standard" ? 1 : granularity === "fine" ? 2 : 99;
  const out: MindmapChapter[] = [];
  const walk = (node: MindmapTocNode, inScope: boolean) => {
    const hit = scope.kind === "book" || node.anchor === scope.anchor;
    const next = inScope || hit;
    if (next && node.level >= 1 && node.level <= maxLevel) out.push({ anchor: node.anchor, label: node.label, level: node.level });
    for (const c of node.children) walk(c, next);
  };
  walk(tree, false);
  if (!out.length && tree.children.length === 0 && tree.anchor) {
    out.push({ anchor: tree.anchor, label: tree.label, level: 1 }); // 单章兜底（无 TOC 书）
  }
  return out;
}

// 预估（§4.19-2③：费用可预期）：章节抽取（material-difficulty ×N）+ 聚合 1 次 + 图示 1 次。
// v47.1（质量优先，用户拍板）：取消单章字数上限——estChars 由预览步**本地实测**全文章节字数给出，
// 不再按假想 cap 估算（估算与实际发送内容一致，费用预期不失真）。
export function estimatePlan(chapters: MindmapChapter[], _granularity: MindmapGranularity, estChars: number) {
  const chapterCount = chapters.length;
  const aiCalls = chapterCount + 2;
  const perChapterChars = chapterCount ? Math.ceil(estChars / chapterCount) : 0;
  const extractTokens = Math.ceil((perChapterChars * 0.7 + 900) * chapterCount);
  const estTokens = extractTokens + 2500 + 3000; // 聚合与图示常量开销
  return { chapterCount, aiCalls, estTokens, granularity: _granularity };
}

// ---------- 图表选型（§4.19-4①：确定性本地函数，AI 只在白名单内执行） ----------

export const DIAGRAM_TYPES = ["mindmap", "tree", "flowchart", "timeline", "matrix"] as const;
export type DiagramType = (typeof DIAGRAM_TYPES)[number];

export function selectDiagramTypes(opts: { materialType?: string; domains?: string[]; chars?: number; granularity?: MindmapGranularity }): { whitelist: DiagramType[]; maxCount: number } {
  const mt = String(opts.materialType || "concept");
  const domains = Array.isArray(opts.domains) ? opts.domains.map(String) : [];
  const chars = Number(opts.chars) || 0;
  const gran = opts.granularity || "standard";
  const wl: DiagramType[] = ["mindmap"];
  if (mt === "sequence" || mt === "formula") wl.push("flowchart");
  if (mt === "enumeration") wl.push("matrix");
  if (mt === "literature") wl.push("timeline");
  if (mt === "concept") wl.push("tree");
  // 历史地理类材料（UDC 91/93）→ 时间线
  if (domains.some((d) => d === "91" || d === "93")) wl.push("timeline");
  const maxCount = chars >= 30000 || gran === "deep" ? 2 : 1;
  return { whitelist: wl, maxCount };
}

// ---------- 结构 JSON 本地校验（§4.19-3④：图先于图示） ----------

export interface MindmapNodeInput {
  id?: unknown;
  label?: unknown;
  parentId?: unknown;
  chapterAnchors?: unknown;
  evidence?: unknown;
}
export interface MindmapStructureInput {
  title?: unknown;
  nodes?: unknown;
}
export interface MindmapNode {
  id: string;
  label: string;
  parentId: string | null;
  chapterAnchors: string[];
  evidence: string | null;
  /** 校验产生的标注（孤儿/引用失效等）；节点仍保留供人工判断 */
  flags?: string[];
}
export interface MindmapStructure {
  title: string;
  nodes: MindmapNode[];
  rootIds: string[];
}
export interface ValidateResult {
  ok: boolean;
  structure: MindmapStructure | null;
  dropped: { index: number; reason: string }[];
  warnings: string[];
}

// chapterTexts: anchor → 原文（evidence span 抽查与章节锚封闭校验的对照物）
export function validateMindmapStructure(raw: MindmapStructureInput, chapterTexts: Record<string, string>): ValidateResult {
  const dropped: { index: number; reason: string }[] = [];
  const warnings: string[] = [];
  const rawNodes = Array.isArray(raw.nodes) ? (raw.nodes as MindmapNodeInput[]) : [];
  const anchors = new Set(Object.keys(chapterTexts || {}));
  // 第一遍：逐节点形式校验（编造锚拒绝；evidence span 必须逐字出现在其声明章节原文中）
  const kept: { node: MindmapNode; index: number }[] = [];
  rawNodes.forEach((n, index) => {
    const id = typeof n.id === "string" ? n.id.trim() : "";
    const label = typeof n.label === "string" ? n.label.trim().slice(0, 40) : "";
    if (!id || !label) {
      dropped.push({ index, reason: "缺 id 或 label" });
      return;
    }
    const anchorsRaw = Array.isArray(n.chapterAnchors) ? n.chapterAnchors.map(String) : [];
    const validAnchors = anchorsRaw.filter((a) => anchors.has(a));
    if (anchorsRaw.length && !validAnchors.length) {
      dropped.push({ index, reason: `编造章节锚（${anchorsRaw.join("、")} 不在输入范围内）` });
      return;
    }
    let evidence: string | null = typeof n.evidence === "string" && n.evidence.trim() ? n.evidence.trim().slice(0, 120) : null;
    const flags: string[] = [];
    if (evidence) {
      const host = validAnchors.map((a) => chapterTexts[a] || "").join("\n") || Object.values(chapterTexts || {}).join("\n");
      if (!host.includes(evidence)) {
        evidence = null;
        flags.push("evidence 未命中原文，已置空");
      }
    }
    const parentId = typeof n.parentId === "string" && n.parentId.trim() ? n.parentId.trim() : null;
    kept.push({ node: { id, label, parentId, chapterAnchors: validAnchors, evidence, flags }, index });
  });
  // 第二遍：父引用与环防护（孤儿标出不删除；环剪断标 warnings）
  const ids = new Set(kept.map((k) => k.node.id));
  const rootIds: string[] = [];
  for (const k of kept) {
    if (k.node.parentId && !ids.has(k.node.parentId)) {
      k.node.flags = [...(k.node.flags || []), "孤儿节点：父引用不存在"];
      k.node.parentId = null;
      warnings.push(`节点「${k.node.label}」父引用缺失，已挂为根`);
    }
  }
  // 环防护：沿父链上行，步数超过节点数说明有环——剪断为根
  const nodeById = new Map(kept.map((k) => [k.node.id, k.node]));
  for (const node of nodeById.values()) {
    let cur = node.parentId;
    const seen = new Set([node.id]);
    let steps = 0;
    while (cur && steps <= nodeById.size) {
      if (seen.has(cur)) {
        node.parentId = null;
        node.flags = [...(node.flags || []), "引用成环，已剪断为根"];
        warnings.push(`节点「${node.label}」所在父链成环，已剪断为根`);
        break;
      }
      seen.add(cur);
      cur = nodeById.get(cur)?.parentId ?? null;
      steps++;
    }
    if (!node.parentId && !rootIds.includes(node.id)) rootIds.push(node.id);
  }
  const structure: MindmapStructure = {
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim().slice(0, 80) : "知识导图",
    nodes: kept.map((k) => k.node),
    rootIds: rootIds.length ? rootIds : kept.slice(0, 1).map((k) => k.node.id)
  };
  return { ok: structure.nodes.length > 0, structure, dropped, warnings };
}

// ---------- 制卡整书把握（§4.19-7）：结构 JSON → 有界大纲（KP 清单 + 章节归属 + 关系骨架） ----------

export function deriveStructureSummary(structure: MindmapStructure, chapterLabels: Record<string, string>, maxChars = 1200): string {
  const lines: string[] = [`【${structure.title} · 结构摘要】`];
  const byParent = new Map<string | null, MindmapNode[]>();
  for (const n of structure.nodes) {
    const key = n.parentId && structure.nodes.some((x) => x.id === n.parentId) ? n.parentId : null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(n);
  }
  const emit = (parentId: string | null, depth: number) => {
    for (const n of byParent.get(parentId) || []) {
      if (lines.join("\n").length > maxChars) return;
      const chs = n.chapterAnchors.map((a) => chapterLabels[a]).filter(Boolean).slice(0, 2);
      lines.push(`${"  ".repeat(depth)}- ${n.label}${chs.length ? `（${chs.join("、")}）` : ""}`);
      emit(n.id, depth + 1);
    }
  };
  emit(null, 0);
  let text = lines.join("\n");
  if (text.length > maxChars) text = text.slice(0, maxChars) + "\n（超长截断）";
  return text;
}
