// 收尾看门狗：等编排器（run.cjs）停下后，自动重生成 docs/test-flows/REPORT.md。
// 用法（分离进程后台跑）：powershell Start-Process node -ArgumentList 'tests/flows/watch-and-report.cjs' ...
// 存在的理由：8 小时长跑的终点在数小时之后，报告必须在无人值守时也能落成。
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync, execSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..", "..");
const LOCK = path.join(__dirname, "results", "soak.lock");
const log = (m) => fs.appendFileSync(path.join(__dirname, "results", "watch.log"), `[${new Date().toISOString()}] ${m}\n`);
const runnerAlive = () => {
  try {
    const out = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\" | Where-Object { $_.CommandLine -match \'flows/run.cjs\' } | Measure-Object | Select-Object -ExpandProperty Count"', { encoding: "utf8", timeout: 20000 });
    return Number(out.trim()) > 0;
  } catch {
    return false;
  }
};
(async () => {
  log("看门狗启动：等编排器退出后自动出报告");
  let sawRunning = runnerAlive();
  for (let i = 0; i < 12 * 60; i++) {
    await new Promise((r) => setTimeout(r, 60_000));
    const alive = runnerAlive();
    if (alive) sawRunning = true;
    if (sawRunning && !alive) break;
    if (!sawRunning && i > 2) break;
  }
  log("编排器已退出，生成最终报告");
  const r = spawnSync(process.execPath, [path.join(__dirname, "report.cjs")], { cwd: ROOT, encoding: "utf8" });
  log("report.cjs exit=" + r.status + " " + String(r.stdout || "").trim() + String(r.stderr || "").trim());
  try {
    const state = JSON.parse(fs.readFileSync(path.join(__dirname, "results", "soak-state.json"), "utf8"));
    fs.appendFileSync(
      path.join(ROOT, "docs", "test-flows", "REPORT.md"),
      `\n\n## 6. 长跑最终计数（看门狗于 ${new Date().toISOString()} 追加）\n\n` +
        `- 编排器累计：轮次 ${state.cycles} · 运行 ${state.runs} · 判绿 ${state.pass} · 判红 ${state.fail}\n` +
        `- 墙钟：${state.startedAt} → ${state.finishedAt || new Date().toISOString()}（${(((state.wallMs || 0) / 3600000)).toFixed(2)} 小时）\n`
    );
    log("最终计数已追加");
  } catch (e) {
    log("追加失败：" + e.message);
  }
})();
