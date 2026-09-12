// PDF 内核契约测试（v28 L1 级）：隐藏 BrowserWindow + 手工构造 PDF 夹具（3 页 + 2 条大纲）。
// 运行：npx electron tests/pdf.kernel.cjs（须先关闭应用，§7.1.8）
// 只证明 adapter 忠实实现 ReaderKernel 页码锚点契约；业务安全由 tests/m6-2native.gui.mjs（L2）证明。
// driver 每次运行前重新 esbuild 打包（esbuild JS API——Windows 下 execSync+npx 有挂起问题，禁用）。
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

let pass = 0;
let fail = 0;
const failures = [];
const LOG = path.join(__dirname, "pdf.kernel.log");
const logLine = (m) => {
  console.log(m);
  fs.appendFileSync(LOG, m + "\n");
};
function report(tag, results) {
  logLine(`---- ${tag} (${(results || []).length} 项) ----`);
  for (const r of results || []) {
    if (r.pass) {
      pass++;
      logLine(`  PASS [${tag}] ${r.name}`);
    } else {
      fail++;
      failures.push(`[${tag}] ${r.name} — ${r.detail}`);
      logLine(`  FAIL [${tag}] ${r.name} | ${r.detail}`);
    }
  }
}

// ---------- 手工 PDF 夹具（3 页 + 书签大纲 2 条；无压缩内容流 + Helvetica） ----------
// 注意：PDF 内容流字面量不支持 CJK，此处限 ASCII（CJK 文本层由 GUI 真实文件覆盖）。
function buildPdfFixture() {
  const mkContent = (lines) => {
    let s = "BT\n";
    for (const l of lines) s += `/F1 ${l.size} Tf\n1 0 0 1 ${l.x} ${l.y} Tm\n(${l.text}) Tj\n`;
    return s + "ET";
  };
  const pages = [
    [{ x: 72, y: 700, size: 12, text: "PDF kernel fixture page one with anchor-marker inside." }],
    [{ x: 72, y: 700, size: 12, text: "Second page body for chapter one." }],
    [{ x: 72, y: 700, size: 12, text: "Third page holds third-page-unique word." }],
  ];
  const outline = [
    { title: "Chapter One", page: 0 },
    { title: "Chapter Two", page: 2 },
  ];
  const objs = [];
  const pageObjNums = [];
  const firstPageObj = 3;
  const perPage = 2;
  const lastPageObj = firstPageObj + pages.length * perPage - 1;
  const fontObj = lastPageObj + 1;
  const outlineRoot = fontObj + 1;
  pages.forEach((lines, i) => {
    const pageObj = firstPageObj + i * perPage;
    const contentObj = pageObj + 1;
    const c = mkContent(lines);
    pageObjNums.push(pageObj);
    objs[pageObj - 1] = `${pageObj} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents ${contentObj} 0 R/Resources<</Font<</F1 ${fontObj} 0 R>>>>>>endobj`;
    objs[contentObj - 1] = `${contentObj} 0 obj<</Length ${c.length}>>stream\n${c}\nendstream endobj`;
  });
  objs[0] = `1 0 obj<</Type/Catalog/Pages 2 0 R/Outlines ${outlineRoot} 0 R>>endobj`;
  objs[1] = `2 0 obj<</Type/Pages/Kids[${pageObjNums.map((n) => `${n} 0 R`).join(" ")}]/Count ${pages.length}>>endobj`;
  objs[fontObj - 1] = `${fontObj} 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj`;
  const items = outline.map((o, i) => ({ obj: outlineRoot + 1 + i, pageObj: pageObjNums[o.page], title: o.title }));
  items.forEach((it, i) => {
    const parts = [`<</Title(${it.title})/Parent ${outlineRoot} 0 R/Dest[${it.pageObj} 0 R /XYZ 0 792 0]`];
    if (i > 0) parts.push(`/Prev ${items[i - 1].obj} 0 R`);
    if (i < items.length - 1) parts.push(`/Next ${items[i + 1].obj} 0 R`);
    parts.push(">>endobj");
    objs[it.obj - 1] = `${it.obj} 0 obj` + parts.join("");
  });
  objs[outlineRoot - 1] = `${outlineRoot} 0 obj<</Type/Outlines/First ${items[0].obj} 0 R/Last ${items[items.length - 1].obj} 0 R/Count ${items.length}>>endobj`;
  const used = objs.filter(Boolean);
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (const o of used) { offsets.push(pdf.length); pdf += o + "\n"; }
  const xref = pdf.length;
  pdf += "xref\n0 " + (used.length + 1) + "\n0000000000 65535 f \n";
  for (const off of offsets) pdf += String(off).padStart(10, "0") + " 00000 n \n";
  pdf += `trailer<</Size ${used.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1").toString("base64");
}

app.whenReady().then(async () => {
  fs.writeFileSync(LOG, "");
  setTimeout(() => {
    logLine("GLOBAL TIMEOUT——套件挂起");
    app.exit(2);
  }, 150000);
  logLine("== PDF 内核契约测试（v28 L1 级） ==");
  // 注意：buildSync 不支持 plugins——?url 文本内联需异步 API（loader:text 把 worker 文本打进包，
  // adapter 内以 Blob URL 喂给 workerSrc，file 协议可达）。CSS 用 text 打进包由 driver 注入 <style>
  // （viewer 的 .page 尺寸/文本层定位全靠它；置空会导致可视计算全 0 不渲染）。
  await require("esbuild").build({
    entryPoints: [path.join(__dirname, "pdf.driver.js")],
    bundle: true,
    format: "iife",
    target: "chrome120",
    outfile: path.join(__dirname, "pdf.bundle.js"),
    logLevel: "silent",
    loader: { ".css": "text" },
    define: { WORKER_URL: '"__INLINE__"' },
    plugins: [require("./esbuild.url-text.js")]
  });
  logLine("phase: driver bundle built");

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  win.webContents.on("console-message", (_e, _level, message) => {
    logLine("[renderer] " + message);
  });
  await win.loadFile(path.join(__dirname, "pdf.fixture.html"));
  logLine("phase: fixture page loaded");

  const results = await win.webContents.executeJavaScript(
    `window.__pdfTest.runPdf(${JSON.stringify(buildPdfFixture())}, {
      marker: "anchor-marker",
      markerPage: 0,
      gotoPage: 1,
      searchWord: "third-page-unique",
      searchPage: 2
    })`,
    true
  ).catch((err) => { logLine("dispatch error: " + err.message); return []; });
  report("PDF", results);

  win.destroy();
  console.log(`\n==== SUMMARY ${pass}/${pass + fail} ====`);
  if (fail) {
    console.log("FAILED items:");
    for (const f of failures) console.log("  - " + f);
  }
  app.exit(fail ? 1 : 0);
});
