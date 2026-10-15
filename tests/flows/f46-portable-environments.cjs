// F46 异机环境与分发就绪模拟 —— 「装到别人电脑上也要正确无误」这一句的机器化验证
// @runtime: node
// @id: F46
// @tier: 3
// @gui: true
// @timeout: 1500
//
// 运行：node tests/flows/f46-portable-environments.cjs
//       只跑其中几条：F46_ONLY=e1,e2 node tests/flows/f46-portable-environments.cjs
//
// 角度（既有 37 条 + F45 一条都没覆盖）：此前所有流程都在**同一台机器、同一个环境变量集、同一个
// userData、同一份 dist** 下跑——它们验的是「逻辑对不对」，没有一条验「换台电脑还成立吗」。
// 本流程按 §1 花名册 C 波次的矩阵，为每种异机环境**各起一个真实应用进程**（env/flag 是进程级的，
// 只能一次一发）：E1 无 GPU、E2 完全离线、E3 外语系统、E4 时区/夏令时、E5 强制色（无障碍）、
// E6 敌意 userData 路径（CJK+空格 / 尾点目录名 / 超长路径 / 目录联接）、E7 只读被锁的数据目录、
// E8 没有 dist 的干净机器。
//
// 每案例固定产出三件证据：
//   1) tests/flows/results/f46-<case>.png       —— 整窗截图（视觉判断交主会话，本流程只出测量）
//   2) tests/flows/results/f46-<case>.app.log   —— 该进程自己的 stdout/stderr 尾 + CDP 采集摘要
//   3) flow 记录里的：可用性判据、console 错误、失败请求、盘上路径与哈希
//
// 安全：独立 userData + 独立端口（基座 9800，自动 +12 扫描）+ 只 kill 自己 spawn 的 PID；
//       绝不 taskkill /IM electron.exe（背景 soak 与别的会话在跑）；
//       绝不改动 src/ electron/ dist/ docs/ tests/flows/lib/——启动器在本文件内内联扩展；
//       联接（junction）只删自己建的那些，且删在 rm -rf 之前（否则会顺着联接删掉真目录）。
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");

const { Flow, runFlow, ROOT, RESULTS_DIR, freshDir } = require("./lib/harness.cjs");
const { shutdown, wait, clickText, hasText, countOf, ELECTRON, portFree } = require("./lib/guienv.cjs");
const { audit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F46",
  title: "异机环境与分发就绪模拟",
  angle: "换一台电脑还成立吗：无 GPU/离线/外语/时区/强制色/敌意路径/只读库/无 dist 各起一个真实进程",
  cites: ["§7.1.4", "§9.1 M2", "§4.12-4", "§5.4", "§6.2", "§7.6"],
  tier: 3,
  gui: true,
});

const BASE_PORT = 9800; //  soak 用 9620–9631、别的会话用 9700 —— 这里另开一段
const SCRATCH = path.join(os.tmpdir(), `f46-portable-${process.pid}`);
const ONLY = String(process.env.F46_ONLY || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/** 正文：中英日混排（E3 的豆腐块取证靠它），与 F01 同形状但加了假名/片假名 */
const MD =
  "# 第一章 渐进阅读\n\n渐进阅读的核心是把长文切成可处理的小块，并为每个小块制作记忆卡片。\n\n" +
  "# 第二章 間隔反復\n\n間隔反復は忘却曲線に基づいて復習の時点を安排します。FSRS はそのパラメータ化実装です。\n\n" +
  "# 第三章 知识画像\n\n知识画像把卡片证据汇聚成掌握度估计，用于推荐下一步学习材料（knowledge profile）。\n";

// ---------- 脚手架：内联版启动器（guienv.launch 的扩展副本，不动 lib） ----------
const JUNCTIONS = []; // 只删自己建的联接

function scratchDir(sub) {
  const p = path.join(SCRATCH, sub);
  fs.mkdirSync(p, { recursive: true });
  return p;
}
function mkJunction(linkPath, targetPath) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  // 按规程走 cmd /c mklink /J；含 CJK/空格时 cmd 有码页风险，建不出来就退回
  // fs.symlinkSync(..., 'junction')（同样是 reparse point 联接，不是软链接），并如实记录用了哪条路。
  const r = spawnSync("cmd.exe", ["/c", "mklink", "/J", linkPath, targetPath], { encoding: "utf8" });
  let how = "cmd mklink /J";
  if (!fs.existsSync(linkPath)) {
    try {
      fs.symlinkSync(targetPath, linkPath, "junction");
      how = "fs.symlinkSync(junction) 回退（cmd 路失败：" + String(r.stdout || r.stderr || "").trim().slice(0, 60) + "）";
    } catch (e) {
      how = "两条路都失败:" + String(e.code || e.message).slice(0, 60);
    }
  }
  let resolves = false;
  try {
    fs.readdirSync(linkPath);
    resolves = true;
  } catch {
    resolves = false;
  }
  const created = fs.existsSync(linkPath);
  if (created) JUNCTIONS.push(linkPath);
  return { ok: created && resolves, how, out: String(r.stdout || r.stderr || "").replace(/\s+/g, " ").slice(0, 120) };
}
function dropJunctions() {
  for (const j of JUNCTIONS.slice().reverse()) {
    const r = spawnSync("cmd.exe", ["/c", "rmdir", j], { encoding: "utf8" });
    if (fs.existsSync(j)) {
      try {
        fs.rmdirSync(j);
      } catch {
        /* 留给下一次；只可能删掉联接本身，绝不带 /S /Q */
      }
    }
    if (fs.existsSync(j)) flow.record("联接未能删除（测试侧残留）", `${j} :: cmd exit=${r.status} ${String(r.stderr || "").slice(0, 60)}`);
  }
  JUNCTIONS.length = 0;
}
process.on("exit", () => {
  // 异常退出也不能把指向仓库 node_modules 的联接留在临时盘上
  for (const j of JUNCTIONS.slice().reverse()) {
    try {
      spawnSync("cmd.exe", ["/c", "rmdir", j], { encoding: "utf8" });
      if (fs.existsSync(j)) fs.rmdirSync(j);
    } catch {
      /* ignore */
    }
  }
});

async function pickPort(base) {
  for (let p = base; p < base + 12; p++) if (await portFree(p)) return p;
  return null;
}

/**
 * 只结束自己 spawn 的那个 PID，且**先确认它还活着**。
 * 为什么不用 guienv.shutdown 的 taskkill 分支：子进程若已自行退出（敌意路径下应用会以 code 0
 * 静默退出），它的 PID 随时可能被 Windows 回收给别的进程，此时 `taskkill /PID x /T /F`
 * 打到的是「现在持有这个号的进程」。本流程前两次整轮失踪（父 node 以 0 退出、没打印汇总）
 * 正是发生在一发以 code=0 早退的子进程之后 —— 形态与 PID 回收竞态一致。
 * 故：已退出就绝不 taskkill；仍活着才 kill，等 4 秒，仍未退才按 PID 强杀一次。
 */
async function stop(h) {
  try {
    h && h.ws && h.ws.close();
  } catch {
    /* ignore */
  }
  if (!h || !h.child) return;
  const child = h.child;
  if (child.exitCode !== null) {
    flow.record(`${h.caseName || "?"} 停止`, `子进程已自行退出（code=${child.exitCode}）→ 跳过 taskkill（不打被回收的 PID）`);
    return;
  }
  const pid = child.pid;
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  await new Promise((res) => {
    const t0 = Date.now();
    const tick = () => {
      if (child.exitCode !== null || Date.now() - t0 > 4000) return res();
      setTimeout(tick, 200);
    };
    tick();
  });
  if (child.exitCode === null && pid) {
    try {
      require("child_process").execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    } catch {
      /* 已经退干净了 */
    }
  }
}

/** CDP 连接（guienv.connect 的本文件副本，多了「接受任意 page 目标」档——E8 的窗口根本不在 index.html 上） */
async function cdpConnect(port, child, { timeoutMs = 115_000, preferIndex = true } = {}) {
  const t0 = Date.now();
  const deadline = t0 + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      return { skippedByExit: true, code: child.exitCode, reason: `应用进程提前退出（code=${child.exitCode}）` };
    }
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const pages = list.filter((t) => t.type === "page");
      const page = (preferIndex ? pages.find((t) => /index\.html/.test(t.url || "")) : null) || (pages.length ? pages[0] : null);
      if (page && page.webSocketDebuggerUrl) {
        const ws = new globalThis.WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener("open", res, { once: true });
          ws.addEventListener("error", rej, { once: true });
          setTimeout(() => rej(new Error("CDP 握手超时")), 8000);
        });
        let id = 0;
        const pending = new Map();
        ws.addEventListener("message", (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) {
            pending.get(m.id)(m);
            pending.delete(m.id);
          }
        });
        const send = (method, params = {}) =>
          new Promise((res) => {
            const mid = ++id;
            pending.set(mid, res);
            try {
              ws.send(JSON.stringify({ id: mid, method, params }));
            } catch (e) {
              pending.delete(mid);
              res({ error: { message: String(e && e.message ? e.message : e) } });
            }
          });
        const evaluate = async (expr) => {
          const r = await send("Runtime.evaluate", { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true });
          if (r.result && r.result.exceptionDetails) return { error: String(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text || "").slice(0, 300) };
          return { value: r.result?.result?.value };
        };
        await send("Page.enable");
        await send("Runtime.enable");
        return {
          ws,
          send,
          evaluate,
          attachedUrl: page.url || "",
          shotMs: Date.now() - t0,
          shot: async (name) => {
            const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
            const out = path.join(RESULTS_DIR, `${name}.png`);
            fs.mkdirSync(RESULTS_DIR, { recursive: true });
            fs.writeFileSync(out, Buffer.from(s.result.data, "base64"));
            return out;
          },
          listTargets: async () => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === "page"),
        };
      }
    } catch {
      /* 端口未就绪 */
    }
    await wait(400);
  }
  return { timeout: true, reason: `${Math.round(timeoutMs / 1000)} 秒内连不上 CDP（端口 ${port}）` };
}

