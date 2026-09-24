// F80 备份→还原的逐字段保真（换机还原场景：到底少了什么）
// @runtime: node  @tier: 1  @gui: false  @id: F80  @timeout: 480
// 运行：node tests/flows/f80-backup-roundtrip.cjs
//
// 与 F51 的分工：F51 验 ZIP 规范符合性（EOCD/中央目录/CRC/UTF-8 标志），本条验**语义**：
// 包里装了什么、还原到一台干净机器、重启之后，逐表逐字段是否等价。
// 三个子进程各跑一次 initDb（同进程第二次 initDb 会死锁，F71 实测踩过）：
//   seed    播种 + 打包 + 出包内清单 + 出快照
//   restore 在干净目录里 restoreBackup（它只 staging，真正换文件在下次启动）
//   restart 模拟重启：initDb + 出快照
"use strict";
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const { Flow, runFlow, ROOT, RESULTS_DIR, tmpUserDataDir, freshDir } = require("./lib/harness.cjs");
const { audit } = require("./lib/dbenv.cjs");
const { ELECTRON } = require("./lib/guienv.cjs");

const flow = new Flow({
  id: "F80",
  title: "备份还原逐字段保真",
  angle: "换机还原：包内覆盖面、还原后逐表逐字段等价性、settings/memory 是否跟着走",
  cites: ["§7.2", "§7.1.8", "D-TEST-35", "D-TEST-76"],
  tier: 1,
  gui: false,
});
const PREFIX = { seed: "F80SEED ", restore: "F80RES ", restart: "F80RESTART ", freshinit: "F80FRESH " };

async function snapshotAll(dir) {
  const a = await audit(path.join(dir, "library.db"));
  const tables = a.rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map((r) => r.name).sort();
  const out = {};
  for (const t of tables) out[t] = a.rows(`SELECT * FROM "${t}"`);
  a.close();
  return out;
}
const tree = (dir) => {
  const out = [];
  const walk = (d, rel) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? rel + "/" + f.name : f.name;
      if (f.isDirectory()) walk(path.join(d, f.name), r);
      else out.push(r);
    }
  };
  walk(dir, "");
  return out.sort();
};

