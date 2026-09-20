"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// tests/m15r.activity.entry.ts
var m15r_activity_entry_exports = {};
__export(m15r_activity_entry_exports, {
  applyProgress: () => applyProgress,
  describeTask: () => describeTask,
  dismissAllFinished: () => dismissAllFinished,
  dismissTask: () => dismissTask,
  eventBus: () => eventBus,
  installActivityStore: () => installActivityStore,
  listTasks: () => listTasks,
  primaryTask: () => primaryTask,
  resetActivity: () => resetActivity
});
module.exports = __toCommonJS(m15r_activity_entry_exports);

// src/lib/eventbus.ts
var ALLOWED_EVENTS = [
  "stats/updated",
  "library/changed",
  "todo/changed",
  "pomodoro/tick",
  "pomodoro/phaseChange",
  "theme/changed",
  "settings/changed",
  "ai/stream",
  "workflow/changed",
  "cards/changed",
  "ai/batchDone",
  "leech/detected",
  "journal/changed",
  "insight/changed",
  "memory/changed",
  "mindmap/changed"
  // v48（M15 重做，D41/D42）：导图生成进度与完成广播
];
var map = /* @__PURE__ */ new Map();
var eventBus = {
  on(event, fn) {
    if (!ALLOWED_EVENTS.includes(event)) throw new Error(`unknown event: ${event}`);
    let set = map.get(event);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      map.set(event, set);
    }
    set.add(fn);
    return () => set.delete(fn);
  },
  emit(event, payload) {
    if (!ALLOWED_EVENTS.includes(event)) throw new Error(`unknown event: ${event}`);
    map.get(event)?.forEach((fn) => fn(payload));
  }
};

