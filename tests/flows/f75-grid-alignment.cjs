// F75 网格列对齐普查 + 省略号文本可达性普查（不写死选择器，从计算样式自动发现）
// @runtime: node  @tier: 2  @gui: true  @id: F75  @timeout: 420
// 运行：node tests/flows/f75-grid-alignment.cjs
//
// 起因：F69 的截图里"卡片浏览"表格的来源列看着各行起点不一致，而肉眼读 1283px 缩略图
// 不足以定罪（这条纪律来自 D-TEST 系列两次假绿）。本条把两件事做成可自动发现的闸门：
//   S1 所有 CSS-Grid 行族的列左边界极差（列错位这一整类缺陷此前无人量过；F58 量的是同行卡片底边）
//   S2 所有被 text-overflow:ellipsis 裁掉的文本，全文是否还能通过 title/aria-label 读到
// 两节各自带正向对照：注入错位/注入无 title 的裁切元素，闸门必须报红，否则绿不算数。
"use strict";
const path = require("path");
const fs = require("fs");
const net = require("net");
const { Flow, runFlow, RESULTS_DIR, tmpUserDataDir, freshDir } = require("./lib/harness.cjs");
const { launch, shutdown, wait } = require("./lib/guienv.cjs");

const flow = new Flow({
  id: "F75",
  title: "网格列对齐与省略号可达性普查",
  angle: "从计算样式自动发现全部网格行族，量列左边界极差；再查所有被裁切文本的全文可达性",
  cites: ["§5.1", "§5.4", "§5.6"],
  tier: 2,
  gui: true,
});

// 只找"看起来是一行"的网格：display:grid、直接子元素 ≥4、同族（同类名）至少 3 行
const DISCOVER = `
const byClass=new Map();let scanned=0;
for(const e of document.querySelectorAll('*')){
  if(scanned++>30000) break;
  const cn=e.className; if(typeof cn!=='string'||!cn.trim()) continue;
  const g=byClass.get(cn)||[]; g.push(e); byClass.set(cn,g);
}
const fams=[];
for(const [cn,list] of byClass){
  if(list.length<3) continue;
  const rows=list.filter(e=>{const s=getComputedStyle(e);return s.display==='grid'&&e.children.length>=4;});
  if(rows.length<3) continue;
  fams.push({cn:cn.slice(0,60),rows:rows.length,maxCols:Math.max(...rows.map(r=>r.children.length))});
}
return JSON.stringify(fams.sort((a,b)=>b.rows-a.rows).slice(0,12));`;

// 对一个族：按列下标收集 rect.left，报极差；表头行（含"题面/类型/状态"等列名）单独比对
const ALIGN = (cn) => `
const sel='.${cn.split(/\\s+/).join('.')}';
const rows=[...document.querySelectorAll(sel)].filter(e=>{const s=getComputedStyle(e);return s.display==='grid'&&e.children.length>=4;});
const cols=Math.max(...rows.map(r=>r.children.length));
const perCol=[];
for(let i=0;i<cols;i++){
  const lefts=rows.map(r=>r.children[i]).filter(Boolean).map(e=>Math.round(e.getBoundingClientRect().left*10)/10);
  if(lefts.length<3) continue;
  const sp=Math.round((Math.max(...lefts)-Math.min(...lefts))*10)/10;
  perCol.push({列:i,样本:lefts.length,极差px:sp,最小:Math.min(...lefts),最大:Math.max(...lefts)});
}
const widths=rows.map(r=>Math.round(r.getBoundingClientRect().width));
const widthSpread=Math.max(...widths)-Math.min(...widths);
const bad=perCol.filter(c=>c.极差px>0.6);
return JSON.stringify({族:sel,行数:rows.length,列数:cols,行宽极差px:widthSpread,坏列数:bad.length,坏列:bad.slice(0,6),全列:perCol.slice(0,10)});`;

