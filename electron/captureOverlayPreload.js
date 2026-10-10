// 屏幕截图遮罩窗口的最小桥（仅此窗口用）
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("captureOverlay", {
  getShot: () => ipcRenderer.invoke("screen-capture:shot"),
  ready: () => ipcRenderer.send("screen-capture:ready"),
  done: (rect) => ipcRenderer.send("screen-capture:done", rect)
});
