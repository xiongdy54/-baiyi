// F56 崩溃点普查（同一段固定旅程 × 每一个落盘时机 × 盘上不变量电池）
// @runtime: electron  @tier: 2  @gui: false  @id: F56  @timeout: 900
// 运行：FLOW_INSTANCE=f56solo npx electron tests/flows/f56-crash-sweep.cjs
//
// 角度（F04/F33/F37/F43 都没覆盖）：既有流程都在**一个手挑的位置**注入故障。
//   本层不挑位置 —— 把同一条确定性旅程的**每一次 persist 机会**都当崩溃点扫一遍，
//   回答「第 N 次写库时断电，盘上 library.db 会不会违反它自己的不变量」。
//   这张 N→损坏面 的地图才说明**用户数据实际会在哪里死掉**：
//   persist() 是整库快照的原子替换（db.js:682-703），所以库内半写本不可能出现；
//   真正会破的是①同一步业务动作里的**第 2 次 persist**（步内中间态被固化）、
//   ②settings.json 与 library.db **两份事实源之间**的边界（D-TEST-31 的指针/内容分裂）。
//
// 手段：从**外部**给 fs.renameSync（persist 唯一的落盘提交动作，db.js:698）挂计数器，
//   第 N 次命中时 SIGKILL 掉自己 → 真实断电（不是可被 catch 的 throw）。
//   每个崩溃点 = 一个独立 electron 子进程（自我 respawn，F56_CRASH_AT=N），只杀自己 spawn 的那个 PID。
//   父进程再用 sql.js 以**裸 SQL** 审计残局（绝不走 app 的读助手），逐条不变量分桶。
"use strict";
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { app } = require("electron");
const { Flow, runFlow, ROOT, tmpUserDataDir, freshDir } = require("./lib/harness.cjs");
const { audit } = require("./lib/dbenv.cjs");

const DAY = 86_400_000;
const flow = new Flow({
  id: "F56",
  title: "崩溃点普查",
  angle: "固定旅程的每一次 persist 作为断电点，盘上库在哪个 Nth 写开始违反自身不变量",
  cites: ["§7.2 L874", "§4.4.9", "§7.1.4", "§4.4.10"],
  tier: 2,
  gui: false,
});

const NL = String.fromCharCode(10);
const HEAD = ["# F56 第一章", "", "原子落盘与崩溃窗口用正文。断电不该改变事实。"].join(NL);
const BASE = tmpUserDataDir("f56");

// ---------------------------------------------------------------- 子进程侧：钩子 + 旅程
const HOOK = { n: 0, step: "(boot)", crashAt: 0, trail: [], trailFile: "", stepFile: "" };

function hardKill() {
  // 真实断电：不可 catch 的进程消灭。Windows 上 SIGKILL → TerminateProcess。
  try {
    process.kill(process.pid, "SIGKILL");
  } catch (e) {
    try {
      fs.appendFileSync(HOOK.trailFile, "KILLFAIL\t" + e.message + NL);
    } catch { /* 尽力 */ }
    process.exit(9);
  }
  // 兜底：万一信号被吞，绝不允许它继续跑完旅程（那会把「已崩溃」的点伪装成完整态）
  const t = Date.now();
  while (Date.now() - t < 1500) { /* 短暂自旋等终止 */ }
  process.exit(9);
}

function installHook(dir, crashAt) {
  HOOK.crashAt = crashAt;
  HOOK.trailFile = path.join(dir, "f56-trail.log");
  HOOK.stepFile = path.join(dir, "f56-steps.log");
  const orig = fs.renameSync;
  fs.renameSync = function patched(from, to) {
    const t = String(to);
    if (t.endsWith("library.db") && !t.endsWith(".tmp")) {
      HOOK.n += 1;
      const rec = HOOK.n + "\t" + HOOK.step + NL;
      HOOK.trail.push(HOOK.step);
      try { fs.appendFileSync(HOOK.trailFile, rec); } catch { /* 忽略 */ }
      if (crashAt > 0 && HOOK.n === crashAt) hardKill();
    }
    return orig.apply(fs, arguments);
  };
  return () => { fs.renameSync = orig; };
}

