// C-25：macOS 应用菜单。此前 main.js 无条件 Menu.setApplicationMenu(null)——macOS 的
// 复制/粘贴/全选/撤销/退出等快捷键依赖应用菜单里的 role 菜单项生效，去掉菜单后
// Cmd+C/V/X/A/Z 与 Cmd+Q 全部失效。Windows/Linux 去掉菜单栏是合理的，保持现状（null）。
const { Menu } = require("electron");
/** 非 mac 返回 null（保持现状：无菜单栏）；mac 只放系统必需的三个菜单，不放 viewMenu（避免 Cmd+R 误刷新丢失未保存状态） */
function buildAppMenuTemplate(platform = process.platform) {
  if (platform !== "darwin") return null;
  return [{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }];
}
function applyAppMenu() {
  const tpl = buildAppMenuTemplate();
  Menu.setApplicationMenu(tpl ? Menu.buildFromTemplate(tpl) : null);
}
module.exports = { buildAppMenuTemplate, applyAppMenu };
