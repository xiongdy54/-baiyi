# 一站式渐进阅读学习软件 — AI 开发指导文档（v28，M6-2 修订：PDF 原生阅读 pdf.js 直读 + 页码锚点）

> 本文档是后续所有开发的唯一依据。AI 在任何一次迭代中，必须严格按本文锁定的技术方案和接口实现，不得擅自更换技术栈、引入云端依赖、一次性做多个功能。
> 核心原则：**纯本地软件 / 最大灵活性 / 每次只实现一个最小单元 / 需求可变**。
>
> **文档结构导读（v13）：** 全文按六个关注域组织——
> **第一部分 Architecture（架构）**：技术栈、进程与模块、数据模型、接口抽象、AI 管线、FSRS 调度契约、Learner Knowledge Model 架构（v24：§4.5–§4.13）、插件体系（§4.14）。
> **第二部分 Design System（设计系统）**：瑞士风基线、Token、顶栏导航、页面排版、组件规范、皮肤体系。
> **第三部分 Product Spec（产品规格）**：核心用户流程、已实现功能规格、AI 制卡与助读体系（含提示词锁定基线与质检规则）、Topic 队列。
> **第四部分 Coding Rules（编码规则）**：硬性约束、数据完整性、测试义务、提示词/配置管理、安全。
> **第五部分 Decisions（决策记录）**：关键决策日志与已接受偏差。
> **第六部分 Roadmap（路线图）**：主线批次 M1–M11（v14 重排；v17 按用户构想增补 M8 日记与 AI 洞察，接下来开发的主线）、主线状态表、历史阶段存档、可选更新池与技术债。
> 历史变更记录（v6 起）压缩至第五部分 8.3。
---

# 第一部分 Architecture（架构）

## 1. 全局原则（最高优先级）

1. **纯本地优先（Local-first）：** 核心功能（书架、阅读、摘录、制卡、FSRS 复习）在无网络、无账号下 100% 可用。所有网络功能（AI 服务、MinerU 云解析、Z-library/Anna、视频、AI 总结）都是可选 Provider，可开关、可缺失，不阻塞启动。
2. **为未来账户功能留位，现在不做：** 所有数据表带 `userId / updatedAt / syncVersion / isDeleted` 字段（软删除）；将来加登录、云同步只新增实现类，不改业务代码。
3. **最大灵活性：** 一切可变的东西走接口 + 配置 + 插件槽，不写死（见 §4 接口清单）。
4. **最小单元迭代：** 每个 Phase / Phase X.Y 是独立可运行版本；AI 只做当前指定最小单元的 Goals，Non-Goals 碰都不碰。
5. **不引入重型后端：** 不起自建服务器、不要求 Docker、不要求 GPU。
6. **需求可变：** 阅读/摘录/推送流程必须走 `ReadingWorkflowProvider` 接口。需求变更时**先更新本文档（bump 版本号）再写代码**。
7. **AI 输出必须人工确认、可降级：** 所有 AI 输出一律先进草稿/预览区，经用户确认后才写入正式表；AI Provider 缺失时对应功能降级为手动操作。提示词一律走 `PromptTemplate` 版本表；AI 生成卡片不许绕过 `CardLintEngine` 直接入 FSRS 队列。
8. **知识三层分离（v24，最高不变量，设计稿 §72）：Knowledge Structure（知识之间如何关联）≠ Learner State（我掌握了什么）≠ Learning Recommendation（下一步学什么）。** AI 制卡只产出结构提案，知识状态只来自可审计学习证据，推荐只使用知识模型的派生视图——三层绝不互相冒充。
9. **知识状态可重算（v24，最高不变量，设计稿 §73）：** 所有 Learner Knowledge State 必须能从 `knowledge_evidence` + `review_logs` 原始证据按 `(modelVersion, parameterVersion)` 重新计算。禁止只存最终百分比，禁止把旧算法输出写死，禁止无证据直接写 mastery。
10. **AI 不是事实源（v24，最高不变量，设计稿 §74）：** AI 是知识结构提议者 + 候选排序器，不是数据库事实源。AI 推荐/洞察只能消费 Knowledge Model 的派生视图，不得自己重新定义用户知识状态；AI 推测的关系与判断必须标记 `source=AI-inference` + confidence，未经确认不得升级为用户事实。

## 2. 技术栈（v13 修订为实际落地状态）

| 层 | 选型 | 说明 |
|---|---|---|
| 桌面壳 | Electron 31 + Vite 6 | 无框窗口，`-webkit-app-region` 管理拖拽分区（顶栏 drag，按钮区 no-drag） |
| 语言 | TypeScript（严格模式） | 渲染层 TS；主进程为 CommonJS JS（db.js / ai.js / optimizer.js / prompts.js） |
| 前端 | React 18 + Vite | 状态管理为**纯 React state + 自研 EventBus**（12 个锁定事件名）。Zustand/TanStack Query 为原计划选型，实际未引入（决策 D2，见 5.2） |
| 本地数据库 | **sql.js（WASM SQLite）**，内存库 + 全量回写持久化 | 文件在 `%APPDATA%/incremental-reading-dev/library.db`。接口与 better-sqlite3 对齐，性能瓶颈出现时迁移（决策 D1，Roadmap 技术债） |
| 间隔重复调度 | `ts-fsrs` 5.4.2（FSRS-6.0） | 权重参数可由优化器替换（§7.7）；`enable_fuzz` 锁定 false |
| FSRS 优化器 | `fsrs-rs-nodejs`（NAPI 原生绑定） | Electron 主进程直载，从 review_logs 训练 21 维权重 |
| AI 网关 | OpenAI 兼容流式（主进程原生 https，SSE 解析） | 预设：Command Code GOAT / 智谱官方 / 本地 Ollama/LM Studio / 通用自定义；Key 经 safeStorage 按服务商加密存 `ai-config.json` |
| EPUB 导入 | `@likecoin/epub-ts` + turndown + DOMPurify | 封面提取、TOC 解析 |
| Markdown/公式渲染 | react-markdown + remark-math + rehype-katex | 复习卡与 AI 面板（阅读正文已由内核接管，见 D20） |
| 阅读内核 | **foliate-js**（vendor 固定快照，MIT） | `vendor/foliate-js/`+防腐层 `src/lib/reader/`；EPUB/MOBI/AZW3/FB2/CBZ；分页/滚动/对开；CFI 锚点；经 ReaderKernel 接口隔离，业务代码禁止直接依赖 |
| 合成书 | markdown-it + katex SSR + jszip | 粘贴书/摘录确定性合成 EPUB 进统一内核（§6.2） |
| 打包 | 未配置（`npx electron .` 直跑；生产模式加载 `dist/`） | **dist 存在则优先加载**（v12.2 决策 D6），electron-builder 待配置 |

## 3. 进程与模块结构（实际）

```
electron/            主进程（CommonJS）
  main.js            入口：窗口、IPC 注册（37+ 通道）、bookasset 协议、联网搜索
  db.js              sql.js 仓储层：9 张表、迁移、黄金查询
  ai.js              AI 网关：配置/加密/流式/模型列表/reasoning_effort
  optimizer.js       FSRS 参数优化器（fsrs-rs-nodejs 封装）
  prompts.js         10 个提示词模板（版本化播种，当前 v3）
  preload.js         contextBridge：settings/window/library/workflow/cards/
                     reading/stats/issues/batches/prompts/similarity/ai/optimizer API
src/                 渲染层（React + TS）
  App.tsx            视图路由（shelf/queue/review/browse/stats/reader/extractReader）+ 顶栏文字导航
  theme.css          全部 Design Token 与组件样式（瑞士风）
  components/        Bookshelf / QueueView / ReviewView（连续刷题）/ CardBrowser /
                     Reader / SettingsPanel / dashboard（统计）/ Dropdown /
                     OcclusionShapes（遮挡形状渲染，复习端+确认面板共用）/
                     reader（ReaderEngine + TocSidebar + ImageFocus 图片聚焦选区）
  lib/reader/        阅读内核防腐层（v20 D20）：kernel.ts（业务唯一依赖）/ service.ts（组合根）/
                     foliate/**（全仓库唯一 foliate-js 豁免目录：adapter/selection/appearance）/ testing/fakeKernel
  vendor/foliate-js/ foliate-js 冻结快照（MANIFEST.json 记 upstream commit/本地补丁/升级规程）
  lib/               fsrs（调度封装）/ cards（CardLint+cloze+AI 制卡）/ ai（网关客户端）/
                     occlusion（图片选区几何：像素↔百分比/包围盒/形状归一化/SVG 图元）/
                     readingWorkflow（SM19 Provider）/ library / settings / eventbus /
                     epub / stats / udc
  skins/             皮肤注册表（默认 + xiadown）
tests/fsrs/          FSRS 黄金参考回归套件（六件套，见 §4.4.6 / §7.3）
```

启动加载顺序（决策 D6）：`dist/index.html` 存在则 `loadFile` 直用；不存在（纯开发）才尝试 vite dev server。

## 4. 数据模型与接口抽象

### 4.1 数据表（10 张）

核心业务表带 `userId/updatedAt/syncVersion/isDeleted` 四件套，删除一律软删除：

- **users / library_items / documents / assets / extracts / cards / card_issues / ai_gen_batches / review_logs / fsrs_configs**（另有 review_skips）
- `cards.fsrs_json`：**全字段持久化** `{state,due,lapses,stability,difficulty,reps,lastReview,learningSteps}`（§4.4.1 契约）
- `cards.fsrs_config_id`（v23）：当前 FSRS 状态**最近一次因调度写入**所用参数配置（滚动语义，非出生标签；写入规则见 §4.4.9）
- `cards.occlusion_json`：图片挖空 `{rects:[{x,y,w,h,ord}], assetPath, shapes?:[{ord,kind:rect|ellipse|polygon, …}]}`（区域与形状均为相对图片百分比坐标；**rects 恒为形状包围盒**——旧渲染与 L11 校验的兼容层，shapes 为精确轮廓：rect 用 x/y/w/h、ellipse 用 cx/cy/rx/ry、polygon 用 points[{x,y}]；图片资产入 assets 表 kind=image-occlusion，v15 补齐生成链路，v25 补手绘选区形状）
- `cards.context_ref_json`：`{documentId, extractId?, anchorText?, anchorRatio?}`——跳转原文锚点
- （v16 移除 `cards.reverse_json`：翻转问答卡改为创建两张独立问答卡，见 D18；已建过该列的旧库残留列无碍，新库不再建列）
- `extracts.context_ref_json`：同上（v12.3 新增，含旧库迁移）
- `cards.leech_json`：`{isLeech, suspended, suspendedAt, resolution}`
- `review_logs.fsrs_before_json`（v22）：该次评分**前**的 FSRS 全字段快照（可空——旧日志与未传快照的调用为 NULL，不可撤销）。撤销评分的数据基础。
- `review_logs`（v23 增列）：`fsrs_after_json`（评分后全字段快照，Undo 一致性校验与审计用）、`leech_before_json`（评分前 leech_json 快照——撤销时**精确恢复**而非推断，F10）、`fsrs_config_id`（本次评分所用参数配置）、`fsrs_before_config_id`（评分前状态归属配置，撤销恢复用）、`review_seq`（全局插入序，唯一索引；排序不变量见 §4.4.9）
- `fsrs_configs`（v23，D22）：**不可变调度配置快照**——`{id, algorithm('FSRS'), algorithm_version(6，算法代际非 npm 包版本), weights_json(21 维), scheduler_options_json(完整调度参数), config_fingerprint(UNIQUE), source(default|optimizer|manual), created_at}`；只增不改，活跃项由 `settings.app.fsrsConfigId` 指针指定（§4.4.10）
- `prompt_templates`：版本化提示词（当前 v3，旧版留痕）

### 4.2 必须保留的接口/抽象（19 项，任何 Phase 不得绕过）

1. `EventBus`：唯一事实通道。锁定事件：`stats/updated, library/changed, todo/changed, pomodoro/tick, pomodoro/phaseChange, theme/changed, settings/changed, ai/stream, workflow/changed, cards/changed, ai/batchDone, leech/detected`
2. `CommandRegistry`：动作注册 `{id,title,when,keybinding}`（✅ M4 落地：`src/lib/commands.ts` + `src/lib/useCommands.ts`，§9.1 M4）
3. `SettingsStore`：三层 `app / theme / plugin.<id>`，settings.json 持久化
4. `PluginHost`：`load/unload/enable/disable + contributes`（规范见 §4.14，未实现）
5. `ParserProvider`：`submit → poll → {markdown, blocks[]}`（MinerU，未实现）
6. `EpubProvider`：`parseEpub → {metadata, toc, chaptersHtml}`（✅ epub.ts）
7. `AuthSessionProvider`：`startLogin/finishLogin/importBrowserCookies/getCookies`（未实现）
8. `LibrarySourceProvider`：Zlib/Anna/WebClipper/LocalFile/Epub 统一返回（Epub ✅，其余未实现）
9. `ReadingWorkflowProvider`：`nextTopic/postpone/setPriority/serializeState`（✅ sm19-default）
10. `VideoProvider`：Bilibili/YouTube（未实现）
11. `AIGateway`：`AIProvider{baseUrl,model,apiKey} + PromptTemplate registry + stream/cancel`（✅ ai.js + ai.ts）
12. `AudioProvider`：Moodist 内置 + 外链（未实现）
13. `StatusBarWidgetHost`：left/center/right 槽位（未实现；v12.1 顶栏改为文字导航）
14. `AccountSyncProvider`：现阶段 `LocalNoopAccount`
15. `UiAdapter`：外部 UI 代码 tokens 化适配
16. UI Slots：commandPalette / sidebarView / statusBarWidget / editorSlash / blockMenu / themeCSS
17. `CardGeneratorProvider`：`generateCards(sourceText, context, mode) → CardDraft[]`（✅ cards.ts）
18. `CardLintEngine`：`lint(cardDraft) → CardIssue[]`，纯本地，AI 卡与手动卡一视同仁（✅ L1-L14）
19. `SimilaritySearchProvider`：`findSimilar(cardText, k)`，本地 n-gram + 编辑距离（✅ 制卡查重警告）

### 4.3 AI 制卡执行架构

管线编排（明确**不采用内置 Agent**）：① 模式路由（detectMode 纯本地）→ ② 取提示词（PromptTemplate v3）→ ③ 上下文打包（材料+来源+已有卡+用户画像+联网背景）→ ④ LLM 流式生成（主进程，Key 不进渲染层，reasoning_content 经 thinking 信号转发）→ ⑤ JSON 解析容错 → ⑥ CardLint + 相似查重 → ⑦ 用户确认入库（AIGenBatch 留痕）。①②③⑤⑥ 渲染层毫秒级；④ 主进程；瓶颈在服务端（GLM 推理模型首字前思考 0.5-1 分钟，UI 以思考字数+秒数如实呈现）。

联网背景检索：blockReasons 非空时手动触发，Bing→DuckDuckGo→百度 回退，结果仅作理解上下文（禁止编造来源）。

### 4.4 FSRS 调度契约（硬性，v11 定；v20/v23 加固）

> **最高不变量（v23）**：同一份用户复习事实，不允许存在两套不同解释。调度事实=`cards.fsrs_json`；评分事实=`review_logs`（含 before/after 快照、config 归属、review_seq）；参数事实=`fsrs_configs` 不可变快照；时间事实=`reviewed_at`+`review_seq`；撤销事实=快照恢复。统计、优化器、审计、Undo 一律从这些事实推导，禁止各自再造解释。

1. **全量持久化**：`fsrs_json` 含 `{state,due,lapses,stability,difficulty,reps,lastReview,learningSteps}` 全字段（v20 补 `learningSteps`＝ts-fsrs 学习步进索引，F7 修复——缺失会使 learning 档第 2 步的 Good 永不毕业、在 10 分钟档死循环）且下轮全量回填；禁止部分字段序列化 + createEmptyCard 兜底（兜底仅限首次创建与历史缺字段基线回填）。`elapsed_days/scheduled_days` 无需持久化（v20 源码核对结论）：前者由 last_review 与复习时刻现场重算（ts-fsrs `AbstractScheduler.init`），后者调度器只写不读，均不影响调度。
2. **fuzz 锁定 false**：预览值即算法真实值。开 fuzz 须先改本文档。注记（v23）：**false 是产品策略（预览=落库+确定性测试+审计重放），不是 FSRS 算法正确性要求**。
3. **预览与调度同源**：preview() 一次算四档完整结果（含落库状态），评分复用；「所见=所存」是验收硬条件。preview/next 均支持可选 `now` 参数（v20，默认取真实时间，渲染层行为不变）——这是 M3 时间轴模拟的时间注入机制。**过期 preview 判废（v23）**：previews 携带源卡 fsrs 引用，评分提交时源不符则现场重算，禁止复用过期预览。
4. **复习后附加动作不得改 fsrs_json**：leech 标记走字段级 `leech_json` 更新（cards:updateLeech），禁止整卡快照回写。改卡内容先取库内最新状态合并。**撤销评分（v22）是「复习回退」而非附加动作**：将 fsrs_json 恢复为该次评分的 `fsrs_before_json` 快照（全字段含 learningSteps）并移除该条复习日志——不触碰预览=落库、fuzz=false 等调度语义，属于 Anki 式标准撤销。v23 起撤销不变量升级为 §4.4.9。
5. **到期队列**：due 升序、同 due priority 降序；复习视图 30s 轮询。
6. **回归测试义务**：调度相关改动合入前 `tests/fsrs/` 六件套全绿（L0 golden / L1 adapter / L1 补强 / L2 db / L4 audit / L5 simulate 时间轴模拟（v23 增 S6 时间语义/S7 参数环境），§7.3）+ undo 套件 + persist 边界套件（v23）。
7. **参数优化器**：`fsrs-rs-nodejs` 从 review_logs 训练 21 维权重；无效样本过滤（单次复习卡/全同日卡/无跨天间隔前缀，防 Rust panic；v20/F8 补：`evaluate` 评估子集须 ≥2 条复习且末条 delta_t>0——学习/重学步同日恢复收尾的样本 evaluate 拒绝，训练不受影响，评估取可评估子集、无可用子集时指标为 null）；训练/应用/重置经 `fsrs_configs` 不可变快照 + `settings.app.fsrsConfigId` 指针（§4.4.10），delta_t 由 canonical 函数构建（§4.4.8）；手动触发；失败返回 `{ok:false}` 不阻塞调度。
8. **时间语义（v23，三概念严格分离）**：① **调度 elapsed_days**＝ts-fsrs 内部 UTC 日历日差（库内部实现，不可注入日切点）；② **优化器 delta_t**＝`calculateFsrsDeltaT(prev, cur)`（electron/fsrsTime.js 唯一出口，独立实现 UTC 日历日差，**不 import ts-fsrs**），是「锁定版本 ts-fsrs 5.4.2 时间语义的复刻，非 FSRS 永久规范」——依赖升级致 L6-A 红灯＝时间语义变更触发重新审计（预期行为非缺陷）；③ **产品学习日**＝`settings.app.dayCutoffHour`（本地钟面 0-23，默认 0；用户钦定凌晨切点习惯，D23），**仅统计口径**（今日/热力/日聚合/月内分组），禁止进入 FSRS 调度与训练。①②同语义是本项目工程不变量（非 FSRS 规范要求），oracle=ts-fsrs `repeat()` 返回的 ReviewLog.elapsed_days 行为级对照（L6-A）。学习日（本地切点）与 FSRS 语义在本地凌晨时段的统计口径差＝产品语义选择（§8.2）。
9. **原子提交、持久化边界与 Undo 不变量（v23）**：saveReview/undoLastReview 必须 BEGIN/COMMIT 事务，COMMIT 后才 persist；**review 成功边界 = SQLite COMMIT + persist 成功 + IPC 成功**（三者齐才算成功）；措辞精度：这是**崩溃一致性**而非跨内存库与文件系统的 ACID——「review 在 SQLite 内原子提交；持久化采用原子文件替换；二者之间若进程崩溃，回退到上一次完整持久化版本，不允许产生部分/不一致的持久化数据库」。persist＝同目录 tmp + fsyncSync + renameSync 原子替换（Windows REPLACE_EXISTING），失败 throw→IPC reject→UI 错误横幅＋停留当前卡＋评分/跳过/删除封锁＋「重试保存」（`persistNow`＝**纯持久化重试，绝不重新执行任何业务 mutation**）；禁止静默降级、禁止自动 rollback 已 COMMIT 事务；全库快照自愈：任一后续成功 persist 补齐失败窗口期全部内存变更（窗口内崩溃＝丢窗口变更但一致）；启动时残留 `library.db.tmp` 一律删除（tmp 永远不是事实源）。**UndoableReview 不变量**＝review_seq 最新插入序 ∧ 有 before+after 快照 ∧ 卡当前 fsrs 与 `fsrs_after_json` **8 字段全等**（state/due/lapses/stability/difficulty/reps/lastReview/learningSteps，引用 §4.4.1）∧ 无 after 的旧日志（v22 及以前）不可撤销；leech 回退＝恢复 `leech_before_json` 确切前置状态＋关闭本次 LEECH issue，禁止以「当前 suspended」推断；config 恢复查 `fsrs_before_config_id`；**排序不变量＝review_seq**（表内唯一、按插入序单调递增、撤销删除后序号允许复用——seq 是排序非身份，身份=id；禁止按 id/reviewed_at 排序）。**config_id 写入规则**：createCard✅ / 评分✅ / 重置 FSRS 状态✅ / 编辑内容·挂起·恢复·改优先级❌ / resolveLeech 仅 reset 路径✅。
10. **参数环境（v23，D22）**：`fsrs_configs`＝不可变调度配置快照（结构见 §4.1）——**所有影响 FSRS 调度结果的 option 必须入 scheduler_options_json**（新增 option 漏快照＝契约违规）；禁止 UPDATE（db.js 不提供更新 API）；同一配置（config_fingerprint 唯一）永远只有一个 config_id；切换＝移动 `settings.app.fsrsConfigId` 指针（指针非配置本体，事实源=fsrs_configs）；reset＝指针回 cfg-default（普通不可变行，业务逻辑禁止特判，seed/migration 除外）；apply 相同配置按指纹去重重指；`cards.fsrs_config_id`＝当前状态最近一次因调度写入所用配置（滚动语义）；**应用新参数只影响未来调度，不回算任何存量卡片的 S/D/due/fsrs_config_id**；audit 按每条日志的 fsrs_config_id 分段构引擎重放（NULL→cfg-default）；`settings.app.fsrsWeights` 字段废除（存量迁移播种为 config 行后删除）；requestRetention 单一命名（对齐 ts-fsrs）；maximumInterval=36500 为产品选择非算法要求。
11. **模块边界（v23）**：运行时唯一直接 import ts-fsrs 的文件＝`src/lib/fsrs.ts`；优化器 delta_t 唯一出口＝`electron/fsrsTime.js`（独立实现，无库依赖）；业务组件禁止 import ts-fsrs、禁止自算调度或日期差。

