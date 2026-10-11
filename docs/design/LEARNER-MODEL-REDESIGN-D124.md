> **修订 r2（2026-10-10，用户确认 Q1–Q5）**：全球化（任意母语 / 任意材料语言 / 字符串表，§6.2、§11.6、§11.9）；整体总开关（§11.8）；推荐条数面板内可调；面板位置确认在数据页顶部；查词制卡默认卡型不改（§15）。
> **修订 r4（2026-10-11，用户指令：补 §11.4 实现缺口）**：① §11.4 TracksDialog 非 language 轨道的「UDC 叶子多选」落为 learner-tag 芯片多选，至少保留一个领域（与 §11.1 saveTrack 校验一致）；② 未归类材料的「归入…」下拉升级为**多选**——菜单内以选中态标注该书已归属的轨道（含自动归属，主进程 `learner:listTracks` 对每条命中轨道都记录，不再只记第一条），可一次勾选多条（逐条即时 `setTrackMaterial`，取消勾选 = member=0 与「移出」同口径；菜单收起后统一刷新），勾选建议轨道 = 采纳并归入；③ 无语言信息的轨道在 mode 下拉中禁选 language（主进程校验拒绝 lang 为空的 language 轨道）；④ 数据页母语确认行的语言列表用 `Intl.DisplayNames` 语言名（不显示代码）。

# D124 学习者模型与下一步推荐重设计（Learner Model v2，代号 LM-1）

> 状态：**设计定稿待用户确认**（2026-10-10，Opus 5.5 出稿）。本文件是唯一实现依据，取代 `AI_DEVELOPMENT_GUIDE.md` §4.7（BEMM）、§4.8（Frontier 六因子）、§4.9（材料画像）、§4.11（LKM 双轨调优）、§4.7 v44 探针契约、§6.4.1（Next Extract E2）以及 §9.1 M8 路线中的 K3–K9（替代关系见 §2.3）。
> 执行对象：zcode 中的 glm-5.3-flash（执行层）。**本文所有数值、表名、函数名、文件路径都是规定，不是建议。** 本文没写的东西不要自己发明；遇到本文与代码事实不符，按 AGENTS.md 的 BLOCKED 协议停下报告。

---

## 0. 执行者须知（先读完这一节再动手）

### 0.1 硬规则

1. **一次只做一个任务**（§12 任务表的一行），做完跑该行的验收命令，全绿再做下一行。
2. **不改本文没点名的文件。** 每个任务的「涉及文件」就是允许修改的全部范围。
3. **编辑已有文件时保持原换行风格**（本仓多数文件是 CRLF）；**新建文件用 LF**。看 diff 用 `git diff --ignore-cr-at-eol`。
4. **禁止写入**：`cards.fsrs_json / leech_json / fsrs_config_id / due / priority / status`、`review_logs`、`extracts` 的任何列、`knowledge_*` 四表。学习者模型对这些只读。
5. **禁止在复习评分、摘录推进、制卡的 IPC 处理函数里调用学习者模型的任何代码**（隔离：复习成功绝不等学习者模型）。
6. **v1 不调用任何 AI。** 本设计的所有状态与推荐都是本地确定性计算。不要加 AI 调用。
7. **不新增 npm 依赖。** 分词用 `Intl.Segmenter`（Node 与 Electron 31 内置），词干用本文给的 Porter 算法自己实现。
8. 主库写入后必须调用 `persist()`（`electron/db.js:812`）；`learner.db` 写入后调用 `learnerDb.save()`（§5.2）。
9. IPC 通道名一律 `learner:<动词>`（小写域名 + 冒号 + 驼峰动词，闸门 f45 S1）。
10. 纯函数模块 `electron/lm*.js` **只允许** `require("node:crypto")` 和同目录的 `./lmParams`、`./lmText`、`./lmLex`、`./lmLevels`、`./lmStrings`（依赖方向：lmParams ← lmText ← lmLex ← lmLevels ← lmRecommend，lmStrings 只被 lmRecommend 使用，禁止反向）；另外允许 `require("./kpNorm")`（取 `normalizeKpLabel`；`electron/kpNorm.js` 只依赖 Node 内置 `crypto`，可在沙箱直接加载）。**禁止** require `electron`、`fs`、`path`、`./db`、`./learnerDb`、`./learnerRefresh` 等其他任何模块。这样能在沙箱用 `node` 直接测。
11. **不得写死任何一种语言**（用户母语、材料语言、界面语言都可能是任意语言，§6.2 全球化约束、§11.9）；**用户可见文字只能来自字符串表**（§11.9）。
12. **总开关**：每个新增的学习者模型入口都要按 §11.8 检查开关。
13. **数字以 §10 参数文件为准**：正文里出现的阈值若与 §10 不一致，以 §10 为准并报告。
14. **测试文件头**：第一行 `// @runtime: node`（或 `electron`），第二行 `// 运行：node tests/<文件名>`（electron 的写 `// 运行：npx electron tests/<文件名>`）——闸门 f11 L9 要求文件头含运行命令。

### 0.2 术语表（全文统一，代码里的英文名照抄）

| 中文 | 代码名 | 含义 |
|---|---|---|
| 学习轨道 | track | 用户正在学的一个领域，如「日语」「经济学」。决定领域与处理方式（mode） |
| 处理方式 | mode | 轨道的学习理念，封闭枚举 5 个：`language / concept / procedural / factual / narrative`（§3） |
| 材料 | material | 书架上一条 `library_items` |
| 内容单元 | unit | 材料切成的一节（约 1500–6000 字），推荐的最小落点 |
| 通读次数 | pass | 用户读过某单元一遍记一次（§6.4） |
| 知识点 | KP | 既有 `knowledge_points` 行（K1 已实现） |
| 掌握等级 | level | 每个 KP 的 5 级状态 L0–L4（§6.6） |
| 词项 | lexeme | 语言轨道中的一个「词」的归一键（§6.2） |
| 词项状态 | lexState | 每个词项的 5 态：unknown / seen / learning / familiar / known（§6.7） |
| 推荐项 | rec item | 推荐面板上的一行（类型 `RecItem`，§8.2 末尾） |
| 推荐种类 | kind | 推荐项类型，封闭枚举 13 个（编号 K1–K14，K13 预留不实现，§8.1） |

### 0.3 本地能跑 / 不能跑

- 沙箱（Linux）能跑：`npx tsc --noEmit -p .`、文件头标 `// @runtime: node` 的测试（`node tests/xxx.test.cjs`）。
- 不能跑：electron、`npm run build`、GUI 测试。标 `@runtime: electron` 的测试由用户在 Windows 主机上跑：`npx electron tests/xxx.test.cjs`（须先关应用）。
- `tests/flows/` 闸门分两类：**node 可跑**＝`f11-doc-code-drift.cjs`、`f21-ipc-bridge.cjs`、`f24-coverage-audit.cjs`、`f27-restraint-redlines.cjs`、`f45-feature-blindspots.cjs`；**须主机 electron 跑**＝`f18-settings-matrix.cjs`、`f19-read-api-boundary.cjs`、`f20-*.cjs`（执行前 `ls tests/flows` 核对文件名）。
- **判断是否回归必须做基线对照**：`git worktree add /tmp/base HEAD`，在 `/tmp/base` 与当前目录各跑一遍同一闸门，比较失败项集合；很多闸门在 main 上本来就有失败项。用完 `git worktree remove /tmp/base --force`。

---

## 1. 现状诊断：旧设计哪里有问题

### 1.1 代码实况（2026-10-10 普查）

- **已实现**：`knowledge_points / knowledge_relations / knowledge_external_refs / knowledge_proposals` 四表（`electron/db.js:502-583`）；AI 抽取归一（K2-A，`src/lib/kpExtract.ts`）；出层契约校验 `electron/kpScopes.js`；洞察 `insight_runs`；摘录 SM 调度与 E1 本地因子排序 `electron/aiNextExtract.js`（`scoreExtracts` :29、`rankExtracts` :79）。
- **未实现**（只有文档）：`knowledge_evidence`、`learner_knowledge_states`、`probe_runs`、`card_knowledge_points`、`lkm_configs`、BEMM、Frontier、材料画像、任何「下一步学什么」推荐。卡与 KP 的关系只有单列 `cards.knowledge_point_id`（`db.js:174`），存的是制卡批次簇值或别名。
- 4 个已播种的 AI scope（material-difficulty / knowledge-probe / frontier-explain / structure-analogy）**零消费者**。

### 1.2 设计缺陷（逐条，附后果）

| # | 缺陷 | 后果 |
|---|---|---|
| P1 | **五维 Beta 后验 × 每个 KP**（§4.7-2），证据权重矩阵、guess/slip、衰减半衰期全是待校准参数 | 单用户数据稀疏，几十个参数无法校准；为了弥补又叠了一整套「双轨调优 + lkm_configs + 仿真轨迹库」（§4.11）。复杂度失控，十批路线 K0–K9 只落地了地基 |
| P2 | application / transfer 两维**没有任何天然证据来源** | 只能发明「强制入队、不能跳过、AI 自动生成的探针卡」（§4.7 v44），侵入复习体验，并且是 §1.7「AI 输出须确认」的大例外 |
| P3 | **KP 只来自制卡**，没有「内容单元」这一层 | 未读材料没有 KP，推荐只能在「已制卡的知识点」里打转，无法推荐「下一章读什么」；落点要么是不可执行的 KP，要么是整本书 |
| P4 | Frontier 用**六因子连乘**（§4.8-2） | 任一因子为 0 整体为 0；各因子尺度不同；贡献不可解释、不可调试 |
| P5 | **语言学习完全缺位**：只有 AI 估的 `languageDifficulty` 1–5 档、摘录搁置原因里一个 `language` 枚举 | 语言被当作概念型 KP 处理，最终只能走向「背单词」，与用户「母语式反复接触」的理念相反；而语言恰恰是最能本地精确计算可读性的领域（已知词覆盖率） |
| P6 | **所有领域一套模型** | 事实记忆型、程序技能型、文学阅读型没有差异化处理 |
| P7 | **没有「用户在学什么」实体** | 只有 UDC / 15 领域统计分类；`utility` 因子的来源含糊，无法回答「推荐哪个领域」 |
| P8 | 推荐**内容类型单一** | 只考虑材料与摘录，没有重读、摘录制卡、巩固、自我解释、找材料等实际可做的行动 |
| P9 | 「FSRS 管记忆，禁推 mastery」走过头 | 单卡保持≠概念掌握是对的；但**同一 KP 多张不同角度的卡一致高保持**正是本产品里最强、最便宜、已经过 FSRS 校准的证据。弃之不用、改用未校准的 Beta，本末倒置 |
| P10 | 文档自相矛盾 | §6.3.11/§6.3.12 存在新旧两份（旧版仍写「8 种关系 / 5 个 scope」）；§4.6 引用块第 6、7 条重复；§4.13-5 Evidence Package 段重复；Layer A「15 个领域」与实现所用 UDC 叶子不一致；§4.7-8 与 v44 引用块冲突、§4.12-2 与 v44 注记冲突，都靠「以本节为准」打补丁 |
| P11 | 结构连接（§4.14 / K9）依赖全部下游，且禁止凭空列举领域 | 在联网发现落地前实际不可用 |

### 1.3 保留的部分（不要动）

- K1 四表与归一合并、K2-A 三层确定性抽取架构、`kpNorm.js`、`kpScopes.js`、KnowledgeLint。
- 最高不变量 §1.8（结构 / 状态 / 推荐三层分离）、§1.9（状态可重算）、§1.10（AI 不是事实源）。**本设计完全满足这三条**：所有状态都是对原始事实的纯函数重算，v1 根本不用 AI。
- FSRS 隔离边界 §4.12 的读写规则。
- 摘录 SM 调度（§6.8-2）与 E1 引擎。
- 洞察（M8-B）与用户记忆（M14），本设计不碰。

---

## 2. 目标、原则与替代关系

### 2.1 核心目标

**根据用户当前的掌握水平，给出「现在最值得做的 3–8 件具体的事」**，每件事点一下就能开始做，并附一句可验证的理由。

### 2.2 设计原则

1. **先有行动，后有模型。** 推荐的落点必须是可执行的动作（读某一节、处理这批摘录、重读这段、给这条摘录制卡……），不是抽象的知识点。
2. **只用已有的真实信号。** 阅读事件、摘录操作、制卡、FSRS 复习、查词，外加三个轻量的新信号（查词埋点、自我解释、语境串反馈）。不发明需要用户额外劳动的测验。
3. **规则化、离散化、可测。** 掌握水平用 5 个离散等级 + 明确阈值，主要阈值与权重集中在一个参数文件里（§10），带版本号；少量结构性常数（如空章节 50 字、K2 首单元 ≥ 300 字、i+1 句长 6–40 词 / 8–60 字、K4 优先级 ≤ 50、lexical 匹配长度门槛）直接写在正文对应位置，实现时在代码里用具名常量并注释出处。
4. **按领域分理念处理。** 5 种 mode 各有自己的「什么算懂」与「下一步做什么」。
5. **派生数据可删可重建。** 所有派生缓存放进独立的 `learner.db`；删掉它，下次刷新会完整重建。主库只新增「事实表」。
6. **零配置可用。** 用户不建轨道也能看到推荐（使用系统提议的隐式轨道），建了轨道推荐更准。

### 2.3 替代关系（L0 文档批写进指导文档）

| 旧条目 | 新处理 |
|---|---|
| §4.7 BEMM 五维 Beta、证据权重矩阵、`knowledge_evidence`、`learner_knowledge_states` | 由本文 §6.6 的 KP 五级规则（LM-1）取代；两张旧表**永不建** |
| §4.7 v44 探针契约、`probe_runs`、`frontierExploration` 开关 | 作废。深层证据改由「应用卡」与「自我解释」（§8.2 K7）提供；`knowledge-probe` scope 保留但不接入 |
| §4.8 Frontier 六因子连乘 | 由 §7 候选生成器 + §8.3 加权和打分取代 |
| §4.9 材料画像（AI 逐本分析） | 由 §6 本地内容单元索引取代；AI 画像推迟到 L7（可选） |
| §4.11 双轨调优、`lkm_configs` | 作废。LM-1 参数少且有版本号；以后用推荐反馈做阈值微调（§8.6） |
| §4.14 结构连接、K9 | 推迟（不在本路线内），条文保留作远期构想 |
| §6.4.1 E2（KP_frontier 因子） | 由 §9.5 的 `kpFactor` 实现 |
| §9.1 M8 的 K3–K9 | 由本文 §12 的 L0–L6 批次取代；新主线编号 **M17** |
| §4.17 成长反馈 GF-2 的 `kp-functional / kp-strong` | 分别映射为 KP 首次达到 L3 / L4（GF-2 仍排在本路线之后） |

---

## 3. 五种处理方式（mode）：理念与差异

每个学习轨道有且只有一个 mode。同一份材料可以同时属于两个轨道（例如一本英文经济学书同时属于「英语」language 轨道和「经济学」concept 轨道），两边各算各的。

| mode | 中文名 | 适用 | 理念（依据） | 「懂了」的判据 | 主要推荐 | 不做什么 |
|---|---|---|---|---|---|---|
| `language` | 语言习得 | 外语 | 母语式习得：大量**可理解输入**（Krashen 1985），已知词覆盖率 95–98% 的文本最适合吸收新词（Hu & Nation 2000；Laufer & Ravenhorst-Kalovski 2010）；一个词需要在不同语境里遇到约 8–12 次才会自然掌握（Webb 2007；Waring & Takaki 2003）；**窄读**（同作者 / 同主题连续读）让词汇自然复现 | 词项被反复接触且不再需要查（§6.7） | 覆盖率合适的下一段输入、间隔重读、同词多语境串、i+1 句子挖掘 | 不推词表、不推语法练习、不推孤立的「单词→释义」卡 |
| `concept` | 理解建构 | 科学、社科、哲学、心理等 | 先修知识决定能否理解（Ausubel）；自我解释（Chi 1994）与精细加工；同一概念多种讲法 | 该 KP 多张不同角度的卡长期保持，且有应用卡或自我解释（§6.6） | 续读（先修就绪的下一节）、摘录制卡、巩固薄弱 KP、换个讲法、自我解释、找缺失的先修材料 | 不推「最难的」；先修没就绪时不推后续章节 |
| `procedural` | 技能练习 | 数学、编程、工程 | 样例→渐隐→独立练习（Sweller 样例效应）；间隔与交错练习（Rohrer） | 该 KP 的应用卡长期保持 | 练习单元（习题章节）、为 KP 补应用题卡 + concept 的全部推荐 | 不把「读懂了」当「会做了」 |
| `factual` | 事实记忆 | 医学、法律、地理等离散事实多的领域 | 检索练习 + 间隔重复（Roediger & Karpicke 2006）；FSRS 本身就是最优方案 | 卡片保持（FSRS） | 摘录制卡（覆盖率优先）、巩固遗忘中的 KP、续读 | 不推自我解释（性价比低） |
| `narrative` | 阅读体验 | 文学、随笔、思想类读物 | 为意义而读；重读喜爱的段落；与日记反思联动 | 不追踪掌握 | 续读、开读新书、处理摘录 | 不推巩固、不推制卡压力 |

### 3.1 mode 的默认值（系统提议轨道时用）

- 材料语言不在用户母语列表里 → 提议 `language` 轨道（按语言一个）。
- 否则按 UDC 叶子编码（`src/lib/udc.ts` / `electron/udc.js:16` 的 `UDC_LEAVES`）：

| UDC 叶子 | 默认 mode |
|---|---|
| `004`（计算机）、`51`（数学）、`62`（工程） | `procedural` |
| `61`（医学）、`32`（政治·法律）、`91`（地理） | `factual` |
| `8`（语言·文学） | `narrative` |
| 其余全部（含 `other`） | `concept` |

用户可以在轨道管理里随时改 mode。

---

## 4. 总体架构

```
┌──────────── 事实层（主库 library.db，只追加，进备份）────────────┐
│ 既有：cards / review_logs / extracts / extract_ops / reading_events │
│       library_items / documents / knowledge_* / journal_entries    │
│ 新增：learner_tracks / track_materials（用户的轨道与归属覆盖）     │
│       learning_events（查词、标记、快测、重读、语境串、自我解释）  │
│       rec_runs / rec_feedback（推荐展示与反馈）                    │
└───────────────────────────────┬──────────────────────────────────┘
                                │ 只读
┌───────────────────────────────▼──────────────────────────────────┐
│ 刷新管线 electron/learnerRefresh.js（后台、分块、单飞）            │
│  ① 内容单元索引  ② 通读次数  ③ KP↔单元链接  ④ KP 等级            │
│  ⑤ 词项索引与状态（仅 language 轨道材料）  ⑥ 轨道统计             │
└───────────────────────────────┬──────────────────────────────────┘
                                │ 写
┌───────────────────────────────▼──────────────────────────────────┐
│ 派生层（独立 learner.db，可删可重建，不进备份）                    │
│ content_units / pdf_page_texts / unit_progress / unit_kp_links    │
│ kp_states / lexemes / unit_lex / lexeme_states / lm_meta           │
└───────────────────────────────┬──────────────────────────────────┘
                                │ 快照
┌───────────────────────────────▼──────────────────────────────────┐
│ 推荐引擎 electron/lmRecommend.js（纯函数）                          │
│  13 个候选生成器 → 特征 → 加权打分 → 轨道配额 + 多样性选取 → 理由  │
└───────────────────────────────┬──────────────────────────────────┘
                                │ IPC learner:*
┌───────────────────────────────▼──────────────────────────────────┐
│ 渲染层：数据页顶部「下一步」面板 + 轨道管理 + 语言专用对话框        │
└──────────────────────────────────────────────────────────────────┘
```

### 4.1 新文件清单

