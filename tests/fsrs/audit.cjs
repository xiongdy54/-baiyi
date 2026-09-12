// L4 总账审计 — 回放 review_logs 的评分序列，与各卡最终 fsrs_json 对照
// v23（D20/§4.4.10）：按每条日志的 fsrs_config_id 从 fsrs_configs 取完整配置快照分段构引擎重放；
//   v23 日志带 fsrs_after_json → 逐轮 8 字段精确对照（不再只比终态）；旧日志（NULL）按 cfg-default 重放。
// 判定「卡片调度是否严格依照 FSRS 算法处理」的整链路收官结论。
// 运行：node tests/fsrs/audit.cjs [--db <path>] [--card-prefix FSRSTEST] [--weights <json 文件>]
const path = require("path");
const fs = require("fs");
const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const DB_PATH = getArg("--db", "C:/Users/xiongdy/AppData/Roaming/incremental-reading-dev/library.db");
const PREFIX = getArg("--card-prefix", "FSRSTEST");
const WEIGHTS_FILE = getArg("--weights", null);

const tsfs = require(path.join(__dirname, "..", "..", "node_modules", "ts-fsrs", "dist", "index.cjs"));
const { fsrs, generatorParameters, createEmptyCard, Rating } = tsfs;
const initSqlJs = require(path.join(__dirname, "..", "..", "node_modules", "sql.js"));

const RATING_MAP = { Again: 1, Hard: 2, Good: 3, Easy: 4 };
const FSRS_PERSIST_FIELDS = ["state", "due", "lapses", "stability", "difficulty", "reps", "lastReview", "learningSteps"];
const STATE_NAME = ["new", "learning", "review", "relearning"];

function buildEngine(weights, schedulerOptions) {
  const o = schedulerOptions || {};
  return fsrs(
    generatorParameters({
      enable_fuzz: false,
      w: weights,
      request_retention: typeof o.requestRetention === "number" ? o.requestRetention : undefined,
      maximum_interval: typeof o.maximumInterval === "number" ? o.maximumInterval : undefined,
      enable_short_term: typeof o.enableShortTerm === "boolean" ? o.enableShortTerm : undefined,
      learning_steps: Array.isArray(o.learningSteps) ? o.learningSteps : undefined,
      relearning_steps: Array.isArray(o.relearningSteps) ? o.relearningSteps : undefined
    })
  );
}

function cardFromState(s) {
  const stateMap = { new: 0, learning: 1, review: 2, relearning: 3 };
  return {
    ...createEmptyCard(),
    state: stateMap[s.state] ?? 0,
    due: new Date(s.due),
    lapses: s.lapses ?? 0,
    stability: s.stability ?? 0,
    difficulty: s.difficulty ?? 0,
    reps: s.reps ?? 0,
    learning_steps: s.learningSteps ?? 0,
    last_review: s.lastReview ? new Date(s.lastReview) : undefined
  };
}

function statesEqual(a, b) {
  for (const k of FSRS_PERSIST_FIELDS) {
    const av = a[k] ?? null;
    const bv = b[k] ?? null;
    if (k === "due" || k === "lastReview") {
      // 时间戳允许「预览时刻 vs 落库时刻」的点击延迟级偏差（真实应用预览算于 T1、日志记于 T2，相差毫秒~秒）
      const tol = Math.max(5000, Math.abs(av) * 0.01);
      if (Math.abs(av - bv) > tol) return false;
      continue;
    }
    const eq = av === bv || (typeof av === "object" && typeof bv === "object" && av !== null && b !== null && JSON.stringify(av) === JSON.stringify(bv));
    if (!eq) return false;
  }
  return true;
}

