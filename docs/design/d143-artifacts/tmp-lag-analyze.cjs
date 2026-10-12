// [DIAG-TEMP 测量件，非产品代码] 启动卡顿诊断：数据汇总（合并 主进程日志 / 页内数据 / CPU 画像 为统一时间线）
// 运行：node tests/tmp-lag-analyze.cjs <scenario>
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LAG_DIR = path.join(ROOT, "tests", "tmp-lag");
const scenario = process.argv[2] || "same-day";
const logFile = path.join(LAG_DIR, `${scenario}.app.log`);
const pageFile = path.join(LAG_DIR, `${scenario}.page.json`);
const profFile = path.join(LAG_DIR, `${scenario}.cpuprofile`);

const lines = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").split(/\r?\n/) : [];
const page = fs.existsSync(pageFile) ? JSON.parse(fs.readFileSync(pageFile, "utf8")) : null;
const T0 = page ? page.T0 : null;
const rel = (t) => (T0 ? `+${String(t - T0).padStart(6)}ms` : String(t));

const events = [];
for (const ln of lines) {
  let m;
  if ((m = ln.match(/\[LAG\] hole (\d+) -> (\d+) \((\d+)ms\)/))) {
    events.push({ t: Number(m[1]), dur: Number(m[3]), kind: "hole(main)", name: "主进程事件循环空洞" });
  } else if ((m = ln.match(/\[DIAG-MAIN\] 主进程事件循环空洞 (\d+) -> (\d+) \((\d+)ms\)/))) {
    events.push({ t: Number(m[1]), dur: Number(m[3]), kind: "hole(product)", name: "产品 DIAG 空洞(>300ms)" });
  } else if ((m = ln.match(/\[LAG\] enter (desktopCapturer\.getSources) .*epoch=(\d+)/))) {
    events.push({ t: Number(m[2]), dur: null, kind: "enter", name: "desktopCapturer.getSources 进入" });
  } else if ((m = ln.match(/\[LAG\] exit\s+desktopCapturer\.getSources dur=(\d+)ms/))) {
    events.push({ t: null, dur: Number(m[1]), kind: "exit", name: "desktopCapturer.getSources 返回" });
  } else if ((m = ln.match(/\[LAG\] enter (\w[\w.]*) .*epoch=(\d+)/))) {
    events.push({ t: Number(m[2]), dur: null, kind: "enter", name: m[1] + " 进入" });
  } else if ((m = ln.match(/\[LAG\] exit\s+(\w[\w.]*) dur=(\d+)ms(.*)/))) {
    events.push({ t: null, dur: Number(m[2]), kind: "exit", name: `${m[1]} 返回 (${m[2]}ms) ${String(m[3]).slice(0, 60)}` });
  } else if ((m = ln.match(/\[LAG\] (learnerRefresh\.phase=\w+) @(\d+)/))) {
    events.push({ t: Number(m[2]), dur: null, kind: "phase", name: m[1] });
  } else if ((m = ln.match(/\[LAG\] (sql\.\w+|fs\.\w+|persistDb|learnerDb\.save|listBackups|jszip\.progress) (\d+)ms(.*)/))) {
    if (Number(m[2]) >= 40) events.push({ t: null, dur: Number(m[2]), kind: "sql", name: `${m[1]} ${m[2]}ms ${String(m[3]).slice(0, 70)}` });
  } else if ((m = ln.match(/\[DIAG-IPC\] (\S+) 慢 (\d+)ms @(\d+)/))) {
    events.push({ t: Number(m[3]), dur: Number(m[2]), kind: "ipc", name: `IPC ${m[1]} 慢 ${m[2]}ms` });
  } else if ((m = ln.match(/\[DIAG-MAIN\] learnerRefresh 定时器触发 @(\d+) /))) {
    events.push({ t: Number(m[1]), dur: null, kind: "timer", name: "learnerRefresh 定时器触发" });
  } else if ((m = ln.match(/\[DIAG-MAIN\] backfillSidecars 定时器触发 @(\d+)/))) {
    events.push({ t: Number(m[1]), dur: null, kind: "timer", name: "backfillSidecars 定时器触发" });
  } else if ((m = ln.match(/\[LAG\] screenCapture\.warmup 注册 @(\d+)/))) {
    events.push({ t: Number(m[1]), dur: null, kind: "note", name: "screenCapture.warmup 注册（+8s 后抓屏）" });
  }
}
// exit 事件无绝对时间：用同名前一个 enter 推
{
  const stack = [];
  for (const e of events) {
    if (e.kind === "enter") stack.push(e);
    else if (e.kind === "exit" || (e.kind === "sql" && e.t === null)) {
      const prev = stack.pop();
      if (prev && prev.t) e.t = prev.t + (e.dur || 0);
      else e.t = e.t || null;
    }
  }
}

console.log(`=== 时间线（${scenario}） T0=${T0} ${new Date(T0).toLocaleString("sv-SE")} ===`);
const holes = events.filter((e) => e.kind.startsWith("hole") && e.t);
const totalHole = holes.filter((e) => e.kind === "hole(main)").reduce((a, b) => a + b.dur, 0);
for (const e of events.filter((e) => e.t).sort((a, b) => a.t - b.t)) {
  console.log(`${rel(e.t)}  ${String(e.dur === null ? "" : e.dur + "ms").padStart(8)}  ${e.name}`);
}
console.log(`\n主进程空洞合计（我的 100ms 探针）：${totalHole}ms / ${holes.filter((e) => e.kind === "hole(main)").length} 段`);

