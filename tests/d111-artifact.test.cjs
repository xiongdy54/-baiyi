// D111 产物新鲜度闸门（node 直跑：node tests/d111-artifact.test.cjs）
// electron/cardQuery.bundle.cjs 是 src/lib/cardQuery.ts 的 esbuild 生成产物（§6.8-6 数据通道 / D111：
// 渲染层、主进程、测试三方消费同一份编译产物，查询求值语义单源）——本测试现场重打包逐字节比对，
// 防止手改产物或源码变更后忘记重打包（两条路都会让主进程求值与渲染层语义漂移）。
"use strict";
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");
const ROOT = path.resolve(__dirname, "..");

const ARTIFACT = path.join(ROOT, "electron", "cardQuery.bundle.cjs");
// 与产物生成命令同配置（banner 逐字节一致才判新鲜）：
// node -e "require('esbuild').buildSync({entryPoints:['src/lib/cardQuery.ts'],bundle:true,platform:'node',format:'cjs',outfile:'electron/cardQuery.bundle.cjs',banner:{js:BANNER}})"
const BANNER =
  "// v48.67（D111 §6.8-6 数据通道）：生成产物——esbuild 打包 src/lib/cardQuery.ts（含 tags.ts），主进程求值单源；禁止手改，\n" +
  "// 新鲜度由 tests/d111-artifact.test.cjs（esbuild 现场重打包逐字节比对）把守。渲染层直接 import 源码，测试消费 tests/*.bundle.cjs。";

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      实际: ${String(actual).slice(0, 300)}`); }
}

console.log("== D111-ART 产物新鲜度 ==");
const result = esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src", "lib", "cardQuery.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  banner: { js: BANNER },
  write: false,
  logLevel: "silent"
});
const fresh = result.outputFiles[0].text;
let current = "";
try {
  current = fs.readFileSync(ARTIFACT, "utf8");
} catch {
  /* 缺文件按空串处理 */
}
check(
  "electron/cardQuery.bundle.cjs 与源码现场重打包逐字节一致（未手改、未过期）",
  fresh === current,
  fresh === current ? "" : "产物与重打包结果不一致——重新生成：node -e \"require('esbuild').buildSync({entryPoints:['src/lib/cardQuery.ts'],bundle:true,platform:'node',format:'cjs',outfile:'electron/cardQuery.bundle.cjs',banner:{js:...}})\"（banner 见本文件）"
);
check("产物存在且非空", current.length > 0, current.length);

if (current) {
  const core = require(ARTIFACT);
  const p = core.parseCardQuery("tag:考研 or book:物理");
  check("产物可加载且 AST 求值可用（or 结构）", p.ast && p.ast.t === "or", JSON.stringify(p.ast));
  check(
    "makeCardPredicates 可用（单源求值入口）",
    core.cardRowMatches(core.parseCardQuery("kind:card"), core.makeCardPredicates({ kind: () => true })) === true,
    "kind 谓词求值"
  );
}

console.log(`\n==== d111-artifact：${pass} 通过 / ${fail} 失败 ====`);
process.exit(fail === 0 ? 0 : 1);
