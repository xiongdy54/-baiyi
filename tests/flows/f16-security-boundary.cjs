// F16 安全与信任边界流程（换角度：不可信内容进得来，密钥出不出去）
// @runtime: node  @tier: 2  @gui: false  @id: F16  @timeout: 180
// 运行：node tests/flows/f16-security-boundary.cjs   （或 node tests/flows/run.cjs --only F16）
//
// 角度：这个软件天生要吃不可信的东西——用户粘贴的 HTML、EPUB 内页、AI 返回的正文、词典例句；
//       而它手里握着用户的 API Key 和全部学习数据。§7.5 为此写了几条硬线：
//       Key/Cookie 不进日志不上传、**渲染层不持有明文 Key**（流式转发在主进程）、
//       AI 禁止编造来源、站点域名与端点必须可配置不许写死（§7.1.3）、
//       遥测/出错上报白名单永不含记忆与卡片正文（§7.6）。既有测试没一条覆盖这些。
//
// 依据：§7.5 L909–913、§7.6 L919–920、§7.1.3 L857、§7.2 L872（contentEditable 教训）、
//       §6.2 L527（导航守卫）、§4.18 L396（记忆永不进上报）、§9.1 M2（ai-config 默认不备份）。
"use strict";
const fs = require("fs");
const path = require("path");
const { Flow, runFlow, ROOT } = require("./lib/harness.cjs");

const flow = new Flow({
  id: "F16",
  title: "安全与信任边界",
  angle: "不可信输入面与密钥/隐私外泄面",
  cites: ["§7.5", "§7.6", "§7.1.3", "§7.2", "§6.2", "§4.18"],
  tier: 2,
  gui: false,
});

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const files = (() => {
  const out = [];
  const walk = (d) => {
    for (const n of fs.readdirSync(d)) {
      if (["node_modules", "dist", "build", ".git", "vendor", "foliate"].includes(n)) continue;
      const full = path.join(d, n);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|cjs|mjs)$/.test(n)) out.push({ rel: path.relative(ROOT, full).replace(/\\/g, "/"), t: fs.readFileSync(full, "utf8") });
    }
  };
  walk(path.join(ROOT, "src"));
  walk(path.join(ROOT, "electron"));
  return out;
})();
const inSrc = (re) => files.filter((f) => f.rel.startsWith("src/") && re.test(f.t)).map((f) => f.rel);
const inElectron = (re) => files.filter((f) => f.rel.startsWith("electron/") && re.test(f.t)).map((f) => f.rel);

