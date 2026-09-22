// F26 显示文本口径对账（换角度：用户看到的不是数据而是字符串）
// @runtime: node  @tier: 1  @gui: false  @id: F26  @timeout: 180
// 运行：node tests/flows/f26-display-text.cjs
//
// 角度：前 25 条测的都是「库里的事实对不对」，这条测「事实翻成中文之后还对不对」。
//       同一张卡的到期时间在复习页与卡片浏览页各有一份格式化函数（fsrs.ts:161 与
//       CardBrowser.tsx:57 两份逐字相同的拷贝）——今天一致，改一处忘另一处就是
//       「同一本书在两个页面说两种话」，而且没有任何检查会发现。
//       这条把可静态求值的显示函数全部用 esbuild 打进本进程，喂边界值与非法值，
//       要求：不抛、不返回 undefined/空串/"NaN …"，同一个时间戳在三个页面口径一致。
//
// 依据：§5.4（图注卡：进度与上次阅读常驻可读）、§6.2（到期文案与四档预览同源）、
//       §4.12-4（自然日口径）、§6.5（日记日期标签）、§7.1.3（边界输入不得穿透）、
//       §7.1.6（同一事实只有一个展示口径）。
"use strict";
const fs = require("fs");
const path = require("path");
const { Flow, runFlow, tmpUserDataDir, ROOT } = require("./lib/harness.cjs");

const flow = new Flow({
  id: "F26",
  title: "显示文本口径对账",
  angle: "格式化函数逐字对齐 + 边界值不产 junk + 同一时间戳跨页同口径",
  cites: ["§5.4", "§6.2", "§4.12-4", "§6.5", "§7.1.3", "§7.1.6"],
  tier: 1,
  gui: false,
});

globalThis.window = { settingsAPI: undefined };
const outDir = path.join(ROOT, "tests", "tmp-f26");
fs.mkdirSync(outDir, { recursive: true });

function loadTs(rel, outName) {
  const esbuild = require("esbuild");
  const out = path.join(outDir, outName);
  esbuild.buildSync({ entryPoints: [path.join(ROOT, rel)], bundle: true, write: true, outfile: out, format: "cjs", platform: "neutral", target: "es2020", logLevel: "silent" });
  delete require.cache[out];
  return require(out);
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
/** 抽出某个 function 的函数体（按花括号配对） */
function fnBody(src, name) {
  const at = src.indexOf("function " + name + "(");
  if (at < 0) return null;
  let i = src.indexOf("{", at);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (depth === 0) return src.slice(i, j + 1).replace(/\s+/g, " ").trim(); }
  }
  return null;
}

