#!/usr/bin/env node
// 一致性机器闸门（C-35b，报告 C-35 修复步骤 2）。纯 Node、无依赖、亚秒级。
// 失败时退出码 1，并逐条打印「文件:行 规则 修法」。
//
// 8 条规则（报告 C-35 规则表）：
//   1. src CSS 无未定义 Token（同 F09 E1 + setProperty 豁免；CSS 注释先剥离——注释里的
//      示例代码不算引用，报告快照后新出现的注释假阳性不据此放宽基线）。
//   2. 业务代码不写颜色字面量（#hex / rgb(a)( / hsl(a)(，跳过注释行）；
//      COLOR_ALLOW 豁免写在脚本顶部；其余文件按「文件 → 次数」棘轮。
//   3. !important 与内联 <svg> 只许变少（棘轮）。
//   4. 动效时长不写死在 JS/TS（C-32 已完成 → 目标 0）。
//   5. 编辑器白名单（docs/EDIT-CONTRACT.md：textarea 白名单 / contentEditable=0 /
//      ReactMarkdown 仅 ReadMarkdown.tsx；C-34 已完成 → 硬检查）。
//   6. 含 key === "Enter" 的文件必须同时含 isImeComposing（C-27 已完成 → 目标 0）。
//      已知例外（EDIT-CONTRACT.md 登记）：src/lib/dialogA11y.ts 的 document 级 Esc
//      处理器无 IME 守卫——该文件不含 Enter 分支，本规则天然不涉及；不得据弹窗层路径
//      报组件级违规。
//   7. :hover 里把 opacity 设为 1 的规则，目标类必须是 .reveal-on-hover
//      （C-36 引入前按棘轮运行）。
//   8. 子进程调用 skin-audit 与 i18n-check，任一退出码非 0 即失败。
//
// 基线 scripts/consistency-baseline.json 只允许变小：
//   当前值 < 基线 → 提示 `node scripts/consistency-check.mjs --update-baseline` 收紧；
//   当前值 > 基线 → 失败（不提供任何「放宽」参数）。
"use strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_FILE = path.join(ROOT, "scripts", "consistency-baseline.json");
const UPDATE = process.argv.includes("--update-baseline");

// —— 规则 2 豁免：本来就「应该」含颜色值的文件（报告 C-35 证据 3）——
const COLOR_ALLOW = [
  /^src\/skins\/[^/]+\/manifest\.ts$/,
  /^src\/lib\/accentVar\.ts$/,
  /^src\/lib\/reader\/foliate\/appearance\.ts$/,
];
const isColorAllowed = (rel) => COLOR_ALLOW.some((re) => re.test(rel));

// —— 规则 5 白名单：docs/EDIT-CONTRACT.md「保留的裸 <textarea> 白名单」（C-34d 登记，
//     含批注两处补登）——清单之外出现新 <textarea> 即违规。
const TEXTAREA_WHITELIST = [
  "src/components/SelectionPanels.tsx",
  "src/components/SelectionMenu.tsx",
  "src/components/learner/SelfExplainDialog.tsx",
  "src/components/editor/OcclusionEditor.tsx",
  "src/components/AIPanel.tsx",
  "src/components/AnswerJudgeModal.tsx",
  "src/components/editor/CardFields.tsx",
  "src/components/AnnotationEditor.tsx",
  "src/components/reader/AnnotationPanel.tsx",
];
const REACTMARKDOWN_ALLOW = "src/components/editor/ReadMarkdown.tsx";

// —— 规则 4 范围（报告 C-35 规则表第 4 条）——
const DURATION_SCOPES = ["src/lib/mindmap/", "src/components/reader/mindmap/", "src/components/reader/MindmapLens.tsx"];
const isDurationScope = (rel) => DURATION_SCOPES.some((s) => rel.startsWith(s) || rel === s);

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
const relOf = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const lineAt = (text, idx) => text.slice(0, idx).split("\n").length;
const stripCssComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "");
/** 跳过注释行：整行以 // 、/* 或块注释续行 * 开头 */
const isCommentLine = (line) => {
  const s = line.trimStart();
  return s.startsWith("//") || s.startsWith("/*") || s.startsWith("*");
};

