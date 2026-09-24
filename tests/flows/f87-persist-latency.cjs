// F87 落盘延迟窗口（去抖多久才真写盘 = 崩溃最多能丢多长时间的改动）
// @runtime: electron  @tier: 1  @gui: false  @id: F87  @timeout: 300
// 运行：npx electron tests/flows/f87-persist-latency.cjs
//
// 起因：F86 想量"每条卡都整库重写"的代价，结果 await persistNow() 只测到 0.06ms，
// 而库文件确实在长（528KB→946KB）。⇒ 落盘不是调用即写，而是被推迟/合并了。
// 这本身就是一个更值得量的事实：**从"数据在内存里改了"到"盘上真的有了"之间有多长**？
// 这段时间就是崩溃可丢数据的最大窗口（F70 的崩溃扫描是按固定 sleep 估的，没量过这个窗口）。
// 量法：改一次数据 → 记下 mtimeMs → 每 10ms 轮询 mtime，直到它变化，记录延迟；跑 12 次取分布。
// 对照组：改完之后显式调 persistNow()（以及 journal 去抖相关的 flush 入口，若存在）再量同样的延迟。
"use strict";
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { Flow, runFlow, ROOT, tmpUserDataDir, freshDir } = require("./lib/harness.cjs");

const flow = new Flow({
  id: "F87",
  title: "落盘延迟窗口",
  angle: "内存改动到盘上可见之间的时间窗（= 崩溃丢数据窗口），以及显式 flush 能否关掉它",
  cites: ["§7.1.8", "§7.2", "D-TEST-48", "D-TEST-70", "D34"],
  tier: 1,
  gui: false,
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return -1; } };
const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f87"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");
    const db = require(path.join(ROOT, "electron", "db.js"));
    await db.initDb();

    await runFlow(flow, async () => {
      const item = db.createFromPaste("F87 落盘窗口书", "# 章\n\n为量窗口而造。\n");
      const itemId = item && (item.id || (item.item && item.item.id));
      db.persistNow();
      await sleep(400);
      flow.record("导出函数里的 flush 入口", Object.keys(db).filter((k) => /persist|flush|save|sync/i.test(k)).join(" · ") || "无");

      // 单次测量：基线必须在**改动之前**取。第一版在 createCard + await persistNow 之后才取基线，
      // 那次写盘已经落下去了，于是后面 4 秒当然看不到变化 —— 24 次"未写"全是这个顺序错误造出来的，
      // 不是产品不写盘（S0 的 none 对照组证明：不调任何 flush 入口，mtime 也在 100ms 内变了）。
      const measure = async (forceFlush) => {
        const base = mtime(dbFile);
        const t0 = Date.now();
        db.createCard({ itemId, frontMarkdown: `F87 问 ${t0}`, backMarkdown: "答", cardType: "qa" });
        if (forceFlush) { try { await db.persistNow(); } catch { /* 忽略 */ } }
        for (let i = 0; i < 400; i++) {
          await sleep(10);
          if (mtime(dbFile) !== base) return { lag: Date.now() - t0, flushed: true };
        }
        return { lag: -1, flushed: false };
      };

      flow.section("S0 单点探针：分别调 persistNow / persistDb / flushJournalPersist，各等 20 秒看 mtime 与 size 谁动");
      // 这一步是为了分辨三件事：① 到底哪个入口真正写盘；② 是不是有比 4s 更长的批量刷盘周期；
      // ③ 会不会写到了别的文件（那 library.db 的 mtime 永远不动）。
      const probes = ["persistNow", "persistDb", "flushJournalPersist", "none"];
      for (const name of probes) {
        const m0 = mtime(dbFile);
        const s0 = (() => { try { return fs.statSync(dbFile).size; } catch { return -1; } })();
        db.createCard({ itemId, frontMarkdown: `F87 探针 ${name} ${Date.now()}`, backMarkdown: "答", cardType: "qa" });
        if (name !== "none") { try { await db[name](); } catch (e) { flow.record(`${name} 调用抛错`, String(e.message).slice(0, 90)); } }
        let changedAt = -1;
        let sizeChangedAt = -1;
        for (let i = 0; i < 200; i++) {
          await sleep(100);
          if (changedAt < 0 && mtime(dbFile) !== m0) changedAt = (i + 1) * 100;
          if (sizeChangedAt < 0) { try { if (fs.statSync(dbFile).size !== s0) sizeChangedAt = (i + 1) * 100; } catch { /* 忽略 */ } }
          if (changedAt >= 0 && sizeChangedAt >= 0) break;
        }
        flow.record(`入口=${name}`, `mtime 变化于 ${changedAt >= 0 ? changedAt + "ms" : "20s 内未变"} · size 变化于 ${sizeChangedAt >= 0 ? sizeChangedAt + "ms" : "20s 内未变"} · 目录里其他文件：${fs.readdirSync(dir).filter((f) => /\.db|journal|wal/i.test(f)).join(",")}`);
      }
      const anyWrite = probes.length > 0;
      flow.record("S0 判读", anyWrite ? "见上表逐行：哪个入口让 mtime/size 动了，落盘责任就在它身上" : "无探针");

      flow.section("S1 自然状态（不显式 flush）：改动到盘上可见的延迟分布");
      const natural = [];
      for (let i = 0; i < 12; i++) natural.push(await measure(false));
      const nOk = natural.filter((r) => r.flushed);
      flow.record("12 次读数", natural.map((r) => (r.flushed ? `${r.lag}ms` : "未写")).join(" · "));
      flow.record("中位/最长", nOk.length ? `中位 ${med(nOk.map((r) => r.lag))}ms · 最长 ${Math.max(...nOk.map((r) => r.lag))}ms · 未写次数 ${natural.length - nOk.length}` : "全程没看到落盘");
      flow.check("闸门自证：自然状态下必须至少观察到一次落盘（否则窗口无从谈起）", nOk.length > 0, "≥1 次", `${nOk.length}/12`);

      flow.section("S2 显式 persistNow 之后：窗口能否被关掉");
      const forced = [];
      for (let i = 0; i < 12; i++) forced.push(await measure(true));
      const fOk = forced.filter((r) => r.flushed);
      flow.record("12 次读数", forced.map((r) => (r.flushed ? `${r.lag}ms` : "未写")).join(" · "));
      flow.record("中位/最长", fOk.length ? `中位 ${med(fOk.map((r) => r.lag))}ms · 最长 ${Math.max(...fOk.map((r) => r.lag))}ms · 未写次数 ${forced.length - fOk.length}` : "调用 persistNow 后依然没看到落盘");
      const naturalMed = nOk.length ? med(nOk.map((r) => r.lag)) : -1;
      const forcedMed = fOk.length ? med(fOk.map((r) => r.lag)) : -1;
      flow.record("对照结论", `自然 ${naturalMed}ms vs 显式 flush ${forcedMed}ms ⇒ ` +
        (forcedMed >= 0 && forcedMed <= 60 ? "persistNow 能即时落盘，窗口可控" : forcedMed < 0 ? "**persistNow 调用后仍看不到落盘 ⇒ 它并不强制写盘**（F86 测到 0.06ms 就是这个原因）" : "显式 flush 没有明显缩短窗口"));
      flow.check("显式 persistNow 应当把窗口压到 60ms 以内（否则调用它没有意义）", forcedMed >= 0 && forcedMed <= 60, "≤60ms", `${forcedMed}ms`);

      flow.section("S3 崩溃窗口的直接含义");
      const worst = nOk.length ? Math.max(...nOk.map((r) => r.lag)) : -1;
      flow.record("最大丢数据窗口（自然状态）", `${worst}ms —— 这段时间内的所有改动若进程被杀即丢失`);
      flow.record("与 F70 的关系", "F70 的崩溃扫描用固定 sleep 选点，16 个点 0 损坏；本条给出的是**该选点必须大于这个窗口才有意义**。" +
        (worst > 0 ? `若 F70 的选点间隔小于 ${worst}ms，它其实没有覆盖到"改动尚未落盘"这段。` : "窗口未测出，无法回判 F70 的选点充分性。"));
      flow.record("未覆盖", "① 渲染层写入路径是否另有自己的去抖（F71 只验了 journal 接线）；② 磁盘缓存 flush（fsync）是否发生——本条以 mtime 变化为「已落盘」的近似，未验 fsync；" +
        "③ saveOnQuit 在真正退出时的耗时与失败面（D-TEST-37 只静态读过）");
    });
  })
  .catch((e) => {
    flow.check("流程未崩溃", false, "不抛", String((e && e.stack) || e).slice(0, 400));
    process.exitCode = 1;
  });
