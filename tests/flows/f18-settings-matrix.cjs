// F18 设置项生效矩阵与孤儿设置检测（换角度：写在设置里的东西，真的有人读吗）
// @runtime: electron  @tier: 2  @gui: false  @id: F18  @timeout: 300
// 运行：npx electron tests/flows/f18-settings-matrix.cjs   （或 node tests/flows/run.cjs --only F18）
//
// 角度：设置是用户与软件之间唯一的「长期契约」，也是最容易腐烂的地方——
//       键名改了、消费者删了、默认值语义变了，界面上看着都正常。
//       §7.4 把「站点域名、API baseUrl、镜像列表、提示词内容必须放配置」写成硬约束，
//       §4.16 / §4.18 / §6.5 / §7.4 v32 各处又各自点名了一串 settings.app.* 键。
//       这条做四件事：① 文档点名的「层.键」↔ 代码里的读数点 双向对齐（孤儿设置 + 未登记设置）；
//       ② 逐个按真实层写入-读回-重载模块往返（含三层互不覆盖）；
//       ③ 损坏/非法 settings.json 经真实消费路径的兜底；
//       ④ 冷启动：清缓存重 require db.js 跑 initDb，验证坏配置不会把应用挡在门外。
//
// 依据：§7.1.3 L857、§7.4（含 v32 追记的 dictAudioSource / dictAutoSpeak / dictVocabKinds / materialTypes）、
//       §4.16（siblingBury 矩阵）、§4.18（memory 结构）、§6.5（keybindings 归一化）、
//       §7.2（每次落库即落盘；日记防抖为唯一例外——设置不在例外内）、§7.6（读失败要记 code+context）。
"use strict";
const path = require("path");
const fs = require("fs");
const os = require("os");
const { app } = require("electron");
const { Flow, runFlow, tmpUserDataDir, freshDir, ROOT } = require("./lib/harness.cjs");
const { audit, quit, reopenFlowDb } = require("./lib/dbenv.cjs");

