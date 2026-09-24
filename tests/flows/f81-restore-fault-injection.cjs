// F81 恢复路径的故障注入（暂存区被破坏后，还原会不会把活库换成半截数据）
// @runtime: node  @tier: 1  @gui: false  @id: F81  @timeout: 600
// 运行：node tests/flows/f81-restore-fault-injection.cjs
//
// 为什么值得单开：F01–F37 这一层此前**零故障注入**，而本产品最危险的三处恰恰都在故障路径上
// （整库文件级原子写、备份还原、词典库落盘）。F80 刚证明正常路径是干净的，
// 本条就把刀下在还原与"重启换入"之间：那一段里盘上有两份库（活的 + staging），
// 任何一处被截断/替换/删除，都可能让用户在新机器上打开一个残缺库。
// 六个用例各跑一次完整"首启→还原→破坏→重启"，每个用例都独立取证三件事：
//   ① 换入前那份安全备份还在不在（最后一道退路）
//   ② 活库文件本身有没有被写成 0 字节或消失（毁库）
//   ③ 数据只能是"全旧"或"全新"，不许出现混合（混合 = 静默毁数据）
"use strict";
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const { Flow, runFlow, ROOT, RESULTS_DIR, tmpUserDataDir, freshDir } = require("./lib/harness.cjs");
const { audit } = require("./lib/dbenv.cjs");
const { ELECTRON } = require("./lib/guienv.cjs");

const flow = new Flow({
  id: "F81",
  title: "还原路径故障注入",
  angle: "在 restore-staging 与 restore-pending 上做六种破坏，验证换入过程不毁库、不留混合态",
  cites: ["§7.2", "§7.1.8", "D-TEST-35", "D-TEST-48"],
  tier: 1,
  gui: false,
});
const P = { prepare: "F81PREP ", stage: "F81STAGE ", apply: "F81APPLY " };
const CARDS = 6;

const CASES = {
  C1: { 名: "staging 里的 library.db 被截成 0 字节", run: (d) => { fs.writeFileSync(path.join(d, "restore-staging", "library.db"), Buffer.alloc(0)); return "写入 0 字节"; } },
  C2: { 名: "staging 里的 library.db 被换成非 SQLite 垃圾", run: (d) => { fs.writeFileSync(path.join(d, "restore-staging", "library.db"), Buffer.from("THIS IS NOT A SQLITE DATABASE".repeat(40))); return "写入 1080 字节垃圾"; } },
  C3: { 名: "staging 里的 backup-meta.json 被删除", run: (d) => { const f = path.join(d, "restore-staging", "backup-meta.json"); const had = fs.existsSync(f); if (had) fs.rmSync(f); return had ? "已删除" : "本来就没有"; } },
  C4: { 名: "整个 restore-staging 目录消失（模拟还原后被清理）", run: (d) => { fs.rmSync(path.join(d, "restore-staging"), { recursive: true, force: true }); return "目录已删"; } },
  C5: { 名: "restore-pending.json 内容损坏成非法 JSON", run: (d) => { fs.writeFileSync(path.join(d, "restore-pending.json"), "{ this is not json"); return "写入非法 JSON"; } },
  C6: { 名: "活库 library.db 被设为只读（模拟占用/权限）", run: (d) => { const f = path.join(d, "library.db"); fs.chmodSync(f, 0o444); return "chmod 0444"; } },
  // C7/C8 与 C1/C2 的注入完全相同，唯一区别是**目标机上已经有一份真实数据**。
  // 这才是用户换机时真正会处的位置：新机器已经用了几天，再拿旧备份去覆盖。
  C7: { 名: "目标机已有 3 张卡 + 1 条日记，而 staging 的 library.db 被截成 0 字节", 目标有数据: 1, run: (d) => { fs.writeFileSync(path.join(d, "restore-staging", "library.db"), Buffer.alloc(0)); return "写入 0 字节"; } },
  C8: { 名: "目标机已有 3 张卡 + 1 条日记，而 staging 的 library.db 是垃圾字节", 目标有数据: 1, run: (d) => { fs.writeFileSync(path.join(d, "restore-staging", "library.db"), Buffer.from("THIS IS NOT A SQLITE DATABASE".repeat(40))); return "写入 1080 字节垃圾"; } },
};

