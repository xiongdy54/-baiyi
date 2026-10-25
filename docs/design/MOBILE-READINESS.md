# MOBILE-READINESS · 移动端移植准备（C-40，只准备、不移植）

> 状态：**准备完成（闸门就绪），移植未开始**。
> 依据：审计报告 C-40（业务核心与 Node/Electron 解耦，P2）；**决策 D-05 = A Capacitor**（2026-10-25 用户拍板：复用现有 Web 前端，存储换 SQLite 插件或 Worker 内 WASM+OPFS；**时机在桌面首发之后，iPad 优先**）。
> 前置：U-15（真机可行性矩阵）**未做**——本表中标注「待 U-15」的条目在真机实测前不得视为已定案。

## 0. 解耦现状（C-40a…C-40d 落地的事实）

1. **数据目录可注入**（C-40a）：`electron/db.js` 的 `initDb(opts)` 接受 `opts.dataDir`（不传回落 Electron userData，桌面行为零变化）；`settingsStore.configure({ dataDir })` 由 `initDb` 联动；`dictDb.js` / `learnerDb.js` 各自导出 `configure({ dataDir })`，未注入时桌面态惰性回落 Electron userData。
   **桌面态注入点清单**（回归时对照）：
   - `db.js`：`initDb` 第一行 `DATA_DIR = opts.dataDir || require("electron").app.getPath("userData")`；文件内其余 10 处原 `app.getPath("userData")` 全部改读 `dataDir()`；`rg -n "\bapp\.getPath" electron/db.js` 只应剩 initDb 回退 1 处。
   - `settingsStore.js`：`file()` 惰性解析 + `configure` 注入 + `SETTINGS_FILE` 兼容 getter 导出（main.js 解构处即首次读取，仍晚于 pinUserData）。
   - `dictDb.js` / `learnerDb.js`：`open()` 内 `dataDir()` 惰性解析（首次即定格）+ `configure` 注入。
   - `main.js`：唯一调用处 `await initDb({ dataDir: app.getPath("userData") })`。
2. **纯净核心闸门**（C-40b）：`tests/core-purity.test.cjs` 对 CORE 27 模块（23 无 I/O + 4 只依赖 crypto）逐文件扫描 require——禁 I/O/平台依赖、相对依赖闭包不越界、第三方仅 opencc-js/ts-fsrs、crypto 使用面恰等 `NEEDS_CRYPTO_SHIM`。核心被污染即红。
3. **业务层可脱离 Electron 运行**（C-40a 证明）：`tests/core-datadir.test.cjs` 在 `ELECTRON_RUN_AS_NODE` 下（拿不到 `app`）完成 `initDb({dataDir})` → `createFromPaste` → `closeDb` → `library.db` 二连接可查。
4. **接口契约机器可读**（C-40c）：`docs/ipc-contract.json`（`scripts/gen-ipc-contract.mjs` 从 `preload.js` 生成）= **33 桥 / 285 方法**（invoke 253 / send 11 / on 21），逐字节闸门 `tests/ipc-contract.test.cjs`。移动端要实现的就是这份清单的同名桥对象与同名方法（在 Capacitor 里以 TS service / Capacitor 插件桥对应实现）。

## 1. 模块分类与移动端替代物（D-05 = A Capacitor 口径）

覆盖 `electron/` 下全部 `.js` 模块（`.html` / 图标 / `*.bundle.cjs` 跟随其宿主归类）。

