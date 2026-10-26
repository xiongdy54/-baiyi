// §9.4 历史数据兼容回填——legacyBackfill 判定/编排/幂等/事务/渲染层对拍（electron 直跑）
// @runtime: electron  @tier: 2  @gui: false  @id: LEGACYBF  @timeout: 300
// 运行：npx electron tests/legacyBackfill.test.cjs   （隔离临时库；先关应用）
// 覆盖：
//   P0 渲染层对拍——esbuild 现场打包 src/lib/cards.ts（m15r 同款纪律），parseCloze/extractClozeAnswer(s)
//      与 electron/legacyBackfill.js 移植函数逐字符对拍（F79 双路径纪律闸门）；
//   P1 fsrs_json 缺 S/D 判定矩阵（新卡态补 0/0 基线；非 new 态/损坏/未知 state 一律不碰）；
//   P2 cloze hint 拆答案判定矩阵（仅 back_markdown 空白 ∧ 被遮 ord 有 hint 拼段才物化）；
//   P3 端到端显示对拍——回填前渲染层会显示的答案串 ≡ 回填后 back_markdown（逐字符）；
//   P4 编排（隔离 sql.js 最小库）：匹配行精确写入 / 未匹配行**全列字节级不变** / 幂等（标记跳过 +
//      零写入再标记）/ 事务原子（中途失败全回滚、不写标记、重跑可续）/ P1 标记时序（runLegacyBackfill
//      不写 settings：mark 未调用＝persist 未发生 → 标记不落盘；mark() 写盘失败上抛交挂载点、重跑补记）；
//   P5 真库集成（electron/db.js initDb 挂载）：新库首启即标记 / 重启模拟触发回填 / 二次重启零写入。
// 隔离：userData 指向临时目录，全新 library.db，绝不触碰真实库（§7.3）。
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ROOT = path.join(__dirname, "..");
const LB = require(path.join(ROOT, "electron", "legacyBackfill.js"));
const Database = require("better-sqlite3");

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "legacybf-test-"));
  const dbFile = path.join(tmp, "library.db");
  try {
    app.setPath("userData", tmp);
    const db = require(path.join(ROOT, "electron", "db.js"));
    const st = require(path.join(ROOT, "electron", "settingsStore.js")); // userData 已就位后再 require（SETTINGS_FILE 定格）
    await db.initDb();

    // ================================================================ P0 渲染层对拍
    console.log("== P0 esbuild 现场打包 src/lib/cards.ts，与 legacyBackfill 移植函数逐字符对拍 ==");
    {
      const bundleFile = path.join(tmp, "cards.bundle.cjs");
      esbuild.buildSync({
        entryPoints: [path.join(ROOT, "src", "lib", "cards.ts")],
        bundle: true, platform: "node", format: "cjs",
        outfile: bundleFile, logLevel: "silent"
      });
      const R = require(bundleFile);
      const TEXTS = [
        "前缀：{{c1::答案A::答案B}}",
        "{{c1::A::x::y}}",                                  // hint 内含 ::（正则懒分组分配）
        "{{c1::多行\n答案::提示\n两行}}",                    // B-6 跨行
        "{{c1::A::}} 与 {{c2::B::h}}",                      // 空 hint 不拼段
        "{{c1::A:: }} 加空白hint",                           // 空白 hint 仍拼段
        "{{c3::只三号::h3}} 与 {{c10::十号::h10}}",           // 非连续 ord / 两位数 ord
        "重复 {{c1::一::h一}} 然后 {{c1::又::h又}}",          // B-9 同 ord 多次 " / " join
        "没有挖空的普通文本与 ｛｛c1::全角｝｝ 干扰项"
      ];
      for (let i = 0; i < TEXTS.length; i++) {
        const t = TEXTS[i];
        const ords = R.parseCloze(t).ords;
        let ansOk = true, ansDetail = {};
        for (const o of ords.concat([1, 2, 3])) {
          const a = R.extractClozeAnswer(t, o), b = LB.extractClozeAnswerPort(t, o);
          if (a !== b) { ansOk = false; ansDetail[o] = { R: a, LB: b }; }
        }
        check(`T${i} extractClozeAnswer 逐字符对拍`, ansOk, "全 ord 相等", ansDetail);
        check(`T${i} ords 收集对拍`, eq(R.parseCloze(t).ords, LB.clozeOrdsSorted(t)), R.parseCloze(t).ords, LB.clozeOrdsSorted(t));
        const maskSets = [[], ords, ords.slice(0, 1), ords.slice(1)];
        let renderOk = true, renderDetail = {};
        for (const mask of maskSets) {
          const a = R.parseCloze(t).renderDetail(mask);
          const b = LB.renderDetailPort(t, mask);
          if (a.text !== b.text || !eq(a.maskedOrds, b.maskedOrds)) {
            renderOk = false; renderDetail[JSON.stringify(mask)] = { R: a, LB: b };
          }
        }
        check(`T${i} renderDetail（text+maskedOrds 首现序）对拍`, renderOk, "4 组 mask 全等", renderDetail);
      }
    }

    // ================================================================ P1 fsrs_json 缺 S/D 判定矩阵
    console.log("== P1 needsFsrsBaseline 判定矩阵 ==");
    {
      const r1 = LB.needsFsrsBaseline('{"state":"new","due":123,"lapses":0}');
      check("v11 前新卡缺 S/D → 补基线 0/0（键序保持、新键追加）",
        r1 && r1.next === '{"state":"new","due":123,"lapses":0,"stability":0,"difficulty":0}' && eq(r1.filled, ["stability", "difficulty"]),
        '{"state":"new","due":123,"lapses":0,"stability":0,"difficulty":0}', r1 && r1.next);
      const r2 = LB.needsFsrsBaseline('{"state":"new","due":1,"lapses":0,"stability":3.5}');
      check("新卡缺 D 有 S → 只补 D，S 原值保留",
        r2 && r2.next === '{"state":"new","due":1,"lapses":0,"stability":3.5,"difficulty":0}' && eq(r2.filled, ["difficulty"]),
        "difficulty:0 追加", r2 && r2.next);
      const r3 = LB.needsFsrsBaseline('{"due":9}'); // state 缺失 = 新卡态（mapCardRow isNewState 同口径）
      check("state 缺失 → 按新卡态补齐", r3 && r3.next === '{"due":9,"stability":0,"difficulty":0}', "补 0/0", r3 && r3.next);
      const r4 = LB.needsFsrsBaseline('{"state":"review","due":123,"lapses":2,"reps":5}');
      check("review 态缺 S/D → 不回填（回填即 D 钳制 0→1 + ts-fsrs 拒绝，渲染层兼容即终态）", r4 === null, null, r4);
      check("learning 态缺 S/D → 不回填", LB.needsFsrsBaseline('{"state":"learning","due":1}') === null, null, null);
      check("relearning 态缺 S/D → 不回填", LB.needsFsrsBaseline('{"state":"relearning","due":1}') === null, null, null);
      check("未知 state 名 → 不回填（mapCardRow 闸门按非新卡判，回填 0/0 会致 damaged）",
        LB.needsFsrsBaseline('{"state":"bogus","due":1}') === null, null, null);
      check("现行 8 字段全量卡 → 不回填",
        LB.needsFsrsBaseline('{"state":"review","due":1,"lapses":0,"stability":3,"difficulty":5,"reps":1,"learningSteps":0,"lastReview":null}') === null,
        null, null);
      check("损坏 JSON → 不回填（走既有 damaged 降级链）", LB.needsFsrsBaseline("{broken") === null, null, null);
      check("JSON 数组/标量 → 不回填", LB.needsFsrsBaseline("[1,2]") === null && LB.needsFsrsBaseline("5") === null && LB.needsFsrsBaseline("null") === null,
        null, null);
      const r5 = LB.needsFsrsBaseline('{"state":"new","due":1,"stability":null,"difficulty":0}');
      check("S=null（显式）按缺失补 0；已有 D=0 保留", r5 && r5.next === '{"state":"new","due":1,"stability":0,"difficulty":0}' && eq(r5.filled, ["stability"]),
        "S 补 0", r5 && r5.next);
      check("新卡 S/D 齐（0/0 显式）→ 不回填", LB.needsFsrsBaseline('{"state":"new","due":1,"stability":0,"difficulty":0}') === null, null, null);
    }

    // ================================================================ P2 cloze hint 拆答案判定矩阵
    console.log("== P2 planClozeBackfill 判定矩阵 ==");
    {
      const row = (over) => ({ cardType: "cloze", backMarkdown: "", frontMarkdown: "题面{{c1::答案A::答案B}}", noteText: "题面{{c1::答案A::答案B}}", clozeOrds: [], ...over });
      check("存量 hint 卡（back 空）→ 物化「答案A（答案B）」",
        eq(LB.planClozeBackfill(row({})), { backMarkdown: "答案A（答案B）" }), { backMarkdown: "答案A（答案B）" }, LB.planClozeBackfill(row({})));
      check("qa 卡含挖空语法 → 不拆（渲染层只对 cloze 跑拆分）",
        LB.planClozeBackfill(row({ cardType: "qa" })) === null, null, null);
      check("back_markdown 已有非空白答案 → 不拆（显示已被钉住，运行时拼接未参与）",
        LB.planClozeBackfill(row({ backMarkdown: "自定义答案" })) === null, null, null);
      check("back_markdown 纯空白 → 仍走运行时拼接（渲染层 trim 判空口径）→ 物化",
        eq(LB.planClozeBackfill(row({ backMarkdown: "   " })), { backMarkdown: "答案A（答案B）" }), "物化", LB.planClozeBackfill(row({ backMarkdown: "   " })));
      check("无 hint 挖空卡 → 不触发（零写入）",
        LB.planClozeBackfill(row({ frontMarkdown: "{{c1::甲}}", noteText: "{{c1::甲}}" })) === null, null, null);
      const multi = row({ frontMarkdown: "{{c1::甲::提1}}与{{c2::乙}}", noteText: "{{c1::甲::提1}}与{{c2::乙}}" });
      check("同答多空卡（clozeOrds 空=遮全部）→ 圈号 + U+3000 join 公式逐字符同渲染层",
        eq(LB.planClozeBackfill(multi), { backMarkdown: "① 甲（提1）　② 乙" }), { backMarkdown: "① 甲（提1）　② 乙" }, LB.planClozeBackfill(multi));
      const perblank = row({ frontMarkdown: "{{c1::甲::提1}}与{{c2::乙::提2}}", noteText: "{{c1::甲::提1}}与{{c2::乙::提2}}", clozeOrds: [2] });
      check("per-blank 卡只物化自己被遮 ord 的答案（其余空 hint 不动）",
        eq(LB.planClozeBackfill(perblank), { backMarkdown: "乙（提2）" }), { backMarkdown: "乙（提2）" }, LB.planClozeBackfill(perblank));
      const perblankOther = row({ frontMarkdown: "{{c1::甲::提1}}与{{c2::乙}}", noteText: "{{c1::甲::提1}}与{{c2::乙}}", clozeOrds: [2] });
      check("per-blank 卡 hint 只在未遮 ord 上 → 不触发（该 hint 不参与本卡显示）",
        LB.planClozeBackfill(perblankOther) === null, null, null);
      const noteOnly = row({ frontMarkdown: "", noteText: "仅note{{c1::答::提}}" });
      check("frontMarkdown 空 → 按 CardFace 同款回退 noteText 取面并物化",
        eq(LB.planClozeBackfill(noteOnly), { backMarkdown: "答（提）" }), { backMarkdown: "答（提）" }, LB.planClozeBackfill(noteOnly));
      check("cloze_ords 损坏 JSON → 按 [] 回退（遮全部口径，mapCardRow j() 同款）",
        eq(LB.planClozeBackfill(row({ frontMarkdown: "{{c1::答::提}}", noteText: "{{c1::答::提}}", clozeOrds: "not-json" })),
          { backMarkdown: "答（提）" }), "按遮全部物化", LB.planClozeBackfill(row({ clozeOrds: "not-json" })));
      // P3-b：cloze_ords 合法 JSON 但非数组的垃圾值——parseClozeOrdsField 原样透传（数字/对象不是 null），
      // planClozeBackfill 侧 Array.isArray 兜底 → 与 [] 等价（遮全部口径），物化结果逐字符一致
      const garbageEq = (raw) => eq(
        LB.planClozeBackfill(row({ clozeOrds: LB.parseClozeOrdsField(raw) })),
        LB.planClozeBackfill(row({ clozeOrds: [] })));
      check("cloze_ords 垃圾值（合法 JSON 数字 \"5\"）→ 与 [] 等价（Array.isArray 兜底遮全部）",
        garbageEq("5"), "等价遮全部", LB.planClozeBackfill(row({ clozeOrds: LB.parseClozeOrdsField("5") })));
      check("cloze_ords 垃圾值（合法 JSON 对象）→ 与 [] 等价（Array.isArray 兜底遮全部）",
        garbageEq('{"a":1}'), "等价遮全部", LB.planClozeBackfill(row({ clozeOrds: LB.parseClozeOrdsField('{"a":1}') })));
      // P3-b：ord>10 圈号溢出分支——CIRCLED[i] ?? "·"，第 11 空起圈号回退「·」（与渲染层公式同源）
      const elevenFront = Array.from({ length: 11 }, (_, i) => `{{c${i + 1}::答${i + 1}::提${i + 1}}}`).join("");
      const eleven = row({ frontMarkdown: elevenFront, noteText: elevenFront });
      const expect11 = Array.from({ length: 11 }, (_, i) => `${"①②③④⑤⑥⑦⑧⑨⑩"[i] ?? "·"} 答${i + 1}（提${i + 1}）`).join("　");
      check("ord>10 圈号溢出：第 11 空圈号回退「·」（CIRCLED[i] ?? \"·\"），前 10 空圈号不受影响",
        eq(LB.planClozeBackfill(eleven), { backMarkdown: expect11 }), { backMarkdown: expect11 }, LB.planClozeBackfill(eleven));
    }

    // ================================================================ P3 端到端显示对拍（渲染层公式 × 回填输出）
    console.log("== P3 端到端：回填前渲染层显示串 ≡ 回填后 back_markdown ==");
    {
      const bundleFile = path.join(tmp, "cards.p3.bundle.cjs");
      esbuild.buildSync({
        entryPoints: [path.join(ROOT, "src", "lib", "cards.ts")],
        bundle: true, platform: "node", format: "cjs",
        outfile: bundleFile, logLevel: "silent"
      });
      const R = require(bundleFile);
      // CardBrowser CardFace cloze 分支答案公式（src/components/CardBrowser.tsx:2261-2275 逐行同源）
      const rendererClozeAnswer = (card) => {
        const frontText = card.frontMarkdown || card.noteText;
        const parsed = R.parseCloze(frontText);
        const maskOrds = card.clozeOrds && card.clozeOrds.length > 0 ? card.clozeOrds : parsed.ords;
        const masked = parsed.renderDetail(maskOrds);
        const answers = R.extractClozeAnswers(frontText, masked.maskedOrds);
        const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩";
        return card.backMarkdown && card.backMarkdown.trim()
          ? card.backMarkdown
          : answers.length > 1
            ? answers.map((a, i) => `${CIRCLED[i] ?? "·"} ${a}`).join("　")
            : answers[0] ?? "";
      };
      const fixtures = [
        { frontMarkdown: "题面{{c1::答案A::答案B}}", noteText: "题面{{c1::答案A::答案B}}", clozeOrds: [], backMarkdown: "" },
        { frontMarkdown: "{{c1::甲::提1}}与{{c2::乙::提2}}", noteText: "{{c1::甲::提1}}与{{c2::乙::提2}}", clozeOrds: [], backMarkdown: "" },
        { frontMarkdown: "{{c1::甲::提1}}与{{c2::乙::提2}}", noteText: "{{c1::甲::提1}}与{{c2::乙::提2}}", clozeOrds: [2], backMarkdown: "" },
        { frontMarkdown: "{{c1::一::h一}} 然后 {{c1::又}}", noteText: "{{c1::一::h一}} 然后 {{c1::又}}", clozeOrds: [], backMarkdown: "" },
        { frontMarkdown: "{{c1::A::x::y}}", noteText: "{{c1::A::x::y}}", clozeOrds: [], backMarkdown: "  " },
        // P3-b：11 空 hint 卡——两端圈号溢出分支（CIRCLED[i] ?? "·"）对拍
        (() => { const f = Array.from({ length: 11 }, (_, i) => `{{c${i + 1}::答${i + 1}::提${i + 1}}}`).join(""); return { frontMarkdown: f, noteText: f, clozeOrds: [], backMarkdown: "" }; })()
      ];
      for (let i = 0; i < fixtures.length; i++) {
        const pre = fixtures[i];
        const planned = LB.planClozeBackfill({ ...pre, cardType: "cloze" });
        const post = { ...pre, backMarkdown: planned ? planned.backMarkdown : pre.backMarkdown };
        check(`夹具${i} 回填前显示 ≡ 回填后 back_markdown ≡ 回填后再渲染`,
          planned !== null && rendererClozeAnswer(pre) === post.backMarkdown && rendererClozeAnswer(post) === post.backMarkdown,
          rendererClozeAnswer(pre), planned && post.backMarkdown);
      }
      // 正面不可变由 plan 的键形状保证：planned 只允许携带 backMarkdown（front/note 不在写入面）
      const pre = fixtures[1];
      const planned = LB.planClozeBackfill({ ...pre, cardType: "cloze" });
      check("plan 输出只含 backMarkdown 键（front/note 不在写入面）",
        planned !== null && eq(Object.keys(planned), ["backMarkdown"]), ["backMarkdown"], planned && Object.keys(planned));
    }

    // ================================================================ P4 编排（隔离 sql.js 最小库）
    console.log("== P4 编排：精确写入 / 未匹配行全列字节级不变 / 幂等 / 事务原子 ==");
    {
      const initSqlJs = require("sql.js");
      const SQL = await initSqlJs();
      const sqlDb = new SQL.Database();
      sqlDb.run(`CREATE TABLE cards (
        id TEXT PRIMARY KEY, note_text TEXT, card_type TEXT, cloze_ords TEXT,
        front_markdown TEXT, back_markdown TEXT, fsrs_json TEXT,
        leech_json TEXT, priority INTEGER, created_at INTEGER, updated_at INTEGER,
        sync_version INTEGER, is_deleted INTEGER
      )`);
      const q = (sql, params = []) => {
        const stmt = sqlDb.prepare(sql);
        stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
      };
      const ins = (cols) => sqlDb.run(
        "INSERT INTO cards (id, note_text, card_type, cloze_ords, front_markdown, back_markdown, fsrs_json, leech_json, priority, created_at, updated_at, sync_version, is_deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [cols.id, cols.note_text ?? null, cols.card_type ?? "qa", cols.cloze_ords ?? "[]", cols.front_markdown ?? "", cols.back_markdown ?? "",
          cols.fsrs_json ?? null, cols.leech_json ?? null, cols.priority ?? 50, 111, 222, 7, cols.is_deleted ?? 0]
      );
      ins({ id: "s-new-legacy", card_type: "qa", fsrs_json: '{"state":"new","due":123,"lapses":0}' });
      ins({ id: "s-review-legacy", card_type: "qa", fsrs_json: '{"state":"review","due":456,"lapses":2,"reps":5}' });
      ins({ id: "s-cloze-hint", card_type: "cloze", front_markdown: "面{{c1::答A::答B}}", note_text: "面{{c1::答A::答B}}", back_markdown: "" });
      ins({ id: "s-cloze-clean", card_type: "cloze", front_markdown: "{{c1::无hint}}", back_markdown: "" });
      ins({ id: "s-both", card_type: "cloze", front_markdown: "面{{c1::答::提}}", note_text: "面{{c1::答::提}}", back_markdown: "", fsrs_json: '{"state":"new","due":1,"lapses":0}' });
      ins({ id: "s-deleted-legacy", card_type: "cloze", front_markdown: "{{c1::删::提}}", fsrs_json: '{"state":"new","due":1}', is_deleted: 1 });
      const snapshot = () => q("SELECT * FROM cards ORDER BY id").map((r) => JSON.stringify(r));
      const before = snapshot();

      const setDir = path.join(tmp, "p4-settings");
      fs.mkdirSync(setDir, { recursive: true });
      const settingsFile = path.join(setDir, "settings.json");
      const store = {
        readSettings: () => { try { return JSON.parse(fs.readFileSync(settingsFile, "utf-8")); } catch { return {}; } },
        writeSettings: (o) => fs.writeFileSync(settingsFile, JSON.stringify(o, null, 2), "utf-8")
      };
      const deps = { db: sqlDb, queryAll: q, readSettings: store.readSettings, writeSettings: store.writeSettings, now: () => 1699999999999 };

      const r1 = LB.runLegacyBackfill(deps);
      check("首跑 ran=true 且计数正确（fsrs 2 行：s-new-legacy + s-both；cloze 2 行：s-cloze-hint + s-both）",
        r1.ran === true && r1.fsrsFixed === 2 && r1.clozeFixed === 2, { fsrsFixed: 2, clozeFixed: 2 }, { fsrsFixed: r1.fsrsFixed, clozeFixed: r1.clozeFixed });
      const after1 = snapshot();
      const rowOf = (id) => q("SELECT * FROM cards WHERE id = ?", [id])[0];
      check("s-new-legacy fsrs_json 精确（键序保持 + 基线追加）",
        rowOf("s-new-legacy").fsrs_json === '{"state":"new","due":123,"lapses":0,"stability":0,"difficulty":0}',
        '{"state":"new","due":123,"lapses":0,"stability":0,"difficulty":0}', rowOf("s-new-legacy").fsrs_json);
      check("s-cloze-hint back_markdown 精确且 front/note 未动",
        rowOf("s-cloze-hint").back_markdown === "答A（答B）" && rowOf("s-cloze-hint").front_markdown === "面{{c1::答A::答B}}" && rowOf("s-cloze-hint").note_text === "面{{c1::答A::答B}}",
        "back=答A（答B）", { back: rowOf("s-cloze-hint").back_markdown, front: rowOf("s-cloze-hint").front_markdown });
      check("s-both 双字段一次 UPDATE 同步落（fsrs + back_markdown）",
        rowOf("s-both").fsrs_json === '{"state":"new","due":1,"lapses":0,"stability":0,"difficulty":0}' && rowOf("s-both").back_markdown === "答（提）",
        "双字段齐", { fsrs: rowOf("s-both").fsrs_json, back: rowOf("s-both").back_markdown });
      check("review 态缺 S/D 行未被回填", rowOf("s-review-legacy").fsrs_json === '{"state":"review","due":456,"lapses":2,"reps":5}',
        "原样", rowOf("s-review-legacy").fsrs_json);
      const untouchedNames = ["s-review-legacy", "s-cloze-clean", "s-deleted-legacy"];
      const drift = untouchedNames.filter((id) => !before.includes(JSON.stringify(rowOf(id))));
      check("未匹配行全列字节级不变（含 SELECT 外的 leech_json/priority/created_at/updated_at/sync_version）",
        drift.length === 0, "零漂移", drift);
      // P1 标记时序：runLegacyBackfill 本身不写 settings——完成标记只随 mark() 回调落盘，
      // 挂载点（db.js initDb）在 persist() 成功后才调用；未调用＝persist 未发生/失败。
      const notMarked = store.readSettings();
      check("P1 时序：persist 未发生（mark 未调用）→ 完成标记不得写入 settings（标记先于数据落盘＝锁死存量旧数据）",
        !(notMarked && notMarked.app && notMarked.app.legacyBackfillV1 !== undefined),
        "无标记", notMarked && notMarked.app && notMarked.app.legacyBackfillV1);
      r1.mark(); // 模拟挂载点 persist() 成功后的标记落盘
      const marked = store.readSettings();
      check("P1 时序：persist() 成功后 mark() → 标记写入 settings.app.legacyBackfillV1 且等于 markedAt",
        marked && marked.app && marked.app.legacyBackfillV1 === 1699999999999 && r1.markedAt === 1699999999999,
        1699999999999, marked && marked.app && marked.app.legacyBackfillV1);

      const r2 = LB.runLegacyBackfill(deps);
      check("二跑标记短路（ran=false 零读写）", r2.ran === false && r2.reason === "marked", { ran: false }, r2);
      const after2 = snapshot();
      check("二跑后全库行级零变更", eq(after1, after2), "全等", "见 drift");

      // 零写入再标记路径：清标记重跑（行已合规）→ ran=true 且 0/0；标记仍须待 mark() 才落盘
      const s0 = store.readSettings();
      delete s0.app.legacyBackfillV1;
      store.writeSettings(s0);
      const r3 = LB.runLegacyBackfill(deps);
      check("清标记重跑：全库已合规 → ran=true 且 fsrsFixed=0/clozeFixed=0（零写入）",
        r3.ran === true && r3.fsrsFixed === 0 && r3.clozeFixed === 0,
        { ran: true, fsrsFixed: 0, clozeFixed: 0 }, r3);
      check("P1 时序：重跑完成但未 mark() → 标记仍未写入（「下次启动重跑可续」的同一形态）",
        !(store.readSettings().app && store.readSettings().app.legacyBackfillV1 !== undefined),
        "无标记", store.readSettings().app && store.readSettings().app.legacyBackfillV1);
      r3.mark();
      check("P1 时序：重跑 mark() → 再标记（幂等收口）",
        typeof store.readSettings().app.legacyBackfillV1 === "number",
        "number", store.readSettings().app && store.readSettings().app.legacyBackfillV1);
      check("零写入重跑后行级仍零变更", eq(after1, snapshot()), "全等", "见 drift");

      // 事务原子：先把夹具行重置回 legacy 形态，再注入第二条 UPDATE 失败 → 全回滚 + 不写标记 + 重跑可续
      sqlDb.run("UPDATE cards SET fsrs_json = ? WHERE id = ?", ['{"state":"new","due":123,"lapses":0}', "s-new-legacy"]);
      sqlDb.run("UPDATE cards SET fsrs_json = ? WHERE id = ?", ['{"state":"new","due":1,"lapses":0}', "s-both"]);
      sqlDb.run("UPDATE cards SET back_markdown = ? WHERE id = ?", ["", "s-both"]);
      sqlDb.run("UPDATE cards SET back_markdown = ? WHERE id = ?", ["", "s-cloze-hint"]);
      const s1 = store.readSettings(); delete s1.app.legacyBackfillV1; store.writeSettings(s1);
      const preFail = snapshot();
      let updateCount = 0;
      const realRun = sqlDb.run.bind(sqlDb);
      const failingDb = {
        run: (sqlP, params) => {
          if (typeof sqlP === "string" && sqlP.startsWith("UPDATE cards")) {
            updateCount++;
            if (updateCount === 2) throw new Error("注入失败：第二条 UPDATE");
          }
          return realRun(sqlP, params);
        }
      };
      let threw = null;
      try { LB.runLegacyBackfill({ ...deps, db: failingDb }); } catch (e) { threw = e; }
      check("中途失败抛出（第二条 UPDATE 注入）", threw !== null && /注入失败/.test(String(threw && threw.message)), "throw", threw && threw.message);
      check("失败后全库回滚（行级字节级 = 失败前快照，含被第一条 UPDATE 改过的行）", eq(preFail, snapshot()), "全等", "见 drift");
      check("失败后不写完成标记（下次启动重试）", store.readSettings().app && store.readSettings().app.legacyBackfillV1 === undefined, "无标记", store.readSettings().app);
      const r4 = LB.runLegacyBackfill(deps);
      check("崩溃中断后重跑可续：全部回填成功（fsrs 2 行 + cloze 2 行）", r4.ran === true && r4.fsrsFixed === 2 && r4.clozeFixed === 2,
        { fsrsFixed: 2, clozeFixed: 2 }, r4);
      check("重跑后行内容 = 首跑成功态", eq(after1, snapshot()), "全等", "见 drift");
      r4.mark();
      check("P1 时序：重跑 mark() → 标记归位（安全网恢复，下次启动短路）",
        typeof store.readSettings().app.legacyBackfillV1 === "number",
        "number", store.readSettings().app && store.readSettings().app.legacyBackfillV1);

      // P1 时序补例：标记落盘本身失败（如磁盘满）→ mark() 抛出交挂载点 catch 记日志，settings 无标记；
      // 下次启动重跑（判定已合规 → 零写入）后补标记。数据面与标记面解耦。
      const s2 = store.readSettings(); delete s2.app.legacyBackfillV1; store.writeSettings(s2);
      const r5 = LB.runLegacyBackfill({ ...deps, writeSettings: () => { throw new Error("注入失败：标记写盘"); } });
      check("标记写盘失败注入：重跑仍 ran=true 且零写入（数据面不受标记面影响）",
        r5.ran === true && r5.fsrsFixed === 0 && r5.clozeFixed === 0,
        { ran: true, fsrsFixed: 0, clozeFixed: 0 }, r5);
      let markThrew = null;
      try { r5.mark(); } catch (e) { markThrew = e; }
      check("mark() 写盘失败 → 异常上抛（挂载点 catch 的输入），不静默假成功",
        markThrew !== null && /标记写盘/.test(String(markThrew && markThrew.message)), "throw", markThrew && markThrew.message);
      check("标记写盘失败后 settings 无标记（下次启动重跑补记）",
        !(store.readSettings().app && store.readSettings().app.legacyBackfillV1 !== undefined),
        "无标记", store.readSettings().app && store.readSettings().app.legacyBackfillV1);
      const r6 = LB.runLegacyBackfill(deps);
      r6.mark();
      check("P1 时序：下次启动重跑可续 → 零写入 + mark() 补标记成功",
        r6.ran === true && r6.fsrsFixed === 0 && r6.clozeFixed === 0 && typeof store.readSettings().app.legacyBackfillV1 === "number",
        { ran: true, fsrsFixed: 0, clozeFixed: 0 }, r6);
    }

    // ================================================================ P5 真库集成（db.js initDb 挂载）
    console.log("== P5 真库集成：initDb 挂载 / 重启触发 / 二次重启零写入 ==");
    {
      // C-10：完成标记落库内 app_meta（settings 只在未迁移旧库/过渡期作回落）
      const metaMarker = () => {
        const c = new Database(dbFile, { readonly: true });
        try { return c.prepare("SELECT value FROM app_meta WHERE key = 'legacyBackfillV1'").get()?.value; } finally { c.close(); }
      };
      const clearMarker = () => {
        db.execRawSql("DELETE FROM app_meta WHERE key = 'legacyBackfillV1'");
        const s = st.readSettings();
        if (s.app) { delete s.app.legacyBackfillV1; st.writeSettings(s); }
      };
      const marker0 = metaMarker();
      check("新空库首启：initDb 挂载即写完成标记（app_meta）", typeof marker0 === "string" && Number(marker0) > 0,
        "number-like string", marker0);

      // 造夹具（createCard 落库即 persist；execRawSql 后手动 persistDb 再重启，文件库才含夹具）
      db.createCard({ id: "bf-new-legacy", noteText: "n", frontMarkdown: "f", backMarkdown: "b" }); // 新卡默认 3 字段 fsrs_json = v11 前 shape
      db.createCard({ id: "bf-review-legacy", noteText: "n", frontMarkdown: "f", backMarkdown: "b" });
      db.createCard({ id: "bf-modern", noteText: "n", frontMarkdown: "f", backMarkdown: "b" });
      db.createCard({ id: "bf-cloze-hint", noteText: "面{{c1::答案A::答案B}}", cardType: "cloze", frontMarkdown: "面{{c1::答案A::答案B}}", backMarkdown: "", clozeOrds: [] });
      db.createCard({ id: "bf-cloze-perblank", noteText: "{{c1::甲::提1}}与{{c2::乙::提2}}", cardType: "cloze", frontMarkdown: "{{c1::甲::提1}}与{{c2::乙::提2}}", backMarkdown: "", clozeOrds: [2] });
      db.createCard({ id: "bf-cloze-nohint", noteText: "{{c1::无}}", cardType: "cloze", frontMarkdown: "{{c1::无}}", backMarkdown: "" });
      db.createCard({ id: "bf-cloze-withback", noteText: "{{c1::答::提}}", cardType: "cloze", frontMarkdown: "{{c1::答::提}}", backMarkdown: "已编辑" });
      db.execRawSql("UPDATE cards SET fsrs_json = '{\"state\":\"review\",\"due\":123,\"lapses\":2,\"reps\":5}' WHERE id = 'bf-review-legacy'");
      db.execRawSql("UPDATE cards SET fsrs_json = '{\"state\":\"review\",\"due\":1,\"lapses\":0,\"stability\":3.3,\"difficulty\":5.5,\"reps\":2,\"learningSteps\":0,\"lastReview\":null}' WHERE id = 'bf-modern'");
      // nohint / withback 给 8 字段现行 fsrs_json——使其成为「FSRS 判定也不命中」的纯 cloze 侧未匹配行
      //（createCard 默认 3 字段 fsrs_json 属 FSRS 回填判定范围，会合法命中，与 cloze 谓词无关）
      db.execRawSql("UPDATE cards SET fsrs_json = '{\"state\":\"new\",\"due\":99,\"lapses\":0,\"stability\":0,\"difficulty\":0,\"reps\":0,\"learningSteps\":0,\"lastReview\":null}' WHERE id = 'bf-cloze-nohint'");
      db.execRawSql("UPDATE cards SET fsrs_json = '{\"state\":\"new\",\"due\":99,\"lapses\":0,\"stability\":0,\"difficulty\":0,\"reps\":0,\"learningSteps\":0,\"lastReview\":null}' WHERE id = 'bf-cloze-withback'");
      db.createCard({ id: "bf-broken", noteText: "n", frontMarkdown: "f", backMarkdown: "b" });
      db.execRawSql("UPDATE cards SET fsrs_json = '{broken' WHERE id = 'bf-broken'");
      db.createCard({ id: "bf-deleted", noteText: "{{c1::删::提}}", cardType: "cloze", frontMarkdown: "{{c1::删::提}}", backMarkdown: "" });
      db.execRawSql("UPDATE cards SET is_deleted = 1 WHERE id = 'bf-deleted'");
      db.persistDb();

      const untouchedBefore = {};
      for (const id of ["bf-review-legacy", "bf-modern", "bf-broken", "bf-cloze-nohint", "bf-cloze-withback", "bf-deleted"]) {
        untouchedBefore[id] = db.getCard(id);
      }
      // 损坏行的映射 fsrs.due = normalizeFsrs 兜底 Date.now()（每次映射必变，映射层时间噪声）——
      // 比较时排除 fsrs 键；damaged 恒 true 即「raw 仍是损坏 JSON」的机械证据（若被回填改写为合法
      // JSON，damaged 必翻 false）。其余行整行全等。
      const cmpRow = (before, id) => {
        const a = before[id], b = db.getCard(id);
        if (id === "bf-broken") {
          const { fsrs: _fa, ...ra } = a;
          const { fsrs: _fb, ...rb } = b;
          return eq(ra, rb) && b.damaged === true;
        }
        return eq(a, b);
      };
      const clozeHintBefore = db.getCard("bf-cloze-hint");

      // 清标记 → 重启模拟（initDb 从文件重载后挂载回填）
      clearMarker();
      await db.initDb();

      const newLegacy = db.getCard("bf-new-legacy");
      check("真库：createCard 默认 3 字段新卡被回填（S/D=0 追加，state/due/lapses 保值）",
        newLegacy.fsrs && newLegacy.fsrs.stability === 0 && newLegacy.fsrs.difficulty === 0 && newLegacy.fsrs.state === "new" && typeof newLegacy.fsrs.due === "number" && newLegacy.fsrs.lapses === 0,
        "S/D=0 追加", newLegacy.fsrs);
      check("真库：review 态缺 S/D 行未被回填", cmpRow(untouchedBefore, "bf-review-legacy"),
        "行级不变", db.getCard("bf-review-legacy").fsrs);
      check("真库：cloze hint 卡答案物化且 front/note 逐字符未动",
        db.getCard("bf-cloze-hint").backMarkdown === "答案A（答案B）"
          && db.getCard("bf-cloze-hint").frontMarkdown === clozeHintBefore.frontMarkdown
          && db.getCard("bf-cloze-hint").noteText === clozeHintBefore.noteText,
        "答案A（答案B）", db.getCard("bf-cloze-hint").backMarkdown);
      check("真库：per-blank 卡只物化自己被遮 ord（clozeOrds=[2] → 乙（提2））",
        db.getCard("bf-cloze-perblank").backMarkdown === "乙（提2）", "乙（提2）", db.getCard("bf-cloze-perblank").backMarkdown);
      const rowDiff = (id) => {
        const a = untouchedBefore[id]; const b = db.getCard(id);
        const out = {};
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
          if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out[k] = [a[k], b[k]];
        }
        return out;
      };
      const drift5 = ["bf-review-legacy", "bf-modern", "bf-broken", "bf-cloze-nohint", "bf-cloze-withback", "bf-deleted"]
        .filter((id) => !cmpRow(untouchedBefore, id));
      check("真库：未匹配行（review态/8字段/损坏/无hint/已有back/软删）行级零漂移", drift5.length === 0, "零漂移",
        drift5.map((id) => ({ id, diff: rowDiff(id) })));
      const marker1 = metaMarker();
      check("真库：重启后完成标记重新写入（app_meta）", typeof marker1 === "string" && Number(marker1) > 0, "number-like string", marker1);

      // 二次重启：标记在场 → 挂载回填零写入（行级 + 标记值不变）
      const markerBefore = marker1;
      const allBefore = {};
      for (const id of ["bf-new-legacy", "bf-review-legacy", "bf-modern", "bf-cloze-hint", "bf-cloze-perblank", "bf-cloze-nohint", "bf-cloze-withback", "bf-broken", "bf-deleted"]) {
        allBefore[id] = db.getCard(id);
      }
      await db.initDb();
      const drift6 = Object.keys(allBefore).filter((id) => !cmpRow(allBefore, id));
      check("二次重启：全部行零漂移（标记短路）", drift6.length === 0, "零漂移", drift6);
      check("二次重启：标记时间戳不变（未重写）", metaMarker() === markerBefore, markerBefore, metaMarker());
    }

    console.log(`\n==== legacyBackfill.test：${pass} 通过 / ${fail} 失败 ====`);
  } catch (e) {
    console.error("测试异常：", e && e.stack || e);
    fail++;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 清理失败忽略 */ }
    const code = fail === 0 ? 0 : 1;
    app.exit(code); // D239：app.quit() 会先以 0 退出、定时器里的 process.exit 来不及执行——直接 app.exit(code)
  }
});
