// F27 克制红线：未实现的层不许偷跑，禁项必须是机器可查的（换角度：测「不做的事」）
// @runtime: node  @tier: 1  @gui: false  @id: F27  @timeout: 120
// 运行：node tests/flows/f27-restraint-redlines.cjs
//
// 角度：指导文档里有一整类特殊契约——它规定的是**不许做什么**：
//       §6.6.6「首次达成由 review_seq 重算，不落表、不另存事实」；§6.6.7 Territory「不新增事实状态」；
//       §6.6.5 禁由一次 Good 直接生成成长事件、禁由累计数量生成；§6.6.4 取消项（学习步毕业、
//       巩固 21 天）不产生任何提示且「保留在分级表中标注取消，防未来实现者加回」；
//       §4.10-3 禁无数据的假扫描动画；§1.10 AI 不是事实源；D29 禁自动扩产/自动入队。
//       这类条款最容易「将来某次顺手就破了」，而且破了也没有功能报错。
//       这条把禁项逐条变成机器检查：现在全过，价值在于以后谁加回来会在这里变红。
//
// 依据：§6.6.4/6.6.5/6.6.6/6.6.7、§4.10-3、§1.9、§1.10、D29、§6.3.8、§7.2。
"use strict";
const fs = require("fs");
const path = require("path");
const { Flow, runFlow, ROOT } = require("./lib/harness.cjs");

