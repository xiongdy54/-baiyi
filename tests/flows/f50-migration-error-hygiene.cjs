// F50 迁移错误卫生：catch 一切 = 「已经迁移过」的同义反复？
// @runtime: node  @tier: 2  @gui: false  @id: F50  @timeout: 120
// 运行：node tests/flows/f50-migration-error-hygiene.cjs
//
// 角度：既有 50 条流程全部在**行为层**测迁移（旧库开起来对不对）；没有一条测
//       「迁移代码怎么知道失败原因是『已存在』而不是『库被锁/磁盘满/页损坏』」。
//       db.js 用 `try { ALTER } catch { /* 列已存在 */ }` 当幂等手段：
//       任何异常都被读成「无事发生」，于是半截 schema 可以静默活到下一次写入。
"use strict";
const fs = require("fs");
const path = require("path");
const { Flow, runFlow, ROOT } = require("./lib/harness.cjs");

const flow = new Flow({
  id: "F50",
  title: "迁移错误卫生",
  angle: "幂等迁移的判据是「错误类型」还是「有异常就算已迁移」",
  cites: ["§7.2", "§7.1.8", "§7.4"],
  tier: 2,
  gui: false,
});

const src = fs.readFileSync(path.join(ROOT, "electron", "db.js"), "utf8").replace(/\r\n/g, "\n");
const lines = src.split("\n");
const lineNo = (i) => i + 1;

runFlow(flow, async () => {
  flow.section("S1 迁移段的吞异常形状普查");
  const blind = [];
  const typed = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/}\s*catch\s*(\(([^)]*)\))?\s*\{(.*)\}$/);
    if (!m) continue;
    const body = m[3];
    const isCommentOnly = /^\s*(\/\*[^*]*\*\/)?\s*$/.test(body);
    if (!isCommentOnly) continue;
    const comment = (body.match(/\/\*([^*]*)\*\//) || [, ""])[1].trim();
    // 只看迁移/DDL 语境的注释：已存在 / 已迁移 / 表尚不存在 / 重试
    if (!/已存在|已迁移|尚不存在|不存在|重试|忽略|不阻塞/.test(comment)) continue;
    (m[2] ? typed : blind).push({ line: lineNo(i), comment, bound: m[2] });
  }
  flow.record("catch 未绑定错误对象且注释声称「已存在/已迁移」的站点数", blind.length);
  flow.record("catch 绑定了错误对象但整块只有注释的站点数", typed.length);
  for (const b of blind.slice(0, 12)) flow.record("盲吞站点", `db.js:${b.line} /* ${b.comment} */`);

  // 迁移段范围：第一条 ALTER 到最后一条 ALTER
  const alterIdx = [];
  lines.forEach((l, i) => { if (/ALTER\s+TABLE|CREATE\s+(TABLE|INDEX)/i.test(l)) alterIdx.push(i); });
  flow.check("迁移语句确实存在（本条流程的前提）", alterIdx.length > 10, ">10", alterIdx.length);
  const region = lines.slice(Math.max(0, alterIdx[0] - 20), Math.min(lines.length, alterIdx[alterIdx.length - 1] + 20)).join("\n");
  const blindInRegion = blind.filter((b) => b.line >= alterIdx[0] - 20 && b.line <= alterIdx[alterIdx.length - 1] + 20);
  flow.record("迁移段内的盲吞站点", `${blindInRegion.length} 处 / 迁移段共 ${region.split("\n").length} 行`);

  flow.section("S2 有没有「先探测再改」的正解在场");
  const probes = {
    pragmaTableInfo: /PRAGMA\s+table_info/i.test(src),
    tableList: /PRAGMA\s+table_list|sqlite_master/i.test(src),
    columnHelper: /(function\s+\w*(column|hasCol)\w*|const\s+\w*(column|hasCol)\w*)/i.test(src),
  };
  flow.record("探测手段在场情况", JSON.stringify(probes));
  const ddlGuardedByProbe = /(?:table_info|sqlite_master)[\s\S]{0,400}?ALTER\s+TABLE/i.test(src);
  flow.check("至少一条 ALTER 走「先探测列再改」而不是靠 catch", ddlGuardedByProbe, true, ddlGuardedByProbe);

  flow.section("S3 版本标记：有 schema 版本还靠 catch 幂等 = 两套机制互相掩盖");
  const versionMarker = src.match(/user_version|schema_version|schemaVersion|PRAGMA\s+user_version|cfg-schema/i);
  flow.record("schema 版本标记", versionMarker ? String(versionMarker[0]) : "未发现");
  const hasIndex = /CREATE\s+TABLE IF NOT EXISTS|CREATE\s+INDEX IF NOT EXISTS/i.test(src);
  flow.record("DDL 是否使用 IF NOT EXISTS 形式", hasIndex);
  flow.check("DDL 一律 IF NOT EXISTS（把「已存在」交给 SQL 而不是交给 catch）", hasIndex === true && blindInRegion.length === 0, "IF NOT EXISTS + 零盲吞", { hasIfNotExists: hasIndex, 盲吞: blindInRegion.length });

  flow.section("S4 「下次启动重试」这句注释有没有兑现机制");
  const retryClaims = lines.map((l, i) => ({ i: lineNo(i), m: /重试/.test(l) })).filter((x) => x.m);
  flow.record("声称「下次启动重试」的行", retryClaims.map((r) => `db.js:${r.i}`).join(" "));
  const markerBacked = /retry|pendingMigration|migration_failed|待迁移/i.test(src.replace(/重试/g, ""));
  flow.check("重试承诺必须有持久化标记支撑（否则是注释在编造机制）", markerBacked === true || retryClaims.length === 0, "有标记或无承诺", { markerBacked, 承诺数: retryClaims.length });

  flow.section("S5 备份/恢复侧同形检查");
  const bsrc = fs.readFileSync(path.join(ROOT, "electron", "backup.js"), "utf8").replace(/\r\n/g, "\n");
  const bblind = bsrc.split("\n").filter((l) => /}\s*catch\s*\{/.test(l) && /^\s*(\/\*[^*]*\*\/)?\s*$/.test((l.match(/catch\s*\{(.*)\}$/) || [, ""])[1]));
  flow.record("backup.js 盲吞站点数", bblind.length);
  const restoreThrows = /restoreBackup|applyPendingRestore/.test(bsrc);
  flow.check("恢复路径的盲吞必须为 0（恢复半途失败 = 用户数据两不靠）", restoreThrows ? bblind.length === 0 : true, "0 处", bblind.length);
});
