// R2 收尾审计 GUI 冒烟（MOTION-DESIGN-SPEC §17-R2 R2-8：六场景 + 闸门/方向机械验证）
// @runtime: node  @tier: 2  @gui: true  @id: R2SMOKE  @timeout: 300
// 运行：npm run build 之后 `node tests/r2-smoke.gui.mjs`（CDP 驱动 dist 上的真实应用，自启自关）
// 隔离：M7_TEST_USERDATA 指向 tests/tmp-r2smoke-userdata（先清空，全新库），绝不触碰真实库（§7.3）。
// 肉眼项的降级口径：闪烁/双动效不可自动目视，用 computed style + dataset 生命周期 + getAnimations()
// 机械替代（D106 先例：「写了规则不等于生效」，一律断言计算样式）。
import { spawn, execSync } from "node:child_process";
import fs, { openSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9246";
const USER_DATA = path.join(ROOT, "tests", "tmp-r2smoke-userdata");

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

const navClick = (label) => `(() => { const b = [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); b?.click(); return "nav"; })()`;
// 点击后轮询捕获 (data-vt, data-vt-dir) 首次出现值（顶栏同步写；openBook 异步链晚写）——§5.1/§5.2 生命周期
const pollVt = async (cdp, clickExpr, timeout = 1500) => {
  await cdp.eval(clickExpr);
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const s = await cdp.eval(`JSON.stringify({ vt: document.documentElement.dataset.vt || null, dir: document.documentElement.dataset.vtDir || null })`);
    if (!String(s).startsWith("EXC")) {
      const o = JSON.parse(String(s));
      if (o.vt === "1") return o;
    }
    await wait(30);
  }
  return { vt: null, dir: null };
};
const vtCleared = async (cdp) => {
  await wait(650);
  return await cdp.eval(`!!document.documentElement.dataset.vt`);
};
const cs = (cdp, sel, prop) => cdp.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? getComputedStyle(e).${prop} : "ABSENT"; })()`);

try {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(800);
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  const seeded = execSync("npx electron tests/r2-smoke.seed.cjs", {
    cwd: ROOT, shell: true, encoding: "utf8",
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  check("播种成功", /SEEDED/.test(String(seeded)), seeded.slice(-120));

  const out = openSync(path.join(ROOT, "tests", "r2-smoke.gui.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: false,
    env: { ...process.env, M7_TEST_USERDATA: USER_DATA }
  });
  const cdp = await connect();
  await wait(2500);
  check("应用启动", (await cdp.eval(`!!document.querySelector("#root")`)) === true, "未挂载");

  // ============ 场景 1：冷启动首屏（§5.3 首屏入场） ============
  console.log("— 场景 1：冷启动首屏 —");
  check("S1 .app-shell 挂载", (await cdp.eval(`!!document.querySelector(".app-shell")`)) === true, "无 .app-shell");
  const s1anim = await cs(cdp, ".app-shell", "animationName");
  const s1dur = await cs(cdp, ".app-shell", "animationDuration");
  check("S1 app-shell-in 在播（no-preference 计算样式）", s1anim === "app-shell-in", s1anim);
  check("S1 时长 = --dur-view 0.2s（不拖过 200ms）", s1dur === "0.2s", s1dur);

  // ============ 场景 2：六页签往返方向（§5.1 页序表 + reader 特则） ============
  console.log("— 场景 2：六页签往返方向 —");
  let r2 = await pollVt(cdp, navClick("摘录"));
  check("S2 书架(0)→摘录(1) = fwd", r2.vt === "1" && r2.dir === "fwd", JSON.stringify(r2));
  check("S2 过渡结算后 data-vt 清除（finally 路径）", (await vtCleared(cdp)) === false, "data-vt 残留");
  r2 = await pollVt(cdp, navClick("摘录"));
  check("S2 同席自切 queue→queue：vt 在场、无 dir（纯 crossfade）", r2.vt === "1" && r2.dir === null, JSON.stringify(r2));
  await vtCleared(cdp);
  r2 = await pollVt(cdp, navClick("复习"));
  check("S2 摘录(1)→复习(2) = fwd", r2.vt === "1" && r2.dir === "fwd", JSON.stringify(r2));
  await vtCleared(cdp);
  // S2.5 复习 1 张卡产生 review_logs（供 S5 数据页图表有数据）
  await cdp.eval(`(() => { document.querySelector('[data-review-bar] [data-reveal]')?.click(); return "revealed"; })()`);
  await wait(700);
  await cdp.eval(`(() => { document.querySelector(".grade.grade-good")?.click(); return "graded"; })()`);
  await wait(900);
  r2 = await pollVt(cdp, navClick("书架"));
  check("S2 复习(2)→书架(0) = bwd", r2.vt === "1" && r2.dir === "bwd", JSON.stringify(r2));
  await vtCleared(cdp);
  r2 = await pollVt(cdp, navClick("卡片"));
  check("S2 书架(0)→卡片(3) = fwd", r2.vt === "1" && r2.dir === "fwd", JSON.stringify(r2));
  await vtCleared(cdp);
  r2 = await pollVt(cdp, navClick("日记"));
  check("S2 卡片(3)→日记(4) = fwd", r2.vt === "1" && r2.dir === "fwd", JSON.stringify(r2));
  await vtCleared(cdp);
  r2 = await pollVt(cdp, navClick("数据"));
  check("S2 日记(4)→数据(5) = fwd", r2.vt === "1" && r2.dir === "fwd", JSON.stringify(r2));
  await vtCleared(cdp);
  r2 = await pollVt(cdp, navClick("卡片"));
  check("S2 数据(5)→卡片(3) = bwd", r2.vt === "1" && r2.dir === "bwd", JSON.stringify(r2));
  await vtCleared(cdp);
  r2 = await pollVt(cdp, navClick("书架"));
  check("S2 卡片(3)→书架(0) = bwd", r2.vt === "1" && r2.dir === "bwd", JSON.stringify(r2));
  await vtCleared(cdp);
  // reader 特则：进入恒 fwd、离开恒 bwd（不按数值比较）
  r2 = await pollVt(cdp, `(() => { document.querySelector(".shelf-item .book-card")?.click(); return "open"; })()`, 4000);
  check("S2 书架→reader = fwd（深度视图特则）", r2.vt === "1" && r2.dir === "fwd", JSON.stringify(r2));
  await wait(2500); // 阅读器内核挂载
  r2 = await pollVt(cdp, navClick("书架"), 3000);
  check("S2 reader→书架 = bwd（离开恒返回）", r2.vt === "1" && r2.dir === "bwd", JSON.stringify(r2));
  await vtCleared(cdp);

  // ============ 场景 3：书架往返 stagger（§10-R2） ============
  console.log("— 场景 3：书架往返 stagger —");
  await pollVt(cdp, navClick("日记"));
  await wait(700);
  r2 = await pollVt(cdp, navClick("书架"));
  check("S3 他页→书架过渡在场（闸门期数据已到）", r2.vt === "1", JSON.stringify(r2));
  await wait(380); // 揭幕（≈300ms）后的观察窗（原 stagger 观察窗；动画停用后仍留同窗防竞态）
  // 2026-10-09 切页动效统一（提交 1d0c070）：书架页面级入场（shelf-item-in stagger 30ms/张）
  // 已停用删除（grep src=0，keyframes 一并退役），页面入场只由 §5.1 View Transition 承担（上行已验）；
  // shelf-enter 容器标记只在挂载后 items 空→非空的首个渲染周期武装（Bookshelf enterArmed 单次），
  // 回访经 shelfCache 首渲染即非空 → 不再重现。原三条探针（容器带 shelf-enter / shelf-item-in
  // 在播 / 分档递增）按现行口径重写为等价观测。
  const s3container = await cdp.eval(`(() => { const g = document.querySelector(".bookshelf-grid"); return g ? g.className : "ABSENT"; })()`);
  check("S3 回访网格不带 shelf-enter（无二次入场周期）", String(s3container).includes("bookshelf-grid") && !String(s3container).includes("shelf-enter"), s3container);
  const s3anim = await cs(cdp, ".bookshelf-grid > .shelf-item", "animationName");
  check("S3 卡片无逐卡入场动画（stagger 已停用，入场全归 View Transition）", s3anim === "none", s3anim);
  const s3cover = await cdp.eval(`(() => { const c = document.querySelector(".cover-img"); if (!c) return "NO_ASSET"; return c.classList.contains("is-loaded") ? getComputedStyle(c).opacity : "NOT_LOADED"; })()`);
  // 粘贴书无封面资产（cover-img 不渲染，走书脊占位）＝库态限制：封面解码淡入路径以静态证据对账
  // （Bookshelf.tsx onLoad→is-loaded + theme.css cover-img 规则，R2-4 两轮审查已过），此处仅在场时断言终态。
  check("S3 封面解码淡入（无资产库态下降级：在场才验终态）", s3cover === "NO_ASSET" || s3cover === "1", s3cover);

  // ============ 场景 4：摘录两态入场一致 + 对齐（§18） ============
  console.log("— 场景 4：摘录两态入场一致 + 对齐 —");
  await pollVt(cdp, navClick("摘录"));
  await wait(420); // 揭幕后 content-fade-in（200ms）播放中/刚毕、content-enter 摘除（700ms）前
  const s4page = await cdp.eval(`(() => { const p = document.querySelector(".extract-page"); return p ? p.className : "ABSENT"; })()`);
  check("S4 页面根带 content-enter（loaded 首转真周期）", String(s4page).includes("content-enter"), s4page);
  // 2026-10-09 切页动效统一（提交 1d0c070）：content-enter 整体淡入（content-fade-in）已停用——
  // 揭幕后整页再从 opacity 0 淡入＝「闪一下」，页面入场只由 §5.1 View Transition 承担；
  // content-enter 容器类与 data-first-card 首卡抑制标记保留（本段上下两条仍在验）。
  const s4cols = await cs(cdp, ".extract-page.content-enter > .extract-page-cols", "animationName");
  check("S4 就绪无二次淡入（content-fade-in 已停用，动画不在场）", s4cols === "none", s4cols);
  const s4first = await cdp.eval(`(() => { const p = document.querySelector(".extract-page[data-first-card]"); if (!p) return "NO_MARK"; const f = p.querySelector(".extract-face"); return f ? getComputedStyle(f).animationName : "NO_FACE"; })()`);
  check("S4 首卡抑制：data-first-card 周期内 stage-card-in = none", s4first === "none", s4first);
  const align = async () => cdp.eval(`(() => {
    const sels = [".extract-page-head-inner", ".extract-face", ".extract-page .stage-bar-inner"];
    const ls = sels.map((s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().left * 10) / 10 : null; });
    if (ls.some((v) => v === null)) return JSON.stringify({ ok: false, ls });
    return JSON.stringify({ ok: Math.max(...ls) - Math.min(...ls) <= 1, ls });
  })()`);
  let a4 = JSON.parse(String(await align()));
  check("S4 收起态三列左缘对齐（头带内列＝卡面＝底栏内列，±1px）", a4.ok === true, JSON.stringify(a4));
  await cdp.eval(`(() => { document.querySelector("[data-annot-toggle]")?.click(); return "toggled"; })()`);
  await wait(500); // 轨开合 240ms 过渡完毕
  a4 = JSON.parse(String(await align()));
  check("S4 展开态三列左缘对齐（轨 280 让位下恒齐）", a4.ok === true, JSON.stringify(a4));
  await cdp.eval(`(() => { document.querySelector("[data-annot-toggle]")?.click(); return "restored"; })()`);
  await wait(450);

  // ============ 场景 5：数据页首载入场完整（§6.3/§5.2 闸门效应） ============
  console.log("— 场景 5：数据页首载入场完整 —");
  r2 = await pollVt(cdp, navClick("数据"));
  check("S5 摘录(1)→数据(5) = fwd", r2.vt === "1" && r2.dir === "fwd", JSON.stringify(r2));
  await wait(500); // 揭幕后（≈300ms）+ IPC 数据到达（≈10-50ms）+ 图表挂载
  // chart v2 rework（D122，§6.1-E4）+ 2026-10-09 切页动效统一（提交 1d0c070）：.chart-enter
  // 容器类已从全部组件删除（grep src 组件=0），图表首挂载入场（chart-bar-in + 30ms/根 stagger）
  // 整体停用（keyframes 保留无消费点）——揭幕后数据以终态直出，页面入场只由 §5.1 View Transition
  // 承担（上行已验 fwd）；折线 chart-redraw 与数据更新几何过渡不受影响。原三条探针（chart-enter
  // 容器在场 / chart-bar-in 在播 / 分档在场）按现行口径重写为等价观测。
  const s5charts = await cdp.eval(`document.querySelectorAll(".chart-svg").length`);
  const s5enter = await cdp.eval(`document.querySelectorAll(".chart-enter").length`);
  check("S5 图表挂载（.chart-svg ≥1）且 chart-enter 容器类已退役（=0）", Number(s5charts) >= 1 && Number(s5enter) === 0, JSON.stringify({ charts: s5charts, enter: s5enter }));
  const s5anim = await cs(cdp, ".chart-svg", "animationName");
  check("S5 图表首挂载无入场动画（终态直出，animation none）", s5anim === "none", s5anim);
  const s5widget = await cs(cdp, ".dash-widget", "animationName") + " / " + await cs(cdp, ".dash-widget", "transitionProperty");
  check("S5 .dash-widget 容器无入场/过渡（E4 收窄）", String(s5widget) === "none / all" || String(s5widget).startsWith("none"), s5widget);

  // ============ 场景 6：reduce 全瞬时（CDP Emulation.setEMMediaFeature 等价） ============
  console.log("— 场景 6：reduce 全瞬时 —");
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await cdp.send("Page.reload", {});
  await wait(2500);
  const s6shell = await cs(cdp, ".app-shell", "animationName");
  check("S6 reduce：app-shell-in 规则不在场（animation none）", s6shell === "none", s6shell);
  await pollVt(cdp, navClick("书架"));
  await wait(700);
  await pollVt(cdp, navClick("摘录"));
  await wait(800); // 揭幕 + 数据到达 + content-enter 周期
  const s6anims = await cdp.eval(`document.getAnimations().length`);
  check("S6 reduce：全文档 0 条运行中动画/过渡（getAnimations）", Number(s6anims) === 0, s6anims);
  // 恢复环境（脚本自启自关，reload 已含；此处仅复位仿真，防同进程复用）
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "" }] });

  console.log(`\\nR2 冒烟结果：${pass} pass / ${fail} fail`);
  console.log("SMOKEDONE");
} catch (e) {
  console.error("SMOKEFATAL", e);
  fail++;
} finally {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 已退出 */ }
  process.exit(fail ? 1 : 0);
}
