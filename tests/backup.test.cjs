// M2 备份与恢复核心单元测试（无 Electron app，显式路径注入）
// 运行：ELECTRON_RUN_AS_NODE=1 npx electron tests/backup.test.cjs（D137 §3.9 通道，仓库常驻 electron-ABI 二进制）
// D137（v48.92）：夹具修复——D-TEST-85 的换入完整性校验（isIntactSqliteFile）要求真实 SQLite 字节，
// 旧夹具的 "SQLITE-FAKE-*" 文本字节在 HEAD 上即已触发「不是完整可读的 SQLite 文件」中止（既有红）。
// 改用 better-sqlite3 生成最小真库（fixture_meta.tag 承担内容断言），断言数量与强度不变。
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const backup = require("../electron/backup");

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 200)}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bktest-"));
const DATA = path.join(tmp, "data");
const BAK = path.join(tmp, "backups");
const P = {
  dataDir: DATA,
  dbFile: path.join(DATA, "library.db"),
  settingsFile: path.join(DATA, "settings.json"),
  aiConfigFile: path.join(DATA, "ai-config.json"),
  assetsDir: path.join(DATA, "assets"),
  stagingDir: path.join(DATA, "restore-staging"),
  markerFile: path.join(DATA, "restore-pending.json")
};

// 真实 SQLite 夹具：fixture_meta.tag = tag（恢复回环的内容断言依据）
function realSqliteBytes(tag) {
  const f = path.join(tmp, `fixture-${tag}.db`);
  try { fs.rmSync(f, { force: true }); } catch { /* 尽力 */ }
  const d = new Database(f);
  d.exec("CREATE TABLE IF NOT EXISTS fixture_meta (tag TEXT NOT NULL)");
  d.prepare("DELETE FROM fixture_meta").run();
  d.prepare("INSERT INTO fixture_meta (tag) VALUES (?)").run(tag);
  d.close();
  return fs.readFileSync(f);
}
const readFixtureTag = (file) => {
  try {
    const d = new Database(file, { readonly: true });
    const row = d.prepare("SELECT tag FROM fixture_meta").get();
    d.close();
    return row ? row.tag : null;
  } catch {
    return `非 SQLite 文件:${fs.readFileSync(file).length}B`;
  }
};

function seedData(tag) {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(path.join(P.assetsDir, "item-1"), { recursive: true });
  fs.writeFileSync(P.dbFile, realSqliteBytes(tag));
  fs.writeFileSync(P.settingsFile, JSON.stringify({ app: { theme: "dark", tag }, theme: {} }));
  fs.writeFileSync(P.aiConfigFile, JSON.stringify({ keys: { goat: "SECRET" } }));
  fs.writeFileSync(path.join(P.assetsDir, "item-1", "img.png"), Buffer.from([0x89, 0x50, tag.charCodeAt(0), 0x0d, 0x0a]));
  fs.writeFileSync(path.join(P.assetsDir, "item-1", "original.epub"), Buffer.from("PK-FAKE-EPUB-" + tag));
}

// C-23 夹具：多页真库 + 中部整页写坏（页头损坏 → quick_check 必报 btreeInitPage 错；
// 只坏 payload 字节可能结构完好而漏检，整页覆盖才是确定性损坏）
function corruptSqliteBytes() {
  const f = path.join(tmp, "fixture-corrupt.db");
  try { fs.rmSync(f, { force: true }); } catch { /* 尽力 */ }
  const d = new Database(f);
  d.exec("CREATE TABLE payload (id INTEGER PRIMARY KEY, v TEXT)");
  const ins = d.prepare("INSERT INTO payload(v) VALUES (?)");
  d.transaction(() => { for (let i = 0; i < 3000; i++) ins.run("x".repeat(200) + i); })();
  d.close();
  const buf = fs.readFileSync(f);
  const mid = Math.floor(buf.length / 2);
  for (let i = mid; i < mid + 2 * 4096 && i < buf.length; i++) buf[i] = (buf[i] * 7 + 0x5a) & 0xff;
  return buf;
}

const counts = { items: 3, cards: 42, extracts: 7, assets: 2 };
const opts = () => ({ ...P, backupDir: BAK, counts, appVersion: "0.0.1" });

