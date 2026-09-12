// L0 黄金参考基准 — 以 ts-fsrs 5.4.2 原库（enable_fuzz:false）为规范
// 产出 golden.json：各剧本每轮的黄金状态（state/due 偏移/间隔/字面间隔文本）
// 运行：node tests/fsrs/golden.cjs
const path = require("path");
const fs = require("fs");
const tsfs = require(path.join(__dirname, "..", "..", "node_modules", "ts-fsrs", "dist", "index.cjs"));

const { fsrs, generatorParameters, createEmptyCard, Rating, State } = tsfs;

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push({ name, expected, actual }); console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}

console.log("== L0-1 参数基线（应用 generatorParameters({enable_fuzz:false}) 与库默认对照）==");
// v20 纠正：应用自 v11 起锁定 enable_fuzz=false（§4.4.2），此前此处断言的 fuzz=true 是 v11 修复前残留
const appParams = generatorParameters({ enable_fuzz: false });
const defParams = generatorParameters();
check("request_retention=0.9", appParams.request_retention === 0.9, 0.9, appParams.request_retention);
check("maximum_interval=36500", appParams.maximum_interval === 36500, 36500, appParams.maximum_interval);
check("enable_fuzz=false（§4.4.2 锁定）", appParams.enable_fuzz === false, false, appParams.enable_fuzz);
check("enable_short_term=true", appParams.enable_short_term === true, true, appParams.enable_short_term);
check("learning_steps=[1m,10m]", JSON.stringify(appParams.learning_steps) === JSON.stringify(["1m", "10m"]), ["1m", "10m"], appParams.learning_steps);
check("relearning_steps=[10m]", JSON.stringify(appParams.relearning_steps) === JSON.stringify(["10m"]), ["10m"], appParams.relearning_steps);
const wCount = appParams.w.length;
check("FSRS-6 默认 21 权重", wCount === 21, 21, wCount);
check("权重与库默认一致", JSON.stringify(appParams.w) === JSON.stringify(defParams.w), "default w", "app w");

// 参考引擎：关掉 fuzz，输出确定值；间隔≥2.5天时同时给出 fuzz 区间供 L1-L4 容差判定
const ref = fsrs(generatorParameters({ enable_fuzz: false }));

function stepCard(prevState, ratingName, atMs) {
  const card = prevState ? rebuild(prevState) : createEmptyCard();
  const at = new Date(atMs);
  const out = ref.repeat(card, at)[Rating[ratingName]];
  const c = out.card;
  return {
    state: ["New", "Learning", "Review", "Relearning"][c.state],
    dueAbs: c.due.getTime(),
    dueOffsetMs: c.due.getTime() - atMs,
    stability: c.stability,
    difficulty: c.difficulty,
    reps: c.reps,
    lapses: c.lapses,
    lastReviewAbs: c.last_review ? c.last_review.getTime() : null,
    scheduledDays: c.scheduled_days,
    elapsedDays: c.elapsed_days
  };
}

// 复刻应用 toFsrsCard 的重建方式（这正是被测实现）——但 L0 黄金值用完整字段重建，
// 以区分「库的正确输出」与「应用因丢字段导致的偏差」
function rebuild(s) {
  const base = createEmptyCard();
  const stateMap = { New: 0, Learning: 1, Review: 2, Relearning: 3 };
  return {
    ...base,
    state: stateMap[s.state] ?? 0,
    due: new Date(s.dueAbs),
    stability: s.stability,
    difficulty: s.difficulty,
    reps: s.reps,
    lapses: s.lapses,
    last_review: s.lastReviewAbs ? new Date(s.lastReviewAbs) : undefined
  };
}

const T0 = 1735689600000; // 固定基准时刻，保证黄金值可复现（2025-01-01T00:00:00Z）

console.log("== L0-2 黄金剧本 ==");
const scripts = [
  { name: "new-Again", seq: ["Again"] },
  { name: "new-Hard", seq: ["Hard"] },
  { name: "new-Good", seq: ["Good"] },
  { name: "new-Easy", seq: ["Easy"] },
  { name: "good-x3", seq: ["Good", "Good", "Good"] },
  { name: "forget-chain", seq: ["Good", "Good", "Again", "Good", "Good"] },
  { name: "hard-chain", seq: ["Good", "Hard", "Hard", "Good"] },
  { name: "easy-chain", seq: ["Good", "Easy", "Good", "Easy"] },
  { name: "crammer-relearn", seq: ["Good", "Again", "Again", "Good", "Good"] }
];
const golden = { generatedAt: new Date().toISOString(), baseTime: T0, params: { request_retention: appParams.request_retention, learning_steps: appParams.learning_steps, relearning_steps: appParams.relearning_steps, w: appParams.w }, scripts: {} };

for (const sc of scripts) {
  const rounds = [];
  let st = null;
  for (const rating of sc.seq) {
    st = stepCard(st, rating, st ? st.dueAbs : T0);
    rounds.push({ rating, ...st });
  }
  golden.scripts[sc.name] = { seq: sc.seq, rounds };
  console.log(`  ${sc.name}: ${sc.seq.join("→")} 终态 state=${st.state} 间隔=${(st.dueOffsetMs / 86400000).toFixed(3)}d S=${st.stability.toFixed(3)} D=${st.difficulty.toFixed(3)} reps=${st.reps}`);
}

console.log("== L0-3 learning steps 的 due 转移（分钟级）==");
const g = golden.scripts;
check("新卡 Again → +1m", g["new-Again"].rounds[0].dueOffsetMs === 60_000, 60_000, g["new-Again"].rounds[0].dueOffsetMs);
check("新卡 Again → state=Learning", g["new-Again"].rounds[0].state === "Learning", "Learning", g["new-Again"].rounds[0].state);
check("新卡 Good → +10m", g["new-Good"].rounds[0].dueOffsetMs === 600_000, 600_000, g["new-Good"].rounds[0].dueOffsetMs);
check("新卡 Hard → +6m（FSRS-6 learning steps 档位折算）", g["new-Hard"].rounds[0].dueOffsetMs === 360_000, 360_000, g["new-Hard"].rounds[0].dueOffsetMs);
check("新卡 Easy → 直接毕业 Review(1d)", g["new-Easy"].rounds[0].state === "Review", "Review", g["new-Easy"].rounds[0].state);

const outPath = path.join(__dirname, "golden.json");
fs.writeFileSync(outPath, JSON.stringify(golden, null, 2));
console.log(`\n黄金值已写入 ${outPath}`);
console.log(`L0 完成：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
