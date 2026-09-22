# 全流程测试长跑报告

> 由 `node tests/flows/report.cjs` 生成于 2026-09-22 06:18:04Z。数据源 `tests/flows/results/history.jsonl`（16476 条运行记录）。
> 分支 `test/flow-coverage`；设计见 [PLAN.md](PLAN.md)，缺陷见 [DEFECTS.md](DEFECTS.md)。

## 1. 窗口与总量

- 首次记录：2026-09-21 17:01:00Z　最近记录：2026-09-22 06:18:01Z　跨度 **13.28 小时**
- 累计流程运行：**16476 轮次**；累计断言执行 **496,482 条**（通过 471,991）
- 编排器：`node tests/flows/run.cjs --hours 7.4 --gap 20`（每轮重扫 `tests/flows/f*.cjs`，新流程自动加入）

## 2. 各流程累计与现行状态

「现行」= 只统计该流程文件最后一次修改之后的运行，避免把调试期历史算成今天的状态。

| 流程 | 运行 | 现行运行 | 现行判红 | 现行失败断言 | 已知缺陷触发 | 崩溃(全程) | 时长 min–max | 指南依据 |
|---|---|---|---|---|---|---|---|---|
| F01 黄金路径全旅程 | 14 | 0 | 0 | 0 | 0 | 0 | 33–70813ms | §6.1 §7.1.4 §6.2 §5.2 |
| F02 导入格式矩阵与锚点反查 | 748 | 36 | 0 | 0 | 0 | 4 | 235–1055ms | §4.2 §6.1 §6.2 §7.2 |
| F03 复习调度与数据守恒 | 1014 | 36 | 0 | 0 | 108 | 2 | 144–1352ms | §4.4.5 §4.4.9 §4.4.10 §4.2-20 §4.16 §7.2 §7.1.4 |
| F04 崩溃与恢复 | 758 | 36 | 0 | 0 | 0 | 5 | 169–797ms | §4.4.8 §4.4.9 §7.1.8 §7.2 §9.1 M15 v48.13 |
| F05 备份—恢复—升级生命周期 | 778 | 36 | 0 | 0 | 0 | 1 | 161–1070ms | §9.1 M2 §7.2 §7.6 §4.18 §4.4.9 §7.1.4 |
| F06 AI 制卡契约与闸门 | 784 | 36 | 0 | 0 | 36 | 0 | 153–1461ms | §6.3.1 §6.3.4 §6.3.5 §4.16 §7.1.3 §7.4 §4.18 |
| F07 用户记忆与隐私边界 | 766 | 36 | 0 | 0 | 36 | 7 | 128–1006ms | §4.18 §6.7 §7.5 §7.6 §7.2 |
| F08 材料知识导图：版本模型、隔离性与确定性 | 740 | 35 | 0 | 0 | 0 | 8 | 208–953ms | §4.19 D41-④ D45 §4.2-24 |
| F09 表现层与设计系统契约 | 764 | 35 | 0 | 0 | 0 | 1 | 18–60ms | §7.1.6 §5.1 §5.3 §5.4 docs/swiss-international-style.md D50 |
| F10 规模、长稳与性能棘轮 | 806 | 94 | 0 | 0 | 0 | 1 | 2219–9743ms | §7.1.8 §9.1 M15 v48.10 §4.2-20 §7.2 §6.4 |
| F11 指导文档↔代码一致性 | 647 | 35 | 0 | 0 | 140 | 5 | 10–512ms | §7.1.5 §7.3 §7.4 §8.1 §8.3 §4.1 |
| F12 时间语义一致性 | 606 | 45 | 0 | 0 | 0 | 0 | 204–825ms | §4.12-4 §4.4.4 §4.16 §4.18 §6.5 §7.1.7 |
| F13 异常输入与数据卫生 | 626 | 76 | 0 | 0 | 152 | 40 | 164–3088ms | §7.2 §4.2-20 §7.4 §4.16 §6.5 §4.18 §7.5 |
| F14 三十天使用史演进 | 530 | 43 | 0 | 0 | 0 | 0 | 2087–4870ms | §4.2-20 §4.16 §6.2 §4.4.9 §6.3.6 |
| F15 幂等与重放矩阵 | 510 | 34 | 0 | 0 | 0 | 3 | 297–1605ms | §4.2-24 §4.6 §4.4.9 §4.16 §4.4.10 §6.4 §7.2 |
| F16 安全与信任边界 | 503 | 34 | 0 | 0 | 34 | 0 | 20–38ms | §7.5 §7.6 §7.1.3 §7.2 §6.2 §4.18 |
| F17 词典数据面隔离与来源生命周期 | 492 | 31 | 0 | 0 | 0 | 3 | 374–1134ms | §7.4 v32②③④ §4.2 §7.1.8 |
| F18 设置项生效矩阵与孤儿设置 | 543 | 76 | 0 | 0 | 304 | 3 | 195–4100ms | §7.1.3 §7.4 §4.16 §4.18 §6.5 §7.2 §7.6 |
| F19 只读清单与分页边界矩阵 | 506 | 19 | 0 | 0 | 38 | 0 | 309–1522ms | §7.1.3 §7.6 §7.2 §4.2-20 §6.5 §9.1 M15 |
| F20 键盘命令契约 | 423 | 34 | 0 | 0 | 170 | 1 | 180–2762ms | §9.1 M4 §4.2-2 §6.5 §7.1.3 §6.1 |
| F21 进程间桥面对账 | 410 | 36 | 0 | 0 | 36 | 0 | 22–48ms | §4 接口清单 §7.5 §7.1.3 §4.18 §9.1 M2 |
| F22 书架视图组织契约 | 399 | 34 | 0 | 0 | 0 | 1 | 295–876ms | §5.4 §4.2-3 §4.2-20 §6.2 §9.1 M2 D51 |
| F23 阅读进度与阅读字数契约 | 389 | 19 | 0 | 0 | 57 | 1 | 419–1560ms | §6.1 §6.2 §5.4 §7.1.3 §7.2 §7.1.4 §9.1 M15 |
| F24 指南章节覆盖面自评 | 375 | 36 | 0 | 0 | 0 | 1 | 10–26ms | §7.1.4 §7.3 §7.1.5 §9.1 |
| F25 资源落盘与文件边界 | 319 | 34 | 0 | 0 | 136 | 0 | 245–836ms | §7.5 §6.1 §7.2 §7.1.4 §9.1 M2 §9.1 M6 |
| F26 显示文本口径对账 | 304 | 36 | 0 | 0 | 72 | 3 | 134–417ms | §5.4 §6.2 §4.12-4 §6.5 §7.1.3 §7.1.6 |
| F27 克制红线：未实现层不得偷跑 | 271 | 36 | 0 | 0 | 0 | 0 | 40–74ms | §6.6.4 §6.6.5 §6.6.6 §6.6.7 §4.10-3 §1.9 §1.10 D29 §6.3.8 §7.2 |
| F28 五处读数同源对账 | 269 | 44 | 0 | 0 | 0 | 0 | 222–837ms | §4.2-20 §4.16 §4.4.9 §6.2 §4.12-4 §7.2 |
| F29 全局序不变量 | 262 | 8 | 0 | 0 | 0 | 0 | 213–781ms | §4.4.9 §4.4.10 §4.2-20 §6.6.6 §7.2 §7.1.4 |
| F30 导入解析器层 | 242 | 36 | 0 | 0 | 36 | 6 | 267–6270ms | §6.1 §9.1 M6 §9.1 M6-1 §9.1 M6-2 §4.2 §7.1.3 §7.5 |
| F31 全库不变量体检 | 246 | 18 | 0 | 0 | 36 | 9 | 185–846ms | §4.2 §4.1 §7.2 §4.2-20 §9.1 M15 |
| F32 写入口存在性矩阵与假成功清点 | 216 | 34 | 0 | 0 | 136 | 0 | 541–1185ms | §7.2 §7.1.3 §7.1.4 §4.2 §9.1 M15 |
| F33 落盘往返保真 | 216 | 44 | 0 | 0 | 0 | 3 | 202–781ms | §7.2 §7.1.4 §4.2 §4.16 §4.4.9 §4.12-4 |

## 3. 现行仍红的断言（逐条）

### F01 · 黄金路径全旅程

累计判红 8 轮（其中现行版本 0 轮），崩溃 0 次

- [K3 添加材料 → 书架出现该书（§6.1 主旅程第一环）] 界面书架上看得见这本书
  - 期望 true 实际 false
- [K4 打开书 → 正文与目录（§6.2 阅读器）] 阅读器渲染出正文段落
  - 期望 ">2" 实际 1
- [K5 选区 → 制卡（§6.1「制卡与摘录记录选区锚点」）] 选区后出现制卡/摘录动作（主旅程不断链）
  - 期望 true 实际 ""
- [K5 选区 → 制卡（§6.1「制卡与摘录记录选区锚点」）] 制卡入口可达（未能自动完成保存，见 record）
  - 期望 true 实际 {"clickedMake":false,"editor":false}
- [K6 连续复习与撤销（§6.2 复习页 / §4.4.9）] 评分在磁盘上留下一条复习日志
  - 期望 "≥1" 实际 0
- [K7 重启不丢数据（§7.1.4 验收线）] 重启后卡片仍可读（不少于旅程开始时的量）
  - 期望 "≥1" 实际 0
- [K5 选区制卡（§6.1「制卡与摘录记录选区锚点」）] 选区后出现制卡/摘录动作（synthetic 选区未触发时以 m5.gui 的真实事件序列为准，不作产品缺陷）
  - 期望 true 实际 ""
- [K4 点开书 → 正文渲染（§6.2 阅读器）] 点书后进入阅读视图（阅读器容器在场）
  - 期望 true 实际 false

### F02 · 导入格式矩阵与锚点反查

累计判红 11 轮（其中现行版本 0 轮），崩溃 4 次

- [I2 书目 ↔ 文档双向反查（§4.2 / IPC library:doc、library:itemByDoc）] 文档一律挂到某书目（无孤儿文档）
  - 期望 0 实际 null
- [I2 书目 ↔ 文档双向反查（§4.2 / IPC library:doc、library:itemByDoc）] 不存在指向已消失文档的卡片
  - 期望 0 实际 null
- [I6 删书只软删书目，卡与摘录留在原地（§7.2 L869 + 用户资产观）] 书目不再出现在业务列表
  - 期望 false 实际 null
- [I6 删书只软删书目，卡与摘录留在原地（§7.2 L869 + 用户资产观）] 删书不影响其他书目
  - 期望 7 实际 8
- [I6 删书只软删书目，卡与摘录留在原地（§7.2 L869 + 用户资产观）] 反查已删书目的文档返回空（跳转原文不会指向已删书）
  - 期望 null 实际 null

### F03 · 复习调度与数据守恒

累计判红 4 轮（其中现行版本 0 轮），崩溃 2 次

- [S3 同源延后＝队列视图，零写库（§4.16 L316–324 / §4.2-20 L145）] 其余全部进 deferred（不静默少卡）
  - 期望 3 实际 2
