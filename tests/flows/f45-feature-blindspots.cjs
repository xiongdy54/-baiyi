// F45 功能面测试盲区清点（IPC 通道 × 测试引用 反向对账）
// @runtime: node  @tier: 2  @gui: false  @id: F45  @timeout: 180
// 运行：node tests/flows/f45-feature-blindspots.cjs
//
// 角度：既有 44 条流程回答「我测的东西对不对」，没有一条回答「**没被任何东西测过的功能有哪些**」。
//       F24 量的是指导文档章节 ↔ 流程引用；F21 量的是主进程 handler ↔ preload 桥 ↔ 渲染层调用三向对账。
//       本条量的是**功能面 ↔ 测试代码**：以主进程 167 个 IPC handler 为用户可触达功能的普查底稿，
//       逐个在 tests/ 全量源码里找引用，落到「零测试引用」的清单上。
//       判据口径：通道全名命中 = 强覆盖；仅「域:动词」的动词部分命中 = 弱覆盖（可能经 preload 包装调用）；
//       两者都不命中 = 盲区。只把「两者都不命中」计为硬盲区，避免把 preload 改名包装误判成没测。
"use strict";
const fs = require("fs");
const path = require("path");
const { Flow, runFlow, ROOT, RESULTS_DIR } = require("./lib/harness.cjs");

const flow = new Flow({
  id: "F45",
  title: "功能面测试盲区清点",
  angle: "反向对账：每个用户可触达功能是否至少被一个测试引用（测试的测试）",
  cites: ["§7.3", "§7.1.4", "§9.1"],
  tier: 2,
  gui: false,
});

// 硬盲区棘轮基线：登记于 2026-09-23 首轮实测值；只允许下降，不允许上升。
const HARD_BLINDSPOT_BASELINE = 0; // 首轮跑完后由主会话回填实测值

function readIf(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

/** 收集 tests/ 下所有测试源码（排除产物与沙箱） */
function collectTestSources() {
  const skip = new Set(["node_modules", ".git", "results", "fixtures", "tmp-m7"]);
  const out = [];
  const stack = [path.join(ROOT, "tests")];
  while (stack.length) {
    const d = stack.pop();
    let names = [];
    try {
      names = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of names) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) {
        if (!skip.has(ent.name)) stack.push(full);
        continue;
      }
      if (!/\.(cjs|mjs|js|ts)$/.test(ent.name)) continue;
      if (/\.(bundle\.cjs|last\.json)$/.test(ent.name)) continue;
      const src = readIf(full);
      if (src) out.push({ file: path.relative(ROOT, full).replace(/\\/g, "/"), src });
    }
  }
  return out;
}

