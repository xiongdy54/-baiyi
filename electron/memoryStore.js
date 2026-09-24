// 用户记忆文件树（v45，M14-UM1，D39 / §4.18-2/-3/-12）：真源 = <userData>/memory/ 下的 Markdown
// 文件树——本项目首个非 DB 的用户数据真源。本模块是文件读写与 op 执行的**唯一**层，两条硬性：
// ① 不删、不改写（§4.18-12）：AI op 词表封闭于追加与标记，执行一律精确文本匹配，匹配不到即跳过
//    并把原因写入 memory_runs.applied_json，绝不整文件重写（用户外部编辑过的内容因此永不丢失）；
// ② 手写区保护：<!-- 用户手写区 --> … <!-- /用户手写区 --> 之间的行，任何 op 不可命中、不可追加落内。
// 本模块零 Electron 依赖（纯 node），可被 tests/m14.test.cjs 直连单测。
const fs = require("fs");
const path = require("path");

const MEMORY_DIR_NAME = "memory";
const CORE_FILE = "core.md";
const INDEX_FILE = "index.md";
const TOPICS_DIR = "topics";
// 生活域封闭 9 分类（§4.18-5：WHOQOL / 个人幸福指数 / DISE / PERMA 并集收敛；改动须先改文档）
const LIFE_DOMAINS = [
  "工作与学业",
  "人际与家庭",
  "情绪与状态",
  "健康与作息",
  "财务与生活",
  "兴趣与见闻",
  "成长与目标",
  "观念与价值",
  "其他"
];
const HANDWRITTEN_OPEN = "<!-- 用户手写区 -->";
const HANDWRITTEN_CLOSE = "<!-- /用户手写区 -->";
// mark op 合法标记前缀（「已并入」由 merge op 内部使用，mark 只许后三种）
const MARK_TAGS = ["已被取代", "已结束", "已移至"];
// add op 的合法 target：core 或 topics/<生活域>/<主题>.md（index.md 由系统自动登记，AI 不可写）
const TARGET_CORE = "core";
const TARGET_TOPIC_RE = /^topics\/([^/]+)\/([^/]+)\.md$/;

// token 粗估：与 db.js estimateTokens 同源（CJK ≈ 0.7 token/字，ASCII ≈ 0.25/字符；仅预算用）
function estimateTokens(text) {
  const t = String(text || "");
  const cjk = (t.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  return Math.ceil(cjk * 0.7 + (t.length - cjk) * 0.25);
}

function resolveMemoryDir(userDataDir) {
  return path.join(String(userDataDir), MEMORY_DIR_NAME);
}

// ---------- 脚手架 ----------

// 手写区可见引导（v45.1 用户反馈）：`<!-- -->` 是 HTML 注释，Markdown 预览里**不显示**，
// 用户打开文件只见「请写在用户手写区内」却找不到区域在哪。因此把引导文字放在两行标记**之间**
// ——渲染时可见，且位于手写区内（AI 永不改动）；标记本身只作为程序识别锚。
const HANDWRITTEN_HINT = "（这里是用户手写区：可自由增删改本区域内的内容；上一行与下两行以 <!-- 开头的「用户手写区」「/用户手写区」标记是程序识别用的锚点，请保留——渲染预览中标记本身不可见，以本段文字为准。）";

const CORE_SCAFFOLD = `# 记忆 · 长期稳定事实

本文件由软件的 AI 自动维护（只追加、不删改），条目一行一条：- 日期 ｜ 一句话陈述 ｜ [生活域 · 子主题]。
可用任意编辑器直接修改；「用户手写区」内的内容 AI 永不改动。

<!-- 用户手写区 -->

${HANDWRITTEN_HINT}

<!-- /用户手写区 -->
`;

const INDEX_SCAFFOLD = `# 记忆 · 目录

生活域 → 主题文件（主题 · 条数 · 日期区间）。本文件的目录区由系统按主题文件自动登记；
如需手写备注，请写在「用户手写区」内。

<!-- 用户手写区 -->

${HANDWRITTEN_HINT}

<!-- /用户手写区 -->
`;

function topicScaffold(topic) {
  return `# ${topic}\n\n`;
}

// 缺什么建什么（已存在的一律不动）；返回新建相对路径清单
function ensureTree(dir) {
  const created = [];
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    created.push(MEMORY_DIR_NAME);
  }
  const topicsDir = path.join(dir, TOPICS_DIR);
  if (!fs.existsSync(topicsDir)) {
    fs.mkdirSync(topicsDir, { recursive: true });
    created.push(`${TOPICS_DIR}/`);
  }
  const corePath = path.join(dir, CORE_FILE);
  if (!fs.existsSync(corePath)) {
    fs.writeFileSync(corePath, CORE_SCAFFOLD, "utf8");
    created.push(CORE_FILE);
  }
  const indexPath = path.join(dir, INDEX_FILE);
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(indexPath, INDEX_SCAFFOLD, "utf8");
    created.push(INDEX_FILE);
  }
  // v45.1 升级：v45 初版脚手架的手写区只有 HTML 注释标记（Markdown 预览不可见），用户找不到区域。
  // 对「区域为空且无引导文字」的存量文件补一行可见引导；用户已写过内容的不动。
  for (const rel of [CORE_FILE, INDEX_FILE]) {
    const p = path.join(dir, rel);
    try {
      const text = fs.readFileSync(p, "utf8");
      if (text.includes(HANDWRITTEN_HINT)) continue;
      const lines = splitLines(text);
      const openIdx = lines.findIndex((l) => l.trim() === HANDWRITTEN_OPEN);
      if (openIdx < 0) continue;
      let closeIdx = -1;
      for (let i = openIdx + 1; i < lines.length; i++) {
        if (lines[i].trim() === HANDWRITTEN_CLOSE) { closeIdx = i; break; }
      }
      if (closeIdx < 0) continue;
      const between = lines.slice(openIdx + 1, closeIdx);
      if (between.some((l) => l.trim())) continue; // 用户已写内容：绝不触碰
      const next = [...lines.slice(0, openIdx + 1), "", HANDWRITTEN_HINT, "", ...lines.slice(closeIdx)];
      fs.writeFileSync(p, next.join("\n"), "utf8");
    } catch { /* 单文件升级失败不阻塞 */ }
  }
  return created;
}

