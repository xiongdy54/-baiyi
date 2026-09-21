// ============================================================================
// 增量阅读（Incremental Reading）· 当前态架构模型  C4 / Structurizr DSL
// ----------------------------------------------------------------------------
// 状态      : current-state only（无 target/proposed 节点）
// 生成      : 2026-09-21 @ commit 780ea84 / 分支 docs/architecture-model-v48.14
// 生产方式  : architecture-visualization:system-modeler + c4model
// 证据      : 每条节点/边的 file:line 见 system-model.evidence.md（本文件不重复行号以免漂移）
// 置信度    : 以 tag 表达 —— Inferred / Unknown 类节点必须按低置信度阅读，不得当作已验证事实
// 打开方式  : Qoder 的 Structurizr DSL 格式查看器；或 Structurizr Playground / CLI
// 校验      : node tools/dsl-check.cjs system-model.structurizr.dsl
// 注意      : 渲染预览与 showcase.html 是派生物，本文件才是事实源
// ============================================================================

workspace "增量阅读 · 当前态架构模型" "Electron 桌面应用（local-first 增量阅读 / FSRS 复习 / 知识图谱 / AI 制卡 / 思维导图）。current-state，证据索引见 system-model.evidence.md。" {

  // --------------------------------------------------------------------------
  // MODEL
  // --------------------------------------------------------------------------
  model {

    // ===== 参与者 =====
    learner = person "学习者" "本机单用户。导入材料 → 阅读划词 → 提取摘录 → 复习卡片 → 裁决知识 → 生成导图。无账号、无登录、无协作。" "Person" {
      location = "Personal"
    }

    // ===== 外部系统（全部为用户自带凭据 / 可选关闭）=====
    aiGateway = softwareSystem "AI 网关（OpenAI 兼容端点）" "chat/completions + SSE 流式。预设指向 api.commandcode.ai、bigmodel.cn、本机 Ollama(localhost:11434) 或用户自定义 baseUrl。凭据经 Electron safeStorage 加密存 ai-config.json。" "External,Network" {
      location = "External"
    }

    webSearch = softwareSystem "公网搜索引擎" "Bing / DuckDuckGo / Baidu 结果页 HTML 抓取（正则解析，非官方 API），为 AI 制卡提供联网取证。失败时逐引擎降级。" "External,Network" {
      location = "External"
    }

    dictSources = softwareSystem "离线词典数据源" "ECDICT 等词典包的下载地址 + 镜像地址，下载后本地建索引。" "External,Network" {
      location = "External"
    }

    // ===== 被建模系统 =====
    app = softwareSystem "增量阅读桌面应用" "单进程组：Electron 主进程 + 两个渲染窗口。local-first，设计约束明确排除常驻后端。" {

      // ---------- L2 容器 ----------
      mainProc = container "主进程" "Electron 31 / Node.js CommonJS。唯一可触达文件系统与 SQLite 的容器；159 个 ipcMain.handle 注册在此。渲染层 nodeIntegration=false、contextIsolation=true。" "electron/*.js" "Container"{

        // ---------- L3 组件（主进程）----------
        ipcRegistry = component "IPC 处理器 + 窗口/协议/菜单" "ipcMain.handle 注册表（24 个通道前缀）、主窗口生命周期、全局快捷键、崩溃兜底。" "electron/main.js (1377)" "Boundary"
        windowCtl   = component "窗口与原生对话框" "最小化/关闭/文件选择/备份导出等窗口态能力。" "electron/main.js:136-147,166-266" "Boundary"
        assetProto  = component "自定义 URL Scheme 服务" "bookasset: 供 userData/assets/<itemId>/ 内的图片与词典音频；pdfres: 供 pdf.js 的 cmaps/wasm/fonts。privileged scheme 在 app ready 前注册。" "electron/main.js:91-96,1267-1315" "Boundary,Static"
        websearchSvc = component "联网检索" "ai:websearch：多引擎串行抓取 + 正则解析 + HTML 反转义，返回 title/snippet 列表。" "electron/main.js:565-660" "Network"

        dbRepo = component "仓储层 library.db（唯一写入口）" "4650 行。SCHEMA + 守卫式 ALTER 迁移 + 全部读写函数；persist() 为 sql.js 全量导出 → tmp → fsync → 原子 rename。persist() 的 64 处调用点全在本文件内。" "electron/db.js (4650)" "DataStore,SoleWriter"
        dictRepo = component "词典仓储 dictionary.db" "独立 SQLite 文件，与主库完全隔离（避免词条把主库推到数百 MB 级、拖垮复习写路径）。" "electron/dictDb.js, electron/dictStore.js (496)" "DataStore,SoleWriter"

        aiClient = component "AI 客户端" "getAIConfig/safeStorage 加解密、chatStream SSE 解析、模型列表探测。全应用唯一的 LLM 出口。" "electron/ai.js (464)" "AiPath,Network"
        promptLib = component "提示词库" "内置 prompt_templates 播种与取用。" "electron/prompts.js (1016)" "AiPath"

        mindEngine = component "导图生成编排器" "AI 分层生成/加深/修复/取消，写 material_map_* 四张表的唯一作者。阶段常量与 run 状态机在此。" "electron/mindmapEngine.js (3133)" "AiPath,SoleWriter"
        mindCore = component "导图结构算法（纯函数）" "validateMapStructure / buildTocTree / ownedRanges / normalizeSpans / LINEARIZATION_VERSION。无 Electron 依赖的叶子模块；仅被 mindmapEngine 与测试引用，渲染层无导入。" "electron/mindmapCore.js (1094)" "Pure"

        fsrsOpt = component "FSRS 参数优化器" "fsrs-rs-nodejs（Rust 原生绑定）从 review_logs 训练个性化权重，产出新的不可变 fsrs_configs 行。" "electron/optimizer.js (137)" "Algo"
        fsrsSem = component "FSRS 参数与时间语义真源" "FSRS6_DEFAULT_WEIGHTS 与锁定版本 ts-fsrs 5.4.2 逐位一致；fsrsTime.js 是 ts-fsrs 时间语义的手工复刻，按契约绝不 import ts-fsrs。" "electron/fsrsConfig.js, electron/fsrsTime.js" "Algo,Pure"

        kpNorm = component "知识归一裁决层（生产已接线）" "normKey 归一、聚类键、提案幂等指纹。由 db.js 顶部解构引入，位于写路径上。" "electron/kpNorm.js" "Pure"
        kpScopes = component "出层契约校验器（生产未接线）" "414 行纯函数：关系类型/探测维度/挑战四档/UDC 码封闭契约 + parseJsonLoose + 四个 validate*Output + scopeDispersion 离散度守门。生产主进程无一处 require；仅 tests/k2b 与提示词测试台经 esbuild 产物消费。db.js:1709 自述「本批只定契约」。" "electron/kpScopes.js" "Pure,ContractOnly"

        memStore = component "记忆层（文件真源）" "userData/memory/ 下的 Markdown 文件树 —— 本项目首个非 DB 的用户数据真源；永不整文件重写、永不原地改写。retrieve/tidy 为读写两侧。" "electron/memoryStore.js (420), memoryTidy.js, memoryRetrieve.js" "FileSystem"

        importSvc = component "材料导入器" "docx / txt / md / pdf / mobi-epub 二进制侧导入（HTML 与 EPUB 的解析在渲染层，见 renderer 侧）。" "electron/importers.js (385)" "Io"
        backupSvc = component "备份与恢复" "打包 library.db + settings.json + assets/ + memory/ 为 zip；恢复走 staging + 重启时 applyPendingRestore 换入（运行期禁止直接换库文件）。" "electron/backup.js (366)" "Io"
        capSvc = component "快速捕捉服务" "全局快捷键组、捕捉窗单例（关闭=隐藏）、draft→send 状态机、持久化节流（4000ms trailing / 20000ms max，唯一豁免逐次 fsync 的路径）。" "electron/quickCapture.js (400)" "Boundary"
        settingsKv = component "设置持久化" "userData/settings.json 的三层 KV（app/theme/plugin）。注意存在两份实现：main.js 内联版与 electron/settingsStore.js（被 db.js require）。" "electron/main.js:98-119, electron/settingsStore.js (21)" "Io,Inferred"
        journalT = component "日记时间语义" "日记条目跨天/时区语义。" "electron/journalTime.js" "Pure"
        udcSvc = component "UDC 领域表" "中图法领域清单，供知识归类。" "electron/udc.js (97)" "Pure"
      }

      renderer = container "主窗口渲染进程" "React 18 + TypeScript + Vite 6。index.html → src/main.tsx。无路由库：App.tsx 用判别联合 View 状态 + if/else 切换。" "src/*.tsx" "Container"{

        preload = component "preload 桥（隔离世界）" "309 行，contextBridge.exposeInMainWorld 暴露 23 个 API 命名空间。这是渲染层访问主进程的唯一入口——全 src/ 无一处 require/ipRenderer/node: API。" "electron/preload.js (309)" "Boundary"
        appShell = component "应用外壳与视图切换" "View 判别联合 + useState 切换 Bookshelf/Reader/QueueView/ReviewView/CardBrowser/JournalView/Dashboard；主题、皮肤、强调色的 body 挂载点。" "src/App.tsx, src/main.tsx:6-48" "UI"
        domainCli = component "领域 API 客户端" "src/lib/ 下的按域薄封装：library / cards / readingWorkflow / knowledge / insight / memory / dict / journal / stats / occlusion / ai / activity，各自转调 window.*API。" "src/lib/*.ts" "Boundary"
        bus = component "渲染层事件总线" "16 个锁定事件名的发布/订阅，模块级 Map。渲染层内部机制，不跨进程；由 lib 把 IPC 推送桥接成 bus 事件。" "src/lib/eventbus.ts (25)" "Pure"

        readerKernel = component "阅读内核（引擎无关）" "ReaderKernel 契约 + service 惰性加载。业务代码禁止直接依赖具体引擎。" "src/lib/reader/kernel.ts, service.ts" "UI"
        foliateAcl = component "foliate 防腐层" "全仓库唯一允许 import vendor/foliate-js 的目录（adapter/appearance/selection/version + vendor.d.ts）。version.ts 记录 vendor 快照 commit，升级须同步指南。" "src/lib/reader/foliate/**" "Acl,Vendored"
        vendored = component "foliate-js 快照" "MIT 无类型纯 ESM 第三方快照（epub/mobi/fb2/cbz/opds/paginator/overlayer…）。" "vendor/foliate-js/" "Vendored"
        pdfAcl = component "PDF 阅读适配" "pdf.js 适配，复用 foliate/version 的引擎版本常量。" "src/lib/reader/pdf/adapter.ts" "Acl"

        fsrsCli = component "FSRS 调度（渲染进程内）" "运行时全仓唯一 import ts-fsrs 的文件：预览=落库同解的调度器、fsrsJson 全字段往返、卡片状态。" "src/lib/fsrs.ts" "Algo"

        mindUi = component "导图工作台" "全屏覆盖层 UI + 渲染侧确定性树布局与 SVG 生成（布局/绘制不依赖主进程）。" "src/components/MindmapWorkspace.tsx (1143), src/lib/mindmap/layout.ts, render.ts" "UI"

        importHtml = component "渲染层导入解析" "HTML/EPUB 在渲染层解析：DOMParser + @mozilla/readability + DOMPurify + turndown。" "src/lib/htmlImport.ts, epub.ts, importRouter.ts" "Io"

        theme = component "主题 / 皮肤 / 强调色" "light-dark 走 body.theme-*；皮肤注册表当前仅 none 一项（玻璃拟态皮肤已下线）；applyAccent 必须同时写 body 与 documentElement，否则深色模式自定义强调色不生效。" "src/skins/index.ts, src/theme.css, src/lib/accentVar.ts" "UI"

        uiViews = component "业务视图组件" "Reader(2665) / SettingsPanel(1916) / CardBrowser(954) / KnowledgeManager(728) / InsightPanel(528) / ReviewView(517) / QueueView / Bookshelf / Dashboard / charts/swiss.tsx 等。" "src/components/**" "UI"
      }

      captureWin = container "捕捉窗渲染进程" "第二个 BrowserWindow（560x380、frameless、alwaysOnTop、blur 即隐藏）。独立 Vite 入口 capture.html → src/capture.tsx。" "capture.html" "Container"{
        capPreload = component "捕捉 preload（最小权限）" "26 行。仅暴露只读 settingsAPI.get + captureAPI（ready/hide/onShown + 日记 draft/draftSave/draftSend/discardDraft）。刻意不暴露 cards/library/ai —— 捕捉窗拿不到制卡与库写权限。" "electron/preload-capture.js (26)" "Boundary"
        capEditor = component "捕捉编辑器" "极简 Markdown 编辑器 + 强调色应用。" "src/capture.tsx (35), src/components/CaptureEditor.tsx" "UI"
      }

      libDb = container "library.db" "SQLite（sql.js WASM）。27 张表。架构要点：内存库 + 全量回写 —— 应用运行期间外部脚本直接改该文件会被 persist() 覆盖。" "sql.js / SQLite" "Database,Container"{
        location = "Personal"
      }

      dictDb = container "dictionary.db" "独立 SQLite 文件（词典词条），只在导入/删除时落盘。" "sql.js / SQLite" "Database,Container"{
        location = "Personal"
      }

      userFiles = container "userData 文件树" "settings.json / ai-config.json / assets/<itemId>/ / memory/ / backups/ / restore-staging / dicts/。memory/ 是首个非 DB 用户数据真源。" "app.getPath(userData)" "FileSystem,Container"{
        location = "Personal"
      }
    }

    // ------------------------------------------------------------------------
    // 仓库内的第二个可独立运行单元：提示词测试台（不随产品发布）
    // 建成产品边界「外」的开发者工具系统，以免把调参工具算进产品运行时
    // ------------------------------------------------------------------------
    promptLab = softwareSystem "提示词测试台 prompt-lab" "独立 Electron 应用（自带 package.json main=main.js，由根目录 .bat 以 npx electron prompt-lab 启动）。定位：AI 改提示词 → 人工实测文字/图片 → 反馈 → 再决定是否并回主软件；明言与主软件隔离、主软件内不做提示词调优试验。数据同样隔离：独立 userData(%APPDATA%/prompt-lab)，Key 需在此单独配一次，草稿写 prompts.local.json —— 不复用 library.db。" {
      location = "Internal"
      tags = "DevTooling"

      labMain = component "测试台主进程" "222 行，9 个 lab:* IPC：prompts list/get/save/reset/applyDraft + config get/set + pickImage。contextIsolation:true / nodeIntegration:false，独立最小 preload（19 行）。" "prompt-lab/main.js, preload.js" "DevTooling"
      labUi = component "测试台界面" "764 行原生 JS（非 React）。对陈旧 esbuild 产物有运行期守卫：window.kpScopesLib 缺失即报「先跑 npm run build:kpscopes 再重启测试台」。" "prompt-lab/renderer/app.js, index.html" "DevTooling"
      labBundles = component "跨边界复用机制：esbuild 产物" "把主软件代码打包成浏览器可用的全局变量：build:kpscopes ← electron/kpScopes.js（--global-name=kpScopesLib）；build:vendor ← src/lib/cards.ts（--global-name=cardsLib）。产物 vendor/kpScopes.js(443) 已提交进仓库，须手工重跑才会更新 —— 与主源码存在漂移窗口。" "prompt-lab/package.json:9-10, prompt-lab/vendor/" "DevTooling,ContractOnly"
    }

    // 代码复用方向（构建期 require / bundle，不是运行期调用）
    labMain -> aiClient "require(../electron/ai)：复用同一套 getAIConfig/setAIConfig/chatStream" "require" "Inferred"
    labMain -> promptLib "require(../electron/prompts)：取同一份提示词正文" "require" "Inferred"
    labBundles -> kpScopes "esbuild 打包成 window.kpScopesLib（生产主进程不 require 它）" "esbuild" "Inferred"
    labBundles -> domainCli "esbuild 打包 src/lib/cards.ts 成 window.cardsLib（见 domainCli 清单）" "esbuild" "Inferred"
    labUi -> labBundles "读取全局变量" "script tag" "Read"
    labUi -> labMain "window.labAPI" "contextBridge + IPC" "Boundary"
    labMain -> aiGateway "实测调用 LLM（文字/图片）" "HTTPS" "AiPath,Network"
    labMain -> userFiles "写 prompts.local.json 到「自己」的 userData，非主软件目录" "fs" "Write"

    // ------------------------------------------------------------------------
    // 未知项：显式建模，不粉饰成已确认路径
    // ------------------------------------------------------------------------
    syncUnknown = softwareSystem "多用户 / 云同步（未知）" "未知：schema 预留了 user_id / sync_version / is_deleted，users 表仅播种 'local-user' 一行。目前无任何同步、权限、并发写入的调用方——不得当作已存在的租户边界。" "External,Unknown" {
      location = "External"
    }
    telemetryUnknown = softwareSystem "用量遥测 / 错误上报（未知）" "未知：docs/SPEC-usage-telemetry.md 规格了 ai_usage 表与 electron/telemetry.js，但代码中未见落地，指南另一处称其未实现。待核实是否作废。" "External,Unknown" {
      location = "External"
    }

    // ------------------------------------------------------------------------
    // RELATIONSHIPS — L1 上下文（app 级为下方精确边的汇总，见 evidence.md）
    // ------------------------------------------------------------------------
    learner -> app "使用：阅读、提取、复习、裁决、生成导图" "桌面应用"
    learner -> captureWin "全局快捷键唤起快速捕捉（Ctrl+Alt+Space / Ctrl+Alt+N）"

    app -> aiGateway "调用 LLM 生成卡片 / 导图 / 洞察 / 记忆整理（SSE 流式）" "HTTPS + text/event-stream" "AiPath"
    app -> webSearch "抓取搜索结果作为 AI 制卡的联网证据" "HTTPS + HTML 解析" "Network"
    app -> dictSources "下载离线词典数据包" "HTTPS 大文件下载" "Network"
    app -> syncUnknown "needs validation：列已存在，同步读写路径未见" "" "UnknownEdge"
    app -> telemetryUnknown "needs validation：规格文档在，实现未见" "" "UnknownEdge"

    // ------------------------------------------------------------------------
    // RELATIONSHIPS — L2 容器
    // ------------------------------------------------------------------------
    renderer -> mainProc "23 个 window.*API 命名空间 / 159 个 ipcMain.handle 通道" "contextBridge + ipcRenderer.invoke" "Boundary"
    captureWin -> mainProc "只读设置 + 日记草稿协议（draftSave / draftSend / discardDraft）" "contextBridge + ipcRenderer.invoke" "Boundary"
    mainProc -> renderer "主动推送变更（fsrs:configChanged / journal:changed / insight:changed / memory:changed / mindmap:changed）" "webContents.send" "Async"
    mainProc -> captureWin "shown / 主题同步 / 隐藏指令" "webContents.send" "Async"

    mainProc -> libDb "唯一写入者：内存库 + 原子全量回写（tmp → fsync → rename）" "sql.js" "Write,SoleWriter"
    mainProc -> dictDb "读写（词条库独立落盘）" "sql.js" "Write,SoleWriter"
    mainProc -> userFiles "读写 assets / memory / settings.json / backups" "fs" "Write"
    renderer -> userFiles "只读取材：图片、词典音频、pdf.js 资源" "bookasset: / pdfres:" "Read,Static"

    mainProc -> aiGateway "chat/completions 流式请求（渲染层无出网能力）" "HTTPS" "AiPath,Network"
    mainProc -> webSearch "ai:websearch 抓取" "HTTPS" "Network"
    mainProc -> dictSources "dict:download 下载" "HTTPS" "Network"

    // ------------------------------------------------------------------------
    // RELATIONSHIPS — L3 组件（主进程内部）
    // ------------------------------------------------------------------------
    ipcRegistry -> dbRepo "转调仓储函数（不拼 SQL）" "in-process" "Write"
    ipcRegistry -> websearchSvc "ai:websearch" "" "Network"
    ipcRegistry -> assetProto "注册 bookasset / pdfres" "" "Static"
    ipcRegistry -> capSvc "shortcut:* 与 journal:draft* 转发"
    windowCtl -> userFiles "文件对话框/备份导出落点" "fs" "Write"

    mindEngine -> dbRepo "写 material_maps / _shards / _runs / _calls" "in-process" "Write,SoleWriter"
    mindEngine -> mindCore "结构校验与线性化" "require" "Read"
    mindEngine -> aiClient "分层生成 / 加深 / 修复" "in-process" "AiPath"
    mindEngine -> promptLib "取提示词模板" "in-process" "AiPath"

    aiClient -> aiGateway "流式请求" "HTTPS" "AiPath,Network"
    websearchSvc -> webSearch "抓取结果页" "HTTPS" "Network"
    dictRepo -> dictSources "下载源解析" "HTTPS" "Network"
    dictRepo -> dictDb "词条读写" "sql.js" "Write,SoleWriter"

    fsrsOpt -> dbRepo "读 review_logs / 写 fsrs_configs 不可变快照" "in-process" "Write,SoleWriter"
    fsrsOpt -> fsrsSem "默认权重与 delta_t 语义" "require" "Read"
    dbRepo -> fsrsSem "校验权重与 ts-fsrs 锁定版本一致" "require" "Read"

    memStore -> userFiles "memory/ 文件树（非 DB 真源）" "fs" "Write"
    importSvc -> dbRepo "写入 documents/extracts/assets" "in-process" "Write"
    backupSvc -> libDb "打包 / 换入" "file" "Write"
    backupSvc -> userFiles "zip 成员：assets/ memory/ settings.json" "file" "Write"
    capSvc -> dbRepo "经 ctx.db 写 journal_entries" "in-process" "Write"
    capSvc -> captureWin "窗口生命周期与状态机" "IPC" "Async"
    settingsKv -> userFiles "settings.json" "fs" "Write"
    dbRepo -> settingsKv "require(./settingsStore)" "require" "Inferred"
    dbRepo -> kpNorm "解构引入归一/聚类键/幂等指纹（写路径上）" "require" "Read"
    ipcRegistry -> journalT "日记跨天语义" "in-process" "Read"
    ipcRegistry -> udcSvc "UDC 领域清单" "in-process" "Read"
    ipcRegistry -> memStore "memory:* / insights:* 转调" "in-process" "Write"
    ipcRegistry -> fsrsOpt "optimizer:train / optimizer:apply" "in-process" "Write"
    ipcRegistry -> importSvc "library:import* 转调" "in-process" "Write"
    ipcRegistry -> backupSvc "backup:* 转调" "in-process" "Write"

    // ------------------------------------------------------------------------
    // RELATIONSHIPS — L3 组件（渲染层内部）
    // ------------------------------------------------------------------------
    appShell -> domainCli "调用领域客户端" "in-process" "Read"
    appShell -> uiViews "按 View 联合切换" "in-process" "Read"
    appShell -> theme "挂载 body：theme-*/has-skin/--accent" "DOM" "Write"
    uiViews -> domainCli "调用" "in-process" "Read"
    uiViews -> bus "订阅/发布渲染层事件" "in-process" "Async"
    domainCli -> bus "把 IPC 推送桥接成 bus 事件" "in-process" "Async"
    domainCli -> preload "转调 window.*API" "in-process" "Boundary"
    preload -> ipcRegistry "ipcRenderer.invoke → ipcMain.handle" "IPC" "Boundary"
    capPreload -> ipcRegistry "受限通道" "IPC" "Boundary"
    capEditor -> capPreload "调用" "in-process" "Boundary"

    readerKernel -> foliateAcl "唯一引擎入口（ReaderKernel 契约）" "dynamic import" "Acl"
    foliateAcl -> vendored "import（全仓唯一豁免目录）" "ESM" "Vendored"
    uiViews -> readerKernel "挂载阅读视图" "in-process" "Read"
    pdfAcl -> readerKernel "注册为另一内核实现" "in-process" "Acl"
    fsrsCli -> dbRepo "评分经 fsrs:* 通道落库（主进程侧写）" "IPC" "Write"
    mindUi -> domainCli "mindmapAPI" "in-process" "Read"
    mindUi -> bus "mindmap/changed" "in-process" "Async"
    importHtml -> domainCli "提交导入结果" "in-process" "Write"
    assetProto -> userFiles "按 hostname=itemId 白名单读文件" "fs" "Read"
  }

  // --------------------------------------------------------------------------
  // VIEWS  —— 一个视图只回答一个问题
  // --------------------------------------------------------------------------
  views {

    systemLandscape "L0" "系统全景：谁在用、系统边界在哪、真正的外部依赖有哪三个（含两处未验证的规格残留）" {
      include *
      autosize
    }

    systemContext app "L1" "系统上下文：local-first 的边界声明——出网只有三条已确认，另两条为未验证的规格残留（虚线）" {
      include *
      autosize
    }

    container app "L2" "容器视图：进程边界 + 数据真源边界（回答「谁能写库、谁能出网」）" {
      include *
      autosize
    }

    component mainProc "L3-main" "主进程组件：唯一写入口、唯一 LLM 出口、各子系统的作者归属" {
      include *
      autosize
    }

    component renderer "L3-renderer" "渲染层组件：跨进程面、防腐层、渲染进程内的算法所有权" {
      include *
      autosize
    }

    styles {
      element "Person"      { shape Person;   background #2f6f6a; color #ffffff; fontSize 14 }
      element "External"    { shape Box;      background #b8b2a7; color #2b2b2b; border #6b6b6b; opacity 80 }
      element "Unknown"     { background #ffffff; color #8a8a8a; border #b04a2f; borderWidth 2; style Dashed; fontSize 12 }
      element "Container"   { shape Rounded;  background #1f4b47; color #ffffff; fontSize 15 }
      element "Boundary"    { background #d8cfa8; color #2b2b2b; border #8a7a3c }
      element "Database"    { shape Cylinder; background #3d5a3e; color #ffffff; fontSize 13 }
      element "FileSystem"  { shape Folder;   background #4a4f55; color #ffffff; fontSize 13 }
      element "DataStore"   { background #3d5a3e; color #ffffff }
      element "SoleWriter"  { border #b04a2f; borderWidth 4 }
      element "AiPath"      { background #6b4a7a; color #ffffff }
      element "Algo"        { background #2f5d7a; color #ffffff }
      element "Pure"        { background #eef0ee; color #2b2b2b }
      element "UI"          { background #5a6b7a; color #ffffff }
      element "Vendored"    { background #7a6a4a; color #ffffff; border #3a3a3a }
      element "Acl"         { border #b04a2f; style Dashed }
      element "Inferred"    { border #c8963c; style Dashed }
      element "Io"          { background #4a5f6b; color #ffffff }
      element "DevTooling"  { background #6b6b6b; color #ffffff; border #2b2b2b; opacity 90 }
      element "ContractOnly" { border #c8963c; borderWidth 3; style Dashed }

      relationship "Network"     { color #7a7a7a; dashed true; thickness 2 }
      relationship "AiPath"      { color #6b4a7a; thickness 3 }
      relationship "Write"       { color #b04a2f; thickness 2 }
      relationship "Read"        { color #3d5a3e; thickness 1 }
      relationship "Static"      { color #3d5a3e; dashed true }
      relationship "Async"       { color #2f5d7a; dashed true }
      relationship "SoleWriter"  { color #b04a2f; thickness 4 }
      relationship "Vendored"    { color #7a6a4a; thickness 3 }
      relationship "Acl"         { color #b04a2f; dashed true }
      relationship "Inferred"    { color #c8963c; dashed true }
      relationship "UnknownEdge" { color #b04a2f; dashed true; thickness 1 }
    }
  }
}
