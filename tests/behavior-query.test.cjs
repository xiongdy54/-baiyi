// @runtime: electron
// D248 / T11：具名查询——白名单、衰减公式、runs 整数 day index、Wilson 下界、0 分母 NULL（§10 / 附录 A）。
// 运行：npx electron tests/behavior-query.test.cjs（或 node scripts/run-tests.mjs behavior-query）
"use strict";
const { app } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
let pass = 0;
let fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}

app.whenReady().then(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bdi-query-"));
  app.setPath("userData", dir);
  const db = require(path.join(ROOT, "electron", "db.js"));
  const behaviorDb = require(path.join(ROOT, "electron", "behavior", "behaviorDb.js"));
  const { createQuery, buildRuns, wilsonLower } = require(path.join(ROOT, "electron", "behavior", "query.js"));
  await db.initDb();
  behaviorDb.configure({ dataDir: dir });
  await behaviorDb.open();
  const bdb = behaviorDb.getDb();
  const q = createQuery({ db: bdb, pull: db.bdiPull, now: () => 1761609600000, todayDay: () => "2026-10-28" });

  console.log("== A 具名白名单 ==");
  check("查询名是固定集合（含 9 个具名查询）", q.names.length >= 9 && q.names.includes("status") && q.names.includes("reviewContext"), q.names, q.names);
  check("不存在任意 SQL 入口（只有具名方法）", typeof q.queries.sql === "undefined", "无 sql", typeof q.queries.sql);

  console.log("== B 衰减公式 ==");
  const insSig = bdb.prepare("INSERT INTO signal_daily (day, signal_id, udc, level, n, value, quality, rv) VALUES (?,?,?,?,?,?,?,?)");
  insSig.run("2026-10-28", "open_active", "51", "leaf", 1, 10, "ok", 1);
  insSig.run("2026-10-27", "open_active", "51", "leaf", 1, 10, "ok", 1);
  insSig.run("2026-10-18", "open_active", "51", "leaf", 1, 10, "ok", 1);
  const dec = q.queries.decayed({ from: "2026-10-01", to: "2026-10-28", ids: ["open_active"], halfLifeDays: 10 });
  const row = dec.rows[0];
  const expected = 10 * 1 + 10 * Math.pow(0.5, 1 / 10) + 10 * Math.pow(0.5, 10 / 10); // age 0 / 1 / 10，半衰期 10 天
  check("decayed = Σ value×0.5^(age/halfLife)", Math.abs(row.decayed - expected) < 1e-9, expected, row && row.decayed);
  check("raw 保留原单位（30 次）", row.raw === 30, 30, row && row.raw);

  console.log("== C runs：整数 day index / unknown 不桥接 / isOpen ==");
  const mk = (day, engaged) => ({ day, engaged });
  const rows = [
    mk("2026-10-01", 1), mk("2026-10-02", 1), mk("2026-10-03", 0),
    mk("2026-10-04", 1), // gap 1 且 10-03 明确 0 → 桥接
    mk("2026-10-06", 1), // 10-05 unknown（无行）→ 不桥接
  ];
  const runs = buildRuns(rows, 8, 1);
  check("隔一个「明确休息日」仍连成一段（整数 day index）", runs.length === 2 && runs[0].startDay === "2026-10-01" && runs[0].endDay === "2026-10-04", "run1 10-01..10-04", runs);
  check("unknown 日不回填成休息日（不桥接）", runs[1].startDay === "2026-10-06", "2026-10-06", runs[1]);
  check("spanDays/gapDays 用整数差", runs[0].spanDays === 4 && runs[0].gapDays === 1, { span: 4, gap: 1 }, runs[0]);
  const empty = buildRuns([], 8, 1);
  check("空数据返回空数组（不造区间）", empty.length === 0, 0, empty.length);

  console.log("== D Wilson 下界与 0 分母 ==");
  check("total=0 → lowerBound=null（不返回 0/NaN）", wilsonLower(0, 0) === null, null, wilsonLower(0, 0));
  const lb = wilsonLower(8, 10);
  check("8/10 的 Wilson 下界在 (0, 0.8) 且 < p", lb > 0 && lb < 0.8, "0<lb<0.8", lb);
  check("同比例样本量更大 → 下界更高（单调）", wilsonLower(80, 100) > lb, "单调", [lb, wilsonLower(80, 100)]);
  check("不允许小数样本（total=2.5 → null）", wilsonLower(1, 2.5) === null, null, wilsonLower(1, 2.5));

  console.log("== E passRate：无 Review 态样本 → NULL ==");
  const pr = q.queries.passRate({ from: "2026-10-01", to: "2026-10-28" });
  check("无样本时 rate=null（0 分母不返回 0）", pr.total === 0 && pr.rate === null && pr.lowerBound === null, "null", pr);

  console.log("== F status 带版本号 ==");
  const st = q.queries.status();
  check("status 返回 catalog/metrics/derive 版本", st.catalogVersion >= 1 && st.metricsVersion >= 1 && st.deriveVersion >= 1, "版本齐全", st);

  behaviorDb.close();
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* 系统临时目录 */ }
  console.log(`\n==== behavior-query ${pass}/${pass + fail} 断言 ====`);
  if (fail > 0) console.log(`  失败 ${fail} 项`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { console.error("顶层异常：" + (e && e.stack ? e.stack : e)); app.exit(1); });