async function S(label, fn) {
  HOOK.step = label;
  const before = HOOK.n;
  let res = null;
  let err = null;
  try {
    res = await fn();
  } catch (e) {
    err = String((e && e.message) || e);
  }
  const after = HOOK.n;
  const line = label + "\t第" + (after > before ? (before + 1) + ".." + after : "-") + "次写盘" + (err ? "\tERR:" + err : "");
  try { fs.appendFileSync(HOOK.stepFile, line + NL); } catch { /* 忽略 */ }
  return { label, res, err, persists: after - before };
}

function mkCard(db, tag, docId) {
  return db.createCard({
    noteText: "F56-" + tag, cardType: "qa", frontMarkdown: "问 " + tag, backMarkdown: "答 " + tag,
    priority: 50, tags: [], documentId: docId,
  });
}

function reviewGood(db, id, bump) {
  const c = db.getCard(id);
  if (!c) throw new Error("卡不存在");
  const f = c.fsrs || {};
  const after = {
    state: "review",
    due: (f.due || Date.now()) + bump * DAY,
    lapses: f.lapses || 0,
    stability: Number(((f.stability || 1) * 2.5).toFixed(6)),
    difficulty: f.difficulty || 5,
    reps: (f.reps || 0) + 1,
    learningSteps: 0,
    lastReview: f.due || Date.now(),
  };
  return db.saveReview(id, after, "Good", 15_000, f);
}

// 唯一一条被扫描的旅程（确定性、无 RNG）。返回 {ids, cfgId, stepErrs}
async function runJourney(db) {
  const J = {};
  const steps = [];
  const push = (r) => { steps.push({ label: r.label, err: r.err, persists: r.persists }); return r.res; };

  J.bk = push(await S("01 创建材料", () => db.createFromPaste("F56 材料", HEAD)));
  J.docId = J.bk && J.bk.documentId;
  J.a = push(await S("02 建卡 A", () => mkCard(db, "A", J.docId)));
  J.b = push(await S("03 建卡 B", () => mkCard(db, "B", J.docId)));
  J.c = push(await S("04 建卡 C", () => mkCard(db, "C", J.docId)));
  push(await S("05 复习 A（Good）", () => reviewGood(db, J.a.id, 4)));
  push(await S("06 撤销该复习", () => db.undoLastReview()));
  push(await S("07 再复习 A（Good）", () => reviewGood(db, J.a.id, 5)));
  push(await S("08 跳过 B", () => db.saveSkip(J.b.id)));
  push(await S("09 存日记草稿", () => db.saveJournalDraft("F56 草稿正文。", { deferPersist: false })));
  push(await S("10 发送日记草稿", () => db.sendJournalDraft("F56 定稿正文。")));
  J.kps = push(await S("11 建知识点+挂卡 A", () => {
    const kp1 = db.createKnowledgePoint({ canonicalLabel: "F56-原子性", description: "崩溃点普查用" });
    const kp2 = db.createKnowledgePoint({ canonicalLabel: "F56-断电窗口", description: "崩溃点普查用" });
    const card = db.getCard(J.a.id);
    db.updateCard({ ...card, knowledgePointId: kp1 && kp1.id });
    return { kp1, kp2 };
  }));
  push(await S("12 合并知识点", () => {
    const kp1 = J.kps && J.kps.kp1;
    const kp2 = J.kps && J.kps.kp2;
    if (!kp1 || !kp2) throw new Error("上一步未建成两个知识点");
    return db.mergeKnowledgePoints(kp1.id, kp2.id, { deferPersist: false });
  }));
  push(await S("13 应用 FSRS 权重", () => {
    let w = ((db.getActiveFsrsConfig && db.getActiveFsrsConfig()) || {}).weights;
    if (!Array.isArray(w) || w.length !== 21) w = Array.from({ length: 21 }, (_, i) => 0.4 + i * 0.01);
    const next = w.map((x, i) => Number((Number(x) + 0.001 * (i + 1)).toFixed(8)));
    try {
      const opt = require(path.join(ROOT, "electron", "optimizer.js"));
      if (typeof opt.applyWeights === "function") return opt.applyWeights(db, next);
    } catch (e) {
      if (!/Cannot find module/.test(String(e && e.message))) throw e;
    }
    const id = db.insertFsrsConfig(next, { forgetting_rate: 0.9 }, "optimizer");
    db.setActiveFsrsConfig(id);
    db.persistNow();
    return { configId: id };
  }));
  push(await S("14 改设置（只写 settings.json）", () => {
    const ss = require(path.join(ROOT, "electron", "settingsStore.js"));
    if (!String(ss.SETTINGS_FILE).startsWith(BASE)) throw new Error("settingsStore 未跟随 userData：" + ss.SETTINGS_FILE);
    const all = ss.readSettings();
    all.app = all.app || {};
    all.app.dayCutoffHour = 3;
    all.app.f56Tag = "sweep";
    ss.writeSettings(all);
    return all.app.dayCutoffHour;
  }));
  push(await S("15 软删卡 C", () => db.deleteCard(J.c.id)));

  HOOK.step = "(journey-done)";
  return { ids: { a: J.a && J.a.id, b: J.b && J.b.id, c: J.c && J.c.id }, steps };
}

