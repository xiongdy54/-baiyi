// D206 设置页置顶通知框·数据合成（computeSettingsNotices）：级别映射 / 7 天阈值边界 / 无备份 / 排序
// 运行：node tests/settings-notices.test.cjs（运行时自行 esbuild src/lib/settingsNotices.ts → tests/tmp-snotices）
// @runtime: system-node
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "tmp-snotices");
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/lib/settingsNotices.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outdir: OUT,
  logLevel: "silent"
});
const { computeSettingsNotices, BACKUP_STALE_DAYS } = require("./tmp-snotices/settingsNotices.js");

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${JSON.stringify(actual)}`); }
}
const kinds = (r) => r.map((n) => n.kind);
const DAY = 86400000;
const NOW = 1_800_000_000_000;

console.log("== 1) 空输入 ==");
check("无任何数据源 → 空数组（零 DOM 前提）", computeSettingsNotices({ now: NOW }).length === 0, computeSettingsNotices({ now: NOW }));
check("store/dev 渠道 state 不产通知", computeSettingsNotices({ updateState: "not-available", now: NOW }).length === 0, computeSettingsNotices({ updateState: "not-available", now: NOW }));
check("阈值常量 = 7 天", BACKUP_STALE_DAYS === 7, BACKUP_STALE_DAYS);

console.log("== 2) 绿：可用更新 ==");
let r = computeSettingsNotices({ updateState: "available", updateVersion: "9.9.9", now: NOW });
check("available → info/update 且带版本参数", r.length === 1 && r[0].level === "info" && r[0].kind === "update" && r[0].params.version === "9.9.9", r);
r = computeSettingsNotices({ updateState: "downloaded", updateVersion: "9.9.9", now: NOW });
check("downloaded → info/update-ready", r.length === 1 && r[0].kind === "update-ready" && r[0].level === "info", r);

console.log("== 3) 红：报错 ==");
r = computeSettingsNotices({ updateState: "error", updateError: "ENOTFOUND", now: NOW });
check("更新检查出错 → error/update-error 且带 msg", r.length === 1 && r[0].level === "error" && r[0].kind === "update-error" && r[0].params.msg === "ENOTFOUND", r);
r = computeSettingsNotices({ lastAuto: { ok: false, error: "磁盘空间不足", clockSkewSuspected: false }, now: NOW });
check("自动备份失败 → error/backup-failed 且带 msg", r.length === 1 && r[0].level === "error" && r[0].kind === "backup-failed" && r[0].params.msg === "磁盘空间不足", r);
// C-23：主库快照 quick_check 不通过——备份本体成功但轮换已暂停，属最需用户介入的红条
r = computeSettingsNotices({ lastAuto: { ok: true, error: null, clockSkewSuspected: false, integrityWarning: true }, now: NOW });
check("完整性告警 → error/backup-integrity", r.length === 1 && r[0].level === "error" && r[0].kind === "backup-integrity", r);
check("无 integrityWarning → 不产通知", computeSettingsNotices({ lastAuto: { ok: true, error: null, clockSkewSuspected: false, integrityWarning: false }, now: NOW }).length === 0, "");
r = computeSettingsNotices({ lastAuto: { ok: false, error: "x", clockSkewSuspected: false, integrityWarning: true }, now: NOW });
check("备份失败与完整性告警同在 → 两条 error 稳定排序", JSON.stringify(kinds(r)) === JSON.stringify(["backup-failed", "backup-integrity"]), kinds(r));

console.log("== 4) 黄：备份停摆 ==");
r = computeSettingsNotices({ latestBackupAt: null, now: NOW });
check("一份备份都没有 → warn/backup-none", r.length === 1 && r[0].level === "warn" && r[0].kind === "backup-none", r);
check("6 天前备份 → 不告警", computeSettingsNotices({ latestBackupAt: NOW - 6 * DAY, now: NOW }).length === 0, computeSettingsNotices({ latestBackupAt: NOW - 6 * DAY, now: NOW }));
r = computeSettingsNotices({ latestBackupAt: NOW - 7 * DAY, now: NOW });
check("恰好 7 天 → warn/backup-stale 且 days=7（≥ 边界）", r.length === 1 && r[0].kind === "backup-stale" && r[0].params.days === 7, r);
r = computeSettingsNotices({ latestBackupAt: NOW - 9 * DAY, now: NOW });
check("9 天 → backup-stale 且 days=9", r[0].kind === "backup-stale" && r[0].params.days === 9, r);
r = computeSettingsNotices({ lastAuto: { ok: true, error: null, clockSkewSuspected: true }, now: NOW });
check("时钟回拨嫌疑 → warn/clock-skew", r.length === 1 && r[0].level === "warn" && r[0].kind === "clock-skew", r);
check("自动备份成功且无 skew → 不产通知", computeSettingsNotices({ lastAuto: { ok: true, error: null, clockSkewSuspected: false }, now: NOW }).length === 0, "");
check("skipped 也算正常结局", computeSettingsNotices({ lastAuto: { ok: true, skipped: true, error: null, clockSkewSuspected: false }, now: NOW }).length === 0, "");

console.log("== 5) 排序：error → warn → info ==");
r = computeSettingsNotices({
  updateState: "available",
  updateVersion: "9.9.9",
  lastAuto: { ok: false, error: "x", clockSkewSuspected: true },
  latestBackupAt: NOW - 8 * DAY,
  now: NOW
});
check("4 条全部产出", r.length === 4, r);
check("排序 = [backup-failed, clock-skew, backup-stale, update]", JSON.stringify(kinds(r)) === JSON.stringify(["backup-failed", "clock-skew", "backup-stale", "update"]), kinds(r));

// 清理打包副产物
fs.rmSync(OUT, { recursive: true, force: true });
console.log(`\n设置页通知框数据合成：${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