### 4.5 Learner Knowledge Model 架构总览（v24，定稿；实现按 K0–K8 分批，§9.6）

> 来源：桌面设计稿《学习者知识模型与自适应学习系统设计稿》（LKM §0–§87 + Insight 增补 21 节）经本会话 8 问打磨 + 双轨调优 + 一键上传合并。本节只定架构与契约，**v24 不实现任何业务功能**（K0 纯设计，见 §9.6）。
>
> 长期循环：`阅读 → AI 识别知识结构 → Knowledge Graph → Learner Knowledge State → Learning Frontier → 下一步学习知识 → 材料匹配/AI 搜索 → 阅读/制卡/复习 → 新证据 → 状态持续更新`；第二通道 `日记 → 现实问题/需求信号 → 知识缺口 → Frontier`（M8 联动）。产品最终回答的不是"AI 觉得用户会什么"，而是"根据知识结构 + 真实长期证据，用户掌握各知识的概率有多大、下一步什么知识学习价值最高且处于可吸收挑战范围内"。
>
> 理论取位：BKT 作"隐藏状态须由行为证据持续推断"的思想与可解释概率推断基础，不照搬经典 BKT 四参数；DKT 现阶段不用作核心（Local-first、单用户初期数据不足、可解释与审计要求），浅层可解释 Bayesian/BKT-inspired（BEMM）优先，未来预测模型只作辅助不取代事实层。

### 4.6 Knowledge Ontology（知识本体，v24）

1. **UDC 退位（设计稿 §4/§71）：** UDC 只保留为统计与粗粒度分类（`cards.domain` legacy 字段 + `getStatsOverview` 口径不变），**不再作为 Learner Knowledge Graph 的事实基础**。新事实模型＝Knowledge Domain + Knowledge Ontology 双层。
2. **Layer A Knowledge Domain（粗粒度领域）：** 只回答"大致属于什么大的学习领域"，用途限导航/统计/聚合/初步检索/AI 上下文压缩/推荐过滤。建 10–15 个稳定一级领域（候选：Mathematics / Natural Sciences / Computer Science / Engineering & Technology / Medicine & Health / Social Sciences / Economics & Business / Law & Politics / Humanities / Language & Linguistics / Arts & Design / Education / Philosophy & Religion / Geography & Environment / Interdisciplinary）。二级、三级只在必要时建。一级领域不是图谱节点主体。
3. **Layer B KnowledgePoint 一等实体（设计稿 §6）：** `knowledgePointId` 从制卡批次字符串升级为独立实体——**知识点不属于任何一张卡也不属于任何一本书，卡/材料/日记只是知识点的证据与载体**。字段：`id（本地稳定主键）/ userId / canonicalLabel / description / domainId / parentKnowledgePointId? / status(active|merged|deprecated) / alias[] / languageVariants[] / confidence / metadataJson / createdAt / updatedAt / isDeleted`。`canonicalLabel` 非唯一事实，必须配 alias；外部 ID（Wikidata Q-ID / Wikipedia URL / ISBN/DOI 等）只作 grounding，放 `knowledge_external_refs`，不是事实源。
4. **Knowledge Relation（设计稿 §7）：** 第一阶段 8 种 `relationType` 封闭枚举：`prerequisite / part_of / related_to / contrasts_with / example_of / application_of / generalization_of / specialization_of`。字段：`id / fromKnowledgePointId / toKnowledgePointId / relationType / confidence / source(AI|user|imported|inferred) / sourceRef? / createdAt / updatedAt`。唯一约束 `(from, to, relationType)`；**prerequisite 边必须无环**（KnowledgeLint K3），自循环一律 error。`source=AI-inference` 未经确认不得冒充用户事实。
5. **AI metadata 封闭化（打磨 Q1，设计稿 §9–§10 收紧）：** AI 不得自由写 0–1 浮点"感觉值"。`novelty` 只许 `known|adjacent|new|uncertain` 四选一（是"相对于现有知识模型的位置判断"，不是掌握状态）；`estimatedDifficulty / learningDistance / aiConfidence` 只许写 **1–5 档序数 + 判定锚语 + 引用的原文 span/已有 KP evidence**，连续 0–1 只由本地版本化映射函数算出；`requiredPrerequisites` 是候选集合，须按 confidence/既有图谱/后续证据逐步验证；`domain` 沿用受控清单 ≤2 个。无 evidence 的 metadata 本地降级为 `uncertain`。
6. **AI 输出契约：** 制卡 JSON 保留 `{knowledgePoints, blockReasons, cards[]}` 并扩展 `knowledgeMeta{novelty, conceptualDepth, estimatedDifficulty档, requiredPrerequisites[], learningDistance档, aiConfidence档}`；**全部 AI 提案先进 `knowledge_proposals` 暂存表**（§1.7 草稿纪律），经用户确认或高置信规则确认后才入 `knowledge_points/relations` 正式表。换模型漂移用 prompt-lab"同材料 × N 模型"离散度测试守门（`novelty/relationType` 不一致率超阈则收紧锚语或降档使用）。
7. **建图策略＝混合式（打磨 Q3）：** 小而稳的 Domain 主干 seed（只定"我是谁的上一级"）+ 新材料导入时增量发现（parse → AI 抽 KP/关系候选 → 本地 n-gram 归一建议合并 → 确认/高置信自动合并）。**禁止纯现场建图**（ID 不稳定则证据无法累积、Beta 永为 cold start）。归一器第一版复用 `findSimilarCards` 的 n-gram 思路（同 Domain 内 label 相似 + 前置重叠），合并＝软删除 + 别名指向，可回滚、可重算。
8. **Knowledge Merge 生命周期（设计稿 §58–§59）：** `active / merged / deprecated`；AI 可提议合并，用户不必逐条处理；高置信自动合并，低置信留候选关系；不只依赖字符串匹配。

### 4.7 Knowledge Evidence 与 BEMM（v24，设计稿 §11–§21 收紧）

1. **FSRS 管记忆、LKM 管能力（设计稿 §13/§53）：** `FSRS = Card-level memory state`（这张卡记得怎么样），`LKM = Concept-level competency state`（这个知识点整体掌握到什么程度）。单卡 stability 高只证明该卡信息保持好，**不得直接断言 KnowledgePoint mastered**。四问分离：这张卡何时复习 / 用户懂什么概念 / 下一步学什么 / 用什么材料——各由 FSRS / LKM / Frontier / Material 模型回答。
2. **五维状态（设计稿 §11–§12）：** 每 KP 每维度一个 Beta 后验 `Mastery ~ Beta(α,β)`，`estimate=α/(α+β)`，同时存 `confidence + evidenceCount + lastEvidenceAt`。五维：`recognition（识别判断）/ recall（无提示主动回忆，主源 QA/Cloze/FSRS）/ conceptualUnderstanding（关系机制，主源 why/how·解释·对比·因果卡）/ application（解决实际问题，禁由纯背诵卡推断）/ transfer（迁移新情境，最高层证据）`。存 `(alpha,beta)` 全量，**禁只存百分比**；UI 显示 `developing / functional / strong / uncertain` 四态，算法用连续值。
3. **知识状态持续演化、无永久标签（§20–§21）：** 长期无证据 → confidence 下降 → 回 `uncertain`；**禁简单复制 FSRS 遗忘曲线**（FSRS 管记忆项目，mastery 是高层能力估计，半衰期独立参数化）。
4. **BEMM v1（设计稿 §14）：** 第一阶段用项目自研 Bayesian Evidence Mastery Model（BKT 思想 + 连续状态 + 多维 evidence），不是经典 BKT。输出形如 `estimate=0.73, confidence=0.81, evidence=18`——同 estimate 下 evidence=2 与 30 完全不同，Frontier 必须同时看 estimate 与 confidence（§15）。
5. **证据权重矩阵＝可配置 defaults（§16）：** Recognition/Cloze/QA/Explain/Application/Transfer 六行 × Recall/Understanding/Application/Transfer 四列初始值只作 v1 默认，**禁作科学常数**，全部进 `lkm_configs.params_json` 待校准。
6. **Review Evidence 投影（§17）：** Again/Hard/Good/Easy 先转 memory evidence，再按 `cardType + KP + review上下文 + FSRS 状态（stability/距上次时间/难度/是否提示/同质重复/跨卡泛化）` 投影到能力维度；**禁把 Good 直接等于 mastery 上涨**。防刷卡：`reliability = 基础权重 × reviewOutcomeStrength × itemSpecificity × independence`（§18）——连续同质卡全 Good 的 independence 打折；同 KP 上 recall+explain+application+transfer 均成功则 strength 极高。
7. **Bottleneck 聚合防刷满（§19）：** 总体分用短板聚合（如 min 或调和平均），禁简单平均——`understanding=0.84, application=0.42, transfer=0.20` 时总体不得 0.9。
8. **分层证据策略（打磨 Q2，否决强制周测）：** ① 日常复习投影（低权重）；② **dimension 探针卡**（复用 `application` 卡类型 + `dimension` 标签，新情境出题非原题重问，独立 `knowledge-probe` 模板经测试台播种；评分仍用四档，落库记高 independence 证据；探针卡本身是普通卡，独立 FSRS 状态，D18 合规）；③ **Frontier Check 按需触发**（仅 `recall/understanding ≥ functional` 且高层证据不足、`evidenceNeed` 高时提议 1 道应用/迁移小任务，可做可不做、不惩罚）。结果记 `probe_runs`，探针卡复习日志照常进 FSRS 并另派生一条 `knowledge_evidence(sourceId=probe_run_id)`。
9. **evidence 表（§44–§46）：** `knowledge_evidence` append-only：`id / knowledgePointId / sourceType(card_review|probe|application_task|reading|diary_signal|user_confirm|ai_inference) / sourceId（review_log_id 或 probe_run_id，只存引用不复制日志）/ dimension / outcome(0-1) / strength / reliability分解 / observedAt / modelVersion(LKM-vN) / parameterVersion / cardType+FSRS快照引用`。链路 `review_logs → Evidence Projection → knowledge_evidence → learner_knowledge_states`；FSRS 仍是唯一复习事实源（§4.4 最高不变量）；`ai_inference` 只作结构推断证据，禁冒充 mastery evidence。`card_knowledge_points` 允许多 KP 归属（主 KP 保留 + `secondaryKnowledgePointIds[]`）；拒收的卡不产生 evidence，接受的卡才建/链知识。
10. **重算能力（§47–§48）：** `knowledge evidence + model version` 可重算全部状态；算法结构变 bump `LKM-vN`，纯参数变 bump `parameterVersion`，双版本并行。

### 4.8 Learning Frontier（v24，设计稿 §22–§25）

1. **定义：** 与已掌握知识充分关联、前置基本满足、尚未充分掌握、挑战处于可吸收范围的知识候选集。是 `Ready enough + Novel enough + Connected enough + Challenging enough + Useful enough` 的交集，不是"最难的"也不是"最新的"。
2. **候选分：** `readiness（前置掌握）× novelty（未知度）× connectivity（与既有图谱连接，孤立新领域降权）× challengeFit × utility（目标/阅读史/日记/主题/用户选择/近期关注）× evidenceNeed（confidence 低则值得验证）`。
3. **Challenge Fit：** challenge＝内容难度 + 前置缺口 + novelty + 密度 + 抽象度 + 任务要求；能力＝前置 mastery + 近期表现 + 阅读理解证据；映射到 `comfortable / growth / stretch / too_hard` 四档（初始阈值可配，后续按表现自动校准）。**不用固定 i+1**。desirable difficulties 有边界条件，过高认知负荷损害学习。
4. **RL 延后（§64）：** 先解决"状态如何正确估计"，再谈策略优化。

### 4.9 Material Knowledge Profile 与推荐（v24，设计稿 §26–§32）

1. **材料画像：** 每份材料存 `knowledge coverage（KP→覆盖度）+ prerequisiteGap + conceptDensity + estimatedDifficulty + estimatedChallenge + completionStatus`；难度分解 `conceptualDifficulty / languageDifficulty / prerequisiteDifficulty / density / applicationDemand / transferDemand` 六维（语言学习场景下语言难与概念难可反向）。
2. **候选池：** 未读 + 阅读中 + 读完 + 摘录 + 用户导入（PDF/EPUB/TXT/Markdown/Word）+ 联网新材料。导入时走 profiling 管线（parse → 语义分析 → KP/关系抽取 → 难度估计 → 落库），推荐时直接查。
3. **两阶段推荐（禁每次全库扫）：** Stage A 本地候选生成（状态/完成度/难度/偏好/Frontier 快筛）；Stage B AI 只重排候选，输出 `reason / knowledgeCoverage / nextConcepts / expectedChallenge`。联网材料不得直成事实，须经 AI 分析 → 本地元数据 + 来源记录。
4. **推荐解释：** 展示可验证数据依据（已掌握 X / 当前 Frontier Y / 本书覆盖章节 / 新知识占比 / 预计挑战档 / 前置缺口），不展示模型隐藏推理链。排序长期演化（规则 → 贝叶斯校准 → 上下文排序 → bandit → 个性化序列），但候选事实永远来自本地 Knowledge Model。
5. **AI 上下文压缩（§61）：** 发给 AI 的不是全库，而是本地检索的 `当前材料 + Relevant Subgraph + Learner State 摘要 + Current Frontier + 相关材料 + 相关日记信号`。

### 4.10 Knowledge Graph 可视化与生成动画（v24，打磨 Q4，设计稿 §33–§35）

1. **图谱首先是检索引擎**（检索/路径规划/推荐/关联与缺口发现），视觉只是表现层。节点含 Material / Card / DiaryEntry / LearningSession，核心边 `part_of / related_to / introduced_by / reviewed_by / supported_by / mentioned_in / motivated_by`。
2. **Obsidian 式规格（K0 只定规格不实现）：** 2D canvas 力导图（非 3D），子图限流（默认 ≤200 节点，只画 Relevant Subgraph）；节点大小＝evidenceCount，颜色＝四态，边型＝relationType，边透明度＝confidence，`source=AI` 用虚线标非事实；点节点出证据链（KP → Cards/Extracts/Diary/Sources + estimate/confidence/evidence）。面板走瑞士风 Token。
3. **生长动画＝真实回放（K8 验收）：** 推荐/洞察管线 emit 阶段事件（扫描 N 节点 → 发现 M 缺口 → 筛出 K 可学 → 检查 X 份材料 → 推荐 Y），UI 按事件逐批淡入/连边生长；**禁无数据的假扫描动画**。同理 Insight Evidence Trail（概念信号 → 检索 → 图遍历 → 证据 → 竞争解释 → 组装）须由 `insight_runs` 真实计数字段驱动。

### 4.11 LKM 双轨调优（v24，打磨 Q5/Q7/Q8 + 开发者轨）

1. **共用底座（仿 D22）：** `lkm_configs{id, modelVersion(LKM-vN), parameterVersion, params_json(§4.7 的全部待校准参数：先验/权重矩阵/guess-slip/reliability/Bottleneck/Frontier 权重/挑战阈值/衰减半衰期), config_fingerprint UNIQUE, source(default|user_trained|dev_candidate), createdAt}` + `settings.app.lkmConfigId` 活跃指针。只增不改，切换只移指针，apply 指纹去重，reset 回默认，失败 `{ok:false}` 不阻塞复习。
2. **Track A 用户本地优化器（仿 optimizer.js 四步）：** `buildLkmTrainSet → train → evaluate(可评估子集) → apply/reset`；目标是**预测下一次同 KP 任务成功概率**（Brier/Calibration/AUC，§49–§50），禁拟合 mastery 本身；小数据用 Beta-Binomial MLE/网格搜索，纯 JS 本地算子，**禁复用 `fsrs-rs-nodejs`**（FSRS 专用）。主观感受不进目标函数。
3. **Track A 数据门（必须设门）：** 全局校准门 `knowledge_evidence ≥ 150 条 ∧ 覆盖 KP ≥ 20 ∧ 每 KP ≥ 3 条独立证据 ∧ 时间跨度 ≥ 21 天 ∧ application/transfer 探针 ≥ 10 条`，未达标按钮置灰并显示 `已积累 n/m`，用默认参数 + 全员 `uncertain` 宽 Beta；单 KP 永远可推断但证据不足只给低 confidence（Frontier 以 `evidenceNeed` 排成"待验证"）。训练输入同样过滤单证据/全同日/无跨天前缀（F8 教训）。
4. **Track B 开发者默认参数优化：** 主力＝仿真轨迹库（K3–K5 的 Good/Good/Again/Application/Transfer、同质刷卡、前置缺失序列）+ LKM 实验台旋钮（证据投影/Bottleneck/Frontier 六因子可调，跑同一批仿真比 Brier 与排序）+ 专家先验；辅力＝自愿匿名聚合（独立 `app.lkmCalibrationConsent`，默认关，与 telemetryConsent 分离；只收 `date / LKM 与参数版本 / evidence 与 KP 与探针计数 / Brier 分箱 / 接受率·读完率·挑战与反馈分布`，**禁 diary/cards 原文、禁 KP label 原文、禁 book title**）。无聚合数据照样发版（默认参数标注"基于仿真+先验"）。候选默认以 `dev_candidate` 行播种、小批本地前后对比验证后转正；结构变升 `LKM-vN`，纯参数变升 `parameterVersion`。
5. **用户感受位置（打磨 Q7）：** 客观校准（调 Beta/权重）只看下任务成功率；主观反馈（Insight `有用/部分有用/无关/不确定` + 竞争解释二选，推荐 `接受/打开/读完/放弃 + 挑战四档 + 有用度`）只调 `utility` 权重与 `challengeFit` 阈值，存 runs 表 feedback 字段；用户拒掉的解释永不再当事实。两者分开记、分开评，禁满意度污染能力估计。

### 4.12 LKM 与 FSRS 隔离边界（v24，打磨 Q6，硬性）

1. **读：** LKM 只读 `cards.fsrs_json`、`review_logs`（before/after/leech_before/config/review_seq 全套）、`cards.fsrs_config_id`；订阅 `COMMIT + persist + IPC` 成功之后事件，review 成功绝不等 LKM。
2. **写：** LKM 只写自有表 + `lkm_configs` 指针。**禁写 `fsrs_json / leech_json / fsrs_config_id / review_logs / priority / due`**；探针用独立 `probe_runs` 队列，不碰 due 队列与 30s 轮询。
3. **撤销联动：** `undoLastReview` 物理删日志后，派生 evidence 级联失效或标 stale 后台重算，绝不阻塞 undo 事务本身。
4. **回归：** 任何 LKM 相关改动合入前重跑 `tests/fsrs/` 六件套 + undo + persist；`src/lib/fsrs.ts` 唯一 import ts-fsrs、`electron/fsrsTime.js` 唯一算 delta_t 的边界（§4.4.11）保持不变。

### 4.13 Insight 与 Personal Meaning Graph（v24，设计稿增补 §1–§21）

1. **Insight 产品定义：** 不止找知识缺口，更帮用户发现未明确意识的思想/兴趣/价值/选择模式，用已学知识作解释框架。输出 `Hypothesis / Alternative Interpretation / Knowledge Connection / Question`，不定确定性结论。
2. **三层证据：** `FACT（Diary/Reading/Card/Review/Extract/反馈原文，AI 不得改）/ LEARNED（KP/关系/摘录/卡/书/来源，须可追溯）/ INFERENCE（AI 假设类比模式理论映射，须标推测）`。Insight 输出结构 `{observation[], knowledgeLinks[], interpretations[{claim, type=hypothesis, evidence[], confidence}], alternativeInterpretations[], questions[], uncertainties[]}`，每条解释须引 `knowledgePointId / extractId / cardId / documentId` 可点击证据链。
3. **Personal Meaning Graph：** 独立于 World Knowledge 与 Learner Knowledge 的第三张图，节点 Personal Concept/Preference/Value/Interest/Experience/Question/Choice；AI 只提议 Personal Concept（如 Discipline/Autonomy/Curiosity），用户可确认/拒绝/编辑/忽略，确认后才成事实。三图可跨图建边，禁合并。
4. **竞争解释与边界：** 涉价值观/倾向的 Insight 默认 ≥2 个竞争解释防确认偏误；心理/哲学解释只许 `could / one possible interpretation / consistent with / resembles`，禁下病理与人格断言。
5. **知识库四层与检索：** KP+关系 / 证据记忆（卡+摘录+复习+阅读）/ 个人思想记忆（日记+反馈）/ 来源记忆（书+文+档）；**禁全库直发 LLM**，走本地检索 → 相关 KP → 子图 → 相关卡/摘录 → 来源 → Evidence Package → LLM 合成；grounding 优先级用户自有材料 > 用户确认洞察 > 知识图谱 > 通用权威 > 模型先验，越靠后越标推测。
6. **反馈与升级：** 每条重要 Insight 记反馈；Insight 发现的新关系只进候选（`source=AI-inference`），确认后升级；暴露的缺口进 Frontier 再进推荐；推荐须区分 knowledge-driven 与 meaning-driven（后者由 Personal Meaning + Frontier 驱动）。三种 Insight（Knowledge/Self/Frontier）可组合但语义分离。

