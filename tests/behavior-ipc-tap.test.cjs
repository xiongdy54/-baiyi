// @runtime: system-node
// D248 / T4：IPC tap——返回值/异常/this 不变、tap 自错不外溢、未登记透传、removeListener/once、
//   behavior:* 自反馈排除、写通道全覆盖、事件投影合法、review.rated tap 时间、短文本剥离（§7.1）。
// 运行：node tests/behavior-ipc-tap.test.cjs（或 node scripts/run-tests.mjs behavior-ipc-tap）
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const taps = require(path.join(ROOT, "electron", "behavior", "taps.js"));
const ipcTap = require(path.join(ROOT, "electron", "behavior", "ipcTap.js"));
const registry = require(path.join(ROOT, "electron", "behavior", "registry.js"));
const { createIpcStats } = require(path.join(ROOT, "electron", "behavior", "ipcStats.js"));

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
const tick = () => new Promise((r) => setImmediate(r));
const CLOCK = 1761609600000;

function fakeIpc() {
  const handles = new Map();
  const ons = new Map();
  const api = {
    handle(ch, fn) { handles.set(ch, fn); return api; },
    on(ch, fn) { if (!ons.has(ch)) ons.set(ch, []); ons.get(ch).push(fn); return api; },
    removeListener(ch, fn) { const a = ons.get(ch) || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); return api; },
    removeAllListeners(ch) { if (ch === undefined) ons.clear(); else ons.delete(ch); return api; },
    invoke(ch, ...args) { return handles.get(ch).call(api, { sender: {} }, ...args); },
    emit(ch, ...args) { for (const fn of ons.get(ch) || []) fn.call(api, { sender: {} }, ...args); },
    _ons: ons,
    _handles: handles,
  };
  return api;
}

function fakeEnv(over = {}) {
  const box = { emitted: [], statsCalls: [], undoDirty: 0 };
  const stats = createIpcStats({ now: () => CLOCK });
  box.env = {
    sessionId: () => "sess-tap",
    now: () => CLOCK,
    cutoffHour: () => 4,
    recordQueryText: () => true,
    stats: { record: (ch, ms, err) => { box.statsCalls.push({ ch, ms, err }); stats.record(ch, ms, err); } },
    markUndoDirty: () => { box.undoDirty++; },
    ...over.env,
  };
  return box;
}