| 文件 | 类型 | 职责 |
|---|---|---|
| `electron/lmParams.js` | 纯常量 | 全部阈值与权重（§10），带 `LM_VERSION` |
| `electron/lmText.js` | 纯函数 | markdown 转纯文本、切单元、切句、语言检测 |
| `electron/lmLex.js` | 纯函数 | 分词、词项归一（含 Porter）、停用词、覆盖率、i+1 句子判定 |
| `electron/lmLevels.js` | 纯函数 | 可提取率、KP 等级、词项状态、通读次数计算 |
| `electron/lmRecommend.js` | 纯函数 | 轨道权重、候选生成、打分、选取、理由文案 |
| `electron/lmStrings.js` | 纯常量 | 主进程侧用户可见文字表 `{ zh, en }`（§11.9） |
| `electron/learnerDb.js` | 有状态 | 独立 sql.js 库 `learner.db` 的打开 / 建表 / 原子保存（仿 `electron/dictDb.js`） |
| `electron/learnerRefresh.js` | 有状态 | 刷新管线编排、单飞锁、进度、快照组装 |
| `src/lib/learner.ts` | 渲染层 | 类型定义、`learnerAPI` 封装、`learnerSettings`、`NATIVE_LANG_CHOICES` |
| `src/lib/learnerStrings.ts` | 渲染层 | 界面文字表 `{ zh, en }`（§11.9） |
| `src/components/learner/*.tsx` | 渲染层 | 面板与对话框（§11） |
| `tests/lm-*.test.cjs` | 测试 | 见 §13 |

`electron/db.js` 只新增：建表语句、事实表的增删改查、快照读取函数（§5.1、§9.2）。`electron/main.js` 只新增 IPC 注册；`electron/preload.js` 只新增 `learnerAPI`。

---

## 5. 数据模型

### 5.1 主库新增 5 张事实表（写进 `electron/db.js` 的 SCHEMA 字符串，紧跟 `card_links` 建表语句之后）

```sql
-- v48.80（D124，§4.20）：学习轨道——用户在学的领域与处理方式
CREATE TABLE IF NOT EXISTS learner_tracks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  mode TEXT NOT NULL,                 -- language|concept|procedural|factual|narrative
  lang TEXT NOT NULL DEFAULT '',      -- 仅 language：ISO 639-1，如 en / ja / zh / ko / fr
  udc_codes_json TEXT NOT NULL DEFAULT '[]', -- 非 language：UDC 叶子编码数组
  status TEXT NOT NULL DEFAULT 'active',     -- active|paused|archived
  pinned INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 3,       -- 1..5，3=普通
  source TEXT NOT NULL DEFAULT 'user',       -- user|proposal（由提议一键采纳）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sync_version INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0
);
-- 轨道↔材料的「人工覆盖」：只存用户手动加入(member=1)或排除(member=0)；自动归属不落表（§6.9）
CREATE TABLE IF NOT EXISTS track_materials (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL,
  library_item_id TEXT NOT NULL,
  member INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sync_version INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_track_materials_pair ON track_materials(track_id, library_item_id);
-- 注意：因为有唯一索引，setTrackMaterial 必须「先查后改」：同 (track_id, library_item_id) 行（含 is_deleted=1）存在
-- 就 UPDATE member / is_deleted=0 / updated_at；不存在才 INSERT；member=null 时 UPDATE is_deleted=1。
-- 学习事件（append-only 事实；kind 封闭枚举见 §5.3）
CREATE TABLE IF NOT EXISTS learning_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  ts INTEGER NOT NULL,
  lang TEXT NOT NULL DEFAULT '',
  library_item_id TEXT,
  unit_id TEXT,
  kp_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  sync_version INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_learning_events_kind_ts ON learning_events(kind, ts);
-- 推荐运行（只在推荐集合变化时写一行；保留最近 300 行，见 §7.2 例外登记）
CREATE TABLE IF NOT EXISTS rec_runs (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  lm_version TEXT NOT NULL,
  fingerprint TEXT NOT NULL,          -- 推荐项 key 列表 sha1
  candidate_count INTEGER NOT NULL,
  items_json TEXT NOT NULL            -- 展示给用户的推荐项快照（RecItem[]）
);
CREATE INDEX IF NOT EXISTS idx_rec_runs_created ON rec_runs(created_at);
-- 推荐反馈（append-only 事实；action 封闭枚举见 §8.6）
CREATE TABLE IF NOT EXISTS rec_feedback (
  id TEXT PRIMARY KEY,
  rec_run_id TEXT,
  item_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  library_item_id TEXT,
  action TEXT NOT NULL,
  auto INTEGER NOT NULL DEFAULT 0,    -- 1=系统自动判定完成
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rec_feedback_key ON rec_feedback(item_key, ts);
```

`user_id` 一律写 `'local-user'`（与 `createFromEpub` 等既有写法一致，`db.js:1100`）。

### 5.2 独立派生库 `learner.db`（新文件 `electron/learnerDb.js`）

**为什么独立：** sql.js 每次 `persist()` 都全量导出主库（§7.1.8 约束，`dictDb.js` 文件头已有同样理由）。词项索引可达数十万行，放进主库会拖慢每一次复习评分的落盘。且这些全是派生数据，删了能重建，不需要进备份。

`learnerDb.js` 照抄 `electron/dictDb.js:1-48` 的结构：`open()`（单飞 promise、清理残留 `.tmp`、文件不存在就新建）、`save()`（tmp + fsync + rename 原子写）。文件路径 `path.join(app.getPath("userData"), "learner.db")`。另外导出 `run(sql, params)`、`all(sql, params)`（返回对象数组）、`reset()`（关闭并删除文件，用于测试与「重建索引」按钮）。

建表（`open()` 内执行）：

```sql
CREATE TABLE IF NOT EXISTS lm_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS content_units (
  id TEXT PRIMARY KEY,               -- `${documentId}#${ord}`
  library_item_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  title TEXT NOT NULL,
  heading_path_json TEXT NOT NULL DEFAULT '[]',
  md_from INTEGER, md_to INTEGER,     -- markdown 字符偏移 [from, to)；PDF 为 NULL
  page_from INTEGER, page_to INTEGER, -- 仅 PDF，0 起，闭区间
  plain_len INTEGER NOT NULL,
  head_text TEXT NOT NULL DEFAULT '',  -- 单元纯文本前 40 字（空白压缩为单空格），用作跳转锚 anchorText
  lang TEXT NOT NULL DEFAULT '',
  is_exercise INTEGER NOT NULL DEFAULT 0,
  seg_version INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cu_item ON content_units(library_item_id, ord);
