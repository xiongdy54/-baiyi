// M2 数据备份与恢复（文档 §9.1 M2）
// 备份 = 单个 zip：library.db 全库 + assets/** + settings.json（ai-config.json 含加密 Key，默认不入、勾选才含）
// 恢复 = 校验 → 先对当前数据做安全备份 → 解包到 restore-staging/ + restore-pending.json 标记
//        → 重启应用时 applyPendingRestore() 换入生效（sql.js 内存库约束 §7.1.8，运行期禁止直接换库文件）
// 核心函数均接受显式路径（opts.dataDir 等），缺省时从 electron app 取——便于无 Electron 环境跑单元测试。
const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");

const APP_TAG = "incremental-reading-dev";
const FORMAT = 1;
const AUTO_RE = /^backup-auto-\d{4}-\d{2}-\d{2}\.zip$/;

function pad2(n) {
  return String(n).padStart(2, "0");
}
function stamp(d) {
  const t = d || new Date();
  return `${t.getFullYear()}${pad2(t.getMonth() + 1)}${pad2(t.getDate())}-${pad2(t.getHours())}${pad2(t.getMinutes())}${pad2(t.getSeconds())}`;
}
function dayTag(d) {
  const t = d || new Date();
  return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
}

function resolvePaths(opts = {}) {
  let dataDir = opts.dataDir;
  if (!dataDir) dataDir = require("electron").app.getPath("userData");
  return {
    dataDir,
    dbFile: opts.dbFile || path.join(dataDir, "library.db"),
    settingsFile: opts.settingsFile || path.join(dataDir, "settings.json"),
    aiConfigFile: opts.aiConfigFile || path.join(dataDir, "ai-config.json"),
    assetsDir: opts.assetsDir || path.join(dataDir, "assets"),
    memoryDir: opts.memoryDir || path.join(dataDir, "memory"),
    stagingDir: opts.stagingDir || path.join(dataDir, "restore-staging"),
    markerFile: opts.markerFile || path.join(dataDir, "restore-pending.json")
  };
}

function readAppSettings(settingsFile) {
  try {
    return JSON.parse(fs.readFileSync(settingsFile, "utf-8")) || {};
  } catch {
    return {};
  }
}

// 备份位置：设置 app.backupDir，缺省 userData/backups/
function getBackupDir(opts = {}) {
  const p = resolvePaths(opts);
  if (opts.backupDir) return opts.backupDir;
  const cfg = readAppSettings(p.settingsFile);
  const dir = cfg?.app?.backupDir || path.join(p.dataDir, "backups");
  return dir;
}

function walkFiles(dir, base, out) {
  const root = base || dir;
  const acc = out || [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walkFiles(full, root, acc);
    else acc.push({ full, rel: path.relative(root, full).split(path.sep).join("/") });
  }
  return acc;
}

// 图片/epub 等已是压缩格式，STORE 直存更快；db/json 走 DEFLATE
function isAlreadyCompressed(rel) {
  return /\.(png|jpe?g|gif|webp|epub|pdf|zip|mp3|mp4|m4a|ogg|woff2?|ttf)$/i.test(rel);
}

