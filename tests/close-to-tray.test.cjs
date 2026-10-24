"use strict";
// C-28（D-09=A 已答复 2026-10-24）：closeToTrayEnabled 平台默认值单测（报告验收三条）——
//   linux 未设置 → false（默认关：GNOME 默认无托盘区，收进托盘后应用看起来像"消失"）；
//   win32 未设置 → true（默认开）；显式 true/false 一律原样尊重（即使在 linux 上）。
//   补 darwin 未设置 → true（D-09：Windows 与 mac 保持开启）与杂值回落两例。
// @runtime: electron-node
// 直跑：node scripts/run-tests.mjs close-to-tray
const assert = require("assert");
const path = require("path");
const { closeToTrayEnabled } = require(path.join(__dirname, "..", "electron", "closeToTray.js"));

// mock process.platform（报告要求）：临时改写，用后还原（closeToTrayEnabled 每次调用现读，mock 生效）
const REAL_PLATFORM = process.platform;
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

withPlatform("linux", () => {
  ok(closeToTrayEnabled(undefined) === false, "linux 未设置 → 默认关（D-09）");
  ok(closeToTrayEnabled(true) === true, "linux 显式 true → 尊重用户");
  ok(closeToTrayEnabled(false) === false, "linux 显式 false → 尊重用户");
  ok(closeToTrayEnabled("yes") === false, "linux 非布尔杂值 → 视同未设置，按平台默认（关）");
});
withPlatform("win32", () => {
  ok(closeToTrayEnabled(undefined) === true, "win32 未设置 → 默认开（D-09）");
  ok(closeToTrayEnabled(true) === true, "win32 显式 true → 尊重用户");
  ok(closeToTrayEnabled(false) === false, "win32 显式 false → 尊重用户");
  ok(closeToTrayEnabled(null) === true, "win32 null → 视同未设置，按平台默认（开）");
});
withPlatform("darwin", () => {
  ok(closeToTrayEnabled(undefined) === true, "darwin 未设置 → 默认开（D-09：Windows 与 mac 保持开启）");
});

assert.strictEqual(process.platform, REAL_PLATFORM, "platform mock 已还原");
console.log(`close-to-tray ok：${n} 断言全过（linux 默认关 / win32+darwin 默认开 / 显式 true/false 尊重 / 杂值回落平台默认 / mock 已还原）`);
