// BDI（D248 / T2）：门面——init / emit / emitSpan / flushSync / close / status / setEnabled / snapshotTo。
// 唯一实现依据：docs/design/BEHAVIOR-DATA-INFRA-D248-v3.md §4.3 / §5.1 / §7.6 / §11.1。
// 纪律：本目录不 require("electron")；需要的宿主能力（dataDir / settings / app / powerMonitor / windows）
// 一律由 init() 注入。任何采集/派生失败不得外溢到业务写路径。
"use strict";
const behaviorDb = require("./behaviorDb");
const policyMod = require("./policy");
const { createWriter } = require("./writer");
const { createSessions } = require("./sessions");
const { createIpcStats } = require("./ipcStats");
const { createDomains } = require("./domains");
const { createRollup } = require("./rollup");
const { createCoverage } = require("./coverage");
const { createQuery } = require("./query");
const privacyMod = require("./privacy");
const { learningDayStartMs } = require("../fsrsTime");
const fs = require("fs");
const path = require("path");

let ctx = null;
let writer = null;
let sessions = null;
let ipcStats = null;
let domains = null;
let domainsTimer = null;
let domainsFirstTimer = null;
let rollup = null;
let coverage = null;
let queryApi = null;
let rollupTimer = null;
let rollupFirstTimer = null;
let config = { ...policyMod.DEFAULT_BEHAVIOR };
let policy = null;
let state = { status: "uninitialized", reason: null, detail: null };
let unsubscribers = [];
let closing = false;
/** init 完成前 emit 的事件先留队列（§7.6），有界；init 成功后按序写入，停用则丢弃。 */
let pending = [];
const PENDING_MAX = 500;
/** 采集世代：禁用/清除时 +1；旧世代批次一律拒收（§7.2 / §11.2）。 */
let generation = 1;
const BATCH_MAX_ITEMS = 100;
const BATCH_MAX_BYTES = 256 * 1024;

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
    ipc: ipcStats ? { pending: Object.keys(ipcStats.snapshot()).length } : null,
  };
}

function tapCutoffHour() {
  try {
    const s = typeof ctx?.settings === "function" ? ctx.settings() : null;
    const h = Number(s?.app?.dayCutoffHour);
    return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 4;
  } catch {
    return 4;
  }
}