if (page && page.data) {
  const d = page.data;
  console.log(`\n=== 页内数据 ===`);
  console.log(`anchor: ${JSON.stringify(d.anchor)}  nav: ${JSON.stringify(d.nav)}  fcp: ${JSON.stringify(d.fcp)}  readyAtInject: ${JSON.stringify(d.ready)}`);
  const ipc = d.ipc || [];
  const dts = ipc.map((x) => x.dt).sort((a, b) => a - b);
  const p50 = dts[Math.floor(dts.length * 0.5)] || 0;
  const p95 = dts[Math.floor(dts.length * 0.95)] || 0;
  console.log(`IPC 往返 n=${ipc.length} p50=${p50}ms p95=${p95}ms max=${dts[dts.length - 1]}ms`);
  console.log("IPC 慢样本(>150ms)：");
  for (const x of ipc.filter((x) => x.dt > 150)) console.log(`  ${rel(x.at)}  ${x.ch}  ${x.dt}ms ${x.err || ""}`);
  console.log(`渲染层 rAF 空档(>80ms) n=${(d.raf || []).length}`);
  for (const x of (d.raf || []).slice(0, 25)) console.log(`  ${rel(x.at)}  gap=${x.gap}ms`);
  console.log(`渲染层 longtask n=${(d.lt || []).length}`);
  for (const x of (d.lt || []).slice(0, 25)) console.log(`  ${rel(x.at)}  dur=${x.dur}ms`);
  console.log(`点击→版式切换（页内观测/in-page）：`);
  for (const c of d.clicks || []) console.log(`  ${rel(c.sent)}  「${c.label}」 ${c.dt}ms`);
}

if (fs.existsSync(profFile)) {
  const prof = JSON.parse(fs.readFileSync(profFile, "utf8"));
  const meta = JSON.parse(fs.readFileSync(path.join(LAG_DIR, `${scenario}.profile.meta.json`), "utf8"));
  const byId = new Map();
  for (const n of prof.nodes) byId.set(n.id, n);
  const frames = (n) => {
    const cf = n.callFrame;
    return `${cf.functionName || "(anon)"} @ ${String(cf.url).replace(/^file:\/\/\//, "").replace(/^.*[\\/](electron|node_modules)[\\/]/, "$1/")}:${cf.lineNumber + 1}`;
  };
  // 时间戳：startTime(µs) + ΣtimeDeltas ≈ 采样时刻；用 profilerStartedAtEpoch 对齐
  const t0us = prof.startTime;
  const offsetEpochMs = meta.profilerStartedAtEpoch;
  let cum = 0;
  const selfMs = new Map();
  const bucket = new Map(); // 5s 桶 → Map(frame → ms)
  const samples = prof.samples || [];
  const deltas = prof.timeDeltas || [];
  for (let i = 0; i < samples.length; i++) {
    cum += deltas[i] || 0;
    const absEpoch = offsetEpochMs + (t0us + cum - t0us) / 1000;
    const f = frames(byId.get(samples[i]) || { callFrame: { functionName: "?", url: "", lineNumber: 0 } });
    const ms = (deltas[i] || 0) / 1000;
    selfMs.set(f, (selfMs.get(f) || 0) + ms);
    const b = Math.floor((absEpoch - T0) / 5000) * 5;
    if (!bucket.has(b)) bucket.set(b, new Map());
    bucket.get(b).set(f, (bucket.get(b).get(f) || 0) + ms);
  }
  const top = [...selfMs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  console.log(`\n=== 主进程 CPU 自耗时 Top30（窗口 ${(cum / 1000 / 1000).toFixed(1)}s） ===`);
  for (const [f, ms] of top) console.log(`  ${Math.round(ms)}ms  ${f}`);
  console.log(`\n=== 每 5s 桶的 Top3（定位空洞窗口热点） ===`);
  for (const b of [...bucket.keys()].sort((a, b2) => a - b2)) {
    const t = [...bucket.get(b).entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 3);
    console.log(`  [+${b}s..+${b + 5}s] ` + t.map(([f, ms]) => `${Math.round(ms)}ms ${f.split(" @ ")[0]}`).join(" | "));
  }
  console.log("\n=== 8-10.5s 窗口内 Top8（desktopCapturer 窗口） ===");
  {
    const agg = new Map();
    let cum2 = 0;
    for (let i = 0; i < samples.length; i++) {
      cum2 += deltas[i] || 0;
      const absEpoch = offsetEpochMs + cum2 / 1000;
      const r = absEpoch - T0;
      if (r < 8000 || r > 10500) continue;
      const f = frames(byId.get(samples[i]) || { callFrame: { functionName: "?", url: "", lineNumber: 0 } });
      agg.set(f, (agg.get(f) || 0) + (deltas[i] || 0) / 1000);
    }
    for (const [f, ms] of [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${Math.round(ms)}ms  ${f}`);
  }
  console.log("\n=== 20-22s 窗口内 Top8（learnerRefresh 窗口） ===");
  {
    const agg = new Map();
    let cum2 = 0;
    for (let i = 0; i < samples.length; i++) {
      cum2 += deltas[i] || 0;
      const absEpoch = offsetEpochMs + cum2 / 1000;
      const r = absEpoch - T0;
      if (r < 20000 || r > 22500) continue;
      const f = frames(byId.get(samples[i]) || { callFrame: { functionName: "?", url: "", lineNumber: 0 } });
      agg.set(f, (agg.get(f) || 0) + (deltas[i] || 0) / 1000);
    }
    for (const [f, ms] of [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${Math.round(ms)}ms  ${f}`);
  }
}
