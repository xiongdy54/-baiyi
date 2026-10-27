// D130 R3 阅读个性化——外观归一纯函数矩阵（node 直跑）
// @runtime: node
// 运行：node tests/reader.appearance.test.cjs
// 依据：docs/design/READER-PERSONALIZATION-D130.md §3（归一口）+ §8.1（node 测试计划 1–5）。
// 覆盖：maxInlineSize 钳制 / turnEffect 归一（D241，取代 turnAnimated 存储字段）/ customThemes 清洗与上限保新弃旧 /
//       存量 settings 解析与 D130 之前 resolveAppearance 输出逐字段相等（防静默默认漂移）/
//       lineHeight/margin 既有钳制回归 / 字体栈清洗 cssFontFamily（D241：修整串栈被当成单一字体名）。
// 零网络零库：appearance.ts 为纯函数模块（唯一外部引用是 kernel.ts 的类型，编译期剥离），
// 经 esbuild 现场打包成 CJS（与 tests/flows/f20 同一手法），不落任何持久文件。
"use strict";
const path = require("path");
const fs = require("fs");

// ---------- 现场打包 src/lib/reader/foliate/appearance.ts（f20 loadTs 同法，不改动被测代码） ----------
function loadAppearanceModule() {
  const esbuild = require("esbuild");
  const out = path.join(__dirname, "tmp-d130", "appearance.bundle.cjs");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, "..", "src", "lib", "reader", "foliate", "appearance.ts")],
    bundle: true,
    write: true,
    outfile: out,
    format: "cjs",
    platform: "neutral",
    target: "es2020",
    logLevel: "silent"
  });
  return require(out);
}

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
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- D130 之前的 resolveAppearance 逐字段快照（存量行为锁定；v20–v48.86 实现） ----------
const LEGACY_PRESETS = {
  paper: { bg: "#fafaf8", fg: "#1a1a1a" },
  sepia: { bg: "#f4ecd8", fg: "#5b4636" },
  dark: { bg: "#141414", fg: "#c9c9c9" }
};
// D241 有意偏离（登记于 GUIDE D241）：缺省字体栈重排扩充、缺省字号 17→18——仅影响**未设置**这两项的存量用户；
// D242 再修正中文回退栈：无思源/Noto 宋体时用常规黑体，避免仅安装粗体的系统宋体。
// 快照随之更新为 D242 缺省值（显式设置过的字号/字体逐字段不变，由下方夹具 fontSize/fontFamily 行守护）。
const LEGACY_FONT_STACK =
  '"Source Han Serif SC", "Noto Serif CJK SC", "Source Han Serif", "Noto Serif SC", "Iowan Old Style", Charter, Georgia, "Times New Roman", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", "Source Han Sans SC", "Noto Sans CJK SC", sans-serif';
const LEGACY_DEFAULT_FONT_SIZE = 18;
const LEGACY_DEFAULT_APPEARANCE = { theme: "paper" };
function legacyResolveAppearance(s) {
  const a = (s && s.appearance) || LEGACY_DEFAULT_APPEARANCE;
  const preset = a.theme === "custom" ? null : LEGACY_PRESETS[a.theme];
  const zoom = a.zoom === "page-width" || a.zoom === "page-fit" ? a.zoom
    : typeof a.zoom === "number" && a.zoom >= 50 && a.zoom <= 300 ? a.zoom
    : "page-width";
  return {
    theme: a.theme,
    fontFamily: (a.fontFamily && a.fontFamily.trim()) || LEGACY_FONT_STACK,
    fontSize: a.fontSize && a.fontSize >= 10 && a.fontSize <= 40 ? a.fontSize : LEGACY_DEFAULT_FONT_SIZE,
    lineHeight: a.lineHeight && a.lineHeight >= 1.2 && a.lineHeight <= 2.4 ? a.lineHeight : 1.7,
    bgColor: a.theme === "custom" && a.bgColor ? a.bgColor : (preset && preset.bg) || LEGACY_PRESETS.paper.bg,
    fgColor: a.theme === "custom" && a.fgColor ? a.fgColor : (preset && preset.fg) || LEGACY_PRESETS.paper.fg,
    margin: a.margin && a.margin >= 0 && a.margin <= 120 ? a.margin : 48,
    zoom
  };
}
/** D130 前后共同字段（新增字段 maxInlineSize/turnEffect/turnAnimated 不在快照内） */
const LEGACY_FIELDS = ["theme", "fontFamily", "fontSize", "lineHeight", "bgColor", "fgColor", "margin", "zoom"];

