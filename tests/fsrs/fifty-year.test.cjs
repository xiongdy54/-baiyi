// 50 年 FSRS 调度审计（M3 时间轴仿真的延伸层，标准化可复现）
// 与 L5 simulate.test.cjs 的分工：L5 验「应用侧 == 锁定的 ts-fsrs 侧」（同源一致性）；
//   本层验「ts-fsrs 侧 == 官方 Rust FSRS 侧」（异源正确性）+ 50 年量级下的时间语义与不变量。
// 运行：node tests/fsrs/fifty-year.test.cjs            （默认本地时区）
//       TZ=Asia/Shanghai node tests/fsrs/fifty-year.test.cjs --phase=all
// 退出码 0 = 无新增判红。FAIL 行给出口径与复现参数。
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const YEARS = 50;
const HORIZON_MS = T0 + YEARS * 365.25 * DAY;

let pass = 0, fail = 0, warn = 0;
const findings = [];
function check(name, cond, detail) {
  if (cond) pass++;
  else { fail++; console.log(`  ✗ FAIL ${name}\n         ${detail}`); }
}
function note(name, cond, detail) {
  if (cond) pass++;
  else { warn++; console.log(`  ! WARN ${name}\n         ${detail}`); }
}
function finding(id, sev, title, detail) {
  findings.push({ id, sev, title, detail });
  console.log(`\n  >>> [${sev}] ${id} ${title}\n      ${detail}\n`);
}
function section(t) { console.log(`\n== ${t} ==`); }

const ARGV = process.argv.slice(2);
const ONLY = (() => {
  const i = ARGV.indexOf("--phase");
  return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : "all";
})();
const want = (p) => ONLY === "all" || ONLY === p;

// 本层用官方曲线做「隐式记忆」与反解区间，参数必须与实现同源：
//   从 ts-fsrs 的 computeDecayFactor(w) 取，绝不硬编码。
let DECAY = -0.5, FACTOR = 0.2346; // 占位，main() 内按 APP_W 覆写
const retrievability = (t, S) => Math.pow(1 + (FACTOR * t) / S, DECAY);
const solvingInterval = (S, R) => ((Math.pow(R, 1 / DECAY) - 1) / FACTOR) * S;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const utcDay = (ms) => Math.floor(Date.UTC(new Date(ms).getUTCFullYear(), new Date(ms).getUTCMonth(), new Date(ms).getUTCDate()) / DAY);
// 产品学习日（本地钟面 + 切点），复刻 electron/fsrsTime.js:learningDayIndex
const localDay = (ms, cutoff = 0) => {
  const d = new Date(ms);
  return Math.floor((ms - d.getTimezoneOffset() * MIN - cutoff * HOUR) / DAY);
};

