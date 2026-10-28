# BDI 指标与信号注册表（D248）

> 状态：**契约稿（T0 文档先行），实现后由 `scripts/gen-bdi-docs.mjs` 从 `electron/behavior/metrics.js` / `signals.js` 重新生成为逐字一致的版本**。
> 唯一实现依据：`docs/design/BEHAVIOR-DATA-INFRA-D248-v3.md`（§9 / §10）。本文与注册表不一致时 `behavior-catalog-docs` 测试失败。

## 指标注册（`metrics.js`）

每个指标必填：`id / unit / grain / source / coverageKey / definition / nullPolicy / estimatePolicy / additivity / version`。所有 `daily_metrics.metric`、`domain_day` 列、`signal_daily.signal_id` 都有唯一条目；维度/主键不是指标。常量与阈值是产品假设，版本化，调用方不得偷偷改。

| 指标 | 定义 |
| --- | --- |
| `ev:<type>` | 事件计数（n）与 `num` 之和（sum） |
| `attn.active_ms` / `attn.idle_ms` | 规范化 span 的 active/idle |
| `attn.self_ms` / `attn.pushed_ms` / `attn.neutral_ms` | 按 origin/initiative 分桶 |
| `review.answer_ms` | 有效 `review_logs.duration_ms`，负数/非有限/单次 >30min 不计有效时长，另报 invalid_count |
| `review.think_ms` | `review.revealed.dur_ms` |
| `session.foreground_ms` / `session.count` | 窗口焦点累计 / 会话数 |
| `deliberate_production` | 用户明确发起的摘录/批注/手动卡，按 op 去重；AI 确认每根 op 最多记 1，自动生成/导入/sync/unknown 不计 |
| `effort_min` | attention 完整日 = active_min；无 attention 的历史期可提供 answer_min + 手动产出估算（extract 2min/annotation 1min/manualCard 3min），标 estimate；部分覆盖日默认 NULL，另报已观测下界 |
| `engaged` | active_min≥10 或可信 answer_min≥5 或 deliberate_production≥2；任一足量证据可为 1；未达阈值但有缺口→NULL；足够覆盖且未达→0；历史仅 answer 证据标 estimated |
| `progress_chars` | 相对「以前最高已记录位置」的正向推进；首条记录无 baseline→NULL；可能由跳转产生 |
| `covered_chars` | 观测位置并集下界；不是已读字数 |
| `consistency_8w` | 最近 8 个完整 ISO 周，engaged≥2 天的周数/完整可判定周数；当前未完周不计 |
| `pass_rate_28` / `pass_rate_lb_28` | `review_logs` 中当次 `fsrs_before_json.state` 明确为 Review 的有效评分，非 Again 占比与 Wilson 95% 下界；按**主领域独占整数样本**计算，不把加权小数塞入二项公式 |
| `s_growth_med_28` | 有效非 Again 且 `s_before>0`、配置/快照可解析的 `s_after/s_before` 中位数；不等于认知能力 |
| `share_28` / `self_ratio_28` / `depth_28` | 同一来源/版本/基础层；分母 0 → NULL；不跨 level 相加 |

## 日事实口径（`rollup.js`）

- 时间唯一来自规范化 attention；按 surface 分 read/review/xreview/author/browse/other，各桶和 = active。
- `self/pushed/neutral` 分开，三者之和 = active（浮点容差）。
- 评分和 `answer_ms` 来自 `review_logs`，按领域权重 `w` 分配 `answer_ms`；计数只计主领域（整数），不把加权小数塞进 `n_reviews`。
- `review.think_ms` 来自 `review.revealed`；`n_reviews/n_again/...` 来自 `review_logs` 主领域。
- live 创建/批注动作来自成功事件，按实体/生命周期/opId 去重；同一个 highlight/extract 的保存不能经两个 owner 算两次。
- AI 保留卡数是实体产出量，不等于投入；必须明确用户接纳且 120s 误操作窗口已过才称 `ai_kept`，否则 pending/unknown。批量自动生成没有用户确认不能触发 `engaged`。
- `n_items` 是 distinct 材料数，不可跨领域相加；父级 distinct 重新求集合。
- 空值传播：无支持/未覆盖=NULL；完整覆盖下确实无动作=0；除数 0→NULL，不返回 Infinity/NaN。
- 增量结果必须与「清空后全量重建」逐键一致（浮点容差 1e-9），归档日除外。

