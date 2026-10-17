// @runtime: node
"use strict";
// 材料导图 v2 · 任务调度器（D192 / MINDMAP-V2-IMPL-PLAN §4.8）。纯 CommonJS、零依赖；时钟与计时器注入，node 可测。
//
// ===================== 导出 =====================
//   PRIORITY = { CLICK:0, EXPLAIN:0, PREFETCH:1, OUTLINE:2, ALL:3 }   数字越小越先
//   createScheduler({ maxConcurrency=4, now=Date.now, cooldownMs=60000, upgradeAfter=3 }) -> Scheduler
//       （冷却只按注入时钟判定，升档由成功事件驱动，故无需计时器；测试用假时钟即可覆盖冷却/阶梯）
//
// Scheduler
//   enqueue({ key, priority, lockKey?, meta?, run(signal, ctl) }) -> { key, status, promise, meta }
//       status: 'queued'（新入队）| 'promoted'（同 key 已排队且本次优先级更高 → 提档）| 'deduped'（同 key 已排队/运行，原样返回）
//       promise：run 的结果（resolve 返回值 / reject 抛出的错误；排队中被取消 → reject Error{code:'cancelled'}）。
//                返回的 promise 已挂空 catch，调用方不处理也不会产生 unhandledRejection。
//       meta：任意对象（同 key 去重时返回首个入队者的 meta），供 cancelWhere 谓词与调用方取 jobId。
//       run(signal, ctl)：signal＝AbortSignal（运行中取消即 abort，reason＝Error{code:'cancelled'}）；
//                        ctl.reportRateLimit()＝报告 429（任务内重试时即可报，不必等失败）。
//                        抛出 err.code==='rate_limit' 也视为报告。
//   cancel(key) -> boolean          排队中：移除并 reject；运行中：abort；已完成/不存在：false（已完成不受影响）
//   cancelWhere(pred(info)) -> number   info = { key, priority, lockKey, meta, status:'queued'|'running' }
//   setMaxConcurrency(n)            设置上限（夹 1–8）；当前档不超过新上限
//   status(key) -> 'queued'|'running'|null
//   entries() -> info[]             排队序（优先级、序号）在前、运行中在后
//   stats() -> { running, queued, concurrencyNow, maxConcurrency, rateLimitDowngrades, cooldownUntil }
//   idle() -> Promise<void>         队列空且无运行中任务时 resolve
//
// 规则
//   · 优先级 P0 点击深挖/explain > P1 悬停预取 > P2 首轮 outline > P3 深挖全部；同级 FIFO（单调序号，确定性）。
//   · 「抢占」＝排队抢占：高优先级后到者先于已排队的低优先级者启动；不中止已在运行的任务。
//   · 提档：同 key 已排队的低优先级任务被高优先级请求提到新级别（重新取序号＝新级别内 FIFO 末尾）。
//   · 同 lockKey 串行：同节点同时只跑一个；被锁住的任务跳过，不阻塞其它任务。
//   · 并发阶梯：起始＝maxConcurrency；报告 429 → 当前档减半（≥1）＋ cooldownMs 冷却；同一「档期」内启动的任务
//     重复报告只算一次（一次突发 4 个 429 只降一档）；冷却结束后连续 upgradeAfter 次成功升一档，直至上限。
//   · 启动在微任务中进行（enqueue 同步返回后统一挑选），同一同步段内入队的任务按优先级挑选，结果确定。

const PRIORITY = Object.freeze({ CLICK: 0, EXPLAIN: 0, PREFETCH: 1, OUTLINE: 2, ALL: 3 });

function clampConc(n, d) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.max(1, Math.min(8, v)) : d;
}

function cancelledError() {
  const e = new Error("已取消");
  e.code = "cancelled";
  return e;
}

