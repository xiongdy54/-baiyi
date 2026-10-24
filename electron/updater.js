// 软件更新（v49.6 / D180，§4.2-17 通道增补、§7.2 联网例外登记）
//
// 选型 electron-updater（electron-builder 官方配套，Electron 生态事实标准）：
// - 「检查」＝electron-updater 内建：拉取 GitHub 最新 Release 的 latest.yml 元数据，
//   与 app.getVersion()（唯一真源＝package.json version）做 semver 对比——本模块不实现版本比对；
// - autoDownload=false：自动检查只通知不下载，下载与安装一律经用户在设置页确认
//   （本地优先纪律：未经确认零出网下载；联网面与例外登记见 §7.2 / D180）；
// - 渠道分流（D180）：process.windowsStore（MSIX 包身份运行）＝Store 版，updater 全禁用
//   （更新由 Microsoft Store 依 Partner Center 提交的包版本管理，应用不得也不需要自更新）；
//   dev（!app.isPackaged）恒不检查；e2e 隔离进程（M7_TEST_USERDATA）同样不检查；
//   C-30（2026-10-24）：Linux 非 AppImage（deb/rpm 安装，无 APPIMAGE env）＝unsupported，
//   同样不自更新——设置页提示「请通过软件包管理器更新」（U-21：deb/rpm 的更新行为未确认前
//   不尝试自更新）；AppImage 安装（APPIMAGE env 指向 .AppImage 自身）仍走 GitHub Releases 渠道。
// - 失败静默降级：只记日志与状态快照，不弹系统对话框、不阻塞任何业务路径。
//
// IPC（本模块注册，先例＝pluginHost）：update:status / update:check / update:download / update:install；
// 主→渲染单向推送 update:event（{type, info, error}，非 invoke 通道）。
const { app, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

// electron-builder.yml publish.owner 的占位符：发布前未替换时按「未配置」处理，
// 避免把 404 报成「检查失败」误导用户（§9.5 v49.6 待办）。
const PLACEHOLDER_OWNER = "YOUR_GITHUB_USERNAME";
// 自动检查时点（用户 2026-10-16 修订）：启动后第 30 秒检查一次——**每次启动仅此一次**，
// 本次运行内不再自动检查（无循环定时器）；退出软件后再次启动才会再查；手动检查不受限。
// 延迟 30s 让启动关键段与首屏先行（backup 自动备份同 30s 惯例）。
const CHECK_DELAY_MS = 30000;

// 状态机：idle → checking → available | not-available → downloading → downloaded；error 任意态可达
const state = { state: "idle", info: null, progress: null, error: null };
let sendToMain = null;
let appLogRef = null;
let wired = false;
let autoUpdaterRef = null; // 惰性 require：dev / Store / e2e 进程永远不加载

function log(level, msg) {
  try {
    appLogRef && appLogRef.log(level, "updater", msg);
  } catch {
    /* 日志永不外溢（D119 纪律） */
  }
}

function loadAutoUpdater() {
  if (!autoUpdaterRef) autoUpdaterRef = require("electron-updater").autoUpdater;
  return autoUpdaterRef;
}

// 更新渠道判定（D180）：dev / store / unconfigured / github；C-30 增 unsupported（Linux deb/rpm）
function source() {
  if (!app.isPackaged) return "dev";
  if (process.windowsStore) return "store";
  // C-30（2026-10-24，报告第 4 步）：Linux 只有 AppImage 是 electron-updater 的更新目标；
  // deb/rpm 安装（无 APPIMAGE env）不自更新，设置页显示「请通过软件包管理器更新」。
  if (process.platform === "linux" && !process.env.APPIMAGE) return "unsupported";
  // 打包版：electron-builder 依 publish 配置把更新源写进资源内 app-update.yml；缺失或
  // 仍是占位符 slug = 未配置（检查会 404，提前判定避免误报「检查失败」）
  try {
    const yml = fs.readFileSync(path.join(process.resourcesPath, "app-update.yml"), "utf-8");
    return yml.includes(PLACEHOLDER_OWNER) ? "unconfigured" : "github";
  } catch {
    return "unconfigured";
  }
}

// 渲染层状态快照（update:status 响应；info/progress 均为纯 JSON 可跨 IPC）
function snapshot() {
  const src = source();
  return {
    source: src,
    enabled: src === "github",
    currentVersion: app.getVersion(),
    state: state.state,
    info: state.info,
    progress: state.progress,
    error: state.error
  };
}

// 主→渲染推送：type ∈ checking / available / not-available / progress / downloaded / error
function emit(type, payload) {
  if (!sendToMain) return;
  try {
    sendToMain("update:event", payload);
  } catch (err) {
    log("ERROR", `推送事件失败（不影响更新流程）：${err && err.message}`);
  }
}

function setState(next, extra) {
  if (extra && extra.info !== undefined) state.info = extra.info;
  if (extra && extra.progress !== undefined) state.progress = extra.progress;
  if (extra && extra.error !== undefined) state.error = extra.error;
  emit(next, { type: next, info: state.info, progress: state.progress, error: state.error });
}

// 只留纯 JSON 字段（electron-updater 的 UpdateInfo 携带文件清单等重载荷，渲染层用不到）
function pickUpdateInfo(info) {
  if (!info) return null;
  return {
    version: info.version,
    releaseName: info.releaseName,
    releaseDate: info.releaseDate
  };
}

function pickProgress(p) {
  if (!p) return null;
  return {
    percent: Math.min(100, Math.max(0, Math.round((p.percent || 0) * 10) / 10)),
    transferred: p.transferred,
    total: p.total,
    bytesPerSecond: p.bytesPerSecond
  };
}

function errMessage(err) {
  return (err && err.message) || String(err);
}

// 事件接线一次（autoUpdater 是模块级单例，重复 on 会叠发）
function wireEvents(autoUpdater) {
  if (wired) return;
  wired = true;
  autoUpdater.autoDownload = false; // D180：只检查不下载，下载/安装一律用户确认
  autoUpdater.logger = {
    // electron-updater 默认在 Windows 上弹错误对话框——静默接管为应用日志（失败不打扰）
    info: (msg) => log("INFO", String(msg)),
    warn: (msg) => log("WARN", String(msg)),
    error: (msg) => log("ERROR", String(msg)),
    debug: () => {}
  };
  autoUpdater.on("checking-for-update", () => setState("checking"));
  autoUpdater.on("update-available", (info) => setState("available", { info: pickUpdateInfo(info) }));
  autoUpdater.on("update-not-available", (info) => setState("not-available", { info: pickUpdateInfo(info) }));
  autoUpdater.on("download-progress", (p) => setState("downloading", { progress: pickProgress(p) }));
  autoUpdater.on("update-downloaded", (info) => {
    log("INFO", `更新包已就绪：v${info && info.version}`);
    setState("downloaded", { info: pickUpdateInfo(info) });
  });
  autoUpdater.on("error", (err) => {
    log("ERROR", `更新流程出错：${errMessage(err)}`);
    setState("error", { error: errMessage(err) });
  });
}

async function check() {
  if (source() !== "github") return snapshot();
  try {
    const autoUpdater = loadAutoUpdater();
    wireEvents(autoUpdater);
    setState("checking");
    const result = await autoUpdater.checkForUpdates();
    log("INFO", `检查完成：远端 ${result && result.isUpdateAvailable ? `有新版本 v${result.updateInfo && result.updateInfo.version}` : "无更新"}`);
  } catch (err) {
    // 网络失败 / feed 不可达：静默降级为 error 态（设置页可见），不打扰
    setState("error", { error: errMessage(err) });
  }
  return snapshot();
}

async function download() {
  if (source() !== "github") return snapshot();
  if (state.state !== "available") return snapshot(); // 只有「发现新版本」才允许下载
  try {
    const autoUpdater = loadAutoUpdater();
    setState("downloading", { progress: null });
    await autoUpdater.downloadUpdate();
  } catch (err) {
    log("ERROR", `下载失败：${errMessage(err)}`);
    setState("error", { error: errMessage(err) });
  }
  return snapshot();
}

function install() {
  if (source() !== "github" || state.state !== "downloaded") return false;
  // 静默安装 + 装完自动重启（NSIS /S 保留原安装目录与 userData；D123 的 before-quit 钩子照常走）
  loadAutoUpdater().quitAndInstall(true, true);
  return true;
}

// init：注册 IPC + 调度启动自动检查。sendToMain 需是「不打扰式」发送（隐藏窗口照投，不聚焦）；
// e2e 隔离进程（M7_TEST_USERDATA）不注册调度，IPC 快照仍可用（GUI 断言渠道显示）。
function init(opts) {
  sendToMain = opts.sendToMain;
  appLogRef = opts.log;
  ipcMain.handle("update:status", () => snapshot());
  ipcMain.handle("update:check", () => check());
  ipcMain.handle("update:download", () => download());
  ipcMain.handle("update:install", () => install());
  if (process.env.M7_TEST_USERDATA) return;
  setTimeout(() => {
    let on = true;
    try {
      on = (opts.readSettings().app || {}).updateAutoCheck !== false;
    } catch {
      on = true; // 读取失败按默认开（与渲染层 settingsStore.get 兜底口径一致）
    }
    const src = source();
    if (!on) {
      log("INFO", "自动检查已关闭（app.updateAutoCheck=false）");
      return;
    }
    if (src !== "github") {
      log("INFO", `跳过自动检查：渠道=${src}`);
      return;
    }
    log("INFO", "启动自动检查更新");
    void check();
  }, CHECK_DELAY_MS);
}

module.exports = { init, source, snapshot };
