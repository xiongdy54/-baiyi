// settings.json 读写（v23 自 optimizer.js 抽出共用；db.js 统计口径/优化器均经此读配置）
const path = require("path");
const fs = require("fs");
const { app } = require("electron");

const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");

function readSettings() {
  try {
    const v = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    // 合法 JSON 但不是对象（null / 数字 / 字符串 / 数组）时同样兜底：调用方一律按 s.app 取用，
    // 漏出去一个 null 会让「读配置」这条路整体抛错（实测：db.js:728/:2035/:1189 三处）。
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

// 注意：electron/main.js 另有一份自带 readSettings（只服务 settings:get/set 两个 IPC handler），
// 两份长期分叉待后续批次合并（合并要动 settings:set 写路径）。此处不做自愈写回。

function writeSettings(all) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(all, null, 2), "utf-8");
}

module.exports = { SETTINGS_FILE, readSettings, writeSettings };
