# FSRS 调度正确性测试报告

- 测试日期：2026-09-06（v11 修复验证）；2026-09-09 增补（M3 批次：L5 时间轴模拟层 + 官方做法审计 + F7/F8 修复）；2026-09-11 增补（v23 批次：FSRS 数据完整性加固 + 学习日语义，F9/F10/F11 修复）
- 被测版本：commit b099d8a（含启动双窗口修复、AI 状态行、思考强度设置）；M3 增补基于 v20；本批次基于 v22
- 测试方法：黄金参考对照法（ts-fsrs 5.4.2 / FSRS-6.0，enable_fuzz=false 作为规范引擎）+ 行为级独立 oracle（ReviewLog.elapsed_days）
- 真实库备份：`%APPDATA%/incremental-reading-dev/library.db.backup-20260906-101221`（早期）；`library.db.backup-before-v21-20260910-171142`（v23 批次开工前）

## 两个核心问题的结论

### Q1：卡片的调度是否严格依照 FSRS 算法进行处理？

**结论：单轮（首评）严格符合；从第二轮起不严格。** 引擎参数与库默认完全一致（L0 13/13），首轮调度的「所见=所存=应得」三方一致（L3），落库无二次计算（L2）。但由于 FSRS 状态持久化不完整（缺陷 F1），**第二次复习起调度输入是残缺的记忆状态**，长间隔场景下间隔被系统性压缩（实测 46 天 → 2 天，失真 23 倍）。

### Q2：用户使用时，卡片是否严格按 FSRS 调度展示？

**结论：展示端机制正确，但数值可见偏差。** 到期判定（due<=now）、评分后移出、到期后重现（含 10 分钟级实时重现）全部验证通过（L3）。但 `enable_fuzz: true` 使预览与实际调度的间隔带随机抖动，用户看到的数字与纯 FSRS 值存在可见偏差（Easy 首评显示 9 天，纯 FSRS 为 8 天——F2），且预览值与实际落库值可能不一致（种子含毫秒时间戳）。

## 各层断言结果

### L0 黄金参考基准（tests/fsrs/golden.cjs）— 13/13 通过
| 断言 | 结果 |
|---|---|
| request_retention=0.9 / maximum_interval=36500 / enable_short_term=true | ✓ |
| learning_steps=[1m,10m] / relearning_steps=[10m] | ✓ |
| FSRS-6 默认 21 权重与库默认一致 | ✓ |
| 新卡 Again→+1m/Learning、Good→+10m、Hard→+6m、Easy→毕业Review(8d) | ✓ |
| 9 个黄金剧本（含遗忘链/重学链）落盘 golden.json | ✓ |

### L1 引擎封装层（adapter.test.cjs + adapter.long.test.cjs）— 15/15 + 0/2
- 评分映射 Again=1/Hard=2/Good=3/Easy=4 ✓
- 首轮四评分 state/lapses 与黄金一致 ✓
- **分钟级往返（15/15 通过——但注意：分钟级 learning steps 不依赖 S/D，此层通过不构成对 F1 的反证）**
- **长间隔决定性场景（0/2 失败）= 缺陷 F1 实证**：
  - 场景A Good×3 毕业链后第4轮 Good：黄金 46.00 天（S=46.32），应用 2.00 天，比值 0.043
  - 场景B Easy→8天间隔后 Good：黄金 39.00 天，应用 2.00 天，比值 0.051

### L2 数据库集成层（db.test.cjs，沙盒 userData）— 15/16
- 新卡 fsrs_json 初始值 {new, due≈now, lapses:0} ✓
- saveReview 落库与渲染层传入状态逐字段一致（state/due 毫秒/lapses/lastReview）——主进程无二次计算 ✓
- 到期边界：due=now-1ms 出现 / due=now+60s 不出现 ✓
- 挂起卡、leech.suspended 卡被过滤 ✓
- **【F3 实证】** leech 标记序列（saveReview 新状态 → updateCard 旧状态+leech）后 fsrs_json.due 被回滚为复习前值（+30天 → 旧值）✗

