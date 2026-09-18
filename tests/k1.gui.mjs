// v40（K1）知识地基 GUI 端到端（CDP 驱动真实应用，自启自关；node tests/k1.gui.mjs）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-k1-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
// 覆盖（§9.1 K1-4 最小管理面；db 层由 tests/k1.test.cjs 锁定）：
//   卡片页「知识点」页签 → 新建 KP → 加别名 → 建关系 → 合并（确认制）→ 解除合并 →
//   旧字段归一建议扫描（卡带 legacy knowledge_point_id）→ 提案接受成正式 KP → 行详情显示知识点
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9228";
const USER_DATA = path.join(ROOT, "tests", "tmp-k1-userdata");
const KP_A = "K1GUI 负反馈调节";
const KP_B = "K1GUI 恒温器";
const LEGACY = "K1GUI 未归一知识点";

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
  const out = openSync(path.join(ROOT, "tests", "k1.gui.log"), "a");
  return spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT,
    shell: true,
    stdio: ["ignore", out, out],
    detached: false,
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
}

const setValue = (sel, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return false;
  const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
})()`;

const clickByText = (sel, text) =>
  `(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.includes(${JSON.stringify(text)})); b?.click(); return !!b; })()`;

try {
  try {
    execSync("taskkill /IM electron.exe /F", { stdio: "ignore" });
  } catch {
    /* 无残留 */
  }
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true }); // 全新库（自清场）
  fs.rmSync(path.join(ROOT, "tests", "k1.gui.log"), { force: true });
  electron = spawnApp();
  const main = await connectTarget((u) => u.includes("index.html"), "主窗口");
  await wait(2500);
  main.eval(`window.confirm = () => true`); // 合并/删除确认放行（GUI 测试纪律：真实点击 + 确认自动化）

  // 0. 启动 + 导航到 卡片 → 知识点页签
  check("应用启动", (await main.eval(`!!document.querySelector("#root")`)) === true, "root");
  await main.eval(clickByText(".nav-item", "卡片"));
  await wait(900);
  const tabClicked = await main.eval(clickByText(".seg-tabs button", "知识点"));
  check("「知识点」页签存在并可点击", tabClicked === true, tabClicked);
  await wait(600);
  check("知识地基管理面板挂载", (await main.eval(`!!document.querySelector(".kmg-wrap")`)) === true, "kmg-wrap");

  // 1. 新建 KP A
  await main.eval(clickByText(".kmg-wrap .btn", "新建知识点"));
  await wait(300);
  const labeled = await main.eval(setValue('.kmg-form input[placeholder*="知识点名称"]', KP_A));
  check("新建表单可写入名称", labeled === true, labeled);
  await main.eval(clickByText(".kmg-form .btn", "创建"));
  await wait(800);
  check("KP A 出现在列表", (await main.eval(`!![...document.querySelectorAll(".kmg-row-label")].find((x) => x.textContent.includes(${JSON.stringify(KP_A)}))`)) === true, KP_A);

  // 2. 选中 A → 加别名
  await main.eval(clickByText(".kmg-row", KP_A));
  await wait(500);
  await main.eval(setValue('.kmg-detail input[placeholder="添加别名…"]', "negative feedback"));
  await main.eval(clickByText(".kmg-detail .btn", "加别名"));
  await wait(700);
  check("别名 chip 出现", (await main.eval(`!![...document.querySelectorAll(".kmg-chip")].find((x) => x.textContent.includes("negative feedback"))`)) === true, "alias chip");

  // 3. 新建 KP B → 选中 A 建关系 A→B（related_to）
  await main.eval(clickByText(".kmg-wrap .btn", "新建知识点"));
  await wait(300);
  await main.eval(setValue('.kmg-form input[placeholder*="知识点名称"]', KP_B));
  await main.eval(clickByText(".kmg-form .btn", "创建"));
  await wait(800);
  await main.eval(clickByText(".kmg-row", KP_A));
  await wait(400);
  await main.eval(setValue('.kmg-detail input[placeholder="搜索另一端知识点…"]', KP_B));
  await main.eval(clickByText(".kmg-pick-item", KP_B));
  await main.eval(clickByText(".kmg-detail .btn", "建边"));
  await wait(800);
  check("关系边出现在一跳列表", (await main.eval(`!![...document.querySelectorAll(".kmg-rel-row")].find((x) => x.textContent.includes("相关") && x.textContent.includes("恒温器"))`)) === true, "relation row");

  // 4. 合并 B → A（确认制；合并后 B 状态 merged，可解除）
  await main.eval(clickByText(".kmg-row", KP_B));
  await wait(400);
  await main.eval(clickByText(".kmg-detail .btn", "合并到…"));
  await wait(300);
  await main.eval(setValue('.kmg-detail input[placeholder="搜索目标知识点…"]', "负反馈"));
  await wait(300);
  await main.eval(clickByText(".kmg-pick-item", KP_A));
  await main.eval(clickByText(".kmg-detail .btn", "合并进"));
  await wait(900);
  const mergedState = await main.eval(`JSON.stringify({
    notice: document.querySelector(".kmg-msg")?.textContent || "",
    rowMeta: [...document.querySelectorAll(".kmg-row")].map((x) => x.textContent).join(" | ")
  })`);
  const ms = JSON.parse(mergedState || "{}");
  check("合并成功给出提示", String(ms.notice).includes("已合并"), mergedState);
  check("目标 A 别名并入 B 的 label", String(ms.rowMeta).includes("K1GUI 负反馈调节") && String(ms.rowMeta).includes("别名："), mergedState);

  // 5. 解除合并（回滚）
  await main.eval(clickByText(".kmg-row", KP_B));
  await wait(400);
  const unmergeBtn = await main.eval(clickByText(".kmg-detail .btn", "解除合并"));
  check("已合并行显示「解除合并」", unmergeBtn === true, unmergeBtn);
  await main.eval(clickByText(".kmg-detail .btn", "解除合并"));
  await wait(900);
  const unmergedState = await main.eval(`JSON.stringify({
    bRow: [...document.querySelectorAll(".kmg-row")].map((x) => x.textContent).join(" | "),
    aAliases: ""
  })`);
  check("解除合并后 B 恢复独立行", !String(JSON.parse(unmergedState || "{}").bRow).includes("已并入"), unmergedState);

  // 6. 旧字段归一建议：造一张带 legacy knowledge_point_id 的卡 → 扫描 → 决策卡 → 改名接受
  const created = await main.eval(`(async () => {
    const c = await window.cardsAPI.create({ noteText: "K1GUI 卡", cardType: "qa", frontMarkdown: "K1GUI 正面", backMarkdown: "K1GUI 答案", priority: 50, tags: [], knowledgePointId: ${JSON.stringify(LEGACY)} });
    return !!c?.id;
  })()`);
  check("带 legacy knowledge_point_id 的卡创建成功", created === true, created);
  await main.eval(clickByText(".kmg-wrap .btn", "扫描归一建议"));
  await wait(1200);
  const propCard = await main.eval(`JSON.stringify({
    cards: document.querySelectorAll(".kmg-prop-card").length,
    text: [...document.querySelectorAll(".kmg-prop-card")].map((x) => x.textContent).join(" | ")
  })`);
  const pc = JSON.parse(propCard || "{}");
  check("扫描出 create 提案决策卡", Number(pc.cards) >= 1 && String(pc.text).includes("新建建议") && String(pc.text).includes(LEGACY), propCard);
  check("决策卡显示影响卡数与卡面预览（可决策）", String(pc.text).includes("1 张卡") && String(pc.text).includes("受影响卡面预览") && String(pc.text).includes("K1GUI 正面"), propCard);
  // 接受前改名：旧值无语义（AI 簇 ID 场景）→ 修订为正式名称
  await main.eval(setValue('.kmg-prop-card input[placeholder*="正式名称"]', "K1GUI 修订后的名称"));
  await main.eval(clickByText(".kmg-prop-card .btn", "接受"));
  await wait(1200);
  check("接受提案后正式 KP 以修订名称出现在列表", (await main.eval(`!![...document.querySelectorAll(".kmg-row-label")].find((x) => x.textContent.includes("K1GUI 修订后的名称"))`)) === true, "renamed KP");

  // 7. 行详情显示知识点（legacy 值）
  // 说明：步骤 6 直接调 cardsAPI.create（真实链路经 Reader/洞察面板会 emit cards/changed），
  // 此处通过切换视图让 CardBrowser 重挂载拿到最新列表——不是产品缺陷。
  await main.eval(clickByText(".nav-item", "书架"));
  await wait(700);
  await main.eval(clickByText(".nav-item", "卡片"));
  await wait(1200);
  await main.eval(clickByText(".seg-tabs button", "全部卡片"));
  await wait(1200);
  console.log(`  · 行数：${await main.eval(`document.querySelectorAll(".cb-row:not(.cb-row-head)").length`)}`);
  await main.eval(`document.querySelector(".cb-row:not(.cb-row-head)")?.click()`);
  await wait(1400);
  console.log(`  · modal：${await main.eval(`!!document.querySelector(".modal-panel")`)}`);
  const metaText = await main.eval(`[...document.querySelectorAll(".cb-meta dt, .cb-meta dd")].map((x) => x.textContent).join("|")`);
  check("卡片行详情显示「知识点」行（legacy 值）", String(metaText).includes("知识点") && String(metaText).includes(LEGACY), metaText.slice(0, 200));

  console.log(`\nK1 GUI 完成：${pass} 通过 / ${fail} 失败`);
} catch (err) {
  fail++;
  console.error("K1 GUI 异常：", err);
} finally {
  try {
    execSync("taskkill /IM electron.exe /F", { stdio: "ignore" });
  } catch {
    /* 已退出 */
  }
  await wait(800);
  try {
    fs.rmSync(USER_DATA, { recursive: true, force: true });
  } catch {
    /* 清理失败不阻塞报告 */
  }
  process.exit(fail > 0 ? 1 : 0);
}
