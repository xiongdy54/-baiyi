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

// tests/m15r.layout.entry.ts
var m15r_layout_entry_exports = {};
__export(m15r_layout_entry_exports, {
  buildMapSvg: () => buildMapSvg,
  layoutMap: () => layoutMap,
  nodeWidth: () => nodeWidth
});
module.exports = __toCommonJS(m15r_layout_entry_exports);

// src/lib/mindmap/layout.ts
var NODE_H = 40;
var PAD_X = 12;
var CHAR_W = 14;
var MIN_W = 128;
var MAX_W = 264;
var H_GAP = 48;
var V_GAP = 12;
function nodeWidth(title) {
  const w = PAD_X * 2 + String(title || "").length * CHAR_W;
  return Math.min(MAX_W, Math.max(MIN_W, Math.ceil(w / 4) * 4));
}
function layoutMap(nodesIn, rootNodeId, opts) {
  const byId = new Map(nodesIn.map((n) => [n.id, n]));
  const root = byId.get(rootNodeId);
  if (!root) return { nodes: [], edges: [], bounds: { w: 0, h: 0 } };
  const expanded = opts.expandedIds;
  const visible = [];
  const collapsedCount = /* @__PURE__ */ new Map();
  const countDescendants = (id) => {
    let n = 0;
    const node = byId.get(id);
    for (const c of (node?.childIds || []).filter((x) => byId.has(x))) {
      n += 1 + countDescendants(c);
    }
    return n;
  };
  const walkVisible = (id) => {
    visible.push(id);
    const node = byId.get(id);
    const kids = (node?.childIds || []).filter((c) => byId.has(c));
    if (kids.length && !expanded.has(id)) {
      collapsedCount.set(id, countDescendants(id));
      return;
    }
    for (const c of kids) walkVisible(c);
  };
  walkVisible(rootNodeId);
  const visibleSet = new Set(visible);
  const yOf = /* @__PURE__ */ new Map();
  let cursor = 0;
  const assignY = (id) => {
    const node = byId.get(id);
    const visibleKids = (node?.childIds || []).filter((c) => visibleSet.has(c));
    if (!visibleKids.length) {
      const y2 = cursor;
      cursor += NODE_H + V_GAP;
      yOf.set(id, y2);
      return y2;
    }
    const ys = visibleKids.map(assignY);
    const y = (ys[0] + ys[ys.length - 1]) / 2;
    yOf.set(id, y);
    return y;
  };
  assignY(rootNodeId);
  const depthOf = /* @__PURE__ */ new Map();
  const setDepth = (id, d) => {
    depthOf.set(id, d);
    const node = byId.get(id);
    for (const c of (node?.childIds || []).filter((x) => visibleSet.has(x))) setDepth(c, d + 1);
  };
  setDepth(rootNodeId, 0);
  const layerX = /* @__PURE__ */ new Map();
  const maxRightPerLayer = /* @__PURE__ */ new Map();
  const byDepth = [...visible].sort((a, b) => (depthOf.get(a) || 0) - (depthOf.get(b) || 0));
  for (const id of byDepth) {
    const d = depthOf.get(id) || 0;
    if (!layerX.has(d)) layerX.set(d, d === 0 ? 0 : (maxRightPerLayer.get(d - 1) || 0) + H_GAP);
    const w = nodeWidth(byId.get(id)?.title || "");
    maxRightPerLayer.set(d, Math.max(maxRightPerLayer.get(d) || 0, (layerX.get(d) || 0) + w));
  }
  const layoutNodes = visible.map((id) => {
    const n = byId.get(id);
    const allKids = (n?.childIds || []).filter((c) => byId.has(c));
    return {
      id,
      parentId: n?.parentId ?? null,
      title: n?.title || "",
      depth: depthOf.get(id) || 0,
      x: layerX.get(depthOf.get(id) || 0) || 0,
      y: yOf.get(id) || 0,
      w: nodeWidth(n?.title || ""),
      h: NODE_H,
      hasChildren: allKids.length > 0,
      collapsed: collapsedCount.has(id),
      collapsedCount: collapsedCount.get(id) || 0
    };
  });
  const layoutById = new Map(layoutNodes.map((n) => [n.id, n]));
  const edges = [];
  for (const n of layoutNodes) {
    const parent = n.parentId ? layoutById.get(n.parentId) : null;
    if (!parent) continue;
    const x1 = parent.x + parent.w;
    const y1 = parent.y + parent.h / 2;
    const x2 = n.x;
    const y2 = n.y + n.h / 2;
    const mx = x1 + Math.max(H_GAP / 2, (x2 - x1) / 2);
    edges.push({ fromId: parent.id, toId: n.id, d: `M ${x1} ${y1} H ${mx} V ${y2} H ${x2}` });
  }
  const maxRight = layoutNodes.reduce((m, n) => Math.max(m, n.x + n.w), 0);
  const maxBottom = layoutNodes.reduce((m, n) => Math.max(m, n.y + n.h), 0);
  return {
    nodes: layoutNodes,
    edges,
    bounds: { w: maxRight + PAD_X, h: Math.max(maxBottom, 0) }
  };
}

