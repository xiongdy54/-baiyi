// 视觉核查 v7 —— 补最后两个视觉缺口 + 数值验证 D53 的两条几何恒等式
// 缺口一：知识管理页（KnowledgeManager）——它挂在卡片页的「知识点」preset 后面（CardBrowser.tsx:205-210），
//         v1/v2 都没点到，所以此前对这一页**零证据**。
// 缺口二：右下角活动指示器在**真有可续跑 run 时**的形态 —— v1/v2 只在空库下看过，容器本就不存在。
//         这里先用 tmp-seed-mmrun.cjs 在同一个 userData 里落一条 interrupted + 一条更旧的 section_ready，
//         再启动应用看播种结果。
// D53 的两条恒等式（决策原文 §8.1 D53③）：
//   ① 收起态只留一行 = 26px（24px 行高 + 1px 边框）
//   ② 详情块定高 120px → 切换展开行时 **Δ总高 = 0 且 Δ顶边 = 0**
//      ②是修「展开最上行时整块缩短、光标掉出卡片 → mouseleave 抖收」的手段，必须用真鼠标才测得出。
// 运行：node tests/visual-audit7.mjs
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9318";
const USER_DATA = path.join(ROOT, "tests", "tmp-visual7-userdata");
const SHOTS = path.join(ROOT, "tests", "tmp-visual7");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync(USER_DATA, { recursive: true, force: true });
fs.mkdirSync(USER_DATA, { recursive: true });
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
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
// 真鼠标移到某个元素中心（D53 的抖收缺陷只有真 hover 才测得出）
const hoverAt = async (p, x, y) => {
  await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await wait(700);
  await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x + 1, y });
  await wait(900);
};

