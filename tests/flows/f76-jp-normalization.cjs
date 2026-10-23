// F76 日文/全半角写法等价性与检索命中一致性（查询侧归一 vs 存储侧原样）
// @runtime: electron  @tier: 1  @gui: false  @id: F76  @timeout: 240
// 运行：npx electron tests/flows/f76-jp-normalization.cjs
//
// 起因：用户的真实用法是从 Yomitan/OCR/剪贴板取日文文本做卡与日记，而这些来源给出的
// 写法并不唯一：ガ 可以是 U+30AC（合成）、カ+U+3099（分解）、ｶﾞ（半角片假名+半角浊点）；
// 数字可以是 ２０２６（全角）或 2026（半角）。
// db.js 的两处检索（listJournalEntries:2604、listKnowledgePoints:2846）都只做
// `query.trim().normalize("NFKC")` 然后拿去 LIKE **原样存储**的列 —— 查询侧归一、存储侧不归一，
// 这个不对称就是本条要量的东西。
// 纪律：① 只用 fromCodePoint 构造码点，避免源码里的可见字符被编辑器悄悄归一；
//       ② 每格都配正向对照（ASCII 大小写、合成形查合成形），对照不成立就不下结论；
//       ③ 判红之前先回读盘上原始码点，确认"存储侧确实没归一"这个前提成立。
"use strict";
const path = require("path");
const { app } = require("electron");
const { Flow, runFlow, ROOT, tmpUserDataDir, freshDir } = require("./lib/harness.cjs");
const { audit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F76",
  title: "日文写法等价性与检索命中",
  angle: "同一词的合成/分解/半角/全角四种写法，能否互相检索到（查询侧 NFKC、存储侧原样的不对称）",
  cites: ["§4.16", "§7.1.3", "D-TEST-10"],
  tier: 1,
  gui: false,
});

