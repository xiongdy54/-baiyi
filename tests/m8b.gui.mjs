// v40（M8-B）AI 洞察 GUI 端到端（CDP 驱动真实应用，自启自关；node tests/m8b.gui.mjs）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-m8b-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
// 覆盖（§9.1 M8-B 验收的 GUI 部分；db 层由 tests/m8b.test.cjs 锁定）：
//   日记页「洞察」按钮 → 面板挂载 → 无 Key 可读降级（非静默失败）→ 装配证据包（范围 30d）
//   → 发送前预览（日记条数/token 预算）→ 无 Key 时「发送」置灰 → 重选范围回路 → 面板关闭
// 真实 LLM 调用不入自动化（Key/成本/不可确定性）：输出渲染与反馈落表由 db 层 + 隔离实例人工冒烟。
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9228";
const USER_DATA = path.join(ROOT, "tests", "tmp-m8b-userdata");
const MARK = "M8BGUI 今天在思考刻意练习与恒温器反馈回路的相似之处";

// v48.114（D159）：AI 洞察随日记暂时移除（代码保留待重实装，GUIDE §6.5/§4.13 冻结契约）——本套件随功能搁置。
// 重实装（App 洞察入口回插 + 日记页恢复）后删除下方早退即可恢复全量断言；db 层 m8b.test.cjs 不受影响。
console.log("·· m8b.gui 搁置：AI 洞察随日记暂时移除（D159，v48.114）——0 通过 / 0 失败");
process.exit(0);

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
  const out = openSync(path.join(ROOT, "tests", "m8b.gui.log"), "a");
  return spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT,
    shell: true,
    stdio: ["ignore", out, out],
    detached: false,
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
}

// §J P0：markdown 编辑器（ProseMirror contenteditable）内容写入——聚焦后 selectAll+insertText
// （execCommand 走 beforeinput 管道，ProseMirror 原生处理；等价旧 textarea 的 setValue+input）
const setPM = (sel, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return false;
  el.focus();
  document.execCommand("selectAll", false, null);
  document.execCommand("insertText", false, ${JSON.stringify(value)});
  return true;
})()`;
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
  fs.rmSync(path.join(ROOT, "tests", "m8b.gui.log"), { force: true });
  electron = spawnApp();
  const main = await connectTarget((u) => u.includes("index.html"), "主窗口");
  await wait(2500);

  // 0. 启动 + 日记页写一条（洞察的输入材料）
  check("应用启动", (await main.eval(`!!document.querySelector("#root")`)) === true, "root");
  await main.eval(clickByText(".nav-item", "日记"));
  await wait(900);
  await main.eval(setPM(".journal-composer .ProseMirror", MARK));
  await wait(400); // 等 React 状态回流（PM onChange → setState），否则「记下」按钮仍持旧 disabled 态
  await main.eval(clickByText(".journal-composer .btn-primary", "记下"));
  await wait(1200);
  check("日记条目已写入", (await main.eval(`(document.querySelector(".journal-entry-md")?.textContent || "").includes("刻意练习")`)) === true, "entry");

  // 1. 「洞察」按钮 → 面板挂载（按需触发入口）
  const insightBtn = await main.eval(clickByText(".journal-toolbar .btn", "洞察"));
  check("日记页「洞察」按钮存在并可点击", insightBtn === true, insightBtn);
  await wait(700);
  check("洞察面板挂载", (await main.eval(`!!document.querySelector(".ins-panel")`)) === true, "ins-panel");
  check("标题=洞察·日记×已学知识", (await main.eval(`document.querySelector(".ins-panel h2")?.textContent || ""`)).includes("洞察"), "h2");

  // 2. 无 Key 可读降级（全新库未配 AI 服务）——非静默失败（§9.1 M8-B 验收）
  const degrade = await main.eval(`[...document.querySelectorAll(".ins-panel .kmg-msg")].map((x) => x.textContent).join(" | ")`);
  check("无 Key 给出可读降级说明", String(degrade).includes("未配置 AI 服务 Key"), degrade);

  // 3. 装配证据包（默认 30d 范围）→ 发送前预览
  await main.eval(clickByText(".ins-panel .btn", "装配证据包"));
  await wait(1000);
  const pkgState = await main.eval(`JSON.stringify({
    list: document.querySelector(".ins-pkg-list")?.textContent || "",
    diary: [...document.querySelectorAll(".ins-diary-preview p")].map((x) => x.textContent).join(" | "),
    sendDisabled: !!document.querySelector(".ins-actions .btn-primary")?.disabled,
    sendText: document.querySelector(".ins-actions .btn-primary")?.textContent || ""
  })`);
  const ps = JSON.parse(pkgState || "{}");
  check("预览列出日记 1 条", String(ps.list).includes("日记 1 条"), pkgState);
  check("预览含 token 预算行", /预估 token/.test(String(ps.list)), pkgState);
  check("预览含日记原文摘要（隐私透明）", String(ps.diary).includes("刻意练习"), pkgState);
  check("无 Key 时「发送」置灰且文案可读", ps.sendDisabled === true && String(ps.sendText).includes("未配置 AI Key"), pkgState);

  // 4. 重选范围回路 + 自定义范围出现日期框
  await main.eval(clickByText(".ins-panel .btn", "重选范围"));
  await wait(500);
  await main.eval(clickByText(".ins-panel .seg-tabs button", "自定义"));
  await wait(400);
  check("自定义范围出现日期输入", (await main.eval(`document.querySelectorAll(".ins-dates input").length`)) === 2, "dates");
  await main.eval(clickByText(".ins-panel .seg-tabs button", "近 7 天"));
  await main.eval(clickByText(".ins-panel .btn", "装配证据包"));
  await wait(1000);
  check("7 天范围重新装配成功（含今天那条）", (await main.eval(`(document.querySelector(".ins-pkg-list")?.textContent || "").includes("日记 1 条")`)) === true, "rebuild");

  // 5. 关闭面板 → 日记页仍在
  await main.eval(`document.querySelector(".ins-panel .modal-close")?.click()`);
  await wait(500);
  check("面板关闭且日记页仍在", (await main.eval(`!document.querySelector(".ins-panel") && !!document.querySelector(".journal")`)) === true, "closed");

  console.log(`\nM8B GUI 完成：${pass} 通过 / ${fail} 失败`);
} catch (err) {
  fail++;
  console.error("M8B GUI 异常：", err);
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
