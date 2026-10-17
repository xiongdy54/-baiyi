"use strict";
// 材料导图 v2 · 原文块切分（纯函数、零依赖、无随机源）。
// 契约：docs/design/MINDMAP-V2-P0-CONTRACT.md「M1」；设计稿 MINDMAP-V2-FAST-PROGRESSIVE.md §6.1-3。

const BLOCKS_VERSION = 1;
const DEFAULTS = { maxLen: 600, minLen: 20, headingMax: 40 };
const CJK_END = "。！？；!?;";

function isHigh(c) { return c >= 0xd800 && c <= 0xdbff; }
function isWs(ch) { return /\s/.test(ch); }
function endsWithSentencePunct(s) {
  return s.length > 0 && (CJK_END.includes(s[s.length - 1]) || s[s.length - 1] === ".");
}

// 把 [s,e)（已去首尾空白、长度>maxLen）切成若干 ≤maxLen 的片段
function splitLong(text, s, e, maxLen, out) {
  let pos = s;
  while (pos < e) {
    while (pos < e && isWs(text[pos])) pos++;
    if (pos >= e) break;
    if (e - pos <= maxLen) { out.push([pos, e]); break; }
    const limit = pos + maxLen;
    let cut = -1;
    for (let i = limit - 1; i > pos; i--) {
      const ch = text[i];
      if (CJK_END.includes(ch)) { cut = i + 1; break; }
      if (ch === "." && (i + 1 >= e || isWs(text[i + 1]))) { cut = i + 1; break; }
    }
    if (cut < 0) {
      cut = limit;
      if (isHigh(text.charCodeAt(cut - 1))) cut -= 1; // 不切坏代理对
    }
    let pe = cut;
    while (pe > pos && isWs(text[pe - 1])) pe--;
    out.push([pos, pe]);
    pos = cut;
  }
}

function segmentBlocks(linear, opts) {
  const o = Object.assign({}, DEFAULTS, opts || {});
  const text = typeof linear === "string" ? linear : "";
  // 1. 行 → 片段
  const pieces = []; // {s,e,heading}
  let ls = 0;
  while (ls <= text.length) {
    let le = text.indexOf("\n", ls);
    if (le < 0) le = text.length;
    let s = ls, e = le;
    while (s < e && isWs(text[s])) s++;
    while (e > s && isWs(text[e - 1])) e--;
    if (e > s) {
      const len = e - s;
      if (len <= o.headingMax && !endsWithSentencePunct(text.slice(s, e))) {
        pieces.push({ s, e, heading: true });
      } else if (len > o.maxLen) {
        const parts = [];
        splitLong(text, s, e, o.maxLen, parts);
        for (const [ps, pe] of parts) pieces.push({ s: ps, e: pe, heading: false });
      } else {
        pieces.push({ s, e, heading: false });
      }
    }
    ls = le + 1;
  }
  // 2. 碎块合并
  const res = [];
  let pending = null;
  for (const p of pieces) {
    if (p.heading) {
      if (pending) { res.push(pending); pending = null; }
      res.push(p);
      continue;
    }
    if (pending) {
      if (p.e - pending.s <= o.maxLen) {
        pending = { s: pending.s, e: p.e, heading: false };
        if (pending.e - pending.s >= o.minLen) { res.push(pending); pending = null; }
        continue;
      }
      res.push(pending);
      pending = null;
    }
    if (p.e - p.s < o.minLen) pending = p;
    else res.push(p);
  }
  if (pending) {
    const last = res[res.length - 1];
    if (last && !last.heading && pending.e - last.s <= o.maxLen) last.e = pending.e;
    else res.push(pending);
  }
  return res.map((b, i) => ({ no: i + 1, start: b.s, end: b.e, heading: b.heading }));
}

function pick(blocks, fromNo, toNo) {
  const lo = Math.max(1, Math.min(fromNo, toNo));
  const hi = Math.min(blocks.length, Math.max(fromNo, toNo));
  return lo > hi ? [] : blocks.slice(lo - 1, hi);
}

function renderNumbered(linear, blocks, fromNo, toNo) {
  return pick(blocks, fromNo, toNo)
    .map((b) => `[${b.no}] ${linear.slice(b.start, b.end).replace(/\s*[\r\n]+\s*/g, " ")}`)
    .join("\n");
}

function blockRangeToSpan(blocks, fromNo, toNo) {
  const r = pick(blocks, fromNo, toNo);
  return r.length ? [r[0].start, r[r.length - 1].end] : [0, 0];
}

function blockTextLength(blocks, fromNo, toNo) {
  return pick(blocks, fromNo, toNo).reduce((n, b) => n + (b.end - b.start), 0);
}

// ---- v2 主软件（D192 / X1）：逐单元切块 + 全局编号 ----
// 每个提取单元各自 segmentBlocks（碎块不跨单元合并），坐标按 unitBase 平移到线性化全文，块号全材料递增。
// 因而单元按文档顺序逐个送入时，已送入前缀的块恒等于全量切分的前缀（前缀稳定）。
// linearization＝mindmapCore.buildLinearization 产物 { units, unitBase, text }（单元间 "\n"，D44 UTF-16 坐标）。
// opts：segmentBlocks 选项 + { fromUnit=0, startNo=1 }（增量：只切 fromUnit 起的单元，块号从 startNo 起）。
// 返回 Block[] = { no, start, end, heading, unit /* 单元下标 */ }。
const UNIT_BLOCKS_VERSION = 1;

function segmentUnits(linearization, opts) {
  const lin = linearization || {};
  const units = Array.isArray(lin.units) ? lin.units : [];
  const bases = Array.isArray(lin.unitBase) ? lin.unitBase : [];
  const text = typeof lin.text === "string" ? lin.text : "";
  const o = opts || {};
  const fromUnit = Math.max(0, Math.floor(Number(o.fromUnit) || 0));
  let no = Math.max(1, Math.floor(Number(o.startNo) || 1));
  const out = [];
  for (let i = fromUnit; i < units.length; i++) {
    const base = bases[i];
    if (!(base >= 0)) continue;
    const end = i + 1 < units.length && bases[i + 1] >= base ? bases[i + 1] - 1 : text.length;
    const slice = text.slice(base, Math.max(base, end));
    for (const b of segmentBlocks(slice, o)) {
      out.push({ no: no++, start: b.start + base, end: b.end + base, heading: b.heading, unit: i });
    }
  }
  return out;
}

module.exports = { BLOCKS_VERSION, UNIT_BLOCKS_VERSION, segmentBlocks, segmentUnits, renderNumbered, blockRangeToSpan, blockTextLength };
