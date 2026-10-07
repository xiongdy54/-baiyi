// M2 数据备份与恢复（文档 §9.1 M2）
// 备份 = 单个 zip：library.db 全库 + assets/** + settings.json（ai-config.json 含加密 Key，默认不入、勾选才含）
// 恢复 = 校验 → 先对当前数据做安全备份 → 解包到 restore-staging/ + restore-pending.json 标记
//        → 重启应用时 applyPendingRestore() 换入生效（sql.js 内存库约束 §7.1.8，运行期禁止直接换库文件）
// 核心函数均接受显式路径（opts.dataDir 等），缺省时从 electron app 取——便于无 Electron 环境跑单元测试。
// D117（v48.73）：备份列表 meta 走 sidecar 加速缓存（<backupDir>/meta/<zip 名>.json），列表零解压；
//                回退解析在 worker_threads 内执行——主进程不再被整包读 zip 阻塞（打开设置卡顿根治）。
const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const { Worker } = require("worker_threads");

const APP_TAG = "incremental-reading-dev";
const FORMAT = 1;
const AUTO_RE = /^backup-auto-\d{4}-\d{2}-\d{2}\.zip$/;
// A-13（审计）：safety 备份此前**不在任何清理路径里**（AUTO_RE 只认 backup-auto-*），
// 而它每执行一次「恢复」就产出一份 —— 实测连恢复 4 次即累积 4 份，永久留存。
// 给 safety 单独一个上限（保留最近 5 份，足够回退几次误恢复）。
const SAFETY_RE = /^backup-safety-\d{8}-\d{6}(-\d+)?\.zip$/;
const SAFETY_KEEP = 5;
// D117（v48.73，docs/design/SETTINGS-OPEN-JANK-D116.md §4.1/§4.2）：备份列表元数据 sidecar。
// 备份 zip 本体仍是唯一事实源（§1.9「同一份事实不允许两套解释」）；sidecar 只是**列表加速缓存**：
// 命中（key = zip 的 mtime+size，与下方 listCache 同键先例）→ 列表零解压毫秒级返回；
// 缺失/损坏/失配（zip 被篡改、替换）→ 回退 zip 解析（worker_threads 内执行，§4.2）→ 成功即补写自愈。
// 文件 = <backupDir>/meta/<zip 名>.json（报告 §4.1 的「zip 名 + .json」）。只挪进子目录的原因：
// 既有闸门与单测按「目录顶层文件名」过滤计数（f05 B6 的 ^backup-auto- 计数、backup.test.cjs 同型断言），
// 顶层散放 .json 会被一并计入而误报；子目录同时让备份目录对用户保持「只有 zip」的干净视图。
const SIDECAR_DIR = "meta";
const BACKUP_ZIP_RE = /^backup-(manual|auto|safety)-.+\d\.zip$/i;

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
    // A-4（审计）：词条本体在独立的 dictionary.db、原始包在 dicts/，而登记表 dict_sources 在主库。
    // 此前这两项**完全不在备份清单里**，于是恢复任意备份后，设置页仍列「ECDICT · 340 万词条 · 启用」，
    // 选中任何词一律「未找到释义」（§7.2 L857 的「新增表一律进主库」前提被第二个库文件绕开了）。
    dictDbFile: opts.dictDbFile || path.join(dataDir, "dictionary.db"),
    dictsDir: opts.dictsDir || path.join(dataDir, "dicts"),
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