if (process.env.F80_MODE) {
  const { app } = require("electron");
  const mode = process.env.F80_MODE;
  const dir = mode === "seed" ? freshDir(tmpUserDataDir("f80src")) : mode === "freshinit" ? freshDir(tmpUserDataDir("f80dst")) : tmpUserDataDir("f80dst");
  app.whenReady().then(async () => {
    app.setPath("userData", dir);
    fs.mkdirSync(dir, { recursive: true });
    const bk = require(path.join(ROOT, "electron", "backup.js"));
    const out = { dir, files: [], snap: {}, zip: null, entries: [], res: null, err: null };
    const db = require(path.join(ROOT, "electron", "db.js"));

    if (mode === "seed") {
      await db.initDb();
      for (let i = 0; i < 3; i++) {
        const it = db.createFromPaste(`F80 材料 ${i}`, `# 章 ${i}\n\n段落内容 ${i}。\n`);
        const itemId = it && (it.id || (it.item && it.item.id));
        for (let j = 0; j < 8; j++) {
          const c = db.createCard({ itemId, frontMarkdown: `F80 问 ${i}-${j}`, backMarkdown: `F80 答 ${i}-${j}`, cardType: "qa" });
          const id = c && (c.id || c.cardId);
          if (id && j % 3 === 0) db.execRawSql("UPDATE cards SET leech_json = ? WHERE id = ?", [JSON.stringify({ suspended: j === 0, isLeech: j === 3, lapses: j, hitCount: j * 2 }), id]);
        }
        db.createJournalEntry({ contentMarkdown: `F80 日记 ${i}`, source: "app" });
        db.createKnowledgePoint({ canonicalLabel: `F80 知识点 ${i}` });
      }
      db.persistNow();
      fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ theme: "dark", fontSize: 19, dayCutoffHour: 5, f80probe: "保留我" }), "utf-8");
      fs.mkdirSync(path.join(dir, "memory", "topics", "阅读"), { recursive: true });
      fs.writeFileSync(path.join(dir, "memory", "core.md"), "# 记忆\n<!-- 用户手写区 -->\n手写：每天 20 张\n", "utf-8");
      fs.writeFileSync(path.join(dir, "memory", "topics", "阅读", "笔记习惯.md"), "# 笔记习惯\n手写内容 A\n", "utf-8");
      // 夹具必须是**真正的** SQLite 文件：v48.21 起备份还原会校验换入对象的完整性，
      // 占位文本会被正确拒绝（那是产品做对了，不是回归），所以这里用 sql.js 造一个最小可读库。
      {
        const initSqlJs = require("sql.js");
        const SQL = await initSqlJs();
        const d = new SQL.Database();
        d.run("CREATE TABLE dictionary_cache (provider_id TEXT, language TEXT, normalized_word TEXT)");
        fs.writeFileSync(path.join(dir, "dictionary.db"), Buffer.from(d.export()));
        d.close();
      }
      const zipDir = path.join(RESULTS_DIR, "f80-backups");
      fs.mkdirSync(zipDir, { recursive: true });
      const r = await bk.createBackup({ dataDir: dir, backupDir: zipDir, label: "manual", now: new Date(), flush: () => db.persistNow() });
      out.res = r === undefined ? "undefined" : { ok: r.ok, file: r.file, error: r.error };
      if (r && r.file && fs.existsSync(r.file)) {
        out.zip = r.file;
        const JSZip = require(path.join(ROOT, "node_modules", "jszip"));
        const z = await JSZip.loadAsync(fs.readFileSync(r.file));
        out.entries = Object.keys(z.files).sort();
      }
      out.files = tree(dir);
      out.snap = await snapshotAll(dir);
    }

    if (mode === "freshinit") {
      // 模拟"装完软件第一次启动"：initDb 会建出空的 library.db。
      // 这一步是必需的——restoreBackup 会先给现状做一份安全备份，
      // 没有 library.db 时它会直接中止（实测 {ok:false,error:"恢复前安全备份失败…未找到数据库文件"}）。
      await db.initDb();
      db.persistNow();
      out.files = tree(dir);
    }

    if (mode === "restore") {
      const zip = process.env.F80_ZIP;
      const r = await bk.restoreBackup(zip, { dataDir: dir, backupDir: path.dirname(zip), now: new Date() });
      out.res = r === undefined ? "undefined" : r;
      out.files = tree(dir);
    }

    if (mode === "restart") {
      // 与 main.js:1336 完全同序：先 applyPendingRestore()（无参，走内部默认 userData），再 initDb。
      // 少了这一步就等于我自己没走完启动流程，不能把账算到产品头上（本轮第一版就踩了这个）。
      let applied = null;
      try { applied = bk.applyPendingRestore(); } catch (e) { out.err = "applyPendingRestore:" + String(e.message).slice(0, 160); }
      out.applied = applied === undefined ? "undefined" : applied;
      try { await db.initDb(); } catch (e) { out.err = (out.err || "") + " initDb:" + String(e.message).slice(0, 160); }
      out.files = tree(dir);
      if (fs.existsSync(path.join(dir, "library.db"))) {
        try { out.snap = await snapshotAll(dir); } catch (e) { out.err = (out.err || "") + " snap:" + String(e.message).slice(0, 120); }
      }
      try { out.settings = JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf-8")); } catch (e) { out.settings = "读不到:" + String(e.message).slice(0, 60); }
      try { out.memoryTree = tree(path.join(dir, "memory")); } catch { out.memoryTree = "无 memory 目录"; }
      try { out.dictSize = fs.statSync(path.join(dir, "dictionary.db")).size; } catch { out.dictSize = -1; }
    }
    console.log(PREFIX[mode] + JSON.stringify(out));
    app.exit(0);
  }).catch((e) => { console.log(PREFIX[mode] + JSON.stringify({ err: "outer " + String(e.message).slice(0, 240) })); app.exit(1); });
  return;
}

function child(mode, env) {
  const r = spawnSync(ELECTRON, [path.join(__dirname, "f80-backup-roundtrip.cjs")], {
    cwd: ROOT, env: { ...process.env, F80_MODE: mode, ...env }, encoding: "utf-8", timeout: 220000,
  });
  const pre = PREFIX[mode];
  const line = String(r.stdout || "").split(/\r?\n/).filter((l) => l.startsWith(pre)).pop();
  if (!line) return { err: `无输出 status=${r.status} stderr=${String(r.stderr || "").slice(-220)}` };
  try { return JSON.parse(line.slice(pre.length)); } catch (e) { return { err: "解析失败 " + e.message + " :: " + line.slice(0, 160) }; }
}

