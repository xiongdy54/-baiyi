// 纸片图谱样张 · CDP 尺寸 / 控制轨 / 解释卡验证（零产品代码）
// 运行：node design-samples/floating-atlas-check.cjs
// 需本机 Chrome；默认 C:/Program Files/Google/Chrome/Application/chrome.exe，可用 CHROME 覆盖。
// 输出：design-samples/floating-atlas-interaction.json；失败时退出码 1。
"use strict";
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9361;
const SAMPLE = path.join(__dirname, "floating-atlas.html");
const OUT = path.join(__dirname, "floating-atlas-interaction.json");
const URL = `${pathToFileURL(SAMPLE).href}?chrome=1&mode=reader&preset=real&anim=0`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "fa-check-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--window-size=1600,1000", URL
], { stdio: "ignore" });

(async () => {
  let target = null;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === "page" && t.url.includes("floating-atlas"));
    } catch {}
  }
  if (!target) { console.error("NO TARGET"); chrome.kill(); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  const send = (method, params = {}) => new Promise((res) => {
    const id = ++seq;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send("Page.enable");
  await send("Runtime.enable");
  const evalv = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value ?? null;
  };
  const ledger = async () => {
    const txt = await evalv("document.getElementById('measureJson').textContent");
    try { return JSON.parse(txt); } catch { return null; }
  };
  const winRect = async () => evalv(`(() => { const r=document.getElementById('lensWin').getBoundingClientRect(); return [Math.round(r.width),Math.round(r.height)]; })()`);
  const railState = async () => evalv(`(() => {
    const rail=document.getElementById('rail');
    const title=document.getElementById('railTitle').getBoundingClientRect();
    const acts=document.getElementById('railActions');
    const box=acts.getBoundingClientRect();
    const pin=document.getElementById('railPin').getBoundingClientRect();
    return {
      on: document.getElementById('lensWin').classList.contains('rail-on') || document.getElementById('lensWin').classList.contains('rail-forced'),
      opacity: getComputedStyle(rail).opacity,
      actionsHidden: acts.hidden,
      labels: Array.from(acts.querySelectorAll('[data-act]')).map(b=>b.textContent),
      noOverlap: title.right <= box.left + 0.5 && box.right <= pin.left + 0.5,
      box: [Math.round(box.left),Math.round(box.right)]
    };
  })()`);
  const clickPreset = async (id) => { await evalv(`document.querySelector('[data-preset="${id}"]').click()`); await sleep(600); };
  const select = async (id) => { await evalv(`document.querySelector('.node[data-id="${id}"]')?.dispatchEvent(new MouseEvent('click',{bubbles:true}))`); await sleep(200); };

  await sleep(1800);
  const out = { url: URL, checks: [], data: {} };
  const check = (name, ok, actual) => out.checks.push({ name, ok: !!ok, actual });

  const initial = await ledger();
  const plate0 = await winRect();
  out.data.initial = { ledger: initial, plate: plate0 };
  check("初始窗口 = 内容 + 留白", initial?.current.window.w === 568 && initial?.current.window.h === 216, initial?.current.window);
  check("初始 100% 完整", initial?.current.tier === "100% 完整", initial?.current.tier);
  check("纸片底 = 窗口表面", plate0?.[0] === 568 && plate0?.[1] === 216, plate0);

  // 选中：整卡主题色（与根同款，无外圈/双框）；控制轨自动亮，动作在轨内居中
  await select("real-c0");
  const selected = await evalv(`(() => {
    const g=document.querySelector('.node.is-selected');
    const card=g?.querySelector('.card-rect');
    const root=document.querySelector('.node.is-root .card-rect');
    const title=g?.querySelector('.title');
    const rootTitle=document.querySelector('.node.is-root .title');
    return {
      selected: !!g,
      ring: !!document.querySelector('.sel-ring'),
      fill: card?getComputedStyle(card).fill:null,
      rootFill: root?getComputedStyle(root).fill:null,
      titleFill: title?getComputedStyle(title).fill:null,
      rootTitleFill: rootTitle?getComputedStyle(rootTitle).fill:null
    };
  })()`);
  const railReal = await railState();
  out.data.selected = { selected, rail: railReal };
  check("选中节点整卡主题色（与根同色）", selected?.selected && selected.fill === selected.rootFill && selected.titleFill === selected.rootTitleFill, selected);
  check("选中节点无外圈/双框", !selected?.ring, selected);
  check("选后控制轨自动亮起", railReal?.on && railReal?.opacity === "1", railReal);
  check("动作在控制轨内且不重叠", !railReal?.actionsHidden && railReal?.noOverlap, railReal);
  check("宽窗使用完整动作文案", railReal?.labels?.join("|") === "跳到原文|它在说什么|深挖|在完整图谱中打开", railReal?.labels);

  // 解释卡：从控制轨下方展开，窗口尺寸不变，卡片不出窗
  await evalv(`document.querySelector('[data-act="explain"]').click()`);
  await sleep(250);
  const explain = await evalv(`(() => {
    const e=document.getElementById('explain');
    const r=e.getBoundingClientRect();
    const w=document.getElementById('lensWin').getBoundingClientRect();
    return { open: e.classList.contains('is-on'), win: (()=>{const l=document.getElementById('lensWin');return l.style.width+'x'+l.style.height;})(), rect:[Math.round(r.width),Math.round(r.height)], fits: r.left>=w.left-0.5 && r.right<=w.right+0.5 && r.top>=w.top-0.5 && r.bottom<=w.bottom+0.5 };
  })()`);
  out.data.explain = explain;
  check("解释打开不改窗口尺寸", explain?.open && explain?.win === "568pxx216px", explain);
  check("解释卡在纸片内", explain?.fits, explain);
  await evalv(`document.querySelector('[data-act="closeExplain"]').click()`);
  await sleep(200);
  const afterClose = await railState();
  check("解释关闭后动作仍在轨内", !afterClose?.actionsHidden, afterClose);

  // 纸片底随图谱尺寸变化：真实 → 树 → 时间线 → 真实
  const sizes = {};
  sizes.real = (await ledger())?.current.window;
  await clickPreset("tree");
  sizes.tree = (await ledger())?.current.window;
  const plateTree = await winRect();
  await select("tree-c0");
  const railTree = await railState();
  out.data.treeRail = railTree;
  check("窄窗动作自动缩短", railTree?.labels?.join("|") === "原文|解释|深挖|全图", railTree?.labels);
  check("窄窗轨内动作仍不重叠", railTree?.noOverlap, railTree);
  await clickPreset("timeline");
  sizes.timeline = (await ledger())?.current.window;
  const plateTimeline = await winRect();
  await clickPreset("real");
  sizes.realAgain = (await ledger())?.current.window;
  out.data.sizes = { sizes, plateTree, plateTimeline };
  check("纸片底随预设变大小（真实 568×216 / 树 448×504 / 时间线 796×204）",
    sizes.real?.w === 568 && sizes.real?.h === 216 &&
    sizes.tree?.w === 448 && sizes.tree?.h === 504 &&
    sizes.timeline?.w === 796 && sizes.timeline?.h === 204, sizes);
  check("实际纸片矩形 = 窗口（树/时间线）",
    plateTree?.[0] === 448 && plateTree?.[1] === 504 &&
    plateTimeline?.[0] === 796 && plateTimeline?.[1] === 204, { plateTree, plateTimeline });

  // 12 卡：聚焦 → 全图 → 回到聚焦
  await clickPreset("argument");
  const argFocus = await ledger();
  await select("argument-c0");
  const railArg = await railState();
  await evalv(`document.querySelector('[data-act="explain"]').click()`);
  await sleep(250);
  const argExplain = await evalv(`(() => {
    const e=document.getElementById('explain').getBoundingClientRect();
    const w=document.getElementById('lensWin').getBoundingClientRect();
    return { fits: e.top>=w.top-0.5 && e.bottom<=w.bottom+0.5, card:[Math.round(e.width),Math.round(e.height)], win:[Math.round(w.width),Math.round(w.height)] };
  })()`);
  await evalv(`document.querySelector('[data-act="closeExplain"]').click()`);
  await sleep(150);
  await evalv(`document.querySelector('.node[data-more]')?.dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  await sleep(500);
  const argAll = await ledger();
  const chip = await evalv(`(() => ({ on: document.getElementById('modeChip').classList.contains('is-on'), text: document.getElementById('modeChipText').textContent }))()`);
  await evalv(`document.getElementById('backFocus').click()`);
  await sleep(500);
  const argBack = await ledger();
  out.data.argument = { focus: argFocus, all: argAll, back: argBack, rail: railArg, explain: argExplain, chip };
  check("12 卡默认聚焦且 s ≥ 0.62", argFocus?.current.mode === "focus" && argFocus?.current.scale >= 0.62, argFocus?.current);
  check("聚焦时窄动作文案仍可容纳", railArg?.noOverlap, railArg);
  check("12 卡聚焦里解释卡不出窗", argExplain?.fits, argExplain);
  check("展开全部为显式全图", argAll?.current.mode === "all" && argAll?.current.tier === "全图（显式）", argAll?.current);
  check("全图胶囊可见", chip?.on && chip?.text.includes("全图"), chip);
  check("回到聚焦", argBack?.current.mode === "focus", argBack?.current);

  // 窄舞台：1440 → 1100（舞台 760×715）
  await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(700);
  const narrow = await ledger();
  const narrowWin = await evalv(`(() => { const w=document.getElementById('lensWin'); const s=document.getElementById('stage'); return { win: w.style.width+'x'+w.style.height+' @ '+w.style.left+','+w.style.top, stage: s.clientWidth+'x'+s.clientHeight }; })()`);
  out.data.narrow = { ledger: narrow, win: narrowWin };
  check("窄舞台聚焦档位自适应", narrow?.current.mode === "focus" && narrow?.current.content.w < argFocus?.current.content.w, narrow?.current);
  check("窄舞台窗口不超 92% 工作区", narrow?.current.window.w <= Math.floor((narrow?.stage?.w || 0) * 0.92), narrow?.current.window);

  // 控制轨自动隐藏（无强制常显）
  await send("Emulation.setDeviceMetricsOverride", { width: 1568, height: 896, deviceScaleFactor: 1, mobile: false });
  await sleep(700);
  await evalv(`document.querySelector('[data-preset="real"]').click()`);
  await sleep(500);
  await select("real-c0");
  await sleep(2900);
  const hiddenRail = await railState();
  out.data.autoHide = hiddenRail;
  check("控制轨 2.5s 后自动隐藏", hiddenRail?.opacity === "0" && hiddenRail?.on === false, hiddenRail);

  const fail = out.checks.filter((c) => !c.ok);
  out.pass = out.checks.length - fail.length;
  out.fail = fail.length;
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`结果：${out.pass} 通过，${out.fail} 失败`);
  out.checks.forEach((c) => console.log(`${c.ok ? "  ✓" : "  ✗"} ${c.name}${c.ok ? "" : " | 实际: " + JSON.stringify(c.actual)}`));
  console.log("WROTE", OUT);
  ws.close();
  chrome.kill();
  setTimeout(() => process.exit(fail.length ? 1 : 0), 300);
})().catch((err) => {
  console.error(err);
  chrome.kill();
  process.exit(1);
});
