// F51 备份归档的 ZIP 规范合规（用独立写的字节级解读者，不用 jszip 自读自）
// @runtime: electron  @tier: 2  @gui: false  @id: F51  @timeout: 300
// 运行：npx electron tests/flows/f51-zip-conformance.cjs
//
// 角度：既有 F05 验「备份里有哪些成员、恢复后表对不对」，F39 验「路径敌意」。
//       没有一条验**归档本身是否符合 ZIP 规范**：文件名的 UTF-8 标志位、DOS 时间字段范围、
//       CRC-32 完整性、条目名形状。这恰恰是「换一台电脑/换一个解压工具就读不出来」的那一层。
//       取证手法：自己按规范走 EOCD → 中央目录 → 本地头 → inflateRaw，绝不复用写它的那个库。
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { app } = require("electron");
const { Flow, runFlow, ROOT, tmpUserDataDir, freshDir } = require("./lib/harness.cjs");

const flow = new Flow({
  id: "F51",
  title: "备份归档 ZIP 规范合规",
  angle: "归档字节层：UTF-8 标志位 / DOS 时间范围 / CRC-32 / 条目名形状（独立解读者）",
  cites: ["§7.2", "§9.1 M2", "§7.1.4"],
  tier: 2,
  gui: false,
});

const HOSTILE = [
  "中文书名 第三章.png",
  "emoji \u{1F4CE} 选区.png",
  "trailing dot.png.",
  "trailing space .png",
  "rtl ‮反向.png",
  "quote 'single.png",
  "amp&dollar$percent.png",
  "NFD-accent-café.png",
  "x".repeat(180) + ".png",
  "con.png",
  "COM1.png",
];
// 上面 11 个是 **NTFS 允许或半允许** 的敌意名；`"` `:` 与控制字符属于文件系统直接拒绝，
// 应用永远看不到它们，故不列入（第一版误列，导致本流程自己 ENOENT）。

// ---------- 独立 ZIP 解读者（规范字面实现） ----------
function findEOCD(buf) {
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      return { total: buf.readUInt16LE(i + 10), cdSize: buf.readUInt32LE(i + 12), cdOffset: buf.readUInt32LE(i + 16) };
    }
  }
  return null;
}

function readCentral(buf) {
  const eocd = findEOCD(buf);
  if (!eocd) return { error: "找不到 EOCD（End Of Central Directory）签名" };
  const entries = [];
  let p = eocd.cdOffset;
  for (let n = 0; n < eocd.total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return { error: `中央目录第 ${n} 项签名不对`, entries };
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const mTime = buf.readUInt16LE(p + 12);
    const mDate = buf.readUInt16LE(p + 14);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const rawName = buf.subarray(p + 46, p + 46 + nameLen);
    entries.push({ flags, method, mTime, mDate, crc, compSize, uncompSize, localOff, rawName, nameLen });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return { entries };
}

function readData(buf, e) {
  if (buf.readUInt32LE(e.localOff) !== 0x04034b50) return { error: "本地文件头签名不对" };
  const nameLen = buf.readUInt16LE(e.localOff + 26);
  const extraLen = buf.readUInt16LE(e.localOff + 28);
  const start = e.localOff + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + e.compSize);
  try {
    const out = e.method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw);
    return { bytes: out };
  } catch (err) {
    return { error: "inflateRaw 失败：" + String((err && err.message) || err) };
  }
}

function dosParts(e) {
  return {
    year: ((e.mDate >> 9) & 0x7f) + 1980,
    month: (e.mDate >> 5) & 0x0f,
    day: e.mDate & 0x1f,
    hour: (e.mTime >> 11) & 0x1f,
    min: (e.mTime >> 5) & 0x3f,
    sec: (e.mTime & 0x1f) * 2,
  };
}

const utf8Fatal = (b) => {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(b);
    return true;
  } catch {
    return false;
  }
};
const isAscii = (b) => b.every((x) => x < 0x80);