const C = (...a) => String.fromCodePoint(...a);
// 写法变体（键名即"用户输入时看到的样子"）
const V = {
  合成ガ: C(0x30ac),
  分解ガ: C(0x30ab, 0x3099),
  半角ガ: C(0xff76, 0xff9e),
  全角数字: C(0xff12, 0xff10, 0xff12, 0xff16),
  半角数字: "2026",
  ASCII: "DOJO",
};
const cps = (s) => [...s].map((ch) => "U+" + ch.codePointAt(0).toString(16).toUpperCase()).join(" ");
// 查询词：与变体一一对应（用哪种写法去查）
const Q = {
  用合成形查: C(0x30ac),
  用分解形查: C(0x30ab, 0x3099),
  用半角形查: C(0xff76, 0xff9e),
  用半角数字查: "2026",
  用全角数字查: C(0xff12, 0xff10, 0xff12, 0xff16),
  用小写ascii查: "dojo",
};
// 每个查询"按设计应当命中"的变体集合（NFKC 等价类内互通）
const SHOULD = {
  用合成形查: ["合成ガ", "分解ガ", "半角ガ"],
  用分解形查: ["合成ガ", "分解ガ", "半角ガ"],
  用半角形查: ["合成ガ", "分解ガ", "半角ガ"],
  用半角数字查: ["全角数字", "半角数字"],
  用全角数字查: ["全角数字", "半角数字"],
  用小写ascii查: ["ASCII"],
};

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f76"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");
    const db = require(path.join(ROOT, "electron", "db.js"));
    await db.initDb();

    await runFlow(flow, async () => {
      const item = db.createFromPaste("F76 写法等价性书", "# 章\n\n为归一化不对称而造的场景。\n");
      const itemId = item && (item.id || (item.item && item.item.id));

      /* 每种写法各存一条日记 + 一个知识点，前缀标记用于归属 */
      const marker = {};
      for (const [k, v] of Object.entries(V)) {
        marker[k] = `[K${Object.keys(V).indexOf(k)}]`;
        db.createJournalEntry({ contentMarkdown: `${marker[k]} ${v} 句末`, source: "app" });
        db.createKnowledgePoint({ canonicalLabel: `${marker[k]} ${v}` });
      }
      db.persistNow();

      flow.section("S0 前提校验：回读盘上原始码点，确认存储侧没有被归一");
      const a = await audit(dbFile);
      const stored = a.rows("SELECT content_markdown AS m FROM journal_entries WHERE is_deleted=0");
      a.close();
      const landed = {};
      for (const [k] of Object.entries(V)) {
        const row = stored.find((r) => String(r.m || "").includes(marker[k]));
        const body = row ? String(row.m).replace(marker[k], "").replace(/^ /, "").replace(/ 句末$/, "") : null;
        landed[k] = body === null ? "未落盘" : cps(body);
      }
      for (const [k, v] of Object.entries(V)) {
        flow.record(`盘上「${k}」`, `${landed[k]}${landed[k] === cps(v) ? " ＝ 原样保留" : " ≠ 我写入的 " + cps(v)}`);
      }
      const rawKept = Object.entries(V).every(([k, v]) => landed[k] === cps(v));
      flow.check("存储侧原样保留（未归一）⇒ 本条的不对称前提成立", rawKept, "逐字保留", rawKept ? "是" : "有变体被改写过，见上");

      /* ── 正向对照：LIKE 与 ASCII 大小写必须先证明可用 ───────────── */
      flow.section("S1 正向对照：合成形查合成形、小写查大写，必须命中（否则下面的红不成立）");
      const jAll = db.listJournalEntries({ limit: 500 });
      const hitsOf = (q) => {
        const r = db.listJournalEntries({ query: q, limit: 500 });
        const list = Array.isArray(r) ? r : r?.entries || r?.rows || [];
        return list.map((e) => e.contentMarkdown || e.content_markdown || "").filter(Boolean);
      };
      flow.record("无查询时日记条数", (Array.isArray(jAll) ? jAll.length : jAll?.entries?.length ?? "?") + " 条（写入 " + Object.keys(V).length + " 条）");
      const c1 = hitsOf(V.合成ガ).some((m) => m.includes(marker["合成ガ"]));
      const c2 = hitsOf("dojo").some((m) => m.includes(marker.ASCII));
      flow.check("对照 A：用合成ガ 查合成ガ 必须命中", c1, "命中", c1 ? "命中" : "未命中");
      flow.check("对照 B：小写 dojo 查大写 DOJO 必须命中（SQLite LIKE 对 ASCII 大小写不敏感）", c2, "命中", c2 ? "命中" : "未命中");
      if (!c1 || !c2) {
        flow.record("对照不成立", "LIKE 通道本身有问题 ⇒ 本条后续判定全部作废，不据此下结论");
        return;
      }

      /* ── S2 日记检索矩阵 ───────────────────────────────────────── */
      flow.section("S2 日记检索：六种写法 × 六种查询，看 NFKC 等价类能否互通");
      const miss = [];
      for (const [qn, q] of Object.entries(Q)) {
        const got = hitsOf(q);
        flow.record(`${qn} 原始返回`, `${got.length} 条：${got.map((m) => cps(m).slice(0, 46) + "…").join(" | ") || "无"}`);
        const hitKeys = Object.keys(V).filter((k) => got.some((m) => m.includes(marker[k])));
        const want = SHOULD[qn];
        const lost = want.filter((k) => !hitKeys.includes(k));
        flow.record(`${qn}（NFKC 后 ${cps(q)}）`, `命中 ${hitKeys.join("、") || "无"}${lost.length ? " ⇒ 同义写法查不到：" + lost.join("、") : ""}`);
        if (lost.length) miss.push(`${qn} 查不到 ${lost.join("、")}`);
      }
      flow.check("同一词的 NFKC 等价写法应能互相检索到（日记）", miss.length === 0, "0 组互查失败", miss.join(" ||| ") || "全通");

      /* ── S3 知识点检索矩阵（同一套归一代码的另一处调用点）───────── */
      flow.section("S3 知识点检索：canonical_label 走同一套查询侧归一");
      const kHitsOf = (q) => {
        const r = db.listKnowledgePoints({ query: q, limit: 500 });
        const list = Array.isArray(r) ? r : r?.points || r?.rows || [];
        return list.map((e) => e.canonicalLabel || e.canonical_label || e.label || "").filter(Boolean);
      };
      const probe = kHitsOf(V.合成ガ);
      flow.record("用合成ガ 查知识点", `返回 ${probe.length} 条：${probe.map((s) => cps(s).slice(0, 40)).join(" | ") || "无"}`);
      if (!probe.length) {
        flow.record("知识点侧结论", "查询未命中任何 KP ⇒ 先确认 createKnowledgePoint 的字段名对不对（本条不猜结论）");
      } else {
        const kLost = [];
        for (const [qn, q] of Object.entries(Q)) {
          const got = kHitsOf(q);
          const hitKeys = Object.keys(V).filter((k) => got.some((m) => m.includes(marker[k])));
          const lost = SHOULD[qn].filter((k) => !hitKeys.includes(k));
          flow.record(`KP ${qn}`, `命中 ${hitKeys.join("、") || "无"}${lost.length ? " ⇒ 查不到 " + lost.join("、") : ""}`);
          if (lost.length) kLost.push(`${qn} 查不到 ${lost.join("、")}`);
        }
        flow.check("同一词的 NFKC 等价写法应能互相检索到（知识点）", kLost.length === 0, "0 组互查失败", kLost.join(" ||| ") || "全通");
      }

      /* ── S4 归一实现口径是否真的一致（源码注释自称"同一口径"）───── */
      flow.section("S4 检索折叠与 KP 去重键的口径关系（v48.21 起为显式契约）");
      const kpNorm = require(path.join(ROOT, "electron", "kpNorm.js"));
      const fold = db.foldSearch; // 产品里真实的那一个（原来是测试自己拼的表达式，改了产品也测不出来）
      const sample = C(0xff21) + "BC" + C(0x30ab, 0x3099) + "Ｂ"; // ＡBCカ゛Ｂ
      flow.record("输入", `${sample} = ${cps(sample)}`);
      flow.record("db.foldSearch（检索折叠，已导出）", cps(fold(sample)));
      flow.record("kpNorm.normalizeKpLabel（KP 去重键）", cps(kpNorm.normalizeKpLabel(sample)));
      // 契约：两者都必须做 NFKC + 大小写折叠（这是"等价写法互通"的公共前提）；
      // 允许的差异只在"是否去掉标点与空白"——去重键要"同一标签的不同写法归一"，检索折叠不该动正文字符。
      const kana = C(0x30ab, 0x3099);
      const digits = C(0xff12, 0xff10, 0xff12, 0xff16);
      flow.check("检索折叠必须折叠分解浊点与全角数字（等价写法互通的前提）", fold(kana) === C(0x30ac) && fold(digits) === "2026", `ガ / 2026`, `${cps(fold(kana))} / ${cps(fold(digits))}`);
      flow.check("KP 去重键同样必须折叠浊点（同一标签的两种写法要归一）", kpNorm.normalizeKpLabel(kana) === C(0x30ac), cps(C(0x30ac)), cps(kpNorm.normalizeKpLabel(kana)));
      flow.check("两者都必须折叠 ASCII 大小写", fold("ABC") === "abc" && kpNorm.normalizeKpLabel("ABC") === "abc", "abc", `${fold("ABC")} / ${kpNorm.normalizeKpLabel("ABC")}`);
      flow.record("允许的差异", "检索折叠保留标点与空白（正文匹配不该动字符）；KP 去重键额外去掉标点/空白（同标签不同写法归一）。二者目的不同，不再要求逐字相同");

      flow.section("S5 检索列覆盖面：language_variants_json 是否参与查询");
      flow.record("源码事实", "listKnowledgePoints:2848 只对 canonical_label 与 alias_json 做 LIKE；" +
        "knowledge_points 表另有 language_variants_json 列（db.js:2875 的 INSERT 列表里），检索完全不查它 ⇒ " +
        "把异体写法登记进该列也不会被搜到");
      flow.record("未覆盖", "卡片正文的检索在渲染层做（listAllCards 不收参数，见 D-TEST-65 的更正），" +
        "本条只量了主进程侧两处；卡片浏览的日文检索需要另开 GUI 流程");
    });
  })
  .catch((e) => {
    flow.check("流程未崩溃", false, "不抛", String((e && e.stack) || e).slice(0, 400));
    process.exitCode = 1;
  })
  // C-45：Electron 主进程不会自行退出；延迟 200 ms，让结果文件与日志先写完
  .finally(() => setTimeout(() => app.exit(process.exitCode || 0), 200));
