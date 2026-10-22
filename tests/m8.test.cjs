// v36（M8-A）日记与快速记录回归测试（db 层 + 快捷键配置，electron 直跑：npx electron tests/m8.test.cjs）
// @runtime: electron
// 隔离：userData 指向临时目录，全新 library.db，绝不触碰真实库（§7.3）。
// 契约：§4.1 journal_entries / §6.5 日记模块 / §4.2-21 JournalCapture / 决策 D34。
// 覆盖：自然日边界（00:00·23:59·跨月·跨年·闰年）/ 条目 CRUD 与软删 / 排序分页 / 搜索（含通配符转义）/
//       日期分组计数 / 草稿-发送协议（唯一性·幂等·跨日续写不改归属·发送定格·库层唯一索引护栏）/
//       防抖持久化（只落盘一次 + flush 后磁盘内容一致 + 未 flush 时磁盘不超前）/ 零影响不变量 /
//       全局快捷键配置归一化（非法回落、两键不得相同、关闭态不注册）
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const ROOT = path.resolve(__dirname, "..");

let pass = 0;
let fail = 0;
function check(name, cond, expected, actual) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`);
  }
}

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "m8-test-"));
  try {
    app.setPath("userData", tmp);
    const db = require(path.join(ROOT, "electron", "db.js"));
    const journalTime = require(path.join(ROOT, "electron", "journalTime.js"));
    const settingsStore = require(path.join(ROOT, "electron", "settingsStore.js"));
    const quickCapture = require(path.join(ROOT, "electron", "quickCapture.js"));
    await db.initDb();

    const dbFile = path.join(tmp, "library.db");
    // 磁盘直读（数据健康以 sql.js 直读为准；也用于「未 flush 时磁盘不超前」的断言）
    let SQL = null;
    async function diskRows(sql, params = []) {
      if (!SQL) {
        const initSqlJs = require(path.join(ROOT, "node_modules", "sql.js"));
        SQL = await initSqlJs();
      }
      const d = new SQL.Database(fs.readFileSync(dbFile));
      const stmt = d.prepare(sql);
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      d.close();
      return rows;
    }
    const localMs = (y, mo, d, h = 0, mi = 0, s = 0, ms = 0) => new Date(y, mo - 1, d, h, mi, s, ms).getTime();

    console.log("== M8-1 自然日纯函数（journalTime） ==");
    check("00:00:00.000 属当天", journalTime.journalDateOf(localMs(2026, 9, 14, 0, 0, 0, 0)) === "2026-09-14", "2026-09-14", journalTime.journalDateOf(localMs(2026, 9, 14, 0, 0, 0, 0)));
    check("23:59:59.999 仍属当天", journalTime.journalDateOf(localMs(2026, 9, 14, 23, 59, 59, 999)) === "2026-09-14", "2026-09-14", journalTime.journalDateOf(localMs(2026, 9, 14, 23, 59, 59, 999)));
    check("跨月：月末 23:59 属上月", journalTime.journalDateOf(localMs(2026, 8, 31, 23, 59)) === "2026-08-31", "2026-08-31", journalTime.journalDateOf(localMs(2026, 8, 31, 23, 59)));
    check("跨月：月初 00:00 属本月", journalTime.journalDateOf(localMs(2026, 9, 1, 0, 0)) === "2026-09-01", "2026-09-01", journalTime.journalDateOf(localMs(2026, 9, 1, 0, 0)));
    check("跨年：12-31 23:59 属上一年", journalTime.journalDateOf(localMs(2025, 12, 31, 23, 59)) === "2025-12-31", "2025-12-31", journalTime.journalDateOf(localMs(2025, 12, 31, 23, 59)));
    check("合法日期串通过", journalTime.isJournalDate("2026-09-14") === true, true, journalTime.isJournalDate("2026-09-14"));
    check("非法日期串被拒（2026-02-30）", journalTime.isJournalDate("2026-02-30") === false, false, journalTime.isJournalDate("2026-02-30"));
    check("非法日期串被拒（2026-13-01 / 乱串）", journalTime.isJournalDate("2026-13-01") === false && journalTime.isJournalDate("abc") === false, false, journalTime.isJournalDate("2026-13-01"));
    check("加一天：月末进位", journalTime.journalDateAddDays("2026-08-31", 1) === "2026-09-01", "2026-09-01", journalTime.journalDateAddDays("2026-08-31", 1));
    check("加一天：闰年 2/28→2/29", journalTime.journalDateAddDays("2028-02-28", 1) === "2028-02-29", "2028-02-29", journalTime.journalDateAddDays("2028-02-28", 1));

    const TODAY = journalTime.journalDateOf(Date.now());
    const before = {
      cards: (await diskRows("SELECT COUNT(*) AS n FROM cards"))[0].n,
      logs: (await diskRows("SELECT COUNT(*) AS n FROM review_logs"))[0].n,
      extracts: (await diskRows("SELECT COUNT(*) AS n FROM extracts"))[0].n
    };

    console.log("\n== M8-2 条目 CRUD 与软删 ==");
    const e1 = db.createJournalEntry({ contentMarkdown: "第一条：今天读了《理想国》开头", source: "app" });
    check("新建条目返回 entryDate=今日（自然日）", e1.entryDate === TODAY, TODAY, e1.entryDate);
    check("新建条目 sentAt 已落值 / 非草稿", !!e1.sentAt && e1.isDraft === false, "sentAt!=null,isDraft=false", `${e1.sentAt},${e1.isDraft}`);
    let emptyThrew = false;
    try {
      db.createJournalEntry({ contentMarkdown: "   " });
    } catch {
      emptyThrew = true;
    }
    check("空内容拒绝建条", emptyThrew === true, true, emptyThrew);
    check("列表可查到该条", db.listJournalEntries({}).entries.some((x) => x.id === e1.id), true, false);
    const upd = db.updateJournalEntry(e1.id, "第一条（已改）");
    check("更新内容生效且 entryDate 不变", upd.contentMarkdown === "第一条（已改）" && upd.entryDate === TODAY, `第一条（已改）/ ${TODAY}`, `${upd.contentMarkdown} / ${upd.entryDate}`);
    db.deleteJournalEntry(e1.id);
    check("删除后列表不可见（软删）", !db.listJournalEntries({}).entries.some((x) => x.id === e1.id), true, false);
    const softRow = (await diskRows("SELECT is_deleted FROM journal_entries WHERE id = ?", [e1.id]))[0];
    check("软删行仍在库中且 is_deleted=1", softRow && softRow.is_deleted === 1, 1, softRow && softRow.is_deleted);

    console.log("\n== M8-3 排序与分页（日期倒序 / 日组内正序） ==");
    const d10 = db.createJournalEntry({ contentMarkdown: "09010 内容", source: "app", entryDate: "2026-09-10", createdAt: localMs(2026, 9, 10, 9, 0) });
    const d11 = db.createJournalEntry({ contentMarkdown: "0911 内容", source: "app", entryDate: "2026-09-11", createdAt: localMs(2026, 9, 11, 9, 0) });
    const d12a = db.createJournalEntry({ contentMarkdown: "0912 早", source: "app", entryDate: "2026-09-12", createdAt: localMs(2026, 9, 12, 8, 0) });
    const d12b = db.createJournalEntry({ contentMarkdown: "0912 晚", source: "app", entryDate: "2026-09-12", createdAt: localMs(2026, 9, 12, 20, 0) });
    const page1 = db.listJournalEntries({ limit: 3, offset: 0 });
    check("日期倒序、日组内正序（前 3 条）", JSON.stringify(page1.entries.map((x) => x.id)) === JSON.stringify([d12a.id, d12b.id, d11.id]), [d12a.id, d12b.id, d11.id], page1.entries.map((x) => x.id));
    const page2 = db.listJournalEntries({ limit: 3, offset: 3 });
    check("分页不重叠且覆盖剩余", page2.entries.length === 1 && page2.entries[0].id === d10.id, 1, page2.entries.length);
    check("total = 当天条数（含 09-10/11/12 三天 4 条）", page1.total >= 4, ">=4", page1.total);

    console.log("\n== M8-4 搜索（子串 + 通配符转义 + ASCII 大小写） ==");
    db.createJournalEntry({ contentMarkdown: "FSRSTEST 苹果 与 50% 完成度", source: "app", entryDate: "2026-09-13", createdAt: localMs(2026, 9, 13, 10, 0) });
    db.createJournalEntry({ contentMarkdown: "FSRSTEST Moral Philosophy", source: "app", entryDate: "2026-09-13", createdAt: localMs(2026, 9, 13, 11, 0) });
    check("中文子串命中", db.listJournalEntries({ query: "苹果" }).entries.length === 1, 1, db.listJournalEntries({ query: "苹果" }).entries.length);
    check("ASCII 大小写不敏感（moral → Moral）", db.listJournalEntries({ query: "moral" }).entries.length === 1, 1, db.listJournalEntries({ query: "moral" }).entries.length);
    check("通配符 % 按字面匹配（50% 命中）", db.listJournalEntries({ query: "50%" }).entries.length === 1, 1, db.listJournalEntries({ query: "50%" }).entries.length);
    check("通配符转义：5%0 不误命中 50%", db.listJournalEntries({ query: "5%0" }).entries.length === 0, 0, db.listJournalEntries({ query: "5%0" }).entries.length);
    check("通配符转义：下划线按字面（_ 不命中任意单字）", db.listJournalEntries({ query: "FSRSTEST_" }).entries.length === 0, 0, db.listJournalEntries({ query: "FSRSTEST_" }).entries.length);

    console.log("\n== M8-5 日期清单（分组计数，倒序） ==");
    const dates = db.listJournalDates({});
    const idx12 = dates.findIndex((x) => x.entryDate === "2026-09-12");
    const idx10 = dates.findIndex((x) => x.entryDate === "2026-09-10");
    check("日期清单倒序", idx12 >= 0 && idx10 > idx12, "09-12 在 09-10 之前", `${idx12} / ${idx10}`);
    check("09-12 计数为 2", dates.find((x) => x.entryDate === "2026-09-12")?.count === 2, 2, dates.find((x) => x.entryDate === "2026-09-12")?.count);

    console.log("\n== M8-6 草稿-发送协议（§6.5.2 / D34） ==");
    const dr1 = db.saveJournalDraft("FSRSTEST 草稿第一句", {});
    check("首次输入建草稿（isDraft=true / sentAt=null / entryDate=今日）", dr1.isDraft === true && dr1.sentAt === null && dr1.entryDate === TODAY, `true,null,${TODAY}`, `${dr1.isDraft},${dr1.sentAt},${dr1.entryDate}`);
    const dr1b = db.saveJournalDraft("FSRSTEST 草稿第一句", {});
    check("同内容重复保存幂等（同一行、不新增）", dr1b.id === dr1.id, dr1.id, dr1b.id);
    const dr1c = db.saveJournalDraft("FSRSTEST 草稿第一句 + 续写", {});
    check("续写改内容仍同一行", dr1c.id === dr1.id && dr1c.contentMarkdown.includes("续写"), true, `${dr1c.id} / ${dr1c.contentMarkdown}`);
    check("全局至多一条草稿", db.listJournalEntries({ query: "FSRSTEST" }).entries.filter((x) => x.isDraft).length === 1, 1, db.listJournalEntries({ query: "FSRSTEST" }).entries.filter((x) => x.isDraft).length);
    const cleared = db.saveJournalDraft("   ", {});
    check("清空输入 → 草稿行被丢弃（返回 null / 查不到草稿）", cleared === null && db.getJournalDraft() === null, "null/null", `${cleared}/${db.getJournalDraft()}`);
    const dr2 = db.saveJournalDraft("FSRSTEST 新草稿", {});
    check("丢弃后再输入 → 新草稿行（新 id）", dr2.id !== dr1.id, "不同 id", dr2.id === dr1.id);
    const sent = db.sendJournalDraft("FSRSTEST 新草稿（已发送）");
    check("发送：定格为一条（isDraft=false / sentAt 落值 / entryDate 不变）", sent.isDraft === false && !!sent.sentAt && sent.entryDate === TODAY, `false,!=null,${TODAY}`, `${sent.isDraft},${sent.sentAt},${sent.entryDate}`);
    check("发送后无未发送草稿", db.getJournalDraft() === null, null, db.getJournalDraft());
    check("发送后条目可在列表查到（非草稿）", db.listJournalEntries({}).entries.some((x) => x.id === sent.id && !x.isDraft), true, false);
    let sendEmptyThrew = false;
    try {
      db.sendJournalDraft("  ");
    } catch {
      sendEmptyThrew = true;
    }
    check("发送空内容被拒", sendEmptyThrew === true, true, sendEmptyThrew);
    const dr3 = db.saveJournalDraft("FSRSTEST 发送后新写", {});
    check("发送后再输入 → 又是一条独立草稿", dr3.id !== sent.id && dr3.isDraft === true, "新草稿", `${dr3.id} / ${dr3.isDraft}`);

    // 跨日续写：草稿归属首字符自然日，续写不改归属
    db.deleteJournalEntry(dr3.id); // 先清掉上一条草稿，让唯一草稿槽空出
    const oldDraft = db.createJournalEntry({ contentMarkdown: "FSRSTEST 跨日草稿", source: "capture", isDraft: true, createdAt: localMs(2026, 9, 1, 23, 30) });
    const continued = db.saveJournalDraft("FSRSTEST 跨日草稿 + 次日续写", {});
    check("跨日续写：仍是同一行、entryDate 保持首字符那天", continued.id === oldDraft.id && continued.entryDate === "2026-09-01", `2026-09-01`, `${continued.id === oldDraft.id} / ${continued.entryDate}`);
    check("跨日续写：createdAt 不被改写", continued.createdAt === oldDraft.createdAt, oldDraft.createdAt, continued.createdAt);
    let dupThrew = false;
    try {
      db.createJournalEntry({ contentMarkdown: "FSRSTEST 第二条草稿", isDraft: true });
    } catch {
      dupThrew = true;
    }
    check("库层护栏：唯一草稿索引拒绝第二条草稿", dupThrew === true, true, dupThrew);

    console.log("\n== M8-7 防抖持久化（唯一持久化例外，D34） ==");
    db.deleteJournalEntry(continued.id); // 清场
    db.flushJournalPersist();
    const baselineDraft = db.saveJournalDraft("FSRSTEST 落盘基线", {});
    db.flushJournalPersist(); // 基线已落盘
    const diskBefore = (await diskRows("SELECT content_markdown FROM journal_entries WHERE id = ?", [baselineDraft.id]))[0].content_markdown;
    check("基线已落盘", diskBefore === "FSRSTEST 落盘基线", "FSRSTEST 落盘基线", diskBefore);
    for (let i = 1; i <= 6; i++) db.saveJournalDraft(`FSRSTEST 落盘基线 v${i}`, { deferPersist: true });
    const diskDuring = (await diskRows("SELECT content_markdown FROM journal_entries WHERE id = ?", [baselineDraft.id]))[0].content_markdown;
    check("连续 6 次自动保存未落盘（磁盘仍是基线）", diskDuring === "FSRSTEST 落盘基线", "FSRSTEST 落盘基线", diskDuring);
    const flushed = db.flushJournalPersist();
    check("flush 返回 true（确有待落盘内容）", flushed === true, true, flushed);
    const diskAfter = (await diskRows("SELECT content_markdown FROM journal_entries WHERE id = ?", [baselineDraft.id]))[0].content_markdown;
    check("flush 后磁盘 = 最新内容（崩溃最多丢几秒的边界）", diskAfter === "FSRSTEST 落盘基线 v6", "FSRSTEST 落盘基线 v6", diskAfter);
    check("再次 flush 返回 false（无待落盘内容，幂等）", db.flushJournalPersist() === false, false, db.flushJournalPersist());
    const sentPersist = db.sendJournalDraft("FSRSTEST 发送即落盘");
    const diskSent = (await diskRows("SELECT is_draft, content_markdown FROM journal_entries WHERE id = ?", [sentPersist.id]))[0];
    check("发送=显式动作 → 即时落盘到磁盘", diskSent.is_draft === 0 && diskSent.content_markdown.includes("发送即落盘"), "is_draft=0", diskSent.is_draft);

    console.log("\n== M8-8 零影响不变量（不碰卡片/复习/摘录） ==");
    const after = {
      cards: (await diskRows("SELECT COUNT(*) AS n FROM cards"))[0].n,
      logs: (await diskRows("SELECT COUNT(*) AS n FROM review_logs"))[0].n,
      extracts: (await diskRows("SELECT COUNT(*) AS n FROM extracts"))[0].n
    };
    check("cards 计数不变", after.cards === before.cards, before.cards, after.cards);
    check("review_logs 计数不变", after.logs === before.logs, before.logs, after.logs);
    check("extracts 计数不变", after.extracts === before.extracts, before.extracts, after.extracts);

    console.log("\n== M8-9 全局快捷键配置归一化（D34-④） ==");
    const na = (s) => quickCapture.normalizeAccelerator(s);
    check("归一化：小写 → 规范顺序", na("ctrl+alt+space") === "Ctrl+Alt+Space", "Ctrl+Alt+Space", na("ctrl+alt+space"));
    check("归一化：Control 别名 → Ctrl", na("Control+Alt+Space") === "Ctrl+Alt+Space", "Ctrl+Alt+Space", na("Control+Alt+Space"));
    check("归一化：修饰键顺序固定", na("Shift+Ctrl+A") === "Ctrl+Shift+A", "Ctrl+Shift+A", na("Shift+Ctrl+A"));
    check("归一化：功能键单键可用", na("f9") === "F9", "F9", na("f9"));
    check("归一化：无修饰单字符被拒", na("a") === null, null, na("a"));
    check("归一化：空串被拒", na("") === null, null, na(""));
    check("归一化：未知键名被拒", na("Ctrl+Foo") === null, null, na("Ctrl+Foo"));
    check("归一化：仅修饰键被拒", na("Ctrl+Shift") === null, null, na("Ctrl+Shift"));

    const setShortcuts = (v) => {
      const cur = settingsStore.readSettings();
      cur.app = { ...(cur.app || {}), globalShortcuts: v };
      settingsStore.writeSettings(cur);
    };
    // 读配置需要 ctx（readSettings 注入）——init 同时会真实注册一次全局快捷键（测试进程内，随后 prepareQuit 注销）
    quickCapture.init({
      db,
      readSettings: settingsStore.readSettings,
      writeSettings: settingsStore.writeSettings,
      sendToMain: () => {}
    });
    setShortcuts({ quickCapture: { enabled: true, accelerator: "Ctrl+Alt+Space" }, addMaterial: { enabled: true, accelerator: "Ctrl+Alt+N" } });
    let cfg = quickCapture.readConfig();
    check("默认配置：两键各自正确", cfg.quickCapture.accelerator === "Ctrl+Alt+Space" && cfg.addMaterial.accelerator === "Ctrl+Alt+N", "Ctrl+Alt+Space / Ctrl+Alt+N", `${cfg.quickCapture.accelerator} / ${cfg.addMaterial.accelerator}`);
    setShortcuts({ quickCapture: { accelerator: "乱写" }, addMaterial: { accelerator: "a" } });
    cfg = quickCapture.readConfig();
    check("非法加速键 → 回落默认（不把功能打死）", cfg.quickCapture.accelerator === "Ctrl+Alt+Space" && cfg.addMaterial.accelerator === "Ctrl+Alt+N", "两侧均回落默认", `${cfg.quickCapture.accelerator} / ${cfg.addMaterial.accelerator}`);
    setShortcuts({ quickCapture: { accelerator: "Ctrl+Alt+K" }, addMaterial: { accelerator: "Ctrl+Alt+K" } });
    cfg = quickCapture.readConfig();
    check("两键相同 → 拆开（各自回落默认 + 标记冲突）", cfg.quickCapture.accelerator !== cfg.addMaterial.accelerator && cfg.addMaterial.conflictWithCapture === true, "不同 + 标记", `${cfg.quickCapture.accelerator} / ${cfg.addMaterial.accelerator} / ${cfg.addMaterial.conflictWithCapture}`);

    // 「失败必须可见」契约：注册成功则 registered=true；未注册则必须给出可读原因（绝不能静默失效）
    // v48.114（D159）：快速记录经 CAPTURE_DISABLED 闸强制关闭——即使配置 enabled:true 也不注册且无错误
    //（关闭态语义）；「失败必须可见」契约改在 addMaterial 一侧验（未注册必有可读原因）。
    setShortcuts({ quickCapture: { enabled: true, accelerator: "Ctrl+Alt+Space" }, addMaterial: { enabled: true, accelerator: "Ctrl+Alt+N" }, autoLaunch: false });
    const stOn = quickCapture.applyGlobalShortcuts();
    const visible = (s) => s.registered === true || (typeof s.error === "string" && s.error.length > 0);
    check("注册结果自洽（D159 闸：快速记录强制关闭态；添加材料未注册必有可读原因）", stOn.quickCapture.enabled === false && stOn.quickCapture.registered === false && stOn.quickCapture.error === null && visible(stOn.addMaterial), true, JSON.stringify(stOn));
    console.log(`  · 实测注册：快速记录=${stOn.quickCapture.registered}（闸下强制关闭） 添加材料=${stOn.addMaterial.registered}（${stOn.addMaterial.accelerator}）`);

    setShortcuts({ quickCapture: { enabled: false }, addMaterial: { enabled: false }, autoLaunch: false });
    const st = quickCapture.applyGlobalShortcuts();
    check("关闭态：不注册且无错误", st.quickCapture.registered === false && st.quickCapture.error === null && st.addMaterial.registered === false, "false/null/false", `${st.quickCapture.registered}/${st.quickCapture.error}/${st.addMaterial.registered}`);
    check("status 形状完整", typeof st.hideOnBlur === "boolean" && typeof st.autoLaunch === "boolean" && typeof st.quickCapture.accelerator === "string", true, JSON.stringify(st));
    check("随系统启动状态可读", typeof quickCapture.isAutoLaunchOn() === "boolean", true, typeof quickCapture.isAutoLaunchOn());
    quickCapture.prepareQuit();
    setShortcuts({});

    console.log(`\nM8 db/配置: ${pass} 通过 / ${fail} 失败`);
  } catch (e) {
    fail++;
    console.log("M8 测试异常", e);
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* 清理失败不掩盖结果 */
    }
  }
  app.exit(fail > 0 ? 1 : 0);
});
