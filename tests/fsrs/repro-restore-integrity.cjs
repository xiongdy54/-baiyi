// M2 备份/恢复的完整性取证：恢复这一步到底会不会反过来伤到用户数据
// 全部在 os.tmpdir() 沙箱内做，纯 node（backup.js 的 resolvePaths 只在未显式传 dataDir 时才 require electron）。
// R1 正向对照 / R2 staging 丢失 / R3~R6 故障注入（backup.js 里「先 rmSync 再 renameSync」的非原子写法出现了三次：
//   :311 library.db、:317 assets、:324 memory；R6 另验「db 换入成功、assets 换入失败」的错配态）。
// 运行：node tests/fsrs/repro-restore-integrity.cjs
const fs = require("fs");
const os = require("os");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const backup = require(path.join(ROOT, "electron", "backup.js"));

let red = 0;
const t = (name, cond, detail) => { console.log(`  ${cond ? "✓" : "✗"} ${name}${cond ? "" : "   ← " + detail}`); if (!cond) red++; };
const mk = () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "m2-"));
  const dataDir = path.join(tmp, "userdata");
  const backupDir = path.join(tmp, "backups");
  fs.mkdirSync(path.join(dataDir, "assets"), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "memory", "topics"), { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "library.db"), "DB-V1");
  fs.writeFileSync(path.join(dataDir, "assets", "a.png"), "ASSET-V1");
  fs.writeFileSync(path.join(dataDir, "memory", "core.md"), "# MEMORY CORE V1");
  fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify({ app: { v: 1 } }));
  return { tmp, dataDir, backupDir, opts: { dataDir, backupDir } };
};
const read = (p2) => { try { return fs.readFileSync(p2, "utf8"); } catch { return "(缺失)"; } };

// 通用：让「换入到 destRe 的那一步 rename」失败，看线上数据是否已被先删掉
async function swapFails(label, destRe, probeRel, preciousContent) {
  const env = mk();
  const b = await backup.createBackup({ ...env.opts, label: "manual", includeAIConfig: false });
  const live = path.join(env.dataDir, probeRel);
  fs.writeFileSync(live, preciousContent);            // 线上放一份「备份里没有的新数据」
  await backup.restoreBackup(b.file, env.opts);
  const origRename = fs.renameSync;
  let hit = false;
  fs.renameSync = (from, to) => {
    if (!hit && destRe.test(String(to))) { hit = true; throw new Error("EPERM/ENOSPC (simulated)"); }
    return origRename(from, to);
  };
  let threw = null;
  try { backup.applyPendingRestore(env.opts); } catch (e) { threw = e.message; }
  finally { fs.renameSync = origRename; }
  const survived = fs.existsSync(live);
  console.log(`     [${label}] 注入命中=${hit}；抛错=${threw || "无"}；换入失败后线上 ${probeRel} 是否还在 = ${survived}`);
  t(`R-${label} 换入失败不得毁掉线上 ${probeRel}`, !hit || survived,
    "线上数据已被 rmSync 删除、而备份未能换入 → 该文件/目录被恢复动作自身清空");
  fs.rmSync(env.tmp, { recursive: true, force: true });
}

