// D142 样张截图/实测脚本（零产品代码；供复核与再生成）
//   node_modules 内的 electron 直接跑本脚本（不启动本项目的应用本体）：
//   npx electron design-samples/D142-carddock-restyle-shot.cjs
// 产出：
//   design-samples/D142-carddock-restyle-docks.png   四列对照 + 更多展开对照（DPR 2.5，与 tests/tmp-d142-dock-*.png 同缩放）
//   design-samples/D142-carddock-restyle-states.png  字段 4 态 + 发送钮 5 态（DPR 2.5）
//   控制台 ===METRICS=== 段：样张内 window.__D142 实测数（矩阵数据来源，可逐项复核）
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const SAMPLE = path.join(DIR, "D142-carddock-restyle.html");

app.commandLine.appendSwitch("force-device-scale-factor", "2.5");

app
  .whenReady()
  .then(async () => {
    console.log("step: ready");
    const win = new BrowserWindow({ width: 1900, height: 1200, show: true, backgroundColor: "#e8e8e6" });
    win.webContents.debugger.attach("1.3");
    await win.loadFile(SAMPLE);
    console.log("step: loaded");
    await new Promise((r) => setTimeout(r, 900));
    console.log("step: waited");

    const metrics = await win.webContents.executeJavaScript("JSON.stringify(window.__D142, null, 2)");
    console.log("===METRICS===");
    console.log(metrics);

    const rects = JSON.parse(
      await win.webContents.executeJavaScript(`(() => {
        const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height }; };
        const u = (list) => ({ x: Math.min(...list.map(r => r.x)), y: Math.min(...list.map(r => r.y)), r: Math.max(...list.map(r => r.x + r.width)), b: Math.max(...list.map(r => r.y + r.height)) });
        const racks = [...document.querySelectorAll('.rack')].map(rect);
        const states = [...document.querySelectorAll('.states')].map(rect);
        return JSON.stringify({ rack: u(racks), states: u(states), dpr: devicePixelRatio, page: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight } });
      })()`)
    );
    console.log("===RECTS===", JSON.stringify(rects));

    const shot = async (clip, name) => {
      const res = await win.webContents.debugger.sendCommand("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
        clip: { x: clip.x - 16, y: clip.y - 16, width: clip.r - clip.x + 32, height: clip.b - clip.y + 32, scale: 1 }
      });
      fs.writeFileSync(path.join(DIR, name), Buffer.from(res.data, "base64"));
      console.log("wrote", name);
    };
    await shot(rects.rack, "D142-carddock-restyle-docks.png");
    await shot(rects.states, "D142-carddock-restyle-states.png");
    app.quit();
  })
  .catch((e) => {
    console.error("shot failed:", e);
    app.exit(1);
  });
