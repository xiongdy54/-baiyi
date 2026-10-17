"use strict";
// 材料导图 v2 · 行协议流式解析 + 逐行校验（纯函数、零依赖、无随机源）。
// 契约：docs/design/MINDMAP-V2-P0-CONTRACT.md「M2」；设计稿 MINDMAP-V2-FAST-PROGRESSIVE.md §7、§8、§9.1–9.2、§15.3–15.5。
// 行语法：层级号 [类型] 标题 [〈时间〉] @起块-止块 (+|.) [{版式}] [&码目标 …]
// 与提示词 prompt-lab/mindmapV2Prompts.js 定义同一套协议，改一处必须改另一处（tests/m15v2.prompts.test.cjs 守护）。

const { blockTextLength } = require("./mindmapBlocks.js");

const OUTLINE_VERSION = 1;

// §8.1 类型表（「结论」同属论证/证明两族，只列一次）+ 兜底「其他」
const TYPES = [
  "论点", "理由", "证据", "例证", "反方观点", "反驳", "让步", "结论",
  "命题", "前提", "定义", "引理", "推导", "分情形",
  "引言", "背景", "问题", "方案", "分类", "对比", "因果", "步骤", "总结",
  "叙事", "案例",
  "其他",
];
const TYPE_SET = new Set(TYPES);

// §15.3 版式（中文提示 → 英文键）
const PATTERNS = { 树: "tree", 链: "chain", 时间线: "timeline", 分层: "layered", 论证: "argument", 对照: "compare", 网格: "grid" };

// §8.2 关系码
const REL_CODES = ["支", "驳", "据", "推", "因", "比", "例", "答"];
const REL_SET = new Set(REL_CODES);

// §9.2 笼统空盒标题（整题等于其一，或「本章/本节…的」+其一）
const EMPTY_BOX = ["概述", "概要", "概况", "简介", "介绍", "内容", "主要内容", "相关内容", "相关知识", "知识点", "要点", "其他", "其它", "总结", "小结", "基础", "基础知识", "核心", "核心内容", "说明", "补充", "正文", "引言"];
const EMPTY_BOX_RE = new RegExp(`^(?:本[章节篇段部文])?(?:的)?(?:${EMPTY_BOX.join("|")})$`);

const TITLE_MAX = 20;
const REASONS = ["unparsable", "orphan", "out_of_scope", "duplicate", "truncated"];

