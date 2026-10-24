"use strict";
// C-29：开机自启 Linux XDG autostart 实现单测（报告验收三条 + win32/mac 行为不变守卫）——
//   linux：applyAutoLaunch(true) → $XDG_CONFIG_HOME/autostart/nutation.desktop 存在且含 Exec=；
//          isAutoLaunchOn() === true（文件存在即开启）；applyAutoLaunch(false) → 文件被删除；
//          APPIMAGE 环境变量存在时 Exec 指向 .AppImage 文件本身。
//   win32/darwin：仍走 app.setLoginItemSettings（桩记录调用），不落 XDG .desktop 文件。
// XDG_CONFIG_HOME 指向 fs.mkdtempSync 临时目录——绝不在真实 ~/.config/autostart 落文件。
// @runtime: electron-node
// 直跑：node scripts/run-tests.mjs autostart-linux（runner 按 @runtime 分流到 electron-node）
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// electron 桩（参照 tests/app-menu.test.cjs 先例）：electron-node 运行时 require("electron") 本返回
// 可执行文件路径字符串，app 为 undefined；桩提供 app 对象并记录 setLoginItemSettings 调用，
// 供 win32/mac 分支守卫断言（真实 app API 不可能在 electron-node 下使用）。
const setLoginItemSettingsCalls = [];
const loginItemSettingsState = { openAtLogin: false };
require.cache[require.resolve("electron")] = {
  exports: {
    app: {
      isPackaged: false,
      setLoginItemSettings(settings) {
        setLoginItemSettingsCalls.push(settings);
        loginItemSettingsState.openAtLogin = !!settings.openAtLogin;
      },
      getLoginItemSettings() {
        return { ...loginItemSettingsState };
      }
    }
  }
};

const qc = require(path.join(__dirname, "..", "electron", "quickCapture.js"));

// XDG_CONFIG_HOME 指向临时目录（用后还原 + 清理）
const xdgTmp = fs.mkdtempSync(path.join(os.tmpdir(), "nutation-c29-xdg-"));

const REAL_PLATFORM = process.platform;
const REAL_XDG = process.env.XDG_CONFIG_HOME;
const REAL_APPIMAGE = process.env.APPIMAGE;
function withPlatform(p, fn) {
  Object.defineProperty(process, "platform", { value: p, configurable: true, writable: true });
  try {
    fn();
  } finally {
    Object.defineProperty(process, "platform", { value: REAL_PLATFORM, configurable: true, writable: true });
  }
}

let n = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  n++;
}

const desktopFile = path.join(xdgTmp, "autostart", "nutation.desktop");

try {
  process.env.XDG_CONFIG_HOME = xdgTmp;

  // 报告验收 1-3：linux 分支
  withPlatform("linux", () => {
    ok(qc.isAutoLaunchOn() === false, "linux：无 .desktop 文件时 isAutoLaunchOn() === false");
    qc.applyAutoLaunch(true);
    ok(fs.existsSync(desktopFile), "applyAutoLaunch(true) → autostart/nutation.desktop 文件存在");
    const content = fs.readFileSync(desktopFile, "utf8");
    ok(content.includes("Exec="), ".desktop 内容含 Exec=");
    ok(content.includes("[Desktop Entry]"), ".desktop 含 [Desktop Entry] 头");
    ok(content.includes("Type=Application"), ".desktop 含 Type=Application");
    ok(content.includes("X-GNOME-Autostart-enabled=true"), ".desktop 含 X-GNOME-Autostart-enabled=true");
    ok(qc.isAutoLaunchOn() === true, "isAutoLaunchOn() === true（文件存在即视为开启）");
    qc.applyAutoLaunch(false);
    ok(!fs.existsSync(desktopFile), "applyAutoLaunch(false) → 文件被删除");
    ok(qc.isAutoLaunchOn() === false, "删除后 isAutoLaunchOn() === false");

    // AppImage 优先：Exec 必须指向 .AppImage 文件本身
    process.env.APPIMAGE = path.join(xdgTmp, "Nutation.AppImage");
    qc.applyAutoLaunch(true);
    ok(
      fs.readFileSync(desktopFile, "utf8").includes(`Exec="${path.join(xdgTmp, "Nutation.AppImage")}"`),
      "APPIMAGE 存在时 Exec= 指向 .AppImage 文件本身"
    );
    qc.applyAutoLaunch(false); // 清场：给 win32/mac 守卫一个无文件的起点
    ok(!fs.existsSync(desktopFile), "AppImage 复开后再关 → 文件再次被删除");
    if (REAL_APPIMAGE === undefined) delete process.env.APPIMAGE;
    else process.env.APPIMAGE = REAL_APPIMAGE;
  });

  // 守卫：win32 分支行为不变——仍走 app.setLoginItemSettings，不落 XDG 文件
  withPlatform("win32", () => {
    const callsBefore = setLoginItemSettingsCalls.length;
    qc.applyAutoLaunch(true);
    ok(setLoginItemSettingsCalls.length === callsBefore + 1, "win32：applyAutoLaunch(true) 仍走 app.setLoginItemSettings");
    ok(setLoginItemSettingsCalls[setLoginItemSettingsCalls.length - 1].openAtLogin === true, "win32：openAtLogin=true 原样传递");
    ok(!fs.existsSync(desktopFile), "win32：不落 XDG .desktop 文件");
    loginItemSettingsState.openAtLogin = true;
    ok(qc.isAutoLaunchOn() === true, "win32：isAutoLaunchOn() 读 app.getLoginItemSettings().openAtLogin");
    qc.applyAutoLaunch(false);
    ok(setLoginItemSettingsCalls[setLoginItemSettingsCalls.length - 1].openAtLogin === false, "win32：applyAutoLaunch(false) 仍走 app API");
    ok(!fs.existsSync(desktopFile), "win32：applyAutoLaunch(false) 也不落 XDG 文件");
  });

  // 守卫：darwin 分支行为不变
  withPlatform("darwin", () => {
    const callsBefore = setLoginItemSettingsCalls.length;
    qc.applyAutoLaunch(true);
    ok(setLoginItemSettingsCalls.length === callsBefore + 1, "darwin：applyAutoLaunch(true) 仍走 app.setLoginItemSettings");
    ok(!fs.existsSync(desktopFile), "darwin：不落 XDG .desktop 文件");
  });

  // mock 还原断言
  assert.strictEqual(process.platform, REAL_PLATFORM, "platform mock 已还原");
  n++;
} finally {
  if (REAL_XDG === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = REAL_XDG;
  if (REAL_APPIMAGE !== undefined) process.env.APPIMAGE = REAL_APPIMAGE;
  fs.rmSync(xdgTmp, { recursive: true, force: true, maxRetries: 5 });
}

assert.strictEqual(process.env.XDG_CONFIG_HOME, REAL_XDG, "XDG_CONFIG_HOME 已还原");
n++;
console.log(`autostart-linux ok：${n} 断言全过（linux XDG autostart 开/读回/关 + AppImage 优先 + win32/mac 仍走 app API 且不落 XDG 文件 + mock 已还原）`);
