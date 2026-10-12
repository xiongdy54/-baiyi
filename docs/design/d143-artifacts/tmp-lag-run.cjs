// [DIAG-TEMP 测量件，非产品代码] 启动卡顿诊断：宿主驱动（起隔离实例 → CDP 注入页内探针 → 定时真实点击 → 收数据）
// 运行：
//   node tests/tmp-lag-run.cjs empty 120
//   node tests/tmp-lag-run.cjs same-day 120
//   node tests/tmp-lag-run.cjs first-of-day 300
// 约定：只碰自己起的进程（taskkill /PID），userData 一律 M7_TEST_USERDATA 隔离目录；绝不读写真实库。
"use strict";
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ELECTRON = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const REAL_UD = path.join(process.env.APPDATA || "", "incremental-reading-dev");
const LAG_DIR = path.join(ROOT, "tests", "tmp-lag");

const scenario = process.argv[2] || "empty";
const seconds = Number(process.argv[3] || 120);

const sleep = (m) => new Promise((r) => setTimeout(r, m));
const epoch = () => Date.now();
const dayTag = () => {
  const t = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
};

/* ---------------- 数据准备 ---------------- */
function rmrf(p) {
  for (let i = 0; i < 5; i++) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
      return;
    } catch (e) {
      if (i === 4) throw e;
      execFileSync("cmd", ["/c", "timeout", "/t", "1", "/nobreak"], { stdio: "ignore" });
    }
  }
}
function prepareEmpty(dir) {
  rmrf(dir);
  fs.mkdirSync(dir, { recursive: true });
}
function copyRealData(dir) {
  // 一次性：真实 userData → 隔离副本（只读原件；大文件 copyFileSync，目录 cpSync）
  const files = ["library.db", "learner.db", "settings.json", "ai-config.json", "dictionary.db"];
  for (const f of files) {
    const src = path.join(REAL_UD, f);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(dir, f));
  }
  for (const d of ["memory", "assets", "dicts"]) {
    const src = path.join(REAL_UD, d);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(dir, d), { recursive: true });
  }
}

