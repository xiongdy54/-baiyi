// 全流程测试（flow）公共脚手架 —— 不是测试本体，只负责断言、计时、留痕、随机种子。
// 依据：AI_DEVELOPMENT_GUIDE.md §7.1.4（每次完工「启动→主流程→重启不丢数据」可演示）、
//       §7.3 测试义务（核心算法改动必须附可重复运行的自动化测试）、
//       §7.2 数据完整性规则（软删除 / ALTER 迁移 / 即时落盘）。
// 与既有 tests/*.test.cjs 的分工：既有套件按模块纵向覆盖；本目录按「用户旅程 + 跨模块不变量」横向覆盖。
// @runtime: shared
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", ".."); // tests/flows/lib → 仓库根
const RESULTS_DIR = path.join(ROOT, "tests", "flows", "results");

// ---------- 确定性随机（长跑每一轮换种子，失败可复现） ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRng(salt) {
  const seedBase = Number(process.env.FLOW_SEED || 0);
  const seed = (seedBase * 2654435761 + hashStr(salt)) >>> 0;
  const rnd = mulberry32(seed || 1);
  return {
    seed,
    next: rnd,
    int: (n) => Math.floor(rnd() * n),
    pick: (arr) => arr[Math.floor(rnd() * arr.length)],
    bool: (p = 0.5) => rnd() < p,
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------- Flow 脚手架 ----------
class Flow {
  /**
   * @param {{id:string,title:string,angle:string,cites:string[],tier:1|2|3,gui:boolean,timeoutMs?:number}} meta
   */
  constructor(meta) {
    Object.assign(this, meta);
    this.startedAt = Date.now();
    this.cycle = Number(process.env.FLOW_CYCLE || 0);
    this.rng = makeRng(this.id);
    this.results = [];
    this.sectionName = "(未分节)";
    this.aborted = null;
    this.crash = null;
    this.notes = [];
    this.knownFired = [];
    this.knownHealed = [];
  }

  section(name) {
    this.sectionName = name;
    console.log(`\n---- ${this.id} · ${name} ----`);
  }

  /** 主断言：失败不中断（长跑要尽量多收集信号）
   *  参数陷阱防护：check(name, 布尔量, true/false) 这种「只给三个参数且第三个是布尔」的写法，
   *  本意都是等值断言——按 eq 处理，否则 cond=false 会被误判为失败（本套流程踩过四次）。 */
  check(name, cond, expected, actual) {
    if (arguments.length === 3 && typeof expected === "boolean") {
      return this.eq(name, cond, expected);
    }
    const ok = !!cond;
    this.results.push({ section: this.sectionName, name, ok, expected, actual });
    if (ok) {
      console.log(`  ✓ ${name}`);
    } else {
      console.log(
        `  ✗ ${name}\n      期望: ${clip(expected)}\n      实际: ${clip(actual)}`
      );
    }
    return ok;
  }

  eq(name, actual, expected) {
    return this.check(name, JSON.stringify(actual) === JSON.stringify(expected), expected, actual);
  }

  /** 记录观察值，不算断言（用于性能/规模类流程的基线留痕） */
  /** 已登记缺陷的断言：失败记为 known（不淹没新回归）；**意外通过**要反向报警（说明缺陷已修，须撤销登记） */
  known(name, cond, defectId, expected, actual) {
    const ok = !!cond;
    this.results.push({ section: this.sectionName, name, ok, expected, actual, known: defectId });
    if (ok) {
      console.log(`  ⚠ ${name} —— 意外通过：登记的 ${defectId} 似已修复，请撤销登记`);
      this.knownHealed.push({ name, defectId });
    } else {
      console.log(`  ✗(已知) ${name} [${defectId}]\n      期望: ${clip(expected)}\n      实际: ${clip(actual)}`);
      this.knownFired.push({ name, defectId, expected, actual });
    }
    return ok;
  }

  record(key, value) {
    this.notes.push({ key, value, at: Date.now() });
    console.log(`  · ${key} = ${clip(value)}`);
    return value;
  }

  /** 前置条件：失败即中止本流程（避免后续断言在无效状态上刷屏） */
  guard(name, fn) {
    let v = null;
    let err = null;
    try {
      v = fn();
    } catch (e) {
      err = e;
    }
    if (err || !v) {
      this.aborted = { name, err: err ? String(err.message || err) : "返回假值" };
      console.log(`  ! 前置失败，中止本流程：${name}${err ? " — " + err.message : ""}`);
      throw new AbortFlow(name);
    }
    console.log(`  ✓ [前置] ${name}`);
  }

  summary() {
    const pass = this.results.filter((r) => r.ok && !r.known).length;
    const failed = this.results.filter((r) => !r.ok && !r.known);
    const known = this.results.filter((r) => r.known && !r.ok);
    const healed = this.results.filter((r) => r.known && r.ok);
    const dur = Date.now() - this.startedAt;
    // F-审计：崩溃必须在**状态位**上体现。原来 runFlow 只把 crash 塞进 extra，
    // 而 summary() 早已算完状态 → 「跑完第 1 条断言就崩」的流程会打印 PASS、fail=0。
    const crashed = !!this.crash;
    console.log(
      `\n==== ${this.id} ${this.aborted ? "ABORTED" : crashed || failed.length || healed.length ? "FAIL" : "PASS"} ` +
        `${pass}/${this.results.length} 断言 · 已知缺陷 ${known.length} · 意外转绿 ${healed.length} · ${dur}ms · seed=${this.rng.seed} cycle=${this.cycle} ====`
    );
    for (const f of failed) console.log(`  失败: [${f.section}] ${f.name}`);
    return {
      id: this.id,
      title: this.title,
      angle: this.angle,
      cites: this.cites,
      tier: this.tier,
      gui: this.gui,
      cycle: this.cycle,
      seed: this.rng.seed,
      pass,
      fail: failed.length,
      knownFired: known.length,
      knownList: known.map((k) => k.known),
      knownHealed: healed.map((k) => ({ name: k.name, defectId: k.known })),
      total: this.results.length,
      durationMs: dur,
      aborted: this.aborted,
      crash: this.crash ? String(this.crash) : null,
      failures: failed,
      notes: this.notes,
      startedAt: this.startedAt,
    };
  }

  /** 写结果 JSON（长跑编排器与报告都读它） */
  writeResult(extra = {}) {
    const s = { ...this.summary(), ...extra };
    try {
      fs.mkdirSync(RESULTS_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(RESULTS_DIR, `${this.id}.last.json`),
        JSON.stringify(s, null, 2),
        "utf8"
      );
      fs.appendFileSync(
        path.join(RESULTS_DIR, "history.jsonl"),
        JSON.stringify(s) + "\n",
        "utf8"
      );
    } catch (e) {
      console.log(`  ! 结果写盘失败：${e.message}`);
    }
    return s;
  }
}

class AbortFlow extends Error {}

function clip(v, n = 240) {
  let s;
  try {
    s = typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    s = String(v);
  }
  if (s === undefined) s = "undefined";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// 隔离沙箱一律放系统临时目录，不放 tests/tmp-*：
// 后者会被其他会话/脚本按通配清理（实测发生过），长跑期间被删就是假失败。
const os = require("os");
function tmpUserDataDir(label) {
  // FLOW_INSTANCE 让手工调试与长跑各用各的沙箱：同一 label 的两个进程共用目录时，
  // 后起的一方 freshDir() 会把前一方正在写的库抹掉，制造出与产品无关的假失败（实测踩过）。
  const inst = String(process.env.FLOW_INSTANCE || "").replace(/[^A-Za-z0-9_-]/g, "");
  return path.join(os.tmpdir(), "incremental-reading-flows", `flow-${label}${inst ? "-" + inst : ""}-userdata`);
}

function freshDir(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    /* Windows 句柄未释放时忽略，稍后仍可用 */
  }
  fs.mkdirSync(p, { recursive: true });
  return p;
}

/** node 侧运行一个 flow：捕获异常并保证有 JSON 留痕（长跑不能因单点崩溃丢整轮记录） */
async function runFlow(flow, body) {
  let crash = null;
  try {
    await body(flow);
  } catch (e) {
    if (e instanceof AbortFlow) {
      /* 主动中止 */
    } else {
      crash = e;
      console.log(`  ! 未捕获异常：${e && e.stack ? e.stack.split("\n").slice(0, 4).join("\n    ") : e}`);
    }
  }
  if (crash) flow.crash = String(crash.message || crash);
  const s = flow.writeResult();
  // 零断言 = 该轮什么都没验证到，按失败处理（长跑里这是最常见的静默失效）
  if (s.total === 0) {
    console.log("  ! 本轮零断言：视为失败");
    s.aborted = s.aborted || { name: "零断言", err: "flow 未产生任何 check()" };
  }
  // D239：结果不干净（与编排器 run.cjs 的 isCleanPass 同口径）就把退出码置 1——
  // 没有显式退出的 node 流程自然退出时、以 app.exit(process.exitCode || 0) 收尾的 Electron 流程，都据此如实上报，
  // 不再「断言失败、退出码 0」。显式按 s 退出的流程（dbenv.quit(…) / process.exit(s…)）不受影响。
  if (s.fail > 0 || s.aborted || s.crash || (s.knownHealed || []).length) process.exitCode = 1;
  return s;
}

module.exports = {
  Flow,
  AbortFlow,
  runFlow,
  makeRng,
  clip,
  ROOT,
  RESULTS_DIR,
  tmpUserDataDir,
  freshDir,
};
