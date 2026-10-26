// @runtime: electron
// D236（v49.65）数据页性能：stats:overview 在大库上不再卡死主进程，且口径不变。
// 钉住四件事：① 一次统计只读 1 次日切点（原来每条复习记录读一次 settings.json）；② 连续天数 / 热力 / 阅读字数 /
// 到期预测的学习日轴夏令时安全（原来 ±86400000 硬步进，切换日之前整段为 0、连续天数断成 1）；③ 卡片侧精简扫描与
// mapCardRow 损坏口径一致（损坏 / 挂起 / 归档 / 删除 / 同源延后各形态）；④ 分位数 / 离群点取值逐字不变、时间索引命中。
// 运行：npx electron tests/d236-stats-perf.test.cjs（或 node scripts/run-tests.mjs d236-stats-perf）
// 隔离：临时 userData（app.setPath），绝不触碰真实库（§7.3）。时区在首行固定为 Europe/London
// （2026-10-25 01:00 UTC 结束夏令时），断言与运行机器所在时区无关。
"use strict";
process.env.TZ = "Europe/London"; // 必须先于任何 Date 运算
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const Database = require("better-sqlite3");

const ROOT = path.join(__dirname, "..");
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const local = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi, 0, 0).getTime(); // 伦敦本地钟面
const NOW_A = local(2026, 10, 27, 12); // 切换后第 2 天正午（GMT）
const NOW_B = local(2026, 10, 20, 12); // 切换前一周正午（BST）

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`);
  }
}

// 原实现的分位数（逐字照抄，作参照）
function refQuantile(arr, q) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const pos = (s.length - 1) * q, base = Math.floor(pos), rest = pos - base;
  return s[base + 1] !== undefined ? s[base] + rest * (s[base + 1] - s[base]) : s[base];
}

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "d236-stats-perf-"));
  const dbFile = path.join(tmp, "library.db");
  const settingsFile = path.join(tmp, "settings.json");
  const realNow = Date.now;
  let code = 1;
  try {
    app.setPath("userData", tmp);
    const db = require(path.join(ROOT, "electron", "db.js"));
    const { learningDayStartMs } = require(path.join(ROOT, "electron", "fsrsTime.js"));
    await db.initDb();
    db.createFromPaste("D236 书", "# 章\n\n" + "正文。".repeat(40));
    const itemId = db.listItems()[0].id;

    // ---- 播种（第二连接直写；WAL 提交后主连接立即可见） ----
    const seed = new Database(dbFile);
    seed.pragma("busy_timeout = 5000");
    const created = local(2026, 10, 1, 9);
    const lr = local(2026, 10, 5, 9);
    const fsrs = (due, extra = {}) => JSON.stringify({ state: "review", due, stability: 10, difficulty: 5, reps: 3, lapses: 0, lastReview: lr, ...extra });
    const insCard = seed.prepare(
      `INSERT INTO cards (id, user_id, note_text, card_type, front_markdown, back_markdown, priority, tags_json, domain,
        fsrs_json, leech_json, sibling_key, status, is_deleted, created_at, updated_at)
       VALUES (?, 'local-user', ?, 'qa', ?, '答', 50, '[]', ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const card = (id, domain, fsrsJson, o = {}) =>
      insCard.run(id, `笔记 ${id}`, `问题 ${id}`, domain, fsrsJson, o.leech ?? null, o.sib ?? null, o.status ?? null, o.deleted ?? 0, created, created);
    const D51 = JSON.stringify(["51"]);
    card("A", D51, fsrs(local(2026, 10, 26, 9)));                                     // 昨天到期
    card("B", D51, fsrs(local(2026, 10, 30, 12), { stability: 30 }));                  // 3 天后到期；已巩固
    card("C", null, null);                                                             // 新卡（fsrs NULL）
    card("D", D51, "{'broken': true");                                                 // fsrs 非法 JSON → 损坏
    card("E", D51, fsrs(local(2026, 10, 26, 9), { stability: -1 }));                   // 值域非法 → 损坏
    card("F", D51, fsrs(local(2026, 10, 26, 9), { lastReview: local(2026, 11, 30) })); // 未来 lastReview → 损坏
    card("G", D51, fsrs(local(2026, 10, 26, 9)), { leech: JSON.stringify({ suspended: true }) }); // 挂起
    card("H", D51, fsrs(local(2026, 10, 26, 9)), { leech: "{bad leech" });             // leech 损坏
    card("I", D51, fsrs(local(2026, 10, 26, 9)), { status: "archived" });              // 归档
    card("J", D51, fsrs(local(2026, 10, 26, 9)), { deleted: 1 });                      // 已删
    card("K", JSON.stringify(["8"]), fsrs(local(2026, 10, 26, 9)), { sib: "s1" });     // 同源组（perDay=1：1 放行 1 延后）
    card("L", JSON.stringify(["8"]), fsrs(local(2026, 10, 26, 10)), { sib: "s1" });
    card("N", "null", fsrs(local(2026, 11, 30, 12)));                                  // 领域列 "null"：原实现三处直接抛错
    card("Q", '"str"', fsrs(local(2026, 11, 30, 12)));                                 // 领域列是字符串：原实现按首字符归成 "s"
    card("M", JSON.stringify(["53"]), fsrs(local(2026, 11, 30, 12)));                  // 分位数夹具

    const insLog = seed.prepare("INSERT INTO review_logs (id, card_id, rating, reviewed_at, duration_ms, review_seq) VALUES (?, ?, ?, ?, ?, ?)");
    const logs = [];
    let seq = 1;
    const log = (cardId, at, dur) => {
      logs.push(at);
      insLog.run(`l-${seq}`, cardId, "Good", at, dur, seq++);
    };
    // 连续 40 个学习日（含今天）每天正午一条，跨 10-25 夏令时切换；第 41 天空一天，第 42 天再有一条
    for (let k = 0; k < 40; k++) log("A", local(2026, 10, 27 - k, 12), 4000);
    log("A", local(2026, 10, 27 - 41, 12), 4000);
    // Q 的 5 条（原实现会多出一个 "s" 领域）、M 的 10 条分位数夹具（含 1 个离群点）
    for (let k = 0; k < 5; k++) log("Q", local(2026, 10, 27 - 50 - k, 15), 3000 + k);
    const mDur = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 590000];
    mDur.forEach((d, k) => log("M", local(2026, 10, 27 - 60 - k, 8), d));
    // 阅读事件：每天正午推进 100 字（首条只定基线）
    const insRead = seed.prepare("INSERT INTO reading_events (id, item_id, char_pos, created_at) VALUES (?, ?, ?, ?)");
    for (let k = 40; k >= 0; k--) insRead.run(`r-${k}`, itemId, (40 - k) * 100, local(2026, 10, 27 - k, 12));
    seed.close();

    // ================= S1 夏令时切换后的学习日轴（NOW_A = 10-27 正午 GMT） =================
    Date.now = () => NOW_A;
    console.log("== S1 学习日轴跨夏令时（Europe/London，10-25 结束夏令时） ==");
    let reads = 0;
    const origRead = fs.readFileSync;
    fs.readFileSync = function (p, ...rest) {
      if (String(p) === settingsFile) reads++;
      return origRead.call(this, p, ...rest);
    };
    const t0 = process.hrtime.bigint();
    const a = db.getStatsOverview();
    const msA = Number(process.hrtime.bigint() - t0) / 1e6;
    fs.readFileSync = origRead;
    check("S1-1 连续天数 = 40（跨切换日不断；原实现此处为 2）", a.kpi.streak === 40, 40, a.kpi.streak);
    check("S1-2 热力 182 格、末格 = 今日本地零点", a.heatDays.length === 182 && a.heatDays[181].date === local(2026, 10, 27), local(2026, 10, 27), a.heatDays[181]?.date);
    const allMidnight = a.heatDays.every((h) => { const d = new Date(h.date); return d.getHours() === 0 && d.getMinutes() === 0; });
    check("S1-3 每格日期都是本地零点（切换日之前不再错一小时）", allMidnight, true, a.heatDays.filter((h) => new Date(h.date).getHours() !== 0).length + " 格非零点");
    const i25 = a.heatDays.findIndex((h) => h.date === local(2026, 10, 25));
    check("S1-4 切换日 10-25 长 25 小时（日轴逐日推导而非硬步进）", i25 > 0 && a.heatDays[i25 + 1].date - a.heatDays[i25].date === 25 * HOUR, 25 * HOUR, i25 > 0 ? a.heatDays[i25 + 1].date - a.heatDays[i25].date : "找不到 10-25");
    // 参照：逐条 learningDayStartMs 归桶（原实现的键口径，本身 DST 正确）
    const refHeat = new Map();
    for (const t of logs) {
      const k = learningDayStartMs(t, 0);
      refHeat.set(k, (refHeat.get(k) || 0) + 1);
    }
    const heatMismatch = a.heatDays.filter((h) => h.count !== (refHeat.get(h.date) || 0));
    check("S1-5 每格次数 = 逐条归桶参照（切换日之前不再整段为 0）", heatMismatch.length === 0, 0, heatMismatch.slice(0, 3));
    const nonzeroHeat = a.heatDays.filter((h) => h.count > 0).length;
    check("S1-6 有记录的格子数 = 56（40 连续 + 1 + 5 + 10；原实现只剩 2）", nonzeroHeat === 56, 56, nonzeroHeat);
    const readNZ = a.readingDays.filter((d) => d.chars > 0);
    check("S1-7 阅读字数 90 格、40 天各 100 字、日期都是本地零点",
      a.readingDays.length === 90 && readNZ.length === 40 && readNZ.every((d) => d.chars === 100) &&
      a.readingDays.every((d) => new Date(d.date).getHours() === 0) && a.readingDays[89].date === local(2026, 10, 27),
      "90 / 40×100", { len: a.readingDays.length, nz: readNZ.length, vals: [...new Set(readNZ.map((d) => d.chars))] });
    check("S1-8 一次统计只读 ≤3 次 settings.json（日切点 1 次 + 同源延后 2 次；原实现每条复习记录 1 次）", reads <= 3, "≤3", reads);
    console.log(`  （本次统计 ${msA.toFixed(1)}ms，settings.json 读取 ${reads} 次）`);

    // ================= S2 卡片侧精简扫描与损坏口径 =================
    console.log("== S2 卡片侧口径（损坏 / 挂起 / 归档 / 删除 / 同源延后） ==");
    check("S2-1 今日到期 = 3（A、C、K；L 同源延后）", a.kpi.dueToday === 3, 3, a.kpi.dueToday);
    check("S2-2 同源暂缓 = 1", a.kpi.siblingDeferred === 1, 1, a.kpi.siblingDeferred);
    check("S2-3 今日已完成 = 1（A 今日已评）/ 今日评过 1 张", a.kpi.completedToday === 1 && a.kpi.reviewedToday === 1, "1/1", `${a.kpi.completedToday}/${a.kpi.reviewedToday}`);
    const d51 = a.domainDetail.find((d) => d.code === "51")?.count;
    const d8 = a.domainDetail.find((d) => d.code === "8")?.count;
    check("S2-4 领域分布：51 = 3（A/B/挂起的 G；损坏 D/E/F/H、归档 I、删除 J 不计）、8 = 2", d51 === 3 && d8 === 2, "51:3 8:2", { d51, d8 });
    check("S2-5 未分类 = 3（fsrs NULL 的 C、领域 \"null\" 的 N、领域是字符串的 Q）", a.unclassified === 3, 3, a.unclassified);
    check("S2-6 逾期 = 3（A/K/L；挂起 G 不计）", a.queueFlow.overdue === 3, 3, a.queueFlow.overdue);
    check("S2-7 到期预测：今天 1（新卡 C）、第 3 天 1（B）", JSON.stringify(a.dueForecast) === JSON.stringify([1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), [1, 0, 0, 1], a.dueForecast);
    check("S2-8 漏斗：新建 9 / 已开始 8 / 长期复习 8 / 已巩固 1", a.funnel.created === 9 && a.funnel.firstLearned === 8 && a.funnel.reviewing === 8 && a.funnel.consolidated === 1, "9/8/8/1", a.funnel);
    const q = db.computeTodayQueue(NOW_A);
    const damagedIds = q.damaged.map((c) => c.id).sort().join(",");
    check("S2-9 mapCardRow 抽函数后损坏集合不变（D/E/F/H）", damagedIds === "D,E,F,H", "D,E,F,H", damagedIds);
    check("S2-10 字符串领域不再错归 \"s\"：答题时长 / 领域排名都没有 s",
      !a.durationByField.some((f) => f.code === "s") && !a.domainRank.some((r) => r.code === "s"), "无 s",
      { dur: a.durationByField.map((f) => f.code), rank: a.domainRank.map((r) => r.code) });

    // ================= S3 分位数 / 离群点逐字不变 =================
    console.log("== S3 答题时长分位数 ==");
    const m = a.durationByField.find((f) => f.code === "53");
    const fence = refQuantile(mDur, 0.75) + 1.5 * (refQuantile(mDur, 0.75) - refQuantile(mDur, 0.25));
    const want = {
      count: 10, min: 1000, max: 590000,
      q1: Math.round(refQuantile(mDur, 0.25)), median: Math.round(refQuantile(mDur, 0.5)), q3: Math.round(refQuantile(mDur, 0.75)),
      outliers: mDur.filter((v) => v > fence).slice(0, 4)
    };
    const got = m && { count: m.count, min: m.min, max: m.max, q1: m.q1, median: m.median, q3: m.q3, outliers: m.outliers };
    check("S3-1 领域 53 的五数概括与离群点 = 原公式参照", JSON.stringify(got) === JSON.stringify(want), want, got);

    // ================= S4 日切点仍生效（只读一次不等于不读） =================
    console.log("== S4 日切点 ==");
    const settingsNow = () => (fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, "utf8")) : {});
    fs.writeFileSync(settingsFile, JSON.stringify({ ...settingsNow(), app: { ...(settingsNow().app || {}), dayCutoffHour: 13 } }));
    const c13 = db.getStatsOverview();
    check("S4-1 切点 13 点：今日学习日起点 = 10-26 13:00、连续天数仍 40",
      c13.heatDays[181].date === local(2026, 10, 26, 13) && c13.kpi.streak === 40, { date: local(2026, 10, 26, 13), streak: 40 },
      { date: c13.heatDays[181].date, streak: c13.kpi.streak });
    { const cur = settingsNow(); delete (cur.app || {}).dayCutoffHour; fs.writeFileSync(settingsFile, JSON.stringify(cur)); }

    // ================= S5 夏令时切换前的到期预测（NOW_B = 10-20 正午 BST） =================
    console.log("== S5 到期预测跨夏令时 ==");
    const seed2 = new Database(dbFile);
    seed2.pragma("busy_timeout = 5000");
    const ins2 = seed2.prepare(
      `INSERT INTO cards (id, user_id, note_text, card_type, front_markdown, back_markdown, priority, tags_json, domain, fsrs_json, created_at, updated_at)
       VALUES (?, 'local-user', ?, 'qa', ?, '答', 50, '[]', '[]', ?, ?, ?)`
    );
    const f1Due = local(2026, 10, 26, 23, 30); // 切换后那天的 23:30（本地第 6 天；硬步进会算成第 7 天）
    ins2.run("F1", "F1", "F1", fsrs(f1Due), created, created);
    ins2.run("F2", "F2", "F2", fsrs(local(2026, 10, 25, 0, 30)), created, created); // 切换日 00:30（BST）→ 第 5 天
    ins2.run("F3", "F3", "F3", fsrs(local(2026, 10, 21, 10)), created, created);    // 第 1 天
    ins2.run("F4", "F4", "F4", fsrs(local(2026, 10, 19, 10)), created, created);    // 逾期
    seed2.close();
    Date.now = () => NOW_B;
    const b = db.getStatsOverview();
    const today0B = local(2026, 10, 20);
    check("S5-0 夹具确是边界：硬步进 floor((due-today0)/day) 会把 F1 算到第 7 天", Math.floor((f1Due - today0B) / DAY) === 7, 7, Math.floor((f1Due - today0B) / DAY));
    // 今天：C（新卡 due=现在）；第 1 天 F3；第 5 天 F2；第 6 天 A/K/L/F1；第 10 天 B
    const wantB = [1, 1, 0, 0, 0, 1, 4, 0, 0, 0, 1, 0, 0, 0];
    check("S5-1 到期预测按本地学习日归桶（F1 落第 6 天）", JSON.stringify(b.dueForecast) === JSON.stringify(wantB), wantB, b.dueForecast);
    check("S5-2 逾期 = 1（F4）", b.queueFlow.overdue === 1, 1, b.queueFlow.overdue);
    const axis = db.learningDayStarts(today0B, 0, 14, 0);
    const lens = axis.slice(1).map((d, i) => (d - axis[i]) / HOUR);
    check("S5-3 learningDayStarts 前向日轴：第 5 天（10-25）25 小时，其余 24 小时",
      lens.length === 14 && lens[5] === 25 && lens.every((h, i) => i === 5 || h === 24), "24…25…24", lens);

    // ================= S6 时间索引 =================
    console.log("== S6 时间索引 ==");
    const ro = new Database(dbFile, { readonly: true });
    const idx = ro.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name);
    const plan = ro.prepare("EXPLAIN QUERY PLAN " + db.STATS_DAY_PROBE_SQL).all(0, 1).map((r) => r.detail).join(" | ");
    ro.close();
    check("S6-1 idx_review_logs_reviewed_at / idx_reading_events_created 已建", idx.includes("idx_review_logs_reviewed_at") && idx.includes("idx_reading_events_created"), "两个都在", idx.filter((n) => /review_logs|reading_events/.test(n)));
    check("S6-2 连续天数探测命中 idx_review_logs_reviewed_at", plan.includes("idx_review_logs_reviewed_at"), "包含", plan);

    // ================= S7 规模：3000 卡 / 30000 条复习记录 =================
    console.log("== S7 规模 ==");
    const seed3 = new Database(dbFile);
    seed3.pragma("busy_timeout = 5000");
    let s = 7;
    const rnd = (n) => ((s = (s * 1103515245 + 12345) % 2147483648) % n);
    const insC = seed3.prepare(
      `INSERT INTO cards (id, user_id, note_text, card_type, front_markdown, back_markdown, priority, tags_json, domain, fsrs_json, created_at, updated_at)
       VALUES (?, 'local-user', 'n', 'qa', 'q', 'a', 50, '[]', ?, ?, ?, ?)`
    );
    const insL = seed3.prepare("INSERT INTO review_logs (id, card_id, rating, reviewed_at, duration_ms, review_seq) VALUES (?, ?, ?, ?, ?, ?)");
    const leaves = ["51", "8", "53", "9", "34", "004"];
    seed3.transaction(() => {
      for (let i = 0; i < 3000; i++) {
        insC.run(`S${i}`, JSON.stringify([leaves[rnd(leaves.length)]]), fsrs(NOW_B + (rnd(40) - 10) * DAY), NOW_B - rnd(700) * DAY, NOW_B);
      }
      for (let i = 0; i < 30000; i++) {
        insL.run(`SL${i}`, `S${rnd(3000)}`, "Good", NOW_B - rnd(80) * DAY - rnd(DAY), 500 + rnd(60000), seq++);
      }
    })();
    seed3.close();
    const t1 = process.hrtime.bigint();
    const big = db.getStatsOverview();
    const msBig = Number(process.hrtime.bigint() - t1) / 1e6;
    console.log(`  （3000 卡 / 3 万条复习记录：${msBig.toFixed(1)}ms；原实现同规模约 3 秒以上）`);
    check("S7-1 统计 < 2000ms", msBig < 2000, "<2000", Math.round(msBig));
    check("S7-2 规模下结构完整（热力 182 格、阅读 90 格、预测 14 格）", big.heatDays.length === 182 && big.readingDays.length === 90 && big.dueForecast.length === 14, "182/90/14", [big.heatDays.length, big.readingDays.length, big.dueForecast.length]);

    code = fail === 0 ? 0 : 1;
  } catch (e) {
    fail++;
    console.log(`  ✗ 异常：${e && (e.stack || e.message)}`);
    code = 1;
  } finally {
    Date.now = realNow;
    console.log(`\nD236 统计性能：${pass} 通过 / ${fail} 失败`);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    app.exit(code);
  }
});
