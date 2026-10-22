// F39 把「文件系统 + 路径环境」当对手（双实例同目录 / 敌意 dataDir 拼名 / 只读与被占用的写入目标 /
//                                       .tmp 世代残留 / 备份 zip 的内部条目名与联接路径）
// @runtime: electron  @tier: 2  @gui: false  @id: F39  @timeout: 600
// 运行：FLOW_INSTANCE=manual npx electron tests/flows/f39-fs-environment-adversary.cjs
//
// 角度：F04 注入的是「library.db 的 tmp 路径被占成目录」，F37 注入的是「fs.renameSync 抛错」，
//       F25 测的是「导入器把字节写到哪条路径」。三条都只拧了**一个方向的一颗螺丝**，
//       而且全程只有**一个进程**、**一种路径拼写**、**一个可读可写的目录**。
//       真实世界里让桌面应用丢数据的往往不是代码写错，而是**环境不合它的心意**：
//         ① 同一个数据目录上活了两个进程（单实例锁 electron/main.js:18 是唯一防线，
//            而它是按**路径字符串**登记的：目录联接 / \\?\ 前缀 / `..` 绕行是不是同一把锁？）；
//         ② 用户把 AppData 用联接挪到别的盘、dataDir 里带 emoji/RTL/空格/尾点、深过 MAX_PATH；
//         ③ 盘上某个该写的东西成了只读、或那个位置被一个同名文件占着；
//         ④ 上一次崩溃留下的 .tmp / .part / .pre-restore 有没有人收，会不会被当成事实源；
//         ⑤ 别人打包/重打包的备份 zip，条目名带反斜杠、带前导斜杠、带绝对路径、带 ..%2f。
//       判据一律是**落盘字节**：每一步之后用 sql.js 只读打开 library.db 做表级核对，
//       并显式写清「安全」长什么样：**要么把错误抛给调用方，要么盘上不留半套状态**——
//       返回 ok:true 而盘上什么都没发生，就是本仓库账本里说的「假成功」。
//
// 依据：§7.1.8（sql.js 内存库并发纪律——两个进程各持一份全量副本，后落盘者整库覆盖前者）、
//       §4.4.9（成功边界 = COMMIT + persist + IPC）、§7.2 L874（每次落库即落盘）、
//       §9.1 M2（备份含 assets、恢复换入）、§7.5（不可信内容进得来、越界的事做不了）、
//       §7.1.4（重启不丢数据）。
// 本流程只新增测试文件与两个夹具（fixtures/f39-writer-child.cjs、fixtures/f39-journey-child.cjs），
// 不改应用代码；所有沙箱目录都在系统临时目录下、按本进程 PID 命名，绝不碰用户真实资料目录。
//
// 实测结论（2026-09-24 本机 8 轮，命令同上；末两轮为同一份代码的复现轮，均 79/89）：
//   绿：单实例锁**确实**按目录登记并做了规范化——同一目录经目录联接 / \\?\ 前缀 / `..` 绕行 /
//       尾分隔符 / 大小写翻转都抢不到第二把锁（W1，6 种拼名 + 一份无关目录作判别对照）；
//       8 种敌意 dataDir（CJK/emoji/RTL/空格/尾点/尾空格/%#&~/326 字符超 MAX_PATH）全流程绿；
//       只读 library.db、只读冷启动、位置被同名文件占住、备份目标不可写、20 轮落盘无残留、
//       孤儿 tmp 不被当事实源——都按文档承诺的表现。
//   红：① 抢锁失败的那次启动**不是无操作**——app.quit() 之后 whenReady 照样触发（6/6、12/12 次都触发），
//          并且 12 次里有 3 次（复现轮同为 3/12；早先 6 次制的几轮是 4/6、1/6、0/6：竞态，
//          CPU 越忙命中率越高）跑完 initDb、把整库写回在线实例正握着的 library.db（W3）；
//       ② 真有两个写者时落盘层零防线：中段审计抓到 7 行都在盘上，随后 A 的一次 persist 把 B 的
//          3 行整片抹掉，两个进程都 exit 0 且自报 ok（W2 = 账本里的「假成功」形状）；
//       ③ 词典侧 dictionary.db 落盘失败留全尺寸 .tmp 残留（db.js 修过、dictDb.js 没修，W5-f2）＋
//          退出兜底 saveOnQuit 把失败整个吞掉（W5-f4）；
//       ④ 导入的资源字节先落盘、库写失败 → 盘上留下库不认识的文件（W5-c1）；
//       ⑤ 备份 zip 的条目名带前导斜杠/绝对路径时被 continue 静默丢掉，restoreBackup 仍返回
//          ok:true，且与 backup-meta.json 声称的 assetFiles 数目对不上（W7-X / W7-Y）。
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const crypto = require("crypto");
const { app } = require("electron");
const { Flow, runFlow, ROOT } = require("./lib/harness.cjs");
const { audit, quit } = require("./lib/dbenv.cjs");
const JSZip = require("jszip");

const flow = new Flow({
  id: "F39",
  title: "文件系统与路径环境当对手",
  angle: "双实例同目录、敌意 dataDir 拼名、只读/被占用目标、tmp 世代残留、备份 zip 条目名",
  cites: ["§7.1.8", "§4.4.9", "§7.2", "§9.1 M2", "§7.5", "§7.1.4"],
  tier: 2,
  gui: false,
});

const FIXTURES = path.join(__dirname, "fixtures");
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex").slice(0, 16);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000975d1b7d00000000049454e44ae426082",
  "hex"
);

/** 沙箱一律在系统临时目录，且带本进程 PID：长跑里同时有两个 F39 也不能互相抹掉对方的目录 */
const SANDBAG = [];
function sand(name) {
  const p = path.join(os.tmpdir(), "incremental-reading-flows", `f39-${name}-${process.pid}`);
  if (!SANDBAG.includes(p)) SANDBAG.push(p);
  return p;
}
/** 跑完清掉自己的沙箱（长跑每轮都建新目录，不清会堆几百 MB）；F39_KEEP=1 留着现场查缺陷 */
function cleanSandboxes() {
  if (process.env.F39_KEEP) { flow.record("F39_KEEP=1：沙箱保留", SANDBAG.join(" ")); return; }
  let n = 0;
  for (const p of SANDBAG) {
    try { fs.rmSync(p, { recursive: true, force: true }); n++; } catch { /* 句柄未放，交给系统临时目录回收 */ }
  }
  flow.record("沙箱清理", `${n}/${SANDBAG.length} 个目录已删除（F39_KEEP=1 可保留现场）`);
}
function mk(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* 句柄未放 */ }
  fs.mkdirSync(p, { recursive: true });
  return p;
}
function electronExe() {
  return require("../lib/electronBin.cjs")();
}

// ---------- 子进程管理：只清理自己起的进程（按 PID），绝不 taskkill /IM electron.exe ----------
const spawned = [];
function spawnChild(script, env) {
  const rec = { pid: null, events: [], stdout: "", stderr: "", exit: null, label: env.F39_TAG || script };
  let child;
  try {
    child = cp.spawn(electronExe(), [path.join(FIXTURES, script)], {
      cwd: ROOT,
      env: Object.assign({}, process.env, env),
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });
  } catch (e) {
    rec.spawnError = String((e && e.message) || e);
    spawned.push(rec);
    return rec;
  }
  rec.child = child;
  rec.pid = child.pid;
  child.stdout.on("data", (d) => { rec.stdout += String(d); if (rec.stdout.length > 30000) rec.stdout = rec.stdout.slice(-20000); });
  child.stderr.on("data", (d) => { rec.stderr += String(d); if (rec.stderr.length > 30000) rec.stderr = rec.stderr.slice(-20000); });
  child.on("exit", (code, sig) => { rec.exit = { code, sig }; });
  child.on("error", (e) => { rec.exit = { error: String((e && e.message) || e) }; });
  spawned.push(rec);
  return rec;
}
function alive(rec) {
  if (!rec.child || rec.exit) return false;
  try { process.kill(rec.pid, 0); return true; } catch { return false; }
}
function killMine(rec) {
  if (!rec || !rec.pid) return;
  if (rec.exit) return;
  try { process.kill(rec.pid); } catch { /* 已经走了 */ }
}
async function killAllMine() {
  for (const r of spawned) killMine(r);
  await sleep(200);
}

