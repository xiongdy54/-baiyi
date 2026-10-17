"use strict";
// 导图 v2 基准页 · 纯函数集合（无 Electron / 无 IO 依赖，node 可直接测：tests/m15v2.bench.test.cjs）。
// 设计稿：docs/design/MINDMAP-V2-FAST-PROGRESSIVE.md §6.1-4（作用域划分）、§11（KPI 口径）。

const SMALL_CHAPTER = 800; // <800 字的章并入相邻章
const BIG_CHAPTER = 20000; // 多章时 >2 万字的章按块边界切
const SPLIT_MAX = 12000; // 切分后每个子 scope ≤1.2 万字
const SINGLE_MAX = 15000; // 单章且 ≤1.5 万字 → 一个 scope

// ───────────────────────── 材料文本 ─────────────────────────

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  mdash: "—", ndash: "–", hellip: "…", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  laquo: "«", raquo: "»", middot: "·", bull: "•", copy: "©", reg: "®", times: "×", divide: "÷",
  deg: "°", plusmn: "±", sect: "§", para: "¶", zwnj: "", zwj: "", shy: "",
};

function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/g, (m, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
      try { return String.fromCodePoint(code); } catch { return ""; }
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : m;
  });
}

const BLOCK_TAGS = "p|div|h[1-6]|li|ul|ol|dl|dt|dd|tr|table|thead|tbody|section|article|blockquote|pre|br|hr|figure|figcaption|header|footer|aside|main|body|html|title";

