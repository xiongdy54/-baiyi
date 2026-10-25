// D139 阅读器侧栏顶部按钮带几何对齐——GUI 回归（CDP 驱动真实应用，自启自关）
//   node tests/d139-sidebar-band.gui.mjs        （跑前 npm run build；须先关闭应用 §7.1.8）
// @runtime: electron  @gui: true  @id: READER-SIDEBAR-BAND-D139
// 依据：docs/design/READER-SIDEBAR-IA-D127.md §6（D139 修订）+ AI_DEVELOPMENT_GUIDE.md §8.1 D139。
// 骨架与隔离同 tests/reader.personalization.gui.mjs：自启自关、M7_TEST_USERDATA 指向 tests/tmp-d139-userdata
// （先清空，绝不触碰真实库 §7.3）、fixture EPUB 现场构造（确定性）。
// 自证口径：每个几何量都同时回报「测的是哪个元素」（文本/类名），绝对值原样打印——基线取在动作前，
//   不写死成功（测量必须自证在测东西）。reduce 双轨＝源码口径（读 theme.css 断过渡只在 no-preference 块内）。
import { spawn } from "node:child_process";
import killProc from "./lib/killProc.cjs";
import fs, { openSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9247";
const USER_DATA = path.join(ROOT, "tests", "tmp-d139-userdata");
const EPUB_PATH = path.join(ROOT, "tests", "tmp-d139-fixture.epub");

let pass = 0;
let fail = 0;
function check(name, cond, actual) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 400)}`);
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** 上一轮 electron 未完全退出时，隔离目录仍被占用（Windows 锁延迟释放）⇒ 重试再放弃 */
async function rmWithRetry(dir) {
  for (let i = 0; i < 10; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await wait(500);
    }
  }
  throw new Error(`隔离目录无法清空（仍被占用）：${dir}`);
}
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
        const consoleLog = [];
        const fmt = (a) => (a.value ?? a.description ?? JSON.stringify(a)).toString();
        ws.addEventListener("message", (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) {
            pending.get(m.id)(m);
            pending.delete(m.id);
            return;
          }
          if (m.method === "Runtime.exceptionThrown") {
            const d = m.params.exceptionDetails;
            consoleLog.push("EXC: " + (d.exception?.description || d.text).slice(0, 300));
          } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
            consoleLog.push("ERR: " + m.params.args.map(fmt).join(" ").slice(0, 300));
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
          const exd = r.result?.exceptionDetails;
          if (exd) return "EXC: " + (exd.exception?.description || exd.text || JSON.stringify(exd)).slice(0, 300);
          const v = r.result?.result?.value;
          if (v === undefined) return "RAW:" + JSON.stringify(r).slice(0, 300);
          return v;
        };
        await send("Runtime.enable");
        return { ws, send, eval: evalJS, consoleLog, url: t.url };
      }
    } catch {
      /* 端口未就绪 */
    }
    await wait(1000);
  }
  throw new Error(`CDP 连接失败：${label}`);
}

// 夹具：3 章 EPUB（带 nav 目录）——只需内核就绪 + 侧栏三页签在场，正文长度够出几页即可
async function buildEpubFixture() {
  const zip = new JSZip();
  const para = (tag, n) =>
    Array.from({ length: n }, (_, i) => `<p>${tag}第${i}段。间隔重复记忆法通过安排复习时间来对抗遗忘曲线，每一次提取练习都会加强记忆痕迹的强度。</p>`).join("\n");
  const chapter = (i) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第${i}章</title></head><body>
<h1>第${i}章 标题</h1>
${para(`第${i}章正文。`, 12)}
</body></html>`;
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file("OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid"><metadata><dc:identifier id="uid">urn:uuid:d139-fixture</dc:identifier><dc:title>FSRSTEST-d139</dc:title><dc:language>zh</dc:language><meta property="dcterms:modified">2026-10-12T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${[1, 2, 3].map((i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine>${[1, 2, 3].map((i) => `<itemref idref="c${i}"/>`).join("")}</spine></package>`);
  zip.file("OEBPS/nav.xhtml", `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol>${[1, 2, 3].map((i) => `<li><a href="c${i}.xhtml">第${i}章</a></li>`).join("")}</ol></nav></body></html>`);
  for (const i of [1, 2, 3]) zip.file(`OEBPS/c${i}.xhtml`, chapter(i));
  fs.writeFileSync(EPUB_PATH, await zip.generateAsync({ type: "nodebuffer" }));
}

// ---------- 页面内探针 ----------
// 一次取全：左带（页签行）/ 页签钮 / 开关钮 / 右带（工具行）/ 选区动作钮（制卡·截图）。
// 每个量都带 label（元素文本）自证测的是哪个元素；两态共用（收起态页签行被 visibility 隐藏，仍可量 rect）。
const JS_BAND = `(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { t: +b.top.toFixed(1), b: +b.bottom.toFixed(1), l: +b.left.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
  const cs = (el) => getComputedStyle(el);
  const txt = (el) => (el.textContent || "").trim();
  const tabsRow = document.querySelector("[data-sidebar-tabs]");
  const tabs = [...document.querySelectorAll("[data-sidebar-tab]")];
  const toggle = document.querySelector("[data-reader-sidebar-toggle]");
  const controls = document.querySelector(".reader-engine-controls");
  const acts = [...document.querySelectorAll("[data-sel-actions] [data-sel-act]")];
  const rail = document.querySelector("[data-reader-side-rail]");
  const sb = document.querySelector("[data-reader-sidebar]");
  const out = {
    tabsRow: tabsRow ? { label: txt(tabsRow), ...r(tabsRow), padTop: cs(tabsRow).paddingTop, padLeft: cs(tabsRow).paddingLeft, cssH: cs(tabsRow).height } : null,
    tabs: tabs.map((el) => ({ label: txt(el), ...r(el), fs: cs(el).fontSize, fw: cs(el).fontWeight })),
    toggle: toggle ? { label: txt(toggle), ...r(toggle), pos: cs(toggle).position, left: cs(toggle).left, top: cs(toggle).top, fs: cs(toggle).fontSize } : null,
    controls: controls ? { h: +controls.getBoundingClientRect().height.toFixed(1), padTop: cs(controls).paddingTop, padLeft: cs(controls).paddingLeft } : null,
    acts: acts.map((el) => ({ label: txt(el), ...r(el), fs: cs(el).fontSize })),
    rail: rail ? { w: +rail.getBoundingClientRect().width.toFixed(1), transition: cs(rail).transition } : null,
    sidebarW: sb ? +sb.getBoundingClientRect().width.toFixed(1) : null,
    mainW: (() => { const m = document.querySelector(".reader-engine-main"); return m ? +m.getBoundingClientRect().width.toFixed(1) : null; })(),
    controlsTransition: controls ? cs(controls).transition : null,
    topbarNav: (() => { const n = document.querySelector(".topbar-nav .nav-item"); return n ? { label: txt(n), fs: cs(n).fontSize, h: +n.getBoundingClientRect().height.toFixed(1) } : null; })(),
    /* 环境自证：小数化（0.8px）边框/尺寸只在特定 DPR 下出现，回报以便解释绝对值 */
    env: { dpr: window.devicePixelRatio, innerW: window.innerWidth, innerH: window.innerHeight, tabsBorder: tabsRow ? cs(tabsRow).borderBottomWidth : null, controlsBorder: controls ? cs(controls).borderBottomWidth : null }
  };
  return JSON.stringify(out);
})()`;

const closeAllMenus = `(() => { document.querySelectorAll('[data-reader-tool-menu] .dd-btn').forEach((b) => { if (b.getAttribute("aria-expanded") === "true") b.click(); }); return 1; })()`;

// 点开关 + 轮询取**运行中**的过渡（getAnimations）：证明「声明了参数」之外，用户手势后过渡真的在跑。
// 采样窗口 500ms > 240ms 过渡 ⇒ 能抓到；取不到时返回空数组由断言判负（不写死成功）。
const JS_CLICK_AND_SAMPLE = `(async () => {
  const dump = (el) => (el ? el.getAnimations().map((a) => ({ p: a.transitionProperty, d: a.effect && a.effect.getTiming().duration })) : null);
  const rail = document.querySelector("[data-reader-side-rail]");
  const ctl = document.querySelector(".reader-engine-controls");
  document.querySelector("[data-reader-sidebar-toggle]")?.click();
  const t0 = performance.now();
  let railA = null;
  let ctlA = null;
  while (performance.now() - t0 < 500) {
    const r = dump(rail);
    if (r && r.length) { railA = r; ctlA = dump(ctl); break; }
    await new Promise((res) => requestAnimationFrame(res));
  }
  return JSON.stringify({
    rail: railA || dump(rail),
    ctl: ctlA || dump(ctl),
    gate: document.querySelector(".reader-engine-layout") ? document.querySelector(".reader-engine-layout").hasAttribute("data-rail-anim") : "no-layout"
  });
})()`;

async function screenshot(cdp, name) {
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  const b64 = r?.result?.data || r?.data;
  if (!b64) return 0;
  fs.writeFileSync(path.join(ROOT, "tests", name), Buffer.from(b64, "base64"));
  return fs.statSync(path.join(ROOT, "tests", name)).size;
}

/** 打开 fixture EPUB（同 personalization 套件：经 libraryAPI 落盘名精确匹配，顺序无关） */
async function openBook(cdp) {
  const id = await cdp.eval(`(async () => {
    const items = await window.libraryAPI.list();
    for (const it of items.filter((x) => (x.title || "").includes("FSRSTEST-d139"))) {
      try {
        const f = await window.libraryAPI.readEbookFile(it.id);
        if (f && String(f.name || "").endsWith(".epub")) return it.id;
      } catch { /* 下一候选 */ }
    }
    return null;
  })()`);
  const clicked = id ? await cdp.eval(`(() => { const b = document.querySelector('[data-entry="${id}"] .book-card'); return b ? (b.click(), true) : false; })()`) : false;
  await wait(4500);
  return Boolean(clicked);
}

const backToShelf = `(() => { [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "书架")?.click(); return 1; })()`;

async function main() {
  killProc(electron);
  await wait(800);
  await rmWithRetry(USER_DATA); // 全新库（自清场）
  await buildEpubFixture();
  const out = openSync(path.join(ROOT, "tests", "d139-sidebar-band.gui.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT,
    shell: true,
    stdio: ["ignore", out, out],
    detached: process.platform !== "win32",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connectTarget((u) => u.includes("index.html"), "主窗口");
  await wait(2500);

  try {
    // 0. 造数（EPUB，内核分支＝侧栏 + 浮动开关钮 + 右列工具行都在场）
    const seeded = await cdp.eval(`(async () => {
      try {
        const epub = await window.libraryAPI.createFromBookFile({ path: ${JSON.stringify(EPUB_PATH)}, name: "FSRSTEST-d139.epub", ext: "epub" });
        return { ok: true, id: epub && epub.id };
      } catch (e) { return { ok: false, err: String(e).slice(0, 200) }; }
    })()`);
    check("0 造数（EPUB 导入）", Boolean(seeded?.ok && seeded?.id), JSON.stringify(seeded));
    // 书架列表在挂载时读取一次 ⇒ 造数后必须重载页面，否则 [data-entry] 不存在（首跑落此坑）
    await cdp.eval(`location.reload()`);
    await wait(3000);
    const opened = await openBook(cdp);
    check("0b 打开阅读器（内核分支就绪）", opened && (await cdp.eval(`!!window.__readerKernel`)) === true, JSON.stringify(opened));

    // ===== A 同带几何（收起态＝开机态；先量收起态再看展开态）=====
    console.log("== A 按钮带几何（收起态 → 展开态）==");
    await cdp.eval(closeAllMenus);
    const closed = JSON.parse(String(await cdp.eval(JS_BAND)) || "{}");
    // 首帧门基线（必须在**任何点击之前**取）：挂载后未点过开关 ⇒ 不带 [data-rail-anim]
    const gateAtStart = await cdp.eval(`(() => { const l = document.querySelector(".reader-engine-layout"); return l ? l.hasAttribute("data-rail-anim") : "no-layout"; })()`);
    console.log("  · 收起态原始量:", JSON.stringify(closed.toggle), "| rail:", JSON.stringify(closed.rail), "| gate:", gateAtStart);
    // 首次用户手势＝点开关展开；**同一次 eval 内**点完后轮询取运行中的过渡
    // （React 18 的 click 提交是异步的 ⇒ 必须轮询等提交，不能在 click 后同帧取）
    const firstRun = JSON.parse(String(await cdp.eval(JS_CLICK_AND_SAMPLE)) || "{}");
    await wait(1200);
    const open = JSON.parse(String(await cdp.eval(JS_BAND)) || "{}");
    console.log("  · 展开态原始量:");
    console.log("      页签行:", JSON.stringify(open.tabsRow));
    console.log("      页签钮:", JSON.stringify(open.tabs));
    console.log("      工具行:", JSON.stringify(open.controls));
    console.log("      选区动作钮:", JSON.stringify(open.acts));
    console.log("      开关钮:", JSON.stringify(open.toggle), "| 顶栏导航:", JSON.stringify(open.topbarNav));
    console.log("      轨:", JSON.stringify(open.rail));
    console.log("      过渡:", JSON.stringify({ rail: open.rail && open.rail.transition, controls: open.controlsTransition }));
    console.log("      环境:", JSON.stringify(open.env));

    // A0 自证：量到的就是这几枚钮（文本逐字；v48.97/D141 起工具栏动作组只剩「截图」——「制卡」钮
    // 与顶栏常驻制卡台入口重复已删，有选区的制卡走选区浮条，故此处期望集随之下调）
    check(
      "A0 探针自证（页签＝目录/摘录/图谱；动作钮＝截图；开关钮＝收起/展开）",
      (open.tabs || []).map((x) => x.label).join(",") === "目录,摘录,图谱" &&
        (open.acts || []).map((x) => x.label).join(",") === "截图" &&
        ["收起", "展开"].includes((open.toggle || {}).label),
      JSON.stringify({ tabs: (open.tabs || []).map((x) => x.label), acts: (open.acts || []).map((x) => x.label), toggle: open.toggle && open.toggle.label })
    );
    // A1 左带与右带同高（两列顶栏带对齐）
    check(
      "A1 左带（页签行）与右带（工具行）等高（±0.5）",
      Boolean(open.tabsRow && open.controls) && Math.abs(open.tabsRow.h - open.controls.h) <= 0.5,
      JSON.stringify({ tabsRowH: open.tabsRow && open.tabsRow.h, controlsH: open.controls && open.controls.h })
    );
    // A2 页签钮高 = 选区动作钮高（＝D139 主诉求；v48.97/D141 起动作组只剩「截图」，按 ≥1 判）
    const actH = (open.acts || []).map((a) => a.h);
    check(
      "A2 页签钮高 = 工具栏动作钮（截图）高（±0.5）",
      (open.tabs || []).length === 3 && actH.length >= 1 && (open.tabs || []).every((t) => Math.abs(t.h - actH[0]) <= 0.5),
      JSON.stringify({ tabsH: (open.tabs || []).map((t) => t.h), actsH: actH })
    );
    // A3 页签钮与动作钮同顶同底（同一视觉带，不是只有高度相同）
    check(
      "A3 页签钮与制卡钮同顶同底（±0.5）",
      (open.tabs || []).length > 0 && actH.length > 0 && Math.abs(open.tabs[0].t - open.acts[0].t) <= 0.5 && Math.abs(open.tabs[0].b - open.acts[0].b) <= 0.5,
      JSON.stringify({ tab: open.tabs[0], act: open.acts[0] })
    );
    // A4 左右两带内容同顶（内距同为 sp-2=8）
    check(
      "A4 页签行与工具行内距同档（padTop 相等且内容同顶）",
      Boolean(open.tabsRow && open.controls) && open.tabsRow.padTop === open.controls.padTop,
      JSON.stringify({ tabsPadTop: open.tabsRow && open.tabsRow.padTop, controlsPadTop: open.controls && open.controls.padTop })
    );
    // A5 字号语言：页签沿用顶栏导航同档（主役导航），不随右列工具钮降档
    check(
      "A5 页签字号 = 顶栏导航字号（主役页签语言同族）",
      (open.tabs || []).length === 3 && Boolean(open.topbarNav) && open.tabs.every((t) => t.fs === open.topbarNav.fs),
      JSON.stringify({ tabFs: (open.tabs || []).map((t) => t.fs), navFs: open.topbarNav && open.topbarNav.fs })
    );

    // ===== B 浮动开关钮（fixed，两态同位同带）=====
    console.log("== B 浮动开关钮 ==");
    const btnH = (open.acts || [])[0]?.h;
    check(
      "B1 展开态：开关钮 fixed(16, 56) 宽 40 高 = 动作钮高（±0.5）",
      Boolean(open.toggle) && open.toggle.pos === "fixed" && open.toggle.left === "16px" && open.toggle.top === "56px" &&
        Math.abs(open.toggle.w - 40) <= 0.5 && typeof btnH === "number" && Math.abs(open.toggle.h - btnH) <= 0.5,
      JSON.stringify({ toggle: open.toggle, actH: btnH })
    );
    check(
      "B2 展开态：开关钮与制卡/截图同带（同顶同底 ±0.5）",
      Boolean(open.toggle) && (open.acts || []).length > 0 &&
        Math.abs(open.toggle.t - open.acts[0].t) <= 0.5 && Math.abs(open.toggle.b - open.acts[0].b) <= 0.5,
      JSON.stringify({ toggle: open.toggle, act: (open.acts || [])[0] })
    );
    await screenshot(cdp, "tmp-d139-band-open.png");
    // 收起态：开关钮仍在同一带（文案变「展开」）
    await cdp.eval(`(() => { document.querySelector("[data-reader-sidebar-toggle]")?.click(); return 1; })()`);
    await wait(1000);
    const closedAgain = JSON.parse(String(await cdp.eval(JS_BAND)) || "{}");
    console.log("  · 收起态开关钮:", JSON.stringify(closedAgain.toggle));
    check(
      "B3 收起态：开关钮同位同高（top 56 / 高 = 动作钮高），文案＝展开",
      Boolean(closedAgain.toggle) && closedAgain.toggle.label === "展开" && closedAgain.toggle.top === "56px" &&
        Math.abs(closedAgain.toggle.t - closed.toggle.t) <= 0.5 && Math.abs(closedAgain.toggle.h - open.toggle.h) <= 0.5,
      JSON.stringify({ closed: closedAgain.toggle, before: closed.toggle })
    );
    await screenshot(cdp, "tmp-d139-band-closed.png");

    // ===== C 开合动效（MOTION-DESIGN-SPEC §7：栏/面板开合＝--dur-panel 240ms + --ease）=====
    console.log("== C 开合动效 ==");
    console.log("      首次手势采样:", JSON.stringify(firstRun));
    // C0 首帧门（D139 补，审查 P1②）：未点过开关前两条过渡都不得声明 ⇒ 挂载期自动展开瞬时落位
    check(
      "C0 未手势前无过渡（[data-rail-anim] 未挂 + computed transition 无 0.24s）",
      gateAtStart === false && !/0\.24s/.test((closed.rail || {}).transition || "") && !/0\.24s/.test(closed.controlsTransition || ""),
      JSON.stringify({ gate: gateAtStart, rail: closed.rail && closed.rail.transition, controls: closed.controlsTransition })
    );
    check(
      "C1 轨 width/visibility 过渡 = 240ms（--dur-panel）+ 与工具行同参",
      Boolean(open.rail) && /width 0\.24s/.test(open.rail.transition) && /visibility 0\.24s/.test(open.rail.transition) && /cubic-bezier\(0\.2, 0, 0\.38, 0\.9\)/.test(open.rail.transition),
      open.rail && open.rail.transition
    );
    check(
      "C2 工具行 padding-left 过渡与轨同参（同 duration/缓动，不脱拍）",
      typeof open.controlsTransition === "string" && /padding-left 0\.24s/.test(open.controlsTransition) &&
        /cubic-bezier\(0\.2, 0, 0\.38, 0\.9\)/.test(open.controlsTransition),
      open.controlsTransition
    );
    // C3 真跑自证：**首次用户手势**下过渡确实在跑（证明门只挡挂载期、不挡用户点开关）
    {
      const railWidth = (firstRun.rail || []).find((a) => a.p === "width");
      const ctlPad = (firstRun.ctl || []).find((a) => a.p === "padding-left");
      check(
        "C3 首次手势后过渡真在跑（rail width + 工具行 padding-left，duration 均 240ms）",
        firstRun.gate === true && Boolean(railWidth) && Boolean(ctlPad) && railWidth.d === 240 && ctlPad.d === 240,
        JSON.stringify(firstRun)
      );
    }
    // C4 reduce 双轨 + 同门（源码口径）：这两个**元素本体**上的每一条 transition 都必须带 [data-rail-anim]
    //    且只在 no-preference 块内——避免「一个受门一个不受」的脱拍，也避免将来新增裸过渡漏门。
    //    口径：只看「主词」是这两个元素的选择器（末尾复合选择器 = .reader-side-rail / .reader-engine-controls），
    //    其内部子元素的 hover 过渡（如 .reader-engine-controls .btn）不算本条对象。
    {
      const css = fs.readFileSync(path.join(ROOT, "src", "theme.css"), "utf8");
      const subject = /\.reader-(?:side-rail|engine-controls)(?:\[[^\]]*\])?$/;
      const scoped = [];
      for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
        if (!/transition\s*:/.test(m[2])) continue;
        const sel = m[1]
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
          .join(" ")
          .trim();
        const parts = sel.split(",").map((s) => s.trim()).filter((s) => subject.test(s));
        if (!parts.length) continue;
        const noPref = css.lastIndexOf("@media (prefers-reduced-motion: no-preference)", m.index);
        const reduced = css.lastIndexOf("@media (prefers-reduced-motion: reduce)", m.index);
        scoped.push({ sel: parts.join(" , "), gated: parts.every((s) => /\[data-rail-anim\]/.test(s)), inNoPref: noPref > 0 && noPref > reduced });
      }
      check(
        "C4 轨/工具行元素本体的过渡规则：全部带 [data-rail-anim] 门且都在 no-preference 块内",
        scoped.length >= 2 && scoped.every((r) => r.gated && r.inNoPref),
        JSON.stringify(scoped)
      );
    }
    // C5 reduce 直切（**行为**口径，不止源码）：CDP 模拟 prefers-reduced-motion: reduce ⇒ 两条过渡均不在场
    {
      await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      await wait(250);
      const red = JSON.parse(String(await cdp.eval(JS_BAND)) || "{}");
      check(
        "C5 reduce 下两条过渡均不在场（开合直切，双轨未被本批破坏）",
        !/0\.24s/.test((red.rail || {}).transition || "") && !/0\.24s/.test(red.controlsTransition || ""),
        JSON.stringify({ rail: red.rail && red.rail.transition, controls: red.controlsTransition })
      );
      await cdp.send("Emulation.setEmulatedMedia", { features: [] });
      await wait(250);
    }

    // ===== D 行为不回归（280 让位 / 收回归零）=====
    console.log("== D 行为不回归 ==");
    const reopen = async () => {
      await cdp.eval(`(() => { const b = document.querySelector("[data-reader-sidebar-toggle]"); if (b && b.getAttribute("aria-expanded") !== "true") b.click(); return 1; })()`);
      await wait(1200);
      return JSON.parse(String(await cdp.eval(JS_BAND)) || "{}");
    };
    const op = await reopen();
    check(
      "D1 展开：轨 280 + 侧栏 280 + 正文让位 280（±1）",
      Boolean(op.rail && op.sidebarW && op.mainW) && Math.abs(op.rail.w - 280) <= 1 && Math.abs(op.sidebarW - 280) <= 1 &&
        Math.abs(op.mainW - (closed.mainW - 280)) <= 1,
      JSON.stringify({ rail: op.rail && op.rail.w, sidebar: op.sidebarW, mainW: op.mainW, mainWClosed: closed.mainW })
    );
    await cdp.eval(`(() => { document.querySelector("[data-reader-sidebar-toggle]")?.click(); return 1; })()`);
    await wait(1000);
    const cl = JSON.parse(String(await cdp.eval(JS_BAND)) || "{}");
    check(
      "D2 收起：轨宽归 0 + 正文复原（±1）",
      Boolean(cl.rail) && cl.rail.w === 0 && Math.abs(cl.mainW - closed.mainW) <= 1,
      JSON.stringify({ railW: cl.rail && cl.rail.w, mainW: cl.mainW, mainWClosed: closed.mainW })
    );

    // ===== E 回归口径：控制台零错误 =====
    console.log("== E 回归口径 ==");
    const errs = [...new Set(cdp.consoleLog)].filter((l) => !l.includes("ResizeObserver loop") && !l.includes("Security Warning") && !l.includes("This warning"));
    // 前置自证：本套件确实跑过（量到了带）——否则「零错误」是空转真命题
    check("E0 前置自证：本套件量到过按钮带（否则无错误断言空转）", (open.tabs || []).length === 3 && Boolean(open.controls), JSON.stringify({ tabs: (open.tabs || []).length, controls: Boolean(open.controls) }));
    check("E1 全程无控制台错误/异常", (open.tabs || []).length === 3 && errs.length === 0, JSON.stringify(errs.slice(0, 4)));

    await cdp.eval(backToShelf);
    await wait(600);
  } finally {
    try {
      await cdp.eval(`(async () => {
        const items = await window.libraryAPI.list();
        for (const it of items.filter((x) => (x.title || "").includes("FSRSTEST-d139"))) await window.libraryAPI.delete(it.id);
        return true;
      })()`);
    } catch {
      /* 清理失败不影响结论 */
    }
    fs.rmSync(EPUB_PATH, { force: true });
  }

  await cdp.ws.close();
  killProc(electron);
  await wait(500);
  console.log(`\n==== SUMMARY ${pass}/${pass + fail} ====`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("套件异常：", e?.stack || e);
  killProc(electron);
  process.exit(1);
});
