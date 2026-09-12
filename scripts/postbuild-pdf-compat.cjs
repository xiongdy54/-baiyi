// 构建后处理：给 dist 的 pdf.worker 前置 ES2025 兼容补丁（v28）。
// pdf.js v6 用的 Promise.try / Map.getOrInsertComputed / Uint8Array.toHex 在 Electron 31/Chromium 126 缺失；
// 主线程补丁在 src/lib/reader/pdf/adapter.ts，worker 文本是原样拷贝必须此处前置（补丁源 tests/pdf.compat.js，单一来源）。
// Electron 升级到 Chromium 133+ 后删除本脚本与调用。
const fs = require("fs");
const path = require("path");
const { PDF_COMPAT_POLYFILL } = require("../tests/pdf.compat.js");

const dir = path.join(__dirname, "..", "dist", "assets");
const worker = fs.readdirSync(dir).find((f) => /^pdf\.worker-.*\.mjs$/.test(f));
if (!worker) {
  console.log("[postbuild] pdf.worker not found, skip");
  process.exit(0);
}
const p = path.join(dir, worker);
const src = fs.readFileSync(p, "utf8");
if (src.startsWith("/*pdf-compat*/")) {
  console.log("[postbuild] already patched:", worker);
  process.exit(0);
}
fs.writeFileSync(p, "/*pdf-compat*/\n" + PDF_COMPAT_POLYFILL + src, "utf8");
console.log("[postbuild] patched:", worker);