(async () => {
  // ── R1 正向对照：完整往返 ────────────────────────────────────────────────
  {
    const env = mk();
    const b = await backup.createBackup({ ...env.opts, label: "manual", includeAIConfig: false });
    t("R1a 备份成功", !!b.ok, JSON.stringify(b).slice(0, 120));
    fs.writeFileSync(path.join(env.dataDir, "library.db"), "DB-V2-CHANGED");
    fs.writeFileSync(path.join(env.dataDir, "assets", "a.png"), "ASSET-V2-CHANGED");
    const r = await backup.restoreBackup(b.file, env.opts);
    t("R1b 恢复请求被接受（写 staging + 标记）", !!r.ok, JSON.stringify(r).slice(0, 150));
    const applied = backup.applyPendingRestore(env.opts);
    t("R1c 重启换入成功", !!applied && (applied.restored || []).includes("library.db"), JSON.stringify(applied).slice(0, 150));
    t("R1d 库内容真的回到备份时的版本", read(path.join(env.dataDir, "library.db")) === "DB-V1", read(path.join(env.dataDir, "library.db")));
    t("R1e 资源目录也换回来了", read(path.join(env.dataDir, "assets", "a.png")) === "ASSET-V1", read(path.join(env.dataDir, "assets", "a.png")));
    t("R1f memory 树也换回来了（§4.18-2 唯一真源）", read(path.join(env.dataDir, "memory", "core.md")) === "# MEMORY CORE V1", read(path.join(env.dataDir, "memory", "core.md")));
    fs.rmSync(env.tmp, { recursive: true, force: true });
  }

  // ── R2 staging 被清掉：静默空转 ──────────────────────────────────────────
  {
    const env = mk();
    const b = await backup.createBackup({ ...env.opts, label: "manual", includeAIConfig: false });
    fs.writeFileSync(path.join(env.dataDir, "library.db"), "DB-V2-CHANGED");
    await backup.restoreBackup(b.file, env.opts);
    fs.rmSync(path.join(env.dataDir, "restore-staging"), { recursive: true, force: true });
    const applied = backup.applyPendingRestore(env.opts);
    const restored = applied && applied.restored ? applied.restored : null;
    console.log(`     applyPendingRestore → ${JSON.stringify(applied).slice(0, 150)}`);
    t("R2a 「什么都没换入」必须能被调用方区分出来",
      applied === false || applied?.ok === false || (Array.isArray(restored) && restored.length > 0),
      "返回既非 false 也无 ok:false，与成功同形 → 调用方无法分辨");
    t("R2b 失败后标记应保留以便重试", fs.existsSync(path.join(env.dataDir, "restore-pending.json")),
      "backup.js:339 无条件删标记 → 用户无法重试");
    t("R2c 用户当前数据未被破坏", read(path.join(env.dataDir, "library.db")) === "DB-V2-CHANGED", read(path.join(env.dataDir, "library.db")));
    fs.rmSync(env.tmp, { recursive: true, force: true });
  }

  // ── R3/R4/R5：同一非原子写法在三处，逐个注入 ─────────────────────────────
  console.log("\n[R3] library.db（backup.js:311）");
  await swapFails("db", /library\.db$/, "library.db", "DB-LIVE-PRECIOUS");
  console.log("[R4] assets 目录（backup.js:317）");
  await swapFails("assets", /assets$/, path.join("assets", "a.png"), "ASSET-LIVE-PRECIOUS");
  console.log("[R5] memory 目录（backup.js:324；§4.18-2 称 memory/ 是记忆的唯一真源）");
  await swapFails("memory", /memory$/, path.join("memory", "core.md"), "# MEMORY CORE V2-PRECIOUS");

  // ── R6 顺序危害：db 换入成功、assets 换入失败 → 库与资源错配 ──────────────
  {
    const env = mk();
    const b = await backup.createBackup({ ...env.opts, label: "manual", includeAIConfig: false });
    fs.writeFileSync(path.join(env.dataDir, "library.db"), "DB-LIVE");
    fs.writeFileSync(path.join(env.dataDir, "assets", "a.png"), "ASSET-LIVE-NEWER");
    await backup.restoreBackup(b.file, env.opts);
    const origRename = fs.renameSync;
    let hit = false;
    fs.renameSync = (from, to) => {
      if (!hit && /assets$/.test(String(to))) { hit = true; throw new Error("EPERM (simulated, assets only)"); }
      return origRename(from, to);
    };
    try { backup.applyPendingRestore(env.opts); } catch { /* 预期 */ }
    finally { fs.renameSync = origRename; }
    const dbNow = read(path.join(env.dataDir, "library.db"));
    const assetNow = read(path.join(env.dataDir, "assets", "a.png"));
    console.log(`\n[R6] db 换入成功、assets 换入失败后：library.db=${dbNow} / assets/a.png=${assetNow}`);
    t("R6a 不得出现「库来自备份、资源仍是恢复后新数据」的错配态",
      !(dbNow === "DB-V1" && assetNow === "ASSET-LIVE-NEWER"),
      `库=${dbNow}（备份版）而 assets=${assetNow}（新数据）→ 库指向的图已不是当初那张，且无提示`);
    t("R6b 失败时用户较新的那份 assets 不该已被删空", assetNow !== "(缺失)", "assets 被 rmSync 清掉且未能换入备份版");
    fs.rmSync(env.tmp, { recursive: true, force: true });
  }

  console.log(red === 0
    ? "\n>>> 全部通过：M2 恢复链路在故障注入下也守住了用户数据。"
    : `\n>>> 判红 ${red} 条 —— 见上文行内说明。`);
  process.exitCode = red ? 1 : 0;
})().catch((e) => { console.error("REPRO ERROR:", e && e.stack ? e.stack : e); process.exitCode = 2; });
