// E-1 修复验证：打开目录时正文是否真的让位（几何断言，不靠肉眼）
// 判据：reader-toc 是 absolute 浮层（left:0 / width:280px），所以修复后必须有
//       reader-scroll.getBoundingClientRect().left >= reader-toc.getBoundingClientRect().right
// 同时用同会话 A/B 截图留证（关 / 开）。
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
    const scroll = document.querySelector('.reader-scroll');
    const toc = document.querySelector('.reader-toc');
    const body = document.querySelector('.reader-body');
    const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width) }; };
    const sr = R(scroll), tr = R(toc);
    return JSON.stringify({
      label: ${JSON.stringify(label)},
      scroll: sr, toc: tr,
      bodyCls: body ? String(body.className) : null,
      // 修复判据：目录打开时正文左缘不得落在目录右缘左侧
      overlapPx: tr && sr ? Math.round(tr.right - sr.left) : null,
      // ⚠️ rect 断言**量不到 overflow:hidden 裁剪**：被剪掉的元素 rect 依然正确。
      // 所以必须加**遵守裁剪**的判据 —— elementFromPoint 打不中被剪掉的元素。
      hitTopLeft: (() => { const e = document.elementFromPoint(140, 130); return e ? e.tagName + "." + String(e.className).slice(0, 34) : null; })(),
      hitList: (() => { const e = document.elementFromPoint(140, 200); return e ? e.tagName + "." + String(e.className).slice(0, 34) : null; })(),
      tocInHit: (() => {
        const a = document.elementFromPoint(140, 130), b = document.elementFromPoint(140, 200);
        const inside = (el) => !!el && !!document.querySelector('.reader-toc') && document.querySelector('.reader-toc').contains(el);
        return inside(a) || inside(b);
      })(),
      hostPadLeft: (() => { const h = document.querySelector('.reader-engine-host'); return h ? getComputedStyle(h).paddingLeft : null; })(),
      hostContentLeft: (() => { const h = document.querySelector('.reader-engine-host'); if (!h) return null; const b = h.getBoundingClientRect(); const cs = getComputedStyle(h); return Math.round(b.left + parseFloat(cs.paddingLeft || '0')); })(),
    });
  })()`) || "{}");

  const closed = await geom("目录关闭");
  await shot(main, "100-目录关闭");
  console.log(`\n目录关闭: ${JSON.stringify(closed)}`);

  const opened = await main.ev(`(() => { const b=[...document.querySelectorAll('.reader-engine-controls button')].find(x=>x.textContent.includes("目录")); if(!b) return "no-btn"; b.click(); return "clicked"; })()`);
  await wait(1800);
  const open = await geom("目录打开");
  await shot(main, "101-目录打开");
  console.log(`目录打开: ${JSON.stringify(open)}`);
  console.log(`（点击结果 ${opened}）`);

  t("目录确实打开了（toc 节点存在）", !!open.toc, "未找到 .reader-toc");
  // 判据已更新：让位由 .reader-engine-host 的 padding-left 承担（不是移动 .reader-scroll），
  // 所以量的是**宿主内容左缘**而不是滚动盒左缘。
  t("正文让位：宿主内容左缘 ≥ reader-toc.right（E-1 的修复判据）",
    open.hostContentLeft != null && open.toc?.right != null && open.hostContentLeft >= open.toc.right - 1,
    `目录右缘 ${open.toc?.right} 仍压住正文内容左缘 ${open.hostContentLeft}`);
  t("body 带上了 reader-body-toc-open 类", String(open.bodyCls || "").includes("reader-body-toc-open"), String(open.bodyCls));
  t("目录关闭时不加左移（不影响原布局）", !String(closed.bodyCls || "").includes("reader-body-toc-open"), String(closed.bodyCls));
  // 关键：遵守裁剪的判据 —— 面板必须真的能被点到（被 overflow:hidden 剪掉的元素点不中）
  t("目录面板可被命中（未被裁剪掉）：elementFromPoint 落在 .reader-toc 内",
    open.tocInHit === true,
    `命中 ${JSON.stringify(open.hitTopLeft)} / ${JSON.stringify(open.hitList)} —— 面板被裁剪或未绘制`);
  t("正文内容区起点 ≥ 面板右缘（内容确实让出了面板宽度）",
    open.hostContentLeft != null && open.toc?.right != null && open.hostContentLeft >= open.toc.right - 1,
    `宿主内容左缘 ${open.hostContentLeft} vs 面板右缘 ${open.toc?.right}`);
  t("由 .reader-engine-host 承担让位（padding-left 生效）",
    String(open.hostPadLeft || "") !== "0px", `hostPadLeft=${open.hostPadLeft}`);

  console.log(red === 0 ? "\n>>> E-1 修复已验证通过" : `\n>>> 判红 ${red} 条`);
  fs.writeFileSync(path.join(SHOTS, "result.json"), JSON.stringify({ closed, open, red }, null, 2));
  process.exitCode = red ? 1 : 0;
} catch (e) {
  console.error("HARNESS ERROR:", e?.stack || e);
  process.exitCode = 2;
} finally {
  try { if (electron?.pid) spawn("taskkill", ["/PID", String(electron.pid), "/T", "/F"], { shell: true, stdio: "ignore" }); } catch { /* ignore */ }
}
