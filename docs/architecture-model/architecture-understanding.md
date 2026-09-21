# 增量阅读 · 架构理解（当前态）

> 用途：**给在仓库里改代码的人（含 AI 编码代理）当参照**。回答「这个系统由什么构成、边界在哪里、什么东西只能从一处走」。
> 事实源：`system-model.structurizr.dsl`；逐条行号证据：`system-model.evidence.md`。
> 状态：current-state，无提案、无建议方案。生产方式 `system-modeler` + `c4model`，2026-09-21 @ `780ea84`。
> 读法：§1 定位 → §2 能力 → §3 领域对象 → §4 四道边界（最重要）→ §5 不变量 → §6 回归路径 → §7 未知项。

---

## 1. 这是什么系统

一台**本机单用户**的渐进阅读（incremental reading）工作台。学习者把任意材料（EPUB / PDF / Word / Markdown / 网页粘贴 / 图片）放进书架，在阅读中把没读懂的片段"搁置"成**摘录**，摘录进入待办队列被逐条展开理解，理解成果经 AI 起草 + 确定性质检变成**卡片**，卡片交给 **FSRS** 安排长期复习；每次评分沉淀为**事实**，事实再投影成**知识点与掌握状态**，并推荐下一步该读什么。另有一条并行输入通道：随手写的**日记**被分析成需求信号。

设计上明确排斥常驻后端：整个系统只有三处出网，且全在主进程（见 §4.3）。

**规模**：95 个源文件、约 36.6k 行（`electron/` 25 个主进程文件 + `src/` 70 个渲染层文件）。仓库里还有**第二个可独立运行的 Electron 应用** `prompt-lab/`（约 1.5k 行，提示词测试台，不随产品发布，见 §4.5）。


## 2. 系统提供的能力

| 能力 | 承载者 |
| --- | --- |
| 材料入库与多格式解析 | 主进程 `importSvc`（docx/txt/md/pdf）+ 渲染层 `importHtml`（HTML/EPUB 在渲染层解析） |
| 连续阅读（分页、目录、进度锚点、划词） | 渲染层 `readerKernel` + `foliateAcl` + `pdfAcl` |
| 摘录与待办队列（SuperMemo19 式优先级） | `src/lib/readingWorkflow.ts` ↔ `extracts` 表 |
| AI 制卡与确定性质检 | `promptLib` + `aiClient`（起草）+ `cards.ts`/`kpExtract` + 主进程 `kpNorm`（裁决） |
| FSRS 复习调度与参数优化 | 渲染层 `fsrsCli`（调度）+ 主进程 `fsrsOpt`（优化）+ `fsrsSem`（语义真源） |
| 知识归一与三层分离 | `kpNorm` + `knowledge_points/relations/external_refs/proposals` 四表 |
| 思维导图分层生成 | 主进程 `mindEngine`（AI 编排）+ `mindCore`（结构算法）+ 渲染层 `mindUi`（布局与出图） |
| 记忆层（跨会话上下文） | `memStore`，写进 `userData/memory/` 文件树 |
| 词典查询与离线词库 | `dictRepo` + 独立的 `dictionary.db` |
| 备份 / 恢复 | `backupSvc` |
| 快速捕捉 | `capSvc` + 独立的捕捉窗容器 |

## 3. 领域对象与它们的真源

27 张表构成业务数据面，按所有者分组（逐条见 `system-model.evidence.md` §3.2）：

- **材料与阅读**：`library_items` → `documents` → `assets` → `extracts`。摘录是"亲手搁置的最小未理解单元"，带 `priority` 与 `shelveReason`。
- **卡片与复习**：`cards`、`card_issues`（质检结果）、`ai_gen_batches`（生成批次）、`prompt_templates`、`review_logs`（**append-only 评分事实**）、`review_skips`、`reading_events`、`fsrs_configs`。
- **知识层**：`knowledge_points`（状态 `active|merged|deprecated`）、`knowledge_relations`（9 种关系类型）、`knowledge_external_refs`、`knowledge_proposals`（AI 提案区）。
- **派生与推荐**：`insight_runs`、`personal_meaning_candidates`、`memory_runs`。
- **导图**：`material_maps`、`material_map_shards`、`material_map_runs`、`material_map_calls`。
- **其它**：`journal_entries`、`dict_sources`、`dictionary_cache`、`users`（见 §7-V1）。

