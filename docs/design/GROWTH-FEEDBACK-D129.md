# GROWTH-FEEDBACK-D129 —— M13 成长反馈实现方案（GF-1 记忆层 + GF-2 知识层设计稿）

> 决策号：D129（建议版本号 v48.85，登记块见 §9 附录）。
> 依据：`AI_DEVELOPMENT_GUIDE.md` §4.17（契约）+ §6.6（产品规格：正反馈分级总表为文案与优先级唯一事实来源）+ §4.2-22（`GrowthReadModel`，唯一数据面）+ §9.1/§9.2 M13 行。**本稿不修改契约正文**；对契约的偏离只登记为缺口（§7），由总控走「先改文档再编码」。
> 排期依据：M13 排在 M8-B 与 K0–K9 之后——M8-B（v40）已实现；K3–K9 已被 D124/M17 取代且 **v48.80 已实现**（§9.2），前置满足。GF-1 为零依赖子集（§4.17-10），GF-2 受 §7 缺口 G1 约束、先修契约再实现。
> 本文只做设计，不写任何 src/electron 代码。

---

## 0. 一页摘要

| 项 | 内容 |
| --- | --- |
| 数据面 | `GrowthReadModel`（§4.2-22）落地为：`electron/growth.js` 纯函数模块（事件判定口径唯一居所）+ `electron/db.js` 三个只读聚合出口 + **3 条 `growth:*` 只读 IPC**（`growth:afterReview` / `growth:sessionSummary` / `growth:overview`）+ `preload.growthAPI` + `src/lib/growth.ts` 渲染层封装 |
| 事件判定唯一化 | 全部 GrowthEvent 判定 = `electron/growth.js` 纯函数（输入=原始证据行 + 可注入 `now`，输出=事件命中集）；复习提示、会话汇总、仪表盘/Territory 三个消费端一律经 IPC 消费其输出，**禁止任何组件自行实现口径**（同 §4.2-20 精神） |
| UI 落点 | ① 复习页微反馈条 `.growth-toast`（§6.6.2）；② 复习会话收尾页 `.growth-session` 成果汇总（§6.6.3）；③ 仪表盘新 widget `growth-events`（成长记录）与 `territory`（巩固疆域，GF-1 Territory 形态），`WIDGETS` 增 `layer` 字段（§6.6.4）；GF-2 增 `capability` widget |
| 设置键 | `app.growthFeedback = { enabled }`（默认开；关闭=零渲染零计算，读取路径短路） |
| 批次 | GF-1 记忆层 7 个任务（2 个建议派发批次）；GF-2 知识层 3 个任务（**被缺口 G1 阻塞，先修契约**） |
| 零写路径 | 不落新表、不写 FSRS/LKM、不发通知、不注册快捷键、零新依赖、零 schema 变更；全部派生可从原始证据重算（§4.17-3） |

---

## 1. 范围清单

### 1.1 本期做（GF-1 记忆层）

逐条对齐 §6.6 与 §4.17：

1. **正反馈分级总表的实现面**：§6.6.1 表中 **L2 建制 5 项 + L3 次要 1 项**（`material` / `group` / `leech-recovery` / `relearning-recovery` / `retention-180` / `retention-60`）——记忆层数据源只读 `cards` + `review_logs`（含 `fsrs_before_json` / `fsrs_after_json` / `leech_before_json` / `review_seq` 快照列），零 schema 依赖。**L0 / L1 两级属知识层，GF-2 实现，本期不产出**（分级总表中序 1–6 不激活）。
2. **取消项（§6.6.1 序 13/14）**：`单卡巩固 21 天`、`学习步毕业（Learning → Review）` 在判定函数中**显式不产事件**，并在 `electron/growth.js` 头注释登记「取消项，禁加回」。
3. **复习页微反馈条**（§6.6.2）：评分成功边界后的轻提示条；单次评分至多一条（取 §6.6.1 最高级，同级按事件类型固定序 → 实体 id 字典序）；L3 仅进汇总、不出现在提示条。
4. **会话成果汇总**（§6.6.3）：复习会话收尾页「本轮 N 张已复习」区域内追加命中清单（含被取最高级规则挤掉的命中与 L3 项、L2 单日折叠计数）；空态只显示既有文案，不造「今日无成长」类负面对照。
5. **仪表盘四层接入 + Territory（GF-1 形态）**（§6.6.4）：`WIDGETS` 增 `layer` 字段（既有 12 组件一律 `today`，不动其布局/拖拽/隐藏）；新增 `growth-events`（成长记录时间线，Growth 层）与 `territory`（材料/领域巩固地图，Territory 层，**不自称知识疆域**）两个 widget；默认布局把二者插到 `today`（今日完成度）之后。
6. **防回灌 / 首次语义 / 撤销联动 / 单日折叠**（§4.17-6）：全部以纯函数重算实现（§3.3）；存量历史达成项不弹提示（只接受刚提交评分触发的跨越）；历史 L0–L2 档案经 `growth-events` widget 的「盘点」呈现（用户主动查看，不逐个弹）。
7. **设置键** `app.growthFeedback = { enabled: true }`（双侧归一 + F18 登记）。

### 1.2 本期设计但受阻塞（GF-2 知识层）

1. **知识层事件**（§6.6.1 序 1–6：`transfer-first` / `application-first` / `kp-strong` / `kp-functional` / `structure-link` / `domain-entry`）：本稿给出**判定函数签名与 IPC 形状设计**（§3.5），实现被缺口 **G1** 阻塞——契约的判定数据面（`knowledge_evidence` / `learner_knowledge_states` / Frontier）已被 §4.20（D124/M17）取代，须先由总控修 §4.17 再编码。
2. **`capability` widget（能力里程碑）**：形状设计见 §5.4，随 GF-2 实现。
3. **Territory 升级为知识疆域图**：依赖缺口 **G2**（视觉阶段映射表的四态口径失去指向），GF-2 内再议。

### 1.3 明确不做（Non-Goals，逐条对齐 §6.6.5 与 §9.4）

| 不做 | 依据 |
| --- | --- |
| 排行榜 / 分享 / 推送通知 / 虚拟货币·经验值·等级 / 庆祝动画（彩带、烟花、经验条） | §6.6.5、§4.17-3/§4.17-7 |
| 每日目标 / 打卡 / 连续天数提醒；streak 文案改动 | §6.6.5（streak 归 Activity 层，既有 KPI 与里程碑尺不动，禁「即将断签/补签」文案——本批不触碰 streak 组件） |
| Momentum（完整版或简化版） | §9.4 延后池 + 交接确认（不在本期） |
| 成长记录导出 / 自定义成长目标 / 里程碑分享 | §9.4 延后池，未排期不自行领取 |
| 新增 AI 调用 / 新提示词 scope | §6.6.5（本层零提示词变更） |
| 新表、新列、`learner.db` 写入、任何 FSRS/LKM 写路径 | §4.17-3（连 LKM 也只读） |
| 通知系统 / 全局快捷键 / 命令注册表新增 | §4.17-3 + §6.6.2（微反馈不注册任何快捷键） |
| 既有 12 个仪表盘组件的布局/图型/口径改动 | §6.6.4（用户主导的仪表盘，v24 起约定） |
| 摘录会话（ExtractReviewView）收尾汇总 | 摘录 advance/postpone/graduate 不产 GrowthEvent（记忆层事件只来自卡片评分）；M16 合并会话中卡片部分命中已随 ReviewView 收尾页呈现 |
| 万能总分 / 四态环形总进度条（总分换皮） | §4.17-4 硬性 |

