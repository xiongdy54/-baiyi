// L1 补强测试：长间隔往返连续性（F1 修复验证）
// v11 修复后：适配层全字段往返，长间隔调度应与黄金参考一致
// 运行：node tests/fsrs/adapter.long.test.cjs
const path = require("path");
const { execSync } = require("child_process");
const fs = require("fs");

// 每次运行前重新打包（确保测的是最新 fsrs.ts）
execSync("npx esbuild src/lib/fsrs.ts --bundle --platform=node --format=cjs --outfile=tests/fsrs/adapter.bundle.cjs", { cwd: path.join(__dirname, "..", "..") });
const { fsrsEngine } = require(path.join(__dirname, "adapter.bundle.cjs"));
const tsfs = require(path.join(__dirname, "..", "..", "node_modules", "ts-fsrs", "dist", "index.cjs"));
const { fsrs, generatorParameters, createEmptyCard, Rating } = tsfs;
const ref = fsrs(generatorParameters({ enable_fuzz: false }));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${detail}`); }
}

function goldenRebuild(s) {
  const base = createEmptyCard();
  const stateMap = { 0: 0, 1: 1, 2: 2, 3: 3, new: 0, learning: 1, review: 2, relearning: 3 };
  return {
    ...base,
    state: stateMap[s.state] ?? 0,
    due: new Date(s.dueAbs ?? s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    reps: s.reps,
    lapses: s.lapses ?? 0,
    last_review: s.lastReviewAbs ? new Date(s.lastReviewAbs) : undefined
  };
}

const now = Date.now();
const T0 = now - 40 * 86400000; // 40 天前开始

console.log("== 场景 A：Good×3 全程毕业链（黄金 S/D 逐轮增长），第 4 轮对照 ==");
// 黄金链：完整状态
let gCard = createEmptyCard(new Date(T0));
const gTimes = [T0];
const gStates = [];
for (let i = 0; i < 3; i++) {
  const out = ref.repeat(gCard, new Date(gTimes[i]))[Rating.Good];
  gCard = out.card;
  gTimes.push(gCard.due.getTime());
  gStates.push({ state: gCard.state, dueAbs: gCard.due.getTime(), stability: gCard.stability, difficulty: gCard.difficulty, reps: gCard.reps, lapses: gCard.lapses, lastReviewAbs: gCard.last_review ? gCard.last_review.getTime() : null });
}
console.log(`  黄金链终态: state=${["New","Learning","Review","Relearning"][gCard.state]} S=${gCard.stability.toFixed(2)} D=${gCard.difficulty.toFixed(2)} reps=${gCard.reps}`);

// 应用侧：完整黄金状态经「序列化往返」（模拟落库/读库，含全部 v11 字段）后驱动下一轮
const persisted = JSON.parse(JSON.stringify({
  state: ["new", "learning", "review", "relearning"][gStates[2].state],
  due: gStates[2].dueAbs,
  lapses: gStates[2].lapses,
  stability: gStates[2].stability,
  difficulty: gStates[2].difficulty,
  reps: gStates[2].reps,
  lastReview: gStates[2].lastReviewAbs
}));
// 第 4 轮：复习时刻 = 黄金 due（应用中 due 已过，用 now 模拟；两侧统一用 now）
const g4 = ref.repeat(goldenRebuild(gStates[2]), new Date(now))[Rating.Good];
const a4 = fsrsEngine.next(persisted, "Good");
const gIvl = g4.card.due.getTime() - now;
const aIvl = a4.fsrsState.due - now;
console.log(`  第4轮 Good 间隔: 黄金=${(gIvl / 86400000).toFixed(2)} 天 (S=${g4.card.stability.toFixed(2)}) | 应用=${(aIvl / 86400000).toFixed(2)} 天`);
const ratioA = aIvl / gIvl;
check(
  "场景A: 应用间隔与黄金间隔一致（比值∈[0.85,1.18]）",
  ratioA >= 0.85 && ratioA <= 1.18,
  `黄金=${(gIvl / 86400000).toFixed(2)}d 应用=${(aIvl / 86400000).toFixed(2)}d 比值=${ratioA.toFixed(3)}`
);
// 落库字段完整性（§11.1）
check(
  "场景A: 落库状态含全部 v11 字段（stability/difficulty/reps/lastReview）",
  a4.fsrsState.stability !== undefined && a4.fsrsState.difficulty !== undefined && a4.fsrsState.reps !== undefined && a4.fsrsState.lastReview !== undefined,
  `keys=${Object.keys(a4.fsrsState).join(",")}`
);
// reps 连续性：第 4 轮后 reps 应 = 黄金第4轮 reps
const g4reps = g4.card.reps;
check(
  "场景A: reps 连续（应用第4轮后 = 黄金第4轮）",
  a4.fsrsState.reps === g4reps,
  `黄金=${g4reps} 应用=${a4.fsrsState.reps}`
);

console.log("\n== 场景 B：Easy→8天间隔→Good（单一长间隔） ==");
let bCard = createEmptyCard(new Date(T0));
const b1 = ref.repeat(bCard, new Date(T0))[Rating.Easy].card;
// 两侧统一复习时刻 = now（卡早已逾期，elapsed 一致才是同输入）
const b2 = ref.repeat(b1, new Date(now))[Rating.Good].card;
const bPersisted = {
  state: "review",
  due: b1.due.getTime(),
  lapses: 0,
  stability: b1.stability,
  difficulty: b1.difficulty,
  reps: b1.reps,
  lastReview: b1.last_review ? b1.last_review.getTime() : null
};
const aB2 = fsrsEngine.next(bPersisted, "Good");
const gIvlB = b2.due.getTime() - now;
const aIvlB = aB2.fsrsState.due - now;
console.log(`  黄金: S=${b1.stability.toFixed(2)} → 第2轮间隔=${(gIvlB / 86400000).toFixed(2)} 天`);
console.log(`  应用: 全字段重建 → 第2轮间隔=${(aIvlB / 86400000).toFixed(2)} 天`);
const ratioB = aIvlB / gIvlB;
check(
  "场景B: 应用间隔与黄金间隔一致（比值∈[0.85,1.18]）",
  ratioB >= 0.85 && ratioB <= 1.18,
  `黄金=${(gIvlB / 86400000).toFixed(2)}d 应用=${(aIvlB / 86400000).toFixed(2)}d 比值=${ratioB.toFixed(3)}`
);

console.log("\n== 场景 C：fuzz 锁定关闭（§11.2） ==");
// 同一状态两次 preview，间隔文本必须完全一致（fuzz 关闭后引擎输出确定）
const p1 = fsrsEngine.preview(bPersisted);
const p2 = fsrsEngine.preview(bPersisted);
check(
  "场景C: 同状态两次 preview 输出一致（fuzz 已关）",
  JSON.stringify(p1) === JSON.stringify(p2),
  `p1=${JSON.stringify(p1.map((x) => x.dueText))} p2=${JSON.stringify(p2.map((x) => x.dueText))}`
);
// Easy 黄金 8 天应精确显示 8 天（无 fuzz 偏差）
const easyText = fsrsEngine.preview({ state: "new", due: Date.now(), lapses: 0 }).find((x) => x.rating === "Easy").dueText;
check("场景C: 新卡 Easy 预览 = 8 天（黄金值，无 fuzz 偏差）", easyText === "8 天", `实际=${easyText}`);

console.log(`\nL1-补强 完成：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