async function createBackup(opts = {}) {
  const p = resolvePaths(opts);
  const label = ["manual", "auto", "safety"].includes(opts.label) ? opts.label : "manual";
  const includeAIConfig = !!opts.includeAIConfig;
  if (!fs.existsSync(p.dbFile)) return { ok: false, error: "未找到数据库文件（尚未产生学习数据？）" };

  const destDir = opts.backupDir || getBackupDir(opts);
  try {
    fs.mkdirSync(destDir, { recursive: true });
  } catch (err) {
    return { ok: false, error: `备份位置不可写（${destDir}）：${err.message}` };
  }
  const name = label === "auto" ? `backup-auto-${dayTag(opts.now)}.zip` : `backup-${label}-${stamp(opts.now)}.zip`;
  let destFile = path.join(destDir, name);
  if (label === "auto" && fs.existsSync(destFile)) {
    return { ok: true, file: destFile, skipped: true }; // 每日首次启动：今日已备
  }
  // 同秒多次手动备份：加序号避免互相覆盖（自动备份按天去重，不走此分支）
  for (let i = 2; fs.existsSync(destFile); i++) {
    destFile = path.join(destDir, name.replace(/\.zip$/, `-${i}.zip`));
  }

  // 先把内存库刷盘，保证备份的是最新状态
  if (typeof opts.flush === "function") opts.flush();

  try {
    const zip = new JSZip();
    const meta = {
      app: APP_TAG,
      format: FORMAT,
      label,
      createdAt: (opts.now ? opts.now.getTime() : Date.now()),
      includesAIConfig: includeAIConfig,
      appVersion: opts.appVersion || null,
      counts: opts.counts || null,
      assetFiles: 0
    };
    zip.file("library.db", fs.readFileSync(p.dbFile), { compression: "DEFLATE" });
    if (fs.existsSync(p.settingsFile)) {
      zip.file("settings.json", fs.readFileSync(p.settingsFile), { compression: "DEFLATE" });
    }
    if (includeAIConfig && fs.existsSync(p.aiConfigFile)) {
      zip.file("ai-config.json", fs.readFileSync(p.aiConfigFile), { compression: "DEFLATE" });
    }
    if (fs.existsSync(p.assetsDir)) {
      // 批次 C（D-TEST-18）：已软删书的 item 目录不再进备份（字节仍留在磁盘，回收是显式清理的事）。
      // 只按「一级目录名 = item id」跳过；assets/ 根下散落的历史文件照旧打包，别误删。
      // 依赖注入照本模块既有模式（opts.dataDir / opts.backupDir / opts.flush()）：
      // backup.js 不 require db 层，deletedItemIds 由 main.js 的 backupOpts() 塞进来，缺省空集合
      // → 未传时行为与今天完全一致。
      const deleted = opts.deletedItemIds instanceof Set ? opts.deletedItemIds : new Set(opts.deletedItemIds || []);
      for (const f of walkFiles(p.assetsDir)) {
        if (deleted.has(String(f.rel).split(/[\\/]/)[0])) continue;
        zip.file(`assets/${f.rel}`, fs.readFileSync(f.full), {
          compression: isAlreadyCompressed(f.rel) ? "STORE" : "DEFLATE"
        });
        meta.assetFiles++;
      }
    }
    // v45（M14-UM1，§4.18-15）：用户记忆文件树随备份（记忆真源在 memory/，非 DB）
    meta.memoryFiles = 0;
    if (fs.existsSync(p.memoryDir)) {
      for (const f of walkFiles(p.memoryDir)) {
        zip.file(`memory/${f.rel}`, fs.readFileSync(f.full), { compression: "DEFLATE" });
        meta.memoryFiles++;
      }
    }
    zip.file("backup-meta.json", JSON.stringify(meta, null, 2), { compression: "DEFLATE" });
    const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    // 先写临时名再改名，避免半成品 zip 被当作可用备份
    const tmp = destFile + ".part";
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, destFile);
    return { ok: true, file: destFile, meta };
  } catch (err) {
    try { fs.rmSync(destFile + ".part", { force: true }); } catch { /* 忽略 */ }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const listCache = new Map(); // file → { key, entry }（按 mtime+size 失效，避免列表反复解压全部 zip）

async function readBackupMeta(file) {
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return null;
  }
  try {
    const zip = await JSZip.loadAsync(buf);
    const entry = zip.file("backup-meta.json");
    if (!entry) return null;
    return JSON.parse(await entry.async("string"));
  } catch {
    return null;
  }
}