### 4.14 插件/主题体系（规范，未实现）

- 插件 = 文件夹 `plugins/<id>/`（plugin.json + main.js + styles.css + data.json）；`versions.json` 版本回落。
- 主题是特殊插件（type:theme）；`/* @settings */` YAML 声明可调项。
- 皮肤体系：内置 `src/skins/<id>/`；每套皮肤只改表现层；亮暗对比 ≥4.5:1；先规范后代码。

---

# 第二部分 Design System（设计系统）

## 5.1 瑞士风基线

唯一视觉规范：`docs/swiss-international-style.md`（Token、字号阶梯、灰阶、单一焦点色、直角无阴影、Lucide 图标、禁止清单、五项必查）。全局主 accent 锁定 IKB 蓝 `#002FA7`（深色提亮 `#5B7FE8`），用户可在设置中自定义（写 `--accent` 变量）。所有色值/字号/间距走 `src/theme.css` Token，业务组件禁止硬编码。

设计哲学七条：单一焦点色 / 极致字号对比（越大越细）/ 无衬线 / 直角纯色 / 8px 网格 / hairline 分割 / 克制。

## 5.2 顶栏与导航（v12.2 定，方案 A）

- 顶栏左侧**文字导航**：`书架 / 队列 / 复习 / 卡片 / 数据`，当前项 accent 色 + 2px 底线；常驻可见，点击切换视图。
- **无品牌字块**（「渐进阅读 INCREMENTAL READING」已删）；切换页面后顶栏以浅色小字显示当前位置（`topbar-title`，hairline 左分隔），不与导航高亮重复表达。
- 右侧仅设置齿轮 + 窗控三键。导航按钮 `no-drag` 可点；顶栏空白与标题区保持 `drag` 可拖窗口。
- **页内禁止重复导航文字**（如复习页不再出现「REVIEW 复习」大标题）；页内只保留右上角/左上角计数（`review-count`）。

## 5.3 页面排版规则（网格系统 + 极简）

- 内容版心 720px（长文单列测量宽），8px 基线，spacing Token `{4,8,12,16,24,32,48,64}`。
- 复习页：kicker/标题行已删；卡面正面/背面统一 **26px / 1.5 行高**（markdown 子元素 `font-size:inherit` 防回落），hairline 分隔问题与答案；左对齐非对称留白。
- 评分模块：4 等分 grid，min-height 56px；**四按钮样式统一**（灰底 + 左缘 4px 语义色条：Again 红 / Hard 黄 / Good 蓝 / Easy 绿），无填充差异；hover 统一 grey-2；键盘焦点环 2px accent。
- 设置页：左侧锚点导航 + 内容列；说明性文字只保留「操作必需」（Key 获取链接、数据门槛、当前状态），删除教程式长文。
- 文字规则（better-typography）：正文 1.5-1.7 行高、`text-wrap` 按角色、数字 tabular-nums、Meta ≥12px、正文 ≥14px。

## 5.4 组件规范

- **评分按钮**：语义只以色条表达（见上），数字用 mono + tabular-nums。
- **EditableText（内联编辑）**：React 不描述子节点的「裸壳」div（命令式写入 innerText），杜绝 contentEditable 与 React 共管 DOM 导致的 removeChild 崩溃与内容叠加；点击出光标、失焦落库、无任何框线；**正面点击=翻面，翻面后问题与答案区才可编辑**。
- **cloze 编辑回写**：问题区编辑的是显示文本（当前挖空为 `[…]`），落库时 `[…]` 自动还原为原挖空语法并同步 noteText；其他挖空若被改动则降级为普通文字（可接受）。
- 跳转链接：`跳转原文 →`（accent 色 Meta 档文字按钮，hover 下划线），出现于复习卡 meta 行、队列摘录条目与卡片浏览详情（仅带锚点数据时）。**跳转是「现场查看」语义（v19）**：跳转会话中阅读器不写阅读进度与阅读字数统计（App 对 jumpAnchor 会话不传 onProgress），切出后记录的位置仍是上次真实阅读位置，不会被跳转位置覆盖。
- **图片聚焦层（v25）**：全屏 fixed 覆盖层（`--z-toast - 1`），背景 `rgba(10,10,10,.55)` + `backdrop-filter: blur(10px)` 实现「周围区域模糊」；图片由原位置 FLIP 飞入居中（240ms `--ease`，reduced-motion 关闭过渡）；顶部居中悬浮工具条（paper 底 + hairline 边框 + `--shadow-float`），工具按钮选中态用 accent-soft 底 + accent 边框；选区图元统一走 `.occlusion-shape`（考察区 accent 填充、其余 ink 填充、预览 accent 描边，`vector-effect: non-scaling-stroke` 保描边不随百分比坐标系拉伸）；选区状态一律以**相对图片百分比**保存，仅在读取指针位置时做像素换算（`src/lib/occlusion.ts` 为唯一换算口）。
- **UDC 领域选择（v25，M5）**：chip（accent-soft 底 + accent 边框 + 主领域标「主」）+ 受控清单下拉（复用 `.dd` 直角下拉样式，`udc-menu` 限高滚动），上限 2（`UDC_MAX`）。

## 5.5 皮肤体系

默认皮肤 = 瑞士风（`skinId:"none"` 即基线本体）；已注册 xiadown 玻璃拟态为第二皮肤（表现层覆盖，不影响业务逻辑）。新皮肤按 §4.14 规范另立，先规范后代码。

---

# 第三部分 Product Spec（产品规格）

## 6.1 核心用户流程

书架（粘贴/EPUB 成书）→ 阅读器（选中文字 → 手动制卡 / AI 制卡 / AI 解释 / 摘录；制卡与摘录**记录选区锚点**）→ 学习队列（摘录 Topic，推迟/打开/跳原文）→ **连续刷题复习**（自动出下一张、评分四按钮、跳过/标记暂停/删除、跳转原文并可返回恢复现场、双面内联编辑）→ 卡片浏览（Anki 式全量表格 + 行维护 + Leech 六步处理）。设置：主题/皮肤/强调色/AI 服务（4 预设+思考强度）/FSRS 优化/统计仪表盘/备份与恢复/快捷键。

## 6.2 已实现功能规格（v12.4 状态）

- **书架**：粘贴成书、EPUB 导入（封面/TOC）、上次阅读位置、删除（软删）。
- **阅读器（v20 阅读内核，D20「一切皆书」）**：文件书（EPUB/MOBI/AZW3/FB2/CBZ）由 vendor foliate-js 渲染；粘贴书导入时**确定性合成 EPUB**（markdown-it→HTML、一级标题章节化、KaTeX 服务端渲染自包含内嵌；存量粘贴书首开惰性合成）；摘录打开时合成为单章 EPUB 进同一内核（无 markdown 阅读边界；摘录不落进度/统计）。react-markdown 退出阅读路径（仅 AI 面板回答）。能力：**目录侧栏**（book.toc 层级树+当前章高亮+点击跳转）、**阅读模式**（滚动/分页/双页对开）与**翻页交互**（‹›按钮、←→/PageUp/PageDown/空格键、分页模式左右点击热区；分页滚轮=翻页，滚动模式章尾续滚自动进下一章/章首回上一章——vendor 补丁 paginator wheelTurn，跨章节由 #turnPage 处理）、**外观**（纸白/羊皮/暗夜/自定义背景文字色、字号、字体；快捷控件与设置页「阅读」区块同读写 `settings.app.readerSettings`）、**链接**（内链内核 CFI 精确跳转；外链 adapter 拦截→`shell:openExternal` 仅 http/https）、**选区服务**（引擎 iframe 选区→既有制卡/AI 解释/摘录/图片挖空菜单全链路不变）、**进度**（progressJson 扩展 `{cfi,fraction,ratio,lastText,readerEngineVersion}`，恢复优先 CFI）。
  - **锚点体系（可降级恢复）**：制卡/摘录 contextRef.locator = cfi（结构级，绑定特定 EPUB 结构非永久 ID）+ chapterIndex（章节兜底）+ anchorText（文本终极兜底）+ readerEngineVersion（回归归因）。恢复链：CFI→章节+文本→全文搜索→人工提示。存量纯文本锚卡经 search 定位。
  - **主进程导航防护**：`will-navigate` 仅放行同页刷新（复习页「刷新」），其余页面级导航一律拦截；`setWindowOpenHandler` 拒绝开窗、http(s) 交系统浏览器；外链 IPC `shell:openExternal` 仅允许 http/https。
  - 选中操作菜单、AI 解释侧栏、AI 制卡面板、图片挖空、递进补卡、材料类型路由（§6.3）在内核视图下行为不变。
  - **正文图片点选聚焦与形状选区（v25，M5 批次）**：点击正文图片 → 图片上浮居中、周围区域模糊（backdrop-filter）聚焦视线；顶部居中悬浮工具条提供**三类区域选区**（矩形拖动 / 圆形（椭圆）从圆心拖出 / 多点连线多边形——逐点点击连线、≥3 点后点回起点闭合）与提交动作（AI 制卡 / 手动制卡）；**点击模糊区域退出聚焦**（Esc 先清选区、无选区时退出）。选区坐标以相对图片百分比保存；AI 提交时把选区裁剪图交 GLM 识别内容，**遮挡区域恒取用户选区**（模型看到的是裁剪图，其坐标属裁剪坐标系，禁止写进 occlusion_json）；手动提交进入「手动制卡」弹窗的图片挖空页签（M5 字段集）。图片字节经 `assets:saveImage` 落盘入 assets 表（无需文件对话框）。
  - **递进补卡（v16）**：AI 制卡结果的知识点摘要含「（后续可补：…）」注记时（v4 候选 G8 产出，`parseFollowUps` 解析），逐项渲染「询问 AI 相关内容」「直接制卡」；询问 AI 的解释追加在面板最下方且解释末尾也带「直接制卡」；直接制卡以原选文为材料 +「本次制卡重点」指令 + 已有卡清单（防重复）生成 1-3 张补充卡，**追加到卡片清单末尾**（带「补充」徽标），已有卡始终在上；所有卡沿用同一次选区锚点（跳转原文同一位置）。补充制卡指令经请求装配注入（context.focus），提示词模板不变。
- **四种核心卡形式（v16 修订，M1.1）**：挖空（cloze 契约不变）/ 问答（qa）/ **翻转问答（制卡手段，非卡类型：创建时拆为两张互为翻转的独立 qa 卡）**/ **图片挖空（imageOcclusion，GLM 多模态识别遮挡区域生成）**；既有 application/mnemonic/seq/formula 类型保留。
- **手动制卡（M5，v25 与 AI 制卡同构）**：四类型页签（问答 / 翻转问答 / 填空题 / 图片挖空）+ UDC 领域标签（≤2，对齐 R17）+ contextPrefix / 助记 / 知识点分组 / 日期标记（规则19）+ 优先级；入口三类——选区菜单「制卡」（文本）、快捷键 Ctrl+Z、**图片聚焦工具条「手动制卡」（图片挖空页签预填选区）**；一律过 CardLintEngine 并做 S1 相似检索。
  - 翻转问答（D18）：**不存在复习期形态变化的卡片类型**——手动制卡「翻转问答」页签与 AI 面板「转翻转卡」按钮都产出/拆分出两张互为翻转的独立问答卡，各自拥有独立 FSRS 调度状态；B 面留空时自动正反互换。
  - 图片挖空：阅读器选区菜单「图片挖空」→ 选本地图片 → 落盘 assets/ + 入 assets 表 → dataURL 交 GLM 多模态（card-occlusion 模板）→ 返回 regions（百分比坐标，渲染端钳制 0-100）→ 确认面板图上叠加预览、逐区域接受（每区域一张卡，共享同一 occlusionJson，cardOrd=区域序号）；**v25 起正文图片另有正交入口**：点击正文图片进入聚焦 → 手绘选区（矩形/圆形/多点连线多边形）→ AI 制卡（裁剪图交模型识别内容、遮挡区域取用户选区）或手动制卡；既**不做既有卡片的遮挡区域编辑器**（D16 保持）**也不做整图手动遮挡编辑器**。**复习端展示规范（v16-c，用户钦定）**：正面 = 原始图片 + 主题色遮挡块（考察区域 accent 色、其余区域 ink 色）；答案面 = 原始图片（无任何遮挡覆盖）+ 答案文本。测试台结果面板同规范渲染（图片+遮挡块+显示答案切换）。v25：遮挡块按 shapes 精确渲染（矩形/椭圆/多边形，SVG 百分比坐标系 + non-scaling-stroke），无 shapes 的存量卡回退 rects 矩形。
- **学习队列**：due 摘录列表（priority 升序）、推迟（×1.6 占位）、打开摘录阅读（嵌套摘录）、跳转原文（带锚点条目）。- **连续复习**：进入即开始；每张卡实时取 due 队首（FSRS due 升序）；评分四按钮（预览=落库，§7.3）；自动下一张；本轮计数；跳过（due+10min，不写 log）；标记并暂停；**删除**（确认后软删，自动下一张）；**跳转原文**（保存现场→阅读器锚点定位+高亮→返回恢复该卡与翻面状态）；内联编辑（翻面后问题+答案皆可，cloze 语法自动回填）；leech 自动检测（lapses≥8 暂停+通知）；**撤销评分（v22）**：撤销最近一次可撤销的评分（快捷键 Z / 「撤销评分（X）」按钮，收尾页同样可用）——恢复该卡评分前 FSRS 快照、物理移除该条复习日志（训练输入与统计自动回到评分前）、若本次评分触发 leech 挂起则一并回退（解除挂起+关闭本次产生的 LEECH issue）；撤销后该卡回到当前位并展开背面，可立即重新评分；撤销不改变调度语义（§4.4.4）。
- **卡片浏览（v19 Anki 式改造）**：全量卡片表格（题面/类型/状态/到期/复习次数/遗忘次数/优先级/来源书名，listAllCards 补 docTitle JOIN）+ 搜索（题面/答案/前缀/来源/领域/标签）+ 类型/状态筛选（共享直角 Dropdown，类型项按库内实有动态生成）+ 排序（到期/创建/优先级/遗忘）+ 页签（全部卡片/到期卡片/记忆难点，到期与难点口径与 db.js listDueCards/listLeechCards 一致）。**行详情** = 卡面预览与内联编辑（复用复习 CardFace/EditableText，cloze 自动回填挖空语法）+ 元数据（含 FSRS 稳定度/难度）+ 质检问题（CardIssue）查看 + 操作：暂停/恢复调度、推迟 1/7 天、重置为新卡、删除（确认后软删）、跳转原文（returnTo=browse）、Leech 卡「六步处理」入口。评分调度仍在复习页，此处不写复习日志。
- **记忆难点**：Leech 六步向导（AI 诊断/补卡指引/换问法/删除降优先/推迟/助记 + 重置为新卡/恢复）。
- **统计数据**：仪表盘（学习热力/今日完成度/领域分布/评分构成等），UDC 领域分类，组件拖拽排列。（用户主导开发）
- **FSRS 优化器**：设置 → FSRS 优化；手动训练/应用/恢复默认（§7.7）。
- **启动**：单窗口防重入；dist 优先加载。

## 6.3 AI 辅助制卡与助读体系（v6 锁定，主体实现）

### 6.3.1 制卡原则知识库（单一事实来源）

制卡原则只存在于两处：`PromptTemplate` 的 card-* 族提示词（给 LLM）与 `CardLintEngine` 规则表（本地质检）。代码、组件、文档中不许散落第二份原则文本。scope 锁定：`card-generation / card-formula / card-seq / card-enum / card-mnemonic / card-contrast / card-wording / card-basic / card-occlusion（v15 新增，图片挖空）/ reader-explain / leech-rescue`。

### 6.3.2 AI 制卡主流程

入口：阅读器选中文本 → `AI 制卡`（也支持 AI 解释侧栏「就此制卡」）。七步管线见 §4.3。确认入库：逐张「接受/编辑/拒绝」或整批拒绝；落库带 contextRef（含锚点）/sourceRef/dateStamp/priority/knowledgePointId；超量制卡默认每知识点 2-4 张、单批上限 10；迭代制卡（补充制卡不重复已有 knowledgePoint）；手动制卡保留为降级路径，同样过 lint。

### 6.3.3 制卡提示词锁定基线（PromptTemplate 当前版本 v3）

基线组织为「理解检查 → 硬性规则 R1-R17 → 输出格式 → 禁止事项」，全文以 `electron/prompts.js` 的 v3 播种内容为唯一准绳（历史版本留痕于 prompt_templates 表）。核心规则摘要（完整文本见 prompts.js）：

- R1 不理解不学（blockReasons + 前置卡）；R2 最小信息（答案 ≤15 字）；R3 单义性；R4 禁是否题；R5 避免集合/枚举；R6 上下文前缀（前缀铁律：禁止泄漏答案）；R7 措辞最短；R8 双向多角度；R9 例子个性化；R10 联想已有卡；R11 来源与时间戳；R12 助记克制；**R13 挖空规范（v3 加 hint 禁令：`{{c1::答案}}` 禁用第三段 hint，禁止答案拆两半——正面曾泄漏半个答案）**；R14 优先级建议（基础 ≥70 / 一般 40-60 / 边缘 ≤30）；R15 应用/启明卡；R16 实体全名；R17 领域标注（UDC 受控清单，domain 字段 ≤2 个）。
- 输出严格 JSON：`{knowledgePoints, blockReasons, cards[{cardType, knowledgePointId, contextPrefix, front, back, cloze, example, mnemonic, sourceRef, dateStamp, prioritySuggestion, ruleNotes, warnings, domain}]}`。
- 修改提示词 = 播种新版本记录，不覆盖旧版（当前 v3：R13 hint 禁令 + R17 领域标注）。

### 6.3.4 CardLint 静态质检规则（对 AI 与手动卡一视同仁）

| ruleId | 检查内容 | severity |
|---|---|---|
| L1 | back 信息过载（>60 字 / >3 单元） | warn |
| L2 | 是否题 | warn |
| L3 | 集合型问法 | warn |
| L4 | 有序枚举 >5 项未拆解 | warn |
| L5 | 缺 contextPrefix | info |
| L6 | 缺 sourceRef | info |
| L7 | AI 标记的单义性问题 | warn |
| L8 | 孤儿卡（知识点下仅 1 张） | info |
| L9 | 单卡挖空 >2 处 | warn |
| L10 | front 过长（>80 字） | warn |
| L11 | imageOcclusion 卡缺 Asset | error |
| L12 | 易变内容缺 dateStamp | info |
| L13 | 前缀泄题 | warn |
| L14 | 实体全名疑似缩略 | warn |

severity 语义：error 阻止入库；warn 可选择接受；info 仅提示。所有 lint 结果写 CardIssue，卡片详情可查「违反了哪些原则」。另有 S1（相似卡警告）。

### 6.3.5 AI 阅读助手

选中文本 → `AI 解释` 侧栏流式回答（先直答再机制再联系上下文；追问：通俗解释/严格定义/举个例子/为什么）。回答下方动作：就此制卡（进 AI 制卡流程）。回答运行期显示思考/等待状态（思考字数 + 已等待秒数）。

（v12.2 起新增：解释侧栏与跳转原文、删除按钮等复习链路增强，见 6.2。原 §8.5「插入原文回写为 ai-supplement 块」仍为规划项，见 Roadmap。）

### 6.3.6 Leech 处理

lapses≥8 自动标记+暂停+CardIssue+通知；复习中「标记并暂停」一键；六步向导（诊断 AI / 补前置卡 / 重设问法 / 删除或降优先 / 推迟 / 助记）+「重置为新卡 / 仅恢复」；Leech 面板（卡片浏览页）。处理决议写 `leech.resolution`。

### 6.3.7 干扰检测

制卡时相似检索（n-gram），高分命中写 S1 警告提示可能干扰；对比卡生成走 card-contrast 模板（向导内指引）。

### 6.3.8 复习体验元规则

补进度不展示惩罚性大数字；每日上限可配（未实现，规划）；全局混编选项（规划）；Again 按钮措辞不带惩罚；卡片可标「不再关心」（规划）。

### 6.3.9 设计验收清单（问题-功能映射，节选核心）

20 条原则与补充文献的每个问题须有对应功能。关键项：不理解不学→blockReasons；最小信息→L1/R2；完形填空→cloze 语法；避免集合→card-enum；对抗干扰→相似检索+前缀；优化措辞→card-wording；提供来源→sourceRef；时间标记→dateStamp；优先级→priority；Leech→六步向导；锚点溯源→跳转原文（v12.2 起）。全表见历史版本 v12。

### 6.3.10 四卡形式 × 材料类型路由（v15 已实现）与提示词测试台

