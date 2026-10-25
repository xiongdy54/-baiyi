// v41（K2-A）AI 抽取归一 GUI 端到端（CDP 驱动真实应用，自启自关；node tests/k2a.gui.mjs）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-k2a-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
// 覆盖（D38 触发与确认的 GUI 面；数据层由 tests/k2a.test.cjs 锁定）：
//   知识点页签「AI 整理（N 簇待归一）」按钮 → 无 Key 可读降级 → 扫描归一建议出提案 → 一键「全部接受」→ KP 落地
// 真实 AI 调用不入自动化（Key/成本/不确定性）：裁决器与幂等由 db 层测试覆盖。
import { spawn } from "node:child_process";
import killProc from "./lib/killProc.cjs";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9228";
const USER_DATA = path.join(ROOT, "tests", "tmp-k2a-userdata");
const LEGACY = "K2AGUI 待归一概念";

let pass = 0;
let fail = 0;
function check(name, cond, actual) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 240)}`);
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let electron = null;

async function listTargets() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  return list.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
}

async function connectTarget(match, label, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const t = (await listTargets()).find((x) => match(x.url || ""));
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
        const send = (method, params = {}) =>
          new Promise((res) => {
            const mid = ++id;
            pending.set(mid, res);
            ws.send(JSON.stringify({ id: mid, method, params }));
          });
        const evalJS = async (expr) => {
          const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails)
            return "EXC: " + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)).slice(0, 300);
          return r.result?.result?.value;
        };
        return { ws, send, eval: evalJS, url: t.url };
      }
    } catch {
      /* 端口未就绪 */
    }
    await wait(1000);
  }
  throw new Error(`CDP 连接失败：${label}`);
}

function spawnApp() {
  const out = openSync(path.join(ROOT, "tests", "k2a.gui.log"), "a");
  return spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT,
    shell: true,
    stdio: ["ignore", out, out],
    detached: process.platform !== "win32",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
}

const clickByText = (sel, text) =>
  `(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.includes(${JSON.stringify(text)})); b?.click(); return !!b; })()`;

try {
  killProc(electron);
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true }); // 全新库（自清场）
  fs.rmSync(path.join(ROOT, "tests", "k2a.gui.log"), { force: true });
  electron = spawnApp();
  const main = await connectTarget((u) => u.includes("index.html"), "主窗口");
  await wait(2500);
  main.eval(`window.confirm = () => true`);

  // 0. 造一张带「有语义旧值」的卡（模拟手工制卡的知识点分组字段），并进知识点页签
  const created = await main.eval(`(async () => {
    const c = await window.cardsAPI.create({ noteText: "K2AGUI 卡", cardType: "qa", frontMarkdown: "K2AGUI 卡面内容", backMarkdown: "答案", priority: 50, tags: [], knowledgePointId: ${JSON.stringify(LEGACY)} });
    return !!c?.id;
  })()`);
  check("带旧值知识点的卡创建成功", created === true, created);
  await main.eval(clickByText(".nav-item", "卡片"));
  await wait(900);
  await main.eval(clickByText(".seg-tabs button", "知识点"));
  await wait(800);
  check("知识地基管理面板挂载", (await main.eval(`!!document.querySelector(".kmg-wrap")`)) === true, "kmg-wrap");

  // 1. AI 整理按钮存在且显示待归一簇数（挂载时经 kpClusters 统计）
  const aiBtn = await main.eval(`[...document.querySelectorAll(".kmg-wrap .btn")].map((b) => b.textContent).join(" | ")`);
  check("工具栏含「AI 整理」与簇计数", String(aiBtn).includes("AI 整理") && String(aiBtn).includes("簇待归一"), aiBtn);

  // 2. 无 Key 可读降级（全新库未配 AI 服务）
  await main.eval(clickByText(".kmg-wrap .btn", "AI 整理"));
  await wait(2500);
  const notice = await main.eval(`document.querySelector(".kmg-msg")?.textContent || ""`);
  check("无 Key 时给出可读降级说明（非静默失败）", String(notice).includes("未配置 AI 服务 Key"), notice);

  // 3. 本地扫描归一建议（有语义旧值）→ 决策卡
  await main.eval(clickByText(".kmg-wrap .btn", "扫描归一建议"));
  await wait(1200);
  const propText = await main.eval(`[...document.querySelectorAll(".kmg-prop-card")].map((x) => x.textContent).join(" | ")`);
  check("扫描出提案决策卡（含旧值与卡面预览）", String(propText).includes(LEGACY) && String(propText).includes("K2AGUI 卡面内容"), propText);

  // 4. 一键「全部接受」→ 正式 KP 落地
  const acceptAllBtn = await main.eval(clickByText(".kmg-sec .btn", "全部接受"));
  check("「全部接受」按钮存在", acceptAllBtn === true, acceptAllBtn);
  await wait(1500);
  const kpRows = await main.eval(`[...document.querySelectorAll(".kmg-row-label")].map((x) => x.textContent).join(" | ")`);
  check("全部接受后正式 KP 出现在列表", String(kpRows).includes(LEGACY), kpRows);
  const pendingAfter = await main.eval(`document.querySelector(".kmg-sec")?.textContent || ""`);
  check("pending 清零", String(pendingAfter).includes("pending 0"), pendingAfter);

  console.log(`\nK2A GUI 完成：${pass} 通过 / ${fail} 失败`);
} catch (err) {
  fail++;
  console.error("K2A GUI 异常：", err);
} finally {
  killProc(electron);
  await wait(800);
  try {
    fs.rmSync(USER_DATA, { recursive: true, force: true });
  } catch {
    /* 清理失败不阻塞报告 */
  }
  process.exit(fail > 0 ? 1 : 0);
}