### L3 用户端到端（真实应用 + 真实库，FSRSTEST-1）— 全部通过
| 检查 | 所见（UI） | 所存（DB） | 应得（黄金） | 判定 |
|---|---|---|---|---|
| 新卡首评 Good 预览 | 10 分钟 | due=reviewed_at+600000ms, state=learning | +10m | ✓ 三方一致 |
| Again/Hard/Good 预览 | 1分钟/6分钟/10分钟 | — | +1m/+6m/+10m | ✓ |
| Easy 预览 | **9 天** | — | **8 天** | ✗ F2（fuzz 偏差） |
| 评分后移出队列 | 51→50 张 | due=+10min | — | ✓ |
| 到期后重现（切视图刷新） | 50→51 张，FSRSTEST-1 重现 | due<=now | — | ✓ |
| review_logs | — | rating=Good, duration_ms 落库 | — | ✓ |

### L4 总账审计（audit.cjs）— 1/1 通过
- FSRSTEST-1 的 1 轮评分重放：state=learning、due 偏差 0.0s——单轮链路「日志可重放、终态可复算」✓

## 缺陷清单

### F1【严重】FSRS 状态持久化丢弃 S/D/reps/lastReview
- 位置：`src/lib/fsrs.ts` fromFsrsCard/toFsrsCard（41-49 行 / 24-39 行）
- 现象：落库的 fsrs_json 只有 {state,due,lapses,lastReview}。下一轮复习用 createEmptyCard() 重建（S=0,D=0,reps=0），且 lastReview 未回填。
- 影响：第二次复习起所有间隔计算输入错误。对用户表现为：**无论复习多少轮、评多高，卡片间隔永远在 1-15 天级别徘徊**（L1 实测 46天→2天），FSRS 的记忆建模完全失效。复习历史越长的卡失真越大。
- 复现：任意卡连续 Good 评分 3+ 轮，第 3 轮后间隔本应 >1 个月，实际 ≤15 天。

### F2【中】enable_fuzz 使预览与实际调度带随机抖动，预览≠落库
- 位置：`src/lib/fsrs.ts` 11 行 `generatorParameters({ enable_fuzz: true })`；preview()（时刻T1）与 next()（时刻T2）分别调用引擎，fuzz 种子含 review_time 毫秒。
- 现象：间隔 ≥2.5 天时，按钮显示的间隔与实际写入的 due 可能不同（实测 Easy 首评预览 9 天 vs 黄金 8 天）。
- 影响：用户看到的「9 天」并非 FSRS 算法真实输出；「所见=所存」在长间隔上不可保证。

### F3【中】Leech 触发时调度进度被旧状态覆写
- 位置：`src/components/ReviewView.tsx` grade() 42-53 行：先 `cardsApi.review()` 写入新状态，随后 `cardsApi.update({...current, leech})` 把复习前的 fsrs 快照整体回写。
- 影响：达到 leech 阈值的那次评分，其调度结果（含 lapses+1）被静默回滚；卡片以复习前的状态继续存在。
- 实测：L2 沙盒复现，+30 天的 due 被回滚为复习前值。

### F4【低】到期队列排序不按 due
- 位置：`electron/db.js` listDueCards ORDER BY created_at ASC。
- 影响：新卡（created_at 最新）总排在队列最前，旧的到期卡沉底；不符合「最先到期的先复习」直觉，也放大了 F1 的影响面。

### F5【低】复习页无自动轮询
- 位置：ReviewView 只在挂载与 cards/changed 时 refresh。
- 影响：learning step（1m/10m）到期后，停留原页不会自动出现卡片，需手动切换视图（本次 L3 即手动切换触发）。不算调度错误，属体验缺陷。

## 测试产物与复现

```
tests/fsrs/golden.cjs            # L0：node tests/fsrs/golden.cjs
tests/fsrs/golden.json           # 黄金值（9 剧本 × 每轮完整状态）
tests/fsrs/adapter.test.cjs      # L1：node tests/fsrs/adapter.test.cjs（需先 esbuild 打包）
tests/fsrs/adapter.long.test.cjs # L1 补强（F1 决定性场景）
tests/fsrs/adapter.bundle.cjs    # esbuild 产物（npx esbuild src/lib/fsrs.ts --bundle --platform=node --format=cjs --outfile=tests/fsrs/adapter.bundle.cjs）
tests/fsrs/db.test.cjs           # L2：npx electron tests/fsrs/db.test.cjs（沙盒）
tests/fsrs/audit.cjs             # L4：node tests/fsrs/audit.cjs --db <db路径> --card-prefix FSRSTEST
```