// 一行的主体正则（预处理后）。标题惰性匹配到最后一个能让行尾整体成立的 @。
//  1 路径  2 类型  3 标题  4 时间  5 起块  6 止块  7 标记  8 版式  9 关系串
const LINE_RE = new RegExp(
  "^(\\d+(?:\\.\\d+)*)\\.?\\s*" +
  "\\[\\s*([^\\]]*?)\\s*\\]\\s*" +
  "(.+?)\\s*" +
  "(?:〈\\s*([^〉]*?)\\s*〉\\s*)?" +
  "@\\s*(\\d+)\\s*(?:[-–—~～－]\\s*(\\d+)\\s*)?" +
  "([+.])" +
  "\\s*(?:\\{\\s*([^}]*?)\\s*\\})?" +
  "\\s*(&.*)?$"
);
const REL_RE = /&\s*([^\s&\d#])\s*(#[A-Za-z0-9_\-]+|\d+(?:\.\d+)*)/g;

function normTitle(s) { return s.replace(/[\s"'“”‘’「」『』《》]/g, ""); }

// 行预处理：去围栏前缀/列表符/缩进，全角符号归一（只归一协议符号；标题内容不改）
function prep(raw) {
  let s = raw.replace(/\r$/, "").replace(/^[\s　]+|[\s　]+$/g, "");
  s = s.replace(/^(?:[-*•]\s+)+/, "");
  s = s.replace(/【/g, "[").replace(/】/g, "]")
    .replace(/＠/g, "@").replace(/＆/g, "&").replace(/｛/g, "{").replace(/｝/g, "}");
  // 标记位的全角写法：@区间 之后紧跟的 ＋ / 。 / ．
  s = s.replace(/(@\s*\d+\s*(?:[-–—~～－]\s*\d+\s*)?)[＋]/, "$1+").replace(/(@\s*\d+\s*(?:[-–—~～－]\s*\d+\s*)?)[。．]/, "$1.");
  return s;
}

function parseLine(s) {
  const m = LINE_RE.exec(s);
  if (!m) return null;
  const segs = m[1].split(".").map(Number);
  if (segs.some((n) => !(n >= 1))) return null;
  const title = m[3].trim();
  if (!title) return null;
  let a = Number(m[5]);
  let b = m[6] != null ? Number(m[6]) : a;
  const warnings = [];
  if (a > b) { const t = a; a = b; b = t; warnings.push("range_reversed"); }
  const rels = [];
  const relStr = m[9] || "";
  REL_RE.lastIndex = 0;
  let r;
  while ((r = REL_RE.exec(relStr))) rels.push({ code: r[1], target: r[2] });
  const relTokens = (relStr.match(/&/g) || []).length;
  return {
    relPath: m[1], segs, rawType: m[2], title, time: m[4] ? m[4] : null,
    from: a, to: b, more: m[7] === "+", rawPattern: m[8] != null ? m[8] : null,
    rels, badRelTokens: relTokens - rels.length, warnings,
  };
}

function createLineParser(opts) {
  const o = opts || {};
  const scope = o.scope || { blockFrom: 1, blockTo: Infinity };
  const basePath = o.basePath ? String(o.basePath) : null;
  const refs = o.refs instanceof Set ? o.refs : new Set(o.refs || []);
  const maxRels = o.maxRelsPerNode != null ? o.maxRelsPerNode : 3;
  const onNode = typeof o.onNode === "function" ? o.onNode : () => {};
  const onDrop = typeof o.onDrop === "function" ? o.onDrop : () => {};
  const onRel = typeof o.onRel === "function" ? o.onRel : () => {};
  const pending = new Map(); // 目标绝对路径 → [{ from, code }]（前向引用，等目标出现）
  let pendingTotal = 0;

  const byReason = {};
  for (const k of REASONS) byReason[k] = 0;
  const stats = { lines: 0, accepted: 0, dropped: 0, byReason, relsDropped: 0, clamped: 0 };
  const seen = new Map(); // 绝对路径 → { from, to }
  const childKeys = new Map(); // 父路径(或 "") → { titles:Set, ranges:Set }
  let buf = "";
  let ended = false;

  const abs = (rel) => (basePath ? `${basePath}.${rel}` : rel);
  const drop = (raw, reason) => { stats.dropped++; byReason[reason]++; onDrop({ raw, reason }); };

  function handle(raw, isResidual) {
    const s = prep(raw);
    if (!s) return;
    if (/^```/.test(s)) return; // 代码围栏行忽略
    stats.lines++;
    const p = parseLine(s);
    if (!p) { drop(raw, isResidual ? "truncated" : "unparsable"); return; }

    const path = abs(p.relPath);
    const parentPath = p.segs.length === 1 ? basePath : abs(p.segs.slice(0, -1).join("."));
    let pr;
    if (p.segs.length === 1) pr = { from: scope.blockFrom, to: scope.blockTo };
    else pr = seen.get(parentPath);
    if (!pr) { drop(raw, "orphan"); return; }
    if (seen.has(path)) { drop(raw, "duplicate"); return; }

    // 区间：落在父区间内；有交集则钳制，无交集丢弃
    const warnings = p.warnings.slice();
    const from = Math.max(p.from, pr.from);
    const to = Math.min(p.to, pr.to);
    if (from > to) { drop(raw, "out_of_scope"); return; }
    if (from !== p.from || to !== p.to) { stats.clamped++; warnings.push("clamped"); }

    // 同父同标题 / 同区间 → 后者丢
    const pk = parentPath == null ? "" : parentPath;
    let ck = childKeys.get(pk);
    if (!ck) { ck = { titles: new Set(), ranges: new Set() }; childKeys.set(pk, ck); }
    const tk = normTitle(p.title);
    const rk = `${from}-${to}`;
    if (ck.titles.has(tk) || ck.ranges.has(rk)) { drop(raw, "duplicate"); return; }

    // 类型
    let type = p.rawType;
    if (!TYPE_SET.has(type)) { warnings.push(`unknown_type:${type}`); type = "其他"; }
    // 版式
    let pattern = null;
    if (p.rawPattern != null) {
      if (Object.prototype.hasOwnProperty.call(PATTERNS, p.rawPattern)) pattern = PATTERNS[p.rawPattern];
      else warnings.push(`unknown_pattern:${p.rawPattern}`);
    }
    // 标题
    if (EMPTY_BOX_RE.test(tk)) warnings.push("empty_box_title");
    if ([...p.title].length > TITLE_MAX) warnings.push("title_long");

    // 关系：目标为 refs 短号或本次路径（前后均可）；自指/重复/超限/未知码/未知短号丢该关系。
    // 目标路径尚未出现 → 挂起（计入每节点上限），目标被接受时经 onRel 补回；end() 时仍未解析的丢弃。
    const rels = [];
    let pendingCount = 0;
    stats.relsDropped += p.badRelTokens;
    for (const r of p.rels) {
      const isRef = r.target[0] === "#";
      const target = isRef ? r.target : abs(r.target);
      const ok = REL_SET.has(r.code)
        && target !== path
        && (!isRef || refs.has(target))
        && !rels.some((x) => x.code === r.code && x.target === target)
        && !pendingFrom(path, r.code, target)
        && rels.length + pendingCount < maxRels;
      if (!ok) { stats.relsDropped++; continue; }
      if (isRef || seen.has(target)) rels.push({ code: r.code, target });
      else { addPending(path, r.code, target); pendingCount++; }
    }

    seen.set(path, { from, to });
    ck.titles.add(tk);
    ck.ranges.add(rk);
    stats.accepted++;
    onNode({
      path, parentPath, type, title: p.title, time: p.time,
      blockFrom: from, blockTo: to, more: p.more, pattern, rels, warnings,
    });
    const waiting = pending.get(path);
    if (waiting) {
      pending.delete(path);
      for (const w of waiting) { pendingTotal--; onRel({ from: w.from, code: w.code, target: path }); }
    }
  }

  function addPending(from, code, target) {
    let arr = pending.get(target);
    if (!arr) { arr = []; pending.set(target, arr); }
    arr.push({ from, code });
    pendingTotal++;
  }
  function pendingFrom(from, code, target) {
    const arr = pending.get(target);
    return !!arr && arr.some((w) => w.from === from && w.code === code);
  }

  function push(chunk) {
    if (ended || chunk == null) return;
    buf += String(chunk);
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      handle(line, false);
    }
  }

  function end() {
    if (!ended) {
      ended = true;
      const rest = buf;
      buf = "";
      if (rest.trim()) handle(rest, true);
      stats.relsDropped += pendingTotal; // 目标从未出现/被丢弃的挂起关系
      pending.clear();
      pendingTotal = 0;
    }
    return { lines: stats.lines, accepted: stats.accepted, dropped: stats.dropped, byReason: Object.assign({}, byReason), relsDropped: stats.relsDropped, clamped: stats.clamped };
  }

  return { push, end };
}

// §7 第 1 道门：本地确定性下限（零调用）。满足任一即不可深挖：
//   区间 = 1 块且 < 300 字；或区间总长 < 120 字；或深度 ≥ 8。
// 第三条「区间内容是单一引文/单一公式块/单一图注」需要块类型，而 M1 Block 只有 heading 标记、
// 没有引文/公式/图注类型——P0 不做，待 M1 增加块类型后在此补上。
function isLocalFloor(range, blocks, depth) {
  const from = Math.min(range.blockFrom, range.blockTo);
  const to = Math.max(range.blockFrom, range.blockTo);
  if ((depth || 0) >= 8) return true;
  const len = blockTextLength(blocks || [], from, to);
  if (len < 120) return true;
  if (to === from && len < 300) return true;
  return false;
}

module.exports = { OUTLINE_VERSION, TYPES, PATTERNS, REL_CODES, TITLE_MAX, createLineParser, isLocalFloor };
