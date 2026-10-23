// settings.json 读写（唯一实现：main.js 的 settings:* IPC、db.js、优化器等均经此）
// C-15：原 main.js 自带一份 readSettings/writeSettings 与本文分叉，现合并到 electron/jsonFile.js——
// BOM 容忍、损坏留档（最近 5 份）、原子写 + fsync 由底层统一。
const path = require("path");
const { app } = require("electron");
const { readJsonObject, writeJsonAtomic } = require("./jsonFile");

const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");

function readSettings() {
  return readJsonObject(SETTINGS_FILE, () => ({ app: {}, theme: {} }));
}

function writeSettings(all) {
  writeJsonAtomic(SETTINGS_FILE, all);
}

module.exports = { SETTINGS_FILE, readSettings, writeSettings };