/** 采集 console/异常/网络失败（Log.enable 会回吐此前缓冲的浏览器日志，故早期资源错误也拿得到） */
function attachCollectors(h) {
  h.ev = { errors: [], warnings: [], exceptions: [], netFail: [], netTotal: 0, pageErrors: [] };
  const urls = new Map();
  h.ws.addEventListener("message", (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (!m.method) return;
    const p = m.params || {};
    if (m.method === "Runtime.consoleAPICalled") {
      const text = (p.args || [])
        .map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type || ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .slice(0, 300);
      const rec = { type: p.type, text, where: (p.stackTrace?.callFrames || [])[0]?.url || "" };
      if (p.type === "error") h.ev.errors.push(rec);
      else if (p.type === "warning") h.ev.warnings.push(rec);
    } else if (m.method === "Runtime.exceptionThrown") {
      h.ev.exceptions.push(String(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || "").replace(/\s+/g, " ").slice(0, 240));
    } else if (m.method === "Log.entryAdded") {
      const en = p.entry || {};
      const text = String(en.text || "").replace(/\s+/g, " ").slice(0, 240);
      const rec = { level: en.level, text, url: String(en.url || "").slice(0, 120), src: en.source || "" };
      if (en.level === "error") h.ev.errors.push({ type: "browser-log", text: `${text} @${rec.url}`, where: rec.src });
      else if (en.level === "warning") h.ev.warnings.push(rec);
    } else if (m.method === "Network.requestWillBeSent") {
      urls.set(p.requestId, p.request.url);
      h.ev.netTotal++;
    } else if (m.method === "Network.loadingFailed") {
      h.ev.netFail.push({
        url: String(urls.get(p.requestId) || p.requestId || "").slice(0, 170),
        error: String(p.errorText || "").slice(0, 60),
        canceled: !!p.canceled,
        type: p.type || "",
      });
    } else if (m.method === "Page.pageError") {
      h.ev.pageErrors.push(String(p.message || p.errorText || "").slice(0, 200));
    }
  });
  h.send("Network.enable", { maxTotalBufferSize: 20 * 1024 * 1024 }).catch(() => {});
  h.send("Log.enable", {}).catch(() => {});
}

async function val(h, expr, dflt = null) {
  const r = await h.evaluate(expr);
  if (r && r.error) {
    h.lastEvalError = r.error;
    (h.evalErrors || (h.evalErrors = [])).push(r.error.slice(0, 200));
    return dflt;
  }
  return r && r.value !== undefined ? r.value : dflt;
}
async function waitFor(h, expr, { timeout = 9000, every = 350, label = "" } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = await val(h, `return (${expr});`, false);
    if (v) return { ok: !!v, ms: timeout - (end - Date.now()), value: v };
    await wait(every);
  }
  return { ok: false, ms: timeout, value: false, label };
}

/** 可用性判据：界面渲染出来了、preload 桥在、没有崩溃文案、没有卡在加载态 */
async function probeUi(h) {
  const raw = await val(
    h,
    `const txt=(document.body&&document.body.innerText||'');
     return JSON.stringify({
       url:location.href, title:document.title,
       bodyLen:txt.length,
       nav:[...document.querySelectorAll('.nav-item')].map(x=>(x.textContent||'').trim()),
       bridge:{library:typeof window.libraryAPI, cards:typeof window.cardsAPI, backup:typeof window.backupAPI, settings:typeof window.settingsAPI},
       head:txt.replace(/\\s+/g,' ').slice(0,200)
     });`,
    "{}"
  );
  let p = {};
  try {
    p = JSON.parse(String(raw || "{}"));
  } catch {
    p = {};
  }
  p.crashLike = /A JavaScript error|JavaScript error occurred|process gone|Aw, Snap|Cannot read|is not defined|ERR_/i.test(String(p.head || ""));
  return p;
}

async function checkUsable(h, label) {
  const s = await waitFor(h, `document.querySelectorAll('.nav-item').length>=6`, { timeout: 20000, label: "nav" });
  const p = await probeUi(h);
  flow.check(
    `${label} 渲染出可用界面（非白屏/崩溃页/无限加载）`,
    p.bodyLen > 60 && !p.crashLike && s.ok,
    ">60 字符 · 无崩溃文案 · 导航已挂载",
    `bodyLen=${p.bodyLen} nav=${p.nav ? p.nav.length : 0} 崩溃文案=${p.crashLike} · url=${String(p.url).slice(0, 70)} · 首屏="${String(p.head).slice(0, 46)}"`
  );
  const b = p.bridge || {};
  flow.check(
    `${label} preload 四座桥在场（主进程未在半路崩）`,
    b.library === "object" && b.cards === "object" && b.backup === "object" && b.settings === "object",
    "object×4",
    JSON.stringify(b)
  );
  flow.record(`${label} 导航项`, (p.nav || []).join(","));
  flow.record(`${label} 从 spawn 到 CDP 有页面目标 / 到界面可用`, `${h.upMs}ms / 再 ${s.ms}ms（target 出现≠界面可用）`);
  return p;
}

function reportEvents(h, label) {
  const e = h.ev || { errors: [], warnings: [], exceptions: [], netFail: [], netTotal: 0 };
  flow.record(`${label} console 错误数`, `${e.errors.length}${e.errors.length ? " :: " + e.errors.slice(0, 4).map((x) => x.text.slice(0, 90)).join(" | ") : ""}`);
  flow.record(`${label} 未捕获异常数`, `${e.exceptions.length}${e.exceptions.length ? " :: " + e.exceptions.slice(0, 3).join(" | ") : ""}`);
  flow.record(`${label} 失败请求`, `${e.netFail.length}/${e.netTotal} :: ${e.netFail.slice(0, 6).map((x) => `${x.error || "?"}@${x.url.slice(0, 40)}`).join(" | ")}`);
  flow.record(`${label} console 警告数`, e.warnings.length);
  return e;
}

function tail(file, n = 900) {
  try {
    const s = fs.readFileSync(file, "utf8");
    return s.slice(-n).replace(/\s+/g, " ");
  } catch (e) {
    return `读不到日志:${String(e.message || e).slice(0, 60)}`;
  }
}

let portCursor = 0;
/** 起一发真实应用（每案例一发；env/flag 是进程级的，只能分开起） */
async function launchCase({ caseName, args = [], env = {}, userData = null, fresh = false, appPath = ROOT, cwd = ROOT, preferIndex = true, connectTimeoutMs = 115_000, noSandbox = false }) {
  if (noSandbox) args = [...args, "--no-sandbox"];
  const base = BASE_PORT + (portCursor++ % 6) * 2;
  const port = await pickPort(base);
  if (!port) return { skip: true, reason: `端口 ${base}–${base + 11} 全占用（别的会话在跑），跳过` };
  if (!fs.existsSync(ELECTRON)) return { skip: true, reason: `未找到 ${ELECTRON}` };
  const dir = userData || path.join(SCRATCH, `ud-${caseName}`);
  try {
    if (fresh) freshDir(dir);
    else fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    return { timeout: true, reason: `userData 目录本身建不起来：${String(e.code || e.message || e).slice(0, 120)} · path=${dir}` };
  }
  const logFile = path.join(RESULTS_DIR, `f46-${caseName}.app.log`);
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  try {
    fs.writeFileSync(logFile, `:: F46 ${caseName} · ${new Date().toISOString()} · port=${port} · userData=${dir}\n:: appPath=${appPath} cwd=${cwd}\n:: args=${JSON.stringify(args)}\n:: extraEnv=${JSON.stringify(env)}\n---- electron stdout/stderr ----\n`, "utf8");
  } catch {
    /* ignore */
  }
  const fd = fs.openSync(logFile, "a");
  const t0 = Date.now();
  const child = spawn(ELECTRON, [appPath, `--remote-debugging-port=${port}`, ...args], {
    cwd,
    stdio: ["ignore", fd, fd],
    // 同 tests/flows/lib/guienv.cjs 的教训：npm 会把 --inspect 留在环境里传给子进程，
    // 带上它 Electron 会打印「Waiting for the debugger to disconnect...」并把整个启动冻住。
    ignoreDefaultArgs: ["--inspect"],
    env: { ...process.env, M7_TEST_USERDATA: dir, ...env },
  });
  try {
    flow.record(`${caseName} spawn`, `pid=${child.pid} exe=${path.relative(ROOT, ELECTRON)} app=${path.relative(ROOT, appPath) || appPath}`);
  } catch {
    /* ignore */
  }
  const conn = await cdpConnect(port, child, { timeoutMs: connectTimeoutMs, preferIndex });
  conn.upMs = Date.now() - t0;
  const h = { ...conn, dir, child, port, logFile, caseName };
  if (h.ws) attachCollectors(h);
  return h;
}

