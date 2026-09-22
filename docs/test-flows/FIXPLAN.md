# 修复优先级路线图（按「会不会丢数据 / 会不会让用户误判」排序）

来源：`test/flow-coverage` 分支全流程测试层（33 条流程 / 12k+ 次运行）登记的 23 条产品侧缺陷
与 9 条文档↔代码漂移。缺陷事实与证据见 [DEFECTS.md](DEFECTS.md)，本页只回答**先修哪个、
怎么修、修的时候谁守着**。产品代码本层一行未动（report-only），是否动手由用户裁定。

图例：**T1** = 会丢用户数据或让整页不可用；**T2** = 会让用户误判（显示对了、事实错了）；
**T3** = 契约/卫生类，现在不疼但会腐烂。

## 1. 建议顺序

| 序 | 编号 | 档 | 一句话危害 | 修法（最小可行） | 落点 | 守护流程 |
|---|---|---|---|---|---|---|
| 1 | D-TEST-09 | T1 | `settings.json` 恰好是 `null` 时应用直接起不来，界面无自救入口 | `readSettings()` 返回前加 `return v && typeof v === "object" ? v : {}` | `electron/settingsStore.js:8-12`（函数 8 / parse 10 / catch 11-12） | F18 Y3 + Y7 |
| 2 | D-TEST-11 | T1 | 一个分数 `limit` 让仪表盘/日记/知识库九族清单整体白屏 | 入参统一夹取：`Math.max(1, Math.min(1000, Math.floor(Number(limit)) \|\| 200))`，并把解构写成 `const {…} = opts ?? {}` | `electron/db.js` 清单族（`listJournalEntries`／`listKnowledgePoints`／`listMemoryRuns` 等 9 个） | F19 Z2（1376 次调用矩阵） |
| 3 | D-TEST-06 | T1 | 卡片任一 JSON 列脏 → 复习页 + 仪表盘 + 卡片浏览三处同崩，用户在界面里删不掉它 | `mapCardRow` 里 **9 处 `JSON.parse`** 一次性统一走安全解析助手（`fsrs_json` 的 `normalizeFsrs` 就是先例）——复核实测：只堵 `leech_json`／`context_ref_json` 两列会留下另外 7 列同类地雷（`cloze_ords`/`source_ref_json`/`tags_json`/`domain`/`occlusion_json`/`dict_json`/`memory_ref_json`）；同时给卡片浏览页加「强制删除损坏行」出口 | `electron/db.js:1055-1080 mapCardRow`（原写 1178 = `getCard`，复核更正） | F13 P1 |
| 4 | D-TEST-08 | T1（安全红线） | §7.5 明文禁止：解密后的明文 apiKey 经 IPC 直达渲染层 | 主进程只回 `hasKey`，设置页改「留空则不改、填入才覆盖」（写入侧本来就是这语义） | `electron/ai.js:94`（apiKey 在返回体里）、`main.js:559`（IPC）、`preload.js:173`（桥） | F16 U4 |
| 5 | D-TEST-01 | T1 | 「FSRS 优化 → 应用权重」提示成功后若没有其他写库动作就退出，新参数整行丢失、静默回退默认，用户以为在用优化结果 | `insertFsrsConfig` 结尾补 `persist()`，或 `applyWeights` 在 `setActiveFsrsConfig` 后调 `db.persistNow()` | `electron/db.js:737-747`（INSERT 在 742）、`electron/optimizer.js:114-119`（调用在 116） | F03 S3 + S10 |
| 6 | D-TEST-21 + D-TEST-23 | T2 | 同一批「按既定口径读数据」的缺口，建议一次改动一起收：① 全局序不变量被 `listAllReviewLogs` 的 `ORDER BY reviewed_at ASC` 破了（时钟一跳，撤销面板与清单不是同一条）；② 阅读字数取数不过滤已删书（现在被下一条的「图恒为 0」遮蔽，一旦修好那张图就开始计脏账） | ① `ORDER BY review_seq ASC`（清单已把该列选出来，调用方零改动）；② `readRows` 改 `JOIN library_items li ON li.id=re.item_id AND li.is_deleted=0`——**不能写 `re.is_deleted=0`**：`reading_events` 建表（`db.js:181-186`）压根没有这一列，复查时最容易顺手写错就崩在这里 | `electron/db.js:1489`、`:2242`（原写 2243） | F29 T2/T3/T4；F31 J5 |
| 7 | D-TEST-12 | T2 | 学习仪表盘阅读历史图恒为 0（日桶取值用带毫秒的 `now` 去查 `dayStartMs()` 键），用户以为自己在裸奔 | `readFrom` 先过 `dayStartMs()` 再进循环；顺带消除日桶数在 45/46 间跳 | `electron/db.js:2241`（readFrom）/ `:2253`（填充循环） | F19 Z7；F28 X2 |
| 8 | D-TEST-22 | T2 | 导入清洗无上下文，把用户 .md 里围栏代码块内的 `<style>` 整段吃掉，而 `documents.markdown` 是唯一正文真源，坏了没有第二份 | 先扫围栏（``` 与 ~~~）登记受保护区间，两处清洗正则跳过区间内匹配 | `electron/importers.js:139-148` | F30 S3 |
| 9 | D-TEST-13 | T2（潜在 T1） | 两处写成硬约束的「输入焦点内绝不劫持」在分发层完全没实现；将来任何人在复习页加批输入框，`1/2/3/4/q/w/d/z` 会当场打在用户敲字的手上 | `dispatchKey` 开头挡焦点：`const t=e.target; if(t && (/^(INPUT\|TEXTAREA)$/.test(t.tagName) \|\| t.isContentEditable)) return false;` | `src/lib/commands.ts:8`（约束注释）/ `:140`（dispatchKey）/ `:162-171`（install 监听） | F20 W3 |
| 10 | D-TEST-15（含 F32 全量清点） | T2 | 写入口零校验是一类问题：15 个函数对幽灵 id 返回真值（假「已保存」），三族子表收幽灵父 id，`createCard({})` 收空白卡。逐函数补校验工作量大，建议先补**用户可达且会误判**的那几个：`updateProgress`、`addReadingEvent`、`deleteCard`、`deleteItem`、`updateCard` | 统一一个小工具：`const exists = (t,id) => SELECT 1 FROM t WHERE id=? AND is_deleted=0`，写前判存在 + 形状归一，返回 `false` | `electron/db.js` 对应函数 | F23 Q3/Q4；F32 W2/W3/W6（棘轮：假成功候选数只许降） |
| 11 | D-TEST-18 | T3 | 软删一本书不动 assets 行与盘上字节 → 备份永久带走已删材料的字节 | `deleteItem` 一并 `UPDATE assets SET is_deleted=1`（字节保留，回收留给显式清理） | `electron/db.js:844-850` | F25 V6；F31 J5 |
| 12 | D-TEST-17 | T3（潜在高危） | 原书文件名不净化，`../../settings.json` 可被一次导入改写且没人修回来；当前六个调用点全传硬编码名，所以没有活路径 | 在 **sink** 侧收：`const safe = path.basename(String(originalName)).replace(/[^\\w.()-]/g,"_") \|\| "original.bin"` | `electron/db.js:941`（函数）/ `:950`（写盘）/ `:956`（图片侧已有过滤） | F25 V1/V2/V7 |
| 13 | D-TEST-02 / 03 / 07 / 10 / 14 / 16 / 19 | T3 | 语义歧义、consent 布尔归一、日记日期不校验、搜索不做 NFKC、`Ctrl+` 残缺串能进设置、图注不在可点节点内、展示函数无 `Number.isFinite` 兜底 | 每条都在 DEFECTS.md 里写了 1–3 行级修法，可打包成一次「卫生类」提交 | 见各条 | F06 A1；F07 D1；F13 P5；F19 Z4；F20 W2；F01 K4；F26 P2 |

## 2. 必须同批改动（拆开会制造新缺陷）

- **D-TEST-12 ↔ D-TEST-23**：只修日桶不改过滤，已删书的阅读字节会立刻开始计入成长面板；
  只加过滤不修日桶，那张图仍然恒为 0，两笔改动互相掩盖。
- **D-TEST-21 ↔ 撤销面板（F29 T4）**：`listAllReviewLogs` 换序之后，撤销面板与日志清单必须同时
  复核（撤销选取靠「清单末条 = 最新一条」这个隐含约定）。
- **D-TEST-15 ↔ 备份/恢复语义（F05）**：若给 `deleteItem` 加「不存在即 false」，要同时确认恢复
  流程不会把「已删的 id 再次删」当成失败回滚。
- **D-TEST-06 ↔ F13 P1 自愈路径**：加 try 回落之后，界面上仍要留「强制删除损坏行」的出口，
  否则从「整页崩」变成「脏行永久留在库里无人知」，性质没变好。

## 3. 文档↔代码漂移（按用户约定：改文档，不动代码）

D-DOC-01…09 全部属于「文档超前/未收口」，与代码行为无关，建议一次 bump（v48.16）收口：
主要是 §7.4 与 `src/lib/fsrs.ts:6` 仍把已废除的 `app.fsrsWeights` 当现行路径（D-DOC-07）、
11 个在读设置键 + `dashboard` 整层从未登记（D-DOC-08）、M4 键位表少一条 `Ctrl+D` 且命令数
写 12 实为 14（D-DOC-09）、§7.2 L869「查询一律带 `is_deleted = 0`」与 `reading_events`
不软删的实际语义之间缺一条例外登记（本轮 D-TEST-23 的根因正是这条没写清楚）。

## 4. 修完之后怎么验（本层现成的闸门）

1. `node tests/flows/run.cjs --hours 1 --gap 20`，看 `report.cjs` 的「现行判红」列是否为 0；
2. 逐条 `known` 断言会**反向报警**：缺陷修好后对应断言会转绿并触发
   「意外转绿」，此时应把该条从 `known` 降级为普通 `check`，并把 `FAKE_BUDGET`（F32）
   与 `fixtures/f24-coverage-baseline.json`（覆盖面棘轮）一并收紧；
3. F10 的性能棘轮与 F24 的流程数棘轮只降不升，动了调度/统计热路径的修复必须看它俩没变红。

## 5. 本轮复核（2026-09-22）带来的修订

对照 `AI_DEVELOPMENT_GUIDE.md`（v48.15）逐条读实现 + 跑一轮新鲜全流程后，**23 条产品侧缺陷全部证实存在**，
本计划的落点行号已全部校准、四处口径已更正；被更正的缺陷措辞与完整行号校准表见
[DEFECTS.md](DEFECTS.md) 文末「复核更正与行号校准」。复核另外改了三件事：

1. **修法扩围（第 3 行 D-TEST-06）**：从"堵两列"改为"堵 9 列"，理由是逐列矩阵实测只有 4 列被测过，
   其余 5 列是同形状的裸 `JSON.parse`——只修报告里点到的那两列，等于把同一类缺陷修一半。
2. **卫生包里 D-TEST-19 的修法口径更正**：`dayLabel(NaN)` 本来就安全（`!ms` 兜住），
   要夹的是 `Infinity` 与超 Range 的时间戳（`Number.isFinite` 一句）；`journalDateLabel` 补
   `isJournalDate()` 前置校验（该函数已在 `electron/journalTime.js:22`，`db.js:41` 也已导入该模块）；
   `udcLabel`／`relationLabel` 对 `null`/`undefined` 入参返回 `null`/`undefined`，建议一并归一成 `""`。
   F26 的探针判据同步修正：**空串不再算 junk**（非法输入下"不显示"是合理语义），
   并新增一条对「2026-02-30 静默进位」的断言（原来只有静态推断、没有断言）。
3. **回归命令的正确用法**：全量一轮用 `node tests/flows/run.cjs --hours 0.05 --gap 0`。
   **别用 `--cycles 1`**——`run.cjs` 的内层 break 会让它在第一条流程之后就收工（实测只跑了 F03 一条）。
   这个坑本轮踩过一次，记在这里免得下次再当成"全量绿"。

**测试侧待办（本层自己要补的）**：F13 P1 的逐列矩阵从 4 列扩到 9 列（`cloze_ords`/`source_ref_json`/
`tags_json`/`domain`/`occlusion_json`/`dict_json`/`memory_ref_json`），否则 D-TEST-06 的"一类问题"只被验了一半。
