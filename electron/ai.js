// AI 网关 — 主进程统一 LLM 通道（文档§3.11 AIGateway）
// Key 用 safeStorage 加密存储；流式输出经 WebContents 发送到渲染层
// C-20：safeStorage 只经 ./keyVault 访问（strength/encrypt/decrypt）；系统加密不可用时
// Key 只留本次运行内存（sessionKeys），绝不落明文盘——修复「明文保存却读不出来」。
const { app, BrowserWindow } = require("electron");
const path = require("path");
const keyVault = require("./keyVault");
// C-19b：网络传输统一走 aiTransport（Electron net.fetch 优先——Chromium 网络栈继承系统代理；
// 测试 / 纯 Node 回落 globalThis.fetch）。Node http/https 栈不读系统代理，海外预设需代理才可达。
const { postSSE, getJSON } = require("./aiTransport");
// C-15：ai-config.json 与 settings.json 共用同一套 JSON 文件读写（BOM / 留档 / 原子写 + fsync）
const { readJsonObject, writeJsonAtomic } = require("./jsonFile");

// 供应商注册表（v48.68 / D112，设计 docs/design/AI-PROVIDER-REGISTRY-D112.md）：
// 单一来源驱动设置页 UI（经 ai:getConfig 下发元数据，无 Key）。
// 全部走 OpenAI 兼容 /chat/completions——Claude / Gemini 用其官方兼容层；端点于 2026-10-07 联网核实。
const PRESETS = {
  // 硅基流动置顶（v48.69 / D113 用户指令）：keyUrl 为用户个人邀请链接（「推荐官」计划）
  siliconflow: {
    id: "siliconflow",
    name: "硅基流动 SiliconFlow",
    group: "official",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "Qwen/Qwen2.5-7B-Instruct",
    keyUrl: "https://cloud.siliconflow.cn/i/AL4iBJ0e",
    hint: "OpenAI 兼容聚合 · DeepSeek / Qwen / GLM 全系 · 经邀请链接注册后在控制台创建 API Key"
  },
  goat: {
    id: "goat",
    name: "Command Code GOAT Plan",
    group: "official",
    baseUrl: "https://api.commandcode.ai/provider/v1",
    model: "z-ai/glm-5.3-flash",
    keyUrl: "https://commandcode.ai/xiongdy54/settings/keys",
    hint: "OpenAI 兼容 · 默认 z-ai/glm-5.3-flash · 可拉取模型列表后自选"
  },
  zai: {
    id: "zai",
    name: "智谱官方 API（bigmodel.cn）",
    group: "official",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4.7-flash",
    keyUrl: "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
    hint: "OpenAI 兼容 · 默认免费模型 glm-4.7-flash · 可拉取列表自选 glm-5.3 等"
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek 官方",
    group: "official",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    keyUrl: "https://platform.deepseek.com/api_keys",
    hint: "OpenAI 兼容 · deepseek-chat（对话）/ deepseek-reasoner（推理）"
  },
  mimo: {
    id: "mimo",
    name: "小米 MiMo 开放平台",
    group: "official",
    baseUrl: "https://api.xiaomimimo.com/v1",
    model: "MiMo-V2-Flash",
    keyUrl: "https://mimo.mi.com",
    hint: "OpenAI 兼容 · MiMo-V2 系列，建议拉取模型列表后自选"
  },
  openai: {
    id: "openai",
    name: "OpenAI 官方（GPT）",
    group: "official",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    keyUrl: "https://platform.openai.com/api-keys",
    hint: "原生 OpenAI 协议 · 默认 gpt-4o-mini，可拉取列表自选"
  },
  ark: {
    id: "ark",
    name: "火山方舟（豆包）",
    group: "official",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "",
    keyUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
    hint: "OpenAI 兼容 · 模型名填推理接入点 ID（ep-…）或开通的模型名"
  },
  grok: {
    id: "grok",
    name: "xAI Grok",
    group: "official",
    baseUrl: "https://api.x.ai/v1",
    model: "grok-3",
    keyUrl: "https://console.x.ai",
    hint: "OpenAI 兼容 · 可拉取模型列表自选 grok 系列"
  },
  claude: {
    id: "claude",
    name: "Anthropic Claude",
    group: "official",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-6",
    keyUrl: "https://console.anthropic.com/settings/keys",
    hint: "走官方 OpenAI 兼容层 · 温度上限 1 · 不提供模型列表，请手输模型名（如 claude-sonnet-4-6）"
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    group: "official",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-flash",
    keyUrl: "https://aistudio.google.com/apikey",
    hint: "走官方 OpenAI 兼容层 · 可拉取列表或手输 gemini 系列"
  },
  kimi: {
    id: "kimi",
    name: "Kimi（月之暗面）",
    group: "official",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-k2-0905-preview",
    keyUrl: "https://platform.kimi.com",
    hint: "OpenAI 兼容 · kimi-k2 系列，可拉取列表自选"
  },
  qwen: {
    id: "qwen",
    name: "阿里云百炼（Qwen）",
    group: "official",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    keyUrl: "https://bailian.console.aliyun.com/?apiKey=1",
    hint: "OpenAI 兼容（compatible-mode）· qwen 系列，可拉取列表自选"
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter（多模型聚合）",
    group: "agg",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "",
    keyUrl: "https://openrouter.ai/keys",
    hint: "一个 Key 用全部主流模型 · 请拉取模型列表后自选"
  },
  custom: {
    id: "custom",
    name: "通用 API Key（OpenAI 兼容）",
    group: "custom",
    baseUrl: "",
    model: "",
    keyUrl: "",
    hint: "自填 Base URL / 模型 / Key"
  },
  local: {
    id: "local",
    name: "本地模型（Ollama / LM Studio）",
    group: "local",
    baseUrl: "http://localhost:11434/v1",
    model: "qwen3:8b",
    keyUrl: "",
    hint: "零排队 · 零成本 · 8GB 显存推荐 qwen3:8b；LM Studio 端口 1234；无需 Key"
  }
};