async function runChild() {
  const dir = String(process.env.F56_DIR || "");
  if (!dir) throw new Error("F56_DIR 未给");
  const crashAt = Number(process.env.F56_CRASH_AT || 0);
  const reopen = process.env.F56_REOPEN === "1";
  app.setPath("userData", dir);
  if (!reopen) {
    // 崩溃/对照跑：全新目录 + 装钩子 + 跑旅程
    const dbPath = path.join(ROOT, "electron", "db.js");
    delete require.cache[dbPath];
    const db = require(dbPath);
    await db.initDb();
    installHook(dir, crashAt);
    const r = await runJourney(db);
    fs.writeFileSync(
      path.join(dir, "f56-meta.json"),
      JSON.stringify({ persistCount: HOOK.n, crashAt, ids: r.ids, steps: r.steps }, null, 2),
      "utf8"
    );
    process.exit(0);
  }
  // 复原探针：在崩溃现场的**副本**上冷启动一次，看 app 自己能不能起来、tmp 会不会被采纳
  const preFile = path.join(dir, "library.db");
  const preTmp = preFile + ".tmp";
  const probe = { tmpBefore: fs.existsSync(preTmp), dbBytesBefore: fs.existsSync(preFile) ? fs.statSync(preFile).size : -1 };
  const unHook = installHook(dir, 0);
  try {
    const dbPath = path.join(ROOT, "electron", "db.js");
    delete require.cache[dbPath];
    const db = require(dbPath);
    await db.initDb();
    probe.booted = true;
    probe.memCards = (db.listAllCards() || []).length;
    probe.memLogs = (db.listAllReviewLogs() || []).length;
    probe.activeCfg = (db.getActiveFsrsConfig() || {}).id || null;
  } catch (e) {
    probe.booted = false;
    probe.error = String((e && e.message) || e);
  } finally {
    unHook();
  }
  probe.tmpAfter = fs.existsSync(preTmp);
  probe.dbBytesAfter = fs.existsSync(preFile) ? fs.statSync(preFile).size : -1;
  fs.writeFileSync(path.join(dir, "f56-reopen.json"), JSON.stringify(probe, null, 2), "utf8");
  process.exit(0);
}

// ---------------------------------------------------------------- 父进程侧：审计电池
const FACT_TABLES = ["library_items", "documents", "cards", "review_logs", "review_skips", "journal_entries", "knowledge_points", "fsrs_configs"];

