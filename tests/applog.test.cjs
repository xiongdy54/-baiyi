// 应用日志单元测试（v48.75 / D119，目录显式注入，node 直跑）
// 运行：node tests/applog.test.cjs
// 第 1-10 节纯 node（appLog 零依赖不 require electron）；第 11 节 spawn 真实 electron
// 子进程验证启动期崩溃语义（D119 §6 两阶段）——无 electron dist 时该节跳过不计失败。
const fs = require("fs");
const os = require("os");
const path = require("path");
const appLog = require("../electron/appLog");

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 300)}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "applog-"));
const dirOf = (name) => path.join(tmp, name);
const readLog = (dir) => {
  try { return fs.readFileSync(path.join(dir, appLog.LOG_FILE_NAME), "utf-8"); } catch { return ""; }
};
const exists = (p) => fs.existsSync(p);

// 主体包进 async IIFE：第 11 节需 await 子进程退出（backup.test.cjs 同模式）
(async () => {
console.log("== 1) init：建目录 + 启动横幅（版本/平台元信息）==");
{
  const dir = dirOf("s1");
  appLog.init({ dir, version: "0.0.1", platform: "win32/x64", electronVersion: "31.7.7", nodeVersion: "20.1.0", packaged: false });
  check("目录已创建", exists(dir), dir);
  const text = readLog(dir);
  check("横幅含 app start", text.includes("app start"), text);
  check("横幅含版本号", text.includes("version 0.0.1"), text);
  check("横幅含 packaged 标志", text.includes("packaged false"), text);
  check("横幅含平台", text.includes("platform win32/x64"), text);
  check("横幅含 electron 版本", text.includes("electron 31.7.7"), text);
  check("横幅含 node 版本", text.includes("node 20.1.0"), text);
}

console.log("== 2) log：单行格式（时间戳/级别/模块）与多行消息单行化 ==");
{
  const dir = dirOf("s2");
  appLog.init({ dir, version: "t" });
  appLog.log("INFO", "app", "hello world");
  appLog.log("WARN", "main", "line1\nline2\r\nline3");
  const lines = readLog(dir).split("\n").filter((l) => l.includes("[app]") || l.includes("[main]"));
  check("时间戳格式（本地时区+偏移+级别+模块）", /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2} \[INFO\] \[app\] hello world$/.test(lines[0]), lines[0]);
  check("多行消息单行化为字面 \\n", lines[1].endsWith("[main] line1\\nline2\\nline3"), lines[1]);
  check("一行一事件（无裸换行混入）", lines.length === 2 && lines.every((l) => !/\r/.test(l)), lines.join("|"));
}

console.log("== 3) logError：Error 对象 message + 堆栈缩进块 ==");
{
  const dir = dirOf("s3");
  appLog.init({ dir, version: "t" });
  const err = new Error("boom");
  appLog.logError("main", err, { event: "uncaughtException" });
  const text = readLog(dir);
  check("错误行含 Error 名称与消息", /\[ERROR\] \[main\] Error: boom \(event=uncaughtException\)/.test(text), text);
  check("堆栈另起缩进块（块整体 4 空格，at 行随原生缩进为 8 空格）", /\n    Error: boom\n        at /.test(text), text.slice(0, 300));
  check("非 Error 载荷安全（字符串包装）", (() => {
    appLog.logError("main", "plain string failure");
    return readLog(dir).includes("Error: plain string failure");
  })(), readLog(dir));
}

console.log("== 4) 轮转：超阈值轮转、历史递推、保留份数（最旧删除）==");
{
  const dir = dirOf("s4");
  appLog.init({ dir, version: "t", maxBytes: 150, keepFiles: 2 });
  const big = "x".repeat(60);
  for (let i = 1; i <= 12; i++) appLog.log("INFO", "app", `${big} #${i}`);
  const f = (n) => path.join(dir, `${appLog.LOG_FILE_NAME}.${n}`);
  check("轮转文件 .1 已生成", exists(f(1)), fs.readdirSync(dir).join(","));
  check("轮转文件 .2 已生成（保留 2 份历史）", exists(f(2)), fs.readdirSync(dir).join(","));
  check("超出份数的最旧历史被删（无 .3）", !exists(f(3)), fs.readdirSync(dir).join(","));
  check("轮转后当前文件重新开写（最后一条在新文件）", readLog(dir).includes("#12"), readLog(dir).slice(-80));
  check("历史 .1 是上一代内容（含较新序号）", fs.readFileSync(f(1), "utf-8").includes("#11") || fs.readFileSync(f(1), "utf-8").includes("#10"), fs.readFileSync(f(1), "utf-8").slice(-60));
  check("历史 .2 是更早一代（不含最新序号）", !fs.readFileSync(f(2), "utf-8").includes("#11"), fs.readFileSync(f(2), "utf-8").slice(-60));
}

console.log("== 5) logRendererError：字段白名单 + 截断 + 非法载荷安全 ==");
{
  const dir = dirOf("s5");
  appLog.init({ dir, version: "t" });
  appLog.logRendererError({
    kind: "console",
    message: "m".repeat(5000),
    stack: "s".repeat(9000),
    source: "http://localhost:5173/main.tsx",
    line: 42,
    col: 7,
    // 白名单外字段：必须被丢弃
    documentBody: "SECRET-DOC-CONTENT",
    apiKey: "sk-SECRET"
  });
  const text = readLog(dir);
  check("kind 与 source 定位段入日志", text.includes("[renderer] console @ http://localhost:5173/main.tsx:42:7"), text);
  // 双层截断：logRendererError 先 clip 原始消息至 2000，log() 再对「kind @ source 前缀 + 消息」
  // 整段 clip 至 2000——最终行内消息段 ≤ 2000，连续 m = 2000 − 前缀长度。
  const prefixLen = "console @ http://localhost:5173/main.tsx:42:7: ".length; // 47
  const mRun = (text.match(/m{100,}/) || [""])[0];
  check("消息截断（最终行内消息段 ≤ 2000，双层截断后 m 连续段 = 2000 − 前缀）", mRun.length === 2000 - prefixLen, mRun.length);
  // v48.75 审查修订（P2-6）：原断言 `||` 兜底近乎恒真，收紧为精确断言——
  // clip(9000→4000) 必须留下 4000 字符 s 连续段 + 截断标记，缺一即失败。
  const sRun = (text.match(/s{100,}/) || [""])[0];
  check("堆栈截断（4000 字符上限 + 截断标记）", sRun.length === 4000 && text.includes("…（截断，共 9000 字符）"), `sRun=${sRun.length}`);
  check("白名单外字段被丢弃（不含 SECRET）", !text.includes("SECRET"), text.slice(0, 200));
  appLog.logRendererError(null);
  appLog.logRendererError("not an object");
  appLog.logRendererError({ kind: "weird", message: 123 });
  const t2 = readLog(dir);
  check("null/字符串载荷安全降级为 no message", t2.includes("[renderer] error: (no message)"), t2.slice(-300));
  check("非法 kind 回落 error（不透传 weird）、数字消息字符串化", !t2.includes("weird") && t2.includes("[renderer] error: 123"), t2.slice(-300));
}

console.log("== 6) 未 init 时安全 no-op（子进程全新模块实例）==");
{
  // 模块 state 是单例，本进程已 init 过无法回到初始态——用子进程加载全新实例验证：
  // 渲染层错误早于 init 到达的边界下，各写入口必须 no-op 不抛、无处落盘。
  const script = [
    `const appLog = require(${JSON.stringify(require.resolve("../electron/appLog"))});`,
    `let threw = false;`,
    `try {`,
    `  appLog.log("ERROR", "main", "before init");`,
    `  appLog.logError("main", new Error("before init"));`,
    `  appLog.logRendererError({ kind: "error", message: "before init" });`,
    `} catch (e) { threw = true; }`,
    `process.stdout.write(JSON.stringify({ threw, logDir: appLog.getLogDir(), ensureDir: appLog.ensureDir() }));`
  ].join("\n");
  let r = null;
  let raw = "";
  try {
    raw = require("child_process").execFileSync(process.execPath, ["-e", script], { encoding: "utf-8" });
    r = JSON.parse(raw);
  } catch (err) {
    raw = String(err && err.message ? err.message : err);
  }
  check("未 init 调用 log/logError/logRendererError 不抛出", r !== null && r.threw === false, raw);
  check("未 init getLogDir 返回空串（无处可写）", r !== null && r.logDir === "", raw);
  check("未 init ensureDir 返回 false（不建目录）", r !== null && r.ensureDir === false, raw);
}

console.log("== 7) 目录被外部删除后写入不抛 + 自愈重建 ==");
{
  const dir = dirOf("s7");
  appLog.init({ dir, version: "t" });
  appLog.log("INFO", "app", "before delete");
  fs.rmSync(dir, { recursive: true, force: true });
  let threw = false;
  try {
    appLog.log("ERROR", "main", "after delete");
  } catch (err) {
    threw = true;
  }
  check("目录删除后 log 不抛出", threw === false, threw);
  check("目录自愈重建且新行落盘", exists(dir) && readLog(dir).includes("after delete"), fs.readdirSync(dir).join(","));
}

console.log("== 8) 重复 init 生效（后一次覆盖，测试隔离用）==");
{
  const dirA = dirOf("s8a");
  const dirB = dirOf("s8b");
  appLog.init({ dir: dirA, version: "A" });
  appLog.init({ dir: dirB, version: "B" });
  appLog.log("INFO", "app", "goes to B");
  check("后一次 init 生效（写入 B）", readLog(dirB).includes("goes to B"), readLog(dirB));
  check("A 不再接收（只含 A 的横幅）", !readLog(dirA).includes("goes to B"), readLog(dirA));
}

console.log("== 9) getLogDir / ensureDir（openFolder 前置：零日志状态也能打开）==");
{
  const dir = dirOf("s9");
  appLog.init({ dir, version: "t" });
  fs.rmSync(dir, { recursive: true, force: true });
  check("ensureDir 重建目录返回 true", appLog.ensureDir() === true && exists(dir), dir);
  check("getLogDir 返回 init 目录", appLog.getLogDir() === dir, appLog.getLogDir());
}

console.log("== 10) keepFiles=0：零历史（清空重来，不产生 .1）==");
{
  // v48.75 审查修订（P2-5）：0 份历史＝只留当前文件，超阈值清空重来而非 rename 出 .1。
  const dir = dirOf("s10");
  appLog.init({ dir, version: "t", maxBytes: 150, keepFiles: 0 });
  const big = "x".repeat(60);
  for (let i = 1; i <= 6; i++) appLog.log("INFO", "app", `${big} #${i}`);
  const files = fs.readdirSync(dir).join(",");
  check("不产生任何 .1 历史文件", !exists(path.join(dir, `${appLog.LOG_FILE_NAME}.1`)), files);
  const text = readLog(dir);
  check("超阈值清空重来（当前文件只含末尾条目 #6，#5 已随清空丢弃）", text.includes("#6") && !text.includes("#5"), text.slice(-80));
  check("当前文件体积回落到阈值内", fs.statSync(path.join(dir, appLog.LOG_FILE_NAME)).size < 150, fs.statSync(path.join(dir, appLog.LOG_FILE_NAME)).size);
}

console.log("== 11) 启动期未捕获异常：落日志 + exit(1)，不留僵尸（真实 electron 子进程）==");
{
  // P1-2（D119 §6 两阶段崩溃语义）：模块加载期同步异常发生在业务 require 之前，半初始化
  // 进程必须退出而非带伤进 whenReady。经 main.js 测试钩子 M7_APPLOG_STARTUP_CRASH 模拟
  // （M7_TEST_USERDATA 同例的 env 门控），spawn 真实 electron 验证行为级结果。
  let exe = "";
  try { exe = require("electron"); } catch { /* electron 包未正确安装 */ }
  if (!exe || !exists(exe)) {
    console.log("  - 跳过：node_modules/electron/dist 可执行不存在（本节需真实 electron），不计失败");
  } else {
    const userData = dirOf("s11-userdata");
    const proc = require("child_process").spawn(exe, ["."], {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, M7_TEST_USERDATA: userData, M7_APPLOG_STARTUP_CRASH: "simulated-load-failure" },
      stdio: "ignore"
    });
    const r = await new Promise((resolve) => {
      const timer = setTimeout(() => { proc.kill(); resolve({ code: null, timeout: true }); }, 30000);
      proc.on("error", (err) => { clearTimeout(timer); resolve({ code: null, error: String(err) }); });
      proc.on("close", (code) => { clearTimeout(timer); resolve({ code, timeout: false }); });
    });
    check("启动期异常以 exit code 1 退出（不进 whenReady 不留僵尸）", r.code === 1, JSON.stringify(r));
    const crashLog = readLog(path.join(userData, "logs"));
    check("崩溃已落日志（含钩子标记）", crashLog.includes("M7_APPLOG_STARTUP_CRASH: simulated-load-failure"), crashLog.slice(0, 300));
    check("崩溃经 uncaughtException 通道记录", crashLog.includes("uncaughtException"), crashLog.slice(0, 300));
  }
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail > 0 ? 1 : 0);
})().catch((err) => {
  console.error("测试进程异常：", err);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 清理失败不掩盖原错误 */ }
  process.exit(1);
});
