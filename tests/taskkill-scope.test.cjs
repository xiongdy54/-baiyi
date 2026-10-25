// @runtime: electron-node
"use strict";
// C-02 步骤 3（可选 P3 收尾）静态守卫：tests/ 与 scripts/ 里禁止再出现按映像名整杀本机
// Electron 的清理（杀全机 electron.exe 会顺手关掉用户正开着的其他会话，报告 C-02 证据 3）。
// 允许且只允许按 PID 收割自己起的子进程树（tests/lib/killProc.cjs：win32 走 taskkill /PID /T /F，
// POSIX 走 process.kill(-pid) 整组）。本文件用拼接/正则构造禁令，自身不得包含字面命令。
const assert = require("assert");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SKIP_DIRS = new Set([".git", ".results", "node_modules", "__pycache__"]);
const EXTS = new Set([".cjs", ".mjs", ".js"]);

function walk(dir, out) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    if (SKIP_DIRS.has(n)) continue;
    const full = path.join(dir, n);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (EXTS.has(path.extname(n))) out.push(full);
  }
  return out;
}

// 禁令 1：shell 串形式（"taskkill /IM …"）——用正则避免本文件自身命中
const RE_SHELL_IM = new RegExp("taskkill\\s+" + "\\/" + "IM\\b");
// 禁令 2：参数数组形式（["taskkill", ["/IM", …]]）——独立的 "/IM" 字符串字面量
const RE_ARG_IM = /["']\/IM["']/;

// 守卫只治理**入库（git 跟踪）**的 tests/ + scripts/ 文件：被 .gitignore 排除的一次性探针
// （tests/tmp-* 等，本机遗留即含 spawn("taskkill",["/IM",…])）不得让全量套件失败——
// 否则任何人往 tmp 目录丢一张调试脚本就能打红 CI。git 不可用时退回全量扫描（保持原语义）。
function trackedFiles() {
  try {
    const out = execSync("git ls-files -- tests scripts", {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    return new Set(out.split("\n").map((s) => s.trim().replace(/\\/g, "/")).filter(Boolean));
  } catch {
    return null; // 非 git 检出 / git 缺席：退回全量扫描
  }
}
const TRACKED = trackedFiles();
function inScope(rel) {
  return TRACKED === null || TRACKED.has(rel);
}

let n = 0;
const offenders = [];
for (const base of ["tests", "scripts"]) {
  for (const f of walk(path.join(ROOT, base), [])) {
    if (path.basename(f) === "taskkill-scope.test.cjs") continue; // 守卫自身
    const rel = path.relative(ROOT, f).split(path.sep).join("/");
    if (!inScope(rel)) continue; // gitignore 掉的一次性脚本不属本守卫辖区
    let src = "";
    try {
      src = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    if (RE_SHELL_IM.test(src) || RE_ARG_IM.test(src)) offenders.push(path.relative(ROOT, f));
  }
}
assert.deepStrictEqual(offenders, [], `发现按映像名整杀的清理（应改为 tests/lib/killProc.cjs 按 PID 收割）: ${offenders.join(", ")}`);
n++;

// helper 契约：存在、可 require、为函数，且 Windows/POSIX 两分支都按 PID 收割
const killProcPath = path.join(ROOT, "tests", "lib", "killProc.cjs");
assert.ok(fs.existsSync(killProcPath), "tests/lib/killProc.cjs 应存在");
const killProcSrc = fs.readFileSync(killProcPath, "utf8");
assert.ok(/taskkill/.test(killProcSrc) && /\/PID/.test(killProcSrc) && /\/T/.test(killProcSrc), "win32 分支应为 taskkill /PID <pid> /T /F");
assert.ok(/process\.kill\(-child\.pid\)/.test(killProcSrc), "POSIX 分支应为进程组收割 process.kill(-pid)");
assert.strictEqual(typeof require(killProcPath), "function", "killProc 应导出函数");
// 空 child 必须静默返回（启动期清理点传入 null 实例时不得抛错）
require(killProcPath)(null);
require(killProcPath)({ pid: null });
n++;

console.log(`taskkill-scope: ${n} 组断言通过（静态扫描 tests/ + scripts/ 无按映像名整杀；killProc 契约成立）`);
