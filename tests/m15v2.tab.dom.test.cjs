// @runtime: system-node
// 材料导图 v2 · 全景端到端 DOM 回归（D254 §16.3：由旧页签测试改写）。
// 运行：node tests/m15v2.tab.dom.test.cjs（system-node；夹具 tests/lib/atlasDomHarness.cjs）。
// 保留：流式早于流结束 / 重新生成 / 节点卡讲解与详情 / 制卡 / 深挖；新增：拖动舞台只改相机不重建字形。
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
  const firstStreamEnds = () => h.streamLog.find((e) => e.kind === "outline" && e.end);
  const aiId = (el) => /^t\d+(p\d+)?\.\d/.test(el.getAttribute("data-node") || "");

  h.render();

  console.log("---- 生成：流式节点早于流结束 ----");
  check("挂载后目录预览出现（零调用）", await h.until(() => qa("#stage .ag").length >= 3, 10000, 20));
  const genReady = await h.until(() => { const b = h.btn(/^生成导图$/); return !!b && !b.disabled; }, 15000, 20);
  const gen = h.btn(/^生成导图$/);
  check("有可用的「生成导图」按钮", genReady && !!gen);
  h.click(gen);
  // 用户展开顶层组后观察流式节点
  await h.until(() => {
    const ag = q('#stage .ag[data-node="t1"]');
    const fold = ag && [...ag.querySelectorAll(".ag-fold")].find((b) => /^\+\d+/.test(h.text(b)));
    if (fold) { h.click(fold); return true; }
    return false;
  }, 8000, 20);
  const sawEarly = await h.until(() => qa("#stage .ag[data-node]").some(aiId) || !!firstStreamEnds(), 12000, 5);
  check("首个 AI 节点在第一次流结束前已画到画布上", sawEarly && qa("#stage .ag[data-node]").some(aiId) && !firstStreamEnds(), { card: qa("#stage .ag[data-node]").some(aiId), ended: !!firstStreamEnds(), calls: h.streamLog.length });
  check("生成中状态区显示「框架 n/m 段」与「停止」", await h.until(() => /框架 \d+\/\d+ 段/.test(panel()) && !!h.btn(/^停止$/), 8000));
  await h.until(() => h.stages.includes("completed"), 25000);
  await h.engine.idle();
  await h.sleep(400);

  console.log("---- 完成后生成菜单出现「重新生成」 ----");
  h.click(q('[data-atlas-menu="gen"] .dd-btn'));
  check("生成菜单出现「重新生成」", await h.until(() => !!h.btn(/^重新生成$/), 4000));
  h.click(q('[data-atlas-menu="gen"] .dd-btn'));

  console.log("---- 节点卡：讲解 / 详情 ----");
  h.click(q('#stage .ag[data-node="t1"]'));
  check("节点卡出现", await h.until(() => !!q('[data-atlas-card="t1"]'), 5000));
  const exBtn = qa('[data-atlas-card="t1"] .flow-actions button').find((b) => /^讲解$/.test(h.text(b)));
  h.click(exBtn);
  check("讲解流式显示并落库", await h.until(() => /这一节先提出问题，再给出回答。/.test(h.text(q('[data-atlas-card="t1"]'))), 8000));
  const detBtn = qa('[data-atlas-card="t1"] .flow-actions button').find((b) => /^详情$/.test(h.text(b)));
  h.click(detBtn);
  check("详情：.atlas-detail 出现", await h.until(() => !!q('[data-atlas-card="t1"] .atlas-detail'), 4000));

  console.log("---- 就此制卡 ----");
  const mkReady = await h.until(() => qa('[data-atlas-card="t1"] .flow-actions button').some((b) => /^制卡$/.test(h.text(b))), 4000);
  const mk = qa('[data-atlas-card="t1"] .flow-actions button').find((b) => /^制卡$/.test(h.text(b)));
  h.click(mk);
  check("就此制卡：回调收到 v2 结构语义包", mkReady && await h.until(() => h.made.length === 1, 12000) && /^v2:/.test(h.made[0].nodeId) && h.made[0].section.length <= 1200 && h.made[0].section.includes("【结构语义包】"), h.made[0] && { nodeId: h.made[0].nodeId, len: h.made[0].section.length });

  console.log("---- 焦点 state:'more' 节点 → 卡内「深挖」→ 子节点出现 ----");
  {
    // 从库里挑一个 state='more' 且尚无子行的 AI 节点：这才能证明「深挖」是它的作用
    const mapId = h.store.getActiveMaterialMap("doc-dom", "book").id;
    const rows = h.store.listMaterialMapNodes(mapId);
    const hasChild = new Set(rows.map((r) => r.parentId).filter(Boolean));
    const target = rows.find((r) => r.source === "ai" && r.state === "more" && !hasChild.has(r.nodeId));
    check("库里存在 state='more' 的 AI 节点", !!target, rows.filter((r) => r.state === "more").slice(0, 5).map((r) => r.nodeId));
    // 用搜索定位（宿主会展开它的祖先）
    const search = q("[data-atlas-search]");
    search.focus();
    const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
    setter.call(search, target ? target.title : "");
    search.dispatchEvent(new w.Event("input", { bubbles: true }));
    const findItem = () => [...w.document.querySelectorAll(".atlas-search-menu .dd-item")].find((b) => h.text(b).startsWith(target ? target.title : ""));
    const found = await h.until(() => !!findItem(), 4000);
    const item = findItem();
    check("搜索结果能定位到该节点", found && !!item);
    h.click(item);
    const focusOk = await h.until(() => !!q(`[data-atlas-card="${target.nodeId}"]`), 4000);
    const before = h.streamLog.length;
    const deepBtn = focusOk && qa(`[data-atlas-card="${target.nodeId}"] .flow-actions button`).find((b) => /^深挖$/.test(h.text(b)));
    check("焦点 state='more' 节点时卡内出现「深挖」", !!deepBtn);
    h.click(deepBtn);
    await h.until(() => h.streamLog.length > before, 8000);
    await h.engine.idle();
    const kidsOk = await h.until(() => qa(`#stage .ag[data-node^="${target.nodeId}."]`).length >= 2, 8000);
    check("卡内「深挖」→ 子节点出现为 .ag", !!deepBtn && h.streamLog.length === before + 1 && kidsOk, { nid: target.nodeId, calls: h.streamLog.length - before, kids: qa(`#stage .ag[data-node^="${target.nodeId}."]`).length });
  }

  console.log("---- 面包屑折叠选单（深层节点） ----");
  {
    const more = q("#toolbar .atlas-crumb-more");
    check("深层节点面包屑出现「…」选单钮", !!more, qa("#toolbar .atlas-crumb").map((e) => h.text(e)));
    h.click(more);
    check("点「…」弹出中间层级菜单", await h.until(() => qa(".atlas-crumbs-menu .dd-item").length >= 1, 3000), q(".atlas-crumbs-menu")?.textContent);
    const before = h.focusAg()?.getAttribute("data-node");
    h.click(q(".atlas-crumbs-menu .dd-item"));
    check("点菜单项跳到该层级", await h.until(() => { const f = h.focusAg(); return f && f.getAttribute("data-node") !== before; }, 3000), { before, after: h.focusAg()?.getAttribute("data-node") });
  }

  console.log("---- 拖动舞台：只改相机，不重建字形 ----");
  {
    await h.sleep(700);
    const world = q("#stage .atlas-world");
    const t0 = world.style.transform;
    const ag0 = q('#stage .ag[data-node="t1"]');
    const stageEl = h.stage();
    h.pointer(stageEl, "pointerdown", 500, 400, 1);
    for (let x = 510; x <= 620; x += 10) h.pointer(stageEl, "pointermove", x, 400, 1);
    h.pointer(stageEl, "pointerup", 620, 400, 0);
    await h.sleep(120); // 等吞掉合成 click 的窗口过去
    const ag1 = q('#stage .ag[data-node="t1"]');
    check("拖动空白 → .atlas-world transform 改变", world.style.transform !== t0, { t0, t1: world.style.transform });
    check("拖动后 .ag 元素引用不变（不重建内容层）", ag0 === ag1, { same: ag0 === ag1 });
    state.open = true;
  }

  check("全程无渲染错误", !h.errors.length, h.errors.slice(0, 3));

  h.restore();
  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("TEST ERROR", (e && e.stack) || e); process.exit(1); });
