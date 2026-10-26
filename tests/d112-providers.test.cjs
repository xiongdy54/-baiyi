// D112 AI 供应商注册表扩容 + 本地模型可用性（electron 运行时）
// @runtime: electron  @id: D112PROV  @tier: 2  @gui: false  @timeout: 300
// 运行：npx electron tests/d112-providers.test.cjs
// 覆盖（设计 docs/design/AI-PROVIDER-REGISTRY-D112.md §3）：
//   S0 注册表完整性（15 项 / id 唯一 / group 合法 / 既有 4 项形状不回退 / 元数据零 Key）
//   S1 getAIConfig 附 presets 元数据（渲染层 UI 单一来源）
//   S2 切换预设互不串 Key + 端点/模型重置（deepseek ↔ zai ↔ local 往返）
//   S3 aiConfigUsable 单一判据（本地免 Key；bundle 与 src/lib/ai.ts 同源）
//   S4 listModels 本地 /api/tags 降级 + AI_NO_KEY
//   S5 detectLocalRuntime 命中 / 未命中两态（探针注入，不碰真实端口状态）
// 隔离：userData 指向系统临时目录（f41 同法），绝不触碰真实库与真实 ai-config.json。
"use strict";
const path = require("path");
const http = require("http");
const { app } = require("electron");
const { Flow, runFlow, tmpUserDataDir, freshDir, ROOT } = require("./flows/lib/harness.cjs");
const { quit } = require("./flows/lib/dbenv.cjs");

const flow = new Flow({
  id: "D112PROV",
  title: "AI 供应商注册表 + 本地运行时探测",
  angle: "15 供应商注册表单一来源 / 切换不串 Key / 本地免 Key 判据 / Ollama tags 降级 / 本地探测两态",
  cites: ["§7.4", "§2", "D112"],
  tier: 2,
  gui: false,
});

