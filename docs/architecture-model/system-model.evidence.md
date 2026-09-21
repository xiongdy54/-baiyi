# system-model · 证据索引

| 项 | 值 |
| --- | --- |
| 模型 | `system-model.structurizr.dsl`（事实源） |
| 状态 | current-state only |
| 生成 | 2026-09-21，commit `780ea84`，分支 `docs/architecture-model-v48.14` |
| 方法 | `architecture-visualization:system-modeler` + `c4model`；证据采集为直接读码 + grep 计数，行号经人工复核 |
| 规模 | 53 个元素，76 条关系，5 个视图 |
| 置信度定义 | high = 直接代码/配置证据；medium = 多个局部信号一致；low = 仅由命名/目录推断；unknown = 显式未知 |

DSL 约定：**容器/组件的 technology 槽承载源码位置**（如 `electron/db.js (4650)`），标签槽承载语义 tag。这样图本身可回溯到文件，代价是 technology 字段不再是纯技术栈名。

---

## 1. 结构性事实（计数类，可复算）

| 断言 | 值 | 复算方式 | 置信度 |
| --- | --- | --- | --- |
| `ipcMain.handle` 通道数 | 159 | `grep -rc "ipcMain.handle(" electron/` | high |
| 通道前缀分组 | 24（library 27 / knowledge 20 / cards 16 / mindmap 13 / memory 10 / journal 10 / dict 10 / insights 8 / backup 7 / optimizer 5 / ai 5 / meaning 4 / extracts 4 …） | `grep -oE 'ipcMain\.handle\("[a-z]+:' \| sort \| uniq -c` | high |
| `contextBridge.exposeInMainWorld` 命名空间 | 23 | `grep -n "exposeInMainWorld" electron/preload.js` | high |
| `library.db` 表数 | **27** | `grep -o "CREATE TABLE IF NOT EXISTS [a-z_]*" electron/db.js \| sort -u \| wc -l` | high |
| `dictionary.db` 表数 | 1（`dict_entries`） | `electron/dictDb.js:23` | high |
| `persist()` 调用点 | 64，**全部在 `electron/db.js` 内** | `grep -rn "persist()" electron/*.js` → db.js 64 / dictDb.js 1 | high |
| 渲染层直接触达 Node/IPC | **0** | `grep` src/ 的 `require(`、`node:`、`ipcRenderer`、`readFileSync` → 无命中 | high |
| 直接 import `vendor/foliate-js` | **1 处**（防腐层内） | `src/lib/reader/foliate/adapter.ts:10` | high |
| 运行时 import `ts-fsrs` | **1 个文件** | `src/lib/fsrs.ts:14` | high |
| 测试文件 | 60（`tests/*.cjs|mjs`），`package.json` 无 `test` 脚本 | `ls tests/*.cjs \| wc -l`；`package.json:6-13` | high |
| Graphviz | 不在 PATH | `command -v dot` | high |

### 1.1 主进程 `require` 扇入（用来定位耦合，非依赖全貌）

| 模块 | 扇入 | 被谁 require |
| --- | --- | --- |
| `db.js` | 1 | main.js |
| `ai.js` | **2** | main.js、mindmapEngine.js |
| `fsrsConfig.js` | **2** | db.js、optimizer.js |
| `fsrsTime.js` | **2** | db.js、optimizer.js |
| `journalTime.js` | **2** | db.js、main.js |
| `memoryStore.js` | **2** | main.js、memoryTidy.js |
| `prompts.js` | 1 | **db.js**（不是 main.js） |
| `kpNorm.js` | 1 | db.js |
| `settingsStore.js` | 1 | db.js |
| `udc.js` | 1 | db.js |
| `mindmapCore.js` | 1 | mindmapEngine.js |
| `kpScopes.js` | **0** | ——（生产侧零命中；消费方见 §2.5） |
| 其余（dictStore/dictDb/importers/backup/quickCapture/optimizer/mindmapEngine/memoryTidy/memoryRetrieve/importers） | 1 | main.js |

**读法**：`db.js` 是唯一被注入方（其余模块多数由它或由 main.js 拉起），所以"改 db.js 会牵全身"这句直觉在 require 图上并不成立 —— 成立的是**反向**：`db.js` 汇聚了 prompts / kpNorm / settingsStore / udc / fsrsConfig / fsrsTime / journalTime 七个叶子模块，它是**依赖的汇聚点**而非被依赖点。另一层含义：`ai.js` 有第二个调用方（导图引擎），所以"唯一 LLM 出口"成立在模块层，不成立在单一入口文件层。


