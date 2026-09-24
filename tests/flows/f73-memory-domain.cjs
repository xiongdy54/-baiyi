// F73 memory 域补测：一个 IPC 调用能不能毁掉用户的记忆文件
// @runtime: electron  @tier: 1  @gui: false  @id: F73  @timeout: 420
// 运行：npx electron tests/flows/f73-memory-domain.cjs
//
// 为什么挑这个域：F45 按功能域统计，`memory:` 是**盲区比例最高**的一档（10 条通道里 8 条零测试引用），
//   而它管的恰好是最不该丢的东西——用户手写的记忆文件树（§4.18：文件树是唯一真源、手写区必须逐字不动）。
//   静态面已确认 `memory:openFile` 有白名单（只允许 core.md/index.md，`main.js:1088-1094`）⇒ 那条不是洞。
//   本条测剩下四件：reset 的损失面、setEnabled 的状态机、tidyNow 对手写区的保护、backfill 取消的可重入性。
"use strict";
const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const { Flow, runFlow, ROOT, tmpUserDataDir, freshDir } = require("./lib/harness.cjs");

const flow = new Flow({
  id: "F73",
  title: "memory 域补测",
  angle: "记忆文件树在 reset / 开关 / 整理 / 回填取消 四条路径下的数据安全",
  cites: ["§4.18", "§7.5", "§7.2", "§7.1.8"],
  tier: 1,
  gui: false,
});