/** 起不来 = 记录观察 + 重试一次确认；两次都不起才升格为断言失败（缺陷候选） */
async function withApp(opts, body) {
  let last = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const name = attempt === 1 ? opts.caseName : `${opts.caseName}-retry${attempt}`;
    // 第 2 次尝试额外补 --no-sandbox：本机沙箱启动失败已被别的会话证实为环境问题
    // （tests/flows/lib/guienv.cjs 的 --no-sandbox 注释），第一次不带才是用户真实跑法，
    // 若第一次起不来而第二次靠 --no-sandbox 起来，两次的差别本身就是一条记录。
    const h = await launchCase({ ...opts, caseName: name, noSandbox: attempt > 1 });
    if (h.skip) {
      flow.record(`${opts.caseName} 环境冲突`, h.reason);
      return null;
    }
    if (h.skippedByExit || h.timeout) {
      last = h;
      flow.record(`${opts.caseName} 第 ${attempt} 次启动未成功`, `${h.reason}${attempt > 1 ? "（已补 --no-sandbox）" : ""} · 用时 ${h.upMs}ms · 日志尾: ${tail(h.logFile, 500)}`);
      if (h.child) await stop(h);
      continue;
    }
    if (attempt > 1) flow.record(`${opts.caseName} 只有加 --no-sandbox 才起得来`, `第 1 次：${last && last.reason}`);
    flow.record(`${opts.caseName} 起来用时`, `${h.upMs}ms · 附着目标 ${String(h.attachedUrl).slice(0, 70)}`);
    try {
      return await body(h);
    } finally {
      try {
        reportEvents(h, opts.caseName);
        if (h.evalErrors && h.evalErrors.length) flow.record(`${opts.caseName} 页内求值报错（测据缺口，非产品判据）`, `${h.evalErrors.length} 次 :: ${h.evalErrors.slice(0, 3).join(" | ")}`);
      } catch {
        /* ignore */
      }
      try {
        fs.appendFileSync(h.logFile, `\n---- F46 CDP 采集（${opts.caseName}）----\nconsole.error=${JSON.stringify((h.ev.errors || []).slice(0, 12), null, 1)}\nexceptions=${JSON.stringify((h.ev.exceptions || []).slice(0, 8), null, 1)}\nnetFail=${JSON.stringify((h.ev.netFail || []).slice(0, 12), null, 1)}\n---- 日志尾 ----\n${tail(h.logFile, 1200)}\n`, "utf8");
      } catch {
        /* ignore */
      }
      await stop(h);
    }
  }
  flow.check(
    `${opts.caseName} 应用在该环境下能在 120s 内起来（已重试 1 次）`,
    false,
    "起得来",
    `两次都不起：${last && last.reason} · 用时 ${last && last.upMs}ms · 日志尾: ${last ? tail(last.logFile, 400) : "无"}`
  );
  return null;
}

// ---------- 磁盘侧工具 ----------
function sha1(file) {
  try {
    return crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex").slice(0, 12);
  } catch {
    return "无文件";
  }
}
function statOf(p) {
  try {
    const s = fs.statSync(p);
    return { size: s.size, mtime: new Date(s.mtimeMs).toISOString(), mode: (s.mode & 0o777).toString(8), readOnly: !(s.mode & 0o200) };
  } catch (e) {
    return { error: String(e.code || e.message || e).slice(0, 60) };
  }
}
async function diskCounts(dir) {
  const dbf = path.join(dir, "library.db");
  if (!fs.existsSync(dbf)) return { missingDb: true };
  const cp = path.join(SCRATCH, `_audit-${process.pid}.db`);
  try {
    fs.copyFileSync(dbf, cp);
  } catch (e) {
    return { copyError: String(e.code || e.message).slice(0, 60) };
  }
  try {
    const a = await audit(cp);
    const one = (t) => {
      try {
        return a.count(t);
      } catch {
        return -1;
      }
    };
    const out = { items: one("library_items"), docs: one("documents"), cards: one("cards"), journal: one("journal_entries"), logs: one("review_logs"), dbBytes: fs.statSync(dbf).size, sha: sha1(dbf) };
    try {
      out.journalDates = a.rows("SELECT entry_date FROM journal_entries ORDER BY rowid DESC LIMIT 3").map((r) => String(r.entry_date));
    } catch {
      /* ignore */
    }
    a.close();
    return out;
  } catch (e) {
    return { auditError: String(e.message || e).slice(0, 140) };
  } finally {
    try {
      fs.rmSync(cp, { force: true });
    } catch {
      /* ignore */
    }
  }
}
function walkAll(dir, acc = [], depth = 0) {
  if (depth > 6) return acc;
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return acc;
  }
  for (const n of names) {
    const full = path.join(dir, n);
    let s = null;
    try {
      s = fs.statSync(full);
    } catch {
      /* ignore */
    }
    if (s && s.isDirectory()) walkAll(full, acc, depth + 1);
    else acc.push({ full, size: s ? s.size : 0 });
  }
  return acc;
}

// ---------- 黄金动作集（E6 每档都要走一遍） ----------
async function goldenSet(h, tag) {
  const title = `F46-${tag} 便携书 ${Date.now().toString(36)}`;
  const out = { title };
  out.addBook = await val(
    h,
    `try{ const r=await window.libraryAPI.createFromPaste(${JSON.stringify(title)}, ${JSON.stringify(MD)}); return (r&&r.id)?('ok:'+r.id):('no-id:'+JSON.stringify(r).slice(0,60)); }catch(e){ return 'throw:'+String(e.message||e).slice(0,90); }`,
    "eval-fail"
  );
  await val(h, clickText(".nav-item", "卡片"));
  await wait(900);
  await val(h, clickText(".nav-item", "书架"));
  await wait(1500);
  const settled = await waitFor(h, `document.body.innerText.includes(${JSON.stringify(title)})`, { timeout: 12000 });
  out.shelfShowsBook = settled.ok;
  // 真实鼠标点开书 → 阅读器
  const rect = await val(
    h,
    `const cards=[...document.querySelectorAll('.book-card,[class*="book-card"]')];
     const t=cards.find(e=>(e.textContent||'').includes(${JSON.stringify(title)}))||cards[0];
     if(!t) return 'no-el'; t.scrollIntoView({block:'center'}); const r=t.getBoundingClientRect();
     return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});`
  );
  let pt = {};
  try {
    pt = JSON.parse(String(rect || "{}"));
  } catch {
    pt = {};
  }
  if (Number.isFinite(pt.x)) {
    await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y, button: "none" });
    await wait(120);
    await h.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: 1, buttons: 1 });
    await h.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: 1, buttons: 0 });
    out.readerOpened = (await waitFor(h, `!!document.querySelector("[class*=reader],[class*=Reader],iframe,webview,[class*=foliate]")`, { timeout: 9000 })).ok;
    out.clickAt = `${pt.x},${pt.y}`;
  } else {
    out.readerOpened = false;
    out.clickAt = "无卡片元素";
  }
  await val(h, clickText(".nav-item", "书架"));
  await wait(600);
  out.makeCard = await val(
    h,
    `try{ const r=await window.cardsAPI.create({noteText:'F46-${tag} 卡',cardType:'qa',frontMarkdown:'渐进阅读把长文切成什么？',backMarkdown:'可处理的小块',priority:50,tags:[]}); return (r&&r.id)?('ok:'+r.id):JSON.stringify(r).slice(0,70); }catch(e){ return 'throw:'+String(e.message||e).slice(0,90); }`,
    "eval-fail"
  );
  out.writeSetting = await val(
    h,
    `try{ await window.settingsAPI.set('app','accentColor','#123456'); const v=await window.settingsAPI.get('app','accentColor'); return 'read-back='+JSON.stringify(v); }catch(e){ return 'throw:'+String(e.message||e).slice(0,90); }`,
    "eval-fail"
  );
  out.backup = await val(
    h,
    `try{ const r=await window.backupAPI.create({}); return JSON.stringify(r).slice(0,220); }catch(e){ return 'throw:'+String(e.message||e).slice(0,90); }`,
    "eval-fail"
  );
  out.uiCounts = await val(h, `let n=0; try{ n=(await window.libraryAPI.list()).length; }catch(e){} return n;`, -1);
  return out;
}

function describeGolden(g, label) {
  flow.record(`${label} 黄金动作集`, `加书=${g.addBook} 书架可见=${g.shelfShowsBook} 开卷=${g.readerOpened}@${g.clickAt} 制卡=${g.makeCard} 设置=${g.writeSetting} 备份=${String(g.backup).slice(0, 120)}`);
}

// ============================ 案例 ============================

/** E1 软件渲染 / 无 GPU */
async function caseE1() {
  await withApp({ caseName: "e1", fresh: true, userData: path.join(SCRATCH, "ud-e1"), args: ["--disable-gpu", "--disable-gpu-compositing", "--disable-software-rasterizer"] }, async (h) => {
    flow.section("E1 软件渲染 / 无 GPU（玻璃拟态 backdrop-filter 的机器）");
    const p = await checkUsable(h, "E1");
    const g = await goldenSet(h, "E1");
    describeGolden(g, "E1");
    await val(h, clickText(".nav-item", "书架"));
    await waitFor(h, `document.body.innerText.includes(${JSON.stringify(g.title)})`, { timeout: 8000 });
    const render = await val(
      h,
      `function vis(el){ if(!el) return false; const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return r.width>2&&r.height>2&&s.visibility!=='hidden'&&Number(s.opacity||1)>0.05; }
       const gl=(()=>{ try{ const c=document.createElement('canvas'); const g=c.getContext('webgl')||c.getContext('experimental-webgl'); if(!g) return {ok:false,why:'no-webgl-context'}; const d=g.getExtension('WEBGL_debug_renderer_info'); return {ok:true, renderer:d?String(g.getParameter(d.UNMASKED_RENDERER_WEBGL)):'?', vendor:d?String(g.getParameter(d.UNMASKED_VENDOR_WEBGL)):'?'}; }catch(e){ return {ok:false,why:String(e.message||e).slice(0,60)}; } })();
       const glass=[...document.querySelectorAll('*')].filter(e=>{const s=getComputedStyle(e);return (s.backdropFilter&&s.backdropFilter!=='none')||(s.webkitBackdropFilter&&s.webkitBackdropFilter!=='none');}).length;
       const cssRules=(()=>{ let n=0; const sheets=[...(document.styleSheets||[])]; for(const sh of sheets){ try{ for(const r of sh.cssRules||[]){ const t=r.cssText||''; if(/backdrop-filter/i.test(t)) n++; } }catch(e){} } return n; })();
       const shot={导航:[...document.querySelectorAll('.nav-item')].filter(vis).length, 书卡:[...document.querySelectorAll('.book-card')].filter(vis).length, 图注:[...document.querySelectorAll('.cap,.cap-title')].filter(vis).length, 正文节点:[...document.querySelectorAll('p,h1,h2,.topbar-title')].filter(vis).length};
       return JSON.stringify({gl,glass,cssRules,bodyLen:document.body.innerText.length,shot,样式表:document.styleSheets.length, 取到书本文本:document.body.innerText.includes(${JSON.stringify(g.title)})});`,
      "{}"
    );
    flow.record("E1 WebGL 渲染器（软件渲染证据）", render);
    let rj = {};
    try {
      rj = JSON.parse(String(shotSafe(render)));
    } catch {
      /* ignore */
    }
    flow.check("E1 软件渲染下正文与面板仍在（导航/书卡/图注/标题可见数都>0）", (rj.shot || {}).导航 >= 6 && (rj.shot || {}).书卡 >= 1 && (rj.shot || {}).正文节点 >= 3, "导航≥6 书卡≥1 正文≥3", JSON.stringify(rj.shot));
    flow.record("E1 玻璃拟态在 DOM/CSSOM 里的痕迹（计算样式命中元素数 / 含该声明的 CSS 规则数）", `${rj.glass} / ${rj.cssRules}`);
    flow.record("E1 截图时首屏", String(p.head).slice(0, 90));
    flow.record("E1 截图内容", "书架 + 一本已播种的书（f46-e1.png 交主会话目测）");
    flow.record("E1 截图路径", await h.shot("f46-e1"));
  });
}
function shotSafe(v) {
  return typeof v === "string" ? v : JSON.stringify(v || {});
}

