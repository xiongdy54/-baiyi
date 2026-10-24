"use strict";
// C-30：updater source() 渠道判定单测——Linux 非 AppImage（deb/rpm 安装，无 APPIMAGE env）
// 返回 "unsupported"（报告 C-30 第 4 步；设置页显示「请通过软件包管理器更新」），
// AppImage（APPIMAGE env 指向自身）仍走 GitHub Releases 渠道，win/mac 既有渠道行为不变。
// @runtime: electron-node
// 直跑：node scripts/run-tests.mjs updater-source（runner 按 @runtime 分流到 electron-node）
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REAL_PLATFORM = process.platform;
const REAL_RESOURCES = process.resourcesPath;
const REAL_APPIMAGE = process.env.APPIMAGE;
const REAL_WINSTORE = process.windowsStore;

let n = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  n++;
}

// electron 桩（app-menu.test.cjs 先例）：updater.js 顶部 require("electron") 解构 app/ipcMain；
// app.isPackaged / getVersion 按场景改写（updater 在调用时读取，非模块加载时）
const stubIpc = { handle() {} };
const stubApp = { isPackaged: false, getVersion: () => "0.0.1" };
require.cache[require.resolve("electron")] = { exports: { app: stubApp, ipcMain: stubIpc } };
const { source, snapshot } = require(path.join(__dirname, "..", "electron", "updater.js"));

// platform mock（close-to-tray.test.cjs 同款 + 还原断言）
function withPlatform(p, fn) {
  Object.defineProperty(process, "platform", { value: p, configurable: true, writable: true });
  try {
    fn();
  } finally {
    Object.defineProperty(process, "platform", { value: REAL_PLATFORM, configurable: true, writable: true });
  }
}

// 1) dev：未打包恒为 dev
stubApp.isPackaged = false;
process.windowsStore = false;
delete process.env.APPIMAGE;
ok(source() === "dev", "未打包 → dev（行为不变）");

// 2) store：MSIX 包身份优先于其他判定
stubApp.isPackaged = true;
process.windowsStore = true;
ok(source() === "store", "windowsStore → store（行为不变）");

// 3) linux deb/rpm（无 APPIMAGE）→ unsupported，且快照 enabled=false（设置页隐藏自更新控件）
process.windowsStore = false;
withPlatform("linux", () => {
  delete process.env.APPIMAGE;
  ok(source() === "unsupported", "linux 无 APPIMAGE → unsupported（C-30 报告第 4 步）");
  const s = snapshot();
  ok(s.source === "unsupported", "快照 source=unsupported");
  ok(s.enabled === false, "快照 enabled=false（不自更新）");
});

// 4) linux AppImage（APPIMAGE env）→ 读资源内 app-update.yml → github 渠道
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "c30-updater-"));
const realYml = "owner: xiongdy54\nrepo: Nutation\nprovider: github\n";
fs.writeFileSync(path.join(tmp, "app-update.yml"), realYml);
// Electron 运行时下 process.resourcesPath 是只读属性，走 defineProperty 注入（platform mock 同款）
Object.defineProperty(process, "resourcesPath", { value: tmp, configurable: true, writable: true });
withPlatform("linux", () => {
  process.env.APPIMAGE = path.join(tmp, "Nutation.AppImage");
  ok(source() === "github", "linux AppImage → 读 app-update.yml → github 渠道");
  ok(snapshot().enabled === true, "AppImage 渠道 enabled=true（自更新可用）");
});

// 5) win32：占位 slug → unconfigured（既有行为不变）
fs.writeFileSync(path.join(tmp, "app-update.yml"), "owner: YOUR_GITHUB_USERNAME\nrepo: incremental-reading\n");
withPlatform("win32", () => {
  delete process.env.APPIMAGE;
  ok(source() === "unconfigured", "win32 占位 slug → unconfigured（行为不变）");
});

// 6) win32：无 app-update.yml → unconfigured（既有行为不变）
fs.rmSync(path.join(tmp, "app-update.yml"));
withPlatform("win32", () => {
  ok(source() === "unconfigured", "win32 无 app-update.yml → unconfigured（行为不变）");
});

// 7) darwin：不受 C-30 linux 分支影响（无 yml → unconfigured，说明走的是原有路径）
withPlatform("darwin", () => {
  ok(source() === "unconfigured", "darwin 无 app-update.yml → unconfigured（行为不变）");
});

// 清场：临时目录 + 进程属性还原
fs.rmSync(tmp, { recursive: true, force: true });
if (REAL_APPIMAGE === undefined) delete process.env.APPIMAGE;
else process.env.APPIMAGE = REAL_APPIMAGE;
process.windowsStore = REAL_WINSTORE;
if (REAL_RESOURCES === undefined) delete process.resourcesPath;
else process.resourcesPath = REAL_RESOURCES;
assert.strictEqual(process.platform, REAL_PLATFORM, "platform mock 已还原");

console.log(`updater-source ok：${n} 断言全过（linux 无 APPIMAGE → unsupported / AppImage → github / dev、store、win32、darwin 渠道行为不变 / 进程属性已还原）`);
