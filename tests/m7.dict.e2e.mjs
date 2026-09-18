// M7 词典下载+本地查词端到端（CDP 自启自关；node tests/m7.dict.e2e.mjs）
// 用户痛点回归：
//   1) 真实下载 CC-CEDICT（mdbg 直链 4MB）→ 建索引 → 本地查「苹果」出英文释义；
//   2) 本地构造 ECDICT-sqlite zip 夹具（sql.js 生成含 word/translation 表）→ importFile 验证 .db 探测分支；
//   3) 来源登记/entry_count 一致 → 清理。
import { spawn, execSync } from "node:child_process";
import fs, { openSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9226";
const require2 = createRequire(import.meta.url);

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 240)}`); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let electron = null;

async function connect() {
  for (let i = 0; i < 90; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) {
        const ws = new globalThis.WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
        let id = 0;
        const pending = new Map();
        ws.addEventListener("message", (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        });
        const send = (method, params = {}) => new Promise((res) => {
          const mid = ++id; pending.set(mid, res);
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
        const evalJS = async (expr) => {
          const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) return "EXC: " + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)).slice(0, 300);
          return r.result?.result?.value;
        };
        return { ws, send, eval: evalJS };
      }
    } catch { /* 端口未就绪 */ }
    await wait(1000);
  }
  throw new Error("CDP 连接失败");
}

// 本地构造 ECDICT-sqlite zip 夹具：sql.js 建 word/phonetic/translation/pos 表 → jszip 打包
async function buildSqliteZipFixture() {
  const initSqlJs = require2("sql.js");
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run("CREATE TABLE stardict (id INTEGER PRIMARY KEY, word TEXT, phonetic TEXT, translation TEXT, pos TEXT)");
  db.run("INSERT INTO stardict (word, phonetic, translation, pos) VALUES ('moral','/ˈmɔːrəl/','n. 道德；寓意\\nadj. 道德的','n./adj.')");
  db.run("INSERT INTO stardict (word, phonetic, translation, pos) VALUES ('abandon','/əˈbændən/','v. 放弃；遗弃','v.')");
  const bytes = Buffer.from(db.export());
  db.close();
  const JSZip = require2("jszip");
  const zip = new JSZip();
  zip.file("ecdict.db", bytes);
  const fixture = path.join(ROOT, "tests", "tmp-m7-fixture-ecdict-sqlite.zip");
  writeFileSync(fixture, await zip.generateAsync({ type: "nodebuffer" }));
  return fixture;
}

try {
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 无残留 */ }
  await wait(800);
  const out = openSync(path.join(ROOT, "tests", "m7.dict.e2e.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: false,
    env: { ...process.env, M7_TEST_USERDATA: path.join(ROOT, "tests", "tmp-m7-userdata") }
  });
  const cdp = await connect();
  await wait(2000);

  // 1. 真实下载 CC-CEDICT（4MB 直链）并建索引
  const dl = await cdp.eval(`(async () => {
    try {
      const r = await window.dictAPI.download({ id: "cc-cedict", url: "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.zip", format: "cedict-zip", name: "CC-CEDICT" });
      return JSON.stringify(r);
    } catch (e) { return "ERR: " + (e?.message || String(e)).slice(0, 200); }
  })()`);
  check("CC-CEDICT 下载+建索引成功（parsed=true）", typeof dl === "string" && dl.includes('"parsed":true'), dl);
  const count = typeof dl === "string" && dl.includes("count") ? Number(JSON.parse(dl).count) : 0;
  check("词条数>100000（CC-CEDICT 全量）", count > 100000, count);

  // 2. 本地查词：苹果（简体 headword）应命中英文释义
  const hits = await cdp.eval(`(async () => {
    const r = await window.dictAPI.lookupLocal("苹果");
    return JSON.stringify(r.slice(0, 1));
  })()`);
  check("本地查到 苹果", typeof hits === "string" && hits !== "[]" && !hits.startsWith("EXC"), hits);
  check("释义含英文", typeof hits === "string" && /[a-zA-Z]/.test(hits), hits);

  // 3. ECDICT sqlite zip 夹具 → importFile（验证 .db 探测分支 iterEcdictSqlite）
  const fixture = await buildSqliteZipFixture();
  const imp = await cdp.eval(`(async () => {
    try {
      const r = await window.dictAPI.importFile(${JSON.stringify(fixture)});
      return JSON.stringify(r);
    } catch (e) { return "ERR: " + (e?.message || String(e)).slice(0, 200); }
  })()`);
  check("sqlite zip 导入成功（count=2）", typeof imp === "string" && imp.includes('"count":2'), imp);
  const moralHit = await cdp.eval(`(async () => {
    const r = await window.dictAPI.lookupLocal("moral");
    return JSON.stringify(r.slice(0, 1));
  })()`);
  check("sqlite 夹具查 moral 含中文释义", typeof moralHit === "string" && moralHit.includes("道德"), moralHit);

  // 4. 来源登记一致
  const src = await cdp.eval(`(async () => {
    const s = await window.dictAPI.sources();
    const mine = s.find((x) => x.name === "CC-CEDICT");
    return mine ? mine.format + ":" + mine.entry_count : "none";
  })()`);
  check("来源登记 cedict + 词条数一致", src === `cedict:${count}`, src);

  // 清理：删除测试来源（同时删词条）与夹具
  await cdp.eval(`(async () => { const s = await window.dictAPI.sources(); for (const x of s.filter((v) => v.name === "CC-CEDICT" || v.name.includes("tmp-m7-fixture") || v.name.includes("ecdict.db"))) await window.dictAPI.removeSource(x.id); return true; })()`);
  try { fs.rmSync(fixture, { force: true }); } catch { /* 忽略 */ }

  console.log(`\nM7 dict e2e: ${pass} 通过 / ${fail} 失败`);
} catch (e) {
  fail++;
  console.log("M7 dict e2e 异常", e);
} finally {
  try { electron?.kill(); } catch { /* 忽略 */ }
  try { execSync("taskkill /IM electron.exe /F", { stdio: "ignore" }); } catch { /* 忽略 */ }
}
process.exit(fail > 0 ? 1 : 0);
