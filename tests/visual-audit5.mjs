// 视觉核查 v5 —— 把「目录面板遮挡正文」钉成数字
// 证据链：v4 的 53-阅读器-目录关闭.png 正文完整；v2 的 35-阅读器B-散文开头.png 同一本书
//   目录打开时只剩「书法的基础，笔笔送到则骨力洞达。」——行首「中锋用笔是」不见了。
//   本脚本用同一句话做锚点，量目录开/关时正文段落的实际左缘与被裁掉的字符数。
// 运行：node tests/visual-audit5.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9316";
const USER_DATA = path.join(ROOT, "tests", "tmp-visual5-userdata");
const SHOTS = path.join(ROOT, "tests", "tmp-visual5");
const MARK = "VIS5";
const SENT = "中锋用笔是书法的基础，笔笔送到则骨力洞达，这是第一句应当完整可见的长句测试文本。";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
fs.rmSync(USER_DATA, { recursive: true, force: true });
const NL = String.fromCharCode(10);
const asObj = (v) => { if (v && typeof v === "object") return v; try { return JSON.parse(String(v ?? "{}")); } catch { return { __raw: String(v).slice(0, 240) }; } };

async function connect(match, label, timeoutMs = 90000) {
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
        const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
        const ev = async (expr) => {
          const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) return "EXC:" + (r.exceptionDetails.exception?.description || "").slice(0, 200);
          return r.result?.result?.value;
        };
        await send("Runtime.enable"); await send("Page.enable");
        return { send, ev };
      }
    } catch { /* 未就绪 */ }
    await wait(1500);
  }
  throw new Error(`CDP 连接失败：${label}`);
}
const shot = async (p, n) => {
  const r = await p.send("Page.captureScreenshot", { format: "png" });
  if (r?.result?.data) fs.writeFileSync(path.join(SHOTS, `${n}.png`), Buffer.from(r.result.data, "base64"));
};

let electron = null;
try {
  const log = fs.openSync(path.join(ROOT, "tests", "visual5.app.log"), "a");
  electron = spawn("npx", ["electron", ".", `--remote-debugging-port=${PORT}`], {
    cwd: ROOT, shell: true, stdio: ["ignore", log, log], env: { ...process.env, M7_TEST_USERDATA: USER_DATA },
  });
  const main = await connect((u) => u.includes("index.html"), "主窗口");
  await wait(4500);
  const book = asObj(await main.ev(`(async()=>JSON.stringify(await window.libraryAPI.createFromPaste(${JSON.stringify(`${MARK} 书法十讲`)}, ${JSON.stringify([SENT, "", "# 第二讲 结构", "", "结构即结体，指点画之间的搭配与避让关系。"].join(NL))})))()`) || "{}");
  console.log(`建册=${!!book.id}`);
  await main.ev(`location.reload()`);
  await wait(5000);
  await main.ev(`(() => { const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.trim()==="书架"); b?.click(); return !!b; })()`);
  await wait(1500);
  await main.ev(`(() => { const c=[...document.querySelectorAll('.book-card')].find(x=>(x.title||x.textContent).includes(${JSON.stringify(MARK)})); c?.click(); return !!c; })()`);
  await wait(6000);

  // 锚定那句正文自己的矩形（不是外层 wrapper），并记录可见字符数
  const MEASURE = `(() => {
    const target = ${JSON.stringify(SENT)};
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n, hit = null;
    while ((n = walker.nextNode())) {
      const v = (n.nodeValue || "").trim();
      if (v && target.startsWith(v.slice(0, 8)) && v.length > 10) { hit = n; break; }
    }
    if (!hit) return JSON.stringify({ found: false, note: "未在同文档找到正文文本节点（foliate 可能用 shadow DOM）" });
    const rg = document.createRange(); rg.selectNodeContents(hit);
    const rects = [...Array(rg.getClientRects().length).keys()].map(i => rg.getClientRects()[i]);
    const r0 = rects[0] || rg.getBoundingClientRect();
    const toc = document.querySelector('[class*=toc]');
    const tr = toc ? toc.getBoundingClientRect() : null;
    const vw = innerWidth;
    // 被遮掉的字符数：按均宽估算（CJK 等宽），用矩形左缘与面板右缘之差换算
    const charW = r0.width / Math.max(1, hit.nodeValue.trim().length);
    const hiddenPx = tr ? Math.max(0, tr.right - r0.left) : 0;
    return JSON.stringify({
      found: true, text: hit.nodeValue.trim().slice(0, 12),
      paraLeft: Math.round(r0.left), paraRight: Math.round(r0.right), paraWidth: Math.round(r0.width),
      charW: Math.round(charW * 100) / 100,
      toc: tr ? { left: Math.round(tr.left), right: Math.round(tr.right) } : null,
      hiddenPx: Math.round(hiddenPx), hiddenChars: Math.round(hiddenPx / charW),
      clippedRight: Math.round(Math.max(0, r0.right - vw)),
      viewportW: vw,
    });
  })()`;

  const closed = asObj(await main.ev(MEASURE) || "{}");
  await shot(main, "60-目录关闭");
  console.log(`\n目录关闭: ${JSON.stringify(closed)}`);
  await main.ev(`(() => { const b=[...document.querySelectorAll('.reader-engine-controls button')].find(x=>x.textContent.includes("目录")); b?.click(); return !!b; })()`);
  await wait(1800);
  const opened = asObj(await main.ev(MEASURE) || "{}");
  await shot(main, "61-目录打开");
  console.log(`目录打开: ${JSON.stringify(opened)}`);

  if (closed.found && opened.found) {
    const moved = opened.paraLeft - closed.paraLeft;
    console.log(`\n>>> 正文段落左缘：关闭=${closed.paraLeft}px → 打开=${opened.paraLeft}px（位移 ${moved}px）`);
    if (opened.hiddenPx > 1) {
      console.log(`>>> 判读：目录面板右缘 ${opened.toc.right}px 覆盖正文 ${opened.hiddenPx}px ≈ ${opened.hiddenChars} 个汉字；正文未随面板回流。`);
    } else {
      console.log(`>>> 判读：正文未被面板覆盖（hiddenPx=${opened.hiddenPx}），面板打开时布局确有回流 —— v2 截图的裁切需另找原因。`);
    }
  }
  fs.writeFileSync(path.join(SHOTS, "clip.json"), JSON.stringify({ closed, opened }, null, 2));
  console.log(`截图目录: ${SHOTS}`);
} catch (e) {
  console.error("HARNESS ERROR:", e?.stack || e);
  process.exitCode = 2;
} finally {
  try { if (electron?.pid) spawn("taskkill", ["/PID", String(electron.pid), "/T", "/F"], { shell: true, stdio: "ignore" }); } catch { /* ignore */ }
}