修复建议优先级：F1 > F3 > F2 > F4 ≥ F5。F1 修复方向：fromFsrsCard/toFsrsCard 全字段往返（S/D/reps/last_review）；F3 修复方向：leech 分支改用 cardsApi.update 之外的字段级更新或先取最新状态再合并 leech 标记；F2 修复方向：预览与实际调度共用同一次引擎计算结果（或关闭 fuzz）。

---

## 附录：修复验证报告（2026-09-06，指导文档 v11 落地）

### 文档修订（AI_DEVELOPMENT_GUIDE.md v10 → v11）
- 新增 §11「FSRS 调度与复习队列契约」：§11.1 全量持久化 / §11.2 fuzz 锁定关闭 / §11.3 预览与调度同源 / §11.4 leech 禁止整卡覆写 / §11.5 due 升序+轮询 / §11.6 回归测试义务。
- §6 硬性约束新增第 7 条（核心算法回归测试义务 + 数据模型字段禁止静默裁剪）；Phase 3 验收补 FSRS 连续性；§1 AI 行补记 v10.4/v10.5。
- 致因分析：文档只写了字段名未写持久化契约（→F1）、验收不含调度连续性（→F1 逃逸）、对 fuzz 沉默（→F2）、leech 只写业务流未写技术边界（→F3）、无测试义务（→全部逃逸至今）。

### 代码修复
| 缺陷 | 修复 | 位置 |
|---|---|---|
| F1 | toFsrsCard/fromFsrsCard 全字段往返（state/due/lapses/stability/difficulty/reps/lastReview），历史卡缺字段时基线回填 | `src/lib/fsrs.ts` |
| F2 | `enable_fuzz: false`；preview() 一次算出四档完整结果，评分复用（预览=落库） | `src/lib/fsrs.ts` + `ReviewView.tsx` |
| F3 | 新增 `updateCardLeech`/`cards:updateLeech`/`cardsAPI.updateLeech` 字段级更新链路，ReviewView leech 分支改用 | `electron/db.js` `main.js` `preload.js` `src/lib/cards.ts` `ReviewView.tsx` |
| F4 | listDueCards 排序改为 due 升序、同 due 按 priority 降序 | `electron/db.js` |
| F5 | 复习视图 30s 轮询到期变化 | `ReviewView.tsx` |
| F6（修复过程中新发现） | updateCard 未传 fsrs/leech 时保留原值（此前会置 NULL → 状态被重置为 new 卡） | `electron/db.js` |

### 修复后回归结果
- L0 参数基线：13/13 ✓（未受影响）
- L1 适配层：15/15 ✓
- L1 补强（长间隔决定性场景，更新为全字段模拟 + fuzz 确定性断言）：**6/6 ✓**——毕业链第4轮 Good：黄金 86.00 天 = 应用 86.00 天；Easy→逾期 Good：黄金 87.00 天 = 应用 87.00 天；同状态两次 preview 输出一致；新卡 Easy 预览精确 8 天
- L2 数据库集成（新增 F3 修复断言 / §11.1 全字段落库断言 / F4 排序断言）：**23/23 ✓**
- E2E（真实应用 UI）：新卡首评 Easy 预览 **8 天**（修复前 9 天，fuzz 偏差消除）；Good 评分后落库 `{"state":"learning","stability":2.3065,"difficulty":2.118,"reps":1,"lapses":0,"lastReview":…}`，S 值与黄金参考 2.307 精确一致；due=+10min 与按钮预览一致；复习列表 due 升序生效
- 合计 **57/57 全绿**

### 遗留事项
- 历史卡（v11 前创建的 50 张 AI 卡）fsrs_json 无 S/D/reps：适配层以基线回填，调度从下一次评分起恢复正常累积；历史失真不可还原（可接受——旧数据的复习史本已失真）。
- 测试期间发现 sql.js 内存库与磁盘文件的多进程并发冲突：应用运行期间外部脚本改库会被应用的下一次 persist() 覆盖。E2E 涉及外部数据修改时必须先关闭应用（已在测试脚本注释中注明）。

