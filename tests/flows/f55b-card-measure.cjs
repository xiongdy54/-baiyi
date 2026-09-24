// F55B 定点量那张「四十字长标题」卡：溢出/重叠到底存不存在
// @runtime: node  @tier: 2  @gui: true  @id: F55B  @timeout: 300
// 运行：先 npx electron tests/flows/f48b-seed.cjs，再 node tests/flows/f55b-card-measure.cjs
//
// 为什么要定点量：F55 的通用相交检在六屏上报 0，而我在 f48v-1-书架.png 上看到第 7 张卡标题排 7 行、
// 最后一行压到卡片下边界。两者不收敛 ⇒ 要么我看错，要么通用检的叶子过滤器漏了这个元素。
// 这一条不做普查，只把那一张卡的每个矩形、计算样式、以及它与下方 meta 行的相交面积**逐条打数字**。
"use strict";
const path = require("path");
const { Flow, runFlow, RESULTS_DIR } = require("./lib/harness.cjs");
const { launch, shutdown, wait } = require("./lib/guienv.cjs");

const flow = new Flow({
  id: "F55B",
  title: "长标题卡定点测量",
  angle: "一张卡的标题/封面块/meta 行矩形与计算样式，收敛视觉读法与普查读法的冲突",
  cites: ["§5.1", "§5.4"],
  tier: 2,
  gui: true,
});

const TARGET = "关于渐进阅读与间隔重复";

runFlow(flow, async () => {
  const h = await launch({ label: "f48", port: 9875, fresh: false, logName: path.join(RESULTS_DIR, "f55b.app.log") });
  if (h.skip || h.skippedByExit || h.timeout) {
    flow.check("打开已播种沙箱", false, "成功", h.reason || "skip");
    return;
  }
  try {
    await wait(7000);
    await h.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await wait(1500);
    await h.evaluate(`const el=[...document.querySelectorAll('.nav-item')].find(x=>(x.textContent||'').trim()==='书架'); if(el) el.click(); return 1;`);
    await wait(2800);

    flow.section("M1 找到那张卡并逐元素量");
    const r = await h.evaluate(`
      const KEY = ${JSON.stringify(TARGET)};
      const cards = [...document.querySelectorAll('.book-card')];
      const card = cards.find(c => (c.innerText||'').includes(KEY));
      if (!card) return JSON.stringify({err:'card-not-found', 卡数: cards.length, 标题列表: cards.slice(0,9).map(c=>(c.innerText||'').trim().slice(0,12))});
      const box = (el) => { const b = el.getBoundingClientRect(); return {l:Math.round(b.left),t:Math.round(b.top),r:Math.round(b.right),b:Math.round(b.bottom),w:Math.round(b.width),h:Math.round(b.height)}; };
      // 卡内所有**含文字**的元素（不再用 children.length 过滤，这正是 F55 可能漏掉它的原因）
      const withText = [...card.querySelectorAll('*')].filter(el => (el.textContent||'').trim().length > 0);
      const rows = withText.map(el => {
        const cs = getComputedStyle(el);
        return {
          标签: el.tagName.toLowerCase(),
          类: String(el.className||'').split(/\\s+/).filter(Boolean).slice(0,2).join('.'),
          矩形: box(el),
          自身有子元素: el.childElementCount,
          文字长度: (el.textContent||'').trim().length,
          overflow: cs.overflow,
          行数上限: cs.webkitLineClamp,
          换行: cs.whiteSpace,
          scrollH: el.scrollHeight, clientH: el.clientHeight,
        };
      });
      const cardBox = box(card);
      // 溢出：元素底边超过卡片底边
      const spills = rows.filter(x => x.矩形.b > cardBox.b + 1 && x.自身有子元素 === 0);
      // 相交：叶子文字元素两两求交（允许一层内嵌，只要自身有直接文字）
      const leafish = withText.filter(el => {
        const own = [...el.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim().length > 0);
        return own || el.childElementCount === 0;
      }).map(el => ({ el, b: el.getBoundingClientRect(), t: (el.textContent||'').trim().slice(0,12) }));
      const hits = [];
      for (let i=0;i<leafish.length;i++) for (let j=i+1;j<leafish.length;j++) {
        const A = leafish[i], B = leafish[j];
        if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
        const x = Math.max(0, Math.min(A.b.right,B.b.right) - Math.max(A.b.left,B.b.left));
        const y = Math.max(0, Math.min(A.b.bottom,B.b.bottom) - Math.max(A.b.top,B.b.top));
        const inter = x*y; if (inter <= 0) continue;
        const smaller = Math.max(1, Math.min(A.b.width*A.b.height, B.b.width*B.b.height));
        const ratio = inter/smaller;
        if (ratio > 0.15) hits.push({比率:+(ratio*100).toFixed(0), A:A.t, B:B.t,
          A类:String(A.el.className||'').split(/\\s+/).filter(Boolean).slice(0,2).join('.'),
          B类:String(B.el.className||'').split(/\\s+/).filter(Boolean).slice(0,2).join('.')});
      }
      return JSON.stringify({卡片矩形: cardBox, 含文字元素数: rows.length, 元素明细: rows.slice(0,14), 溢出卡片底边的叶子: spills.map(s=>({类:s.类,文字:s.矩形&&'' ,超出px:s.矩形.b-cardBox.b,标签:s.标签})), 相交对: hits.slice(0,6), 相交总数: hits.length});`);
    const j = JSON.parse(String(r.value || "{}"));
    if (j.err) {
      flow.record("未找到目标卡", JSON.stringify(j).slice(0, 260));
      flow.check("目标长标题卡必须在场（播种形状变了就重播）", false, "在场", j);
      return;
    }
    flow.record("卡片矩形", JSON.stringify(j.卡片矩形));
    flow.record("卡内含文字元素数", j.含文字元素数);
    for (const x of j.元素明细) {
      flow.record(
        `  ${x.标签}.${x.类}`,
        `矩形 ${JSON.stringify(x.矩形)} · 子元素 ${x.自身有子元素} · 文字 ${x.文字长度} · overflow=${x.overflow} lineClamp=${x.行数上限} whiteSpace=${x.换行} scrollH/clientH=${x.scrollH}/${x.clientH}`
      );
    }
    flow.record("溢出卡片底边的叶子元素", JSON.stringify(j.溢出卡片底边的叶子));
    flow.record("卡内文字元素相交对（>15%）", `${j.相交总数} 对 · ${JSON.stringify(j.相交对)}`);
    await h.shot("f55b-target-card");

    flow.section("M2 判定（两种结果都是有价值的答案）");
    const spillN = (j.溢出卡片底边的叶子 || []).length;
    const hitN = j.相交总数 || 0;
    flow.record("普查式判据(F55) vs 定点判据(本条)", `F55 报 0；本条报 溢出 ${spillN} / 相交 ${hitN}`);
    flow.check(
      "定点判据必须给出可判读答案：要么证实溢出/重叠存在（登记缺陷），要么证伪（撤回 F46-V1）",
      true,
      "给出数字",
      { 溢出: spillN, 相交: hitN }
    );
  } finally {
    await shutdown(h);
  }
});
