"use strict";
// C-38b（审计）：云同步预留——用 SQLite 触发器让 sync_version 递增与删除墓碑「自动、无遗漏」。
// 设计原则（报告 C-38，不许偏离）：不写同步引擎；零业务代码改动——不修改任何现有 UPDATE/DELETE
// 语句；触发器只改 sync_version，绝不改 updated_at（界面按"最近修改"排序，评分不应改变它）。
// 触发器依赖列清单，所以每次启动重建（先删后建，幂等、毫秒级），以后新增的列也会自动纳入
// "是否真的改了"的判断。这是 C-10「结构变化只走 MIGRATIONS」规则的唯一登记例外
// （触发器是派生对象，不承载数据；GUIDE §4/§7.2 schema 变更规则行随本项登记，见 D212）。
const { SYNC, APPEND } = require("./syncTables");
// 毫秒时间戳；不用 unixepoch()，兼容所有 SQLite 版本
const NOW_MS = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";

function columnsOf(db, table) {
  return db.prepare("SELECT name FROM pragma_table_info(?)").all(table).map((r) => r.name);
}

/** 在 initDb 末尾、runMigrations 之后调用。 */
function installSyncTriggers(db) {
  db.transaction(() => {
    for (const t of [...SYNC, ...APPEND]) {
      const cols = columnsOf(db, t);
      if (!cols.length) throw new Error(`syncTables 登记了不存在的表：${t}`);
      for (const k of ["ver", "del", "ins"]) db.exec(`DROP TRIGGER IF EXISTS sync_${k}_${t}`);
      // 删除 → 墓碑（物理删除也能传播）
      db.exec(`CREATE TRIGGER sync_del_${t} AFTER DELETE ON ${t} BEGIN
            INSERT OR REPLACE INTO sync_tombstones (tbl, row_id, deleted_at) VALUES ('${t}', OLD.id, ${NOW_MS});
          END`);
      // 同 id 重新插入 → 撤销墓碑
      db.exec(`CREATE TRIGGER sync_ins_${t} AFTER INSERT ON ${t} BEGIN
            DELETE FROM sync_tombstones WHERE tbl = '${t}' AND row_id = NEW.id;
          END`);
      if (cols.includes("sync_version")) {
        // 只有"业务语句没自己递增"且"确实有列变化"时才 +1：已手写 +1 的语句不会重复递增，无变化的 UPDATE 不递增
        const changed = cols.filter((c) => c !== "sync_version").map((c) => `NEW."${c}" IS NOT OLD."${c}"`).join(" OR ");
        db.exec(`CREATE TRIGGER sync_ver_${t} AFTER UPDATE ON ${t}
              WHEN NEW.sync_version IS OLD.sync_version AND (${changed})
              BEGIN
                UPDATE ${t} SET sync_version = OLD.sync_version + 1 WHERE rowid = NEW.rowid;
              END`);
      }
    }
  })();
}
module.exports = { installSyncTriggers };