/** 主进程注册的 IPC 通道：ipcMain.handle("x") / ipcMain.on("x") */
function declaredChannels(mainSrc) {
  const seen = new Map();
  const dupes = [];
  const re = /ipcMain\.(handle|on)\(\s*["'`]([^"'`]+)["'`]/g;
  let m;
  while ((m = re.exec(mainSrc))) {
    const key = `${m[1]}:${m[2]}`;
    if (seen.has(m[2]) && seen.get(m[2]) !== m[1]) {
      // 同名通道既是 handle 又是 on：invoke/send 混用，前端用错就是静默失效
      dupes.push({ channel: m[2], both: [seen.get(m[2]), m[1]] });
    }
    if (seen.has(m[2]) && seen.get(m[2]) === m[1]) {
      dupes.push({ channel: m[2], doubleRegister: true });
    }
    seen.set(m[2], m[1]);
  }
  return { channels: [...seen.keys()], kinds: seen, dupes };
}

/** preload 桥暴露的方法名集合（用于识别「渲染层叫什么」） */
function preloadSurface(preloadSrc) {
  const map = new Map(); // channel -> [apiPath]
  const re = /([A-Za-z0-9_$]+)\s*:\s*(?:async\s*)?\(?([^)]*)\)?\s*=>?\s*[\{]?\s*(?:return\s*)?ipcRenderer\.(?:invoke|send)\(\s*["'`]([^"'`]+)["'`]/g;
  let m;
  while ((m = re.exec(preloadSrc))) map.set(m[3], (map.get(m[3]) || []).concat(m[1]));
  return map;
}

function hitsIn(sources, needle) {
  const files = [];
  for (const s of sources) if (s.src.includes(needle)) files.push(s.file);
  return files;
}

runFlow(flow, async () => {
  const mainSrc = readIf(path.join(ROOT, "electron", "main.js"));
  flow.check("读到了 electron/main.js", mainSrc.length > 1000, ">1000 字节", mainSrc.length);

  const { channels, kinds, dupes } = declaredChannels(mainSrc);
  flow.check("IPC 通道普查非空（≥150，与 F21 的 165 条同量级）", channels.length >= 150, "≥150", channels.length);

  const preloadSrc = readIf(path.join(ROOT, "electron", "preload.js")) + readIf(path.join(ROOT, "electron", "preload-capture.js"));
  const apiNames = preloadSurface(preloadSrc);

  const sources = collectTestSources();
  flow.record("参与对账的测试源文件数", sources.length);
  flow.record("主进程通道总数", channels.length);

  flow.section("S1 通道注册形状（同名双注册 = 前端 invoke/send 用错就静默失效）");
  flow.eq("没有通道同时被 handle 和 on 注册", dupes.filter((d) => d.both), []);
  const namingOff = channels.filter((c) => !/^[a-z][a-z0-9-]*(?::[A-Za-z][A-Za-z0-9]*)$/.test(c));
  flow.check("通道命名一律 domain:verb 形状", namingOff.length === 0, "0 个越界", namingOff.slice(0, 12));

  flow.section("S2 功能面 ↔ 测试引用 反向对账");
  const strong = [];
  const weak = [];
  const blind = [];
  for (const ch of channels) {
    const exact = hitsIn(sources, `"${ch}"`) .length ? hitsIn(sources, `"${ch}"`) : hitsIn(sources, `'${ch}'`);
    if (exact.length) {
      strong.push({ ch, files: exact.slice(0, 3) });
      continue;
    }
    const verb = ch.includes(":") ? ch.split(":")[1] : ch;
    const apiPath = apiNames.get(ch) || [];
    const weakNeedles = [`.${verb}(`, ...apiPath.map((a) => `.${a}(`)];
    const weakFiles = [];
    for (const s of sources) if (weakNeedles.some((n) => s.src.includes(n))) weakFiles.push(s.file);
    if (weakFiles.length) weak.push({ ch, verb, api: apiPath, files: weakFiles.slice(0, 3) });
    else blind.push({ ch, kind: kinds.get(ch), api: apiPath });
  }
  flow.record("强覆盖（通道全名在测试里出现）", `${strong.length} / ${channels.length}`);
  flow.record("弱覆盖（仅方法名/别名出现，经 preload 包装）", `${weak.length} / ${channels.length}`);
  flow.record("硬盲区（测试代码里一个字都没出现过）", `${blind.length} / ${channels.length}`);
  const report = {
    at: new Date().toISOString(),
    total: channels.length,
    strong: strong.map((s) => s.ch),
    weak: weak.map((w) => ({ ch: w.ch, api: w.api })),
    blind,
  };
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, "F45.blindspots.json"), JSON.stringify(report, null, 2), "utf8");
  for (const b of blind) flow.record("盲区通道", `${b.kind}:${b.ch}${b.api.length ? ` (preload=${b.api.join("/")})` : " (preload 未暴露)"}`);

  flow.check("硬盲区数量不超过棘轮基线", blind.length <= HARD_BLINDSPOT_BASELINE, `≤${HARD_BLINDSPOT_BASELINE}`, blind.length);

  flow.section("S3 按功能域聚合盲区（逐功能排查的落点）");
  const byDomain = new Map();
  for (const b of blind) {
    const d = b.ch.split(":")[0];
    byDomain.set(d, (byDomain.get(d) || 0) + 1);
  }
  const allByDomain = new Map();
  for (const ch of channels) {
    const d = ch.split(":")[0];
    allByDomain.set(d, (allByDomain.get(d) || 0) + 1);
  }
  for (const [d, n] of [...allByDomain.entries()].sort((a, b) => b[1] - a[1])) {
    flow.record("功能域", `${d}: 通道 ${n} 条，其中硬盲区 ${byDomain.get(d) || 0} 条`);
  }
  const wholeBlindDomains = [...allByDomain.keys()].filter((d) => (byDomain.get(d) || 0) === allByDomain.get(d));
  flow.check(
    "不存在「整个功能域零测试」的情况",
    wholeBlindDomains.length === 0,
    "0 个整域全盲",
    wholeBlindDomains
  );
});
