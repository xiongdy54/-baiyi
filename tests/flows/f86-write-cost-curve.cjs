// F86 逐条写入的成本曲线（createCard/createFromPaste 每次刷整库 ⇒ 加卡会不会越加越慢）
// @runtime: electron  @tier: 1  @gui: false  @id: F86  @timeout: 600
// 运行：npx electron tests/flows/f86-write-cost-curve.cjs
//
// 起因：F69 播种 12 000 张卡时发现"走 createCard 一条一条建根本没法用"（它每次调用都 persist 整库），
// 当时为了跑完改用 execRawSql 批量插。那个绕法本身就是一条待量的线索：
// **用户真实使用的就是 createCard 这条路**，而落盘是"整库文件级原子写"（sql.js 全量导出）。
// 于是问题很具体：库越大，加一张卡越慢吗？慢多少？用户在 12k 卡的库上连加 200 张要等多久？
// 本条量三件事：
//   ① createCard 的单次耗时随库规模的增长曲线（线性 or 超线性）
//   ② 同样的卡数，改走"批量 + 一次 persist"要多久（对照组，用来证明增长来自 persist 而非建卡本身）
//   ③ 每次 persist 实际写出的字节数（放大倍数 = 总写字节 / 最终库大小）
// 纪律：耗时用单调时钟 process.hrtime.bigint，不用 Date.now；每档重复取中位数，避免把 GC 抖当成趋势。
"use strict";
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { Flow, runFlow, ROOT, tmpUserDataDir, freshDir } = require("./lib/harness.cjs");
const { audit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F86",
  title: "逐条写入成本曲线",
  angle: "createCard 每次整库落盘 ⇒ 加卡耗时是否随库规模超线性增长、写放大倍数",
  cites: ["§7.1.8", "§7.2", "§4.16"],
  tier: 1,
  gui: false,
});
const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
const ms = (h) => Number(h / 100000n) / 1000;

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f86"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");
    const db = require(path.join(ROOT, "electron", "db.js"));
    await db.initDb();

    await runFlow(flow, async () => {
      const item = db.createFromPaste("F86 成本曲线书", "# 章\n\n为写放大而造。\n");
      const itemId = item && (item.id || (item.item && item.item.id));
      if (!itemId) { flow.check("必须先有材料", false, "有 itemId", String(item)); return; }
      const dbBytes = () => { try { return fs.statSync(dbFile).size; } catch { return -1; } };

      // 记录每次 createCard 的耗时与调用前后库文件字节数（写放大取证）。
      // 关键修正：persistNow 是 **async**，第一版只测了同步入队部分，得到"单次 0.1ms、
      // 单次 persist 0.1ms"这种物理上不可能的数（946KB 的库不可能 0.1ms 写完）。
      // 现在分两个口径量：enqueue（同步返回）与 settle（await 之后），两者之差就是
      // "这条写到底被推迟了多少"。
      const settle = async () => {
        try { const p = db.persistNow(); if (p && typeof p.then === "function") await p; } catch { /* 落盘失败由别的流程判 */ }
        await new Promise((r) => setImmediate(r));
      };
      const timedCreate = async (tag) => {
        const b0 = dbBytes();
        const t0 = process.hrtime.bigint();
        const c = db.createCard({ itemId, frontMarkdown: `F86 ${tag} 问`, backMarkdown: `F86 ${tag} 答`, cardType: "qa" });
        const tEnq = ms(process.hrtime.bigint() - t0);
        await settle();
        const tAll = ms(process.hrtime.bigint() - t0);
        const b1 = dbBytes();
        return { tEnq, tAll, written: b1 - b0, id: c && (c.id || c.cardId), sizeAfter: b1 };
      };

      flow.section("S0 先测空库时一次 createCard 的基线耗时与写放大");
      const base = [];
      for (let i = 0; i < 20; i++) base.push(await timedCreate("base"));
      const baseMed = med(base.map((r) => r.tAll));
      const baseEnq = med(base.map((r) => r.tEnq));
      const baseWrite = med(base.map((r) => r.written));
      flow.record("基线（库约 20 张）", `同步入队中位 ${baseEnq.toFixed(1)}ms · 等落盘完成后中位 ${baseMed.toFixed(1)}ms · 库文件增量中位 ${baseWrite} 字节 · 当前库 ${dbBytes()} 字节`);
      flow.check("基线：单次 createCard（含落盘）必须在可接受范围内（<150ms）", baseMed < 150, "<150ms", `${baseMed.toFixed(1)}ms`);

      flow.section("S1 逐档加卡，测单次耗时的增长（每档取 25 次中位数）");
      const STEPS = [100, 300, 700, 1500];
      const samples = [];   // 每次 createCard 的读数
      const pts = [];       // 每档汇总
      for (const upto of STEPS) {
        while (samples.length < upto) {
          const r = await timedCreate("grow");
          if (!r.id) break;
          samples.push(r);
        }
        const slice = samples.slice(-25);
        const m = med(slice.map((r) => r.tAll));
        const e = med(slice.map((r) => r.tEnq));
        const w = med(slice.map((r) => Math.abs(r.written)));
        flow.record(`库规模 ≈${upto} 张`, `入队中位 ${e.toFixed(1)}ms · 含落盘 ${m.toFixed(1)}ms · 增量中位 ${w} · 库文件 ${dbBytes()} 字节`);
        pts.push({ upto: samples.length, m, e, w });
      }
      if (pts.length >= 3) {
        const first = pts[0], last = pts[pts.length - 1];
        const sizeRatio = last.upto / first.upto;
        const timeRatio = last.m / Math.max(0.1, first.m);
        flow.record("增长比", `规模 ${first.upto}→${last.upto}（×${sizeRatio.toFixed(1)}）时单次耗时 ${first.m.toFixed(1)}ms→${last.m.toFixed(1)}ms（×${timeRatio.toFixed(1)}）`);
        flow.record("判读", timeRatio > sizeRatio * 0.8 && timeRatio > 2 ? "**超线性**：耗时增长快于规模增长 ⇒ 加卡越加越慢" : timeRatio > 1.5 ? "接近线性：与整库重写的预期一致" : "增长不明显（可能被 persist 固定开销主导）");
        flow.check("单次 createCard 耗时随库规模的增长不得超过线性太多（×规模 的上限取 1.6）", timeRatio <= sizeRatio * 1.6, `≤${(sizeRatio * 1.6).toFixed(1)}×`, `${timeRatio.toFixed(1)}×`);
        // 用户视角外推：在最大档上连加 200 张要多久
        const per = last.m;
        flow.record("外推", `在 ${last.upto} 张的库上连加 200 张 ≈ ${(per * 200 / 1000).toFixed(1)} 秒（按单次中位 ${per.toFixed(1)}ms 计）`);
        flow.check("外推：在最大档库上连加 200 张卡应能在 20 秒内完成", per * 200 / 1000 <= 20, "≤20s", `${(per * 200 / 1000).toFixed(1)}s`);
      } else {
        flow.check("必须取到 ≥3 档读数，否则曲线不成立", false, "≥3 档", pts.length);
      }

      flow.section("S2 对照组：200 张连续建（不逐条等落盘）vs 逐条等落盘");
      const t0 = process.hrtime.bigint();
      for (let i = 0; i < 200; i++) {
        const c = db.createCard({ itemId, frontMarkdown: `F86 对照 ${i}`, backMarkdown: "答", cardType: "qa" });
        void c;
      }
      const noSettle = ms(process.hrtime.bigint() - t0);
      const t1 = process.hrtime.bigint();
      await settle();
      const oneSettle = ms(process.hrtime.bigint() - t1);
      const perCallSum = samples.slice(-200).reduce((s, r) => s + r.tAll, 0);
      flow.record("200 张连续建（不等落盘）", `${noSettle.toFixed(0)}ms`);
      flow.record("之后一次 settle", `${oneSettle.toFixed(1)}ms（当前库 ${dbBytes()} 字节）`);
      flow.record("逐条 settle 的合计（S1 末 200 条）", `${perCallSum.toFixed(0)}ms`);
      // 自我取证：await 之后仍然只测到 ~0.1ms，说明我根本没量到写盘这件事本身
      flow.check("测量自证：一次 settle 必须真的覆盖到整库落盘（≥1ms，否则本条所有耗时都只是入队）", oneSettle >= 1, "≥1ms", `${oneSettle.toFixed(2)}ms`);
      flow.record("判读", oneSettle >= 1
        ? `连续建 ${noSettle.toFixed(0)}ms + 一次落盘 ${oneSettle.toFixed(1)}ms vs 逐条等落盘 ${perCallSum.toFixed(0)}ms ⇒ 逐条等待放大约 ${(perCallSum / Math.max(1, noSettle + oneSettle)).toFixed(1)} 倍`
        : "settle 仍测不到落盘 ⇒ 本条的耗时口径不可信，S1 的绿不能采信");

      flow.section("S3 写放大：累计写出的字节 / 最终库大小");
      const a = await audit(dbFile);
      const nCards = a.count("cards");
      a.close();
      const finalSize = dbBytes();
      const totalWritten = samples.reduce((s, r) => s + Math.abs(r.written || 0), 0);
      flow.record("最终库", `${nCards} 张卡 · ${finalSize} 字节`);
      flow.record("采样窗口内累计库文件增量", `${totalWritten} 字节（注意：整库重写时增量为 0 甚至为负，真实写入量看 S2 的单次 persist）`);
      flow.record("单库大小合理性", finalSize > 0 && finalSize < 200 * 1024 * 1024 ? `库 ${finalSize} 字节，未见异常膨胀` : `库 ${finalSize} 字节，需要看是否碎片/膨胀`);
      flow.record("未覆盖", "① 真实渲染层的等待感受（本条只测主进程函数墙钟，UI 是否有进度/是否卡住输入未测）；" +
        "② createFromPaste/createFromTxt 等更重的导入路径的同类曲线；③ persist 失败重试与 journal 去抖在高频写入下的合并效果（F71 只验了接线）");
    });
  })
  .catch((e) => {
    flow.check("流程未崩溃", false, "不抛", String((e && e.stack) || e).slice(0, 400));
    process.exitCode = 1;
  });