**第二个数据真源**：`userData/memory/` 是一棵 Markdown 文件树，**不走数据库**。它是本项目唯一"非 DB 的用户数据真源"，契约要求永不整文件重写、永不原地改写（`memStore`）。任何只看 27 张表就断言"用户数据都在 SQLite 里"的理解都是错的。

## 4. 四道边界（改代码前必须知道的部分）

### 4.1 进程边界：一道面，23 个命名空间

`main.js` + `preload.js` 把系统切成两个几乎完全隔离的半边：

- 渲染层 `nodeIntegration:false`、`contextIsolation:true`（`electron/main.js:1225-1226`）。
- 渲染层访问外界的唯一通道是 `electron/preload.js` 用 `contextBridge.exposeInMainWorld` 暴露的 **23 个 `window.*API` 命名空间**，对应主进程侧 **159 个 `ipcMain.handle`**、**24 个通道前缀**。
- **实测 `src/` 内零处 `require` / `node:` / `ipcRenderer` / `readFileSync`**（`evidence.md` §1）。这不是风格约定，是当前事实。

含义：想在渲染层"顺手读个文件"，就是新开一道边界。这条边一旦出现，4.2 与 4.3 两条不变量同时失效。

### 4.2 写边界：`library.db` 只有一个作者

`electron/db.js` 是唯一写入者。`persist()` 的 64 个调用点**全部位于该文件内**（`electron/db.js:682-693`）；文件内注释直接写明「业务代码禁止绕过仓储层直接写库」（`:1494`）。

持久化机制决定了行为：**sql.js 是内存库 + 全量回写**，落盘走 `db.export()` → 同目录 `.tmp` → `fsync` → 原子 `rename`（`:682`）。`persistNow()`（`:697`）只重做持久化，**绝不重放业务 mutation**。

由此得到两条容易踩空的事实：
1. 应用运行期间，外部脚本改 `library.db` 会被下一次 `persist()` 整体覆盖 —— 不是竞态，是必然。
2. 因此恢复备份必须"重启时换入"（`applyPendingRestore`，`electron/backup.js:4,271`），不能在运行期换文件。

`dictionary.db` 是**故意分出去的第二座库**（`electron/dictDb.js:1-3`）：ECDICT 全量 340 万行若并进主库，会把主库推到数百 MB 级，从而拖垮"每次写全量回写"的复习/制卡路径。分库不是为了整洁，是为了让主库的写成本可控。

### 4.3 网络边界：出网只有三条，全在主进程

| 出口 | 通道 | 证据 |
| --- | --- | --- |
| AI 网关 | `aiClient` → OpenAI 兼容 `/chat/completions` + SSE | `electron/ai.js:240`、`:309`；预设 `:14,22,38` |
| 公网搜索 | `websearchSvc` → Bing/DuckDuckGo/Baidu 结果页抓取 | `electron/main.js:565-660` |
| 词典下载 | `dict:download` → url + mirrorUrl | `electron/main.js:808-832` |

`main.js` 里 `net.fetch` 恰好 3 处。三者都**可选、可失败**：搜索逐引擎降级（`:635-638`），词典双源回退，AI 凭据缺失时 `hasKey:false`（`ai.js:95`）。AI 网关的第四种预设是 `http://localhost:11434/v1`（Ollama），所以"外部"在这里包含"本机另一进程"。

### 4.4 权限边界：两个窗口，两套能力

捕捉窗不是主窗口的缩小版，是**能力被削掉的一整个子集**：`preload-capture.js` 只暴露 2 个命名空间 —— 只读 `settingsAPI.get` 与 `captureAPI`（ready/hide/onShown + 日记草稿协议）。**cards / library / ai / knowledge 一律不给**（`electron/preload-capture.js:1-5` 自述最小权限）。

捕捉窗与主窗口之间**没有直接通道**：草稿经主进程落库，再由 `broadcastJournalChanged` 广播给除发送者外的所有窗口（`quickCapture.js:310-316` 的 `excludeWebContents`）。这个"排除发送者"的广播惯用法在 `fsrs:configChanged`、`insight:changed`、`memory:changed`、`mindmap:changed` 上各复制了一份 —— 五个通道、五份同构循环。

