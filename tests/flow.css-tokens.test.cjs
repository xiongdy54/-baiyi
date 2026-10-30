// @runtime: system-node
// 结构流 · 样式 Token 闸门（node scripts/run-tests.mjs flow.css-tokens）。
// 依据 STRUCTURE-FLOW-FIX-v3.2 §14.1：一条残缺注释（缺 /*）曾把整块 :root Token 吞掉，
// 使 palette 8 色退化为正文色、--flow-ease 未定义导致所有 transition 失效。
// 本测试只看源码文本：注释外的区域必须能读到这些定义。
const fs = require("fs");
const path = require("path");

const cssPath = path.join(__dirname, "..", "src", "theme.css");
const src = fs.readFileSync(cssPath, "utf8");

/** 去掉注释，同时保留与原文等长的空白（方便报行号）；未闭合的 /* 视为吞到文件尾 */
function stripComments(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const a = text.indexOf("/*", i);
    if (a < 0) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, a);
    const b = text.indexOf("*/", a + 2);
    const end = b < 0 ? text.length : b + 2;
    out += text.slice(a, end).replace(/[^\n]/g, " ");
    i = end;
  }
  return out;
}

const bare = stripComments(src);
const lineOf = (index) => src.slice(0, index).split("\n").length;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${JSON.stringify(detail ?? "").slice(0, 400)}`); }
}

console.log("---- 结构流 Token（注释外） ----");
const tokens = ["--flow-c1", "--flow-c8", "--flow-counter", "--flow-ease", "--flow-ease-out", "--flow-t-geo", "--flow-ahl-0", "--flow-aend-0", "--flow-strand-a"];
for (const t of tokens) {
  const m = bare.match(new RegExp(`(^|[;{\\s])${t}\\s*:`, "m"));
  check(`${t} 在注释外有定义`, !!m, { index: m ? lineOf(m.index) : null });
}

const defs = bare.match(/(^|[;{\s])--flow-[a-z0-9-]+\s*:/gm) || [];
check("注释外的 --flow-* 定义不少于 14 条（palette 8 + 反方 1 + 透明度档 10）", defs.length >= 14, defs.length);

const open = (src.match(/\/\*/g) || []).length;
const close = (src.match(/\*\//g) || []).length;
check("注释开闭数量一致（未闭合会把后续规则全部吞掉）", open === close, { open, close });

const rootAt = bare.indexOf("--flow-c1");
const braceBefore = rootAt >= 0 ? bare.lastIndexOf("{", rootAt) : -1;
const selectorStart = braceBefore >= 0 ? bare.lastIndexOf("}", braceBefore) + 1 : -1;
const selector = braceBefore >= 0 ? bare.slice(selectorStart, braceBefore).trim() : "";
check("--flow-c1 位于 :root 规则内（选择器确实是 :root）", selector === ":root", { selector: selector.slice(0, 120) });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
