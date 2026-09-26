// 批注范围锚（规格 docs/impl-spec/ANNOTATION-MULTISELECT.md §2 / 待登记 D61）：
// 锚点是「一段被标记的字符区间」，不是那段文字——所以卡片正文怎么改，锚都还在。
// 纯函数、零 electron 依赖（node 测试直接 require）；写入口在 db.updateExtract。
//
// 端点规则（用户 2026-09-25 拍死）：插入点落在 [start, end] 闭区间内一律继承（区间变长）；
// 落在 start 之前区间整体右移、落在 end 之后不动——两者都不继承。
"use strict";

const MIN_ANCHOR = 3; // 公共片段短于此值不再当锚点拆分，避免把无关字符当锚把一条编辑切成碎片
const SPLIT_BUDGET = 400000; // 最长公共子串 DP 的规模上限（超限退化为一条替换，见 §9 已知限制）

/** 找最长公共子串，返回在 a/b 中的起点与长度（超预算返回 null） */
function longestCommonSubstring(a, b) {
  if (a.length * b.length > SPLIT_BUDGET) return null;
  let best = { ai: 0, bi: 0, len: 0 };
  let prev = new Uint32Array(b.length + 1);
  let cur = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? prev[j - 1] + 1 : 0;
      if (cur[j] > best.len) best = { ai: i - cur[j], bi: j - cur[j], len: cur[j] };
    }
    const t = prev; prev = cur; cur = t;
  }
  return best;
}

/** 递归拆分：以最长公共子串为锚，把中段切成若干条「替换」编辑（old 坐标） */
function splitEdits(aMid, bMid, offset, out) {
  if (!aMid.length && !bMid.length) return;
  if (!aMid.length || !bMid.length) {
    out.push({ start: offset, end: offset + aMid.length, text: bMid });
    return;
  }
  const lcs = longestCommonSubstring(aMid, bMid);
  if (!lcs || lcs.len < MIN_ANCHOR) {
    out.push({ start: offset, end: offset + aMid.length, text: bMid });
    return;
  }
  splitEdits(aMid.slice(0, lcs.ai), bMid.slice(0, lcs.bi), offset, out);
  splitEdits(aMid.slice(lcs.ai + lcs.len), bMid.slice(lcs.bi + lcs.len), offset + lcs.ai + lcs.len, out);
}

/**
 * 求编辑脚本：公共前后缀 + 最长公共子串递归拆分。
 * 返回 [{start, end, text}]，坐标为 **旧文本** 坐标；text 为空串即纯删除。
 * 相隔的多次编辑能拆成多条；极端交错编辑会退化为一条宽替换（§9 已登记）。
 */