---

## 2. 节点证据

### 2.1 参与者与外部系统

| id | 类型 | 置信度 | sourceRefs |
| --- | --- | --- | --- |
| `learner` | actor | high | 单机桌面应用；`electron/main.js:1218` 单窗口创建；无登录/无鉴权代码路径 |
| `aiGateway` | external system | high | 预设端点 `electron/ai.js:14`（commandcode.ai）、`:22`（bigmodel.cn）、`:38`（`http://localhost:11434/v1` Ollama）、`:30`（自定义，空 baseUrl）；请求 URL 拼接 `electron/ai.js:240`；SSE 解析 `:309`；凭据 `safeStorage` 加解密 `:82-86`；配置落盘 `:55` |
| `webSearch` | external system | high | `SEARCH_ENGINES` `electron/main.js:565`（Bing `:567` / DuckDuckGo `:580` / Baidu `:593`）；抓取 `:623-660`；UA 伪装 `:628-631` |
| `dictSources` | external system | high | `ipcMain.handle("dict:download")` `electron/main.js:808`；url+mirrorUrl 双源 `:817-821`；落 `userData/dicts/<id>/` `:826` |
| `syncUnknown` | **unknown** | unknown | 见 §4 |
| `telemetryUnknown` | **unknown** | unknown | 见 §4 |

### 2.2 容器

| id | 置信度 | sourceRefs |
| --- | --- | --- |
| `mainProc` | high | `package.json:5` `"main": "electron/main.js"`；`electron: ^31.0.0` `package.json:42`；`nodeIntegration:false / contextIsolation:true` `electron/main.js:1225-1226` |
| `renderer` | high | `vite.config.ts:14-17` 双入口；`index.html:11` → `src/main.tsx`；`react ^18.3.1` `package.json:26`；`vite ^6.0.0` `:45`；载入 `electron/main.js:1252`（prod）/`:1254`（dev localhost:5173） |
| `captureWin` | high | `vite.config.ts:15-16` capture 入口；`capture.html:11` → `src/capture.tsx`；`new BrowserWindow` `electron/quickCapture.js:210`；preload `:225`；载入 `:252`/`:256` |
| `libDb` | high | `electron/db.js:205-206` `initSqlJs()`；路径 `:207`；`sql.js ^1.14.2` `package.json:31`；「内存库 + 全量落盘」自述 `electron/db.js:1` |
| `dictDb` | high | `electron/dictDb.js:1`（独立文件、与主库完全隔离的理由）；`:16-18`；VACUUM 退化 `:112` |
| `userFiles` | high | `SETTINGS_FILE` `electron/main.js:98`；`assets/` `electron/db.js:874,946,1003`；`memory/` `electron/memoryStore.js:10,41-43`；`backups/` `electron/backup.js:54`；`restore-staging` `:36-37`；`dicts/` `electron/main.js:826` |

### 2.3 主进程组件（全部 `require` 进 `main.js`，父边界已证实 → 组件视图合法）

