// M2 数据备份与恢复（文档 §9.1 M2）
// 备份 = 单个 zip：library.db 全库 + assets/** + settings.json（ai-config.json 含加密 Key，默认不入、勾选才含）
// 恢复 = 校验 → 先对当前数据做安全备份 → 解包到 restore-staging/ + restore-pending.json 标记
//        → 重启应用时 applyPendingRestore() 换入生效——运行期主进程持有数据库连接（better-sqlite3，§7.1.8），禁止直接替换库文件
// 核心函数均接受显式路径（opts.dataDir 等），缺省时从 electron app 取——便于无 Electron 环境跑单元测试。
// D117（v48.73）：备份列表 meta 走 sidecar 加速缓存（<backupDir>/meta/<zip 名>.json），列表零解压；
//                回退解析在 worker_threads 内执行——主进程不再被整包读 zip 阻塞（打开设置卡顿根治）。
// D143（v48.98，T1）：备份**构建**（快照整读 + JSZip DEFLATE + 整包写盘）移入 worker_threads
//                （electron/backup-build-worker.js）——主进程不再被每日首启备份的 0.3~1.4s 单段
//                事件循环空洞冻结（诊断 docs/design/STARTUP-LAG-DIAGNOSIS.md §3 R1b）。
// C-12：备份/恢复全面流式化（yazl 写 / yauzl 读，自动 ZIP64）。JSZip 的整文件整包内存路径
//                在 >2GiB 抛 ERR_FS_FILE_TOO_LARGE、>4GiB 产出损坏 zip；备份与恢复自此与文件大小解耦。
const fs = require("fs");
const path = require("path");
const { openZip, forEachEntry, extractAll, readBackupMeta: readZipBackupMeta } = require("./zipRead");
const { Worker } = require("worker_threads");
const Database = require("better-sqlite3");
const schema = require("./schemaVersion");
// C-15：settings.json 读取与全仓共用同一实现（BOM / 非对象留档）
const { readJsonObject } = require("./jsonFile");

// C-11：冻结的备份格式标识，与应用名无关——改值会让既有备份全部无法恢复（restore 按 app+format 校验）。
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
    // D248（T13）：行为库是独立 SQLite 文件；进备份（原始行为数据不可由主库重建）
    behaviorDbFile: opts.behaviorDbFile || path.join(dataDir, "behavior.db"),
    behaviorPolicyFile: opts.behaviorPolicyFile || path.join(dataDir, "behavior-policy.json"),
    stagingDir: opts.stagingDir || path.join(dataDir, "restore-staging"),
    markerFile: opts.markerFile || path.join(dataDir, "restore-pending.json")
  };
}

function readAppSettings(settingsFile) {
  return readJsonObject(settingsFile, () => ({}));
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
// C-12：只读 100 字节头 + stat 自洽性判断——原实现为看 100 字节头而 readFileSync 整个库文件
//（dictionary.db 835MB / 未来 >2GiB 直接抛 ERR_FS_FILE_TOO_LARGE，校验反而变成恢复的拦路虎）。
function isIntactSqliteFile(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    if (size < 512) return false;
    const buf = Buffer.alloc(100);
    if (fs.readSync(fd, buf, 0, 100, 0) < 100) return false;
    if (buf.subarray(0, 16).toString("latin1") !== "SQLite format 3\u0000") return false;
    let pageSize = buf.readUInt16BE(16);
    if (pageSize === 1) pageSize = 65536;
    if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0) return false;
    const pageCount = buf.readUInt32BE(28);
    if (pageCount <= 0) return false;
    return size >= pageSize * pageCount;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* 忽略 */ } }
  }
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