/** E2 完全离线 */
async function caseE2() {
  await withApp(
    {
      caseName: "e2",
      fresh: true,
      userData: path.join(SCRATCH, "ud-e2"),
      args: ['--proxy-server=http=127.0.0.1:9;https=127.0.0.1:9', '--host-resolver-rules=MAP * 127.0.0.1:9'],
    },
    async (h) => {
      flow.section("E2 完全离线（DNS 与代理一律打进黑洞端口 9）");
      flow.record("E2 断网参数", "--proxy-server=http=127.0.0.1:9;https=127.0.0.1:9 + --host-resolver-rules='MAP * 127.0.0.1:9'");
      const t0 = Date.now();
      const p = await checkUsable(h, "E2");
      const g = await goldenSet(h, "E2");
      describeGolden(g, "E2");
      // 逐页走一遍：离线时最容易「等一个网络请求」而卡在某个页面上
      const perPage = {};
      const stuck = [];
      for (const nav of ["队列", "复习", "卡片", "日记", "数据", "书架"]) {
        const tt = Date.now();
        await val(h, clickText(".nav-item", nav));
        // 判据只看「有没有长期停在加载中…」——空态页本来就只有几十个字，不能拿字数当加载判据（第一版误判过）
        const r = await waitFor(h, `!/加载中/.test(document.body.innerText)`, { timeout: 12000 });
        const len = await val(h, `return document.body.innerText.length`, 0);
        const txt = String(await val(h, `return document.body.innerText.replace(/\\s+/g,' ').slice(0,44)`, ""));
        perPage[nav] = `${Date.now() - tt}ms len=${len} 落定=${r.ok} 文本="${txt}"`;
        if (!r.ok) stuck.push(`${nav}: ${txt}`);
      }
      flow.record("E2 六个页面逐页用时/字数/实际文本（离线）", JSON.stringify(perPage, null, 0));
      const spent = Date.now() - t0;
      flow.check("E2 离线时六页都不长期停在「加载中…」（界面没在等网络）", stuck.length === 0, "无卡页", JSON.stringify(stuck));
      flow.check("E2 离线不拖死整轮交互（全流程 <90s）", spent < 90000, "<90000ms", `${spent}ms`);
      flow.record("E2 白屏判据", `bodyLen=${p.bodyLen} head=${String(p.head).slice(0, 60)}`);
      const e = reportEvents(h, "E2");
      const external = e.netFail.filter((x) => !/^(file|chrome-extension|devtools|data):/i.test(x.url));
      flow.record("E2 失败的外部请求（离线时该失败的）", `${external.length} 条 :: ${external.slice(0, 8).map((x) => `${x.error}@${x.url.slice(0, 46)}`).join(" | ")}`);
      flow.record("E2 界面是否被某个请求拖住（结论）", e.netFail.length && !/加载中/.test(String(p.head)) ? `有 ${e.netFail.length} 条失败但界面照常（失败被兜住）` : "无失败请求或界面未受影响");
      flow.record("E2 截图路径", await h.shot("f46-e2"));
    }
  );
}

/** E3 外语系统 */
async function caseE3() {
  await withApp({ caseName: "e3", fresh: true, userData: path.join(SCRATCH, "ud-e3"), args: ["--lang=ja-JP"], env: { LANG: "ja_JP.UTF-8", LC_ALL: "ja_JP.UTF-8" } }, async (h) => {
    flow.section("E3 外语系统（--lang=ja-JP + LANG=ja_JP.UTF-8）");
    const loc = await val(
      h,
      `return JSON.stringify({navigatorLanguage:navigator.language, languages:navigator.languages.join(','), acceptLangGuess:'-', docLang:document.documentElement.lang||'(空)', tz:Intl.DateTimeFormat().resolvedOptions().timeZone, locale1:Intl.NumberFormat().resolvedOptions().locale});`,
      "{}"
    );
    flow.record("E3 渲染层语言环境", loc);
    const p = await checkUsable(h, "E3");
    const g = await goldenSet(h, "E3");
    describeGolden(g, "E3");
    await val(h, clickText(".nav-item", "书架"));
    await waitFor(h, `document.body.innerText.includes(${JSON.stringify(g.title)})`, { timeout: 8000 });
    const nav = String(await val(h, `return [...document.querySelectorAll('.nav-item')].map(x=>x.textContent.trim()).join(',')`, ""));
    const want = ["书架", "队列", "复习", "卡片", "日记", "数据"];
    flow.check("E3 界面标签仍是产品自己的中文（没有被 --lang 带跑到日语）", want.every((w) => nav.includes(w)), want.join(","), nav);
    const jaBled = await val(h, `const t=document.body.innerText; const hits=['ブック','本棚','カード','復習','読書','追加','設定','今日','完了']; return hits.filter(h=>t.includes(h)).join(',');`, "");
    flow.record("E3 正文里出现的日语词（应为空）", jaBled || "无");
    // 豆腐块只能靠截图目测；DOM 侧能量的是「每个取样字符都有非零字宽，且不等于 notdef 宽度」
    const glyph = await val(
      h,
      `const cs=['渐','进','読','書','間','反','復','あ','イ','Ω','①','🙂'];
       const c=document.createElement('canvas').getContext('2d');
       const notdef=c.measureText('\\uFFFF').width;
       const w=cs.map(ch=>({ch,px:c.measureText(ch).width}));
       const zero=w.filter(x=>!(x.px>0)).map(x=>x.ch);
       
       const probe=document.createElement('div');
       probe.style.cssText='position:fixed;left:-9999px;top:0;white-space:pre;font:16px '+getComputedStyle(document.body).fontFamily;
       probe.textContent='間隔反復は忘却曲線に基づき渐进阅读';
       document.body.appendChild(probe);
       const box=Math.round(probe.getBoundingClientRect().width);
       const ascii=document.createElement('div'); ascii.style.cssText=probe.style.cssText; ascii.textContent='AAAAAAAAAAAAAAAAAAAA'; document.body.appendChild(ascii);
       const ref=Math.round(ascii.getBoundingClientRect().width);
       probe.remove(); ascii.remove();
       return JSON.stringify({widths:w.map(x=>x.ch+':'+x.px.toFixed(1)).join(' '),notdef:notdef.toFixed(1),零宽:zero,混排探针宽:box,同长ASCII宽:ref,字体检查:document.fonts?document.fonts.check('16px sans-serif','間隔反復'):'n/a', bodyFont:getComputedStyle(document.body).fontFamily.slice(0,70)});`,
      "{}"
    );
    flow.record("E3 取样字符字宽/豆腐风险测量", glyph);
    let gj = {};
    try {
      gj = JSON.parse(String(glyph || "{}"));
    } catch {
      /* ignore */
    }
    flow.record("E3 说明", "原计划的「与 \\uFFFF(notdef) 同宽」判据实测不具判别力（10px 画布下 CJK 与 notdef 都是 10.0），已从取样里删掉，避免留下一条永远为真的断言；豆腐块的最终判断交截图");
    flow.check("E3 中英日混排取样字符全部有非零字宽、且混排探针有真实宽度（DOM 侧能测的下限；豆腐块看截图）", (gj.零宽 || []).length === 0 && (gj.混排探针宽 || 0) > (gj.同长ASCII宽 || 9999) * 0.8, "零宽=0 且 混排宽 ≥ 0.8×ASCII 宽", JSON.stringify({ 零宽: gj.零宽, 混排探针宽: gj.混排探针宽, 同长ASCII宽: gj.同长ASCII宽, bodyFont: gj.bodyFont }));
    flow.record("E3 首屏文本", String(p.head).slice(0, 70));
    flow.record("E3 截图路径（日语系统下的中文界面 + 混排正文）", await h.shot("f46-e3"));
  });
}

