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

// src/lib/cardLineage.ts
var cardLineage_exports = {};
__export(cardLineage_exports, {
  LINEAGE_LABEL_MAX: () => LINEAGE_LABEL_MAX,
  buildLineageTree: () => buildLineageTree,
  firstLineLabel: () => firstLineLabel
});
module.exports = __toCommonJS(cardLineage_exports);

// src/lib/reader/marks.ts
function aggregateCardCounts(counts, parentToChildren) {
  const memo = /* @__PURE__ */ new Map();
  const visiting = /* @__PURE__ */ new Set();
  const walk = (id) => {
    const cached = memo.get(id);
    if (cached !== void 0) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let total = counts[id] ?? 0;
    for (const child of parentToChildren.get(id) ?? []) total += walk(child);
    visiting.delete(id);
    memo.set(id, total);
    return total;
  };
  const out = {};
  for (const id of /* @__PURE__ */ new Set([...Object.keys(counts), ...parentToChildren.keys()])) out[id] = walk(id);
  return out;
}

// src/lib/cardLineage.ts
var LINEAGE_LABEL_MAX = 40;
function firstLineLabel(text, max = LINEAGE_LABEL_MAX) {
  const line = String(text ?? "").split("\n").map((s) => s.trim()).find(Boolean) ?? "";
  const chars = [...line];
  if (chars.length <= max) return line;
  return chars.slice(0, max).join("") + "\u2026";
}
function buildLineageTree(opts) {
  const extractId = opts.extractId ? String(opts.extractId) : "";
  const byId = /* @__PURE__ */ new Map();
  const parentToChildren = /* @__PURE__ */ new Map();
  for (const e of opts.extracts) {
    if (!e?.id) continue;
    byId.set(String(e.id), e);
    const pid = e?.contextRef?.parentExtractId;
    if (pid) {
      const list = parentToChildren.get(String(pid)) ?? [];
      list.push(String(e.id));
      parentToChildren.set(String(pid), list);
    }
  }
  const empty = { hasSource: false, ancestors: [], descendants: [] };
  if (!extractId || !byId.has(extractId)) return empty;
  const direct = {};
  for (const c of opts.cards) {
    const ce = c?.contextRef?.extractId;
    if (ce) direct[String(ce)] = (direct[String(ce)] ?? 0) + 1;
  }
  const agg = aggregateCardCounts(direct, parentToChildren);
  const nodeOf = (id, isCurrent, depth) => {
    const row = byId.get(id);
    return {
      id,
      label: firstLineLabel(row?.contentMarkdown),
      count: agg[id] ?? 0,
      isCurrent,
      depth,
      documentId: row?.documentId ? String(row.documentId) : null,
      anchorText: row?.contextRef?.anchorText ? String(row.contextRef.anchorText) : null,
      anchorRatio: typeof row?.contextRef?.anchorRatio === "number" ? row.contextRef.anchorRatio : null
    };
  };
  const chain = [];
  const seenUp = /* @__PURE__ */ new Set([extractId]);
  let cursor = extractId;
  while (cursor) {
    chain.push(cursor);
    const pid = byId.get(cursor)?.contextRef?.parentExtractId;
    const next = pid ? String(pid) : "";
    if (!next || seenUp.has(next) || !byId.has(next)) break;
    seenUp.add(next);
    cursor = next;
  }
  chain.reverse();
  const baseDepth = chain.length - 1;
  const ancestors = chain.map((id, i) => nodeOf(id, id === extractId, i));
  const descendants = [];
  const seenDown = /* @__PURE__ */ new Set([extractId]);
  let frontier = [extractId];
  let level = 0;
  while (frontier.length) {
    level += 1;
    const next = [];
    for (const id of frontier) {
      for (const child of parentToChildren.get(id) ?? []) {
        if (seenDown.has(child)) continue;
        seenDown.add(child);
        descendants.push(nodeOf(child, false, baseDepth + level));
        next.push(child);
      }
    }
    frontier = next;
  }
  return { hasSource: true, ancestors, descendants };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LINEAGE_LABEL_MAX,
  buildLineageTree,
  firstLineLabel
});
