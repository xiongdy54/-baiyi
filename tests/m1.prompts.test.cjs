// M1 提示词播种回归（v31 定基线；v46/UM-2 升 v7：R20 记忆情境接地段 + situation_required 声明位）。
// 运行：node_modules/.bin/electron tests/m1.prompts.test.cjs
// 隔离 userData：必须在 require electron/db.js 之前 setPath，避免触碰真实库。
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), "m1-prompts-"));
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

    console.log("== P1 全新库：card-literature 播种专用文学模板（v7 = v6 专用模板 + R20 不适用段） ==");
    const lit = db.getPromptTemplate("card-literature");
    check("card-literature 最新版本 = 7", !!lit && lit.version === 7, 7, lit && lit.version);
    check("内容为专用文学模板（含 L1 逐句全覆盖骨架）", !!lit && lit.content.includes("L1 续写卡为骨架"), "含 L1", lit && lit.content.slice(0, 40));
    check("内容 ≠ 序列模板（不再由 card-seq 承接）", !!lit && lit.content !== prompts.CARD_SEQ_PROMPT, "≠seq", !!lit && lit.content === prompts.CARD_SEQ_PROMPT);
    check("内容与 CARD_LITERATURE_PROMPT 字面一致", !!lit && lit.content === prompts.CARD_LITERATURE_PROMPT, "==CARD_LITERATURE_PROMPT", false);
    check("v7 内容含 R20 段且注明不适用", !!lit && lit.content.includes("记忆情境接地（R20）——本卡型不适用"), "含 R20 NA 段", false);
    check("situation_required = 0（文学卡不需要现实情境）", !!lit && Number(lit.situation_required) === 0, 0, lit && lit.situation_required);
    const genSit = db.getPromptTemplate("card-generation");
    check("card-generation situation_required = 1（R15 应用卡需要情境）", !!genSit && Number(genSit.situation_required) === 1, 1, genSit && genSit.situation_required);
    const probeSit = db.getPromptTemplate("knowledge-probe");
    check("knowledge-probe situation_required = 1（v44 R20 原则制：探针 application/transfer 维）", !!probeSit && Number(probeSit.situation_required) === 1, 1, probeSit && probeSit.situation_required);
    const insightSit = db.getPromptTemplate("journal-insight");
    check("journal-insight situation_required = 0（直接消费日记原文，注入冗余）", !!insightSit && Number(insightSit.situation_required) === 0, 0, insightSit && insightSit.situation_required);

    console.log("== P2 存量库升级路径：v6 行（UM-1 前基线）→ 补播 v7 新内容 ==");
    // 还原 UM-2 之前库状态：card-generation / card-literature 只有 v6 行
    db.execRawSql("DELETE FROM prompt_templates WHERE scope = 'card-generation'");
    db.execRawSql("DELETE FROM prompt_templates WHERE scope = 'card-literature'");
    db.execRawSql(
      "INSERT INTO prompt_templates (id, scope, name, content, version, is_default, situation_required, created_at) VALUES (?, 'card-generation', '主制卡 v6（旧）', ?, 6, 1, 1, ?)",
      ["sim-gen-v6", "OLD-V6-CONTENT", Date.now()]
    );
    db.execRawSql(
      "INSERT INTO prompt_templates (id, scope, name, content, version, is_default, situation_required, created_at) VALUES (?, 'card-literature', '文学/诗歌背诵 v6', ?, 6, 1, 0, ?)",
      ["sim-lit-v6", "OLD-LIT-V6-CONTENT", Date.now()]
    );
    check("还原成功：card-generation 停在 v6", db.getPromptTemplate("card-generation").version === 6, 6, db.getPromptTemplate("card-generation").version);
    db.ensurePromptTemplates();
    const gen2 = db.getPromptTemplate("card-generation");
    const lit2 = db.getPromptTemplate("card-literature");
    check("存量库 card-generation 补播 v7", gen2.version === 7, 7, gen2.version);
    check("存量库 v7 内容已取消 G9（无「退出红线」）", !gen2.content.includes("退出红线"), "无 G9", gen2.content.includes("退出红线"));
    check("存量库 v7 内容含「不做空」表述与 R20 情境段",
      gen2.content.includes("不做空") && gen2.content.includes("记忆情境接地（R20"), "含不做空+R20", false);
    check("存量库 v7 内容含 memoryRef 输出契约", gen2.content.includes("memoryRef"), "含 memoryRef", false);
    check("补播行 situation_required = 1（随播种写入）", Number(gen2.situation_required) === 1, 1, gen2.situation_required);
    check("存量库 card-literature 补播 v7 专用模板", lit2.version === 7 && lit2.content === prompts.CARD_LITERATURE_PROMPT, "v7 专用", `${lit2.version}/${lit2.content === prompts.CARD_LITERATURE_PROMPT}`);
    check("旧 v6 行保留留痕（不覆盖）", db.listPromptTemplates().filter((t) => t.scope === "card-literature").length === 2, 2, db.listPromptTemplates().filter((t) => t.scope === "card-literature").length);

    console.log("== P3 幂等：重复 ensurePromptTemplates 不再插入 ==");
    const beforeCount = db.listPromptTemplates().length;
    db.ensurePromptTemplates();
    check("重复播种不新增行（幂等）", db.listPromptTemplates().length === beforeCount, beforeCount, db.listPromptTemplates().length);

    console.log("== P4 主制卡 v7 内容抽查（G6/G7 对齐；R18 无数字门槛；R20 记忆接地契约） ==");
    const gen = db.getPromptTemplate("card-generation").content;
    check("R18 已取消数字硬性门槛（无 ≥2 计数、无 L15 引用）",
      !gen.includes("≥2 个阿拉伯数字") && !gen.includes("L15"), "无硬性门槛", false);
    check("R5 含可字面判定合格线要求（对齐 L16）", gen.includes("可字面判定"), "含可字面判定", false);
    check("R19 含可字面识别归属措辞要求", gen.includes("可字面识别"), "含可字面识别", false);
    check("R20 拒用铁律在案（答案来自材料 / 无贴合必须省略 / memoryRef 逐字抄录）",
      gen.includes("必须来自材料") && gen.includes("宁缺毋滥") && gen.includes("逐字抄录"), "含 R20 三条款", false);

      // v48.5 批C：card-structure 结构制卡分支播种（导图节点「就此制卡」专用；auto 不路由）
  {
    const tpl = db.getPromptTemplate("card-structure");
    check("P-card-structure 播种 v1", tpl && tpl.version === 1, tpl && tpl.version);
    check("P-card-structure 契约抽查（结构关系枚举/禁事实退化/答案可推导）", tpl && tpl.content.includes("结构关系：") && tpl.content.includes("parent-child") && tpl.content.includes("禁止把结构卡退化成普通知识卡") && tpl.content.includes("完全可从结构语义包推导"), tpl && tpl.content.slice(0, 80));
    check("P-card-structure situationRequired=0（无情境语义）", tpl && Number(tpl.situation_required) === 0, tpl && tpl.situation_required);
  }

  console.log(`\nM1 提示词播种测试完成：${pass} 通过 / ${fail} 失败`);
  } catch (err) {
    fail++;
    console.error("  ✗ 测试异常：", err && err.stack ? err.stack : err);
  } finally {
    try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch {}
    process.exit(fail > 0 ? 1 : 0);
  }
});
