// D256 聚焦界面 GUI 端到端（CDP 驱动真实应用，自启自关）
// @runtime: system-node  @tier: 2  @gui: true  @id: D256OVERLAY  @timeout: 300
// 运行：npm run build 之后 node tests/overlay-focus.gui.mjs
// 覆盖：复习页「查看原图」真实打开 / 内容自适盒 / 顶部工具栏 / 双空白外部关闭 / 光标随皮肤；
//       设置尺寸不变、紧凑面板不撑大、内容面板按需加宽但不撑高。
import { spawn } from "node:child_process";
import killProc from "./lib/killProc.cjs";
import fs, { openSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9251";
const USER_DATA = path.join(ROOT, "tests", "tmp-d256-userdata");
const PNG_160x90 = "iVBORw0KGgoAAAANSUhEUgAAAKAAAABaCAIAAACwpMoFAAAAoElEQVR42u3RAQ0AAAjDsDtCNjbvA5pMwZrM6nIWABZgARZgARZgAQYswAIswAIswAIMWIAFWIAFWIAFWIABC7AAC7AAC7AAAxZgARZgARZgAQYswAIswAIswAIswIAFWIAFWIAFWIABC7AAC7AAC7AAA7YAsAALsAALsAALMGABFmABFmABFmDAAizAAizAAizAAgxYgAVYgAVYgAX4VwX94ghClYrF/gAAAABJRU5ErkJggg==";

let pass = 0;
let fail = 0;
function check(name, cond, actual) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 360)}`);
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let electron = null;
let cdp = null;
let cardId = null;

async function listTargets() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  return list.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
}

async function connect() {
  for (let i = 0; i < 90; i++) {
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
          if (m.method === "Runtime.exceptionThrown") {
            console.log("RUNTIME EXCEPTION", JSON.stringify(m.params?.exceptionDetails?.exception?.description || m.params).slice(0, 500));
          }
          if (m.id && pending.has(m.id)) {
            pending.get(m.id)(m);
            pending.delete(m.id);
          }
        });
        const send = (method, params = {}) => new Promise((res) => {
          const mid = ++id;
          pending.set(mid, res);
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
        const evalJS = async (expr) => {
          const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
          if (r.result?.exceptionDetails) throw new Error("eval fail: " + JSON.stringify(r.result.exceptionDetails).slice(0, 260));
          return r.result?.result?.value;
        };
        await send("Runtime.enable");
        const shot = async (name) => {
          if (!process.env.D256_SHOTS) return;
          await evalJS(`(() => { for (const a of document.getAnimations()) { try { a.finish(); } catch (e) {} } return 1; })()`);
          const r = await send("Page.captureScreenshot", { format: "png" });
          fs.writeFileSync(path.join(os.tmpdir(), name), Buffer.from(r.result.data, "base64"));
        };
        return { ws, send, eval: evalJS, shot };
      }
    } catch { /* retry */ }
    await wait(1000);
  }
  throw new Error("CDP 连接失败");
}

const clickText = (text, selector = "button") => `(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => b.textContent.trim().includes(${JSON.stringify(text)}));
  if (!el) return "not found";
  el.click();
  return "clicked";
})()`;
const openLightbox = () => cdp.eval(clickText("查看原图"));
async function navTo(label) {
  await cdp.eval(`(() => {
    try { Object.defineProperty(document, "startViewTransition", { value: undefined, configurable: true }); } catch (e) {}
    const n = [...document.querySelectorAll(".nav-item")].find((b) => b.textContent.trim() === ${JSON.stringify(label)});
    n?.click();
    return "nav";
  })()`);
  await wait(1400);
}
const dispatchPointerPair = (downSel, upSel) => `(() => {
  const down = document.querySelector(${JSON.stringify(downSel)});
  const up = document.querySelector(${JSON.stringify(upSel)});
  if (!down || !up) return "missing";
  const init = { bubbles: true, cancelable: true, pointerId: 71, pointerType: "mouse", isPrimary: true, button: 0 };
  down.dispatchEvent(new PointerEvent("pointerdown", { ...init, buttons: 1 }));
  up.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }));
  return "dispatched";
})()`;

try {
  killProc(electron);
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  const out = openSync(path.join(ROOT, "tests", "d256-focus.app.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT,
    shell: true,
    stdio: ["ignore", out, out],
    detached: process.platform !== "win32",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  cdp = await connect();
  await cdp.eval("1");
  await wait(1800);

  const seeded = await cdp.eval(`(async () => {
    const saved = await window.assetsAPI.saveImage("workbench-assets", "png", ${JSON.stringify(PNG_160x90)}, "image-occlusion");
    if (!saved || saved.error || !saved.assetPath) return "ASSET FAIL " + JSON.stringify(saved);
    const c = await window.cardsAPI.create({
      noteText: "FSRSTEST D256 原图入口",
      cardType: "imageOcclusion",
      frontMarkdown: "FSRSTEST D256 图中是什么？",
      backMarkdown: "FSRSTEST D256 答案",
      cardOrd: 0,
      priority: 99,
      tags: [],
      occlusionJson: {
        assetPath: saved.assetPath,
        rects: [{ x: 10, y: 10, w: 30, h: 30, ord: 0 }],
        shapes: [{ ord: 0, kind: "rect", x: 10, y: 10, w: 30, h: 30 }]
      },
      fsrsJson: JSON.stringify({ state: "new", due: Date.parse("2000-01-01"), lapses: 0, reps: 0 })
    });
    return JSON.stringify({ id: c.id, asset: saved.assetPath });
  })()`);
  let seedObj = {};
  try { seedObj = JSON.parse(seeded); } catch { /* fail below */ }
  cardId = seedObj.id || null;
  check("播种图片挖空卡与真实资产", Boolean(cardId && seedObj.asset), seeded);

  await cdp.eval("window.location.reload()");
  await wait(2400);
  await navTo("复习");
  const reviewReady = await cdp.eval(`JSON.stringify({
    face: document.querySelector(".review-front")?.innerText || "",
    viewOriginal: [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "查看原图"),
    judge: Boolean(document.querySelector('[data-testid="review-judge-btn"]'))
  })`);
  check("复习页进入图片卡且原图入口在场", String(reviewReady).includes('"viewOriginal":true') && String(reviewReady).includes('"judge":true'), reviewReady);

  // 紧凑面板保持原尺寸（AI 判答 480px 档）
  await cdp.eval(`document.querySelector('[data-testid="review-judge-btn"]')?.click()`);
  await wait(400);
  const compact = await cdp.eval(`JSON.stringify((() => {
    const p = document.querySelector('.modal-panel');
    if (!p) return { missing: true };
    const r = p.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight, top: Math.round(r.top) };
  })())`);
  const compactObj = JSON.parse(compact || "{}");
  check("紧凑面板不被强行撑大（宽 480px 档）", compactObj.w >= 470 && compactObj.w <= 490 && compactObj.h < compactObj.vh * 0.8 + 2, compact);
  await cdp.eval(`document.querySelector('.modal-close')?.click()`);
  await wait(350);

  // 复习页原图入口：真实渲染
  const clickOriginal = await openLightbox();
  await wait(900);
  const lb = await cdp.eval(`JSON.stringify((() => {
    const root = document.querySelector('.image-lightbox');
    if (!root) return { missing: true, html: document.body.innerText.slice(0, 160) };
    const stage = root.querySelector('.image-lightbox-stage');
    const box = root.querySelector('.image-lightbox-occlusion');
    const img = root.querySelector('.occlusion-img');
    const rr = root.getBoundingClientRect();
    const sr = stage?.getBoundingClientRect();
    const br = box?.getBoundingClientRect();
    return {
      w: Math.round(rr.width), h: Math.round(rr.height), vw: innerWidth, vh: innerHeight,
      stageW: sr ? Math.round(sr.width) : 0, stageH: sr ? Math.round(sr.height) : 0,
      boxW: br ? Math.round(br.width) : 0, boxH: br ? Math.round(br.height) : 0,
      src: img?.getAttribute('src') || "",
      naturalW: img?.naturalWidth || 0,
      naturalH: img?.naturalHeight || 0,
      toolbar: Boolean(root.querySelector('.image-overlay-toolbar')),
      tools: [...root.querySelectorAll('.image-lightbox-tools button')].map((b) => b.textContent.trim() || b.getAttribute('aria-label')),
      cursor: getComputedStyle(root.parentElement).cursor,
      stageCursor: getComputedStyle(stage).cursor,
      imageCursor: getComputedStyle(box).cursor,
      backdropBg: getComputedStyle(root.parentElement).backgroundColor,
      token: getComputedStyle(document.body).getPropertyValue('--overlay-close-cursor').trim()
    };
  })())`);
  const lbObj = JSON.parse(lb || "{}");
  await cdp.shot("d256-lightbox-swiss.png");
  check("点击「查看原图」真实打开 Lightbox", clickOriginal === "clicked" && lbObj.missing !== true && lbObj.src.includes("bookasset:"), clickOriginal + " | " + lb);
  check("Lightbox 近满可用空间（宽高均接近视口）", lbObj.w >= lbObj.vw - 48 && lbObj.h >= lbObj.vh - 48, lb);
  check("图片按 stage contain 放大（16:9 且宽度占满）", lbObj.naturalW > 0 && lbObj.boxW >= lbObj.stageW * 0.94 && Math.abs(lbObj.boxW / lbObj.boxH - 160 / 90) < 0.02, lb);
  check("图片工具栏复刻结构且工具不丢", lbObj.toolbar === true && lbObj.tools.some((x) => String(x).includes("隐藏遮挡") || String(x).includes("显示遮挡")) && lbObj.tools.some((x) => String(x).includes("关闭")), lb);
  check("外部关闭光标 Token 已装配且回退 pointer", String(lbObj.token || "").includes("url(") && /pointer\s*$/.test(String(lbObj.token || "")) && String(lbObj.cursor || "").includes("url("), lb);
  check("图片舞台空白显示关闭光标、图片本体不显示", String(lbObj.stageCursor || "").includes("url(") && !String(lbObj.imageCursor || "").includes("url("), lb);
  check("媒体聚焦层为不透明纸面（无背景文字穿透）", /^rgb\(/.test(String(lbObj.backdropBg || "")), lb);

  // 内容自适盒不能与遮罩分家：百分比点必须落在图片同一位置
  const align = await cdp.eval(`JSON.stringify((() => {
    const box = document.querySelector('.image-lightbox-occlusion').getBoundingClientRect();
    const rect = document.querySelector('.image-lightbox-occlusion svg rect');
    if (!rect) return { missing: true };
    const r = rect.getBoundingClientRect();
    return {
      dx: Math.abs(r.left - (box.left + box.width * 0.10)),
      dy: Math.abs(r.top - (box.top + box.height * 0.10)),
      dw: Math.abs(r.width - box.width * 0.30),
      dh: Math.abs(r.height - box.height * 0.30)
    };
  })())`);
  const alignObj = JSON.parse(align || "{}");
  check("遮罩与图片同一显示盒（百分比误差 ≤2px）", alignObj.dx <= 2 && alignObj.dy <= 2 && alignObj.dw <= 2 && alignObj.dh <= 2, align);

  // 缩放改用显式布局盒：+ 后盒宽增长，− 后回到适合区域
  const beforeZoom = await cdp.eval(`document.querySelector('.image-lightbox-occlusion').getBoundingClientRect().width`);
  await cdp.eval(`document.querySelector('.image-lightbox-tools button[aria-label="放大"]')?.click()`);
  await wait(200);
  const zoomed = await cdp.eval(`document.querySelector('.image-lightbox-occlusion').getBoundingClientRect().width`);
  await cdp.eval(`document.querySelector('.image-lightbox-tools button[aria-label="缩小"]')?.click()`);
  await wait(200);
  const backZoom = await cdp.eval(`document.querySelector('.image-lightbox-occlusion').getBoundingClientRect().width`);
  check("Lightbox 缩放改变布局盒并可回到 fit", zoomed > beforeZoom * 1.05 && Math.abs(backZoom - beforeZoom) <= 1, `${beforeZoom}->${zoomed}->${backZoom}`);

  // 窄窗 / 常规窗口：可用盒随 stage 重算，工具栏与图片都不越界
  const viewportChecks = [];
  for (const [width, height] of [[1600, 1000], [1280, 800], [960, 640]]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await wait(450);
    const probe = await cdp.eval(`JSON.stringify((() => {
      const root = document.querySelector('.image-lightbox')?.getBoundingClientRect();
      const stage = document.querySelector('.image-lightbox-stage')?.getBoundingClientRect();
      const box = document.querySelector('.image-lightbox-occlusion')?.getBoundingClientRect();
      const bar = document.querySelector('.image-overlay-toolbar')?.getBoundingClientRect();
      return {
        vw: innerWidth, vh: innerHeight,
        rootIn: root && root.left >= 0 && root.top >= 0 && root.right <= innerWidth + 1 && root.bottom <= innerHeight + 1,
        barIn: bar && bar.left >= 0 && bar.right <= innerWidth + 1,
        boxIn: box && stage && box.left >= stage.left - 1 && box.right <= stage.right + 1 && box.bottom <= stage.bottom + 1,
        boxW: box ? Math.round(box.width) : 0
      };
    })())`);
    viewportChecks.push(`${width}x${height}:${probe}`);
    if (width === 960) await cdp.shot("d256-lightbox-960.png");
    if (width === 1280) await cdp.shot("d256-lightbox-1280.png");
  }
  check(
    "1600×1000 / 1280×800 / 960×640 下工具栏与图片留在可用视口内",
    viewportChecks.every((x) => x.includes('"rootIn":true') && x.includes('"barIn":true') && x.includes('"boxIn":true')),
    viewportChecks.join(" | ")
  );
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  await wait(300);

  // 内容内按下 / 外部抬起、外部按下 / 内容抬起 → 均不关闭
  await cdp.eval(dispatchPointerPair(".image-lightbox-occlusion", ".image-lightbox-stage"));
  await wait(200);
  const afterMixed1 = await cdp.eval(`Boolean(document.querySelector('.image-lightbox'))`);
  await cdp.eval(dispatchPointerPair(".image-lightbox-stage", ".image-lightbox-occlusion"));
  await wait(200);
  const afterMixed2 = await cdp.eval(`Boolean(document.querySelector('.image-lightbox'))`);
  await cdp.eval(dispatchPointerPair(".image-lightbox-occlusion", ".image-lightbox-occlusion"));
  await wait(200);
  const afterImageClick = await cdp.eval(`Boolean(document.querySelector('.image-lightbox'))`);
  check("指针两端未同时命中外部空白时不关闭", afterMixed1 === true && afterMixed2 === true && afterImageClick === true, `${afterMixed1}/${afterMixed2}/${afterImageClick}`);

  // 双空白（图片舞台 letterbox）→ 关闭，再验证 Esc + 焦点归还
  await cdp.eval(dispatchPointerPair(".image-lightbox-stage", ".image-lightbox-stage"));
  await wait(350);
  const closedByBackdrop = await cdp.eval(`!document.querySelector('.image-lightbox')`);
  check("图片外按下 + 抬起关闭 Lightbox", closedByBackdrop === true, closedByBackdrop);

  await openLightbox();
  await wait(700);
  await cdp.eval(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await wait(350);
  const escState = await cdp.eval(`JSON.stringify({ closed: !document.querySelector('.image-lightbox'), focus: document.activeElement?.textContent?.trim() || "" })`);
  check("Esc 关闭且焦点回到「查看原图」", String(escState).includes('"closed":true') && String(escState).includes("查看原图"), escState);

  // 设置尺寸不变 + 外部光标存在
  await cdp.eval(`document.querySelector('.topbar-right .icon-btn[title="设置"]')?.click()`);
  await wait(700);
  const settingsSwiss = await cdp.eval(`JSON.stringify((() => {
    const p = document.querySelector('.settings-panel');
    if (!p) return { missing: true };
    const r = p.getBoundingClientRect();
    return {
      w: p.offsetWidth, h: p.offsetHeight, renderedW: Math.round(r.width), vw: innerWidth, vh: innerHeight,
      radius: getComputedStyle(p).borderRadius,
      backdropCursor: getComputedStyle(p.parentElement).cursor,
      token: getComputedStyle(document.body).getPropertyValue('--overlay-close-cursor').trim()
    };
  })())`);
  const sObj = JSON.parse(settingsSwiss || "{}");
  await cdp.shot("d256-settings-swiss.png");
  const settingsWidth = Math.min(980, sObj.vw - 64);
  check("设置尺寸不变（980px 上限 / ≤92vh）", Math.abs(sObj.w - settingsWidth) <= 1 && sObj.h <= sObj.vh * 0.92 + 2, settingsSwiss);
  check("设置默认瑞士皮肤为直角且有外部关闭光标", sObj.radius === "0px" && sObj.token.includes("url(") && sObj.backdropCursor.includes("url("), settingsSwiss);
  const swissCursor = sObj.token || "";
  const settingsHeight = sObj.h;
  await cdp.eval(dispatchPointerPair(".settings-panel", ".settings-panel"));
  await wait(200);
  const settingsAfterInner = await cdp.eval(`Boolean(document.querySelector('.settings-panel'))`);
  await cdp.eval(dispatchPointerPair(".modal-backdrop", ".modal-backdrop"));
  await wait(450);
  const settingsClosed = await cdp.eval(`!document.querySelector('.settings-panel')`);
  check("普通模态仅外部双空白关闭，内容点击不关闭", settingsAfterInner === true && settingsClosed === true, `inner=${settingsAfterInner} closed=${settingsClosed}`);

  // 内容面板：记忆难点六步加宽到 720，但短内容不撑满高度
  const leechId = await cdp.eval(`(async () => {
    const c = await window.cardsAPI.create({
      noteText: "FSRSTEST D256 leech", cardType: "qa",
      frontMarkdown: "FSRSTEST D256 leech 题面", backMarkdown: "FSRSTEST D256 leech 答案",
      priority: 50, tags: [], fsrsJson: JSON.stringify({ state: "review", due: Date.parse("2000-01-02"), lapses: 8, reps: 8, stability: 3, difficulty: 5, lastReview: Date.parse("2000-01-01") })
    });
    await window.cardsAPI.updateLeech(c.id, { isLeech: true, suspended: true, lapses: 8, hitCount: 8 });
    return c.id;
  })()`);
  await navTo("卡片");
  await cdp.eval(`(() => {
    const row = [...document.querySelectorAll('[role="row"]')].find((x) => x.textContent.includes("FSRSTEST D256 leech 题面"));
    row?.click();
    return row ? "row" : "missing";
  })()`);
  await wait(900);
  const leechOpen = await cdp.eval(`(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "六步处理");
    if (!b) return "missing";
    b.click();
    return "clicked";
  })()`);
  await wait(700);
  const leechPanel = await cdp.eval(`JSON.stringify((() => {
    const p = document.querySelector('.modal-panel-content');
    if (!p) return { missing: true };
    const r = p.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), vh: innerHeight };
  })())`);
  const iObj = JSON.parse(leechPanel || "{}");
  check("内容型面板按需加宽至 720px", leechOpen === "clicked" && iObj.w >= 700 && iObj.w <= 740, leechOpen + " | " + leechPanel);
  check("内容型面板不被强行撑高", iObj.h < iObj.vh * 0.8, leechPanel);
  await cdp.eval(`document.querySelector('.modal-panel-content .modal-close')?.click()`);
  await wait(300);
  if (leechId) await cdp.eval(`(async () => { try { await window.cardsAPI.remove(${JSON.stringify(leechId)}); } catch (e) {} return "cleaned"; })()`);

  // 陶土皮肤：同尺寸设置 + 圆角工具栏 / 圆角光标
  await cdp.eval(`(async () => { await window.settingsAPI.set("app", "skinId", "claude"); return "set"; })()`);
  await cdp.eval("window.location.reload()");
  await wait(2400);
  await navTo("复习");
  await openLightbox();
  await wait(800);
  const clay = await cdp.eval(`JSON.stringify((() => {
    const root = document.querySelector('.image-lightbox');
    const toolbar = root?.querySelector('.image-overlay-toolbar');
    return {
      skin: document.body.className,
      toolbarRadius: toolbar ? getComputedStyle(toolbar).borderRadius : "",
      token: getComputedStyle(document.body).getPropertyValue('--overlay-close-cursor').trim(),
      backdropCursor: root ? getComputedStyle(root.parentElement).cursor : ""
    };
  })())`);
  const cObj = JSON.parse(clay || "{}");
  await cdp.shot("d256-lightbox-claude.png");
  check("陶土皮肤 Lightbox 工具栏为圆角", String(cObj.skin).includes("skin-claude") && parseFloat(cObj.toolbarRadius) > 0, clay);
  check("陶土关闭光标与瑞士不同且同样可用", String(cObj.token || "").includes("url(") && cObj.token !== swissCursor && String(cObj.backdropCursor || "").includes("url("), clay);
  await cdp.eval(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await wait(300);
  await cdp.eval(`document.querySelector('.topbar-right .icon-btn[title="设置"]')?.click()`);
  await wait(650);
  const settingsClay = await cdp.eval(`JSON.stringify((() => {
    const p = document.querySelector('.settings-panel');
    if (!p) return { missing: true };
    return { w: p.offsetWidth, h: p.offsetHeight, radius: getComputedStyle(p).borderRadius };
  })())`);
  const scObj = JSON.parse(settingsClay || "{}");
  check("陶土皮肤设置宽度不变且随皮肤圆角", Math.abs(scObj.w - settingsWidth) <= 1 && scObj.radius !== "0px" && Math.abs(scObj.h - settingsHeight) <= 2, settingsClay);
  await cdp.eval(`document.querySelector('.settings-panel .modal-close')?.click()`);
  await wait(350);

  // 深色档：媒体层仍为不透明纸面，关闭光标与圆角工具栏不丢
  await cdp.eval(`(async () => { await window.settingsAPI.set("theme", "mode", "dark"); return "set"; })()`);
  await cdp.eval("window.location.reload()");
  await wait(2400);
  await navTo("复习");
  await openLightbox();
  await wait(700);
  const dark = await cdp.eval(`JSON.stringify((() => {
    const root = document.querySelector('.image-lightbox');
    const bar = root?.querySelector('.image-overlay-toolbar');
    return {
      dark: document.body.classList.contains('theme-dark'),
      token: getComputedStyle(document.body).getPropertyValue('--overlay-close-cursor').trim(),
      bg: root ? getComputedStyle(root.parentElement).backgroundColor : "",
      toolbarRadius: bar ? getComputedStyle(bar).borderRadius : ""
    };
  })())`);
  const dObj = JSON.parse(dark || "{}");
  check("陶土深色档媒体层与关闭光标仍可用", dObj.dark === true && /^rgb\(/.test(String(dObj.bg || "")) && String(dObj.token || "").includes("url(") && parseFloat(dObj.toolbarRadius) > 0, dark);
  await cdp.shot("d256-lightbox-claude-dark.png");

  // 瑞士深色档：同一深色主题下切回直角光标与直角工具栏
  await cdp.eval(`(async () => { await window.settingsAPI.set("app", "skinId", "none"); return "set"; })()`);
  await cdp.eval("window.location.reload()");
  await wait(2400);
  await navTo("复习");
  await openLightbox();
  await wait(700);
  const swissDark = await cdp.eval(`JSON.stringify((() => {
    const root = document.querySelector('.image-lightbox');
    const bar = root?.querySelector('.image-overlay-toolbar');
    return {
      dark: document.body.classList.contains('theme-dark') && !document.body.classList.contains('skin-claude'),
      token: getComputedStyle(document.body).getPropertyValue('--overlay-close-cursor').trim(),
      bg: root ? getComputedStyle(root.parentElement).backgroundColor : "",
      toolbarRadius: bar ? getComputedStyle(bar).borderRadius : ""
    };
  })())`);
  const sdObj = JSON.parse(swissDark || "{}");
  check("瑞士深色档为直角光标 / 直角工具栏且媒体层不透明", sdObj.dark === true && /^rgb\(/.test(String(sdObj.bg || "")) && String(sdObj.token || "").includes("url(") && parseFloat(sdObj.toolbarRadius) === 0, swissDark);
  await cdp.shot("d256-lightbox-swiss-dark.png");
} catch (err) {
  fail++;
  console.log(`  ✗ 套件异常 | ${err?.stack || err}`);
} finally {
  try {
    if (cdp && cardId) {
      await cdp.eval(`(async () => { try { await window.cardsAPI.remove(${JSON.stringify(cardId)}); } catch (e) {} return "cleaned"; })()`);
    }
  } catch { /* cleanup best effort */ }
  killProc(electron);
  try { fs.rmSync(USER_DATA, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* windows lock */ }
}

console.log(`\nD256 overlay focus GUI: ${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