// A-13（审计）：ai-config.json 里可能含**明文** Key（electron/ai.js 在 safeStorage 不可用时的兜底分支
// 会写 apiKeyPlain 与 keys[preset]="plain:…"）。本文件头注释假定它「含加密 Key」，
// 所以「恢复前强制带一份」看起来无害 —— 那个假定不成立。打包前统一剥掉明文形态，只留 safeStorage 密文。
function sanitizeAIConfigForBackup(text) {
  try {
    const cfg = JSON.parse(text);
    let touched = false;
    if (cfg && typeof cfg === "object") {
      if (cfg.apiKeyPlain !== undefined) { delete cfg.apiKeyPlain; touched = true; }
      if (cfg.keys && typeof cfg.keys === "object") {
        for (const k of Object.keys(cfg.keys)) {
          const v = cfg.keys[k];
          if (typeof v === "string" && v.startsWith("plain:")) { delete cfg.keys[k]; touched = true; }
        }
      }
    }
    return touched ? Buffer.from(JSON.stringify(cfg, null, 2), "utf8") : Buffer.from(text, "utf8");
  } catch {
    return Buffer.from(text, "utf8"); // 解析不了就原样（宁可备份一份坏配置，也不静默丢）
  }
}

// A-14（审计）：把「先 rmSync 线上、再 renameSync 挪进来」换成**先让位、再换入、成功才清理**。
// 换入前的内容校验（D-TEST-85/87）：SQLite 头部 + 页大小/页数 与文件长度是否自洽。
// 0 字节、垃圾字节、以及"头部还在但正文被截断"三类都能被这一步拦下，且不引入第二个 WASM 实例。
// 边界：不校验应用 schema（那需要真开库），本函数只回答"它是不是一个完整的 SQLite 文件"。
function isIntactSqliteFile(file) {
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return false;
  }
  if (buf.length < 512) return false;
  if (buf.subarray(0, 16).toString("latin1") !== "SQLite format 3\u0000") return false;
  let pageSize = (buf[16] << 8) | buf[17];
  if (pageSize === 1) pageSize = 65536;
  if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0) return false;
  const pageCount = (buf[28] << 24) | (buf[29] << 16) | (buf[30] << 8) | buf[31];
  if (pageCount <= 0) return false;
  return buf.length >= pageSize * pageCount;
}

// settings.json / ai-config.json 这类必须是"JSON 对象整体"才允许覆盖（D-TEST-87）
function isJsonObjectFile(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf-8"));
    return !!v && typeof v === "object" && !Array.isArray(v);
  } catch {
    return false;
  }
}

