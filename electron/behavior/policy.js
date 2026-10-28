// BDI（D248 / T2）：行为数据策略文件与设置读侧归一。
// 唯一实现依据：docs/design/BEHAVIOR-DATA-INFRA-D248-v3.md §11.1 / §11.3。
// behavior-policy.json 在 userData 根、原子写、**不进备份**：用于清除后即使旧 settings.json 被恢复也不回填。
"use strict";
const fs = require("fs");
const path = require("path");
const { uuid7 } = require("./uuid7");

const POLICY_FILE = "behavior-policy.json";
const RETENTION_DAYS = [90, 365, 730, 0];
const DEFAULT_BEHAVIOR = Object.freeze({ enabled: true, retentionDays: 730, recordQueryText: false });

/** app.behavior 读侧归一：开关仅严格 false/true 生效；保留期只收四个枚举；查询原文默认关。 */
function normalizeBehavior(raw) {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const enabled = o.enabled === false ? false : true;
  const retentionDays = RETENTION_DAYS.includes(o.retentionDays) ? o.retentionDays : DEFAULT_BEHAVIOR.retentionDays;
  const recordQueryText = o.recordQueryText === true;
  return { enabled, retentionDays, recordQueryText };
}

/** 从 settings 对象读 app.behavior（readSettings 由宿主注入，纯函数可测）。 */
function readBehaviorConfig(readSettings) {
  let s = null;
  try {
    s = typeof readSettings === "function" ? readSettings() : readSettings;
  } catch {
    s = null;
  }
  const app = s && typeof s === "object" && s.app && typeof s.app === "object" ? s.app : {};
  return normalizeBehavior(app.behavior);
}

function policyPath(dataDir) {
  return path.join(dataDir, POLICY_FILE);
}

/** 原子写（tmp + fsync + rename）；失败抛出，由调用方决定是否降级。 */
function writePolicy(dataDir, policy) {
  const file = policyPath(dataDir);
  const tmp = `${file}.tmp`;
  const text = JSON.stringify(policy, null, 2) + "\n";
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, text, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  return policy;
}

/** 读取并净化；文件缺失/损坏返回 null（交给 ensurePolicy 重建）。 */
function readPolicy(dataDir) {
  const file = policyPath(dataDir);
  let o;
  try {
    o = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const dataEpoch = typeof o.dataEpoch === "string" && o.dataEpoch.length >= 8 ? o.dataEpoch : null;
  const num = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  return {
    dataEpoch,
    analysisFloorTs: num(o.analysisFloorTs) ?? 0,
    purgeAt: num(o.purgeAt),
    firstEnabledAt: num(o.firstEnabledAt),
  };
}

/**
 * 确保策略文件存在且可读。缺失/损坏 → 原子重建（新 dataEpoch，不从旧文件猜）。
 * 返回 { policy, created }。
 */
function ensurePolicy({ dataDir, enabled, now = Date.now() }) {
  const existing = readPolicy(dataDir);
  if (existing && existing.dataEpoch) return { policy: existing, created: false };
  const policy = {
    dataEpoch: existing && existing.dataEpoch ? existing.dataEpoch : uuid7(now),
    analysisFloorTs: existing ? existing.analysisFloorTs : 0,
    purgeAt: existing ? existing.purgeAt : null,
    firstEnabledAt: existing ? existing.firstEnabledAt : (enabled ? now : null),
  };
  writePolicy(dataDir, policy);
  return { policy, created: true };
}

module.exports = {
  POLICY_FILE,
  RETENTION_DAYS,
  DEFAULT_BEHAVIOR,
  normalizeBehavior,
  readBehaviorConfig,
  policyPath,
  readPolicy,
  writePolicy,
  ensurePolicy,
};