---

## 2. 模块落点总览

```
electron/growth.js          新增。纯函数模块（不 import db / electron）：
                            记忆层事件判定 + 选级 + 折叠 + Territory 聚合几何，
                            输入全部是证据行数组与参数，输出普通对象。node 直跑可测。
electron/db.js              增 3 个只读聚合出口（取数 + 调 growth.js），仿 getStatsTimeline
                            ↔ electron/statsTimeline.js 的分层先例；零写路径。
electron/main.js            增 3 条 ipcMain.handle("growth:*")，只读 invoke；
                            可选 now 注入透传（同 cards:todayQueue 先例）。
electron/preload.js         增 contextBridge.exposeInMainWorld("growthAPI", {…})。
src/lib/growth.ts           新增。类型（GrowthEventHit 等）+ growthApi 封装 +
                            normalizeGrowthFeedback（设置读侧归一，同 tagSettings.ts 模式）+
                            useGrowthOverview()（防抖 + 模块级缓存 hook，仿 Dashboard dashCache）。
src/lib/growthStrings.ts    新增。§6.6.1 文案模板唯一实现（keyed by 事件类型；插值参数化）。
src/components/ReviewView.tsx        ①评分成功后调 growthAPI.afterReview（非阻塞）→ .growth-toast
                                     ②收尾分支追加 .growth-session 汇总。
src/components/GrowthToast.tsx       新增。微反馈条组件（ReviewView 内嵌使用）。
src/components/dashboard/widgets.tsx WIDGETS 增 layer 字段 + 2 个新 widget 定义（自取数，Timeline 先例）。
src/components/dashboard/GrowthEventsWidget.tsx / TerritoryWidget.tsx  新增。
src/components/dashboard/layout.ts   defaultLayoutV2 默认序插入 2 个新 widget（syncHidden 自动带给存量用户）。
src/theme.css               .growth-toast / .growth-session / .growth-records / .territory-map 段
                            （动效全部引用 MOTION-DESIGN-SPEC §1 token，双轨 reduce）。
tests/growth.test.cjs       新增。纯函数 node 测试（口径矩阵）。
tests/m13.test.cjs          新增。electron 隔离库测试（db 聚合出口 + 只读不变量 + undo 联动）。
tests/m13.gui.mjs           新增。CDP 端到端（自启自关，M7_TEST_USERDATA 隔离，跑前 npm run build）。
```

**消费端与判定面的隔离（口径唯一化的落点）**：

- 判定口径（什么算「首达」「跨越」「康复」、阈值、tier、投放面）**只在** `electron/growth.js`。
- 文案（§6.6.1 表的「文案」列）**只在** `src/lib/growthStrings.ts`，模板逐条对齐 §6.6.1 示例文案；主进程返回结构化事件（type/tier/entity/evidence），渲染层负责把事件渲染成文案。
- 三个消费端（提示条 / 汇总 / 仪表盘）只做取数与渲染，零判定逻辑；审查 grep：`src/components/**` 内不得出现对 `review_logs`/`fsrs_after_json` 的任何解析（本批新增代码）。

---

## 3. GrowthReadModel 模块设计

### 3.1 事件模型与类型（渲染层契约，`src/lib/growth.ts`）

```ts
// 事件类型封闭枚举（§6.6.1 全表；GF-1 只产出 tier 2/3 行）
type GrowthEventType =
  | "transfer-first" | "application-first" | "kp-strong" | "kp-functional"      // L0（GF-2）
  | "structure-link" | "domain-entry"                                            // L1（GF-2）
  | "material" | "group" | "leech-recovery" | "relearning-recovery" | "retention-180" // L2（GF-1）
  | "retention-60";                                                              // L3（GF-1，仅汇总）
// 取消项（"consolidate-21d" / "learning-graduate"）不是枚举成员——判定函数中显式排除并注释。

interface GrowthEventHit {
  key: string;            // 首次语义键 `${type}:${entityId}:${dimension}`（§4.17-6①）
  type: GrowthEventType;
  tier: 0 | 1 | 2 | 3;    // 提示优先级 = tier（§4.17-5）
  entityId: string;       // 书 id / 卡 id / sibling_key / KP id / 领域码
  entityLabel: string;    // 书名 / 卡正面摘要（≤40 字，同 deferReason 截断先例）/ 组大小
  dimension: string;      // material: "half"|"full"；retention: "60"|"180"；其余见 §3.2
  triggerSeq: number;     // 触发跨越的 review_seq（首次达成时刻的排序依据）
  triggerAt: number;      // 该日志 reviewed_at
  surface: ("toast" | "summary")[];  // §6.6.1 投放面列的机读形式（L3 = ["summary"]）
  evidence: {             // 证据链（可追溯，§4.17-4③/§4.17-7）
    cardIds?: string[]; cardFronts?: string[];   // 组级/单卡
    libraryItemId?: string; docTitle?: string;
    documentId?: string; anchorText?: string;    // 跳转原文可用锚（有则给）
    groupSize?: number; stabilityDays?: number; lapses?: number;
  };
}
```

### 3.2 `electron/growth.js` 纯函数清单（判定口径唯一居所）

全部函数满足：输入＝证据行数组 + 参数对象 + 可注入 `now`；输出＝普通对象；**无 IO、无时钟读取、无随机**。

