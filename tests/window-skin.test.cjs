// C-31 窗口外观同步守卫。@runtime: system-node（readAppearance 语义 + 过滤规则 + 静态接线，Node 直跑）——
//  1) readAppearance 语义 = App.tsx 原初始化逻辑（逐行搬运，不改语义）：默认值 / 按皮肤记忆 accent /
//     loadSkin 失败回落默认皮肤 / 动效三态解析；
//  2) WindowSkin 刷新的 scope/key 过滤规则（theme 域整体，或 app 域 skinId/accentColor/accentBySkin/motionLevel）；
//  3) 静态接线守卫：主进程广播 + 两个 preload 订阅面 + 三入口挂载 WindowSkin + App/CaptureEditor 走唯一读取面。
// C-37 追加——
//  4) resolveThemeMode 纯函数矩阵（light/dark 原样、"system" 与未知值按 prefers-color-scheme 解析）；
//  5) readAppearance 对 theme.mode="system"/未知值的 mode（解析值）与 modeSetting（原始档）双出；
//  6) 主进程 themeBackground 的 nativeTheme 解析（workbench #111111/#fafaf8、capture #111111/#ffffff；
//     electron require.cache 桩，模式同 tests/app-menu.test.cjs / tests/close-to-tray.test.cjs）。
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const SRC = (p) => path.join(ROOT, p);

// ---------- 1/2. readAppearance 语义（esbuild 打包后在 Node 直跑） ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "c31-window-skin-"));
const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  define: { "import.meta.env.DEV": "false" },
  logLevel: "silent",
};
// 成功路径：动态 import("./claude") 打包内联，真实 claude 皮肤模块可加载
esbuild.buildSync({ ...common, entryPoints: [SRC("src/skins/runtime/readAppearance.ts")], outfile: path.join(tmp, "ra-ok.cjs") });
// 失败路径：claude 动态导入外置 → Node ESM 解析无扩展名必然失败 → loadSkin 抛错 → 回落默认皮肤
esbuild.buildSync({
  ...common,
  entryPoints: [SRC("src/skins/runtime/readAppearance.ts")],
  outfile: path.join(tmp, "ra-ext.cjs"),
  external: ["./claude"],
});

function withWindow(settingsFixture, schemeDark = false) {
  globalThis.window = {
    // C-37：按查询分流——prefers-color-scheme 可控，prefers-reduced-motion 恒 false（不干扰动效解析）
    matchMedia: (q) => ({ matches: String(q).includes("prefers-color-scheme") ? schemeDark : false }),
    settingsAPI: {
      get: async (scope, key) => {
        const obj = settingsFixture[scope];
        return obj ? obj[key] : undefined;
      },
    },
  };
}

