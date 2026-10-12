// 插件/主题体系纯函数内核测试（v48.89 / D132，设计 docs/design/PLUGIN-SYSTEM-D132.md §12.1）
// @runtime: node  @tier: 1  @id: PLUGINHOST-NODE
// 运行：node tests/pluginhost.test.cjs
//
// 覆盖 §12.1 第 1–8 节矩阵：清单校验 / versions.json / compareSemver / @settings 解析 /
// CSS 校验器 / 对比度审计 / assembleVars / nextAppearanceState 互斥矩阵。
// pluginCore 零 electron / 零 fs 依赖，node 直跑（§4.1 拆分纪律，appLog.js 先例）。
"use strict";
const fs = require("fs");
const path = require("path");
const core = require("../electron/pluginCore");

let pass = 0;
let fail = 0;
function check(name, cond, actual) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 300)}`);
  }
}
function eq(name, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} | 实际: ${JSON.stringify(actual)} 期望: ${JSON.stringify(expected)}`);
  }
}

const FIXTURES = path.join(__dirname, "fixtures", "plugins");
const readFixture = (...segs) => fs.readFileSync(path.join(FIXTURES, ...segs), "utf-8");

// 便捷构造合法清单
const goodManifest = (patch) =>
  JSON.stringify({ id: "demo", name: "示例", version: "1.0.0", type: "theme", ...(patch || {}) });

