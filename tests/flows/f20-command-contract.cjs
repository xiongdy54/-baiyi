// F20 键盘命令契约（换角度：把「按下去会发生什么」当成数据契约来对表）
// @runtime: electron  @tier: 2  @gui: false  @id: F20  @timeout: 240
// 运行：npx electron tests/flows/f20-command-contract.cjs   （或 node tests/flows/run.cjs --only F20）
//
// 角度：本项目是键盘驱动的（复习四键评分、阅读四键制卡、两个全局快捷键）。
//       键位同时活在四个地方——§9.1 M4 的「用户锁定表」、代码里的 COMMANDS、
//       settings.app.keybindings 的覆盖项、以及主进程 globalShortcut 的另一份默认值。
//       四处任何一处漂移，界面上看不出来，只有手指知道。这条用 esbuild 把 commands.ts
//       原样打进主进程，直接驱动它的纯逻辑分发（__testHooks.dispatchKey），
//       再把文档表、默认表、归一化函数、冲突检测、抑制栈逐条对表。
//
// 依据：§9.1 M4（命令表与默认键位锁定）、§4.2-2 L127（CommandRegistry 接口形状）、
//       §5/§6.5（可达性与键位展示）、§7.1.3（边界输入不得穿透）、§6.1（主旅程靠键盘推进）、
//       commands.ts:8 与 §9.1 M4 双双承诺的「输入焦点内绝不劫持」。
"use strict";
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { Flow, runFlow, tmpUserDataDir, freshDir, ROOT } = require("./lib/harness.cjs");
const { quit } = require("./lib/dbenv.cjs");

const flow = new Flow({
  id: "F20",
  title: "键盘命令契约",
  angle: "文档锁定表 ↔ COMMANDS ↔ 覆盖项 ↔ 主进程默认值 四处对表",
  cites: ["§9.1 M4", "§4.2-2", "§6.5", "§7.1.3", "§6.1"],
  tier: 2,
  gui: false,
});

/** 把 TS 模块打成 CJS 并在本进程实例化（不改动被测代码） */
function loadTs(rel, outName) {
  const esbuild = require("esbuild");
  const out = path.join(ROOT, "tests", "tmp-f20", outName);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  esbuild.buildSync({
    entryPoints: [path.join(ROOT, rel)],
    bundle: true,
    write: true,
    outfile: out,
    format: "cjs",
    platform: "neutral",
    target: "es2020",
    logLevel: "silent",
  });
  delete require.cache[out];
  return require(out);
}

