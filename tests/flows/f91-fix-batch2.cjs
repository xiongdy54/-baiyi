// F91 三条非 GUI 修复的合并验证（D-TEST-30 settings 原子写与留证 / D-TEST-35 备份按 mtime 滚动 / D-TEST-59·69 月统计排除软删卡）
// @runtime: electron  @tier: 1  @gui: false  @id: F91  @timeout: 300
// 运行：npx electron tests/flows/f91-fix-batch2.cjs
//
// 每条都带**正向对照**：只证"坏情况不再发生"是不够的，还得证明"好情况仍然正常工作"——
// 否则一个把功能整体关掉的改动也会全绿。
"use strict";
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { Flow, runFlow, ROOT, tmpUserDataDir, freshDir } = require("./lib/harness.cjs");
const { audit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F91",
  title: "第二批修复验证",
  angle: "settings 原子写与损坏留证 / 备份滚动按 mtime / 月统计排除软删卡",
  cites: ["D-TEST-30", "D-TEST-35", "D-TEST-59", "D-TEST-69", "v48.21/D57"],
  tier: 1,
  gui: false,
});

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f91"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");
    const db = require(path.join(ROOT, "electron", "db.js"));
    await db.initDb();

    await runFlow(flow, async () => {
      /* ── S1：D-TEST-59/69 月统计必须排除软删卡，且正常卡仍要计入 ── */
      flow.section("S1 月统计排除软删卡（D-TEST-59/69）");
      const item = db.createFromPaste("F91 月统计书", "# 章\n\n为月统计而造。\n");
      const itemId = item && (item.id || (item.item && item.item.id));
      const ids = [];
      for (let i = 0; i < 4; i++) {
        const c = db.createCard({ itemId, frontMarkdown: `F91 问 ${i}`, backMarkdown: "答", cardType: "qa" });
        const id = c && (c.id || c.cardId);
        if (id) ids.push(id);
      }
      const next = (due) => ({ state: "review", due, reps: 1, lapses: 0, stability: 5, difficulty: 5, lastReview: Date.now(), learningSteps: 0 });
      let reviewed = 0;
      for (let i = 0; i < 3; i++) {
        try { db.saveReview(ids[i], next(Date.now() + 86400000), 3, 5000, next(Date.now() - 1000)); reviewed++; } catch (e) { flow.record("saveReview 抛错", String(e.message).slice(0, 100)); break; }
      }
      db.persistNow();
      const before = db.getStatsOverview().queueFlow?.completed;
      flow.record("复习了", `${reviewed} 张 · queueFlow.completed=${before}`);
      flow.check("对照：未删除时月完成数应等于已复习张数（否则后面的判定不可信）", before === reviewed, String(reviewed), String(before));

      db.execRawSql("UPDATE cards SET is_deleted = 1 WHERE id = ?", [ids[0]]);
      db.persistNow();
      const after = db.getStatsOverview().queueFlow?.completed;
      flow.record("软删其中 1 张后", `queueFlow.completed=${after}`);
      flow.check("删掉的卡不得再计入月完成数（D-TEST-59/69）", after === reviewed - 1, String(reviewed - 1), String(after));
      flow.check("对照：其余已复习的卡必须仍被计入（不是把功能整体清零）", after >= 1, "≥1", String(after));

      /* ── S2：D-TEST-30 settings 原子写 + 损坏留证 ── */
      flow.section("S2 settings 原子写与损坏留证（D-TEST-30）");
      const ss = require(path.join(ROOT, "electron", "settingsStore.js"));
      const sf = path.join(dir, "settings.json");
      ss.writeSettings({ app: { a: 1, b: "保留我" }, theme: { mode: "dark" } });
      const rt = ss.readSettings();
      flow.record("往返", JSON.stringify(rt).slice(0, 120));
      flow.check("写入后必须能原样读回", rt?.app?.b === "保留我" && rt?.app?.a === 1, "app.b=保留我", JSON.stringify(rt.app));
      flow.check("写入不得留下 .tmp 残留（原子 rename 必须走完）", !fs.existsSync(sf + ".tmp"), "无 .tmp", fs.existsSync(sf + ".tmp") ? "有残留" : "无");

      fs.writeFileSync(sf, "{ 这不是合法 JSON", "utf-8");
      const onCorrupt = ss.readSettings();
      const kept = fs.existsSync(sf + ".corrupt");
      const keptBody = kept ? fs.readFileSync(sf + ".corrupt", "utf-8") : "";
      flow.record("损坏后", `readSettings=${JSON.stringify(onCorrupt)} · .corrupt 存在=${kept} · 内容前 20 字=${JSON.stringify(keptBody.slice(0, 20))}`);
      flow.check("损坏文件必须被留证为 settings.json.corrupt（原来是被静默覆盖）", kept && keptBody.indexOf("这不是合法 JSON") >= 0, "留证且内容一致", kept ? "已留证" : "未留证");
      flow.check("损坏时读取仍须兜底为空对象（不许抛错打断启动）", onCorrupt && typeof onCorrupt === "object", "对象", typeof onCorrupt);
      ss.writeSettings({ app: { b: "新值" } });
      const afterCorrupt = ss.readSettings();
      flow.check("留证之后再写入必须正常（留证不能把写入路径弄坏）", afterCorrupt?.app?.b === "新值", "app.b=新值", JSON.stringify(afterCorrupt.app));
      flow.check("留证文件在后续写入后仍应存在（不许被顺带清掉）", fs.existsSync(sf + ".corrupt"), "仍在", fs.existsSync(sf + ".corrupt") ? "仍在" : "被清");

      /* ── S3：D-TEST-35 备份滚动按 mtime，不按文件名 ── */
      flow.section("S3 备份滚动按文件 mtime（D-TEST-35）");
      const bk = require(path.join(ROOT, "electron", "backup.js"));
      if (typeof bk.rotateAutoBackups !== "function") {
        flow.check("rotateAutoBackups 必须是可测的导出", false, "是函数", typeof bk.rotateAutoBackups);
      } else {
        // 逆向构造：文件名日期与真实写入时间**反着来**（= 系统时钟被回拨后的现场）
        const rollDir = path.join(dir, "rollback-backups");
        fs.rmSync(rollDir, { recursive: true, force: true });
        fs.mkdirSync(rollDir, { recursive: true });
        const names = ["backup-auto-2026-09-20.zip", "backup-auto-2026-09-21.zip", "backup-auto-2026-09-22.zip", "backup-auto-2026-09-23.zip"];
        const base = Date.now() - 4 * 3600 * 1000;
        names.forEach((n, i) => {
          const f = path.join(rollDir, n);
          fs.writeFileSync(f, "ZIP" + i, "utf-8");
          const t = new Date(base + (names.length - 1 - i) * 3600 * 1000); // 名字越小 → 写得越晚（mtime 越新）
          fs.utimesSync(f, t, t);
        });
        const mtimesBefore = names.map((n) => ({ n, m: fs.statSync(path.join(rollDir, n)).mtimeMs })).sort((a, b) => b.m - a.m);
        flow.record("构造现场（按 mtime 从新到旧）", mtimesBefore.map((x) => x.n.replace("backup-auto-", "").replace(".zip", "")).join(" > "));
        bk.rotateAutoBackups(rollDir, 2);
        const left = fs.readdirSync(rollDir).filter((f) => /^backup-auto-/.test(f)).sort();
        const newestName = mtimesBefore[0].n;
        flow.record("keep=2 之后剩下", `${left.join(" · ")} · 最新 mtime 的那份=${newestName}`);
        flow.check("时钟回拨现场下，最新写入的那份备份必须被保住（老逻辑按名字会把它当最旧删掉）", left.includes(newestName), `含 ${newestName}`, left.join(",") || "空");
        flow.check("留下的必须正是 mtime 最新的两份", left.length === 2 && left.every((f) => [mtimesBefore[0].n, mtimesBefore[1].n].includes(f)), "mtime 最新两份", left.join(","));

        // 正向对照：名字与 mtime 一致（正常时钟）时，滚动行为必须与直觉一致
        const normDir = path.join(dir, "normal-backups");
        fs.rmSync(normDir, { recursive: true, force: true });
        fs.mkdirSync(normDir, { recursive: true });
        const n2 = ["backup-auto-2026-09-20.zip", "backup-auto-2026-09-21.zip", "backup-auto-2026-09-22.zip"];
        n2.forEach((n, i) => {
          const f = path.join(normDir, n);
          fs.writeFileSync(f, "Z" + i, "utf-8");
          const t = new Date(base + i * 3600 * 1000);
          fs.utimesSync(f, t, t);
        });
        bk.rotateAutoBackups(normDir, 2);
        const left2 = fs.readdirSync(normDir).filter((f) => /^backup-auto-/.test(f)).sort();
        flow.record("正常时钟下 keep=2 之后剩下", left2.join(" · "));
        flow.check("对照：正常时钟下应删掉最旧、留下最新两份（固定 mtime 排序不得把正常情形改坏）", left2.length === 2 && left2.includes("backup-auto-2026-09-22.zip") && left2.includes("backup-auto-2026-09-21.zip"), "留下 09-22 与 09-21", left2.join(","));
      }
      flow.record("未覆盖", "settings 写入中途断电（需故障注入，本条只验了原子 rename 的产物形态）；月统计的另外 7 处 is_deleted 漏点（D-TEST-59 提到但本条只覆盖 queueFlow 的 completed/skipped 两处）");
    });
  })
  .catch((e) => {
    flow.check("流程未崩溃", false, "不抛", String((e && e.stack) || e).slice(0, 400));
    process.exitCode = 1;
  })
  // C-45：Electron 主进程不会自行退出；延迟 200 ms，让结果文件与日志先写完
  .finally(() => setTimeout(() => app.exit(process.exitCode || 0), 200));
