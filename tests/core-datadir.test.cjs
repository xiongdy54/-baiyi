// @runtime: electron-node
// C-40a（审计：业务核心与 Node/Electron 解耦）：数据目录注入闸门——
// 在 ELECTRON_RUN_AS_NODE 下（require("electron") 拿不到 app），db.initDb({ dataDir: tmp })
// 成功建库、createFromPaste 建书、closeDb 后 tmp/library.db 存在且可查。
// 这个测试通过 = 业务层（db.js + settingsStore）可以脱离 Electron 主进程运行；
// 这是移动端（D-05=A Capacitor）复用同一份业务核心的前提（报告 C-40 步骤 1）。
// 运行：ELECTRON_RUN_AS_NODE=1 npx electron tests/core-datadir.test.cjs
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// 前提自证：当前进程确实拿不到 Electron app（否则本测试没有证明力）
const electronShim = require("electron");
assert.ok(!electronShim || !electronShim.app, "本测试必须在 ELECTRON_RUN_AS_NODE（无 app）下运行");

const ROOT = path.join(__dirname, "..");
// 临时数据目录（绝不触碰真实 userData）
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nut-c40-"));

(async () => {
  // 模块加载不得触碰 electron（C-40a 前：db.js 顶部 require electron 的 app 会在无 app 环境崩）
  const db = require(path.join(ROOT, "electron", "db.js"));
  const settingsStore = require(path.join(ROOT, "electron", "settingsStore.js"));

  // 1) 注入式初始化成功
  await db.initDb({ dataDir: tmp });

  // 2) settingsStore 被同步注入：settings.json 与库文件同目录
  assert.strictEqual(
    settingsStore.SETTINGS_FILE,
    path.join(tmp, "settings.json"),
    "initDb({dataDir}) 必须把 settingsStore 配置到同一数据目录"
  );
  // 3) settingsStore 读写路径真实可用（纯 Node 下）
  settingsStore.writeSettings({ app: { c40probe: true }, theme: {} });
  assert.strictEqual(settingsStore.readSettings().app.c40probe, true, "settings.json 注入目录可写可读");

  // 4) 业务写入：建一本书（书目 + 正文同一事务）
  const item = db.createFromPaste("C-40 数据目录注入", "正文内容");
  assert.ok(item && item.id, "createFromPaste 应返回书目");
  const titles = db.listItems().map((i) => i.title);
  assert.ok(titles.includes("C-40 数据目录注入"), "listItems 应能读到刚建的书");

  // 5) 关闭后库文件存在且可被第二个连接查询（落盘证据）
  db.closeDb();
  const dbFile = path.join(tmp, "library.db");
  assert.ok(fs.existsSync(dbFile), "tmp/library.db 必须存在");
  const Database = require("better-sqlite3");
  const side = new Database(dbFile, { readonly: true });
  const row = side.prepare("SELECT id, title FROM library_items WHERE id = ?").get(item.id);
  side.close();
  assert.ok(row, "库文件必须能查到刚建的书");
  assert.strictEqual(row.title, "C-40 数据目录注入");

  console.log("core-datadir: 通过（ELECTRON_RUN_AS_NODE 下 initDb({dataDir}) + 建书 + 落盘可查）");
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch { /* %TEMP% 残留无害 */ }
  process.exit(0);
})().catch((e) => {
  console.error("FAIL", e && (e.stack || e.message));
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch { /* 忽略 */ }
  process.exit(1);
});