// 省略号裁切 + 全文不可达
const ELIDE = `
const out=[];let scanned=0;
for(const e of document.querySelectorAll('*')){
  if(scanned>40000) break; scanned++;
  const s=getComputedStyle(e);
  if(s.textOverflow!=='ellipsis') continue;
  if(s.whiteSpace!=='nowrap'&&s.whiteSpace!=='pre') continue;
  if(e.scrollWidth<=e.clientWidth+1) continue;
  const t=(e.textContent||'').trim(); if(!t) continue;
  let reach=false;
  for(let n=e;n&&!reach;n=n.parentElement){ if(n.getAttribute&&n.getAttribute('title')) reach=true; }
  if(e.getAttribute&&e.getAttribute('title')) reach=true;
  if(e.getAttribute&&e.getAttribute('aria-label')) reach=true;
  if(!reach) out.push({类:String(e.className).slice(0,40),可见:Math.max(1,Math.round(t.length*e.clientWidth/Math.max(1,e.scrollWidth))),全文:t.length,尾:t.slice(-6)});
}
const withTitle=[...document.querySelectorAll('[title]')].length;
return JSON.stringify({扫描元素:scanned,裁切且不可达:out.length,明细:out.slice(0,8),带title元素数:withTitle});`;

function read(tag, raw) {
  let j = null;
  try {
    j = JSON.parse(String(raw.value || "null"));
  } catch {
    /* fallthrough */
  }
  if (!j) {
    flow.check(`${tag} 取到读数`, false, "JSON", String(raw.error || raw.value).slice(0, 140));
    return null;
  }
  return j;
}

async function bindablePort(from, to) {
  for (let p = from; p <= to; p++) {
    const ok = await new Promise((res) => {
      const sv = net.createServer();
      sv.once("error", () => res(false));
      sv.listen(p, "127.0.0.1", () => sv.close(() => res(true)));
    });
    if (ok) return p;
  }
  return 0;
}

function copySandbox(src, dst) {
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const a = path.join(src, f);
    if (fs.statSync(a).isFile()) fs.copyFileSync(a, path.join(dst, f));
  }
  return fs.readdirSync(dst).join(",");
}

