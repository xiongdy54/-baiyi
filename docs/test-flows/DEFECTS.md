# 缺陷登记（全流程测试层发现）

登记人：`tests/flows/` 全流程测试层 · 分支 `test/flow-coverage` · 起始 2026-09-21
每条都可 `npx electron tests/flows/<对应流程>.cjs` 一键复现，秒级。
「严重度」按用户把这份工作区当成品在用的立场评估：会不会丢用户数据、会不会让用户误判。
修复顺序、最小修法、必须同批改动的配对、以及修完怎么用本层闸门回验，见 [FIXPLAN.md](FIXPLAN.md)。

> **复核（2026-09-22，对照 v48.15 指南逐条读实现 + 一轮新鲜全流程复跑）**：
> 23 条产品侧缺陷**逐条证实存在**（其中 1 条的子例不成立、已更正），9 条文档漂移证实 7 条、更正 2 条。
> 复核发现的措辞/行号问题集中列在文末「复核更正」，表内行号未逐格改写以免破坏历史记录。

| 编号 | 严重度 | 一句话 | 违反条款 | 复现 | 状态 |
|---|---|---|---|---|---|
| D-TEST-01 | 中 · 会静默丢用户数据 | 「FSRS 优化 → 应用权重」提示成功后，新参数环境只活在内存里；若此后应用被关/崩溃且中间没有任何其他写库动作，重启即静默回退默认参数 | §7.2 L874 每次落库即落盘；§7.1.4 L858 重启不丢数据；§4.4.10 指针与配置行同生共死 | `npx electron tests/flows/f03-scheduling-conservation.cjs` 看 S3 矩阵与 S10 两行 `✗(已知)` | **已修复（批次 C，2026-09-22）**：落盘补在 **optimizer 边界**（applyWeights / resetWeights 各调一次 `db.persistNow()`），**没有**改 `insertFsrsConfig` —— 它的另一个调用方是 initDb 的迁移块，而 initDb 的落盘时机在末尾，迁移途中提前 persist 会动到还没就绪的落盘路径。回验：F03 S10 两条 known → 硬断言（新配置行当场落盘 / 重启后仍在用），并新增幂等三条（重复应用同一权重不报错、不产生第二行、指针不变）；S3 的 `insertFsrsConfig` 那一格按「已登记例外」从判据里移出（不是降级成假绿）。⚠️ 规格 §C2 原写法是「保留 known + 加 EXEMPT 过滤」，实测那样会以**意外转绿**反向报警（notFlushed 里只剩这一格，过滤后判据即成立、本层闸门直接判红），故 S3 一并降级为 check 并在注释里登记例外。 |
| D-TEST-02 | 低 · 语义歧义 | `prompt_templates.is_default` 恒为 1，从未有代码置 0；全新库里 `card-occlusion` 有两行同时「默认」 | §6.3.4 L561 版本化播种（默认版本应唯一）；§7.2 | `npx electron tests/flows/f06-ai-card-contract.cjs` A1 | 运行期靠 `getPromptTemplate` 的 `ORDER BY version DESC` 侥幸取对，暂未构成用户可见故障 |
| D-TEST-03 | 低 · consent 卫生 | `settings.app.memory.enabled` 未做布尔归一：手写 `settings.json` 里填字符串 `"yes"` 即被当成开启 | §4.18 L358 默认关闭是 consent 纪律；同文件对数值项都做了 clamp，唯独布尔漏了 | `npx electron tests/flows/f07-memory-privacy.cjs` D1 | 需用户手改配置文件才触发 |
| D-TEST-04 | 观察项（非缺陷） | 僵尸 run 对账 `reconcileStaleMaterialMapRuns` 不在 `initDb` 内，只在 `electron/main.js:1351` 启动时调一次 | — | F04 G5 | 行为正确（阈值 30 分钟 + 60 秒下限 + 幂等），登记只为说明分层 |
| D-TEST-06 | **中高 · 一处脏行让复习页与仪表盘整体不可用，且界面上没有出口** | 卡片任一 JSON 列损坏时，`leech_json` 与 `context_ref_json` 会让 `computeTodayQueue`／`getStatsOverview`／`listAllCards` **三处全部抛异常**（`fsrs_json` 走 `normalizeFsrs` 自带 try；`tags_json` 在**队列路径**上被跳过——`TODAY_QUEUE_SQL` 不选该列，但 `mapCardRow` 里它同样是裸 parse）。文档 §4.2-20 L330 承诺的是「损坏行在队列与统计中一致跳过」。**复核补充**：`mapCardRow`（`electron/db.js:1055-1080`）里共 **9 处裸 `JSON.parse`**（`cloze_ords`/`context_ref_json`/`source_ref_json`/`tags_json`/`domain`/`occlusion_json`/`leech_json`/`dict_json`/`memory_ref_json`），只有 `fsrs_json` 有兜底；F13 P1 的逐列矩阵目前只覆盖 4 列（fsrs/leech/tags/context_ref），其余 5 列是同类地雷、尚未测到。`getStatsOverview` 的 KPI 循环虽自带 try（`:2054-2057`），但整函数仍会抛（实测：四列同时损坏 → 三处全崩）。数据层留了出口（`deleteCard` 仍能删掉脏行、删后三处立即恢复），但卡片浏览页本身也崩 → 用户在界面里删不掉它，只能改文件 | §4.2-20 L145/L330 | `npx electron tests/flows/f13-adversarial-input.cjs` P1（含逐列定位与自愈路径两节） | **已修复（批次 A，2026-09-22，分支 `fix/read-robustness`）**：两层都收口——① SQL 层 3 处 `json_extract` 全部包进 `CASE WHEN json_valid(...)`（`db.js` 的 `TODAY_QUEUE_SQL`／`listAllCards`／来源统计）；② JS 层 `mapCardRow` 9 列改走同一个安全解析助手，损坏列回落空值并记进 `damagedColumns`，只有 `fsrs_json`/`leech_json` 判定不出调度与挂起状态时置 `damaged=true`；③ `computeTodayQueue` 与 `getStatsOverview` 的 KPI 循环对 `damaged` 行**一致缺席**，队列另经 `.damaged` 字段暴露，`getCard`/`listAllCards` 保留可见可删的出口。回验：F13 P1 逐列矩阵已从 4 列扩到 10 列，四条 known 全部转绿并降级为 check（`FLOW_INSTANCE=manual npx electron tests/flows/f13-adversarial-input.cjs`） |
| D-TEST-07 | 低–中 · 数据卫生 | `createJournalEntry` 不校验 `entry_date`：`"abc"`、`"2026-13-45"`、`"2026-02-30"`、`"2026-3-5"`、数字串都被原样入库；而 `isJournalDate()` 就摆在邻居模块 `electron/journalTime.js:22`，且 `db.js:41` 本来就 `require("./journalTime")`（用了 `journalDateOf`）——校验函数现成、导入现成，唯独写入前没调它（`createJournalEntry` 在 `db.js:2381-2392`，`String(entryDate || journalDateOf(created))` 原样入库）。后果：日记页分组/排序/搜索会漂出这些条目，记忆整理的 `listJournalEntriesSince` 按日期水位线补处理也会漏 | §6.5 L733（自然日归类）、§7.2（数据完整性） | 同上 P5 | 每轮复现 |
| D-TEST-08 | **中-高 · 安全红线**（§7.5 明文写着的禁令） | `electron/ai.js:79 getAIConfig()` 把 safeStorage 解密后的**明文 apiKey** 放进返回体，经 `ai:getConfig`（`main.js:559`）与 `aiAPI.getConfig()`（`preload.js:173`）直达渲染层。渲染层一旦被注入（本项目确实要渲染外部 HTML 与 AI 正文，入口虽过了 DOMPurify，但防线只有一道）就能一步把用户的 API Key 读走外发；Key 也会随渲染进程崩溃转储/开发者工具暴露。设置页有 5 处引用 apiKey（用于回填输入框） | §7.5 L911「渲染层不持有明文 Key（流式转发在主进程）」 | `node tests/flows/f16-security-boundary.cjs` U4 | **已修复（批次 C，2026-09-22）**：唯一泄露口 `main.js` 的 `ai:getConfig` 改成 `const { apiKey, ...safe } = getAIConfig()` 再返回（与 `ai:setConfig` 既有剥法一致）；`ai.js` 内部继续用完整配置（按规格不动）。全仓扫描确认没有第二个把 `getAIConfig()` 原样回给渲染层的 handler：`ai:test` 只回 `{ok,message}`、`ai:listModels` 只回 id 数组、`ai:chat` 只转发 messages。回验：F16 U4 32/32 全绿（两条静态判据：handler 必须剥 Key、零裸返回）。**如实说明**：§C1 想要的「返回体里 `apiKey === undefined`」是运行时形状，而 F16 是静态对账流程、拿不到 IPC 返回值，已用等价静态判据覆盖并登记此差异。 |
| D-TEST-09 | **中 · 一个字节让应用起不来** | `electron/settingsStore.js:9 readSettings()` 只做 `JSON.parse` 并在 catch 里回退 `{}`，**合法 JSON 但不是对象**时原样返回：文件内容为 `null` 时返回 `null`，主进程任何 `s.app?.X` 都在 `reading 'app'` 处抛 TypeError → **`initDb()` 直接崩，应用打不开**（F18 Y7 实测：11 档损坏里只有 `null` 这档冷启动失败）。而 `null` 恰是「上次写入被截断/被外部工具写坏」最容易留下的形状之一；`0`/`true`/`"字符串"` 不炸启动但同样绕过兜底。修法只需一行：`const v = JSON.parse(...); return v && typeof v === "object" ? v : {};` | §7.6（读失败要兜底并留痕）、§7.1.4 L858 启动→主流程→重启不丢数据 | `npx electron tests/flows/f18-settings-matrix.cjs` Y3（逐档形状）+ Y7（冷启动逐档） | **已修复（批次 A，2026-09-22）**：`electron/settingsStore.js` 与 `electron/main.js` **两份** `readSettings()` 都补「合法 JSON 但非对象 → 回落默认形状」（各自保留原有 fallback：前者 `{}`、后者 `{ app: {}, theme: {} }`，`settings:set` 的写路径形状不变）；按规格**不做自愈写回**，坏文件不被覆盖。回验：F18 Y3/Y7 两条 known 转绿降级，并新增 Y3b 把「settings=null 时三个读设置入口」固化为流程断言。**「用户自救」那半句作废**——不需要手改文件了 |
| D-TEST-13 | 中 · 承诺过的安全边界没实现 | 「输入焦点内绝不劫持」在**两处**被写成硬约束（`src/lib/commands.ts:8` 的注释、指南 §9.1 M4 L1122「纯修饰键/`e.repeat`/输入焦点（input/textarea/contentEditable）绝不触发」），但 `dispatchKey`（`commands.ts:140-157`）与 `install`（`:160-173`）里**没有任何焦点判断**——全仓 `isContentEditable` 只出现在 `Reader.tsx:566` 与 `foliate/adapter.ts:180`（各自的翻页监听），命令分发这条路是裸的。实测：注册一个 `when:()=>true` 的 `reader.makeCard` 动作，投喂焦点在 `INPUT` 内的 `Ctrl+Z`，动作照样执行 1 次。当前用户可见面被 `when()` 收窄（阅读命令要有选区、复习视图内没有输入框），所以还没爆成事故；一旦有人在复习页加一个批输入框，`1/2/3/4/q/w/d/z` 会当场把评分/暂停/删除打在用户敲字的手上 | §9.1 M4（键位三不变量）、§7.1.3（边界不得穿透） | `npx electron tests/flows/f20-command-contract.cjs` W3（行为证据 + 静态证据双证） | 每轮复现；修法：`dispatchKey` 开头补 `const t = e.target; if (t && (/^(INPUT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return false;` |
| D-TEST-14 | 低 · 残缺串能进设置 | `eventToCombo` 只挡纯修饰键，不挡 `key === ""`：`{key:"",ctrlKey:true}` 生成 `"Ctrl+"`。这串既匹配不到任何键（`getBinding` 永远等不上），又能被 `setOverride` 原样写进 `settings.app.keybindings`，且 `conflictWith` 也拿它当一条占用——只能靠「恢复默认」整体清掉。触发面：部分 IME 组合过程与少数键盘会发出 `key:""` | §9.1 M4（存储串 = 展示串 = 匹配串，三者必须同形） | 同上 W2 | 每轮复现；修法：`if (!key) return null;` |
| D-TEST-15 | 中低 · 写入口零校验 + 假成功 | `electron/db.js:1921 updateProgress(itemId, progress)` 只做 `JSON.stringify(progress ?? {})` 后直接 UPDATE，**不校验值是不是普通对象、也不看这一行存不存在**：`"字符串"`、`42`、`true`、`[]` 都被原样写进 `progress_json`（`null`/`undefined` 因 `?? {}` 侥幸归一）；给不存在的 id 写进度**返回 `true`**，调用方（阅读器/设置页）据此显示「已保存」。同一形状问题在 `addReadingEvent(itemId, charPos)`（`:1511`）：任意 itemId 都能插事件，实测给不存在的书插入 1 行 5000 字的记录——将来统计侧按 item 聚合时这是无人认领的字数。当前危害被读侧兜住了（`itemProgress` 与 `App.tsx` 三处解析全在 try 内，脏值一律回 0，所以没爆成界面故障），属于「数据已经被写脏，只是暂时没人踩」。**F32 全量清点后确认这是一类而非两处**：28 个写入口探针打在幽灵 id / 非法载荷上，**15 个「针对既有行」的函数返回真值**（`deleteCard`、`deleteItem`、`deleteJournalEntry`、`updateCard`、`setLibraryItemTitle`、`setLibraryItemLang`、`deleteKnowledgeRelation`、`deleteKnowledgeExternalRef`、`deletePersonalMeaningCandidate`、`deleteInsightRun`、`removeDictSource`、`setDictSourceEnabled`、`setAIGenBatchStatus`，加上本条点名的 `updateProgress`、`addReadingEvent`），另有 5 个返回 `null`/`false` 可判失败（`setCardSuspended`、`updateCardLeech`、`setActiveMaterialMap`、`deleteMaterialMap`、`setMemoryRunStatus`），只有 5 个诚实抛错（`saveReview`、`setActiveFsrsConfig`、`setInsightRunStatus`、`createKnowledgeExternalRef`、`createJournalEntry`）；插入类三族（`card_issues` / `extracts` / `reading_events`）都接受指向不存在父行的行，`createCard({})` 甚至整份接受一张没有任何正文的空白卡。同时 F32 给出一个重要**清白结论**：这些幽灵写**一个都没有越界改写既有行**（27 张表逐行差分，零命中），所以问题性质是「门口没设防」，不是「会写坏别人的数据」 | §7.2（每次落库即落盘之外，数据完整性）、§7.1.3（边界输入不得穿透） | `npx electron tests/flows/f23-reading-progress.cjs` Q3 + Q4；`FLOW_INSTANCE=manual npx electron tests/flows/f32-write-existence-matrix.cjs` W2/W3/W6（28 条探针全量清点 + 逐条磁盘快照差分） | 每轮复现；修法：写入前 `if (!progress \|\| typeof progress !== "object" \|\| Array.isArray(progress)) return false;` 并改 `const n = db.getRowsModified?.()` 或在 UPDATE 后 `SELECT 1 FROM library_items WHERE id=?` 判存在 |
| D-TEST-22 | 中 · 清洗越界吃掉正文 | `electron/importers.js:139 markdownFromText()` 承诺「只针对这两类明确噪音，**正文不做任何改写**」，但清洗是无上下文的全量正则：`<style>`/`<script>` 与 `data:image` 一律删。于是用户 .md 里**围栏代码块内的 `<style>…</style>` 被整段吃掉**——实测输入「正文 / ```html 代码块里的 style / 后文」，输出里代码块被掏空，中间的示例一行不剩（F30 S3）。导入网页存档类 Markdown 常带 CSS/JS 示例，这类读者的正文会被静默改损，且 documents.markdown 是唯一正文真源（§4.2），坏了没有第二份可回滚 | §9.1 M6-1「正文不做任何改写」、§4.2、§7.2 | `FLOW_INSTANCE=manual npx electron tests/flows/f30-import-parsers.cjs` S3 | 每轮复现；修法：先扫围栏（``` 与 ~~~）登记受保护区间，两处正则都跳过区间内的匹配；或把清洗改为按块解析而非整串 replace |
| D-TEST-23 | 低 · 潜在（当前被 D-TEST-12 遮蔽） | 阅读字数的取数集合没有过滤已删书：`electron/db.js:2243` 的 `SELECT item_id, char_pos, created_at FROM reading_events WHERE created_at >= ?` **不带任何 is_deleted 条件**，而 §7.2 L869 写的是「所有业务表软删除；**查询一律带 `is_deleted = 0`**」。`deleteItem`（`:844`）只软删 `library_items` 与 `documents`，`reading_events` 原样留着——F31 J5 实测删书后仍有 2 行事件挂在已删的书上，且这 2 行正是统计 SQL 会读进去的全部输入。今天用户看不出来，因为 D-TEST-12（日桶键没对齐）让这张图恒为 0；**一旦按 D-TEST-12 的修法把日桶改对，已删书的字节就会立刻开始计入成长面板**：一本正文已经打不开的书，仍在替用户的阅读史涨字数。所以这条要在修 D-TEST-12 的同一个改动里一起做，否则等于把一个可见 bug 换成一个静默的数据偏账 | §7.2 L869（查询一律带 is_deleted=0）、§6.2 学习仪表盘、§4.12-4 | `FLOW_INSTANCE=manual npx electron tests/flows/f31-db-invariants.cjs` J5（`✗(已知) [D-TEST-23]` + 「删书后残留的阅读事件行数 = 2」记录） | **已修复（批次 B，与 D-TEST-12 同批落地）**：`readRows` 改为 `JOIN library_items li ON li.id = re.item_id AND li.is_deleted = 0`（`reading_events` 无软删位，绝不能写 `re.is_deleted`）。回验：F31 J5 新增硬断言「删书后该书的 800 字必须从 readingDays 消失」。**残余仍红、继续挂本号**：`f31:286` 那条 known 数的是**表里**指向已删书的事件行数，而本层既定期望是「删书只软删书目、历史事件留在原地」，查询侧过滤永远不会让它归零 → 规格 §B2 的「降级三条」在 F31:286 这一条上做不到，留待真正清理事件行的批次再收。 |
| D-TEST-21 | 中 · 自己定的排序不变量被自己的读口破了 | `electron/db.js:1404` 写明「v23 起排序不变量 = review_seq（表内唯一、插入序单调；**禁按 id/reviewed_at 排序**）」，但 `electron/db.js:1489 listAllReviewLogs()` 仍是 `ORDER BY reviewed_at ASC`。墙钟一跳（NTP 校时、改时区、恢复旧备份、双开进程）这个读口就给出错序。F29 用「时钟倒退」夹具把后果做实：插入序 5→6 两条日志，清单给出反序，于是**撤销面板要撤的那条（seq=6）与日志清单末条（seq=5）不是同一条**——用户点「撤销」撤走的不是他刚看到的那张卡。§4.4.10 的参数审计按每条日志的 config 分段重放、§6.6.6 的「首次达成」也由全局序重算，都依赖同一个序，错序会让分段与首次判定一起偏 | §4.4.9（排序不变量）、§4.4.10（审计分段）、§6.6.6（首次达成重算） | `FLOW_INSTANCE=manual npx electron tests/flows/f29-global-sequence.cjs` T2（静态禁令）+ T3（两序不一致）+ T4（撤销面板与清单不同条） | **已修复（批次 B，2026-09-22）**：`listAllReviewLogs` 改成 `ORDER BY review_seq ASC`（该列本来就 SELECT 出来了，调用方零改动）。回验：F29 T2/T3/T4 三条 known 全部降级为硬断言。**顺带修掉本层自己的一处判据 bug**：T4 原式比 `undoable.logId ↔ lastFromList.logId`，而 `listAllReviewLogs` 不 SELECT 日志 id → 右侧一路退化成 `cardId`，即使两边真是同一条也恒假；改为比 `review_seq`（表内唯一）+ `cardId`，判据只收紧不放宽。`optimizer.js:33` 自己按 `reviewedAt` 重排属另一议题、本批未动。 |
| ~~D-TEST-20~~ **已撤销**（同轮自查） | 不是缺陷 · 与本层既定期望自相矛盾 | 我先把它登记成缺陷，随后自查发现**本层自己的 F02 I6 早就把「删书只软删书目、卡与摘录留在原地」当期望值断言**（标题带 §7.2 L869 + 用户资产观）——同一件事不能一处当期望、另一处当缺陷。指南 L869 原文是「所有业务表软删除；查询一律带 is_deleted = 0」，卡没被删所以照常查得到，属既定设计。真正残留的是个小展示问题：这类卡 docTitle 为 null，界面没有「来源已删」标记 → 改登记为**功能建议**。 | — | F28 X6（含 `docTitle=null` 记录） | 撤销 |
| D-TEST-19 | 低 · 展示函数对非法数值没有兜底 | 三个纯展示函数在非有限数/非法日上会产出用户可见的 junk：`dayLabel(Infinity)` 与 `dayLabel(1e18)` → `"NaN-NaN"`（**复核更正**：`dayLabel(NaN)` 其实安全——`!ms` 把 NaN 也挡住了，返回 `""`；漏网的是 Infinity 与超 Range 的时间戳。原引用里"NaN"这个例子是 F26 证据标签把 `JSON.stringify(NaN)` 印成 `null` 造成的误读）；`shelf.pct(Infinity)` → `"Infinity%"`、`pct(NaN)` → `"NaN%"`；`journal.journalDateLabel("2026-02-30")` 通过正则后交给 `new Date(2026,1,30)` 静默进位到 3 月 2 日，于是**标签写着「02-30」而星期是 3/2 的**——这正是 D-TEST-07（`createJournalEntry` 不校验 `entry_date`，`"2026-02-30"` 能入库）在显示层的落点：脏日期不只是分组漂移，还会被渲染成「不存在的日子 + 别人的星期」。当前可达性受上游限制（调度与统计产生的时间戳都合法；坏日期要靠手改或旧库残留），所以定为低 | §7.1.3（边界输入不得穿透）、§6.5（自然日归类）、§5.4（图注常驻可读） | `node tests/flows/f26-display-text.cjs` P2（七个展示函数 × 边界/非法值探针） | 每轮复现；修法：`dayLabel` 开头 `if (!Number.isFinite(ms) || ms <= 0) return "";`、`pct` 同理夹取、`journalDateLabel` 用 `journalTime.isJournalDate()` 先判合法（该函数已存在，只是没人用） |
| D-TEST-17 | 低–中 · 潜在任意写（当前无活路径） | `electron/db.js:941 createImportedDoc({…, originalName, originalBuf})` 在 `:950` 直接 `fs.writeFileSync(path.join(assets/<itemId>, originalName), …)`，**不净化文件名**；而同一函数往下 5 行的内嵌图却有 `if (!/^[\w.-]+$/… ) continue` 防穿越——同一个函数里两条写盘路径的信任级别不一致。实测探针（F25 V1/V7）：`../evil-1.md` → 写出 `userData/assets/evil-1.md`（出了卡目录）；`..\evil-3.md` → Windows 反斜杠同样穿透；`../../evil-2.md` → 直接落在 userData 根；`../../settings.json` → **用户全部偏好被一次导入改写，且没有任何写路径会把它修回来**（`library.db` 那一路反而会被紧随其后的 `persist()` 整文件重写掩盖，所以销毁看不出来）。另有三种名字直接抛错让整本导入失败（绝对路径 ENOENT、`..` EISDIR）。**如实限定严重度**：`grep originalName electron/main.js` 显示当前六个调用点全部传 `"original.docx"` 之类硬编码名，今天没有活的用户可达路径；这是 API 层的防御缺口，将来任何把远端名/文件内部名直接传进来的新入口（同步、目录导入、AI 抓取）都会立刻变成高危 | §7.5（不可信内容进得来、越界的事做不了）、§7.2（文件真源与备份） | `FLOW_INSTANCE=manual npx electron tests/flows/f25-asset-boundary.cjs` V1 + V2 + V7 | **已修复（批次 C，2026-09-22）**：净化收在 **sink** 侧（不指望调用方）——新增 `safeAssetFileName(name, fallback)`，用 `split(/[\\/]/)` 而非 `path.basename`（Windows 反斜杠会穿透 basename），并拒掉纯点名字（`..` 过 basename 后仍是 `..`）；原书字节与**内嵌图两条路径**都过它，且写盘名与 `assets.path` 用同一个变量（读侧按 path 取文件）。回验：F25 V1/V2/V7 三条 known → 硬断言，新增「resolve 前缀校验」与「净化后的名字不含分隔符/纯点」；六个生产调用点传的硬编码名净化后逐字节不变。 |
| D-TEST-18 | 低 · 备份与回收语义 | 软删一本书只更新 `library_items` 与 `documents` 的 `is_deleted`（`db.js:844 deleteItem`），`assets` 行与盘上字节都不动：实测删后 3 行 assets 全部 `is_deleted=0`。读侧本身是干净的（`getDocument(已删 id)` 取不到、`readBookFile` 返回 null），但备份按目录整包会把已删书的字节永久带走，恢复后幽灵资源跟着回来，将来接同步也要为它设计合并规则 | §7.2 软删除语义、§9.1 M2（备份清单） | 同上 V6 | **已修复（批次 C，2026-09-22；范围只做「不进备份」—— 用户拍板 §Q6，不引入物理删除字节的不可逆路径）**：① `deleteItem` 连带把该书 `assets` 行置 `is_deleted=1`（字节保留在盘上，回收留给显式清理）；② 备份按本模块既有的依赖注入模式加 `opts.deletedItemIds`（backup.js 不 require db 层，避免新耦合），由 `main.js` 的 `backupOpts()` 从新导出 `listDeletedItemIds()` 塞入，**缺省不传 = 与今天逐字节一致**。回验：F25 V6 + F31:239 两条 known → 硬断言，新增备份**内容**探针（已删书 0 条、未删书逐份在、不传参时与今天一致）；M2 `tests/backup.test.cjs` 33/33 全绿。 |
| ~~D-TEST-05~~ **已撤销**（2026-09-22 21:52Z 复核） | 不是产品缺陷 · 是我的测试打点打错 | 原判「书架上鼠标点不开书」。复核证据：旧打点用 `closest('[class*=shelf] > *')` 取到的元素其实是**卡片外面的图注 `.cap`**（诊断实测 `在书卡可点区内: false`），点它当然不开书；改成直接取 `.book-card` 中心后，真实鼠标序列（`mouseMoved → mousePressed → mouseReleased`）**一次就开**，正文/阅读器容器都在。 | §6.1 L519 主旅程第一环（现在由 F01 K4 硬检查守住） | `FLOW_INSTANCE=manual node tests/flows/f01-golden-journey.cjs` 看 K4 的「图注落点探测」「点开方式」两条记录与 `✓ 真实鼠标点书卡封面能打开书` | 撤销依据：`src/components/Bookshelf.tsx:497`（书卡本体 onClick → `onOpenBook`）与 `:580`（表视图「打开」按钮）都是活的，6a0e3b0 落地时就好；F01 K4 已把这条改成硬检查，鼠标路径一旦回退会立刻变红。教训登记：**GUI 断言的打点元素必须与被测处理程序同节点**，取「视觉上看到的那块文字」不等于取到可点的卡。 |
| D-TEST-16 | 低 · 可点区与视觉单元不一致 | D51 把书卡改成「封面 + 排印图注」，但图注（书名与进度那几行文字）**渲染在可点的 `.book-card` 节点之外**（实测 `card.contains(.cap) === false`，卡矩形 241×362 而图注中心 y=518 已在卡下方）。后果：用户最自然的落点——点书名——没有任何反应，只有点封面那块图才开书；键盘 Enter 与表视图按钮都正常，所以是可达性不一致而非功能缺失。修法：把 `.cap` 纳入同一个带 onClick 的容器（或让容器包住两者） | §5.4 D51「书卡＝封面 + 排印图注」为一个视觉单元；§6.1 主旅程第一环 | `FLOW_INSTANCE=manual node tests/flows/f01-golden-journey.cjs` 看 K4 的「只点图注书名能否开书 = false」与 `✗(已知) [D-TEST-16]` | 每轮复现（GUI 流程需人工在场，不进长跑） |
| D-TEST-10 | 低 · 口径不一致 | 同一个搜索词在两侧结果不同：词典查询与制卡分类走 `normalize("NFKC")`（全角/半角统一），日记与知识库搜索直接把词塞进 `LIKE`（只做小写无关，不做全半角折叠）。实测库里有 5 条含 `ABC` 的日记，搜 `ABC` 命中 5，搜 `ＡＢＣ` 命中 0。中文输入法下打出全角字母是日常操作，用户会以为内容丢了 | §6.5（日记检索）、§7.4（同类归一化应同源） | `npx electron tests/flows/f19-read-api-boundary.cjs` Z4 | 每轮复现；转义本身是对的（`%`/`_`/`\` 都按字面量处理，实测不越权、不注入） |
| D-TEST-11 | 中 · 一个越界参数让整页白屏 | 分页入参没归一：`limit: 1.5` 原样进 SQL，sql.js 直接 `datatype mismatch` **抛异常**，`listJournalEntries`／`listJournalDates`／`listJournalEntriesSince`／`listMemoryRuns`／`listKnowledgePoints`／`listKnowledgeRelations`／`listKnowledgeProposals`／`listInsightRuns`／`listPersonalMeaningCandidates` 九族全中招（现有代码只做了 `Number(limit)` + `Math.min/max`，能过就交给 SQL）。同一族函数还在**整参传 `null`** 时崩（默认参数只兜 `undefined`：`listJournalEntries(null)` 解构 TypeError、`listJournalDates(null)` 读属性抛错）。**复核更正**：`{limit: null}` 这一档不崩——`Number(null) || 200` 会吞成 200，属静默偏差而非崩溃（F19 Z2 的失败清单里只有 `scalarNull` 档）。渲染层一次算术抖动（`Math.ceil(x/2)` 之类）或前端把「无筛选」序列化成 `null` 就触发 | §7.1.3（边界输入不得穿透到崩溃）、§7.6（出错要兜底） | 同上 Z2（1376 次调用矩阵：43 个读函数 × 32 档） | **已修复（批次 A，2026-09-22，范围＝本条登记的清单 9 族）**：新增 `clampLimit`（补 `Math.floor`，其余沿用 `Number(x) || DEF` 语义）与 `clampOffset`（显式判有限性并给 1e9 上限，`Infinity`/`1e21` 不再打穿），替换 9 族的 `lim`/`off`；9 个函数签名 `({…} = {})` → `(opts)` + `opts ?? {}`，整参 `null`/标量不再抛。回验：F19 Z2 两条 known 转绿降级 + 新增 Z2b 逐族等价断言（分数/非有限/越界入参对整数对照逐字节一致）。**残余仍红、继续挂本号**：F19 矩阵打的是 43 个读函数，`getMaterialMapShard`（`db.js:4230`）整参 `null` 仍抛——它与 9 族不同族、批次 A §N 明写不修，留待单独批次（需要独立编号时再发新号） |
| D-TEST-12 | 中 · 仪表盘一张图恒为 0 | 阅读历史图的日桶键没对齐：`getStatsOverview()` 里 `readByDay` 用 `dayStartMs(created_at)`（日切点对齐，且随 `dayCutoffHour` 移动）做键，取值却用 `for (let d = now - 45*86400000; d <= today0; d += 86400000)`——`now` 带当天毫秒，所以 `readByDay[d]` 几乎永远取不到，`chars` 恒为 0。实测推进 500 字阅读后 `readingDays` 合计仍是 0 字。副作用还有两个：日桶数随调用时刻在 45/46 之间跳；两次读数的 `date` 相差 1ms（§4.2-20 的「唯一口径」被墙钟污染） | §6.2 学习仪表盘（阅读历史）、§4.12-4（自然日口径） | 同上 Z7 | **已修复（批次 B，2026-09-22）**：`readFrom` 改用 `today0`（与桶键 `dayStartMs` 同一坐标系），桶轴 = `today0 - 45·86400000` → **46 个桶含今日**（桶数口径由用户拍板，写进提交信息）。回验：F19 Z7 从 known 提为硬断言，并新增「500 字落在今日桶 / 桶数恒 46 / 相邻桶差恰一天」三条；F23:174 同步降级为硬断言。 |

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
| D-DOC-04 | `memory:*` 通道名文档与实际不符（**复核更正**：文档 L150 那 **6** 个——`memory:status / read / maintain / selectForMaterial / reset / openPath`——与实际 10 个不是一一对应；因文档写成「memory:status / read / …」并列式，F11 的扫描器只能抓到第一个，故该条已降级为记录） | §4.18 L150、`electron/preload.js:267` |
| D-DOC-05 | 文档点名的通道 `library:pickEbook`、`library:pickHtml` 在 `electron/main.js` 里没有注册（要么文档超前，要么注册方式不同） | §4 接口清单 |
| D-DOC-06 | 悬空章节引用：正文引用 `§11.5`（作为现行规范口径使用），但文档根本没有 §11 章；另有 `§11–§12`、`§11–§21` 两处指向已删除的旧编号体系 | 全文 4 处 |
| D-DOC-07 | 已废除的 `settings.app.fsrsWeights`（§4.4.10 L173 与 D22 明写「字段废除，迁移后删除」）仍被当现行事实在两处留着：① §7.4 配置清单 L901 仍列「FSRS 权重：`settings.json app.fsrsWeights`，长度必须 21，非法拒绝应用」；② `src/lib/fsrs.ts:6` 注释仍写「启动时读取 settings.app.fsrsWeights 注入权重」。代码侧本来是对的（只有 `db.js:304` 迁移读一次即删），所以这条属文档/注释未收口 | §4.4.10 vs §7.4 L903、`src/lib/fsrs.ts:6`（F18 Y1 三条 known 断言） |
| D-DOC-08 | 设置面有 11 个键 + 1 个层从未在文档登记：代码在读的 `app.accentColor`、`app.autoBackupEnabled`、`app.dictMode`、`app.dictPopupFields`、`app.globalShortcuts`、`app.mindmapPricing`、`app.mindmapConcurrency`、`app.mindmapRetryMax`、`app.mindmapSectionChunkChars`、`dashboard.configs`、`dashboard.hiddenWidgets`——而 §4.2-3 L128 把 SettingsStore 写成「三层 `app / theme / plugin.<id>`」。（**复核更正**：`dashboard` 这一层并非"从未登记"——`dashboard.layout` 在 L128 作先例、L501 有消费点、L1412 有组件目录；未登记的只有上面那 11 个键。）。§7.4 要求配置集中可审，未登记的旋钮等于既不能评审也不会被迁移照顾 | §4.2-3 L128、§7.4（F18 Y1 反向对齐两条 known 断言） |
| D-DOC-09 | M4 键位契约三处与代码不符：① 文档写「命令表 12 条 / 分组展示 12 条」，`src/lib/commands.ts:20-36` 实为 **14 条**（阅读 5 + 复习 9）；② 代码里 `reader.lookupWord` 的默认键 `Ctrl+D` 从未出现在「默认键位（用户锁定）」表里（全仓 `grep Ctrl+D AI_DEVELOPMENT_GUIDE.md` 零命中），而 `Ctrl+D` 恰是浏览器/系统的「收藏/加书签」保留键，锁定的键位表漏登一条等于没经用户同意；③ §4.2-2 L127 把接口写成 `{id,title,when,keybinding}`，代码实为 `CommandDef {id,title,scene,defaultKey}`，`when` 挂在动作侧（`commands.ts:124`） | §9.1 M4、§4.2-2 L127（F20 W1 三条 known 断言） |
| — | 状态表与正文矛盾（**复核更正**）：① M8 确为矛盾——§9.2 L1518 标 `❌`，而 §9.1 L1312/L1339 是 M8-A ✅ / M8-B ✅；② M14 的矛盾不在 §9.2（该表 L1524 已写 `✅ v45 UM-1 + v46 UM-2 全部实现`），而是在 §9.1 的小节标题 L1422 仍写「（v42 定契约，未实现…）」 | §9.2 / §9.1 L1422 |
| — | §7.2 L869「所有业务表软删除」与 `deleteMaterialMap` 的真删语义（v48.5）之间没有登记例外 | §7.2 vs `electron/db.js:4059` |

按既有约定（文档打架改文档不动代码），这些要用户拍板后一次性收口（bump + 决策号），本轮不改。

## 复核更正与行号校准（2026-09-22）

**方法**：对照 `AI_DEVELOPMENT_GUIDE.md`（v48.15，1655 行）逐条文本检索 + 逐条读 `electron/`、`src/` 实现 +
跑一轮新鲜全流程（32 条，14,694 次累计运行）。**结论：23 条产品侧缺陷全部真实存在**，
下表是复核中被修正的地方（正文已就地改）与行号校准。

| 对象 | 原写法 | 复核结果 |
|---|---|---|
| D-TEST-06 | 「三处全部抛异常」+「fsrs/tags 安全跳过」 | 抛异常**成立**（实测三处全崩）；tags 的"安全"只对队列路径成立，`mapCardRow` 里 9 处裸 parse、矩阵只测了 4 列 |
| D-TEST-07 | 「`journalTime.isJournalDate()` 就在同一个模块里」 | 在邻居模块 `electron/journalTime.js:22`，且 `db.js:41` 已 require 该模块——校验函数与导入都现成，只是没调用 |
| D-TEST-11 | 「`{limit: null}` 绕过后解构报错」 | `{limit:null}` 不崩（吞成 200）；崩的是整参 `null` |
| D-TEST-19 | 「`dayLabel(NaN)` → NaN-NaN」 | `dayLabel(NaN)` 返回 `""`（安全）；junk 来自 `dayLabel(Infinity)`/`dayLabel(1e18)`/`pct(NaN)`/`pct(Infinity)` |
| D-DOC-04 | 「文档那 7 个」 | 文档列 **6** 个；preload 侧 10 个 invoke + `memory:changed` 事件 |
| D-DOC-08 | 「`dashboard` 整层从未登记」 | `dashboard.layout` 有登记（L128/L501/L1412）；未登记的是那 11 个键 |
| 状态表 | 「§9.2 标 M14 未实现」 | M14 的"未实现"字样在 §9.1 标题 L1422；§9.2 M8 ❌ 的矛盾成立 |
| D-DOC-01 | 「34 处逐字重复」 | 行级重复抽样证实 ≥18 行（含 5 对整段），49/43 矛盾在 L883/L884；精确总数未逐行复核 |
| D-DOC-02 | L915 / L923 | L916 / L924（重复属实） |

**行号校准表**（原引用 → 当前实际）

| 对象 | 原引用 | 实际 |
|---|---|---|
| D-TEST-01 insertFsrsConfig | `db.js:737` | 737（INSERT 在 742，函数体 737-747 无 persist） |
| D-TEST-01 applyWeights | `optimizer.js:115` | 114-119（调用在 116） |
| D-TEST-06 mapCardRow | 未标 | `db.js:1055-1080`（**FIXPLAN 曾误写 1178 = `getCard`**） |
| D-TEST-08 apiKey | `ai.js:79` | 函数 79-100，`apiKey` 在 **94**；`main.js:559`、`preload.js:173` 一致 |
| D-TEST-09 readSettings | `settingsStore.js:9` | 函数 8，`JSON.parse` 在 **10**，catch 11-12 |
| D-TEST-11 清单族 | 未标 | `listJournalEntries` `db.js:2360`、`listKnowledgePoints` `:2591` |
| D-TEST-12 日桶 | `db.js:2241-2253` | 2241（`readFrom`）/ 2246（键）/ 2253（填充循环） |
| D-TEST-15 updateProgress | `db.js:1921` | 1921-1928（返回 true 在 1928 附近） |
| D-TEST-15 addReadingEvent | `db.js:1511` | 1511-1519 |
| D-TEST-17 落点 | `db.js:941` / `:950` | 941（函数）/ 950（写盘）/ 956（图片侧过滤） |
| D-TEST-18 deleteItem | `db.js:844` | 844-850（846 items / 847 documents） |
| D-TEST-21 | `db.js:1404` / `:1489` | 一致 |
| D-TEST-23 readRows | `db.js:2243` | **2242**；且该表 `db.js:181-186` 建表时**根本没有 `is_deleted` 列** |
| D-TEST-13 | `commands.ts:8/:140/:160-173` | 一致（`install` 的监听在 162-171） |
| D-TEST-14 | 未标 | `commands.ts:52-62`（生成）/ `:96/:99`（写入）/ `:111`（占用判定） |
| D-TEST-16 | `Bookshelf.tsx:497/:580` | 一致（`.book-card` 485-499 带 onClick；`.cap` 555-561 在卡外兄弟位） |
| D-TEST-19 | 未标 | `shelf.ts:353-358`（dayLabel）/ `:348-350`（pct）/ `journal.ts:173-180` |
| D-TEST-10 | 未标 | LIKE 裸串：`db.js:2353-2356`（日记）/ `:2583-2587`（知识库）；NFKC 侧：`dict.ts:86`、`cards.ts:254` |
| D-DOC-05 | — | 指南 L1217/L1218 点名；`main.js` 未注册（相近的是 `pickEpub`/`pickWord`/`pickTxt`/`pickMarkdown`） |
| D-DOC-06 | — | 4 处：L220 / L223 / L322 / L984 |
| D-DOC-07 | §7.4 L903 | §7.4 **L901**（`app.fsrsWeights` 那行）；§4.4.10 L173 与 D22 L965 是"废除"侧 |
| §7.2 例外 | — | §7.2（L867-875）只登记了日记防抖（L874）与记忆文件树（L875）；`material_maps` 真删只在 §4.19 L404 / D43 L981 追记，且 L446 又写它"具软删除与审计列"，自相冲突 |