// D95（v48.51）：摘录卡四键的读侧归一矩阵装载**渲染层真模块**（src/lib/extractCardSettings.ts）——
// 与 tests/markdown-offset-map.test.cjs 同法，esbuild JS API 现场打包到临时目录（不留仓库文件）。
// 归一双侧：主进程写侧在 electron/main.js settings:set（逐键字面量），渲染层读侧在本模块；此处钉读侧真码，
// 写侧的落库效果由 GUI 套件（tests/extract-editor.gui.mjs 验收 10/11）经设置页真实路径覆盖。
const esbuild = require("esbuild");
const EXTNORM_OUT = path.join(os.tmpdir(), `extnorm-f18-${process.pid}.cjs`);
esbuild.buildSync({
  stdin: {
    contents: [
      'export { normalizeExtractEditorToolbar, normalizeExtractEditorToolbarFloat, normalizeExtractEditorToolbarTop, normalizeExtractFaceFontFollow, normalizeExtractFaceFontSize, normalizeExtractFaceFontFamily } from "./src/lib/extractCardSettings";',
      'export { normalizeSelectionBarStyle } from "./src/lib/selectionBarSettings";',
      'export { normalizeCardFaceExtras, DEFAULT_CARD_FACE_EXTRAS } from "./src/lib/cardFaceExtras";',
      'export { normalizeTagsEnabled } from "./src/lib/tagSettings";'
    ].join("\n"),
    resolveDir: ROOT,
    loader: "ts"
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: EXTNORM_OUT,
  logLevel: "silent"
});
const extNorm = require(EXTNORM_OUT);

const flow = new Flow({
  id: "F18",
  title: "设置项生效矩阵与孤儿设置",
  angle: "配置契约的双向对齐与损坏兜底",
  cites: ["§7.1.3", "§7.4", "§4.16", "§4.18", "§6.5", "§7.2", "§7.6"],
  tier: 2,
  gui: false,
});

/** 文档明确点名的设置项（写成「层.键」，与代码里的层对齐；出处见各行注释） */
const DOC_KEYS = [
  "app.backupDir", "app.autoBackupKeep", "app.dayCutoffHour", // §9.1 M2 / §6.5 / §4.4.5
  "app.dictAudioSource", "app.dictAutoSpeak", "app.dictVocabKinds", "app.materialTypes", // §7.4 v32 追记
  "app.fsrsConfigId", "app.keybindings", "app.memory", "app.mindmapMaxCalls", "app.readerSettings", // §4.4.10 / §6.5 / §4.18 / §4.19 / §6.1
  "app.shelfFolders", "app.shelfOrder", "app.siblingBury", "app.skinId", // §5.4 D51 / §4.16 / §5.3
  "app.shelfDensity", "app.shelfSort", "app.shelfView", // §7.4 v48.18 / D54（书架工具条状态记忆）
  "activity.dismissedRuns", // §4.2-3 / §4.19 收口块 ⑥（v48.17 / D53 指示器已关清单）
  "app.extracts", // §6.8-1 / §7.4（v48.22 / D58 摘录复习改版：mergeIntoReview / interleave / engine 三键）
  "app.limits", // §6.8-1 / §6.8-5（v48.22 / D58 四类每日上限 + ignoreReviewLimitForNew）
  "app.reviewScopes", // §6.8-5（v48.22 / D58 复习范围/筛选牌组；零 schema 变更）
  "app.annotateMode", "app.annotateForm", "app.annotatePalette", "app.annotateCustomEnabled", "app.annotationFilter", // 批 4 / §9.2（就地批注键；v48.42/D82 形式拆 annotateForm）
  "app.extractEditorToolbar", "app.extractEditorToolbarFloat", "app.extractEditorToolbarTop", "app.extractFaceFontFollow", "app.extractFaceFontSize", "app.extractFaceFontFamily", // §7.4 v48.54 / D95（摘录卡编辑器工具栏与形态 + 字号/字体桥；v48.55/§K 增钉顶键）
  "app.selectionBarStyle", // D122（选区浮条动作呈现 icon/text；取代 D95 §K.4 readerActionsFloat）
  "app.cardFaceExtras", // §7.4 v48.61 / D104（卡面信息密度三开关：背面辅助字段助记/例子/来源）
  "app.workbenchPlacement", "app.closeToTray", // §7.4 v48.79 / D123（制卡台放置位置 / 关闭收进托盘）
  "app.tagsEnabled", // §7.4 v48.63 / D107（标签功能总开关：默认开，仅严格 false 为关；隐藏入口不动数据）
  "dashboard.layout", "theme.mode", // §5.4 先例 / §5.3
];
/** 文档点了但明写未实现的键：这些必须**没有**消费者，出现即反向漂移 */
const DOC_UNIMPLEMENTED = ["frontierExploration", "growthFeedback", "lkmConfigId", "errorReportConsent"];
/** 文档明写已废除的键（§4.4.10 L173 / D22）：只允许出现在迁移代码里，渲染层必须零引用 */
const DOC_RETIRED = ["fsrsWeights"];

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f18"));
    app.setPath("userData", dir);
    const settingsFile = path.join(dir, "settings.json");
    const dbFile = path.join(dir, "library.db");

    const s = await runFlow(flow, async () => {
      const db = require(path.join(ROOT, "electron", "db.js"));
      await db.initDb();
      let st = require(path.join(ROOT, "electron", "settingsStore.js"));
      const reopenStore = () => {
        const p = path.join(ROOT, "electron", "settingsStore.js");
        delete require.cache[p];
        return require(p);
      };

      // 源码全量（用于消费者检索）
      const srcFiles = [];
      const walk = (d) => {
        for (const n of fs.readdirSync(d)) {
          if (["node_modules", "dist", "build", ".git", "vendor", "foliate"].includes(n)) continue;
          const full = path.join(d, n);
          const stat = fs.statSync(full);
          if (stat.isDirectory()) walk(full);
          else if (/\.(ts|tsx|js|cjs|mjs)$/.test(n)) srcFiles.push({ rel: path.relative(ROOT, full).replace(/\\/g, "/"), t: fs.readFileSync(full, "utf8") });
        }
      };
      walk(path.join(ROOT, "src"));
      walk(path.join(ROOT, "electron"));
      const linesOf = new Map(srcFiles.map((f) => [f.rel, f.t.split(/\r?\n/)]));
      const COMMENT = /^\s*(\/\/|\/\*|\*)/;
      // 常量名 → 字面量（代码里大量用 const KEY_ORDER = "shelfOrder" 再传进 settingsStore）
      const constToKey = new Map();
      for (const [, lines] of linesOf)
        for (const l of lines) {
          const decl = /\b([A-Za-z0-9_$]+)\s*(?::\s*string\s*)?=\s*["'`]([A-Za-z0-9_]+)["'`]/g;
          let m;
          while ((m = decl.exec(l))) {
            if (!constToKey.has(m[1])) constToKey.set(m[1], new Set());
            constToKey.get(m[1]).add(m[2]);
          }
        }
      const litOf = (n) => (constToKey.has(n) ? [...constToKey.get(n)][0] : null);

      // 代码侧的「层.键」全集（两种读法：渲染层 IPC 按层取键；主进程直接读 settings.app.X）
      const codeKeys = new Map();
      const addKey = (scope, key, rel, n, comment) => {
        if (!scope || !key || !/^[A-Za-z][A-Za-z0-9_]{2,}$/.test(key)) return;
        const id = `${scope}.${key}`;
        if (!codeKeys.has(id)) codeKeys.set(id, []);
        if (codeKeys.get(id).length < 4) codeKeys.get(id).push({ rel, n, comment });
      };
      for (const [rel, lines] of linesOf) {
        lines.forEach((l, i) => {
          const comment = COMMENT.test(l);
          let m;
          const reIpc = /settingsStore\s*[.[]\s*(?:get|set|delete|read|write)[^;]*?\(\s*(?:"([A-Za-z_.]+)"|([A-Za-z0-9_$]+))\s*,\s*(?:"([A-Za-z0-9_]+)"|([A-Za-z0-9_$]+))/g;
          while ((m = reIpc.exec(l))) addKey(m[1] ?? litOf(m[2]), m[3] ?? litOf(m[4]), rel, i + 1, comment);
          const reApp = /\.app\??\.([A-Za-z0-9_]+)/g;
          while ((m = reApp.exec(l))) if (/(settings|readSettings|\bs0\b|\bst\b)/.test(l)) addKey("app", m[1], rel, i + 1, comment);
        });
      }

      // 某个键在代码里的全部引用：直接属性式 + 经上面抽出的「层.键」
      const hitsOf = (key) => {
        const re = new RegExp(`[.'"\\s{(,\\[]${key}(?![A-Za-z0-9_])`);
        const CTX = /(settings|readSettings|settingsStore|\.app\b|app\?\.|\.theme\b|SETTINGS_SCOPE)/i;
        const direct = [];
        for (const [rel, lines] of linesOf)
          lines.forEach((l, i) => { if (re.test(l) && CTX.test(l)) direct.push({ rel, n: i + 1, comment: COMMENT.test(l) }); });
        const viaStore = [];
        for (const [id, hits] of codeKeys) if (id.split(".")[1] === key) viaStore.push(...hits);
        return direct.concat(viaStore);
      };
      const consumersOf = (key) => hitsOf(key).map((h) => `${h.rel}:${h.n}`);
      // 迁移专用引用：命中行上下 6 行内必须写明「迁移」或真的 delete 掉该键
      const isMigrationHit = (h) => {
        const lines = linesOf.get(h.rel) || [];
        const from = Math.max(0, h.n - 1 - 6);
        const to = Math.min(lines.length, h.n + 6);
        for (let i = from; i < to; i++) if (/迁移|migrat|delete\s+[^\n]*\./i.test(lines[i])) return true;
        return false;
      };
      const guideLines = fs.readFileSync(path.join(ROOT, "AI_DEVELOPMENT_GUIDE.md"), "utf8").split(/\r?\n/);
      const guideText = guideLines.join("\n");

      // ---------- Y1 文档键 ↔ 代码消费者 ----------
      flow.section("Y1 文档点名的设置键必须都有消费者（双向对齐，孤儿检测）");
      const docMiss = [];
      const docScopeMismatch = [];
      for (const id of DOC_KEYS) {
        const k = id.split(".")[1];
        if (codeKeys.has(id)) continue;
        const otherScopes = [...codeKeys.keys()].filter((x) => x.split(".")[1] === k);
        if (otherScopes.length) docScopeMismatch.push(`${id} 实际在读：${otherScopes.join(" ")}`);
        else if (!hitsOf(k).length) docMiss.push(id);
      }
      flow.record("文档点名的设置项", `${DOC_KEYS.length} 项，孤儿 ${docMiss.length}、错层 ${docScopeMismatch.length}`);
      flow.check("文档点名的设置项都能在代码里找到读取方", docMiss.length === 0, "无孤儿项", docMiss);
      flow.check("文档点名的层必须与代码实际读的层一致（settings.json 的段名写错＝读不到）", docScopeMismatch.length === 0, "层一致", docScopeMismatch);
      const ghostImpl = DOC_UNIMPLEMENTED.map((k) => [k, consumersOf(k)]).filter(([, cs]) => cs.length > 0).map(([k, cs]) => `${k}←${cs[0]}`);
      flow.check("文档标未实现的键不得已有消费者（半成品不得先落地）", ghostImpl.length === 0, "无痕迹", ghostImpl);

      // 退役键：渲染层零活引用 + 主进程只允许迁移代码；注释里的残留另计（描述漂移）
      const retiredLeaks = [];
      const retiredComments = [];
      const retiredShape = [];
      for (const k of DOC_RETIRED) {
        const hits = hitsOf(k);
        const live = hits.filter((h) => !h.comment);
        const inRenderer = live.filter((h) => h.rel.startsWith("src/"));
        const stray = live.filter((h) => !h.rel.startsWith("src/") && !isMigrationHit(h));
        retiredShape.push(`${k}: ${hits.length} 处（活引用 ${live.length}／注释 ${hits.length - live.length}）`);
        retiredLeaks.push(...[...new Set([...inRenderer, ...stray].map((h) => `${h.rel}:${h.n}`))]);
        // 批次 F（D-DOC-07 收口时对齐判据）：注释侧要用本流程自己的 `isMigrationHit`（命中行上下 6 行内写明
        // 「迁移」或真的 delete 掉该键）作豁免——`db.js` 的 initDb 一次性迁移注释正是本条允许的形态。
        // 原写法把**所有**含该键的注释都算进去，等于要求代码里不许出现这个字段名，与 D-DOC-07 的登记文字不符。
        retiredComments.push(...[...new Set(hits.filter((h) => h.comment && !isMigrationHit(h))
          .map((h) => `${h.rel}:${h.n}`))]);
      }
      flow.record("退役键的引用形态", retiredShape.join("；"));
      flow.check("已废除的键不得有活的消费者（渲染层零引用，主进程仅限迁移代码）", retiredLeaks.length === 0, "只在迁移块里出现", retiredLeaks);
      flow.check("代码注释不得把已废除的键描述成现行读取路径", retiredComments.length === 0, "注释同步收口", retiredComments);

      // 文档自洽：§4.4.10/D22 说废除，就别在别处（§7.4 配置清单）把它当现行键列
      const advertisedLive = [];
      for (const k of DOC_RETIRED) {
        guideLines.forEach((line, i) => {
          if (!new RegExp(`\\.${k}\\b`).test(line)) return;
          if (/废除|迁移|双事实源|不再|改为|D22|D20/.test(line)) return;
          advertisedLive.push(`L${i + 1}:${k}`);
        });
      }
      flow.check("指导文档不得把已废除的键当现行配置项列出（文档自洽）", advertisedLive.length === 0, "只在废除/迁移语境出现", advertisedLive);

      // 反向：代码在读的键必须在文档里登记（§7.4 配置必须集中、可审）
      const undocumented = [...codeKeys.keys()].filter((id) => !new RegExp(`\\b${id.split(".")[1]}\\b`).test(guideText)).sort();
      flow.record("代码在读的层.键总数", `${codeKeys.size}（文档未登记 ${undocumented.length}）`);
      flow.check("代码在读的每个设置键都要在指导文档里登记", undocumented.length === 0, "全部登记", undocumented);

      // 反向：设置层本身也只有 §4.2-3 登记的那四层在用
      const scopes = [...new Set([...codeKeys.keys()].map((id) => id.split(".")[0]))].sort();
      // 批次 F（D-DOC-08 收口）：`dashboard` 层已按 §4.2-3 登记为第四个设置层（§7.4 的 v48.16/D52 条目），
      // 所以允许集合同步加上它——登记动作在文档侧完成，闸门合同步是登记的一部分，不是放宽判据。
      // v48.18 / D54：`activity` 层（指示器已关清单）按 §4.2-3 登记为第五个设置层，允许集合同步。
      const DOCUMENTED_SCOPES = /^app$|^theme$|^plugin\.|^dashboard$|^activity$/;
      const rogueScopes = scopes.filter((s) => !DOCUMENTED_SCOPES.test(s));
      flow.record("代码用到的设置层", scopes.join(" "));
      flow.check("设置层必须限于 §4.2-3 登记的 app / theme / plugin.<id> / dashboard", rogueScopes.length === 0, "四层之内", rogueScopes);
      flow.record("文档键总数 / 未实现 / 退役", `${DOC_KEYS.length} + ${DOC_UNIMPLEMENTED.length} + ${DOC_RETIRED.length}`);

      // ---------- Y2 按真实层写入-读回-重启往返 ----------
      flow.section("Y2 逐个「层.键」写入 → 读回 → 重新加载模块（模拟重启）后一致（§7.1.4）");
      const cases = [
        ["app", "backupDir", path.join(dir, "backups")],
        ["app", "autoBackupKeep", 7],
        ["app", "autoBackupEnabled", false],
        ["app", "dayCutoffHour", 4],
        ["app", "dictAudioSource", "tts"],
        ["app", "dictAutoSpeak", true],
        ["app", "dictMode", "local"],
        ["app", "dictPopupFields", { term: true, example: false, phonetic: true }],
        ["app", "dictVocabKinds", { en: ["cn2en", "en2cn"], ja: ["audio"] }],
        ["app", "materialTypes", { "doc-1": "formula" }],
        ["app", "shelfOrder", ["a", "b", "c"]],
        ["app", "shelfView", "table"],                    // v48.18 / D54 书架工具条状态记忆
        ["app", "shelfDensity", "lg"],
        ["app", "shelfSort", "title"],
        ["activity", "dismissedRuns", ["run-1", "run-2"]], // v48.17 / D53 指示器已关清单
        ["app", "shelfFolders", [{ id: "f1", name: "语言类", items: ["a"], created: "2026-09-22" }]],
        ["app", "keybindings", { capture: "Command+Control+Space", reviewGrade1: "1" }],
        ["app", "globalShortcuts", { quickCapture: { enabled: true, bindings: ["Command+Shift+K"] } }],
        ["app", "siblingBury", { enabled: true, newCards: false, reviewCards: true, perDay: 2, sourceTextLimit: 240 }],
        ["app", "multiSelectKey", "Alt"],                 // v48.23 / D61 多段选择的修饰键（非默认值，才验得出往返）
        ["app", "annotateMode", "extract"],               // 批 4 / §9.2 就地批注（非默认值；v48.42/D82 模式域回归）
        ["app", "annotateForm", "underline"],             // v48.41/D81 标记形式（highlight/underline）
        ["app", "annotatePalette", ["teal", "red", "#aabbcc"]],
        ["app", "annotateCustomEnabled", false],
        ["app", "annotationFilter", "highlight"],
        ["app", "extractEditorToolbar", false],           // v48.54 / D95 摘录卡编辑工具栏（非默认值，才验得出往返）
        ["app", "extractEditorToolbarFloat", true],       // v48.54 / D95 v1.4 工具栏形态（默认 false＝随文档流；true＝悬浮于选中文字）
        ["app", "extractEditorToolbarTop", true],         // v48.55 / D95 §K.2 dock 态钉顶（默认 false＝吸底；非默认值才验得出往返）
        ["app", "selectionBarStyle", "text"],             // D122 选区浮条动作呈现（默认 "icon"）
        ["app", "workbenchPlacement", "bottom"],          // D123 制卡台放置位置（默认 "right"）
        ["app", "closeToTray", false],                    // D123 关闭收进托盘（默认 true）
        ["app", "extractFaceFontFollow", false],          // v48.54 / D95 摘录卡字号跟随（默认 true）
        ["app", "extractFaceFontSize", 22],               // v48.54 / D95 独立字号（默认 17；文件层往返原值）
        ["app", "extractFaceFontFamily", " Georgia, serif "], // v48.54 / D95 独立字体（文件层往返字节一致；trim 归一在读写两侧）
        ["app", "memory", { enabled: false, injectBudget: 3000, minIntervalMinutes: 30, consolidateEvery: 20, lastCoveredAt: 1758500000000 }],
        ["app", "readerSettings", { fontSize: 19, lineHeight: 1.75, width: 720 }],
        ["app", "skinId", "none"],
        ["app", "extracts", { mergeIntoReview: false, interleave: "quota-1-4", engine: "sm19-default" }], // v48.22 / D58
        ["app", "limits", { newCardsPerDay: 20, cardReviewsPerDay: 200, newExtractsPerDay: 10, extractReviewsPerDay: 50, ignoreReviewLimitForNew: false }], // v48.22 / D58
        ["app", "reviewScopes", [{ id: "scope-1", name: "测试范围", bookItemIds: ["item-1"], tags: ["考研::英语", "错题"], kpIds: ["kp-1"], kinds: ["card", "extract"], limits: { extractReviewsPerDay: 5 } }]], // v48.22 / D58；v48.61 / D105 扩展 tags/kpIds
        ["app", "cardFaceExtras", { mnemonic: true, example: false, sourceRef: true }], // v48.61 / D104 卡面信息密度（非默认值才验得出往返）
        ["app", "tagsEnabled", false], // v48.63 / D107 标签功能总开关（非默认值才验得出往返）
        ["app", "learner", { enabled: true, nativeLangs: ["zh", "en"], nativeConfirmed: true, recCount: 8 }], // v48.80 / D124 学习者知识模型（对象键，设计稿 §11.6）
        ["app", "accentColor", "#0057ff"],
        ["app", "mindmapMaxCalls", 40],
        ["app", "mindmapPricing", { input: 1.5, output: 6 }],
        ["app", "mindmapConcurrency", 3],
        ["app", "mindmapRetryMax", 2],
        ["app", "mindmapSectionChunkChars", 6000],
        ["app", "fsrsConfigId", "cfg-default"],
        ["theme", "mode", "dark"],
        ["dashboard", "layout", [{ id: "card-1", x: 0, y: 0, w: 4, h: 3 }]],
        ["dashboard", "hiddenWidgets", ["progress"]],
        ["dashboard", "configs", { progress: { compact: true } }],
      ];
      for (const [sc, k, v] of cases) {
        const o = st.readSettings();
        o[sc] = { ...(o[sc] || {}), [k]: v };
        st.writeSettings(o);
      }
      st = reopenStore();
      const back = st.readSettings();
      const mismatch = cases.filter(([sc, k, v]) => JSON.stringify(back[sc]?.[k]) !== JSON.stringify(v)).map(([sc, k]) => `${sc}.${k}`);
      flow.check("全部「层.键」重启后逐字节等值", mismatch.length === 0, "全部一致", mismatch);
      flow.record("往返项数", `${cases.length} 项 / ${new Set(cases.map((c) => c[0])).size} 层`);
      // 覆盖闸门：代码里真实在读的键必须全部进往返用例（退役键除外）
      const liveIds = [...codeKeys.keys()].filter((id) => (codeKeys.get(id) || []).some((h) => !h.comment) && !DOC_RETIRED.includes(id.split(".")[1]));
      const uncovered = liveIds.filter((id) => !cases.some(([sc, k]) => `${sc}.${k}` === id)).sort();
      flow.check("往返用例覆盖代码在读的全部「层.键」（新增键必须补测）", uncovered.length === 0, "全覆盖", uncovered);
      // 三层互不覆盖
      const iso = (() => {
        const o = st.readSettings();
        o.theme.mode = "light";
        st.writeSettings(o);
        const p = st.readSettings();
        p.dashboard.hiddenWidgets = ["stats"];
        st.writeSettings(p);
        const q = st.readSettings();
        return q.theme.mode === "light" && JSON.stringify(q.dashboard.hiddenWidgets) === JSON.stringify(["stats"]) && q.app.dayCutoffHour === 4 && JSON.stringify(q.app.shelfOrder) === JSON.stringify(["a", "b", "c"]);
      })();
      flow.check("app / theme / dashboard 三层互不覆盖", iso, "三层各自独立", "写一层动了他层");
      const o6 = st.readSettings();
      o6.app.dayCutoffHour = 6;
      st.writeSettings(o6);

      // ---------- Y3 损坏 settings.json 兜底 ----------
      flow.section("Y3 损坏配置文件必须回退默认且不炸（§7.6 要求读失败要留痕）");
      const broken = ["", "{", "[]", "null", "0", "true", '"设置"', "﻿{}", "undefined", '{"app": ', '{"app":"不是对象"}'];
      const goodBackup = fs.readFileSync(settingsFile, "utf8");
      const nonObj = new Set(["null", "0", "true", '"设置"']); // 合法 JSON、但不是对象：走的是另一条兜底分支
      const unsafeOther = [];
      const unsafeNonObj = [];
      for (const b of broken) {
        fs.writeFileSync(settingsFile, b, "utf8");
        let note = null;
        try {
          const got = st.readSettings();
          if (got === null || typeof got !== "object") note = `读到 ${got === null ? "null" : typeof got}`;
          const q = db.getStatsOverview();
          if (!q || !q.kpi) note = `${note ?? ""} 统计缺 kpi`;
        } catch (e) {
          note = `${note ?? ""} 消费方抛错(${String((e && e.message) || e).slice(0, 28)})`;
        }
        if (note) (nonObj.has(b) ? unsafeNonObj : unsafeOther).push(`${b.slice(0, 10)} →${note}`);
      }
      flow.check("损坏配置（语法坏/类型不对的 JSON）一律安全回退且消费方不崩", unsafeOther.length === 0, "全部安全", unsafeOther);
      flow.check("合法 JSON 但非对象（null/0/true/字符串）也必须回退为默认对象", unsafeNonObj.length === 0, "全部安全", unsafeNonObj);
      fs.writeFileSync(settingsFile, goodBackup);
      st = reopenStore();
      flow.eq("恢复文件后读取正常", st.readSettings().app.dayCutoffHour, 6);

      // ---------- Y3b 三个读设置入口在 settings 非对象时必须可用（批次 A / D-TEST-09） ----------
      // 规格 §B 的探针实测：settings.json = null 时崩点是「首个读设置的口子」——
      // getActiveFsrsConfig(db.js:728) / getStatsOverview→getCutoffHour(:2035) / computeTodayQueue→siblingBuryConfig(:1189)。
      // 这里把它固化成流程，防的是"只修了门面、没修消费方"。
      flow.section("Y3b settings 非对象时三个读设置入口都不抛（把批次 A 的探针固化成流程）");
      const goodBackup3b = fs.readFileSync(settingsFile, "utf8");
      const entryErr = [];
      for (const b of ["null", "0", "true", '"设置"', "[]", "[1,2,", ""]) {
        fs.writeFileSync(settingsFile, b, "utf8");
        for (const fn of ["getActiveFsrsConfig", "getStatsOverview", "computeTodayQueue"]) {
          try {
            if (typeof db[fn] !== "function") entryErr.push(`${b}/${fn}: db 未导出该函数`);
            else if (db[fn]() === undefined) entryErr.push(`${b}/${fn}: 返回 undefined`);
          } catch (e) {
            entryErr.push(`${b}/${fn}: ${String((e && e.message) || e).slice(0, 40)}`);
          }
        }
      }
      fs.writeFileSync(settingsFile, goodBackup3b, "utf8");
      flow.check("settings.json 为 null/0/true/字符串/数组/语法坏时，三个读设置入口全部可用", entryErr.length === 0, "全部不抛", entryErr);

      // ---------- Y4 非法值回落（真实消费路径） ----------
      flow.section("Y4 非法值经真实消费路径必须回落（§4.16 矩阵 / §4.18 默认关 / §6.5 归一化）");
      const write = (patch) => { const o = st.readSettings(); o.app = { ...(o.app || {}), ...patch }; st.writeSettings(o); };
      const bad = [
        { dayCutoffHour: "中午" }, { dayCutoffHour: 99 }, { dayCutoffHour: null },
        { siblingBury: { perDay: "很多", newCards: "开" } },
        { siblingBury: [] }, { memory: { injectBudget: -1 } }, { memory: "不是对象" },
        { materialTypes: null }, { shelfOrder: "abc" }, { dictVocabKinds: { en: "qa" } },
        { dictMode: "随便" }, { autoBackupEnabled: "yes" }, { autoBackupKeep: -3 },
        { mindmapConcurrency: 0 }, { mindmapConcurrency: "很多" }, { mindmapRetryMax: -1 },
        { mindmapSectionChunkChars: 0 }, { mindmapPricing: "免费" }, { globalShortcuts: null },
        { accentColor: "不色" }, { skinId: 42 },
        // 批 4 / §9.2：就地批注四键——枚举越界、色板非数组/含非法项，都必须不致崩
        { annotateMode: "乱写" }, { annotateMode: 7 }, { annotationFilter: [] },
        { annotateCustomEnabled: "yes" }, { annotatePalette: "不是数组" },
        { annotatePalette: ["bogus", "red", "red", "#aabbcc", 42] },
      ];
      for (const b of bad) {
        let err = null;
        try {
          write(b);
          db.computeTodayQueue();
          db.getStatsOverview();
          db.listDueExtracts();
        } catch (e) {
          err = String((e && e.message) || e);
        }
        flow.check(`非法 ${Object.keys(b)[0]} 不致崩`, err === null, "不抛", err);
      }
      write({ dayCutoffHour: 0, siblingBury: null, memory: null, materialTypes: null, shelfOrder: null, dictVocabKinds: null, dictMode: null, autoBackupEnabled: null, autoBackupKeep: null, mindmapConcurrency: null, mindmapRetryMax: null, mindmapSectionChunkChars: null, mindmapPricing: null, globalShortcuts: null, accentColor: null, skinId: null, annotateMode: null, annotatePalette: null, annotateCustomEnabled: null, annotationFilter: null });
      // 批 4：四键读侧归一——非法值必须回落默认，且合法值必须原样保留（非空转对照）
      write({ annotateMode: "乱写", annotationFilter: "乱写", annotateCustomEnabled: "yes", annotatePalette: ["bogus", "red", "red", "#aabbcc", 42] });
      const normBad = db.readAnnotationSettings();
      flow.eq("非法 annotateMode 回落默认", normBad.annotateMode, "highlight");
      flow.eq("非法 annotationFilter 回落默认", normBad.annotationFilter, "all");
      flow.eq("非法 annotateCustomEnabled 归一为 false（仅 true 为真）", normBad.annotateCustomEnabled, false);
      flow.eq("色板净化：剔非法、去重、留 #hex", JSON.stringify(normBad.annotatePalette), JSON.stringify(["red", "#aabbcc"]));
      write({ annotateMode: "extract", annotateForm: "underline", annotationFilter: "highlight", annotateCustomEnabled: true, annotatePalette: ["teal", "red"] });
      const normOk = db.readAnnotationSettings();
      // 逐字段比对（JSON.stringify 受键序影响，与 readAnnotationSettings 的返回序未必一致）
      flow.eq("合法值原样保留：annotateMode（对照，防空转）", normOk.annotateMode, "extract");
      flow.eq("合法值原样保留：annotateForm（v48.42/D82）", normOk.annotateForm, "underline");
      flow.eq("合法值原样保留：annotationFilter", normOk.annotationFilter, "highlight");
      flow.eq("合法值原样保留：annotateCustomEnabled", normOk.annotateCustomEnabled, true);
      flow.eq("合法值原样保留：annotatePalette", JSON.stringify(normOk.annotatePalette), JSON.stringify(["teal", "red"]));
      // 色板空 ⇒ 回落默认 6 支（不是空数组——调色排不该空着）
      write({ annotatePalette: [] });
      flow.eq("色板空回落默认 5 支", db.readAnnotationSettings().annotatePalette.length, 5);

      // ---------- Y4b D95 摘录卡五键：非法值经渲染层读侧真模块必须回落（§7.4 v48.51 / 设计稿 §F.2 + v1.4） ----------
      flow.section("Y4b 摘录卡编辑器/字号五键归一（渲染层读侧真模块 src/lib/extractCardSettings.ts）");
      const normToolbar = extNorm.normalizeExtractEditorToolbar;
      const normToolbarFloat = extNorm.normalizeExtractEditorToolbarFloat;
      const normToolbarTop = extNorm.normalizeExtractEditorToolbarTop;
      const normBarStyle = extNorm.normalizeSelectionBarStyle;
      const normFollow = extNorm.normalizeExtractFaceFontFollow;
      const normSize = extNorm.normalizeExtractFaceFontSize;
      const normFamily = extNorm.normalizeExtractFaceFontFamily;
      // 归一语义（§F.2 + v1.4）：仅严格 true；字号 round 后落 10–40 否则回落 17；字体 trim 字符串
      flow.eq("extractEditorToolbar：仅严格 true 为真（true/'true'/1/false/null/undefined）",
        JSON.stringify([true, "true", 1, false, null, undefined].map(normToolbar)),
        JSON.stringify([true, false, false, false, false, false]));
      flow.eq("extractEditorToolbarFloat：仅严格 true 为真（true/1/'x'/false/undefined）",
        JSON.stringify([true, 1, "x", false, undefined].map(normToolbarFloat)),
        JSON.stringify([true, false, false, false, false]));
      flow.eq("extractEditorToolbarTop：仅严格 true 为真（true/1/'x'/false/undefined）",
        JSON.stringify([true, 1, "x", false, undefined].map(normToolbarTop)),
        JSON.stringify([true, false, false, false, false]));
      flow.eq("selectionBarStyle：仅严格 'text' 为 text，其余回落 icon（D122）",
        JSON.stringify(["text", "icon", "TEXT", 1, null, undefined].map(normBarStyle)),
        JSON.stringify(["text", "icon", "icon", "icon", "icon", "icon"]));
      flow.eq("extractFaceFontFollow：仅严格 true 为真（true/'yes'/1/null）",
        JSON.stringify([true, "yes", 1, null].map(normFollow)),
        JSON.stringify([true, false, false, false]));
      flow.eq("extractFaceFontSize：round 钳位（22.4→22、21.5→22）", JSON.stringify([normSize(22.4), normSize(21.5)]), JSON.stringify([22, 22]));
      flow.eq("extractFaceFontSize：合法边界原样保留（10/40）", JSON.stringify([normSize(10), normSize(40)]), JSON.stringify([10, 40]));
      flow.eq("extractFaceFontSize：越界/非法一律回落 17（9/41/99.6/'abc'/null/undefined/-3）",
        JSON.stringify([9, 41, 99.6, "abc", null, undefined, -3].map(normSize)),
        JSON.stringify([17, 17, 17, 17, 17, 17, 17]));
      flow.eq("extractFaceFontFamily：trim（两端空白去除）", normFamily("  Georgia, serif  "), "Georgia, serif");
      flow.eq("extractFaceFontFamily：非字符串回落空串（42/null）", JSON.stringify([normFamily(42), normFamily(null)]), JSON.stringify(["", ""]));
      flow.eq("合法值原样保留（toolbar/follow/size/family，非空转对照）",
        JSON.stringify([normToolbar(true), normFollow(true), normSize(25), normFamily("Noto Serif SC")]),
        JSON.stringify([true, true, 25, "Noto Serif SC"]));

      // ---------- Y4c D104 卡面信息密度键：读侧真模块归一（src/lib/cardFaceExtras.ts） ----------
      flow.section("Y4c 卡面信息密度三开关归一（渲染层读侧真模块 src/lib/cardFaceExtras.ts）");
      const normExtras = extNorm.normalizeCardFaceExtras;
      flow.eq("cardFaceExtras：逐键仅严格 false 为关（mnemonic:false 生效）",
        JSON.stringify(normExtras({ mnemonic: false, example: "no", sourceRef: 0 })),
        JSON.stringify({ mnemonic: false, example: true, sourceRef: true }));
      flow.eq("cardFaceExtras：对象缺键回落 true（默认全开）",
        JSON.stringify(normExtras({ example: false })), JSON.stringify({ mnemonic: true, example: false, sourceRef: true }));
      flow.eq("cardFaceExtras：非对象整体回落默认（null/数组/'x'/42/undefined）",
        JSON.stringify([null, [], "x", 42, undefined].map(normExtras)),
        JSON.stringify(Array(5).fill({ mnemonic: true, example: true, sourceRef: true })));
      flow.eq("cardFaceExtras：默认常量全开", JSON.stringify(extNorm.DEFAULT_CARD_FACE_EXTRAS), JSON.stringify({ mnemonic: true, example: true, sourceRef: true }));
      flow.eq("tagsEnabled：仅严格 false 为关（true/'false'/0/null/undefined）",
        JSON.stringify([true, "false", 0, null, undefined].map(extNorm.normalizeTagsEnabled)),
        JSON.stringify([true, true, true, true, true]));
      flow.eq("tagsEnabled：false 为关", extNorm.normalizeTagsEnabled(false), false);

      const mem = require(path.join(ROOT, "electron", "memoryTidy.js"));
      flow.eq("清空后记忆总开关回到默认关", mem.readMemoryConfig({ readSettings: () => st.readSettings() }).enabled, false);
      flow.eq("清空后同源延后回到默认开", db.computeTodayQueue() && (st.readSettings().app?.siblingBury?.enabled !== false), true);

      // ---------- Y5 特殊字符与体积 ----------
      flow.section("Y5 设置值里的 Unicode 与大对象（往返字节一致）");
      const weirdVal = "含 emoji 🎯 RTL ‮היום‬ 零宽 ​ 与 \r\n 换行、引号\"和反斜杠\\";
      write({ materialTypes: { "键带 空格 与 emoji🎯": weirdVal } });
      st = reopenStore();
      flow.eq("深层字符串字节一致", st.readSettings().app.materialTypes["键带 空格 与 emoji🎯"], weirdVal);
      const huge = { shelfOrder: Array.from({ length: 5000 }, (_, i) => `item-${i}-${"填充".repeat(20)}`) };
      write(huge);
      const sizeKb = Math.round(fs.statSync(settingsFile).size / 1024);
      st = reopenStore();
      flow.check("超大设置仍能完整读回（且体积可观测）", st.readSettings().app.shelfOrder.length === 5000 && sizeKb > 100, "5000 项", { len: st.readSettings().app.shelfOrder?.length, sizeKb });
      flow.record("settings.json 体积", `${sizeKb} KB`);

      // ---------- Y6 与备份/统计的联动 ----------
      flow.section("Y6 设置参与备份清单，且日切点改动不改历史（引用 F05/F12 的口径）");
      db.persistNow();
      const entries = (await audit(dbFile)).tables();
      flow.check("设置不在主库任何表里（它是文件真源）", entries.includes("settings"), false);
      write({ dayCutoffHour: 23 });
      const before6 = (await audit(dbFile)).all("review_logs").map((r) => r.reviewed_at).join(",");
      write({ dayCutoffHour: 0 });
      flow.eq("改日切点不动复习日志时间戳", (await audit(dbFile)).all("review_logs").map((r) => r.reviewed_at).join(","), before6);

      // ---------- Y7 冷启动：损坏设置绝不能把应用挡在门外 ----------
      flow.section("Y7 损坏设置的冷启动路径（清缓存重 require db.js + initDb，§7.1.4 验收线）");
      const volumeOf = async () => {
        const a = await audit(dbFile);
        const n = a.tables().reduce((s2, t) => s2 + a.count(t), 0);
        a.close();
        return n;
      };
      // 先造一点真实数据，否则「不改写磁盘」这条会在空库上自证
      db.createFromPaste("F18 冷启动种子书", "# 章节\n\n设置流程用文本。");
      for (let i = 0; i < 3; i++) {
        db.createCard({ noteText: `F18 卡 ${i}`, cardType: "qa", frontMarkdown: `F18 问 ${i}`, backMarkdown: `F18 答 ${i}`, priority: 50, tags: ["f18"] });
      }
      db.createJournalEntry({ contentMarkdown: "F18 日记", source: "app" });
      db.persistNow();
      const volBefore = await volumeOf();
      flow.check("冷启动探测前磁盘上确实有数据", volBefore > 0, ">0 行", volBefore);
      const bootNonObj = [];
      const bootOther = [];
      for (const b of broken) {
        fs.writeFileSync(settingsFile, b, "utf8");
        delete require.cache[path.join(ROOT, "electron", "settingsStore.js")];
        let note = null;
        try {
          const fresh = await reopenFlowDb(dir);
          const q = fresh.getStatsOverview();
          if (!q || !q.kpi) note = "统计不可用";
        } catch (e) {
          note = `initDb/首屏崩：${String((e && e.message) || e).slice(0, 46)}`;
        }
        if (note) (nonObj.has(b) ? bootNonObj : bootOther).push(`${b.slice(0, 10)} → ${note}`);
      }
      flow.record("冷启动逐档结果", `${broken.length - bootNonObj.length - bootOther.length}/${broken.length} 档能起来`);
      fs.writeFileSync(settingsFile, goodBackup);
      delete require.cache[path.join(ROOT, "electron", "settingsStore.js")];
      flow.check("非对象设置（null/0/true/字符串）下应用必须仍能启动", bootNonObj.length === 0, "仍可启动", bootNonObj);
      flow.check("语法损坏设置下应用必须仍能启动", bootOther.length === 0, "仍可启动", bootOther);
      flow.eq("冷启动探测不改写磁盘数据（全库行数守恒）", await volumeOf(), volBefore);
    });

    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F18 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String((e && e.message) || e) });
    process.exit(1);
  });
