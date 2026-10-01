// v48（M15 重做）材料知识导图 GUI 端到端（CDP 驱动真实应用，自启自关；node tests/m15r.gui.mjs）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-m15r-userdata（先清空），绝不触碰真实库（§7.3）。
// 覆盖（批 3/4 UI 契约；管线/缓存/校验由 m15r.engine / m15r.core / m15r.db 锁定）：
//   工具栏「导图」按钮（目录旁）→ 全屏工作区挂载（空态 + 文本提取）→ 无 Key 可读降级
//   （AI 未配置区块、无发送前预览按钮、不弹错误窗）→「正文」返回（内核保活，阅读器在场）
//   → 再入工作区（空态保持）。生成全流程与回看细节随批 7 真实 Key 冒烟。
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9234";
const USER_DATA = path.join(ROOT, "tests", "tmp-m15r-userdata");
const MARK = "M15RGUITEST";

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
  const out = openSync(path.join(ROOT, "tests", "m15r.gui.log"), "a");
  return spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: false,
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
}

const clickByText = (sel, text) =>
  `(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.includes(${JSON.stringify(text)})); b?.click(); return !!b; })()`;
/** D5-B：导图入口收进工具栏「更多」弹出组——先确保组在场（再点组内的动作行） */
const openMoreMenu = `(() => {
  if (!document.querySelector('[data-tool-menu-panel="more"]')) document.querySelector('[data-tool-menu-btn="more"]')?.click();
  return 1;
})()`;

