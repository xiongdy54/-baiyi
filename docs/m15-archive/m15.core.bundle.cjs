"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/lib/mindmapCore.ts
var mindmapCore_exports = {};
__export(mindmapCore_exports, {
  DIAGRAM_TYPES: () => DIAGRAM_TYPES,
  buildTocTree: () => buildTocTree,
  deriveStructureSummary: () => deriveStructureSummary,
  estimatePlan: () => estimatePlan,
  selectChapters: () => selectChapters,
  selectDiagramTypes: () => selectDiagramTypes,
  validateMindmapStructure: () => validateMindmapStructure
});
module.exports = __toCommonJS(mindmapCore_exports);
function buildTocTree(items, rootLabel) {
  const mapNode = (it, level) => ({
    anchor: String(it.anchor ?? ""),
    label: String(it.label ?? "").trim() || "\uFF08\u672A\u547D\u540D\uFF09",
    level,
    children: Array.isArray(it.children) ? it.children.map((c) => mapNode(c, level + 1)) : []
  });
  const roots = (items || []).map((it) => mapNode(it, 1));
  return { anchor: "book", label: String(rootLabel || "").trim() || "\u6574\u4E66", level: 0, children: roots };
}
function selectChapters(tree, scope, granularity) {
  const maxLevel = granularity === "standard" ? 1 : granularity === "fine" ? 2 : 99;
  const out = [];
  const walk = (node, inScope) => {
    const hit = scope.kind === "book" || node.anchor === scope.anchor;
    const next = inScope || hit;
    if (next && node.level >= 1 && node.level <= maxLevel) out.push({ anchor: node.anchor, label: node.label, level: node.level });
    for (const c of node.children) walk(c, next);
  };
  walk(tree, false);
  if (!out.length && tree.children.length === 0 && tree.anchor) {
    out.push({ anchor: tree.anchor, label: tree.label, level: 1 });
  }
  return out;
}
function estimatePlan(chapters, _granularity, estChars) {
  const chapterCount = chapters.length;
  const aiCalls = chapterCount + 2;
  const perChapterChars = chapterCount ? Math.ceil(estChars / chapterCount) : 0;
  const extractTokens = Math.ceil((perChapterChars * 0.7 + 900) * chapterCount);
  const estTokens = extractTokens + 2500 + 3e3;
  return { chapterCount, aiCalls, estTokens, granularity: _granularity };
}
var DIAGRAM_TYPES = ["mindmap", "tree", "flowchart", "timeline", "matrix"];
function selectDiagramTypes(opts) {
  const mt = String(opts.materialType || "concept");
  const domains = Array.isArray(opts.domains) ? opts.domains.map(String) : [];
  const chars = Number(opts.chars) || 0;
  const gran = opts.granularity || "standard";
  const wl = ["mindmap"];
  if (mt === "sequence" || mt === "formula") wl.push("flowchart");
  if (mt === "enumeration") wl.push("matrix");
  if (mt === "literature") wl.push("timeline");
  if (mt === "concept") wl.push("tree");
  if (domains.some((d) => d === "91" || d === "93")) wl.push("timeline");
  const maxCount = chars >= 3e4 || gran === "deep" ? 2 : 1;
  return { whitelist: wl, maxCount };
}
function validateMindmapStructure(raw, chapterTexts) {
  const dropped = [];
  const warnings = [];
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const anchors = new Set(Object.keys(chapterTexts || {}));
  const kept = [];
  rawNodes.forEach((n, index) => {
    const id = typeof n.id === "string" ? n.id.trim() : "";
    const label = typeof n.label === "string" ? n.label.trim().slice(0, 40) : "";
    if (!id || !label) {
      dropped.push({ index, reason: "\u7F3A id \u6216 label" });
      return;
    }
    const anchorsRaw = Array.isArray(n.chapterAnchors) ? n.chapterAnchors.map(String) : [];
    const validAnchors = anchorsRaw.filter((a) => anchors.has(a));
    if (anchorsRaw.length && !validAnchors.length) {
      dropped.push({ index, reason: `\u7F16\u9020\u7AE0\u8282\u951A\uFF08${anchorsRaw.join("\u3001")} \u4E0D\u5728\u8F93\u5165\u8303\u56F4\u5185\uFF09` });
      return;
    }
    let evidence = typeof n.evidence === "string" && n.evidence.trim() ? n.evidence.trim().slice(0, 120) : null;
    const flags = [];
    if (evidence) {
      const host = validAnchors.map((a) => chapterTexts[a] || "").join("\n") || Object.values(chapterTexts || {}).join("\n");
      if (!host.includes(evidence)) {
        evidence = null;
        flags.push("evidence \u672A\u547D\u4E2D\u539F\u6587\uFF0C\u5DF2\u7F6E\u7A7A");
      }
    }
    const parentId = typeof n.parentId === "string" && n.parentId.trim() ? n.parentId.trim() : null;
    kept.push({ node: { id, label, parentId, chapterAnchors: validAnchors, evidence, flags }, index });
  });
  const ids = new Set(kept.map((k) => k.node.id));
  const rootIds = [];
  for (const k of kept) {
    if (k.node.parentId && !ids.has(k.node.parentId)) {
      k.node.flags = [...k.node.flags || [], "\u5B64\u513F\u8282\u70B9\uFF1A\u7236\u5F15\u7528\u4E0D\u5B58\u5728"];
      k.node.parentId = null;
      warnings.push(`\u8282\u70B9\u300C${k.node.label}\u300D\u7236\u5F15\u7528\u7F3A\u5931\uFF0C\u5DF2\u6302\u4E3A\u6839`);
    }
  }
  const nodeById = new Map(kept.map((k) => [k.node.id, k.node]));
  for (const node of nodeById.values()) {
    let cur = node.parentId;
    const seen = /* @__PURE__ */ new Set([node.id]);
    let steps = 0;
    while (cur && steps <= nodeById.size) {
      if (seen.has(cur)) {
        node.parentId = null;
        node.flags = [...node.flags || [], "\u5F15\u7528\u6210\u73AF\uFF0C\u5DF2\u526A\u65AD\u4E3A\u6839"];
        warnings.push(`\u8282\u70B9\u300C${node.label}\u300D\u6240\u5728\u7236\u94FE\u6210\u73AF\uFF0C\u5DF2\u526A\u65AD\u4E3A\u6839`);
        break;
      }
      seen.add(cur);
      cur = nodeById.get(cur)?.parentId ?? null;
      steps++;
    }
    if (!node.parentId && !rootIds.includes(node.id)) rootIds.push(node.id);
  }
  const structure = {
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim().slice(0, 80) : "\u77E5\u8BC6\u5BFC\u56FE",
    nodes: kept.map((k) => k.node),
    rootIds: rootIds.length ? rootIds : kept.slice(0, 1).map((k) => k.node.id)
  };
  return { ok: structure.nodes.length > 0, structure, dropped, warnings };
}
function deriveStructureSummary(structure, chapterLabels, maxChars = 1200) {
  const lines = [`\u3010${structure.title} \xB7 \u7ED3\u6784\u6458\u8981\u3011`];
  const byParent = /* @__PURE__ */ new Map();
  for (const n of structure.nodes) {
    const key = n.parentId && structure.nodes.some((x) => x.id === n.parentId) ? n.parentId : null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(n);
  }
  const emit = (parentId, depth) => {
    for (const n of byParent.get(parentId) || []) {
      if (lines.join("\n").length > maxChars) return;
      const chs = n.chapterAnchors.map((a) => chapterLabels[a]).filter(Boolean).slice(0, 2);
      lines.push(`${"  ".repeat(depth)}- ${n.label}${chs.length ? `\uFF08${chs.join("\u3001")}\uFF09` : ""}`);
      emit(n.id, depth + 1);
    }
  };
  emit(null, 0);
  let text = lines.join("\n");
  if (text.length > maxChars) text = text.slice(0, maxChars) + "\n\uFF08\u8D85\u957F\u622A\u65AD\uFF09";
  return text;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DIAGRAM_TYPES,
  buildTocTree,
  deriveStructureSummary,
  estimatePlan,
  selectChapters,
  selectDiagramTypes,
  validateMindmapStructure
});
