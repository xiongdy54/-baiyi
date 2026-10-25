#!/usr/bin/env node
// C-40c（审计：业务核心与 Node/Electron 解耦）：机器可读的渲染层↔主进程接口清单生成器。
// 读取 electron/preload.js，按 contextBridge.exposeInMainWorld("桥", { … }) 分块，提取每个
// 「方法名: (…) => ipcRenderer.invoke|send("通道"」与「ipcRenderer.on("通道"」，输出排序后的
// docs/ipc-contract.json（[{ bridge, method, channel, kind }]）。移动端（D-05=A Capacitor）
// 要实现的就是这份清单——同名桥对象、同名方法（报告 C-40 步骤 3）。
// 用法：node scripts/gen-ipc-contract.mjs   （重新生成 docs/ipc-contract.json 并提交）
// 校验：tests/ipc-contract.test.cjs（重新生成并与仓库内文件逐字节比较）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRELOAD = path.join(ROOT, "electron", "preload.js");
const OUT = path.join(ROOT, "docs", "ipc-contract.json");

// 提取单个方法体里第一个通道调用（invoke/send/on）——preload.js 实测 285 方法 = 285 调用（严格 1:1）
function extractBlock(src, block) {
  const text = src.slice(block.start, block.end);
  const methodRe = /^[ ]{2}([A-Za-z_$][\w$]*)[ ]*:/gm;
  const methods = [];
  let m;
  while ((m = methodRe.exec(text))) methods.push({ name: m[1], index: m.index });
  const entries = [];
  for (let i = 0; i < methods.length; i++) {
    const body = text.slice(methods[i].index, i + 1 < methods.length ? methods[i + 1].index : text.length);
    const call = body.match(/ipcRenderer\.(invoke|send|on)\("([^"]+)"/);
    if (!call) {
      throw new Error(`preload.js：桥 ${block.name} 的方法 ${methods[i].name} 未找到 ipcRenderer.invoke/send/on 通道调用——契约生成器需同步扩展`);
    }
    entries.push({ bridge: block.name, method: methods[i].name, channel: call[2], kind: call[1] });
  }
  return entries;
}

export function buildContract(preloadPath = PRELOAD) {
  const src = fs.readFileSync(preloadPath, "utf8");
  const blockRe = /exposeInMainWorld\("([^"]+)",\s*\{/g;
  const blocks = [];
  let m;
  while ((m = blockRe.exec(src))) blocks.push({ name: m[1], start: m.index });
  if (blocks.length === 0) throw new Error("preload.js：未找到任何 exposeInMainWorld 块");
  for (let i = 0; i < blocks.length; i++) blocks[i].end = i + 1 < blocks.length ? blocks[i + 1].start : src.length;
  const entries = blocks.flatMap(extractBlock.bind(null, src));
  // 确定性排序：bridge → method（纯 < 比较，不依赖 locale）
  entries.sort((a, b) => (a.bridge === b.bridge ? (a.method < b.method ? -1 : a.method > b.method ? 1 : 0) : a.bridge < b.bridge ? -1 : 1));
  return entries;
}

export function serialize(entries) {
  return JSON.stringify(entries, null, 2) + "\n";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const entries = buildContract();
  fs.writeFileSync(OUT, serialize(entries));
  const bridges = new Set(entries.map((e) => e.bridge));
  const kinds = {};
  for (const e of entries) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
  console.log(`ipc-contract: ${bridges.size} 桥 / ${entries.length} 方法 → ${path.relative(ROOT, OUT)}`);
  console.log(`  kind 分布: ${JSON.stringify(kinds)}`);
}