(async () => {
  console.log("== 1) 手动备份：默认不含 ai-config ==");
  seedData("A");
  let r = await backup.createBackup({ ...opts(), label: "manual", flush: () => {} });
  check("备份成功", r.ok === true, JSON.stringify(r));
  check("文件名带 manual 标签", /backup-manual-\d{8}-\d{6}\.zip$/.test(r.file || ""), r.file);
  check("无 .part 残留", !fs.existsSync(r.file + ".part"), r.file + ".part");
  let list = await backup.listBackups({ ...opts() });
  check("列表 1 条且有效", list.backups.length === 1 && list.backups[0].valid, JSON.stringify(list.backups));
  check("meta 记录 counts", list.backups[0].counts?.cards === 42, JSON.stringify(list.backups[0].counts));
  check("列表标记不含 Key", list.backups[0].includesAIConfig === false, list.backups[0].includesAIConfig);

  console.log("== 2) 勾选 Key 的备份 ==");
  r = await backup.createBackup({ ...opts(), label: "manual", includeAIConfig: true });
  check("备份成功", r.ok === true, JSON.stringify(r));
  list = await backup.listBackups({ ...opts() });
  const withKey = list.backups.find((b) => b.includesAIConfig);
  check("列表标记含 Key", !!withKey, JSON.stringify(list.backups.map((b) => b.includesAIConfig)));
  check("共 2 条备份且按时间倒序", list.backups.length === 2 && list.backups[0].createdAt >= list.backups[1].createdAt, list.backups.length);

  console.log("== 3) 恢复回环：改数据 → 恢复 → 标记 → 重启换入 ==");
  // 破坏当前数据：改库内容、删资产、改设置
  fs.writeFileSync(P.dbFile, Buffer.from("SQLITE-FAKE-DESTROYED", "utf-8"));
  fs.rmSync(path.join(P.assetsDir, "item-1", "img.png"), { force: true });
  fs.writeFileSync(P.settingsFile, JSON.stringify({ app: { theme: "light" }, theme: {} }));
  const earliestBackup = list.backups[list.backups.length - 1].path; // 第 1 次备份（不含 Key）
  r = await backup.restoreBackup(earliestBackup, { ...opts(), flush: () => {} });
  check("恢复请求成功且需重启", r.ok === true && r.needsRestart === true, JSON.stringify(r));
  check("安全备份已创建（含 Key）", /backup-safety-/.test(r.safetyFile || ""), r.safetyFile);
  check("staging 已解包 library.db", fs.existsSync(path.join(P.stagingDir, "library.db")), P.stagingDir);
  check("staging 已解包 assets", fs.existsSync(path.join(P.stagingDir, "assets", "item-1", "img.png")), "assets/img.png");
  check("标记文件已写入", fs.existsSync(P.markerFile), P.markerFile);
  check("运行期 library.db 未被直接改动（sql.js 约束）", fs.readFileSync(P.dbFile, "utf-8").includes("DESTROYED"), "db unchanged");
  const applied = backup.applyPendingRestore({ ...P });
  check("applyPendingRestore 返回换入清单", Array.isArray(applied?.restored) && applied.restored.includes("library.db"), JSON.stringify(applied));
  check("换入后库内容恢复为备份版本", readFixtureTag(P.dbFile) === "A", readFixtureTag(P.dbFile));
  check("恢复换入后目标目录无 -wal/-shm 残留（D137 sidecar 清理）", !fs.existsSync(P.dbFile + "-wal") && !fs.existsSync(P.dbFile + "-shm"), {
    wal: fs.existsSync(P.dbFile + "-wal"),
    shm: fs.existsSync(P.dbFile + "-shm")
  });
  check("资产文件已恢复", fs.existsSync(path.join(P.assetsDir, "item-1", "img.png")), "img.png");
  check("settings.json 已恢复", JSON.parse(fs.readFileSync(P.settingsFile, "utf-8")).app.tag === "A", fs.readFileSync(P.settingsFile, "utf-8"));
  check("staging 与标记已清理", !fs.existsSync(P.stagingDir) && !fs.existsSync(P.markerFile), "cleanup");
  check("备份 zip 本身的 ai-config 未换入（该备份不含 Key）", JSON.parse(fs.readFileSync(P.aiConfigFile, "utf-8")).keys.goat === "SECRET", "ai-config untouched");

  console.log("== 4) 恢复保护：拒绝非本软件 zip ==");
  const badZip = path.join(BAK, "not-a-backup.zip");
  const JSZip = require("jszip");
  const z = new JSZip();
  z.file("random.txt", "hello");
  fs.writeFileSync(badZip, await z.generateAsync({ type: "nodebuffer" }));
  r = await backup.restoreBackup(badZip, { ...opts(), skipSafety: true });
  check("拒绝缺 backup-meta.json 的 zip", r.ok === false && /不是本软件/.test(r.error || ""), JSON.stringify(r));
  r = await backup.restoreBackup(path.join(BAK, "missing.zip"), { ...opts(), skipSafety: true });
  check("拒绝不存在的文件", r.ok === false && /不存在/.test(r.error || ""), JSON.stringify(r));
  // C-12：路径穿越条目从「跳过」改为「整体中止」——包里出现越界路径说明文件被篡改，不应部分恢复
  const evil = new JSZip();
  evil.file("backup-meta.json", JSON.stringify({ app: "incremental-reading-dev", format: 1 }));
  evil.file("library.db", realSqliteBytes("EVIL"));
  evil.file("../escape.txt", Buffer.from("EVIL"));
  const evilZip = path.join(BAK, "evil.zip");
  fs.writeFileSync(evilZip, await evil.generateAsync({ type: "nodebuffer" }));
  r = await backup.restoreBackup(evilZip, { ...opts(), skipSafety: true });
  // yauzl 在条目读取阶段即拒绝 ../ 条目（invalid relative path）→ 走「无法读取备份文件」分支；
  // extractAll 自检的「越界」是第二道防线（面向 yauzl 放行但 path 解析越界的名字）。两者都是整体中止。
  check("路径穿越 zip 整体中止恢复（C-12：不再跳过穿越条目）", r.ok === false && /越界|无效|非法|无法读取/.test(r.error || ""), JSON.stringify(r));
  const appliedEvil = backup.applyPendingRestore({ ...P });
  check("中止后无标记、未换入任何东西", appliedEvil === false, JSON.stringify(appliedEvil));
  check("穿越文件未落在数据目录外", !fs.existsSync(path.join(tmp, "escape.txt")), path.join(tmp, "escape.txt"));
  check("中止即整体不换入（library.db 保持原样）", readFixtureTag(P.dbFile) === "A", readFixtureTag(P.dbFile));

  console.log("== 5) 自动备份：每日一次 + 保留份数轮换 ==");
  fs.rmSync(BAK, { recursive: true, force: true });
  seedData("B");
  const settingsKeep2 = { app: { autoBackupEnabled: true, autoBackupKeep: 2 } };
  const optsAuto = () => ({ ...P, backupDir: BAK, counts, settingsFile: path.join(DATA, "settings.json") });
  fs.writeFileSync(P.settingsFile, JSON.stringify(settingsKeep2));
  const days = [0, 1, 2, 3, 4].map((i) => new Date(Date.now() - i * 86400000));
  let last;
  // 按时间升序（最旧→今天）逐日启动：与真实时序一致——mtime 轮换才保留「最新两天」（今天在列），
  // 今天的 zip 在场后，「同日第二次启动」才走 already-today 短路（D-TEST-35 按 mtime 轮换的口径）。
  for (const d of [...days].reverse()) last = await backup.autoBackupIfNeeded({ ...optsAuto(), now: d, flush: () => {} });
  check("第 5 天（最早）备份成功", last?.ok === true && !last.skipped, JSON.stringify(last));
  check("同日第二次启动跳过", (await backup.autoBackupIfNeeded({ ...optsAuto(), now: days[0], flush: () => {} })).skipped === "already-today", "skip");
  let autos = fs.readdirSync(BAK).filter((f) => f.startsWith("backup-auto-"));
  check("轮换后仅保留 2 份", autos.length === 2, JSON.stringify(autos));
  check("保留的是最新两天", autos.includes(`backup-auto-2026-${String(days[0].getMonth() + 1).padStart(2, "0")}-${String(days[0].getDate()).padStart(2, "0")}.zip`), JSON.stringify(autos));
  fs.writeFileSync(P.settingsFile, JSON.stringify({ app: { autoBackupEnabled: false } }));
  check("关闭自动备份后不再执行", (await backup.autoBackupIfNeeded({ ...optsAuto(), now: new Date(), flush: () => {} })).skipped === "disabled", "disabled");
  fs.writeFileSync(P.settingsFile, JSON.stringify(settingsKeep2));

  console.log("== 6) 备份位置设置（backupDir 缺省解析） ==");
  fs.rmSync(BAK, { recursive: true, force: true });
  fs.writeFileSync(P.settingsFile, JSON.stringify({ app: { backupDir: BAK } }));
  const dir = backup.getBackupDir({ ...P });
  check("读取 settings.app.backupDir", dir === BAK, dir);
  r = await backup.createBackup({ ...P, label: "manual", flush: () => {} });
  check("缺省备份位置生效", r.ok === true && r.file.startsWith(BAK), r.file);

  console.log("== 7) 中断残留清扫（D143 复审 M3）：旧 .snapshot-* 与非今日 .part 回收、当日 .part 保留 ==");
  const snapOld = path.join(BAK, ".snapshot-orphan");
  fs.mkdirSync(snapOld, { recursive: true });
  fs.writeFileSync(path.join(snapOld, "dictionary.db"), "SNAP-ORPHAN");
  const threeDaysAgo = new Date(Date.now() - 3 * 86400000);
  fs.utimesSync(snapOld, threeDaysAgo, threeDaysAgo); // 非今日 mtime（mkdtemp 名无日期，mtime 是唯一「今日」判据）
  const dayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const partOld = path.join(BAK, `backup-auto-${dayStr(threeDaysAgo)}.zip.part`);
  fs.writeFileSync(partOld, "PART-OLD");
  const partToday = path.join(BAK, `backup-auto-${dayStr(new Date())}.zip.part`);
  fs.writeFileSync(partToday, "PART-TODAY");
  const swept = backup.sweepBackupOrphans({ ...opts() });
  check("旧 .snapshot-* 与非今日 .part 被清扫（中断残留孤儿回收）", !fs.existsSync(snapOld) && !fs.existsSync(partOld), JSON.stringify(swept));
  check("当日 .part 不误删（可能是在途构建）", fs.existsSync(partToday), JSON.stringify({ kept: fs.existsSync(partToday), swept }));

  console.log("== 8) C-14：时钟回拨——rotate protect 保护刚创建的备份 ==");
  fs.rmSync(BAK, { recursive: true, force: true });
  fs.mkdirSync(BAK, { recursive: true });
  seedData("C");
  fs.writeFileSync(P.settingsFile, JSON.stringify({ app: { autoBackupEnabled: true, autoBackupKeep: 3 } }));
  // 造 3 个自动备份，mtime 全部拨到「当前时间 + 2 天」：模拟备份先建在"未来"、系统时钟再被拨回。
  // 回拨后新备份的 mtime（= 现在）比这 3 份都小 → 旧实现按 mtime 升序会把它当"最旧"立刻删掉。
  const future = new Date(Date.now() + 2 * 86400000);
  for (let i = 1; i <= 3; i++) {
    const f = path.join(BAK, `backup-auto-2026-01-0${i}.zip`);
    fs.writeFileSync(f, realSqliteBytes(`ROT${i}`));
    fs.utimesSync(f, future, future);
  }
  r = await backup.autoBackupIfNeeded({ ...optsAuto(), now: new Date(), flush: () => {} });
  const c14New = r.file ? path.basename(r.file) : null;
  check("时钟回拨后新备份生成成功", r.ok === true && !r.skipped && !!c14New, JSON.stringify(r));
  check("返回 clockSkewSuspected（目录里有未来 mtime 的自动备份）", r.clockSkewSuspected === true, r.clockSkewSuspected);
  let autosC14 = fs.readdirSync(BAK).filter((f) => f.startsWith("backup-auto-"));
  check("新备份未被轮换删除（C-14 protect）", autosC14.includes(c14New), JSON.stringify(autosC14));
  check("保留总数 = keep（3）", autosC14.length === 3, JSON.stringify(autosC14));
  check("被删的是 3 份未来 mtime 旧档中的一份", autosC14.filter((f) => f.startsWith("backup-auto-2026-01-")).length === 2, JSON.stringify(autosC14));
  const skipR = await backup.autoBackupIfNeeded({ ...optsAuto(), now: new Date(), flush: () => {} });
  check("同日再启动跳过且带出 clockSkewSuspected", skipR.skipped === "already-today" && skipR.clockSkewSuspected === true, JSON.stringify(skipR));
  // 差分：不带 protect 的旧行为会把刚生成的备份当"最旧"删掉——证明本用例确实覆盖了缺陷。
  // 补回第 3 份旧档（前面 protect 轮换已删掉一份），恢复到「3 旧 + 1 新、keep=3」的缺陷现场。
  fs.writeFileSync(path.join(BAK, "backup-auto-2026-01-04.zip"), realSqliteBytes("ROT4"));
  fs.utimesSync(path.join(BAK, "backup-auto-2026-01-04.zip"), future, future);
  backup.rotateAutoBackups(BAK, 3);
  check("差分：无 protect 时新备份会被当最旧删除（复现缺陷）", !fs.existsSync(path.join(BAK, c14New)), c14New);
  // safety 分支同策略：新档 mtime=当前（时钟已回拨），两份旧档 mtime 在"未来"（回拨前所建）
  const sfNew = path.join(BAK, "backup-safety-20990101-000001.zip");
  fs.writeFileSync(sfNew, "SAFETY-PROTECT");
  const sfOld1 = path.join(BAK, "backup-safety-20990101-000002.zip");
  const sfOld2 = path.join(BAK, "backup-safety-20990101-000003.zip");
  fs.writeFileSync(sfOld1, "SAFETY-OLD1");
  fs.writeFileSync(sfOld2, "SAFETY-OLD2");
  for (const f of [sfOld1, sfOld2]) fs.utimesSync(f, future, future);
  backup.rotateSafetyBackups(BAK, 2, new Set([path.basename(sfNew)]));
  check("safety：protect 保护刚生成的新档、清掉最旧的旧档", fs.existsSync(sfNew) && !fs.existsSync(sfOld1), JSON.stringify({ sfNew: fs.existsSync(sfNew), sfOld1: fs.existsSync(sfOld1), sfOld2: fs.existsSync(sfOld2) }));
  backup.rotateSafetyBackups(BAK, 1);
  check("safety 差分：无 protect 时同样会删掉刚生成的新档（复现缺陷）", !fs.existsSync(sfNew), sfNew);

  console.log("== 8b) D235：clockSkewInfo 现场探测（设置页通知框经 backup:info 每次现取） ==");
  {
    const SK = path.join(tmp, "skew-probe");
    fs.mkdirSync(SK, { recursive: true });
    const fut = (d) => new Date(Date.now() + d * 86400000);
    const touch = (name, when) => { const f = path.join(SK, name); fs.writeFileSync(f, "x"); fs.utimesSync(f, when, when); };
    let ci = backup.clockSkewInfo({ backupDir: SK });
    check("空目录 → 不判定", ci.suspected === false && ci.count === 0 && ci.latestAt === null, JSON.stringify(ci));
    touch("backup-auto-2026-01-01.zip", new Date());
    touch("backup-manual-20260101-000000.zip", fut(0.5)); // 1 天内小漂移不算
    ci = backup.clockSkewInfo({ backupDir: SK });
    check("只有当前 / 1 天内的备份 → 不判定", ci.suspected === false && ci.count === 0, JSON.stringify(ci));
    touch("backup-auto-2026-01-02.zip", fut(3));
    touch("backup-manual-20260102-000000.zip", fut(5));
    touch("backup-safety-20260102-000000.zip", fut(2));
    touch("notes-2099.zip", fut(9)); // 非本软件备份文件名不计
    ci = backup.clockSkewInfo({ backupDir: SK });
    check("auto / manual / safety 建于未来均计数（3 份），非备份文件不计", ci.suspected === true && ci.count === 3, JSON.stringify(ci));
    check("latestAt = 最晚一份的修改时间（≈ 当前 + 5 天）", Math.abs(ci.latestAt - fut(5).getTime()) < 2000, JSON.stringify(ci));
    ci = backup.clockSkewInfo({ backupDir: SK, now: fut(10) });
    check("注入 now（时间走到未来备份之后）→ 现场消除，不再判定", ci.suspected === false && ci.count === 0, JSON.stringify(ci));
    ci = backup.clockSkewInfo({ backupDir: path.join(tmp, "no-such-dir") });
    check("目录不存在 / 不可读 → 不判定且不抛", ci.suspected === false && ci.count === 0, JSON.stringify(ci));
    check("C-14 detectClockSkew 返回口径不变（只看 auto）", r.clockSkewSuspected === true, r.clockSkewSuspected);
    fs.rmSync(SK, { recursive: true, force: true });
  }

  console.log("== 9) C-23：启动 quick_check 移除；快照完整性检查参与备份轮换决策 ==");
  // 9a 静态守卫：启动路径不再执行 quick_check——应用日志里 [db]/[learnerDb] quick_check 行的唯一来源就是这两处
  const dbjsSrc = fs.readFileSync(path.join(__dirname, "..", "electron", "db.js"), "utf8");
  const learnerSrc = fs.readFileSync(path.join(__dirname, "..", "electron", "learnerDb.js"), "utf8");
  check("db.js 无 quick_check pragma（D143 裁决推广到主库，检查移到备份 worker）", !/pragma\(\s*["']quick_check["']/.test(dbjsSrc), "db.js 仍含 quick_check 调用");
  check("learnerDb.js 无 quick_check pragma（派生可重建库不检查）", !/pragma\(\s*["']quick_check["']/.test(learnerSrc), "learnerDb.js 仍含 quick_check 调用");

  // 9b 快照注入：正常库 → integrity[library.db] === "ok"；未注入快照 → 不检查在线文件
  fs.rmSync(BAK, { recursive: true, force: true });
  fs.mkdirSync(BAK, { recursive: true });
  seedData("D");
  const snapLib = async (dest) => { fs.copyFileSync(P.dbFile, dest); };
  r = await backup.createBackup({ ...opts(), label: "manual", flush: () => {} });
  check("未注入快照时不检查在线主库文件", r.ok === true && r.integrity["library.db"] === undefined, JSON.stringify(r.integrity));
  r = await backup.createBackup({ ...opts(), label: "manual", flush: () => {}, snapshotLibrary: snapLib });
  check("快照注入后备份成功", r.ok === true, JSON.stringify(r));
  check("正常库快照 integrity[library.db] === ok", r.integrity["library.db"] === "ok", JSON.stringify(r.integrity));

  // 9c 坏库快照（中部整页写坏）→ 备份本体照常成功，但轮换暂停、旧备份数量不变
  fs.rmSync(BAK, { recursive: true, force: true });
  fs.mkdirSync(BAK, { recursive: true });
  fs.writeFileSync(P.settingsFile, JSON.stringify({ app: { autoBackupEnabled: true, autoBackupKeep: 2 } }));
  const past = new Date(Date.now() - 5 * 86400000);
  const oldA = path.join(BAK, "backup-auto-2026-03-01.zip");
  const oldB = path.join(BAK, "backup-auto-2026-03-02.zip");
  for (const f of [oldA, oldB]) { fs.writeFileSync(f, realSqliteBytes("OLD")); fs.utimesSync(f, past, past); }
  fs.writeFileSync(P.dbFile, corruptSqliteBytes()); // 快照函数原样复制坏字节 → worker 只读 quick_check 报损坏页
  r = await backup.autoBackupIfNeeded({ ...optsAuto(), now: new Date(), flush: () => {}, snapshotLibrary: snapLib });
  check("坏库自动备份本体仍成功", r.ok === true && !r.skipped, JSON.stringify(r.ok === true ? { ok: r.ok, integrityWarning: r.integrityWarning } : r));
  check("坏库返回 integrityWarning（已暂停删除旧备份）", typeof r.integrityWarning === "string" && r.integrityWarning.includes("已暂停删除旧备份"), JSON.stringify(r.integrityWarning));
  check("坏库 integrity[library.db] !== ok", typeof r.integrity["library.db"] === "string" && r.integrity["library.db"] !== "ok", JSON.stringify(r.integrity));
  check("旧备份数量不变（轮换未执行，两份旧档都在）", fs.existsSync(oldA) && fs.existsSync(oldB) && fs.readdirSync(BAK).filter((f) => f.startsWith("backup-auto-")).length === 3, JSON.stringify(fs.readdirSync(BAK).filter((f) => f.startsWith("backup-auto-"))));

  // 9d 库修复后：次日自动备份恢复轮换（暂停只在完整性不通过时发生）
  seedData("E");
  fs.writeFileSync(P.settingsFile, JSON.stringify({ app: { autoBackupEnabled: true, autoBackupKeep: 2 } }));
  const tomorrow = new Date(Date.now() + 86400000);
  r = await backup.autoBackupIfNeeded({ ...optsAuto(), now: tomorrow, flush: () => {}, snapshotLibrary: snapLib });
  check("修复后备份成功且无 integrityWarning", r.ok === true && !r.integrityWarning && r.integrity["library.db"] === "ok", JSON.stringify({ ok: r.ok, w: r.integrityWarning, i: r.integrity }));
  check("轮换恢复执行（总数回到 keep=2）", fs.readdirSync(BAK).filter((f) => f.startsWith("backup-auto-")).length === 2, JSON.stringify(fs.readdirSync(BAK).filter((f) => f.startsWith("backup-auto-"))));

  // 清理临时目录
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nM2 备份单元测试：${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((err) => {
  console.error("测试异常：", err);
  process.exit(1);
});
