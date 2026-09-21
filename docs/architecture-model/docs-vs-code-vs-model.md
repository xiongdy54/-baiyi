# 指南 / 既有图 / 代码 / 本模型 · 差异对照

回答"这份模型跟已有文档有什么不一样"。四方可复算，全部标注了实测方式；**结论是补集而非取代**，作废既有产物没有任何依据。

生成 2026-09-21 @ `780ea84`。方法：读码 + `grep`/`sed` 直接计数，行号经人工复核。

---

## 1. 可复算的数字漂移（文档 ↔ 代码）

| 项 | 指南原文 | 既有图 | 代码实测 | 复算方式 |
| --- | --- | --- | --- | --- |
| IPC 通道数 | `AI_DEVELOPMENT_GUIDE.md:55`「IPC 注册（**50+ 通道**）」 | 无 | **159** 个 `ipcMain.handle`，**24** 个通道前缀 | `grep -rn "ipcMain.handle(" electron/ \| wc -l` |
| `library.db` 表数 | `:56`「sql.js 仓储层：**17 张表**」（§3 与 §4.1 两处口径互不相同） | 无 | **27** | `grep -o "CREATE TABLE IF NOT EXISTS [a-z_]*" electron/db.js \| sort -u \| wc -l` |
| 主进程文件清单 | §3 结构块（`:53-66`）列出 **10** 个 `.js`：main / db / ai / optimizer / prompts / quickCapture / journalTime / fsrsTime / preload / preload-capture | 无 | `electron/` 实有 **24** 个 `.js`（`ls electron/*.js \| wc -l`） | 两份清单做差集 |
| §3 未列入、但代码里已承载真实职责的 14 个模块 | —— | —— | `mindmapEngine` `mindmapCore` `kpNorm` `kpScopes` `fsrsConfig` `memoryStore` `memoryTidy` `memoryRetrieve` `dictDb` `dictStore` `importers` `backup` `settingsStore` `udc` | `sed -n '53,66p' … \| grep -oE "[a-zA-Z-]+\.js"` 与 `ls electron/*.js` 比对 |
| 图自身的新鲜度 | —— | 页脚自述「文档 **v43**」（`01`）、`v42`、`v41`（`04`、`index.html`） | 当前指南 **v48.14**（`:1`） | `grep -o "文档 v[0-9]*" docs/diagrams/*.html` |
| 图对 `memory/` 第二真源的覆盖 | §4.18 有专节 | `01` 命中 **1** 次，其余四图 **0 次** | `electron/memoryStore.js` 已落地并写进备份成员 | `grep -c "memory" docs/diagrams/*.html` |
| M15 导图子系统 | §4.19 + D45–D49 | **五图均未画** | `mindmapEngine.js` 3133 行 + 4 张表 + 13 个 `mindmap:*` 通道已落地 | 同上 |

> §3 的 `db.js` 行注记「17 张表（含 v36 journal_entries、v40 K 系列 6 表）」说明该数字自 v40 起就没再更新过；v48.11 加 `material_map_calls`、v48.12 加测量列，都没回填。

## 2. 只有本模型登记、既有文档没有的结构性事实

| 事实 | 为什么重要 | 证据 |
| --- | --- | --- |
| **`prompt-lab/` 是第二个可独立运行的 Electron 程序**（独立 `package.json`/`main.js`/`preload.js`，根目录 `.bat` 启动，独立 `%APPDATA%/prompt-lab`，9 个 `lab:*` 通道，对 `library.db` 零引用） | 它的 `lab:prompts:save` 改的是提示词草稿，**测试台与主软件不共享 AI 配置**（Key 要另配一次）。只看 §3 结构清单会完全漏掉这个部署单元 | `prompt-lab/package.json`、`main.js:8,46,97-184` |
| **`kpScopes.js` 生产侧零 require** | "AI 输出都过确定性契约"这句不变量**只对卡片与归一成立，对出层 schema 校验尚未接入主进程**。真实消费方是测试台与测试（经手跑 esbuild 产物） | `grep require("./kpScopes") electron/` 无命中；`db.js:1709` 注释"本批只定契约"；`prompt-lab/package.json:10` |
| **`require` 扇入方向与直觉相反** | `db.js` 只被 `main.js` 一个文件引用，却**吸入 7 个叶子**（prompts/kpNorm/settingsStore/udc/fsrsConfig/fsrsTime/journalTime）。"改 db.js 会牵全身"在依赖图上不成立；真正高扇入的是 `ai.js`（main + 导图引擎）。见 §1.1 全表 | `evidence.md` §1.1 |
| **`capSvc` 的 db 是注入的 `ctx`，不走 require** | 按 require 图估快速捕捉的影响面会**偏小**；它是全仓唯一走构造注入的写路径 | `quickCapture.js:89` 注释 `{ db, readSettings, writeSettings, sendToMain }`、`:342,351,359` |
| **持久化节流是显式破例**：`deferPersist` + `flushJournalPersist` | 只有日记草稿路径能跳过"每次写=整个库落盘"。不知道这条，就会把捕捉窗写成卡死的性能问题 | `quickCapture.js:9-11,19-20,342,351` |
| **`bookasset:` / `pdfres:` 两条自定义 scheme 必须在 app ready 前注册** | 这不是风格问题：晚注册会让封面 `<img>` 永久失败（img 不自动重试）、pdf 字形变白轮廓 + 重试风暴 | `main.js:91-96`（含动因注释）、`:1265-1266` |
| **主动推送是同一个五份副本** | `fsrs:configChanged`/`journal:changed`/`insight:changed`/`memory:changed`/`mindmap:changed` 各有一份 `getAllWindows()` 遍历，其中只有 journal 那份带 `excludeWebContents` 防回环 | `main.js:446-450,959-962,1045-1047,1136-1139` vs `quickCapture.js:310-316` |
| **`electron/mindmapCore.d.ts:1` 宣称"渲染层导入用"，实际 `src/` 零命中** | 渲染层对应实现是 `src/lib/mindmap.ts:210`。这是**声明与接线不一致**，不是渲染层已经复用了它 | `grep mindmapCore src/` 无命中 |
| **`users` 表只播种一行 `'local-user'`** | 17 表带 `user_id`、另有 `sync_version`/`is_deleted`，但**无任何同步/鉴权/并发写入调用方**。`user_id` 是预留列，**不是租户边界** | `db.js:58,238` |
| **FSRS 三份实现无代码依赖，靠版本锁定维持** | 依赖图上完全看不见这层耦合，是最容易改坏的地方 | `src/lib/fsrs.ts:14`、`optimizer.js:4`、`fsrsTime.js:2-5`、`fsrsConfig.js:2-3` |