- **四种核心制卡/复习形式**：挖空 / 问答 / 翻转问答（reverse 双向卡，v15 新增）/ 图片挖空（v15 生成链路补齐）；既有 application/mnemonic/seq/formula 类型保留。遮挡卡 `occlusion_json`（rects+assetPath）结构与渲染沿用 Phase 16 预留，生成链路走 GLM 多模态（D16），不做手动遮挡编辑器。
- **材料类型路由（v15 已实现，本地规则先行）**：制卡入口先经 `detectMaterialType`（cards.ts，本地正则）识别材料类型，按下方映射表路由到 PromptTemplate 分支与默认卡形式组合；AI 面板展示识别结果并允许手动覆盖（下拉切换后可重跑）。
- **类型→原则→提示词→形式映射表（v15 默认版，待用户确认后锁定）**：

  | 材料类型 | 本地识别 | 路由 PromptTemplate | 默认卡形式 |
  |---|---|---|---|
  | concept 概念论述（默认兜底） | 其余全部 | card-generation | 问答（确认区可「转翻转卡」= 拆两张独立卡） |
  | formula 公式推导 | LaTeX/等式/运算符 | card-formula | 问答 |
  | sequence 流程背诵 | 步骤/流程/时间线/首先-然后-最后 | card-seq | 问答（seq 续写） |
  | enumeration 枚举清单 | 列出/有哪些/顿号列举 | card-enum | 挖空 |
  | image 图片材料 | 制卡入口选图 / 正文图片点选（v25） | card-occlusion | 图片挖空 |
  | literature 文学/诗歌背诵（v16） | 本地识别：词牌/诗体标识、《篇名》标题、行密度/短句密度（verseSignals；v16-c 扩展近体诗定长行与现代自由诗、标记兜底放宽长行） | card-literature（v1 暂由 card-seq 模板承接；v4 专用模板经实测后播种 v2） | 问答（seq 续写逐句全覆盖 + 措辞/观察卡；contextPrefix=「文体·篇名:」类别标识） |

  材料类型识别是**确定性本地函数**（同一文本必然同一结果，与提示词无关）；识别不确定时由 AI 面板的类型选单手动覆盖，**选单选择按书记忆**（v16：`settings.app.materialTypes` 以 itemId/documentId 为键，同书再次制卡自动沿用用户上次选择，首次制卡即生效）。

  （词汇/单词类材料 → 建议 M7 词典批次；代码/编程类 → 候选新类型待用户表态；详见 `docs/M1-prompt-coverage-report.md` §三-C、§四）
- **提示词测试台（独立最小软件，v15 已建成；v16 候选补丁就绪）与调优闭环（用户钦定）**：`prompt-lab/`（独立 Electron 应用，复用主软件 `ai.js` 网关与 `prompts.js` 基线、esbuild 打包 `cards.ts` 的路由/JSON 容错/Lint 纯函数为 vendor bundle；**必须经 `npx electron prompt-lab` 或根目录 `启动提示词测试台.bat` 启动，浏览器直开 index.html 无本机接口**）。闭环：**AI 按用户要求修改测试台内的提示词/流程 → 用户在测试台手动实测（文字/图片材料）→ 用户反馈测试结果 → 决定是否并回主软件**；并回时提示词播种新版本（旧版留痕）。测试台配置与提示词编辑存独立 userData（`%APPDATA%/prompt-lab/`），不写回主软件；主软件内不做提示词调优试验。
- **v4 候选补丁（v16，待用户实测）**：`prompt-lab/prompts-draft.js` 按覆盖核对报告实现 G1-G9（R3 精准性/一致性双维、输出前自检段、R8 五视角、公式地标双卡强制+边界三问、R18 数字克制、R19 观点归属、等价答案宽容与部分枚举合格线、首轮克制多轮递进、退出红线）+ **card-literature 文学/诗歌背诵候选**（续写骨架**逐句全覆盖**/开头优先/措辞选择卡/原文改进卡/高层次观察卡/放过标点/名言署名，研究依据见报告 §四、§4.4）；G10 挖空 ≤2 处维持（用户拍板）、G11 词汇归 M7（用户拍板）、G12 进可选池。实测确认改善后才并回主软件播种 v4。**v16-b（雨霖铃实测反馈修复）**：detectMaterialType 加诗词启发式 verseSignals（原仅三类正则致诗词落概念兜底）；extractJson 括号平衡扫描（模型 JSON 后附说明文字曾致「Unexpected non-whitespace character」解析失败）；文学候选 L1 整篇背诵逐句全覆盖（一句一卡成链，优先于首轮克制）——真实验证：自动路由 card-literature、9 张续写卡覆盖全篇+6 张理解卡。
- **提示词覆盖核对（v15 已完成，只报告不改）**：逐条核对结论与 14 项缺口（G1-G14）、CardLint 缺口（L-A/L-B/L-C）、处置建议见 `docs/M1-prompt-coverage-report.md`；**任何一项的增改须经用户确认后走测试台验证 → 播种新版本**。

### 6.3.11 LKM 专用 PromptTemplate 分支（v24 规范，K2 起按需播种）

- **禁把知识模型职责塞进 `card-generation`（设计稿 §55–§56）：** 制卡提示词只管制卡。LKM 新增 5 个独立 scope，各自版本化播种、各自走测试台验证：`knowledge-extraction`（KP 抽取：label/description/domain/封闭档位 + evidence span）/ `knowledge-relation`（关系抽取：8 种 relationType 封闭枚举 + 置信档 + 依据）/ `material-difficulty`（材料六维难度档位估计 + 覆盖 KP 候选）/ `knowledge-probe`（dimension 探针卡：新情境出题，沿用四档评分心智，输出带 `dimension` 标签）/ `frontier-explain`（推荐解释：只组织已验证数据依据，禁编造扫描数字）。
- 每个 LKM 模板必须含判定锚语（什么条件下写哪一档）+ evidence 引用要求（无 evidence 降级 `uncertain`）+ 封闭选项清单（写法照抄 R17 UDC 清单注入方式）。

### 6.3.12 KnowledgeLint（v24 规范，独立于 CardLint，设计稿 §57）

| ruleId | 检查内容 | severity |
|---|---|---|
| K2 | prerequisite 自循环 / 环（A 是 B 的前置且 B 是 A 的前置） | error |
| K3 | relation 自循环（from == to） | error |
| K4 | domain 不在受控清单 / KP 与卡 domain 不一致 | warn |
| K5 | AI relation confidence 低于阈值（进候选池，不进正式表） | info |
| K6 | knowledgePoint 疑似重复（归一器提议合并） | warn |
| K7 | concept 过宽（覆盖面过大，建议拆分） | info |
| K8 | concept 过窄（单例孤立，建议合并或挂靠） | info |

severity 语义与 CardLint 对齐：error 阻止入正式表；warn 可选择接受；info 仅提示。KnowledgeLint 只校验知识结构，不碰 FSRS 调度字段。

## 6.4 Topic 队列优先级、推迟与下一条摘录推荐（v24 增补 Next Extract，用户已确认五项）

摘录默认 priority 50；推迟固定 ×1.6 封顶 180 天（占位）；负载感知推迟（priority 三档基础间隔 + dueLoad 分散 + postponeCount 抖动 + 上限 180 天）为设计承诺，已降级可选更新池（§9.4），替换时点未排期。

### 6.4.1 下一条摘录推荐（Next Extract，v24 规范，K4–K5 落地，一步到位）

- **定位：** Frontier 的首选落点是摘录而非整本书。摘录是用户亲手搁置的最小未理解单元（暂时不理解、等前置补上再学），与 SuperMemo Extract / Priority Queue 同构：先分散摘出、排队、前置补上后回头消化。从 KP 到摘录是一跳直达，无需先经整书再定位章节。
- **不碰现有语义：** 到期队列仍按 `priority ASC + topic_next_at ASC` 确定性排序（用户已习惯）。推荐以"推荐面板 + 可选排序开关"叠加：队列页顶部"下一条推荐"Top 1–3 + 可验证一句话解释；原列表默认顺序不变，另给"按推荐排序"开关，切过去才重排，切回恢复。**禁静默重排。**
- **破格上浮（用户确认一）：** 允许未到期但前置刚补上的摘录破格上浮；前置不满足的摘录即使 priority 高也压住，并明示缺口。
- **搁置原因（用户确认二）：** 摘录创建时加可选单选 `shelveReason`：`need-prerequisite（缺前置）/ too-dense（太密）/ need-example（缺例子）/ language（语言卡）/ other`。`need-prerequisite` 直接记一笔 `prerequisiteGap` 信号，不靠 AI 猜。
- **制卡语义：** 制卡（carded）= 用户开始建立理解的信号，只产生一条低权重 `card_creation` 证据；mastery 是否上涨只看后续复习与探针表现。制卡多但 mastery 低的 KP，其摘录加分（用户在主动啃）。
- **画像来源（按优先级）：** ① 已链卡片继承（该摘录"就此制过卡"的，直接继承 KP + domain，权重最高）；② AI 抽取候选（无链卡时走 `knowledge-extraction` 模板，先进 staging，画像缓存进 `material_knowledge_points(sourceType=extract)` + `material_knowledge_profiles`，推荐时直接查）；③ 搁置原因 + 父摘录链（`parentChain` 上下文归属）。画像字段沿用 §4.9（coverage + prerequisiteGap + 六维难度封闭档 + completionStatus）。
- **排序分：** `extractScore = KP_frontier（覆盖 KP 按覆盖度加权，前置就绪权重最高）× dueBoost（已到期加分，前置刚补上可破格）× userPriority（原样尊重，不反转）× staleness（搁置越久温和加分，防永久沉底）× diversity（同书/同 KP 连击降权，防隧道）`。最优先的永远是"前置刚好补上、只差一层"的，不是"最难的"。
- **两阶段省 token：** Stage A 本地筛 Top 20；Stage B 只对 20 条做 AI 重排与解释（`reason / knowledgeCoverage / nextConcepts / expectedChallenge`），与 §4.9 一致。离线回退"到期 + priority"基线排序。
- **动作：** 打开 / 推迟（仍只走现有 `postponeExtract` 用户动作，推荐禁写 `topic_next_at/priority`）/ 忽略（记反馈，只调 `utility`，不碰 mastery）。读完闭环沿用现有：打开 → 就此制卡（制卡管线 + CardLint）→ 标 `carded` → FSRS 复习 → 高层证据够了建议 `resolved`。
- **落地（用户确认五，一步到位）：** 不做 E0 启发式先行版，等 LKM K1–K4 就绪后按本节完整实现（见 §9.6 E 行）。

### 6.4.2 摘录状态机（细粒度 + 可扩展，用户确认四）

- **状态字段：** `extracts.status TEXT` + `status_version INTEGER` + `status_detail_json`（搁置原因、恢复条件、推迟计数等）。状态词汇表版本化；读取到未知状态一律按 `open` 对待（前向兼容）。
- **v1 状态（`status_version=1`）：** `open（刚摘出）/ reading（已打开在读）/ carded（已就此制卡，理解开始，非掌握）/ consolidating（卡在复习中，前置链补齐中）/ resolved（已理解，可归档，须用户确认或卡毕业+探针通过后建议确认）/ postponed（仍太难，继续推迟，带恢复条件）/ dismissed（不再关心，不再推荐）/ archived（归档留痕）`。
- **扩展预留：** 未来新增状态只增 `status_version=2` 词汇并写迁移映射，禁复用旧状态名、禁改旧状态语义；`status_detail_json` 为开放对象，新维度只加键不改键；`shelveReason` 枚举新增值同样只增不改。`resolved` 永不自动归档（须用户确认），`dismissed` 可随时召回。

---

# 第四部分 Coding Rules（编码规则）

## 7.1 硬性约束（AI 每次迭代必须遵守）

1. 开工只做用户指定的最小单元，其他代码一行不写；开工前复述 Goals/Non-Goals。
2. 不新增 Account 真实现、不接付费/盗版代理、不把 Cookie/key 打日志或上传。
3. 站点域名、API baseUrl、镜像列表、提示词内容必须放配置或 PromptTemplate 表，不许写死。
4. 每次完工保证 `启动 → 该单元主流程 → 重启不丢数据` 可演示。
5. 遇到文档未覆盖的选择先停下问用户；需求变更先改本文档 bump 版本再编码。
6. 视觉以瑞士风默认皮肤为基线；色值/字号/间距一律走 Token，禁止硬编码魔法值；外部粘贴 UI 逐字还原优先。
7. **核心算法回归测试义务（v11）**：涉及 FSRS 调度、CardLint、cloze 解析、Markdown 管线的改动必须附可重复运行的自动化测试；FSRS 调度改动跑 `tests/fsrs/` 全绿；**文档数据模型声明的字段不允许实现时静默裁剪**。
8. **sql.js 并发纪律（v12 实践）**：sql.js 是内存库 + 全量回写，应用运行期间外部脚本改 library.db 会被应用的 persist() 覆盖——外部数据操作必须先关闭应用。
9. **阅读内核防腐层纪律（v20 D20）**：业务代码禁止直接 import foliate-js；全仓库唯一豁免目录 `src/lib/reader/foliate/**`（目录级豁免，禁止单文件巨石化）；业务组件只依赖 `src/lib/reader/{kernel,service}.ts`。adapter 文件头维护「使用的 foliate API 白名单」。
10. **阅读内核升级规程**：vendor 快照更新 → 白名单逐项核对 → L0（fakeKernel 语义）→ L1（`tests/reader.kernel.cjs`，含 CJK ruby/竖排夹具）→ L2（`tests/reader.engine.mjs`）→ L3 真实语料冒烟 → 签发新 ReaderEngineVersion（`src/lib/reader/foliate/version.ts` 单一来源 + 本节版本日志）。失败则 git 还原 `vendor/foliate-js/` 秒级回滚。
11. **表述红线（防过度自信的实现）**：① vendor = 可复现、可审计、可本地修补，**不等于**供应链零风险（其自带依赖 zip.js/fflate 与升级合并成本仍需管理，MANIFEST.json 记录 upstream commit 与 localPatches）；② L1 契约绿 = adapter 契约未破，**不等于**业务无回归（业务安全由 L2 证明，引擎渲染回归由 L3 真实语料捕获）；③ CFI + anchorText = **可降级恢复**的定位体系，CFI 绑定特定文档结构、并非永久全局 ID（粘贴书合成由 sourceHash 式确定性 + generatorVersion 守卫，结构变更走恢复链）。

## 7.2 数据完整性规则

- 所有业务表软删除（is_deleted）；查询一律带 `is_deleted=0`。
- schema 变更用启动时 `ALTER TABLE ... ADD COLUMN` + try/catch（列已存在即跳过）；破坏性数据修复写一次性迁移脚本。
- `updateCard` 未传 fsrs/leech 时保留原值，禁止置 NULL（v12 修复 F6）。
- contentEditable 一律走 EditableText 裸壳模式，禁止把 React 管理的子树直接设为 contentEditable（removeChild 崩溃教训）。
- 用户编辑 cloze 卡问题区时，`[…]` 自动还原为挖空语法；提示词禁止 hint 拆答案（渲染层兼容旧数据）。

## 7.3 测试义务

- FSRS：`tests/fsrs/` 六件套（§4.4.6）——L0 golden（13）/ L1 adapter（15）/ L1 补强（6）/ L2 db（23）/ L4 audit（配置感知分段重放）/ L5 simulate（451，含 S6 时间语义/S7 参数环境/S8 F9 热生效），全绿。另有 undo 套件（`tests/undo.test.cjs`，29）与 persist 边界套件（`tests/persist.test.cjs`，14）——FSRS 调度链路改动须三者全跑。
- M1 制卡体系：`tests/m1.test.cjs`（材料路由/L11/cloze 契约/翻转卡约束，45 断言，依赖 `tests/m1.cards.bundle.cjs`，改 cards.ts 后须用 esbuild 重打包）+ `tests/m1.e2e.cjs`（`npx electron tests/m1.e2e.cjs`，须先关应用）+ `tests/m1.gui.mjs`（CDP 驱动真实 UI 冒烟，须先以 `--remote-debugging-port=9224` 启动应用）。
- M5 手动制卡 / 图片选区（v25）：`tests/m5.test.cjs`（28 断言：像素↔百分比换算 / 包围盒 / 归一化钳制 / 形状可用性 / SVG 图元 / 存量 rects 降级 / L11 shapes 语义 / 用户选区 AI 链路不变量（presetRegion 优先于模型 regions）；依赖 `tests/m5.occlusion.bundle.cjs` 与 `tests/m5.cards.bundle.cjs`，改 `src/lib/occlusion.ts`、`src/lib/cards.ts` 后须重打包：`node_modules/.bin/esbuild src/lib/occlusion.ts src/lib/cards.ts --bundle --platform=node --format=cjs`）+ 阅读内核 L0/L1 的 S16 图片点击契约 + `tests/reader.engine.mjs` L2 的 4c–4h（点选聚焦 / 模糊退出 / 三类工具条 / 画选区 / 手动制卡落库 shapes / 填空题挖空标记 frontMarkdown）。
- M2 备份与恢复：`tests/backup.test.cjs`（node 直跑，33 断言：zip 回环/恢复 staging 换入/路径穿越防护/自动备份按天去重与轮换）+ `tests/m2.gui.mjs`（CDP 驱动真实应用端到端：备份→恢复→重启数据不丢→设置页 UI，须先以 `--remote-debugging-port=9224` 启动应用；恢复目标是刚创建的备份，不丢数据）。
- M6-1 导入格式扩展（v26）：`tests/m6-1.test.cjs`（node 直跑 43 断言：Word 含图转换（GFM 表格/EMF 跳过不打乱序号/10MB 守卫）、TXT 编码（UTF-8 BOM/严格 UTF-8/UTF-16 LE/BE/GBK 回退）、合成 EPUB 图片（manifest 条目/字节落包/src 重写/两次合成字节一致/identifier 折入图哈希）；改 `src/lib/epub.ts` 或 `electron/importers.js` 后须保证全绿，epub.ts 每次运行前自动 esbuild 重打包）+ `tests/m6-1.gui.mjs`（CDP 驱动真实应用端到端 23 断言，自启自关：三格式导入→assets 落盘→Word 内嵌图真实渲染→GBK 无乱码→选区制卡→重启不丢→清理）。
- M6-2 PDF 基础文本导入（v27）：`tests/m6-2.test.cjs`（node 直跑 22 断言：手工构造无压缩 PDF 夹具走真实 pdfjs 提取——书签大纲章节化/字号标题/页分块/单章回退/扫描版拒绝/空页统计/跨页段落愈合/确定性；CJK 重组规则在纯函数层测试）+ `tests/m6-2.gui.mjs`（CDP 端到端 15 断言，自启自关：导入→扫描版拒绝→assets→目录跳章→正文渲染→选区制卡→重启不丢→清理）。改 `electron/importers.js` 的 PDF 段落后须两套件全绿。
- M6-2 修订原生阅读（v28）：`tests/pdf.kernel.cjs`（L1 级：打开→大纲→选区页码→relocate→goTo(pageIndex)→search 往返）+ `tests/m6-2native.gui.mjs`（CDP 端到端 20 断言：导入→原生渲染断言 canvas+文本层→目录跳章→选词制卡 contextRef 含 pageIndex→摘录→翻页进度落库→重启回同页→清理）。
- 卡片/摘录跳转、内联编辑：E2E 手动验证（启动→操作→DB 断言→清理测试数据，测试数据用 FSRSTEST 等前缀）。
- 阅读内核（v20）四层测试（§7.1.10 升级规程）：L0 `src/lib/reader/testing/fakeKernel.ts`（业务单测替身+语义定义）；L1 `npx electron tests/reader.kernel.cjs`（adapter 契约 + CJK 专项 ruby/竖排夹具，jszip 现场构造夹具书，esbuild JS API 打包 driver——**禁用 execSync+npx**，Windows 下会挂起）；L2 `node tests/reader.engine.mjs`（CDP 端到端，自启自关应用，FSRSTEST 前缀）；L3 真实语料人工冒烟（含日文竖排/ruby 真书）。
- 测试脚本临时文件用完即删；测试数据写入前先备份 library.db。

## 7.4 提示词与配置管理

- 提示词版本化播种：目标版本号在 `ensurePromptTemplates`，低于目标版本插入新版，旧版留痕；改提示词先改本文档。
- AI Key：safeStorage 加密、按服务商独立存储（`keys[preset]`），切换预设只恢复该服务自己的 Key。
- FSRS 权重：`settings.json app.fsrsWeights`，长度必须 21，非法拒绝应用。

## 7.5 安全

- Key/Cookie 不进日志、不上传；渲染层不持有明文 Key（流式转发在主进程）。
- 联网检索结果只作理解上下文；AI 禁止编造来源。

## 7.6 出错一键上传（v24 规范，未实现；用户需求：失败现场可修复依据）

1. **入口与 consent：** 设置页「出错时一键上传」按钮（仅手动触发，无后台自动上报）。独立 consent `app.errorReportConsent`，默认关闭；首次点击先弹说明（收什么/不收什么）再经用户确认发送。关闭后零网络请求。复用遥测规格（`docs/SPEC-usage-telemetry.md`）的队列思路，独立队列文件 `error-report-queue.json`（上限 500 条、失败保留下次重试、内存兜底 + 重启补发——persist/备份"盘不可写"场景下报告自身也写不下时先驻内存）。
2. **白名单（只允许这些字段）：** `appVersion / os platform / 失败动作类型（grade/skip/suspend/delete/undo/train/apply/backup/restore/locate/lint）/ cardId / review_seq / AI preset 与 model（去 Key 后）/ HTTP status / error_code（AI_NO_KEY 保留 code）/ duration_ms / optimizer 计数（reviewCount/cardCount/logLoss）/ backup meta（valid/app/format）/ kernel 定位层级（cfi/章节/文本命中与否）+ readerEngineVersion / lint ruleId + severity / 磁盘错误码（ENOENT/EACCES/ENOSPC 等）/ 重试次数`。
3. **禁区（绝不打包）：** `prompt/completion 正文 / front/back/sourceText / API Key / 文件绝对路径 / ai-config.json 全文 / settings.json 中的 keys`。上报前本地过滤器按白名单字段逐项放行，非常见字段一律丢弃。
4. **五处吞异常必须加 code + context（实现本节的前置修复）：** ReviewView 评分/挂起/跳过/删除/撤销 catch（现丢原始 err）/ persistNow 重试 catch / settings 读失败静默回退（记 scope.key + 回退事实）/ getConfigRow 坏行吞 null（记 configId + 损坏字段）/ applyPendingRestore marker 损坏删标记（记 marker 错误）。无根因的报告不准上传——先有 code，才有修复价值。
5. **红线：** 与遥测红线一致（首启同意外，本节另需独立确认；可关即零上报；不采内容）。错误报告与 LKM 自愿聚合（§4.11.4）共用"聚合只上传统计、原文永不离机"原则，consent 各自独立。

