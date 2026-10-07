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

// src/lib/tags.ts
var tags_exports = {};
__export(tags_exports, {
  TAG_MAX_DEPTH: () => TAG_MAX_DEPTH,
  TAG_MAX_LEN: () => TAG_MAX_LEN,
  TAG_MAX_PER_CARD: () => TAG_MAX_PER_CARD,
  TAG_SEP: () => TAG_SEP,
  anyTagMatches: () => anyTagMatches,
  applyTagDelta: () => applyTagDelta,
  mergeTagVocab: () => mergeTagVocab,
  normalizeTag: () => normalizeTag,
  normalizeTags: () => normalizeTags,
  tagKey: () => tagKey,
  tagPathMatches: () => tagPathMatches
});
module.exports = __toCommonJS(tags_exports);
var TAG_SEP = "::";
var TAG_MAX_PER_CARD = 8;
var TAG_MAX_LEN = 24;
var TAG_MAX_DEPTH = 3;
function normalizeTag(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: false, reason: "\u6807\u7B7E\u4E3A\u7A7A" };
  if (/[\u0000-\u001f\u007f]/.test(text)) return { ok: false, reason: "\u6807\u7B7E\u542B\u63A7\u5236\u5B57\u7B26" };
  const parts = text.split(TAG_SEP).map((p) => p.trim());
  if (parts.some((p) => !p)) return { ok: false, reason: "\u5C42\u7EA7\u6BB5\u4E0D\u80FD\u4E3A\u7A7A" };
  for (const p of parts) {
    if (p.includes(":")) return { ok: false, reason: `\u300C${p}\u300D\u5185\u4E0D\u80FD\u518D\u542B\u534A\u89D2\u5192\u53F7\uFF08\u5C42\u7EA7\u7528 ::\uFF09` };
  }
  if (parts.length > TAG_MAX_DEPTH) return { ok: false, reason: `\u5C42\u7EA7\u8D85\u8FC7 ${TAG_MAX_DEPTH} \u5C42` };
  const tag = parts.join(TAG_SEP);
  if ([...tag].length > TAG_MAX_LEN) return { ok: false, reason: `\u6807\u7B7E\u8D85\u8FC7 ${TAG_MAX_LEN} \u5B57` };
  return { ok: true, tag };
}
function tagKey(tag) {
  return String(tag ?? "").normalize("NFKC").toLowerCase();
}
function normalizeTags(list) {
  const arr = Array.isArray(list) ? list : [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const raw of arr) {
    if (typeof raw !== "string") continue;
    const r = normalizeTag(raw);
    if (!r.ok) continue;
    const key = tagKey(r.tag);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r.tag);
  }
  return out;
}
function tagPathMatches(tag, prefix) {
  const t = tagKey(tag);
  const p = tagKey(prefix);
  if (!t || !p) return false;
  return t === p || t.startsWith(p + TAG_SEP);
}
function anyTagMatches(tags, prefix) {
  return (tags ?? []).some((t) => tagPathMatches(t, prefix));
}
function applyTagDelta(current, add, remove) {
  const tags = [...current ?? []];
  let added = 0;
  for (const raw of add) {
    const r = normalizeTag(raw);
    if (!r.ok) continue;
    const key = tagKey(r.tag);
    if (tags.some((t) => tagKey(t) === key)) continue;
    tags.push(r.tag);
    added += 1;
  }
  let removed = 0;
  for (const raw of remove) {
    const r = normalizeTag(raw);
    if (!r.ok) continue;
    const before = tags.length;
    const kept = tags.filter((t) => !tagPathMatches(t, r.tag));
    if (kept.length !== before) removed += before - kept.length;
    tags.length = 0;
    tags.push(...kept);
  }
  return { tags, added, removed };
}
function mergeTagVocab(cards, extracts) {
  const map = /* @__PURE__ */ new Map();
  const put = (src, field) => {
    const key = tagKey(src.display);
    if (!key) return;
    const cur = map.get(key);
    if (!cur) {
      map.set(key, { display: src.display, cardCount: 0, extractCount: 0, lastUsedAt: src.lastUsedAt });
    }
    const e = map.get(key);
    e[field] += src.count;
    if (src.lastUsedAt > e.lastUsedAt || src.lastUsedAt === e.lastUsedAt && field === "cardCount") e.display = src.display;
  };
  for (const c of cards) put(c, "cardCount");
  for (const e of extracts) put(e, "extractCount");
  return [...map.values()].sort(
    (a, b) => b.cardCount + b.extractCount - (a.cardCount + a.extractCount) || a.display.localeCompare(b.display)
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TAG_MAX_DEPTH,
  TAG_MAX_LEN,
  TAG_MAX_PER_CARD,
  TAG_SEP,
  anyTagMatches,
  applyTagDelta,
  mergeTagVocab,
  normalizeTag,
  normalizeTags,
  tagKey,
  tagPathMatches
});
