// 探针：FSRS-6 自由参数 w[20]（decay）在参数空间的边界值下，应用侧调度链会产出什么
// 依据：ts-fsrs computeDecayFactor(w) => decay = -w[20]; factor = exp(ln0.9/decay)-1
//      electron/optimizer.js validateWeights 只校验「21 维 + Number.isFinite」
//      src/lib/fsrs.ts buildEngineFromConfig 同样只校验「21 维 + Number.isFinite」
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const ts = require(path.join(ROOT, "node_modules", "ts-fsrs", "dist", "index.cjs"));
const { fsrs, generatorParameters, createEmptyCard, Rating } = ts;
const APP_W = require(path.join(ROOT, "electron", "fsrsConfig.js")).FSRS6_DEFAULT_WEIGHTS;

const CANDIDATES = {
  "默认 0.1542": 0.1542,
  "0": 0,
  "-0": -0,
  "1e-9": 1e-9,
  "1e-300": 1e-300,
  "-0.5": -0.5,
  "3": 3,
  "NaN": NaN,
  "Infinity": Infinity,
};

console.log("== generatorParameters 是否守门 ==");
for (const [label, v] of Object.entries(CANDIDATES)) {
  const w = APP_W.slice();
  w[20] = v;
  let g;
  try {
    const p = generatorParameters({ enable_fuzz: false, w });
    g = `接受 (w[20]=${p.w[20]})`;
  } catch (e) { g = `拒绝: ${e.message}`; }
  let cdf;
  try { cdf = JSON.stringify(ts.computeDecayFactor(w)); } catch (e) { cdf = "throw"; }
  console.log(`  w[20]=${String(label).padEnd(10)} genParams=${g.padEnd(26)} computeDecayFactor=${cdf}`);
}

console.log("\n== 引擎实跑 10 次 Good（新卡） ==");
for (const [label, v] of Object.entries(CANDIDATES)) {
  const w = APP_W.slice();
  w[20] = v;
  let line = `  w[20]=${String(label).padEnd(10)}`;
  try {
    const e = fsrs(generatorParameters({ enable_fuzz: false, w }));
    let c = createEmptyCard(new Date(Date.UTC(2026, 0, 1)));
    const ivls = [];
    for (let i = 0; i < 10; i++) {
      const at = new Date(c.due.getTime());
      const r = e.repeat(c, at)[Rating.Good];
      c = r.card;
      ivls.push(+((c.due.getTime() - at.getTime()) / 86400000).toFixed(4));
    }
    line += ` S=${Number(c.stability).toFixed(4)} D=${Number(c.difficulty).toFixed(4)} ivl=${ivls.slice(0, 5).join(",")}…`;
    if (ivls.some((x) => !Number.isFinite(x))) line += "   <<< 非有限区间";
  } catch (err) { line += ` THROW ${err.message}`; }
  console.log(line);
}

console.log("\n== fsrs.ts 落库形状（fromFsrsCard 写进 fsrs_json 的内容） ==");
for (const v of [0.1542, 0, 1e-9, -0.5, Infinity, NaN]) {
  const w = APP_W.slice();
  w[20] = v;
  try {
    const e = fsrs(generatorParameters({ enable_fuzz: false, w }));
    let c = createEmptyCard(new Date(Date.UTC(2026, 0, 1)));
    for (let i = 0; i < 5; i++) c = e.repeat(c, new Date(c.due.getTime()))[Rating.Good].card;
    const persist = { state: "review", due: c.due.getTime(), stability: c.stability, difficulty: c.difficulty, reps: c.reps, learningSteps: c.learning_steps };
    const json = JSON.stringify(persist);
    const roundTripped = JSON.parse(json);
    const poisoned = !Number.isFinite(roundTripped.due) || !Number.isFinite(roundTripped.stability);
    console.log(`  w[20]=${String(v).padEnd(8)} ${json}`);
    if (poisoned) console.log(`              <<< 毒化：due/stability 非有限，JSON 往返后为 ${roundTripped.due}/${roundTripped.stability} → 卡片永久不可调度`);
  } catch (err) { console.log(`  w[20]=${String(v).padEnd(8)} THROW ${err.message}`); }
}

console.log("\n== 官方 Rust 侧同参数下的表现（异源对照） ==");
const rs = require("fsrs-rs-nodejs");
for (const v of [0.1542, 0, -0.5]) {
  const w = APP_W.slice();
  w[20] = v;
  try {
    const f = new rs.FSRS(w);
    const ns = f.nextStates(new rs.MemoryState(5, 5), 0.9, 5);
    console.log(`  w[20]=${String(v).padEnd(8)} rust good.interval=${ns.good.interval} S=${ns.good.memory.stability} D=${ns.good.memory.difficulty}`);
  } catch (e) { console.log(`  w[20]=${String(v).padEnd(8)} rust THROW ${e.message}`); }
}