---

# 第五部分 Decisions（决策记录）

## 8.1 关键决策日志

| # | 决策 | 理由 | 版本 |
|---|---|---|---|
| D1 | SQLite 用 sql.js（WASM），接口对齐 better-sqlite3 | OpenCode 时期选型：零原生编译依赖；性能债已记录，量大后迁移 | 继承 |
| D2 | 状态管理用纯 React state + 自研 EventBus，不引 Zustand/TanStack | OpenCode 时期实现已成型，迁移收益不抵风险；EventBus 12 事件锁定 | 继承 |
| D3 | AI 制卡为管线编排，不内置 Agent | 流程确定、可审计、1 次调用成本 | v9 |
| D4 | `enable_fuzz=false` | 预览=落库（所见即所存），fuzz 种子含毫秒时间会破坏一致性 | v11 |
| D5 | FSRS 状态全字段持久化 | 丢 S/D/reps 致长间隔失真 23 倍（F1 实测） | v11 |
| D6 | dist 优先加载 | devURL 连接超时导致偶发白屏 | v12.2 |
| D7 | 优化器选 fsrs-rs-nodejs | 官方 Rust 优化器的 NAPI 预编译绑定，Electron 实测 ABI 兼容；WASM 版备用 | v12 |
| D8 | 连续刷题复习模式 | 用户需求：大量连续复习不回列表 | v12.2 |
| D9 | 顶栏 A 方案文字导航 | 用户从 5 版概念稿中选定；页内不重复标题 | v12.2 |
| D10 | EditableText 裸壳模式 | contentEditable 直改 React 子树导致 removeChild 崩溃与内容叠加 | v12.2 |
| D11 | 提示词 v3：R13 禁 hint | AI 把答案拆两半写进 content+hint，正面泄漏半个答案 | v12.2 |
| D12 | 思考强度默认 low | GLM 推理模型思考近 3 万字致制卡 5 分钟；low 档大幅提速且质量可接受 | v12.2 |
| D13 | 跳转原文锚点 = 选中文本前 60 字 + 阅读比例 | 简单可靠；TreeWalker 定位 + 短暂高亮 | v12.2 |
| D14 | 路线图主线重排为 M1–M10，其余未实现 Phase 降级可选更新池 | 用户 2026-09-08 指定主线；数据备份与恢复按用户要求入主线（M2）；浏览器插件/网页剪藏明确降级可选 | v14 |
| D15 | 制卡升级顺序：先补软件功能（图片挖空/翻转问答）→ 提示词测试台调优闭环（AI 改测试台 → 用户手测 → 反馈 → 决定是否并回） | 提示词试验与主软件隔离；并回与否由用户依测试结果决定 | v14 |
| D16 | 图片挖空生成走 GLM 多模态识别遮挡区域（位置/形状→遮罩），不做手动遮挡编辑器 | GLM 5.3 Flash 多模态可用；occlusion_json 结构与浏览页渲染已预留 | v14 |
| D25 | **正文图片可点选聚焦并手绘选区制卡**（用户 2026-09-12 需求）：点击正文图片 → 上浮居中 + 周围模糊（点击模糊区域退出）；顶部悬浮工具条三类选区（矩形 / 圆形 / 多点连线多边形 ≥3 点回起点闭合）→ 提交 AI 制卡（裁剪图交多模态识别内容，**遮挡区域恒取用户选区**）或手动制卡。D16 修正范围明确化：**新增「为创建卡片而手绘区域」**；仍不做「既有卡片的遮挡区域编辑器」与「整图手动遮挡编辑器」（后者保留在可选池） | 图片内容此前无法被选中（选区服务只认文本，正文图片无任何交互入口），AI 只能看图猜遮挡点；用户需要「指哪挡哪」。坐标系纪律：模型收到的是选区裁剪图，其返回坐标属裁剪坐标系——写进 occlusion_json 必然错位，故 presetRegion 场景一律以用户选区为准（tests/m5.test.cjs M5-8 锁定） | v25 |
| D17 | 商业化在线功能（遥测/反馈/更新/多提供商/充值分发）入主线，遥测按 Hermes 规格红线实施 | 商业化前提是数据能力；红线保用户可控（首启同意/设置可关即零上报/不采内容） | v14 |
| D18 | **翻转问答卡 = 制卡手段而非卡类型**：选择创建翻转问答时创建两张互为翻转的独立问答卡（各自独立 FSRS 调度）；**今后禁止设计任何「复习时形态会变化」的卡片，一切卡片设计以 FSRS 算法为核心** | 一张卡在复习期变形（换面出题）会让同一张卡承载两种回忆任务，干扰 FSRS 对稳定度/难度的估计（调度假设每次复习针对同一题面） | v16 |
| D19 | 日记与 AI 洞察入主线（新增 M8，原 M8–M10 顺延为 M9–M11）：学习材料二分——他人创造的与自我感受到的；日记 = 主动记录的学习内容输入、已学知识的边界拓展；洞察按需触发（用户点击），日记不进 FSRS 队列、不强制制卡 | 记录感受的倾向与选择学习材料的倾向很可能相似，日记与知识库存在双向潜在关联（当下已学或将来习得的材料）；流式随想随记、无需整理 | v17 |
| D22 | **FSRS 参数环境版本化**：`fsrs_configs` 不可变配置快照（完整 weights+scheduler_options，指纹去重）+ `settings.app.fsrsConfigId` 活跃指针；应用新参数只影响未来调度，不回算任何存量卡片状态；review_logs 记录每条评分的参数归属，audit 按配置分段重放；settings.app.fsrsWeights 双事实源废除 | 同一套 ts-fsrs 可存在多套参数环境，历史数据模型必须在第一条优化记录产生之前定型；「audit 读当前权重」无法重现历史（多配置时代日志会被统一错放）；双事实源（config+镜像）会导致 audit/UI/engine 各读不同来源 | v23 |
| D23 | **产品学习日与 FSRS 时间语义分离**：`settings.app.dayCutoffHour`（本地钟面 0-23，默认 0）仅定义统计口径的「学习日」（今日完成度/热力/日聚合/月内分组），不进入 FSRS 调度 elapsed_days 与优化器 delta_t；优化器 delta_t 与调度器同语义（工程不变量，行为级 oracle 锁定） | 用户钦定凌晨切点习惯（学习到凌晨不算新一天）；但调度器（ts-fsrs）内部时间语义不可注入切点——把切点塞进优化器会重建「调度≠训练」语义分叉，违背 M3 统一时间语义目标；凌晨学习的痛点本质是统计口径问题，与训练数据无关 | v23 |
| D20 | **阅读器 = foliate-js 单内核「一切皆书」+ ReaderKernel 防腐层**：文件书走 vendor foliate-js；粘贴书/摘录确定性合成 EPUB 进同一内核（摘录无 markdown 阅读边界）；锚点统一 CFI + 四层可降级恢复；PDF 走 PDF.js 基座（R4，PdfAdapter 独立于 Kernel 抽象，不预设「一切皆 foliate」）；多语言排版（CJK 竖排/ruby）为内核承诺并纳入 L1 夹具。业务代码禁止直接依赖 foliate-js（§7.1.9） | 用户需求：完整阅读器（多格式界面统一/目录/模式切换/外观自定义/标注/内外链接）。foliate-js 为调研后唯一可嵌入的宽松许可引擎（MIT；Readest/Anx/Foliate 三个生产应用同型验证）；文本锚点精度不足（同章重复错位）而 CFI 字符级精确；防腐层隔离其 API 不稳定风险 | v20 |
| D24 | **Learner Knowledge Model 架构定稿（v24，纯文档不实现）：** 三层分离 + 状态可重算 + AI 非事实源升最高不变量（§1.8–1.10）；知识本体＝Domain + KP 一等实体 + 8 种封闭关系（§4.6）；BEMM 五维 Beta + Bottleneck + 分层证据（§4.7，否决强制周测）；Frontier 六因子 + 四档挑战（§4.8）；材料画像 + 两阶段推荐（§4.9）；Obsidian 式 2D 图 + 真实回放动画规格（§4.10）；双轨调优（用户轨本地优化器 + 开发者轨仿真为主，§4.11）；FSRS 隔离边界（§4.12）；Insight 三层证据 + Meaning 第三图（§4.13）；LKM 五独立提示词分支 + KnowledgeLint K2–K8（§6.3.11–12）；出错一键上传白名单/禁区/队列（§7.6）；路线 K0–K8（§9.1） | 用户桌面设计稿（LKM §0–§87 + Insight 21 节）经 8 问打磨合并：AI metadata 封闭化防换模型漂移、混合建图保 ID 稳定、分层探针替代周测、双轨调优解默认与个人参数、一键上传补失败根因。v24 只定架构与契约，K0 起按最小单元实现 | v24 |

## 8.2 已接受偏差（实现与原锁定方案的差异）

| 偏差 | 原锁定 | 现状 | 处置 |
|---|---|---|---|
| 状态管理无 Zustand/TanStack Query | §2 表 | React state + EventBus | 接受为既成（D2），不再计划迁移 |
| 数据库 sql.js 而非 better-sqlite3 | §2 表 | sql.js 全量回写 | 接受；数据量显著增长后迁移（Roadmap） |
| 联网检索三引擎回退 | 文档锁 DDG 单方案 | Bing→DDG→百度 | 接受（更稳） |
| UI 微调类任务未逐次 bump 文档 | §1.6 | v12.2-v12.4 界面微调直接实施 | v13 重构时补记；此后功能级变更仍须先改文档，纯样式微调豁免 |
| 产品学习日（本地日切点）与 FSRS 时间语义（UTC 日历日）统计口径差 | §4.4.8 | 本地凌晨时段（00:00–切点）的复习：学习日统计算「昨天」，FSRS elapsed/delta_t 按 UTC 日历日计 | 接受（D23 产品语义选择）：准点复习下两者恒等；仅影响统计口径，不影响调度/训练一致性 |

## 8.3 版本变更记录（摘要）

- **v6** AI 制卡与助读体系（第 6.3 节）；**v7** Topic 调度承诺；**v8** occlusionJson + Key 加密；**v9** 管线架构 + 联网检索；**v10** 本地模型预设；**v10.4** thinking 信号；**v10.5** reasoning_effort；**v11** FSRS 调度契约（§7）+ F1-F6 修复；**v12** FSRS 优化器（§7.7）；**v12.2** 界面重设计（A 导航/去重标题/连续复习/跳转原文/删除/双面编辑/EditableText/dist 优先）；**v12.3** 摘录锚点；**v12.4** 顶栏 no-drag 修复 + 问题区内联编辑；**v13** 本文档六部分重构（无业务逻辑变更）；**v14** 主线重排（主线批次 M1–M10，数据备份与恢复按用户要求入主线；原未实现 Phase 全部降级 §9.4 可选更新池；新增 6.3.10 规划与 D14–D17）；**v15** M1 落地（四卡形式：reverse 双向卡 + 图片挖空生成链路；材料类型路由 detectMaterialType + AI 面板手动覆盖；独立提示词测试台 prompt-lab；提示词覆盖核对报告；card-occlusion 新分支播种；修复 extractClozeAnswer 组序 bug——v3 无 hint 挖空卡背面曾恒为空串；修复 prompt_templates 首装播种条件——全新库上 reader-explain/leech-rescue 曾缺播种）；**v16** 翻转问答重设计（**D18**：废除 reverse 卡类型与 reverse_json——翻转问答=制卡手段，创建/转翻转卡时拆为两张互为翻转的独立 qa 卡；禁止复习期形态变化的卡片，一切卡设计以 FSRS 为核心）；测试台修复（labAPI 守卫 + 启动 bat + applyDraft）；测试台 v4 候选补丁（G1-G9 + card-literature 文学/诗歌背诵候选，待用户实测）；覆盖报告更新处置状态并新增文学性材料研究（§五→§四）；**v17** 日记与 AI 洞察入主线（**D19**：新增主线批次 M8——Logseq 式流式日记补上第二输入通道（自我感受到的学习材料）+「洞察」按钮按需触发 AI，发现日记与已学知识的双向关联；日记不进 FSRS 队列；原 M8–M10 顺延为 M9–M11）；**v18** M2 数据备份与恢复（设置页手动备份/恢复：单 zip 含清单、ai-config 默认不含勾选才含、备份位置可配；每日首启自动滚动备份按天去重+保留份数轮换；恢复=校验→安全备份→staging+标记→重启换入生效，运行期不动库文件；新增 `electron/backup.js`、`backupAPI`、设置「备份与恢复」区块；测试 `tests/backup.test.cjs` 33 断言 + `tests/m2.gui.mjs` 端到端）；**v19** 卡片浏览升级批次（① **跳转原文现场查看语义**：跳转会话阅读器不写阅读进度与阅读字数统计，切出后记录位置保持上次真实阅读位置——此前跳转后滚动/切出会把跳转位置写进 progressJson，丢失真实阅读进度；统一 `handleJumpToDoc(docId, anchor, returnTo)` 三处入口（复习/队列/卡片浏览），修复队列跳转返回落点曾错回复习页的死代码问题；② **卡片浏览 Anki 式改造**：全量卡片表格+搜索+类型/状态筛选+排序+行详情（卡面内联编辑/暂停恢复/推迟/重置新卡/删除/跳转原文/质检问题/Leech 入口），`listAllCards` 补 docTitle JOIN；③ **共享 Dropdown 组件**：dashboard/Dropdown.tsx 提升为 components/Dropdown.tsx（+align 左对齐变体），AI 制卡侧栏「材料类型」下拉由原生 select 换为直角下拉，与统计数据页风格一致（纯样式组件复用）；**v20** M3 FSRS 集成验证（**L5 时间轴模拟层** `tests/fsrs/simulate.test.cjs`：全生命周期单卡剧本/整体时间平移不变性/预览=落库同源逐轮验证/遗忘链 leech 触发/优化器训练输入链；**官方做法审计**实锤并修复 **F7**——`fsrs_json` 缺 `learningSteps`（ts-fsrs 学习步进索引）致 learning 档第 2 步 Good 永不毕业、10 分钟档死循环，契约 §4.4.1 补该字段；`fsrsEngine.preview/next` 增可选 `now` 时间注入参数（渲染层行为不变）；golden.cjs 过时的 fuzz=true 断言纠正为 false；回归义务升级六件套（§4.4.6/§7.3））；**v21** M4 快捷键（**CommandRegistry 落地**（§4.2-2）：`src/lib/commands.ts` 命令表 12 条=用户锁定键位、组合键规范化（存储=展示同串）、全局 keydown capture 分发（输入焦点绝不劫持、e.repeat 忽略、抑制集合）、键位覆盖项只存非默认于 `settings.app.keybindings` + `src/lib/useCommands.ts` ref 注册；阅读四键（制卡 Ctrl+Z/AI 制卡 Ctrl+X/AI 解释 Ctrl+A/摘录 Ctrl+S，动作与选区菜单按钮同源，when=有选区且无弹层）；复习键（空格翻面仅正面、1-4 评分仅背面、q/w/d 有卡即可，删除仍 confirm，busy 守卫防连发；跳过不计「本轮」为既有语义未动）；设置页「快捷键」区块（捕获新键 Esc 取消、冲突拒绝保存、单条/全部恢复默认）；测试 `tests/m4.test.cjs` 39 断言 + `tests/m4.gui.mjs` CDP 23 断言 + `tests/m4.cleanup.cjs` 摘录清库配套）；**v22** 复习撤销评分（用户需求：误评无撤回。review_logs 增 `fsrs_before_json` 评分前快照列（ALTER TABLE 迁移，旧日志 NULL 不可撤销）；db 增 `getLastUndoableReview`/`undoLastReview`（恢复快照→物理删除该条日志→本次触发 leech 则解除挂起并关闭本次 LEECH issue→返回恢复后的卡）；IPC `cards:lastUndoableReview`/`cards:undoReview`；`review` 调用链补第 5 参 fsrsBefore；命令表增 `review.undo`（Z，13 条）；复习页 meta 行「撤销评分（X）」按钮 + 收尾页撤销按钮；撤销后回到该卡背面可立即重评、本轮计数 -1；**决策：撤销=物理删除日志**——review_logs 本无软删机制（无 is_deleted 列），训练/统计 10 处查询直读该表，物理删除使优化器输入与统计自动干净，避免 10+ 处查询改动风险；测试 `tests/undo.test.cjs`（electron + 临时 userData 隔离库）+ m4 两套同步更新（13 命令 / GUI 撤销段））；**v23** M3 增补批次：FSRS 数据完整性加固与学习日语义（**最高不变量**「同一份复习事实不允许两套解释」入 §4.4；**D22** fsrs_configs 不可变配置快照（完整 weights+scheduler_options+指纹 UNIQUE，无 update API，切换=settings.app.fsrsConfigId 指针，reset=指针回 cfg-default，apply 指纹去重）+ **废除 settings.app.fsrsWeights 双事实源**（存量迁移播种后删除）；**D23** 学习日=统计口径（settings.app.dayCutoffHour 本地钟面 0-23 默认 0，`learningDayIndex/learningDayStartMs` 仅统计），禁止进入 FSRS 调度/训练；**fsrsTime.js 独立实现 canonical delta_t**（UTC 日历日差复刻 ts-fsrs 5.4.2 语义，无库依赖，oracle=ReviewLog.elapsed_days 行为级对照）；review_logs 增 fsrs_after_json/leech_before_json/fsrs_config_id/fsrs_before_config_id/review_seq（唯一索引，存量回填=rowid）；**review 成功边界=COMMIT+persist 成功+IPC 成功**（崩溃一致性措辞，非跨层 ACID）；persist() 原子写（tmp+fsyncSync+renameSync，失败 throw 无静默降级，启动清残留 tmp）；**persistNow 纯持久化重试**；**undo 重写**：8 字段 after 全等校验（v22 旧日志不可撤销）+leech_before 精确恢复（F10）+fsrs_before_config_id 恢复+review_seq 序+事务；saveReview/undo 事务化；fsrs.ts 由完整配置快照构引擎+主进程 fsrs:configChanged 推送热重建（**F9**）；SettingsPanel「新一天开始时刻」设置；ReviewView 过期 preview 判废+保存失败横幅；audit.cjs 按日志 config 分段重放；测试 S6 时间语义/S7 参数环境/undo U6-U9/persist 边界套件；缺陷修复 **F9**（权重应用不热生效，UI 曾宣称即刻生效）、**F10**（undo leech 以「当前挂起」推断误回退手动挂起）、**F11**（persist 非原子整库覆盖写））；**v24** Learner Knowledge Model 架构定稿（**D24**，纯文档零代码）：§1 增三最高不变量（§1.8-1.10）；§4 新增 §4.5 总览 + §4.6 本体（UDC 退位/Domain/KP/8 种封闭关系/AI metadata 封闭化/混合建图）+ §4.7 Evidence 与 BEMM（五维 Beta/Bottleneck/分层探针替代周测）+ §4.8 Frontier（六因子/四档挑战）+ §4.9 材料画像与两阶段推荐 + §4.10 Obsidian 式 2D 图与真实回放规格 + §4.11 双轨调优（lkm_configs 快照 + 用户轨门槛 + 开发者轨仿真为主）+ §4.12 FSRS 隔离边界 + §4.13 Insight 三层证据与 Meaning 第三图 + §4.14 插件节 renumber；§6.3 新增 LKM 五独立 scope（§6.3.11）+ KnowledgeLint K2-K8（§6.3.12）；§7 新增 §7.6 出错一键上传（白名单/禁区/队列/独立 consent + 五处吞异常补 code）；M8 补 LKM 日记联动（只产 demand 禁写 mastery）；§9 新增状态表 K0-K8 行 + §9.6 实施路线；第六部分标题同步 v24。**v24 增补（Next Extract，用户五项确认）：§6.4 扩展为队列 + 下一条摘录推荐（破格上浮允许、shelveReason 可选单选、推荐面板 + 独立排序开关、禁静默重排）+ 细粒度可扩展摘录状态机（status/status_version/status_detail_json，v1 八态，未知状态前向兼容 open）；§9.6 增 E 行（一步到位，随 K4–K5 落地，不做启发式先行版）。**；**v25** M5 手动制卡优化 + 正文图片点选聚焦批次（**D25**：点击正文图片 → 上浮居中 + 周围模糊（点击模糊区域退出）→ 顶部居中悬浮工具条三类选区（矩形 / 圆形（椭圆）/ 多点连线多边形 ≥3 点回起点闭合）→ 提交 AI 制卡或手动制卡）：① **阅读内核新增 `imageClick` 事件**（`ReaderKernel.on("imageClick")`，语义 = src + 宿主视口坐标框 + 显示尺寸；图片字节由壳层按 src fetch，内核不搬数据；链接内图片让位链接）+ fakeKernel `__emitImageClick` 测试钩子；② **新增 `src/lib/occlusion.ts`**（像素↔百分比唯一换算口 / 形状包围盒 / 归一化钳制 / 可用性判定 / SVG 图元描述 / rects→shapes 存量降级）；③ **新增 `src/components/reader/ImageFocus.tsx`**（聚焦覆盖层）与 `src/components/OcclusionShapes.tsx`（复习端与确认面板共用形状渲染，variant=card|proposal）；④ **`cards.occlusion_json` 增 `shapes`**（rect/ellipse/polygon 精确轮廓，rects 恒为包围盒兼容旧渲染与 L11；L11 语义扩为「有 rects 或 shapes 且有 asset 即有效」）；⑤ `generateOcclusionCards` 增请求装配注入口（context.focus + **context.presetRegion**——用户选区场景下遮挡区域恒取用户选区，模型返回的 regions 属裁剪坐标系一律不采纳）；⑥ 新增 IPC `assets:saveImage`（渲染层字节直接落盘入 assets 表，替代文件对话框）；⑦ **M5 手动制卡**：四类型页签（含图片挖空）+ `UdcPicker`（UDC ≤2、首个为主）+ 字段对齐 AI（contextPrefix/domain/mnemonic/knowledgePointId/dateStamp/priority，generatedBy=manual）+ CardLint/S1 强制；⑧ **修复 F12**（填空题手动制卡的挖空语法此前未写入 frontMarkdown，复习端无挖空 ord → 挖空从不遮蔽）；⑨ 测试：新增 `tests/m5.test.cjs`（28 断言）、阅读内核 L0/L1 增 S16 图片点击契约、L2 增 4c–4h（聚焦/退出/画选区/手动制卡落库/填空题挖空标记）；顺带修复测试脚手架缺陷（reader.driver.js 的 runFake/runFoliate 曾返回 undefined 致统计恒 0 项；reader.engine.mjs 的 7c 顶层 await 语法错误；**m1.gui.mjs 自 v20 内核化起失效的 G1/G2/G3**——改按引擎视图注入选区并断言四类型页签，现 16/16 全绿）。**；**v26** M6-1 导入格式扩展首批（用户 2026-09-12 三项拍板：**Word 内嵌图必须保留并展示在阅读材料中**、**Anki 牌组不做**（成品问答卡不是阅读材料）、补调研主流格式——结论：必须支持=EPUB/DOCX/TXT（GBK 检测为中文刚需）/Markdown/HTML（M6-3）/PDF（M6-2），被动兼容零投入=MOBI/AZW3、FB2、CBZ（foliate 内核已可直读），跳过=KFX（DRM）/CBR（RAR 许可）/DJVU/CHM/ODT/.doc 二进制（提示另存 .docx）/RTF；M6 拆批 M6-1→M6-2（PDF 纯文本先行）→M6-3（HTML+调研收尾））：① **合成管线图片能力（唯一结构性改动）**——`buildSyntheticEpub` 增 `opts.images`（章节 img src 重写 `rewriteImgSrcs`→`images/<filename>`、OPF manifest 追加 image 条目、zip 落 `OEBPS/images/` 二进制、`imageHashSuffix` 把图片字节哈希折入 dc:identifier 防同文异图碰撞），**`SYNTH_GENERATOR_VERSION` syn-1→syn-2**（无图输入与 syn-1 字节级同构且 identifier 恒等，存量粘贴书 CFI 不受影响）；② 新增 `electron/importers.js`（主进程转换：mammoth `convertToHtml`+`convertImage` 收集内嵌图按出现序确定性命名 img-N.ext、turndown 主进程直跑（ATX 标题供章节切分）+ 自实现 GFM 表格规则、EMF/WMF 不可渲染格式跳过不打乱序号、单书图片总量 10MB 守卫超限中止；`decodeTextBytes` 编码检测 UTF-8 BOM→严格 UTF-8→UTF-16 LE/BE BOM→GBK 回退（原生 TextDecoder，零新增依赖）；`txtToMarkdown` 逐非空行成段（中文一行=一段主导形态，原文含 markdown 标记则自然章节化）；`markdownFromText` 直通；`titleFromFilename`）；③ `electron/db.js` 增 `createImportedDoc`（source_type=word/txt/markdown 统一建册，原文件落 assets kind=word/txt/markdown-original，内嵌图 kind=image-content，M2 备份自动覆盖）+ `readContentImages`（读侧取回图字节随合成落包）；④ IPC `library:pickWord/pickTxt/pickMarkdown`+`library:createFromWord/Txt/Markdown`+`library:readContentImages`；`libraryApi.pickImport/createImported/readContentImages`；AddBookModal 增 Word/TXT/Markdown 三按钮，App.loadReaderBook word 分支取图随合成 EPUB 内嵌（foliate 内核 blob 重写加载）；⑤ 测试：`tests/m6-1.test.cjs`（43 断言，node 直跑，esbuild ?raw CSS 插件现场重打包 epub.ts）+ `tests/m6-1.gui.mjs`（CDP 自启自关 23 断言：三格式导入→assets 落盘→Word 内嵌图 foliate 真实渲染→GBK 无乱码→选区制卡 CFI→重启不丢→清理，FSRSTEST 前缀）；阅读内核 L1 44/44、L2 20/20 回归全绿（粘贴书路径不受 syn-2 影响）；已知体验债：# 开头文档（Word 常见）打开落在空首章（§9.4 既有技术债），目录跳转可达，随未来 syn 版本升级一并修复。**；**v27** M6-2 PDF 基础文本导入（范围裁定：纯文本先行——PDF.js 提纯文本进合成 EPUB 管线；扫描版 OCR（页级 tesseract.js/MinerU 伴生）另批或可选池；版面保真渲染（R4 PdfAdapter 按页虚拟渲染/Range 流式）为后续独立批次，本批不预设 PDF 进内核原样渲染）：① 新增依赖 `pdfjs-dist` 6.3（legacy 构建主进程动态 import，CommonJS `await import()` 启动零开销；不碰 foliate vendor 快照；**cMapUrl/standardFontDataUrl 须以正斜杠结尾**否则 factory 校验报错；cmaps 目录为 CJK CID 字体必需）；② `electron/importers.js` 增 `pdfToMarkdown`：逐页 getTextContent → `itemsToLines`（hasEOL+y 双信号成行；行内 CJK 直接粘连/ASCII 按间隙补空格）→ `linesToMarkdown`（**段落切分行距用行距差 25 分位**估计正行距——中位数会被标题大间距抬高致全文粘连；缩进启发式：下行左缘缩进 > 0.9×中位字高且上行贴左缘即分段）→ 章节化三优先级（**书签大纲** getOutline+getPageIndex level1→`# `/level2→`## `，named dest 先解析、单条失败跳过；无大纲→`headingCandidates` 字号启发式（≥1.35×**全书行高下中位数**且 ≤60 字符，同字号天然不误判、偶数取下中位防上中位污染，≥2 条才启用）；再无→页数>8 每 10 页分块 `# 第 X–Y 页`）→ **跨页段落愈合**（上页末段无终止标点则移出与下页首段合并，CJK 粘连/ASCII 补空格）→ 全页无文本层（扫描版）throw 明确提示、部分空页返回 emptyPages；③ db 复用 createImportedDoc（source_type=pdf + pdf-original 资产）；IPC `library:pickPdf/createFromPdf`（返回 pages/emptyPages/chapters/outlineUsed）；AddBookModal「导入 PDF」按钮 + 空页提示；④ 测试 `tests/m6-2.test.cjs` 22 断言（手工构造无压缩 PDF 夹具走真实 pdfjs——**PDF 内容流不支持 CJK 字面量**，夹具限 ASCII、CJK 正确性由纯函数层覆盖）+ `tests/m6-2.gui.mjs` CDP 端到端 15 断言（含扫描版拒绝与重启不丢）；M6-1 回归 43/43。**；**v27→v28 修订说明**：用户实测 v27 提纯文本方案版面丢失不可接受，M6-2 改道原生阅读——pdf.js viewer 直读原文件 + 页码锚点（此前从未集成过 pdf.js 阅读器；渲染方案经实测调研：MuPDF AGPL 冲突商用路线、PDFium 绑定无文本层、Electron 内置查看器零 API、商业 SDK 不适合）；存量 PDF 书不迁移（用户手动删除）；提纯函数保留为全文检索备用。**；**v28** M6-2 修订完成（PDF 原生阅读落地：pdf.js viewer 直读 + 页码锚点；ES2025 兼容层随 Electron 升级删除；测试 pdf.kernel 14 + m6-2native.gui 20 全绿；回归 M6-1 43/M6-2 提纯 22/L1 44/L2 20 全绿）。**。