// src/lib/activity.ts
var TERMINAL = ["completed", "partial", "review_failed", "failed", "cancelled"];
var tasks = /* @__PURE__ */ new Map();
var listeners = /* @__PURE__ */ new Set();
function emitChange() {
  for (const l of listeners) {
    try {
      l();
    } catch {
    }
  }
}
function applyProgress(p) {
  const runId = String(p.runId || "");
  if (!runId) return null;
  const prev = tasks.get(runId);
  const rawStage = String(p.stage || (prev ? prev.phase : "running"));
  const stage = rawStage === "waiting_model" ? "running" : rawStage;
  const next = {
    runId,
    documentId: p.documentId ?? prev?.documentId ?? null,
    title: p.title ?? prev?.title ?? null,
    phase: stage,
    // waiting_model 带 label；running 不带 → 保留上一次的 label（「当前处理什么」不要闪断）
    label: String(p.label || prev?.label || "") || null,
    done: Number.isFinite(p.done) ? Number(p.done) : prev?.done ?? 0,
    total: Number.isFinite(p.total) ? Number(p.total) : prev?.total ?? 0,
    calls: Number.isFinite(p.calls) ? Number(p.calls) : prev?.calls ?? 0,
    budget: Number.isFinite(p.budget) ? Number(p.budget) : prev?.budget ?? 0,
    mapId: p.mapId ?? prev?.mapId ?? null,
    published: typeof p.published === "boolean" ? p.published : prev?.published ?? false,
    issues: Number.isFinite(p.issues) ? Number(p.issues) : prev?.issues ?? null,
    code: p.code ?? prev?.code ?? null,
    updatedAt: Date.now()
  };
  if (TERMINAL.includes(next.phase) && next.total > 0) next.done = next.total;
  tasks.set(runId, next);
  emitChange();
  return next;
}
function dismissTask(runId) {
  if (tasks.delete(runId)) emitChange();
}
function dismissAllFinished() {
  let changed = false;
  for (const [id, t] of tasks) {
    if (TERMINAL.includes(t.phase)) {
      tasks.delete(id);
      changed = true;
    }
  }
  if (changed) emitChange();
}
function listTasks() {
  return [...tasks.values()].sort((a, b) => a.updatedAt - b.updatedAt);
}
function primaryTask() {
  const all = listTasks();
  if (!all.length) return null;
  const active = all.filter((t) => !TERMINAL.includes(t.phase));
  const pool = active.length ? active : all;
  return pool[pool.length - 1];
}
function resetActivity() {
  tasks.clear();
  emitChange();
}
var installed = false;
function installActivityStore() {
  if (installed) return () => {
  };
  installed = true;
  const off = eventBus.on("mindmap/changed", (payload) => {
    applyProgress(payload || {});
  });
  return () => {
    installed = false;
    off();
  };
}
function describeTask(t) {
  if (!t) return null;
  const pct = t.total > 0 ? Math.max(0, Math.min(100, Math.round(t.done / t.total * 100))) : null;
  const callsLine = t.budget > 0 ? `${t.calls} / ${t.budget} \u6B21\u8C03\u7528` : t.calls > 0 ? `${t.calls} \u6B21\u8C03\u7528` : "";
  const title = t.title || "\u6750\u6599\u77E5\u8BC6\u5BFC\u56FE";
  switch (t.phase) {
    case "running":
      return {
        short: pct === null ? "\u5BFC\u56FE\u751F\u6210\u4E2D" : `\u5BFC\u56FE\u751F\u6210\u4E2D \xB7 ${pct}%`,
        heading: title,
        detail: [t.label ? `\u6B63\u5728\u5904\u7406\uFF1A${t.label}` : "\u6B63\u5728\u5206\u6790\u6750\u6599\u7ED3\u6784", pct === null ? "" : `${t.done} / ${t.total}`, callsLine].filter(Boolean).join(" \xB7 "),
        tone: "busy",
        percent: pct,
        canOpen: Boolean(t.mapId)
      };
    case "section_ready":
      return {
        short: t.published ? "\u5BFC\u56FE\u5DF2\u53EF\u7528 \xB7 \u53EF\u7EE7\u7EED\u6DF1\u5316" : "\u5DF2\u751F\u6210\u5019\u9009\u7248\u672C",
        heading: title,
        detail: t.published ? "\u9996\u5C42\u7ED3\u6784\u5DF2\u5C31\u7EEA\uFF0C\u53EF\u6253\u5F00\u67E5\u770B\uFF1B\u66F4\u6DF1\u7684\u5206\u652F\u6309\u9700\u7EE7\u7EED\u751F\u6210\u3002" : "\u65B0\u7248\u9996\u5C42\u5DF2\u751F\u6210\u5E76\u4FDD\u5B58\u4E3A\u5019\u9009\u7248\u672C\uFF08\u5DF2\u53D1\u5E03\u7684\u65E7\u7248\u672C\u4E0D\u53D7\u5F71\u54CD\uFF09\uFF1B\u6253\u5F00\u5373\u53EF\u67E5\u770B\u8FD9\u4E00\u7248\u3002",
        tone: t.published ? "done" : "partial",
        percent: 100,
        canOpen: true
      };
    case "completed":
      return { short: "\u5BFC\u56FE\u5DF2\u66F4\u65B0", heading: title, detail: callsLine ? `\u5171 ${callsLine}` : "", tone: "done", percent: 100, canOpen: true };
    case "partial":
      return {
        short: "\u5BFC\u56FE\u5DF2\u90E8\u5206\u66F4\u65B0",
        heading: title,
        detail: "\u90E8\u5206\u9636\u6BB5\u672A\u5B8C\u6210\uFF0C\u65E7\u7248\u672C\u4ECD\u7136\u53EF\u7528\u3002" + (callsLine ? ` \xB7 ${callsLine}` : ""),
        tone: "partial",
        percent: pct,
        canOpen: Boolean(t.mapId)
      };
    case "review_failed":
      return {
        short: "\u5BFC\u56FE\u5F85\u786E\u8BA4",
        heading: title,
        detail: `\u8BED\u4E49\u8BC4\u5BA1\u63D0\u51FA ${t.issues ?? 0} \u5904\u95EE\u9898\uFF0C\u5DF2\u751F\u6210\u7684\u7ED3\u6784\u5728\u786E\u8BA4\u4FEE\u590D\u524D\u4E0D\u53D1\u5E03\uFF1B\u65E7\u7248\u672C\u4ECD\u7136\u53EF\u7528\u3002`,
        tone: "warn",
        percent: null,
        canOpen: false
      };
    case "failed":
      return {
        short: "\u5BFC\u56FE\u751F\u6210\u5931\u8D25",
        heading: title,
        detail: `${t.code ? failureReason(t.code) : "\u751F\u6210\u4E2D\u65AD"}\uFF08\u65E7\u7248\u672C\u4ECD\u7136\u53EF\u7528\uFF09`,
        tone: "error",
        percent: null,
        canOpen: false
      };
    case "cancelled":
    default:
      return { short: "\u5DF2\u53D6\u6D88", heading: title, detail: "\u5DF2\u5B8C\u6210\u7684\u9636\u6BB5\u4FDD\u7559\u5728\u7F13\u5B58\uFF0C\u91CD\u65B0\u751F\u6210\u4F1A\u81EA\u52A8\u7EED\u8DD1\u3002", tone: "warn", percent: null, canOpen: false };
  }
}
function failureReason(code) {
  const map2 = {
    timeout: "\u8C03\u7528\u8D85\u65F6",
    network: "\u7F51\u7EDC\u4E2D\u65AD",
    rate_limit: "\u89E6\u53D1\u9650\u6D41",
    validation: "\u672C\u5730\u7ED3\u6784\u6821\u9A8C\u672A\u901A\u8FC7",
    prepare: "\u6750\u6599\u51C6\u5907\u5931\u8D25",
    json: "\u6A21\u578B\u8F93\u51FA\u65E0\u6CD5\u89E3\u6790",
    cancelled: "\u5DF2\u53D6\u6D88"
  };
  return map2[code] || "\u751F\u6210\u4E2D\u65AD";
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  applyProgress,
  describeTask,
  dismissAllFinished,
  dismissTask,
  eventBus,
  installActivityStore,
  listTasks,
  primaryTask,
  resetActivity
});
