# 一站式渐进阅读学习软件 — AI 开发指导文档（v13，六部分重构版）

> 本文档是后续所有开发的唯一依据。AI 在任何一次迭代中，必须严格按本文锁定的技术方案和接口实现，不得擅自更换技术栈、引入云端依赖、一次性做多个功能。
> 核心原则：**纯本地软件 / 最大灵活性 / 每次只实现一个最小单元 / 需求可变**。
>
> **文档结构导读（v13）：** 全文按六个关注域组织——
> **第一部分 Architecture（架构）**：技术栈、进程与模块、数据模型、接口抽象、AI 管线、FSRS 调度契约、插件体系。
> **第二部分 Design System（设计系统）**：瑞士风基线、Token、顶栏导航、页面排版、组件规范、皮肤体系。
> **第三部分 Product Spec（产品规格）**：核心用户流程、已实现功能规格、AI 制卡与助读体系（含提示词锁定基线与质检规则）、Topic 队列。
> **第四部分 Coding Rules（编码规则）**：硬性约束、数据完整性、测试义务、提示词/配置管理、安全。
> **第五部分 Decisions（决策记录）**：关键决策日志与已接受偏差。
> **第六部分 Roadmap（路线图）**：Phase 状态表、技术债、下一步候选。
> 历史变更记录（v6–v12）压缩至第五部分 5.3。

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
| Markdown/公式渲染 | react-markdown + remark-math + rehype-katex | 复习卡与阅读器一致 |
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
                     Reader / SettingsPanel / dashboard（统计）
  lib/               fsrs（调度封装）/ cards（CardLint+cloze+AI 制卡）/ ai（网关客户端）/
                     readingWorkflow（SM19 Provider）/ library / settings / eventbus /
                     epub / stats / udc
  skins/             皮肤注册表（默认 + xiadown）
