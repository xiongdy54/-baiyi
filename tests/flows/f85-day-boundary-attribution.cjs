// F85 日界归属的跨面守恒（热力图逐格 vs 日记分组 vs KPI：同一个时间戳必须落在同一天）
// @runtime: electron  @tier: 1  @gui: false  @id: F85  @timeout: 300
// 运行：npx electron tests/flows/f85-day-boundary-attribution.cjs
//
// 承接 F84：那条量到"切点只被一半统计量采纳"（D-TEST-88），但明确留了两块没测——
// 热力图逐格的日期归属，和 journalTime.js 的日记分组。本条把这两块补齐，并加一条守恒律：
//   **同一个时间戳，在 KPI / 热力图 / 日记分组三处必须归到同一天；
//    切点怎么改，格子的总数与总条数都不能变（只能挪动归属，不能凭空增减）。**
// 挪动归属是语义问题，增减是数据完整性问题——后者严重得多，所以守恒律优先。
// 纪律：函数名/字段名一律运行时发现（F84 刚被 review_logs 的列名坑过一次，那条靠空转自检拦下）。
"use strict";
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { Flow, runFlow, ROOT, tmpUserDataDir, freshDir } = require("./lib/harness.cjs");
const { audit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F85",
  title: "日界归属跨面守恒",
  angle: "同一时间戳在 KPI/热力图/日记分组三处是否归同一天，切点变化下总条数是否守恒",
  cites: ["§4.4.8", "D21", "§4.5", "D-TEST-88"],
  tier: 1,
  gui: false,
});
const DAY = 86400000;
const HOUR = 3600000;
const fsrsAt = (due) => ({ state: "review", due, reps: 5, lapses: 0, stability: 12, difficulty: 5, lastReview: due - DAY, learningSteps: 0 });

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f85"));
    app.setPath("userData", dir);
    const db = require(path.join(ROOT, "electron", "db.js"));
    await db.initDb();

    await runFlow(flow, async () => {
      const now = Date.now();
      const midnight = new Date(now).setHours(0, 0, 0, 0);
      const item = db.createFromPaste("F85 日界书", "# 章\n\n为跨面守恒而造。\n");
      const itemId = item && (item.id || (item.item && item.item.id));
      const ids = [];
      for (let i = 0; i < 6; i++) {
        const c = db.createCard({ itemId, frontMarkdown: `F85 问 ${i}`, backMarkdown: `F85 答`, cardType: "qa" });
        const id = c && (c.id || c.cardId);
        if (!id) continue;
        db.execRawSql("UPDATE cards SET fsrs_json = ? WHERE id = ?", [JSON.stringify(fsrsAt(now - 60000)), id]);
        ids.push(id);
      }
      db.persistNow();

      const a0 = await audit(path.join(dir, "library.db"));
      const cols = a0.columns("review_logs").map((c) => c.name || c);
      a0.close();
      const stampCol = cols.includes("reviewed_at") ? "reviewed_at" : cols.includes("created_at") ? "created_at" : null;
      // 六个关键时刻：横跨切点两侧，且分布在三个不同的"本地日"
      const STAMPS = [
        { 名: "今天01:30", t: midnight + 1 * HOUR + 30 * 60000 },
        { 名: "今天03:59", t: midnight + 4 * HOUR - 60000 },
        { 名: "今天04:01", t: midnight + 4 * HOUR + 60000 },
        { 名: "今天12:00", t: midnight + 12 * HOUR },
        { 名: "昨天22:00", t: midnight - DAY + 22 * HOUR },
        { 名: "前天09:00", t: midnight - 2 * DAY + 9 * HOUR },
      ];
      if (!cols.includes("card_id") || !stampCol) {
        flow.check("闸门空转自检：必须找到 card_id 与时间戳列", false, "存在", `cols=${cols.join(",")}`);
        return;
      }
      let seq = 0;
      const ax = await audit(path.join(dir, "library.db"));
      seq = Number(ax.rows("SELECT COALESCE(MAX(review_seq),0) AS m FROM review_logs")[0].m) || 0;
      ax.close();
      for (let i = 0; i < STAMPS.length; i++) {
        const cols2 = ["id", "card_id", "rating", stampCol, "duration_ms"];
        const vals = [`f85-${i}`, ids[i % ids.length], 3, STAMPS[i].t, 9000];
        if (cols.includes("review_seq")) { cols2.push("review_seq"); vals.push(++seq); }
        db.execRawSql(`INSERT INTO review_logs (${cols2.join(",")}) VALUES (${cols2.map(() => "?").join(",")})`, vals);
      }
      // 日记：两条，一条在切点前一条在切点后
      db.createJournalEntry({ contentMarkdown: "F85 凌晨记", source: "app", entryDate: undefined, createdAt: midnight + 2 * HOUR });
      db.createJournalEntry({ contentMarkdown: "F85 正午记", source: "app", entryDate: undefined, createdAt: midnight + 13 * HOUR });
      db.persistNow();
      const ay = await audit(path.join(dir, "library.db"));
      const logN = ay.count("review_logs");
      ay.close();
      if (logN < STAMPS.length) { flow.check("闸门空转自检：六条关键日志必须真的落库", false, `${STAMPS.length} 条`, logN); return; }
      flow.record("播种", `${ids.length} 张卡 · ${logN} 条日志（六个关键时刻横跨切点 4）· 2 条日记（02:00 与 13:00）`);

      const setCutoff = (n) => {
        const f = path.join(dir, "settings.json");
        let s = {};
        try { s = JSON.parse(fs.readFileSync(f, "utf-8")); } catch { /* 首次 */ }
        s.app = { ...(s.app || {}), dayCutoffHour: n };
        fs.writeFileSync(f, JSON.stringify(s), "utf-8");
      };

      flow.section("S0 运行时发现：统计对象里到底有哪些字段、journalTime 导出什么");
      const full = db.getStatsOverview();
      flow.record("getStatsOverview 顶层键", Object.keys(full).join(" · "));
      const heatKey = Object.keys(full).find((k) => /heat|daily|calendar|cells/i.test(k));
      flow.record("判定为热力图的字段", heatKey || "未找到 ⇒ 本条 S2 改判为不可测");
      const heatShape = heatKey ? JSON.stringify(full[heatKey]).slice(0, 220) : "无";
      flow.record("该字段形状", heatShape);
      const jt = require(path.join(ROOT, "electron", "journalTime.js"));
      flow.record("journalTime 导出", Object.keys(jt).join(" · "));

      const probe = (cut) => {
        setCutoff(cut);
        const o = db.getStatsOverview();
        const k = o.kpi || {};
        let cells = [];
        if (heatKey) {
          const raw = o[heatKey];
          if (Array.isArray(raw)) cells = raw.map((c) => ({ d: c.date ?? c.day ?? c.key ?? "?", n: c.count ?? c.n ?? c.reviews ?? (typeof c === "number" ? c : 0) }));
          else if (raw && typeof raw === "object") cells = Object.entries(raw).map(([d, n]) => ({ d, n: typeof n === "number" ? n : (n && n.count) || 0 }));
        }
        const total = cells.reduce((s, c) => s + (Number(c.n) || 0), 0);
        let jtOut = null;
        try {
          const fn = Object.keys(jt).find((x) => typeof jt[x] === "function" && /label|bucket|dayOf|group|resolve|shift|dateFor/i.test(x));
          jtOut = fn ? `${fn}(${String(jt[fn](midnight + 2 * HOUR)).slice(0, 40)})` : "无匹配函数";
        } catch (e) { jtOut = "抛错:" + String(e.message).slice(0, 60); }
        return { cut, completed: k.completedToday, streak: k.streak, due: k.dueToday, cells, total, jtOut };
      };

      const rows = [probe(0), probe(4), probe(23)];
      flow.section("S1 三种切点下的读数与守恒检查");
      for (const r of rows) flow.record(`切点=${r.cut}`, `completed=${r.completed} streak=${r.streak} dueToday=${r.due} 热力格数=${r.cells.length} 格内总数=${r.total} · journalTime→${r.jtOut}`);
      if (heatKey) {
        const totals = new Set(rows.map((r) => r.total));
        flow.check("守恒律：切点只能挪动归属，热力图总条数不得变化", totals.size === 1, "三切点总数相等", [...totals].join(" / ") + `（各切点格数 ${rows.map((r) => r.cells.length).join("/")}）`);
        flow.record("归属是否真的挪动", rows[0].cells.map((c) => `${c.d}:${c.n}`).join(" ") + "  ||  " + rows[1].cells.map((c) => `${c.d}:${c.n}`).join(" "));
      } else {
        flow.record("S1 结论", "统计对象里没有热力图字段 ⇒ 本条的守恒律只能对 KPI 侧做，如实记为未测");
      }

      flow.section("S2 跨面一致性：completedToday 与热力图『今天』那一格必须同源");
      for (const r of rows) {
        if (!heatKey) break;
        const todayCell = r.cells[r.cells.length - 1] || null;
        flow.record(`切点=${r.cut}`, `KPI completedToday=${r.completed} · 热力图末格 ${todayCell ? `${todayCell.d}=${todayCell.n}` : "无"} · 差=${todayCell ? Number(r.completed) - Number(todayCell.n) : "?"}`);
      }
      const mismatch = [];
      for (const r of rows) {
        if (!heatKey) break;
        const last = r.cells[r.cells.length - 1];
        if (!last) continue;
        if (Number(r.completed) !== Number(last.n)) mismatch.push(`切点${r.cut}: KPI=${r.completed} vs 热力末格(${last.d})=${last.n}`);
      }
      flow.check("同一时间窗在 KPI 与热力图里必须给出同一个『今日』计数", mismatch.length === 0, "三切点全等", mismatch.join(" ||| ") || "全等");

      flow.section("S3 日记侧：journalDateOf 与统计侧必须用同一个日界");
      const jtKeys = Object.keys(jt).filter((k) => typeof jt[k] === "function");
      flow.record("journalTime 可用函数", jtKeys.join(" · "));
      // 第一版按 /dayOf/ 去匹配，实际导出叫 journalDateOf（Date 不是 Day），
      // 于是判成"没认出函数"。名字要按 S0 的实测清单来取，不要靠正则猜。
      const dayOf = typeof jt.journalDateOf === "function" ? "journalDateOf" : jtKeys.find((k) => /date|day/i.test(k));
      if (!dayOf) {
        flow.record("未覆盖", `journalTime 里没有可单独调用的归属函数（候选 ${jtKeys.join(",")}），本格如实记为未测`);
      } else {
        const outs = [0, 4, 23].map((c) => {
          setCutoff(c);
          return { c, 凌晨: String(jt[dayOf](midnight + 2 * HOUR)), 正午: String(jt[dayOf](midnight + 13 * HOUR)), 昨天22: String(jt[dayOf](midnight - DAY + 22 * HOUR)) };
        });
        for (const o of outs) flow.record(`${dayOf} 切点=${o.c}`, `今天02:00→${o.凌晨} · 今天13:00→${o.正午} · 昨天22:00→${o.昨天22}`);
        const honors = new Set(outs.map((o) => o.凌晨)).size > 1;
        flow.record("是否参与切点", honors ? "02:00 的归属随切点变化" : "02:00 的归属不随切点变化");
        // D34（journalTime.js 头注，用户 2026-09-14 拍板）：日记按**本地自然日 00:00** 切，
        // 故意不随 dayCutoffHour 漂移 —— 否则用户改一次设置就会让历史条目集体换天。
        // 我第一版判的是"日记侧必须与统计侧同进同退"，那是拿 D21 的口径去要求一个
        // 已被显式排除的面 ⇒ 假红。这里改成把 D34 契约钉成回归闸门：日记侧**不许**跟随。
        flow.check("D34 契约闸门：日记归属不得随学习日切点漂移", honors === false, "不跟随", honors ? "**跟随了**（历史条目会集体换天）" : "不跟随");
        flow.check("D21 侧仍须跟随（否则切点这个设置对统计也不再生效）", rows[0].completed !== rows[1].completed, "统计侧跟随", `统计侧 completedToday ${rows[0].completed}→${rows[1].completed}`);
        // 与库里的 entryDate 对表：真实日记在两种切点下各归哪天
        const jr = [];
        for (const c of [0, 4]) {
          setCutoff(c);
          const list = db.listJournalEntries({ limit: 50 });
          const arr = Array.isArray(list) ? list : list?.entries || [];
          jr.push({ c, days: arr.map((e) => `${String(e.contentMarkdown || e.content_markdown || "").slice(0, 8)}=${e.entryDate ?? e.entry_date ?? "?"}`).join(" ") });
        }
        for (const x of jr) flow.record(`切点=${x.c} 库内日记 entry_date`, x.days);
        const same = jr.length === 2 && jr[0].days === jr[1].days;
        flow.record("落盘的 entry_date 是否随切点重算", same ? "不变（写入时定死，切点只影响读侧分组）" : "会变 ⇒ 需要看是不是把用户已确认的日期改写了");
      }
      flow.record("未覆盖", "渲染层实际显示的分组标题（本条只调主进程函数）；热力图跨月/闰日边界；`entryDate` 显式传入时的优先级");
    });
  })
  .catch((e) => {
    flow.check("流程未崩溃", false, "不抛", String((e && e.stack) || e).slice(0, 400));
    process.exitCode = 1;
  })
  // C-45：Electron 主进程不会自行退出；延迟 200 ms，让结果文件与日志先写完
  .finally(() => setTimeout(() => app.exit(process.exitCode || 0), 200));
