// F71 D34 唯一例外的闸门：日记草稿防抖落盘在四条路径上是否都收得回来
// @runtime: electron  @tier: 1  @gui: false  @id: F71  @timeout: 300
// 运行：npx electron tests/flows/f71-journal-debounce.cjs
//
// 指南把"日记草稿防抖持久化"定为**「每次落库即落盘」的唯一例外**（D34：尾随 4 s / 上限 20 s + 隐藏·发送·退出强制 flush）。
// 静态面已确认接线在场：`quickCapture.js:369 prepareQuit()` → `:371 flushJournal()` → `:342 ctx.db.flushJournalPersist()`，
// 常数在 `:18-19`（4000 / 20000）。本条把这条**唯一例外**钉成一个闸门：
// 任何一次重构把 flush 接掉，这里就该红。
"use strict";
const path = require("path");
const { app } = require("electron");
const { Flow, runFlow, ROOT, tmpUserDataDir, freshDir } = require("./lib/harness.cjs");
const { audit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F71",
  title: "日记防抖落盘四路径",
  angle: "唯一例外的四条收口路径（defer 不落 / flush 能落 / 发送必落 / 别的写入会顺带落）",
  cites: ["§7.2 L857", "D34", "§6.5", "§7.1.4"],
  tier: 1,
  gui: false,
});