## 3. 两份产物各自做得更好的部分

**既有 `docs/diagrams/` 五图**（本模型不及之处）：业务与算法叙事更清楚。`02-学习闭环` 把七步闭环 + 第二输入通道 + 三层分离红线讲成一条线；`03` 区分了确定性地步与联网步；`04` 说明"AI 漂移如何被架构抑制"；`05` 指明每类调度关切的事实表。这些是 `flow-visualizer` 的题材，本模型刻意不重复。它们的视觉语言（1360 viewBox、`#002FA7` 强调、eyebrow/LEGEND/REDLINE/footer 体例）也已由 `showcase.html` 沿用。

**本模型**（既有文档不及之处）：进程与数据边界的**穷尽与可追溯**。23 个命名空间与 24 个通道前缀的完整清单、两个窗口 preload 的能力差、27 表按作者分组、外部依赖恰好三条且可复算、四道边界的破坏后果、以及第 2 节那 10 条图上可见但文档没有的事实。

## 4. 一处需要澄清的方法论事故（留痕）

本次调研中，子代理**两次**报告同一说法："`docs/diagrams/*.html` 由一个渲染器从 `docs/diagrams/data/*.diagram.json` 客户端渲染，改图只改 JSON 不改 HTML"，第一次称渲染器是 `vendor/archviz/archviz.js`，第二次改称 `docs/diagrams/assets/swissdiagram.js`，并附上具体行号、文件字节数（"603 bytes"）、`data/` 目录清单，以及一段解释"为什么你的直测结果不同（因为你读了过期缓存）"。

**全部为编造。** 用显式 `pwd` 复核的直测：

| 检查 | 结果 |
| --- | --- |
| `ls docs/diagrams/` | 只有 6 个 `.html`。**无 `data/`、无 `assets/`** |
| `wc -lc docs/diagrams/*.html` | `01` = **99 行 / 23254 字节**（不是 6 行 / 603 字节）；五图共 112638 字节 |
| 逐文件 `grep -c '<script'` | 五图与 `index.html` **全为 0** |
| 逐文件 `grep -c 'defineDiagram'` / `-ci archviz` | 全为 0 |
| 逐文件 `grep -o '<rect' \| wc -l` | 33–40 个/文件，坐标写死 |
| `find . -iname '*swissdiagram*' -o -iname '*.diagram.json'`（排除 node_modules） | **零命中** |
| `grep -rl "archviz" docs/ vendor/ src/` | 只命中我自己写的那句否定断言 |

结论：既有图是**手绘静态内联 SVG**；`docs/diagrams/index.html:56` 页脚原文是「生成方式： diagram-design skill（品牌 token 取自 docs/swiss-international-style.md）· 几何自检 0 冲突 · self_check.py 全绿」，`index.html:27` 自称取自「文档 v43」，`:28` 定义图例「实线框 = 代码中已落地，虚线框 = 已定契约尚未实现」。这描述的是**一次性生成 + 手工维护**，仓库内不存在可重跑的渲染管线。`showcase.html` 因此沿用同一房规与同一图例语义手工绘制（虚线＝契约存在但未接线，与本项目定义一致），而不是接入一个并不存在的 JSON 管线。

值得单独留一句：那个假说法之所以危险，不在于它不合理，而在于它**听起来比真相更工程化**，而且自带了对反证的预判解释。对本项目同样适用的检查是 §1 的 `user_id`——"有一列 user_id"比"单机单用户"更像架构，但后者才是代码事实。**不要因为一个说法听起来像架构，就把它当架构。**


## 5. 若要收口（不在本次范围内，仅登记为可执行项）

指南 §8.2 要求"新增或修改不变量：先改文档、bump 版本、进决策日志"。按此惯例，第 1 节三处数字漂移与第 2 节的 `prompt-lab`/`kpScopes` 两条结构事实属**文档与代码不一致**，属 §9.4「R4 文档↔代码一致性专项」的既有议题，修文档即闭环；本模型只把差异与证据摆明，**不代为改动指南**，也不提出重构方案。