async function listBackups(opts = {}) {
  const dir = getBackupDir(opts);
  if (!fs.existsSync(dir)) return { backupDir: dir, backups: [] };
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!/^backup-(manual|auto|safety)-.+\d\.zip$/i.test(name)) continue;
    const full = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const key = `${st.mtimeMs}-${st.size}`;
    let meta = null;
    const hit = listCache.get(full);
    if (hit && hit.key === key) meta = hit.meta;
    else {
      meta = await readBackupMeta(full);
      listCache.set(full, { key, meta });
    }
    const label = (name.match(/^backup-(manual|auto|safety)-/) || [])[1] || "manual";
    out.push({
      file: name,
      path: full,
      label: meta?.label || label,
      createdAt: meta?.createdAt || st.mtimeMs,
      includesAIConfig: !!meta?.includesAIConfig,
      counts: meta?.counts || null,
      assetFiles: meta?.assetFiles ?? null,
      sizeBytes: st.size,
      valid: !!meta
    });
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return { backupDir: dir, backups: out };
}

// 每日首次启动自动滚动备份；保留份数 app.autoBackupKeep（默认 7，超出删最旧）
async function autoBackupIfNeeded(opts = {}) {
  const p = resolvePaths(opts);
  const cfg = readAppSettings(p.settingsFile)?.app || {};
  if (cfg.autoBackupEnabled === false) return { ok: true, skipped: "disabled" };
  const keep = Math.max(1, Math.min(90, Number(cfg.autoBackupKeep) || 7));
  const dir = opts.backupDir || getBackupDir(opts);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    return { ok: false, error: `备份位置不可写（${dir}）：${err.message}` };
  }
  const today = `backup-auto-${dayTag(opts.now)}.zip`;
  if (fs.existsSync(path.join(dir, today))) return { ok: true, skipped: "already-today" };
  const r = await createBackup({ ...opts, label: "auto", includeAIConfig: false });
  if (!r.ok || r.skipped) return r;
  rotateAutoBackups(dir, keep);
  return r;
}

function rotateAutoBackups(dir, keep) {
  let autos;
  try {
    autos = fs.readdirSync(dir).filter((f) => AUTO_RE.test(f)).sort();
  } catch {
    return;
  }
  for (const f of autos.slice(0, Math.max(0, autos.length - keep))) {
    try {
      fs.rmSync(path.join(dir, f), { force: true });
    } catch { /* 单个删除失败不影响其余 */ }
  }
}

