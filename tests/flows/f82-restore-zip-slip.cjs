// F82 还原路径的路径穿越（zip-slip）与库外文件的换入纪律
// @runtime: node  @tier: 1  @gui: false  @id: F82  @timeout: 480
// 运行：node tests/flows/f82-restore-zip-slip.cjs
//
// 承接 F81：那一条只破坏了 restore-staging/library.db 一个文件，就打出高危毁库（D-TEST-85）。
// 本条把刀换到**包里的其它条目**上，问两个问题：
//   ① 备份包里的条目名带 `../` 时，解包会不会写到数据目录之外？（zip-slip，
//      配合 D-TEST-26 的任意文件读，是一条完整的"备份文件即攻击载荷"链路）
//   ② settings.json / dictionary.db / memory/** 这三类库外文件的换入，
//      是否也有"损坏/缺失/类型不符"时的处置纪律？
// 三个子进程各跑一次 initDb（同进程二次 initDb 会死锁，F71 踩过）。
"use strict";
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const { Flow, runFlow, ROOT, RESULTS_DIR, tmpUserDataDir, freshDir } = require("./lib/harness.cjs");
const { ELECTRON } = require("./lib/guienv.cjs");

const flow = new Flow({
  id: "F82",
  title: "还原路径 zip-slip 与库外文件纪律",
  angle: "备份包条目名带 ../ 会不会写到目录外；settings/dictionary/memory 换入时的损坏处置",
  cites: ["§7.2", "§7.1.8", "§7.5", "D-TEST-26", "D-TEST-85"],
  tier: 1,
  gui: false,
});
const P = { prep: "F82PREP ", stage: "F82STAGE ", apply: "F82APPLY " };
const EVIL = "F82-ZIPSLIP-PROBE";
const ZIPS = {
  Z1: { 名: "条目名带 ../ 的相对穿越", entries: { "../f82-evil-parent.txt": EVIL, "./f82-evil-dot.txt": EVIL } },
  Z2: { 名: "藏在 memory/ 里的 ../../ 穿越", entries: { "memory/../../f82-evil-via-memory.txt": EVIL, "memory/../core.md": "# 被包里的路径覆盖\n" } },
  Z3: { 名: "反斜杠与绝对路径风格条目", entries: { "..\\f82-evil-backslash.txt": EVIL, "C:/f82-evil-absolute.txt": EVIL } },
  Z4: { 名: "库外文件类型不符（settings.json 装二进制、dictionary.db 装 JSON）", bad: true, entries: {} },
};

if (process.env.F82_MODE) {
  const { app } = require("electron");
  const mode = process.env.F82_MODE;
  app.whenReady().then(async () => {
    const dst = tmpUserDataDir("f82dst");
    app.setPath("userData", dst);
    const db = require(path.join(ROOT, "electron", "db.js"));
    const bk = require(path.join(ROOT, "electron", "backup.js"));
    const JSZip = require(path.join(ROOT, "node_modules", "jszip"));
    const out = { dir: dst, res: null, err: null, zip: null, entries: [] };

    if (mode === "prep") {
      const src = freshDir(tmpUserDataDir("f82src"));
      app.setPath("userData", src);
      await db.initDb();
      const it = db.createFromPaste("F82 材料", "# 章\n\n内容。\n");
      const itemId = it && (it.id || (it.item && it.item.id));
      for (let j = 0; j < 4; j++) db.createCard({ itemId, frontMarkdown: `F82 问 ${j}`, backMarkdown: `F82 答 ${j}`, cardType: "qa" });
      db.persistNow();
      out.res = { dbFile: path.join(src, "library.db") };
      console.log(P.prep + JSON.stringify(out));
      app.exit(0);
      return;
    }

    if (mode === "stage") {
      freshDir(dst);
      await db.initDb();
      fs.mkdirSync(path.join(dst, "memory"), { recursive: true });
      fs.writeFileSync(path.join(dst, "memory", "core.md"), "# 本地记忆\n本地内容，不许被 ../ 条目改写\n", "utf-8");
      fs.writeFileSync(path.join(dst, "settings.json"), JSON.stringify({ f82probe: "本地设置" }), "utf-8");
      db.persistNow();
      const spec = ZIPS[process.env.F82_CASE] || ZIPS.Z1;
      const zip = new JSZip();
      zip.file("library.db", fs.readFileSync(process.env.F82_DB));
      zip.file("backup-meta.json", JSON.stringify({ app: "incremental-reading-dev", format: 1, label: "manual", createdAt: Date.now(), includesAIConfig: false }));
      for (const [n, body] of Object.entries(spec.entries)) zip.file(n, body);
      if (spec.bad) {
        zip.file("settings.json", Buffer.alloc(4096, 0xff));
        zip.file("dictionary.db", Buffer.from('{"not":"a sqlite file"}'));
        zip.file("memory", "这是一个本该是目录的名字却是文件");
      }
      const zp = path.join(RESULTS_DIR, `f82-${process.env.F82_CASE}.zip`);
      const buf = await zip.generateAsync({ type: "nodebuffer" });
      fs.writeFileSync(zp, buf);
      out.zip = zp;
      const r = await bk.restoreBackup(zp, { dataDir: dst, backupDir: RESULTS_DIR, now: new Date() });
      out.res = r === undefined ? "undefined" : { ok: r.ok, needsRestart: r.needsRestart, error: r.error };
      console.log(P.stage + JSON.stringify(out));
      app.exit(0);
      return;
    }

    if (mode === "apply") {
      let applied = null;
      try { applied = bk.applyPendingRestore(); } catch (e) { out.err = "apply 抛错:" + String(e.message).slice(0, 140); }
      out.res = applied === undefined ? "undefined" : applied;
      try { await db.initDb(); } catch (e) { out.err = (out.err || "") + " initDb:" + String(e.message).slice(0, 140); }
      try {
        out.settings = fs.readFileSync(path.join(dst, "settings.json"), "utf-8").slice(0, 80);
      } catch (e) { out.settings = "读不到:" + e.message.slice(0, 50); }
      try { out.memoryCore = fs.readFileSync(path.join(dst, "memory", "core.md"), "utf-8").slice(0, 60); } catch { out.memoryCore = "无"; }
      try { out.dictHead = fs.readFileSync(path.join(dst, "dictionary.db")).slice(0, 16).toString("hex"); } catch { out.dictHead = "无"; }
      console.log(P.apply + JSON.stringify(out));
      app.exit(0);
      return;
    }
  }).catch((e) => { console.log(P[process.env.F82_MODE] + JSON.stringify({ err: "outer " + String(e.message).slice(0, 200) })); app.exit(1); });
  return;
}

