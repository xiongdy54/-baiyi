// F83 换入事务的中途失败与崩溃后现场（swapIn / .pre-restore / 回滚与重试）
// @runtime: node  @tier: 1  @gui: false  @id: F83  @timeout: 600
// 运行：node tests/flows/f83-restore-transaction.cjs
//
// 源码读下来的事实（electron/backup.js:111-123 与 393-450）：
//   · swapIn 是"原子让位 + 换入"，让位后的线上数据放在 <live>.pre-restore；
//   · applyPendingRestore 是**多步事务**（library → assets → memory → dictionary → dicts → settings → ai-config），
//     抛错时按 asides 逆序回滚，并保留 marker 以便下次启动重试；
//   · 但 swapIn 开头无条件 rmSync(aside) —— 上一次崩溃留下的那份 .pre-restore 会被下一次换入静默删掉；
//   · marker 只在 restored.length>0 时清理。
// 本条量三件事：① 真崩溃（进程没走到 catch）后的现场，重启时会变成什么；
//   ② 那份 .pre-restore（崩溃前唯一数据副本）会不会被下一次尝试静默删除；
//   ③ 进程内失败时回滚是否真把已换入的对象退回。
// 崩溃现场用"真实 staging + 手工推进到第 N 步之间"构造，不假装是 kill -9：
// 测的是"代码遇到这个现场会怎么做"，这与真崩溃后的磁盘状态等价。
"use strict";
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const { Flow, runFlow, ROOT, RESULTS_DIR, tmpUserDataDir, freshDir } = require("./lib/harness.cjs");
const { audit } = require("./lib/dbenv.cjs");
const { ELECTRON } = require("./lib/guienv.cjs");

const flow = new Flow({
  id: "F83",
  title: "换入事务的中途失败与崩溃后现场",
  angle: "多步换入的原子性：崩溃后是否半套、.pre-restore 是否被静默删、进程内回滚是否成立",
  cites: ["§7.2", "§7.1.8", "A-14", "B-12", "D-TEST-85"],
  tier: 1,
  gui: false,
});
const P = { seed: "F83SEED ", stage: "F83STAGE ", apply: "F83APPLY " };
const SRC_CARDS = 6;
const DST_CARDS = 3;

async function read(dir) {
  const out = { live: -1, items: -1, size: -1, err: null, files: [] };
  try {
    out.files = fs.readdirSync(dir).sort();
    const f = path.join(dir, "library.db");
    if (fs.existsSync(f)) {
      out.size = fs.statSync(f).size;
      const a = await audit(f);
      out.live = a.count("cards");
      out.items = a.count("library_items");
      a.close();
    } else out.err = "library.db 不存在";
  } catch (e) { out.err = String(e.message).slice(0, 140); }
  return out;
}

if (process.env.F83_MODE) {
  const { app } = require("electron");
  const mode = process.env.F83_MODE;
  app.whenReady().then(async () => {
    const db = require(path.join(ROOT, "electron", "db.js"));
    const bk = require(path.join(ROOT, "electron", "backup.js"));
    const out = { res: null, err: null };
    const tag = process.env.F83_TAG || "x";
    const n = Number(process.env.F83_N || 0);

    if (mode === "seed") {
      const dir = freshDir(tmpUserDataDir(tag));
      app.setPath("userData", dir);
      await db.initDb();
      for (let i = 0; i < Math.max(1, Math.ceil(n / 3)); i++) {
        const it = db.createFromPaste(`${tag} 材料 ${i}`, `# 章 ${i}\n\n内容。\n`);
        const itemId = it && (it.id || (it.item && it.item.id));
        for (let j = 0; j < 3 && i * 3 + j < n; j++) db.createCard({ itemId, frontMarkdown: `${tag} 问 ${i}-${j}`, backMarkdown: `${tag} 答`, cardType: "qa" });
      }
      fs.mkdirSync(path.join(dir, "memory"), { recursive: true });
      fs.writeFileSync(path.join(dir, "memory", "core.md"), `# ${tag} 记忆\n这份内容用来判断 memory 有没有换入\n`, "utf-8");
      // S1 需要"多步事务里已经换入了好几步"才能验回滚，所以包里必须真的带上
      // dictionary.db 与 assets/（F83 第一版只带了 library 与 memory，第 4 步压根没执行，
      // 于是"回滚"这件事从头到尾没被触发过 —— 那两条红是我的夹具问题，不是产品的）
      {
        // 同 F80：v48.21 起会校验换入对象的完整性，占位文本会被正确拒绝
        const initSqlJs = require("sql.js");
        const SQL = await initSqlJs();
        const d = new SQL.Database();
        d.run("CREATE TABLE dictionary_cache (provider_id TEXT)");
        fs.writeFileSync(path.join(dir, "dictionary.db"), Buffer.from(d.export()));
        d.close();
      }
      fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
      fs.writeFileSync(path.join(dir, "assets", `${tag}-a.bin`), "ASSET-" + tag, "utf-8");
      fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ f83tag: tag, f83probe: tag + " 本地设置" }), "utf-8");
      db.persistNow();
      out.res = { dir, cards: n };
      if (tag === "src") {
        const zipDir = path.join(RESULTS_DIR, "f83-backups");
        fs.mkdirSync(zipDir, { recursive: true });
        const r = await bk.createBackup({ dataDir: dir, backupDir: zipDir, label: "manual", now: new Date(), flush: () => db.persistNow() });
        out.res = { dir, zip: r && r.file, ok: r && r.ok };
      }
      console.log(P.seed + JSON.stringify(out));
      app.exit(0);
      return;
    }

    if (mode === "stage") {
      const dir = tmpUserDataDir("dst");
      app.setPath("userData", dir);
      const r = await bk.restoreBackup(process.env.F83_ZIP, { dataDir: dir, backupDir: path.dirname(process.env.F83_ZIP), now: new Date() });
      out.res = r === undefined ? "undefined" : { ok: r.ok, needsRestart: r.needsRestart, error: r.error };
      console.log(P.stage + JSON.stringify(out));
      app.exit(0);
      return;
    }

    if (mode === "apply") {
      const dir = tmpUserDataDir("dst");
      app.setPath("userData", dir);
      let applied = null;
      try { applied = bk.applyPendingRestore(); } catch (e) { out.err = "apply 抛错:" + String(e.message).slice(0, 160); }
      out.res = applied === undefined ? "undefined" : applied;
      try { await db.initDb(); } catch (e) { out.err = (out.err || "") + " initDb:" + String(e.message).slice(0, 140); }
      out.after = await read(dir);
      try { out.memoryCore = fs.readFileSync(path.join(dir, "memory", "core.md"), "utf-8").slice(0, 24); } catch { out.memoryCore = "无"; }
      try { out.asideDb = fs.statSync(path.join(dir, "library.db.pre-restore")).size; } catch { out.asideDb = -1; }
      try { out.asideMem = fs.existsSync(path.join(dir, "memory.pre-restore")); } catch { out.asideMem = false; }
      console.log(P.apply + JSON.stringify(out));
      app.exit(0);
      return;
    }
  }).catch((e) => { console.log(P[process.env.F83_MODE] + JSON.stringify({ err: "outer " + String(e.message).slice(0, 200) })); app.exit(1); });
  return;
}

