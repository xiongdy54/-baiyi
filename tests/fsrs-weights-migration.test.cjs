// @runtime: electron
// C-48：旧版 settings.app.fsrsWeights 迁移后，用户优化过的参数必须仍是活跃配置（不得被旧快照覆盖掉指针）
"use strict";
const { app } = require("electron");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const ud = fs.mkdtempSync(path.join(os.tmpdir(), "c48-"));
app.setPath("userData", ud);
const settingsFile = path.join(ud, "settings.json");
// 21 个权重，模拟 v23 之前优化器写在 settings.json 里的用户参数
const W = [0.212, 1.2941, 2.3085, 8.2986, 6.4173, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796,
  1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542];
fs.writeFileSync(settingsFile, JSON.stringify({ app: { fsrsWeights: W, c48Keep: "keep" } }, null, 2));

app.whenReady().then(async () => {
  let code = 0;
  try {
    const db = require(path.join(ROOT, "electron", "db.js"));
    await db.initDb();
    const s = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    assert.ok(s.app && s.app.fsrsConfigId, "迁移后 settings.app.fsrsConfigId 必须存在（不得被迁移自己的旧快照覆盖掉）");
    assert.strictEqual(s.app.fsrsWeights, undefined, "旧字段 fsrsWeights 应已删除");
    assert.strictEqual(s.app.c48Keep, "keep", "其他设置不得丢失");
    const active = db.getActiveFsrsConfig();
    assert.strictEqual(active.id, s.app.fsrsConfigId, "活跃配置必须是指针所指的行");
    assert.strictEqual(active.source, "optimizer", "活跃配置必须是迁移来的优化参数，不能回落到默认参数");
    assert.deepStrictEqual(active.weights, W, "活跃权重必须等于旧版保存的权重");
    db.closeDb();
    console.log("fsrs-weights-migration: 通过");
  } catch (e) {
    console.error(e && e.stack ? e.stack : e);
    code = 1;
  }
  // Windows：断言失败路径 closeDb 未执行，打开的 better-sqlite3 连接会让 rmSync 抛 EBUSY
  // 挡住 app.exit（Linux unlink 语义无此问题）——包 try/catch 让进程按 code 退出；%TEMP% 残留无害。
  try { fs.rmSync(ud, { recursive: true, force: true }); } catch { /* 残留 %TEMP% 无害 */ }
  app.exit(code);
});
