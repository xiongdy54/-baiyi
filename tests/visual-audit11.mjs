// 诊断：E-1 修复后 TOC 面板内**内容**是否还在（而不是只剩一层纸底）
// 上一张截图里 0–280 区域是空白纸面；本探针把 .reader-toc 的 innerText / 子节点数 /
// 各子元素 rect 全部读出来，区分「内容没渲染」与「内容被推出了可视区」。
// 运行：node tests/visual-audit11.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9323";
const USER_DATA = path.join(ROOT, "tests", "tmp-visual11-userdata");
const SHOTS = path.join(ROOT, "tests", "tmp-visual11");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
fs.rmSync(USER_DATA, { recursive: true, force: true });
const NL = String.fromCharCode(10);
const asObj = (v) => { if (v && typeof v === "object") return v; try { return JSON.parse(String(v ?? "{}")); } catch { return { __raw: String(v).slice(0, 200) }; } };

async function connect(match, timeoutMs = 90000) {
  const list = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const t = (await list()).find((x) => match(x.url || ""));
      if (t) {
        const ws = new globalThis.WebSocket(t.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
        let id = 0; const pending = new Map();
        ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
        const send = (m, p = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method: m, params: p })); });
        const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result?.result?.value; };
        await send("Runtime.enable"); await send("Page.enable");
        return { send, ev };
      }
    } catch { /* 未就绪 */ }
    await wait(1500);
  }
  throw new Error("CDP 连接失败");
}
const shot = async (p, n) => { const r = await p.send("Page.captureScreenshot", { format: "png" }); if (r?.result?.data) fs.writeFileSync(path.join(SHOTS, `${n}.png`), Buffer.from(r.result.data, "base64")); };

let electron = null;
try {
  const log = fs.openSync(path.join(ROOT, "tests", "visual11.app.log"), "a");
  electron = spawn("npx", ["electron", ".", `--remote-debugging-port=${PORT}`], { cwd: ROOT, shell: true, stdio: ["ignore", log, log], env: { ...process.env, M7_TEST_USERDATA: USER_DATA } });
  const main = await connect((u) => u.includes("index.html"));
  await wait(4500);
  await main.ev(`(async()=>JSON.stringify(await window.libraryAPI.createFromPaste("VIS11 书法十讲", ${JSON.stringify("中锋用笔是书法的基础，笔笔送到则骨力洞达。" + NL + NL + "# 第二讲 结构" + NL + NL + "结构即结体，指点画之间的搭配与避让关系。")})))()`);
  await main.ev(`location.reload()`); await wait(5000);
  await main.ev(`(()=>{const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.trim()==="书架");b?.click();return !!b})()`); await wait(1500);
  await main.ev(`(()=>{const c=[...document.querySelectorAll('.book-card')].find(x=>(x.title||x.textContent).includes("VIS11"));c?.click();return !!c})()`); await wait(6000);

  await main.ev(`(()=>{const b=[...document.querySelectorAll('.reader-engine-controls button')].find(x=>x.textContent.includes("目录"));b?.click();return !!b})()`);
  for (const w of [1000, 2000, 4000]) {
    await wait(w === 1000 ? 1000 : 1000);
    const info = asObj(await main.ev(`(() => {
      const toc = document.querySelector('.reader-toc');
      if (!toc) return JSON.stringify({ found: false });
      const cs = getComputedStyle(toc);
      const kids = [...toc.children].map((c) => { const b = c.getBoundingClientRect(); return { cls: String(c.className).slice(0, 30), left: Math.round(b.left), top: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), text: (c.innerText || "").replace(/\\s+/g, " ").slice(0, 40) }; });
      const b = toc.getBoundingClientRect();
      return JSON.stringify({
        found: true, navRect: { left: Math.round(b.left), top: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) },
        css: { left: cs.left, position: cs.position, overflow: cs.overflow, zIndex: cs.zIndex, visibility: cs.visibility, opacity: cs.opacity, transform: cs.transform },
        innerText: (toc.innerText || "").replace(/\\s+/g, " ").slice(0, 120),
        childCount: toc.children.length, kids,
      });
    })()`) || "{}");
    console.log(`\n[等待累计 ${w === 1000 ? 1 : w === 2000 ? 2 : 4}s] navRect=${JSON.stringify(info.navRect)} 子节点=${info.childCount}`);
    console.log(`  css=${JSON.stringify(info.css)}`);
    console.log(`  innerText=${JSON.stringify(info.innerText)}`);
    for (const k of (info.kids || [])) console.log(`    · ${k.cls} rect=${k.left},${k.top} ${k.w}x${k.h} text=${JSON.stringify(k.text)}`);
    if (w === 4000) await shot(main, "110-目录打开-4s");
  }
} catch (e) {
  console.error("HARNESS ERROR:", e?.stack || e);
  process.exitCode = 2;
} finally {
  try { if (electron?.pid) spawn("taskkill", ["/PID", String(electron.pid), "/T", "/F"], { shell: true, stdio: "ignore" }); } catch { /* ignore */ }
}