// ---- E4 时区 ----
function zoneDateInNode(zone) {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return s; // YYYY-MM-DD
}
function zoneFull(zone) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date());
}
async function runE4(id, zone, note) {
  await withApp({ caseName: id, fresh: true, userData: path.join(SCRATCH, `ud-${id}`), env: { TZ: zone } }, async (h) => {
    flow.section(`E4 ${id} 时区 TZ=${zone}（${note}）`);
    const before = JSON.parse(String(await val(h, `return JSON.stringify({tz:Intl.DateTimeFormat().resolvedOptions().timeZone, local:new Date().toString(), offsetMin:-new Date().getTimezoneOffset()});`, "{}")));
    flow.record(`${id} 仅靠 env TZ 时渲染层的时区（Windows 上 Chromium 是否吃到 env TZ）`, `${before.tz} · offset=${before.offsetMin}min · ${before.local}`);
    const p = await checkUsable(h, id);
    flow.record(`${id} 首屏`, String(p.head).slice(0, 60));
    // 先把「主进程眼里的今天」落到盘上（日记条目 entry_date = 主进程本地日期）
    const j = await val(
      h,
      `try{ const r=await window.journalAPI.create({contentMarkdown:'F46 ${id} 时区探针'}); return JSON.stringify({ok:!!(r&&r.id), entryDate:r&&r.entryDate, createdAt:r&&r.createdAt}); }catch(e){ return 'throw:'+String(e.message||e).slice(0,90); }`,
      "{}"
    );
    flow.record(`${id} 主进程写的日记 entry_date`, String(j));
    // 现在把渲染层也搬进目标时区（真实机器上两侧一定一致；两侧不一致本身就是跨进程口径缺陷）
    const emu = await h.send("Emulation.setTimezoneOverride", { timezoneId: zone });
    flow.record(`${id} Emulation.setTimezoneOverride`, emu.error ? `失败:${JSON.stringify(emu.error).slice(0, 90)}` : "已生效");
    const after = JSON.parse(String(await val(h, `const d=new Date(); return JSON.stringify({tz:Intl.DateTimeFormat().resolvedOptions().timeZone, ymd:d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'), local:d.toString(), offsetMin:-d.getTimezoneOffset()});`, "{}")));
    const exp = zoneDateInNode(zone);
    flow.record(`${id} 独立算出的该时区「今天」`, `${exp}（该时区此刻 ${zoneFull(zone)}，与 UTC+8 本机对照）`);
    flow.eq(`${id} 渲染层 Date 的今天 == 独立计算的该时区今天`, after.ymd, exp);
    // 界面读数：日记页今日表头
    await val(h, clickText(".nav-item", "日记"));
    const jr = await waitFor(h, `document.querySelectorAll('.journal-day-date').length>0`, { timeout: 10000 });
    const journalHead = await val(
      h,
      `const heads=[...document.querySelectorAll('.journal-day-head')];
       const t=heads.find(x=>/今天/.test(x.innerText))||heads[0];
       return JSON.stringify({found:!!t, head:t?t.innerText.replace(/\\s+/g,' ').trim().slice(0,60):'(无)', 全部头:heads.slice(0,3).map(x=>x.innerText.replace(/\\s+/g,' ').trim().slice(0,40))});`,
      "{}"
    );
    flow.record(`${id} 日记页「今天」表头（渲染层口径）`, `${jr.ok ? "已挂载" : "未挂载"} ${journalHead}`);
    const jhead = String(JSON.parse(String(journalHead || "{}")).head || "");
    flow.check(`${id} 日记页表头显示的日期 == 该时区今天`, jhead.includes(exp), `含 ${exp}`, jhead || "(无表头)");
    // 界面读数：数据页（仪表盘）
    await val(h, clickText(".nav-item", "数据"));
    await waitFor(h, `document.body.innerText.length>80`, { timeout: 10000 });
    const dash = await val(
      h,
      `const st=await window.statsAPI.overview();
       const days=st.readingDays||[]; const last=days.length?days[days.length-1].date:null;
       const f=last==null?null:new Date(last);
       const lastYmd=f==null?null:f.getFullYear()+'-'+String(f.getMonth()+1).padStart(2,'0')+'-'+String(f.getDate()).padStart(2,'0');
       const cutoff=await window.settingsAPI.get('app','dayCutoffHour');
       const svg=[...document.querySelectorAll('svg text')].map(t=>(t.textContent||'').trim()).filter(s=>/^\\d{2}-\\d{2}$/.test(s));
       const mmdd=[...(document.body.textContent||'').match(/\\d{2}-\\d{2}/g)||[]].slice(-4);
       return JSON.stringify({lastBucket:lastYmd, 桶数:days.length, dayCutoffHour:cutoff, dueToday:st.kpi&&st.kpi.dueToday, svg日期轴:svg.slice(-4), 界面日期串:mmdd});`,
      "{}"
    );
    flow.record(`${id} 仪表盘：主进程末桶 + 渲染层时区格式化 + 界面日期轴`, dash);
    let dj = {};
    try {
      dj = JSON.parse(String(dash || "{}"));
    } catch {
      /* ignore */
    }
    // 主进程侧（TZ env 生效吗）：日记 entry_date 与仪表盘末桶都必须等于该时区今天
    const mainYmd = (() => {
      try {
        return String(JSON.parse(String(j || "{}")).entryDate || "");
      } catch {
        return "";
      }
    })();
    flow.record(`${id} 主进程口径两个读数`, `日记 entry_date=${mainYmd} · 仪表盘末桶=${dj.lastBucket} · 渲染层=${after.ymd} · 期望=${exp}`);
    flow.check(`${id} 主进程「今天」（日记落库日期）== 该时区今天（env TZ 是否真打进主进程）`, mainYmd === exp, exp, mainYmd || "(取不到)");
    flow.check(`${id} 主进程「今天」（仪表盘末桶，渲染层时区格式化）== 该时区今天`, dj.lastBucket === exp, exp, String(dj.lastBucket));
    flow.check(`${id} 两侧同源：主进程末桶日期 == 渲染层今日`, String(dj.lastBucket) === after.ymd, after.ymd, String(dj.lastBucket));
    // 队列页（§4.2-20 唯一口径）：队头读数
    await val(h, clickText(".nav-item", "队列"));
    await waitFor(h, `document.querySelector('.queue-wrap,.review-count')`, { timeout: 8000 });
    const q = await val(h, `const el=document.querySelector('.review-count'); return el?el.innerText.trim().replace(/\\s+/g,' '):'(无队列头)';`, "(无)");
    flow.record(`${id} 队列头读数`, String(q));
    const due = await val(h, `try{ const r=await window.cardsAPI.todayQueue(); return JSON.stringify({放行卡:(r&&r.cards?r.cards.length:0), 暂缓:(r&&r.deferred?r.deferred.length:0), nowIsNaN:Number.isNaN(r&&r.now), now:r&&r.now}); }catch(e){ return 'throw:'+String(e.message||e).slice(0,60); }`, "{}");
    flow.record(`${id} 今日队列（主进程算）`, String(due));
    const disk = await diskCounts(h.dir);
    flow.record(`${id} 盘上事实`, JSON.stringify(disk));
    await val(h, clickText(".nav-item", "日记"));
    await waitFor(h, `document.querySelectorAll('.journal-day-date').length>0`, { timeout: 8000 });
    flow.record(`${id} 截图停在日记页（有「今天」日期表头，最能看出时区读错）`, "f46-" + id);
    flow.record(`${id} 截图路径`, await h.shot(`f46-${id}`));
  });
}

/** E5 高对比度 / 无障碍强制色 */
async function caseE5() {
  await withApp({ caseName: "e5", fresh: true, userData: path.join(SCRATCH, "ud-e5") }, async (h) => {
    flow.section("E5 强制色（forced-colors: active，Windows 高对比度等价模拟）");
    flow.record("与 F44 的分工", "「CDP 数组形式才能打开强制色」已由 F44 复核登记为 D-TEST-26，本案例不重复定性；E5 只量**打开之后文字是否还可读**（计算色 vs 有效背景色）");
    const g0 = await goldenSet(h, "E5");
    describeGolden(g0, "E5");
    const before = await val(h, `return JSON.stringify({matches:matchMedia('(forced-colors: active)').matches, prefersContrast:matchMedia('(prefers-contrast)').media});`, "{}");
    flow.record("E5 打开强制色之前", before);
    const objForm = await h.send("Emulation.setEmulatedMedia", { features: { forcedColors: "active" } });
    flow.record("E5 CDP 对象形式 features:{forcedColors:'active'} 的响应", objForm.error ? `被拒:${JSON.stringify(objForm.error).slice(0, 120)}` : "被接受");
    const arrForm = await h.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
    flow.record("E5 CDP 数组形式 MediaFeature 的响应", arrForm.error ? `被拒:${JSON.stringify(arrForm.error).slice(0, 120)}` : "已接受");
    await val(h, clickText(".nav-item", "书架"));
    await waitFor(h, `document.body.innerText.includes(${JSON.stringify(g0.title)})`, { timeout: 9000 });
    const sample = await val(
      h,
      `function rgba(c){ const m=/rgba?\\(([^)]+)\\)/.exec(String(c||'')); if(!m) return null; const a=m[1].split(',').map(x=>parseFloat(x)); return {r:a[0]|0,g:a[1]|0,b:a[2]|0,al:a.length>3?a[3]:1}; }
       function effBg(el){ var e=el; while(e&&e.nodeType===1){ var p=rgba(getComputedStyle(e).backgroundColor); if(p&&p.al>0.99) return 'rgb('+p.r+', '+p.g+', '+p.b+')'; e=e.parentElement; } return 'rgb(255, 255, 255)'; }
       function vis(el){ const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return r.width>2&&r.height>2&&s.visibility!=='hidden'&&Number(s.opacity||1)>0.05 && (el.textContent||'').trim().length>0; }
       const sel='body, .nav-item, .nav-item.active, .topbar-title, .btn, .btn-primary, .book-card, .cap, .cap-title, h1, h2, .empty-text, [class*=panel], [class*=card]';
       const els=[...document.querySelectorAll(sel)].filter(vis).slice(0,80);
       const bad=[]; const pairs=new Set();
       for(const el of els){ const c=getComputedStyle(el).color; const bg=effBg(el); pairs.add(c+' on '+bg);
         if(c.replace(/\\s+/g,'')===bg.replace(/\\s+/g,'')) bad.push({el:el.tagName+'.'+String(el.className).slice(0,24), c, bg}); }
       return JSON.stringify({forced:matchMedia('(forced-colors: active)').matches, checked:els.length, 同色不可读:bad.slice(0,8), 取样色对:[...pairs].slice(0,10), forcedColorAdjust:[...new Set(els.slice(0,20).map(e=>getComputedStyle(e).forcedColorAdjust||''))]});`,
      "{}"
    );
    flow.record("E5 强制色下的取样", sample);
    let sj = {};
    try {
      sj = JSON.parse(String(sample || "{}"));
    } catch {
      /* ignore */
    }
    flow.check("E5 强制色模式真的打开了（matchMedia forced-colors: active）", sj.forced === true, true, String(sj.forced));
    flow.check(`E5 强制色后文字与背景不同色（取样 ${sj.checked || 0} 个可见文本元素，0 个「文字色==背景色」）`, (sj.同色不可读 || []).length === 0 && sj.checked > 5, "同色=0 且取样>5", JSON.stringify({ checked: sj.checked, bad: (sj.同色不可读 || []).slice(0, 4) }));
    flow.record("E5 观察到的调色板（前 10 对）", JSON.stringify(sj.取样色对 || []));
    flow.record("E5 forced-color-adjust 声明", JSON.stringify(sj.forcedColorAdjust || []));
    const p = await probeUi(h);
    flow.check("E5 强制色后界面仍在（未因色板切换白屏）", p.bodyLen > 60 && p.nav.length >= 6, ">60 字符 + 6 入口", `len=${p.bodyLen} nav=${p.nav.length}`);
    flow.record("E5 截图路径（强制色整窗）", await h.shot("f46-e5"));
  });
}