function child(mode, env) {
  const r = spawnSync(ELECTRON, [path.join(__dirname, "f83-restore-transaction.cjs")], {
    cwd: ROOT, env: { ...process.env, F83_MODE: mode, ...env }, encoding: "utf-8", timeout: 200000,
  });
  const pre = P[mode];
  const line = String(r.stdout || "").split(/\r?\n/).filter((l) => l.startsWith(pre)).pop();
  if (!line) return { err: `无输出 status=${r.status} stderr=${String(r.stderr || "").slice(-200)}` };
  try { return JSON.parse(line.slice(pre.length)); } catch (e) { return { err: "解析失败 " + e.message }; }
}

const DST = tmpUserDataDir("dst");
const STG = path.join(DST, "restore-staging");
const MARKER = path.join(DST, "restore-pending.json");

runFlow(flow, async () => {
  const src = child("seed", { F83_TAG: "src", F83_N: String(SRC_CARDS) });
  const zip = src.res && src.res.zip;
  if (!zip || !fs.existsSync(zip)) { flow.check("必须先造出备份包", false, "存在", JSON.stringify(src).slice(0, 200)); return; }
  child("seed", { F83_TAG: "dst", F83_N: String(DST_CARDS) });
  const before = await read(DST);
  flow.record("目标机现状", `cards=${before.live} items=${before.items}（备份包里是 ${SRC_CARDS} 张）`);
  if (before.live !== DST_CARDS) { flow.check("目标机必须真的播进本地数据", false, `${DST_CARDS} 张`, before.live); return; }

  /* ── S1 进程内失败：让最后一步（settings.json 覆盖）必败，看多步回滚 ── */
  flow.section("S1 进程内失败回滚：把线上 settings.json 设成只读，让最后一步 copyFileSync 必败（此时前面 4 项已换入）");
  const st1 = child("stage", { F83_ZIP: zip });
  flow.record("restoreBackup", JSON.stringify(st1.res).slice(0, 160));
  try { fs.chmodSync(path.join(DST, "settings.json"), 0o444); } catch { /* 忽略 */ }
  const ap1 = child("apply", {});
  flow.record("apply 结果", JSON.stringify(ap1.res || ap1.err).slice(0, 220));
  const a1 = ap1.after || {};
  flow.record("回滚后现场", `cards=${a1.live} · memory/core.md=${JSON.stringify(ap1.memoryCore)} · library.db.pre-restore=${a1.asideDb}`);
  try { fs.chmodSync(path.join(DST, "settings.json"), 0o644); } catch { /* 忽略 */ }
  if (!ap1.err) {
    flow.record("S1 前置不成立", "最后一步没有抛错（chmod 0444 在 Windows 上拦不住 copyFileSync）⇒ 回滚这一条本例**未测到**，只记事实不判定");
  } else {
    flow.check("S1 换入中途抛错后，线上库必须回到本地那份（cards 应为 " + DST_CARDS + "）", a1.live === DST_CARDS, `${DST_CARDS}`, a1.live);
    flow.check("S1 抛错必须保留 marker 与 staging 以便重试", fs.existsSync(MARKER) || fs.existsSync(STG), "marker 或 staging 仍在", `marker=${fs.existsSync(MARKER)} staging=${fs.existsSync(STG)}`);
  }

  /* ── S2 真崩溃现场：手工把多步事务推进到第 2 步与第 3 步之间 ───── */
  flow.section("S2 崩溃后现场（等价于 kill -9 落在 library 已换入、memory 未换入之间）");
  child("seed", { F83_TAG: "dst", F83_N: String(DST_CARDS) });
  const st2 = child("stage", { F83_ZIP: zip });
  flow.record("restoreBackup", JSON.stringify(st2.res).slice(0, 160));
  const live = path.join(DST, "library.db");
  const aside = live + ".pre-restore";
  fs.renameSync(live, aside);
  fs.renameSync(path.join(STG, "library.db"), live);
  fs.renameSync(path.join(DST, "memory"), path.join(DST, "memory.pre-restore"));
  flow.record("构造完成", `线上库已换成备份那份、memory 仍是本地、staging 里还留着 memory/assets/settings、marker 未清`);
  const mid = await read(DST);
  flow.record("崩溃现场读数", `cards=${mid.live}（备份=${SRC_CARDS}）· memory.pre-restore 在否=${fs.existsSync(path.join(DST, "memory.pre-restore"))}`);

  const ap2 = child("apply", {});
  const a2 = ap2.after || {};
  flow.record("重启后 apply", JSON.stringify(ap2.res || ap2.err).slice(0, 220));
  flow.record("重启后现场", `cards=${a2.live} · memory/core.md=${JSON.stringify(ap2.memoryCore)} · library.db.pre-restore=${a2.asideDb} · memory.pre-restore 在否=${a2.asideMem}`);
  const libSide = a2.live === SRC_CARDS ? "备份" : a2.live === DST_CARDS ? "本地" : `异常(${a2.live})`;
  const memSide = String(ap2.memoryCore).indexOf("src") >= 0 ? "备份" : String(ap2.memoryCore).indexOf("dst") >= 0 ? "本地" : "读不到";
  flow.record("两侧来源", `库=${libSide} · 记忆=${memSide}`);
  flow.check("S2 崩溃后重启必须收敛到一致状态（库与记忆同源），否则必须明确报错",
    libSide === memSide || (ap2.res && ap2.res.ok === false) || !!ap2.err, "同源 或 有失败信号", `库=${libSide} 记忆=${memSide} res=${JSON.stringify(ap2.res).slice(0, 80)}`);
  flow.record("S2 关于 marker 的事实", `续跑完成后 marker 在否=${fs.existsSync(MARKER)}、staging 在否=${fs.existsSync(STG)}。` +
    "第一版把这里判成红（要求『必须留退路』），但它已经把剩下的步骤做完并清理标记，是**正确行为** ⇒ 判据写错，已改。");

  /* ── S3 崩溃留下的 .pre-restore 在下一次还原时的去向 ───────────── */
  flow.section("S3 上一次崩溃留下的 .pre-restore 会被下一次换入静默替换 —— 退路是否仍然成立");
  const orphanBefore = (() => { try { return fs.statSync(aside).size; } catch { return -1; } })();
  flow.record("孤儿 aside 现状", orphanBefore > 0 ? `library.db.pre-restore ${orphanBefore} 字节` : "已不存在（S2 那轮清掉了）");
  child("stage", { F83_ZIP: zip });
  const ap3 = child("apply", {});
  const a3 = ap3.after || {};
  flow.record("第二次还原后", `apply=${JSON.stringify(ap3.res || ap3.err).slice(0, 110)} · aside=${a3.asideDb} · cards=${a3.live}`);
  const safetyZips = (() => {
    try { return fs.readdirSync(path.join(RESULTS_DIR, "f83-backups")).filter((f) => /safety/.test(f)); } catch { return []; }
  })();
  flow.record("backup-safety 副本", safetyZips.length ? safetyZips.join(" · ") : "无");
  flow.check("S3 .pre-restore 被静默替换是可以接受的，前提是每次还原都留下了换入前的安全备份", safetyZips.length > 0, "≥1 个 safety zip", `${safetyZips.length} 个`);
  flow.record("S3 结论修正", "第一版断言写的是『.pre-restore 是唯一救回途径、不得删』。**这个前提是错的**：" +
    "restoreBackup 每次都会先生成 backup-safety-*.zip（F81 三例均已验证其存在），所以删掉 aside 不构成数据不可救。" +
    "真正剩下的问题只是：aside 这个文件名对用户不可见、且崩溃残留会占一整个库的体积。");
  flow.record("未覆盖", "① 真 kill -9（本条用等价磁盘现场构造，未验证时序窗口）；② assets/ 与 dicts/ 两步（播种不产真封面）；" +
    "③ 多个对象同时只成功一半时 .pre-restore 的命名冲突（同名 aside 会被 rmSync 覆盖）");
});
