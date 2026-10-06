// 复习界面重设计第二批 GUI 端到端（D100/v48.59；CDP 驱动真实应用，自启自关；node tests/d100-review-restyle.gui.mjs）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-d100-userdata（先清空，全新库），测试数据 FSRSTEST 前缀，结束前软删。
// 覆盖（设计 docs/design/REVIEW-BAR-RESTYLE-D100.md §3 v5）：
//   ① 头带下缘细线收进 720 内列（border-bottom 退役 + ::after 内列线）；
//   ② 评分四钮：8px 色点退役；常态完全无彩色（四钮同灰、档名主文字色）；
//      CDP 真鼠标 hover → 整钮语义色填充（Again=error / Good=accent），移开回落灰；40px 等高不变；
//   ③ 三档计数：色点退役、无彩色（三数字同色）、档间 hairline 竖分隔、三档文案在场。
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9238";
const USER_DATA = path.join(ROOT, "tests", "tmp-d100-userdata");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function check(name, cond, actual) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 300)}`);
  }
}
let electron = null;
let cdp = null;
let cdpRaw = null;
let seededId = null;
let seededId2 = null;

async function listTargets() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  return list.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
}

async function cdpConnect() {
  for (let i = 0; i < 80; i++) {
    try {
      const t = (await listTargets()).find((x) => (x.url || "").includes("index.html"));
      if (t) {
        const ws = new globalThis.WebSocket(t.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
        let id = 0;
        const pending = new Map();
        ws.addEventListener("message", (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        });
        cdpRaw = ws;
        return {
          ws,
          eval: async (expr) => {
            const r = await new Promise((res) => {
              const mid = ++id;
              pending.set(mid, res);
              ws.send(JSON.stringify({ id: mid, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true, returnByValue: true } }));
            });
            if (r.result?.exceptionDetails) throw new Error("eval fail: " + JSON.stringify(r.result.exceptionDetails).slice(0, 200));
            return r.result?.result?.value;
          },
          send: (method, params) => new Promise((res) => {
            const mid = ++id;
            pending.set(mid, res);
            ws.send(JSON.stringify({ id: mid, method, params }));
          }),
          shot: async (file) => {
            const s = await new Promise((res) => {
              const mid = ++id;
              pending.set(mid, res);
              ws.send(JSON.stringify({ id: mid, method: "Page.captureScreenshot", params: { format: "png" } }));
            });
            fs.writeFileSync(file, Buffer.from(s.result.data, "base64"));
          }
        };
      }
    } catch { /* retry */ }
    await wait(1500);
  }
  throw new Error("CDP 连接失败（应用未启动？）");
}

/** CDP 真鼠标悬停到元素中心（:hover 生效路径），返回悬停后的 computed background/color */
async function hoverAndRead(selector) {
  const rect = JSON.parse(await cdp.eval(`JSON.stringify((() => { const b = document.querySelector(${JSON.stringify(selector)}); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`));
  if (!rect) return null;
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(rect.x), y: Math.round(rect.y) });
  await wait(300);
  return cdp.eval(`JSON.stringify((() => { const b = document.querySelector(${JSON.stringify(selector)}); const cs = getComputedStyle(b); return { bg: cs.backgroundColor, color: cs.color, border: cs.borderColor }; })())`);
}

try {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  const out = openSync(path.join(ROOT, "tests", "d100-review.app.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: false,
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  cdp = await cdpConnect();
  await cdp.eval("1");
  await wait(1500);

  const seeded = await cdp.eval(`(async () => {
    const OLD = Date.parse('2000-01-01');
    const qa = await window.cardsAPI.create({ noteText: 'FSRSTEST D100-qa', cardType: 'qa', frontMarkdown: 'FSRSTEST 重设计判据卡？', backMarkdown: 'FSRSTEST 答案', priority: 50, tags: [], fsrsJson: JSON.stringify({ state: 'new', due: OLD, lapses: 0, reps: 0 }) });
    // 第二张：带 contextRef（底栏多出「跳转原文」第三侧钮 → 评分行被挤进容器查询紧凑档）
    const qa2 = await window.cardsAPI.create({ noteText: 'FSRSTEST D100-qa2', cardType: 'qa', frontMarkdown: 'FSRSTEST 挤压场景判据卡？', backMarkdown: 'FSRSTEST 答案2', priority: 50, tags: [], contextRef: { documentId: 'FSRSTEST-doc', anchorText: 'FSRSTEST 锚文本' }, fsrsJson: JSON.stringify({ state: 'new', due: OLD + 1000, lapses: 0, reps: 0 }) });
    return JSON.stringify({ a: qa.id || "", b: qa2.id || "" });
  })()`);
  const seedObj = JSON.parse(seeded || "{}");
  if (seedObj.a) seededId = seedObj.a;
  if (seedObj.b) seededId2 = seedObj.b;
  check("播种两张测试卡（第二张带 contextRef）", Boolean(seedObj.a) && Boolean(seedObj.b), seeded);

  await cdp.eval("window.location.reload()");
  await wait(3000);
  await cdp.eval(`(() => { const nav = [...document.querySelectorAll('.nav-item')].find((b) => b.textContent === '复习'); nav && nav.click(); return 'nav'; })()`);
  await wait(1500);

  // ---------- ① 头带细线收内列 ----------
  const head = await cdp.eval(`JSON.stringify((() => {
    const h = document.querySelector('.review-head');
    if (!h) return { missing: true };
    const cs = getComputedStyle(h);
    const af = getComputedStyle(h, '::after');
    return { bb: cs.borderBottomWidth, afContent: af.content, afMax: af.maxWidth, afBb: af.borderBottomWidth };
  })())`);
  const h1 = JSON.parse(head || "{}");
  check("头带全宽 border-bottom 退役（0px）", h1.bb === "0px", head);
  // DPR 125% 下 1px hairline 的 computed used value = 0.8px——按数值容差判（>0 且 ≤1.3）
  check("::after 内列线在场（720 / hairline）", h1.afMax === "720px" && parseFloat(h1.afBb) > 0 && parseFloat(h1.afBb) <= 1.3, head);

  // ---------- ③ 计数：色点退役 + 无彩色 + 分隔线 ----------
  const counts = await cdp.eval(`JSON.stringify((() => {
    const wrap = document.querySelector('.review-count[data-review-counts]');
    if (!wrap) return { missing: true };
    const dot = wrap.querySelector('.count-dot');
    const nums = [...wrap.querySelectorAll('.qi-num')].map((x) => getComputedStyle(x).color);
    const lab = wrap.querySelector('.lab');
    const second = wrap.querySelectorAll('.qi')[1];
    return {
      dotGone: !dot,
      labels: [...wrap.querySelectorAll('.lab')].map((x) => x.textContent.trim()).join('|'),
      numColors: nums,
      labColor: lab ? getComputedStyle(lab).color : null,
      sep: second ? getComputedStyle(second).borderLeftWidth : null,
      qiDir: getComputedStyle(wrap.querySelectorAll('.qi')[0]).flexDirection,
      qiMaxH: Math.max(...[...wrap.querySelectorAll('.qi')].map((x) => x.getBoundingClientRect().height)),
      numFs: getComputedStyle(wrap.querySelector('.qi-num')).fontSize,
      labFs: getComputedStyle(wrap.querySelector('.lab')).fontSize,
      numW: getComputedStyle(wrap.querySelector('.qi-num')).fontWeight
    };
  })())`);
  const c1 = JSON.parse(counts || "{}");
  check("计数 8px 色点退役", c1.dotGone === true, counts);
  check("三档文案在场（m4/m12 钩子）", c1.labels === "未学习|学习中|待复习", counts);
  check("三档数字无彩色（互同色）", Array.isArray(c1.numColors) && c1.numColors.length === 3 && new Set(c1.numColors).size === 1, counts);
  check("档间 hairline 竖分隔（DPR 容差）", c1.sep !== null && parseFloat(c1.sep) > 0 && parseFloat(c1.sep) <= 1.3, counts);
  check("计数单行（标签+数字同行，R2）", c1.qiDir === "row" && c1.qiMaxH <= 34, counts);
  check("数字与标签同字号不强调（R3）", c1.numFs === c1.labFs && c1.numW === "500", counts);

  // ---------- ② 评分钮：色点退役 + 常态无彩色 + hover 揭示 ----------
  await cdp.eval(`(() => { const b = document.querySelector('[data-reveal]'); b && b.click(); return 'revealed'; })()`);
  await wait(700);
  const rest = await cdp.eval(`JSON.stringify((() => {
    const bar = document.querySelector('.review-bar');
    if (!bar) return { missing: true };
    const dot = bar.querySelector('.grade-dot');
    const btns = [...bar.querySelectorAll('.grade')];
    const names = btns.map((b) => getComputedStyle(b.querySelector('.grade-name')).color);
    const bgs = btns.map((b) => getComputedStyle(b).backgroundColor);
    const rec = bar.querySelector('.grade.recommended');
    return {
      dotGone: !dot,
      names, bgs,
      h: btns.map((b) => b.getBoundingClientRect().height),
      nowrap: btns.map((b) => getComputedStyle(b).whiteSpace),
      dueVisible: [...bar.querySelectorAll('.grade-due')].map((d) => getComputedStyle(d).display !== "none"),
      rowW: bar.querySelector('.grade-row').getBoundingClientRect().width,
      recIsGood: rec ? rec.querySelector('.grade-name').textContent.trim() === "良好" : false
    };
  })())`);
  const r1 = JSON.parse(rest || "{}");
  check("评分钮 8px 色点退役", r1.dotGone === true, rest);
  check("常态四钮档名无彩色（互同色）", Array.isArray(r1.names) && r1.names.length === 4 && new Set(r1.names).size === 1, rest);
  check("常态四钮底色无彩色（互同、非 accent）", Array.isArray(r1.bgs) && r1.bgs.length === 4 && new Set(r1.bgs).size === 1, rest);
  check("四钮仍 40px 单行（D99 等高维持）", Array.isArray(r1.h) && r1.h.length === 4 && r1.h.every((x) => Math.abs(x - 40) <= 1), rest);
  check("recommended 类仍挂良好档（涟漪/焦点钩子）", r1.recIsGood === true, rest);
  check("按钮文字 nowrap（R2 竖排根治）", Array.isArray(r1.nowrap) && r1.nowrap.every((w) => w === "nowrap"), rest);
  check("宽敞档（两侧钮）间隔预览在场", Array.isArray(r1.dueVisible) && r1.dueVisible.every((v) => v === true) && r1.rowW >= 480, rest);

  // hover 揭示：真鼠标移到「重来」→ 整钮 error 填充；移到「良好」→ accent 填充
  const restBg = r1.bgs[0];
  const hov = await hoverAndRead('.grade-again');
  const hAgain = JSON.parse(hov || "{}");
  check("hover「重来」→ 整钮 error 填充（≠常态灰）", hAgain.bg && hAgain.bg !== restBg, hov);
  check("hover「重来」→ 文字翻转 -on（≠常态主文字色）", hAgain.color && hAgain.color !== r1.names[0], hov);
  const hGood = JSON.parse(await hoverAndRead('.grade.recommended') || "{}");
  check("hover「良好」→ 整钮 accent 填充", hGood.bg && hGood.bg !== restBg && hGood.bg !== hAgain.bg, hGood);
  // 移开（鼠标挪到卡面空白处）→ 回落灰
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 60, y: 300 });
  await wait(300);
  const back = await cdp.eval(`getComputedStyle(document.querySelector('.grade-again')).backgroundColor`);
  check("移开后回落常态灰", back === restBg, back);

  // ---------- R2 紧凑档：评分 Good → 带 contextRef 的卡 2（侧簇三钮）→ 间隔预览让位 ----------
  await cdp.eval(`(() => { const b = document.querySelector('.grade.recommended'); b && b.click(); return 'graded'; })()`);
  await wait(1800);
  check("进入带 contextRef 的卡 2", (await cdp.eval(`(() => { const f = document.querySelector('.review-front'); return f && f.innerText.includes('挤压场景') ? 'ok' : (f ? f.innerText.slice(0, 20) : 'NO FACE'); })()`)) === "ok", "face");
  await cdp.eval(`(() => { const b = document.querySelector('[data-reveal]'); b && b.click(); return 'revealed'; })()`);
  await wait(700);
  const squeezed = await cdp.eval(`JSON.stringify((() => {
    const bar = document.querySelector('.review-bar');
    const jump = [...bar.querySelectorAll('.bar-btn')].some((b) => b.textContent.includes('跳转原文'));
    const dues = [...bar.querySelectorAll('.grade-due')].map((d) => getComputedStyle(d).display);
    const btns = [...bar.querySelectorAll('.grade')];
    return {
      jump,
      dueHidden: dues.every((d) => d === "none"),
      rowW: bar.querySelector('.grade-row').getBoundingClientRect().width,
      h: btns.map((b) => b.getBoundingClientRect().height),
      noVertText: btns.every((b) => b.scrollHeight <= Math.ceil(b.clientHeight + 1))
    };
  })())`);
  const s1 = JSON.parse(squeezed || "{}");
  check("卡 2 侧簇出现「跳转原文」（三侧钮挤压场景）", s1.jump === true, squeezed);
  check("行宽 <480 → 间隔预览让位（容器查询紧凑档）", s1.dueHidden === true && s1.rowW < 480, squeezed);
  check("紧凑档下按钮仍 40px 且无竖排文字", Array.isArray(s1.h) && s1.h.every((x) => Math.abs(x - 40) <= 1) && s1.noVertText === true, squeezed);

  await cdp.shot("tests/tmp-d100-back.png");
} catch (err) {
  fail++;
  console.log(`  ✗ 套件异常 | ${err && err.message ? err.message : String(err)}`);
} finally {
  try {
    if (cdp && (seededId || seededId2)) {
      await cdp.eval(`(async () => {
        for (const id of ${JSON.stringify([seededId, seededId2].filter(Boolean))}) {
          try { await window.cardsAPI.remove(id); } catch (e) {}
        }
        return 'cleaned';
      })()`);
    }
  } catch { /* 清理尽力而为 */ }
  try { if (cdpRaw) cdpRaw.close(); } catch { /* ignore */ }
  try { if (electron) electron.kill(); } catch { /* ignore */ }
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* ignore */ }
}

console.log(`\nD100 review restyle GUI: ${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