async function main() {
  execSync("npx esbuild src/lib/fsrs.ts --bundle --platform=node --format=cjs --outfile=tests/fsrs/adapter.fifty.bundle.cjs", { cwd: ROOT });
  const { fsrsEngine } = require(path.join(__dirname, "adapter.fifty.bundle.cjs"));
  const rs = require(path.join(ROOT, "node_modules", "fsrs-rs-nodejs"));
  const tsfs = require(path.join(ROOT, "node_modules", "ts-fsrs", "dist", "index.cjs"));
  const { FSRS6_DEFAULT_WEIGHTS, DEFAULT_SCHEDULER_OPTIONS } = require(path.join(ROOT, "electron", "fsrsConfig.js"));
  // B-4（审计）：learningDayStartMs 必须用**产品函数本身**。此前本层自己复刻了一份旧公式
  // （local learningStart），副本永远测不出原件的修复 —— 这正是 B-4 首轮漏判的原因。
  const { calculateFsrsDeltaT, learningDayStartMs } = require(path.join(ROOT, "electron", "fsrsTime.js"));
  const { fsrs, generatorParameters, createEmptyCard, Rating, State } = tsfs;
  const GRADE = { Again: Rating.Again, Hard: Rating.Hard, Good: Rating.Good, Easy: Rating.Easy };
  const APP_W = FSRS6_DEFAULT_WEIGHTS;
  // 曲线参数与实现同源（FSRS-6 自由 decay 藏在 w[20]，且被 ts-fsrs 钳进 [0.1,0.8]）
  const CURVE = tsfs.computeDecayFactor(APP_W);
  DECAY = CURVE.decay; FACTOR = CURVE.factor;
  console.log(`  有效曲线参数 decay=${DECAY} factor=${FACTOR}（R(t,S)=(1+factor·t/S)^decay）`);
  const REQ_RET = DEFAULT_SCHEDULER_OPTIONS.requestRetention;
  const MAX_IVL = DEFAULT_SCHEDULER_OPTIONS.maximumInterval;
  console.log(`TZ=${process.env.TZ || "(system)"}  horizon=${YEARS}y  requestRetention=${REQ_RET}  maximumInterval=${MAX_IVL}`);

  // ── Phase 0 参数环境完整性：三份「FSRS-6 默认权重」必须逐位一致 ──────────────
  if (want("0")) {
    section("P0 参数环境：app 硬编码权重 vs 官方 Rust 默认 vs ts-fsrs 默认");
    const rsDefaults = Array.from(rs.DEFAULT_PARAMETERS?.parameters ?? rs.DEFAULT_PARAMETERS ?? []);
    console.log(`  rust DEFAULT_PARAMETERS shape: ${Array.isArray(rs.DEFAULT_PARAMETERS) ? "array" : typeof rs.DEFAULT_PARAMETERS} keys=${rs.DEFAULT_PARAMETERS && !Array.isArray(rs.DEFAULT_PARAMETERS) ? Object.keys(rs.DEFAULT_PARAMETERS).join(",") : "-"}`);
    const tsDefaults = Array.from(generatorParameters().w ?? []);
    console.log(`  app(${APP_W.length}) rust(${rsDefaults.length}) tsfs(${tsDefaults.length})`);
    const cmp = (label, a, b) => {
      const n = Math.max(a.length, b.length);
      const diffs = [];
      // fsrs-rs 以 f32 存权重，逐位比较必须走相对容差（否则 0.212 vs 0.21199999749660492 全红）
      for (let i = 0; i < n; i++) if (!(Math.abs(a[i] - b[i]) <= Math.max(1e-6, Math.abs(b[i]) * 1e-6))) diffs.push(`w[${i}]: ${a[i]} ≠ ${b[i]}`);
      return { label, diffs };
    };
    const vsRust = cmp("app vs rust", APP_W, rsDefaults);
    const vsTs = cmp("app vs ts-fsrs", APP_W, tsDefaults);
    console.log(`  app≠rust: ${vsRust.diffs.length ? vsRust.diffs.join("; ") : "none"}`);
    console.log(`  app≠tsfs: ${vsTs.diffs.length ? vsTs.diffs.join("; ") : "none"}`);
    check("P0-1 应用侧权重与 ts-fsrs 锁定版本默认逐位一致", vsTs.diffs.length === 0, vsTs.diffs.join("; "));
    check("P0-2 应用侧权重与官方 fsrs-rs FSRS-6 默认逐位一致", vsRust.diffs.length === 0, vsRust.diffs.join("; "));
    check("P0-3 权重表长度为 21（FSRS-6）", APP_W.length === 21 && rsDefaults.length === 21, `app=${APP_W.length} rust=${rsDefaults.length}`);
    if (rs.FSRS6_DEFAULT_DECAY !== undefined) {
      note("P0-4 有效曲线 decay 与官方 FSRS-6 默认一致（存正用负）", Math.abs(-rs.FSRS6_DEFAULT_DECAY - DECAY) < 1e-6, `rust FSRS6_DEFAULT_DECAY=${rs.FSRS6_DEFAULT_DECAY} 本层有效 DECAY=${DECAY}`);
      note("P0-5 ts-fsrs 对 w[20] 的钳制区间 [0.1,0.8] 覆盖官方默认", rs.FSRS6_DEFAULT_DECAY >= 0.1 && rs.FSRS6_DEFAULT_DECAY <= 0.8, `官方默认 ${rs.FSRS6_DEFAULT_DECAY} 在钳制区间内 → 默认配置不被改写`);
    }
  }

  // ── Phase 1 异源一致性：应用调度链 == 官方 Rust FSRS 记忆状态链（50 年）─────
  if (want("1")) {
    section(`P1 应用链 vs 官方 Rust 链（异源），长档逐轮比对`);
    const rsEngine = new rs.FSRS(APP_W);
    // 复习史：Rust nextStates 需要「当前记忆状态 + 本次 daysElapsed」
    const profiles = [
      { name: "优秀学习者(难)", ratings: ["Good", "Good", "Again", "Good", "Easy", "Good", "Hard"], seed: 11 },
      { name: "普通学习者", ratings: ["Good", "Good", "Good", "Again", "Hard", "Good", "Good"], seed: 22 },
      { name: "吃力学习者", ratings: ["Good", "Again", "Hard", "Again", "Good", "Again", "Easy"], seed: 33 },
    ];
    for (const p of profiles) {
      const rnd = mulberry32(p.seed);
      let appState = { state: "new", due: T0, lapses: 0 };
      let mem = null;              // Rust 侧记忆状态（null = 新卡）
      let lastReviewMs = null;     // 用于 delta_t
      let reviewIdx = 0;
      let compared = 0, sMaxDiff = 0, dMaxDiff = 0, ivlDiff = 0, daySemanticsDiverge = 0;
      const ivlMismatchSamples = [];
      let now = T0;
      while (now < HORIZON_MS) {
        const rating = p.ratings[reviewIdx % p.ratings.length];
        const out = fsrsEngine.next(appState, rating, now);
        appState = JSON.parse(JSON.stringify(out.fsrsState));

        // Rust 侧：为做「纯实现差异」对照，daysElapsed 取与 ts-fsrs elapsed_days 同口径的
        // UTC 日历日差；「UTC 日 vs 本地学习日」的定义分歧单独在第 4 层量化。
        const dt = lastReviewMs == null ? 0 : Math.max(0, utcDay(now) - utcDay(lastReviewMs));
        if (lastReviewMs != null && dt !== Math.max(0, localDay(now) - localDay(lastReviewMs))) daySemanticsDiverge++;
        const ns = rsEngine.nextStates(mem, REQ_RET, dt);
        const picked = ns[rating.toLowerCase()];
        const rsMem = picked.memory;
        const rsIvl = picked.interval;
        mem = new rs.MemoryState(rsMem.stability, rsMem.difficulty);
        lastReviewMs = now;
        reviewIdx++;

        // 只在长档（应用侧已进入 review 且 Rust 给出 ≥1 天）比对，学习步由分钟表示，两实现口径不同
        if (appState.state === "review") {
          const appIvl = Math.round((appState.due - now) / DAY);
          compared++;
          const ds = Math.abs(appState.stability - rsMem.stability) / Math.max(1, rsMem.stability);
          const dd = Math.abs(appState.difficulty - rsMem.difficulty) / Math.max(1, rsMem.difficulty);
          sMaxDiff = Math.max(sMaxDiff, ds);
          dMaxDiff = Math.max(dMaxDiff, dd);
          if (rsIvl >= 1 && Math.abs(rsIvl - appIvl) > 1.001) {
            ivlDiff++;
            if (ivlMismatchSamples.length < 4) ivlMismatchSamples.push({ rating, y: +((now - T0) / (365.25 * DAY)).toFixed(1), appIvl, rsIvl: +rsIvl.toFixed(3), appS: +appState.stability.toFixed(4), rsS: +rsMem.stability.toFixed(4), dt });
          }
        }
        // 真实推进：按 app 的 due 走到下一次（加 ±0..2h 噪声模拟作息漂移）
        now = appState.due + Math.round((rnd() - 0.5) * 2 * HOUR);
        if (now <= lastReviewMs) now = lastReviewMs + DAY;
      }
      console.log(`  ${p.name}: 轮次=${reviewIdx} 长档比对=${compared} ΔS_max=${sMaxDiff.toExponential(2)} ΔD_max=${dMaxDiff.toExponential(2)} 区间不等=${ivlDiff} UTC日≠本地日=${daySemanticsDiverge}`);
      if (daySemanticsDiverge > 0) finding("F1-day", "中", `${p.name}：50 年链上有 ${daySemanticsDiverge}/${reviewIdx} 次复习的「UTC 日历日差」与「本地学习日差」不一致`,
        `调度器（ts-fsrs elapsed_days）按 UTC 日历日计 elapsed，产品口径（D21 learningDayIndex）按本地钟面 + 切点计日；两者分歧的那些复习，FSRS 的 short-term/long-term 档位判定与用户认知的「隔了几天」不同`);
      if (ivlMismatchSamples.length) console.log(`      样例: ${JSON.stringify(ivlMismatchSamples)}`);
      // Rust 侧全 f32、应用侧 f64，50 年复利下允许 1e-4 相对误差；超出即视为真实分歧
      note(`P1-${p.name} 长档 stability/difficulty 与官方 Rust 相对一致(<1e-4)`, sMaxDiff < 1e-4 && dMaxDiff < 1e-4, `相对ΔS_max=${sMaxDiff.toExponential(2)} 相对ΔD_max=${dMaxDiff.toExponential(2)}`);
      note(`P1-${p.name} 长档 suggested interval 与官方 Rust 一致`, ivlDiff === 0, `${ivlDiff}/${compared} 轮不等`);
    }
  }

  // ── Phase 2 50 年真实用户行为仿真：达成记忆率是否守住 requestRetention ───────
  if (want("2")) {
    section(`P2 50 年用户行为仿真（隐式记忆模型驱动作答，调度器只见评分）`);
    const N_CARDS = 240;
    const rnd = mulberry32(20260922);
    const cards = [];
    for (let i = 0; i < N_CARDS; i++) {
      cards.push({
        id: `c${i}`,
        state: { state: "new", due: T0 + Math.floor(rnd() * 365.25 * DAY), lapses: 0 },
        // 隐式真实记忆：与调度器的估计无关，这正是仿真的意义
        trueS: 1.2 + rnd() * 6,
        diff: 0.2 + rnd() * 0.5,
        reviews: 0, lapses: 0,
        seen: 0, hit: 0, // 到期时考察次数 / 答对次数
        dueHistory: [],
      });
    }
    let day = 0, totalReviews = 0, againStreakCap = 0;
    const perYear = new Array(YEARS).fill(0).map(() => ({ reviews: 0, seen: 0, hit: 0 }));
    // 用户作息：每天 20:00 本地 ±45min，8% 概率跳过（周末更多）
    for (let ms = T0; ms < HORIZON_MS; ms += DAY, day++) {
      const d = new Date(ms);
      const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
      if (rnd() < (weekend ? 0.22 : 0.07)) continue;
      const wall = new Date(ms + 20 * HOUR + Math.round((rnd() - 0.5) * 90 * MIN));
      const y = Math.floor((wall.getTime() - T0) / (365.25 * DAY));
      const dueNow = cards.filter((c) => c.state.due <= wall.getTime());
      let studied = 0;
      for (const c of dueNow.slice(0, 60)) {
        // 隐式遗忘曲线决定本次能否 recall
        const t = Math.max(0, (wall.getTime() - (c.lastSeen ?? T0)) / DAY);
        const R = retrievability(t, c.trueS);
        const ok = rnd() < R * (1 - c.diff * 0.08);
        let rating;
        if (!ok) { rating = "Again"; c.trueS = Math.max(0.35, c.trueS * 0.30); c.lapses++; }
        else {
          const roll = rnd();
          rating = roll < 0.10 ? "Hard" : roll > 0.88 ? "Easy" : "Good";
          const mult = rating === "Easy" ? 2.6 : rating === "Hard" ? 1.25 : 1.9;
          c.trueS = c.trueS * mult * (1 - c.diff * 0.25);
        }
        c.lastSeen = wall.getTime();
        const out = fsrsEngine.next(c.state, rating, wall.getTime());
        c.state = JSON.parse(JSON.stringify(out.fsrsState));
        c.reviews++;
        c.seen++; c.hit += ok ? 1 : 0;
        c.dueHistory.push(wall.getTime());
        if (y < YEARS) { perYear[y].reviews++; perYear[y].seen++; perYear[y].hit += ok ? 1 : 0; }
        totalReviews++; studied++;
        againStreakCap = Math.max(againStreakCap, c.lapses);
      }
    }
    const totSeen = cards.reduce((a, c) => a + c.seen, 0);
    const totHit = cards.reduce((a, c) => a + c.hit, 0);
    const achieved = totSeen ? totHit / totSeen : 0;
    const activeCards = cards.filter((c) => c.reviews > 0).length;
    console.log(`  50y 总复习=${totalReviews} 活跃卡=${activeCards}/${N_CARDS} 全局达成记忆率=${(achieved * 100).toFixed(2)}% (目标 ${(REQ_RET * 100).toFixed(0)}%)`);
    const head = perYear.slice(0, 3), tail = perYear.slice(-3);
    console.log(`  前3年负荷/年: ${head.map((p) => p.reviews).join(", ")}   末3年: ${tail.map((p) => p.reviews).join(", ")}`);
    console.log(`  首年达成率=${(head[0].hit / Math.max(1, head[0].seen) * 100).toFixed(1)}%  末段达成率=${(perYear[YEARS - 2].hit / Math.max(1, perYear[YEARS - 2].seen) * 100).toFixed(1)}%`);
    check("P2-1 50 年仿真无卡死/无空转（活跃卡 > 90%）", activeCards / N_CARDS > 0.9, `活跃 ${activeCards}/${N_CARDS}`);
    check("P2-2 50 年总复习量非零且有限", totalReviews > 1000 && Number.isFinite(totalReviews), String(totalReviews));
    note("P2-3 达成记忆率落在 requestRetention ±10 个百分点", Math.abs(achieved - REQ_RET) <= 0.10, `achieved=${(achieved * 100).toFixed(2)}% vs ${REQ_RET * 100}%`);
    // 长期负荷不能指数增长
    const early = head.reduce((a, p) => a + p.reviews, 0) / 3;
    const late = perYear.slice(-3).reduce((a, p) => a + p.reviews, 0) / 3;
    console.log(`  年均负荷：早期=${early.toFixed(1)} 末期=${late.toFixed(1)} 比值=${(late / Math.max(1e-9, early)).toFixed(2)}`);
    note("P2-4 复习负荷未失控（末期年均 ≤ 早期 ×3）", late <= early * 3, `early=${early.toFixed(1)} late=${late.toFixed(1)}`);
  }

  // ── Phase 3 不变量与病态时间扫描（50 年轴上的边界）────────────────────────
  if (want("3")) {
    section("P3 不变量 / 病态时间扫描");
    const bad = { nan: [], neg: [], oob: [], timeTravel: [], pastDue: [], overMax: [] };
    const push = (arr, msg) => { if (arr.length < 6) arr.push(msg); };

    // 3a 长时间旅行：系统时钟回拨 / 时区变更导致 now < lastReview
    let s = { state: "new", due: T0, lapses: 0 };
    for (let i = 0; i < 60; i++) s = JSON.parse(JSON.stringify(fsrsEngine.next(s, "Good", T0 + i * 30 * DAY).fsrsState));
    const beforeTravel = JSON.stringify(s);
    let tv = null, travelThrow = null;
    try {
      tv = fsrsEngine.next(s, "Good", T0).fsrsState; // 回到起点：lastReview 在 now 之后
    } catch (err) { travelThrow = `${err.constructor?.name}: ${err.message}`; }
    if (travelThrow) {
      finding("F3a", "高", "lastReview 落在 now 之后（时钟回拨 / 从时钟超前的机器恢复备份）时，fsrsEngine.next 直接抛错而非降级",
        `${travelThrow}；src/components/ReviewView.tsx:118（useEffect 内裸调 preview）与 :485（渲染期 ?? preview(...)）都无 try/catch，` +
        `而唯一的错误边界在 src/main.tsx:17 的根上 → 整应用换成「界面出现异常」。取证：node tests/fsrs/repro-future-lastreview.gui.mjs`);
      console.log(`  时钟回拨：60 步后 ${beforeTravel.slice(0, 60)}… → THROW ${travelThrow}`);
    } else {
      console.log(`  时钟回拨：60 步后 ${beforeTravel.slice(0, 70)}… → due-now=${((tv.due - T0) / DAY).toFixed(3)} 天 state=${tv.state}`);
    }
    check("P3a 时钟回拨不产生非法 due / NaN（或至少不抛错）", travelThrow === null || (Number.isFinite(tv?.due) && Number.isFinite(tv?.stability)), String(travelThrow ?? ""));
    if (tv) note("P3a2 回拨后 due 不落在过去", tv.due >= T0, `due=${tv.due} now=${T0} 差=${((tv.due - T0) / DAY).toFixed(3)}天`);

    // 3b Again 连击 50 年：lapses 与 stability 不能爆掉
    let a = { state: "new", due: T0, lapses: 0 };
    let maxA = 0, aState = null;
    for (let i = 0; i < 4000; i++) {
      const at = a.due;
      a = JSON.parse(JSON.stringify(fsrsEngine.next(a, "Again", at).fsrsState));
      if (!Number.isFinite(a.stability) || !Number.isFinite(a.due)) { aState = `step${i}`; break; }
      maxA = Math.max(maxA, a.stability);
      if (a.due <= at) { aState = `step${i} due 未前进 (due=${a.due} at=${at})`; break; }
    }
    console.log(`  Again×${a.reps} lapses=${a.lapses} maxS=${maxA.toFixed(4)} state=${a.state}`);
    check("P3b Again 连击 4000 次不产生 NaN/停滞", aState === null && Number.isFinite(a.stability), String(aState ?? "ok"));
    check("P3b2 Again 连击下 due 严格前进", aState === null, String(aState));

    // 3c Easy 连击 50 年：必须被 maximum_interval 钳制
    let e = { state: "new", due: T0, lapses: 0 };
    let over = null, eMax = 0, guard = 0;
    for (let i = 0; i < 400 && e.due < HORIZON_MS; i++) {
      const at = e.due;
      const out = fsrsEngine.next(e, "Easy", at);
      e = JSON.parse(JSON.stringify(out.fsrsState));
      const ivl = (e.due - at) / DAY;
      eMax = Math.max(eMax, ivl);
      if (ivl > MAX_IVL) { over = `step${i} interval=${ivl} > max=${MAX_IVL}`; break; }
      guard = i;
    }
    console.log(`  Easy 连击 ${guard + 1} 步：maxInterval=${eMax.toFixed(1)} 天 due 已推进 ${((e.due - T0) / (365.25 * DAY)).toFixed(1)} 年 state=${e.state}`);
    check("P3c Easy 连击受 maximum_interval 钳制（不得超过配置值）", over === null, String(over));
    if (over) finding("F3c", "低", "落库间隔越过 maximum_interval", `${String(over)}；ts-fsrs 的 next_interval 正确钳到 ${MAX_IVL}，但 repeat() 在钳制之后又叠加了 +1/+2 的档位修正，实际 due 为 36501~36502 天 → §4.4.10「scheduler_options 涵盖所有影响调度的 option」不成立`);
    // 直接扫参数空间钉死「落库间隔越过 maximum_interval」：next_interval 自身钳制正确，
    // 但 repeat() 在钳制之后又叠加档位修正 → 实际 due 越过配置值 1~2 天
    const capOver = [];
    for (const S of [1e4, 5e4, 2e5, 1e6, 5e7]) {
      for (const r of ["Good", "Easy"]) {
        const at = Date.UTC(2030, 0, 1);
        const st = { state: "review", due: at, lapses: 0, stability: S, difficulty: 5, reps: 50, learningSteps: 0, lastReview: at - 100 * DAY };
        const o = fsrsEngine.next(st, r, at);
        const ivl = Math.round((o.fsrsState.due - at) / DAY);
        if (ivl > MAX_IVL) capOver.push({ S, r, ivl });
      }
    }
    check(`P3c3 落库间隔恒 ≤ maximum_interval(${MAX_IVL})`, capOver.length === 0, JSON.stringify(capOver.slice(0, 4)));
    if (capOver.length) finding("F3c3", "低", `落库间隔越过 maximum_interval ${MAX_IVL}`, `${capOver.length} 个格子上越界，例如 ${JSON.stringify(capOver[0])}；ts-fsrs 的 next_interval 自身钳制正确（实测返回 ${MAX_IVL}），但 repeat() 在钳制之后又叠加了 +1/+2 的档位修正 → §4.4.10「scheduler_options 涵盖所有影响调度结果的 option」在 maximum_interval 上不成立`);
    note("P3c2 长间隔卡不越过 50 年视界（否则用户永远看不到）", e.due < HORIZON_MS + 400 * DAY, `due 落在 T0 + ${((e.due - T0) / (365.25 * DAY)).toFixed(1)} 年`);

    // 3d 2 月 29 日出生的卡，50 年每年只看一次：elapsed_days 闰年口径
    const leapT0 = Date.UTC(2028, 1, 29, 12, 0); // 真实闰日
    let L = { state: "new", due: leapT0, lapses: 0 };
    const leapRows = [];
    let lNow = leapT0;
    for (let i = 0; i < 50; i++) {
      const out = fsrsEngine.next(L, "Good", lNow);
      L = JSON.parse(JSON.stringify(out.fsrsState));
      const next = new Date(L.due);
      leapRows.push({ y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate(), ivl: +((L.due - lNow) / DAY).toFixed(2) });
      lNow = L.due + 3 * HOUR;
    }
    const leapOverflow = leapRows.filter((r) => r.m === 2 && r.d === 29 && !(r.y % 4 === 0 && (r.y % 100 !== 0 || r.y % 400 === 0)));
    check("P3d 50 年闰年推进不产生非法日期（2/29 出现在平年）", leapOverflow.length === 0, JSON.stringify(leapOverflow.slice(0, 3)));
    console.log(`  闰日卡前 5 次: ${JSON.stringify(leapRows.slice(0, 5))}`);
    console.log(`  闰日卡 50 年后: ${JSON.stringify(leapRows.slice(-2))}`);

    // 3e 全字段 JSON 往返 50 年精度漂移
    const ref = fsrs(generatorParameters({ enable_fuzz: false }));
    let rc = createEmptyCard(new Date(T0));
    let as = { state: "new", due: T0, lapses: 0 };
    const rnd = mulberry32(777);
    let driftS = 0, driftD = 0, mismatches = 0, steps = 0;
    let at = T0;
    const names = ["Again", "Hard", "Good", "Easy"];
    while (at < HORIZON_MS && steps < 20000) {
      const r = names[Math.floor(rnd() * 4)];
      const ro = ref.repeat(rc, new Date(at))[GRADE[r]].card;
      const ao = fsrsEngine.next(as, r, at);
      as = JSON.parse(JSON.stringify(ao.fsrsState));
      rc = { ...ro };
      steps++;
      if (as.state === "review") {
        driftS = Math.max(driftS, Math.abs(as.stability - ro.stability));
        driftD = Math.max(driftD, Math.abs(as.difficulty - ro.difficulty));
        if (as.due !== ro.due.getTime()) { mismatches++; if (bad.pastDue.length < 6) bad.pastDue.push({ step: steps, app: as.due, ref: ro.due.getTime(), dy: +((as.due - ro.due.getTime()) / DAY).toFixed(6) }); }
      }
      // 推进到下一次复习：只准往前走，避免把「时钟回拨」混进这条同源一致性链
      at = Math.max(as.due, ro.due.getTime()) + Math.round(rnd() * 6 * HOUR);
    }
    console.log(`  同源双链 50y：steps=${steps} ΔS_max=${driftS.toExponential(2)} ΔD_max=${driftD.toExponential(2)} due 不等=${mismatches}`);
    check("P3e JSON 往返 50 年零精度丢失（ΔS/ΔD < 1e-12）", driftS < 1e-12 && driftD < 1e-12, `ΔS=${driftS.toExponential(2)} ΔD=${driftD.toExponential(2)}`);
    check("P3e2 due 逐毫秒相等", mismatches === 0, `${mismatches} 处不等 ${JSON.stringify(bad.pastDue.slice(0, 3))}`);

    // 3f 越界输入：分两类断言，别把「库级拒绝」与「应用层可归一」混为一谈
    //  (a) 应用层必须容忍的脏值：非法 state 名 / 非数字 due / 缺字段 / null / undefined
    const dirtyTolerable = [
      { state: "bogus", due: "not-a-number", lapses: -5, stability: -3, difficulty: 99 },
      { state: "review", due: 1e18, lapses: 1e9, stability: 1e300, difficulty: 42 },
      null, undefined, {},
    ];
    //  (b) 语义自相矛盾的行（review 态却 S≤0 或 D=0）由 ts-fsrs 按库级规则拒绝。
    //      应用侧由 A-2 的 damaged 值域闸门挡在队列外（F34 已断言），故这里只登记不判红。
    // 只列**归一后仍非法**的形态：review 态而 S≤0（D=0 会被本层钳到 1，库方接受，故不列）
    const dirtyLibraryRejected = [
      { state: "review", due: T0, lapses: 0, stability: -1, difficulty: 5, reps: 0 },
    ];
    let dirtyCrash = null;
    dirtyTolerable.forEach((d, i) => {
      try {
        const o = fsrsEngine.next(d, "Good", T0);
        if (!Number.isFinite(o.fsrsState.due)) push(bad.oob, `dirty#${i} due 非有限: ${o.fsrsState.due}`);
      } catch (err) { dirtyCrash = `dirty#${i} 抛错: ${err.message}`; }
    });
    check("P3f 可归一的脏 fsrs_json 不抛错且 due 有限", dirtyCrash === null && bad.oob.length === 0, `${dirtyCrash} ${JSON.stringify(bad.oob.slice(0, 2))}`);
    let libRejected = 0;
    for (const d of dirtyLibraryRejected) { try { fsrsEngine.next(d, "Good", T0); } catch { libRejected++; } }
    note("P3f2 语义矛盾态（review 却 S≤0 / D=0）由 ts-fsrs 拒绝 —— 库级规则，应用侧靠 A-2 闸门挡住",
      libRejected === dirtyLibraryRejected.length, `实测被拒 ${libRejected}/${dirtyLibraryRejected.length}`);

    // 3g 区间必须落在合法值域（FSRS 论文口径：D∈[1,10]，S>0）
    const rndg = mulberry32(4242);
    let g = { state: "new", due: T0, lapses: 0 };
    let gNow = T0, oobG = [];
    for (let i = 0; i < 6000 && gNow < HORIZON_MS; i++) {
      g = JSON.parse(JSON.stringify(fsrsEngine.next(g, names[Math.floor(rndg() * 4)], gNow).fsrsState));
      if (g.difficulty < 1 || g.difficulty > 10) push(oobG, `D 越界 ${g.difficulty} @step${i}`);
      if (!(g.stability > 0) || !Number.isFinite(g.stability)) push(oobG, `S 非法 ${g.stability} @step${i}`);
      gNow = Math.max(g.due, gNow) + Math.round(rndg() * 4 * HOUR);
    }
    check("P3g 50 年内 D∈[1,10] 且 S>0 恒成立", oobG.length === 0, JSON.stringify(oobG.slice(0, 4)));
    if (oobG.length) finding("F3g", "中", "长期调度后 difficulty/stability 越出 FSRS 值域", JSON.stringify(oobG.slice(0, 4)));
  }

  // ── Phase 4 时间语义：UTC 日差（调度）vs 本地学习日（产品）在 50 年上的分叉 ──
  if (want("4")) {
    section("P4 时间语义分叉：ts-fsrs 的 UTC 日历日差 vs 产品本地学习日差");
    // 复刻 simulate 里 L6-A 的 oracle，但拉长到 50 年、并扫一天中的 24 个钟点
    const ref = fsrs(generatorParameters({ enable_fuzz: false }));
    let divergeHours = [];
    for (let hour = 0; hour < 24; hour++) {
      const startUtc = new Date(Date.UTC(2030, 6, 15, hour, 30));
      const c0 = createEmptyCard(startUtc);
      const r1 = c0; // new
      const g1 = ref.repeat(r1, startUtc)[Rating.Good];
      // 固定「本地钟面同一时刻」推进 30 天
      const at = new Date(g1.card.due.getTime());
      const r2 = ref.repeat(g1.card, at)[Rating.Good];
      const ed = r2.log.elapsed_days;
      const utcDiff = utcDay(at) - utcDay(g1.card.due.getTime());
      const localDiff = localDay(at.getTime()) - localDay(g1.card.due.getTime());
      if (utcDiff !== localDiff) divergeHours.push({ hour, tz: -new Date().getTimezoneOffset() / 60, utcDiff, localDiff, dueIso: at.toISOString(), elapsed: ed });
    }
    console.log(`  本时区 offset=${-new Date().getTimezoneOffset() / 60}h  24 钟点中口径分叉=${divergeHours.length}`);
    if (divergeHours.length) {
      console.log(`  样例: ${JSON.stringify(divergeHours.slice(0, 6))}`);
      finding("F4a", "中", "elapsed_days（UTC 日历日）与产品学习日（本地钟面）在部分钟点口径不一致",
        `${divergeHours.length}/24 个钟点分叉；这些钟点复习的卡，FSRS 看到的 elapsed_days 与用户认知的「隔了几天」不同 → 短/长档切换与 delta_t 训练标签都可能偏 1 天`);
    }
    // 50 年 × 切点 0..6：learningDayIndex 单调性 + learningDayStartMs 不动点
    for (let cutoff = 0; cutoff <= 6; cutoff++) {
      let prev = -1, nonMono = null, fixedPoint = null;
      const stepMs = 15 * MIN;
      let sampleNonMono = null;
      for (let ms = T0; ms < HORIZON_MS; ms += stepMs) {
        const idx = localDay(ms, cutoff);
        if (idx < prev && nonMono === null) { nonMono = `${new Date(ms).toISOString()} idx ${prev}→${idx}`; }
        prev = Math.max(prev, idx);
      }
      // 不动点：dayStart 落在同一天；并且日长必须 ∈ {23h,24h,25h}
      let dayLenBad = null;
      for (let ms = T0; ms < T0 + 400 * DAY; ms += DAY) {
        const s0 = learningDayStartMs(ms, cutoff), s1 = learningDayStartMs(ms + DAY, cutoff);
        const len = (s1 - s0) / HOUR;
        if (len < 22.5 || len > 25.5) { dayLenBad = `len=${len.toFixed(2)}h @${new Date(ms).toISOString()}`; break; }
        if (localDay(s0, cutoff) !== localDay(ms, cutoff) && fixedPoint === null) fixedPoint = `${new Date(ms).toISOString()} start 落错日`;
      }
      check(`P4-cutoff${cutoff} 学习日序号 50 年单调不减`, nonMono === null, String(nonMono));
      check(`P4-cutoff${cutoff} dayStart 不动点成立且日长∈[22.5,25.5]h`, fixedPoint === null && dayLenBad === null, `${fixedPoint ?? ""} ${dayLenBad ?? ""}`);
    }
    // DST 漂移：50 年内 date_scheduler 的纯毫秒加法是否让「每天同一钟点复习」漂出复习时刻
    const drift = [];
    let dueMs = Date.UTC(2026, 10, 1, 20, 0); // 本地 20:00（以系统时区计）
    const firstWall = new Date(dueMs);
    for (let i = 0; i < 50 * 12; i++) {
      dueMs = new Date(dueMs).getTime() + 30 * DAY; // ts-fsrs 的 date_scheduler 语义
      const d = new Date(dueMs);
      drift.push({ h: d.getHours(), m: d.getMinutes() });
    }
    const distinctWall = new Set(drift.map((x) => `${x.h}:${x.m}`));
    console.log(`  纯毫秒加法 50 年 / 每 30 天一次 → 本地钟面出现 ${distinctWall.size} 种：${[...distinctWall].join(" ")}`);
    note("P4-DST 固定 30 天推进 50 年后本地复习钟点不漂移", distinctWall.size === 1, `出现 ${distinctWall.size} 种钟点（${[...distinctWall].join(", ")}）`);
  }

  // ── P5 优化器闭环：50 年合成史 → 训练 → 应用 → 再调度 ────────────────────
  if (want("5")) {
    section("P5 参数环境切换在 50 年史数据上的行为");
    const optimizer = require(path.join(ROOT, "electron", "optimizer.js"));
    console.log(`  optimizer 导出: ${Object.keys(optimizer).join(", ")}`);
    // 以固定权重构造两套参数环境，验证引擎切换不产生「未来卡回退」
    const cfgA = { id: "cfg-a", weights: APP_W, schedulerOptions: { ...DEFAULT_SCHEDULER_OPTIONS } };
    const cfgB = { id: "cfg-b", weights: APP_W.map((x, i) => +(x + (i === 2 ? 0.4 : 0)).toFixed(4)), schedulerOptions: { ...DEFAULT_SCHEDULER_OPTIONS, requestRetention: 0.95 } };
    const buildAndStep = (cfg) => {
      const engine = fsrs(generatorParameters({ enable_fuzz: false, w: cfg.weights, request_retention: cfg.schedulerOptions.requestRetention }));
      let c = createEmptyCard(new Date(T0));
      const chain = [];
      let at = T0;
      for (let i = 0; i < 400 && at < HORIZON_MS; i++) {
        const r = engine.repeat(c, new Date(at))[Rating.Good];
        c = r.card; chain.push(c.due.getTime()); at = c.due.getTime() + HOUR;
      }
      return chain;
    };
    const a = buildAndStep(cfgA), b = buildAndStep(cfgB);
    console.log(`  同权重链=${a.length} 步，retention 0.9→0.95 链=${b.length} 步（更保守应更短）`);
    const lastA = a[a.length - 1] - T0, lastB = b[b.length - 1] - T0;
    note("P5-1 提高 requestRetention 会让同期累计推进变短（调度更密）", lastB <= lastA, `0.9 累计 ${lastA / DAY} 天 vs 0.95 累计 ${lastB / DAY} 天`);
    check("P5-2 两条链均无 NaN", a.concat(b).every(Number.isFinite), "");
  }

  // ── P6 leech 覆盖面：lapses 只在 review→Again 时 +1，未毕业卡永不触发 ──────
  if (want("6")) {
    section("P6 leech 计数覆盖面（§8.7 六步 / ReviewView isLeech(lapses,8) / db.js:1550 同口径）");
    let n = { state: "new", due: T0, lapses: 0 };
    let at = T0;
    for (let i = 0; i < 500; i++) { at = Math.max(at, n.due); n = JSON.parse(JSON.stringify(fsrsEngine.next(n, "Again", at).fsrsState)); }
    console.log(`  新卡 Again×500：state=${n.state} lapses=${n.lapses} reps=${n.reps} S=${n.stability}`);
    let g = { state: "review", due: T0, lapses: 0, stability: 20, difficulty: 5, reps: 8, learningSteps: 0, lastReview: T0 - 20 * DAY };
    at = T0;
    for (let i = 0; i < 20; i++) {
      at = Math.max(at, g.due); g = JSON.parse(JSON.stringify(fsrsEngine.next(g, i % 2 ? "Again" : "Good", at).fsrsState));
      at = g.due;
    }
    console.log(`  已毕业卡 毕业→遗忘×6：lapses=${g.lapses} state=${g.state}`);
    check("P6-1 已毕业卡的反复遗忘能累计 lapses 到 leech 阈值", g.lapses >= 8, `lapses=${g.lapses}`);
    if (n.lapses === 0) finding("F6a", "中", "从未毕业的新卡不计 lapse → leech 六步流程对它永久不触发",
      `新卡 Again×500 后 state=${n.state}、lapses=${n.lapses}、reps=${n.reps}；ReviewView.tsx:144/154 与 db.js:1550 都以 after.lapses≥8 为唯一触发条件，` +
      `因此一张用户反复答错、始终停在 learning 的卡永远不会被标为 leech、也不会自动暂停`);
    check("P6-2 反复答错的新卡也应被 leech 机制覆盖", n.lapses > 0, `Again×500 后 lapses=${n.lapses}（期望 >0 或有独立的学习期 leech 计数）`);
  }

  section("汇总");
  console.log(`  pass=${pass} warn=${warn} fail=${fail}`);
  if (findings.length) {
    console.log("\n  ── 本次审计发现（按严重度）──");
    for (const f of findings) console.log(`  [${f.sev}] ${f.id} ${f.title}`);
  }
  console.log(`\n  findings json: ${JSON.stringify(findings.map((f) => f.id))}`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((e) => { console.error("HARNESS ERROR:", e && e.stack || e); process.exit(2); });
