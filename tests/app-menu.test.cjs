"use strict";
// C-25：应用菜单模板纯函数断言（报告验收三条）——非 mac 返回 null（保持无菜单栏现状），
// darwin 只放 appMenu/editMenu/windowMenu 三个系统必需菜单（不放 viewMenu，避免 Cmd+R 误刷新）。
// @runtime: electron-node
// 直跑：node scripts/run-tests.mjs app-menu（runner 按 @runtime 分流到 electron-node）
const assert = require("assert");
const path = require("path");

// 报告验收要求：先以 { Menu: {} } 桩替换 require.cache 里的 electron，再加载 appMenu.js
// （electron-node 运行时下 require("electron") 本返回可执行文件路径字符串；桩保证模块加载不依赖真实 Menu）
require.cache[require.resolve("electron")] = { exports: { Menu: {} } };
const { buildAppMenuTemplate } = require(path.join(__dirname, "..", "electron", "appMenu.js"));

assert.strictEqual(buildAppMenuTemplate("win32"), null, "win32 应返回 null（保持无菜单栏现状）");
assert.strictEqual(buildAppMenuTemplate("linux"), null, "linux 应返回 null（保持无菜单栏现状）");
assert.deepStrictEqual(
  buildAppMenuTemplate("darwin").map((x) => x.role),
  ["appMenu", "editMenu", "windowMenu"],
  "darwin 应只放系统必需的三个菜单"
);
console.log("app-menu ok：win32/linux → null；darwin → appMenu+editMenu+windowMenu");