CREATE TABLE IF NOT EXISTS pdf_page_texts (
  library_item_id TEXT NOT NULL, page INTEGER NOT NULL, text TEXT NOT NULL,
  PRIMARY KEY (library_item_id, page)
);
CREATE TABLE IF NOT EXISTS unit_progress (
  unit_id TEXT PRIMARY KEY,
  passes_json TEXT NOT NULL DEFAULT '[]', -- 每次通读的时间戳（升序，最多保留 20 个）
  last_pass_at INTEGER
);
CREATE TABLE IF NOT EXISTS pdf_high_water (library_item_id TEXT PRIMARY KEY, page INTEGER NOT NULL, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS unit_kp_links (
  unit_id TEXT NOT NULL, kp_id TEXT NOT NULL,
  source TEXT NOT NULL,               -- card|extract|lexical
  weight REAL NOT NULL,
  PRIMARY KEY (unit_id, kp_id, source)
);
CREATE INDEX IF NOT EXISTS idx_ukl_kp ON unit_kp_links(kp_id);
CREATE TABLE IF NOT EXISTS kp_states (
  kp_id TEXT PRIMARY KEY,
  level INTEGER NOT NULL,             -- 0..4
  score REAL NOT NULL,                -- 0..1，排序用
  confidence TEXT NOT NULL,           -- low|medium|high
  fading INTEGER NOT NULL DEFAULT 0,
  metrics_json TEXT NOT NULL,
  first_l3_at INTEGER, first_l4_at INTEGER,
  computed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS lexemes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lang TEXT NOT NULL, key TEXT NOT NULL,
  sample TEXT NOT NULL,               -- 最常见的原形，用于展示
  total_count INTEGER NOT NULL DEFAULT 0,
  unit_count INTEGER NOT NULL DEFAULT 0,
  is_stop INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lexemes_key ON lexemes(lang, key);
CREATE TABLE IF NOT EXISTS unit_lex (
  unit_id TEXT PRIMARY KEY, lang TEXT NOT NULL,
  lex_json TEXT NOT NULL,             -- [[lexemeId, count], ...] 按 lexemeId 升序
  token_count INTEGER NOT NULL,       -- 参与覆盖率计算的词例数（已排除数字与专名）
  lex_version INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS lexeme_states (
  lexeme_id INTEGER PRIMARY KEY,
  state TEXT NOT NULL,                -- unknown|seen|learning|familiar|known
  source TEXT NOT NULL,               -- 判定命中的规则名，见 §6.7
  exposure_passes INTEGER NOT NULL, exposure_tokens INTEGER NOT NULL,
  lookups INTEGER NOT NULL, last_lookup_at INTEGER,
  computed_at INTEGER NOT NULL
);
```

**重建规则：** `lm_meta` 存 `schema_version`（本版 `1`）。`open()` 发现 `schema_version` 不等于代码常量时：关闭、删除文件、重新建表（全量重建）。另存 `icu_version`（`process.versions.icu`）与 `lex_version`：任一与当前不同时，清空 `lexemes / unit_lex / lexeme_states` 让词项索引重建（不同 ICU 版本的 `Intl.Segmenter` 切词结果不同，例如 Node 22 把「読んだ」切成 読/ん/だ）。

### 5.3 `learning_events.kind` 封闭枚举与 payload 形状

校验写在 `db.js` 的 `addLearningEvent`（IPC handler 只转发），非法 kind 或 payload 直接返回 `{ok:false, error}`，不写库。字符串超长按表中上限截断，数组超长截断到上限。

| kind | 何时写 | 必填字段 | payload_json |
|---|---|---|---|
| `dict_lookup` | 阅读器里查词成功显示结果后 | `lang`, `library_item_id` | `{ "text": 选中文本(≤64字), "sentence": 所在句(≤400字), "offset": 选中文本在句中的起始下标 }` |
| `lexeme_mark` | 用户在挖句子对话框里点「这个词我认识 / 这个词不认识」 | `lang` | `{ "keys": [词项 key…](≤200), "mark": "known"|"unknown", "via": "mine" }` |
| `placement` | 词汇快测提交 | `lang` | `{ "knownKeys": [...](≤600), "extrapolatedKeys": [...](≤8000), "bands": [{ "from":1,"to":250,"ratio":0.9 }...] }` |
| `unit_reread` | 重读对话框点「读完了」 | `unit_id`, `library_item_id`, `lang` | `{}` |
| `reel_done` | 语境串对话框提交 | `lang` | `{ "keys": [词项 key], "result": "clear"|"unclear" }` |
| `self_explain` | 自我解释对话框保存 | `kp_id` | `{ "text": 用户文字(≤4000), "relatedKpId": string|null, "selfRating": "clear"|"partial"|"stuck" }` |

---

## 6. 掌握水平判断（问题 1）

### 6.1 内容单元切分（`lmText.js`）

#### `markdownToPlain(md: string): string`
按顺序做以下替换（全部用正则，逐行处理；代码围栏内的行只删掉围栏标记行本身）：
1. 图片 `!\[([^\]]*)\]\([^)]*\)` → `$1`
2. 链接 `\[([^\]]*)\]\([^)]*\)` → `$1`
3. HTML 标签 `<[^>]+>` → 空
4. 行首标题标记 `^#{1,6}\s+` → 空
5. 行首引用 `^>\s?` → 空
6. 行首列表标记 `^\s*([-*+]|\d+\.)\s+` → 空
7. 强调与删除线 `\*\*|__|\*|~~` → 空（单个 `_` 不删，避免误伤英文下划线词）
8. 行内代码反引号 `` ` `` → 空
9. 表格竖线 `|` → 空格
10. 三个以上连续换行压成两个

#### `segmentMarkdown(md: string): Unit[]`
`Unit = { ord, title, headingPath: string[], mdFrom, mdTo, plainLen, isExercise }`

0. 先把 `\r\n` 视为换行（偏移仍按原字符串计算，不要先替换掉 `\r` 再算偏移）；标题文字一律 `.trim()`。
1. 按行扫描，跳过代码围栏内的行，识别 `^(#{1,3})\s+(.+)$` 为标题。每个标题开始一个 section，section 的 `mdFrom` 是标题行首偏移，`mdTo` 是下一个标题行首偏移（最后一个到 `md.length`）。第一个标题前若有非空文字，作为一个 section，标题为 `开篇`。`headingPath` 记录当前 1–3 级标题栈。
2. 每个 section 的 `plainLen = markdownToPlain(片段).trim().length`。**丢弃 `plainLen < 50` 的 section**（空章节，只有标题）——必须在合并之前做，否则空章节会把下一节的标题吞掉。
3. **合并**：`cur=null`；依次取 section `s`：若 `cur` 为空则 `cur=s`；否则若 `cur.plainLen < UNIT_MIN_CHARS` 或 `cur.plainLen + s.plainLen <= UNIT_TARGET_CHARS`，则把 `s` 并入 `cur`（`mdTo` 取 `s.mdTo`，`plainLen` 相加，标题保留 `cur` 的）；否则推入 `cur`，`cur=s`。结束时推入 `cur`。
4. **拆分**：`plainLen > UNIT_MAX_CHARS` 的单元，在**它的 markdown 原文片段**上用 `/\n[ \t]*\r?\n/g` 找段边界（记录每段在原文中的起止偏移）；每段 `plainLen = markdownToPlain(段).trim().length`；逐段累加，累计 `>= UNIT_TARGET_CHARS` 就切一刀；最后一块若 `< UNIT_MIN_CHARS` 并入前一块。子单元 `mdFrom` = 首段起点、`mdTo` = 下一子单元的 `mdFrom`（最后一个子单元 `mdTo` = 原单元 `mdTo`），保证首尾相接、不留缝。拆出的 k 块标题为 `原标题（i/k）`，`headingPath` 沿用原单元。
5. 没有任何标题：整篇当一个 section，走第 4 步。
6. 再删一次 `plainLen < 50` 的单元（保险），然后从 0 重新编号 `ord`。
7. `isExercise = /习题|练习|例题|思考题|exercise|problem|quiz/i.test(title) ? 1 : 0`。
8. `headText` = 单元纯文本 `.replace(/\s+/g, " ").trim().slice(0, 40)`。

**哪些材料切分：** `documents.markdown` 非空的材料；以及 `source_type='pdf'` 的材料（走 `segmentPages`）。`documents.markdown` 为空且不是 PDF 的（如 `source_type='ebook'`：MOBI/AZW3/FB2/CBZ，`main.js:538` 导入时 markdown 为空）**不切分、不进入推荐**。

`UNIT_MIN_CHARS=1500, UNIT_TARGET_CHARS=3000, UNIT_MAX_CHARS=6000`，`SEG_VERSION=1`（§10）。

#### `segmentPages(pageTexts: string[]): Unit[]`（PDF）
连续页累加，累计纯文本长度 `>= UNIT_TARGET_CHARS` 就成一个单元 `{pageFrom, pageTo}`；最后一块 `< UNIT_MIN_CHARS` 并入前一块。标题 `第 ${pageFrom+1}–${pageTo+1} 页`（只有一页时 `第 ${pageFrom+1} 页`）。`mdFrom/mdTo` 为 null。

#### 单元文本获取
- 非 PDF：`markdownToPlain(documents.markdown.slice(mdFrom, mdTo))`。
- PDF：`pdf_page_texts` 中 `page_from..page_to` 各页文本用 `\n` 连接。PDF 页文本在索引阶段用 pdfjs 抽取：复制 `electron/main.js:559-600` 已有的 pdfjs 加载方式（`import("pdfjs-dist/legacy/build/pdf.mjs")`），对每页 `getTextContent()`，把 `items[].str` 用空格连接。原文件位置：`userData/assets/<itemId>/original.pdf`（资产 kind `pdf-original`，读取函数见 `db.js` 的 `readPdfFile`，约 :1209）。页码一律 **0 起**（与 `pageIndex` 一致，`src/lib/reader/pdf/adapter.ts:314` 为 `currentPage - 1`）。抽取函数放在 `learnerRefresh.js`，由 main 注入（`learnerRefresh.init({ extractPdfPages })`），保持 `learnerRefresh.js` 可在测试里替换。

#### 何时重新切分
`documents.updated_at > content_units.indexed_at`（任取该文档一个单元比较）或该文档没有单元或 `seg_version` 不等于常量 → 删除该文档的旧单元、`unit_lex`、`unit_kp_links`，重新切分。`unit_progress` 按新单元 id 保留（id 相同就保留，不同就丢弃）。

### 6.2 分词与词项归一（`lmLex.js`）

> **全球化约束（用户 2026-10-10）**：软件面向全球学习者，用户母语各不相同，任何语言都可能是「外语」。因此本节所有函数**必须对任意语言可用**：没有专门规则的语言走「通用规则」降级，而不是被误判成英语或被丢弃。语言代码一律用 ISO 639-1 主子标签（`zh-TW`、`zh-CN` → `zh`；`pt-BR` → `pt`），取法 `String(tag).toLowerCase().split(/[-_]/)[0]`，记为 `baseLang(tag)`。

#### 语言能力表 `LANG_PROFILE`（`lmLex.js` 常量）
| 字段 | 含义 | 取值 |
|---|---|---|
| `spaced` | 词之间是否用空格分隔 | 不分隔：`zh ja th lo km my bo`；其余全部分隔 |
| `cased` | 是否有大小写 | 有：拉丁、西里尔、希腊、亚美尼亚字母的语言（按文字判断：token 含 `\p{Lu}` 或 `\p{Ll}` 即视为有大小写，不必列语言） |
| `properByCaps` | 能否用「句中首字母大写」识别专名 | 仅 `en fr es it pt nl sv da no nb nn ro ca pl cs id ms`；**`de` 必须为 false**（德语所有名词首字母大写）；其余语言 false |
| `stemmer` | 词干算法 | 仅 `en` = Porter；其余无（只做大小写折叠） |
| `stopwords` | 停用词表 | `en ja zh` 有表（下方）；其余空集 |

#### `detectLang(text: string): string`
取前 3000 字，按 Unicode 文字统计字符数：假名 `\p{Script=Hiragana}|\p{Script=Katakana}`、汉字 `\p{Script=Han}`、谚文 `\p{Script=Hangul}`、泰文 `\p{Script=Thai}`、阿拉伯 `\p{Script=Arabic}`、希伯来 `\p{Script=Hebrew}`、西里尔 `\p{Script=Cyrillic}`、希腊 `\p{Script=Greek}`、天城文 `\p{Script=Devanagari}`、拉丁 `\p{Script=Latin}`。按顺序判定，第一个命中即返回：
1. 假名 > 20 且 假名 ≥ 0.05×(假名+汉字) → `ja`
2. 汉字 > 50 且 汉字 > 拉丁 → `zh`
3. 谚文 > 50 → `ko`；泰文 > 50 → `th`；希伯来 > 50 → `he`；希腊 > 50 → `el`；天城文 > 50 → `hi`
4. 阿拉伯 > 50 → `ar`（波斯语等同文字语言无法区分，用户须在书籍属性里手动指定）
5. 西里尔 > 50 → `ru`（乌克兰语等同理，含 `ї є і ґ` 任一 > 5 次则 `uk`）
6. 拉丁 > 200 → 用**停用词投票**区分：对下表每种语言，数文本里（小写化后、按空格/标点切开）属于该语言特征词集的词个数，得票最多且 ≥ 5 票的语言胜出；都不足 5 票 → `''`（未知）。
   - `en`: the and of to is that it with for was
   - `fr`: le la les des est une dans pour qui pas
   - `de`: der die und das ist nicht ein eine mit sich
   - `es`: el los las que una por con para del está
   - `it`: il che di della per non sono una gli è
   - `pt`: o os que não uma para com do da são
   - `nl`: de het een en van dat niet ik zijn met
7. 否则 `''`。

`detectLang` 只是兜底：**用户在书籍属性里设的 `library_items.lang` 永远优先**。材料语言 = `baseLang(library_items.lang)` 非空则用它，否则用 `detectLang`（非 PDF 取 markdown 前 3000 字，PDF 取前 3 页）。材料语言为 `''` 的材料不进入任何 language 轨道（轨道管理里在「未归类」下提示「语言未知，请在书籍属性中设置」）。

#### `tokenize(text, lang): Token[]`
`Token = { surface, start, end, proper }`
- 用 `new Intl.Segmenter(lang || "und", { granularity: "word" })`，只保留 `isWordLike === true` 的段（Segmenter 内置泰文、日文、中文等无空格文字的词典切分）。
- 丢弃纯数字 `/^\p{N}+$/u`。
- 丢弃与材料语言主文字不同的段：`ja` 只留含汉字或假名的段；`zh` 只留含汉字的段；`ko` 只留含谚文的段；其余语言只留含字母 `\p{L}` 的段（夹杂的外文词不计）。
- `proper`：仅 `properByCaps` 为 true 的语言才判断——`proper = 词长 ≥ 2 && 首字母为大写 \p{Lu} && 不是句首词`（单字母词一律 false；全大写缩写如 `NASA` 判为 proper）。句首：该词之前最近的非空白字符是 `.!?…。！？` 或文本开头或换行。其他语言 `proper` 一律 `false`。
- `Intl.Segmenter` 不存在时（极旧环境）退化为 `text.match(/[\p{L}\p{M}]+/gu)`。

#### `lexemeKey(surface, lang): string`
- 公共：`s = surface.normalize("NFKC")`；若含大小写字母，`s = s.toLocaleLowerCase(lang || undefined)`（土耳其语 `İ/I` 依赖 locale，必须传 lang）。
- `en`：再 `s = s.replace(/[’']s$/, "")`；若 `IRREGULAR[s]` 存在则 `s = IRREGULAR[s]`；返回 `porterStem(s)`。
- `fr / it` 等带省音的语言：去掉词首省音前缀 `/^(l|d|j|m|n|s|t|c|qu)[’']/`（`l'homme` → `homme`）。
- 其他语言：返回 `s`（不做词干）。已知局限：屈折丰富的语言（德、俄、日活用等）同一词的不同形态是不同键；v1 接受，查词埋点用「句内重叠」规则补救（§6.7），L7 再按语言加词干/形态分析。

`porterStem`：以 tartarus.org/martin/PorterStemmer 的官方参考实现为准（即 1980 原算法 + 官方两处修订：step 2 的 `bli→ble`、`logi→log`），长度 ≤ 2 的词原样返回。§13.2 的用例必须全部通过。

`IRREGULAR`（放 `lmLex.js` 常量，键全部小写）：
```
was,were,been,am,is,are→be; has,had→have; did,done,does→do; went,gone,goes→go;
made→make; took,taken→take; came→come; saw,seen→see; got,gotten→get;
gave,given→give; knew,known→know; thought→think; told→tell; found→find;
said→say; left→leave; felt→feel; brought→bring; began,begun→begin; kept→keep;
held→hold; wrote,written→write; stood→stand; heard→hear; meant→mean; met→meet;
ran→run; paid→pay; sat→sit; spoke,spoken→speak; led→lead; grew,grown→grow;
lost→lose; fell,fallen→fall; sent→send; built→build; understood→understand;
drew,drawn→draw; broke,broken→break; spent→spend; rose,risen→rise;
drove,driven→drive; bought→buy; wore,worn→wear; chose,chosen→choose;
children→child; men→man; women→woman; mice→mouse; feet→foot; teeth→tooth
```

#### 停用词 `STOPWORDS[lang]`（`Set`，按 `lexemeKey` 之前的小写原形比较）
- `en`：a an the and or but if then else of to in on at by for with from as is are was were be been being am do does did have has had i you he she it we they me him her us them my your his its our their this that these those there here what which who whom whose when where why how not no yes so than too very can could will would shall should may might must just also only about into over under again more most some any all each both few other such own same up down out off
- `ja`：の に は を た が で て と し れ さ ある いる も する から な こと として い や れる など なっ ない この ため その あっ よう また もの という あり まで られ なる へ か だ これ によって により おり より による ず なり られる において ば なかっ なく しかし について せ だっ できる それ う ので なお のみ でき き つ における および いう さらに でも ら たり ます ん です
- `zh`：的 了 和 是 在 有 这 那 也 就 都 而 与 及 或 但 被 把 将 对 从 向 以 于 为 着 过 之 其 所 得 地 么 吗 呢 吧 啊 不 没 很 我 你 他 她 它 我们 你们 他们 这个 那个 一个 什么 因为 所以 如果 但是 可以 没有 自己 已经 还 又 再 才 就是 这样 那样
- 其他语言：空集。**没有停用词表的语言用「频率替代」**：该语言 `lexemes` 中 `total_count` 排名前 `FREQ_STOP_TOP`(50) 的词项在 i+1 判定、语境串、快测、词项推荐中视同停用词（`is_stop` 列仍为 0，判定时现算）；这样不必为每种语言维护词表也能排除功能词。

停用词**计入覆盖率分子**（视为已知），**不参与** i+1 判定、语境串、快测、词项推荐。

#### 词项索引（只对 language 轨道的材料做）
**先清理**：不再属于任何 language 轨道（或已删除）的材料，其单元的 `unit_lex` 行删除，并按旧 `lex_json` 回减 `lexemes.total_count / unit_count`。
对每个单元：`tokenize` → 每个 token 算 `lexemeKey` → 按 key 计数（`proper` 的 token 不计入）→ 在 `lexemes` 里 upsert（`total_count += 本单元次数`、`unit_count += 1`、`sample` 取该 key 出现最多的原形、`is_stop` 按停用词表）→ 写 `unit_lex`（`lex_json` 按 lexemeId 升序；`token_count` = 本单元非专名 token 总数）。重新索引某单元前，先从 `lexemes` 里减掉它的旧计数。

### 6.3 FSRS 可提取率（`lmLevels.js`）

```js
// elapsedDays: 距上次复习天数（可为小数）；stability: 天；decay: 正数（FSRS-6 的 w[20]，或 FSRS-5 的 0.5）
function retrievability(elapsedDays, stability, decay) {
  if (!(stability > 0)) return 0;
  const d = -Math.abs(decay || FSRS_DEFAULT_DECAY);
  const factor = Math.pow(0.9, 1 / d) - 1;
  return Math.pow(1 + factor * Math.max(0, elapsedDays) / stability, d);
}
```
- `decay`：`SELECT weights_json FROM fsrs_configs WHERE id = ?`（id = `cards.fsrs_config_id`）→ `JSON.parse` 得数组 `w`；`w.length >= 21` 用 `w[20]`；`cards.fsrs_config_id` 为空、取不到行、解析失败或长度不足，一律用 `FSRS_DEFAULT_DECAY = 0.1542`（与内置默认权重 `w[20]` 相同，`electron/fsrsConfig.js:15`）。每个 config id 只查一次（缓存）。
- `fsrs_json` 形状 `{state, due, lapses, stability, difficulty, reps, lastReview, learningSteps}`（`src/lib/fsrs.ts:2`），**`lastReview` 是毫秒时间戳**。`reps >= 1 && lastReview` 才算「已复习过」。`elapsedDays = (now − lastReview) / 86400000`。
- 验算：`retrievability(0,10,0.5)=1`；`retrievability(10,10,0.5)=0.9`；`retrievability(10,10,0.1542)=0.9`（误差 < 1e-9）。

### 6.4 通读次数（`lmLevels.js` 的 `computePasses`）

`reading_events(item_id, char_pos, created_at)`：除 PDF 外所有材料都走 foliate 内核（`src/App.tsx:282-309`，word/txt/md/html 也转成合成 EPUB），写入时 `char_pos = fraction × markdown.length`（`src/components/Reader.tsx:654`），所以 `char_pos` 与单元的 `md_from/md_to` **近似**在同一个坐标系（foliate 的 fraction 按章节/字节估算，图片多的书误差可达一两个单元）。**因此通读次数是近似值，测试里不要对真实书做精确断言。**

另有一种旧的自渲染阅读模式（原书文件缺失时，`Reader.tsx:1128`）写的 `char_pos` 是渲染后文本长度，坐标系不同。v1 不区分两种来源，统一按下面规则处理；`char_pos > docLen` 的事件直接丢弃。

```
computePasses(events /* 同一材料，按 created_at 升序 */, units /* 同一材料，按 ord 升序 */, docLen /* documents.markdown.length */):
  丢弃 char_pos > docLen 的事件
  sessions = 按相邻事件时间差 > SESSION_GAP_MS(30 分钟) 切分
  对每个 session：
    passedInSession = 空集合
    对相邻事件对 (a, b)：
      step = b.char_pos - a.char_pos
      若 step <= 0 或 step > JUMP_CHARS(20000)：跳过（往回翻或目录跳转不算读）
      对每个单元 u：若 a.char_pos < u.md_to 且 b.char_pos >= u.md_to 且 u 不在 passedInSession：
        记一次通读 (u.id, b.created_at)；passedInSession.add(u)
      末尾规则：若 b.char_pos >= docLen × END_RATIO(0.97) 且最后一个单元 last 不在 passedInSession 且 a.char_pos < last.md_to：
        记一次通读 (last.id, b.created_at)；passedInSession.add(last)
  返回 Map<unitId, ts[]>
```
末尾规则只在「有效步长」的事件对（没被上面的「跳过」排除的那一对）里生效。
- 合并到 `unit_progress`：把新的时间戳并入 `passes_json`（去重、升序、只保留最后 20 个），`last_pass_at` = 最大值。
- **增量**：`lm_meta` 存 `passes_watermark`（已处理的最大 `reading_events.created_at`）。每次刷新只取「水位之后的事件 + 水位前最后一条（作为第一对的 a）」按材料计算，处理完推进水位。切分版本变化时清零水位全量重算。
- **PDF**：读 `library_items.progress_json` 里的 `pageIndex`（0 起）。与 `pdf_high_water.page` 比较：若新页码 > 旧页码且差值 ≤ `PDF_JUMP_PAGES`(30)，则所有 `旧页码 <= page_to < 新页码` 的单元记一次通读（时间戳 = 刷新时刻）；**若新页码 ≥ 总页数 − 1（读到末页），条件放宽为 `旧页码 <= page_to <= 新页码`**（总页数 = 该材料 `pdf_page_texts` 的最大 page + 1）；然后更新 high water。差值 > 30 视为跳转，只更新 high water 不记通读。首次见到某 PDF 时只记 high water。注意：从「跳转原文」进入阅读器时不会写 `progress_json`（`App.tsx:517` 有 jumpAnchor 时不传 onProgress），这是预期行为。
- `unit_reread` 事件也记一次通读（时间戳 = 事件 ts）。

### 6.5 卡片、摘录 ↔ 知识点 ↔ 单元的关联

#### 卡片 → KP（`resolveCardKpMap()`，写在 `db.js`，只读）
对所有 `is_deleted=0 AND (status IS NULL OR status='active')` 且 `knowledge_point_id` 非空的卡：
1. 建索引：对每个 `status='active'` 的 KP，键集合 = `{kp.id, canonical_label, ...alias_json}`，并把 `resolveKpFamily(kp.id)`（`db.js:4893`）返回的家族 id 也加入。这与 `runKnowledgeLint` 的做法一致（`db.js:5850-5852`）。
2. 卡的候选键 = `[knowledge_point_id, kpClusterKeyFor({genBatchId, documentId, knowledgePointId})]`（`electron/kpNorm.js:20`）。
3. 命中多个 KP 时：优先命中簇键的；仍多个取 `updated_at` 最大的；再相同取 id 字典序最小的。
4. 结果的 KP 一律沿 `merged_into` 走到根。`rootOf` 是 `scopeKpFamilySet` 内部的闭包（`db.js:3986`）、没有导出——在 `resolveCardKpMap` 内部**照抄**同样的 `parent` Map + `rootOf`（含 `seen` 防环）写法，不要改动 `scopeKpFamilySet`。
返回 `Map<cardId, kpId>`。

#### 卡片 / 摘录 → 材料与单元
- 卡片的来源：`cards.context_ref_json` 解析出 `{documentId, extractId, anchorText, anchorRatio, pageIndex}`；只有 `extractId` 时用 `extracts.document_id`。材料 = `documents.library_item_id`。
- 摘录的来源：`extracts.document_id` + `extracts.context_ref_json`。
- 定位单元（按顺序，命中即停）：
  1. 有 `pageIndex` 且是 PDF → `page_from <= pageIndex <= page_to` 的单元。
  2. 有 `anchorText`（取前 40 字、空白压缩为单空格，记为 `q`）→ 依次尝试：(a) 在该文档 markdown 中 `indexOf(q)`，得到偏移 `p`，取 `md_from <= p < md_to` 的单元；(b) (a) 返回 -1 时，对该文档每个单元的纯文本（空白压缩）做 `includes(q)`，取第一个命中的单元；(c) 仍未命中，`q` 取前 15 字重复 (b)。
  3. 第 2 步落空且有 `anchorRatio` → `p = anchorRatio × markdown.length`，取 `md_from <= p < md_to` 的单元。
  4. 都没有 → 不关联单元（仍关联材料）。
  阅读内核里制卡的 contextRef 通常只有 `cfi / chapterIndex / pageIndex / anchorText`、没有 `anchorRatio`（`Reader.tsx:1002-1013`），所以第 2 步是主路径。

#### 单元 ↔ KP 链接（写 `unit_kp_links`）
| source | 规则 | weight |
|---|---|---|
| `card` | 该单元内有卡片，卡片的 KP | 1.0 |
| `extract` | 该单元内有摘录，摘录派生的卡（`cards.context_ref_json.extractId = 摘录 id`）的 KP | 1.0 |
| `lexical` | KP 的 `canonical_label` 或任一别名，经 `normalizeKpLabel`（`electron/kpNorm.js`）后长度达标（含汉字或假名的 ≥ 2 字；纯拉丁 ≥ 6 字符），在单元纯文本经 `normalizeKpLabel` 后的字符串里出现 ≥ 2 次，或出现在单元标题里 | `min(1, 次数/5) × 0.6` |

- 同一 `(unit, kp)` 多个 source 各存一行；用的时候取最大 weight。
- lexical 增量：`lm_meta` 存 `kp_lexical_fp`（所有 active KP 的 `id:updated_at` 排序后 sha1）。KP 指纹不变时只对新切分的单元跑 lexical；指纹变了就对全部单元重跑。每处理 200 个单元 `await new Promise(r => setImmediate(r))` 让出主进程。
- 摘录正文也用同一 lexical 规则匹配 KP，结果不存表，在快照组装时临时算（`extract.kpIds`）。

### 6.6 KP 掌握等级（`lmLevels.js` 的 `computeKpLevel`）

**为什么用 FSRS：** 单张卡的保持只证明「这张卡记得」；但**同一知识点多张不同角度的卡都长期保持、而且有应用卡或自我解释**，就是本产品里最强、最便宜、已校准的「懂了」的证据。等级规则要求的正是这种多卡、跨类型、跨时间的一致性，单张卡刷不上去。

输入：
```js
{
  now,
  cards: [{ cardType, reviewed: bool, R, S, lapses30, lastRating, reviewDays: Set<学习日字符串>, reviewCount }],
  extractCount,      // 链接到该 KP 的未删摘录数
  passedUnitCount,   // 链接到该 KP 且有通读的单元数
  selfExplainClear90 // 近 90 天 self_explain 事件里 selfRating='clear' 的次数
}
```
- `lapses30` = 该卡近 30 天 `rating=1` 的次数；`lastRating` = 最后一次评分。
- `reviewDays` 按自然日 `YYYY-MM-DD`（本地时区，`new Date(ts)` 的年月日）去重。v1 有意不用学习日切点 `dayCutoffHour`（这里只关心「是否跨天」，差几小时不影响判定）；代码里写一行注释说明。
- **应用卡** = `card_type === "application"` 的卡。这种卡只由 AI 制卡（制卡原则 R15，`electron/prompts.js:94`、`:150`）产出，`insertCard` 原样保存 `cardType`（`db.js:1381`）；手动制卡不会产生。`cardType` 的取值还有 `qa / cloze / imageOcclusion / mnemonic`。

派生指标（只看 `reviewed` 的卡，记为 n）：
- `meanR` = R 的平均；`stableRatio` = `S >= 21` 的占比；`longRatio` = `S >= 60` 的占比；`lapses30Total` = 求和；`types` = 不同 `cardType` 的集合；`hasDeep` = 存在 `cardType === "application"` 且 `lastRating >= 3` 的卡，或 `selfExplainClear90 >= 1`；`distinctDays` = 所有卡 reviewDays 的并集大小；`totalReviews` = reviewCount 求和。

等级（**从高到低判断，第一个满足的就是结果**）：

| 等级 | 名称 | 条件 |
|---|---|---|
| L4 | 牢固 solid | n ≥ 2 且 meanR ≥ 0.90 且 longRatio ≥ 0.6 且 lapses30Total = 0 且（hasDeep 或（n ≥ 3 且 types.size ≥ 2）） |
| L3 | 巩固中 consolidating | n ≥ 1 且 meanR ≥ 0.85 且 stableRatio ≥ 0.5 |
| L2 | 学习中 learning | n ≥ 1 |
| L1 | 接触过 exposed | cards.length ≥ 1 或 extractCount ≥ 1 或 passedUnitCount ≥ 1 |
| L0 | 未接触 unseen | 其余 |

其他输出：
- `fading` = n ≥ 1 且 stableRatio ≥ 0.5 且 meanR < 0.75（曾经稳住、现在在遗忘）。
- `confidence`：n ≥ 3 且 totalReviews ≥ 6 且 distinctDays ≥ 3 → `high`；n ≥ 1 且 totalReviews ≥ 3 → `medium`；否则 `low`。
- `score`（排序用）：L0=0，L1=0.15，L2=0.30+0.20×meanR，L3=0.60+0.20×meanR，L4=0.85+0.15×meanR。
- `metrics` = `{n, meanR, stableRatio, longRatio, lapses30Total, types:[...], hasDeep, distinctDays, totalReviews, extractCount, passedUnitCount}`，数值保留 3 位小数。
- `first_l3_at / first_l4_at`：写库时若旧行为空且本次等级达到，就写 `now`；已有值不覆盖（供成长反馈 GF-2 使用）。

UI 中文标签：L0 未接触、L1 接触过、L2 学习中、L3 巩固中、L4 牢固；`fading` 时在标签后加「· 在遗忘」。

### 6.7 词项状态（`lmLevels.js` 的 `computeLexState`）

输入（每个词项）：
```js
{
  now,
  exposurePasses,       // Σ 含该词的单元的通读次数（每单元每次通读算 1）
  exposureTokens,       // Σ 该单元内次数 × 该单元通读次数
  lookupTimes: [ts],    // 关联到该词的 dict_lookup 事件时间
  passesAfterLastLookup,// 最后一次查词之后发生的、含该词的通读次数 + 之后 reel_done(clear) 次数
  lastMark: { mark: "known"|"unknown", ts } | null,
  card: { R, S } | null,// 词汇卡（见下）中 R 最低的那张；未复习过的卡视为 { R:0, S:0 }
  placementKnown: bool
}
```
规则（**从上到下，第一个命中即返回**；`source` 写规则名）：

| # | source | 条件 | state |
|---|---|---|---|
| 1 | `mark` | lastMark 存在，且（没有查词，或最后一次查词早于 lastMark.ts） | mark=known → `known`；mark=unknown → `learning` |
| 2 | `card` | card 存在 | S ≥ 21 且 R ≥ 0.85 → `known`；否则 `learning` |
| 3 | `lookup` | lookupTimes 非空 | passesAfterLastLookup ≥ 5 且 now − 最后查词 ≥ 14 天 → `familiar`；否则 `learning` |
| 4 | `placement` | placementKnown | `known` |
| 5 | `exposure` | exposurePasses ≥ 3 且 exposureTokens ≥ 8 | `familiar` |
| 6 | `seen` | exposurePasses ≥ 1 | `seen` |
| 7 | `none` | 其余 | `unknown` |

「已知」（用于覆盖率）= `known` 或 `familiar`，以及所有停用词。「正在学的词」= `learning`。

**理由：** 规则 5 体现「母语式习得」——一个词在 3 次以上通读里出现 8 次以上、用户一次也没查过，说明读的时候已经懂了（附带习得）。规则 3 体现「查过的词靠反复接触自然掌握」，而不是靠背。

#### 查词事件 → 词项
对 `dict_lookup` 事件：`tokenize(payload.sentence, lang)`，取与区间 `[offset, offset + text.length)` 有重叠的 token，它们的 `lexemeKey` 就是被查的词项（可能 1 个或多个）；若一个都没有，退回 `lexemeKey(text, lang)`。这样日语「食べる」查词能落到句中的「食べ」上。

#### 词汇卡 → 词项
`cards.dict_json` 非空的卡（查词制卡快照，`db.js:460`；形状 `{providerId, word, normalizedWord, language, audio, kind, kinds, snapshotAt}`，`src/lib/cards.ts:1123`、写入处 `useSelectionActions.ts:1520`）：词项 = `lexemeKey(dict_json.word, dict_json.language || 卡所属材料的语言)`。同一词项有多张词汇卡时取 R 最低的一张作为 `card`。

#### 快测
`placement` 事件的 `knownKeys ∪ extrapolatedKeys` 里的词项 `placementKnown = true`（多次快测取并集）。

### 6.8 覆盖率与 i+1 句子（`lmLex.js`）

签名（照抄）：
```js
unitCoverage(lexArr /* [[lexemeId, count], ...] */, tokenCount /* number */, isKnownId /* (id) => boolean */) → number
  // known = Σ count（isKnownId(id) 为真的项）；tokenCount = 0 时返回 1；否则返回 known / tokenCount
bandOf(coverage /* number */, shift = 0 /* §8.6 的偏移，正数=更严 */) → "easy" | "optimal" | "intensive" | "hard"
  // coverage ≥ EASY+shift → easy；≥ OPTIMAL+shift → optimal；≥ INTENSIVE+shift → intensive；否则 hard
isIPlusOneSentence(tokens /* tokenize 的结果 */, isKnownKey /* (key) => boolean，停用词也返回 true */, lang) → string | null
  // 排除 proper 的 token；对剩余 token 求 lexemeKey；未知的「不同 key」恰好 1 个才返回该 key（同一个未知词出现两次算 1 个）
  // 长度：LANG_PROFILE[lang].spaced 为 false（zh ja th lo km my bo）时句子纯文本长度 8–60 字；其他语言 token 数 6–40；不满足返回 null
```
- 覆盖带含义：`easy` 泛读、`optimal` 最佳输入、`intensive` 精读、`hard` 太难。阈值见 §10 `BANDS`。
- `learningCount(unit)` = 单元内状态为 `learning` 的不同词项数（不含停用词）。

### 6.9 轨道归属与领域判定（问题 2）

#### 材料属于哪个轨道（`resolveMembership`，纯函数在 `lmRecommend.js`）
材料 m 属于轨道 t，当且仅当：`override(t,m).member === 1`，或（没有 `member === 0` 的覆盖 且 自动规则成立）。

自动规则：
- `t.mode === "language"`：`materialLang(m) === t.lang`（`materialLang` = §6.2 的「材料语言」）。
- 其他 mode：`dominantUdc(m) ∈ t.udc_codes`，其中 `dominantUdc(m)` = 来自 m 的卡片 `cards.domain`（JSON 数组，取第一个元素）出现最多的 UDC 叶子，要求该叶子 ≥ 3 张卡；不足 3 张卡时改用 lexical 信号：m 的单元里链接到的 lexical KP 中，`domain_id ∈ t.udc_codes` 的不同 KP ≥ 5 个；都不满足就不自动归属。

没有归入任何轨道的材料进入隐式轨道 `__unassigned`（mode `concept`、不 pinned）。轨道管理对话框列出这些材料供用户手动归类。**`__unassigned` 不参与 §6.9 的权重计算与配额分配**（不进 Σactivity 分母、quota 为 0），它的候选只在 §8.4 最后一步「补位」时使用。没有任何有效轨道（落库与提议都为空）时，`__unassigned` 获得全部配额。

#### KP 属于哪个轨道
KP 的 `domain_id ∈ t.udc_codes` → 属于 t；否则看它链接卡片的材料，取材料所属轨道中卡数最多的那个。

#### 系统提议轨道（`proposeTracks`，纯函数）
- 每种非母语语言（材料语言非空且不在母语生效值中，§11.6）且有 ≥ 1 份材料 → 提议 `{mode:"language", lang, label: 语言名}`。**语言名按界面语言生成**：`new Intl.DisplayNames([uiLocale], { type: "language" }).of(lang)`（`uiLocale` 见 §11.9；失败时用代码本身，如 `"sw"`）。不要手写语言名表。
- 每个 UDC 叶子，若卡片数 ≥ 5 或自动归属材料 ≥ 2 → 提议 `{mode: §3.1 默认, udc_codes:[叶子], label: UDC 名称}`（UDC 名称当前只有中文表 `electron/udc.js`；`uiLocale` 非 `zh` 时先显示中文名，待全局 i18n 落地后由字符串表接管，见 §11.9）。
- 提议轨道的 `label` 只在展示时生成，不落库；用户「采纳」时才把当时显示的 label 写进 `learner_tracks.label`（之后用户可改名）。
- 已有同 lang 的 language 轨道、或已有包含该叶子的非 language 轨道 → 不再提议。
- **用户一条轨道都没有时，推荐引擎把全部提议当作隐式轨道使用**（不落库），面板顶部提示「这些轨道是根据书架自动推断的，点此确认或调整」。

#### 轨道权重（推荐分配给各领域的比例）
对每个 active 轨道，统计近 28 天的每日活跃度：
```
a_d = 当日该轨道复习次数/20 + 当日阅读字数/5000 + 当日新建摘录数 + 当日新建卡片数/2
activity = Σ_d a_d × 0.5^(距今天数/14)
```
- 「当日阅读字数」= 该轨道材料的 `reading_events` 相邻正增量之和（与 `stats` 的口径一致，正增量且 ≤ JUMP_CHARS 才计）。
- 复习次数按卡片所属材料归轨道；卡片没有材料时按其 KP 归轨道；都没有则不计。
- `share = activity / Σactivity`（全部为 0 时各轨道均分）。
- `weight = share × (priority / 3)`；`pinned` 的轨道 `weight = max(weight, 0.3)`；`paused / archived` 的轨道 weight = 0、不参与推荐。
- 最后归一化使 Σweight = 1。
- **冷启动加成**：近 28 天活跃度为 0 但 `pinned` 的轨道照样有 0.3 的份额——用户明确说要学的领域，即使最近没碰也要推。

---

## 7. 发现与匹配下一步内容（问题 3）

### 7.1 流程

```
learner:recommend
  └─ 若 force 或距上次刷新 > 10 分钟：await learnerRefresh.refresh()
  └─ snapshot = learnerRefresh.buildSnapshot()      // 组装纯数据对象（§9.2）
  └─ result = lmRecommend.recommend(snapshot, opts) // 纯函数；result.autoDone = 自动判定完成的 [{itemKey, kind, libraryItemId}]（§8.6）
  └─ 对 result.autoDone 每项写一行 rec_feedback（action='done', auto=1）
  └─ 若 result 的 key 列表指纹与最近一条 rec_runs 不同：写 rec_runs（并裁剪到 300 行）+ persist()
  └─ 返回 §11.1 定义的结构；指纹未变时 runId 取最近一条 rec_runs 的 id
```
**首次索引耗时长**：若 `status.indexing === true`（另一处已在刷新）或从未完成过刷新（`lastRefreshAt === 0`），`learner:recommend` **不等待**，立即返回 `{ok:true, indexing:true, items:[], ...}`，并在后台启动 refresh；面板每 1 秒轮询 `learner:status`，`indexing` 变为 false 后再请求一次。其余情况（距上次 > 10 分钟）照常 await refresh。

`recommend(snapshot)` 内部：
1. `tracks = 有效轨道（落库的 active 轨道；没有则用提议轨道） + __unassigned`。
2. 计算轨道权重（§6.9）。
3. 对每个轨道，按其 mode 运行对应的生成器（§8.2 表中「适用 mode」列），得到候选。
4. 应用过滤：冷却期内的 key、`not_interested` 的材料、`hard` 带（language，冷启动轨道除外）、先修未就绪（concept/procedural 的 K1，见 §8.2 K1）。
5. 打分（§8.3）。
6. 按轨道配额 + 多样性约束选取（§8.4）。
7. 生成理由文案（§8.5）。

### 7.2 关键匹配信号

| 信号 | 计算 | 用在哪 |
|---|---|---|
| 单元的知识点 | `unit_kp_links` | 新颖度、就绪度、换个讲法 |
| 新颖度 novelty(u) | 单元链接 KP 中等级 ≤ L1 的占比；单元没有链接 KP 时：未读 0.6、已读 0.1 | 概念类的 value 与 fit |
| 就绪度 readiness(u) | 先修集合 P(u) = 单元链接 KP 的 `prerequisite` 前置 KP（`knowledge_relations` 中 `relation_type='prerequisite'` 且 `to = 单元 KP`，取 `from`）∪ 同材料上一单元（ord−1）链接的 KP（权重 0.5）。readiness = Σ w_p × min(1, score_p / 0.6) ÷ Σ w_p；P 为空时 = 0.7 | 概念类的 fit；前置未就绪时压制 |
| 覆盖率 coverage(u) | §6.8 | 语言类的 fit |
| 复现度 recycling(u) | `min(1, learningCount(u) / 20)` | 语言类的 value（窄读：选能复现你正在学的词的文本） |
| 动量 momentum | 该材料或 KP 近 3 天有活动 → 1；近 14 天 → 0.5；否则 0 | 所有类型 |
| 用户优先级 priority | 材料 `1 − library_items.priority / 100`；摘录 `1 − extracts.priority / 100`（数字越小越优先，§6.4） | 所有类型 |

**挑战适配 fit：**
- 概念类：`fit = readiness × (1 − |novelty − NOVELTY_TARGET| / max(NOVELTY_TARGET, 1 − NOVELTY_TARGET))`，`NOVELTY_TARGET = 0.3`。
- 语言类：`easy → 0.7`，`optimal → 1.0`，`intensive → 0.6`，`hard → 0`（并被过滤）。
- 冷启动语言轨道（该语言已知词项 < `COLD_START_KNOWN`(200) 且没有 `placement` 事件）：**不用覆盖带，也不做 `hard` 过滤**（此时几乎所有单元都会算成 hard，过滤会清空推荐）。所有单元 fit 用「易读度」代替：`fit = 1 − 单元非停用词的平均频次排名 / 该语言非停用词项总数`（频次排名按 `lexemes.total_count` 降序，1 起；平均按词例加权），并强制插入一条 `placement` 推荐（§8.2 K14）。易读度在 refresh 的 lex 步骤里算好，存入 Snapshot.units[].easeFit。

---

## 8. 推荐内容（问题 4）与打分

### 8.1 推荐种类总表（`kind` 封闭枚举，13 个；编号 K1–K14，K13 预留）

| # | kind | 中文标签 | 适用 mode | 一句话 |
|---|---|---|---|---|
| K1 | `continue` | 继续读 | 全部 | 在读材料的下一节 |
| K2 | `start` | 开始读 | 全部 | 还没开始的材料 |
| K3 | `extract-batch` | 处理摘录 | 全部 | 该轨道今天到期的摘录 |
| K4 | `extract-to-card` | 摘录制卡 | concept / procedural / factual | 读过多遍但还没制卡的摘录 |
| K5 | `reinforce` | 巩固 | concept / procedural / factual | 正在遗忘或卡住的知识点 |
| K6 | `cross-material` | 换个讲法 | concept / procedural | 另一份材料也讲到你正在学的知识点 |
| K7 | `self-explain` | 自我解释 | concept / procedural | 不看材料，用自己的话讲清一个知识点 |
| K8 | `practice` | 练习 | procedural | 习题单元，或为知识点补应用题卡 |
| K9 | `find-material` | 缺少材料 | concept / procedural | 先修知识点在书架上找不到任何材料 |
| K10 | `reread` | 重读 | language | 按间隔重读含较多「正在学的词」的单元 |
| K11 | `context-reel` | 语境串 | language | 一个正在学的词在不同文本里的 3–5 个句子 |
| K12 | `sentence-mine` | 挖句子 | language | 只差一个生词的句子，适合制卡或标记 |
| K13 | （保留编号，不实现） | — | — | — |
| K14 | `placement` | 词汇快测 | language | 冷启动时 2 分钟估计词汇量 |

> K13 预留给 L7 的 AI 增强（如 AI 出应用题），v1 不实现、不出现在枚举里。

### 8.2 各生成器规格（`lmRecommend.js`）

每个候选的形状：
```ts
type Candidate = {
  key: string;            // 冷却与反馈用的稳定键，格式见各行
  kind: RecKind;
  trackId: string;
  libraryItemId?: string; unitId?: string; kpId?: string; extractIds?: string[];
  title: string;          // 面板主标题
  f: { fit: number; value: number; urgency: number; momentum: number; priority: number }; // 全部 0..1
  facts: Record<string, string | number>; // 理由模板要用的事实（§8.5），只放真实数字
  action: RecAction;      // §8.7
};
```

**标题（`title`）格式**：continue `继续读《{material}》：{unitTitle}`；start `开始读《{material}》`；extract-batch `处理 {count} 条到期摘录`；extract-to-card `为摘录制卡：「{snippet}…」`；reinforce `巩固「{kpName}」`；cross-material `换个讲法：《{material}》{unitTitle}`；self-explain `用自己的话讲「{kpName}」`；practice 8a `练习：《{material}》{unitTitle}`、8b `为「{kpName}」做一张应用题卡`；find-material `找一份讲「{prereqName}」的材料`；reread `重读：《{material}》{unitTitle}`；context-reel `语境串：{word}`；sentence-mine `挑 {count} 个句子`；placement `词汇快测（{trackLabel}）`。
**数字取整**：`daysAgo = Math.floor(天数)`；`maxOverdueDays = Math.floor`；`minutes = Math.ceil`；`coveragePct = Math.round(coverage × 100)`；`meanRPct = Math.round(meanR × 100)`。facts 里存的就是取整后的值。

**K1 continue**（每份材料至多 1 个）
- 条件：材料属于该轨道；有通读记录的单元 ≥ 1；存在 `ord > 已通读最大 ord` 的单元；最近一次通读在 60 天内。
- 目标单元 u = 第一个 `ord > 已通读最大 ord` 的单元。
- concept / procedural：若 `readiness(u) < 0.4`，**不出 K1**，改为对 u 的未就绪先修 KP（score 最低的那个）出一条 K5 reinforce（若该 KP 有卡）或 K9 find-material（若该 KP 没有任何单元链接）。
- 特征：fit = 按 mode 算（§7.2）；value：概念类 `0.6 + 0.4 × novelty(u)`，语言类 `0.5 + 0.5 × recycling(u)`，narrative/factual `0.6`；urgency：距最近通读 d 天，`d < 1 → 0`，`1 ≤ d ≤ 7 → d/7`，`7 < d ≤ 30 → 1`，`d > 30 → 0.5`；momentum：`d ≤ 3 → 1`，否则 `0.5`；priority：材料优先级。
- key `continue:<libraryItemId>`。action `open-book`（§8.7）。
- facts：`material`（书名）、`unitTitle`、`daysAgo`、`minutes`（= u.plainLen / 阅读速度，`zh ja ko` 及 `spaced=false` 的语言 400 字/分，其他 1000 字符/分，向上取整）；概念类加 `kpNames`（u 链接的 L1–L3 KP 前 2 个标签，用「、」连接）；语言类加 `coveragePct`（四舍五入整数）、`bandLabel`、`learningCount`。

**K2 start**（每轨道至多 3 个候选）
- 条件：材料属于该轨道；所有单元都没有通读；材料没有被 `not_interested`。
- 目标单元 u = `ord` 最小且 `plainLen ≥ 300` 的单元。
- 语言类：`band(u) === "hard"` 时过滤掉（冷启动轨道不过滤，见 §7.2）。
- 特征：fit 按 mode；value 概念类 `0.5 + 0.5 × novelty(u)`，语言类 `0.4 + 0.6 × recycling(u)`，其余 0.5；urgency 0.2；momentum 0；priority 材料优先级。
- key `start:<libraryItemId>`。action `open-book`。facts 同 K1（无 daysAgo）。

**K3 extract-batch**（每轨道至多 1 个）
- 条件：该轨道材料中，到期摘录数 N ≥ 1。到期口径**与 `listDueExtracts`（`db.js:2963-2991`）完全相同**：`e.is_deleted = 0`、所属 document 与 library_item 未删、`COALESCE(e.kind,'extract') = 'extract'`、`COALESCE(e.status,'open') NOT IN ('resolved','dismissed','archived')`、`e.topic_next_at <= now`。在 `learnerFacts()` 里直接复用这段 WHERE 条件（复制 SQL，不要调用 `listDueExtracts` 本身以免改变其行为）。
- 特征：fit 0.8；value `min(1, N / 10)`；urgency `min(1, 最大逾期天数 / 14)`；momentum：这些摘录所属材料近 3 天有阅读 → 1，否则 0.5；priority `1 − 最小 priority / 100`。
- key `extract-batch:<trackId>`。action `extract-session`，`bookItemIds` = 这些摘录所属材料 id 去重。facts：`count`、`maxOverdueDays`、`topSnippet`（排序第一条摘录纯文本前 30 字）。

**K4 extract-to-card**（每轨道至多 2 个）
- 条件：摘录 `status = 'reading'`，`process_count ≥ 2`，没有任何卡片的 `context_ref_json.extractId` 等于它，`priority ≤ 50`。
- 排序取前 2：`priority` 升序，再 `process_count` 降序。
- 特征：fit 0.7；value `0.5 + 0.1 × min(5, process_count)`；urgency 0.3；momentum 按材料；priority 摘录优先级。
- key `extract-to-card:<extractId>`。action `jump`（打开原文位置，用户在阅读器里制卡）。facts：`snippet`（前 40 字）、`processCount`、`material`。

**K5 reinforce**（每轨道至多 2 个）
- 条件：KP 属于该轨道，`fading = 1`；或 等级 = L2 且 n ≥ 2 且 meanR < 0.8 且 lapses30Total ≥ 2（卡住）。
- 特征：fit 0.7；value `1 − meanR`；urgency `fading ? 1 : 0.6`；momentum：该 KP 的卡近 7 天被复习过 → 1，否则 0.4；priority 0.5。
- action：该 KP 有今天到期的卡 → `review`（`scopeKpIds:[kpId 家族]`）；否则 → `jump` 到该 KP 第一张有来源的卡的原文位置（重读原文段落，而不是提前复习卡片——提前复习不符合 FSRS 最优间隔）。
- key `reinforce:<kpId>`。facts：`kpName`、`meanRPct`、`levelLabel`、`fading`。

**K6 cross-material**（每轨道至多 1 个）
- 条件：KP 等级 L2 或 L3；存在链接该 KP（任意 source、weight ≥ 0.3）的单元 u，u 所属材料 ≠ 该 KP 卡片所在的所有材料，且 u 没有通读。
- 选择：KP 按 momentum 降序再 score 升序取第一个；u 取 weight 最大的。
- 特征：fit `readiness(u)`；value 0.7；urgency 0.2；momentum 按 KP；priority 材料优先级。
- key `cross:<kpId>:<unitId>`。action `jump`（单元开头：`anchorText` = 单元纯文本前 30 字，`anchorRatio` = `md_from / markdown.length`；PDF 用 `pageIndex = page_from`）。facts：`kpName`、`material`、`unitTitle`。

**K7 self-explain**（每轨道至多 1 个）
- 条件：KP 等级 L3；有至少一条 `knowledge_relations`（任一方向、非 `analogous_to`）连到另一个等级 ≥ L2 的 KP B；近 30 天该 KP 没有 `self_explain` 事件。
- 特征：fit 0.8；value 0.6；urgency 0.3；momentum 按 KP；priority 0.5。
- key `self-explain:<kpId>`。action `dialog:self-explain`（payload `{kpId, relatedKpId, relationType}`）。facts：`kpName`、`relatedName`、`relationLabel`（中文：prerequisite 先修、part_of 组成部分、related_to 相关、contrasts_with 对比、example_of 例子、application_of 应用、generalization_of 概括、specialization_of 特例）。
- 对话框提示语模板：`不看材料，用自己的话解释「{kpName}」，并说明它与「{relatedName}」的关系（{relationLabel}）。写完再对照原文。`

**K8 practice**（procedural，每轨道至多 2 个）
- 8a：`is_exercise = 1` 的未通读单元，且链接的 KP 中有 L2–L3 → key `practice-unit:<unitId>`，action `jump`，value 0.8，fit `readiness(u)`。
- 8b：等级 L3、没有任何应用卡（§6.6 定义）、且该 KP 有至少一张来自 AI 制卡的卡（`generated_by != 'manual'`，说明这条材料走过 AI 制卡、可以用「AI 制卡」重新生成含应用卡的一批）的 KP → key `practice-card:<kpId>`，action `jump` 到该 KP 第一张有来源的卡的原文，标题「为「{kpName}」做一张应用题卡」，value 0.7，fit 0.7。**8b 的冷却**：该 key 只要在近 30 天的 `rec_runs` 里出现过（不论用户是否点击），就不再出现——避免同一个 KP 天天被推。
- 两者 urgency 0.3、momentum 按 KP、priority 0.5。

**K9 find-material**（全局至多 1 个）
- 条件：KP X 等级 ≥ L2，X 的某个 `prerequisite` 前置 P 等级 ≤ L1，且 P 没有任何 `unit_kp_links`。
- 特征：fit 0.5；value 0.5；urgency 0.4；momentum 按 X；priority 0.5。
- key `find:<P.id>`。action `copy-query`（复制 `{P.canonical_label} 入门`，不联网）。facts：`prereqName`、`kpName`。

**K10 reread**（language，每轨道至多 2 个）
- 条件：单元通读次数 c ≥ 1；`learningCount(u) ≥ REREAD_MIN_LEARNING (5)`；距最近通读天数 ≥ `REREAD_INTERVALS_DAYS[min(c − 1, 4)]`，间隔表 `[3, 7, 16, 35, 75]`；c ≤ 5（读满 6 遍不再推）。
- 特征：fit 0.9；value `recycling(u)`；urgency `min(1, 逾期天数 / 7)`（逾期天数 = 距最近通读 − 应间隔）；momentum 按材料；priority 材料优先级。
- key `reread:<unitId>`。action `dialog:unit-reader`（payload `{unitId}`）。facts：`unitTitle`、`material`、`passCount`、`learningCount`。

**K11 context-reel**（language，每轨道至多 1 个）
- 目标词：状态 `learning` 的非停用词项，按最后查词时间降序（没查过的按 `total_count` 降序），取第一个满足「在 ≥ 2 个不同单元里能找到含它的句子，共 ≥ 3 句」的。
- 句子搜集（在 `learner:contextReel` 里做，生成器只用 `unit_lex` 判定可行性）：从含该词项的单元中，已通读单元优先、再未读单元，每单元至多 2 句，最多 5 句。
- 特征：fit 0.9；value 0.7；urgency 0.4；momentum 1（如最近查过）否则 0.5；priority 0.5。
- key `reel:<lang>:<lexemeKey>`。action `dialog:context-reel`（payload `{lang, key}`）。facts：`word`（sample）、`sentenceCount`。

**K12 sentence-mine**（language，每轨道至多 1 个，聚合）
- 在近 14 天通读过的单元里统计 i+1 句子（§6.8），目标词状态是 `learning` 或 `seen` 且 `lexemes.unit_count ≥ 2`（在别处也出现，值得学）。数量 M ≥ 3 才出。**M 在 refresh 的 lex 步骤末尾计算**（切句 + 分词，上限数到 50 即停），存入 `lm_meta`（key `mine_count:<lang>`），buildSnapshot 只读这个缓存值放进 `lexStats[lang].mineCount`。
- 特征：fit 0.9；value `min(1, M / 10)`；urgency 0.3；momentum 1；priority 0.5。
- key `mine:<trackId>`。action `dialog:sentence-mine`（payload `{trackId}`）。facts：`count`。

**K14 placement**（language，冷启动）
- 条件：该语言已知词项（known+familiar，不含停用词）< 200，且没有 `placement` 事件，且该语言词项总数 ≥ 300。
- 不参与打分，**直接占该轨道第一个名额**。key `placement:<lang>`。action `dialog:placement`（payload `{lang}`）。facts 固定为 `{ minutes: 2 }`（理由模板里的「2 分钟」来自这里）。

**`RecItem`（返回给渲染层、存入 `rec_runs.items_json` 的形状）：**
```ts
type RecItem = {
  key: string; kind: RecKind; trackId: string; trackLabel: string;
  libraryItemId?: string; unitId?: string; kpId?: string; extractIds?: string[];
  title: string; reason: string; score: number;
  facts: Record<string, string | number>;
  action: RecAction;
};
```
**action 的写法约定**：上文「action `dialog:xxx`」都表示 `{ type: "dialog", dialog: "xxx", payload }`；「action `jump`」需要 `documentId` 与 `anchor`：单元开头用 `{ anchorText: unit.headText, anchorRatio: unit.mdFrom / docLen }`（PDF 用 `{ anchorText: unit.headText, pageIndex: unit.pageFrom }`）；卡片原文用该卡 `context_ref_json` 里的 `anchorText / anchorRatio / pageIndex / cfi` 原样传。

### 8.3 打分（加权和，不用连乘）

```
base = 0.35×fit + 0.25×value + 0.15×urgency + 0.15×momentum + 0.10×priority
score = base × KIND_PRIOR[kind] × feedbackMultiplier(kind)
```
`KIND_PRIOR`：continue 1.0、start 0.85、extract-batch 0.95、extract-to-card 0.8、reinforce 0.9、cross-material 0.7、self-explain 0.75、practice 0.85、find-material 0.6、reread 0.9、context-reel 0.8、sentence-mine 0.8、placement（不打分）。

`feedbackMultiplier(kind) = 0.7 ^ (近 90 天该 kind 的 not_interested 次数)`，下限 0.3。

**为什么加权和：** 任何一个特征为 0 不会让整项归零；每个特征对总分的贡献可以直接在理由里说清楚；权重少、可调。

### 8.4 选取：轨道配额 + 多样性

```
N = app.learner.recCount（默认 6，范围 3..10）
quota[t] = 按最大余数法把 N 按 weight[t] 分配（每个 weight>0 的 pinned 轨道至少 1）
placement 先占名额（计入所在轨道 quota）
对每个轨道 t：候选按 score 降序贪心选取，跳过违反约束的：
   同一 kind 在全体结果中 ≤ MAX_PER_KIND(2)
   同一材料在全体结果中 ≤ MAX_PER_MATERIAL(2)
   同一 key 不重复
某轨道候选不够填满 quota → 剩余名额按 score 降序从所有轨道的剩余候选里补（仍守约束）
最终列表按 score 降序排列（placement 置顶）
```
**确定性（tie-break）**：score 相同按 `key` 字典序升序；最大余数法余数相同按 `trackId` 字典序升序。所有 `Map / Set` 遍历前先把键排序。`score` 保留 6 位小数后再比较（避免浮点抖动）。
返回结果附 `candidateCount`（过滤后候选总数）和 `byKind`（各 kind 候选数），用于面板底部「从 N 个候选中选出」。

### 8.5 理由文案（本地模板，禁止编造数字）

每个 kind 一个模板函数 `explain(candidate) → string`，只能使用 `facts` 里的值。模板：

| kind | 模板 |
|---|---|
| continue（概念类） | `上次读到这里是 {daysAgo} 天前。下一节约 {minutes} 分钟，涉及你正在学的「{kpNames}」。`（kpNames 为空时去掉后半句） |
| continue（语言类） | `下一节已知词覆盖约 {coveragePct}%（{bandLabel}），含 {learningCount} 个你正在学的词，约 {minutes} 分钟。` |
| continue（其他） | `上次读到这里是 {daysAgo} 天前，下一节约 {minutes} 分钟。` |
| start | 概念类 `第一节约 {minutes} 分钟。`；语言类 `开头一节已知词覆盖约 {coveragePct}%（{bandLabel}）。` |
| extract-batch | `{count} 条摘录到期，最久的已逾期 {maxOverdueDays} 天。第一条：「{topSnippet}…」` |
| extract-to-card | `这条摘录你已经读过 {processCount} 遍，还没有制卡。` |
| reinforce | fading：`「{kpName}」曾经记得很牢，现在平均回忆率降到 {meanRPct}%，重读一下原文。`；卡住：`「{kpName}」的卡最近反复忘记（平均回忆率 {meanRPct}%）。` |
| cross-material | `你正在学「{kpName}」，《{material}》的「{unitTitle}」也讲到了它，换个角度看一遍。` |
| self-explain | `「{kpName}」已经巩固中。试着不看材料讲清它与「{relatedName}」的关系。` |
| practice | 8a `这是一节练习，涉及你正在学的知识点。`；8b `「{kpName}」还没有应用题卡，会做比会背更重要。` |
| find-material | `学「{kpName}」需要先懂「{prereqName}」，但书架上没有讲它的材料。` |
| reread | `这一节你读过 {passCount} 遍，里面有 {learningCount} 个正在学的词，到了重读的时候。` |
| context-reel | `「{word}」在你的材料里出现在 {sentenceCount} 个句子中，连着读一遍。` |
| sentence-mine | `最近读过的内容里有 {count} 个只差一个生词的句子。` |
| placement | `先花 2 分钟估一下词汇量，推荐会更准。` |

`bandLabel`：easy 轻松、optimal 最适合、intensive 需要查词、hard 太难。

测试义务：每个模板输出里的每个数字都必须能在 `facts` 的值里找到（复用 `electron/kpScopes.js:77` 的 `fabricatedNumbers` 思路写断言）。

### 8.6 反馈（`rec_feedback.action` 封闭枚举）

| action | 来源 | 效果（全部在 `recommend` 时由 feedback 行重算，不另存状态） |
|---|---|---|
| `opened` | 用户点主按钮 | 无（只记录） |
| `done` | 系统自动判定（`auto=1`，见下）或对话框完成 | 该 key 冷却 12 小时 |
| `snooze` | 菜单「稍后」 | 该 key 冷却 3 天 |
| `dismissed` | 菜单「不用了」 | 该 key 冷却 3 天 |
| `not_interested` | 菜单「对这本书不感兴趣」（有材料时）或「不想要这类推荐」 | 有 `library_item_id`：该材料 60 天内不出 K1/K2；没有：该 kind 的 feedbackMultiplier ×0.7 |
| `too_hard` | 菜单「太难」（仅 K1/K2/K10） | 按轨道计算：取该轨道近 20 条 `too_hard/too_easy` 反馈，净值 `net = too_hard 数 − too_easy 数`。语言类：`bandOf` 的 `shift = clamp(net × 0.01, −0.03, +0.03)`（正 = 要求更高覆盖率）；概念类：`NOVELTY_TARGET` 用 `0.3 − clamp(net × 0.05, −0.15, +0.15)` |
| `too_easy` | 菜单「太简单」（仅 K1/K2/K10） | 计入上面的 net（反向） |

反馈按轨道归属：`rec_feedback` 没有 trackId 列，用 `item_key` 在 `rec_runs.items_json` 里找回 trackId（找不到就用 `library_item_id` 所属轨道）。

**自动判定完成**（每次 `recommend` 前，对最近一条 rec_run 中、展示后 7 天内、没有 done 反馈的项检查）：
- continue / start / cross-material / practice-unit：目标单元在展示之后有通读。
- extract-batch：这些摘录在展示之后有 `extract_ops` 记录。
- extract-to-card / practice-card：展示之后出现了来源指向该摘录 / 该 KP 的新卡。
- reinforce：展示之后该 KP 的卡有复习，或目标单元有通读。
- reread / context-reel / self-explain / placement / sentence-mine：对应 `learning_events` 存在（sentence-mine：展示后有 `via:"mine"` 的 `lexeme_mark` 或新词汇卡）。

### 8.7 动作（`RecAction`）

```ts
type RecAction =
  | { type: "open-book"; libraryItemId: string; hintUnitTitle?: string }
  | { type: "jump"; documentId: string; anchor: { anchorText: string; anchorRatio?: number; pageIndex?: number } }
  | { type: "review"; scopeKpIds: string[]; title: string }
  | { type: "extract-session"; bookItemIds: string[]; title: string }
  | { type: "copy-query"; text: string }
  | { type: "dialog"; dialog: "self-explain" | "unit-reader" | "context-reel" | "sentence-mine" | "placement"; payload: Record<string, string | null> };
```
`jump.anchor` 实际类型与 App 的 `jumpAnchor` 相同（`src/App.tsx:61`），可额外带 `cfi?`、`chapterIndex?`。
渲染层处理见 §11.3。`open-book` 正常打开阅读器（会记阅读进度，从上次位置继续）；`hintUnitTitle` 只显示在推荐项的标题里（「继续读《书名》：{hintUnitTitle}」），打开书后不另作提示。`jump` 走现有「跳转原文」，属现场查看语义，不记阅读进度——所以 K6、K8a 这类「去读另一节」的推荐，用户若想正式读，需从书架再打开；v1 接受这一点。

---

## 9. 刷新管线与快照

### 9.1 `learnerRefresh.js`

```js
let running = null;   // 单飞
let status = { indexing: false, phase: "", done: 0, total: 0, lastRefreshAt: 0, lastError: "" };

async function refresh({ force = false } = {}) {
  if (running) return running;
  running = (async () => { try { /* 下面 6 步 */ } finally { running = null; } })();
  return running;
}
```
六步（每步更新 `status.phase`；每 200 个单元或 2000 个词项让出一次主进程）：
1. **units**：先清理——删除「材料已删（`library_items.is_deleted=1` 或行不存在）」的所有 `content_units` 及其 `unit_lex`（按旧 `lex_json` 回减 `lexemes` 计数）、`unit_kp_links`、`unit_progress`、`pdf_page_texts`、`pdf_high_water`。然后遍历未删材料，按 §6.1 判断是否需要重新切分；PDF 需要时先抽页文本。
2. **passes**：§6.4 增量通读计算 + PDF high water + `unit_reread` 事件。
3. **links**：§6.5 的 card / extract / lexical 链接。
4. **kp**：对全部 active 根 KP 计算 §6.6 等级，整表覆盖写 `kp_states`（保留 first_l3_at / first_l4_at）。
5. **lex**：只对属于 language 轨道（含提议轨道）的材料：索引新单元（§6.2），然后对这些语言的全部词项计算 §6.7 状态，整表覆盖写 `lexeme_states`；再计算每个单元的 `coverage / learningCount / easeFit`（存内存缓存，buildSnapshot 使用）与 `mine_count:<lang>`（§8.2 K12）。
6. **save**：`learnerDb.save()`；`status.lastRefreshAt = Date.now()`。

失败处理：任何一步抛错 → `status.lastError = 错误信息`，已完成的步骤保留，`learnerDb.save()` 照常执行，`refresh` 返回 `{ok:false, error}`，**不抛到 IPC 外**。

触发：
- `learner:recommend` 时距上次 > 10 分钟自动触发。
- 应用启动后 20 秒（`setTimeout`，回调里 `learnerEnabled()` 为 true 才执行，§11.8）后台触发一次。
- `refresh` 每一步开始前检查 `learnerEnabled()`，为 false 则停止（§11.8）。
- 「刷新」按钮 `learner:refresh({force:true})`。
- **不**在复习、摘录、制卡的 IPC 里触发（硬规则 0.1-5）。

### 9.2 快照（`buildSnapshot()` → 传给 `lmRecommend.recommend`）

```ts
type Snapshot = {
  now: number;
  settings: { nativeLangs: string[] /* 生效值，§11.6 */; recCount: number; locale: "zh" | "en" /* learnerLocale()，§11.9 */ };
  tracks: Track[];                 // 落库轨道（未删）
  proposals: TrackProposal[];      // proposeTracks 结果
  overrides: { trackId, libraryItemId, member }[];
  materials: { id, title, lang, priority, sourceType, dominantUdc: string|null, lexicalUdcCounts: Record<string,number>, lastPassAt: number|null }[];
  units: { id, libraryItemId, documentId, ord, title, headText, plainLen, isExercise, mdFrom, mdTo, pageFrom, pageTo, docLen, passes: number[], kpLinks: { kpId, weight }[], coverage?: number, learningCount?: number, easeFit?: number, lang }[];
  kps: { id, label, domainId, level, score, fading, metrics, prereqIds: string[], relations: { otherId, type }[], cardMaterialIds: string[], dueToday: boolean, lastReviewAt: number|null, firstSourceCard: { documentId, anchor } | null, hasApplicationCard: boolean }[];
  extracts: { id, libraryItemId, documentId, status, priority, topicNextAt, processCount, hasCard: boolean, snippet: string, anchor }[];
  lexStats: Record<lang, { knownCount, totalLexemes, hasPlacement: boolean, learningTop: { key, sample, lastLookupAt, totalCount, unitCount }[] /* 前 50 */, mineCount: number }>;
  activity: Record<trackId, number[] /* 近 28 天每日 a_d，下标 0 = 今天 */>;
  feedback: { itemKey, kind, libraryItemId, action, ts }[];   // 近 90 天
  lastRun: { id, createdAt, items: RecItem[] } | null;
  events: { kind, ts, kpId, unitId, lang, payload }[];        // 近 90 天 self_explain / reel_done / unit_reread / lexeme_mark / placement
};
```
- `db.js` 新增的 `listLearnerTracks()` 必须**无参可调**、空库返回 `[]`、不播种任何行（闸门 f19 会自动用 `()`、`({})` 调用所有 `list*/get*/compute*` 导出函数）。
- 主库查询写成 `db.js` 的导出函数 `learnerFacts()`，一次返回 tracks / overrides / materials 基础信息 / cards（含 fsrs_json、context_ref_json、knowledge_point_id、card_type、dict_json）/ review_logs（card_id, rating, reviewed_at）/ extracts / relations / learning_events / rec_feedback / rec_runs 最新一条 / reading_events（按需：增量部分）。**只读，不写。**
- `learnerRefresh.js` 负责把主库事实与 `learner.db` 派生数据拼成 Snapshot。`lmRecommend.recommend` 不访问任何数据库。

### 9.3 性能预算（验收时测）

- 首次全量索引：100 本书（约 1 万单元，其中语言材料 30 本）在主机上 ≤ 90 秒，期间界面不卡（每批让出）。
- 增量刷新（无新材料）：≤ 3 秒。
- `recommend` 纯函数：1 万单元、2000 KP 的快照 ≤ 300 ms。
- `learner.db` 大小：30 本语言材料 ≤ 60 MB。

### 9.4 备份与恢复

- `learner.db` **不进备份**（派生数据）。在 M2 备份代码里不要加它。
- 恢复备份后：主库里的 documents 可能与 `learner.db` 不一致——§6.1「何时重新切分」规则会让变化的文档自动重切；`kp_states / lexeme_states` 每次刷新整表重算；`passes_watermark` 在恢复后可能超前，所以 `refresh` 开头检查：若 `passes_watermark > 主库 reading_events 最大 created_at`，清零水位并清空 `unit_progress` 后全量重算。

### 9.5 与摘录引擎 E1 的衔接（E2，L6 批）

`electron/aiNextExtract.js` 的 `scoreExtracts`（:29）当前 KP_frontier 项为空。机制（照做，不要另想）：

1. `aiNextExtract.js`：`scoreExtracts(items, nowTs, opts = {})` 与 `rankExtracts(items, nowTs, opts = {})` 各加第三个可选参数；`rankExtracts` 把 `opts` 原样传给 `scoreExtracts`。`scoreExtracts` 内 `const kf = typeof opts.kpFactorOf === "function" ? Number(opts.kpFactorOf(it.id)) || 1 : 1;`，把 `kf` 乘到该条现有的乘积上（E1 本身是连乘结构，保持一致，不重构 E1）。不传 opts 时行为与现在逐字节相同。
2. `db.js`：新增模块级变量 `let kpFactorMap = null;` 与导出函数 `setKpFactorMap(map)`（接受 `Map<extractId, number>` 或 null）。`computeSessionQueue` 的 `ENGINE_AI` 分支（`db.js:4157-4166`）调用 `rankExtracts(items, nowTs, { kpFactorOf: (id) => (lmOn && kpFactorMap && kpFactorMap.has(id) ? kpFactorMap.get(id) : 1) })`，其中 `const lmOn = readSettings().app?.learner?.enabled !== false;`（总开关，§11.8）。
3. `learnerRefresh.js`：每次 refresh 成功后，计算每条未删摘录的因子并调用 `db.setKpFactorMap(map)`：
```
kpFactor = 摘录没有 KP（§6.5 摘录 kpIds 为空）→ 不放进 map（等于 1）
         = 否则 0.85 + 0.45 × readiness(摘录 KP 集合)    // 范围 0.85..1.30；readiness 同 §7.2，把摘录的 KP 当作单元 KP 计算
```
4. 设置页 `SettingsPanel.tsx:898` 的「Frontier 因子未接入」文案改为按开关显示：开启 →「知识点就绪度已接入（学习推荐刷新后生效）」；关闭 →「知识点就绪度未启用（学习者知识模型已关闭）」。

---

## 10. 参数文件 `electron/lmParams.js`（照抄）

```js
"use strict";
// D124 学习者模型参数（LM-1）。改任何数值都必须 bump PARAM_VERSION 并在指导文档 §4.20 记录。
module.exports = Object.freeze({
  LM_VERSION: "LM-1",
  PARAM_VERSION: 1,
  LEARNER_DB_SCHEMA: 1,
  SEG_VERSION: 1,
  LEX_VERSION: 1,
  DAY_MS: 86400000,
  UNIT_MIN_CHARS: 1500,
  UNIT_TARGET_CHARS: 3000,
  UNIT_MAX_CHARS: 6000,
  SESSION_GAP_MS: 30 * 60 * 1000,
  JUMP_CHARS: 20000,
  END_RATIO: 0.97,
  PDF_JUMP_PAGES: 30,
  FREQ_STOP_TOP: 50,          // 无停用词表的语言：频次前 50 的词项视同停用词（§6.2）
  LANG_VOTE_MIN: 5,           // detectLang 拉丁语言停用词投票的最低票数（§6.2）
  FSRS_DEFAULT_DECAY: 0.1542,
  KP: { STABLE_S: 21, LONG_S: 60, R_CONSOL: 0.85, R_SOLID: 0.90, R_FADING: 0.75,
        STABLE_RATIO: 0.5, LONG_RATIO: 0.6, LAPSE_WINDOW_DAYS: 30, SELF_EXPLAIN_WINDOW_DAYS: 90,
        STUCK_R: 0.8, STUCK_LAPSES: 2 },
  LEX: { FAMILIAR_PASSES: 3, FAMILIAR_TOKENS: 8, POST_LOOKUP_PASSES: 5, POST_LOOKUP_DAYS: 14,
         CARD_KNOWN_S: 21, CARD_KNOWN_R: 0.85, COLD_START_KNOWN: 200, PLACEMENT_MIN_LEXEMES: 300 },
  BANDS: { EASY: 0.98, OPTIMAL: 0.95, INTENSIVE: 0.90 },
  BAND_FIT: { easy: 0.7, optimal: 1.0, intensive: 0.6, hard: 0 },
  READ_SPEED: { cjk: 400, other: 1000 }, // cjk = zh ja ko 及 LANG_PROFILE.spaced=false 的语言
  REREAD_INTERVALS_DAYS: [3, 7, 16, 35, 75],
  REREAD_MIN_LEARNING: 5,
  REREAD_MAX_PASSES: 6,
  NOVELTY_TARGET: 0.3,
  READINESS_BLOCK: 0.4,
  READINESS_EMPTY: 0.7,
  READY_SCORE: 0.6,
  TRACK: { WINDOW_DAYS: 28, HALF_LIFE_DAYS: 14, PINNED_MIN_SHARE: 0.3 },
  REC: {
    DEFAULT_COUNT: 6, MIN_COUNT: 3, MAX_COUNT: 10, MAX_PER_KIND: 2, MAX_PER_MATERIAL: 2,
    W: { fit: 0.35, value: 0.25, urgency: 0.15, momentum: 0.15, priority: 0.10 },
    KIND_PRIOR: { continue: 1.0, start: 0.85, "extract-batch": 0.95, "extract-to-card": 0.8,
                  reinforce: 0.9, "cross-material": 0.7, "self-explain": 0.75, practice: 0.85,
                  "find-material": 0.6, reread: 0.9, "context-reel": 0.8, "sentence-mine": 0.8 },
    NOT_INTERESTED_DECAY: 0.7, NOT_INTERESTED_FLOOR: 0.3,
    DONE_COOLDOWN_H: 12, SNOOZE_DAYS: 3, DISMISS_DAYS: 3, NOT_INTERESTED_DAYS: 60,
    FEEDBACK_WINDOW_DAYS: 90, BAND_SHIFT_STEP: 0.01, BAND_SHIFT_MAX: 0.03,
    NOVELTY_SHIFT_STEP: 0.05, NOVELTY_SHIFT_MAX: 0.15, AUTO_DONE_WINDOW_DAYS: 7,
    STALE_MS: 10 * 60 * 1000, RUNS_KEEP: 300
  }
});
```

---

## 11. IPC 与界面

### 11.1 IPC（`electron/main.js`，注册在 `knowledge:*` 一组之后；全部 `ipcMain.handle`）

| 通道 | 入参 | 返回 | 实现 |
|---|---|---|---|
| `learner:status` | — | `status` 对象（§9.1） | learnerRefresh |
| `learner:refresh` | `{force?}` | `{ok, ms, error?}` | learnerRefresh.refresh |
| `learner:recommend` | `{force?}` | `{ok, indexing: bool, runId, generatedAt, items: RecItem[], candidateCount, tracks: TrackSummary[], usingProposals: bool, error?}` | §7.1 |
| `learner:feedback` | `{runId, itemKey, kind, libraryItemId?, action}` | `{ok}` | 校验 action 枚举 → 写 `rec_feedback` → persist |
| `learner:listTracks` | — | `{tracks: TrackSummary[], proposals, unassigned: {libraryItemId,title}[]}` | 快照 + 统计 |
| `learner:saveTrack` | `Track`（无 id 为新建） | `Track` | 校验 mode / lang / udc 枚举 → 写库 → persist |
| `learner:deleteTrack` | `id` | `{ok}` | 软删（`is_deleted=1`） |
| `learner:setTrackMaterial` | `{trackId, libraryItemId, member: 0|1|null}` | `{ok}` | null = 删除覆盖（软删） |
| `learner:kpLevels` | `{kpIds?}` | `{kpId, level, label, confidence, fading, metrics}[]` | 读 `kp_states` |
| `learner:logEvent` | `{kind, lang?, libraryItemId?, unitId?, kpId?, payload}` | `{ok, error?}` | 校验 §5.3 → 写 `learning_events` → persist |
| `learner:unitText` | `{unitId}` | `{unitId, title, material, text, lang, learningSpans: [start,end][], documentId, anchor}` | 读单元文本，标出 learning 词的位置 |
| `learner:contextReel` | `{lang, key}` | `{word, sentences: {text, start, end, unitId, material, documentId, anchor}[]}` | §8.2 K11 |
| `learner:sentenceMine` | `{trackId, limit?=10}` | `{items: {sentence, target: {key, sample, start, end}, unitId, material, documentId, anchor}[]}` | §8.2 K12 |
| `learner:placementSample` | `{lang}` | `{bands: {from, to, words: {key, sample}[]}[]}` | 见 §11.4 |
| `learner:lexStats` | `{lang}` | `{knownCount, familiarCount, learningCount, totalLexemes, recentCoverage}` | recentCoverage = 近 5 个通读单元覆盖率平均 |
| `learner:rebuild` | — | 同 `learner:refresh` | `learnerDb.reset()` 后 `refresh({force:true})` |

共 16 个通道。

辅助类型：
```ts
type TrackMode = "language" | "concept" | "procedural" | "factual" | "narrative";
type Track = { id: string; label: string; mode: TrackMode; lang: string; udcCodes: string[];
               status: "active" | "paused" | "archived"; pinned: boolean; priority: number; source: "user" | "proposal" };
type TrackProposal = { key: string /* "lang:en" 或 "udc:51" */; label: string; mode: TrackMode; lang: string; udcCodes: string[] };
type TrackSummary = Track & { isProposal: boolean; weight: number; materialCount: number; kpCount: number;
                              levelCounts: [number, number, number, number, number] /* L0..L4 的 KP 数 */ };
```
提议轨道转成 TrackSummary 时 `id = "proposal:" + key`、`status="active"`、`pinned=false`、`priority=3`、`source="proposal"`、`isProposal=true`。`learner:saveTrack` 收到无 id 的 Track 时新建（`crypto.randomUUID()`），校验：`mode` 在枚举内；language 必须有非空 `lang` 且 `udcCodes` 为空；其他 mode 的 `udcCodes` 每项必须是 `electron/udc.js` 的 `UDC_LEAVES` 编码或 `other`；`priority` 夹到 1..5；`label` trim 后非空、≤ 40 字。

`preload.js`：新增 `contextBridge.exposeInMainWorld("learnerAPI", {...})`，一个通道一个方法，写法照 `knowledgeAPI`（`preload.js:317`）。

### 11.2 渲染层文件

- `src/lib/learner.ts`：`RecKind`、`RecItem`、`RecAction`、`Track`、`TrackSummary` 等类型 + `learnerApi`（包一层 `window.learnerAPI`，不存在时返回空结果，便于浏览器预览）+ `window` 全局类型声明。
- `src/components/learner/NextStepsPanel.tsx`：数据页顶部面板。
- `src/components/learner/TracksDialog.tsx`：轨道管理。
- `src/components/learner/SelfExplainDialog.tsx`、`UnitReaderDialog.tsx`、`ContextReelDialog.tsx`、`SentenceMineDialog.tsx`、`PlacementDialog.tsx`。
- 样式：沿用现有设计 Token 与对话框写法（瑞士风，`docs/swiss-international-style.md`；对话框无障碍参考 `src/lib/dialogA11y.ts`）。不引入新颜色变量，不加动画（遵守 `prefers-reduced-motion` 与 D120 动效规范，若要过渡只用现有的淡入）。

### 11.3 导航（App 层改动，`src/App.tsx`）

1. `src/lib/eventbus.ts` 的 `ALLOWED_EVENTS` 加 `"learner/navigate"`（面板 emit、App 订阅）与 `"learner/changed"`（任一 learner 对话框完成写入后 emit、NextStepsPanel 订阅并重新请求推荐）。
2. `View` 类型里 reader 的 `returnTo` 联合类型加 `"stats"`（`src/App.tsx:62`）；`handleJumpToDoc` 的 `returnTo` 参数类型同步加 `"stats"`（:439）。返回按钮已是 `changeView({ name: view.returnTo ?? "review" })`，`"stats"` 天然可用。
3. App 里 `useEffect` 订阅 `learner/navigate`，按 action.type 分派：
   - `open-book` → `openBook(libraryItemId)`（:349）。
   - `jump` → `handleJumpToDoc(documentId, anchor, "stats")`。
   - `review` → `changeView({ name: "review", scopeKpIds, title })`。
   - `extract-session` → `changeView({ name: "extractSession", bookItemIds, title })`。
4. `copy-query` 与 `dialog` 在面板内部处理，不走 App。

### 11.4 面板与对话框规格

**NextStepsPanel（下一步）** —— 放在数据页最上方（不是 WidgetDef，不进布局编辑）。插入位置：`src/App.tsx:582` 现为 `mainContent = <Dashboard />;`，改为 `mainContent = <><NextStepsPanel /><Dashboard /></>;`——这样数据统计加载失败或骨架屏时面板也照常显示，且不改 `Dashboard.tsx`。面板外层用与 Dashboard 相同的页面左右留白（读 `Dashboard.tsx:273` 的 `<section className="dashboard dash-page">` 所用 class 的 padding，给面板外层加同样的 class 或等值样式）。`app.learner.enabled === false` 时不渲染。
- 标题行：左「下一步」，右侧小字「{生成时间 HH:mm} · 从 {candidateCount} 个候选中选出」+「刷新」文字按钮 +「学习轨道…」文字按钮。
- 标题行右侧另有一个小号下拉「{N} 条」（选项 3–10，当前值 = `recCount`），改动即 `learnerSettings.write({ recCount })` 并重新请求推荐。与设置页的「推荐条数」是同一个值。
- **母语确认（首行，优先于下一条提示）**：`nativeConfirmed === false` 时，标题下一行显示「你的母语是 {语言名列表} 吗？」+「是」（写 `nativeLangs = 当前生效值, nativeConfirmed = true`）+「更改…」（打开 TracksDialog 并滚动到「我的母语」）。生效值为空时文案改为「请先设置你的母语，以便区分哪些是外语材料。」+「设置…」。
- `usingProposals` 为 true 时标题下一行提示：「这些推荐基于从书架推断的学习轨道。」+「确认轨道」按钮（打开 TracksDialog）。
- 列表：每项一行，左侧小号大写标签（kind 中文名 + 轨道名，如「继续读 · 日语」），主体两行：第一行标题（粗）、第二行理由（次要色）；右侧主按钮（文案：继续读→「继续」、开始读→「开始」、处理摘录→「去处理」、摘录制卡→「打开原文」、巩固→「复习」或「重读原文」、换个讲法→「去看看」、自我解释→「写一写」、练习→「去练习」、缺少材料→「复制搜索词」、重读→「重读」、语境串→「读一读」、挖句子→「挑句子」、词汇快测→「开始」）+「⋯」菜单（稍后、不用了、不感兴趣、太难 / 太简单（仅 K1/K2/K10））。
- 点主按钮：先 `learner:feedback(action:'opened')`，再执行动作。菜单项点击后该行立即从列表移除（本地），并写反馈。
- 加载中：首次索引时显示「正在建立学习索引…（{phase} {done}/{total}）」，每 1 秒轮询 `learner:status`。
- 面板订阅 `settings/changed`（key 为 `learner` 时）：重新 `learnerSettings.read()`；`enabled` 变 false 时立即卸载自身（返回 null），变 true 时重新请求推荐。
- 所有显示用户文本（书名、单元标题、句子、摘录片段）的元素加 `dir="auto"`；所有界面文字取自 `src/lib/learnerStrings.ts`（§11.9）。
- 空列表：「暂时没有推荐。去书架添加材料，或在阅读中摘录、制卡。」
- 错误：显示 `error` 文字 +「重试」。不弹窗。

**TracksDialog（学习轨道）**
- 上：「我的轨道」列表。每行：名称（可改）、mode 下拉（5 个中文名）、language 显示语言 / 其他显示 UDC 叶子多选、状态（进行中 / 暂停）、置顶开关、优先级 1–5、删除。
- 中：「建议的轨道」（proposals）每条一个「采纳」按钮（采纳 = saveTrack，source='proposal'）。
- 下：「未归类的材料」每本书一个「归入…」下拉（选轨道即 `setTrackMaterial member=1`）。
- 每个轨道可展开看归属材料，每本后有「移出」（member=0）。
- 底部：「我的母语」多选（控件见 §11.6；保存时同时写 `nativeConfirmed = true`），「重建学习索引」按钮（调用 `learner:rebuild`）。

**SelfExplainDialog**：提示语（§8.2 K7 模板）+ 多行输入（自动增高，参考 `src/lib/autoGrow.ts`）+ 三个自评按钮「讲清楚了 / 部分清楚 / 卡住了」→ 写 `self_explain` 事件 → 关闭并把该推荐标 done。旁边「对照原文」链接 → `jump` 到该 KP 第一张有来源的卡的原文。

**UnitReaderDialog**：大号纯文本阅读区（行宽 ≤ 40em），`learningSpans` 用下划线标出；底部「读完了」→ `unit_reread` 事件；「在阅读器中打开」→ jump。

**ContextReelDialog**：标题为该词；3–5 个句子卡片，句中目标词加粗，每句下方小字材料名 +「原文」链接；底部「都读懂了」（reel_done clear）/「还不太懂」（reel_done unclear）。

**SentenceMineDialog**：最多 10 行，每行：句子（目标词加粗）、材料名；按钮「打开原文制卡」（jump 到 `anchorText = 句子前 40 字`，用户在阅读器里选词用现有查词制卡 / Ctrl+Z）、「这个词我认识」（lexeme_mark mark=known, via=mine）、「这个词不认识」（lexeme_mark mark=unknown, via=mine——该词进入 learning，之后会出现在语境串与重读推荐里）、「跳过」（仅本地隐藏）。

**PlacementDialog（词汇快测）**
- 主进程 `learner:placementSample`：该语言非停用词项按 `total_count` 降序得到排名；频段 `[1,250] [251,500] [501,1000] [1001,2000] [2001,4000] [4001,8000]`（超出词项总数的频段丢弃）；每段确定性抽 10 个：种子 = `sha1(lang + 频段起点)`，用种子对候选 key 做 `sha1(seed + key)` 排序取前 10。
- 界面：每频段一行 10 个词（显示 sample），点选「认识」的词；每行有「全认识」「全不认识」。
- 提交：`ratio_b = 该段点选数 / 该段展示数`；`knownKeys` = 点选的 key；`extrapolatedKeys` = 所有 `ratio_b ≥ 0.9` 的频段里**全部**词项 key（未展示的也算），总数上限 8000；写 `placement` 事件。

### 11.5 查词埋点（L3 批）

在 `src/lib/useSelectionActions.ts` 查词成功、`setDictPanel` 显示结果之后（:1491 附近两处分支各一次），若当前在阅读器中（有材料 id）且 `result.entry` 非空，调用：
先判断总开关：`if (!(await learnerSettings.read()).enabled) return;`（§11.8；放在埋点代码块内部、不要阻塞查词结果显示——整个埋点包在一个不 await 的 async IIFE 里）。然后：
```ts
void learnerApi.logEvent({ kind: "dict_lookup", lang: 实际查词语言, libraryItemId: 当前材料 id,
  payload: { text: raw.slice(0, 64), sentence: (reading.sentence || "").slice(0, 400),
             offset: Math.max(0, (reading.sentence || "").indexOf(raw)) } });
```
「实际查词语言」与「当前材料 id」的取法：执行前读该函数上下文，找到已有变量（`langOpts` 里有 `bookLanguage`，阅读上下文里有材料 id）；找不到现成变量就 BLOCKED，不要自己加新的上下文传递链。埋点失败静默，不影响查词。

### 11.6 设置键（`app` 层的**单个对象键** `learner`，登记 §7.4，闸门 f18）

存储形态照 `app.extracts` 先例（`src/lib/sessionQueue.ts:146-159` 的 `extractSettings`）：`settings.app.learner = { enabled, nativeLangs, recCount }`。

| 字段 | 默认 | 合法值 | 说明 |
|---|---|---|---|
| `enabled` | `true` | boolean | **学习者知识模型总开关**，语义见 §11.8 |
| `nativeLangs` | **字段缺省**（= 用户尚未确认） | ISO 639-1 主子标签数组，去重，1–8 个 | 母语 / 已精通的语言，决定哪些语言算「外语」。缺省时的生效值见下 |
| `nativeConfirmed` | `false` | boolean | 用户是否已确认过母语（§11.4 面板首行提示用） |
| `recCount` | `6` | 整数 3–10 | 推荐条数，用户可在设置页与面板标题行两处调整（同一个值） |

- **母语的生效值（全球用户，不得写死任何语言）**：`nativeLangs` 合法且非空 → 用它；否则 → `[baseLang(系统区域)]`，系统区域在主进程取 `app.getLocale()`，在渲染层取 `navigator.language`（两者在 Electron 中一致）；取不到或得到空串 → `[]`（此时没有任何语言被视为外语之外的「母语」，所有有语言的材料都会被提议为 language 轨道，面板首行会要求用户设置母语）。
- **渲染层**：在 `src/lib/learner.ts` 里写 `learnerSettings = { read(), write(patch) }`，结构照抄 `extractSettings.read/write`（`settingsStore.get("app","learner",{})` / `settingsStore.set("app","learner",{...旧, ...patch})`），`read()` 里做合法化（非法值回默认，`recCount` 取整后夹到 3..10，`nativeLangs` 每项过 `baseLang` 后去重、只保留 `/^[a-z]{2,3}$/`）并返回母语生效值 `effectiveNativeLangs`。写入后 `eventBus.emit("settings/changed", { scope: "app", key: "learner" })`（写法同 `src/App.tsx:264-276`）。
- **主进程**：`learnerRefresh.js` 用 `require("./settingsStore").readSettings().app?.learner`（写法同 `db.js:3073` 读 `app.extracts`），做同样的合法化与生效值计算。**每次 IPC 调用都重新读一次**（文件很小，`getActiveEngine` 已是同样做法），这样开关切换立即生效，不需要通知机制。**不改** `main.js` 的 `settings:set`。
- **母语选择控件**：多选标签列表。候选语言 = 常量 `NATIVE_LANG_CHOICES`（放 `src/lib/learner.ts`）：`en zh es hi ar pt bn ru ja de fr ko it tr vi pl uk nl th id ms fa he el cs sv ro hu da fi no sk bg hr sr lt lv et sl ca sw tl ta te ur mr`，显示名用 `new Intl.DisplayNames([uiLocale], { type: "language" }).of(code)`，按显示名排序；列表末尾一个「其他语言代码」输入框（输入 2–3 个字母的 ISO 代码，回车添加）。
- **设置页位置**：不新增导航项（D114 规定「13 个导航项与 13 个区块一一对应」，加导航项会影响相关测试）。在 `src/components/SettingsPanel.tsx` 的「统计仪表盘」区块 `<SettingsSection id="sec-widgets">`（:181）的子元素末尾，追加 `<div id="sec-learner">…</div>` 子块（写法照 `sec-schedule` 里的 `<div id="sec-learningday">` 子块，:570）。子块内容：
  1. `<h4>学习者知识模型</h4>`
  2. 总开关一行：标签「启用学习者知识模型」+ 说明气泡（`SettingsInfo`）「根据你的阅读、摘录、制卡与复习记录估计掌握水平，并在数据页给出「下一步」建议。全部在本机计算，不联网、不调用 AI。关闭后停止计算与记录，已有数据保留，重新开启即恢复。」+ `seg-tabs` 开/关（写法照 :872-876）。
  3. **仅当开启时**显示其余项：「我的母语」（上面的多选控件）、「推荐条数」（3–10 的数字输入框）、「管理学习轨道…」按钮（打开 TracksDialog）、「重建学习索引」按钮（`learner:rebuild`）。

### 11.7 知识点页显示等级（L6 批）

`src/components/KnowledgeManager.tsx` 的 KP 列表每行加一个等级小标签（§6.6 中文标签），数据来自 `learner:kpLevels`。点开 KP 详情时显示 `metrics` 的人话版：「{n} 张卡已复习，平均回忆率 {meanR}%，{stableRatio}% 已稳定；{有/无}应用题或自我解释」。总开关关闭时（`learner:kpLevels` 返回 `disabled`）不显示等级标签与这段说明，知识点页其余功能不变。

### 11.8 总开关：学习者知识模型可整体开启 / 关闭（用户 2026-10-10 要求）

**默认开启**（全部本地计算、零网络、零 AI，没有隐私与费用顾虑）。开关是 `settings.app.learner.enabled`，「关闭」的含义是**整个功能停止工作，但不删除任何数据**：

| 触点 | 开启 | 关闭 |
|---|---|---|
| 主进程 IPC `learner:*` | 正常工作 | **除 `learner:status` 外**，所有 handler 第一行检查开关，关闭时立即返回 `{ ok: false, disabled: true }`，不读写任何库、不启动刷新 |
| `learner:status` | 返回 §9.1 status，另加 `enabled: true` | 返回 `{ enabled: false }` |
| 启动后 20 秒自动刷新（§9.1） | 执行 | 不执行（定时器回调里再查一次开关） |
| 正在进行的刷新 | — | 刷新每一步开始前检查开关，关闭则在当前步骤结束后停止（已完成部分照常 `learnerDb.save()`），status.phase 置 `"stopped"` |
| 查词埋点（§11.5） | 记录 `dict_lookup` | **不记录**（渲染层调用前用 `learnerSettings.read()` 判断；主进程 `learner:logEvent` 同时拒绝，双保险） |
| 数据页「下一步」面板 | 显示 | **不渲染**（不留空白、不占位） |
| 知识点页等级标签（§11.7） | 显示 | 不显示 |
| 摘录 AI 引擎的知识点就绪度因子（§9.5） | 生效 | **不生效**：`computeSessionQueue` 只在 `readSettings().app?.learner?.enabled !== false` 时使用 `kpFactorMap`，否则一律因子 1（即 E1 原行为）；设置页 `SettingsPanel.tsx:898` 的说明文字随开关显示「已接入」或「未启用（学习者知识模型已关闭）」 |
| 设置页子块 | 显示全部选项 | 只显示总开关与说明 |
| 已有数据（`learner_tracks / track_materials / learning_events / rec_runs / rec_feedback`、`learner.db`） | — | **全部保留不动**；备份照常包含主库这 5 张表 |

**重新开启**：不需要任何迁移。下一次打开数据页时 `learner:recommend` 发现距上次刷新已超过 10 分钟（或从未刷新），按 §7.1 的「首次索引」路径在后台增量刷新，面板显示「正在更新学习索引…」，完成后出推荐。所有派生状态都从事实表重算（§2.2-5），关闭期间的阅读、制卡、复习记录本来就由主功能写入，不会丢；**唯一的缺口是关闭期间的查词不被记录**——设置页说明气泡里已写明「关闭后停止记录」。

**实现约束**：开关判断写成一个函数，主进程 `learnerEnabled()`（放 `learnerRefresh.js`，导出给 `main.js` 与 `db.js` 调用——`db.js` 不能 require `learnerRefresh.js`，所以 `db.js` 里直接写 `readSettings().app?.learner?.enabled !== false`，与 `learnerEnabled()` 同口径，并加注释互相指向）；渲染层 `learnerSettings.read().enabled`。不要在别处各自发明判断。

### 11.9 多语言准备（软件将面向全球用户发布）

当前软件界面只有中文，全局 i18n（软件语言设置）按 D91 规划在后续批次落地。本功能现在就做到「换语言只换字符串表」：

1. **所有用户可见文字集中在两张字符串表里**，代码中不得出现硬编码的用户可见文字：
   - 主进程（新增文件 `electron/lmStrings.js`，纯常量模块）：推荐种类名、标题模板（§8.2「标题格式」）、理由模板（§8.5）、覆盖带名称、KP 等级名、mode 名。结构 `{ zh: {...}, en: {...} }`，两种语言的键必须完全相同（测试断言）。
   - 渲染层（新增文件 `src/lib/learnerStrings.ts`）：面板、对话框、设置子块里的按钮与提示文字，同样 `{ zh, en }`。
2. **界面语言 `uiLocale`**：写成函数 `learnerLocale()`（主进程与渲染层各一个，同口径）：若设置里将来出现软件语言键则用它；**v1 恒返回 `"zh"`**，与软件其余界面保持一致。全局 i18n 落地时只改这一个函数。
3. 模板函数签名改为 `explain(candidate, strings)`、`titleOf(candidate, strings)`：`strings` 由 `lmStrings[learnerLocale()]` 传入（经 Snapshot 的 `settings.locale` 选择），`lmRecommend.js` 不自己选语言。
4. 语言名一律用 `Intl.DisplayNames([uiLocale], { type: "language" })` 生成，不维护语言名表。
5. 用户文本（书名、句子、摘录）可能是从右到左的文字（阿拉伯语、希伯来语）：显示这些内容的元素加 `dir="auto"`。
6. 推荐理由中的数字直接插入（不做本地化数字格式），保证 §13.4-10 的「理由数字可在 facts 中找到」断言在任何语言下都成立。

---

## 12. 实施批次与任务拆解表

> 每批一个 commit（提交信息以 `D124 Lx:` 开头）。批内任务按顺序做。**每个任务完成后都要跑「验收」列的命令。**
> 执行者：全部为 glm-5.3-flash（`frontend-builder` / `bug-fixer`）；标 ★ 的任务改动核心域（db.js / main.js），完成后必须经 `code-reviewer` 审查（AGENTS.md 标准循环）。

### L0 文档批（只改文档）

| ID | 任务 | 涉及文件 | 验收 | 依赖 |
|---|---|---|---|---|
**L0 写作约束（闸门 f11 会机器检查，违反必红）：**
- 写到**还不存在**的文件路径（如 `electron/lmParams.js`、`tests/lm-*.test.cjs`）时，同一句里必须出现「规划」或「新增」二字（f11 L1）。
- 引用本设计稿的章节一律写成「设计稿 §x.y」，不要裸写 `§11.6` 这类——指导文档没有 §10 以上的章（f11 L2 会判悬空引用）。
- 短语「已被 D124 取代」全文恰好出现 6 次（L0-2 的 6 处），§4.20 摘要和其他地方不要再用这个短语。
- **表数量字样（31 张）在 L0 不改**——代码要到 L2-1 才建表，L0 改数字会让 f11 L6 变红。

| ID | 任务 | 涉及文件 | 验收 | 依赖 |
|---|---|---|---|---|
| L0-1 | 指导文档 bump 到 v48.80；§8.1 决策日志末尾追加 D124 行（内容：设计稿 §2.3 替代关系的一句话概括 + 目标 + 设计稿路径） | `AI_DEVELOPMENT_GUIDE.md` | `grep -n "D124" AI_DEVELOPMENT_GUIDE.md` 至少 2 处 | — |
| L0-2 | 新增 §4.20「学习者模型 LM-1（D124）」：只写 10 行以内的摘要 + 指向设计稿；在 §4.7、§4.8、§4.9、§4.11、§4.14、§6.4.1 每节标题下加一行引用块「> **已被 D124 取代**（见 §4.20 与设计稿 `docs/design/LEARNER-MODEL-REDESIGN-D124.md`），本节保留作历史」。**不删除旧正文，不改任何 § 编号** | 同上 | `grep -c "已被 D124 取代" AI_DEVELOPMENT_GUIDE.md` = 6 | L0-1 |
| L0-3 | §4.1：在表清单后加一段「D124 规划新增 5 张主库表（`learner_tracks / track_materials / learning_events / rec_runs / rec_feedback`，L2-1 落地后再计入实建数）」，另加一段说明规划新增的派生库 `learner.db`（写法仿 dictionary.db） | 同上 | 闸门见下 | L0-2 |
| L0-4 | §7.2 例外登记：① `learner.db` 写入走 `learnerDb.save()` 不走 `persist()`；② `rec_runs` 保留最近 300 行，超出物理删除（理由：展示快照的审计价值随时间递减 + 主库全量回写约束） | 同上 | 同上 | L0-3 |
| L0-5 | §7.4 登记设置键 `app.learner`（对象，字段 enabled / nativeLangs / nativeConfirmed / recCount，见设计稿 §11.6；enabled 是学习者知识模型总开关，见设计稿 §11.8） | 同上 | 同上 | L0-3 |
| L0-6 | §9.1 新增小节，**标题必须写成** `### 学习者模型与下一步推荐（M17，D124）`（不要以 `M17` 开头——f24 R4 用 `/###?\s*M(\d{1,2})\b/` 抓里程碑，M17 若被抓到会成为「无人点名的新里程碑」而变红），正文列 L0–L6；§9.2 主线状态表加一行「学习者模型 M17 · 📐 设计定稿」（同样不要让单元格以 `M17` 开头）；K0–K9 行状态后追加「K3–K9 已被 D124/M17 取代」 | 同上 | 同上 | L0-5 |
| L0-7 | 删除重复的旧版 §6.3.11 与 §6.3.12：**删除范围＝指导文档中第二次出现的那两节**（标题以「（v24 规范，K2 起按需播种）」结尾、不含 v33 字样，约在 759–777 行，到 `#### 不变量与验收检查（AI 制卡与助读）` 之前为止）；保留第一次出现的两节 | 同上 | `grep -c '^### 6.3.11' AI_DEVELOPMENT_GUIDE.md` = 1 且 `grep -c '^### 6.3.12' AI_DEVELOPMENT_GUIDE.md` = 1 | L0-6 |
| — | **本批闸门**：先 `git worktree add /tmp/base HEAD` 做基线。沙箱：在当前目录和 `/tmp/base` 各跑 `node tests/flows/f11-doc-code-drift.cjs`、`f21-ipc-bridge.cjs`、`f24-coverage-audit.cjs`、`f27-restraint-redlines.cjs`、`f45-feature-blindspots.cjs`（注意：若闸门脚本里写死了项目根路径 `ROOT`，跑基线时要让它指向 `/tmp/base`，做不到就只在当前目录跑并与 main 上已知失败项比对）。主机（用户）：`npx electron tests/flows/f18-settings-matrix.cjs`、`f20-command-contract.cjs`。**本批不得新增失败项** | — | 失败项集合 ⊆ 基线失败项集合 | — |

### L1 纯函数核心（全部 node 可测）

| ID | 任务 | 涉及文件 | 验收 | 依赖 |
|---|---|---|---|---|
| L1-1 | 照抄 §10 建参数文件 | `electron/lmParams.js` | `node -e "require('./electron/lmParams.js')"` 无错 | L0 |
| L1-2 | `markdownToPlain` / `segmentMarkdown` / `segmentPages` / `splitSentences`（`Intl.Segmenter` granularity sentence，退化用 `/[^。！？.!?\n]+[。！？.!?]?/g`）/ `detectLang` | `electron/lmText.js`、`tests/lm-text.test.cjs` | `node tests/lm-text.test.cjs` 全绿（用例见 §13.1） | L1-1 |
| L1-3 | `baseLang` / `LANG_PROFILE` / `tokenize` / `porterStem` / `IRREGULAR` / `lexemeKey` / `STOPWORDS` / `unitCoverage` / `bandOf` / `isIPlusOneSentence` | `electron/lmLex.js`、`tests/lm-lex.test.cjs` | 同上（§13.2） | L1-1 |
| L1-4 | `retrievability` / `computeKpLevel` / `computeLexState` / `computePasses` | `electron/lmLevels.js`、`tests/lm-levels.test.cjs` | 同上（§13.3） | L1-1 |
| L1-5 | `electron/lmStrings.js`（§11.9，zh 与 en 两套，键相同）+ `proposeTracks` / `resolveMembership` / `trackWeights` / 13 个生成器 / `score` / `select` / `titleOf` / `explain` / `recommend` | `electron/lmStrings.js`、`electron/lmRecommend.js`、`tests/lm-recommend.test.cjs` | 同上（§13.4） | L1-2..4 |

### L2 存储与刷新管线

| ID | 任务 | 涉及文件 | 验收 | 依赖 |
|---|---|---|---|---|
| L2-1 ★ | 主库 5 张表建表语句（§5.1）；**同一任务内**改指导文档的「当前实建表数」：`grep -n "31 张" AI_DEVELOPMENT_GUIDE.md` 找到的行里，**只改描述现状的三处**（2026-10-10 时约在第 95 行「31 张表」、第 133 行 §4.1 标题「当前实建 31 张」、第 138 行「表逐一点名」段——这段还要把 5 张新表名补进点名清单），改为 36；**§8.1 决策日志里历史行（如 D121 行）中的数字不改**。再把 L0-3 写的「规划新增」改为「v48.80 新增」 | `electron/db.js`、`AI_DEVELOPMENT_GUIDE.md` | `grep -c "CREATE TABLE IF NOT EXISTS" electron/db.js` = 36；`node tests/flows/f11-doc-code-drift.cjs` 不新增失败；`tests/lm-db.test.cjs`（@runtime electron，用户主机跑）建表断言 | L1 |
| L2-2 ★ | `db.js` 新增并导出：`learnerFacts()`、`resolveCardKpMap()`、`listLearnerTracks / saveLearnerTrack / deleteLearnerTrack / setTrackMaterial`、`addLearningEvent`（含 §5.3 校验）、`addRecFeedback`、`saveRecRun`（含 300 行裁剪）、`latestRecRun` | `electron/db.js` | 同上 + `npx tsc --noEmit -p .` | L2-1 |
| L2-3 | 独立库（§5.2） | `electron/learnerDb.js` | lm-db 测试：打开 / 建表 / 保存 / reset / schema 版本不符时重建 | L1 |
| L2-4 | 刷新管线六步 + 单飞 + status + buildSnapshot（§9） | `electron/learnerRefresh.js` | lm-db 测试：造 2 本书（1 本英文、1 本中文）+ 阅读事件 + 卡片 + 复习日志 → refresh 后 `content_units / unit_progress / kp_states / lexeme_states` 行数与 §13.5 期望一致 | L2-2, L2-3 |
| L2-5 ★ | **同一任务内完成三件事**（分开做会让 f21「死通道」闸门中途变红）：① `main.js` 注册 §11.1 全部 16 个 IPC（每个 `ipcMain.handle("learner:…"` 单独一行；除 `learner:status` 外每个 handler 第一行 `if (!learnerEnabled()) return { ok: false, disabled: true };`，§11.8）+ 启动后 20 秒自动刷新 + `extractPdfPages` 注入；② `preload.js` 暴露 `learnerAPI`（每个 `ipcRenderer.invoke("learner:…"` 单独一行）；③ 在 `tests/lm-db.test.cjs` 里加「通道清单」断言（见 §13.5 最后一条，f45 S2 要求每个通道名在 tests/ 中以完整字符串出现） | `electron/main.js`、`electron/preload.js`、`tests/lm-db.test.cjs` | `grep -c 'ipcMain.handle("learner:' electron/main.js` = 16；`grep -c 'invoke("learner:' electron/preload.js` = 16；`node tests/flows/f21-ipc-bridge.cjs` 与 `node tests/flows/f45-feature-blindspots.cjs` 不新增失败 | L2-4 |

### L3 事件埋点与推荐接口

| ID | 任务 | 涉及文件 | 验收 | 依赖 |
|---|---|---|---|---|
| L3-1 | 渲染层类型与 API 封装 + `learnerSettings`（含母语生效值，§11.6）+ `NATIVE_LANG_CHOICES` + 界面字符串表（§11.9） | `src/lib/learner.ts`、`src/lib/learnerStrings.ts` | `npx tsc --noEmit -p .` | L2-5 |
| L3-2 | 查词埋点（§11.5，含总开关判断） | `src/lib/useSelectionActions.ts` | tsc；主机手测：阅读英文书查 3 个词 → `learning_events` 有 3 行 `dict_lookup`；关闭总开关后再查 → 不新增行 | L3-1 |
| L3-3 | eventbus 两个事件名 + App 导航（§11.3） | `src/lib/eventbus.ts`、`src/App.tsx` | tsc；主机手测 4 种 action 都能跳转、返回键回到数据页 | L3-1 |

### L4 下一步面板与轨道管理

| ID | 任务 | 涉及文件 | 验收 | 依赖 |
|---|---|---|---|---|
| L4-1 | NextStepsPanel（§11.4） | `src/components/learner/NextStepsPanel.tsx`、`src/App.tsx`（只改 :582 一行与 import） | tsc；`npm run build`（主机）；手测：有推荐、空态、加载态（首次索引）、错误态、标题行条数下拉改为 3 后只显示 3 条、母语确认行点「是」后消失、设置页关闭总开关后面板立即消失 | L3 |
| L4-2 | TracksDialog（§11.4） | `src/components/learner/TracksDialog.tsx` | 同上；手测：采纳提议、改 mode、归类材料、移出材料后推荐变化 | L4-1 |
| L4-3 | 设置子块（§11.6：总开关 + 母语多选 + 推荐条数 + 两个按钮；关闭时只显示开关） | `src/components/SettingsPanel.tsx` | tsc；f18 闸门（主机）不新增失败；手测 §11.8 表格每一行 | L4-1 |

### L5 语言专用对话框

| ID | 任务 | 涉及文件 | 验收 | 依赖 |
|---|---|---|---|---|
| L5-1 | UnitReaderDialog | `src/components/learner/UnitReaderDialog.tsx` | tsc；手测「读完了」后该单元通读次数 +1 | L4-1 |
| L5-2 | ContextReelDialog + `learner:contextReel` 主进程实现 | 对话框文件、`electron/learnerRefresh.js` | 同上；手测提交后 `reel_done` 事件 | L4-1 |
| L5-3 | SentenceMineDialog + `learner:sentenceMine` | 对话框文件、`electron/learnerRefresh.js` | 手测：每句恰好一个高亮词；「这个词我认识」后该句消失且下次刷新该词为 known | L4-1 |
| L5-4 | PlacementDialog + `learner:placementSample` | 对话框文件、`electron/learnerRefresh.js` | 同一语言两次抽样结果完全相同；提交后已知词数上升 | L4-1 |
| L5-5 | SelfExplainDialog | `src/components/learner/SelfExplainDialog.tsx` | 手测保存后 `self_explain` 事件、该 KP 下次推荐不再出现 K7 | L4-1 |

### L6 衔接

| ID | 任务 | 涉及文件 | 验收 | 依赖 |
|---|---|---|---|---|
| L6-1 ★ | E2：`kpFactorOf` 接入（§9.5 四步） | `electron/aiNextExtract.js`、`electron/db.js`、`electron/learnerRefresh.js`、`src/components/SettingsPanel.tsx`、`tests/ainextextract.test.cjs` | `node tests/ainextextract.test.cjs` 原有用例全绿（不传 opts ⇒ 行为不变）；在同一文件追加 2 条用例：① `kpFactorOf` 恒返回 1 时排序与不传 opts 完全相同；② 两条其他因子相同的摘录，`kpFactorOf` 分别返回 1.3 与 0.85，前者排在前面 | L2 |
| L6-2 | 知识点页等级标签（§11.7，关闭时不显示） | `src/components/KnowledgeManager.tsx` | tsc；手测开 / 关两种状态 | L2 |
| L6-3 | 指导文档 §9.2 M17 状态更新为 ✅（列出完成批次与测试数） | `AI_DEVELOPMENT_GUIDE.md` | L0 批的闸门组 | 全部 |

### L7（远期，不在本次范围，列出供将来参考）
AI 解释理由（复用 `frontier-explain` scope，只重述 facts）；AI 对未归类材料做领域分类；AI 按需出应用题（`knowledge-probe`，用户主动点才生成，不入队）；日语形态分析（kuromoji）提升词项归一；联网找材料（K6）；结构连接（§4.14）。

---

## 13. 测试用例（必须原样实现为断言）

所有 node 测试文件第一行 `// @runtime: node`，第二行 `// 运行：node tests/<文件名>`，只 `require` 被测模块与 `node:assert`、`node:path`，结尾打印 `N passed`。被测模块用 `require(path.join(__dirname, "..", "electron", "lmXxx.js"))` 加载。

### 13.1 `tests/lm-text.test.cjs`
1. `markdownToPlain("# 标题\n**粗**和[链接](http://x)![图](a.png)")` 去掉首尾空白后等于 `"标题\n粗和链接图"`。
2. 合并：`md = "# A\n" + "a".repeat(1000) + "\n# B\n" + "b".repeat(1000) + "\n# C\n" + "c".repeat(4000)` → `segmentMarkdown(md)` 得 2 个单元，标题 `["A","C"]`，第 1 个单元 `mdFrom=0`，第 2 个单元 `mdFrom = md.indexOf("# C")`，最后一个 `mdTo = md.length`。
3. 拆分：`md = "# T\n" + Array.from({length:13}, () => "x".repeat(1000)).join("\n\n")` → 4 个单元，标题 `["T（1/4）","T（2/4）","T（3/4）","T（4/4）"]`。
4. 无标题：`"y".repeat(800)` → 1 个单元，标题 `开篇`。
5. 空章节被删：`"# A\n\n# B\n" + "b".repeat(2000)` → 1 个单元，标题 `B`。
6. `isExercise`：标题「第三章 习题」的单元为 1。
7. `segmentPages(["a".repeat(2000), "b".repeat(2000), "c".repeat(500)])` → 1 个单元 `{pageFrom:0, pageTo:2}`（第 1、2 页累计 4000 ≥ 3000 成块，第 3 页 500 < 1500 并入）。
8. `detectLang`：日文假名文本 → `ja`；纯中文 → `zh`；英文段落 → `en`；法文段落（含 le/la/les/des/est 等）→ `fr`；德文段落 → `de`；西班牙文段落 → `es`；俄文段落 → `ru`；泰文段落 → `th`；阿拉伯文段落 → `ar`；只有 3 个拉丁词的短句 → `''`；`"123"` → `''`。每个段落在测试文件里写一段真实的 200 词以上文本（可用公有领域文学作品开头）。
9. 代码围栏内的 `# 不是标题` 不切分。

### 13.2 `tests/lm-lex.test.cjs`
1. Porter：caresses→caress、ponies→poni、cats→cat、feed→feed、plastered→plaster、motoring→motor、sing→sing、hopping→hop、falling→fall、hissing→hiss、happy→happi、sky→sky、relational→relat、generalization→gener、connection→connect、connected→connect、connecting→connect、connections→connect、today→todai。
2. `lexemeKey("Went","en") === "go"`；`lexemeKey("children","en") === "child"`；`lexemeKey("John's","en") === "john"`。
3. `lexemeKey("ｶﾀｶﾅ","ja") === "カタカナ"`（NFKC）。
4. `tokenize("I met John in Paris. He smiled.","en")`：`John`、`Paris` 的 `proper=true`；`He`（句首）`proper=false`；`I` 不判专名（单字母大写词一律 `proper=false`）。
5. 纯数字被丢弃：`tokenize("in 2024 we","en")` 不含 `2024`。
5a. 德语专名规则关闭：`tokenize("Ich sehe den Hund im Garten.","de")` 中 `Hund`、`Garten` 的 `proper=false`。
5b. 大小写折叠按语言：`lexemeKey("İstanbul","tr") === "istanbul"`；`lexemeKey("Haus","de") === "haus"`；`lexemeKey("Москва","ru") === "москва"`。
5c. 法语省音：`lexemeKey("l'homme","fr") === "homme"`。
5d. `baseLang("zh-TW") === "zh"`、`baseLang("pt_BR") === "pt"`、`baseLang("EN") === "en"`。
5e. 泰文分词：`tokenize("ฉันชอบอ่านหนังสือ","th")` 返回 ≥ 3 个 token（证明无空格文字可切分）。
6. `unitCoverage([[1,8],[2,1],[3,1]], 10, id => id === 1 || id === 2)` → 0.9；`bandOf(0.9)` = `intensive`，`bandOf(0.95)` = `optimal`，`bandOf(0.98)` = `easy`，`bandOf(0.89)` = `hard`；`bandOf(0.95, 0.01)` = `intensive`（偏移后要求 0.96）；`unitCoverage([], 0, () => false)` = 1。
7. `isIPlusOneSentence`：`tokens = tokenize("the cat sat on the mat today","en")`，`isKnownKey = k => k !== lexemeKey("mat","en")` → 返回 `lexemeKey("mat","en")`；`isKnownKey = k => ![lexemeKey("mat","en"), lexemeKey("cat","en")].includes(k)` → null；`tokenize("the cat sat down","en")`（4 个 token）配任意 isKnownKey → null；「the mat sat on the mat today」中 mat 出现两次、只有 mat 未知 → 返回 mat 的 key（同一未知词算 1 个）。

### 13.3 `tests/lm-levels.test.cjs`
1. `retrievability` 三个验算值（§6.3），误差 < 1e-9；`stability=0` → 0。
2. KP 等级：
   - 无卡、无摘录、无通读 → L0。
   - 只有 1 条摘录 → L1。
   - 1 张卡未复习 → L1。
   - 1 张卡已复习 R=0.7 → L2。
   - 2 张卡 R=0.9/0.88、S=30/25 → L3（meanR=0.89 ≥ 0.85，stableRatio=1）。
   - 3 张卡 R 全 0.95、S 全 90、类型 qa/cloze/qa、lapses30 全 0 → L4（n≥3 且 types=2）。
   - 同上但 3 张都是 qa、无应用卡、selfExplainClear90=0 → L3（不满足深度条件）。
   - 同上（全 qa）但 selfExplainClear90=1 → L4。
   - 2 张卡 S=40/40、R=0.6/0.7 → L2 且 fading=1。
   - confidence：3 张卡共 6 次复习、3 个不同日 → high；1 张卡 3 次复习 → medium；1 张卡 1 次 → low。
3. 词项状态：按 §6.7 表每条规则至少 1 个正例 + 「标记后又查词 → 不走规则 1」的反例，共 ≥ 9 条。
4. `computePasses`（以下全部 `docLen = 3000`，事件间隔 1 分钟除非另说）：
   - 单元 `[0,1000) [1000,2000) [2000,3000)`，同一 session 事件 char_pos `0 → 900 → 1500 → 2600` → 单元 0、1 各 1 次通读，单元 2 无。
   - 同上再加 `2950`（≥ 3000×0.97=2910 的末尾判定）→ 单元 2 也 1 次。
   - 事件 `0 → 25000` → 25000 > docLen 被丢弃 → 无通读。
   - 单元同上但 `docLen = 50000`、再加一个单元 `[3000,50000)`，事件 `0 → 25000`（步长 > 20000 视为跳转）→ 无通读。
   - 两个 session（间隔 > 30 分钟）各自 `0 → 1500` → 单元 0 两次通读。
   - 往回翻 `1500 → 200 → 1200` → 第一对是回退被跳过，第二对 `200 → 1200` 让单元 0 记 1 次通读。
   - 同 session 内重复跨过：`0 → 1500 → 200 → 1500` → 单元 0 只记 1 次（同 session 内一个单元至多记一次）。

### 13.4 `tests/lm-recommend.test.cjs`
用手写快照（写成测试内函数 `fixture()`）覆盖：
1. 没有落库轨道，快照含 1 本 `lang='en'` 的书（母语 zh）和 1 本有 5 张卡、`cards.domain` 首元素都是 `"57"` 的中文书 → `usingProposals=true`，提议恰好是 1 个 language（en）与 1 个 concept（udc 57，§3.1 默认 concept）轨道。
2. 轨道权重：两个轨道活跃度 3:1（`__unassigned` 的 activity 为空数组）→ weight 0.75/0.25（误差 < 1e-9）；把第二个设 pinned → max(0.25, 0.3)=0.3，归一化后 0.3/1.05 ≈ 0.2857，断言 ≥ 0.28。
3. `paused` 轨道不出任何推荐。
4. concept 续读：下一单元先修 KP score=0.2 → 不出 K1，改出 K5（该 KP 有卡）。
5. language：下一单元 coverage 0.85 → 不出 K1/K2；coverage 0.96 → 出 K1 且理由含「最适合」。
6. K14：已知词 < 200 且无快测 → 结果第一项是 placement。
7. 多样性：同一 kind 最多 2 个；同一材料最多 2 个。
8. 冷却：最近 1 天有 `snooze` 的 key 不出现；4 天前的 snooze 不影响。
9. not_interested 材料：60 天内该材料不出 K1/K2。
10. 理由无编造数字：对每个结果项，用 `/\d+(\.\d+)?/g` 取出理由里的每个数字串，它必须作为子串出现在 `Object.values(facts).map(String).join(" ")` 里。
11. 确定性：同一快照跑两次结果 `JSON.stringify` 完全相同。
11a. 字符串表：`lmStrings.zh` 与 `lmStrings.en` 的键集合（递归）完全相同；`settings.locale = "en"` 跑同一快照，理由里不含任何汉字（`/\p{Script=Han}/u` 不匹配），且用例 10 仍成立。
11b. 母语：快照 `nativeLangs = ["ja"]`、有一本 `lang='zh'` 和一本 `lang='ja'` 的书 → 提议 zh 的 language 轨道、不提议 ja；`nativeLangs = []` → 两本都提议。
12. 自动完成：lastRun 中 continue 项的目标单元在展示后有通读 → `recommend` 返回的 `autoDone` 列表包含其 key（由调用方写 rec_feedback）。

### 13.5 `tests/lm-db.test.cjs`（@runtime electron，用户主机跑）
仿 `tests/k1.test.cjs` 的隔离写法（临时 userData；文件头第二行 `// 运行：npx electron tests/lm-db.test.cjs`）。造数据：英文书 E（3 个 `#` 章节各约 2000 字符的英文，`lang='en'`）、中文书 Z（2 章各 2000 字）、Z 上 2 张卡链接到同一 KP、各 3 次复习、E 上阅读事件 `0 → 1800 → 4500`（同 session，间隔 1 分钟）。断言：
- E 有 3 个单元、Z 有 2 个单元。
- E 单元 0、单元 1 各通读 1 次，单元 2 通读 0 次（每章约 2013 字符，4500 跨过前两个单元的 md_to、未达 docLen×0.97）。测试里先读出 `content_units` 的 md_to 确认 `md_to[1] <= 4500 < docLen × 0.97`，前提不成立就让测试失败并打印实际值。
- `kp_states` 有该 KP 一行，level ≥ 2。
- 设置 `app.learner.nativeLangs = ["zh"]` → 自动提议 1 个 en language 轨道；`lexemes` 只含 en（中文书不建词项）。再改为 `["en"]` 并 refresh → 改为提议 zh 轨道、不再提议 en（验证母语不是写死的）。
- `learner:logEvent` 非法 kind 返回 `{ok:false}` 且不写库。
- `rec_runs` 写 301 次后表内 300 行。
- 刷新过程中未调用 `persist()` 写 cards / review_logs（断言这两张表行数与 `updated_at` 不变）。
- 删除 `learner.db` 后 refresh，单元数与 KP 状态和删除前完全一致（可重建）。
- **总开关**：把 `app.learner.enabled` 设为 false（写测试临时 userData 的 settings.json）后：`learner:recommend`、`learner:logEvent`、`learner:refresh` 都返回 `{ok:false, disabled:true}`，`learning_events` 与 `rec_runs` 行数不变，`learner.db` 的修改时间不变；`learner:status` 返回 `{enabled:false}`；先 `setKpFactorMap(new Map([[某摘录id, 1.3]]))` 再算 `computeSessionQueue`，结果顺序与 `setKpFactorMap(null)` 时相同。改回 true 后 `learner:recommend` 正常返回。
- `setTrackMaterial` 先设 member=1、再设 null、再设 1，不报 UNIQUE 错，最终该对有效（is_deleted=0, member=1）。
- **通道清单**：测试里写一个字符串数组，16 个元素逐字列出全部通道名（`"learner:status"`、`"learner:refresh"`、`"learner:recommend"`、`"learner:feedback"`、`"learner:listTracks"`、`"learner:saveTrack"`、`"learner:deleteTrack"`、`"learner:setTrackMaterial"`、`"learner:kpLevels"`、`"learner:logEvent"`、`"learner:unitText"`、`"learner:contextReel"`、`"learner:sentenceMine"`、`"learner:placementSample"`、`"learner:lexStats"`、`"learner:rebuild"`）；读 `electron/main.js` 断言每个都有 `ipcMain.handle("<名>"`，读 `electron/preload.js` 断言每个都有 `invoke("<名>"`。（这一条也满足闸门 f45 S2「每个通道名在 tests/ 里以完整字符串出现」。）

---

## 14. 不变量与审查清单（code-reviewer 逐条打勾）

1. 学习者模型代码中不存在对 `cards`、`review_logs`、`extracts`、`knowledge_*` 的 `INSERT / UPDATE / DELETE`（`grep -nE "UPDATE (cards|review_logs|extracts|knowledge_)|INSERT INTO (cards|review_logs|extracts|knowledge_)|DELETE FROM (cards|review_logs|extracts|knowledge_)" electron/learner*.js electron/lm*.js` 为空）。
2. `electron/lm*.js` 五个文件的 `require` 只指向 `node:crypto` 与同目录 `./lm*`（及按 §0.1-10 允许的 `./kpNorm`）：`grep -n "require(" electron/lm*.js` 逐行核对。
3. 复习评分（`review:*` / 对应 IPC）、摘录推进、制卡的处理函数里没有 `learner` 字样。
4. 所有推荐理由数字来自 facts（测试 13.4-10）。
5. 同一快照推荐结果确定（测试 13.4-11）。
6. 删除 `learner.db` 可完整重建（测试 13.5）。
7. 新 IPC 通道名全部 `learner:` 开头。
8. 新设置键已登记 §7.4，f18 无新增失败。
9. 没有新增 npm 依赖（`git diff package.json` 为空）。
10. v1 无 AI 调用（新文件里没有 `chat` / `chatStream` / `callAI` / `mindmapChat`）。
11. 总开关：`grep -n 'ipcMain.handle("learner:' electron/main.js` 的每个 handler（`learner:status` 除外）首行都是开关检查；§11.8 表格每一行有对应实现。
12. 不写死语言：新代码里没有 `"zh"` 作为母语 / 界面语言的默认值（`learnerLocale()` 的 v1 返回值除外）；用户可见文字全部来自 `lmStrings` / `learnerStrings`（抽查组件里没有中文字面量）。

---

## 15. 已确认的决策（用户 2026-10-10）

| # | 问题 | 决定 |
|---|---|---|
| Q1 | 母语 | 软件面向全球发布，用户母语各不相同：**不写死任何语言**。母语默认取系统区域的语言，面板首次提示用户确认，用户可多选修改（§11.6、§11.4）；分词、语言识别、专名与大小写规则全部按语言能力表处理任意语言（§6.2）；界面文字集中到字符串表，为全局 i18n 做准备（§11.9） |
| Q2 | 查词制卡的默认卡型是否改 | **不改**。这与本功能的实现没有依赖关系：学习者模型只读取已有的词汇卡（`cards.dict_json`）来判断词的状态，卡型如何都能工作。当初提出只是因为「孤立的 词→释义 卡」偏向背单词，与母语式习得理念有张力；但是否制卡、制什么卡由用户决定，推荐层本身也不会推「背单词」类动作 |
| Q3 | 「下一步」面板位置 | 数据页（统计页）顶部（§11.4） |
| Q4 | 推荐条数 | 默认 6，用户可在设置页与面板标题行调节，范围 3–10（§11.6、§11.4） |
| Q5 | 整体开关 | 学习者知识模型整体可开启 / 关闭，默认开启；关闭即全部入口停止工作、数据保留，重新开启自动恢复（§11.8） |

---

## 附录 A：为什么不沿用旧路线（给后来者的一段话）

旧设计的方向（三层分离、状态可重算、AI 非事实源）是对的，问题出在**把「掌握度估计」当成第一性问题**，堆出了需要大量数据才能校准的概率模型，又为了给模型喂证据去发明强制探针。本设计把问题倒过来：**先问用户下一步能做什么，再问需要知道多少掌握情况才能把这些事排好序。** 答案是：KP 的五级离散状态 + 内容单元的通读与覆盖率，已经足够；而这些全都能从现有数据确定性算出，今天就能做，今天就能测。将来数据多了，要上概率模型，也只是替换 `computeKpLevel` 这一个纯函数，管线与推荐都不用动。