渲染层拿文件内容走两条自定义 scheme：`bookasset:`（按 `hostname=itemId` + 文件名白名单读 `userData/assets/`）与 `pdfres:`（pdf.js 的 cmaps/wasm/fonts）。两者必须在 `app ready` **之前**注册 privileged scheme，`main.js:1265-1266` 给了原因：封面 `<img>` 可能抢在 handler 注册前发请求而永久失败（img 不自动重试）；`pdfres` 存在的原因是 `file://` 页面里 `fetch file://` 会被 Chromium 拦掉，导致字形加载失败变成白轮廓 + 重试风暴（`:93-94`）。

### 4.5 工具边界：仓库里其实有两个可运行程序

`prompt-lab/` 是一个**独立的 Electron 应用**（自带 `package.json`、`main.js`、`preload.js`，由根目录 `启动提示词测试台.bat` 以 `npx electron prompt-lab` 拉起，`prompt-lab/package.json` 明言"与主软件隔离，主软件内不做提示词调优试验"）。它**不随产品发布**，所以模型把它放在产品边界之外，标为 `DevTooling`。

它与主软件的关系是**构建期复用 + 数据隔离**：

- 复用：`prompt-lab/main.js:11-12` 直接 `require("../electron/ai")` 与 `require("../electron/prompts")` —— 共用同一份 AI 配置读取逻辑和同一份提示词正文。
- 隔离：独立 `userData`（`%APPDATA%/prompt-lab`，`main.js:8` 注释并写明"Key 须在测试台内单独配置一次"），草稿写 `prompts.local.json`（`:46`）。**全仓检索不到它对 `library.db` 的任何引用** —— 测试台碰不到用户知识库。
- 跨边界机制：`prompt-lab/package.json:9-10` 两条 esbuild 命令把主软件代码打包成浏览器全局变量 —— `../electron/kpScopes.js → window.kpScopesLib`、`../src/lib/cards.ts → window.cardsLib`。产物 `prompt-lab/vendor/kpScopes.js`（443 行）**已提交进仓库**，靠手跑更新；`renderer/app.js:361` 有"产物缺失"守卫，但**内容陈旧时无守卫**。

这条边界解释了 §5 里 `kpScopes` 的尴尬位置，也是初版模型的一处遗漏：查它"require 扇入为 0 是否死代码"时才暴露出整个第二个应用。


## 5. 由契约而非调用图维持的一致性簇

这类关系在依赖图上是**看不见**的，因而最容易被改坏：

1. **FSRS 三份实现**。渲染进程 `src/lib/fsrs.ts:14` 用 `ts-fsrs` 跑调度；主进程 `optimizer.js:4` 用 `fsrs-rs-nodejs` 跑参数优化；`electron/fsrsTime.js` 是**对 ts-fsrs 时间语义的手工复刻**，注释明确"绝不 import ts-fsrs"（`:2-5`）。`fsrsConfig.js:2-3` 要求 `FSRS6_DEFAULT_WEIGHTS` 与锁定的 ts-fsrs 5.4.2 逐位一致，并声明升级该版本时必须重新核对。风险由 S7 / L6-A 测试承担（时间语义变更触发红灯 → 重新审计）。**三者之间没有代码依赖，只有版本锁定不变量。**
2. **foliate 防腐层**。`src/lib/reader/foliate/adapter.ts:10` 是全仓**唯一**一处 import `vendor/foliate-js`；`kernel.ts:3` 声明唯一豁免目录；`version.ts:3` 把 vendor 快照的 commit 钉在代码里，并要求升级后同步指南。业务代码要换引擎，只能碰这一层。
3. **强调色必须写 `body`**。`src/lib/accentVar.ts:36-45` 的理由链是完整的：深色档声明在 `body.theme-dark` 上，胜过从 `:root` 继承的值，且整个应用渲染在 body 子树里 —— 所以只写 `:root` 时浅色正常、深色全应用回落到默认蓝。修复形态是 `for (const el of [document.body, document.documentElement])`（`:48`），`:root` 那份保留给独立窗口未挂主题类的时刻。这是最近一次（`780ea84`）修的实际缺陷，不是理论规则。
4. **AI 输出不是事实源**。AI 处在"提议"这一层：卡片须经确定性质检、知识须经 `kpNorm` 裁决、导图 run 须经确认。归一中枢与裁决器是纯本地函数，同一输入必得同一结果。
   - **但这条不变量的落地程度不齐**：`kpNorm`（normKey/聚类键/幂等指纹）确实被 `db.js:43` 解构引入、在写路径上；而 `kpScopes.js` 的**出层契约校验器**（`KP_RELATION_TYPES`、`PROBE_DIMENSIONS`、`CHALLENGE_GRADES`、`UDC_CODES`、`validateKnowledgeProbeOutput` 等，`:400-412`）在 `electron/` 内**零 require**，只有注释（`db.js:1709` 自述"本批只定契约"）、`tests/k2b` 和提示词测试台经 esbuild 产物在用它。所以"AI 输出都过确定性契约"目前**对卡片与归一成立、对出层 schema 校验尚未接入主进程**。把它当作已生效的护栏会误判。