tests/fsrs/          FSRS 黄金参考回归套件（见 §9.6）
```

启动加载顺序（决策 D6）：`dist/index.html` 存在则 `loadFile` 直用；不存在（纯开发）才尝试 vite dev server。

## 4. 数据模型与接口抽象

### 4.1 数据表（9 张）

核心业务表带 `userId/updatedAt/syncVersion/isDeleted` 四件套，删除一律软删除：

- **users / library_items / documents / assets / extracts / cards / card_issues / ai_gen_batches / review_logs**（另有 review_skips）
- `cards.fsrs_json`：**全字段持久化** `{state,due,lapses,stability,difficulty,reps,lastReview}`（§7.1 契约）
- `cards.context_ref_json`：`{documentId, extractId?, anchorText?, anchorRatio?}`——跳转原文锚点
- `extracts.context_ref_json`：同上（v12.3 新增，含旧库迁移）
- `cards.leech_json`：`{isLeech, suspended, suspendedAt, resolution}`
- `prompt_templates`：版本化提示词（当前 v3，旧版留痕）

### 4.2 必须保留的接口/抽象（19 项，任何 Phase 不得绕过）

1. `EventBus`：唯一事实通道。锁定事件：`stats/updated, library/changed, todo/changed, pomodoro/tick, pomodoro/phaseChange, theme/changed, settings/changed, ai/stream, workflow/changed, cards/changed, ai/batchDone, leech/detected`
2. `CommandRegistry`：动作注册 `{id,title,when,keybinding}`（规划中）
3. `SettingsStore`：三层 `app / theme / plugin.<id>`，settings.json 持久化
4. `PluginHost`：`load/unload/enable/disable + contributes`（规范见 §2.5，未实现）
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

### 4.4 FSRS 调度契约（硬性，v11 定）

1. **全量持久化**：`fsrs_json` 含 `{state,due,lapses,stability,difficulty,reps,lastReview}` 全字段且下轮全量回填；禁止部分字段序列化 + createEmptyCard 兜底（兜底仅限首次创建）。
2. **fuzz 锁定 false**：预览值即算法真实值。开 fuzz 须先改本文档。
3. **预览与调度同源**：preview() 一次算四档完整结果（含落库状态），评分复用；「所见=所存」是验收硬条件。
4. **复习后附加动作不得改 fsrs_json**：leech 标记走字段级 `leech_json` 更新（cards:updateLeech），禁止整卡快照回写。改卡内容先取库内最新状态合并。
5. **到期队列**：due 升序、同 due priority 降序；复习视图 30s 轮询。
6. **回归测试义务**：调度相关改动合入前 `tests/fsrs/` 五件套全绿（L0 golden / L1 adapter / L1 补强 / L2 db / L4 audit，共 57 断言）。
7. **参数优化器**：`fsrs-rs-nodejs` 从 review_logs 训练 21 维权重；无效样本过滤（单次复习卡/全同日卡/无跨天间隔前缀，防 Rust panic）；权重经 `settings.app.fsrsWeights` 应用、引擎启动注入；手动触发；失败返回 `{ok:false}` 不阻塞调度。

### 4.5 插件/主题体系（规范，未实现）

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
- 跳转链接：`跳转原文 →`（accent 色 Meta 档文字按钮，hover 下划线），出现于复习卡 meta 行与队列摘录条目（仅带锚点数据时）。

## 5.5 皮肤体系

默认皮肤 = 瑞士风（`skinId:"none"` 即基线本体）；已注册 xiadown 玻璃拟态为第二皮肤（表现层覆盖，不影响业务逻辑）。新皮肤按 §4.5 规范另立，先规范后代码。

---

# 第三部分 Product Spec（产品规格）

## 6.1 核心用户流程

书架（粘贴/EPUB 成书）→ 阅读器（选中文字 → 手动制卡 / AI 制卡 / AI 解释 / 摘录；制卡与摘录**记录选区锚点**）→ 学习队列（摘录 Topic，推迟/打开/跳原文）→ **连续刷题复习**（自动出下一张、评分四按钮、跳过/标记暂停/删除、跳转原文并可返回恢复现场、双面内联编辑）→ 卡片浏览（到期列表 + Leech 六步处理）。设置：主题/皮肤/强调色/AI 服务（4 预设+思考强度）/FSRS 优化/统计仪表盘。

## 6.2 已实现功能规格（v12.4 状态）

- **书架**：粘贴成书、EPUB 导入（封面/TOC）、上次阅读位置、删除（软删）。
- **阅读器**：进度保存恢复（ratio+lastText）、选中操作菜单、KaTeX 公式、AI 解释侧栏（流式+思考状态行+追问+就此制卡+联网背景检索）、AI 制卡面板（流式字数/思考字数进度、CardDraft 逐条接受/编辑/整批拒绝、AIGenBatch 留痕）、锚点记录。
- **学习队列**：due 摘录列表（priority 升序）、推迟（×1.6 占位）、打开摘录阅读（嵌套摘录）、跳转原文（带锚点条目）。
- **连续复习**：进入即开始；每张卡实时取 due 队首（FSRS due 升序）；评分四按钮（预览=落库，§7.3）；自动下一张；本轮计数；跳过（due+10min，不写 log）；标记并暂停；**删除**（确认后软删，自动下一张）；**跳转原文**（保存现场→阅读器锚点定位+高亮→返回恢复该卡与翻面状态）；内联编辑（翻面后问题+答案皆可，cloze 语法自动回填）；leech 自动检测（lapses≥8 暂停+通知）。
- **卡片浏览**：到期列表（只读）+ 记忆难点列表（Leech 六步向导：AI 诊断/补卡指引/换问法/删除降优先/推迟/助记 + 重置为新卡/恢复）。
- **统计数据**：仪表盘（学习热力/今日完成度/领域分布/评分构成等），UDC 领域分类，组件拖拽排列。（用户主导开发）
- **FSRS 优化器**：设置 → FSRS 优化；手动训练/应用/恢复默认（§7.7）。
- **启动**：单窗口防重入；dist 优先加载。

## 6.3 AI 辅助制卡与助读体系（v6 锁定，主体实现）

### 6.3.1 制卡原则知识库（单一事实来源）

制卡原则只存在于两处：`PromptTemplate` 的 card-* 族提示词（给 LLM）与 `CardLintEngine` 规则表（本地质检）。代码、组件、文档中不许散落第二份原则文本。scope 锁定：`card-generation / card-formula / card-seq / card-enum / card-mnemonic / card-contrast / card-wording / card-basic / reader-explain / leech-rescue`。

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

## 6.4 Topic 队列优先级与推迟

摘录默认 priority 50；推迟固定 ×1.6 封顶 180 天（占位）；负载感知推迟（priority 三档基础间隔 + dueLoad 分散 + postponeCount 抖动 + 上限 180 天）为设计承诺，Phase 2.x 替换。

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

## 7.2 数据完整性规则

- 所有业务表软删除（is_deleted）；查询一律带 `is_deleted=0`。
- schema 变更用启动时 `ALTER TABLE ... ADD COLUMN` + try/catch（列已存在即跳过）；破坏性数据修复写一次性迁移脚本。
- `updateCard` 未传 fsrs/leech 时保留原值，禁止置 NULL（v12 修复 F6）。
- contentEditable 一律走 EditableText 裸壳模式，禁止把 React 管理的子树直接设为 contentEditable（removeChild 崩溃教训）。
- 用户编辑 cloze 卡问题区时，`[…]` 自动还原为挖空语法；提示词禁止 hint 拆答案（渲染层兼容旧数据）。

## 7.3 测试义务

- FSRS：`tests/fsrs/` 五件套（§4.4.6），57 断言全绿。
- 卡片/摘录跳转、内联编辑：E2E 手动验证（启动→操作→DB 断言→清理测试数据，测试数据用 FSRSTEST 等前缀）。
- 测试脚本临时文件用完即删；测试数据写入前先备份 library.db。

## 7.4 提示词与配置管理

- 提示词版本化播种：目标版本号在 `ensurePromptTemplates`，低于目标版本插入新版，旧版留痕；改提示词先改本文档。
- AI Key：safeStorage 加密、按服务商独立存储（`keys[preset]`），切换预设只恢复该服务自己的 Key。
- FSRS 权重：`settings.json app.fsrsWeights`，长度必须 21，非法拒绝应用。

## 7.5 安全

- Key/Cookie 不进日志、不上传；渲染层不持有明文 Key（流式转发在主进程）。
- 联网检索结果只作理解上下文；AI 禁止编造来源。

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

## 8.2 已接受偏差（实现与原锁定方案的差异）

| 偏差 | 原锁定 | 现状 | 处置 |
|---|---|---|---|
| 状态管理无 Zustand/TanStack Query | §2 表 | React state + EventBus | 接受为既成（D2），不再计划迁移 |
| 数据库 sql.js 而非 better-sqlite3 | §2 表 | sql.js 全量回写 | 接受；数据量显著增长后迁移（Roadmap） |
| 联网检索三引擎回退 | 文档锁 DDG 单方案 | Bing→DDG→百度 | 接受（更稳） |
| UI 微调类任务未逐次 bump 文档 | §1.6 | v12.2-v12.4 界面微调直接实施 | v13 重构时补记；此后功能级变更仍须先改文档，纯样式微调豁免 |

## 8.3 版本变更记录（摘要）

- **v6** AI 制卡与助读体系（第 6.3 节）；**v7** Topic 调度承诺；**v8** occlusionJson + Key 加密；**v9** 管线架构 + 联网检索；**v10** 本地模型预设；**v10.4** thinking 信号；**v10.5** reasoning_effort；**v11** FSRS 调度契约（§7）+ F1-F6 修复；**v12** FSRS 优化器（§7.7）；**v12.2** 界面重设计（A 导航/去重标题/连续复习/跳转原文/删除/双面编辑/EditableText/dist 优先）；**v12.3** 摘录锚点；**v12.4** 顶栏 no-drag 修复 + 问题区内联编辑；**v13** 本文档六部分重构（无业务逻辑变更）。

---

# 第六部分 Roadmap（路线图）

## 9.1 Phase 状态表

| Phase | 内容 | 状态 |
|---|---|---|
| 0 | 空壳启动/主题/设置 | ✅ |
| 1 | 粘贴成书 | ✅ |
| 2 | 阅读器+摘录+队列 | ✅ 基本完成 |
| 2.1/2.2 | 摘录优先级选择 + 负载感知推迟 | ❌（×1.6 占位） |
| 3 | 手动制卡+FSRS | ✅（调度连续性验收见 tests/fsrs） |
| 4 | PDF MinerU 双栏 | ❌ |
| 4b | EPUB 导入 | ✅ |
| 5 | 网页剪藏 | ❌ |
| 6 | Z-lib/Anna 连接器 | ❌ |
| 7 | 视频+AI 总结 | ❌ |
| 8 | 背景音 | ❌ |
| 9 | 灵动岛状态栏 | ❌（顶栏已改文字导航，此 Phase 需重定义） |
| 10 | TODO/番茄 | ❌ |
| 11 | AI 全量+插件市场 | 🟡 AIGateway 已用；市场未做 |
| 12 | AI 阅读助手 | 🟡 解释侧栏✅ 就此制卡✅ 跳转原文✅；「插入原文回写 ai-supplement」❌ |
| 13 | AI 制卡主路径 | ✅ |
| 14 | Leech 六步 | ✅ |
| 15 | 干扰检测与维护 | 🟡 查重警告✅；对比卡向导/编辑会话/补进度 ❌ |
| 16 | 序列/公式/遮挡卡 | 🟡 复习端渲染✅、模式生成✅；遮挡编辑器 ❌ |
| — | 统计仪表盘 | ✅（用户主导） |
| — | FSRS 优化器 | ✅（v12） |
| — | 界面 v12.2 重设计 + 跳转原文 + 编辑 | ✅ |

## 9.2 已知技术债

1. **sql.js 全量回写**：数据量增长后迁移 better-sqlite3（接口已对齐）。
2. **历史数据**：v11 前的卡片 fsrs_json 无 S/D（适配层基线回填，下次评分起恢复累积）；存量 cloze 卡 hint 拆答案（渲染层已兼容）；存量摘录/部分卡片无锚点（跳转降级为上次阅读位置）。
3. **打包**：electron-builder 未配置，无安装包。
4. **每日上限 / 全局混编 / 「不再关心」**（§6.3.8）：未实现。
5. **统计页**、「插入原文回写」、遮挡编辑器、对比卡 UI、编辑会话、补进度：待做（对应 Phase 12.2/15/16）。

## 9.3 下一步候选（按用户优先级排定，非 AI 自定）

Phase 4（PDF 双栏）、Phase 2.1/2.2（优先级+负载推迟）、Phase 15（编辑会话）、Phase 16 遮挡编辑器、better-sqlite3 迁移、electron-builder 打包。

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

## 附录B — EPUB 实现备忘

- `@likecoin/epub-ts`：JSZip 解包 → container.xml/OPF/spine → 章节 XHTML → Markdown 入库 → TOC 存 tocJson、CFI 存位置；原包存 Asset{kind:epub-original}。
- DRM 书跳过并提示；大书按章节懒加载；样式经 UiAdapter 脱敏。