// ---------- mock 服务夹具 ----------
/** 起一个 127.0.0.1 ephemeral http 服务：按路径返回预置应答；记录收到的请求 */
function makeMock(routes) {
  const hits = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits.push({ path: req.url, auth: req.headers.authorization || "" });
      const route = routes.find((r) => req.url === r.path || (r.prefix && req.url.startsWith(r.prefix)));
      if (!route) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      res.writeHead(route.status || 200, { "Content-Type": "application/json" });
      res.end(typeof route.json === "string" ? route.json : JSON.stringify(route.json));
    });
  });
  const listen = () =>
    new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve(server.address().port));
    });
  return { server, hits, listen };
}

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("d112"));
    app.setPath("userData", dir);
    const ai = require(path.join(ROOT, "electron", "ai.js"));

    const s = await runFlow(flow, async () => {
      // ---------- S0 注册表完整性 ----------
      flow.section("S0 注册表完整性（15 项，v48.68 / D112）");
      flow.guard("ai.js 导出 detectLocalRuntime / PRESETS", () => typeof ai.detectLocalRuntime === "function" && ai.PRESETS && typeof ai.PRESETS === "object");
      const ids = Object.keys(ai.PRESETS);
      flow.eq("注册表 15 项", ids.length, 15);
      flow.eq("id 无重复", new Set(ids).size, ids.length);
      flow.eq(
        "id 全集与顺序 = 设计稿 §2.1 清单（v2：硅基流动置顶）",
        ids,
        ["siliconflow", "goat", "zai", "deepseek", "mimo", "openai", "ark", "grok", "claude", "gemini", "kimi", "qwen", "openrouter", "custom", "local"]
      );
      flow.eq("硅基流动置顶（v48.69 / D113 用户指令）", ids[0], "siliconflow");
      flow.eq("硅基流动 keyUrl = 用户邀请链接（推荐官计划）", ai.PRESETS.siliconflow.keyUrl, "https://cloud.siliconflow.cn/i/AL4iBJ0e");
      flow.eq("kimi keyUrl 已迁移 platform.kimi.com（v48.69）", ai.PRESETS.kimi.keyUrl, "https://platform.kimi.com");
      const validGroups = new Set(["official", "agg", "local", "custom"]);
      flow.check("每项都有 name/hint/group 且 group 合法", ids.every((id) => {
        const p = ai.PRESETS[id];
        return typeof p.name === "string" && p.name.length > 0 && typeof p.hint === "string" && p.hint.length > 0 && validGroups.has(p.group) && p.id === id;
      }), true, ids.map((id) => `${id}:${ai.PRESETS[id].group}`));
      flow.check("除 custom/ark/openrouter 外 baseUrl 非空且为 https（本地除外，http 本机）", ids.every((id) => {
        const p = ai.PRESETS[id];
        if (id === "custom") return p.baseUrl === "";
        if (id === "local") return p.baseUrl.startsWith("http://localhost");
        if (id === "ark" || id === "openrouter") return p.baseUrl.startsWith("https://");
        return p.baseUrl.startsWith("https://") && p.model.length > 0;
      }), true, JSON.stringify(Object.fromEntries(ids.map((id) => [id, ai.PRESETS[id].baseUrl]))));
      // 既有 4 项形状不回退（v10.x 契约）
      flow.eq("goat baseUrl 不回退", ai.PRESETS.goat.baseUrl, "https://api.commandcode.ai/provider/v1");
      flow.eq("zai baseUrl 不回退", ai.PRESETS.zai.baseUrl, "https://open.bigmodel.cn/api/paas/v4");
      flow.eq("local baseUrl 不回退", ai.PRESETS.local.baseUrl, "http://localhost:11434/v1");
      flow.eq("local 默认模型不回退", ai.PRESETS.local.model, "qwen3:8b");
      flow.eq("custom 保持全空可自填", [ai.PRESETS.custom.baseUrl, ai.PRESETS.custom.model].join("|"), "|");

      // ---------- S1 元数据下发 ----------
      flow.section("S1 getAIConfig 附 presets 元数据（零 Key）");
      // D239：getAIConfig 自 C-24 起是 async（keyVault 走 safeStorage 异步 API），这里漏了 await——
      // 取到的是 Promise 的 .presets（undefined）→ 本段崩溃；原先流程退出码恒 0，把崩溃掩盖了。
      const meta = (await ai.getAIConfig()).presets;
      flow.eq("元数据 15 项", meta.length, 15);
      flow.check("元数据字段 = {id,name,baseUrl,model,keyUrl,hint,group}", meta.every((m) => {
        const keys = Object.keys(m).sort().join(",");
        return keys === "baseUrl,group,hint,id,keyUrl,model,name";
      }), true, JSON.stringify(meta[0]));
      flow.check("元数据不含 Key 字段（仅 keyUrl 合法携带 key 字样）", meta.every((m) => Object.keys(m).every((k) => k === "keyUrl" || !/key/i.test(k))), true, JSON.stringify(meta.map((m) => Object.keys(m))));

      // ---------- S2 切换预设不串 Key ----------
      flow.section("S2 切换预设：端点重置 + Key 按服务商留存");
      await ai.setAIConfig({ preset: "deepseek", apiKey: "sk-d112-AAA" });
      let c = await ai.getAIConfig();
      flow.eq("切到 deepseek 端点重置为官方值", c.baseUrl, "https://api.deepseek.com/v1");
      flow.eq("deepseek 模型默认 deepseek-chat", c.model, "deepseek-chat");
      flow.eq("deepseek Key A 生效", c.apiKey, "sk-d112-AAA");
      await ai.setAIConfig({ preset: "zai", apiKey: "sk-d112-BBB" });
      c = await ai.getAIConfig();
      flow.eq("切到 zai 模型重置", c.model, "glm-4.7-flash");
      flow.eq("zai Key B 生效", c.apiKey, "sk-d112-BBB");
      await ai.setAIConfig({ preset: "deepseek" });
      c = await ai.getAIConfig();
      flow.eq("切回 deepseek 自动恢复 Key A（绝不串用别家）", c.apiKey, "sk-d112-AAA");
      await ai.setAIConfig({ preset: "local" });
      c = await ai.getAIConfig();
      flow.eq("切到 local：Key 清空（从未配过）", c.apiKey, "");
      await ai.setAIConfig({ preset: "zai" });
      c = await ai.getAIConfig();
      flow.eq("再切回 zai 仍是 Key B", c.apiKey, "sk-d112-BBB");
      await ai.setAIConfig({ preset: "no-such-vendor" });
      const rejected = await ai.getAIConfig();
      flow.check("未知 preset id 不被接受（守门）", rejected.preset === "zai", true, rejected.preset);

      // ---------- S3 aiConfigUsable（渲染层 bundle 同源） ----------
      flow.section("S3 aiConfigUsable：本地免 Key 单一判据");
      const usable = require(path.join(ROOT, "tests", "d112-ai.bundle.cjs")).aiConfigUsable;
      flow.eq("local 无 Key = 可用", usable({ hasKey: false, preset: "local" }), true);
      flow.eq("goat 无 Key = 不可用", usable({ hasKey: false, preset: "goat" }), false);
      flow.eq("goat 有 Key = 可用", usable({ hasKey: true, preset: "goat" }), true);
      flow.eq("null = 不可用", usable(null), false);

      // ---------- S4 listModels：本地 tags 降级 + AI_NO_KEY ----------
      flow.section("S4 listModels：/v1/models 与 /api/tags 降级");
      const { server: srvModels, hits: hitsModels, listen: listenModels } = makeMock([
        { path: "/v1/models", json: { data: [{ id: "model-b" }, { id: "model-a" }] } }
      ]);
      const portModels = await listenModels();
      await ai.setAIConfig({ preset: "local", baseUrl: `http://127.0.0.1:${portModels}/v1` });
      flow.eq("本地 OpenAI 形状列表（排序）", await ai.listModels(), ["model-a", "model-b"]);
      flow.check("本地调用不带 Authorization", hitsModels.every((h) => h.auth === ""), true, JSON.stringify(hitsModels));

      const { server: srvTags, listen: listenTags } = makeMock([
        { path: "/v1/models", status: 404, json: { error: "nope" } },
        { path: "/api/tags", json: { models: [{ name: "qwen3:8b" }, { name: "llama3:8b" }, { name: "mistral" }] } }
      ]);
      const portTags = await listenTags();
      await ai.setAIConfig({ preset: "local", baseUrl: `http://127.0.0.1:${portTags}/v1` });
      flow.eq("/v1/models 404 → 降级原生 /api/tags", await ai.listModels(), ["llama3:8b", "mistral", "qwen3:8b"]);

      await ai.setAIConfig({ preset: "custom", baseUrl: "http://127.0.0.1:9/v1" });
      let noKeyErr = null;
      try { await ai.listModels(); } catch (e) { noKeyErr = e; }
      flow.check("无 Key 拉列表 → AI_NO_KEY", noKeyErr && noKeyErr.code === "AI_NO_KEY", "AI_NO_KEY", noKeyErr && noKeyErr.code);
      let noKeyChat = null;
      try { await ai.chatStream({ messages: [{ role: "user", content: "hi" }] }, () => {}); } catch (e) { noKeyChat = e; }
      flow.check("无 Key 流式 → AI_NO_KEY", noKeyChat && noKeyChat.code === "AI_NO_KEY", "AI_NO_KEY", noKeyChat && noKeyChat.code);

      // ---------- S5 detectLocalRuntime 两态 ----------
      flow.section("S5 detectLocalRuntime：命中 / 未命中（探针注入）");
      const { server: srvDetect, listen: listenDetect } = makeMock([
        { path: "/v1/models", json: { data: [{ id: "z-ai/glm-5.3-flash" }, { id: "qwen3:8b" }] } }
      ]);
      const portDetect = await listenDetect();
      const hit = await ai.detectLocalRuntime([
        { runtime: "mock", runtimeName: "MockRuntime", baseUrl: `http://127.0.0.1:${portDetect}/v1` }
      ]);
      flow.eq("命中：detected=true", hit.detected, true);
      flow.eq("命中：runtimeName 透传", hit.runtimeName, "MockRuntime");
      flow.eq("命中：baseUrl 透传", hit.baseUrl, `http://127.0.0.1:${portDetect}/v1`);
      flow.eq("命中：模型列表排序返回", hit.models, ["qwen3:8b", "z-ai/glm-5.3-flash"]);

      const dead = await ai.detectLocalRuntime([
        { runtime: "dead", runtimeName: "DeadRuntime", baseUrl: "http://127.0.0.1:1/v1" }
      ]);
      flow.eq("未命中：detected=false（端口 1 拒连）", dead.detected, false);
      flow.check("未命中：给可读指引且不抛错", typeof dead.message === "string" && dead.message.includes("Ollama"), true, dead.message);
      // 真实本机端口探测只记录不判成败（CI / 用户机状态不可控）
      const real = await ai.detectLocalRuntime();
      flow.record("本机真实探测（记录不判）", JSON.stringify({ detected: real.detected, runtime: real.runtime || "-", models: (real.models || []).length }));

      srvModels.close();
      srvTags.close();
      srvDetect.close();
    });

    quit(s.fail > 0 || s.aborted || s.crash ? 1 : 0);
  })
  .catch((e) => {
    console.error("D112 fatal:", e);
    quit(1);
  });
