// BDI（D248 / T12）：隐私——导出（JSONL + ZIP）、清除查询原文、保留期归档后删原始、清除全部（generation 屏障）。
// 唯一实现依据：docs/design/BEHAVIOR-DATA-INFRA-D248-v3.md §11.3–§11.5。
// 纪律：原始层删除只在本文件；失败必须如实返回（不得显示「清除成功」）；导出不连接活动库（用快照）。
"use strict";
const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const { uuid7 } = require("./uuid7");

const RAW_TABLES = ["events", "attn_spans", "app_sessions", "ipc_daily", "capture_intervals"];
const DERIVED_TABLES = ["entity_domains", "daily_metrics", "domain_day", "item_day", "signal_daily", "coverage_day", "archived_days", "dirty_days"];
const EXPORT_TABLES = [...RAW_TABLES, ...DERIVED_TABLES];
const PAGE = 500;

function createPrivacy(opts) {
  const db = opts.db;
  const dataDir = opts.dataDir;
  const now = typeof opts.now === "function" ? opts.now : Date.now;

  /** 清除所有查询原文（保留计数）。 */
  function clearQueryText() {
    const before = db.prepare("SELECT COUNT(*) AS n FROM events WHERE text IS NOT NULL").get().n;
    db.prepare("UPDATE events SET text = NULL WHERE text IS NOT NULL").run();
    return { cleared: before };
  }

  /** 保留期：先写 archived_days 再按 day 批量物理删除原始行（每批 ≤5000，末尾增量 vacuum）。 */
  function enforceRetention(retentionDays) {
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) return { archivedDays: 0, deleted: 0 };
    const cutoff = now() - retentionDays * 86400000;
    const days = db.prepare("SELECT DISTINCT day FROM events").all().map((r) => r.day)
      .filter((d) => {
        const [y, m, dd] = String(d).split("-").map(Number);
        return Date.UTC(y, m - 1, dd) + 86400000 <= cutoff;
      });
    const rv = Number(db.prepare("SELECT value FROM bdi_meta WHERE key = 'derive_version'").get()?.value || 0);
    let deleted = 0;
    db.transaction(() => {
      for (const day of days) {
        db.prepare("INSERT OR IGNORE INTO archived_days (day, archived_at, rv, attribution_version, valid, reason) VALUES (?,?,?,?,1,'retention')")
          .run(day, now(), rv, Number(db.prepare("SELECT value FROM bdi_meta WHERE key = 'attribution_version'").get()?.value || 1));
      }
    })();
    for (const day of days) {
      for (;;) {
        const n = db.prepare(`DELETE FROM events WHERE seq IN (SELECT seq FROM events WHERE day = ? LIMIT 5000)`).run(day).changes;
        deleted += n;
        if (n < 5000) break;
      }
      db.transaction(() => {
        db.prepare("DELETE FROM attn_spans WHERE day = ?").run(day);
        db.prepare("DELETE FROM ipc_daily WHERE day = ?").run(day);
      })();
    }
    try { db.pragma("incremental_vacuum"); } catch { /* 尽力而为 */ }
    db.prepare("INSERT INTO bdi_meta (key, value) VALUES ('last_retention_run', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(now()));
    return { archivedDays: days.length, deleted };
  }

  /** 导出：flush 后快照 → 只读快照逐表 JSONL → ZIP；失败删临时文件。 */
  async function exportTo(dest, extra) {
    const destFile = String(dest || "");
    if (!destFile) throw new Error("导出需要目标路径");
    const tmpDir = fs.mkdtempSync(path.join(dataDir, "bdi-export-"));
    const snap = path.join(tmpDir, "snapshot.db");
    try {
      await opts.snapshot(snap); // 调用方已 flushSync
      const Database = require("better-sqlite3");
      const conn = new Database(snap, { readonly: true });
      const zip = new JSZip();
      const manifest = { formatVersion: 1, exportedAt: now(), dataEpoch: null, tables: {} };
      try { manifest.dataEpoch = String(conn.prepare("SELECT value FROM bdi_meta WHERE key='data_epoch'").get()?.value || ""); } catch { /* 空库 */ }
      for (const table of EXPORT_TABLES) {
        let rows;
        try { rows = conn.prepare(`SELECT * FROM ${table}`).all(); } catch { rows = []; }
        if (table === "events" && !(extra && extra.includeText)) {
          rows = rows.map((r) => ({ ...r, text: null }));
        }
        const lines = rows.map((r) => JSON.stringify(r)).join("\n");
        zip.file(`${table}.jsonl`, lines ? lines + "\n" : "");
        manifest.tables[table] = rows.length;
      }
      manifest.redacted = !(extra && extra.includeText);
      zip.file("schema.json", JSON.stringify({ schemaVersion: opts.schemaVersion, tables: EXPORT_TABLES }, null, 2));
      zip.file("manifest.json", JSON.stringify(manifest, null, 2));
      zip.file("README.txt", "Nutation 行为数据导出（JSONL）。本地导出，不是可逆恢复格式；不含正文/标题/路径/凭证。text 字段默认已脱敏。\n");
      const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
      const part = destFile + ".part";
      fs.writeFileSync(part, buf);
      fs.renameSync(part, destFile);
      conn.close();
      return { ok: true, file: destFile, bytes: buf.length, manifest };
    } catch (e) {
      try { fs.rmSync(destFile + ".part", { force: true }); } catch { /* 残留由维护清理 */ }
      throw e;
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* 尽力而为 */ }
    }
  }

  return { clearQueryText, enforceRetention, exportTo, RAW_TABLES, DERIVED_TABLES, EXPORT_TABLES };
}

/** 新 dataEpoch（清除后由调用方写 policy）。 */
function newEpoch(nowMs = Date.now()) {
  return uuid7(nowMs);
}

module.exports = { createPrivacy, newEpoch, RAW_TABLES, DERIVED_TABLES, EXPORT_TABLES };
