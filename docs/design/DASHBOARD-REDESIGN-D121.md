# 数据页图表重设计 + 一日时间轴（D122，v48.78）

> 本稿对应已实现的数据页改动，2026-10-09 提交前审查时补齐 GUIDE §4.2 / §8.1 / §9.2 登记。文件沿用原路径以保留既有指针；实际决策号为 D122，与卡片辨析 D121 独立。本次收口补记既有实现，没有把文档先行的遗漏改写成已遵守流程。

## 为什么
旧图表按固定 viewBox 等比缩放、文案坐标写死 → 长标签/图注必然溢出；并有口径错误：
答题时长按「小时 / 5 分钟一箱」统计单卡秒级耗时；节律图只取 8–20 点；领域排名月份标签与数据错位；
队列水位「期初/月末」自相矛盾；漏斗「AI 草稿」恒等于「入队」；图注写死「蓝」而主题色为绿。

## 做了什么
- 渲染层：`src/components/charts/kit.tsx`（量宽→1:1 像素绘制、文字实测+截断、HTML 标题/图例/脚注、悬浮提示）、`charts.tsx`（全部图表）、`Timeline.tsx`（新增）。旧 `swiss.tsx` 删除。
- 配色：theme.css 新增 `--chart-2..6`（深浅各一档）；评分语义色：遗忘=砖红 / 吃力=琥珀 / 通过=焦点色 / 轻松=靛蓝。
- 后端 `getStatsOverview`：durationBins 改 5 秒一箱并剔除 >10 分钟；rhythmGrid 7×24 + rhythmHours；
  domainRank 连续 6 个自然月（rank=0 表示当月无复习）；漏斗四段单调；sourceBooks 库内聚合；
  新增 dueForecast（未来 14 天到期）、queueFlow.overdue 取真实值；completedToday 去 N+1。
  既有字段语义（queueFlow.completed/skipped、readingDays 等）不变；readingDays 窗口 46→90 天。
- 新增 `stats:timeline`（`electron/statsTimeline.js` 纯函数 + `db.getStatsTimeline`）：阅读/摘录/复习/制卡/日记 → 时段块。
  口径：同类事件间隔 ≤3~5 分钟并块；作答耗时夹 [3s,180s]；瞬时事件至少按 30 秒计；活跃时长=区间并集；按学习日（日切点）归属。
- 新组件「一日时间轴」：日视图（五泳道甘特 + 现在游标 + 时间分配）、近 7 天视图（点某天下钻）、聚焦/全天切换。
  布局 syncHidden 现在把新组件插到默认顺序的前驱之后，老用户升级后能看到。

## 接口与口径
- `stats:overview` 仍为本地只读聚合；`sourceCards` / `rhythmEvents` 退役，分别由库内聚合的 `sourceBooks` / 全量 24 小时桶 `rhythmHours` 替代。答题分布为 12 箱，每箱 5 秒，末箱包含 ≥55 秒；只纳入 0 < 耗时 ≤600000ms 的记录，同时输出中位数与 P90。领域排名带连续六个自然月轴 `domainRankMonths` 和各领域 `counts/ranks`，rank=0 表示该月没有复习。
- 漏斗使用近 90 天新建卡的同一 cohort，四段为新建→已开始学→长期复习中→已巩固（review 状态且 stability>21 天）；旧 `drafts/entered` 兼容字段仍等于 cohort 总数，不再作为 AI 草稿流转率展示。`dueForecast` 为含今天的未来 14 个学习日到期数（已学卡，不计新卡），逾期数为 due 早于今日日切点的活跃卡数；同源延后不改变预测中的真实 due。
- `stats:timeline({endDay?, days?})` → `{now, cutoffHour, days:[{date, blocks, totals, activeMs, first, last, longestMs}]}`；endDay 是目标学习日内的时间戳，默认现在；days 归一至 1–31，默认 1。preload `statsAPI.timeline` → `src/lib/stats.ts` → Timeline 组件；无 schema、设置键与调度写入新增。
- 五类输入分别为未删除书的阅读位置事件、未删除摘录/高亮创建、卡片评分与摘录 advance/postpone/graduate 操作、未删除卡创建、已发送且未删除日记（按 created_at）。阅读位置按相邻正增量计字，窗口之前的最后位置作首条基准。时间块为行为估算：阅读区间=事件时刻±15 秒；同类区间间隔阈值阅读/日记 5 分钟、摘录/制卡 4 分钟、复习 3 分钟；复习作答区间夹为 3–180 秒；块时长最少 30 秒；activeMs 为估算块区间并集。它不改变日记 entry_date 自然日契约、不写 FSRS/review_logs、不作为知识掌握证据。

## 验证（2026-10-09 提交前复核）
- 已执行：`node tests/stats-timeline.test.cjs` 20/20；`npx tsc --noEmit` 0 错误；`npm run build` 成功（仅既有动态 import/chunk 大小提示）；`git diff --check` 通过。
- 已执行相关公共闸门：F06 28/28（Electron）、F20 26/26（Electron）、F11 17/17（node）；F60 命令表 15/15 一致，但应用在沙箱中提前退出 code=2147483651，未完成动态键位矩阵。
- 本次文档收口后另跑 F11；F21 IPC 对账、r2-smoke 图表 class 断言、辨析 GUI 冒烟、GUI 全量回归与 main 基线对照未在这份复核中完成，留待合并验收。不得据上述静态/纯函数检查声称 GUI 已通过。
