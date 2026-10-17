// @runtime: node
// 材料导图 v2 行协议提示词回归（node 直跑：node tests/m15v2.prompts.test.cjs）。
// 契约：docs/design/MINDMAP-V2-P0-CONTRACT.md「M3」。守护：提示词 few-shot 必须被 electron/mindmapOutline.js 100% 接受，
// 且提示词里列出的类型/版式/关系码与解析器常量一致。
const path = require("path");
const crypto = require("crypto");
const P = require(path.join(__dirname, "..", "electron", "mindmapV2Prompts.js"));
const Shell = require(path.join(__dirname, "..", "prompt-lab", "mindmapV2Prompts.js"));
const PR = require(path.join(__dirname, "..", "electron", "prompts.js"));
const O = require(path.join(__dirname, "..", "electron", "mindmapOutline.js"));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "")}`); }
}

// 抽取示例：「▸示例…（…原文块 [a]–[b]…；可引用 #kN …）」+【示例输出】…【/示例输出】
function extractExamples(sys) {
  const re = /▸示例[^\n]*?（([^\n]*)）\n【示例输出】\n([\s\S]*?)\n【\/示例输出】/g;
  const out = [];
  let m;
  while ((m = re.exec(sys))) {
    const head = m[1];
    const r = /原文块 \[(\d+)\]–\[(\d+)\]/.exec(head);
    const refs = head.match(/#k\d+/g) || [];
    out.push({ head, from: r ? Number(r[1]) : null, to: r ? Number(r[2]) : null, refs, lines: m[2].split("\n") });
  }
  return out;
}
function feed(ex, basePath) {
  const nodes = [], drops = [];
  const p = O.createLineParser({ scope: { blockFrom: ex.from, blockTo: ex.to }, basePath, refs: new Set(ex.refs), onNode: (n) => nodes.push(n), onDrop: (d) => drops.push(d) });
  for (const ch of ex.lines.join("\n")) p.push(ch); // 逐字符流式喂
  return { nodes, drops, stats: p.end() };
}
const cjk = (s) => (s.match(/[㐀-鿿]/g) || []).length;

// 迁入前（prompt-lab 版）三段 system 文本的冻结指纹——T2 逐字迁入守护；改提示词须同时升版本并更新此表
const FROZEN = {
  OUTLINE_SYSTEM: { len: 2182, sha256: "1ad231fd6f7818d95044801001b260b1bf3ac8aa4d971d0c7f91e686b9823bbf", main: "MATERIAL_MAP_OUTLINE_PROMPT" },
  EXPAND_SYSTEM: { len: 1799, sha256: "e92e3d0dff4773a1e17562cab5afed7e7d9dcba8b82ec5f059db52d5de5d2a86", main: "MATERIAL_MAP_EXPAND_PROMPT" },
  EXPLAIN_SYSTEM: { len: 524, sha256: "14bb4bb7d4bb44c569ab4bfed3f47f413be96c3651cbd3c91e6e62b4003c0778", main: "MATERIAL_MAP_EXPLAIN_PROMPT" }
};
console.log("---- 0 迁入逐字守护（prompts.js 常量 === 冻结文本） ----");
{
  for (const [k, f] of Object.entries(FROZEN)) {
    const c = PR[f.main];
    check(`prompts.js 导出 ${f.main}`, typeof c === "string");
    check(`${f.main} 长度与 sha256 === 迁入前 ${k}`, c.length === f.len && crypto.createHash("sha256").update(c).digest("hex") === f.sha256, { len: c && c.length });
    check(`${k} (electron/mindmapV2Prompts) === ${f.main}`, P[k] === c);
    check(`${k} (prompt-lab 薄壳) === ${f.main}`, Shell[k] === c);
  }
  check("薄壳导出名与 electron 版一致", JSON.stringify(Object.keys(Shell)) === JSON.stringify(Object.keys(P)));
}

console.log("---- 1 导出与版本 ----");
{
  check("PROMPT_VERSION=1", P.PROMPT_VERSION === 1);
  for (const k of ["OUTLINE_SYSTEM", "EXPAND_SYSTEM", "EXPLAIN_SYSTEM"]) check(`${k} 为非空字符串`, typeof P[k] === "string" && P[k].length > 200);
  for (const k of ["buildOutlineUser", "buildExpandUser", "buildExplainUser", "targetDepth"]) check(`${k} 为函数`, typeof P[k] === "function");
  for (const k of ["OUTLINE_SYSTEM", "EXPAND_SYSTEM", "EXPLAIN_SYSTEM"]) {
    console.log(`      ${k}: ${P[k].length} 字符 / ${cjk(P[k])} 汉字`);
    check(`${k} 汉字 ≤2500`, cjk(P[k]) <= 2500, cjk(P[k]));
  }
  check("提示词无 LF 以外换行", ["OUTLINE_SYSTEM", "EXPAND_SYSTEM", "EXPLAIN_SYSTEM"].every((k) => !/\r/.test(P[k])));
}

console.log("---- 2 协议与解析器一致 ----");
{
  for (const k of ["OUTLINE_SYSTEM", "EXPAND_SYSTEM"]) {
    const s = P[k];
    const typeLine = (s.match(/- 类型（只能取其一）：([^\n]*)/) || [])[1] || "";
    const listed = typeLine.replace(/。$/, "").split(/[\s｜]+/).filter(Boolean);
    check(`${k} 类型清单 = TYPES`, JSON.stringify([...listed].sort()) === JSON.stringify([...O.TYPES].sort()), listed);
    check(`${k} 列出全部版式`, Object.keys(O.PATTERNS).every((p) => s.includes(`{${p}}`)));
    check(`${k} 列出全部关系码`, O.REL_CODES.every((c) => s.includes(`${c}(`)));
    check(`${k} 判断标准：结构的独立组织意义，不是字数`, s.includes("结构的独立组织意义，不是字数"));
    check(`${k} 只输出行协议`, /只输出行协议/.test(s) && /不要任何解释/.test(s));
    check(`${k} 标题 ≤20 字`, s.includes("≤20 字"));
  }
  check("EXPAND 相对路径从 1 开始 + 避免与兄弟重复", /相对当前节点、从 1 开始/.test(P.EXPAND_SYSTEM) && /不要与【已有兄弟】重复/.test(P.EXPAND_SYSTEM));
  check("EXPLAIN 2–4 句纯文本 + 三要素", /2–4 句/.test(P.EXPLAIN_SYSTEM) && /核心问题/.test(P.EXPLAIN_SYSTEM) && /关键动作/.test(P.EXPLAIN_SYSTEM) && /兄弟/.test(P.EXPLAIN_SYSTEM) && /纯文本/.test(P.EXPLAIN_SYSTEM));
}

console.log("---- 3 few-shot 全部被解析器接受 ----");
{
  const outEx = extractExamples(P.OUTLINE_SYSTEM);
  const expEx = extractExamples(P.EXPAND_SYSTEM);
  const explEx = extractExamples(P.EXPLAIN_SYSTEM);
  check("OUTLINE 至少 4 个示例", outEx.length >= 4, outEx.length);
  check("EXPAND 至少 1 个示例", expEx.length >= 1, expEx.length);
  check("EXPLAIN 无行协议示例（输出为纯文本）", explEx.length === 0 && /【示例回答】/.test(P.EXPLAIN_SYSTEM));
  check("每个示例都声明了块区间", [...outEx, ...expEx].every((e) => e.from != null), [...outEx, ...expEx].map((e) => e.head));
  let total = 0, accepted = 0, dropped = 0, relsDropped = 0, warn = [];
  const all = [];
  const groups = []; // 每个示例一组，关系目标在组内解析（不同示例的层级号会重名）
  for (const ex of outEx) { const r = feed(ex); groups.push(r.nodes); all.push(...r.nodes); total += ex.lines.length; accepted += r.stats.accepted; dropped += r.stats.dropped; relsDropped += r.stats.relsDropped; r.nodes.forEach((n) => n.warnings.length && warn.push([n.path, n.warnings])); if (r.drops.length) console.log(r.drops); }
  for (const ex of expEx) { const r = feed(ex, "9"); groups.push(r.nodes); all.push(...r.nodes); total += ex.lines.length; accepted += r.stats.accepted; dropped += r.stats.dropped; relsDropped += r.stats.relsDropped; r.nodes.forEach((n) => n.warnings.length && warn.push([n.path, n.warnings])); if (r.drops.length) console.log(r.drops); }
  console.log(`      示例行 ${total}：accepted=${accepted} dropped=${dropped} relsDropped=${relsDropped}`);
  check("accepted = 全部示例行", accepted === total && total > 0, { total, accepted });
  check("dropped = 0", dropped === 0);
  check("relsDropped = 0（示例关系全部合法）", relsDropped === 0);
  check("示例无任何 warning（类型合法、无空盒、无钳制、标题 ≤20）", warn.length === 0, warn);
  check("expand 示例映射到 basePath 下", all.filter((n) => n.path.startsWith("9.")).length >= 6);

  // 覆盖面
  const rels = groups.flatMap((g) => g.flatMap((n) => n.rels.map((r) => ({ from: n, ...r, toType: (g.find((x) => x.path === r.target) || {}).type }))));
  check("论证：含反方观点与 &驳 指向反方观点", all.some((n) => n.type === "反方观点") && rels.some((r) => r.code === "驳" && r.from.type === "反驳" && r.toType === "反方观点"));
  check("证明：含引理与 &据 指向引理", all.some((n) => n.type === "引理") && rels.some((r) => r.code === "据" && r.toType === "引理"));
  check("对照：{对照} + &比", all.some((n) => n.pattern === "compare") && rels.some((r) => r.code === "比"));
  check("叙事时间线：{时间线} + 〈时间〉", all.some((n) => n.pattern === "timeline") && all.filter((n) => n.time).length >= 2);
  check("示例用到 refs 短号", rels.some((r) => r.target.startsWith("#k")));
  check("示例 + 与 . 都出现", all.some((n) => n.more) && all.some((n) => !n.more));
  check("{版式} 只出现在有子节点的行", groups.every((g) => g.filter((n) => n.pattern).every((n) => g.some((c) => c.parentPath === n.path))));
  check("outline 示例层数不超过声明的目标层数", outEx.every((ex) => { const L = Number((/目标层数 (\d)/.exec(ex.head) || [])[1]); return ex.lines.every((l) => l.split(" ")[0].split(".").length <= L); }));
}

console.log("---- 4 build*User ----");
{
  const numbered = "[12] 第一块原文。\n[13] 第二块原文。\n[14] 第三块原文。";
  const refs = [{ id: "#k7", title: "第一章 机会平等" }, { id: "#k8", title: "第二章 赢家的傲慢" }];
  const u = P.buildOutlineUser({ title: "精英的傲慢", path: ["精英的傲慢", "第三章"], numberedText: numbered, depth: 3, refs });
  check("outline：带块号原文", u.includes("【原文】\n[12] 第一块原文。") && u.includes("[14] 第三块原文。\n【/原文】"));
  check("outline：结构路径", u.includes("【结构路径】精英的傲慢 › 第三章"));
  check("outline：目标层数", u.includes("【目标层数】3"));
  check("outline：refs 清单", u.includes("#k7 第一章 机会平等") && u.includes("#k8 第二章 赢家的傲慢"));
  check("outline：块号范围", u.includes("【原文块号】[12]–[14]"), u);
  check("outline：无 refs 显示「无」", P.buildOutlineUser({ title: "x", path: [], numberedText: "[1] a", depth: 4 }).includes("【可引用节点】\n无"));

  const e = P.buildExpandUser({ title: "精英的傲慢", ancestors: ["精英的傲慢", "第三章"], siblings: ["赢家的傲慢", "输家的屈辱"], node: { title: "机会平等的承诺", type: "论点" }, numberedText: numbered, depth: 2, refs });
  check("expand：带块号原文 / 祖先路径 / 当前节点", e.includes("[13] 第二块原文。") && e.includes("【祖先路径】精英的傲慢 › 第三章") && e.includes("【当前节点】[论点] 机会平等的承诺"));
  check("expand：兄弟 / 目标层数 / refs", e.includes("【已有兄弟】赢家的傲慢；输家的屈辱") && e.includes("【目标层数】2") && e.includes("#k7 第一章 机会平等"));

  const x = P.buildExplainUser({ title: "精英的傲慢", ancestors: ["精英的傲慢", "第三章"], node: { title: "机会平等的承诺", type: "论点" }, numberedText: numbered });
  check("explain：带块号原文 / 祖先 / 当前节点", x.includes("[12] 第一块原文。") && x.includes("【祖先路径】精英的傲慢 › 第三章") && x.includes("【当前节点】[论点] 机会平等的承诺"));
  check("explain：siblings 可选", x.includes("【兄弟节点】无") && P.buildExplainUser({ title: "t", ancestors: [], node: { title: "a", type: "论点" }, numberedText: "[1] a", siblings: ["b"] }).includes("【兄弟节点】b"));
}

console.log("---- 5 targetDepth ----");
{
  const T = P.targetDepth;
  check("≤3000 → 4", T(0) === 4 && T(1500) === 4 && T(3000) === 4);
  check("≤12000 → 3", T(3001) === 3 && T(12000) === 3);
  check("更大 → 2", T(12001) === 2 && T(200000) === 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
