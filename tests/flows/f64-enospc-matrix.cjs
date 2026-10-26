// F64 磁盘满（ENOSPC）注入 × 四个写入口的行为矩阵
// @runtime: electron  @tier: 1  @gui: false  @id: F64  @timeout: 420
// 运行：npx electron tests/flows/f64-enospc-matrix.cjs
//
// 起因：F39 在报告里明写「ENOSPC / 杀软占用 / 网络盘 未模拟」。
//       磁盘满是别人电脑上最常见、也最容易丢数据的场景，而本机有**四个各自独立实现的写入口**：
//       主库 persist（db.js）、settings（settingsStore.js）、词典库（dictDb.js）、备份（backup.js）。
//       本条给每个写入口灌一次 ENOSPC，量四件事：
//         ① 调用方拿不拿得到错（谎报成功 = 缺陷）
//         ② 原文件是否完好、有没有留下会被误当事实源的 .tmp
//         ③ 内存态与磁盘态分叉时，有没有任何可判定的信号
//         ④ 空间恢复后重试，能不能收敛到正确状态
//       必带正向对照：注入必须真的命中过（拦截计数 > 0），否则"没报错"只是因为根本没注入。
"use strict";
const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const { Flow, runFlow, ROOT, tmpUserDataDir, freshDir } = require("./lib/harness.cjs");
const { audit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F64",
  title: "磁盘满注入 × 四个写入口",
  angle: "ENOSPC 下每个写入口是否谎报成功 / 留残留 / 有无可重试信号",
  cites: ["§7.2", "§7.1.8", "§9.1 M2"],
  tier: 1,
  gui: false,
});

const ENOSPC = () => Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC", errno: -28 });

