// @runtime: electron
// 运行：npx electron tests/lm-db.test.cjs
// D124 §13.5：学习者模型 db 层回归（隔离：临时 userData，全新 library.db / learner.db，绝不触碰真实库）
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const ROOT = require("path").resolve(__dirname, "..");

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

// 通道清单（设计稿 §13.5 最后一条；f45 S2 要求每个通道名在 tests/ 里以完整字符串出现）
const LEARNER_CHANNELS = [
  "learner:status",
  "learner:refresh",
  "learner:recommend",
  "learner:feedback",
  "learner:listTracks",
  "learner:saveTrack",
  "learner:deleteTrack",
  "learner:setTrackMaterial",
  "learner:kpLevels",
  "learner:logEvent",
  "learner:unitText",
  "learner:contextReel",
  "learner:sentenceMine",
  "learner:placementSample",
  "learner:lexStats",
  "learner:rebuild"
];

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-db-test-"));
  try {
    app.setPath("userData", tmp);
    const db = require(path.join(ROOT, "electron", "db.js"));
    const learnerDb = require(path.join(ROOT, "electron", "learnerDb.js"));
    const learnerRefresh = require(path.join(ROOT, "electron", "learnerRefresh.js"));
    const lmParams = require(path.join(ROOT, "electron", "lmParams.js"));
    const settingsStore = require(path.join(ROOT, "electron", "settingsStore.js"));
    await db.initDb();

    const setLearnerSettings = (patch) => {
      const all = settingsStore.readSettings();
      all.app = { ...(all.app || {}), learner: { ...(all.app?.learner || {}), ...patch } };
      settingsStore.writeSettings(all);
    };
    const counts = () => {
      const f = db.learnerFacts();
      return {
        cards: f.cards.length,
        reviews: f.reviewLogs.length,
        events: f.learningEvents.length,
        recRuns: 0,
        cardsUpdatedAt: f.cards.reduce((m, c) => Math.max(m, Number(c.updatedAt) || 0), 0)
      };
    };
    const learnerDbPath = path.join(tmp, "learner.db");
    const learnerDbMtime = () => {
      try {
        return fs.statSync(learnerDbPath).mtimeMs;
      } catch {
        return 0;
      }
    };

    console.log("== LM-1 造数：英文书 E（3 章）+ 中文书 Z（2 章）+ KP 卡 + 阅读事件 ==");
    const chapter = (n, ch) => `# Chapter ${n}\n${ch.repeat(2000)}\n`;
    const e = db.createImportedDoc({ title: "LMTEST English Book", markdown: chapter(1, "a") + chapter(2, "b") + chapter(3, "c"), sourceType: "markdown" });
    const z = db.createImportedDoc({ title: "LMTEST 中文书", markdown: `# 第一章\n${"甲".repeat(2000)}\n# 第二章\n${"乙".repeat(2000)}\n`, sourceType: "markdown" });
    db.setLibraryItemLang(e.id, "en");
    db.setLibraryItemLang(z.id, "zh");
    const eDocId = db.getDocument(e.id).documentId;
    const zDocId = db.getDocument(z.id).documentId;
    const kp = db.createKnowledgePoint({ canonicalLabel: "LMTEST 控制论", domainId: "57" });
    const cardA = db.createCard({ frontMarkdown: "LMTEST Q1", backMarkdown: "A1", noteText: "LMTEST Q1", cardType: "qa", knowledgePointId: kp.id, contextRefJson: JSON.stringify({ documentId: zDocId }) });
    const cardB = db.createCard({ frontMarkdown: "LMTEST Q2", backMarkdown: "A2", noteText: "LMTEST Q2", cardType: "cloze", knowledgePointId: kp.id, contextRefJson: JSON.stringify({ documentId: zDocId }) });
    const now0 = Date.now();
    const fsrsState = (n) => ({ state: "review", due: now0 + 86400000, lapses: 0, stability: 30, difficulty: 5, reps: n, lastReview: now0 - 86400000, learningSteps: 0 });
    for (let i = 1; i <= 3; i++) {
      db.saveReview(cardA.id, fsrsState(i), "Good", 1000);
      db.saveReview(cardB.id, fsrsState(i), "Good", 1000);
    }
    db.addReadingEvent(e.id, 0);
    db.addReadingEvent(e.id, 1800);
    db.addReadingEvent(e.id, 4500);

    console.log("== LM-2 刷新管线：单元 / 通读 / KP 等级 ==");
    learnerRefresh.init({ extractPdfPages: async () => null });
    const r1 = await learnerRefresh.refresh({ force: true });
    check("refresh 成功无错", r1.ok === true, true, r1);
    const eUnits = await learnerDb.all("SELECT * FROM content_units WHERE library_item_id = ? ORDER BY ord ASC", [e.id]);
    const zUnits = await learnerDb.all("SELECT * FROM content_units WHERE library_item_id = ? ORDER BY ord ASC", [z.id]);
    check("E 有 3 个单元", eUnits.length === 3, 3, eUnits.length);
    check("Z 有 2 个单元", zUnits.length === 2, 2, zUnits.length);
    // 通读断言前提：md_to[1] <= 4500 < docLen × 0.97（前提不成立让测试失败并打印实际值）
    const docLen = eUnits.length ? (await learnerDb.all("SELECT MAX(md_to) AS m FROM content_units WHERE library_item_id = ?", [e.id]))[0].m : 0;
    const mdTo1 = eUnits[1] ? Number(eUnits[1].md_to) : -1;
    check(`通读断言前提（md_to[1]=${mdTo1} <= 4500 < docLen×0.97=${docLen * 0.97}）`, mdTo1 > 0 && mdTo1 <= 4500 && 4500 < docLen * 0.97, true, { mdTo1, docLen });
    const progress = {};
    for (const row of await learnerDb.all("SELECT unit_id AS unitId, passes_json AS passesJson FROM unit_progress")) {
      progress[String(row.unitId)] = JSON.parse(row.passesJson || "[]").length;
    }
    check("E 单元 0 通读 1 次", progress[`${eDocId}#0`] === 1, 1, progress[`${eDocId}#0`]);
    check("E 单元 1 通读 1 次", progress[`${eDocId}#1`] === 1, 1, progress[`${eDocId}#1`]);
    check("E 单元 2 通读 0 次", !progress[`${eDocId}#2`], 0, progress[`${eDocId}#2`]);
    const kpState = (await learnerDb.all("SELECT * FROM kp_states WHERE kp_id = ?", [kp.id]))[0];
    check("kp_states 有该 KP 一行且 level ≥ 2", kpState && Number(kpState.level) >= 2, "≥2", kpState && kpState.level);

    console.log("== LM-3 母语生效值驱动提议轨道（不写死语言） ==");
    // 未设语言属性的书：材料语言靠 detectLang 兜底（非 PDF 取 markdown 前 3000 字）
    const j = db.createImportedDoc({ title: "LMTEST 日本語の本", markdown: `# 第一章\n${"いろはにほへと ちりぬるを わかよたれそ つねならむ うゐのおくやま けふこえて あさきゆめみし ゑひもせす\n".repeat(12)}`, sourceType: "markdown" });
    const rRefresh = await learnerRefresh.refresh({ force: true });
    check("refresh 成功无错（含未设语言的书）", rRefresh.ok === true, true, rRefresh);
    setLearnerSettings({ nativeLangs: ["zh"], nativeConfirmed: true });
    await learnerRefresh.refresh({ force: true });
    const snap1 = await learnerRefresh.buildSnapshot();
    const langProposals1 = snap1.proposals.filter((p) => p.mode === "language");
    check("nativeLangs=zh → 提议含 en language 轨道", langProposals1.some((p) => p.lang === "en"), true, langProposals1.map((p) => p.key));
    check("未设语言的书靠 detectLang 提议（日语书 → lang:ja）", langProposals1.some((p) => p.key === "lang:ja"), true, langProposals1.map((p) => p.key));
    const lexLangs1 = new Set((await learnerDb.all("SELECT DISTINCT lang FROM lexemes")).map((r) => r.lang));
    check("lexemes 只含 en/ja（中文书不建词项）", lexLangs1.size === 2 && lexLangs1.has("en") && lexLangs1.has("ja"), ["en", "ja"], [...lexLangs1]);
    setLearnerSettings({ nativeLangs: ["en"], nativeConfirmed: true });
    await learnerRefresh.refresh({ force: true });
    const snap2 = await learnerRefresh.buildSnapshot();
    const langProposals2 = snap2.proposals.filter((p) => p.mode === "language");
    check("nativeLangs=en → 提议 zh / ja、不再提议 en", langProposals2.some((p) => p.lang === "zh") && langProposals2.some((p) => p.lang === "ja") && !langProposals2.some((p) => p.lang === "en"), true, langProposals2.map((p) => p.key));

    console.log("== LM-4 事件校验 / rec_runs 裁剪 / 刷新不碰调度表 ==");
    const beforeEvents = counts().events;
    const bad = db.addLearningEvent({ kind: "not_a_kind", lang: "en" });
    check("非法 kind 返回 {ok:false}", bad && bad.ok === false, false, bad);
    check("非法 kind 不写库", counts().events === beforeEvents, beforeEvents, counts().events);
    for (let i = 0; i < 301; i++) {
      db.saveRecRun([{ key: `k${i}` }], 1, "LM-1");
    }
    // rec_runs 在主库；经 listRecentRunKeys 间接计数（每次 run 恰 1 个 key，裁剪保留 300 行 ⇒ 300 个 key）
    check("rec_runs 写 301 次后表内 300 行", db.listRecentRunKeys(365).length === 300, 300, db.listRecentRunKeys(365).length);
    const c0 = counts();
    await learnerRefresh.refresh({ force: true });
    const c1 = counts();
    check("刷新不写 cards / review_logs", c0.cards === c1.cards && c0.reviews === c1.reviews && c0.cardsUpdatedAt === c1.cardsUpdatedAt, true, { c0, c1 });

    console.log("== LM-5 learner.db 可重建 ==");
    const unitsBefore = (await learnerDb.all("SELECT COUNT(*) AS n FROM content_units"))[0].n;
    // score 含 R（随 now 变化的浮点），重建一致性按 4 位小数比较
    const kpStatesBefore = (await learnerDb.all("SELECT kp_id, level, score FROM kp_states ORDER BY kp_id ASC")).map((r) => [r.kp_id, r.level, Number(r.score).toFixed(4)]);
    const mtimeBefore = learnerDbMtime();
    await learnerDb.reset();
    check("reset 后文件已删除", !fs.existsSync(learnerDbPath), true, fs.existsSync(learnerDbPath));
    await learnerRefresh.refresh({ force: true });
    const unitsAfter = (await learnerDb.all("SELECT COUNT(*) AS n FROM content_units"))[0].n;
    const kpStatesAfter = (await learnerDb.all("SELECT kp_id, level, score FROM kp_states ORDER BY kp_id ASC")).map((r) => [r.kp_id, r.level, Number(r.score).toFixed(4)]);
    check("删除 learner.db 后刷新：单元数一致", unitsAfter === unitsBefore, unitsBefore, unitsAfter);
    check("删除 learner.db 后刷新：KP 状态一致", JSON.stringify(kpStatesAfter) === JSON.stringify(kpStatesBefore), true, { kpStatesBefore, kpStatesAfter });

    console.log("== LM-6 轨道材料覆盖：先查后改不炸 UNIQUE ==");
    const track = db.saveLearnerTrack({ label: "LMTEST 英文", mode: "language", lang: "en", udcCodes: [] });
    check("新建轨道 ok", track.ok === true && track.track.mode === "language", true, track);
    db.setTrackMaterial(track.track.id, e.id, 1);
    db.setTrackMaterial(track.track.id, e.id, null);
    let uniqueErr = null;
    try {
      db.setTrackMaterial(track.track.id, e.id, 1);
    } catch (err) {
      uniqueErr = err;
    }
    check("member 1→null→1 不报 UNIQUE 错", uniqueErr === null, null, String(uniqueErr));
    const overrideRow = db.learnerFacts().overrides.find((o) => o.trackId === track.track.id && o.libraryItemId === e.id);
    check("最终该对有效（is_deleted=0, member=1）", overrideRow && Number(overrideRow.member) === 1, true, overrideRow);

    console.log("== LM-7 总开关（§11.8） ==");
    const mtime7 = learnerDbMtime();
    const evBefore7 = counts().events;
    const runsBefore7 = db.listRecentRunKeys(365).length;
    setLearnerSettings({ enabled: false });
    check("开关关闭后 learnerEnabled()=false", learnerRefresh.learnerEnabled() === false, false, learnerRefresh.learnerEnabled());
    const st = await learnerRefresh.statusForIpc();
    check("learner:status 关闭时返回 {enabled:false}", st.enabled === false, false, st);
    const rOff = await learnerRefresh.refresh({ force: true });
    check("关闭时 refresh 不执行任何步骤（stopped）", rOff && learnerRefresh.getStatus().phase === "stopped", "stopped", { phase: learnerRefresh.getStatus().phase, rOff, lastError: learnerRefresh.getStatus().lastError, enabled: learnerRefresh.learnerEnabled() });
    check("关闭时 learner.db 修改时间不变", learnerDbMtime() === mtime7, mtime7, learnerDbMtime());
    check("关闭时 learning_events 行数不变", counts().events === evBefore7, evBefore7, counts().events);
    check("关闭时 rec_runs 行数不变", db.listRecentRunKeys(365).length === runsBefore7, runsBefore7, db.listRecentRunKeys(365).length);
    // 主进程 handler 的开关守卫（无法在测试进程内 invoke 真实 handler ⇒ 静态断言 handler 首行）
    const mainSrc = fs.readFileSync(path.join(ROOT, "electron", "main.js"), "utf8");
    for (const ch of ["learner:recommend", "learner:logEvent", "learner:refresh"]) {
      const re = new RegExp(`ipcMain.handle\\("${ch}"[\\s\\S]{0,80}?if \\(!learnerRefresh\\.learnerEnabled\\(\\)\\) return learnerDisabled\\(\\);`);
      check(`main.js ${ch} handler 首行有开关守卫`, re.test(mainSrc), true, ch);
    }
    setLearnerSettings({ enabled: true });
    check("重新开启后 learnerEnabled()=true", learnerRefresh.learnerEnabled() === true, true, learnerRefresh.learnerEnabled());
    const rec1 = await learnerRefresh.recommendFlow({ force: true });
    check("改回 true 后 learner:recommend 正常返回", rec1 && rec1.ok === true && Array.isArray(rec1.items), true, rec1 && rec1.ok);

    console.log("== LM-8 通道清单（16 个，main/preload 逐字对账） ==");
    check("通道清单恰 16 个", LEARNER_CHANNELS.length === 16, 16, LEARNER_CHANNELS.length);
    for (const ch of LEARNER_CHANNELS) {
      check(`main.js 注册 ${ch}`, mainSrc.includes(`ipcMain.handle("${ch}"`), true, ch);
    }
    const preloadSrc = fs.readFileSync(path.join(ROOT, "electron", "preload.js"), "utf8");
    for (const ch of LEARNER_CHANNELS) {
      check(`preload.js invoke ${ch}`, preloadSrc.includes(`invoke("${ch}"`), true, ch);
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exitCode = fail > 0 ? 1 : 0;
  } catch (err) {
    console.error("TEST CRASH:", err);
    process.exitCode = 1;
  } finally {
    app.exit(process.exitCode || 0);
  }
});