/** E6 敌意 userData 路径 */
async function caseE6(id, label, makeUserData, extra = {}) {
  let userData;
  try {
    userData = makeUserData();
  } catch (e) {
    flow.record(`${id} 环境搭不起来（测试侧）`, String(e.message || e).slice(0, 160));
    return;
  }
  flow.record(`${id} 请求的 userData`, `${userData} · 长度=${userData.length} · ${label}`);
  flow.record(`${id} DB 将落在`, `${path.join(userData, "library.db")} · 长度=${path.join(userData, "library.db").length}`);
  let golden = null;
  const ok = await withApp({ caseName: id, fresh: true, userData, preferIndex: true, ...extra }, async (h) => {
    flow.section(`E6 ${id} 敌意 userData：${label}`);
    const p = await checkUsable(h, id);
    flow.record(`${id} 首屏`, String(p.head).slice(0, 60));
    golden = await goldenSet(h, id);
    describeGolden(golden, id);
    flow.record(`${id} 截图路径（书架 + 已播种的书）`, await h.shot(`f46-${id}`));
    return { dir: h.dir };
  });
  if (!ok && !golden) {
    flow.record(`${id} 首启未成功，磁盘核对转由第二次启动确认`, "见上");
  }
  // 盘上核对：数据是不是真的落进了那个敌意目录
  const parent = path.dirname(userData);
  let onDiskListing = [];
  try {
    onDiskListing = fs.readdirSync(parent);
  } catch (e) {
    onDiskListing = ["读不到父目录:" + String(e.code || e.message).slice(0, 40)];
  }
  flow.record(`${id} 父目录实际条目`, `${JSON.stringify(onDiskListing).slice(0, 220)}`);
  const files = walkAll(userData);
  flow.record(`${id} 敌意目录里的文件`, `${files.length} 个 · 合计 ${files.reduce((s, f) => s + f.size, 0)}B · ${JSON.stringify(files.slice(0, 6).map((f) => `${path.relative(userData, f.full)}:${f.size}`)).slice(0, 260)}`);
  const disk = await diskCounts(userData);
  flow.record(`${id} 盘上 library.db 事实`, JSON.stringify(disk));
  const settingsFull = (() => {
    try {
      return String(fs.readFileSync(path.join(userData, "settings.json"), "utf8"));
    } catch (e) {
      return "读不到:" + String(e.code || e.message).slice(0, 40);
    }
  })();
  const settingsRaw = settingsFull.slice(0, 200);
  flow.record(`${id} settings.json`, settingsRaw);
  const backups = files.filter((f) => /backup.*\.zip$/i.test(f.full));
  flow.record(`${id} 备份 zip 落点`, backups.length ? `${backups.length} 个 :: ${backups[0].full.slice(0, 140)} (${backups[0].size}B)` : "无");
  if (golden) {
    flow.check(`${id} 黄金动作集在敌意路径下全部成功（加书/开卷/制卡/设置/备份）`, /^ok:/.test(String(golden.addBook)) && golden.readerOpened === true && /^ok:/.test(String(golden.makeCard)) && /read-back="#123456"/.test(String(golden.writeSetting)) && /"ok":true/.test(String(golden.backup)), "五项均成功", JSON.stringify({ add: golden.addBook, reader: golden.readerOpened, card: golden.makeCard, set: golden.writeSetting, backup: String(golden.backup).slice(0, 90) }));
    flow.check(`${id} 数据真的落在请求的敌意目录内（library.db 有书有卡）`, disk.items >= 1 && disk.cards >= 1, "items≥1 且 cards≥1", JSON.stringify(disk));
    flow.check(`${id} 备份也写在该目录内（不是掉到别处）`, backups.length >= 1 && backups.every((b) => norm(b.full).startsWith(norm(userData))), "≥1 个且前缀匹配", JSON.stringify({ backups: backups.map((b) => b.full.slice(0, 120)), userData: userData.slice(0, 120) }));
    flow.check(`${id} 设置的值真的写进了该目录的 settings.json`, /#123456/.test(settingsFull), "含 #123456", settingsFull.slice(0, 240));
  }
  // 第二次启动同一路径：数据必须还在
  const again = await withApp({ caseName: `${id}-r2`, userData, fresh: false, ...extra }, async (h) => {
    const p = await checkUsable(h, `${id} 二次启动`);
    flow.record(`${id} 二次启动首屏`, String(p.head).slice(0, 60));
    const seen = golden ? await val(h, `return document.body.innerText.includes(${JSON.stringify(golden.title)});`, false) : false;
    const cnt = await val(h, `try{ return (await window.libraryAPI.list()).length; }catch(e){ return 'throw:'+String(e.message||e).slice(0,60); }`, -1);
    flow.record(`${id} 二次启动 UI`, `书在架上=${seen} · libraryAPI.list 长度=${cnt}`);
    const d2 = await diskCounts(h.dir);
    flow.record(`${id} 二次启动后盘上事实`, JSON.stringify(d2));
    if (golden) {
      flow.check(`${id} 二次启动仍读得到第一次的书`, seen === true && Number(cnt) >= 1, "UI 含书名且 list≥1", JSON.stringify({ seen, cnt }));
      flow.eq(`${id} 二次启动没有把库改坏（items/cards 与第一次一致）`, [Number(d2.items), Number(d2.cards)], [Number(disk.items), Number(disk.cards)]);
    }
    return true;
  });
  if (!again) flow.check(`${id} 第二次启动（同一条敌意路径）能起来`, false, "起得来并连上 CDP", "见上面的两次记录");
}
function norm(p) {
  return String(p).replace(/\//g, "\\").toLowerCase().replace(/\\+$/, "");
}

/** E7 只读 / 被锁的数据目录 */
async function caseE7() {
  const dir = path.join(SCRATCH, "ud-e7");
  flow.section("E7 只读 / 被锁的数据目录（OneDrive 同步盘 / 杀软锁库的模拟）");
  // 第一次：正常建库
  const first = await withApp({ caseName: "e7-warm", fresh: true, userData: dir }, async (h) => {
    await checkUsable(h, "E7 预热");
    const r = await val(h, `try{ const x=await window.libraryAPI.createFromPaste('E7 预热书', ${JSON.stringify(MD)}); return x&&x.id?'ok':'null'; }catch(e){ return 'throw:'+String(e.message||e).slice(0,80); }`, "eval-fail");
    flow.record("E7 预热建库", String(r));
    return true;
  });
  if (!first) {
    flow.record("E7 预热失败，本案例无法继续", "第一次启动就没起来");
    return;
  }
  const dbf = path.join(dir, "library.db");
  if (!fs.existsSync(dbf)) {
    flow.check("E7 预热后盘上出现 library.db", false, "存在", "不存在（预热未落盘）");
    return;
  }
  const st0 = statOf(dbf);
  const sha0 = sha1(dbf);
  const disk0 = await diskCounts(dir);
  // attrib +R（走 cmd，与用户手动置只读同一条路）
  const at = spawnSync("cmd.exe", ["/c", "attrib", "+R", dbf], { encoding: "utf8" });
  try {
    fs.chmodSync(dbf, 0o444);
  } catch {
    /* ignore */
  }
  const st1 = statOf(dbf);
  flow.record("E7 attrib +R", `cmd exit=${at.status} out=${String(at.stdout || at.stderr || "").trim().slice(0, 90)}`);
  flow.record("E7 置只读前后", `before=${JSON.stringify(st0)} after=${JSON.stringify(st1)}`);
  if (!st1.readOnly) {
    flow.record("E7 只读属性没打上（判据失效）", JSON.stringify(st1));
    return;
  }
  const phantom = `E7 只读期幽灵书 ${Date.now().toString(36)}`;
  const snap = {};
  const res = await withApp({ caseName: "e7", fresh: false, userData: dir }, async (h) => {
    const p = await checkUsable(h, "E7 只读期");
    flow.record("E7 只读期首屏", String(p.head).slice(0, 90));
    // ① 走真实 UI：添加材料选单 → 粘贴材料编辑器输入 → 点「保存到书架」→ 界面说什么？
    const opened = await val(h, `const b=[...document.querySelectorAll('button')].find(x=>/添加材料/.test(x.textContent||'')); if(b){b.click(); return true;} return false;`, false);
    await wait(600);
    await val(h, `const it=[...document.querySelectorAll('[role=menu] .dd-item')].find(x=>/粘贴材料/.test(x.textContent||'')); if(it){it.click(); return true;} return false;`, false);
    await wait(1200);
    const filled = await val(
      h,
      `function setInput(el,v){ const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }
       const m=document.querySelector('[role=dialog],.modal-panel'); if(!m) return 'no-modal';
       const ti=m.querySelector('input[placeholder]'); const pm=m.querySelector('.ProseMirror'); if(!ti||!pm) return 'no-fields:'+m.querySelectorAll('input,.ProseMirror').length;
       setInput(ti, ${JSON.stringify(phantom)});
       pm.focus(); document.execCommand('selectAll', false, null); document.execCommand('insertText', false, ${JSON.stringify(MD)});
       if(!pm.textContent.includes('第一章')) return 'paste-failed';
       const btn=[...m.querySelectorAll('button')].find(b=>/保存到书架/.test(b.textContent||'')&&!b.disabled); if(!btn) return 'no-save-btn'; btn.click(); return 'clicked:'+(btn.textContent||'').trim();`,
      "eval-fail"
    );
    flow.record("E7 UI 添加材料", `开框=${opened} · 提交=${filled}`);
    await wait(3000);
    const afterSubmit = await probeUi(h);
    const modalStill = await val(h, `return !!document.querySelector('.modal-panel');`, false);
    const toast = await val(h, `const t=[...document.querySelectorAll('[role=alert],[class*=toast],[class*=notice],[class*=startup-warning],[class*=error]')].map(e=>e.innerText.replace(/\\s+/g,' ').trim()).filter(Boolean); return JSON.stringify(t.slice(0,4));`, "[]");
    flow.record("E7 提交后的提示/错误条（含界面上原样抛给用户的系统错误串）", `${toast} · 对话框还开着=${modalStill}`);
    // 关键一步：强制书架重新拉一次列表——内存库里那本「添加成功」的书会不会出现在界面上
    await val(h, clickText(".nav-item", "卡片"));
    await wait(900);
    await val(h, clickText(".nav-item", "书架"));
    await wait(2200);
    const uiHasBook = await val(h, `return document.body.innerText.includes(${JSON.stringify(phantom)});`, false);
    const shelfCount = await val(h, `const m=document.body.innerText.match(/(\\d+)\\s*本/); return m?m[1]:'-';`, "-");
    flow.record("E7 强制刷新后的书架", `幽灵书在界面上=${uiHasBook} · 界面「N 本」=${shelfCount}`);
    // ② 桥层返回值：假成功？
    const viaBridge = await val(
      h,
      `try{ const r=await window.cardsAPI.create({noteText:'E7 只读期幽灵卡',cardType:'qa',frontMarkdown:'只读期造卡会怎样？',backMarkdown:'未知',priority:50,tags:[]}); return 'resolved:'+JSON.stringify(r).slice(0,70); }catch(e){ return 'rejected:'+String(e.message||e).slice(0,90); }`,
      "eval-fail"
    );
    const viaList = await val(h, `try{ const l=await window.libraryAPI.list(); return 'ok:'+l.length; }catch(e){ return 'rejected:'+String(e.message||e).slice(0,70); }`, "eval-fail");
    const backupRes = await val(h, `try{ return JSON.stringify(await window.backupAPI.create({})).slice(0,200); }catch(e){ return 'rejected:'+String(e.message||e).slice(0,80); }`, "eval-fail");
    const settingRes = await val(h, `try{ await window.settingsAPI.set('app','accentColor','#0f0f0f'); return 'set-ok'; }catch(e){ return 'rejected:'+String(e.message||e).slice(0,80); }`, "eval-fail");
    flow.record("E7 桥层返回（假成功判据的输入）", `UI幽灵书=${uiHasBook} · cards.create=${viaBridge} · library.list=${viaList} · backup=${backupRes} · settings=${settingRes}`);
    const e = reportEvents(h, "E7 只读期");
    flow.record("E7 只读期的 console 错误", e.errors.slice(0, 4).map((x) => x.text.slice(0, 110)).join(" | ") || "无");
    const st2 = statOf(dbf);
    const sha2 = sha1(dbf);
    const disk2 = await diskCounts(dir);
    snap.disk2 = disk2;
    snap.sha2 = sha2;
    flow.record("E7 只读期写后盘上", `sha ${sha0} → ${sha2} · dbBytes ${disk0.dbBytes} → ${disk2.dbBytes} · items ${disk0.items} → ${disk2.items} · cards ${disk0.cards} → ${disk2.cards} · ${JSON.stringify(st2)}`);
    const tmps = [];
    try {
      for (const n of fs.readdirSync(dir)) if (/\.tmp$/i.test(n)) tmps.push({ name: n, ...statOf(path.join(dir, n)) });
    } catch {
      /* ignore */
    }
    snap.tmps = tmps;
    flow.record("E7 .tmp 残留", JSON.stringify(tmps));
    const uiCount = await val(h, `try{ return (await window.libraryAPI.list()).length; }catch(e){ return -1; }`, -1);
    snap.uiCount = uiCount;
    flow.check("E7 只读库时应用仍能起来（没弹主进程崩溃框、界面可用）", p.bodyLen > 60 && p.nav.length >= 6, ">60 字符 + 6 入口", `len=${p.bodyLen} nav=${p.nav.length}`);
    flow.check(`E7 无假成功：写盘没成功时，界面/桥不得报成功（UI 幽灵书=${uiHasBook}，盘上 items=${disk2.items}，UI list=${uiCount}）`, !(String(viaBridge).startsWith("resolved:") && Number(disk2.cards) <= Number(disk0.cards)) && !(uiHasBook === true && Number(disk2.items) <= Number(disk0.items)), "报了成功就必须盘上有", JSON.stringify({ viaBridge: String(viaBridge).slice(0, 50), uiHasBook, uiCount, diskBefore: disk0.items + "/" + disk0.cards, diskAfter: disk2.items + "/" + disk2.cards, shaChanged: sha0 !== sha2 }));
    flow.check("E7 界面看到的书数 == 盘上的书数（无幻影数据）", Number(uiCount) === Number(disk2.items), `盘上=${disk2.items}`, `界面=${uiCount}`);
    flow.record("E7 截图路径（只读库时的界面，看有没有降级提示）", await h.shot("f46-e7"));
    return { uiHasBook, modalStill, toast };
  });
  // 第三次启动：.tmp 残留会不会被静默采纳
  const third = await withApp({ caseName: "e7-r3", fresh: false, userData: dir }, async (h) => {
    await checkUsable(h, "E7 重启后");
    const seen = await val(h, `return document.body.innerText.includes(${JSON.stringify(phantom)});`, false);
    const uiN = await val(h, `try{ return (await window.libraryAPI.list()).length; }catch(e){ return -1; }`, -1);
    const d3 = await diskCounts(dir);
    let tmpNow = [];
    try {
      tmpNow = fs.readdirSync(dir).filter((n) => /\.tmp$/i.test(n));
    } catch {
      /* ignore */
    }
    flow.record("E7 第三次启动：盘上事实", `items=${d3.items} cards=${d3.cards} sha=${d3.sha}（只读期结束时 items=${snap.disk2 && snap.disk2.items} cards=${snap.disk2 && snap.disk2.cards} sha=${snap.sha2}）· 幽灵书在界面=${seen} · UI list=${uiN}（只读期 UI=${snap.uiCount}）`);
    flow.record("E7 第三次启动时的 .tmp 文件", `启动前=${JSON.stringify(snap.tmps || [])} → 启动后=${JSON.stringify(tmpNow)}（electron/db.js:210 明示「tmp 永远不是事实源」，启动即删）`);
    flow.eq("E7 只读期没落盘的数据重启后确实不在盘上（没被 .tmp 采纳回来）", [Number(d3.items), Number(d3.cards)], [Number(disk0.items), Number(disk0.cards)]);
    flow.check("E7 幽灵数据不复活（第三次启动界面里看不到只读期「报成功」的书）", seen === false && Number(uiN) === Number(d3.items), "界面不含幽灵书且 UI 数==盘上数", JSON.stringify({ seen, uiN, disk: [d3.items, d3.cards] }));
    return true;
  });
  if (!third) flow.check("E7 只读期结束后第三次启动能起来", false, "起得来", "两次尝试都没连上 CDP");
  try {
    spawnSync("cmd.exe", ["/c", "attrib", "-R", dbf], { encoding: "utf8" });
    fs.chmodSync(dbf, 0o644);
  } catch {
    /* ignore */
  }
  flow.record("E7 已解除只读（临时目录，不影响仓库）", sha1(dbf));
}

/** E8 没有 dist 的干净机器 */
async function caseE8() {
  flow.section("E8 无 dist 的干净机器（「别人直接把文件夹拷走」的场景）");
  const appDir = path.join(SCRATCH, "e8-clean-machine");
  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(path.join(appDir, "electron"), { recursive: true });
  let copied = [];
  try {
    copied = fs.readdirSync(path.join(ROOT, "electron"));
  } catch {
    copied = [];
  }
  for (const f of copied) {
    try {
      fs.copyFileSync(path.join(ROOT, "electron", f), path.join(appDir, "electron", f));
    } catch {
      /* ignore */
    }
  }
  for (const f of ["package.json", "capture.html"]) {
    try {
      fs.copyFileSync(path.join(ROOT, f), path.join(appDir, f));
    } catch {
      /* ignore */
    }
  }
  const jn = mkJunction(path.join(appDir, "node_modules"), path.join(ROOT, "node_modules"));
  const jp = mkJunction(path.join(appDir, "public"), path.join(ROOT, "public"));
  flow.record("E8 干净机器目录搭好", `${appDir} · electron 文件 ${copied.length} 个 · node_modules 联接=${jn.ok} · public 联接=${jp.ok} · dist 存在=${fs.existsSync(path.join(appDir, "dist"))}`);
  flow.check("E8 前置：模拟目录里确实没有 dist/", !fs.existsSync(path.join(appDir, "dist")), "dist 不存在", String(fs.existsSync(path.join(appDir, "dist"))));
  let dev5173 = "探测失败";
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 1500);
    const r = await fetch("http://localhost:5173", { signal: ac.signal });
    clearTimeout(t);
    dev5173 = `有服务在跑 HTTP ${r.status}（会污染 E8：无 dist 时会退回它）`;
  } catch (e) {
    dev5173 = "无人监听（干净机器真实情形）";
  }
  flow.record("E8 本机 5173 端口现状", dev5173);
  await withApp({ caseName: "e8", fresh: true, userData: path.join(SCRATCH, "ud-e8"), appPath: appDir, cwd: appDir, preferIndex: false }, async (h) => {
    flow.record("E8 首个可用页面目标出现在", `${h.upMs}ms · url=${String(h.attachedUrl).slice(0, 110)}`);
    const p0 = await probeUi(h);
    flow.record("E8 立刻观察（用户第一眼）", `url=${String(p0.url).slice(0, 90)} bodyLen=${p0.bodyLen} title=${p0.title} head="${String(p0.head).slice(0, 70)}"`);
    await wait(6000);
    const p1 = await probeUi(h);
    flow.record("E8 6 秒后", `url=${String(p1.url).slice(0, 90)} bodyLen=${p1.bodyLen} nav=${p1.nav.length} head="${String(p1.head).slice(0, 70)}"`);
    await wait(10000);
    const p2 = await probeUi(h);
    const targets = await h.listTargets().catch(() => []);
    flow.record("E8 16 秒后（等待 dev-server 重试的结果）", `url=${String(p2.url).slice(0, 90)} bodyLen=${p2.bodyLen} nav=${p2.nav.length} 目标数=${targets.length} 头="${String(p2.head).slice(0, 60)}"`);
    const errPage = await val(
      h,
      `const t=(document.body&&document.body.innerText||'').replace(/\\s+/g,' ');
       return JSON.stringify({isChromiumError:/ERR_CONNECTION_REFUSED|ERR_FILE_NOT_FOUND|无法访问|This site can’t be reached|找不到网页|File not found|ERR_INVALID_HANDLE/i.test(t),
       errCode:(t.match(/ERR_[A-Z_]+/)||[])[0]||'',
       hasProductHint:/未构建|请先|npm run build|没有 dist|加载失败|初始化/i.test(t),
       bridge:{library:typeof window.libraryAPI}, text:t.slice(0,260)});`,
      "{}"
    );
    flow.record("E8 用户看到的那一页（判据输入）", String(errPage));
    let ej = {};
    try {
      ej = JSON.parse(String(errPage || "{}"));
    } catch {
      /* ignore */
    }
    const usable = p2.bodyLen > 60 && p2.nav.length >= 6;
    flow.check("E8 无 dist 的干净机器上用户能看到可用界面", usable, true, `可用=${usable} · bodyLen=${p2.bodyLen} · nav=${p2.nav.length} · Chromium错误页=${ej.isChromiumError} · 错误码=${ej.errCode}`);
    flow.check("E8 界面上有产品自己的降级提示（告诉用户该做什么）", ej.hasProductHint === true, true, `提示=${ej.hasProductHint} · 文本="${String(ej.text).slice(0, 90)}"`);
    flow.record("E8 从 spawn 到能附着 CDP 用时", `${h.upMs}ms；到 16 秒仍未变为可用界面（若如此）`);
    flow.record("E8 截图路径（干净机器的第一眼）", await h.shot("f46-e8"));
    flow.record("E8 应用日志尾", tail(h.logFile, 400));
  });
}

