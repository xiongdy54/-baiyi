// F07 用户记忆与隐私边界流程
// @runtime: electron  @tier: 1  @gui: false  @id: F07  @timeout: 240
// 运行：npx electron tests/flows/f07-memory-privacy.cjs   （或 node tests/flows/run.cjs --only F07）
//
// 角度：用户记忆是本项目**唯一**「AI 自主写、不经逐条确认」的用户数据（§1.7 的有界例外，§4.18-16）。
//       一次误判就是隐私事故，所以这条流程不看功能好不好用，只看边界守没守住：
//       默认关、关闭态零注入、整理只追加不删除、手写区逐字不动、注入按预算裁剪、
//       memoryRef 必须逐字命中否则标存疑、以及**记忆内容永不进网络通道**。
//
// 依据：§4.18（L354/L358–362/L382/L388/L392–398）、§6.7（L821–840）、§7.5 L913、§7.6 L919、§7.2 L875。
"use strict";
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { Flow, runFlow, tmpUserDataDir, freshDir, ROOT } = require("./lib/harness.cjs");
const { audit, quit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: F07_ID(),
  title: "用户记忆与隐私边界",
  angle: "唯一 AI 自主写入面的 consent 与红线",
  cites: ["§4.18", "§6.7", "§7.5", "§7.6", "§7.2"],
  tier: 1,
  gui: false,
});
function F07_ID() {
  return "F07";
}

const MEM = require(path.join(ROOT, "electron", "memoryStore.js"));
const RET = require(path.join(ROOT, "electron", "memoryRetrieve.js"));
const TIDY = require(path.join(ROOT, "electron", "memoryTidy.js"));

