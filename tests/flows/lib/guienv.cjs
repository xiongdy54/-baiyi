// GUI 流程环境：CDP 驱动真实应用，但**只碰自己起的进程**。
// 既有 harness 一律 `taskkill /IM electron.exe /F`（杀掉机器上所有 Electron）——
// 用户把工作区当成品在用，长跑里绝不能顺手关掉他正开着的阅读会话（§7.1.8 的同源纪律）。
// 因此本模块：独立 userData + 独立端口 + 只 kill 自己 spawn 的 PID + 端口被占即判定冲突跳过。
// @runtime: shared
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { ROOT, tmpUserDataDir, freshDir } = require("./harness.cjs");

const ELECTRON = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");

function newestMtime(dir) {
  let m = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let names = [];
    try {
      names = fs.readdirSync(d);
    } catch {
      continue;
    }
    for (const n of names) {
      if (["node_modules", ".git", "dist", "build", "tests", "docs", "design-samples"].includes(n)) continue;
      const full = path.join(d, n);
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) stack.push(full);
      else if (/\.(ts|tsx|css)$/.test(n)) m = Math.max(m, st.mtimeMs);
    }
  }
  return m;
}

function distFreshness() {
  const idx = path.join(ROOT, "dist", "index.html");
  if (!fs.existsSync(idx)) return { exists: false };
  const distM = Math.max(...fs.readdirSync(path.join(ROOT, "dist", "assets")).map((f) => fs.statSync(path.join(ROOT, "dist", "assets", f)).mtimeMs));
  const srcM = newestMtime(path.join(ROOT, "src"));
  return { exists: true, distM, srcM, staleMs: Math.max(0, srcM - distM) };
}

async function portFree(port) {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 1200);
    await fetch(`http://127.0.0.1:${port}/json/version`, { signal: ac.signal });
    clearTimeout(t);
    return false;
  } catch {
    return true;
  }
}

/** 起一个隔离的真实应用实例；冲突时返回 {skip:true}，绝不杀别人的进程 */
async function launch({ label = "gui", port = 9620, fresh = true, logName = null } = {}) {
  let chosen = null;
  for (let p = port; p < port + 12; p++) {
    if (await portFree(p)) {
      chosen = p;
      break;
    }
  }
  if (!chosen) return { skip: true, reason: `端口 ${port}–${port + 11} 全部占用（可能有另一个自动化会话在跑），跳过` };
  port = chosen;
  if (!fs.existsSync(ELECTRON)) return { skip: true, reason: `未找到 ${ELECTRON}` };
  const dir = fresh ? freshDir(tmpUserDataDir(label)) : tmpUserDataDir(label);
  fs.mkdirSync(dir, { recursive: true });
  const logFile = logName || path.join(ROOT, "tests", "flows", "results", `${label}.app.log`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const fd = fs.openSync(logFile, "a");
  const child = spawn(ELECTRON, [".", `--remote-debugging-port=${port}`], {
    cwd: ROOT,
    stdio: ["ignore", fd, fd],
    env: { ...process.env, M7_TEST_USERDATA: dir },
  });
  const conn = await connect(port, child);
  return { dir, child, port, ...conn };
}

async function connect(port, child, timeoutMs = 90_000, pickLast = false) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      return { skippedByExit: true, code: child.exitCode, reason: `应用进程提前退出（code=${child.exitCode}）——单实例锁或启动失败` };
    }
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const pages = list.filter((t) => t.type === "page" && /index\.html|capture\.html/.test(t.url || ""));
      const page = pickLast ? pages[pages.length - 1] : pages.find((t) => /index\.html/.test(t.url || ""));
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
            ws.send(JSON.stringify({ id: mid, method, params }));
          });
        const evaluate = async (expr) => {
          const r = await send("Runtime.evaluate", { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true });
          if (r.result && r.result.exceptionDetails) return { error: String(r.result.exceptionDetails.exception?.description || "").slice(0, 300) };
          return { value: r.result?.result?.value };
        };
        await send("Page.enable");
        await send("Runtime.enable");
        return {
          ws,
          send,
          evaluate,
          shot: async (name) => {
            const s = await send("Page.captureScreenshot", { format: "png" });
            const out = path.join(ROOT, "tests", "flows", "results", `${name}.png`);
            fs.writeFileSync(out, Buffer.from(s.result.data, "base64"));
            return out;
          },
          listTargets: async () => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === "page"),
        };
      }
    } catch {
      /* 端口未就绪 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { timeout: true, reason: `90 秒内连不上 CDP（端口 ${port}）` };
}

/** 只结束自己起的进程树（taskkill /T /F 按 PID，绝不按映像名批量杀） */
async function shutdown(handle) {
  if (!handle || !handle.child) return;
  try {
    handle.ws && handle.ws.close();
  } catch {
    /* ignore */
  }
  const pid = handle.child.pid;
  try {
    handle.child.kill();
  } catch {
    /* ignore */
  }
  await new Promise((res) => {
    const t0 = Date.now();
    const tick = () => {
      if (handle.child.exitCode !== null || Date.now() - t0 > 4000) return res();
      setTimeout(tick, 200);
    };
    tick();
  });
  if (pid) {
    try {
      require("child_process").execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    } catch {
      /* 已经退干净了 */
    }
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 在页面里按文本点元素；返回是否命中 */
const clickText = (sel, text) =>
  `const el=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>(x.textContent||'').includes(${JSON.stringify(text)})&&!x.disabled); if(el){el.click(); return true;} return false;`;
const hasText = (text) => `document.body.innerText.includes(${JSON.stringify(text)})`;
const countOf = (sel) => `document.querySelectorAll(${JSON.stringify(sel)}).length`;

module.exports = { launch, connect, shutdown, wait, clickText, hasText, countOf, distFreshness, ELECTRON, portFree };
