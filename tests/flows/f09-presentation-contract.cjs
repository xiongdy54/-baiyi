// F09 表现层与设计系统契约流程（静态扫描 + 基线棘轮）
// @runtime: node  @tier: 2  @gui: false  @id: F09  @timeout: 120
// 运行：node tests/flows/f09-presentation-contract.cjs   （或 node tests/flows/run.cjs --only F09）
//
// 角度：设计系统的承诺（§7.1.6「色值/字号/间距一律走 Token，禁止硬编码魔法值」、§5.1 瑞士风基线、
//       v48.14 派生 Token 求值层修复）绝大部分**不看运行时就能证伪**——扫源码即可。
//       这条流程用「棘轮」写法：第一次跑记录基线，之后只允许变好不允许变坏。
//       这样既能当回归闸门，又不会因为并行开发中的正常改动天天误报。
//
// 依据：§7.1.6 L860、§5.1 L457–465、§5.3 L474–484、§5.4 L485–506、
//       docs/swiss-international-style.md（禁止玻璃拟态/状态设计 empty 规则）、§8.1 D50。
"use strict";
const fs = require("fs");
const path = require("path");
const { Flow, runFlow, ROOT } = require("./lib/harness.cjs");

const BASELINE_FILE = path.join(ROOT, "tests", "flows", "fixtures", "f09-presentation-baseline.json");

const flow = new Flow({
  id: "F09",
  title: "表现层与设计系统契约",
  angle: "设计系统承诺的静态可证伪部分（棘轮基线）",
  cites: ["§7.1.6", "§5.1", "§5.3", "§5.4", "docs/swiss-international-style.md", "D50"],
  tier: 2,
  gui: false,
});

function walk(dir, filter, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    if (["node_modules", "dist", "build", ".git", "vendor", "foliate"].includes(name)) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, filter, acc);
    else if (filter(name)) acc.push(full);
  }
  return acc;
}
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");
const read = (p) => fs.readFileSync(p, "utf8");

/** 棘轮：越界即失败，方向明确（worse 表示数值只许降不许升） */
function ratchet(f, key, value, opts = {}) {
  const bl = flow.baseline || {};
  const base = bl[key];
  const direction = opts.direction || "down";
  if (base === undefined) {
    flow.record(`${key}（首次记录基线）`, value);
    flow.check(`棘轮基线建立：${key}`, true, true, true);
    return { first: true };
  }
  const bad = direction === "down" ? value > base : value < base;
  flow.check(`${key} 不超过基线 ${base}（只许变好）`, !bad, `≤${base}`, value);
  if (!bad && value !== base) flow.record(`${key} 变好`, `${base} → ${value}`);
  return { base, value };
}

app_main();

