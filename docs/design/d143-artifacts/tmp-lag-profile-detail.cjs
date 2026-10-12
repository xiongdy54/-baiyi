// [DIAG-TEMP 测量件，非产品代码] CPU 画像细分：窗口内 self/inclusive 归因（带父链）
// 运行：node tests/tmp-lag-profile-detail.cjs <scenario> <从T0的起ms> <止ms> [过滤子串]
"use strict";
const fs = require("fs");
const path = require("path");
const LAG_DIR = path.join(__dirname, "tmp-lag");
const scenario = process.argv[2] || "same-day";
const w1 = Number(process.argv[3] || 20000);
const w2 = Number(process.argv[4] || 22500);
const filter = process.argv[5] || "";

const prof = JSON.parse(fs.readFileSync(path.join(LAG_DIR, `${scenario}.cpuprofile`), "utf8"));
const meta = JSON.parse(fs.readFileSync(path.join(LAG_DIR, `${scenario}.profile.meta.json`), "utf8"));
const T0 = meta.T0;
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const parentOf = new Map();
for (const n of prof.nodes) for (const c of n.children || []) parentOf.set(c, n.id);

const frame = (n) => {
  const cf = n.callFrame;
  const u = String(cf.url).replace(/^file:\/\/\//, "").replace(/^.*[\\/](electron|node_modules|tests)[\\/]/, "$1/");
  return `${cf.functionName || "(anon)"} @ ${u}:${cf.lineNumber + 1}`;
};
const selfMs = new Map();
const inclMs = new Map();
let cum = 0;
const deltas = prof.timeDeltas || [];
for (let i = 0; i < prof.samples.length; i++) {
  cum += deltas[i] || 0;
  const absEpoch = meta.profilerStartedAtEpoch + cum / 1000;
  const r = absEpoch - T0;
  if (r < w1 || r > w2) continue;
  const d = (deltas[i] || 0) / 1000;
  const id = prof.samples[i];
  const n = byId.get(id);
  if (!n) continue;
  const f = frame(n);
  if (!filter || f.includes(filter)) selfMs.set(f, (selfMs.get(f) || 0) + d);
  // inclusive：沿父链向上，每个祖先记一次
  const seen = new Set();
  let cur = n;
  let guard = 0;
  while (cur && guard++ < 200) {
    const ff = frame(cur);
    if (!seen.has(ff)) {
      seen.add(ff);
      inclMs.set(ff, (inclMs.get(ff) || 0) + d);
    }
    cur = byId.get(parentOf.get(cur.id));
  }
}
console.log(`=== 窗口 +${w1}ms..+${w2}ms  self Top25 ${filter ? "(filter=" + filter + ")" : ""} ===`);
for (const [f, ms] of [...selfMs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${ms.toFixed(0).padStart(6)}ms  ${f}`);
console.log(`\n=== 同窗口 inclusive Top30（沿栈累积，看调用来源） ===`);
for (const [f, ms] of [...inclMs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`  ${ms.toFixed(0).padStart(6)}ms  ${f}`);