runFlow(flow, async () => {
  const shelf = loadTs(path.join("src", "lib", "shelf.ts"), "shelf.cjs");
  const journal = loadTs(path.join("src", "lib", "journal.ts"), "journal.cjs");
  const udc = loadTs(path.join("src", "lib", "udc.ts"), "udc.cjs");
  const knowledge = loadTs(path.join("src", "lib", "knowledge.ts"), "knowledge.cjs");
  const dict = loadTs(path.join("src", "lib", "dict.ts"), "dict.cjs");
  const library = loadTs(path.join("src", "lib", "library.ts"), "library.cjs");
  const kpNorm = require(path.join(ROOT, "electron", "kpNorm.js"));

  // ---------- P1 两份到期时间格式化必须逐字相同 ----------
  flow.section("P1 同一事实的两份格式化实现必须逐字相同（fsrs.ts 与 CardBrowser.tsx 各一份拷贝，§7.1.6）");
  const CB = path.join("src", "components", "CardBrowser.tsx");
  const a = fnBody(read(path.join("src", "lib", "fsrs.ts")), "formatInterval");
  const b = fnBody(read(CB), "formatDue");
  flow.check("两处实现都能抓到函数体", !!a && !!b, "抓得到", { fsrs: !!a, cardBrowser: !!b });
  flow.check("两份拷贝当前逐字相同（一旦不同必须抽公共函数，否则两页各说各话）", a === b, "逐字相同", a === b ? "（相同）" : `fsrs.ts: ${a}\n  CardBrowser.tsx: ${b}`);
  const dupCount = (read(path.join("src", "lib", "fsrs.ts")) + read(CB)).match(/days < 1 \/ 24/g) || [];
  flow.record("同一阈值出现的次数", dupCount.length + " 处（≥2 即存在漂移面）");
  flow.check("到期档位阈值不允许多处出现而无人看守（本条把两处钉成逐字相同）", dupCount.length === 2, "2 处且已对账", dupCount.length);

  // ---------- P2 边界值不得产出 junk ----------
  flow.section("P2 格式化函数喂边界与非法值：不抛、不空、不 NaN、不 undefined（§7.1.3）");
  const junk = [];
  // 空串单列：非法输入下「什么都不显示」是合理语义（dayLabel 自己的 `if (!ms) return ""` 就是这个设计），
  // 有效性由 P3 的五个合法时间戳守。复核修正：原来把空串也算 junk，等于把正确行为报成缺陷。
  const empties = [];
  // 复核修正：JSON.stringify(NaN) 与 JSON.stringify(Infinity) 都是 "null"，证据里分不清是谁——改用能区分的标签
  const lab = (x) => (typeof x === "number" ? String(x) : x === undefined ? "undefined" : JSON.stringify(x));
  const probe = (label, fn, args) => {
    for (const x of args) {
      let out;
      try {
        out = fn(x);
      } catch (e) {
        junk.push(`${label}(${lab(x)}): 抛错 ${String((e && e.message) || e).slice(0, 22)}`);
        continue;
      }
      if (out === undefined || out === null) junk.push(`${label}(${lab(x)}): 返回 ${out}`);
      else if (typeof out === "string" && /NaN|Infinity|undefined|\[object/.test(out)) junk.push(`${label}(${lab(x)}): 产出「${out}」`);
      else if (typeof out === "string" && !out.trim()) empties.push(`${label}(${lab(x)})`);
    }
  };
  const times = [0, -1, 1, 0.5, 59999, 60000, 3600000, 86399999, 86400000, 2592000000, 31536000000, 1e18, NaN, -86400000, Infinity, -Infinity];
  probe("shelf.dayLabel", shelf.dayLabel, [0, -1, NaN, Infinity, 1e18, Date.now()]);
  probe("shelf.pct", shelf.pct, [0, 1, -1, 1.5, NaN, Infinity, 0.004]);
  probe("journal.journalDateLabel", (x) => journal.journalDateLabel(x), ["2026-09-22", "2026-2-5", "2026-02-30", "", "abc", null, undefined, 1758500000000, "2026-09-22T23:59:00"]);
  probe("udc.udcLabel", (x) => udc.udcLabel(x), ["other", "", "abc", null, undefined, "999"]);
  probe("knowledge.relationLabel", (x) => knowledge.relationLabel(x), ["", "unknown_rel", null, undefined]);
  probe("dict.languageLabel", (x) => dict.languageLabel(x), ["", "xx", null, undefined, "EN", "JA"]);
  probe("library.lastReadDisplay", (x) => library.lastReadDisplay(x), [{ progressJson: "{坏" }, { progressJson: '{"lastText":"一句"}' }, {}, null, undefined]);
  probe("kpNorm.normalizeKpLabel", (x) => kpNorm.normalizeKpLabel(x), ["  间隔  重复  ", "", null, undefined, "ＡＢＣ", "___", "1".repeat(500)]);
  flow.record("探针取值组数", `七个展示函数 × 边界/非法值`);
  flow.record("空串结果（非法输入下允许沉默）", empties.length ? empties.join(" ") : "（无）");
  void times;
  // 批次 D（D-TEST-19）的登记范围只有三个展示函数（shelf.pct / shelf.dayLabel /
  // journal.journalDateLabel，见规格附录第 4 条）；P2 的探针打的是七个函数。
  // 所以判据按登记范围分档：那三个 → 硬断言；其余四个（udc/knowledge/library/dict 对
  // null|undefined 返回 null|undefined）→ 继续挂 D-TEST-19 名下报已知，不许顺手丢掉。
  const d19 = (j) => /^(shelf|journal)\./.test(j);
  const d19Junk = junk.filter((j) => !/lastReadDisplay\(null\)/.test(j) && d19(j));
  const otherJunk = junk.filter((j) => !/lastReadDisplay\(null\)/.test(j) && !d19(j));
  flow.check("展示函数对非法数值不得产出 junk（NaN / Infinity / undefined / [object；空串不算，那是「不显示」的合理语义）", d19Junk.length === 0, "全部可展示", d19Junk);
  flow.record("登记范围外的 junk（同族，批次 D 未点名）", otherJunk.join(" ") || "（无）");
  flow.known(
    "shelf/journal 之外的展示函数对 null/undefined 仍返回 null/undefined（D-TEST-19 只登记三个，批次 D 只修三个）",
    otherJunk.length === 0,
    "D-TEST-19",
    "全部可展示",
    otherJunk
  );
  // 复核补测（2026-09-22）：无效日期必须在展示层被拒，否则会印出自相矛盾的标签——
  // 实现里只有格式正则（journal.ts:174），"2026-02-30" 通过正则后交给 new Date(2026,1,30) 静默进位到 3/2，
  // 于是标签写「02-30」而星期取的是 3 月 2 日的。这条原来是静态推断、没有断言，复核时补上。
  const roll = journal.journalDateLabel("2026-02-30");
  flow.record("不存在的一天 2026-02-30 的展示", JSON.stringify(roll));
  flow.check("不存在的日子（2026-02-30）必须被展示层拒绝，而不是静默进位成别人的星期", roll === "", "空串", JSON.stringify(roll));
  // 批次 D（D-TEST-19）新增两条：
  // ① pct 的返回值同时被当 CSS 宽度用（Bookshelf 里 width: pct(progress)），
  //    所以**非有限**输入必须回落成合法长度；负数是合法入参、既有输出 "-100%" 不在本条范围内。
  flow.eq("pct 对非有限入参产出合法 CSS 长度（/^\\d+%$/）", [NaN, Infinity, -Infinity, "abc", null, undefined].every((v) => /^\d+%$/.test(shelf.pct(v))), true);
  // ② 合法入参的输出逐字不变 + dayLabel(0)/dayLabel(NaN) 仍返回 ""（不回归）
  flow.eq("dayLabel 合法毫秒仍产出 MM-DD", /^\d{2}-\d{2}$/.test(shelf.dayLabel(1758500000000)), true);
  flow.eq("dayLabel(0) / dayLabel(NaN) 保持空串（原有语义不回归）", JSON.stringify([shelf.dayLabel(0), shelf.dayLabel(NaN)]), JSON.stringify(["", ""]));
  flow.eq("journalDateLabel 合法日期仍产出「MM-DD 周X」形状", /^\d{2}-\d{2} 周[日一二三四五六]$/.test(journal.journalDateLabel("2026-09-22")), true);
  flow.eq("星期与日子自洽（标签里的周几必须取自同一天，不得进位）", journal.journalDateLabel("2026-09-22").slice(-1), "日一二三四五六"[new Date(2026, 8, 22).getDay()]);

  // ---------- P3 同一时间戳跨页同口径 ----------
  flow.section("P3 同一个时间戳，书架「上次阅读」与日记日期标签必须说同一个日子（§4.12-4 / §7.1.6）");
  const DAY = 86400000;
  const stamps = [Date.now(), Date.now() - DAY, Date.now() - 2 * DAY, new Date(2026, 0, 1, 0, 5).getTime(), new Date(2026, 0, 1, 23, 55).getTime()];
  const crossBad = [];
  for (const ms of stamps) {
    const day = shelf.dayLabel(ms);
    const d = new Date(ms);
    const p = (x) => String(x).padStart(2, "0");
    if (day !== `${p(d.getMonth() + 1)}-${p(d.getDate())}`) crossBad.push(`${ms}: dayLabel=${day} 本地日=${p(d.getMonth() + 1)}-${p(d.getDate())}`);
    const jdl = journal.journalDateLabel(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
    if (!jdl || /NaN/.test(jdl)) crossBad.push(`${ms}: journalDateLabel=${JSON.stringify(jdl)}`);
  }
  flow.check("五个时间戳的日粒度展示互相一致", crossBad.length === 0, "同一日子", crossBad);
  const lr = library.lastReadDisplay({ progressJson: '{"ratio":0.5}', markdown: "第一章 渐进阅读的实践与反复复习的节律。" });
  flow.record("书架上次阅读展示样本", String(lr).slice(0, 60));
  flow.check("没写过 lastText 时回退正文摘要（非空、不残留 JSON 括号，§5.4 图注常驻可读）", !!lr && /渐进阅读/.test(lr) && !/[{}]/.test(lr), "可读摘要", String(lr).slice(0, 50));
  flow.eq("有 lastText 时优先展示上次停在哪", library.lastReadDisplay({ progressJson: '{"lastText":"上次停在这一段"}', markdown: "别的正文" }), "上次停在这一段");
  flow.eq("坏 progressJson 不得污染展示", library.lastReadDisplay({ progressJson: "{坏", markdown: "回退正文。" }), "回退正文。");

  // ---------- P4 相对日表述不得被墙钟抖动改写 ----------
  flow.section("P4 「今天/昨天」这类相对表述在同一毫秒输入下必须稳定（§6.5 日记分组）");
  const target = new Date();
  const iso = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(target.getDate()).padStart(2, "0")}`;
  const two = [journal.journalDateLabel(iso), journal.journalDateLabel(iso)];
  flow.eq("同一输入两次调用逐字相同", two[1], two[0]);
  const withYear = journal.journalDateLabel(iso, { withYear: true });
  flow.check("withYear 开关确实改变展示且都含月-日", withYear !== two[0] && /\d/.test(withYear) && /\d/.test(two[0]), "开关有效", { withYear, plain: two[0] });
  flow.record("今日标签样本", `${two[0]} / ${withYear}`);

  // ---------- P5 码表映射的命中率 ----------
  flow.section("P5 分类与关系映射：常用码必须翻成人话，未知码不得留空（§4.2-9 UDC / §4.6 关系类型）");
  const rels = ["supports", "contradicts", "part_of", "instance_of", "related"];
  const relOut = rels.map((r) => [r, knowledge.relationLabel(r)]);
  flow.check("五个常用关系都有中文标签", relOut.every(([, v]) => typeof v === "string" && v.trim().length > 0 && v !== "unknown_rel"), "全部有", relOut.filter(([, v]) => !v || v === "unknown_rel").map(([k]) => k));
  /** 从源码里抽 { code: "x", label: "y" } 数组（按数组名定位，避免跨数组串味） */
  const tableOf = (src, arrName) => {
    const at = src.indexOf(arrName);
    if (at < 0) return [];
    const end = src.indexOf("];", at);
    const body = src.slice(at, end);
    return [...body.matchAll(/code:\s*"([^"]+)"\s*,\s*label:\s*"([^"]+)"/g)].map((m) => ({ code: m[1], label: m[2] }));
  };
  const srcUdc = read(path.join("src", "lib", "udc.ts"));
  const elUdc = read(path.join("electron", "udc.js"));
  const leaves = tableOf(srcUdc, "UDC_LEAVES");
  const mains = tableOf(srcUdc, "UDC_MAIN");
  flow.record("src 码表规模", `叶子 ${leaves.length} · 大类 ${mains.length}`);
  flow.check("每个叶子码都按登记翻成中文标签（udcLabel 查的是 UDC_LEAVES）", leaves.length >= 20 && leaves.every((l) => udc.udcLabel(l.code) === l.label), "逐一对应", leaves.filter((l) => udc.udcLabel(l.code) !== l.label).map((l) => `${l.code}→${udc.udcLabel(l.code)}`).slice(0, 6));
  const elLeaves = tableOf(elUdc, "UDC_LEAVES").concat(tableOf(elUdc, "LEAVES"));
  flow.record("electron/udc.js 里的码表条数", String(elLeaves.length));
  if (elLeaves.length) {
    const diff = elLeaves.filter((e) => { const s = leaves.find((x) => x.code === e.code); return !s || s.label !== e.label; }).map((e) => `${e.code}:${e.label}`);
    flow.check("注释承诺「与 electron/udc.js 同源」：两侧 code→label 必须逐项一致", diff.length === 0, "同源一致", diff.slice(0, 8));
  }
  const dualLabel = mains.filter((m) => leaves.some((l) => l.code === m.code && l.label !== m.label)).map((m) => `${m.code}: 大类表「${m.label}」vs 叶子表「${leaves.find((l) => l.code === m.code).label}」`);
  flow.record("同一 code 在两张表里标签不同（同屏图例与领域标签可能互相矛盾）", dualLabel.join(" ; ") || "（无）");
  flow.eq("未知码原样返回（不空、不 undefined）", udc.udcLabel("nope"), "nope");
  flow.eq("other 特殊码翻成「其他」", udc.udcLabel("other"), "其他");
  const langs = { en: "英语", ja: "日语", zh: "中文", ko: "韩语", fr: "法语", de: "德语", es: "西班牙语", ru: "俄语", la: "拉丁语" };
  flow.check("九种语言标签与词典侧映射一致（R6 上下文前缀口径）", Object.entries(langs).every(([k, v]) => dict.languageLabel(k) === v), "九种一致", Object.entries(langs).filter(([k, v]) => dict.languageLabel(k) !== v).map(([k]) => k));
  flow.eq("未知语言按注释登记的口径回退「词汇」", dict.languageLabel("xx"), "词汇");
  flow.eq("提示语用语言名未知回退「外文」", dict.cueName("xx"), "外文");
  flow.record("未知关系兜底样本", `${knowledge.relationLabel("no_such_rel")} / ${udc.udcLabel("nope")} / ${dict.languageLabel("xx")}`);
}).then((s) => {
  process.exit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length ? 1 : 0);
});
