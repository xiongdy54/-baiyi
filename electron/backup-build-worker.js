// D143（v48.98，T1）：备份构建 worker——把「快照整读 + JSZip DEFLATE + 整包写盘」移出主进程。
// 背景（诊断 docs/design/STARTUP-LAG-DIAGNOSIS.md §3 R1b）：835MB×2 快照 fs.readFileSync +
// pako DEFLATE（纯主线程 JS）+ ~900MB fs.writeFileSync 在每日首启备份里构成多段 0.3~1.4s 的
// 主进程事件循环空洞（落在窗口上＝点击冻结）。
// 纪律（与 D137 三库单连接/一致性纪律配套）：
//  ① worker 只做「读文件 → 压缩 → 写 .part → fsync → rename」；**不经手任何数据库写路径**——
//     三库快照仍由主进程 db.backup() 页拷贝产出（快照产物 = 自足单文件，worker 只读）。
//  ② 唯一可选只读 DB 连接＝ quick_check 完整性检查（针对快照文件；D137 §3.5 的
//     「启动 quick_check 一次（仅入日志）」语义自 dictDb.open 启动路径迁居于此：每天一次、
//     零启动期阻塞；失败只上报，不影响备份成败）。
//  ③ 流式写入，自动 ZIP64（C-12：JSZip 不支持 ZIP64，单文件或整包 >4GiB 会产出损坏包；
//     yazl 文件条目内部走 ReadStream，内存占用与文件大小无关）。
const { parentPort, workerData } = require("worker_threads");
const fs = require("fs");
const yazl = require("yazl");

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

  // 2) 流式构建：条目按给定顺序加入；文件条目由 yazl 内部用 ReadStream 读取，内存占用与文件大小无关
  const zip = new yazl.ZipFile();
  for (const e of workerData.entries) {
    const compress = (e.compression || "DEFLATE") === "DEFLATE";
    if (e.data !== undefined) zip.addBuffer(Buffer.from(e.data), e.zipPath, { compress });
    else zip.addFile(e.filePath, e.zipPath, { compress });
  }
  zip.end();
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(workerData.tmpFile);
    zip.outputStream.on("error", reject);
    out.on("error", reject);
    out.on("close", resolve);
    zip.outputStream.pipe(out);
  });

  // 3) fsync 后再改名：断电时不会留下「改名成功但内容未落盘」的备份
  const fd = fs.openSync(workerData.tmpFile, "r+");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(workerData.tmpFile, workerData.destFile);
  post({ type: "done", ok: true, bytes: fs.statSync(workerData.destFile).size });
}

run().catch((err) => post({ type: "done", ok: false, error: String((err && err.message) || err) }));
