// BDI（D248 / T2）：门面——init / emit / emitSpan / flushSync / close / status / setEnabled / snapshotTo。
// 唯一实现依据：docs/design/BEHAVIOR-DATA-INFRA-D248-v3.md §4.3 / §5.1 / §7.6 / §11.1。
// 纪律：本目录不 require("electron")；需要的宿主能力（dataDir / settings / app / powerMonitor / windows）
// 一律由 init() 注入。任何采集/派生失败不得外溢到业务写路径。
"use strict";
const behaviorDb = require("./behaviorDb");
const policyMod = require("./policy");
const { createWriter } = require("./writer");

let ctx = null;
let writer = null;
let config = { ...policyMod.DEFAULT_BEHAVIOR };
let policy = null;
let state = { status: "uninitialized", reason: null, detail: null };

function now() {
  return typeof ctx?.now === "function" ? ctx.now() : Date.now();
}

function getStatus() {
  const db = behaviorDb.getStatus();
  return {
    status: state.status,
    reason: state.reason || db.reason,
    detail: state.detail || db.detail,
    enabled: config.enabled,
    retentionDays: config.retentionDays,
    recordQueryText: config.recordQueryText,
    db,
    policy,
    writer: writer ? writer.stats() : null,
  };
}

function resetForTest() {
  if (writer) {
    try { writer.stop(); } catch { /* 已停 */ }
  }
  writer = null;
  ctx = null;
  config = { ...policyMod.DEFAULT_BEHAVIOR };
  policy = null;
  state = { status: "uninitialized", reason: null, detail: null };
  behaviorDb.resetForTest();
}

/**
 * 初始化。opts:
 *   dataDir（必填）/ settings()（返回 settings 对象，可选）/ now()（可选）
 *   app / powerMonitor / windows（T3 起使用）
 * 打开失败、策略不可写、用户关闭 → disabled，不抛出。
 */
async function init(opts) {
  const o = opts || {};
  if (!o.dataDir) throw new Error("behavior.init 缺少 dataDir");
  ctx = {
    dataDir: o.dataDir,
    settings: o.settings,
    now: o.now,
    app: o.app,
    powerMonitor: o.powerMonitor,
    windows: o.windows,
    deviceId: o.deviceId,
  };
  config = policyMod.readBehaviorConfig(o.settings);
  try {
    const ensured = policyMod.ensurePolicy({ dataDir: o.dataDir, enabled: config.enabled, now: now() });
    policy = ensured.policy;
  } catch (e) {
    state = { status: "disabled", reason: "policy_unavailable", detail: String((e && e.message) || e) };
    return getStatus();
  }
  if (!config.enabled) {
    state = { status: "disabled", reason: "disabled_by_user", detail: null };
    return getStatus();
  }
  behaviorDb.configure({ dataDir: o.dataDir });
  const db = await behaviorDb.open();
  if (!db) {
    state = { status: "disabled", reason: behaviorDb.getStatus().reason, detail: behaviorDb.getStatus().detail };
    return getStatus();
  }
  writer = createWriter({ db, recordQueryText: config.recordQueryText, uuid: o.uuid });
  writer.start();
  state = { status: "ok", reason: null, detail: null };
  return getStatus();
}

function isReady() {
  return state.status === "ok" && !!writer && config.enabled;
}

/** 采集入口：事件。返回 {ok} 或 {ok:false, code}；永不抛出。 */
function emit(event) {
  if (!isReady()) return { ok: false, code: "disabled" };
  if (!event || typeof event !== "object") return { ok: false, code: "not_object" };
  if (!event.recv_ts) event.recv_ts = now();
  if (!event.session_id) return { ok: false, code: "session_missing" };
  return writer.push(event);
}

/** 采集入口：注意力 span（心跳复用 uid + revision）。 */
function emitSpan(span) {
  if (!isReady()) return { ok: false, code: "disabled" };
  return writer.pushSpan(span);
}

function flushSync() {
  return writer ? writer.flushSync() : 0;
}

/** 备份 / 导出前：先冲队列再快照（§12.1）。 */
async function snapshotTo(dest) {
  flushSync();
  return behaviorDb.snapshotTo(dest);
}

function setEnabled(next) {
  config = { ...config, enabled: next === true };
  if (writer) writer.setEnabled(config.enabled);
  if (config.enabled && policy && !policy.firstEnabledAt) {
    policy = { ...policy, firstEnabledAt: now() };
    try { policyMod.writePolicy(ctx.dataDir, policy); } catch { /* 失败由设置页告知 */ }
  }
  state = config.enabled
    ? (behaviorDb.getStatus().status === "ok" ? { status: "ok", reason: null, detail: null } : state)
    : { status: "disabled", reason: "disabled_by_user", detail: null };
  return getStatus();
}

function setRecordQueryText(next) {
  config = { ...config, recordQueryText: next === true };
  if (writer) writer.setRecordQueryText(config.recordQueryText);
  return config.recordQueryText;
}

function close() {
  if (writer) {
    try { writer.flushSync(); } catch { /* 关闭路径不得抛 */ }
    writer.stop();
    writer = null;
  }
  const r = behaviorDb.close();
  state = { status: "closed", reason: null, detail: null };
  return r;
}

module.exports = {
  init,
  isReady,
  emit,
  emitSpan,
  flushSync,
  snapshotTo,
  setEnabled,
  setRecordQueryText,
  close,
  getStatus,
  getPolicy: () => policy,
  getConfig: () => ({ ...config }),
  getDb: () => behaviorDb.getDb(),
  getWriter: () => writer,
  resetForTest,
};