// 原写法两步非原子：rename 一旦失败（跨设备 / 杀软实时扫描占用 / 权限 / 磁盘抖动），
// 线上数据已被删掉而备份又没进去 —— 实测 library.db / assets / memory 三处都会因此被清空。
// 返回让位文件路径（供整体成功后统一清理，或失败时回滚）。
function swapIn(stagedPath, livePath) {
  const aside = livePath + ".pre-restore";
  try { fs.rmSync(aside, { recursive: true, force: true }); } catch { /* 清上次残留 */ }
  const hadLive = fs.existsSync(livePath);
  if (hadLive) fs.renameSync(livePath, aside); // 原子让位；这一步失败则线上分毫未动
  try {
    fs.renameSync(stagedPath, livePath);       // 换入
  } catch (e) {
    if (hadLive) { try { fs.renameSync(aside, livePath); } catch { /* 回滚尽力 */ } }
    throw e;
  }
  return hadLive ? aside : null;
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
      // A-13：剥掉明文形态再打包（safeStorage 密文原样保留）
      zip.file("ai-config.json", sanitizeAIConfigForBackup(fs.readFileSync(p.aiConfigFile, "utf8")), { compression: "DEFLATE" });
    }
    // A-4：词典本体随备份走
    if (fs.existsSync(p.dictDbFile)) {
      zip.file("dictionary.db", fs.readFileSync(p.dictDbFile), { compression: "DEFLATE" });
    }
    if (fs.existsSync(p.dictsDir)) {
      for (const f of walkFiles(p.dictsDir)) {
        zip.file(`dicts/${f.rel}`, fs.readFileSync(f.full), {
          compression: isAlreadyCompressed(f.rel) ? "STORE" : "DEFLATE"
        });
      }
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
    // D117：落列表加速 sidecar（缓存，非事实源）。写失败不影响备份本体成功
    //（writeSidecar 内部吞错）；这里连 stat 都取不到时同样放弃，留给下次列表/启动补齐自愈。
    try {
      writeSidecar(destFile, statKeyOf(fs.statSync(destFile)), meta);
    } catch { /* 忽略：sidecar 缺失只影响下次列表速度 */ }
    // A-13（审计）：safety 备份纳入滚动清理，否则每执行一次「恢复」就多一份且永不删除
    if (label === "safety") rotateSafetyBackups(destDir, opts.safetyKeep || SAFETY_KEEP);
    return { ok: true, file: destFile, meta };
  } catch (err) {
    try { fs.rmSync(destFile + ".part", { force: true }); } catch { /* 忽略 */ }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const listCache = new Map(); // file → { key, entry }（按 mtime+size 失效，避免列表反复解压全部 zip）

// ---------- D117：meta sidecar（列表加速缓存，zip 本体仍是唯一事实源） ----------

function sidecarPathFor(zipFile) {
  return path.join(path.dirname(zipFile), SIDECAR_DIR, path.basename(zipFile) + ".json");
}
function statKeyOf(st) {
  return `${st.mtimeMs}-${st.size}`;
}

// 读并校验 sidecar：内容 { key, meta }。key 与 zip 当前 mtime+size 不一致（zip 被篡改/替换）→ 视为失效。
// 缺失/损坏/失配一律返回 null，由调用方走 zip 回退解析。
function readSidecar(zipFile, key) {
  try {
    const sc = JSON.parse(fs.readFileSync(sidecarPathFor(zipFile), "utf-8"));
    if (sc && sc.key === key && sc.meta && typeof sc.meta === "object" && !Array.isArray(sc.meta)) return sc.meta;
  } catch { /* 缺失/损坏 → 回退 zip 解析 */ }
  return null;
}

// 原子写 sidecar（temp + rename），best-effort：sidecar 是缓存不是事实源，任何失败都不影响备份本体成功。
// writeFileSync + renameSync 背靠背同步执行、中间无 await ⇒ 进程被杀也造不出半成品 sidecar；
// 临时名后缀用 .new（避开 f39 leftovers 哨兵的 .tmp/.part 模式），失败即清。
function writeSidecar(zipFile, key, meta) {
  const sc = sidecarPathFor(zipFile);
  const tmp = sc + ".new";
  try {
    fs.mkdirSync(path.dirname(sc), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ key, meta }));
    fs.renameSync(tmp, sc);
    return true;
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch { /* 尽力 */ }
    return false;
  }
}

function removeSidecar(dir, zipName) {
  try { fs.rmSync(sidecarPathFor(path.join(dir, zipName)), { force: true }); } catch { /* 尽力：漏删只是无害孤儿 */ }
}

// D117 §4.2（防御纵深）：zip 回退解析挪进 worker_threads —— 主进程（=Chromium browser 进程 UI 线程）
// 永不再被单份大 zip 的「整包读入 + 解压」阻塞（895MB×N 份曾把主进程按住 10–17s）。
// worker 崩溃/超时/不可用 → status:"error"，调用方用同步路径兜底（报告 §4.2「worker 崩溃回退」）。
function parseMetaInWorker(file, timeoutMs = 60000) {
  return new Promise((resolve) => {
    let w;
    try {
      w = new Worker(path.join(__dirname, "backup-meta-worker.js"), { workerData: { file } });
    } catch {
      resolve({ status: "error" });
      return;
    }
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { w.terminate(); } catch { /* 尽力 */ }
      resolve(v);
    };
    const timer = setTimeout(() => finish({ status: "error" }), timeoutMs);
    w.on("message", (m) => finish(m && m.ok ? { status: "ok", meta: m.meta ?? null } : { status: "error" }));
    w.on("error", () => finish({ status: "error" }));
    w.on("exit", () => finish({ status: "error" })); // 没发 message 就退出 = 失败
  });
}

