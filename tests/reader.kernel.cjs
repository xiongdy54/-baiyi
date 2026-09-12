// 阅读内核契约测试（v20）：
//   L0 = fakeKernel 语义契约（本文件内直接跑，纯 node 语义）
//   L1 = foliateAdapter 集成契约（隐藏 BrowserWindow + jszip 夹具 EPUB；
//        只证明 adapter 契约未破，业务安全由 tests/reader.engine.cjs（L2）证明）
//   CJK 专项 = 日文 ruby（foliate-js#124 观察）+ 竖排（writing-mode vertical-rl）选区/CFI/搜索回环
// 运行：npx electron tests/reader.kernel.cjs（须先关闭应用，§7.1.8）
// 夹具书由 jszip 现场构造（确定性）；driver 每次运行前重新 esbuild 打包：
//   npx esbuild tests/reader.driver.js --bundle --format=iife --outfile=tests/reader.bundle.js
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

let pass = 0;
let fail = 0;
const failures = [];
const LOG = path.join(__dirname, "reader.kernel.log");
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

// ---------- jszip 夹具构造（确定性 EPUB） ----------
async function buildFixtures() {
  const JSZip = require("jszip");
  const containerXml = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
  const page = (title, body) =>
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body>
<h1>${title}</h1>
${body}
</body></html>`;

  const paras = (ch, marker) =>
    Array.from({ length: 24 }, (_, i) => `<p>第${ch}章第${i + 1}段。用于阅读内核契约测试的常规中文文本。</p>`).join("\n") +
    `<p>${marker}</p>`;

  const opf = (items, spine) => `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:reader-kernel-fixture</dc:identifier>
    <dc:title>契约测试书</dc:title>
    <dc:language>zh</dc:language>
    <meta property="dcterms:modified">2026-09-10T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${items}
  </manifest>
  <spine>
${spine}
  </spine>
</package>`;

  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目录</title></head><body>
<nav epub:type="toc" id="toc"><ol>
<li><a href="ch1.xhtml">第一章</a></li>
<li><a href="ch2.xhtml">第二章</a></li>
<li><a href="ch3.xhtml">第三章</a></li>
</ol></nav>
</body></html>`;

  // ① 普通（含内链 + 外链 + 各章独有标记词 + v25 正文图片点选夹具）
  const zip1 = new JSZip();
  zip1.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip1.file("META-INF/container.xml", containerXml);
  zip1.file("OEBPS/content.opf", opf(
    ['    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>',
     '    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>',
     '    <item id="ch3" href="ch3.xhtml" media-type="application/xhtml+xml"/>',
     '    <item id="pic" href="pic.png" media-type="image/png"/>'].join("\n"),
    ['    <itemref idref="ch1"/>', '    <itemref idref="ch2"/>', '    <itemref idref="ch3"/>'].join("\n")
  ));
  zip1.file("OEBPS/nav.xhtml", nav);
  zip1.file("OEBPS/ch1.xhtml", page("第一章", paras(1, "第一章独有锚甲") +
    `<p>这是一段带<a href="https://example.com/ext-page">外部链接</a>与<a href="ch3.xhtml">内部跳转到第三章</a>的正文。</p>`));
  // 1×1 PNG（确定性夹具；显示尺寸由 width/height 属性给定，供图片点击契约断言使用）
  zip1.file(
    "OEBPS/pic.png",
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAKAAAABaCAIAAACwpMoFAAAAoElEQVR42u3RAQ0AAAjDsDtCNjbvA5pMwZrM6nIWABZgARZgARZgAQYswAIswAIswAIMWIAFWIAFWIAFWIABC7AAC7AAC7AAAxZgARZgARZgAQYswAIswAIswAIswIAFWIAFWIAFWIABC7AAC7AAC7AAA7YAsAALsAALsAALMGABFmABFmABFmDAAizAAizAAizAAgxYgAVYgAVYgAX4VwX94ghClYrF/gAAAABJRU5ErkJggg==",
      "base64"
    )
  );
  zip1.file("OEBPS/ch2.xhtml", page("第二章", paras(2, "第二章独有锚乙") +
    `<p><img src="pic.png" alt="夹具图" width="120" height="80"/></p>`));
  zip1.file("OEBPS/ch3.xhtml", page("第三章", paras(3, "第三章独有锚丙")));

  // ② 日文 ruby（foliate-js#124：ruby 可能影响渲染与搜索上下文）
  const zip2 = new JSZip();
  zip2.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip2.file("META-INF/container.xml", containerXml);
  zip2.file("OEBPS/content.opf", opf(
    '    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>',
    '    <itemref idref="ch1"/>'
  ));
  zip2.file("OEBPS/nav.xhtml", nav);
  zip2.file("OEBPS/ch1.xhtml", page("麦穂", `
<p>秋になると、<ruby>麦穂<rt>むぎほ</rt></ruby>が金色に揺れる。<ruby>麦穂<rt>むぎほ</rt></ruby>の<ruby>刈入<rt>かりいれ</rt></ruby>は十月である。</p>
<p><ruby>初雁<rt>はつかり</rt></ruby>の渡来は、日本列島に秋の深まりを告げる。</p>`));

  // ③ 竖排（writing-mode: vertical-rl）
  const zip3 = new JSZip();
  zip3.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip3.file("META-INF/container.xml", containerXml);
  zip3.file("OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="ja">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:reader-vertical-fixture</dc:identifier>
    <dc:title>竖排夹具书</dc:title>
    <dc:language>ja</dc:language>
    <meta property="dcterms:modified">2026-09-10T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine page-progression-direction="rtl">
    <itemref idref="ch1"/>
  </spine>
</package>`);
  zip3.file("OEBPS/nav.xhtml", nav);
  zip3.file("OEBPS/ch1.xhtml", `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>縦書き</title>
<style>html { writing-mode: vertical-rl; }</style>
</head><body>
<h1>第一章 縦書きの冬</h1>
<p>雪の朝、静かに山々が白く染まっていく。縦書きの文字が右から左へと流れる。</p>
</body></html>`);

  const toB64 = (zip) => zip.generateAsync({ type: "base64", mimeType: "application/epub+zip" });
  return {
    normal: await toB64(zip1),
    ruby: await toB64(zip2),
    vertical: await toB64(zip3)
  };
}

app.whenReady().then(async () => {
  fs.writeFileSync(LOG, "");
  // 全局保险：任何挂起 150s 强制退出（Windows GUI 子系统 console.log 可能不落地，结果另写 reader.kernel.log）
  setTimeout(() => {
    logLine("GLOBAL TIMEOUT——套件挂起");
    app.exit(2);
  }, 150000);
  logLine("== 阅读内核契约测试（L0 fake / L1 foliateAdapter / CJK spike） ==");
  // 每次运行前重打 driver bundle（esbuild JS API——Windows 下 execSync+npx 有挂起问题，禁用）
  require("esbuild").buildSync({
    entryPoints: [path.join(__dirname, "reader.driver.js")],
    bundle: true,
    format: "iife",
    target: "chrome120",
    outfile: path.join(__dirname, "reader.bundle.js"),
    logLevel: "silent"
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
  logLine("phase: loading fixture page");
  await win.loadFile(path.join(__dirname, "reader.fixture.html"));
  logLine("phase: fixture page loaded");

  // L0：fakeKernel 语义（直接在页面里跑，纯 JS 无 foliate 依赖）
  logLine("phase: L0 dispatch");
  const fakeResults = await win.webContents.executeJavaScript(
    "window.__readerTest.runFake()",
    true
  ).catch((err) => { logLine("L0 dispatch error: " + err.message); return []; });
  logLine("phase: L0 done");
  report("L0", fakeResults);

  // L1：foliateAdapter 集成（真实夹具 EPUB）
  logLine("phase: building fixtures");
  const fixtures = await buildFixtures();
  logLine("phase: fixtures built");
  const l1 = await win.webContents.executeJavaScript(
    `window.__readerTest.runFoliate(${JSON.stringify(fixtures.normal)}, {
      marker1: "第三章独有锚丙",
      marker2: "第二章独有锚乙",
      externalPart: "example.com",
      internalPart: "ch3.xhtml",
      imageAlt: "夹具图"
    })`,
    true
  );
  report("L1", l1);

  // CJK 专项：ruby + 竖排
  const cjk = await win.webContents.executeJavaScript(
    `window.__readerTest.runCjkSpike(${JSON.stringify(fixtures.ruby)}, ${JSON.stringify(fixtures.vertical)})`,
    true
  );
  report("CJK", cjk);

  win.destroy();
  console.log(`\n==== SUMMARY ${pass}/${pass + fail} ====`);
  if (fail) {
    console.log("FAILED items:");
    for (const f of failures) console.log("  - " + f);
  }
  app.exit(fail ? 1 : 0);
});
