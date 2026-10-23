// F84 学习日分界 dayCutoffHour 的真实作用面（改了设置，到底有几处跟着动）
// @runtime: electron  @tier: 1  @gui: false  @id: F84  @timeout: 300
// 运行：npx electron tests/flows/f84-day-cutoff.cjs
//
// 角度：设置面板里有"学习日切点"（settings.app.dayCutoffHour，默认 0），
// 全仓只有三个文件读它（db.js / journalTime.js / SettingsPanel.tsx）。
// 也就是说：**其余所有按"今天"聚合的地方都用的是本地零点**。
// 用户把切点设成 4（凌晨 2 点复习算前一天，这是渐进阅读/Anki 用户的常见设置）之后，
// 队列、连续天数、热力图、日记时间戳是不是都跟着挪？本条用**同一份数据只改设置**做差分。
// 纪律：① 列名/函数名一律运行时发现，不硬编码（本战役已因猜列名翻车两次）；
//       ② 每个判据都要能指出"应当变化几个"，不变就是设置无效，变得没有方向就是语义打架。
"use strict";
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { Flow, runFlow, ROOT, tmpUserDataDir, freshDir } = require("./lib/harness.cjs");
const { audit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F84",
  title: "学习日切点作用面",
  angle: "只改 dayCutoffHour、数据不动，看队列/连续天数/今日完成/热力图有几处跟着挪",
  cites: ["§4.4.8", "D21", "§4.5", "§7.1.3"],
  tier: 1,
  gui: false,
});
const DAY = 86400000;
const HOUR = 3600000;
const fsrsAt = (due) => ({ state: "review", due, reps: 5, lapses: 0, stability: 12, difficulty: 5, lastReview: due - DAY, learningSteps: 0 });

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f84"));
    app.setPath("userData", dir);
    const db = require(path.join(ROOT, "electron", "db.js"));
    await db.initDb();

    await runFlow(flow, async () => {
      const now = Date.now();
      const localMidnight = new Date(now).setHours(0, 0, 0, 0);

      /* 播种：4 张"现在就该发"、3 张"今天晚些"、3 张"昨天已过期" */
      const item = db.createFromPaste("F84 切点书", "# 章\n\n为学习日切点而造。\n");
      const itemId = item && (item.id || (item.item && item.item.id));
      const made = [];
      const plan = [
        ...Array.from({ length: 4 }, () => now - 60000),
        ...Array.from({ length: 3 }, () => now + 5 * HOUR),
        ...Array.from({ length: 3 }, () => localMidnight - HOUR),
      ];
      for (let i = 0; i < plan.length; i++) {
        const c = db.createCard({ itemId, frontMarkdown: `F84 问 ${i}`, backMarkdown: `F84 答`, cardType: "qa" });
        const id = c && (c.id || c.cardId);
        if (!id) continue;
        db.execRawSql("UPDATE cards SET fsrs_json = ? WHERE id = ?", [JSON.stringify(fsrsAt(plan[i])), id]);
        made.push(id);
      }
      db.persistNow();

      /* 复习日志：先看真实列名，再按列名拼插入（不硬编码） */
      const a0 = await audit(path.join(dir, "library.db"));
      const cols = a0.columns("review_logs").map((c) => c.name || c);
      a0.close();
      flow.record("review_logs 列名", cols.join(" · "));
      const has = (n) => cols.includes(n);
      // 三条关键日志：今天 01:30（切点 4 时应算昨天）、昨天 22:00、前天 10:00
      const at0130 = localMidnight + 1 * HOUR + 30 * 60000;
      const atY22 = localMidnight - DAY + 22 * HOUR;
      const atD2 = localMidnight - 2 * DAY + 10 * HOUR;
      const stamps = [at0130, atY22, atD2];
      let inserted = 0;
      // 真实列名（本条实测）：id card_id rating reviewed_at duration_ms fsrs_before_json
      //   fsrs_after_json leech_before_json fsrs_config_id fsrs_before_config_id review_seq
      // 没有 created_at —— 第一版按 created_at 判断，直接 0 条落库，被自己的空转自检拦下。
      const stampCol = has("reviewed_at") ? "reviewed_at" : has("created_at") ? "created_at" : null;
      flow.record("时间戳列判定", stampCol || "未找到时间戳列");
      if (has("card_id") && stampCol) {
        let seq = 0;
        if (has("review_seq")) {
          const ax = await audit(path.join(dir, "library.db"));
          seq = Number(ax.rows("SELECT COALESCE(MAX(review_seq),0) AS m FROM review_logs")[0].m) || 0;
          ax.close();
        }
        for (let i = 0; i < stamps.length; i++) {
          const cols = ["id", "card_id", "rating", stampCol, "duration_ms"];
          const vals = [`f84-log-${i}`, made[i], 3, stamps[i], 9000];
          if (has("review_seq")) { cols.push("review_seq"); vals.push(++seq); }
          if (has("fsrs_after_json")) { cols.push("fsrs_after_json"); vals.push(JSON.stringify(fsrsAt(stamps[i] + DAY))); }
          if (has("fsrs_before_json")) { cols.push("fsrs_before_json"); vals.push(JSON.stringify(fsrsAt(stamps[i] - DAY))); }
          try {
            db.execRawSql(`INSERT INTO review_logs (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`, vals);
            inserted++;
          } catch (e) { flow.record("插入失败", String(e.message).slice(0, 140)); break; }
        }
      }
      db.persistNow();
      flow.record("写入的复习日志", `${inserted} 条，时间分别在 今天01:30 / 昨天22:00 / 前天10:00（切点=4 时，01:30 那条应归到昨天）`);
      if (inserted < 3) { flow.check("闸门空转自检：三条关键日志必须真的落库，否则本条判定不作数", false, "3 条", inserted); return; }

      const setCutoff = (n) => {
        const f = path.join(dir, "settings.json");
        let s = {};
        try { s = JSON.parse(fs.readFileSync(f, "utf-8")); } catch { /* 首次无文件 */ }
        s.app = { ...(s.app || {}), dayCutoffHour: n };
        fs.writeFileSync(f, JSON.stringify(s), "utf-8");
      };

      const read = (tag) => {
        setCutoff(tag);
        const k = db.getStatsOverview().kpi;
        const q = db.computeTodayQueue();
        const heat = db.getStatsOverview().heatmap || db.getStatsOverview().heat || null;
        return { tag, dueToday: k.dueToday, completedToday: k.completedToday, pendingToday: k.pendingToday, streak: k.streak, minutesToday: k.minutesToday, queue: (q.cards || []).length, heatLen: Array.isArray(heat) ? heat.length : heat ? Object.keys(heat).length : -1, heat };
      };

      flow.section("S1 只改切点，逐量差分（0 → 4 → 23）");
      const rows = [read(0), read(4), read(23), read(0)];
      for (const r of rows) flow.record(`切点=${r.tag}`, `dueToday=${r.dueToday} completedToday=${r.completedToday} pending=${r.pendingToday} streak=${r.streak} 分钟=${r.minutesToday} 队列实发=${r.queue} 热力图格数=${r.heatLen}`);

      const r0 = rows[0], r4 = rows[1], r23 = rows[2];
      flow.check("切点必须至少影响一个统计量（全不变 ⇒ 这个设置项是死的）", new Set(rows.map((r) => `${r.completedToday}|${r.streak}|${r.dueToday}`)).size > 1, "至少一处变化", rows.map((r) => `${r.completedToday}/${r.streak}/${r.dueToday}`).join("  "));

      flow.section("S2 语义方向：切点=4 时，今天 01:30 那条日志应归到昨天");
      const moved = r4.completedToday < r0.completedToday;
      flow.record("今日完成数", `切点0=${r0.completedToday} · 切点4=${r4.completedToday} · 切点23=${r23.completedToday}`);
      flow.record("方向判定", moved ? "切点调大后今日完成数变小 ⇒ 01:30 那条被挪出今天，方向正确" : "切点调大后今日完成数没变小 ⇒ 01:30 那条仍算今天，**该设置没有参与今日聚合**");
      flow.check("切点=4 时 01:30 的复习不应再计入『今日完成』（应归昨日）", moved, "completedToday 变小", `0→4: ${r0.completedToday}→${r4.completedToday}`);

      flow.section("S3 队列与今日到期是否跟着挪");
      flow.record("队列实发随切点", `0→${r0.queue} · 4→${r4.queue} · 23→${r23.queue}`);
      flow.record("dueToday 随切点", `0→${r0.dueToday} · 4→${r4.dueToday} · 23→${r23.queue === undefined ? "?" : r23.dueToday}`);
      const queueFollows = r0.queue !== r4.queue || r0.dueToday !== r4.dueToday;
      flow.record("是否跟随", queueFollows ? "队列/今日到期至少有一项随切点移动" : "队列与今日到期对切点**完全无感**（两者都按本地零点或按 now 算）");

      flow.section("S4 同一切点下 pendingToday 与队列实发是否闭合（与 F77 恒等式呼应）");
      for (const r of [r0, r4, r23]) {
        flow.record(`切点=${r.tag}`, `pending=${r.pendingToday} 队列=${r.queue} 差=${r.pendingToday - r.queue}`);
      }
      const gaps = [r0, r4, r23].map((r) => r.pendingToday - r.queue);
      flow.check("任一切点下 pendingToday 与队列实发的差都应可解释（此处要求差值在三个切点间保持一致，否则差额又叠了一层切点因素）", new Set(gaps).size === 1, "差值恒定", gaps.join(" / "));

      flow.section("S5 切点回到 0，读数应与首次一致（排除状态漂移）");
      const back = rows[3];
      flow.check("改回切点=0 后各量必须与第一次完全一致（否则说明有缓存/脏状态）", `${back.completedToday}|${back.streak}|${back.dueToday}|${back.queue}` === `${r0.completedToday}|${r0.streak}|${r0.dueToday}|${r0.queue}`, "与首次一致", `${back.completedToday}|${back.streak}|${back.dueToday}|${back.queue}`);
      flow.record("未覆盖", "热力图逐格日期归属（本条只读了格数，没比对哪一格被点亮）；日记列表的时间分组（journalTime.js 也读切点，但走渲染层）；复习界面顶部的『今日已学』");
    });
  })
  .catch((e) => {
    flow.check("流程未崩溃", false, "不抛", String((e && e.stack) || e).slice(0, 400));
    process.exitCode = 1;
  })
  // C-45：Electron 主进程不会自行退出；延迟 200 ms，让结果文件与日志先写完
  .finally(() => setTimeout(() => app.exit(process.exitCode || 0), 200));