// ============================ 编排 ============================
const CASES = [
  ["e1", caseE1],
  ["e2", caseE2],
  ["e3", caseE3],
  ["e4a", () => runE4("e4a", "America/Sao_Paulo", "2019 年后无夏令时，UTC-3")],
  ["e4b", () => runE4("e4b", "Pacific/Kiritimati", "UTC+14，比本机早 6 小时")],
  ["e5", caseE5],
  ["e6a", () => caseE6("e6a", "CJK + 空格（模拟 C:\\Users\\张三 李四\\增量阅读数据\\v1）", () => path.join(scratchDir("e6a"), "张三 李四", "增量阅读数据", "v1"))],
  ["e6b", () => caseE6("e6b", "目录名以点结尾（Win32 会剥掉尾点）", () => path.join(scratchDir("e6b"), "增量阅读数据 v1."))],
  ["e6c", async () => {
    // 目标：library.db 的完整路径**精确** 258 字符（>240 且刚好不超过 260 的 MAX_PATH 线）。
    // 为什么要钉死长度：第一版用「循环加到 246 为止」，结果临时目录名里的 PID 位数一变，
    // 整条路径就跨过 260 —— 同一份代码两次跑结论相反（实测一次 3.9s 退出、一次正常起来）。
    // 现在按剩余长度补 ASCII 段，长度与 PID 位数无关。
    const b = scratchDir(path.join("e6c", "增量阅读数据"));
    let p = b;
    for (let i = 0; i < 12; i++) p = path.join(p, "深度目录段");
    const targetDb = 258;
    const need = targetDb - "\\library.db".length - p.length;
    if (need > 2) p = path.join(p, "p".repeat(need - 1));
    fs.mkdirSync(p, { recursive: true });
    flow.record("e6c 长度核算", `userData=${p.length} · library.db=${path.join(p, "library.db").length}（目标 ${targetDb}）`);
    await caseE6("e6c", `路径被推过 240 字符（library.db 实测 ${path.join(p, "library.db").length} 字符，卡在 MAX_PATH 之下）`, () => p);
    // 再往上一档：把 library.db 推到 270 字符（跨过 260 线）。这不是新缺陷，是给 F39 登记的
    // 「>260 应用静默退出」补一条**真实应用侧**读数（退出码 + 日志里 CreateFile 失败原文）。
    let q = b;
    for (let i = 0; i < 12; i++) q = path.join(q, "深度目录段");
    const need2 = 270 - "\\library.db".length - q.length;
    if (need2 > 2) q = path.join(q, "q".repeat(need2 - 1));
    fs.mkdirSync(q, { recursive: true });
    flow.record("e6c+ 超线档长度", `userData=${q.length} · library.db=${path.join(q, "library.db").length}（>260）`);
    const over = await launchCase({ caseName: "e6c-over260", fresh: true, userData: q, connectTimeoutMs: 30_000 });
    if (over.skip) {
      flow.record("e6c+ 超线档无法起进程", over.reason);
    } else if (over.skippedByExit || over.timeout) {
      flow.record("e6c+ 超 260 时应用的行为", `${over.reason} · 退出码=${over.code === undefined ? "（未退出）" : over.code} · 用时 ${over.upMs}ms · 日志尾: ${tail(over.logFile, 420)}`);
      if (over.child) await stop(over);
    } else {
      const usable = await waitFor(over, `document.querySelectorAll('.nav-item').length>=6`, { timeout: 12000 });
      flow.record("e6c+ 超 260 时应用的行为", `起来了（六入口=${usable.ok}）· 用时 ${over.upMs}ms · 日志尾: ${tail(over.logFile, 300)}`);
      await stop(over);
    }
  }],
  ["e6d", async () => {
    // 联接 userData + 应用路径也走一条含 CJK/空格的联接（联接只读地指向仓库，写入全部进临时 userData）
    const target = scratchDir("e6d-target");
    const link = path.join(SCRATCH, "e6d 安装 目录");
    const j = mkJunction(link, target);
    const appLink = path.join(SCRATCH, "e6d 应用 目录");
    const ja = mkJunction(appLink, ROOT);
    flow.record("e6d 两条联接", `userData 侧=${JSON.stringify(j)} · appPath 侧=${JSON.stringify(ja)} · 仓库 dist 未被触碰=${fs.existsSync(path.join(ROOT, "dist", "index.html"))}`);
    await caseE6("e6d", "目录联接（userData 在联接之后 + 应用路径经含 CJK/空格的联接）", () => path.join(link, "增量阅读数据", "v1"), ja.ok ? { appPath: appLink } : {});
  }],
  ["e7", caseE7],
  ["e8", caseE8],
];