| id | 置信度 | sourceRefs |
| --- | --- | --- |
| `ipcRegistry` | high | `electron/main.js:1`（ipcMain 导入）、159 处 handle、`:22` 窗口回取 |
| `windowCtl` | high | `electron/main.js:136`（minimize）`:140`（fromWebContents）`:147`（close）；文件对话框 `:166-266`；备份 zip 过滤器 `:540` |
| `assetProto` | high | `protocol.registerSchemesAsPrivileged` `electron/main.js:91-96`（bookasset `:92`、pdfres `:95`，注释说明 `file://` 页内 fetch 被 Chromium 拦截的动因）；`protocol.handle("bookasset")` `:1267`（文件名白名单正则 `:1272`）；`protocol.handle("pdfres")` `:1297-1315`；提前注册的理由注释 `:1265-1266` |
| `websearchSvc` | high | `electron/main.js:565-660` |
| `dbRepo` | high | `electron/db.js`（4650 行）；`SCHEMA` `:57`；27 表 `:58-658`；`persist()` `:682-693`（tmp → fsync → rename）；`persistNow()` `:697-700`；仓储导出 `:4502+` |
| `dictRepo` | high | `electron/dictDb.js`、`electron/dictStore.js`（496）；ECDICT 340 万行释义截断 `dictStore.js:184` |
| `aiClient` | high | `electron/ai.js`（464）：PRESETS `:12-45`、配置读写 `:55-140`、`supportsReasoningEffort` `:49`、流式 `:240,309`、模型列表 `:442` |
| `promptLib` | high | `electron/prompts.js`（1016）；`prompt_templates` 播种 `electron/db.js:165,676`（`ensurePromptTemplates`） |
| `mindEngine` | high | `electron/mindmapEngine.js`（3133）：`require("./mindmapCore")` `:13`、`getAIConfig()` `:101,120`、阶段常量 `:15-38`、导出 preview/generate/deepen/repairConfirm/cancelRun `:3117-3131` |
| `mindCore` | high | `electron/mindmapCore.js`（1094）纯函数导出 `:1057-1087`、`LINEARIZATION_VERSION` `:339`；消费方仅 `mindmapEngine.js:13` 与 `tests/m15r.core.test.cjs` |
| `fsrsOpt` | high | `electron/optimizer.js:4` `require("fsrs-rs-nodejs")`；`package.json:19` |
| `fsrsSem` | high | `electron/fsrsConfig.js:2-11`（权重须与 ts-fsrs 5.4.2 逐位一致，S7 断言持续校验）；`electron/fsrsTime.js:2-5`（复刻 ts-fsrs 时间语义、**绝不 import ts-fsrs**、L6-A 红灯 = 时间语义变更触发重新审计） |
| `kpNorm` | high | `electron/kpNorm.js`；**生产已接线**：`electron/db.js:43` 解构引入 `normalizeKpLabel, kpClusterKeyFor, kpProposalFingerprint, isOpaqueClusterId` —— 落在写路径上 |
| `kpScopes` | high（且**生产未接线**） | `electron/kpScopes.js`（414）导出封闭契约 `:400-412`（`KP_RELATION_TYPES`/`PROBE_DIMENSIONS`/`CHALLENGE_GRADES`/`UDC_CODES`/`parseJsonLoose`/四个 `validate*Output`/`scopeDispersion`）。**`require("./kpScopes")` 在 `electron/` 内零命中**；引用它的只有：注释（`db.js:1709` 自述「本批只定契约」、`prompts.js:563`、`mindmapCore.js:2`）+ `tests/k2b.test.cjs:24` + 提示词测试台（经 esbuild 产物）。图上标 `ContractOnly` |
| `memStore` | high | `electron/memoryStore.js:10`（`MEMORY_DIR_NAME`）`:41-43`；`memoryTidy.js`、`memoryRetrieve.js`；IPC 消费 `electron/main.js:1066,1074,1080` |
| `importSvc` | high | `electron/importers.js`（385）；`main.js:89` require；扩展名白名单 `:183-185,264-266` |
| `backupSvc` | high | `electron/backup.js:4`（重启 `applyPendingRestore` 换入、运行期禁止直接换库文件的理由，引 §7.1.8）；`:271`（staging 解包）；zip 成员 `:31-35,112`；`main.js:1318` 调用点 |
| `capSvc` | high | `electron/quickCapture.js:1-11`（四项职责自述）`:17-20`（快捷键与节流常量，注明是逐次 fsync 的唯一例外）`:210-272`（窗口/定位/blur 即隐）`:275-306`（等 renderer ready 防白闪）`:310-316`（广播） |
| `settingsKv` | **medium → Inferred** | `electron/main.js:98-119`（内联实现）**与** `electron/settingsStore.js:6-21`（第二份实现，被 `electron/db.js:44` require）。两份并存且职责重叠 → 图上标 `Inferred`（虚线橙边 `dbRepo -> settingsKv`），需要人工确认哪个是 intended 单一真源 |
| `journalT` | high | `electron/journalTime.js` |
| `udcSvc` | high | `electron/udc.js:1-2`（自述「同源复制」） |

### 2.4 渲染层组件

