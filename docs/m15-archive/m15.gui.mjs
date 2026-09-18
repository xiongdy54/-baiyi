// v47（M15）材料知识导图 GUI 端到端（CDP 驱动真实应用，自启自关；node tests/m15.gui.mjs）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-m15-userdata（先清空），绝不触碰真实库（§7.3）。
// 覆盖（§4.19-2/§4.19-6；管线纯函数与两表由 tests/m15.test.cjs 锁定）：
//   导图按钮入口 → 面板挂载（说明/范围/粒度/预估/目录树）→ 无 Key 可读降级（下一步置灰）
//   → 预置一条导图（结构 + SVG 图示）→ 回看（层级树渲染 + 节点标记 + 就此制卡按钮）→ 清理
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9232";
const USER_DATA = path.join(ROOT, "tests", "tmp-m15-userdata");
const MARK = "M15GUITEST";

let pass = 0;
let fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 240)}`); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let electron = null;

async function listTargets() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  return list.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
}

async function connectTarget(match, label, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const t = (await listTargets()).find((x) => match(x.url || ""));
      if (t) {
        const ws = new globalThis.WebSocket(t.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener("open", res);
          ws.addEventListener("error", rej);
        });
        let id = 0;
        const pending = new Map();
        ws.addEventListener("message", (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        });
        const send = (method, params = {}) =>
          new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
        const evalJS = async (expr) => {
          const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails)
            return "EXC: " + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)).slice(0, 300);
          return r.result?.result?.value;
        };
        return { ws, send, eval: evalJS, url: t.url };
      }
    } catch { /* 端口未就绪 */ }
    await wait(1000);
  }
  throw new Error(`CDP 连接失败：${label}`);
}

function spawnApp() {
  const out = openSync(path.join(ROOT, "tests", "m15.gui.log"), "a");
  return spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: false,
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
}

const clickByText = (sel, text) =>
  `(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.includes(${JSON.stringify(text)})); b?.click(); return !!b; })()`;

const STRUCT = {
  title: `${MARK} 控制论导图`,
  nodes: [
    { id: "n1", label: `${MARK} 负反馈调节`, parentId: null, chapterAnchors: [], evidence: null },
    { id: "n2", label: `${MARK} 恒温器`, parentId: "n1", chapterAnchors: [], evidence: null }
  ],
  rootIds: ["n1"]
};

try {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.rmSync(path.join(ROOT, "tests", "m15.gui.log"), { force: true });
  electron = spawnApp();
  const main = await connectTarget((u) => u.includes("index.html"), "主窗口");
  await wait(2500);

  // 0. 建册（带 # 标题，合成 EPUB 有目录）并打开阅读器
  const created = await main.eval(`(async () => {
    const r = await window.libraryAPI.createFromPaste("${MARK} 控制论入门", "# 第一章 反馈\\n\\n负反馈调节使系统回归稳定。\\n\\n# 第二章 控制\\n\\n控制论把反馈作为核心机制。");
    await window.libraryAPI.readEbookFile === undefined;
    return JSON.stringify(r);
  })()`);
  const book = JSON.parse(created || "{}");
  check("建册成功", !!book.id, created);
  // 书架在建册前已挂载且 createFromPaste 不广播 → 重载页面取到新书
  await main.eval(`location.reload()`);
  await wait(3500);
  await main.eval(clickByText(".nav-item", "书架"));
  await wait(700);
  const opened = await main.eval(`(() => { const c = [...document.querySelectorAll(".book-card")].find((x) => x.title?.includes("${MARK}")); c?.click(); return !!c; })()`);
  check("书架点击打开阅读器", opened === true, opened);
  await wait(3500);

  // 1. 导图按钮入口 + 面板挂载
  const btn = await main.eval(clickByText(".reader-engine-controls button", "导图"));
  check("工具栏含「导图」按钮（目录旁）", btn === true, btn);
  await wait(900);
  const panelState = await main.eval(`JSON.stringify({
    mounted: !!document.querySelector(".mindmap-workspace") && document.body.textContent.includes("材料知识导图"),
    hint: document.body.textContent.includes("作者视角的知识组织"),
    estimate: (document.body.textContent.match(/AI 调用 ≈ \\d+ 次/) || [])[0] || "",
    noKey: document.body.textContent.includes("未配置 AI Key"),
    treeHasChapters: document.body.textContent.includes("第一章 反馈") && document.body.textContent.includes("第二章 控制"),
    granOptions: document.body.textContent.includes("标准（仅一级章节）") && document.body.textContent.includes("深入（全层级）")
  })`);
  const ps = JSON.parse(panelState || "{}");
  check("面板挂载（说明文案在案）", ps.mounted === true && ps.hint === true, panelState);
  check("预估行可见（AI 调用次数）", String(ps.estimate).includes("AI 调用 ≈"), ps.estimate);
  check("无 Key 可读降级提示", ps.noKey === true, ps.noKey);
  check("目录树渲染章节", ps.treeHasChapters === true, ps.treeHasChapters);
  const granOpened = await main.eval(`(() => { const d = document.querySelector('[title*="覆盖粒度"]'); d?.click(); return !!d; })()`);
  await wait(400);
  const granState = await main.eval(`(() => { document.body.click(); return document.body.textContent.includes("标准（仅一级章节）") || true; })()`);
  // Dropdown 关闭态只显示当前值（标题在 title 属性）——打开后逐档断言
  const granOpen2 = await main.eval(`(() => { const d = document.querySelector('[title*="覆盖粒度"]'); d?.click(); return document.body.textContent.includes("标准（仅一级章节）") && document.body.textContent.includes("深入（全层级）"); })()`);
  check("覆盖粒度三档可选（下拉打开后可见档位）", granOpened === true && granOpen2 === true, `opened=${granOpened} labels=${granOpen2}`);
  const sendDisabled = await main.eval(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("下一步")); return b ? b.disabled : null; })()`);
  check("无 Key 时「下一步」置灰（不静默失败）", sendDisabled === true, sendDisabled);

  // 2. 预置一条导图（结构 + 自包含 SVG）→ 回看：层级树 + 节点标记 + 就此制卡按钮
  const seeded = await main.eval(`(async () => {
    const list = await window.mindmapAPI.list({ documentId: "none" });
    const rec = await window.mindmapAPI.save({
      documentId: ${JSON.stringify(book.documentId || "")},
      itemId: ${JSON.stringify(book.id || "")},
      scopeAnchor: "book", scopeKind: "book", granularity: "standard",
      structure: ${JSON.stringify(STRUCT)},
      diagramArtifact: "<svg xmlns='http://www.w3.org/2000/svg' role='img' width='200' height='80'><title>${MARK} 图示</title><rect x='8' y='8' width='184' height='64' fill='none' stroke='#333'/><text x='16' y='44'>${MARK} 图示内容</text></svg>",
      artifactKind: "svg", diagramTypes: ["mindmap"], warnings: [],
      promptScope: "diagram-generation", promptVersion: 1
    });
    return rec ? rec.id : "";
  })()`);
  check("预置导图入库", typeof seeded === "string" && seeded.length > 0, seeded);
  await main.eval(clickByText(".reader-engine-controls button", "正文")); // v47.2：导图视图 → 正文按钮切回
  await wait(500);
  await main.eval(clickByText(".reader-engine-controls button", "导图"));
  await wait(900);
  const openBtn = await main.eval(clickByText("button", "整书 · standard"));
  check("「已生成」列表出现（整书 · standard）", openBtn === true, openBtn);
  await wait(800);
  const viewState = await main.eval(`JSON.stringify({
    svgRendered: !!document.querySelector(".mindmap-artifact-item svg"),
    treeLabel: document.body.textContent.includes("${MARK} 负反馈调节"),
    childNode: document.body.textContent.includes("${MARK} 恒温器"),
    makeBtn: [...document.querySelectorAll("button")].some((x) => x.textContent.includes("就此制卡")),
    regen: [...document.querySelectorAll("button")].some((x) => x.textContent.includes("重新生成"))
  })`);
  const vs = JSON.parse(viewState || "{}");
  check("图示经 DOMPurify 消毒后真实渲染（svg 在场）", vs.svgRendered === true, viewState);
  check("层级树渲染根与子节点", vs.treeLabel === true && vs.childNode === true, viewState);
  check("节点「就此制卡」入口在场（§4.19-6）", vs.makeBtn === true, vs.makeBtn);
  check("重新生成/删除控制在场", vs.regen === true, vs.regen);

  // 3. 节点制卡走既有管线：无 Key → AI 面板可读错误（不静默）
  await main.eval(clickByText("button", "就此制卡"));
  await wait(900);
  const nodeCard = await main.eval(`JSON.stringify({
    panel: document.body.textContent.includes("AI 服务尚未配置") || document.body.textContent.includes("导图节点"),
    mindmapClosed: !document.querySelector(".mindmap-workspace")
  })`);
  const nc = JSON.parse(nodeCard || "{}");
  check("节点制卡触发 AI 面板（无 Key 给可读错误）", nc.panel === true, nodeCard);
  check("面板关闭（回阅读器流程）", nc.mindmapClosed === true || document.body.textContent.includes("导图节点"), nodeCard);

  // 4. 清理（节点制卡已自动返回正文视图；若仍在工作区则切回）
  await main.eval(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "正文"); b?.click(); return !!b; })()`);
  await wait(400);
  const cleaned = await main.eval(`(async () => {
    const maps = await window.mindmapAPI.list({ documentId: ${JSON.stringify(book.documentId || "")} });
    for (const m of maps) await window.mindmapAPI.remove(m.id);
    if (${JSON.stringify(book.id || "")}) await window.libraryAPI.remove(${JSON.stringify(book.id || "")});
    return maps.length;
  })()`);
  check("清理（导图 + 测试书）", cleaned >= 1, cleaned);

  console.log(`\nM15 GUI: ${pass} 通过 / ${fail} 失败`);
} catch (e) {
  fail++;
  console.log("M15 GUI 异常", e);
} finally {
  try { electron?.kill(); } catch { /* 忽略 */ }
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 忽略 */ }
  try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch { /* 忽略 */ }
  process.exit(fail > 0 ? 1 : 0);
}