runFlow(flow, async () => {
  const srcDir = tmpUserDataDir("f69");
  const dstDir = tmpUserDataDir("f75");
  let note = "自带播种";
  if (fs.existsSync(path.join(srcDir, "library.db"))) {
    note = copySandbox(srcDir, freshDir(dstDir));
  }
  flow.record("沙箱来源", `${note}（只读复用 F69 极端值沙箱的副本，原件与真实 %APPDATA% 都不碰）`);

  const port = await bindablePort(9961, 9995);
  if (!port) {
    flow.check("找到一个可绑定的 CDP 端口", false, "可绑定", "9961-9995 全被占");
    return;
  }
  flow.record("CDP 端口", String(port));

  let h;
  try {
    h = await launch({
      label: "f75",
      port,
      fresh: false,
      logName: path.join(RESULTS_DIR, "f75.app.log"),
    });
  } catch (e) {
    flow.check("启动 Electron", false, "成功", String(e).slice(0, 140));
    return;
  }
  if (h.skip || h.skippedByExit || h.timeout) {
    flow.check("启动未被打断", false, "成功", h.reason || "skip");
    return;
  }

  const goto = async (name) => {
    await h.evaluate(
      `const el=[...document.querySelectorAll('.nav-item')].find(x=>(x.textContent||'').trim()===${JSON.stringify(name)}); if(el) el.click(); return !!el;`
    );
    await wait(2600);
  };

  try {
    await wait(8000);
    await h.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await wait(1500);

    /* ── S1 正向对照：先证明"注入一列错位"能被抓到 ───────────────── */
    flow.section("S1a 正向对照 · 人为把奇数行的某一列右移 12px，闸门必须报红");
    await goto("卡片");
    const inj = await h.evaluate(`
      const rows=[...document.querySelectorAll('*')].filter(e=>{const s=getComputedStyle(e);return s.display==='grid'&&e.children.length>=4;});
      if(rows.length<3) return JSON.stringify({err:'no-grid', grid族:rows.length});
      const cn=rows[0].className;
      const same=rows.filter(e=>e.className===cn);
      let n=0; for(let i=0;i<same.length;i++) if(i%2===0){ same[i].children[2].style.marginLeft='12px'; n++; }
      return JSON.stringify({族:String(cn).slice(0,40),改动行数:n,列下标:2});`);
    flow.record("对照注入", String(inj.value || inj.error));
    const ctlFam = await h.evaluate(`
      const rows=[...document.querySelectorAll('*')].filter(e=>{const s=getComputedStyle(e);return s.display==='grid'&&e.children.length>=4;});
      return rows.length?String(rows[0].className).split(/\\s+/)[0]:'';`);
    const ctlCn = String(ctlFam.value || "").trim();
    if (ctlCn) {
      const ctl = read("对照·注入后", await h.evaluate(ALIGN(ctlCn)));
      flow.record("对照读数", JSON.stringify(ctl && { 族: ctl.族, 坏列数: ctl.坏列数, 坏列: ctl.坏列 }));
      flow.check(
        "自检：注入 12px 错位后必须报出坏列（报不出 ⇒ 本流程的绿不算数）",
        !!ctl && ctl.坏列数 > 0,
        "坏列数 > 0",
        ctl ? `坏列数=${ctl.坏列数}` : "无读数"
      );
      await h.evaluate(`
        for(const e of document.querySelectorAll('*')){const s=getComputedStyle(e);if(s.display==='grid'&&e.children.length>=4){for(const c of e.children) c.style.marginLeft='';}}
        return 1;`);
      const cleared = read("对照·撤销注入后", await h.evaluate(ALIGN(ctlCn)));
      flow.check(
        "自检：撤销注入后同一族应变为全绿（否则极差阈值不可信）",
        !!cleared && cleared.坏列数 === 0,
        "坏列数 = 0",
        cleared ? `坏列数=${cleared.坏列数} 明细=${JSON.stringify(cleared.坏列)}` : "无读数"
      );
    } else {
      flow.check("对照：卡片屏存在网格族", false, "≥3 行网格", "未发现");
    }

    /* ── S1 正式普查：逐屏扫全部网格族 ───────────────────────────── */
    const SCREENS = ["书架", "队列", "卡片", "日记", "数据"];
    const allBad = [];
    let measured = 0;
    for (const name of SCREENS) {
      flow.section(`S1b 屏 · ${name} 网格列对齐普查`);
      await goto(name);
      const fams = read(`${name} 网格族清单`, await h.evaluate(DISCOVER));
      if (!fams) continue;
      flow.record(
        `${name} 自动发现的网格族`,
        fams.map((f) => `${f.cn}(${f.rows}行/${f.maxCols}列)`).join(" | ") || "无 ⇒ 本屏不用 grid 行，本检对该屏不适用（不计为绿）"
      );
      for (const f of fams.slice(0, 5)) {
        const head = f.cn.split(/\s+/)[0];
        const r = read(`${name}/${head}`, await h.evaluate(ALIGN(head)));
        if (!r) continue;
        measured++;
        flow.record(
          `${name}/${head}`,
          `行 ${r.行数} · 列 ${r.列数} · 行宽极差 ${r.行宽极差px}px · 坏列 ${r.坏列数} · 各列极差 ${JSON.stringify(r.全列.map((c) => c.极差px))}`
        );
        if (r.坏列数 > 0) {
          allBad.push(`${name}/${head}: ${JSON.stringify(r.坏列)}`);
          flow.check(
            `${name} 屏「${head}」各列左边界应对齐（极差 ≤0.6px）`,
            false,
            "极差 ≤0.6px",
            JSON.stringify(r.坏列).slice(0, 260)
          );
        }
      }
    }
    if (measured === 0) {
      flow.check("闸门空转自检：至少量到 1 个网格族，否则本节的绿不作数", false, "≥1 族", "0 族");
    } else {
      flow.record(
        "覆盖边界",
        `本检只覆盖 ${measured} 个 grid 行族；未用 grid 排行的屏（flex/真 table）本检不适用，不能据此声称"全应用列对齐无缺陷"。`
      );
      flow.check(`在全部 ${measured} 个可测网格族上列左边界无一错位`, allBad.length === 0, "0 个坏列族", allBad.length ? allBad.join(" ||| ").slice(0, 400) : "0");
    }

    /* ── S2 省略号可达性 ─────────────────────────────────────────── */
    flow.section("S2a 正向对照 · 注入一个无 title 的裁切元素与一个有 title 的孪生元素");
    await goto("卡片");
    const ctl2 = await h.evaluate(`
      const host=document.querySelector('.cb-row')||document.body;
      const long='这是一条用来验证省略号可达性普查的超长标题'.repeat(6);
      const mk=(cls,title)=>{const s=document.createElement('span');s.className=cls;s.textContent=long;
        s.style.cssText='display:block;width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
        if(title)s.setAttribute('title',long);host.appendChild(s);return s;};
      mk('f75-ctl-bad',null); mk('f75-ctl-good','f75ctltitle');
      return JSON.stringify({注入:2,宽度:120,全文码点:long.length});`);
    flow.record("对照注入", String(ctl2.value || ctl2.error));
    const ctlScan = read("对照·扫描", await h.evaluate(ELIDE));
    if (ctlScan) {
      const hitBad = (ctlScan.明细 || []).some((m) => /f75-ctl-bad/.test(m.类));
      const hitGood = (ctlScan.明细 || []).some((m) => /f75-ctl-good/.test(m.类));
      flow.record("对照明细", JSON.stringify({ 裁切且不可达: ctlScan.裁切且不可达, 抓到无title: hitBad, 误报有title: hitGood }));
      flow.check("自检：无 title 的裁切元素必须被抓到", hitBad, "抓到 f75-ctl-bad", hitBad ? "是" : "否");
      flow.check("自检：带 title 的孪生元素不得被误报", !hitGood, "不报 f75-ctl-good", hitGood ? "被误报" : "未报");
    }
    await h.evaluate(`for(const e of document.querySelectorAll('.f75-ctl-bad,.f75-ctl-good')) e.remove(); return 1;`);

    flow.section("S2b 正式普查 · 逐屏统计「被裁切且全文不可达」");
    const offenders = {};
    for (const name of SCREENS) {
      await goto(name);
      const r = read(`${name} 省略号扫描`, await h.evaluate(ELIDE));
      if (!r) continue;
      offenders[name] = r;
      flow.record(
        `${name}`,
        `扫描 ${r.扫描元素} 元素 · 带 title 的 ${r.带title元素数} · 裁切且不可达 ${r.裁切且不可达} · 明细 ${JSON.stringify(r.明细).slice(0, 300)}`
      );
      if (r.裁切且不可达 > 0) {
        flow.check(
          `${name} 屏被裁切的文本应可读到全文（title/aria-label）`,
          false,
          "0 处不可达",
          `${r.裁切且不可达} 处：${JSON.stringify(r.明细).slice(0, 300)}`
        );
      }
    }
    await h.send("Page.captureScreenshot", { format: "png" }).then((p) => {
      try {
        fs.writeFileSync(path.join(RESULTS_DIR, "f75-overflow.png"), Buffer.from(p.data, "base64"));
      } catch {
        /* 截图失败不影响判定 */
      }
    });
    flow.record("截图", "tests/flows/results/f75-overflow.png");
    flow.record("未覆盖", "复习屏（F69 实测其 innerText 仅 90 字，卡面未渲染）与阅读器（shadow DOM 封闭，见 D-TEST-39）本条同样进不去。");
  } finally {
    if (h && h.child) {
      try {
        await shutdown(h);
      } catch {
        try {
          h.child.kill();
        } catch {
          /* 已退出 */
        }
      }
    }
  }
});