| 函数 | 输入 | 输出 | 口径（实现批定稿值，登记 D129；改值须先改文档） |
| --- | --- | --- | --- |
| `deriveCardEvents(cardRows, logRows, now)` | 单卡行 + 该卡全部日志（按 `review_seq` 升序） | 该卡的首达命中集 | **`relearning-recovery`**：存在日志 L 使 `before.state==="relearning" && after.state==="review"`（before/after 取 `fsrs_before_json`/`fsrs_after_json`；缺快照的 v22 前旧日志不参与判定）；**`retention-60/180`**：`after.stability` 首次 ≥60 / ≥180（同一条日志同时跨两档只报 180——两键同卡同日时 `pickTop` 兜底）；**`leech-recovery`**：历史上出现过 `leech_before_json` 非空（或该卡现挂 `leech_json`）∧ 其后某日志 `after.state==="review" && after.stability≥21` 首次成立（21d=与漏斗「已巩固」同阈值）；**取消项**：state 学习步毕业、`stability` 21 天档显式跳过 |
| `deriveGroupEvents(cardRows, now)` | 同组卡行（sibling_key 或 knowledge_point_id） | 组毕业命中 | 组成员 = `is_deleted=0` 且未挂起的活跃卡，`sibling_key`（非 NULL）或 `knowledge_point_id`（非 NULL）分组，**组大小 ≥2**；全组 `fsrs.state==="review"` 首次成立（按组内最新日志的 max review_seq 定触发时刻）；dimension=`"review"` |
| `deriveMaterialEvents(cardsWithLogs, now, params)` | 书/领域 → 活跃卡集 + 各卡 consolidated 布尔 | 材料级跨越命中 | 覆盖率 = consolidated 卡数 / 活跃卡总数；**consolidated ≡ `fsrs.state==="review" && stability>21`**（与 `stats:overview` 漏斗「已巩固」同口径，禁止第二套）；**样本门槛：活跃卡 ≥8** 才参与；阈值两档：首达 ≥50%（`half`「过半」）、=100%（`full`「全覆盖」）；实体两键：书（library_item，经 contextRef.documentId 归属）与 UDC 主领域码 |
| `firstCrossings(series)` | 任意 (实体, 维度) 的时间序列 `[ {seq, value} ]` | 首达记录 | 通用底座：按 `review_seq` 升序扫描，返回 value 首次越过阈值的 `{seq, at}`；**日志被撤销删除 = 序列自然回退 = 事件自动消失**（§4.17-6②，静默）；重评再跨越产生新 triggerSeq（真实的重做） |
| `pickTopEvent(hits)` | 单次评分产生的全部命中 | `{toast, others}` | toast 候选先按 `surface` 含 `"toast"` 过滤（L3 出局）；取 tier 最小值（L0 最高）；同级按 §6.6.1 表序（函数内固定 type 序数组）→ 实体 id 字典序；**至多 1 条**，其余进 `others`（汇总兜底，不丢弃 §6.6.2） |
| `foldSameDay(hits, dayStartMs)` | 命中集 + 学习日起点 | `{visible, folded[]}` | 同一学习日内同 type 的 L2 事件：`visible` 留表序第一条，其余折成 `{type, count}`（「今天另有 N 张卡进入长期维持」）；L0/L1 不折叠；学习日口径 = `learningDayStartMs(ts, dayCutoffHour)`（D23，统计口径专用） |
| `buildTerritory(cardRows, now)` | 全量活跃卡行 | Territory 聚合 | 按书与 UDC 主领域两维聚合：`{total, new, learning, reviewing, consolidated, coverage}`，状态四段 = new（fsrs NULL）/learning（state=learning|relearning）/reviewing（review 且 stability≤21）/consolidated（review 且 stability>21）；**与 deriveMaterialEvents 共用同一个 consolidated 判定子函数 `isConsolidated(fsrs)`**（口径唯一）；附 `crossedHalf/crossedFull` 标记（供地图上标注已跨越材料） |
| `deriveKnowledgeEvents(…)`（GF-2，签名预留） | K1 关系行 + M17 kp_states 行 + learning_events | 知识层命中 | **阻塞于缺口 G1**：映射表（四态↔L0–L4、application/transfer↔learning_events.kind、domain-entry↔轨道/领域）须先由总控修 §4.17；本稿只锁签名与输出形状（同 `GrowthEventHit`），判定细则留待契约修订后补入本节 |

**防回灌的机制化（§4.17-6③）**：`growth:afterReview` 的派生范围被严格限定——对刚评分的卡取其**最新一条日志的 review_seq 为 triggerSeq**，只返回 `triggerSeq === 该 seq` 的命中（存量历史跨越的 triggerSeq 更小，天然不命中）；汇总与档案路径则按时间窗/全量重算，二者共用同一批 derive 函数，一致性由测试锁定（§6.2 断言 N-9）。

### 3.3 `electron/db.js` 只读聚合出口

仿 `getStatsTimeline` 分层（db.js 只取数，口径在纯函数模块），零写路径、全部 `SELECT`：

| 函数 | 对应 IPC | 输入 | 行为 |
| --- | --- | --- | --- |
| `getGrowthAfterReview(cardId, now?)` | `growth:afterReview` | 卡 id | 读该卡行 + 全部日志 + 同组卡 + 所属书/领域的活跃卡集 → `deriveCardEvents` + `deriveGroupEvents` + `deriveMaterialEvents` → `pickTopEvent` → `{enabled, toast, others}`；设置关闭时返回 `{enabled:false}` 且**不做任何查询**（零计算） |
| `getGrowthSessionSummary(fromTs, now?)` | `growth:sessionSummary` | 会话起点 ms | `review_logs.reviewed_at >= fromTs` 的日志 + 关联卡 → derive → `foldSameDay` → `{enabled, fromTs, hits, folded}`（含 L3 与被折叠项——汇总面全量呈现） |
| `getGrowthOverview(opts, now?)` | `growth:overview` | `{limit?=30}` | 全库 derive（material/group/单卡各事件）→ 近期 L0–L2 档案 `recentEvents`（按 triggerSeq 倒序，limit 截断）+ `totals` + `buildTerritory` + `{enabled, now, cutoffHour}`；设置关闭时返回 `{enabled:false}` |
| （GF-2）`getGrowthKnowledge(opts)` | `growth:overview` 扩展字段 | — | overview 载荷预留 `knowledge: null` 字段，GF-2 填充（不新增第 4 条通道，除非总控批准） |

**读侧成功边界与性能纪律（§4.17-6⑥）**：三个出口都只读；`growth:afterReview` 由渲染层在**评分成功边界之后**（COMMIT + persist + IPC 成功、UI 已推进）异步调用，不 await 不阻塞下一张卡；失败 `catch` 静默（派生失败绝不影响评分/跳过/删除/Undo）。`growth:overview` 全库聚合**只**在仪表盘挂载时触发 + 事件驱动防抖刷新（§5.3），**不进入评分路径、不做每评分全量重算**。

### 3.4 IPC 通道清单（`electron/main.js` + `electron/preload.js`）

| 通道 | 方向 | 输入 → 输出 | 备注 |
| --- | --- | --- | --- |
| `growth:afterReview` | invoke 只读 | `cardId: string, now?: number` → `{enabled, toast: GrowthEventHit\|null, others: GrowthEventHit[]}` | 复习页每评分成功后调用一次；`now` 注入同 `cards:todayQueue`（`Number.isFinite` 守卫） |
| `growth:sessionSummary` | invoke 只读 | `fromTs: number, now?: number` → `{enabled, fromTs, hits, folded}` | 收尾页挂载时调用一次 |
| `growth:overview` | invoke 只读 | `opts?: {limit?: number}, now?: number` → `{enabled, now, cutoffHour, recentEvents, totals, territory, knowledge: null}` | 仪表盘 widget 共用（模块级缓存 + 防抖，§5.3） |

preload 形态（照 `statsAPI` 先例）：

```js
contextBridge.exposeInMainWorld("growthAPI", {
  afterReview: (cardId, now) => ipcRenderer.invoke("growth:afterReview", String(cardId), now),
  sessionSummary: (fromTs, now) => ipcRenderer.invoke("growth:sessionSummary", Number(fromTs) || 0, now),
  overview: (opts, now) => ipcRenderer.invoke("growth:overview", opts || {}, now)
});
```

渲染层 `window.growthAPI` 的 TypeScript 声明并入 `src/lib/growth.ts` 顶部 `declare global`（照 `stats.ts` 先例）。**零通知通道**：本层不需要主进程→渲染层推送（提示由渲染层在评分成功后主动拉取），不新增任何非 invoke 事件通道。

### 3.5 GF-2 扩展点（设计预留，实现受 G1 阻塞）

- `deriveKnowledgeEvents(k1RelationRows, kpStateRows, learningEventRows, now)`：输入三类行（`knowledge_relations`（K1 四表之一，`analogous_to` + 用户确认语义待核对——缺口 G3）、`learner.db kp_states`（L0–L4 + `first_l3_at`/`first_l4_at`）、`learning_events`）；输出同 `GrowthEventHit`。
- overview 载荷的 `knowledge` 字段与 `capability` widget 数据面同形状；Territory 升级为知识疆域图时复用 K1 关系行做连边（禁假动画，§4.10-3）。
- **本节不给出 L 级↔四态映射表**——那是缺口 G1/G2 要求的契约修订内容，本稿不得自创第二套解释。