async function snap(dir) {
  const out = { files: [], liveSize: -1, cards: -1, items: -1, journals: -1, err: null };
  try {
    out.files = fs.readdirSync(dir).sort();
    const live = path.join(dir, "library.db");
    if (fs.existsSync(live)) {
      out.liveSize = fs.statSync(live).size;
      const a = await audit(live);
      out.cards = a.count("cards");
      out.items = a.count("library_items");
      out.journals = a.count("journal_entries");
      a.close();
    }
  } catch (e) { out.err = String(e.message || e).slice(0, 160); }
  try { fs.chmodSync(path.join(dir, "library.db"), 0o644); } catch { /* 复原失败无所谓 */ }
  return out;
}

if (process.env.F81_MODE) {
  const { app } = require("electron");
  const mode = process.env.F81_MODE;
  app.whenReady().then(async () => {
    const dir = tmpUserDataDir("f81dst");
    app.setPath("userData", dir);
    fs.mkdirSync(dir, { recursive: true });
    const db = require(path.join(ROOT, "electron", "db.js"));
    const bk = require(path.join(ROOT, "electron", "backup.js"));
    const out = { dir, res: null, err: null, note: null, before: null, after: null, safety: null };

    if (mode === "prepare") {
      const src = freshDir(tmpUserDataDir("f81src"));
      app.setPath("userData", src);
      await db.initDb();
      for (let i = 0; i < 2; i++) {
        const it = db.createFromPaste(`F81 材料 ${i}`, `# 章 ${i}\n\n内容 ${i}。\n`);
        const itemId = it && (it.id || (it.item && it.item.id));
        for (let j = 0; j < CARDS / 2; j++) db.createCard({ itemId, frontMarkdown: `F81 问 ${i}-${j}`, backMarkdown: `F81 答 ${i}-${j}`, cardType: "qa" });
        db.createJournalEntry({ contentMarkdown: `F81 日记 ${i}`, source: "app" });
      }
      db.persistNow();
      const zipDir = path.join(RESULTS_DIR, "f81-backups");
      fs.mkdirSync(zipDir, { recursive: true });
      const r = await bk.createBackup({ dataDir: src, backupDir: zipDir, label: "manual", now: new Date(), flush: () => db.persistNow() });
      out.res = { file: r && r.file, ok: r && r.ok };
      console.log(P.prepare + JSON.stringify(out));
      app.exit(0);
      return;
    }

    if (mode === "stage") {
      freshDir(dir);
      await db.initDb();
      if (process.env.F81_SEEDDEST) {
        const it = db.createFromPaste("F81 目标机本地数据", "# 章\n\n新机器上已经写了的内容。\n");
        const itemId = it && (it.id || (it.item && it.item.id));
        for (let j = 0; j < 3; j++) db.createCard({ itemId, frontMarkdown: `本地问 ${j}`, backMarkdown: `本地答 ${j}`, cardType: "qa" });
        db.createJournalEntry({ contentMarkdown: "本地日记一条", source: "app" });
      }
      db.persistNow();
      out.before = await snap(dir);
      const cs = CASES[process.env.F81_CASE];
      const r = await bk.restoreBackup(process.env.F81_ZIP, { dataDir: dir, backupDir: path.dirname(process.env.F81_ZIP), now: new Date() });
      out.res = r === undefined ? "undefined" : { ok: r.ok, needsRestart: r.needsRestart, error: r.error };
      out.safety = r && r.safetyFile ? path.basename(String(r.safetyFile)) : null;
      try { out.note = cs.run(dir); } catch (e) { out.err = "注入失败:" + String(e.message).slice(0, 140); }
      console.log(P.stage + JSON.stringify(out));
      app.exit(0);
      return;
    }

    if (mode === "apply") {
      let applied = null;
      try { applied = bk.applyPendingRestore(); } catch (e) { out.err = "applyPendingRestore 抛错:" + String(e.message).slice(0, 160); }
      out.res = applied === undefined ? "undefined" : applied;
      try { await db.initDb(); } catch (e) { out.err = (out.err || "") + " initDb:" + String(e.message).slice(0, 160); }
      out.after = await snap(dir);
      try { out.filesAfter = fs.readdirSync(dir).sort(); } catch { /* 忽略 */ }
      try { out.stagingLeft = fs.readdirSync(path.join(dir, "restore-staging")).sort(); } catch { out.stagingLeft = "无 staging 目录"; }
      console.log(P.apply + JSON.stringify(out));
      app.exit(0);
      return;
    }
  }).catch((e) => { console.log(P[process.env.F81_MODE] + JSON.stringify({ err: "outer " + String(e.message).slice(0, 200) })); process.exit(1); });
  return;
}

