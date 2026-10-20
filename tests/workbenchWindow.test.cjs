// 制卡台独立窗口 · 呼出状态机回归（D201：呼出请求被加载态吞没的修复，与 lensWindow.test.cjs 同构）
// @runtime: electron  @tier: 2  @gui: false  @id: WBWIN  @timeout: 120
// 运行：npx electron tests/workbenchWindow.test.cjs   （须先关应用）
// 隔离：userData 指向临时目录（mkdtemp），不触碰真实库（§7.3）。
// 覆盖：① 隐藏 + 页面重载进行中 show() → 重载完成自动恢复（D200 同构主症状）
//       ② 加载悬挂 → 2s 安全阀强制显示（vite 半死：端口在、请求不回）
//       ③ 完全离屏 → show 时重新贴回工作区（显示器休眠 / 重排残留坐标）
//       ④ 挂起中 hide() → 安全阀不得把窗口弹出（后写优先）
const { app, BrowserWindow, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const net = require("net");
const ROOT = path.join(__dirname, "..");

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${actual}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 窗口 bounds 是否与任一显示器工作区有交集（与 workbenchWindow.offScreen 同判据） */
const onAnyDisplay = (w) => {
  const b = w.getBounds();
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
  });
};

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wbwin-test-"));
  try {
    app.setPath("userData", tmp);
    const workbenchWindow = require(path.join(ROOT, "electron", "workbenchWindow.js"));

    workbenchWindow.init({ readSettings: () => ({ app: {} }) });
    const wbWin = () => BrowserWindow.getAllWindows().find((w) => w.getTitle() === "制卡台") || null;
    /** 悬挂服务：接受连接但永不响应（模拟 vite 半死态） */
    const hangServer = (port) => new Promise((res) => {
      const s = net.createServer(() => {});
      s.listen(port, "127.0.0.1", () => res(s));
    });

    // ── 首次打开：一切正常（旧实现里 ready-to-show 监听器在此被一次性消耗）
    workbenchWindow.control("show");
    await sleep(2500);
    const w = wbWin();
    check("A 首次 show 可见", !!w && w.isVisible(), String(w && w.isVisible()));

    console.log("== B 隐藏 + 重载进行中 show() → 重载完成自动恢复（D200 同构主症状） ==");
    w.hide();
    w.webContents.reload();
    const s1 = workbenchWindow.control("show"); // isLoading=true → 挂起
    check("B1 挂起期间不可见（加载中不闪白）", !w.isVisible() && !!s1, `visible=${w.isVisible()} ret=${JSON.stringify(s1)}`);
    await sleep(3000);
    check("B2 重载完成后自动恢复可见", w.isVisible(), `visible=${w.isVisible()}`);

    console.log("== C 加载悬挂 → 2s 安全阀强制显示 ==");
    const hang = await hangServer(9241);
    w.hide();
    w.webContents.loadURL("http://127.0.0.1:9241/workbench.html").catch(() => {});
    await sleep(150);
    check("C1 悬挂加载中 isLoading=true", w.webContents.isLoading(), String(w.webContents.isLoading()));
    workbenchWindow.control("show");
    await sleep(400);
    check("C2 400ms 时仍挂起（未提前闪现）", !w.isVisible(), String(w.isVisible()));
    await sleep(2400);
    check("C3 安全阀 2s 内强制显示", w.isVisible(), String(w.isVisible()));
    hang.close();

    console.log("== D 完全离屏 → show 时重新贴回工作区 ==");
    // （前置：C 的悬挂加载令 loaded=false，本节 show 走挂起路径，安全阀 2s 后 reveal——须等过阀再断言）
    w.hide();
    w.setPosition(30000, 30000); // 模拟显示器重排残留坐标（Windows 会钳到虚拟屏边，仍离屏）
    check("D1 前置：坐标确实离屏", !onAnyDisplay(w), JSON.stringify(w.getBounds()));
    workbenchWindow.control("show");
    await sleep(2600);
    check("D2 show 后贴回工作区", w.isVisible() && onAnyDisplay(w), `visible=${w.isVisible()} bounds=${JSON.stringify(w.getBounds())}`);

    console.log("== E 挂起中 hide() → 安全阀不得弹窗（后写优先） ==");
    const hang2 = await hangServer(9243);
    w.hide();
    w.webContents.loadURL("http://127.0.0.1:9243/workbench.html").catch(() => {});
    await sleep(150);
    workbenchWindow.control("show");  // 挂起 + 武装安全阀
    workbenchWindow.control("hide");  // 用户改主意
    await sleep(2600);
    check("E hide 后安全阀不弹窗", !w.isVisible(), String(w.isVisible()));
    hang2.close();

    console.log(`结果：${pass} 通过，${fail} 失败`);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows 句柄延迟释放，留给系统临时目录 */ }
    app.exit(fail ? 1 : 0);
  }
});
