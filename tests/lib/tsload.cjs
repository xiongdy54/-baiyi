// TS 纯模块测试加载器（材料导图 v2 实施方案 §6「沙箱通用前置」）。
// 用法：require("./lib/tsload.cjs"); const m = require("../src/lib/mindmap/v2/layout.ts");
// 原理：注册 require.extensions['.ts']，用 typescript.transpileModule 转 CommonJS（只转译、不做类型检查；
// 类型检查由 `tsc --noEmit -p .` 负责）。Node 的 CommonJS 解析会按已注册扩展名补全无扩展名相对导入
// （`import { x } from "./graph"` → ./graph.ts），所以源码无需写扩展名。不依赖 esbuild（沙箱仅有 win32 二进制）。
// 约束：被加载模块须满足 isolatedModules 语义（类型导出用 `export type` / `import type`）。
"use strict";
const fs = require("fs");
const path = require("path");

if (!require.extensions[".ts"]) {
  const ts = require(path.join(__dirname, "..", "..", "node_modules", "typescript"));
  const COMPILER_OPTIONS = {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
    isolatedModules: true,
    sourceMap: false,
    inlineSourceMap: true,
    jsx: ts.JsxEmit.ReactJSX,
  };
  const load = (module, filename) => {
    const src = fs.readFileSync(filename, "utf8");
    const out = ts.transpileModule(src, { compilerOptions: COMPILER_OPTIONS, fileName: filename, reportDiagnostics: false });
    module._compile(out.outputText, filename);
  };
  require.extensions[".ts"] = load;
  require.extensions[".tsx"] = load;
}

module.exports = {};
