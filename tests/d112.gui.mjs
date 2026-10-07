// D112 端到端（AI 供应商注册表设置页：15 项分组渲染 / 注册表驱动 / 本地检测两态）
// @runtime: node  @tier: 2  @gui: true  @id: D112GUI  @timeout: 300
// 运行：npm run build 之后 `node tests/d112.gui.mjs`（CDP 驱动 dist 上的真实应用，自启自关）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-d112-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
// 判据（设计 docs/design/AI-PROVIDER-REGISTRY-D112.md §3）：
//   G1 桥面：aiAPI.detectLocal 可用；getConfig.presets 15 项且零 Key
//   G2 设置页 AI 区：四分组小标题 + 15 供应商按钮；主流官方项逐一点名在场
//   G3 切换预设提示语义（Key 按服务商留存的用户可见面）
//   G4 本地预设「检测本地服务」：点击后稳定收敛（检测到 / 未检测到二者其一，不挂死不静默）
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9247";
const USER_DATA = path.join(ROOT, "tests", "tmp-d112-userdata");

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 300)}`); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let electron = null;

async function connect() {
  for (let i = 0; i < 90; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) {
        const ws = new globalThis.WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
        let id = 0;
        const pending = new Map();
        ws.addEventListener("message", (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        });
        const send = (method, params = {}) => new Promise((res) => {
          const mid = ++id; pending.set(mid, res);
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
        const evalJS = async (expr) => {
          const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) return "EXC: " + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)).slice(0, 300);
          return r.result?.result?.value;
        };
        return { ws, send, eval: evalJS };
      }
    } catch { /* 端口未就绪 */ }
    await wait(1000);
  }
  throw new Error("CDP 连接失败");
}

try {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });

  const out = openSync(path.join(ROOT, "tests", "d112.gui.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: false,
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connect();
  await wait(2500);
  check("应用启动", (await cdp.eval(`!!document.querySelector("#root")`)) === true, "未挂载");

  // ---------- G1 桥面：注册表元数据经 ai:getConfig 下发 ----------
  const bridge = JSON.parse(String(await cdp.eval(`(async () => {
    const c = await window.aiAPI.getConfig();
    return JSON.stringify({
      detect: typeof window.aiAPI.detectLocal,
      n: (c.presets || []).length,
      ids: (c.presets || []).map((p) => p.id).join(","),
      keyish: (c.presets || []).some((p) => Object.keys(p).some((k) => k !== "keyUrl" && /key/i.test(k)))
    });
  })()`)));
  check("aiAPI.detectLocal 暴露", bridge.detect === "function", bridge.detect);
  check("presets 元数据 15 项", bridge.n === 15, bridge.n);
  check("presets 含全部新供应商 id", ["deepseek", "mimo", "openai", "ark", "siliconflow", "grok", "claude", "gemini", "kimi", "qwen", "openrouter"].every((x) => bridge.ids.includes(x)), bridge.ids);
  check("presets 元数据零 Key 字段", bridge.keyish === false, bridge.keyish);

  // ---------- 打开设置 → AI 服务 ----------
  await cdp.eval(`(() => { document.querySelector('.topbar-right [title="设置"]')?.click(); return "opened"; })()`);
  await wait(1000);
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".settings-nav button")].find((x) => x.textContent.trim() === "AI 服务"); b?.click(); return "nav"; })()`);
  await wait(600);

  // ---------- G2 分组渲染 ----------
  const groups = JSON.parse(String(await cdp.eval(`(() => JSON.stringify({
    labels: [...document.querySelectorAll(".ai-preset-group-label")].map((x) => x.textContent.trim()),
    buttons: document.querySelectorAll(".ai-preset-group .skin-list button").length,
    names: [...document.querySelectorAll(".ai-preset-name")].map((x) => x.textContent.trim())
  }))()`)));
  check("四分组小标题齐备", JSON.stringify(groups.labels) === JSON.stringify(["官方云服务", "聚合平台", "本地运行时", "通用"]), JSON.stringify(groups.labels));
  check("供应商按钮 15 个", groups.buttons === 15, groups.buttons);
  check("硅基流动排最顶（v48.69 / D113）", groups.names[0] === "硅基流动 SiliconFlow", groups.names[0]);
  check("主流官方供应商逐一点名在场", ["DeepSeek 官方", "小米 MiMo 开放平台", "OpenAI 官方（GPT）", "火山方舟（豆包）", "硅基流动 SiliconFlow", "xAI Grok", "Anthropic Claude", "Google Gemini", "Kimi（月之暗面）", "阿里云百炼（Qwen）", "OpenRouter（多模型聚合）"].every((n) => groups.names.includes(n)), JSON.stringify(groups.names));

  // ---------- G3 切换到 DeepSeek：切换提示语义 ----------
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".ai-preset-name")].find((x) => x.textContent.includes("DeepSeek 官方")); b?.click(); return "clicked"; })()`);
  await wait(800);
  const switched = String(await cdp.eval(`(() => (document.querySelector(".ai-test-ok, .ai-test-fail") || {}).textContent || "")()`));
  check("切换预设出现「已切换服务」提示", switched.includes("已切换服务"), switched);
  const dsState = JSON.parse(String(await cdp.eval(`(async () => { const c = await window.aiAPI.getConfig(); return JSON.stringify({ preset: c.preset, baseUrl: c.baseUrl, model: c.model }); })()`)));
  check("落库 preset=deepseek 且端点为官方值", dsState.preset === "deepseek" && dsState.baseUrl === "https://api.deepseek.com/v1", JSON.stringify(dsState));

  // ---------- G4 本地预设：检测按钮两态收敛 ----------
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".ai-preset-name")].find((x) => x.textContent.includes("本地模型")); b?.click(); return "clicked"; })()`);
  await wait(800);
  const hasDetectBtn = await cdp.eval(`(() => { const bs = [...document.querySelectorAll("#sec-ai button")]; return bs.some((x) => x.textContent.includes("检测本地服务")); })()`);
  check("本地预设出现「检测本地服务」按钮", hasDetectBtn === true, "缺失");
  await cdp.eval(`(() => { const bs = [...document.querySelectorAll("#sec-ai button")]; bs.find((x) => x.textContent.includes("检测本地服务"))?.click(); return "detecting"; })()`);
  let settled = false;
  for (let i = 0; i < 30; i++) {
    await wait(1000);
    const st = String(await cdp.eval(`(() => {
      const btn = [...document.querySelectorAll("#sec-ai button")].find((x) => /检测本地服务|检测中/.test(x.textContent));
      const note = (document.querySelector(".ai-test-ok, .ai-test-fail") || {}).textContent || "";
      return JSON.stringify({ busy: /检测中/.test(btn?.textContent || ""), note });
    })()`));
    const parsed = JSON.parse(st);
    if (!parsed.busy) {
      settled = true;
      check("检测收敛为可读结论（本机有 Ollama 则「检测到」，否则「未检测到」）", parsed.note.includes("检测到") || parsed.note.includes("未检测到"), parsed.note);
      break;
    }
  }
  check("检测流程 30 秒内收敛（不挂死）", settled === true, "超时未收敛");

  // ---------- 收尾：切回默认预设，不留脏配置 ----------
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".ai-preset-name")].find((x) => x.textContent.includes("Command Code GOAT")); b?.click(); return "clicked"; })()`);
  await wait(500);
} catch (e) {
  fail++;
  console.log(`  ✗ 套件异常: ${e && e.stack ? e.stack.split("\n").slice(0, 4).join(" | ") : e}`);
} finally {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 已退出 */ }
}
console.log(`\n== D112 GUI: ${pass} 通过 / ${fail} 失败 ==`);
process.exit(fail > 0 ? 1 : 0);