app
  .whenReady()
  .then(async () => {
    const dir = freshDir(tmpUserDataDir("f20"));
    app.setPath("userData", dir);

    const s = await runFlow(flow, async () => {
      const { commandRegistry, COMMANDS, eventToCombo, __testHooks } = loadTs(path.join("src", "lib", "commands.ts"), "commands.cjs");
      const qc = require(path.join(ROOT, "electron", "quickCapture.js"));
      const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
      const cmdSrc = read(path.join("src", "lib", "commands.ts"));
      const panelSrc = read(path.join("src", "components", "SettingsPanel.tsx"));
      const guide = read("AI_DEVELOPMENT_GUIDE.md");

      // ---------- W1 COMMANDS ↔ 文档锁定表 ----------
      flow.section("W1 命令表与文档「默认键位（用户锁定）」逐条对表（§9.1 M4）");
      flow.eq("命令条数（阅读 5 + 复习 9）", COMMANDS.length, 14);
      const scenes = COMMANDS.reduce((a, c) => ((a[c.scene] = (a[c.scene] || 0) + 1), a), {});
      flow.record("场景分组", Object.entries(scenes).map(([k, v]) => `${k} ${v}`).join(" / "));
      const ids = COMMANDS.map((c) => c.id);
      flow.check("id 命名一律 scene.camelCase 且无重复", new Set(ids).size === ids.length && ids.every((i) => /^(reader|review)\.[a-zA-Z]+$/.test(i)), "全部合规", ids.filter((i) => !/^(reader|review)\.[a-zA-Z]+$/.test(i)));
      const tableStart = guide.indexOf("默认键位（用户锁定）");
      const table = tableStart < 0 ? "" : guide.slice(tableStart, guide.indexOf("\n## ", tableStart) > 0 ? guide.indexOf("\n## ", tableStart) : tableStart + 2400);
      const tableLines = (() => {
        const from = guide.slice(tableStart).split(/\r?\n/);
        const out = [];
        let started = false;
        for (const l of from) {
          if (/^\s*\|/.test(l)) { started = true; out.push(l); continue; }
          if (started) break;
        }
        return out.join("\n");
      })();
      const docKeys = [];
      for (const line of tableLines.split(/\r?\n/)) {
        if (!/^\s*\|/.test(line) || /^\|\s*-+/.test(line) || /场景/.test(line)) continue;
        const cells = line.split("|").map((x) => x.trim()).filter(Boolean);
        if (cells.length < 3) continue;
        const keyCell = cells[cells.length - 1].split("（")[0];
        for (const part of keyCell.split("/")) {
          const t = part.trim();
          if (!t) continue;
          docKeys.push(t === "空格" ? "Space" : t.length === 1 ? t.toUpperCase() : t);
        }
      }
      const codeKeys = COMMANDS.map((c) => c.defaultKey);
      const codeNotInDoc = codeKeys.filter((k) => !docKeys.includes(k));
      flow.record("文档表里的键位串", docKeys.join(" ") || "（没抓到表）");
      flow.check("代码里每个默认键都必须在文档锁定表里出现（改了键位要同步文档）", codeNotInDoc.length === 0, "全部在册", codeNotInDoc);
      const docSays12 = /12\s*条/.test(table) || /12\s*条/.test(guide);
      flow.check("文档不得声明一个与代码不符的命令条数", !docSays12, "条数已同步", docSays12 ? "文档仍写「命令表 12 条」，代码 COMMANDS 实为 14 条" : "（已同步）");
        // 批次 F（D-DOC-09 收口时对齐判据）：原式 `!/keybinding/.test(guide)` 扫全文，会命中真实存在的设置键
  // `settings.app.keybindings`（D-DOC-08 还要求它必须在文档里登记），两条闸门互斥、任何诚实文档都拿不到绿。
  // 本条登记的现象是「§4.2-2 把 CommandDef 的字段写成 {id,title,when,键位}」，判据收窄到那一行：
  // 该行不得再把 when / 键位当 CommandDef 的字段（代码实为 scene/defaultKey，when 随动作给出）。
  const shapeLine = (guide.split(/\r?\n/).find((l) => /^\s*2\.\s+`CommandRegistry`/.test(l)) || "");
  const shapeBad = /when/.test(shapeLine) && /keybinding/i.test(shapeLine);
  flow.check("文档声明的接口形状要与代码一致（§4.2-2 写 {id,title,when,keybinding}）", !shapeBad, "形状一致", shapeLine.slice(0, 130) || "没抓到 §4.2-2 第 2 项");

      // ---------- W2 组合键归一化 ----------
      flow.section("W2 eventToCombo 归一化矩阵（存储串 = 展示串 = 匹配串，§9.1 M4）");
      const combos = [
        [{ key: " " }, "Space"],
        [{ key: "a", ctrlKey: true }, "Ctrl+A"],
        [{ key: "A", ctrlKey: true }, "Ctrl+A"],
        [{ key: "z", ctrlKey: true, shiftKey: true }, "Ctrl+Shift+Z"],
        [{ key: "Tab", metaKey: true, ctrlKey: true, altKey: true, shiftKey: true }, "Ctrl+Alt+Shift+Meta+Tab"],
        [{ key: "Control" }, null],
        [{ key: "Shift" }, null],
        [{ key: "Process" }, null],
        [{ key: "Dead" }, null],
        [{ key: "Unidentified" }, null],
        [{ key: "1" }, "1"],
        [{ key: "d" }, "D"],
        [{ key: "F5" }, "F5"],
        [{ key: "Enter" }, "Enter"],
        [{ key: "←" }, "←"],
        [{ key: "é" }, "É"],
        [{ key: "中" }, "中"],
      ];
      const comboBad = [];
      for (const [ev, want] of combos) {
        const got = eventToCombo({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...ev });
        if (got !== want) comboBad.push(`${JSON.stringify(ev)} → ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
      }
      flow.check("归一化结果与 §9.1 M4 约定逐档一致", comboBad.length === 0, "全部一致", comboBad);
      const emptyKey = eventToCombo({ key: "", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false });
      flow.check("空 key 不得生成残缺组合串（现在产出 \"Ctrl+\"，存进设置后既匹配不上也清不掉）", emptyKey !== "Ctrl+", "返回 null", emptyKey);
      // 批次 D（D-TEST-14）新增：所有「无实体键」的入参形态都必须产出 null——null 是 setOverride
      // 唯一的拒绝点（SettingsPanel:1229 的 `if (!combo) return;`），所以 null 之外没有任何串
      // 能进 settings.app.keybindings 占位。
      const emptyShapes = [{ key: "" }, { key: undefined }, { key: null }, { key: "", ctrlKey: true }, { key: "", metaKey: true, shiftKey: true }];
      const badEmpty = emptyShapes.filter((ev) => {
        const got = eventToCombo({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...ev });
        return got !== null;
      });
      flow.check("空 key 的各种形态一律返回 null（残缺串没有任何入口能进设置）", badEmpty.length === 0, "全部 null", badEmpty.map((ev) => JSON.stringify(ev)));
      flow.check("修饰符顺序固定 Ctrl→Alt→Shift→Meta（同一组合只有一个写法）", (() => {
        const a = eventToCombo({ key: "k", ctrlKey: true, altKey: true, shiftKey: true, metaKey: true });
        return a === "Ctrl+Alt+Shift+Meta+K" && a === eventToCombo({ key: "K", metaKey: true, shiftKey: true, altKey: true, ctrlKey: true });
      })(), "唯一写法", eventToCombo({ key: "k", ctrlKey: true, altKey: true, shiftKey: true, metaKey: true }));

      // ---------- W3 输入焦点守卫（文档与注释都承诺） ----------
      flow.section("W3 输入焦点内不得劫持（commands.ts:8 与 §9.1 M4 都写了这条）");
      let ran = 0;
      commandRegistry.setActionSource("f20", () => ({ "reader.makeCard": { when: () => true, run: () => { ran++; } } }));
      const fakeFromInput = { key: "z", ctrlKey: true, repeat: false, target: { tagName: "INPUT" } };
      __testHooks.dispatchKey(fakeFromInput);
      const guardedInDispatch = ran === 0;
      const staticGuard = /activeElement|isContentEditable|tagName\s*===?\s*["'](INPUT|TEXTAREA)| closest\(["']input/.test(cmdSrc);
      flow.record("行为证据", `焦点内的 Ctrl+Z 触发了 ${ran} 次动作`);
      flow.record("静态证据", `commands.ts 里${staticGuard ? "有" : "找不到"}焦点判断`);
      flow.check("焦点在输入框时命令分发必须放行给原生行为", guardedInDispatch && staticGuard, "不劫持", `dispatchKey 无焦点判断（${ran} 次触发），文件里${staticGuard ? "有" : "也没有"}静态守卫`);
      commandRegistry.setActionSource("f20", null);

      // ---------- W4 分发语义 ----------
      flow.section("W4 when() 关闭 / e.repeat / 抑制栈 三道闸必须都有效（§9.1 M4）");
      let hits = [];
      commandRegistry.setActionSource("f20b", () => ({
        "review.good": { when: () => false, run: () => hits.push("good-when-off") },
        "review.again": { when: () => true, run: () => hits.push("again") },
        "review.undo": { run: () => hits.push("undo-no-when") },
      }));
      __testHooks.dispatchKey({ key: "3", repeat: false });
      flow.eq("when() 返回 false 时不得执行", hits.length, 0);
      __testHooks.dispatchKey({ key: "1", repeat: false });
      flow.eq("when() 放行时必须执行一次", hits.join(","), "again");
      hits = [];
      __testHooks.dispatchKey({ key: "1", repeat: true });
      flow.eq("长按连发（e.repeat）必须忽略", hits.length, 0);
      hits = [];
      __testHooks.dispatchKey({ key: "z", repeat: false });
      flow.eq("没有 when() 的动作照样可触发", hits.join(","), "undo-no-when");
      hits = [];
      commandRegistry.pushSuppress("settings-modal");
      __testHooks.dispatchKey({ key: "1", repeat: false });
      flow.eq("抑制集合非空时全部放行", hits.length, 0);
      commandRegistry.popSuppress("settings-modal");
      hits = [];
      __testHooks.dispatchKey({ key: "1", repeat: false });
      flow.eq("出栈后立刻恢复分发", hits.join(","), "again");
      commandRegistry.setActionSource("f20b", null);
      const pushSites = (panelSrc.match(/pushSuppress\(/g) || []).length;
      const popSites = (panelSrc.match(/popSuppress\(/g) || []).length;
      flow.eq("设置页里 push/pop 必须配对（漏一次 pop = 快捷键永久失效）", popSites, pushSites);
      flow.check("命中后必须拦掉原生命令（Ctrl+A/Ctrl+S 不被浏览器吃掉）", /preventDefault\(\)[\s\S]{0,80}stopPropagation\(\)/.test(cmdSrc), "install 内有拦截", "未找到成对的 preventDefault+stopPropagation");

      // ---------- W5 覆盖项持久化 ----------
      flow.section("W5 只存用户覆盖项、改回默认即删键、重复键位要能被检测（§9.1 M4 键位数据流）");
      const st = require(path.join(ROOT, "electron", "settingsStore.js"));
      // commands.ts 用的是渲染层 settingsStore（依赖 window.settingsAPI）。
      // 在主进程里给它装一座直读写 settings.json 的假桥，才能真正验证「覆盖 → 生效 → 恢复」的往返。
      globalThis.window = {
        settingsAPI: {
          get: async (scope, key) => { const all = st.readSettings(); return all && all[scope] ? all[scope][key] : undefined; },
          set: async (scope, key, value) => {
            const all = st.readSettings();
            const root = all && typeof all === "object" ? all : {};
            root[scope] = { ...(root[scope] || {}), [key]: value };
            st.writeSettings(root);
            return true;
          },
        },
      };
      const settle = () => new Promise((r) => setTimeout(r, 60));
      const wroteBad = [];
      try {
        await commandRegistry.setOverride("review.good", "5");
        await settle();
        let raw = st.readSettings();
        if (raw.app?.keybindings?.["review.good"] !== "5") wroteBad.push("覆盖项没落盘");
        if (__testHooks.getBinding("review.good") !== "5") wroteBad.push("生效键没变");
        const c = commandRegistry.conflictWith("5", "review.delete");
        if (c && c.id !== "review.good") wroteBad.push(`conflictWith 报错对象：${c.id}`);
        await commandRegistry.setOverride("review.good", null);
        await settle();
        raw = st.readSettings();
        if (raw.app && raw.app.keybindings && "review.good" in raw.app.keybindings) wroteBad.push("恢复默认后仍留着键");
        if (__testHooks.getBinding("review.good") !== "3") wroteBad.push(`恢复默认后生效键是 ${__testHooks.getBinding("review.good")}（文件里已删，内存覆盖表被异步回读复活）`);
      } catch (e) {
        wroteBad.push(String((e && e.message) || e).slice(0, 40));
      }
      flow.check("覆盖 → 生效 → 恢复默认，三步都要正确", wroteBad.length === 0, "三步正确", wroteBad);
      flow.record("未知 id 写覆盖项", await commandRegistry.setOverride("nope.nope", "Ctrl+J").then(() => { const r = st.readSettings(); return JSON.stringify((r.app && r.app.keybindings) || {}); }));
      flow.check("未知命令 id 写覆盖项必须被丢弃（不得污染设置）", (() => { const r = st.readSettings(); return !(r.app && r.app.keybindings && "nope.nope" in r.app.keybindings); })(), "不含未知键", st.readSettings().app?.keybindings);
      const dupAccepted = (() => {
        let fired = [];
        commandRegistry.setActionSource("f20d", () => ({
          "review.skip": { run: () => fired.push("skip") },
          "review.delete": { run: () => fired.push("delete") },
        }));
        return commandRegistry.COMMANDS.length > 0 && fired.length === 0 ? "setOverride 不拒绝重复（冲突检测只在设置页）" : "";
      })();
      flow.record("重复键位的写入侧态度", dupAccepted);
      commandRegistry.setActionSource("f20d", null);

      // ---------- W6 两份默认全局快捷键必须同源 ----------
      flow.section("W6 主进程与设置页各存一份全局快捷键默认值，必须字面相等（双事实源闸门）");
      const qcSrc = read(path.join("electron", "quickCapture.js"));
      const capInMain = (qcSrc.match(/DEFAULT_ACCEL_CAPTURE\s*=\s*["']([^"']+)["']/) || [])[1];
      const addInMain = (qcSrc.match(/DEFAULT_ACCEL_ADD_MATERIAL\s*=\s*["']([^"']+)["']/) || [])[1];
      const defBlock = (panelSrc.match(/DEFAULT_GLOBAL_SHORTCUTS[\s\S]{0,400}?\n\};/) || [""])[0];
      const capInPanel = (defBlock.match(/quickCapture:\s*\{[^}]*accelerator:\s*"([^"]+)"/) || [])[1];
      const addInPanel = (defBlock.match(/addMaterial:\s*\{[^}]*accelerator:\s*"([^"]+)"/) || [])[1];
      flow.record("主进程默认值", `${capInMain} / ${addInMain}`);
      flow.record("设置页默认值", `${capInPanel} / ${addInPanel}`);
      flow.check("两侧默认 accelerator 必须一致", capInMain === capInPanel && addInMain === addInPanel, "一致", { 主进程: [capInMain, addInMain], 设置页: [capInPanel, addInPanel] });
      const norm = (x) => (typeof qc.normalizeAccelerator === "function" ? qc.normalizeAccelerator(x) : null);
      const normBad = [];
      for (const raw of ["", "   ", "Ctrl", "Ctrl+", "Ctrl+NotAKey", "Ctrl+Shift"]) {
        const got = norm(raw);
        if (got !== null) normBad.push(`${JSON.stringify(raw)} → ${JSON.stringify(got)}（应判非法并回落默认）`);
      }
      const okNorm = norm("Ctrl+Alt+Space");
      if (!okNorm) normBad.push("合法串被拒");
      if (norm("ctrl+alt+space") !== okNorm) normBad.push(`大小写不同写法归一结果不同：${JSON.stringify(norm("ctrl+alt+space"))} ≠ ${JSON.stringify(okNorm)}`);
      if (norm("Ctrl+Ctrl+C") !== norm("Ctrl+C")) normBad.push(`重复修饰键没去重：${JSON.stringify(norm("Ctrl+Ctrl+C"))}`);
      const sorted = norm("Shift+Ctrl+K");
      if (sorted !== norm("Ctrl+Shift+K")) normBad.push(`修饰键没按固定序排列：${JSON.stringify(sorted)}`);
      flow.record("归一化样本", `Ctrl+Alt+Space → ${okNorm}；Shift+Ctrl+K → ${sorted}`);
      flow.check("主进程 accelerator 归一化：非法一律 null，合法必排序去重", normBad.length === 0, "语义正确", normBad);

      // ---------- W7 复习四键与评分档顺序对齐 ----------
      flow.section("W7 评分键 1/2/3/4 必须与 preview 档序 Again/Hard/Good/Easy 一一对应（§4.4.3 同源）");
      const rvSrc = read(path.join("src", "components", "ReviewView.tsx"));
      const pairs = [...rvSrc.matchAll(/"review\.(again|hard|good|easy)"[\s\S]{0,160}?grade\("([A-Za-z]+)"\)/g)].map((m) => `${m[1]}→${m[2].toLowerCase()}`);
      flow.record("评分命令与档位绑定", pairs.join(" ") || "（没抓到绑定）");
      flow.check("四个评分命令各绑到同名档位（Again/Hard/Good/Easy）", pairs.length === 4 && pairs.every((p) => p.split("→")[0] === p.split("→")[1]), "四对齐全", pairs);
      const rated = COMMANDS.filter((c) => c.scene === "复习" && /^[1-4]$/.test(c.defaultKey)).map((c) => c.defaultKey).join("");
      flow.eq("复习场景恰好四个数字键（无缺无多）", rated, "1234");
      const gradeLabels = COMMANDS.filter((c) => /^review\.(again|hard|good|easy)$/.test(c.id)).map((c) => c.title).join("|");
      flow.check("四个评分命令的展示名要写清档位（用户靠它记键）", gradeLabels === "评分 Again|评分 Hard|评分 Good|评分 Easy", "四档齐", gradeLabels);
      const fsrsSrc = read(path.join("src", "lib", "fsrs.ts"));
      const previewOrder = (fsrsSrc.match(/\[\s*"Again"\s*,\s*"Hard"\s*,\s*"Good"\s*,\s*"Easy"\s*\]/) || [])[0] || "";
      flow.check("preview() 的档序必须是 Again/Hard/Good/Easy（数字键按位对齐全靠它）", !!previewOrder, "固定档序", previewOrder || fsrsSrc.match(/Again[^\n]*/)?.[0]?.slice(0, 60));
    });

    quit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.log("F20 顶层异常：" + (e && e.stack ? e.stack : e));
    flow.writeResult({ crash: String((e && e.message) || e) });
    process.exit(1);
  });
