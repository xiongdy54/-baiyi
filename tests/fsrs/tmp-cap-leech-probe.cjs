// 探针 3：两件事
//  (A) maximum_interval=36500 是否真能被越过（fifty-year P3d 的闰日链里出现过 ivl=36501）
//  (B) leech 计数：lapses 只在「review→Again 掉进 relearning」时 +1 吗？
//      若是，则一张「从未毕业的新卡」被 Again 无数次也永远不会成为 leech —— §8.7 六步失效
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const ts = require(path.join(ROOT, "node_modules", "ts-fsrs", "dist", "index.cjs"));
const { fsrsEngine } = require(path.join(__dirname, "adapter.fifty.bundle.cjs"));
const { FSRS6_DEFAULT_WEIGHTS: W, DEFAULT_SCHEDULER_OPTIONS: OPT } = require(path.join(ROOT, "electron", "fsrsConfig.js"));
const DAY = 86_400_000;
const MAX = OPT.maximumInterval;
console.log(`maximumInterval=${MAX}\n`);

console.log("== (A) 区间上限能否被越过：扫 S × 评分 × dt ==");
let over = [];
for (const S of [1e4, 5e4, 2e5, 1e6, 5e7]) {
  for (const rating of ["Good", "Easy"]) {
    for (const dt of [0, 1, 100, 3650]) {
      const at = Date.UTC(2030, 0, 1);
      const st = { state: "review", due: at, lapses: 0, stability: S, difficulty: 5, reps: 50, learningSteps: 0, lastReview: at - dt * DAY };
      let ivl = null, err = null;
      try { const o = fsrsEngine.next(st, rating, at); ivl = (o.fsrsState.due - at) / DAY; } catch (e) { err = e.message; }
      const flag = ivl != null && ivl > MAX;
      if (flag) over.push({ S, rating, dt, ivl });
      console.log(`  S=${String(S).padEnd(8)} ${rating.padEnd(5)} dt=${String(dt).padEnd(5)} → ivl=${ivl == null ? "ERR" : ivl.toFixed(2).padStart(10)} ${flag ? "<<< 超上限" : ""} ${err ?? ""}`);
    }
  }
}
console.log(`\n  超上限样本 ${over.length} 个${over.length ? "：" + JSON.stringify(over.slice(0, 5)) : ""}`);

console.log("\n== (A2) 纯 ts-fsrs 侧对照：next_interval 的钳制 ==");
const eng = ts.fsrs(ts.generatorParameters({ enable_fuzz: false }));
for (const S of [1e4, 1e5, 1e6, 1e8]) {
  console.log(`  S=${String(S).padEnd(9)} ts-fsrs.next_interval(S,0.9)=${eng.next_interval(S, 0.9)}  (上限 ${MAX})`);
}

console.log("\n== (B) lapses 计数语义 ==");
function chain(label, startState, ratings) {
  let s = startState;
  const trace = [];
  let at = Date.UTC(2030, 0, 1);
  for (const r of ratings) {
    at = Math.max(at, s.due);
    const o = fsrsEngine.next(s, r, at);
    const prev = s.state;
    s = JSON.parse(JSON.stringify(o.fsrsState));
    trace.push(`${prev}+${r[0]}→${s.state}(L${s.lapses})`);
    at = s.due;
  }
  console.log(`  ${label}\n    ${trace.join(" → ")}`);
  return s;
}
const newCard = { state: "new", due: Date.UTC(2030, 0, 1), lapses: 0 };
const graduated = { state: "review", due: Date.UTC(2030, 0, 1), lapses: 0, stability: 20, difficulty: 5, reps: 8, learningSteps: 0, lastReview: Date.UTC(2030, 0, 1) - 20 * DAY };

chain("B1 新卡连输 30 次 Again（从未毕业）", newCard, Array(30).fill("Again"));
chain("B2 已毕业卡：Good 后连输 3 次 Again（应各计 1 次 lapse）", graduated, ["Good", "Again", "Again", "Again"]);
chain("B3 已毕业卡：反复「毕业→遗忘」6 轮（leech 阈值 8）", graduated,
  Array(6).fill(0).flatMap(() => ["Good", "Again"]));
const b3 = chain("B4 反复毕业→遗忘 10 轮", graduated, Array(10).fill(0).flatMap(() => ["Good", "Again"]));
console.log(`\n  B4 末态 lapses=${b3.lapses} → isLeech(lapses,8)=${b3.lapses >= 8}`);

console.log("\n== (B5) 新卡永久 Again 场景下的 leech 判定（§8.7 声称自动暂停） ==");
let n = newCard, at = newCard.due;
for (let i = 0; i < 500; i++) { at = Math.max(at, n.due); n = JSON.parse(JSON.stringify(fsrsEngine.next(n, "Again", at).fsrsState)); }
console.log(`  Again×500 后：state=${n.state} lapses=${n.lapses} reps=${n.reps} stability=${n.stability}`);
console.log(`  isLeech(${n.lapses}, 8) = ${n.lapses >= 8}  → ${n.lapses >= 8 ? "会被标 leech" : "永远不会被标 leech（六步流程不触发）"}`);
