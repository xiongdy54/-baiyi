// C-20：safeStorage 的唯一入口——所有系统加密调用只出现在本文件（报告 C-20 第 1 步：
// 升级到异步 API 时只改这里）。
// C-24（Electron 45）：同步 API（isEncryptionAvailable / encryptString / decryptString）已在 45
// 弃用、46 移除——本文件改为 isAsyncEncryptionAvailable / encryptStringAsync / decryptStringAsync，
// strength / encrypt / decrypt 随之变 async；ai.js 的 getAIConfig / setAIConfig / chatStreamOnce
// 等调用方已同步加 await（rg -n "getAIConfig\(" electron 现场清单，2026-10-24）。
// decryptStringAsync 返回 { shouldReEncrypt, result }（Electron 45 实测）：密钥轮换时
// shouldReEncrypt=true 表示建议重加密——本层只取 result（重加密属密钥管理策略，超出 C-20/C-24
// 范围，不静默改写用户配置）。异步加密器在 app ready 后首次调用时惰性初始化（官方文档）。
const { safeStorage } = require("electron");

/** "secure" = 系统密钥库可用；"weak" = Linux basic_text（等同明文）；"none" = 不可用 */
async function strength() {
  let ok = false;
  try { ok = await safeStorage.isAsyncEncryptionAvailable(); } catch { ok = false; }
  if (!ok) return "none";
  if (process.platform === "linux") {
    try { if (safeStorage.getSelectedStorageBackend() === "basic_text") return "weak"; } catch { /* 旧版本无此 API */ }
  }
  return "secure";
}

const encrypt = async (plain) => (await safeStorage.encryptStringAsync(String(plain))).toString("base64");
const decrypt = async (b64) => (await safeStorage.decryptStringAsync(Buffer.from(String(b64), "base64"))).result;

module.exports = { strength, encrypt, decrypt };
