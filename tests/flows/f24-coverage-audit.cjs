// F24 指南章节覆盖面自评（换角度：测「测试本身」——哪一节从来没人测过）
// @runtime: node  @tier: 1  @gui: false  @id: F24  @timeout: 120
// 运行：node tests/flows/f24-coverage-audit.cjs
//
// 角度：这一层现在有 23 条流程，但「流程很多」和「全流程都覆盖」不是一回事。
//       指导文档才是判据的来源：每一条流程头部都写了它依据哪些 §。把两边的账对起来，
//       就能机器回答「文档里哪一节承诺过行为、却没有任何一条流程引用过它」。
//       口径如实放宽：§4.4.5 的引用算作覆盖 §4.4（前缀互含即算），
//       所以这张表回答的是「这一章有没有被碰过」，不是「每一条子句都被测过」。
//       覆盖缺口用棘轮锁死：只许缩小，不许扩大——新添文档章节而忘了加流程，会在这里变红。
//
// 依据：§7.1.4（每次完工的验收线含「主流程可演示」）、§7.3（测试义务按里程碑登记）、
//       §7.1.5（文档是被依赖的生产物）、§9.1（M1…M15 全量清单）。
"use strict";
const fs = require("fs");
const path = require("path");
const { Flow, runFlow, ROOT } = require("./lib/harness.cjs");

const flow = new Flow({
  id: "F24",
  title: "指南章节覆盖面自评",
  angle: "把「测试的覆盖面」本身变成被测对象：章节 ↔ 引用它的路径 对账 + 缺口棘轮",
  cites: ["§7.1.4", "§7.3", "§7.1.5", "§9.1"],
  tier: 1,
  gui: false,
});

const BASELINE_FILE = path.join(ROOT, "tests", "flows", "fixtures", "f24-coverage-baseline.json");
const read = (p) => fs.readFileSync(p, "utf8");

