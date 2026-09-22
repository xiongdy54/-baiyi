// 全流程测试编排器：按 tier 串行跑 tests/flows/f*.cjs，长跑指定小时数，每轮重扫目录（新增流程自动纳入）。
// 运行：node tests/flows/run.cjs [--hours 8] [--cycles N] [--only F03,F05] [--tier 1,2] [--allow-gui] [--gap 20]
// 说明：GUI 流程（@gui: true）默认**不跑**——它们要用 CDP 起真实应用，而用户可能正开着应用；
//       确认可用 --allow-gui 打开，届时编排器会先探测已有 electron 进程并在冲突时跳过而不是杀掉别人的应用。
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { ROOT, RESULTS_DIR } = require("./lib/harness.cjs");

const FLOWS_DIR = path.join(ROOT, "tests", "flows");

function parseArgs(argv) {
  const a = { hours: 0, cycles: Infinity, only: null, tier: null, allowGui: false, gap: 15, forever: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--hours") a.hours = Number(argv[++i]);
    else if (k === "--cycles") a.cycles = Number(argv[++i]);
    else if (k === "--only") a.only = argv[++i].split(",").map((s) => s.trim().toUpperCase());
    else if (k === "--tier") a.tier = argv[++i].split(",").map(Number);
    else if (k === "--allow-gui") a.allowGui = true;
    else if (k === "--gap") a.gap = Number(argv[++i]);
    else if (k === "--forever") a.forever = true;
  }
  return a;
}

/** 从流程文件头注释里读元数据：// @runtime: electron | node ; // @tier: 1 ; // @gui: false ; // @timeout: 240 */
function readMeta(file) {
  const head = fs.readFileSync(file, "utf8").slice(0, 4000);
  const g = (k, d) => {
    const m = head.match(new RegExp(`@${k}:\\s*([^\\s\n]+)`));
    return m ? m[1] : d;
  };
  return {
    file,
    name: path.basename(file),
    id: g("id", path.basename(file).replace(/\.cjs$/, "")),
    runtime: g("runtime", "node"),
    tier: Number(g("tier", "2")),
    gui: g("gui", "false") === "true",
    timeoutSec: Number(g("timeout", "300")),
  };
}

function discover() {
  return fs
    .readdirSync(FLOWS_DIR)
    .filter((f) => /^f\d/.test(f) && f.endsWith(".cjs"))
    .map((f) => readMeta(path.join(FLOWS_DIR, f)))
    .sort((x, y) => x.tier - y.tier || x.name.localeCompare(y.name));
}

/** 「干净通过」判据：退出码 0 + 有结果 + 零失败 + 无中止/崩溃 + 无意外转绿的已登记缺陷 + 非零断言数 */
function isCleanPass(r, s) {
  return (
    !!r &&
    r.status === 0 &&
    !!s &&
    s.fail === 0 &&
    !s.aborted &&
    !s.crash &&
    !(s.knownHealed || []).length &&
    s.total > 0
  );
}

/** 找 electron 可执行文件：.cmd 需要 shell:true 才能 spawnSync，直接指向 dist/electron.exe 最稳 */
function electronExe() {
  const cands = [
    path.join(ROOT, "node_modules", "electron", "dist", "electron.exe"),
    path.join(ROOT, "node_modules", ".bin", "electron.cmd"),
  ];
  for (const c of cjs_exist(cands)) if (fs.existsSync(c)) return c;
  return "electron";
}
function cjs_exist(arr) {
  return arr;
}