// 从备份 zip 恢复：校验 → 安全备份当前数据 → 解包到 staging + 写标记（重启时换入生效）
async function restoreBackup(file, opts = {}) {
  const p = resolvePaths(opts);
  if (!fs.existsSync(file)) return { ok: false, error: "备份文件不存在" };
  let zip;
  try {
    zip = await JSZip.loadAsync(fs.readFileSync(file));
  } catch {
    return { ok: false, error: "无法读取备份文件（不是有效的 zip）" };
  }
  const metaEntry = zip.file("backup-meta.json");
  if (!metaEntry) return { ok: false, error: "这不是本软件生成的备份文件（缺少 backup-meta.json）" };
  let meta;
  try {
    meta = JSON.parse(await metaEntry.async("string"));
  } catch {
    return { ok: false, error: "备份清单损坏（backup-meta.json 无法解析）" };
  }
  if (meta.app !== APP_TAG || Number(meta.format) !== FORMAT) {
    return { ok: false, error: "备份格式不匹配（来自其他应用或版本格式）" };
  }
  if (!zip.file("library.db")) return { ok: false, error: "备份不完整：缺少 library.db" };

  // 恢复保护：先对当前数据做一次安全备份（防误恢复本身丢数据）
  let safetyFile = null;
  if (!opts.skipSafety) {
    const safety = await createBackup({ ...opts, label: "safety", includeAIConfig: true });
    if (!safety.ok) return { ok: false, error: `恢复前安全备份失败，已中止恢复：${safety.error}` };
    safetyFile = safety.file;
  }

  // 解包到 staging（运行中的 sql.js 仍持有内存库，绝不在运行期直接改写 library.db）
  try {
    fs.rmSync(p.stagingDir, { recursive: true, force: true });
    fs.mkdirSync(p.stagingDir, { recursive: true });
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      const dest = path.resolve(p.stagingDir, entry.name);
      if (!dest.startsWith(path.resolve(p.stagingDir) + path.sep)) continue; // 防 zip 路径穿越
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, await entry.async("nodebuffer"));
    }
    fs.writeFileSync(p.markerFile, JSON.stringify({ stagedAt: Date.now(), source: String(file), meta }, null, 2));
  } catch (err) {
    try { fs.rmSync(p.stagingDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
    return { ok: false, error: `解包备份失败：${err instanceof Error ? err.message : String(err)}` };
  }
  return { ok: true, needsRestart: true, meta, safetyFile };
}

// 启动时（initDb 之前）检查标记：把 staging 换入数据目录。返回 false=无待恢复
function applyPendingRestore(opts = {}) {
  const p = resolvePaths(opts);
  if (!fs.existsSync(p.markerFile)) return false;
  let marker = null;
  try {
    marker = JSON.parse(fs.readFileSync(p.markerFile, "utf-8"));
  } catch {
    fs.rmSync(p.markerFile, { force: true });
    return false;
  }
  const restored = [];
  const stagedDb = path.join(p.stagingDir, "library.db");
  if (fs.existsSync(stagedDb)) {
    fs.rmSync(p.dbFile, { force: true });
    fs.renameSync(stagedDb, p.dbFile);
    restored.push("library.db");
  }
  const stagedAssets = path.join(p.stagingDir, "assets");
  if (fs.existsSync(stagedAssets)) {
    fs.rmSync(p.assetsDir, { recursive: true, force: true });
    fs.renameSync(stagedAssets, p.assetsDir);
    restored.push("assets");
  }
  // v45（M14-UM1，§4.18-15）：记忆文件树随备份恢复（整体换入，不合并）
  const stagedMemory = path.join(p.stagingDir, "memory");
  if (fs.existsSync(stagedMemory)) {
    fs.rmSync(p.memoryDir, { recursive: true, force: true });
    fs.renameSync(stagedMemory, p.memoryDir);
    restored.push("memory");
  }
  const stagedSettings = path.join(p.stagingDir, "settings.json");
  if (fs.existsSync(stagedSettings)) {
    fs.copyFileSync(stagedSettings, p.settingsFile);
    restored.push("settings.json");
  }
  const stagedAI = path.join(p.stagingDir, "ai-config.json");
  if (fs.existsSync(stagedAI)) {
    fs.copyFileSync(stagedAI, p.aiConfigFile);
    restored.push("ai-config.json");
  }
  fs.rmSync(p.stagingDir, { recursive: true, force: true });
  fs.rmSync(p.markerFile, { force: true });
  return { restored, meta: marker?.meta || null, source: marker?.source || null };
}

// 当前数据量（设置页展示用）
function getDataInfo(opts = {}) {
  const p = resolvePaths(opts);
  let dbBytes = 0;
  try {
    dbBytes = fs.statSync(p.dbFile).size;
  } catch { /* 无库文件 */ }
  let assetFiles = 0;
  let assetBytes = 0;
  if (fs.existsSync(p.assetsDir)) {
    for (const f of walkFiles(p.assetsDir)) {
      assetFiles++;
      try {
        assetBytes += fs.statSync(f.full).size;
      } catch { /* 忽略 */ }
    }
  }
  return { dbBytes, assetFiles, assetBytes };
}

module.exports = {
  createBackup,
  listBackups,
  restoreBackup,
  applyPendingRestore,
  autoBackupIfNeeded,
  rotateAutoBackups,
  getBackupDir,
  getDataInfo,
  readBackupMeta
};