---

# 第六部分 Roadmap（路线图，v14 主线重排；v17 增补日记批次；v24 增补 LKM 路线）

> **v14 重排**：按用户 2026-09-08 指定，**M1–M10 为接下来开发的主线**（软件要实现的基本功能，排列顺序即开发优先级；一次只推进一批，§1.4）。原路线图中其余未实现 Phase 一律降级为 §9.4 可选更新池，**AI 不得自行领取**。
>
> **v17 增补**：按用户 2026-09-09 构想，新增主线批次 **M8 日记与 AI 洞察**（学习材料的第二输入通道，D19），原 M8–M10 顺延为 M9–M11，相对顺序不变。
>
> **v24 增补**：Learner Knowledge Model 架构定稿（**D24**，纯文档不实现），实施路线 **K0–K8** 见 §9.6，一次只推进一批，与 M5–M11 主线穿插排期由用户指定。

## 9.1 主线批次

### M1 — AI 制卡体系升级（四卡形式 × 材料类型路由 × 提示词测试台）✅（v15 实现，v16 按用户反馈修订）

> **v16 修订**：翻转问答卡重设计（D18——拆为两张独立问答卡，废除复习期变形设计）。
> **v15 完成情况**：① 卡形式扩展 ✅（翻转问答=两张独立卡；图片挖空：assets 入库→GLM 多模态→occlusionJson→确认面板→复习渲染→L11 语义修正）；② 材料类型路由 ✅（detectMaterialType 本地识别 + AI 面板类型展示/手动覆盖，映射表见 §6.3.10 **待用户确认后锁定**）；③ 提示词测试台 ✅（`prompt-lab/` 独立 Electron 应用，v4 候选补丁就绪，调优闭环等用户实测）；④ 提示词覆盖核对 ✅（缺口报告 `docs/M1-prompt-coverage-report.md`；G1-G9 已实现为测试台候选，G10/G11 用户已拍板）。
> 遗留动作：映射表确认；用户实测 v4 候选后决定是否并回主软件（播种 v4）；提示词修改一律走「测试台验证 → 播种新版本」。

