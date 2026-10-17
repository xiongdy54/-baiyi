// @runtime: node
// 材料导图 v2 · ai.js 最小改动回归（node tests/m15v2.ai.test.cjs）。依据 IMPL-PLAN §4.3 / §6 T4 ①：
// stub electron + 本地 http SSE 假服务；断言 ① 不传新参数→请求体与旧实现逐字节一致；
// ② model 覆盖生效，reasoning_effort 按覆盖模型判定（仅 GLM-5.2+）；③ maxTokens 有限正数→max_tokens；非法值不出现。
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const Module = require("module");

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "").slice(0, 600)}`); }
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "m15v2-ai-"));
const electronStub = {
  app: { getPath: () => userData },
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: { isEncryptionAvailable: () => false, decryptString: () => "", encryptString: (s) => Buffer.from(String(s)) },
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron") return electronStub;
  return origLoad.call(this, request, parent, isMain);
};
const ai = require(path.join(__dirname, "..", "electron", "ai.js"));

const captured = [];
const server = http.createServer((req, res) => {
  let buf = "";
  req.on("data", (c) => (buf += c));
  req.on("end", () => {
    captured.push({ url: req.url, raw: buf, length: req.headers["content-length"] });
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write('data: {"choices":[{"delta":{"content":"好"}}]}\n\n');
    res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\n');
    res.end("data: [DONE]\n\n");
  });
});

function writeCfg(model, reasoningEffort, port) {
  fs.writeFileSync(
    path.join(userData, "ai-config.json"),
    JSON.stringify({ preset: "local", baseUrl: `http://127.0.0.1:${port}/v1`, model, reasoningEffort, apiKeyEnc: null, keys: {} })
  );
}
async function call(extra) {
  const before = captured.length;
  const got = [];
  const messages = [{ role: "system", content: "S" }, { role: "user", content: "U" }];
  const r = await ai.chatStream(Object.assign({ messages, temperature: 0.3 }, extra || {}), (m) => got.push(m));
  return { raw: captured[before].raw, length: captured[before].length, r, got, messages };
}

async function main() {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const messages = [{ role: "system", content: "S" }, { role: "user", content: "U" }];

  console.log("---- 不传新参数：请求体与旧实现逐字节一致 ----");
  writeCfg("Qwen/Qwen2.5-7B-Instruct", "low", port);
  {
    // 旧实现（改动前）的请求体：键序 model, messages, temperature, stream, stream_options；非 GLM-5.2+ 无 reasoning_effort
    const legacy = JSON.stringify({ model: "Qwen/Qwen2.5-7B-Instruct", messages, temperature: 0.3, stream: true, stream_options: { include_usage: true } });
    const { raw, length, got } = await call();
    check("非 GLM：body 与旧实现逐字节一致", raw === legacy, { raw, legacy });
    check("Content-Length 与字节数一致", Number(length) === Buffer.byteLength(raw), length);
    check("无 max_tokens / reasoning_effort", !raw.includes("max_tokens") && !raw.includes("reasoning_effort"), raw);
    check("流式 delta 与 done 照常回调", got.some((m) => m.delta === "好") && got.some((m) => m.done), got);
    const { raw: raw2 } = await call({ model: "", maxTokens: undefined });
    check("空串 model / undefined maxTokens ≡ 不传", raw2 === legacy, raw2);
    const { raw: raw3 } = await call({ model: "   " });
    check("纯空白 model 回落全局模型", raw3 === legacy, raw3);
  }
  writeCfg("z-ai/glm-5.3-flash", "high", port);
  {
    const legacy = JSON.stringify({ model: "z-ai/glm-5.3-flash", messages, temperature: 0.3, stream: true, stream_options: { include_usage: true }, reasoning_effort: "high" });
    const { raw } = await call();
    check("GLM-5.3 全局模型：body 与旧实现逐字节一致（含 reasoning_effort）", raw === legacy, { raw, legacy });
  }

  console.log("---- model 覆盖 / reasoning_effort 按覆盖模型判定 ----");
  writeCfg("z-ai/glm-5.3-flash", "high", port);
  {
    const { raw } = await call({ model: "deepseek-ai/DeepSeek-V4.1-Flash" });
    const b = JSON.parse(raw);
    check("全局 GLM-5.3 + 覆盖非 GLM：body.model 为覆盖模型", b.model === "deepseek-ai/DeepSeek-V4.1-Flash", b);
    check("全局 GLM-5.3 + 覆盖非 GLM：不带 reasoning_effort", !("reasoning_effort" in b), b);
    const { raw: rawT } = await call({ model: "  deepseek-ai/DeepSeek-V4.1-Flash  " });
    check("覆盖模型名前后空白被 trim 后发出", JSON.parse(rawT).model === "deepseek-ai/DeepSeek-V4.1-Flash", rawT);
  }
  writeCfg("Qwen/Qwen2.5-7B-Instruct", "max", port);
  {
    const { raw } = await call({ model: "zai-org/GLM-5.2" });
    const b = JSON.parse(raw);
    check("全局非 GLM + 覆盖 GLM-5.2：带 reasoning_effort（取全局配置值 max）", b.model === "zai-org/GLM-5.2" && b.reasoning_effort === "max", b);
    const { raw: r2 } = await call({ model: "glm-4.7-flash" });
    check("覆盖 GLM-4.7（<5.2）：不带 reasoning_effort", !("reasoning_effort" in JSON.parse(r2)), r2);
  }

  console.log("---- maxTokens ----");
  writeCfg("Qwen/Qwen2.5-7B-Instruct", "low", port);
  {
    const b1 = JSON.parse((await call({ maxTokens: 3000 })).raw);
    check("maxTokens=3000 → max_tokens=3000", b1.max_tokens === 3000, b1);
    const b2 = JSON.parse((await call({ maxTokens: 1500.9 })).raw);
    check("maxTokens=1500.9 → floor 1500", b2.max_tokens === 1500, b2);
    for (const bad of [0, -5, NaN, Infinity, "100", null]) {
      const b = JSON.parse((await call({ maxTokens: bad })).raw);
      check(`maxTokens=${String(bad)} 不写 max_tokens`, !("max_tokens" in b), b);
    }
    const raw = (await call({ maxTokens: 800, model: "m-x" })).raw;
    check("键序：…stream_options 之后追加 max_tokens", Object.keys(JSON.parse(raw)).join(",") === "model,messages,temperature,stream,stream_options,max_tokens", raw);
  }

  server.close();
  Module._load = origLoad;
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* 清理失败无妨 */ }
  console.log(`\n==== SUMMARY ${pass}/${pass + fail} ====`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
