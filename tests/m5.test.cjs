// M5 / v25 图片点选聚焦批次回归测试（node 直跑）
// 覆盖：选区几何（percent↔pixel、包围盒、归一化、可用性判定）、SVG 图元描述、
//       CardLint L11 对 shapes 的语义、存量 rects 卡降级路径。
// 运行：node tests/m5.test.cjs
// 重新打包：node_modules/.bin/esbuild src/lib/occlusion.ts src/lib/cards.ts --bundle --platform=node --format=cjs --outdir=tests/tmp-m5 --log-level=silent
const fs = require("fs");
const path = require("path");

// cards.ts 依赖浏览器环境（ai.ts 的 window），这里用 occlusion 纯函数 + cards 的 lintCard 单独打包
const occ = require("./m5.occlusion.bundle.cjs");
const cardsLint = (() => {
  try {
    return require("./m5.cards.bundle.cjs");
  } catch {
    return null;
  }
})();

let pass = 0;
let fail = 0;
function check(name, cond, expected, actual) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`);
  }
}

console.log("== M5-1 像素 → 百分比换算（选区交互层 → 落库坐标系） ==");
const rectPx = occ.pxShapeToPct({ kind: "rect", x: 10, y: 20, w: 30, h: 40 }, 200, 400);
check("矩形：位置与尺寸都按比例换算", rectPx.x === 5 && rectPx.y === 5 && rectPx.w === 15 && rectPx.h === 10, { x: 5, y: 5, w: 15, h: 10 }, rectPx);
const rectFlip = occ.pxShapeToPct({ kind: "rect", x: 100, y: 200, w: -50, h: -100 }, 200, 400);
check("反向拖拽（负宽高）归一为正向矩形", rectFlip.x === 25 && rectFlip.y === 25 && rectFlip.w === 25 && rectFlip.h === 25, { x: 25, y: 25, w: 25, h: 25 }, rectFlip);
const ellPx = occ.pxShapeToPct({ kind: "ellipse", cx: 100, cy: 200, rx: 50, ry: -25 }, 200, 400);
check("椭圆：中心 + 半轴换算且半径取绝对值", ellPx.cx === 50 && ellPx.cy === 50 && ellPx.rx === 25 && ellPx.ry === 6.3, { cx: 50, cy: 50, rx: 25, ry: 6.3 }, ellPx);
const polyPx = occ.pxShapeToPct({ kind: "polygon", points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 400 }] }, 200, 400);
check("多边形：顶点逐点换算", polyPx.kind === "polygon" && polyPx.points.length === 3 && polyPx.points[2].x === 100 && polyPx.points[2].y === 100, "3 点 (100,100)", polyPx.points);

console.log("== M5-2 包围盒（rects 兼容层） ==");
check("矩形包围盒即自身", JSON.stringify(occ.shapeBBox({ ord: 0, kind: "rect", x: 10, y: 20, w: 30, h: 40 })) === JSON.stringify({ x: 10, y: 20, w: 30, h: 40 }), "自身", occ.shapeBBox({ ord: 0, kind: "rect", x: 10, y: 20, w: 30, h: 40 }));
const ellBox = occ.shapeBBox({ ord: 0, kind: "ellipse", cx: 50, cy: 50, rx: 10, ry: 20 });
check("椭圆包围盒 = 中心±半轴", ellBox.x === 40 && ellBox.y === 30 && ellBox.w === 20 && ellBox.h === 40, { x: 40, y: 30, w: 20, h: 40 }, ellBox);
const polyBox = occ.shapeBBox({ ord: 0, kind: "polygon", points: [{ x: 10, y: 80 }, { x: 60, y: 20 }, { x: 40, y: 90 }] });
check("多边形包围盒 = 顶点极值", polyBox.x === 10 && polyBox.y === 20 && polyBox.w === 50 && polyBox.h === 70, { x: 10, y: 20, w: 50, h: 70 }, polyBox);

console.log("== M5-3 归一化与越界钳制（落库前最后一道闸） ==");
const clampEll = occ.normalizeShape({ ord: 0, kind: "ellipse", cx: 90, cy: 10, rx: 30, ry: 30 });
check("椭圆半径钳制到画面内", clampEll.rx === 10 && clampEll.ry === 10, { rx: 10, ry: 10 }, clampEll);
const clampPoly = occ.normalizeShape({ ord: 0, kind: "polygon", points: [{ x: -10, y: 120 }, { x: 50, y: 50 }, { x: 200, y: 30 }] });
check("多边形顶点钳制 0-100", JSON.stringify(clampPoly.points) === JSON.stringify([{ x: 0, y: 100 }, { x: 50, y: 50 }, { x: 100, y: 30 }]), "全部 0-100", clampPoly.points);
const clampRect = occ.normalizeShape({ ord: 0, kind: "rect", x: 80, y: 80, w: 50, h: 50 });
check("矩形尺寸不越出画面", clampRect.w === 20 && clampRect.h === 20, { w: 20, h: 20 }, clampRect);

console.log("== M5-4 可用性判定（零面积/退化形状不得提交） ==");
check("极扁矩形不可用", occ.isShapeUsable({ ord: 0, kind: "rect", x: 10, y: 10, w: 0.2, h: 30 }) === false, false, occ.isShapeUsable({ ord: 0, kind: "rect", x: 10, y: 10, w: 0.2, h: 30 }));
check("两点多边形不可用", occ.isShapeUsable({ ord: 0, kind: "polygon", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }) === false, false, true);
check("正常矩形可用", occ.isShapeUsable({ ord: 0, kind: "rect", x: 10, y: 10, w: 20, h: 20 }) === true, true, false);
check("正常三角形可用", occ.isShapeUsable({ ord: 0, kind: "polygon", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }] }) === true, true, false);

console.log("== M5-5 SVG 图元描述（复习端/预览端同口径） ==");
check("矩形 → <rect>", occ.shapeToSvg({ ord: 0, kind: "rect", x: 1, y: 2, w: 3, h: 4 }).tag === "rect", "rect", occ.shapeToSvg({ ord: 0, kind: "rect", x: 1, y: 2, w: 3, h: 4 }).tag);
const svgEll = occ.shapeToSvg({ ord: 0, kind: "ellipse", cx: 50, cy: 40, rx: 10, ry: 5 });
check("椭圆 → <ellipse> 且属性齐全", svgEll.tag === "ellipse" && svgEll.attrs.cx === 50 && svgEll.attrs.ry === 5, "ellipse(50,40,10,5)", svgEll);
const svgPoly = occ.shapeToSvg({ ord: 0, kind: "polygon", points: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }] });
check("多边形 → <polygon> points 串", svgPoly.tag === "polygon" && svgPoly.attrs.points === "1,2 3,4 5,6", "1,2 3,4 5,6", svgPoly.attrs.points);

console.log("== M5-6 存量兼容（rects → shapes 降级路径） ==");
const legacy = occ.occlusionShapes({ rects: [{ x: 5, y: 6, w: 7, h: 8, ord: 0 }, { x: 1, y: 1, w: 2, h: 2, ord: 1 }] });
check("仅有 rects 的存量卡补出两个矩形形状", legacy.length === 2 && legacy[0].kind === "rect" && legacy[1].ord === 1, "rect×2", legacy);
const preferShapes = occ.occlusionShapes({
  rects: [{ x: 5, y: 6, w: 7, h: 8, ord: 0 }],
  shapes: [{ ord: 0, kind: "polygon", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }] }]
});
check("shapes 存在时优先于 rects", preferShapes.length === 1 && preferShapes[0].kind === "polygon", "polygon", preferShapes[0].kind);
check("空 occlusion → 空数组", occ.occlusionShapes(null).length === 0, 0, occ.occlusionShapes(null).length);

if (cardsLint) {
  console.log("== M5-7 CardLint L11 与 shapes 语义（cards.ts 打包可用时） ==");
  const withShapes = cardsLint.lintCard({
    front: "图中遮挡区域对应的是什么？",
    back: "海马体",
    cardType: "imageOcclusion",
    occlusion: { assetPath: "bookasset://x/y.png", rects: [], shapes: [{ ord: 0, kind: "polygon", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }] }] }
  });
  check("只有 shapes 的遮挡卡不触发 L11", !withShapes.some((i) => i.ruleId === "L11"), "无 L11", withShapes);
  // v29（D26）：asset + 空 rects = 看图问答卡，合法不报错（L11 放宽为有 asset 即有效）
  const noRegion = cardsLint.lintCard({
    front: "x",
    back: "y",
    cardType: "imageOcclusion",
    occlusion: { assetPath: "bookasset://x/y.png", rects: [], shapes: [] }
  });
  check("D26 看图问答卡（asset+空 rects）不触发 L11", !noRegion.some((i) => i.ruleId === "L11"), noRegion);
  const noAsset = cardsLint.lintCard({
    front: "x",
    back: "y",
    cardType: "imageOcclusion",
    occlusion: { rects: [{ x: 1, y: 1, w: 2, h: 2, ord: 0 }] }
  });
  check("缺资产仍触发 L11", noAsset.some((i) => i.ruleId === "L11"), "L11", noAsset);
} else {
  console.log("  （跳过 M5-7：m5.cards.bundle.cjs 不存在，见文件头打包命令）");
}

// ---------- M5-8 用户选区 AI 链路（v29 D26：选区即画布，映射多卡 + qa + 回退）----------
async function runRegionAI() {
  console.log("== M5-8 用户选区 AI 链路（D26：映射多卡 / qa / 回退 / contextText） ==");
  // 模型输出（选区图坐标系）：遮挡卡（2 regions 一卡多挖空）+ qa 卡 + 一张映射后 w<1 的无效卡
  const modelJson = JSON.stringify({
    knowledgePoints: [{ id: "kp1", summary: "图中内容" }],
    blockReasons: [],
    cards: [
      { cardType: "imageOcclusion", ord: 0, front: "图中遮挡区域对应的是什么？", back: "海马体；杏仁核", domain: ["57"],
        regions: [ { ord: 0, label: "海马体", x: 50, y: 50, w: 25, h: 25 }, { ord: 1, label: "杏仁核", x: 0, y: 0, w: 25, h: 25 } ] },
      { cardType: "qa", ord: 1, front: "根据此图说明海马体的功能", back: "记忆编码与空间导航", regions: [] },
      { cardType: "imageOcclusion", ord: 2, front: "坏卡", back: "越界", regions: [ { ord: 0, label: "越界", x: 150, y: 150, w: 1, h: 1 } ] }
    ]
  });
  const createdBatches = [];
  const windowStub = {
    promptsAPI: { get: async () => ({ id: "tpl-occ", content: "（提示词 v2）" }) },
    batchesAPI: { create: async (p) => { createdBatches.push(p); return { id: "batch-1" }; } },
    aiAPI: {
      onStream: (cb) => {
        windowStub.__cb = cb;
        return () => {};
      },
      chat: (rid) => {
        setTimeout(() => {
          windowStub.__cb(rid, { delta: modelJson });
          windowStub.__cb(rid, { done: true });
        }, 0);
      }
    }
  };
  global.window = windowStub;
  const shape = { ord: 0, kind: "polygon", points: [{ x: 30, y: 40 }, { x: 70, y: 40 }, { x: 50, y: 80 }] };
  const rect = { x: 30, y: 40, w: 40, h: 40 };
  const { result } = await cardsLint.cardGenerator.generateOcclusionCards(
    { dataUrl: "data:image/png;base64,AAAA", assetPath: "bookasset://x/crop.png" },
    { title: "测试书", focus: "（v29 D26 文案）", presetRegion: { rect, shape }, contextText: "上方段落。下方图注。" }
  );
  check("D26 映射：产出 2 张有效卡（遮挡+qa，无效卡被丢弃）", result.cards.length === 2, result.cards.length);
  const occCard = result.cards[0];
  const occ = occCard.occlusion;
  check("D26 映射：一卡多挖空（每卡自带 2 rects）", occCard.cardType === "imageOcclusion" && occ.rects.length === 2, occ.rects.length);
  // 裁剪坐标→全图坐标映射：region(x=50,w=25) → x=30+50*40/100=50, w=25*40/100=10
  check("D26 映射公式：fullX = px + rx×pw/100", occ.rects[0].x === 50 && occ.rects[0].w === 10, occ.rects[0]);
  check("D26 映射公式：region(x=0) → x=px", occ.rects[1].x === 30 && occ.rects[1].w === 10, occ.rects[1]);
  check("D26 多挖空：regions 每卡自带（共享 rects 模式废除）", occ.rects.every(r => r.ord === 0 || r.ord === 1), occ.rects.map(r=>r.ord));
  check("D26 资产沿用整图 assetPath", occ.assetPath === "bookasset://x/crop.png", occ.assetPath);
  check("D26 back 取模型内容", result.cards[0].back === "海马体；杏仁核", result.cards[0].back);
  const qaDraft = result.cards[1];
  check("D26 qa 卡：rects 空数组挂图 + front 题面", qaDraft.occlusion.rects.length === 0 && qaDraft.front.includes("海马体的功能"), JSON.stringify(qaDraft.occlusion));
  check("D26 contextText 注入请求上下文", createdBatches.some(b => b.context && b.context.contextText === "上方段落。下方图注。"), JSON.stringify(createdBatches.map(b=>b.context&&b.context.contextText)));
  // 回退：模型无有效卡 → 整选区单卡（D25 旧语义保留为回退）
  const modelJsonEmpty = JSON.stringify({ knowledgePoints: [], blockReasons: [], cards: [] });
  windowStub.__cb2 = null;
  windowStub.aiAPI.chat = (rid) => { setTimeout(() => { windowStub.__cb(rid, { delta: modelJsonEmpty }); windowStub.__cb(rid, { done: true }); }, 0); };
  const fb = await cardsLint.cardGenerator.generateOcclusionCards(
    { dataUrl: "data:image/png;base64,AAAA", assetPath: "bookasset://x/crop.png" },
    { title: "测试书", presetRegion: { rect, shape } }
  );
  const fbOcc = fb.result.cards[0].occlusion;
  check("D26 回退：无有效卡 → 整选区单卡", fb.result.cards.length === 1 && fbOcc.rects[0].x === 30 && fbOcc.rects[0].w === 40, fbOcc.rects[0]);
  check("D26 回退：polygon 形状随卡落库", fbOcc.shapes[0].kind === "polygon", fbOcc.shapes[0]);
  delete global.window;
}
(async () => {
  try {
    await runRegionAI();
  } catch (err) {
    check("用户选区 AI 链路（异常）", false, "throw", err && err.message);
  }
  console.log(`\n==== M5 SUMMARY ${pass}/${pass + fail} ====`);
  if (fail) process.exit(1);
})();