提示词优化的准绳是两份桌面文档：`C:\Users\xiongdy\Desktop\制卡20条原则.md` 与 `C:\Users\xiongdy\Desktop\制卡原则与知识表述_知乎收藏夹全文22篇.md`（文内图片为 Markdown 引用形式，图片存于 `C:\Users\xiongdy\Desktop\制卡原则与知识表述_图片\`）。

目标：软件支持对不同类型的阅读材料采用不同的制卡方式——先识别用户所选材料的类型，再分别匹配不同的制卡原则、提示词与制卡形式（若有更优流程，实现前先向用户提出）。

子任务顺序（用户指定：**先补软件功能，后调提示词**）：

1. **卡形式扩展（代码先行）**——四种核心制卡/复习形式：

| 形式 | 现状 | 待做 |
|---|---|---|
| 挖空题 | ✅ | 基线，保持 cloze 契约（§5.4/§7.2） |
| 问答题 | ✅ | 基线 |
| 翻转问答卡 | ❌ | 新增卡类型：正反两面皆可为题面（双向卡）。需扩展 cards 数据结构与生成输出格式，复习端支持双向出题与翻面 |
| 图片挖空卡 | 🟡 | occlusion_json（rects+assetPath）结构与 CardBrowser 渲染已有。生成链路补齐：图片入库（assets 表）→ 提交 GLM（多模态）识别需遮挡内容 → 返回位置/形状（区域信息）→ 生成 occlusionJson → 制卡确认；连续复习视图补渲染；对接 L11。不做手动遮挡编辑器（可选池，D16） |

2. **材料类型路由**：制卡入口先识别材料类型（本地规则先行），按类型路由到 PromptTemplate 分支与默认卡形式组合；既有 application/mnemonic/seq/formula 类型保留。
3. **提示词测试台（独立最小软件）与调优闭环**：把主软件提示词与运作流程（模式路由 → 取模板 → 上下文打包 → 流式生成 → JSON 容错 → Lint → 确认，§4.3）提取为独立、最轻量的测试工具（复用 prompts.js 与 lint 代码）。调优闭环（用户钦定）：**AI 按用户要求修改测试台内的提示词/流程 → 用户在测试台手动实测（文字/图片材料）→ 用户反馈测试结果 → 决定是否并回主软件**；并回时提示词播种新版本（旧版留痕）。主软件内不做提示词调优试验。
4. **提示词覆盖核对**：逐条核对 v3 提示词与两份文档的全部制卡原则、各类型学习材料的制卡策略/原则/处理方法；**发现缺口先向用户报告，经确认后再增改**。

Non-Goals：不改 FSRS；不动挖空契约；不直接改既有提示词文本（改提示词一律经测试台验证后播种新版本）。

### M2 — 数据备份与恢复 ✅（v18 实现）

> **v18 完成情况**：① 手动备份/恢复 ✅（设置 → 备份与恢复）。备份 = 单个 zip（`backup-manual-时间戳.zip`）：library.db 全库 + assets/** + settings.json + 清单 `backup-meta.json`（app/format/时间/数据规模留痕）；**ai-config.json 默认不入备份、勾选「包含 AI Key」才含**。备份位置 `settings.app.backupDir` 用户可选，默认 `%APPDATA%/incremental-reading-dev/backups/`。② 自动备份 ✅：每日首次启动（按天去重 `backup-auto-日期.zip`，当日已备则跳过），保留份数 `settings.app.autoBackupKeep`（默认 7，超出轮换删最旧；设置页可关）。③ 恢复 ✅：校验清单（拒绝非本软件 zip，防 zip 路径穿越）→ **先对当前数据做一次安全备份**（`backup-safety-*.zip`，含 Key、仅落本机备份目录）→ 解包到 `restore-staging/` + 写 `restore-pending.json` 标记 → **重启应用时换入生效**（启动序：applyPendingRestore → initDb；sql.js 运行期绝不直接改写库文件，§7.1.8）。④ 设置页展示当前数据量（书/卡/摘录/字节）与备份列表（手动/自动/安全标签 + 数据规模 + 逐条恢复 + 从备份文件恢复）；恢复完成后提供「重启应用」按钮。测试：`tests/backup.test.cjs` + `tests/m2.gui.mjs`（§7.3）。
> 衔接既有纪律：§7.3 测试前备份、§7.1.8 外部改库前备份可直接使用「立即备份」。

目标：确保用户学习数据不丢失。

1. **手动备份/恢复**：设置页入口。备份内容 = `library.db` 全库 + assets 资产文件 + settings.json（`ai-config.json` 含加密 Key，默认不入备份、用户勾选才含）；备份位置用户可选，默认 `%APPDATA%/incremental-reading-dev/backups/`。
2. **自动备份**：每日首次启动自动滚动备份，保留份数可配置（超出轮换删除最旧）。
3. **恢复**：从备份文件恢复；执行恢复前先对当前数据做一次安全备份（防误恢复本身丢数据）；受 sql.js 内存库约束（§7.1.8），恢复后重启应用生效。
4. **衔接既有纪律**：§7.3 测试前备份、§7.1.8 外部改库前备份可直接使用本功能。

Non-Goals：云同步/多设备不做（§1.2 留位原则不变）；备份不联网上传。

### R1–R4 — 阅读内核系列（v20 新增主线，先于 M3；R1 已实现）

> **R1 ✅（v20 实现）**：一切皆书 + ReaderKernel 防腐层 + foliate-js vendor 快照 + 目录侧栏 + 滚动/分页/对开 + 外观（主题/字号/字体）+ 内外链接（CFI 精确跳转/openExternal）+ 选区制卡管线适配（contextRef 四层）+ 进度/统计适配 + 导航防护 + L0/L1/L2 测试（L1 含 CJK ruby/竖排夹具）。
> **R2 待做**：高亮标注（overlayer 经 Kernel 自有方法暴露 + annotations 表 + 标注→摘录/制卡联动）。
> **R3 待做**：个性化完善（自定义主题保存、页边距/行距、翻页交互细节）。
> **R4 待做（合流 M6）**：PDF（PdfAdapter→PDF.js 直连；Range 协议流式 + 按页虚拟渲染，200-300MB 不整载；扫描版=页级 tesseract.js 本地 OCR 默认 + MinerU 整本伴生文本层可选）、Word（mammoth→EPUB）、TXT、MOBI 直读。

### M3 — FSRS 集成验证（时间轴模拟）✅（v20 实现）

> **v20 完成情况**：① 验证设计（下方）已先写入文档再实现 ✅；② **L5 时间轴模拟层** ✅（`tests/fsrs/simulate.test.cjs`，`npx electron tests/fsrs/simulate.test.cjs` 运行，**417 断言全绿**；六件套合计 = L0 13 + L1 15 + L1 补强 6 + L2 23 + L5 417 + L4 总账）；③ 集成审计 ✅（结论见本节末尾「官方做法一致性审计」）。审计实锤并修复两个新缺陷：**F7**（`learning_steps` 未持久化，学习档 Good 死循环——详见 §4.4.1 与 `tests/fsrs/REPORT.md`）与 **F8**（优化器 `evaluate` 对同日收尾样本抛 InvalidInput，真实日志必触发——详见 §4.4.7）；纠正 golden.cjs 过时的 fuzz=true 断言；`fsrsEngine.preview/next` 增加可选 `now` 参数（时间注入，渲染层行为不变）；契约字段补 `learningSteps`。
> Non-Goals 达成：未改 DB 层行为、未动 fuzz/评分语义、request_retention 保持 0.9（用户可调为后续可选池项）。
>
> **v23 加固增补**（经外部评审五轮收敛，§4.4.8-4.4.11 + D20/D21 + §8.3 v23 记录为完整依据）：① 时间语义统一——optimizer delta_t 弃 floor(24h)，canonical 函数（fsrsTime.js 独立实现）与调度器 UTC 日历日语义精确恒等，行为级 oracle（ReviewLog.elapsed_days）+ L6 负测试锁死，学习日切点仅统计（D23）；② 参数环境——fsrs_configs 不可变快照 + 指针（D22），废除 fsrsWeights 双事实源，review_logs 记录参数归属，audit 分段重放；③ 数据完整性——review_logs 增 after/leech_before/config 快照与 review_seq，saveReview/undo 事务化，persist 原子替换（F11），review 成功边界=COMMIT+persist+IPC；④ 缺陷修复 F9（权重应用不热生效）/F10（undo leech 误回退）/F11；⑤ 审计版本戳：**Audited against ts-fsrs 5.4.2 / fsrs-rs-nodejs 0.9.1 / package-lock resolved versions / 审计日期 2026-09-09**；FSRS 依赖升级为独立批次。

**验证方法与流程设计（先于实现写入本文档）**：

- **定位**：与六件套中既有五层互补的**仿真回归层**——L0-L4 验证「单轮/单点正确性」，L5 验证「整条时间轴上生命周期的连续正确性」。
- **黄金参考**：ts-fsrs 5.4.2 原库（`enable_fuzz:false`）在本进程内独立驱动一条**全字段内存链**（refChain），与应用侧「持久化往返链」（appChain）在同一时间轴上逐轮对照。关键测试设计：refChain 绝不从 appChain 重建（否则丢字段会两侧同错、无法检出 F7 类缺陷）。
- **时间控制**：`fsrsEngine.preview/next` 注入显式 `now`（可选参数）；测试用固定基准时刻 T0=2025-01-01T00:00:00Z，全部时间戳显式给出，结果确定可复现。
- **持久化往返**：应用侧每轮的落库状态经 `JSON.stringify → parse` 往返后驱动下一轮（模拟 db 存取），专抓字段丢失与精度损失。
- **剧本矩阵**（五组）：
  1. **全生命周期单卡剧本**（跨约 70 天）：新卡（稀疏 3 字段，模拟 db.createCard）→ 首评四分支 → learning steps 步进（1m→10m→毕业）→ Review 多轮 Good（间隔随 S 增长）→ 遗忘（Again → relearning 10m → 恢复）→ 逾期复习（到期后 +3 天/+30 天再评，验证 elapsed> scheduled 场景）→ Hard/Easy 混合 → 月级长间隔。逐轮断言 state/due/lapses/stability/difficulty/reps/lastReview/learningSteps 与参考引擎**逐字段精确相等**（同库同参同 now，容差为 0）。
  2. **整体时间平移**：同一评分剧本分别在 T0、T0+10 天、T0+100 天三个基准各跑一遍，断言各轮相对结果（due 偏移/S/D/reps/lapses）完全相同——FSRS 平移不变性（整日平移下 dateDiffInDays 取整不变）。
  3. **预览=落库同源**：每一轮 `preview(card,now)[rating].fsrsState` 与 `next(card,rating,now).fsrsState` 深度相等（§4.4.3 逐轮验证）。
  4. **遗忘链与 leech**：毕业后 [Again,Good]×8，断言 lapses 逐次 +1、每次 Again 后 due=+10m（relearning 档）、第 8 次 lapse 时 `isLeech(lapses,8)` 恰好触发。
  5. **优化器训练输入链**：用剧本产生的评分日志（含正常卡/单次复习卡/全同日卡/36 小时间隔卡）经 `optimizer.buildTrainSet` 构建 FSRSItem：断言 delta_t 向下取整天数、前缀展开（每条复习一个样本且携带全部历史）、无效样本过滤（单次复习/全同日/无跨天前缀 → 排除，防 fsrs-rs panic）；断言训练集含「同日收尾」样本（F8 触发路径在场）后喂给 fsrs-rs-nodejs 真实 `computeParameters` + `evaluate`，输出 21 维有限权重与 logLoss/rmseBins；`applyWeights` 拒绝非 21 维、接受 21 维并写入 settings、`resetWeights` 清除。
- **通过标准**：五组全绿后 L5 并入回归义务（§4.4.6 六件套）。

**官方做法一致性审计结论（v20，对照 open-spaced-repetition 官方实现与推荐实践）**：

| 审计项 | 结论 |
|---|---|
| 引擎与参数 | ✅ ts-fsrs 5.4.2（FSRS-6，21 权重）；request_retention 0.9 / maximum_interval 36500 / enable_short_term true / learning_steps [1m,10m] / relearning_steps [10m] 全部官方默认；enable_fuzz=false（官方默认即 false，D4 锁定） |
| 评分/状态映射 | ✅ Again=1/Hard=2/Good=3/Easy=4；State New=0/Learning=1/Review=2/Relearning=3，与官方枚举一致 |
| 调度调用方式 | ✅ repeat(card, now) 四档一次计算、评分复用 preview 结果（ReviewView 落实）；createEmptyCard 语义正确；due≤now 到期判定、due 升序+priority 降序（Anki 惯例） |
| 复习日志 | ✅ 自建 review_logs（card_id/rating/reviewed_at/duration_ms）满足官方「持久化评分历史」要求与优化器最小输入；ts-fsrs 返回的 ReviewLog 被弃用（其信息可由日志+引擎重放复原，audit.cjs 即此原理）——接受并记录 |
| 优化器 | ✅ fsrs-rs-nodejs 0.9.1 官方 NAPI 绑定；FSRSReview(rating, delta_t=floor 天)/FSRSItem/前缀展开与官方 dataset.rs 一致；无效样本过滤符合官方防 panic 要求；computeParameters/evaluate 官方 API；权重 21 维校验→settings 注入→启动重建引擎 |
| Leech/挂起 | ✅ lapses≥8（Anki 默认）；挂起卡排除出到期队列 |
| **发现缺陷** | **F7**：`learning_steps` 未持久化 → learning 档第 2 步（10m）卡再评 Good 不毕业、永回 +10m（仅 Easy 能逃逸）——已修复（v20）；**F8**：优化器 `evaluate` 对「最后一条复习 delta_t=0（同日收尾）」的样本抛 InvalidInput（最小复现实锤：`[3:0,1:0]` FAIL / `[3:0,3:1,1:1]` OK），真实日志中学习/重学步同日恢复是常态、训练必报错——已修复（评估取可评估子集）；golden.cjs 曾断言 fuzz=true「应用侧」（v11 修复前残留）与契约矛盾——已纠正为 false |
| 记录在案的接受项 | `elapsed_days/scheduled_days` 不持久化（重算/只写不读，§4.4.1）；request_retention 固定 0.9 不可调（官方建议允许 0.8-0.95 个人化→可选池）；优化器权重注入为启动异步（理论上注入前首评用默认权重，影响一轮且自愈） |

先设计验证方法与流程（写入文档）再实现：构造长周期模拟数据，时间状态可整体平移（如平移 +10 天验证卡片 10 天后的状态），覆盖卡片生命周期每个环节（创建 → 首评 → 多轮评分 → 遗忘 → lapses/leech → 优化器训练输入）在各时间点的状态与调度正确性。与 `tests/fsrs/` 五件套（§4.4.6）互补，作为仿真回归层。（✅ 已按上方设计于 v20 完成）

### M4 — 快捷键（阅读 + 复习）+ 自定义 ✅（v21 实现；v22 增补撤销评分键）

> **v22 增补**：复习场景新增「撤销上一评分」（默认 Z，命令 id `review.undo`，命令表 12→13 条）——用户在复习中发现误评无撤回，要求补按钮+快捷键。撤销为一步（最近一次可撤销评分）：review_logs 增 `fsrs_before_json` 快照列，undo = 恢复快照 + 物理移除该条日志 + 回退本次触发的 leech 挂起；详见 §6.2 连续复习与 §4.4.4。Z 为本批选定默认键（避开阅读场景 Ctrl+Z；Anki 撤销惯用键），可在设置 → 快捷键改绑。

> **v21 完成情况**：① **CommandRegistry 落地**（§4.2-2）：`src/lib/commands.ts`（命令表 `COMMANDS` 12 条=下方锁定表；组合键规范化 `eventToCombo`——修饰符 Ctrl/Alt/Shift/Meta 固定序 + 空格记 `Space` + 字母大写，存储串=展示串；纯修饰键/`e.repeat`/输入焦点（input/textarea/contentEditable）绝不触发；抑制集合供设置弹窗与键位捕获期间挂起全局分发；命中即 `preventDefault+stopPropagation` 拦截 Ctrl+A/Ctrl+S 等原生命中）+ `src/lib/useCommands.ts`（组件动作表经 ref 注册，keydown 时刻读最新闭包，卸载注销）。**键位数据流**：默认键 → `settings.app.keybindings` 只存用户覆盖项（缺省=默认；重启重读 + settings/changed 同步缓存）→ 生效键。② **阅读四键** ✅：Reader 的制卡/AI 制卡/AI 解释/摘录动作提取为 act* 函数，选区菜单按钮与快捷键完全同源；`when`=存在活动选区且无手动制卡弹窗、无 AI 面板。③ **复习键** ✅：空格=显示答案（仅正面）；1/2/3/4=评分（仅背面，评分按钮在场时）；q=标记并暂停、w=跳过、d=删除（有卡即可触发、与翻面无关，删除仍走 confirm）；评分/暂停/跳过/删除带 busy 守卫防长按连发；**跳过不计入「本轮」计数为复习页既有语义，未改动**。④ **设置页「快捷键」区块** ✅：按阅读/复习分组展示 12 条；点键位框捕获新组合键（Esc 取消、纯修饰键继续等待、捕获期间抑制全局分发）；冲突检测（与其他命令生效键相同则拒绝保存并提示「与「X」冲突」）；单条「恢复」+「全部恢复默认」。测试：`tests/m4.test.cjs`（39 断言，node 直跑，依赖 esbuild 打包的 `tests/m4.commands.bundle.cjs`）+ `tests/m4.gui.mjs`（CDP 端到端 23 断言：阅读 Ctrl+Z/Ctrl+S、复习空格/3/q/w/1/d、设置区块捕获/冲突/恢复/持久化；**Ctrl+X/Ctrl+A 在用户已配置 Key 且 contextBridge aiAPI 不可覆写时跳过真实按键**以防真实 AI 调用——组合键解析由单测覆盖、动作函数与菜单按钮同源，安全与覆盖的最优平衡）。

默认键位（用户锁定）：

| 场景 | 动作 | 默认键 |
|---|---|---|
| 阅读 | 制卡 | Ctrl+Z |
| 阅读 | AI 制卡 | Ctrl+X |
| 阅读 | AI 解释 | Ctrl+A |
| 阅读 | 摘录 | Ctrl+S |
| 复习 | 显示答案 | 空格 |
| 复习 | Again / Hard / Good / Easy | 1 / 2 / 3 / 4 |
| 复习 | 撤销上一评分 | Z（v22 增补，用户需求） |
| 复习 | 标记并暂停 | q |
| 复习 | 跳过 | w |
| 复习 | 删除 | d |

实现走 CommandRegistry（§4.2-2，✅ 已随本批落地）；设置页支持自定义（冲突检测 + 恢复默认），落 settings.json。

### M5 — 手动制卡优化 ✅（v25 实现）

**v25 完成情况**：① 卡类型选择框 ✅（问答 / 翻转问答 / 填空题 / **图片挖空**四页签；图片挖空页签在「图片聚焦 → 手动制卡」时预填选区与预览，无选区时给出进入路径提示）；② **UDC 领域标签多选** ✅（`UdcPicker`：受控清单下拉 + chip 展示，≤2 个、首个标「主」对齐 R17，与统计/图表口径一致）；③ **字段对齐 AI 制卡** ✅（手动卡写入 contextPrefix / domain / mnemonic / knowledgePointId / dateStamp（可选「标注日期」→ 当日）/ priority + 既有 contextRef 四层锚点与 sourceRef；`generatedBy="manual"`）；④ **强制过 CardLintEngine + 相似检索** ✅（lint 输入补全 contextPrefix/domain/dateStamp/knowledgePointId/occlusion，S1 相似警告同 AI 路径）。
**同批修复 F12**：填空题手动制卡此前把**未转换的原文**存进 `frontMarkdown`（挖空语法只进了临时变量），复习端 `parseCloze` 找不到挖空 ord → 挖空从不遮蔽、卡片退化为普通问答；现改为把带 `{{cN::}}` 标记的文本写入 `frontMarkdown`（L2 测试 4h 锁定）。
**同批新增（用户需求）**：正文图片点选聚焦 + 三类形状选区 + 选区提交（AI / 手动），见 §6.2 阅读器小节与 D25。
**测试**：`tests/m5.test.cjs`（28 断言：像素↔百分比换算、包围盒、归一化钳制、形状可用性、SVG 图元、存量 rects 降级、L11 shapes 语义、用户选区 AI 链路不变量）+ `tests/reader.kernel.cjs` L0/L1 S16（图片点击语义化）+ `tests/reader.engine.mjs` 4c–4h（点选聚焦 / 模糊退出 / 画选区 / 手动制卡落库 / 填空题挖空标记）。

### M6 — 导入格式扩展（v26 起按最小单元拆批：M6-1 Word/TXT/MD → M6-2 PDF → M6-3 HTML+调研收尾）

支持 Word（.docx）/ TXT / Markdown / PDF（基础文本导入）作为阅读材料；调研其他常见学习材料格式（HTML、MOBI 等）。PDF 的 MinerU 云解析双栏不在主线（可选池）。

> **批次拆分与范围裁定（v26，用户拍板 2026-09-12）**：
> ① **M6-1 = Word（.docx，内嵌图必须保留并展示在阅读材料中）+ TXT / Markdown 导入**（本批）；
> ② **M6-2 = PDF 原生阅读**（v28 修订：pdf.js 直读原文件 + 页码锚点；v27 曾实现提纯文本方案，用户实测版面丢失不可接受，已废弃为全文检索备用工具；扫描版 OCR 仍另批/可选池）；
> ③ **M6-3 = HTML 文件导入 + 格式调研收尾**（浏览器插件剪藏仍留可选池）；
> ④ **Anki 牌组明确不做**（用户拍板：Anki 牌组都是已经制作好的问答卡片，不是阅读材料，不进增量阅读管线）。

> **M6-2 修订完成情况（✅ v28 实现，2026-09-12）**
>
> **背景（用户 2026-09-12 实测结论）**：v27 曾实现"提纯文本 → 合成 EPUB"方案（pdfjs 主进程提纯 → markdown → 同一 foliate 内核），用户实测版面丢失不可接受（双栏/表格/图片/版式全丢）。**此前从未集成过 Firefox/pdf.js 阅读器**——pdfjs-dist 仅用于主进程提纯，foliate 快照的 pdf 模块被剔除（view.js isPDF 分支 throw）。本批改为原生阅读；提纯函数（pdfToMarkdown）与 tests/m6-2.test.cjs 保留为全文检索备用工具。
>
> **渲染方案调研结论（2026-09 实测核实）**：pdf.js（Apache-2.0）是唯一同时满足保真渲染/文本层选词/大纲+搜索/可商用许可的开放方案；MuPDF.js 技术最优但 AGPL-3.0 与闭源商业化路线冲突；PDFium JS 绑定仅原型级（无文本层证据）；Electron 内置 Chromium PDF 查看器零程序化接口（拿不到选词/页码/大纲，只能看不能制卡）；商业 SDK 按量计费或销售议价不适合。**决策：用 pdfjs-dist 自带的 viewer 组件**（web/pdf_viewer.mjs，已随包安装，无需新依赖）。
>
> **Goals**：新导入的 PDF 直接存原文件 → 书架打开即 pdf.js 原生渲染（版面 100% 保真）→ 选词/选句制卡与摘录走既有四键管线 → 页码锚点（pageIndex + anchorText）支持跳转原文与进度恢复。
>
> **Non-Goals**：扫描版 OCR（仍拒绝并提示）；R4 的 Range 流式/200MB+ 按需加载（本批整本打开，后续批次）；EPUB/Word/TXT/MD 链路不动；FSRS/提示词/cloze 不动；**存量 PDF 书不动**（用户手动删除，不做迁移）。
>
> **技术方案**：
> 1. **渲染集成**：新文件 `src/lib/reader/pdf/adapter.ts` 实现 ReaderKernel（与 foliate adapter 并列）；PDFViewer 按页 canvas+文本层（自带虚拟渲染）；worker 配本地 pdf.worker.mjs，不通则主线程直跑（文档写明）。
> 2. **页码锚点**：kernel.ts ReaderSelection.cfi 改可选 + 增 pageIndex；ReaderLocation 增 pageIndex?；RelocateInfo.chapterIndex 改可选；goTo 增 {pageIndex}；service.createKernel(host, engine)（默认 foliate）；buildLocator 签发 readerEngineVersion="pdfjs-<ver>"；ReaderEngine 跳转顺序 cfi→pageIndex→search→fraction。
> 3. **数据/IPC**：db.readPdfFile（查 kind='pdf-original'）；createFromPdf 改为只存原文（不再跑提纯）；App.loadReaderBook 增 pdf 分支 → {engine:"pdf"} 透传 ReaderEngine；progress 兼容 {pageIndex}。
> 4. **Reader UI（一次做全）**：选区菜单四键与快捷键零改动；目录接 getTOC()（无大纲隐藏）；模式→单页/对开/滚动；字号→缩放；深色→canvas CSS 滤镜（真机确认，不好则降级"PDF 仅纸白"）；图片挖空经 canvas 快照进 ImageFocus 复用。
>
> **验收标准**：双栏论文/含表含图 PDF 打开即原版面；选词制卡可用（contextRef 含 pageIndex）；关闭重开回同页；扫描版仍拒绝；`tests/pdf.kernel.cjs` + `tests/m6-2native.gui.mjs` 全绿；M6-1（43/43）、M6-2 提纯单测（22/22，函数保留仍须绿）、阅读 L1/L2 冒烟全绿。
>
> **实现落点（v28）**：`src/lib/reader/pdf/adapter.ts`（PDFViewer 按页 canvas+文本层；文本搜索不用 findController，用逐页 getTextContent 确定性扫描；imageClick 取 canvas 快照 dataURL；目录 href=`pdfpage:N`；模式→单页/对开/滚动，外观深色→canvas 反色滤镜）+ `vendor.d.ts`（pdfjs 无打包类型，本地声明）；**ES2025 兼容层**（pdf.js v6 要 Promise.try/Map.getOrInsertComputed/Uint8Array.toHex，Electron 31/Chromium 126 缺失：主线程补丁在 adapter.ts，worker 补丁经 `scripts/postbuild-pdf-compat.cjs` 前置进 dist worker（补丁源 `tests/pdf.compat.js` 单一来源；npm run build 已串接），Electron 升级到 Chromium 133+ 后删除）；public/pdfjs（cmaps+standard_fonts，Vite 直拷 dist，CJK 必需）；kernel.ts 页码锚点（ReaderSelection.cfi 可选+pageIndex、ReaderLocation.pageIndex?、RelocateInfo.chapterIndex 可选、goTo 增 {pageIndex}）；service.createKernel(host, engine)（默认 foliate）；buildLocator 签发 readerEngineVersion="pdfjs-6.3.289"；db.readPdfFile + IPC library:readPdfFile；createFromPdf 改为只存原文（轻量文本层扫描判扫描版，不再提纯；提纯函数保留为全文检索备用）；App.loadReaderBook pdf 分支 {engine:"pdf"} 透传 ReaderEngine（跳转 cfi→pageIndex→search→fraction；initLocation 兼容 pageIndex）；目录无大纲隐藏；theme.css 补 viewer 容器尺寸（否则可视计算全 0 不渲染）。**测试**：`tests/pdf.kernel.cjs` 14 断言（esbuild 异步打包+url-text 插件内联 worker 文本为 Blob URL+CSS 文本注入）+ `tests/m6-2native.gui.mjs` CDP 20 断言（连续两次全绿；原生渲染/canvas+文本层/目录跳章/选词制卡 pageIndex/摘录/重启回同页/清理）；回归 M6-1 43/43、M6-2 提纯 22/22、L1 44/44、L2 20/20。**已知限制**：整本打开（Range 流式后续批次）；PDF 内嵌图片不单独提取（页内图片经 canvas 快照走 ImageFocus 复用）；旋转/竖排页面未适配。
>
> **v28.1 用户实测排障补记（2026-09-13，952 页 50MB 中文书）**：① 渲染进程 file:// 页面 fetch/XHR file:// 子资源被 Chromium 拦截（字形数据全失败→白轮廓无文字+重试风暴）——新增 **`pdfres://` 特权协议**（main.js 注册 standard/secure/supportFetchAPI/stream，host=cmaps|standard_fonts|iccs|wasm，资源=public/pdfjs 构建时拷 dist/pdfjs），adapter 四类资源 URL 全走 pdfres（**icc/wasm 缺一不可**：v6 新增 ICC 色彩与 JPX/JBIG2 wasm 解码器，缺 wasm 时封面 JPX 图片解码失败且渲染任务可挂起）；② 主进程导入扫描的字体 URL 须为**正斜杠普通路径**（NodeBinaryDataFactory=fs.readFile，file:// 字符串被当路径必败）；③ **backgroundThrottling:false** 入 webPreferences——窗口遮挡时 Chromium 暂停 rAF，pdf.js 渲染任务会永远停在 RUNNING（canvas 已建但不挂载 DOM、无任何报错，现场曾误判为代码回归——44de302 纯净态复测同样失败后才锁定环境因素）；④ 书页宽度不一可能为 PDF 本征混排尺寸（探针实测本征宽 342–1080pt 混排），非渲染 bug；⑤ PDF 文本层乱码（选区复制出无意义字符）= 该 PDF 内嵌字体缺 ToUnicode 表，属文件自身数据缺陷，非渲染器问题。诊断方法论：CDP Target.setAutoAttach 抓 worker 控制台 + `__pdfViewerDebug` 钩子看 renderingState/canvas 挂载 + canvas getImageData 像素采样判定"真渲染 vs 白板"。
>
> **实现落点（v27）**：新增依赖 `pdfjs-dist`（6.3，legacy 构建主进程动态 import，CommonJS 内 `await import()` 启动零开销；cMapUrl/standardFontDataUrl 必须以正斜杠 `/` 结尾否则 factory 校验报错）；`electron/importers.js` 增 `pdfToMarkdown`（提取→行（hasEOL+y 双信号）→段落（25 分位行距 + 缩进启发式）→章节化三优先级→跨页段落愈合（上页末段无终止标点则与下页首段合并，CJK 粘连/ASCII 补空格）→扫描版拒绝）与纯函数 `itemsToLines/linesToMarkdown/headingCandidates/joinPageMarkdown/pdfOutline`；`electron/db.js` 复用 `createImportedDoc`（source_type=pdf，原文件 kind=pdf-original）；IPC `library:pickPdf`+`library:createFromPdf`（返回 {id,title,pages,emptyPages,chapters,outlineUsed}）；`libraryApi.pickImport/createImported` kind 联合类型扩 "pdf"；AddBookModal 增「导入 PDF」按钮 + emptyPages 提示。**测试**：`tests/m6-2.test.cjs`（22 断言：书签大纲/字号标题/页分块/单章回退/扫描版拒绝/空页统计/跨页愈合/CJK 纯函数/确定性；手工构造无压缩 PDF 夹具——PDF 内容流不支持 CJK 字面量，CJK 正确性由纯函数层覆盖）+ `tests/m6-2.gui.mjs`（CDP 自启自关 15 断言：导入/扫描版拒绝/source_type/assets/目录跳章/正文渲染/选区制卡 CFI/重启不丢/清理）；M6-1 回归 43/43 全绿。**已知限制**：版面保真渲染（R4 PdfAdapter 按页虚拟渲染）为后续独立批次；PDF 内嵌图片不提取；旋转/竖排页面未适配。