// xhtml → 纯文本：块级元素换行、去标签、解实体；每个非空行是一个段落（单个 "\n" 分隔）。
function htmlToText(html) {
  let s = String(html == null ? "" : html);
  s = s.replace(/<\?[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  s = s.replace(/<(script|style|head|svg|math)\b[\s\S]*?<\/\1\s*>/gi, "");
  s = s.replace(new RegExp(`</?(?:${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n");
  s = s.replace(/<\/?(?:td|th)\b[^>]*>/gi, " ");
  s = s.replace(/<[^>]*>/g, "");
  s = decodeEntities(s).replace(/\u00a0/g, " ").replace(/\r/g, "");
  return s.split("\n").map((l) => l.replace(/[ \t　]+/g, " ").trim()).filter(Boolean).join("\n");
}

// 首个 h1–h3 的文本（≤40 字）；没有则 null
function firstHeading(html) {
  const m = /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]\s*>/i.exec(String(html || ""));
  if (!m) return null;
  const t = htmlToText(m[1]).replace(/\n/g, " ").trim();
  if (!t) return null;
  return [...t].slice(0, 40).join("");
}

// htmlList: string[]（spine 顺序）→ [{ title, text }]；空章跳过；无 h1–h3 → 「第 i 部分」（i 为保留章中的序号）
function buildChaptersFromHtml(htmlList) {
  const out = [];
  for (const html of htmlList || []) {
    const text = htmlToText(html);
    if (!text) continue;
    out.push({ title: firstHeading(html) || `第 ${out.length + 1} 部分`, text });
  }
  return out;
}

function attr(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? decodeEntities(m[2] != null ? m[2] : m[3]) : null;
}

// META-INF/container.xml → OPF 的 zip 内路径
function parseContainerXml(xml) {
  const m = /<rootfile\b[^>]*>/i.exec(String(xml || ""));
  return m ? attr(m[0], "full-path") : null;
}

function posixJoin(dir, rel) {
  const parts = (dir ? dir.split("/") : []).concat(String(rel).split("/"));
  const out = [];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

// OPF → spine 顺序的 zip 内路径（只取 xhtml/html 类条目；href 做 URI 解码并相对 OPF 目录归一）
function parseOpfSpine(opfXml, opfPath) {
  const xml = String(opfXml || "");
  const dir = String(opfPath || "").includes("/") ? String(opfPath).slice(0, String(opfPath).lastIndexOf("/")) : "";
  const manifest = new Map();
  for (const m of xml.matchAll(/<item\b[^>]*>/gi)) {
    const id = attr(m[0], "id"), href = attr(m[0], "href"), type = attr(m[0], "media-type") || "";
    if (id && href) manifest.set(id, { href, type });
  }
  const out = [];
  for (const m of xml.matchAll(/<itemref\b[^>]*>/gi)) {
    const idref = attr(m[0], "idref");
    const item = idref && manifest.get(idref);
    if (!item) continue;
    if (!/x?html/i.test(item.type) && !/\.x?html?$/i.test(item.href)) continue;
    let href = item.href.split("#")[0];
    try { href = decodeURIComponent(href); } catch { /* 保持原样 */ }
    out.push(posixJoin(dir, href));
  }
  return out;
}

// zip：{ file(name) → { async(type) → Promise<string> } | null }（JSZip 实例满足）
async function chaptersFromEpubZip(zip) {
  const read = async (name) => {
    const f = zip.file(name);
    if (!f) throw new Error(`EPUB 缺少文件：${name}`);
    return f.async("string");
  };
  const opfPath = parseContainerXml(await read("META-INF/container.xml"));
  if (!opfPath) throw new Error("EPUB 的 container.xml 里没有找到 OPF 路径");
  const hrefs = parseOpfSpine(await read(opfPath), opfPath);
  if (!hrefs.length) throw new Error("EPUB 的 spine 为空");
  const htmls = [];
  for (const h of hrefs) {
    try { htmls.push(await read(h)); } catch { /* 个别缺失的章跳过 */ }
  }
  const chapters = buildChaptersFromHtml(htmls);
  if (!chapters.length) throw new Error("EPUB 中没有可提取的正文");
  return chapters;
}

// 全材料线性化：各章以 "\n\n" 连接。spans 为每章在 linear 中的 [start,end)。
function linearize(chapters) {
  const parts = [], spans = [];
  let pos = 0;
  for (const c of chapters) {
    const t = String(c.text || "").trim();
    if (!t) continue;
    if (parts.length) pos += 2;
    spans.push({ start: pos, end: pos + t.length, title: c.title });
    parts.push(t);
    pos += t.length;
  }
  return { linear: parts.join("\n\n"), spans };
}

// ───────────────────────── 作用域规划（设计稿 §6.1-4） ─────────────────────────

function blockChars(blocks, from, to) {
  let n = 0;
  for (let i = Math.max(1, from); i <= Math.min(blocks.length, to); i++) n += blocks[i - 1].end - blocks[i - 1].start;
  return n;
}

// 按块边界贪心切成每段 ≤maxChars（至少含一块）
function splitByBlocks(blocks, from, to, maxChars) {
  const out = [];
  let curFrom = from, acc = 0;
  for (let no = from; no <= to; no++) {
    const len = blocks[no - 1].end - blocks[no - 1].start;
    if (acc > 0 && acc + len > maxChars) {
      out.push({ from: curFrom, to: no - 1, chars: acc });
      curFrom = no; acc = 0;
    }
    acc += len;
  }
  if (to >= curFrom) out.push({ from: curFrom, to, chars: acc });
  return out;
}

function mergedTitle(titles) {
  const s = titles.join("、");
  const a = [...s];
  return a.length > 24 ? a.slice(0, 24).join("") + "…" : s;
}

// 输入：chapters（原始章，含 text）；blocks 为对 linearize(chapters).linear 做一次 segmentBlocks 得到的全局块。
// 输出：scopes = [{ id:'c1', index, title, blockFrom, blockTo, chars, blocks }]
function planScopes(chapters, blocks, lin) {
  const L = lin || linearize(chapters);
  const spans = L.spans;
  if (!blocks.length || !spans.length) return [];
  // 1. 块 → 章（按块起点落在哪一章）
  const chs = spans.map((s) => ({ title: s.title, from: 0, to: -1, chars: 0 }));
  let ci = 0;
  blocks.forEach((b, i) => {
    while (ci < spans.length - 1 && b.start >= spans[ci].end) ci++;
    const c = chs[ci];
    if (!c.from) c.from = i + 1;
    c.to = i + 1;
    c.chars += b.end - b.start;
  });
  const live = chs.filter((c) => c.from > 0);
  const raw = [];
  if (live.length === 1) {
    const c = live[0];
    if (c.chars <= SINGLE_MAX) raw.push({ title: c.title, from: c.from, to: c.to, chars: c.chars });
    else splitByBlocks(blocks, c.from, c.to, SPLIT_MAX).forEach((p, k, a) => raw.push({ title: `${c.title}（${k + 1}/${a.length}）`, ...p }));
  } else {
    // 2. <800 字并入相邻章（先并入前一组；若前一组本身 <800 则被后一章吸收）
    const groups = [];
    for (const c of live) {
      const last = groups[groups.length - 1];
      if (last && (c.chars < SMALL_CHAPTER || last.chars < SMALL_CHAPTER)) {
        last.to = c.to; last.chars += c.chars; last.titles.push(c.title);
      } else groups.push({ titles: [c.title], from: c.from, to: c.to, chars: c.chars });
    }
    // 3. >2 万字切成 ≤1.2 万字
    for (const g of groups) {
      const title = mergedTitle(g.titles);
      if (g.chars > BIG_CHAPTER) splitByBlocks(blocks, g.from, g.to, SPLIT_MAX).forEach((p, k, a) => raw.push({ title: `${title}（${k + 1}/${a.length}）`, ...p }));
      else raw.push({ title, from: g.from, to: g.to, chars: g.chars });
    }
  }
  return raw.map((s, i) => ({ id: `c${i + 1}`, index: i + 1, title: s.title, blockFrom: s.from, blockTo: s.to, chars: s.chars, blocks: s.to - s.from + 1 }));
}

// ───────────────────────── 指标汇总与 KPI（设计稿 §11） ─────────────────────────

const REASONS = ["unparsable", "orphan", "out_of_scope", "duplicate", "truncated"];

function percentile(values, p) {
  const a = values.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * a.length));
  return a[Math.min(a.length, rank) - 1];
}
const sum = (arr) => arr.reduce((n, v) => n + (Number.isFinite(v) ? v : 0), 0);

// calls: 逐调用记录（字段见 mindmapBenchRunner.js 的 makeCallRecord）
// opts: { wallMs（outline 阶段总墙钟）, outlineComplete, tree: { total, plus } }
function summarizeRun(calls, opts) {
  const o = opts || {};
  const cs = calls || [];
  const outline = cs.filter((c) => c.kind === "outline");
  const expand = cs.filter((c) => c.kind === "expand");
  const explain = cs.filter((c) => c.kind === "explain");
  const parsed = outline.concat(expand);
  const byReason = {};
  for (const k of REASONS) byReason[k] = sum(parsed.map((c) => (c.byReason && c.byReason[k]) || 0));
  const lines = sum(parsed.map((c) => c.lines));
  const dropped = sum(parsed.map((c) => c.dropped));
  // 全局 TTFN：各 outline 调用 (相对 run 起点的开始偏移 + 调用内 TTFN) 的最小值
  let ttfn = null, gap = null;
  for (const c of outline) {
    if (!Number.isFinite(c.ttfnMs)) continue;
    const t = (Number.isFinite(c.startOffsetMs) ? c.startOffsetMs : 0) + c.ttfnMs;
    if (ttfn == null || t < ttfn) { ttfn = t; gap = Number.isFinite(c.ttftMs) ? c.ttfnMs - c.ttftMs : null; }
  }
  const expandMs = expand.filter((c) => !c.error).map((c) => c.totalMs);
  const treeTotal = o.tree && Number.isFinite(o.tree.total) ? o.tree.total : null;
  const plus = o.tree && Number.isFinite(o.tree.plus) ? o.tree.plus : null;
  const promptTokens = sum(cs.map((c) => c.promptTokens)), completionTokens = sum(cs.map((c) => c.completionTokens));
  return {
    wallMs: Number.isFinite(o.wallMs) ? o.wallMs : null,
    outlineComplete: Boolean(o.outlineComplete),
    ttfnMs: ttfn,
    ttfnOverTtftMs: gap,
    calls: cs.length, outlineCalls: outline.length, expandCalls: expand.length, explainCalls: explain.length,
    errors: cs.filter((c) => c.error).length,
    promptTokens, completionTokens, totalTokens: promptTokens + completionTokens,
    nodes: sum(parsed.map((c) => c.accepted)),
    treeNodes: treeTotal, plusNodes: plus,
    plusRatio: treeTotal ? (plus || 0) / treeTotal : null,
    lines, dropped, dropRate: lines ? dropped / lines : null, byReason,
    relsDropped: sum(parsed.map((c) => c.relsDropped)), clamped: sum(parsed.map((c) => c.clamped)),
    expandP50Ms: percentile(expandMs, 50), expandP90Ms: percentile(expandMs, 90),
    expandZeroRate: expand.length ? expand.filter((c) => !c.error && !c.accepted).length / expand.length : null,
  };
}

// KPI 判定。status：pass / fail / na（无数据或口径不适用）。目标取设计稿 §11（快模型）。
function judgeKpi(summary, ctx) {
  const s = summary || {};
  const chars = ctx && Number.isFinite(ctx.chars) ? ctx.chars : null;
  const mk = (key, label, target, value, ok, fmt) => ({
    key, label, target,
    value: value == null ? null : value,
    valueText: value == null ? "—" : fmt(value),
    status: value == null || ok == null ? "na" : ok ? "pass" : "fail",
  });
  const ms = (v) => (v >= 10000 ? `${(v / 1000).toFixed(1)}s` : `${(v / 1000).toFixed(2)}s`);
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  const frameworkApplicable = s.outlineComplete && s.wallMs != null && chars != null && chars <= 3000;
  return [
    mk("framework", "框架完整（基准文章 ≤3,000 字）", "≤30s", frameworkApplicable ? s.wallMs : null, frameworkApplicable ? s.wallMs <= 30000 : null, ms),
    mk("ttfn", "TTFN 减 TTFT", "≤1.5s", s.ttfnOverTtftMs, s.ttfnOverTtftMs == null ? null : s.ttfnOverTtftMs <= 1500, ms),
    mk("expandP50", "单次深挖 P50", "≤8s", s.expandP50Ms, s.expandP50Ms == null ? null : s.expandP50Ms <= 8000, ms),
    mk("expandP90", "单次深挖 P90", "≤15s", s.expandP90Ms, s.expandP90Ms == null ? null : s.expandP90Ms <= 15000, ms),
    mk("zeroRate", "零产出深挖率", "≤5%", s.expandZeroRate, s.expandZeroRate == null ? null : s.expandZeroRate <= 0.05, pct),
    mk("dropRate", "丢弃行率", "≤3%", s.dropRate, s.dropRate == null ? null : s.dropRate <= 0.03, pct),
  ];
}

// ───────────────────────── CSV ─────────────────────────

function csvCell(v) {
  if (v == null) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  // 防 CSV 公式注入：以 = + - @ 开头的文本前补单引号（纯数字不处理）
  if (typeof v === "string" && /^[=+\-@]/.test(s) && !/^[-+]?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// columns: [{ key, title }]；rows: object[]。返回 CRLF 换行字符串（不含 BOM）。
function toCsv(rows, columns) {
  const out = [columns.map((c) => csvCell(c.title)).join(",")];
  for (const r of rows || []) out.push(columns.map((c) => csvCell(r[c.key])).join(","));
  return out.join("\r\n") + "\r\n";
}

const RUN_COLUMNS = [
  { key: "runId", title: "runId" }, { key: "time", title: "时间" }, { key: "material", title: "材料" }, { key: "chars", title: "字数" },
  { key: "blocks", title: "块数" }, { key: "scopes", title: "scope数" }, { key: "concurrency", title: "并发" },
  { key: "preset", title: "服务预设" }, { key: "model", title: "模型" },
  { key: "wallMs", title: "框架墙钟ms" }, { key: "ttfnMs", title: "全局TTFN ms" }, { key: "calls", title: "调用数" },
  { key: "promptTokens", title: "prompt tokens" }, { key: "completionTokens", title: "completion tokens" }, { key: "totalTokens", title: "总tokens" },
  { key: "nodes", title: "节点数" }, { key: "lines", title: "行数" }, { key: "dropped", title: "丢弃行" }, { key: "dropRate", title: "丢弃行率" },
  { key: "plusRatio", title: "+节点占比" }, { key: "expandCalls", title: "深挖次数" }, { key: "expandP50Ms", title: "深挖P50 ms" }, { key: "expandP90Ms", title: "深挖P90 ms" },
  { key: "expandZeroRate", title: "零产出深挖率" }, { key: "relsDropped", title: "关系丢弃" }, { key: "errors", title: "错误调用数" },
];

const CALL_COLUMNS = [
  { key: "runId", title: "runId" }, { key: "time", title: "时间" }, { key: "kind", title: "类型" }, { key: "key", title: "scope/节点" },
  { key: "preset", title: "服务预设" }, { key: "model", title: "模型" }, { key: "sentChars", title: "发送字数" }, { key: "blocks", title: "块数" },
  { key: "startOffsetMs", title: "起点偏移ms" }, { key: "firstByteMs", title: "firstByte ms" }, { key: "ttftMs", title: "TTFT ms" }, { key: "ttfnMs", title: "TTFN ms" }, { key: "totalMs", title: "总耗时ms" },
  { key: "promptTokens", title: "prompt tokens" }, { key: "completionTokens", title: "completion tokens" }, { key: "finishReason", title: "finishReason" },
  { key: "lines", title: "行数" }, { key: "accepted", title: "接受" }, { key: "dropped", title: "丢弃" },
  { key: "unparsable", title: "unparsable" }, { key: "orphan", title: "orphan" }, { key: "out_of_scope", title: "out_of_scope" }, { key: "duplicate", title: "duplicate" }, { key: "truncated", title: "truncated" },
  { key: "relsDropped", title: "关系丢弃" }, { key: "clamped", title: "钳制" }, { key: "error", title: "错误" },
];

function isoLocal(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// run 记录（jsonl 里 type:'run'）→ CSV 行
function runToRow(r) {
  const s = r.summary || {};
  return Object.assign({
    runId: r.runId, time: isoLocal(r.ts), material: r.material, chars: r.chars, blocks: r.blocks, scopes: r.scopes, concurrency: r.concurrency,
    preset: r.preset, model: r.model,
  }, s);
}
function callToRow(c) {
  const br = c.byReason || {};
  return Object.assign({}, c, { time: isoLocal(c.ts), unparsable: br.unparsable, orphan: br.orphan, out_of_scope: br.out_of_scope, duplicate: br.duplicate, truncated: br.truncated });
}

// ───────────────────────── 历史（jsonl 折叠） ─────────────────────────

// jsonl 文本 → { runs: [最新 run 记录，按时间倒序], calls: Map<runId, call[]> }；坏行跳过。
// 同一 runId 的 run 记录会被后来者覆盖（深挖/explain 之后汇总会被重写）。
function foldHistory(text) {
  const runs = new Map(), calls = new Map();
  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!rec || !rec.runId) continue;
    if (rec.type === "run") runs.set(rec.runId, rec);
    else if (rec.type === "call") {
      if (!calls.has(rec.runId)) calls.set(rec.runId, []);
      calls.get(rec.runId).push(rec);
    }
  }
  return { runs: [...runs.values()].sort((a, b) => b.ts - a.ts), calls };
}

module.exports = {
  SMALL_CHAPTER, BIG_CHAPTER, SPLIT_MAX, SINGLE_MAX, REASONS,
  decodeEntities, htmlToText, firstHeading, buildChaptersFromHtml,
  parseContainerXml, parseOpfSpine, chaptersFromEpubZip, posixJoin,
  linearize, splitByBlocks, planScopes, blockChars,
  percentile, summarizeRun, judgeKpi,
  csvCell, toCsv, RUN_COLUMNS, CALL_COLUMNS, runToRow, callToRow, isoLocal, foldHistory,
};