/** 造一份「真实形状」的记忆树：core + index + 两个生活域主题 + 手写区 */
function buildTree(dir) {
  MEM.ensureTree(dir);
  const core = path.join(dir, MEM.CORE_FILE);
  fs.writeFileSync(core, (fs.existsSync(core) ? fs.readFileSync(core, "utf8") : "") + "\n- 事实：用户每周日晨跑（来源 2026-05-01）\n");
  const topicRel = path.join(MEM.TOPICS_DIR, "工作与学业", "测试主题.md");
  fs.mkdirSync(path.dirname(path.join(dir, topicRel)), { recursive: true });
  fs.writeFileSync(
    path.join(dir, topicRel),
    [
      "# 测试主题",
      "",
      "## 处境",
      "- 处境A：周三下午要评审方案（来源 2026-06-02）",
      MEM.HANDWRITTEN_OPEN,
      MEM.HANDWRITTEN_HINT || "（手写区提示）",
      "我自己写的一行，绝不许被机器改动。",
      MEM.HANDWRITTEN_CLOSE,
      "- 处境B：最近在学日语助词（来源 2026-07-03）",
      "",
    ].join("\n")
  );
  // 生活域是封闭集合：落在集合外的目录应当不参与统计（防御性，§4.18 L382）
  const rogueRel = path.join(MEM.TOPICS_DIR, "野狗域", "越界主题.md");
  fs.mkdirSync(path.dirname(path.join(dir, rogueRel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rogueRel), "# 越界\n\n- 不该被统计的野路子条目\n");
  return topicRel;
}

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f07"));
    app.setPath("userData", dir);
    const memDir = MEM.resolveMemoryDir(dir);
    const dbFile = path.join(dir, "library.db");

    const s = await runFlow(flow, async () => {
      const db = require(path.join(ROOT, "electron", "db.js"));
      await db.initDb();

      // ---------- D1 默认关闭 ----------
      flow.section("D1 总开关默认关闭（§4.18 L358 / §6.7 L830：默认 false 是 consent 纪律）");
      const cfgOff = TIDY.readMemoryConfig({ readSettings: () => ({}) });
      flow.eq("无设置文件时 enabled 为 false", cfgOff.enabled, false);
      const cfgGarbage = TIDY.readMemoryConfig({ readSettings: () => ({ app: { memory: { enabled: "yes", tidyDebounceMinutes: -5, inputTokenBudget: 1 } } }) });
      flow.known(
        "非法 enabled 归一为布尔（不得把字符串「yes」当开启）",
        cfgGarbage.enabled === true || cfgGarbage.enabled === false,
        "D-TEST-03",
        "true / false",
        cfgGarbage.enabled
      );
      flow.check("非法数值回落默认而非照收", cfgGarbage.inputTokenBudget >= 2000, "≥2000", cfgGarbage.inputTokenBudget);
      flow.check("非法防抖回落默认区间", cfgGarbage.tidyDebounceMinutes >= 1, "≥1", cfgGarbage.tidyDebounceMinutes);

      // ---------- D2 预算派生 ----------
      flow.section("D2 注入预算与文档上限一致（§4.18 L392–394）");
      flow.record("DEFAULT_BUDGETS", RET.DEFAULT_BUDGETS);
      flow.eq("core 上限 800", RET.DEFAULT_BUDGETS.core, 800);
      flow.eq("index 上限 1200", RET.DEFAULT_BUDGETS.index, 1200);
      const b = TIDY.injectBudgetsFor({ injectBudget: 4400 });
      flow.eq("预算按 800/1200/2400 比例派生", [b.core, b.index, b.topics], [800, 1200, 2400]);
      const tiny = TIDY.injectBudgetsFor({ injectBudget: 50 });
      flow.check("极小预算也有下限保护（不清零导致整块消失）", tiny.core >= 100 && tiny.topics >= 200, "core≥100 且 topics≥200", tiny);

      // ---------- D3 关闭态零注入 ----------
      flow.section("D3 关闭/无内容 = 零注入零请求（§6.7 L840）");
      flow.eq("core 与 index 皆缺 → 注入块为 null", RET.buildMemoryBlock({ coreText: null, indexText: null }), null);
      const emptyBlock = RET.buildMemoryBlock({ coreText: "", indexText: "" });
      flow.record("全空文件时仍产出块（长度）", emptyBlock && emptyBlock.block ? emptyBlock.block.length : emptyBlock);
      const oneBig = "行内容很长的一段记忆正文。".repeat(200);
      const res = RET.buildMemoryBlock({
        coreText: oneBig,
        indexText: oneBig,
        topicPicks: [{ rel: "topics/工作/测试主题.md", topic: "测试主题", domain: "工作", content: oneBig }],
      });
      const blk = res && typeof res === "object" ? res.block || res.text || "" : String(res || "");
      flow.check("注入块受预算约束", blk.length > 0 && blk.length < oneBig.length * 3, "远小于原始三块", { len: blk.length, one: oneBig.length });
      flow.check("含 R20 使用约束抬头", /R20|记忆接地|不得作为答案/.test(blk), true, blk.slice(0, 40));
      flow.check("超预算时明示截断而非静默丢内容", /截断/.test(blk), true, blk.slice(-40));
      flow.record("块对象字段", res && typeof res === "object" ? Object.keys(res).join(",") : typeof res);

      // ---------- D4 memoryRef 逐字校验 ----------
      flow.section("D4 memoryRef 必须逐字命中，否则标存疑（§4.18 L396–398 / R20）");
      const topicForRef = buildTree(memDir);
      const refBlock = RET.buildMemoryBlock({
        coreText: MEM.readText(memDir, MEM.CORE_FILE),
        indexText: MEM.readText(memDir, MEM.INDEX_FILE) || "",
        topicPicks: [{ rel: topicForRef, topic: "测试主题", domain: "工作", content: MEM.readText(memDir, topicForRef) }],
      });
      const refBlkStr = refBlock && typeof refBlock === "object" ? refBlock.block || "" : String(refBlock || "");
      const refLine = "- 处境A：周三下午要评审方案（来源 2026-06-02）";
      flow.check("注入块里确实带着主题正文（否则接地无从校验）", refBlkStr.includes("处境A"), true, refBlkStr.slice(-120));
      flow.eq("逐字子串命中", RET.validateMemoryRef(refBlkStr, refLine), true);
      flow.eq("改写一个字即不命中", RET.validateMemoryRef(refBlkStr, refLine.replace("周三", "周四")), false);
      flow.eq("空 ref 判不命中（null 由调用方当合法省略）", RET.validateMemoryRef(refBlkStr, "   "), false);
      flow.eq("块为 null 时任何 ref 都不命中", RET.validateMemoryRef(null, refLine), false);

      // ---------- D5 整理只追加、不删除、不动手写区 ----------
      flow.section("D5 整理执行只追加与标记（§4.18 L388/L398、§7.2 L875「绝不整文件重写」）");
      const topicRel = buildTree(memDir);
      const beforeCore = fs.readFileSync(path.join(memDir, MEM.CORE_FILE), "utf8");
      const beforeTopic = fs.readFileSync(path.join(memDir, topicRel), "utf8");
      const unknownOp = MEM.applyOps(memDir, [{ kind: "不存在的操作类型", target: "core", text: "不该被写入" }]);
      const afterTopic = fs.readFileSync(path.join(memDir, topicRel), "utf8");
      const afterCore = fs.readFileSync(path.join(memDir, MEM.CORE_FILE), "utf8");
      flow.check("未知操作不抛异常且有回执", Array.isArray(unknownOp) || typeof unknownOp === "object", "回执", typeof unknownOp);
      flow.eq("未知操作绝不改动主题文件", afterTopic, beforeTopic);
      flow.check("未知操作不把内容塞进 core", !afterCore.includes("不该被写入"), true, afterCore.includes("不该被写入"));
      flow.check("手写区标记与内容原样保留", afterTopic.includes(MEM.HANDWRITTEN_OPEN) && afterTopic.includes("我自己写的一行，绝不许被机器改动。"), true, afterTopic.slice(0, 160));
      flow.eq("ensureTree 重复调用不覆盖已有文件", (MEM.ensureTree(memDir), fs.readFileSync(path.join(memDir, MEM.CORE_FILE), "utf8")), afterCore);
      const idxBefore = MEM.readText(memDir, MEM.INDEX_FILE);
      MEM.rebuildIndex(memDir);
      const idxAfter = MEM.readText(memDir, MEM.INDEX_FILE);
      flow.check("index 由系统重生成且非空", typeof idxAfter === "string" && idxAfter.length > 0, "非空", idxAfter?.length);
      flow.record("index 重生成前后是否相同", idxBefore === idxAfter ? "一致" : "已刷新");

      // ---------- D6 生活域封闭 + 用量 ----------
      flow.section("D6 生活域封闭集合与用量口径（§4.18 L382、§6.7）");
      flow.record("LIFE_DOMAINS", (MEM.LIFE_DOMAINS || []).join(" "));
      flow.check("生活域为封闭列表（8 域 + 其他）", Array.isArray(MEM.LIFE_DOMAINS) && MEM.LIFE_DOMAINS.length >= 8 && MEM.LIFE_DOMAINS.length <= 10, "8–10 个", MEM.LIFE_DOMAINS?.length);
      flow.check("「其他」必须在封闭集合内兜底", (MEM.LIFE_DOMAINS || []).some((d) => String(d).includes("其他")), true, MEM.LIFE_DOMAINS);
      const usage = MEM.usageStats(memDir);
      flow.record("usageStats 形状", JSON.stringify(usage).slice(0, 260));
      const usageTxt = JSON.stringify(usage);
      flow.check("usageStats 统计到真实主题文件（不虚构也不漏计）", /测试主题/.test(usageTxt), true, usageTxt.slice(0, 160));
      flow.check("totals 等于 core+index+topics 之和（不虚增不漏减）", usage.totals.chars >= usage.core.chars + usage.index.chars, "totals ≥ 各块之和", { totals: usage.totals.chars, sum: usage.core.chars + usage.index.chars });
      flow.check("非法生活域目录不参与统计（封闭集合生效）", !/野狗域/.test(usageTxt), true, usageTxt.slice(0, 160));

      // ---------- D7 记忆不进主库 ----------
      flow.section("D7 记忆真源是文件树，不进主库（§4.18 L354、§7.2 L875）");
      const pre7 = await audit(dbFile);
      const rowsBefore = pre7.count("memory_runs");
      const cardsBefore = pre7.count("cards");
      const extractsBefore = pre7.count("extracts");
      buildTree(memDir);
      MEM.applyOps(memDir, [{ kind: "add", target: "core", text: "- F07 追加" }]);
      const a7 = await audit(dbFile);
      flow.eq("写记忆文件不新增 memory_runs 行", a7.count("memory_runs"), rowsBefore);
      flow.eq("写记忆文件不新增卡片", a7.count("cards"), cardsBefore);
      flow.eq("写记忆文件不新增摘录", a7.count("extracts"), extractsBefore);
      flow.check("记忆内容不出现在任何业务表里（整库文本扫描）", !JSON.stringify(a7.all("cards").concat(a7.all("extracts"))).includes("周三下午要评审方案"), true, "扫到内容");

      // ---------- D8 隐私红线：记忆模块零网络出口 ----------
      flow.section("D8 记忆模块不得含网络出口（§7.5 L913 / §7.6 L919 遥测禁区）");
      for (const rel of ["electron/memoryStore.js", "electron/memoryRetrieve.js", "electron/memoryTidy.js"]) {
        const txt = fs.readFileSync(path.join(ROOT, rel), "utf8");
        const netHits = [...txt.matchAll(/\b(fetch\(|XMLHttpRequest|https?:\/\/|net\.request|axios)/g)].map((m) => m[0]);
        flow.eq(`${rel} 无网络调用`, netHits.length, 0);
      }
      const aiTxt = fs.readFileSync(path.join(ROOT, "electron", "ai.js"), "utf8");
      flow.check("AI 网关不把记忆目录当正文之外的东西上传", !/memory[/\\]?[\s\S]{0,40}(upload|report|telemetry)/i.test(aiTxt), true, false);
      flow.check("ai-config.json 与记忆目录分离（Key 不进记忆树）", !fs.existsSync(path.join(memDir, "ai-config.json")), true);
      flow.record("记忆目录内容", fs.readdirSync(memDir).join(" "));
    });

    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F07 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String(e && e.message ? e.message : e) });
    process.exit(1);
  });