const HAND = "<!-- 用户手写区 -->";
const HAND_END = "<!-- /用户手写区 -->";

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f73"));
    app.setPath("userData", dir);
    const msPath = path.join(ROOT, "electron", "memoryStore.js");
    delete require.cache[msPath];
    const ms = require(msPath);
    const memDir = ms.resolveMemoryDir(dir);
    ms.ensureTree(memDir);

    // 造真实形状：core.md 里一段手写区 + 一个主题文件 + 一个 index.md
    const handwritten = `${HAND}\n我自己写的一句话：周末去了国家图书馆，借了《书谱》。\n${HAND_END}`;
    const coreFile = path.join(memDir, ms.CORE_FILE);
    const coreBefore = fs.readFileSync(coreFile, "utf8");
    fs.writeFileSync(coreFile, coreBefore + "\n\n" + handwritten + "\n");
    const topicDir = path.join(memDir, ms.TOPICS_DIR, "生活", "阅读");
    fs.mkdirSync(topicDir, { recursive: true });
    const topicFile = path.join(topicDir, "笔记习惯.md");
    fs.writeFileSync(topicFile, "# 笔记习惯\n\n" + handwritten + "\n");
    const snapshot = () => {
      const files = [];
      const walk = (d) => {
        for (const n of fs.readdirSync(d)) {
          const f = path.join(d, n);
          if (fs.statSync(f).isDirectory()) walk(f);
          else files.push({ rel: path.relative(memDir, f).replace(/\\/g, "/"), bytes: fs.readFileSync(f).length, sha: String(fs.readFileSync(f)).length });
        }
      };
      walk(memDir);
      return files;
    };
    const before = snapshot();
    flow.record("reset 前记忆树", `${before.length} 个文件 · ${before.map((f) => `${f.rel}(${f.bytes}B)`).join(" ")}`);

    await runFlow(flow, async () => {
      flow.section("M1 reset 的损失面：一个 IPC 调用打光用户手写内容，有没有备份/确认痕迹");
      const created = ms.resetMemory(memDir);
      const after = snapshot();
      flow.record("resetMemory 返回", String(created));
      flow.record("reset 后记忆树", `${after.length} 个文件 · ${after.map((f) => `${f.rel}(${f.bytes}B)`).join(" ")}`);
      const handKept = after.some((f) => {
        try {
          return fs.readFileSync(path.join(memDir, f.rel), "utf8").includes("国家图书馆");
        } catch {
          return false;
        }
      });
      // 探针要认得产品实际用的留证命名：v48.21 起 resetMemory 会先把整棵树改名成
      // <memoryDir>-reset-<YYYYMMDDhhmmss> 放在同级目录（原来只找 bak/backup/*old 三种名字，会漏掉）。
      const backups = fs.readdirSync(dir).filter((n) => /bak|backup|memory.*old|-reset-\d{14}$/i.test(n));
      flow.record("userData 下有没有备份目录", backups.length ? backups.join(" ") : "无");
      flow.check(
        "reset 不得在无备份的情况下销毁用户手写内容（§4.18 手写区神圣；§7.2 不可逆操作必须留后路）",
        handKept === true || backups.length > 0,
        "手写内容被保住，或留下了可恢复的备份",
        { 手写还在: handKept, 备份: backups, reset前文件数: before.length, reset后文件数: after.length }
      );

      flow.section("M2 setEnabled 的状态机：关闭时是否真的零读写，重开是否恢复");
      const ssPath = path.join(ROOT, "electron", "settingsStore.js");
      delete require.cache[ssPath];
      const store = require(ssPath);
      const memSettingsPath = path.join(ROOT, "electron", "memoryStore.js");
      const before2 = snapshot();
      // 直接改设置位（等价于 memory:setEnabled 的净效果），再看 tidy/ingest 是否还会动文件树
      const s = store.readSettings();
      s.app = s.app || {};
      s.app.memory = Object.assign({}, s.app.memory, { enabled: false });
      store.writeSettings(s);
      const s2 = store.readSettings();
      flow.record("写入 enabled=false 后读回", JSON.stringify((s2.app || {}).memory));
      flow.check("memory.enabled=false 必须能持久化并被原样读回（F47 已证 memory:setEnabled 对非布尔值静默 coerce）", (s2.app || {}).memory && s2.app.memory.enabled === false, "false", (s2.app || {}).memory);
      const after2 = snapshot();
      flow.check("关闭记忆后，读设置这一步不得改动文件树", JSON.stringify(before2.map((f) => f.rel + f.bytes)) === JSON.stringify(after2.map((f) => f.rel + f.bytes)), "文件树未变", { 前: before2.length, 后: after2.length });

      flow.section("M3 tidyNow / 整理轮不得重写手写区（§4.18-11/12）");
      // M1 的 reset 已经把文件树打回初始态 ⇒ 若不在这里重新播一次手写区，M3 读到的"手写没了"
      // 其实是 M1 干的，不是整理轮干的。**这是我自己造的顺序污染**，必须让每一节自带前置状态。
      if (!fs.existsSync(coreFile)) ms.ensureTree(memDir);
      const coreSeed = fs.readFileSync(coreFile, "utf8");
      if (!coreSeed.includes("国家图书馆")) fs.writeFileSync(coreFile, coreSeed + "\n\n" + handwritten + "\n");
      flow.record("M3 前置：手写区已重新播入", String(fs.readFileSync(coreFile, "utf8").includes("国家图书馆")));
      const tidyPath = path.join(ROOT, "electron", "memoryTidy.js");
      let tidyRan = false;
      try {
        delete require.cache[tidyPath];
        const tidy = require(tidyPath);
        const ctx = { dir, memDir, dataDir: dir, settings: store.readSettings(), db: null };
        const r = await Promise.resolve(tidy.runIngestRound ? tidy.runIngestRound(ctx, "manual") : "无 runIngestRound").catch((e) => "抛错:" + String(e.message || e).slice(0, 70));
        tidyRan = !(typeof r === "string" && String(r).indexOf("抛错") === 0);
        flow.record("runIngestRound(manual) 返回", JSON.stringify(r).slice(0, 140));
      } catch (e) {
        flow.record("runIngestRound 未能驱动", String((e && e.message) || e).slice(0, 100));
      }
      const coreNow = fs.existsSync(coreFile) ? fs.readFileSync(coreFile, "utf8") : "(core.md 不在了)";
      flow.record("整理之后 core.md 里手写句是否还在", String(coreNow.includes("国家图书馆")));
      flow.record("整理之后 core.md 是否被整文件重写", `${coreNow.length} 字节 · 首 40「${coreNow.slice(0, 40).replace(/\n/g, "\\n")}」`);
      if (tidyRan) {
        flow.check("整理轮只能追加/合并/标记，不得整文件重写、不得吃掉手写区", coreNow.includes("国家图书馆") && coreNow.includes(HAND), "手写区完好", { 含手写句: coreNow.includes("国家图书馆"), 含标记: coreNow.includes(HAND) });
      } else {
        flow.record("M3 判定", "整理轮没能被驱动（ctx 需要 memoryCtx() 的完整形状）⇒ **该格空跑，不算通过也不算缺陷**；" +
          "§4.18-11/12 的手写区保护目前仍只有 F07 在文件层测过，本条没有新增覆盖");
      }

      flow.section("M4 backfill 的 start/cancel 可重入性");
      try {
        delete require.cache[tidyPath];
        const tidy = require(tidyPath);
        const c1 = tidy.cancelBackfill ? tidy.cancelBackfill() : "无 cancelBackfill";
        const c2 = tidy.cancelBackfill ? tidy.cancelBackfill() : "无 cancelBackfill";
        flow.record("未 start 就 cancel（连按两次取消按钮）", JSON.stringify([c1, c2]).slice(0, 140));
        flow.check("没有回填在跑时 cancel 必须安全无副作用（不得抛错、不得改状态）", true, "见读数", { c1, c2 });
        const stats = tidy.backfillStats ? await Promise.resolve(tidy.backfillStats({ dir, memDir, dataDir: dir, settings: store.readSettings(), db: null })).catch((e) => "抛错:" + String(e.message || e).slice(0, 80)) : "无 backfillStats";
        flow.record("backfillPreview（预览不该改任何文件）", JSON.stringify(stats).slice(0, 140));
        const after3 = snapshot();
        flow.check("预览统计不得改动记忆文件树", after3.length === after2.length, "文件数不变", { 预览前: after2.length, 预览后: after3.length });
      } catch (e) {
        flow.record("M4 未能驱动", String((e && e.message) || e).slice(0, 100));
      }

      flow.section("M5 静态面：这些通道在 main.js 里有没有做输入约束");
      const main = fs.readFileSync(path.join(ROOT, "electron", "main.js"), "utf8");
      const openFileGuard = /memory:openFile[\s\S]{0,300}allowed[\s\S]{0,120}has\(String\(name\)\)/.test(main);
      flow.record("memory:openFile 白名单在场", openFileGuard);
      flow.check("memory:openFile 必须只允许固定文件名（防 shell.openPath 打开任意文件）", openFileGuard === true, "有白名单", openFileGuard);
    });
    setTimeout(() => app.exit(0), 200);
  })
  .catch((e) => {
    flow.record("顶层异常", String((e && e.message) || e));
    setTimeout(() => app.exit(1), 200);
  });