let mod;
try {
  mod = loadAppearanceModule();
} catch (e) {
  console.error("打包 appearance.ts 失败（需要 devDependency esbuild）:", String(e).slice(0, 300));
  process.exit(1);
}
const { resolveAppearance, normalizeReaderSettings, clampMaxInlineSize, normalizeCustomThemes, normalizeTurnEffect, cssFontFamily, readerThemeTone, CUSTOM_THEMES_MAX, DEFAULT_READER_FONT_STACK } = mod;
const projectLegacy = (resolved) => Object.fromEntries(LEGACY_FIELDS.map((k) => [k, resolved[k]]));

console.log("== 1 maxInlineSize 钳制（缺省/非法→720；边界 480/1200 保留） ==");
check("缺省 → 720", clampMaxInlineSize(undefined) === 720, 720, clampMaxInlineSize(undefined));
check("负数 → 720", clampMaxInlineSize(-1) === 720, 720, clampMaxInlineSize(-1));
check("字符串 → 720", clampMaxInlineSize("720") === 720, 720, clampMaxInlineSize("720"));
check("越界上（1201）→ 720", clampMaxInlineSize(1201) === 720, 720, clampMaxInlineSize(1201));
check("越界下（479）→ 720", clampMaxInlineSize(479) === 720, 720, clampMaxInlineSize(479));
check("NaN → 720", clampMaxInlineSize(NaN) === 720, 720, clampMaxInlineSize(NaN));
check("下边界 480 保留", clampMaxInlineSize(480) === 480, 480, clampMaxInlineSize(480));
check("上边界 1200 保留", clampMaxInlineSize(1200) === 1200, 1200, clampMaxInlineSize(1200));
check("resolveAppearance 缺省 → 720", resolveAppearance(null).maxInlineSize === 720, 720, resolveAppearance(null).maxInlineSize);

console.log("== 2 turnEffect 归一（D241：缺省 glide；旧 turnAnimated 存储字段退役） ==");
check("normalizeTurnEffect 缺省 → glide", normalizeTurnEffect(undefined) === "glide", "glide", normalizeTurnEffect(undefined));
check("normalizeTurnEffect none → none", normalizeTurnEffect("none") === "none", "none", normalizeTurnEffect("none"));
check("normalizeTurnEffect 非法值 → glide", normalizeTurnEffect("fade") === "glide", "glide", normalizeTurnEffect("fade"));
check("resolveAppearance 缺省 → turnAnimated=true（node 无 matchMedia ＝ 动效未关）", resolveAppearance(null).turnAnimated === true, true, resolveAppearance(null).turnAnimated);
check("turnEffect=none → turnAnimated=false", resolveAppearance({ mode: { flow: "paged" }, appearance: { theme: "paper", turnEffect: "none" } }).turnAnimated === false, false, "none");
check("旧存储 turnAnimated=false 被忽略 → 仍按缺省 glide 生效", resolveAppearance({ mode: { flow: "paged" }, appearance: { theme: "paper", turnAnimated: false } }).turnAnimated === true, true, "legacy false");
check("normalize 缺省 → turnEffect=glide", normalizeReaderSettings({}).appearance.turnEffect === "glide", "glide", normalizeReaderSettings({}).appearance.turnEffect);
check("normalize 剥离旧 turnAnimated 存储字段", !("turnAnimated" in normalizeReaderSettings({ appearance: { turnAnimated: true } }).appearance), "无 turnAnimated", normalizeReaderSettings({ appearance: { turnAnimated: true } }).appearance);
check("normalize 保留 turnEffect=none", normalizeReaderSettings({ appearance: { turnEffect: "none" } }).appearance.turnEffect === "none", "none", normalizeReaderSettings({ appearance: { turnEffect: "none" } }).appearance.turnEffect);

// D241：系统与应用两条减少动效轨道均优先于存储意愿。
const savedDocument = global.document;
const savedMatchMedia = global.matchMedia;
try {
  global.matchMedia = () => ({ matches: true });
  check("系统减少动效强制关闭过渡", resolveAppearance(null).turnAnimated === false, false, resolveAppearance(null).turnAnimated);
  global.matchMedia = () => ({ matches: false });
  for (const mode of ["motion-off", "motion-reduced"]) {
    global.document = { body: { classList: { contains: (cls) => cls === mode } } };
    check(`${mode} 强制关闭过渡`, resolveAppearance(null).turnAnimated === false, false, resolveAppearance(null).turnAnimated);
    check(`${mode} 保留 glide 意愿`, resolveAppearance(null).turnEffect === "glide", "glide", resolveAppearance(null).turnEffect);
  }
} finally {
  if (savedDocument === undefined) delete global.document; else global.document = savedDocument;
  if (savedMatchMedia === undefined) delete global.matchMedia; else global.matchMedia = savedMatchMedia;
}

