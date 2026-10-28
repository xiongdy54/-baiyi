// BDI（D248 / T5）：窗口角色裁剪——main 全量；lens / workbench = batch + status；capture = batch。
// 唯一实现依据：docs/design/BEHAVIOR-DATA-INFRA-D248-v3.md §2.2 V1-8 / §7.2 / §11.1。
// 主进程按 sender 的真实页面 URL 判定角色（不信任渲染层自报）；preload 的裁剪只是第一道门。
"use strict";

const ROLES = ["main", "lens", "workbench", "capture"];

/** 已落地方法（管理面 export / purge / clearQueryText / retention 只给 main） */
const ROLE_METHODS = {
  main: ["batch", "status", "query", "export", "purge", "clearQueryText", "retention"],
  lens: ["batch", "status"],
  workbench: ["batch", "status"],
  capture: ["batch"],
};

function normalizeRole(role) {
  return ROLES.includes(role) ? role : "main";
}

/** 从页面 URL 判定角色；非 BDI 窗口返回 null（调用方拒绝）。 */
function roleFromUrl(url) {
  const u = String(url || "");
  if (u.includes("lens.html")) return "lens";
  if (u.includes("workbench.html")) return "workbench";
  if (u.includes("capture.html")) return "capture";
  if (u.includes("index.html")) return "main";
  return null;
}

function canCall(role, method) {
  const list = ROLE_METHODS[role];
  return Array.isArray(list) && list.includes(method);
}

module.exports = { ROLES, ROLE_METHODS, normalizeRole, roleFromUrl, canCall };
