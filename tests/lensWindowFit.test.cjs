// @runtime: node
// 结构图纸片窗口 · 尺寸分级 / 落位纯几何回归（v49.29 / D203；node 直跑）。
// 规格：docs/design/FLOATING-ATLAS-D203.md §5 / §9.1；GUIDE §4.19 v49.29。
// 覆盖：五档工作区（1920×1040 / 1366×728 / 1228×811 / 760×715 / 480×320）× fit / scaled / focus / all；
//       留白不参与缩放；min 360×160 / max 92% workArea；内容 + 留白 ≤ 窗口；
//       focus s ≥ 0.62；锚点非贴边 ≤ 8px、贴边 clamped；聚焦 N 的正向对照（1228→8 / 760→5 / 1366→9；
//       同一内容在 1920 从 focus 变 scaled）。
"use strict";
const path = require("path");
require("./lib/tsload.cjs");
const F = require(path.join(__dirname, "..", "src", "lib", "lensWindowFit.ts"));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "").slice(0, 700)}`); }
}
const rect = (x, y, width, height) => ({ x, y, width, height });
const size = (w, h) => ({ w, h });
const AREAS = {
  "1920×1040": rect(0, 0, 1920, 1040),
  "1366×728": rect(0, 0, 1366, 728),
  "1228×811": rect(0, 0, 1228, 811),
  "760×715": rect(0, 0, 760, 715),
  "480×320": rect(0, 0, 480, 320),
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

console.log("---- 常量 ----");
check("留白 左/右 16、上 32、下 16（合成 32 / 48）", F.LENS_PAD_X === 32 && F.LENS_PAD_TOP === 32 && F.LENS_PAD_BOTTOM === 16);
check("最小窗口 360×160 / 可读下限 0.62 / 上限 92% / 种子 360×248", F.LENS_MIN_W === 360 && F.LENS_MIN_H === 160 && F.LENS_FLOOR === 0.62 && F.LENS_MAX_RATIO === 0.92 && F.LENS_SEED_W === 360 && F.LENS_SEED_H === 248);

console.log("---- 五档工作区 · 2400×152 论证图（fit 探测） ----");
const wide = size(2400, 152);
const wideRows = [
  { area: AREAS["1920×1040"], tier: "scaled", s: 1734 / 2400, win: [1766, 160] },
  { area: AREAS["1366×728"], tier: "focus", s: 1224 / 2400, win: [1256, 160] },
  { area: AREAS["1228×811"], tier: "focus", s: 1097 / 2400, win: [1129, 160] },
  { area: AREAS["760×715"], tier: "focus", s: 667 / 2400, win: [699, 160] },
  { area: AREAS["480×320"], tier: "focus", s: 409 / 2400, win: [441, 160] },
];
for (const row of wideRows) {
  const r = F.computeFit({ content: wide, workArea: row.area, mode: "fit" });
  const lim = F.lensLimits(row.area);
  const okTier = r.tier === row.tier;
  const okScale = near(r.scale, row.s, 1e-9);
  const okWin = r.window.width === row.win[0] && r.window.height === row.win[1];
  const okMax = r.window.width <= lim.maxW && r.window.height <= lim.maxH;
  const okFit = r.contentFits && wide.w * r.scale + 32 <= r.window.width + 1.5 && wide.h * r.scale + 48 <= r.window.height + 1.5;
  check(
    `${row.area.width}×${row.area.height}：${row.tier} · s=${row.s.toFixed(4)} · 窗口 ${row.win[0]}×${row.win[1]} · 内容完整`,
    okTier && okScale && okWin && okMax && okFit,
    { tier: r.tier, scale: r.scale, window: r.window, max: lim, contentFits: r.contentFits },
  );
}
check("五档的窗口都不超 92% 工作区、且都不小于 360×160", wideRows.every((row) => {
  const r = F.computeFit({ content: wide, workArea: row.area, mode: "fit" });
  const lim = F.lensLimits(row.area);
  return r.window.width <= lim.maxW && r.window.height <= lim.maxH && r.window.width >= 360 && r.window.height >= 160;
}));

console.log("---- 样张三种尺寸：100% 完整时窗口 = 内容 + 32 / 48 ----");
const fullCases = [
  { name: "真实样张 536×168", content: size(536, 168), win: [568, 216] },
  { name: "7 卡树 416×456", content: size(416, 456), win: [448, 504] },
  { name: "4 卡时间线 764×156", content: size(764, 156), win: [796, 204] },
];
for (const c of fullCases) {
  const r = F.computeFit({ content: c.content, workArea: AREAS["1228×811"], mode: "fit" });
  check(
    `${c.name} → 100% / s=1 / 窗口 ${c.win[0]}×${c.win[1]}`,
    r.tier === "100%" && r.scale === 1 && r.window.width === c.win[0] && r.window.height === c.win[1] && r.contentFits,
    { tier: r.tier, scale: r.scale, window: r.window, contentFits: r.contentFits },
  );
}
{
  const r = F.computeFit({ content: size(536, 168), workArea: AREAS["480×320"], mode: "fit" });
  check(
    "同一 536×168 在 480×320 缩到 0.763× / 窗口 441×176（留白不参与缩放）",
    r.tier === "scaled" && near(r.scale, 409 / 536, 1e-9) && r.window.width === 441 && r.window.height === 176 && r.contentFits,
    { tier: r.tier, scale: r.scale, window: r.window },
  );
  const t = F.computeFit({ content: size(416, 456), workArea: AREAS["480×320"], mode: "fit" });
  check(
    "7 卡树在 480×320 低于 0.62：tier=focus、窗口被上下限钳制（360×294）",
    t.tier === "focus" && near(t.scale, 246 / 456, 1e-9) && t.window.width === 360 && t.window.height === 294,
    { tier: t.tier, scale: t.scale, window: t.window },
  );
}

console.log("---- 聚焦档：s ≥ 0.62；极小工作区允许平移 ----");
{
  const focusContent = size(1716, 152);
  const r = F.computeFit({ content: focusContent, workArea: AREAS["1228×811"], mode: "focus" });
  check(
    "1228×811：聚焦内容 1716×152 → s 0.639× / 窗口 1129×160 / 内容完整",
    r.tier === "focus" && near(r.scale, 1097 / 1716, 1e-9) && r.window.width === 1129 && r.window.height === 160 && r.contentFits,
    { tier: r.tier, scale: r.scale, window: r.window, contentFits: r.contentFits },
  );
  const n = F.computeFit({ content: size(1044, 152), workArea: AREAS["760×715"], mode: "focus" });
  check(
    "760×715：聚焦内容 1044×152 → s 0.639× / 窗口 699×160",
    n.tier === "focus" && near(n.scale, 667 / 1044, 1e-9) && n.window.width === 699 && n.window.height === 160 && n.contentFits,
    { tier: n.tier, scale: n.scale, window: n.window, contentFits: n.contentFits },
  );
  const tiny = F.computeFit({ content: size(2000, 152), workArea: AREAS["480×320"], mode: "focus" });
  check(
    "480×320 的 N=1 兜底：s 强制 0.62、窗口 441×160、contentFits=false（允许平移）",
    tiny.tier === "focus" && tiny.scale === 0.62 && tiny.window.width === 441 && tiny.window.height === 160 && !tiny.contentFits,
    { tier: tiny.tier, scale: tiny.scale, window: tiny.window, contentFits: tiny.contentFits },
  );
}

console.log("---- 显式全图：允许 s < 0.62，窗口仍不超 92% ----");
{
  const r = F.computeFit({ content: wide, workArea: AREAS["1228×811"], mode: "all" });
  check(
    "1228×811 全图 2400×152 → s 0.457× / tier=all / 窗口 1129×160",
    r.tier === "all" && near(r.scale, 1097 / 2400, 1e-9) && r.window.width === 1129 && r.window.height === 160 && r.contentFits,
    { tier: r.tier, scale: r.scale, window: r.window },
  );
  const big = F.computeFit({ content: wide, workArea: AREAS["1920×1040"], mode: "all" });
  check(
    "1920×1040 全图 2400×152 → s 0.723× / tier=all（<1）",
    big.tier === "all" && near(big.scale, 1734 / 2400, 1e-9) && big.window.width === 1766,
    { tier: big.tier, scale: big.scale, window: big.window },
  );
  const one = F.computeFit({ content: size(536, 168), workArea: AREAS["1228×811"], mode: "all" });
  check("全图模式内容本来就放得下 → tier=100% / 窗口 568×216", one.tier === "100%" && one.window.width === 568 && one.window.height === 216, one);
}

console.log("---- 聚焦 N：12 卡论证（与样张同口径的夹具量法） ----");
// 卡片宽 154/155/192、间距 32、「另有 N 项」112；8/12 → 1716×152、5/12 → 1044×152（与样张账本一致）。
const WIDTHS = [154, 154, 154, 155, 155, 192, 192, 192, 192, 192, 192, 192];
const measure = (n, more) => size(WIDTHS.slice(0, n).reduce((a, b) => a + b, 0) + n * 32 + (more > 0 ? 112 : 0), 152);
const focusAt = (area) => F.chooseFocus({ total: 12, measure, workArea: area });
{
  const a = focusAt(AREAS["1228×811"]);
  check("1228×811：选 8/12（内容 1716×152、s 0.639×、fits）", a.n === 8 && a.more === 4 && a.content.w === 1716 && a.content.h === 152 && near(a.scale, 1097 / 1716, 1e-9) && a.fits, a);
  const b = focusAt(AREAS["760×715"]);
  check("760×715：选 5/12（内容 1044×152、s 0.639×、fits）", b.n === 5 && b.more === 7 && b.content.w === 1044 && near(b.scale, 667 / 1044, 1e-9) && b.fits, b);
  const c = focusAt(AREAS["1366×728"]);
  check("1366×728：选 9/12（更大的工作区显示更多项）", c.n === 9 && c.more === 3 && c.fits, c);
  check("正向对照：1228 → 8 / 760 → 5 / 1366 → 9（N 随工作区单调不减）", a.n === 8 && b.n === 5 && c.n === 9);
  const full = F.computeFit({ content: measure(12, 0), workArea: AREAS["1920×1040"], mode: "fit" });
  const narrow = F.computeFit({ content: measure(12, 0), workArea: AREAS["1228×811"], mode: "fit" });
  check(
    "正向对照：同一 12 卡内容在 1920 从 focus 变 scaled（0.694×），在 1228 仍是 focus",
    full.tier === "scaled" && near(full.scale, 1734 / 2500, 1e-9) && narrow.tier === "focus",
    { full: { tier: full.tier, scale: full.scale }, narrow: { tier: narrow.tier, scale: narrow.scale } },
  );
  // 每个成功选中的 N 都必须真的放得进窗口
  for (const area of [AREAS["1228×811"], AREAS["760×715"], AREAS["1366×728"], AREAS["480×320"]]) {
    const ch = focusAt(area);
    const fit = F.computeFit({ content: ch.content, workArea: area, mode: "focus" });
    check(
      `${area.width}×${area.height}：聚焦 ${ch.n}/12 的内容装得进窗口（${fit.window.width}×${fit.window.height}）`,
      fit.contentFits && fit.scale >= 0.62 - 1e-9 && fit.window.width <= F.lensLimits(area).maxW,
      { choice: ch, fit: { scale: fit.scale, window: fit.window, contentFits: fit.contentFits } },
    );
  }
}

console.log("---- 锚点：非贴边不漂移 / 贴边 clamped ----");
{
  const r = F.computeFit({
    content: size(536, 168), workArea: AREAS["1920×1040"], mode: "fit",
    bounds: rect(600, 100, 360, 248), anchor: { x: 0, y: 36, w: 200, h: 56 },
    current: { scale: 1, offsetX: 16, offsetY: 32 },
  });
  check(
    "非贴边：种子窗 360×248 长到 568×216，锚点中心不动（漂移 0px、clamped=false、原点反算到 600,100）",
    r.anchorDrift <= 8 && !r.clamped && r.bounds.x === 600 && r.bounds.y === 100,
    r,
  );
  const edge = F.computeFit({
    content: size(536, 168), workArea: rect(0, 0, 800, 600), mode: "fit",
    bounds: rect(500, 100, 360, 248), anchor: { x: 0, y: 36, w: 200, h: 56 },
    current: { scale: 1, offsetX: 16, offsetY: 32 },
  });
  check(
    "贴边：期望原点 500 被钳到 232，clamped=true、漂移 268px（不视为失败）",
    edge.clamped && edge.bounds.x === 232 && edge.anchorDrift > 8,
    edge,
  );
  const noAnchor = F.computeFit({ content: size(536, 168), workArea: rect(0, 0, 1000, 800), mode: "fit" });
  check("无 bounds/anchor：在工作区居中，不标钳制", noAnchor.bounds.x === 216 && noAnchor.bounds.y === 292 && !noAnchor.clamped, noAnchor);
  const scaled = F.computeFit({
    content: size(2400, 152), workArea: AREAS["1920×1040"], mode: "fit",
    bounds: rect(100, 100, 568, 216), anchor: { x: 0, y: 36, w: 200, h: 56 },
    current: { scale: 1, offsetX: 16, offsetY: 32 },
  });
  check(
    "缩放变化（1 → 0.723）仍以锚点中心为不变量：非贴边漂移四舍五入后 ≤ 1px",
    scaled.anchorDrift <= 1 && !scaled.clamped,
    { drift: scaled.anchorDrift, clamped: scaled.clamped, bounds: scaled.bounds, desired: scaled.desired },
  );
}

console.log("---- min / max 钳制与零尺寸防御 ----");
{
  const tinyContent = F.computeFit({ content: size(1, 1), workArea: rect(0, 0, 1000, 800), mode: "fit" });
  check("极小内容：窗口不小于 360×160", tinyContent.window.width === 360 && tinyContent.window.height === 160, tinyContent.window);
  const hugeW = F.computeFit({ content: size(100000, 152), workArea: AREAS["480×320"], mode: "all" });
  const hugeH = F.computeFit({ content: size(152, 100000), workArea: AREAS["480×320"], mode: "all" });
  const lim = F.lensLimits(AREAS["480×320"]);
  check(
    "极大内容全图：宽 / 高分别钳到 92% 上限（441×160 / 360×294）",
    hugeW.window.width === lim.maxW && hugeH.window.height === lim.maxH && hugeW.window.height === 160 && hugeH.window.width === 360,
    { wide: hugeW.window, tall: hugeH.window, lim },
  );
  const zero = F.computeFit({ content: size(0, 0), workArea: AREAS["1228×811"], mode: "fit" });
  check("零尺寸内容：不产生 NaN/Infinity", [zero.scale, zero.bounds.x, zero.bounds.y, zero.bounds.width, zero.bounds.height].every(Number.isFinite), zero);
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
