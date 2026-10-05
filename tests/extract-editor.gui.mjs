// D93 摘录卡 WYSIWYG 编辑器 + 默认读态 + 工具栏 + 字号桥 GUI 端到端（CDP 驱动真实应用，自启自关）
// @runtime: node  @tier: 2  @gui: true  @id: EXTRACTEDITOR  @timeout: 480
// 运行：npm run build 之后 `node tests/extract-editor.gui.mjs`（CDP 驱动 dist 上的真实应用）
// 隔离：M7_TEST_USERDATA → tests/tmp-extracted-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
// 夹具：复用 tests/extract.gui.seed.cjs（预种一条已到期摘录）；表格+公式+代码块料经 workflowAPI.update
//   写入（真实 extracts:update 落库链；该 IPC 不广播 workflow/changed，故写入后经「切页签再切回」刷新卡面）。
// 断言链（设计稿 §G.2 验收 4/5/6/7/8/9/10/11 中未被迁移套件覆盖的部分）：
//   ④ 默认读态（裸壳不在、渲染元素在场、正文无 contentEditable）；⑤ 点非高亮进编辑（真键鼠）+ 工具栏 16 钮；
//   ⑥ 划选不进编辑且选区菜单出现（五动作落库回归由 annotations/multiselect 套件保住）；
//   ⑦ 点高亮出浮层（拖选+摘录+高亮造子批注 → 改批注/改色/删除三判据，对齐 annotations.gui ③）；
//   ⑧ WYSIWYG（# 标题 / **粗** 编辑态即渲染 + 落库为源语法）；⑨ 含表格+公式+代码块的摘录进出编辑逐字节不变；
//   ⑩ 工具栏开关（设置页关→重进编辑无工具栏→重开→恢复→重启不丢）；⑪ 字号同步（跟 22 / 独立 14 / 26px 覆盖已死）。
// 局限（如实注明，不得伪造）：真实中文 IME 组合期输入无法在本环境模拟——键入走 CDP Input.insertText 与
//   带 text 的按键直插路径，不覆盖 composition 事件序列（设计稿开放问题④：IME 冒烟登记为用户验收步骤）。
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9235";
const USER_DATA = path.join(ROOT, "tests", "tmp-extracted-userdata");
const SEED_TEXT = "GUI 摘录样本：这一段的含义值得单独回忆。";
const RICH_TEXT = [
  "往返保真样本段落。",
  "",
  "| 列甲 | 列乙 |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "$$",
  "E=mc^2",
  "$$",
  "",
  "```js",
  "const x = 1;",
  "```"
].join("\n");

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

