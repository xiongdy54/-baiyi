// D117（v48.73，docs/design/SETTINGS-OPEN-JANK-D116.md §4.2 B）备份 meta 回退解析 worker。
// 职责只有一件事：整包读入一份备份 zip + JSZip 取出 backup-meta.json——这件事此前在主进程
// 事件循环上同步执行，895MB×N 份曾把主进程（=Chromium browser 进程 UI 线程，输入派发与合成
// 出帧都靠它）按住 10–17s，表现为「打开设置卡数秒、整窗滚不动」。挪进 worker 后主进程永远
// 不再被单文件整包读阻塞；worker 失败由主进程同步路径兜底（electron/backup.js parseMetaInWorker）。
const { parentPort, workerData } = require("worker_threads");
const fs = require("fs");
const JSZip = require("jszip");

(async () => {
  try {
    const buf = await fs.promises.readFile(String(workerData.file));
    const zip = await JSZip.loadAsync(buf);
    const entry = zip.file("backup-meta.json");
    const meta = entry ? JSON.parse(await entry.async("string")) : null;
    parentPort.postMessage({ ok: true, meta });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
})();