function app_main() {
  const css = walk(path.join(ROOT, "src"), (n) => n.endsWith(".css")).map((p) => ({ p, t: read(p) }));
  const tsx = walk(path.join(ROOT, "src"), (n) => /\.(tsx|ts)$/.test(n)).map((p) => ({ p, t: read(p) }));
  const allCss = css.map((c) => c.t).join("\n");
  const allTsx = tsx.map((c) => c.t).join("\n");

  runFlow(flow, async () => {
    flow.baseline = fs.existsSync(BASELINE_FILE) ? JSON.parse(read(BASELINE_FILE)) : {};
    const newBaseline = { ...flow.baseline };

    // ---------- E1 Token 有定义才有引用 ----------
    flow.section("E1 Token 引用的每个变量必须有定义（§5.1 Token 体系 / v48.14 派生层缺陷）");
    // C-35a：扫描前剥离 CSS 注释（注释里的示例代码不是引用——theme.css 分节注释的
    // `var(--token)` 会被当成引用造成假阳性）；并豁免由 TS setProperty 注入的 Token
    // （src/**/*.ts* 中 setProperty("--xxx"，报告 C-35 步骤 1：如 --wb-main-w 由
    // workbenchLayout.ts 动态写入）。
    const allCssE1 = allCss.replace(/\/\*[\s\S]*?\*\//g, "");
    const setPropTokens = new Set([...allTsx.matchAll(/setProperty\(\s*[`'"](--[\w-]+)/g)].map((m) => m[1]));
    const defined = new Set([...allCssE1.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const used = [...allCssE1.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)];
    const undefinedTokens = new Map();
    for (const m of used) {
      const [, name, sep] = m;
      if (defined.has(name)) continue;
      if (sep === ",") continue; // 带 fallback 的 var() 允许外部注入
      if (setPropTokens.has(name)) continue; // C-35a：TS setProperty 注入视为已定义
      undefinedTokens.set(name, (undefinedTokens.get(name) || 0) + 1);
    }
    flow.record("Token 定义数 / 引用数", `${defined.size} / ${used.length}`);
    flow.check("无「引用了却从未定义、且无 fallback」的 Token（会静默失效）", undefinedTokens.size === 0, "无", [...undefinedTokens.keys()]);
    const unused = [...defined].filter((d) => !used.some((m) => m[1] === d) && !allTsx.includes(d));
    flow.record("定义但无人引用的 Token 数（死 Token，v48.14 清理对象）", unused.length);
    newBaseline.unusedTokens = Math.min(newBaseline.unusedTokens ?? Infinity, unused.length);

    // ---------- E2 硬编码色值 ----------
    flow.section("E2 禁止硬编码色值（§7.1.6 L860）");
    // C-35c：按 C-35b 的 COLOR_ALLOW 豁免口径重算——皮肤清单 manifest.ts / 强调色计算
    // accentVar.ts / EPUB 注入 appearance.ts 本来就应含色值（报告 C-35 证据 3），
    // 与 scripts/consistency-check.mjs 的豁免清单保持同一口径。
    const colorAllowRe = /^src\/skins\/[^/]+\/manifest\.ts$|^src\/lib\/accentVar\.ts$|^src\/lib\/reader\/foliate\/appearance\.ts$/;
    const hexHits = tsx.filter((f) => /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/.test(f.t) && !colorAllowRe.test(rel(f.p))).map((f) => rel(f.p));
    for (const h of hexHits) console.log(`    · ${h}`);
    ratchet(flow, "hardcodedHexFiles", hexHits.length, { direction: "down" });
    newBaseline.hardcodedHexFiles = Math.min(newBaseline.hardcodedHexFiles ?? Infinity, hexHits.length);

    // ---------- E3 魔法数字与 !important ----------
    flow.section("E3 间距/字号魔法值与 !important 棘轮（§5.3 网格纪律）");
    const important = (allCss.match(/!important/g) || []).length;
    console.log(`    · theme !important = ${important}`);
    flow.record("!important 出现次数", important);
    newBaseline.importantCount = Math.min(newBaseline.importantCount ?? Infinity, important);
    if (flow.baseline.importantCount !== undefined) {
      flow.check("!important 不超过基线（每加一处都要写清受控例外）", important <= flow.baseline.importantCount, `≤${flow.baseline.importantCount}`, important);
    } else {
      flow.check("棘轮基线建立：importantCount", true, true, true);
    }
    const inlinePx = (allTsx.match(/style=\{\{[^}]*\d+px/g) || []).length;
    console.log(`    · 内联 px 计数 = ${inlinePx}`);
    newBaseline.inlinePxCount = Math.min(newBaseline.inlinePxCount ?? Infinity, inlinePx);
    if (flow.baseline.inlinePxCount !== undefined) {
      flow.check("内联 style 里的 px 魔法值不超过基线", inlinePx <= flow.baseline.inlinePxCount, `≤${flow.baseline.inlinePxCount}`, inlinePx);
    } else {
      flow.check("棘轮基线建立：inlinePxCount", true, true, true);
    }

    // ---------- E4 玻璃拟态已下线 ----------
    flow.section("E4 第二皮肤（玻璃拟态）不得复活（v48.14 删除、swiss 规范禁止）");
    // v49.0 / D170（P6）：src/skins/_lab/ 是仅 DEV 注册的引擎能力回归样本，含受控 backdrop-filter
    //（顶栏玻璃，同屏 1 处，§2.12 预算）——扫描范围收窄豁免该目录（生产构建产物搜不到 skin-lab）。
    const glass = [...css, ...tsx].filter((f) => !f.p.includes(`${ROOT}\\src\\skins\\_lab`) && !f.p.replace(/\\/g, "/").includes("src/skins/_lab") && /backdrop-filter|下蛋|Dream.*glass|glassmorphism/i.test(f.t)).map((f) => rel(f.p));
    flow.check("src 内不得出现 backdrop-filter/玻璃拟态", glass.length === 0, "无", glass);
    const skinsDir = path.join(ROOT, "src", "skins");
    const skins = fs.existsSync(skinsDir) ? fs.readdirSync(skinsDir) : [];
    flow.record("src/skins 内容", skins.join(" "));

    // ---------- E5 可达性静态面 ----------
    flow.section("E5 模态与图标的一致性（v48.14 P3.5–3.7 收口项）");
    const modalOpens = [...allTsx.matchAll(/className=\{?[`"'][^`"']*\bmodal\b/g)].length;
    const ariaModal = (allTsx.match(/aria-modal/g) || []).length;
    flow.record("modal 类出现次数 / aria-modal 次数", `${modalOpens} / ${ariaModal}`);
    flow.check("出现 modal 容器就必须有 aria-modal 声明（可达性不回退）", modalOpens === 0 || ariaModal >= 1, "≥1", ariaModal);
    const alertDlg = (allTsx.match(/window\.(alert|confirm|prompt)\s*\(/g) || []).length;
    flow.check("原生弹窗不得回归（v48.14 改内联反馈）", alertDlg, 0);
    const rawSvg = (allTsx.match(/<svg[\s>]/g) || []).length;
    flow.record("业务代码内联 <svg> 次数（应走 icons.tsx）", rawSvg);
    newBaseline.rawSvgCount = Math.min(newBaseline.rawSvgCount ?? Infinity, rawSvg);
    if (flow.baseline.rawSvgCount !== undefined) {
      flow.check("内联 svg 不超过基线", rawSvg <= flow.baseline.rawSvgCount, `≤${flow.baseline.rawSvgCount}`, rawSvg);
    } else {
      flow.check("棘轮基线建立：rawSvgCount", true, true, true);
    }
    flow.check("icons.tsx 存在且导出图标函数", /export const Icon/.test(allTsx), true, false);

    // ---------- E6 文档承诺的具体数值仍成立 ----------
    flow.section("E6 指南锁死的版面数字（§5.3 补 2px 半档 / §5.4 动作条 40px）");
    const guide = read(path.join(ROOT, "AI_DEVELOPMENT_GUIDE.md"));
    flow.check("指南仍是单一版本标题（无正文/标题版本不一致）", /^# .*v(\d+\.\d+)/m.test(guide.slice(0, 300)), true, guide.slice(0, 60));
    const themeTxt = read(path.join(ROOT, "src", "theme.css"));
    // v49.0 / D169：基线 accent 自 v48.35/D75 起为深绿 #166a59（IKB 退役，GUIDE §5.1 同步修正）——陈旧断言一并校准
    flow.check("theme.css 仍定义强调色基线 #166a59（§accent 默认值，v48.35/D75 深绿）", /#166a59/i.test(themeTxt), true, false);
    const accentTxt = read(path.join(ROOT, "src", "lib", "accentVar.ts"));
    // v49.0 / D172：applyAccent 改写 --user-accent 三件套（内联 --accent 会压掉皮肤 accent）；
    // 「同时写 body」的修复纪律不变（只写 :root 会被 body.theme-dark 的声明盖掉）
    flow.check("applyAccent 同时写 body（780ea84 修复不回退：只写 :root 会被 body.theme-dark 盖掉）", /document\.body/.test(accentTxt) && /setProperty\("--user-accent"/.test(accentTxt), true, { body: /document\.body/.test(accentTxt) });

    // ---------- E7 书墙与空态两条新规则（v48.15 / D51）----------
    flow.section("E7 书墙网格与空态两条例外不得回退（docs/swiss-international-style.md「画廊 / 状态设计」，正本 §5.3/§5.4）");
    const shelfTxt = read(path.join(ROOT, "src", "components", "Bookshelf.tsx"));
    flow.check("书墙用 repeat(auto-fill, minmax(下限, 1fr))，不是定宽列", /repeat\(\s*auto-fill\s*,\s*minmax\(/.test(themeTxt), "auto-fill 网格", (themeTxt.match(/grid-template-columns:[^\n]*/) || ["（没抓到网格声明）"])[0]);
    flow.check("网格下限走 Token，不把像素写死", /--shelf-min\s*:/.test(themeTxt) && !/minmax\(\s*min\(100%,\s*\d+px\)/.test(themeTxt), "--shelf-min", (themeTxt.match(/--shelf-min\s*:[^\n]*/) || ["（缺 Token）"])[0]);
    const wallBlocks = (themeTxt.match(/[^{}]*\{[^}]*auto-fill[^}]*\}/g) || []);
    const badJustify = wallBlocks.filter((b) => /justify-content\s*:\s*(start|space-between|flex-start)/.test(b)).map((b) => (b.match(/[^{\n]+/) || ["?"])[0].trim());
    flow.check("同一规则块内禁止 justify-content: start / space-between（把余量甩成右侧空白、间距不守 Token）", badJustify.length === 0, "无", badJustify);
    /** 从 JSX 里按 div 配对取出某个 className 的整块 */
    const jsxBlock = (src, marker) => {
      const start = src.indexOf(marker);
      if (start < 0) return "";
      let depth = 0;
      const re = /<\/?\s*div\b/g;
      re.lastIndex = start;
      let m;
      while ((m = re.exec(src))) {
        if (m[0][1] === "/") { depth--; if (depth === 0) return src.slice(start, m.index + m[0].length); }
        else depth++;
      }
      return src.slice(start, start + 1500);
    };
    const emptyBlock = jsxBlock(shelfTxt, '<div className="empty-state shelf-empty"');
    flow.record("空态块长度", `${emptyBlock.length} 字符`);
    flow.check("空态＝品牌设计系统 empty 组件（插画 + 标题 + 说明；v49.90/D257）", /shelf-empty-art/.test(emptyBlock) && /这里还什么都没有/.test(emptyBlock) && /导入一篇文章/.test(emptyBlock), "插画 + 标题 + 说明", emptyBlock.slice(0, 60) || "（没找到 shelf-empty）");
    flow.check("空态内有且只有一个「导入文章」主行动（D257 修订 D51）", /<button[^>]*onClick={onImportFiles}/.test(emptyBlock) && /T\("导入文章"\)/.test(emptyBlock), "单一主行动", (emptyBlock.match(/<button[^>]*>/g) || []).join(" "));
    flow.check("无封面回落骨架不再有 accent 书脊小方块（v48.82/D126）", !/book-card-spine/.test(shelfTxt), "无 spine", (shelfTxt.match(/book-card-spine/g) || []).length);
    const barCss = (themeTxt.match(/\.shelf-bar\s*\{[^}]*\}/) || [""])[0];
    flow.check("吸顶工具条五件套齐（计数 · 视图 · 密度 · 排序 · 主行动在右）", /position\s*:\s*sticky/.test(barCss) && /shelf-bar/.test(shelfTxt) && ["视图", "密度", "排序"].every((w) => shelfTxt.includes(w)), ".shelf-bar 吸顶 + 三个选择器", { css: barCss.slice(0, 70) || "（没抓到 .shelf-bar）", sticky: /position\s*:\s*sticky/.test(barCss), 视图: shelfTxt.includes("视图"), 密度: shelfTxt.includes("密度"), 排序: shelfTxt.includes("排序") });
    flow.check("卡片动作不在卡面永久挂控件（靠 hover/focus 显形）", /:hover[^{]*\{[^}]*opacity\s*:\s*1|hover[^{]*\{[^}]*opacity\s*:\s*1/.test(themeTxt), "hover 显形", (themeTxt.match(/\.shelf-act[^\n]*\{[^}]*\}/) || ["（没抓到动作条样式）"])[0]?.slice(0, 90));

    // ---------- E8 极窄窗口的单调退让阶梯 + 键盘可达补口（v48.15/D51 与 v48.14/D50） ----------
    flow.section("E8 工具条退让阶梯必须单调、焦点陷阱必须挂在 dialog 上（§5.3 阶梯 / §5.4 D51 / D50 键盘可达）");
    const ladder = [...themeTxt.matchAll(/@container\s+shelf\s*\(\s*max-width:\s*(\d+)px\s*\)\s*\{([^}]*)\}/g)]
      .map((m) => ({ w: Number(m[1]), hides: [...m[2].matchAll(/\.\s*([\w-]+)[^{]*?\{\s*display:\s*none/g)].map((x) => x[1]) }));
    flow.record("退让阶梯", ladder.map((l) => `${l.w}px→[${l.hides.join(",")}]`).join(" ") || "（没抓到 @container shelf 规则）");
    flow.check("阶梯有三档且宽度互不相同（900 / 1100 / 1280）", ladder.length === 3 && new Set(ladder.map((l) => l.w)).size === 3, "三档", ladder.map((l) => l.w));
    const byWidth = [...ladder].sort((a, b) => a.w - b.w);
    const monotonic = byWidth.every((l, i) => i === 0 || l.hides.length >= byWidth[i - 1].hides.length);
    flow.check("窗口越窄隐藏项只能越多（单调退让；阈值各回各的会让中段挤成两行，实测踩过）", monotonic && byWidth.length === 3 && byWidth[2].w > byWidth[0].w, "单调递增", ladder.map((l) => `${l.w}px:${l.hides.length} 项`));
    const rebound = [...themeTxt.matchAll(/\.(shelf-label|shelf-hint|shelf-kbd|shelf-kbd-in)[^{]*\{\s*display:\s*(flex|block|inline-flex|grid)/g)].map((m) => m[0].slice(0, 46));
    flow.check("不得有把已退让元素又显示回来的规则（阶梯会回弹）", rebound.length === 0, "无回弹", rebound);

    const dlgFiles = tsx.filter((f) => /=\s*useDialogA11y\s*[<(]/.test(f.t) && !f.p.endsWith("dialogA11y.ts"));
    flow.record("挂焦点陷阱的文件数", String(dlgFiles.length));
    const unhooked = dlgFiles.filter((f) => !/role="dialog"|aria-modal/.test(f.t)).map((f) => rel(f.p));
    flow.check("每个用 useDialogA11y 的模态都必须把容器标成 dialog（否则陷阱挂了屏幕阅读器也读不到）", unhooked.length === 0, "全部标注", unhooked);
    const panels = dlgFiles.reduce((n, f) => n + (f.t.match(/role="dialog"|aria-modal/g) || []).length, 0);
    flow.check("D50 承诺的模态焦点陷阱量级仍在（≥8 个面板）", panels >= 8, "≥8", panels);
    const altNav = ["src/components/dashboard/Dashboard.tsx", "src/components/Bookshelf.tsx"].filter((want) => tsx.some((f) => rel(f.p) === want && /altKey/.test(f.t)));
    flow.check("Alt+方向键重排（仪表盘卡片与书架书卡）两处补口都还在", altNav.length === 2, "两处都在", altNav);
    const escOwn = tsx.filter((f) => /addEventListener\(\s*["']keydown["'][\s\S]{0,400}?Escape/.test(f.t)).map((f) => rel(f.p)).length;
    if (flow.baseline.escHandlers !== undefined) {
      flow.check("自己监听 Escape 的组件数不超过基线（关闭栈应集中在一处）", escOwn <= flow.baseline.escHandlers, `≤${flow.baseline.escHandlers}`, escOwn);
    } else {
      flow.check("棘轮基线建立：escHandlers", true, true, true);
    }
    newBaseline.escHandlers = Math.min(flow.baseline.escHandlers ?? Infinity, escOwn);

    fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(newBaseline, null, 2), "utf8");
  }).then((s) => process.exit(s.fail > 0 || s.aborted || s.crash ? 1 : 0));
}