runFlow(flow, async () => {
  flow.section("S1 播种 3 材料 / 24 卡 / 3 日记 / 3 KP + settings.json + memory 树 + dictionary.db，然后打包");
  const seed = child("seed", {});
  if (!seed.snap) { flow.check("播种子进程必须出快照", false, "有 snap", JSON.stringify(seed).slice(0, 300)); return; }
  flow.record("userData 文件", seed.files.join(" · "));
  flow.record("createBackup 返回", JSON.stringify(seed.res));
  const tables = Object.keys(seed.snap).sort();
  flow.record("库内表数", `${tables.length} 张 · 总行数 ${tables.reduce((a, t) => a + seed.snap[t].length, 0)}`);

  flow.section("S2 包内覆盖面：userData 里每个数据文件是否都进了包");
  if (!seed.entries.length) { flow.check("备份包必须存在且可列出条目", false, "≥1 条", JSON.stringify(seed.res).slice(0, 200)); return; }
  flow.record("包内条目", seed.entries.join(" · "));
  const inPkg = new Set(seed.entries.map((e) => e.replace(/\/$/, "")));
  const dataFiles = seed.files.filter((f) => /^(library\.db|settings\.json|dictionary\.db|memory\/|assets\/|ai-config\.json)/.test(f));
  const missing = dataFiles.filter((f) => !inPkg.has(f));
  flow.record("应被覆盖的数据文件", dataFiles.join(" · "));
  flow.check("每个数据文件都必须在包里（漏一个 ⇒ 换机还原后永久丢失）", missing.length === 0, "0 个遗漏", missing.length ? `遗漏：${missing.join("、")}` : "全覆盖");

  flow.section("S3a 空机器直接还原（装完还没启动过就恢复）—— 预期被拒，且不得留半成品");
  freshDir(tmpUserDataDir("f80dst"));
  const res0 = child("restore", { F80_ZIP: seed.zip });
  flow.record("未首启就还原的返回", JSON.stringify(res0.res || res0.err).slice(0, 260));
  flow.record("失败后目录内容", (res0.files || []).join(" · ") || "空");
  flow.check("还原失败必须中止且不留半解压文件（数据分裂防护）", (res0.files || []).length === 0, "目录仍为空", (res0.files || []).join(" · ") || "空");

  flow.section("S3b 真实换机顺序：装 → 开一次（建空库）→ 恢复备份 → 重开");
  const fi = child("freshinit", {});
  flow.record("首启后的目录", (fi.files || []).join(" · ") || "空");
  const res = child("restore", { F80_ZIP: seed.zip });
  flow.record("restoreBackup 返回", JSON.stringify(res.res || res.err).slice(0, 300));
  if (res.err) { flow.check("还原子进程不得抛错", false, "不抛", res.err); return; }
  if (!res.res || res.res.ok !== true) {
    flow.check("首启之后还原必须成功（这一步失败 ⇒ 换机还原走不通）", false, "ok:true", JSON.stringify(res.res || res.err).slice(0, 260));
    return;
  }
  flow.record("还原后目录内容", (res.files || []).join(" · ") || "空");

  flow.section("S4 模拟重启后逐表逐字段对账");
  const rs = child("restart", {});
  flow.record("applyPendingRestore 返回", JSON.stringify(rs.applied || rs.err).slice(0, 260));
  if (!rs.snap || !Object.keys(rs.snap).length) { flow.check("重启后必须能读到还原出来的库", false, "有表", JSON.stringify({ err: rs.err, files: rs.files }).slice(0, 300)); return; }
  const t2 = Object.keys(rs.snap).sort();
  flow.record("表集合", `还原后 ${t2.length} 张 · 与播种侧${t2.join() === tables.join() ? "完全相同" : "不同"}`);
  const lostTables = tables.filter((t) => !t2.includes(t));
  flow.check("还原后不得少表", lostTables.length === 0, "0 张", lostTables.join("、") || "无");
  const rowDiff = [];
  const fieldDiff = [];
  for (const t of tables) {
    if (!rs.snap[t]) continue;
    const A = seed.snap[t], B = rs.snap[t];
    if (A.length !== B.length) rowDiff.push(`${t}: ${A.length} → ${B.length}`);
    const key = (r) => (r && r.id !== undefined ? String(r.id) : JSON.stringify(r));
    const mb = new Map(B.map((r) => [key(r), r]));
    for (const ra of A) {
      const rb = mb.get(key(ra));
      if (!rb) { if (fieldDiff.length < 12) fieldDiff.push(`${t} 行丢失 id=${key(ra).slice(0, 24)}`); continue; }
      for (const c of Object.keys(ra)) {
        if (String(ra[c]) !== String(rb[c])) { if (fieldDiff.length < 12) fieldDiff.push(`${t}.${c} id=${key(ra).slice(0, 18)}：${String(ra[c]).slice(0, 28)} → ${String(rb[c]).slice(0, 28)}`); }
      }
    }
  }
  flow.record("行数差异", rowDiff.join(" · ") || "无");
  flow.record("字段级差异（最多列 12 条）", fieldDiff.join(" · ") || "无");
  flow.check("每张表行数必须一致", rowDiff.length === 0, "0 处", rowDiff.join(" · "));
  flow.check("逐行逐字段必须一致", fieldDiff.length === 0, "0 处", fieldDiff.join(" · "));

  flow.section("S5 库外的东西：settings / memory / dictionary.db 还原后还在不在");
  flow.record("settings.json", JSON.stringify(rs.settings));
  flow.record("memory 树", JSON.stringify(rs.memoryTree));
  flow.record("dictionary.db 字节", rs.dictSize);
  const lostSettings = !(rs.settings && typeof rs.settings === "object" && rs.settings.f80probe === "保留我");
  const lostMemory = !(Array.isArray(rs.memoryTree) && rs.memoryTree.some((f) => f.indexOf("笔记习惯") >= 0));
  flow.check("用户偏好（settings.json）必须随还原回来", lostSettings === false, "f80probe 仍在", JSON.stringify(rs.settings));
  flow.check("手写记忆文件必须随还原回来", lostMemory === false, "topics/阅读/笔记习惯.md 仍在", JSON.stringify(rs.memoryTree));
  flow.record("未覆盖", "还原中途断电/包损坏的半成品目录检查（需故障注入，本条只测了正常路径）；assets/ 与封面文件（播种不产真封面）");
});
