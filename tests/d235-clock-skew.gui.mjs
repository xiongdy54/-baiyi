// D235 端到端：设置页置顶通知框的「时钟回拨」提示——现场探测（backup:info.clockSkew 每次现取），
// 自动备份关闭时同样提示；「处理」滚到备份区并闪烁「打开备份文件夹」；未来备份清掉后重开设置页提示消失；
// 建于未来的备份不再掩盖「还没有任何备份 / 已 N 天没有备份」。
// @runtime: node  @tier: 2  @gui: true  @id: D235SKEW  @timeout: 240
// 运行：npm run build 之后 `node tests/d235-clock-skew.gui.mjs`（CDP 驱动 dist 上的真实应用，自启自关）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-d235-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
import { spawn } from "node:child_process";
import killProc from "./lib/killProc.cjs";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9273";
const USER_DATA = path.join(ROOT, "tests", "tmp-d235-userdata");
const BAK = path.join(USER_DATA, "backups");
const SANDBOX = process.platform === "linux" ? ["--no-sandbox"] : [];

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 300)}`); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let electron = null;

async function connect() {
  for (let i = 0; i < 90; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) {
        const ws = new globalThis.WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
        let id = 0;
        const pending = new Map();
        ws.addEventListener("message", (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        });
        const send = (method, params = {}) => new Promise((res) => {
          const mid = ++id; pending.set(mid, res);
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
        const evalJS = async (expr) => {
          const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) return "EXC: " + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)).slice(0, 300);
          return r.result?.result?.value;
        };
        return { ws, send, eval: evalJS };
      }
    } catch { /* 端口未就绪 */ }
    await wait(1000);
  }
  throw new Error("CDP 连接失败");
}

const notices = async (cdp) => JSON.parse(String(await cdp.eval(`JSON.stringify([...document.querySelectorAll(".settings-notice")].map((n) => ({ level: n.getAttribute("data-level"), text: (n.querySelector(".settings-notice-text")?.textContent || "").trim(), hasHandle: [...n.querySelectorAll("button")].some((b) => b.textContent.trim() === "处理") })))`)) || "[]");
async function waitNotices(cdp, pred, ms = 8000) {
  const t0 = Date.now();
  let n = await notices(cdp);
  while (!pred(n) && Date.now() - t0 < ms) { await wait(250); n = await notices(cdp); }
  return n;
}
const openSettings = (cdp) => cdp.eval(`(() => { const b = document.querySelector('button[title="设置"]'); b?.click(); return !!b; })()`);
const SKEW_TEXT = "份备份的时间晚于当前系统时间";

try {
  killProc(electron);
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.mkdirSync(BAK, { recursive: true });
  // 自动备份关闭（旧实现只在启动 30s 后那一轮自动备份里判定——关掉自动备份就永远不提示）
  fs.writeFileSync(path.join(USER_DATA, "settings.json"), JSON.stringify({ app: { autoBackupEnabled: false } }));
  // 一份「建于未来」的自动备份（修改时间 = 当前 + 10 天）：模拟时钟曾被拨快、现已改回
  const futureFile = path.join(BAK, "backup-auto-2099-01-01.zip");
  fs.writeFileSync(futureFile, "not-a-real-zip");
  const fut = new Date(Date.now() + 10 * 86400000);
  fs.utimesSync(futureFile, fut, fut);

  const out = openSync(path.join(ROOT, "tests", "d235-clock-skew.gui.log"), "w");
  electron = spawn("npx", ["electron", ...SANDBOX, ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: process.platform !== "win32",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connect();
  await wait(2500);
  check("应用启动", (await cdp.eval(`!!document.querySelector("#root")`)) === true, "未挂载");

  const info = JSON.parse(String(await cdp.eval(`(async () => JSON.stringify((await window.backupAPI.info()).clockSkew || null))()`)) || "null");
  check("backup:info 现取 clockSkew：suspected、1 份、latestAt≈当前+10 天", info && info.suspected === true && info.count === 1 && Math.abs(info.latestAt - fut.getTime()) < 5000, JSON.stringify(info));

  // ① 打开设置页：自动备份关着也立即出黄条，带份数与最晚时间、有「处理」
  await openSettings(cdp);
  let ns = await waitNotices(cdp, (n) => n.some((x) => x.text.includes(SKEW_TEXT)));
  const skew = ns.find((x) => x.text.includes(SKEW_TEXT));
  check("设置页出现时钟回拨提示（自动备份关闭也提示）", !!skew, JSON.stringify(ns));
  check("提示为黄条（warn）且带份数 1 与最晚日期", skew && skew.level === "warn" && skew.text.includes("有 1 份") && skew.text.includes(`${fut.getFullYear()}-${String(fut.getMonth() + 1).padStart(2, "0")}-${String(fut.getDate()).padStart(2, "0")}`), JSON.stringify(skew));
  check("提示带「处理」按钮", skew && skew.hasHandle === true, JSON.stringify(skew));
  check("建于未来的备份不误报「还没有任何备份」", !ns.some((x) => x.text.includes("还没有任何备份")), JSON.stringify(ns));
  if (process.env.D235_SHOT) {
    // 可选：留一张通知框截图供人工核对排版（D235_SHOT=输出路径）
    await wait(600);
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    if (shot.result?.data) fs.writeFileSync(process.env.D235_SHOT, Buffer.from(shot.result.data, "base64"));
  }

  // ② 「处理」→ 滚到备份区并闪烁「打开备份文件夹」
  await cdp.eval(`(() => { const n = [...document.querySelectorAll(".settings-notice")].find((x) => (x.textContent || "").includes(${JSON.stringify(SKEW_TEXT)})); const b = n && [...n.querySelectorAll("button")].find((x) => x.textContent.trim() === "处理"); b?.click(); return !!b; })()`);
  await wait(900);
  const flash = JSON.parse(String(await cdp.eval(`(() => { const b = document.querySelector('[data-action="open-backup-dir"]'); const sec = document.getElementById("sec-backup"); const r = sec ? sec.getBoundingClientRect() : null; return JSON.stringify({ exists: !!b, label: b ? b.textContent.trim() : "", flashing: !!b && (b.classList.contains("flash-blink") || b.classList.contains("flash-hold")), secTop: r ? Math.round(r.top) : null, vh: window.innerHeight }); })()`)) || "{}");
  check("「打开备份文件夹」按钮带 data-action=open-backup-dir", flash.exists === true && flash.label === "打开备份文件夹", JSON.stringify(flash));
  check("点「处理」后该按钮闪烁引导", flash.flashing === true, JSON.stringify(flash));
  check("备份区已滚入视口", flash.secTop !== null && flash.secTop < flash.vh && flash.secTop > -2000, JSON.stringify(flash));

  // ③ 未来备份清掉（用户核对后删除 / 时间走过）→ 重开设置页提示消失，改提示「还没有任何备份」
  fs.rmSync(futureFile, { force: true });
  await cdp.eval(`(() => { const b = document.querySelector('button[aria-label="关闭设置"]'); b?.click(); return !!b; })()`);
  await wait(1200);
  check("设置页已关闭", (await cdp.eval(`!document.querySelector(".settings-notices") && !document.querySelector('button[aria-label="关闭设置"]')`)) === true, "仍在");
  await openSettings(cdp);
  await wait(500);
  ns = await waitNotices(cdp, (n) => n.some((x) => x.text.includes("还没有任何备份")));
  check("现场消除后不再提示时钟回拨", !ns.some((x) => x.text.includes(SKEW_TEXT)), JSON.stringify(ns));
  check("无任何备份 → 正常提示「还没有任何备份」", ns.some((x) => x.text.includes("还没有任何备份")), JSON.stringify(ns));

  console.log(`\n==== d235-clock-skew.gui：${pass} 通过 / ${fail} 失败 ====`);
  try { cdp.ws.close(); } catch { /* 已断开 */ }
  killProc(electron);
  process.exit(fail > 0 ? 1 : 0);
} catch (e) {
  console.error("FATAL:", e?.message || e);
  killProc(electron);
  process.exit(1);
}