- [S3 同源延后＝队列视图，零写库（§4.16 L316–324 / §4.2-20 L145）] deferred 带可读原因（§4.2-20）
  - 期望 "非空字符串" 实际 [{"siblingKey":"act:flowtest-860094623","kind":"revealed","siblingCardId":"c9e9f8d7-a0aa-415e-a98b-1293715f4566","siblingFront":"FLOWTEST SIB3 问题"},{"siblingKey
- [S5 跳过与撤销的账目边界（§4.4.9 L105 / §6.2 L537）] 撤销物理删除日志（训练输入自动干净）
  - 期望 0 实际 1
- [S6 FSRS 参数环境：不可变 + 指纹去重 + 不回改卡（§4.4.10 L106/L173）] 配置表只追加不改写（行数=3）
  - 期望 3 实际 1
- [S7 软删除与关联收敛（§7.2 L869）] 业务查询不再返回该卡
  - 期望 false 实际 false
- [S7 软删除与关联收敛（§7.2 L869）] 该卡 open issue 被收口
  - 期望 0 实际 0
- [S9 重启不丢数据（§7.1.4 L858 / §7.2 即时落盘）] 启动时清理残留 tmp（§4.4.8 db.js:210）
  - 期望 false 实际 false
- [S3 写库函数逐个即时落盘矩阵（§7.2 L874「每次落库即落盘」）] 全部写库函数即时落盘（日记防抖例外不在本表）
  - 期望 "全部落盘" 实际 ["insertFsrsConfig","createKnowledgePoint(抛错:知识点名称为空)"]
- [S3 写库函数逐个即时落盘矩阵（§7.2 L874「每次落库即落盘」）] 草稿不产生正式条目
  - 期望 1 实际 2
- [S3 写库函数逐个即时落盘矩阵（§7.2 L874「每次落库即落盘」）] 发送后条目落盘（flush 语义生效）
  - 期望 "> 草稿态" 实际 {"id":"5fb51e8d-227f-4bb6-b544-e9f8d15bbc1f","entryDate":"2026-09-22","contentMarkdown":"FLOWTEST 发送2887903075","source":"capture","isDraft":false,"createdAt":1
- [S4 同源延后＝队列视图，零写库 + 额度回收（§4.16 L316–324/L331）] 挂起卡不进队列
  - 期望 false 实际 false
- [S6 跳过与撤销账目（§4.4.9 L105 / §6.2 L537）] 跳过只动 review_skips
  - 期望 "review_skips" 实际 "cards,review_skips"
- [S7 FSRS 参数环境不可变（§4.4.10 L106/L173）] 配置表只追加（cfg-default + w1 = 2 行）
  - 期望 2 实际 3
- [S9 重启不丢数据 + 二次 initDb 幂等（§7.1.4 L858）] 第二次 initDb 不重复播种参数环境
  - 期望 2 实际 3

### F04 · 崩溃与恢复

累计判红 12 轮（其中现行版本 0 轮），崩溃 5 次

- [G5 运行中被关闭 → interrupted 而非 failed（§9.1 M15 v48.13 重启续跑）] 超时 running 收敛为 interrupted
  - 期望 "interrupted" 实际 "running"
- [G5 运行中被关闭 → interrupted 而非 failed（§9.1 M15 v48.13 / D47 重启续跑）] 极小阈值被钳到 60 秒下限（3 分钟内的行仍安全）
  - 期望 "running" 实际 "interrupted"
- [G5 运行中被关闭 → interrupted 而非 failed（§9.1 M15 v48.13 / D47 重启续跑）] 0 秒龄的运行行仍是 running（下限生效）
  - 期望 "running" 实际 null

### F05 · 备份—恢复—升级生命周期

累计判红 8 轮（其中现行版本 0 轮），崩溃 1 次

- [B1 备份内容清单（§9.1 M2 / §4.18 L396 / §7.6 L919）] 备份含 settings.json
  - 期望 true 实际 false
- [B1 备份内容清单（§9.1 M2 / §4.18 L396 / §7.6 L919）] 默认备份绝不含 ai-config.json（§7.6 L919 禁区）
  - 期望 false 实际 []
- [B1 备份内容清单（§9.1 M2 / §4.18 L396 / §7.6 L919）] meta 记录数据规模与实际一致
  - 期望 "cards ≥ 播种数" 实际 null
- [B2 恢复后表级逐行等值（§7.1.4 L858 / §7.1.8 只能重启换入）] applyPendingRestore 换入生效
  - 期望 true 实际 {"restored":["library.db","assets","memory"],"meta":{"app":"incremental-reading-dev","format":1,"label":"manual","createdAt":1790011691876,"includesAIConfig":fa
- [B2 恢复后表级逐行等值（§7.1.4 L858 / §7.1.8 只能重启换入）] 换入后 pending 标记被清除
  - 期望 false 实际 false
- [B2 恢复后表级逐行等值（§7.1.4 L858 / §7.1.8 只能重启换入）] settings 随备份回来（app 段非空）
  - 期望 true 实际 null
- [B5 旧形态库升级：补列不丢事实、旧日志不可撤销（§4.4.9 L172 / §7.2 L870）] 旧日志不可撤销（§4.4.9：无 before/after 不得恢复）
  - 期望 "拒绝" 实际 {"ok":true,"card":{"id":"415619af-e621-4d9c-ab62-27319f5ebc79","noteText":"F05 卡 0","cardType":"qa","clozeOrds":[],"cardOrd":0,"frontMarkdown":"F05 问题 0","backM
- [B5 旧形态库升级：补列不丢事实、旧日志不可撤销（§4.4.9 L172 / §7.2 L870）] review_seq 稠密单调（回填自 rowid，撤销按它排序）
  - 期望 true 实际 [0,1]
- [B2 恢复后表级逐行等值（§7.1.4 L858 / §7.1.8 只能重启换入）] 换入后绝不含 ai-config（未勾选就不该回来）
  - 期望 false 实际 ["library.db","assets","memory","settings.json"]

### F06 · AI 制卡契约与闸门

累计判红 7 轮（其中现行版本 0 轮），崩溃 0 次

- [A1 提示词播种：默认唯一 + 白名单封闭（§6.3.1 L549 / §7.4 L898）] 每个 scope 恰有一个默认版本
  - 期望 "无异常" 实际 ["card-occlusion"]

### F07 · 用户记忆与隐私边界

累计判红 16 轮（其中现行版本 0 轮），崩溃 7 次

- [D1 总开关默认关闭（§4.18 L358 / §6.7 L830：默认 false 是 consent 纪律）] 非法 enabled 不视为开启
  - 期望 true 实际 false
- [D3 关闭/无内容 = 零注入零请求（§6.7 L840）] 空字符串同样不产生注入块
  - 期望 null 实际 {"block":"【用户记忆（仅用于情境接地——R20：只作应用卡情境与助记生活线索；不得作为答案或事实来源；无贴合处境必须省略并输出 memoryRef: null）】\n----- core.md（长期稳定事实）-----\n（空）\n----- index.md（生活域 → 主题目录）-----\n（空）\n-
- [D3 关闭/无内容 = 零注入零请求（§6.7 L840）] 注入块受预算约束
  - 期望 "远小于原始三块" 实际 {}
- [D3 关闭/无内容 = 零注入零请求（§6.7 L840）] 含 R20 使用约束抬头
  - 期望 true 实际 false
- [D3 关闭/无内容 = 零注入零请求（§6.7 L840）] 超预算时明示截断而非静默丢内容
  - 期望 true 实际 false
- [D4 memoryRef 必须逐字命中，否则标存疑（§4.18 L396–398 / R20）] 逐字子串命中
  - 期望 true 实际 false
- [D6 生活域封闭集合与用量口径（§4.18 L382、§6.7）] usageStats 不虚构不存在的主题文件
  - 期望 true 实际 "{\"core\":{\"chars\":267,\"tokens\":141},\"index\":{\"chars\":196,\"tokens\":107},\"topics\":[],\"totals\":{\"chars\":463,\"tokens\":248}}"
- [D6 生活域封闭集合与用量口径（§4.18 L382、§6.7）] usageStats 统计到真实主题文件（不虚构也不漏计）
  - 期望 true 实际 "{\"core\":{\"chars\":296,\"tokens\":153},\"index\":{\"chars\":196,\"tokens\":107},\"topics\":[],\"totals\":{\"chars\":492,\"tokens\":260}}"

### F08 · 材料知识导图：版本模型、隔离性与确定性

累计判红 18 轮（其中现行版本 0 轮），崩溃 8 次

- [J3 抽取快照正文不入库，只存 hash（D41-④ / §4.19 L444）] runs 表不含抽取正文（只该有 hash/计数）
  - 期望 true 实际 "[{\"id\":\"4affe018-ac2c-4714-8682-f10d3b6e2c27\",\"user_id\":\"local-user\",\"document_i"
- [J6 结构校验与度量确定性（§4.19 L412 图先于图示 / 契约校验）] 成环结构被拒绝（has_part 不允许环）
  - 期望 "有 error" 实际 null
- [J6 结构校验与度量确定性（§4.19 L412 图先于图示 / 契约校验）] 悬空父节点被检出
  - 期望 "有诊断" 实际 {"ok":false,"title":"材料知识导图","nodes":[],"dropped":[{"index":0,"id":"n0-orp-2159973632","reason":"缺 title"},{"index":1,"id":"n1-orp-2159973632","reason":"缺 title
- [J6 结构校验与度量确定性（§4.19 L412 图先于图示 / 契约校验）] 重复节点 id 被检出
  - 期望 "有 error" 实际 null
- [J6 出层契约校验与确定性（§4.19 契约校验 / L412 确定性）] 合法结构全数保留
  - 期望 3 实际 1
- [J6 出层契约校验与确定性（§4.19 契约校验 / L412 确定性）] 合法结构无丢弃
  - 期望 0 实际 2
- [J6 出层契约校验与确定性（§4.19 契约校验 / L412 确定性）] 缺 title 的节点被丢弃
  - 期望 1 实际 2
- [J6 出层契约校验与确定性（§4.19 契约校验 / L412 确定性）] 重复 id 只留第一个
  - 期望 1 实际 0
- [J6 出层契约校验与确定性（§4.19 契约校验 / L412 确定性）] 越界枚举不整节点丢弃（宽容降级）
  - 期望 1 实际 0
- [J6 出层契约校验与确定性（§4.19 契约校验 / L412 确定性）] 越界枚举被置空而非照收
  - 期望 null 实际 null
- [J6 出层契约校验与确定性（§4.19 契约校验 / L412 确定性）] 标题相同的节点能被映射上（重映射不丢锚）
  - 期望 true 实际 "{}"
- [J6 出层契约校验与确定性（§4.19 契约校验 / L412 确定性）] 空输入返回空映射
  - 期望 [] 实际 {}
- [J6 出层契约校验与确定性（§4.19 证据强制 / L412 确定性）] 缺 title 的节点被丢弃
  - 期望 1 实际 2
- [J6 出层契约校验与确定性（§4.19 证据强制 / L412 确定性）] 重复 id 只留第一个
  - 期望 1 实际 0

### F09 · 表现层与设计系统契约

累计判红 8 轮（其中现行版本 0 轮），崩溃 1 次

- [E6 指南锁死的版面数字（§5.3 补 2px 半档 / §5.4 动作条 40px）] applyAccent 写入 body 而非只写 :root（780ea84 修复不回退）
  - 期望 true 实际 false
- [E7 书墙网格与空态两条例外不得回退（docs/swiss-international-style.md「画廊 / 状态设计」，正本 §5.3/§5.4）] 吸顶工具条五件套齐（计数 · 视图 · 密度 · 排序 · 主行动在右）
  - 期望 "五件套" 实际 {"sticky":true,"toolbar":false,"视图":true,"密度":true,"排序":true}
- [E8 工具条退让阶梯必须单调、焦点陷阱必须挂在 dialog 上（§5.3 阶梯 / §5.4 D51 / D50 键盘可达）] D50 承诺的模态焦点陷阱量级仍在（≥8 个面板）
  - 期望 "≥8" 实际 0

### F10 · 规模、长稳与性能棘轮

累计判红 3 轮（其中现行版本 0 轮），崩溃 1 次

- [H5 规模操作全程守恒 + 内存增长] 再次落盘不改变任何行（persist 幂等）
  - 期望 "{}" 实际 "extracts(+0/-0/~1)"
- [H1 规模播种（每轮规模随种子浮动）] 卡全部入库
  - 期望 498 实际 1045
- [H1 规模播种（每轮规模随种子浮动）] 摘录全部入库
  - 期望 166 实际 348
- [H5 规模操作全程守恒 + 内存增长] 卡数仍等于播种数
  - 期望 498 实际 1045
- [H6 连写六轮后不留临时文件，主库只有一个真源（§4.4.8 tmp+fsync+rename）] 连写六轮不改变行数（只重写文件）
  - 期望 498 实际 1045

### F11 · 指导文档↔代码一致性

累计判红 23 轮（其中现行版本 0 轮），崩溃 5 次

- [L1 文档指向的测试文件与源码文件必须存在（§7.3 是合同不是愿望清单）] 文档不指向不存在的文件
  - 期望 "全部存在" 实际 ["vendor/kpScopes.js","electron/growth.js","src/lib/growth.ts","tests/m13.test.cjs","tests/m13.gui.mjs"]
- [L2 「§x.y」交叉引用都能落到真实小节] 无悬空 § 引用
  - 期望 "无悬空" 实际 ["72","73","74","7.7","0","87","71","6","7","9","10","58","59","11","21","13","53","12","20","14","15","16","17","18","19","44","46","47","48","22","25","64","2
- [L7 文档点名的 IPC 通道在代码里存在（§4 接口抽象是可调用清单）] 非 memory 族的通道名都不悬空（新增漂移即刻可见）
  - 期望 "无" 实际 ["library:pickEbook","library:pickHtml"]
- [L8 标注「未实现」的能力不得悄悄长出半成品（反向漂移）] K3 探针卡运行表 probe_runs（未实现） 不出现在实现代码里
  - 期望 "无痕迹" 实际 ["electron/prompts.js"]
- [L9 §7.3 点名的每个测试文件都在位（承诺的回归必须跑得动）] 点名的测试文件全部存在
  - 期望 "全部在位" 实际 ["tests/m13.test.cjs","tests/m13.gui.mjs"]
- [L9 §7.3 点名的每个测试文件都在位（承诺的回归必须跑得动）] 既有套件都保留「// 运行：」头（node/electron 分流的权威依据）
  - 期望 "都有" 实际 ["tests/reader.engine.mjs","tests/undo.test.cjs","tests/persist.test.cjs","tests/m1.cards.bundle.cjs","tests/m1.gui.mjs","tests/m5.occlusion.bundle.cjs","tests/
- [L1 文档指向的文件必须存在（§7.3 是合同不是愿望清单）] 文档不指向不存在的文件
  - 期望 "全部存在" 实际 ["vendor/kpScopes.js","electron/growth.js","src/lib/growth.ts","tests/m13.test.cjs","tests/m13.gui.mjs"]
- [L2 「§x.y」引用的顶级章节必须存在] 无引用到不存在的章
  - 期望 "无悬空" 实际 ["20","15","16","17","18","19","44","46","47","48","64","61","49","50","11.5"]
- [L7 文档点名的 IPC 通道在代码里存在（§4 接口抽象是可调用清单）] 文档里的通道名不用 camelCase 混写（会误导实现）
  - 期望 "无混写" 实际 ["cards:updateLeech","mindmap:pendingRuns","shell:openExternal","assets:saveImage","dict:lookupLocal","cards:lastUndoableReview","cards:undoReview","fsrs:config
- [L9 §7.3 点名的测试文件都在位且带运行时分流头] 点名的测试文件全部存在
  - 期望 "全部在位" 实际 ["tests/m13.test.cjs","tests/m13.gui.mjs"]
- [L9 §7.3 点名的测试文件都在位且带运行时分流头] 每个套件都保留「// 运行：」头（node/electron 分流的唯一权威）
  - 期望 "都有" 实际 ["tests/undo.test.cjs","tests/persist.test.cjs","tests/m12.test.cjs","tests/m8.test.cjs","tests/k1.test.cjs","tests/m8b.test.cjs","tests/k2a.test.cjs","tests/k2
- [L1 文档指向的文件必须存在（§7.3 是合同不是愿望清单）] 描述现状的段落不指向不存在的文件
  - 期望 "全部存在" 实际 ["vendor/kpScopes.js","electron/growth.js","src/lib/growth.ts","tests/m13.test.cjs","tests/m13.gui.mjs"]

### F12 · 时间语义一致性

累计判红 5 轮（其中现行版本 0 轮），崩溃 0 次

- [M6 streak 按学习日连续（§6.2 统计）] 连续三天有学习记录时 streak ≥ 3
  - 期望 "≥3" 实际 1
- [M6 streak 按学习日连续（§6.2 统计）] 抽掉中间那天后 streak 缩短（断档必须如实反映）
  - 期望 "<1" 实际 1

### F13 · 异常输入与数据卫生

累计判红 54 轮（其中现行版本 0 轮），崩溃 40 次

- [P1 损坏 JSON 列：队列与统计一致跳过、不抛（§4.2-20 L330）] 损坏行不导致队列/统计抛异常
  - 期望 "不抛" 实际 "malformed JSON"
- [P1 损坏 JSON 列：文档承诺「一致跳过」，实测按列分叉（§4.2-20 L330）] 损坏行不导致队列抛异常
  - 期望 "ok" 实际 "THROW:malformed JSON"
- [P1 损坏 JSON 列：文档承诺「一致跳过」，实测按列分叉（§4.2-20 L330）] 损坏行不导致统计抛异常
  - 期望 "ok" 实际 "THROW:malformed JSON"
- [P1 损坏 JSON 列：文档承诺「一致跳过」，实测按列分叉（§4.2-20 L330）] 损坏行不导致卡片浏览抛异常
  - 期望 "ok" 实际 "THROW:malformed JSON"
- [P3 priority / tags / domain 越界值归一（Number()||默认）] 落库 priority 全在 0–100（越界被归一）
  - 期望 true 实际 "-9999,1000000000,50,37.5,50,50"
- [P5 日记非法日期与脏时间戳（§6.5 L733）] 落库 entry_date 只能是合法日期串或空（不得写 'abc'）
  - 期望 true 实际 "[\"12345678901234\",\"2026-02-30\",\"2026-13-45\",\"2026-3-5\",\"abc\"]"

### F14 · 三十天使用史演进

累计判红 9 轮（其中现行版本 0 轮），崩溃 0 次

- [Q2 连续 30 天复习史（Good 翻倍 / 每 7 次一天 Again）] 没有哪天爆仓（单日放行 ≤ 队列上限 40）
  - 期望 "≤40" 实际 73
- [Q2 连续 30 天复习史（Good 翻倍 / 每 7 次一天 Again）] Good 链的间隔不缩短（除非 Again 重置）
  - 期望 0 实际 null
- [Q3 无饥饿 + 账目守恒（§4.2-20 唯一口径 / §4.4.9 日志账）] 没有卡被永久饿死（30 天里至少排上一次）
  - 期望 0 实际 null
- [Q4 遗忘 8 次自动挂起并退出队列（§6.2 L595）] 确有卡因遗忘达阈值而挂起（机制生效）
  - 期望 ">0" 实际 0
- [Q5 最后一天撤销，账本与排期回到撤销前（§4.4.9）] 撤销成功并复原八字段
  - 期望 {"state":"review","due":1793993974652,"lapses":2,"stability":32,"difficulty":6.200000000000003,"reps":10,"lastReview":1792611574652,"learningSteps":[]} 实际 {"state":"review","due":1792611574652,"lapses":2,"stability":16,"difficulty":6.3000000000000025,"reps":9,"lastReview":1791920374652,"learningSteps":[]}
- [Q4 遗忘 8 次自动挂起并退出队列（§6.2 L595）] 挂起卡不再出现在队列（含一年后）
  - 期望 false 实际 "仍出现"
- [G7 热力图日界必须整齐划一（§4.12-4 自然日 / §4.4.4 复习记录）] 热力图天数在合理窗口
  - 期望 "30–120 天" 实际 182

### F15 · 幂等与重放矩阵

累计判红 3 轮（其中现行版本 0 轮），崩溃 3 次

- [T5 重复挂起与重复处理不产生双份事实] 处理记录不会翻倍（open issue 归零后保持）
  - 期望 0 实际 1
- [T6 重复删除不产生副作用（§7.2 软删除）] 重复删除对表零增量
  - 期望 "{}" 实际 "cards(+0/-0/~1)"
- [T6 重复删除不产生副作用（§7.2 软删除）] 重复删书同样零增量
  - 期望 "{}" 实际 "library_items(+0/-0/~1) documents(+0/-0/~1)"

### F16 · 安全与信任边界

累计判红 4 轮（其中现行版本 0 轮），崩溃 0 次

- [U4 明文 Key 不进渲染层、不进日志、不入默认备份（§7.5 L911）] 主进程不把 Key 写进日志
  - 期望 0 实际 null
- [U4 明文 Key 不进渲染层、不进日志、不入默认备份（§7.5 L911）] 渲染层日志不打 Key
  - 期望 0 实际 null
- [U6 不可信内容的注入面（§7.2 L872 contentEditable 教训同源：外部 HTML 必须先净化）] 无 eval / new Function（动态执行外部内容是硬红线）
  - 期望 0 实际 null
- [U6 不可信内容的注入面（§7.2 L872 contentEditable 教训同源：外部 HTML 必须先净化）] 无 srcdoc 直插外部 HTML
  - 期望 0 实际 null
- [U8 遥测/出错上报的白名单纪律（§7.6：记忆、卡片正文、Key、绝对路径永不外发）] 未实现的上报通道不存在（不会先把内容发出去）
  - 期望 0 实际 null

### F17 · 词典数据面隔离与来源生命周期

累计判红 5 轮（其中现行版本 0 轮），崩溃 3 次

- [X1 词条入独立库，主库写路径不被拖垮（§7.4 v32 追记④）] dictionary.db 独立成文件
  - 期望 true 实际 false
- [X4 多来源同名共存（来源徽标的数据依据）] 按来源计数互不污染
  - 期望 [5,1] 实际 [9,1]
- [X5 重复导入同一批不翻倍（按名 upsert 自愈的库侧）] 重复导入刷新了内容（upsert 而非忽略）
  - 期望 true 实际 "[{\"source_id\":\"flowtest-cedict\",\"headword\":\"苹果\",\"phonetic\":\"ping2 guo3\",\"pos\":\"\",\"html\":\"apple\\napple tree\"},{\"source_id\":\"flowtest-sec
- [X8 词典缓存在主库、与词条库分工（§4.2 / §7.4 D31）] 主进程导入路径按名复用 id（自愈的真实落点）
  - 期望 true 实际 "未找到"

### F18 · 设置项生效矩阵与孤儿设置

累计判红 30 轮（其中现行版本 0 轮），崩溃 3 次

- [Y1 文档点名的设置键必须都有消费者（双向对齐，孤儿检测）] 文档点名的键都能在代码里找到读取方
  - 期望 "无孤儿键" 实际 ["app.backupDir","app.autoBackupKeep","app.dictAudioSource","app.dictVocabKinds","app.shelfFolders","app.shelfOrder","app.skinId","theme.mode"]
- [Y1 文档点名的设置键必须都有消费者（双向对齐，孤儿检测）] 文档标未实现的键不得已有消费者（半成品不得先落地）
  - 期望 "无痕迹" 实际 ["fsrsWeights←electron/db.js"]
- [Y3 损坏配置文件必须回退默认且不炸（§7.6 要求读失败要留痕）] 损坏配置一律安全回退且消费方不崩
  - 期望 "全部安全" 实际 ["类型:null","抛错:null=Cannot read properti"]
- [Y1 文档点名的设置键必须都有消费者（双向对齐，孤儿检测）] 已废除的键不得有活的消费者（渲染层零引用，主进程仅限迁移代码）
  - 期望 "只在迁移块里出现" 实际 ["src/lib/fsrs.ts:6"]

### F19 · 只读清单与分页边界矩阵

累计判红 13 轮（其中现行版本 0 轮），崩溃 0 次

- [Z1 自动发现读入口，空库端必须返回合法形状（首启动视图）] 空库端全部读入口形状合法且不抛
  - 期望 "全部合法" 实际 ["listPromptTemplates: 空库返回 28 行"]
- [Z2 畸形/越界参数经真实读函数不得抛、不得越上限（§7.1.3）] 畸形参数不得让任何读函数抛异常
  - 期望 "零抛错" 实际 ["listJournalEntries/limitFrac: datatype mismatch","listJournalEntries/scalarNull: Cannot destructure property 'f","listJournalDates/limitFrac: datatype mismatc
- [Z2 畸形/越界参数经真实读函数不得抛、不得越上限（§7.1.3）] 返回值形状不得随参数漂移
  - 期望 "形状稳定" 实际 ["getLastUndoableReview/limit0: 不再返回对象","getLastUndoableReview/limitNeg: 不再返回对象","getLastUndoableReview/limitFrac: 不再返回对象","getLastUndoableReview/limitStr: 不再返回
- [Z4 搜索语义：LIKE 通配符必须被转义，全角/半角与大小写的口径要一致（§6.5）] 单个 % 不得退化成「匹配全部」
  - 期望 "命中数远小于全表" 实际 {"百分号命中":5,"全表":7}
- [Z6 同一时刻两次读数必须逐字节一致（§4.2-20 队列唯一口径）] computeTodayQueue 稳定
  - 期望 "{\"cards\":[{\"id\":\"4b3c1484-948f-4415-925d-269a5531e66f\",\"noteText\":\"F19 卡 0\",\"cardType\":\"qa\",\"clozeOrds\":[],\"cardOrd\":0,\"frontMarkdown\":\"F19 问题 0\",\"backMarkdown\":\"F19 答案 0\",\"contextPrefix\":null,\"contextRef\":null,\"mnemonic\":null,\"example\":null,\"sourceRef\":null,\"dateStamp\":null,\"priority\":30,\"tags\":[\"f19b\"],\"domain\":[],\"knowledgePointId\":null,\"occlusionJson\":null,\"fsrs\":{\"state\":\"new\",\"due\":1790023417382,\"lapses\":0},\"fsrsConfigId\":\"cfg-default\",\"leech\":null,\"generatedBy\":\"manual\",\"genBatchId\":null,\"dictJson\":null,\"memoryRefJson\":null,\"siblingKey\":\"act:f19\",\"createdAt\":1790023417382,\"updatedAt\":1790023417382,\"docTitle\":null}],\"deferred\":[{\"id\":\"f0220f6e-c177-46f9-ae60-c747b549ffa8\",\"noteText\":\"F19 卡 1\",\"cardType\":\"qa\",\"clozeOrds\":[],\"cardOrd\":0,\"frontMarkdown\":\"F19 问题 1\",\"backMarkdown\":\"F19 答案 1\",\"contextPrefix\":null,\"contextRef\":null,\"mnemonic\":null,\"example\":null,\"sourceRef\":null,\"dateStamp\":null,\"priority\":35,\"tags\":[\"f19a\"],\"domain\":[],\"knowledgePointId\":null,\"occlusionJson\":null,\"fsrs\":{\"state\":\"new\",\"due\":1790023417386,\"lapses\":0},\"fsrsConfigId\":\"cfg-default\",\"leech\":null,\"generatedBy\":\"manual\",\"genBatchId\":null,\"dictJson\":null,\"memoryRefJson\":null,\"siblingKey\":\"act:f19\",\"createdAt\":1790023417386,\"updatedAt\":1790023417386,\"docTitle\":null,\"deferReason\":{\"siblingKey\":\"act:f19\",\"kind\":\"revealed\",\"siblingCardId\":\"4b3c1484-948f-4415-925d-269a5531e66f\",\"siblingFront\":\"F19 问题 0\"}},{\"id\":\"bdaf8d94-00c2-425b-af83-6e975238e6a7\",\"noteText\":\"F19 卡 2\",\"cardType\":\"qa\",\"clozeOrds\":[],\"cardOrd\":0,\"frontMarkdown\":\"F19 问题 2\",\"backMarkdown\":\"F19 答案 2\",\"contextPrefix\":null,\"contextRef\":null,\"mnemonic\":null,\"example\":null,\"sourceRef\":null,\"dateStamp\":null,\"priority\":40,\"tags\":[\"f19b\"],\"domain\":[],\"knowledgePointId\":null,\"occlusionJson\":null,\"fsrs\":{\"state\":\"new\",\"due\":1790023417389,\"lapses\":0},\"fsrsConfigId\":\"cfg-default\",\"leech\":null,\"generatedBy\":\"manual\",\"genBatchId\":null,\"dictJson\":null,\"memoryRefJson\":null,\"siblingKey\":\"act:f19\",\"createdAt\":1790023417389,\"updatedAt\":1790023417389,\"docTitle\":null,\"deferReason\":{\"siblingKey\":\"act:f19\",\"kind\":\"revealed\",\"siblingCardId\":\"4b3c1484-948f-4415-925d-269a5531e66f\",\"siblingFront\":\"F19 问题 0\"}},{\"id\":\"c1823278-3143-4301-8828-6363f8e06680\",\"noteText\":\"F19 卡 3\",\"cardType\":\"qa\",\"clozeOrds\":[],\"cardOrd\":0,\"frontMarkdown\":\"F19 问题 3\",\"backMarkdown\":\"F19 答案 3\",\"contextPrefix\":null,\"contextRef\":null,\"mnemonic\":null,\"example\":null,\"sourceRef\":null,\"dateStamp\":null,\"priority\":45,\"tags\":[\"f19a\"],\"domain\":[],\"knowledgePointId\":null,\"occlusionJson\":null,\"fsrs\":{\"state\":\"new\",\"due\":1790023417392,\"lapses\":0},\"fsrsConfigId\":\"cfg-default\",\"leech\":null,\"generatedBy\":\"manual\",\"genBatchId\":null,\"dictJson\":null,\"memoryRefJson\":null,\"siblingKey\":\"act:f19\",\"createdAt\":1790023417392,\"updatedAt\":1790023417392,\"docTitle\":null,\"deferReason\":{\"siblingKey\":\"act:f19\",\"kind\":\"revealed\",\"siblingCardId\":\"4b3c1484-948f-4415-925d-269a5531e66f\",\"siblingFront\":\"F19 问题 0\"}},{\"id\":\"9db8b5da-5485-41de-89c0-2f5f4032e950\",\"noteText\":\"F19 卡 4\",\"cardType\":\"qa\",\"clozeOrds\":[],\"cardOrd\":0,\"frontMarkdown\":\"F19 问题 4\",\"backMarkdown\":\"F19 答案 4\",\"contextPrefix\":null,\"contextRef\":null,\"mnemonic\":null,\"example\":null,\"sourceRef\":null,\"dateStamp\":null,\"priority\":50,\"tags\":[\"f19b\"],\"domain\":[],\"knowledgePointId\":null,\"occlusionJson\":null,\"fsrs\":{\"state\":\"new\",\"due\":1790023417396,\"lapses\":0},\"fsrsConfigId\":\"cfg-default\",\"leech\":null,\"generatedBy\":\"manual\",\"genBatchId\":null,\"dictJson\":null,\"memoryRefJson\":null,\"siblingKey\":\"act:f19\",\"createdAt\":1790023417396,\"updatedAt\":1790023417396,\"docTitle\":null,\"deferReason\":{\"siblingKey\":\"act:f19\",\"kind\":\"revealed\",\"siblingCardId\":\"4b3c1484-948f-4415-925d-269a5531e66f\",\"siblingFront\":\"F19 问题 0\"}},{\"id\":\"d140b5fd-31cf-47d1-87d5-041e106f2785\",\"noteText\":\"F19 卡 5\",\"cardType\":\"qa\",\"clozeOrds\":[],\"cardOrd\":0,\"frontMarkdown\":\"F19 问题 5\",\"backMarkdown\":\"F19 答案 5\",\"contextPrefix\":null,\"contextRef\":null,\"mnemonic\":null,\"example\":null,\"sourceRef\":null,\"dateStamp\":null,\"priority\":55,\"tags\":[\"f19a\"],\"domain\":[],\"knowledgePointId\":null,\"occlusionJson\":null,\"fsrs\":{\"state\":\"new\",\"due\":1790023417399,\"lapses\":0},\"fsrsConfigId\":\"cfg-default\",\"leech\":null,\"generatedBy\":\"manual\",\"genBatchId\":null,\"dictJson\":null,\"memoryRefJson\":null,\"siblingKey\":\"act:f19\",\"createdAt\":1790023417399,\"updatedAt\":1790023417399,\"docTitle\":null,\"deferReason\":{\"siblingKey\":\"act:f19\",\"kind\":\"revealed\",\"siblingCardId\":\"4b3c1484-948f-4415-925d-269a5531e66f\",\"siblingFront\":\"F19 问题 0\"}},{\"id\":\"45ddf923-acfb-4fcb-8edf-6517954764b3\",\"noteText\":\"F19 卡 6\",\"cardType\":\"qa\",\"clozeOrds\":[],\"cardOrd\":0,\"frontMarkdown\":\"F19 问题 6\",\"backMarkdown\":\"F19 答案 6\",\"contextPrefix\":null,\"contextRef\":null,\"mnemonic\":null,\"example\":null,\"sourceRef\":null,\"dateStamp\":null,\"priority\":60,\"tags\":[\"f19b\"],\"domain\":[],\"knowledgePointId\":null,\"occlusionJson\":null,\"fsrs\":{\"state\":\"new\",\"due\":1790023417403,\"lapses\":0},\"fsrsConfigId\":\"cfg-default\",\"leech\":null,\"generatedBy\":\"manual\",\"genBatchId\":null,\"dictJson\":null,\"memoryRefJson\":null,\"siblingKey\":\"act:f19\",\"createdAt\":1790023417403,\"updatedAt\":1790023417403,\"docTitle\":null,\"deferReason\":{\"siblingKey\":\"act:f19\",\"kind\":\"revealed\",\"siblingCardId\":\"4b3c1484-948f-4415-925d-269a5531e66f\",\"siblingFront\":\"F19 问题 0\"}},{\"id\":\"c1352768-24d6-4784-ae70-d95bc111d55d\",\"noteText\":\"F19 卡 7\",\"cardType\":\"qa\",\"clozeOrds\":[],\"cardOrd\":0,\"frontMarkdown\":\"F19 问题 7\",\"backMarkdown\":\"F19 答案 7\",\"contextPrefix\":null,\"contextRef\":null,\"mnemonic\":null,\"example\":null,\"sourceRef\":null,\"dateStamp\":null,\"priority\":65,\"tags\":[\"f19a\"],\"domain\":[],\"knowledgePointId\":null,\"occlusionJson\":null,\"fsrs\":{\"state\":\"new\",\"due\":1790023417406,\"lapses\":0},\"fsrsConfigId\":\"cfg-default\",\"leech\":null,\"generatedBy\":\"manual\",\"genBatchId\":null,\"dictJson\":null,\"memoryRefJson\":null,\"siblingKey\":\"act:f19\",\"createdAt\":1790023417406,\"updatedAt\":1790023417406,\"docTitle\":null,\"deferReason\":{\"siblingKey\":\"act:f19\",\"kind\":\"revealed\",\"siblingCardId\":\"4b3c1484-948f-4415-925d-269a5531e66f\",\"siblingFront\":\"F19 问题 0\"}}],\"now\":1790023417536}" 实际 "{\"cards\":[{\"id\":\"4b3c1484-948f-4415-925d-269a5531e66f\",\"noteText\":\"F19 卡 0\",\"cardType\":\"qa\",\"clozeOrds\":[],\"cardOrd\":0,\"frontMarkdown\":\"F1
- [Z6 同一时刻两次读数必须逐字节一致（§4.2-20 队列唯一口径）] getStatsOverview 稳定
  - 期望 "{\"kpi\":{\"dueToday\":1,\"completedToday\":0,\"pendingToday\":1,\"reviewedToday\":0,\"streak\":0,\"minutesToday\":0,\"siblingDeferred\":7},\"heatDays\":[{\"date\":1774368000000,\"count\":0,\"minutes\":0},{\"date\":1774454400000,\"count\":0,\"minutes\":0},{\"date\":1774540800000,\"count\":0,\"minutes\":0},{\"date\":1774627200000,\"count\":0,\"minutes\":0},{\"date\":1774713600000,\"count\":0,\"minutes\":0},{\"date\":1774800000000,\"count\":0,\"minutes\":0},{\"date\":1774886400000,\"count\":0,\"minutes\":0},{\"date\":1774972800000,\"count\":0,\"minutes\":0},{\"date\":1775059200000,\"count\":0,\"minutes\":0},{\"date\":1775145600000,\"count\":0,\"minutes\":0},{\"date\":1775232000000,\"count\":0,\"minutes\":0},{\"date\":1775318400000,\"count\":0,\"minutes\":0},{\"date\":1775404800000,\"count\":0,\"minutes\":0},{\"date\":1775491200000,\"count\":0,\"minutes\":0},{\"date\":1775577600000,\"count\":0,\"minutes\":0},{\"date\":1775664000000,\"count\":0,\"minutes\":0},{\"date\":1775750400000,\"count\":0,\"minutes\":0},{\"date\":1775836800000,\"count\":0,\"minutes\":0},{\"date\":1775923200000,\"count\":0,\"minutes\":0},{\"date\":1776009600000,\"count\":0,\"minutes\":0},{\"date\":1776096000000,\"count\":0,\"minutes\":0},{\"date\":1776182400000,\"count\":0,\"minutes\":0},{\"date\":1776268800000,\"count\":0,\"minutes\":0},{\"date\":1776355200000,\"count\":0,\"minutes\":0},{\"date\":1776441600000,\"count\":0,\"minutes\":0},{\"date\":1776528000000,\"count\":0,\"minutes\":0},{\"date\":1776614400000,\"count\":0,\"minutes\":0},{\"date\":1776700800000,\"count\":0,\"minutes\":0},{\"date\":1776787200000,\"count\":0,\"minutes\":0},{\"date\":1776873600000,\"count\":0,\"minutes\":0},{\"date\":1776960000000,\"count\":0,\"minutes\":0},{\"date\":1777046400000,\"count\":0,\"minutes\":0},{\"date\":1777132800000,\"count\":0,\"minutes\":0},{\"date\":1777219200000,\"count\":0,\"minutes\":0},{\"date\":1777305600000,\"count\":0,\"minutes\":0},{\"date\":1777392000000,\"count\":0,\"minutes\":0},{\"date\":1777478400000,\"count\":0,\"minutes\":0},{\"date\":1777564800000,\"count\":0,\"minutes\":0},{\"date\":1777651200000,\"count\":0,\"minutes\":0},{\"date\":1777737600000,\"count\":0,\"minutes\":0},{\"date\":1777824000000,\"count\":0,\"minutes\":0},{\"date\":1777910400000,\"count\":0,\"minutes\":0},{\"date\":1777996800000,\"count\":0,\"minutes\":0},{\"date\":1778083200000,\"count\":0,\"minutes\":0},{\"date\":1778169600000,\"count\":0,\"minutes\":0},{\"date\":1778256000000,\"count\":0,\"minutes\":0},{\"date\":1778342400000,\"count\":0,\"minutes\":0},{\"date\":1778428800000,\"count\":0,\"minutes\":0},{\"date\":1778515200000,\"count\":0,\"minutes\":0},{\"date\":1778601600000,\"count\":0,\"minutes\":0},{\"date\":1778688000000,\"count\":0,\"minutes\":0},{\"date\":1778774400000,\"count\":0,\"minutes\":0},{\"date\":1778860800000,\"count\":0,\"minutes\":0},{\"date\":1778947200000,\"count\":0,\"minutes\":0},{\"date\":1779033600000,\"count\":0,\"minutes\":0},{\"date\":1779120000000,\"count\":0,\"minutes\":0},{\"date\":1779206400000,\"count\":0,\"minutes\":0},{\"date\":1779292800000,\"count\":0,\"minutes\":0},{\"date\":1779379200000,\"count\":0,\"minutes\":0},{\"date\":1779465600000,\"count\":0,\"minutes\":0},{\"date\":1779552000000,\"count\":0,\"minutes\":0},{\"date\":1779638400000,\"count\":0,\"minutes\":0},{\"date\":1779724800000,\"count\":0,\"minutes\":0},{\"date\":1779811200000,\"count\":0,\"minutes\":0},{\"date\":1779897600000,\"count\":0,\"minutes\":0},{\"date\":1779984000000,\"count\":0,\"minutes\":0},{\"date\":1780070400000,\"count\":0,\"minutes\":0},{\"date\":1780156800000,\"count\":0,\"minutes\":0},{\"date\":1780243200000,\"count\":0,\"minutes\":0},{\"date\":1780329600000,\"count\":0,\"minutes\":0},{\"date\":1780416000000,\"count\":0,\"minutes\":0},{\"date\":1780502400000,\"count\":0,\"minutes\":0},{\"date\":1780588800000,\"count\":0,\"minutes\":0},{\"date\":1780675200000,\"count\":0,\"minutes\":0},{\"date\":1780761600000,\"count\":0,\"minutes\":0},{\"date\":1780848000000,\"count\":0,\"minutes\":0},{\"date\":1780934400000,\"count\":0,\"minutes\":0},{\"date\":1781020800000,\"count\":0,\"minutes\":0},{\"date\":1781107200000,\"count\":0,\"minutes\":0},{\"date\":1781193600000,\"count\":0,\"minutes\":0},{\"date\":1781280000000,\"count\":0,\"minutes\":0},{\"date\":1781366400000,\"count\":0,\"minutes\":0},{\"date\":1781452800000,\"count\":0,\"minutes\":0},{\"date\":1781539200000,\"count\":0,\"minutes\":0},{\"date\":1781625600000,\"count\":0,\"minutes\":0},{\"date\":1781712000000,\"count\":0,\"minutes\":0},{\"date\":1781798400000,\"count\":0,\"minutes\":0},{\"date\":1781884800000,\"count\":0,\"minutes\":0},{\"date\":1781971200000,\"count\":0,\"minutes\":0},{\"date\":1782057600000,\"count\":0,\"minutes\":0},{\"date\":1782144000000,\"count\":0,\"minutes\":0},{\"date\":1782230400000,\"count\":0,\"minutes\":0},{\"date\":1782316800000,\"count\":0,\"minutes\":0},{\"date\":1782403200000,\"count\":0,\"minutes\":0},{\"date\":1782489600000,\"count\":0,\"minutes\":0},{\"date\":1782576000000,\"count\":0,\"minutes\":0},{\"date\":1782662400000,\"count\":0,\"minutes\":0},{\"date\":1782748800000,\"count\":0,\"minutes\":0},{\"date\":1782835200000,\"count\":0,\"minutes\":0},{\"date\":1782921600000,\"count\":0,\"minutes\":0},{\"date\":1783008000000,\"count\":0,\"minutes\":0},{\"date\":1783094400000,\"count\":0,\"minutes\":0},{\"date\":1783180800000,\"count\":0,\"minutes\":0},{\"date\":1783267200000,\"count\":0,\"minutes\":0},{\"date\":1783353600000,\"count\":0,\"minutes\":0},{\"date\":1783440000000,\"count\":0,\"minutes\":0},{\"date\":1783526400000,\"count\":0,\"minutes\":0},{\"date\":1783612800000,\"count\":0,\"minutes\":0},{\"date\":1783699200000,\"count\":0,\"minutes\":0},{\"date\":1783785600000,\"count\":0,\"minutes\":0},{\"date\":1783872000000,\"count\":0,\"minutes\":0},{\"date\":1783958400000,\"count\":0,\"minutes\":0},{\"date\":1784044800000,\"count\":0,\"minutes\":0},{\"date\":1784131200000,\"count\":0,\"minutes\":0},{\"date\":1784217600000,\"count\":0,\"minutes\":0},{\"date\":1784304000000,\"count\":0,\"minutes\":0},{\"date\":1784390400000,\"count\":0,\"minutes\":0},{\"date\":1784476800000,\"count\":0,\"minutes\":0},{\"date\":1784563200000,\"count\":0,\"minutes\":0},{\"date\":1784649600000,\"count\":0,\"minutes\":0},{\"date\":1784736000000,\"count\":0,\"minutes\":0},{\"date\":1784822400000,\"count\":0,\"minutes\":0},{\"date\":1784908800000,\"count\":0,\"minutes\":0},{\"date\":1784995200000,\"count\":0,\"minutes\":0},{\"date\":1785081600000,\"count\":0,\"minutes\":0},{\"date\":1785168000000,\"count\":0,\"minutes\":0},{\"date\":1785254400000,\"count\":0,\"minutes\":0},{\"date\":1785340800000,\"count\":0,\"minutes\":0},{\"date\":1785427200000,\"count\":0,\"minutes\":0},{\"date\":1785513600000,\"count\":0,\"minutes\":0},{\"date\":1785600000000,\"count\":0,\"minutes\":0},{\"date\":1785686400000,\"count\":0,\"minutes\":0},{\"date\":1785772800000,\"count\":0,\"minutes\":0},{\"date\":1785859200000,\"count\":0,\"minutes\":0},{\"date\":1785945600000,\"count\":0,\"minutes\":0},{\"date\":1786032000000,\"count\":0,\"minutes\":0},{\"date\":1786118400000,\"count\":0,\"minutes\":0},{\"date\":1786204800000,\"count\":0,\"minutes\":0},{\"date\":1786291200000,\"count\":0,\"minutes\":0},{\"date\":1786377600000,\"count\":0,\"minutes\":0},{\"date\":1786464000000,\"count\":0,\"minutes\":0},{\"date\":1786550400000,\"count\":0,\"minutes\":0},{\"date\":1786636800000,\"count\":0,\"minutes\":0},{\"date\":1786723200000,\"count\":0,\"minutes\":0},{\"date\":1786809600000,\"count\":0,\"minutes\":0},{\"date\":1786896000000,\"count\":0,\"minutes\":0},{\"date\":1786982400000,\"count\":0,\"minutes\":0},{\"date\":1787068800000,\"count\":0,\"minutes\":0},{\"date\":1787155200000,\"count\":0,\"minutes\":0},{\"date\":1787241600000,\"count\":0,\"minutes\":0},{\"date\":1787328000000,\"count\":0,\"minutes\":0},{\"date\":1787414400000,\"count\":0,\"minutes\":0},{\"date\":1787500800000,\"count\":0,\"minutes\":0},{\"date\":1787587200000,\"count\":0,\"minutes\":0},{\"date\":1787673600000,\"count\":0,\"minutes\":0},{\"date\":1787760000000,\"count\":0,\"minutes\":0},{\"date\":1787846400000,\"count\":0,\"minutes\":0},{\"date\":1787932800000,\"count\":0,\"minutes\":0},{\"date\":1788019200000,\"count\":0,\"minutes\":0},{\"date\":1788105600000,\"count\":0,\"minutes\":0},{\"date\":1788192000000,\"count\":0,\"minutes\":0},{\"date\":1788278400000,\"count\":0,\"minutes\":0},{\"date\":1788364800000,\"count\":0,\"minutes\":0},{\"date\":1788451200000,\"count\":0,\"minutes\":0},{\"date\":1788537600000,\"count\":0,\"minutes\":0},{\"date\":1788624000000,\"count\":0,\"minutes\":0},{\"date\":1788710400000,\"count\":0,\"minutes\":0},{\"date\":1788796800000,\"count\":0,\"minutes\":0},{\"date\":1788883200000,\"count\":0,\"minutes\":0},{\"date\":1788969600000,\"count\":0,\"minutes\":0},{\"date\":1789056000000,\"count\":0,\"minutes\":0},{\"date\":1789142400000,\"count\":0,\"minutes\":0},{\"date\":1789228800000,\"count\":0,\"minutes\":0},{\"date\":1789315200000,\"count\":0,\"minutes\":0},{\"date\":1789401600000,\"count\":0,\"minutes\":0},{\"date\":1789488000000,\"count\":0,\"minutes\":0},{\"date\":1789574400000,\"count\":0,\"minutes\":0},{\"date\":1789660800000,\"count\":0,\"minutes\":0},{\"date\":1789747200000,\"count\":0,\"minutes\":0},{\"date\":1789833600000,\"count\":0,\"minutes\":0},{\"date\":1789920000000,\"count\":0,\"minutes\":0},{\"date\":1790006400000,\"count\":0,\"minutes\":0}],\"domainMain\":[],\"domainDetail\":[],\"unclassified\":8,\"ratings\":[],\"durationByField\":[],\"durationBins\":[0,0,0,0,0,0,0,0,0,0,0,0],\"funnel\":{\"drafts\":8,\"entered\":8,\"firstLearned\":0,\"reviewing\":0,\"consolidated\":0},\"sourceCards\":[{\"book\":\"未知来源\",\"domain\":null},{\"book\":\"未知来源\",\"domain\":null},{\"book\":\"未知来源\",\"domain\":null},{\"book\":\"未知来源\",\"domain\":null},{\"book\":\"未知来源\",\"domain\":null},{\"book\":\"未知来源\",\"domain\":null},{\"book\":\"未知来源\",\"domain\":null},{\"book\":\"未知来源\",\"domain\":null}],\"domainRank\":[],\"queueFlow\":{\"carriedOver\":0,\"overdue\":0,\"newCards\":8,\"completed\":0,\"skipped\":0,\"remaining\":1},\"readingDays\":[{\"date\":1786135417537,\"chars\":0},{\"date\":1786221817537,\"chars\":0},{\"date\":1786308217537,\"chars\":0},{\"date\":1786394617537,\"chars\":0},{\"date\":1786481017537,\"chars\":0},{\"date\":1786567417537,\"chars\":0},{\"date\":1786653817537,\"chars\":0},{\"date\":1786740217537,\"chars\":0},{\"date\":1786826617537,\"chars\":0},{\"date\":1786913017537,\"chars\":0},{\"date\":1786999417537,\"chars\":0},{\"date\":1787085817537,\"chars\":0},{\"date\":1787172217537,\"chars\":0},{\"date\":1787258617537,\"chars\":0},{\"date\":1787345017537,\"chars\":0},{\"date\":1787431417537,\"chars\":0},{\"date\":1787517817537,\"chars\":0},{\"date\":1787604217537,\"chars\":0},{\"date\":1787690617537,\"chars\":0},{\"date\":1787777017537,\"chars\":0},{\"date\":1787863417537,\"chars\":0},{\"date\":1787949817537,\"chars\":0},{\"date\":1788036217537,\"chars\":0},{\"date\":1788122617537,\"chars\":0},{\"date\":1788209017537,\"chars\":0},{\"date\":1788295417537,\"chars\":0},{\"date\":1788381817537,\"chars\":0},{\"date\":1788468217537,\"chars\":0},{\"date\":1788554617537,\"chars\":0},{\"date\":1788641017537,\"chars\":0},{\"date\":1788727417537,\"chars\":0},{\"date\":1788813817537,\"chars\":0},{\"date\":1788900217537,\"chars\":0},{\"date\":1788986617537,\"chars\":0},{\"date\":1789073017537,\"chars\":0},{\"date\":1789159417537,\"chars\":0},{\"date\":1789245817537,\"chars\":0},{\"date\":1789332217537,\"chars\":0},{\"date\":1789418617537,\"chars\":0},{\"date\":1789505017537,\"chars\":0},{\"date\":1789591417537,\"chars\":0},{\"date\":1789677817537,\"chars\":0},{\"date\":1789764217537,\"chars\":0},{\"date\":1789850617537,\"chars\":0},{\"date\":1789937017537,\"chars\":0}],\"rhythmGrid\":[[0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0]],\"rhythmEvents\":[]}" 实际 "{\"kpi\":{\"dueToday\":1,\"completedToday\":0,\"pendingToday\":1,\"reviewedToday\":0,\"streak\":0,\"minutesToday\":0,\"siblingDeferred\":7},\"heatDays\":[{\"da
- [Z2 畸形/越界参数经真实读函数不得抛、不得越上限（§7.1.3）] 显式传 null 必须等同于未传（默认值只兜 undefined，null 会绕过）
  - 期望 "全部不抛" 实际 ["getMaterialMapShard/scalarNull: Cannot read properties of null"]

### F20 · 键盘命令契约

累计判红 9 轮（其中现行版本 0 轮），崩溃 1 次

- [W5 只存用户覆盖项、改回默认即删键、重复键位要能被检测（§9.1 M4 键位数据流）] 覆盖 → 生效 → 恢复默认，三步都要正确
  - 期望 "三步正确" 实际 ["恢复默认后生效键是 5"]
- [W6 主进程与设置页各存一份全局快捷键默认值，必须字面相等（双事实源闸门）] 两侧默认 accelerator 必须一致
  - 期望 "一致" 实际 {"主进程":["Ctrl+Alt+Space","Ctrl+Alt+N"],"设置页":["Ctrl+Alt+Space","Ctrl+Alt+Space"]}
- [W6 主进程与设置页各存一份全局快捷键默认值，必须字面相等（双事实源闸门）] 主进程 accelerator 归一化矩阵逐档符合预期
  - 期望 "全部一致" 实际 ["\"Command+Control+Space\" → \"Ctrl+Cmd+Space\" ≠ \"CommandOrControl+Ctrl+Space\"","\"meta+shift+v\" → \"Shift+Super+V\" ≠ \"Super+Shift+V\""]

### F21 · 进程间桥面对账

累计判红 3 轮（其中现行版本 0 轮），崩溃 0 次

- （无失败断言记录，只有环境干扰导致的进程被杀）

### F22 · 书架视图组织契约

累计判红 4 轮（其中现行版本 0 轮），崩溃 1 次

- [P3 解散≠删除、空文件夹保留、删书两处同摘（用户数据不悄悄消失）] 全部移回书架：成员出去、空文件夹保留
  - 期望 "空夹保留" 实际 {"order":["f1","b1","b2","b3","b9"],"folders":[{"id":"f1","name":"语言","items":[],"created":"2026-09-22"}]}
- [P4 库里新增的书插到队首，消失的条目同步清干净，且幂等（避免「导入完找不到」）] 未入册的新书排在最前
  - 期望 "b5,b4" 实际 "b4,b5"
- [P5 四种排序口径稳定，文件夹用聚合时间与成员数参与同列排序（§5.4）] recent 按最近阅读（含文件夹聚合 latest）
  - 期望 "b3,b2" 实际 "b2,b3,f1"
- [P8 视图组织不进数据库：主库零 shelf 列，listItems 排序口径一字不改（D51 边界②）] listItems() 仍是 ORDER BY created_at DESC（文档明写「一字不改」）
  - 期望 "口径未变" 实际 "ORDER BY li.created_at DESC\r"
- [P9 统计 / 今日队列 / FSRS 都不感知 order 与 folders（D51 边界①）] 今日队列逐字节不变
  - 期望 "{\"cards\":[{\"id\":\"0597cb95-2d9c-4c46-8230-4a024ff15150\",\"noteText\":\"F22 卡 0\",\"cardType\":\"qa\",\"clozeOrds\":[],\"cardOrd\":0,\"frontMarkdown\":\"问 0\",\"backMarkdown\":\"答 0\",\"contextPrefix\":null,\"contextRef\":null,\"mnemonic\":null,\"example\":null,\"sourceRef\":null,\"dateStamp\":null,\"priority\":50,\"tags\":[\"f22\"],\"domain\":[],\"knowledgePointId\":null,\"occlusionJson\":null,\"fsrs\":{\"state\":\"new\",\"due\":1790025390140,\"lapses\":0},\"fsrsConfigId\":\"cfg-default\",\"leech\":null,\"generatedBy\":\"manual\",\"genBatchId\":null,\"dictJson\":null,\"memoryRefJson\":null,\"siblingKey\":\"act:f22\",\"createdAt\":1790025390140,\"updatedAt\":1790025390140,\"docTitle\":null}],\"deferred\":[{\"id\":\"ea6bb41e-e832-4665-8abf-a2b3debd0084\",\"noteText\":\"F22 卡 1\",\"cardType\":\"qa\",\"clozeOrds\":[],\"cardOrd\":0,\"frontMarkdown\":\"问 1\",\"backMarkdown\":\"答 1\",\"contextPrefix\":null,\"contextRef\":null,\"mnemonic\":null,\"example\":null,\"sourceRef\":null,\"dateStamp\":null,\"priority\":50,\"tags\":[\"f22\"],\"domain\":[],\"knowledgePointId\":null,\"occlusionJson\":null,\"fsrs\":{\"state\":\"new\",\"due\":1790025390147,\"lapses\":0},\"fsrsConfigId\":\"cfg-default\",\"leech\":null,\"generatedBy\":\"manual\",\"genBatchId\":null,\"dictJson\":null,\"memoryRefJson\":null,\"siblingKey\":\"act:f22\",\"createdAt\":1790025390147,\"updatedAt\":1790025390147,\"docTitle\":null,\"deferReason\":{\"siblingKey\":\"act:f22\",\"kind\":\"revealed\",\"siblingCardId\":\"0597cb95-2d9c-4c46-8230-4a024ff15150\",\"siblingFront\":\"问 0\"}},{\"id\":\"3621554c-1f02-4f27-925e-3030363a8b2d\",\"noteText\":\"F22 卡 2\",\"cardType\":\"qa\",\"clozeOrds\":[],\"cardOrd\":0,\"frontMarkdown\":\"问 2\",\"backMarkdown\":\"答 2\",\"contextPrefix\":null,\"contextRef\":null,\"mnemonic\":null,\"example\":null,\"sourceRef\":null,\"dateStamp\":null,\"priority\":50,\"tags\":[\"f22\"],\"domain\":[],\"knowledgePointId\":null,\"occlusionJson\":null,\"fsrs\":{\"state\":\"new\",\"due\":1790025390152,\"lapses\":0},\"fsrsConfigId\":\"cfg-default\",\"leech\":null,\"generatedBy\":\"manual\",\"genBatchId\":null,\"dictJson\":null,\"memoryRefJson\":null,\"siblingKey\":\"act:f22\",\"createdAt\":1790025390152,\"updatedAt\":1790025390152,\"docTitle\":null,\"deferReason\":{\"siblingKey\":\"act:f22\",\"kind\":\"revealed\",\"siblingCardId\":\"0597cb95-2d9c-4c46-8230-4a024ff15150\",\"siblingFront\":\"问 0\"}},{\"id\":\"69d54af7-753b-4b38-b63a-732ea659374e\",\"noteText\":\"F22 卡 3\",\"cardType\":\"qa\",\"clozeOrds\":[],\"cardOrd\":0,\"frontMarkdown\":\"问 3\",\"backMarkdown\":\"答 3\",\"contextPrefix\":null,\"contextRef\":null,\"mnemonic\":null,\"example\":null,\"sourceRef\":null,\"dateStamp\":null,\"priority\":50,\"tags\":[\"f22\"],\"domain\":[],\"knowledgePointId\":null,\"occlusionJson\":null,\"fsrs\":{\"state\":\"new\",\"due\":1790025390156,\"lapses\":0},\"fsrsConfigId\":\"cfg-default\",\"leech\":null,\"generatedBy\":\"manual\",\"genBatchId\":null,\"dictJson\":null,\"memoryRefJson\":null,\"siblingKey\":\"act:f22\",\"createdAt\":1790025390156,\"updatedAt\":1790025390156,\"docTitle\":null,\"deferReason\":{\"siblingKey\":\"act:f22\",\"kind\":\"revealed\",\"siblingCardId\":\"0597cb95-2d9c-4c46-8230-4a024ff15150\",\"siblingFront\":\"问 0\"}}],\"now\":1790025390168}" 实际 "{\"cards\":[{\"id\":\"0597cb95-2d9c-4c46-8230-4a024ff15150\",\"noteText\":\"F22 卡 0\",\"cardType\":\"qa\",\"clozeOrds\":[],\"cardOrd\":0,\"frontMarkdown\":\"问 
- [P9 统计 / 今日队列 / FSRS 都不感知 order 与 folders（D51 边界①）] 统计概览逐字节不变
  - 期望 "{\"kpi\":{\"dueToday\":1,\"completedToday\":0,\"pendingToday\":1,\"reviewedToday\":0,\"streak\":0,\"minutesToday\":0,\"siblingDeferred\":3},\"heatDays\":[{\"date\":1774368000000,\"count\":0,\"minutes\":0},{\"date\":1774454400000,\"count\":0,\"minutes\":0},{\"date\":1774540800000,\"count\":0,\"minutes\":0},{\"date\":1774627200000,\"count\":0,\"minutes\":0},{\"date\":1774713600000,\"count\":0,\"minutes\":0},{\"date\":1774800000000,\"count\":0,\"minutes\":0},{\"date\":1774886400000,\"count\":0,\"minutes\":0},{\"date\":1774972800000,\"count\":0,\"minutes\":0},{\"date\":1775059200000,\"count\":0,\"minutes\":0},{\"date\":1775145600000,\"count\":0,\"minutes\":0},{\"date\":1775232000000,\"count\":0,\"minutes\":0},{\"date\":1775318400000,\"count\":0,\"minutes\":0},{\"date\":1775404800000,\"count\":0,\"minutes\":0},{\"date\":1775491200000,\"count\":0,\"minutes\":0},{\"date\":1775577600000,\"count\":0,\"minutes\":0},{\"date\":1775664000000,\"count\":0,\"minutes\":0},{\"date\":1775750400000,\"count\":0,\"minutes\":0},{\"date\":1775836800000,\"count\":0,\"minutes\":0},{\"date\":1775923200000,\"count\":0,\"minutes\":0},{\"date\":1776009600000,\"count\":0,\"minutes\":0},{\"date\":1776096000000,\"count\":0,\"minutes\":0},{\"date\":1776182400000,\"count\":0,\"minutes\":0},{\"date\":1776268800000,\"count\":0,\"minutes\":0},{\"date\":1776355200000,\"count\":0,\"minutes\":0},{\"date\":1776441600000,\"count\":0,\"minutes\":0},{\"date\":1776528000000,\"count\":0,\"minutes\":0},{\"date\":1776614400000,\"count\":0,\"minutes\":0},{\"date\":1776700800000,\"count\":0,\"minutes\":0},{\"date\":1776787200000,\"count\":0,\"minutes\":0},{\"date\":1776873600000,\"count\":0,\"minutes\":0},{\"date\":1776960000000,\"count\":0,\"minutes\":0},{\"date\":1777046400000,\"count\":0,\"minutes\":0},{\"date\":1777132800000,\"count\":0,\"minutes\":0},{\"date\":1777219200000,\"count\":0,\"minutes\":0},{\"date\":1777305600000,\"count\":0,\"minutes\":0},{\"date\":1777392000000,\"count\":0,\"minutes\":0},{\"date\":1777478400000,\"count\":0,\"minutes\":0},{\"date\":1777564800000,\"count\":0,\"minutes\":0},{\"date\":1777651200000,\"count\":0,\"minutes\":0},{\"date\":1777737600000,\"count\":0,\"minutes\":0},{\"date\":1777824000000,\"count\":0,\"minutes\":0},{\"date\":1777910400000,\"count\":0,\"minutes\":0},{\"date\":1777996800000,\"count\":0,\"minutes\":0},{\"date\":1778083200000,\"count\":0,\"minutes\":0},{\"date\":1778169600000,\"count\":0,\"minutes\":0},{\"date\":1778256000000,\"count\":0,\"minutes\":0},{\"date\":1778342400000,\"count\":0,\"minutes\":0},{\"date\":1778428800000,\"count\":0,\"minutes\":0},{\"date\":1778515200000,\"count\":0,\"minutes\":0},{\"date\":1778601600000,\"count\":0,\"minutes\":0},{\"date\":1778688000000,\"count\":0,\"minutes\":0},{\"date\":1778774400000,\"count\":0,\"minutes\":0},{\"date\":1778860800000,\"count\":0,\"minutes\":0},{\"date\":1778947200000,\"count\":0,\"minutes\":0},{\"date\":1779033600000,\"count\":0,\"minutes\":0},{\"date\":1779120000000,\"count\":0,\"minutes\":0},{\"date\":1779206400000,\"count\":0,\"minutes\":0},{\"date\":1779292800000,\"count\":0,\"minutes\":0},{\"date\":1779379200000,\"count\":0,\"minutes\":0},{\"date\":1779465600000,\"count\":0,\"minutes\":0},{\"date\":1779552000000,\"count\":0,\"minutes\":0},{\"date\":1779638400000,\"count\":0,\"minutes\":0},{\"date\":1779724800000,\"count\":0,\"minutes\":0},{\"date\":1779811200000,\"count\":0,\"minutes\":0},{\"date\":1779897600000,\"count\":0,\"minutes\":0},{\"date\":1779984000000,\"count\":0,\"minutes\":0},{\"date\":1780070400000,\"count\":0,\"minutes\":0},{\"date\":1780156800000,\"count\":0,\"minutes\":0},{\"date\":1780243200000,\"count\":0,\"minutes\":0},{\"date\":1780329600000,\"count\":0,\"minutes\":0},{\"date\":1780416000000,\"count\":0,\"minutes\":0},{\"date\":1780502400000,\"count\":0,\"minutes\":0},{\"date\":1780588800000,\"count\":0,\"minutes\":0},{\"date\":1780675200000,\"count\":0,\"minutes\":0},{\"date\":1780761600000,\"count\":0,\"minutes\":0},{\"date\":1780848000000,\"count\":0,\"minutes\":0},{\"date\":1780934400000,\"count\":0,\"minutes\":0},{\"date\":1781020800000,\"count\":0,\"minutes\":0},{\"date\":1781107200000,\"count\":0,\"minutes\":0},{\"date\":1781193600000,\"count\":0,\"minutes\":0},{\"date\":1781280000000,\"count\":0,\"minutes\":0},{\"date\":1781366400000,\"count\":0,\"minutes\":0},{\"date\":1781452800000,\"count\":0,\"minutes\":0},{\"date\":1781539200000,\"count\":0,\"minutes\":0},{\"date\":1781625600000,\"count\":0,\"minutes\":0},{\"date\":1781712000000,\"count\":0,\"minutes\":0},{\"date\":1781798400000,\"count\":0,\"minutes\":0},{\"date\":1781884800000,\"count\":0,\"minutes\":0},{\"date\":1781971200000,\"count\":0,\"minutes\":0},{\"date\":1782057600000,\"count\":0,\"minutes\":0},{\"date\":1782144000000,\"count\":0,\"minutes\":0},{\"date\":1782230400000,\"count\":0,\"minutes\":0},{\"date\":1782316800000,\"count\":0,\"minutes\":0},{\"date\":1782403200000,\"count\":0,\"minutes\":0},{\"date\":1782489600000,\"count\":0,\"minutes\":0},{\"date\":1782576000000,\"count\":0,\"minutes\":0},{\"date\":1782662400000,\"count\":0,\"minutes\":0},{\"date\":1782748800000,\"count\":0,\"minutes\":0},{\"date\":1782835200000,\"count\":0,\"minutes\":0},{\"date\":1782921600000,\"count\":0,\"minutes\":0},{\"date\":1783008000000,\"count\":0,\"minutes\":0},{\"date\":1783094400000,\"count\":0,\"minutes\":0},{\"date\":1783180800000,\"count\":0,\"minutes\":0},{\"date\":1783267200000,\"count\":0,\"minutes\":0},{\"date\":1783353600000,\"count\":0,\"minutes\":0},{\"date\":1783440000000,\"count\":0,\"minutes\":0},{\"date\":1783526400000,\"count\":0,\"minutes\":0},{\"date\":1783612800000,\"count\":0,\"minutes\":0},{\"date\":1783699200000,\"count\":0,\"minutes\":0},{\"date\":1783785600000,\"count\":0,\"minutes\":0},{\"date\":1783872000000,\"count\":0,\"minutes\":0},{\"date\":1783958400000,\"count\":0,\"minutes\":0},{\"date\":1784044800000,\"count\":0,\"minutes\":0},{\"date\":1784131200000,\"count\":0,\"minutes\":0},{\"date\":1784217600000,\"count\":0,\"minutes\":0},{\"date\":1784304000000,\"count\":0,\"minutes\":0},{\"date\":1784390400000,\"count\":0,\"minutes\":0},{\"date\":1784476800000,\"count\":0,\"minutes\":0},{\"date\":1784563200000,\"count\":0,\"minutes\":0},{\"date\":1784649600000,\"count\":0,\"minutes\":0},{\"date\":1784736000000,\"count\":0,\"minutes\":0},{\"date\":1784822400000,\"count\":0,\"minutes\":0},{\"date\":1784908800000,\"count\":0,\"minutes\":0},{\"date\":1784995200000,\"count\":0,\"minutes\":0},{\"date\":1785081600000,\"count\":0,\"minutes\":0},{\"date\":1785168000000,\"count\":0,\"minutes\":0},{\"date\":1785254400000,\"count\":0,\"minutes\":0},{\"date\":1785340800000,\"count\":0,\"minutes\":0},{\"date\":1785427200000,\"count\":0,\"minutes\":0},{\"date\":1785513600000,\"count\":0,\"minutes\":0},{\"date\":1785600000000,\"count\":0,\"minutes\":0},{\"date\":1785686400000,\"count\":0,\"minutes\":0},{\"date\":1785772800000,\"count\":0,\"minutes\":0},{\"date\":1785859200000,\"count\":0,\"minutes\":0},{\"date\":1785945600000,\"count\":0,\"minutes\":0},{\"date\":1786032000000,\"count\":0,\"minutes\":0},{\"date\":1786118400000,\"count\":0,\"minutes\":0},{\"date\":1786204800000,\"count\":0,\"minutes\":0},{\"date\":1786291200000,\"count\":0,\"minutes\":0},{\"date\":1786377600000,\"count\":0,\"minutes\":0},{\"date\":1786464000000,\"count\":0,\"minutes\":0},{\"date\":1786550400000,\"count\":0,\"minutes\":0},{\"date\":1786636800000,\"count\":0,\"minutes\":0},{\"date\":1786723200000,\"count\":0,\"minutes\":0},{\"date\":1786809600000,\"count\":0,\"minutes\":0},{\"date\":1786896000000,\"count\":0,\"minutes\":0},{\"date\":1786982400000,\"count\":0,\"minutes\":0},{\"date\":1787068800000,\"count\":0,\"minutes\":0},{\"date\":1787155200000,\"count\":0,\"minutes\":0},{\"date\":1787241600000,\"count\":0,\"minutes\":0},{\"date\":1787328000000,\"count\":0,\"minutes\":0},{\"date\":1787414400000,\"count\":0,\"minutes\":0},{\"date\":1787500800000,\"count\":0,\"minutes\":0},{\"date\":1787587200000,\"count\":0,\"minutes\":0},{\"date\":1787673600000,\"count\":0,\"minutes\":0},{\"date\":1787760000000,\"count\":0,\"minutes\":0},{\"date\":1787846400000,\"count\":0,\"minutes\":0},{\"date\":1787932800000,\"count\":0,\"minutes\":0},{\"date\":1788019200000,\"count\":0,\"minutes\":0},{\"date\":1788105600000,\"count\":0,\"minutes\":0},{\"date\":1788192000000,\"count\":0,\"minutes\":0},{\"date\":1788278400000,\"count\":0,\"minutes\":0},{\"date\":1788364800000,\"count\":0,\"minutes\":0},{\"date\":1788451200000,\"count\":0,\"minutes\":0},{\"date\":1788537600000,\"count\":0,\"minutes\":0},{\"date\":1788624000000,\"count\":0,\"minutes\":0},{\"date\":1788710400000,\"count\":0,\"minutes\":0},{\"date\":1788796800000,\"count\":0,\"minutes\":0},{\"date\":1788883200000,\"count\":0,\"minutes\":0},{\"date\":1788969600000,\"count\":0,\"minutes\":0},{\"date\":1789056000000,\"count\":0,\"minutes\":0},{\"date\":1789142400000,\"count\":0,\"minutes\":0},{\"date\":1789228800000,\"count\":0,\"minutes\":0},{\"date\":1789315200000,\"count\":0,\"minutes\":0},{\"date\":1789401600000,\"count\":0,\"minutes\":0},{\"date\":1789488000000,\"count\":0,\"minutes\":0},{\"date\":1789574400000,\"count\":0,\"minutes\":0},{\"date\":1789660800000,\"count\":0,\"minutes\":0},{\"date\":1789747200000,\"count\":0,\"minutes\":0},{\"date\":1789833600000,\"count\":0,\"minutes\":0},{\"date\":1789920000000,\"count\":0,\"minutes\":0},{\"date\":1790006400000,\"count\":0,\"minutes\":0}],\"domainMain\":[],\"domainDetail\":[],\"unclassified\":4,\"ratings\":[],\"durationByField\":[],\"durationBins\":[0,0,0,0,0,0,0,0,0,0,0,0],\"funnel\":{\"drafts\":4,\"entered\":4,\"firstLearned\":0,\"reviewing\":0,\"consolidated\":0},\"sourceCards\":[{\"book\":\"未知来源\",\"domain\":null},{\"book\":\"未知来源\",\"domain\":null},{\"book\":\"未知来源\",\"domain\":null},{\"book\":\"未知来源\",\"domain\":null}],\"domainRank\":[],\"queueFlow\":{\"carriedOver\":0,\"overdue\":0,\"newCards\":4,\"completed\":0,\"skipped\":0,\"remaining\":1},\"readingDays\":[{\"date\":1786137390170,\"chars\":0},{\"date\":1786223790170,\"chars\":0},{\"date\":1786310190170,\"chars\":0},{\"date\":1786396590170,\"chars\":0},{\"date\":1786482990170,\"chars\":0},{\"date\":1786569390170,\"chars\":0},{\"date\":1786655790170,\"chars\":0},{\"date\":1786742190170,\"chars\":0},{\"date\":1786828590170,\"chars\":0},{\"date\":1786914990170,\"chars\":0},{\"date\":1787001390170,\"chars\":0},{\"date\":1787087790170,\"chars\":0},{\"date\":1787174190170,\"chars\":0},{\"date\":1787260590170,\"chars\":0},{\"date\":1787346990170,\"chars\":0},{\"date\":1787433390170,\"chars\":0},{\"date\":1787519790170,\"chars\":0},{\"date\":1787606190170,\"chars\":0},{\"date\":1787692590170,\"chars\":0},{\"date\":1787778990170,\"chars\":0},{\"date\":1787865390170,\"chars\":0},{\"date\":1787951790170,\"chars\":0},{\"date\":1788038190170,\"chars\":0},{\"date\":1788124590170,\"chars\":0},{\"date\":1788210990170,\"chars\":0},{\"date\":1788297390170,\"chars\":0},{\"date\":1788383790170,\"chars\":0},{\"date\":1788470190170,\"chars\":0},{\"date\":1788556590170,\"chars\":0},{\"date\":1788642990170,\"chars\":0},{\"date\":1788729390170,\"chars\":0},{\"date\":1788815790170,\"chars\":0},{\"date\":1788902190170,\"chars\":0},{\"date\":1788988590170,\"chars\":0},{\"date\":1789074990170,\"chars\":0},{\"date\":1789161390170,\"chars\":0},{\"date\":1789247790170,\"chars\":0},{\"date\":1789334190170,\"chars\":0},{\"date\":1789420590170,\"chars\":0},{\"date\":1789506990170,\"chars\":0},{\"date\":1789593390170,\"chars\":0},{\"date\":1789679790170,\"chars\":0},{\"date\":1789766190170,\"chars\":0},{\"date\":1789852590170,\"chars\":0},{\"date\":1789938990170,\"chars\":0}],\"rhythmGrid\":[[0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0]],\"rhythmEvents\":[]}" 实际 "{\"kpi\":{\"dueToday\":1,\"completedToday\":0,\"pendingToday\":1,\"reviewedToday\":0,\"streak\":0,\"minutesToday\":0,\"siblingDeferred\":3},\"heatDays\":[{\"da
- [P9 统计 / 今日队列 / FSRS 都不感知 order 与 folders（D51 边界①）] 引用了不存在的书 id 也只是被忽略（不产幽灵条目、不报错）
  - 期望 "全部忽略" 实际 [{"kind":"folder","id":"f1","folder":{"id":"f1","name":"x","items":["ghost"],"created":"2026-09-22"}}]

### F23 · 阅读进度与阅读字数契约

累计判红 1 轮（其中现行版本 0 轮），崩溃 1 次

- （无失败断言记录，只有环境干扰导致的进程被杀）

### F24 · 指南章节覆盖面自评

累计判红 22 轮（其中现行版本 0 轮），崩溃 1 次

- [R4 里程碑清单（§9.1 M1…M15）每一个都要有流程] 每个里程碑都被某条流程点名引用
  - 期望 "全有点名" 实际 ["M7","M8","M9","M10","M11","M12","M13","M14"]
- [R4 里程碑清单（§9.1 M1…M15）：无人点名的里程碑按棘轮只许减少] 不得有新增的无人点名里程碑
  - 期望 "≤基线 0 个" 实际 ["M7","M8","M9","M10","M11","M12","M13","M14"]
- [R2 每一章都必须有流程碰过（缺口按棘轮只许缩小）] 基线记录的流程总数与实际一致（有流程被删要在这里发现）
  - 期望 24 实际 25

### F25 · 资源落盘与文件边界

累计判红 3 轮（其中现行版本 0 轮），崩溃 0 次

- [V1 导入原书的文件名不得把字节写到 assets/<itemId>/ 之外（§7.5 红线）] 这些名字不得让整个导入调用抛未捕获错误
  - 期望 "要么拒绝要么净化" 实际 ["\"C:\\\\Users\\\\xiongdy\\\\AppData\": ENOENT: no such file or directory,","\"/tmp/evil-5.md\": ENOENT: no such file or directory,","\"..\": EISDIR: illegal o
- [V2 内嵌图有文件名防护，但要防住「合法却危险」的名字（db.js:956）] 图片名逐个探针不得抛错（当前 `..` 过正则、写目录时抛 EISDIR → 整本导入失败）
  - 期望 "不抛" 实际 ["\"..\": EISDIR: illegal operation on a"]
- [V2 内嵌图有文件名防护，但要防住「合法却危险」的名字（db.js:956）] 图片写入也不得落到卡目录之外
  - 期望 "全部在内" 实际 ["assets/evil-1.md","assets/evil-3.md","evil-2.md"]

### F26 · 显示文本口径对账

累计判红 17 轮（其中现行版本 0 轮），崩溃 3 次

- [P2 格式化函数喂边界与非法值：不抛、不空、不 NaN、不 undefined（§7.1.3）] 七个展示函数全部不产 junk（空串 / undefined / NaN / [object）
  - 期望 "全部可展示" 实际 ["shelf.dayLabel(0): 产出「」","shelf.dayLabel(null): 产出「」","shelf.dayLabel(null): 产出「NaN-NaN」","shelf.dayLabel(1000000000000000000): 产出「NaN-NaN」","shelf.pct(null):
- [P3 同一个时间戳，书架「上次阅读」与日记日期标签必须说同一个日子（§4.12-4 / §7.1.6）] 上次阅读展示里带日期且不带 NaN
  - 期望 "含日粒度" 实际 ""
- [P5 分类与关系映射：常用码必须翻成人话，未知码不得留空（§4.2-9 UDC / §4.6 关系类型）] UDC 十大类标签全部命中
  - 期望 "十大类都翻得出" 实际 ["000→000","100→100","200→200","300→300","400→400","500→500","600→600","700→700","800→800","900→900"]
- [P5 分类与关系映射：常用码必须翻成人话，未知码不得留空（§4.2-9 UDC / §4.6 关系类型）] 码表里每个叶子码都能按登记翻成中文标签
  - 期望 "逐一对应" 实际 ["0","1","3","5","6","7"]

### F27 · 克制红线：未实现层不得偷跑

累计判红 7 轮（其中现行版本 0 轮），崩溃 0 次

- [W4 不做排行榜/经验值/彩带/推送，不做惩罚性文案（§6.6.7①、§6.3.8、§1.10 精神）] 界面代码里没有反激励与惩罚性元素
  - 期望 "零命中" 实际 ["src/components/CardBrowser.tsx：经验值/等级（命中「xp」）","src/lib/cards.ts：经验值/等级（命中「xp」）","src/lib/dict.ts：经验值/等级（命中「xp」）","src/lib/reader/foliate/vendor.d.ts：经验值/等级（命
- [W4 不做排行榜/经验值/彩带/推送，不做惩罚性文案（§6.6.7①、§6.3.8、§1.10 精神）] 不得用原生弹窗庆祝或警告（v48.14 已改内联反馈）
  - 期望 "" 实际 "src/components/CardBrowser.tsx src/components/KnowledgeManager.tsx src/components/MindmapWorkspace.tsx src/components/ReviewView.tsx"

### F28 · 五处读数同源对账

累计判红 4 轮（其中现行版本 0 轮），崩溃 0 次

- [X2 仪表盘「今日待复习」与复习页可刷的张数必须互相对得上（§6.2 / §4.2-20）] KPI 的「今日到期」必须等于按日切点独立重算的张数（明天的一张都不能进来）
  - 期望 "4 张" 实际 3

### F29 · 全局序不变量

累计判红 13 轮（其中现行版本 0 轮），崩溃 0 次

- [T4 撤销入口与日志清单对「最后一条」必须同认一条（§4.4.9 / §6.2 复习页）] 面板要撤的那条 = 清单里最后一条（不同则撤销的是用户没看的那张卡）
  - 期望 "同一条" 实际 {"面板":"2f1a7848-483b-4920-91ca-9ea61a87b4fa","清单":"456fc44e-cee1-421c-80ab-58924118a0aa"}
- [T5 存量回填与重启后继续递增（§7.1.4 重启不丢序、迁移幂等）] 重启后新日志的序号接在最大值之后（不撞 UNIQUE 索引）
  - 期望 ">6" 实际 6
- [T4 撤销入口与日志清单对「最后一条」必须同认一条（§4.4.9 / §6.2 复习页）] 面板要撤的那条必须就是清单里最后一条（不同则撤销的是用户没看的那张卡）
  - 期望 "同一条" 实际 {"面板":"b5c96c57-f8b9-4040-948e-3dcebaa0fe95 seq=6","清单":"b5c96c57-f8b9-4040-948e-3dcebaa0fe95 seq=6"}

### F30 · 导入解析器层

累计判红 7 轮（其中现行版本 0 轮），崩溃 6 次

- [S1 decodeTextBytes：BOM 三型必须认得且剥掉，UTF-8 有效文本不得误判成 GBK（§9.1 M6-1）] UTF-16BE 解出「中文」
  - 期望 "中文" 实际 "N"
- [S4 titleFromFilename：扩展名、多点、隐藏文件、路径与空值（§6.1 导入即成书）] 八种文件名的书名化结果符合预期
  - 期望 "全部符合" 实际 ["\".env\" → \"\" 期望 \".env\""]
- [S6 itemsToLines / headingCandidates / joinPageMarkdown：确定性、CJK 断句、分页不重复（§9.1 M6-2）] 标题候选挑出短行、不挑长正文
  - 期望 "挑得对" 实际 "[]"
- [S6 itemsToLines / headingCandidates / joinPageMarkdown：确定性、CJK 断句、分页不重复（§9.1 M6-2）] 标题候选按字号启发式挑出大字号短行、不挑长正文
  - 期望 "挑得对" 实际 []

### F31 · 全库不变量体检

累计判红 11 轮（其中现行版本 0 轮），崩溃 9 次

- [J2 每个 *_id 引用列都必须指得到父表（sql.js 不开 FK，全靠约定维护）] 不得有指向不存在父行的活记录
  - 期望 "零悬空" 实际 "extracts.parent_id 有 1 行指向不存在的 library_items 样本 1668bcde"
- [J5 删一本书 + 删一张卡：谁该跟着消失，谁按既定决策留在原地] 删卡时它的 open issue 被收口（deleteCard 承诺 dismissed）
  - 期望 "存在 dismissed" 实际 "open×1"
- [J7 新装库全表扫描（出厂状态不得自带野值）] 除播种表外，新装库里没有预置数据
  - 期望 "干净" 实际 "users 出厂就有 1 行（播种类除外）"

### F32 · 写入口存在性矩阵与假成功清点

累计判红 5 轮（其中现行版本 0 轮），崩溃 0 次

- [W2 每个写入口打在不存在 id 上：返回值诚实性 + 既有行是否被动（逐条差分）] 幽灵 id 的假成功函数不得超出点名清单（新增一个就是新缺陷）
  - 期望 "仅 updateProgress/addReadingEvent" 实际 "deleteCard deleteItem deleteJournalEntry updateCard setLibraryItemTitle setLibraryItemLang deleteKnowledgeRelation deleteKnowledgeExternalRef deletePersonalMea
- [W6 写入口是否允许创建指向不存在父行的行（§4.2 行归属 / §9.1 M15 引用完整性）] 写入口不得创建指向不存在父行的行（幽灵 id 必须挡在门口，而不是插进库里等人日后踩）
  - 期望 "零悬空" 实际 "card_issues.card_id 有 1 行指向不存在的 cards ；extracts.document_id 有 1 行指向不存在的 documents ；reading_events.item_id 有 2 行指向不存在的 library_items"

### F33 · 落盘往返保真

累计判红 6 轮（其中现行版本 0 轮），崩溃 3 次

- [R5 点名 JSON 列：暂停标记、来源锚点、挖空答案、进度三锚、学习日计数必须原样回来] leech.suspended / suspendedAt 活过重启（暂停的卡重启后还在暂停）
  - 期望 "true + 正数时间戳" 实际 "[object Object]"
- [R5 点名 JSON 列：暂停标记、来源锚点、挖空答案、进度三锚、学习日计数必须原样回来] occlusion 的矩形与答案活过重启（图片挖空卡不会退化成空白卡）
  - 期望 "rects[1] + answer" 实际 "id,noteText,cardType,clozeOrds,cardOrd,frontMarkdown,backMarkdown,contextPrefix,contextRef,mnemonic,example,sourceRef,dateStamp,priority,tags,domain,knowledgeP
- [R5 点名 JSON 列：暂停标记、来源锚点、挖空答案、进度三锚、学习日计数必须原样回来] 3 条评分日志连同 seq 与 config 快照一起回来（§4.4.9 撤销与 §4.4.10 审计都靠它）
  - 期望 "3 条 + seq>0" 实际 "3 条"
- [R6 磁盘上确实是这些值（防止「内存里对、文件里没写」这种假绿）] 磁盘行里 leech_json 真的是 true 的暂停标记（不是靠内存兜住）
  - 期望 "含 suspended:true" 实际 "null"
- [R5 点名 JSON 列：暂停标记、来源锚点、挖空答案、进度三锚、学习日计数必须原样回来] domain 经 sanitizeDomain 往返后仍是同一集合（§4.19 领域码不得在重启中漂走）
  - 期望 "100,400" 实际 "[]"

## 4. 性能棘轮（F10，逐轮记录的关键耗时）

| 指标 | 轮数 | 最小 | 中位 | 最大 |
|---|---|---|---|---|
| 12 次推迟后的间隔天数 | 805 | 180 | 180 | 180 |
| queueP50ms | 639 | 7.27 | 11.13 | 25.66 |
| queueP95ms | 639 | 8.13 | 13.27 | 28.63 |
| listAllCardsMs | 639 | 6.36 | 9.67 | 25.97 |
| statsMs | 639 | 13.01 | 19.87 | 46.65 |
| cardsSeeded | 639 | 420 | 513 | 599 |
| reviewP50ms | 638 | 2.98 | 5.19 | 8.39 |
| reviewP95ms | 638 | 3.29 | 6.64 | 37.26 |
| persistP50ms | 638 | 2.45 | 4.76 | 7.79 |
| persistP95ms | 638 | 2.77 | 5.11 | 8.99 |
| dbKb | 638 | 784 | 836 | 1160 |

## 5. 结论口径

- 判绿条件：退出码 0 且 `fail==0 && !aborted && !crash && knownHealed 为空 && total>0`（零断言视为失败）。
- 「已知缺陷触发」不算失败，但会逐轮计数；缺陷被修好后该断言**意外转绿会立刻判红**，提醒撤销登记。
- 崩溃列多为环境干扰：并行会话沿用旧 harness 的 `taskkill /IM electron.exe /F` 会连带杀掉本层正在跑的流程进程（编排器对「被信号杀死/零断言早退」自动重试一次，真实断言失败绝不重试）。