| id | 置信度 | sourceRefs |
| --- | --- | --- |
| `preload` | high | `electron/preload.js`（309）：23 处 `exposeInMainWorld`，行号 `:3,8,16,52,59,82,86,90,96,101,106,112,118,127,141,161,172,187,206,220,246,267,287` |
| `appShell` | high | `src/App.tsx:33` `type View` 判别联合；`:67` `useState<View>({name:"shelf"})`；`:328-412` if/else 切换；`src/main.tsx:6-39` `RootErrorBoundary`、`:42-48` 挂载 |
| `domainCli` | high | `src/lib/*.ts` 逐个转调 `window.*API`（见 §3 边证据） |
| `bus` | high | `src/lib/eventbus.ts:8` `ALLOWED_EVENTS`（版本追加注释 `:6-7`）`:33` 模块级 Map、`:34-47` on/emit；`grep eventBus electron/` 无命中 → 不跨进程 |
| `readerKernel` | high | `src/lib/reader/kernel.ts:3`（禁止直接 import foliate-js，唯一豁免目录声明）；`src/lib/reader/service.ts:3`（动态 import 惰性加载）`:20-21` |
| `foliateAcl` | high | `src/lib/reader/foliate/adapter.ts:1-2`（ACL 自述）`:10` `import "../../../../vendor/foliate-js/view.js"` —— 全仓唯一命中；`appearance.ts`、`selection.ts`、`version.ts`、`vendor.d.ts`；`version.ts:3` 记 MANIFEST commit `78914aef…` |
| `vendored` | high | `vendor/foliate-js/`（epub/mobi/fb2/fixed-layout/footnotes/opds/overlayer/paginator/progress/dict/comic-book + LICENSE/MANIFEST.json） |
| `pdfAcl` | high | `src/lib/reader/pdf/adapter.ts:27` `import { PDF_ENGINE_VERSION } from "../foliate/version"` |
| `fsrsCli` | high | `src/lib/fsrs.ts:14` `from "ts-fsrs"`（运行时全仓唯一）；`:89` fsrsJson ↔ Card 全字段往返 |
| `mindUi` | high | `src/components/MindmapWorkspace.tsx:8-11` 导入 `buildMapSvg`/`layoutMap`/`../lib/mindmap`/`eventBus`，`:202` 订阅、`:465` 布局、`:470,662` 出图；`src/lib/mindmap/layout.ts`（纯，无 import）`:71`、`render.ts:40`；由 `src/components/Reader.tsx:13` 引入、`:1879` 挂载 |
| `importHtml` | high | `src/lib/htmlImport.ts`（DOMParser + Readability + DOMPurify + turndown）、`src/lib/epub.ts:69-70`（经 `window.libraryAPI` 回传）、`importRouter.ts` |
| `theme` | high | `src/skins/index.ts:11-13` 注册表**当前仅 `none`**、`:14-17` `getSkin` 回落；`src/theme.css:7` `:root`、`:93,168` `body.theme-dark`、`:436-444` `.skin-layer`；`src/lib/accentVar.ts:36-45`（深色档声明在 body 上会胜过 :root 继承 → 必须写 body 的完整理由）、`:48` 起 `for (const el of [document.body, document.documentElement])`；`src/App.tsx:101-104` 主题类、`:151-161` 皮肤挂载 |
| `uiViews` | high | `src/components/**`（Reader 2665 / SettingsPanel 1916 / CardBrowser 954 / KnowledgeManager 728 / InsightPanel 528 / ReviewView 517 / QueueView / Bookshelf / dashboard / charts/swiss.tsx 976 / OcclusionShapes / ImageLightbox / DictPanel / JournalView / CaptureEditor / AddBookModal / BackgroundActivity / Dropdown / icons） |
| `capPreload` | high | `electron/preload-capture.js:1-5`（最小权限自述）`:7-9` 只读 `settingsAPI.get`、`:11-25` `captureAPI`（ready/hide/onShown + day/draft/draftSave/discardDraft）；`contextIsolation:true/nodeIntegration:false` `electron/quickCapture.js:238-241` |
| `capEditor` | high | `src/capture.tsx:8-26` 类型声明、`:29-35` 挂载前 `applyCaptureAppearance()`；`src/components/CaptureEditor.tsx:26` 应用强调色 |

### 2.5 提示词测试台（仓库内的第二个可独立运行单元）