function dayStringOf(ms) {
  const d = new Date(learningDayStartMs(ms, tapCutoffHour()));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 撤销评分只删最近一条日志：把当前学习日 + 前一日标 dirty（rollup 重算两日足够，§7.1 规则 8）。 */
function markUndoDirty() {
  const db = behaviorDb.getDb();
  if (!db) return;
  const t = now();
  const rows = [dayStringOf(t), dayStringOf(t - 86400000)];
  const set = db.prepare("INSERT OR IGNORE INTO dirty_days (day, reason) VALUES (?, 'undo')");
  try {
    db.transaction(() => { for (const day of rows) set.run(day); })();
  } catch { /* 派生标记失败不影响业务 */ }
}

/** ipcTap 需要的运行时上下文（不暴露 db / writer 本体）。 */
function getTapContext() {
  return {
    sessionId: () => (sessions ? sessions.getSessionId() : null),
    now,
    cutoffHour: tapCutoffHour,
    recordQueryText: () => config.recordQueryText === true,
    get stats() { return ipcStats; }, // 动态：install 早于 init
    markUndoDirty,
  };
}

function resetForTest() {
  closing = false;
  pending = [];
  generation = 1;
  for (const off of unsubscribers) {
    try { off(); } catch { /* 已解绑 */ }
  }
  unsubscribers = [];
  if (sessions) {
    try { sessions.detachAll(); } catch { /* 已卸载 */ }
    sessions = null;
  }
  if (domainsFirstTimer) { clearTimeout(domainsFirstTimer); domainsFirstTimer = null; }
  if (domainsTimer) { clearInterval(domainsTimer); domainsTimer = null; }
  if (rollupFirstTimer) { clearTimeout(rollupFirstTimer); rollupFirstTimer = null; }
  if (rollupTimer) { clearInterval(rollupTimer); rollupTimer = null; }
  domains = null;
  rollup = null;
  coverage = null;
  queryApi = null;
  if (ipcStats) {
    try { ipcStats.stop(); } catch { /* 已停 */ }
    ipcStats = null;
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
  startRuntime(db, o);
  const buffered = pending;
  pending = [];
  for (const ev of buffered) emit(ev);
  return getStatus();
}

/** 装配运行期（writer / stats / 派生调度 / 会话 / 宿主事件）；init 与 purge 后复用。 */
function startRuntime(db, o) {
  writer = createWriter({ db, recordQueryText: config.recordQueryText, uuid: o.uuid });
  writer.start();
  writer.setEnabled(config.enabled);
  ipcStats = createIpcStats({ now, dayOf: () => dayStringOf(now()) });
  ipcStats.start(db);
  if (typeof o.pull === "function") {
    // §8.3：启动 90s 首次全量 scan；之后每 30 分钟（页间让出由 domains.scanAll 分页承担）
    domains = createDomains({ db, pull: o.pull, now });
    coverage = createCoverage({ db, now, cutoffHour: tapCutoffHour });
    rollup = createRollup({ db, pull: o.pull, now, cutoffHour: tapCutoffHour });
    queryApi = createQuery({ db, pull: o.pull, now, todayDay: () => dayStringOf(now()) });
    const runDomains = () => { try { domains.refreshAll(); } catch { /* 归因失败不影响业务 */ } };
    domainsFirstTimer = setTimeout(runDomains, 90 * 1000);
    if (domainsFirstTimer.unref) domainsFirstTimer.unref();
    domainsTimer = setInterval(runDomains, 30 * 60 * 1000);
    if (domainsTimer.unref) domainsTimer.unref();
    const runRollup = () => { try { rollup.ensureDeriveVersion(); rollup.refreshIncremental(); } catch { /* 派生失败不影响业务 */ } };
    rollupFirstTimer = setTimeout(runRollup, 120 * 1000);
    if (rollupFirstTimer.unref) rollupFirstTimer.unref();
    rollupTimer = setInterval(runRollup, 30 * 60 * 1000);
    if (rollupTimer.unref) rollupTimer.unref();
  }
  state = config.enabled ? { status: "ok", reason: null, detail: null } : { status: "disabled", reason: "disabled_by_user", detail: null };
  if (!config.enabled) return getStatus();
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
  return getStatus();
}

function stopRuntime() {
  for (const off of unsubscribers) { try { off(); } catch { /* 已解绑 */ } }
  unsubscribers = [];
  if (sessions) { try { sessions.detachAll(); } catch { /* 已卸载 */ } sessions = null; }
  if (domainsFirstTimer) { clearTimeout(domainsFirstTimer); domainsFirstTimer = null; }
  if (domainsTimer) { clearInterval(domainsTimer); domainsTimer = null; }
  if (rollupFirstTimer) { clearTimeout(rollupFirstTimer); rollupFirstTimer = null; }
  if (rollupTimer) { clearInterval(rollupTimer); rollupTimer = null; }
  domains = null; rollup = null; coverage = null; queryApi = null;
  if (ipcStats) { try { ipcStats.stop(); } catch { /* 已停 */ } ipcStats = null; }
  if (writer) { try { writer.stop(); } catch { /* 已停 */ } writer = null; }
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

/** 渲染层批次：校验世代/条数/字节，补齐公共字段后逐条入队（§7.2 / §2.2 V1-8）。 */
function acceptBatch(payload, role) {
  if (closing) return { ok: false, code: "closing" };
  if (!isReady()) return { ok: false, code: "disabled" };
  if (!payload || typeof payload !== "object") return { ok: false, code: "bad_payload" };
  if (payload.generation !== undefined && payload.generation !== generation) {
    return { ok: false, code: "stale_generation", generation };
  }
  const events = Array.isArray(payload.events) ? payload.events : [];
  const spans = Array.isArray(payload.spans) ? payload.spans : [];
  if (events.length + spans.length > BATCH_MAX_ITEMS) return { ok: false, code: "batch_too_large", accepted: 0 };
  let bytes = 0;
  try { bytes = JSON.stringify(payload).length; } catch { return { ok: false, code: "bad_payload" }; }
  if (bytes > BATCH_MAX_BYTES) return { ok: false, code: "batch_too_large", accepted: 0 };

  const t = now();
  const cutoff = tapCutoffHour();
  const day = dayStringOf(t);
  const sid = sessions ? sessions.getSessionId() : null;
  let accepted = 0;
  for (const raw of events) {
    if (!raw || typeof raw !== "object") continue;
    const e = { ...raw };
    e.src = role; // 不信任渲染层自报来源
    e.session_id = sid;
    e.recv_ts = Number.isFinite(e.recv_ts) ? e.recv_ts : t;
    e.ts = Number.isFinite(e.ts) ? e.ts : e.recv_ts;
    e.day = typeof e.day === "string" ? e.day : day;
    e.tz_offset = Number.isInteger(e.tz_offset) ? e.tz_offset : -new Date(e.ts).getTimezoneOffset();
    e.cutoff_hour = Number.isInteger(e.cutoff_hour) ? e.cutoff_hour : cutoff;
    e.render_id = e.render_id || payload.renderId || null;
    e.window_id = Number.isInteger(e.window_id) ? e.window_id : (Number.isInteger(payload.windowId) ? payload.windowId : null);
    if (e.v === undefined) e.v = 1;
    if (e.actor === undefined) e.actor = "unknown";
    const r = writer.push(e);
    if (r.ok) accepted++;
  }
  for (const raw of spans) {
    if (!raw || typeof raw !== "object") continue;
    const s = { ...raw };
    s.src = role;
    s.session_id = sid;
    s.day = typeof s.day === "string" ? s.day : day;
    s.render_id = s.render_id || payload.renderId || null;
    s.window_id = Number.isInteger(s.window_id) ? s.window_id : (Number.isInteger(payload.windowId) ? payload.windowId : null);
    if (!Number.isInteger(s.cutoff_hour)) s.cutoff_hour = cutoff;
    const r = writer.pushSpan(s);
    if (r.ok) accepted++;
  }
  return { ok: true, accepted };
}

/** 给渲染层的配置推送载荷（禁用/清除后由主进程广播 behavior:config）。 */
function configPayload() {
  return { enabled: config.enabled, generation, recordQueryText: config.recordQueryText === true };
}

/** 设置页/诊断用的公开状态（不含文件路径、策略内部字段）。 */
function publicStatus() {
  const s = getStatus();
  return {
    status: s.status,
    reason: s.reason,
    enabled: s.enabled,
    retentionDays: s.retentionDays,
    recordQueryText: s.recordQueryText,
    generation,
    db: { status: s.db.status, reason: s.db.reason, open: s.db.open, schemaVersion: s.db.schemaVersion },
    session: s.session ? { active: s.session.active } : null,
    writer: s.writer ? { queued: s.writer.queued, written: s.writer.written, rejected: s.writer.rejected } : null,
  };
}

function getGeneration() {
  return generation;
}

/** 具名只读查询（禁止任意 SQL）。查询前若派生落后 >5 分钟先同步跑一次增量。 */
function runQuery(name, params) {
  if (!queryApi) return { ok: false, code: "not_available" };
  const fn = queryApi.queries[String(name)];
  if (!fn) return { ok: false, code: "unknown_query" };
  try {
    const last = Number(behaviorDb.getMeta("last_rollup_at", "0")) || 0;
    if (rollup && Date.now() - last > 5 * 60 * 1000) {
      try { rollup.ensureDeriveVersion(); rollup.refreshIncremental(); } catch { /* 落后时返回 stale 数据 */ }
    }
    return { ok: true, name: String(name), data: fn(params || {}) };
  } catch (e) {
    return { ok: false, code: "query_failed", detail: String((e && e.message) || e) };
  }
}

/** 覆盖重算（rollup 前由调用方/定时器给定日集合；无参时用原始数据出现过的 day）。 */
function refreshCoverage(days) {
  if (!coverage) return 0;
  const list = Array.isArray(days) && days.length
    ? days
    : [...new Set([
        ...behaviorDb.getDb().prepare("SELECT DISTINCT day FROM events").all().map((r) => r.day),
        ...behaviorDb.getDb().prepare("SELECT DISTINCT day FROM attn_spans").all().map((r) => r.day),
      ])];
  try { return coverage.refreshDays(list); } catch { return 0; }
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
  if (!turningOn) generation++; // 旧会话的缓冲批次从此拒收
  config = { ...config, enabled: turningOn };
  if (writer) writer.setEnabled(turningOn);
  if (turningOn && policy && !policy.firstEnabledAt) {
    policy = { ...policy, firstEnabledAt: now() };
    try { policyMod.writePolicy(ctx.dataDir, policy); } catch { /* 失败由设置页告知 */ }
  }
  if (turningOn) {
    if (behaviorDb.getStatus().status !== "ok") return getStatus();
    if (!writer) {
      try { startRuntime(behaviorDb.getDb(), ctx); } catch { state = { status: "disabled", reason: "sessions_failed", detail: null }; }
      return getStatus();
    }
    if (!sessions) {
      stopRuntime();
      try { startRuntime(behaviorDb.getDb(), ctx); } catch { state = { status: "disabled", reason: "sessions_failed", detail: null }; }
      return getStatus();
    }
    state = { status: "ok", reason: null, detail: null };
    try { sessions.init(); } catch { state = { status: "disabled", reason: "sessions_failed", detail: null }; }
    return getStatus();
  }
  state = { status: "disabled", reason: "disabled_by_user", detail: null };
  return getStatus();
}

/** 清除全部行为数据：屏障 → 停运行期 → 关库删文件 → 新 dataEpoch/analysisFloorTs → 空库（保持停用）。 */
async function purgeAll() {
  if (!ctx) return { ok: false, code: "not_initialized" };
  const purgeTs = now();
  generation++;
  config = { ...config, enabled: false };
  try { flushSync(); } catch { /* 尽力冲刷 */ }
  if (writer) writer.setEnabled(false);
  stopRuntime();
  const file = behaviorDb.getFile() || path.join(ctx.dataDir, "behavior.db");
  try { behaviorDb.close(); } catch { /* 已关 */ }
  try {
    for (const suffix of ["", "-wal", "-shm"]) {
      try { fs.rmSync(file + suffix, { force: true }); } catch (e) { if (suffix === "") throw e; }
    }
    policy = { ...(policy || {}), dataEpoch: privacyMod.newEpoch(purgeTs), analysisFloorTs: purgeTs, purgeAt: purgeTs, firstEnabledAt: null };
    policyMod.writePolicy(ctx.dataDir, policy);
    behaviorDb.resetForTest();
    behaviorDb.configure({ dataDir: ctx.dataDir });
    const db = await behaviorDb.open();
    if (!db) throw new Error("空库重建失败");
    startRuntime(db, ctx); // config.enabled=false：只建 writer/stats，不建会话
    state = { status: "disabled", reason: "disabled_by_user", detail: null };
    return { ok: true, epoch: policy.dataEpoch, purgeTs };
  } catch (e) {
    state = { status: "disabled", reason: "purge_failed", detail: String((e && e.message) || e) };
    return { ok: false, code: "purge_failed", detail: String((e && e.message) || e) };
  }
}

function privacyApi() {
  const db = behaviorDb.getDb();
  if (!db || !ctx) return null;
  return privacyMod.createPrivacy({
    db, dataDir: ctx.dataDir, now,
    snapshot: (dest) => behaviorDb.snapshotTo(dest),
    schemaVersion: behaviorDb.BDI_SCHEMA_VERSION,
  });
}

function clearQueryText() {
  if (!privacyApi()) return { ok: false, code: "disabled" };
  try { flushSync(); } catch { /* 尽力冲刷 */ }
  const r = privacyApi().clearQueryText();
  setRecordQueryText(false);
  return { ok: true, ...r };
}

async function exportData(dest, options) {
  if (!privacyApi()) return { ok: false, code: "disabled" };
  try { flushSync(); } catch { /* 尽力冲刷 */ }
  const r = await privacyApi().exportTo(dest, options || {});
  return { ok: true, ...r };
}

function enforceRetention() {
  if (!privacyApi()) return { ok: false, code: "disabled" };
  const r = privacyApi().enforceRetention(config.retentionDays);
  return { ok: true, ...r };
}

function setRecordQueryText(next) {
  config = { ...config, recordQueryText: next === true };
  if (writer) writer.setRecordQueryText(config.recordQueryText);
  return config.recordQueryText;
}

/** 设置页写侧入口：app.behavior 三键归一后应用到运行时（开关变化走 setEnabled）。 */
function setBehaviorConfig(raw) {
  const n = policyMod.normalizeBehavior(raw);
  if (n.enabled !== config.enabled) setEnabled(n.enabled);
  config = { ...config, retentionDays: n.retentionDays, recordQueryText: n.recordQueryText };
  if (writer) writer.setRecordQueryText(n.recordQueryText);
  return getStatus();
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
  if (domainsFirstTimer) { clearTimeout(domainsFirstTimer); domainsFirstTimer = null; }
  if (domainsTimer) { clearInterval(domainsTimer); domainsTimer = null; }
  if (rollupFirstTimer) { clearTimeout(rollupFirstTimer); rollupFirstTimer = null; }
  if (rollupTimer) { clearInterval(rollupTimer); rollupTimer = null; }
  rollup = null;
  coverage = null;
  queryApi = null;
  if (ipcStats) {
    try { ipcStats.stop(); } catch { /* 关闭路径不得抛 */ }
    ipcStats = null;
  }
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
  acceptBatch,
  configPayload,
  publicStatus,
  getGeneration,
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
  getTapContext,
  getIpcStats: () => ipcStats,
  runQuery,
  refreshCoverage,
  purgeAll,
  clearQueryText,
  exportData,
  enforceRetention,
  setBehaviorConfig,
  resetForTest,
};
