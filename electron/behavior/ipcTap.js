// BDI（D248 / T4）：ipcMain.handle/on 包装——保留原 this/参数/返回值/异常，tap 在 setImmediate 执行。
// 唯一实现依据：docs/design/BEHAVIOR-DATA-INFRA-D248-v3.md §7.1。
// 纪律：只包装 taps.js 登记过的通道；未登记原样透传；排除 behavior:*；不查库、不解析大 JSON、不 await。
"use strict";
const taps = require("./taps");
const { learningDayStartMs } = require("../fsrsTime");

const TAP_SEQ = { value: 0 };
function monoNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

function dayString(ms, cutoffHour) {
  const d = new Date(learningDayStartMs(ms, cutoffHour));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildEvent(spec, args, result, t0Wall, t0Mono, t1Wall, t1Mono, env) {
  const cutoff = env.cutoffHour();
  const base = {
    type: spec.type,
    src: "main",
    session_id: env.sessionId() || null,
    ts: t1Wall,
    recv_ts: t1Wall,
    day: dayString(t1Wall, cutoff),
    tz_offset: -new Date(t1Wall).getTimezoneOffset(),
    cutoff_hour: cutoff,
    actor: "unknown",
  };
  let partial = {};
  try {
    partial = spec.project ? spec.project(args, result) : {};
  } catch {
    partial = {};
  }
  const ev = { ...base, ...partial };
  if (spec.tapTimes) {
    ev.dur_ms = Math.max(0, Math.round(t1Mono - t0Mono));
    ev.props = { ...(ev.props || {}), tapStartTs: t0Mono, tapEndTs: t1Mono, tapSeq: ++TAP_SEQ.value };
  }
  return ev;
}

/**
 * 安装。opts:
 *   env: { sessionId(), now(), cutoffHour(), recordQueryText(), stats, markUndoDirty?() }
 *   缺省取 behavior/index 的 getTapContext()。
 * 返回 { uninstall }，便于测试还原。
 */
function install(ipcMain, emit, opts) {
  if (!ipcMain || ipcMain.__bdiTapInstalled) return ipcMain && ipcMain.__bdiTapInstalled;
  const env = (opts && opts.env) || require("./index").getTapContext();
  const now = () => (typeof env.now === "function" ? env.now() : Date.now());
  // 测试可注入映射表 / 包装集合；生产用 taps.js 的静态登记。
  const table = (opts && opts.taps) || taps.TAPS;
  const channelSet = (opts && opts.channels) || null;
  const wrapAllowed = (channel) =>
    typeof channel === "string" && !channel.startsWith("behavior:") &&
    (channelSet ? channelSet.has(channel) : taps.shouldWrap(channel));

  const originalHandle = ipcMain.handle.bind(ipcMain);
  const originalOn = ipcMain.on.bind(ipcMain);
  const originalRemoveListener = ipcMain.removeListener.bind(ipcMain);
  const originalOff = typeof ipcMain.off === "function" ? ipcMain.off.bind(ipcMain) : originalRemoveListener;
  const originalRemoveAll = ipcMain.removeAllListeners.bind(ipcMain);
  const listeners = new Map(); // channel → Map(wrapped → original)

  function record(channel, ms, isErr) {
    const stats = env.stats; // 动态取：install 发生在 behavior.init 之前
    try { if (stats) stats.record(channel, ms, isErr); } catch { /* 诊断失败不影响业务 */ }
  }

  function scheduleEmit(ev) {
    if (!ev) return;
    if (ev.text != null && !(typeof env.recordQueryText === "function" && env.recordQueryText())) ev.text = null;
    setImmediate(() => {
      try {
        if (!ev.session_id && typeof env.sessionId === "function") ev.session_id = env.sessionId();
        if (!ev.session_id) return; // 会话未就绪：index.emit 会在 starting 期缓冲；这里已过 setImmediate，直接丢弃
        emit(ev);
      } catch { /* tap 自身抛错绝不影响业务 */ }
    });
  }

  function wrapHandle(channel, handler) {
    const spec = table[channel];
    return function wrappedHandle(...args) {
      const rest = args.slice(1); // args[0] = IpcMainInvokeEvent
      const t0Wall = now();
      const t0Mono = monoNow();
      let result;
      try {
        result = handler.apply(this, args);
      } catch (e) {
        record(channel, monoNow() - t0Mono, true);
        throw e;
      }
      const finish = (value, isErr) => {
        const t1Wall = now();
        const t1Mono = monoNow();
        record(channel, t1Mono - t0Mono, isErr);
        if (!isErr && spec && (!spec.ok || spec.ok(value))) {
          try { scheduleEmit(buildEvent(spec, rest, value, t0Wall, t0Mono, t1Wall, t1Mono, env)); } catch { /* tap 投影失败不影响业务 */ }
          if (channel === "cards:undoReview" && typeof env.markUndoDirty === "function") {
            try { env.markUndoDirty(); } catch { /* 派生标记失败不影响业务 */ }
          }
        }
      };
      if (result && typeof result.then === "function") {
        result.then((v) => finish(v, false), () => finish(null, true));
      } else {
        finish(result, false);
      }
      return result;
    };
  }

  function wrapOn(channel, listener) {
    const spec = table[channel];
    return function wrappedListener(...args) {
      const rest = args.slice(1); // args[0] = IpcMainEvent
      const t0Wall = now();
      const t0Mono = monoNow();
      let result;
      try {
        result = listener.apply(this, args);
      } catch (e) {
        record(channel, monoNow() - t0Mono, true);
        throw e;
      }
      const t1Wall = now();
      const t1Mono = monoNow();
      record(channel, t1Mono - t0Mono, false);
      if (spec && (!spec.ok || spec.ok(result))) {
        try { scheduleEmit(buildEvent(spec, rest, result, t0Wall, t0Mono, t1Wall, t1Mono, env)); } catch { /* tap 投影失败不影响业务 */ }
      }
      return result;
    };
  }

  ipcMain.handle = (channel, handler) => {
    if (!wrapAllowed(channel)) return originalHandle(channel, handler);
    return originalHandle(channel, wrapHandle(channel, handler));
  };

  ipcMain.on = (channel, listener) => {
    if (!wrapAllowed(channel)) return originalOn(channel, listener);
    const wrapped = wrapOn(channel, listener);
    let m = listeners.get(channel);
    if (!m) { m = new Map(); listeners.set(channel, m); }
    m.set(listener, wrapped);
    return originalOn(channel, wrapped);
  };

  const unwrap = (channel, fn) => {
    const m = listeners.get(channel);
    return (m && m.get(fn)) || fn; // m: 原监听器 → 包装函数
  };

  ipcMain.removeListener = (channel, listener) => originalRemoveListener(channel, unwrap(channel, listener));
  ipcMain.off = (channel, listener) => originalOff(channel, unwrap(channel, listener));
  ipcMain.removeAllListeners = (channel) => {
    if (channel !== undefined) listeners.delete(channel);
    else listeners.clear();
    return originalRemoveAll(channel);
  };

  const handle = {
    uninstall() {
      ipcMain.handle = originalHandle;
      ipcMain.on = originalOn;
      ipcMain.removeListener = originalRemoveListener;
      ipcMain.off = originalOff;
      ipcMain.removeAllListeners = originalRemoveAll;
      listeners.clear();
      delete ipcMain.__bdiTapInstalled;
    },
  };
  ipcMain.__bdiTapInstalled = handle;
  return handle;
}

module.exports = { install, dayString, TAP_SEQ };