function child(mode, env) {
  const r = spawnSync(ELECTRON, [path.join(__dirname, "f82-restore-zip-slip.cjs")], {
    cwd: ROOT, env: { ...process.env, F82_MODE: mode, ...env }, encoding: "utf-8", timeout: 200000,
  });
  const pre = P[mode];
  const line = String(r.stdout || "").split(/\r?\n/).filter((l) => l.startsWith(pre)).pop();
  if (!line) return { err: `无输出 status=${r.status} stderr=${String(r.stderr || "").slice(-200)}` };
  try { return JSON.parse(line.slice(pre.length)); } catch (e) { return { err: "解析失败 " + e.message }; }
}

const parentOf = (d) => path.dirname(d);

runFlow(flow, async () => {
  const prep = child("prep", {});
  const dbFile = prep.res && prep.res.dbFile;
  if (!dbFile || !fs.existsSync(dbFile)) { flow.check("必须先备出一个可用的 library.db", false, "存在", JSON.stringify(prep).slice(0, 200)); return; }
  const dst = tmpUserDataDir("f82dst");
  const outside = [
    path.join(parentOf(dst), "f82-evil-parent.txt"),
    path.join(parentOf(dst), "f82-evil-dot.txt"),
    path.join(parentOf(dst), "f82-evil-via-memory.txt"),
    path.join(parentOf(dst), "f82-evil-backslash.txt"),
    path.join(parentOf(dst), "f82-evil-absolute.txt"),
    path.resolve(dst, "..", "f82-evil-backslash.txt"),
  ];
  flow.record("沙箱目录", dst);
  flow.record("越界探测点", outside.map((p) => path.basename(p)).join(" · "));

  for (const [k, spec] of Object.entries(ZIPS)) {
    flow.section(`${k} · ${spec.名}`);
    for (const p of outside) { try { fs.rmSync(p, { force: true }); } catch { /* 清不掉就带着测 */ } }
    const st = child("stage", { F82_CASE: k, F82_DB: dbFile });
    if (st.err) { flow.check(`${k} 造包/还原阶段不得抛错`, false, "不抛", st.err); continue; }
    flow.record("restoreBackup 返回", JSON.stringify(st.res).slice(0, 200));
    const ap = child("apply", { F82_CASE: k });
    flow.record("applyPendingRestore", JSON.stringify(ap.res || ap.err).slice(0, 200));
    flow.record("库外文件换入后", `settings=${JSON.stringify(ap.settings)} memory/core.md=${JSON.stringify(ap.memoryCore)} dictionary 头 16 字节=${ap.dictHead}`);
    if (ap.err) flow.record("重启侧错误", String(ap.err).slice(0, 160));

    const landed = outside.filter((p) => fs.existsSync(p));
    flow.check(`${k} 包内条目名不得把文件写到数据目录之外（zip-slip）`, landed.length === 0, "0 个越界文件", landed.join("、") || "无");
    const insideEvil = (() => {
      try { return fs.readdirSync(dst).filter((f) => /evil/i.test(f)); } catch { return []; }
    })();
    flow.record("目录内是否留下同名探针", insideEvil.join("、") || "无");
    if (spec.bad) {
      const settingsOk = typeof ap.settings === "string" && ap.settings.indexOf("f82probe") >= 0;
      const memOk = typeof ap.memoryCore === "string" && ap.memoryCore.indexOf("本地内容") >= 0;
      flow.check(`${k} 内容是二进制的 settings.json 不得覆盖掉可用的本地设置`, settingsOk, "本地设置仍在", JSON.stringify(ap.settings));
      flow.check(`${k} memory 条目类型不符（文件冒充目录）时不得毁掉本地记忆`, memOk, "本地记忆仍在", JSON.stringify(ap.memoryCore));
    }
  }
  flow.record("未覆盖", "① 符号链接/junction 条目（Windows 下需管理员权限创建，未测）；" +
    "② 条目名含 NTFS 非法字符（F40 已在导入侧测过，还原侧未测）；③ 超大条目导致的解压膨胀（zip bomb，F45 在 EPUB 侧测过）");
});
