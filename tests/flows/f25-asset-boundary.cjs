// F25 资源落盘与文件边界（换角度：导入器要把字节写到盘上，写去哪、写坏怎么办）
// @runtime: electron  @tier: 2  @gui: false  @id: F25  @timeout: 240
// 运行：FLOW_INSTANCE=manual npx electron tests/flows/f25-asset-boundary.cjs
//
// 角度：前 24 条测的是「库里的事实」，这条测**磁盘上的文件**。渐进阅读软件的入口是别人的文件：
//       EPUB / Word / HTML / Markdown 拖着内嵌图进来，字节要落进 userData/assets/<itemId>/，
//       之后合成 EPUB 时再取回。§7.5 把「不可信内容进得来、越界的事做不了」写成红线，
//       而同一段代码里图片有 `[\w.-]+` 文件名防护、原书文件却直接 path.join(dir, originalName)
//       ——两条路径的信任级别明显不该一样。这条就用真实探针把这条不对称量出来，
//       顺带核对资源往返、单图缺失兜底、封面形状、删书后的资源语义。
//
// 依据：§7.5（安全边界）、§6.1/§9.1 M6（导入格式与内嵌图）、§7.2（软删除与文件真源）、
//       §7.1.4（重启不丢数据）、§9.1 M2（备份含 assets）、db.js:956 图片名防护与 :990「单图缺失不阻塞整本」。
"use strict";
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { app } = require("electron");
const { Flow, runFlow, tmpUserDataDir, freshDir, ROOT } = require("./lib/harness.cjs");
const { audit, quit } = require("./lib/dbenv.cjs");
const JSZip = require("jszip");

const flow = new Flow({
  id: "F25",
  title: "资源落盘与文件边界",
  angle: "导入器写盘的路径边界、资源往返、单图缺失兜底、删书后的资源语义",
  cites: ["§7.5", "§6.1", "§7.2", "§7.1.4", "§9.1 M2", "§9.1 M6"],
  tier: 2,
  gui: false,
});

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex").slice(0, 12);
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000975d1b7d00000000049454e44ae426082", "hex");

