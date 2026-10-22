#!/usr/bin/env node
// C-01 统一测试入口。用法：
//   node scripts/run-tests.mjs                 # 跑 tests/*.test.cjs 全部
//   node scripts/run-tests.mjs m12 d111        # 只跑文件名包含任一关键词的
//   node scripts/run-tests.mjs --list          # 只打印每个文件判定的运行时
//   node scripts/run-tests.mjs --timeout=300   # 单个测试超时秒数（默认 180，可被文件头 @timeout 覆盖）
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
// electron 包的 index.js 在 Node 里导出的是"二进制路径字符串"
const ELECTRON = require(path.join(ROOT, "node_modules", "electron", "index.js"));
const argv = process.argv.slice(2);
const flags = Object.fromEntries(argv.filter((a) => a.startsWith("--")).map((a) => {
  const [k, v] = a.slice(2).split("=");
  return [k, v === undefined ? true : v];
}));
const filters = argv.filter((a) => !a.startsWith("--"));
const DEFAULT_TIMEOUT = Number(flags.timeout || 180);

function classify(file) {
  const src = fs.readFileSync(file, "utf8");
  const head = src.split(/\r?\n/).slice(0, 5).join("\n");
  const m = head.match(/@runtime:\s*(electron-node|system-node|electron|node)\b/);
  const t = head.match(/@timeout:\s*(\d+)/);
  const timeout = t ? Number(t[1]) : DEFAULT_TIMEOUT;
  if (/require\(["']jsdom["']\)|from ["']jsdom["']|node:sqlite/.test(src)) return { runtime: "system-node", timeout };
  if (m) return { runtime: m[1] === "node" ? "electron-node" : m[1], timeout };
  if (/require\(["']electron["']\)/.test(src) && /\bapp\.(whenReady|setPath|getPath)\b|BrowserWindow/.test(src)) {
    return { runtime: "electron", timeout };
  }
  return { runtime: "electron-node", timeout };
}

function hasCmd(cmd) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" });
  return r.status === 0;
}

function commandFor(runtime, file) {
  if (runtime === "system-node") return { cmd: process.execPath, args: [file], env: {} };
  if (runtime === "electron-node") return { cmd: ELECTRON, args: [file], env: { ELECTRON_RUN_AS_NODE: "1" } };
  const extra = process.platform === "linux" ? ["--no-sandbox"] : [];
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    if (!hasCmd("xvfb-run")) throw new Error("Linux 无显示环境且没有 xvfb-run：请安装 xvfb（dnf install xorg-x11-server-Xvfb / apt install xvfb）");
    return { cmd: "xvfb-run", args: ["-a", ELECTRON, ...extra, file], env: {} };
  }
  return { cmd: ELECTRON, args: [...extra, file], env: {} };
}

function killTree(child) {
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-child.pid, "SIGKILL");
  } catch { /* 已退出 */ }
}

function runOne(file, runtime, timeoutSec) {
  return new Promise((resolve) => {
    const { cmd, args, env } = commandFor(runtime, file);
    const t0 = Date.now();
    const childEnv = { ...process.env, ...env };
    // 宿主（如 Qoder/Electron 工具链）可能带有 ELECTRON_RUN_AS_NODE=1；真实 Electron 运行时必须清掉，
    // 否则 app 为 undefined、所有 electron 测试假失败。
    if (runtime === "electron") delete childEnv.ELECTRON_RUN_AS_NODE;
    const child = spawn(cmd, args, {
      cwd: ROOT,
      env: childEnv,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const keep = (b) => { out += b.toString("utf8"); if (out.length > 20000) out = out.slice(-20000); };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutSec * 1000);
    child.on("close", (code) => {
      clearTimeout(timer);
      const status = timedOut ? "timeout" : code === 0 ? "pass" : "fail";
      resolve({ file: path.relative(ROOT, file).replace(/\\/g, "/"), runtime, status, code, ms: Date.now() - t0, tail: out.slice(-4000) });
    });
  });
}

const dir = path.join(ROOT, "tests");
const files = fs.readdirSync(dir)
  .filter((f) => f.endsWith(".test.cjs"))
  .filter((f) => filters.length === 0 || filters.some((k) => f.includes(k)))
  .sort()
  .map((f) => path.join(dir, f));

if (flags.list) {
  const counts = {};
  for (const f of files) {
    const { runtime } = classify(f);
    counts[runtime] = (counts[runtime] || 0) + 1;
    console.log(`${runtime.padEnd(13)} ${path.basename(f)}`);
  }
  console.log(JSON.stringify(counts));
  process.exit(0);
}

const results = [];
for (const f of files) {
  const { runtime, timeout } = classify(f);
  const r = await runOne(f, runtime, timeout);
  results.push(r);
  console.log(`${r.status.toUpperCase().padEnd(7)} ${String(r.ms).padStart(7)}ms  [${runtime}] ${r.file}`);
}
const summary = {
  startedAt: new Date().toISOString(),
  platform: process.platform, arch: process.arch, node: process.version,
  electron: require(path.join(ROOT, "node_modules", "electron", "package.json")).version,
  total: results.length,
  pass: results.filter((r) => r.status === "pass").length,
  fail: results.filter((r) => r.status === "fail").length,
  timeout: results.filter((r) => r.status === "timeout").length,
  results,
};
fs.mkdirSync(path.join(ROOT, "tests", ".results"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "tests", ".results", "latest.json"), JSON.stringify(summary, null, 2));
console.log(`\n合计 ${summary.total}：通过 ${summary.pass} / 失败 ${summary.fail} / 超时 ${summary.timeout}（详情 tests/.results/latest.json）`);
process.exit(summary.fail + summary.timeout === 0 ? 0 : 1);
