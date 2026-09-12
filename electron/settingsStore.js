// settings.json 读写（v23 自 optimizer.js 抽出共用；db.js 统计口径/优化器均经此读配置）
const path = require("path");
const fs = require("fs");
const { app } = require("electron");

const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function writeSettings(all) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(all, null, 2), "utf-8");
}

module.exports = { SETTINGS_FILE, readSettings, writeSettings };