| id | 置信度 | sourceRefs |
| --- | --- | --- |
| `promptLab` | high | `prompt-lab/package.json`（`"main": "main.js"`、`private:true`、description 自述"独立最小工具…与主软件隔离，主软件内不做提示词调优试验"）；启动器 `启动提示词测试台.bat` → `npx electron prompt-lab`；`devDependencies.electron ^31.0.0` |
| `labMain` | high | `prompt-lab/main.js`（222）9 个 `lab:*` handle：`:97,112,126,137,151,166,167,184`；窗口 `:199-209`，`contextIsolation:true`/`nodeIntegration:false` `:205-206`；`preload.js`（19） |
| `labUi` | high | `prompt-lab/renderer/app.js`（764）`:8` `window.kpScopesLib`、`:361` 陈旧产物守卫报错文案；`renderer/index.html:103` `<script src="../vendor/kpScopes.js">` |
| `labBundles` | high | `prompt-lab/package.json:9-10` 两条 esbuild 命令：`build:kpscopes` ← `../electron/kpScopes.js --global-name=kpScopesLib`、`build:vendor` ← `../src/lib/cards.ts --global-name=cardsLib`；产物 `prompt-lab/vendor/kpScopes.js`（443，已提交，`:2,:9-10` 可见打包器内联的源路径） |
| 数据隔离 | high | `prompt-lab/main.js:8` 注释"独立 userData(%APPDATA%/prompt-lab)：配置与主软件隔离，Key 须在测试台内单独配置一次"；`:46` `prompts.local.json` 落在自己的 userData。**未检索到任何 `library.db` 引用** → 测试台不读写主库 |
| 代码复用方向 | high | `prompt-lab/main.js:11` `require("../electron/ai")`（getAIConfig/setAIConfig/chatStream）、`:12` `require("../electron/prompts")`、`:15` `require("./prompts-draft")`；`prompts-draft.js:12` 亦 require 主 `prompts.js` |

**建模判断**：测试台建成产品边界**外**的 `DevTooling` 系统，而不是 `app` 的容器 —— 它不随产品发布、有独立 userData、独立 Electron 入口。三条 `require`/esbuild 边标为 `Inferred`（虚线），因为它们是**构建期代码复用**而非运行期调用；若画成实线调用边会误导读者以为主进程在运行时依赖测试台。

**这条发现的来路值得留痕**：初版模型完全遗漏了 `prompt-lab/`，是在追查"`kpScopes.js` 的 require 扇入为 0、难道是死代码"时才暴露的。教训是：**扇入为 0 的生产模块不是"死代码"结论，而是"还有消费方没找到"的信号**。

---


---

## 3. 关键关系证据

### 3.1 跨进程面（模型的核心主张）

| 边 | 类型 | 置信度 | sourceRefs |
| --- | --- | --- | --- |
| `renderer -> mainProc` | calls / sync / IPC | high | 23 命名空间 `electron/preload.js:3-287` ↔ 159 handlers `electron/main.js` 等 |
| `captureWin -> mainProc` | calls / sync / IPC | high | `electron/preload-capture.js:7,11`；`electron/quickCapture.js` handlers |
| `mainProc -> renderer` | publishes / async | high | `BrowserWindow.getAllWindows()` 广播惯用法：`fsrs:configChanged` `electron/main.js:446-450`、`insight:changed` `:959-962`、`memory:changed` `:1045-1047`、`mindmap:changed` `:1136-1139` |
| `mainProc -> captureWin` | publishes / async | high | `broadcastJournalChanged` `electron/quickCapture.js:310-316`（含 `excludeWebContents` 防回环）；调用点 `electron/main.js:909,916,923` |
| `renderer -> userFiles` | reads / custom scheme | high | `src/components/Reader.tsx:86` `fetch(src)` 走自定义 scheme（注释 `:81`）；handler `electron/main.js:1267-1315` |
| `mainProc -> {aiGateway,webSearch,dictSources}` | calls / HTTPS | high | `net.fetch` 仅 3 处：`electron/main.js:626`、`:821`、`electron/dictStore.js:12`；`ai.js` 原生 https |

**「渲染层无出网能力」这一主张的支撑**：src/ 内无 `ipcRenderer`/`node:`/`require`，出网调用点全部落在 `electron/`。这是一条**结构性推论（high）**，不是某行注释的直接陈述。

### 3.2 写入归属（谁是唯一作者）