> **M6-1 完成情况（✅ v26 实现，2026-09-12）**
>
> **Goals**：.docx（含正文图片）/ .txt / .md 成为一等阅读材料——选文件 → 转 markdown+图片 → 走既有 `buildSyntheticEpub` 确定性合成管线 → 同一 foliate 内核阅读（目录/滚动分页/选区制卡走 detectMaterialType/CFI 锚点/M2 备份覆盖全部继承，零内核改动）。
>
> **Non-Goals**：PDF（含任何 OCR）→ M6-2；HTML 文件导入 → M6-3；Anki 牌组（用户拍板永不）；不改 FSRS/权重/提示词文本/cloze 契约；不修 `splitMarkdownChapters` 空首章技术债（改结构会致存量 CFI 失效，须随 SYNTH_GENERATOR_VERSION 升级另批处理——注意本批 syn-2 升级仅增图片能力，章节切分逻辑未动，见下）；MinerU 双栏在可选池。
>
> **技术方案**：
> 1. **合成管线图片支持（本批唯一结构性改动）**：`buildSyntheticEpub(title, markdown, opts?)` 增 `opts.images?: [{filename, bytes, mediaType}]`——① 章节 bodyHtml 内 `<img src>` 重写为 `images/<filename>`；② OPF manifest 追加 image 条目（spine 与 nav 不动）；③ `zip.file("OEBPS/images/…")` 落二进制；④ 图片字节 hash 折入 `dc:identifier` 的 stableHash 输入（同 markdown 不同图不再碰撞）。**`SYNTH_GENERATOR_VERSION`: syn-1→syn-2**（结构变更纪律 §7.1.11：存量粘贴书已存 CFI 走既有降级链——章节索引+anchorText→全文搜索；粘贴书无图时合成结构与 syn-1 逐字节同构，仅版本号元数据变化）。
> 2. **Word**：新增依赖 `mammoth`，`convertToHtml` + `convertImage`（`imgElement` 异步收集 `{bytes, contentType}`，文件名按出现序确定性命名 `img0/img1/…`）；mammoth HTML → 既有 turndown+DOMPurify 管线（放行 img，禁 style/script）→ markdown（`![](images/imgN.ext)` 占位）。DB `documents.markdown` 只存轻量占位文本，图片字节只进 EPUB。单书图片总量上限沿用资产 10MB 思路（超限导入时提示并中止）。
> 3. **TXT**：主进程读字节 → 编码检测（UTF-8 BOM / 无 BOM 试 UTF-8 严格解码 → UTF-16 LE/BE BOM → GBK 回退）→ 换行归一化（CRLF/CR→LF）→ 空行启发式段落化（不碰 `splitMarkdownChapters` 本体，输入侧产出合法 markdown；标题回退=文件名去扩展名）。
> 4. **Markdown**：读文本（同上编码检测）→ 直通作 markdown 输入（`html:false` 防注入由合成管线保证）。
> 5. **DB/IPC/UI**：`electron/db.js` 新增 `createFromWord/createFromTxt/createFromMarkdown`（照抄 `createFromEpub` 形状：library_items+documents 双写 + 原文件落 assets kind=`word-original/txt-original/markdown-original` + persist + library/changed）；`source_type` 新增 `word/txt/markdown`，凡写死 `source_type IN ('paste','epub')` 的查询一并放行；读取侧零改内核（`App.loadReaderBook` 的「epub→原书，其余→synth」二分支天然覆盖）；IPC `library:pickWord/pickTxt/pickMarkdown` + `library:createFromWord/Txt/Markdown`；`AddBookModal` 增三入口，`Bookshelf` 空态文案同步；M2 备份自动覆盖新资产（无需改 backup.js）。
>
> **格式调研结论（v26 定案，M6-3 只补 HTML 导入实现）**：
> | 档 | 格式 | 处置 |
> |---|---|---|
> | 必须支持 | EPUB（已成）、DOCX（M6-1）、TXT（GBK 检测为中文刚需）、Markdown（M6-1）、HTML（M6-3：单文件导入 Readability+turndown+DOMPurify）、PDF（M6-2 纯文本先行） | 按 M6-1→M6-2→M6-3 推进 |
> | 被动兼容（零投入） | MOBI/AZW3、FB2、CBZ（foliate 内核已可直读） | 保留内核直读，不写导入代码、不合成 |
> | 跳过 | **Anki 牌组（用户拍板）**、KFX（DRM 无开放库）、CBR（RAR 许可摩擦）、DJVU（遗留，扫描书走 PDF+OCR）、CHM（遗留）、ODT 与 .doc 二进制（提示「另存为 .docx」）、RTF（低频） | 导入对话框不支持即自然表达 |
>
> **验收标准**：三种格式各至少 1 真实文件走通「启动→导入→阅读（Word 内嵌图全可见且位置正确）→选区制卡/摘录→重启不丢」；原文件 assets 可回读；中文（GBK）无乱码；新书可进 Topic 队列与 FSRS；`tests/m6-1.test.cjs` 全绿（Word 含图转换/TXT 编码与归一化/MD 直通/合成 EPUB 图片 manifest 与确定性）。
>
> **实现落点（v26）**：`SYNTH_GENERATOR_VERSION` syn-1→**syn-2**；`src/lib/epub.ts` 增 `SynthImage/rewriteImgSrcs/mediaTypeForFilename/imageHashSuffix`；新增 `electron/importers.js`（mammoth convertImage 收集内嵌图、主进程直跑 turndown（ATX 标题 + 自实现 GFM 表格规则）、EMF/WMF 跳过、单书图片总量 10MB 守卫、`decodeTextBytes` 编码检测（UTF-8 BOM/严格 UTF-8/UTF-16 LE/BE/GBK 回退，原生 TextDecoder 零新增依赖）、`txtToMarkdown` 逐非空行成段、`markdownFromText` 直通、`titleFromFilename`）；`electron/db.js` 增 `createImportedDoc`（source_type=word/txt/markdown，原文件 kind=word/txt/markdown-original，内嵌图 kind=image-content）+ `readContentImages`；IPC `library:pickWord/pickTxt/pickMarkdown` + `library:createFromWord/Txt/Markdown` + `library:readContentImages`；`libraryApi.pickImport/createImported/readContentImages`；AddBookModal 增 Word/TXT/Markdown 三按钮；`App.loadReaderBook` word 分支取图随合成落包。**测试**：`tests/m6-1.test.cjs`（43 断言，node 直跑，每次运行前 esbuild 重打包 epub.ts，?raw CSS 插件）+ `tests/m6-1.gui.mjs`（CDP 自启自关 23 断言：三格式导入→assets 落盘→Word 内嵌图 foliate 内核真实渲染（blob 重写+naturalWidth>0）→GBK 无乱码→选区制卡 CFI→重启不丢→清理）。**已知体验债**：markdown 以 `# ` 开头的文档（Word 常见）打开落在空首章（§9.4 既有技术债），经目录跳转可达实际章节，随未来 syn 版本升级一并修复。

### M7 — 词典

参考 GoldenDict-ng（https://github.com/xiaoyifang/goldendict-ng）与原版 GoldenDict（https://github.com/goldendict/goldendict），研究部分集成或自行实现：

- 选中单词自动弹出发音 + 释义；一键制卡且记录单词所在原句上下文。
- 单词卡四种形式：看中文回忆外文单词和发音；看外文回忆发音和中文意思；听发音回忆外文和中文；展示原句上下文并对选中词挖空回忆挖空内容。
- 调研可集成的在线词典（须含单词释义和发音、且有成熟集成方法）；支持用户手动导入词典。

### M8 — 日记与 AI 洞察（学习材料的第二输入通道）

> **构想来源（用户 2026-09-09）**：学习材料分两类——① **他人创造的**（书、文章、视频文案等，软件现有全部输入通道均属此类）；② **自己感受到的**（日常事件引发的感悟与思考，此前没有输入通道）。人在记录感受时的倾向与选择学习材料时的倾向很可能相似，因此日记作为**主动记录的学习内容输入**，是已学知识的一种**边界拓展**：今天的思考可能源于此前在软件中学过的某个方向的知识；也可能当下并无关联，但将来学习的他人创造的材料会与从前的日记产生联系——日记与知识库之间存在双向的潜在关联，由 AI 洞察来发现。

目标：提供随想随记、无需整理的流式日记（Logseq 式按日期流水记录），并提供「洞察」入口，由 AI 发现日记与已学知识之间的联系，或洞察有趣、有用的关联。

内容：

1. **数据层**：新增日记条目表（日期 + 文本/轻 Markdown，含 §1.2 留位字段）与洞察记录表；条目可补记、可编辑，但不做整理性结构要求（无强制标签/分类/双链）。
2. **日记界面**：主导航新增「日记」页，Logseq 式按日期倒序的流式时间线；随想随记、记入即可，无需反复整理。
3. **「洞察」按钮**：日记页的主操作，位置依设计系统规范（§5）在实现时确定；点击触发 AI 洞察——**按需触发，不做后台自动分析**。
4. **AI 洞察**：将日记（默认近期，洞察范围实现前与用户确认）与已学知识（UDC 领域、卡片、摘录、在读书籍）打包为上下文，输出：日记与已学内容的关联（某条感悟 ↔ 某本书/某张卡/某个领域）、跨条目的主题汇聚、开放性的追问；洞察结果可保存、可跳转到被关联的原文/卡片；随知识库增长重复洞察，会发现旧日记与新学材料之间的关联（第二方向）。
5. **洞察去向**：发现值得沉淀的感悟时提供「就此制卡」入口（复用既有制卡管线 + CardLint，§4.2-18）；洞察提示词遵循 M1 纪律——先测试台验证，再播种新版本。

Non-Goals：日记不进 FSRS 队列、不强制制卡（D18 精神——日记是输入面，不是复习面）；不做日记的强制整理与云端同步；洞察不自动定时触发。**v24 补充（LKM 联动）：日记只产生 demand signal（现实问题/需求信号 → 知识缺口 → Frontier），禁直接写 mastery；除非用户随后完成实际学习/回忆/应用任务（§4.7.9 sourceType=diary_signal）。Insight 三层证据与 Meaning 图见 §4.13。**

### M9 — 在线功能（商业化前置）

执行顺序（每步先报告再动手）：

1. **数据收集**：先检查 Hermes 方案（`docs/SPEC-usage-telemetry.md`）是否可行、是否与项目冲突；通过后**先向用户描述用户真实使用时接触数据收集相关功能的先后顺序及展示方式**（哪些界面/信息，如首启隐私政策、设置开关），确认后实施。目标：用户数/活跃度/AI 调用量，作商业化决策依据；须守规格红线（同意后才发首个字节、不采集内容、关闭即零上报）与 §1.1 纯本地边界（可开关、不阻塞启动）。
2. **反馈入口 + 社群链接**：设置页顶部增加反馈入口（发送至专用邮箱）；社群链接（QQ 群、X、哔哩哔哩、小红书及其他主流社群）。
3. **检查更新**：设置中添加检查更新功能及按钮；添加可开关的「启动时自动检查更新」选项。
4. **AI 服务多提供商预设**：用户未配置 Key 时，设置页 AI 服务直接以模型提供商名称为选项（选中只填 API Key，baseURL 默认配置好；同一提供商有不同 baseURL 时支持切换）；粘贴 Key 窗口旁提供「获取APIkey」一键跳转链接；**先核实各主流提供商有无邀请返利活动**，有则把邀请码编入链接。
5. **API key 分发方案研究**：基于收集的数据与模型供应商谈判低价 token，或自购低成本订阅包 → 用户向开发者充值、以低于官方价但高于成本价取用 token；研究充值与 token 分发在软件内的实现方式。

### M10 — 官网

为软件设计并搭建官网。

### M11 — 界面自定义与主题社区

调研 Obsidian / Logseq 的界面自定义实现（主题格式、CSS 注入、可调项声明），借鉴到本软件：允许用户自定义界面主题，并留出将自定义主题上传到社区主题库的渠道。压轴原因：依赖插件/主题宿主（§4.14，未实现）落地，且主题社区需服务端，与「纯本地优先」的边界届时单独决策。

## 9.2 主线状态表

| 批次 | 内容 | 状态 |
|---|---|---|
| R1 | 阅读内核（一切皆书 + 防腐层 + CFI + 目录/模式/外观） | ✅ v20 实现（L1 38 项 + L2 11 项断言全绿；CJK ruby/竖排夹具通过） |
| R2 | 高亮标注 | ❌ |
| R3 | 阅读个性化完善 | ❌ |
| R4 | PDF + Word/TXT/MOBI（合流 M6） | ❌ |
| M1 | AI 制卡体系升级（四卡形式/材料路由/提示词测试台/覆盖核对） | ✅ v15 实现，v16 修订（D18 两张独立卡）；映射表确认与 v4 候选实测待用户 |
| M2 | 数据备份与恢复（手动 + 自动滚动 + 恢复保护） | ✅ v18 实现（手动/自动/恢复全链路 + CDP 端到端验证） |
| M3 | FSRS 时间轴模拟验证 | ✅ v20 实现（L5 仿真层 + 官方做法审计 + F7/F8 修复）；✅ v23 加固增补（时间语义统一/参数环境/原子提交/Undo 不变量，F9-F11 修复） |
| M4 | 快捷键 + 自定义 | ✅ v21 实现（CommandRegistry 落地 + 阅读四键/复习键 + 设置页冲突检测与恢复默认）；v22 增补撤销评分（Z） |
| M5 | 手动制卡优化（类型选择/领域标签/流程对齐）+ 正文图片点选聚焦与形状选区 | ✅ v25 实现（四类型页签 + UdcPicker + 字段对齐 AI + CardLint/S1；点选聚焦三类选区 AI/手动提交；F12 填空题挖空落库修复） |
| M6 | 导入格式扩展（拆批：M6-1 Word/TXT/MD → M6-2 PDF 纯文本 → M6-3 HTML+调研收尾；Anki 不做） | ✅ M6-1 v26（Word 含内嵌图/TXT/Markdown）+ ✅ M6-2 v28 原生阅读（pdf.js 直读 + 页码锚点；v27 提纯方案已废弃为备用）；M6-3 待做 |
| M7 | 词典（取词/发音/上下文制卡/词典源/本地导入） | ❌ |
| M8 | 日记与 AI 洞察（流式日记 + 洞察按钮 + AI 关联分析，第二输入通道） | ❌ |
| M9 | 在线功能（数据收集/反馈/更新/多提供商/API 分发） | ❌ |
| M10 | 官网 | ❌ |
| M11 | 界面自定义 + 主题社区 | ❌ |
| K0–K8 | Learner Knowledge Model（v24 架构定稿，纯文档；实现按 §9.1 K0–K8 分批） | 📐 v24 定稿（§4.5–§4.13 + §6.3.11–12 + §7.6 + D24）；实现未启动 |

## 9.3 历史阶段存档（已实现）

| Phase | 内容 |
|---|---|
| 0 / 1 | 空壳启动/主题/设置；粘贴成书 |
| 2 | 阅读器 + 摘录 + 队列（基本完成） |
| 3 | 手动制卡 + FSRS（调度连续性验收见 tests/fsrs） |
| 4b | EPUB 导入 |
| 11 部分 | AIGateway（插件市场未做 → 可选池） |
| 12 部分 | AI 阅读助手（解释侧栏/就此制卡/跳转原文；「插入原文回写」→ 可选池） |
| 13 / 14 | AI 制卡主路径；Leech 六步 |
| 15 部分 | 干扰检测查重警告（对比卡向导/编辑会话/补进度 → 可选池） |
| 16 部分 | 遮挡卡数据结构与浏览页渲染（生成链路 → M1） |
| — | 统计仪表盘（用户主导）/ FSRS 优化器（v12）/ 界面 v12.2 重设计 + 跳转原文 + 编辑 |

## 9.4 可选更新池与技术债（未排期，不得自行领取）

| 项 | 原编号 | 说明 |
|---|---|---|
| 浏览器插件（网页剪藏） | 5 | 用户指定降级可选。路径：安装逆向 Skill（https://github.com/zhaoxuya520/reverse-skill）研究 Obsidian Web Clipper（https://github.com/obsidianmd/obsidian-clipper）的实现，据此做简化版浏览器插件——网页阅读内容一键保存到软件作为阅读材料 |
| PDF MinerU 双栏 | 4 | 云解析双栏阅读；M6 只做 PDF 基础文本导入 |
| 摘录优先级选择 + 负载感知推迟 | 2.1/2.2 | 现为 ×1.6 占位（§6.4） |
| Z-lib/Anna 连接器 | 6 | 站点见附录A |
| 视频 + AI 总结 | 7 | Bilibili/YouTube Provider |
| 背景音 | 8 | Moodist 内置 + 外链 |
| 灵动岛状态栏 | 9 | 顶栏已改文字导航，需重定义 |
| TODO/番茄 | 10 | |
| 插件市场全量 | 11 | M11 只做主题上传渠道，非全量市场 |
| 插入原文回写 ai-supplement | 12.2 | |
| 对比卡向导/编辑会话/补进度 | 15 | |
| 手动遮挡编辑器 | 16 | **仅剩「整图手动遮挡编辑器」与「既有卡片的遮挡区域编辑器」**；v25 起「为创建卡片而手绘区域」已实现（D25：正文图片点选聚焦 + 三类形状选区） |
| 每日上限 / 全局混编 / 「不再关心」 | — | §6.3.8 规划项；每日上限的「学习日」口径已具备（v23 settings.app.dayCutoffHour） |
| epub.js 兜底 adapter | — | foliate-js 不可用时的 Kernel 第二实现预案（epub.js 维护停滞，仅应急）； foliate pdf 模块（R4 验证，Anx Reader 已生产验证但上游标 experimental） |
| better-sqlite3 迁移 | 技术债 | sql.js 全量回写，数据量显著增长后迁移（接口已对齐） |
| electron-builder 打包 | 技术债 | 未配置，无安装包 |
| 历史数据兼容 | 技术债 | v11 前卡片 fsrs_json 无 S/D（基线回填）；存量 cloze 卡 hint 拆答案（渲染层已兼容）；存量摘录/部分卡片无锚点（降级上次阅读位置）；存量遮挡卡无 shapes（渲染层按 rects 矩形降级，v25） |
| 粘贴书合成 EPUB 的空首章 | 技术债 | markdown 以一级标题开头时，`splitMarkdownChapters` 会先压入一个空章（正文为空），阅读器首屏为空白页且目录多一项（L2 测试 toc=4 即此现象）。修复会改变合成结构 → 存量粘贴书已存 CFI 失效（§7.1.11 表述红线），须随 `SYNTH_GENERATOR_VERSION` 升级一并处理（届时走锚点降级链：章节索引+anchorText→全文搜索） |

## 9.5 下一步

M6-1 已于 v26 实现完毕（Word（.docx 含内嵌图）/ TXT / Markdown 导入，合成管线图片能力 syn-2，见 §9.1 M6）。M6-2 v27 提纯方案已验证不可行并废弃为备用工具（用户实测版面丢失）。M6-2 已于 v28 修订完毕（PDF 原生阅读：pdf.js 直读原文件 + 页码锚点，见 §9.1 M6；存量 PDF 书不迁移，用户手动删除）。接下来 **M6-3 HTML 导入 + 格式调研收尾**（调研结论 v26 已定案见 §9.1 M6；**Anki 牌组用户拍板不做**）。提示词调优闭环随时可由用户启动（打开 `prompt-lab/` 测试台 → AI 改提示词 → 手动实测 → 反馈 → 决定是否并回）；M1 遗留的映射表确认与 v4 候选实测仍待用户。

## 9.6 LKM 实施路线 K0–K8（v24 定稿，一次只推进一批）

> 设计稿 §75–§84 经打磨收敛。K0 为纯设计批次（Non-Goals：不改复习逻辑、不改 AI 制卡 UI、不实现图谱 UI、不实现推荐、不实现联网搜索；只做 interfaces/contracts/算法规格/测试与迁移策略）。旧 `cards.knowledge_point_id/domain` 迁移为 KP 别名与 legacy domain，不删列。

| 批次 | 内容 | 测试重点 |
|---|---|---|
| K0 | 知识模型规格（本文 §4.5–§4.13 即 K0 交付物） | 契约评审：三不变量/FSRS 隔离/字段封闭性 |
| K1 | KP + Relation 地基（`knowledge_points/relations/external_refs/proposals` + 归一合并 + 生命周期） | merge/唯一性/环检测/别名/软删除/迁移 |
| K2 | AI 提案管线（5 独立 scope 播种 + staging 确认 + KnowledgeLint K2–K8） | 未知关系处理/confidence/重复 KP/拒收卡不产 evidence/接受卡建链 |
| K3 | Evidence + State（`knowledge_evidence/states/probe_runs` + BEMM + 分层探针） | 仿真轨迹 Good/Good/Again/Application/Transfer 下三维度独立变化 |
| K4 | Frontier 引擎（六因子 + 四档挑战） | challenge fit / frontier ranking |
| K5 | 材料画像 + 本地推荐（profile 表 + 两阶段 + 解释） | 20 在读 + 50 无关材料的 candidate ranking + explain |
| K6 | 联网发现（search provider + 画像 + 同管线排序） | 内容不编造/画像生成/同本地管线 |
| K7 | 日记信号（M8 联动：demand → 缺口 → Frontier，禁直写 mastery） | 日记只产 demand、有任务才转 evidence |
| K8 | 可视化动画（2D 力导 + runs 计数回放） | 真实数字驱动（gaps/frontier/materials/recommended），禁假扫描 |
| E | 下一条摘录推荐（§6.4.1–6.4.2，一步到位，随 K4–K5 落地） | 20 在读 + 50 无关摘录中"前置刚补上"条排第一且解释与快照一致；拒收卡不产 evidence、制卡只产弱证据；未知 status 前向兼容为 open |

LKM 双轨调优（§4.11）与一键上传（§7.6）随 K3 起并行落地，不单独占批次。

---

## 附录A — 参考项目网址（锁定）

- xiadown：https://github.com/arnoldhao/xiadown ；Bili.Copilot：https://github.com/Richasy/Bili.Copilot
- Bilibili-Obsidian-Clipper：https://github.com/haixiong1997/Bilibili-Obsidian-Clipper
- MinerU：https://mineru.net/apiManage/docs ；https://github.com/opendatalab/MinerU
- FSRS：https://github.com/open-spaced-repetition （ts-fsrs / fsrs-rs / fsrs-rs-nodejs / fsrs-browser）
- Obsidian Clipper：https://github.com/obsidianmd/obsidian-clipper ；Omnivore：https://github.com/omnivore-app/omnivore
- Hypothesis：https://github.com/hypothesis/browser-extension ；Memex：https://github.com/WorldBrain/Memex
- Moodist：https://github.com/remvze/moodist ；Endel：https://app.endel.io/
- Z-library：https://zh.articles.sk/ ；Anna's Archive：https://zh.annas-archive.gl/ ；singlelogin：https://singlelogin.co

## 附录B — EPUB 与阅读内核实现备忘（v20）

- 导入（不变）：`@likecoin/epub-ts`：JSZip 解包 → container.xml/OPF/spine → 章节 XHTML → Markdown 入库 → TOC 存 tocJson；原包存 Asset{kind:epub-original}（assets/<itemId>/original.epub，阅读内核经 `library:readBookFile` 读取）。DRM 书跳过并提示。
- **阅读（v20 内核化）**：EPUB 原书由 vendor foliate-js 渲染（blob iframe + CSS 多列分页）；**锚点 = EPUB CFI**（foliate epubcfi 生成/解析），导入期 DOMPurify 剥离 id 不再影响定位（CFI 基于渲染后结构）。
- **合成 EPUB（粘贴书/摘录）**：`src/lib/epub.ts buildSyntheticEpub`——markdown-it→HTML（html:false 防注入）、`^# `一级标题章节化、KaTeX renderToString 自包含（?raw 内嵌 katex.min.css 首章）、`SYNTH_GENERATOR_VERSION` + 确定性哈希 id 守卫（**同版本+同输入必然同构**，已存 CFI 不因重新生成错位；禁止在生成管线引入时间戳等不确定因素）。
- foliate 快照治理：`vendor/foliate-js/MANIFEST.json`（upstream/commit/importedAt/localPatches——当前补丁：pdf.js 分支剔除，R4 另行 vendor）；升级走 §7.1.10 规程。
- 已知限制：foliate paginator 上游自述「慢、部分 CSS 不合预期」；ruby 标签曾报影响渲染与搜索（#124），L1 CJK 夹具持续回归；竖排支持经逻辑属性实现（#36 已关闭），渲染质量属 L3 人工冒烟范围。