---

## 4. GF-1 / GF-2 批次划分与任务拆解表

**建议批次数：GF-1 拆 2 个派发批次（A：数据面 4 项；B：呈现层 3 项），GF-2 单列 1 个阻塞批次。** 派发顺序逐行依赖，每轮执行后过一轮 `code-reviewer`。

### 4.1 GF-1 批次 A（数据面，先落库后呈现）

| # | 任务 | 建议执行者 | 涉及文件 | 可机械检查的验收标准 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| A1 | 新建 `electron/growth.js`：`firstCrossings` / `deriveCardEvents` / `deriveGroupEvents` / `deriveMaterialEvents` / `pickTopEvent` / `foldSameDay` / `isConsolidated` + 取消项显式排除注释；导出全部纯函数 | core-engineer | `electron/growth.js`（新增） | `node tests/growth.test.cjs` 全绿（§6.1 断言 P-1…P-14）；文件无 `require("electron")`/`require("./db")`（`grep -n "require(" electron/growth.js` 仅允许 node 内置）；取消项在文件头注释登记 | 无 |
| A2 | 纯函数 node 测试套件 | core-engineer | `tests/growth.test.cjs`（新增） | `node tests/growth.test.cjs` 退出码 0，≥14 组断言全过（清单见 §6.1）；测试内零网络零库 | A1 |
| A3 | `electron/db.js` 三个只读聚合出口 + `electron/main.js` 三条 `growth:*` handle + `electron/preload.js` growthAPI | core-engineer | `electron/db.js`、`electron/main.js`、`electron/preload.js` | `npx electron tests/m13.test.cjs` 全绿（§6.2 断言 N-1…N-12）；`grep -n "growth:" electron/main.js` = 3 条且全部 `ipcMain.handle`；db.js 改动 diff 内**无任何 `db.run`/`INSERT`/`UPDATE`/`DELETE`**（`git diff` 人工核对 + 测试 N-11 断言零写）；设置关闭时三出口短路返回 `{enabled:false}` | A1 |
| A4 | 设置键 `app.growthFeedback`（双侧归一 + F18 登记） | bug-fixer | `electron/main.js`（settings:set 写侧逐字面量）、`src/lib/growthSettings.ts`（新增读侧 `normalizeGrowthFeedback`） | `F18` 闸门补 `DOC_KEYS` 后全绿；写侧：仅严格 `false` 为关，非法回落 `true`；读侧同规；round-trip 用例过 | 无（可与 A1 并行） |

### 4.2 GF-1 批次 B（呈现层）

| # | 任务 | 建议执行者 | 涉及文件 | 可机械检查的验收标准 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| B1 | `src/lib/growth.ts` + `src/lib/growthStrings.ts`：类型、growthApi、useGrowthOverview 防抖 hook、§6.6.1 文案模板 | frontend-builder | `src/lib/growth.ts`、`src/lib/growthStrings.ts`（均新增） | `npx tsc --noEmit` 0 错误；文案表键集合 ≡ §6.6.1 的 12 个 type（含取消项占位注释）；hook 防抖 ≥500ms 且组件卸载后不发 setState（`alive` 守卫，Dashboard 先例） | A3、A4 |
| B2 | 复习页微反馈条：ReviewView 评分成功后调 `growthAPI.afterReview`（不 await 主流程）+ `GrowthToast.tsx` + theme.css `.growth-toast` 段 | frontend-builder | `src/components/ReviewView.tsx`、`src/components/GrowthToast.tsx`（新增）、`src/theme.css` | `tests/m13.gui.mjs` G-1…G-6 全绿；`grep -n "growth-toast" src/theme.css` ≥1 且入场规则在 `no-preference` 作用域、同文件存在对应 reduce 块；评分→下一张卡的路径无任何 `await growth` 阻塞（code review 核对）；禁注册快捷键（`grep -n "globalShortcut\|keydown" src/components/GrowthToast.tsx` = 0） | B1 |
| B3 | 会话成果汇总：ReviewView 收尾分支挂 `.growth-session`（调 `growthAPI.sessionSummary`） | frontend-builder | `src/components/ReviewView.tsx`、`src/theme.css` | `tests/m13.gui.mjs` G-7…G-9 全绿；空会话（无命中）渲染零新增 DOM（`data-growth-session` 不出现）；折叠行展开走 §7 折叠模式 | B1 |
| B4 | 仪表盘接入：`widgets.tsx` 增 `layer` 字段与 `growth-events`/`territory` 两 widget（自取数）+ 两个 widget 组件 + `layout.ts` 默认序插入 | frontend-builder | `src/components/dashboard/widgets.tsx`、`layout.ts`、`GrowthEventsWidget.tsx`（新增）、`TerritoryWidget.tsx`（新增）、`src/theme.css` | 既有 12 widget 行为零变化（`grep -c "id: \"" src/components/dashboard/widgets.tsx` 增量=2）；`defaultLayoutV2` 新序中两新 widget 紧跟 `today` 之后；存量库升级路径经 `syncHidden` 自动可见（GUI 断言 G-10）；`data-widget="growth-events"` / `data-widget="territory"` 探针在场；禁改既有 widget 定义 | B1 |
| B5 | 收尾回归：m13 三套件 + 全量既有回归（fsrs 六件套不适用本批；跑 m4/m12/ Shelf/Dashboard 相关 GUI 与 F11/F18/F21/F27 闸门） | bug-fixer | — | §6.4 回归清单全绿或与 main 基线一致（§8.2 已知四套件陈旧红除外，附对照说明）；`npm run build` 通过 | B2、B3、B4 |

### 4.3 GF-2 批次（阻塞中，先修契约）

| # | 任务 | 建议执行者 | 涉及文件 | 可机械检查的验收标准 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| G0 | **契约修订（总控落库，非代码）**：按 §7 缺口 G1/G2/G3 修 §4.17-5/§6.6.1/§6.6.4（知识层判定数据面映射到 M17 `learner.db kp_states` / `learning_events` / K1 `knowledge_relations`；Territory 视觉阶段映射改锚现行状态模型） | 总控 | `AI_DEVELOPMENT_GUIDE.md` | bump 版本 + 决策号登记；§4.17-5 数据来源列与实际表名一一对应 | 无 |
| G1 | `deriveKnowledgeEvents` 纯函数 + node 测试（按修订后契约） | core-engineer | `electron/growth.js`、`tests/growth.test.cjs` | 知识层断言组全绿；`structure-link` 只认用户确认的 `analogous_to` 且不进 mastery 估计（§4.7-11 精神） | G0、A1 |
| G2 | `capability` widget + overview `knowledge` 字段填充 + Territory 知识疆域升级评估 | core-engineer（数据）→ frontend-builder（UI） | `electron/db.js`、`src/components/dashboard/`、`src/lib/growth.ts` | knowledge 字段非 null；capability 每项证据链可点（契约 §4.17-4③）；`growth:overview` 仍零写 | G1、B4 |

---

## 5. UI 设计

视觉基线：`docs/swiss-international-style.md`（Token、直角、hairline、单一焦点色、禁装饰彩）；动效基线：`docs/design/MOTION-DESIGN-SPEC.md`（本节所有时长/缓动/位移只引用其 §1 token，不新增 token、不裸写 ms）。以下类名即实现契约。

### 5.1 复习页微反馈条 `.growth-toast`（§6.6.2）

