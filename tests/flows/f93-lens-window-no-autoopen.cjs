// F93 结构图窗口不随阅读会话自动弹出（D202 / v49.28 回归）
// @runtime: node  @tier: 2  @gui: true  @id: F93  @timeout: 300
// 运行：npm run build 之后 `node tests/flows/f93-lens-window-no-autoopen.cjs`
//
// 缺陷（用户 2026-10-21 实测）：书架点书进入阅读，未点「结构图」按钮，结构图窗口自行弹出。
// 根因：工具栏开关沿用面板内嵌时代的 localStorage `mm2.lens.open` 跨会话记忆——D197 把面板
// 改成独立置顶窗口后，上次离开阅读时窗口开着的用户，下次点开任意书即由挂载效应自动 show()。
//
// 判据（正向对照必需，避免空转通过）：
//   ① 预置 `mm2.lens.open=1` 后点书进入阅读 → 不应出现 lens.html 目标（修复前此条失败）；
//   ② 再点工具栏「结构图」按钮 → lens.html 目标出现（证明 ① 的检测方式真能看到窗口）。
// 隔离：独立 userData + 独立端口 + 只结束自己 spawn 的进程（lib/guienv 同规）。
"use strict";
const path = require("path");
const { Flow, runFlow } = require("./lib/harness.cjs");
const { launch, shutdown, wait } = require("./lib/guienv.cjs");

const flow = new Flow({
  id: "F93",
  title: "结构图窗口不随阅读会话自动弹出",
  angle: "预置跨会话开关为开 → 点书进阅读 → 无窗口；点按钮 → 窗口出现（正向对照）",
  cites: ["§6.2", "§8.1 D202", "§7.3"],
  tier: 2,
  gui: true,
  timeoutMs: 300_000
});

const TITLE = `F93 结构图自动弹出 ${Date.now().toString(36)}`;
const MD = "# 第一章\n\n结构图自动弹出回归用正文。\n\n# 第二章\n\n第二段正文。\n";

const val = async (h, expr) => (await h.evaluate(expr)).value;
const lensTargets = async (h) => (await h.listTargets()).filter((t) => /lens\.html/.test(t.url || ""));

async function until(fn, ms = 8000, step = 250) {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - t0 > ms) return false;
    await wait(step);
  }
}

runFlow(flow, async () => {
  let h = await launch({ label: "f93-lens-no-autoopen", port: 9641, fresh: true });
  if (h.skip || h.skippedByExit || h.timeout) {
    flow.record("环境冲突，本条 GUI 流程跳过", h.reason || h.skip || "未知");
    return;
  }
  try {
    await wait(5000);
    flow.section("准备：加一本书并回到书架");
    const added = await val(h, `const r = await window.libraryAPI.createFromPaste(${JSON.stringify(TITLE)}, ${JSON.stringify(MD)}); return r && (r.id || (r.item && r.item.id)) ? "ok" : JSON.stringify(r).slice(0,120);`);
    flow.check("沙箱内加书成功", added === "ok", "ok", added);
    await wait(1200);
    await val(h, `const it=[...document.querySelectorAll('.nav-item')].find(x=>/卡片/.test(x.textContent||'')); if(it)it.click(); return true;`);
    await wait(700);
    await val(h, `const it=[...document.querySelectorAll('.nav-item')].find(x=>/书架/.test(x.textContent||'')); if(it)it.click(); return true;`);
    await wait(1500);
    const card = await val(h, `return !!document.querySelector(".book-card")`);
    flow.check("书架上看得见书卡", card === true, true, card);

    flow.section("① 预置跨会话开关=开 → 点书进入阅读");
    // 模拟「上次离开阅读时结构图窗口开着」的存量状态（修复后该键不再被读取）
    await val(h, `window.localStorage.setItem("mm2.lens.open","1"); return window.localStorage.getItem("mm2.lens.open");`);
    const before = (await lensTargets(h)).length;
    flow.eq("进入阅读前不存在结构图窗口", before, 0);

    const clicked = await val(h, `const c=document.querySelector(".book-card"); if(!c) return "no-card"; c.click(); return "clicked";`);
    flow.check("点书卡进入阅读", clicked === "clicked", "clicked", clicked);
    const mounted = await until(() => val(h, `return !!document.querySelector("[class*=reader],[class*=Reader],iframe,webview,[class*=foliate]")`), 15000);
    flow.check("阅读界面已挂载", mounted === true, true, mounted);
    // 等过 lensWindow 的 2s 安全阀窗口（若被自动 show，最迟 2s 后一定出现）
    await wait(3500);
    const auto = (await lensTargets(h)).length;
    flow.check("未点按钮时结构图窗口不存在（D202）", auto === 0, 0, auto);

    flow.section("② 点工具栏「结构图」→ 窗口出现（正向对照）");
    const btn = await until(() => val(h, `return !!document.querySelector("[data-reader-lens-toggle]")`), 15000);
    flow.check("工具栏出现「结构图」按钮", btn === true, true, btn);
    const pressed = await val(h, `const b=document.querySelector("[data-reader-lens-toggle]"); return b ? b.getAttribute("aria-pressed") : "no-btn";`);
    flow.check("按钮初始为关", pressed === "false", "false", pressed);
    await val(h, `const b=document.querySelector("[data-reader-lens-toggle]"); if(b){b.click(); return true;} return false;`);
    const appeared = await until(async () => (await lensTargets(h)).length > 0, 10000);
    flow.check("点按钮后结构图窗口出现（检测链路有效）", appeared === true, true, appeared);
  } finally {
    await shutdown(h);
  }
});
