// AI 网络传输层（C-19b）：AI 网关统一走 fetch 语义——优先 Electron net.fetch（Chromium 网络栈，
// 继承系统代理；app ready 之后可用），测试 / 纯 Node 环境回落 globalThis.fetch。
// 与词典 / 联网搜索同款结论（main.js：dictionaryapi.dev 实测直连超时，需代理兜底）——
// 内置海外预设（OpenAI / Anthropic / Google / x.ai / OpenRouter 等）在需代理的网络环境下
// 只有走系统代理才可达，Node http/https 栈不读系统代理设置（C-19 证据 7）。
// 正文解码统一 TextDecoder("utf-8") 的 stream:true 模式（C-19a 第 1 步规则在传输层继续成立）；
// 空闲超时（默认 120 秒）覆盖「连接建立 → 响应头 → 每个正文 chunk」全程，收到数据即重置（v45 语义）。
const IDLE_DEFAULT_MS = 120000;
const JSON_TIMEOUT_DEFAULT_MS = 30000;

/** 生产：Electron net.fetch（继承系统代理）；测试 / 纯 Node：globalThis.fetch */
function pickFetch() {
  try {
    const electron = require("electron");
    if (
      electron &&
      electron.net &&
      typeof electron.net.fetch === "function" &&
      (!electron.app || electron.app.isReady())
    ) {
      return (u, init) => electron.net.fetch(u, init);
    }
  } catch {
    /* 非 Electron 环境（纯 Node 测试） */
  }
  const f = globalThis.fetch;
  if (typeof f !== "function") throw new Error("当前环境没有可用的 fetch 实现");
  return (u, init) => f(u, init);
}

/** 当前是否会选择 Electron 网络栈（Chromium，继承系统代理）——测试探针 / 诊断用 */
function usesElectronNet() {
  try {
    const electron = require("electron");
    return Boolean(
      electron &&
        electron.net &&
        typeof electron.net.fetch === "function" &&
        (!electron.app || electron.app.isReady())
    );
  } catch {
    return false;
  }
}

function idleTimeoutError(ms) {
  const err = new Error(`AI 连接超时：${Math.round(ms / 1000)} 秒无数据响应，已自动中断（请检查网络或服务地址）`);
  err.code = "timeout";
  return err;
}

/**
 * POST 并把响应体作为已解码的 UTF-8 文本块流式给出（SSE 与整包内容共用）。
 * 返回 { status, headers, header(name), textChunks() }；textChunks 为 async generator，
 * 空闲超时（idleMs，默认 120s）在「连接 / 响应头 / 每个 chunk」之间重置，
 * 超时以 code:"timeout" 抛出；调用方提前停止消费（如收到 [DONE]）会自动断开底层连接。
 */
async function postSSE(url, { headers, body, signal, idleMs = IDLE_DEFAULT_MS } = {}) {
  const doFetch = pickFetch();
  const ctrl = new AbortController();
  const onCallerAbort = () => ctrl.abort(signal && signal.reason);
  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason);
    else signal.addEventListener("abort", onCallerAbort, { once: true });
  }
  const detach = () => {
    if (signal && typeof signal.removeEventListener === "function") {
      signal.removeEventListener("abort", onCallerAbort);
    }
  };
  let idleErr = null;
  let timer = null;
  const disarm = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const arm = () => {
    disarm();
    timer = setTimeout(() => {
      idleErr = idleTimeoutError(idleMs);
      try {
        ctrl.abort(idleErr);
      } catch {
        /* 请求已结束 */
      }
    }, idleMs);
    if (typeof timer.unref === "function") timer.unref();
  };
  arm(); // 覆盖连接建立与等待响应头阶段（网络黑洞防护，v45 语义）
  let res;
  try {
    res = await doFetch(url, { method: "POST", headers, body, signal: ctrl.signal });
    arm(); // 响应头已到（socket 有活动），重置；正文黑洞由读流阶段继续兜底
  } catch (err) {
    disarm();
    detach();
    if (idleErr) throw idleErr;
    throw err;
  }
  return {
    status: res.status,
    headers: res.headers,
    header: (name) => {
      try {
        if (res.headers && typeof res.headers.get === "function") return res.headers.get(name);
      } catch {
        /* 个别实现可能抛错，走兜底 */
      }
      return (res.headers && res.headers[name]) || null;
    },
    textChunks: async function* () {
      if (!res.body) {
        disarm();
        detach();
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          arm();
          const text = decoder.decode(value, { stream: true });
          if (text) yield text;
        }
        const tail = decoder.decode(); // 冲出解码器暂存的末尾多字节残片
        if (tail) yield tail;
      } catch (err) {
        if (idleErr) throw idleErr;
        throw err;
      } finally {
        disarm();
        detach();
        try {
          await reader.cancel();
        } catch {
          /* 已结束 */
        }
      }
    }
  };
}

/**
 * GET 并整包解析 JSON：{ status, json }（解析失败 json 为 null，与旧 requestJSON 行为一致；
 * HTTP 错误状态不抛错，由调用方按 status 分支）。timeoutMs（默认 30s）内无响应 →
 * reject（code:"timeout"），消息沿用旧 requestJSON 的超时文案。
 */
async function getJSON(url, { headers, timeoutMs = JSON_TIMEOUT_DEFAULT_MS } = {}) {
  const doFetch = pickFetch();
  const ctrl = new AbortController();
  let timedOut = false;
  const timeoutText = "请求超时：30 秒无响应，已自动中断";
  const timer = setTimeout(() => {
    timedOut = true;
    const err = new Error(timeoutText);
    err.code = "timeout";
    try {
      ctrl.abort(err);
    } catch {
      /* 请求已结束 */
    }
  }, timeoutMs);
  if (typeof timer.unref === "function") timer.unref();
  try {
    const res = await doFetch(url, { headers, signal: ctrl.signal });
    const text = await res.text(); // 内部按 UTF-8 解码，多字节安全
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json };
  } catch (err) {
    if (timedOut) {
      const e = new Error(timeoutText);
      e.code = "timeout";
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { postSSE, getJSON, pickFetch, usesElectronNet, IDLE_DEFAULT_MS };
