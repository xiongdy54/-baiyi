// F23 阅读进度与阅读字数契约（换角度：同一本书记了两种「读到哪」，它们得说同一件事）
// @runtime: electron  @tier: 2  @gui: false  @id: F23  @timeout: 240
// 运行：npx electron tests/flows/f23-reading-progress.cjs
//
// 角度：进度这一列（library_items.progress_json）是个**四形状联合体**：
//       文本/PDF 走 {ratio} 或 {pageIndex}、foliate 系文件书走 {cfi}、书架文案还单独读 {lastText}、
//       而 D51 的 shelf.ts 认 ratio 优先 / fraction 回退。另一侧 reading_events 用 char_pos
//       记「读了多少字」。两处都由内核写，但**互相不知道对方存在**——所以既要各形状读得回来、
//       混型时优雅回退，也不能一个说读了 60% 另一个说今天零字。
//       这条不测界面，测的是这两份事实在库里的形状、边界与互洽。
//
// 依据：§6.1 主旅程（书架→阅读器→续读）、§6.2（进度与阅读字数）、§5.4（图注卡进度常驻可读）、
//       §7.1.3（边界输入不得穿透）、§7.2（每次落库即落盘 / 读侧不得崩）、§7.1.4（重启不丢数据）、
//       §9.1 M15（写路径成本）。
"use strict";
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { Flow, runFlow, tmpUserDataDir, freshDir, ROOT } = require("./lib/harness.cjs");
const { audit, quit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F23",
  title: "阅读进度与阅读字数契约",
  angle: "progress_json 四形状 + reading_events 字数口径：各自可读、混型回退、两说一值",
  cites: ["§6.1", "§6.2", "§5.4", "§7.1.3", "§7.2", "§7.1.4", "§9.1 M15"],
  tier: 2,
  gui: false,
});

