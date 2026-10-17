// @runtime: node
// 材料导图 v2 画布纯模块 III · SVG 生成 + 动画稳定性回归（node 直跑：node tests/m15v2.svg.test.cjs）。
// 契约：docs/design/MINDMAP-V2-IMPL-PLAN.md §0 X5、§5.1 svg.ts / animate.ts、§6 T7 ⑤–⑧；设计稿 §5 四态、§8.2、§15.8 S3 S4 S8 / LOD。
// Display 一律由 layoutGraph 真实生成；所有组手动锁定 tree / chain。
"use strict";
const path = require("path");
require("./lib/tsload.cjs");
const V2 = path.join(__dirname, "..", "src", "lib", "mindmap", "v2");
const T = require(path.join(V2, "types.ts"));
const G = require(path.join(V2, "graph.ts"));
const L = require(path.join(V2, "layout.ts"));
const R = require(path.join(V2, "route.ts"));
const S = require(path.join(V2, "svg.ts"));
const A = require(path.join(V2, "animate.ts"));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "").slice(0, 800)}`); }
}
const ROOT = T.ROOT_ID;

let ordSeq = 0;
function mk(id, parentId, type, title, extra = {}) {
  ordSeq += 1;
  return {
    id, parentId, ord: extra.ord ?? ordSeq * 1000, title, type,
    timeText: null, patternHint: null, blockStart: null, blockEnd: null, spans: null,
    state: extra.state ?? "floor", source: "ai", warnings: null, jobId: extra.jobId ?? null,
  };
}
const EVIL = `<script>alert("x")</script> & "q" 'a' <img src=x onerror=alert(1)>`;
function load() {
  ordSeq = 0;
  const nodes = [
    mk("A", null, "背景", "背景 " + EVIL, { state: "open" }),
    mk("A1", "A", "叙事", "可深挖的叙事", { state: "more" }),
    mk("A2", "A", "叙事", "已触底的叙事"),
    mk("A3", "A", "叙事", "生成中的叙事", { state: "streaming", jobId: "j1" }),
    mk("A4", "A", "叙事", "有子但折叠", { state: "open" }),
    mk("A4a", "A4", "要点", "被折叠的子 1"),
    mk("A4b", "A4", "要点", "被折叠的子 2"),
    mk("B", null, "命题", "证明 & 推导", { state: "open" }),
    mk("B1", "B", "定义", "定义"),
    mk("B2", "B", "前提", "前提"),
    mk("B3", "B", "推导", "推导 " + EVIL, { state: "open" }),
    mk("B3a", "B3", "推导", "子推导"),
    mk("B3b", "B3", "推导", "子推导 2"),
    mk("C", null, "论点", "论点", { state: "open" }),
    mk("C1", "C", "理由", "理由"), mk("C2", "C", "反方观点", "反方"), mk("C3", "C", "反驳", "反驳"),
    mk("C4", "C", "证据", "证据"), mk("C5", "C", "例证", "例证"), mk("C6", "C", "问题", "问题"),
    mk("C7", "C", "方案", "方案"), mk("C8", "C", "结论", "结论"),
  ];
  const edges = [
    { from: "C1", to: "B", code: "支" }, { from: "C3", to: "C2", code: "驳" }, { from: "B2", to: "B1", code: "据" },
    { from: "B3", to: "A2", code: "推" }, { from: "A1", to: "C8", code: "因" }, { from: "C4", to: "C5", code: "比" },
    { from: "C5", to: "A2", code: "例" }, { from: "C8", to: "C6", code: "答" },
  ];
  const patterns = { [ROOT]: "tree", A: "tree", B: "chain", B3: "chain", C: "tree", A4: "tree" };
  return { meta: { mapId: "m", title: "标题 " + EVIL }, nodes, edges, view: { patterns, collapsed: ["A4"] } };
}
const state = () => G.createGraph(load());

console.log("---- ⑤ X5 转义 ----");
{
  check("escapeXml：& < > \" ' 与控制字符", S.escapeXml(`a&b<c>d"e'f\u0001g`) === "a&amp;b&lt;c&gt;d&quot;e&#39;fg");
  const s = state();
  const d = L.layoutGraph(s);
  const r = R.routeRelations(s, d, { relAll: true, zoom: 1 });
  const svg = S.buildCanvasSvg(d, r, { selected: "B3", hovered: "C1" }, { graph: s });
  const svgS = S.buildCanvasSvg(d, r, {}, { graph: s, static: true });
  for (const [name, out] of [["交互", svg], ["导出", svgS]]) {
    check(`${name}：标题含 <script>/&/" 输出无原样标签`, !/<script|<img|onerror=alert\(1\)>/i.test(out) && !out.includes('"x")') && out.includes("&lt;script&gt;"), out.slice(0, 200));
    check(`${name}：& 均为实体（无裸 &）`, !/&(?!amp;|lt;|gt;|quot;|#39;)/.test(out));
    check(`${name}：根标题经转义写入`, out.includes("标题 &lt;script&gt;") || out.includes("标题 &lt;"));
  }
  // 属性注入：恶意 id / labels / idPrefix / theme
  const evilLabels = { deepen: '"><script>1</script>', summary: () => "<b>x</b>" };
  const out2 = S.buildCanvasSvg(d, r, {}, { graph: s, labels: evilLabels, idPrefix: '"><x', static: true, theme: { accent: "red;}</style><script>", paper: "url(javascript:alert(1))" } });
  check("labels / idPrefix 注入被转义", !out2.includes("<script>") && !out2.includes('"><x'));
  check("主题值白名单：非法值回落默认", out2.includes("--accent:#166a59") && !out2.includes("javascript") && out2.includes("--paper:#fafaf8"));
  // XML 良构（粗检：标签配平）
  const open = (svg.match(/<(?!\/)[a-zA-Z][^>]*[^/]>/g) || []).length, close = (svg.match(/<\/[a-zA-Z]+>/g) || []).length;
  check("交互 SVG 标签配平", open === close, { open, close });
}

console.log("---- 四态徽标 / 钩子 / 线型 / 颜色 ----");
{
  const s = state();
  const d = L.layoutGraph(s);
  const r = R.routeRelations(s, d, { relAll: true, zoom: 1, selected: "C1" });
  const svg = S.buildCanvasSvg(d, r, { selected: "C1" }, { graph: s });
  const nodeG = (id) => { const i = svg.indexOf(`data-node-id="${id}"`); return i < 0 ? "" : svg.slice(i, svg.indexOf("</g>", svg.indexOf("<rect", i)) + 200); };
  check("每张可见卡片 data-node-id", d.items.filter((i) => i.kind === "card").every((c) => svg.includes(`data-node-id="${S.escapeXml(c.id)}"`)));
  check("more：＋ 深挖按钮 data-act=\"deepen\"", /data-act="deepen" data-node-id="A1"/.test(svg));
  check("floor：末端圆点 •（无深挖入口）", nodeG("A2").includes('r="2.5"') && !/data-act="deepen" data-node-id="A2"/.test(svg));
  check("streaming：虚线 + 呼吸点（animate）", nodeG("A3").includes('stroke-dasharray="4 3"') && nodeG("A3").includes("<animate"));
  check("collapsed：+N 折叠数（+2）且 data-act=unfold", /data-act="unfold" data-node-id="A4"/.test(svg) && svg.includes(">+2<"));
  const accentFills = (svg.match(/fill="var\(--accent\)"/g) || []).length;
  const rootG = nodeG(ROOT);
  check("根卡为唯一 accent 填充的矩形", /<rect[^>]*fill="var\(--accent\)"/.test(rootG) && (svg.match(/<rect[^>]*fill="var\(--accent\)"/g) || []).length === 1, accentFills);
  check("颜色一律 CSS 变量（无 hex / rgb 字面量）", !/(fill|stroke)="(#|rgb)/.test(svg) && !/#[0-9a-f]{3,6}"/i.test(svg));
  check("组框 + 「版式 · 来源」小字", svg.includes('data-frame-id="B"') && svg.includes("链 · 手动"));
  // 八类关系线型：dash + 端头组合两两不同；不靠颜色区分
  const sig = Object.entries(R.REL_STYLE).map(([k, v]) => `${v.dash}|${v.end}|${v.start}|${v.width}`);
  check("八类关系：线型/端头/线宽签名两两不同", new Set(sig).size === 8, sig);
  const relPaths = svg.match(/<path [^>]*data-edge-id="[^"]+"[^>]*>/g) || [];
  check("关系线：非高亮统一 --text-secondary，高亮 --accent", relPaths.length === r.edges.filter((e) => e.d).length && relPaths.every((p) => /stroke="var\(--(text-secondary|accent)\)"/.test(p)));
  const hotIds = r.edges.filter((e) => e.hot).map((e) => e.id);
  check("与选中节点相连的关系 accent + accent 端头", hotIds.length > 0 && hotIds.every((id) => relPaths.some((p) => p.includes(`data-edge-id="${S.escapeXml(id)}"`) && p.includes('stroke="var(--accent)"') && /m-\w+-a\)/.test(p))));
  for (const code of T.REL_CODES) {
    const e = r.edges.find((x) => x.code === code && x.d);
    if (!e) continue;
    const st = R.REL_STYLE[code];
    const p = relPaths.find((x) => x.includes(`data-edge-id="${S.escapeXml(e.id)}"`)) || "";
    const ok = p.includes(`m-${st.end}-`) && (st.dash ? p.includes(`stroke-dasharray="${st.dash}"`) : !p.includes("stroke-dasharray")) && (st.start ? p.includes(`marker-start="url(#mm2-m-${st.start}-`) : !p.includes("marker-start"));
    check(`线型「${code}」：${st.dash || "实线"} + ${st.end}${st.start ? " + 起点 " + st.start : ""}`, ok, p);
  }
  check("marker 定义齐全（4 端头 × 常态/高亮 + 先后线）", ["arrow", "open", "bar", "dot"].every((k) => svg.includes(`id="mm2-m-${k}-n"`) && svg.includes(`id="mm2-m-${k}-a"`)) && svg.includes('id="mm2-m-seq"'));
  // ↗N：默认策略下显示计数徽标；relAll 下不显示
  const r0 = R.routeRelations(s, d, {});
  const svg0 = S.buildCanvasSvg(d, r0, {}, { graph: s });
  const cc = r0.crossCount.C1;
  check("↗N：默认策略卡片右上角计数", cc > 0 && svg0.includes(`>${cc}</text><title>${cc} 条跨组关系`), r0.crossCount);
  check("↗N：全部关系开时不显示计数", !svg.includes("条跨组关系"));
  check("默认策略：跨组关系不画线", !(svg0.match(/data-edge-id=/g) || []).length);
  // 关系透视：无关卡片 35%
  const rf = R.routeRelations(s, d, { selected: "C1", focus: true });
  const svgF = S.buildCanvasSvg(d, rf, { selected: "C1" }, { graph: s });
  check("关系透视：无关卡片降到 0.35，相关保持全亮", /data-node-id="A2" opacity="0.35"/.test(svgF) && !/data-node-id="C1" opacity/.test(svgF) && !/data-node-id="B" opacity/.test(svgF));
}

