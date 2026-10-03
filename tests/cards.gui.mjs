// D80 卡片页端到端：老卡（context_ref_json=NULL）上 3 段 Ctrl 划选摘录 → 恒挂当前卡落库 →
// 卡片页「摘录」签可见 → 点行开摘录详情模态（v48.40 / D80，设计稿 docs/design/CARD-BROWSER-REDESIGN.md）
// @runtime: node  @tier: 2  @gui: true  @id: CARDS  @timeout: 300
// 运行：npm run build 之后 `node tests/cards.gui.mjs`（CDP 驱动 dist 上的真实应用，自启自关、可 taskkill electron）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-cards-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9234";
const USER_DATA = path.join(ROOT, "tests", "tmp-cards-userdata");
const SEG1 = "老卡甲样本";
const SEG2 = "老卡乙样本";
const SEG3 = "老卡丙样本";
const JOINED = `${SEG1}\n\n${SEG2}\n\n${SEG3}`;

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

const KEY_MOD = { ctrl: 2 };

try {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  // 播种：老摘录卡（context_ref_json=NULL，当日到期）
  const seeded = execSync("npx electron tests/cards.gui.seed.cjs", {
    cwd: ROOT, shell: true, encoding: "utf8",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const legacyId = /SEEDED ([0-9a-f-]{36})/.exec(String(seeded))?.[1] ?? "";
  check("老卡播种成功（拿到 id）", legacyId.length === 36, seeded.slice(-200));

  const out = openSync(path.join(ROOT, "tests", "cards.gui.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: false,
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connect();
  await wait(2500);
  check("应用启动（根节点挂载）", (await cdp.eval(`!!document.querySelector("#root")`)) === true, "未挂载");

  // 1) 摘录页：老卡进会话
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "摘录"); b?.click(); return "nav"; })()`);
  await wait(2200);
  check("摘录页卡面在位（老卡当日到期）", (await cdp.eval(`!!document.querySelector(".extract-face-body")`)) === true, "无卡面");
  const bodyHasLegacy = await cdp.eval(`(() => { const b = document.querySelector(".extract-face-body"); return b ? b.textContent.includes(${JSON.stringify(SEG1)}) : false; })()`);
  check("卡面正文＝老卡三段内容", bodyHasLegacy === true, bodyHasLegacy);

  // 2) 卡面 3 段划选（第一段无修饰、后两段 Ctrl 全程按住；修饰键时序已由 multiselect.gui 锁死）
  const faceProbe = (mark) => `(() => {
    const body = document.querySelector(".extract-face-body");
    if (!body) return "";
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const idx = (node.textContent || "").indexOf(${JSON.stringify(mark)});
      if (idx < 0) continue;
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + ${JSON.stringify(mark)}.length);
      const rects = range.getClientRects();
      const first = rects[0], last = rects[rects.length - 1];
      if (!first || !last || !first.height) return "EMPTY_RECT";
      return JSON.stringify({ start: { x: first.left + 2, y: first.top + first.height / 2 }, end: { x: last.right - 2, y: last.top + last.height / 2 } });
    }
    return "";
  })()`;
  const drag = async (from, to, modifiers = 0) => {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y, modifiers });
    await wait(60);
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1, modifiers });
    for (let i = 1; i <= 6; i++) {
      const x = from.x + ((to.x - from.x) * i) / 6;
      const y = from.y + ((to.y - from.y) * i) / 6;
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1, modifiers });
      await wait(40);
    }
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", buttons: 0, clickCount: 1, modifiers });
  };
  const keyDown = () => cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17, modifiers: KEY_MOD.ctrl });
  const keyUp = () => cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17, modifiers: 0 });

  const P = [];
  for (const seg of [SEG1, SEG2, SEG3]) P.push(JSON.parse(String(await cdp.eval(faceProbe(seg))) || "{}"));
  check("三段在卡面可见（坐标可计算）", P.every((p) => p.start), JSON.stringify(P.map((p) => !!p.start)));

  await drag(P[0].start, P[0].end, 0);
  await wait(900);
  await keyDown(); await wait(120);
  await drag(P[1].start, P[1].end, KEY_MOD.ctrl);
  const hl2 = await cdp.eval(`(() => { const h = document.defaultView.CSS.highlights.get("multi-select"); return h ? h.size : -1; })()`);
  console.log("  乙后高亮段数:", hl2);
  await drag(P[2].start, P[2].end, KEY_MOD.ctrl);
  await keyUp(); await wait(1200);
  const hl3 = await cdp.eval(`(() => { const h = document.defaultView.CSS.highlights.get("multi-select"); return JSON.stringify({ size: h ? h.size : -1, texts: h ? [...h].map((r) => r.toString()) : [] }); })()`);
  console.log("  丙后高亮:", hl3);
  check("三段集合就绪（高亮 3 段）", String(hl3).includes('"size":3'), hl3);

  // 3) 点工具栏「摘录」（v48.41/D81：动作自菜单上移页头工具栏）→ 恒挂当前卡落库（D80 修复点）
  const mb = JSON.parse(String(await cdp.eval(`(() => { const b = document.querySelector('[data-extract-toolbar] [data-sel-act="extract"]'); if (!b) return ""; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`)) || "{}");
  check("工具栏含「摘录」动作", !!mb.x, JSON.stringify(mb));
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: mb.x, y: mb.y, modifiers: 0 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: mb.x, y: mb.y, button: "left", buttons: 1, clickCount: 1, modifiers: 0 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: mb.x, y: mb.y, button: "left", buttons: 0, clickCount: 1, modifiers: 0 });
  await wait(2000);

  const child = await cdp.eval(`(async () => {
    const all = await window.workflowAPI.listAll();
    const rows = (all || []).filter((e) => String(e.contentMarkdown || "").includes("老卡")).map((e) => ({ id: e.id.slice(0, 8), md: String(e.contentMarkdown).slice(0, 40), pt: e.parentType, pid: (e.parentId || "").slice(0, 8) }));
    const hit = (all || []).find((e) => String(e.contentMarkdown || "") === ${JSON.stringify(JOINED)});
    const parent = (all || []).find((e) => e.id === ${JSON.stringify(legacyId)});
    return JSON.stringify({
      rows,
      found: !!hit,
      parentType: hit ? hit.parentType : null,
      parentId: hit ? hit.parentId : null,
      parentRange: hit ? (hit.contextRef || {}).parentRange ?? null : null,
      parentRefNull: parent ? parent.contextRef === null : null,
      parentDocumentId: hit ? hit.documentId : null
    });
  })()`);
  const cv = JSON.parse(String(child) || "{}");
  check("摘录已落库（三段拼接文本那一条）", cv.found === true, child);
  check("恒挂当前卡：parent_type=extract", cv.parentType === "extract", child);
  check("恒挂当前卡：parent_id=老卡 id", cv.parentId === legacyId, child);
  check("parentRange 有 3 段区间", Array.isArray(cv.parentRange) && cv.parentRange.length === 3, child);
  check("documentId 回退行原生 document_id（非空）", typeof cv.parentDocumentId === "string" && cv.parentDocumentId.length > 0, child);

  // 3.5) v48.43（D83）：标记形式＝下划线 —— 工具栏形式段控切「下划线」→ 菜单批注框留空点色
  //      ＝无批注下划线纯批注（kind=highlight + annotation_type=underline）
  console.log("\n== 下划线形式（D83） ==");
  await drag(P[1].start, P[1].end, 0);
  await wait(900);
  const formOk = await cdp.eval(`(() => {
    const b = document.querySelector('[data-extract-toolbar] [data-annot-form="underline"]');
    b?.click();
    return !!b;
  })()`);
  check("工具栏含「下划线」形式段控", formOk === true, formOk);
  await wait(400);
  await cdp.eval(`(() => { document.querySelector(".selection-menu .swatch[data-color='green']")?.click(); return true; })()`);
  await wait(600);
  // 批注编辑浮层随后弹出：Esc 收起（浮层自身先落库再收起，批注文字留空）
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await wait(1200);
  const under = await cdp.eval(`(async () => {
    const all = await window.workflowAPI.listAll();
    const hit = (all || []).find((e) => String(e.contentMarkdown || "").includes(${JSON.stringify(SEG2)}) && e.annotationType === "underline");
    const style = document.getElementById("annot-body-highlight-style");
    return JSON.stringify({
      found: !!hit,
      kind: hit ? hit.kind : null,
      color: hit ? hit.annotationColor : null,
      decorated: style ? (style.textContent || "").includes("text-decoration") : false
    });
  })()`);
  const uv = JSON.parse(String(under) || "{}");
  check("下划线点色落库＝纯批注（kind=highlight + annotation_type=underline）", uv.found === true && uv.kind === "highlight", under);
  check("批注色随点色（green）", uv.color === "green", under);
  check("卡面绘制层出现下划线规则（text-decoration）", uv.decorated === true, under);

  // 4) 卡片页「摘录」签可见
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "卡片"); b?.click(); return "nav"; })()`);
  await wait(2200);
  await cdp.eval(`(() => { document.querySelector("[data-kind-extract]")?.click(); return "tab"; })()`);
  await wait(800);
  const table = await cdp.eval(`(() => { const t = document.querySelector("[data-extract-table]"); return JSON.stringify({ exists: !!t, has: t ? t.textContent.includes(${JSON.stringify(SEG1)}) : false }); })()`);
  check("卡片页「摘录」签可见刚摘录的内容", JSON.parse(String(table) || "{}").has === true, table);

  // 5) 普通点击行 → 摘录详情模态（D80 缺陷③修复点）
  await cdp.eval(`(() => {
    const rows = [...document.querySelectorAll("[data-extract-table] .cb-row")];
    const row = rows.find((r) => (r.querySelector(".cb-front") || {}).textContent?.includes(${JSON.stringify(SEG1)}));
    row?.click();
    return !!row;
  })()`);
  await wait(600);
  const modal = await cdp.eval(`(() => {
    const m = document.querySelector('[aria-label="摘录详情"]');
    return JSON.stringify({ open: !!m, hasContent: m ? m.textContent.includes(${JSON.stringify(SEG1)}) && m.textContent.includes(${JSON.stringify(SEG3)}) : false, hasJump: !!m?.querySelector("[data-extract-detail-jump]") });
  })()`);
  const mv = JSON.parse(String(modal) || "{}");
  check("点行打开摘录详情模态", mv.open === true, modal);
  check("详情含三段全文", mv.hasContent === true, modal);
  check("详情含「跳转原文」出口", mv.hasJump === true, modal);
  await cdp.eval(`(() => { document.querySelector('[aria-label="摘录详情"] .modal-close')?.click(); return "closed"; })()`);
  await wait(400);
  check("关闭详情回到列表", (await cdp.eval(`!!document.querySelector('[aria-label="摘录详情"]')`)) === false, "模态未关");

  // 6) 吸底批量栏在位（重排后钩子保留）
  const stage = await cdp.eval(`JSON.stringify({ bar: !!document.querySelector("[data-batch-bar]"), hint: (document.querySelector("[data-batch-bar] .bar-hint") || {}).textContent || "" })`);
  check("吸底批量栏在位（未选中＝操作提示）", String(stage).includes('"bar":true'), stage);

  console.log(`\n==== cards.gui：${pass} 通过 / ${fail} 失败 ====`);
} catch (e) {
  console.error("测试异常：", (e && e.stack) || e);
  fail++;
} finally {
  try { electron?.kill(); } catch { /* 已退出 */ }
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(500);
  try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch { /* 清理失败无碍 */ }
  process.exit(fail === 0 ? 0 : 1);
}
