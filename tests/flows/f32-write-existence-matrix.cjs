// F32 写入口存在性矩阵（换角度：把「针对既有行」的写函数统统打在不存在 id 上）
// @runtime: electron  @tier: 2  @gui: false  @id: F32  @timeout: 300
// 运行：FLOW_INSTANCE=manual npx electron tests/flows/f32-write-existence-matrix.cjs
//
// 角度：F19 把所有「读」入口当对手喂垃圾参数，F15 测「同一个写入口做两遍」，
//       这条补上矩阵缺的那一角——**写入口打在不存在的行上会发生什么**。
//       两种失败方式都会被用户踩到：
//         ① 假成功：函数返回 true / {id} / undefined，调用方据此弹「已保存」，
//            而库里什么都没发生（D-TEST-15 就是这么被抓住的）；
//         ② 越界改写：本该只动一行的 UPDATE 因为条件写松了而动到别的行——
//            这种破损在正向旅程里永远不会显形，只有拿幽灵 id 去打才看得见。
//       每条探针跑完立刻 persistNow + 磁盘级快照差分：既看返回值诚不诚实，
//       也看**既有行的内容有没有被动过**（新增行单独计数，不算越界）。
//
// 依据：§7.2（每次落库即落盘 / 软删除语义）、§7.1.3（边界输入不得穿透）、
//       §7.1.4（不丢数据）、§4.2（id 为 UUID、行归属）、§9.1 M15（引用完整性）。
"use strict";
const path = require("path");
const { app } = require("electron");
const { Flow, runFlow, tmpUserDataDir, freshDir, ROOT } = require("./lib/harness.cjs");
const { audit, quit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F32",
  title: "写入口存在性矩阵与假成功清点",
  angle: "把针对既有行的写函数打在不存在 id 上：返回值诚不诚实 + 有没有越界改写别的行",
  cites: ["§7.2", "§7.1.3", "§7.1.4", "§4.2", "§9.1 M15"],
  tier: 2,
  gui: false,
});

const NOPE = "00000000-0000-0000-0000-00000000dead";
const NOPE2 = "11111111-1111-1111-1111-1111111111ee";
const fsrsObj = { state: "review", due: Date.now() + 86400000, stability: 5, difficulty: 6, reps: 1, lapses: 0, learning_steps: [] };

// 探针：fn = db.js 导出名；args = 实参；expect = mutate（针对既有行）| insert（纯插入）
const PROBES = [
  { fn: "updateProgress", args: [NOPE, { ratio: 0.5 }], expect: "mutate" },
  { fn: "addReadingEvent", args: [NOPE, 500], expect: "mutate" },
  { fn: "deleteCard", args: [NOPE], expect: "mutate" },
  { fn: "deleteItem", args: [NOPE], expect: "mutate" },
  { fn: "deleteJournalEntry", args: [NOPE], expect: "mutate" },
  { fn: "setCardSuspended", args: [NOPE, true], expect: "mutate" },
  { fn: "updateCard", args: [{ id: NOPE, noteText: "F32 幽灵改卡" }], expect: "mutate" },
  { fn: "saveReview", args: [NOPE, fsrsObj, "Good", 500, fsrsObj], expect: "mutate" },
  { fn: "setLibraryItemTitle", args: [NOPE, "F32 幽灵标题"], expect: "mutate" },
  { fn: "setLibraryItemLang", args: [NOPE, "ja"], expect: "mutate" },
  { fn: "updateCardLeech", args: [NOPE, { suspended: true }], expect: "mutate" },
  { fn: "setActiveFsrsConfig", args: [NOPE], expect: "mutate" },
  { fn: "setActiveMaterialMap", args: [NOPE], expect: "mutate" },
  { fn: "deleteMaterialMap", args: [NOPE], expect: "mutate" },
  { fn: "deleteKnowledgeRelation", args: [NOPE], expect: "mutate" },
  { fn: "deleteKnowledgeExternalRef", args: [NOPE], expect: "mutate" },
  { fn: "deletePersonalMeaningCandidate", args: [NOPE], expect: "mutate" },
  { fn: "deleteInsightRun", args: [NOPE], expect: "mutate" },
  { fn: "removeDictSource", args: [NOPE], expect: "mutate" },
  { fn: "setDictSourceEnabled", args: [NOPE, false], expect: "mutate" },
  { fn: "setMemoryRunStatus", args: [NOPE, "ok"], expect: "mutate" },
  { fn: "setInsightRunStatus", args: [NOPE, "done"], expect: "mutate" },
  { fn: "setAIGenBatchStatus", args: [NOPE, "done"], expect: "mutate" },
  { fn: "addCardIssue", args: [{ cardId: NOPE, ruleId: "f32", severity: "info", message: "F32 挂在幽灵卡上的 issue", source: "lint" }], expect: "insert" },
  { fn: "createExtract", args: [{ parentType: "document", parentId: NOPE, documentId: NOPE, contentMarkdown: "F32 悬空摘录", priority: 50 }], expect: "insert" },
  { fn: "createKnowledgeExternalRef", args: [{ knowledgePointId: NOPE, url: "https://example.com/x", title: "F32 悬空外链" }], expect: "insert" },
  { fn: "createJournalEntry", args: [{ contentMarkdown: "   ", source: "app" }], expect: "reject" },
  { fn: "createCard", args: [{}], expect: "insert" },
];
// 已登记的假成功名单（D-TEST-15）。名单外新出现的假成功 = 回归。
const ADMITTED_FAKE = ["updateProgress", "addReadingEvent"];
// 已登记在 D-TEST-15 范围内、实测会收幽灵父 id 的三张子表（超出即新的写入口缺口）
const GHOST_OK = new Set(["card_issues", "extracts", "reading_events"]);
// 假成功总数棘轮：只许降不许升（首轮实测后收紧到观测值）
const FAKE_BUDGET = Number(process.env.F32_FAKE_BUDGET || 18);