## 覆盖语义（`coverage.js`）

`capture_intervals.state` ∈ `enabled/disabled/fault/suspend`；能力起点来自首次启用成功时刻，不是第一次事件 `first_seen`。

`coverage_day.state` ∈ `complete/partial/unknown/unsupported/archived`：

- 对某学习日，若该指标采集能力在该日所有应用运行时段已启用、版本支持、无未恢复队列损失/重载/时钟缺口 → `complete`。
- 应用没有运行不等于没在别处学习；本产品的 0 只表示「本应用内无已知动作」，查询返回必须带这句话。
- 首次部署前、禁用期、未洁退出尾部、worker/DB 不可用、丢包 → `partial`/`unknown`。
- 已验证充分证据可把 `engaged` 置 1，即使同日其他时段缺失；没有足量证据时，只有 `complete` 才能判 0，其余 NULL。
- 查询窗口不悄悄裁掉缺失日后仍称完整 28 天：返回 `requestedWindow/observedWindow/knownDays/unknownDays/estimateDays` 及原因。

## 信号注册（`signals.js`）

信号 = 某类可观测行为 × 过滤条件 × 数值函数 × 极性 × 单位。只负责「把行为翻译成按领域、按日的强度原料」，权重由将来功能决定。

| id | 真源与过滤 | 单位/注意 |
| --- | --- | --- |
| open_active | `library.opened`，self_initiated | 去重打开次数 |
| open_pushed | `library.opened`，pushed | 推送打开次数 |
| dwell_active / dwell_pushed | 规范化 attention，分别按来源 | 分钟，不加 answer 分钟 |
| jump_purpose | `reader.jumped`，toc/search/link 等明确方法 | op 次数；不证明理解 |
| extract_made | 成功用户创建事件，实体/op 去重 | 次数，高亮与摘录不重复 |
| annotate | `extract.op` 且 `annotation=true` | 次数 |
| card_manual | 成功用户手动创建，非导入/后台 | 人工动作证据 |
| ai_accept | 明确用户接纳操作 | 确认 op 次数；acceptedCardCount 另字段，不默认累成投入 |
| source_jump | `review.source_opened` | 主动回源次数 |
| explain_ask | `ai.invoked`，explain/ste/translate，用户发起且成功 | 请求次数，失败/取消另计不混 |
| query | 已提交的书架/阅读/浏览查询，过滤空串、同 op 去重 | 次数，关闭原文仍可计 |
| dict_lookup | `dict.lookup` | 次数；不记词（默认） |
| finish_book | `reader.finished` | 到达末尾代理，一书一次 |
| journal_write | `journal.written`，排除 draft 自动保存 | 次数/字数 |
| mindmap_explore | `mindmap.node_action` | 次数 |
| kp_view | `knowledge.viewed` | 次数 |
| skip / extract_defer / card_delete / item_delete | 有效成功动作 | 可能是休息、整理、重复材料；**不自动解释为负面兴趣** |

按学习日衰减：`decayed = Σ value_day × 0.5^(calendarAge/halfLifeDays)`，`halfLifeDays ∈ [1,365]`；未来日/负 age 异常不入默认统计。raw/decayed 保留单位，分钟和次数不能直接相加。

未来消费者如要组合，必须显式提交版本化权重、单位归一、日/op 封顶策略：`score_signed = Σ polarity_s × weight_s × normalized_decayed_s`。**有负值的 signed score 不得直接代入 share 分母**；share 只用于 `p≥0` 的已归一证据，`α=5` 仅是该尺度的平滑强度，prior 在固定域集合上和为 1。本期只交原料，不输出综合兴趣分。
