// F11 指导文档↔代码一致性闸门（换角度：文档本身也是被测对象）
// @runtime: node  @tier: 2  @gui: false  @id: F11  @timeout: 180
// 运行：node tests/flows/f11-doc-code-drift.cjs   （或 node tests/flows/run.cjs --only F11）
//
// 角度：§7.1.5 规定「需求变更先改本文档 bump 版本再编码」、§7.4 规定「改提示词先改本文档」——
//       也就是说这份指导文档是**被依赖的生产物**：它一旦漂移，之后每一次编码都从错误的合同出发。
//       既有 25+ 套件没有一条验证文档自身。这条只读文件、不起应用，因此能在长跑里高频跑，
//       随时接住「改了代码忘了文档」。
//
// 依据：§7.1.5 L859、§7.3（测试义务清单）、§7.4 L898、§8.1（决策日志）、§8.3（版本记录）、§4.1（数据模型）。
"use strict";
const fs = require("fs");
const path = require("path");
const { Flow, runFlow, ROOT } = require("./lib/harness.cjs");

const flow = new Flow({
  id: "F11",
  title: "指导文档↔代码一致性",
  angle: "文档作为被依赖生产物的漂移闸门",
  cites: ["§7.1.5", "§7.3", "§7.4", "§8.1", "§8.3", "§4.1"],
  tier: 2,
  gui: false,
});

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const EXT = "(?:tsx|cjs|mjs|css|json|html|md|ts|js)";

/** 文档里出现过的、看起来像仓库文件路径的字符串（扩展名按长度优先，否则 .tsx 会被截成 .ts 造假缺失） */
function fileMentions(text) {
  const set = new Set();
  const re = new RegExp(`(?:src|electron|tests|docs|scripts|public|vendor)/[\\w./\\u4e00-\\u9fa5-]+\\.${EXT}`, "g");
  for (const m of text.matchAll(re)) {
    const p = m[0].replace(/[.,，。）)》;；]+$/, "");
    if (!p.includes("*") && !p.includes("…")) set.add(p);
  }
  return [...set];
}

const IPC_NS = ["settings", "win", "app", "shell", "library", "extracts", "cards", "reading", "workflow", "stats", "issues", "batches", "prompts", "similarity", "fsrs", "optimizer", "assets", "backup", "dict", "journal", "capture", "shortcuts", "knowledge", "insights", "meaning", "memory", "mindmap", "ai"];

const ALL_TABLES = [
  "users", "library_items", "documents", "assets", "extracts", "cards", "card_issues", "ai_gen_batches",
  "prompt_templates", "review_logs", "review_skips", "fsrs_configs", "reading_events", "dict_sources",
  "dictionary_cache", "journal_entries", "knowledge_points", "knowledge_relations", "knowledge_external_refs",
  "knowledge_proposals", "insight_runs", "personal_meaning_candidates", "memory_runs", "material_maps",
  "material_map_shards", "material_map_runs", "material_map_calls", "card_links",
];

