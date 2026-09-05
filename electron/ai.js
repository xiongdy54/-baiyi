// AI 网关 — 主进程统一 LLM 通道（文档§3.11 AIGateway）
// Key 用 safeStorage 加密存储；流式输出经 WebContents 发送到渲染层
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { safeStorage } = require("electron");

const PRESETS = {
  goat: {
    id: "goat",
    name: "Command Code GOAT Plan",
    baseUrl: "https://api.commandcode.ai/provider/v1",
    model: "z-ai/glm-5.3-flash",
    keyUrl: "https://commandcode.ai/xiongdy54/settings/keys",
    hint: "OpenAI 兼容 · 默认 z-ai/glm-5.3-flash · 可拉取模型列表后自选"
  },
  zai: {
    id: "zai",
    name: "智谱官方 API（bigmodel.cn）",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4.7-flash",
    keyUrl: "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
    hint: "OpenAI 兼容 · 默认免费模型 glm-4.7-flash · 可拉取列表自选 glm-5.3 等"
  },
  custom: {
    id: "custom",
    name: "通用 API Key（OpenAI 兼容）",
    baseUrl: "",
    model: "",
    keyUrl: "",
    hint: "自填 Base URL / 模型 / Key"
  },
  local: {
    id: "local",
    name: "本地模型（Ollama / LM Studio）",
    baseUrl: "http://localhost:11434/v1",
    model: "qwen3:8b",
    keyUrl: "",
    hint: "零排队 · 零成本 · 8GB 显存推荐 qwen3:8b；LM Studio 端口 1234"
  }
};

const LEGACY_MODELS = new Set(["glm-5.3-flash", "glm-4.6"]);

function aiConfigPath() {
  return path.join(app.getPath("userData"), "ai-config.json");
}

function readConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(aiConfigPath(), "utf-8"));
    // v10.3 迁移：旧版全局 Key 归档到其所属预设，实现按服务商留存
    if (!cfg.keys || typeof cfg.keys !== "object") cfg.keys = {};
    if (cfg.apiKeyEnc && cfg.preset && cfg.keys[cfg.preset] === undefined) {
      cfg.keys[cfg.preset] = cfg.apiKeyEnc;
    }
    if (cfg.apiKeyPlain && cfg.preset && cfg.keys[cfg.preset] === undefined) {
      cfg.keys[cfg.preset] = "plain:" + cfg.apiKeyPlain;
    }
    return cfg;
  } catch {
    return { preset: "goat", baseUrl: PRESETS.goat.baseUrl, model: PRESETS.goat.model, apiKeyEnc: null, keys: {} };
  }
}

function writeConfig(cfg) {
  fs.writeFileSync(aiConfigPath(), JSON.stringify(cfg, null, 2), "utf-8");
}

function getAIConfig() {
  const cfg = readConfig();
  let apiKey = "";
  if (cfg.apiKeyEnc && safeStorage.isEncryptionAvailable()) {
    try {
      apiKey = safeStorage.decryptString(Buffer.from(cfg.apiKeyEnc, "base64"));
    } catch {
      apiKey = "";
    }
  }
  const preset = PRESETS[cfg.preset] || PRESETS.custom;
  return {
    preset: cfg.preset,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    apiKey,
    hasKey: Boolean(apiKey),
    keyUrl: preset.keyUrl || "",
    hint: preset.hint || "",
    presetName: preset.name
  };
}

function setAIConfig(partial) {
  const cfg = readConfig();
  if (!cfg.keys || typeof cfg.keys !== "object") cfg.keys = {};
  if (typeof partial.preset === "string" && PRESETS[partial.preset] && partial.preset !== cfg.preset) {
    // 切换预设 = 切换服务商：端点与模型重置为新预设默认值（v10.1）
    // Key 按服务商独立保存（v10.3），切换后自动带上该服务自己的 Key
    cfg.preset = partial.preset;
    cfg.baseUrl = PRESETS[partial.preset].baseUrl;
    cfg.model = PRESETS[partial.preset].model;
    cfg.baseUrlTouched = false;
    cfg.modelTouched = false;
    // 只恢复该服务自己存过的 Key；从没配过则置空（绝不串用别家的 Key）
    const presetKey = cfg.keys[partial.preset];
    if (presetKey !== undefined && presetKey !== null) {
      cfg.apiKeyEnc = presetKey.startsWith("plain:") ? null : presetKey;
      if (presetKey.startsWith("plain:")) cfg.apiKeyPlain = presetKey.slice(6);
    } else {
      cfg.apiKeyEnc = null;
      cfg.apiKeyPlain = null;
    }
  }
  if (typeof partial.baseUrl === "string") {
    cfg.baseUrl = partial.baseUrl;
    cfg.baseUrlTouched = true;
  }
  if (typeof partial.model === "string") {
    cfg.model = partial.model;
    cfg.modelTouched = true;
  }
  if (partial.apiKey !== undefined) {
    if (!partial.apiKey) {
      cfg.apiKeyEnc = null;
      if (cfg.preset) delete cfg.keys[cfg.preset];
    } else if (safeStorage.isEncryptionAvailable()) {
      cfg.apiKeyEnc = safeStorage.encryptString(partial.apiKey).toString("base64");
      // 按服务商留存一份，切换回来时自动恢复
      if (cfg.preset) cfg.keys[cfg.preset] = cfg.apiKeyEnc;
    } else {
      // 系统加密不可用时退回明文（本地单用户环境），并标记
      cfg.apiKeyPlain = partial.apiKey;
      cfg.apiKeyEnc = null;
      if (cfg.preset) cfg.keys[cfg.preset] = "plain:" + partial.apiKey;
    }
  }
  writeConfig(cfg);
  const { apiKey, ...safe } = getAIConfig();
  return safe;
}

