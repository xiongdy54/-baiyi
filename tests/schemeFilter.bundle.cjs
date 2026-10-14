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

// src/lib/schemeFilter.ts
var schemeFilter_exports = {};
__export(schemeFilter_exports, {
  buildSchemeFilter: () => buildSchemeFilter,
  cardMatchesScheme: () => cardMatchesScheme,
  extractMatchesScheme: () => extractMatchesScheme
});
module.exports = __toCommonJS(schemeFilter_exports);

// src/lib/tags.ts
var TAG_SEP = "::";
function tagKey(tag) {
  return String(tag ?? "").normalize("NFKC").toLowerCase();
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

// src/lib/cardQuery.ts
function tagFilterMatches(q, tags) {
  if (q.tag?.length && !q.tag.some((t) => anyTagMatches(tags ?? [], t))) return false;
  if (q.tagNeg?.length && q.tagNeg.some((t) => anyTagMatches(tags ?? [], t))) return false;
  return true;
}

// src/lib/schemeFilter.ts
function buildSchemeFilter(input) {
  const books = input.bookItemIds.length ? new Set(input.bookItemIds) : null;
  const tags = input.tags.map((t) => t.trim()).filter((t) => t !== "");
  const kpFamily = input.kpIds.length ? input.kpFamily ?? new Set(input.kpIds) : null;
  if (!books && tags.length === 0 && !kpFamily) return null;
  return { books, tags, kpFamily };
}
function schemeTagQuery(tags) {
  return { text: "", exclude: [], tag: tags };
}
function cardMatchesScheme(f, row) {
  if (f.books && !f.books.has(String(row.bookId || ""))) return false;
  if (f.tags.length && !tagFilterMatches(schemeTagQuery(f.tags), row.tags ?? [])) return false;
  if (f.kpFamily && !(row.kpId && f.kpFamily.has(row.kpId))) return false;
  return true;
}
function extractMatchesScheme(f, libraryItemId, getTags) {
  if (f.kpFamily) return false;
  if (f.books && !f.books.has(String(libraryItemId || ""))) return false;
  if (f.tags.length) {
    const tags = getTags();
    if (!tagFilterMatches(schemeTagQuery(f.tags), tags)) return false;
  }
  return true;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildSchemeFilter,
  cardMatchesScheme,
  extractMatchesScheme
});
