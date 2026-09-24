// F39 夹具（子进程）：在一份**路径敌意的 dataDir 拼写**上走一遍用户旅程，把每一步的成败如实写进
// F39_OUT 指向的 JSON，由父流程只读打开落盘的 library.db 做表级核对。
// 一个拼名 = 一个进程（electron 冷启动 ~2s），因为 userData 是在 electron/db.js → settingsStore
// 模块加载时固化的（electron/main.js:7-9 的注释就是这条纪律），同进程换目录会把「应用看到的目录」
// 与「设置文件所在目录」拆成两半，测出来的红就说不清是谁的责任了。
//
// 覆盖：initDb → 建书/建卡/写日记 → persist → 资源落盘（原文件 + 内嵌图）→ 手动备份 →
//       备份后又一次写（用来验证恢复真的回滚）→ restoreBackup → applyPendingRestore → 重启重开库。
// 环境变量：F39_ROOT 仓库根 / F39_DIR 目标 dataDir / F39_LABEL 场景名 / F39_OUT 结果 JSON 路径
// @runtime: electron
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { app } = require("electron");

const ROOT = process.env.F39_ROOT;
const DIR = process.env.F39_DIR;
const LABEL = String(process.env.F39_LABEL || "case");
const OUT = process.env.F39_OUT;
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000975d1b7d00000000049454e44ae426082",
  "hex"
);
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex").slice(0, 16);

const R = {
  label: LABEL,
  dirSet: DIR,
  dirEffective: null,
  dirLen: DIR.length,
  steps: {},
  ids: {},
  files: {},
  postRestore: {},
  tree: [],
  errors: [],
};
function step(name, fn) {
  const rec = { ok: false };
  R.steps[name] = rec;
  try {
    const v = fn();
    rec.ok = true;
    if (v !== undefined) Object.assign(rec, typeof v === "object" && v !== null ? v : { value: v });
  } catch (e) {
    rec.err = String((e && e.message) || e).slice(0, 220);
    rec.code = e && e.code;
    R.errors.push(name + ": " + rec.err);
  }
  return rec;
}
async function astep(name, fn) {
  const rec = { ok: false };
  R.steps[name] = rec;
  try {
    const v = await fn();
    rec.ok = true;
    if (v && typeof v === "object") Object.assign(rec, v);
  } catch (e) {
    rec.err = String((e && e.message) || e).slice(0, 220);
    rec.code = e && e.code;
    R.errors.push(name + ": " + rec.err);
  }
  return rec;
}
function flush() {
  try { fs.writeFileSync(OUT, JSON.stringify(R, null, 2)); } catch (e) { console.log("OUT 写失败 " + e.message); }
}

try {
  app.setPath("userData", DIR);
  R.dirEffective = app.getPath("userData");
} catch (e) {
  R.errors.push("setPath: " + String((e && e.message) || e));
}

// 安全网：userData 必须真的落到被测拼写上、且在系统临时目录内。setPath 一旦被 Electron 拒绝/改写，
// 后面的 initDb 就会去写**用户真实资料目录**——那是本流程绝对不许碰的东西，宁可当场退出。
function sandboxOk() {
  const os = require("os");
  const norm = (s) => String(s).replace(/^\\\\\?\\/, "").replace(/[\\/.]+$/, "").toLowerCase();
  const eff = norm(R.dirEffective || "");
  return eff === norm(DIR) && eff.startsWith(norm(os.tmpdir()));
}
if (!sandboxOk()) {
  R.errors.push("ABORT-UNSAFE-USERDATA: 生效目录 " + JSON.stringify(R.dirEffective) + " 不等于目标 " + JSON.stringify(DIR) + "，或不在临时目录内");
  flush();
  try { app.exit(3); } catch { process.exit(3); }
  throw new Error("拒绝在非沙箱 userData 上运行");
}

function relTree(dir) {
  const out = [];
  const walk = (d, rel, depth) => {
    if (depth > 6 || out.length > 400) return;
    let es;
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { out.push(r + "/"); walk(path.join(d, e.name), r, depth + 1); }
      else { out.push(r); if (out.length > 400) return; }
    }
  };
  walk(dir, "", 0);
  return out;
}