(async () => {
  console.log("== A handle：返回值 / this / 异常 / 参数不变 ==");
  {
    const ipc = fakeIpc();
    const box = fakeEnv();
    const emit = (e) => { box.emitted.push(e); return { ok: true }; };
    // 通过 opts 注入 env，避免依赖 behavior/index
    const inst = ipcTap.install(ipc, emit, { env: box.env });
    ipc.handle("cards:create", function (e, card) {
      box.thisSeen = this === ipc;
      box.argSeen = { e, card };
      return { id: "card-1", cardType: "qa" };
    });
    const ret = ipc.invoke("cards:create", { cardType: "qa", generatedBy: "manual", via: "selection" });
    check("返回值原样（同一对象）", ret.id === "card-1" && ret.cardType === "qa", "原对象", ret);
    check("this 原样绑定 ipcMain", box.thisSeen === true, true, box.thisSeen);
    check("参数原样（sender 事件 + card）", box.argSeen.card.cardType === "qa", "qa", box.argSeen.card);
    await tick();
    const ev = box.emitted.find((x) => x.type === "card.created");
    check("成功事件发射（card_id / via / generatedBy）", !!ev && ev.card_id === "card-1" && ev.props.via === "selection" && ev.props.generatedBy === "manual", "card-1/selection/manual", ev && ev.props);
    check("事件通过 registry 校验（投影合法）", !!ev && registry.validate(ev, { recordQueryText: true }).ok === true, "ok", ev && registry.validate(ev, { recordQueryText: true }));
    check("事件公共字段（src=main / session / day / actor）", !!ev && ev.src === "main" && ev.session_id === "sess-tap" && /^\d{4}-\d{2}-\d{2}$/.test(ev.day) && ev.actor === "unknown", "main/sess/day", ev && { src: ev.src, session: ev.session_id, day: ev.day });

    let threw = null;
    ipc.handle("cards:delete", () => { throw new Error("boom"); });
    try { ipc.invoke("cards:delete", "card-9"); } catch (e) { threw = e; }
    check("异常原样上抛", !!threw && threw.message === "boom", "boom", threw && threw.message);
    await tick();
    check("失败不发射事件", !box.emitted.some((x) => x.type === "card.deleted"), "无", box.emitted.map((x) => x.type));
    check("失败记 err 计数", box.statsCalls.some((c) => c.ch === "cards:delete" && c.err === true), true, box.statsCalls);

    let tapThrew = null;
    const env2 = { ...box.env, cutoffHour: () => { throw new Error("tap bug"); } };
    const ipc2 = fakeIpc();
    ipcTap.install(ipc2, () => { throw new Error("emit bug"); }, { env: env2 });
    ipc2.handle("cards:create", () => ({ id: "card-2" }));
    try { ipc2.invoke("cards:create", { cardType: "qa" }); } catch (e) { tapThrew = e; }
    check("tap 自身抛错不外溢（业务返回不受影响）", tapThrew === null, null, tapThrew && tapThrew.message);
    inst.uninstall();
  }

  console.log("== B 成功谓词与投影 ==");
  {
    const ipc = fakeIpc();
    const box = fakeEnv();
    const inst = ipcTap.install(ipc, (e) => { box.emitted.push(e); }, { env: box.env });
    ipc.handle("cards:create", () => null);
    ipc.invoke("cards:create", { cardType: "qa" });
    await tick();
    check("返回 null 不发射（不把失败当成功）", box.emitted.length === 0, 0, box.emitted.length);

    ipc.handle("cards:review", () => true);
    ipc.invoke("cards:review", "card-3", {}, "good", 1234, {});
    ipc.invoke("cards:review", "card-3", {}, "good", 2345, {});
    await tick();
    const rated = box.emitted.filter((x) => x.type === "review.rated");
    check("review.rated 每次评分一条", rated.length === 2, 2, rated.length);
    check("tap 时间字段非空且单调", rated.every((e) => Number.isFinite(e.props.tapStartTs) && Number.isFinite(e.props.tapEndTs) && e.props.tapEndTs >= e.props.tapStartTs), "非空", rated.map((e) => e.props));
    check("tapSeq 严格递增", rated[1].props.tapSeq > rated[0].props.tapSeq, "递增", rated.map((e) => e.props.tapSeq));
    check("不存 rating（事件 props 无 rating）", rated.every((e) => !("rating" in e.props)), "无 rating", rated[0].props);
    check("review.rated 通过校验", registry.validate(rated[0], { recordQueryText: true }).ok, "ok", registry.validate(rated[0], { recordQueryText: true }));

    ipc.handle("cards:undoReview", () => ({ ok: true, cardId: "card-3" }));
    ipc.invoke("cards:undoReview");
    await tick();
    check("undo 成功标 dirty（当前日 + 前一日）", box.undoDirty === 1, 1, box.undoDirty);
    check("review.undone 带 card_id", box.emitted.some((e) => e.type === "review.undone" && e.card_id === "card-3"), "card-3", "缺");
    inst.uninstall();
  }

  console.log("== C 未登记通道透传 / behavior:* 排除 ==");
  {
    const ipc = fakeIpc();
    const box = fakeEnv();
    const inst = ipcTap.install(ipc, (e) => { box.emitted.push(e); }, { env: box.env });
    ipc.handle("unknown:channel", () => "raw");
    const r = ipc.invoke("unknown:channel");
    check("未登记通道原样可用且不包装", r === "raw" && box.statsCalls.length === 0, "raw/0", { r, calls: box.statsCalls.length });
    ipc.handle("behavior:batch", () => "ok");
    ipc.invoke("behavior:batch");
    check("behavior:* 不计数（防自反馈）", box.statsCalls.filter((c) => c.ch === "behavior:batch").length === 0, 0, box.statsCalls);
    inst.uninstall();
  }

  console.log("== D on 包装：this / 返回值 / removeListener 映射 ==");
  {
    const ipc = fakeIpc();
    const box = fakeEnv();
    // 用注入的映射表模拟一个 on 通道（生产当前没有 on 写通道；机制必须先可用）
    const inst = ipcTap.install(ipc, (e) => { box.emitted.push(e); }, {
      env: box.env,
      taps: { "test:on-event": { type: "nav.view", ok: () => true, project: (a) => ({ props: { from: "a", to: "b" } }) } },
      channels: new Set(["test:on-event"]),
    });
    const listener = function (event, payload) {
      box.onThis = this === ipc;
      box.onPayload = payload;
      return "listener-ret";
    };
    ipc.on("test:on-event", listener);
    ipc.emit("test:on-event", { x: 1 });
    check("on：this 原样 + 参数透传", box.onThis === true && box.onPayload.x === 1, true, { this: box.onThis, payload: box.onPayload });
    await tick();
    check("on：成功发射事件", box.emitted.some((e) => e.type === "nav.view"), "nav.view", box.emitted.map((e) => e.type));
    ipc.removeListener("test:on-event", listener);
    check("removeListener 按原监听器解绑（包装映射生效）", (ipc._ons.get("test:on-event") || []).length === 0, 0, (ipc._ons.get("test:on-event") || []).length);
    ipc.emit("test:on-event", { x: 2 });
    await tick();
    check("解绑后不再触发/不再发射", box.emitted.filter((e) => e.type === "nav.view").length === 1, 1, box.emitted.filter((e) => e.type === "nav.view").length);
    inst.uninstall();
  }

  console.log("== E 短文本策略：关闭时仍计次数但不存文本 ==");
  {
    const ipc = fakeIpc();
    const box = fakeEnv({ env: { recordQueryText: () => false } });
    const inst = ipcTap.install(ipc, (e) => { box.emitted.push(e); }, { env: box.env });
    ipc.handle("dict:lookupLocal", () => [{ sourceLanguage: "en" }]);
    ipc.invoke("dict:lookupLocal", "apple");
    await tick();
    const ev = box.emitted.find((e) => e.type === "dict.lookup");
    check("关闭 recordQueryText：text 被剥离、事件仍发", !!ev && ev.text === null && ev.props.hit === true, "text=null/hit", ev);
    check("剥离后事件仍合法", registry.validate(ev, { recordQueryText: false }).ok, "ok", registry.validate(ev, { recordQueryText: false }));
    inst.uninstall();
  }

  console.log("== F 通道覆盖（扫描 electron/**/*.js 与静态登记表比对） ==");
  {
    const files = [];
    const walk = (d) => {
      for (const n of fs.readdirSync(d)) {
        const full = path.join(d, n);
        const st = fs.statSync(full);
        if (st.isDirectory()) walk(full);
        else if (n.endsWith(".js")) files.push(full);
      }
    };
    walk(path.join(ROOT, "electron"));
    const channels = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/ipcMain\.(?:handle|on)\(\s*"([\w:]+)"/g)) channels.push(m[1]);
    }
    const business = channels.filter((c) => !c.startsWith("behavior:")); // behavior:* 由 ipcTap 显式排除，不参与覆盖
    const unregistered = taps.unregistered(business);
    check(`扫描到的 ${new Set(business).size} 个业务通道全部已登记（映射或只计数）`, unregistered.length === 0, "零未登记", unregistered);
    const onceUses = files.filter((f) => /ipcMain\.once\(/.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f));
    check("仓库内无 ipcMain.once（未适配 once，出现即要求补适配）", onceUses.length === 0, "无 once", onceUses);
    const mapped = Object.keys(taps.TAPS);
    check("事件映射覆盖全部写语义关键通道（≥60）", mapped.length >= 60, ">=60", mapped.length);
  }

  console.log("== G ipcStats：计数与落库 SQL ==");
  {
    const stats = createIpcStats({ now: () => CLOCK });
    stats.record("cards:review", 5, false);
    stats.record("cards:review", 7, true);
    stats.record("behavior:batch", 1, false);
    const snap = stats.snapshot();
    check("按通道累计 n/err/sum/max", snap["cards:review"].n === 2 && snap["cards:review"].err === 1 && snap["cards:review"].sum === 12 && snap["cards:review"].max === 7, { n: 2, err: 1, sum: 12, max: 7 }, snap["cards:review"]);
    check("behavior:* 不入统计", !snap["behavior:batch"], "无", snap["behavior:batch"]);
    const rows = [];
    const fakeDb = {
      prepare: () => ({ run: (...args) => { rows.push(args); } }),
      transaction: (fn) => fn,
    };
    const written = stats.flushTo(fakeDb, "2026-10-28", true);
    check("flushTo 写入 ipc_daily 行（day/channel/n/err/sum/max）", written === 1 && rows[0][0] === "2026-10-28" && rows[0][1] === "cards:review" && rows[0][2] === 2 && rows[0][3] === 1 && rows[0][4] === 12 && rows[0][5] === 7, "1 行", { written, rows });
    check("flush 后内存桶清零", Object.keys(stats.snapshot()).length === 0, 0, Object.keys(stats.snapshot()));
  }

  console.log(`\n==== behavior-ipc-tap ${pass}/${pass + fail} 断言 ====`);
  if (fail > 0) console.log(`  失败 ${fail} 项`);
  process.exitCode = fail === 0 ? 0 : 1;
})().catch((e) => {
  console.error("顶层异常：" + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
