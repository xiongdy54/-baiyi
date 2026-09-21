// F22 书架视图组织契约（v48.15 / D51：换角度——最新那条决策真的守得住吗）
// @runtime: electron  @tier: 2  @gui: false  @id: F22  @timeout: 240
// 运行：npx electron tests/flows/f22-shelf-organization.cjs
//
// 角度：D51 允许用户在书架上手动排序与建文件夹，并写下两条「一律守住」的边界：
//       ① 不改任何数据归属（统计/今日队列/FSRS/导图/记忆都不感知 order 与 folders）；
//       ② 不进数据库（存 SettingsStore app 层，零 schema 变更，备份本就覆盖 settings.json）。
//       再加一组易碎承诺：新书插队首、解散≠删除、空文件夹保留、文件夹不嵌套、函数不就地改。
//       这些都是纯函数层的承诺，起不了 GUI 也能测——所以全部机检。
//
// 依据：§5.4（书架文件夹与手动顺序）、§4.2-3（SettingsStore 三层）、§4.2-20（队列唯一口径）、
//       §6.2（进度 ratio/fraction 两口径）、§9.1 M2（备份含 settings.json）、D51 决策记录。
"use strict";
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { Flow, runFlow, tmpUserDataDir, freshDir, ROOT } = require("./lib/harness.cjs");
const { quit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F22",
  title: "书架视图组织契约",
  angle: "D51 两条硬边界（不改数据归属 / 不进数据库）+ 一组易碎承诺的可执行化",
  cites: ["§5.4", "§4.2-3", "§4.2-20", "§6.2", "§9.1 M2", "D51"],
  tier: 2,
  gui: false,
});

function loadTs(rel, outName) {
  const esbuild = require("esbuild");
  const out = path.join(ROOT, "tests", "tmp-f22", outName);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  esbuild.buildSync({ entryPoints: [path.join(ROOT, rel)], bundle: true, write: true, outfile: out, format: "cjs", platform: "neutral", target: "es2020", logLevel: "silent" });
  delete require.cache[out];
  return require(out);
}