const flow = new Flow({
  id: "F27",
  title: "克制红线：未实现层不得偷跑",
  angle: "把「不许做」写成断言：不落表、不新增事实状态、不产取消项提示、不做假动画与经验值",
  cites: ["§6.6.4", "§6.6.5", "§6.6.6", "§6.6.7", "§4.10-3", "§1.9", "§1.10", "D29", "§6.3.8", "§7.2"],
  tier: 1,
  gui: false,
});

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
function walk(dir, re, acc = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return acc;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name === ".git") continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) walk(rel, re, acc);
    else if (re.test(e.name)) acc.push(rel);
  }
  return acc;
}
const SRC = walk("src", /\.(ts|tsx|css)$/);
const EL = walk("electron", /\.js$/);
const dbSrc = read("electron/db.js");
/** 抽出 CREATE TABLE 块 → 表名与列名 */
const tables = {};
for (const m of dbSrc.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s*[（(]?\s*(\w+)/g)) tables[m[1]] = true;
for (const m of dbSrc.matchAll(/CREATE TABLE[^;]*?\(([\s\S]*?)\n\);/g)) {
  const name = m[0].match(/CREATE TABLE(?: IF NOT EXISTS)?\s*\(?(\w+)/);
  if (!name) continue;
  const cols = [...m[1].matchAll(/^\s*(\w+)\s+(TEXT|INTEGER|REAL|BLOB|NUMERIC)/gmi)].map((c) => c[1]);
  tables[name[1]] = cols;
}

runFlow(flow, async () => {
  // ---------- W1 不落表：成长/里程碑/Territory 都不得有自己的表或列 ----------
  flow.section("W1 「不落表、不另存事实」（§6.6.6）与「不新增事实状态」（§6.6.7）在 schema 上成立");
  const bannedTables = /growth|milestone|territory|xp|achievement|badge|streak_event|reward/i;
  const hitTables = Object.keys(tables).filter((t) => bannedTables.test(t));
  flow.record("库表总数", String(Object.keys(tables).length));
  flow.check("不得存在成长事件/里程碑/疆域/经验值/徽章类表", hitTables.length === 0, "零张", hitTables);
  const bannedCols = /(_xp$|^xp_|mastery_level|growth_tier|badge_|territory_state|streak_reward)/i;
  const hitCols = [];
  for (const [t, cols] of Object.entries(tables)) if (Array.isArray(cols)) for (const c of cols) if (bannedCols.test(c)) hitCols.push(`${t}.${c}`);
  flow.check("列名里不得出现新增的『能力/疆域』事实状态", hitCols.length === 0, "零列", hitCols);
  flow.check("mastery 只允许是 §4.7 的四态字段，不得变成数值经验", /mastery_state|mastery_json|state/.test(dbSrc) && !/mastery\s+(INTEGER|REAL)\b/.test(dbSrc), "四态而非数值", (dbSrc.match(/mastery\s+(INTEGER|REAL)/g) || []).join(" "));

  // ---------- W2 未实现层不得偷跑 ----------
  flow.section("W2 §6.6 成长反馈与 §4.7-12 前沿探索仍未实现——半成品不得先落地（与 F18 的设置面检查互补）");
  const prodFiles = SRC.concat(EL);
  const leaks = [];
  for (const f of prodFiles) {
    const t = read(f);
    // \bgrowthEvents\b 收紧（终审 P1-2）：不再命中组件名 GrowthEventsWidget 等复合标识符；
    // 「禁落库」原判据不变——growth_events 表名 / insertGrowthEvent 族写入函数照旧全禁（GF-2 前仍有效）
    if (/growth_events|\bgrowthEvents\b|GrowthEventTable|territory_state/i.test(t)) leaks.push(`${f}：出现成长事件表/疆域状态`);
    if (/insertGrowthEvent|createGrowthEvent|saveMilestone/i.test(t)) leaks.push(`${f}：出现「把成长事件写进库」的函数`);
  }
  flow.check("生产代码里不得出现成长层落库实现", leaks.length === 0, "零偷跑", leaks);
  const frontier = [];
  for (const f of prodFiles) if (/frontierExploration/.test(read(f))) frontier.push(f);
  flow.eq("前沿探索开关在代码里仍是零消费者（F18 Y1 同口径，这里查生产面）", frontier.join(" "), "");

  // ---------- W3 一次评分不得直接生成能力事实 ----------
  flow.section("W3 评分路径只写 FSRS 与日志，不得顺手写 mastery / 事件 / 统计缓存（§4.7-6 / §6.6.5 禁项）");
  const at = dbSrc.indexOf("function saveReview");
  const body = dbSrc.slice(at, at + 5200);
  const writes = [...body.matchAll(/(?:db\.run\(\s*|INSERT INTO |UPDATE )([a-z_]+)/g)].map((m) => m[1]).filter(Boolean);
  const uniq = [...new Set(writes)];
  flow.record("saveReview 触达的表", uniq.join(" ") || "（未抓到）");
  const forbiddenWrites = uniq.filter((t) => /knowledge_|evidence|mastery|insight|memory_run|material_map|dict_|assets/i.test(t));
  flow.check("评分路径不得写知识层/证据层/导图/词典等他人真源", forbiddenWrites.length === 0, "只写调度侧", forbiddenWrites);
  flow.check("评分路径必须留下 review_logs 与 cards 两处事实（撤销与审计的前提）", /review_logs/.test(body) && /cards/.test(body), "两处都写", { logs: /review_logs/.test(body), cards: /cards/.test(body) });

  // ---------- W4 非惩罚性与反激励UI ----------
  flow.section("W4 不做排行榜/经验值/彩带/推送，不做惩罚性文案（§6.6.7①、§6.3.8、§1.10 精神）");
  const bad = [];
  const PATTERNS = [
    [/leaderboard|排行榜/i, "排行榜"],
    [/confetti|彩带|🎉/i, "庆祝彩带"],
    [/streak\s*(broken|lost)|连击断了|你失去了/i, "惩罚性文案"],
    [/\bxp\b|level\s*up|升级了！|经验值/i, "经验值/等级"],
    [/push notification|推送通知|webpush/i, "系统推送"],
  ];
  for (const f of SRC) {
    const t = read(f);
    for (const [re, name] of PATTERNS) {
      const m = t.match(re);
      if (m && !/^\s*(\/\/|\*|\/\*)/.test(t.split(/\r?\n/)[(t.slice(0, m.index).match(/\n/g) || []).length] || "")) bad.push(`${f}：${name}（命中「${m[0]}」）`);
    }
  }
  flow.check("界面代码里没有反激励与惩罚性元素", bad.length === 0, "零命中", bad);

  // ---------- W5 动画必须由数据驱动 ----------
  flow.section("W5 生长/点亮动画必须由真实计数驱动，禁无数据的假扫描（§4.10-3）；并遵守 prefers-reduced-motion");
  const scans = [];
  for (const f of SRC) {
    const t = read(f);
    const re = /setInterval\(([\s\S]{0,120}?)\)/g;
    let m;
    while ((m = re.exec(t))) {
      const frag = m[1];
      if (/scan|sweep|pulse|shine/.test(frag) && !/\b(data|rows|count|length|items|cards)\b/.test(frag)) scans.push(`${f}: setInterval(${frag.slice(0, 40)}…)`);
    }
  }
  flow.record("扫查的组件文件数", String(SRC.length));
  flow.check("不得出现不依赖数据的循环扫描动画", scans.length === 0, "数据驱动", scans);
  const css = read(path.join("src", "theme.css"));
  flow.check("theme.css 仍声明 prefers-reduced-motion 降级（三处先例不回退）", (css.match(/prefers-reduced-motion/g) || []).length >= 2, "≥2 处", (css.match(/prefers-reduced-motion/g) || []).length);

  // ---------- W6 取消项不得复活 ----------
  flow.section("W6 「取消项」防加回：学习步毕业与巩固 21 天不得成为提示事件（§6.6.4 用户判定）");
  const revival = [];
  for (const f of prodFiles) {
    const t = read(f);
    if (/graduat(e|ion)|学习步毕业/.test(t) && /toast|notice|prompt|提示|celebrat/i.test(t)) revival.push(`${f}：学习步毕业与提示语同现`);
    if (/consolidat(ed|ion)\s*(21|>=\s*21)|巩固\s*21/.test(t) && /toast|notice|提示/.test(t)) revival.push(`${f}：巩固 21 天与提示语同现`);
  }
  flow.check("两个已取消的里程碑不得被重新接上提示", revival.length === 0, "未复活", revival);
  const doc = read("AI_DEVELOPMENT_GUIDE.md");
  flow.check("文档里『取消』标注仍在（标注本身就是防加回的护栏）", /保留在分级表中标注"?(取消|「取消」)/.test(doc) || /标注.{0,4}取消/.test(doc), "护栏未丢", "文档已删掉该标注？");
}).then((s) => {
  process.exit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length ? 1 : 0);
});
