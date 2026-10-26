// @runtime: electron
// C-19：AI 流式传输契约——多字节跨 chunk 拼接 / 截断不再当成功 / 非 SSE 不再当成功 /
// 4xx 不再重试 / 503 仍重试 / done 恰好一次（报告 C-19 验收场景 a–h）。
// 运行：npx electron tests/ai-stream.test.cjs（或 node scripts/run-tests.mjs ai-stream）
// 服务端：http.createServer 模拟 OpenAI 兼容 /chat/completions；隔离 userData（app.setPath），
// 绝不触碰真实配置（C-11 口径）。C-19a 与 C-19b（fetch 传输层）共用本套件。
const { app } = require("electron");
// C-19b：走 net.fetch 后 Chromium 会在 userData 里初始化网络磁盘缓存并锁住文件，
// 测试末尾的 rmSync(userData) 会被无限期卡住（进程 25s+ 不退）。禁用 http 缓存——
// 本套件验证的是 SSE 解析与错误语义，与缓存无关。
app.commandLine.appendSwitch("disable-http-cache");
const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");

const ROOT = path.join(__dirname, "..");

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`);
  }
}

const listen = (server) =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

const closeServer = (server) =>
  new Promise((resolve) => {
    server.close(() => resolve());
    if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  });

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ai-stream-"));
  app.setPath("userData", tmp);
  const ai = require(path.join(ROOT, "electron", "ai.js"));

  // 每个场景：起本地服务器 → 切 local 预设（无需 Key）→ baseUrl 指向该服务器（报告验收口径）
  const against = async (server, opts = {}, onMsg = () => {}) => {
    const port = await listen(server);
    // D239：setAIConfig 自 C-24 起是 async；两次写配置必须依次等完，否则第二次可能读到第一次写完之前的旧配置
    await ai.setAIConfig({ preset: "local" });
    await ai.setAIConfig({ baseUrl: `http://127.0.0.1:${port}/v1` });
    return ai.chatStream({ messages: [{ role: "user", content: "hi" }], ...opts }, onMsg);
  };

  const SSE = { "Content-Type": "text/event-stream" };

  try {
    // ---- (a) 多字节字符跨 chunk 切断 ----
    {
      const head = 'data: {"choices":[{"delta":{"content":"';
      const full = head + "中文测试" + '"}}]}\n' + "data: [DONE]\n";
      const bytes = Buffer.from(full, "utf8");
      const cut = Buffer.byteLength(head) + 1; // 在「中」（E4 B8 AD）的第 2 个字节处切开
      const server = http.createServer((req, res) => {
        res.writeHead(200, SSE);
        res.write(bytes.subarray(0, cut));
        setTimeout(() => res.end(bytes.subarray(cut)), 20);
      });
      const parts = [];
      await against(server, {}, (m) => {
        if (m.delta) parts.push(m.delta);
      });
      const text = parts.join("");
      check("(a) 多字节跨 chunk 拼出完整文本", text === "中文测试", "中文测试", text);
      check("(a) 无替换字符 U+FFFD", !text.includes("\uFFFD"), false, text.includes("\uFFFD"));
      await closeServer(server);
    }

    // ---- (b) 正常 delta 后直接 end：既无 [DONE] 也无 finish_reason ----
    {
      const server = http.createServer((req, res) => {
        res.writeHead(200, SSE);
        res.write('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n');
        res.end();
      });
      let err = null;
      await against(server).catch((e) => {
        err = e;
      });
      check("(b) 截断 → reject 且 code === truncated", err && err.code === "truncated", "truncated", err && err.code);
      check("(b) truncated 不重试（retriable === false）", err && err.retriable === false, false, err && err.retriable);
      await closeServer(server);
    }

    // ---- (c) 有 finish_reason: "stop" 但无 [DONE] ----
    {
      const server = http.createServer((req, res) => {
        res.writeHead(200, SSE);
        res.write('data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n');
        res.end();
      });
      const parts = [];
      const r = await against(server, {}, (m) => {
        if (m.delta) parts.push(m.delta);
      });
      check("(c) finish_reason:stop 无 [DONE] → resolve", Boolean(r) && r.finishReason === "stop", "stop", r && r.finishReason);
      check("(c) 正文完整收到", parts.join("") === "hi", "hi", parts.join(""));
      await closeServer(server);
    }

    // ---- (d) 200 + text/html ----
    {
      const server = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body>Bad Gateway page</body></html>");
      });
      let err = null;
      await against(server).catch((e) => {
        err = e;
      });
      check("(d) 200 + text/html → reject bad_content_type", err && err.code === "bad_content_type", "bad_content_type", err && err.code);
      check("(d) bad_content_type 不重试", err && err.retriable === false, false, err && err.retriable);
      await closeServer(server);
    }

    // ---- (e) 200 + application/json 整包 ----
    {
      const payload = {
        choices: [{ message: { content: "整包结果" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 5 }
      };
      const server = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      });
      const parts = [];
      let doneCount = 0;
      const r = await against(server, {}, (m) => {
        if (m.delta) parts.push(m.delta);
        if (m.done) doneCount += 1;
      });
      check("(e) 200 整包 JSON → content 作为一次 delta", parts.join("") === "整包结果", "整包结果", parts.join(""));
      check("(e) 整包 JSON 也以 done 收尾（恰 1 次）", doneCount === 1, 1, doneCount);
      check("(e) usage 透传", Boolean(r) && r.usage && r.usage.completion_tokens === 5, 5, r && r.usage && r.usage.completion_tokens);
      await closeServer(server);
    }

    // ---- (f) 401 不被重试 ----
    {
      let hits = 0;
      const server = http.createServer((req, res) => {
        hits += 1;
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Invalid API key sk-abcdef123456" } }));
      });
      let err = null;
      await against(server, { retry: { maxAttempts: 3 } }).catch((e) => {
        err = e;
      });
      check("(f) 401 只发 1 次请求", hits === 1, 1, hits);
      check("(f) 401 code === http 且 status === 401", Boolean(err) && err.code === "http" && err.status === 401, "http/401", err && [err.code, err.status]);
      check("(f) 错误消息里的 Key 形态被脱敏（第 6 步）", Boolean(err) && !/sk-abcdef/.test(err.message), "不含 sk-abcdef", err && err.message);
      await closeServer(server);
    }

    // ---- (g) 503 仍重试 ----
    {
      let hits = 0;
      const server = http.createServer((req, res) => {
        hits += 1;
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end("service unavailable");
      });
      let err = null;
      await against(server, { retry: { maxAttempts: 3 } }).catch((e) => {
        err = e;
      });
      check("(g) 503 收到 3 次请求（重试 2 次）", hits === 3, 3, hits);
      check("(g) 最终以 503 http 错误拒绝", Boolean(err) && err.status === 503, 503, err && err.status);
      await closeServer(server);
    }

    // ---- (h) 有 [DONE] 时 done 恰好 1 次 ----
    {
      const server = http.createServer((req, res) => {
        res.writeHead(200, SSE);
        res.write('data: {"choices":[{"delta":{"content":"A"}}]}\n');
        res.write('data: {"choices":[{"delta":{"content":"B"}}]}\n');
        res.write("data: [DONE]\n");
        res.end(); // [DONE] 之后 end：旧实现会发两次 done
      });
      let doneCount = 0;
      let deltas = "";
      await against(server, {}, (m) => {
        if (m.delta) deltas += m.delta;
        if (m.done) doneCount += 1;
      });
      check("(h) 有 [DONE] 时 done 恰好 1 次", doneCount === 1, 1, doneCount);
      check("(h) 正文完整", deltas === "AB", "AB", deltas);
      await closeServer(server);
    }

    // ---- (i) C-19b：传输层选择 Electron 网络栈（继承系统代理路径的离线判据） ----
    {
      const transport = require(path.join(ROOT, "electron", "aiTransport.js"));
      const uses = transport.usesElectronNet();
      check("(i) app ready 后传输层选择 Electron net.fetch（系统代理路径）", uses === true, true, uses);
      check("(i) pickFetch 返回可调用实现", typeof transport.pickFetch() === "function", "function", typeof transport.pickFetch());
    }
  } catch (e) {
    fail += 1;
    console.log(`  ✗ 场景执行异常：${(e && (e.stack || e.message)) || e}`);
  } finally {
    console.log(`\nai-stream: ${pass} 通过 / ${fail} 失败`);
    try {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      /* 临时目录清理失败不影响结论 */
    }
    app.exit(fail > 0 ? 1 : 0);
  }
});
