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

// src/lib/cardQuery.ts
var cardQuery_exports = {};
__export(cardQuery_exports, {
  extractMatches: () => extractMatches,
  extractTagsOf: () => extractTagsOf,
  parseCardQuery: () => parseCardQuery,
  statusMatches: () => statusMatches,
  tagFilterMatches: () => tagFilterMatches,
  textMatches: () => textMatches
});
module.exports = __toCommonJS(cardQuery_exports);

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
var KNOWN_FIELDS = ["kind", "book", "status", "priority", "tag", "type"];
var PRIORITY_RE = /^priority(<=|>=|<|>|=)(\d{1,3})$/;
function tokenize(raw) {
  const out = [];
  let cur = "";
  let inQuote = false;
  for (const ch of String(raw ?? "")) {
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && /\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function parseCardQuery(raw) {
  const q = { text: "", exclude: [] };
  const texts = [];
  for (const token of tokenize(raw)) {
    const negated = token.startsWith("-") && token.length > 1;
    const body = negated ? token.slice(1) : token;
    const m = /^([A-Za-z]+):(.*)$/.exec(body);
    if (m && KNOWN_FIELDS.includes(m[1].toLowerCase())) {
      const field = m[1].toLowerCase();
      const value = m[2].trim();
      if (!value) {
        if (negated) q.exclude.push(`${field}:`);
        continue;
      }
      if (field === "priority") {
        const pm = PRIORITY_RE.exec(body);
        if (pm) {
          if (!negated) q.priority = { op: pm[1], value: Number(pm[2]) };
          else q.exclude.push(body);
          continue;
        }
        texts.push(body);
        continue;
      }
      if (field === "tag") {
        if (negated) (q.tagNeg ??= []).push(value);
        else (q.tag ??= []).push(value);
        continue;
      }
      if (field === "type") {
        if (!negated) q.type = value.toLowerCase();
        else q.exclude.push(body);
        continue;
      }
      if (negated) {
        q.exclude.push(body);
        continue;
      }
      if (field === "kind") {
        const v = value.toLowerCase();
        if (v === "card" || v === "extract") {
          q.kind = negated ? v === "card" ? "extract" : "card" : v;
        } else texts.push(body);
        continue;
      }
      if (field === "book") {
        q.book = value;
        continue;
      }
      q.status = value.toLowerCase();
      continue;
    }
    if (negated) q.exclude.push(body);
    else texts.push(body);
  }
  q.text = texts.join(" ").trim();
  return q;
}
function extractMatches(q, extract) {
  const text = `${extract.contentMarkdown ?? ""}
${extract.docTitle ?? ""}`;
  return textMatches(q, text) && statusMatches(q, String(extract.status ?? "open"));
}
function textMatches(q, haystack) {
  const hay = haystack.toLowerCase();
  if (q.text && !hay.includes(q.text.toLowerCase())) return false;
  for (const ex of q.exclude) {
    if (!ex || ex.includes(":")) continue;
    if (hay.includes(ex.toLowerCase())) return false;
  }
  return true;
}
function statusMatches(q, status) {
  if (!q.status) return true;
  return status.toLowerCase() === q.status;
}
function extractTagsOf(row) {
  if (!row.tagJson) return [];
  try {
    const v = JSON.parse(row.tagJson);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function tagFilterMatches(q, tags) {
  if (q.tag?.length && !q.tag.some((t) => anyTagMatches(tags ?? [], t))) return false;
  if (q.tagNeg?.length && q.tagNeg.some((t) => anyTagMatches(tags ?? [], t))) return false;
  return true;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  extractMatches,
  extractTagsOf,
  parseCardQuery,
  statusMatches,
  tagFilterMatches,
  textMatches
});