// 同步兜底（worker 不可用时仍可用）：会阻塞主进程，仅作防御回退，正常路径不再走到这里。
async function readBackupMetaSync(file) {
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

// 回退解析（sidecar 未命中时唯一入口）：先 worker（不阻塞主进程），失败再同步兜底。
// 按文件去重并发：listBackups 与启动补齐可能同时盯上同一份旧档，避免重复解析 895MB。
const inflightZipParses = new Map(); // file → Promise<meta|null>
function parseZipMetaFallback(file) {
  let p = inflightZipParses.get(file);
  if (!p) {
    p = (async () => {
      const r = await parseMetaInWorker(file);
      if (r.status === "ok") return r.meta;
      return readBackupMetaSync(file);
    })().finally(() => inflightZipParses.delete(file));
    inflightZipParses.set(file, p);
  }
  return p;
}

// D117：读备份 meta。sidecar 命中 → 零解压直接返回；未命中 → zip 回退解析（worker 内）并补写自愈。
// 返回 null 表示不是本软件的有效备份（与既有语义一致）。
async function readBackupMeta(file) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  const key = statKeyOf(st);
  const hit = readSidecar(file, key);
  if (hit) return hit;
  const meta = await parseZipMetaFallback(file);
  if (meta) writeSidecar(file, key, meta); // 自愈补写（best-effort，失败不影响正确性）
  return meta;
}

// D117：启动空闲补齐（由 main.js 在拿到单实例锁后调度）——为缺 sidecar 的旧档后台补写，
// 让老用户第二次打开设置即全量走 sidecar；顺带回收「zip 已被外部删除」的孤儿 sidecar/半成品。
// 逐份串行 worker 解析（同时最多一份 895MB 在途，内存可控）；全函数不阻塞主进程事件循环。
async function backfillSidecars(opts = {}) {
  const dir = getBackupDir(opts);
  if (!fs.existsSync(dir)) return { ok: true, dir, scanned: 0, written: 0, swept: 0 };
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    return { ok: false, dir, error: err instanceof Error ? err.message : String(err) };
  }
  const zips = names.filter((n) => BACKUP_ZIP_RE.test(n));
  let written = 0;
  for (const name of zips) {
    const full = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const key = statKeyOf(st);
    if (readSidecar(full, key)) continue;
    const meta = await parseZipMetaFallback(full);
    if (meta && writeSidecar(full, key, meta)) written++;
  }
  let swept = 0;
  const metaDir = path.join(dir, SIDECAR_DIR);
  let metaNames = [];
  try {
    metaNames = fs.readdirSync(metaDir);
  } catch { /* meta/ 不存在就没有孤儿 */ }
  for (const name of metaNames) {
    const zipName = name.endsWith(".json.new")
      ? name.slice(0, -".json.new".length)
      : name.endsWith(".json")
        ? name.slice(0, -".json".length)
        : null;
    if (!zipName || !BACKUP_ZIP_RE.test(zipName)) continue;
    if (fs.existsSync(path.join(dir, zipName))) continue;
    try { fs.rmSync(path.join(metaDir, name), { force: true }); swept++; } catch { /* 尽力 */ }
  }
  return { ok: true, dir, scanned: zips.length, written, swept };
}

async function listBackups(opts = {}) {
  const dir = getBackupDir(opts);
  if (!fs.existsSync(dir)) return { backupDir: dir, backups: [] };
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!BACKUP_ZIP_RE.test(name)) continue;
    const full = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const key = statKeyOf(st);
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

// safety 备份的滚动清理（按文件名字典序 = 时间序，与 auto 同策略）
function rotateSafetyBackups(dir, keep = SAFETY_KEEP) {
  const safeties = listByMtimeAsc(dir, SAFETY_RE);
  for (const f of safeties.slice(0, Math.max(0, safeties.length - keep))) {
    try { fs.rmSync(path.join(dir, f), { force: true }); } catch { /* 单个删除失败不影响其余 */ }
    removeSidecar(dir, f); // D117：zip 被轮转掉，它的列表 sidecar 一并清（漏删也只是无害孤儿）
  }
}