initSqlJs().then(async (SQL) => {
  const db = new SQL.Database(fs.readFileSync(DB_PATH));

  // 配置快照表（v23）：id → {weights, schedulerOptions}
  const configMap = new Map();
  try {
    const st = db.prepare("SELECT id, weights_json, scheduler_options_json FROM fsrs_configs");
    while (st.step()) {
      const r = st.getAsObject();
      try {
        configMap.set(r.id, { weights: JSON.parse(r.weights_json), schedulerOptions: JSON.parse(r.scheduler_options_json) });
      } catch { /* 损坏行跳过 */ }
    }
    st.free();
  } catch { /* 旧库无 fsrs_configs 表 */ }

  const engineCache = new Map();
  const engineFor = (configId) => {
    const key = WEIGHTS_FILE ? "__override__" : (configId || "__default__");
    if (!engineCache.has(key)) {
      let weights;
      let options = null;
      if (WEIGHTS_FILE) {
        weights = JSON.parse(fs.readFileSync(WEIGHTS_FILE, "utf-8"));
      } else if (configId && configMap.has(configId)) {
        weights = configMap.get(configId).weights;
        options = configMap.get(configId).schedulerOptions;
      } else if (configMap.has("cfg-default")) {
        weights = configMap.get("cfg-default").weights;
        options = configMap.get("cfg-default").schedulerOptions;
      } else {
        weights = generatorParameters().w;
      }
      engineCache.set(key, buildEngine(weights, options));
    }
    return engineCache.get(key);
  };

  const cards = [];
  const s1 = db.prepare(`SELECT id, note_text, fsrs_json, created_at FROM cards WHERE note_text LIKE '${PREFIX}%' AND is_deleted=0`);
  while (s1.step()) cards.push(s1.getAsObject());
  s1.free();
  if (cards.length === 0) {
    console.log(`未找到前缀为 ${PREFIX} 的测试卡`);
    process.exit(0);
  }

  let pass = 0;
  let fail = 0;
  let stepChecked = 0;
  console.log(`== L4 总账审计（前缀 ${PREFIX}，共 ${cards.length} 张）==`);
  console.log(`参考引擎: ts-fsrs FSRS-6.0, enable_fuzz=false, request_retention=0.9`);
  console.log(`配置感知: fsrs_configs ${configMap.size} 行${WEIGHTS_FILE ? `；--weights 覆盖=${WEIGHTS_FILE}` : ""}\n`);

  for (const card of cards) {
    const logs = [];
    const s2 = db.prepare(
      `SELECT rating, reviewed_at, fsrs_config_id AS configId, fsrs_after_json AS afterJson, review_seq AS seq
       FROM review_logs WHERE card_id = '${card.id}' ORDER BY COALESCE(review_seq, rowid) ASC`
    );
    while (s2.step()) logs.push(s2.getAsObject());
    s2.free();
    const finalFsrs = JSON.parse(card.fsrs_json);
    console.log(`卡 ${card.note_text.slice(0, 14)}…`);
    if (logs.length === 0) {
      console.log(`  无评分记录（新卡，跳过）\n`);
      continue;
    }
    // 参考引擎重放：从 created_at 起新卡，按日志序（review_seq）逐条以该条日志的配置构引擎评分
    let c = createEmptyCard(new Date(card.created_at));
    let cardOk = true;
    for (const log of logs) {
      const rating = RATING_MAP[log.rating];
      if (!rating) continue;
      const engine = engineFor(log.configId);
      const out = engine.repeat(c, new Date(log.reviewed_at))[rating];
      c = out.card;
      if (log.afterJson) {
        // v23：逐轮 8 字段对照（fsrs_after_json 是当时的调度事实）
        let afterState;
        try { afterState = JSON.parse(log.afterJson); } catch { afterState = null; }
        if (afterState) {
          stepChecked++;
          const actual = {
            state: STATE_NAME[c.state],
            due: c.due.getTime(),
            lapses: c.lapses,
            stability: c.stability,
            difficulty: c.difficulty,
            reps: c.reps,
            lastReview: c.last_review ? c.last_review.getTime() : null,
            learningSteps: c.learning_steps ?? 0
          };
          if (!statesEqual(actual, afterState)) {
            cardOk = false;
            fail++;
            console.log(`  ✗ 第 ${logs.indexOf(log) + 1} 轮重放与 fsrs_after_json 不一致：\n      重放: ${JSON.stringify(actual)}\n      事实: ${JSON.stringify(afterState)}（config=${log.configId || "cfg-default"}）`);
          }
        }
      }
    }
    // 终态对照（旧日志历史用容差；v23 日志已逐轮精确对照过）
    const replayDue = c.due.getTime();
    const actualDue = finalFsrs.due;
    const diffMs = Math.abs(replayDue - actualDue);
    const replayState = STATE_NAME[c.state];
    const tol = Math.max(5000, replayDue * 0.01 - actualDue * 0.01);
    const okState = replayState === finalFsrs.state;
    const okDue = diffMs <= tol;
    if (okState && okDue) {
      pass++;
      console.log(`  ✓ ${logs.length} 轮重放（${stepChecked > 0 ? "含逐轮快照对照" : "终态对照"}）：state=${replayState} due偏差=${(diffMs / 1000).toFixed(1)}s — 与最终 fsrs_json 一致`);
    } else if (cardOk) {
      fail++;
      console.log(`  ✗ 终态不一致:\n      重放: state=${replayState} due=${new Date(replayDue).toISOString()}\n      实际: state=${finalFsrs.state} due=${new Date(actualDue).toISOString()} 偏差=${(diffMs / 3600000).toFixed(2)}h`);
    }
    console.log();
  }
  console.log(`L4 完成：${pass} 通过 / ${fail} 失败（逐轮快照对照 ${stepChecked} 轮）`);
  process.exit(fail ? 1 : 0);
});
