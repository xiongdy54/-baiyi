// L4 总账审计 — 回放 review_logs 的评分序列，与各卡最终 fsrs_json 对照
// 判定「卡片调度是否严格依照 FSRS 算法处理」的整链路收官结论
// 运行：node tests/fsrs/audit.cjs [--db <path>] [--card-prefix FSRSTEST]
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const DB_PATH = getArg("--db", "C:/Users/xiongdy/AppData/Roaming/incremental-reading-dev/library.db");
const PREFIX = getArg("--card-prefix", "FSRSTEST");

const tsfs = require(path.join(__dirname, "..", "..", "node_modules", "ts-fsrs", "dist", "index.cjs"));
const { fsrs, generatorParameters, createEmptyCard, Rating } = tsfs;
const ref = fsrs(generatorParameters({ enable_fuzz: false }));
const initSqlJs = require(path.join(__dirname, "..", "..", "node_modules", "sql.js"));

const RATING_MAP = { Again: 1, Hard: 2, Good: 3, Easy: 4 };

initSqlJs().then((SQL) => {
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  // 取目标卡的创建信息
  const cards = [];
  const s1 = db.prepare(`SELECT id, note_text, fsrs_json, created_at FROM cards WHERE note_text LIKE '${PREFIX}%' AND is_deleted=0`);
  while (s1.step()) cards.push(s1.getAsObject());
  if (cards.length === 0) {
    console.log(`未找到前缀为 ${PREFIX} 的测试卡`);
    process.exit(0);
  }
  let pass = 0, fail = 0;
  console.log(`== L4 总账审计（前缀 ${PREFIX}，共 ${cards.length} 张）==`);
  console.log(`参考引擎: ts-fsrs FSRS-6.0, enable_fuzz=false, request_retention=0.9\n`);
  for (const card of cards) {
    // 该卡的评分日志（时间升序）
    const logs = [];
    const s2 = db.prepare(`SELECT rating, reviewed_at FROM review_logs WHERE card_id = '${card.id}' ORDER BY reviewed_at ASC`);
    while (s2.step()) logs.push(s2.getAsObject());
    const finalFsrs = JSON.parse(card.fsrs_json);
    console.log(`卡 ${card.note_text.slice(0, 14)}…`);
    if (logs.length === 0) {
      console.log(`  无评分记录（新卡，跳过）\n`);
      continue;
    }
    // 参考引擎重放：从 created_at 起新卡，按日志时刻评分
    let c = createEmptyCard(new Date(card.created_at));
    for (const log of logs) {
      const out = ref.repeat(c, new Date(log.reviewed_at))[RATING_MAP[log.rating]];
      c = out.card;
    }
    const replayDue = c.due.getTime();
    const actualDue = finalFsrs.due;
    const diffMs = Math.abs(replayDue - actualDue);
    const replayState = ["new", "learning", "review", "relearning"][c.state];
    const okState = replayState === finalFsrs.state;
    // 分钟级间隔允许 5s 容差；天级间隔允许 fuzz 区间（这里统一用 1% 或 5s 取大者）
    const tol = Math.max(5000, replayDue * 0.01 - actualDue * 0.01);
    const okDue = diffMs <= tol;
    if (okState && okDue) { pass++; console.log(`  ✓ ${logs.length} 轮重放：state=${replayState} due偏差=${(diffMs / 1000).toFixed(1)}s — 与最终 fsrs_json 一致`); }
    else { fail++; console.log(`  ✗ ${logs.length} 轮重放不一致:\n      重放: state=${replayState} due=${new Date(replayDue).toISOString()}\n      实际: state=${finalFsrs.state} due=${new Date(actualDue).toISOString()} 偏差=${(diffMs / 3600000).toFixed(2)}h`); }
    console.log();
  }
  console.log(`L4 完成：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
});