const draftOf = async (dbFile, tag) => {
  const a = await audit(dbFile);
  const rows = a.rows("SELECT content_markdown, is_draft, sent_at FROM journal_entries ORDER BY created_at DESC");
  a.close();
  const d = rows.filter((r) => r.is_draft === 1);
  flow.record(`${tag} 盘上条目`, `共 ${rows.length} 行 · 其中草稿 ${d.length} 行 · 首条内容「${String((rows[0] || {}).content_markdown || "").slice(0, 24)}」`);
  return { total: rows.length, drafts: d.length, rows };
};

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f71"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");
    const dbPath = path.join(ROOT, "electron", "db.js");
    delete require.cache[dbPath];
    const db = require(dbPath);
    await db.initDb();
    const qcPath = path.join(ROOT, "electron", "quickCapture.js");
    delete require.cache[qcPath];

    await runFlow(flow, async () => {
      flow.section("J1 静态面：唯一例外的接线必须在场（重构掉就该红）");
      const fs = require("fs");
      const qc = fs.readFileSync(qcPath, "utf8");
      const dbSrc = fs.readFileSync(dbPath, "utf8");
      const wiring = {
        常数_尾随4s: /PERSIST_TRAILING_MS\s*=\s*4000/.test(qc),
        常数_上限20s: /PERSIST_MAX_MS\s*=\s*20000/.test(qc),
        prepareQuit调用flush: /function prepareQuit[\s\S]{0,200}flushJournal\(\)/.test(qc),
        flush打到db层: /flushJournalPersist\s*\?\.\s*\(\)/.test(qc),
        "主进程挂了before-quit": /app\.on\(\s*["']before-quit["']/.test(dbSrc + fs.readFileSync(path.join(ROOT, "electron", "main.js"), "utf8")),
        库层有dirty标记: /journalPersistDirty/.test(dbSrc),
      };
      flow.record("接线检查", JSON.stringify(wiring));
      flow.check("D34 的六条接线必须全部在场（少一条就意味着草稿会静默丢）", Object.values(wiring).every(Boolean), "全在", wiring);

      flow.section("J2 路径①：草稿走 deferPersist ⇒ 此刻**不该**落盘（例外的定义）");
      db.saveJournalDraft("F71 草稿甲：还没发送", { deferPersist: true });
      const s1 = await draftOf(dbFile, "J2 defer 之后");
      flow.check("defer 路径确实把落盘推迟了（这是 D34 例外的本体，不是缺陷）", s1.total === 0, "盘上 0 行", { 盘上: s1.total });

      flow.section("J3 路径②：flush 必须能把它捞回来");
      const flushed = db.flushJournalPersist();
      flow.record("flushJournalPersist 返回", String(flushed));
      const s2 = await draftOf(dbFile, "J3 flush 之后");
      flow.check("强制 flush 之后草稿必须真的在盘上（否则退出路径全部失效）", flushed === true && s2.drafts === 1, "1 行草稿", { flushed, 草稿: s2.drafts });
      const again = db.flushJournalPersist();
      flow.check("无待落盘内容时 flush 必须返回 false（不得谎称刷了盘）", again === false, "false", again);

      flow.section("J4 路径③：发送草稿 ⇒ 定格为正式条目且必落盘");
      const sent = db.sendJournalDraft("F71 草稿甲：还没发送");
      db.persistNow();
      const s3 = await draftOf(dbFile, "J4 发送之后");
      const formal = s3.rows.filter((r) => r.is_draft === 0);
      flow.record("sendJournalDraft 返回", JSON.stringify(sent).slice(0, 90));
      flow.check("发送后必须存在**非草稿**的正式条目（is_draft=0 且 sent_at 有值）", formal.length === 1 && formal[0].sent_at != null, "1 条正式条目", { 正式: formal.length, sent_at: formal[0] && formal[0].sent_at });
      flow.check("发送后草稿位必须被释放（全局至多一条草稿的约束）", s3.drafts === 0, "0 条残留草稿", { 草稿: s3.drafts });

      flow.section("J5 路径④：别的写入会顺带把 dirty 草稿带下去（§7.2「其余写入即时 persist」）");
      db.saveJournalDraft("F71 草稿乙：还没发送", { deferPersist: true });
      const mid = await draftOf(dbFile, "J5 只 defer 之后");
      db.createJournalEntry({ contentMarkdown: "F71 另一条正式条目", source: "app" });
      const after = await draftOf(dbFile, "J5 别的写入之后");
      flow.check("一次非草稿写入必须把待落盘草稿一起带上盘（不得让 dirty 无限期悬着）", mid.drafts === 0 && after.drafts === 1, "第二次读数里草稿已在盘上", { 中间: mid.drafts, 之后: after.drafts });

      flow.section("J6 崩溃路径的代价必须被量化（这是 D34 接受的代价，不是缺陷，但要说清是几秒）");
      db.saveJournalDraft("F71 草稿丙：崩溃时丢的就是这一段", { deferPersist: true });
      const lost = await draftOf(dbFile, "J6 模拟崩溃前（不 flush）");
      flow.record("接受代价的说明", "若不 flush 就退出，最后一条未落盘草稿会丢——" +
        `按 D34 这是**用户接受的代价**（最多丢最后几秒输入）。窗口宽度 = 尾随 4 s + 上限 20 s，实测常数见 J1。`);
      // 判据要精确到"丙这一条"，不能拿 drafts 计数当判据：J5 已经把乙刷下去了，盘上本来就还有一条草稿。
      const hasC = lost.rows.some((r) => String(r.content_markdown || "").includes("草稿丙"));
      flow.record("丙是否在盘上", String(hasC));
      flow.check("崩溃路径确实会丢最后一条未 flush 的草稿（把 D34 的代价钉成事实，防止将来被误报成缺陷或被悄悄改掉）", hasC === false, "丙不在盘上", { hasC, 盘上草稿数: lost.drafts });

      flow.section("J7 重启语义不在本条范围内（实测记录）");
      // 第一版在这里 `delete require.cache` 之后**在同一进程里再 initDb 一次**，结果整个进程挂死 5 分钟以上
      // （stdout 是缓冲的，所以一个字都没吐出来 ⇒ 看起来像"没跑"）。跨进程重启不丢数据的验证由
      // F03-S9 / F33 / F05 各自覆盖，本条只钉 D34 这条例外的四条收口路径，不再重开库。
      flow.record("J7 说明", "跨重启守恒由 F03-S9 / F33 / F05 覆盖；本条不重复，且已记录「同进程二次 initDb 会挂死」这个坑");
    });
    setTimeout(() => app.exit(process.exitCode || 0), 200); // D239：runFlow 按结果置退出码
  })
  .catch((e) => {
    flow.record("顶层异常", String((e && e.message) || e));
    setTimeout(() => app.exit(1), 200);
  });
