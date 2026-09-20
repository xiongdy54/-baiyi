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

// reasoning_effort 仅 GLM-5.2+ 支持（GLM-5.3 系仅接受 max/high/low，其余值报错；
// 非 GLM 模型不认识该参数，发送会 400）——按模型名判断是否随请求发送（v10.5）
function supportsReasoningEffort(model) {
  const m = String(model || "").toLowerCase();
  return /(^|\/)z-ai\/glm-5\.[2-9]/.test(m) || /(^|\/)glm-5\.[2-9]/.test(m) || /(^|\/)zai-org\/glm-5\.[2-9]/.test(m);
}

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
    presetName: preset.name,
    reasoningEffort: cfg.reasoningEffort || "low"
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
  if (typeof partial.reasoningEffort === "string") {
    // 只接受 GLM-5.3 系合法值；非法值一律回落 low
    cfg.reasoningEffort = ["max", "high", "low"].includes(partial.reasoningEffort) ? partial.reasoningEffort : "low";
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

// v48 批2（M15 §4.19-8）：机读错误码——超时/限流/网络/HTTP/无 Key/取消，多级管线重试与失败状态机需要；
// 中文 message 不变（渲染层展示不受影响），仅附 .code。
// v48.11（§3.7）：附 status / retryAfterMs（供 429 退避优先遵循 Retry-After）。
function classifyHttpError(status, errText, headers) {
  const err = new Error(`AI 服务错误 ${status}: ${String(errText || "").slice(0, 300)}`);
  err.code = status === 429 ? "rate_limit" : "http";
  err.status = status;
  err.retriable = status === 429 || status === 408 || (status >= 500 && status <= 599);
  err.retryAfterMs = parseRetryAfter(headers);
  return err;
}

/** Retry-After（秒数或 HTTP 日期）→ 毫秒；缺省 null */
function parseRetryAfter(headers) {
  try {
    const h = headers && (headers["retry-after"] || headers["Retry-After"]);
    if (!h) return null;
    const sec = Number(h);
    if (Number.isFinite(sec) && sec >= 0) return Math.min(120000, Math.round(sec * 1000));
    const when = Date.parse(h);
    if (Number.isFinite(when)) return Math.max(0, Math.min(120000, when - Date.now()));
  } catch {
    /* 解析失败按无 Retry-After 处理 */
  }
  return null;
}

/** abort 归因：优先还原 abortSignal.reason 携带的机读 code（看门狗=timeout vs 用户取消=cancelled） */
function abortErrorOf(abortSignal) {
  const reason = abortSignal && abortSignal.reason;
  if (reason && typeof reason === "object" && reason.code) return reason;
  const err = new Error("已取消");
  err.code = "cancelled";
  return err;
}

/** 退避时长：Retry-After 优先；否则指数退避 + 抖动（§3.6） */
function backoffDelayMs(err, attempt) {
  if (err && Number.isFinite(err.retryAfterMs) && err.retryAfterMs >= 0) return err.retryAfterMs;
  const base = Math.min(20000, 800 * Math.pow(2, Math.max(0, attempt - 1)));
  return base + Math.floor(Math.random() * 300);
}

function chatStream({ messages, temperature, abortSignal, retry }, send) {
  const maxAttempts = Math.max(1, Math.min(5, Number(retry && retry.maxAttempts) || 1));
  const onRetry = retry && typeof retry.onRetry === "function" ? retry.onRetry : null;
  let attempt = 1;
  const run = () =>
    chatStreamOnce({ messages, temperature, abortSignal }, send).catch(async (err) => {
      const code = err && err.code;
      const retriable = (err && err.retriable) || code === "rate_limit" || code === "network" || code === "http";
      // 关键纪律（§3.7）：流已开始（服务端可能已生成并计费）→ 不重试，如实记为 unknown_outcome
      if (!retriable || err.streamStarted || attempt >= maxAttempts || (abortSignal && abortSignal.aborted)) throw err;
      const delay = backoffDelayMs(err, attempt);
      attempt += 1;
      if (onRetry) {
        try {
          onRetry({ attempt: attempt - 1, nextAttempt: attempt, delayMs: delay, code });
        } catch {
          /* 回调失败不影响重试 */
        }
      }
      await new Promise((r) => setTimeout(r, delay));
      return run();
    });
  return run();
}

function chatStreamOnce({ messages, temperature, abortSignal }, send) {
  // v48.12 P0：TTFT / 首字节打点（只测量，不改变任何调用行为）
  const startedAt = Date.now();
  let firstByteMs = null;
  let ttftMs = null;
  const cfg = getAIConfig();
  // 本地模型服务无需 Key
  const needKey = cfg.preset !== "local";
  if (needKey && !cfg.apiKey) {
    const err = new Error("尚未配置 AI API Key。请打开 设置 → AI 服务，选择服务并粘贴 API Key。");
    err.code = "AI_NO_KEY";
    throw err;
  }
  if (abortSignal && abortSignal.aborted) {
    return Promise.reject(abortErrorOf(abortSignal));
  }
  const url = new URL(cfg.baseUrl.replace(/\/$/, "") + "/chat/completions");
  const isHttps = url.protocol === "https:";
  const bodyObj = {
    model: cfg.model,
    messages,
    temperature: typeof temperature === "number" ? temperature : 0.7,
    stream: true,
    // v48.11：显式索要末块 usage（此前只有 provider 主动给才拿得到 → 换 provider 即全程 0 token）
    stream_options: { include_usage: true }
  };
  // 思考强度：仅 GLM-5.2+ 接受 reasoning_effort；GLM-5.3 系思考无法关闭，low = 最轻推理档
  if (supportsReasoningEffort(cfg.model)) {
    bodyObj.reasoning_effort = cfg.reasoningEffort || "low";
  }
  const body = JSON.stringify(bodyObj);
  const headers = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  headers["Content-Length"] = Buffer.byteLength(body);
  return new Promise((resolve, reject) => {
    let settled = false;
    let streamStarted = false; // 是否已收到响应（收到响应后的失败 = 结果未知）
    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      fn(val);
    };
    const onAbort = () => {
      const err = abortErrorOf(abortSignal);
      try {
        req.destroy(err);
      } catch {
        /* 已结束则忽略 */
      }
      finish(reject, err);
    };
    if (abortSignal) abortSignal.addEventListener("abort", onAbort, { once: true });
    const req = (isHttps ? https : http).request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: "POST",
        headers
      },
      (res) => {
        streamStarted = true;
        if (res.statusCode !== 200) {
          let errText = "";
          res.on("data", (c) => (errText += c));
          res.on("end", () => {
            const e = classifyHttpError(res.statusCode, errText, res.headers);
            e.streamStarted = false; // 未开始产出正文，可安全重试
            finish(reject, e);
          });
          return;
        }
        let buf = "";
        let usage = null; // v48：末块 usage（prompt/completion tokens；GLM 计入 reasoning）
        let finishReason = null; // v48.11：截断判定（length）所需
        // 思考模型（GLM 等）先输出 reasoning_content 再输出正文；thinking 计数节流转发（v10.4）
        let thinkAcc = 0;
        let lastThinkSent = 0;
        res.on("data", (chunk) => {
          if (firstByteMs == null) firstByteMs = Date.now() - startedAt;
          buf += chunk.toString("utf-8");
          let idx;
          while ((idx = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") {
              send({ done: true, usage, finishReason, ttftMs, firstByteMs });
              finish(resolve, { usage, finishReason, ttftMs, firstByteMs });
              return;
            }
            try {
              const json = JSON.parse(data);
              if (json.usage) usage = json.usage;
              const choice = json.choices?.[0] || {};
              if (choice.finish_reason) finishReason = choice.finish_reason;
              const d = choice.delta || {};
              if (ttftMs == null && (d.content || (typeof (d.reasoning_content ?? d.reasoning) === "string" && (d.reasoning_content ?? d.reasoning)))) {
                ttftMs = Date.now() - startedAt;
              }
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
          send({ done: true, usage, finishReason, ttftMs, firstByteMs });
          finish(resolve, { usage, finishReason, ttftMs, firstByteMs });
        });
        res.on("error", (err) => {
          err.streamStarted = true;
          finish(reject, err);
        });
      }
    );
    req.on("close", () => {
      if (abortSignal && abortSignal.aborted) finish(reject, abortErrorOf(abortSignal));
    });
    req.on("error", (err) => {
      if (abortSignal && abortSignal.aborted) {
        finish(reject, abortErrorOf(abortSignal));
        return;
      }
      if (err.code === "ECONNREFUSED") {
        const e =
          cfg.preset === "local"
            ? new Error(
                "无法连接本地模型服务（localhost 被拒绝）。请确认：① 已安装并启动 Ollama（或 LM Studio 已加载模型并开启本地服务）；② 端口正确（Ollama 11434 / LM Studio 1234）"
              )
            : new Error(`无法连接 AI 服务（${url.host} 连接被拒绝）`);
        e.code = "network";
        e.retriable = true;
        e.streamStarted = streamStarted;
        finish(reject, e);
        return;
      }
      err.code = err.code === "ETIMEDOUT" ? "timeout" : err.code || "network";
      err.retriable = err.code === "network" && !streamStarted;
      err.streamStarted = streamStarted;
      finish(reject, err);
    });
    // socket 不活动超时（v45 补记）：流式响应期间任何数据都会重置计时；GLM 思考期有 reasoning_content
    // 持续流出不会误杀。缺了它，网络黑洞（连接建立但服务端永不应答）会让 IPC 永不 resolve——
    // 设置页「测试连接」曾因此永久置灰，只能重启设置窗口。
    req.setTimeout(120000, () => {
      const err = new Error("AI 连接超时：120 秒无数据响应，已自动中断（请检查网络或服务地址）");
      err.code = "timeout";
      err.streamStarted = streamStarted;
      req.destroy(err);
      finish(reject, err);
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
    // 拉取模型列表/在线词典等 JSON 请求：30 秒无数据即断（防黑洞连接挂死调用方）
    req.setTimeout(30000, () => {
      req.destroy(new Error("请求超时：30 秒无响应，已自动中断"));
    });
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