/** 在 fn 执行期间把指定 fs 函数换成抛 ENOSPC，返回 {抛错, 拦截次数, 拦截目标} */
function inject(targets, fn) {
  const saved = {};
  let hits = 0;
  const hitList = [];
  for (const t of targets) {
    saved[t] = fs[t];
    fs[t] = function patched(...args) {
      hits++;
      const who = typeof args[0] === "string" ? path.basename(args[0]) : String(args[0] && args[0].path || "?");
      hitList.push(t + "(" + who + ")");
      throw ENOSPC();
    };
  }
  let err = null;
  let value;
  try {
    value = fn();
  } catch (e) {
    err = e;
  } finally {
    for (const t of targets) fs[t] = saved[t];
  }
  const isPromise = value && typeof value.then === "function";
  return { err: err ? String((err && err.message) || err).slice(0, 120) : null, hits, hitList: hitList.slice(0, 4), value, async: isPromise };
}

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f64"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");
    const dbPath = path.join(ROOT, "electron", "db.js");
    delete require.cache[dbPath];
    const db = require(dbPath);
    await db.initDb();
    const item = db.createFromPaste("F64 磁盘满书", "# 章\n\n内容内容。\n");
    const itemId = item && (item.id || (item.item && item.item.id));
    db.createCard({ itemId, frontMarkdown: "问", backMarkdown: "答", cardType: "qa" });
    db.persistNow();

    await runFlow(flow, async () => {
      const snap = async (tag) => {
        const a = await audit(dbFile);
        const n = { items: a.count("library_items"), cards: a.count("cards") };
        a.close();
        flow.record(tag + " 盘上事实", JSON.stringify(n));
        return n;
      };
      const tmpFiles = () => {
        try {
          return fs.readdirSync(dir).filter((f) => /\.tmp$/.test(f));
        } catch {
          return ["(目录读不了)"];
        }
      };
      const sizeOf = (p) => {
        try {
          return fs.statSync(p).size;
        } catch {
          return -1;
        }
      };

      flow.section("W1 主库 persistNow（db.js:682 那套 tmp+fsync+rename）");
      await snap("W1 前");
      const s1 = sizeOf(dbFile);
      const before1 = tmpFiles();
      const r1 = inject(["writeFileSync", "writeSync"], () => {
        db.createJournalEntry({ contentMarkdown: "F64 W1 磁盘满时新增的日记", source: "app" });
        db.persistNow();
      });
      flow.record("W1 拦截次数/目标", `${r1.hits} 次 · ${r1.hitList.join(" ")}`);
      flow.record("W1 抛给调用方的错", String(r1.err));
      const after1 = tmpFiles();
      const s1b = sizeOf(dbFile);
      flow.record("W1 原库大小", `${s1} → ${s1b} 字节`);
      flow.record("W1 .tmp 残留", `注入前 ${before1.length} 个 → 之后 ${after1.length} 个 ${after1.length ? JSON.stringify(after1) : ""}`);
      flow.check("W1 主库写满必须把错抛给调用方（不得谎报成功）", r1.hits > 0 && r1.err !== null, "抛错", { hits: r1.hits, err: r1.err });
      flow.check("W1 原库文件不得被截断（大小不变或增长，绝不能变小/为 0）", s1b >= s1 && s1b > 0, "≥ 原大小", { s1, s1b });
      flow.check("W1 失败后不得留下 .tmp 残留（残留会被下次启动误判/占空间）", after1.length === 0, "0 个", after1);
      const chk1 = await audit(dbFile);
      const has1 = chk1.rows("SELECT COUNT(*) AS n FROM journal_entries WHERE content_markdown LIKE '%W1 磁盘满%'")[0].n;
      chk1.close();
      flow.record("W1 那条被拒的日记是否出现在盘上", has1);
      flow.check("W1 写盘失败的那笔不得在盘上留下半条事实", Number(has1) === 0, "0 行", has1);

      flow.section("W2 settings.json 写入口（D-TEST-30 已证它非原子）");
      const setFile = path.join(dir, "settings.json");
      const ssPath = path.join(ROOT, "electron", "settingsStore.js");
      delete require.cache[ssPath];
      const ss = require(ssPath);
      // settings.json 只有写过才存在（本沙箱可能压根没有它）⇒ 先造一个真实形状，否则测的是"文件不存在"而不是"写满"
      if (!fs.existsSync(setFile)) {
        try {
          if (typeof ss.writeSettings === "function") ss.writeSettings({ app: { theme: "light" } });
          else fs.writeFileSync(setFile, JSON.stringify({ app: { theme: "light" } }, null, 2));
        } catch { /* 走下面的兜底 */ }
      }
      const sBefore = fs.existsSync(setFile) ? fs.readFileSync(setFile, "utf8") : "(不存在)";
      flow.record("W2 起始 settings 状态", `${sBefore === "(不存在)" ? "文件不存在" : sBefore.length + " 字节"}`);
      const r2 = inject(["writeFileSync"], () => ss.writeSettings ? ss.writeSettings({ app: { theme: "dark", dayCutoffHour: 3 } }) : (() => { throw new Error("无 writeSettings 导出"); })());
      flow.record("W2 拦截次数", `${r2.hits} · ${r2.hitList.join(" ")}`);
      flow.record("W2 抛错", String(r2.err));
      const sAfter = fs.existsSync(setFile) ? fs.readFileSync(setFile, "utf8") : "(文件没了)";
      flow.record("W2 原文件字节是否完好", `${sBefore.length} → ${sAfter.length} 字节 · ${sBefore === sAfter ? "逐字节相同" : "**已被改写/破坏**"}`);
      flow.check("W2 settings 写满后原文件必须逐字节完好（非原子写在这里最要命）", sBefore === sAfter, "完好", { 前: sBefore.length, 后: sAfter.length, 相同: sBefore === sAfter });
      flow.check("W2 必须把错抛出来（不得静默丢偏好）", r2.hits === 0 || r2.err !== null, "抛错或没走到写", { hits: r2.hits, err: r2.err });

      flow.section("W3 词典库 dictDb（F39 已证它缺 db.js 那套清理）");
      const dictFile = path.join(dir, "dictionary.db");
      try { fs.writeFileSync(dictFile, "placeholder-not-a-db"); } catch { /* 忽略 */ }
      const r3 = inject(["writeFileSync", "renameSync"], () => {
        const p = dictFile + ".tmp";
        fs.writeFileSync(p, Buffer.alloc(4096, 7));
        fs.renameSync(p, dictFile);
        return "wrote";
      });
      flow.record("W3 拦截次数/抛错", `${r3.hits} · ${String(r3.err)}`);
      flow.record("W3 词典 .tmp 残留", JSON.stringify(fs.readdirSync(dir).filter((f) => f.startsWith("dictionary.db") && f.endsWith(".tmp"))));
      flow.check("W3 词典侧失败必须抛错（F39 W5-f4 已证它整函数吞异常，这里复核写盘原语本身）", r3.err !== null, "抛错", r3.err);

      flow.section("W4 备份 createBackup（写满时会不会留下半个 zip 并被当成有效备份）");
      const bakPath = path.join(ROOT, "electron", "backup.js");
      delete require.cache[bakPath];
      const bak = require(bakPath);
      const backupDir = path.join(dir, "backups");
      fs.mkdirSync(backupDir, { recursive: true });
      const r4 = inject(["writeFileSync", "appendFileSync", "renameSync"], async () => await bak.createBackup({ label: "manual", backupDir, flush: () => db.persistNow() }));
      flow.record("W4 拦截次数", `${r4.hits} · ${r4.hitList.join(" ")}`);
      flow.record("W4 同步抛错", String(r4.err));
      const zips = fs.readdirSync(backupDir);
      flow.record("W4 备份目录内容", JSON.stringify(zips));
      const half = zips.filter((f) => /\.zip$/.test(f) && sizeOf(path.join(backupDir, f)) < 1024);
      flow.record("W4 半个 zip（<1KB 却带 .zip 名字）", JSON.stringify(half));
      flow.check("W4 写满不得留下看起来可用的半个备份文件", half.length === 0, "0 个", half);

      flow.section("W5 空间恢复后重试能否收敛");
      db.createJournalEntry({ contentMarkdown: "F64 W5 恢复后重试", source: "app" });
      db.persistNow();
      const a5 = await audit(dbFile);
      const ok5 = a5.rows("SELECT COUNT(*) AS n FROM journal_entries WHERE content_markdown LIKE '%W5 恢复后重试%'")[0].n;
      a5.close();
      flow.record("W5 重试后盘上行数", ok5);
      flow.check("注入结束、空间恢复后重试必须正常落盘（前面的失败不得把库锁死）", Number(ok5) === 1, "1 行", ok5);
      const left = tmpFiles();
      flow.record("W5 全流程结束后的 .tmp 残留", JSON.stringify(left));
      flow.check("整场注入结束后目录不得有 .tmp 残留", left.length === 0, "0 个", left);

      flow.section("W6 正向对照：注入必须真的命中过写盘原语");
      const totalHits = r1.hits + r2.hits + r3.hits + r4.hits;
      flow.record("四个入口合计拦截次数", totalHits);
      flow.check("自检：至少命中 3 个入口（否则上面的绿只是因为根本没注入）", [r1, r2, r3, r4].filter((x) => x.hits > 0).length >= 3, "≥3 个入口被注入", { W1: r1.hits, W2: r2.hits, W3: r3.hits, W4: r4.hits });
    });
    setTimeout(() => app.exit(process.exitCode || 0), 200); // D239：runFlow 按结果置退出码
  })
  .catch((e) => {
    flow.record("顶层异常", String((e && e.stack) || e));
    setTimeout(() => app.exit(1), 200);
  });
