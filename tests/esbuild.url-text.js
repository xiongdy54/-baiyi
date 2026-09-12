// esbuild 文本加载器：把 ?url import 转为文件文本（测试 bundle 用；生产构建走 Vite ?url）。
// 用法见 tests/pdf.kernel.cjs（plugins + define WORKER_URL="__INLINE__"）。
// pdf.js v6 要求 ES2025（见 tests/pdf.compat.js 清单），Electron 31/Chromium 126 无此 API——
// worker 文本前置 tests/pdf.compat.js 的同构补丁（与 adapter.ts 主线程补丁同构；Electron 升级后删除）。
const fs = require("fs");
const { PDF_COMPAT_POLYFILL } = require("./pdf.compat.js");
module.exports = {
  name: "url-text",
  setup(build) {
    build.onResolve({ filter: /\?url$/ }, (args) => ({
      path: args.path.replace(/\?url$/, ""),
      namespace: "url-text"
    }));
    build.onLoad({ filter: /.*/, namespace: "url-text" }, async (args) => {
      const path = require("path");
      const abs = path.isAbsolute(args.path)
        ? args.path
        : path.join(process.cwd(), "node_modules", args.path);
      let text = await fs.promises.readFile(abs, "utf8");
      if (/pdf\.worker\.mjs$/.test(abs)) text = PDF_COMPAT_POLYFILL + text;
      return { contents: `export default ${JSON.stringify(text)}`, loader: "js" };
    });
  }
};