function createScheduler(opts) {
  const o = opts || {};
  const now = typeof o.now === "function" ? o.now : () => Date.now();
  const cooldownMs = Number.isFinite(Number(o.cooldownMs)) ? Number(o.cooldownMs) : 60000;
  const upgradeAfter = Math.max(1, Number(o.upgradeAfter) || 3);
  let maxConc = clampConc(o.maxConcurrency, 4);
  let current = maxConc;
  let cooldownUntil = 0;
  let streak = 0;
  let epoch = 0; // 每次降档 +1
  let downgrades = 0;
  let seq = 0;
  let pumpScheduled = false;

  const queued = []; // entry（未排序；挑选时按 priority, seq）
  const running = new Map(); // key → entry
  const byKey = new Map(); // key → entry（queued 或 running）
  const locks = new Set();
  let idleWaiters = [];

  function info(e) {
    return { key: e.key, priority: e.priority, lockKey: e.lockKey, meta: e.meta, status: e.status };
  }

  function schedulePump() {
    if (pumpScheduled) return;
    pumpScheduled = true;
    queueMicrotask(() => {
      pumpScheduled = false;
      pump();
    });
  }

  function order(a, b) {
    return a.priority - b.priority || a.seq - b.seq;
  }

  function pump() {
    queued.sort(order);
    let i = 0;
    while (running.size < current && i < queued.length) {
      const e = queued[i];
      if (e.lockKey != null && locks.has(e.lockKey)) { i++; continue; }
      queued.splice(i, 1);
      start(e);
    }
    checkIdle();
  }

  function start(e) {
    e.status = "running";
    e.epoch = epoch;
    e.controller = new AbortController();
    running.set(e.key, e);
    if (e.lockKey != null) locks.add(e.lockKey);
    let limited = false;
    const ctl = {
      reportRateLimit() {
        if (limited) return;
        limited = true;
        onRateLimit(e);
      },
    };
    let p;
    try {
      p = Promise.resolve(e.run(e.controller.signal, ctl));
    } catch (err) {
      p = Promise.reject(err);
    }
    p.then(
      (v) => finish(e, null, v, limited),
      (err) => {
        if (err && err.code === "rate_limit") ctl.reportRateLimit();
        finish(e, err, undefined, true);
      }
    );
  }

  function onRateLimit(e) {
    if (e.epoch !== epoch) return; // 降档前启动的同批任务：只算一次
    const next = Math.max(1, Math.floor(current / 2));
    epoch++;
    downgrades++;
    current = next;
    streak = 0;
    cooldownUntil = now() + cooldownMs;
  }

  function finish(e, err, value, noSuccess) {
    running.delete(e.key);
    if (byKey.get(e.key) === e) byKey.delete(e.key);
    if (e.lockKey != null) locks.delete(e.lockKey);
    e.status = "done";
    const aborted = e.controller && e.controller.signal.aborted;
    if (!err && !noSuccess && !aborted) {
      if (now() >= cooldownUntil) {
        streak++;
        if (streak >= upgradeAfter && current < maxConc) {
          current++;
          streak = 0;
        }
      }
    } else if (!aborted) {
      streak = 0; // 失败打断「连续成功」；取消不计
    }
    if (err) e.reject(err);
    else e.resolve(value);
    schedulePump();
  }

  function checkIdle() {
    if (!queued.length && !running.size && idleWaiters.length) {
      const ws = idleWaiters;
      idleWaiters = [];
      for (const w of ws) w();
    }
  }

  function enqueue(t) {
    if (!t || t.key == null || typeof t.run !== "function") throw new Error("enqueue 需要 key 与 run");
    const key = String(t.key);
    const priority = Number.isFinite(Number(t.priority)) ? Number(t.priority) : PRIORITY.OUTLINE;
    const ex = byKey.get(key);
    if (ex) {
      if (ex.status === "queued" && priority < ex.priority) {
        ex.priority = priority;
        ex.seq = ++seq;
        schedulePump();
        return { key, status: "promoted", promise: ex.publicPromise, meta: ex.meta };
      }
      return { key, status: "deduped", promise: ex.publicPromise, meta: ex.meta };
    }
    const e = {
      key, priority, seq: ++seq, lockKey: t.lockKey == null ? null : String(t.lockKey), meta: t.meta || {},
      run: t.run, status: "queued", controller: null, epoch: 0,
    };
    e.promise = new Promise((res, rej) => { e.resolve = res; e.reject = rej; });
    e.promise.catch(() => {});
    e.publicPromise = e.promise;
    queued.push(e);
    byKey.set(key, e);
    schedulePump();
    return { key, status: "queued", promise: e.publicPromise, meta: e.meta };
  }

  function cancelEntry(e) {
    if (e.status === "queued") {
      const i = queued.indexOf(e);
      if (i >= 0) queued.splice(i, 1);
      if (byKey.get(e.key) === e) byKey.delete(e.key);
      e.status = "done";
      e.reject(cancelledError());
      schedulePump();
      return true;
    }
    if (e.status === "running") {
      if (!e.controller.signal.aborted) e.controller.abort(cancelledError());
      return true;
    }
    return false;
  }

  function cancel(key) {
    const e = byKey.get(String(key));
    return e ? cancelEntry(e) : false;
  }

  function cancelWhere(pred) {
    let n = 0;
    for (const e of [...byKey.values()]) {
      if (pred(info(e)) && cancelEntry(e)) n++;
    }
    return n;
  }

  function setMaxConcurrency(n) {
    maxConc = clampConc(n, maxConc);
    if (current > maxConc) current = maxConc;
    // 未降过档且未冷却：直接跟随新上限
    if (downgrades === 0 && now() >= cooldownUntil) current = maxConc;
    schedulePump();
  }

  function status(key) {
    const e = byKey.get(String(key));
    return e ? e.status : null;
  }

  function entries() {
    return queued.slice().sort(order).map(info).concat([...running.values()].map(info));
  }

  function stats() {
    return { running: running.size, queued: queued.length, concurrencyNow: current, maxConcurrency: maxConc, rateLimitDowngrades: downgrades, cooldownUntil };
  }

  function idle() {
    return new Promise((res) => {
      idleWaiters.push(res);
      schedulePump();
    });
  }

  return { enqueue, cancel, cancelWhere, setMaxConcurrency, status, entries, stats, idle };
}

module.exports = { createScheduler, PRIORITY };
