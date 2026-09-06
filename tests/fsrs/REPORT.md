# FSRS 调度正确性测试报告

- 测试日期：2026-09-06
- 被测版本：commit b099d8a（含启动双窗口修复、AI 状态行、思考强度设置）
- 测试方法：黄金参考对照法（ts-fsrs 5.4.2 / FSRS-6.0，enable_fuzz=false 作为规范引擎）
- 真实库备份：`%APPDATA%/incremental-reading-dev/library.db.backup-20260906-101221`（测试后已清理 FSRSTEST 卡，未还原必要）

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
