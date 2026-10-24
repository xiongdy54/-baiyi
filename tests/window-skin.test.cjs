// C-31 窗口外观同步守卫。@runtime: system-node（readAppearance 语义 + 过滤规则 + 静态接线，Node 直跑）——
//  1) readAppearance 语义 = App.tsx 原初始化逻辑（逐行搬运，不改语义）：默认值 / 按皮肤记忆 accent /
//     loadSkin 失败回落默认皮肤 / 动效三态解析；
//  2) WindowSkin 刷新的 scope/key 过滤规则（theme 域整体，或 app 域 skinId/accentColor/accentBySkin/motionLevel）；
//  3) 静态接线守卫：主进程广播 + 两个 preload 订阅面 + 三入口挂载 WindowSkin + App/CaptureEditor 走唯一读取面。
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

function withWindow(settingsFixture) {
  globalThis.window = {
    matchMedia: () => ({ matches: false }),
    settingsAPI: {
      get: async (scope, key) => {
        const obj = settingsFixture[scope];
        return obj ? obj[key] : undefined;
      },
    },
  };
}

async function main() {
  const { readAppearance: readOK, isAppearanceSettingsChange } = require(path.join(tmp, "ra-ok.cjs"));
  const { readAppearance: readExt } = require(path.join(tmp, "ra-ext.cjs"));

  // A. 空设置 → 全默认（与原 App.tsx 各键默认值一致）
  withWindow({});
  assert.deepStrictEqual(await readOK(), {
    mode: "light",
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

  console.log("window-skin: 10 组断言全部通过（A/B/C/D 语义 + 过滤矩阵 + 静态接线）");
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
