// M13 GF-1 成长反馈数据面——db 只读聚合出口 + 只读不变量 + 撤销联动（electron 直跑，A3 产出）
// @runtime: electron  @tier: 2  @gui: false  @id: M13  @timeout: 300
// 运行：npx electron tests/m13.test.cjs   （隔离临时库；先关应用）
// 依据：docs/design/GROWTH-FEEDBACK-D129.md §3.3/§3.4 + §6.2（断言清单 N-1…N-12）；契约 §4.17/§4.2-22。
// 覆盖：overview 形状 / 防回灌（triggerSeq 严格等值）/ 真实跨档与 L3 分流 / 撤销联动 / 会话窗口与折叠 /
//       设置关闭零计算短路 / 损坏行容错 / 挂起卡排除 / 口径一致性（per-grade 并 ≡ 窗口重算）/
//       学习日折叠边界（dayCutoffHour≠0）/ 零写不变量（行级 + 库文件字节级）/ IPC 形状对账。
// 隔离：userData 指向临时目录，全新 library.db，绝不触碰真实库（§7.3）。
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

const ROOT = path.join(__dirname, "..");
const DAY = 86_400_000;

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "m13-growth-test-"));
  const dbFile = path.join(tmp, "library.db");
  try {
    app.setPath("userData", tmp);
    const db = require(path.join(ROOT, "electron", "db.js"));
    await db.initDb();
    const st = require(path.join(ROOT, "electron", "settingsStore.js")); // userData 已就位后再 require（SETTINGS_FILE 定格）
    const setSetting = (patch) => { const o = st.readSettings(); o.app = { ...(o.app || {}), ...patch }; st.writeSettings(o); };

    // ---- 造数工具（真实 db.createCard / saveReview，§6.2 N-1 要求）----
    const mkCard = (id, book, domain, extra = {}) => {
      const r = db.createCard({
        id, noteText: `${id} 笔记`, frontMarkdown: `${id} 正面`, backMarkdown: `${id} 背面`,
        contextRef: { documentId: book.documentId }, domain, ...extra
      });
      if (!r || !r.id) throw new Error(`建卡失败：${id}`);
      return r.id;
    };
    // 单次评分：before=卡当前状态（过 A-7 重复提交守卫），after=注入的目标状态（测试构造，生产路径由 FSRS 引擎给出）
    const grade = (cardId, patch) => {
      const cur = (db.getCard(cardId).fsrs) || { state: "new", lapses: 0, reps: 0 };
      const after = {
        state: patch.state ?? "review",
        stability: patch.stability ?? 0,
        difficulty: patch.difficulty ?? (cur.difficulty ?? 5),
        due: Date.now() + DAY,
        lapses: patch.lapses ?? (cur.lapses ?? 0),
        reps: (Number(cur.reps) || 0) + 1,
        lastReview: Date.now(),
        learningSteps: []
      };
      db.saveReview(cardId, after, "good", 1000, cur);
      return after;
    };

    // ---------------------------------------------------------------- N-0（复审 P3-1 补：全新空库）
    console.log("== N-0 全新空库三出口：返回安全空形状且不抛（复审 P3-1 回归锁） ==");
    {
      let note = null;
      let ar = null, ss = null, ov = null;
      try {
        ar = db.getGrowthAfterReview("m13-no-such-card");
        ss = db.getGrowthSessionSummary(0);
        ov = db.getGrowthOverview({});
      } catch (e) { note = String((e && e.message) || e); }
      check("空库三出口全部不抛", note === null, "不抛", note);
      check("afterReview 空库安全形状（enabled=true 且 toast=null、others=[]）",
        eq(JSON.stringify(ar), '{"enabled":true,"toast":null,"others":[]}'), '{"enabled":true,"toast":null,"others":[]}', JSON.stringify(ar));
      check("sessionSummary 空库安全形状（fromTs=0 且 hits/folded 空数组）",
        eq(JSON.stringify(ss), '{"enabled":true,"fromTs":0,"hits":[],"folded":[]}'), '{"enabled":true,"fromTs":0,"hits":[],"folded":[]}', JSON.stringify(ss));
      check("overview 空库安全形状（recentEvents/totals/territory 空、knowledge=null）",
        Boolean(ov) && ov.enabled === true && Array.isArray(ov.recentEvents) && ov.recentEvents.length === 0
          && eq(ov.totals, { l0: 0, l1: 0, l2: 0 }) && Array.isArray(ov.territory.rows) && ov.territory.rows.length === 0
          && ov.knowledge === null,
        { enabled: true, recentEvents: 0, totals: { l0: 0, l1: 0, l2: 0 }, territoryRows: 0, knowledge: null },
        ov && { enabled: ov.enabled, recentEvents: ov.recentEvents && ov.recentEvents.length, totals: ov.totals, territoryRows: ov.territory && ov.territory.rows.length, knowledge: ov.knowledge });
    }

    console.log("== 种子库（书 A/B/C + 卡 + 真实评分历史） ==");
    const bookA = db.createFromPaste("M13 成长样本书A", "# A\n\n正文。");
    const bookB = db.createFromPaste("M13 挂起样本书B", "# B\n\n正文。");
    const bookC = db.createFromPaste("M13 一致性书C", "# C\n\n正文。");

    // 书 A（领域 004）：m13-undo（10 条历史日志）/ jump（N-3/N-4）/ win-old（N-5 窗口外）/ fold-1、fold-2（N-5 折叠对）/
    // s0–s3（材料样本巩固）/ s4–s6（N-10 学习日折叠边界）/ win-a、win-b（sg-m13 组毕业）/ bad（N-7 损坏行）
    for (const id of ["m13-undo", "m13-jump", "m13-win-old", "m13-fold-1", "m13-fold-2",
      "m13-s0", "m13-s1", "m13-s2", "m13-s3", "m13-s4", "m13-s5", "m13-s6",
      "m13-win-a", "m13-win-b", "m13-bad"]) {
      mkCard(id, bookA, ["004"], id === "m13-win-a" || id === "m13-win-b" ? { siblingKey: "sg-m13" } : {});
    }
    db.execRawSql("UPDATE cards SET fsrs_json = '{broken' WHERE id = 'm13-bad'"); // N-7：坏 JSON 卡
    for (let i = 1; i <= 10; i++) grade("m13-undo", { stability: i * 10 });        // 存量跨越：60 档在第 7 条
    for (const id of ["m13-s0", "m13-s1", "m13-s2", "m13-s3"]) grade(id, { stability: 30 });
    grade("m13-win-old", { stability: 65 });
    db.execRawSql("UPDATE review_logs SET reviewed_at = ? WHERE card_id = 'm13-win-old'", [Date.now() - 3 * DAY]); // 挪到窗口外
    grade("m13-fold-1", { stability: 200 });
    grade("m13-fold-2", { stability: 200 });
    grade("m13-win-a", { stability: 10 });
    grade("m13-win-b", { stability: 10 }); // sg-m13 组在此全体 review（组毕业跨越）

    // 书 B（领域 159.9）：8 卡 4 巩固，其中 1 张先挂起（N-8）
    for (let i = 0; i < 8; i++) mkCard(`m13-b${i}`, bookB, ["159.9"]);
    for (let i = 0; i < 4; i++) grade(`m13-b${i}`, { stability: 30 });
    db.setCardSuspended("m13-b0", true, "m13-test");

    // ---------------------------------------------------------------- N-1
    console.log("== N-1 getGrowthOverview 形状（enabled/now/cutoffHour/recentEvents/totals/territory 全键） ==");
    {
      const t0 = Date.now();
      const ov = db.getGrowthOverview({});
      const ms = Date.now() - t0;
      check("enabled=true 且全键在场", ov.enabled === true && "now" in ov && "cutoffHour" in ov && "recentEvents" in ov && "totals" in ov && "territory" in ov,
        ["enabled", "now", "cutoffHour", "recentEvents", "totals", "territory", "knowledge"], Object.keys(ov));
      check("now/cutoffHour 值域", Number.isFinite(ov.now) && Number.isInteger(ov.cutoffHour) && ov.cutoffHour >= 0 && ov.cutoffHour <= 23, true, { now: ov.now, cutoffHour: ov.cutoffHour });
      check("recentEvents 为数组且按 triggerSeq 倒序", Array.isArray(ov.recentEvents) && ov.recentEvents.every((h, i, a) => i === 0 || a[i - 1].triggerSeq >= h.triggerSeq), true, ov.recentEvents.length);
      check("totals 键 = l0/l1/l2", eq(Object.keys(ov.totals).sort(), ["l0", "l1", "l2"]), ["l0", "l1", "l2"], Object.keys(ov.totals).sort());
      check("territory.rows 为数组且行键齐全", Array.isArray(ov.territory.rows) && ov.territory.rows.every((r) => ["kind", "id", "label", "total", "new", "learning", "reviewing", "consolidated", "coverage", "crossedHalf", "crossedFull"].every((k) => k in r)), true, ov.territory.rows.length);
      check("knowledge 为 null（GF-2 预留，§3.5）", ov.knowledge === null, null, ov.knowledge);
      check("limit 截断生效（limit:2）", db.getGrowthOverview({ limit: 2 }).recentEvents.length <= 2, true, db.getGrowthOverview({ limit: 2 }).recentEvents.length);
      if (ms > 500) console.log(`  ⚠ R2 计时注记：getGrowthOverview 耗时 ${ms}ms（>500ms，报告注名）`);
      else console.log(`  ⓘ R2 计时注记：getGrowthOverview 耗时 ${ms}ms`);
    }

    // ---------------------------------------------------------------- N-2
    console.log("== N-2 防回灌：存量历史跨越不返回任何 toast（triggerSeq 严格等值，§4.17-6③） ==");
    {
      const res = db.getGrowthAfterReview("m13-undo");
      check("最新评分（第 10 条，90→100 无新跨越）→ toast=null", res.enabled === true && res.toast === null, { enabled: true, toast: null }, { enabled: res.enabled, toast: res.toast });
      check("others 也为空（存量命中一律不回流）", Array.isArray(res.others) && res.others.length === 0, [], res.others);
      const ov = db.getGrowthOverview({});
      check("档案不含 L3（retention-60 仅汇总面，§4.17-7①）", ov.recentEvents.every((h) => !(h.entityId === "m13-undo" && h.type === "retention-60")), true, ov.recentEvents.filter((h) => h.entityId === "m13-undo").map((h) => h.type));
      const sum = db.getGrowthSessionSummary(0);
      const derived = sum.hits.filter((h) => h.entityId === "m13-undo" && h.type === "retention-60");
      check("该卡的 retention-60 跨越确实可派生（汇总面在场——未弹只因防回灌）", derived.length === 1 && derived[0].triggerSeq > 0, true, derived.map((h) => h.triggerSeq));
    }

    // ---------------------------------------------------------------- N-3
    console.log("== N-3 评分真实跨档：直接越过 180/60 两档 → toast=retention-180，L3（60）正确分流进 others ==");
    {
      grade("m13-jump", { stability: 200 }); // new → review/200：同一条日志跨 60 与 180 两档
      const res = db.getGrowthAfterReview("m13-jump");
      check("toast 命中 retention-180（两档同跨取高档）", res.toast && res.toast.type === "retention-180", "retention-180", res.toast && res.toast.type);
      check("toast 的 surface 含 toast", Array.isArray(res.toast.surface) && res.toast.surface.includes("toast"), true, res.toast && res.toast.surface);
      check("retention-60（L3）进 others 且 surface 不含 toast（仅汇总）",
        res.others.some((h) => h.type === "retention-60" && !h.surface.includes("toast")), true, res.others.map((h) => `${h.type}:${h.surface.join("/")}`));
      check("others 不再含 retention-180（至多一条进 toast）", res.others.every((h) => h.type !== "retention-180"), true, res.others.map((h) => h.type));
      check("toast 证据链 evidence.docTitle=实际书名（afterReview 装载 docTitle 回补，复审 P1 回归锁）",
        Boolean(res.toast) && res.toast.evidence && res.toast.evidence.docTitle === bookA.title,
        bookA.title, res.toast && res.toast.evidence && res.toast.evidence.docTitle);
    }

    // ---------------------------------------------------------------- N-4
    console.log("== N-4 撤销联动：undoLastReview 后对应事件从汇总/档案消失（静默回退） ==");
    {
      const before = db.getGrowthOverview({});
      check("撤销前档案含 m13-jump 的 retention-180", before.recentEvents.some((h) => h.entityId === "m13-jump" && h.type === "retention-180"), true, before.recentEvents.filter((h) => h.entityId === "m13-jump").map((h) => h.type));
      const undo = db.undoLastReview();
      check("undoLastReview 成功", undo && undo.ok === true, true, undo);
      const after = db.getGrowthOverview({});
      check("撤销后档案不再含 m13-jump 的任何事件", after.recentEvents.every((h) => h.entityId !== "m13-jump"), true, after.recentEvents.filter((h) => h.entityId === "m13-jump").map((h) => h.type));
      const sum = db.getGrowthSessionSummary(0);
      check("撤销后会话汇总不再含 m13-jump", sum.hits.every((h) => h.entityId !== "m13-jump") && sum.folded.every((f) => f.hits.every((h) => h.entityId !== "m13-jump")), true, sum.hits.filter((h) => h.entityId === "m13-jump").length);
    }

    // ---------------------------------------------------------------- N-5
    console.log("== N-5 会话汇总窗口：窗口外不计入；窗口内多命中按表序；L2 折叠计数正确 ==");
    {
      const from = Date.now() - 1 * DAY; // win-old（3 天前）在窗外，其余评分都在窗内
      const sum = db.getGrowthSessionSummary(from);
      check("enabled 且形状正确", sum.enabled === true && "fromTs" in sum && Array.isArray(sum.hits) && Array.isArray(sum.folded), true, Object.keys(sum));
      check("窗口外日志不计入（m13-win-old 的 retention-60 缺席）", sum.hits.every((h) => h.entityId !== "m13-win-old") && sum.folded.every((f) => f.hits.every((h) => h.entityId !== "m13-win-old")), true, "无 win-old");
      check("组毕业命中在场（sg-m13，dimension=review）", sum.hits.some((h) => h.type === "group" && h.entityId === "sg-m13" && h.dimension === "review"), true, sum.hits.filter((h) => h.type === "group").map((h) => h.entityId));
      check("L3 照常列出（m13-undo 的 retention-60 在 hits）", sum.hits.some((h) => h.type === "retention-60" && h.entityId === "m13-undo"), true, sum.hits.filter((h) => h.type === "retention-60").map((h) => h.entityId));
      check("行序 = 表序（TYPE_ORDER 下标非降）", (() => {
        const idx = (h) => require(path.join(ROOT, "electron", "growth.js")).TYPE_ORDER.indexOf(h.type);
        return sum.hits.every((h, i, a) => i === 0 || idx(a[i - 1]) <= idx(h));
      })(), true, sum.hits.map((h) => h.type));
      const f180 = sum.folded.find((f) => f.type === "retention-180");
      check("retention-180 折叠：可见首条 fold-1、折叠 fold-2（count=1）", Boolean(f180) && f180.count === 1 && f180.hits.length === 1 && f180.hits[0].entityId === "m13-fold-2" && sum.hits.some((h) => h.type === "retention-180" && h.entityId === "m13-fold-1"),
        { visible: "m13-fold-1", folded: "m13-fold-2" }, f180 && { folded: f180.hits.map((h) => h.entityId) });
      // material 折叠断言（复审 P3-2 改写）：书维（libraryItemId=randomUUID）与领域维（"004"）同日同型，
      // 孰可见孰折入取决于 compareHits 的实体 id 字典序——不假设 randomUUID 与 "004" 的相对顺序，
      // 只断言显式已知事实「两实体恰一可见一折入 + 折叠 count=1」。
      const fMats = sum.folded.filter((f) => f.type === "material");
      const visMatIds = sum.hits.filter((h) => h.type === "material").map((h) => h.entityId);
      const matPair = [bookA.id, "004"].sort().join("|");
      check("material 双维同日折叠：书/领域两实体恰一可见一折入（不依赖 id 字典序，复审 P3-2）",
        fMats.length === 1 && fMats[0].count === 1 && fMats[0].hits.length === 1 && visMatIds.length === 1
          && [...visMatIds, fMats[0].hits[0].entityId].sort().join("|") === matPair,
        { pair: matPair, visible: 1, folded: 1 }, { visible: visMatIds, folded: fMats.map((f) => f.hits.map((h) => h.entityId)) });
      const matBookHit = [...sum.hits, ...fMats.flatMap((f) => f.hits)].find((h) => h.type === "material" && h.entityId === bookA.id);
      check("material 书维命中 entityLabel/evidence.docTitle=实际书名（sessionSummary 装载 docTitle 回补，复审 P1 回归锁）",
        Boolean(matBookHit) && matBookHit.entityLabel === bookA.title && Boolean(matBookHit.evidence) && matBookHit.evidence.docTitle === bookA.title,
        { entityLabel: bookA.title, docTitle: bookA.title },
        matBookHit && { entityLabel: matBookHit.entityLabel, docTitle: matBookHit.evidence && matBookHit.evidence.docTitle });
    }

    // ---------------------------------------------------------------- N-6
    console.log("== N-6 设置关闭：三出口返回 {enabled:false} 且不产生任何派生（零计算短路） ==");
    {
      setSetting({ growthFeedback: { enabled: false } });
      const a = db.getGrowthAfterReview("m13-undo");
      const s = db.getGrowthSessionSummary(0);
      const o = db.getGrowthOverview({});
      check("afterReview 短路返回体恰为 {enabled:false}（无 hits/toast 键）", eq(JSON.stringify(a), '{"enabled":false}'), '{"enabled":false}', JSON.stringify(a));
      check("sessionSummary 短路返回体恰为 {enabled:false}", eq(JSON.stringify(s), '{"enabled":false}'), '{"enabled":false}', JSON.stringify(s));
      check("overview 短路返回体恰为 {enabled:false}", eq(JSON.stringify(o), '{"enabled":false}'), '{"enabled":false}', JSON.stringify(o));
      // 复审 P3-1 补：设置键整值为布尔 false 的形态（手改文件）——db.js 读侧「仅严格 false 为关」同样判定
      setSetting({ growthFeedback: false });
      const aF = db.getGrowthAfterReview("m13-undo");
      const sF = db.getGrowthSessionSummary(0);
      const oF = db.getGrowthOverview({});
      check("整值布尔 false 形态：三出口同样短路恰为 {enabled:false}",
        eq(JSON.stringify(aF), '{"enabled":false}') && eq(JSON.stringify(sF), '{"enabled":false}') && eq(JSON.stringify(oF), '{"enabled":false}'),
        '{"enabled":false}×3', { a: JSON.stringify(aF), s: JSON.stringify(sF), o: JSON.stringify(oF) });
      setSetting({ growthFeedback: { enabled: true } });
      check("重新开启后出口恢复派生", db.getGrowthOverview({}).enabled === true && db.getGrowthAfterReview("m13-undo").enabled === true, true, "enabled=true");
    }

    // ---------------------------------------------------------------- N-7
    console.log("== N-7 损坏行（fsrs_json 坏 JSON）被跳过不炸（照 computeTodayQueue 容错口径） ==");
    {
      let note = null;
      try {
        const res = db.getGrowthAfterReview("m13-bad");
        if (!res || res.toast !== null) note = `afterReview 异常返回：${JSON.stringify(res)}`;
        const ov = db.getGrowthOverview({});
        if (!ov || !ov.enabled) note = "overview 不可用";
        else if (ov.territory.rows.some((r) => r.id === bookA.id && r.total !== 14)) note = `书A样本数异常：${ov.territory.rows.find((r) => r.id === bookA.id).total}（应为 14=15 卡扣除坏行）`;
        db.getGrowthSessionSummary(0);
      } catch (e) { note = String((e && e.message) || e); }
      check("坏行被跳过，三出口全部不抛", note === null, "不抛", note);
    }

    // ---------------------------------------------------------------- N-8
    console.log("== N-8 挂起卡不计入 material 样本（活跃 7<8 → 零事件；解挂后恢复） ==");
    {
      const ovSuspended = db.getGrowthOverview({});
      check("挂起时书 B 无 territory 行（7<8 样本门槛）", ovSuspended.territory.rows.every((r) => r.id !== bookB.id), true, ovSuspended.territory.rows.map((r) => r.id));
      check("挂起时领域 159.9 无 territory 行", ovSuspended.territory.rows.every((r) => r.id !== "159.9"), true, ovSuspended.territory.rows.filter((r) => r.kind === "domain").map((r) => r.id));
      check("挂起时无书 B 的 material 事件", ovSuspended.recentEvents.every((h) => h.type !== "material" || (h.entityId !== bookB.id && h.entityId !== "159.9")), true, ovSuspended.recentEvents.filter((h) => h.type === "material").map((h) => h.entityId));
      db.setCardSuspended("m13-b0", false, null);
      const ovFree = db.getGrowthOverview({});
      const rowB = ovFree.territory.rows.find((r) => r.id === bookB.id);
      check("解挂后书 B 行在场：total=8、consolidated=4、coverage=0.5", Boolean(rowB) && rowB.total === 8 && rowB.consolidated === 4 && Math.abs(rowB.coverage - 0.5) < 1e-9, { total: 8, consolidated: 4, coverage: 0.5 }, rowB && { total: rowB.total, consolidated: rowB.consolidated, coverage: rowB.coverage });
      check("解挂后 crossedHalf=true（现状标记）", Boolean(rowB) && rowB.crossedHalf === true, true, rowB && rowB.crossedHalf);
      check("解挂后 material half 事件可派生（书维 + 领域维）", ovFree.recentEvents.some((h) => h.type === "material" && h.dimension === "half" && h.entityId === bookB.id) && ovFree.recentEvents.some((h) => h.type === "material" && h.dimension === "half" && h.entityId === "159.9"), true, ovFree.recentEvents.filter((h) => h.type === "material").map((h) => `${h.entityId}:${h.dimension}`));
      // 复审 P1 回归锁：overview 装载路径 docTitle 回补——书行 label 与书维事件书名（非 UUID/undefined）
      check("territory 书行 label=实际书名（overview 装载 docTitle 回补，复审 P1）",
        Boolean(rowB) && rowB.label === bookB.title, bookB.title, rowB && rowB.label);
      const matHitB = ovFree.recentEvents.find((h) => h.type === "material" && h.entityId === bookB.id);
      check("material 书维事件 entityLabel/evidence.docTitle=实际书名（复审 P1）",
        Boolean(matHitB) && matHitB.entityLabel === bookB.title && Boolean(matHitB.evidence) && matHitB.evidence.docTitle === bookB.title,
        { entityLabel: bookB.title, docTitle: bookB.title },
        matHitB && { entityLabel: matHitB.entityLabel, docTitle: matHitB.evidence && matHitB.evidence.docTitle });
    }

    // ---------------------------------------------------------------- N-9
    console.log("== N-9 口径一致性：「per-grade 出口多次结果之并」≡「sessionSummary 窗口一次重算」 ==");
    {
      for (let i = 0; i < 8; i++) mkCard(`m13-c9-${i}`, bookC, ["51"], i === 4 || i === 5 ? { siblingKey: "sg-c9" } : {});
      const sessionStart = Date.now();
      const union = [];
      const collect = (id) => {
        const res = db.getGrowthAfterReview(id);
        if (res.enabled) for (const h of [res.toast, ...res.others]) if (h) union.push(h);
      };
      for (const id of ["m13-c9-0", "m13-c9-1", "m13-c9-2", "m13-c9-3"]) { grade(id, { stability: 30 }); collect(id); }
      grade("m13-c9-4", { stability: 10 }); collect("m13-c9-4");
      grade("m13-c9-5", { stability: 10 }); collect("m13-c9-5"); // sg-c9 组毕业 + 4/8=50% 材料过半都在此前后发生
      for (const id of ["m13-c9-6", "m13-c9-7"]) { grade(id, { state: "learning", stability: 2 }); collect(id); }
      const sum = db.getGrowthSessionSummary(sessionStart);
      const full = [...sum.hits, ...sum.folded.flatMap((f) => f.hits)];
      const sig = (h) => `${h.key}|${h.triggerSeq}`;
      const canon = (arr) => arr.map(sig).sort();
      check("差分证明：union ≡ 窗口重算（可见 ∪ 折叠）", eq(canon(union), canon(full)), canon(full).length, { union: canon(union).length, full: canon(full).length });
      if (!eq(canon(union), canon(full))) {
        console.log("      union 独有：", canon(union).filter((s) => !canon(full).includes(s)));
        console.log("      full  独有：", canon(full).filter((s) => !canon(union).includes(s)));
      }
      check("会话内确有命中（非空转）", union.length > 0, true, union.map(sig));
      check("材料 half 命中在会话窗口内被捕获", union.some((h) => h.type === "material" && h.dimension === "half" && h.entityId === bookC.id), true, union.filter((h) => h.type === "material").map((h) => `${h.entityId}:${h.dimension}`));
      check("组毕业命中在会话窗口内被捕获", union.some((h) => h.type === "group" && h.entityId === "sg-c9"), true, union.filter((h) => h.type === "group").map((h) => h.entityId));
    }

    // ---------------------------------------------------------------- N-10
    console.log("== N-10 now/切点跨学习日折叠边界（dayCutoffHour=4，D23 口径） ==");
    {
      grade("m13-s4", { stability: 200 });
      grade("m13-s5", { stability: 200 });
      grade("m13-s6", { stability: 200 });
      // 三条跨越日志回收到「2 天前」的本地 03:00 / 05:00 / 06:00（恒在过去，且与窗口断言解耦）
      const base = new Date(Date.now() - 2 * DAY); base.setHours(3, 0, 0, 0);
      const t03 = base.getTime(), t05 = t03 + 2 * 3600_000, t06 = t03 + 3 * 3600_000;
      db.execRawSql("UPDATE review_logs SET reviewed_at = ? WHERE card_id = 'm13-s4'", [t03]);
      db.execRawSql("UPDATE review_logs SET reviewed_at = ? WHERE card_id = 'm13-s5'", [t05]);
      db.execRawSql("UPDATE review_logs SET reviewed_at = ? WHERE card_id = 'm13-s6'", [t06]);
      setSetting({ dayCutoffHour: 4 });
      const growthJs = require(path.join(ROOT, "electron", "growth.js"));
      const ov = db.getGrowthOverview({});
      check("cutoffHour 读到 4", ov.cutoffHour === 4, 4, ov.cutoffHour);
      const dayOf = (ts) => { const { learningDayStartMs } = require(path.join(ROOT, "electron", "fsrsTime.js")); return learningDayStartMs(ts, 4); };
      check("03:00 与 05:00 属不同学习日（切点 4:00 生效）", dayOf(t03) !== dayOf(t05), true, { d03: dayOf(t03), d05: dayOf(t05) });
      check("05:00 与 06:00 属同一学习日", dayOf(t05) === dayOf(t06), true, "同日");
      const sum = db.getGrowthSessionSummary(0);
      check("s4（前一学习日）不折叠、可见", sum.hits.some((h) => h.type === "retention-180" && h.entityId === "m13-s4"), true, sum.hits.filter((h) => h.type === "retention-180").map((h) => h.entityId));
      check("s5（当日首条）可见", sum.hits.some((h) => h.type === "retention-180" && h.entityId === "m13-s5"), true, sum.hits.filter((h) => h.type === "retention-180").map((h) => h.entityId));
      const entry = sum.folded.find((f) => f.type === "retention-180" && f.dayStart === dayOf(t05));
      check("s6 折入 s5 所在学习日（count=1）", Boolean(entry) && entry.count === 1 && entry.hits.length === 1 && entry.hits[0].entityId === "m13-s6",
        { folded: "m13-s6", dayStart: dayOf(t05) }, entry && { folded: entry.hits.map((h) => h.entityId) });
      setSetting({ dayCutoffHour: 0 });
    }

    // ---------------------------------------------------------------- N-12
    console.log("== N-12 IPC 形状对账：三通道注册 + preload 桥面 + 返回值可 JSON 序列化且符合 §3.4 ==");
    {
      const mainSrc = fs.readFileSync(path.join(ROOT, "electron", "main.js"), "utf8");
      const handles = [...mainSrc.matchAll(/ipcMain\.handle\("([^"]+)"/g)].map((m) => m[1]).filter((ch) => ch.startsWith("growth:"));
      check("主进程恰好注册 3 条 growth 通道（顺序 §3.4）", eq(handles, ["growth:afterReview", "growth:sessionSummary", "growth:overview"]), ["growth:afterReview", "growth:sessionSummary", "growth:overview"], handles);
      const preloadSrc = fs.readFileSync(path.join(ROOT, "electron", "preload.js"), "utf8");
      check("preload 暴露 growthAPI（防漏桥）", /exposeInMainWorld\(\s*["']growthAPI["']/.test(preloadSrc), true, "growthAPI");
      for (const ch of ["growth:afterReview", "growth:sessionSummary", "growth:overview"]) {
        check(`preload invoke 对上 ${ch}`, preloadSrc.includes(`invoke("${ch}"`), true, ch);
      }
      const round = (v) => JSON.parse(JSON.stringify(v));
      const a = db.getGrowthAfterReview("m13-undo");
      const s = db.getGrowthSessionSummary(0);
      const o = db.getGrowthOverview({});
      check("afterReview 返回值可 JSON 序列化且键符合 §3.4", eq(round(a), a) && eq(Object.keys(a), ["enabled", "toast", "others"]), true, Object.keys(a));
      check("sessionSummary 返回值可 JSON 序列化且键符合 §3.4", eq(round(s), s) && eq(Object.keys(s), ["enabled", "fromTs", "hits", "folded"]), true, Object.keys(s));
      check("overview 返回值可 JSON 序列化且键符合 §3.4", eq(round(o), o) && eq(Object.keys(o), ["enabled", "now", "cutoffHour", "recentEvents", "totals", "territory", "knowledge"]), true, Object.keys(o));
    }

    // ---------------------------------------------------------------- N-11（最后跑：零写不变量）
    console.log("== N-11 零写不变量：全套出口调用前后，各表逐行 JSON 全等 + 库文件字节级不变 ==");
    {
      const initSqlJs = require("sql.js");
      const SQL = await initSqlJs({ locateFile: (f) => path.join(ROOT, "node_modules", "sql.js", "dist", f) });
      const KEEP = /^(cards|review_logs|fsrs_configs|knowledge_.*)$/;
      const snap = () => {
        const bytes = fs.readFileSync(dbFile);
        const raw = new SQL.Database(bytes);
        const rows = (sql) => { const s2 = raw.prepare(sql); const out = []; while (s2.step()) out.push(s2.getAsObject()); s2.free(); return out; };
        const data = {};
        for (const t of rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((r) => r.name)) {
          if (KEEP.test(t)) data[t] = JSON.stringify(rows(`SELECT * FROM "${t}" ORDER BY rowid`));
        }
        raw.close();
        return { b64: bytes.toString("base64"), data };
      };
      db.persistNow();
      const before = snap();
      // 全出口 × 多参数 × 设置开/关，全部只读
      for (const id of ["m13-undo", "m13-fold-1", "m13-c9-3", "m13-win-b", "m13-b0", "m13-bad"]) db.getGrowthAfterReview(id);
      db.getGrowthSessionSummary(0);
      db.getGrowthSessionSummary(Date.now() - DAY);
      db.getGrowthOverview({});
      db.getGrowthOverview({ limit: 5 });
      setSetting({ growthFeedback: { enabled: false } });
      db.getGrowthAfterReview("m13-undo"); db.getGrowthSessionSummary(0); db.getGrowthOverview({});
      setSetting({ growthFeedback: { enabled: true } });
      const after = snap();
      check("库文件字节级不变（读侧零写路径的机械证据）", before.b64 === after.b64, "bytes equal", before.b64.length === after.b64.length ? "length equal, content differs" : "length differs");
      const drift = Object.keys(before.data).filter((t) => before.data[t] !== after.data[t]);
      check("cards/review_logs/fsrs_configs/knowledge_* 逐行内容 JSON 全等", drift.length === 0, "无漂移", drift);
      if (before.b64 !== after.b64 && drift.length === 0) {
        console.log("  ⚠ 字节差异但行内容全等（落盘页级差异）——逐行不变量仍成立");
      }
    }

    console.log(`\n==== m13.test：${pass} 通过 / ${fail} 失败 ====`);
  } catch (e) {
    console.error("测试异常：", e && e.stack || e);
    fail++;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 清理失败忽略 */ }
    const code = fail === 0 ? 0 : 1;
    try { app.quit(); } catch { /* ignore */ }
    setTimeout(() => process.exit(code), 120); // Electron 下 process.exitCode 不可靠，照 dbenv.quit 模式显式退出
  }
});