---

## M3 批次增补（2026-09-09，v20）：L5 时间轴模拟层 + 官方做法审计

### L5 时间轴模拟（tests/fsrs/simulate.test.cjs）— 417/417 全绿

- 方法：ts-fsrs 原库（fuzz=false）独立驱动全字段内存链（refChain），与应用侧「JSON 持久化往返链」（appChain，模拟 db 存取）在同一受控时间轴上逐轮对照；**refChain 绝不从 appChain 重建**（否则丢字段两侧同错、无法检出 F7 类缺陷）。时间注入经 preview/next 的可选 `now` 参数（§4.4.3 v20）。
- 五组剧本：
  1. **S1a 新卡首评四分支**（Again/Hard/Good/Easy，T0）；
  2. **S1b 全生命周期单卡**（跨约 70 天：1m→10m 步进→毕业→多轮→遗忘→relearning 恢复→逾期 3 天/30 天复习→月级长间隔），逐轮八字段（state/due/lapses/stability/difficulty/reps/learningSteps/lastReview）与黄金参考**精确相等**（同库同参同 now，容差 0）+ 跨天 Good 稳定度必增哨兵；
  3. **S2 整体时间平移不变性**：同一剧本在 T0 / T0+10 天 / T0+100 天三个基准各跑一遍，各轮相对结果完全一致（整日平移下 UTC 日历日取整不变，dateDiffInDays 语义）；
  4. **S4 遗忘链与 leech**：毕业后 [Again,Good]×8，lapses 逐次 +1、每次 Again 后 due=+10m、`isLeech(8)` 恰好触发；
  5. **S5 优化器训练输入链**：buildTrainSet 过滤规则（单次复习/全同日/无跨天前缀排除、delta_t 向下取整、前缀展开）+ 真实 computeParameters（21 维有限权重）+ evaluate（logLoss/rmseBins）+ applyWeights 拒非 21 维/接受 21 维/resetWeights。
- 预览=落库同源（§4.4.3）：每一轮 `preview(card,now)[rating].fsrsState` 与 `next(card,rating,now).fsrsState` 深度相等，随 S1/S4 逐轮断言。

### 新缺陷与修复（M3 审计发现）

| 缺陷 | 严重度 | 位置 | 现象与实锤 | 修复 |
|---|---|---|---|---|
| F7 | 中-高 | `src/lib/fsrs.ts` toFsrsCard/fromFsrsCard | `learning_steps`（ts-fsrs 学习步进索引）未持久化，重建后恒为 0。learning 档第 2 步（+10m）的卡再评 Good：官方语义毕业进 Review（1 天+），应用却永回 +10m（步进归 0 → Good 永远命中最末步），**只有 Easy 能毕业**；Hard 的 next_step 簿记同样归零。新卡首评 Good 是最常见路径，L3 端到端只测单轮故未逃逸检出 | fsrs_json 增 `learningSteps` 全字段往返（§4.4.1 契约补字段，v20）；L5 S1b 哨兵断言毕业语义 |
| F8 | 高（训练必触发） | `electron/optimizer.js` train() | fsrs-rs `evaluate` 对「样本 ≥2 条且**末条 delta_t=0（同日收尾）**」抛 InvalidInput（最小复现：`[3:0,1:0]` FAIL / `[3:0,3:1,1:1]` OK；215 样本中 13 个同日收尾样本全数触发）。真实复习日志中学习/重学步同日恢复是常态，**真实数据训练必报错**；computeParameters 不受影响 | 评估改用可评估子集（≥2 条且末条 delta_t>0），训练集不变；无可用子集时指标为 null（设置页 `?? 0` 兜底显示） |
| 过时断言 | 低 | `tests/fsrs/golden.cjs` L0-1 | 仍断言 `enable_fuzz=true（应用侧）`——v11 修复（F2）前残留，与 §4.4.2「fuzz 锁定 false」矛盾（测试自证自默，13/13 假绿掩盖语义） | 纠正为断言 false；重新生成 golden.json |