function shapeOf(v) {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (v === true) return "true(假成功候选)";
  if (v === false) return "false(可判失败)";
  if (typeof v === "object") return `object{${Object.keys(v).slice(0, 3).join(",")}}(假成功候选)`;
  return `${typeof v}:${String(v).slice(0, 14)}`;
}

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f32"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");

    const s = await runFlow(flow, async () => {
      const db = require(path.join(ROOT, "electron", "db.js"));
      await db.initDb();

      // ---------- W1 先铺一层真实的行，才有「被越界改写」可言 ----------
      flow.section("W1 播种真实数据（3 本书 / 9 张卡 / 摘录 / 日记 / 评分 / 参数环境）");
      const items = [];
      for (let i = 0; i < 3; i++) items.push(db.createFromPaste(`F32 书 ${i}`, `# 第${i}章\n\nF32 的正文内容，第 ${i} 本。\n\n再多几行以便分页。`));
      const cards = [];
      for (let i = 0; i < 9; i++) {
        cards.push(
          db
            .createCard({
              noteText: `F32 卡 ${i}`,
              cardType: "qa",
              frontMarkdown: `问 ${i}`,
              backMarkdown: `答 ${i}`,
              priority: 50,
              tags: ["f32"],
              fsrsJson: JSON.stringify({ state: i % 3 === 0 ? "new" : "review", due: Date.now() + (i - 4) * 60000, lapses: 0 }),
              contextRef: { documentId: items[i % 3].documentId },
            })
            .id
        );
      }
      db.createExtract({ parentType: "document", parentId: items[0].documentId, documentId: items[0].documentId, contentMarkdown: "F32 真实摘录", priority: 60 });
      db.createJournalEntry({ contentMarkdown: "F32 真实日记", source: "app" });
      cards.slice(0, 3).forEach((id) => db.saveReview(id, { ...fsrsObj }, "Good", 500, fsrsObj));
      db.persistNow();
      const tables = (await audit(dbFile)).tables().filter((t) => !t.startsWith("sqlite_"));
      flow.record("全库表数（参与差分）", String(tables.length));

      const snap = async () => {
        const aud = await audit(dbFile);
        const out = {};
        for (const t of tables) {
          const m = new Map();
          const cols = aud.columns(t);
          const keyOf = (r) => String(r.id !== undefined && r.id !== null ? r.id : cols.map((c) => String(r[c])).join("|"));
          const valOf = (r) => JSON.stringify(cols.map((c) => r[c]));
          for (const r of aud.all(t)) m.set(keyOf(r), valOf(r));
          out[t] = m;
        }
        aud.close();
        return out;
      };
      const base = await snap();
      const baseRows = Object.values(base).reduce((a, m) => a + m.size, 0);
      flow.check("播种后全库有行可依", baseRows > 30, ">30 行", String(baseRows));

      // ---------- W2 逐条打在幽灵 id 上 ----------
      flow.section("W2 每个写入口打在不存在 id 上：返回值诚实性 + 既有行是否被动（逐条差分）");
      const fake = [];
      const crossed = [];
      const outcomes = [];
      const missing = [];
      for (const p of PROBES) {
        if (typeof db[p.fn] !== "function") {
          missing.push(p.fn);
          continue;
        }
        const before = await snap();
        let shape = "";
        let threw = null;
        try {
          shape = shapeOf(db[p.fn](...p.args));
        } catch (e) {
          threw = String((e && e.message) || e).slice(0, 46);
          shape = "throw:" + threw;
        }
        try {
          db.persistNow();
        } catch (e) {
          shape += " / persist 抛错:" + String(e.message).slice(0, 24);
        }
        const after = await snap();
        const dirty = [];
        let added = 0;
        for (const t of tables) {
          const b = before[t] || new Map();
          const a = after[t] || new Map();
          for (const [k, v] of b) if (a.get(k) !== v) dirty.push(`${t}#${String(k).slice(0, 8)}`);
          for (const k of a.keys()) if (!b.has(k)) added++;
        }
        outcomes.push(`${p.fn} → ${shape}${dirty.length ? " ｜越界改写 " + dirty.join(",") : ""}${added ? " ｜新增 " + added : ""}`);
        if (dirty.length) crossed.push(`${p.fn} 改写了既有行：${dirty.slice(0, 4).join(",")}`);
        const honest = threw !== null || /可判失败|undefined/.test(shape);
        if (!honest && !dirty.length && p.expect === "mutate" && !ADMITTED_FAKE.includes(p.fn) && /假成功候选/.test(shape)) fake.push(p.fn);
        void added;
      }
      flow.record("探针逐条结果", outcomes.join("\n      "));
      if (missing.length) flow.record("db.js 未导出、本轮跳过的探针", missing.join(" "));
      flow.check("写在幽灵 id 上不得越界改写既有行", crossed.length === 0, "零越界", crossed.length ? crossed.join(" ；") : "零越界");
      flow.known(
        "幽灵 id 的假成功函数不得超出点名清单（D-TEST-15 登记的「写入口零校验 + 假成功」是一类问题：除点名的 2 个外，实测还有 13 个针对既有行的函数返回真值）",
        fake.length === 0,
        "D-TEST-15",
        "仅 " + ADMITTED_FAKE.join("/"),
        fake.length ? fake.join(" ") : "无新增"
      );
      flow.check(
        "已点名的两个假成功入口仍在矩阵里（清单悄悄变化也要看得见）",
        ADMITTED_FAKE.every((f) => outcomes.some((o) => o.startsWith(f + " → ") && /假成功候选/.test(o))),
        "updateProgress + addReadingEvent 仍为假成功",
        outcomes.filter((o) => ADMITTED_FAKE.some((f) => o.startsWith(f + " → "))).join(" ; ")
      );

      // ---------- W3 诚实性总账 ----------
      flow.section("W3 诚实性总账：拒绝 / 假成功 / 越界 三档分布（棘轮：假成功只许降）");
      const rejected = outcomes.filter((o) => /throw:/.test(o));
      const fakes = outcomes.filter((o) => /假成功候选/.test(o));
      flow.record("探针总数", String(outcomes.length));
      flow.record("明确抛错（诚实失败）", `${rejected.length} 个：` + rejected.map((o) => o.split(" → ")[0]).join(" "));
      flow.record("返回值无法判失败（假成功候选）", `${fakes.length} 个：` + fakes.map((o) => o.split(" → ")[0]).join(" "));
      flow.check("假成功候选总数不升（棘轮，只许降）", fakes.length <= FAKE_BUDGET, `≤${FAKE_BUDGET}`, fakes.length);
      flow.check("至少一半探针能被调用（矩阵没缩水成空表）", outcomes.length >= Math.floor(PROBES.length / 2), `≥${Math.floor(PROBES.length / 2)}`, outcomes.length);

      // ---------- W4 点名 D-TEST-15 的两个写入口 ----------
      flow.section("W4 已登记的 D-TEST-15：两个写入口对幽灵 id 必须给可判失败（修好了这条会反向报警）");
      const r1 = db.updateProgress(NOPE, { ratio: 0.3 });
      flow.known("给不存在的书写进度必须返回可判失败（现在返回 true，界面显示「已保存」）", r1 !== true && r1 !== undefined, "D-TEST-15", "false / 抛错", shapeOf(r1));
      let r2 = "（未抛错）";
      try {
        r2 = shapeOf(db.addReadingEvent(NOPE, 500));
      } catch (e) {
        r2 = "throw:" + String(e.message).slice(0, 30);
      }
      flow.known("给不存在的书加阅读事件必须被拒（现在照样插一行无人认领的字数）", /throw:/.test(r2), "D-TEST-15", "抛错", r2);

      // ---------- W5 打过幽灵之后，库还得能用 ----------
      flow.section("W5 一轮幽灵写之后库仍可用（不得把异常状态留在内存里）");
      let usable = [];
      try {
        usable.push("listItems=" + db.listItems().length);
        usable.push("cards=" + db.listAllCards().length);
        usable.push("kpi.dueToday=" + db.getStatsOverview().kpi.dueToday);
        usable.push("queue=" + db.computeTodayQueue(Date.now()).cards.length);
        flow.check("读数全部正常返回（幽灵写没有把库打进坏态）", true, "无异常", usable.join(" "));
      } catch (e) {
        flow.check("读数全部正常返回（幽灵写没有把库打进坏态）", false, "无异常", "抛错：" + String(e.message).slice(0, 60) + " ｜" + usable.join(" "));
      }
      const post = await snap();
      flow.record("幽灵写之后的全库行数", String(Object.values(post).reduce((a, m) => a + m.size, 0)) + `（播种后 ${baseRows}）`);

      // ---------- W6 悬空插入：写入口自己造出来的孤儿 ----------
      flow.section("W6 写入口是否允许创建指向不存在父行的行（§4.2 行归属 / §9.1 M15 引用完整性）");
      const aud3 = await audit(dbFile);
      const danglingPairs = [
        ["card_issues", "card_id", "cards"],
        ["extracts", "document_id", "documents"],
        ["knowledge_external_refs", "knowledge_point_id", "knowledge_points"],
        ["reading_events", "item_id", "library_items"],
        ["review_logs", "card_id", "cards"],
        ["cards", "knowledge_point_id", "knowledge_points"],
      ];
      const dangling = [];
      for (const [t, c, parent] of danglingPairs) {
        if (!tables.includes(t) || !tables.includes(parent)) continue;
        const n = Number(
          aud3.one(`SELECT COUNT(*) AS n FROM "${t}" WHERE "${c}" IS NOT NULL AND "${c}" <> '' AND "${c}" NOT IN (SELECT id FROM "${parent}")`).n
        );
        if (n) dangling.push(`${t}.${c} 有 ${n} 行指向不存在的 ${parent}`);
      }
      flow.record("幽灵写一轮后的悬空行数", dangling.join(" ；") || "（零悬空）");
      flow.known(
        "写入口不得创建指向不存在父行的行（幽灵 id 必须挡在门口，而不是插进库里等人日后踩）—— 已登记同类 D-TEST-15 只点名了 reading_events，实测三族都收：card_issues / extracts / reading_events",
        dangling.length === 0,
        "D-TEST-15",
        "零悬空",
        dangling.length ? dangling.join(" ；") : "零悬空"
      );
      const dangTables = [...new Set(dangling.map((d) => d.split(".")[0]))].sort();
      flow.check(
        "会收幽灵父 id 的子表不得超出点名三族（新表进这个清单＝又一个没设防的写入口）",
        dangTables.every((x) => GHOST_OK.has(x)),
        "仅 " + [...GHOST_OK].join(" / "),
        dangTables.join(" ") || "（零悬空）"
      );
      const blank = Number(
        aud3.one("SELECT COUNT(*) AS n FROM cards WHERE (note_text IS NULL OR note_text = '') AND (front_markdown IS NULL OR front_markdown = '') AND is_deleted = 0").n
      );
      flow.record("空白卡行数（createCard({}) 被整份接受，连正文都不要求）", `${blank} 行`);
      aud3.close();
    });

    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F32 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String((e && e.message) || e) });
    process.exit(1);
  });
