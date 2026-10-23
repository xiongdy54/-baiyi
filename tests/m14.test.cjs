// v45 M14-UM1 用户记忆回归测试（db 层，electron 直跑：npx electron tests/m14.test.cjs，须先关应用）
// @runtime: electron
// 隔离：userData 指向临时目录，全新 library.db + 全新 memory/ 文件树，绝不触碰真实库（§7.3）。
// 契约：§4.18 + §6.7 + §9.1 M14 + D39——不删不改写（op 词表封闭于追加与标记）/ 永不淘汰 /
//       水位线补处理（分批时间正序可续跑）/ 手写区保护 / user-memory v1 播种 / 零 FSRS 影响。
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const ROOT = require("path").resolve(__dirname, "..");

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "m14-test-"));
  try {
    app.setPath("userData", tmp);
    const db = require(path.join(ROOT, "electron", "db.js"));
    const prompts = require(path.join(ROOT, "electron", "prompts.js"));
    const memoryStore = require(path.join(ROOT, "electron", "memoryStore.js"));
    const memoryTidy = require(path.join(ROOT, "electron", "memoryTidy.js"));
    const backup = require(path.join(ROOT, "electron", "backup.js"));
    await db.initDb();

    const memDir = memoryStore.resolveMemoryDir(tmp);
    let fakeChats = [];
    const ctx = {
      db,
      readSettings: () => {
        try { return JSON.parse(fs.readFileSync(path.join(tmp, "settings.json"), "utf8")) || {}; }
        catch { return {}; }
      },
      writeSettings: (all) => fs.writeFileSync(path.join(tmp, "settings.json"), JSON.stringify(all)),
      userData: tmp,
      hasKey: () => true,
      chat: async () => {
        const h = fakeChats.shift();
        if (h == null) throw new Error("测试桩：没有更多 fake 响应");
        if (h instanceof Error) throw h;
        return typeof h === "function" ? h() : h;
      },
      broadcast: () => {}
    };

    console.log("== M14-1 user-memory v1 播种与契约抽查 ==");
    const tpl = db.getPromptTemplate("user-memory");
    check("user-memory v1 已播种", tpl && tpl.version === 1, true, tpl && tpl.version);
    check("与 prompts.js 基线字面一致", tpl && tpl.content === prompts.USER_MEMORY_PROMPT, true, tpl && tpl.version);
    check("op 词表封闭（add/merge/mark，无删除类）", tpl && tpl.content.includes('"op":"add"') && tpl.content.includes('"op":"merge"') && tpl.content.includes('"op":"mark"') && tpl.content.includes("此外任何操作一律禁止"), true, true);
    check("禁删改纪律在案", tpl && tpl.content.includes("禁止删除或改写既有正文") && tpl.content.includes("逐字照抄"), true, true);
    check("生活域封闭 9 分类", tpl && tpl.content.includes("工作与学业") && tpl.content.includes("观念与价值") && tpl.content.includes("其他"), true, true);
    check("手写区禁令", tpl && tpl.content.includes("用户手写区"), true, true);
    check("条目行格式与 ingest/consolidate 双轮", tpl && tpl.content.includes("【运行类型】") && tpl.content.includes("ingest") && tpl.content.includes("consolidate"), true, true);

    console.log("== M14-2 文件树脚手架与用量 ==");
    const created = memoryStore.ensureTree(memDir);
    check("脚手架建 core/index/topics", created.includes("core.md") && created.includes("index.md") && created.includes("topics/"), true, created);
    check("core 脚手架含手写区标记", memoryStore.readText(memDir, "core.md").includes(memoryStore.HANDWRITTEN_OPEN), true, true);
    const usage0 = memoryStore.usageStats(memDir);
    check("用量三段统计（初始 0 条目）", usage0.core.chars > 0 && usage0.index.chars > 0 && usage0.topics.length === 0, true, usage0);
    // v45.1（用户反馈）：HTML 注释标记在 Markdown 预览不可见——手写区内须有可见引导文字
    check("脚手架手写区含可见引导文字（预览中可见）",
      memoryStore.readText(memDir, "core.md").includes(memoryStore.HANDWRITTEN_HINT) && memoryStore.readText(memDir, "index.md").includes(memoryStore.HANDWRITTEN_HINT), true, true);
    // 存量升级：v45 初版空手写区自动补引导；用户已写内容的区域绝不触碰
    fs.writeFileSync(path.join(memDir, "index.md"), "# 记忆 · 目录\n\n<!-- 用户手写区 -->\n\n<!-- /用户手写区 -->\n", "utf8");
    memoryStore.ensureTree(memDir);
    check("存量空手写区自动补可见引导", memoryStore.readText(memDir, "index.md").includes(memoryStore.HANDWRITTEN_HINT), true, true);
    const userIndex = "# 记忆 · 目录\n\n<!-- 用户手写区 -->\n- 用户已写的一行备注\n\n<!-- /用户手写区 -->\n";
    fs.writeFileSync(path.join(memDir, "index.md"), userIndex, "utf8");
    memoryStore.ensureTree(memDir);
    const idxAfter = memoryStore.readText(memDir, "index.md");
    check("用户已写内容的手写区不被升级触碰", idxAfter.includes("用户已写的一行备注") && !idxAfter.includes(memoryStore.HANDWRITTEN_HINT), true, idxAfter);

    console.log("== M14-3 applyOps 矩阵（不删不改写） ==");
    // add：新主题文件自动创建
    let r = memoryStore.applyOps(memDir, [
      { op: "add", target: "topics/情绪与状态/睡眠.md", line: "- 2026-09-01 ｜ 连续两周入睡困难 ｜ [情绪与状态 · 睡眠]" },
      { op: "add", target: "core", line: "- 2026-09-02 ｜ 在读《控制论》项目 ｜ [工作与学业 · 读书项目]" }
    ]);
    check("add 主题文件与 core 均 applied", r.results.every((x) => x.status === "applied"), true, r.results);
    check("主题文件落盘且内容为条目行", memoryStore.readText(memDir, "topics/情绪与状态/睡眠.md").includes("入睡困难"), true, true);
    check("core 追加落盘", memoryStore.readText(memDir, "core.md").includes("读书项目"), true, true);
    // add 非法 target：index / 越界生活域 / 路径穿越
    r = memoryStore.applyOps(memDir, [
      { op: "add", target: "index", line: "- 2026-09-03 ｜ 非法" },
      { op: "add", target: "topics/不存在的域/主题.md", line: "- 2026-09-03 ｜ 非法" },
      { op: "add", target: "topics/情绪与状态/../..\\逃逸.md", line: "- 2026-09-03 ｜ 非法" }
    ]);
    check("非法 target 一律 rejected", r.results.every((x) => x.status === "rejected"), true, r.results.map((x) => x.reason));
    check("index.md 未被 AI 写入条目", !memoryStore.readText(memDir, "index.md").includes("非法"), true, true);
    // 未知 op（delete/rewrite）拒绝
    r = memoryStore.applyOps(memDir, [
      { op: "delete", target: "topics/情绪与状态/睡眠.md", match: "- 2026-09-01 ｜ 连续两周入睡困难 ｜ [情绪与状态 · 睡眠]" },
      { op: "rewrite", target: "core", line: "整文件重写" }
    ]);
    check("delete/rewrite 词表外 op rejected", r.results.every((x) => x.status === "rejected"), true, r.results.map((x) => x.reason));
    // merge：精确匹配 + 标记 + 追加合并行
    memoryStore.applyOps(memDir, [
      { op: "add", target: "topics/情绪与状态/睡眠.md", line: "- 2026-09-05 ｜ 昨晚失眠到两点 ｜ [情绪与状态 · 睡眠]" }
    ]);
    r = memoryStore.applyOps(memDir, [
      { op: "merge", target: "topics/情绪与状态/睡眠.md", match: "- 2026-09-05 ｜ 昨晚失眠到两点 ｜ [情绪与状态 · 睡眠]", line: "- 2026-09-05 ｜ 昨晚失眠到两点，凌晨两点才入睡 ｜ [情绪与状态 · 睡眠]" }
    ]);
    const sleepFile = memoryStore.readText(memDir, "topics/情绪与状态/睡眠.md");
    check("merge applied：追加合并行 + 原行加「已并入」标记", r.results[0].status === "applied" && sleepFile.includes("凌晨两点才入睡") && sleepFile.includes("失眠到两点 ｜ [情绪与状态 · 睡眠] <!-- 已并入 -->"), true, sleepFile);
    r = memoryStore.applyOps(memDir, [
      { op: "merge", target: "topics/情绪与状态/睡眠.md", match: "- 2026-09-05 ｜ 不存在的原行", line: "- x" }
    ]);
    check("merge 匹配失败 skipped 并留因", r.results[0].status === "skipped" && /精确匹配失败/.test(r.results[0].reason), true, r.results[0]);
    // mark：合法 tag 与非法 tag
    r = memoryStore.applyOps(memDir, [
      { op: "mark", target: "topics/情绪与状态/睡眠.md", match: "- 2026-09-05 ｜ 昨晚失眠到两点，凌晨两点才入睡 ｜ [情绪与状态 · 睡眠]", tag: "已结束" }
    ]);
    check("mark applied（行尾追加标记）", r.results[0].status === "applied" && memoryStore.readText(memDir, "topics/情绪与状态/睡眠.md").includes("<!-- 已结束 -->"), true, r.results[0]);
    r = memoryStore.applyOps(memDir, [
      { op: "mark", target: "core", match: "- 2026-09-02 ｜ 在读《控制论》项目 ｜ [工作与学业 · 读书项目]", tag: "删掉" }
    ]);
    check("mark 非法 tag rejected", r.results[0].status === "rejected", true, r.results[0].reason);

    console.log("== M14-4 手写区保护 ==");
    const coreText = memoryStore.readText(memDir, "core.md");
    const coreWithNote = coreText.replace("<!-- 用户手写区 -->", "<!-- 用户手写区 -->\n- 2020-01-01 ｜ 用户手写的一条私人记录");
    fs.writeFileSync(path.join(memDir, "core.md"), coreWithNote, "utf8");
    r = memoryStore.applyOps(memDir, [
      { op: "mark", target: "core", match: "- 2020-01-01 ｜ 用户手写的一条私人记录", tag: "已取代" },
      { op: "add", target: "core", line: "- 2026-09-06 ｜ AI 追加的一条 ｜ [兴趣与见闻 · 测试]" }
    ]);
    const coreAfter = memoryStore.readText(memDir, "core.md");
    check("手写区内行不可被 mark 命中", r.results[0].status === "skipped", true, r.results[0]);
    check("手写区行原样保留", coreAfter.includes("用户手写的一条私人记录") && !coreAfter.includes("用户手写的一条私人记录 <!--"), true, true);

    console.log("== M14-5 rebuildIndex（目录登记 + 手写区保留） ==");
    memoryStore.rebuildIndex(memDir);
    const indexText = memoryStore.readText(memDir, "index.md");
    check("目录登记主题（域分组 + 条数；带标记行不计活跃条目）", indexText.includes("## 情绪与状态") && indexText.includes("睡眠 · 1 条"), true, indexText.slice(0, 400));
    check("index 重建保留手写区结构", indexText.includes(memoryStore.HANDWRITTEN_OPEN), true, true);

    console.log("== M14-6 水位线读取（updated_at 增量 + 草稿排除 + 时间正序） ==");
    db.createJournalEntry({ contentMarkdown: "M14TEST 早期条目：和导师讨论了课题方向" });
    await sleep(5);
    db.createJournalEntry({ contentMarkdown: "M14TEST 近期条目：跑步五公里" });
    await sleep(5);
    db.saveJournalDraft("M14TEST 未发送草稿不入包");
    const allPending = db.listJournalEntriesSince({ sinceUpdatedAt: null, limit: 100 });
    check("全历史窗口含两条正式条目（草稿排除）", allPending.length === 2 && allPending.every((e) => !e.isDraft), true, allPending.map((e) => e.contentMarkdown));
    check("时间正序（早期在前）", allPending[0].contentMarkdown.includes("早期"), true, allPending.map((e) => e.contentMarkdown));
    const sinceWm = db.listJournalEntriesSince({ sinceUpdatedAt: allPending[0].updatedAt, limit: 100 });
    check("水位线后只剩近期条目", sinceWm.length === 1 && sinceWm[0].contentMarkdown.includes("近期"), true, sinceWm.map((e) => e.contentMarkdown));
    // 编辑旧条目 → updated_at 翻新 → 重新进入窗口（「新增/改动」口径）
    await sleep(5);
    db.updateJournalEntry(allPending[0].id, "M14TEST 早期条目（已编辑）：和导师讨论课题方向，决定先补统计基础");
    const rePending = db.listJournalEntriesSince({ sinceUpdatedAt: allPending[1].updatedAt, limit: 100 });
    check("编辑使旧条目重新待整理", rePending.length === 1 && rePending[0].id === allPending[0].id, true, rePending.map((e) => e.id));

    console.log("== M14-7 全管线（fake chat）：摄入轮 → 落盘 → 留痕 → 水位线推进 ==");
    // 默认关 → skipped
    let res = await memoryTidy.runIngestRound(ctx, "manual");
    check("开关默认关闭 → 零调用", res && res.ok === false && /未开启/.test(res.skipped), true, res);
    memoryTidy.writeMemoryConfig(ctx, { enabled: true, introAcked: true });
    // 无 Key → skipped
    const ctxNoKey = { ...ctx, hasKey: () => false };
    res = await memoryTidy.runIngestRound(ctxNoKey, "manual");
    check("无 Key → 静默跳过", res && res.ok === false && /Key/.test(res.skipped), true, res);
    // 正常一轮（batch=1 → 只处理最早的早期条目）
    memoryTidy.writeMemoryConfig(ctx, { backfillBatchEntries: 1, consolidateEveryRounds: 99 });
    fakeChats = [
      JSON.stringify({
        ops: [
          { op: "add", target: "topics/工作与学业/课题.md", line: "- 2026-09-10 ｜ 决定先补统计基础再推进课题 ｜ [工作与学业 · 课题]" }
        ]
      })
    ];
    res = await memoryTidy.runIngestRound(ctx, "manual");
    check("摄入轮 ok", res && res.ok === true, true, res);
    check("条目落盘", memoryStore.readText(memDir, "topics/工作与学业/课题.md").includes("统计基础"), true, true);
    const cfgNow = memoryTidy.readMemoryConfig(ctx);
    check("水位线推进到本批条目 updated_at", cfgNow.lastCoveredAt != null && cfgNow.lastCoveredAt >= allPending[0].updatedAt, true, cfgNow.lastCoveredAt);
    const runs1 = db.listMemoryRuns({});
    check("memory_runs 留痕（success + applied）", runs1.length >= 1 && runs1[0].status === "success" && Array.isArray(runs1[0].applied), true, runs1.map((x) => x.status));
    check("run 记录 prompt_scope/version", runs1[0].promptScope === "user-memory" && runs1[0].promptVersion === 1, true, runs1[0].promptScope);
    // AI 输出 delete op → rejected 留痕，正常 op 照常落地
    fakeChats = [
      JSON.stringify({
        ops: [
          { op: "delete", target: "topics/工作与学业/课题.md", match: "- 2026-09-10 ｜ 决定先补统计基础再推进课题 ｜ [工作与学业 · 课题]" },
          { op: "add", target: "topics/健康与作息/运动.md", line: "- 2026-09-11 ｜ 开始每周跑步三次 ｜ [健康与作息 · 运动]" }
        ]
      })
    ];
    res = await memoryTidy.runIngestRound(ctx, "manual");
    const runs2 = db.listMemoryRuns({});
    check("AI delete op 被拒且正常 op 照常落地", res.ok && memoryStore.readText(memDir, "topics/健康与作息/运动.md").includes("跑步三次") && runs2[0].applied.some((a) => a.status === "rejected" && a.op === "delete"), true, runs2[0].applied);
    check("被「删除」目标的行仍在（永不淘汰）", memoryStore.readText(memDir, "topics/工作与学业/课题.md").includes("统计基础"), true, true);
    // AI 输出坏 JSON → run failed，水位线不推进（先补一条待整理日记，否则轮次 skipped 不建 run）
    const wmBefore = memoryTidy.readMemoryConfig(ctx).lastCoveredAt;
    await sleep(5);
    db.createJournalEntry({ contentMarkdown: "M14TEST 坏 JSON 轮的待整理日记" });
    fakeChats = ["这不是 JSON {{{"];
    res = await memoryTidy.runIngestRound(ctx, "manual");
    check("坏 JSON → run failed", res && res.ok === false && !!res.runId, true, res);
    check("失败不推进水位线", memoryTidy.readMemoryConfig(ctx).lastCoveredAt === wmBefore, true, memoryTidy.readMemoryConfig(ctx).lastCoveredAt);
    const failedRuns = db.listMemoryRuns({});
    check("失败 run 留 error_text", failedRuns[0].status === "failed" && !!failedRuns[0].errorText, true, failedRuns[0].status);

    console.log("== M14-8 补处理：分批时间正序、逐批推进、可中止 ==");
    // 追加 3 条新日记（共 3 条待整理），batch=2 → 两批；第二批处理中触发中止
    await sleep(5);
    db.createJournalEntry({ contentMarkdown: "M14TEST 补处理批次一：看了半章《统计学习基础》" });
    await sleep(5);
    db.createJournalEntry({ contentMarkdown: "M14TEST 补处理批次二：和朋友聊到职业选择" });
    await sleep(5);
    db.createJournalEntry({ contentMarkdown: "M14TEST 补处理批次三：睡眠改善了一点" });
    memoryTidy.writeMemoryConfig(ctx, { backfillBatchEntries: 2 });
    fakeChats = [
      () => { memoryTidy.cancelBackfill(); return JSON.stringify({ ops: [{ op: "add", target: "topics/工作与学业/课题.md", line: "- 2026-09-12 ｜ 统计学习基础读到第三章 ｜ [工作与学业 · 课题]" }] }); },
      JSON.stringify({ ops: [] })
    ];
    res = await memoryTidy.runBackfill(ctx);
    check("中止生效（aborted=true）", res && res.ok === true && res.aborted === true, true, res);
    check("中止前批次的水位线已推进（可续跑）", memoryTidy.readMemoryConfig(ctx).lastCoveredAt > wmBefore, true, memoryTidy.readMemoryConfig(ctx).lastCoveredAt);
    check("中止后仍有待整理条目", memoryTidy.backfillStats(ctx).entryCount > 0, true, memoryTidy.backfillStats(ctx).entryCount);
    // 续跑到完
    fakeChats = [
      JSON.stringify({ ops: [{ op: "add", target: "topics/人际与家庭/社交.md", line: "- 2026-09-13 ｜ 和朋友聊到职业选择的话题 ｜ [人际与家庭 · 社交]" }] }),
      JSON.stringify({ ops: [{ op: "add", target: "topics/健康与作息/运动.md", line: "- 2026-09-14 ｜ 睡眠略有改善 ｜ [健康与作息 · 睡眠]" }] })
    ];
    res = await memoryTidy.runBackfill(ctx);
    check("续跑完成且不再中止", res && res.ok === true && res.aborted === false, true, res);
    check("完成后待整理清零", memoryTidy.backfillStats(ctx).entryCount === 0, true, memoryTidy.backfillStats(ctx));
    const bfRuns = db.listMemoryRuns({}).filter((x) => x.trigger === "backfill");
    check("补处理逐批留痕（trigger=backfill）", bfRuns.length >= 2, true, bfRuns.length);

    console.log("== M14-9 外部编辑不被覆盖（外部改行 → 整理只追加） ==");
    const topicPath = path.join(memDir, "topics/工作与学业/课题.md");
    const externalBefore = fs.readFileSync(topicPath, "utf8").replace("统计学习基础读到第三章", "统计学习基础读到第三章（用户手改：其实是第四章）");
    fs.writeFileSync(topicPath, externalBefore, "utf8");
    await sleep(5);
    db.createJournalEntry({ contentMarkdown: "M14TEST 外部编辑后再整理：今天做了习题" });
    fakeChats = [
      JSON.stringify({ ops: [{ op: "add", target: "topics/工作与学业/课题.md", line: "- 2026-09-15 ｜ 做完统计习题一组 ｜ [工作与学业 · 课题]" }] })
    ];
    res = await memoryTidy.runIngestRound(ctx, "manual");
    const externalAfter = fs.readFileSync(topicPath, "utf8");
    check("外部编辑的行原样保留", res.ok && externalAfter.includes("（用户手改：其实是第四章）"), true, externalAfter);
    check("新条目照常追加（只增不减）", externalAfter.includes("做完统计习题一组"), true, true);

    console.log("== M14-10 周期整理轮（consolidate） ==");
    memoryTidy.writeMemoryConfig(ctx, { consolidateEveryRounds: 1 });
    fakeChats = [
      JSON.stringify({
        ops: [
          { op: "add", target: "topics/健康与作息/运动.md", line: "- 2026-09-16 ｜ 跑步配速有所提升 ｜ [健康与作息 · 运动]" }
        ]
      }),
      // 整理轮：近似重复合并 + core 降级（add+mark 两步表达）
      JSON.stringify({
        ops: [
          { op: "merge", target: "topics/健康与作息/运动.md", match: "- 2026-09-11 ｜ 开始每周跑步三次 ｜ [健康与作息 · 运动]", line: "- 2026-09-11 起 ｜ 保持每周跑步三次的习惯 ｜ [健康与作息 · 运动]" },
          { op: "mark", target: "core", match: "- 2026-09-02 ｜ 在读《控制论》项目 ｜ [工作与学业 · 读书项目]", tag: "已结束" }
        ]
      })
    ];
    await sleep(5);
    db.createJournalEntry({ contentMarkdown: "M14TEST 触发 consolidate 的日记" });
    res = await memoryTidy.runIngestRound(ctx, "manual");
    await sleep(400); // 整理轮 setTimeout 排队执行
    const consRuns = db.listMemoryRuns({}).filter((x) => x.kind === "consolidate");
    check("consolidate 轮触发并成功", consRuns.length >= 1 && consRuns[0].status === "success", true, consRuns.map((x) => x.status));
    const sportText = memoryStore.readText(memDir, "topics/健康与作息/运动.md");
    check("整理轮 merge 生效（近似重复合并 + 原行标记）", sportText.includes("保持每周跑步三次") && sportText.includes("<!-- 已并入 -->"), true, sportText);
    check("core 降级用 mark 表达（原行保留 + 标记）", memoryStore.readText(memDir, "core.md").includes("在读《控制论》项目") && memoryStore.readText(memDir, "core.md").includes("<!-- 已结束 -->"), true, true);

    console.log("== M14-11 零 FSRS 影响（§4.12 读侧只读不变量） ==");
    const card = db.createCard({ noteText: "m14 probe", cardType: "qa", frontMarkdown: "M14TEST 探针题面", backMarkdown: "答案", priority: 50, tags: [] });
    const fsrsSnapshot = JSON.stringify(db.getCard(card.id).fsrs);
    await sleep(5);
    db.createJournalEntry({ contentMarkdown: "M14TEST FSRS 不变量观察日记" });
    fakeChats = [JSON.stringify({ ops: [{ op: "add", target: "topics/兴趣与见闻/日常.md", line: "- 2026-09-17 ｜ 记录一条日常见闻 ｜ [兴趣与见闻 · 日常]" }] })];
    await memoryTidy.runIngestRound(ctx, "manual");
    await sleep(400);
    check("整理全链路零改卡片 fsrs", JSON.stringify(db.getCard(card.id).fsrs) === fsrsSnapshot, true, "fsrs 未动");

    console.log("== M14-12 M2 备份/恢复覆盖 memory/（§4.18-15） ==");
    const bkDir = path.join(tmp, "bk");
    const b = await backup.createBackup({ dataDir: tmp, backupDir: bkDir, label: "manual", flush: () => db.checkpointStrict() });
    check("备份成功", b.ok, true, b.error);
    const JSZip = require(path.join(ROOT, "node_modules", "jszip"));
    const zip = await JSZip.loadAsync(fs.readFileSync(b.file));
    const memEntries = Object.keys(zip.files).filter((n) => n.startsWith("memory/") && !zip.files[n].dir);
    check("备份含 memory/ 文件树", memEntries.some((n) => n === "memory/core.md") && memEntries.some((n) => n.includes("topics/")), true, memEntries);
    check("meta 记 memoryFiles 计数", b.meta && b.meta.memoryFiles === memEntries.length, true, b.meta && b.meta.memoryFiles);
    // 恢复：先改乱当前记忆，再从备份换入
    fs.writeFileSync(path.join(memDir, "core.md"), "# 被改乱的记忆", "utf8");
    const rRestore = await backup.restoreBackup(b.file, { dataDir: tmp, skipSafety: true });
    check("restore 解包 + 标记", rRestore.ok, true, rRestore.error);
    // D137 后主库是 better-sqlite3 原生连接，Windows 上连接不关 rename library.db 必 EBUSY；
    // 真实路径 applyPendingRestore 在启动期 initDb 之前执行、从无此占用——测试对齐真实时序。
    db.closeDb();
    const applied = backup.applyPendingRestore({ dataDir: tmp });
    check("applyPendingRestore 换入 memory/", applied && applied.restored.includes("memory"), true, applied && applied.restored);
    check("恢复后记忆内容与备份一致", memoryStore.readText(memDir, "core.md").includes("读书项目"), true, memoryStore.readText(memDir, "core.md").slice(0, 80));
    await db.initDb(); // 重开连接，供后续 M14-13+ 使用

    console.log("== M14-13（UM-2）制卡模板播种 + R20 situationRequired 声明矩阵 ==");
    const genTpl = db.getPromptTemplate("card-generation");
    check("card-generation 播种于目标版本且含 R20 情境段 + memoryRef",
      genTpl && genTpl.version === db.CARD_PROMPT_TARGET_VERSION && genTpl.content.includes("记忆情境接地（R20") && genTpl.content.includes("memoryRef"), true, genTpl && genTpl.version);
    check("situation_required 矩阵（generation/mnemonic/probe=1，formula/journal-insight=0）",
      Number(genTpl.situation_required) === 1
      && Number(db.getPromptTemplate("card-mnemonic").situation_required) === 1
      && Number(db.getPromptTemplate("knowledge-probe").situation_required) === 1
      && Number(db.getPromptTemplate("card-formula").situation_required) === 0
      && Number(db.getPromptTemplate("journal-insight").situation_required) === 0,
      "1/1/1/0/0",
      [genTpl.situation_required, db.getPromptTemplate("card-mnemonic").situation_required, db.getPromptTemplate("knowledge-probe").situation_required, db.getPromptTemplate("card-formula").situation_required, db.getPromptTemplate("journal-insight").situation_required]);
    check("排除 scope 模板注明不适用（formula/vocab）",
      db.getPromptTemplate("card-formula").content.includes("本卡型不适用") && db.getPromptTemplate("card-vocab").content.includes("本卡型不适用"), true, true);

    console.log("== M14-14（UM-2）memoryRetrieve 纯函数矩阵 ==");
    const mr = require(path.join(ROOT, "electron", "memoryRetrieve.js"));
    const d1 = mr.lifeDomainsForUdc(["004"]);
    check("UDC 004 → 工作与学业+成长与目标", d1.includes("工作与学业") && d1.includes("成长与目标"), true, d1);
    const d2 = mr.lifeDomainsForUdc(["159.9"]);
    check("UDC 159.9 → 情绪与状态+人际与家庭（不被「1 哲学」最长前缀吃掉）",
      d2.includes("情绪与状态") && d2.includes("人际与家庭") && !d2.includes("观念与价值"), true, d2);
    const d3 = mr.lifeDomainsForUdc(["1", "796"]);
    check("UDC 1 → 观念与价值；796 → 健康与作息", d3.includes("观念与价值") && d3.includes("健康与作息"), true, d3);
    check("未知域 → 空映射（仅靠词面召回）", mr.lifeDomainsForUdc(["999x"]).length === 0, true, mr.lifeDomainsForUdc(["999x"]));
    const terms = mr.extractSignalTerms({ title: "睡眠科学", section: "第一章 昼夜节律", text: "The circadian rhythm affects sleep quality. 昼夜节律决定入睡时间。" });
    check("词面信号：标题/章节/ASCII 词/CJK 2-gram 齐备",
      terms.includes("睡眠科学") && terms.includes("第一章 昼夜节律") && terms.includes("circadian") && terms.some((t) => t.includes("昼夜")), true, terms.slice(0, 6));
    const topicFiles = [
      { rel: "topics/情绪与状态/睡眠.md", domain: "情绪与状态", topic: "睡眠", content: "连续两周入睡困难" },
      { rel: "topics/工作与学业/课题.md", domain: "工作与学业", topic: "课题", content: "统计学习基础" }
    ];
    const picks1 = mr.pickTopics(topicFiles, { lifeDomains: ["情绪与状态"], terms: ["睡眠"] });
    check("宽召回：域命中+词面命中的主题入选且 ≤2 篇", picks1.length === 1 && picks1[0].rel.includes("睡眠"), true, picks1.map((x) => x.rel));
    const picks2 = mr.pickTopics(topicFiles, { lifeDomains: ["财务与生活"], terms: ["不相关的词"] });
    check("零命中 → 空召回（不设硬门槛也宁缺毋滥）", picks2.length === 0, true, picks2);
    const block1 = mr.buildMemoryBlock({
      coreText: "# core 内容",
      indexText: "# 目录",
      topicPicks: [{ rel: "topics/情绪与状态/睡眠.md", content: "- 2026-09-01 ｜ 入睡困难 ｜ [情绪与状态 · 睡眠]" }],
      budgets: { core: 800, index: 1200, topics: 2400 }
    });
    check("注入块：用途声明 + 用量行 + 命中主题",
      block1.block.includes("仅用于情境接地") && block1.block.includes("【用量】") && block1.hitTopics.length === 1, true, block1.hitTopics);
    const block2 = mr.buildMemoryBlock({ coreText: "c", indexText: "i", topicPicks: [], budgets: mr.DEFAULT_BUDGETS });
    check("零命中仍注入 core/目录（目录恒定注入）并提示模型点名",
      block2.block.includes("----- core.md") && block2.block.includes("请在 warnings 中点名"), true, true);
    const block3 = mr.buildMemoryBlock({ coreText: "很长".repeat(600), indexText: "i", topicPicks: [], budgets: { core: 20, index: 100, topics: 100 } });
    check("超预算按行截断留痕", block3.block.includes("超预算截断"), true, true);
    check("memoryRef 子串校验（§4.18-10）",
      mr.validateMemoryRef(block1.block, "- 2026-09-01 ｜ 入睡困难 ｜ [情绪与状态 · 睡眠]") === true
      && mr.validateMemoryRef(block1.block, "编造的记忆行") === false
      && mr.validateMemoryRef(block1.block, "") === false, true, true);

    console.log("== M14-15（UM-2）memory_ref_json 落库 + 本书域分布检索 ==");
    const pasteItem = db.createFromPaste("M14UM2 来源书", "正文内容");
    const docId = pasteItem.documentId || null;
    db.createCard({ noteText: "m14 um2 c1", cardType: "qa", frontMarkdown: "题面", backMarkdown: "答案", priority: 50, tags: [], domain: ["159.9", "51"], contextRef: { documentId: docId }, memoryRefJson: { line: "- 2026-09-01 ｜ 入睡困难 ｜ [情绪与状态 · 睡眠]", verified: true } });
    db.createCard({ noteText: "m14 um2 c2", cardType: "qa", frontMarkdown: "无关书卡", backMarkdown: "答案", priority: 50, tags: [], domain: ["33"], contextRef: { documentId: "other-doc" } });
    const doms = db.listCardDomainsForDocument(docId);
    check("本书卡域分布查询（LIKE + 精确 documentId 复核）", doms.includes("159.9") && doms.includes("51") && !doms.includes("33"), true, doms);
    const refCard = db.createCard({ noteText: "m14 um2 c3", cardType: "qa", frontMarkdown: "溯源卡", backMarkdown: "答案", priority: 50, tags: [], memoryRefJson: null });
    check("memory_ref_json 落库回读（verified）与 null 缺省",
      db.getCard(refCard.id).memoryRefJson === null, true, db.getCard(refCard.id).memoryRefJson);
    const cardsAll = db.listAllCards();
    check("列表视图携带 memoryRefJson", cardsAll.some((c) => c.memoryRefJson && c.memoryRefJson.verified === true && c.memoryRefJson.line.includes("入睡困难")), true, "memoryRef on list");

    console.log(`\nM14 测试完成：${pass} 通过 / ${fail} 失败`);
    if (fail > 0) app.exit(1);
    else app.exit(0);
  } catch (err) {
    console.error("M14 测试异常：", err);
    app.exit(1);
  }
});
