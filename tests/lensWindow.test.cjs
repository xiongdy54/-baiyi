// 结构图独立窗口 · 呼出状态机 + 内容自适应纸片窗口回归（D200 / D203）
// @runtime: electron  @tier: 2  @gui: false  @id: LENSWIN  @timeout: 120
// 运行：npx electron tests/lensWindow.test.cjs   （须先关应用）
// 隔离：userData 指向临时目录（mkdtemp），不触碰真实库（§7.3）。
// 覆盖：① 创建选项（transparent / frame:false / resizable:false / hasShadow:false / roundedCorners:false / #00000000）
//       与零穿透 API；
//       ② lens:fit 可见时落窗、探测 focus 不落窗、隐藏暂存、show 后应用、内容 + 留白 ≤ 窗口；
//       ③ 隐藏 + 页面重载进行中 show() → 重载完成自动恢复（D200 主症状：按钮高亮但窗口永不出现）
//       ④ 加载悬挂 → 2s 安全阀强制显示（vite 半死：端口在、请求不回）
//       ⑤ 完全离屏 → show 时重新贴回工作区（显示器休眠 / 重排残留坐标）
//       ⑥ 挂起中 hide() → 安全阀不得把窗口弹出（后写优先）
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
/** 窗口 bounds 是否与任一显示器工作区有交集（与 lensWindow.offScreen 同判据） */
const onAnyDisplay = (w) => {
  const b = w.getBounds();
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
  });
};
const inside = (b, a) => b.x >= a.x - 1 && b.y >= a.y - 1 && b.x + b.width <= a.x + a.width + 1 && b.y + b.height <= a.y + a.height + 1;

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lenswin-test-"));
  try {
    app.setPath("userData", tmp);
    const lensWindow = require(path.join(ROOT, "electron", "lensWindow.js"));
    const lensSrc = fs.readFileSync(path.join(ROOT, "electron", "lensWindow.js"), "utf8");
    const opts = lensWindow.lensWindowOptions();

    console.log("== 0 创建选项 / 禁区（D203） ==");
    check(
      "A0 创建选项：transparent / frame:false / resizable:false / hasShadow:false / roundedCorners:false / #00000000 / 种子 360×248",
      opts.transparent === true && opts.frame === false && opts.resizable === false &&
        opts.hasShadow === false && opts.roundedCorners === false &&
        opts.backgroundColor === "#00000000" && opts.width === 360 && opts.height === 248 &&
        !("minWidth" in opts) && !("minHeight" in opts),
      opts,
    );
    check("A0b 桥面安全：contextIsolation + 无 nodeIntegration；置顶参数可控", opts.webPreferences.contextIsolation === true && opts.webPreferences.nodeIntegration === false && lensWindow.lensWindowOptions({ pinned: false }).alwaysOnTop === false);
    check("A0c 窗口代码零 setIgnoreMouseEvents / 零 locked 字段（不做穿透/锁定）", !lensSrc.includes("setIgnoreMouseEvents") && !/\blocked\s*:/.test(lensSrc));

    // 仿主窗口（position() 需要；隐藏即可）
    const main = new BrowserWindow({ show: false, width: 900, height: 700 });
    lensWindow.init({ readSettings: () => ({ app: {} }), getMainWindow: () => main });
    const lensWin = () => BrowserWindow.getAllWindows().find((w) => w !== main && w.getTitle() === "结构图") || null;
    /** 悬挂服务：接受连接但永不响应（模拟 vite 半死态） */
    const hangServer = (port) => new Promise((res) => {
      const s = net.createServer(() => {});
      s.listen(port, "127.0.0.1", () => res(s));
    });

    // ── 首次打开：一切正常（旧实现里 ready-to-show 监听器在此被一次性消耗）
    lensWindow.control("show");
    await sleep(2500);
    const w = lensWin();
    check("A 首次 show 可见", !!w && w.isVisible(), String(w && w.isVisible()));

    console.log("== F lens:fit：主进程算尺寸 / 钳制 / 隐藏暂存 / 探测不落窗 ==");
    const wa = screen.getDisplayMatching(w.getBounds()).workArea;
    const fit1 = lensWindow.fit({ content: { w: 536, h: 168 }, mode: "fit" });
    await sleep(150);
    const bFit1 = w.getBounds();
    check("F1 可见时立即落窗：536×168 → 568×216（±1px）", Math.abs(bFit1.width - 568) <= 1 && Math.abs(bFit1.height - 216) <= 1, bFit1);
    check(
      "F2 返回 s=1 / tier=100% / 窗口在 workArea 内 / 不超 92%",
      fit1.scale === 1 && fit1.tier === "100%" && inside(fit1.bounds, wa) && fit1.bounds.width <= Math.floor(wa.width * 0.92) && fit1.bounds.height <= Math.floor(wa.height * 0.92),
      { fit1, wa },
    );
    check(
      "F3 内容 + 留白 ≤ 窗口（留白不参与缩放）",
      536 * fit1.scale + 32 <= bFit1.width + 1.5 && 168 * fit1.scale + 48 <= bFit1.height + 1.5,
      bFit1,
    );
    const probe = lensWindow.fit({ content: { w: 100000, h: 152 }, mode: "fit" });
    await sleep(100);
    const bProbe = w.getBounds();
    check("F4 fit 探测 tier=focus：不把窗口落成巨型图（只回探测结果）", probe.tier === "focus" && bProbe.width === bFit1.width && bProbe.height === bFit1.height, { probe, bProbe });
    w.hide();
    const bHidden = w.getBounds();
    const fitHidden = lensWindow.fit({ content: { w: 764, h: 156 }, mode: "fit" });
    check("F5 隐藏时只暂存：窗口 bounds 不变", w.getBounds().width === bHidden.width && w.getBounds().height === bHidden.height, { before: bHidden, after: w.getBounds() });
    check("F6 隐藏 fit 仍返回目标（796×204 / s=1）", fitHidden.scale === 1 && fitHidden.bounds.width === 796 && fitHidden.bounds.height === 204, fitHidden);
    lensWindow.control("show");
    await sleep(700);
    const bShown = w.getBounds();
    check("F7 show 后应用暂存尺寸（±1px）", Math.abs(bShown.width - 796) <= 1 && Math.abs(bShown.height - 204) <= 1, bShown);
    const fitBody = lensSrc.slice(lensSrc.indexOf("function fit("), lensSrc.indexOf("function reveal("));
    check("F8 fit 路径不抢焦点（自动尺寸更新只 setBounds，无 focus 调用）", !/\.focus\(\)/.test(fitBody), "fit() 内无 focus 调用");

    console.log("== G D204 展开/收起：anchorScreen 钉住节点 + 180ms bounds 缓动 ==");
    const wa2 = screen.getDisplayMatching(w.getBounds()).workArea;
    const anchorScreen = { x: wa2.x + 400, y: wa2.y + 300 };
    const gTarget = lensWindow.fit({
      content: { w: 1000, h: 152 }, mode: "fit", animate: true,
      anchor: { id: "n1", x: 0, y: 52, w: 400, h: 48 }, anchorScreen,
    });
    const gFrom = w.getBounds();
    await sleep(55);
    const gMid = w.getBounds();
    await sleep(320);
    const gEnd = w.getBounds();
    check("G1 缓动中：窗口 bounds 处于起止之间（不是瞬时跳到终点）", gMid.width > gFrom.width && gMid.width < gEnd.width, { from: gFrom, mid: gMid, end: gEnd, target: gTarget.bounds });
    check("G2 ~180ms 后到达目标（±1px）", Math.abs(gEnd.width - gTarget.bounds.width) <= 1 && Math.abs(gEnd.height - gTarget.bounds.height) <= 1, { end: gEnd, target: gTarget.bounds });
    const gAx = gEnd.x + 16 + 200 * gTarget.scale;
    const gAy = gEnd.y + 32 + 76 * gTarget.scale;
    check("G3 被点节点中心仍在 anchorScreen（±1px，非贴边）", Math.abs(gAx - anchorScreen.x) <= 1 && Math.abs(gAy - anchorScreen.y) <= 1 && !gTarget.clamped, { ax: gAx, ay: gAy, anchorScreen, target: gTarget });
    // 缓动中 hide：先补到目标再隐藏，下次呼出不会停在中途尺寸
    const g2 = lensWindow.fit({ content: { w: 1200, h: 152 }, mode: "fit", animate: true, anchor: { id: "n1", x: 0, y: 52, w: 400, h: 48 }, anchorScreen });
    await sleep(45);
    lensWindow.control("hide");
    await sleep(350);
    lensWindow.control("show");
    await sleep(500);
    const gShow = w.getBounds();
    check("G4 缓动中 hide 先补到目标；再次 show 尺寸即目标（±1px）", Math.abs(gShow.width - g2.bounds.width) <= 1 && Math.abs(gShow.height - g2.bounds.height) <= 1, { show: gShow, target: g2.bounds });

    console.log("== B 隐藏 + 重载进行中 show() → 重载完成自动恢复（D200 主症状） ==");
    w.hide();
    w.webContents.reload();
    const s1 = lensWindow.control("show"); // isLoading=true → 挂起
    check("B1 挂起期间不可见（加载中不闪白）", !w.isVisible() && !!s1, `visible=${w.isVisible()} ret=${JSON.stringify(s1)}`);
    await sleep(3000);
    check("B2 重载完成后自动恢复可见", w.isVisible(), `visible=${w.isVisible()}`);

    console.log("== C 加载悬挂 → 2s 安全阀强制显示 ==");
    const hang = await hangServer(9231);
    w.hide();
    w.webContents.loadURL("http://127.0.0.1:9231/lens.html").catch(() => {});
    await sleep(150);
    check("C1 悬挂加载中 isLoading=true", w.webContents.isLoading(), String(w.webContents.isLoading()));
    lensWindow.control("show");
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
    lensWindow.control("show");
    await sleep(2600);
    check("D2 show 后贴回工作区", w.isVisible() && onAnyDisplay(w), `visible=${w.isVisible()} bounds=${JSON.stringify(w.getBounds())}`);

    console.log("== E 挂起中 hide() → 安全阀不得弹窗（后写优先） ==");
    const hang2 = await hangServer(9233);
    w.hide();
    w.webContents.loadURL("http://127.0.0.1:9233/lens.html").catch(() => {});
    await sleep(150);
    lensWindow.control("show");  // 挂起 + 武装安全阀
    lensWindow.control("hide");  // 用户改主意
    await sleep(2600);
    check("E hide 后安全阀不弹窗", !w.isVisible(), String(w.isVisible()));
    hang2.close();

    console.log(`结果：${pass} 通过，${fail} 失败`);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows 句柄延迟释放，留给系统临时目录 */ }
    app.exit(fail ? 1 : 0);
  }
});
