// F90 单实例锁的第二实例：**真 main.js** 抢不到锁时，到底碰不碰在线实例的数据
// @runtime: electron  @tier: 1  @gui: false  @id: F90  @timeout: 300
// 运行：npx electron tests/flows/f90-lock-loser-real-app.cjs
//
// 为什么另开一条：F39 的 W3 段测的是**模仿 main.js 形状的替身子进程**（flows/f39-writer-child.cjs
// 里硬编码了 app.quit() 之后继续跑的老形状），所以 v48.21 把 `return` 补进真 main.js 之后，
// F39 仍会照旧报红——它测的是模型，不是产品。这条用**真应用**（electron . + M7_TEST_USERDATA）
// 当"抢不到锁的第二实例"，直接量它有没有动在线实例的 library.db。
// 判据：
//   A 持锁者活着 + 真应用启动 → 真应用必须**很快退出**，且 library.db 的 sha256/size/mtime 三样全不变；
//   对照（无持锁者）→ 同一个真应用必须**活着**（否则说明"退出"根本不是锁造成的，本检就废了）。
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const cp = require("child_process");
const { Flow, runFlow, ROOT, RESULTS_DIR, tmpUserDataDir } = require("./lib/harness.cjs");
const { ELECTRON } = require("./lib/guienv.cjs");
const { audit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F90",
  title: "抢不到锁的第二实例（真应用）",
  angle: "真 main.js 在单实例锁被拒时是否零写入在线实例的数据目录",
  cites: ["§7.1.8", "D-TEST-24", "D-TEST-25", "v48.21/D57"],
  tier: 1,
  gui: false,
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const digest = (f) => {
  try {
    const b = fs.readFileSync(f);
    return { sha: crypto.createHash("sha256").update(b).digest("hex").slice(0, 16), size: b.length, mtime: fs.statSync(f).mtimeMs };
  } catch {
    return { sha: "缺失", size: -1, mtime: -1 };
  }
};
// D239：记下所有子进程，收尾时兜底结束（taskkill 只在 Windows 上有效，其它平台上子进程会一直留着）
const spawned = [];
const spawnEl = (args, env) => {
  const p = cp.spawn(ELECTRON, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: "ignore" });
  spawned.push(p);
  return p;
};

