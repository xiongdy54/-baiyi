#!/usr/bin/env node
// D248 / T15：只读检查 behavior.db 快照（不修改文件，不建 sidecar）。
// 用法（better-sqlite3 为 Electron ABI，脚本走 electron 的 node 通道）：
//   ELECTRON_RUN_AS_NODE=1 npx electron scripts/bdi-inspect.mjs <behavior.db>
//   Windows PowerShell：$env:ELECTRON_RUN_AS_NODE=1; npx electron scripts/bdi-inspect.mjs <behavior.db>
// 输出：JSON（schema 版本 / quick_check / dataEpoch / catalog 版本 / 各表行数 / 事件日范围）。
// 只接受合法的行为库快照（含 bdi_meta / events / attn_spans / sessions）；其它文件一律拒绝。
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const REQUIRED_TABLES = ["bdi_meta", "events", "attn_spans", "app_sessions"];

/** 只读检查一个 behavior.db 文件；返回结构化结果，不抛出（除文件不存在外的 IO 错误也转成 ok:false）。 */
export function inspectBehaviorDb(file) {
  const abs = path.resolve(String(file));
  let sizeBytes = 0;
  try {
    sizeBytes = fs.statSync(abs).size;
  } catch (e) {
    return { ok: false, code: "not_found", file: abs, detail: String((e && e.message) || e) };
  }
  let db = null;
  try {
    const Database = require("better-sqlite3");
    // readonly + query_only 双保险：脚本对快照零写入（不 checkpoint、不建 -wal/-shm）
    db = new Database(abs, { readonly: true, fileMustExist: true });
    db.pragma("query_only = ON");
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
    const missing = REQUIRED_TABLES.filter((t) => !tables.includes(t));
    if (missing.length) return { ok: false, code: "not_bdi_db", file: abs, missing, tables };
    const integrity = String(db.pragma("quick_check", { simple: true }));
    if (integrity !== "ok") return { ok: false, code: "integrity_failed", file: abs, integrity };
    const schemaVersion = Number(db.pragma("user_version", { simple: true })) || 0;
    const metaRows = db.prepare("SELECT key, value FROM bdi_meta ORDER BY key").all();
    const meta = Object.fromEntries(metaRows.map((r) => [String(r.key), String(r.value)]));
    const counts = {};
    for (const t of tables) {
      if (!/^[a-z][a-z0-9_]*$/.test(t)) continue;
      counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n;
    }
    const range = db.prepare("SELECT MIN(day) AS firstDay, MAX(day) AS lastDay FROM events").get() || {};
    return {
      ok: true,
      file: abs,
      sizeBytes,
      schemaVersion,
      integrity,
      dataEpoch: meta.data_epoch ?? null,
      catalogVersion: meta.catalog_version ?? null,
      firstEnabledAt: meta.first_enabled_at ?? null,
      analysisFloorTs: meta.analysis_floor_ts ?? null,
      lastRollupAt: meta.last_rollup_at ?? null,
      range: { firstDay: range.firstDay ?? null, lastDay: range.lastDay ?? null },
      counts,
      meta,
    };
  } catch (e) {
    // 常见误用：系统 node 加载 Electron ABI 的 better-sqlite3
    const msg = String((e && e.message) || e);
    const hint = /NODE_MODULE_VERSION|was compiled against a different Node\.js version/.test(msg)
      ? "（请用 ELECTRON_RUN_AS_NODE=1 npx electron scripts/bdi-inspect.mjs）"
      : "";
    return { ok: false, code: "open_failed", file: abs, detail: msg + hint };
  } finally {
    try { if (db) db.close(); } catch { /* 只读关闭失败不影响结果 */ }
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  const file = process.argv[2];
  if (!file) {
    console.error("用法：ELECTRON_RUN_AS_NODE=1 npx electron scripts/bdi-inspect.mjs <behavior.db>");
    process.exitCode = 2;
  } else {
    const r = inspectBehaviorDb(file);
    console.log(JSON.stringify(r, null, 2));
    process.exitCode = r.ok ? 0 : 1;
  }
}