| 数据 | 唯一写入者 | 置信度 | sourceRefs |
| --- | --- | --- | --- |
| `library.db` 全部 27 表 | `dbRepo`（`electron/db.js`） | high | `persist()` 64 处调用全在本文件；`:1494` 注释「业务代码禁止绕过仓储层直接写库（§7.1 sql.js 并发纪律）」 |
| `material_maps/_shards/_runs/_calls` | `mindEngine` 经 `dbRepo` 访问器 | high | 建表 `electron/db.js:551,578,604,641`；访问器 `db.js:3970,4025,4038,4046,4062,4125,4240,4361,4451`；写入调用 `mindmapEngine.js:739,859,874,923,934,1062,1529,1591,1602,1665,1737,1789,1983,3040-3054`；`main.js` 侧仅读（`:1155,1157,1160-1163`）+ 启动期 reconcile `:1350` |
| `journal_entries` | `dbRepo` ← `capSvc` | high | 建表 `db.js:358`；`quickCapture.js` 经 `ctx.db` 写；广播 `main.js:909-923` |
| `dictionary.db` | `dictRepo` | high | `electron/dictDb.js:18,23`；隔离理由 `:1-3` |
| `userData/memory/` | `memStore` | high | `memoryStore.js:10,41-43`；指南称其为「首个非 DB 用户数据真源」 |
| `fsrs_configs`（不可变快照） | `fsrsOpt` 产新行 / `dbRepo` 落库 | high | 建表 `db.js:192`；`optimizer.js:4`；权重一致性由 S7 断言持续校验 `fsrsConfig.js:2-3` |
| `settings.json` | `settingsKv` | **medium** | 双实现并存（`main.js:98-119` 与 `electron/settingsStore.js:6-21`）。图上以 `Inferred` 虚线标注，见 §4-V3 |

### 3.3 双实现 / 手工复刻关系（本模型最需要显式化的一类）

`ts-fsrs` 在**渲染进程**跑调度（`src/lib/fsrs.ts:14`），`fsrs-rs-nodejs` 在**主进程**跑参数优化（`electron/optimizer.js:4`），而 `electron/fsrsTime.js` 是第三份实现——对 ts-fsrs 时间语义的**手工复刻**，其注释明确「本文件独立实现、绝不 import ts-fsrs（§4.4.11 边界）」并规定 L6-A 红灯触发重新审计。这三者构成一个由契约而非调用图维持的一致性簇。模型把它建成 `fsrsSem` 单节点 + `fsrsCli`/`fsrsOpt` 两条读取边，而不是三个互调模块，因为**它们之间没有代码依赖，只有版本锁定不变量**。这是一次建模判断，已在图注与本文档中留痕。

---

## 4. 未知项与待验证任务

| id | 断言 | 现状 | 验证任务 |
| --- | --- | --- | --- |
| **V1** | 多用户 / 云同步 | `users` 表存在（`electron/db.js:58`）且**只播种一行**：`:238` `INSERT OR IGNORE INTO users (id,name,created_at) VALUES ('local-user','本地用户',?)`。17 张表带 `user_id TEXT NOT NULL`，另有 `sync_version`、`is_deleted`。未发现任何同步、鉴权、多用户切换或并发写入调用方。 | 确认 `sync_version`/`user_id` 是「为未来预留」还是「已有隐含语义」。在证实前，**不得在图中把 `user_id` 画成租户/权限边界**。 |
| **V2** | 用量遥测 / 错误上报 | `docs/SPEC-usage-telemetry.md:44-146` 规格了 `ai_usage` 表与 `electron/telemetry.js`；仓库中无 `electron/telemetry.js`，27 表中无 `ai_usage`。该 spec `:4` 还禁止编辑指南。指南另一处称其未实现。 | 判定该 spec 是作废、待实现、还是已被别的功能吸收；作废则归档，避免与指南争权威。 |
| **V3** | `settings.json` 单一真源 | 两份实现并存（见 §3.2）。 | 确认 `electron/settingsStore.js` 与 `main.js:98-119` 的写入是否同文件同结构；若并发写同一 JSON，存在互相覆盖风险 —— 需要实测，本模型不下结论。 |
| **V4** | 表数文档口径 | 实测 **27**。`AI_DEVELOPMENT_GUIDE.md:56` 称 17、`:90` 称 23 —— 文档自身两处已互相矛盾且都过期。 | 以代码为准 bump 文档。 |
| **V5 | `mindmapCore.d.ts` 宣称渲染层可用 | `electron/mindmapCore.d.ts:1` 注释称「渲染层导入用 …单一真源」，但 `grep mindmapCore src/` **零命中**；渲染层的对应实现是 `src/lib/mindmap.ts:210` `buildStructureCardPackage`。 | 确认这是「计划中未接线」还是「文档陈旧」。当前建模为 main-only 叶子。 |
| **V6** | 皮肤系统 | `src/skins/index.ts:11-13` 注册表只剩 `none`（玻璃拟态皮肤已在 `c3fd637` 删除），而 `body.has-skin` 与 `.skin-layer`（`src/theme.css:436-444`）仍在。 | 确认皮肤机制是保留扩展点还是待清理死路径。 |
| **V7** | 测试执行入口 | 60 个测试文件，`package.json:6-13` 无 `test` 脚本。 | 确认统一入口是否在指南 §7.3 以逐文件命令形式存在（是）；若要 CI 化需要新增脚本 —— 属 `evolution-planner` 议题，本模型仅记录现状。 |
| **V8** | `kpScopes` 的"未接线"是否是有意的分阶段交付 | `db.js:1709` 注释「首版 v1——消费引擎分属 K3/K4-K5/K9，本批只定契约」指向**有意先定契约**；`mindmapCore.js:2` 又声称三方共用"单一真源、禁止复制"，而实际共用方是测试台与测试，不是主进程。 | 确认 K3/K4-K5 批次是否已把 `validate*Output` 接进主进程裁决路径。当前只能断言"契约存在且生产写路径未使用它"，不能断言"契约作废"。 |
| **V9** | `prompt-lab/vendor/kpScopes.js` 与源文件的漂移 | 产物已提交（443 行，内含 `../electron/kpScopes.js` 路径），更新靠手跑 `npm run build:kpscopes`；`renderer/app.js:361` 只在**产物缺失**时报错，**内容陈旧时无守卫**。 | 属同类问题：`tests/tmp-m7` 也是必需的 esbuild 产物。确认是否需要一条"产物是否落后于源"的检查 —— 本模型只记录漂移窗口的存在。 |