**形态**：卡面下方轻提示条，**绝对定位浮层**（不占布局流 → 结构性保证「不推挤卡面」，§6.6.2 硬性）；同一时刻至多一条，新命中直接替换（不排队不堆叠）。

**DOM（挂在 `.review-session` 内，`ReviewView` 在 `CardFace` 之后的条件渲染）**：

```html
<div class="growth-toast" role="status" aria-live="polite"
     data-growth-toast data-growth-tier="2" data-growth-event="retention-60">
  <p class="growth-toast-text">这张卡进入 60 天档</p>
  <button class="growth-toast-more" data-testid="growth-toast-expand"
          aria-expanded="false">证据</button>
  <div class="growth-toast-detail" data-growth-detail hidden>
    <!-- 证据链：组内卡 / 来源材料 / 相关日志摘要（mono meta 行），§6.6.2 可追溯 -->
  </div>
</div>
```

**样式（Token 全表）**：

```css
.growth-toast {
  position: absolute;
  inset-inline: 0;
  margin-inline: auto;              /* 720 居中列同一公式（§18.3 对齐锚） */
  max-width: 720px;
  bottom: var(--sp-4);
  z-index: var(--z-sticky);
  background: var(--paper);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-float);  /* 浮层唯一阴影，不混用 --shadow-hover（已废除） */
  padding: var(--sp-2) var(--sp-4);
  border-radius: 0;                 /* 默认皮肤方角语言 */
}
.growth-toast-text { font-size: var(--fs-body, 14px); color: var(--ink); }
.growth-toast-more { /* Meta 档 accent 文字按钮，hover 下划线（§5.4 跳转链接先例），无箭头字符 */ }
.growth-toast-detail { border-top: 1px solid var(--border-subtle); margin-top: var(--sp-2); padding-top: var(--sp-2); }
.growth-toast-detail .mono { font-family: var(--mono); color: var(--grey-3); font-size: 12px; }
```

- 颜色纪律：**无装饰彩色**，单一焦点色只允许出现在「证据」文字按钮上（accent）；tier 不用颜色表达（用文案自身承载，禁彩色徽标——§6.6.2「颜色只用 Swiss token（单焦点色，禁装饰性彩色）」）。
- 证据展开用 MOTION-DESIGN-SPEC §7 折叠模式（`.collapse-clip` grid 0fr↔1fr，`--dur-panel` 240ms `--ease-out-soft`）；展开期间暂停自动消失计时，收起后重新计时。

**动效（引用 MOTION-DESIGN-SPEC 档位；全部包在 `@media (prefers-reduced-motion: no-preference)` 内）**：

| 状态 | 参数 |
| --- | --- |
| 进场 | `opacity 0→1 + translateY(var(--shift-sm))→0`，`var(--dur-enter)`(150ms) `var(--ease-enter)`（§10 列表新增项同参数族） |
| 替换 | 旧条直卸（不做交叉出场——单槽替换，用户注意力在新条上；§9 单主角） |
| 消失（计时 5s 到点 / 展开面板关闭后再计 5s） | `opacity→0`，`var(--dur-exit)`(100ms) `var(--ease-exit)`，动画完卸载 |
| reduce | 无 keyframes，显示/消失瞬时（功能性出现，无装饰位移） |

**行为细则**：5s 计时从渲染完成起算（§6.6.2 建议 4–6s 取中，登记定稿值）；`role="status" + aria-live="polite"`（评分后焦点不在条上，照 `BackgroundActivity`/`AIPanel` 既有 aria-live 先例）；不抢焦点、不注册快捷键、不改变 `.review-session`/`.stage-bar` 任何几何；设置关闭或 `afterReview` 失败 → 组件不挂载（零渲染）。

**零渲染零计算短路（§6.6.2 硬性）**：`ReviewView` 挂载时读 `normalizeGrowthFeedback(await settingsStore.get("app","growthFeedback",{enabled:true}))`；`enabled=false` 时**评分路径完全不调用** `growth:afterReview`（读取路径短路，非「调了但藏 UI」）。

### 5.2 会话成果汇总 `.growth-session`（§6.6.3）

**位置**：`ReviewView` 收尾分支（`!current && sessionDone`）的 `.review-session > .empty-state` 内、`deferredPanel` 之后；仅 `doneCount > 0` 时由 `growthAPI.sessionSummary(sessionStartTs)` 驱动（`sessionStartTs` = 会话首卡渲染时刻，组件 state 记录）。

```html
<div class="growth-session" data-growth-session>
  <p class="growth-session-title">本轮成果</p>
  <ul class="growth-session-list">
    <li class="growth-row" data-growth-row data-growth-event="material" data-growth-tier="2">
      <span class="growth-row-tier mono">建制</span>
      <span class="growth-row-text">《XX》已过半进入长期记忆</span>
    </li>
    <li class="growth-row" data-growth-row data-growth-fold>
      <button class="growth-fold-btn" aria-expanded="false">今天另有 3 张卡进入长期维持</button>
      <ul class="growth-fold-list" hidden><!-- 折叠明细，每条同 growth-row 结构 --></ul>
    </li>
  </ul>
</div>
```

- 排序 = §6.6.1 表序（tier 升序 → 表内序 → 实体 id 字典序，与 `pickTopEvent` 同一序函数复用，禁第二套排序）；L3 项照常列出（投放面=汇总）。
- 每条 `growth-row-text` 文案出自 `growthStrings.ts`；「证据」展开同 §5.1 detail 模式（组内卡正面摘要 / 材料名 / 触发日志 mono 摘要）。
- **空态**：无命中时不渲染本块（只留既有「到期卡片已清空，休息一下。」；禁「今日无成长」类负面对照，§6.6.3）。
- 样式：无卡片化容器堆叠——`growth-session-title` 用 Meta 档 `--grey-3`，行间 hairline（`--border-subtle`），tier 标签 mono 12px `--grey-3`，正文 `--ink`；层级（能力/结构/建制）用文字不用颜色。
- 动效：列表整体随收尾页出现（无独立入场，避免与页面过渡叠双动效——MOTION-DESIGN-SPEC §9 单主角）；折叠展开走 §7 折叠模式；reduce 瞬时。

### 5.3 仪表盘新 widget（§6.6.4 四层接入）

**`layer` 字段**：`WidgetDef` 增 `layer?: "today" | "growth" | "capability" | "territory"`（缺省 `"today"`）；既有 12 组件定义一律补显式 `layer: "today"`（行为零变化）。设置页「可显示数据」等面板不改（新组件无 dataKey 档位，`charts` 单图型）。

**默认布局插入**（`defaultLayoutV2`）：新序 = `kpi, timeline, heatmap, today, growth-events, territory, domains, rhythm, …`（两新组件紧跟 `today` 之后，即「Growth / Territory 排在 Today 之后」的字面落实；`territory` 定 `half`，与后随 `domains` 自然成对，`growth-events` 定 `wide`）。存量用户经 `syncHidden` 的「插到默认顺序前驱之后」规则自动可见（D122 一日时间轴同路径，无需迁移）。

**数据获取（Timeline 先例）**：两 widget 不进 `StatsOverview`、不改 `stats:overview`——组件内经 `useGrowthOverview()` 自取 `growth:overview`；hook 内置模块级缓存（stale-while-revalidate，照 Dashboard `dashCache`）+ 订阅 `eventBus.on("cards/changed"|"library/changed")` 后 **800ms 防抖**刷新（§4.17-6⑥：聚合视图防抖；仪表盘每次 `cards/changed` 全量重算 `stats:overview` 的既有模式**不叠加**——growth 数据独立缓存，不挂进同一刷新链）。

