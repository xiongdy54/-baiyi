// A-13 端到端取证：用户不勾「包含 AI Key」，一次「恢复」仍会把明文 Key 写进永久留存的 safety 备份
// 纯 node 可跑（backup.js 的 resolvePaths 只在未显式传 dataDir 时才 require("electron")）。
// 不碰真实 userData：全部在 os.tmpdir() 下的独立目录里做。
// 运行：node tests/fsrs/repro-plaintext-key-in-backup.cjs
const fs = require("fs");
const os = require("os");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const backup = require(path.join(ROOT, "electron", "backup.js"));
const JSZip = require(path.join(ROOT, "node_modules", "jszip"));

const SECRET = "sk-PROOF-DO-NOT-LEAK-9f3c1a7b";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "a13-"));
const dataDir = path.join(tmp, "userdata");
const backupDir = path.join(tmp, "backups");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });

let red = 0;
const t = (name, cond, detail) => { console.log(`  ${cond ? "✓" : "✗"} ${name}${cond ? "" : "   ← " + detail}`); if (!cond) red++; };

async function namesOf(zipFile) {
  const zip = await JSZip.loadAsync(fs.readFileSync(zipFile));
  return Object.keys(zip.files).filter((n) => !zip.files[n].dir);
}
async function textOf(zipFile, inner) {
  const zip = await JSZip.loadAsync(fs.readFileSync(zipFile));
  const f = zip.file(inner);
  return f ? await f.async("string") : null;
}

(async () => {
  // 1) 模拟 safeStorage 不可用时的 ai-config.json（electron/ai.js:145-149 的兜底形态）
  fs.writeFileSync(path.join(dataDir, "ai-config.json"), JSON.stringify({
    preset: "zhipu", model: "glm-4-plus", apiKeyPlain: SECRET, keys: { zhipu: "plain:" + SECRET },
  }, null, 2));
  // createBackup 只按字节打包库文件，给一个占位即可（不依赖真 sql.js 库）
  fs.writeFileSync(path.join(dataDir, "library.db"), "PLACEHOLDER-LIBRARY-BYTES");
  fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify({ app: {} }));

  // 不传 opts.now：backup.js:19 的 stamp() 直接调 .getFullYear()，传数字会崩（内部调用方都传 Date 或不传）
  const opts = { dataDir, backupDir };

  // 2) 正向对照：用户**没勾**「包含 AI Key」时，手动备份里不该有 ai-config.json
  const m = await backup.createBackup({ ...opts, label: "manual", includeAIConfig: false });
  t("S1 手动备份成功", !!m.ok, JSON.stringify(m).slice(0, 160));
  const mNames = await namesOf(m.file);
  console.log(`     手动备份内容 = ${JSON.stringify(mNames)}`);
  t("S2 未勾选时手动备份**不含** ai-config.json（说明 opt-in 语义确实存在）",
    !mNames.includes("ai-config.json"), "居然含了 → opt-in 形同虚设");

  // 3) 关键一步：执行「恢复」。用户依旧没勾。
  const r = await backup.restoreBackup(m.file, { ...opts, includeAIConfig: false });
  console.log(`     restoreBackup → ${JSON.stringify(r).slice(0, 200)}`);
  const safeties = fs.readdirSync(backupDir).filter((f) => f.startsWith("backup-safety-"));
  t("S3 恢复动作产生了一份 safety 备份", safeties.length === 1, `找到 ${safeties.length} 份：${JSON.stringify(safeties)}`);

  if (safeties.length) {
    const sf = path.join(backupDir, safeties[0]);
    const sNames = await namesOf(sf);
    console.log(`     safety 备份内容 = ${JSON.stringify(sNames)}`);
    const hasCfg = sNames.includes("ai-config.json");
    t("S4 【缺陷点】用户没勾，safety 备份却**擅自**打包了 ai-config.json", !hasCfg,
      "含进去了 → backup.js:273 的硬编码 includeAIConfig:true 覆盖了用户选择");

    if (hasCfg) {
      const txt = await textOf(sf, "ai-config.json");
      const leaked = txt && txt.includes(SECRET);
      t("S5 【缺陷点】该文件里是**明文** Key，可直接读出", !leaked,
        leaked ? `明文密钥 ${SECRET} 已出现在备份 zip 内的 ai-config.json 中` : "内容未含明文（可接受）");
      console.log(`     zip 内 ai-config.json 前 160 字 = ${JSON.stringify((txt || "").slice(0, 160))}`);
    }

    // 4) 持久性：safety 备份不在滚动清理的匹配范围内 → 一旦写出永久留存
    const SAFETY_RE = /^backup-safety-\d{8}-\d{6}(-\d+)?\.zip$/;
    t("S6 safety 备份文件名可被滚动清理规则识别",
      SAFETY_RE.test(safeties[0]), `文件名 ${safeties[0]} 不被 SAFETY_RE 识别 → 永不清理`);

    // 连做 3 次恢复，看是否累积多份含明文 Key 的备份
    for (let i = 0; i < 3; i++) {
      const mm = await backup.createBackup({ ...opts, label: "manual", includeAIConfig: false });
      await backup.restoreBackup(mm.file, { ...opts, includeAIConfig: false });
      await new Promise((res) => setTimeout(res, 1100)); // 文件名带秒级 stamp，避免同名覆盖
    }
    const all = fs.readdirSync(backupDir);
    const saf = all.filter((f) => f.startsWith("backup-safety-"));
    console.log(`     再恢复 3 次后：safety 备份共 ${saf.length} 份；目录内文件 = ${JSON.stringify(all)}`);
    t("S7a 多次恢复后 safety 备份数量有上界（≤5）", saf.length <= 5, `累积到 ${saf.length} 份`);
    let leakAny = 0;
    for (const f of saf) {
      const txt = await textOf(path.join(backupDir, f), "ai-config.json");
      if (txt && txt.includes(SECRET)) leakAny++;
    }
    t("S7b 任何一份 safety 备份都不得含明文 Key", leakAny === 0, `${leakAny}/${saf.length} 份含明文密钥`);
  }

  console.log(`\n临时目录：${tmp}`);
  console.log(red === 0
    ? ">>> 全部通过：A-13 不成立（明文 Key 未进备份）"
    : `>>> 判红 ${red} 条 —— A-13 成立：用户明确不勾「包含 AI Key」，一次「恢复」仍把明文 Key 写进备份目录，且该备份不参与滚动清理。`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exitCode = red ? 1 : 0;
})().catch((e) => { console.error("REPRO ERROR:", e && e.stack ? e.stack : e); process.exitCode = 2; });
