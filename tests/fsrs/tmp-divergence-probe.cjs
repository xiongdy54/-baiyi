// 定点探针 2：app 与官方 Rust 的 interval 在什么条件下分歧
// 背景：tmp-interval-probe 显示「标准路径」（review 态、dt≥3、正常前滚）两侧一致；
//       fifty-year P1 却在 ~8% 轮次上不等（样例 dt=1、appIvl=3 vs rsIvl=1.791）。
// 本探针扫 state × dt × 是否提前复习，把分歧条件钉死。
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const ts = require(path.join(ROOT, "node_modules", "ts-fsrs", "dist", "index.cjs"));
const { fsrsEngine } = require(path.join(__dirname, "adapter.fifty.bundle.cjs"));
const rs = require("fsrs-rs-nodejs");
const { FSRS6_DEFAULT_WEIGHTS: W, DEFAULT_SCHEDULER_OPTIONS: OPT } = require(path.join(ROOT, "electron", "fsrsConfig.js"));
const DAY = 86_400_000;
const T0 = Date.UTC(2030, 0, 1, 12, 0);
const rsE = new rs.FSRS(W);

const rows = [];
for (const state of ["review", "learning", "relearning", "new"]) {
  for (const S of [1.7914, 5, 20]) {
    for (const dt of [0, 1, 2, 3, 7]) {
      const last = T0 - dt * DAY;
      const st = {
        state, due: T0, lapses: 1,
        stability: state === "new" ? undefined : S,
        difficulty: state === "new" ? undefined : 5,
        reps: state === "new" ? 0 : 4,
        learningSteps: state === "learning" ? 1 : 0,
        lastReview: state === "new" ? null : last,
      };
      let appIvl, appS, err = null;
      try {
        const o = fsrsEngine.next(st, "Good", T0);
        appIvl = (o.fsrsState.due - T0) / DAY;
        appS = o.fsrsState.stability;
      } catch (e) { err = e.message; }
      const ms = state === "new" || S === undefined ? null : new rs.MemoryState(S, 5);
      let rsIvl = null, rsS = null;
      try {
        const ns = rsE.nextStates(ms, OPT.requestRetention, dt);
        rsIvl = Number(ns.good.interval);
        rsS = Number(ns.good.memory.stability);
      } catch (e) { rsIvl = "ERR"; }
      const dS = appS != null && rsS != null ? Math.abs(appS - rsS) / Math.max(1, rsS) : null;
      const ivlDiff = appIvl != null && typeof rsIvl === "number" ? Math.abs(appIvl - rsIvl) : null;
      rows.push({ state, S, dt, appIvl, rsIvl, ivlDiff, appS, rsS, dS, err });
    }
  }
}
console.log("state       S        dt | appIvl   rustIvl   |diff| | appS      rustS     relΔS     | err");
console.log("-".repeat(112));
for (const r of rows) {
  console.log(
    `${r.state.padEnd(11)} ${String(r.S ?? "-").padEnd(8)} ${String(r.dt).padEnd(2)} | ` +
    `${(r.appIvl ?? NaN).toFixed(3).padStart(8)} ${(typeof r.rsIvl === "number" ? r.rsIvl : NaN).toFixed(3).padStart(9)} ${(r.ivlDiff ?? NaN).toFixed(3).padStart(8)} | ` +
    `${(r.appS ?? NaN).toFixed(4).padStart(9)} ${(r.rsS ?? NaN).toFixed(4).padStart(9)} ${(r.dS ?? 0).toExponential(1).padStart(9)} | ${r.err ?? ""}`
  );
}
const bad = rows.filter((r) => r.state === "review" && r.ivlDiff != null && r.ivlDiff > 1.001);
console.log(`\nreview 态下 interval 分歧(>1天) 的格子：${bad.length}/${rows.filter((r) => r.state === "review").length}`);
console.log(JSON.stringify(bad.map((b) => ({ S: b.S, dt: b.dt, appIvl: +b.appIvl.toFixed(3), rsIvl: +b.rsIvl.toFixed(3) }))))
;
const sbad = rows.filter((r) => r.dS != null && r.dS > 1e-4);
console.log(`\nstability 相对分歧(>1e-4) 的格子：${sbad.length}`);
console.log(JSON.stringify(sbad.slice(0, 12).map((b) => ({ st: b.state, S: b.S, dt: b.dt, appS: +b.appS.toFixed(5), rsS: +b.rsS.toFixed(5) }))));