// 渲染层下拉的分组顺序（group 值 → 展示名；映射放渲染层，这里只带 group 标签）

// 本地运行时探测顺序（v48.68 / D112）：Ollama 优先（其 /v1/models 失败再试原生 /api/tags，旧版兼容），
// LM Studio 其次。每探针独立短超时，任何失败都落到下一候选；全不命中返回 detected:false（不抛错）。
const LOCAL_PROBES = [
  { runtime: "ollama", runtimeName: "Ollama", baseUrl: "http://localhost:11434/v1" },
  { runtime: "lmstudio", runtimeName: "LM Studio", baseUrl: "http://localhost:1234/v1" }
];
const DETECT_TIMEOUT_MS = 4000;

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

// C-20：preset → key，只在本进程内存里，不落盘。系统密钥库不可用（none / weak）时保存的
// Key、以及从旧版明文配置迁移出来的 Key 都放这里——重启后需重新输入，但绝不留明文在磁盘。
const sessionKeys = new Map();

function readConfig() {
  // C-15：统一走 jsonFile（BOM 容忍 / 非对象留档）
  const cfg = readJsonObject(aiConfigPath(), () => ({
    preset: "goat",
    baseUrl: PRESETS.goat.baseUrl,
    model: PRESETS.goat.model,
    apiKeyEnc: null,
    keys: {}
  }));
  // v10.3 迁移：旧版全局 Key 归档到其所属预设，实现按服务商留存（仅密文形态）
  if (!cfg.keys || typeof cfg.keys !== "object") cfg.keys = {};
  if (cfg.apiKeyEnc && cfg.preset && cfg.keys[cfg.preset] === undefined) {
    cfg.keys[cfg.preset] = cfg.apiKeyEnc;
  }
  // C-20：明文 Key 一律不落盘——存量 apiKeyPlain 与 keys 里的 "plain:" 值移进内存 sessionKeys，
  // 然后把清理后的配置写回磁盘。这些明文 Key 在旧版就读不出来（getAIConfig 只解密 apiKeyEnc），
  // 删除不会让任何现有功能变差。
  let plainMigrated = false;
  if (cfg.apiKeyPlain) {
    const p = cfg.preset || "custom";
    if (!sessionKeys.has(p)) sessionKeys.set(p, String(cfg.apiKeyPlain));
    delete cfg.apiKeyPlain;
    plainMigrated = true;
  }
  for (const k of Object.keys(cfg.keys)) {
    const v = cfg.keys[k];
    if (typeof v === "string" && v.startsWith("plain:")) {
      if (!sessionKeys.has(k)) sessionKeys.set(k, v.slice(6));
      delete cfg.keys[k];
      plainMigrated = true;
    }
  }
  if (plainMigrated) writeConfig(cfg);
  return cfg;
}