console.log("---- static 导出 ----");
{
  const s = state();
  const d = L.layoutGraph(s);
  const r = R.routeRelations(s, d, { relAll: true });
  const out = S.buildCanvasSvg(d, r, { selected: "C1", hovered: "B", fresh: ["A1"], view: { tx: 100, ty: 0, k: 2 } }, { graph: s, static: true });
  check("static：无 data-act / 无任何 data-*", !out.includes("data-act") && !/ data-[a-z-]+=/.test(out));
  check("static：无动画元素（animate / set / animateTransform）", !/<(animate|set|animateTransform|animateMotion)\b/.test(out));
  check("static：自包含（xmlns、viewBox、内置 CSS 变量取值、背景底色）", out.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') && /viewBox="-24 -24 /.test(out) && out.includes("--paper:#fafaf8") && out.includes("--accent:#166a59") && /<rect x="-24" y="-24"[^>]*fill="var\(--paper\)"/.test(out));
  check("static：忽略选中 / 视口（无 transform scale）", !out.includes("scale(") && !/<rect[^>]*stroke-width="2"/.test(out));
  check("static：无脚本 / 外链 / 事件属性", !/<script|href=|xlink:|\son[a-z]+=/i.test(out));
  check("交互模式包含 viewport transform", S.buildCanvasSvg(d, r, { view: { tx: 10, ty: 20, k: 0.5 } }, { graph: s, fragment: true }).includes("translate(10,20) scale(0.5)"));
}

console.log("---- LOD 摘要卡 ----");
{
  const s = state();
  const d = L.layoutGraph(s);
  const lod = A.lodFrames(d, 0.2);
  const r = R.routeRelations(s, d, { relAll: true, lodCollapsed: lod });
  const svg = S.buildCanvasSvg(d, r, { lodCollapsed: lod }, { graph: s });
  check("zoom<0.25：框收成摘要卡（「链 · N 个子结构」）且框内卡片不渲染", lod.includes("B") && svg.includes("链 · ") && !svg.includes('data-node-id="B1"') && svg.includes('data-node-id="B"'), lod);
  check("LOD：收起框内的关系提升到框头（无指向隐藏卡片的线）", r.edges.every((e) => e.from !== "B1" && e.to !== "B1" && e.from !== "B2"));
}

console.log("---- 动画：⑥ 锚点补偿 / ⑦ 单调节流 / ⑧ reduced-motion ----");
{
  let s = state();
  const d0 = L.layoutGraph(s);
  const view = { tx: 37, ty: -120, k: 0.8 };
  // 深挖 A1：在其下插入 3 个子（A1 本身、其前的兄弟不动；后面的兄弟下移）
  const s1 = G.applyDelta(G.applyDelta(s, { mapId: "m", kind: "nodes", nodes: [mk("A1.1", "A1", "要点", "新子 1"), mk("A1.2", "A1", "要点", "新子 2"), mk("A1.3", "A1", "要点", "新子 3")] }), { mapId: "m", kind: "states", states: [{ id: "A1", state: "open" }] });
  // 让锚点在新布局中实际位移：在 A 前插入一个顶层节点（把 A 子树整体下推）
  const s2 = G.applyDelta(s1, { mapId: "m", kind: "nodes", nodes: [mk("Z0", null, "背景", "新插入在最前的章节", { ord: 1 })] });
  const d1 = L.layoutGraph(s2);
  const anchor = "A1";
  const moved = d1.byId[anchor].y !== d0.byId[anchor].y || d1.byId[anchor].x !== d0.byId[anchor].x;
  const tr = A.planTransition(d0, d1, { view, anchorId: anchor });
  const before = A.screenOf(d0.byId[anchor], view);
  let maxDev = 0;
  for (let t = 0; t <= tr.duration + 20; t += 16) {
    const f = A.transitionFrame(tr, t);
    const p = A.screenOf(f.display.byId[anchor], f.view);
    maxDev = Math.max(maxDev, Math.hypot(p.x - before.x, p.y - before.y));
  }
  check(`⑥ 锚点补偿：画布坐标位移 ${moved ? "≠0" : "=0"}，全程屏幕位移 ${maxDev.toFixed(3)}px ≤1px`, moved && maxDev <= 1, { maxDev });
  const cv = A.compensateView(before, d1.byId[anchor], view);
  const after = A.screenOf(d1.byId[anchor], cv);
  check("compensateView：终态锚点屏幕位置不变", Math.abs(after.x - before.x) < 1e-9 && Math.abs(after.y - before.y) < 1e-9 && cv.k === view.k);
  // 进入位置：新卡从父卡位置长出，o=0
  const e1 = tr.from["A1.1"];
  const pA1 = d0.byId.A1;
  check("新元素从父卡片位置长出（右缘对齐、顶对齐、o=0）", e1 && e1.o === 0 && e1.y === pA1.y && e1.x + e1.w === pA1.x + pA1.w, e1);
  const mid = A.transitionFrame(tr, 120);
  check("过渡中：新元素半透明、旧元素在途", mid.opacity["A1.1"] > 0 && mid.opacity["A1.1"] < 1 && !mid.done);
  check("离场元素淡出（删除节点时）", (() => {
    const tr2 = A.planTransition(d1, d0, { view });
    const f = A.transitionFrame(tr2, 100);
    const lv = f.leaving.find((x) => x.id === "A1.1");
    return lv && lv.o > 0 && lv.o < 1 && A.transitionFrame(tr2, 400).leaving.length === 0;
  })());
  check("终帧 = 目标布局（引用相同）", A.transitionFrame(tr, tr.duration).display === d1 && A.transitionFrame(tr, tr.duration).done);
  check("interpolate：e=0 起点、e=1 终点、中点线性", (() => {
    const a = { x: 0, y: 0, w: 10, h: 10, o: 0 }, b = { x: 100, y: 40, w: 30, h: 50, o: 1 };
    const m = A.interpolate(a, b, 0.5);
    const z = A.interpolate(a, b, 1);
    return m.x === 50 && m.y === 20 && m.w === 20 && m.h === 30 && m.o === 0.5 && z.x === 100 && z.o === 1 && A.interpolate(a, b, 0).x === 0;
  })());

  // ⑦ S4：流式期间组框只增不减；节流 ≤4 次/秒
  let st = G.applyDelta(state(), { mapId: "m", kind: "states", states: [{ id: "B", state: "streaming" }] });
  st = G.setCollapsed(st, "A4", false);
  let sizes = {};
  let thr = { last: null };
  const heights = [];
  const raw = [];
  let runs = 0;
  let now = 0;
  const steps = [
    (x) => G.applyDelta(x, { mapId: "m", kind: "nodes", nodes: [mk("B4", "B", "推导", "流式到达的第 4 步，标题很长很长很长很长很长很长")] }),
    (x) => G.applyDelta(x, { mapId: "m", kind: "nodes", nodes: [mk("B5", "B", "推导", "第 5 步")] }),
    (x) => G.setCollapsed(x, "B3", true), // 框内收缩（框会变矮）
    (x) => G.applyDelta(x, { mapId: "m", kind: "nodes", nodes: [{ ...x.nodes.B4, title: "短" }] }), // 框会变窄
    (x) => G.applyDelta(x, { mapId: "m", kind: "nodes", nodes: [mk("B6", "B", "结论", "第 6 步")] }),
  ];
  for (let i = 0; i < 40; i++) {
    now += 60; // delta 每 60ms 一批
    if (i % 8 === 0 && steps.length) st = steps.shift()(st);
    const tk = A.throttleStep(thr, now);
    thr = tk.state;
    if (!tk.run) continue;
    runs++;
    const scope = A.growthScope(st);
    const dl = L.layoutGraph(st);
    const m = A.monotoneFrames(dl, sizes, scope);
    sizes = m.sizes;
    heights.push([m.display.byId["F:B"].w, m.display.byId["F:B"].h]);
    raw.push([dl.byId["F:B"].w, dl.byId["F:B"].h]);
  }
  const mono = heights.every((h, i) => i === 0 || (h[0] >= heights[i - 1][0] && h[1] >= heights[i - 1][1]));
  const rawShrinks = raw.some((h, i) => i > 0 && (h[0] < raw[i - 1][0] || h[1] < raw[i - 1][1]));
  check(`⑦ 单调生长：流式期间框宽高序列单调不减（原始布局确有收缩：${rawShrinks}）`, mono && rawShrinks, { heights, raw });
  check(`⑦ 节流：${(40 * 60) / 1000}s 内布局 ${runs} 次 ≤ 4 次/秒`, runs <= Math.ceil((40 * 60) / 250) && runs >= 8, runs);
  check("throttleStep：间隔不足返回剩余延迟", (() => { const a = A.throttleStep({ last: 1000 }, 1100); return !a.run && a.delay === 150; })());
  check("growthScope：streaming 节点 + 祖先 + ROOT", (() => { const g = A.growthScope(st); return g.has("B") && g.has("A3") && g.has("A") && g.has(ROOT) && !g.has("C"); })());
  const done = A.monotoneFrames(L.layoutGraph(st), sizes, new Set());
  check("任务结束（不在 scope）后框可收缩", done.display.byId["F:B"].h <= heights[heights.length - 1][1] && Object.keys(done.sizes).length === 0);

  // ⑧ reduced-motion：插值 1 帧
  const trR = A.planTransition(d0, d1, { view, anchorId: anchor, reducedMotion: true });
  const f0 = A.transitionFrame(trR, 0);
  check("⑧ reduced-motion：时长 0、frameCount = 1、第 0ms 即终态", trR.duration === 0 && A.frameCount(trR) === 1 && f0.done && f0.display === d1 && f0.leaving.length === 0 && Object.keys(f0.opacity).length === 0);
  check("⑧ reduced-motion 下锚点补偿仍生效", Math.abs(A.screenOf(d1.byId[anchor], f0.view).y - before.y) < 1e-9);
  check("常规动效 frameCount > 1（260ms@60fps）", A.frameCount(tr) > 10);
  check("首帧（无 prev）瞬时", A.planTransition(null, d1, { view }).duration === 0);
}

console.log("---- 插值帧可直接路由 + 渲染 ----");
{
  const s = state();
  const d0 = L.layoutGraph(s);
  const s1 = G.applyDelta(s, { mapId: "m", kind: "nodes", nodes: [mk("A1.1", "A1", "要点", "新子")] });
  const d1 = L.layoutGraph(s1);
  const tr = A.planTransition(d0, d1, { view: { tx: 0, ty: 0, k: 1 } });
  const f = A.transitionFrame(tr, 100);
  const r = R.routeRelations(s1, f.display, { relAll: true });
  const svg = S.buildCanvasSvg(f.display, r, { opacity: f.opacity, leaving: f.leaving, view: f.view }, { graph: s1 });
  check("插值帧：route + svg 正常、新卡带 opacity", svg.includes('data-node-id="A1.1"') && /data-node-id="A1\.1" opacity="0\.\d+"/.test(svg));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
