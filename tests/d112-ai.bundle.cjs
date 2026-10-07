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

// src/lib/ai.ts
var ai_exports = {};
__export(ai_exports, {
  aiConfigUsable: () => aiConfigUsable,
  aiGateway: () => aiGateway
});
module.exports = __toCommonJS(ai_exports);
function aiConfigUsable(cfg) {
  return Boolean(cfg && (cfg.hasKey || cfg.preset === "local"));
}
var aiGateway = {
  async getConfig() {
    if (!window.aiAPI) return null;
    return window.aiAPI.getConfig();
  },
  async setConfig(partial) {
    await window.aiAPI?.setConfig(partial);
  },
  async test() {
    if (!window.aiAPI) return { ok: false, message: "API \u4E0D\u53EF\u7528" };
    return window.aiAPI.test();
  },
  async listModels() {
    if (!window.aiAPI) return [];
    return window.aiAPI.listModels();
  },
  async detectLocal() {
    if (!window.aiAPI?.detectLocal) return null;
    return window.aiAPI.detectLocal();
  },
  async websearch(query) {
    if (!window.aiAPI) return [];
    return window.aiAPI.websearch(query);
  },
  // 流式对话：onDelta 累积增量；onThinking 上报思考模型（reasoning_content）的已思考字数；resolve 返回全文
  chat(messages, onDelta, temperature, onThinking) {
    return new Promise((resolve, reject) => {
      if (!window.aiAPI) {
        reject(new Error("AI API \u4E0D\u53EF\u7528"));
        return;
      }
      const requestId = Math.random().toString(36).slice(2);
      let acc = "";
      let finished = false;
      const off = window.aiAPI.onStream((rid, msg) => {
        if (rid !== requestId) return;
        if (msg.error) {
          if (!finished) {
            finished = true;
            off();
            reject(new Error(msg.error));
          }
          return;
        }
        if (msg.thinking !== void 0) {
          onThinking?.(msg.thinking);
        }
        if (msg.delta) {
          acc += msg.delta;
          onDelta?.(acc, msg.delta);
        }
        if (msg.done && !finished) {
          finished = true;
          off();
          resolve(acc);
        }
      });
      window.aiAPI.chat(requestId, messages, temperature);
    });
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  aiConfigUsable,
  aiGateway
});
