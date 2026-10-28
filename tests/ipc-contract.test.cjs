// @runtime: electron-node
// C-40c（审计：业务核心与 Node/Electron 解耦）：接口清单闸门——
// 重新生成 docs/ipc-contract.json 并与仓库内文件逐字节比较；不一致即失败，
// 提示「运行 node scripts/gen-ipc-contract.mjs 并提交」（报告 C-40 步骤 3）。
// 移动端（D-05=A Capacitor）要实现的就是这份清单：同名桥对象、同名方法。
// 运行：ELECTRON_RUN_AS_NODE=1 npx electron tests/ipc-contract.test.cjs
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "docs", "ipc-contract.json");

(async () => {
  // 动态引入 ESM 生成器（buildContract 与 CLI 共用同一实现，杜绝两套解析逻辑漂移）
  const gen = await import(pathToFileURL(path.join(ROOT, "scripts", "gen-ipc-contract.mjs")).href);
  const entries = gen.buildContract();
  const expected = gen.serialize(entries);
  const actual = fs.readFileSync(OUT, "utf8");

  assert.strictEqual(actual, expected, "docs/ipc-contract.json 与 preload.js 现状不一致——运行 node scripts/gen-ipc-contract.mjs 并提交");

  // 契约形状锁：桥 / 方法总数与 kind 取值（结构性回归闸）
  const bridges = new Set(entries.map((e) => e.bridge));
  // D248（T5/T11）：behaviorAPI（batch / status / query / onConfig 四方法）→ 34 桥 / 289 方法。
  assert.strictEqual(bridges.size, 34, "桥对象数应为 34（preload.js exposeInMainWorld）");
  assert.strictEqual(entries.length, 289, "桥方法总数应为 289（每方法恰一个通道调用）");
  for (const e of entries) {
    assert.ok(["invoke", "send", "on"].includes(e.kind), `非法 kind：${e.bridge}.${e.kind}`);
    assert.ok(typeof e.channel === "string" && e.channel.includes(":"), `非法 channel：${e.channel}`);
  }
  // 排序确定性（bridge → method）
  const sorted = [...entries].sort((a, b) =>
    a.bridge === b.bridge ? (a.method < b.method ? -1 : 1) : a.bridge < b.bridge ? -1 : 1
  );
  assert.deepStrictEqual(entries, sorted, "契约条目必须按 bridge → method 排序");

  const kinds = {};
  for (const e of entries) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
  console.log(`ipc-contract: 通过（${bridges.size} 桥 / ${entries.length} 方法，kind 分布 ${JSON.stringify(kinds)}，逐字节一致）`);
  process.exit(0);
})().catch((e) => {
  console.error("FAIL", e && (e.stack || e.message));
  process.exit(1);
});