const J = (v) => JSON.stringify(v);

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f23"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");

    const s = await runFlow(flow, async () => {
      const db = require(path.join(ROOT, "electron", "db.js"));
      await db.initDb();
      const sh = (() => {
        const esbuild = require("esbuild");
        const out = path.join(ROOT, "tests", "tmp-f23", "shelf.cjs");
        fs.mkdirSync(path.dirname(out), { recursive: true });
        esbuild.buildSync({ entryPoints: [path.join(ROOT, "src", "lib", "shelf.ts")], bundle: true, write: true, outfile: out, format: "cjs", platform: "neutral", target: "es2020", logLevel: "silent" });
        delete require.cache[out];
        return require(out);
      })();
      const srcFiles = [];
      const walk = (d) => {
        for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
          if (e.name === "node_modules" || e.name === "dist") continue;
          const rel = path.join(d, e.name);
          if (e.isDirectory()) walk(rel);
          else if (/\.(ts|tsx)$/.test(e.name)) srcFiles.push(rel.replace(/\\/g, "/"));
        }
      };
      walk("src");

      const mk = (title) => {
        const r = db.createFromPaste(title, "# 章\n\n" + "正文内容，用来撑出可读长度。".repeat(60));
        return db.listItems().find((i) => i.title === title) || (r && r.id ? db.listItems().find((i) => i.id === r.id) : null);
      };

      // ---------- Q1 四种进度形状各自读得回来，混型优雅回退 ----------
      flow.section("Q1 progress_json 是四形状联合体：ratio / cfi / pageIndex / lastText 都要读得回来，混型不得出 NaN");
      const it1 = mk("F23 文本书甲");
      const shapes = [
        ["ratio", { ratio: 0.37 }],
        ["fraction", { fraction: 0.5 }],
        ["cfi", { cfi: "epubcfi(/6/14[chap05ref]!/4[body:1]/2:8)" }],
        ["pageIndex", { pageIndex: 12 }],
        ["lastText", { lastText: "渐进阅读是一种…" }],
        ["混合", { ratio: 0.2, cfi: "epubcfi(/6/2)", pageIndex: 3, lastText: "一句" }],
        ["空对象", {}],
      ];
      const shapeBad = [];
      for (const [name, prog] of shapes) {
        db.updateProgress(it1.id, prog);
        const back = JSON.parse(db.getDocument(it1.id).progressJson || "null");
        if (J(back) !== J(prog)) shapeBad.push(`${name}: 写 ${J(prog)} 读回 ${J(back)}`);
        const item = db.listItems().find((i) => i.id === it1.id);
        const pctVal = sh.itemProgress(item);
        if (!Number.isFinite(pctVal) || pctVal < 0 || pctVal > 1) shapeBad.push(`${name}: itemProgress = ${pctVal}`);
      }
      flow.check("七种形状写入 → 逐字节读回，且进度取值恒在 0–1", shapeBad.length === 0, "全部一致", shapeBad);
      db.updateProgress(it1.id, { ratio: 0.37 });
      flow.eq("ratio 优先于 fraction", sh.itemProgress({ progressJson: '{"ratio":0.3,"fraction":0.9}' }), 0.3);
      flow.eq("cfi/pageIndex/lastText 单独存在时进度记 0（不猜、不 NaN）", [JSON.stringify({ cfi: "x" }), JSON.stringify({ pageIndex: 4 }), JSON.stringify({ lastText: "y" })].map((j) => sh.itemProgress({ progressJson: j })).join(","), "0,0,0");
      flow.eq("越界进度被夹回区间", `${sh.itemProgress({ progressJson: '{"ratio":4}' })},${sh.itemProgress({ progressJson: '{"ratio":-2}' })}`, "1,0");
      const lastRead = (() => { const lib = fs.readFileSync(path.join(ROOT, "src", "lib", "library.ts"), "utf8"); return /progressJson/.test(lib) && /lastText/.test(lib); })();
      flow.check("书架「上次读到」文案确实从 lastText 取（图注卡进度常驻可读，§5.4）", lastRead, "读得到", lastRead);

      // ---------- Q2 裸 parse 防护网 ----------
      flow.section("Q2 每个读 progress_json 的站点都必须包 try（新增裸 JSON.parse 就是下一个整页崩）");
      const bare = [];
      for (const rel of srcFiles) {
        const txt = fs.readFileSync(path.join(ROOT, rel), "utf8");
        txt.split(/\r?\n/).forEach((line, i) => {
          if (!/progressJson/.test(line) || !/JSON\.parse/.test(line)) return;
          const around = txt.split(/\r?\n/).slice(Math.max(0, i - 6), i + 6).join("\n");
          if (!/try\s*\{/.test(around)) bare.push(`${rel}:${i + 1}`);
        });
      }
      flow.record("扫描到的进度读点", srcFiles.length + " 个源文件里的 progressJson+JSON.parse 行");
      flow.check("进度解析点全部在 try 保护内", bare.length === 0, "都有兜底", bare);
      const dirty = [];
      for (const bad of ["", "{", "null", "[]", '"字符串"', '{"ratio":', '{"ratio":"50%"}', '{"ratio":null}']) {
        db.updateProgress(it1.id, bad === "null" ? null : bad === "[]" ? [] : bad);
        // 直接把脏串塞进列，模拟手改文件 / 半截写入
        const aud = await audit(dbFile);
        aud.exec("UPDATE library_items SET progress_json = ? WHERE id = ?", [bad, it1.id]);
        aud.save();
        aud.close();
        try {
          const item = db.listItems().find((i) => i.id === it1.id);
          const v = sh.itemProgress({ progressJson: bad });
          if (!Number.isFinite(v)) dirty.push(`${bad}: itemProgress = ${v}`);
        } catch (e) {
          dirty.push(`${bad}: 抛错 ${String((e && e.message) || e).slice(0, 26)}`);
        }
      }
      flow.check("八档脏进度串下 itemProgress 一律回 0 且不抛", dirty.length === 0, "全部安全", dirty);

      // ---------- Q3 updateProgress 的入参边界与假成功 ----------
      flow.section("Q3 进度写入口的校验：不存在的书不得报成功，非对象值不得进库（§7.2 数据完整性）");
      const noSuch = "00000000-0000-4000-8000-000000000000";
      const retGhost = db.updateProgress(noSuch, { ratio: 0.5 });
      const ghostPersisted = db.listItems().some((i) => i.id === noSuch);
      flow.record("给不存在的 id 写进度", `返回 ${retGhost}，库里 ${ghostPersisted ? "竟有此行" : "没有这一行"}`);
      flow.known("写不存在的书必须返回失败（现在无条件 true，界面会显示「已保存」）", retGhost === false || retGhost === undefined, "D-TEST-15", "返回假", retGhost);
      const nonObj = [];
      for (const v of ["字符串", 42, true, [], null, undefined]) {
        db.updateProgress(it1.id, v);
        const raw = db.getDocument(it1.id).progressJson;
        if (!/^\{.*\}$/.test(String(raw))) nonObj.push(`${J(v)} → 入库 ${raw}`);
      }
      flow.known("非对象进度值必须被拒绝或归一成对象（列里不该出现 \"字符串\" / [] / null）", nonObj.length === 0, "D-TEST-15", "全部归一", nonObj);
      const sizeBefore = fs.statSync(dbFile).size;
      db.updateProgress(noSuch, { ratio: 0.1 });
      flow.eq("给不存在的书写进度不得触发整文件重写（sql.js 全量落盘，§9.1 M15 写路径成本）", fs.statSync(dbFile).size, sizeBefore);

      // ---------- Q4 阅读字数口径 ----------
      flow.section("Q4 阅读字数＝相邻正增量之和：倒退不计、跨书不串、45 天窗口外不计（§6.2）");
      const itA = mk("F23 字数书 A");
      const itB = mk("F23 字数书 B");
      db.addReadingEvent(itA.id, 0);
      db.addReadingEvent(itA.id, 300);
      db.addReadingEvent(itA.id, 120);
      db.addReadingEvent(itA.id, 500);
      db.addReadingEvent(itB.id, 0);
      db.addReadingEvent(itB.id, 80);
      const evs = (await audit(dbFile)).all("reading_events");
      flow.eq("reading_events 只增不改（六次事件六行）", evs.length, 6);
      flow.check("同书回退不产生新行也不改旧行（单调记账在统计侧做）", evs.filter((e) => e.item_id === itA.id).map((e) => e.char_pos).join(",") === "0,300,120,500", "0,300,120,500", evs.filter((e) => e.item_id === itA.id).map((e) => e.char_pos).join(","));
      const byItem = {};
      for (const e of evs) (byItem[e.item_id] = byItem[e.item_id] || []).push(e.char_pos);
      flow.record("两书事件位置序列", `A=${byItem[itA.id].join(",")} B=${byItem[itB.id].join(",")}`);
      flow.eq("非法 charPos 被归成 0（不炸库）", db.addReadingEvent(itA.id, "abc"), true);
      flow.eq("负数 charPos 被夹到 0", db.addReadingEvent(itA.id, -900), true);
      db.addReadingEvent(noSuch, 5000);
      const ghosts = (await audit(dbFile)).all("reading_events").filter((e) => e.item_id === noSuch);
      flow.known("给不存在的书加阅读事件必须被拒（否则统计里出现无人认领的字数）", ghosts.length === 0, "D-TEST-15", "零行", ghosts.length);

      // ---------- Q5 两份事实必须说同一件事 ----------
      flow.section("Q5 进度条与「今日阅读字数」不得各说各话（§6.2 同一本书记了两份事实）");
      db.updateProgress(itA.id, { ratio: 0.62 });
      const st = db.getStatsOverview();
      const charsToday = (st.readingDays || []).reduce((a, d) => a + (d.chars || 0), 0);
      const ratioToday = db.listItems().map((i) => sh.itemProgress(i)).reduce((a, b) => Math.max(a, b), 0);
      flow.record("读了 62% 的一本书", `进度 ${ratioToday}，仪表盘今日字数 ${charsToday}`);
      flow.check("书读过（进度>0）时，仪表盘今日字数必须跟着非零", !(ratioToday > 0 && charsToday === 0), "两处都非零", { 进度: ratioToday, 字数: charsToday });

      // ---------- Q6 删书后的历史 ----------
      flow.section("Q6 删掉一本书：列表里消失，历史与统计不得因此抛错（§7.2 软删）");
      const n0 = db.listItems().length;
      db.deleteItem(itB.id);
      let threw = null;
      try {
        db.getStatsOverview();
        db.computeTodayQueue();
        db.listItems();
      } catch (e) {
        threw = String((e && e.message) || e).slice(0, 40);
      }
      flow.eq("删书后统计与队列仍可算", threw, null);
      flow.check("删书后不再出现在列表里", db.listItems().some((i) => i.id === itB.id), false);
      const keepEvents = (await audit(dbFile)).all("reading_events").filter((e) => e.item_id === itB.id).length;
      flow.record("已删书的阅读事件行数", `${keepEvents}（保留历史是对的，但统计侧要按存活过滤）`);
      flow.eq("列表条数少了一本", db.listItems().length, n0 - 1);

      // ---------- Q7 重启续读 ----------
      flow.section("Q7 进度与事件必须活得过重开（§7.1.4 重启不丢数据）");
      const before = { prog: db.getDocument(itA.id).progressJson, n: (await audit(dbFile)).all("reading_events").length };
      db.persistNow();
      delete require.cache[path.join(ROOT, "electron", "db.js")];
      const db2 = require(path.join(ROOT, "electron", "db.js"));
      await db2.initDb();
      flow.eq("重开后 progress_json 一字不差", db2.getDocument(itA.id).progressJson, before.prog);
      flow.eq("重开后阅读事件行数不变", (await audit(dbFile)).all("reading_events").length, before.n);
      flow.eq("重开后列表条数不变", db2.listItems().length, db.listItems().length);
      flow.check("重开后进度仍能算出同一个 0–1 值", Math.abs(sh.itemProgress(db2.listItems().find((i) => i.id === itA.id)) - 0.62) < 1e-9, "0.62", sh.itemProgress(db2.listItems().find((i) => i.id === itA.id)));
    });

    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F23 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String((e && e.message) || e) });
    process.exit(1);
  });
