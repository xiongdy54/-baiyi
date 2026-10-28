// @runtime: system-node
// D248 / T6：origin 多槽 token——A/B 不串、3s 过期、一次消费、取消、按 (window,entity) 匹配（§7.4 / V1-4）。
// 运行：node scripts/run-tests.mjs behavior-origin
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const esbuild = require("esbuild");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(os.tmpdir(), `bdi-origin-${process.pid}.cjs`);
esbuild.buildSync({
  stdin: { contents: 'export * from "./src/lib/behavior/origin";', resolveDir: ROOT, loader: "ts" },
  bundle: true, platform: "node", format: "cjs", outfile: OUT, logLevel: "silent",
});
const origin = require(OUT);

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

let clock = 1000;
origin.setOriginClock(() => clock);

console.log("== A 多槽不串来源 ==");
origin.clearOrigins();
origin.markOrigin({ window: "main", entityType: "library_item", entityId: "A" }, "shelf");
origin.markOrigin({ window: "main", entityType: "library_item", entityId: "B" }, "search");
check("消费 A 得到 shelf", origin.consumeOrigin({ window: "main", entityType: "library_item", entityId: "A" }) === "shelf", "shelf", origin.consumeOrigin({ window: "main", entityType: "library_item", entityId: "A" }));
check("A 已消费不再命中（一次消费）", origin.consumeOrigin({ window: "main", entityType: "library_item", entityId: "A" }) === "unknown", "unknown", "仍命中");
check("B 仍是 search（未被 A 串）", origin.consumeOrigin({ window: "main", entityType: "library_item", entityId: "B" }) === "search", "search", "串了");

console.log("== B 过期与窗口隔离 ==");
origin.clearOrigins();
origin.markOrigin({ window: "main", entityType: "card", entityId: "C" }, "browse");
clock += 3001;
check("超过 3s 过期 → unknown", origin.consumeOrigin({ window: "main", entityType: "card", entityId: "C" }) === "unknown", "unknown", "未过期");
origin.markOrigin({ window: "main", entityType: "card", entityId: "D" }, "browse");
check("不同窗口不命中", origin.consumeOrigin({ window: "lens", entityType: "card", entityId: "D" }) === "unknown", "unknown", "串窗口");
check("原窗口仍命中", origin.consumeOrigin({ window: "main", entityType: "card", entityId: "D" }) === "browse", "browse", "丢失");

console.log("== C nonce 精确匹配 ==");
origin.clearOrigins();
origin.markOrigin({ window: "main", entityType: "kp", entityId: "K", nonce: "n1" }, "kp");
check("nonce 不符不命中", origin.consumeOrigin({ window: "main", entityType: "kp", entityId: "K", nonce: "n2" }) === "unknown", "unknown", "误命中");
check("nonce 相符命中", origin.consumeOrigin({ window: "main", entityType: "kp", entityId: "K", nonce: "n1" }) === "kp", "kp", "丢失");

console.log("== D 取消与覆盖 ==");
origin.clearOrigins();
origin.markOrigin({ window: "main", entityType: "library_item", entityId: "E" }, "recommend");
origin.cancelOrigin({ window: "main", entityType: "library_item", entityId: "E" });
check("取消后 unknown", origin.consumeOrigin({ window: "main", entityType: "library_item", entityId: "E" }) === "unknown", "unknown", "仍命中");
origin.markOrigin({ window: "main", entityType: "library_item", entityId: "F" }, "shelf");
origin.markOrigin({ window: "main", entityType: "library_item", entityId: "F" }, "queue");
check("同 target 后登记者生效（最后一次）", origin.consumeOrigin({ window: "main", entityType: "library_item", entityId: "F" }) === "queue", "queue", "被旧值覆盖");

console.log("== E 有界（不无限增长） ==");
origin.clearOrigins();
for (let i = 0; i < 40; i++) origin.markOrigin({ window: "main", entityType: "x", entityId: `e${i}` }, "shelf");
check("槽位有界（≤32）", origin.originDebugSlots().length <= 32, "<=32", origin.originDebugSlots().length);
check("最新一条仍可消费", origin.consumeOrigin({ window: "main", entityType: "x", entityId: "e39" }) === "shelf", "shelf", "丢失");

try { fs.rmSync(OUT, { force: true }); } catch { /* 临时文件 */ }
console.log(`\n==== behavior-origin ${pass}/${pass + fail} 断言 ====`);
if (fail > 0) console.log(`  失败 ${fail} 项`);
process.exitCode = fail === 0 ? 0 : 1;