(async () => {
  console.log("== 0) 内核零依赖纪律（T1 验收：grep 可查零 electron require） ==");
  {
    const src = fs.readFileSync(path.join(__dirname, "..", "electron", "pluginCore.js"), "utf-8");
    check("不 require electron", !/\brequire\(\s*["']electron["']\s*\)/.test(src), src.match(/\brequire\([^)]*\)/g));
    check("不 require fs / path / 其他模块（纯函数，宿主喂文本）", !/\brequire\(\s*["'][^"']+["']\s*\)/.test(src), src.match(/\brequire\([^)]*\)/g));
  }

  console.log("== 1) 清单矩阵（validateManifest） ==");
  {
    const ok1 = core.validateManifest(goodManifest(), "demo");
    check("合法清单通过", ok1.ok === true, ok1.reason);
    check("styles 缺省名即 styles.css", ok1.ok && ok1.manifest.styles === "styles.css", ok1.manifest && ok1.manifest.styles);
    check("minAppVersion 缺省 = 0.0.0", ok1.ok && ok1.manifest.minAppVersion === "0.0.0", ok1.manifest && ok1.manifest.minAppVersion);

    for (const missing of ["id", "name", "version", "type"]) {
      const patch = {};
      patch[missing] = undefined;
      const r = core.validateManifest(goodManifest(patch), "demo");
      check(`缺 ${missing} 拒`, r.ok === false && r.reason.includes(missing), r.reason);
    }
    check("id 非法字符拒", core.validateManifest(goodManifest({ id: "Demo" }), "Demo").ok === false, "");
    check("id 大写拒", core.validateManifest(goodManifest({ id: "demo_x" }), "demo_x").ok === false, "");
    check("id 单字符拒（2–32）", core.validateManifest(goodManifest({ id: "a" }), "a").ok === false, "");
    check("id 以连字符结尾拒", core.validateManifest(goodManifest({ id: "demo-" }), "demo-").ok === false, "");
    check("id 与文件夹名不等拒（原因含两者）", (() => {
      const r = core.validateManifest(goodManifest({ id: "sepia-demo" }), "other-folder");
      return r.ok === false && r.reason.includes("sepia-demo") && r.reason.includes("other-folder");
    })(), "");
    const nt = core.validateManifest(goodManifest({ type: "widget" }), "demo");
    check("type=widget 拒且原因可读", nt.ok === false && nt.reason.includes("本期仅支持主题插件"), nt.reason);
    check("未知字段忽略（前向兼容）", core.validateManifest(goodManifest({ futureField: { x: 1 } }), "demo").ok === true, "");
    // main 字段无副作用（§9.1：不读不校验不执行；含 main.js 的插件与不含者记录等价）
    const withMain = core.validateManifest(goodManifest({ main: "main.js", mainX: "evil.js" }), "demo");
    const noMain = core.validateManifest(goodManifest(), "demo");
    check("main 字段无副作用（含 main.js 与不含者 manifest 等价）", withMain.ok && noMain.ok && JSON.stringify(withMain.manifest) === JSON.stringify(noMain.manifest), "");
    check("name 超 40 字符拒", core.validateManifest(goodManifest({ name: "长".repeat(41) }), "demo").ok === false, "");
    check("name trim 后空拒", core.validateManifest(goodManifest({ name: "   " }), "demo").ok === false, "");
    check("author 超 60 拒", core.validateManifest(goodManifest({ author: "a".repeat(61) }), "demo").ok === false, "");
    check("description 超 200 拒", core.validateManifest(goodManifest({ description: "d".repeat(201) }), "demo").ok === false, "");
    check("version 非 semver 拒", core.validateManifest(goodManifest({ version: "1.0" }), "demo").ok === false, "");
    check("version 非数字段拒", core.validateManifest(goodManifest({ version: "1.0.beta" }), "demo").ok === false, "");
    check("minAppVersion 非法拒", core.validateManifest(goodManifest({ minAppVersion: "x" }), "demo").ok === false, "");
    check("styles 含 .. 拒", core.validateManifest(goodManifest({ styles: "../evil.css" }), "demo").ok === false, "");
    check("styles 绝对路径形态拒", core.validateManifest(goodManifest({ styles: "/etc/x.css" }), "demo").ok === false, "");
    check("styles 盘符形态拒", core.validateManifest(goodManifest({ styles: "C:\\x.css" }), "demo").ok === false, "");
    check("styles 自定义合法相对名通过", core.validateManifest(goodManifest({ styles: "skin/main.css" }), "demo").ok === true, "");
    // 64KB 上限（§12.1.1）
    const big = goodManifest({ description: "x".repeat(70 * 1024) });
    check("64KB 超限拒", core.validateManifest(big, "demo").ok === false, core.validateManifest(big, "demo").reason);
    check("JSON 解析失败拒", core.validateManifest("{oops", "demo").ok === false, "");
    check("非对象（数组）拒", core.validateManifest("[]", "demo").ok === false, "");
  }

  console.log("== 2) versions.json（readVersionsRule / latestCompatibleVersion） ==");
  {
    check("缺省合法（undefined → 按不存在）", core.readVersionsRule(undefined).exists === false, "");
    check("空串按不存在", core.readVersionsRule("  ").exists === false, "");
    check("非法 JSON 按不存在不报错", core.readVersionsRule("{bad").exists === false, "");
    check("数组按不存在", core.readVersionsRule("[]").exists === false, "");
    check("标量按不存在", core.readVersionsRule("42").exists === false, "");
    check("值非字符串按不存在", core.readVersionsRule('{"0.0.1": 3}').exists === false, "");
    const mixed = core.readVersionsRule(JSON.stringify({ "0.0.1": "1.0.0", "0.2.0": "2.0.0", bad: "x", "9.9.9": "0.5.0" }));
    check("合法与非法混排：文件算存在", mixed.exists === true, mixed);
    eq("混排时 semver 合法条目保留 3 条", mixed.entries.length, 3);
    eq("latestCompatible：0.0.1 与 0.2.0 ≤ 0.2.0，取最大 pluginVersion", core.latestCompatibleVersion(mixed, "0.2.0"), "2.0.0");
    eq("当前 0.0.1 时只有 0.0.1 条目参与", core.latestCompatibleVersion(mixed, "0.0.1"), "1.0.0");
    eq("无参与条目返回 null", core.latestCompatibleVersion(core.readVersionsRule('{"9.9.9": "0.5.0"}'), "0.0.1"), null);
    eq("不存在时返回 null", core.latestCompatibleVersion(core.readVersionsRule(undefined), "0.0.1"), null);
  }

  console.log("== 3) compareSemver ==");
  {
    eq("等", core.compareSemver("1.2.3", "1.2.3"), 0);
    eq("大于（patch）", core.compareSemver("1.2.4", "1.2.3"), 1);
    eq("小于（major）", core.compareSemver("0.9.9", "1.0.0"), -1);
    eq("位数不齐拒", core.compareSemver("1.2", "1.2.0"), null);
    eq("位数过多拒", core.compareSemver("1.2.3.4", "1.2.3"), null);
    eq("非数字段拒", core.compareSemver("1.x.3", "1.0.0"), null);
    eq("非字符串拒", core.compareSemver(42, "1.0.0"), null);
  }

  console.log("== 4) @settings 解析（受限 YAML 子集） ==");
  {
    const sepiaCss = readFixture("sepia-demo", "styles.css");
    const ps = core.parseSettingsBlock(sepiaCss);
    check("sepia-demo 正常块解析通过", ps.ok === true, ps.reason);
    eq("3 个可调项", ps.schema.length, 3);
    eq("引号剥除：color default 为裸 hex", ps.schema[0].default, "#f4ede1");
    eq("dropdown options 2 项（§10.2 夹具）", ps.schema[2].options.length, 2);
    eq("options value 引号剥除", ps.schema[2].options[1].value, "6px");
    check("无 @settings 块 → schema 空且合法", core.parseSettingsBlock("body { --paper: #fff; }").ok && core.parseSettingsBlock("body { --paper: #fff; }").schema.length === 0, "");

    const wrap = (block) => `/* @settings\n${block}\n*/\nbody { --paper: #fff; }`;
    const tabbed = wrap("name: x\nsettings:\n\t- id: a\n\t  type: color");
    check("Tab 缩进报错含行号", (() => {
      const r = core.parseSettingsBlock(tabbed);
      return !r.ok && /第 \d+ 行/.test(r.reason) && r.reason.includes("Tab");
    })(), core.parseSettingsBlock(tabbed).reason);
    check("流式集合 [...] 报错", !core.parseSettingsBlock(wrap('settings:\n  - id: a\n    name: x\n    type: color\n    default: [1, 2]')).ok, "");
    check("锚点报错", !core.parseSettingsBlock(wrap("name: &anchor x")).ok, "");
    check("未知顶层键报错", !core.parseSettingsBlock(wrap("whatever: 1")).ok, "");
    check("未知 type 报错", !core.parseSettingsBlock(wrap("settings:\n  - id: a\n    name: x\n    type: slider\n    default: 1")).ok, "");
    check("缺 default 报错", !core.parseSettingsBlock(wrap("settings:\n  - id: a\n    name: x\n    type: color")).ok, "");
    check("id 重复报错", !core.parseSettingsBlock(wrap("settings:\n  - id: a\n    name: x\n    type: color\n    default: \"#fff\"\n  - id: a\n    name: y\n    type: color\n    default: \"#000\"")).ok, "");
    const many = Array.from({ length: 25 }, (_, i) => `  - id: s${i}\n    name: 项${i}\n    type: text\n    default: "x"`).join("\n");
    check(">24 项报错", !core.parseSettingsBlock(wrap(`settings:\n${many}`)).ok, core.parseSettingsBlock(wrap(`settings:\n${many}`)).reason);
    check("24 项恰好通过", core.parseSettingsBlock(wrap(`settings:\n${Array.from({ length: 24 }, (_, i) => `  - id: s${i}\n    name: 项${i}\n    type: text\n    default: "x"`).join("\n")}`)).ok === true, "");
    check("range min/max 关系非法报错（min ≥ max）", !core.parseSettingsBlock(wrap("settings:\n  - id: a\n    name: x\n    type: range\n    default: 1\n    min: 2\n    max: 1")).ok, "");
    check("range step ≤ 0 报错", !core.parseSettingsBlock(wrap("settings:\n  - id: a\n    name: x\n    type: range\n    default: 1\n    min: 0\n    max: 2\n    step: 0")).ok, "");
    check("range step > max-min 报错", !core.parseSettingsBlock(wrap("settings:\n  - id: a\n    name: x\n    type: range\n    default: 1\n    min: 0\n    max: 1\n    step: 2")).ok, "");
    check("options value 重复报错", !core.parseSettingsBlock(wrap('settings:\n  - id: a\n    name: x\n    type: dropdown\n    default: "0"\n    options:\n      - label: 甲\n        value: "0"\n      - label: 乙\n        value: "0"')).ok, "");
    check("options 少于 2 项报错", !core.parseSettingsBlock(wrap('settings:\n  - id: a\n    name: x\n    type: dropdown\n    default: "0"\n    options:\n      - label: 甲\n        value: "0"')).ok, "");
    check("color default 非 hex 报错", !core.parseSettingsBlock(wrap("settings:\n  - id: a\n    name: x\n    type: color\n    default: red")).ok, "");
    check("两个 @settings 块报错", !core.parseSettingsBlock("/* @settings\nname: a\n*/\n/* @settings\nname: b\n*/").ok, core.parseSettingsBlock("/* @settings\nname: a\n*/\n/* @settings\nname: b\n*/").reason);
    check("注释行（# 开头）报错", !core.parseSettingsBlock(wrap("# 这是注释\nname: x")).ok, "");
    check("toggle default 布尔解析", (() => {
      const r = core.parseSettingsBlock(wrap("settings:\n  - id: a\n    name: x\n    type: toggle\n    default: true"));
      return r.ok && r.schema[0].default === true;
    })(), "");
    check("text default 引号剥除后为字符串", (() => {
      const r = core.parseSettingsBlock(wrap('settings:\n  - id: a\n    name: x\n    type: text\n    default: "你好"'));
      return r.ok && r.schema[0].default === "你好";
    })(), "");
  }

  console.log("== 5) CSS 校验器（fail-closed） ==");
  {
    const v = (css, id = "demo") => core.validateAndAuditCss(css, [], id);
    check("@import http 拒", !v('@import url("https://example.com/x.css");\nbody { --paper: #fafaf8; }').ok, "");
    check("@import 相对路径拒", !v('@import url("./x.css");\nbody { --paper: #fafaf8; }').ok, "");
    check("@import 大小写拒（@Import）", !v('body { background: url(x) }\n@IMPORT "y.css";\nbody { --paper: #fafaf8; }').ok, "");
    check("url(http) 拒", !v('body { background: url(http://x/y.png); --paper: #fafaf8; }').ok, "");
    check("url(javascript:) 拒", !v('body { background: url(javascript:alert(1)); --paper: #fafaf8; }').ok, "");
    check("url(data:image/png;base64,…) 过", v('body { background: url(data:image/png;base64,iVBORw0KGgo=); --paper: #fafaf8; }').ok === true, v('body { background: url(data:image/png;base64,iVBORw0KGgo=); --paper: #fafaf8; }').reason);
    check("注释内禁忌串忽略", v('/* 示例：@import url("https://x") 仅供参考 */\nbody { --paper: #fafaf8; }').ok === true, "");
    check("组合选择器拒（body, body.theme-dark）", !v("body, body.theme-dark { --paper: #fafaf8; }").ok, "");
    check("组合选择器拒（:root, .x）", !v(":root, .x { --paper: #fafaf8; }").ok, "");
    check("纯组件组合选择器不受限", v(".a, .b { color: red; }").ok === true, "");
    check("受审计 Token 用 var(--pl-外部前缀) 拒", !v('body { --paper: var(--pl-other-pl-x, #fafaf8); }').ok, "");
    check("受审计 Token 引用其他 var 拒（--text-primary: var(--ink)）", !v("body { --text-primary: var(--ink); }").ok, "");
    check("受审计 Token color-mix 拒", !v("body { --accent: color-mix(in srgb, #fff 50%, #000); --accent-on: #fff; }").ok, "");
    check("受审计 Token 命名色拒", !v("body { --paper: white; }").ok, "");
    check("回退非 hex 拒", !v("body { --paper: var(--pl-demo-x, 0); }").ok, "");
    check("512KB 超限拒", !v(`body { --paper: #fafaf8; /* ${"x".repeat(520 * 1024)} */ }`).ok, "");
    check("var 回退形态合法通过", v('body { --paper: var(--pl-demo-tint, #fafaf8); --accent: #166a59; --accent-on: #ffffff; }').ok === true, "");
    check("非档位选择器内 Token 不受形态审计", v(".card { --paper: var(--other); }").ok === true, "");
  }

  console.log("== 5b) 转义绕路封死（P0-1 反斜杠 fail-closed）+ 字符串感知（P1-1） ==");
  {
    const v = (css, id = "demo") => core.validateAndAuditCss(css, [], id);
    // 审查实证的绕路样本矩阵：全部拒载，理由可读（含「反斜杠」与行号）。所有 CSS 转义序列都以字面
    // 反斜杠开头（\70 十六进制转义等）——ban 反斜杠即封闭整类绕路，无需复刻 tokenizer 解码。
    const bypasses = [
      ['@im\\70 ort "https://evil.com/x.css";\nbody { --paper: #fafaf8; }', "import 十六进制转义"],
      ['body { background: u\\72 l(https://evil.com/x.png); --paper: #fafaf8; }', "url 十六进制转义"],
      ['body { background: \\75rl(javascript:alert(1)); --paper: #fafaf8; }', "url 转义 + javascript:"],
      ['@im\\70 ort url("data:image/png;base64,iVBORw0KGgo=");', "import 转义（url 内容即使合法仍拒）"],
      ['body { content: "\\7D"; --ink: #777777; }', "转义右花括号藏低对比声明"],
      ['/* 路径 C:\\notes\\x 仅注释含反斜杠 */\nbody { --paper: #fafaf8; }', "注释内反斜杠也拒（最简 fail-closed）"]
    ];
    for (const [css, label] of bypasses) {
      const r = v(css);
      check(`绕路样本拒载：${label}`, r.ok === false && r.reason.includes("反斜杠") && /第 \d+ 行/.test(r.reason), r.reason);
    }
    // P1-1：引号串内的 }/{//* 不得干扰块边界与注释剥离——隐藏的受审计声明仍被对比度审计命中
    const hideClose = v('body { content: "}"; --ink: #777777; }');
    check('content: "}" 藏不住逃逸声明（串内 } 不结束块 → 浅档对比度审计仍拒载）', !hideClose.ok && hideClose.reason.includes("浅档"), hideClose.reason);
    const hideOpen = v('.x { content: "{"; } body{--ink:#777}');
    check('content: "{" 藏不住后续档位块（串内 { 不开嵌套 → body 块仍被审计拒载）', !hideOpen.ok && hideOpen.reason.includes("浅档"), hideOpen.reason);
    const hideComment = v('body { content: "/*"; } /* 夹注 */ body.theme-dark { --ink: #777777; --paper: #101010; }');
    check('content: "/*" 不产生幽灵注释（串内 /* 不剥注释 → 深档块仍被审计拒载）', !hideComment.ok && hideComment.reason.includes("深档"), hideComment.reason);
    const strOk = v('body { content: "}{/*"; --paper: #fafaf8; }');
    check("合法引号串（含 }{/* 字符）不误伤：结构完整、审计通过", strOk.ok === true, strOk.reason);
    const unclosed = v('body { content: "unclosed; } body.theme-dark { --ink: #777777; }');
    check("未闭合引号串拒载（fail-closed，理由含行号）", !unclosed.ok && unclosed.reason.includes("未闭合") && /第 \d+ 行/.test(unclosed.reason), unclosed.reason);
  }

  console.log("== 6) 对比度审计 ==");
  {
    // sepia-demo 全对过：比值与设计稿 §6.6 预计算一致（±0.05 容差——预计算为 4 舍 5 入/截断混用，
    // 以 §6.6 公式实算为准：浅 11.15/5.78/6.73/7.29，深 13.19/7.54/7.54/7.41）
    const sepiaCss = readFixture("sepia-demo", "styles.css");
    const ps = core.parseSettingsBlock(sepiaCss);
    const va = core.validateAndAuditCss(sepiaCss, ps.schema, "sepia-demo");
    check("sepia-demo 审计通过", va.ok === true, va.reason);
    const expect = [
      ["light", "ink 对 paper", 11.15],
      ["light", "accent 对 paper", 5.78],
      ["light", "accent-on 对 accent", 6.73],
      ["light", "text-secondary 对 paper", 7.29],
      ["dark", "ink 对 paper", 13.19],
      ["dark", "accent 对 paper", 7.54],
      ["dark", "accent-on 对 accent", 7.54],
      ["dark", "text-secondary 对 paper", 7.41]
    ];
    for (const [mode, label, want] of expect) {
      const got = (va.ratios || []).find((r) => r.mode === mode && r.label === label);
      check(`sepia ${mode} ${label} ≈ ${want}:1 且 ≥4.5`, got && Math.abs(got.ratio - want) < 0.05 && got.ratio >= 4.5, got && got.ratio);
    }
    // broken-theme 夹具拒载且信息含比值（设计稿预写 2.31:1 系笔误——#b0b0b0 对 #8a4b2a 按公式实算 3.10:1，
    // 拒载判据不受影响；此处断言「含 X.XX:1 < 4.5:1 的实际比值」）
    const brokenCss = readFixture("broken-theme", "styles.css");
    const vb = core.validateAndAuditCss(brokenCss, [], "broken-theme");
    check("broken-theme 拒载", vb.ok === false, vb.reason);
    check("拒载原因含实际比值与阈值（X.XX:1 < 4.5:1）", /\d+\.\d{2}:1 < 4\.5:1/.test(vb.reason || ""), vb.reason);
    eq("broken-theme 实际比值 = 3.10:1", (vb.reason.match(/(\d+\.\d{2}):1 < 4\.5:1/) || [])[1], "3.10");
    // 只声明深档：浅档不审计（浅档未被改动，基线天然达标——§6.6「只审计被触碰的档」）
    const darkOnlyOk = core.validateAndAuditCss("body.theme-dark { --ink: #888888; --paper: #101010; }", [], "demo");
    check("只声明深档时浅档不审计（深档自身达标即整体通过）", darkOnlyOk.ok === true, darkOnlyOk.reason);
    // 被触碰的档自身仍被审计：浅档低对比构造必须拒载
    const lightLow = core.validateAndAuditCss("body { --ink: #777777; --paper: #fafaf8; }", [], "demo");
    check("被触碰的浅档低对比构造拒载", lightLow.ok === false && lightLow.reason.includes("浅档"), lightLow.reason);
    const darkFail = core.validateAndAuditCss("body.theme-dark { --ink: #777777; --paper: #101010; }", [], "demo");
    check("被触碰的深档低对比构造拒载", darkFail.ok === false && darkFail.reason.includes("深档"), darkFail.reason);
    // accent 缺 accent-on 拒（配对规则，同块）
    const missingOn = core.validateAndAuditCss("body { --accent: #166a59; }", [], "demo");
    check("声明 --accent 缺同块 --accent-on 拒", missingOn.ok === false && missingOn.reason.includes("--accent-on"), missingOn.reason);
    // 基线默认值自身达标（浅/深两档默认全对过——守护 MODE_DEFAULTS 与 theme.css 现值一致）
    check("浅档基线默认全对过", core.auditContrast({ light: core.MODE_DEFAULTS.light }, core.MODE_DEFAULTS).ok === true, "");
    check("深档基线默认全对过", core.auditContrast({ dark: core.MODE_DEFAULTS.dark }, core.MODE_DEFAULTS).ok === true, "");
  }

  console.log("== 7) assembleVars（读侧归一） ==");
  {
    const schema = [
      { id: "t", name: "开关", type: "toggle", default: true },
      { id: "r", name: "缩放", type: "range", default: 1.0, min: 0.8, max: 1.6, step: 0.05 },
      { id: "d", name: "圆角", type: "dropdown", default: "0", options: [{ label: "直角", value: "0" }, { label: "6px", value: "6px" }] },
      { id: "c", name: "纸色", type: "color", default: "#f4ede1" },
      { id: "x", name: "文本", type: "text", default: "" }
    ];
    const run = (values) => {
      const out = core.assembleVars(schema, values);
      return Object.fromEntries(out.map((v) => [v.key, v.value]));
    };
    eq("缺省合并 default（toggle）", run({}).t, "true");
    eq("缺省合并 default（range）", run({}).r, "1");
    eq("缺省合并 default（dropdown）", run({}).d, "0");
    eq("range 越界上钳", run({ r: 9 }).r, "1.6");
    eq("range 越界下钳", run({ r: -3 }).r, "0.8");
    eq("range 数值串接受", run({ r: "1.2" }).r, "1.2");
    eq("dropdown 非法值丢弃取 default", run({ d: "99px" }).d, "0");
    eq("dropdown 数字脏值经 String 后 ∈ options 接受（0→\"0\"）", run({ d: 0 }).d, "0");
    eq("dropdown 数字脏值不在 options 内回落 default", run({ d: 6 }).d, "0");
    eq("dropdown 合法字符串保留", run({ d: "6px" }).d, "6px");
    eq("color 非 hex 丢弃取 default", run({ c: "red" }).c, "#f4ede1");
    eq("color 合法保留", run({ c: "#ABC" }).c, "#ABC");
    eq("text 截 100", run({ x: "字".repeat(120) }).x.length, 100);
    eq("text 合法保留", run({ x: "你好" }).x, "你好");
    eq("脏类型（对象）丢弃取 default", run({ t: { a: 1 }, r: [1], d: {}, c: [], x: null }).t, "true");
    eq("toggle false 显式生效", run({ t: false }).t, "false");
    eq("range 脏串丢弃取 default", run({ r: "abc" }).r, "1");
    // 全脏输入（settings.json 被手改）整体不炸
    check("数组/标量整体入参不炸", core.assembleVars(schema, [1, 2]).length === schema.length && core.assembleVars(schema, "x").length === schema.length, "");
  }

  console.log("== 8) nextAppearanceState 互斥矩阵 ==");
  {
    const base = { skinId: "none", activeThemePlugin: "" };
    eq("激活插件 → skinId 归 none", JSON.stringify(core.nextAppearanceState(base, { type: "activate-plugin", id: "sepia-demo" })), JSON.stringify({ skinId: "none", activeThemePlugin: "sepia-demo" }));
    eq("已互斥时重复激活幂等", JSON.stringify(core.nextAppearanceState({ skinId: "none", activeThemePlugin: "sepia-demo" }, { type: "activate-plugin", id: "sepia-demo" })), JSON.stringify({ skinId: "none", activeThemePlugin: "sepia-demo" }));
    eq("换激活另一插件仍互斥", JSON.stringify(core.nextAppearanceState({ skinId: "none", activeThemePlugin: "a" }, { type: "activate-plugin", id: "b" })), JSON.stringify({ skinId: "none", activeThemePlugin: "b" }));
    eq("选非 none 皮肤 → 插件激活清空", JSON.stringify(core.nextAppearanceState({ skinId: "none", activeThemePlugin: "sepia-demo" }, { type: "select-skin", id: "paper" })), JSON.stringify({ skinId: "paper", activeThemePlugin: "" }));
    eq("选 none 皮肤只归位皮肤槽（停用插件走 deactivate）", JSON.stringify(core.nextAppearanceState({ skinId: "paper", activeThemePlugin: "sepia-demo" }, { type: "select-skin", id: "none" })), JSON.stringify({ skinId: "none", activeThemePlugin: "sepia-demo" }));
    eq("deactivate-plugin 清插件槽", JSON.stringify(core.nextAppearanceState({ skinId: "none", activeThemePlugin: "sepia-demo" }, { type: "deactivate-plugin" })), JSON.stringify({ skinId: "none", activeThemePlugin: "" }));
    eq("deactivate 幂等", JSON.stringify(core.nextAppearanceState({ skinId: "none", activeThemePlugin: "" }, { type: "deactivate-plugin" })), JSON.stringify({ skinId: "none", activeThemePlugin: "" }));
    eq("未知动作原样返回", JSON.stringify(core.nextAppearanceState(base, { type: "nope" })), JSON.stringify(base));
    eq("脏入参（null state）回落默认", JSON.stringify(core.nextAppearanceState(null, { type: "deactivate-plugin" })), JSON.stringify({ skinId: "none", activeThemePlugin: "" }));
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((err) => {
  console.error("pluginhost.test.cjs 顶层异常：", err);
  process.exit(1);
});