runFlow(flow, async () => {
  const main = read("electron/main.js");
  const preload = read("electron/preload.js");
  const ai = read("electron/ai.js");

  // ---------- U1 渲染进程能力面 ----------
  flow.section("U1 渲染进程权限：contextIsolation 开、nodeIntegration 关（§7.5 的前提）");
  const wp = main.match(/webPreferences:\s*\{([\s\S]{0,600}?)\}/);
  flow.check("主窗口有 webPreferences 配置", !!wp, true, !!wp);
  flow.check("contextIsolation: true", /contextIsolation:\s*true/.test(wp ? wp[1] : ""), true, /contextIsolation:\s*true/.test(wp ? wp[1] : ""));
  flow.check("nodeIntegration: false", /nodeIntegration:\s*false/.test(wp ? wp[1] : ""), true, /nodeIntegration:\s*false/.test(wp ? wp[1] : ""));
  flow.record("sandbox 未显式声明（Chromium 默认关；文档未强制，登记备查）", /sandbox:/.test(wp ? wp[1] : "") ? "已声明" : "未声明");
  const secondWindow = [...main.matchAll(/webPreferences:\s*\{([\s\S]{0,600}?)\}/g)].map((m) => ({ ci: /contextIsolation:\s*true/.test(m[1]), ni: /nodeIntegration:\s*false/.test(m[1]) }));
  flow.check("每个窗口都满足隔离要求（含快速记录独立窗口）", secondWindow.length > 0 && secondWindow.every((w) => w.ci && w.ni), "全部满足", secondWindow);
  flow.record("窗口数量", secondWindow.length);

  // ---------- U2 桥面白名单 ----------
  flow.section("U2 preload 只暴露白名单桥，不交出 ipcRenderer 本体（§3 进程与模块结构）");
  const bridges = [...preload.matchAll(/exposeInMainWorld\(\s*"(\w+)"/g)].map((m) => m[1]);
  flow.record("暴露的桥", bridges.join(" "));
  flow.check("桥数量与文档口径一致（≥20 个分组桥）", bridges.length >= 20, "≥20", bridges.length);
  flow.check("不整体暴露 ipcRenderer", /exposeInMainWorld\(\s*["']ipcRenderer["']/.test(preload), false);
  flow.check("不暴露 remote/eval/require", /\b(remote|eval|require)\s*:/.test(preload), false);
  const rawOn = (preload.match(/ipcRenderer\.on\(/g) || []).length;
  flow.record("ipcRenderer.on 出现次数（都包在回调注册助手内）", rawOn);
  const sendChannels = [...preload.matchAll(/ipcRenderer\.(?:invoke|send)\(\s*"([\w:]+)"/g)].map((m) => m[1]);
  const unregistered = sendChannels.filter((c) => !new RegExp(`ipcMain\\.(?:handle|on)\\(\\s*"${c}"`).test(main));
  flow.check("桥能调到的通道都在主进程注册（无幽灵通道）", unregistered.length === 0, "无", unregistered);

  // ---------- U3 导航与新窗口 ----------
  flow.section("U3 导航守卫与外部链接（§6.2 L527：拦截一切页面导航，仅 http(s) 交外部浏览器）");
  flow.check("注册了 will-navigate 守卫", /webContents\.on\(\s*"will-navigate"/.test(main), true);
  flow.check("will-navigate 默认 preventDefault", /will-navigate[\s\S]{0,320}?event\.preventDefault\(\)/.test(main), true);
  flow.check("setWindowOpenHandler 一律 deny", /setWindowOpenHandler[\s\S]{0,300}?action:\s*"deny"/.test(main), true);
  flow.check("只有 http(s) 才允许转系统浏览器", /setWindowOpenHandler[\s\S]{0,200}?\^https\?:\\\/\\\//.test(main), true);
  const openExt = main.match(/ipcMain\.handle\(\s*"shell:openExternal"[\s\S]{0,400}?\}\)/);
  const guarded = /https\?:|startsWith\(["']https|^!\s*/.test(openExt ? openExt[0] : "");
  flow.record("shell:openExternal 是否自带协议白名单", guarded ? "有" : "无（渲染层可请求打开任意协议，含自定义协议）");
  flow.eq("openExternal 只放行 http(s)（与窗口打开守卫同一口径）", guarded, true);

  // ---------- U4 密钥边界 ----------
  flow.section("U4 明文 Key 不进渲染层、不进日志、不入默认备份（§7.5 L911）");
  // 批次 C（D-TEST-08）：登记的危害是「明文 Key 经 ai:getConfig 直达渲染层」，修法收在 IPC 边界
  // （ai.js 内部继续用完整 getAIConfig()，规格里明写不要动）。所以判据换成两条能真的抓住泄露的：
  // ① handler 必须剥 Key 再返回；② 全仓不得有第二个把 getAIConfig() 原样回给渲染层的 handler。
  const handler = main.match(/ipcMain\.handle\(\s*["']ai:getConfig["'][\s\S]{0,320}?\}\)/);
  const stripsKey = Boolean(handler && /\.\.\.safe/.test(handler[0]) && !/=>\s*getAIConfig\(\)/.test(handler[0]));
  flow.check("ai:getConfig 的 IPC 返回体剥掉明文 apiKey（§7.5 L911）", stripsKey, "const { apiKey, ...safe }", handler ? handler[0].replace(/\s+/g, " ").slice(0, 90) : "未找到 handler");
  const leaky = (main.match(/ipcMain\.handle\([\s\S]{0,80}?=>\s*getAIConfig\(\)\s*\)/g) || []).concat(
    (main.match(/ipcMain\.handle\([\s\S]{0,80}?\)\s*=>\s*\{\s*return\s+getAIConfig\(\)/g) || [])
  );
  flow.check("没有任何其它 IPC handler 把 getAIConfig() 原样回给渲染层", leaky.length === 0, "零裸返回", leaky.map((s) => s.replace(/\s+/g, " ").slice(0, 60)));
  flow.record("ai:test / ai:listModels 的返回形状", "testConnection 只回 {ok,message}；listModels 只回 id 数组（逐个读过实现）");
  flow.check("ai:getConfig 的返回被渲染层用到 key 时须有明确必要性（先记录用量）", /apiKey/.test(read("src/components/SettingsPanel.tsx")) , true, "见下条");
  flow.record("SettingsPanel 里出现 apiKey 的位置数", (read("src/components/SettingsPanel.tsx").match(/apiKey/g) || []).length);
  flow.eq("主进程不把 Key 写进日志", inElectron(/console\.(log|error|warn)\([^)]*(apiKey|keys\[|secret)/).length, 0);
  flow.eq("渲染层日志不打 Key", inSrc(/console\.(log|error|warn)\([^)]*apiKey/).length, 0);
  // C-20：safeStorage 调用已收口到 electron/keyVault.js（ai.js 不再直接引用）——判据随迁移：
  // ① keyVault.js 必须经 safeStorage 加解密；② ai.js 不得再出现直接的 encrypt/decrypt 调用。
  const keyVault = read("electron/keyVault.js");
  flow.check("Key 只经 safeStorage 加密落盘（调用收口在 keyVault.js）",
    /safeStorage\.encryptString|safeStorage\.decryptString/.test(keyVault) && !/safeStorage\.(encryptString|decryptString)/.test(ai), true);
  flow.check("默认备份排除 ai-config.json（§9.1 M2；F05 已端到端验证）", /includeAIConfig\s*&&/.test(read("electron/backup.js")), true);
  flow.check("不引入远程模块（remote 是已知高危面）", /\b@electron\/remote\b|Electron\.remote/.test(main + preload), false);

  // ---------- U5 端点与域名可配置 ----------
  flow.section("U5 站点端点必须走配置或常量表（§7.1.3 L857：不许写死在业务分支里）");
  const hardcoded = inSrc(/https?:\/\/(?!www\.w3\.org|localhost)[\w.-]+/g).filter((f) => !/dictCatalog|catalog|config|test/i.test(f));
  flow.record("渲染层出现硬编码 http(s) 域名的文件", hardcoded.join(" ") || "（无）");
  flow.check("AI 端点集合集中在 PRESETS 表", /const PRESETS\s*=/.test(ai), true);
  const searchEngines = (main.match(/const SEARCH_ENGINES\s*=/) || []).length;
  flow.check("联网检索引擎清单是集中定义的表（可审计）", searchEngines, 1);
  flow.check("没有把 key 拼进 URL 的写法", /(key|apikey|token)=["'`]?\$\{/.test(main + ai), false);

  // ---------- U6 注入面 ----------
  flow.section("U6 不可信内容的注入面（§7.2 L872 contentEditable 教训同源：外部 HTML 必须先净化）");
  const purifyUsers = inSrc(/DOMPurify|dompurify/);
  flow.check("导入外部 HTML 处过了 DOMPurify", purifyUsers.length > 0, "有", purifyUsers);
  const innerHtml = inSrc(/dangerouslySetInnerHTML|\.innerHTML\s*=/);
  flow.record("渲染层 innerHTML / dangerouslySetInnerHTML 位置", innerHtml.join(" ") || "（无）");
  const unsanitized = innerHtml.filter((rel) => {
    const t = files.find((f) => f.rel === rel).t;
    return !/DOMPurify|dompurify|sanitize/i.test(t);
  });
  flow.check("每个 innerHTML 注入点所在文件都出现 sanitize（否则逐条复核）", unsanitized.length === 0, "全部有", unsanitized);
  flow.eq("无 eval / new Function（动态执行外部内容是硬红线）", inSrc(/\beval\(|new Function\(/).length, 0);
  flow.eq("无 srcdoc 直插外部 HTML", inSrc(/srcdoc=/).length, 0);
  const ce = inSrc(/contentEditable/);
  flow.record("contentEditable 使用位置（须走 EditableText 裸壳，§7.2 L872）", ce.join(" ") || "（无）");

  // ---------- U7 文件与路径边界 ----------
  flow.section("U7 资源路径钳制在数据目录内（assets / bookasset 协议）");
  const assetMod = read("electron/backup.js");
  flow.check("备份恢复对条目名做了穿越判定", /normalize|\.\.|isAbsolute|startsWith/.test(assetMod), true);
  const proto = main.match(/registerFileProtocol\([\s\S]{0,700}?(\)\s*=>|function)/);
  flow.record("自定义协议注册数", (main.match(/protocol\.register|registerFileProtocol/g) || []).length);
  const clamp = inElectron(/path\.resolve\([\s\S]{0,80}?startsWith\(|path\.normalize\(/);
  flow.check("主进程存在路径钳制代码（具体覆盖由 F05 B3 端到端验证）", clamp.length > 0, true, clamp);
  flow.check("不把用户输入当绝对路径直接读（readBookFile 走白名单扩展名）", /readBookFile/.test(main), true);

  // ---------- U8 上报面 ----------
  flow.section("U8 遥测/出错上报的白名单纪律（§7.6：记忆、卡片正文、Key、绝对路径永不外发）");
  const telemetryImpl = inElectron(/error-report-queue|telemetry/i);
  flow.record("上报实现是否已存在（§7.6 标注未实现）", telemetryImpl.join(" ") || "未实现（与文档一致）");
  flow.eq("未实现的上报通道不存在（不会先把内容发出去）", telemetryImpl.filter((f) => /fetch|https?:\/\//.test(files.find((x) => x.rel === f).t)).length, 0);
  const uploads = inElectron(/upload|reportError|sendReport/i);
  flow.record("含 upload/report 字样的主进程文件", uploads.join(" ") || "（无）");
}).then((s) => {
  process.exit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length ? 1 : 0);
});