#### `growth-events`（成长记录，Growth 层，wide）

```html
<div class="growth-records" data-widget-body>
  <ol class="growth-record-list">
    <li class="growth-record" data-growth-record data-growth-event="group" data-growth-tier="2">
      <span class="growth-record-date mono">09-14</span>
      <span class="growth-record-text">这一组 4 张卡全部进入长期复习</span>
      <span class="growth-record-src mono">《XX》</span>
    </li>
  </ol>
  <p class="growth-empty">暂无成长记录——完成复习后，真实的跨越会出现在这里。</p>
</div>
```

- 数据 = `overview.recentEvents`（L0–L2，triggerSeq 倒序，默认 30 条）+ 头部计数 `totals`（`L0 能力 N · L1 结构 N · L2 建制 N`，mono meta）。这是 §4.17-6③ 的「一次性盘点入口」：历史档案在此**被动陈列**，不弹窗、不推送。
- 样式：行 hairline 分隔、日期 mono 12px `--grey-3`、正文 14px `--ink`、来源 `--grey-3`；无图标、无彩色徽标。
- 空态：真实空态一行文案（MOTION-DESIGN-SPEC §6.2「不画假轴假数据」）；禁「再接再厉」类打鸡血文案。
- 动效：容器随页面揭示（§5.2 入场闸门语义，不另设入场）；数据刷新换行瞬时（列表非图表，不加 stagger）。

#### `territory`（巩固疆域，Territory 层，half）

**GF-1 形态 = 材料/领域巩固地图**（§6.6.4：GF-1 不得自称知识疆域——组件标题定「巩固疆域」，不用「知识疆域」字样）：

```html
<div class="territory-map" data-widget-body>
  <div class="territory-row" data-territory-row data-territory-id="li_xxx">
    <span class="territory-name">《XX》</span>
    <span class="territory-seg" role="img"
          aria-label="共 24 张：未学 4 · 学习中 6 · 长期复习 8 · 已巩固 6">
      <i class="territory-seg-new" style="flex-grow:4" />
      <i class="territory-seg-learning" style="flex-grow:6" />
      <i class="territory-seg-reviewing" style="flex-grow:8" />
      <i class="territory-seg-consolidated" style="flex-grow:6" />
    </span>
    <span class="territory-pct mono tnum">50%</span>
  </div>
  <p class="territory-foot mono">覆盖 = 已巩固 / 活跃卡 · ≥8 张参与 · 已过半材料 3 本</p>
</div>
```

- 数据 = `overview.territory.rows`（书维聚合，按 total 降序取前 8；活跃卡 <8 的书不显示——与 `material` 事件同一样本门槛，口径同源 `isConsolidated`）；`territory-pct` 是覆盖率（`consolidated/total`）。
- 分段条视觉（MOTION-DESIGN-SPEC §6.2 明度阶梯纪律）：条高 12px、直角、段间 1px `--paper` 缝；`--grey-1`（未学）→ `--grey-2`（学习中）→ `--ink`（长期复习）→ **`--accent`（已巩固，单图唯一焦点色）**；无圆角无渐变。
- 动效：分段条挂 `chart-seg` 族入场（`scaleX(0→1)`、stagger 40ms/段 ×≤8、`--dur-chart-in` 400ms `--ease-enter`，挂 `:root:not([data-vt])` 入场闸门——MOTION-DESIGN-SPEC §6.3/§5.2）；数据更新 300ms `--dur-chart` `--ease-out-soft` 几何过渡；hover 其余行 opacity→0.35（§6.3 hover-dim 族）；reduce 全瞬时。
- 回落呈现纪律（§4.17-7③）：本图只显示**现状**（材料覆盖率可回落），无回落提示无警告；`crossedHalf/crossedFull` 已跨越标记随现状自然消失（Growth Records 才是历史）。

#### `capability`（能力里程碑，Capability 层，half——GF-2 实现，形状预设计）

```html
<div class="capability-list" data-widget-body>
  <li class="capability-row" data-capability-row data-growth-event="kp-functional">
    <span class="capability-text">「XX」达到 functional：第一次能脱离提示讲清楚</span>
    <button class="capability-evidence">证据链</button><!-- 每项必可点（§4.17-4③），不可追溯的项不显示 -->
  </li>
</div>
```

- 数据 = `overview.knowledge.capability`；样式同 `growth-records` 行语言；**不可追溯的项不显示**（契约硬性）。

---

## 6. 测试计划

### 6.1 node 纯函数测试 `tests/growth.test.cjs`（node 直跑，A2 产出）

断言要点（P-1…P-14，全部对 §3.2 函数喂手工夹具行）：

- **P-1 首次语义**：序列 `[60,60,180]` 档上 `firstCrossings` 只在跨档日志报一次；triggerSeq=跨档那条。
- **P-2 撤销回退**：删掉跨档日志（序列变 `[60,60]`）后重算 → retention-180 命中消失、retention-60 仍在（静默回退，§4.17-6②）。
- **P-3 重评再触发**：`[180→回落 30→180]` 产生第二次命中，triggerSeq=最后一条（真实的重做）。
- **P-4 取消项**：学习步毕业日志（before learning → after review）不产任何事件；stability 首过 21 不产事件。
- **P-5 relearning-recovery**：`before.state=relearning && after.state=review` 命中一次；无快照旧日志（NULL）不参与。
- **P-6 leech-recovery**：`leech_before_json` 非空历史 + 其后 stability≥21 首达命中；从未 leech 的卡永不命中。
- **P-7 retention 双档同日**：单条日志 stability 直越 180 → 只报 180（`pickTopEvent`），60 进 others。
- **P-8 group**：组=2 卡全 review → 命中；组=1 卡不命中（≥2 门槛）；组内 1 张 learning 不命中；按 sibling_key 与 knowledge_point_id 两种键分别成立。
- **P-9 material**：8 张卡 4 张 consolidated → `half` 命中；7 张样本（<8）任何覆盖率不命中；100% 时 `full` 命中；书维与领域维各自独立命中。
- **P-10 pickTopEvent 序**：跨 tier 取高；同 tier 按表序；同表序按实体 id 字典序；L3 永不入 toast（surface 过滤）；others 保留被挤掉项（不丢弃）。
- **P-11 foldSameDay**：同学习日同 type L2 多条 → 首条可见+计数；跨学习日不折叠；L0 假想命中不折叠。
- **P-12 isConsolidated 口径唯一**：与漏斗同值域（state=review ∧ stability>21）；挂起卡排除。
- **P-13 territory 聚合**：四段计数之和=total；<8 样本的书被过滤；覆盖率=consolidated/total。
- **P-14 纯度**：同输入两次调用输出 `JSON.stringify` 全等；函数不读 `Date.now()`（now 全部注入）。

### 6.2 electron db 层测试 `tests/m13.test.cjs`（`npx electron`，隔离临时库，先关应用；A3 产出）

断言要点（N-1…N-12）：

