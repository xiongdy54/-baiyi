// 皮肤引擎 v2 · 基线/对照截图（P0-11）：8 视图 × 浅/深 → <outDir>
// @runtime: node  @gui: true  @id: SKINSHOT  @timeout: 300
// 用法：先 npm run build，再 node tests/tmp-skin-baseline-shot.mjs <outDirName>
//   outDirName 缺省 __skin-baseline__；对照轮传 __skin-check__。
// 对比：node tests/lib/png-pixel-diff.mjs tests/__skin-baseline__ tests/<outDirName>
// 状态口径：1 本粘贴书；新库学习者模型默认开（六签含「推荐」）；截图前等 1s（VT/入场动画完毕）。
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9541";
const OUT = path.join(ROOT, "tests", process.argv[2] || "__skin-baseline__");
// 第三参数 = 皮肤 id（缺省 none=默认皮肤基线；"claude" → 播种时写 settings.json app.skinId，启动即 Claude 外观）
const SKIN = process.argv[3] && process.argv[3] !== "none" ? process.argv[3] : null;
const USER_DATA = path.join(ROOT, "tests", "tmp-skin-userdata");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let electron = null;

async function connect() {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    try {
      const l = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json())
        .filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
      const t = l.find((x) => (x.url || "").includes("index.html"));
      if (t) {
        const ws = new globalThis.WebSocket(t.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
        let id = 0;
        const pending = new Map();
        ws.addEventListener("message", (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        });
        const send = (method, params = {}) =>
          new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
        const evalJS = async (expr) => {
          const r = await send("Runtime.evaluate", { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true });
          return r.result?.result?.value;
        };
        await send("Page.enable");
        return { send, eval: evalJS };
      }
    } catch { /* 端口未就绪 */ }
    await wait(1000);
  }
  throw new Error("CDP 连接失败");
}

async function shot(page, name) {
  await page.eval(`document.activeElement instanceof HTMLElement && document.activeElement.blur(); return 1;`);
  await wait(150);
  const r = await page.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.result.data, "base64"));
  console.log("shot →", name);
}

const nav = (label) =>
  `[...document.querySelectorAll('.topbar-nav .nav-item')].find(b => b.textContent.trim() === '${label}')?.click(); return 1;`;

try {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(900);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const log = openSync(path.join(ROOT, "tests", "tmp-skin-shot.log"), "w");

  // 1) 播种（Windows 句柄释放延迟：rmSync 后立即 spawn 可能 EBUSY——失败重试，间隔让杀毒/句柄释放）
  let seeded = false, seedErr = null;
  for (let i = 0; i < 3 && !seeded; i++) {
    if (i > 0) await wait(1800);
    try {
      fs.rmSync(USER_DATA, { recursive: true, force: true });
      await new Promise((res, rej) => {
        const p = spawn("npx", ["electron", "tests/skin-baseline.seed.cjs"], {
          cwd: ROOT, shell: true, stdio: ["ignore", log, log],
          env: { ...process.env, M7_TEST_USERDATA: USER_DATA },
        });
        p.on("exit", (c) => (c === 0 ? res() : rej(new Error("seed 失败 " + c))));
      });
      seeded = true;
    } catch (e) {
      seedErr = e;
    }
  }
  if (!seeded) throw seedErr;
  // 皮肤预置（P4-6）：写 settings.json app.skinId，启动首帧即目标皮肤外观
  if (SKIN) {
    const sp = path.join(USER_DATA, "settings.json");
    const conf = fs.existsSync(sp) ? JSON.parse(fs.readFileSync(sp, "utf8")) : {};
    conf.app = { ...(conf.app || {}), skinId: SKIN };
    fs.writeFileSync(sp, JSON.stringify(conf, null, 2));
    console.log("skin 预置 →", SKIN);
  }
  await wait(600);

  // 2) 主应用
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", log, log],
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA },
  });
  const page = await connect();
  await wait(5200);
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await wait(900);

  const openSettings = async () => {
    await page.eval(`[...document.querySelectorAll('button[title="设置"]')][0].click(); return 1;`);
    await wait(800);
  };
  const closeSettings = async () => {
    await page.eval(`document.activeElement?.blur(); return 1;`);
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await wait(600);
  };
  const gotoShelfFirst = async () => {
    // 先回书架（从任意视图），再点书进 reader
    await page.eval(nav("书架"));
    await wait(1100);
  };

  const shots = async (mode) => {
    await shot(page, `shelf-${mode}`);
    await page.eval(nav("摘录")); await wait(1100);
    await shot(page, `queue-${mode}`);
    await page.eval(nav("复习")); await wait(1100);
    await shot(page, `review-${mode}`);
    const hasNext = await page.eval(`return [...document.querySelectorAll('.topbar-nav .nav-item')].some(b => b.textContent.trim() === '推荐');`);
    if (String(hasNext) === "true") {
      await page.eval(nav("推荐")); await wait(1100);
      await shot(page, `next-${mode}`);
    } else {
      console.log(`  ! ${mode}: 「推荐」页签不在场，跳过 next`);
    }
    await page.eval(nav("卡片")); await wait(1100);
    await shot(page, `browse-${mode}`);
    await page.eval(nav("数据")); await wait(2400);
    await shot(page, `stats-${mode}`);
    await page.eval(nav("书架")); await wait(1100);
    await openSettings();
    await shot(page, `settings-${mode}`);
    await closeSettings();
    // reader：点第一张书卡
    await page.eval(`document.querySelector('.bookshelf-grid .book-card')?.click(); return 1;`);
    await wait(1800);
    await shot(page, `reader-${mode}`);
  };

  await shots("light");

  // 切深色：设置页 seg-tabs「深色」
  await gotoShelfFirst();
  await openSettings();
  await page.eval(`[...document.querySelectorAll('.seg-tabs button')].find(b => b.textContent.trim() === '深色')?.click(); return 1;`);
  await wait(700);
  await closeSettings();
  await shots("dark");

  console.log("DONE →", OUT);
  process.exit(0);
} catch (e) {
  console.error("异常", e);
  process.exit(1);
} finally {
  try { electron?.kill(); } catch { /* ignore */ }
  await wait(800);
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* ignore */ }
}