5. **持久化节流是显式破例，不是疏忽**。`deferPersist` + `flushJournalPersist`（`quickCapture.js:342,351`）让日记草稿在 4000/20000ms 双阈值内**不触发**全量回写（`:9-11` 注明这是逐次 fsync 的唯一例外），定格时才即时落盘。理解"`persist()` = 每次写都重写整个 `library.db`"才能理解为什么只有这条高频路径需要破例。


## 6. 改这些路径时要看哪条回归线

模型只登记事实性的"谁依赖谁"，不给修复建议；下面是各条链路的**参与方清单**，用于判断一次改动会牵到谁。

- **复习评分链**（最容易牵一发动全身）：`ReviewView` → `src/lib/fsrs.ts`（渲染进程算）→ `fsrs:*` IPC → `dbRepo` → `review_logs` + `cards.fsrs_json` → `persist()` 全量落盘 → `main.js:446` 广播 `fsrs:configChanged` → 其他窗口刷新。跨了进程边界、写边界、并触达一致性簇 ①。
- **AI 制卡链**：`cards.ts` → `cardsAPI`/`promptsAPI` → `promptLib` → `aiClient` →（唯一 LLM 出口）→ 质检 → `dbRepo` 落 `cards`/`card_issues`/`ai_gen_batches`；联网取证另走 `websearchSvc`。
- **导图链**：`MindmapWorkspace` →（布局/出图在渲染层，**不经主进程**）→ `mindmapApi` → `mindmapAPI` → `mindEngine` → `mindCore` + `aiClient` + `dbRepo`（四表唯一作者）→ `main.js:1136` 广播 → `activity.ts` 后台任务态。启动期还有 `reconcileStaleMaterialMapRuns`（`main.js:1350`）收拾上次中断的 run。
- **快速捕捉链**：全局快捷键 → `capSvc` 唤窗（等 renderer ready 才 show，防白闪 `:275-306`）→ 草稿 `ctx.db.saveJournalDraft(..., {deferPersist:true})` 按 4000/20000ms 双阈值节流、`flushJournalPersist` 才落盘（`quickCapture.js:19-20,342,351`）→ `journal:draftSend` 定格 → 广播排除发送者。注意 `capSvc` 的 db 是 `main.js` **注入**的 `ctx`（`:89` 注释 `{ db, readSettings, writeSettings, sendToMain }`），不走 require —— 按 require 图估它的影响面会偏小。
- **提示词调优链**（工具侧，不碰用户数据）：`labUi` → `lab:prompts:*` → `promptLib` 取正文 / 写 `prompts.local.json` → `lab:config:*` 复用 `aiClient` → `aiGateway` 实测 → `lab:prompts:applyDraft` 决定是否并回。出层校验靠 `window.kpScopesLib`（esbuild 产物）。

- **知识归一链**：`kpExtract.ts`（调 AI）→ `knowledge:kpExtractPrepare/Apply` → `kpNorm`（确定性裁决、环检测、幂等指纹）→ 四张知识表 → `insight`/`Frontier` 派生视图。
- **备份恢复链**：`backupSvc` 打包 `library.db + settings.json + assets/ + memory/` → 恢复解到 `restore-staging` → **重启时** `applyPendingRestore` 在 `initDb()` 之前换入（`main.js:1318`）。

## 7. 这个模型不知道什么

以下在项目里**没有**代码证据，模型按未知处理（详见 `evidence.md` §4）：

