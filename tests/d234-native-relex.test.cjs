// @runtime: electron
// 运行：npx electron tests/d234-native-relex.test.cjs
// D234（v49.63）：改母语后，之前按旧母语建立的词项自动清理并按新母语重建；
// 轨道变化后零计数的孤儿词项回收；settings:set 写 app.learner 时母语变化即触发后台刷新。
// 隔离：临时 userData，全新 library.db / learner.db，绝不触碰真实库。
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const ROOT = path.resolve(__dirname, "..");

let pass = 0;
let fail = 0;
function check(name, cond, expected, actual) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`);
  }
}

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "d234-relex-"));
  try {
    app.setPath("userData", tmp);
    const db = require(path.join(ROOT, "electron", "db.js"));
    const learnerDb = require(path.join(ROOT, "electron", "learnerDb.js"));
    const learnerRefresh = require(path.join(ROOT, "electron", "learnerRefresh.js"));
    const settingsStore = require(path.join(ROOT, "electron", "settingsStore.js"));
    const lmLex = require(path.join(ROOT, "electron", "lmLex.js"));
    const APPLE = lmLex.lexemeKey("apple", "en"); // 英文词项 key 为词干（apple → appl）
    await db.initDb();
    learnerRefresh.init({ extractPdfPages: async () => null });

    const setLearner = (patch) => {
      const all = settingsStore.readSettings();
      all.app = { ...(all.app || {}), learner: { ...(all.app?.learner || {}), ...patch } };
      settingsStore.writeSettings(all);
    };
    const langs = async () => new Set((await learnerDb.all("SELECT DISTINCT lang FROM lexemes")).map((r) => String(r.lang)));
    const sameSet = (a, b) => a.size === b.length && b.every((x) => a.has(x));
    const meta = (k) => learnerDb.getMeta(k);
    const maxLexId = async () => Number((await learnerDb.all("SELECT MAX(id) AS m FROM lexemes"))[0].m) || 0;
    const minLexId = async () => Number((await learnerDb.all("SELECT MIN(id) AS m FROM lexemes"))[0].m) || 0;
    const count = async (sql, params) => Number((await learnerDb.all(sql, params || []))[0].n) || 0;
    const appleState = async () => {
      const row = (await learnerDb.all(
        "SELECT l.id AS id, s.state AS state, s.source AS source FROM lexemes l LEFT JOIN lexeme_states s ON s.lexeme_id = l.id WHERE l.lang = 'en' AND l.key = ?",
        [APPLE]
      ))[0];
      return row || null;
    };

    console.log("== N1 造数：英文书 E + 中文书 Z + 日文书 J ==");
    const enText = "The apple is red and the river is long. A small apple fell near the quiet river bank today.\n".repeat(30);
    const e = db.createImportedDoc({ title: "D234 English", markdown: `# One\n${enText}\n# Two\n${enText}\n`, sourceType: "markdown" });
    const z = db.createImportedDoc({ title: "D234 中文", markdown: `# 第一章\n${"今天天气很好，我们去公园散步，看见许多孩子在草地上玩耍。\n".repeat(30)}`, sourceType: "markdown" });
    const j = db.createImportedDoc({ title: "D234 日本語", markdown: `# 第一章\n${"いろはにほへと ちりぬるを わかよたれそ つねならむ うゐのおくやま けふこえて あさきゆめみし ゑひもせす\n".repeat(20)}`, sourceType: "markdown" });
    db.setLibraryItemLang(e.id, "en");
    db.setLibraryItemLang(z.id, "zh");
    db.setLibraryItemLang(j.id, "ja");
    // 用户对 apple 的「已认识」标记（事件按 lang:key 关联，清表重建后应原样再映射回来）
    const mk = db.addLearningEvent({ kind: "lexeme_mark", lang: "en", payload: { mark: "known", via: "mine", keys: [APPLE] } });
    check("lexeme_mark 事件写入", mk && mk.ok === true, true, mk);

    console.log("== N2 母语=中文：词项只含 en / ja，记录指纹 ==");
    setLearner({ nativeLangs: ["zh"], nativeConfirmed: true });
    const r1 = await learnerRefresh.refresh({ force: true });
    check("refresh 成功", r1 && r1.ok === true, true, r1);
    check("词项语言 = {en, ja}", sameSet(await langs(), ["en", "ja"]), ["en", "ja"], [...(await langs())]);
    check("lm_meta.lex_native_langs = zh", (await meta("lex_native_langs")) === "zh", "zh", await meta("lex_native_langs"));
    const apple1 = await appleState();
    check("apple 词项存在且「已认识」标记生效（state=known）", apple1 && apple1.state === "known", "known", apple1);
    const maxId1 = await maxLexId();
    const jaIdsBefore = (await learnerDb.all("SELECT id FROM lexemes WHERE lang = 'ja' ORDER BY id")).map((r) => Number(r.id));
    const r1b = await learnerRefresh.refresh({ force: true });
    check("母语未变再刷新：不清表（ja 词项 id 不变）", r1b.ok === true && JSON.stringify((await learnerDb.all("SELECT id FROM lexemes WHERE lang = 'ja' ORDER BY id")).map((r) => Number(r.id))) === JSON.stringify(jaIdsBefore), jaIdsBefore.length, (await learnerDb.all("SELECT COUNT(*) AS n FROM lexemes WHERE lang = 'ja'"))[0].n);

    console.log("== N3 改母语=英文：旧词项清掉，按新母语重建 {zh, ja} ==");
    await learnerDb.setMeta("mine_count:en", "7");
    setLearner({ nativeLangs: ["en"], nativeConfirmed: true });
    const r2 = await learnerRefresh.refresh({ force: true });
    check("refresh 成功", r2 && r2.ok === true, true, r2);
    check("词项语言 = {zh, ja}（不再含 en）", sameSet(await langs(), ["zh", "ja"]), ["zh", "ja"], [...(await langs())]);
    check("全部词项均为重建（最小 id > 旧最大 id）", (await minLexId()) > maxId1, `> ${maxId1}`, await minLexId());
    check("unit_lex 不再含 en 单元", (await count("SELECT COUNT(*) AS n FROM unit_lex WHERE lang = 'en'")) === 0, 0, await count("SELECT COUNT(*) AS n FROM unit_lex WHERE lang = 'en'"));
    check("lexeme_states 与 lexemes 一一对应", (await count("SELECT COUNT(*) AS n FROM lexeme_states")) === (await count("SELECT COUNT(*) AS n FROM lexemes")), await count("SELECT COUNT(*) AS n FROM lexemes"), await count("SELECT COUNT(*) AS n FROM lexeme_states"));
    check("lexeme_states 无孤儿行", (await count("SELECT COUNT(*) AS n FROM lexeme_states WHERE lexeme_id NOT IN (SELECT id FROM lexemes)")) === 0, 0, await count("SELECT COUNT(*) AS n FROM lexeme_states WHERE lexeme_id NOT IN (SELECT id FROM lexemes)"));
    check("旧语言 mine_count:en 缓存已清", (await meta("mine_count:en")) === null, null, await meta("mine_count:en"));
    check("lm_meta.lex_native_langs = en", (await meta("lex_native_langs")) === "en", "en", await meta("lex_native_langs"));
    const enStats = await learnerRefresh.lexStatsFor({ lang: "en" });
    check("lexStatsFor(en).totalLexemes = 0", enStats && enStats.totalLexemes === 0, 0, enStats);
    const snap2 = await learnerRefresh.buildSnapshot();
    check("快照 lexStats 不含 en、含 zh / ja", snap2.lexStats && !("en" in snap2.lexStats) && "zh" in snap2.lexStats && "ja" in snap2.lexStats, ["zh", "ja"], Object.keys(snap2.lexStats || {}));

    console.log("== N4 改回母语=中文：en 词项重建，用户标记原样映射 ==");
    setLearner({ nativeLangs: ["zh"], nativeConfirmed: true });
    await learnerRefresh.refresh({ force: true });
    check("词项语言 = {en, ja}", sameSet(await langs(), ["en", "ja"]), ["en", "ja"], [...(await langs())]);
    const apple2 = await appleState();
    check("apple 重建后 id 变新", apple2 && apple1 && apple2.id !== apple1.id, "新 id", { before: apple1 && apple1.id, after: apple2 && apple2.id });
    check("apple 状态与清表前一致（标记按 lang:key 再映射）", apple2 && apple1 && apple2.state === apple1.state && apple2.source === apple1.source, apple1, apple2);

    console.log("== N5 多母语 {zh, en}：只剩 ja ==");
    setLearner({ nativeLangs: ["en", "zh"], nativeConfirmed: true });
    await learnerRefresh.refresh({ force: true });
    check("词项语言 = {ja}", sameSet(await langs(), ["ja"]), ["ja"], [...(await langs())]);
    check("指纹去重排序（en,zh）", (await meta("lex_native_langs")) === "en,zh", "en,zh", await meta("lex_native_langs"));
    setLearner({ nativeLangs: ["zh", "en", "zh"], nativeConfirmed: true });
    const jaIds5 = (await learnerDb.all("SELECT id FROM lexemes ORDER BY id")).map((r) => Number(r.id));
    await learnerRefresh.refresh({ force: true });
    check("同一母语集合换顺序 / 重复不算变更（不清表）", JSON.stringify((await learnerDb.all("SELECT id FROM lexemes ORDER BY id")).map((r) => Number(r.id))) === JSON.stringify(jaIds5), jaIds5.length, (await learnerDb.all("SELECT COUNT(*) AS n FROM lexemes"))[0].n);

    console.log("== N6 无指纹记录（升级后首轮）：只记录不清表，零计数残行被回收 ==");
    setLearner({ nativeLangs: ["zh"], nativeConfirmed: true });
    await learnerRefresh.refresh({ force: true }); // 回到 {en, ja}
    await learnerDb.run("DELETE FROM lm_meta WHERE key = 'lex_native_langs'");
    await learnerDb.run("INSERT INTO lexemes (lang, key, sample, total_count, unit_count, is_stop) VALUES ('zh', '残留', '残留', 0, 0, 0)");
    const idsBefore6 = (await learnerDb.all("SELECT id FROM lexemes WHERE unit_count > 0 ORDER BY id")).map((r) => Number(r.id));
    await learnerRefresh.refresh({ force: true });
    const idsAfter6 = (await learnerDb.all("SELECT id FROM lexemes ORDER BY id")).map((r) => Number(r.id));
    check("无记录时不清表（有效词项 id 原样）", JSON.stringify(idsAfter6) === JSON.stringify(idsBefore6), idsBefore6.length, idsAfter6.length);
    check("无记录时补写指纹", (await meta("lex_native_langs")) === "zh", "zh", await meta("lex_native_langs"));
    check("零计数残行（旧母语遗留）被回收", (await count("SELECT COUNT(*) AS n FROM lexemes WHERE lang = 'zh'")) === 0, 0, await count("SELECT COUNT(*) AS n FROM lexemes WHERE lang = 'zh'"));

    console.log("== N7 轨道变化（母语不变）：移出语言轨道的材料其词项回收 ==");
    const tr = db.saveLearnerTrack({ label: "D234 英文", mode: "language", lang: "en", udcCodes: [] });
    check("新建 en 语言轨道（用户轨道接管提议）", tr && tr.ok === true, true, tr);
    await learnerRefresh.refresh({ force: true });
    check("仅 en 轨道 ⇒ 词项语言 = {en}（ja 零计数词项不残留）", sameSet(await langs(), ["en"]), ["en"], [...(await langs())]);
    check("回收后 lexemes 无零计数行", (await count("SELECT COUNT(*) AS n FROM lexemes WHERE unit_count <= 0")) === 0, 0, await count("SELECT COUNT(*) AS n FROM lexemes WHERE unit_count <= 0"));

    console.log("== N8 requestNativeRebuild：刷新在跑时登记，结束后补跑一轮 ==");
    const st0 = learnerRefresh.getStatus().lastRefreshAt;
    const running = learnerRefresh.refresh({ force: true });
    const queued = learnerRefresh.requestNativeRebuild();
    check("刷新进行中调用返回 true（已登记补跑）", queued === true, true, queued);
    await running;
    const st1 = learnerRefresh.getStatus().lastRefreshAt;
    let st2 = st1;
    for (let i = 0; i < 100 && st2 === st1; i++) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 50));
      st2 = learnerRefresh.getStatus().indexing ? st1 : learnerRefresh.getStatus().lastRefreshAt;
    }
    check("当前一轮结束后补跑了一轮（lastRefreshAt 再前进）", st1 > st0 && st2 > st1, "两次前进", { st0, st1, st2 });
    setLearner({ enabled: false });
    check("总开关关闭时 requestNativeRebuild 不跑", learnerRefresh.requestNativeRebuild() === false, false, "ran");
    setLearner({ enabled: true });

    console.log("== N9 主进程 settings:set 钩子（静态） ==");
    const mainSrc = fs.readFileSync(path.join(ROOT, "electron", "main.js"), "utf8");
    const h = mainSrc.slice(mainSrc.indexOf('ipcMain.handle("settings:set"'));
    const body = h.slice(0, h.indexOf("\n});"));
    const iBefore = body.indexOf("currentNativeFingerprint()");
    const iWrite = body.indexOf("writeSettings(all)");
    const iReq = body.indexOf("requestNativeRebuild()");
    check("写盘前取母语指纹、写盘后比对并触发重建", iBefore > 0 && iWrite > iBefore && iReq > iWrite, "before < write < request", { iBefore, iWrite, iReq });
    check("钩子只针对 app.learner 键", /scope === "app" && key === "learner" \? learnerRefresh\.currentNativeFingerprint\(\)/.test(body), true, false);
  } catch (err) {
    fail++;
    console.log(`  ✗ 未捕获异常：${(err && err.stack) || err}`);
  } finally {
    console.log(`\n${pass} passed, ${fail} failed`);
    try {
      await learnerDb.close?.();
    } catch {
      /* 忽略 */
    }
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* 忽略 */
    }
    app.exit(fail ? 1 : 0);
  }
});