// 重置（设置页「重置记忆」，用户主动触发；二次确认在 UI 层）——清空整个 memory/ 并重建脚手架
function resetMemory(dir) {
  // D-TEST-76：原来是 `rmSync(dir)` 直接抹掉——手写区是这个功能里**唯一不可再生**的内容
  // （其余都由 AI 重新生成），而它此前没有任何备份路径（实测 reset 前 3 个文件、之后只剩 2 个，
  // core.md 里的手写段还被削掉 132 字节，userData 下也没有任何备份目录）。
  // 现在先整体改名留证（保留最近 3 份），再重建空树；留证失败也要继续重建，不能因此卡住重置。
  try {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
      const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
      const keep = `${dir}-reset-${stamp}`;
      fs.rmSync(keep, { recursive: true, force: true });
      fs.renameSync(dir, keep);
      pruneResetBackups(dir, 3);
    }
  } catch {
    /* 留证失败不阻断重置 */
  }
  return ensureTree(dir);
}

// 只保留最近 keep 份 <dir>-reset-* 留证（按 mtime，不按名字——与 D-TEST-35 同一纪律）
function pruneResetBackups(dir, keep) {
  const base = path.dirname(dir);
  const prefix = path.basename(dir) + "-reset-";
  let names;
  try {
    names = fs.readdirSync(base).filter((f) => f.startsWith(prefix));
  } catch {
    return;
  }
  names
    .map((f) => {
      let m = 0;
      try { m = fs.statSync(path.join(base, f)).mtimeMs; } catch { /* 取不到排最前 */ }
      return { f, m };
    })
    .sort((a, b) => a.m - b.m)
    .slice(0, Math.max(0, names.length - keep))
    .forEach(({ f }) => {
      try { fs.rmSync(path.join(base, f), { recursive: true, force: true }); } catch { /* 忽略 */ }
    });
}

// ---------- 基础读写（追加式） ----------

function readText(dir, rel) {
  const p = path.join(dir, rel);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8");
}

function splitLines(text) {
  return String(text ?? "").split(/\r?\n/);
}

// 追加一行（appendFileSync 只增字节，不触碰既有内容）；文件非空且不以换行结尾时先补一个换行
function appendLine(dir, rel, line) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  let prefix = "";
  if (fs.existsSync(p)) {
    const cur = fs.readFileSync(p, "utf8");
    if (cur.length && !cur.endsWith("\n")) prefix = "\n";
  }
  fs.appendFileSync(p, prefix + String(line) + "\n", "utf8");
}

// 行号 → 是否位于手写区内（开标记后到闭标记/文件尾）
function handwrittenSpans(lines) {
  const spans = new Set();
  let open = -1;
  for (let i = 0; i < lines.length; i++) {
    if (open < 0) {
      if (lines[i].trim() === HANDWRITTEN_OPEN) open = i;
    } else {
      if (lines[i].trim() === HANDWRITTEN_CLOSE) {
        open = -1;
      } else {
        spans.add(i);
      }
    }
  }
  return spans;
}

// ---------- op 执行（§4.18-12：精确文本匹配；不到即跳过留痕） ----------