function appendLine(tag, msg) {
  const line = `[${new Date().toISOString()}] ${tag} ${msg}`;
  console.log(line);
  try {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.appendFileSync(path.join(RESULTS_DIR, "soak.log"), line + "\n", "utf8");
  } catch {
    /* 只影响日志 */
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  // 单实例锁：两条流程跑同一沙箱目录会互相制造假失败（实测踩过）
  const lock = path.join(RESULTS_DIR, "soak.lock");
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  try {
    const prev = JSON.parse(fs.readFileSync(lock, "utf8"));
    if (Date.now() - prev.at < 90_000) {
      console.error(`已有编排器在跑（pid=${prev.pid}，${new Date(prev.at).toISOString()} 心跳）——拒绝启动第二个`);
      process.exit(3);
    }
  } catch {
    /* 无锁文件 */
  }
  const touchLock = () => fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: Date.now(), args }));
  touchLock();
  setInterval(touchLock, 20_000).unref();
  const deadline = args.hours > 0 ? Date.now() + args.hours * 3600_000 : Infinity;
  const statePath = path.join(RESULTS_DIR, "soak-state.json");
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const state = JSON.parse(
    fs.existsSync(statePath) ? fs.readFileSync(statePath, "utf8") : '{"cycles":0,"runs":0,"pass":0,"fail":0,"startedAt":null,"totalMs":0}'
  );
  if (!state.startedAt) state.startedAt = new Date().toISOString();

  appendLine("SOAK", `开始：hours=${args.hours || "∞"} cycles=${Number.isFinite(args.cycles) ? args.cycles : "∞"} only=${args.only || "全部"} tier=${args.tier || "全部"} allow-gui=${args.allowGui}`);
  let cycle = 0;
  while (true) {
    cycle++;
    const flows = discover().filter((f) => {
      if (args.only && !args.only.some((id) => f.id.toUpperCase().startsWith(id) || f.name.toUpperCase().includes(id))) return false;
      if (args.tier && !args.tier.includes(f.tier)) return false;
      if (f.gui && !args.allowGui) return false;
      return true;
    });
    appendLine("CYCLE", `第 ${cycle} 轮 · ${flows.length} 条流程 · 累计 pass=${state.pass} fail=${state.fail}`);
    touchLock(); // 阻塞式串行跑流程时 setInterval 挤不进事件循环，锁的心跳改在轮首打
    for (const f of flows) {
      let r = null;
      let s = null;
      let ms = 0;
      let attempts = 0;
      while (attempts < 2) {
        attempts++;
        const t0 = Date.now();
        const exe = f.runtime === "electron" ? electronExe() : process.execPath;
        // 先删旧结果文件：否则流程崩溃时会读到上一轮的 JSON，把「没跑」误判成「跑过且通过」
        const resultFile = path.join(RESULTS_DIR, `${f.id}.last.json`);
        try {
          fs.rmSync(resultFile, { force: true });
        } catch {
          /* ignore */
        }
        r = spawnSync(exe, [f.file], {
          cwd: ROOT,
          encoding: "utf8",
          timeout: f.timeoutSec * 1000,
          env: {
            ...process.env,
            FLOW_CYCLE: String(cycle),
            FLOW_SEED: String((Date.now() % 100000000) + attempts * 7),
            ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
          },
        });
        ms = Date.now() - t0;
        try {
          s = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, `${f.id}.last.json`), "utf8"));
        } catch {
          s = null;
        }
        const clean = isCleanPass(r, s);
        const externalKill = r.signal !== null || (s && s.total === 0 && r.status !== 0);
        if (clean) break;
        // 只对「疑似被外部杀死 / 崩溃且零断言」重试一次；真实断言失败不重试（那是结论不是噪声）
        if (!externalKill) break;
        appendLine("RETRY", `${f.id} 疑似被外部进程打断（signal=${r.signal} 断言=${s ? s.total : "?"}），重试第 ${attempts} 次`);
      }
      const out = (r.stdout || "") + (r.stderr || "");
      const ok = isCleanPass(r, s);
      state.runs++;
      if (ok) state.pass++;
      else state.fail++;
      state.cycles = cycle;
      state.totalMs = (state.totalMs || 0) + ms;
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
      appendLine(ok ? "PASS" : "FAIL", `${f.id} ${ms}ms ${s ? `${s.pass}/${s.total} 断言` : "(无结果文件)"}`);
      if (!ok) {
        const dump = path.join(RESULTS_DIR, "failures", `${f.id}-c${cycle}.log`);
        fs.mkdirSync(path.dirname(dump), { recursive: true });
        fs.writeFileSync(dump, `exit=${r.status} signal=${r.signal} ms=${ms}\n${out}`, "utf8");
        appendLine("DUMP", dump.replace(ROOT, "."));
      }
      if (Date.now() >= deadline) break;
      if (Number.isFinite(args.cycles) && cycle >= args.cycles) break;
    }
    if (Date.now() >= deadline) break;
    if (Number.isFinite(args.cycles) && cycle >= args.cycles) break;
    sleepSec(args.gap);
  }
  state.finishedAt = new Date().toISOString();
  state.wallMs = Date.now() - Date.parse(state.startedAt);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
  appendLine("DONE", `轮次=${state.cycles} 运行=${state.runs} 通过=${state.pass} 失败=${state.fail} 墙钟=${Math.round(state.wallMs / 60000)} 分钟`);
  // 正常退出必须清掉心跳锁：锁的语义是「90 秒内有心跳＝还活着」，留着会让外部等待误判成仍在运行
  // （实测代价：上一窗口收口后按「锁还在」等了 20 分钟空转）。
  try {
    fs.unlinkSync(lock);
  } catch {
    /* 已被清理 */
  }
}

function sleepSec(n) {
  const until = Date.now() + n * 1000;
  while (Date.now() < until) {
    /* 阻塞式等待：编排器不需要响应输入，避免被 Windows 的 setTimeout 抖动拉长节奏 */
    const t = Date.now();
    while (Date.now() - t < 200) { /* spin */ }
  }
}

main();
