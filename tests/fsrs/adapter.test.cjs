// L1 引擎封装层测试 — 验证 src/lib/fsrs.ts 适配层 vs 黄金参考
// 核心问题：连续复习时，落库状态重建的卡片能否产生与「完整 FSRS 状态」一致的调度？
// 运行：node tests/fsrs/adapter.test.cjs
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

// 保证 bundle 是最新（若不存在则现场打包）
const bundlePath = path.join(__dirname, "adapter.bundle.cjs");
if (!fs.existsSync(bundlePath)) {
  execSync("npx esbuild src/lib/fsrs.ts --bundle --platform=node --format=cjs --outfile=tests/fsrs/adapter.bundle.cjs", { cwd: path.join(__dirname, "..", "..") });
}
const { fsrsEngine } = require(bundlePath);
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, "golden.json"), "utf-8"));
const tsfs = require(path.join(__dirname, "..", "..", "node_modules", "ts-fsrs", "dist", "index.cjs"));
const { fsrs, generatorParameters, createEmptyCard, Rating } = tsfs;
const ref = fsrs(generatorParameters({ enable_fuzz: false }));

let pass = 0, fail = 0;
const rows = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${detail}`); }
}

console.log("== L1-1 评分映射（GRADE_MAP）==");
// 通过 next() 的输出反推映射是否正确：新卡 Easy 必然毕业（Review/1d）说明 Easy=4
const T0 = golden.baseTime;
// 新卡用 due≈now 构造（与 createEmptyCard 一致）；过去的 due 会让 elapsed_days 巨大（这是 FSRS 正确行为，不是缺陷）
function simNext(stateJson, rating, atMs) {
  return fsrsEngine.next(stateJson, rating);
}
const nowMs = Date.now();
const newCard = { state: "new", due: nowMs, lapses: 0 };
const rEasy = simNext(newCard, "Easy", nowMs);
check("Easy → Review 状态（=4 映射正确）", rEasy.fsrsState.state === "review", `state=${rEasy.fsrsState.state}`);
const rAgain = simNext(newCard, "Again", nowMs);
check("Again → Learning 且 +1m（=1 映射正确）", rAgain.fsrsState.state === "learning" && Math.abs(rAgain.fsrsState.due - nowMs - 60_000) < 5_000, `state=${rAgain.fsrsState.state} dueOffset=${rAgain.fsrsState.due - nowMs}`);

console.log("== L1-2 首轮复习 vs 黄金（新卡，容差 0——无历史状态参与）==");
// 用 T0 作为 now 直接调用 next()——但 next 内部用 new Date()，无法注入时间。
// 因此改为「结构对照」：首轮只比对 state 与间隔档位（分钟级 due 由 formatInterval 呈现，不影响落库结构）
function firstRoundStructural(ratingName, g) {
  const out = simNext({ state: "new", due: Date.now(), lapses: 0 }, ratingName, Date.now());
  const st = out.fsrsState;
  const gs = g.rounds[0];
  check(
    `${ratingName}: state 一致（应用=${st.state} 黄金=${gs.state}）`,
    st.state === gs.state.toLowerCase(),
    `期望 ${gs.state.toLowerCase()}，实际 ${st.state}`
  );
  check(
    `${ratingName}: lapses 一致`,
    (st.lapses ?? 0) === gs.lapses,
    `期望 ${gs.lapses}，实际 ${st.lapses}`
  );
  return st;
}
firstRoundStructural("Again", golden.scripts["new-Again"]);
firstRoundStructural("Hard", golden.scripts["new-Hard"]);
firstRoundStructural("Good", golden.scripts["new-Good"]);
firstRoundStructural("Easy", golden.scripts["new-Easy"]);

console.log("== L1-3 往返连续性（核心：落库状态重建后第二轮是否仍符合 FSRS）==");
// 方案：不依赖真实时间——直接模拟应用的持久化往返：
//   轮1: next(新卡) → fsrsState1（应用会 JSON.stringify 存库）
//   轮2: next(fsrsState1) → fsrsState2
// 黄金侧用完整状态跑参考引擎。对比「轮2 的调度间隔」。
// 由于 next() 内部 now=new Date() 不可注入，间隔对比用「比值」：
//   应用间隔 / 黄金间隔 —— 丢 S/D 导致的失真会体现为显著偏离 1。
function goldenRebuild(s) {
  const base = createEmptyCard();
  const stateMap = { new: 0, learning: 1, review: 2, relearning: 3 };
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
function goldenNext(gs, rating, atMs) {
  const card = goldenRebuild(gs);
  const out = ref.repeat(card, new Date(atMs))[Rating[rating]];
  return { state: out.card.state, dueOffsetMs: out.card.due.getTime() - atMs, stability: out.card.stability, difficulty: out.card.difficulty, reps: out.card.reps };
}

// 剧本: good-x3 第2、3轮；hard-chain 第2轮；forget-chain 第3轮（Again 后）；easy-chain 第2轮
const scenarios = [
  { script: "good-x3", roundIdx: 1, rating: "Good" },
  { script: "good-x3", roundIdx: 2, rating: "Good" },
  { script: "hard-chain", roundIdx: 1, rating: "Hard" },
  { script: "forget-chain", roundIdx: 2, rating: "Good" },
  { script: "easy-chain", roundIdx: 1, rating: "Good" }
];

for (const sc of scenarios) {
  const g = golden.scripts[sc.script];
  // 应用侧：从「黄金轮 N 的状态」中抽取应用会持久化的字段（state/due/lapses/lastReview）
  const gRound = g.rounds[sc.roundIdx - 1];
  const persistedState = {
    state: gRound.state.toLowerCase(),
    due: Date.now() - 1000, // 模拟「到期后复习」：due 刚过
    lapses: gRound.lapses,
    lastReview: gRound.lastReviewAbs
  };
  // 黄金侧：完整状态 + 与应用相同的复习时刻
  const goldenOut = goldenNext(gRound, sc.rating, Date.now());
  const appOut = simNext(persistedState, sc.rating, Date.now());
  const gIvl = goldenOut.dueOffsetMs;
  const aIvl = appOut.fsrsState.due - Date.now();
  const ratio = gIvl > 0 ? aIvl / gIvl : 1;
  const ok = Math.abs(ratio - 1) < 0.15 || (gIvl < 2.5 * 86400000 && Math.abs(aIvl - gIvl) < 60_000);
  rows.push({ scenario: `${sc.script}#${sc.roundIdx} ${sc.rating}`, goldenIvlDays: (gIvl / 86400000).toFixed(3), appIvlDays: (aIvl / 86400000).toFixed(3), ratio: ratio.toFixed(3), goldenS: goldenOut.stability?.toFixed(3), verdict: ok ? "PASS" : "FAIL" });
  check(
    `${sc.script} 第${sc.roundIdx + 1}轮 ${sc.rating}: 应用间隔 ≈ 黄金间隔`,
    ok,
    `黄金=${(gIvl / 86400000).toFixed(3)}天 (S=${goldenOut.stability?.toFixed(3)}) 应用=${(aIvl / 86400000).toFixed(3)}天 比值=${ratio.toFixed(3)}（应用重建时 S=${goldenRebuild(persistedState).stability} D=${goldenRebuild(persistedState).difficulty}，黄金 S=${gRound.stability} D=${gRound.difficulty}）`
  );
}

console.log("\n== L1-4 量化失真表（应用重建状态 vs 完整 FSRS 状态）==");
console.log("剧本轮次 | 黄金间隔(天) | 应用间隔(天) | 比值 | 黄金S | 判定");
for (const r of rows) console.log(`${r.scenario} | ${r.goldenIvlDays} | ${r.appIvlDays} | ${r.ratio} | ${r.goldenS} | ${r.verdict}`);

console.log(`\nL1 完成：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
