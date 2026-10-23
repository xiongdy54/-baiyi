// D117（v48.73，docs/design/SETTINGS-OPEN-JANK-D116.md §4.2 B）备份 meta 回退解析 worker。
// 职责只有一件事：从一份备份 zip 取出 backup-meta.json——这件事此前在主进程
// 事件循环上同步执行，895MB×N 份曾把主进程（=Chromium browser 进程 UI 线程，输入派发与合成
// 出帧都靠它）按住 10–17s，表现为「打开设置卡数秒、整窗滚不动」。挪进 worker 后主进程永远
// 不再被单文件整包读阻塞；worker 失败由主进程同步路径兜底（electron/backup.js parseMetaInWorker）。
// C-12：整包读入（fs.readFile + JSZip.loadAsync）改为 yauzl 只读中央目录 + 单个小条目
// （zipRead.readBackupMeta）——GB 级备份也是毫秒级，且不再有 2GiB 的 fs.readFile 上限。
const { parentPort, workerData } = require("worker_threads");
const { readBackupMeta } = require("./zipRead");

(async () => {
  try {
    const meta = await readBackupMeta(String(workerData.file));
    parentPort.postMessage({ ok: true, meta });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
})();
