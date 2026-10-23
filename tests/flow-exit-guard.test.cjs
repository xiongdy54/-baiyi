// @runtime: electron-node
// C-45：每个 @runtime: electron 的流程文件都必须显式退出，否则编排器会空等到超时
"use strict";
const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "flows");
const bad = fs.readdirSync(dir)
  .filter((f) => /^f\d.*\.cjs$/.test(f))
  .filter((f) => {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    return /@runtime:\s*electron/.test(src.slice(0, 4000)) && !/\b(?:app\.(?:exit|quit)|quit)\s*\(/.test(src);
  });
if (bad.length) {
  console.error("FAIL 以下 Electron 流程没有调用 app.exit / app.quit：\n  " + bad.join("\n  "));
  process.exit(1);
}
console.log("PASS flow-exit-guard：所有 Electron 流程都会显式退出");