console.log("== 3 customThemes 清洗与上限（保新弃旧 / 非法丢弃 / 重复保首条 / name 截断） ==");
check("缺省 → []", eq(normalizeCustomThemes(undefined), []), [], normalizeCustomThemes(undefined));
check("非数组 → []", eq(normalizeCustomThemes("x"), []), [], normalizeCustomThemes("x"));
check("对象 → []", eq(normalizeCustomThemes({}), []), [], normalizeCustomThemes({}));
const mkTheme = (i, over) => ({
  id: `ct-${i}`,
  name: `我的主题 ${i}`,
  bgColor: "#112233",
  fgColor: "#445566",
  createdAt: i,
  ...over
});
// 13 条保新弃旧：createdAt 1..13，取前 12 = createdAt 13..2
const thirteen = Array.from({ length: 13 }, (_, i) => mkTheme(i + 1));
const capped = normalizeCustomThemes(thirteen);
check(`13 条 → 上限 ${CUSTOM_THEMES_MAX}`, capped.length === CUSTOM_THEMES_MAX, CUSTOM_THEMES_MAX, capped.length);
check("保新弃旧：最旧的 createdAt=1 被弃", !capped.some((t) => t.createdAt === 1), "无 createdAt=1", capped.map((t) => t.createdAt));
check("保新弃旧：保留 createdAt=13..2", eq(capped.map((t) => t.createdAt).slice().sort((a, b) => a - b), Array.from({ length: 12 }, (_, i) => i + 2)), "2..12 保留", capped.map((t) => t.createdAt));
check("非法色值条目丢弃", eq(normalizeCustomThemes([mkTheme(1, { bgColor: "red" }), mkTheme(2)]).map((t) => t.id), ["ct-2"]), ["ct-2"], normalizeCustomThemes([mkTheme(1, { bgColor: "red" }), mkTheme(2)]));
check("非 #rrggbb（3 位hex）丢弃", eq(normalizeCustomThemes([mkTheme(1, { fgColor: "#abc" })]), []), [], normalizeCustomThemes([mkTheme(1, { fgColor: "#abc" })]));
check("空 id 条目丢弃", eq(normalizeCustomThemes([mkTheme(1, { id: "  " }), mkTheme(2)]).map((t) => t.id), ["ct-2"]), ["ct-2"], normalizeCustomThemes([mkTheme(1, { id: "  " }), mkTheme(2)]));
check("重复 id 保留首条", eq(normalizeCustomThemes([mkTheme(1, { name: "first" }), mkTheme(1, { name: "second" })]).map((t) => t.name), ["first"]), ["first"], normalizeCustomThemes([mkTheme(1, { name: "first" }), mkTheme(1, { name: "second" })]));
check("name 超 24 字符截断", normalizeCustomThemes([mkTheme(1, { name: "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十" })])[0].name.length === 24, 24, normalizeCustomThemes([mkTheme(1, { name: "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十" })])[0].name);
check("非对象条目丢弃", eq(normalizeCustomThemes([null, 42, mkTheme(3)]).map((t) => t.id), ["ct-3"]), ["ct-3"], normalizeCustomThemes([null, 42, mkTheme(3)]));
check("createdAt 非法丢弃", eq(normalizeCustomThemes([mkTheme(1, { createdAt: "yesterday" })]), []), [], normalizeCustomThemes([mkTheme(1, { createdAt: "yesterday" })]));
check("normalizeReaderSettings 缺省 customThemes → []", eq(normalizeReaderSettings({}).customThemes, []), [], normalizeReaderSettings({}).customThemes);

console.log("== 4 向后兼容：存量输入解析与 D130 之前实现逐字段相等（防静默默认漂移） ==");
const legacyInputs = [
  { mode: { flow: "paged" }, appearance: { theme: "paper" } },
  {},
  { appearance: { theme: "custom", bgColor: "#112233", fgColor: "#445566" } },
  { appearance: { theme: "sepia", fontSize: 22, fontFamily: "  Georgia  ", lineHeight: 2.0, margin: 80, zoom: 150 } },
  { appearance: { theme: "dark", fontSize: 5, lineHeight: 9, margin: -3, zoom: 400 } },
  // 注：夹具不含 margin=0——旧钳制的 falsy 写法令 0→48，D130 有意修正为 0 生效（见下方「有意偏离」断言；
  // 修正动机＝本批新增 0–120 滑杆后 0 成为可设值，R3「看着能调、调了没反应＝硬缺陷」）
  { appearance: { theme: "paper", fontSize: 40, lineHeight: 1.2, margin: 4, zoom: "page-fit" } }
];
for (const input of legacyInputs) {
  const legacy = legacyResolveAppearance(input);
  const modern = projectLegacy(resolveAppearance(normalizeReaderSettings(input)));
  check(
    `存量输入 ${JSON.stringify(input)} 逐字段相等`,
    eq(legacy, modern),
    legacy,
    modern
  );
}
check(
  "有意偏离：margin=0 生效（旧 falsy 钳制 0→48；D130 修正，登记入报告）",
  resolveAppearance({ mode: { flow: "scrolled" }, appearance: { theme: "paper", margin: 0 } }).margin === 0,
  0,
  resolveAppearance({ mode: { flow: "scrolled" }, appearance: { theme: "paper", margin: 0 } }).margin
);
// normalizeReaderSettings 自身的存量形态（mode/appearance 展开）也与旧展开逻辑一致
const raw = { mode: { flow: "paged", spread: true }, appearance: { theme: "sepia", fontSize: 19 } };
check(
  "normalize mode/appearance 展开 = 旧展开逻辑",
  eq(normalizeReaderSettings(raw), {
    mode: { flow: "paged", spread: true },
    appearance: { theme: "sepia", fontSize: 19, maxInlineSize: 720, turnEffect: "glide" },
    customThemes: []
  }),
  "{mode, appearance(+720,glide), []}",
  normalizeReaderSettings(raw)
);