### v20 附带变更
- `fsrsEngine.preview/next` 增可选 `now` 参数（缺省真实时间，渲染层行为不变）——M3 时间注入机制。
- 契约 §4.4.1 补记：`elapsed_days/scheduled_days` 无需持久化（源码核对：elapsed_days 由 last_review 现场重算 `AbstractScheduler.init`；scheduled_days 调度器只写不读）。
- CDP 冒烟（真实应用 + 新 dist）：建卡→按 ReviewView 实际链路落库含 learningSteps=1 →读回无损→清理通过（临时脚本已删）。
- 回归结果（v20）：L0 13 ✓ / L1 15 ✓ / L1 补强 6 ✓ / L2 23 ✓ / L5 417 ✓ / L4 空集（库内无 FSRSTEST 卡，重放工具可用）。

### 记录在案的接受项（不改，仅记录）
- request_retention 固定 0.9 不可调（官方建议允许 0.8–0.95 个人化）→ 后续可选池候选。
- ts-fsrs 返回的 ReviewLog 被弃用：自建 review_logs（card_id/rating/reviewed_at/duration_ms）满足官方「持久化评分历史」与优化器最小输入；日志+引擎可重放复原（audit.cjs 即此原理）。
- 优化器权重注入为启动异步（initOptimizerWeights）：理论上注入完成前的首次评分用默认权重，影响一轮且自愈。

---

## v23 批次增补（2026-09-11）：FSRS 数据完整性加固 + 学习日语义

> 经外部评审五轮收敛的加固批次（设计依据：指导文档 v23 §4.4.8-4.4.11 + D20/D21）。核心架构结论：
> ① 优化器 delta_t 弃 floor(24h)，canonical 函数（electron/fsrsTime.js **独立实现**，不 import ts-fsrs）与调度器
> UTC 日历日语义**精确恒等**（oracle=ReviewLog.elapsed_days 行为级对照，依赖升级红灯=触发重新审计）；
> ② 产品学习日切点（settings.app.dayCutoffHour）仅统计口径，绝不进入调度/训练（D21）；
> ③ fsrs_configs 不可变配置快照 + settings.app.fsrsConfigId 指针（D20），废除 fsrsWeights 双事实源；
> ④ review 成功边界 = COMMIT + persist 成功 + IPC 成功（崩溃一致性，非跨层 ACID）。

### 新缺陷与修复（v23）

| 缺陷 | 严重度 | 位置 | 现象 | 修复 |
|---|---|---|---|---|
| F9 | 高 | SettingsPanel「已应用即刻生效」vs fsrs.ts 仅模块加载注入一次 | UI 宣称权重即刻生效，实际无任何热重建路径——apply 后不重启仍用旧参数 | 主进程 apply/reset 提交后广播 `fsrs:configChanged`（事实层发事件，非 UI）→ preload 桥 → fsrs.ts `reloadEngine()` 重建；configId 未变跳过重建；非法配置（非 21 维/enableFuzz≠false）拒绝应用 |
| F10 | 中 | undoLastReview 以「当前 suspended」推断本次评分触发 leech | Good 评分后手动挂起再撤销 → 手动挂起被误解除 | review_logs 增 `leech_before_json` 评分前快照；触发判定复现复习端条件（after.lapses≥8 且评分前非 leech）；撤销精确恢复前置 leech 状态 |
| F11 | 高 | persist() 直接 writeFileSync 覆盖写 | 崩溃/断电可产生半写库文件（card 与 review_log 不一致） | 同目录 tmp + fsyncSync + renameSync 原子替换；失败 throw→IPC reject→UI 封锁评分+「重试保存」（persistNow 纯持久化重试）；启动清残留 tmp；tmp 永远非事实源 |
| 措辞 | — | 「review 成功」定义 | COMMIT 后 persist 失败时内存已提交、磁盘未更新 | 契约锁定：review 成功 = COMMIT + persist 成功 + IPC 成功；崩溃一致性措辞（非跨内存库与文件系统 ACID） |

### 测试矩阵（v23）

