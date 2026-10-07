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
  cardRowMatches: () => cardRowMatches,
  evalQueryNode: () => evalQueryNode,
  extractMatches: () => extractMatches,
  extractRowMatches: () => extractRowMatches,
  extractScopeConditions: () => extractScopeConditions,
  extractTagsOf: () => extractTagsOf,
  foldQueryText: () => foldQueryText,
  makeCardPredicates: () => makeCardPredicates,
  makeExtractPredicates: () => makeExtractPredicates,
  parseCardQuery: () => parseCardQuery,
  statusMatches: () => statusMatches,
  tagFilterMatches: () => tagFilterMatches,
  textMatches: () => textMatches,
  valueMatches: () => valueMatches
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
  let curQuoted = false;
  let inQuote = false;
  const flush = () => {
    if (cur) out.push({ text: cur, quoted: curQuoted });
    cur = "";
    curQuoted = false;
  };
  for (const ch of String(raw ?? "")) {
    if (ch === '"') {
      inQuote = !inQuote;
      curQuoted = true;
      continue;
    }
    if (!inQuote && /\s/.test(ch)) {
      flush();
      continue;
    }
    cur += ch;
  }
  flush();
  return out;
}
function lex(tokens) {
  return tokens.map((tk) => {
    if (!tk.quoted && tk.text === "(") return { t: "(" };
    if (!tk.quoted && tk.text === ")") return { t: ")" };
    if (!tk.quoted && tk.text.toLowerCase() === "or") return { t: "or" };
    return { t: "term", text: tk.text, quoted: tk.quoted };
  });
}
function foldQueryText(s) {
  return String(s ?? "").normalize("NFKC").trim().toLowerCase();
}
var globCache = /* @__PURE__ */ new Map();
function valueMatches(hay, pattern) {
  if (!pattern) return true;
  if (!pattern.includes("*")) return hay.includes(pattern);
  let re = globCache.get(pattern);
  if (!re) {
    const src = pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\S]*");
    re = new RegExp(src);
    globCache.set(pattern, re);
  }
  return re.test(hay);
}
function leafFromTerm(text, quoted) {
  const negated = !quoted && text.startsWith("-") && text.length > 1;
  const body = negated ? text.slice(1) : text;
  const leaf = leafFromBody(body);
  if (!leaf) return null;
  return negated ? { t: "not", kid: { t: "leaf", leaf } } : { t: "leaf", leaf };
}
function leafFromBody(body) {
  const pm0 = PRIORITY_RE.exec(body);
  if (pm0) return { f: "priority", op: pm0[1], value: Number(pm0[2]) };
  const m = /^([A-Za-z]+):(.*)$/.exec(body);
  if (m && KNOWN_FIELDS.includes(m[1].toLowerCase())) {
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (!value) return null;
    if (field === "priority") {
      const pm = PRIORITY_RE.exec(value);
      if (pm) return { f: "priority", op: pm[1], value: Number(pm[2]) };
      return { f: "text", value: body };
    }
    if (field === "tag") return { f: "tag", value };
    if (field === "type") return { f: "type", value: value.toLowerCase() };
    if (field === "kind") {
      const v = value.toLowerCase();
      if (v === "card" || v === "extract") return { f: "kind", value: v };
      return { f: "text", value: body };
    }
    if (field === "book") return { f: "book", value };
    return { f: "status", value: value.toLowerCase() };
  }
  return { f: "text", value: body };
}
function andOf(kids) {
  const real = kids.filter((k) => k !== null);
  if (real.length === 0) return void 0;
  if (real.length === 1) return real[0];
  return { t: "and", kids: real };
}
function buildFlatAst(lts) {
  const leaves = [];
  let kindSeen = false;
  for (const lt of lts) {
    if (lt.t !== "term") continue;
    const node = leafFromTerm(lt.text, lt.quoted);
    if (node) leaves.push(node);
    const body = lt.text.startsWith("-") && lt.text.length > 1 ? lt.text.slice(1) : lt.text;
    const m = /^([A-Za-z]+):/.exec(body);
    if (m && m[1].toLowerCase() === "kind") kindSeen = true;
  }
  const lastOf = (pred) => {
    let last = null;
    for (const n of leaves) if (pred(n)) last = n;
    return last;
  };
  const isLeafOf = (n) => n.t === "leaf" || n.t === "not";
  const keep = /* @__PURE__ */ new Set();
  const slotPreds = [
    (n) => isLeafOf(n) && leafField(n) === "kind",
    (n) => isLeafOf(n) && leafField(n) === "book",
    (n) => isLeafOf(n) && leafField(n) === "status",
    (n) => isLeafOf(n) && leafField(n) === "type",
    (n) => n.t === "leaf" && n.leaf.f === "priority",
    (n) => n.t === "not" && n.kid.t === "leaf" && n.kid.leaf.f === "priority"
  ];
  for (const sp of slotPreds) {
    const last = lastOf(sp);
    if (last) keep.add(last);
  }
  const tagPositives = leaves.filter((n) => n.t === "leaf" && n.leaf.f === "tag");
  const tagGroup = tagPositives.length === 0 ? null : tagPositives.length === 1 ? tagPositives[0] : { t: "or", kids: tagPositives };
  const kids = [];
  let tagPlaced = false;
  for (const n of leaves) {
    if (n.t === "leaf" && n.leaf.f === "tag") {
      if (!tagPlaced && tagGroup) {
        kids.push(tagGroup);
        tagPlaced = true;
      }
      continue;
    }
    const inSlot = slotPreds.some((sp) => sp(n));
    if (inSlot && !keep.has(n)) continue;
    kids.push(n);
  }
  return { ast: andOf(kids), kindSeen };
}
function leafField(n) {
  if (n.t === "leaf") return n.leaf.f;
  if (n.t === "not" && n.kid.t === "leaf") return n.kid.leaf.f;
  return null;
}
function buildGroupAst(lts) {
  let pos = 0;
  const peek = () => lts[pos];
  const parseOr = () => {
    const parts = [];
    const first = parseAnd();
    if (first) parts.push(first);
    while (peek()?.t === "or") {
      pos++;
      const next = parseAnd();
      if (next) parts.push(next);
    }
    if (parts.length === 0) return null;
    return parts.length === 1 ? parts[0] : { t: "or", kids: parts };
  };
  const parseAnd = () => {
    const kids = [];
    while (true) {
      const tk = peek();
      if (!tk || tk.t === "or" || tk.t === ")") break;
      pos++;
      if (tk.t === "(") {
        const inner = parseOr();
        if (inner) kids.push(inner);
        if (peek()?.t === ")") pos++;
        continue;
      }
      const node = leafFromTerm(tk.text, tk.quoted);
      if (node) kids.push(node);
    }
    if (kids.length === 0) return null;
    return kids.length === 1 ? kids[0] : { t: "and", kids };
  };
  return parseOr() ?? void 0;
}
function parseCardQuery(raw) {
  const q = { text: "", exclude: [] };
  const texts = [];
  const lts = lex(tokenize(raw));
  const hasGroups = lts.some((lt) => lt.t === "(" || lt.t === ")" || lt.t === "or");
  for (const lt of lts) {
    if (lt.t !== "term") continue;
    const token = lt.text;
    const negated = !lt.quoted && token.startsWith("-") && token.length > 1;
    const body = negated ? token.slice(1) : token;
    const pm0 = PRIORITY_RE.exec(body);
    if (pm0) {
      if (!negated) q.priority = { op: pm0[1], value: Number(pm0[2]) };
      else q.exclude.push(body);
      continue;
    }
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
  if (hasGroups) {
    q.hasGroups = true;
    const ast = buildGroupAst(lts);
    if (ast) q.ast = ast;
  } else {
    const { ast } = buildFlatAst(lts);
    if (ast) q.ast = ast;
  }
  return q;
}
function evalQueryNode(node, p) {
  if (!node) return true;
  switch (node.t) {
    case "and":
      return node.kids.every((k) => evalQueryNode(k, p));
    case "or":
      return node.kids.some((k) => evalQueryNode(k, p));
    case "not":
      return !evalQueryNode(node.kid, p);
    case "leaf": {
      const l = node.leaf;
      if (l.f === "text") return p.text(l.value);
      if (l.f === "kind") return p.kind(l.value);
      if (l.f === "book") return p.book(l.value);
      if (l.f === "status") return p.status(l.value);
      if (l.f === "tag") return p.tag(l.value);
      if (l.f === "type") return p.type(l.value);
      return p.priority(l.op, l.value);
    }
  }
}
function priorityPredicate(rowPriority) {
  return (op, value) => {
    const p = Number(rowPriority) || 0;
    if (op === "<=") return p <= value;
    if (op === ">=") return p >= value;
    if (op === "<") return p < value;
    if (op === ">") return p > value;
    return p === value;
  };
}
function makeCardPredicates(row) {
  let hay = null;
  const getHay = () => hay ??= [
    row.frontMarkdown,
    row.backMarkdown,
    row.noteText,
    row.contextPrefix || "",
    row.docTitle || "",
    ...row.domain ?? [],
    ...row.tags ?? []
  ].join("\n").normalize("NFKC").toLowerCase();
  return {
    text: (v) => valueMatches(getHay(), foldQueryText(v)),
    kind: (v) => v === "card",
    book: (v) => valueMatches(foldQueryText(String(row.docTitle || "")), foldQueryText(v)),
    status: (v) => {
      if (v === "archived" || v === "\u5DF2\u5F52\u6863") return row.status === "archived";
      const s = row.leechSuspended ? "suspended" : row.fsrsState ?? "new";
      return String(s).toLowerCase() === v;
    },
    tag: (v) => (
      // v48.64（D108）：tag 值含 * 时按通配对标签数组逐项匹配；否则层级边界前缀语义（v1/v2 同）
      v.includes("*") ? (row.tags ?? []).some((t) => valueMatches(String(t).toLowerCase(), foldQueryText(v))) : anyTagMatches(row.tags ?? [], v)
    ),
    type: (v) => String(row.cardType || "").toLowerCase() === v,
    priority: priorityPredicate(row.priority)
  };
}
function cardRowMatches(q, row) {
  return evalQueryNode(q.ast, makeCardPredicates(row));
}
function makeExtractPredicates(row) {
  let hay = null;
  const getHay = () => hay ??= `${row.contentMarkdown ?? ""}
${row.docTitle ?? ""}`.toLowerCase();
  return {
    text: (v) => valueMatches(getHay(), foldQueryText(v)),
    kind: (v) => v === "extract",
    book: (v) => valueMatches(foldQueryText(String(row.docTitle || "")), foldQueryText(v)),
    status: (v) => String(row.status ?? "open").toLowerCase() === v,
    tag: (v) => v.includes("*") ? extractTagsOf(row).some((t) => valueMatches(String(t).toLowerCase(), foldQueryText(v))) : anyTagMatches(extractTagsOf(row), v),
    // 摘录行无卡形式——type: 对摘录行恒不命中（D108 ⑦：type: 查询摘录页签恒空＝诚实语义）
    type: () => false,
    priority: priorityPredicate(row.priority)
  };
}
function extractRowMatches(q, row) {
  return evalQueryNode(q.ast, makeExtractPredicates(row));
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
function extractScopeConditions(query) {
  const parsed = parseCardQuery(query);
  return { tags: [...parsed.tag ?? []], bookNames: parsed.book ? [parsed.book] : [] };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  cardRowMatches,
  evalQueryNode,
  extractMatches,
  extractRowMatches,
  extractScopeConditions,
  extractTagsOf,
  foldQueryText,
  makeCardPredicates,
  makeExtractPredicates,
  parseCardQuery,
  statusMatches,
  tagFilterMatches,
  textMatches,
  valueMatches
});