/** 递归列出目录里的所有相对路径 */
function tree(dir) {
  const out = [];
  const walk = (d, rel) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else out.push(r);
    }
  };
  walk(dir, "");
  return out;
}

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f25"));
    app.setPath("userData", dir);
    const parentOfUserData = path.dirname(dir);

    const s = await runFlow(flow, async () => {
      const db = require(path.join(ROOT, "electron", "db.js"));
      await db.initDb();

      // ---------- V1 原书文件名必须被关在 assets/<itemId>/ 里 ----------
      flow.section("V1 导入原书的文件名不得把字节写到 assets/<itemId>/ 之外（§7.5 红线）");
      const traversalNames = ["../evil-1.md", "../../evil-2.md", "..\\evil-3.md", path.join(parentOfUserData, "evil-4.md"), "/tmp/evil-5.md", "sub/../evil-6.md", "..", "a".repeat(240) + ".md", "evil-­‌.md", "CON.md"];
      const before = new Set(tree(dir));
      const wroteOutside = [];
      const threwHard = [];
      for (const nm of traversalNames) {
        try {
          db.createImportedDoc({ title: "F25 " + nm.slice(0, 12), markdown: "# 章\n\n正文", sourceType: "markdown", sourceName: nm, originalName: nm, originalBuf: Buffer.from("# 原文件字节 " + nm), images: [] });
        } catch (e) {
          threwHard.push(`${JSON.stringify(nm.slice(0, 24))}: ${String((e && e.message) || e).slice(0, 34)}`);
        }
      }
      for (const rel of tree(dir)) {
        if (before.has(rel)) continue;
        if (!/^assets\/[^/]+\/[^/]+$/.test(rel)) wroteOutside.push(rel);
      }
      const escapedOnDisk = fs.existsSync(path.join(dir, "evil-1.md")) || fs.existsSync(path.join(parentOfUserData, "evil-2.md")) || fs.existsSync(path.join(parentOfUserData, "evil-3.md")) || fs.existsSync(path.join(parentOfUserData, "evil-4.md")) || fs.existsSync("/tmp/evil-5.md");
      flow.record("新增文件分布", tree(dir).filter((r) => !before.has(r)).map((r) => r.split("/").slice(0, 2).join("/")).slice(0, 6).join(" ") || "（无新增）");
      flow.check("畸形 originalName 的两个表现都必须被堵住：静默写到卡目录之外 / 直接抛错让整本导入失败",
        wroteOutside.length === 0 && !escapedOnDisk && threwHard.length === 0, "全部关在卡目录内且不抛",
        { 越界文件: wroteOutside, 探针命中: escapedOnDisk, 抛错: threwHard });
      // 批次 C（D-TEST-17）新增：净化后的名字必须真落在自己的 item 目录内（path.resolve 前缀校验，
      // 而不是只看相对路径长什么样）
      const insideDirs = tree(dir)
        .filter((r) => !before.has(r) && /^assets\/[^/]+\/[^/]+$/.test(r))
        .map((r) => {
          const parts = r.split("/");
          const itemDirAbs = path.resolve(dir, parts[0], parts[1]);
          return { r, inside: path.resolve(dir, r).startsWith(itemDirAbs + path.sep) };
        });
      flow.check("净化后的每个落盘点都在该 item 目录内（resolve 前缀校验）", insideDirs.length > 0 && insideDirs.every((x) => x.inside), "全部在内", insideDirs.filter((x) => !x.inside).map((x) => x.r));
      flow.check("没有任何净化后的名字仍带路径分隔符或纯点", insideDirs.every((x) => !/[\\/]/.test(x.r.split("/").pop()) && !/^\.+$/.test(x.r.split("/").pop())), "名字干净", insideDirs.map((x) => x.r.split("/").pop()).filter((n) => /^\.+$/.test(n)));

      // ---------- V2 图片名防护的另一半 ----------
      flow.section("V2 内嵌图有文件名防护，但要防住「合法却危险」的名字（db.js:956）");
      const imgBad = [];
      const beforeImg = new Set(tree(dir));
      for (const fn of ["img-1.png", "..", "...", "a-b_c.png", "a-b/../x.png", "img:.png"]) {
        try {
          db.createImportedDoc({ title: "F25 图 " + fn, markdown: "# 章\n\n正文", sourceType: "markdown", originalName: "src.md", originalBuf: Buffer.from("x"), images: [{ filename: fn, bytes: PNG }].filter((x) => x.bytes.length) });
        } catch (e) {
          imgBad.push(`${JSON.stringify(fn)}: ${String((e && e.message) || e).slice(0, 30)}`);
        }
      }
      flow.check("图片名防护得覆盖「合法却危险」的名字：`..` 过 [\w.-]+ 正则后写目录抛 EISDIR，整本导入失败", imgBad.length === 0, "不抛", imgBad);
      const strayAfterImg = tree(dir).filter((r) => !beforeImg.has(r) && !/^assets\/[^/]+\/[^/]+$/.test(r));
      flow.check("图片写入也不得落到卡目录之外", strayAfterImg.length === 0, "全部在内", strayAfterImg);

      // ---------- V3 资源往返：写进去的字节必须原样取得回 ----------
      flow.section("V3 导入字节 → 磁盘 → 读回必须逐字节相同，重启后仍然如此（§7.1.4 / §9.1 M6）");
      const big = Buffer.concat(Array.from({ length: 40 }, () => Buffer.from("# 渐进阅读正文片段，够长才能测出截断。\n", "utf8")));
      const r3 = db.createImportedDoc({ title: "F23 往返书".replace("F23", "F25"), markdown: "# 章\n\n正文", sourceType: "markdown", sourceName: "roundtrip.md", originalName: "roundtrip.md", originalBuf: big, images: [{ filename: "img-1.png", bytes: PNG }, { filename: "img-2.png", bytes: PNG }] });
      const itemDir = path.join(dir, "assets", r3.id);
      flow.check("原书与两张内嵌图都落在自己的卡目录里", fs.existsSync(path.join(itemDir, "roundtrip.md")) && fs.existsSync(path.join(itemDir, "img-1.png")) && fs.existsSync(path.join(itemDir, "img-2.png")), "三个文件", tree(dir).filter((x) => x.startsWith("assets/" + r3.id)));
      flow.eq("落盘字节与原 buffer 同摘要", sha(fs.readFileSync(path.join(itemDir, "roundtrip.md"))), sha(big));
      const imgs = db.readContentImages(r3.id);
      flow.eq("readContentImages 取回两张图", imgs.length, 2);
      flow.eq("取回字节摘要一致", sha(Buffer.from(imgs[0].bytes)), sha(PNG));
      const audV = await audit(path.join(dir, "library.db"));
      flow.record("assets 表里该书的行数与 kind", audV.all("assets").filter((a) => a.library_item_id === r3.id).map((a) => a.kind).join(","));
      audV.close();

      // ---------- V4 单图缺失不阻塞整本 ----------
      flow.section("V4 表里有记录、盘上没文件时不得抛（db.js:990 承诺「单图缺失不阻塞整本」）");
      fs.unlinkSync(path.join(itemDir, "img-1.png"));
      let v4err = null;
      let got = 0;
      try {
        got = db.readContentImages(r3.id).length;
      } catch (e) {
        v4err = String((e && e.message) || e).slice(0, 40);
      }
      flow.eq("缺一张图仍返回剩下的", v4err || got, 1);
      fs.writeFileSync(path.join(itemDir, "img-1.png"), PNG);
      flow.eq("文件回来后恢复两张", db.readContentImages(r3.id).length, 2);

      // ---------- V5 封面 dataURL 形状兜底 ----------
      flow.section("V5 封面是外部传来的 dataURL：坏形状不得写坏文件、不得崩（§7.5 不可信入口）");
      const covers = ["data:image/png;base64,!!!坏base64!!!", "data:application/x-msdownload;base64,AAAA", "data:image/png;base64,", "not-a-data-url", "data:image/png;base64," + PNG.toString("base64"), ""];
      const coverBad = [];
      for (const c of covers) {
        try {
          const rr = db.createFromEpub("F25 封面 " + c.slice(5, 18), "# 章\n\n正文", [], c, PNG, "x.epub");
          if (rr && rr.cover && !/^cover\.\w+$/.test(String(rr.cover))) coverBad.push(`${c.slice(0, 26)} → cover=${rr.cover}`);
          const files = tree(dir).filter((f) => f.startsWith("assets/" + (rr && rr.id) + "/"));
          for (const f of files) if (!/^(cover\.\w+|original\.epub)$/.test(f.split("/").pop())) coverBad.push(`${c.slice(0, 26)} → 落出意外文件 ${f.split("/").pop()}`);
        } catch (e) {
          coverBad.push(`${c.slice(0, 26)}: 抛错 ${String((e && e.message) || e).slice(0, 26)}`);
        }
      }
      flow.check("六种封面形状全部安全（坏 mime 被忽略、好 mime 落 cover.ext）", coverBad.length === 0, "全部安全", coverBad);
      flow.eq("坏 base64 不产生半个封面文件", tree(dir).filter((f) => /cover\./.test(f) && fs.statSync(path.join(dir, f)).size === 0).length, 0);

      // ---------- V6 删书后的资源语义 ----------
      flow.section("V6 软删一本书之后：文件与表行都留着（保留历史），但列表/统计不再认它（§7.2）");
      db.deleteItem(r3.id);
      const stillThere = fs.existsSync(path.join(itemDir, "roundtrip.md"));
      flow.check("删书后资源文件仍在盘上（软删语义：数据不悄悄消失）", stillThere, true);
      flow.check("删书后不再出现在书架列表", db.listItems().some((i) => i.id === r3.id), false);
      const audD = await audit(path.join(dir, "library.db"));
      const assetRows = audD.all("assets").filter((a) => a.library_item_id === r3.id);
      flow.record("删书后 assets 行数与 is_deleted", `${assetRows.length} 行，is_deleted=${[...new Set(assetRows.map((a) => a.is_deleted))].join("/")}`);
      flow.check("删书后资源行应随之标记（否则备份/同步会永久带着已删书的字节）", assetRows.every((a) => a.is_deleted === 1), "全部标记", assetRows.map((a) => `${a.kind}:${a.is_deleted}`).join(","));
      audD.close();
      // 批次 C（D-TEST-18）新增：备份**内容**必须真的不含已删书的 item 目录，未删书逐份照旧；
      // 并且不传 deletedItemIds 时行为与今天完全一致（缺省不改语义）。
      db.persistNow();
      const bk = require(path.join(ROOT, "electron", "backup.js"));
      const aliveDirs = [...new Set(tree(dir).filter((r) => r.startsWith("assets/")).map((r) => r.split("/")[1]))].filter((id) => id && id !== r3.id);
      const withFilter = await bk.createBackup({ dataDir: dir, backupDir: freshDir(tmpUserDataDir("f25bk")), flush: () => db.persistNow(), deletedItemIds: new Set(db.listDeletedItemIds()), label: "probe" });
      const zipFiles = (a) => a.filter((n) => n.slice(-1) !== "/"); // JSZip 也列目录条目，计数只认文件
      const namesWith = zipFiles(withFilter.ok ? Object.keys((await JSZip.loadAsync(fs.readFileSync(withFilter.file))).files) : []);
      const noFilter = await bk.createBackup({ dataDir: dir, backupDir: freshDir(tmpUserDataDir("f25bk2")), flush: () => db.persistNow(), label: "probe2" });
      const namesWithout = zipFiles(noFilter.ok ? Object.keys((await JSZip.loadAsync(fs.readFileSync(noFilter.file))).files) : []);
      flow.check("两次备份探针都成功（前置条件）", Boolean(withFilter.ok && noFilter.ok), "ok", { 带过滤: withFilter.error || "ok", 缺省: noFilter.error || "ok" });
      flow.eq("已删书的 assets 不进备份", namesWith.filter((n) => n.indexOf("assets/" + r3.id + "/") === 0).length, 0);
      flow.eq("未删书的 assets 逐份照旧进备份", aliveDirs.filter((id) => !namesWith.some((n) => n.indexOf("assets/" + id + "/") === 0)), []);
      flow.eq("不传 deletedItemIds 时打包行为与今天一致（缺省 = 该书的字节全部照旧进包）", namesWithout.filter((n) => n.indexOf("assets/" + r3.id + "/") === 0).length, tree(dir).filter((r) => r.indexOf("assets/" + r3.id + "/") === 0).length);
      flow.eq("删书后队列与统计仍可算", typeof db.computeTodayQueue() === "object" && typeof db.getStatsOverview() === "object", true);
      // 只记录不判红：指南没有明文「删书后按 id 直读必须失败」，这条留给用户裁定
      flow.record("删书后仍能用 id 直读书面", db.getDocument(r3.id) ? "读得到（getDocument 不看 is_deleted）" : "读不到");
      flow.record("删书后原书文件仍可读回字节", (() => { try { const b = db.readBookFile(r3.id); return b && b.length ? `${b.length} 字节` : "null"; } catch (e) { return "抛错 " + String(e.message || e).slice(0, 20); } })());

      // ---------- V7 越界写的真实上限：能不能盖掉 settings.json ----------
      flow.section("V7 同一入口能否覆盖 userData 根下的其他文件（放最后跑，故意毁掉这个沙箱）");
      const dbFilePath = path.join(dir, "library.db");
      const sentinel = Buffer.from("THIS-IS-NOT-A-DATABASE".repeat(64), "utf8");
      const probeOf = (target) => {
        try {
          db.createImportedDoc({ title: "F25 覆盖探针 " + target, markdown: "# 章\n\n正文", sourceType: "markdown", originalName: "../../" + target, originalBuf: sentinel, images: [] });
          const p = path.join(dir, target);
          if (!fs.existsSync(p)) return "未写出";
          return fs.readFileSync(p).subarray(0, 22).toString("utf8") === "THIS-IS-NOT-A-DATABASE" ? "已被覆盖" : "内容仍是原文件";
        } catch (e) {
          return "抛错：" + String((e && e.message) || e).slice(0, 26);
        }
      };
      const dbOutcome = probeOf("library.db");
      const settingsOutcome = probeOf("settings.json");
      flow.record("覆盖 library.db 的结果", dbOutcome + "（import 末尾的 persist 会把主库整文件重写回来，所以销毁被掩盖）");
      flow.record("覆盖 settings.json 的结果", settingsOutcome);
      flow.check("一次导入不得能改写 userData 根下的 settings.json（用户全部偏好，且不会被任何写路径修回来）", settingsOutcome !== "已被覆盖", "盖不掉", settingsOutcome);
    });

    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F25 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String((e && e.message) || e) });
    process.exit(1);
  });
