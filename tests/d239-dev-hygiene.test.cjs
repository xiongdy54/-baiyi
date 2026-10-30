// D239 开发 / 测试卫生：dev server 地址唯一来源 + watchdog、测试退出码如实上报、弃用接口迁移、过时注释。
// @runtime: electron  @tier: 2  @gui: false  @id: D239HYGIENE  @timeout: 180
// 运行：npx electron tests/d239-dev-hygiene.test.cjs（或 node scripts/run-tests.mjs d239）
// 覆盖：
//   A 退出码：dbenv.quit(code) 真实以 code 退出（子 Electron 进程实测；对照记录旧写法 app.quit()+定时 process.exit 恒为 0）；
//     tests/ 下 Electron 测试不再有「app.quit() + process.exitCode / 定时 process.exit」组合；原 11 个文件均改 app.exit。
//     tests/flows 下 Electron 流程：runFlow 的结果都有人接并据此退出（F78 / F90 的驱动原先挂到外层超时）、跑完不再无条件
//     app.exit(0)；runFlow 按结果置退出码（子 node 进程实测：通过 / 断言失败 / 零断言 / 崩溃）。
//   B dev server（electron/devServer.js）：--dev-server=<url> ＞ NUTATION_DEV_SERVER_URL ＞ 默认 5173；非法值回落；
//     开发模式判定（含 =<url> 形式、打包版恒否）；loadAppPage 四种载入路径；watchdog 探测的就是该地址
//     （HEAD，任何应答清零），服务消失后连续 N 次失败才 onGone、stop() 后不再探测；electron/ 下不再写死 localhost:5173。
//   C console-message：内核测试助手改单参数监听器（事件对象）；本 Electron 上实测 event.message 可用、
//     单参数监听器不触发弃用告警（对照：四参数监听器触发）。
//   D 过时注释：backup.js / db.js 不再写「把内存库刷盘」（sql.js 内存库已退役，现为 WAL checkpoint）。
//   E GUI 流程驱动不挂起：调试端口收下连接却不应答时 connect 仍按截止时间返回（本地哑服务实测）；
//     子进程不理 SIGTERM 时 shutdown 兜底强制结束（子进程实测）；launch 连不上时就地结束所起应用。
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 400)}`); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** 子 Electron 进程跑一段脚本，返回退出码 */
function runChild(tmp, name, body) {
  const file = path.join(tmp, name + ".cjs");
  fs.writeFileSync(file, body);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = [...(process.platform === "linux" ? ["--no-sandbox"] : []), `--user-data-dir=${path.join(tmp, "ud-" + name)}`, file];
  const r = spawnSync(process.execPath, args, { env, timeout: 60000, encoding: "utf8" });
  return { status: r.status, signal: r.signal, out: (r.stdout || "") + (r.stderr || "") };
}

// C 段会开关一个隐藏窗口：最后一个窗口关掉时 Electron 默认 app.quit()、且以 0 退出——后面各段还没跑完进程就
// 「成功」退出了（实测 E 段第一次 await 时即退出、退出码 0，正是本测试要抓的那类问题）。由测试自己决定何时退出；
// 万一仍被别的路径带着退出，没跑到结尾就如实以 1 退出。
let finished = false;
app.on("window-all-closed", () => { /* 不随窗口全关而退出 */ });
app.on("will-quit", () => { if (!finished) { console.log("  ✗ 测试未跑完就退出"); app.exit(1); } });

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "d239-"));
  try {
    // ---------------- A 退出码 ----------------
    console.log("== A 测试退出码如实上报 ==");
    const DBENV = JSON.stringify(path.join(ROOT, "tests", "flows", "lib", "dbenv.cjs"));
    const q3 = runChild(tmp, "quit3", `const { app } = require("electron");\napp.whenReady().then(() => require(${DBENV}).quit(3));\n`);
    check("A1 dbenv.quit(3) → 进程退出码 3", q3.status === 3, JSON.stringify({ status: q3.status, signal: q3.signal, out: q3.out.slice(-200) }));
    const q0 = runChild(tmp, "quit0", `const { app } = require("electron");\napp.whenReady().then(() => require(${DBENV}).quit(0));\n`);
    check("A2 dbenv.quit(0) → 进程退出码 0", q0.status === 0, JSON.stringify({ status: q0.status, out: q0.out.slice(-200) }));
    const qt = runChild(tmp, "quitTrue", `const { app } = require("electron");\napp.whenReady().then(() => require(${DBENV}).quit(true));\n`);
    check("A3 dbenv.quit(true)（布尔失败标志）→ 退出码 1", qt.status === 1, JSON.stringify({ status: qt.status }));
    const old = runChild(tmp, "oldPattern", `const { app } = require("electron");\napp.whenReady().then(() => { try { app.quit(); } catch {} setTimeout(() => process.exit(3), 120); });\n`);
    console.log(`  · 对照（旧写法 app.quit() + 120ms 后 process.exit(3)）：退出码 ${old.status}${old.status === 0 ? "——失败被吞掉，正是本次修复的原因" : ""}`);
    // 静态：Electron 测试（非种子脚本）不再组合 app.quit() 与 process.exitCode / 定时 process.exit
    const offenders = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (/^(tmp-|\.results$|fixtures$|results$)/.test(e.name)) continue;
          walk(p);
        } else if (/\.c?js$/.test(e.name) && !/bundle|\.seed\.cjs$/.test(e.name)) {
          const s = fs.readFileSync(p, "utf8");
          if (!/require\(["']electron["']\)/.test(s) || !/\bapp\.quit\(\)/.test(s)) continue;
          if (/process\.exitCode\s*=/.test(s) || /setTimeout\(\s*\(\)\s*=>\s*process\.exit\(/.test(s)) offenders.push(path.relative(ROOT, p));
        }
      }
    };
    walk(path.join(ROOT, "tests"));
    const selfRel = path.relative(ROOT, __filename);
    check("A4 tests/ 下无「app.quit() + process.exitCode / 定时 process.exit」组合（失败会被吞成退出码 0）", offenders.filter((f) => f !== selfRel).length === 0, offenders.join(", "));
    const FIXED = ["d101-lifecycle", "d103-geninfo", "d105-scope", "d111-mpquery", "d91-prompts", "extracts", "legacyBackfill", "m12", "m13", "schema-version", "settings-file"];
    const notExit = FIXED.filter((n) => !/\bapp\.exit\(/.test(read(`tests/${n}.test.cjs`)));
    check("A5 原 11 个吞退出码的测试均改为 app.exit(code)", notExit.length === 0, notExit.join(","));
    const noCatch = ["d101-lifecycle", "d103-geninfo", "d105-scope", "m12"].filter((n) => !/\} catch \(e\) \{[\s\S]{0,200}fail\+\+;[\s\S]{0,40}\} finally \{/.test(read(`tests/${n}.test.cjs`)));
    check("A6 原无 catch 的 4 个测试：异常计为失败（不再崩溃即通过）", noCatch.length === 0, noCatch.join(","));
    check("A7 dbenv.quit 改为 app.exit", /function quit\(code\) \{[\s\S]{0,120}app\.exit\(/.test(read("tests/flows/lib/dbenv.cjs")), "仍为 app.quit");
    // A8 / A9：tests/flows 里的 Electron 流程（静态）
    const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
    const flowsDir = path.join(ROOT, "tests", "flows");
    const electronFlows = fs.readdirSync(flowsDir).filter((f) => /^f.*\.cjs$/.test(f))
      .map((f) => ({ f, code: stripComments(fs.readFileSync(path.join(flowsDir, f), "utf8")) }))
      .filter((x) => /@runtime:\s*electron/.test(fs.readFileSync(path.join(flowsDir, x.f), "utf8")));
    // 语句级 runFlow(…) 且其后没有 .then(…exit/quit)：结果没人接、也没人退出——Electron 主进程没开窗口不会自行退出，
    // 只能挂到外层超时被杀（F78 / F90 的驱动原先就是这样，退出码 124、每轮白等满超时）
    const floatingRunFlow = (code) => /^[ \t]*runFlow\(/m.test(code) && !/\}\)\.then\(\(?s\)?\s*=>\s*\{?[\s\S]{0,400}?(app\.exit|quit)\(/.test(code);
    const detectorOk = floatingRunFlow('runFlow(flow, async () => {\n  flow.check("x", true, 1, 1);\n});\n') &&
      !floatingRunFlow('runFlow(flow, async () => {\n  flow.check("x", true, 1, 1);\n}).then((s) => {\n  require("electron").app.exit(s.fail ? 1 : 0);\n});\n');
    const floating = electronFlows.filter((x) => floatingRunFlow(x.code)).map((x) => x.f);
    check("A8 Electron 流程的 runFlow 结果都有人接并据此退出（不再挂到外层超时）", detectorOk && electronFlows.length >= 50 && floating.length === 0, `检测器自检=${detectorOk} 流程数=${electronFlows.length} 未接: ${floating.join(", ")}`);
    const hardZero = electronFlows.filter((x) => /await runFlow\(/.test(x.code) && /setTimeout\(\(\) => app\.exit\(0\)/.test(x.code)).map((x) => x.f);
    check("A9 Electron 流程跑完不再无条件 app.exit(0)（原 10 个改为 app.exit(process.exitCode || 0)）", hardZero.length === 0, hardZero.join(", "));
    // A10：runFlow 按结果置退出码（子 node 进程实测；writeResult 换成只算不写，免得往 results/ 里留探针记录）
    const HARNESS = JSON.stringify(path.join(ROOT, "tests", "flows", "lib", "harness.cjs"));
    const probeRunFlow = (name, body) => {
      const file = path.join(tmp, name + ".cjs");
      fs.writeFileSync(file, `const { Flow, runFlow } = require(${HARNESS});\nconst flow = new Flow({ id: "D239PROBE", title: "probe", angle: "", cites: [], tier: 1, gui: false });\nflow.writeResult = function () { return this.summary(); };\nrunFlow(flow, async () => { ${body} });\n`);
      const r = spawnSync(process.execPath, [file], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, timeout: 30000, encoding: "utf8" });
      return r.status;
    };
    const rf = {
      ok: probeRunFlow("rfOk", `flow.check("ok", true, 1, 1);`),
      bad: probeRunFlow("rfBad", `flow.check("ok", true, 1, 1); flow.check("bad", false, 1, 2);`),
      zero: probeRunFlow("rfZero", ``),
      crash: probeRunFlow("rfCrash", `flow.check("ok", true, 1, 1); throw new Error("boom");`),
    };
    check("A10 runFlow 按结果置退出码（node 流程自然退出即如实上报）：通过 0 / 断言失败 1 / 零断言 1 / 崩溃 1", rf.ok === 0 && rf.bad === 1 && rf.zero === 1 && rf.crash === 1, JSON.stringify(rf));

    // ---------------- B dev server ----------------
    console.log("== B dev server 地址与 watchdog ==");
    const ds = require(path.join(ROOT, "electron", "devServer.js"));
    check("B1 默认地址 = http://localhost:5173（与 vite.config.ts server.port 一致）", ds.devServerBase(["electron", ".", "--dev-server"], {}) === "http://localhost:5173" && /port:\s*5173/.test(read("vite.config.ts")), ds.devServerBase(["--dev-server"], {}));
    check("B2 --dev-server=<url> 指定地址；页面地址拼接", ds.devServerUrl("lens.html", ["--dev-server=http://127.0.0.1:5199/"], {}) === "http://127.0.0.1:5199/lens.html" && ds.devServerUrl("", ["--dev-server=http://127.0.0.1:5199"], {}) === "http://127.0.0.1:5199/", ds.devServerUrl("lens.html", ["--dev-server=http://127.0.0.1:5199/"], {}));
    check("B3 环境变量 NUTATION_DEV_SERVER_URL 次之；命令行优先", ds.devServerBase(["--dev-server"], { NUTATION_DEV_SERVER_URL: "http://127.0.0.1:6001" }) === "http://127.0.0.1:6001" && ds.devServerBase(["--dev-server=http://127.0.0.1:6002"], { NUTATION_DEV_SERVER_URL: "http://127.0.0.1:6001" }) === "http://127.0.0.1:6002", "优先级不对");
    check("B4 非 http(s) / 无法解析 → 回落默认", ["--dev-server=ftp://x", "--dev-server=not a url", "--dev-server=javascript:alert(1)"].every((a) => ds.devServerBase([a], {}) === "http://localhost:5173") && ds.devServerBase(["--dev-server"], { NUTATION_DEV_SERVER_URL: "file:///etc" }) === "http://localhost:5173", "未回落");
    check("B5 开发模式判定：裸 --dev-server 与 =<url> 都算；无开关 / 打包版恒否", ds.isDevServerMode({ isPackaged: false }, ["--dev-server"]) && ds.isDevServerMode({ isPackaged: false }, ["--dev-server=http://127.0.0.1:1"]) && !ds.isDevServerMode({ isPackaged: false }, ["electron", "."]) && !ds.isDevServerMode({ isPackaged: true }, ["--dev-server"]) && !ds.isDevServerMode({ isPackaged: false }, ["--dev-servers"]), "判定不对");
    // loadAppPage 四种路径（替身窗口 / fs）
    const fakeWin = (rejectUrl) => {
      const calls = [];
      return { calls, loadURL: (u) => { calls.push("url:" + u); return rejectUrl ? Promise.reject(new Error("refused")) : Promise.resolve(); }, loadFile: (f) => { calls.push("file:" + path.basename(f)); return Promise.resolve(); } };
    };
    const fsWith = (exists) => ({ existsSync: () => exists });
    const devArgv = ["--dev-server=http://127.0.0.1:5199"];
    const w1 = fakeWin(true);
    ds.loadAppPage(w1, { app: { isPackaged: false }, fs: fsWith(true), distFile: "/x/dist/lens.html", page: "lens.html", argv: devArgv, env: {} });
    await wait(10);
    check("B6 开发模式：先连 dev server（指定地址），失败回落 dist", w1.calls.join(" ") === "url:http://127.0.0.1:5199/lens.html file:lens.html", w1.calls.join(" "));
    const w2 = fakeWin(false);
    ds.loadAppPage(w2, { app: { isPackaged: false }, fs: fsWith(true), distFile: "/x/dist/workbench.html", page: "workbench.html", argv: [], env: {} });
    check("B7 非开发模式且有 dist：直接载 dist（不碰 dev server）", w2.calls.join(" ") === "file:workbench.html", w2.calls.join(" "));
    const w3 = fakeWin(true);
    ds.loadAppPage(w3, { app: { isPackaged: false }, fs: fsWith(false), distFile: "/x/dist/index.html", page: "", argv: [], env: {} });
    await wait(10);
    check("B8 无 dist 且未打包：试 dev server（默认地址），失败再 loadFile", w3.calls.join(" ") === "url:http://localhost:5173/ file:index.html", w3.calls.join(" "));
    const w4 = fakeWin(false);
    ds.loadAppPage(w4, { app: { isPackaged: true }, fs: fsWith(false), distFile: "/x/dist/index.html", page: "", argv: ["--dev-server"], env: {} });
    check("B9 打包版：即便带 --dev-server、dist 缺失也绝不连 dev server", w4.calls.length === 0, w4.calls.join(" "));
    // watchdog：本地起一个服务当 dev server
    const hits = [];
    const server = http.createServer((req, res) => { hits.push(`${req.method} ${req.url}`); res.statusCode = 404; res.end(); });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${server.address().port}/`;
    let gone = 0;
    const stop = ds.startWatchdog({ url, intervalMs: 40, timeoutMs: 500, maxMisses: 3, onGone: () => gone++ });
    await wait(260);
    check("B10 watchdog 探测的就是配置的地址（HEAD /；404 也算服务还在）", hits.length >= 3 && hits.every((h) => h === "HEAD /") && gone === 0, `${hits.length} 次：${hits.slice(0, 3).join(",")} gone=${gone}`);
    await new Promise((r) => server.close(r));
    const t0 = Date.now();
    while (gone === 0 && Date.now() - t0 < 3000) await wait(20);
    check("B11 服务消失 → 连续 3 次失败后 onGone（只触发一次）", gone === 1, `gone=${gone} 用时 ${Date.now() - t0}ms`);
    await wait(200);
    check("B11b onGone 之后不再重复触发", gone === 1, gone);
    stop();
    const hits2 = [];
    const server2 = http.createServer((req, res) => { hits2.push(req.url); res.end(); });
    await new Promise((r) => server2.listen(0, "127.0.0.1", r));
    let gone2 = 0;
    const stop2 = ds.startWatchdog({ url: `http://127.0.0.1:${server2.address().port}/`, intervalMs: 40, maxMisses: 3, onGone: () => gone2++ });
    await wait(130);
    stop2();
    const n = hits2.length;
    await wait(200);
    check("B12 stop() 之后不再探测", n >= 1 && hits2.length === n && gone2 === 0, `${n} → ${hits2.length}`);
    await new Promise((r) => server2.close(r));
    // 源码契约：electron/ 下不再写死 dev server 地址 / 不再用 argv.includes("--dev-server")
    const elFiles = fs.readdirSync(path.join(ROOT, "electron")).filter((f) => f.endsWith(".js") && f !== "devServer.js");
    const literal = elFiles.filter((f) => /["'`]https?:\/\/localhost:5173/.test(read(`electron/${f}`)));
    check("B13 electron/ 下（devServer.js 以外）无 localhost:5173 字面地址", literal.length === 0, literal.join(","));
    const includes = elFiles.filter((f) => /argv\.includes\(\s*["']--dev-server["']\s*\)/.test(read(`electron/${f}`)));
    check("B14 开发模式判定统一走 isDevServerMode（argv.includes 认不出 =<url> 形式）", includes.length === 0, includes.join(","));
    const users = ["main.js", "workbenchWindow.js", "quickCapture.js"].filter((f) => /loadAppPage\(/.test(read(`electron/${f}`)));
    check("B15 三个窗口（主窗口 / 制卡台 / 快速记录）同一载入实现", users.length === 3, users.join(","));
    check("B16 主进程 watchdog 用 devServer 地址", /devServer\.startWatchdog\(\{\s*url,/.test(read("electron/main.js")) && /const url = devServer\.devServerUrl\(\)/.test(read("electron/main.js")), "未接线");

    // ---------------- C console-message ----------------
    console.log("== C console-message 弃用参数迁移 ==");
    for (const f of ["tests/pdf.kernel.cjs", "tests/reader.kernel.cjs"]) {
      const s = read(f);
      check(`C1 ${path.basename(f)}：单参数监听器取 event.message`, /on\("console-message", \(event\) => \{\s*logLine\("\[renderer\] " \+ event\.message\)/.test(s) && !/on\("console-message", \(_e, _level, message\)/.test(s), "仍为位置参数");
    }
    // Electron 的弃用提示走 console.warn("(electron) …")（不是 process 'warning' 事件）→ 截获主进程 console.warn
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...a) => { warnings.push(a.map(String).join(" ")); origWarn.apply(console, a); };
    const deprecations = () => warnings.filter((m) => /console-message/i.test(m) && /deprecat/i.test(m)).length;
    const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
    try {
      await win.loadURL("data:text/html,<title>d239</title>");
      const got1 = [];
      win.webContents.on("console-message", (event) => got1.push(event && event.message));
      await win.webContents.executeJavaScript('console.log("d239-probe-1"); 1');
      const t1 = Date.now();
      while (!got1.includes("d239-probe-1") && Date.now() - t1 < 3000) await wait(20);
      await wait(100);
      check("C2 本 Electron 上事件对象带 message（单参数监听器收得到日志）", got1.includes("d239-probe-1"), JSON.stringify(got1));
      check("C3 单参数监听器不触发 console-message 弃用告警", deprecations() === 0, warnings.join(" | "));
      // 对照：再挂一个四参数旧监听器（同一窗口），看旧写法是否走弃用路径
      const got2 = [];
      // eslint-disable-next-line no-unused-vars
      win.webContents.on("console-message", (_e, _level, message, _line, _src) => got2.push(message));
      await win.webContents.executeJavaScript('console.log("d239-probe-2"); 1');
      const t2 = Date.now();
      while (!got2.includes("d239-probe-2") && Date.now() - t2 < 3000) await wait(20);
      await wait(100);
      console.log(`  · 对照（四参数旧监听器）：收到 ${JSON.stringify(got2)}，弃用告警 ${deprecations()} 条${deprecations() > 0 ? "——旧写法确实走弃用路径（迁移前两个内核测试助手每次运行都会打这条）" : "（本版本未发告警）"}`);
    } finally {
      console.warn = origWarn;
      win.destroy();
    }

    // ---------------- D 过时注释 ----------------
    console.log("== D 过时注释 ==");
    check("D1 backup.js / db.js 不再写「把内存库刷盘」（sql.js 内存库已退役，现为 WAL checkpoint）", !/先把内存库刷盘/.test(read("electron/backup.js")) && !/备份\/恢复前把内存库刷盘/.test(read("electron/db.js")) && /WAL checkpoint/.test(read("electron/backup.js")), "仍在");

    // ---------------- E GUI 流程启动连不上时不挂住驱动 ----------------
    console.log("== E GUI 流程驱动（tests/flows/lib/guienv.cjs）不挂起 ==");
    const genv = require(path.join(ROOT, "tests", "flows", "lib", "guienv.cjs"));
    // E1：调试端口收下连接却永不应答（应用主线程被模态框卡住时 /json 就是这样）→ connect 仍按截止时间返回
    const mute = http.createServer(() => { /* 永不应答 */ });
    await new Promise((r) => mute.listen(0, "127.0.0.1", r));
    const tE1 = Date.now();
    const conn = await Promise.race([genv.connect(mute.address().port, null, 2500), wait(20000).then(() => ({ hung: true }))]);
    const msE1 = Date.now() - tE1;
    mute.closeAllConnections && mute.closeAllConnections();
    await new Promise((r) => mute.close(r));
    check("E1 调试端口不应答时 connect 按截止时间返回 timeout（单次探测限时，不再一次 fetch 吃掉 300 s）", conn.timeout === true && msE1 < 12000, `${JSON.stringify(conn)} 用时 ${msE1}ms`);
    // E2：收不到 SIGTERM 的子进程（模拟停在模态框上的应用）→ shutdown 兜底强制结束
    const stubborn = require("child_process").spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000); console.log('up')"], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "pipe", "ignore"] });
    await new Promise((r) => { stubborn.stdout.once("data", r); setTimeout(r, 3000); });
    const tE2 = Date.now();
    await genv.shutdown({ child: stubborn });
    const t2b = Date.now();
    while (stubborn.exitCode === null && stubborn.signalCode === null && Date.now() - t2b < 3000) await wait(20);
    const aliveE2 = stubborn.exitCode === null && stubborn.signalCode === null;
    if (aliveE2) { try { stubborn.kill("SIGKILL"); } catch { /* 已退 */ } }
    check("E2 子进程不理 SIGTERM 时 shutdown 兜底强制结束（驱动不再被子进程句柄拖住）", !aliveE2 && Date.now() - tE2 < 9000, `仍在=${aliveE2} 退出码=${stubborn.exitCode} 信号=${stubborn.signalCode} 用时 ${Date.now() - tE2}ms`);
    check("E3 launch 连不上（超时）时就地结束所起应用（各流程在这条路上直接 return、不收尾）", /const conn = await connect\(port, child\);\s*(\/\/[^\n]*\n\s*)*if \(conn\.timeout\) await shutdown\(\{ child \}\);/.test(read("tests/flows/lib/guienv.cjs")), "launch 未收尾");
  } catch (e) {
    console.error("测试异常：", (e && e.stack) || e);
    fail++;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 清理失败不掩盖结果 */ }
    console.log(`\n==== d239-dev-hygiene：${pass} 通过 / ${fail} 失败 ====`);
    finished = true;
    app.exit(fail > 0 ? 1 : 0);
  }
});
