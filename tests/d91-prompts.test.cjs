// v48.51（D91 §8.1/§8.2）「简明解读」提示词播种回归：reader-explain-ste 种子行 + 既有 reader-explain 零改动。
// @runtime: electron
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

    console.log("== P1 全新库：reader-explain-ste 播种（v48.103 / D148 起全新库直接 v1→v2→v3，默认取 v3） ==");
    const ste = db.getPromptTemplate("reader-explain-ste");
    check("reader-explain-ste 存在且 version=3（v1/v2 播种后即被 v3 升版覆盖为默认）", !!ste && ste.version === 3, 3, ste && ste.version);
    const steRows = db.listPromptTemplates().filter((r) => r.scope === "reader-explain-ste");
    check("v1/v2 行留痕（三行：v1 + v2 + v3）", steRows.length === 3 && steRows.some((r) => r.version === 1) && steRows.some((r) => r.version === 2) && steRows.some((r) => r.version === 3), 3, steRows.map((r) => r.version));
    const steV1Row = db.getPromptTemplateVersion("reader-explain-ste", 1);
    check("v1 行内容 = D91 原文冻结常量（READER_EXPLAIN_STE_PROMPT_V1）", !!steV1Row && steV1Row.content === prompts.READER_EXPLAIN_STE_PROMPT_V1, true, !!steV1Row && "len=" + (steV1Row.content || "").length);
    const steV2Row = db.getPromptTemplateVersion("reader-explain-ste", 2);
    check("v2 行内容 = D118 原文冻结常量（READER_EXPLAIN_STE_PROMPT_V2）", !!steV2Row && steV2Row.content === prompts.READER_EXPLAIN_STE_PROMPT_V2, true, !!steV2Row && "len=" + (steV2Row.content || "").length);
    check("is_default = 1", !!ste && Number(ste.is_default) === 1, 1, ste && ste.is_default);
    check("situation_required = 0（解释场景不注入记忆情境）", !!ste && Number(ste.situation_required) === 0, 0, ste && ste.situation_required);
    check("内容与 READER_EXPLAIN_STE_PROMPT 常量字面一致", !!ste && ste.content === prompts.READER_EXPLAIN_STE_PROMPT, true, !!ste && "len=" + (ste.content || "").length);
    check("含双 pack 槽位 {{ANALYSIS_PROFILE}} / {{OUTPUT_PROFILE}}", !!ste && ste.content.includes("{{ANALYSIS_PROFILE}}") && ste.content.includes("{{OUTPUT_PROFILE}}"), true, !!ste);
    check("含机器标记契约（ste:matLang / ste:points / ste:readings）", !!ste && ste.content.includes("<!--ste:matLang=") && ste.content.includes("<!--ste:points=") && ste.content.includes("<!--ste:readings="), true, !!ste);
    check("含节标题语法硬约束（v48.74 / D118：## 前缀 + 禁止【】代替）", !!ste && ste.content.includes("## 歧义点") && ste.content.includes("## 简明改写") && ste.content.includes("## 多重解读") && ste.content.includes("## 术语") && ste.content.includes("禁止用【】"), true, !!ste);
    check("含追问直答条款（v48.74 / D118：【用户追问】在场时跳过全流程与机器标记）", !!ste && ste.content.includes("【用户追问】") && ste.content.includes("追问直答") && ste.content.includes("不输出机器标记"), true, !!ste);
    check("含简明改写硬规则块（v48.103 / D148：受控语言改写≠口语化复述 + 逐句自查五项）", !!ste && ste.content.includes("【简明改写硬规则") && ste.content.includes("不是口语化复述") && ste.content.includes("逐句自查") && ste.content.includes("禁止遗漏、添加或合并事实"), true, !!ste);
    check("含歧义类别封闭集（10 个 key）", !!ste && ["polysemy", "pronoun-ref", "long-nesting", "hidden-agent", "negation-stack", "undefined-term", "register-mix", "quantity-vague", "idiom-figurative", "missing-condition"].every((k) => ste.content.includes(k)), true, !!ste);
    check("完整执行无门控（不出现「已足够清晰」类判定指令）", !!ste && !ste.content.includes("无需解读") && !ste.content.includes("判断是否值得"), true, !!ste);
    check("模板正文不含 ASD-STE100（法务红线，§2.2）", !!ste && !ste.content.includes("ASD-STE100"), true, !!ste);

    console.log("== P2 reader-explain 升版 v2（v48.74 / D118：追问四式；D91 时期「零改动」守卫随之退役） ==");
    const explain = db.getPromptTemplate("reader-explain");
    check("reader-explain 默认行 version=2", !!explain && explain.version === 2, 2, explain && explain.version);
    check("内容与 READER_EXPLAIN_PROMPT 常量字面一致（v2 追问四式）", !!explain && explain.content === prompts.READER_EXPLAIN_PROMPT, true, !!explain && "len=" + (explain.content || "").length);
    check("含追问四式条款（通俗解释/严格定义/举个例子/为什么会这样各有作答要求）", !!explain && ["通俗解释", "严格定义", "举个例子", "为什么会这样"].every((k) => explain.content.includes(k)) && explain.content.includes("【用户追问】"), true, !!explain);
    const explainV1Row = db.getPromptTemplateVersion("reader-explain", 1);
    check("v1 行内容 = 原文冻结常量（READER_EXPLAIN_PROMPT_V1）", !!explainV1Row && explainV1Row.content === prompts.READER_EXPLAIN_PROMPT_V1, true, !!explainV1Row && "len=" + (explainV1Row.content || "").length);

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