function diffEdits(oldText, newText) {
  const a = String(oldText ?? "");
  const b = String(newText ?? "");
  if (a === b) return [];
  let p = 0;
  const maxP = Math.min(a.length, b.length);
  while (p < maxP && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  let s = 0;
  const maxS = Math.min(a.length - p, b.length - p);
  while (s < maxS && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  const out = [];
  splitEdits(a.slice(p, a.length - s), b.slice(p, b.length - s), p, out);
  return out;
}

/** 纯删除/纯插入对单个区间的变换（n>0 且 d>0 时由 transformRange 组合调用） */
function shiftRange(range, p, oldLen, newLen) {
  const r = { start: range.start, end: range.end };
  if (newLen > 0) {
    // 插入：p < start → 整体右移；start <= p <= end → 拉长；p > end → 不动
    if (p < r.start) { r.start += newLen; r.end += newLen; }
    else if (p <= r.end) { r.end += newLen; }
    return r;
  }
  const q = p + oldLen;
  if (q <= r.start) { r.start -= oldLen; r.end -= oldLen; return r; }
  if (p >= r.end) return r;
  const deletedBefore = Math.max(0, Math.min(q, r.start) - p);
  const deletedInside = Math.max(0, Math.min(q, r.end) - Math.max(p, r.start));
  const span = r.end - r.start - deletedInside;
  r.start -= deletedBefore;
  r.end = r.start + Math.max(0, span);
  return r;
}

/** 单条编辑作用于单个区间；替换＝先删后插（与 §2.2 表格逐行等价） */
function transformRange(range, edit) {
  const oldLen = Math.max(0, edit.end - edit.start);
  const text = String(edit.text ?? "");
  let r = shiftRange(range, edit.start, oldLen, 0);
  if (text.length) r = shiftRange(r, edit.start, 0, text.length);
  return r;
}

/** 规范化：clamp 到 [0, len]、丢弃空区间、按起点排序并合并重叠或相接的区间 */
function normalizeRanges(ranges, len) {
  const list = (Array.isArray(ranges) ? ranges : [])
    .map((r) => ({
      start: Math.max(0, Math.min(len, Math.floor(Number(r && r.start) || 0))),
      end: Math.max(0, Math.min(len, Math.ceil(Number(r && r.end) || 0)))
    }))
    .filter((r) => r.end > r.start)
    .sort((x, y) => x.start - y.start || x.end - y.end);
  const merged = [];
  for (const r of list) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}

/**
 * 全量重映射：多区间 × 编辑脚本。
 * 返回 { ranges, dropped }——dropped 是"被删空"的区间数；全部落空即摘录降级为无锚（§2.2 末行）。
 */
function transformRanges(ranges, oldText, newText) {
  const edits = diffEdits(oldText, newText);
  const before = normalizeRanges(ranges, String(oldText ?? "").length);
  if (edits.length === 0) return { ranges: before, dropped: 0 };
  const moved = before.map((r) => edits.reduce((acc, e) => transformRange(acc, e), r));
  const after = normalizeRanges(moved, String(newText ?? "").length);
  return { ranges: after, dropped: Math.max(0, before.length - after.length) };
}

/**
 * 多段不相邻选择 → 一条批注的载荷（规格 §3 / D61）。
 * 渲染层只负责采集 spans（每段：{text, rects?}，DOM 顺序不必保证），装配一律在这里做，
 * 于是"多段"与"单段"共用同一条区间语义（一条批注可有多组 rects + 多段区间）。
 * 段间分隔符：默认两个换行——单 \n 在 markdown 里是软换行（同一段），
 * 而"两处不相邻的文字"在语义上是两段，故取段落边界。分隔符长度计入区间偏移。
 */
const SPAN_SEP = "\n\n";

/** 归一：去空白段、按文本+首矩形去重（同一段被重复采集）；不改写入参 */
function normalizeSpans(spans) {
  const seen = new Set();
  const out = [];
  for (const s of Array.isArray(spans) ? spans : []) {
    const text = String((s && s.text) ?? "").trim();
    if (!text) continue;
    const key = text + "|" + JSON.stringify((s && s.rects) ? s.rects[0] || null : null);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text, rects: Array.isArray(s && s.rects) ? s.rects : [] });
  }
  return out;
}

/**
 * 装配载荷：{ text, quoteRange, rects, count }。
 * quoteRange 是相对**拼接后文本**的区间（正是 db 侧要落的 quote_range_json）；
 * rects 按段序展开并带 ord，跳原文时多组矩形一次全高亮。
 */
function buildSpanPayload(spans, sep = SPAN_SEP) {
  const list = normalizeSpans(spans);
  const quoteRange = [];
  const rects = [];
  let cursor = 0;
  let ord = 0;
  for (const s of list) {
    quoteRange.push({ start: cursor, end: cursor + s.text.length });
    for (const r of s.rects) rects.push({ ...r, ord: ord++ });
    cursor += s.text.length + sep.length;
  }
  const text = list.map((s) => s.text).join(sep);
  return { text, quoteRange: normalizeRanges(quoteRange, text.length), rects, count: list.length };
}

/**
 * 加选的集合运算（规格 §3）：给定「已积累的 spans」与「本次新选区」，按修饰键决定动作。
 * 不持有 DOM：调用方（渲染层）只管把 kernel 给的选区语义对象传进来，返回的 spans 由它去渲染高亮。
 * 语义：不带修饰键＝替换（普通拖选覆盖旧集合）；带修饰键＝追加；**新选区与已有一段等价时＝取消那一段**（再次点同一段＝移出）。
 * 等价判据＝文本 + 首个矩形（同一段被采集两次必然文本与首矩形一致）。
 */
function spanKey(s) {
  const r = s && Array.isArray(s.rects) && s.rects.length ? s.rects[0] : null;
  return String((s && s.text) ?? "").trim() + "|" + JSON.stringify(r);
}

function updateSpanSet(current, incoming, opts = {}) {
  const withModifier = Boolean(opts.modifier);
  const cur = normalizeSpans(current);
  const next = normalizeSpans([incoming]);
  if (!next.length) return { spans: cur, action: "none" };
  if (!withModifier) return { spans: next, action: "replace" };
  const key = spanKey(next[0]);
  const hit = cur.findIndex((s) => spanKey(s) === key);
  if (hit >= 0) return { spans: cur.filter((_, i) => i !== hit), action: "remove" };
  return { spans: [...cur, next[0]], action: "append" };
}

module.exports = { diffEdits, transformRange, transformRanges, normalizeRanges, longestCommonSubstring, normalizeSpans, buildSpanPayload, updateSpanSet, SPAN_SEP };
