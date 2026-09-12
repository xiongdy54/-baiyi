// M4 GUI 测试配套清理（§7.1.8 纪律：必须先关闭应用再运行，防止 persist() 覆盖）
// 用途：Ctrl+S 摘录测试产生的 FSRSTEST 摘录无删除 API（workflowAPI 无 remove），关库后直改 library.db 软删。
// 运行：node tests/m4.cleanup.cjs
const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

(async () => {
  const SQL = await initSqlJs();
  const file = path.join(process.env.APPDATA, "incremental-reading-dev", "library.db");
  if (!fs.existsSync(file)) {
    console.error("找不到 library.db：" + file);
    process.exit(1);
  }
  const db = new SQL.Database(fs.readFileSync(file));
  const count = (sql) => {
    const r = db.exec(sql);
    return Number(r[0]?.values[0]?.[0] || 0);
  };
  const before = count("SELECT COUNT(*) FROM extracts WHERE content_markdown LIKE '%FSRSTEST%' AND is_deleted = 0");
  if (before > 0) {
    db.run("UPDATE extracts SET is_deleted = 1, updated_at = strftime('%s','now') * 1000 WHERE content_markdown LIKE '%FSRSTEST%' AND is_deleted = 0");
    fs.writeFileSync(file, Buffer.from(db.export()));
  }
  const leftovers = {
    extracts: count("SELECT COUNT(*) FROM extracts WHERE content_markdown LIKE '%FSRSTEST%' AND is_deleted = 0"),
    cards: count("SELECT COUNT(*) FROM cards WHERE note_text LIKE '%FSRSTEST%' AND is_deleted = 0"),
    items: count("SELECT COUNT(*) FROM library_items WHERE title LIKE '%FSRSTEST%' AND is_deleted = 0")
  };
  console.log(`已软删 ${before} 条 FSRSTEST 摘录；残留（应为全 0）：${JSON.stringify(leftovers)}`);
  process.exit(leftovers.extracts + leftovers.cards + leftovers.items > 0 ? 1 : 0);
})().catch((e) => {
  console.error("清理失败：", e.message);
  process.exit(1);
});
