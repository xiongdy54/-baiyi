// C-28（D-09 已答复 2026-10-24）：「关闭窗口＝收进托盘」的取值归一——唯一实现面。
// 用户显式设置（严格 true / false）一律尊重；未设置（或非法值）按平台默认：
//   Windows / macOS 默认开；Linux 默认关（GNOME 默认无托盘区，收进托盘后应用看起来像"消失"）。
// 渲染层读侧默认显示同规：src/components/SettingsPanel.tsx TrayRow（改默认值两处必须同步）。
"use strict";

function closeToTrayEnabled(raw) {
  if (raw === true || raw === false) return raw; // 用户显式设置过就尊重
  return process.platform !== "linux";           // 未设置时的默认值（D-09）
}

module.exports = { closeToTrayEnabled };
