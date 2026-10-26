// D239：开发服务器（Vite）地址的唯一来源 + 开发模式 watchdog。
// 原先 5 处窗口载入与 watchdog 各自写死 http://localhost:5173——改了 Vite 端口（或用 --port 起在别的端口）
// 后窗口连不上、watchdog 还会把正在用的开发实例当成「dev server 已退出」在 30 秒后关掉。
// 地址优先级：命令行 `--dev-server=<url>` ＞ 环境变量 NUTATION_DEV_SERVER_URL ＞
// 默认 http://localhost:5173（与 vite.config.ts server.port + strictPort 一致）。只接受 http(s)，非法值回落默认。
// `npm run dev` 只传 `--dev-server`（走默认地址）；Vite 换了端口时用 `electron . --dev-server=http://localhost:5174`
// 或设环境变量即可，窗口与 watchdog 会一起跟着走。
// 是否开发模式仍只看 `--dev-server` 开关（带不带 `=<url>` 都算），且仅未打包时生效（打包版恒走 dist）。
"use strict";

const http = require("node:http");
const https = require("node:https");

const DEFAULT_DEV_SERVER_URL = "http://localhost:5173";

/** 命令行里的 --dev-server 开关原文（`--dev-server` 或 `--dev-server=<url>`）；没有＝null */
function devServerFlag(argv = process.argv) {
  return argv.find((a) => a === "--dev-server" || (typeof a === "string" && a.startsWith("--dev-server="))) || null;
}

/** 开发模式：未打包且带 --dev-server */
function isDevServerMode(app, argv = process.argv) {
  return !(app && app.isPackaged) && devServerFlag(argv) !== null;
}

/** 规范化为不带结尾斜杠的基址（origin + 路径前缀）；非 http(s) / 无法解析 → null */
function normalizeBase(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin + u.pathname.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** 开发服务器基址（如 http://localhost:5173） */
function devServerBase(argv = process.argv, env = process.env) {
  const flag = devServerFlag(argv);
  const fromArg = flag && flag.startsWith("--dev-server=") ? normalizeBase(flag.slice("--dev-server=".length)) : null;
  return fromArg || normalizeBase(env && env.NUTATION_DEV_SERVER_URL) || DEFAULT_DEV_SERVER_URL;
}

/** 页面地址：devServerUrl("lens.html") → http://localhost:5173/lens.html；devServerUrl() → 基址 + "/" */
function devServerUrl(page = "", argv = process.argv, env = process.env) {
  return `${devServerBase(argv, env)}/${String(page || "").replace(/^\/+/, "")}`;
}

/**
 * 窗口载入页面（D192 修订的载入顺序，主窗口 / 结构图 / 制卡台 / 快速记录同规）：
 * 开发模式优先连 dev server（失败回落 dist）——否则旧 dist 会盖住最新源码；
 * 否则 dist 存在就用 dist（生产产物优先，避免 dev 地址连接超时挂起白屏）；dist 不在且未打包才试 dev server。
 */
function loadAppPage(win, { app, fs, distFile, page, argv = process.argv, env = process.env }) {
  const url = devServerUrl(page, argv, env);
  if (isDevServerMode(app, argv)) {
    win.loadURL(url).catch(() => {
      if (fs.existsSync(distFile)) win.loadFile(distFile);
    });
  } else if (fs.existsSync(distFile)) {
    win.loadFile(distFile);
  } else if (!(app && app.isPackaged)) {
    win.loadURL(url).catch(() => {
      win.loadFile(distFile);
    });
  }
}

/**
 * D224 开发模式 watchdog：dev server 连续 maxMisses 次（默认 6×5s＝30 秒）探测不到 → onGone()（主进程里＝退出旧实例，
 * 不让它继续占着 SQLite / 端口）。D239：探测的就是窗口实际连的那个地址（不再写死 5173），http / https 均可。
 * 任何一次 HTTP 应答（不论状态码）都算「还在」并清零计数。返回 stop()。
 */
function startWatchdog({ url, intervalMs = 5000, timeoutMs = 2000, maxMisses = 6, onGone }) {
  const client = String(url).startsWith("https:") ? https : http;
  let misses = 0;
  let stopped = false;
  const miss = () => {
    misses += 1;
    if (!stopped && misses >= maxMisses) {
      stopped = true;
      clearInterval(timer);
      try { onGone && onGone(); } catch { /* 退出路径尽力而为 */ }
    }
  };
  const timer = setInterval(() => {
    if (stopped) return;
    let settled = false;
    const req = client.request(url, { method: "HEAD", timeout: timeoutMs }, (res) => {
      settled = true;
      res.resume();
      misses = 0;
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => {
      if (settled) return;
      settled = true;
      miss();
    });
    req.end();
  }, intervalMs);
  if (timer.unref) timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

module.exports = { DEFAULT_DEV_SERVER_URL, devServerFlag, isDevServerMode, devServerBase, devServerUrl, loadAppPage, startWatchdog };
