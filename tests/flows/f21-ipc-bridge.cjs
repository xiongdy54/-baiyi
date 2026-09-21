// F21 进程间桥面对账（换角度：把 IPC 通道与 window API 桥当接口清单来盘）
// @runtime: node  @tier: 1  @gui: false  @id: F21  @timeout: 120
// 运行：node tests/flows/f21-ipc-bridge.cjs
//
// 角度：本应用有三个进程面：主进程注册通道、两个 preload 各搭一座桥（主窗口 / 捕获小窗）、
//       渲染层只认 window.xxxAPI。通道名打错一个字母、注册了没人调、广播了没人听，
//       全都**不报错**——只是那个功能静默失效。§7.5 把「渲染层不持有密钥、能力经 preload 白名单」
//       当安全底线，底线之下的这层胶水此前没有任何机器检查（既有套件只测单条通道的行为）。
//
// 依据：§4 接口清单（通道命名 domain:verb）、§7.5（进程边界与 preload 能力白名单）、
//       §7.1.3（改一处要能被发现）、§4.18（memory:* 事件族）、§9.1 M2（备份/进度事件）。
"use strict";
const fs = require("fs");
const path = require("path");
const { Flow, runFlow, ROOT } = require("./lib/harness.cjs");

const flow = new Flow({
  id: "F21",
  title: "进程间桥面对账",
  angle: "通道注册 / preload 调用 / 渲染层使用 / 事件订阅 四向对账",
  cites: ["§4 接口清单", "§7.5", "§7.1.3", "§4.18", "§9.1 M2"],
  tier: 1,
  gui: false,
});

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const linesOf = (rel) => read(rel).split(/\r?\n/);
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

/** 递归收集某目录下的源文件 */
function walk(dir, re, out = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name === ".git") continue;
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, re, out);
    else if (re.test(e.name)) out.push(rel.replace(/\\/g, "/"));
  }
  return out;
}

const MAIN_FILES = walk("electron", /\.js$/);
const SRC_FILES = walk("src", /\.(ts|tsx)$/);