let electron = null;
try {
  // ── 第一步：同一个 userData 里落一条 interrupted run ─────────────────────
  // shell:true 在 Windows 上是拼命令行而非 execv，路径里的空格会被切开 —— 必须自己加引号
const seed = spawnSync("npx", ["electron", "tests/fsrs/tmp-seed-mmrun.cjs"], {
    cwd: ROOT, shell: true, encoding: "utf8", timeout: 180_000,
    env: { ...process.env, SEED_USERDATA: USER_DATA },
  });
  const seedOut = (seed.stdout || "") + (seed.stderr || "");
  console.log("播种输出：\n" + seedOut.split("\n").filter((l) => l.includes("documentId") || l.includes("RESUMABLE")).join("\n"));
  if (!seedOut.includes("RESUMABLE")) throw new Error("播种失败：\n" + seedOut.slice(0, 600));

  // ── 第二步：带着这条 run 启动应用 ────────────────────────────────────────
  const log = fs.openSync(path.join(ROOT, "tests", "visual7.app.log"), "a");
  electron = spawn("npx", ["electron", ".", `--remote-debugging-port=${PORT}`], {
    cwd: ROOT, shell: true, stdio: ["ignore", log, log], env: { ...process.env, M7_TEST_USERDATA: USER_DATA },
  });
  const main = await connect((u) => u.includes("index.html"), "主窗口");
  await wait(6000);

  // ── A. 知识管理页 ────────────────────────────────────────────────────────
  await main.ev(`(() => { const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.trim()==="卡片"); b?.click(); return !!b; })()`);
  await wait(2200);
  const kn = await main.ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==="知识点"); if(!b) return "no-btn"; b.click(); return "clicked"; })()`);
  await wait(2200);
  const kf = asObj(await main.ev(`JSON.stringify({
    bodyLen: document.body.innerText.length,
    crashed: document.body.innerText.includes("界面出现异常"),
    h: [...document.querySelectorAll('h1,h2,h3')].map(x=>x.textContent.trim()).filter(Boolean).slice(0,6),
    text: document.body.innerText.replace(/\\s+/g," ").slice(0,200),
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    btns: document.querySelectorAll('button').length
  })`) || "{}");
  await shot(main, "80-知识管理页");
  console.log(`\n[A] 知识管理页: ${kn} → ${JSON.stringify(kf)}`);

  // ── B. 指示器：真实存在性 + D53 两条几何恒等式 ───────────────────────────
  const probeSel = `[class*=activity],[class*=Activity]`;
  const ind0 = asObj(await main.ev(`(() => {
    const el = document.querySelector(${JSON.stringify(probeSel)});
    if (!el) return JSON.stringify({ present: false });
    const r = el.getBoundingClientRect();
    return JSON.stringify({
      present: true, cls: String(el.className).slice(0,60),
      rect: { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      rows: el.querySelectorAll('[class*=row],[class*=task]').length,
      text: el.innerText.replace(/\\s+/g," ").slice(0,160),
      vw: innerWidth, vh: innerHeight,
    });
  })()`) || "{}");
  await shot(main, "81-指示器-收起态");
  console.log(`\n[B] 指示器（有 interrupted run 时）: ${JSON.stringify(ind0)}`);

  if (!ind0.present) {
    console.log(">>> 判读：库里确有 interrupted 运行，但指示器容器不存在 —— 播种链断了。需回查 App.tsx 播种与 pendingRuns。");
    const pr = asObj(await main.ev(`(async()=>JSON.stringify(await window.mindmapAPI.pendingRuns()))()`) || "[]");
    console.log(`    mindmapAPI.pendingRuns() = ${JSON.stringify(pr).slice(0, 300)}`);
  } else {
    const collapsedH = ind0.rect.h;
    console.log(`>>> D53① 收起态单行高 = ${collapsedH}px（契约 26px）→ ${collapsedH === 26 ? "符合" : "不符合"}`);

    // 真 hover 展开，量 Δ总高 与 Δ顶边
    const cx = ind0.rect.left + Math.round(ind0.rect.w / 2);
    const cy = ind0.rect.top + Math.round(ind0.rect.h / 2);
    await hoverAt(main, cx, cy);
    const ind1 = asObj(await main.ev(`(() => {
      const el = document.querySelector(${JSON.stringify(probeSel)});
      const r = el.getBoundingClientRect();
      return JSON.stringify({ rect: { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        detailH: (()=>{const d=el.querySelector('[class*=detail]'); return d? Math.round(d.getBoundingClientRect().height):null})(),
        text: el.innerText.replace(/\\s+/g," ").slice(0,160) });
    })()`) || "{}");
    await shot(main, "82-指示器-hover展开");
    const dH = ind1.rect.h - collapsedH;
    const dTop = ind1.rect.top - ind0.rect.top;
    console.log(`[B] hover 展开后: ${JSON.stringify(ind1.rect)} 详情块高=${ind1.detailH}`);
    console.log(`>>> D53② 展开时 Δ总高=${dH}px、Δ顶边=${dTop}px（契约：切换展开行时两者都应为 0）`);
    console.log(`    注：②说的是「切换展开行」之间恒等，收起→展开这一跳本就会变高；` +
      `真正要验的是「展开第 1 行 vs 展开第 2 行」总高与顶边不变。多行时才有意义，当前播种行数=${ind0.rows}。`);

    // 键盘可达：D53 说 hover **或键盘 focus** 都能展开
    await main.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 40, y: 40 });
    await wait(900);
    const back = asObj(await main.ev(`(() => { const el=document.querySelector(${JSON.stringify(probeSel)}); const r=el.getBoundingClientRect(); return JSON.stringify({h:Math.round(r.height)}); })()`) || "{}");
    console.log(`>>> 鼠标移开后回落到 ${back.h}px（收起态 ${collapsedH}px）→ ${back.h === collapsedH ? "回落正常" : "未回落"}`);
    const focused = await main.ev(`(() => {
      const el=document.querySelector(${JSON.stringify(probeSel)});
      const t=el.querySelector('[tabindex],button,a'); if(!t) return "no-focusable";
      t.focus(); return document.activeElement === t ? "focused" : "focus-failed";
    })()`);
    await wait(1200);
    const ind2 = asObj(await main.ev(`(() => { const el=document.querySelector(${JSON.stringify(probeSel)}); const r=el.getBoundingClientRect(); return JSON.stringify({h:Math.round(r.height), top:Math.round(r.top)}); })()`) || "{}");
    console.log(`>>> 键盘 focus（${focused}）展开后高=${ind2.h}px → ${ind2.h > collapsedH ? "键盘也能展开（D53 要求 hover/focus 两路）" : "**键盘 focus 不展开，D53 的键盘路径缺失**"}`);

    // ── D53② 的真正测法：界面上有两行时，「展开第 1 行」与「展开第 2 行」的
    //    容器总高与顶边必须相同（定高 120px 详情块就是为了这个）。
    //    收起→展开那一跳本来就会变高，拿它当②的判据是错的（本脚本上一版就差点这么判）。
    // 收起态按 D53① 只留一行，「一任务一行」要展开后才存在 —— 先 hover 把容器撑开再数列。
    await hoverAt(main, cx, cy);
    const rowList = asObj(await main.ev(`(() => {
      const el=document.querySelector(${JSON.stringify(probeSel)});
      // 上一版用 '[class*=row],[class*=task]' 匹到了「行容器 + 行内 task 节点」两层嵌套，
      // rect 完全相同 → 逐行 hover 变成同一行 hover 两次，Δ=0 是恒真式。
      // 改成按 rect.top 去重：只有垂直位置真的不同的节点才算界面上独立的两行。
      const seen = new Set();
      const rows=[...el.querySelectorAll('[class*=row],[class*=task]')]
        .map(r=>({r, b:r.getBoundingClientRect()}))
        .filter(({b},_i)=> b.height>0 && !seen.has(Math.round(b.top)) && seen.add(Math.round(b.top)))
        .map(({r})=>r);
      return JSON.stringify(rows.map((r,i)=>{const b=r.getBoundingClientRect();return {i, text:(r.innerText||"").replace(/\s+/g," ").slice(0,26), left:Math.round(b.left), top:Math.round(b.top), h:Math.round(b.height)};}));
    })()`) || "[]");
    console.log(`
>>> 界面上可见行数 = ${Array.isArray(rowList) ? rowList.length : "?"}：${JSON.stringify(rowList)}`);
    if (Array.isArray(rowList) && rowList.length >= 2) {
      const per = [];
      for (const rw of rowList) {
        // 不要移开容器（移开就收回 26px）；只在容器内两行之间移动
        await hoverAt(main, rw.left + 60, rw.top + Math.round(rw.h / 2));
        const g = asObj(await main.ev(`(() => { const el=document.querySelector(${JSON.stringify(probeSel)}); const r=el.getBoundingClientRect(); const d=el.querySelector('[class*=detail]'); return JSON.stringify({h:Math.round(r.height), top:Math.round(r.top), detailH: d?Math.round(d.getBoundingClientRect().height):null}); })()`) || "{}");
        per.push({ row: rw.text, ...g });
        await shot(main, `83-展开第${rw.i + 1}行`);
      }
      console.log(`    逐行展开实测：${JSON.stringify(per)}`);
      const hs = per.map((x) => x.h), ts = per.map((x) => x.top);
      const dH = Math.max(...hs) - Math.min(...hs), dT = Math.max(...ts) - Math.min(...ts);
      console.log(`>>> D53② 切换展开行：Δ总高=${dH}px、Δ顶边=${dT}px（契约两者均应为 0）→ ${dH === 0 && dT === 0 ? "**符合**" : "**不符合**"}`);
      const dh = per.map((x) => x.detailH).filter((v) => v != null);
      if (dh.length) console.log(`    详情块高集合 = ${JSON.stringify([...new Set(dh)])}（契约 120px 定高）`);
    } else {
      console.log(">>> D53② 无法验证：界面只有一行（去重生效或第二份材料未播种），需要两条不同材料的可续跑运行。");
    }
  }
  fs.writeFileSync(path.join(SHOTS, "probe.json"), JSON.stringify({ kn, kf, ind0 }, null, 2));
  console.log(`\n截图目录: ${SHOTS}`);
} catch (e) {
  console.error("HARNESS ERROR:", e?.stack || e);
  process.exitCode = 2;
} finally {
  try { if (electron?.pid) spawn("taskkill", ["/PID", String(electron.pid), "/T", "/F"], { shell: true, stdio: "ignore" }); } catch { /* ignore */ }
}
