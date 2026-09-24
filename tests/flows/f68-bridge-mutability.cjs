// F68 桥面可变性判定：渲染层能不能改写 window.*API（决定 F66/F67 的注入路线，也决定攻击面）
// @runtime: node  @tier: 1  @gui: true  @id: F68  @timeout: 300
// 运行：node tests/flows/f68-bridge-mutability.cjs
//
// 起因：F66 想注入"某接口失败"、F67 想包一层记录器，两者都**静默失效**（记录器记不到任何调用）。
//       F66 当时读到的"补丁状态=patched"其实是假的——我的脚本在赋值之后无条件写了标记，没回读验证。
//       本条把这件事一次查清：桥对象到底可不可写、能不能删、能不能换成 Proxy。
"use strict";
const { Flow, runFlow } = require("./lib/harness.cjs");
const { launch, shutdown, wait } = require("./lib/guienv.cjs");

const flow = new Flow({
  id: "F68",
  title: "桥面可变性判定",
  angle: "contextBridge 暴露的对象在渲染层是否可被改写（注入路线可行性 + 篡改攻击面）",
  cites: ["§7.5", "§7.1.3"],
  tier: 1,
  gui: true,
});

runFlow(flow, async () => {
  const h = await launch({ label: "f48", port: 9940, fresh: false });
  if (h.skip || h.skippedByExit || h.timeout) {
    flow.check("打开沙箱", false, "成功", h.reason || "skip");
    return;
  }
  try {
    await wait(8000);
    flow.section("B1 桥对象的结构到底是什么");
    const shape = await h.evaluate(`
      const o = window.libraryAPI;
      const d = Object.getOwnPropertyDescriptor(o, 'list');
      const keys = Object.keys(o);
      const proto = Object.getPrototypeOf(o);
      return JSON.stringify({
        存在: !!o,
        可枚举键数: keys.length,
        键样本: keys.slice(0,6),
        有描述符: !!d,
        描述符: d ? {value: typeof d.value, writable: d.writable, get: typeof d.get, enumerable: d.enumerable, configurable: d.configurable} : null,
        原型: proto === null ? 'null' : Object.prototype.isPrototypeOf(proto) ? 'Object.prototype' : '其他',
        被冻结: Object.isFrozen ? Object.isFrozen(o) : 'n/a',
        描述符总数: Object.getOwnPropertyDescriptors ? Object.getOwnPropertyDescriptors(o) && Object.keys(Object.getOwnPropertyDescriptors(o)).length : 'n/a'
      });`);
    flow.record("桥对象形状", String(shape.value || shape.error));

    flow.section("B2 三种改写尝试，每种都回读验证（F66 就是栽在没回读）");
    const tries = await h.evaluate(`
      const out = {};
      const o = window.libraryAPI;
      const orig = o.list;
      // ① 覆盖同名方法
      try { o.list = function(){ return Promise.resolve(['HIJACKED']); }; } catch(e) { out.写抛错 = String(e.message).slice(0,60); }
      out.写后还是原函数吗 = (o.list === orig);
      out.写后类型 = typeof o.list;
      // ② 删掉一个方法
      try { delete o.list; } catch(e) { out.删抛错 = String(e.message).slice(0,60); }
      out.删后还在吗 = (typeof o.list === 'function');
      // ③ 加一个新方法
      try { o.__injected = function(){}; } catch(e) { out.加抛错 = String(e.message).slice(0,60); }
      out.加成功了吗 = (typeof o.__injected === 'function');
      // ④ 整个换掉 window.libraryAPI
      try { window.libraryAPI = {}; } catch(e) { out.换抛错 = String(e.message).slice(0,60); }
      out.换成功了吗 = (window.libraryAPI && typeof window.libraryAPI.list !== 'function') ? true : false;
      return JSON.stringify(out);`);
    flow.record("四种改写尝试（全部回读验证）", String(tries.value || tries.error));
    const t = JSON.parse(String(tries.value || "{}"));

    flow.section("B3 判定");
    const immutable = t["写后还是原函数吗"] === true && t["加成功了吗"] === false;
    flow.record(
      "结论",
      immutable
        ? "**渲染层无法改写 contextBridge 暴露的 API**：赋值不生效、新增不生效 ⇒ " +
          "(a) F66/F67 想靠 monkey-patch 注入失败是**路线本身不可行**，必须改到主进程侧或文件侧制造失败；" +
          "(b) 同时说明这是一条**好的安全性质**：即使渲染层被 XSS 拿下，也**不能替换/拦截桥方法来窃取或伪造调用**（只能按现有通道调用，而 D-TEST-26 那条任意文件读正是「现有通道」的问题，两者互相印证）"
        : "桥面**可被渲染层改写** ⇒ 记录器/注入可行，F66/F67 需要重跑；同时这本身是一条安全缺陷（桥可被劫持）"
    );
    flow.check(
      "桥面可变性必须给出明确定性（两种结果都有价值，只有「读不出来」才算失败）",
      typeof t["写后还是原函数吗"] === "boolean",
      "拿到回读结果",
      t
    );
    flow.check(
      "若定性为不可变，则必须同时验证「原有调用仍然工作」（改写尝试不得把应用弄坏）",
      immutable ? true : true,
      "见下一条",
      { 说明: "下面这条真的调一次，确认尝试没弄坏桥" }
    );
    const stillWorks = await h.evaluate(`
      return window.libraryAPI.list().then(function(r){ return 'OK:' + (Array.isArray(r)? r.length : Object.keys(r||{}).length); }).catch(function(e){ return 'ERR:' + String(e.message).slice(0,60); });`);
    flow.record("改写尝试之后 list() 仍可用吗", String(stillWorks.value || stillWorks.error));
    flow.check("尝试改写之后桥必须仍然正常工作（探测本身不得破坏应用）", String(stillWorks.value || "").startsWith("OK:"), "OK", stillWorks.value || stillWorks.error);
  } finally {
    await shutdown(h);
  }
});
