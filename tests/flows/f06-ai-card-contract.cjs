// F06 AI 制卡契约与闸门流程（提示词/lint/键规则的静态与播种契约）
// @runtime: electron  @tier: 1  @gui: false  @id: F06  @timeout: 240
// 运行：npx electron tests/flows/f06-ai-card-contract.cjs   （或 node tests/flows/run.cjs --only F06）
//
// 角度：AI 制卡是本项目唯一「外部智能体往用户知识库里写东西」的入口，也是最容易悄悄失守的地方。
//       这条流程**不联网**，只验证闸门本身：播种幂等、默认版本唯一、scope 白名单封闭、
//       原则文本不被复制进代码、键规则确定、Lint 规则编号集合与文档一致。
//       既有 m1.prompts / m7.prompts 只验个别 scope 的个别条款；这里验的是**集合层面的封闭性**——
//       新增/丢失/重复播种这类结构性漂移只有全量口径才看得见。
//
// 依据：§6.3.1 L549（scope 白名单）、§6.3.2 L553（批量与每知识点张数）、§6.3.4 L561（版本化播种）、
//       §6.3.5 L565–583（L1>L16 编号、无 L15）、§4.16 L326–329（sibling_key 确定性）、
//       §7.4 L898（改提示词先改文档、旧版留痕）、§7.1.3 L857（提示词不许写死在代码里）、
//       §4.18 L382/R20（记忆接地只允许 situationRequired 的 scope）。
"use strict";
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { Flow, runFlow, tmpUserDataDir, freshDir, ROOT } = require("./lib/harness.cjs");
const { audit, quit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F06",
  title: "AI 制卡契约与闸门",
  angle: "外部智能体写入面的播种幂等与集合封闭性",
  cites: ["§6.3.1", "§6.3.4", "§6.3.5", "§4.16", "§7.1.3", "§7.4", "§4.18"],
  tier: 1,
  gui: false,
});

/** 指南 §6.3.1 L549 锁定的制卡族 scope（白名单，闭包检查用） */
const CARD_SCOPES = new Set([
  "card-generation", "card-formula", "card-seq", "card-enum", "card-mnemonic",
  "card-contrast", "card-wording", "card-basic", "card-occlusion", "card-vocab",
  "card-literature",
]);
/** §6.3.5 + m1 实测：文档明写 L15 已于同日删除，任何重新出现都是回归 */
const FORBIDDEN_RULE_IDS = ["L15"];
/** R20 只允许出现在需要情境的 scope；这两个文档明写「R20 不适用」 */
const R20_EXEMPT = ["card-vocab", "card-literature", "card-basic", "card-wording"];