const crc32 =
  typeof zlib.crc32 === "function"
    ? (b) => zlib.crc32(b) >>> 0
    : (() => {
        const T = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
          let c = i;
          for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
          T[i] = c >>> 0;
        }
        return (b) => {
          let c = 0xffffffff;
          for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 0xff] ^ (c >>> 8);
          return (c ^ 0xffffffff) >>> 0;
        };
      })();

let assetMirror = "";
let seededNames = [];

function inspect(file, tag) {
  const buf = fs.readFileSync(file);
  const { entries, error } = readCentral(buf);
  flow.check(tag + "：中央目录可被独立解读者走完", !error && Array.isArray(entries) && entries.length > 0, "无错误", error || "条目 " + entries.length);
  if (!entries || !entries.length) return;
  const nonAsciiNoFlag = [];
  const badUtf8 = [];
  const crcBad = [];
  const byteMismatch = [];
  const shapes = [];
  const dirEntries = [];
  const badDirs = [];
  const names = new Map();
  for (const e of entries) {
    const name = e.rawName.toString("utf8");
    names.set(name, (names.get(name) || 0) + 1);
    if (!utf8Fatal(e.rawName)) badUtf8.push(name);
    if (!isAscii(e.rawName) && !(e.flags & 0x0800)) nonAsciiNoFlag.push(name);
    if (/\\/.test(name) || name.startsWith("/") || name.split("/").indexOf("..") >= 0) shapes.push(name);
    // JSZip 会为路径段自动补出「目录条目」；它们必须存在且为空，否则解压工具会造出幽灵文件
    if (name.endsWith("/")) {
      dirEntries.push(name);
      if (e.uncompSize !== 0 || e.compSize !== 0) badDirs.push(name + " 非空");
      continue;
    }
    const d = readData(buf, e);
    if (d.error) crcBad.push(name + ": " + d.error);
    else {
      if (crc32(d.bytes) !== (e.crc >>> 0)) crcBad.push(name + ": 存 " + (e.crc >>> 0) + " 实 " + crc32(d.bytes));
      if (name.startsWith("assets/")) {
        const src = path.join(assetMirror, name.slice(7));
        if (fs.existsSync(src) && !fs.readFileSync(src).equals(d.bytes)) byteMismatch.push(name);
      }
    }
  }
  const dupes = [...names.entries()].filter((kv) => kv[1] > 1).map((kv) => kv[0]);
  flow.record(tag + " 目录条目", dirEntries.length ? dirEntries.join(" ") : "无");
  flow.check(tag + "：自动补出的目录条目必须为空", badDirs.length === 0, "全空", badDirs.slice(0, 4));
  flow.check(tag + "：非 ASCII 条目名必须置 UTF-8 标志位（bit 11）", nonAsciiNoFlag.length === 0, "全部置位", nonAsciiNoFlag.slice(0, 4));
  flow.check(tag + "：条目名一律合法 UTF-8 字节", badUtf8.length === 0, "合法", badUtf8.slice(0, 4));
  flow.check(tag + "：CRC-32 与解压后字节逐条相符", crcBad.length === 0, "全符", crcBad.slice(0, 4));
  flow.check(tag + "：解出的字节与盘上源文件逐字节相同", byteMismatch.length === 0, "相同", byteMismatch.slice(0, 4));
  flow.check(tag + "：条目名形状无 反斜杠/绝对路径/.. 段", shapes.length === 0, "干净", shapes.slice(0, 4));
  flow.check(tag + "：条目名不重复", dupes.length === 0, "无重复", dupes.slice(0, 4));
  const parts = entries.map(dosParts);
  const badTime = parts.filter(
    (y) => y.year < 1980 || y.year > 2107 || y.month < 1 || y.month > 12 || y.day < 1 || y.day > 31 || y.hour > 23 || y.min > 59 || y.sec > 59
  );
  flow.record(tag + " 首个条目的 DOS 时间", JSON.stringify(parts[0] || null));
  flow.check(tag + "：DOS 时间字段全部在规范可表示范围内", badTime.length === 0, "范围内", badTime.slice(0, 3));
}

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f51"));
    app.setPath("userData", dir);
    const dbPath = path.join(ROOT, "electron", "db.js");
    delete require.cache[dbPath];
    const db = require(dbPath);
    await db.initDb();
    const bak = require(path.join(ROOT, "electron", "backup.js"));
    const backupDir = path.join(dir, "backups");

    await runFlow(flow, async () => {
      flow.section("S1 敌意文件名进 assets 后打包");
      const aroot = path.join(dir, "assets", "f51-item");
      fs.mkdirSync(aroot, { recursive: true });
      assetMirror = aroot;
      const osRefused = [];
      for (const n of HOSTILE) {
        try {
          fs.writeFileSync(path.join(aroot, n), Buffer.from("89504e470d0a1a0a" + Buffer.from(n).toString("hex"), "hex"));
        } catch (err) {
          osRefused.push(n + " ← " + String((err && err.code) || err));
        }
      }
      seededNames = fs.readdirSync(aroot);
      flow.record("NTFS 直接拒绝的敌意名", osRefused.length ? osRefused.join(" | ") : "无（11 个全接受）");
      flow.record("实际落盘名的长度序列", JSON.stringify(seededNames.map((s) => s.length)));
      flow.record("尾点/尾空格是否被 NTFS 剥掉", JSON.stringify(HOSTILE.filter((n) => seededNames.indexOf(n) < 0)));
      fs.mkdirSync(path.join(dir, "memory", "topics", "工作"), { recursive: true });
      fs.writeFileSync(path.join(dir, "memory", "core.md"), "# 核心记忆\n\n- F51 事实\n");
      db.createJournalEntry({ contentMarkdown: "F51 日记", source: "app" });
      db.persistNow();
      const created = await bak.createBackup({ label: "manual", backupDir, flush: () => db.persistNow() });
      flow.check("createBackup 成功", !!(created && created.ok === true && created.file), "ok+file", created);
      if (!created || !created.file) return;
      inspect(created.file, "S1 常规时刻");

      flow.section("S2 系统时钟病态时的打包（1970 / 2080 / 1979 下溢）");
      const clocks = [
        ["1970", new Date(0)],
        ["2080", new Date(Date.UTC(2080, 5, 6, 12, 0, 0))],
        ["1979 下溢", new Date(Date.UTC(1979, 11, 31))],
      ];
      for (const [tag, now] of clocks) {
        let r;
        try {
          r = await bak.createBackup({ label: "manual", backupDir, now, flush: () => {} });
        } catch (err) {
          r = { threw: String((err && err.message) || err) };
        }
        if (r && r.ok && r.file) {
          const buf = fs.readFileSync(r.file);
          const { entries } = readCentral(buf);
          const sample = entries && entries.length ? dosParts(entries[0]) : null;
          flow.record("now=" + tag + " 写出的时间字段", JSON.stringify({ 传入年份: now.getUTCFullYear(), 条目年份: sample && sample.year }));
          const bad = (entries || []).filter((e) => {
            const y = dosParts(e);
            return y.year < 1980 || y.year > 2107 || y.month < 1 || y.day < 1;
          });
          flow.check("now=" + tag + "：要么响亮拒绝，要么写出可表示的时间", bad.length === 0, "范围内或拒绝", { 越界条目: bad.length, 样本: sample });
        } else {
          flow.record("now=" + tag + " 的结果", JSON.stringify(r).slice(0, 140));
          flow.check("now=" + tag + "：拒绝必须带原因（不能是空对象/假成功）", !!(r && (r.error || r.threw)), "带原因的拒绝", r);
        }
      }

      flow.section("S3 恢复回环：恢复后文件名与字节逐条相同");
      const res = await bak.restoreBackup(created.file, { backupDir });
      flow.record("restoreBackup 返回", JSON.stringify(res).slice(0, 160));
      const applied = await bak.applyPendingRestore();
      flow.record("applyPendingRestore 返回", JSON.stringify(applied).slice(0, 160));
      const backRoot = path.join(app.getPath("userData"), "assets", "f51-item");
      const got = fs.existsSync(backRoot) ? fs.readdirSync(backRoot) : [];
      const missing = seededNames.filter((n) => got.indexOf(n) < 0);
      const extra = got.filter((n) => seededNames.indexOf(n) < 0);
      flow.record("恢复落点", backRoot.replace(ROOT, "."));
      flow.check("敌意文件名恢复后一个不少（含 emoji/RTL/180 字符名/保留设备名）", missing.length === 0, "0 丢失", missing.slice(0, 4));
      flow.check("恢复没有长出多余文件", extra.length === 0, "0 多余", extra.slice(0, 4));
      const diffBytes = seededNames.filter((n) => {
        const a = path.join(aroot, n);
        const b = path.join(backRoot, n);
        return fs.existsSync(a) && fs.existsSync(b) && !fs.readFileSync(a).equals(fs.readFileSync(b));
      });
      flow.check("恢复后字节与源一致", diffBytes.length === 0, "一致", diffBytes.slice(0, 4));

      flow.section("S4 时钟倒退与自动备份轮换（CMOS 电池失效 → 系统时钟掉回 2000）");
      // 场景：用户机器时钟被重置到 2000，他今天做的自动备份文件名里带 2000-01-02。
      //       轮换若按「文件名日期」保最近 N 份，这份**其实是最新**的备份会被立刻删掉。
      const bdir = path.join(dir, "backups-clock");
      fs.mkdirSync(bdir, { recursive: true });
      const mk = async (iso) => {
        const r = await bak.createBackup({ label: "auto", backupDir: bdir, now: new Date(iso), flush: () => {} });
        return r && r.file ? path.basename(r.file) : null;
      };
      const older = [];
      for (const d of ["2026-09-20T10:00:00Z", "2026-09-21T10:00:00Z", "2026-09-22T10:00:00Z", "2026-09-23T10:00:00Z"]) older.push(await mk(d));
      const newestButOldestName = await mk("2000-01-02T10:00:00Z");
      flow.record("按创建先后记下的文件名序列", JSON.stringify(older.concat([newestButOldestName])));
      const rotated = bak.rotateAutoBackups(bdir, 3);
      const left = fs.readdirSync(bdir).filter((f) => /^backup-auto-/.test(f));
      flow.record("rotateAutoBackups 返回值", String(JSON.stringify(rotated)).slice(0, 160));
      flow.record("轮换后目录里剩下", left.join(" "));
      flow.check(
        "时钟倒退后做出的**最新**自动备份，不得被轮换当成最旧删掉",
        !!newestButOldestName && left.indexOf(newestButOldestName) >= 0,
        "最新那份必须留下",
        { 最新那份: newestButOldestName, 剩下: left }
      );
      // 反向：时钟被拨到未来（用户手动设错 / 同步到错服务器）后改回来
      const futureName = await mk("2030-06-06T10:00:00Z");
      const afterFix = await mk("2026-09-24T10:00:00Z");
      bak.rotateAutoBackups(bdir, 3);
      const left2 = fs.readdirSync(bdir).filter((f) => /^backup-auto-/.test(f));
      flow.record("未来日期 + 改回正常后的目录内容", left2.join(" "));
      flow.check("伪未来的空档备份不得长期挤掉真实最新备份", !left2.includes(futureName) || left2.includes(afterFix), "要么未来那份被清，要么最新那份还在", { futureName, afterFix, left2 });
    });
    setTimeout(() => app.exit(process.exitCode || 0), 300); // D239：runFlow 按结果置退出码
  })
  .catch((e) => {
    flow.record("启动异常", String((e && e.stack) || e));
    setTimeout(() => app.exit(1), 300);
  });
