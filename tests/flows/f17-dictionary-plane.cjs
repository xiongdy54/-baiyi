// F17 词典数据面隔离与来源生命周期流程（换角度：另一个库、另一套生死）
// @runtime: electron  @tier: 3  @gui: false  @id: F17  @timeout: 420
// 运行：npx electron tests/flows/f17-dictionary-plane.cjs   （或 node tests/flows/run.cjs --only F17）
//
// 角度：词典是本项目唯一**故意放在主库之外**的数据（dictionary.db），理由写在 §7.4 v32 追记④：
//       ECDICT 全量 340 万行若进主库，sql.js 的「每次写卡全量回写」会被拖死。
//       这条验证的就是这层隔离本身与词条的生死循环：解析→入库→按名 upsert→按词检索→
//       多来源不串→删除后 VACUUM 真收缩。既有 m7.test.cjs 纵向测 84 个函数断言，
//       但没跨「独立库 / 主库 persist 时长 / 体积回收」这条线。
//
// 依据：§7.4 v32 追记②③④（独立 dictionary.db、curl 实测直链、importDictRowsFromPath 统一路由、
//       按名 upsert 自愈、done/saved/done-capped 状态语义、removeSource 的 VACUUM）、§4.2（缓存许可）。
"use strict";
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { Flow, runFlow, tmpUserDataDir, freshDir, ROOT } = require("./lib/harness.cjs");
const { audit, quit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F17",
  title: "词典数据面隔离与来源生命周期",
  angle: "第二个库的隔离承诺与词条生死循环",
  cites: ["§7.4 v32②③④", "§4.2", "§7.1.8"],
  tier: 3,
  gui: false,
});

const CEDICT_SAMPLE = [
  "# CEDICT sample data",
  "# Format: traditional simplified, [pinyin] /glossary/",
  "苹果 苹果 [ping2 guo3] /apple/apple tree/",
  "測試 测试 [ce4 shi4] /to test/",
  "學習 学习 [xue2 xi2] /to learn/",
  "時間 时间 [shi2 jian1] /time/",
  "記憶 记忆 [ji4 yi4] /memory/",
].join("\n");