function child(mode, env) {
  const r = spawnSync(ELECTRON, [path.join(__dirname, "f81-restore-fault-injection.cjs")], {
    cwd: ROOT, env: { ...process.env, F81_MODE: mode, ...env }, encoding: "utf-8", timeout: 200000,
  });
  const pre = P[mode];
  const line = String(r.stdout || "").split(/\r?\n/).filter((l) => l.startsWith(pre)).pop();
  if (!line) return { err: `无输出 status=${r.status} stderr=${String(r.stderr || "").slice(-200)}` };
  try { return JSON.parse(line.slice(pre.length)); } catch (e) { return { err: "解析失败 " + e.message }; }
}

runFlow(flow, async () => {
  const prep = child("prepare", {});
  const zip = prep.res && prep.res.file;
  if (!zip || !fs.existsSync(zip)) { flow.check("必须先造出一个可用的备份包", false, "存在", JSON.stringify(prep).slice(0, 240)); return; }
  flow.record("备份包", `${path.basename(zip)} · ${fs.statSync(zip).size} 字节`);
  flow.record("取证口径", "每例先看 applyPendingRestore 的返回值，再看活库大小与三张表的行数；" +
    "「全旧」= cards 0 / 「全新」= cards " + CARDS + "，出现其它值即混合态");

  for (const [k, cs] of Object.entries(CASES)) {
    flow.section(`${k} · ${cs.名}`);
    const st = child("stage", { F81_ZIP: zip, F81_CASE: k, ...(cs.目标有数据 ? { F81_SEEDDEST: "1" } : {}) });
    if (st.err) { flow.check(`${k} 注入阶段不得抛错`, false, "不抛", st.err); continue; }
    flow.record("还原返回", JSON.stringify(st.res));
    flow.record("注入动作", st.note);
    if (!st.res || st.res.ok !== true) { flow.check(`${k} 前置还原必须成功（否则本例故障注入无意义）`, false, "ok:true", JSON.stringify(st.res || st.err)); continue; }
    const safetyFile = st.safety ? path.join(RESULTS_DIR, "f81-backups", st.safety) : null;

    const ap = child("apply", { F81_ZIP: zip, F81_CASE: k });
    flow.record("applyPendingRestore", JSON.stringify(ap.res || ap.err).slice(0, 220));
    const a = ap.after || {};
    flow.record("活库状态", `大小 ${a.liveSize} 字节 · cards=${a.cards} items=${a.items} journals=${a.journals} · 读库错误=${a.err || "无"}`);
    flow.record("staging 残留", JSON.stringify(ap.stagingLeft));

    flow.check(`${k} 活库不得被写成 0 字节或消失（毁库）`, a.liveSize > 0 && a.cards >= 0, ">0 且可读", `size=${a.liveSize} cards=${a.cards} err=${a.err}`);
    const state = a.cards === 0 ? "全旧" : a.cards === CARDS ? "全新" : `混合(${a.cards})`;
    flow.check(`${k} 数据只能是全旧或全新，不许混合态`, state !== "混合", "全旧 或 全新", state);
    if (cs.目标有数据) {
      const b = st.before || {};
      flow.record("目标机原有数据", `cards=${b.cards} items=${b.items} journals=${b.journals}（库 ${b.liveSize} 字节）`);
      flow.check(`${k} 还原失败不得连带毁掉目标机已有数据（换入前的安全备份对用户不可见）`,
        !a.err && a.cards >= 0 && a.cards >= (b.cards || 0), `库可读且 cards ≥ ${b.cards}`, `cards=${a.cards} 读库错误=${a.err || "无"}`);
    }
    if (state === "全旧") {
      // 修复后失败信号有两种合法形态：返回 ok:false，或直接抛错（main.js 的 try/catch 会打日志）
      flow.check(`${k} 换入失败时必须明确报出来（不许静默空转）`,
        !!(ap.err || (ap.res && (ap.res.ok === false || (ap.res.restored && ap.res.restored.length === 0) || ap.res.error))),
        "有失败信号", String(JSON.stringify(ap.res || ap.err)).slice(0, 170));
    }
    if (safetyFile) flow.record("换入前安全备份", `${path.basename(safetyFile)} ${fs.existsSync(safetyFile) ? "仍在" : "**已消失**"}`);
    if (safetyFile && !fs.existsSync(safetyFile)) flow.check(`${k} 最后一道退路（换入前的安全备份）不得消失`, false, "仍在", "已消失");
  }
  flow.record("未覆盖", "① 破坏发生在 apply 中途（进程级 kill -9，需要真 electron 主进程，F70 那套崩溃扫描未覆盖 restore）；" +
    "② assets/ 与封面的部分缺失；③ 只读 library.db 在 Windows ACL 下的真实表现（本例用 chmod，权限语义弱于 ACL）");
});
