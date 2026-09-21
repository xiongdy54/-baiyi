# system-model · 模型摘要

**范围**：`Incremental reading Dev` 全仓库，current-state only，生成于 2026-09-21 @ `780ea84`（分支 `docs/architecture-model-v48.14`）。不含目标态、不含风险评级、不含修复建议 —— 那些分别属 `evolution-planner` / `risk-quality-reviewer`。

**生产方式**：`architecture-visualization:explore` → `system-modeler`（场景）+ `c4model`（Structurizr 事实源）+ Graphviz DOT（稠密耦合图）。业务应用按 `business-application-fitness` 参照处理，所以本模型的主体是**业务语言**的，不只是框架与构建命令清单。

---

## 系统边界

一个 Electron 桌面应用，本机单用户、local-first。产品运行时由三个容器构成：主进程、主窗口渲染进程、捕捉窗渲染进程。数据真源有两处而非一处：`library.db`（27 表）与 `userData/memory/` 文件树；另有故意外置的 `dictionary.db`。

真正的外部依赖只有三条边：AI 网关（OpenAI 兼容，含本机 Ollama）、公网搜索引擎抓取、离线词典下载。三条全在主进程。

仓库内还有**第二个可独立运行的程序** `prompt-lab/`（提示词测试台）：独立 Electron 入口、独立 userData、不随产品发布，与主软件的关系是"构建期复用代码 + 运行期数据隔离"。模型把它放在产品边界之外。

## 四条最重要的结构性关系

1. **跨进程只有一道面**：23 个 `window.*API` ↔ 159 个 `ipcMain.handle`。实测 `src/` 内零 `require` / `node:` / `ipcRenderer`。渲染层在结构上不具备出网与读文件的能力。
2. **`library.db` 单一作者**：`db.js` 的 `persist()` 64 个调用点全在该文件内；机制是内存库 + 全量原子回写。这条决定了"运行期外部改库文件必被覆盖"和"恢复只能在重启时换入"两件事，也解释了 `dictionary.db` 为什么必须分库。
3. **写入作者按表组划分且互不重叠**：`material_map_*` 只由 `mindmapEngine` 写，`memory/` 只由 `memoryStore` 写，`fsrs_configs` 快照只由 `optimizer` 产。
4. **主动推送是同一个惯用法的五份副本**：`fsrs:configChanged` / `journal:changed` / `insight:changed` / `memory:changed` / `mindmap:changed` 各自遍历 `getAllWindows()`。

## 图上看不见、靠契约维持的一致性

FSRS 有**三份实现**（渲染层 `ts-fsrs` 调度 / 主进程 `fsrs-rs-nodejs` 优化 / `fsrsTime.js` 手工复刻时间语义且明令禁止 import 前者），三者无代码依赖，只由"权重逐位对齐 ts-fsrs 5.4.2"和 S7 / L6-A 测试断言维持一致。`foliate-js` 由单目录防腐层封住（全仓唯一 import 点在 `src/lib/reader/foliate/adapter.ts:10`，快照 commit 钉在 `version.ts`）。深色模式强调色必须写 `body`，因为深色档声明在 `body.theme-dark` 上、胜过 `:root` 继承。

## 证据强度

结构性事实（表数、通道数、命名空间数、`persist()` 调用点数、唯一 import 点、扇入）都是**直接 grep/读码计数**，文档里给了复算命令。行为性事实（谁写哪张表、谁在运行期真的被调用）以 require 与调用点为据；只有注释或 `.d.ts` 声明支撑的部分一律降级 —— 最典型的是 `kpScopes.js`：414 行契约校验器在生产主进程**零 require**，真实消费方是 `prompt-lab` 与测试，图上标为 `ContractOnly`。

## 需要人确认的 9 项

`evidence.md` §4 列了 V1–V9。其中三项会实质改变架构读法：

- **V1** `users` 表只播种一行 `'local-user'`，`user_id` / `sync_version` / `is_deleted` 无任何同步或鉴权调用方 —— 所以 `user_id` **不是租户边界**，把它画成权限模型会是错的。
- **V8** `kpScopes` 未接线是"分阶段交付"（注释称"本批只定契约"）还是作废，未定。当前只能说"卡片与归一的确定性护栏已生效、出层 schema 校验尚未接入主进程"。
- **V3** `settings.json` 有两份并存实现（`main.js` 内联 vs `electron/settingsStore.js`），是否同文件同结构、有无互相覆盖，**未实测，本模型不下结论**。

## 与既有文档的差异（不取代，只补）

既有 `docs/diagrams/` 五张图回答的是业务与算法问题（闭环、制卡管线、三层分离、事实链），本模型回答结构与边界问题，读者不同。实地核验：五图均为零脚本、写死坐标的手绘内联 SVG，其页脚自述来源为「文档 v43 / v42 / v41」，而当前指南已是 v48.14；`memory` 一词在除 `01` 外的四张图里出现 0 次，五图均未画 M15 导图子系统。

与代码相比，指南自身有三处可复算的数字漂移：`:55` 称 main.js "IPC 注册（50+ 通道）"（实测 159）、`:56` 称 db.js "17 张表"（实测 27），§3 结构清单只列了 10 个主进程文件（`electron/` 实有 24 个 `.js`，未列入的 14 个是 `mindmapEngine`/`mindmapCore`/`kpNorm`/`kpScopes`/`fsrsConfig`/`memoryStore`/`memoryTidy`/`memoryRetrieve`/`dictDb`/`dictStore`/`importers`/`backup`/`settingsStore`/`udc`），`prompt-lab/` 虽在 §6.3 被称"独立最小软件，v15 已建成"，但同样不在 §3 清单内。详见差异说明。

## 产物

| 文件 | 是什么 |
| --- | --- |
| `system-model.structurizr.dsl` | **事实源**：53 元素 / 76 关系 / 5 视图。改图改这里 |
| `system-model.evidence.md` | 逐条 file:line 与置信度索引、可复算计数、V1–V9 |
| `architecture-understanding.md` | 业务语言的架构理解（四道边界 + 契约簇 + 回归路径参与方） |
| `module-map.dot` | 稠密耦合与写入归属图（C4 装不下的那部分） |
| `showcase.html` | 对外展示：一张 L2 视图，沿用既有 `docs/diagrams` 房规 |
| `docs-vs-code-vs-model.md` | 指南 / 既有图 / 代码 / 本模型 四方差异对照 |
| `tools/` | 三个离线自检脚本（DSL / DOT / SVG 几何） |