async function classify(dir) {
  const r = { dir, facts: {}, violated: [], knownHits: [], notes: [], vacuous: [], corrupt: false, opened: false, tmpLeft: null, dbBytes: -1, hash: "-" };
  const dbFile = path.join(dir, "library.db");
  r.dbBytes = fs.existsSync(dbFile) ? fs.statSync(dbFile).size : -1;
  if (r.dbBytes > 0) r.hash = crypto.createHash("md5").update(fs.readFileSync(dbFile)).digest("hex").slice(0, 10);
  r.tmpLeft = fs.existsSync(dbFile + ".tmp") ? fs.statSync(dbFile + ".tmp").size : 0;
  if (r.dbBytes <= 0) {
    r.corrupt = true;
    r.violated.push("V10 缺库文件");
    return r;
  }
  let a = null;
  try {
    // V10：文件必须能在 sql.js 里打开（打不开 = 撕裂写 = 最坏桶）
    a = await audit(dbFile);
    r.opened = true;
  } catch (e) {
    r.corrupt = true;
    r.violated.push("V10 打不开:" + String(e.message).slice(0, 60));
    return r;
  }
  for (const t of FACT_TABLES) {
    try { r.facts[t] = Number(a.one(`SELECT COUNT(*) AS n FROM "${t}"`).n); } catch { r.facts[t] = undefined; }
  }
  const rows = (sql, p) => a.rows(sql, p || []);
  const n = (sql, p) => Number(a.one(sql, p).n);
  const guard = (key, fn) => {
    try { fn(); } catch (e) { r.notes.push(key + " n/a:" + String(e.message).slice(0, 50)); }
  };

  // V1 review_logs.card_id 必须指向真实卡
  guard("V1", () => {
    const c = n("SELECT COUNT(*) AS n FROM review_logs rl LEFT JOIN cards cd ON cd.id = rl.card_id WHERE cd.id IS NULL");
    if (c) r.violated.push("V1 悬空复习日志 x" + c);
    r.notes.push("V1 检查行数=" + r.facts.review_logs);
  });

  // V2 每卡 fsrs_json.reps vs 其日志行数：D-TEST-62 说撤销**物理删日志行**，
  //    reps>logs 属已知撤销留痕（记录不判红）；logs>reps = F35 型「一次呈现计两条」→ 判红。
  guard("V2", () => {
    const rs = rows("SELECT cd.id AS id, cd.fsrs_json AS fj, (SELECT COUNT(*) FROM review_logs rl WHERE rl.card_id = cd.id) AS logs FROM cards cd");
    let drift = [];
    for (const x of rs) {
      let reps = null;
      try { reps = Number((JSON.parse(x.fj || "{}") || {}).reps ?? 0); } catch { reps = NaN; }
      if (!Number.isFinite(reps)) { if (x.logs) drift.push(x.id.slice(0, 6) + ":坏JSON"); continue; }
      if (Number(x.logs) > reps) drift.push(x.id.slice(0, 6) + ":" + reps + "reps<" + x.logs + "logs");
      else if (reps > Number(x.logs)) r.knownHits.push("D-TEST-62 " + x.id.slice(0, 6) + " reps=" + reps + " logs=" + x.logs);
    }
    if (drift.length) r.violated.push("V2 日志多于 reps x" + drift.length + " " + drift.join(",").slice(0, 60));
    r.v2Rows = rs.length;
  });

  // V3 review_seq 唯一 + 单调；洞数单独记（D-TEST-62 的开放问题）
  guard("V3", () => {
    const cols = rows(`PRAGMA table_info(review_logs)`).map((x) => x.name);
    if (!cols.includes("review_seq")) { r.notes.push("V3 n/a：无 review_seq 列"); return; }
    const seqs = rows("SELECT review_seq AS s FROM review_logs ORDER BY s").map((x) => Number(x.s));
    const dup = seqs.length - new Set(seqs).size;
    let gaps = 0;
    for (let i = 1; i < seqs.length; i++) if (seqs[i] - seqs[i - 1] > 1) gaps += seqs[i] - seqs[i - 1] - 1;
    if (dup) r.violated.push("V3 review_seq 重复 x" + dup);
    if (gaps) r.knownHits.push("D-TEST-62 review_seq 洞 x" + gaps);
    r.v3 = { rows: seqs.length, gaps, max: seqs[seqs.length - 1] ?? 0 };
  });

  // V4 settings.app.fsrsConfigId ↔ fsrs_configs 行（重测 D-TEST-31：新信息是**哪个 Nth 写让分裂可达**）
  guard("V4", () => {
    const sFile = path.join(dir, "settings.json");
    let ptr = null;
    if (fs.existsSync(sFile)) {
      try { ptr = JSON.parse(fs.readFileSync(sFile, "utf8")).app?.fsrsConfigId ?? null; } catch (e) { r.violated.push("V4 settings.json 不可解析"); }
    }
    const ids = rows("SELECT id FROM fsrs_configs").map((x) => x.id);
    const used = rows("SELECT DISTINCT fsrs_config_id AS i FROM review_logs WHERE fsrs_config_id IS NOT NULL").map((x) => x.i);
    r.v4 = { ptr, ids };
    if (ptr && ids.length && !ids.includes(ptr)) r.knownHits.push("D-TEST-31型 悬空指针 settings.fsrsConfigId=" + ptr + " 库内行=" + JSON.stringify(ids));
    const orphan = ids.filter((i) => i !== ptr && i !== "cfg-default" && !used.includes(i));
    if (orphan.length) r.knownHits.push("D-TEST-31型 孤儿配置行 " + JSON.stringify(orphan));
  });

  // V5 卡的知识指针必须存在（重测 D-TEST-49）
  guard("V5", () => {
    const linked = n("SELECT COUNT(*) AS n FROM cards WHERE knowledge_point_id IS NOT NULL AND knowledge_point_id <> ''");
    const miss = n("SELECT COUNT(*) AS n FROM cards cd LEFT JOIN knowledge_points k ON k.id = cd.knowledge_point_id WHERE cd.knowledge_point_id IS NOT NULL AND cd.knowledge_point_id <> '' AND k.id IS NULL");
    const soft = n("SELECT COUNT(*) AS n FROM cards cd JOIN knowledge_points k ON k.id = cd.knowledge_point_id WHERE cd.is_deleted = 0 AND k.is_deleted = 1");
    r.v5 = { linked, miss, soft };
    if (linked === 0) { r.vacuous.push("V5（无卡挂知识点，updateCard 未接受该字段？）"); return; }
    if (miss) r.knownHits.push("D-TEST-49型 卡指向不存在知识点 x" + miss);
    if (soft) r.notes.push("卡指向**已软删**知识点 x" + soft + "（合并语义，非悬空）");
  });

  // V6 review_skips 不得引用不存在的卡（重测 D-TEST-60）
  guard("V6", () => {
    const c = n("SELECT COUNT(*) AS n FROM review_skips s LEFT JOIN cards cd ON cd.id = s.card_id WHERE cd.id IS NULL");
    r.v6 = { skips: r.facts.review_skips, dangling: c };
    if (c) r.knownHits.push("D-TEST-60型 幽灵跳过行 x" + c);
  });

  // V7 草稿/正文的存在性不自相矛盾
  guard("V7", () => {
    const draftDeleted = n("SELECT COUNT(*) AS n FROM journal_entries WHERE is_draft = 1 AND is_deleted = 1");
    const drafts = n("SELECT COUNT(*) AS n FROM journal_entries WHERE is_draft = 1 AND is_deleted = 0");
    const formalNoSrc = n("SELECT COUNT(*) AS n FROM journal_entries WHERE is_draft = 0 AND is_deleted = 0 AND (entry_date IS NULL OR entry_date = '' OR source IS NULL OR source = '')");
    r.v7 = { drafts, draftDeleted, formalNoSrc };
    if (draftDeleted) r.violated.push("V7 已删行仍占草稿位 x" + draftDeleted);
    if (drafts > 1) r.violated.push("V7 并存的草稿 x" + drafts);
    if (formalNoSrc) r.violated.push("V7 正式条目缺载体(entry_date/source) x" + formalNoSrc);
  });

  // V8 软删/消失的 library_items 之下不得留活文档
  guard("V8", () => {
    const miss = n("SELECT COUNT(*) AS n FROM documents d LEFT JOIN library_items i ON i.id = d.library_item_id WHERE i.id IS NULL");
    const underDeleted = n("SELECT COUNT(*) AS n FROM documents d JOIN library_items i ON i.id = d.library_item_id WHERE i.is_deleted = 1 AND d.is_deleted = 0");
    r.v8 = { docs: r.facts.documents, miss, underDeleted };
    if (miss) r.violated.push("V8 文档失去宿主 x" + miss);
    if (underDeleted) r.notes.push("软删条目下仍有活文档 x" + underDeleted + "（§7.2 软删留痕，符合预期）");
  });

  // V9 不得留下可能被当作活库采纳的 .tmp —— 由复原探针实测（见 probes），这里只登记残留在不在
  guard("V9", () => {
    if (r.tmpLeft) r.notes.push("V9 残留 .tmp " + r.tmpLeft + "B（initDb:210 是否清掉→复原探针实测）");
    else r.vacuous.push("V9（该点无 .tmp 残留，无可检对象）");
  });

  a.close();
  return r;
}