/** 指南里的章节标题（只取 §4 数据模型 / §5 设计系统 / §6 产品规格 / §7 编码规则 这四章） */
function headings(guide) {
  const out = [];
  guide.split(/\r?\n/).forEach((line, i) => {
    const m = line.match(/^#{2,4}\s+(4|5|6|7)(\.\d+){1,2}/);
    if (!m) return;
    const id = m[0].replace(/^#+\s+/, "");
    if (!out.some((h) => h.id === id)) out.push({ id, at: i + 1, title: line.replace(/^#+\s*/, "").slice(0, 60) });
  });
  return out;
}

/** 每条流程声明的依据（cites 数组 + 头部注释里的 §） */
function flowCites() {
  const dir = path.join(ROOT, "tests", "flows");
  const files = fs.readdirSync(dir).filter((f) => /^f\d+.*\.cjs$/.test(f)).sort();
  const cites = {};
  for (const f of files) {
    const txt = read(path.join(dir, f));
    const ids = new Set();
    const cm = txt.match(/cites:\s*\[([\s\S]*?)\]/);
    const blob = (cm ? cm[1] : "") + "\n" + txt.slice(0, 3000);
    for (const m of blob.matchAll(/§\s*(\d+(?:\.\d+){0,2})/g)) ids.add(m[1]);
    const idm = txt.match(/@id:\s*(F\d+)/);
    cites[idm ? idm[1] : f] = [...ids];
  }
  return cites;
}

const covered = (hid, cites) => cites.some((c) => c === hid || c.startsWith(hid + ".") || hid.startsWith(c + "."));

runFlow(flow, async () => {
  const guide = read(path.join(ROOT, "AI_DEVELOPMENT_GUIDE.md"));
  const hs = headings(guide);
  const cites = flowCites();
  const allCites = Object.values(cites).reduce((a, v) => a.concat(v), []);
  const BASE = fs.existsSync(BASELINE_FILE) ? JSON.parse(read(BASELINE_FILE)) : null;
  let uncoveredIds = [];
  let unmentionedIds = [];
  let perChapter = {};

  flow.section("R1 流程层与指南章节的对账口径先自证");
  flow.check("指南里抓到 4/5/6/7 章的成段子标题", hs.length > 40, ">40 个", hs.length);
  flow.check("流程层抓到 15 条以上带 cites 的流程", Object.keys(cites).length >= 15, "≥15 条", Object.keys(cites).length);
  flow.record("流程引用的不同章节数", String(new Set(allCites).size));

  flow.section("R2 每一章都必须有流程碰过（缺口按棘轮只许缩小）");
  const chapters = ["4", "5", "6", "7"];
  perChapter = {};
  for (const c of chapters) {
    const secs = hs.filter((h) => h.id.startsWith(c + "."));
    const miss = secs.filter((h) => !covered(h.id, allCites));
    perChapter[c] = { total: secs.length, miss: miss.map((h) => h.id) };
    flow.check(`§${c} 章的未测节不过半（这一章至少一半的契约被流程碰过）`,
      miss.length * 2 <= secs.length, `≤${Math.floor(secs.length / 2)} 个未测`, `缺 ${miss.length}/${secs.length}：${miss.map((m) => m.id).join(" ") || "无"}`);
  }
  uncoveredIds = Object.values(perChapter).flatMap((v) => v.miss).sort();
  if (!BASE) {
    flow.record("首次建立覆盖缺口基线", `${uncoveredIds.length} 个未测节：${uncoveredIds.join(" ")}`);
    flow.check("建立缺口基线（此后只许缩小）", true, true, true);
  } else {
    const grown = uncoveredIds.filter((id) => !(BASE.uncovered || []).includes(id));
    const shrunk = (BASE.uncovered || []).filter((id) => !uncoveredIds.includes(id));
    flow.check("不得出现新的未测节（文档加了承诺就必须有流程接住）", grown.length === 0, `≤基线 ${(BASE.uncovered || []).length} 个`, grown);
    if (shrunk.length) flow.record("缺口已缩小，基线可收紧", `新覆盖 ${shrunk.join(" ")}`);
    // 方向要摆对：这条抓的是「有流程被删掉」，所以流程数**只许不减**；新增流程是好事，要把基线抬高。
    flow.check("流程总数不得少于基线（有流程被删要在这里发现）", Object.keys(cites).length >= (BASE.flowCount || 0), `≥${BASE.flowCount} 条`, Object.keys(cites).length);
  }

  flow.section("R3 每条流程都要真的写明依据（零 cites 的流程＝不知道自己在测什么）");
  const naked = Object.entries(cites).filter(([, v]) => v.length === 0).map(([k]) => k);
  flow.check("每条流程都声明了 § 依据", naked.length === 0, "全部声明", naked);
  const lonely = allCites.filter((c) => Object.values(cites).filter((v) => v.includes(c)).length === 1);
  flow.record("只被一条流程引用的章节数", `${new Set(lonely).size}（这些节没有交叉验证）`);
  flow.check("绝大多数章节不止一条流程引用", new Set(lonely).size / new Set(allCites).size < 0.75, "交叉覆盖 ≥25%", `${new Set(lonely).size}/${new Set(allCites).size}`);

  flow.section("R4 里程碑清单（§9.1 M1…M15）：无人点名的里程碑按棘轮只许减少");
  const ms = new Set();
  for (const m of guide.matchAll(/###?\s*M(\d{1,2})\b/g)) ms.add(Number(m[1]));
  const citedM = new Set();
  const chapterOf = {};
  for (const f of fs.readdirSync(path.join(ROOT, "tests", "flows")).filter((x) => /^f\d+.*\.cjs$/.test(x))) {
    const txt = read(path.join(ROOT, "tests", "flows", f));
    for (const m of txt.matchAll(/M(\d{1,2})/g)) citedM.add(Number(m[1]));
    const cm = txt.match(/cites:\s*\[([\s\S]*?)\]/);
    if (cm) for (const m of cm[1].matchAll(/§\s*(\d+)/g)) chapterOf[m[1]] = true;
  }
  const unmentioned = [...ms].filter((n) => !citedM.has(n)).sort((a, b) => a - b);
  unmentionedIds = unmentioned.map((n) => "M" + n);
  flow.record("指南抓到的里程碑编号", [...ms].sort((a, b) => a - b).join(" "));
  flow.record("被流程点名引用过的里程碑", [...citedM].sort((a, b) => a - b).map((n) => "M" + n).join(" ") || "（无）");
  flow.record("未点名里程碑（多为按 § 章引用而非按 M 号引用）", unmentionedIds.join(" ") || "（无）");
  if (!BASE) {
    flow.check("建立里程碑点名基线（此后只许减少）", true, true, true);
  } else {
    const grown = unmentionedIds.filter((x) => !(BASE.unmentionedMilestones || []).includes(x));
    flow.check("不得有新增的无人点名里程碑", grown.length === 0, `≤基线 ${(BASE.unmentionedMilestones || []).length} 个`, grown);
  }
  const missingChapters = chapters.filter((c) => !chapterOf[c]);
  flow.check("§4/§5/§6/§7 四章都要有流程按章引用", missingChapters.length === 0, "四章全覆盖", missingChapters);

  // ---------- 基线落盘（只在首次或缺口收窄时收紧，永不放松） ----------
  const needWrite = !BASE || uncoveredIds.length < (BASE.uncovered || []).length || unmentionedIds.length < (BASE.unmentionedMilestones || []).length || Object.keys(cites).length > (BASE.flowCount || 0);
  if (needWrite) {
    fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
    fs.writeFileSync(BASELINE_FILE, JSON.stringify({ uncovered: uncoveredIds, unmentionedMilestones: unmentionedIds, flowCount: Object.keys(cites).length, perChapter }, null, 2), "utf8");
    flow.record("基线已写入/收紧", `${BASELINE_FILE.replace(ROOT + "/", "")}：未测节 ${uncoveredIds.length}、未点名里程碑 ${unmentionedIds.length}`);
  }
});
