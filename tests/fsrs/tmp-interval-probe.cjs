// 定点探针：应用侧（ts-fsrs）与官方 Rust FSRS 在「长档建议区间」上的分歧到底是什么
// 背景：fifty-year.test.cjs P1 显示 stability/difficulty 相对误差 ~1e-6，但 ~8% 轮次的
//       interval 不等（样例 appIvl=3 / rsIvl=1.791 而 appS=rsS=1.7914）。
// 判据：FSRS 定义 S = 「R=request_retention 时的间隔」，故 R=0.9 时 next_interval(S) 必须 ≈ S。
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const ts = require(path.join(ROOT, "node_modules", "ts-fsrs", "dist", "index.cjs"));
const { fsrsEngine } = require(path.join(__dirname, "adapter.fifty.bundle.cjs"));
const rs = require("fsrs-rs-nodejs");
const { FSRS6_DEFAULT_WEIGHTS: W, DEFAULT_SCHEDULER_OPTIONS: OPT } = require(path.join(ROOT, "electron", "fsrsConfig.js"));
const DAY = 86_400_000, HOUR = 3_600_000;
const T0 = Date.UTC(2030, 0, 1);

const CURVE = ts.computeDecayFactor(W);
console.log(`computeDecayFactor(w) = ${JSON.stringify(CURVE)}  (w[20]=${W[20]})`);
const analytic = (S, R) => ((Math.pow(R, 1 / CURVE.decay) - 1) / CURVE.factor) * S;
console.log(`解析式 I(S,R)=((R^(1/decay)-1)/factor)*S；自检 I(10,0.9)=${analytic(10, 0.9).toFixed(4)}（应≈10）\n`);

const rsEngine = new rs.FSRS(W);
const STEPS = [1.2, 1.7914, 2, 3, 5, 8.5, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181];
console.log("S        | app 链 due间隔 | rs.nextInterval | rs.nextStates.ivl | 解析式    | ts-fsrs next_interval | 判定");
console.log("-".repeat(104));
let disagree = 0;
for (const S of STEPS) {
  // 应用侧：构造一张 review 态卡，Good 评分，看实际落库间隔
  const state = { state: "review", due: T0, lapses: 0, stability: S, difficulty: 5, reps: 10, learningSteps: 0, lastReview: T0 - 3 * DAY };
  const out = fsrsEngine.next(state, "Good", T0);
  const appIvl = (out.fsrsState.due - T0) / DAY;
  const ms = new rs.MemoryState(S, 5);
  const ri = rsEngine.nextInterval(S, OPT.requestRetention, 3);
  const ns = rsEngine.nextStates(ms, OPT.requestRetention, 3);
  const anal = analytic(S, OPT.requestRetention);
  const tf = ts.fsrs(ts.generatorParameters({ enable_fuzz: false }));
  const tsIvl = tf.next_interval(S, OPT.requestRetention);
  const ok = Math.abs(appIvl - ri) <= 1.0001 && Math.abs(ri - anal) <= 0.05 * Math.max(1, anal);
  if (!ok) disagree++;
  console.log(
    `${S.toFixed(4).padEnd(8)} | ${appIvl.toFixed(3).padStart(14)} | ${Number(ri).toFixed(3).padStart(15)} | ${Number(ns.good.interval).toFixed(3).padStart(17)} | ${anal.toFixed(3).padStart(9)} | ${String(tsIvl).padStart(21)} | ${ok ? "一致" : "<<< 分歧"}`
  );
}
console.log(`\n分歧 ${disagree}/${STEPS.length}`);

console.log("\n== request_retention 敏感性（S=10，各留存目标下 app vs rust 区间） ==");
for (const rr of [0.7, 0.8, 0.85, 0.9, 0.95]) {
  const engRR = ts.fsrs(ts.generatorParameters({ enable_fuzz: false, request_retention: rr }));
  const st = { state: "review", due: T0, lapses: 0, stability: 10, difficulty: 5, reps: 10, learningSteps: 0, lastReview: T0 - 3 * DAY };
  const app = (fsrsEngine.next(st, "Good", T0).fsrsState.due - T0) / DAY;
  const tsi = engRR.next_interval(10, rr);
  const rsi = rsEngine.nextInterval(10, rr, 3);
  console.log(`  R=${rr}  app链=${app.toFixed(3)}  ts-fsrs.next_interval=${tsi}  rust.nextInterval=${Number(rsi).toFixed(3)}`);
}

console.log("\n== 时钟回拨 / due 在未来：负 delta_t 的真实后果 ==");
const cases = [
  ["正常前滚", 400 * DAY],
  ["回拨 1 天", -DAY],
  ["回拨 1 年", -365 * DAY],
  ["回拨 100 年（存量超远 due + 改表）", -36500 * DAY],
];
for (const [label, off] of cases) {
  const st = { state: "review", due: T0, lapses: 0, stability: 20, difficulty: 5, reps: 10, learningSteps: 0, lastReview: T0 };
  const at = T0 + off;
  try {
    const o = fsrsEngine.next(st, "Good", at);
    console.log(`  ${label.padEnd(30)} → ok  interval=${((o.fsrsState.due - at) / DAY).toFixed(2)}d  state=${o.fsrsState.state}`);
  } catch (e) {
    console.log(`  ${label.padEnd(30)} → THROW ${e.constructor.name}: ${e.message}`);
  }
}
console.log("\n== 同一异常在 preview()（复习界面四档预览）下是否也抛 ==");
try {
  fsrsEngine.preview({ state: "review", due: T0, lapses: 0, stability: 20, difficulty: 5, reps: 10, lastReview: T0 }, T0 - 400 * DAY);
  console.log("  preview 未抛错");
} catch (e) { console.log(`  preview THROW ${e.constructor.name}: ${e.message}`); }
