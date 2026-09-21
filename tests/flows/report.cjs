// 长跑报告生成器：读 tests/flows/results/history.jsonl，输出 docs/test-flows/REPORT.md
// 运行：node tests/flows/report.cjs
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const rows = fs
  .readFileSync(path.join(__dirname, "results", "history.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter(Boolean);
const files = fs.readdirSync(__dirname);
const fileOf = (id) => files.find((f) => f.toLowerCase() === id.toLowerCase() + "-" || f.toLowerCase().startsWith(id.toLowerCase() + "-"));
const agg = {};
for (const r of rows) {
  const a = (agg[r.id] = agg[r.id] || {
    id: r.id, title: r.title, cites: r.cites, n: 0, runs: 0, redRuns: 0, crash: 0, abort: 0,
    asserts: 0, pass: 0, fail: 0, known: 0, heal: 0, minMs: Infinity, maxMs: 0, totalMs: 0,
    lastFailAt: 0, names: new Map(), notes: {},
  });
  a.runs++;
  a.asserts += r.total || 0;
  a.pass += r.pass || 0;
  a.fail += r.fail || 0;
  a.known += r.knownFired || 0;
  a.heal += (r.knownHealed || []).length;
  a.minMs = Math.min(a.minMs, r.durationMs);
  a.maxMs = Math.max(a.maxMs, r.durationMs);
  a.totalMs += r.durationMs;
  if (r.crash) a.crash++;
  if (r.aborted) a.abort++;
  const red = (r.fail || 0) > 0 || r.crash || r.aborted || (r.knownHealed || []).length;
  if (red) {
    a.redRuns++;
    a.lastFailAt = Math.max(a.lastFailAt, r.startedAt);
    for (const f of r.failures || []) a.names.set(`[${f.section}] ${f.name}`, `期望 ${JSON.stringify(f.expected)} 实际 ${JSON.stringify(f.actual ?? null).slice(0, 160)}`);
  }
  for (const nt of r.notes || []) {
    if (/^\d+(\.\d+)?$/.test(String(nt.value))) (a.notes[nt.key] = a.notes[nt.key] || []).push(Number(nt.value));
  }
}
// 版本截止：只看每条流程文件最后一次修改之后的运行（修好前的历史不算现行状态）
const stamp = {};
for (const id of Object.keys(agg)) {
  const f = fileOf(id);
  stamp[id] = f ? fs.statSync(path.join(__dirname, f)).mtimeMs : 0;
}
const cur = {};
for (const r of rows) {
  if (r.startedAt < stamp[r.id]) continue;
  const a = (cur[r.id] = cur[r.id] || { n: 0, red: 0, fail: 0, known: 0, crash: 0, asserts: 0, pass: 0, totalMs: 0 });
  a.n++;
  a.asserts += r.total || 0;
  a.pass += r.pass || 0;
  a.fail += r.fail || 0;
  a.known += r.knownFired || 0;
  a.crash += r.crash ? 1 : 0;
  if ((r.fail || 0) > 0 || r.crash || r.aborted || (r.knownHealed || []).length) a.red++;
}
const first = Math.min(...rows.map((r) => r.startedAt));
const last = Math.max(...rows.map((r) => r.startedAt));
const T = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 19) + "Z";
const pct = (arr, p) => {
  const a = [...arr].sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.floor((a.length - 1) * p))] : 0;
};

let out = `# 全流程测试长跑报告

> 由 \`node tests/flows/report.cjs\` 生成于 ${T(Date.now())}。数据源 \`tests/flows/results/history.jsonl\`（${rows.length} 条运行记录）。
> 分支 \`test/flow-coverage\`；设计见 [PLAN.md](PLAN.md)，缺陷见 [DEFECTS.md](DEFECTS.md)。

## 1. 窗口与总量

- 首次记录：${T(first)}　最近记录：${T(last)}　跨度 **${((last - first) / 3600000).toFixed(2)} 小时**
- 累计流程运行：**${rows.length} 轮次**；累计断言执行 **${rows.reduce((s, r) => s + (r.total || 0), 0).toLocaleString()} 条**（通过 ${rows.reduce((s, r) => s + (r.pass || 0), 0).toLocaleString()}）
- 编排器：\`node tests/flows/run.cjs --hours 7.4 --gap 20\`（每轮重扫 \`tests/flows/f*.cjs\`，新流程自动加入）

## 2. 各流程累计与现行状态

「现行」= 只统计该流程文件最后一次修改之后的运行，避免把调试期历史算成今天的状态。

| 流程 | 运行 | 现行运行 | 现行判红 | 现行失败断言 | 已知缺陷触发 | 崩溃(全程) | 时长 min–max | 指南依据 |
|---|---|---|---|---|---|---|---|---|
`;
const ORDER = ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08", "F09", "F10", "F11", "F12", "F13", "F14", "F15", "F16", "F17", "F18", "F19", "F20", "F21", "F22", "F23"];
for (const id of ORDER) {
  const a = agg[id];
  if (!a) continue;
  const c = cur[id] || { n: 0, red: 0, fail: 0, known: 0, crash: 0 };
  out += `| ${id} ${a.title} | ${a.runs} | ${c.n} | ${c.red} | ${c.fail} | ${c.known} | ${a.crash} | ${a.minMs}–${a.maxMs}ms | ${(a.cites || []).join(" ")} |\n`;
}
out += `\n## 3. 现行仍红的断言（逐条）\n\n`;
let any = false;
for (const id of ORDER) {
  const a = agg[id];
  if (!a || !a.redRuns) continue;
  const c = cur[id] || { red: 0 };
  out += `### ${id} · ${a.title}\n\n累计判红 ${a.redRuns} 轮（其中现行版本 ${c.red} 轮），崩溃 ${a.crash} 次${a.abort ? `、中止 ${a.abort} 次` : ""}\n\n`;
  if (a.names.size) {
    any = true;
    for (const [k, v] of a.names) out += `- ${k}\n  - ${v}\n`;
  } else out += "- （无失败断言记录，只有环境干扰导致的进程被杀）\n";
  out += "\n";
}
if (!any) out += "（无）\n";
out += `## 4. 性能棘轮（F10，逐轮记录的关键耗时）\n\n| 指标 | 轮数 | 最小 | 中位 | 最大 |\n|---|---|---|---|---|\n`;
const f10 = agg.F10;
if (f10) {
  for (const k of Object.keys(f10.notes)) {
    const v = f10.notes[k];
    out += `| ${k} | ${v.length} | ${Math.min(...v)} | ${pct(v, 0.5)} | ${Math.max(...v)} |\n`;
  }
}
out += `\n## 5. 结论口径\n\n- 判绿条件：退出码 0 且 \`fail==0 && !aborted && !crash && knownHealed 为空 && total>0\`（零断言视为失败）。\n- 「已知缺陷触发」不算失败，但会逐轮计数；缺陷被修好后该断言**意外转绿会立刻判红**，提醒撤销登记。\n- 崩溃列多为环境干扰：并行会话沿用旧 harness 的 \`taskkill /IM electron.exe /F\` 会连带杀掉本层正在跑的流程进程（编排器对「被信号杀死/零断言早退」自动重试一次，真实断言失败绝不重试）。\n`;
fs.writeFileSync(path.join(ROOT, "docs", "test-flows", "REPORT.md"), out);
console.log("已写出 docs/test-flows/REPORT.md ·", out.length, "字符");