// src/lib/mindmap/render.ts
function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function truncateForWidth(title, w, fontSize) {
  const maxChars = Math.max(2, Math.floor((w - 24) / fontSize));
  const t = String(title ?? "");
  return t.length > maxChars ? t.slice(0, Math.max(1, maxChars - 1)) + "\u2026" : t;
}
function buildMapSvg(layout, theme, opts = {}) {
  const { nodes, edges, bounds } = layout;
  const pad = 24;
  const w = Math.max(bounds.w + pad * 2, 320);
  const h = Math.max(bounds.h + pad * 2, 200);
  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${-pad} ${-pad} ${w} ${h}" font-family="${esc(theme.fontFamily)}">`
  );
  parts.push(`<rect x="${-pad}" y="${-pad}" width="${w}" height="${h}" fill="${theme.paper}"/>`);
  for (const e of edges) {
    parts.push(`<path d="${e.d}" fill="none" stroke="${theme.border}" stroke-width="1"/>`);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    parts.push(renderNode(n, n.parentId && byId.get(n.parentId) || null, theme, opts));
  }
  parts.push("</svg>");
  return parts.join("");
}
function renderNode(n, parent, theme, opts) {
  const isRoot = !parent;
  const selected = opts.selectedId === n.id;
  const fill = isRoot ? theme.accent : selected ? theme.accentSoft : theme.paper;
  const stroke = isRoot ? theme.accent : selected ? theme.accent : theme.border;
  const strokeWidth = selected ? 2 : 1;
  const textFill = isRoot ? theme.accentOn : theme.ink;
  const label = truncateForWidth(n.title, n.w, theme.fontSize);
  const parts = [];
  parts.push(
    `<g data-node-id="${esc(n.id)}"><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/><text x="${n.x + 12}" y="${n.y + n.h / 2}" dominant-baseline="central" font-size="${theme.fontSize}" fill="${textFill}">${esc(label)}</text>`
  );
  if (n.collapsed) {
    const bw = 8 + String(n.collapsedCount).length * 8;
    const bx = n.x + n.w + 6;
    const by = n.y + n.h / 2 - 10;
    parts.push(
      `<rect x="${bx}" y="${by}" width="${bw}" height="20" fill="${theme.paper}" stroke="${theme.border}" stroke-width="1"/><text x="${bx + bw / 2}" y="${by + 10}" text-anchor="middle" dominant-baseline="central" font-size="11" fill="${theme.inkSoft}">+${n.collapsedCount}</text>`
    );
  }
  parts.push("</g>");
  return parts.join("");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildMapSvg,
  layoutMap,
  nodeWidth
});
