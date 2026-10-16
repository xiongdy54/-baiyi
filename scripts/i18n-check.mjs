// v49.8（D182）：i18n 完整性检查——扫描源码 t()/tMain() 字面量键 × en/ja 词典比对缺漏。
// 用法：node scripts/i18n-check.mjs [--report]（--report 额外列出「词典有而代码未用」的孤儿键，仅提示）
// 退出码：缺漏 > 0 → 1（tests/i18n.test.cjs 消费同一实现作闸门）。
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");

// 词典以 TS 源形式维护——这里用轻量解析取键（与 esbuild bundle 路径互补：本脚本零构建、IDE/CI 直跑）
function parseDictKeys(file) {
  const text = fs.readFileSync(file, "utf8");
  const keys = new Set();
  // 顶层条目形如：  "键": "值",  或  "键": { one, other },
  const re = /^\s{2}"((?:[^"\\]|\\.)+)":\s*(?:"|\{)/gm;
  let m;
  while ((m = re.exec(text))) keys.add(m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
  return keys;
}

/** 扫描 t("…") / T("…") / tMain("…") 的字符串字面量首参（跳过注释行） */
export function extractKeys(srcRoot = path.join(ROOT, "src")) {
  const keys = new Map(); // key -> [rel:line]
  const skip = new Set(["node_modules", "dist", "build", ".git", "vendor"]);
  const walk = (d) => {
    for (const n of fs.readdirSync(d)) {
      if (skip.has(n)) continue;
      const full = path.join(d, n);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(n)) scanFile(full);
    }
  };
  const scanFile = (file) => {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    const re = /\b(?:t|T|tMain)\(\s*"((?:[^"\\]|\\.)+)"/g;
    lines.forEach((l, i) => {
      if (/^\s*(\/\/|\/\*|\*)/.test(l)) return;
      let m;
      while ((m = re.exec(l))) {
        const key = m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
        if (!keys.has(key)) keys.set(key, []);
        if (keys.get(key).length < 3) keys.get(key).push(`${rel}:${i + 1}`);
      }
    });
  };
  walk(srcRoot);
  return keys;
}

export function check() {
  const used = extractKeys();
  const en = parseDictKeys(path.join(ROOT, "src", "i18n", "locales", "en.ts"));
  const ja = parseDictKeys(path.join(ROOT, "src", "i18n", "locales", "ja.ts"));
  const missingEn = [];
  const missingJa = [];
  for (const [k, where] of used) {
    if (!en.has(k)) missingEn.push(`${k}  ←  ${where.join(", ")}`);
    if (!ja.has(k)) missingJa.push(`${k}  ←  ${where.join(", ")}`);
  }
  const orphansEn = [...en].filter((k) => !used.has(k));
  const orphansJa = [...ja].filter((k) => !used.has(k));
  return { total: used.size, missingEn, missingJa, orphansEn, orphansJa };
}

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
  const r = check();
  console.log(`[i18n-check] t() 字面量键 ${r.total} 个`);
  for (const x of r.missingEn) console.log(`  [en 缺] ${x}`);
  for (const x of r.missingJa) console.log(`  [ja 缺] ${x}`);
  if (process.argv.includes("--report")) {
    for (const x of r.orphansEn) console.log(`  [孤儿 en] ${x}`);
    for (const x of r.orphansJa) console.log(`  [孤儿 ja] ${x}`);
  }
  if (r.missingEn.length || r.missingJa.length) process.exit(1);
  console.log("[i18n-check] OK");
}