// D137（§3.4 ③ / §3.6，WAL sidecar 陷阱 M2 对策②）：恢复换入库文件时必须同删目标库的
// -wal/-shm sidecar——换入后 sidecar 名字仍与线上库名匹配，陈旧 WAL 配错配文件 = 损坏。
// 换入成功后调用；staging 侧的 -wal/-shm 本就不该存在（db.backup() 快照产物无 sidecar）。
function clearDbSidecars(dbPath) {
  for (const suffix of ["-wal", "-shm"]) {
    try { fs.rmSync(dbPath + suffix, { force: true }); } catch { /* 尽力而为 */ }
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

// D143（v48.98，T1）：备份构建（快照整读 + JSZip DEFLATE + 整包写盘）移入 worker_threads。
// 背景（诊断 STARTUP-LAG-DIAGNOSIS §3 R1b）：这三段在每日首启备份里的主进程执行构成多段
// 0.3~1.4s 事件循环空洞。worker 只读文件、写 .part 后 rename；零 DB 写路径（快照仍由主进程
// db.backup() 产出）。worker 内 optional 的只读 quick_check 只上报结果，不影响备份成败。
function buildZipInWorker(workerData) {
  return new Promise((resolve) => {
    let w;
    try {
      w = new Worker(path.join(__dirname, "backup-build-worker.js"), { workerData });
    } catch (e) {
      resolve({ ok: false, error: `备份构建 worker 启动失败：${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    let settled = false;
    // C-23：快照 quick_check 结果（name → "ok" | 错误文本）——不只写日志，随 done 一起带出，
    // 供 autoBackupIfNeeded 参与轮换决策（主库损坏时暂停删除旧备份）。
    const integrity = {};
    const finish = (v) => {
      if (settled) return;
      settled = true;
      try { w.terminate(); } catch { /* 尽力 */ }
      resolve(v);
    };
    w.on("message", (m) => {
      if (!m || typeof m !== "object") return;
      if (m.type === "quickCheck") {
        integrity[m.name] = m.result !== undefined ? String(m.result) : String(m.error || "");
        // D137 §3.5 语义（结果仅入应用日志）；D143 起自「启动同步」改「每日备份时后台」执行
        if (m.result && m.result !== "ok") console.error(`[backup] 快照完整性检查异常：${m.name} quick_check=${m.result}`);
        else if (m.result) console.log(`[backup] 快照完整性检查通过：${m.name} quick_check=${m.result}`);
        else console.error(`[backup] 快照完整性检查失败：${m.name} ${m.error || ""}`);
        return;
      }
      if (m.type === "done") {
        if (m.ok) finish({ ok: true, bytes: Number(m.bytes) || 0, integrity });
        else finish({ ok: false, error: m.error || "备份构建失败" });
      }
    });
    w.on("error", (e) => finish({ ok: false, error: `备份构建 worker 异常：${e instanceof Error ? e.message : String(e)}` }));
    w.on("exit", (code) => finish({ ok: false, error: `备份构建 worker 提前退出（code=${code}）` }));
  });
}

// D143 复审修复（M3，独立审查必需项）：本进程在途快照目录登记——启动清扫（sweepBackupOrphans）
// 绝不误删本进程 createBackup 正在写/读的 `.snapshot-*`（防御纵深；常规时序清扫在 +5s、备份在 +30s，
// 此时集合为空；若用户启动后立即手动备份，登记仍在场，清扫照常放行）。
const activeSnapshotDirs = new Set();

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

  // 先做一次 WAL checkpoint，把已提交的写入合并回主文件，保证备份的是最新状态
  // （D137：flush = persist() = wal_checkpoint(TRUNCATE)；sql.js 内存库已退役，不存在「内存库刷盘」）
  if (typeof opts.flush === "function") opts.flush();

  // D137（§3.6，WAL sidecar 陷阱 M2 对策①）：WAL 下裸 readFileSync 库文件可能缺最近提交
  // 且无事务一致性保证——library.db / dictionary.db 改走注入的 db.backup() 在线快照
  // （页拷贝、逐小步 setImmediate 让出，实测不产生 >100ms 主进程单段空洞）。快照落盘到
  // 临时目录、由构建 worker 读入 zip 后即清。
  // 未注入快照函数的环境（既有单测 / 无 db 层调用方）退化为直接读库主文件——此时调用方
  // 必须已 flush（checkpoint）过，主文件才自足。
  // D143（T1）：快照产物「路径」交给 worker 读（原先在主进程 readFileSync 整读入 zip，
  // 835MB×2 的同步读构成启动期空洞）。
  let snapDir = null;
  const snapTo = async (liveFile, snapFn, name) => {
    if (typeof snapFn === "function") {
      if (!snapDir) {
        snapDir = fs.mkdtempSync(path.join(destDir, ".snapshot-"));
        activeSnapshotDirs.add(path.resolve(snapDir)); // D143 复审 M3：登记在途快照（启动清扫放行）
      }
      const snapPath = path.join(snapDir, name);
      await snapFn(snapPath);
      return snapPath;
    }
    return liveFile;
  };

  try {
    const libSrc = await snapTo(p.dbFile, opts.snapshotLibrary, "library.db");
    const createdAt = opts.now ? opts.now.getTime() : Date.now();
    const meta = {
      app: APP_TAG,
      format: FORMAT,
      label,
      createdAt,
      snapshotAtLibrary: createdAt,
      includesAIConfig: includeAIConfig,
      appVersion: opts.appVersion || null,
      // C-38c（审计）：设备 ID 与库 schema 版本进 meta（信息性字段，缺省 null 向后兼容旧档）——
      // 恢复确认对话框据此提示「此备份来自另一台设备」；device.json 本身不进备份清单（显式列举，成员不变）。
      deviceId: opts.deviceId || null,
      schemaVersion: opts.schemaVersion || null,
      counts: opts.counts || null,
      assetFiles: 0
    };
    const entries = [];
    entries.push({ zipPath: "library.db", filePath: libSrc, compression: "DEFLATE" });
    if (fs.existsSync(p.settingsFile)) {
      entries.push({ zipPath: "settings.json", data: fs.readFileSync(p.settingsFile), compression: "DEFLATE" });
    }
    if (includeAIConfig && fs.existsSync(p.aiConfigFile)) {
      // A-13：剥掉明文形态再打包（safeStorage 密文原样保留）
      entries.push({ zipPath: "ai-config.json", data: sanitizeAIConfigForBackup(fs.readFileSync(p.aiConfigFile, "utf8")), compression: "DEFLATE" });
    }
    // A-4：词典本体随备份走（D137：经 db.backup() 快照，同 library.db）
    const dictSrc = fs.existsSync(p.dictDbFile) ? await snapTo(p.dictDbFile, opts.snapshotDict, "dictionary.db") : null;
    if (dictSrc) entries.push({ zipPath: "dictionary.db", filePath: dictSrc, compression: "DEFLATE" });
    // D248（T13）：behavior.db 与主库顺序快照——不承诺同一时点；meta 记录偏差，恢复后边界日标 partial
    if (fs.existsSync(p.behaviorDbFile)) {
      if (typeof opts.snapshotBehavior === "function") {
        const bsrc = await snapTo(p.behaviorDbFile, opts.snapshotBehavior, "behavior.db");
        entries.push({ zipPath: "behavior.db", filePath: bsrc, compression: "DEFLATE" });
        const at = opts.now ? opts.now.getTime() : Date.now();
        meta.behavior = { included: true, snapshotAt: at, snapshotAtBehavior: at, schemaVersion: opts.behaviorSchemaVersion || null, dataEpoch: opts.behaviorDataEpoch || null, counts: opts.behaviorCounts || null };
        meta.snapshotAtBehavior = at;
        meta.crossDbSkewMs = Math.max(0, at - createdAt);
      } else if (opts.production) {
        // 生产环境缺快照函数不得退回裸拷贝运行库
        meta.behavior = { included: false, reason: "snapshot_unavailable" };
      } else {
        const bsrc = await snapTo(p.behaviorDbFile, null, "behavior.db");
        entries.push({ zipPath: "behavior.db", filePath: bsrc, compression: "DEFLATE" });
        meta.behavior = { included: true, snapshotAt: createdAt, raw: true };
      }
    } else {
      meta.behavior = { included: false, reason: "missing" };
    }
    if (fs.existsSync(p.dictsDir)) {
      for (const f of walkFiles(p.dictsDir)) {
        entries.push({ zipPath: `dicts/${f.rel}`, filePath: f.full, compression: isAlreadyCompressed(f.rel) ? "STORE" : "DEFLATE" });
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
        entries.push({ zipPath: `assets/${f.rel}`, filePath: f.full, compression: isAlreadyCompressed(f.rel) ? "STORE" : "DEFLATE" });
        meta.assetFiles++;
      }
    }
    // v45（M14-UM1，§4.18-15）：用户记忆文件树随备份（记忆真源在 memory/，非 DB）
    meta.memoryFiles = 0;
    if (fs.existsSync(p.memoryDir)) {
      for (const f of walkFiles(p.memoryDir)) {
        entries.push({ zipPath: `memory/${f.rel}`, filePath: f.full, compression: "DEFLATE" });
        meta.memoryFiles++;
      }
    }
    entries.push({ zipPath: "backup-meta.json", data: Buffer.from(JSON.stringify(meta, null, 2), "utf8"), compression: "DEFLATE" });
    // C-12：构建前磁盘空间检查（按源文件大小估算；压缩后只会更小，200MB 为元数据/系统余量）
    let total = 0;
    for (const e of entries) total += e.data !== undefined ? e.data.length : fs.statSync(e.filePath).size;
    try {
      const st = fs.statfsSync(destDir);
      const need = total + 200 * 1024 * 1024;
      if (st.bavail * st.bsize < need) {
        return { ok: false, error: `备份位置磁盘空间不足（${destDir}，需要约 ${(Math.ceil((need / 1024 ** 3) * 10) / 10).toFixed(1)} GB）` };
      }
    } catch { /* statfs 不可用则跳过预检，写盘失败照常报错 */ }
    // D143（T1）：构建（整读→DEFLATE→写盘）全部在 worker 线程内，主进程只收消息。
    const tmp = destFile + ".part";
    const built = await buildZipInWorker({
      entries,
      destFile,
      tmpFile: tmp,
      // C-23：主库快照也纳入 quick_check（只在确实是快照时检查——注入了 snapshotLibrary 才检查；
      // 未注入的环境（既有单测 / 直读主文件）不检查在线文件，避免与打开中的连接并发读写）。
      quickCheck: [
        ...(libSrc !== p.dbFile ? [{ name: "library.db", path: libSrc }] : []),
        ...(dictSrc ? [{ name: "dictionary.db", path: dictSrc }] : [])
      ]
    });
    if (!built.ok) throw new Error(built.error || "备份构建失败");
    // D117：落列表加速 sidecar（缓存，非事实源）。写失败不影响备份本体成功
    //（writeSidecar 内部吞错）；这里连 stat 都取不到时同样放弃，留给下次列表/启动补齐自愈。
    try {
      writeSidecar(destFile, statKeyOf(fs.statSync(destFile)), meta);
    } catch { /* 忽略：sidecar 缺失只影响下次列表速度 */ }
    // A-13（审计）：safety 备份纳入滚动清理，否则每执行一次「恢复」就多一份且永不删除
    if (label === "safety") rotateSafetyBackups(destDir, opts.safetyKeep || SAFETY_KEEP, new Set([path.basename(destFile)]));
    // C-23：透传快照 quick_check 结果（无检查项时为空对象），供调用方（autoBackupIfNeeded）决策
    return { ok: true, file: destFile, meta, integrity: built.integrity || {} };
  } catch (err) {
    try { fs.rmSync(destFile + ".part", { force: true }); } catch { /* 忽略 */ }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    // D137：快照临时目录用后即清（含失败路径）
    if (snapDir) {
      try { fs.rmSync(snapDir, { recursive: true, force: true }); } catch { /* 尽力 */ }
      activeSnapshotDirs.delete(path.resolve(snapDir)); // D143 复审 M3：注销在途登记
    }
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

// 同步兜底（worker 不可用时仍可用）：仅作防御回退，正常路径不再走到这里。
// C-12：改为 zipRead 流式实现（旧 JSZip.loadAsync(readFileSync) 有 2GiB 上限且整包进内存；
// 本函数本就是 async，名字沿用既有调用方）。
async function readBackupMetaSync(file) {
  try {
    return await readZipBackupMeta(file);
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
// D143 复审修复（M3，独立审查必需项）：中断残留清扫（对齐 D117 backfillSidecars 启动空闲清扫先例）。
// 背景：T1 把备份构建移出启动关键路径后，正常退出（托盘退出 / app:relaunch / closeToTray 关）即可
// 中断在途备份——两类残留此前只靠 createBackup 的 catch/finally 兜底，进程被中断即永久孤儿：
//   ① destDir/.snapshot-*（mkdtemp 唯一名；每个 ≈ 库快照体积）、② backup-*.zip.part（跨日不再被
//   同日重试覆盖回收）。本函数挂在启动空闲批次（backfillSidecars → +5s 定时）执行，只清历史残留。
// 绝不误删在途备份（安全边界）：
//   - .snapshot-*：跳过本进程登记（activeSnapshotDirs）；且只清 mtime 非今日的——当日残留可能是
//     他进程在途（单实例锁下理论不并存，防御性保留），次日启动自然回收。
//   - backup-*.zip.part（文件名含日期：auto=YYYY-MM-DD；manual/safety=YYYYMMDD-HHMMSS）：
//     日期 = 今日的一律保留（可能是在途构建，同日重试会覆盖复用）；解析不出日期的一律保留（保守）。
function partFileDayTag(name) {
  let m = name.match(/^backup-auto-(\d{4}-\d{2}-\d{2})\.zip\.part$/i);
  if (m) return m[1];
  m = name.match(/^backup-(?:manual|safety)-(\d{4})(\d{2})(\d{2})-\d{6}(?:-\d+)?\.zip\.part$/i);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function sweepBackupOrphans(opts = {}) {
  const dir = getBackupDir(opts);
  const today = dayTag(opts.now);
  const out = { ok: true, dir, snapshots: 0, parts: 0 };
  let names;
  try { names = fs.readdirSync(dir); } catch { return out; } // 目录不存在/不可读 = 无事可清
  for (const name of names) {
    const full = path.join(dir, name);
    if (name.startsWith(".snapshot-")) {
      if (activeSnapshotDirs.has(path.resolve(full))) continue; // 本进程在途快照
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      if (dayTag(new Date(st.mtimeMs)) === today) continue; // 今日残留留给次日启动再收（可能仍被占用）
      try { fs.rmSync(full, { recursive: true, force: true }); out.snapshots++; } catch { /* 尽力：删不掉下次再清 */ }
      continue;
    }
    if (!name.endsWith(".zip.part")) continue;
    const day = partFileDayTag(name);
    if (!day || day === today) continue; // 当日在途 .part 不误删
    try { fs.rmSync(full, { force: true }); out.parts++; } catch { /* 尽力 */ }
  }
  return out;
}

async function backfillSidecars(opts = {}) {
  const dir = getBackupDir(opts);
  // D143 复审修复（M3）：同一启动空闲批次顺带清扫中断残留（.snapshot-* 孤儿 / 跨日 .part）——
  // 失败只影响残留回收时机，不影响 sidecar 补齐与备份本体语义
  const orphans = sweepBackupOrphans(opts);
  if (!fs.existsSync(dir)) return { ok: true, dir, scanned: 0, written: 0, swept: 0, snapshotsSwept: orphans.snapshots, partsSwept: orphans.parts };
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
  return { ok: true, dir, scanned: zips.length, written, swept, snapshotsSwept: orphans.snapshots, partsSwept: orphans.parts };
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
  if (fs.existsSync(path.join(dir, today))) {
    // C-14：时钟回拨后"今天"的文件可能是几天前以未来日期建的——跳过路径同样要带出 skew 提示
    return { ok: true, skipped: "already-today", clockSkewSuspected: detectClockSkew(dir, opts.now) };
  }
  const r = await createBackup({ ...opts, label: "auto", includeAIConfig: false });
  if (!r.ok || r.skipped) return r;
  // C-23：主库快照完整性检查不通过 → 暂停轮换。主库已损坏时照常轮换，keep 天之后所有
  // 「损坏前」的好备份都会被删光（此时备份反而是唯一自救途径）；本体备份照常产出，
  // 由 main.js 把 integrityWarning 推给渲染层提示用户（backup:integrityWarning 事件）。
  const libQc = r.integrity && r.integrity["library.db"];
  if (libQc !== undefined && libQc !== "ok") {
    return {
      ...r,
      integrityWarning: "数据库完整性检查发现问题，已暂停删除旧备份。请先不要清理备份，并导出诊断信息。",
      clockSkewSuspected: detectClockSkew(dir, opts.now)
    };
  }
  // C-14：刚生成的备份 mtime = 当前系统时间，时钟回拨后它会排到最前当"最旧"——必须 protect
  rotateAutoBackups(dir, keep, new Set([path.basename(r.file)]));
  return { ...r, clockSkewSuspected: detectClockSkew(dir, opts.now) };
}

// safety 备份的滚动清理（按 mtime 排序，与 auto 同策略）。protect：本轮刚生成的文件名——
// C-14：时钟回拨时它 mtime 最小、会被当"最旧"先删，必须从删除候选中排除。
function rotateSafetyBackups(dir, keep = SAFETY_KEEP, protect = new Set()) {
  const safeties = listByMtimeAsc(dir, SAFETY_RE).filter((f) => !protect.has(f));
  const keepOthers = Math.max(0, keep - protect.size);
  for (const f of safeties.slice(0, Math.max(0, safeties.length - keepOthers))) {
    try { fs.rmSync(path.join(dir, f), { force: true }); } catch { /* 单个删除失败不影响其余 */ }
    removeSidecar(dir, f); // D117：zip 被轮转掉，它的列表 sidecar 一并清（漏删也只是无害孤儿）
  }
}

// D-TEST-35：按**文件修改时间**排序，不按文件名。文件名里的日期来自系统时钟，时钟回拨（用户改时间、
// 同步服务拉回旧时间、跨时区迁移）会产出"看起来更旧"的新备份，字典序把它排到最前当"最旧"删掉——
// 于是越新的备份越先被清。按 mtime 排序；但时钟回拨时 mtime 同样不可信（新文件的 mtime 就是当前
// 系统时间，被调回后最新备份的 mtime 反而最小），调用方必须用 protect 保护刚创建的文件（C-14）。
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

// C-14：时钟回拨检测——目录里若有 mtime 晚于「当前时间 + 1 天」的自动备份，说明时钟被回拨过
//（那些备份是在"未来"建的）。只提示、不自动删除任何文件。
function detectClockSkew(dir, now) {
  const base = now ? now.getTime() : Date.now();
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!AUTO_RE.test(f)) continue;
      let m = 0;
      try { m = fs.statSync(path.join(dir, f)).mtimeMs; } catch { continue; }
      if (m > base + 86400000) return true;
    }
  } catch { /* 目录不可读时放弃检测，不影响备份主流程 */ }
  return false;
}

// D235（v49.64）：时钟回拨现场探测——设置页通知框每次打开 / 每 60s 经 backup:info 现取，不再只靠
// 启动 30s 后那一轮自动备份带出的 clockSkewSuspected（自动备份关闭时那条路径恒不判定；时间改正、
// 未来日期的备份清掉后也不会随之消失）。口径与 detectClockSkew 同（修改时间晚于「当前 + 1 天」），
// 范围扩到本软件全部备份（auto / manual / safety——任一份建于「未来」都说明时钟被回拨过）。
// 只读统计、不删除任何文件；目录不可读 → 不判定。
function clockSkewInfo(opts = {}) {
  const base = opts.now ? opts.now.getTime() : Date.now();
  let dir;
  try {
    dir = opts.backupDir || getBackupDir(opts);
  } catch {
    return { suspected: false, count: 0, latestAt: null };
  }
  let count = 0;
  let latestAt = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!BACKUP_ZIP_RE.test(f)) continue;
      let m = 0;
      try { m = fs.statSync(path.join(dir, f)).mtimeMs; } catch { continue; }
      if (m > base + 86400000) {
        count += 1;
        if (m > latestAt) latestAt = m;
      }
    }
  } catch { /* 目录不可读时放弃检测 */ }
  return { suspected: count > 0, count, latestAt: count > 0 ? latestAt : null };
}

// C-14：同 rotateSafetyBackups——protect 排除本轮刚生成的文件，keepOthers 保证保留总数仍为 keep
function rotateAutoBackups(dir, keep, protect = new Set()) {
  const autos = listByMtimeAsc(dir, AUTO_RE).filter((f) => !protect.has(f));
  const keepOthers = Math.max(0, keep - protect.size);
  for (const f of autos.slice(0, Math.max(0, autos.length - keepOthers))) {
    try {
      fs.rmSync(path.join(dir, f), { force: true });
    } catch { /* 单个删除失败不影响其余 */ }
    removeSidecar(dir, f); // D117：zip 被轮转掉，它的列表 sidecar 一并清（漏删也只是无害孤儿）
  }
}

// 从备份 zip 恢复：校验 → 安全备份当前数据 → 解包到 staging + 写标记（重启时换入生效）
// C-12：全程流式——meta 与 library.db 确认只读中央目录；解包逐条目 pipe 落盘；解包前按
// 中央目录声明的总大小做磁盘空间预检。条目路径越界/绝对路径/反斜杠 → 整体中止（旧实现跳过）。
async function restoreBackup(file, opts = {}) {
  const p = resolvePaths(opts);
  if (!fs.existsSync(file)) return { ok: false, error: "备份文件不存在" };
  let meta;
  try {
    meta = await readZipBackupMeta(file);
  } catch {
    return { ok: false, error: "无法读取备份文件（不是有效的 zip）" };
  }
  if (!meta) return { ok: false, error: "这不是本软件生成的备份文件（缺少 backup-meta.json）" };
  if (meta.app !== APP_TAG || Number(meta.format) !== FORMAT) {
    return { ok: false, error: "备份格式不匹配（来自其他应用或版本格式）" };
  }
  let total = 0;
  let hasLibraryDb = false;
  try {
    const zip = await openZip(file);
    try {
      await forEachEntry(zip, async (entry) => {
        if (entry.fileName === "library.db") hasLibraryDb = true;
        total += Number(entry.uncompressedSize) || 0;
        return true;
      });
    } finally { try { zip.close(); } catch { /* 已关闭 */ } }
  } catch (e) {
    // yauzl 对 ../、绝对路径条目直接报 invalid relative path——同样是整体中止，消息带上原因
    return { ok: false, error: `无法读取备份文件（不是有效的 zip）：${e instanceof Error ? e.message : String(e)}` };
  }
  if (!hasLibraryDb) return { ok: false, error: "备份不完整：缺少 library.db" };

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

  // 解包到 staging（运行中的主进程仍持有 better-sqlite3 连接，绝不在运行期直接改写 library.db）
  try {
    fs.rmSync(p.stagingDir, { recursive: true, force: true });
    fs.mkdirSync(p.stagingDir, { recursive: true });
    // C-12：解包前磁盘空间检查（按中央目录声明的解压后总大小估算，1.1 倍 + 200MB 余量）
    try {
      const st = fs.statfsSync(path.dirname(p.stagingDir));
      const need = total * 1.1 + 200 * 1024 * 1024;
      if (st.bavail * st.bsize < need) {
        try { fs.rmSync(p.stagingDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
        return { ok: false, error: `磁盘空间不足，无法解包备份（需要约 ${(Math.ceil((need / 1024 ** 3) * 10) / 10).toFixed(1)} GB）` };
      }
    } catch { /* statfs 不可用则跳过预检，解包写盘失败照常报错 */ }
    // C-12：流式解包（zipRead.extractAll）；包内出现越界路径 = 文件被篡改，整体中止而非部分恢复
    await extractAll(file, p.stagingDir);
    // C-10：备份来自更新版本的 Nutation → 拒绝恢复（旧程序打开新库会静默破坏数据）
    const stagedDb = path.join(p.stagingDir, "library.db");
    try {
      const probe = new Database(stagedDb, { readonly: true, fileMustExist: true });
      let uv = 0;
      try { uv = Number(probe.pragma("user_version", { simple: true })) || 0; } finally { probe.close(); }
      for (const sidecar of ["-wal", "-shm"]) {
        try { fs.rmSync(stagedDb + sidecar, { force: true }); } catch { /* 忽略 */ }
      }
      if (uv > schema.SCHEMA_VERSION) {
        try { fs.rmSync(p.stagingDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
        return { ok: false, error: "该备份来自更新版本的 Nutation，请先升级程序再恢复" };
      }
    } catch (e) {
      try { fs.rmSync(p.stagingDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
      return { ok: false, error: `备份中的 library.db 无法读取：${e instanceof Error ? e.message : String(e)}` };
    }
    fs.writeFileSync(p.markerFile, JSON.stringify({ stagedAt: Date.now(), source: String(file), meta }, null, 2));
  } catch (err) {
    try { fs.rmSync(p.stagingDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
    return { ok: false, error: `解包备份失败：${err instanceof Error ? err.message : String(err)}` };
  }
  return { ok: true, needsRestart: true, meta, safetyFile };
}

// 启动时（initDb 之前）检查标记：把 staging 换入数据目录。返回 false=无待恢复
// C-13：设备相关设置不随恢复覆盖——settings.json 随备份整体换入时，会把另一台机器 /
// 另一时期的设备相关值带进来。换入前先读线上 settings，换入后把设备键写回（线上没设过的键
// 也一并删掉，不让备份机残留值泄漏）。
// C-38d（审计）：设备键清单迁移到 electron/settingsLayers.js（设置分层唯一真源，含 layerOf 与
// DEVICE_FILES）——本模块只消费 DEVICE_KEYS；app.globalShortcuts.autoLaunch（开机自启，
// quickCapture.js）仍由下方嵌套特判保留（它是嵌套对象键，不在 DEVICE_KEYS 平铺清单里）；
// 「窗口位置/尺寸」无持久化键。
const { DEVICE_KEYS } = require("./settingsLayers");

function writeSettingsJsonAtomic(file, value) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8");
  fs.renameSync(tmp, file);
}

function preserveDeviceSettings(p, liveApp) {
  if (!liveApp || typeof liveApp !== "object") liveApp = {};
  let merged;
  try { merged = JSON.parse(fs.readFileSync(p.settingsFile, "utf-8")) || {}; } catch { return; }
  if (!merged || typeof merged !== "object" || Array.isArray(merged)) return;
  merged.app = merged.app && typeof merged.app === "object" ? merged.app : {};
  for (const k of DEVICE_KEYS) {
    if (k in liveApp) merged.app[k] = liveApp[k];
    else delete merged.app[k];
  }
  if (liveApp.globalShortcuts && typeof liveApp.globalShortcuts === "object") {
    merged.app.globalShortcuts = merged.app.globalShortcuts && typeof merged.app.globalShortcuts === "object" ? merged.app.globalShortcuts : {};
    if ("autoLaunch" in liveApp.globalShortcuts) merged.app.globalShortcuts.autoLaunch = liveApp.globalShortcuts.autoLaunch;
    else delete merged.app.globalShortcuts.autoLaunch;
  }
  try { writeSettingsJsonAtomic(p.settingsFile, merged); } catch { /* 尽力：写失败保留换入结果 */ }
}

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
      clearDbSidecars(p.dbFile); // D137：陈旧 WAL sidecar 与新换入库文件错配 = 损坏，必须同删
      restored.push("library.db");
      // C-13：learner.db 是派生可重建数据、不进备份清单（§4.20）。换库后靠 learnerRefresh 的
      // 「水位超前则清零重算」启发式纠正并不可靠（恢复后先产生新阅读事件 / 时钟回拨即失守），
      // 这里直接让位 → 启动时 learner.db 不存在即新建并由刷新管线全量重建，恒与新库一致。
      // .pre-restore 只保留一份：先删旧残留在让位。
      const learnerFile = path.join(p.dataDir, "learner.db");
      for (const suf of ["", "-wal", "-shm"]) {
        const f = learnerFile + suf;
        if (fs.existsSync(f)) {
          try { fs.rmSync(f + ".pre-restore", { force: true }); } catch { /* 尽力 */ }
          try { fs.renameSync(f, f + ".pre-restore"); } catch { /* 尽力 */ }
        }
      }
      restored.push("learner.db(reset)");
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
      clearDbSidecars(p.dictDbFile); // D137：同 library.db
      restored.push("dictionary.db");
    }
    // D248（T13）：行为库换入 / 旧备份缺失时隔离现有库（不得把旧主库与新行为库混用）
    const stagedBehavior = path.join(p.stagingDir, "behavior.db");
    const liveBehavior = p.behaviorDbFile;
    if (fs.existsSync(stagedBehavior)) {
      if (!isIntactSqliteFile(stagedBehavior)) throw new Error("备份包里的 behavior.db 不是完整可读的 SQLite 文件；已中止恢复");
      let floor = 0;
      try { floor = Number((JSON.parse(fs.readFileSync(p.behaviorPolicyFile, "utf8")) || {}).analysisFloorTs) || 0; } catch { floor = 0; }
      const snapAt = Number(marker?.meta?.behavior?.snapshotAt) || 0;
      if (floor > 0 && snapAt > 0 && snapAt < floor) {
        // 备份早于用户清除边界：不还原行为库（staged 副本隔离留档）
        try { fs.renameSync(stagedBehavior, `${liveBehavior}.pre-restore-${Date.now()}.db`); } catch { /* 尽力 */ }
        restored.push("behavior.db(skipped-floor)");
      } else {
        const a = swapIn(stagedBehavior, liveBehavior);
        if (a) asides.push({ live: liveBehavior, aside: a });
        clearDbSidecars(liveBehavior);
        try {
          const Database = require("better-sqlite3");
          const c = new Database(liveBehavior);
          c.prepare("INSERT INTO bdi_meta (key, value) VALUES ('restore_pending_refresh', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
          c.close();
        } catch { /* 标记失败不阻止恢复，派生层仍按 30 分钟增量 */ }
        restored.push("behavior.db");
      }
    } else if (fs.existsSync(liveBehavior)) {
      // 旧备份没有 BDI：隔离现有行为库，起新 dataEpoch；不把旧行为数据与恢复后的旧主库混用
      try { fs.renameSync(liveBehavior, `${liveBehavior}.pre-restore-${Date.now()}.db`); } catch { /* 尽力 */ }
      clearDbSidecars(liveBehavior);
      try {
        const pol = JSON.parse(fs.readFileSync(p.behaviorPolicyFile, "utf8"));
        pol.dataEpoch = require("./behavior/uuid7").uuid7();
        fs.writeFileSync(p.behaviorPolicyFile, JSON.stringify(pol, null, 2) + "\n");
      } catch { /* 策略不可读时下次 ensurePolicy 重建 */ }
      restored.push("behavior.db(isolated)");
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
      // C-13：设备相关键以线上为准——必须在换入**前**读线上值，换入后再写回
      let liveAppBefore = null;
      try { liveAppBefore = (JSON.parse(fs.readFileSync(p.settingsFile, "utf-8")) || {}).app || null; } catch { /* 无线上 settings */ }
      fs.copyFileSync(stagedSettings, p.settingsFile);
      preserveDeviceSettings(p, liveAppBefore); // C-13：设备相关键不随备份覆盖
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
  sweepBackupOrphans,
  getBackupDir,
  getDataInfo,
  readBackupMeta,
  clockSkewInfo
};