async function main() {
  const { readAppearance: readOK, isAppearanceSettingsChange, resolveThemeMode } = require(path.join(tmp, "ra-ok.cjs"));
  const { readAppearance: readExt } = require(path.join(tmp, "ra-ext.cjs"));

  // A. 空设置 → 全默认（与原 App.tsx 各键默认值一致；C-37 增 modeSetting 原始档）
  withWindow({});
  assert.deepStrictEqual(await readOK(), {
    mode: "light",
    modeSetting: "light",
    skinId: "none",
    accent: "",
    motion: "full",
    motionSetting: "system",
    accentLegacy: "",
    accentBySkin: {},
  });

  // B. 非默认皮肤成功加载：mode/skinId/有效 accent（accentBySkin 记忆值）/动效三态
  withWindow({
    theme: { mode: "dark" },
    app: { skinId: "claude", accentColor: "#123456", accentBySkin: { claude: "#ff8800" }, motionLevel: "off" },
  });
  const apB = await readOK();
  assert.strictEqual(apB.mode, "dark");
  assert.strictEqual(apB.modeSetting, "dark");
  assert.strictEqual(apB.skinId, "claude");
  assert.strictEqual(apB.accent, "#ff8800"); // D172：非默认皮肤用 accentBySkin[skinId]，不用原键
  assert.strictEqual(apB.motion, "off");
  assert.strictEqual(apB.motionSetting, "off");
  assert.strictEqual(apB.accentLegacy, "#123456");

  // C. loadSkin 失败 → 回落默认皮肤，accent 回落到原键（App.tsx 原 catch 分支语义）
  withWindow({
    theme: { mode: "light" },
    app: { skinId: "claude", accentColor: "#123456", accentBySkin: { claude: "#ff8800" }, motionLevel: "system" },
  });
  const apC = await readExt();
  assert.strictEqual(apC.skinId, "none");
  assert.strictEqual(apC.accent, "#123456"); // 默认皮肤用 accentColor 原键
  assert.strictEqual(apC.motion, "full");
  assert.strictEqual(apC.motionSetting, "system");

  // D. 默认皮肤：accent 恒用原键（accentBySkin 里的记忆值不得串位）
  withWindow({
    theme: { mode: "light" },
    app: { skinId: "none", accentColor: "#00ff00", accentBySkin: { claude: "#ff8800" }, motionLevel: "system" },
  });
  assert.strictEqual((await readOK()).accent, "#00ff00");

  // 2. WindowSkin 刷新过滤规则（报告修复步骤 4：scope=theme，或 scope=app 且 key ∈ 四外观键）
  const pass = (scope, key) => isAppearanceSettingsChange({ scope, key });
  assert.strictEqual(pass("theme", "mode"), true);
  assert.strictEqual(pass("app", "skinId"), true);
  assert.strictEqual(pass("app", "accentColor"), true);
  assert.strictEqual(pass("app", "accentBySkin"), true);
  assert.strictEqual(pass("app", "motionLevel"), true);
  assert.strictEqual(pass("app", "language"), false); // 非外观键不得触发整窗重读
  assert.strictEqual(pass("app", "limits"), false);
  assert.strictEqual(pass("plugin.someId", "css"), false);

  // 4. resolveThemeMode 纯函数矩阵（C-37 步骤 2 逐字：显式档原样；"system" 与未知值按系统解析）
  withWindow({}, false);
  assert.strictEqual(resolveThemeMode("light"), "light", "显式 light 原样");
  assert.strictEqual(resolveThemeMode("dark"), "dark", "显式 dark 原样");
  assert.strictEqual(resolveThemeMode("system"), "light", "system + 浅色系统 → light");
  assert.strictEqual(resolveThemeMode("garbage"), "light", "未知值 + 浅色系统 → light");
  withWindow({}, true);
  assert.strictEqual(resolveThemeMode("system"), "dark", "system + 深色系统 → dark");
  assert.strictEqual(resolveThemeMode("garbage"), "dark", "未知值 + 深色系统 → dark（报告：未知值同 system 语义）");
  assert.strictEqual(resolveThemeMode("light"), "light", "深色系统下显式 light 仍原样");

  // 5. readAppearance 对 "system"/未知值的双出：mode=解析值、modeSetting=原始档归一
  withWindow({ theme: { mode: "system" } }, true);
  const apSysDark = await readOK();
  assert.strictEqual(apSysDark.mode, "dark", "system + 深色系统 → mode=dark");
  assert.strictEqual(apSysDark.modeSetting, "system");
  withWindow({ theme: { mode: "system" } }, false);
  const apSysLight = await readOK();
  assert.strictEqual(apSysLight.mode, "light", "system + 浅色系统 → mode=light");
  assert.strictEqual(apSysLight.modeSetting, "system");
  withWindow({ theme: { mode: "weird" } }, true);
  const apWeird = await readOK();
  assert.strictEqual(apWeird.mode, "dark", "未知值按系统解析（与 resolveThemeMode 同语义）");
  assert.strictEqual(apWeird.modeSetting, "system", "未知值 modeSetting 归一 system（按钮高亮与落窗档一致）");

  // 3. 静态接线守卫
  const mainJs = fs.readFileSync(SRC("electron/main.js"), "utf8");
  const setIdx = mainJs.indexOf('ipcMain.handle("settings:set"');
  const bcastIdx = mainJs.indexOf('send("settings:changed"');
  assert.ok(setIdx >= 0, "main.js 应有 settings:set 处理器");
  assert.ok(bcastIdx > setIdx, "settings:changed 广播必须在 settings:set 处理器内（写入成功后）");
  assert.ok(mainJs.includes("BrowserWindow.getAllWindows()"), "广播应遍历所有窗口");
  for (const f of ["electron/preload.js", "electron/preload-capture.js"]) {
    const s = fs.readFileSync(SRC(f), "utf8");
    assert.ok(s.includes("onChanged"), `${f} 应暴露 onChanged 订阅`);
    assert.ok(s.includes('"settings:changed"'), `${f} 应订阅 settings:changed`);
  }
  for (const f of ["src/lens.tsx", "src/workbench.tsx", "src/capture.tsx"]) {
    assert.ok(fs.readFileSync(SRC(f), "utf8").includes("<WindowSkin />"), `${f} 应挂载 <WindowSkin />`);
  }
  const appTs = fs.readFileSync(SRC("src/App.tsx"), "utf8");
  assert.ok(appTs.includes("readAppearance()"), "App.tsx 初始化应走唯一读取面 readAppearance");
  const capEd = fs.readFileSync(SRC("src/components/CaptureEditor.tsx"), "utf8");
  assert.ok(capEd.includes("readAppearance()") && capEd.includes("requestWindowSkinRefresh()"), "applyCaptureAppearance 应走唯一读取面并反压 WindowSkin 刷新");

  // C-37 静态接线：system 档的解析与监听挂载面（App 主窗口 / WindowSkin 独立窗口 / 设置页三档）
  assert.ok(appTs.includes("resolveThemeMode"), "App.tsx 应消费 resolveThemeMode（system 现场解析 + mq change 重解析）");
  assert.ok(appTs.includes('matchMedia("(prefers-color-scheme: dark)")'), "App.tsx 应挂系统深浅色 mq 监听（themeMode=system 时）");
  assert.ok(appTs.includes('eventBus.emit("theme/changed", resolved)'), "theme/changed 应发解析后的 light|dark（监听者零修改）");
  const wsSrc = fs.readFileSync(SRC("src/skins/WindowSkin.tsx"), "utf8");
  assert.ok(wsSrc.includes('matchMedia("(prefers-color-scheme: dark)")'), "WindowSkin 应挂系统深浅色 mq 监听（独立窗口 system 档）");
  const spSrc = fs.readFileSync(SRC("src/components/SettingsPanel.tsx"), "utf8");
  assert.ok(spSrc.includes('onThemeChange("system")') && spSrc.includes('themeMode === "system"'), "设置页应有第三档「跟随系统」按钮（高亮按 themeMode）");
  for (const f of ["electron/workbenchWindow.js", "electron/quickCapture.js"]) {
    const s = fs.readFileSync(SRC(f), "utf8");
    assert.ok(/mode === "system" && nativeTheme\.shouldUseDarkColors/.test(s), `${f} themeBackground 应有 system→nativeTheme 分支`);
  }

  // 6. 主进程 themeBackground 的 nativeTheme 解析（electron require.cache 桩；C-29 导出先例）
  const ELECTRON_PATH = require.resolve("electron");
  const nativeThemeStub = { shouldUseDarkColors: false };
  require.cache[ELECTRON_PATH] = {
    id: ELECTRON_PATH,
    filename: ELECTRON_PATH,
    loaded: true,
    exports: {
      app: {},
      BrowserWindow: Object,
      screen: {},
      nativeTheme: nativeThemeStub,
      globalShortcut: { register: () => true, unregister: () => {}, unregisterAll: () => {} },
    },
  };
  const workbench = require(SRC("electron/workbenchWindow.js"));
  const quickCapture = require(SRC("electron/quickCapture.js"));
  const withMode = (mode) => ({ readSettings: () => (mode === undefined ? {} : { theme: { mode } }) });
  workbench.init(withMode("system"));
  quickCapture.init(withMode("system"));
  nativeThemeStub.shouldUseDarkColors = false;
  assert.strictEqual(workbench.themeBackground(), "#fafaf8", "workbench system + 浅色系统 → 纸色底");
  assert.strictEqual(quickCapture.themeBackground(), "#ffffff", "capture system + 浅色系统 → 白底（无白闪口径：底色随系统）");
  nativeThemeStub.shouldUseDarkColors = true;
  assert.strictEqual(workbench.themeBackground(), "#111111", "workbench system + 深色系统 → 深底");
  assert.strictEqual(quickCapture.themeBackground(), "#111111", "capture system + 深色系统 → 深底");
  workbench.init(withMode("dark"));
  quickCapture.init(withMode("dark"));
  nativeThemeStub.shouldUseDarkColors = false;
  assert.strictEqual(workbench.themeBackground(), "#111111", "显式 dark 不看 nativeTheme");
  assert.strictEqual(quickCapture.themeBackground(), "#111111");
  workbench.init(withMode("light"));
  quickCapture.init(withMode("light"));
  nativeThemeStub.shouldUseDarkColors = true;
  assert.strictEqual(workbench.themeBackground(), "#fafaf8", "显式 light 不看 nativeTheme");
  assert.strictEqual(quickCapture.themeBackground(), "#ffffff");
  workbench.init(withMode(undefined));
  quickCapture.init(withMode(undefined));
  nativeThemeStub.shouldUseDarkColors = true;
  assert.strictEqual(workbench.themeBackground(), "#fafaf8", "设置缺失（未知值）主进程保守回落浅色");
  assert.strictEqual(quickCapture.themeBackground(), "#ffffff");

  console.log("window-skin: C-31 外观同步 + C-37 主题跟随断言全部通过（A/B/C/D 语义 + 过滤矩阵 + resolveThemeMode/modeSetting + 静态接线 + themeBackground 桩）");
}

main()
  .then(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(1);
  });
