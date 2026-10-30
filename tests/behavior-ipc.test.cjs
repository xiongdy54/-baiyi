// @runtime: electron-node
// D248 / T5：BDI 采集桥——角色裁剪矩阵、preload/主进程角色门、batch 校验（世代/条数/来源不可伪造）。
// 运行：node scripts/run-tests.mjs behavior-ipc
// 隔离：fs.mkdtempSync 临时目录 + 真实 behavior.db。
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const roles = require(path.join(ROOT, "electron", "behavior", "roles.js"));
const behavior = require(path.join(ROOT, "electron", "behavior", "index.js"));
const { uuid7 } = require(path.join(ROOT, "electron", "behavior", "uuid7.js"));

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
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

(async () => {
  console.log("== A 角色矩阵与 URL 判定 ==");
  check("main：batch + status + query", roles.canCall("main", "batch") && roles.canCall("main", "status") && roles.canCall("main", "query"), true, roles.ROLE_METHODS.main);
  check("lens/workbench 无 query 权限（主进程复核）", !roles.canCall("lens", "query") && !roles.canCall("workbench", "query"), "拒绝", "放行");
  check("lens：batch + status", roles.canCall("lens", "batch") && roles.canCall("lens", "status"), true, roles.ROLE_METHODS.lens);
  check("workbench：batch + status", roles.canCall("workbench", "batch") && roles.canCall("workbench", "status"), true, roles.ROLE_METHODS.workbench);
  check("capture：只有 batch，没有 status", roles.canCall("capture", "batch") && !roles.canCall("capture", "status"), "batch only", roles.ROLE_METHODS.capture);
  check("未知角色一律无权", !roles.canCall("hacker", "batch") && !roles.canCall(undefined, "status"), "拒绝", "放行");
  check("roleFromUrl：index/lens/workbench/capture", JSON.stringify([
    roles.roleFromUrl("file:///x/dist/index.html"), roles.roleFromUrl("http://localhost:5173/lens.html"),
    roles.roleFromUrl("file:///x/workbench.html"), roles.roleFromUrl("file:///x/capture.html"),
  ]), JSON.stringify(["main", "lens", "workbench", "capture"]));
  check("roleFromUrl：其他页面返回 null（拒绝）", roles.roleFromUrl("file:///x/other.html") === null && roles.roleFromUrl("") === null, null, roles.roleFromUrl("file:///x/other.html"));

  console.log("== B preload 角色裁剪（静态） ==");
  const preload = read("electron/preload.js");
  const capturePreload = read("electron/preload-capture.js");
  check("主 preload 暴露 behaviorAPI（batch/onConfig/status）", /behaviorAPI/.test(preload) && /"behavior:batch"/.test(preload) && /"behavior:config"/.test(preload) && /"behavior:status"/.test(preload), "三方法", "缺");
  check("主 preload 暴露具名 query（权限由主进程角色门复核）", /behaviorAPI/.test(preload) && /"behavior:query"/.test(preload), "query", "缺");
  check("主 preload 暴露管理面（export/purge/clearQueryText/retention，主进程复核）",
    /"behavior:export"/.test(preload) && /"behavior:purge"/.test(preload) && /"behavior:clearQueryText"/.test(preload) && /"behavior:retention"/.test(preload), "四方法", "缺");
  check("lens/workbench/capture 无管理面权限（角色矩阵）", !roles.canCall("lens", "purge") && !roles.canCall("workbench", "export") && !roles.canCall("capture", "clearQueryText"), "拒绝", "放行");
  check("捕获 preload 只有 batch/onConfig", /behaviorAPI/.test(capturePreload) && /"behavior:batch"/.test(capturePreload) && /"behavior:config"/.test(capturePreload) && !/"behavior:status"/.test(capturePreload), "batch+onConfig", "越权");
  check("捕获窗口加载的是 preload-capture.js（与主 preload 文件分离）", /preload-capture\.js/.test(read("electron/quickCapture.js")), "分离", "混用");
  const wbSrc = read("electron/workbenchWindow.js");
  const capSrc = read("electron/quickCapture.js");
  const mainSrc = read("electron/main.js");
  check("窗口工厂注入 --bdi-role（workbench/capture/main；lens 窗口已随结构流 v3.1 退役）",
    /--bdi-role=workbench/.test(wbSrc) && /--bdi-role=capture/.test(capSrc) && /--bdi-role=main/.test(mainSrc), "三窗口", "缺");

  console.log("== C 主进程角色门（静态） ==");
  check("behavior:batch 按 canCall 复核（不信任渲染层）", /canCall\(role, "batch"\)/.test(mainSrc), "门存在", "缺");
  check("behavior:status 按 canCall 复核", /canCall\(role, "status"\)/.test(mainSrc), "门存在", "缺");
  check("只认顶层帧（senderFrame === mainFrame）", /frame !== e\.sender\.mainFrame/.test(mainSrc), "顶层帧", "缺");

  console.log("== D acceptBatch 真实库集成 ==");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bdi-ipc-"));
  behavior.resetForTest();
  const st = await behavior.init({
    dataDir: dir,
    settings: () => ({ app: {} }),
    appVersion: "9.9.9",
    os: "test-os",
    locale: "en",
    deviceId: "dev-x",
    windows: () => [],
  });
  check("BDI init ok（开启采集）", st.status === "ok", "ok", st);
  const sid = behavior.getSessions().getSessionId();
  const gen = behavior.getGeneration();

  const r1 = behavior.acceptBatch({
    generation: gen, renderId: "render-1", windowId: 2,
    events: [{ type: "nav.view", src: "main", ts: 1761609600000, props: { from: "shelf", to: "reader" } }],
    spans: [],
  }, "lens");
  check("lens 批次接收 1 条", r1.ok === true && r1.accepted === 1, { ok: true, accepted: 1 }, r1);
  behavior.flushSync();
  const db = behavior.getDb();
  const ev = db.prepare("SELECT * FROM events WHERE type = 'nav.view'").get();
  check("src 被强制为真实角色（自报 main 被覆盖为 lens）", ev && ev.src === "lens", "lens", ev && ev.src);
  check("session_id / render_id / day 由宿主补齐", ev && ev.session_id === sid && ev.render_id === "render-1" && /^\d{4}-\d{2}-\d{2}$/.test(ev.day), "补齐", ev && { s: ev.session_id, r: ev.render_id, d: ev.day });

  const stale = behavior.acceptBatch({ generation: gen + 99, events: [{ type: "nav.view", props: { from: "a", to: "b" } }], spans: [] }, "main");
  check("旧世代批次被拒（stale_generation）", stale.ok === false && stale.code === "stale_generation", "stale_generation", stale);
  const many = behavior.acceptBatch({ generation: gen, events: Array.from({ length: 101 }, () => ({ type: "nav.view", props: { from: "a", to: "b" } })), spans: [] }, "main");
  check("超过 100 条被拒（batch_too_large）", many.ok === false && many.code === "batch_too_large", "batch_too_large", many);

  const spanIn = {
    uid: uuid7(), start_ts: 1761609600000, end_ts: 1761609601000, surface: "read",
    active_ms: 1000, idle_ms: 0, mono_ms: 1000, revision: 1, pos_ranges: [[0, 100]],
  };
  const r2 = behavior.acceptBatch({ generation: gen, events: [], spans: [spanIn] }, "capture");
  check("capture 批次接收 span", r2.ok === true && r2.accepted === 1, { ok: true, accepted: 1 }, r2);
  behavior.flushSync();
  const sp = db.prepare("SELECT * FROM attn_spans WHERE uid = ?").get(spanIn.uid);
  check("span src=capture / session / day / cutoff 由宿主补齐", sp && sp.src === "capture" && sp.session_id === sid && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) && Number.isInteger(sp.cutoff_hour), "补齐", sp);

  console.log("== E publicStatus 最小面 ==");
  const ps = behavior.publicStatus();
  check("status/generation/enabled 字段", ps.status === "ok" && ps.generation === gen && ps.enabled === true, "ok/1/true", ps);
  check("不泄露文件路径与策略内部字段", !("file" in ps.db) && !("policy" in ps) && !("dataEpoch" in ps), "最小面", Object.keys(ps));

  behavior.close();
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* 系统临时目录 */ }
  behavior.resetForTest();
  console.log(`\n==== behavior-ipc ${pass}/${pass + fail} 断言 ====`);
  if (fail > 0) console.log(`  失败 ${fail} 项`);
  process.exitCode = fail === 0 ? 0 : 1;
})().catch((e) => {
  console.error("顶层异常：" + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
