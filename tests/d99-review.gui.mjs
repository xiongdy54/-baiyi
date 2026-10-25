// 复习界面优化四项 GUI 端到端（D99/v48.58；CDP 驱动真实应用，自启自关；node tests/d99-review.gui.mjs）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-d99-userdata（先清空，全新库），测试数据一律 FSRSTEST 前缀，结束前软删。
// 覆盖（设计 docs/design/REVIEW-UI-POLISH-D99.md §3）：
//   ① AI 判答：底栏按钮 → 模态 → 学生答案 → AI mock 裁决 JSON → 徽标+理由渲染 → 关闭；
//   ② 自动发音默认开：非听音单词卡正面 0 次、翻面（按钮出现）1 次（speechSynthesis spy）；
//      深色档发音按钮可见度：描边/图标与底色亮度差 > 阈值（真实主题路径 settingsAPI.set + reload）；
//   ③ 进度条左右与卡面同列（|Δ| ≤ 2px）；
//   ④ 评分四钮高度 == 「显示答案」主钮高度（±1px）。
// AI 桩：window.aiAPI 是 contextBridge 冻结对象，故在网络边缘打桩（OpenAI 兼容 SSE，同 occlusion/d91-d92 口径）。
import { spawn } from "node:child_process";
import killProc from "./lib/killProc.cjs";
import fs, { openSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9236";
const MOCK_PORT = 9342;
const USER_DATA = path.join(ROOT, "tests", "tmp-d99-userdata");

// ---------- AI mock（occlusion-editor 同构：测试进程内 OpenAI 兼容 SSE，按 system 关键字分流）----------
const VERDICT_JSON = JSON.stringify({ verdict: "correct", explanation: "同义改写，与标准答案表达同一群体。" });
const mockServer = http.createServer((req, res) => {
  if (req.method !== "POST" || !String(req.url).includes("/chat/completions")) {
    res.writeHead(404);
    res.end();
    return;
  }
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    // 判答请求（system 含「答案判定助手」）回裁决 JSON；其余一律回通用 JSON（测试内只有判答一条链路）
    let sys = "";
    try { sys = String(JSON.parse(body).messages?.[0]?.content || ""); } catch { /* 视作 other */ }
    const full = sys.includes("答案判定") ? VERDICT_JSON : JSON.stringify({ ok: true });
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const parts = full.match(/[\s\S]{1,40}/g) || [];
    let i = 0;
    const timer = setInterval(() => {
      if (i < parts.length) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: parts[i++] } }] })}\n\n`);
      } else {
        clearInterval(timer);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      }
    }, 40);
    res.on("close", () => clearInterval(timer));
  });
});
const mockListen = new Promise((r) => mockServer.listen(MOCK_PORT, "127.0.0.1", r));

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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let electron = null;
let cdp = null;
const seededIds = [];

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
        await new Promise((res, rej) => {
          ws.addEventListener("open", res);
          ws.addEventListener("error", rej);
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
          }
        };
      }
    } catch {
      /* retry */
    }
    await wait(1500);
  }
  throw new Error("CDP 连接失败（应用未启动？）");
}

const navReview = () => cdp.eval(`(() => { const nav = [...document.querySelectorAll('.nav-item')].find((b) => b.textContent === '复习'); nav && nav.click(); return 'nav'; })()`);
const frontGuard = async (needle) => cdp.eval(`(() => { const f = document.querySelector('.review-front'); return f && f.innerText.includes(${JSON.stringify(needle)}) ? 'ok' : (f ? 'FACE:' + f.innerText.slice(0, 30) : 'NO FACE'); })()`);

// ---------- 主流程 ----------
try {
  killProc(electron);
  await wait(800);
  await mockListen;
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  const out = openSync(path.join(ROOT, "tests", "d99-review.app.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT,
    shell: true,
    stdio: ["ignore", out, out],
    detached: process.platform !== "win32",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  cdp = await cdpConnect();
  await cdp.eval("1");
  await wait(1500);

  // 0. 播种（qa 卡先、词卡后，due 升序即队列序）+ AI 指向 mock
  const seeded = await cdp.eval(`(async () => {
    const OLD = Date.parse('2000-01-01');
    const qa = await window.cardsAPI.create({ noteText: 'FSRSTEST D99-qa', cardType: 'qa', frontMarkdown: 'FSRSTEST 袖带红脖是哪个群体对袖带蓝领的蔑称？', backMarkdown: '新兴精英阶层', priority: 50, tags: [], fsrsJson: JSON.stringify({ state: 'new', due: OLD, lapses: 0, reps: 0 }) });
    const vocab = await window.cardsAPI.create({ noteText: 'FSRSTEST D99-vocab', cardType: 'qa', frontMarkdown: 'FSRSTEST 拼写：moral（请回忆单词含义）', backMarkdown: "/ˈmɒrəl/ 道德的", priority: 50, tags: [], dictJson: { providerId: 'local', word: 'moral', normalizedWord: 'moral', language: 'en', kind: 'en2cn', snapshotAt: 0 }, fsrsJson: JSON.stringify({ state: 'new', due: OLD + 1000, lapses: 0, reps: 0 }) });
    return JSON.stringify({ qa: qa.id || "", vocab: vocab.id || "" });
  })()`);
  const seedObj = JSON.parse(seeded || "{}");
  if (seedObj.qa) seededIds.push(seedObj.qa);
  if (seedObj.vocab) seededIds.push(seedObj.vocab);
  check("播种 qa 卡 + 词卡", Boolean(seedObj.qa) && Boolean(seedObj.vocab), seeded);

  const aiCfg = await cdp.eval(`(async () => JSON.stringify(await window.aiAPI.setConfig({ preset: "custom", baseUrl: "http://127.0.0.1:${MOCK_PORT}/v1", model: "mock-model", apiKey: "GUI-TEST-KEY" })))()`);
  check("AI 配置指向 mock 服务器", typeof aiCfg === "string", aiCfg);

  await cdp.eval("window.location.reload()");
  await wait(3000);

  // ---------- A. qa 卡（正面）：进度条对齐 + 显示答案高度 + AI 判答 ----------
  await navReview();
  await wait(1500);
  check("复习页显示 qa 卡", (await frontGuard("袖带红脖")) === "ok", await frontGuard("袖带红脖"));

  const align = await cdp.eval(`JSON.stringify((() => {
    const p = document.querySelector('.review-progress') && document.querySelector('.review-progress').getBoundingClientRect();
    const s = document.querySelector('.review-session') && document.querySelector('.review-session').getBoundingClientRect();
    if (!p || !s) return { missing: true };
    return { dl: Math.abs(p.left - s.left), dr: Math.abs(p.right - s.right) };
  })())`);
  const alignObj = JSON.parse(align || "{}");
  check("进度条左右与卡面对齐（≤2px）", alignObj.dl !== undefined && alignObj.dl <= 2 && alignObj.dr <= 2, align);

  const revealH = await cdp.eval(`(() => { const b = document.querySelector('[data-reveal]'); return b ? b.getBoundingClientRect().height : -1; })()`);
  check("显示答案主钮在场（40 档）", revealH > 30 && revealH < 50, revealH);

  // AI 判答：开模态 → 输入 → 提交 → mock 裁决
  await cdp.eval(`(() => { const b = document.querySelector('[data-testid="review-judge-btn"]'); b && b.click(); return 'clicked'; })()`);
  await wait(400);
  const modalOpen = await cdp.eval(`Boolean(document.querySelector('[data-testid="answer-judge-modal"]'))`);
  check("AI 判答模态打开", modalOpen === true, modalOpen);
  await cdp.eval(`(() => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    const ta = document.querySelector('[data-testid="judge-input"]');
    if (!ta) return "no textarea";
    set.call(ta, "新兴资产阶级");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return "filled";
  })()`);
  await cdp.eval(`(() => { const b = document.querySelector('[data-testid="judge-submit"]'); b && b.click(); return 'submitted'; })()`);
  await wait(1500);
  const verdict = await cdp.eval(`JSON.stringify((() => {
    const v = document.querySelector('[data-testid="judge-verdict"]');
    const e = document.querySelector('[data-testid="judge-explanation"]');
    return { verdict: v ? v.textContent : null, explanation: e ? e.textContent.slice(0, 60) : null };
  })())`);
  const vObj = JSON.parse(verdict || "{}");
  check("裁决徽标 = 等价", vObj.verdict === "等价", verdict);
  check("理由渲染（同义改写）", String(vObj.explanation || "").includes("同义改写"), verdict);
  await cdp.eval(`(() => { const b = document.querySelector('.modal-close'); b && b.click(); return 'closed'; })()`);
  await wait(300);
  const modalClosed = await cdp.eval(`!document.querySelector('[data-testid="answer-judge-modal"]')`);
  check("模态可关闭", modalClosed === true, modalClosed);

  // ---------- B. 翻面：评分四钮等高 ----------
  await cdp.eval(`(() => { const b = document.querySelector('[data-reveal]'); b && b.click(); return 'revealed'; })()`);
  await wait(700);
  const gradeHs = await cdp.eval(`JSON.stringify([...document.querySelectorAll('.review-bar .grade')].map((b) => b.getBoundingClientRect().height))`);
  const hs = JSON.parse(gradeHs || "[]");
  check(
    "评分四钮与显示答案等高（±1px）",
    hs.length === 4 && hs.every((h) => Math.abs(h - revealH) <= 1),
    `reveal=${revealH} grades=${gradeHs}`
  );

  // 评分 Good → 下一张词卡
  await cdp.eval(`(() => { const b = document.querySelector('.review-bar .grade.recommended'); b && b.click(); return 'graded'; })()`);
  await wait(1800);
  check("进入词卡（moral）", (await frontGuard("moral")) === "ok", await frontGuard("moral"));

  // ---------- C. 词卡自动发音（默认开）：正面 0 次、翻面 1 次 ----------
  await cdp.eval(`(() => {
    window.__speakCalls = [];
    try {
      window.speechSynthesis.speak = function (u) { window.__speakCalls.push(String((u && u.text) || "")); };
    } catch (e) {
      Object.defineProperty(window.speechSynthesis, "speak", { value: function (u) { window.__speakCalls.push(String((u && u.text) || "")); } });
    }
    return "spy installed";
  })()`);
  await wait(300);
  const frontCalls = await cdp.eval(`JSON.stringify(window.__speakCalls || [])`);
  check("非听音词卡正面不自动发音", frontCalls === "[]", frontCalls);
  await cdp.eval(`(() => { const b = document.querySelector('[data-reveal]'); b && b.click(); return 'revealed'; })()`);
  await wait(1000);
  const backCalls = await cdp.eval(`JSON.stringify(window.__speakCalls || [])`);
  const calls = JSON.parse(backCalls || "[]");
  check("翻面（按钮出现）自动发音 1 次", calls.length === 1 && calls[0] === "moral", backCalls);

  // ---------- D. 深色模式发音按钮可见度（真实主题路径）----------
  await cdp.eval(`(async () => { await window.settingsAPI.set("theme", "mode", "dark"); return "dark set"; })()`);
  await cdp.eval("window.location.reload()");
  await wait(3000);
  await navReview();
  await wait(1500);
  check("深色下显示词卡", (await frontGuard("moral")) === "ok", await frontGuard("moral"));
  await cdp.eval(`(() => { const b = document.querySelector('[data-reveal]'); b && b.click(); return 'revealed'; })()`);
  await wait(700);
  const vis = await cdp.eval(`JSON.stringify((() => {
    const btn = document.querySelector('.vocab-speak-btn');
    if (!btn) return { missing: true };
    const cs = getComputedStyle(btn);
    const lum = (rgb) => {
      const m = String(rgb).match(/[\\d.]+/g) || [255, 255, 255];
      const [r, g, b] = m.slice(0, 3).map(Number);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };
    const base = lum(cs.backgroundColor);
    return { border: cs.borderColor, color: cs.color, bg: cs.backgroundColor, dBorder: Math.abs(lum(cs.borderColor) - base), dColor: Math.abs(lum(cs.color) - base) };
  })())`);
  const visObj = JSON.parse(vis || "{}");
  check("深色档发音按钮在场", visObj.missing !== true, vis);
  check("深色档描边与底色亮度差 > 0.08", visObj.dBorder !== undefined && visObj.dBorder > 0.08, vis);
  check("深色档图标与底色亮度差 > 0.3", visObj.dColor !== undefined && visObj.dColor > 0.3, vis);

  // 收尾：恢复浅色（不影响截图判读路径的一致性说明）+ 清理在 finally 软删
} catch (err) {
  fail++;
  console.log(`  ✗ 套件异常 | ${err && err.message ? err.message : String(err)}`);
} finally {
  try {
    if (cdp && seededIds.length) {
      await cdp.eval(`(async () => { for (const id of ${JSON.stringify(seededIds)}) { try { await window.cardsAPI.remove(id); } catch (e) {} } return 'cleaned'; })()`);
    }
  } catch { /* 清理尽力而为 */ }
  killProc(electron);
  try {
    mockServer.close();
  } catch { /* ignore */ }
}

console.log(`\\nD99 review GUI: ${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