- **N-1** 种子库（真实 `db.createCard`/`saveReview` 造数）上 `getGrowthOverview` 形状正确（enabled/now/cutoffHour/recentEvents/totals/territory 全键）。
- **N-2** `getGrowthAfterReview(cardId)` 只返回 triggerSeq=该卡最新 seq 的命中（防回灌：预先埋 10 条历史日志造存量跨越 → 不返回任何 toast）。
- **N-3** 评分真实跨档（构造 stability≥60 的 after 快照评分）→ toast 命中 retention-60 且 surface 不含 toast 的 L3 场景正确分流。
- **N-4** `undoLastReview` 后重调 `getGrowthSessionSummary` / `getGrowthOverview` → 对应事件消失（撤销联动）。
- **N-5** `getGrowthSessionSummary(fromTs)`：窗口外日志不计入；窗口内多命中按表序；L2 折叠计数正确。
- **N-6** 设置 `growthFeedback.enabled=false` → 三出口返回 `{enabled:false}` 且**不产生任何派生**（断言返回体无 hits 键）。
- **N-7** 损坏行（fsrs_json 坏 JSON 卡）被跳过不炸（照 computeTodayQueue 容错口径）。
- **N-8** 挂起卡（leech.suspended）不计入 material/group 样本。
- **N-9 口径一致性**：同一评分序列，「per-grade 出口多次结果之并」≡「sessionSummary 窗口一次重算」（同一批 derive 函数的差分证明）。
- **N-10** `now` 注入跨学习日折叠边界（dayCutoffHour 非 0 下 foldSameDay 归日正确）。
- **N-11 零写不变量**：全套件运行前后 `cards`/`review_logs`/`fsrs_configs`/`knowledge_*` 各表行数与逐行内容 `JSON.stringify` 全等 + 库文件字节级不变（读侧零写路径的机械证据）。
- **N-12** IPC 形状对账：`growth:*` 三通道 invoke 返回值可被 `JSON.parse` 且符合 §3.4 表（防 preload 漏桥）。

### 6.3 GUI 套件 `tests/m13.gui.mjs`（CDP 自启自关；`M7_TEST_USERDATA` 隔离；**跑前 `npm run build`**；探针设计与断言清单如下，实现批执行）

前置种子（经 `libraryAPI.createFromPaste` + IPC 直造卡与日志，FSRSTEST 前缀）：1 本书 10 张卡，其中 5 张预置 stability≥60 的评分历史。

| # | 断言 | 探针 |
| --- | --- | --- |
| G-1 | 评分一条会跨档的卡后 `.growth-toast` 出现，`role=status`、`aria-live=polite`、文案出自 growthStrings | `[data-growth-toast]` |
| G-2 | 提示条出现**不改变卡面与评分栏几何**（出现前后 `.review-front`/`.grade-row` boundingRect 全等，≤1px） | 同上 |
| G-3 | 自动消失 ≤6s（计时后探针消失）；连续两次命中时单槽替换（任意时刻 `[data-growth-toast]` 数 ≤1） | 同上 |
| G-4 | 点击「证据」展开 detail（`aria-expanded` 翻转、`[data-growth-detail]` 可见），展开期不消失 | `[data-testid="growth-toast-expand"]` |
| G-5 | 设置关闭 `growthFeedback.enabled=false` → 评分后 `[data-growth-toast]` 永不出现（零渲染）；重新开启恢复 | 设置页真实路径（照 accent.gui 教训：settingsAPI.set + 生效） |
| G-6 | reduce 档（CDP `Emulation.setEmulatedMedia`）无进场位移（computed animation-name 为 none），出现/消失瞬时 | `.growth-toast` |
| G-7 | 清空队列进收尾页 → `.growth-session` 列出本轮全部命中（含 L3 retention-60），行序=表序 | `[data-growth-session] [data-growth-row]` |
| G-8 | 空命中会话不渲染 `.growth-session`（零 DOM），页面只有既有空态文案 | 同上 |
| G-9 | 折叠行「今天另有 N 张…」点击展开明细、`aria-expanded` 正确 | `[data-growth-fold] button` |
| G-10 | 仪表盘：`data-widget="growth-events"` 与 `data-widget="territory"` 在场且位于 `today` 之后；行数=种子数据预期；territory 分段条四段 aria-label 数值与种子一致；`layer` 属性不破坏拖拽（拖一次 growth-events 后 settings `dashboard.layout` 持久化新序） | `[data-widget=…]` |
| G-11 | 成长反馈关闭时两 widget 呈静态空态（不调用派生——以 `growth:overview` 返回 `{enabled:false}` 为证，经 `window.growthAPI` 直查） | — |
| G-12 | 重启不丢：重启后仪表盘两 widget 行不变、设置项持久化 | §7.1.4 验收线 |

### 6.4 回归清单（B5）

- 闸门：`F11`（表名/表数对齐——本批零新表，防误登记）、`F18`（`app.growthFeedback` 进 DOC_KEYS + round-trip）、`F21`（IPC 对账含 growth:* 三条）、`F27`（克制红线）。
- 相关 GUI 回归：`m4`（复习页）、`m12`（同源延后/收尾页）、`shelf`/`d122` 相关 Dashboard 断言不受新 widget 影响（`grep "modal-panel" tests/*.mjs` 口径不受本批影响——本批零模态）。
- `npx tsc --noEmit` + `npm run build`。
- 已知豁免：§8.2 登记的四个陈旧红 GUI 套件（m6-2/m1/m2/m4 的既有失败断言）与本次改动无关，对照 main 基线记录即可。

---

## 7. 契约缺口清单（只列不改；由总控按「先改文档再编码」处置）

| # | 缺口 | 证据 | 影响与建议 |
| --- | --- | --- | --- |
| G1 | **GF-2 知识层判定数据面失效**：§4.17-5 与 §6.6.1 序 1–6 的数据来源写 `knowledge_evidence` / `learner_knowledge_states` / Frontier 派生，但这三样属 §4.7/§4.8，已被 §4.20（D124/M17）**整体取代**且从未建表（`electron/db.js` 无此二表；现行知识地基=K1 四表 + `learner.db kp_states`（L0–L4）/`learning_events`） | §4.20 第 2 条「取代关系」明文；db.js 建表清单 | GF-2 的 `transfer-first`/`application-first`/`kp-strong`/`kp-functional`/`domain-entry` 在现库上**无契约口径可依**。须先修 §4.17-5：判定数据面改锚 M17（如 `kp-functional`↔`kp_states` L2+ 首达、`kp-strong`↔L3 首达——`first_l3_at/first_l4_at` 已在表内）与 K1；修完前 GF-2 不得实现（本稿 §3.5 只留签名） |
| G2 | **Territory 视觉阶段映射表的口径列指向已被取代的状态模型**：§6.6.4 映射表「四态/维度口径」列写 `uncertain/developing/functional/strong` + 五维（§4.7 词汇），而 §4.17-2③ 又规定「状态词表锁死 §4.7」；§4.7 已被 M17 取代，现行词表=KP 五级 L0–L4 + 词项五态 | §4.20、§6.6.4 表 | GF-1 的 Territory（材料巩固地图）不受影响（只用记忆层口径）；GF-2 知识疆域升级前须在 GUIDE 登记视觉阶段↔L 级映射表，否则会出现第二套状态解释（违 §4.17-2③） |
| G3 | **`structure-link` 的「用户确认」语义待核对**：§6.6.1 序 5 要求 `analogous_to` 经用户确认；K1 的 `knowledge_relations` 已建表但 `analogous_to`「只建表不启用引擎」（db.js 注释），关系写侧 `source` 字段（'user'/'ai'…）与确认动作的对应关系无契约条文 | db.js ②表注释、§4.14 | GF-2 实现前须在 §4.17 或 §4.14 明确「确认」的机读判据（如 `source='user'` 且 `is_deleted=0`），防止把 AI 提案未确认边当作结构证据（违 §1.7） |
| G4 | **记忆层阈值数值契约未给**：`leech-recovery` 的「消解后首次稳定」、`material` 的「覆盖率」与「巩固」判定、`group` 的「同一阶段」，§6.6.1 只给语义不给数值；本稿按 §3.2 给定稿值（21d 巩固阈值=漏斗同源、样本 ≥8、覆盖率 50%/100%、组 ≥2） | §6.6.1 触发口径列 | 数值随 D129 一次性登记（附录 §9.3），实现不得另调；若总控另有裁定，改本表即改 §3.2，两处同步 |
| G5 | **§6.6.2 自动消失时长「4–6s 实现批定」**：本稿定 5s | §6.6.2 | 同 G4 随 D129 登记 |

