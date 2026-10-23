// @runtime: electron
// C-15：settings.json 实现合并——jsonFile.js（BOM / 非对象留档 / 留档轮转 5 份 / 原子写 + fsync / 静态禁 writeSync）。
// 运行：npx electron tests/settings-file.test.cjs
// 隔离：临时 userData（app.setPath），绝不触碰真实设置（§7.3）。
const { app } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");

let pass = 0, fail = 0;
function check(name, cond, expected, actual) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`);
  }
}

const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "settings-file-"));
  try {
    app.setPath("userData", tmp);
    const store = require(path.join(ROOT, "electron", "settingsStore.js"));
    const file = path.join(tmp, "settings.json");
    const corrupts = () => fs.readdirSync(tmp).filter((f) => f.startsWith("settings.json.corrupt-")).sort();

    console.log("== ① 带 BOM 的合法 JSON ==");
    fs.writeFileSync(file, "\uFEFF" + JSON.stringify({ app: { language: "ja" }, theme: { mode: "dark" } }), "utf8");
    const bom = store.readSettings();
    check("① 带 BOM 的合法 JSON 读出正确（不再判为损坏）",
      bom.app?.language === "ja" && bom.theme?.mode === "dark", "ja / dark", bom);

    console.log("== ② 合法 JSON 但不是对象（null） ==");
    fs.writeFileSync(file, "null", "utf8");
    const nullRead = store.readSettings();
    check("② null 返回统一默认形状 { app, theme }（两份实现合一）",
      isPlainObject(nullRead) && isPlainObject(nullRead.app) && isPlainObject(nullRead.theme),
      "{ app: {}, theme: {} }", nullRead);
    const afterNull = corrupts();
    check("② null 被留档为 .corrupt-<时间戳>（不再被静默丢弃）", afterNull.length === 1, "1 份", afterNull);
    check("② 留档内容与原文件逐字一致",
      afterNull.length === 1 && fs.readFileSync(path.join(tmp, afterNull[0]), "utf8") === "null",
      "null", afterNull.length === 1 ? fs.readFileSync(path.join(tmp, afterNull[0]), "utf8") : null);

    console.log("== ③ 连续 7 次损坏 → 留档最多 5 份 ==");
    for (const f of corrupts()) fs.rmSync(path.join(tmp, f), { force: true });
    const seen = [];
    for (let i = 0; i < 7; i++) {
      fs.writeFileSync(file, `{ 坏掉 ${i}`, "utf8");
      store.readSettings();
      await sleep(3); // 留档名含毫秒时间戳，确保 7 次落在不同毫秒
      for (const f of corrupts()) if (!seen.includes(f)) seen.push(f);
    }
    const remaining = corrupts();
    check("③ 7 次损坏后留档恰好 5 份", remaining.length === 5, "5 份", remaining);
    check("③ 保留的是最近 5 次（最旧 2 份被清）",
      seen.length === 7 && JSON.stringify(remaining) === JSON.stringify(seen.slice(-5).sort()),
      seen.slice(-5).sort(), remaining);

    console.log("== ④ 原子写 + 写后可解析 ==");
    store.writeSettings({ app: { a: 1, b: "保留我" }, theme: { mode: "dark" } });
    let parsed = null;
    try { parsed = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* 下方断言报错 */ }
    check("④ writeSettings 后文件是合法 JSON 且内容正确",
      parsed?.app?.a === 1 && parsed?.app?.b === "保留我" && parsed?.theme?.mode === "dark", "a=1 / b=保留我 / dark", parsed);
    check("④ 原子写不留 .tmp 残留", !fs.existsSync(file + ".tmp"), "无 .tmp", fs.existsSync(file + ".tmp") ? "有残留" : "无");
    check("④ 写后读回一致", store.readSettings().app?.b === "保留我", "保留我", store.readSettings().app?.b);

    console.log("== ⑤ 静态：jsonFile 禁止 fs.writeSync( 直接写字符串 ==");
    const src = fs.readFileSync(path.join(ROOT, "electron", "jsonFile.js"), "utf8");
    const writeSyncHits = src.match(/fs\.writeSync\s*\(/g) || [];
    check("⑤ jsonFile.js 源码中不得出现 fs.writeSync(（磁盘将满时只写一部分且不报错）", writeSyncHits.length === 0, "0 处", writeSyncHits.length);
    check("⑤ 必须走 writeFileSync(fd, …) + fsyncSync(fd)",
      /writeFileSync\(fd/.test(src) && /fsyncSync\(fd\)/.test(src), "writeFileSync(fd) + fsyncSync(fd)", "未检出");

    console.log(`\n==== settings-file.test：${pass} 通过 / ${fail} 失败 ====`);
  } catch (e) {
    console.error("测试异常：", (e && e.stack) || e);
    fail++;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* 清理失败忽略 */ }
    const code = fail === 0 ? 0 : 1;
    try { app.quit(); } catch { /* ignore */ }
    setTimeout(() => process.exit(code), 120);
  }
});