async function main() {
  if (!fs.existsSync(ELECTRON)) {
    console.error(`BLOQUE: 未找到 ${ELECTRON}`);
    process.exit(2);
  }
  // 前置自检 1：dist/index.html
  const distIndex = path.join(ROOT, "dist", "index.html");
  const distOk = fs.existsSync(distIndex);
  console.log(`[host] dist/index.html exists=${distOk} mtime=${distOk ? fs.statSync(distIndex).mtime.toISOString() : "-"}`);
  // 前置自检 2：无其它 electron 实例
  try {
    const tl = execFileSync("tasklist", ["/FI", "IMAGENAME eq electron.exe", "/NH"], { encoding: "utf8" });
    const has = /electron\.exe/i.test(tl);
    console.log(`[host] 其它 electron 实例: ${has ? "存在(冲突!)" : "无"}`);
    if (has) process.exit(3);
  } catch { /* tasklist 失败也继续 */ }

  const userData = path.join(LAG_DIR, scenario === "empty" ? "empty-userdata" : "realdata-userdata");
  fs.mkdirSync(LAG_DIR, { recursive: true });
  if (scenario === "empty") {
    prepareEmpty(userData);
  } else {
    if (!fs.existsSync(path.join(userData, "library.db"))) {
      console.log(`[host] 首次准备真实数据副本（约 1.5GB，耐心）→ ${userData}`);
      fs.mkdirSync(userData, { recursive: true });
      const t = epoch();
      copyRealData(userData);
      console.log(`[host] 副本完成 ${epoch() - t}ms`);
    }
    // same-day：占位今日 auto 备份（存在即跳过，复现用户 10-12 13:14 会话）；first-of-day：确保不存在
    const marker = path.join(userData, "backups", `backup-auto-${dayTag()}.zip`);
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    if (scenario === "same-day") {
      if (!fs.existsSync(marker)) fs.writeFileSync(marker, "");
      console.log(`[host] same-day 占位: ${path.basename(marker)} (存在=${fs.existsSync(marker)})`);
    } else {
      if (fs.existsSync(marker)) fs.rmSync(marker, { force: true });
      console.log(`[host] first-of-day: 今日 auto 备份不存在 → autoBackupIfNeeded 将真实执行`);
    }
  }

  /* ---------------- 起应用 ---------------- */
  const port = 9710 + (scenario === "empty" ? 0 : scenario === "same-day" ? 1 : 2);
  const PORT_INSPECT = port + 100;
  const appLog = path.join(LAG_DIR, `${scenario}.app.log`);
  fs.writeFileSync(appLog, `[host] spawn epoch=${epoch()} scenario=${scenario} userData=${userData} port=${port}\n`);
  const fd = fs.openSync(appLog, "a");
  const env = {
    ...process.env,
    M7_TEST_USERDATA: userData,
    NODE_OPTIONS: `--require "${path.join(ROOT, "tests", "tmp-lag-instrument.cjs").replace(/\\/g, "/")}"`
  };
  const child = spawn(ELECTRON, [".", `--remote-debugging-port=${port}`, `--inspect=${PORT_INSPECT}`], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  const T0 = epoch();
  let pipeBuf = "";
  const onData = (stream, tag) => {
    stream.on("data", (d) => {
      const s = d.toString();
      pipeBuf += s;
      let i;
      while ((i = pipeBuf.indexOf("\n")) >= 0) {
        const line = pipeBuf.slice(0, i).replace(/\r$/, "");
        pipeBuf = pipeBuf.slice(i + 1);
        if (line.trim()) fs.appendFileSync(fd, `${tag} ${line}\n`);
      }
    });
  };
  onData(child.stdout, "OUT");
  onData(child.stderr, "ERR");
  console.log(`[host] spawn pid=${child.pid} epoch=${T0}`);

  /* ---------------- 主进程 inspector：CPU 采样（归因用） ---------------- */
  let cpuClient = null;
  {
    const deadlineI = T0 + 30000;
    while (epoch() < deadlineI && !cpuClient) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT_INSPECT}/json/list`)).json();
        const t = Array.isArray(list) ? list[0] : null;
        if (t && t.webSocketDebuggerUrl) {
          const ws = new globalThis.WebSocket(t.webSocketDebuggerUrl);
          await new Promise((res, rej) => {
            ws.addEventListener("open", res, { once: true });
            ws.addEventListener("error", rej, { once: true });
            setTimeout(() => rej(new Error("inspector ws 超时")), 8000);
          });
          let id = 0;
          const pending = new Map();
          ws.addEventListener("message", (ev) => {
            const m = JSON.parse(ev.data);
            if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
          });
          const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
          await send("Profiler.enable");
          await send("Profiler.setSamplingInterval", { interval: 200 });
          const st = await send("Profiler.start");
          cpuClient = { ws, send, startedAt: epoch() };
          console.log(`[host] 主进程 CPU 采样已启动 @${epoch()} (+${epoch() - T0}ms) ${st.error ? JSON.stringify(st.error) : ""}`);
        }
      } catch { /* 未就绪 */ }
      if (!cpuClient) await sleep(120);
    }
    if (!cpuClient) console.log("[host] 主进程 CPU 采样启动失败（--inspect 未连上）");
  }

  /* ---------------- CDP 连接 + 页内探针注入 ---------------- */
  const MONITOR = `
(() => {
  if (window.__LAG) return "already";
  const L = window.__LAG = { anchor: { epoch: Date.now(), perf: performance.now() }, ipc: [], raf: [], lt: [], clicks: [], ready: {} };
  try {
    const nt = performance.getEntriesByType("navigation")[0];
    if (nt) L.nav = { startTime: nt.startTime, domInteractive: nt.domInteractive, dcl: nt.domContentLoadedEventEnd, load: nt.loadEventEnd, dur: nt.duration };
    const fcp = performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint");
    L.fcp = fcp ? { at: Math.round(fcp.startTime + performance.timeOrigin), dur: Math.round(fcp.startTime) } : null;
    L.ready.atInject = { state: document.readyState, rootChildren: (document.getElementById("root") || {}).childElementCount || 0 };
  } catch (e) { L.err = String(e).slice(0, 120); }
  // rAF 心跳（>80ms 记）
  let last = performance.now();
  const tick = () => { const n = performance.now(); const gap = n - last; if (gap > 80) L.raf.push({ at: Date.now(), gap: Math.round(gap) }); last = n; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  // longtask
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) L.lt.push({ at: Math.round(e.startTime + performance.timeOrigin), dur: Math.round(e.duration) }); }).observe({ entryTypes: ["longtask"] }); } catch (e) { L.ltErr = String(e).slice(0, 60); }
  // IPC 往返探针（控制组：settings.get 为纯内存读，~1ms 级，不在主进程制造额外负载；
  // 上一版交替 library.list 每次 ~70ms、每 500ms 一次，自己把主进程打出 100ms+ 周期性空洞——已弃用）
  let n = 0;
  const ping = async () => {
    const ch = "settings.get";
    const t = Date.now();
    try {
      await window.settingsAPI.get("app", "skinId");
      L.ipc.push({ at: t, ch, dt: Date.now() - t });
    } catch (e) { L.ipc.push({ at: t, ch, dt: Date.now() - t, err: String(e).slice(0, 60) }); }
    if (!L.stopped) L.pingTimer = setTimeout(ping, 200);
  };
  ping();
  // 点击观测：等 .topbar-nav .nav-item.active 文本 === label
  L.navState = () => { const a = document.querySelector(".topbar-nav .nav-item.active"); return a ? a.textContent.trim() : null; };
  // 通用导航变化记录器（8ms 轮询；被阻塞时不运行，恢复后记录的时间戳仍是真实时刻）——
  // 点击探针只需在**点击前**把坐标缓存好，点击本身不再依赖任何 evaluate 往返
  L.navChanges = [];
  let lastNav = null;
  setInterval(() => {
    const s = L.navState();
    if (s !== lastNav) { lastNav = s; L.navChanges.push({ t: Date.now(), label: s }); }
  }, 8);
  L.watchStart = (label, sentEpoch) => {
    L.pending = { label, sent: sentEpoch, done: null, hostDone: null };
    const iv = setInterval(() => {
      if (L.pending && L.pending.label === label && L.pending.done === null && L.navState() === label) {
        L.pending.done = Date.now();
        L.clicks.push({ label, sent: L.pending.sent, done: L.pending.done, dt: L.pending.done - L.pending.sent });
        clearInterval(iv);
      }
    }, 8);
    setTimeout(() => clearInterval(iv), 30000);
    return true;
  };
  L.navBox = (label) => {
    const el = [...document.querySelectorAll(".topbar-nav .nav-item")].find((b) => b.textContent.trim() === label);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  };
  return "ok";
})()
`;

  let conn = null;
  const deadline = T0 + 90000;
  while (epoch() < deadline && !conn) {
    if (child.exitCode !== null) {
      console.log(`[host] app 提前退出 code=${child.exitCode}`);
      break;
    }
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
      if (page && page.webSocketDebuggerUrl) {
        const ws = new globalThis.WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener("open", res, { once: true });
          ws.addEventListener("error", rej, { once: true });
          setTimeout(() => rej(new Error("ws 握手超时")), 8000);
        });
        let id = 0;
        const pending = new Map();
        ws.addEventListener("message", (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        });
        const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
        const evaluate = async (expr) => {
          const r = await send("Runtime.evaluate", { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true });
          if (r.result && r.result.exceptionDetails) return { error: String(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text || "").slice(0, 200) };
          return { value: r.result?.result?.value };
        };
        conn = { ws, send, evaluate };
        console.log(`[host] CDP 已连接 @${epoch()} (+${epoch() - T0}ms)`);
      }    } catch { /* 端口未就绪 */ }
    if (!conn) await sleep(150);
  }
  if (!conn) {
    console.log("[host] CDP 连接失败");
  } else {
    // 关键：先 addScriptToEvaluateOnNewDocument（文档创建即注入，抗导航换上下文），再立即补一次；
    // 上一轮失败原因＝连接时页面还停在导航前的旧上下文，注入的 window.__LAG 随旧上下文销毁
    try {
      await conn.send("Page.enable");
      const add = await conn.send("Page.addScriptToEvaluateOnNewDocument", { source: `(${MONITOR});` });
      console.log(`[host] addScriptToEvaluateOnNewDocument: ${JSON.stringify(add.result || add)}`);
    } catch (e) {
      console.log(`[host] addScript 失败: ${e && e.message}`);
    }
    let live = false;
    for (let i = 0; i < 12 && !live; i++) {
      const r = await conn.evaluate(`if (!window.__LAG) { (${MONITOR}); } return window.__LAG ? "ok" : "missing";`);
      live = r.value === "ok";
      if (!live) await sleep(250);
    }
    // 前置到前台：排除「窗口被遮挡 → Chromium 后台节流 / Windows 定时器合并」对计时的影响
    try {
      await conn.send("Page.bringToFront");
      console.log("[host] Page.bringToFront 已发送（窗口置前，避免后台节流）");
    } catch (e) {
      console.log(`[host] bringToFront 失败: ${e && e.message}`);
    }
    const chk = await conn.evaluate(`return window.__LAG ? "probe-live since=" + (window.__LAG.anchor ? window.__LAG.anchor.epoch : "?") : "probe-missing";`);
    console.log(`[host] 页内探针: ${JSON.stringify(chk.value || chk.error)} (第1次尝试 ${live ? "成功" : "失败"})`);
  }

  /* ---------------- 点击计划（绝对偏移；按钮坐标在连接后立即缓存，点击路径零 evaluate） ---------------- */
  const NAV_BOXES = {};
  for (const label of ["卡片", "复习", "数据", "日记", "书架"]) {
    try {
      const b = await conn.evaluate(`return window.__LAG ? window.__LAG.navBox(${JSON.stringify(label)}) : null;`);
      if (b && b.value) NAV_BOXES[label] = b.value;
    } catch { /* 稍后重试 */ }
  }
  console.log(`[host] 导航坐标缓存: ${JSON.stringify(NAV_BOXES)}`);
  const PLAN = [
    [3500, "卡片"],
    [8200, "复习"],   // 已知主进程空洞窗口（+8s desktopCapturer）
    [20300, "数据"],  // learnerRefresh 定时器窗口（+20s）
    [45000, "日记"],
    [75000, "书架"]
  ];
  for (const [at, label] of PLAN) {
    const waitMs = T0 + at - epoch();
    if (waitMs > 0) await sleep(waitMs);
    if (!conn) continue;
    const since = epoch() - T0;
    try {
      let box = NAV_BOXES[label];
      if (!box) {
        const b = await conn.evaluate(`return window.__LAG ? window.__LAG.navBox(${JSON.stringify(label)}) : null;`);
        box = b && b.value;
        if (box) NAV_BOXES[label] = box;
      }
      if (!box) {
        console.log(`[host] +${since}ms 点击「${label}」跳过：无坐标`);
        continue;
      }
      // 关键：点击时刻 = 发送时刻（不 await 回执——主进程阻塞时回执要等解除，那是被测现象本身）
      const tSend = epoch();
      conn.ws.send(JSON.stringify({ id: 900000 + at, method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x: box.x, y: box.y, button: "left", buttons: 1, clickCount: 1 } }));
      conn.ws.send(JSON.stringify({ id: 900001 + at, method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", x: box.x, y: box.y, button: "left", buttons: 0, clickCount: 1 } }));
      // host 侧观察（同样会被阻塞拖慢，仅作对照）
      let hostDone = null;
      const hd = epoch() + 40000;
      while (epoch() < hd) {
        const s = await conn.evaluate(`return window.__LAG ? window.__LAG.navState() : null;`);
        if (s.value === label) { hostDone = epoch(); break; }
        await sleep(100);
      }
      const nc = await conn.evaluate(`return window.__LAG ? window.__LAG.navChanges.map((x) => ({ t: x.t, label: x.label })) : null;`);
      const hit = (nc.value || []).find((c) => c.label === label && c.t >= tSend);
      const dt = hit ? hit.t - tSend : null;
      const hostDt = hostDone ? hostDone - tSend : null;
      console.log(`[host] +${since}ms 点击「${label}」→ 版式切换延迟 页内=${dt === null ? "超时(>40s)" : dt + "ms"} host=${hostDt === null ? "超时" : hostDt + "ms"}`);
      if (hit) { conn.lastClick = { label, tSend, tReact: hit.t, dt }; }
    } catch (e) {
      console.log(`[host] +${since}ms 点击「${label}」异常: ${e && e.message}`);
    }
  }

  /* ---------------- 观察窗口收尾 ---------------- */
  const restMs = T0 + seconds * 1000 - epoch();
  if (restMs > 0) await sleep(restMs);
  console.log(`[host] 观察窗口结束 @+${epoch() - T0}ms`);

  let data = null;
  if (conn) {
    try {
      const r = await conn.evaluate(`window.__LAG && (window.__LAG.stopped = true); return window.__LAG ? { anchor: window.__LAG.anchor, nav: window.__LAG.nav, fcp: window.__LAG.fcp, ready: window.__LAG.ready, ipc: window.__LAG.ipc, raf: window.__LAG.raf, lt: window.__LAG.lt, clicks: window.__LAG.clicks, navChanges: window.__LAG.navChanges } : null;`);
      data = r.value || null;
    } catch (e) {
      console.log(`[host] 数据回收失败: ${e && e.message}`);
    }
  }
  const jsonPath = path.join(LAG_DIR, `${scenario}.page.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({ scenario, T0, seconds, port, userData, data }, null, 1));
  console.log(`[host] 页内数据 → ${jsonPath}`);

  if (cpuClient) {
    try {
      const st = await cpuClient.send("Profiler.stop");
      const prof = st.result && st.result.profile;
      if (prof) {
        const p = path.join(LAG_DIR, `${scenario}.cpuprofile`);
        fs.writeFileSync(p, JSON.stringify(prof));
        fs.writeFileSync(path.join(LAG_DIR, `${scenario}.profile.meta.json`), JSON.stringify({ T0, profilerStartedAtEpoch: cpuClient.startedAt, profilerStoppedAtEpoch: epoch() }));
        console.log(`[host] 主进程 CPU 画像 → ${p} (samples=${(prof.samples || []).length})`);
      } else {
        console.log(`[host] Profiler.stop 无 profile: ${JSON.stringify(st).slice(0, 200)}`);
      }
      cpuClient.ws.close();
    } catch (e) {
      console.log(`[host] Profiler.stop 失败: ${e && e.message}`);
    }
  }

  /* ---------------- 收尾：只杀自己的进程树 ---------------- */
  try { conn && conn.ws.close(); } catch { /* ignore */ }
  try { child.kill(); } catch { /* ignore */ }
  await sleep(300);
  try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* 已退 */ }
  fs.closeSync(fd);
  let leftover = true;
  for (let i = 0; i < 10 && leftover; i++) {
    await sleep(500);
    try {
      const tl = execFileSync("tasklist", ["/FI", "IMAGENAME eq electron.exe", "/NH"], { encoding: "utf8" });
      leftover = /electron\.exe/i.test(tl);
    } catch {
      leftover = false;
    }
  }
  console.log(`[host] 收尾后 electron 实例: ${leftover ? "仍存在(检查!)" : "无"}`);
  console.log(`[host] app 日志 → ${appLog}`);
}

main().catch((e) => {
  console.error("[host] FATAL", e);
  process.exit(1);
});
