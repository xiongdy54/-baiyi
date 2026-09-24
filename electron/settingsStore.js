// settings.json 读写（v23 自 optimizer.js 抽出共用；db.js 统计口径/优化器均经此读配置）
const path = require("path");
const fs = require("fs");
const { app } = require("electron");

const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");

function readSettings() {
  try {
    const v = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    // 合法 JSON 但不是对象（null / 数字 / 字符串 / 数组）时同样兜底：调用方一律按 s.app 取用，
    // 漏出去一个 null 会让「读配置」这条路整体抛错（实测：db.js:728/:2035/:1189 三处）。
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch (err) {
    // D-TEST-30：解析失败原来是静默返回 {} —— 紧接着任何一次写入都会用"默认值 + 本次改动"
    // 覆盖掉用户原有偏好，而且现场已被覆盖、无从追查。这里把损坏文件改名留证（只留最近一份），
    // 让"偏好突然全没了"至少可追、可人工拣回。
    try {
      if (err && err.code !== "ENOENT") {
        const keep = SETTINGS_FILE + ".corrupt";
        fs.rmSync(keep, { force: true });
        fs.renameSync(SETTINGS_FILE, keep);
      }
    } catch {
      /* 留证失败不影响读取兜底 */
    }
    return {};
  }
}

// 注意：electron/main.js 另有一份自带 readSettings（只服务 settings:get/set 两个 IPC handler），
// 两份长期分叉待后续批次合并（合并要动 settings:set 写路径）。此处不做自愈写回。

function writeSettings(all) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  // D-TEST-30：原来直接 writeFileSync 覆盖本文件——写一半进程没了就是**截断文件**，
  // 读取侧只能兜底成 {}（= 偏好全丢）。改为同目录写 .tmp + 原子 rename：
  // 任何时刻盘上要么是完整旧内容、要么是完整新内容；中途死掉只会留下一个无害的 .tmp。
  const tmp = SETTINGS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2), "utf-8");
  fs.renameSync(tmp, SETTINGS_FILE);
}

module.exports = { SETTINGS_FILE, readSettings, writeSettings };