- **V1 多用户/同步**：`users` 只播种一行 `'local-user'`（`db.js:238`），17 张表带 `user_id`、另有 `sync_version`/`is_deleted`，但**没有任何同步、鉴权、多用户切换或并发写入的调用方**。`user_id` 是预留列，不是租户边界 —— 把它画成权限模型会是错的。
- **V2 遥测**：`docs/SPEC-usage-telemetry.md` 规格了 `ai_usage` 表与 `electron/telemetry.js`；两者都不存在。该 spec 还禁止编辑指南，与指南互为矛盾。
- **V3 设置双实现**：`main.js:98-119` 与 `electron/settingsStore.js:6-21` 两份并存，`db.js:44` require 后者。是否同文件同结构、有无互相覆盖，**未实测，不下结论**。
- **V5 `mindmapCore.d.ts:1` 宣称渲染层可导入**，但 `src/` 零命中；渲染层的对应实现是 `src/lib/mindmap.ts:210`。当前建模为 main-only 叶子。
- **V6 皮肤系统**：注册表只剩 `none`（玻璃拟态已删），但 `body.has-skin` 与 `.skin-layer` 仍在。是扩展点还是残留，未定。
- **V8 `kpScopes` 未接线是分阶段交付还是作废**：`db.js:1709` 的注释指向"有意先定契约、消费引擎属后续批次"，因此**只能断言契约存在且生产写路径未使用它**，不能断言契约作废。
- **V9 提示词测试台的 esbuild 产物漂移**：`prompt-lab/vendor/kpScopes.js` 已提交、靠手跑更新，守卫只覆盖"产物缺失"不覆盖"内容陈旧"。同类的必需构建产物还有 `tests/tmp-m7`。

**耦合的一个反直觉测量**：按 `require` 扇入看，`db.js` 只有 main.js 一个引用方，而它自己汇聚了 prompts / kpNorm / settingsStore / udc / fsrsConfig / fsrsTime / journalTime 七个叶子 —— 所以"改 `db.js` 会牵全身"在依赖方向上说反了，它是**依赖的汇聚点**。真正的高扇入是 `ai.js`（main + 导图引擎）、`fsrsConfig.js` 与 `fsrsTime.js`（db + optimizer）、`journalTime.js`（db + main）。详见 `system-model.evidence.md` §1.1。


**AI 指令覆盖情况**（事实陈述）：仓库没有 `AGENTS.md`/`CLAUDE.md`/`GEMINI.md`/`.github/copilot-instructions.md`；唯一的 AI 面向指引是 `AI_DEVELOPMENT_GUIDE.md`（1642 行，自称"唯一依据"）。它**确实**讲清了领域对象、七步制卡管线、三层分离、FSRS 契约、sql.js 写纪律与防腐层 —— 不是只有构建命令。它**没有**讲的：§3 结构清单只列了 10 个主进程文件（`electron/` 实有 24 个 `.js`），导图子系统的 `mindmapEngine`/`mindmapCore`、以及 `kpNorm`/`kpScopes`/`fsrsConfig`/`memoryStore`/`memoryTidy`/`memoryRetrieve`/`dictStore`/`dictDb`/`importers`/`backup`/`settingsStore`/`udc` 全都在清单之外，尽管指南别处大量引用它们；`prompt-lab/` 这个第二可运行程序同样不在 §3 清单内（§6.3 有其实质描述）；§3 的 `main.js` 行称"IPC 注册（50+ 通道）"而实测 159、`db.js` 行称"17 张表"而实测 27。§4.2 的接口清单缺 M15 材料导图条目（且第 23–24 项整行重复了一遍）。完整可复算清单见 `docs-vs-code-vs-model.md` §1。

## 8. 视图与阅读顺序

| 视图 | 回答什么 | 给谁 |
| --- | --- | --- |
| `L0` 系统全景 | 谁在用、边界在哪、外部依赖真有三条 | 新人 / 对外 |
| `L1` 系统上下文 | local-first 的出网主张 + 两条未验证残留 | 对外 / 决策 |
| `L2` 容器 | 谁能写库、谁能出网、两个窗口的能力差 | AI 改码前必读 |
| `L3-main` | 主进程各子系统的作者归属 | 定位改动落点 |
| `L3-renderer` | 跨进程面、防腐层、渲染层算法所有权 | 定位改动落点 |
| `module-map.dot` | 写入归属与耦合热点的稠密图（C4 装不下） | 决策复盘 |
| `showcase.html` | 上面这些的一张可读图 | 对外展示 |

用 Qoder 的 Structurizr DSL 查看器打开 `system-model.structurizr.dsl` 即可看前五个视图；`showcase.html` 直接双击。