function writeConfig(cfg) {
  writeJsonAtomic(aiConfigPath(), cfg);
}

// 注册表元数据（v48.68 / D112）：随 ai:getConfig 下发渲染层驱动 UI——只含公开字段，永不含 Key
const PRESET_META = Object.values(PRESETS).map(({ id, name, baseUrl, model, keyUrl, hint, group }) => ({
  id,
  name,
  baseUrl,
  model,
  keyUrl,
  hint,
  group
}));

/** OpenAI `{data:[{id}]}` / Ollama `{models:[{name}]}` / 裸字符串数组 → 模型 id 列表 */
function modelIdsFromJson(json) {
  if (!json) return [];
  const raw = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : [];
  return raw.map((m) => (typeof m === "string" ? m : m.id || m.name || m.model)).filter(Boolean);
}

function getAIConfig() {
  const cfg = readConfig();
  const st = keyVault.strength();
  let apiKey = "";
  // keyStorage：Key 当前从哪来——"encrypted"（密文落盘可解）/ "session"（仅本进程内存）/ "none"
  let keyStorage = "none";
  if (cfg.apiKeyEnc && st !== "none") {
    try {
      apiKey = keyVault.decrypt(cfg.apiKeyEnc);
    } catch {
      apiKey = "";
    }
    if (apiKey) keyStorage = "encrypted";
  }
  // C-20：密文解不出（或没有密文）时回落 sessionKeys——修复「保存了 Key 却读不出来」
  if (!apiKey) {
    const sessionKey = sessionKeys.get(cfg.preset || "custom");
    if (sessionKey) {
      apiKey = sessionKey;
      keyStorage = "session";
    }
  }
  const preset = PRESETS[cfg.preset] || PRESETS.custom;
  return {
    preset: cfg.preset,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    apiKey,
    hasKey: Boolean(apiKey),
    keyStorage,
    encryptionStrength: st,
    keyUrl: preset.keyUrl || "",
    hint: preset.hint || "",
    presetName: preset.name,
    reasoningEffort: cfg.reasoningEffort || "low",
    presets: PRESET_META
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
      if (typeof presetKey === "string" && presetKey.startsWith("plain:")) {
        // C-20：旧明文形态只进内存 sessionKeys，从 cfg.keys 删除，不再写回 apiKeyPlain
        sessionKeys.set(partial.preset, presetKey.slice(6));
        delete cfg.keys[partial.preset];
        cfg.apiKeyEnc = null;
      } else {
        cfg.apiKeyEnc = presetKey;
      }
    } else {
      cfg.apiKeyEnc = null;
    }
    delete cfg.apiKeyPlain; // 纵深防御：任何分支都不再落明文形态
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
      sessionKeys.delete(cfg.preset || "custom");
      if (cfg.preset) delete cfg.keys[cfg.preset];
    } else if (keyVault.strength() === "secure") {
      cfg.apiKeyEnc = keyVault.encrypt(partial.apiKey);
      // 按服务商留存一份，切换回来时自动恢复
      if (cfg.preset) cfg.keys[cfg.preset] = cfg.apiKeyEnc;
    } else {
      // C-20：系统密钥库不可用（或仅 basic_text 弱后端）——Key 只留本次运行内存，绝不落盘。
      // 修复「明文保存却读不出来」：旧实现写 apiKeyPlain / "plain:"，但 getAIConfig 从不读它们。
      sessionKeys.set(cfg.preset || "custom", partial.apiKey);
      cfg.apiKeyEnc = null;
      delete cfg.apiKeyPlain;
      if (cfg.preset) delete cfg.keys[cfg.preset];
    }
  }
  writeConfig(cfg);
  const { apiKey, ...safe } = getAIConfig();
  return safe;
}