| 类别 | 模块 | 移动端（Capacitor） |
|---|---|---|
| 纯核心（无 I/O） | annotationRange、fsrsTime、growth、journalTime、kpScopes、legacyBackfill、lmLevels、lmLex、lmParams、lmText、lmStrings、memoryRetrieve、mindmapBlocks、mindmapCore、mindmapOutline、mindmapScheduler、mindmapEngineV2、mindmapV2Prompts、pluginCore、prompts、statsTimeline、udc、aiNextExtract（C-40b 闸门内） | **原样复用**（打进前端 bundle） |
| 核心 + crypto | fsrsConfig、kpNorm、mindmapV2Core、lmRecommend（`NEEDS_CRYPTO_SHIM`） | 换成**同步纯 JS 哈希**（WebCrypto digest 是异步的，不能直接替） |
| 纯数据表登记（闸门外观察项） | settingsLayers（DEVICE_KEYS）、syncTables（SYNC/APPEND/LOCAL 表清单）、bookassetPath（仅依赖 node `path`） | 原样复用；`path` 依赖换轻量 polyfill 或改为纯字符串实现；三者未列入报告 CORE 清单，后续可并入 C-40b 闸门 |
| 存储驱动 | db.js、dictDb.js、learnerDb.js、sqliteCompat.js、schemaVersion.js、syncTriggers.js | **换驱动，二选一（待 U-15 实测定）**：① Capacitor SQLite 插件（如 `@capacitor-community/sqlite`）——原生 SQLite，但 API 异步，须评估同步调用面的改造面；② Worker 内 SQLite WASM + OPFS——可保持同步语义（AtomicsWait），待真机验证性能与 OPFS 配额。schemaVersion 的迁移前快照、syncTriggers 的幂等重建逻辑随驱动走 |
| 文件 | settingsStore、jsonFile、memoryStore、memoryTidy、appLog、i18n、dictStore、userData、deviceId、zipRead、backup、backup-build-worker、backup-meta-worker、importers、ankiExport | 平台文件 API（**Capacitor Filesystem**）。jszip / mammoth / turndown / sql.js / yazl / yauzl / markdown-it 均为纯 JS/WASM 可复用；`worker_threads`（backup 两 worker）在 WebView 不存在——改 Web Worker 重封装或主线程直跑（待 U-15 测大库备份耗时）；`userData` 的旧目录迁移逻辑移动端不需要（仅保留纯函数解析面）；`deviceId` 改本地生成或 Capacitor Device 插件；`dictStore` 的 `sql.js`/`zlib` 为纯 JS/WASM 可复用，`readline` 导入解析需重写 |
| 网络 | ai.js、aiTransport.js（Electron `net` 封装） | 改用 **fetch**（流式读取 `response.body`，C-19 的 SSE 解析层与传输层已分离，只换传输层） |
| 安全存储 | keyVault.js（Electron `safeStorage`） | Capacitor 安全存储插件（Keychain / Keystore）——API 异步化对 C-20「会话内存」语义的影响待 U-15 |
| 原生计算 | optimizer.js（fsrs-rs-nodejs：有 android-arm64/arm-eabi 预编译、**无 iOS**） | 移动端**先不提供参数优化**；或用 fsrs-rs 的 WASM 构建（待 U-15） |
| 编排 / 派生管线 | learnerRefresh.js、mindmapEngine.js（v1，依赖 ./ai + crypto） | 注入数据目录与 fetch 化的 ai 后可复用；随存储驱动联调（待 U-15） |
| 桌面专属（不移植） | main.js、preload.js、preload-capture.js、captureOverlayPreload.js、captureOverlay.html、lensWindow.js、workbenchWindow.js、quickCapture.js、screenCapture.js、tray.js、updater.js、pluginHost.js、appMenu.js、closeToTray.js、permissions.js（Electron session 权限处理器） | 不移植；对应功能在移动端以页面内面板实现或不提供（lens 透明窗口/截屏/托盘/全局快捷键/自动更新均为桌面专属能力） |

## 2. U-15 真机可行性矩阵（未做，移植前必须补）

1. 存储驱动二选一定案：SQLite 插件（异步改造面）vs Worker WASM + OPFS（同步语义、性能/配额）——在 10 万卡规模库上实测（对照附录 A 基准口径）。
2. OPFS 配额与持久化（浏览器逐出策略）在 iOS WKWebView 的真实行为。
3. `worker_threads` 备份管线的 Web Worker 替代耗时（大库 ZIP64）。
4. keyVault 的 Keychain/Keystore 插件选型与 C-20 会话语义兼容性。
5. fsrs-rs WASM 构建的体积与耗时（决定移动端是否提供参数优化）。

## 3. 非目标

- 移植本身（D-05=A 的实施）——**桌面首发之后**才开始，iPad 优先。
- 渲染层适配（触控、安全区、窗口尺寸）——属移植实施项，不在 C-40 范围。
- 云同步（C-38 只做预留；同步传输协议另立项）。
