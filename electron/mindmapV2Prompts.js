"use strict";
// 材料导图 v2（D192，MINDMAP-V2-IMPL-PLAN §4.4）：行协议提示词的主进程侧入口。
// 三段 system 文本的唯一真源在 electron/prompts.js（MATERIAL_MAP_OUTLINE/EXPAND/EXPLAIN_PROMPT），
// 运行时引擎应经 db.getPromptTemplate(scope).content 取（用户可在设置里改写）；本模块再导出同一常量供测试/兜底，
// 并提供用户消息构造（逐字迁自 prompt-lab/mindmapV2Prompts.js）。
// 契约：docs/design/MINDMAP-V2-P0-CONTRACT.md「M3」；设计稿 §6.2–6.5、§7、§8、§9.1、§15.5。

const {
  MATERIAL_MAP_OUTLINE_PROMPT,
  MATERIAL_MAP_EXPAND_PROMPT,
  MATERIAL_MAP_EXPLAIN_PROMPT,
} = require("./prompts");

const PROMPT_VERSION = 1;
const OUTLINE_SYSTEM = MATERIAL_MAP_OUTLINE_PROMPT;
const EXPAND_SYSTEM = MATERIAL_MAP_EXPAND_PROMPT;
const EXPLAIN_SYSTEM = MATERIAL_MAP_EXPLAIN_PROMPT;

// ---------- 用户消息构造 ----------
function blockRangeOf(numberedText) {
  const nos = [];
  const re = /^\[(\d+)\]/gm;
  let m;
  while ((m = re.exec(String(numberedText || "")))) nos.push(Number(m[1]));
  if (!nos.length) return "（无）";
  const lo = Math.min(...nos), hi = Math.max(...nos);
  return lo === hi ? `[${lo}]` : `[${lo}]–[${hi}]`;
}
function refsBlock(refs) {
  if (!refs || !refs.length) return "无";
  return refs.map((r) => `${r.id} ${r.title}`).join("\n");
}
function listOrNone(arr, sep) {
  return arr && arr.length ? arr.join(sep) : "无";
}
function nodeLabel(node) {
  return `[${(node && node.type) || "其他"}] ${(node && node.title) || ""}`;
}

function buildOutlineUser({ title, path, numberedText, depth, refs }) {
  return [
    `【材料】${title || ""}`,
    `【结构路径】${listOrNone(path, " › ")}`,
    `【原文块号】${blockRangeOf(numberedText)}`,
    `【目标层数】${depth}`,
    `【可引用节点】\n${refsBlock(refs)}`,
    `【原文】\n${numberedText || ""}\n【/原文】`,
  ].join("\n");
}

function buildExpandUser({ title, ancestors, siblings, node, numberedText, depth, refs }) {
  return [
    `【材料】${title || ""}`,
    `【祖先路径】${listOrNone(ancestors, " › ")}`,
    `【当前节点】${nodeLabel(node)}`,
    `【已有兄弟】${listOrNone(siblings, "；")}`,
    `【原文块号】${blockRangeOf(numberedText)}`,
    `【目标层数】${depth}`,
    `【可引用节点】\n${refsBlock(refs)}`,
    `【原文】\n${numberedText || ""}\n【/原文】`,
  ].join("\n");
}

// siblings 为契约外的可选扩展（explain 要说明与兄弟的关系）；不传时显示「无」。
function buildExplainUser({ title, ancestors, node, numberedText, siblings }) {
  return [
    `【材料】${title || ""}`,
    `【祖先路径】${listOrNone(ancestors, " › ")}`,
    `【当前节点】${nodeLabel(node)}`,
    `【兄弟节点】${listOrNone(siblings, "；")}`,
    `【原文】\n${numberedText || ""}\n【/原文】`,
  ].join("\n");
}

// 设计稿 §6.2：≤3 千字 → 4 层；3 千–1.2 万字 → 3 层；更大 → 2 层
function targetDepth(charCount) {
  const n = Number(charCount) || 0;
  if (n <= 3000) return 4;
  if (n <= 12000) return 3;
  return 2;
}

module.exports = {
  PROMPT_VERSION, OUTLINE_SYSTEM, EXPAND_SYSTEM, EXPLAIN_SYSTEM,
  buildOutlineUser, buildExpandUser, buildExplainUser, targetDepth,
};