// ---------- 通用交互（真键鼠，与 annotations.gui / multiselect.gui 同规） ----------
const hoverAt = (cdp, x, y) => cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
async function clickAt(cdp, x, y) {
  await hoverAt(cdp, x, y);
  await wait(60);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1, modifiers: 0 });
  await wait(60);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1, modifiers: 0 });
}
const drag = (cdp) => async (from, to) => {
  await hoverAt(cdp, from.x, from.y);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1, modifiers: 0 });
  for (let i = 1; i <= 6; i++) {
    const x = from.x + ((to.x - from.x) * i) / 6;
    const y = from.y + ((to.y - from.y) * i) / 6;
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1, modifiers: 0 });
    await wait(40);
  }
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", buttons: 0, clickCount: 1, modifiers: 0 });
};
const pressEsc = async (cdp) => {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
};
/** 读态渲染正文里某子串的起止视口坐标（拖选/点击用） */
async function probeRange(cdp, needle) {
  const raw = await cdp.eval(`(() => {
    const body = document.querySelector(".extract-face-body");
    if (!body) return "";
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const i = (n.textContent || "").indexOf(${JSON.stringify(needle)});
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i); r.setEnd(n, i + ${JSON.stringify(needle)}.length);
      const rects = r.getClientRects();
      const first = rects[0], last = rects[rects.length - 1];
      if (!first || !last || !first.height) continue;
      return JSON.stringify({
        start: { x: first.left + 2, y: first.top + first.height / 2 },
        end: { x: last.right - 2, y: last.top + last.height / 2 }
      });
    }
    return "";
  })()`);
  return String(raw).startsWith("{") ? JSON.parse(String(raw)) : null;
}
/** 等编辑器进入（.ProseMirror[contenteditable=true]）或退出（消失） */
async function waitEditor(cdp, want, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const up = await cdp.eval(`!!document.querySelector(".extract-face-body .ProseMirror[contenteditable=true]")`);
    if (up === want) return true;
    await wait(200);
  }
  return false;
}
const navTo = async (cdp, label) => {
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); b?.click(); return !!b; })()`);
};

try {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  execSync("npx electron tests/extract.gui.seed.cjs", {
    cwd: ROOT, shell: true, stdio: "ignore",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const launch = async () => {
    const out = openSync(path.join(ROOT, "tests", "extract-editor.gui.log"), "a");
    const p = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
      cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: false,
      env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
    });
    return p;
  };
  electron = await launch();
  let cdp = await connect();
  await wait(2500);
  check("应用启动（根节点挂载）", (await cdp.eval(`!!document.querySelector("#root")`)) === true, "未挂载");
  await navTo(cdp, "摘录");
  await wait(1800);
  check("摘录页卡面在位（预种摘录进入会话）", (await cdp.eval(`!!document.querySelector(".extract-face-body")`)) === true, "无卡面");

  const seedId = await cdp.eval(`(async () => { const all = await window.workflowAPI.listAll(); const hit = (all || []).find((e) => e.contentMarkdown === ${JSON.stringify(SEED_TEXT)}); return hit ? hit.id : null; })()`);
  check("种子摘录在库（id 可取）", typeof seedId === "string" && seedId.length > 0, seedId);

  // ============================================================
  // 验收 4：默认读态
  // ============================================================
  console.log("\n== 验收 4 默认读态 ==");
  const readState = await cdp.eval(`(() => {
    const body = document.querySelector(".extract-face-body");
    return JSON.stringify({
      editable: !!document.querySelector(".extract-face .review-editable"),
      rendered: body ? !!body.querySelector("p") : false,
      ce: body ? body.querySelectorAll("[contenteditable=true]").length : -1,
      text: body ? body.textContent : ""
    });
  })()`);
  const rs = JSON.parse(String(readState) || "{}");
  check("④ 默认读态：渲染 <p> 在场、正文为种子文本", rs.rendered === true && String(rs.text).includes("GUI 摘录样本"), readState);
  check("④ 默认读态：EditableText 裸壳不存在", rs.editable === false, readState);
  check("④ 默认读态：卡面正文内无 contentEditable 元素", rs.ce === 0, readState);
  const hint = await cdp.eval(`document.querySelector("[data-page-hint]")?.textContent || ""`);
  check("§D.7 头带提示随新文案（点正文编辑 · 点高亮批注）", String(hint).includes("点正文编辑") && String(hint).includes("点高亮批注") && !String(hint).includes("正文可直接编辑"), hint);
  // v1.3（用户反馈）：节标签改名 + 摘录自身原始批注块（空则不渲染）
  const label13 = await cdp.eval(`(() => {
    const face = document.querySelector(".extract-face");
    return JSON.stringify({
      label: face?.querySelector(".sec-quote .sec-label")?.textContent || "",
      annot: !!face?.querySelector('[data-testid="extract-face-comment"]')
    });
  })()`);
  const l13 = JSON.parse(String(label13) || "{}");
  check("v1.3 节标签＝「摘录原文」", l13.label === "摘录原文", label13);
  check("v1.3 无批注时不渲染批注块", l13.annot === false, label13);
  await cdp.eval(`(async () => { await window.workflowAPI.update(${JSON.stringify(seedId)}, { comment: "D93 原始批注样本：摘录时在原文处所做。" }); return true; })()`);
  await navTo(cdp, "书架");
  await wait(1200);
  await navTo(cdp, "摘录");
  await wait(1800);
  const annot13 = await cdp.eval(`(() => {
    const blk = document.querySelector('[data-testid="extract-face-comment"]');
    return JSON.stringify({ up: !!blk, label: blk?.querySelector(".sec-label")?.textContent || "", text: blk?.querySelector(".extract-face-annot-text")?.textContent || "" });
  })()`);
  const a13 = JSON.parse(String(annot13) || "{}");
  check("v1.3 批注块：有批注时渲染（标签「批注」+ 原文摘录时的原始批注文本）", a13.up === true && a13.label === "批注" && a13.text.includes("原始批注样本"), annot13);

  // ============================================================
  // 验收 5：点非高亮进编辑（真键鼠）
  // ============================================================
  console.log("\n== 验收 5 点非高亮进编辑 ==");
  const p5 = await probeRange(cdp, "值得单独回忆");
  check("⑤ 前置：正文可命中点击坐标", !!p5, JSON.stringify(p5));
  await clickAt(cdp, p5.start.x, p5.start.y);
  check("⑤ 编辑态出现（.ProseMirror[contenteditable=true]）", await waitEditor(cdp, true) === true, "编辑器未出现");
  const tb5 = await cdp.eval(`(() => {
    const t = document.querySelector('.extract-face-body [data-testid="extract-editor-toolbar"]');
    const btns = t ? [...t.querySelectorAll("[data-tb]")].map((b) => b.dataset.tb) : [];
    return JSON.stringify({ up: !!t, n: btns.length, has: ["bold", "italic", "strike", "code", "link", "inlineMath", "h", "quote", "ul", "ol", "task", "codeBlock", "hr", "mathBlock", "undo", "redo"].filter((k) => btns.includes(k)).length });
  })()`);
  const t5 = JSON.parse(String(tb5) || "{}");
  check("⑤ 工具栏在场（data-testid=extract-editor-toolbar）且 16 钮齐全", t5.up === true && t5.n === 16 && t5.has === 16, tb5);
  check("⑤ 工具栏在编辑器 host 之后（.extract-face-body 内、ProseMirror 之后）", (await cdp.eval(`(() => {
    const body = document.querySelector(".extract-face-body");
    const pm = body?.querySelector(".ProseMirror");
    const tb = body?.querySelector('[data-testid="extract-editor-toolbar"]');
    return !!pm && !!tb && !!(pm.compareDocumentPosition(tb) & Node.DOCUMENT_POSITION_FOLLOWING);
  })()`)) === true, "工具栏不在编辑器之后");
  // v1.3（审查后用户反馈）：编辑态窗口与读态完全同形——Milkdown 根的 `editor` 类会被快速摘录
  // 浮窗的 .editor 规则劫持（fixed/320px/纸底/浮层阴影），卡面作用域内必须逐项抵消
  const shape13 = await cdp.eval(`(() => {
    const body = document.querySelector(".extract-face-body");
    const pm = body?.querySelector(".ProseMirror");
    if (!body || !pm) return "";
    const cs = getComputedStyle(pm);
    const rb = body.getBoundingClientRect();
    const csPadL = getComputedStyle(body).paddingLeft;
    const rp = pm.getBoundingClientRect();
    return JSON.stringify({
      position: cs.position, shadow: cs.boxShadow, bg: cs.backgroundColor, display: cs.display,
      parentCls: String(pm.parentElement.className).slice(0, 40), parentDisplay: getComputedStyle(pm.parentElement).display,
      pmTransform: cs.transform, pmAnim: cs.animationName,
      faceTransform: getComputedStyle(body.closest(".extract-face")).transform,
      faceAnim: getComputedStyle(body.closest(".extract-face")).animationName,
      bodyW: Math.round(rb.width), pmW: Math.round(rp.width), padL: parseFloat(csPadL)
    });
  })()`);
  const s13 = JSON.parse(String(shape13) || "{}");
  check("v1.3 编辑态同形：无 fixed 定位、无阴影、无纸底", s13.position === "static" && (s13.shadow === "none" || s13.shadow === "") && (s13.bg === "rgba(0, 0, 0, 0)" || s13.bg === "transparent"), shape13);
  check("v1.3 编辑态同形：编辑器宽度＝正文盒内容宽（随流满宽）", Math.abs((s13.pmW ?? 0) - ((s13.bodyW ?? 0) - (s13.padL ?? 0))) <= 2, shape13);
  await pressEsc(cdp);
  await waitEditor(cdp, false);
  const afterEsc = await cdp.eval(`(async () => { const d = await window.workflowAPI.get(${JSON.stringify(seedId)}); return d ? d.contentMarkdown : "MISSING"; })()`);
  check("⑤ 无修改 Esc 退读态且零写库（幂等短路）", (await cdp.eval(`!!document.querySelector(".extract-face-body p")`)) === true && String(afterEsc) === SEED_TEXT, afterEsc);

  // ============================================================
  // 验收 6：划选不进编辑、选区菜单出现
  // ============================================================
  console.log("\n== 验收 6 划选不进编辑 ==");
  const p6 = await probeRange(cdp, "这一段的含义");
  check("⑥ 前置：拖选目标可命中坐标", !!p6, JSON.stringify(p6));
  await drag(cdp)(p6.start, p6.end);
  await wait(1000);
  const sel6 = await cdp.eval(`JSON.stringify({ menu: !!document.querySelector(".selection-menu"), pm: !!document.querySelector(".extract-face-body .ProseMirror"), sel: String(window.getSelection()).trim() })`);
  const s6 = JSON.parse(String(sel6) || "{}");
  check("⑥ 划选后选区菜单出现且选中文本正确", s6.menu === true && s6.sel === "这一段的含义", sel6);
  check("⑥ 划选不进编辑（编辑器未出现，保持读态）", s6.pm === false, sel6);
  // 点正文外非动作面处（底栏背景右端——按钮都在居中 720 内列，右下角是空背景）：
  // mouseup 出卡面且不在豁免清单 ⇒ 集合与菜单清空（页头工具栏是豁免面，不能点那里）
  const clearSelMenu = async () => {
    const dim = JSON.parse(String(await cdp.eval(`JSON.stringify({ w: window.innerWidth, h: window.innerHeight })`)) || "{}");
    for (let i = 0; i < 3; i++) {
      if (!(await cdp.eval(`!!document.querySelector(".selection-menu")`))) return true;
      await clickAt(cdp, Number(dim.w) - 40, Number(dim.h) - 24);
      await wait(700);
    }
    return !(await cdp.eval(`!!document.querySelector(".selection-menu")`));
  };
  check("⑥ 选区清空（菜单收起，读态不变）", (await clearSelMenu()) === true && (await cdp.eval(`!!document.querySelector(".extract-face-body .ProseMirror")`)) === false, "清选区失败");

  // ============================================================
  // 验收 7：点高亮出浮层（拖选 + 摘录+高亮 造段锚批注 → 三判据）
  // ============================================================
  console.log("\n== 验收 7 点高亮出浮层 ==");
  await cdp.eval(`(() => { document.querySelector('[data-annot-mode="extract"]')?.click(); return true; })()`);
  await wait(400);
  await drag(cdp)(p6.start, p6.end);
  await wait(900);
  await cdp.eval(`(() => { document.querySelector(".selection-menu .swatch[data-color='green']")?.click(); return true; })()`);
  await wait(1800);
  const child7 = await cdp.eval(`(async () => {
    const all = await window.workflowAPI.listAll();
    const kid = (all || []).find((e) => e.parentType === "extract" && e.parentId === ${JSON.stringify(seedId)});
    const parent = (all || []).find((e) => e.id === ${JSON.stringify(seedId)}) || {};
    let pr = null;
    try { pr = (kid?.contextRef || {}).parentRange || null; } catch { pr = null; }
    return JSON.stringify({
      n: kid ? 1 : 0,
      id: kid?.id ?? null,
      color: kid?.annotationColor ?? null,
      kind: kid?.kind ?? null,
      slices: Array.isArray(pr) ? pr.map((r) => String(parent.contentMarkdown || "").slice(r.start, r.end)) : null
    });
  })()`);
  const c7 = JSON.parse(String(child7) || "{}");
  check("⑦ 拖选+点色落库段锚批注（parentType=extract、green）", c7.n === 1 && c7.color === "green" && c7.kind === "extract", child7);
  check("⑦ 点色落库区间与所选一致（区间切片＝拖选文字）", Array.isArray(c7.slices) && c7.slices.join("") === "这一段的含义", JSON.stringify(c7.slices));
  const painted7 = await cdp.eval(`(() => {
    const reg = window.CSS && CSS.highlights ? CSS.highlights : null;
    const names = reg ? [...reg.keys()].filter((n) => String(n).startsWith("annot-body-")) : [];
    const texts = names.flatMap((n) => [...reg.get(n)].map((r) => r.toString()));
    return JSON.stringify({ names, texts });
  })()`);
  const pt7 = JSON.parse(String(painted7) || "{}");
  check("⑦ 高亮画进绘制层（annot-body-* 注册、文本＝所引段落）", pt7.texts.some((t) => t.includes("这一段的含义")), painted7);
  await clickAt(cdp, p6.start.x, p6.start.y);
  await wait(900);
  const pop7 = await cdp.eval(`(() => {
    const el = document.querySelector("[data-editor-for]");
    const ta = el?.querySelector("textarea");
    return JSON.stringify({ up: !!el, id: el?.dataset.editorFor ?? null, kind: el?.dataset.editorKind ?? null, focused: !!el && document.activeElement === ta });
  })()`);
  const pp7 = JSON.parse(String(pop7) || "{}");
  check("⑦ 读态点高亮出批注浮层（id＝该条批注、输入框聚焦）", pp7.up === true && pp7.id === c7.id && pp7.kind === "extract" && pp7.focused === true, pop7);
  // 判据 1：改批注文字 → 库变 + 栏内显示同步
  await cdp.eval(`(() => {
    const ta = document.querySelector("[data-editor-for] textarea");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, "D93 点高亮改批注");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await wait(300);
  await clickAt(cdp, 420, 60);
  await wait(1400);
  const saved7 = await cdp.eval(`(async () => {
    const all = await window.workflowAPI.listAll();
    const kid = (all || []).find((e) => e.id === ${JSON.stringify(c7.id)});
    return JSON.stringify({ comment: kid?.comment ?? null, rail: (document.querySelector("[data-annot-panel]")?.textContent || "").includes("D93 点高亮改批注") });
  })()`);
  const sv7 = JSON.parse(String(saved7) || "{}");
  check("⑦ 改批注：comment 落库", sv7.comment === "D93 点高亮改批注", saved7);
  check("⑦ 改批注：批注栏显示同步", sv7.rail === true, saved7);
  // 判据 2：改色 → annotation_color 变
  const railItem = await cdp.eval(`(() => {
    const el = [...document.querySelectorAll("[data-annot-panel] [data-zitem]")].find((x) => x.textContent.includes("D93 点高亮改批注"));
    if (!el) return "";
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + 12 });
  })()`);
  const ri7 = JSON.parse(String(railItem) || "{}");
  check("⑦ 前置：批注栏条目可命中（真鼠标点开浮层）", typeof ri7.x === "number", railItem);
  await clickAt(cdp, ri7.x, ri7.y);
  await wait(900);
  await cdp.eval(`(() => { document.querySelector("[data-editor-for] [data-colorbtn]")?.click(); return true; })()`);
  await wait(500);
  await cdp.eval(`(() => { document.querySelector('[data-editor-for] [data-colorpop] [data-color="blue"]')?.click(); return true; })()`);
  await wait(1400);
  const color7 = await cdp.eval(`(async () => { const all = await window.workflowAPI.listAll(); const kid = (all || []).find((e) => e.id === ${JSON.stringify(c7.id)}); return kid?.annotationColor ?? null; })()`);
  check("⑦ 改色：annotation_color 落库（green → blue）", color7 === "blue", color7);
  // 判据 3：删除 → 计数 -1（就地二次确认）
  const beforeDel = await cdp.eval(`(async () => (await window.workflowAPI.listAll()).filter((e) => e.parentType === "extract" && e.parentId === ${JSON.stringify(seedId)}).length)()`);
  await cdp.eval(`(() => { document.querySelector("[data-editor-for] [data-del]")?.click(); return true; })()`);
  await wait(500);
  check("⑦ 删除带就地二次确认（确认钮出现、尚未删）", (await cdp.eval(`!!document.querySelector("[data-editor-for] [data-del-confirmed]")`)) === true && Number(beforeDel) === 1, beforeDel);
  await cdp.eval(`(() => { document.querySelector("[data-editor-for] [data-del-confirmed]")?.click(); return true; })()`);
  await wait(1600);
  const afterDel = await cdp.eval(`(async () => (await window.workflowAPI.listAll()).filter((e) => e.parentType === "extract" && e.parentId === ${JSON.stringify(seedId)}).length)()`);
  check("⑦ 删除：段锚批注计数 -1（1 → 0）", Number(afterDel) === 0 && Number(beforeDel) === 1, `${beforeDel} → ${afterDel}`);
  await pressEsc(cdp);
  await wait(400);

  // ============================================================
  // 验收 8：WYSIWYG（# 标题 / **粗** 即渲染，落库为源语法）
  // ============================================================
  console.log("\n== 验收 8 WYSIWYG ==");
  const p8 = await probeRange(cdp, "值得单独回忆");
  await clickAt(cdp, p8.start.x, p8.start.y);
  check("⑧ 进入编辑态", await waitEditor(cdp, true) === true, "编辑器未出现");
  await wait(800); // 等 focusBlock 的块级落点接管完光标（§D.2 P0）
  // Ctrl+A 全选后键入：点内光标落点在块内有不确定性，全选替换让后续「# 标题 / **粗**」的块序确定
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
  await wait(250);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "#", code: "Digit3", windowsVirtualKeyCode: 51, text: "#" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "#", code: "Digit3", windowsVirtualKeyCode: 51 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  await wait(300);
  await cdp.send("Input.insertText", { text: "标题" });
  await wait(400);
  const h8 = await cdp.eval(`(() => {
    const h = document.querySelector(".extract-face-body .ProseMirror h1");
    return JSON.stringify({ up: !!h, text: h ? h.textContent : null });
  })()`);
  const hh8 = JSON.parse(String(h8) || "{}");
  check("⑧ 编辑态输入「# 标题」即时呈现为 H1", hh8.up === true && hh8.text === "标题", h8);
  // 新块 → **粗** 触发加粗输入规则
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await wait(200);
  await cdp.send("Input.insertText", { text: "**" });
  await wait(150);
  await cdp.send("Input.insertText", { text: "粗" });
  await wait(150);
  await cdp.send("Input.insertText", { text: "**" });
  await wait(400);
  const b8 = await cdp.eval(`(() => {
    const s = document.querySelector(".extract-face-body .ProseMirror strong");
    return JSON.stringify({ up: !!s, text: s ? s.textContent : null });
  })()`);
  const bb8 = JSON.parse(String(b8) || "{}");
  check("⑧ 编辑态输入「**粗**」即时呈现为粗体", bb8.up === true && bb8.text === "粗", b8);
  await pressEsc(cdp);
  await waitEditor(cdp, false);
  await wait(600);
  const read8 = await cdp.eval(`(() => {
    const body = document.querySelector(".extract-face-body");
    return JSON.stringify({ h1: body?.querySelector("h1")?.textContent || null, strong: body?.querySelector("strong")?.textContent || null, pm: !!body?.querySelector(".ProseMirror") });
  })()`);
  const rr8 = JSON.parse(String(read8) || "{}");
  check("⑧ 退出编辑读态渲染一致（h1 + strong）", rr8.h1 === "标题" && rr8.strong === "粗" && rr8.pm === false, read8);
  const db8 = await cdp.eval(`(async () => { const d = await window.workflowAPI.get(${JSON.stringify(seedId)}); return d ? d.contentMarkdown : "MISSING"; })()`);
  check("⑧ 落库的是 markdown 源文（含 # 与 **）", String(db8).includes("# 标题") && String(db8).includes("**粗**"), db8);

  // ============================================================
  // 验收 9：往返不毁源（表格+公式+代码块进出编辑逐字节不变）
  // ============================================================
  console.log("\n== 验收 9 往返不毁源 ==");
  const upd9 = await cdp.eval(`(async () => { const r = await window.workflowAPI.update(${JSON.stringify(seedId)}, { contentMarkdown: ${JSON.stringify(RICH_TEXT)} }); return JSON.stringify(r || {}); })()`);
  check("⑨ 前置：富语料经 extracts:update 落库", String(upd9).includes('"ok":true'), upd9);
  await navTo(cdp, "卡片");
  await wait(1400);
  await navTo(cdp, "摘录");
  await wait(1800);
  const md0 = await cdp.eval(`(async () => { const d = await window.workflowAPI.get(${JSON.stringify(seedId)}); return d ? d.contentMarkdown : "MISSING"; })()`);
  check("⑨ 前置：卡面刷新读出富语料（含表格/公式/代码块源文）", String(md0) === RICH_TEXT, String(md0).slice(0, 80));
  const p9 = await probeRange(cdp, "往返保真样本段落");
  check("⑨ 前置：读态渲染出富语料可点", !!p9, JSON.stringify(p9));
  await clickAt(cdp, p9.start.x, p9.start.y);
  check("⑨ 进入编辑态", await waitEditor(cdp, true) === true, "编辑器未出现");
  const richEd = await cdp.eval(`(() => {
    const pm = document.querySelector(".extract-face-body .ProseMirror");
    return JSON.stringify({ table: !!pm?.querySelector("table"), pre: !!pm?.querySelector("pre code"), mathBlock: !!pm?.querySelector('[data-type="math-block"]') });
  })()`);
  const re9 = JSON.parse(String(richEd) || "{}");
  check("⑨ 编辑态呈现表格/代码块/公式块（WYSIWYG 同构）", re9.table === true && re9.pre === true && re9.mathBlock === true, richEd);
  await pressEsc(cdp);
  await waitEditor(cdp, false);
  await wait(600);
  const md1 = await cdp.eval(`(async () => { const d = await window.workflowAPI.get(${JSON.stringify(seedId)}); return d ? d.contentMarkdown : "MISSING"; })()`);
  check("⑨ 无修改退出：content_markdown 逐字节不变（幂等短路）", String(md1) === String(md0), `md0 长度=${String(md0).length} md1 长度=${String(md1).length}`);

  // ============================================================
  // 验收 11：字号同步（跟 22 / 独立 14 / 26px 覆盖已死）
  // 注：settingsAPI.set 是裸 IPC，不广播 settings/changed——字号桥的重算时机＝卡面重挂
  // （切页签往返），与真实用户「改设置后回到摘录页」的路径一致。
  // ============================================================
  console.log("\n== 验收 11 字号同步 ==");
  const fsOf = () => cdp.eval(`getComputedStyle(document.querySelector(".extract-face-body")).fontSize`);
  const refreshFace = async () => {
    await navTo(cdp, "卡片");
    await wait(1400);
    await navTo(cdp, "摘录");
    await wait(2000);
  };
  const rd = await cdp.eval(`(async () => { const cur = await window.settingsAPI.get("app", "readerSettings"); return JSON.stringify(cur || {}); })()`);
  const rd0 = JSON.parse(String(rd) || "{}");
  check("⑪ 基线：默认跟随＝17px", (await fsOf()) === "17px", await fsOf());
  await cdp.eval(`(async () => {
    const cur = await window.settingsAPI.get("app", "readerSettings");
    await window.settingsAPI.set("app", "readerSettings", { ...cur, appearance: { ...(cur?.appearance || {}), fontSize: 22 } });
    return true;
  })()`);
  await wait(600);
  await refreshFace();
  check("⑪ 阅读字号 17→22：卡面 computed 同步 22px", (await fsOf()) === "22px", await fsOf());
  await cdp.eval(`window.settingsAPI.set("app", "extractFaceFontFollow", false)`);
  await wait(500);
  await cdp.eval(`window.settingsAPI.set("app", "extractFaceFontSize", 14)`);
  await wait(500);
  await refreshFace();
  check("⑪ 关跟随、独立设 14：computed 14px", (await fsOf()) === "14px", await fsOf());
  const dead26 = await cdp.eval(`(() => {
    const body = document.querySelector(".extract-face-body");
    const probe = (v) => { const d = document.createElement("span"); d.style.fontSize = v; document.body.appendChild(d); const s = getComputedStyle(d).fontSize; d.remove(); return s; };
    return JSON.stringify({ fs: getComputedStyle(body).fontSize, bridge: probe("var(--extract-face-fs)"), titleL: probe("var(--fs-title-l)") });
  })()`);
  const d26 = JSON.parse(String(dead26) || "{}");
  check("⑪ 26px 覆盖已死：computed 恒等于桥值、不等于 --fs-title-l", d26.fs === d26.bridge && d26.fs !== d26.titleL && d26.fs === "14px", dead26);
  await cdp.eval(`window.settingsAPI.set("app", "extractFaceFontFollow", true)`);
  await wait(400);
  await cdp.eval(`(async () => { await window.settingsAPI.set("app", "readerSettings", ${JSON.stringify(rd0)}); return true; })()`);
  await wait(500);
  await refreshFace();
  check("⑪ 还原：跟随恢复、字号回基线 17px", (await fsOf()) === "17px", await fsOf());

  // ============================================================
  // 验收 10：工具栏开关（设置页关 → 重进编辑无工具栏 → 重开 → 恢复 → 重启不丢）
  // ============================================================
  console.log("\n== 验收 10 工具栏开关 ==");
  const openSettings = async () => {
    await cdp.eval(`(() => { const b = document.querySelector('button[title="设置"]'); b?.click(); return !!b; })()`);
    await wait(1200);
  };
  /** 关设置弹层（useDialogA11y 的 Esc 出口）——弹层不关会挡住后续正文上的真鼠标坐标点击 */
  const closeSettings = async () => {
    for (let i = 0; i < 3; i++) {
      if (!(await cdp.eval(`!!document.querySelector("#sec-reader")`))) return;
      await pressEsc(cdp);
      await wait(600);
    }
  };
  const clickToolbarToggle = async () => {
    // checkbox 由 label 包裹且样式态不定 → 用与仓内同规的 React 合成 click（nav-item/swatch 同法）
    return (await cdp.eval(`(() => { const el = document.querySelector('input[data-testid="setting-extract-editor-toolbar"]'); el?.click(); return !!el; })()`)) === true;
  };
  const enterEditForToolbar = async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const px = await probeRange(cdp, "往返保真样本段落");
      if (!px) { await wait(800); continue; }
      await clickAt(cdp, px.start.x, px.start.y);
      if (await waitEditor(cdp, true)) return true;
      await pressEsc(cdp);
      await wait(600);
    }
    return false;
  };
  await openSettings();
  check("⑩ 前置：设置页开关在位（sec-reader）", (await cdp.eval(`!!document.querySelector('#sec-reader input[data-testid="setting-extract-editor-toolbar"]')`)) === true, "开关不在场");
  check("⑩ 关闭工具栏开关（真鼠标）", await clickToolbarToggle() === true, "未点到");
  const tbOff10 = await cdp.eval(`(async () => JSON.stringify(await window.settingsAPI.get("app", "extractEditorToolbar")))()`);
  check("⑩ 关闭后设置值落库（false）", String(tbOff10) === "false", tbOff10);
  await closeSettings();
  await navTo(cdp, "摘录");
  await wait(1600);
  check("⑩ 重进编辑态", await enterEditForToolbar() === true, "编辑器未出现");
  check("⑩ 关闭后编辑态无工具栏（ProseMirror 仍在）", (await cdp.eval(`!!document.querySelector('.extract-face-body [data-testid="extract-editor-toolbar"]')`)) === false, "工具栏仍在");
  await pressEsc(cdp);
  await waitEditor(cdp, false);
  await openSettings();
  check("⑩ 重开工具栏开关", await clickToolbarToggle() === true, "未点到");
  const tbOn10 = await cdp.eval(`(async () => JSON.stringify(await window.settingsAPI.get("app", "extractEditorToolbar")))()`);
  check("⑩ 重开后设置值恢复（true）", String(tbOn10) === "true", tbOn10);
  await closeSettings();
  await navTo(cdp, "摘录");
  await wait(1600);
  check("⑩ 再进编辑态工具栏恢复", (await enterEditForToolbar()) === true && (await cdp.eval(`!!document.querySelector('.extract-face-body [data-testid="extract-editor-toolbar"]')`)) === true, "工具栏未恢复");
  await pressEsc(cdp);
  await waitEditor(cdp, false);
  // 重启不丢：经设置页再关（写侧归一后落 settings.json）→ 重启进程 → 值仍 false 且编辑态无工具栏
  await openSettings();
  await clickToolbarToggle();
  await wait(600);
  const tbBeforeRestart = await cdp.eval(`(async () => JSON.stringify(await window.settingsAPI.get("app", "extractEditorToolbar")))()`);
  check("⑩ 重启前置：开关已关（false）", String(tbBeforeRestart) === "false", tbBeforeRestart);
  try { electron?.kill(); } catch { /* 已退出 */ }
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(1500);
  electron = await launch();
  cdp = await connect();
  await wait(2500);
  const tbAfterRestart = await cdp.eval(`(async () => JSON.stringify(await window.settingsAPI.get("app", "extractEditorToolbar")))()`);
  check("⑩ 重启后设置值不丢（false）", String(tbAfterRestart) === "false", tbAfterRestart);
  await navTo(cdp, "摘录");
  await wait(1800);
  check("⑩ 重启后重进编辑态", await enterEditForToolbar() === true, "编辑器未出现");
  check("⑩ 重启后工具栏仍不渲染（记忆生效）", (await cdp.eval(`!!document.querySelector('.extract-face-body [data-testid="extract-editor-toolbar"]')`)) === false, "工具栏仍在");
  await pressEsc(cdp);

  // ============================================================
  // 验收 13（v1.4）：软换行可见（读态 br / 编辑态 hardbreak 真断行）+ 工具条钉底/悬浮切换。
  // 经真实 extracts:update 写入换行样本再切页签刷新（该 IPC 不广播）；结束后恢复 RICH_TEXT
  // 与设置，保证后续验收 12 的探针文本不变。
  // ============================================================
  console.log("\n== 验收 13 v1.4：软换行可见 + 工具条钉底/悬浮 ==");
  // ⑩ 结束时工具栏开关是关（false 且重启持久）——本节先开、结束还原
  await cdp.eval(`(async () => { await window.settingsAPI.set("app", "extractEditorToolbar", true); return true; })()`);
  await wait(600);
  await cdp.eval(`(async () => { await window.workflowAPI.update(${JSON.stringify(seedId)}, { contentMarkdown: ${JSON.stringify("甲行文本\n乙行文本")} }); return true; })()`);
  await navTo(cdp, "书架");
  await wait(1000);
  await navTo(cdp, "摘录");
  await wait(1800);
  const brRead13 = await cdp.eval(`(() => { const b = document.querySelector(".extract-face-body"); return JSON.stringify({ brs: b ? b.querySelectorAll("br").length : -1 }); })()`);
  const br13 = JSON.parse(String(brRead13) || "{}");
  check("⑬ 读态软换行＝可见 br（breaks 语义，v1.4）", br13.brs === 1, brRead13);
  const p13 = await probeRange(cdp, "甲行文本");
  check("⑬ 前置：读态正文可命中", !!p13, "probeRange 未命中");
  await clickAt(cdp, p13.start.x, p13.start.y);
  check("⑬ 前置：进入编辑态", await waitEditor(cdp, true) === true, "编辑器未出现");
  await wait(900);
  const edit13 = await cdp.eval(`(() => {
    const body = document.querySelector(".extract-face-body");
    const hb = body?.querySelector('.ProseMirror span[data-type="hardbreak"]');
    const tb = body?.querySelector('[data-testid="extract-editor-toolbar"]');
    const rb = body?.getBoundingClientRect();
    const rt = tb?.getBoundingClientRect();
    return JSON.stringify({
      hbDisplay: hb ? getComputedStyle(hb).display : null,
      mode: tb?.dataset.toolbarMode || null,
      bodyBottom: rb ? Math.round(rb.bottom) : null,
      tbBottom: rt ? Math.round(rt.bottom) : null
    });
  })()`);
  const e13 = JSON.parse(String(edit13) || "{}");
  check("⑬ 编辑态 hardbreak span 真断行（display block，v1.4）", e13.hbDisplay === "block", edit13);
  check("⑬ dock 工具条钉在文本盒底缘（toolbar bottom ≈ body bottom）", e13.mode === "dock" && typeof e13.bodyBottom === "number" && Math.abs(e13.tbBottom - e13.bodyBottom) <= 2, edit13);
  await cdp.eval(`(async () => { await window.settingsAPI.set("app", "extractEditorToolbarFloat", true); return true; })()`);
  // settingsAPI.set 是裸 IPC，不触发渲染层 eventBus 广播——重挂卡面让读侧 hook 重新读取
  //（真实设置页走 settingsStore.set 自带广播，编辑中即时生效；此处测「设置后生效」即可）
  await navTo(cdp, "书架");
  await wait(1000);
  await navTo(cdp, "摘录");
  await wait(1800);
  await clickAt(cdp, p13.start.x, p13.start.y);
  check("⑬ 前置：悬浮档下进入编辑态", await waitEditor(cdp, true) === true, "编辑器未出现");
  await wait(900);
  const float13 = await cdp.eval(`(() => {
    const tb = document.querySelector('[data-testid="extract-editor-toolbar"]');
    return JSON.stringify({ mode: tb?.dataset.toolbarMode || null, pos: tb ? getComputedStyle(tb).position : null, shadow: tb ? getComputedStyle(tb).boxShadow : null });
  })()`);
  const f13 = JSON.parse(String(float13) || "{}");
  check("⑬ 悬浮档即时生效（float + sticky + 浮层阴影）", f13.mode === "float" && f13.pos === "sticky" && f13.shadow && f13.shadow !== "none", float13);
  await cdp.eval(`(async () => { await window.settingsAPI.set("app", "extractEditorToolbarFloat", false); return true; })()`);
  await cdp.eval(`(async () => { await window.settingsAPI.set("app", "extractEditorToolbar", false); return true; })()`);
  await wait(400);
  await pressEsc(cdp);
  await waitEditor(cdp, false);
  await wait(600);
  await cdp.eval(`(async () => { await window.workflowAPI.update(${JSON.stringify(seedId)}, { contentMarkdown: ${JSON.stringify(RICH_TEXT)} }); return true; })()`);
  await navTo(cdp, "书架");
  await wait(1000);
  await navTo(cdp, "摘录");
  await wait(1800);

  // ============================================================
  // 验收 12（审查 P0 回归）：失焦提交不与底栏动作竞态——编辑后不按 Esc、直接真鼠标点「下一条」，
  // blur 同步提交必须先于 click 的 busy 守卫生效（旧缺陷：提交推迟到宏任务会被动作方 busy 吞掉＝丢字）。
  // 本节放套件末尾：advance 会把唯一种子卡推出队列，不得影响前序验收的卡面状态。
  // ============================================================
  console.log("\n== 验收 12 失焦提交与底栏动作竞态（P0 回归） ==");
  const p12 = await probeRange(cdp, "往返保真样本段落");
  check("⑫ 前置：读态正文可命中点击坐标", !!p12, "probeRange 未命中");
  await clickAt(cdp, p12.start.x, p12.start.y);
  check("⑫ 前置：进入编辑态", await waitEditor(cdp, true) === true, "编辑器未出现");
  await wait(800); // 等 focusBlock 的块级落点接管完光标（§D.2 P0）
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
  await wait(250);
  await cdp.send("Input.insertText", { text: "D93 失焦竞态回归：这一行必须随下一条点击落库。" });
  await wait(400);
  const adv12 = await cdp.eval(`(() => {
    const b = [...document.querySelectorAll(".extract-face-actions button")].find((x) => x.textContent.trim() === "下一条");
    if (!b) return "";
    const r = b.getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  })()`);
  const a12 = JSON.parse(String(adv12) || "{}");
  check("⑫ 前置：底栏「下一条」可命中", typeof a12.x === "number", adv12);
  await clickAt(cdp, a12.x, a12.y);
  await wait(2200);
  const db12 = await cdp.eval(`(async () => { const d = await window.workflowAPI.get(${JSON.stringify(seedId)}); return d ? d.contentMarkdown : "MISSING"; })()`);
  check("⑫ 失焦提交先于动作：正文随「下一条」落库（P0 竞态回归）", String(db12).includes("失焦竞态回归"), db12);

  console.log(`\n==== extract-editor.gui：${pass} 通过 / ${fail} 失败 ====`);
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