runFlow(flow, async () => {
  fs.mkdirSync(SCRATCH, { recursive: true });
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  flow.record("本流程沙箱根（临时目录）", SCRATCH);
  flow.record("分发事实（不重推导，只记结论）", "package.json 无 build/electron-builder/forge 配置 → 今天的「分发」＝ git clone + npm install + npm run build + npx electron .");
  flow.record("加载顺序（electron/main.js:1265-1272）", "dist/index.html 在 → loadFile；不在 → loadURL(http://localhost:5173) 失败后再 loadFile 同一不存在的文件；无用户可见错误页");

  for (const [id, fn] of CASES) {
    if (ONLY.length && !ONLY.includes(id)) continue;
    const t0 = Date.now();
    try {
      await fn();
    } catch (e) {
      flow.record(`${id} 案例内部异常（不阻断后面的案例）`, String(e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e).slice(0, 260));
    }
    flow.record(`${id} 案例耗时`, `${Math.round((Date.now() - t0) / 1000)}s · 累计 ${Math.round((Date.now() - flow.startedAt) / 1000)}s`);
  }
  dropJunctions();
}).then((s) => {
  dropJunctions();
  try {
    fs.rmSync(SCRATCH, { recursive: true, force: true });
  } catch {
    /* Windows 句柄未释放：留在临时目录，不动仓库 */
  }
  process.exit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length ? 1 : 0);
});