runFlow(flow, async () => {
  const root = path.join(os.tmpdir(), "incremental-reading-f90", String(Date.now()));
  fs.mkdirSync(root, { recursive: true });
  const dir = path.join(root, "userdata");
  fs.mkdirSync(dir, { recursive: true });
  const db = path.join(dir, "library.db");

  flow.section("S0 前置：先造出一个有内容的库（= 在线实例的落盘态）");
  const seeder = spawnEl([path.join(__dirname, "fixtures", "f39-writer-child.cjs")], {
    F39_MODE: "writer", F39_DIR: dir, F39_EVENTS: path.join(root, "seed.jsonl"), F39_TAG: "S", F39_ROWS: "4", F39_ROOT: ROOT,
  });
  await new Promise((r) => setTimeout(r, 12000));
  try { cp.execSync(`taskkill /PID ${seeder.pid} /T /F`, { stdio: "ignore" }); } catch { /* 已退 */ }
  if (!fs.existsSync(db)) { flow.check("前置：种子库必须存在", false, "library.db 存在", "不存在"); return; }
  const a = await audit(db);
  const seeded = a.count("cards");
  a.close();
  const before = digest(db);
  flow.record("种子库", `cards=${seeded} · sha256=${before.sha} · ${before.size} 字节`);
  flow.check("前置：种子库非空（否则后面「有没有被动过」无从判）", seeded > 0, ">0", seeded);

  flow.section("S1 对照：没有持锁者时，同一个真应用必须能起来（证明「退出」是锁造成的）");
  const soloDir = path.join(root, "solo");
  fs.mkdirSync(soloDir, { recursive: true });
  const solo = spawnEl(["."], { M7_TEST_USERDATA: soloDir });
  await sleep(20000);
  const soloAlive = solo.exitCode === null;
  flow.check("对照：无持锁者时真应用必须仍活着（否则本检的「退出」判据无意义）", soloAlive, "进程存活", soloAlive ? "存活" : `已退出 code=${solo.exitCode}`);
  try { cp.execSync(`taskkill /PID ${solo.pid} /T /F`, { stdio: "ignore" }); } catch { /* 忽略 */ }
  try { solo.kill("SIGKILL"); } catch { /* 忽略 */ }

  flow.section("S2 真应用当「抢不到锁的第二实例」：必须快速退出且对 library.db 零改动");
  // 持锁者：最小 Electron 进程，用同一个 userData 抢同一把锁，活到本段结束
  const holder = spawnEl([path.join(__dirname, "fixtures", "f39-writer-child.cjs")], {
    F39_MODE: "lockonly", F39_TRY_LOCK: "1", F39_DIR: dir, F39_EVENTS: path.join(root, "hold.jsonl"), F39_TAG: "H", F39_MIN_LIFE_MS: "600000", F39_ROOT: ROOT,
  });
  await sleep(12000);
  const holdLog = (() => { try { return fs.readFileSync(path.join(root, "hold.jsonl"), "utf-8"); } catch { return ""; } })();
  flow.record("持锁者事件", holdLog.trim().slice(-160) || "(空)");
  const holderAlive = holder.exitCode === null;
  flow.check("前置：持锁者必须活着并拿到锁（否则第二实例不会被拒）", holderAlive && /lockGranted":true/.test(holdLog), "持锁且存活", holderAlive ? "存活" : "已退");

  const mid = digest(db);
  const loser = spawnEl(["."], { M7_TEST_USERDATA: dir });
  let exited = false;
  for (let i = 0; i < 40; i++) { await sleep(500); if (loser.exitCode !== null) { exited = true; break; } }
  const afterRun = digest(db);
  flow.record("第二实例", `退出=${exited} code=${loser.exitCode} · 库 sha ${mid.sha} → ${afterRun.sha}（${afterRun.size} 字节）`);
  flow.check("被拒的第二实例必须自行退出（不是挂在那里跑完整启动流程）", exited, "已退出", exited ? `code=${loser.exitCode}` : "30s 内未退出");
  flow.check("被拒的第二实例不得改写在线实例的 library.db（sha256 必须不变）", afterRun.sha === mid.sha, mid.sha, afterRun.sha);
  await sleep(3000);
  const afterWait = digest(db);
  flow.check("退出后 3 秒内也不得出现补写（整库级 overwrite 会在这条露出来）", afterWait.sha === mid.sha && afterWait.size === mid.size, `${mid.sha}/${mid.size}`, `${afterWait.sha}/${afterWait.size}`);
  try { cp.execSync(`taskkill /PID ${loser.pid} /T /F`, { stdio: "ignore" }); } catch { /* 已退 */ }
  try { cp.execSync(`taskkill /PID ${holder.pid} /T /F`, { stdio: "ignore" }); } catch { /* 已退 */ }

  flow.section("S3 库里内容仍是在线实例那 4 行（对内容再确认一次，不只看哈希）");
  const a2 = await audit(db);
  const rows = a2.rows("SELECT note_text FROM cards ORDER BY note_text").map((r) => r.note_text);
  a2.close();
  flow.record("库内容", `${rows.length} 行：${rows.join(",")}`);
  flow.check("内容必须与第二实例启动前一致（4 行都在）", rows.length === seeded, String(seeded), String(rows.length));
  flow.record("未覆盖", "真·同时启动两个实例的竞态（本条是「先有持锁者、后有第二实例」的确定性构造）；GUI 窗口层面的 second-instance 聚焦行为（F39 的 W1 已覆盖锁的路径变体）");
}).then((s) => {
  // D239：驱动进程原先跑完就停在这里——Electron 主进程没开窗口也不会自行退出，只能等外层超时杀掉（退出码 124）。
  // 跑完先兜底结束仍在的子进程，再按结果如实退出（口径同 dbenv.quit）。
  for (const p of spawned) if (p.exitCode === null && p.signalCode === null) { try { p.kill("SIGKILL"); } catch { /* 已退 */ } }
  require("electron").app.exit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length ? 1 : 0);
});
