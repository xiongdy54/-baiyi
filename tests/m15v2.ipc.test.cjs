// @runtime: node
// 材料导图 v2 · IPC 接线静态回归（node tests/m15v2.ipc.test.cjs）。依据 IMPL-PLAN §4.2 / §6 T4 ②：
// 解析 main.js 与 preload.js 源码——mindmap:graph* 通道双向一致；14 个齐全（含阅读透镜 graphLocate / graphEnsureMap）；mindmap:delta 主进程发送、preload 订阅；
// 引擎 14 个方法名与通道一一对应；settings:set 含三个新键的字面量归一。
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "").slice(0, 600)}`); }
}
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const main = read("electron/main.js");
const preload = read("electron/preload.js");
const engine = read("electron/mindmapEngineV2.js");

const EXPECTED = ["graphLoad", "graphFeed", "graphEstimate", "graphGenerate", "graphExpand", "graphExpandAll", "graphExplain", "graphCancel", "graphResume", "graphSetView", "graphMetrics", "graphNodeText", "graphLocate", "graphEnsureMap"];

const mainCh = new Set([...main.matchAll(/ipcMain\.handle\(\s*"mindmap:(graph\w+)"/g)].map((m) => m[1]));
const preCh = new Set([...preload.matchAll(/ipcRenderer\.invoke\(\s*"mindmap:(graph\w+)"/g)].map((m) => m[1]));
const preKeys = new Set([...preload.matchAll(/^\s+(graph\w+):\s*\(/gm)].map((m) => m[1]));

console.log("---- 通道登记 ----");
check("main 注册全部 14 个 mindmap:graph*", EXPECTED.every((n) => mainCh.has(n)) && mainCh.size === 14, [...mainCh]);
check("preload 调用全部 14 个 mindmap:graph*", EXPECTED.every((n) => preCh.has(n)) && preCh.size === 14, [...preCh]);
check("main ⊆ preload 且 preload ⊆ main（双向一致）", [...mainCh].every((n) => preCh.has(n)) && [...preCh].every((n) => mainCh.has(n)), { mainCh: [...mainCh], preCh: [...preCh] });
check("preload 暴露的方法名 ≡ 通道名（graphX → mindmap:graphX）", EXPECTED.every((n) => preKeys.has(n)) && [...preKeys].every((n) => preCh.has(n)), [...preKeys]);
check("每个 main handler 转发到引擎同名方法", EXPECTED.every((n) => new RegExp(`"mindmap:${n}"[^\\n]*\\.${n}\\(p\\)`).test(main)), null);
check("引擎导出全部 14 个方法", EXPECTED.every((n) => new RegExp(`\\b${n}\\b`).test(engine.slice(engine.lastIndexOf("return {")))), null);
check("未新增非 graph 的 v2 通道漂移：main 中 mindmap:graph* 无重复注册",
  [...main.matchAll(/ipcMain\.handle\(\s*"mindmap:graph\w+"/g)].length === 14, null);

console.log("---- mindmap:delta 推送 ----");
check("main 向窗口发送 mindmap:delta", /webContents\.send\(\s*"mindmap:delta"/.test(main), null);
check("main 仍经 mindmap:changed 发送（既有指示器通道）", (main.match(/webContents\.send\(\s*"mindmap:changed"/g) || []).length >= 2, null);
check("preload 以 onDelta 订阅 mindmap:delta 并返回退订函数",
  /onDelta:\s*\(callback\)\s*=>\s*\{[\s\S]*?ipcRenderer\.on\(\s*"mindmap:delta"[\s\S]*?removeListener\(\s*"mindmap:delta"/.test(preload), null);

console.log("---- 引擎装配 ----");
check("main 以 createMindmapEngineV2 建单例（懒创建）", /createMindmapEngineV2\(\{/.test(main) && /mindmapEngineV2Singleton/.test(main), null);
check("引擎注入 store/chatStream/readSettings/getAIConfig/getPromptTemplate/broadcastChanged/broadcastDelta",
  ["store", "chatStream", "readSettings", "getAIConfig", "getPromptTemplate", "broadcastChanged", "broadcastDelta"].every((k) => new RegExp(`\\b${k}\\b`).test(main.slice(main.indexOf("createMindmapEngineV2({")))), null);
{
  const dbSrc = read("electron/db.js");
  const exported = dbSrc.slice(dbSrc.lastIndexOf("module.exports"));
  const fns = [...main.slice(main.indexOf("const MINDMAP_V2_STORE_FNS"), main.indexOf("let mindmapEngineV2Singleton")).matchAll(/"(\w+)"/g)].map((m) => m[1]);
  check("store 门面函数均为 db.js 导出", fns.length >= 16 && fns.every((n) => new RegExp(`\\b${n}\\b`).test(exported)), fns.filter((n) => !new RegExp(`\\b${n}\\b`).test(exported)));
}
check("v1 通道未被改动（mindmap:preview/generate/deepen 仍在）", ["preview", "generate", "deepen", "cancel", "repairConfirm"].every((n) => new RegExp(`"mindmap:${n}"`).test(main)), null);

console.log("---- settings:set 新键归一 ----");
check("app.mindmapModel / mindmapPrefetch / mindmapExplainAuto 逐键字面量归一",
  ["mindmapModel", "mindmapPrefetch", "mindmapExplainAuto"].every((k) => new RegExp(`scope === "app" && key === "${k}"`).test(main)), null);

console.log(`\n==== SUMMARY ${pass}/${pass + fail} ====`);
process.exit(fail ? 1 : 0);
