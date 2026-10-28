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

    console.log("== P1 全新库：reader-explain-ste 播种（D247 起全新库 v1→v2→v3→v4，默认取 v4） ==");
    const ste = db.getPromptTemplate("reader-explain-ste");
    check("reader-explain-ste 存在且 version=4（v1-v3 播种后即被 v4 升版覆盖为默认）", !!ste && ste.version === 4, 4, ste && ste.version);
    const steRows = db.listPromptTemplates().filter((r) => r.scope === "reader-explain-ste");
    check("v1-v4 行留痕（四行）", steRows.length === 4 && [1, 2, 3, 4].every((v) => steRows.some((r) => r.version === v)), 4, steRows.map((r) => r.version));
    const steV1Row = db.getPromptTemplateVersion("reader-explain-ste", 1);
    check("v1 行内容 = D91 原文冻结常量（READER_EXPLAIN_STE_PROMPT_V1）", !!steV1Row && steV1Row.content === prompts.READER_EXPLAIN_STE_PROMPT_V1, true, !!steV1Row && "len=" + (steV1Row.content || "").length);
    const steV2Row = db.getPromptTemplateVersion("reader-explain-ste", 2);
    check("v2 行内容 = D118 原文冻结常量（READER_EXPLAIN_STE_PROMPT_V2）", !!steV2Row && steV2Row.content === prompts.READER_EXPLAIN_STE_PROMPT_V2, true, !!steV2Row && "len=" + (steV2Row.content || "").length);
    const steV3Row = db.getPromptTemplateVersion("reader-explain-ste", 3);
    check("v3 行内容 = D148 原文冻结常量（READER_EXPLAIN_STE_PROMPT_V3）", !!steV3Row && steV3Row.content === prompts.READER_EXPLAIN_STE_PROMPT_V3, true, !!steV3Row && "len=" + (steV3Row.content || "").length);
    check("is_default = 1", !!ste && Number(ste.is_default) === 1, 1, ste && ste.is_default);
    check("situation_required = 0（解释场景不注入记忆情境）", !!ste && Number(ste.situation_required) === 0, 0, ste && ste.situation_required);
    check("内容与 READER_EXPLAIN_STE_PROMPT 常量字面一致（v4）", !!ste && ste.content === prompts.READER_EXPLAIN_STE_PROMPT, true, !!ste && "len=" + (ste.content || "").length);
    check("含三槽位 {{OUTPUT_LANG_NAME}} / {{ANALYSIS_PROFILE}} / {{OUTPUT_PROFILE}}", !!ste && ste.content.includes("{{OUTPUT_LANG_NAME}}") && ste.content.includes("{{ANALYSIS_PROFILE}}") && ste.content.includes("{{OUTPUT_PROFILE}}"), true, !!ste);
    check("含机器标记契约（ste:matLang / ste:points / ste:readings）", !!ste && ste.content.includes("<!--ste:matLang=") && ste.content.includes("<!--ste:points=") && ste.content.includes("<!--ste:readings="), true, !!ste);
    check("含节标题语法硬约束（## 前缀 + 逐句解释 + 禁止【】代替）", !!ste && ste.content.includes("## 歧义点") && ste.content.includes("## 逐句解释") && ste.content.includes("## 多重解读") && ste.content.includes("## 术语") && ste.content.includes("禁止用【】"), true, !!ste);
    check("含四套节标题写法（中/繁中/英/日）", !!ste && ste.content.includes("## 歧義點") && ste.content.includes("## Ambiguity points") && ste.content.includes("## 曖昧な点"), true, !!ste);
    check("含编号标签本地化（第 1 句 / Sentence 1 / 第1文）", !!ste && ste.content.includes("Sentence 1") && ste.content.includes("第1文"), true, !!ste);
    check("含追问直答条款（【用户追问】在场时跳过全流程与机器标记）", !!ste && ste.content.includes("【用户追问】") && ste.content.includes("追问直答") && ste.content.includes("不输出机器标记"), true, !!ste);
    check("含 ASD-STE100 式 10 条硬约束块（短句/一句一义/完整句/主动语态/受控词汇/不增不减/保留情态/不重复/术语保真/逐句自查）", !!ste && ["【ASD-STE100 式硬约束", "1. 短句", "2. 一句一义", "3. 完整句", "4. 主动语态", "5. 受控词汇", "6. 不增不减", "7. 保留情态", "8. 不重复", "9. 术语保真", "10. 逐句自查"].every((k) => ste.content.includes(k)), true, !!ste);
    check("含逐句解释格式（外层 - 第 N 句 + 内层短句列表）", !!ste && ste.content.includes("- 第 N 句：") && ste.content.includes("简单句 1 句") && ste.content.includes("复杂句 3-5 句"), true, !!ste);
    check("歧义点只列语言表达障碍（禁止评审研究方法/样本量/证据强度）", !!ste && ste.content.includes("不是歧义、禁止列入") && ste.content.includes("研究方法是否严谨") && ste.content.includes("样本量大小") && ste.content.includes("证据强度"), true, !!ste);
    check("含歧义类别封闭集（10 个 key）", !!ste && ["polysemy", "pronoun-ref", "long-nesting", "hidden-agent", "negation-stack", "undefined-term", "register-mix", "quantity-vague", "idiom-figurative", "missing-condition"].every((k) => ste.content.includes(k)), true, !!ste);
    check("完整执行无门控（不出现「无需解读」类判定指令）", !!ste && !ste.content.includes("无需解读") && !ste.content.includes("判断是否值得"), true, !!ste);
    check("法务：允许引用标准名称，但不内嵌规范规则原文/词典词表", !!ste && ste.content.includes("ASD-STE100 式") && !ste.content.includes("Issue 9") && !ste.content.includes("approved word") && !ste.content.includes("受控词典"), true, !!ste);

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
    app.exit(fail === 0 ? 0 : 1); // D239：app.quit() 恒以 0 退出，process.exitCode 不生效
  }
});
