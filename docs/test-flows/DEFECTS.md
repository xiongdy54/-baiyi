# 缺陷登记（全流程测试层发现）

登记人：`tests/flows/` 全流程测试层 · 分支 `test/flow-coverage` · 起始 2026-09-21
每条都可 `npx electron tests/flows/<对应流程>.cjs` 一键复现，秒级。
「严重度」按用户把这份工作区当成品在用的立场评估：会不会丢用户数据、会不会让用户误判。

| 编号 | 严重度 | 一句话 | 违反条款 | 复现 | 状态 |
|---|---|---|---|---|---|
| D-TEST-01 | 中 · 会静默丢用户数据 | 「FSRS 优化 → 应用权重」提示成功后，新参数环境只活在内存里；若此后应用被关/崩溃且中间没有任何其他写库动作，重启即静默回退默认参数 | §7.2 L874 每次落库即落盘；§7.1.4 L858 重启不丢数据；§4.4.10 指针与配置行同生共死 | `npx electron tests/flows/f03-scheduling-conservation.cjs` 看 S3 矩阵与 S10 两行 `✗(已知)` | 长跑每轮稳定复现 |
| D-TEST-02 | 低 · 语义歧义 | `prompt_templates.is_default` 恒为 1，从未有代码置 0；全新库里 `card-occlusion` 有两行同时「默认」 | §6.3.4 L561 版本化播种（默认版本应唯一）；§7.2 | `npx electron tests/flows/f06-ai-card-contract.cjs` A1 | 运行期靠 `getPromptTemplate` 的 `ORDER BY version DESC` 侥幸取对，暂未构成用户可见故障 |
| D-TEST-03 | 低 · consent 卫生 | `settings.app.memory.enabled` 未做布尔归一：手写 `settings.json` 里填字符串 `"yes"` 即被当成开启 | §4.18 L358 默认关闭是 consent 纪律；同文件对数值项都做了 clamp，唯独布尔漏了 | `npx electron tests/flows/f07-memory-privacy.cjs` D1 | 需用户手改配置文件才触发 |
| D-TEST-04 | 观察项（非缺陷） | 僵尸 run 对账 `reconcileStaleMaterialMapRuns` 不在 `initDb` 内，只在 `electron/main.js:1351` 启动时调一次 | — | F04 G5 | 行为正确（阈值 30 分钟 + 60 秒下限 + 幂等），登记只为说明分层 |
| D-TEST-05 | 中 · 主旅程断链（在当前工作树） | 书架上**鼠标点不开书**：真实 `Input.dispatchMouseEvent` 分别点封面中心与图注书名各一次，界面仍停在书架；同一张卡用键盘 `Enter` 立刻进阅读器 | §6.1 L519 主旅程第一环「书架 → 阅读器」；§5.4 D51 书卡设计 | `node tests/flows/f01-golden-journey.cjs` 看 K4 的 `✗(已知)` 与随后 `键盘后是否进入阅读器 = true` | **待确认**：测得时 `dist` 构建自 D51 书架重设计的 `src/components/Bookshelf.tsx`（该改动已于 2026-09-22 02:5x 随提交 6a0e3b0 落到本分支，不再是未提交工作树）；`Bookshelf.tsx` 里 `onOpenBook` 只出现在 `onCardKeyDown`（Enter/Space）分支，全部 `onClick` 无一处调用它。需与并行开发会话确认是 WIP 未完成还是已合入主干的回归 |

## D-TEST-01 细节

`electron/db.js:737 insertFsrsConfig()` 只做 `db.run(INSERT)`，不调 `persist()`；
`electron/optimizer.js:115 applyWeights()` = `insertFsrsConfig()` + `setActiveFsrsConfig()`，
而后者只写 `settings.json`（`writeSettings`）。于是：

1. 内存库里多了新配置行、`settings.app.fsrsConfigId` 已指向它；
2. 磁盘上的 `library.db` 里那一行还不存在；
3. 若在这之后没有任何其他写库动作就退出/崩溃 → 重启后 `getActiveFsrsConfig()` 查不到该 id，
   静默回退 `cfg-default`，用户与设置页都还以为在用优化后的参数。

F03 的 S3 矩阵把 13 个写库函数逐个测了一遍，**只有这一个**不合格（其余 12 个即时落盘），
所以这不是普遍现象，而是该函数的孤立遗漏。

疑似修复点（**未改代码，等用户拍板**）：`insertFsrsConfig` 结尾补 `persist()`；
或 `applyWeights` 在移动指针后调 `db.persistNow()`。前者更守纪律（仓储层自己保证落盘）。

## 文档↔代码漂移（F11 文档闸门 + PLAN §6 一并核出，属文档问题，未改动）

F11（`tests/flows/f11-doc-code-drift.cjs`，45ms 一轮）把下面这些做成了每轮自动跑的闸门；
编号进流程的 `known` 标记，改好了会反向报「意外转绿」提醒撤销登记。

| 编号 | 现象 | 位置 |
|---|---|---|
| D-DOC-01 | ≥120 字符的逐字重复行 34 处：§1 原则 8–10、§4.1 KP 块、§4.2-23/24、§7.3 M6-1 测试义务（两份副本还互相矛盾：49 断言 vs 43 断言） | `L27↔L30`、`L109↔L117`… |
| D-DOC-02 | 小节标题整节重复：`## 7.6 出错一键上传` 出现两次 | L915 / L923 |
| D-DOC-03 | 表数量与清单漂移：文档写 17 / 23 张，`electron/db.js` 实建 27 张；`reading_events` 从未在文档点名，`material_map_*`、`dict_sources`、`dictionary_cache` 未列入 §4.1 | §4.1 |
| D-DOC-04 | `memory:*` 通道名文档与实际不符（文档 L150 那 7 个与实际 10 个不是一一对应；因文档写成「memory:status / read / …」并列式，F11 的扫描器只能抓到第一个，故该条已降级为记录） | §4.18 L150、`electron/preload.js:267` |
| D-DOC-05 | 文档点名的通道 `library:pickEbook`、`library:pickHtml` 在 `electron/main.js` 里没有注册（要么文档超前，要么注册方式不同） | §4 接口清单 |
| D-DOC-06 | 悬空章节引用：正文引用 `§11.5`（作为现行规范口径使用），但文档根本没有 §11 章；另有 `§11–§12`、`§11–§21` 两处指向已删除的旧编号体系 | 全文 4 处 |
| — | §9.2 状态表与正文矛盾：L1517 标 M8 ❌、L1421 标 M14 未实现，而 §6.5/§6.7、代码与决策号显示两者均已实现 | §9.2 |
| — | §7.2 L869「所有业务表软删除」与 `deleteMaterialMap` 的真删语义（v48.5）之间没有登记例外 | §7.2 vs `electron/db.js:4059` |

按既有约定（文档打架改文档不动代码），这些要用户拍板后一次性收口（bump + 决策号），本轮不改。
