// 差异区域聚类：输出两 PNG 的差异像素按 64px 网格的分布（调试用）
// 用法：node tests/lib/png-diff-zones.mjs <a.png> <b.png> [tol]
import fs from "node:fs";
import { decodePng, comparePixels } from "./png-pixel-diff.mjs";

const [a, b] = process.argv.slice(2);
const tol = Number(process.argv[4] ?? 4);
const da = decodePng(fs.readFileSync(a));
const db = decodePng(fs.readFileSync(b));
const r = comparePixels(da, db, tol);
console.log(`硬差异=${r.diffPixels} 软噪声=${r.softPixels} maxΔ=${r.maxDelta}`);
if (r.diffPixels <= 0) process.exit(0);
// 重算一遍收集硬差异坐标（comparePixels 只给首差）——直接在此内联扫描
const zones = new Map();
const n = da.data.length;
for (let i = 0; i < n; i += 4) {
  const d = Math.max(
    Math.abs(da.data[i] - db.data[i]), Math.abs(da.data[i + 1] - db.data[i + 1]),
    Math.abs(da.data[i + 2] - db.data[i + 2]), Math.abs(da.data[i + 3] - db.data[i + 3])
  );
  if (d <= tol) continue;
  const px = i / 4, x = px % da.width, y = Math.floor(px / da.width);
  const key = `${Math.floor(x / 64) * 64},${Math.floor(y / 64) * 64}`;
  const z = zones.get(key) || { count: 0, maxD: 0 };
  z.count++; z.maxD = Math.max(z.maxD, d);
  zones.set(key, z);
}
[...zones.entries()].sort((p, q) => q[1].count - p[1].count).slice(0, 14).forEach(([k, v]) => {
  console.log(`  区域(${k}) 数=${v.count} maxΔ=${v.maxD}`);
});
