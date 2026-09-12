// L5 时间轴模拟（M3，v20）— 卡片全生命周期仿真回归层
// 与 L0-L4 互补：L0-L4 验证单轮/单点正确性，L5 验证整条时间轴上生命周期的连续正确性。
// 方法：ts-fsrs 原库（enable_fuzz=false）在本进程内独立驱动一条全字段内存链（refChain），
//   与应用侧「持久化往返链」（appChain，每轮 JSON.stringify→parse 模拟 db 存取）在同一时间轴
//   上逐轮对照；refChain 绝不从 appChain 重建（否则丢字段会两侧同错，无法检出 F7 类缺陷）。
// 时间控制：fsrsEngine.preview/next 注入显式 now（§4.4.3 v20）；基准 T0 固定，结果确定可复现。
// 运行：npx electron tests/fsrs/simulate.test.cjs（须先关闭应用）
const { execSync } = require("child_process");
const path = require("path");
const { app } = require("electron");

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; console.log(`  ✗ ${name}\n      ${detail}`); }
}
function section(title) { console.log(`== ${title} ==`); }

app.whenReady().then(async () => {
  try {
    // 每次运行前重新打包（确保测的是最新 fsrs.ts）
    execSync("npx esbuild src/lib/fsrs.ts --bundle --platform=node --format=cjs --outfile=tests/fsrs/adapter.bundle.cjs", { cwd: path.join(__dirname, "..", "..") });
    const { fsrsEngine } = require(path.join(__dirname, "adapter.bundle.cjs"));
    const tsfs = require(path.join(__dirname, "..", "..", "node_modules", "ts-fsrs", "dist", "index.cjs"));
    const optimizer = require(path.join(__dirname, "..", "..", "electron", "optimizer.js"));
    const { calculateFsrsDeltaT, learningDayIndex, learningDayStartMs } = require(path.join(__dirname, "..", "..", "electron", "fsrsTime.js"));
    const { FSRS6_DEFAULT_WEIGHTS, DEFAULT_SCHEDULER_OPTIONS, DEFAULT_CONFIG_ID } = require(path.join(__dirname, "..", "..", "electron", "fsrsConfig.js"));
    const { fsrs, generatorParameters, createEmptyCard, Rating } = tsfs;
    const ref = fsrs(generatorParameters({ enable_fuzz: false }));

    const GRADE = { Again: Rating.Again, Hard: Rating.Hard, Good: Rating.Good, Easy: Rating.Easy };
    const STATE_NAME = ["new", "learning", "review", "relearning"];
    const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
    const T0 = 1735689600000; // 2025-01-01T00:00:00Z（与 golden.json baseTime 一致）
    const FIELDS = ["state", "due", "lapses", "stability", "difficulty", "reps", "learningSteps", "lastReview"];

    // 应用新卡初始 fsrs_json：模拟 db.createCard 的稀疏 3 字段（证明兜底路径等价 createEmptyCard）
    function freshCardAt(t) { return { state: "new", due: t, lapses: 0 }; }

    function stepChain(chain, rating, atMs) {
      // 双链同刻同评分推进：refChain（全字段内存对象）与 appChain（JSON 往返持久化状态）
      const at = new Date(atMs);
      const refIn = chain.ref === null ? createEmptyCard(at) : chain.ref;
      const refOut = ref.repeat(refIn, at)[GRADE[rating]].card;
      const aNext = fsrsEngine.next(chain.app, rating, atMs);
      const appNext = JSON.parse(JSON.stringify(aNext.fsrsState));
      chain.ref = refOut;
      chain.app = appNext;
      return { refCard: refOut, appNext };
    }

    function refSnapshot(card, atMs) {
      return {
        state: STATE_NAME[card.state],
        due: card.due.getTime(),
        lapses: card.lapses,
        stability: card.stability,
        difficulty: card.difficulty,
        reps: card.reps,
        learningSteps: card.learning_steps ?? 0,
        lastReview: card.last_review ? card.last_review.getTime() : null
      };
    }

    // 带断言的一轮：预览=落库同源 + 八字段与黄金参考精确相等
    function checkedRound(chain, rating, atMs, label) {
      const pv = fsrsEngine.preview(chain.app, atMs).find((p) => p.rating === rating).fsrsState;
      const nx = fsrsEngine.next(chain.app, rating, atMs).fsrsState;
      const pvStr = JSON.stringify(pv), nxStr = JSON.stringify(nx);
      check(`${label} 预览=落库（preview===next 同源）`, pvStr === nxStr, `preview=${pvStr} next=${nxStr}`);
      const { refCard, appNext } = stepChain(chain, rating, atMs);
      const g = refSnapshot(refCard, atMs);
      for (const k of FIELDS) {
        check(`${label} ${k}`, JSON.stringify(appNext[k]) === JSON.stringify(g[k]), `黄金=${JSON.stringify(g[k])} 应用=${JSON.stringify(appNext[k])}`);
      }
      return appNext;
    }

    const reviewLogs = []; // 供 S5 优化器输入链使用（真实剧本产生的日志）
    function collect(cardId, rating, atMs) { reviewLogs.push({ cardId, rating, reviewedAt: atMs }); }

    // ---------- S1a 新卡首评四分支 ----------
    section("S1a 新卡首评四分支（T0）");
    for (const rating of ["Again", "Hard", "Good", "Easy"]) {
      const chain = { ref: null, app: freshCardAt(T0) };
      checkedRound(chain, rating, T0, `首评 ${rating}`);
    }

    // ---------- S1b 全生命周期单卡剧本（跨约 70 天：步进→毕业→多轮→遗忘→恢复→逾期→长间隔） ----------
    section("S1b 全生命周期单卡剧本");
    const script = [
      { rating: "Good", late: 0, note: "首评→learning step1(+10m)" },
      { rating: "Good", late: 0, note: "step1 Good→毕业 Review" },
      { rating: "Good", late: 0, note: "Review 第2轮" },
      { rating: "Good", late: 3, note: "逾期3天复习" },
      { rating: "Again", late: 0, note: "遗忘→lapse1→relearning" },
      { rating: "Good", late: 0, note: "relearning 10m 恢复" },
      { rating: "Hard", late: 0, note: "Hard" },
      { rating: "Easy", late: 0, note: "Easy" },
      { rating: "Good", late: 30, note: "逾期30天复习（月级跨度）" },
      { rating: "Good", late: 0, note: "Good 累积" },
      { rating: "Good", late: 0, note: "Good 累积" },
      { rating: "Again", late: 0, note: "遗忘→lapse2" },
      { rating: "Good", late: 0, note: "relearning 恢复" },
      { rating: "Good", late: 1, note: "逾期1天收尾" }
    ];
    const chain = { ref: null, app: freshCardAt(T0) };
    let prevStability = 0;
    for (let i = 0; i < script.length; i++) {
      const step = script[i];
      const at = chain.app.due + step.late * DAY;
      const prev = chain.app;
      const st = checkedRound(chain, step.rating, at, `S1b#${i + 1} ${step.rating}${step.late ? `(+${step.late}d)` : ""}`);
      collect("sim-lifecycle", step.rating, at);
      if (step.rating === "Good") {
        // 跨天 Good 稳定度必增；同日（学习/重学步，elapsed=0）Good 稳定度不减（ts-fsrs 短期步不变 S）
        const crossDay = prev.lastReview == null || at - prev.lastReview >= DAY;
        if (crossDay) {
          check(`S1b#${i + 1} 跨天 Good 后稳定度增长（${prevStability.toFixed(3)} → ${st.stability.toFixed(3)}）`, st.stability > prevStability, `S 未增长: ${prevStability} → ${st.stability}`);
        } else {
          check(`S1b#${i + 1} 同日 Good 后稳定度不减（${prevStability.toFixed(3)} → ${st.stability.toFixed(3)}）`, st.stability >= prevStability, `S 下降: ${prevStability} → ${st.stability}`);
        }
      }
      if (step.rating === "Again") check(`S1b#${i + 1} Again 后 lapses>0`, st.lapses > 0, `lapses=${st.lapses}`);
      prevStability = st.stability;
    }
    {
      // 语义哨兵：learning 步进确实发生（第1轮 learningSteps=1、第2轮毕业 learningSteps=0）
      const c1chain = { ref: null, app: freshCardAt(T0) };
      const r1 = checkedRound(c1chain, "Good", T0, "哨兵 首评Good");
      check("哨兵 首评 Good → learningSteps=1", r1.learningSteps === 1, `learningSteps=${r1.learningSteps}`);
      check("哨兵 首评 Good → learning 态 +10m", r1.state === "learning" && r1.due - T0 === 10 * MIN, `state=${r1.state} offset=${r1.due - T0}`);
      const r2 = checkedRound(c1chain, "Good", r1.due, "哨兵 二评Good");
      check("哨兵 二评 Good → 毕业 Review 态（F7 修复语义）", r2.state === "review" && r2.learningSteps === 0, `state=${r2.state} learningSteps=${r2.learningSteps}`);
    }

    // ---------- S2 整体时间平移不变性（T0 / +10d / +100d） ----------
    section("S2 整体时间平移不变性");
    const shiftSeq = ["Good", "Good", "Good", "Again", "Good", "Hard", "Easy", "Good"];
    function runShifted(base) {
      const c = { ref: null, app: freshCardAt(base) };
      const rows = [];
      for (const rating of shiftSeq) {
        const at = c.app.due;
        const { appNext } = stepChain(c, rating, at);
        rows.push({ state: appNext.state, dueOffsetMs: appNext.due - at, stability: appNext.stability, difficulty: appNext.difficulty, reps: appNext.reps, lapses: appNext.lapses, learningSteps: appNext.learningSteps, lastReview: appNext.lastReview - at });
      }
      return rows;
    }
    const baseRows = runShifted(T0);
    const rows10 = runShifted(T0 + 10 * DAY);
    const rows100 = runShifted(T0 + 100 * DAY);
    check("S2 +10天平移：各轮相对结果完全一致", JSON.stringify(rows10) === JSON.stringify(baseRows), `diff=${JSON.stringify(rows10)} vs ${JSON.stringify(baseRows)}`);
    check("S2 +100天平移：各轮相对结果完全一致", JSON.stringify(rows100) === JSON.stringify(baseRows), `diff=${JSON.stringify(rows100)} vs ${JSON.stringify(baseRows)}`);
    for (let i = 0; i < shiftSeq.length; i++) {
      check(`S2 第${i + 1}轮 ${shiftSeq[i]} 平移前后 dueOffset/S/D 相等`,
        rows10[i].dueOffsetMs === baseRows[i].dueOffsetMs && rows10[i].stability === baseRows[i].stability && rows10[i].difficulty === baseRows[i].difficulty,
        `base=${JSON.stringify(baseRows[i])} +10d=${JSON.stringify(rows10[i])}`);
    }

    // ---------- S3 已并入 checkedRound（每轮 preview===next 同源断言） ----------

    // ---------- S4 遗忘链与 leech 阈值 ----------
    section("S4 遗忘链与 leech 阈值（lapses≥8）");
    {
      const c = { ref: null, app: freshCardAt(T0) };
      let st = checkedRound(c, "Good", T0, "S4 首评Good");
      collect("sim-leech", "Good", T0);
      st = checkedRound(c, "Good", st.due, "S4 毕业Good");
      collect("sim-leech", "Good", st.lastReview);
      check("S4 毕业后 lapses=0（isLeech=false）", st.lapses === 0 && !fsrsEngine.isLeech(st.lapses, 8), `lapses=${st.lapses}`);
      let lapseRounds = 0;
      for (let k = 0; k < 8; k++) {
        const at = st.due;
        st = checkedRound(c, "Again", at, `S4 遗忘#${k + 1}`);
        collect("sim-leech", "Again", at);
        lapseRounds++;
        check(`S4 遗忘#${k + 1} 后 due=+10m（relearning 档）`, st.due - /* 复习时刻 */(st.lastReview) === 10 * MIN, `offset=${st.due - st.lastReview}`);
        check(`S4 遗忘#${k + 1} 后 lapses=${k + 1}`, st.lapses === k + 1, `lapses=${st.lapses}`);
        const expectLeech = k + 1 >= 8;
        check(`S4 isLeech(${k + 1},8)=${expectLeech}`, fsrsEngine.isLeech(st.lapses, 8) === expectLeech, `实际=${fsrsEngine.isLeech(st.lapses, 8)}`);
        // relearning 恢复（Good → 回 Review）
        const atR = st.due;
        st = checkedRound(c, "Good", atR, `S4 恢复#${k + 1}`);
        collect("sim-leech", "Good", atR);
        check(`S4 恢复#${k + 1} 后回 Review 态`, st.state === "review", `state=${st.state}`);
      }
      check("S4 遗忘链共 8 次 lapse", lapseRounds === 8, `实际=${lapseRounds}`);
    }

    // ---------- S5 优化器训练输入链 ----------
    section("S5 优化器训练输入链（buildTrainSet 过滤规则 + 真实训练）");
    {
      // 5a 无效样本过滤：单次复习 / 全同日 / 无跨天前缀
      const filterDb = {
        listAllCards: () => [{ id: "sim-single" }, { id: "sim-sameday" }, { id: "sim-gap36h" }, { id: "sim-prefix" }],
        listAllReviewLogs: () => [
          { cardId: "sim-single", rating: "Good", reviewedAt: T0 },
          { cardId: "sim-sameday", rating: "Good", reviewedAt: T0 },
          { cardId: "sim-sameday", rating: "Good", reviewedAt: T0 + 5 * MIN },
          { cardId: "sim-sameday", rating: "Good", reviewedAt: T0 + 2 * HOUR },
          { cardId: "sim-gap36h", rating: "Good", reviewedAt: T0 },
          { cardId: "sim-gap36h", rating: "Good", reviewedAt: T0 + 36 * HOUR },
          { cardId: "sim-prefix", rating: "Good", reviewedAt: T0 },
          { cardId: "sim-prefix", rating: "Good", reviewedAt: T0 + 10 * MIN },
          { cardId: "sim-prefix", rating: "Good", reviewedAt: T0 + 2 * DAY }
        ]
      };
      const r = optimizer.buildTrainSet(filterDb);
      check("S5a 单次复习/全同日卡被过滤，仅跨天卡入选", r.cardCount === 2, `cardCount=${r.cardCount}（期望 2：gap36h + prefix）`);
      check("S5a reviewCount 统计完整（9 条有效评分，含被过滤卡的日志）", r.reviewCount === 9, `reviewCount=${r.reviewCount}`);
      const gapItem = r.items.find((it) => it.reviews.length === 2);
      check("S5a 36 小时间隔 → delta_t 向下取整=1 天", !!gapItem && gapItem.reviews[1].deltaT === 1 && gapItem.reviews[0].deltaT === 0, `deltaT=[${gapItem ? gapItem.reviews.map((x) => x.deltaT) : "无"}]`);
      const prefixItem = r.items.find((it) => it.reviews.length === 3);
      // v23 §4.4.8：delta_t=canonical 日历日差（与调度器 elapsed 同语义）——第 3 次复习距第 2 次 2 个日历日 → [0,0,2]（v20 旧语义 floor 为 [0,0,1]，已随语义统一更新）
      check("S5a 前缀展开：3 连评卡产出 1 个含跨天间隙的样本（deltaT=[0,0,2]，canonical 日历日语义）", !!prefixItem && JSON.stringify(prefixItem.reviews.map((x) => x.deltaT)) === "[0,0,2]", `实际=${prefixItem ? JSON.stringify(prefixItem.reviews.map((x) => x.deltaT)) : "无"}`);
      check("S5a 全部样本首条复习 delta_t=0 且含跨天间隙", r.items.every((it) => it.reviews[0].deltaT === 0 && it.reviews.some((x, j) => j > 0 && x.deltaT > 0)), "存在违规样本");

      // 5b 真实训练：L5 剧本日志 + 确定性合成卡（24 张 × 6-14 轮，1-30 天间隔）
      const rnd = mulberry32(20260909);
      const pickRating = () => { const x = rnd(); return x < 0.15 ? "Again" : x < 0.25 ? "Hard" : x < 0.8 ? "Good" : "Easy"; };
      const trainLogs = [...reviewLogs];
      let synthReviews = 0;
      for (let c = 0; c < 24; c++) {
        const id = `sim-synth-${c}`;
        let t = T0 + Math.floor(rnd() * 5) * DAY;
        const n = 6 + Math.floor(rnd() * 9);
        for (let i = 0; i < n; i++) {
          trainLogs.push({ cardId: id, rating: pickRating(), reviewedAt: t });
          synthReviews++;
          t += (i === 0 ? 0 : Math.max(1, Math.floor(rnd() * 30))) * DAY;
          if (i === 0) t += DAY; // 首评后至少跨 1 天
        }
      }
      const trainDb = { listAllCards: () => trainLogs.map((l) => l.cardId).filter((v, i, a) => a.indexOf(v) === i).map((id) => ({ id })), listAllReviewLogs: () => trainLogs };
      // F8 回归前置：训练集确实含「同日收尾」样本（学习/重学步恢复），evaluate 曾对此整体抛 InvalidInput
      const probeItems = optimizer.buildTrainSet(trainDb).items;
      const trailingZero = probeItems.filter((it) => it.reviews[it.reviews.length - 1].deltaT === 0);
      check("S5b 训练集含同日收尾样本（F8 触发路径在场）", trailingZero.length > 0, `同日收尾样本=${trailingZero.length}`);
      const tr = await optimizer.train(trainDb);
      check("S5b 全部合成卡进入训练", tr.cardCount === 2 + 24, `cardCount=${tr.cardCount}（期望 26：lifecycle+leech+24 合成）`);
      check("S5b 训练样本非空", tr.weights !== undefined && Array.isArray(tr.weights), `weights=${typeof tr.weights}`);
      check("S5b 权重为 21 维（FSRS-6）", tr.weights.length === 21, `len=${tr.weights.length}`);
      check("S5b 权重全部为有限数值", tr.weights.every((x) => typeof x === "number" && Number.isFinite(x)), `weights=${JSON.stringify(tr.weights)}`);
      check("S5b evaluate 产出 logLoss（有限数）", typeof tr.logLoss === "number" && Number.isFinite(tr.logLoss), `logLoss=${tr.logLoss}`);
      check("S5b evaluate 产出 rmseBins", tr.rmseBins !== undefined && tr.rmseBins !== null, `rmseBins=${typeof tr.rmseBins}`);

      // 5c 权重校验（v23：应用走 fsrs_configs 快照 + 指针，S7 端到端验证；此处只验校验函数）
      let threw = false;
      try { optimizer.validateWeights(new Array(20).fill(1)); } catch { threw = true; }
      check("S5c validateWeights 拒绝非 21 维", threw, "未抛错");
      let threwNan = false;
      try { optimizer.validateWeights(new Array(21).fill(NaN)); } catch { threwNan = true; }
      check("S5c validateWeights 拒绝非有限数值", threwNan, "未抛错");
      const validated = optimizer.validateWeights(tr.weights);
      check("S5c validateWeights 接受 21 维并归一化", Array.isArray(validated) && validated.length === 21 && validated.every((x) => Number.isFinite(x)), `len=${validated && validated.length}`);
    }

    // ---------- S6 时间语义（v23 §4.4.8：canonical delta_t ↔ ts-fsrs 行为级 oracle ↔ 学习日仅统计） ----------
    section("S6 时间语义（L6 三层 + 负测试）");
    {
      // L6-A：独立实现的 calculateFsrsDeltaT 必须与 ts-fsrs 调度器实际采用的 elapsed_days 精确一致。
      // oracle 构造：新卡在 T1 评一次（last_review=T1），再在 T2 复习——返回的 log.elapsed_days 即调度器当时的 elapsed。
      const pairs = [
        { name: "同日 +10 分钟", t1: T0, t2: T0 + 10 * MIN },
        { name: "跨午夜（UTC 23:50→00:10）", t1: Date.UTC(2025, 0, 1, 23, 50), t2: Date.UTC(2025, 0, 2, 0, 10) },
        { name: "跨月（1月31→2月1）", t1: Date.UTC(2025, 0, 31, 12, 0), t2: Date.UTC(2025, 1, 1, 12, 0) },
        { name: "跨年（12月31→1月1）", t1: Date.UTC(2025, 11, 31, 12, 0), t2: Date.UTC(2026, 0, 1, 12, 0) },
        { name: "36 小时", t1: T0, t2: T0 + 36 * 3600000 },
        { name: "整月", t1: T0, t2: T0 + 30 * DAY },
        { name: "零间隔", t1: T0, t2: T0 }
      ];
      for (const p of pairs) {
        const c1 = ref.repeat(createEmptyCard(new Date(p.t1)), new Date(p.t1))[Rating.Good].card;
        const out = ref.repeat(c1, new Date(p.t2))[Rating.Good];
        check(`S6-A ${p.name}: canonical == 调度器 elapsed（${out.log.elapsed_days}）`, out.log.elapsed_days === calculateFsrsDeltaT(p.t1, p.t2), `oracle=${out.log.elapsed_days} canonical=${calculateFsrsDeltaT(p.t1, p.t2)}`);
      }

      // L6-B：optimizer buildTrainSet 的 delta_t 与 oracle 同源（跨午夜对专抓 floor(24h) 分叉）
      const crossPairLogs = [
        { cardId: "sim-l6b", rating: "Good", reviewedAt: Date.UTC(2025, 0, 1, 23, 50) },
        { cardId: "sim-l6b", rating: "Good", reviewedAt: Date.UTC(2025, 0, 2, 0, 10) },
        { cardId: "sim-l6b2", rating: "Good", reviewedAt: T0 },
        { cardId: "sim-l6b2", rating: "Good", reviewedAt: T0 + 2 * DAY }
      ];
      const l6b = optimizer.buildTrainSet({ listAllCards: () => [{ id: "sim-l6b" }, { id: "sim-l6b2" }], listAllReviewLogs: () => crossPairLogs });
      const l6bDeltas = l6b.items.map((it) => it.reviews.map((r) => r.deltaT).join(",")).sort();
      const oracleCross = calculateFsrsDeltaT(Date.UTC(2025, 0, 1, 23, 50), Date.UTC(2025, 0, 2, 0, 10));
      const oracle2d = calculateFsrsDeltaT(T0, T0 + 2 * DAY);
      check(`S6-B 跨午夜对 delta_t=oracle（${oracleCross}，非 floor 的 0）`, l6bDeltas.includes(`0,${oracleCross}`) && oracleCross === 1, `期望含 0,${oracleCross} 实际=${JSON.stringify(l6bDeltas)}`);
      check(`S6-B 两天间隔 delta_t=oracle（${oracle2d}）`, l6bDeltas.includes(`0,${oracle2d}`) && oracle2d === 2, `期望含 0,${oracle2d} 实际=${JSON.stringify(l6bDeltas)}`);

      // 负测试：构造 bad 实现（floor 24h 旧算法），证明「第二套日期算法」会被抓出（L6-B 必红）
      const badDeltaT = (p, c) => Math.floor((c - p) / DAY);
      const badCross = badDeltaT(Date.UTC(2025, 0, 1, 23, 50), Date.UTC(2025, 0, 2, 0, 10));
      check("S6-负测试 bad(floor) 与 canonical 在跨午夜对分歧（检测器必红）", badCross !== oracleCross && oracleCross === 1, `bad=${badCross} canonical=${oracleCross}`);

      // L6-C：学习日（D21，仅统计口径）与 FSRS 时间语义分离
      const baseLocal = new Date(2025, 0, 1, 23, 50).getTime(); // 本地 23:50
      const nextLocal = new Date(2025, 0, 2, 0, 10).getTime();  // 本地次日 00:10
      check("S6-C 切点=0：跨午夜是两个学习日", learningDayIndex(nextLocal, 0) - learningDayIndex(baseLocal, 0) === 1, learningDayIndex(nextLocal, 0) - learningDayIndex(baseLocal, 0));
      check("S6-C 切点=4：同属前一学习日（凌晨不算新一天，D21）", learningDayIndex(nextLocal, 4) === learningDayIndex(baseLocal, 4), `${learningDayIndex(baseLocal, 4)} vs ${learningDayIndex(nextLocal, 4)}`);
      const early = new Date(2025, 0, 2, 3, 50).getTime();
      const late = new Date(2025, 0, 2, 4, 10).getTime();
      check("S6-C 切点=4：切点穿越（03:50 前日 / 04:10 当日）", learningDayIndex(late, 4) - learningDayIndex(early, 4) === 1, learningDayIndex(late, 4) - learningDayIndex(early, 4));
      check("S6-C 学习日起点：切点=4 时同日两点同一起点", learningDayStartMs(nextLocal, 4) === learningDayStartMs(baseLocal, 4), `${learningDayStartMs(baseLocal, 4)} vs ${learningDayStartMs(nextLocal, 4)}`);
    }

    // ---------- S7 参数环境（v23 D20/§4.4.10：不可变快照 + 指针 + 审计归属，端到端） ----------
    section("S7 参数环境（fsrs_configs + 指针 + 审计归属）");
    {
      const db = require(path.join(__dirname, "..", "..", "electron", "db.js"));
      await db.initDb();
      // 播种 tripwire：cfg-default 权重必须与 live ts-fsrs 默认逐位一致（升级依赖即红）
      const defCfg = db.getActiveFsrsConfig();
      check("S7 播种 cfg-default", !!defCfg && defCfg.id === DEFAULT_CONFIG_ID && defCfg.source === "default", defCfg && defCfg.id);
      check("S7 cfg-default 权重 == live ts-fsrs 默认（升级绊线）", JSON.stringify(defCfg.weights) === JSON.stringify(tsfs.generatorParameters().w), "须逐位一致");
      check("S7 cfg-default options == 锁定快照", JSON.stringify(defCfg.schedulerOptions) === JSON.stringify(DEFAULT_SCHEDULER_OPTIONS), JSON.stringify(defCfg.schedulerOptions));

      const X = db.createCard({ noteText: "FSRSTEST S7-X", cardType: "qa", frontMarkdown: "S7-X", backMarkdown: "A", priority: 50, tags: [] }).id;
      const Y = db.createCard({ noteText: "FSRSTEST S7-Y", cardType: "qa", frontMarkdown: "S7-Y", backMarkdown: "A", priority: 50, tags: [] }).id;
      const afterY = { state: "review", due: T0 + 3 * DAY, lapses: 0, stability: 3.1, difficulty: 4.9, reps: 1, lastReview: T0, learningSteps: 0 };
      db.saveReview(Y, afterY, "Good", 10, { state: "new", due: T0, lapses: 0, stability: 0, difficulty: 0, reps: 0, lastReview: null, learningSteps: 0 });
      check("S7 默认配置评分：log.config=cfg-default", db.listAllReviewLogs().find((l) => l.cardId === Y).fsrsConfigId === DEFAULT_CONFIG_ID, "cfg-default");
      const yLogBefore = JSON.stringify(db.listAllReviewLogs().find((l) => l.cardId === Y));

      // 应用权重 B（默认 ×1.3 偏移，确保与默认指纹不同）
      const WB = FSRS6_DEFAULT_WEIGHTS.map((x) => Math.round((x * 1.3 + 0.01) * 1e6) / 1e6);
      const allCardsBefore = db.listAllCards().map((c) => ({ id: c.id, fsrs: JSON.stringify(c.fsrs), cfg: c.fsrsConfigId }));
      const defRowBefore = JSON.stringify(db.getConfigRow(DEFAULT_CONFIG_ID));
      const applyB = optimizer.applyWeights(db, WB);
      check("S7 apply B → 新 config id", applyB.ok === true && applyB.configId && applyB.configId !== DEFAULT_CONFIG_ID, applyB.configId);
      const cfgBRow = db.getConfigRow(applyB.configId);
      check("S7 cfg-B 行：source=optimizer、权重=WB、options=锁定快照", cfgBRow.source === "optimizer" && JSON.stringify(cfgBRow.weights) === JSON.stringify(WB) && JSON.stringify(cfgBRow.schedulerOptions) === JSON.stringify(DEFAULT_SCHEDULER_OPTIONS), JSON.stringify(cfgBRow));
      check("S7 存量卡 fsrs_json 与 fsrs_config_id 全部未变（apply 不回算）", db.listAllCards().every((c) => { const b = allCardsBefore.find((x) => x.id === c.id); return b && JSON.stringify(c.fsrs) === b.fsrs && c.fsrsConfigId === b.cfg; }), "byte-equal");
      check("S7 cfg-default 行逐字节未变（不可变）", JSON.stringify(db.getConfigRow(DEFAULT_CONFIG_ID)) === defRowBefore, "immutable");
      check("S7 默认配置下的旧评分日志未被改写", JSON.stringify(db.listAllReviewLogs().find((l) => l.cardId === Y)) === yLogBefore, yLogBefore);

      // B 配置下评分 X：log/卡归属 = cfg-B
      const afterX = { state: "review", due: T0 + 5 * DAY, lapses: 0, stability: 3.9, difficulty: 4.7, reps: 1, lastReview: T0, learningSteps: 0 };
      db.saveReview(X, afterX, "Good", 10, { state: "new", due: T0, lapses: 0, stability: 0, difficulty: 0, reps: 0, lastReview: null, learningSteps: 0 });
      const xLog = db.listAllReviewLogs().find((l) => l.cardId === X);
      check("S7 B 配置下评分：log.config=cfg-B 且卡归属=cfg-B", xLog.fsrsConfigId === applyB.configId && db.getCard(X).fsrsConfigId === applyB.configId, applyB.configId);

      // 撤销 X：fsrs 恢复 before，config 恢复 fsrs_before_config_id（cfg-default）
      const beforeXState = { state: "new", due: T0, lapses: 0, stability: 0, difficulty: 0, reps: 0, lastReview: null, learningSteps: 0 };
      const undoX = db.undoLastReview();
      check("S7 undo X ok 且 fsrs 恢复 before", undoX.ok === true && JSON.stringify(undoX.card.fsrs) === JSON.stringify(beforeXState), JSON.stringify(undoX.ok ? undoX.card.fsrs : undoX));
      check("S7 undo 后卡 config 恢复 fsrs_before_config_id", db.getCard(X).fsrsConfigId === DEFAULT_CONFIG_ID, DEFAULT_CONFIG_ID);

      // 指纹去重：再次 apply 相同 B → 同一 config id（不插重复行）
      const reApply = optimizer.applyWeights(db, WB);
      check("S7 相同配置去重重指（同 config id）", reApply.configId === applyB.configId, reApply.configId);

      // reset = 指针回 cfg-default（不插重复 default 行）
      const resetR = optimizer.resetWeights(db);
      check("S7 reset → 指回 cfg-default", resetR.ok === true && resetR.configId === DEFAULT_CONFIG_ID && db.getActiveFsrsConfig().id === DEFAULT_CONFIG_ID, resetR.configId);

      // 不可变：无 update API
      check("S7 fsrs_configs 无更新 API（不可变约束）", typeof db.updateFsrsConfig === "undefined" && typeof db.updateConfig === "undefined", "undefined");

      db.deleteCard(X);
      db.deleteCard(Y);
    }

    // ---------- S8 F9 热生效（完整快照构引擎 + 推送重载 + 锁定项校验拒绝） ----------
    section("S8 F9 引擎热生效（configId 变更重建/未变跳过/非法配置拒绝）");
    {
      const opts = DEFAULT_SCHEDULER_OPTIONS;
      global.window = {
        fsrsAPI: {
          getActiveConfig: async () => ({ id: "cfg-S8-A", weights: FSRS6_DEFAULT_WEIGHTS, schedulerOptions: opts })
        }
      };
      check("S8 首次 reloadEngine 应用配置 A", (await fsrsEngine.reloadEngine()) === true && fsrsEngine.activeConfigId() === "cfg-S8-A", fsrsEngine.activeConfigId());
      const ivlA = fsrsEngine.next({ state: "new", due: Date.now(), lapses: 0 }, "Easy").fsrsState.due - Date.now();
      global.window.fsrsAPI.getActiveConfig = async () => ({ id: "cfg-S8-B", weights: FSRS6_DEFAULT_WEIGHTS.map((x) => Math.round((x * 1.3 + 0.01) * 1e6) / 1e6), schedulerOptions: opts });
      check("S8 configId 变更 → 重建引擎", (await fsrsEngine.reloadEngine()) === true && fsrsEngine.activeConfigId() === "cfg-S8-B", fsrsEngine.activeConfigId());
      const ivlB = fsrsEngine.next({ state: "new", due: Date.now(), lapses: 0 }, "Easy").fsrsState.due - Date.now();
      check("S8 新权重改变调度结果（间隔随权重变化）", ivlA !== ivlB, `A=${ivlA} B=${ivlB}`);
      const again = await fsrsEngine.reloadEngine();
      check("S8 configId 未变 → 跳过重建（返回 false）", again === false && fsrsEngine.activeConfigId() === "cfg-S8-B", `again=${again}`);
      global.window.fsrsAPI.getActiveConfig = async () => ({ id: "cfg-S8-BAD", weights: new Array(20).fill(1), schedulerOptions: opts });
      check("S8 非法配置（20 维）拒绝且引擎保持", (await fsrsEngine.reloadEngine()) === false && fsrsEngine.activeConfigId() === "cfg-S8-B", fsrsEngine.activeConfigId());
      global.window.fsrsAPI.getActiveConfig = async () => ({ id: "cfg-S8-FUZZ", weights: FSRS6_DEFAULT_WEIGHTS, schedulerOptions: { ...opts, enableFuzz: true } });
      check("S8 enableFuzz≠false 的配置拒绝（§4.4.2 锁定项校验）", (await fsrsEngine.reloadEngine()) === false && fsrsEngine.activeConfigId() === "cfg-S8-B", fsrsEngine.activeConfigId());
      delete global.window;
    }

    console.log(`\nL5 时间轴模拟 完成：${pass} 通过 / ${fail} 失败`);
    app.exit(fail ? 1 : 0);
  } catch (e) {
    console.error("FATAL:", e);
    app.exit(1);
  }
});

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
