// C-20：safeStorage 的唯一入口——所有系统加密调用只出现在本文件（报告 C-20 第 1 步：
// 升级到异步 API 时只改这里）。
// TODO(C-24)：升级到目标 Electron 版本后，改用 isAsyncEncryptionAvailable / encryptStringAsync /
// decryptStringAsync（同步 API 已弃用，将在 Electron 46 移除，预计 2027-01-05 发布），
// 并把 electron/ai.js 的 getAIConfig() 改为 async——调用方需加 await，
// 调用点清单用 `rg -n "getAIConfig\(" electron` 现场列出。本项（C-20）不做这一步。
const { safeStorage } = require("electron");

/** "secure" = 系统密钥库可用；"weak" = Linux basic_text（等同明文）；"none" = 不可用 */
function strength() {
  let ok = false;
  try { ok = safeStorage.isEncryptionAvailable(); } catch { ok = false; }
  if (!ok) return "none";
  if (process.platform === "linux") {
    try { if (safeStorage.getSelectedStorageBackend() === "basic_text") return "weak"; } catch { /* 旧版本无此 API */ }
  }
  return "secure";
}

const encrypt = (plain) => safeStorage.encryptString(String(plain)).toString("base64");
const decrypt = (b64) => safeStorage.decryptString(Buffer.from(String(b64), "base64"));

module.exports = { strength, encrypt, decrypt };