// ---------------------------------------------------------------- 父进程侧：编排
function spawnChild({ dir, crashAt, reopen }) {
  const env = Object.assign({}, process.env, {
    F56_DIR: dir,
    F56_CRASH_AT: String(crashAt),
    F56_REOPEN: reopen ? "1" : "0",
  });
  delete env.FLOW_SEED;
  delete env.FLOW_CYCLE;
  const r = spawnSync(process.execPath, [__filename], { env, cwd: ROOT, timeout: 60_000, maxBuffer: 8 << 20, encoding: "utf8", windowsHide: true });
  return {
    status: r.status, signal: r.signal, timedOut: !!(r.error && /ETIMEDOUT/i.test(String(r.error.code))),
    err: r.error ? String(r.error.message || r.error) : null,
    stderr: (r.stderr || "").split(NL).filter(Boolean).slice(-6).join(" | "),
  };
}

function readJson(f) {
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; }
}
function readTrail(dir) {
  try {
    return fs.readFileSync(path.join(dir, "f56-trail.log"), "utf8").split(NL).filter(Boolean).map((l) => l.split("\t")[1]);
  } catch { return []; }
}

async function runParent() {
  freshDir(BASE);
  const ctl = path.join(BASE, "ctl");
  freshDir(ctl);

  flow.section("A 对照组：整条旅程跑完，度量旅程里的 persist 次数");
  let cr = spawnChild({ dir: ctl, crashAt: 0, reopen: false });
  let meta = readJson(path.join(ctl, "f56-meta.json"));
  if (!meta) { // 长跑抢占/CPU 抖动：重试一次再信（约束要求）
    flow.record("F56-重试", "对照跑未落 meta（status=" + cr.status + " " + (cr.err || "") + "），重跑一次");
    freshDir(ctl);
    cr = spawnChild({ dir: ctl, crashAt: 0, reopen: false });
    meta = readJson(path.join(ctl, "f56-meta.json"));
  }
  flow.guard("对照组子进程正常完成并回报 persist 次数", () => !!meta && meta.persistCount > 0);
  const K = meta.persistCount;
  flow.record("F56-0 旅程 persist 次数 K", K);
  flow.record("F56-0 每步落盘分布", JSON.stringify(meta.steps.map((s) => s.label.slice(0, 2) + (s.err ? "!" + s.persists : ":" + s.persists))));
  const stepErrs = meta.steps.filter((s) => s.err);
  if (stepErrs.length) flow.record("F56-0 旅程内步骤错误（会影响后续电池的空转判定）", JSON.stringify(stepErrs.map((s) => s.label + "→" + String(s.err).slice(0, 70))));
  const trail = readTrail(ctl);
  flow.record("F56-0 persist#→业务步", trail.join(","));

  const ctlCls = await classifyDir(ctl);
  flow.record("F56-1 对照落盘态", JSON.stringify({ facts: ctlCls.facts, violated: ctlCls.violated, hash: ctlCls.hash }));

  flow.section("B 崩溃点扫描：M = 第 M 次 persist 的 rename 前断电（盘上 = 前 M-1 次快照）");
  const points = [];
  for (let M = 1; M <= K + 1; M++) {
    const dir = path.join(BASE, "m" + M);
    freshDir(dir);
    let res = spawnChild({ dir, crashAt: M, reopen: false });
    const t = readTrail(dir);
    let survived = !!readJson(path.join(dir, "f56-meta.json"));
    if (M <= K && survived) { // 钩子没炸开 → 重试一次（区分真·CPU 抖动）
      freshDir(dir);
      res = spawnChild({ dir, crashAt: M, reopen: false });
      t.length = 0;
      readTrail(dir).forEach((x) => t.push(x));
      survived = !!readJson(path.join(dir, "f56-meta.json"));
    }
    const cls = await classifyDir(dir);
    const landed = M === 1 ? "(仅建库快照)" : (t[M - 2] || trail[M - 2] || "?");
    const crashedStep = t[M - 1] || null; // 被拦下的那次 persist 原本属于哪一步
    const midStep = !!(crashedStep && crashedStep === landed); // 同一步的更早一次写盘已经落了 = 步内断电
    const bucket = cls.corrupt ? "CORRUPT" : cls.violated.length ? "INCONSISTENT" : midStep ? "ROLLED-BACK-CLEAN" : "CONSISTENT";
    points.push({ M, dir, landed, crashedStep, midStep, bucket, cls, survived, killed: !survived, trail: t });
  }

  // 打印表
  const hdr = " M  | 最后落盘的业务步                | items/docs/cards/logs/skips/journal/kp/cfg | 桶                | 违反/已知";
  console.log("  " + hdr);
  console.log("  " + "-".repeat(hdr.length));
  for (const p of points) {
    const f = p.cls.facts;
    const counts = FACT_TABLES.map((t) => (f[t] === undefined ? "-" : f[t])).join("/");
    const bad = p.cls.violated.concat(p.cls.knownHits);
    const viol = bad.length ? bad.join("; ").slice(0, 70) : (p.cls.tmpLeft ? "残留 .tmp " + p.cls.tmpLeft + "B" : "—");
    console.log(
      "  " + String(p.M).padStart(2) + " | " + (p.landed + " ".repeat(32)).slice(0, 32) + " | " +
      (counts + " ".repeat(26)).slice(0, 26) + " | " + (p.bucket + " ".repeat(18)).slice(0, 18) + " | " + viol
    );
  }

  const corrupt = points.filter((p) => p.cls.corrupt);
  const incons = points.filter((p) => p.bucket === "INCONSISTENT");
  const knownOnly = points.filter((p) => !p.cls.violated.length && p.cls.knownHits.length);
  const stateHashes = new Set(points.map((p) => p.cls.hash));
  const dist = {};
  for (const p of points) dist[p.bucket] = (dist[p.bucket] || 0) + 1;
  flow.record("F56-4 分桶分布", JSON.stringify(dist));
  flow.record("F56-4b 每个断电点丢失的尾部业务步（步内断电 = 该步只落了一半就整体退回）",
    JSON.stringify(points.map((p) => p.M + ":" + (p.midStep ? "步内[" + p.landed + "]" : "步界[" + p.landed + "]"))));

  flow.section("C 断言");
  flow.eq("F56-2 无任何崩溃点出现库损坏（sql.js 打不开 / 缺文件）", corrupt.map((p) => p.M), []);
  flow.eq("F56-3 无任何崩溃点出现【新】不变量违反（V1/V2过/漏/V3/V7/V8）", incons.map((p) => p.M + ":" + p.cls.violated.join("/")), []);
  flow.eq("F56-4 每个 Nth 写都必须真的能断电（钩子未命中即为空跑）", points.filter((p) => p.M <= K && !p.killed).map((p) => p.M), []);
  flow.check("F56-5 快照互不相同：K+1 个盘上态 = K+1 个不同指纹（同一步内的第 2 次 persist 才会暴露半步入态）",
    stateHashes.size === K + 1, String(K + 1) + " 个不同态", stateHashes.size + " 个：" + points.map((p) => p.M + "=" + p.cls.hash.slice(0, 5)).join(" "));
  if (knownOnly.length) {
    flow.known("F56-6 已知缺陷模式（D-TEST-31/49/60/62 型）在整个崩溃区间内都不可达", knownOnly.length === 0, "D-TEST-31/49/60/62", "0 个崩溃点命中已知模式", JSON.stringify(knownOnly.map((p) => p.M + "→" + p.cls.knownHits.join("/"))).slice(0, 300));
  } else {
    flow.check("F56-6 已知缺陷模式（D-TEST-31/49/60/62 型）在崩溃区间不可达（本次全绿=无命中）", true, "0 命中", "0 命中");
  }
  // V9 实证：崩溃现场副本上冷启动，看 app 能否起来 + .tmp 是否被采纳
  flow.section("D 复原探针（崩溃现场**副本**上冷启动 app）");
  const probes = [];
  const wanted = new Set([1, Math.max(1, Math.round(K / 2)), K, K + 1, ...incons.map((p) => p.M), ...corrupt.map((p) => p.M), ...knownOnly.map((p) => p.M)]);
  for (const p of points) {
    if (!wanted.has(p.M)) continue;
    const copy = path.join(BASE, "probe-m" + p.M);
    freshDir(copy);
    // 崩溃现场必须**整份**搬过来：settings.json 不落进副本，探针就是在测一个不存在的世界
    for (const f of fs.readdirSync(p.dir)) {
      if (/^(library\.db|library\.db\.tmp|settings\.json)$/.test(f)) fs.copyFileSync(path.join(p.dir, f), path.join(copy, f));
    }
    const rr = spawnChild({ dir: copy, crashAt: 0, reopen: true });
    const j = readJson(path.join(copy, "f56-reopen.json")) || { booted: false, error: "无输出 status=" + rr.status + " " + (rr.err || "") };
    const after = await classifyDir(copy);
    probes.push({ M: p.M, j, tmpAdopted: !!j.tmpBefore && after.facts.cards > (p.cls.facts.cards ?? -1), afterHash: after.hash, preHash: p.cls.hash });
    console.log("  M=" + String(p.M).padStart(2) + " 冷启动=" + (j.booted ? "OK" : "FAIL:" + String(j.error).slice(0, 40)) +
      " 崩溃前.tmp=" + (j.tmpBefore ? "有" : "无") + " 启动后.tmp=" + (j.tmpAfter ? "有" : "无") +
      " 盘上cards " + (p.cls.facts.cards ?? "-") + "→" + after.facts.cards +
      " 起来后活跃配置=" + String(j.activeCfg ?? "null").slice(0, 12) + "（断电时盘上指针=" + String((p.cls.v4 || {}).ptr ?? "null").slice(0, 12) + "）" +
      " 态指纹 " + (j.tmpAdopted ? "被 .tmp 改写!" : "未变"));
  }
  flow.eq("F56-7 冷启动不得把 .tmp 采纳为活库（磁盘态指纹必须不变）", probes.filter((x) => x.tmpAdopted).map((x) => x.M), []);
  flow.eq("F56-8 任一崩溃点都必须能冷启动 app（断电不得变砖）", probes.filter((x) => !x.j.booted).map((x) => x.M + ":" + String(x.j.error).slice(0, 40)), []);
  const vac = {};
  for (const p of points) for (const v of p.cls.vacuous) { const k = v.slice(0, 2); vac[k] = (vac[k] || 0) + 1; }
  flow.record("F56-9 空转不变量（零行可检 = 绿色不等于更强结论）", JSON.stringify({
    points: points.length,
    每条形不变量在多少个崩溃点上无行可检: vac,
    对照点全绿基数: { v2Rows: ctlCls.v2Rows, v3: ctlCls.v3, v5: ctlCls.v5, v6: ctlCls.v6, v7: ctlCls.v7, v8: ctlCls.v8, v4: ctlCls.v4 },
    对照点空转: ctlCls.vacuous,
  }));
  flow.record("F56-10 V2/V3/V5 实测基数", JSON.stringify({ cardsWithFsrsRows: ctlCls.v2Rows, v3: ctlCls.v3, v5: ctlCls.v5, v4: ctlCls.v4, v7: ctlCls.v7, v8: ctlCls.v8 }));
  return { K, points, corrupt, incons, knownOnly, probes };
}

async function classifyDir(dir) {
  return classify(dir);
}

app
  .whenReady()
  .then(async () => {
    if (process.env.F56_DIR) {
      await runChild();
      return;
    }
    const s = await runFlow(flow, async () => {
      await runParent();
    });
    console.log(flow.summary());
    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F56 顶层异常：" + (e && e.stack ? e.stack : e));
    try { flow.writeResult({ crash: String((e && e.message) || e) }); } catch { /* ignore */ }
    process.exit(1);
  });

function quit(code) {
  try { app.exit(code); } catch { process.exit(code); }
}