// ---------- 事件文件（子进程 append 行 JSON，父进程轮询） ----------
function readEvents(file) {
  let txt = "";
  try { txt = fs.readFileSync(file, "utf8"); } catch { return []; }
  const parts = txt.split("\n");
  parts.pop(); // 最后一行可能只写了一半
  const out = [];
  for (const l of parts) {
    if (!l.trim()) continue;
    try { out.push(JSON.parse(l)); } catch { /* 半截行，下轮再读 */ }
  }
  return out;
}
async function waitEvent(file, pred, budgetMs, what) {
  const until = Date.now() + budgetMs;
  while (Date.now() < until) {
    const hit = readEvents(file).filter(pred);
    if (hit.length) return hit[hit.length - 1];
    await sleep(120);
  }
  flow.record(`等待超时（${what || "?"}，${budgetMs}ms）`, "未收到事件");
  return null;
}
async function waitExit(rec, budgetMs) {
  const until = Date.now() + budgetMs;
  while (Date.now() < until && !rec.exit) await sleep(120);
  return rec.exit;
}

/** 目录里所有相对路径（/ 分隔），用来查残留与越界写 */
function tree(dir, cap = 600) {
  const out = [];
  const walk = (d, rel, depth) => {
    if (depth > 8 || out.length > cap) return;
    let es;
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { out.push(r + "/"); walk(path.join(d, e.name), r, depth + 1); }
      else out.push(r);
      if (out.length > cap) return;
    }
  };
  walk(dir, "", 0);
  return out;
}
const leftovers = (t) => t.filter((f) => /\.(tmp|part|pre-restore)$/.test(f) || /^restore-(staging\/|pending\.json)/.test(f));

function mkJunction(link, target) {
  try {
    cp.execSync(`cmd.exe /c mklink /J "${link}" "${target}"`, { stdio: "pipe" });
    return fs.existsSync(link) ? null : "命令成功但目录没出现";
  } catch (e) {
    return String((e && e.message) || e).slice(0, 120);
  }
}

