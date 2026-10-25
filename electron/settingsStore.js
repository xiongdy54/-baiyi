// settings.json 读写（唯一实现：main.js 的 settings:* IPC、db.js、优化器等均经此）
// C-15：原 main.js 自带一份 readSettings/writeSettings 与本文分叉，现合并到 electron/jsonFile.js——
// BOM 容忍、损坏留档（最近 5 份）、原子写 + fsync 由底层统一。
// C-40a（审计：业务核心与 Node/Electron 解耦）：路径惰性化——模块加载不再触碰 electron（纯 Node
// 宿主可加载）；桌面态首次访问时回落 Electron userData（首次即定格，与解耦前「模块加载期固化」
// 等价——main.js 的 pinUserData/M7_TEST_USERDATA setPath 均先于 require）；注入宿主经 configure()。
const path = require("path");
const { readJsonObject, writeJsonAtomic } = require("./jsonFile");

let settingsFile = null;
function configure({ dataDir }) { settingsFile = path.join(dataDir, "settings.json"); }
function file() {
  if (!settingsFile) settingsFile = path.join(require("electron").app.getPath("userData"), "settings.json");
  return settingsFile;
}

function readSettings() {
  return readJsonObject(file(), () => ({ app: {}, theme: {} }));
}

function writeSettings(all) {
  writeJsonAtomic(file(), all);
}

module.exports = { get SETTINGS_FILE() { return file(); }, configure, readSettings, writeSettings };
