// BDI（D248 / T3）：应用会话——启动修复、app_sessions 落库、窗口焦点累计、电源事件、30s last_seen。
// 唯一实现依据：docs/design/BEHAVIOR-DATA-INFRA-D248-v3.md §7.5（+ §5.2 app_sessions）。
// 纪律：本文件不 require("electron")；窗口 / powerMonitor / app 由宿主注入。会话修复只关闭到已持久化心跳，
// 不延伸至下一次启动（§7.3）。
"use strict";
const { uuid7 } = require("./uuid7");
const registry = require("./registry");
const { learningDayStartMs } = require("../fsrsTime");

const TOUCH_MS = 30 * 1000;
const WINDOW_DEBOUNCE_MS = 1000;
const WINDOW_NAMES = ["main", "lens", "workbench", "capture"];

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * createSessions(opts)：
 *   db（behavior.db 连接）/ emit(事件) / flush()（电流冲刷）/ now() / appVersion / os / locale /
 *   dataEpoch / deviceId / app（Electron app，可空）/ windows()（→ BrowserWindow[]）/ identifyWindow(win)
 */
function createSessions(opts) {
  const db = opts.db;
  const emit = typeof opts.emit === "function" ? opts.emit : () => ({ ok: false, code: "disabled" });
  const flush = typeof opts.flush === "function" ? opts.flush : () => 0;
  const now = typeof opts.now === "function" ? opts.now : Date.now;
  const appVersion = String(opts.appVersion || "0.0.0").slice(0, 32);
  const osName = String(opts.os || process.platform).slice(0, 32);
  const locale = opts.locale ? String(opts.locale).slice(0, 32) : null;
  const dataEpoch = String(opts.dataEpoch || "unknown");
  const deviceId = opts.deviceId ? String(opts.deviceId).slice(0, 64) : null;

  let sessionId = null;
  let startedAt = null;
  let foregroundMs = 0;
  let active = false;
  let touchTimer = null;
  const lastState = new Map(); // window → { state, ts }
  const focusStart = new Map(); // window → ts
  const attached = new Map(); // win.id → { win, name, handlers }

  const insertSession = db.prepare(`INSERT INTO app_sessions
    (id, data_epoch, device_id, started_at, ended_at, end_reason, clean_exit, last_seen_ts, app_version,
     catalog_version, os, locale, foreground_ms, active_ms, event_count)
    VALUES (?,?,?,?,NULL,NULL,0,?,?,?,?,?,0,0,0)`);
  const updateTouch = db.prepare("UPDATE app_sessions SET last_seen_ts = ?, foreground_ms = ? WHERE id = ?");
  const updateEnd = db.prepare(`UPDATE app_sessions SET ended_at = ?, end_reason = ?, clean_exit = ?,
    last_seen_ts = ?, foreground_ms = ?, active_ms = ?, event_count = ? WHERE id = ?`);
  const lastOpenSession = db.prepare("SELECT * FROM app_sessions WHERE ended_at IS NULL ORDER BY started_at DESC, id DESC LIMIT 1");

  function windowName(win) {
    let name = "main";
    try {
      name = typeof opts.identifyWindow === "function" ? opts.identifyWindow(win) : "main";
    } catch {
      name = "main";
    }
    return WINDOW_NAMES.includes(name) ? name : "main";
  }

  /** 启动修复：未结束会话按最后已持久化证据收尾；遗留 open span 置 recovered。 */
  function recoverPrevious() {
    const prev = lastOpenSession.get();
    if (!prev) return null;
    const lastEvent = db.prepare("SELECT MAX(ts) AS ts FROM events WHERE session_id = ?").get(prev.id)?.ts ?? null;
    const lastSpan = db.prepare("SELECT MAX(end_ts) AS ts FROM attn_spans WHERE session_id = ?").get(prev.id)?.ts ?? null;
    const endedAt = Math.max(
      Number(prev.started_at) || 0,
      Number(prev.last_seen_ts) || 0,
      Number(lastEvent) || 0,
      Number(lastSpan) || 0
    );
    const closeSpans = db.prepare("UPDATE attn_spans SET closed = 1, end_reason = 'recovered' WHERE session_id = ? AND closed = 0");
    db.transaction(() => {
      closeSpans.run(prev.id);
      updateEnd.run(endedAt, "crash_recovered", 0, Math.max(endedAt, Number(prev.last_seen_ts) || 0), Number(prev.foreground_ms) || 0, Number(prev.active_ms) || 0, Number(prev.event_count) || 0, prev.id);
    })();
    return { id: prev.id, endedAt, endReason: "crash_recovered" };
  }

  function attachWindow(win) {
    if (!win || !win.id || attached.has(win.id)) return;
    const name = windowName(win);
    const handlers = {};
    const bind = (event, state) => {
      handlers[event] = () => noteWindowState(name, state);
      try { win.on(event, handlers[event]); } catch { /* 窗口已销毁 */ }
    };
    bind("focus", "focus");
    bind("blur", "blur");
    bind("minimize", "minimize");
    bind("restore", "restore");
    bind("show", "show");
    bind("hide", "hide");
    handlers.closed = () => {
      const rec = attached.get(win.id);
      if (rec) {
        for (const [ev, fn] of Object.entries(rec.handlers)) {
          if (ev === "closed") continue;
          try { rec.win.removeListener(ev, fn); } catch { /* 已销毁 */ }
        }
        attached.delete(win.id);
      }
    };
    try { win.on("closed", handlers.closed); } catch { /* 窗口已销毁 */ }
    attached.set(win.id, { win, name, handlers });
  }

  function attachAllWindows() {
    let list = [];
    try {
      list = typeof opts.windows === "function" ? opts.windows() : [];
    } catch {
      list = [];
    }
    for (const w of list || []) attachWindow(w);
  }

  function noteWindowState(name, state) {
    if (!active) return null;
    if (!WINDOW_NAMES.includes(name)) name = "main";
    const t = now();
    const last = lastState.get(name);
    if (last && last.state === state && t - last.ts < WINDOW_DEBOUNCE_MS) return null;
    const prevTs = last ? last.ts : null;
    const durMs = last ? Math.max(0, t - last.ts) : null;
    if (state === "focus") {
      if (!focusStart.has(name)) focusStart.set(name, t);
    } else if (state === "blur" || state === "minimize" || state === "hide" || state === "tray") {
      const from = focusStart.get(name);
      if (from != null) {
        foregroundMs += Math.max(0, t - from);
        focusStart.delete(name);
      }
    }
    lastState.set(name, { state, ts: t });
    return emit({
      type: "app.window_state",
      src: "host",
      session_id: sessionId,
      ts: t,
      recv_ts: t,
      day: dayOf(t, cutoffHour()),
      tz_offset: -new Date(t).getTimezoneOffset(),
      cutoff_hour: cutoffHour(),
      props: { window: name, state, prevTs, durMs },
      actor: "background",
    });
  }

  function notePower(state) {
    if (!active) return null;
    const t = now();
    try { flush(); } catch { /* 挂起前冲刷失败不阻塞电源事件 */ }
    if (state === "suspend" || state === "lock") {
      for (const [name, from] of focusStart) {
        foregroundMs += Math.max(0, t - from);
        focusStart.delete(name);
      }
    }
    return emit({
      type: "app.power",
      src: "host",
      session_id: sessionId,
      ts: t,
      recv_ts: t,
      day: dayOf(t, cutoffHour()),
      tz_offset: -new Date(t).getTimezoneOffset(),
      cutoff_hour: cutoffHour(),
      props: { state },
      actor: "background",
    });
  }

  /** 学习日标签：复用 electron/fsrsTime.js 的学习日（DST 安全），口径与主库统计一致。 */
  function dayOf(t, cutoff) {
    const start = learningDayStartMs(t, cutoff);
    const d = new Date(start);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${da}`;
  }
  function cutoffHour() {
    try {
      const s = typeof opts.settings === "function" ? opts.settings() : null;
      const h = Number(s?.app?.dayCutoffHour);
      return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 4;
    } catch {
      return 4;
    }
  }

  function touch() {
    if (!active || !sessionId) return;
    updateTouch.run(now(), foregroundMs, sessionId);
  }

  function launchKind() {
    return "cold";
  }

  /** 建立新会话并 emit app.started（版本变化时补 app.updated）。返回 session id。 */
  function init() {
    if (active) return sessionId;
    const recovered = recoverPrevious();
    const t = now();
    sessionId = uuid7(t);
    startedAt = t;
    foregroundMs = 0;
    lastState.clear();
    focusStart.clear();
    insertSession.run(sessionId, dataEpoch, deviceId, t, t, appVersion, registry.CATALOG_VERSION, osName, locale);
    active = true;
    const prevVersion = readMeta("last_app_version");
    setMeta("last_session_id", sessionId);
    setMeta("last_app_version", appVersion);
    setMeta("catalog_version", String(registry.CATALOG_VERSION));
    emit({
      type: "app.started",
      src: "host",
      session_id: sessionId,
      ts: t,
      recv_ts: t,
      day: dayOf(t, cutoffHour()),
      tz_offset: -new Date(t).getTimezoneOffset(),
      cutoff_hour: cutoffHour(),
      props: { launchKind: launchKind(), appVersion },
      actor: "background",
    });
    if (prevVersion && prevVersion !== appVersion) {
      emit({
        type: "app.updated",
        src: "host",
        session_id: sessionId,
        ts: t,
        recv_ts: t,
        day: dayOf(t, cutoffHour()),
        tz_offset: -new Date(t).getTimezoneOffset(),
        cutoff_hour: cutoffHour(),
        props: { fromVersion: prevVersion.slice(0, 32), toVersion: appVersion },
        actor: "background",
      });
    }
    attachAllWindows();
    if (touchTimer) clearInterval(touchTimer);
    touchTimer = setInterval(touch, TOUCH_MS);
    if (touchTimer.unref) touchTimer.unref();
    return sessionId;
  }

  function readMeta(key) {
    try {
      const row = db.prepare("SELECT value FROM bdi_meta WHERE key = ?").get(key);
      return row ? String(row.value) : null;
    } catch {
      return null;
    }
  }
  function setMeta(key, value) {
    try {
      db.prepare("INSERT INTO bdi_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
    } catch { /* 诊断元数据写失败不阻断会话 */ }
  }

  /** 结束会话：回填 active_ms / event_count / foreground_ms；正常退出 clean_exit=1。幂等。 */
  function end(reason) {
    if (!active || !sessionId) return null;
    const id = sessionId;
    const t = now();
    for (const [name, from] of focusStart) {
      foregroundMs += Math.max(0, t - from);
      focusStart.delete(name);
    }
    const activeMs = Number(db.prepare("SELECT COALESCE(SUM(active_ms), 0) AS s FROM attn_spans WHERE session_id = ?").get(id)?.s || 0);
    const eventCount = Number(db.prepare("SELECT COUNT(*) AS n FROM events WHERE session_id = ?").get(id)?.n || 0);
    const clean = reason === "quit" ? 1 : 0;
    updateEnd.run(t, String(reason || "quit"), clean, t, foregroundMs, activeMs, eventCount, id);
    if (touchTimer) { clearInterval(touchTimer); touchTimer = null; }
    active = false;
    const result = { id, endedAt: t, reason, cleanExit: clean, activeMs, eventCount, foregroundMs };
    sessionId = null;
    startedAt = null;
    return result;
  }

  function detachAll() {
    for (const [, rec] of attached) {
      for (const [ev, fn] of Object.entries(rec.handlers)) {
        if (ev === "closed") continue;
        try { rec.win.removeListener(ev, fn); } catch { /* 已销毁 */ }
      }
    }
    attached.clear();
  }

  function status() {
    return { active, sessionId, startedAt, foregroundMs };
  }

  return {
    init,
    end,
    touch,
    noteWindowState,
    notePower,
    attachWindow,
    attachAllWindows,
    detachAll,
    status,
    getSessionId: () => sessionId,
  };
}

module.exports = { createSessions, TOUCH_MS, WINDOW_DEBOUNCE_MS, WINDOW_NAMES };