function ecdictCsv(n) {
  const lines = ["word,pos,phonetic,definition,translation,collins,oxford,tag,bnc,frq,exchange,detail,audio"];
  for (let i = 0; i < n; i++) lines.push(`word${i},n,/w${i}/,definition ${i},释义${i},0,0,,0,0,,,0`);
  return lines.join("\n");
}

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f17"));
    app.setPath("userData", dir);
    const mainDbFile = path.join(dir, "library.db");
    const dictFile = path.join(dir, "dictionary.db");

    const s = await runFlow(flow, async () => {
      const db = require(path.join(ROOT, "electron", "db.js"));
      await db.initDb();
      const dictDb = require(path.join(ROOT, "electron", "dictDb.js"));
      const store = require(path.join(ROOT, "electron", "dictStore.js"));
      const src = require(path.join(ROOT, "tests", "tmp-m7", "dict.js"));

      // ---------- X1 两库分离 ----------
      flow.section("X1 词条入独立库，主库写路径不被拖垮（§7.4 v32 追记④）");
      await dictDb.open();
      flow.check("open() 后尚未落盘（词条库只在导入/删除时写文件）", fs.existsSync(dictFile), false);
      flow.check("词条没进主库（library.db 里没有 dict_entries）", (await audit(mainDbFile)).tables().includes("dict_entries"), false);
      const rows100 = Array.from({ length: 100 }, (_, i) => ({ headword: `w${i}`, phonetic: `/w${i}/`, pos: "n", html: `释义${i}` }));
      const ins = await dictDb.insertRows("flowtest-mini", rows100);
      flow.record("insertRows 返回", JSON.stringify(ins).slice(0, 120));
      flow.eq("计数对得上", await dictDb.countBySource("flowtest-mini"), 100);
      flow.check("导入后 dictionary.db 独立成文件", fs.existsSync(dictFile), true, fs.existsSync(dictFile));
      const t0 = Date.now();
      for (let i = 0; i < 60; i++) db.createCard({ noteText: `F17 卡 ${i}`, cardType: "qa", frontMarkdown: `q${i}`, backMarkdown: `a${i}`, priority: 50, tags: [], fsrsJson: JSON.stringify({ state: "new", due: Date.now(), lapses: 0 }) });
      const writeMs = Date.now() - t0;
      flow.record("灌 100 词条后主库写 60 张卡耗时", `${writeMs}ms`);
      flow.check("主库写路径未被词典体积拖慢（60 张卡 < 4s）", writeMs < 4000, "<4000ms", writeMs);

      // ---------- X2 真解析器 → 入库 → 检索闭环 ----------
      flow.section("X2 CEDICT 文本 → 解析 → 入库 → 按词命中（端到端闭环，不触网）");
      const parsed = store.parseCedictText(CEDICT_SAMPLE);
      const list = Array.isArray(parsed) ? parsed : await (async () => { const out = []; for await (const r of parsed) out.push(r); return out; })();
      flow.check("解析出词条（含简繁与拼音）", list.length >= 5, "≥5", list.length);
      flow.record("首条形状", JSON.stringify(list[0]).slice(0, 150));
      const insCed = await dictDb.insertRows("flowtest-cedict", list);
      flow.record("CEDICT 插入返回", JSON.stringify(insCed).slice(0, 120));
      const hit = await dictDb.lookup("苹果");
      flow.check("按中文头词查得到释义", JSON.stringify(hit).includes("apple"), true, JSON.stringify(hit).slice(0, 140));
      const miss = await dictDb.lookup("不存在的词zzz");
      flow.eq("查不到时返回空而不是假命中", Array.isArray(miss) ? miss.length : miss ? 1 : 0, 0);

      // ---------- X3 大小写与规范化 ----------
      flow.section("X3 大小写变体归一（v32 追记①：moral/Moral 不再双查）");
      const normFns = Object.keys(src).filter((k) => /norm|guessLang|resolveLookup|pickLocal/i.test(k));
      flow.record("dict.ts 暴露的规范化/路由函数", normFns.join(" ") || "（未导出）");
      const ecd = store.parseEcdictCsv(ecdictCsv(300));
      const ecdList = Array.isArray(ecd) ? ecd : await (async () => { const o = []; for await (const r of ecd) o.push(r); return o; })();
      flow.check("ECDICT CSV 解析出行", ecdList.length >= 300, "≥300", ecdList.length);
      await dictDb.insertRows("flowtest-ecdict", ecdList);
      const upper = await dictDb.lookup("WORD0");
      const lower = await dictDb.lookup("word0");
      flow.eq("大小写两种查法命中同一条（归一化在库侧生效）", JSON.stringify(upper) === JSON.stringify(lower) && JSON.stringify(upper).includes("word0"), true);

      // ---------- X4 多来源不串 ----------
      flow.section("X4 多来源同名共存（来源徽标的数据依据）");
      await dictDb.insertRows("flowtest-second", [{ headword: "苹果", phonetic: "/ping2guo3/", pos: "n", html: "第二个来源的释义" }]);
      const both = await dictDb.lookup("苹果");
      const txt = JSON.stringify(both);
      flow.check("同名词条两个来源并存不互相覆盖", txt.includes("apple") && txt.includes("第二个来源的释义"), true, txt.slice(0, 200));
      const c1 = await dictDb.countBySource("flowtest-cedict");
      const c2 = await dictDb.countBySource("flowtest-second");
      flow.eq("按来源计数互不污染", [c1, c2], [list.length, 1]);

      // ---------- X5 重复导入幂等（按名 upsert 自愈） ----------
      flow.section("X5 重复导入同一批不翻倍（按名 upsert 自愈的库侧）");
      await dictDb.insertRows("flowtest-second", [{ headword: "苹果", phonetic: "/ping2guo3/", pos: "n", html: "第二个来源的释义（重复导入）" }]);
      flow.eq("重复导入后该来源仍 1 行", await dictDb.countBySource("flowtest-second"), 1);
      const after = await dictDb.lookup("苹果");
      flow.record("词条侧重复导入的行为", JSON.stringify(after).includes("重复导入") ? "覆盖（upsert）" : "保留首次内容（INSERT OR IGNORE）——文档的按名自愈指的是来源登记表");
      await dictDb.insertRows("flowtest-cedict", list);
      flow.eq("整批重放不翻倍", await dictDb.countBySource("flowtest-cedict"), c1);

      // ---------- X6 上限与截断诚实性 ----------
      flow.section("X6 达到 cap 时必须可辨（done-capped 不允许静默丢）");
      const big = Array.from({ length: 50 }, (_, i) => ({ headword: `cap${i}`, phonetic: "", pos: "", html: `x${i}` }));
      const capped = await dictDb.insertRows("flowtest-cap", big, 10);
      flow.record("cap=10 时返回", JSON.stringify(capped).slice(0, 160));
      const stored = await dictDb.countBySource("flowtest-cap");
      flow.check("截断确实生效（行数 ≤ cap）", stored <= 10, "≤10", stored);
      flow.check("截断被显式说出来（返回值里有截断/计数信息）", /cap|truncat|inserted|count|skipped|done/i.test(JSON.stringify(capped)), true, JSON.stringify(capped).slice(0, 120));

      // ---------- X7 删除与体积回收 ----------
      flow.section("X7 removeSource 后真收缩（VACUUM 承诺，别再留 950MB 空闲页）");
      const fat = Array.from({ length: 4000 }, (_, i) => ({ headword: `fat${i}`, phonetic: "", pos: "", html: "填充内容填充内容填充内容填充内容" }));
      await dictDb.insertRows("flowtest-fat", fat);
      const sizeBefore = fs.statSync(dictFile).size;
      await dictDb.removeSource("flowtest-fat");
      const after0 = await dictDb.countBySource("flowtest-fat");
      flow.eq("删除后该来源零残留", after0, 0);
      const sizeAfter = fs.statSync(dictFile).size;
      flow.record("dictionary.db 体积", `${Math.round(sizeBefore / 1024)}KB → ${Math.round(sizeAfter / 1024)}KB`);
      flow.check("删除后文件明显收缩（VACUUM 生效）", sizeAfter < sizeBefore, "缩小", { sizeBefore, sizeAfter });
      flow.check("其他来源不受牵连", await dictDb.countBySource("flowtest-cedict"), c1);

      // ---------- X8 缓存与许可（主库侧） ----------
      flow.section("X8 词典缓存在主库、与词条库分工（§4.2 / §7.4 D31）");
      const mainTables = (await audit(mainDbFile)).tables();
      flow.check("dictionary_cache 与 dict_sources 在主库（登记态而非词条正文）", mainTables.includes("dictionary_cache") && mainTables.includes("dict_sources"), true, mainTables.join(","));
      db.setDictCache("flowtest", "zh", "moral", { def: "第一次" }, "v1");
      db.setDictCache("flowtest", "zh", "moral", { def: "第二次" }, "v2");
      const cached = db.getDictCache("flowtest", "zh", "moral");
      flow.check("同 key 覆盖不产生双行（INSERT OR REPLACE）", JSON.stringify(cached).includes("第二次") && !JSON.stringify(cached).includes("第一次"), true, JSON.stringify(cached).slice(0, 140));
      flow.eq("缓存表只有一行", (await audit(mainDbFile)).rows("SELECT COUNT(*) AS n FROM dictionary_cache WHERE normalized_word='moral'")[0].n, 1);
      // 来源登记：仓储层按 id upsert，「按名自愈」发生在主进程导入路径（main.js:787 先按名找 id 再复用）
      const src1 = db.upsertDictSource({ name: "F17 同名词典", format: "csv", entryCount: 10 });
      const src2 = db.upsertDictSource({ name: "F17 同名词典", format: "csv", entryCount: 20 });
      const dupNames = db.listDictSources().filter((s) => s.name === "F17 同名词典");
      flow.record("仓储层 upsertDictSource 是否按名去重", dupNames.length === 1 ? "按名去重" : "按 id 去重（同两次调用会产生两行）");
      flow.check("主进程导入路径按名复用 id（自愈的真实落点）", /listDictSources\(\)[\s\S]{0,60}\.name === name/.test(fs.readFileSync(path.join(ROOT, "electron", "main.js"), "utf8")), true, "未找到");
      flow.eq("未写入来源的删除返回安全值", await dictDb.countBySource("从没见过的来源"), 0);

      // ---------- X9 不触网纪律 ----------
      flow.section("X9 本流程不触网（与 §7.5 一致；在线 Provider 由 m7.dict.e2e 单独覆盖）");
      flow.record("联网函数是否被本流程调用", "lookupOnline / lookupFreeDictionary 未调用");
      flow.check("主进程词典模块不向开发者端点上送", !/telemetry|analytics|track\(/.test(store.constructor === Function ? "" : require("fs").readFileSync(path.join(ROOT, "electron", "dictStore.js"), "utf8")), true);
      flow.record("src/lib/dict.ts 规范化函数存在", normFns.length > 0 ? "有" : "未见（可能在 bundle 内部）");
    });

    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F17 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String((e && e.message) || e) });
    process.exit(1);
  });
