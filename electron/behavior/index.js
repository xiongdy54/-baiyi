// BDI（D248 / T2）：门面——init / emit / emitSpan / flushSync / close / status / setEnabled / snapshotTo。
// 唯一实现依据：docs/design/BEHAVIOR-DATA-INFRA-D248-v3.md §4.3 / §5.1 / §7.6 / §11.1。
// 纪律：本目录不 require("electron")；需要的宿主能力（dataDir / settings / app / powerMonitor / windows）
// 一律由 init() 注入。任何采集/派生失败不得外溢到业务写路径。
"use strict";
const behaviorDb = require("./behaviorDb");
const policyMod = require("./policy");
const { createWriter } = require("./writer");
const { createSessions } = require("./sessions");

let ctx = null;
let writer = null;
let sessions = null;
let config = { ...policyMod.DEFAULT_BEHAVIOR };
let policy = null;
let state = { status: "uninitialized", reason: null, detail: null };
let unsubscribers = [];
let closing = false;
/** init 完成前 emit 的事件先留队列（§7.6），有界；init 成功后按序写入，停用则丢弃。 */
let pending = [];
const PENDING_MAX = 500;

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
    session: sessions ? sessions.status() : null,
  };
}

function resetForTest() {
  closing = false;
  pending = [];
  for (const off of unsubscribers) {
    try { off(); } catch { /* 已解绑 */ }
  }
  unsubscribers = [];
  if (sessions) {
    try { sessions.detachAll(); } catch { /* 已卸载 */ }
    sessions = null;
  }
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

/** 默认窗口识别：按加载页面文件名（不读标题/内容），base 窗口回落 main。 */
function defaultIdentifyWindow(win) {
  try {
    const url = String(win.webContents.getURL() || "");
    if (url.includes("lens.html")) return "lens";
    if (url.includes("workbench.html")) return "workbench";
    if (url.includes("capture.html")) return "capture";
  } catch { /* 已销毁 */ }
  return "main";
}

function bindHostEvents(o) {
  const app = o.app;
  if (app && typeof app.on === "function") {
    const onCreated = (_e, win) => { try { sessions.attachWindow(win); } catch { /* 已销毁 */ } };
    app.on("browser-window-created", onCreated);
    unsubscribers.push(() => { try { app.removeListener("browser-window-created", onCreated); } catch { /* 已退出 */ } });
  }
  const pm = o.powerMonitor;
  if (pm && typeof pm.on === "function") {
    const map = { suspend: "suspend", resume: "resume", "lock-screen": "lock", "unlock-screen": "unlock" };
    for (const [ev, stateName] of Object.entries(map)) {
      const fn = () => { try { sessions.notePower(stateName); } catch { /* 电源事件不影响业务 */ } };
      pm.on(ev, fn);
      unsubscribers.push(() => { try { pm.removeListener(ev, fn); } catch { /* 已退出 */ } });
    }
  }
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
  if (closing) return getStatus();
  state = { status: "starting", reason: null, detail: null };
  ctx = {
    dataDir: o.dataDir,
    settings: o.settings,
    now: o.now,
    app: o.app,
    powerMonitor: o.powerMonitor,
    windows: o.windows,
    deviceId: o.deviceId,
    appVersion: o.appVersion,
    os: o.os,
    locale: o.locale,
    identifyWindow: o.identifyWindow,
  };
  config = policyMod.readBehaviorConfig(o.settings);
  try {
    const ensured = policyMod.ensurePolicy({ dataDir: o.dataDir, enabled: config.enabled, now: now() });
    policy = ensured.policy;
  } catch (e) {
    state = { status: "disabled", reason: "policy_unavailable", detail: String((e && e.message) || e) };
    pending = [];
    return getStatus();
  }
  if (!config.enabled) {
    state = { status: "disabled", reason: "disabled_by_user", detail: null };
    pending = [];
    return getStatus();
  }
  behaviorDb.configure({ dataDir: o.dataDir });
  const db = await behaviorDb.open();
  if (!db) {
    state = { status: "disabled", reason: behaviorDb.getStatus().reason, detail: behaviorDb.getStatus().detail };
    pending = [];
    return getStatus();
  }
  if (closing) {
    behaviorDb.close();
    return getStatus();
  }
  writer = createWriter({ db, recordQueryText: config.recordQueryText, uuid: o.uuid });
  writer.start();
  state = { status: "ok", reason: null, detail: null };
  sessions = createSessions({
    db,
    settings: o.settings,
    now: o.now,
    appVersion: o.appVersion,
    os: o.os,
    locale: o.locale,
    dataEpoch: policy ? policy.dataEpoch : null,
    deviceId: o.deviceId,
    emit,
    flush: () => writer.flushSync(),
    windows: o.windows,
    identifyWindow: typeof o.identifyWindow === "function" ? o.identifyWindow : defaultIdentifyWindow,
  });
  try {
    sessions.init();
  } catch (e) {
    state = { status: "disabled", reason: "sessions_failed", detail: String((e && e.message) || e) };
    return getStatus();
  }
  bindHostEvents(o);
  const buffered = pending;
  pending = [];
  for (const ev of buffered) emit(ev);
  return getStatus();
}

function isReady() {
  return state.status === "ok" && !!writer && config.enabled;
}

/** 采集入口：事件。返回 {ok} 或 {ok:false, code}；永不抛出。init 完成前按键入有界缓冲。 */
function emit(event) {
  if (closing) return { ok: false, code: "closing" };
  if (!isReady()) {
    if ((state.status === "starting" || state.status === "uninitialized") && event && typeof event === "object" && pending.length < PENDING_MAX) {
      pending.push(event);
    }
    return { ok: false, code: "not_ready" };
  }
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
  const turningOn = next === true;
  if (!turningOn && sessions) {
    try { sessions.end("disabled"); } catch { /* 禁用路径不得抛 */ }
  }
  config = { ...config, enabled: turningOn };
  if (writer) writer.setEnabled(turningOn);
  if (turningOn && policy && !policy.firstEnabledAt) {
    policy = { ...policy, firstEnabledAt: now() };
    try { policyMod.writePolicy(ctx.dataDir, policy); } catch { /* 失败由设置页告知 */ }
  }
  state = turningOn
    ? (behaviorDb.getStatus().status === "ok" ? { status: "ok", reason: null, detail: null } : state)
    : { status: "disabled", reason: "disabled_by_user", detail: null };
  if (turningOn && sessions && behaviorDb.getStatus().status === "ok") {
    try { sessions.init(); } catch { state = { status: "disabled", reason: "sessions_failed", detail: null }; }
  }
  return getStatus();
}

function setRecordQueryText(next) {
  config = { ...config, recordQueryText: next === true };
  if (writer) writer.setRecordQueryText(config.recordQueryText);
  return config.recordQueryText;
}

/** 退出顺序（§5.1）：flush → sessions.end("quit") → checkpoint → close。 */
function close() {
  closing = true;
  pending = [];
  if (writer) {
    try { writer.flushSync(); } catch { /* 关闭路径不得抛 */ }
  }
  if (sessions) {
    try { sessions.end("quit"); } catch { /* 关闭路径不得抛 */ }
    try { sessions.detachAll(); } catch { /* 已销毁 */ }
  }
  for (const off of unsubscribers) {
    try { off(); } catch { /* 已解绑 */ }
  }
  unsubscribers = [];
  if (writer) {
    try { writer.flushSync(); } catch { /* 关闭路径不得抛 */ }
    writer.stop();
    writer = null;
  }
  const r = behaviorDb.close();
  sessions = null;
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
  getSessions: () => sessions,
  resetForTest,
};
