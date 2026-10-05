// v48.51（D91 §8.1/§8.2）「简明解读」提示词播种回归：reader-explain-ste 种子行 + 既有 reader-explain 零改动。
// 运行：node_modules/.bin/electron tests/d91-prompts.test.cjs（须先关应用）
// 隔离 userData：必须在 require electron/db.js 之前 setPath，绝不触碰真实库（§7.3）。
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), "d91-prompts-"));
app.setPath("userData", tmpUserData);

let pass = 0;
let fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}

app.whenReady().then(async () => {
  try {
    const db = require("../electron/db");
    const prompts = require("../electron/prompts");
    await db.initDb();

    console.log("== P1 全新库：reader-explain-ste 播种 v1（is_default=1） ==");
    const ste = db.getPromptTemplate("reader-explain-ste");
    check("reader-explain-ste 存在且 version=1", !!ste && ste.version === 1, 1, ste && ste.version);
    check("is_default = 1", !!ste && Number(ste.is_default) === 1, 1, ste && ste.is_default);
    check("situation_required = 0（解释场景不注入记忆情境）", !!ste && Number(ste.situation_required) === 0, 0, ste && ste.situation_required);
    check("内容与 READER_EXPLAIN_STE_PROMPT 常量字面一致", !!ste && ste.content === prompts.READER_EXPLAIN_STE_PROMPT, true, !!ste && "len=" + (ste.content || "").length);
    check("含双 pack 槽位 {{ANALYSIS_PROFILE}} / {{OUTPUT_PROFILE}}", !!ste && ste.content.includes("{{ANALYSIS_PROFILE}}") && ste.content.includes("{{OUTPUT_PROFILE}}"), true, !!ste);
    check("含机器标记契约（ste:matLang / ste:points / ste:readings）", !!ste && ste.content.includes("<!--ste:matLang=") && ste.content.includes("<!--ste:points=") && ste.content.includes("<!--ste:readings="), true, !!ste);
    check("含歧义类别封闭集（10 个 key）", !!ste && ["polysemy", "pronoun-ref", "long-nesting", "hidden-agent", "negation-stack", "undefined-term", "register-mix", "quantity-vague", "idiom-figurative", "missing-condition"].every((k) => ste.content.includes(k)), true, !!ste);
    check("完整执行无门控（不出现「已足够清晰」类判定指令）", !!ste && !ste.content.includes("无需解读") && !ste.content.includes("判断是否值得"), true, !!ste);
    check("模板正文不含 ASD-STE100（法务红线，§2.2）", !!ste && !ste.content.includes("ASD-STE100"), true, !!ste);

    console.log("== P2 回归：既有 reader-explain scope 零改动（§8.2） ==");
    const explain = db.getPromptTemplate("reader-explain");
    check("reader-explain 存在且 version=1", !!explain && explain.version === 1, 1, explain && explain.version);
    check("内容与 READER_EXPLAIN_PROMPT 常量字面一致（未被本批触碰）", !!explain && explain.content === prompts.READER_EXPLAIN_PROMPT, true, !!explain);

    console.log("== P3 播种幂等 ==");
    const before = db.listPromptTemplates().filter((r) => r.scope === "reader-explain-ste").length;
    db.ensurePromptTemplates();
    db.ensurePromptTemplates();
    const after = db.listPromptTemplates().filter((r) => r.scope === "reader-explain-ste").length;
    check("连播两次不新增 reader-explain-ste 行", after === before, before, after);
  } catch (err) {
    fail++;
    console.log("  ✗ 测试执行异常: " + (err && err.stack || err));
  } finally {
    console.log(`\n${fail === 0 ? "ALL PASS" : "FAILED"}: ${pass} passed, ${fail} failed`);
    app.quit();
    process.exitCode = fail === 0 ? 0 : 1;
  }
});
