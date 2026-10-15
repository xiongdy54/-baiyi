#!/usr/bin/env node
// 皮肤机器审计（v49.0 / D170；不变量 A2–A6 的机器化，方案 §2 skin-audit 检查项）
// 用法：node scripts/skin-audit.mjs [skinId ...]   （缺省审计 src/skins/ 下所有含 .css 的皮肤）
// 检查项（对每个 src/skins/<id>/*.css）：
//   1 无网络资源（@import / url(http / url(//）            —— A2
//   2 var(--x) 引用都有声明（theme.css 或本皮肤 CSS）       —— A5（IACVT）
//   3 浅色块声明的颜色 Token 深色块也要声明                 —— A4
//   4 对比度 ≥ 4.5:1（正文/辅助文字/accent 配对）           —— A3
//   5 动效规则都挂 body.motion-full（::view-transition-* 例外）—— A6
//   6 @keyframes 名以 skin-<id>- 开头
//   7 单皮肤 CSS ≤ 60KB                                    —— A7
// 退出码：0 = 全部通过；1 = 存在违规。
"use strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKINS_DIR = path.join(ROOT, "src", "skins");
const THEME = fs.readFileSync(path.join(ROOT, "src", "theme.css"), "utf8");
const LIMIT_BYTES = 60 * 1024;

// ---------- CSS 解析辅助 ----------
/** 剥掉注释（字符串感知从简：皮肤 CSS 约定不在字符串里写注释符） */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 提取顶层/嵌套规则为 { selector, body }；@media/@layer 等展开其内部规则并前缀条件 */
function parseRules(css, prefix = "", acc = []) {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  // 简化：只处理一层嵌套（@media { sel {} }）——皮肤 CSS 约定不写更深嵌套
  let rest = css;
  while ((m = re.exec(rest))) {
    const sel = m[1].trim();
    const body = m[2];
    if (/^@(media|supports|layer|scope)\b/.test(sel)) {
      parseRules(body, sel, acc);
    } else {
      acc.push({ selector: sel, body, context: prefix });
    }
  }
  return acc;
}

// ---------- 颜色与对比度 ----------
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? 1 : 2;
  return [0, 1, 2].map((i) => parseInt(h.slice(i * n, i * n + n === 1 ? i + 1 : i * 2 + 2), 16) / (n === 1 ? 15 : 255));
}
function parseColor(s) {
  s = s.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(s)) {
    const [r, g, b] = hexToRgb(s);
    const a = s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  let m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: p[0] / 255, g: p[1] / 255, b: p[2] / 255, a: p[3] ?? 1 };
  }
  return null;
}
/** alpha 混合到背景 */
function blend(fg, bg) {
  const a = fg.a ?? 1;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
  };
}
function relLum({ r, g, b }) {
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a, b) {
  const la = relLum(a), lb = relLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 解析 Token 值：递归展开 var(--x, fallback)（fallback 可为空）；返回字面值（color-mix 原样返回） */
function resolveToken(name, scopes) {
  for (const scope of scopes) {
    if (scope.has(name)) {
      let v = scope.get(name).trim();
      // 展开 var()
      v = v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (_, n, fb) => {
        for (const sc of scopes) if (sc.has(n)) return sc.get(n).trim();
        return (fb ?? "").trim();
      });
      return v;
    }
  }
  return null;
}

