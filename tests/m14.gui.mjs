// v45（M14-UM1）用户记忆设置区 GUI 端到端（CDP 驱动真实应用，自启自关；node tests/m14.gui.mjs）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-m14-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
// 覆盖（§6.7.1/§6.7.2；管线与备份由 tests/m14.test.cjs 锁定）：
//   sec-memory 挂载 + 说明文案 + 文件路径 + 默认关 → 首次开启一次性说明 → 补处理预估（可暂不）
//   → 无 Key 可读降级（立即整理给原因，不出空壳进度）→ 重置二次确认 → 关闭
//   → 重启不丢（开关与 introAcked；再开启不再弹说明）→ 清理
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9230";
const USER_DATA = path.join(ROOT, "tests", "tmp-m14-userdata");
const MARK = "M14GUITEST";

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
  const out = openSync(path.join(ROOT, "tests", "m14.gui.log"), "a");
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

async function openSettings(page) {
  await page.eval(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.title?.includes("设置")); b?.click(); return !!b; })()`);
  await wait(800);
}

async function memState(page) {
  const raw = await page.eval(`JSON.stringify({
    section: !!document.querySelector("#sec-memory"),
    text: document.querySelector("#sec-memory")?.textContent || "",
    segButtons: [...(document.querySelector("#sec-memory")?.querySelectorAll(".seg-tabs-sm button") || [])].map((b) => ({ t: b.textContent.trim(), active: b.classList.contains("active") })),
    introOpen: (document.querySelector("#sec-memory")?.textContent || "").includes("开启用户记忆前请了解"),
    previewOpen: (document.querySelector("#sec-memory")?.textContent || "").includes("补处理预估"),
    notice: document.querySelector("#sec-memory .ai-test-fail")?.textContent || "",
    okNotice: document.querySelector("#sec-memory .ai-test-ok")?.textContent || "",
    dirText: [...(document.querySelector("#sec-memory")?.querySelectorAll("span.mono") || [])].map((x) => x.textContent).join(" | ")
  })`);
  return JSON.parse(raw || "{}");
}

try {
  try {
    execSync("taskkill /IM electron.exe /F", { stdio: "ignore" });
  } catch {
    /* 无残留 */
  }
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true }); // 全新库（自清场）
  fs.rmSync(path.join(ROOT, "tests", "m14.gui.log"), { force: true });
  electron = spawnApp();
  const main = await connectTarget((u) => u.includes("index.html"), "主窗口");
  await wait(2500);

  // 0. 启动 + 播种 3 条日记（补处理预估的数据源）
  const booted = await main.eval(`!!document.querySelector("#root")`);
  check("应用启动（根节点挂载）", booted === true, booted);
  const seeded = await main.eval(`(async () => {
    for (const t of ["${MARK} 日记一：项目进展", "${MARK} 日记二：读书感悟", "${MARK} 日记三：运动记录"]) {
      await window.journalAPI.create({ contentMarkdown: t });
    }
    return (await window.journalAPI.list({ limit: 100 })).entries.length;
  })()`);
  check("播种 3 条日记", seeded === 3, JSON.stringify(seeded));

  // 1. sec-memory 挂载：说明文案 + 文件位置 + 默认关
  await openSettings(main);
  const st1 = await memState(main);
  check("设置页含「用户记忆」区块", st1.section === true, st1.section);
  check("说明文案四件事（发送什么/何时/发到哪里/不上传遥测）",
    st1.text.includes("日记新增/改动") && st1.text.includes("防抖") && st1.text.includes("自己配置的 AI 模型") && st1.text.includes("不上传遥测"), st1.text.slice(0, 200));
  check("文件位置显示 memory/ 全路径", String(st1.dirText).includes(path.join(USER_DATA, "memory")), st1.dirText);
  check("开关默认关闭（「关」高亮）", st1.segButtons.length === 2 && st1.segButtons[1].active === true, JSON.stringify(st1.segButtons));

  // 2. 首次开启 → 一次性说明（introAcked 门控）
  await main.eval(clickByText("#sec-memory .seg-tabs-sm button", "开"));
  await wait(600);
  const st2 = await memState(main);
  check("首次开启弹一次性说明", st2.introOpen === true, st2.introOpen);
  check("说明含路径与可随时关闭", st2.text.includes("可随时关闭") && st2.text.includes("memory"), st2.text.slice(0, 300));

  // 3. 确认 → 补处理预估（3 条待整理），可暂不
  await main.eval(clickByText("#sec-memory button", "已知悉，开启"));
  await wait(900);
  const st3 = await memState(main);
  check("说明关闭且开关已生效（「开」高亮）", st3.introOpen === false && st3.segButtons[0].active === true, JSON.stringify(st3.segButtons));
  check("补处理预估出现且条数正确", st3.previewOpen === true && st3.text.includes("待整理日记 3 条"), st3.text.slice(-400));
  await main.eval(clickByText("#sec-memory button", "暂不"));
  await wait(400);

  // 4. 无 Key 可读降级：立即整理给出原因（不出空壳进度、不静默）
  await main.eval(clickByText("#sec-memory button", "立即整理"));
  await wait(900);
  const st4 = await memState(main);
  check("无 Key 时立即整理给出可读原因", String(st4.notice).includes("未配置 AI Key"), st4.notice);
  check("无 Key 不显示补处理进度", !st4.text.includes("补处理：已整理"), st4.text.slice(-200));

  // 5. 重置记忆：二次确认 + 完成提示
  await main.eval(clickByText("#sec-memory button", "清空记忆文件"));
  await wait(300);
  const st5a = await memState(main);
  check("重置需二次确认", st5a.text.includes("确认清空") && st5a.text.includes("只删除记忆，不影响日记与卡片"), st5a.text.slice(-300));
  await main.eval(clickByText("#sec-memory button", "确认清空"));
  await wait(900);
  const st5b = await memState(main);
  check("重置完成提示", String(st5b.okNotice).includes("记忆已清空"), st5b.okNotice);
  const memDirExists = fs.existsSync(path.join(USER_DATA, "memory", "core.md"));
  check("重置后脚手架已重建", memDirExists === true, memDirExists);

  // 6. 关闭开关
  await main.eval(clickByText("#sec-memory .seg-tabs-sm button", "关"));
  await wait(500);

  // 7. 重启不丢（开关与 introAcked 持久化；再开启不弹说明）
  electron.kill();
  await wait(1500);
  try {
    execSync("taskkill /IM electron.exe /F", { stdio: "ignore" });
  } catch {
    /* 忽略 */
  }
  await wait(1000);
  electron = spawnApp();
  const main2 = await connectTarget((u) => u.includes("index.html"), "主窗口（重启后）");
  await wait(2500);
  const cfgPersisted = await main2.eval(`(async () => JSON.stringify(await window.settingsAPI.get("app", "memory", null)))()`);
  const cfg = JSON.parse(cfgPersisted || "{}");
  check("重启后开关仍为关、introAcked 保留", cfg && cfg.enabled === false && cfg.introAcked === true, cfgPersisted);
  await openSettings(main2);
  await main2.eval(clickByText("#sec-memory .seg-tabs-sm button", "开"));
  await wait(700);
  const st7 = await memState(main2);
  check("再次开启不再弹一次性说明（introAcked 生效）", st7.introOpen === false && st7.segButtons[0].active === true, JSON.stringify({ intro: st7.introOpen, seg: st7.segButtons }));

  // 8. 清理：删测试日记 + 复位设置
  await main2.eval(`document.querySelector(".modal-close")?.click()`);
  await wait(400);
  const cleaned = await main2.eval(`(async () => {
    const res = await window.journalAPI.list({ limit: 500 });
    let n = 0;
    for (const e of res.entries) {
      if (String(e.contentMarkdown || "").includes("${MARK}")) { await window.journalAPI.remove(e.id); n++; }
    }
    await window.settingsAPI.set("app", "memory", null);
    return n;
  })()`);
  check("测试条目与设置清理完成（3 条）", cleaned === 3, cleaned);

  console.log(`\nM14 GUI: ${pass} 通过 / ${fail} 失败`);
} catch (e) {
  fail++;
  console.log("M14 GUI 异常", e);
} finally {
  try {
    electron?.kill();
  } catch {
    /* 忽略 */
  }
  try {
    execSync("taskkill /IM electron.exe /F", { stdio: "ignore" });
  } catch {
    /* 忽略 */
  }
  try {
    fs.rmSync(USER_DATA, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
  process.exit(fail > 0 ? 1 : 0);
}
