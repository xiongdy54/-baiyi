// @runtime: node
// 结构图纸片窗口 fit 几何 · 主进程产物新鲜度 + 双端同构（v49.29 / D203）。
// electron/lensWindowFit.bundle.cjs 是 src/lib/lensWindowFit.ts 的 esbuild 产物（主进程 require，渲染层 import 源码）：
//   ① 现场重打包必须与仓库产物逐字节一致（防手改 / 防过期）；
//   ② 同一组输入下，主进程产物与渲染层 TS 模块的输出必须逐字段相等（防两套解释）。
"use strict";
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");
require("./lib/tsload.cjs");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src", "lib", "lensWindowFit.ts");
const ARTIFACT = path.join(ROOT, "electron", "lensWindowFit.bundle.cjs");
const BANNER = "// v49.29（D203）：生成产物——esbuild 打包 src/lib/lensWindowFit.ts（主进程与渲染层共用同一份 fit 几何）；禁止手改，\n// 新鲜度由 tests/lensWindowFit.artifact.test.cjs 把守。\n";
const REBUILD = 'node -e "require(\'esbuild\').buildSync({entryPoints:[\'src/lib/lensWindowFit.ts\'],bundle:true,platform:\'node\',format:\'cjs\',outfile:\'electron/lensWindowFit.bundle.cjs\',banner:{js:...}})"（banner 见本文件）';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "").slice(0, 700)}`); }
}

const TS = require(SRC);
const MAIN = require(ARTIFACT);
const fresh = esbuild.buildSync({
  entryPoints: [SRC], bundle: true, platform: "node", format: "cjs", write: false,
  banner: { js: BANNER },
}).outputFiles[0].text;
const current = fs.readFileSync(ARTIFACT, "utf8");
check("主进程产物与源码现场重打包逐字节一致（未手改、未过期）", fresh === current, { freshLen: fresh.length, currentLen: current.length, rebuild: REBUILD });
check("主进程产物导出 computeFit / chooseFocus / lensLimits", typeof MAIN.computeFit === "function" && typeof MAIN.chooseFocus === "function" && typeof MAIN.lensLimits === "function");

const area = (width, height) => ({ x: 0, y: 0, width, height });
const cases = [
  { content: { w: 536, h: 168 }, workArea: area(1228, 811), mode: "fit" },
  { content: { w: 2400, h: 152 }, workArea: area(1228, 811), mode: "fit" },
  { content: { w: 2400, h: 152 }, workArea: area(1920, 1040), mode: "all" },
  { content: { w: 1716, h: 152 }, workArea: area(1228, 811), mode: "focus" },
  { content: { w: 2000, h: 152 }, workArea: area(480, 320), mode: "focus" },
  {
    content: { w: 2400, h: 152 }, workArea: area(1920, 1040), mode: "fit",
    bounds: { x: 100, y: 100, width: 568, height: 216 },
    anchor: { id: "n1", x: 0, y: 36, w: 200, h: 56 },
    current: { scale: 1, offsetX: 16, offsetY: 32 },
  },
  {
    content: { w: 536, h: 168 }, workArea: area(800, 600), mode: "fit",
    bounds: { x: 500, y: 100, width: 360, height: 248 },
    anchor: { id: "n1", x: 0, y: 36, w: 200, h: 56 },
    current: { scale: 1, offsetX: 16, offsetY: 32 },
  },
];
const mismatches = [];
for (const c of cases) {
  const a = TS.computeFit(c);
  const b = MAIN.computeFit(c);
  if (JSON.stringify(a) !== JSON.stringify(b)) mismatches.push({ c, ts: a, main: b });
}
check("同一输入下主进程产物与渲染层 TS 模块逐字段相等（无两套几何）", mismatches.length === 0, mismatches);

const WIDTHS = [154, 154, 154, 155, 155, 192, 192, 192, 192, 192, 192, 192];
const measure = (n, more) => ({ w: WIDTHS.slice(0, n).reduce((x, y) => x + y, 0) + n * 32 + (more > 0 ? 112 : 0), h: 152 });
const focusCases = [area(1228, 811), area(760, 715), area(1366, 728), area(480, 320)].map((wa) => ({ total: 12, measure, workArea: wa }));
const focusMismatch = focusCases.filter((c) => JSON.stringify(TS.chooseFocus(c)) !== JSON.stringify(MAIN.chooseFocus(c)));
check("聚焦 N 选择两端同构（1228/760/1366/480）", focusMismatch.length === 0, focusMismatch);

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