function chatStream({ messages, temperature }, send) {
  const cfg = getAIConfig();
  // 本地模型服务无需 Key
  const needKey = cfg.preset !== "local";
  if (needKey && !cfg.apiKey) {
    const err = new Error("尚未配置 AI API Key。请打开 设置 → AI 服务，选择服务并粘贴 API Key。");
    err.code = "AI_NO_KEY";
    throw err;
  }
  const url = new URL(cfg.baseUrl.replace(/\/$/, "") + "/chat/completions");
  const isHttps = url.protocol === "https:";
  const body = JSON.stringify({
    model: cfg.model,
    messages,
    temperature: typeof temperature === "number" ? temperature : 0.7,
    stream: true
  });
  const headers = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  headers["Content-Length"] = Buffer.byteLength(body);
  return new Promise((resolve, reject) => {
    const req = (isHttps ? https : http).request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: "POST",
        headers
      },
      (res) => {
        if (res.statusCode !== 200) {
          let errText = "";
          res.on("data", (c) => (errText += c));
          res.on("end", () => reject(new Error(`AI 服务错误 ${res.statusCode}: ${errText.slice(0, 300)}`)));
          return;
        }
        let buf = "";
        // 思考模型（GLM 等）先输出 reasoning_content 再输出正文；thinking 计数节流转发（v10.4）
        let thinkAcc = 0;
        let lastThinkSent = 0;
        res.on("data", (chunk) => {
          buf += chunk.toString("utf-8");
          let idx;
          while ((idx = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") {
              send({ done: true });
              resolve();
              return;
            }
            try {
              const json = JSON.parse(data);
              const d = json.choices?.[0]?.delta || {};
              if (d.content) send({ delta: d.content });
              const think = d.reasoning_content ?? d.reasoning;
              if (typeof think === "string" && think) {
                thinkAcc += think.length;
                const now = Date.now();
                if (now - lastThinkSent > 400) {
                  send({ thinking: thinkAcc });
                  lastThinkSent = now;
                }
              }
            } catch {
              /* 忽略不完整行 */
            }
          }
        });
        res.on("end", () => {
          send({ done: true });
          resolve();
        });
        res.on("error", reject);
      }
    );
    req.on("error", (err) => {
      if (err.code === "ECONNREFUSED") {
        if (cfg.preset === "local") {
          reject(
            new Error(
              "无法连接本地模型服务（localhost 被拒绝）。请确认：① 已安装并启动 Ollama（或 LM Studio 已加载模型并开启本地服务）；② 端口正确（Ollama 11434 / LM Studio 1234）"
            )
          );
          return;
        }
        reject(new Error(`无法连接 AI 服务（${url.host} 连接被拒绝）`));
        return;
      }
      reject(err);
    });
    req.write(body);
    req.end();
  });
}

function requestJSON(url, headers) {
  const u = new URL(url);
  const isHttps = u.protocol === "https:";
  return new Promise((resolve, reject) => {
    const req = (isHttps ? https : http).request(
      {
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        method: "GET",
        headers
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(body) });
          } catch {
            resolve({ status: res.statusCode, json: null });
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function listModels() {
  const cfg = getAIConfig();
  const needKey = cfg.preset !== "local";
  if (needKey && !cfg.apiKey) {
    const err = new Error("尚未配置 AI API Key。请先粘贴并保存 Key。");
    err.code = "AI_NO_KEY";
    throw err;
  }
  const url = cfg.baseUrl.replace(/\/$/, "") + "/models";
  const headers = {};
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const { status, json } = await requestJSON(url, headers);
  if (status !== 200 || !json) {
    if (cfg.preset === "local") {
      throw new Error("无法连接本地模型服务。请确认 Ollama / LM Studio 已启动。");
    }
    throw new Error(`拉取模型列表失败（HTTP ${status}）`);
  }
  // OpenAI 格式 { data: [{id}] }；兼容 { models: [{name/id}] }
  const raw = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : [];
  const ids = raw
    .map((m) => (typeof m === "string" ? m : m.id || m.name || m.model))
    .filter(Boolean);
  return ids.sort((a, b) => a.localeCompare(b));
}

async function testConnection() {
  const cfg = getAIConfig();
  const needKey = cfg.preset !== "local";
  if (needKey && !cfg.apiKey) return { ok: false, message: "尚未配置 API Key，请先在下方输入并点击保存" };
  let acc = "";
  await chatStream(
    { messages: [{ role: "user", content: "回复两个字：正常" }], temperature: 0.1 },
    (m) => {
      if (m.delta) acc += m.delta;
    }
  );
  return { ok: acc.length > 0, message: acc.trim().slice(0, 50) || "无响应" };
}

module.exports = { getAIConfig, setAIConfig, chatStream, testConnection, listModels, PRESETS };