// D-TEST-35：按**文件修改时间**排序，不按文件名。文件名里的日期来自系统时钟，时钟回拨（用户改时间、
// 同步服务拉回旧时间、跨时区迁移）会产出"看起来更旧"的新备份，字典序把它排到最前当"最旧"删掉——
// 于是越新的备份越先被清。mtime 由文件系统给，不受文件名里那个日期影响。
function listByMtimeAsc(dir, re) {
  let names;
  try {
    names = fs.readdirSync(dir).filter((f) => re.test(f));
  } catch {
    return [];
  }
  return names
    .map((f) => {
      let m = 0;
      try { m = fs.statSync(path.join(dir, f)).mtimeMs; } catch { /* 取不到就排最前，让它先被清 */ }
      return { f, m };
    })
    .sort((a, b) => a.m - b.m)
    .map((x) => x.f);
}

function rotateAutoBackups(dir, keep) {
  const autos = listByMtimeAsc(dir, AUTO_RE);
  for (const f of autos.slice(0, Math.max(0, autos.length - keep))) {
    try {
      fs.rmSync(path.join(dir, f), { force: true });
    } catch { /* 单个删除失败不影响其余 */ }
    removeSidecar(dir, f); // D117：zip 被轮转掉，它的列表 sidecar 一并清（漏删也只是无害孤儿）
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
    // A-13（审计）：原来硬编码 includeAIConfig: true，**覆盖了**用户在设置里对
    // 「包含 AI Key（默认不备）」的选择 —— 勾没勾都无所谓，只要执行一次恢复就被塞进备份目录，
    // 而 backup-safety-* 不匹配 rotateAutoBackups 的 AUTO_RE、永不清理（实测连恢复 4 次 → 4 份含明文密钥的 zip）。
    // 尊重用户选择即可；明文形态另有 sanitizeAIConfigForBackup 兜底。
    const safety = await createBackup({ ...opts, label: "safety", includeAIConfig: !!opts.includeAIConfig });
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
    // D-TEST-86：原来这里静默删掉标记并返回 false，而 false 与"本来就没有待恢复"无法区分，
    // 于是"用户点了恢复 → 重启 → 什么都没发生 → 零提示"永远不会被发现。
    // 现在保留标记（不销毁现场）并把失败如实报给调用方，main.js 的 ok===false 分支会打日志。
    return { ok: false, error: "恢复标记（restore-pending.json）损坏，本次未执行恢复；标记已保留待排查", markerFile: p.markerFile, stagingDir: p.stagingDir };
  }
  const restored = [];
  const asides = []; // A-14：已让位的线上数据；全部换入成功后才清理，中途失败要回滚
  try {
    const stagedDb = path.join(p.stagingDir, "library.db");
    if (fs.existsSync(stagedDb)) {
      // D-TEST-85：暂存库被截成 0 字节或换成垃圾字节时，原逻辑照样换入并返回 ok:true
      // ⇒ 目标机（可能已有真实数据）被替换成一个打不开或空白的库，且零提示。
      if (!isIntactSqliteFile(stagedDb)) {
        throw new Error("备份包里的 library.db 不是完整可读的 SQLite 文件；已中止恢复，线上数据保持原样");
      }
      const a = swapIn(stagedDb, p.dbFile);
      if (a) asides.push({ live: p.dbFile, aside: a });
      restored.push("library.db");
    }
    const stagedAssets = path.join(p.stagingDir, "assets");
    if (fs.existsSync(stagedAssets)) {
      if (!fs.statSync(stagedAssets).isDirectory()) throw new Error("备份包里的 assets 不是目录；已中止恢复");
      const a = swapIn(stagedAssets, p.assetsDir);
      if (a) asides.push({ live: p.assetsDir, aside: a });
      restored.push("assets");
    }
    // v45（M14-UM1，§4.18-15）：记忆文件树随备份恢复（整体换入，不合并）
    const stagedMemory = path.join(p.stagingDir, "memory");
    if (fs.existsSync(stagedMemory)) {
      // D-TEST-87：包里用一个**文件**冒充 memory 目录时，原来会把本地整棵记忆树换掉并报成功
      if (!fs.statSync(stagedMemory).isDirectory()) throw new Error("备份包里的 memory 不是目录；已中止恢复");
      const a = swapIn(stagedMemory, p.memoryDir);
      if (a) asides.push({ live: p.memoryDir, aside: a });
      restored.push("memory");
    }
    // A-4（审计）：词典本体一并换入
    const stagedDictDb = path.join(p.stagingDir, "dictionary.db");
    if (fs.existsSync(stagedDictDb)) {
      // D-TEST-87：包里用一段 JSON 冒充 dictionary.db 时，原来会覆盖掉可用词典库并报成功
      if (!isIntactSqliteFile(stagedDictDb)) throw new Error("备份包里的 dictionary.db 不是完整可读的 SQLite 文件；已中止恢复");
      const a = swapIn(stagedDictDb, p.dictDbFile);
      if (a) asides.push({ live: p.dictDbFile, aside: a });
      restored.push("dictionary.db");
    }
    const stagedDicts = path.join(p.stagingDir, "dicts");
    if (fs.existsSync(stagedDicts)) {
      if (!fs.statSync(stagedDicts).isDirectory()) throw new Error("备份包里的 dicts 不是目录；已中止恢复");
      const a = swapIn(stagedDicts, p.dictsDir);
      if (a) asides.push({ live: p.dictsDir, aside: a });
      restored.push("dicts");
    }
    // settings / ai-config 用 copyFileSync 覆盖，没有「先删后挪」的破坏窗口，保持原样；
    // 但内容必须是 JSON 对象才允许覆盖（D-TEST-87：二进制垃圾覆盖 settings 会让偏好静默损坏）
    const stagedSettings = path.join(p.stagingDir, "settings.json");
    if (fs.existsSync(stagedSettings)) {
      if (!isJsonObjectFile(stagedSettings)) throw new Error("备份包里的 settings.json 不是合法 JSON 对象；已中止恢复");
      fs.copyFileSync(stagedSettings, p.settingsFile);
      restored.push("settings.json");
    }
    const stagedAI = path.join(p.stagingDir, "ai-config.json");
    if (fs.existsSync(stagedAI)) {
      if (!isJsonObjectFile(stagedAI)) throw new Error("备份包里的 ai-config.json 不是合法 JSON 对象；已中止恢复");
      fs.copyFileSync(stagedAI, p.aiConfigFile);
      restored.push("ai-config.json");
    }
  } catch (e) {
    // A-14（审计）：换入是**多步事务**。任何一步失败都要把已换入的退回，
    // 否则会留下「库来自备份、资源已被清空」这种更难诊断的半套状态。
    for (const { live, aside } of asides.reverse()) {
      try { fs.rmSync(live, { recursive: true, force: true }); fs.renameSync(aside, live); } catch { /* 回滚尽力 */ }
    }
    throw e; // 标记与暂存区保留 → 下次启动可重试（见下面的 B-12）
  }
  for (const { aside } of asides) { try { fs.rmSync(aside, { recursive: true, force: true }); } catch { /* 尽力 */ } }

  // B-12（审计）：只有在**真的换入过东西**时才清理标记与暂存区。
  // 原来无条件清 —— 暂存区被清理工具/杀软/手工删掉时，返回 {restored: []} 却把标记也删了，
  // 而 main.js 又把返回值整个丢掉 → 用户主动发起恢复、重启、什么都没变、零提示、也无法重试。
  const ok = restored.length > 0;
  if (ok) {
    fs.rmSync(p.stagingDir, { recursive: true, force: true });
    fs.rmSync(p.markerFile, { force: true });
  }
  return { restored, ok, meta: marker?.meta || null, source: marker?.source || null };
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
  rotateSafetyBackups,
  backfillSidecars,
  getBackupDir,
  getDataInfo,
  readBackupMeta
};