(async () => {
  const dbPath = path.join(ROOT, "electron", "db.js");
  let db = null;
  await astep("initDb", async () => {
    delete require.cache[dbPath];
    db = require(dbPath);
    await db.initDb();
    return {};
  });
  if (!db) { flush(); try { app.exit(0); } catch { process.exit(1); } return; }

  const NL = String.fromCharCode(10);
  step("writeCore", () => {
    const bk = db.createFromPaste(`F39 ${LABEL} 增量阅读之书`, ["# 第一章", "", "渐进阅读正文：卡片会从这里长出来。"].join(NL));
    R.ids.itemId = bk.id;
    R.ids.documentId = bk.documentId;
    const c = db.createCard({
      noteText: `F39-${LABEL}-PRE`,
      cardType: "qa",
      frontMarkdown: `问题 ${LABEL}`,
      backMarkdown: `答案 ${LABEL}`,
      priority: 50,
      tags: [],
      documentId: bk.documentId,
    });
    R.ids.preCardId = c.id;
    const je = db.createJournalEntry({ contentMarkdown: `F39 ${LABEL} 的日记一条。` });
    R.ids.journalId = je && je.id;
    db.persistNow();
    return { cards: db.listAllCards().length };
  });

  step("libraryFile", () => {
    const f = path.join(R.dirEffective || DIR, "library.db");
    const st = fs.statSync(f);
    R.files.libraryDb = { bytes: st.size, sha: sha(fs.readFileSync(f)) };
    return { bytes: st.size };
  });

  step("assets", () => {
    const imp = db.createImportedDoc({
      title: `F39 ${LABEL} 导入书`,
      markdown: ["# 导入章", "", "带内嵌图的正文。"].join(NL),
      sourceType: "markdown",
      sourceName: "源文件.md",
      originalName: "原文件.md",
      originalBuf: Buffer.from(`# 原文件字节 ${LABEL}`.repeat(8), "utf8"),
      images: [{ filename: "img-1.png", bytes: PNG }],
    });
    R.ids.importedId = imp.id;
    const imgs = db.readContentImages(imp.id);
    R.files.assetShas = imgs.map((i) => sha(Buffer.from(i.bytes)));
    return { images: imgs.length };
  });

  const bk = path.join(ROOT, "electron", "backup.js");
  let backupFile = null;
  await astep("createBackup", async () => {
    const b = require(bk);
    const r = await b.createBackup({ dataDir: DIR, flush: () => db.persistNow(), label: "manual", appVersion: "f39" });
    backupFile = r && r.file;
    R.steps.createBackup.file = backupFile ? path.basename(String(backupFile)) : null;
    if (!r || !r.ok) throw new Error("备份失败：" + String((r && r.error) || "无返回"));
    return { bytes: backupFile ? fs.statSync(backupFile).size : 0 };
  });
  step("listBackups", () => {
    const b = require(bk);
    const l = b.listBackups({ dataDir: DIR });
    return { total: (l && l.backups ? l.backups.length : -1) };
  });

  step("postBackupWrite", () => {
    const c = db.createCard({
      noteText: `F39-${LABEL}-POST`,
      cardType: "qa",
      frontMarkdown: "恢复后应当消失这一张",
      backMarkdown: "x",
      priority: 50,
      tags: [],
      documentId: R.ids.documentId,
    });
    R.ids.postCardId = c.id;
    db.persistNow();
    return { cards: db.listAllCards().length };
  });

  await astep("restoreBackup", async () => {
    if (!backupFile) throw new Error("没有可恢复的备份文件");
    const b = require(bk);
    const r = await b.restoreBackup(backupFile, { dataDir: DIR, flush: () => db.persistNow(), skipSafety: true, appVersion: "f39" });
    R.steps.restoreBackup.restoreOk = !!(r && r.ok);
    R.steps.restoreBackup.error = r && r.error;
    if (!r || !r.ok) throw new Error("恢复失败：" + String((r && r.error) || "无返回"));
    const st = path.join(DIR, "restore-staging");
    return { staged: fs.existsSync(st) ? fs.readdirSync(st) : [] };
  });

  step("applyPendingRestore", () => {
    const b = require(bk);
    const a = b.applyPendingRestore({ dataDir: DIR });
    R.steps.applyPendingRestore.applied = a;
    if (!a || a.ok !== true) throw new Error("换入未生效：" + JSON.stringify(a));
    return { restored: a.restored };
  });

  await astep("reopen", async () => {
    delete require.cache[dbPath];
    const db2 = require(dbPath);
    await db2.initDb();
    R.postRestore = {
      cards: db2.listAllCards().map((c) => c.noteText),
      items: db2.listItems().length,
      journal: db2.listJournalEntries({ limit: 50 }).total,
      images: (() => { try { return db2.readContentImages(R.ids.importedId).length; } catch (e) { return "ERR " + e.message; } })(),
      imageShas: (() => { try { return db2.readContentImages(R.ids.importedId).map((i) => sha(Buffer.from(i.bytes))); } catch { return null; } })(),
    };
    return {};
  });

  step("tree", () => {
    R.tree = relTree(DIR);
    R.steps.tree.leftovers = R.tree.filter((f) => /\.(tmp|part|pre-restore)$/.test(f) || f === "restore-staging/" || f === "restore-pending.json");
    return { n: R.tree.length };
  });

  flush();
  try { app.exit(0); } catch { process.exit(0); }
})();
