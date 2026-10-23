"use strict";
// C-15：settings.json / ai-config.json 等「JSON 对象文件」的唯一读写实现。
// 读：去 UTF-8 BOM；缺失→兜底；解析失败或非对象→留档（保留最近 5 份）后兜底。
// 写：tmp → fsync → rename →（POSIX）fsync 目录；失败删 tmp 并抛出。
const fs = require("fs");
const path = require("path");

const KEEP_CORRUPT = 5;

function preserveCorrupt(file) {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.renameSync(file, `${file}.corrupt-${stamp}`);
    const dir = path.dirname(file), base = path.basename(file) + ".corrupt-";
    const olds = fs.readdirSync(dir).filter((f) => f.startsWith(base)).sort(); // 时间戳字典序 = 时间序
    for (const f of olds.slice(0, Math.max(0, olds.length - KEEP_CORRUPT))) fs.rmSync(path.join(dir, f), { force: true });
  } catch {
    /* 留档失败不影响兜底 */
  }
}

/** 读 JSON 对象文件：去 BOM；缺失→fallback；解析失败或非对象→留档后 fallback */
function readJsonObject(file, fallback) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return fallback();
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try {
    const v = JSON.parse(text);
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch {
    /* 落到下方留档 */
  }
  preserveCorrupt(file);
  return fallback();
}

/** 原子写：tmp → fsync → rename →（POSIX）fsync 目录；失败时删除 tmp 并抛出 */
function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  try {
    const fd = fs.openSync(tmp, "w");
    // 必须用 writeFileSync(fd, …)：它会循环写完，磁盘满时抛 ENOSPC。
    // 不要改用 fs.writeSync 直接写字符串——磁盘将满时它会"只写一部分且不报错"（审计实测），改名后就是截断文件。
    try {
      fs.writeFileSync(fd, JSON.stringify(obj, null, 2), "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* 忽略 */
    }
    throw e;
  }
  if (process.platform !== "win32") {
    try {
      const d = fs.openSync(path.dirname(file), "r");
      fs.fsyncSync(d);
      fs.closeSync(d);
    } catch {
      /* 部分文件系统不支持 */
    }
  }
}

/** C-46：原子写文本——同目录 tmp → fsync → rename（Windows 偶发占用时退避重试）→（POSIX）fsync 目录；失败时删除 tmp 并抛出 */
function writeTextAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    const fd = fs.openSync(tmp, "w");
    // 同 writeJsonAtomic：必须用 writeFileSync(fd, …)，不要改用 fs.writeSync——磁盘将满时会静默短写
    try { fs.writeFileSync(fd, String(text), "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    for (let i = 0; ; i++) {
      try { fs.renameSync(tmp, file); break; } catch (e) {
        if (i >= 5 || !["EPERM", "EBUSY", "EACCES"].includes(e.code)) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (i + 1)); // 杀毒/索引器短暂占用：退避重试
      }
    }
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* 忽略 */ }
    throw e;
  }
  if (process.platform !== "win32") {
    try { const d = fs.openSync(path.dirname(file), "r"); fs.fsyncSync(d); fs.closeSync(d); } catch { /* 部分文件系统不支持 */ }
  }
}

module.exports = { readJsonObject, writeJsonAtomic, writeTextAtomic, preserveCorrupt };