function validateTarget(raw) {
  const t = String(raw ?? "").trim();
  if (t === TARGET_CORE) return { ok: true, rel: CORE_FILE };
  const m = TARGET_TOPIC_RE.exec(t);
  if (!m) return { ok: false, reason: `target 非法（只允许 core 或 topics/<生活域>/<主题>.md）：${t}` };
  const domain = m[1];
  const topic = m[2];
  if (!LIFE_DOMAINS.includes(domain)) {
    return { ok: false, reason: `生活域不在封闭清单（9 选一）：${domain}` };
  }
  if (topic.includes("..") || topic.trim() !== topic || !topic.trim()) {
    return { ok: false, reason: `主题文件名非法：${topic}` };
  }
  return { ok: true, rel: `${TOPICS_DIR}/${domain}/${topic}.md`, domain, topic };
}

function cleanSingleLine(s) {
  return String(s ?? "").replace(/\s*\r?\n\s*/g, " ").trim();
}

// 精确匹配一行（逐字相等；同一行出现多次取第一条未带标记的）；返回 {index} 或 null
function findExactLine(lines, match, spans) {
  const needle = cleanSingleLine(match);
  if (!needle) return null;
  let fallback = null;
  for (let i = 0; i < lines.length; i++) {
    if (spans.has(i)) continue;
    const cur = lines[i];
    if (cur === needle) return i;
    if (fallback === null && cur.trim() === needle) fallback = i;
  }
  return fallback; // 逐字不等但 trim 后相等 → 仍算命中（CRLF/尾随空白由读取拆行吸收，正文须逐字）
}