---

## 8. 风险清单

| # | 风险 | 缓解 |
| --- | --- | --- |
| R1 | **GF-2 全批阻塞于 G1**（最高风险）：契约数据面与实际库脱节，若跳过修订直接实现会制造第二套事实解释 | 本稿把 GF-2 全部圈进阻塞批次 G0→G1→G2；GF-1 独立可交付（零依赖子集，§4.17-10 明文允许） |
| R2 | 性能：`growth:overview` 全库聚合（cards + review_logs 全扫）叠加在高频 `cards/changed` 事件上 | 独立缓存 + 800ms 防抖 + 仅挂载时全量；`afterReview` 走窄范围派生（单卡日志 + 其组/材料聚合），不触全库；大库（10 万卡级）下的 overview 耗时在 m13.test 里加计时断言（>500ms 记录并在报告注名） |
| R3 | 评分路径被派生拖慢（§4.17-3 红线：派生失败静默降级、绝不影响评分） | `afterReview` 在成功边界后异步 fire-and-forget（不 await、catch 静默）；code review 核对无 await 链 |
| R4 | 防回灌失效会让存量用户首启被历史提示轰炸（违 §4.17-6③） | triggerSeq 严格等值判定（N-2 断言）；toast 只消费 `afterReview` 出口，任何其他路径的命中进不了提示条 |
| R5 | 撤销后再评分导致同一提示反复出现，用户感知「重复打扰」 | 契约允许（真实的重做，§4.17-6②）；单槽替换 + L2 折叠 + L3 不进 toast 已把频率压到最低；观察期问题入 §9.4 候选（如单日同键静默），本期不做 |
| R6 | 默认布局插入改变存量用户首页观感（新 widget 自动出现在仪表盘） | `syncHidden` 前驱插入是 D122 已验证路径（一日时间轴同机制）；用户可隐藏（hiddenWidgets 既有机制）；插入位（today 之后）为契约 §6.6.4 字面要求 |
| R7 | `settings.app.growthFeedback` 对象键被 F18 扫描器误报（D82 教训：写侧勿用变量间接） | 照 D104 `cardFaceExtras` 对象键先例逐字面量写；F18 DOC_KEYS 只登记对象键名，子键不单列 |
| R8 | GUI 套件依赖 build + 隔离，主机环境差异导致 flaky | 照 m12.gui 模板（M7_TEST_USERDATA、自启自关、fetch+WebSocket CDP）；探针全部 data-* 属性，不依赖文案断言（文案断言只做 1 条冒烟） |
| R9 | `material` 事件的材料归属依赖 `context_ref_json.documentId → library_items` join，粘贴书与文件书路径不同可能漏归属 | 复用 `TODAY_QUEUE_SQL` 的同一 join 写法（`json_extract` + documents→library_items）；无归属卡不参与书维聚合、仍参与领域维（UDC 在卡上） |

---

## 9. 附录：GUIDE 登记块（只写文本，由总控落库）

### 9.1 建议版本号

**v48.85**（当前头 v48.84 / D128）。

### 9.2 §8.1 决策日志行（追加一行）

```text
| v48.85 | D129 | M13 GF-1 成长反馈记忆层设计定稿并开工：设计稿 `docs/design/GROWTH-FEEDBACK-D129.md`——`GrowthReadModel`（§4.2-22）落地设计＝`electron/growth.js` 纯函数（事件判定口径唯一居所）+ `growth:*` 只读 IPC 三通道（afterReview/sessionSummary/overview）+ 复习页微反馈条/会话成果汇总/仪表盘「成长记录」「巩固疆域」两 widget（`WIDGETS` 增 `layer` 字段，默认序插 `today` 之后）；设置键 `app.growthFeedback={enabled}`（默认开，关闭=零渲染零计算）；记忆层阈值定稿（巩固=review 且 stability>21 与漏斗同源 / material 样本 ≥8 / 覆盖率 50%·100% / 组 ≥2 / toast 5s）；GF-2 知识层**阻塞**——§4.17-5/§6.6.1 数据源（knowledge_evidence/learner_knowledge_states/Frontier）已被 §4.20 M17 取代，须先修契约再实现（缺口 G1–G3 见设计稿 §7）；零新表零写路径零依赖 |
```

### 9.3 §9.1 M13 行更新文本

```text
### M13 — 成长反馈 Growth Feedback（v39 定契约；v48.85 / D129 出实现设计稿 docs/design/GROWTH-FEEDBACK-D129.md；GF-1 记忆层按稿实施，GF-2 知识层阻塞于契约修订（知识层判定数据面映射到 M17/K1，见设计稿 §7 缺口 G1–G3）；位置：排在 M8-B 与 K0–K9 之后——M8-B v40 ✅、K3–K9 由 M17 取代且 v48.80 ✅，前置满足）
```

### 9.4 §9.2 M13 状态行更新文本

```text
| M13 | 成长反馈 Growth Feedback（呈现层只读；正反馈分级总表；微反馈 + 会话成果汇总 + 仪表盘四层 + Territory；内部 GF-1 记忆层 → GF-2 知识层） | 🟡 **v48.85 / D129 设计定稿**（`docs/design/GROWTH-FEEDBACK-D129.md`；GF-1 数据面+呈现层任务拆解见稿 §4，测试义务见稿 §6）；GF-1 实现未启动；**GF-2 阻塞**：契约判定数据面（knowledge_evidence/learner_knowledge_states/Frontier）已被 §4.20 M17 取代，先修 §4.17 再实现 |
```

### 9.5 §7.4 需随 D129 追加的设置键登记文本

```text
- **成长反馈开关（v48.85 / D129）**：`app.growthFeedback`（对象 `{enabled}`，bool 默认 `true`）＝成长反馈总开关；关闭即零渲染零计算（读取路径短路，不派生任何事件，§6.6.2）。双侧归一——主进程 `settings:set` 写侧（`electron/main.js`，仅严格 `false` 为关，其余含缺失/非法回落开）与渲染层读侧（`src/lib/growthSettings.ts` `normalizeGrowthFeedback`，同规）；`F18` 的 `DOC_KEYS` + round-trip 用例须同步补齐。
```

---

*（设计稿完。执行顺序：总控落附录登记块 → 派发 GF-1 批次 A（A1→A2→A3，A4 并行）→ 批次 B（B1→B2/B3/B4→B5）→ 每轮 code-reviewer；GF-2 等 G0 契约修订。）*