console.log("== 5 lineHeight/margin 既有钳制回归（1.2–2.4 / 0–120） ==");
const lh = (v) => resolveAppearance({ mode: { flow: "scrolled" }, appearance: { theme: "paper", lineHeight: v } }).lineHeight;
check("lineHeight 1.2 下边界保留", lh(1.2) === 1.2, 1.2, lh(1.2));
check("lineHeight 2.4 上边界保留", lh(2.4) === 2.4, 2.4, lh(2.4));
check("lineHeight 2.5 → 1.7", lh(2.5) === 1.7, 1.7, lh(2.5));
check("lineHeight 1.1 → 1.7", lh(1.1) === 1.7, 1.7, lh(1.1));
const mg = (v) => resolveAppearance({ mode: { flow: "scrolled" }, appearance: { theme: "paper", margin: v } }).margin;
check("margin 0 下边界保留", mg(0) === 0, 0, mg(0));
check("margin 120 上边界保留", mg(120) === 120, 120, mg(120));
check("margin 121 → 48", mg(121) === 48, 48, mg(121));
check("margin -1 → 48", mg(-1) === 48, 48, mg(-1));

console.log("== 6 字体栈清洗 cssFontFamily（D241） ==");
check("默认栈逐项保留为多个字体名（不再被整串引成一个名字）", cssFontFamily(DEFAULT_READER_FONT_STACK).split(", ").length === DEFAULT_READER_FONT_STACK.split(",").length, DEFAULT_READER_FONT_STACK.split(",").length, cssFontFamily(DEFAULT_READER_FONT_STACK));
check("默认栈首项＝\"Source Han Serif SC\"、末项＝sans-serif 关键字", /^"Source Han Serif SC", /.test(cssFontFamily(DEFAULT_READER_FONT_STACK)) && /, sans-serif$/.test(cssFontFamily(DEFAULT_READER_FONT_STACK)), "首/末项", cssFontFamily(DEFAULT_READER_FONT_STACK));
check("单个无引号字体名加引号", cssFontFamily("霞鹜文楷") === '"霞鹜文楷"', '"霞鹜文楷"', cssFontFamily("霞鹜文楷"));
check("单引号/双引号混写归一", cssFontFamily("'LXGW WenKai', \"Noto Serif\", sans-serif") === '"LXGW WenKai", "Noto Serif", sans-serif', '"LXGW WenKai", "Noto Serif", sans-serif', cssFontFamily("'LXGW WenKai', \"Noto Serif\", sans-serif"));
check("剔除可逃逸声明的字符（; { } < >）", !/[;{}<>]/.test(cssFontFamily("Georgia; } body { color: red")), "无 ;{}<>", cssFontFamily("Georgia; } body { color: red"));
check("空串 → serif", cssFontFamily("  ") === "serif", "serif", cssFontFamily("  "));

console.log("== 7 D242 中文字体与阅读主题明暗档 ==");
check("默认栈不含仅粗体/旧式中文宋体兜底", !/Songti|STSong|SimSun|Yu Mincho/.test(DEFAULT_READER_FONT_STACK), "无旧式宋体", DEFAULT_READER_FONT_STACK);
for (const [theme, bgColor, expected] of [
  ["paper", undefined, "light"], ["sepia", undefined, "light"], ["dark", undefined, "dark"],
  ["custom", "#1f2a36", "dark"], ["custom", "#000000", "dark"], ["custom", "#FFFFFF", "light"],
  ["custom", "#f4ecd8", "light"], ["custom", "invalid", "light"], ["custom", undefined, "light"]
]) {
  const actual = readerThemeTone({ theme, bgColor });
  check(`主题 ${theme}/${bgColor ?? "缺省"} → ${expected}`, actual === expected, expected, actual);
}

fs.rmSync(path.join(__dirname, "tmp-d130"), { recursive: true, force: true });
console.log(`\n==== SUMMARY ${pass}/${pass + fail} ====`);
process.exit(fail ? 1 : 0);
