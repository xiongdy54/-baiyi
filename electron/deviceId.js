"use strict";
// C-38c（审计）：本机设备 ID，存 <userData>/device.json。不进备份、不随恢复覆盖。
// 整个数据目录被拷到另一台电脑时，host 不一致 → 重新生成，避免两台设备共用一个 ID。
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

function getDeviceId(userData) {
  const file = path.join(userData, "device.json");
  const host = `${os.hostname()}|${process.platform}`;
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (j && typeof j.deviceId === "string" && j.host === host) return j.deviceId;
  } catch { /* 缺失或损坏 → 重新生成 */ }
  const deviceId = crypto.randomUUID();
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ deviceId, host, createdAt: Date.now() }, null, 2));
  fs.renameSync(tmp, file);
  return deviceId;
}
module.exports = { getDeviceId };
