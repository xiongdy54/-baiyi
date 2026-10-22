// 返回当前平台的 Electron 可执行文件绝对路径
// （Windows: dist/electron.exe；macOS: Electron.app/Contents/MacOS/Electron；Linux: dist/electron）。
// electron 包的 index.js 在 Node 进程里导出的就是该路径字符串。
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
module.exports = function electronBin() {
  return require(path.join(ROOT, "node_modules", "electron", "index.js"));
};
