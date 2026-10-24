// pluginHost.js — 插件/主题宿主主进程面（v48.89 / D132，设计 docs/design/PLUGIN-SYSTEM-D132.md §4）
//
// 职责（§4.3 生命周期映射）：scan()（§4.2-4 的 load）＝扫描 <userData>/plugins/ 全部插件文件夹 →
// 内存记录表 {id → 记录}（惰性 + 缓存 + rescan 失效）；activate/deactivate（§4.2-4 的 enable/disable）
// ＝写 app.activeThemePlugin（settings.json app 层）+ 与内置皮肤互斥（§7.3，pluginCore.nextAppearanceState）；
// contributes 映射＝记录表内 {css, settingsSchema}（§2.2 第 3 条：其余 contribute 类型不存在）。
//
// 纪律：
//  · **启动主流程不调用扫描**（惰性，首拉才扫，§4.7）——插件目录整体损坏不可能阻塞启动；
//  · **宿主对 <userData>/plugins/ 内的一切文件零写入**（§4.6，§7.2 零负担声明）——只读 + openFolder 的 mkdir；
//  · 出错隔离：逐文件夹独立 try/catch → error 记录条目（可读 reason），坏插件不拖垮主进程；
//  · IPC handler 对插件内容错误**返回状态载荷而不 throw**；仅参数类型滥用 throw（调用方契约错误）；
//  · main.js（插件代码）**不读取、不执行**（§9.1 裁定）——本模块没有任何 require/eval 插件文件的通路。
"use strict";
const { app, ipcMain, shell, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
const core = require("./pluginCore");

let ctx = null; // { readSettings, writeSettings }（main.js 侧 settings.json 单一入口，§9.2 R5）

// C-24（Electron 45）：渲染层首帧即请求 plugins:getActive，而本模块的 IPC 注册在 init()
// （D143 T4 又把 init 挪到 initDb 后的宏任务）——注册前到达即「No handler registered」。
// 该 handler 提前到模块加载期注册：ctx 就绪闸挂起放行（init() 末尾解析）；DB 抛错路径应用
// 随即退出，闸不解析无副作用（与 main.js dbReadyGate 同口径）。
let _resolveActiveGate;
const activeHandlerGate = new Promise((r) => { _resolveActiveGate = r; });
/** 当前激活载荷（仅可在 ctx 就绪后调用；原 registerIpc 内 getActive handler 的主体） */
function getActivePayload() {
  const id = activeIdOf();
  if (!id) return null;
  const rec = listRecords(false).get(id);
  if (!rec || rec.status !== "ok") {
    // 激活中的插件被删除/失效 → 自动失效并广播（§4.3 unload）；渲染层回落默认外观（§6.3）
    deactivate();
    return null;
  }
  const vars = core.assembleVars(rec.settingsSchema, valuesOf(id));
  return { id, css: rec._cssText, vars };
}
ipcMain.handle("plugins:getActive", async () => {
  await activeHandlerGate;
  return getActivePayload();
});
let cache = null; // Map<id, 记录>；null = 未扫描（惰性）

function pluginsRoot() {
  return path.join(app.getPath("userData"), core.PLUGINS_DIRNAME);
}

function activeIdOf() {
  try {
    const v = ctx.readSettings().app?.activeThemePlugin;
    return typeof v === "string" ? v : "";
  } catch {
    return "";
  }
}

function valuesOf(id) {
  try {
    const scope = ctx.readSettings()[`plugin.${id}`];
    const v = scope?.values;
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function errorRecord(id, reason) {
  return {
    id,
    name: id,
    version: "",
    author: "",
    description: "",
    type: "theme",
    status: "error",
    reason,
    settingsSchema: [],
    _cssText: null
  };
}

/** 目录防逃逸（§4.2）：realpath 前缀核对，拒绝符号链接把读取面引出 plugins 目录 */
function safePluginDir(id) {
  if (typeof id !== "string" || !core.PLUGIN_ID_RE.test(id) || id.endsWith("-")) return null;
  const root = pluginsRoot();
  let dir;
  try {
    dir = fs.realpathSync(path.join(root, id));
  } catch {
    return null;
  }
  let rootReal;
  try {
    rootReal = fs.realpathSync(root);
  } catch {
    return null;
  }
  return dir.startsWith(rootReal + path.sep) ? dir : null;
}

/** 读取并校验单个插件文件夹 → 记录（清单 → minAppVersion 兼容面 → data.json → styles.css 校验+审计） */
function loadRecord(dir, folderName) {
  let manifestText;
  try {
    manifestText = fs.readFileSync(path.join(dir, "plugin.json"), "utf-8");
  } catch (err) {
    return errorRecord(folderName, err && err.code === "ENOENT" ? "缺少 plugin.json" : `plugin.json 不可读：${(err && err.message) || err}`);
  }
  const mv = core.validateManifest(manifestText, folderName);
  if (!mv.ok) return errorRecord(folderName, mv.reason);
  const manifest = mv.manifest;

  // versions.json 本期 = 兼容性声明校验面（§3.2）：minAppVersion > 当前应用版本 → 拒载 + 最近兼容版本提示
  const cmp = core.compareSemver(app.getVersion(), manifest.minAppVersion);
  if (cmp === null) return errorRecord(folderName, `minAppVersion「${manifest.minAppVersion}」不是合法 semver`);
  if (cmp < 0) {
    let hint = "";
    try {
      const rule = core.readVersionsRule(fs.readFileSync(path.join(dir, "versions.json"), "utf-8"));
      const latest = core.latestCompatibleVersion(rule, app.getVersion());
      if (latest) hint = `；versions.json 记录的最近兼容版本为 ${latest}，但本机仅保留一份插件文件，无法回落`;
    } catch {
      /* versions.json 不存在或损坏 → 无提示（合法，§3.2 第 1/2 条） */
    }
    return errorRecord(folderName, `需要应用 ≥ ${manifest.minAppVersion}（当前 ${app.getVersion()}）${hint}`);
  }

  // data.json：可选；存在但非法 JSON → 校验失败（§3.3——防坏文件在将来 API 开放时才炸）；内容本期不解析不消费
  try {
    const dataText = fs.readFileSync(path.join(dir, "data.json"), "utf-8");
    try {
      JSON.parse(dataText);
    } catch (err) {
      return errorRecord(folderName, `data.json 不是合法 JSON：${(err && err.message) || err}`);
    }
  } catch (err) {
    if (!err || err.code !== "ENOENT") return errorRecord(folderName, `data.json 不可读：${(err && err.message) || err}`);
  }

  // styles.css：type:theme 必填；读取 → @settings 解析 → fail-closed 校验 + 对比度审计（任一失败拒载）
  let cssText;
  try {
    cssText = fs.readFileSync(path.join(dir, manifest.styles), "utf-8");
  } catch (err) {
    return errorRecord(
      folderName,
      `styles.css（${manifest.styles}）${err && err.code === "ENOENT" ? "不存在" : `不可读：${(err && err.message) || err}`}`
    );
  }
  const ps = core.parseSettingsBlock(cssText);
  if (!ps.ok) return errorRecord(folderName, ps.reason);
  const va = core.validateAndAuditCss(cssText, ps.schema, folderName);
  if (!va.ok) return errorRecord(folderName, va.reason);

  return {
    id: folderName,
    name: manifest.name,
    version: manifest.version,
    author: manifest.author,
    description: manifest.description,
    type: "theme",
    status: "ok",
    reason: "",
    settingsSchema: ps.schema,
    _cssText: cssText
  };
}

/** 扫描 plugins 目录 → 记录表（惰性 + 缓存；force=true 重新扫描） */
function listRecords(force) {
  if (cache && !force) return cache;
  const next = new Map();
  cache = next;
  let entries;
  try {
    entries = fs.readdirSync(pluginsRoot(), { withFileTypes: true });
  } catch {
    return next; // 目录不存在 = 空列表（不自动创建；仅 plugins:openFolder 时 mkdir，§4.2）
  }
  for (const ent of entries) {
    const folderName = ent.name;
    try {
      if (!ent.isDirectory()) continue; // 只取一层目录项（§4.2 防路径逃逸）
      if (!core.PLUGIN_ID_RE.test(folderName) || folderName.endsWith("-")) continue; // 非 id 形态的目录不是插件
      const dir = safePluginDir(folderName);
      if (!dir) {
        next.set(folderName, errorRecord(folderName, "插件目录不可达或符号链接指向 plugins 之外（拒绝）"));
        continue;
      }
      next.set(folderName, loadRecord(dir, folderName));
    } catch (err) {
      next.set(folderName, errorRecord(folderName, `扫描失败：${(err && err.message) || err}`));
    }
  }
  return next;
}

function broadcastChanged() {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) {
      try {
        w.webContents.send("plugins:changed");
      } catch {
        /* 单窗广播失败不拖累其余窗口 */
      }
    }
  }
}

/** 停用：清 app.activeThemePlugin（皮肤槽不动——插件停用后内置皮肤按其自身槽位生效） */
function deactivate() {
  const all = ctx.readSettings();
  all.app = { ...(all.app || {}), activeThemePlugin: "" };
  ctx.writeSettings(all);
  broadcastChanged();
}

function registerIpc() {
  // 渲染 → 主：列表（不含 css；active 与 settingsSchema 随行）
  ipcMain.handle("plugins:list", () => {
    const records = listRecords(false);
    const active = activeIdOf();
    return [...records.values()].map((r) => ({
      id: r.id,
      name: r.name,
      version: r.version,
      author: r.author,
      description: r.description,
      type: r.type,
      status: r.status,
      reason: r.status === "error" ? r.reason : undefined,
      active: r.status === "ok" && r.id === active,
      settingsSchema: r.settingsSchema
    }));
  });

  // 渲染 → 主：当前激活载荷 {id, css, vars}（css 与装配好的 --pl-* 变量一次下发）或 null
  // C-24：注册已提前到模块加载期（见文件头 activeHandlerGate）——渲染层首帧早于 init 到达时
  // 由闸挂起，ctx 就绪后经 getActivePayload() 放行。

  // 渲染 → 主：激活（空串 = 停用）→ {ok, reason?}
  ipcMain.handle("plugins:setActive", (_e, id) => {
    if (typeof id !== "string") throw new Error("plugins:setActive 参数必须是字符串（空串=停用）");
    if (id === "") {
      deactivate();
      return { ok: true };
    }
    // 激活时重读并重新校验（缓存失效——防目录内容在激活间隙被替换，§4.3）
    const dir = safePluginDir(id);
    if (!dir) return { ok: false, reason: `插件「${id}」不存在或目录不合法` };
    let rec;
    try {
      rec = loadRecord(dir, id);
    } catch (err) {
      return { ok: false, reason: `插件校验失败：${(err && err.message) || err}` };
    }
    if (rec.status !== "ok") return { ok: false, reason: rec.reason };
    // 双槽互斥写入（§7.3）：激活一方清另一方——nextAppearanceState 纯函数单测锁定
    const all = ctx.readSettings();
    const next = core.nextAppearanceState(
      { skinId: all.app?.skinId, activeThemePlugin: all.app?.activeThemePlugin },
      { type: "activate-plugin", id }
    );
    all.app = { ...(all.app || {}), skinId: next.skinId, activeThemePlugin: next.activeThemePlugin };
    ctx.writeSettings(all);
    listRecords(false).set(id, rec); // 已重验记录回填缓存（P2-a：cache 可能为 null——本会话从未扫描时先惰性扫描建缓存，防 TypeError）
    broadcastChanged();
    return { ok: true };
  });

  // 渲染 → 主：打开插件文件夹（唯一允许的 mkdir 点，§4.2/§4.6）
  ipcMain.handle("plugins:openFolder", () => {
    const root = pluginsRoot();
    fs.mkdirSync(root, { recursive: true });
    return shell.openPath(root).then((msg) => msg === "");
  });

  // 渲染 → 主：重新扫描（§2.2 第 6 条：无 fs.watch 热重载，变更以重新扫描 + 设置页打开自动扫描触发）
  ipcMain.handle("plugins:rescan", () => {
    listRecords(true);
    const id = activeIdOf();
    if (id) {
      const rec = cache.get(id);
      if (!rec || rec.status !== "ok") deactivate(); // 激活中的插件已消失/失效 → 自动失效并广播
    }
    broadcastChanged();
    return true;
  });
}

/** 挂接（main.js 启动后调用；只注入 settings.json 读写入口并注册 IPC，不做任何扫描） */
function init(options) {
  ctx = {
    readSettings: options.readSettings,
    writeSettings: options.writeSettings
  };
  registerIpc();
  _resolveActiveGate(); // C-24：放行提前注册的 plugins:getActive（见文件头闸注释）
}

module.exports = { init };
