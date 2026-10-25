// C-02 步骤 3（可选 P3 收尾）：测试清理只杀自己启动的 Electron 子进程，不再按映像名全杀本机 electron.exe。
// 配套要求：POSIX 上 spawn 必须带 detached: true（子进程成为进程组长，process.kill(-pid) 才能整组收割）；
// Windows 走 taskkill /PID /T /F（/T 连子进程一起）。child 已退出时静默返回。
const { spawnSync } = require("child_process");
module.exports = function killProc(child) {
  if (!child || child.pid == null) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      try { process.kill(-child.pid); } catch { /* 已退出 */ }
    }
  } catch { /* 已退出 */ }
  child.kill?.();
};
