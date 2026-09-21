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
| D-TEST-06 | **中高 · 一处脏行让复习页与仪表盘整体不可用，且界面上没有出口** | 卡片任一 JSON 列损坏时，`leech_json` 与 `context_ref_json` 会让 `computeTodayQueue`／`getStatsOverview`／`listAllCards` **三处全部抛异常**（`fsrs_json`、`tags_json` 则被安全跳过）。文档 §4.2-20 L330 承诺的是「损坏行在队列与统计中一致跳过」。数据层留了出口（`deleteCard` 仍能删掉脏行、删后三处立即恢复），但卡片浏览页本身也崩 → 用户在界面里删不掉它，只能改文件 | §4.2-20 L145/L330 | `npx electron tests/flows/f13-adversarial-input.cjs` P1（含逐列定位与自愈路径两节） | 长跑每轮复现 |
| D-TEST-07 | 低–中 · 数据卫生 | `createJournalEntry` 不校验 `entry_date`：`"abc"`、`"2026-13-45"`、`"2026-02-30"`、`"2026-3-5"`、数字串都被原样入库；而 `journalTime.isJournalDate()` 就在同一个模块里且被别处使用。后果：日记页分组/排序/搜索会漂出这些条目，记忆整理的 `listJournalEntriesSince` 按日期水位线补处理也会漏 | §6.5 L733（自然日归类）、§7.2（数据完整性） | 同上 P5 | 每轮复现 |
| D-TEST-08 | **中-高 · 安全红线**（§7.5 明文写着的禁令） | `electron/ai.js:79 getAIConfig()` 把 safeStorage 解密后的**明文 apiKey** 放进返回体，经 `ai:getConfig`（`main.js:559`）与 `aiAPI.getConfig()`（`preload.js:173`）直达渲染层。渲染层一旦被注入（本项目确实要渲染外部 HTML 与 AI 正文，入口虽过了 DOMPurify，但防线只有一道）就能一步把用户的 API Key 读走外发；Key 也会随渲染进程崩溃转储/开发者工具暴露。设置页有 5 处引用 apiKey（用于回填输入框） | §7.5 L911「渲染层不持有明文 Key（流式转发在主进程）」 | `node tests/flows/f16-security-boundary.cjs` U4 | 每轮复现；修复方向：主进程只回 `hasKey`，设置页改成「留空则不改、填入才覆盖」（写入侧本来就是这个语义） |
| D-TEST-09 | **中 · 一个字节让应用起不来** | `electron/settingsStore.js:9 readSettings()` 只做 `JSON.parse` 并在 catch 里回退 `{}`，**合法 JSON 但不是对象**时原样返回：文件内容为 `null` 时返回 `null`，主进程任何 `s.app?.X` 都在 `reading 'app'` 处抛 TypeError → **`initDb()` 直接崩，应用打不开**（F18 Y7 实测：11 档损坏里只有 `null` 这档冷启动失败）。而 `null` 恰是「上次写入被截断/被外部工具写坏」最容易留下的形状之一；`0`/`true`/`"字符串"` 不炸启动但同样绕过兜底。修法只需一行：`const v = JSON.parse(...); return v && typeof v === "object" ? v : {};` | §7.6（读失败要兜底并留痕）、§7.1.4 L858 启动→主流程→重启不丢数据 | `npx electron tests/flows/f18-settings-matrix.cjs` Y3（逐档形状）+ Y7（冷启动逐档） | 每轮复现；用户自救：用记事本把 settings.json 改成 `{}` |
| D-TEST-13 | 中 · 承诺过的安全边界没实现 | 「输入焦点内绝不劫持」在**两处**被写成硬约束（`src/lib/commands.ts:8` 的注释、指南 §9.1 M4 L1122「纯修饰键/`e.repeat`/输入焦点（input/textarea/contentEditable）绝不触发」），但 `dispatchKey`（`commands.ts:140-157`）与 `install`（`:160-173`）里**没有任何焦点判断**——全仓 `isContentEditable` 只出现在 `Reader.tsx:566` 与 `foliate/adapter.ts:180`（各自的翻页监听），命令分发这条路是裸的。实测：注册一个 `when:()=>true` 的 `reader.makeCard` 动作，投喂焦点在 `INPUT` 内的 `Ctrl+Z`，动作照样执行 1 次。当前用户可见面被 `when()` 收窄（阅读命令要有选区、复习视图内没有输入框），所以还没爆成事故；一旦有人在复习页加一个批输入框，`1/2/3/4/q/w/d/z` 会当场把评分/暂停/删除打在用户敲字的手上 | §9.1 M4（键位三不变量）、§7.1.3（边界不得穿透） | `npx electron tests/flows/f20-command-contract.cjs` W3（行为证据 + 静态证据双证） | 每轮复现；修法：`dispatchKey` 开头补 `const t = e.target; if (t && (/^(INPUT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return false;` |
| D-TEST-14 | 低 · 残缺串能进设置 | `eventToCombo` 只挡纯修饰键，不挡 `key === ""`：`{key:"",ctrlKey:true}` 生成 `"Ctrl+"`。这串既匹配不到任何键（`getBinding` 永远等不上），又能被 `setOverride` 原样写进 `settings.app.keybindings`，且 `conflictWith` 也拿它当一条占用——只能靠「恢复默认」整体清掉。触发面：部分 IME 组合过程与少数键盘会发出 `key:""` | §9.1 M4（存储串 = 展示串 = 匹配串，三者必须同形） | 同上 W2 | 每轮复现；修法：`if (!key) return null;` |
| D-TEST-15 | 中低 · 写入口零校验 + 假成功 | `electron/db.js:1921 updateProgress(itemId, progress)` 只做 `JSON.stringify(progress ?? {})` 后直接 UPDATE，**不校验值是不是普通对象、也不看这一行存不存在**：`"字符串"`、`42`、`true`、`[]` 都被原样写进 `progress_json`（`null`/`undefined` 因 `?? {}` 侥幸归一）；给不存在的 id 写进度**返回 `true`**，调用方（阅读器/设置页）据此显示「已保存」。同一形状问题在 `addReadingEvent(itemId, charPos)`（`:1511`）：任意 itemId 都能插事件，实测给不存在的书插入 1 行 5000 字的记录——将来统计侧按 item 聚合时这是无人认领的字数。当前危害被读侧兜住了（`itemProgress` 与 `App.tsx` 三处解析全在 try 内，脏值一律回 0，所以没爆成界面故障），属于「数据已经被写脏，只是暂时没人踩」 | §7.2（每次落库即落盘之外，数据完整性）、§7.1.3（边界输入不得穿透） | `npx electron tests/flows/f23-reading-progress.cjs` Q3 + Q4 | 每轮复现；修法：写入前 `if (!progress \|\| typeof progress !== "object" \|\| Array.isArray(progress)) return false;` 并改 `const n = db.getRowsModified?.()` 或在 UPDATE 后 `SELECT 1 FROM library_items WHERE id=?` 判存在 |
| ~~D-TEST-05~~ **已撤销**（2026-09-22 21:52Z 复核） | 不是产品缺陷 · 是我的测试打点打错 | 原判「书架上鼠标点不开书」。复核证据：旧打点用 `closest('[class*=shelf] > *')` 取到的元素其实是**卡片外面的图注 `.cap`**（诊断实测 `在书卡可点区内: false`），点它当然不开书；改成直接取 `.book-card` 中心后，真实鼠标序列（`mouseMoved → mousePressed → mouseReleased`）**一次就开**，正文/阅读器容器都在。 | §6.1 L519 主旅程第一环（现在由 F01 K4 硬检查守住） | `FLOW_INSTANCE=manual node tests/flows/f01-golden-journey.cjs` 看 K4 的「图注落点探测」「点开方式」两条记录与 `✓ 真实鼠标点书卡封面能打开书` | 撤销依据：`src/components/Bookshelf.tsx:497`（书卡本体 onClick → `onOpenBook`）与 `:580`（表视图「打开」按钮）都是活的，6a0e3b0 落地时就好；F01 K4 已把这条改成硬检查，鼠标路径一旦回退会立刻变红。教训登记：**GUI 断言的打点元素必须与被测处理程序同节点**，取「视觉上看到的那块文字」不等于取到可点的卡。 |
| D-TEST-16 | 低 · 可点区与视觉单元不一致 | D51 把书卡改成「封面 + 排印图注」，但图注（书名与进度那几行文字）**渲染在可点的 `.book-card` 节点之外**（实测 `card.contains(.cap) === false`，卡矩形 241×362 而图注中心 y=518 已在卡下方）。后果：用户最自然的落点——点书名——没有任何反应，只有点封面那块图才开书；键盘 Enter 与表视图按钮都正常，所以是可达性不一致而非功能缺失。修法：把 `.cap` 纳入同一个带 onClick 的容器（或让容器包住两者） | §5.4 D51「书卡＝封面 + 排印图注」为一个视觉单元；§6.1 主旅程第一环 | `FLOW_INSTANCE=manual node tests/flows/f01-golden-journey.cjs` 看 K4 的「只点图注书名能否开书 = false」与 `✗(已知) [D-TEST-16]` | 每轮复现（GUI 流程需人工在场，不进长跑） |
| D-TEST-10 | 低 · 口径不一致 | 同一个搜索词在两侧结果不同：词典查询与制卡分类走 `normalize("NFKC")`（全角/半角统一），日记与知识库搜索直接把词塞进 `LIKE`（只做小写无关，不做全半角折叠）。实测库里有 5 条含 `ABC` 的日记，搜 `ABC` 命中 5，搜 `ＡＢＣ` 命中 0。中文输入法下打出全角字母是日常操作，用户会以为内容丢了 | §6.5（日记检索）、§7.4（同类归一化应同源） | `npx electron tests/flows/f19-read-api-boundary.cjs` Z4 | 每轮复现；转义本身是对的（`%`/`_`/`\` 都按字面量处理，实测不越权、不注入） |
| D-TEST-11 | 中 · 一个越界参数让整页白屏 | 分页入参没归一：`limit: 1.5` 原样进 SQL，sql.js 直接 `datatype mismatch` **抛异常**，`listJournalEntries`／`listJournalDates`／`listJournalEntriesSince`／`listMemoryRuns`／`listKnowledgePoints`／`listKnowledgeRelations`／`listKnowledgeProposals`／`listInsightRuns`／`listPersonalMeaningCandidates` 九族全中招（现有代码只做了 `Number(limit)` + `Math.min/max`，能过就交给 SQL）。同一族函数还集体在**显式传 `null`** 时崩（默认参数只兜 `undefined`，`{limit: null}` / `null` 位置参数绕过后解构报错）。渲染层一次算术抖动（`Math.ceil(x/2)` 之类）或前端把「无筛选」序列化成 `null` 就触发 | §7.1.3（边界输入不得穿透到崩溃）、§7.6（出错要兜底） | 同上 Z2（1376 次调用矩阵：43 个读函数 × 32 档） | 每轮复现；修法：`const n = Math.max(1, Math.min(1000, Math.floor(Number(limit)) || 200))` 一行收口 + 入参改 `const {…} = opts ?? {}` |
| D-TEST-12 | 中 · 仪表盘一张图恒为 0 | 阅读历史图的日桶键没对齐：`getStatsOverview()` 里 `readByDay` 用 `dayStartMs(created_at)`（日切点对齐，且随 `dayCutoffHour` 移动）做键，取值却用 `for (let d = now - 45*86400000; d <= today0; d += 86400000)`——`now` 带当天毫秒，所以 `readByDay[d]` 几乎永远取不到，`chars` 恒为 0。实测推进 500 字阅读后 `readingDays` 合计仍是 0 字。副作用还有两个：日桶数随调用时刻在 45/46 之间跳；两次读数的 `date` 相差 1ms（§4.2-20 的「唯一口径」被墙钟污染） | §6.2 学习仪表盘（阅读历史）、§4.12-4（自然日口径） | 同上 Z7 | 每轮复现；修法：`readFrom` 先过 `dayStartMs()` 再进循环 |

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
| D-DOC-07 | 已废除的 `settings.app.fsrsWeights`（§4.4.10 L173 与 D22 明写「字段废除，迁移后删除」）仍被当现行事实在两处留着：① §7.4 配置清单 L901 仍列「FSRS 权重：`settings.json app.fsrsWeights`，长度必须 21，非法拒绝应用」；② `src/lib/fsrs.ts:6` 注释仍写「启动时读取 settings.app.fsrsWeights 注入权重」。代码侧本来是对的（只有 `db.js:304` 迁移读一次即删），所以这条属文档/注释未收口 | §4.4.10 vs §7.4 L903、`src/lib/fsrs.ts:6`（F18 Y1 三条 known 断言） |
| D-DOC-08 | 设置面有 11 个键 + 1 个层从未在文档登记：代码在读的 `app.accentColor`、`app.autoBackupEnabled`、`app.dictMode`、`app.dictPopupFields`、`app.globalShortcuts`、`app.mindmapPricing`、`app.mindmapConcurrency`、`app.mindmapRetryMax`、`app.mindmapSectionChunkChars`、`dashboard.configs`、`dashboard.hiddenWidgets`，以及 `dashboard` 这一整层——而 §4.2-3 L128 把 SettingsStore 写成「三层 `app / theme / plugin.<id>`」。§7.4 要求配置集中可审，未登记的旋钮等于既不能评审也不会被迁移照顾 | §4.2-3 L128、§7.4（F18 Y1 反向对齐两条 known 断言） |
| D-DOC-09 | M4 键位契约三处与代码不符：① 文档写「命令表 12 条 / 分组展示 12 条」，`src/lib/commands.ts:20-36` 实为 **14 条**（阅读 5 + 复习 9）；② 代码里 `reader.lookupWord` 的默认键 `Ctrl+D` 从未出现在「默认键位（用户锁定）」表里（全仓 `grep Ctrl+D AI_DEVELOPMENT_GUIDE.md` 零命中），而 `Ctrl+D` 恰是浏览器/系统的「收藏/加书签」保留键，锁定的键位表漏登一条等于没经用户同意；③ §4.2-2 L127 把接口写成 `{id,title,when,keybinding}`，代码实为 `CommandDef {id,title,scene,defaultKey}`，`when` 挂在动作侧（`commands.ts:124`） | §9.1 M4、§4.2-2 L127（F20 W1 三条 known 断言） |
| — | §9.2 状态表与正文矛盾：L1517 标 M8 ❌、L1421 标 M14 未实现，而 §6.5/§6.7、代码与决策号显示两者均已实现 | §9.2 |
| — | §7.2 L869「所有业务表软删除」与 `deleteMaterialMap` 的真删语义（v48.5）之间没有登记例外 | §7.2 vs `electron/db.js:4059` |

按既有约定（文档打架改文档不动代码），这些要用户拍板后一次性收口（bump + 决策号），本轮不改。
