// M2 数据备份与恢复 GUI 端到端验证（CDP 驱动真实应用）
// 流程：基线计数 → 手动备份（含 Key）→ 磁盘验证 zip → 恢复（staging+标记，运行期库文件不被改）
//       → 重启应用 → 断言数据不丢、staging 清理 → 设置页「备份与恢复」UI + 截图
// 安全性：恢复目标是刚创建的备份（内容=当前数据），不会丢失用户数据；恢复过程自动生成安全备份。
// 前置：应用已以 --remote-debugging-port=9224 启动
import fs from "node:fs";
import path from "node:path";

const UD = path.join(process.env.APPDATA, "incremental-reading-dev");
const SHOT = path.join(UD, "backups"); // 备份目录

let pass = 0, fail = 0;
function check(name, cond, actual) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} | 实际: ${String(actual).slice(0, 220)}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 90; i++) {
    try {
      const list = await (await fetch("http://127.0.0.1:9224/json")).json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
        let id = 0;
        const pending = new Map();
        ws.addEventListener("message", (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        });
        const send = (method, params = {}) => new Promise((res) => {
          const mid = ++id;
          pending.set(mid, res);
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
        const evalJS = async (expr) => {
          const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) return "EXC: " + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)).slice(0, 250);
          return r.result?.result?.value;
        };
        return { ws, send, evalJS };
      }
    } catch { /* 端口未就绪，继续等 */ }
    await sleep(1000);
  }
  throw new Error("CDP 连接失败（应用未以 9224 端口启动？）");
}

const baselineExpr = `(async () => {
  const cards = await window.cardsAPI.listAll();
  const items = await window.libraryAPI.list();
  return JSON.stringify({ cards: cards.length, items: items.length });
})()`;

console.log("== 1) 连接 + 基线 ==");
let c = await connect();
const baseline = JSON.parse(await c.evalJS(baselineExpr));
check("读取基线（卡片/书籍数）", baseline.cards > 0 && baseline.items > 0, JSON.stringify(baseline));
const info = JSON.parse(await c.evalJS(`window.backupAPI.info().then((r) => JSON.stringify(r))`));
check("backup:info 返回数据量与备份位置", info.dbBytes > 0 && typeof info.backupDir === "string", JSON.stringify(info).slice(0, 160));

console.log("== 2) 手动备份（勾选含 Key） ==");
const created = JSON.parse(await c.evalJS(`(async () => {
  const r = await window.backupAPI.create({ includeAIConfig: true });
  return JSON.stringify(r);
})()`));
check("备份成功并返回路径", created.ok === true && !!created.file, JSON.stringify(created));
check("zip 存在于备份目录", fs.existsSync(created.file), created.file);
const zipName = path.basename(created.file);
check("备份目录即 info.backupDir", path.dirname(created.file) === info.backupDir, `${path.dirname(created.file)} vs ${info.backupDir}`);

console.log("== 3) 备份清单与启动自动备份 ==");
const listR = JSON.parse(await c.evalJS(`window.backupAPI.list().then((r) => JSON.stringify(r))`));
const manualEntry = listR.backups.find((b) => b.file === zipName);
check("列表含该手动备份且标记含 Key", !!manualEntry && manualEntry.includesAIConfig === true, JSON.stringify(manualEntry).slice(0, 200));
check("清单记录数据规模", manualEntry?.counts?.cards === baseline.cards, JSON.stringify(manualEntry?.counts));
const today = new Date();
const p2 = (n) => String(n).padStart(2, "0");
const autoName = `backup-auto-${today.getFullYear()}-${p2(today.getMonth() + 1)}-${p2(today.getDate())}.zip`;
check("启动时已生成今日自动备份", fs.existsSync(path.join(SHOT, autoName)), autoName);

console.log("== 4) 恢复（staging + 标记，运行期库文件不动） ==");
const dbBefore = fs.readFileSync(path.join(UD, "library.db"));
const restored = JSON.parse(await c.evalJS(`(async () => {
  const r = await window.backupAPI.restore(${JSON.stringify(created.file)});
  return JSON.stringify(r);
})()`));
check("恢复成功且要求重启", restored.ok === true && restored.needsRestart === true, JSON.stringify(restored).slice(0, 220));
check("已生成恢复前安全备份", /backup-safety-/.test(restored.safetyFile || "") && fs.existsSync(restored.safetyFile || ""), restored.safetyFile);
check("标记文件已写入", fs.existsSync(path.join(UD, "restore-pending.json")), "restore-pending.json");
check("staging 已含 library.db", fs.existsSync(path.join(UD, "restore-staging", "library.db")), "staging/library.db");
check("运行期 library.db 字节未变（sql.js 约束）", Buffer.compare(dbBefore, fs.readFileSync(path.join(UD, "library.db"))) === 0, "db untouched");

console.log("== 5) 重启应用 → 换入生效 ==");
await c.evalJS(`window.backupAPI.relaunch()`);
await sleep(3000);
try { c.ws.close(); } catch { /* 已断开 */ }
c = await connect();
const after = JSON.parse(await c.evalJS(baselineExpr));
check("重启后卡片/书籍数不丢", after.cards === baseline.cards && after.items === baseline.items, `${JSON.stringify(baseline)} → ${JSON.stringify(after)}`);
check("staging 与标记已清理", !fs.existsSync(path.join(UD, "restore-staging")) && !fs.existsSync(path.join(UD, "restore-pending.json")), "cleanup");
check("应用正常响应（settingsAPI 可用）", (await c.evalJS(`typeof window.settingsAPI.get`)) === "function", "settingsAPI");

console.log("== 6) 设置页「备份与恢复」UI ==");
await c.evalJS(`document.querySelector('.icon-btn[title="设置"]').click(); "ok"`);
await sleep(600);
const navTexts = await c.evalJS(`[...document.querySelectorAll('.settings-nav button')].map((b) => b.textContent).join('/')`);
check("设置导航含「备份与恢复」", String(navTexts).includes("备份与恢复"), navTexts);
await c.evalJS(`[...document.querySelectorAll('.settings-nav button')].find((b) => b.textContent === "备份与恢复").click(); "ok"`);
await sleep(500);
const secText = await c.evalJS(`document.querySelector('#sec-backup')?.innerText.replace(/\\n/g, ' | ').slice(0, 400)`);
check("区块含立即备份", String(secText).includes("立即备份"), secText);
check("区块含自动备份与保留份数", String(secText).includes("每日首次启动自动备份") && String(secText).includes("份"), secText);
check("区块显示备份位置", String(secText).includes("备份位置"), secText);
const rowText = await c.evalJS(`[...document.querySelectorAll('#sec-backup .backup-row')].map((r) => r.innerText.replace(/\\n/g, ' ')).join(' || ').slice(0, 400)`);
check("备份列表渲染出条目（含手动/自动/安全标签）", String(rowText).includes("手动") && String(rowText).includes("自动") && String(rowText).includes("安全"), rowText);
check("每行有恢复按钮", (await c.evalJS(`[...document.querySelectorAll('#sec-backup .backup-row button')].filter((b) => b.textContent === "恢复").length`)) >= 3, rowText);

const shot = await c.send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(path.join("tests", "m2-settings.png"), Buffer.from(shot.result?.data ?? shot.data ?? "", "base64"));
console.log("  截图已存 tests/m2-settings.png");

console.log(`\nM2 GUI 端到端：${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
