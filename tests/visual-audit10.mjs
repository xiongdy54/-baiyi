// 侧栏让位验证（D2 起是**右侧停靠栏**，不是 E-1 时代的左浮层）：
// 判据：.reader-engine-main（正文区）的右缘 ≤ .reader-sidebar 的左缘；栏宽 280±1；
//       栏在其**自己的几何位置**上可被命中（未被 overflow:hidden 裁剪）。
// 命中点由栏矩形推导（不再写死 140px 那种属于左浮层的坐标）。同会话 A/B 截图留证（关 / 开）。
// 运行：node tests/visual-audit10.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9321";
const USER_DATA = path.join(ROOT, "tests", "tmp-visual10-userdata");
const SHOTS = path.join(ROOT, "tests", "tmp-visual10");
const MARK = "VIS10";
const SENT = "中锋用笔是书法的基础，笔笔送到则骨力洞达，这是第一句应当完整可见的长句测试文本。";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
fs.rmSync(USER_DATA, { recursive: true, force: true });
const NL = String.fromCharCode(10);
const asObj = (v) => { if (v && typeof v === "object") return v; try { return JSON.parse(String(v ?? "{}")); } catch { return { __raw: String(v).slice(0, 200) }; } };

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
let red = 0;
const t = (name, cond, detail) => { console.log(`  ${cond ? "✓" : "✗"} ${name}${cond ? "" : "   ← " + detail}`); if (!cond) red++; };

try {
  const log = fs.openSync(path.join(ROOT, "tests", "visual10.app.log"), "a");
  electron = spawn("npx", ["electron", ".", `--remote-debugging-port=${PORT}`], {
    cwd: ROOT, shell: true, stdio: ["ignore", log, log], env: { ...process.env, M7_TEST_USERDATA: USER_DATA },
  });
  const main = await connect((u) => u.includes("index.html"), "主窗口");
  await wait(4500);
  const bk = asObj(await main.ev(`(async()=>JSON.stringify(await window.libraryAPI.createFromPaste(${JSON.stringify(`${MARK} 书法十讲`)}, ${JSON.stringify([SENT, "", "# 第二讲 结构", "", "结构即结体，指点画之间的搭配与避让关系。"].join(NL))})))()`) || "{}");
  console.log(`建册=${!!bk.id}`);
  await main.ev(`location.reload()`);
  await wait(5000);
  await main.ev(`(() => { const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.trim()==="书架"); b?.click(); return !!b; })()`);
  await wait(1500);
  await main.ev(`(() => { const c=[...document.querySelectorAll('.book-card')].find(x=>(x.title||x.textContent).includes(${JSON.stringify(MARK)})); c?.click(); return !!c; })()`);
  await wait(6000);

  const geom = async (label) => asObj(await main.ev(`(() => {
    const mainEl = document.querySelector('.reader-engine-main');
    const side = document.querySelector('.reader-sidebar');
    const body = document.querySelector('.reader-body');
    const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width) }; };
    const mr = R(mainEl), sr = R(side);
    const hitPt = sr && side ? { x: Math.round(sr.left + sr.w / 2), y: Math.round(side.getBoundingClientRect().top + 16) } : null;
    const hit = hitPt ? document.elementFromPoint(hitPt.x, hitPt.y) : null;
    return JSON.stringify({
      label: ${JSON.stringify(label)},
      main: mr, side: sr,
      bodyCls: body ? String(body.className) : null,
      // 停靠让位判据：正文区右缘不得越过栏左缘
      gapPx: mr && sr ? Math.round(sr.left - mr.right) : null,
      hitPt,
      hitEl: hit ? hit.tagName + "." + String(hit.className).slice(0, 34) : null,
      hitInsideSide: !!(hit && side && side.contains(hit)),
      tabs: [...document.querySelectorAll('[data-sidebar-tab]')].map((b) => b.dataset.sidebarTab),
      // ⚠️ rect 断言**量不到 overflow:hidden 裁剪**：被剪掉的元素 rect 依然正确。
      // 所以命中判据必须用 elementFromPoint，且坐标取自栏自己的几何（见上 hitPt）。
      hostPadLeft: (() => { const h = document.querySelector('.reader-engine-host'); return h ? getComputedStyle(h).paddingLeft : null; })(),
    });
  })()`) || "{}");

  const closed = await geom("目录关闭");
  await shot(main, "100-目录关闭");
  console.log(`\n目录关闭: ${JSON.stringify(closed)}`);

  const opened = await main.ev(`(() => { const b=document.querySelector("[data-reader-sidebar-toggle]"); if(!b) return "no-btn"; b.click(); return "clicked"; })()`);
  await wait(1800);
  const open = await geom("目录打开");
  await shot(main, "101-目录打开");
  console.log(`目录打开: ${JSON.stringify(open)}`);
  console.log(`（点击结果 ${opened}）`);

  t("侧栏确实打开了（.reader-sidebar 在场且页签齐）", !!open.side, "未找到 .reader-sidebar");
  t("栏宽 280±1（D2 停靠栏）", open.side != null && Math.abs(open.side.w - 280) <= 1, `side.w=${open.side?.w}`);
  t("正文区右缘 ≤ 栏左缘（停靠让位，不是压上去）",
    open.main?.right != null && open.side?.left != null && open.main.right <= open.side.left + 1,
    `main.right=${open.main?.right} side.left=${open.side?.left}`);
  t("关闭时正文区占满（无栏）", closed.side == null, `closed.side=${JSON.stringify(closed.side)}`);
  t("关闭时正文区比开着时宽 280±1px",
    closed.main?.w != null && open.main?.w != null && Math.abs(closed.main.w - open.main.w - 280) <= 1,
    `closed=${closed.main?.w} open=${open.main?.w}`);
  t("body 不再带 reader-body-toc-open（左浮层让位已退役）",
    !String(open.bodyCls || "").includes("reader-body-toc-open"), String(open.bodyCls));
  t("宿主不再靠 padding-left 让位（padding-left = 0）",
    String(open.hostPadLeft || "0px") === "0px", `hostPadLeft=${open.hostPadLeft}`);
  // 关键：遵守裁剪的判据 —— 栏必须真的能被点到（被 overflow:hidden 剪掉的元素点不中），
  // 命中点取自栏矩形（页签行中部），不是写死的左浮层坐标。
  t("栏在其几何位置上可被命中（未被裁剪掉）",
    open.hitInsideSide === true,
    `命中点 ${JSON.stringify(open.hitPt)} → ${open.hitEl} —— 栏被裁剪或未绘制`);

  console.log(red === 0 ? "\n>>> 右侧停靠栏让位已验证通过" : `\n>>> 判红 ${red} 条`);
  fs.writeFileSync(path.join(SHOTS, "result.json"), JSON.stringify({ closed, open, red }, null, 2));
  process.exitCode = red ? 1 : 0;
} catch (e) {
  console.error("HARNESS ERROR:", e?.stack || e);
  process.exitCode = 2;
} finally {
  try { if (electron?.pid) spawn("taskkill", ["/PID", String(electron.pid), "/T", "/F"], { shell: true, stdio: "ignore" }); } catch { /* ignore */ }
}
