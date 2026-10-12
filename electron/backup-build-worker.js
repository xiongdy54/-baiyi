// D143（v48.98，T1）：备份构建 worker——把「快照整读 + JSZip DEFLATE + 整包写盘」移出主进程。
// 背景（诊断 docs/design/STARTUP-LAG-DIAGNOSIS.md §3 R1b）：835MB×2 快照 fs.readFileSync +
// pako DEFLATE（纯主线程 JS）+ ~900MB fs.writeFileSync 在每日首启备份里构成多段 0.3~1.4s 的
// 主进程事件循环空洞（落在窗口上＝点击冻结）。
// 纪律（与 D137 三库单连接/一致性纪律配套）：
//  ① worker 只做「读文件 → 压缩 → 写 .part → rename」；**不经手任何数据库写路径**——
//     三库快照仍由主进程 db.backup() 页拷贝产出（快照产物 = 自足单文件，worker 只读）。
//  ② 唯一可选只读 DB 连接＝ quick_check 完整性检查（针对快照文件；D137 §3.5 的
//     「启动 quick_check 一次（仅入日志）」语义自 dictDb.open 启动路径迁居于此：每天一次、
//     零启动期阻塞；失败只上报，不影响备份成败）。
//  ③ 产物与旧主线程实现逐字节等价（同 JSZip、同条目级 compression、同全局 DEFLATE 参数）。
const { parentPort, workerData } = require("worker_threads");
const fs = require("fs");
const JSZip = require("jszip");

function post(m) {
  try {
    parentPort.postMessage(m);
  } catch {
    /* 主线程已收摊 */
  }
}

async function run() {
  // 1) 快照完整性检查（只读 + 快照文件 → 每天一次）
  for (const c of workerData.quickCheck || []) {
    try {
      const Database = require("better-sqlite3");
      const d = new Database(c.path, { readonly: true });
      let qc;
      try {
        qc = String(d.pragma("quick_check", { simple: true }));
      } finally {
        try { d.close(); } catch { /* 忽略 */ }
      }
      post({ type: "quickCheck", name: c.name, result: qc });
    } catch (e) {
      post({ type: "quickCheck", name: c.name, error: String((e && e.message) || e).slice(0, 200) });
    }
  }

  // 2) 构建 zip（顺序 = workerData.entries 给定顺序，与旧实现条目序一致）
  const zip = new JSZip();
  for (const e of workerData.entries) {
    const data = e.data !== undefined ? e.data : fs.readFileSync(e.filePath);
    zip.file(e.zipPath, data, { compression: e.compression || "DEFLATE" });
  }
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

  // 3) 先写临时名再改名（半成品 zip 绝不冒充可用备份；与旧实现同语义）
  fs.writeFileSync(workerData.tmpFile, buf);
  fs.renameSync(workerData.tmpFile, workerData.destFile);
  post({ type: "done", ok: true, bytes: buf.length });
}

run().catch((err) => post({ type: "done", ok: false, error: String((err && err.message) || err) }));
