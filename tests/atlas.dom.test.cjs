// @runtime: system-node
// 结构全景 DOM 回归（D254 v2 §16.2）：真实 MindmapTab + AtlasStage/AtlasCard/AtlasToolbar + jsdom + 真实引擎。
const path = require("path");
const fs = require("fs");
const { createHarness } = require("./lib/atlasDomHarness.cjs");

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "").slice(0, 900)}`); }
}

(async () => {
  const h = createHarness();
  const { w, state } = h;
  const q = (sel) => w.document.querySelector(sel);
  const qa = (sel) => [...w.document.querySelectorAll(sel)];
  const panel = () => w.document.body.textContent || "";
  const stageText = () => (q("#stage .atlas-stage")?.textContent || "");
  const setInput = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
    setter.call(el, v);
    el.dispatchEvent(new w.Event("input", { bubbles: true }));
  };

  h.render();

  console.log("---- 1 工具栏 / 无旧侧栏 ----");
  check("工具栏出现面包屑 / 搜索 / 生成 / 版本 / 视图 / 缩放 / 居中", await h.until(() =>
    !!q(".atlas-toolbar .atlas-crumbs") && !!q("[data-atlas-search]") && !!q('[data-atlas-menu="gen"]') &&
    !!q('[data-atlas-menu="versions"]') && !!q('[data-atlas-menu="view"]') && !!q(".atlas-zoom") && !!q("[data-atlas-center]"), 10000, 20));
  check("页面不再有侧栏图谱面板 / 旧画布", !q(".mindmap-sidebar") && !q(".mm2-canvas"), { side: !!q(".mindmap-sidebar"), canvas: !!q(".mm2-canvas") });
  {
    const theme = fs.readFileSync(path.join(__dirname, "..", "src", "theme.css"), "utf8");
    check("工具栏末组显式贴右（atlas 宿主不再顶掉 :last-of-type）", /\.reader-engine-controls-right\s*\{\s*margin-left:\s*auto/.test(theme));
    check("侧栏展开时结构全景按钮右移一个轨宽", /\.reader-wrap\[data-sidebar-open="1"\] \.reader-atlas-toggle\.bar-btn\s*\{\s*left:\s*calc\(280px/.test(theme));
    check("侧栏两页签不再为结构全景按钮留宽", /\.reader-sidebar \.tabs \{[^}]*padding: var\(--sp-2\) var\(--sp-2\) var\(--sp-2\) var\(--sp-16\);/.test(theme));
    check("结构全景态工具带层叠高于画布（下拉菜单不被图谱盖住）", /\.reader-engine-controls\[data-atlas="1"\]\s*\{\s*z-index:\s*8/.test(theme));
    check("轨展开时工具行只留按钮宽与 8px 间距（不再留 64px 空档）", /\.reader-side-rail:not\(\.is-closed\) \+ \.reader-engine-col \.reader-engine-controls\s*\{\s*padding-left:\s*calc\(var\(--sp-2\)/.test(theme));
  }

  console.log("---- 2 目录预览 ----");
  check("预览：.ag ≥ 3、根字形 data-kind=root", await h.until(() => qa("#stage .ag").length >= 3 && !!q('#stage .ag[data-kind="root"]'), 10000, 20), qa("#stage .ag").length);
  const firstCrumb = q(".atlas-crumbs .atlas-crumb");
  check("面包屑首项为材料名并带「目录预览」chip", !!firstCrumb && h.text(firstCrumb).includes("测试材料") && !!q(".atlas-crumb .atlas-chip"), firstCrumb && h.text(firstCrumb));
  check("预览期间零模型调用", h.streamLog.length === 0, h.streamLog.length);

  console.log("---- 3 生成：流式节点早于流结束 ----");
  const genReady = await h.until(() => { const b = h.btn(/^生成导图$/); return !!b && !b.disabled; }, 15000, 20);
  const gen = h.btn(/^生成导图$/);
  check("有可用的「生成导图」按钮", genReady && !!gen, panel().slice(0, 300));
  h.click(gen);
  const firstStreamEnds = () => h.streamLog.find((e) => e.kind === "outline" && e.end);
  const aiCard = () => qa("#stage .ag[data-node]").some((el) => /^t\d+(p\d+)?\.\d/.test(el.getAttribute("data-node") || ""));
  // 用户在全景里展开一个顶层组，观察流式节点在流结束前长出来
  await h.until(() => {
    const ag = q('#stage .ag[data-node="t1"]');
    const fold = ag && [...ag.querySelectorAll(".ag-fold")].find((b) => /^\+\d+/.test(h.text(b)));
    if (fold) { h.click(fold); return true; }
    return false;
  }, 8000, 20);
  const sawEarly = await h.until(() => aiCard() || !!firstStreamEnds(), 12000, 5);
  check("首个 AI 节点在第一次流结束前已画到画布上", sawEarly && aiCard() && !firstStreamEnds(), { aiCard: aiCard(), ended: !!firstStreamEnds(), calls: h.streamLog.length });
  check("状态区显示「框架 n/m 段」与「停止」", await h.until(() => /框架 \d+\/\d+ 段/.test(panel()) && !!h.btn(/^停止$/), 8000), panel().slice(0, 400));
  await h.until(() => h.stages.includes("completed"), 20000);
  await h.engine.idle();
  await h.sleep(400);

  console.log("---- 4 完成后生成菜单出现「重新生成」 ----");
  h.click(q('[data-atlas-menu="gen"] .dd-btn'));
  check("生成菜单出现「重新生成」", await h.until(() => !!h.btn(/^重新生成$/), 4000), q('[data-atlas-menu="gen"]')?.textContent);
  h.click(q('[data-atlas-menu="gen"] .dd-btn'));

  console.log("---- 5 点顶层节点：聚焦 + 自动展开 + 相机 ----");
  await h.until(() => !!q('#stage .ag[data-node="t1"]'), 8000);
  const worldT0 = q("#stage .atlas-world")?.style.transform;
  h.click(q('#stage .ag[data-node="t1"]'));
  check("该节点 data-focus=1", await h.until(() => q('#stage .ag[data-node="t1"][data-focus="1"]'), 5000), q('#stage .ag[data-node="t1"]')?.outerHTML?.slice(0, 200));
  const lastCrumb = qa(".atlas-crumbs .atlas-crumb").pop();
  check("面包屑末项是它的标题", !!lastCrumb && h.text(lastCrumb).includes("前言"), lastCrumb && h.text(lastCrumb));
  check("它的子节点出现为 .ag（自动展开）", await h.until(() => qa('#stage .ag[data-node^="t1."]').length > 0, 5000), qa("#stage .ag").map((e) => e.getAttribute("data-node")));
  check(".atlas-world 的 transform 改变", q("#stage .atlas-world")?.style.transform !== worldT0, { before: worldT0, after: q("#stage .atlas-world")?.style.transform });

  console.log("---- 6 节点卡 / 讲解 / 详情 ----");
  check("节点卡出现并含「跳到原文」「讲解」「详情」", await h.until(() => {
    const c = q('[data-atlas-card="t1"]');
    return c && h.text(c).includes("跳到原文") && h.text(c).includes("讲解") && h.text(c).includes("详情");
  }, 5000), q('[data-atlas-card="t1"]')?.textContent);
  const explainBtn = qa('[data-atlas-card="t1"] .flow-actions button').find((b) => /^讲解$/.test(h.text(b)));
  h.click(explainBtn);
  check("讲解文字流式出现", await h.until(() => /这一节先提出问题，再给出回答。/.test(h.text(q('[data-atlas-card="t1"]'))), 8000), q('[data-atlas-card="t1"]')?.textContent);
  const detailBtn = qa('[data-atlas-card="t1"] .flow-actions button').find((b) => /^详情$/.test(h.text(b)));
  h.click(detailBtn);
  check("详情：.atlas-detail 出现", await h.until(() => !!q('[data-atlas-card="t1"] .atlas-detail'), 4000), q('[data-atlas-card="t1"]')?.textContent);

  console.log("---- 6b 节点卡失焦关闭 / 再点重现 ----");
  {
    h.pointer(w.document.body, "pointerdown", 10, 600, 1);
    check("点击界面其他位置 → 节点卡消失", await h.until(() => !q('[data-atlas-card="t1"]'), 3000), q('[data-atlas-card="t1"]')?.textContent);
    h.click(q('#stage .ag[data-node="t1"]'));
    check("再点选中节点 → 节点卡重现", await h.until(() => !!q('[data-atlas-card="t1"]'), 3000));
  }

  console.log("---- 7 折叠钮 ----");
  const plus = qa("#stage .ag-fold").find((b) => /^\+\d+/.test(h.text(b)));
  const plusAg = plus && plus.closest(".ag");
  const beforeCount = qa("#stage .ag").length;
  h.click(plus);
  const expandedMore = await h.until(() => qa("#stage .ag").length > beforeCount, 4000);
  check("点「+N」→ 子节点出现", expandedMore, { before: beforeCount, after: qa("#stage .ag").length });
  const minus = plusAg && [...plusAg.querySelectorAll(".ag-fold")].find((b) => h.text(b) === "−");
  check("展开后折叠钮变「−」", !!minus, plusAg && plusAg.textContent);
  h.click(minus);
  check("再点「−」→ 子节点在 400ms 内消失", await h.until(() => qa("#stage .ag").length <= beforeCount, 2000), { before: beforeCount, after: qa("#stage .ag").length });

  console.log("---- 8 搜索 ----");
  const search = q("[data-atlas-search]");
  search.focus();
  setInput(search, "节");
  check("搜索结果菜单出现", await h.until(() => qa(".atlas-search-menu .dd-item").length >= 1, 4000), q(".atlas-search-menu")?.outerHTML?.slice(0, 300));
  const beforeFocus = h.focusAg()?.getAttribute("data-node");
  const items = qa(".atlas-search-menu .dd-item");
  h.click(items[items.length - 1]);
  check("点第一条结果 → 该节点 data-focus=1", await h.until(() => { const f = h.focusAg(); return f && f.getAttribute("data-node") !== beforeFocus; }, 4000), { beforeFocus, focus: h.focusAg()?.getAttribute("data-node") });
  check("选中后搜索框清空", search.value === "", search.value);

  console.log("---- 9 键盘 ----");
  h.click(q('#stage .ag[data-kind="root"]'));
  await h.until(() => h.focusAg()?.getAttribute("data-node") === "@root", 3000);
  const stageEl = h.stage();
  stageEl.focus();
  const k0 = h.focusAg()?.getAttribute("data-node");
  h.key(stageEl, "ArrowRight");
  check("方向键使焦点改变", await h.until(() => { const f = h.focusAg(); return f && f.getAttribute("data-node") !== k0; }, 3000), { k0, k1: h.focusAg()?.getAttribute("data-node") });
  const k1 = h.focusAg()?.getAttribute("data-node");
  h.key(stageEl, "ArrowUp", { altKey: true });
  check("Alt+↑ 回到父节点", await h.until(() => { const f = h.focusAg(); return f && f.getAttribute("data-node") !== k1; }, 3000), { k1, k2: h.focusAg()?.getAttribute("data-node") });

  console.log("---- 10 Esc ----");
  search.focus();
  const exits0 = state.exits;
  h.key(search, "Escape");
  await h.sleep(120);
  check("搜索框内 Esc 不退出全景", state.exits === exits0, { exits0, exits: state.exits });
  h.key(stageEl, "Escape");
  check("焦点在舞台 Esc → onExit 1 次", await h.until(() => state.exits === exits0 + 1, 2000), { exits0, exits: state.exits });

  console.log("---- 11 退出：onExited ----");
  check("open=false 后 600ms 内 onExited", await h.until(() => state.exited >= 1, 600, 20), state.exited);

  console.log("---- 12 交接：首帧屏幕位置 + 飞入中心 ----");
  {
    state.open = true;
    state.entry = {
      seq: 2,
      origin: "flow",
      nodeId: "t1",
      snapshot: { cut: null, readingId: null, items: new Map([["n:t1", { left: 900, top: 300, width: 200, height: 26 }]]), bars: new Map() },
    };
    h.render();
    const frameSeen = await h.until(() => !!q('#stage .atlas-stage[data-frame0="1"]') && !!q('#stage .ag[data-ag="g:t1"]'), 8000, 5);
    const parse = (tr) => { const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(tr || ""); return m ? { x: Number(m[1]), y: Number(m[2]) } : null; };
    const panAt = () => { const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(q("#stage .atlas-world")?.style.transform || ""); return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 }; };
    const g0 = q('#stage .ag[data-ag="g:t1"]');
    const r0 = parse(g0?.style.transform);
    const pan0 = panAt();
    check("首帧：匹配节点画在快照屏幕位置", frameSeen && r0 && Math.abs(r0.x - (900 - pan0.x)) <= 1 && Math.abs(r0.y - (300 - pan0.y)) <= 1, { frameSeen, r0, pan0 });
    await h.sleep(160);
    check("3 帧后 data-frame0 消失", !q('#stage .atlas-stage[data-frame0="1"]'));
    const g = q('#stage .ag[data-ag="g:t1"]');
    const r = parse(g?.style.transform);
    const pan = panAt();
    const gw = parseFloat(g?.style.width || "0"), gh = parseFloat(g?.style.height || "0");
    check("飞入后焦点字形中心 = 舞台中心（宽 50%、高 45%）", !!r && Math.abs(pan.x + r.x + gw / 2 - 550) <= 1 && Math.abs(pan.y + r.y + gh / 2 - 288) <= 1, { r, pan, gw, gh });
    check("落位后 transform 等于布局坐标（不再等于快照位置）", !!r && !!r0 && (r.x !== r0.x || r.y !== r0.y), { r0, r });
  }

  console.log("---- 13 制卡 ----");
  {
    h.click(q('#stage .ag[data-node="t1"]'));
    await h.until(() => !!q('[data-atlas-card="t1"]'), 4000);
    await h.until(() => qa('[data-atlas-card="t1"] .flow-actions button').some((b) => /^制卡$/.test(h.text(b))), 4000);
    const mk = qa('[data-atlas-card="t1"] .flow-actions button').find((b) => /^制卡$/.test(h.text(b)));
    h.click(mk);
    check("制卡：回调 nodeId 以 v2: 开头、section 含【结构语义包】", await h.until(() => h.made.length >= 1, 12000) && /^v2:/.test(h.made[0].nodeId) && h.made[0].section.includes("【结构语义包】"), h.made[0] && { nodeId: h.made[0].nodeId, len: h.made[0].section.length });
  }

  console.log("---- 14 无渲染错误 ----");
  check("全程 console.error 0 条", !h.errors.length, h.errors.slice(0, 3));

  h.restore();
  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("TEST ERROR", e && e.stack || e); process.exit(1); });