runFlow(flow, async () => {
  const guideRaw = read("AI_DEVELOPMENT_GUIDE.md");
  // v48.28 / D68：冷历史（历代版本叙述 / §8.3 / §9.1 详情 / §9.3）已迁入 docs/HISTORY.md。
  // 文档集的闸门（路径 / §引用 / D 编号 / 版本 / 表数）按「guide + HISTORY 并集」判——搬动只改物理位置，
  // 历史里的 D 编号与版本号仍是正式登记；L5「不得自我复制」仍只看 guide（HISTORY 是逐字档案，重复是它的本分）。
  const history = exists("docs/HISTORY.md") ? read("docs/HISTORY.md") : "";
  const guide = guideRaw + "\n" + history;
  const g = guide.split(/\r?\n/);
  flow.record("文档集规模", `guide ${guideRaw.length / 1024 | 0} KB + HISTORY ${history.length / 1024 | 0} KB / ${g.length} 行`);

  // ---------- L1 路径可解析 ----------
  flow.section("L1 文档指向的文件必须存在（§7.3 是合同不是愿望清单）");
  const mentioned = fileMentions(guide);
  // 只要求「描述现状」的段落里提到的文件存在；「落点预案 / 新增 / 未实现」里的路径是给未来用的，不算漂移
  const PLANNED = /(未实现|落点预案|新增|预案|规划|预留|待落地|随 K|随 M|测试：新增|M1[0-9]|M[4-9])/;
  const describedAsCurrent = (p) => {
    let from = 0;
    while (true) {
      const i = guide.indexOf(p, from);
      if (i < 0) return true;
      const ctx = guide.slice(Math.max(0, i - 160), i + 160);
      if (!PLANNED.test(ctx)) return false;
      from = i + p.length;
    }
  };
  const missingFiles = mentioned.filter((p) => !exists(p) && !describedAsCurrent(p));
  const plannedMissing = mentioned.filter((p) => !exists(p) && describedAsCurrent(p));
  flow.record("文档提到的路径数", mentioned.length);
  flow.record("指向未来落点（尚不存在，属正常）", plannedMissing.join(" ") || "（无）");
  flow.check("描述现状的段落不指向不存在的文件", missingFiles.length === 0, "全部存在", missingFiles);

  // ---------- L2 章节引用 ----------
  flow.section("L2 「§x.y」引用的顶级章节必须存在");
  const heads = new Set();
  for (const l of g) {
    const m = l.match(/^#{1,4}\s+(\d+(?:\.\d+)*)/);
    if (m) heads.add(m[1]);
  }
  const topLevels = new Set([...heads].map((h) => h.split(".")[0]));
  const rawRefs = [...guide.matchAll(/§(\d+(?:\.\d+)?)/g)];
  const refs = new Set(rawRefs.map((m) => m[1]));
  // §0–§87 这类是**外部设计稿**的节号（LKM 设计稿），不是本文档的节；按上下文剔除
  const internal0 = [...refs].filter((r) => /^[1-9](.d+?$)?$/.test(r));
  const internal = internal0.filter((r) => {
    const i = guide.indexOf(`§${r}`);
    const ctx = i < 0 ? "" : guide.slice(Math.max(0, i - 60), i + 20);
    return !/设计稿|LKM §|Insight 增补/.test(ctx);
  });
  const broken = internal.filter((r) => !topLevels.has(r.split(".")[0]));
  flow.record("内部 § 引用 / 剔除的外部设计稿引用", `${internal.length} / ${refs.size - internal.length}`);
  flow.check("无引用到不存在的章", broken.length === 0, "无悬空", broken);

  // ---------- L3 版本自洽 ----------
  flow.section("L3 版本号自洽（标题版本必须等于正文最高版本；D50 那类错误的机械化防线）");
  const titleM = guideRaw.match(/^#\s.*?v(\d+)\.(\d+)/m);
  const titleVer = titleM ? `${titleM[1]}.${titleM[2]}` : null;
  const allVers = [...guide.matchAll(/\bv(\d+)\.(\d+)\b/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const maxVer = allVers.sort((a, b) => a[0] - b[0] || a[1] - b[1]).pop();
  const maxStr = maxVer ? `${maxVer[0]}.${maxVer[1]}` : null;
  flow.record("标题版本 / 正文最高版本", `${titleVer} / ${maxStr}`);
  flow.eq("标题版本 = 正文最高版本", titleVer, maxStr);
  flow.record("文档提到过的版本数", new Set(allVers.map((v) => v.join("."))).size);

  // ---------- L4 决策号 ----------
  flow.section("L4 决策号不缺号（§8.1 决策日志的完整性）");
  const usedD = new Set([...guide.matchAll(/\bD(\d+)\b/g)].map((m) => Number(m[1])));
  const maxD = Math.max(0, ...usedD);
  const gaps = [];
  for (let i = 1; i <= maxD; i++) if (!usedD.has(i)) gaps.push(`D${i}`);
  flow.record("正文用到的最大决策号", `D${maxD}`);
  flow.check("D1…Dmax 无缺号（缺号＝决策未登记或编号打错）", gaps.length === 0, "无缺号", gaps);
  const sec81 = guide.split(/^##\s*8\.2/m)[0];
  flow.check(`最新决策号 D${maxD} 已在 §8.1 登记`, new RegExp(`D${maxD}\\b`).test(sec81), true, sec81.includes(`D${maxD}`));

  // ---------- L5 自我复制 ----------
  flow.section("L5 文档不得整段自我复制（重复即漂移温床；只看 guide，HISTORY 是逐字档案）");
  const guideLines = guideRaw.split(/\r?\n/);
  const seen = new Map();
  const dup = [];
  guideLines.forEach((l, i) => {
    const t = l.trim();
    if (t.length < 120) return;
    const key = t.slice(0, 100);
    if (seen.has(key)) dup.push(`L${seen.get(key) + 1}↔L${i + 1}`);
    else seen.set(key, i);
  });
  flow.record("≥120 字符的逐字重复行数", dup.length);
  flow.check(
    "文档无逐字重复段（已知 §1 原则 8–10、§4.1 KP 块、§7.3 M6-1、§7.6 整节各重复一份）",
    dup.length === 0,
    "0 处",
    dup.slice(0, 8)
  );
  const h2 = guideLines.filter((l) => /^##\s/.test(l));
  const h2dup = [...new Set(h2.filter((v, i) => h2.indexOf(v) !== i))];
  flow.check("小节标题不重复（§7.6 整节出现两次）", h2dup.length === 0, "无重复", h2dup);

  // ---------- L6 数据模型清单 ----------
  flow.section("L6 §4.1 声明的表与代码实建表一致（§7.1.7「字段不许静默裁剪」的文档侧）");
  const dbTxt = read("electron/db.js");
  const built = [...new Set([...dbTxt.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/g)].map((m) => m[1]))].sort();
  flow.record("代码实建表数", built.length);
  const docClaims = [...guide.matchAll(/(\d+)\s*张/g)]
    .filter((m) => /表/.test(guide.slice(Math.max(0, m.index - 40), m.index + 40)))
    .map((m) => Number(m[1]));
  flow.record("文档写明的表数量", [...new Set(docClaims)].join(" / "));
  flow.check(
    "文档声明的表数量与实建一致（文档写 17/23，实建 27）",
    docClaims.includes(built.length),
    built.length,
    [...new Set(docClaims)]
  );
  const neverMentioned = ALL_TABLES.filter((t) => !new RegExp(`\\b${t}\\b`).test(guide));
  flow.record("代码建了但文档从未点名的表", neverMentioned.join(" ") || "（无）");
  flow.check("实建表都在文档里出现（导图 4 表与阅读/词典表未列入 §4.1）", neverMentioned.length === 0, "全部有名", neverMentioned);

  // ---------- L7 IPC 通道 ----------
  flow.section("L7 文档点名的 IPC 通道在代码里存在（§4 接口抽象是可调用清单）");
  const preload = read("electron/preload.js");
  const main = read("electron/main.js");
  const registered = new Set([...main.matchAll(/ipcMain\.(?:handle|on)\(\s*"([\w:]+)"/g)].map((m) => m[1]));
  const channels = new Set();
  for (const m of guide.matchAll(new RegExp(`\\b(${IPC_NS.join("|")}):([a-z][A-Za-z]{1,26})\\b`, "g"))) channels.add(`${m[1]}:${m[2]}`);
  const absent = [...channels].filter((c) => !registered.has(c) && !preload.includes(`"${c}"`));
  flow.record("文档提到的通道数 / 代码注册数", `${channels.size} / ${registered.size}`);
  flow.record("文档提到但代码未注册", absent.slice(0, 18).join(" ") || "（无）");
  flow.record("memory: 族文档名未注册的（文档 L150 与实际 10 个通道名不一致，属文档漂移，见 DEFECTS D-DOC-04）", absent.filter((c) => c.startsWith("memory:")).join(" ") || "（本次扫描未取到 memory:read 这类裸名，说明文档写法是「memory:status / read / …」并列式，扫描器抓不全）");

  // ---------- L8 未实现清单不得有实现痕迹 ----------
  flow.section("L8 标注「未实现」的能力不得悄悄长出半成品（反向漂移）");
  const srcAll = [];
  const walk = (d) => {
    for (const n of fs.readdirSync(d)) {
      if (["node_modules", "dist", "build", ".git", "vendor", "foliate"].includes(n)) continue;
      const full = path.join(d, n);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|cjs)$/.test(n)) srcAll.push({ rel: path.relative(ROOT, full).replace(/\\/g, "/"), t: fs.readFileSync(full, "utf8") });
    }
  };
  walk(path.join(ROOT, "src"));
  walk(path.join(ROOT, "electron"));
  const unbuilt = [
    // growth: IPC 已随 v48.85 / D129 GF-1 实现并在 §4.2-22 登记为已实现——从 unbuilt 移除（终审 P1-1）
    ["K3 探针卡运行表 probe_runs（未实现）", /\bprobe_runs\s*\(/],
    ["frontierExploration 前沿探索开关（未实现）", /frontierExploration/],
    ["出错一键上传队列 error-report-queue（§7.6 未实现）", /error-report-queue/],
    ["ParserProvider / MinerU（未实现）", /ParserProvider|minerU/],
    ["AccountSyncProvider 真实现（§4 锁定为 LocalNoop）", /class\s+\w*AccountSyncProvider/],
  ];
  for (const [name, re] of unbuilt) {
    const hits = srcAll.filter((f) => re.test(f.t)).map((f) => f.rel);
    flow.check(`${name} 不出现在实现代码里`, hits.length === 0, "无痕迹", hits);
  }

  // ---------- L9 测试义务可执行 ----------
  flow.section("L9 §7.3 点名的测试文件都在位且带运行时分流头");
  const testFiles = [...new Set([...guide.matchAll(/tests\/[\w./-]+\.(?:cjs|mjs)/g)].map((m) => m[0]))];
  const missingTests = testFiles.filter((p) => !exists(p) && !describedAsCurrent(p));
  flow.record("文档点名的测试文件数", testFiles.length);
  flow.check("点名的测试文件全部存在", missingTests.length === 0, "全部在位", missingTests);
  const suites = testFiles.filter((p) => exists(p) && p.endsWith(".test.cjs"));
  // 权威口径：文件头 1200 字符内要写明「用哪个运行时跑这个文件」——node 还是 electron，措辞不限
  // （项目记忆：跑错运行时会挂死或弹主进程错误框，所以这条声明必须机器可读）
  const RUNTIME_MENTION = /(node tests[/]|npx electron tests[/]|electron tests[/]|bin[/]electron tests[/]|直跑|CDP 驱动)/;
  const noHeader = suites.filter((f) => !RUNTIME_MENTION.test(read(f).slice(0, 1200)));
  flow.record("按 §7.3 点名的 .test.cjs 套件数", suites.length);
  flow.check("每个套件都在文件头写明运行时（node/electron 分流的唯一权威）", noHeader.length === 0, "都有", noHeader);
}).then((s) => {
  process.exit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length ? 1 : 0);
});
