// 快速记录窗口专用 preload（v36，M8-A）——**最小桥**：只暴露捕获窗口需要的两组能力
// （settings 只读主题 / captureAPI = 自身控制 + 草稿读写）。刻意不暴露 cards/library/ai 等
// 主窗口才需要的大面 API（最小权限，§7.5）。注意：不与主窗口 preload 的 `journalAPI` 同名，
// 避免两套形状在渲染层类型上互相冲突。
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("settingsAPI", {
  get: (scope, key) => ipcRenderer.invoke("settings:get", scope, key),
  // C-31：设置变更推送（只读最小桥上的订阅面）——settings:set 写入成功后广播给未发起写入的窗口。
  // 单向推送，不计入 IPC 注册清单（D123 / D180 同口径，事件名见 electron/main.js settings:set 头注）。
  onChanged: (cb) => {
    const handler = (_e, p) => cb(p);
    ipcRenderer.on("settings:changed", handler);
    return () => ipcRenderer.removeListener("settings:changed", handler);
  }
});

// v48.89（D132 §4.4）：捕获窗口跟随主题插件的**最小子集桥**——只读激活载荷 + 推送订阅，
// 不暴露 list/setActive/openFolder（捕获窗无插件管理面；最小权限，§7.5）。
contextBridge.exposeInMainWorld("pluginsAPI", {
  getActive: () => ipcRenderer.invoke("plugins:getActive"),
  onChanged: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("plugins:changed", handler);
    return () => ipcRenderer.removeListener("plugins:changed", handler);
  }
});

contextBridge.exposeInMainWorld("captureAPI", {
  // 渲染层首帧就绪后通知主进程（主进程收到才 show，杜绝白闪）
  ready: () => ipcRenderer.send("capture:ready"),
  hide: () => ipcRenderer.invoke("capture:hide"),
  onShown: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("capture:shown", handler);
    return () => ipcRenderer.removeListener("capture:shown", handler);
  },
  // 日记（草稿-发送协议；§6.5.2）
  day: (date) => ipcRenderer.invoke("journal:day", date),
  draft: () => ipcRenderer.invoke("journal:draft"),
  draftSave: (contentMarkdown) => ipcRenderer.invoke("journal:draftSave", contentMarkdown),
  draftSend: (contentMarkdown) => ipcRenderer.invoke("journal:draftSend", contentMarkdown),
  discardDraft: (id) => ipcRenderer.invoke("journal:delete", id)
});