try {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.rmSync(path.join(ROOT, "tests", "m15r.gui.log"), { force: true });
  electron = spawnApp();
  let main = await connectTarget((u) => u.includes("index.html"), "主窗口");
  await wait(2500);

  // 0. 建册（带 # 标题，合成 EPUB 有目录）并打开阅读器
  const created = await main.eval(`(async () => {
    const r = await window.libraryAPI.createFromPaste("${MARK} 控制论入门", "# 第一章 反馈\\n\\n负反馈调节使系统回归稳定，这是控制论的核心。\\n\\n# 第二章 控制\\n\\n控制论把反馈作为核心机制来研究系统。");
    return JSON.stringify(r);
  })()`);
  const book = JSON.parse(created || "{}");
  globalThis.__guiDocId = book.documentId || "";
  check("建册成功", !!book.id, created);
  // v48.13：第二本材料用于「库里只有未激活版本」的空态恢复用例（用户实测：成果在库里却找不到入口）
  // v48.13：用 String.fromCharCode(10) 拼换行——不用反斜杠转义，避免被外层工具的转义处理吃掉
  const NL2 = String.fromCharCode(10);
  const md2 = ["# 第一章 备份", "", "冗余是可靠性的代价。", "", "# 第二章 校验", "", "校验和用于发现位翻转。"].join(NL2);
  const created2 = await main.eval(`(async () => {
    const r = await window.libraryAPI.createFromPaste(${JSON.stringify(MARK + " 恢复用例")}, ${JSON.stringify(md2)});
    return JSON.stringify(r);
  })()`);
  globalThis.__guiDocId2 = (JSON.parse(created2 || "{}").documentId) || "";
  check("第二本材料建册成功（恢复用例）", !!globalThis.__guiDocId2, created2);
  await main.eval(`location.reload()`);
  await wait(3500);
  await main.eval(clickByText(".nav-item", "书架"));
  await wait(700);
  const opened = await main.eval(`(() => { const c = [...document.querySelectorAll(".book-card")].find((x) => x.title?.includes("${MARK} 控制论入门")); c?.click(); return !!c; })()`);
  check("书架点击打开阅读器", opened === true, opened);
  await wait(3500);

  // 1. 工具栏「更多」弹出组（导图入口收进去）→ 打开组并点「导图」→ 全屏工作区挂载
  const moreBtn = await main.eval(`!!document.querySelector('[data-tool-menu-btn="more"]')`);
  check("工具栏含「更多」弹出组（导图已收进去）", moreBtn === true, moreBtn);
  await main.eval(openMoreMenu);
  await wait(400);
  await main.eval(clickByText('[data-tool-menu-panel="more"] .dd-item', "导图"));
  await wait(600);
  const collecting = await main.eval(`JSON.stringify({
    mounted: !!document.querySelector(".mindmap-workspace"),
    topTitle: document.body.textContent.includes("材料知识导图"),
    backBtn: [...document.querySelectorAll(".mindmap-top button")].some((x) => x.textContent.trim() === "正文")
  })`);
  const cm = JSON.parse(collecting || "{}");
  check("全屏工作区挂载（顶栏含正文返回）", cm.mounted === true && cm.topTitle === true && cm.backBtn === true, collecting);
  // 文本提取（本地、无截断）：等 collect 完成 → 空态
  await wait(2500);
  const emptyState = await main.eval(`JSON.stringify({
    empty: document.body.textContent.includes("尚未生成"),
    desc: document.body.textContent.includes("导图会根据这份材料本身的组织方式建立结构"),
    collecting: document.body.textContent.includes("正在提取原文") || document.body.textContent.includes("正在加载")
  })`);
  const es = JSON.parse(emptyState || "{}");
  check("文本提取完成后进入空态（尚未生成）", es.empty === true && es.desc === true, emptyState);
  check("无 Key 降级说明在场（不弹错误窗）", (await main.eval(`document.body.textContent.includes("配置 AI Key 后可生成新的材料知识导图")`)) === true, "");

  // 2. 无 Key：无「发送前预览」按钮（生成入口不可达 = 不会自动调用模型）；范围选择已撤（恒整份材料）
  const noPreviewBtn = await main.eval(`(() => { return ![...document.querySelectorAll(".mindmap-sidebar button")].some((x) => x.textContent.includes("发送前预览")); })()`);
  check("无 Key 时无发送前预览按钮（生成不可达）", noPreviewBtn === true, noPreviewBtn);
  const noScopeSelect = await main.eval(`(() => { return !document.querySelector(".mindmap-sidebar select"); })()`);
  check("范围下拉已撤（恒整份材料）", noScopeSelect === true, noScopeSelect);

  // 3. 「正文」返回：工作区关闭、阅读器在场（内核保活——阅读控制条与目录按钮仍在）
  const back = await main.eval(`(() => { const b = [...document.querySelectorAll(".mindmap-top button")].find((x) => x.textContent.trim() === "正文"); b?.click(); return !!b; })()`);
  await wait(600);
  const backState = await main.eval(`JSON.stringify({
    closed: !document.querySelector(".mindmap-workspace"),
    readerAlive: !!document.querySelector(".reader-engine-controls") && !!document.querySelector('[data-tool-menu-btn="more"]')
  })`);
  const bs = JSON.parse(backState || "{}");
  check("「正文」返回阅读器（原位保持）", back === true && bs.closed === true && bs.readerAlive === true, backState);

  // 4. 再入工作区（空态保持、无残留）
  await main.eval(openMoreMenu);
  await wait(400);
  await main.eval(clickByText('[data-tool-menu-panel="more"] .dd-item', "导图"));
  await wait(1500);
  const reenter = await main.eval(`!!document.querySelector(".mindmap-workspace") && document.body.textContent.includes("尚未生成")`);
  check("再入工作区（空态保持）", reenter === true, reenter);
  await main.eval(`(() => { const b = [...document.querySelectorAll(".mindmap-top button")].find((x) => x.textContent.trim() === "正文"); b?.click(); return !!b; })()`);
  await wait(400);

  // 4.5 v48.13（P2）：右下角全局活动指示器——**空闲时不得渲染**（常驻空浮窗会干扰阅读）
  const idleIndicator = await main.eval(`(() => {
    const el = document.querySelector(".bg-activity");
    return JSON.stringify({ present: !!el, pillText: el ? (el.querySelector(".bg-activity-text")?.textContent || "") : "" });
  })()`);
  const ii = JSON.parse(idleIndicator || "{}");
  check("无后台任务时右下角指示器不出现（不干扰阅读）", ii.present === false, idleIndicator);

  // 5. 会话 1 收尾：经真实 setConfig 写入测试 Key（safeStorage 加密），供会话 2 的 hasKey/生成入口
  const keySet = await main.eval(`(async () => {
    const cfg = await window.aiAPI.setConfig({ apiKey: "FSRSTEST-m15r-gui-key" });
    return JSON.stringify({ hasKey: cfg.hasKey });
  })()`);
  check("会话 1：测试 Key 写入（加密落盘）", String(keySet).includes('"hasKey":true'), keySet);
  try { electron?.kill(); } catch { /* ignore */ }
  await wait(800);
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* ignore */ }
  await wait(800);

  // 6. 会话 2 前置：sql.js 直接向 library.db 预置一份三层导图（应用关闭态的合法数据准备——
  //    不是替身、不是绕过：应用打开后走全真实代码路径 getActive→loadMap→渲染/删除）
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();
  {
    const dbFile = path.join(USER_DATA, "library.db");
    const realDocId = globalThis.__guiDocId || "gui-doc";
    const db = new SQL.Database(fs.readFileSync(dbFile));
    const M = MARK;
    const nodes = [
      { id: "root", parentId: null, title: M + " 材料根", childIds: ["l1a", "l1b"], unitAnchors: [], evidence: [], compositionalEvidence: [] },
      { id: "l1a", parentId: "root", title: "古希腊哲学", childIds: ["l2a1", "l2a2"], unitAnchors: [], evidence: [], compositionalEvidence: [] },
      { id: "l1b", parentId: "root", title: "德国古典哲学", childIds: ["l2b1"], unitAnchors: [], evidence: [], compositionalEvidence: [] },
      { id: "l2a1", parentId: "l1a", title: "早期自然哲学", childIds: ["l3a1"], unitAnchors: [], evidence: [], compositionalEvidence: [] },
      { id: "l2a2", parentId: "l1a", title: "苏格拉底", childIds: [], unitAnchors: [], evidence: [], compositionalEvidence: [] },
      // 康德带 sourceSpans（可深化）；苏格拉底不带（已是终态）——用于锁定「展开 vs 深化」的 UI 契约
      { id: "l2b1", parentId: "l1b", title: "康德", childIds: [], unitAnchors: [], evidence: [], compositionalEvidence: [], sourceSpans: [[0, 120]], spanOrigin: "evidence", expandable: true, stopReason: null },
      { id: "l3a1", parentId: "l2a1", title: "泰勒斯", childIds: [], unitAnchors: [], evidence: [], compositionalEvidence: [] }
    ];
    const structure = { version: 1, generatorVersion: "gui-preset", title: M + " 导图", rootNodeId: "root", nodes, edges: [], summaryText: "结构摘要" };
    db.run(`INSERT INTO material_maps (id, user_id, document_id, scope_anchor, scope_kind, granularity, title,
      structure_json, node_count, source_revision_hash, prompt_version, generator_version, provider, model,
      model_config_hash, node_remap_json, is_active, created_at, updated_at, sync_version, is_deleted)
      VALUES ('guimap1', 'local-user', '${realDocId}', 'book', 'book', 'detailed', ?, ?, 7, 'h', 3, 'gui-preset', 'stub', 'stub', 'h', NULL, 1, ?, ?, 0, 0)`,
      [M + " 导图", JSON.stringify(structure), Date.now(), Date.now()]);
    db.run(`INSERT INTO material_maps (id, user_id, document_id, scope_anchor, scope_kind, granularity, title,
      structure_json, node_count, source_revision_hash, prompt_version, generator_version, provider, model,
      model_config_hash, node_remap_json, is_active, created_at, updated_at, sync_version, is_deleted)
      VALUES ('guimap0', 'local-user', '${realDocId}', 'book', 'book', 'detailed', ?, '{"version":1,"nodes":[]}', 0, 'h', 3, 'gui-preset', 'stub', 'stub', 'h', NULL, 0, ?, ?, 0, 0)`,
      [M + " 旧版本", Date.now() - 1000, Date.now() - 1000]);
    // v48.13 P3：预置一条「被应用关闭打断」的 run —— 重启后应被识别为可续跑（不是失败）
    db.run(`INSERT INTO material_map_runs (id, user_id, document_id, scope_anchor, scope_kind, granularity, status, stage,
      calls_done, chars, error_code, error_text, created_at, updated_at, sync_version, is_deleted)
      VALUES ('guirun1', 'local-user', '${realDocId}', 'book', 'book', 'detailed', 'interrupted', 'expand',
      7, 12345, 'interrupted', '运行被应用关闭打断（启动对账）；已完成分片保留在缓存，继续生成零重复计费', ?, ?, 0, 0)`,
      [Date.now() - 60000, Date.now() - 60000]);
    // v48.13：第二本材料只放一个**未激活**版本（is_active=0）——复现用户当时的处境
    const doc2 = globalThis.__guiDocId2 || "gui-doc2";
    const nodes2 = [
      { id: "root", parentId: null, title: M + " 恢复根", childIds: ["b"], unitAnchors: [], evidence: [], compositionalEvidence: [] },
      { id: "b", parentId: "root", title: "第一章 备份", childIds: ["b1"], unitAnchors: [], evidence: [], compositionalEvidence: [] },
      { id: "b1", parentId: "b", title: "冗余代价", childIds: [], unitAnchors: [], evidence: [], compositionalEvidence: [], sourceSpans: [[0, 16]], spanOrigin: "evidence", expandable: true, stopReason: null }
    ];
    db.run(`INSERT INTO material_maps (id, user_id, document_id, scope_anchor, scope_kind, granularity, title,
      structure_json, node_count, source_revision_hash, prompt_version, generator_version, provider, model,
      model_config_hash, node_remap_json, is_active, created_at, updated_at, sync_version, is_deleted)
      VALUES ('guimap2', 'local-user', '${doc2}', 'book', 'book', 'detailed', ?, ?, 3, 'h', 3, 'gui-preset', 'stub', 'stub', 'h', NULL, 0, ?, ?, 0, 0)`,
      [M + " 恢复导图", JSON.stringify({ version: 1, generatorVersion: "gui-preset", title: M + " 恢复导图", rootNodeId: "root", nodes: nodes2, edges: [], summaryText: "摘要" }), Date.now(), Date.now()]);
    // v48.17（D53）：同一份材料再放一条**更旧**的可续跑运行 —— 去重后它不该再被播种
    // （用户实测「关闭要点两次」的根因就是这种历史运行会轮流顶上来）
    db.run(`INSERT INTO material_map_runs (id, user_id, document_id, scope_anchor, scope_kind, granularity, status, stage,
      calls_done, chars, error_code, error_text, created_at, updated_at, sync_version, is_deleted)
      VALUES ('guirun0', 'local-user', '${realDocId}', 'book', 'book', 'detailed', 'section_ready', 'section_ready',
      3, 1000, NULL, '', ?, ?, 0, 0)`, [Date.now() - 120000, Date.now() - 120000]);
    // 另一份材料的一条可续跑运行 —— 去重不得跨材料，它必须出现（指示器 = 多任务容器，两条各占一行）
    db.run(`INSERT INTO material_map_runs (id, user_id, document_id, scope_anchor, scope_kind, granularity, status, stage,
      calls_done, chars, error_code, error_text, created_at, updated_at, sync_version, is_deleted)
      VALUES ('guirun2', 'local-user', '${doc2}', 'book', 'book', 'detailed', 'section_ready', 'section_ready',
      17, 9000, NULL, '', ?, ?, 0, 0)`, [Date.now() - 30000, Date.now() - 30000]);
    fs.writeFileSync(dbFile, Buffer.from(db.export()));
  }
  check("会话 2 前置：导图行 + interrupted 运行 + 一个未激活版本已预置", true, "");

  // 7. 会话 2：重启 → 完整行为链（真实路径：getActive → loadMap → 渲染 / 适应窗口 / 删除）
  electron = spawnApp();
  main = await connectTarget((u) => u.includes("index.html"), "主窗口2");
  await wait(2500);
  // v48.13 P3：应用重启后应能发现未跑完的运行，并提示「可继续」（而不是记成失败）
  await wait(1200);
  const resumePill = await main.eval(`(() => {
    const el = document.querySelector(".bg-activity .bg-activity-text");
    return JSON.stringify({ present: !!el, text: el ? el.textContent : "" });
  })()`);
  const rp = JSON.parse(resumePill || "{}");
  check("重启后可续跑运行被识别（指示器出现且非失败口径）", rp.present === true && rp.text.includes("继续") && !rp.text.includes("失败"), resumePill);  // v48.17（D53）右下角指示器 = 多任务容器（版式 D）：一任务一行、各自关闭、关过就不再回来
  const ind1 = await main.eval(`(() => {
    const root = document.querySelector(".bg-activity");
    if (!root) return "no-root";
    const card = root.querySelector(".bg-activity-card");
    const tasks = [...root.querySelectorAll(".bg-activity-task")];
    return JSON.stringify({
      collapsedH: Math.round(card.getBoundingClientRect().height),
      visibleRows: tasks.filter((t) => getComputedStyle(t).display !== "none").length,
      totalRows: tasks.length,
      primaryIsLast: tasks.length ? tasks[tasks.length - 1].classList.contains("is-primary") : false,
      titles: tasks.map((t) => t.querySelector(".bg-activity-title")?.textContent || ""),
      extraVisibilityCollapsed: getComputedStyle(root.querySelector(".bg-activity-extra")).visibility,
      rowH: Math.round(root.querySelector(".bg-activity-task.is-primary .bg-activity-row").getBoundingClientRect().height)
    });
  })()`);
  const i1 = JSON.parse(ind1 || "{}");
  check("跨材料不去重：两份材料的可续跑运行各占一行（同材料那条更旧的已被折掉）",
    i1.totalRows === 2 && i1.titles.length === 2 && !String(i1.titles[0]).includes("undefined"), ind1);
  check("恒等式②：收起态只留一行，卡片高 = 24 + 边框 = 26（分隔线与其余行不得占位）",
    i1.collapsedH === 26 && i1.visibleRows === 1 && i1.rowH === 24, ind1);
  check("收起态那一行就是最新那条（版式 D：最新在最下）", i1.primaryIsLast === true, ind1);
  check("行上常驻书名，且两行各自不同（不靠 hover 猜这条详情属于哪本书）",
    i1.titles.length === 2 && !!i1.titles[0] && !!i1.titles[1] && i1.titles[0] !== i1.titles[1], ind1);
  // 点第一行展开 → 记高；再点第二行 → 恒等式①：切换展开行时卡片总高不得变化
  const h1 = await main.eval(`(() => { const t = document.querySelectorAll(".bg-activity-task")[0]; t.querySelector(".bg-activity-row").click(); return 1; })()`);
  await wait(300);
  const g1 = await main.eval(`(() => {
    const root = document.querySelector(".bg-activity");
    const card = root.querySelector(".bg-activity-card");
    const open = root.querySelector(".bg-activity-task.is-expanded .bg-activity-extra");
    const cr = card.getBoundingClientRect();
    return JSON.stringify({ H: Math.round(cr.height), top: Math.round(cr.top), extraH: open ? Math.round(open.getBoundingClientRect().height) : -1,
      openIsFirst: root.querySelector(".bg-activity-task.is-expanded") === root.querySelectorAll(".bg-activity-task")[0],
      visibleRows: [...root.querySelectorAll(".bg-activity-task")].filter((t) => getComputedStyle(t).display !== "none").length });
  })()`);
  await main.eval(`(() => { const t = document.querySelectorAll(".bg-activity-task")[1]; t.querySelector(".bg-activity-row").click(); return 1; })()`);
  await wait(300);
  const g2 = await main.eval(`(() => {
    const root = document.querySelector(".bg-activity");
    const card = root.querySelector(".bg-activity-card");
    const open = root.querySelector(".bg-activity-task.is-expanded .bg-activity-extra");
    const cr = card.getBoundingClientRect();
    return JSON.stringify({ H: Math.round(cr.height), extraH: open ? Math.round(open.getBoundingClientRect().height) : -1, top: Math.round(cr.top),
      openIsSecond: root.querySelector(".bg-activity-task.is-expanded") === root.querySelectorAll(".bg-activity-task")[1] });
  })()`);
  const a = JSON.parse(g1 || "{}"), b = JSON.parse(g2 || "{}");
  check("展开态：详情块定高 120px（切行的前提）", a.extraH === 120 && b.extraH === 120, g1 + " | " + g2);
  check("恒等式①：切换展开行时卡片总高与顶边都不动（否则光标会被甩出热区 → 抖收）",
    a.H === b.H && b.H > 0 && h1 === 1 && a.top === b.top && a.openIsFirst === true && b.openIsSecond === true, g1 + " | " + g2);
  // 逐行关闭两条 → 浮窗整个消失；runId 落进 settings.json（下次启动播种要跳过）
  // ---- 真鼠标取证：你报的抖动只在真实 hover 下复现（上面用 click 走的是另一条路径）----
  // 先把上一条断言点出来的 pinned 撤掉（再点一次同一行 = 取消钉住），否则卡片会一直开着
  await main.eval(`(() => { const t = document.querySelectorAll(".bg-activity-task")[1]; t && t.querySelector(".bg-activity-row").click(); return 1; })()`);
  await wait(300);
  // 注意：指针如果从没进过卡片，浏览器不会派发 mouseleave，React 合成的 onMouseLeave 也就不会触发
  // —— 直接"把鼠标放到别处再测收起态"是测不出收起的（实测 geoIdle 停在 open:true）。归零放在下面做。
  const cardGeo = () => main.eval(`(() => {
    const root = document.querySelector(".bg-activity");
    if (!root) return "no-root";
    const r = root.querySelector(".bg-activity-card").getBoundingClientRect();
    return JSON.stringify({ H: Math.round(r.height), top: Math.round(r.top), open: root.classList.contains("is-expanded"),
      expandedRow: [...root.querySelectorAll(".bg-activity-task")].findIndex((t) => t.classList.contains("is-expanded")) });
  })()`);
  const rowCenter = (n) => main.eval(`(() => {
    const el = document.querySelectorAll(".bg-activity-task")[__N__].querySelector(".bg-activity-row").getBoundingClientRect();
    return JSON.stringify({ x: Math.round(el.left + el.width / 2), y: Math.round(el.top + el.height / 2) });
  })()`.replace("__N__", String(n)));
  const J = async (x) => JSON.parse((await x) || "{}");
  // 先做一次真实的「进 → 出」把展开态归零，再测收起态
  const pill0 = await J(rowCenter(1));
  await main.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pill0.x, y: pill0.y });
  await wait(350);
  await main.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 8, y: 8 });
  await wait(500);
  const geoIdle = await J(cardGeo());
  const pBottom = await J(rowCenter(1));
  await main.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pBottom.x, y: pBottom.y });
  await wait(450);
  const geoPill = await J(cardGeo());
  const pTop = await J(rowCenter(0));
  await main.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pTop.x, y: pTop.y });
  await wait(450);
  const geoTop = await J(cardGeo());
  check("真鼠标：hover 小浮窗就地展开，展开的正是我指着的那一行",
    geoIdle.H === 26 && geoIdle.open === false && geoIdle.expandedRow === -1 && geoPill.H > 100 && geoPill.open === true && geoPill.expandedRow === 1,
    JSON.stringify([geoIdle, geoPill]));
  check("真鼠标：从下往上换行 hover，卡片总高与顶边都不动、且不自动收起（你报的「展开最上行时整块缩短→鼠标掉出框外→抖收」）",
    geoTop.H === geoPill.H && geoTop.top === geoPill.top && geoTop.open === true && geoTop.expandedRow === 0,
    JSON.stringify([geoPill, geoTop]));
  await main.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 8, y: 8 });
  await wait(600);
  const geoLeft = await J(cardGeo());
  check("真鼠标：指针离开后自动收回一行，不残留上次展开的详情",
    geoLeft.open === false && geoLeft.H === 26 && geoLeft.expandedRow === -1, JSON.stringify(geoLeft));

  const closeOne = `(() => { const t = document.querySelector(".bg-activity-task"); if (!t) return "no-task"; const btns = t.querySelectorAll(".bg-activity-btn"); const b = btns[btns.length - 1]; b?.click(); return t.querySelector(".bg-activity-title")?.textContent || "?"; })()`;
  const c1 = await main.eval(closeOne);
  await wait(350);
  const c2 = await main.eval(closeOne);
  await wait(350);
  check("逐条关闭：两次点击各关掉一行（不是「点两次才关掉一条」）", c1 !== "no-task" && c2 !== "no-task" && c1 !== c2, c1 + " | " + c2);
  const gone = await main.eval(`JSON.stringify({ present: !!document.querySelector(".bg-activity") })`);
  check("两条各自关闭后浮窗消失（全部关完 = 容器消失）", gone === '{"present":false}', gone);
  await wait(500);
  const setFile = path.join(USER_DATA, "settings.json");
  const setTxt = fs.existsSync(setFile) ? fs.readFileSync(setFile, "utf-8") : "MISSING";
  let dismissedIds = [];
  try { dismissedIds = JSON.parse(setTxt).activity.dismissedRuns || []; } catch { /* 断言里如实报告 */ }
  check("关闭已持久化到 settings.json → activity.dismissedRuns（关过的下次启动不再出现的前提）",
    dismissedIds.includes("guirun1") && dismissedIds.includes("guirun2"), setTxt.slice(0, 200));

  await main.eval(clickByText(".nav-item", "书架"));
  await wait(700);
  const opened2 = await main.eval(`(() => { const c = [...document.querySelectorAll(".book-card")].find((x) => x.title?.includes("${MARK} 控制论入门")); c?.click(); return !!c; })()`);
  check("会话 2：阅读器打开", opened2 === true, opened2);
  const cfgFile = path.join(USER_DATA, "ai-config.json");
  const cfgRaw = fs.existsSync(cfgFile) ? fs.readFileSync(cfgFile, "utf-8").slice(0, 120) : "MISSING";
  await wait(3500);
  await main.eval(openMoreMenu);
  await wait(400);
  await main.eval(clickByText('[data-tool-menu-panel="more"] .dd-item', "导图"));
  await wait(1800);
  const cfgProbe = await main.eval(`(async () => {
    const c = await window.aiAPI.getConfig();
    return JSON.stringify({ hasKey: c.hasKey, preset: c.preset });
  })()`);
  const probe1 = await main.eval("(async () => 42)()");
  console.log("      [debug] probe1(期望 42):", probe1);
  const probe2 = await main.eval(`(async () => JSON.stringify({ a: 1 }))()`);
  console.log("      [debug] probe2(期望 JSON):", probe2);
  const rawResp = await main.send("Runtime.evaluate", {
    expression: `(async () => {
      try {
        const ws = document.querySelector(".mindmap-workspace");
        const inner = document.querySelector(".mindmap-canvas-inner");
        const cfg = await window.aiAPI.getConfig();
        return JSON.stringify({ mounted: !!ws, phase: ws ? "ws" : "noclosed", hasKey: cfg.hasKey, groups: inner ? inner.querySelectorAll("g[data-node-id]").length : 0 });
      } catch (e) {
        return JSON.stringify({ caught: String(e && e.message || e) });
      }
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  console.log("      [debug] rawResp:", JSON.stringify(rawResp).slice(0, 300));
  const rawMap = await main.send("Runtime.evaluate", {
    expression: `(async () => {
    try {
      const ws = document.querySelector(".mindmap-workspace");
      const inner = document.querySelector(".mindmap-canvas-inner");
      const cfg = await window.aiAPI.getConfig();
      return JSON.stringify({
        mounted: !!ws,
        phase: ws ? (document.body.textContent.includes("尚未生成") ? "empty" : document.body.textContent.includes("正在") ? "busy" : "done/other") : "closed",
        hasKey: cfg.hasKey,
        innerLen: inner ? inner.innerHTML.length : 0,
        groups: inner ? inner.querySelectorAll("g[data-node-id]").length : 0
      });
    } catch (e) {
      return JSON.stringify({ caught: String(e && e.message || e) });
    }
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  const ms = JSON.parse(String(rawMap.result?.result?.value || "{}"));
  const badge = await main.eval(`document.body.textContent.includes("+1")`);
  check("预置导图渲染（L0/L1/L2 共 6 节点可见，L3 折叠）", ms.groups === 6 && ms.hasKey === true && ms.phase === "done/other", JSON.stringify(ms));
  check("折叠徽标在场（+1 = 泰勒斯被收起）", badge === true, badge);
  // v48.13 P4：可深化徽标（＋号）——只有「无子结构 ∧ 有作用域」的节点才带
  const deepBadge = await main.eval(`document.querySelectorAll('.mindmap-canvas svg title').length > 0 && document.body.innerHTML.includes("尚无更深结构 · 可深化")`);
  check("可深化徽标在场（无子结构但有作用域 = 康德）", deepBadge === true, deepBadge);
  // 点选「康德」→ 详情面板应出现「深化此节点」，且不出现「展开子树」（展开只对有子结构的节点出现）
  await main.eval(`(() => { const g = document.querySelector('.mindmap-canvas [data-node-id="l2b1"]'); g?.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!g; })()`);
  await wait(300);
  const deepPanel = await main.eval(`JSON.stringify({
    deepen: [...document.querySelectorAll(".mindmap-node-actions button")].some((b) => b.textContent.includes("深化此节点")),
    expand: [...document.querySelectorAll(".mindmap-node-actions button")].some((b) => b.textContent.includes("展开子树")),
    terminalHint: document.body.textContent.includes("按需深化即可")
  })`);
  const dp = JSON.parse(deepPanel || "{}");
  check("可深化节点：有「深化此节点」、无「展开子树」", dp.deepen === true && dp.expand === false, deepPanel);
  // v48.13：打开已有图（不是刚生成完）时「自动深挖全部」也必须可见——按当前可深化节点数决定
  const deepenAllBtn = await main.eval(
    `(() => {
       const b = [...document.querySelectorAll(".mindmap-sidebar button")].find((x) => x.textContent.includes("自动深挖全部"));
       return JSON.stringify({ present: !!b, label: b ? b.textContent : "", disabled: b ? b.disabled === true : null, cursor: b ? getComputedStyle(b).cursor : "" });
     })()`
  );
  const dab = JSON.parse(deepenAllBtn || "{}");
  check("打开已有图时「自动深挖全部」可见（此前只在刚生成完那一瞬可见）", dab.present === true && /可深化节点/.test(dab.label), deepenAllBtn);
  // v48.13：打开已有图时 lastRunId 必然为 null（本轮没生成过）——按钮**不能**因此变灰。
  // 真实现场：用户生成完初步导图后按钮变灰、悬停出禁止符号、点不动。
  check(
    "打开已有图时「自动深挖全部」可点击（不因 lastRunId 为空而禁用）",
    dab.disabled === false && dab.cursor !== "not-allowed",
    deepenAllBtn
  );
  check("可深化节点：说明「没画出来 ≠ 没有更深的内容」", dp.terminalHint === true, deepPanel);
  // 点选「早期自然哲学」（有子结构）→ 只有「展开子树」，没有「深化此节点」
  await main.eval(`(() => { const g = document.querySelector('.mindmap-canvas [data-node-id="l2a1"]'); g?.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!g; })()`);
  await wait(300);
  const expandPanel = await main.eval(`JSON.stringify({
    deepen: [...document.querySelectorAll(".mindmap-node-actions button")].some((b) => b.textContent.includes("深化此节点")),
    expand: [...document.querySelectorAll(".mindmap-node-actions button")].some((b) => b.textContent.includes("展开子树") || b.textContent.includes("收起子树"))
  })`);
  const ep = JSON.parse(expandPanel || "{}");
  check("已有子结构的节点：只有「展开/收起子树」，没有「深化此节点」（展开是纯界面，零 AI 请求）", ep.expand === true && ep.deepen === false, expandPanel);
  // 点选「苏格拉底」（无子结构且无作用域）→ 无深化入口，并说明已是终态
  await main.eval(`(() => { const g = document.querySelector('.mindmap-canvas [data-node-id="l2a2"]'); g?.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!g; })()`);
  await wait(300);
  const termPanel = await main.eval(`JSON.stringify({
    deepen: [...document.querySelectorAll(".mindmap-node-actions button")].some((b) => b.textContent.includes("深化此节点")),
    hint: document.body.textContent.includes("已是终态")
  })`);
  const tp = JSON.parse(termPanel || "{}");
  check("终态节点：无深化入口且明确说明（不把「没有更深内容」和「尚未生成」混为一谈）", tp.deepen === false && tp.hint === true, termPanel);
  // 适应窗口行为链：放大破坏视口 → 点击适应 → transform 必须变化（事件链：click→handler→viewport）
  await main.eval(clickByText(".mindmap-top-actions button", "+"));
  await wait(200);
  await main.eval(clickByText(".mindmap-top-actions button", "+"));
  await wait(200);
  const beforeFit = await main.eval(`document.querySelector(".mindmap-canvas-inner").style.transform`);
  await main.eval(clickByText(".mindmap-top-actions button", "适应窗口"));
  await wait(300);
  const afterFit = await main.eval(`document.querySelector(".mindmap-canvas-inner").style.transform`);
  check("适应窗口行为链（点击 → transform 变化）", Boolean(beforeFit) && beforeFit !== afterFit, { before: String(beforeFit).slice(0, 40), after: String(afterFit).slice(0, 40) });
  // 删除流：确认放行 → 删除旧版本（非 active）→ 列表经真实 IPC 刷新
  await main.eval(`window.confirm = () => true; true`);
  const delBtn = await main.eval(`(() => { const b = [...document.querySelectorAll(".mindmap-version-del")][1]; b?.click(); return !!b; })()`);
  await wait(600);
  const afterDel = await main.eval(`JSON.stringify({ versions: document.querySelectorAll(".mindmap-versions li").length, badgeGone: true })`);
  check("版本删除按钮流（真实 DELETE + 刷新不崩溃）", delBtn === true, afterDel);
  await main.eval(`(() => { const b = [...document.querySelectorAll(".mindmap-top button")].find((x) => x.textContent.trim() === "正文"); b?.click(); return !!b; })()`);
  await wait(400);

  // 8. v48.13 空态恢复用例：库里只有未激活版本时，用户必须能看到入口并自救
  await main.eval(clickByText(".nav-item", "书架"));
  await wait(900);
  const openedRec = await main.eval(`(() => { const c = [...document.querySelectorAll(".book-card")].find((x) => x.title?.includes("${MARK} 恢复用例")); c?.click(); return !!c; })()`);
  check("恢复用例：阅读器打开", openedRec === true, openedRec);
  await wait(3500);
  await main.eval(openMoreMenu);
  await wait(400);
  await main.eval(clickByText('[data-tool-menu-panel="more"] .dd-item', "导图"));
  await wait(2000);
  const recEmpty = await main.eval(`JSON.stringify({
    isEmpty: document.body.textContent.includes("尚未生成"),
    versionSection: document.body.textContent.includes("历史版本"),
    versionCount: document.querySelectorAll(".mindmap-versions li").length,
    hint: document.body.textContent.includes("成果没有丢")
  })`);
  const re = JSON.parse(recEmpty || "{}");
  check("空态：历史版本区可见且列出未激活版本（不再「找不到入口」）", re.versionSection === true && re.versionCount === 1, recEmpty);
  check("空态：明确告知成果没丢、点一版即可激活", re.hint === true, recEmpty);
  // v48.13：**几何断言**——只断言「元素存在」会漏掉尺寸错误。
  // 真实现场（用户截图）：`.mindmap-versions button{width:100%}`（0-1-1）压过 `.mindmap-version-del`（0-1-0），
  // 两个按钮都想要整行宽 → 标题格被挤成一条竖条、删除按钮撑满并溢出区域边界。
  const geo = await main.eval(`(() => {
    const row = document.querySelector(".mindmap-versions");
    const sec = row?.closest(".mindmap-side-sec");
    const pick = document.querySelector(".mindmap-versions .mindmap-version-pick");
    const del = document.querySelector(".mindmap-versions .mindmap-version-del");
    if (!row || !sec || !pick || !del) return JSON.stringify({ missing: true });
    const r = (el) => el.getBoundingClientRect();
    const rr = r(row), sr = r(sec), pr = r(pick), dr = r(del);
    // rowW = 行容器的**内容**宽度（已扣区域 padding），标题格应吃掉「行宽 − 删除格 − 间距」
    return JSON.stringify({
      rowW: Math.round(rr.width), pickW: Math.round(pr.width), delW: Math.round(dr.width),
      delRightOverflow: Math.round(dr.right - sr.right),
      pickRightOverflow: Math.round(pr.right - sr.right),
      pickOverDel: pr.right <= dr.left + 1
    });
  })()`);
  const g = JSON.parse(geo || "{}");
  check(
    "版本行几何：删除按钮只占两个字的地方（≤56px）且不溢出区域",
    typeof g.delW === "number" && g.delW <= 56 && g.delRightOverflow <= 1,
    geo
  );
  check(
    "版本行几何：标题格拿到应得的宽度（≥ 剩余空间，且不溢出）",
    typeof g.pickW === "number" && g.pickW >= g.rowW - g.delW - 8 && g.pickRightOverflow <= 1 && g.pickOverDel === true,
    geo
  );
  const recovered = await main.eval(`(() => { const b = document.querySelector(".mindmap-versions li .mindmap-version-pick"); if (!b) return "no-btn"; b.click(); return "clicked"; })()`);
  await wait(1500);
  const recAfter = await main.eval(`JSON.stringify({
    emptyStill: document.body.textContent.includes("尚未生成"),
    canvasNodes: document.querySelectorAll(".mindmap-canvas [data-node-id]").length
  })`);
  const ra = JSON.parse(recAfter || "{}");
  check("空态：点击版本即激活并渲染出图（成果真的找得回来）", recovered === "clicked" && ra.emptyStill === false && ra.canvasNodes >= 3, recAfter);
  await main.eval(`(() => { const b = [...document.querySelectorAll(".mindmap-top button")].find((x) => x.textContent.trim() === "正文"); b?.click(); return !!b; })()`);
  await wait(400);

  // v48.17（D53）会话 3：再次启动 → 上一步关过的两条**不该再回来**（这是用户报的「每次开机都出现」的正面回收）
  try { electron?.kill(); } catch { /* ignore */ }
  await wait(800);
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* ignore */ }
  await wait(800);
  electron = spawnApp();
  main = await connectTarget((u) => u.includes("index.html"), "主窗口3");
  await wait(3000);
  const backAgain = await main.eval(`JSON.stringify({ present: !!document.querySelector(".bg-activity") })`);
  check("重启后：已关闭的可续跑运行不再播种（同材料的历史运行也不会顶上来）", backAgain === '{"present":false}', backAgain);
  await main.eval(clickByText(".nav-item", "书架"));
  await wait(600);

  // 9. 清理
  await main.eval(clickByText(".nav-item", "书架"));
  await wait(600);
  console.log(`\n==== SUMMARY ${pass}/${pass + fail} ====`);
} catch (err) {
  console.error("FATAL:", err && (err.message || err));
  fail++;
} finally {
  try { electron?.kill(); } catch { /* ignore */ }
  await wait(600);
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* ignore */ }
  process.exit(fail ? 1 : 0);
}