---

## 5. 与既有 `docs/diagrams/` 的关系

实地核验（零 `<script>`、无 `data/` 目录、无 archviz 管线，`viewBox="0 0 1360 …"` 写死坐标）后确认：五张图是**手绘内联 SVG 静态交付物**，不是数据驱动产物。

| 既有图 | 与本模型的关系 |
| --- | --- |
| `01-整体架构` | 同一问题（进程边界 + 单一写入口）。本模型补上它缺的：捕捉窗最小权限 preload、`bookasset:`/`pdfres:` 两条自定义 scheme、`dictionary.db` 独立库、`webSearch`/`dictSources` 两个真实外部系统 |
| `02-学习闭环` | 业务语言闭环，属 `flow-visualizer` 范畴，本模型不重复也不取代 |
| `03-AI制卡管线` | 同上；本模型只登记「唯一 LLM 出口 = `aiClient`」这条结构事实 |
| `04-知识归一三层` | 本模型登记 `kpNorm` 为主进程确定性裁决层，三层分离属业务不变量，见 `architecture-understanding.md` |
| `05-FSRS调度事实链` | 与本模型 §3.3 直接呼应；该图 footer 已引用 `fsrsConfig.js`，而指南 §3 文件清单未列该文件 |
| 共同缺口 | 五张图均未画 M15 导图子系统与 `BackgroundActivity`（`01` 内 `导图`/`material_map`/`BackgroundActivity` 命中 **0**）；`01` 把 `memory/` 记忆文件树标注为「规范·未实现」，而该层已在 v45/v46 落地并纳入备份；`index.html:27` 与 `01:98` 标注来源为「文档 v43」，当前指南已是 v48.14（`AI_DEVELOPMENT_GUIDE.md:1`） |

**差异不作废既有图**：`01-05` 回答的是业务/算法问题，本模型回答的是结构与边界问题。两者读者不同。

---

## 6. 维护

- 事实源是 `system-model.structurizr.dsl`。改图改 DSL，不改导出物。
- `showcase.html` 由 `tools/gen-showcase.cjs` 从 `system-model.layout.json` 生成，属派生物。
- 结构性断言（表数、通道数、命名空间数、唯一写入者）都给了复算命令，改动后用 §1 的 grep 重新计数即可判断模型是否漂移。
- 校验：`node tools/dsl-check.cjs system-model.structurizr.dsl`（括号平衡 / 引用 id 均已声明 / 视图 key 唯一 / 位置参数非逗号分隔 / 声明元数合理）。
