"use strict";
/** 设置分层：DEVICE_KEYS 只属于这台电脑（路径、系统集成、平台相关键位、本机安装的插件）；
 *  其余 settings.app.* 键默认属于"资料库"，将来随同步走、恢复备份时随备份走。新增本机专属设置必须加到这里。 */
const DEVICE_KEYS = [
  "backupDir", "autoBackupKeep", "closeToTray", "updateAutoCheck",
  "keybindings", "multiSelectKey",  // 与平台相关；C-26 的 Mod 抽象完成后可改为资料库层（⚠D-07）
  "activeThemePlugin",              // 主题插件文件只装在本机
];
/** 整个文件都只属于本机 */
const DEVICE_FILES = ["ai-config.json", "device.json"]; // Key 由本机钥匙串加密，换机无法解密
function layerOf(key) { return DEVICE_KEYS.includes(key) ? "device" : "library"; }
module.exports = { DEVICE_KEYS, DEVICE_FILES, layerOf };