const tsFiles = walk(path.join(ROOT, "src"), (n) => /\.(ts|tsx)$/.test(n)).sort();
const cssFiles = walk(path.join(ROOT, "src"), (n) => n.endsWith(".css")).sort();
const tsx = tsFiles.map((p) => ({ p: relOf(p), t: fs.readFileSync(p, "utf8") }));
const css = cssFiles.map((p) => ({ p: relOf(p), t: fs.readFileSync(p, "utf8") }));

/** @type {{loc:string, rule:string, fix:string}[]} */
const violations = [];
const fail = (loc, rule, fix) => violations.push({ loc, rule, fix });

// ---------- 规则 1：无未定义 Token（同 F09 E1 + setProperty 豁免，注释已剥离） ----------
{
  const allCss = css.map((c) => stripCssComments(c.t)).join("\n");
  const defined = new Set([...allCss.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const setProp = new Set([...tsx.map((f) => f.t).join("\n").matchAll(/setProperty\(\s*[`'"](--[\w-]+)/g)].map((m) => m[1]));
  for (const c of css) {
    const text = stripCssComments(c.t);
    for (const m of text.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
      const [, name, sep] = m;
      if (defined.has(name) || sep === "," || setProp.has(name)) continue;
      fail(`${c.p}:${lineAt(c.t, m.index)}`, "规则1 未定义Token", `var(${name}) 无定义且无回落——改用既有 Token 或补定义（TS setProperty 注入的 Token 已豁免）`);
    }
  }
}

// ---------- 规则 2：业务代码不写颜色字面量（按文件棘轮） ----------
const colorPerFile = {};
{
  const hexRe = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|\brgba?\(|\bhsla?\(/g;
  for (const f of tsx) {
    if (isColorAllowed(f.p)) continue;
    const lines = f.t.split("\n");
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      if (isCommentLine(lines[i])) continue;
      hexRe.lastIndex = 0;
      let m;
      while ((m = hexRe.exec(lines[i]))) hits.push(i + 1);
    }
    if (hits.length) colorPerFile[f.p] = hits;
  }
}
const colorCounts = Object.fromEntries(Object.entries(colorPerFile).map(([k, v]) => [k, v.length]));

// ---------- 规则 3：!important 与内联 <svg> 只许变少 ----------
const importantCount = (css.map((c) => c.t).join("\n").match(/!important/g) || []).length;
const inlineSvgCount = (tsx.map((f) => f.t).join("\n").match(/<svg[\s>]/g) || []).length;

// ---------- 规则 4：动效时长不写死（C-32 后目标 0） ----------
{
  const durRe = /\b\w*(DUR|DURATION|ANIM)\w*\b\s*[:=]\s*-?\d|\bduration\s*:\s*-?\d/g;
  for (const f of tsx) {
    if (!isDurationScope(f.p)) continue;
    const lines = f.t.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (isCommentLine(lines[i])) continue;
      durRe.lastIndex = 0;
      if (durRe.test(lines[i])) fail(`${f.p}:${i + 1}`, "规则4 动效时长写死", "改用动效 Token（theme.css :root 的 --mm-move/--mm-enter/--mm-exit，经 animate.readMotion() 读取）");
    }
  }
}

// ---------- 规则 5：编辑器白名单（C-34 后硬检查） ----------
{
  for (const f of tsx) {
    const lines = f.t.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (isCommentLine(lines[i])) continue; // 注释里的示例/措辞不算（commands.ts 头注提到 contentEditable 属文档措辞）
      if (lines[i].includes("<textarea") && !TEXTAREA_WHITELIST.includes(f.p)) {
        fail(`${f.p}:${i + 1}`, "规则5 textarea白名单", "卡片/摘录内容编辑用 MdField/ClozeField（CardFields.tsx）；确需裸 textarea 须先在 docs/EDIT-CONTRACT.md 白名单登记");
      }
      if (/contentEditable/.test(lines[i])) {
        fail(`${f.p}:${i + 1}`, "规则5 contentEditable", "contentEditable 裸壳已退役（C-34）——用 EditableField（读态渲染 + 点击进入编辑）");
      }
      if (lines[i].includes("<ReactMarkdown") && f.p !== REACTMARKDOWN_ALLOW) {
        fail(`${f.p}:${i + 1}`, "规则5 ReactMarkdown", "markdown 读态渲染统一走 src/components/editor/ReadMarkdown.tsx（sanitize + GFM）");
      }
    }
  }
}

// ---------- 规则 6：Enter 分支必须带 IME 守卫（C-27 后目标 0） ----------
{
  for (const f of tsx) {
    if (!/key\s*===\s*["']Enter["']/.test(f.t)) continue;
    if (!f.t.includes("isImeComposing")) {
      fail(f.p, "规则6 IME守卫", "onKeyDown 首行加 if (isImeComposing(e)) return;（src/lib/ime.ts，C-27 同款）");
    }
  }
}

// ---------- 规则 7：:hover 设 opacity:1 必须是 .reveal-on-hover（C-36 前棘轮） ----------
let hoverOpacityCount = 0;
{
  const blockRe = /([^{}]+)\{([^{}]*)\}/g;
  for (const c of css) {
    const text = stripCssComments(c.t);
    let m;
    while ((m = blockRe.exec(text))) {
      const selector = m[1];
      const body = m[2];
      if (!/:hover/.test(selector)) continue;
      if (!/opacity\s*:\s*1(?![\d.])/i.test(body)) continue;
      if (selector.includes("reveal-on-hover")) continue;
      hoverOpacityCount++;
    }
  }
}

// ---------- 规则 8：皮肤审计 + i18n（子进程） ----------
const subAudits = [];
{
  for (const script of ["scripts/skin-audit.mjs", "scripts/i18n-check.mjs"]) {
    const r = spawnSync(process.execPath, [path.join(ROOT, script)], { encoding: "utf8" });
    subAudits.push({ script, ok: r.status === 0, out: `${r.stdout || ""}${r.stderr || ""}`.trim() });
    if (r.status !== 0) {
      fail(script, "规则8 子审计", `${script} 退出码 ${r.status}——先单独运行该脚本看逐条输出（存量红按归属处理，不在本闸门内代修）`);
    }
  }
}

// ---------- 基线对比（棘轮：只许变小） ----------
let baseline = {};
if (fs.existsSync(BASELINE_FILE)) {
  try { baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8")); } catch { baseline = {}; }
}
const ratchetKeys = [];
/** 记录一条棘轮键：name → 当前值。返回违规与否 */
function ratchet(name, current, hint) {
  ratchetKeys.push([name, current]);
  const base = baseline[name];
  if (base === undefined || typeof base !== "number") {
    if (!UPDATE) fail(`scripts/consistency-baseline.json:${name}`, "规则基线缺失", `用 node scripts/consistency-check.mjs --update-baseline 建立基线（当前 ${current}）`);
    return;
  }
  if (current > base) {
    fail(`scripts/consistency-baseline.json:${name}`, "规则棘轮回退", `${name} 当前 ${current} > 基线 ${base}——${hint}`);
  }
}
ratchet("importantCount", importantCount, "回收新增的 !important（每处都要写受控例外）");
ratchet("inlineSvgCount", inlineSvgCount, "内联 <svg> 改走 src/components/icons.tsx 图标函数");
ratchet("hoverOpacityCount", hoverOpacityCount, "新增 hover 显形改用 .reveal-on-hover（C-36）；存量 4 处待 C-36 收编");

for (const [file, count] of Object.entries(colorCounts)) {
  const base = baseline.colorLiterals?.[file];
  if (base === undefined || typeof base !== "number") {
    for (const line of colorPerFile[file]) {
      fail(`${file}:${line}`, "规则2 颜色字面量(新文件)", `该文件有 ${count} 处颜色字面量且无基线——改用设计 Token，或（仅限豁免口径）加入 COLOR_ALLOW`);
    }
  } else if (count > base) {
    for (const line of colorPerFile[file]) {
      fail(`${file}:${line}`, "规则2 颜色字面量", "改用设计 Token（--surface-*/--text-*/--border-* 族）；确属皮肤清单/强调色计算/EPUB 注入的合法色值须加入 COLOR_ALLOW");
    }
  }
}
for (const [file, base] of Object.entries(baseline.colorLiterals || {})) {
  if (!(file in colorCounts) && base > 0) {
    // 文件消失 → 违规自然消失；--update-baseline 时把该文件移出基线（只许变小）
  }
}

// ---------- 收紧提示 ----------
const tighten = [];
if (importantCount < (baseline.importantCount ?? Infinity)) tighten.push(`importantCount ${baseline.importantCount} → ${importantCount}`);
if (inlineSvgCount < (baseline.inlineSvgCount ?? Infinity)) tighten.push(`inlineSvgCount ${baseline.inlineSvgCount} → ${inlineSvgCount}`);
if (hoverOpacityCount < (baseline.hoverOpacityCount ?? Infinity)) tighten.push(`hoverOpacityCount ${baseline.hoverOpacityCount} → ${hoverOpacityCount}`);
for (const [file, base] of Object.entries(baseline.colorLiterals || {})) {
  const cur = colorCounts[file] ?? 0;
  if (cur < base) tighten.push(`colorLiterals[${file}] ${base} → ${cur}`);
}

// ---------- --update-baseline ----------
if (UPDATE) {
  const next = {
    ...baseline,
    importantCount,
    inlineSvgCount,
    hoverOpacityCount,
    colorLiterals: colorCounts,
  };
  // 只许变小：与现有基线逐键比较，任何变大都拒绝
  let relax = false;
  const relaxKeys = [];
  const cmp = (name, cur) => {
    if (typeof baseline[name] === "number" && cur > baseline[name]) { relax = true; relaxKeys.push(`${name} ${baseline[name]} → ${cur}`); }
  };
  cmp("importantCount", importantCount);
  cmp("inlineSvgCount", inlineSvgCount);
  cmp("hoverOpacityCount", hoverOpacityCount);
  // 基线已存在时，新出现的非零颜色文件不得写入基线（那是放宽——去修代码或走 COLOR_ALLOW）
  if (baseline.colorLiterals) {
    for (const [file, cur] of Object.entries(colorCounts)) {
      if (typeof baseline.colorLiterals[file] !== "number") { relax = true; relaxKeys.push(`colorLiterals[${file}] （新增）→ ${cur}`); }
      else cmp(`colorLiterals[${file}]`, cur);
    }
  }
  if (relax) {
    console.error("[consistency] 拒绝更新基线——检测到放宽（基线只允许变小）：");
    for (const k of relaxKeys) console.error(`  - ${k}`);
    process.exit(1);
  }
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(next, null, 2) + "\n");
  console.log(`[consistency] 基线已写入 ${path.relative(ROOT, BASELINE_FILE)}`);
  for (const t of tighten) console.log(`[consistency] 收紧：${t}`);
  if (!tighten.length) console.log("[consistency] 基线与当前值一致，无变化。");
  process.exit(0);
}

// ---------- 输出 ----------
const subOk = subAudits.every((s) => s.ok);
console.log(`[consistency] 规则1 未定义Token = ${violations.filter((v) => v.rule.startsWith("规则1")).length}`);
console.log(`[consistency] 规则2 颜色字面量文件数 = ${Object.keys(colorCounts).length}（豁免口径外）`);
console.log(`[consistency] 规则3 !important = ${importantCount} / 内联<svg> = ${inlineSvgCount}`);
console.log(`[consistency] 规则4 动效时长写死 = ${violations.filter((v) => v.rule.startsWith("规则4")).length}`);
console.log(`[consistency] 规则5 编辑器白名单违规 = ${violations.filter((v) => v.rule.startsWith("规则5")).length}`);
console.log(`[consistency] 规则6 IME守卫缺失 = ${violations.filter((v) => v.rule.startsWith("规则6")).length}`);
console.log(`[consistency] 规则7 hover-opacity 棘轮 = ${hoverOpacityCount}（C-36 收编目标 .reveal-on-hover）`);
console.log(`[consistency] 规则8 子审计 skin-audit=${subAudits[0].ok ? "OK" : "FAIL"} / i18n-check=${subAudits[1].ok ? "OK" : "FAIL"}`);

if (violations.length) {
  console.error(`\n[consistency] ${violations.length} 处违规：`);
  for (const v of violations) console.error(`  ${v.loc} ${v.rule} —— ${v.fix}`);
  process.exit(1);
}
if (tighten.length) {
  console.log("\n[consistency] 棘轮可收紧（只许变小）：node scripts/consistency-check.mjs --update-baseline");
  for (const t of tighten) console.log(`  - ${t}`);
}
console.log("[consistency] OK");
process.exit(0);