// ---------- 主流程 ----------
function auditSkin(skinId, cssFiles) {
  const problems = [];
  const allCss = cssFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const totalBytes = cssFiles.reduce((n, f) => n + fs.statSync(f).size, 0);
  const clean = stripComments(allCss);

  // 7 体积（A7）
  if (totalBytes > LIMIT_BYTES) problems.push(`[A7] CSS 体积 ${totalBytes}B > ${LIMIT_BYTES}B`);

  // 1 网络资源（A2）
  if (/@import\b/i.test(clean)) problems.push("[A2] 出现 @import");
  if (/url\(\s*['"]?(https?:)?\/\//i.test(clean)) problems.push("[A2] 出现网络 url()");

  // 6 keyframes 命名空间
  for (const m of clean.matchAll(/@keyframes\s+([\w-]+)/g)) {
    if (!m[1].startsWith(`skin-${skinId}-`)) problems.push(`[命名空间] @keyframes ${m[1]} 未以 skin-${skinId}- 开头`);
  }

  // 2 IACVT（A5）：声明集合 = theme.css + 本皮肤
  const defined = new Set(
    [...(THEME + clean).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])
  );
  for (const m of clean.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
    if (!defined.has(m[1]) && m[2] === ")") problems.push(`[A5] var(${m[1]}) 无声明且无 fallback（IACVT）`);
  }

  // 规则化（供 3/4/5）
  const rules = parseRules(clean);
  const isLightSel = (s) => new RegExp(`body\\.skin-${skinId}(?![-\\w])(?!\\.theme-dark)`).test(s);
  const isDarkSel = (s) => new RegExp(`body\\.skin-${skinId}\\.theme-dark`).test(s);

  // 3 两档完整（A4）：浅色块声明的颜色类 Token，深色块也要有
  const lightBlock = rules.filter((r) => isLightSel(r.selector));
  const darkBlock = rules.filter((r) => isDarkSel(r.selector));
  const colorish = (v) => /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|color-mix\(/i.test(v);
  const lightColors = new Set();
  for (const r of lightBlock) {
    for (const d of r.body.split(";")) {
      const m = d.match(/^\s*(--[\w-]+)\s*:\s*(.+)$/);
      if (m && colorish(m[2])) lightColors.add(m[1]);
    }
  }
  const darkColors = new Set();
  for (const r of darkBlock) {
    for (const d of r.body.split(";")) {
      const m = d.match(/^\s*(--[\w-]+)\s*:\s*(.+)$/);
      if (m && colorish(m[2])) darkColors.add(m[1]);
    }
  }
  for (const t of lightColors) {
    if (!darkColors.has(t)) problems.push(`[A4] Token ${t} 浅色块有声明、深色块缺失`);
  }

  // 4 对比度（A3）：解析两档 Token 最终值
  const buildScope = (selPred) => {
    const scope = new Map();
    // theme.css 的 :root 与 body 层先入栈（皮肤覆盖其上）
    for (const r of parseRules(stripComments(THEME))) {
      if (/^:root$|^body(\.theme-dark)?$/.test(r.selector.replace(/\s+/g, ""))) {
        for (const d of r.body.split(";")) {
          const m = d.match(/^\s*(--[\w-]+)\s*:\s*(.+)$/);
          if (m) scope.set(m[1], m[2]);
        }
      }
    }
    for (const r of rules) {
      if (selPred(r.selector)) {
        for (const d of r.body.split(";")) {
          const m = d.match(/^\s*(--[\w-]+)\s*:\s*(.+)$/);
          if (m) scope.set(m[1], m[2]);
        }
      }
    }
    return scope;
  };
  const pairs = [
    ["--ink", "--paper"], ["--ink", "--surface-card"], ["--text-secondary", "--paper"],
    ["--grey-3", "--paper"], ["--grey-3", "--grey-1"], ["--grey-3", "--surface-overlay"],
    ["--accent-on", "--accent"], ["--accent", "--paper"], ["--accent", "--surface-card"],
  ];
  for (const [mode, dark] of [["light", false], ["dark", true]]) {
    const scope = buildScope((s) => (dark ? isDarkSel(s) : isLightSel(s)));
    // 半透明色按叠在 --paper 上计算
    const paperRaw = resolveToken("--paper", [scope]);
    const paperBase = parseColor(paperRaw) ?? { r: 1, g: 1, b: 1 };
    const solid = (raw) => {
      const c = parseColor(raw ?? "");
      if (!c) return null;
      return c.a >= 1 ? c : blend(c, paperBase);
    };
    for (const [f, b2] of pairs) {
      const fc = solid(resolveToken(f, [scope]));
      const bc = solid(resolveToken(b2, [scope]));
      if (!fc || !bc) continue; // 未声明（如皮肤未覆盖 --surface-card）则跳过——该 Token 走基线
      const ratio = contrast(fc, bc);
      if (ratio < 4.5) problems.push(`[A3/${mode}] ${f} 压 ${b2} = ${ratio.toFixed(2)}:1 < 4.5`);
    }
  }

  // 5 动效作用域（A6）：含 animation/transition/transform 的规则，选择器须含 .motion-full（VT 伪元素例外）
  for (const r of rules) {
    if (!/animation\s*:|animation-name|transition\s*:|transform\s*:/.test(r.body)) continue;
    if (r.context.includes("::view-transition") || r.selector.includes("::view-transition")) continue;
    if (!r.selector.includes(".motion-full") && !r.context.includes(".motion-full")) {
      problems.push(`[A6] 动效规则未挂 .motion-full：${r.selector.slice(0, 90)}`);
    }
  }

  return problems;
}

function main() {
  const args = process.argv.slice(2);
  const dirs = fs.readdirSync(SKINS_DIR).filter((d) => {
    const p = path.join(SKINS_DIR, d);
    if (!fs.statSync(p).isDirectory() || d === "_lab") return false; // _lab 仅 DEV，不审计
    if (args.length) return args.includes(d);
    return fs.readdirSync(p).some((f) => f.endsWith(".css"));
  });
  let failed = false;
  if (!dirs.length) console.log("skin-audit：无可审计的皮肤 CSS（swiss 默认皮肤无 CSS，合规）");
  for (const id of dirs) {
    const files = fs.readdirSync(path.join(SKINS_DIR, id)).filter((f) => f.endsWith(".css")).map((f) => path.join(SKINS_DIR, id, f));
    const problems = auditSkin(id, files);
    console.log(`\n== skin-audit: ${id} (${files.length} css) ==`);
    if (!problems.length) console.log("  ✓ 通过");
    else {
      failed = true;
      problems.forEach((p) => console.log("  ✗ " + p));
    }
  }
  process.exit(failed ? 1 : 0);
}

main();