// C-19a 第 6 步：错误正文脱敏——部分服务商会在错误响应里回显 Key 片段，这些文本会进 UI 与日志
function redact(s) {
  return String(s || "")
    .replace(/(Bearer\s+)[^\s"']+/gi, "$1***")
    .replace(/\b(sk|ak|pk|key)[-_][A-Za-z0-9_\-]{6,}/gi, "$1-***");
}

// v48 批2（M15 §4.19-8）：机读错误码——超时/限流/网络/HTTP/无 Key/取消，多级管线重试与失败状态机需要；
// 中文 message 不变（渲染层展示不受影响），仅附 .code。
// v48.11（§3.7）：附 status / retryAfterMs（供 429 退避优先遵循 Retry-After）。
function classifyHttpError(status, errText, headers) {
  const err = new Error(`AI 服务错误 ${status}: ${redact(errText).slice(0, 300)}`);
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

// C-19a 第 5 步：可归为瞬时网络错误的系统码——统一归 code:"network"（原码保留在 .sysCode），
// 与 classifyHttpError 的「只有 408/429/5xx 可重试」共同构成重试判定的唯一来源
const NET_CODES = new Set(["ECONNRESET", "EPIPE", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "ECONNABORTED"]);

// C-19b：fetch 层的网络失败不带 Node 系统码——undici 是 TypeError("fetch failed") + cause 链
// （AggregateError.errors 里才有 code），Chromium net.fetch 是 TypeError("… net::ERR_XXX …"）。
// 先还原成系统码，再走 C-19a 第 5 步的同一段归类规则。
const CHROMIUM_NET_CODES = {
  ERR_CONNECTION_REFUSED: "ECONNREFUSED",
  ERR_CONNECTION_RESET: "ECONNRESET",
  ERR_CONNECTION_CLOSED: "ECONNRESET",
  ERR_NETWORK_CHANGED: "ECONNRESET",
  ERR_EMPTY_RESPONSE: "ECONNRESET",
  ERR_CONNECTION_TIMED_OUT: "ETIMEDOUT",
  ERR_TIMED_OUT: "ETIMEDOUT",
  ERR_NAME_NOT_RESOLVED: "ENOTFOUND",
  ERR_ADDRESS_UNREACHABLE: "ENETUNREACH",
  ERR_HOST_UNREACHABLE: "EHOSTUNREACH"
};

function unwrapSysCode(err) {
  let e = err;
  for (let i = 0; e && i < 4; i += 1) {
    if (typeof e.code === "string" && e.code) return e.code;
    if (Array.isArray(e.errors)) {
      for (const c of e.errors) {
        if (c && typeof c.code === "string" && c.code) return c.code;
      }
    }
    const m = typeof e.message === "string" ? e.message.match(/net::(ERR_[A-Z_]+)/) : null;
    if (m) return CHROMIUM_NET_CODES[m[1]] || m[1];
    e = e.cause;
  }
  return null;
}

/** 连接期 / 读流期失败的统一归类：ECONNREFUSED 给可读文案，其余按第 5 步规则归 network / timeout */
function classifyNetError(err, { cfg, host, streamStarted }) {
  if (err && err.code === "timeout") {
    // 传输层空闲超时（v45 语义）：code 已是 timeout，保持不重试
    err.streamStarted = streamStarted;
    return err;
  }
  if (err && err.code === "truncated") return err; // 已归类，不重复处理
  const sysCode = unwrapSysCode(err);
  if (sysCode === "ECONNREFUSED") {
    const e =
      cfg.preset === "local"
        ? new Error(
            "无法连接本地模型服务（localhost 被拒绝）。请确认：① 已安装并启动 Ollama（或 LM Studio 已加载模型并开启本地服务）；② 端口正确（Ollama 11434 / LM Studio 1234）"
          )
        : new Error(`无法连接 AI 服务（${host} 连接被拒绝）`);
    e.code = "network";
    e.retriable = true;
    e.streamStarted = streamStarted;
    return e;
  }
  if (!err.code && sysCode) err.code = sysCode; // fetch 的 TypeError 本身无 code，还原系统码
  // ↓ C-19a 第 5 步（与原 req.on("error") 同一段规则）
  if (err.code === "ETIMEDOUT") err.code = "timeout";
  else if (!err.code || NET_CODES.has(err.code)) {
    err.sysCode = err.code || null;
    err.code = "network";
  }
  err.retriable = err.code === "network" && !streamStarted; // timeout 保持原语义：不重试
  err.streamStarted = streamStarted;
  return err;
}

// T4（D192）：可选 model 覆盖（导图模型，共用全局服务商地址与 Key）与 maxTokens；缺省时请求体与此前逐字节一致
function chatStream({ messages, temperature, abortSignal, retry, model, maxTokens }, send) {
  const maxAttempts = Math.max(1, Math.min(5, Number(retry && retry.maxAttempts) || 1));
  const onRetry = retry && typeof retry.onRetry === "function" ? retry.onRetry : null;
  let attempt = 1;
  const run = () =>
    chatStreamOnce({ messages, temperature, abortSignal, model, maxTokens }, send).catch(async (err) => {
      const code = err && err.code;
      // C-19a 第 4 步：只认 err.retriable === true。408/429/5xx 由 classifyHttpError 置位、
      // ECONNREFUSED 分支置位、其余网络错误按 NET_CODES 归类置位；4xx / cancelled / truncated
      // 一律 false——旧写法的 `code === "http"` 会让 400/401/403/404 也吃满指数退避
      const retriable = err && err.retriable === true;
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

function chatStreamOnce({ messages, temperature, abortSignal, model, maxTokens }, send) {
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
  const useModel = (typeof model === "string" && model.trim()) || cfg.model;
  const bodyObj = {
    model: useModel,
    messages,
    temperature: typeof temperature === "number" ? temperature : 0.7,
    stream: true,
    // v48.11：显式索要末块 usage（此前只有 provider 主动给才拿得到 → 换 provider 即全程 0 token）
    stream_options: { include_usage: true }
  };
  // 思考强度：仅 GLM-5.2+ 接受 reasoning_effort；GLM-5.3 系思考无法关闭，low = 最轻推理档
  if (supportsReasoningEffort(useModel)) {
    bodyObj.reasoning_effort = cfg.reasoningEffort || "low";
  }
  if (typeof maxTokens === "number" && Number.isFinite(maxTokens) && maxTokens > 0) {
    bodyObj.max_tokens = Math.floor(maxTokens);
  }
  const body = JSON.stringify(bodyObj);
  const headers = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  // C-19b：Content-Length 由传输层按 body 自行计算（fetch 规范中手设属 forbidden header，会被忽略）
  return (async () => {
    let streamStarted = false; // 是否已收到响应（收到响应后的失败 = 结果未知，§3.7）
    let resp;
    try {
      // C-19b：传输层优先 Electron net.fetch（Chromium 网络栈，继承系统代理）；
      // 120s 空闲超时覆盖「连接 / 响应头 / 每个正文 chunk」全程（v45 补记语义，读流期间有数据即重置）
      resp = await postSSE(url.href, { headers, body, signal: abortSignal, idleMs: 120000 });
    } catch (err) {
      if (abortSignal && abortSignal.aborted) throw abortErrorOf(abortSignal);
      throw classifyNetError(err, { cfg, host: url.host, streamStarted });
    }
    streamStarted = true;

    if (resp.status !== 200) {
      let errText = "";
      try {
        for await (const t of resp.textChunks()) errText += t;
      } catch (err) {
        if (abortSignal && abortSignal.aborted) throw abortErrorOf(abortSignal);
        throw classifyNetError(err, { cfg, host: url.host, streamStarted: true });
      }
      const e = classifyHttpError(resp.status, errText, { "retry-after": resp.header("retry-after") });
      e.streamStarted = false; // 未开始产出正文，可安全重试
      throw e;
    }

    let buf = "";
    let usage = null; // v48：末块 usage（prompt/completion tokens；GLM 计入 reasoning）
    let finishReason = null; // v48.11：截断判定（length）所需
    // 思考模型（GLM 等）先输出 reasoning_content 再输出正文；thinking 计数节流转发（v10.4）
    let thinkAcc = 0;
    let lastThinkSent = 0;
    // C-19a 第 2/8 步：done 只发一次（[DONE] 与收尾双路径共用）；逐行解析抽成 handleLine，
    // 便于流结束时补处理没有换行符的末行
    let doneSent = false;
    let sawDone = false;
    const sendDoneOnce = (p) => {
      if (doneSent) return;
      doneSent = true;
      send({ done: true, ...p });
    };
    const handleLine = (line) => {
      // 返回 true 表示遇到 [DONE]
      if (!line.startsWith("data:")) return false;
      const data = line.slice(5).trim();
      if (data === "[DONE]") {
        sawDone = true;
        return true;
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
      return false;
    };

    // C-19a 第 3 步：200 但内容类型不对——text/html 多为网关/代理页；application/json 是
    // 服务端忽略 stream:true 的整包回复。其余类型（含缺失）继续按 SSE 解析（有些本地服务
    // 不规范地设置 content-type，不要误杀，由第 2 步的截断规则兜底）。
    const contentType = String(resp.header("content-type") || "").toLowerCase();
    if (contentType.includes("text/html") || contentType.includes("application/json")) {
      let whole = "";
      try {
        for await (const t of resp.textChunks()) {
          if (firstByteMs == null) firstByteMs = Date.now() - startedAt;
          whole += t;
        }
      } catch (err) {
        if (abortSignal && abortSignal.aborted) throw abortErrorOf(abortSignal);
        err.streamStarted = true;
        throw err;
      }
      if (contentType.includes("application/json")) {
        let json = null;
        try {
          json = JSON.parse(whole);
        } catch {
          json = null;
        }
        const content = json?.choices?.[0]?.message?.content;
        if (typeof content === "string" && content) {
          // 整包 JSON：作为一次 delta 发出并正常结束
          if (ttftMs == null) ttftMs = Date.now() - startedAt;
          if (json.usage) usage = json.usage;
          if (json.choices[0].finish_reason) finishReason = json.choices[0].finish_reason;
          send({ delta: content });
          sendDoneOnce({ usage, finishReason, ttftMs, firstByteMs });
          return { usage, finishReason, ttftMs, firstByteMs };
        }
      }
      const e = new Error(`AI 服务返回了非流式内容（content-type: ${contentType || "缺失"}）：${redact(whole).slice(0, 200)}`);
      e.code = "bad_content_type";
      e.retriable = false;
      e.streamStarted = true;
      throw e;
    }

    // SSE 流（C-19a 第 1/2 步：多字节解码由传输层 TextDecoder(stream:true) 保证；行级规则同前）
    try {
      for await (const chunk of resp.textChunks()) {
        if (firstByteMs == null) firstByteMs = Date.now() - startedAt;
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (handleLine(line)) {
            sendDoneOnce({ usage, finishReason, ttftMs, firstByteMs });
            return { usage, finishReason, ttftMs, firstByteMs }; // [DONE] 之后的残余数据不再消费
          }
        }
      }
    } catch (err) {
      if (abortSignal && abortSignal.aborted) throw abortErrorOf(abortSignal);
      if (err && err.code === "timeout") {
        err.streamStarted = true; // 正文读到一半超时 = 结果未知（v45 语义：不重试）
        throw err;
      }
      err.streamStarted = true; // 正文读到一半失败 = 结果未知（§3.7）
      throw err;
    }
    if (buf.trim()) handleLine(buf.trim()); // 末行没有换行符
    if (sawDone || finishReason) {
      sendDoneOnce({ usage, finishReason, ttftMs, firstByteMs });
      return { usage, finishReason, ttftMs, firstByteMs };
    }
    // C-19a 第 2 步：既没有 [DONE] 也没有 finish_reason 的提前收尾 = 截断，不是成功
    const e = new Error("AI 响应在完成前中断：没有收到结束标记，结果可能不完整");
    e.code = "truncated";
    e.streamStarted = true;
    e.retriable = false;
    throw e;
  })();
}

function requestJSON(url, headers, timeoutMs) {
  // C-19b：改走传输层 getJSON（Electron net.fetch 优先——继承系统代理；res.text() 内部按
  // UTF-8 解码，多字节安全）。返回形状与旧实现一致：{ status, json }；HTTP 错误状态不抛错、
  // 坏 JSON 时 json 为 null；超时（默认 30s，探测 4s）以 code:"timeout" reject。
  return getJSON(url, { headers, timeoutMs });
}

/** 本地预设的模型列表降级源：Ollama 原生 /api/tags（同源，/v1/models 不可用或为空时兜底） */
async function ollamaTagsFallback(baseUrl) {
  try {
    const origin = new URL(baseUrl).origin;
    const { status, json } = await requestJSON(origin + "/api/tags", {}, DETECT_TIMEOUT_MS);
    if (status !== 200 || !json) return null;
    const ids = modelIdsFromJson(json);
    return ids.length > 0 ? ids.sort((a, b) => a.localeCompare(b)) : null;
  } catch {
    return null;
  }
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
  let status = 0;
  let json = null;
  let netFailed = false;
  try {
    ({ status, json } = await requestJSON(url, headers));
  } catch {
    netFailed = true;
  }
  // 本地预设：/v1/models 连不上、非 200 或返回空时，降级 Ollama 原生 /api/tags（v48.68 / D112）
  if (cfg.preset === "local" && (netFailed || status !== 200 || !json)) {
    const tags = await ollamaTagsFallback(cfg.baseUrl);
    if (tags) return tags;
    throw new Error("无法连接本地模型服务。请确认 Ollama / LM Studio 已启动。");
  }
  if (netFailed) throw new Error("网络错误：无法访问模型列表接口");
  if (status !== 200 || !json) {
    throw new Error(`拉取模型列表失败（HTTP ${status}）`);
  }
  const ids = modelIdsFromJson(json);
  if (cfg.preset === "local" && ids.length === 0) {
    const tags = await ollamaTagsFallback(cfg.baseUrl);
    if (tags) return tags;
  }
  return ids.sort((a, b) => a.localeCompare(b));
}

/** 本地运行时探测（v48.68 / D112）：Ollama 11434 → LM Studio 1234，探针 4s 超时；全不命中不抛错。
 *  probes 参数仅供测试注入自定义端点，生产调用不传（用 LOCAL_PROBES）。 */
async function detectLocalRuntime(probes) {
  const list = Array.isArray(probes) && probes.length > 0 ? probes : LOCAL_PROBES;
  for (const probe of list) {
    try {
      const { status, json } = await requestJSON(probe.baseUrl + "/models", {}, DETECT_TIMEOUT_MS);
      if (status === 200 && json) {
        const ids = modelIdsFromJson(json);
        return { detected: true, runtime: probe.runtime, runtimeName: probe.runtimeName, baseUrl: probe.baseUrl, models: ids.sort((a, b) => a.localeCompare(b)) };
      }
      if (probe.runtime === "ollama") {
        const tags = await ollamaTagsFallback(probe.baseUrl);
        if (tags) return { detected: true, runtime: probe.runtime, runtimeName: probe.runtimeName, baseUrl: probe.baseUrl, models: tags };
      }
    } catch {
      if (probe.runtime === "ollama") {
        const tags = await ollamaTagsFallback(probe.baseUrl);
        if (tags) return { detected: true, runtime: probe.runtime, runtimeName: probe.runtimeName, baseUrl: probe.baseUrl, models: tags };
      }
    }
  }
  return {
    detected: false,
    message: "未检测到本地模型服务。请确认：① Ollama 已安装并启动（默认端口 11434），或 LM Studio 已加载模型并开启本地服务（默认端口 1234）；② 服务地址可访问"
  };
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

module.exports = { getAIConfig, setAIConfig, chatStream, testConnection, listModels, detectLocalRuntime, PRESETS };
