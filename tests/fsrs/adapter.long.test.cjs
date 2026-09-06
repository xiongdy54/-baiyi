// L1 补强测试：丢字段失真的决定性场景
// 原理：短期学习步骤（分钟级）不依赖 S/D，只有间隔≥1天的 Review 态调度才依赖。
// 本测试构造「已毕业 30 天的 Review 卡」再评 Good，对比应用适配层 vs 黄金参考的下一间隔。
// 运行：node tests/fsrs/adapter.long.test.cjs
const path = require("path");
const fs = require("fs");
const { fsrsEngine } = require(path.join(__dirname, "adapter.bundle.cjs"));
const tsfs = require(path.join(__dirname, "..", "..", "node_modules", "ts-fsrs", "dist", "index.cjs"));
const { fsrs, generatorParameters, createEmptyCard, Rating } = tsfs;
const ref = fsrs(generatorParameters({ enable_fuzz: false }));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${detail}`); }
}

// 黄金侧：构造「Good×3 全程完整状态」的真实 Review 卡（S/D 由库逐轮算出）
function goldenChain(seq, startMs) {
  let card = createEmptyCard();
  let at = startMs;
  const states = [];
  for (const r of seq) {
    const out = ref.repeat(card, new Date(at))[Rating[r]];
    card = out.card;
    states.push({ state: card.state, dueAbs: card.due.getTime(), stability: card.stability, difficulty: card.difficulty, reps: card.reps, lapses: card.lapses, lastReviewAbs: card.last_review ? card.last_review.getTime() : null });
    at = card.due.getTime();
  }
  return states;
}

const now = Date.now();
const T0 = now - 40 * 86400000; // 40 天前开始

console.log("== 场景 A：Good→Good→Good 全程毕业链（黄金 S/D 逐轮增长）==");
const chainA = goldenChain(["Good", "Good", "Good"], T0);
// 黄金第3轮后的状态（应为 Review 态、S≈15 天级）
const g3 = chainA[2];
console.log(`  黄金链终态: state=${["New","Learning","Review","Relearning"][g3.state]} S=${g3.stability.toFixed(2)} D=${g3.difficulty.toFixed(2)} reps=${g3.reps}`);

// 应用侧：拿同样的链，但每轮复习后只保留应用会持久化的字段（state/due/lapses/lastReview）
function appChain(seq, startMs) {
  let st = { state: "new", due: startMs, lapses: 0 };
  const kept = [];
  for (const r of seq) {
    const out = fsrsEngine.next(st, r);
    st = out.fsrsState;
    kept.push(st);
  }
  return kept;
}
// 黄金链的轮次时刻
function chainTimes(seq, startMs) {
  let card = createEmptyCard();
  let at = startMs;
  const times = [startMs];
  for (const r of seq) {
    const out = ref.repeat(card, new Date(at))[Rating[r]];
    card = out.card;
    times.push(card.due.getTime());
    at = card.due.getTime();
  }
  return times;
}
const timesA = chainTimes(["Good", "Good", "Good"], T0);
// 应用侧第1轮在 T0、第2轮在黄金due1、第3轮在黄金due2（时间对齐，只让状态不同）
const appA = [];
let st = { state: "new", due: timesA[0], lapses: 0 };
for (let i = 0; i < 3; i++) {
  const out = fsrsEngine.next(st, "Good");
  appA.push(out.fsrsState);
  st = { state: out.fsrsState.state, due: timesA[i + 1], lapses: out.fsrsState.lapses ?? 0 };
}
// 第4轮（第30+天复习）：黄金 vs 应用
const g4 = ref.repeat(goldenRebuild(chainA[2]), new Date(timesA[3]))[Rating.Good];
function goldenRebuild(s) {
  const base = createEmptyCard();
  const stateMap = { 0: 0, 1: 1, 2: 2, 3: 3, new: 0, learning: 1, review: 2, relearning: 3 };
  return { ...base, state: stateMap[s.state] ?? 0, due: new Date(s.dueAbs ?? s.due), stability: s.stability, difficulty: s.difficulty, reps: s.reps, lapses: s.lapses ?? 0, last_review: s.lastReviewAbs ? new Date(s.lastReviewAbs) : undefined };
}
const a4 = fsrsEngine.next({ state: "review", due: timesA[3], lapses: 0 }, "Good");
const gIvl = g4.card.due.getTime() - timesA[3];
const aIvl = a4.fsrsState.due - Date.now();
console.log(`  第4轮 Good 间隔: 黄金=${(gIvl / 86400000).toFixed(2)} 天 (S=${g4.card.stability.toFixed(2)}) | 应用=${(aIvl / 86400000).toFixed(2)} 天`);
console.log(`  应用重建时使用的状态: state=review due=timesA[3] lapses=0 —— S/D/reps/lastReview 全部缺失`);
const ratioA = aIvl / gIvl;
check(
  "场景A: 应用间隔与黄金间隔一致（比值∈[0.85,1.18]）",
  ratioA >= 0.85 && ratioA <= 1.18,
  `黄金=${(gIvl / 86400000).toFixed(2)}d 应用=${(aIvl / 86400000).toFixed(2)}d 比值=${ratioA.toFixed(3)} —— 偏离即证明丢字段导致调度失真`
);

console.log("\n== 场景 B：Easy→30天后 Good（单一长间隔）==");
const chainB = goldenChain(["Easy"], T0);
const gB = chainB[0];
const timesB = [T0, gB.dueAbs];
const gB2 = ref.repeat(goldenRebuild(gB), new Date(timesB[1]))[Rating.Good];
const aB2 = fsrsEngine.next({ state: "review", due: timesB[1], lapses: 0 }, "Good");
const gIvlB = gB2.card.due.getTime() - timesB[1];
const aIvlB = aB2.fsrsState.due - Date.now();
console.log(`  黄金: S=${gB.stability.toFixed(2)} → 第2轮间隔=${(gIvlB / 86400000).toFixed(2)} 天`);
console.log(`  应用: 重建时 S 缺失 → 第2轮间隔=${(aIvlB / 86400000).toFixed(2)} 天`);
const ratioB = aIvlB / gIvlB;
check(
  "场景B: 应用间隔与黄金间隔一致（比值∈[0.85,1.18]）",
  ratioB >= 0.85 && ratioB <= 1.18,
  `黄金=${(gIvlB / 86400000).toFixed(2)}d 应用=${(aIvlB / 86400000).toFixed(2)}d 比值=${ratioB.toFixed(3)}`
);

console.log(`\nL1-补强 完成：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
