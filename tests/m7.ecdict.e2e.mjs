// M7 ECDICT 完整版全链路验证（CDP 自启自关；node tests/m7.ecdict.e2e.mjs）
// 前置：tests/tmp-ecdict.zip（curl 下载的 ecdict-sqlite-28.zip，207MB）。
// 覆盖：importFile(.zip 内 .db) → iterEcdictSqlite 表探测 → 数十万词条建索引耗时 → lookupLocal("moral")。
import { spawn } from "node:child_process";
import killProc from "./lib/killProc.cjs";
import fs, { openSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = "9227";
const ZIP = path.join(ROOT, "tests", "tmp-ecdict.zip");

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 300)}`); }
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

try {
  if (!existsSync(ZIP)) { console.log("缺前置文件 tests/tmp-ecdict.zip"); process.exit(1); }
  killProc(electron);
  await wait(800);
  const out = openSync(path.join(ROOT, "tests", "m7.ecdict.e2e.log"), "w");
  electron = spawn("npx", ["electron", ".", "--remote-debugging-port=" + PORT], {
    cwd: ROOT, shell: true, stdio: ["ignore", out, out], detached: process.platform !== "win32",
    env: { ...process.env, M7_TEST_USERDATA: path.join(ROOT, "tests", "tmp-m7-userdata") }
  });
  const cdp = await connect();
  await wait(2000);

  const t0 = Date.now();
  const imp = await cdp.eval(`(async () => {
    try {
      const r = await window.dictAPI.importFile(${JSON.stringify(ZIP)});
      return JSON.stringify(r);
    } catch (e) { return "ERR: " + (e?.message || String(e)).slice(0, 280); }
  })()`);
  const secs = Math.round((Date.now() - t0) / 1000);
  check("ECDICT sqlite zip 导入成功", typeof imp === "string" && imp.includes('"parsed":true'), `${imp} @ ${secs}s`);
  const count = typeof imp === "string" && imp.includes('"count"') && !imp.startsWith("ERR") ? Number(JSON.parse(imp).count) : 0;
  const capped = typeof imp === "string" && imp.includes('"capped":true');
  check("词条数 > 3000000（ECDICT 全量 340 万，不被 cap 截断）", count > 3000000 && !capped, `${count} capped=${capped}`);

  const hits = await cdp.eval(`(async () => {
    const r = await window.dictAPI.lookupLocal("moral");
    return JSON.stringify(r.slice(0, 2));
  })()`);
  check("本地查到 moral", typeof hits === "string" && hits !== "[]" && !hits.startsWith("EXC"), hits);
  check("释义含中文", typeof hits === "string" && /[\u4e00-\u9fa5]/.test(hits), hits);

  // 清理：删除测试来源（词条一并删）
  await cdp.eval(`(async () => { const s = await window.dictAPI.sources(); for (const x of s.filter((v) => v.name === "tmp-ecdict.zip")) await window.dictAPI.removeSource(x.id); return true; })()`);
  console.log(`  ⏱ 导入+建索引耗时 ${secs}s`);
  console.log(`\nM7 ecdict e2e: ${pass} 通过 / ${fail} 失败`);
} catch (e) {
  fail++;
  console.log("M7 ecdict e2e 异常", e);
} finally {
  killProc(electron);
}
process.exit(fail > 0 ? 1 : 0);