/** 抓出文件里出现的通道名（带行号与角色） */
function scan(rel) {
  const out = { reg: [], inv: [], on: [], send: [], api: [] };
  linesOf(rel).forEach((line, i) => {
    let m;
    const push = (arr, v) => { if (v && !arr.some((x) => x.ch === v)) arr.push({ ch: v, at: `${rel}:${i + 1}` }); };
    const reReg = /ipcMain\s*\.\s*(?:handle|on)\s*\(\s*["'`]([^"'`]+)["'`]/g;
    while ((m = reReg.exec(line))) push(out.reg, m[1]);
    const reInv = /ipcRenderer\s*\.\s*(?:invoke|send|sendSync)\s*\(\s*["'`]([^"'`]+)["'`]/g;
    while ((m = reInv.exec(line))) push(out.inv, m[1]);
    const reOn = /ipcRenderer\s*\.\s*on\s*\(\s*["'`]([^"'`]+)["'`]/g;
    while ((m = reOn.exec(line))) push(out.on, m[1]);
    const reSend = /(?:webContents|contents|sender|\bw|\bwin|\.win)\s*\.\s*send\s*\(\s*["'`]([^"'`]+)["'`]/g;
    while ((m = reSend.exec(line))) push(out.send, m[1]);
    const reApi = /exposeInMainWorld\s*\(\s*["'`]([^"'`]+)["'`]/g;
    while ((m = reApi.exec(line))) push(out.api, m[1]);
  });
  return out;
}

const scans = {};
for (const f of MAIN_FILES) scans[f] = scan(f);
const PRELOADS = MAIN_FILES.filter((f) => /preload[^/]*\.js$/.test(f));
const CAPTURE_SIDE = /^(src\/capture\.tsx?|src\/components\/Capture[A-Za-z]*\.tsx?)$/;

/** preload 暴露的 window API → 成员方法名 */
function exposedApis(rel) {
  const t = read(rel);
  const out = {};
  const re = /exposeInMainWorld\s*\(\s*["'`]([^"'`]+)["'`]\s*,\s*\(\s*\{([\s\S]*?)\}\s*\)\s*\)/g;
  let m;
  const blocks = [];
  const start = /\(\s*["'`]([A-Za-z]+API)["'`]\s*,\s*\{/g;
  while ((m = start.exec(t))) {
    let i = m.index + m[0].length - 1;
    let depth = 0;
    let j = i;
    for (; j < t.length; j++) {
      if (t[j] === "{") depth++;
      else if (t[j] === "}") { depth--; if (depth === 0) break; }
    }
    blocks.push({ name: m[1], body: t.slice(i + 1, j) });
  }
  for (const b of blocks) {
    const keys = [...b.body.matchAll(/(?:^|[,{\s])([a-zA-Z][\w$]*)\s*:\s*(?:async\s*)?(?:\(|function|\[|[A-Za-z_$])/g)].map((x) => x[1]);
    out[b.name] = [...new Set(keys)];
  }
  return out;
}

runFlow(flow, async () => {
  // ---------- X1 通道注册 ↔ preload 调用 ----------  flow.section("X1 每条通道都必须「主进程注册 + 桥面调用」两头齐（缺一头的功能＝静默失效）");
  const registered = new Map();
  for (const f of MAIN_FILES) for (const r of scans[f].reg) if (!registered.has(r.ch)) registered.set(r.ch, r.at);
  const invoked = new Map();
  for (const f of PRELOADS) for (const r of scans[f].inv) if (!invoked.has(r.ch)) invoked.set(r.ch, r.at);
  const mainInvoked = new Map();
  for (const f of MAIN_FILES.filter((x) => !PRELOADS.includes(x))) for (const r of scans[f].inv) if (!mainInvoked.has(r.ch)) mainInvoked.set(r.ch, r.at);
  const orphanCall = [...invoked.keys()].filter((c) => !registered.has(c)).sort();
  flow.check("桥面调用的每条通道都在主进程注册过（否则运行时 No handler registered）", orphanCall.length === 0, "两头齐", orphanCall.map((c) => `${c} ← ${invoked.get(c)}`));
  const noCaller = [...registered.keys()].filter((c) => !invoked.has(c) && !mainInvoked.has(c)).sort();
  flow.record("注册数 / 桥面调用数 / 主进程内部转发数", `${registered.size} / ${invoked.size} / ${mainInvoked.size}`);
  flow.record("注册后两头都没调用的通道", noCaller.join(" ") || "（无）");
  flow.check("不得存在两头都没调用的死通道（要么接上，要么删掉）", noCaller.length === 0, "无死通道", noCaller.map((c) => `${c} @ ${registered.get(c)}`));

  // ---------- X2 桥面按窗口分域 ----------
  flow.section("X2 两座桥各有边界：捕获小窗的 API 不能被主窗口代码用（反之亦然）");
  const exposed = {};
  for (const p of PRELOADS) for (const [k, v] of Object.entries(exposedApis(p))) (exposed[k] = exposed[k] || { where: [], members: v }).where.push(p);
  flow.record("桥面清单", PRELOADS.map((p) => `${p}: ${Object.keys(exposedApis(p)).join(",")}`).join("  |  "));
  const crossUse = [];
  for (const f of SRC_FILES) {
    const isCapture = CAPTURE_SIDE.test(f);
    for (const m of read(f).matchAll(/window\.([a-zA-Z]+API)\b/g)) {
      const api = m[1];
      if (!exposed[api]) { crossUse.push(`${f}: window.${api} 从未被任何 preload 暴露`); continue; }
      const owners = exposed[api].where;
      const ownerIsCapture = owners.some((o) => /capture/.test(o));
      const ownerIsMain = owners.some((o) => !/capture/.test(o));
      if (isCapture && ownerIsMain && !ownerIsCapture) crossUse.push(`${f}（捕获窗）用了只在主窗口暴露的 ${api}`);
      if (!isCapture && ownerIsCapture && !ownerIsMain) crossUse.push(`${f}（主窗口）用了只在捕获窗暴露的 ${api}`);
    }
  }
  flow.check("渲染层用到的每个 window API 都存在且属于自己那一扇窗", crossUse.length === 0, "分域正确", crossUse);

  // ---------- X3 事件广播方向 ----------
  flow.section("X3 主进程广播的事件必须有人听（没人听的 send = 功能静默失效）");
  const subscribed = new Map();
  for (const f of PRELOADS) for (const r of scans[f].on) if (!subscribed.has(r.ch)) subscribed.set(r.ch, r.at);
  const broadcast = new Map();
  for (const f of MAIN_FILES) for (const r of scans[f].send) if (/[a-z]+:[a-zA-Z]+/.test(r.ch) && !broadcast.has(r.ch)) broadcast.set(r.ch, r.at);
  const deaf = [...broadcast.keys()].filter((c) => !subscribed.has(c)).sort();
  flow.record("广播通道数 / 桥面订阅数", `${broadcast.size} / ${subscribed.size}`);
  flow.record("订阅清单", [...subscribed.keys()].join(" "));
  flow.check("每条 send 出去的领域事件都要有桥面订阅（没人听＝功能静默失效）", deaf.length === 0, "有人听", deaf.map((c) => `${c} @ ${broadcast.get(c)}`));

  // ---------- X4 命名与注册纪律 ----------
  flow.section("X4 通道命名 domain:verb、同一通道只注册一次、不得既 handle 又 on");
  const badName = [...registered.keys()].filter((c) => !/^[a-z][\w-]*:[a-zA-Z][\w-]*$/.test(c));
  flow.check("通道名一律 domain:verb 小驼峰", badName.length === 0, "全部合规", badName);
  const dupReg = [];
  for (const c of registered.keys()) {
    const hits = MAIN_FILES.filter((f) => scans[f].reg.some((r) => r.ch === c));
    if (hits.length > 1) dupReg.push(`${c} @ ${hits.join(" ")}`);
  }
  flow.check("同一通道不得在多处注册（改行为时只改一处＝另一个赢）", dupReg.length === 0, "单一注册", dupReg);
  const domainCount = {};
  for (const c of registered.keys()) { const d = c.split(":")[0]; domainCount[d] = (domainCount[d] || 0) + 1; }
  flow.record("通道域分布", Object.entries(domainCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" "));

  // ---------- X5 文档点名的通道要真实存在 ----------
  flow.section("X5 指导文档点名的通道必须真实注册（文档先行，通道要落地）");
  const guide = read("AI_DEVELOPMENT_GUIDE.md");
  const docChannels = [...new Set([...guide.matchAll(/["'`]?([a-z][\w-]*:[a-zA-Z][\w-]*)["'`]?\s*[（(]/g)].map((m) => m[1]))];
  const domains = new Set([...registered.keys()].map((c) => c.split(":")[0]));
  const missing = docChannels.filter((c) => domains.has(c.split(":")[0]) && !registered.has(c));
  flow.record("文档点名且域已存在的通道数", `${docChannels.filter((c) => domains.has(c.split(":")[0])).length}（抓到的候选 ${docChannels.length}）`);
  flow.known("文档括号点名的通道都要能在主进程找到注册（含 §4.18 的 memory:* 一族）", missing.length === 0, "D-DOC-04", "全部落地", missing);
}).then((s) => {
  process.exit(s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length ? 1 : 0);
});
