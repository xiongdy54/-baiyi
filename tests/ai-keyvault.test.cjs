// @runtime: electron
// C-20：API Key 存储契约——系统加密不可用时 Key 只留本次运行内存（绝不落明文盘）、
// 旧明文配置（apiKeyPlain / keys 里的 "plain:" 值）自动迁移清除且本次运行可用、
// secure 路径（真实 safeStorage 加解密）行为与修改前一致。报告 C-20 验收三条全量覆盖。
// 运行：npx electron tests/ai-keyvault.test.cjs（或 node scripts/run-tests.mjs ai-keyvault）
// 隔离 userData（app.setPath + mkdtemp），绝不触碰真实配置（C-11 口径）。
// C-24（Electron 45）：keyVault safeStorage 异步化后 getAIConfig / setAIConfig 均为 async——
// 本套件调用点全部加 await（期望值语义更新，断言未删未放宽，C-05 手法）。
// 本套件不发网络请求（不触 net.fetch，无磁盘缓存锁问题，与 C-19 的 ai-stream 不同）。
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

const ROOT = path.join(__dirname, "..");
const VAULT_PATH = path.join(ROOT, "electron", "keyVault.js");
const AI_PATH = path.join(ROOT, "electron", "ai.js");

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`);
  }
}

// 真 keyVault 先留底（Phase 3 用真实 safeStorage 加解密——Windows DPAPI / macOS Keychain），
// 随后按报告验收注入「不可用」stub 覆盖 require.cache：ai.js 及其后代全部拿到 stub。
const realVault = require(VAULT_PATH);
const stub = {
  strength: () => "none",
  encrypt: () => { throw new Error("不应调用"); },
  decrypt: () => ""
};
require.cache[require.resolve(VAULT_PATH)] = { exports: stub };

const cfgFile = (dir) => path.join(dir, "ai-config.json");
/** 重新加载 ai.js（清空模块级 sessionKeys，模拟新进程） */
const freshAI = () => {
  delete require.cache[require.resolve(AI_PATH)];
  return require(AI_PATH);
};
const readRaw = (dir) => fs.readFileSync(cfgFile(dir), "utf8");

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ai-keyvault-"));
  app.setPath("userData", tmp);
  try {
    // ---- Phase 1：strength "none"——保存 Key 只进内存，不落盘（报告验收 1）----
    let ai = freshAI();
    await ai.setAIConfig({ preset: "zai" });
    const saved = await ai.setAIConfig({ apiKey: "sk-test-123456" });
    let cfg = (await ai.getAIConfig());
    check("(1a) 不可用时 Key 可读回（修复「保存了却读不出来」）", cfg.apiKey === "sk-test-123456", "sk-test-123456", cfg.apiKey);
    check("(1b) keyStorage = session", cfg.keyStorage === "session", "session", cfg.keyStorage);
    check("(1c) encryptionStrength = none", cfg.encryptionStrength === "none", "none", cfg.encryptionStrength);
    check("(1d) hasKey = true", cfg.hasKey === true, true, cfg.hasKey);
    const raw1 = readRaw(tmp);
    check("(1e) ai-config.json 文件内容不包含明文 Key", !raw1.includes("sk-test"), "不含 sk-test", raw1);
    const parsed1 = JSON.parse(raw1);
    check("(1f) apiKeyPlain 未落盘", parsed1.apiKeyPlain === undefined, undefined, parsed1.apiKeyPlain);
    check("(1g) keys 里无 plain: 形态", !Object.values(parsed1.keys || {}).some((v) => String(v).startsWith("plain:")), "无", parsed1.keys);
    check("(1h) setAIConfig 返回体（渲染层视角）剥掉 apiKey 且带 keyStorage", saved.apiKey === undefined && saved.keyStorage === "session" && saved.hasKey === true, "无 apiKey + session", { apiKey: saved.apiKey, keyStorage: saved.keyStorage });

    // 切走再切回：Key 经 sessionKeys 自动恢复（不落盘的按服务商留存）
    await ai.setAIConfig({ preset: "deepseek" });
    check("(1i) 切到别家后 Key 不串用", (await ai.getAIConfig()).apiKey === "", "", (await ai.getAIConfig()).apiKey);
    await ai.setAIConfig({ preset: "zai" });
    const back = (await ai.getAIConfig());
    check("(1j) 切回原服务 Key 自动恢复（内存）", back.apiKey === "sk-test-123456" && back.keyStorage === "session", "sk-test-123456/session", `${back.apiKey}/${back.keyStorage}`);

    // 清除 Key：内存与磁盘一并清
    await ai.setAIConfig({ apiKey: "" });
    const cleared = (await ai.getAIConfig());
    check("(1k) 清除后 hasKey=false / keyStorage=none", !cleared.hasKey && cleared.keyStorage === "none", "false/none", `${cleared.hasKey}/${cleared.keyStorage}`);

    // ---- Phase 2：旧版明文配置迁移——磁盘清除、本次运行可用（报告验收 2）----
    fs.writeFileSync(
      cfgFile(tmp),
      JSON.stringify(
        {
          preset: "goat",
          baseUrl: "https://api.commandcode.ai/provider/v1",
          model: "z-ai/glm-5.3-flash",
          apiKeyEnc: null,
          apiKeyPlain: "sk-legacy-goat",
          keys: { deepseek: "plain:sk-legacy-deepseek", zai: "plain:sk-legacy-zai" }
        },
        null,
        2
      )
    );
    ai = freshAI(); // 重新加载模块：sessionKeys 清零，模拟新进程读到旧配置
    const mig = (await ai.getAIConfig());
    check("(2a) 迁移后当前预设 Key 可用（内存）", mig.apiKey === "sk-legacy-goat" && mig.keyStorage === "session", "sk-legacy-goat/session", `${mig.apiKey}/${mig.keyStorage}`);
    const raw2 = readRaw(tmp);
    check("(2b) 磁盘明文已清除", !raw2.includes("sk-legacy"), "不含 sk-legacy", raw2);
    const parsed2 = JSON.parse(raw2);
    check("(2c) apiKeyPlain 字段已删", parsed2.apiKeyPlain === undefined, undefined, parsed2.apiKeyPlain);
    check("(2d) keys 里 plain: 条目已删", !Object.values(parsed2.keys || {}).some((v) => String(v).startsWith("plain:")), "无", parsed2.keys);
    await ai.setAIConfig({ preset: "deepseek" });
    const dd = (await ai.getAIConfig());
    check("(2e) 其他预设的旧明文同样迁移（切预设后可用）", dd.apiKey === "sk-legacy-deepseek" && dd.keyStorage === "session", "sk-legacy-deepseek/session", `${dd.apiKey}/${dd.keyStorage}`);
    const raw2b = readRaw(tmp);
    (await ai.getAIConfig());
    check("(2f) 迁移幂等（无明文时不再改写磁盘）", readRaw(tmp) === raw2b, "不变", "变化");

    // ---- Phase 3：注入 "secure"（真实 encrypt/decrypt）——行为与修改前一致（报告验收 3）----
    stub.strength = () => "secure";
    stub.encrypt = realVault.encrypt;
    stub.decrypt = realVault.decrypt;
    ai = freshAI();
    await ai.setAIConfig({ preset: "zai" });
    await ai.setAIConfig({ apiKey: "sk-secure-999xyz" });
    const raw3 = readRaw(tmp);
    const parsed3 = JSON.parse(raw3);
    check("(3a) secure 时密文落盘（apiKeyEnc 非空）", typeof parsed3.apiKeyEnc === "string" && parsed3.apiKeyEnc.length > 0, "非空密文", parsed3.apiKeyEnc);
    check("(3b) 磁盘无明文 Key", !raw3.includes("sk-secure-999xyz"), "不含", raw3);
    check("(3c) keys[preset] 留存密文（按服务商恢复，修改前行为）", parsed3.keys && parsed3.keys.zai === parsed3.apiKeyEnc, parsed3.apiKeyEnc, parsed3.keys && parsed3.keys.zai);
    const sec = (await ai.getAIConfig());
    check("(3d) secure 时 Key 可解密读回", sec.apiKey === "sk-secure-999xyz", "sk-secure-999xyz", sec.apiKey);
    check("(3e) keyStorage = encrypted / strength = secure", sec.keyStorage === "encrypted" && sec.encryptionStrength === "secure", "encrypted/secure", `${sec.keyStorage}/${sec.encryptionStrength}`);
    await ai.setAIConfig({ preset: "deepseek" });
    check("(3f) secure 切走不串 Key", (await ai.getAIConfig()).apiKey === "", "", (await ai.getAIConfig()).apiKey);
    await ai.setAIConfig({ preset: "zai" });
    const secBack = (await ai.getAIConfig());
    check("(3g) secure 切回自动恢复（密文留存）", secBack.apiKey === "sk-secure-999xyz" && secBack.keyStorage === "encrypted", "sk-secure-999xyz/encrypted", `${secBack.apiKey}/${secBack.keyStorage}`);
    await ai.setAIConfig({ apiKey: "" });
    const secCleared = (await ai.getAIConfig());
    const parsed3c = JSON.parse(readRaw(tmp));
    check(
      "(3h) secure 清除后密文与留存一并删除",
      !secCleared.hasKey && parsed3c.apiKeyEnc === null && (!parsed3c.keys || parsed3c.keys.zai === undefined),
      "全清",
      JSON.stringify({ hasKey: secCleared.hasKey, apiKeyEnc: parsed3c.apiKeyEnc, key: parsed3c.keys && parsed3c.keys.zai })
    );
  } catch (e) {
    fail += 1;
    console.log(`  ✗ 场景执行异常：${(e && (e.stack || e.message)) || e}`);
  } finally {
    console.log(`\nai-keyvault: ${pass} 通过 / ${fail} 失败`);
    try {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      /* 临时目录清理失败不影响结论 */
    }
    app.exit(fail > 0 ? 1 : 0);
  }
});