function readSrc(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f06"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");

    const s = await runFlow(flow, async () => {
      const db = require(path.join(ROOT, "electron", "db.js"));
      await db.initDb();

      // ---------- A1 播种的集合封闭性 ----------
      flow.section("A1 提示词播种：默认唯一 + 白名单封闭（§6.3.1 L549 / §7.4 L898）");
      let aud = await audit(dbFile);
      let rows = aud.all("prompt_templates");
      flow.record("播种行数", rows.length);
      const scopes = [...new Set(rows.map((r) => r.scope))].sort();
      flow.record("scope 集合", scopes.join(" "));
      const byScope = new Map();
      for (const r of rows) {
        if (!byScope.has(r.scope)) byScope.set(r.scope, []);
        byScope.get(r.scope).push(r);
      }
      const multiDefault = [...byScope.entries()].filter(([, v]) => v.filter((x) => x.is_default).length !== 1).map(([k]) => k);
      // is_default 恒为 1（播种全写 1、无人置 0）→ 该列不承载信息；靠 version DESC 侥幸取对
      // 批次 E（D-TEST-02，语义①）：播种后做一次幂等订正，每个 scope 只有最高 version 留 1。
      flow.check(
        "每个 scope 恰有一个默认版本",
        multiDefault.length === 0,
        "无异常",
        multiDefault
      );
      // 新增：默认行必须就是最高 version 那一行（不是"随便挑一行当默认"）
      const defNotMax = [...byScope.entries()]
        .filter(([, v]) => {
          const defs = v.filter((x) => x.is_default);
          return defs.length !== 1 || defs[0].version !== Math.max(...v.map((r) => r.version));
        })
        .map(([k, v]) => `${k}(${v.map((r) => `v${r.version}:${r.is_default}`).join(",")})`);
      flow.check("默认行 = 该 scope 内最高 version 那一行（逐 scope）", defNotMax.length === 0, "全部对齐", defNotMax.slice(0, 3));
      flow.eq("订正是幂等的：默认行总数 == scope 数", rows.filter((r) => r.is_default).length, byScope.size);
      const defPick = db.getPromptTemplate("card-occlusion");
      const maxVer = Math.max(...(byScope.get("card-occlusion") || []).map((r) => r.version));
      flow.eq("运行期实际取到的是最新版（version DESC 兜住了歧义 default）", defPick?.version, maxVer);
      flow.record("card-occlusion 版本集合", (byScope.get("card-occlusion") || []).map((r) => `v${r.version}:default=${r.is_default}`).join(" "));
      flow.record("全新库是否含 §7.4 D26 的 v2 候选行", (byScope.get("card-occlusion") || []).some((r) => r.version === 2) ? "有" : "无（v2 只在升级路径出现，与文档口径有漂移）");
      const dupVersion = [...byScope.entries()].filter(([, v]) => new Set(v.map((x) => `${x.scope}@${x.version}`)).size !== v.length).map(([k]) => k);
      flow.check("同 scope 内版本号不重复（旧版留痕不冲突）", dupVersion.length === 0, "无重复", dupVersion);
      const empty = rows.filter((r) => !r.content || String(r.content).trim().length < 40).map((r) => r.scope);
      flow.check("默认模板正文非空壳", empty.length === 0, "无空模板", empty);
      const badVer = rows.filter((r) => !Number.isInteger(r.version) || r.version < 1).map((r) => r.scope);
      flow.check("版本号一律为正整数", badVer.length === 0, "全部合规", badVer);
      const missingCard = [...CARD_SCOPES].filter((sc) => !byScope.has(sc));
      flow.check("§6.3.1 白名单内 11 个制卡 scope 全部已播种", missingCard.length === 0, "无缺失", missingCard);
      const unexpected = scopes.filter((sc) => !CARD_SCOPES.has(sc));
      flow.record("制卡族之外的 scope", unexpected.join(" ") || "（无）");

      // ---------- A2 播种幂等 ----------
      flow.section("A2 重复播种幂等（§7.4 L898「低于目标版本插入新版，旧版留痕」）");
      const before = rows.length;
      db.ensurePromptTemplates();
      db.ensurePromptTemplates();
      db.persistNow();
      aud = await audit(dbFile);
      const after = aud.all("prompt_templates");
      flow.eq("连播两次不新增任何行", after.length, before);
      flow.eq("连播两次不改变默认指针", [...new Set(after.filter((r) => r.is_default).map((r) => r.scope))].sort().join(","), scopes.filter((sc) => byScope.get(sc).some((r) => r.is_default)).sort().join(","));

      // ---------- A3 原则文本不复制进代码 ----------
      flow.section("A3 提示词不写死在业务代码里（§7.1.3 L857）");
      const marker = "你是间隔重复制卡专家";
      const hits = [];
      const walk = (d) => {
        for (const name of fs.readdirSync(d)) {
          if (["node_modules", "dist", "build", ".git", "vendor", "tests", "design-samples", "docs", "prompt-lab"].includes(name)) continue;
          const full = path.join(d, name);
          const st = fs.statSync(full);
          if (st.isDirectory()) walk(full);
          else if (/\.(ts|tsx|js|cjs|mjs)$/.test(name)) {
            const txt = fs.readFileSync(full, "utf8");
            if (txt.includes(marker)) hits.push(path.relative(ROOT, full));
          }
        }
      };
      walk(ROOT);
      flow.check("主制卡原则文本只存在于 electron/prompts.js", hits.every((h) => h.replace(/\\/g, "/") === "electron/prompts.js"), "仅 prompts.js", hits);

      // ---------- A4 Lint 规则集合 ----------
      flow.section("A4 CardLint 规则编号集合（§6.3.5 L565–585）");
      const cardsTxt = readSrc("src/lib/cards.ts");
      const ids = new Set([...cardsTxt.matchAll(/ruleId:\s*"(L\d+|S\d+)"/g)].map((m) => m[1]));
      flow.record("代码中出现的规则编号", [...ids].sort().join(" "));
      const forbidden = FORBIDDEN_RULE_IDS.filter((f) => ids.has(f));
      flow.check("已废弃的 L15 绝不复活（§6.3.5 L585 同日删除）", forbidden.length === 0, "无 L15", forbidden);
      const outOfRange = [...ids].filter((x) => /^L/.test(x) && (Number(x.slice(1)) < 1 || Number(x.slice(1)) > 16));
      flow.check("规则编号不越出 L1–L16 区间", outOfRange.length === 0, "全部在区间内", outOfRange);
      flow.record("L1–L16 中代码未直接标号的（可能由 K 系列/其他文件承担）", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16].map((n) => `L${n}`).filter((x) => !ids.has(x)).join(" ") || "（无）");

      // ---------- A5 键规则确定性 ----------
      flow.section("A5 sibling_key 确定性（§4.16 L326–329）");
      const bundle = require(path.join(ROOT, "tests", "m12.cards.bundle.cjs"));
      const sib = bundle.siblingKeyFor || bundle.default?.siblingKeyFor;
      flow.guard("bundle 暴露 siblingKeyFor", () => typeof sib === "function");
      const docId = "doc-" + flow.rng.seed;
      const k1 = sib({ contextRef: { documentId: docId, extractId: "ex-1" }, sourceText: "短选区" });
      const k2 = sib({ contextRef: { documentId: docId, extractId: "ex-1" }, sourceText: "短选区" });
      flow.eq("同输入必同键（确定性，不掺随机/相似度）", k1, k2);
      flow.check("短选区建 src: 组键", typeof k1 === "string" && k1.startsWith(`src:${docId}:`), `src:${docId}:…`, k1);
      const longKey = sib({ contextRef: { documentId: docId, extractId: "ex-1" }, sourceText: "长".repeat(301) });
      flow.eq("超 300 字符长选区不建键（避免「每天只准学一张」阻塞）", longKey, null);
      const actKey = sib({ explicitKey: "act:node-9" });
      flow.eq("显式结构键原样采用", actKey, "act:node-9");
      const splitKey = sib({ splitCount: 3, genId: () => "FIXED" });
      flow.eq("per-blank 拆卡无锚点也建组", splitKey, "act:split-FIXED");
      const noAnchor = sib({ contextRef: null, sourceText: "x" });
      flow.eq("既无文档又无拆卡 → 不建组", noAnchor, null);
      const h1 = sib({ contextRef: { documentId: "d", anchorText: "同一段锚文本" }, sourceText: "短" });
      const h2 = sib({ contextRef: { documentId: "d", anchorText: "同一段锚文本" }, sourceText: "短" });
      flow.eq("无 extractId 时按锚文本哈希，同锚同键", h1, h2);

      // ---------- A6 制卡张数与批量上限 ----------
      flow.section("A6 批量与每知识点张数上限（§6.3.2 L553）");
      const promptsTxt = readSrc("electron/prompts.js");
      flow.check("主制卡提示词写死 2–4 张引导", /2\s*[–-]\s*4/.test(promptsTxt) || /两到四|2-4|2~4/.test(promptsTxt), "含 2–4 表述", "未找到");
      flow.check("主制卡提示词含批量上限 10 约束", /(不超过|≤|最多)\s*10|10\s*张/.test(promptsTxt), "含 ≤10 表述", "未找到");

      // ---------- A7 R20 接地白名单 ----------
      flow.section("A7 R20 记忆接地只给需要情境的 scope（§4.18 L382 / R20 白名单）");
      const kp = require(path.join(ROOT, "electron", "kpScopes.js"));
      flow.record("kpScopes 导出", Object.keys(kp).join(" "));
      for (const sc of R20_EXEMPT) {
        const def = [...byScope.get(sc) || []].find((r) => r.is_default);
        if (!def) continue;
        const body = String(def.content);
        const claimsGrounding = /必须接地|一律注入记忆|情境必须来自记忆/.test(body);
        flow.check(`${sc} 不得要求记忆接地`, !claimsGrounding, "无接地要求", claimsGrounding);
      }
      const gen = (byScope.get("card-generation") || []).find((r) => r.is_default);
      flow.check("主制卡模板含 R20 记忆接地条款", /R20|记忆接地/.test(String(gen?.content || "")), true, /R20|记忆接地/.test(String(gen?.content || "")));
      flow.check("输出契约字段 memoryRef 在主模板中声明", /memoryRef/.test(String(gen?.content || "")), true, false);
    });

    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F06 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String(e && e.message ? e.message : e) });
    process.exit(1);
  });