function findFile(dir, rel) {
  const p = path.join(dir, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

// 就地给一行追加标记（唯一允许的「改写」：在行尾追加 <!-- … --> 注释，正文不动）
function markLine(lines, index, tag) {
  lines[index] = `${lines[index]} <!-- ${tag} -->`;
}

// applyOps：顺序执行 op 列表，返回逐 op 结果（供 memory_runs.applied_json 落痕）。
// 结果 status：applied 已执行 / skipped 匹配不到等原因跳过 / rejected 词表或参数违规拒绝。
function applyOps(dir, ops) {
  ensureTree(dir);
  const results = [];
  const list = Array.isArray(ops) ? ops : [];
  let touchedTopics = false;
  for (let i = 0; i < list.length; i++) {
    const op = list[i] || {};
    const kind = String(op.op ?? "");
    const res = { index: i, op: kind, target: String(op.target ?? ""), status: "skipped" };
    try {
      if (kind === "add") {
        const v = validateTarget(op.target);
        if (!v.ok) {
          res.status = "rejected";
          res.reason = v.reason;
        } else {
          const line = cleanSingleLine(op.line);
          if (!line) {
            res.status = "rejected";
            res.reason = "add 缺少 line";
          } else {
            const existed = findFile(dir, v.rel) != null;
            appendLine(dir, v.rel, line);
            res.status = "applied";
            res.created = !existed;
            if (v.rel !== CORE_FILE) touchedTopics = true;
          }
        }
      } else if (kind === "merge" || kind === "mark") {
        const v = validateTarget(op.target);
        if (!v.ok) {
          res.status = "rejected";
          res.reason = v.reason;
        } else if (v.rel === CORE_FILE && kind === "merge") {
          res.status = "rejected";
          res.reason = "merge 不适用于 core.md（近似重复合并只发生在主题文件）";
        } else {
          const text = findFile(dir, v.rel);
          if (text == null) {
            res.reason = `目标文件不存在：${v.rel}`;
          } else {
            const eol = text.includes("\r\n") ? "\r\n" : "\n";
            const lines = splitLines(text);
            const spans = handwrittenSpans(lines);
            const idx = findExactLine(lines, op.match, spans);
            if (idx == null) {
              res.reason = kind === "merge" ? "merge.match 精确匹配失败" : "mark.match 精确匹配失败";
            } else {
              if (kind === "merge") {
                const line = cleanSingleLine(op.line);
                if (!line) {
                  res.status = "rejected";
                  res.reason = "merge 缺少 line";
                  results.push(res);
                  continue;
                }
                markLine(lines, idx, "已并入");
                lines.push(line);
                fs.writeFileSync(path.join(dir, v.rel), lines.join(eol), "utf8");
                touchedTopics = touchedTopics || v.rel !== CORE_FILE;
              } else {
                const tag = String(op.tag ?? "").trim();
                const base = MARK_TAGS.find((t) => tag === t || tag.startsWith(`${t} `));
                if (!base) {
                  res.status = "rejected";
                  res.reason = `mark.tag 非法（只允许 ${MARK_TAGS.join(" / ")}）：${tag}`;
                  results.push(res);
                  continue;
                }
                markLine(lines, idx, tag);
                fs.writeFileSync(path.join(dir, v.rel), lines.join(eol), "utf8");
                touchedTopics = touchedTopics || v.rel !== CORE_FILE;
              }
              res.status = "applied";
              res.matchedLine = idx + 1;
            }
          }
        }
      } else {
        res.status = "rejected";
        res.reason = `未知操作类型（词表封闭：add / merge / mark）：${kind}`;
      }
    } catch (err) {
      res.status = "skipped";
      res.reason = `执行异常：${err && err.message}`;
    }
    results.push(res);
  }
  return { results, touchedTopics };
}

// ---------- index.md 目录登记（系统职责，确定性重生成；手写区原样保留） ----------

function parseEntryDate(line) {
  const m = /^-\s*(\d{4}-\d{2}-\d{2})\s*｜/.exec(String(line || ""));
  return m ? m[1] : null;
}

function isEntryLine(line) {
  const t = String(line || "");
  return t.startsWith("- ") && !t.includes("<!--");
}

// 按主题文件重生成 index.md 目录区（保留手写区；标题与说明行固定）
function rebuildIndex(dir) {
  const cur = readText(dir, INDEX_FILE);
  const curLines = cur == null ? [] : splitLines(cur);
  const spans = handwrittenSpans(curLines);
  let handwritten = "";
  if (spans.size) {
    const from = Math.min(...spans);
    const to = Math.max(...spans);
    handwritten = curLines.slice(from, to + 1).join("\n");
  }
  const lines = ["# 记忆 · 目录", "", "生活域 → 主题文件（主题 · 条数 · 日期区间）。目录区由系统自动登记；手写备注请写在「用户手写区」内。"];
  if (handwritten) {
    lines.push("", HANDWRITTEN_OPEN, handwritten, HANDWRITTEN_CLOSE);
  } else {
    lines.push("", HANDWRITTEN_OPEN, "", HANDWRITTEN_CLOSE);
  }
  const topicsRoot = path.join(dir, TOPICS_DIR);
  if (fs.existsSync(topicsRoot)) {
    for (const domain of LIFE_DOMAINS) {
      const domainDir = path.join(topicsRoot, domain);
      if (!fs.existsSync(domainDir)) continue;
      const files = fs
        .readdirSync(domainDir)
        .filter((f) => f.endsWith(".md"))
        .sort((a, b) => a.localeCompare(b, "zh"));
      if (!files.length) continue;
      lines.push("", `## ${domain}`);
      for (const f of files) {
        const text = fs.readFileSync(path.join(domainDir, f), "utf8");
        const entryLines = splitLines(text).filter((l) => isEntryLine(l));
        const dates = entryLines.map(parseEntryDate).filter(Boolean).sort();
        const range = dates.length ? `${dates[0]}~${dates[dates.length - 1]}` : "—";
        const topic = f.replace(/\.md$/, "");
        lines.push(`- ${topic} · ${entryLines.length} 条 · ${range}`);
      }
    }
  }
  fs.writeFileSync(path.join(dir, INDEX_FILE), lines.join("\n") + "\n", "utf8");
}

// ---------- 用量统计（§6.7.1 注入预算行的三段用量） ----------

function usageStats(dir) {
  const stat = (rel) => {
    const text = readText(dir, rel);
    if (text == null) return { chars: 0, tokens: 0 };
    return { chars: text.length, tokens: estimateTokens(text) };
  };
  const topics = [];
  const topicsRoot = path.join(dir, TOPICS_DIR);
  if (fs.existsSync(topicsRoot)) {
    for (const domain of LIFE_DOMAINS) {
      const domainDir = path.join(topicsRoot, domain);
      if (!fs.existsSync(domainDir)) continue;
      for (const f of fs.readdirSync(domainDir).filter((x) => x.endsWith(".md")).sort()) {
        const rel = `${TOPICS_DIR}/${domain}/${f}`;
        const s = stat(rel);
        topics.push({ rel, domain, topic: f.replace(/\.md$/, ""), ...s });
      }
    }
  }
  const core = stat(CORE_FILE);
  const index = stat(INDEX_FILE);
  const topicsChars = topics.reduce((a, t) => a + t.chars, 0);
  const topicsTokens = topics.reduce((a, t) => a + t.tokens, 0);
  return {
    core,
    index,
    topics,
    totals: {
      chars: core.chars + index.chars + topicsChars,
      tokens: core.tokens + index.tokens + topicsTokens
    }
  };
}

module.exports = {
  MEMORY_DIR_NAME,
  CORE_FILE,
  INDEX_FILE,
  TOPICS_DIR,
  LIFE_DOMAINS,
  HANDWRITTEN_OPEN,
  HANDWRITTEN_CLOSE,
  HANDWRITTEN_HINT,
  MARK_TAGS,
  estimateTokens,
  resolveMemoryDir,
  ensureTree,
  resetMemory,
  readText,
  applyOps,
  rebuildIndex,
  usageStats
};
