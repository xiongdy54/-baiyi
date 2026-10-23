// F92 接口校验类修复验证（D-TEST-74 遗忘状态值域 / D-TEST-75 语言码形状 / D-TEST-79 原判据复检）
// @runtime: electron  @tier: 1  @gui: false  @id: F92  @timeout: 240
// 运行：npx electron tests/flows/f92-fix-batch4.cjs
//
// S3 是**复检**：D-TEST-79 原文说"传 5000 个 nodeIds 会回一个 5000 条目的对象"，
// 但读码发现 listMindmapLearningStatus 里本来就有 nodeIds.slice(0, 500)（db.js:4632）。
// 两者只能有一个对，所以本条直接量返回对象的键数——错了就把缺陷标为推翻，而不是去"修"一个本来就有防护的函数。
"use strict";
const path = require("path");
const { app } = require("electron");
const { Flow, runFlow, ROOT, tmpUserDataDir, freshDir } = require("./lib/harness.cjs");
const { audit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F92",
  title: "接口校验类修复验证",
  angle: "遗忘状态值域 / 语言码形状 / 导图响应上限（复检原判据）",
  cites: ["D-TEST-74", "D-TEST-75", "D-TEST-79", "v48.21/D57"],
  tier: 1,
  gui: false,
});

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f92"));
    app.setPath("userData", dir);
    const dbFile = path.join(dir, "library.db");
    const db = require(path.join(ROOT, "electron", "db.js"));
    await db.initDb();

    await runFlow(flow, async () => {
      const it = db.createFromPaste("F92 校验书", "# 章\n\n为接口校验而造。\n");
      const itemId = it && (it.id || (it.item && it.item.id));
      const docId = it && (it.documentId || (it.doc && it.doc.id));
      const c = db.createCard({ itemId, frontMarkdown: "F92 卡", backMarkdown: "答", cardType: "qa" });
      const cardId = c && (c.id || c.cardId);
      db.persistNow();
      const leechOf = async () => {
        const a = await audit(dbFile);
        const r = a.rows("SELECT leech_json FROM cards").filter(Boolean)[0];
        a.close();
        return r && r.leech_json;
      };

      flow.section("S1 D-TEST-74：遗忘状态的值域校验");
      const junk = [
        { lapses: -999 }, { hitCount: 1e15 }, { isLeech: "yes" }, { suspended: 1 }, { lapses: 1.5 }, { lapses: Number.NaN },
      ];
      let rejected = 0;
      for (const j of junk) {
        const r = db.updateCardLeech(cardId, j);
        if (r === null) rejected++;
      }
      db.persistNow();
      const afterJunk = await leechOf();
      flow.record("六种垃圾值", `被拒 ${rejected}/6 · 盘上 leech_json=${String(afterJunk).slice(0, 90)}`);
      flow.check("六种越界/错类型的遗忘状态字段必须全部被拒", rejected === 6, "6/6", `${rejected}/6`);
      flow.check("被拒时不得把垃圾写进盘（leech_json 里不许出现 -999 / 1e+15 / \"yes\"）",
        !/-999|1e\+15|"yes"|"isLeech":"yes"/.test(String(afterJunk)), "无垃圾", String(afterJunk).slice(0, 80));

      const okPatch = { isLeech: true, lapses: 9, hitCount: 12 };
      const okRes = db.updateCardLeech(cardId, okPatch);
      db.persistNow();
      const afterOk = await leechOf();
      flow.record("合法 patch", `返回=${okRes} · 盘上=${String(afterOk).slice(0, 90)}`);
      flow.check("对照：合法值必须照常写入（不是把功能整体关掉）", okRes === true && /"lapses":9/.test(String(afterOk)) && /"isLeech":true/.test(String(afterOk)), "写入 lapses=9/isLeech=true", String(afterOk).slice(0, 80));

      flow.section("S2 D-TEST-75：library_items.lang 的形状校验与规范化");
      // 契约按"主进程实际能达成的"来定：形状 + 规范化 + 空串清空。
      // 拦不住"形似合法但不存在的码"（not-a-lang / en-US-x）——那需要语言注册表，而仓库里唯一的
      // 词典语言码表在渲染层（src/lib/dictClient.ts:218），主进程没有权威清单。这一点如实记为残差，
      // 不写成判据，否则这条流程会永远红在一件本层做不到的事上（与 F85 处理 D34 同一手法）。
      const langCases = [
        { v: "中文", kind: "reject" },
        { v: "  ", kind: "reject" },
        { v: "12", kind: "reject" },
        { v: "EN", kind: "normalize", want: "en" },
        { v: "ja", kind: "normalize", want: "ja" },
        { v: "", kind: "clear" },
        { v: "not-a-lang", kind: "shape-ok", note: "形似合法，需注册表才能拒" },
        { v: "en-US-x", kind: "shape-ok", note: "BCP-47 合法私有段，必须接受" },
      ];
      const results = [];
      for (const cs of langCases) {
        const ret = db.setLibraryItemLang(itemId, cs.v);
        db.persistNow();
        const a = await audit(dbFile);
        const row = a.rows("SELECT lang FROM library_items").filter((r) => r.lang !== undefined)[0];
        a.close();
        const onDisk = row ? String(row.lang) : "(无)";
        let pass;
        if (cs.kind === "reject") pass = ret === false;
        else if (cs.kind === "normalize") pass = ret === true && onDisk === cs.want;
        else if (cs.kind === "clear") pass = ret === true && onDisk === "";
        else pass = ret === true; // shape-ok：只要不被形状规则误拒即可
        results.push({ v: cs.v, kind: cs.kind, ret, onDisk, pass, note: cs.note || "" });
      }
      flow.record("逐例读数", results.map((r) => `${JSON.stringify(r.v)}[${r.kind}]→ret=${r.ret},盘=${JSON.stringify(r.onDisk)}${r.pass ? " OK" : " **不符**"}`).join(" | "));
      const bad = results.filter((r) => !r.pass);
      flow.check("语言码契约（拒绝非 ASCII/纯空白/纯数字；规范化大小写；空串清空；形状合法值不得被误拒）", bad.length === 0, "8/8", bad.length ? bad.map((r) => JSON.stringify(r.v)).join(",") : "8/8 全对");
      flow.check("被拒的非法值不得留在盘上（中文 不许落盘）", !/中文/.test(results.map((r) => r.onDisk).join(",")), "无脏值", results.map((r) => r.onDisk).join(","));
      flow.record("D-TEST-75 残差（本层做不到的部分）", "not-a-lang 形似合法、形状规则无法拒；要拒必须拿到语言注册表，而该表在渲染层。已按 D-TEST-77 同一处理记为渲染层侧后续项，本条状态为**部分修复**");

      flow.section("S3 复检 D-TEST-79：5000 个 nodeIds 到底回多少条目");
      const ids = Array.from({ length: 5000 }, (_, i) => `nid-${i}`);
      let shape = "-";
      try {
        const r = db.listMindmapLearningStatus(docId, ids);
        const keys = r && typeof r === "object" ? Object.keys(r).length : -1;
        shape = `键数=${keys}`;
        flow.record("5000 输入", shape);
        flow.check("响应规模必须有上限（原判据称会回 5000 条）", keys <= 500, "≤500", String(keys));
      } catch (e) {
        flow.record("抛错", String(e.message).slice(0, 120));
        flow.check("不得因超大输入抛错", false, "不抛", String(e.message).slice(0, 80));
      }
      flow.record("S3 口径说明", "若键数=500，则 D-TEST-79 原文「回 5000 条」为误记（代码里本就有 slice(0,500)），应把该条标为推翻；若键数=5000，则它是真缺陷、需要加限制");
      flow.record("未覆盖", "language 的\"形似合法但不存在的码\"（如 not-a-lang 之外的 en-XX）需要语言注册表，主进程无权威清单，记为渲染层侧后续项");
    });
  })
  .catch((e) => {
    flow.check("流程未崩溃", false, "不抛", String((e && e.stack) || e).slice(0, 400));
    process.exitCode = 1;
  })
  // C-45：Electron 主进程不会自行退出；延迟 200 ms，让结果文件与日志先写完
  .finally(() => setTimeout(() => app.exit(process.exitCode || 0), 200));
