// F53E 采集渲染层声音：点开书时的 console / 未捕获异常 / 失败请求
// @runtime: node  @tier: 1  @gui: true  @id: F53E  @timeout: 300
// 运行：node tests/flows/f53e-renderer-console.cjs
//
// F53/F53C/F53D 证明「点开书正文是空的」（截图为证），但主进程日志一个字都没有 ⇒ 失败在渲染层。
// 这条把 CDP 的 Runtime.consoleAPICalled / Runtime.exceptionThrown / Log.entryAdded /
// Network.loadingFailed 全接上，再走一次「点开书」，把渲染层真正说了什么捞出来。
"use strict";
const path = require("path");
const { Flow, runFlow, RESULTS_DIR } = require("./lib/harness.cjs");
const { launch, shutdown, wait } = require("./lib/guienv.cjs");

const flow = new Flow({
  id: "F53E",
  title: "点开书时的渲染层事件采集",
  angle: "主进程日志干净 ⇒ 去渲染层拿 console/异常/失败请求",
  cites: ["§6.2", "§7.1.8"],
  tier: 1,
  gui: true,
});

runFlow(flow, async () => {
  const h = await launch({ label: "f48", port: 9820, fresh: false, logName: path.join(RESULTS_DIR, "f53e.app.log") });
  if (h.skip || h.skippedByExit || h.timeout) {
    flow.check("打开沙箱", false, "成功", h.reason || "skip");
    return;
  }
  const events = [];
  try {
    await wait(7000);
    // 直接订阅 ws 上未经 request-id 匹配的推送
    h.ws.addEventListener("message", (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!m.method) return;
      if (m.method === "Runtime.consoleAPICalled") {
        const a = (m.params.args || []).map((x) => String(x.value ?? x.description ?? x.unserializableValue ?? x.type)).join(" ");
        events.push(`[console.${m.params.type}] ${a.slice(0, 200)}`);
      } else if (m.method === "Runtime.exceptionThrown") {
        const d = m.params.exceptionDetails || {};
        events.push(`[EXCEPTION] ${String(d.exception && (d.exception.description || d.exception.value) || d.text || "").slice(0, 300)}`);
      } else if (m.method === "Log.entryAdded") {
        const e = m.params.entry || {};
        events.push(`[log.${e.level}] ${String(e.text || "").slice(0, 200)} ${e.url ? "@ " + String(e.url).split("/").pop().slice(0, 40) : ""}`);
      } else if (m.method === "Network.loadingFailed") {
        events.push(`[netfail] ${JSON.stringify(m.params).slice(0, 160)}`);
      } else if (m.method === "Runtime.executionContextCreated") {
        const c = (m.params.context || {});
        events.push(`[ctx+] id=${c.id} origin=${String(c.origin).slice(0, 60)} name=${c.name || ""}`);
      }
    });
    await h.send("Runtime.enable");
    await h.send("Log.enable");
    await h.send("Network.enable");
    await h.send("Page.enable");
    await wait(1500);

    flow.section("E1 点开第一本书");
    const click = await h.evaluate(`
      const cards=[...document.querySelectorAll('.book-card')];
      if(!cards.length) return 'none';
      const t=cards[0]; t.scrollIntoView({block:'center'}); const r=t.getBoundingClientRect();
      return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),n:cards.length,标题:(t.innerText||'').trim().slice(0,16)});`);
    flow.record("落点", String(click.value || click.error));
    const p = JSON.parse(String(click.value || "{}"));
    if (Number.isFinite(p.x)) {
      await h.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y, button: "none" });
      await wait(150);
      await h.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1, buttons: 1 });
      await h.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1, buttons: 0 });
    }
    await wait(9000);

    flow.section("E2 渲染层说了什么");
    flow.record("采集到的事件数", events.length);
    for (const e of events.slice(0, 26)) flow.record("事件", e);
    const errs = events.filter((e) => e.startsWith("[EXCEPTION]") || e.startsWith("[console.error]") || e.startsWith("[log.error]") || e.startsWith("[netfail]"));
    flow.record("错误类事件数", errs.length);
    await h.shot("f53e-after-open");

    flow.section("E3 影子宿主与执行上下文");
    const hosts = await h.evaluate(`
      const out=[];
      document.querySelectorAll('*').forEach(el=>{ if(el.shadowRoot) out.push(el.tagName.toLowerCase()+'.'+String(el.className).slice(0,22)+' 子节点'+el.shadowRoot.childElementCount); });
      return JSON.stringify({开放影子根:out.slice(0,6), 有foliate标签:[...document.querySelectorAll('*')].filter(e=>/-/.test(e.tagName)&&/foliate|reader|book/i.test(e.tagName)).map(e=>e.tagName.toLowerCase()).slice(0,6)});`);
    flow.record("宿主探测", String(hosts.value || hosts.error));
    flow.check(
      "点开书之后渲染层不得有未捕获异常/错误日志（有 ⇒ 直接给出根因线索）",
      errs.length === 0,
      "0 条错误",
      errs.slice(0, 6)
    );
  } finally {
    await shutdown(h);
  }
});
