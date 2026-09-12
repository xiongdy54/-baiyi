"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
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

// src/lib/eventbus.ts
var eventbus_exports = {};
__export(eventbus_exports, {
  ALLOWED_EVENTS: () => ALLOWED_EVENTS,
  eventBus: () => eventBus
});
var ALLOWED_EVENTS, map, eventBus;
var init_eventbus = __esm({
  "src/lib/eventbus.ts"() {
    "use strict";
    ALLOWED_EVENTS = [
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
      "leech/detected"
    ];
    map = /* @__PURE__ */ new Map();
    eventBus = {
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
  }
});

// src/lib/commands.ts
var commands_exports = {};
__export(commands_exports, {
  COMMANDS: () => COMMANDS,
  __testHooks: () => __testHooks,
  commandRegistry: () => commandRegistry,
  eventToCombo: () => eventToCombo,
  init: () => init,
  setActionSource: () => setActionSource
});
module.exports = __toCommonJS(commands_exports);

// src/lib/settings.ts
var memoryFallback = /* @__PURE__ */ new Map();
async function emitChanged(scope, key) {
  try {
    const { eventBus: eventBus2 } = await Promise.resolve().then(() => (init_eventbus(), eventbus_exports));
    eventBus2.emit("settings/changed", { scope, key });
  } catch {
  }
}
var settingsStore = {
  async get(scope, key, defaultValue) {
    try {
      if (!window.settingsAPI) {
        return memoryFallback.get(`${scope}.${key}`) ?? defaultValue;
      }
      const v = await window.settingsAPI.get(scope, key);
      return v ?? defaultValue;
    } catch {
      return defaultValue;
    }
  },
  async set(scope, key, value) {
    if (!window.settingsAPI) {
      memoryFallback.set(`${scope}.${key}`, value);
      void emitChanged(scope, key);
      return;
    }
    await window.settingsAPI.set(scope, key, value);
    void emitChanged(scope, key);
  }
};

// src/lib/commands.ts
var COMMANDS = [
  { id: "reader.makeCard", title: "\u5236\u5361", scene: "\u9605\u8BFB", defaultKey: "Ctrl+Z" },
  { id: "reader.aiCards", title: "AI \u5236\u5361", scene: "\u9605\u8BFB", defaultKey: "Ctrl+X" },
  { id: "reader.aiExplain", title: "AI \u89E3\u91CA", scene: "\u9605\u8BFB", defaultKey: "Ctrl+A" },
  { id: "reader.extract", title: "\u6458\u5F55", scene: "\u9605\u8BFB", defaultKey: "Ctrl+S" },
  { id: "review.showAnswer", title: "\u663E\u793A\u7B54\u6848", scene: "\u590D\u4E60", defaultKey: "Space" },
  { id: "review.again", title: "\u8BC4\u5206 Again", scene: "\u590D\u4E60", defaultKey: "1" },
  { id: "review.hard", title: "\u8BC4\u5206 Hard", scene: "\u590D\u4E60", defaultKey: "2" },
  { id: "review.good", title: "\u8BC4\u5206 Good", scene: "\u590D\u4E60", defaultKey: "3" },
  { id: "review.easy", title: "\u8BC4\u5206 Easy", scene: "\u590D\u4E60", defaultKey: "4" },
  // v22 增补（用户需求：误评无撤回）：一步撤销最近一次可撤销的评分
  { id: "review.undo", title: "\u64A4\u9500\u8BC4\u5206", scene: "\u590D\u4E60", defaultKey: "Z" },
  { id: "review.markSuspend", title: "\u6807\u8BB0\u5E76\u6682\u505C", scene: "\u590D\u4E60", defaultKey: "Q" },
  { id: "review.skip", title: "\u8DF3\u8FC7", scene: "\u590D\u4E60", defaultKey: "W" },
  { id: "review.delete", title: "\u5220\u9664", scene: "\u590D\u4E60", defaultKey: "D" }
];
var DEFS_BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));
var PURE_MODIFIER = /* @__PURE__ */ new Set([
  "Control",
  "Alt",
  "Shift",
  "Meta",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "Fn",
  "FnLock",
  "ContextMenu",
  "Process",
  "Unidentified",
  "Dead",
  "Compose",
  "OS",
  "Hyper",
  "Super",
  "Symbol",
  "SymbolLock"
]);
function eventToCombo(e) {
  let key = e.key || "";
  if (key === " ") key = "Space";
  if (PURE_MODIFIER.has(key)) return null;
  if (key.length === 1 && key.toLowerCase() !== key.toUpperCase()) key = key.toUpperCase();
  const mods = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Meta");
  mods.push(key);
  return mods.join("+");
}
var overrides = {};
var initPromise = null;
function init() {
  if (!initPromise) {
    initPromise = settingsStore.get("app", "keybindings", {}).then((v) => {
      overrides = v && typeof v === "object" ? { ...v } : {};
    }).catch(() => {
      overrides = {};
    });
  }
  return initPromise;
}
function getBinding(id) {
  const def = DEFS_BY_ID.get(id);
  if (!def) return "";
  const o = overrides[id];
  return typeof o === "string" && o ? o : def.defaultKey;
}
function getAllBindings() {
  const out = {};
  for (const def of COMMANDS) out[def.id] = getBinding(def.id);
  return out;
}
async function setOverride(id, combo) {
  if (!DEFS_BY_ID.has(id)) return;
  const next = { ...overrides };
  if (combo) next[id] = combo;
  else delete next[id];
  overrides = next;
  await settingsStore.set("app", "keybindings", next);
}
async function resetAll() {
  overrides = {};
  await settingsStore.set("app", "keybindings", {});
}
function conflictWith(combo, excludeId) {
  for (const def of COMMANDS) {
    if (def.id === excludeId) continue;
    if (getBinding(def.id) === combo) return def;
  }
  return null;
}
async function refreshOverrides(scope, key) {
  if (scope !== "app" || key !== "keybindings") return;
  overrides = await settingsStore.get("app", "keybindings", {}) ?? {};
}
var actionSources = /* @__PURE__ */ new Map();
function setActionSource(owner, source) {
  if (source) actionSources.set(owner, source);
  else actionSources.delete(owner);
}
var suppressions = /* @__PURE__ */ new Set();
function pushSuppress(reason) {
  suppressions.add(reason);
}
function popSuppress(reason) {
  suppressions.delete(reason);
}
function dispatchKey(e) {
  if (suppressions.size > 0) return false;
  if (e.repeat) return false;
  const combo = eventToCombo(e);
  if (!combo) return false;
  for (const def of COMMANDS) {
    if (getBinding(def.id) !== combo) continue;
    for (const source of actionSources.values()) {
      const actions = source();
      const action = actions ? actions[def.id] : void 0;
      if (!action) continue;
      if (action.when && !action.when()) continue;
      action.run();
      return true;
    }
  }
  return false;
}
var installed = false;
function install() {
  if (installed || typeof window === "undefined") return;
  window.addEventListener(
    "keydown",
    (e) => {
      if (dispatchKey(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );
  installed = true;
}
void Promise.resolve().then(async () => {
  const { eventBus: eventBus2 } = await Promise.resolve().then(() => (init_eventbus(), eventbus_exports));
  eventBus2.on("settings/changed", (p) => {
    const { scope, key } = p ?? {};
    if (scope && key) void refreshOverrides(scope, key);
  });
}).catch(() => {
});
var commandRegistry = {
  init,
  install,
  COMMANDS,
  getAllBindings,
  setOverride,
  resetAll,
  conflictWith,
  eventToCombo,
  setActionSource,
  pushSuppress,
  popSuppress
};
var __testHooks = { dispatchKey, getBinding };
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  COMMANDS,
  __testHooks,
  commandRegistry,
  eventToCombo,
  init,
  setActionSource
});
