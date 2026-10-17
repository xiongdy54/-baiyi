// @runtime: node
// 材料导图 v2 调度器回归（node tests/m15v2.scheduler.test.cjs）。依据 IMPL-PLAN §4.8 / §6 T3「调度器」验收：
// 抢占 / 提档 / 去重 / 同节点互斥 / 429 降半冷却 + 阶梯升档（假时钟）/ 取消不影响已完成。
const path = require("path");
const { createScheduler, PRIORITY } = require(path.join(__dirname, "..", "electron", "mindmapScheduler.js"));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "").slice(0, 400)}`); }
}
const tick = () => new Promise((r) => setImmediate(r));
const J = (x) => JSON.stringify(x);

// 可手动放行的任务
function gate() {
  let open;
  const p = new Promise((r) => { open = r; });
  return { p, open };
}

async function main() {
  console.log("---- 优先级 / 抢占 / FIFO ----");
  {
    const s = createScheduler({ maxConcurrency: 1 });
    const log = [];
    const g0 = gate();
    s.enqueue({ key: "a", priority: PRIORITY.OUTLINE, run: async () => { log.push("a"); await g0.p; } });
    s.enqueue({ key: "b", priority: PRIORITY.OUTLINE, run: async () => { log.push("b"); } });
    s.enqueue({ key: "c", priority: PRIORITY.ALL, run: async () => { log.push("c"); } });
    await tick();
    s.enqueue({ key: "d", priority: PRIORITY.CLICK, run: async () => { log.push("d"); } });
    s.enqueue({ key: "e", priority: PRIORITY.PREFETCH, run: async () => { log.push("e"); } });
    await tick();
    check("运行中的任务不被中止（a 仍独占）", J(log) === J(["a"]), log);
    g0.open();
    await s.idle();
    check("排队抢占：P0 > P1 > P2(FIFO) > P3", J(log) === J(["a", "d", "e", "b", "c"]), log);
  }
  {
    const s = createScheduler({ maxConcurrency: 1 });
    const log = [];
    s.enqueue({ key: "x", priority: 2, run: async () => log.push("x") });
    s.enqueue({ key: "y", priority: 0, run: async () => log.push("y") });
    await s.idle();
    check("同一同步段入队：按优先级挑选（微任务启动）", J(log) === J(["y", "x"]), log);
  }

  console.log("---- 去重 / 提档 ----");
  {
    const s = createScheduler({ maxConcurrency: 1 });
    const log = [];
    const g0 = gate();
    s.enqueue({ key: "busy", priority: 0, run: async () => { await g0.p; } });
    const r1 = s.enqueue({ key: "k", priority: PRIORITY.ALL, meta: { jobId: "J1" }, run: async () => { log.push("k1"); return 7; } });
    const r2 = s.enqueue({ key: "k", priority: PRIORITY.ALL, meta: { jobId: "J2" }, run: async () => { log.push("k2"); return 8; } });
    s.enqueue({ key: "o1", priority: PRIORITY.OUTLINE, run: async () => log.push("o1") });
    const r3 = s.enqueue({ key: "k", priority: PRIORITY.CLICK, run: async () => { log.push("k3"); } });
    check("同 key 再入队 → deduped，返回首个 meta 与同一 promise", r1.status === "queued" && r2.status === "deduped" && r2.meta.jobId === "J1" && r2.promise === r1.promise);
    check("高优先级同 key → promoted", r3.status === "promoted" && r3.promise === r1.promise);
    g0.open();
    const v = await r1.promise;
    await s.idle();
    check("提档后先于 P2 运行、只跑首个 run（去重）", J(log) === J(["k1", "o1"]) && v === 7, log);
    const r4 = s.enqueue({ key: "k", priority: 0, run: async () => 9 });
    check("完成后同 key 可再次入队", r4.status === "queued" && (await r4.promise) === 9);
    const g1 = gate();
    const rr = s.enqueue({ key: "run", priority: 3, run: async () => { await g1.p; return 1; } });
    await tick();
    const rr2 = s.enqueue({ key: "run", priority: 0, run: async () => 2 });
    check("运行中同 key → deduped（不提档、不重跑）", rr2.status === "deduped" && rr2.promise === rr.promise);
    g1.open();
    await s.idle();
  }

  console.log("---- 同节点互斥（lockKey） ----");
  {
    const s = createScheduler({ maxConcurrency: 4 });
    let live = 0, maxLive = 0;
    const log = [];
    const mk = (name, lock, ms) => s.enqueue({ key: name, priority: 0, lockKey: lock, run: async () => {
      live++; maxLive = Math.max(maxLive, live); log.push("+" + name);
      await new Promise((r) => setTimeout(r, ms));
      log.push("-" + name); live--;
    } });
    mk("n1a", "m|n1", 20);
    mk("n1b", "m|n1", 5);
    mk("n2", "m|n2", 5);
    await s.idle();
    check("同 lockKey 串行（n1b 在 n1a 结束后才开始）", log.indexOf("+n1b") > log.indexOf("-n1a"), log);
    check("被锁任务不阻塞其它任务（n2 与 n1a 并行）", log.indexOf("+n2") < log.indexOf("-n1a") && maxLive === 2, log);
  }

  console.log("---- 429：减半 + 冷却 + 阶梯升档（假时钟） ----");
  {
    let clock = 1000;
    const s = createScheduler({ maxConcurrency: 4, now: () => clock, cooldownMs: 60000 });
    const ok = (k) => s.enqueue({ key: k, priority: 2, run: async () => "ok" }).promise;
    check("起始档＝配置值 4", s.stats().concurrencyNow === 4);
    // 同批 4 个任务同时 429：只降一档
    const burst = [];
    for (let i = 0; i < 4; i++) burst.push(s.enqueue({ key: "rl" + i, priority: 2, run: async (_sig, ctl) => { await tick(); ctl.reportRateLimit(); return "late"; } }).promise);
    await Promise.all(burst);
    check("同档期 4 个 429 → 只减半一次 4→2", s.stats().concurrencyNow === 2 && s.stats().rateLimitDowngrades === 1, s.stats());
    // 新档期再报（抛 rate_limit 错误同样算）
    const p = s.enqueue({ key: "rlx", priority: 2, run: async () => { const e = new Error("429"); e.code = "rate_limit"; throw e; } }).promise;
    let code = null;
    try { await p; } catch (e) { code = e.code; }
    check("抛 rate_limit → 再减半 2→1，错误原样 reject", code === "rate_limit" && s.stats().concurrencyNow === 1 && s.stats().rateLimitDowngrades === 2, s.stats());
    // 冷却期内成功不升档
    for (let i = 0; i < 5; i++) await ok("c" + i);
    check("冷却期内成功不升档", s.stats().concurrencyNow === 1);
    // 并发真的被限到 1
    let live = 0, maxLive = 0;
    const ps = [];
    for (let i = 0; i < 4; i++) ps.push(s.enqueue({ key: "lim" + i, priority: 2, run: async () => { live++; maxLive = Math.max(maxLive, live); await tick(); live--; } }).promise);
    await Promise.all(ps);
    check("降档后同时运行 ≤1", maxLive === 1, maxLive);
    clock += 60001;
    await ok("u1"); await ok("u2");
    check("冷却后 2 次成功尚不升档", s.stats().concurrencyNow === 1);
    await ok("u3");
    check("冷却后连续 3 次成功升一档 1→2", s.stats().concurrencyNow === 2);
    for (let i = 0; i < 3; i++) await ok("v" + i);
    check("再 3 次 2→3", s.stats().concurrencyNow === 3);
    for (let i = 0; i < 9; i++) await ok("w" + i);
    check("升至配置值 4 封顶", s.stats().concurrencyNow === 4);
    s.setMaxConcurrency(2);
    check("setMaxConcurrency 下调立即生效", s.stats().concurrencyNow === 2 && s.stats().maxConcurrency === 2);
    s.setMaxConcurrency(99);
    check("上限夹到 8", s.stats().maxConcurrency === 8);
    // 失败（非 429）打断连续成功计数
    clock += 1;
    const s2 = createScheduler({ maxConcurrency: 2, now: () => clock, cooldownMs: 10 });
    await s2.enqueue({ key: "r", priority: 0, run: async (_s, c) => c.reportRateLimit() }).promise;
    clock += 11;
    await s2.enqueue({ key: "a", priority: 0, run: async () => 1 }).promise;
    await s2.enqueue({ key: "b", priority: 0, run: async () => 1 }).promise;
    try { await s2.enqueue({ key: "f", priority: 0, run: async () => { throw new Error("x"); } }).promise; } catch {}
    await s2.enqueue({ key: "c", priority: 0, run: async () => 1 }).promise;
    check("非 429 失败不计入成功（仍为 1 档）", s2.stats().concurrencyNow === 1, s2.stats());
  }

  console.log("---- 取消 ----");
  {
    const s = createScheduler({ maxConcurrency: 1 });
    const done = await s.enqueue({ key: "done", priority: 0, meta: { runId: "R" }, run: async () => "fin" }).promise;
    let sawAbort = null;
    const g0 = gate();
    const running = s.enqueue({ key: "run", priority: 0, meta: { runId: "R" }, run: (signal) => new Promise((res, rej) => {
      signal.addEventListener("abort", () => { sawAbort = signal.reason && signal.reason.code; rej(signal.reason); });
      g0.p.then(res);
    }) });
    const q1 = s.enqueue({ key: "q1", priority: 2, meta: { runId: "R" }, run: async () => "q1" });
    const q2 = s.enqueue({ key: "q2", priority: 2, meta: { runId: "S" }, run: async () => "q2" });
    await tick();
    check("cancel 已完成的 key → false", s.cancel("done") === false && done === "fin");
    let c1 = null;
    q1.promise.catch((e) => { c1 = e.code; });
    const n = s.cancelWhere((i) => i.meta.runId === "R");
    await tick();
    check("cancelWhere 命中运行中 + 排队中各一（已完成不计）", n === 2, n);
    check("运行中被 abort（reason.code=cancelled）", sawAbort === "cancelled");
    check("排队中被移除并 reject cancelled", c1 === "cancelled" && s.status("q1") === null);
    let rc = null;
    try { await running.promise; } catch (e) { rc = e.code; }
    check("运行中任务的 promise 以 cancelled 结束", rc === "cancelled");
    check("其它 run 的排队任务不受影响", (await q2.promise) === "q2");
    check("cancel 不存在的 key → false", s.cancel("nope") === false);
    await s.idle();
    check("stats 收敛为空", s.stats().running === 0 && s.stats().queued === 0);
    // 取消的运行中任务不算成功（不升档）
    check("entries() 为空", s.entries().length === 0);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.log(e && e.stack); process.exit(1); });
