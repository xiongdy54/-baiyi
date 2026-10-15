// D126 装饰小方块退役 + 批注右缘色条 GUI 回归（真应用 CDP，自启自关）
// @runtime: node  @tier: 2  @gui: true  @id: D126NOSQUARES  @timeout: 180
// 运行：npm run build 之后 `node tests/d126-deco-squares.gui.mjs`（CDP 驱动 dist 上的真实应用，可 taskkill electron）
// 隔离：M7_TEST_USERDATA → tests/tmp-d126-userdata（先清空；默认设置启动，绝不触碰真实库 §7.3）。
// 断言链（D126，用户指令：六处方块退役；去掉后不留不协调空白；条目方块的改色功能由右缘色条承担）：
//   ① 书架空态：empty-text 在场、empty-deco/empty-sq 不在场（垂直居中文案自然补位）
//   ② 粘贴导入一本无封面书 → 书架卡无 .book-card-spine、.book-card-title 在场（v48.122/D167 起为暖纸默认封面形态）
//   ③ 摘录页空态：review-count「0 条待处理」在场且无 .count-dot；空态无 .empty-deco
//   ④ 复习页空态（如在场）：empty-state 内无 .empty-deco
//   ⑤ 卡片页空态：empty-text 在场（还没有卡片）、无 .empty-deco
//   ⑥ 全应用扫掠：.empty-deco/.empty-sq/.count-dot/.book-card-spine/.mark-kind 总数＝0
//   （批注条目色条与色板折叠动效的行为断言在 annotations.gui.mjs——需要真实摘录数据，不在此重复播种）
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9287";
const USER_DATA = path.join(ROOT, "tests", "tmp-d126-userdata");

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
  const out = openSync(path.join(ROOT, "tests", "d126-deco-squares.gui.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: false,
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connect();
  await wait(2500);
  check("应用启动（根节点挂载）", (await cdp.eval(`!!document.querySelector("#root")`)) === true, "未挂载");

  const navClick = (label) => cdp.eval(`(() => { const b = [...document.querySelectorAll(".topbar-nav .nav-item")].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); b?.click(); return !!b; })()`);

  // ① 书架空态（全新库）：一句话在场、三方块装饰退役
  const shelfEmpty = (await cdp.eval(`(() => {
    const txt = document.querySelector(".bookshelf .empty-state .empty-text");
    return { txt: txt?.textContent ?? null, deco: !!document.querySelector(".bookshelf .empty-deco"), sq: document.querySelectorAll(".bookshelf .empty-sq").length };
  })()`)) || {};
  check("① 书架空态：empty-text 在场且指明主行动位置", typeof shelfEmpty.txt === "string" && shelfEmpty.txt.includes("书架还是空的") && shelfEmpty.txt.includes("添加材料"), shelfEmpty.txt);
  check("① 书架空态：三方块装饰退役（empty-deco/empty-sq 不在场）", shelfEmpty.deco === false && shelfEmpty.sq === 0, JSON.stringify(shelfEmpty));

  // ② 粘贴导入无封面书 → 回落形态＝灰底 + 左下标题，无书脊方块
  await cdp.eval(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("添加材料")); b?.click(); return !!b; })()`);
  await wait(900);
  const modalUp = await cdp.eval(`!!document.querySelector(".modal-panel[role=dialog]")`);
  check("② 添加材料模态打开", modalUp === true, modalUp);
  // v48.114/D160 起正文窗是 Milkdown/ProseMirror（textarea 已退役）——聚焦 + insertText（d91-d92 同法）
  const pasted = await cdp.eval(`(() => {
    const pm = document.querySelector(".modal-panel .ProseMirror");
    if (!pm) return false;
    pm.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, "D126 无封面测试书\\n正文第二行，用于粘贴导入回落形态验证。");
    return pm.textContent.includes("D126 无封面测试书");
  })()`);
  check("② 正文写入 ProseMirror 编辑器（D160 后无 textarea）", pasted === true, JSON.stringify(pasted));
  // 等 onChange 镜像把正文同步进 React 态（canSave 门控解除）再点保存——insertText 后镜像非瞬时
  let enabled = false;
  for (let i = 0; i < 20 && !enabled; i++) {
    await wait(300);
    enabled = (await cdp.eval(`(() => { const b = [...document.querySelectorAll(".modal-panel button")].find((x) => x.textContent.includes("保存到书架")); return b ? !b.disabled : false; })()`)) === true;
  }
  check("② 保存按钮随正文镜像解禁（canSave 门控）", enabled === true, JSON.stringify(enabled));
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".modal-panel button")].find((x) => x.textContent.includes("保存到书架")); b?.click(); return !!b; })()`);
  let cardUp = null;
  for (let i = 0; i < 20; i++) {
    await wait(500);
    cardUp = (await cdp.eval(`(() => {
      const title = [...document.querySelectorAll(".book-card-title")].find((x) => x.textContent.includes("D126 无封面测试书"));
      return { title: !!title, spine: !!document.querySelector(".book-card-spine") };
    })()`)) || {};
    if (cardUp.title) break;
  }
  check("② 无封面书入库：书卡标题在场（v48.122/D167 起为暖纸默认封面形态）", cardUp?.title === true, JSON.stringify(cardUp));
  check("② 无封面书入库：书脊小方块退役（.book-card-spine 不在场）", cardUp?.spine === false, JSON.stringify(cardUp));

  // ③ 摘录页空态：0 条待处理（无方点）+ 空态无装饰
  await navClick("摘录");
  await wait(1800);
  const extractEmpty = (await cdp.eval(`(() => {
    const cnt = document.querySelector(".extract-page .review-count");
    return {
      cnt: cnt?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      dot: !!document.querySelector(".extract-page .count-dot"),
      txt: document.querySelector(".extract-page .empty-state .empty-text")?.textContent ?? null,
      deco: !!document.querySelector(".extract-page .empty-deco")
    };
  })()`)) || {};
  check("③ 摘录页：「0 条待处理」计数在场（文案节距不变）", typeof extractEmpty.cnt === "string" && extractEmpty.cnt.includes("0") && extractEmpty.cnt.includes("条待处理"), extractEmpty.cnt);
  check("③ 摘录页：计数方点退役（.count-dot 不在场）", extractEmpty.dot === false, JSON.stringify(extractEmpty));
  check("③ 摘录页：空态一句话在场、三方块退役", typeof extractEmpty.txt === "string" && extractEmpty.txt.length > 0 && extractEmpty.deco === false, JSON.stringify(extractEmpty));

  // ④ 复习页空态（全新库无到期卡；如空态在场则不得带装饰）
  await navClick("复习");
  await wait(1600);
  const reviewEmpty = (await cdp.eval(`(() => {
    const es = document.querySelector(".review-session .empty-state");
    return { up: !!es, txt: es?.querySelector(".empty-text")?.textContent ?? null, deco: es ? !!es.querySelector(".empty-deco") : null };
  })()`)) || {};
  check("④ 复习页：空态（如在场）无三方块装饰", reviewEmpty.up === false || reviewEmpty.deco === false, JSON.stringify(reviewEmpty));

  // ⑤ 卡片页空态
  await navClick("卡片");
  await wait(1600);
  const cardsEmpty = (await cdp.eval(`(() => {
    const txt = document.querySelector(".empty-state .empty-text");
    return { txt: txt?.textContent ?? null, deco: !!document.querySelector(".empty-deco") };
  })()`)) || {};
  check("⑤ 卡片页：空态一句话在场（还没有卡片）", typeof cardsEmpty.txt === "string" && cardsEmpty.txt.includes("还没有卡片"), cardsEmpty.txt);
  check("⑤ 卡片页：三方块装饰退役", cardsEmpty.deco === false, JSON.stringify(cardsEmpty));

  // ⑥ 全应用扫掠：五类小方块类名零残留
  const sweep = await cdp.eval(`["empty-deco","empty-sq","count-dot","book-card-spine","mark-kind"].map((c) => c + ":" + document.querySelectorAll("." + c).length).join(",")`);
  check("⑥ 全应用扫掠：小方块类名零残留", /^([a-z-]+:0,){4}[a-z-]+:0$/.test(String(sweep)), sweep);

  console.log(`\nD126 结果: ${pass} 通过, ${fail} 失败`);
} catch (e) {
  console.error("套件异常:", e?.message || e);
  fail++;
} finally {
  try { electron?.kill(); } catch { /* 已退出 */ }
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  process.exit(fail ? 1 : 0);
}