app
  .whenReady()
  .then(async () => {
    const s = await runFlow(flow, async () => {
      // ============================================================
      // W1 单实例锁的**键**到底是什么：同一目录的不同拼写算不算同一个实例
      // ============================================================
      flow.section("W1 同一 dataDir 的第二、第三个进程：electron/main.js:18 的锁按什么登记");
      const w1root = mk(sand("lock"));
      const real = path.join(w1root, "userdata");
      mk(real);
      fs.writeFileSync(path.join(real, "sentinel.txt"), "本文件不属于任何拼写测试，用来确认联接没指错地方");
      const link = path.join(w1root, "userdata-link");
      const jerr = mkJunction(link, real);
      flow.record("目录联接（mklink /J）可用性", jerr ? "不可用：" + jerr : "可用（用户把 AppData 挪盘的常见做法）");
      const spellings = [
        ["同一字符串（对照）", real],
        ["带尾分隔符", real + path.sep],
        ["盘符/大小写翻转", real.toUpperCase()],
        ["同一目录·经联接", link],
        ["同一目录·\\\\?\\ 前缀", "\\\\?\\" + real],
        ["同一目录·.. 绕行", path.join(real, "..", "userdata")],
      ].filter(([, p]) => !(p === link && jerr));
      // 判别对照：另一份**无关**目录必须能拿到锁——否则上面那一串「全都拿不到」可能只是
      // 锁按应用/按机器登记，跟路径拼写无关，结论就完全反了。
      const other = path.join(w1root, "另一个无关目录-userdata");
      mk(other);

      const evFile = path.join(w1root, "events.jsonl");
      fs.writeFileSync(evFile, "");
      const holder = spawnChild("f39-writer-child.cjs", {
        F39_MODE: "lockonly", F39_TRY_LOCK: "1", F39_DIR: real, F39_EVENTS: evFile,
        F39_TAG: "HOLDER", F39_MIN_LIFE_MS: "600000", F39_ROOT: ROOT,
      });
      const hs = await waitEvent(evFile, (e) => e.ev === "started" && e.tag === "HOLDER", 90000, "持锁者 started");
      flow.check("W1-0 前置：有一个进程已经拿到单实例锁（否则后面全是空跑）", hs && hs.lockGranted === true, "lockGranted=true", hs ? hs.lockGranted : "无事件");
      const lockRows = [];
      if (hs && hs.lockGranted) {
        for (const [name, p] of spellings) {
          const holderAlive = alive(holder); // 持锁者若已到期退出，「拿到锁」就是本测试的 bug 而不是应用的
          const one = spawnChild("f39-writer-child.cjs", {
            F39_MODE: "lockonly", F39_TRY_LOCK: "1", F39_DIR: p, F39_EVENTS: evFile,
            F39_TAG: "V-" + lockRows.length, F39_MIN_LIFE_MS: "0", F39_ROOT: ROOT,
          });
          const st = await waitEvent(evFile, (e) => e.ev === "started" && e.tag === "V-" + lockRows.length, 90000, "变体 started");
          lockRows.push({ name, got: st ? st.lockGranted : null, eff: st && st.dirEffective, pid: one && one.pid, holderAlive });
          await waitExit(one, 30000);
          killMine(one);
        }
      }
      let otherGot = null;
      let otherHolderAlive = false;
      if (hs && hs.lockGranted) {
        otherHolderAlive = alive(holder);
        const other1 = spawnChild("f39-writer-child.cjs", {
          F39_MODE: "lockonly", F39_TRY_LOCK: "1", F39_DIR: other, F39_EVENTS: evFile,
          F39_TAG: "V-OTHER", F39_MIN_LIFE_MS: "0", F39_ROOT: ROOT,
        });
        const ost = await waitEvent(evFile, (e) => e.ev === "started" && e.tag === "V-OTHER", 90000, "对照目录 started");
        otherGot = ost ? ost.lockGranted : null;
        await waitExit(other1, 30000);
        killMine(other1);
      }
      killMine(holder);
      flow.check("W1-0c 前置：全部测量都在持锁者存活期间完成（否则「抢到了锁」只是我的哨兵到期退场）",
        lockRows.every((r) => r.holderAlive) && otherHolderAlive, "全部可信",
        JSON.stringify({ variants: lockRows.map((r) => r.holderAlive), other: otherHolderAlive }));
      flow.check("W1-2 判别对照：另一份**无关**目录上的进程必须能拿到锁（拿不到=锁不是按目录登记的，本段结论作废）",
        otherGot === true, "拿得到锁", JSON.stringify(otherGot));
      for (const r of lockRows) {
        flow.check(`W1-1 第二个进程用「${r.name}」指向同一个数据目录时必须拿不到锁（拿到=两个实例同时活着，§7.1.8 的内存库前提破）`,
          r.got === false, "拿不到锁", r.got === null ? "无事件" : `第二个进程也拿到了锁（effective=${JSON.stringify(r.eff)}）`);
      }
      flow.record("W1 锁键实测", JSON.stringify(lockRows.map((r) => `${r.name}=${r.got}`)));

      // ============================================================
      // W2 万一真有两个写者：落盘层有没有第二道防线
      // ============================================================
      flow.section("W2 两个进程各持一份内存库写同一目录：后落盘者是不是整库覆盖前者（§7.1.8）");
      const w2root = mk(sand("twowrite"));
      const dir2 = path.join(w2root, "userdata");
      mk(dir2);
      const jlink2 = path.join(w2root, "link");
      const j2err = mkJunction(jlink2, dir2);
      const ev2 = path.join(w2root, "events.jsonl");
      fs.writeFileSync(ev2, "");
      const A = spawnChild("f39-writer-child.cjs", {
        F39_MODE: "writer", F39_DIR: dir2, F39_EVENTS: ev2, F39_TAG: "A", F39_ROWS: "4",
        F39_TRY_LOCK: "1", F39_LATE_AFTER: "B", F39_LATE_MS: "5000", F39_WAIT_MS: "40000", F39_ROOT: ROOT,
      });
      const aFirst = await waitEvent(ev2, (e) => e.ev === "first-write" && e.tag === "A", 120000, "A 首轮落盘");
      flow.check("W2-0 前置：A 首轮 4 行已落盘", aFirst && aFirst.rows && aFirst.rows.length === 4, "4 行", aFirst ? JSON.stringify(aFirst.rows) : "无事件");
      const aStarted0 = readEvents(ev2).filter((e) => e.ev === "started" && e.tag === "A")[0];
      flow.check("W2-0b 前置：A 自己抢到了单实例锁", aStarted0 && aStarted0.lockGranted === true, "true", aStarted0 ? aStarted0.lockGranted : "无事件");
      const B = spawnChild("f39-writer-child.cjs", {
        // B 不抢锁：本段测的是「已经有两个写者了，落盘层有没有第二道防线」，
        // 抢锁能不能挡住它们是 W1/W3 的事——混在一起会让 W2 的结论随 W3 的竞态一起翻。
        F39_MODE: "writer", F39_DIR: j2err ? dir2 : jlink2, F39_EVENTS: ev2, F39_TAG: "B", F39_ROWS: "3", F39_ROOT: ROOT,
      });
      const bDone = await waitEvent(ev2, (e) => e.ev === "done" && e.tag === "B", 60000, "B done");
      const bStarted = readEvents(ev2).filter((e) => e.ev === "started" && e.tag === "B")[0];
      flow.record("W2 第二个进程（经联接路径进入）是否真的写了盘", bDone ? JSON.stringify(bDone.wroteRows) : "无 done 事件");
      // 中段审计：B 已落盘、A 的迟到写还没来（A 等 5s）→ 抓到 7 行就证明丢掉的三行确实上过盘
      let midAudit = null;
      try {
        const am = await audit(path.join(dir2, "library.db"));
        midAudit = am.rows("SELECT note_text FROM cards ORDER BY note_text").map((r) => r.note_text);
        am.close();
      } catch (e) { midAudit = "读失败 " + e.code; }
      flow.record("W2 中段审计（B 落盘后、A 迟到写前，盘上有几张卡）", JSON.stringify(midAudit));
      const aDone = await waitEvent(ev2, (e) => e.ev === "done" && e.tag === "A", 120000, "A done");
      await waitExit(B, 30000); await waitExit(A, 30000);
      killMine(B); killMine(A);
      const waited = readEvents(ev2).filter((e) => e.ev === "waited" && e.tag === "A")[0];
      flow.check("W2-1 前置：A 的迟到写确实发生在 B 落盘之后（否则测不到覆盖）", waited && waited.got === true, "got=true", waited ? waited.got : "无事件");
      const aStarted = aStarted0;
      flow.record("W2 两个进程各自的自报状态", JSON.stringify({
        A: { ok: aDone && aDone.ok, lock: aStarted && aStarted.lockGranted, rows: aDone && aDone.wroteRows, err: aDone && aDone.writeErr, exit: A.exit },
        B: { ok: bDone && bDone.ok, lock: bStarted && bStarted.lockGranted, rows: bDone && bDone.wroteRows, err: bDone && bDone.writeErr, exit: B.exit },
      }));
      flow.check("W2-2 两个进程都自报「一切正常、已落盘」（假成功的取证面：没有任何一方知道自己造成了丢失）",
        Boolean(aDone && bDone && aDone.ok === true && bDone.ok === true && !aDone.writeErr && !bDone.writeErr),
        "双方都 ok=true 且零错误", { A_ok: aDone && aDone.ok, A_err: aDone && aDone.writeErr, B_ok: bDone && bDone.ok, B_err: bDone && bDone.writeErr });
      let w2survivors = [];
      let w2audErr = null;
      try {
        const a2 = await audit(path.join(dir2, "library.db"));
        w2survivors = a2.rows("SELECT note_text FROM cards ORDER BY note_text").map((r) => r.note_text);
        a2.close();
      } catch (e) { w2audErr = String((e && e.message) || e); }
      flow.record("W2 落盘后库里的卡（只读审计）", w2audErr || JSON.stringify(w2survivors));
      const lostB = (bDone && bDone.wroteRows ? bDone.wroteRows : []).filter((r) => !w2survivors.includes(r));
      flow.check("W2-3 安全结局 = 两个进程写过的行**全部**还在盘上（后落盘者不得整库覆盖；db.js:682 persist 只认自己那份内存）",
        w2survivors.length === ((aDone && aDone.wroteRows ? aDone.wroteRows.length : 0) + (bDone && bDone.wroteRows ? bDone.wroteRows.length : 0)),
        "A+B 全部行", `丢了 ${lostB.length} 行：${JSON.stringify(lostB)}（盘上只剩 ${JSON.stringify(w2survivors)}）`);
      flow.check("W2-4 若真要丢，也必须**报错**给调用方（现况：内存/磁盘分歧零检测，persist 不看文件的 mtime/版本号）",
        lostB.length === 0 || Boolean(aDone && aDone.writeErr), "要么不丢，要么抛错", { 丢行数: lostB.length, A抛错: aDone && aDone.writeErr, B抛错: bDone && bDone.writeErr });

      // ============================================================
      // W3 抢不到锁的那个实例，到底有没有碰数据目录（照 main.js:18-28 的代码形状跑）
      // ============================================================
      flow.section("W3 第二个实例（锁被拒）是否仍然是「对数据目录零写入」的无操作");
      const w3root = mk(sand("lockdenied"));
      const dir3 = path.join(w3root, "userdata");
      mk(dir3);
      const ev3 = path.join(w3root, "events.jsonl");
      fs.writeFileSync(ev3, "");
      // 3.0 先由一个进程把库建起来（= 此刻「在线实例」拥有的落盘态：3 行）
      const planter = spawnChild("f39-writer-child.cjs", {
        F39_MODE: "writer", F39_DIR: dir3, F39_EVENTS: ev3, F39_TAG: "P3", F39_ROWS: "3", F39_ROOT: ROOT,
      });
      await waitEvent(ev3, (e) => e.ev === "done" && e.tag === "P3", 60000, "P3 建库");
      await waitExit(planter, 30000);
      killMine(planter);
      const db3 = path.join(dir3, "library.db");
      flow.check("W3-0b 前置：第一实例的库已建好（3 行），后面「有没有被动过」全部以它的字节摘要为基准",
        fs.existsSync(db3) && fs.statSync(db3).size > 0, "library.db 存在且非空", db3 + " size=" + (fs.existsSync(db3) ? fs.statSync(db3).size : "无文件"));
      // 注：Electron/Chromium 自己会在 userData 落 housekeeping 文件（lockfile / Local State…），
      // 那不是应用的写库行为，只记录不判红；判红只看应用自己的数据文件。
      // 3.1 有一个进程持有单实例锁（= 在线的第一实例）
      //     活到被显式杀掉为止：MIN_LIFE 给到 10 分钟，且每轮都记 holderAlive，
      //     否则持锁者自己到期退出会让后面的尝试「拿到锁」——那是本测试的 bug，不是应用的。
      const holder3 = spawnChild("f39-writer-child.cjs", {
        F39_MODE: "lockonly", F39_TRY_LOCK: "1", F39_DIR: dir3, F39_EVENTS: ev3, F39_TAG: "H3", F39_MIN_LIFE_MS: "600000", F39_ROOT: ROOT,
      });
      const h3 = await waitEvent(ev3, (e) => e.ev === "started" && e.tag === "H3" && e.lockGranted === true, 90000, "H3 持锁");
      flow.check("W3-0 前置：第一实例已持有单实例锁（否则「被拒的第二实例」这一测不成立）", Boolean(h3), "有持锁者", h3 ? "ok" : "无事件");
      // 3.2 第二个进程照 electron/main.js:18-28 的形状启动：抢锁失败 → app.quit()
      //     这条路是**竞态**：实测各轮命中率 1/1、4/6、1/6、0/6（CPU 越忙越容易跑完），
      //     单次成败不足为凭，所以连开 S2N 次，判据取「有没有任意一次动过在线实例的数据」。
      const S2N = 12;
      const s2runs = [];
      for (let i = 0; i < S2N; i++) {
        const tag = "S2-" + i;
        const holderAlive = alive(holder3);
        const houseI = new Set(tree(dir3).filter((f) => !f.endsWith("/")));
        const shaBefore = sha(fs.readFileSync(db3));
        const second = spawnChild("f39-writer-child.cjs", {
          F39_MODE: "writer", F39_TRY_LOCK: "1", F39_DIR: dir3, F39_EVENTS: ev3, F39_TAG: tag, F39_ROWS: "2", F39_ROOT: ROOT,
        });
        let done = null;
        const until = Date.now() + 30000;
        while (Date.now() < until && !done && !second.exit) {
          done = readEvents(ev3).filter((e) => e.ev === "done" && e.tag === tag).pop() || null;
          if (!done) await sleep(120);
        }
        await waitExit(second, 15000);
        killMine(second);
        const evs = readEvents(ev3).filter((e) => e.tag === tag).map((e) => e.ev);
        const started = readEvents(ev3).filter((e) => e.ev === "started" && e.tag === tag)[0];
        const added = tree(dir3).filter((f) => !f.endsWith("/") && !houseI.has(f));
        const appAdded = added.filter((f) => /^(library\.db|dictionary\.db|settings\.json|ai-config\.json)/.test(f) || f.startsWith("backups/") || f.startsWith("assets/"));
        const shaAfter = sha(fs.readFileSync(db3));
        s2runs.push({
          i, holderAlive, lock: started ? started.lockGranted : null, evs, finished: !!done,
          shaChanged: shaBefore !== shaAfter, appAdded, exit: second.exit,
        });
      }
      killMine(holder3);
      flow.record("W3 被拒的 " + S2N + " 次启动各走到哪一步", JSON.stringify(s2runs.map((r) => `#${r.i} 持锁者活着=${r.holderAlive ? "y" : "n"} lock=${r.lock} ${r.evs.join(">")} 库被改写=${r.shaChanged ? "y" : "n"} 新增应用文件=${JSON.stringify(r.appAdded)} 退出=${r.exit && r.exit.code}`)));
      const valid = s2runs.filter((r) => r.holderAlive);
      flow.check(`W3-0c 前置：${S2N} 次尝试期间持锁者一直活着（不然「第二实例抢到了锁」可能只是我的哨兵到期退场）`,
        valid.length === s2runs.length, `${S2N}/${S2N} 期间持锁者存活`, `${valid.length}/${s2runs.length} 次可信`);
      const wroteRuns = valid.filter((r) => r.shaChanged || r.appAdded.length > 0);
      const initRuns = valid.filter((r) => r.evs.includes("initdb"));
      flow.check(`W3-1 抢不到锁的实例必须**完全不碰应用自己的数据文件**（安全结局=${S2N} 次里 0 次改动在线实例的 library.db；app.quit() 之后不该再走 initDb/persist）`,
        wroteRuns.length === 0, `${S2N} 次全部零改动`, `${wroteRuns.length}/${S2N} 次改写了 library.db（第 ${JSON.stringify(wroteRuns.map((r) => r.i))} 次）`);
      flow.check("W3-2 它连应用自己的数据库初始化都不该执行（initDb 末尾必然 persist 一次整库，等于对在线实例的目录动写）",
        initRuns.length === 0, `${S2N} 次都不执行 initDb`, `${initRuns.length}/${S2N} 次执行到了 initDb`);
      flow.check(`W3-3 锁本身要说得清：${S2N} 次都应如实报 lock=false（报 true 就说明 W1 的结论在这里不成立，两个实例都以为自己是唯一的）`,
        valid.every((r) => r.lock === false), "全部 lock=false", JSON.stringify(valid.map((r) => r.lock)));
      let s2rows = null;
      try {
        const a3 = await audit(db3);
        s2rows = a3.rows("SELECT note_text FROM cards ORDER BY note_text").map((r) => r.note_text);
        a3.close();
      } catch (e) { s2rows = "读失败 " + e.code; }
      flow.check("W3-4 被拒实例写的行不该出现在在线实例的库里（双击两次图标就可能长出这种混写：两份内存副本共用一份盘，谁后落盘谁说了算）",
        !Array.isArray(s2rows) || !s2rows.some((r) => /^F39-S2-/.test(String(r))), "S2 的行不出现", JSON.stringify(s2rows));

      // ============================================================
      // W4 路径敌意的 dataDir：一份拼名一个进程，全程走完「建库→资源→备份→恢复→重启」
      // ============================================================
      flow.section("W4 敌意 dataDir 拼名：CJK / emoji / RTL / 空格 / 尾点 / 尾空格 / 尖括号%& / 深过 MAX_PATH");
      const w4root = mk(sand("paths"));
      function longBase() {
        let p = path.join(w4root, "长路径段-a-fairly-long-segment-01");
        for (let i = 2; i <= 11; i++) p = path.join(p, `长路径段-${String(i).padStart(2, "0")}-deep-segment`);
        return path.join(p, "userdata");
      }
      const CASES = [
        { key: "cjk", dir: path.join(w4root, "增量阅读·测试沙箱") },
        { key: "emoji", dir: path.join(w4root, "📚阅读🔖沙箱") },
        { key: "rtl", dir: path.join(w4root, "عربي-היום-沙箱") },
        { key: "space", dir: path.join(w4root, "带 空格 与  双空格 目录") },
        { key: "dotend", dir: path.join(w4root, "尾点目录.") },
        { key: "spaceend", dir: path.join(w4root, "尾空格目录 ") },
        { key: "pct", dir: path.join(w4root, "100%#&~'符号目录") },
        { key: "long", dir: longBase() },
      ];
      const journey = {};
      for (const c of CASES) {
        const out = path.join(w4root, `${c.key}.result.json`);
        let createErr = null;
        try { fs.mkdirSync(c.dir, { recursive: true }); } catch (e) { createErr = String((e && e.message) || e); }
        if (c.key === "long") flow.record("W4 超长路径长度", `${c.dir.length} 字符（>260 即 MAX_PATH 之外）`);
        const rec = { createErr, dir: c.dir, len: c.dir.length };
        journey[c.key] = rec;
        if (createErr) { flow.record(`W4 ${c.key} 目录创建失败`, createErr); continue; }
        const child = spawnChild("f39-journey-child.cjs", {
          F39_ROOT: ROOT, F39_DIR: c.dir, F39_LABEL: c.key, F39_OUT: out,
        });
        const until = Date.now() + 150000;
        while (Date.now() < until && !fs.existsSync(out) && !child.exit) await sleep(150);
        await waitExit(child, 20000);
        killMine(child);
        try {
          const r = JSON.parse(fs.readFileSync(out, "utf8"));
          rec.result = r;
        } catch (e) {
          rec.noResult = `没有结果文件（${e.code || e.message}）；stderr 尾部：${String(child.stderr).slice(-160)}`;
        }
      }
      const NEED = ["initDb", "writeCore", "libraryFile", "assets", "createBackup", "listBackups", "postBackupWrite", "restoreBackup", "applyPendingRestore", "reopen", "tree"];
      for (const c of CASES) {
        const rec = journey[c.key] || {};
        const r = rec.result;
        if (!r) {
          flow.check(`W4-${c.key} 敌意拼名「${path.basename(c.dir)}」全流程无失败步骤`, false, "全部步骤 ok", rec.noResult || rec.createErr || "子进程未交回结果");
          continue;
        }
        const bad = NEED.filter((k) => !r.steps[k] || r.steps[k].ok !== true);
        const badDetail = bad.map((k) => `${k}:${(r.steps[k] && (r.steps[k].err || r.steps[k].code)) || "缺步骤"}`);
        flow.check(`W4-${c.key} 敌意拼名「${path.basename(c.dir)}」全流程无失败步骤（建库→资源→备份→恢复→换入→重开）`,
          bad.length === 0 && r.errors.length === 0, "0 个失败步骤", badDetail.length ? JSON.stringify(badDetail) : JSON.stringify(r.errors));
        // 落盘字节核对：恢复之后盘上应当是「备份那一刻」的事实
        let disk = null, diskErr = null;
        try {
          const a = await audit(path.join(r.dirEffective || c.dir, "library.db"));
          disk = {
            cards: a.rows("SELECT note_text FROM cards ORDER BY note_text").map((x) => x.note_text),
            items: Number(a.one("SELECT COUNT(*) AS n FROM library_items WHERE is_deleted = 0")?.n || -1),
            journal: Number(a.one("SELECT COUNT(*) AS n FROM journal_entries")?.n || -1),
            assets: Number(a.one("SELECT COUNT(*) AS n FROM assets")?.n || -1),
          };
          a.close();
        } catch (e) { diskErr = String((e && e.message) || e).slice(0, 160); }
        const exp = ["F39-" + c.key + "-PRE"];
        flow.check(`W4-${c.key} 落盘字节核对：恢复真的生效（备份后的那张卡已回滚、卡/条目/日记/资源行数目正确）`,
          !!disk && JSON.stringify(disk.cards) === JSON.stringify(exp) && disk.items === 2 && disk.journal === 1 && disk.assets === 2,
          `cards=${JSON.stringify(exp)} items=2 journal=1 assets=2`,
          diskErr || JSON.stringify(disk) + (disk && disk.cards.some((x) => /POST/.test(x)) ? " ← 恢复没生效" : ""));
        flow.record(`W4-${c.key} 生效目录`, `${JSON.stringify(r.dirEffective)}（长度 ${String(r.dirEffective || "").length}）· 盘上文件 ${r.tree.length} 项`);
        rec.leftovers = leftovers(r.tree || []);
        if (rec.leftovers.length) flow.record(`W4-${c.key} 残留`, JSON.stringify(rec.leftovers));
      }
      const noLeft = CASES.filter((c) => journey[c.key] && journey[c.key].result).filter((c) => (journey[c.key].leftovers || []).length);
      flow.check("W4-9 任一敌意路径下跑完旅程，数据目录里不得留下 .tmp/.part/.pre-restore/restore-staging 残留",
        noLeft.length === 0, "0 个场景有残留", JSON.stringify(noLeft.map((c) => `${c.key}:${journey[c.key].leftovers}`)));

      // ============================================================
      // W5 只读与被占用的写入目标：要么抛错，要么别留半套
      // ============================================================
      flow.section("W5 只读文件 / 被同名文件占住的位置 / 不可写的备份目标（Windows 下用只读位真做，不用 chmod 目录糊弄）");
      // 不用 lib/dbenv 的 bootFlowDb：它的沙箱目录只按 label 命名，长跑里两个 F39 会撞同一个目录。
      // 这里自带 PID 目录名，并把 setPath 放在 require db.js 之前（settingsStore 在模块加载时固化路径）。
      const dir5 = mk(sand("main"));
      app.setPath("userData", dir5);
      const dbPath5 = path.join(ROOT, "electron", "db.js");
      delete require.cache[dbPath5];
      const dbLive = require(dbPath5);
      await dbLive.initDb();
      const dbFile5 = path.join(dir5, "library.db");
      const tmp5 = dbFile5 + ".tmp";
      let dbv = dbLive; // (b) 段会重新 require 一份 db.js，后续统一走 dbv
      const mkCard = (t) => dbv.createCard({ noteText: t, cardType: "qa", frontMarkdown: "问 " + t, backMarkdown: "答 " + t, priority: 50, tags: [] });
      flow.check("W5-0 前置：沙箱库已在自己的临时目录里建好", fs.existsSync(dbFile5) && path.dirname(dbFile5).startsWith(fs.realpathSync(os.tmpdir())), "library.db 在临时目录内", dbFile5);
      mkCard("F39-W5-基准");
      dbLive.persistNow();

      // (a) library.db 只读 → 写库必须抛错，且盘上分毫不动、不留 tmp
      const bytesBefore = fs.readFileSync(dbFile5);
      fs.chmodSync(dbFile5, 0o444);
      let aThrew = null;
      try { mkCard("F39-W5-只读后不该出现的卡"); } catch (e) { aThrew = String((e && e.message) || e).slice(0, 90); }
      const bytesAfter = (() => { try { return fs.readFileSync(dbFile5); } catch (e) { return "读不到:" + e.code; } })();
      const aTmp = fs.existsSync(tmp5);
      fs.chmodSync(dbFile5, 0o666);
      flow.check("W5-a1 library.db 只读时写库必须把异常抛给调用方（不许静默算成功）", Boolean(aThrew), "抛错", aThrew || "没抛：返回值即成功，而盘上什么都没发生");
      flow.check("W5-a2 抛错之后正式库必须一字不变（原子替换不得被只读位破成半套）",
        Buffer.isBuffer(bytesAfter) && Buffer.compare(bytesBefore, bytesAfter) === 0, "字节相同", Buffer.isBuffer(bytesAfter) ? `长度 ${bytesAfter.length} vs ${bytesBefore.length}${bytesAfter.length === bytesBefore.length ? "（同长度但内容不同）" : ""}` : bytesAfter);
      flow.check("W5-a3 失败后 library.db.tmp 不得残留（db.js:697-702 的 rename 失败分支）", aTmp === false, "无残留", aTmp ? `残留 ${fs.statSync(tmp5).size} 字节` : false);

      // (b) 只读库上的冷启动：initDb 必须拒绝对外「就绪」
      fs.chmodSync(dbFile5, 0o444);
      let bThrew = null;
      try {
        delete require.cache[dbPath5];
        const db2 = require(dbPath5);
        await db2.initDb();
      } catch (e) { bThrew = String((e && e.message) || e).slice(0, 90); }
      const bAfter = (() => { try { return fs.readFileSync(dbFile5); } catch (e) { return "读不到:" + e.code; } })();
      fs.chmodSync(dbFile5, 0o666);
      flow.check("W5-b1 只读库冷启动：initDb 必须以 reject 结束（它末尾无条件 persist 一次整库，写不进去就不能宣布启动成功）",
        Boolean(bThrew), "reject", bThrew || "initDb 正常返回了，可盘上什么都没变");
      flow.check("W5-b2 冷启动失败不得损坏原库字节", Buffer.isBuffer(bAfter) && Buffer.compare(bAfter, bytesBefore) === 0, "字节与初始一致", Buffer.isBuffer(bAfter) ? bAfter.length + " vs " + bytesBefore.length : bAfter);
      delete require.cache[dbPath5];
      dbv = require(dbPath5);
      await dbv.initDb();

      // (c) 落盘失败之后，**已经写到盘上的资源字节**成了没人认领的垃圾
      const beforeTree = new Set(tree(dir5));
      let cThrew = null;
      fs.chmodSync(dbFile5, 0o444);
      try {
        dbv.createImportedDoc({
          title: "F39 落盘失败时的导入", markdown: "# 章" + String.fromCharCode(10) + String(10) + "正文",
          sourceType: "markdown", sourceName: "s.md", originalName: "原文件.md",
          originalBuf: Buffer.from("原文件字节".repeat(64), "utf8"), images: [{ filename: "img-1.png", bytes: PNG }],
        });
      } catch (e) { cThrew = String((e && e.message) || e).slice(0, 60); }
      fs.chmodSync(dbFile5, 0o666);
      const newFiles = tree(dir5).filter((f) => !beforeTree.has(f) && !f.endsWith("/"));
      const orphan = newFiles.filter((f) => f.startsWith("assets/"));
      flow.check("W5-c1 资源字节先落盘、库写失败 → 盘上不得留下库不认识的文件（安全结局=要么一起成功，要么一个新文件都不产生）",
        orphan.length === 0, "0 个孤儿文件", { 抛错: cThrew || "没抛（假成功）", 新落盘文件: orphan.slice(0, 4) });

      // (d) assets 位置被同名文件占住（等价于「写不进去」）：不得留下半本导入的书
      const assetsPath = path.join(dir5, "assets");
      try { fs.rmSync(assetsPath, { recursive: true, force: true }); } catch { /* ignore */ }
      fs.writeFileSync(assetsPath, "一个恰好叫 assets 的文件");
      const itemsBefore = dbv.listItems().length;
      let dThrew = null;
      try {
        dbv.createImportedDoc({ title: "F39 位置被占", markdown: "# 章", sourceType: "markdown", originalName: "o.md", originalBuf: Buffer.from("x"), images: [{ filename: "img-1.png", bytes: PNG }] });
      } catch (e) { dThrew = String((e && e.message) || e).slice(0, 60); }
      const itemsAfter = dbv.listItems().length;
      fs.rmSync(assetsPath, { force: true });
      flow.check("W5-d1 资源目录被同名文件占住时导入必须抛错（而不是「导入成功、打开发现没图」）", Boolean(dThrew), "抛错", dThrew || "没抛错");
      flow.check("W5-d2 抛错之后不得在库里长出没有资源的书（内存态条目数不变＝无半套状态）", itemsAfter === itemsBefore, itemsBefore, itemsAfter);

      // (e) settingsStore 的只读目标
      const st = require(path.join(ROOT, "electron", "settingsStore.js"));
      let eThrew = null;
      try { st.writeSettings({ app: { probe: 1 } }); } catch (err) { eThrew = String((err && err.message) || err); }
      fs.writeFileSync(st.SETTINGS_FILE, JSON.stringify({ app: { baseline: true } }), "utf-8");
      fs.chmodSync(st.SETTINGS_FILE, 0o444);
      let e2Threw = null;
      try { st.writeSettings({ app: { probe: 2 } }); } catch (err) { e2Threw = String((err && err.message) || err).slice(0, 60); }
      const e2Body = fs.readFileSync(st.SETTINGS_FILE, "utf8");
      fs.chmodSync(st.SETTINGS_FILE, 0o666);
      flow.check("W5-e1 settings.json 只读时 writeSettings 必须抛错（main.js 的两处 settings:set 里没有 try/catch，靠的就是它抛）",
        Boolean(e2Threw) && e2Body.indexOf("probe") === -1, "抛错且文件未被改写", { 抛错: e2Threw || "没抛", 文件内容: e2Body.slice(0, 40) });

      // (f) dictionary.db：词典侧的落盘纪律与主库不同
      const dictDb = require(path.join(ROOT, "electron", "dictDb.js"));
      let f1 = null;
      try { f1 = await dictDb.insertRows("f39-src", [{ headword: "moral", html: "adj. 道德的" }]); } catch (e) { f1 = { err: String(e.message) }; }
      const dictFile = path.join(dir5, "dictionary.db");
      let fThrew = null;
      if (fs.existsSync(dictFile)) {
        const dictBefore = fs.readFileSync(dictFile);
        fs.chmodSync(dictFile, 0o444);
        try { await dictDb.insertRows("f39-src", [{ headword: "ethics", html: "n. 伦理学" }]); } catch (e) { fThrew = String((e && e.message) || e).slice(0, 60); }
        const dictTmp = dictFile + ".tmp";
        const leak = fs.existsSync(dictTmp) ? fs.statSync(dictTmp).size : 0;
        const dictAfter = (() => { try { return fs.readFileSync(dictFile); } catch { return null; } })();
        flow.check("W5-f1 词典库只读时 insertRows 必须抛错（词条写了 340 万行才发现写不进去，是最大的一份磁盘账）",
          Boolean(fThrew), "抛错", fThrew || "没抛");
        flow.check("W5-f2 失败后 dictionary.db.tmp 不得残留（dictDb.js:36-48 没有 db.js:690-694 那套清理）",
          leak === 0, "无残留", leak ? `残留 ${leak} 字节` : 0);
        flow.check("W5-f3 原 dictionary.db 字节不变", dictAfter && Buffer.compare(dictBefore, dictAfter) === 0, "字节相同", dictAfter ? dictAfter.length : "读不到");
        // saveOnQuit 仍然处在只读窗口里：它是 will-quit 的唯一兜底
        let fQuitThrew = null;
        try { await dictDb.saveOnQuit(); } catch (e) { fQuitThrew = String((e && e.message) || e); }
        const stillOld = (() => { try { return fs.readFileSync(dictFile).equals(dictBefore); } catch { return null; } })();
        fs.chmodSync(dictFile, 0o666);
        flow.check("W5-f4 退出兜底 saveOnQuit 写不进去时必须留下任何可判定的信号（安全结局=抛错给调用方，或至少不谎报成功；现况=整函数 try/catch 吞掉，本次会话词条静默消失）",
          Boolean(fQuitThrew) || stillOld === false, "抛错，或盘上真的出现新内容", { 抛错: fQuitThrew || "未抛", 盘上仍是旧内容: stillOld });
      } else {
        flow.check("W5-f0 词典库前置：dictionary.db 应当已生成", false, "存在", "不存在：" + JSON.stringify(f1));
      }

      // (g) 备份目标不可写 / 恢复暂存区不可写
      const bk = require(path.join(ROOT, "electron", "backup.js"));
      const occupied = path.join(dir5, "occupied-by-file");
      fs.writeFileSync(occupied, "我不是目录");
      const gBadDest = path.join(occupied, "backups");
      const gRes = await bk.createBackup({ dataDir: dir5, backupDir: gBadDest, flush: () => dbv.persistNow(), label: "manual" });
      flow.check("W5-g1 备份位置不可写时 createBackup 必须返回 ok:false 且说清原因", gRes && gRes.ok === false && /备份位置不可写/.test(String(gRes.error)), "ok:false + 原因", { ok: gRes && gRes.ok, error: gRes && gRes.error });
      const gParts = tree(dir5).filter((f) => /\.part$/.test(f));
      flow.check("W5-g2 失败路径不得留下 .part 半成品", gParts.length === 0, "无残留", gParts);
      const gDir = mk(path.join(dir5, "g3bk"));
      const gReal = await bk.createBackup({ dataDir: dir5, backupDir: gDir, flush: () => dbv.persistNow(), label: "manual", now: new Date(2026, 0, 1, 0, 0, 0) });
      flow.check("W5-g3 显式 backupDir 下备份真的落盘且可被列出", Boolean(gReal.ok) && fs.existsSync(String(gReal.file)) && (await bk.listBackups({ backupDir: gDir })).backups.length >= 1,
        "文件存在且列得出来", { ok: gReal.ok, file: gReal.file && path.basename(String(gReal.file)), error: gReal.error });
      fs.rmSync(occupied, { force: true });

      // ============================================================
      // W6 .tmp 累积与「另一个世代的孤儿 tmp」
      // ============================================================
      flow.section("W6 20 轮落盘的残留计数 + library.db.tmp 会不会被当成事实源");
      // W5-f 那一轮词典落盘失败在盘上留了 dictionary.db.tmp（已由 W5-f2 单独记红）。
      // 本段测的是**主库 persist** 的残留纪律，先把词典那份垃圾清掉，免得把两条结论混成一条。
      const dictTmpLeft = path.join(dir5, "dictionary.db.tmp");
      if (fs.existsSync(dictTmpLeft)) {
        flow.record("W6 起点：先清掉 W5-f2 记红的 dictionary.db.tmp", `${fs.statSync(dictTmpLeft).size} 字节`);
        fs.rmSync(dictTmpLeft, { force: true });
      }
      dbv.persistNow();
      const baseEntries = tree(dir5).filter((f) => !f.endsWith("/") && !f.startsWith("g3bk") && !f.startsWith("backups")).length;
      const entryCurve = [];
      for (let i = 0; i < 20; i++) {
        dbv.persistNow();
        const t = tree(dir5).filter((f) => !f.endsWith("/") && !f.startsWith("g3bk") && !f.startsWith("backups"));
        entryCurve.push({ n: t.length, tmp: t.filter((f) => /\.tmp$/.test(f)) });
      }
      const leakTmp = entryCurve.filter((x) => x.tmp.length).map((x) => x.tmp);
      flow.check("W6-1 连续 20 次落盘不得累积任何 .tmp（tmp 不是事实源，也不该是常驻垃圾）",
        leakTmp.length === 0, "每轮 0 个 tmp", JSON.stringify(leakTmp.slice(0, 3)));
      const grew = entryCurve.filter((x, i) => i > 0 && x.n > entryCurve[0].n);
      flow.check("W6-2 落盘轮次不改变目录里的文件条目数（rename 原子替换不产生额外文件）", grew.length === 0, "条目数恒定 " + baseEntries, JSON.stringify(entryCurve.map((x) => x.n).slice(0, 6)));

      // 孤儿 tmp：一份比正式库**更新**的完整库（模拟 rename 之前被杀）。
      // 关键：绝不改正式库——先复制出副本、改副本、再把副本摆成 tmp，否则测的是我自己造的假象。
      const MARK = "F39孤儿tmp独有的一行";
      const rescue = path.join(mk(sand("rescuedb")), "library.db");
      fs.copyFileSync(dbFile5, rescue);
      {
        const a = await audit(rescue);
        a.exec("INSERT OR REPLACE INTO review_skips (id, card_id, skipped_at) VALUES ('F39-ORPHAN', ?, 1)", [MARK]);
        a.save();
        a.close();
        fs.copyFileSync(rescue, tmp5);
        flow.record("W6 孤儿 tmp 大小 / 正式库大小", `${fs.statSync(tmp5).size} / ${fs.statSync(dbFile5).size}`);
        const rawLive = fs.readFileSync(dbFile5);
        const rawTmp = fs.readFileSync(tmp5);
        flow.check("W6-0 前置：孤儿标记只存在于 tmp 那一份（正式库里没有），否则本条测不到「谁被当成事实源」",
          !rawLive.includes(Buffer.from(MARK, "utf8")) && rawTmp.includes(Buffer.from(MARK, "utf8")),
          "标记只在 tmp", { 正式库含标记: rawLive.includes(Buffer.from(MARK, "utf8")), tmp含标记: rawTmp.includes(Buffer.from(MARK, "utf8")) });
      }
      delete require.cache[dbPath5];
      const db6 = require(dbPath5);
      await db6.initDb();
      const rawAfterInit = fs.readFileSync(dbFile5);
      flow.check("W6-3 半截/孤儿 tmp 永不被当作事实源（重启后盘上必须仍是正式库那一代，§4.4.9）",
        !rawAfterInit.includes(Buffer.from(MARK, "utf8")) && db6.listAllCards().length >= 1,
        "孤儿标记不出现在盘上", { 盘上含孤儿标记: rawAfterInit.includes(Buffer.from(MARK, "utf8")), 卡数: db6.listAllCards().length });
      flow.check("W6-4 重启后 tmp 被清走（db.js:210），不留到第二次启动", fs.existsSync(tmp5) === false, "已被删除", fs.existsSync(tmp5));
      flow.record("W6-5 观察：正式库缺失、tmp 是唯一副本时", "initDb 无条件先删 tmp 再新建空库——那一份比正式库更新的数据被静默销毁，调用方零提示（账本未登记，留待裁定）");

      // ============================================================
      // W7 备份 zip 的**内部条目名**当对手 + 联接路径下的备份/恢复
      // ============================================================
      flow.section("W7 别人重打包的备份 zip：条目名带反斜杠 / 前导斜杠 / 绝对路径 / ../ / ..%2f");
      const w7root = mk(sand("zipentries"));
      async function buildZip(file, entries, declaredAssets) {
        const zip = new JSZip();
        zip.file("backup-meta.json", JSON.stringify({ app: "incremental-reading-dev", format: 1, label: "manual", createdAt: Date.now(), assetFiles: declaredAssets }));
        for (const [n, b] of entries) zip.file(n, b);
        fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer" }));
        const back = await JSZip.loadAsync(fs.readFileSync(file));
        return Object.keys(back.files);
      }
      const dbBytes = fs.readFileSync(dbFile5);
      // entries 写成函数：个别条目名要用到本场景的目录绝对路径（构造「绝对路径条目」）
      // declared = 备份清单 backup-meta.json 里声称的资源文件数（应用自己在 createBackup 时就是这么记的）
      const ZCASES = [
        { key: "fwd", declared: 1, note: "规范写法（正斜杠相对路径）", entries: () => [["library.db", dbBytes], ["assets/item-x/img-1.png", PNG]] },
        { key: "bwd", declared: 1, note: "Windows 反斜杠条目名（winzip/部分打包器）", entries: () => [["library.db", dbBytes], ["assets\\item-x\\img-1.png", PNG]] },
        { key: "lead", declared: 1, note: "前导斜杠（绝对式条目名，POSIX 打包器常见）", entries: () => [["library.db", dbBytes], ["/assets/item-x/img-1.png", PNG]] },
        { key: "abs", declared: 1, note: "盘符绝对路径条目", entries: (ctx) => [["library.db", dbBytes], [ctx.outside.replace(/\\/g, "/") + "/assets/item-x/img-1.png", PNG]] },
        { key: "up", declared: 0, note: "../../ 穿越", entries: () => [["library.db", dbBytes], ["../../escape-up.png", PNG]] },
        { key: "pct", declared: 1, note: "..%2f 百分号编码（只解码一次就能穿越的那种）", entries: () => [["library.db", dbBytes], ["..%2f..%2fescape-pct.png", PNG], ["assets/item-x/img-1.png", PNG]] },
        { key: "noback", declared: 0, note: "库里带备份后新增的卡，应当被回滚", entries: () => [["library.db", dbBytes]] },
      ];
      const zres = {};
      for (const z of ZCASES) {
        const caseDir = mk(path.join(w7root, "case-" + z.key));
        const outside = mk(path.join(w7root, "outside-" + z.key));
        const file = path.join(caseDir, z.key + ".zip");
        const names = await buildZip(file, z.entries({ caseDir, outside, w7root }), z.declared);
        const r = { fileNamesInZip: names, askedFor: z.entries({ caseDir, outside, w7root }).map((e) => e[0]), declared: z.declared };
        zres[z.key] = r;
        let rr = null, rErr = null;
        try {
          rr = await bk.restoreBackup(file, { dataDir: caseDir, skipSafety: true, flush: () => true });
        } catch (e) { rErr = String((e && e.message) || e).slice(0, 120); }
        r.restore = rr ? { ok: rr.ok, error: rr.error } : { threw: rErr };
        r.staged = tree(path.join(caseDir, "restore-staging")).filter((f) => !f.endsWith("/"));
        r.everything = tree(caseDir).filter((f) => !f.endsWith("/") && !f.endsWith(".zip"));
        r.escaped = tree(outside).filter((f) => !f.endsWith("/"));
        // 关键：恢复完之后真的换入，看资源文件在不在
        let applied = null, apErr = null;
        try { applied = bk.applyPendingRestore({ dataDir: caseDir }); } catch (e) { apErr = String((e && e.message) || e).slice(0, 120); }
        r.applied = applied || { threw: apErr };
        r.finalAssets = tree(path.join(caseDir, "assets")).filter((f) => !f.endsWith("/"));
        r.finalLeftovers = leftovers(tree(caseDir));
      }
      for (const z of ZCASES) {
        const r = zres[z.key];
        const nameKept = r.fileNamesInZip.some((n) => r.askedFor.includes(n));
        flow.check(`W7-${z.key} 前置：zip 里确实存着「${z.note}」这个条目名（否则本条是空跑）`, nameKept, "条目名原样存进 zip", JSON.stringify(r.fileNamesInZip));
        flow.check(`W7-${z.key} 越界条目不得写到数据目录之外（§7.5 红线；backup.js:365-366 的 resolve 前缀判据）`,
          r.escaped.length === 0, "目录外 0 个文件", { 目录外: r.escaped, 本次全包: r.everything.slice(0, 6) });
        const okRestore = r.restore && (r.restore.ok === true || r.restore.error);
        flow.check(`W7-${z.key} restoreBackup 不得抛未捕获异常（要么返回结构化失败，要么成功）`, Boolean(okRestore) && !r.restore.threw, "结构化返回", r.restore.threw || r.restore.error || "ok");
      }
      // 「假成功」这条只判资源类条目名：备份声称成功、换入后书却没了图
      const harm = ["lead", "abs", "up", "pct"].filter((k) => {
        const r = zres[k];
        const asked = r.askedFor.some((n) => /^\/?assets/.test(n) || /assets/.test(n));
        const landed = r.finalAssets.length > 0;
        return asked && !landed && r.restore && r.restore.ok === true;
      });
      flow.check("W7-X 凡是「资源条目被静默丢掉却仍返回 ok:true」的都算假成功（恢复后书在、图没了，用户重启前毫不知情；backup.js:366 的 continue 不计数不报告）",
        harm.length === 0, "0 种写法静默丢资源", JSON.stringify(harm.map((k) => `${k}: 恢复返回 ok:true 而 assets 落地 0 个文件（zip 条目=${JSON.stringify(zres[k].fileNamesInZip)}）`)));
      const mismatch = ZCASES.map((z) => z.key).filter((k) => {
        const r = zres[k];
        return r.declared !== r.finalAssets.length && r.restore && r.restore.ok === true;
      });
      flow.check("W7-Y 备份清单声称的资源文件数必须等于换入后盘上真的有的文件数，对不上就必须 ok:false 说清丢了什么（安全结局=数目对上或响亮报错；现况=清单说 1 个、盘上 0 个、恢复返回 ok:true）",
        mismatch.length === 0, "0 种写法数目对不上", JSON.stringify(mismatch.map((k) => `${k}: 清单声称 ${zres[k].declared} 个资源文件，换入后盘上 ${zres[k].finalAssets.length} 个，restoreBackup.ok=${zres[k].restore.ok}`)));
      flow.record("W7 各写法的落地情况", JSON.stringify(Object.fromEntries(Object.entries(zres).map(([k, v]) => [k, {
        ok: v.restore.ok, staged: v.staged, applied: v.applied && v.applied.restored, assets: v.finalAssets, 残留: v.finalLeftovers,
      }]))));
      const normOk = zres.fwd && zres.fwd.restore.ok === true && zres.fwd.finalAssets.length === 1 && zres.fwd.applied && zres.fwd.applied.ok === true;
      flow.check("W7-N 规范备份（正斜杠条目）在同样这套代码里必须真的可用（对照：证明上面那条红不是环境噪声）", normOk, "恢复+换入+资源齐", {
        ok: zres.fwd && zres.fwd.restore, staged: zres.fwd && zres.fwd.staged, applied: zres.fwd && zres.fwd.applied, assets: zres.fwd && zres.fwd.finalAssets });
      const bwdWorked = zres.bwd && zres.bwd.finalAssets.length === 1;
      flow.record("W7 反斜杠条目名在本机的实际表现", bwdWorked ? "被 Windows 当作目录分隔符，解到了正确位置（同一份 zip 在 POSIX 上会变成名字里带反斜杠的单文件 → 换入时认不出 assets/，本机测不到，如实留白）" : "未解到预期位置：" + JSON.stringify(zres.bwd && zres.bwd.staged));

      // 联接路径下的备份—恢复往返（dataDir 是链接，真身在别处）
      flow.section("W7b 备份/恢复穿过目录联接（用户把 AppData 挪盘的常见做法）");
      const w7b = mk(sand("junction"));
      const realB = path.join(w7b, "real");
      mk(path.join(realB, "assets", "item-j"));
      fs.writeFileSync(path.join(realB, "assets", "item-j", "img-1.png"), PNG);
      fs.copyFileSync(dbFile5, path.join(realB, "library.db"));
      const linkB = path.join(w7b, "link");
      const j3err = mkJunction(linkB, realB);
      if (j3err) {
        flow.check("W7b-0 前置：本机能建目录联接", false, "联接可用", j3err);
      } else {
        const viaLink = await bk.createBackup({ dataDir: linkB, backupDir: path.join(w7b, "bk"), flush: () => true, label: "manual" });
        const realSawZip = fs.existsSync(path.join(w7b, "bk")) && fs.readdirSync(path.join(w7b, "bk")).length;
        flow.check("W7b-1 经联接目录做的备份真的产出了包（备份字节落在盘上，不是只返回一个路径字符串）",
          Boolean(viaLink.ok) && realSawZip > 0 && fs.statSync(String(viaLink.file)).size > 100, "ok + 非空文件", { ok: viaLink.ok, error: viaLink.error, 包数: realSawZip });
        const entries = viaLink.ok ? Object.keys((await JSZip.loadAsync(fs.readFileSync(viaLink.file))).files) : [];
        flow.check("W7b-2 联接下的 walkFiles 打包路径不得变成真身绝对路径或带联接前缀（zip 内一律相对 + 正斜杠）",
          entries.some((n) => n === "assets/item-j/img-1.png") && !entries.some((n) => /^[A-Za-z]:|[\\]|^link\//.test(n)),
          "含 assets/item-j/img-1.png 且无绝对/反斜杠名", JSON.stringify(entries));
        // 抹掉真身，再用**联接路径**恢复，最后用**真身路径**换入：两条拼写必须指向同一份数据
        fs.rmSync(path.join(realB, "assets"), { recursive: true, force: true });
        dbBytes && fs.writeFileSync(path.join(realB, "library.db"), Buffer.from("被抹掉之前的占位库不是备份里那份"));
        const rst = await bk.restoreBackup(String(viaLink.file), { dataDir: linkB, skipSafety: true, flush: () => true });
        const ap = bk.applyPendingRestore({ dataDir: realB });
        const backAgain = fs.existsSync(path.join(realB, "assets", "item-j", "img-1.png"));
        flow.check("W7b-3 经联接备份、经联接恢复、经真身换入：字节必须回到真身目录（同一份数据两种拼写都认）",
          Boolean(rst.ok) && ap && ap.ok === true && backAgain && sha(fs.readFileSync(path.join(realB, "assets", "item-j", "img-1.png"))) === sha(PNG),
          "换入成功 + 图字节一致", { restore: rst, applied: ap, 图回来了: backAgain });
        const lb = leftovers(tree(w7b));
        flow.check("W7b-4 联接往返之后不留 .pre-restore / staging 残留", lb.length === 0, "0 个残留", JSON.stringify(lb.slice(0, 6)));
      }

      await killAllMine();
      cleanSandboxes();
    });

    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch(async (e) => {
    console.log("F39 顶层异常：" + (e && e.stack ? e.stack : e));
    await killAllMine().catch(() => {});
    flow.writeResult({ crash: String((e && e.message) || e) });
    process.exit(1);
  });
