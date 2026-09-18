// v43（K2-B）KnowledgeLint + LKM scope 播种 GUI 端到端（CDP 驱动真实应用，自启自关；node tests/k2b.gui.mjs）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-k2b-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
// 覆盖（数据层契约由 tests/k2b.test.cjs 锁定）：
//   知识点页签「质量检查」按钮 → K4/K7/K8 结果渲染（可跳详情）→ 收起；
//   渲染层可取到 4 个新 scope 的 v1 模板（promptsAPI）→ LKM scope 播种到达前端。
// 真实 AI 调用不入自动化（Key/成本/不确定性）；出层契约裁决由 db 层测试覆盖。
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9228";
const USER_DATA = path.join(ROOT, "tests", "tmp-k2b-userdata");

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
  const out = openSync(path.join(ROOT, "tests", "k2b.gui.log"), "a");
  return spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT,
    shell: true,
    stdio: ["ignore", out, out],
    detached: false,
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
}

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
  fs.rmSync(path.join(ROOT, "tests", "k2b.gui.log"), { force: true });
  electron = spawnApp();
  const main = await connectTarget((u) => u.includes("index.html"), "主窗口");
  await wait(2500);
  main.eval(`window.confirm = () => true`);

  // 0. 造数据：域一致 KP（2 张同域卡 + 一条关系边）、孤立 KP（零卡零边）、关系邻居（承接边）
  const seeded = await main.eval(`(async () => {
    const ok = await window.knowledgeAPI.createPoint({ canonicalLabel: "K2BGUI 一致概念", domainId: "51", aliases: [] });
    const lone = await window.knowledgeAPI.createPoint({ canonicalLabel: "K2BGUI 孤立概念", domainId: "51", aliases: [] });
    const neighbor = await window.knowledgeAPI.createPoint({ canonicalLabel: "K2BGUI 关系邻居", domainId: "51", aliases: [] });
    for (const f of ["K2BGUI 甲卡", "K2BGUI 乙卡"]) {
      await window.cardsAPI.create({ noteText: f, cardType: "qa", frontMarkdown: f, backMarkdown: "答案", priority: 50, tags: [], knowledgePointId: "K2BGUI 一致概念", domain: ["51"] });
    }
    await window.knowledgeAPI.createRelation({ fromKnowledgePointId: ok.id, toKnowledgePointId: neighbor.id, relationType: "related_to", source: "user" });
    return !!ok?.id && !!lone?.id && !!neighbor?.id;
  })()`);
  check("种子数据创建成功（KP×2 + 卡×2 + 关系边）", seeded === true, seeded);
  await main.eval(clickByText(".nav-item", "卡片"));
  await wait(900);
  await main.eval(clickByText(".seg-tabs button", "知识点"));
  await wait(800);
  check("知识地基管理面板挂载", (await main.eval(`!!document.querySelector(".kmg-wrap")`)) === true, "kmg-wrap");

  // 1. 「质量检查」按钮存在并可运行：孤立 KP 命中 K8，一致 KP 零问题
  check("工具栏含「质量检查」按钮", (await main.eval(clickByText(".kmg-wrap .btn", "质量检查"))) === true, "btn");
  await wait(1500);
  const lintText = await main.eval(`document.querySelector(".kmg-lint-list")?.textContent || ""`);
  check("检查结果区渲染 K8 命中（孤立概念）", String(lintText).includes("K8") && String(lintText).includes("K2BGUI 孤立概念"), lintText);
  check("域一致的 KP 未被误报", !String(lintText).includes("K2BGUI 一致概念"), lintText);
  check("结果带非阻断说明（info 提示）", String(lintText).includes("提示"), lintText);

  // 2. 点结果里的 KP 名 → 右列跳到该知识点详情
  await main.eval(`(() => { const b = [...document.querySelectorAll(".kmg-lint-list .journal-link")].find((x) => x.textContent.includes("K2BGUI 孤立概念")); b?.click(); return !!b; })()`);
  await wait(600);
  check("点击 lint 行跳转知识点详情", String(await main.eval(`document.querySelector(".kmg-detail-head h3")?.textContent || ""`)).includes("K2BGUI 孤立概念"), "detail");

  // 3. 收起结果区
  await main.eval(clickByText(".journal-link", "收起"));
  await wait(400);
  check("「收起」清空结果区", (await main.eval(`!!document.querySelector(".kmg-lint-list")`)) === false, "lint-list");

  // 4. 4 个新 LKM scope 的 v1 模板已到达渲染层（promptsAPI 运行时取）
  const scopesOk = await main.eval(`(async () => {
    const want = ["material-difficulty", "knowledge-probe", "frontier-explain", "structure-analogy"];
    const out = [];
    for (const s of want) {
      const t = await window.promptsAPI.get(s);
      out.push(t && t.version === 1 && t.content.length > 200);
    }
    return out.join(",");
  })()`);
  check("4 个 LKM scope v1 经 promptsAPI 可取（播种到达前端）", scopesOk === "true,true,true,true", scopesOk);

  console.log(`\nK2B GUI 完成：${pass} 通过 / ${fail} 失败`);
} catch (err) {
  fail++;
  console.error("K2B GUI 异常：", err);
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