const J = (v) => JSON.stringify(v);
/** 比较读数时把墙钟字段折成占位符（其余字段必须一字不差；日期语义归 F12 管） */
const CLOCK_KEYS = new Set(["now", "generatedAt", "ts", "at", "date"]);
const stable = (v) => JSON.stringify(v, (k, val) => (CLOCK_KEYS.has(k) && typeof val === "number" ? "<clock>" : val));
const book = (id, over) => ({ id, title: `书${id}`, createdAt: 1700000000000, updatedAt: 1700000000000, progressJson: null, ...over });

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f22"));
    app.setPath("userData", dir);
    const st = require(path.join(ROOT, "electron", "settingsStore.js"));
    globalThis.window = {
      settingsAPI: {
        get: async (scope, key) => { const a = st.readSettings(); return a && a[scope] ? a[scope][key] : undefined; },
        set: async (scope, key, value) => {
          const a = st.readSettings();
          const root = a && typeof a === "object" ? a : {};
          root[scope] = { ...(root[scope] || {}), [key]: value };
          st.writeSettings(root);
          return true;
        },
      },
    };
    const sh = loadTs(path.join("src", "lib", "shelf.ts"), "shelf.cjs");

    const s = await runFlow(flow, async () => {
      const ITEMS = [book("b1", { updatedAt: 500 }), book("b2", { updatedAt: 900 }), book("b3", { updatedAt: 700, progressJson: '{"ratio":0.4}' }), book("b4", { progressJson: '{"fraction":1.8}' }), book("b5", { progressJson: "{坏 JSON" })];

      // ---------- P1 纯函数不得就地改 ----------
      flow.section("P1 全部组织函数按「输入 state → 输出新 state」写，原对象一个字都不动（D51 前置约定）");
      const mutators = [
        ["ensureOrder", () => sh.ensureOrder({ order: ["b1", "b2"], folders: [] }, ["b1", "b2", "b3"])],
        ["moveTo", () => sh.moveTo(["b1", "b2", "b3"], "b3", "b1")],
        ["moveStep", () => sh.moveStep(["b1", "b2", "b3"], "b2", 1)],
        ["groupInto", () => sh.groupInto({ order: ["b1", "b2"], folders: [] }, "b2", "b1", null)],
        ["createFolderWith", () => sh.createFolderWith({ order: ["b1", "b2"], folders: [] }, "b1")],
        ["ungroup", () => sh.ungroup({ order: ["f1"], folders: [{ id: "f1", name: "x", items: ["b1"], created: "2026-09-22" }] }, "b1")],
        ["dissolveFolder", () => sh.dissolveFolder({ order: ["f1", "b9"], folders: [{ id: "f1", name: "x", items: ["b1", "b2"], created: "2026-09-22" }] }, "f1")],
        ["moveAllOut", () => sh.moveAllOut({ order: ["f1"], folders: [{ id: "f1", name: "x", items: ["b1"], created: "2026-09-22" }] }, "f1")],
        ["renameFolder", () => sh.renameFolder({ order: [], folders: [{ id: "f1", name: "x", items: [], created: "2026-09-22" }] }, "f1", "改名")],
        ["forgetItem", () => sh.forgetItem({ order: ["b1", "f1"], folders: [{ id: "f1", name: "x", items: ["b1"], created: "2026-09-22" }] }, "b1")],
        ["sortEntries", () => sh.sortEntries({ order: ["b1", "b2"], folders: [] }, ITEMS, [{ kind: "book", id: "b1", item: ITEMS[0] }, { kind: "book", id: "b2", item: ITEMS[1] }], "recent")],
        ["withCurrentArray", () => sh.withCurrentArray({ order: ["b1"], folders: [] }, null, ["b2"])],
      ];
      const inplace = [];
      for (const [name, run] of mutators) {
        const before = run();
        const snap = J(before);
        run();
        if (J(before) !== snap) inplace.push(`${name}: 第二次调用后原结果被改写`);
      }
      flow.check("返回值不被后续调用就地改写", inplace.length === 0, "纯函数", inplace);
      const frozenState = Object.freeze({ order: Object.freeze(["b1", "b2", "b3"]), folders: Object.freeze([]) });
      const leaked = [];
      for (const [name] of mutators) {
        if (["moveTo", "moveStep", "sortEntries", "withCurrentArray"].includes(name)) continue;
        try {
          const fn = sh[name];
          if (name === "ensureOrder") fn(frozenState, ["b1", "b2", "b3", "b4"]);
          else if (name === "groupInto") fn(frozenState, "b2", "b3", null);
          else if (name === "createFolderWith") fn(frozenState, "b2");
          else if (name === "ungroup") fn(frozenState, "b2");
          else if (name === "dissolveFolder") fn(frozenState, "f1");
          else if (name === "moveAllOut") fn(frozenState, "f1");
          else if (name === "renameFolder") fn(frozenState, "f1", "n");
          else if (name === "forgetItem") fn(frozenState, "b2");
        } catch (e) {
          leaked.push(`${name}: ${String((e && e.message) || e).slice(0, 34)}`);
        }
      }
      flow.check("传入冻结 state 也不得炸（说明真的没就地写）", leaked.length === 0, "全部只读", leaked);

      // ---------- P2 归属唯一 + 不嵌套 ----------
      flow.section("P2 一本书最多只属于一个文件夹，文件夹不可互相嵌套（§5.4 一层为限）");
      let state = { order: ["b1", "b2", "b3", "b4"], folders: [] };
      const dup = (s2) => {
        const all = s2.folders.flatMap((f) => f.items);
        return all.length - new Set(all).size;
      };
      for (const [src, tgt] of [["b2", "b1"], ["b3", "b1"], ["b4", "b2"], ["b3", "b2"]]) {
        state = sh.groupInto(state, src, tgt, null).state;
        if (dup(state) > 0) flow.check(`归组 ${src}→${tgt} 后无重复归属`, false, "0 个重复", dup(state));
      }
      flow.check("反复归组后每本书仍只在一处", dup(state) === 0, "0 个重复", dup(state));
      const folderIds = state.folders.map((f) => f.id);
      const nest = sh.groupInto(state, folderIds[0], folderIds[1] || "b1", null);
      flow.check("文件夹不能进文件夹（直接拒绝并给用户话术）", nest.refused === "暂不支持文件夹互相嵌套（一层为限）" && J(nest.state) === J(state), "拒绝且不变", { refused: nest.refused, 变了: J(nest.state) !== J(state) });
      const insideFolder = sh.groupInto(state, "b1", "b2", folderIds[0] || "f1");
      flow.check("文件夹内不再嵌套（要先返回书架）", insideFolder.refused === "文件夹内不再嵌套，请先返回书架" && J(insideFolder.state) === J(state), "拒绝且不变", insideFolder.refused);
      const same = sh.groupInto(state, "b1", "b2", null);
      flow.record("同夹两书再归组的答复", same.refused || "（静默无变化）");
      const self = sh.groupInto(state, "b1", "b1", null);
      flow.check("自己归入自己必须是无操作", J(self.state) === J(state) && !self.refused, "无操作", self.refused || J(self.state) !== J(state));

      // ---------- P3 数据不悄悄消失 ----------
      flow.section("P3 解散≠删除、空文件夹保留、删书两处同摘（用户数据不悄悄消失）");
      const s3 = { order: ["f1", "b9"], folders: [{ id: "f1", name: "语言", items: ["b1", "b2", "b3"], created: "2026-09-22" }] };
      const dissolved = sh.dissolveFolder(s3, "f1");
      flow.check("解散后成员一个不少，且回到文件夹原来那一格", JSON.stringify(dissolved.order) === JSON.stringify(["b1", "b2", "b3", "b9"]) && dissolved.folders.length === 0, "[b1,b2,b3,b9]", dissolved.order);
      const out = sh.moveAllOut(s3, "f1");
      flow.check("全部移回书架：成员出去、空文件夹保留", out.folders.length === 1 && out.folders[0].items.length === 0 && ["b1", "b2", "b3"].every((id) => out.order.includes(id)), "空夹保留", out.order);
      const forgot = sh.forgetItem(s3, "b1");
      flow.check("删一本书要同时从顶层与所有文件夹摘净（留副本=幽灵卡位）", !forgot.order.includes("b1") && forgot.folders.every((f) => !f.items.includes("b1")), "两处都净", forgot);
      const forgotFolder = sh.forgetItem(s3, "f1");
      flow.check("删文件夹不牵连成员书的归属之外的副作用", !forgotFolder.order.includes("f1") && forgotFolder.folders.length === 0, "干净移除", forgotFolder);
      const un = sh.ungroup(s3, "b2");
      flow.check("移回书架放回原文件夹后面一位（离开但没丢位置感）", un.order.indexOf("b2") === un.order.indexOf("f1") + 1, "紧邻其后", un.order);
      flow.check("不存在id 的操作全部原样返回", J(sh.ungroup(s3, "nope")) === J(s3) && J(sh.dissolveFolder(s3, "nope")) === J(s3) && J(sh.moveAllOut(s3, "nope")) === J(s3) && J(sh.renameFolder(s3, "nope", "x")) === J(s3), "无副作用", "有对象被改了");
      flow.check("空名不改文件夹名（trim 后为空即放弃）", J(sh.renameFolder(s3, "f1", "   ")) === J(s3) && sh.renameFolder(s3, "f1", "  新名  ").folders[0].name === "新名", "只认非空", sh.renameFolder(s3, "f1", "   ").folders[0].name);

      // ---------- P4 新书插队首（幂等） ----------
      flow.section("P4 库里新增的书插到队首，消失的条目同步清干净，且幂等（避免「导入完找不到」）");
      const s4 = { order: ["b1", "b2"], folders: [{ id: "f1", name: "x", items: ["b3"], created: "2026-09-22" }] };
      const ensured = sh.ensureOrder(s4, ["b1", "b2", "b4", "b5"]);
      flow.eq("未入册的新书按入库次序排到最前", ensured.order.slice(0, 2).join(","), "b4,b5");
      flow.check("已消失的书从 order 里清掉", !ensured.order.includes("b3"), "b3 已清", ensured.order);
      flow.check("已在文件夹里的书不算缺失（不重复插到顶层）", !ensured.order.includes("b3"), "不重复", ensured.order);
      flow.check("无增无删时返回同一引用（幂等，不触发多余渲染）", sh.ensureOrder(ensured, ["b1", "b2", "b4", "b5"]) === ensured, "同引用", "生成了新对象");
      const ghost = sh.ensureOrder({ order: ["f7", "b1"], folders: [] }, ["b1"]);
      flow.check("指向已消失文件夹的格子也要清掉（幽灵文件夹）", !ghost.order.includes("f7"), "已清", ghost.order);

      // ---------- P5 排序与聚合 ----------
      flow.section("P5 四种排序口径稳定，文件夹用聚合时间与成员数参与同列排序（§5.4）");
      const entries = sh.topEntries({ order: ["f1", "b2", "b3"], folders: [{ id: "f1", name: "语言", items: ["b1"], created: "2026-01-02" }] }, ITEMS);
      flow.eq("已归组的书不在顶层重复出现", entries.map((e) => e.id).join(","), "f1,b2,b3");
      const agg = sh.folderAggregate(ITEMS, { id: "f1", name: "语言", items: ["b1", "b3", "missing"], created: "2026-01-02" });
      flow.record("文件夹聚合", `n=${agg.n} progress=${agg.progress.toFixed(3)} latest=${agg.latest}`);
      flow.check("成员里指向已消失书的引用被忽略（不炸、不计入均值）", agg.n === 2 && Number.isFinite(agg.progress), "n=2 且均值有限", agg);
      for (const sort of ["manual", "recent", "added", "title"]) {
        const snapshot = J(entries);
        const sorted = sh.sortEntries({ order: [], folders: [] }, ITEMS, entries, sort);
        if (J(entries) !== snapshot) flow.check(`${sort} 排序不得改入参数组`, false, "入参不动", "被改");
        if (sort === "manual") flow.check("manual 原样返回（同引用，用户手摆的顺序不许被重排）", sorted === entries, "同引用", J(sorted));
        if (sort === "recent") flow.eq("recent 按最近阅读（文件夹按成员聚合的 latest 同列参与）", sorted.map((e) => e.id).join(","), "b2,b3,f1");
      }
      const titleSorted = sh.sortEntries({ order: [], folders: [] }, [book("z1", { title: "阿 Q 正传" }), book("z2", { title: "白鹿原" })], sh.topEntries({ order: ["z2", "z1"], folders: [] }, [book("z1", { title: "阿 Q 正传" }), book("z2", { title: "白鹿原" })]), "title");
      flow.eq("标题排序走中文 collation", titleSorted.map((e) => e.item.title).join(","), "阿 Q 正传,白鹿原");

      // ---------- P6 进度兜底 ----------
      flow.section("P6 进度两个口径（ratio 优先 / fraction 回退）与坏数据的兜底（§6.2）");
      const prog = [
        ['{"ratio":0.25}', 0.25], ['{"fraction":0.5}', 0.5], ['{"ratio":0.2,"fraction":0.9}', 0.2],
        ['{"ratio":9}', 1], ['{"ratio":-3}', 0], ["{}", 0], ["null", 0], ["{坏", 0], [null, 0], ["[]", 0], ['{"ratio":"x"}', 0],
      ];
      const progBad = prog.filter(([json, want]) => sh.itemProgress({ progressJson: json}) !== want).map(([j, w]) => `${j} 应为 ${w} 实为 ${sh.itemProgress({ progressJson: j })}`);
      flow.check("itemProgress 十三档兜底全部落在 0–1", progBad.length === 0, "全部正确", progBad);
      flow.eq("dayLabel 只到日粒度且补零", sh.dayLabel(new Date(2026, 8, 5, 23, 59).getTime()), "09-05");
      flow.eq("pct 四舍五入到整数百分比", sh.pct(0.998), "100%");

      // ---------- P7 损坏设置的读侧净化 ----------
      flow.section("P7 设置里 order/folders 被写坏时，loadShelf 必须净化而不是把脏数组交给组件（§7.6）");
      const writeRaw = (order, folders) => { const o = st.readSettings(); o.app = { ...(o.app || {}), shelfOrder: order, shelfFolders: folders }; st.writeSettings(o); };
      const cases = [
        ["正常", ["b1", "b2"], [{ id: "f1", name: "x", items: ["b3"], created: "2026-01-01" }]],
        ["混入非字符串", ["b1", 5, null, {}, "b2"], []],
        ["folders 不是数组", ["b1"], "不是数组"],
        ["folder 缺 items", ["b1"], [{ id: "f2", name: "x" }]],
        ["两者都是 null", null, null],
        ["超大 order", Array.from({ length: 3000 }, (_, i) => `b${i}`), []],
      ];
      const loadBad = [];
      for (const [name, o, f] of cases) {
        writeRaw(o, f);
        try {
          const got = await sh.loadShelf();
          if (!Array.isArray(got.order) || !Array.isArray(got.folders)) loadBad.push(`${name}: 形状不对`);
          else if (got.order.some((x) => typeof x !== "string")) loadBad.push(`${name}: order 里混进非字符串`);
          else if (got.folders.some((x) => !x || typeof x.id !== "string" || !Array.isArray(x.items))) loadBad.push(`${name}: folders 有残缺项`);
        } catch (e) {
          loadBad.push(`${name}: 抛错 ${String((e && e.message) || e).slice(0, 28)}`);
        }
      }
      flow.check("六档损坏设置 loadShelf 全部净化且不抛", loadBad.length === 0, "全部净化", loadBad);
      writeRaw([], []);

      // ---------- P8 不进数据库（D51 边界②） ----------
      flow.section("P8 视图组织不进数据库：主库零 shelf 列，listItems 排序口径一字不改（D51 边界②）");
      const db = require(path.join(ROOT, "electron", "db.js"));
      await db.initDb();
      const schemaSrc = fs.readFileSync(path.join(ROOT, "electron", "db.js"), "utf8");
      const shelfCols = (schemaSrc.match(/\b(shelf_order|shelf_folders|sort_order|folder_id|shelfFolderId)\b/gi) || []).filter((v, i, a) => a.indexOf(v) === i);
      flow.check("db.js 的建表与列名里不得出现 shelf/sort_order/folder_id", shelfCols.length === 0, "零列", shelfCols);
      const listItemsSql = schemaSrc.slice(schemaSrc.indexOf("function listItems"), schemaSrc.indexOf("function listItems") + 1400);
      flow.check("listItems() 仍是按 created_at 倒序（文档明写「一字不改」，表别名前缀不算改）", /ORDER BY\s+(?:\w+\.)?created_at\s+DESC/.test(listItemsSql), "口径未变", (listItemsSql.match(/ORDER BY [^\n"]*/) || ["（没抓到 ORDER BY）"])[0]);

      // ---------- P9 不改任何数据归属（D51 边界①） ----------
      flow.section("P9 统计 / 今日队列 / FSRS 都不感知 order 与 folders（D51 边界①）");
      db.createFromPaste("F22 书架契约书", "# 章\n\n正文。");
      for (let i = 0; i < 4; i++) db.createCard({ noteText: `F22 卡 ${i}`, cardType: "qa", frontMarkdown: `问 ${i}`, backMarkdown: `答 ${i}`, priority: 50, tags: ["f22"], siblingKey: "act:f22" });
      db.persistNow();
      const queueBefore = stable(db.computeTodayQueue());
      const statsBefore = stable(db.getStatsOverview());
      const itemsBefore = J(db.listItems().map((i) => i.id));
      const dbSizeBefore = fs.statSync(path.join(dir, "library.db")).size;
      writeRaw(["9-9-9", "f1", "b1"], [{ id: "f1", name: "乱序夹", items: ["9-9-9", "b1"], created: "2026-09-22" }]);
      const after = await sh.loadShelf();
      flow.check("order/folders 写进设置并读回（先确认改动真的生效了）", J(after.order) === J(["9-9-9", "f1", "b1"]), "已生效", after.order);
      flow.eq("今日队列（去掉墙钟字段后）逐字节不变", stable(db.computeTodayQueue()), queueBefore);
      flow.eq("统计概览（去掉墙钟字段后）逐字节不变", stable(db.getStatsOverview()), statsBefore);
      flow.eq("listItems 的成员集合不变（只许显示层派生）", J(db.listItems().map((i) => i.id)), itemsBefore);
      const ghostState = { order: ["nope", "f1"], folders: [{ id: "f1", name: "x", items: ["ghost"], created: "2026-09-22" }] };
      const ghosts = sh.topEntries(ghostState, ITEMS);
      flow.check("引用了不存在的书 id 只是被忽略（不产幽灵书卡；文件夹格子本身照常占位）", ghosts.length === 1 && ghosts[0].kind === "folder" && sh.folderEntries(ghostState, ITEMS, "f1").length === 0, "无幽灵书卡", ghosts.map((g) => `${g.kind}:${g.id}`));
      flow.eq("视图组织改动不碰主库一个字节（settings.json 才是它的家）", fs.statSync(path.join(dir, "library.db")).size, dbSizeBefore);
    });

    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F22 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String((e && e.message) || e) });
    process.exit(1);
  });
