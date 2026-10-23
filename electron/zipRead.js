// C-12：备份 zip 的流式读取封装（yauzl，支持 ZIP64）——meta 解析（backup-meta-worker.js）
// 与恢复解包（backup.js restoreBackup）共用。yauzl 只读中央目录即可定位条目，GB 级备份
// 读 meta 也是毫秒级；解包逐条目 pipe 到磁盘，内存占用与条目大小无关。
// 对照旧实现（JSZip.loadAsync(fs.readFileSync(file))）：fs.readFile 对 >2GiB 文件抛
// ERR_FS_FILE_TOO_LARGE，且整包进内存让主进程/worker 内存峰值达数 GB——两条路都封死。
"use strict";
const fs = require("fs");
const path = require("path");
const yauzl = require("yauzl");

const openZip = (file) => new Promise((res, rej) =>
  yauzl.open(file, { lazyEntries: true, autoClose: false, strictFileNames: false, decodeStrings: true }, (e, z) => (e ? rej(e) : res(z))));

const openStream = (zip, entry) => new Promise((res, rej) => zip.openReadStream(entry, (e, s) => (e ? rej(e) : res(s))));

/** 遍历条目；onEntry 返回 false 时停止 */
async function forEachEntry(zip, onEntry) {
  await new Promise((resolve, reject) => {
    zip.on("error", reject);
    zip.on("end", resolve);
    zip.on("entry", async (entry) => {
      try { const go = await onEntry(entry); if (go === false) { zip.close(); resolve(); } else zip.readEntry(); }
      catch (err) { reject(err); }
    });
    zip.readEntry();
  });
}

async function readEntryText(zip, entry, maxBytes = 1024 * 1024) {
  const s = await openStream(zip, entry);
  const chunks = []; let n = 0;
  for await (const c of s) { n += c.length; if (n > maxBytes) throw new Error("条目过大"); chunks.push(c); }
  return Buffer.concat(chunks).toString("utf8");
}

/** 只读 backup-meta.json（读中央目录 + 一个小条目，GB 级备份也是毫秒级） */
async function readBackupMeta(file) {
  const zip = await openZip(file);
  let meta = null;
  try {
    await forEachEntry(zip, async (e) => {
      if (e.fileName === "backup-meta.json") { meta = JSON.parse(await readEntryText(zip, e)); return false; }
      return true;
    });
  } finally { try { zip.close(); } catch { /* 已关闭 */ } }
  return meta;
}

/** 解包到 destDir；拒绝绝对路径、反斜杠与 .. 穿越；返回写出的相对路径列表 */
async function extractAll(file, destDir) {
  const root = path.resolve(destDir);
  const zip = await openZip(file);
  const written = [];
  try {
    await forEachEntry(zip, async (e) => {
      const name = e.fileName;
      if (/\/$/.test(name)) return true; // 目录条目
      if (name.includes("\\") || path.isAbsolute(name) || /^[A-Za-z]:/.test(name)) throw new Error(`非法条目路径：${name}`);
      const dest = path.resolve(root, name);
      if (!dest.startsWith(root + path.sep)) throw new Error(`条目路径越界：${name}`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const s = await openStream(zip, e);
      await new Promise((res, rej) => {
        const out = fs.createWriteStream(dest);
        s.on("error", rej); out.on("error", rej); out.on("close", res);
        s.pipe(out);
      });
      written.push(name);
      return true;
    });
  } finally { try { zip.close(); } catch { /* 已关闭 */ } }
  return written;
}

module.exports = { openZip, forEachEntry, readEntryText, readBackupMeta, extractAll };