- **undo 套件 29/29**：U1-U5（v22 既有）+ U6 篡改卡状态后撤销拒绝（after 一致性不变量在选取层生效）/ U7 F10 回归（手动挂起保持）/ U8 v22 形态旧日志（无 after）不可撤销 / U9 review_seq 唯一+单调+撤销后允许复用。
- **persist 边界套件 14/14**（新增 `tests/persist.test.cjs`）：P1 真实文件系统零 mock 原子写（Windows rename 覆盖替换语义）；P2 writeSync 失败→throw→盘上旧库逐字节未变→persistNow 重试成功；P3 renameSync 失败→旧库完整+tmp 残留；P4 启动清残留 tmp；不变量「任意时刻至少一份完整库」。
- **L5 simulate 451/451**：v20 五组剧本保留 + **S6 时间语义**（L6-A 行为级 oracle 时间矩阵：同日/跨午夜/跨月/跨年/36h/整月/零间隔，canonical==调度器 elapsed 逐点相等；L6-B buildTrainSet delta_t==oracle，跨午夜对=1 抓 floor 分叉；负测试=构造 badCanonicalDeltaT(floor) 证明检测器必红；L6-C 学习日切点语义：cutoff=0 跨午夜为两日、cutoff=4 凌晨算前日、切点穿越、起点一致）+ **S7 参数环境**（播种 tripwire：cfg-default 权重==live ts-fsrs 默认逐位一致；apply B 存量卡 fsrs_json 与 fsrs_config_id 全部未变；cfg-default 行逐字节未变；B 下评分归属 cfg-B；undo 后 config 恢复 fsrs_before_config_id；指纹去重重指；reset 指回；无 update API）+ **S8 F9 热生效**（configId 变更重建且间隔变化/未变跳过/20 维与 enableFuzz≠false 配置拒绝）。
- **L4 audit 升级**：按每条日志 fsrs_config_id 从 fsrs_configs 取完整快照分段构引擎重放；v23 日志逐轮 8 字段对照（due/lastReview 容差=点击延迟级 5s，其余精确）；`--weights` 覆盖。沙盒端到端验证：默认配置评分→apply 优化权重→再评分→重放 2 轮逐轮全对（真实抓出「种子引擎未随指针同步」与「伪造 after 状态」两类不一致，机制有效）。
- **S5a 期望更新**：prefix 卡 delta_t [0,0,1]→[0,0,2]（floor→canonical 语义统一的预期变化）。
- **CDP 冒烟**（真实应用 + 新 dist）：学习日设置读写；fsrs:activeConfig 完整快照（21 维/fuzz=false）；评分落库含 config 与 learningSteps；撤销恢复；F9 推送链路（apply→广播 cfgId→reset→广播 cfg-default→指针回位）；清理干净（临时脚本已删）。
- **回归结果（v23）**：L0 13 ✓ / L1 15 ✓ / L1 补强 6 ✓ / L2 23 ✓ / L5 451 ✓ / L4 空集+沙盒端到端 ✓ / undo 29 ✓ / persist 14 ✓ / M1 45 ✓ / tsc ✓ / dist 重建 ✓。

### 实现期发现与修复（测试抓出）
- `fsrsStatesEqual` 对 `learningSteps: []` 数组做引用比较恒不等——撤销一致性校验失效；改为对象字段 JSON 序列化比较。
- `getLastUndoableReview` 内 after 快照查询误用 `log.id`（应为别名 `logId`）——同批测试抓出修复。
- `electron/fsrsConfig.js` 的 FSRS6_DEFAULT_WEIGHTS 常量首版凭记忆填写与 live ts-fsrs 不符——实测核对修正；S7 播种 tripwire 断言永久防漂移。

### 记录在案的接受项（v23 增补）
- 评分「预览时刻 T1 vs 落库时刻 T2」存在点击延迟级毫秒偏差：due/lastReview 存储值基于 T1、reviewed_at 为 T2——audit 以 5s 容差吸收；跨日界的极端点击延迟（23:59:58 预览/00:00:03 提交）属可接受罕见偏差（before/after 快照记录了事实，审计可复核）。
- persist 失败窗口的崩溃后果 = 丢失窗口期内存变更、回到上一完整盘态（一致但可能丢最近一次评分）——全库快照自愈性质 + M2 每日自动备份兜底。
